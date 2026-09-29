/**
 * Jump Raven, the whole game as far as it is ported. `new JumpRaven(files)`
 * gives a machine that advances a tick per `tick()`.
 *
 * ## The run (RAVEN.EXE)
 *
 *   startup     0x40ecd2: the font, RAVEN.SCO, `puppet`'s talk menu; then
 *               each level's handler is told the game is starting (0x40f936)
 *   level 0     a run with no saved game to open starts here (0x422489): the
 *               intro, the first briefing, the tutorial (0x426124)
 *   level 1     the high scores screen (0x420840), where PLAY is File ▸ New
 *               (0x4222fb): level 2
 *   a level     0x410491: the old level closed, the day's folder set from the
 *               new one (0x40e8df), and the new one opened
 *
 * The story (the even levels) is ported whole but for the screens between its
 * briefings — the Mart, the pilots, the debrief — and the flying (levels 3, 5
 * and 7) is not ported: the machine stops at the first of them and says so.
 */
import { readContainerFile } from "@dreamfactory/engine/df/container";
import { decodeFrameV0, type FrameV0 } from "@dreamfactory/engine/df/image-v0";
import { paletteV0, readMovFileV0 } from "@dreamfactory/engine/df/mov-v0";
import { ESCAPE, playFilm, trackPress } from "@dreamfactory/engine/v0/film";
import { readFon, textWidth } from "@dreamfactory/engine/v0/font";
import { talk, type TalkLook, type TalkState } from "@dreamfactory/engine/v0/talk";
import {
  BUTTON_FILMS, DEFAULT_DIFFICULTY, DIFFICULTY_NAMES, FACE_LEFT, FACE_WIDTH, HIGH_SCORES, LEFT_PANEL, OPENING,
  PUPPET_MENU, PUPPET_SCORES, RIGHT_PANEL, SCORES_INK, SCORE_BUTTONS, SIDE_PANELS, TALK_INK, TALK_PRESSED, TRAINING,
  dayOf, isFlying, type ScoreButton,
} from "./data";
import { Machine, type Co, type GameFiles, type Speaker } from "./machine";
import { qualifies, readSco, sortPlaces, writeSco, type Sco } from "./sco";
import { Comms, DEALER, ENEMY, FUEL, PILOT, REPAIR } from "./comms";
import { Mart, type MartState } from "./mart";
import { PILOTS, Pilots, type PilotsState } from "./pilots";
import { DEFAULT_BAND, Music } from "./music";
import { BONUS_ACCURACY, accuracy, accuracyScreen, damage } from "./debrief";
import { Flight, VIEW, readPanel, type FlightState } from "./flight";
import { PARAMS, World } from "./combat/world";
import { newHudState, type HudState } from "./combat/hud";
import { assemble } from "./combat/index";
import { readClutV0 } from "@dreamfactory/engine/df/clut-v0";
import { readMazeV0 } from "@dreamfactory/engine/df/maze-v0";
import { readContainerFile as readFile } from "@dreamfactory/engine/df/container";
import { AMMO_FULL, newRecords, startGame, type Records } from "./records";
import { inRect } from "./screens";

export type Phase = "boot" | "story" | "scores" | "flying" | "not-ported" | "quit";

export interface JumpRavenOptions {
  speaker?: Speaker;
  seed?: number;
  /** false skips decoding pictures, for a test that only follows the game */
  draws?: boolean;
  log?: (line: string) => void;
  /** RAVEN.SCO as the page kept it (648 bytes, src/game/sco.ts); none is the rip's own */
  sco?: Uint8Array;
  /** where the block goes once it has changed — a high score put in */
  keepSco?: (bytes: Uint8Array) => void;
  /** the high-score dialog (DLOG2, 0x4227c1): `done` with the name, or null for Cancel */
  askName?: (done: (name: string | null) => void) => void;
  /**
   * A machine test's shortcut: a new game opened straight at this level, the
   * records changed as given — how the way back from a flight is played while
   * the flying is not ported
   */
  start?: { level: number; difficulty?: number; records?: Partial<Records> };
}

