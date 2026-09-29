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

export type Phase = "boot" | "story" | "scores" | "not-ported" | "quit";

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
}

/**
 * What a game holds between its levels, as RAVEN.EXE keeps it in `0x437888`…
 * and around. The flying is not ported, so most of it is only ever set.
 */
export interface Records {
  /** `[0x43788c]`: the score; a new game starts it at 1000 (0x42232b) */
  score: number;
  /** `[0x43b300]`: the pilot, 0 to 5 — which `trans<n>.move` ends the game (0x4268b3) */
  pilot: number;
}

export class JumpRaven {
  readonly m: Machine;
  phase: Phase = "boot";
  /** `[0x43b2fc]` */
  level = OPENING;
  /** `[0x439fb0]`: Settings ▸ Training … Expert */
  difficulty = DEFAULT_DIFFICULTY;
  readonly records: Records = { score: 0, pilot: 0 };
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
    const look: TalkLook = { menuBackdrop: m.draws ? this.picture(PUPPET_MENU) : null, ink: TALK_INK, pressed: TALK_PRESSED, faceWidth: FACE_WIDTH, faceLeft: FACE_LEFT };
    yield* talk(m, file, this.day, this.talkState, look);
    m.clear();
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
    const mart = () => this.notPorted("the Mart", "0x410540");
    const pilots = () => this.notPorted("choosing the pilot", "0x418878");
    const gangs = () => this.notPorted("the screen after bat4", "0x414bfc");
    const orders = () => this.notPorted("the screen after bate", "0x408a68");
    const debrief = () => this.notPorted("the debrief", "0x401000");
    const briefings = steps([b("bat1.pupp"), f("enem.move"), b("bat2.pupp"), mart, b("bat3.pupp"), pilots, b("bat4.pupp"), gangs, b("bat5.pupp"), f("trans.move")]);
    const back = steps([f("drop.move"), b("batg.pupp"), f("anim.move"), b("bate.pupp"), orders, debrief]);
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

  /** levels 3, 5 and 7: 0x40b190 */
  private *flying(): Co<number> {
    return this.notPorted(`the flying, day ${this.day}`, "0x40b190");
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

  /** File ▸ New (0x4222fb(1)): the records afresh, and level 2 */
  private *play(): Co<number> {
    this.records.score = 1000;
    this.records.pilot = 0;
    yield* this.m.fadeOut();
    return 2;
  }
}

class NotPorted extends Error {}

export { ESCAPE };