export class JumpRaven {
  readonly m: Machine;
  phase: Phase = "boot";
  /** `[0x43b2fc]` */
  level = OPENING;
  /** `[0x439fb0]`: Settings ▸ Training … Expert */
  difficulty = DEFAULT_DIFFICULTY;
  readonly records: Records = newRecords();
  readonly comms: Comms;
  /** the Mart while it is up, for a machine test */
  mart: MartState | null = null;
  /** COPILOT SELECTION while it is up */
  pilots: PilotsState | null = null;
  /** `[0x43b304]`: the band the player flies to (src/game/music.ts) */
  readonly band = { value: DEFAULT_BAND };
  /** the HUD's own state, which a new game zeroes (0x415f51) and the flights carry on from one to the next */
  hudState: HudState = newHudState();
  /** the flight while one is up */
  flight: FlightState | null = null;
  /** the key held down last, as RAVEN.EXE repeats it (message 7 with `[0x43b2cc]`) */
  private heldKey: string | null = null;
  /** the screen between the briefings that is up, by name — what a machine test waits on */
  screen: "mart" | "pilots" | "music" | "damage" | "accuracy" | null = null;
  sco!: Sco;
  /** why the machine stopped, when it did */
  stopped = "";
  /** every film and talk the run has played, in order — what a machine test reads */
  readonly played: string[] = [];
  readonly talkState: { talk: TalkState | null } = { talk: null };
  /** PLAY, or File ▸ New, waiting for the level to let go */
  private newAsked = false;
  private run: Co | null = null;
  private puppet: Uint8Array[] = [];
  private pictures = new Map<number, FrameV0>();
  /** the one palette every film and talk file of the rip carries (all 171 of them) */
  private palette: Uint8ClampedArray = new Uint8ClampedArray(1024);

  constructor(files: GameFiles, private readonly opts: JumpRavenOptions = {}) {
    this.m = new Machine(files, opts.speaker, opts.seed ?? 1994, opts.draws ?? true, opts.log);
    this.comms = new Comms(this.m);
  }

  /** one tick; false once the machine has stopped */
  tick(): boolean {
    this.run ??= this.main();
    const r = this.run.next();
    this.m.ticks++;
    return !r.done;
  }

  /** PLAY, from the page: a new game as soon as the level lets go */
  newGame(): void {
    this.newAsked = true;
  }

  private *main(): Co {
    const m = this.m;
    try {
      yield* this.startup();
      // 0x40f989 → 0x422489: no saved game to open, so level 0
      this.level = OPENING;
      const start = this.opts.start;
      if (start) {
        startGame(this.records);
        this.hudState = newHudState();
        Object.assign(this.records, start.records ?? {});
        this.difficulty = start.difficulty ?? this.difficulty;
        this.level = start.level;
      }
      for (;;) {
        this.phase = this.level === HIGH_SCORES ? "scores" : "story";
        const next = isFlying(this.level) ? yield* this.flying() : this.level === HIGH_SCORES ? yield* this.highScores() : yield* this.story();
        if (next < 0) return;
        yield* this.go(next);
      }
    } catch (e) {
      if (e instanceof NotPorted) {
        this.phase = "not-ported";
        this.stopped = e.message;
        m.log(`stopped: ${e.message}`);
        return;
      }
      throw e;
    }
  }

  /** 0x40ecd2 and the handlers' startup (message 0) */
  private *startup(): Co {
    const m = this.m;
    m.font = readFon(yield* m.own("RAVEN.FON"));
    let sco: Sco | null = null;
    if (this.opts.sco) {
      try {
        sco = readSco(this.opts.sco);
      } catch (e) {
        m.log(`raven.sco: ${String(e)}; the rip's instead`);
      }
    }
    this.sco = sco ?? readSco(yield* m.own("RAVEN.SCO"));
    this.puppet = readContainerFile((yield* m.file("puppet", 1)).data).containers.map((c) => c.data);
    this.palette = paletteV0(readMovFileV0((yield* m.file("intro.move", 1)).data).paletteRaw);
    // 0x40efa4 …: the five comms heads, the pilot's Lark's until one is chosen
    for (const [who, name] of [[PILOT, "lark.mupp"], [DEALER, "weap.mupp"], [FUEL, "fuel.mupp"], [REPAIR, "rbay.mupp"], [ENEMY, "enem.mupp"]] as const) {
      yield* this.comms.load(who, name, 1);
    }
    m.log(`Jump Raven: ${this.sco.places.length} score tables, difficulty ${DIFFICULTY_NAMES[this.difficulty - 1]}`);
  }

  private picture(k: number): FrameV0 {
    let f = this.pictures.get(k);
    if (!f) this.pictures.set(k, (f = decodeFrameV0(this.puppet[k])));
    return f;
  }

  /** 0x410491: the level closed, the new one's folder set, the new one opened */
  private *go(level: number): Co {
    this.m.log(`level ${this.level} → ${level} (day ${dayOf(level)})`);
    this.level = level;
    yield;
  }

  private get day(): number {
    return dayOf(this.level);
  }

  /* ---- the story's pieces --------------------------------------------- */

  private *film(name: string): Co {
    this.played.push(name);
    yield* playFilm(this.m, name, this.day);
  }

  /**
   * 0x426ad4: a briefing — the level's side panels either side of the face
   * (0x42696d), the talk (0x41e5c4), the window cleared after (0x426dfc).
   */
  private *briefing(file: string): Co {
    const m = this.m;
    this.played.push(file);
    const k = SIDE_PANELS[this.level] ?? 2;
    if (m.draws) {
      m.screen.spriteAt(this.picture(k), LEFT_PANEL[0], LEFT_PANEL[1], LEFT_PANEL);
      m.screen.spriteAt(this.picture(k + 1), RIGHT_PANEL[0], RIGHT_PANEL[1], RIGHT_PANEL);
    }
    yield* talk(m, file, this.day, this.talkState, this.look());
    m.clear();
  }

  /** how every talk of the game looks (src/game/data.ts) */
  private look(): TalkLook {
    return { menuBackdrop: this.m.draws ? this.picture(PUPPET_MENU) : null, ink: TALK_INK, pressed: TALK_PRESSED, faceWidth: FACE_WIDTH, faceLeft: FACE_LEFT };
  }

  /**
   * 0x426b0a, asked after every film and talk of the story: whether the player
   * quit to the high scores in the middle (⌘Q, then DLOG6's OK). The page has
   * no ⌘Q yet, so this only ever answers no.
   */
  private quitAsked(): boolean {
    return false;
  }

  /** a piece of the story not ported yet */
  private notPorted(what: string, at: string): never {
    throw new NotPorted(`${what} (${at}) is not ported yet`);
  }

  /**
   * 0x426124: the story. Each even level plays its films and briefings in
   * order, asking after each whether the player quit (0x426b0a); the pieces
   * between the briefings are their own screens.
   */
  private *story(): Co<number> {
    const m = this.m;
    const steps = (list: (() => Co)[]) => list;
    const f = (name: string) => () => this.film(name);
    const b = (name: string) => () => this.briefing(name);
    const mart = () => this.visitMart(0);
    const pilots = () => this.choosePilot();
    const music = () => this.chooseMusic();
    const damages = () => this.damage();
    const debrief = () => this.debrief();
    const briefings = steps([b("bat1.pupp"), f("enem.move"), b("bat2.pupp"), mart, b("bat3.pupp"), pilots, b("bat4.pupp"), music, b("bat5.pupp"), f("trans.move")]);
    const back = steps([f("drop.move"), b("batg.pupp"), f("anim.move"), b("bate.pupp"), damages, debrief]);
    const run = function* (list: (() => Co)[], quit: () => boolean): Co<boolean> {
      for (const step of list) {
        yield* step();
        if (quit()) return false;
      }
      return true;
    };
    const quit = () => this.quitAsked();
    switch (this.level) {
      case 0:
        if (!(yield* run([f("intro.move"), b("bati.pupp"), f("tutor.move")], quit))) return HIGH_SCORES;
        yield* m.fadeOut();
        return HIGH_SCORES;
      case 2:
        return (yield* run(briefings, quit)) ? 3 : HIGH_SCORES;
      case 4:
        if (!(yield* run(back, quit))) return HIGH_SCORES;
        // 0x426411: a Training game is over after its first day
        if (this.difficulty === TRAINING) {
          yield* m.fadeOut();
          yield* this.film("training.move");
          return HIGH_SCORES;
        }
        return (yield* run(briefings, quit)) ? 5 : HIGH_SCORES;
      case 6:
        return (yield* run([...back, ...briefings], quit)) ? 7 : HIGH_SCORES;
      case 8: {
        if (!(yield* run([...back, b("bath.pupp")], quit))) return HIGH_SCORES;
        // 0x4268b3: the pilot's own ending
        yield* this.film(`trans${this.records.pilot + 1}.move`);
        return HIGH_SCORES;
      }
    }
    throw new Error(`level ${this.level} is no story level`);
  }

  /**
   * 0x410540: the Mart — the window kept, faded out, `mart.move` or
   * `newman.move` first if asked for (1, 2), the Mart itself, and the window
   * as it was
   */
  private *visitMart(film: 0 | 1 | 2): Co {
    const m = this.m;
    const saved = m.screen.pixels.slice();
    yield* m.fadeOut();
    if (film) yield* this.film(film === 1 ? "mart.move" : "newman.move");
    const mart = new Mart(m, this.records, this.comms, (yield* m.file("mart", this.day)).data);
    this.mart = mart.state;
    this.screen = "mart";
    this.played.push("mart");
    yield* mart.run(this.day, this.palette);
    mart.close();
    this.mart = null;
    this.screen = null;
    m.screen.pixels.set(saved);
    m.screen.version++;
  }

  /**
   * 0x418878: COPILOT SELECTION, and the comms box's pilot changed with the
   * choice (0x4188a3)
   */
  private *choosePilot(): Co {
    const m = this.m;
    const before = this.records.pilot;
    yield* m.fadeOut();
    const pilots = new Pilots(m, this.records, (yield* m.file("pilot", this.day)).data, this.difficulty, this.level);
    this.pilots = pilots.state;
    this.screen = "pilots";
    this.played.push("pilots");
    yield* pilots.run(this.day, this.palette, this.talkState, this.look());
    this.pilots = null;
    this.screen = null;
    if (this.records.pilot !== before) yield* this.comms.load(PILOT, `${PILOTS[this.records.pilot]}.mupp`, this.day);
  }

  /** a screen between the briefings: faded out to, then run (0x414bfc, 0x408a68 …) */
  private *between(name: NonNullable<JumpRaven["screen"]>, run: () => Co): Co {
    yield* this.m.fadeOut();
    this.screen = name;
    this.played.push(name);
    try {
      yield* run();
    } finally {
      this.screen = null;
    }
  }

  /** 0x414bfc: the band */
  private *chooseMusic(): Co {
    const file = (yield* this.m.file("music", this.day)).data;
    yield* this.between("music", () => new Music(this.m, this.band, file).run(this.day, this.palette));
  }

  /** 0x408a68: the day's damage */
  private *damage(): Co {
    const file = (yield* this.m.file("damage", this.day)).data;
    yield* this.between("damage", () => damage(this.m, this.records, file, this.palette));
  }

  /**
   * 0x401000: the debrief — `bata.pupp` for 60% or better, `batb.pupp` under
   * it, between the side panels (0x42696d), then the accuracy and its bonus
   */
  private *debrief(): Co {
    const m = this.m;
    yield* this.briefing(accuracy(this.records.tally) >= BONUS_ACCURACY ? "bata.pupp" : "batb.pupp");
    const file = (yield* m.file("accuracy", this.day)).data;
    this.screen = "accuracy";
    this.played.push("accuracy");
    try {
      yield* accuracyScreen(m, this.records, file, this.palette);
    } finally {
      this.screen = null;
    }
  }

  /**
   * A key's action in RAVEN.SCO's table (0x420efb): the browser's arrows are
   * the Macintosh's 0x1c to 0x1f, a letter or space its own character
   */
  keyAction(key: string): number {
    const code = ({ ArrowLeft: 0x1c, ArrowRight: 0x1d, ArrowUp: 0x1e, ArrowDown: 0x1f } as Record<string, number>)[key] ?? (key.length === 1 ? key.charCodeAt(0) : -1);
    return code >= 0 && code < 0x100 ? this.sco.keys[code] : 0;
  }

  /**
   * Levels 3, 5 and 7: 0x40b190. The city, its modules (src/game/combat/),
   * and after every frame what the frame left (0x40b447): the craft lost —
   * a new one from the Mart while there are lives (`newman.move`), DEADMAN
   * and the high scores when there are none; the PODS bar empty — the pods
   * come down (`pods.move`) and the boss is called in; the boss done — the
   * next level.
   */
  private *flying(): Co<number> {
    const m = this.m;
    this.phase = "flying";
    const city = readFile((yield* m.file("citymaze", this.day)).data);
    const panel = readPanel((yield* m.file("panel", this.day)).data);
    const w = new World(m, readMazeV0(city), this.records, PARAMS[this.difficulty], this.difficulty, this.day);
    const flight = new Flight(m, w, city, panel);
    const hud = yield* assemble(m, w, this.band.value, this.comms, this.hudState);
    flight.hudFrame = () => hud.frame();
    // 0x40ed51: the flight's palette and its flashes are RAVENRES.DLL's (0x85; 0x81, 0x83)
    const dll = yield* m.own("RAVENRES.DLL");
    const base = readClutV0(dll, "CLUT133");
    const cluts: Record<number, Uint8ClampedArray> = { 0x81: readClutV0(dll, "CLUT129"), 0x83: readClutV0(dll, "CLUT131") };
    flight.palettes(base, cluts);
    hud.reset();
    this.flight = flight.state;
    this.played.push("citymaze");
    m.screen.setPalette(base);
    flight.begin();
    /** `[0x4365f8]`: the press that is held began in the view */
    let aiming = false;
    /** 0x40f18d: the events waiting dropped, the held key let go */
    const flush = (): void => {
      while (m.take());
      this.heldKey = null;
      aiming = false;
    };
    try {
      for (;;) {
        for (let e = m.take(); e; e = m.take()) {
          if (e.kind === "key") {
            this.heldKey = e.key;
            flight.key(this.keyAction(e.key), false);
          } else if (e.kind === "up") {
            this.heldKey = null;
            aiming = false;
          } else if (e.kind === "down") {
            // 0x40b1d2: a press in the view aims and fires there; anywhere else is the panels'
            aiming = inRect(VIEW, e.x, e.y);
            if (aiming) w.pyro.aim({ y: e.y - VIEW[0], x: e.x - VIEW[1] }, true);
            else hud.click(e.y, e.x);
          }
        }
        // 0x40b24f: held, the aim follows the pointer, kept inside the view
        if (aiming && m.mouseHeld) {
          const y = Math.min(Math.max(m.pointer.y, VIEW[0]), VIEW[2] - 1);
          const x = Math.min(Math.max(m.pointer.x, VIEW[1]), VIEW[3] - 1);
          w.pyro.aim({ y: y - VIEW[0], x: x - VIEW[1] }, false);
        }
        if (this.heldKey && !m.keysHeld.has(this.heldKey)) this.heldKey = null;
        if (this.heldKey) flight.key(this.keyAction(this.heldKey), true);
        yield* flight.frame();

        if (w.state < -100) {
          const lives = hud.lives();
          if (lives <= 0) {
            // 0x40b55a: no lives left
            yield* m.fadeOut();
            yield* this.film("deadman.move");
            m.clear();
            return HIGH_SCORES;
          }
          // 0x40b469: a new craft, everything full but the tiers, one life fewer, and the Mart
          const score = hud.score();
          const pods = hud.pods();
          hud.zero();
          this.comms.reset();
          for (const r of w.resetList) r.reset();
          hud.addScore(score);
          for (let k = 0; k < 6; k++) hud.setAmmo(k, AMMO_FULL);
          hud.x417fd5(pods);
          hud.addLives(lives - 1);
          hud.addShields(AMMO_FULL);
          hud.addFuel(AMMO_FULL);
          hud.redraw();
          hud.x417d33();
          yield* this.visitMart(2);
          this.comms.reset();
          m.screen.setPalette(base);
          flight.redraw();
          flush();
        } else if (w.state === 1 && hud.pods() <= 0) {
          // 0x40b5b8: the pods come down, the station and the ship go, the boss is called in
          w.state++;
          yield* flight.overView(() => this.film("pods.move"));
          m.screen.setPalette(base);
          w.fuel.reset();
          w.weap.reset();
          hud.x417d33();
          flush();
          hud.redraw();
          flight.redraw();
          hud.x417d70();
        } else if (w.state === 3) {
          // 0x40b60a: the level done
          w.state++;
          hud.x417fd5(AMMO_FULL);
          hud.redraw();
          hud.x417d33();
          flush();
          return this.level + 1;
        }
      }
    } finally {
      this.flight = null;
    }
  }

  /* ---- the high scores screen ------------------------------------------ */

  /** 0x420964 and 0x420c3b: `puppet`'s screen, and the difficulty's places on it */
  private drawScores(): void {
    const m = this.m;
    m.screen.setPalette(this.palette);
    if (!m.draws) return;
    m.screen.spriteAt(this.picture(PUPPET_SCORES), 0, 0);
    const font = m.font;
    if (!font) return;
    const heading = DIFFICULTY_NAMES[this.difficulty - 1];
    m.screen.text(font, 0x7d - (textWidth(font, heading) >> 1), 0x7c, heading, SCORES_INK);
    this.sco.places[this.difficulty - 1].forEach((p, i) => {
      const y = 0x90 + i * 0x11;
      m.screen.text(font, 0x1d, y, p.name, SCORES_INK);
      const score = String(p.score);
      m.screen.text(font, 0xcb - textWidth(font, score), y, score, SCORES_INK);
    });
  }

  /**
   * Level 1, 0x420840: the screen, a name asked for if the last game's score
   * belongs on it (0x420e31), then the buttons until PLAY.
   */
  private *highScores(): Co<number> {
    const m = this.m;
    m.clear();
    const places = this.sco.places[this.difficulty - 1];
    sortPlaces(places);
    this.drawScores();
    if (qualifies(this.sco, this.difficulty, this.records.score) && this.opts.askName) {
      let answer: string | null | undefined;
      this.opts.askName((name) => (answer = name));
      while (answer === undefined) yield;
      if (answer) {
        places[places.length - 1] = { score: this.records.score, name: answer };
        sortPlaces(places);
        this.opts.keepSco?.(writeSco(this.sco));
        this.drawScores();
      }
    }
    for (;;) {
      if (this.newAsked) {
        this.newAsked = false;
        return yield* this.play();
      }
      const e = m.take();
      if (e?.kind === "down") {
        const button = SCORE_BUTTONS.find((b) => e.y >= b.rect[0] && e.y <= b.rect[2] && e.x >= b.rect[1] && e.x <= b.rect[3]);
        if (button && (yield* trackPress(m, button.rect))) {
          const next = yield* this.button(button.what);
          if (next !== null) return next;
        }
      }
      yield;
    }
  }

  /** a button let go on: its film, PLAY's new game or QUIT; null stays on the screen */
  private *button(what: ScoreButton): Co<number | null> {
    const m = this.m;
    m.log(`high scores: ${what.toUpperCase()}`);
    if (what === "play") return yield* this.play();
    if (what === "quit") {
      // File ▸ Exit (0x4222fb(4)): the window closes. A page has nothing to close.
      this.phase = "quit";
      this.stopped = "QUIT: the game is over — reload the page to play again";
      return -1;
    }
    // 0x420ad7: the menu bar down, the screen faded, the film, the screen again
    yield* m.fadeOut();
    yield* this.film(BUTTON_FILMS[what]!);
    m.clear();
    this.drawScores();
    return null;
  }

  /** File ▸ New (0x4222fb(1)): the records afresh (src/game/records.ts), and level 2 */
  private *play(): Co<number> {
    startGame(this.records);
    this.hudState = newHudState();
    yield* this.m.fadeOut();
    return 2;
  }
}

class NotPorted extends Error {}

export { ESCAPE };
