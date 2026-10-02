/**
 * Lunicus, the whole game: the opening, a new game, the moon base's floors, the
 * cities and their buildings, the engine rooms and the hive. `new
 * Lunicus(files).start()` gives a machine that advances a tick per `tick()`.
 *
 * ## The run (LUNICUS.EXE)
 *
 *   window setup   0x416ee5: `intro.move` (0x416fe8), which chains to the
 *                  title, `flip.move`, where the game waits for File ▸ New
 *   File ▸ New     0x4184ec: level 2, progress cleared; closing the title for
 *                  level 2 plays `first.move` (0x4172ef)
 *   a level        0x40bed8: the old level is closed, the day's folder set
 *                  from the level, and the new one opened with the old one's
 *                  number — a base floor is `Base`
 *
 * A level that is neither a base floor nor a place (`placeOf`) is no level the
 * game has: 3 and 4, which nothing reaches and only a hand-made `.LUN` can
 * name. The machine stops there and says so.
 */
import { Base, readBank, readPanel, type Progress } from "./base";
import { Panel, newHud, type Hud } from "./panel";
import { City, DIFFICULTY, placeOf } from "./city/city";
import { readSaveV0, writeSaveV0, type SaveGameV0 } from "@dreamfactory/engine/df/savegame-v0";
import type { MazeView } from "./maze";
import { NEW_GAME_LEVEL, dayOf, floorOf } from "./data";
import { ESCAPE, playFilm } from "@dreamfactory/engine/v0/film";
import { readFon, textWidth } from "@dreamfactory/engine/v0/font";
import { Machine, type Co, type GameFiles, type Speaker } from "./machine";
import { readContainerFile } from "@dreamfactory/engine/df/container";
import { decodeFrameV0, type FrameV0 } from "@dreamfactory/engine/df/image-v0";
import { readClutV0 as readClut } from "@dreamfactory/engine/df/clut-v0";
import { ACTIONS, bindKeys, defaultTable, enter, keyFor, qualifies, readSco, writeSco } from "./sco";

/** the plate's top: under the title's 264 rows (0x417249) */
const PLATE_TOP = 0x108;
/** the pen's colour on the plate: `_portpennormal` leaves it palette index 0 (LUNIRES.DLL 0x401cfd) */
const SCORE_INK = 0;

export type Phase = "boot" | "title" | "opening" | "base" | "city" | "not-ported" | "over";

export interface LunicusOptions {
  speaker?: Speaker;
  seed?: number;
  /** false skips decoding pictures, for a test that only follows the game */
  draws?: boolean;
  /**
   * The save button's dialog (0x4187b3): the page stores the file, and calls
   * `done` when the player has saved or not. The level waits till then, as the
   * EXE's own dialog made it wait.
   */
  saver?: (bytes: Uint8Array, name: string, done: () => void) => void;
  log?: (line: string) => void;
  /** LUNICUS.SCO as the page kept it (1040 bytes, src/game/sco.ts); none is the defaults */
  sco?: Uint8Array;
  /**
   * Where the block goes once it has changed — the Keys dialog's OK, a high
   * score put in. The EXE wrote it as its window closed (0x417ce4); a page is
   * not told it is closing, so it is kept at once.
   */
  keepSco?: (bytes: Uint8Array) => void;
  /**
   * Settings ▸ Keys (dlog3, 0x418b72): the seven fields as the table has them,
   * in `ACTIONS` order, and what Default puts in them; `done` with the fields
   * at OK, or null for Cancel. The game waits till then.
   */
  keysDialog?: (fields: string[], defaults: string[], done: (fields: string[] | null) => void) => void;
  /** the high-score dialog (dlog2, 0x4189c1): `done` with the name, or null for Cancel or none */
  askName?: (done: (name: string | null) => void) => void;
}

/** LUNIRES.DLL's strings 129–132 and 127 (0x417b2b): the title's heading for each difficulty */
const SCORES_HEADING = ["Beginner Scores", "Intermediate Scores", "Advanced Scores", "Expert Scores"];

export class Lunicus {
  readonly m: Machine;
  phase: Phase = "boot";
  readonly progress: Progress = { level: 0, came: 0, elevator: 0, day: 0, suit: false, weapon: false, difficulty: DIFFICULTY };
  readonly hud: Hud = newHud();
  base: Base | null = null;
  city: City | null = null;
  /** the queen is dead */
  won = false;
  private wonTold = false;
  /** how often the player has died: each death is the title again */
  deaths = 0;
  /** why the machine stopped, when it did */
  stopped = "";
  private run: Co | null = null;
  private newGameAsked = false;

  constructor(files: GameFiles, private readonly opts: LunicusOptions = {}) {
    this.m = new Machine(files, opts.speaker, opts.seed ?? 1994, opts.draws ?? true, opts.log);
    if (opts.sco) {
      try {
        this.m.sco = readSco(opts.sco);
      } catch (e) {
        this.m.log(`lunicus.sco: ${String(e)}; the defaults instead`);
      }
    }
    this.m.keysDialog = () => this.keys();
  }

  /** a File ▸ Open waiting for the level to let go (0x4184cc, case 2) */
  private opened: SaveGameV0 | null = null;

  /**
   * File ▸ Open: a `.LUN` file's game. From the title it starts at once; in a
   * level, as soon as the level is between one thing and the next.
   */
  openGame(bytes: Uint8Array): void {
    this.opened = readSaveV0(bytes);
    this.m.log(`File ▸ Open: level ${this.opened.level}, progress ${this.opened.progress}, score ${this.opened.score}`);
    if (this.phase === "title") this.m.events.push({ kind: "key", key: ESCAPE });
    if (this.base) this.base.next = this.opened.level;
    if (this.city) this.city.next = this.opened.level;
  }

  /** 0x417944: the game as the save button writes it */
  saveBytes(): Uint8Array {
    const p = this.progress;
    const h = this.hud;
    return writeSaveV0({
      difficulty: p.difficulty, level: p.level, came: p.came, elevator: p.elevator, progress: p.day,
      score: h.score, enemies: h.enemies, energy: h.energy, shields: h.shields, bullets: h.bullets, grenades: h.grenades, rockets: h.rockets,
    });
  }

  /**
   * 0x4175c3, the save button's half: the effects and the ambience silenced,
   * the dialog (0x4187b3) and the file written (0x417944), and navigation.
   */
  private *saveDialog(ui: Panel, clut: Uint8ClampedArray): Co {
    const m = this.m;
    ui.draw();
    m.stopSound();
    m.stopAmbience();
    m.screen.setPalette(clut);
    const name = `Day ${dayOf(this.progress.level)}`;
    if (!this.opts.saver) m.log("the save button: nowhere to save to");
    else {
      let done = false;
      m.log(`the save button: ${name}`);
      this.opts.saver(this.saveBytes(), name, () => (done = true));
      while (!done) yield;
    }
    this.hud.mode = 2;
    ui.draw();
    m.playAmbience();
  }

  /** 0x4184cc, case 2: the HUD emptied and the file's numbers put in it, and its level */
  private applyOpened(): void {
    const s = this.opened!;
    this.opened = null;
    Object.assign(this.hud, newHud());
    const g = (n: number): number => Math.max(0, Math.min(10000, n));
    Object.assign(this.hud, { score: s.score, shields: g(s.shields), energy: g(s.energy), enemies: g(s.enemies), bullets: g(s.bullets), grenades: g(s.grenades), rockets: g(s.rockets), mode: 2 });
    Object.assign(this.progress, { difficulty: s.difficulty, came: s.came, elevator: s.elevator, day: s.progress, level: s.level, suit: false, weapon: false });
    this.m.log(`opened: level ${s.level}, progress ${s.progress}`);
  }

  /**
   * The title is up — `flip.move`, round and round (0x416ec8, message 2 on):
   * the one time the EXE's window has its menu bar. It hides it for the intro,
   * for Help and About, and for the whole of a game (0x418701), when only the
   * accelerators reach it.
   */
  get titleUp(): boolean {
    return this.phase === "title" && this.m.film === "flip.move" && !this.aside && !this.asking;
  }
  /** a dialog of the page's is up: the EXE's were modal, and the bar came up after (0x4170f7) */
  private asking = false;
  /** the title's message 2 is still to come: the plate drawn, a high score asked for */
  private titleOpened = false;
  /** Settings ▸ Keys, asked for on the title */
  private titleKeys = false;
  /** puppet picture 1 (0x417039), the plate under the title */
  private plate: FrameV0 | null = null;
  /** Help ▸ About or Help playing over the title */
  private aside = false;
  /** Help ▸ About or Help ▸ Help, asked for on the title */
  private titleFilm: string | null = null;

  /**
   * A menu command by its Win32 id (src/menu.gen.ts), as WM_COMMAND posts it
   * (0x40b80a): menu 2–5 by the hundreds, anything else menu 1 (Help) from 600,
   * and the item the rest. Answers false for the two the page does itself —
   * File ▸ Open's dialog and File ▸ Exit from the title.
   *
   * Sound and Theme take effect at once, in a film too (0x4174f6 hears their
   * keys there). The rest go to the state: the title's handler (0x418446) takes
   * them all; a level's (0x417412) only Save, Exit, Keys, Cache Mazes and Help,
   * between one thing and the next.
   */
  command(id: number): boolean {
    const menu = id >= 200 && id < 600 ? Math.floor(id / 100) : 1;
    const item = id - (menu === 1 ? 600 : menu * 100);
    const m = this.m;
    if (menu === 5) {
      if (item >= 1 && item <= 8) m.setVolume(item - 1), m.log(`Sound ▸ ${item === 1 ? "Sound Off" : `Sound Level ${item - 1}`}`);
      if (item === 10) m.setTheme(!m.theme), m.log(`Sound ▸ Theme ${m.theme ? "on" : "off"}`);
      return true;
    }
    if (menu === 4 && item === 7) return (m.cacheMazes = !m.cacheMazes), true;
    if (menu === 4 && item === 6) {
      if (this.phase === "title") this.titleKeys = true;
      else if (this.base || this.city) m.commands.push({ menu, item });
      return true;
    }
    if (this.phase === "title") {
      if (menu === 2 && item === 1) this.newGame();
      if (menu === 2 && (item === 2 || item === 4)) return false;
      // 0x41784b: the difficulty is read as a level opens (0x417f1b)
      if (menu === 4 && item >= 1 && item <= 4) {
        this.progress.difficulty = item;
        m.log(`Settings ▸ difficulty ${item}`);
        // 0x417893: the plate's places are that difficulty's
        if (this.titleOpened) this.drawScores();
      }
      if (menu === 1 && (item === 1 || item === 2) && this.titleUp) this.titleFilm = item === 1 ? "about.move" : "help.move";
      return true;
    }
    if ((this.base || this.city) && ((menu === 2 && (item === 3 || item === 4)) || (menu === 1 && item === 2))) m.commands.push({ menu, item });
    return true;
  }

  /** 0x417760: Help ▸ About or Help on the title — the bar hidden, a fade, the film, the title again */
  private *titleAside(name: string): Co {
    const m = this.m;
    const pixels = m.screen.pixels.slice();
    const palette = m.screen.palette.slice();
    const film = m.film;
    this.aside = true;
    m.log(`Help ▸ ${name === "about.move" ? "About Lunicus" : "Help"}`);
    m.stopSound();
    yield* m.fadeOut();
    yield* playFilm(m, name, 1);
    m.film = film;
    m.screen.setPalette(palette.map(() => 0));
    m.screen.pixels.set(pixels);
    yield* m.fadeIn(palette);
    this.aside = false;
  }

  /**
   * What the title does between its film's frames, once `flip.move` is up: the
   * title's message 2 first (0x417003 — the plate, a high score), then the
   * dialogs and films the menu bar asked for.
   */
  private titleTick(): Co | null {
    if (this.m.film !== "flip.move") return null;
    if (!this.titleOpened) {
      this.titleOpened = true;
      this.drawScores();
      return this.highScore();
    }
    if (this.titleKeys) {
      this.titleKeys = false;
      return this.keys();
    }
    const film = this.titleFilm;
    this.titleFilm = null;
    return film ? this.titleAside(film) : null;
  }

  /**
   * 0x417135 and 0x417b01: the band under the title's picture — the Cyberflix
   * plate, and on its blank half the difficulty's seven places in Raven Digital
   * (LUNIRES.DLL's font 0x3a16, 0x401d8b), heading centred on x 427, names at
   * x 358 and scores ending at x 497, a row every 13 pixels.
   */
  drawScores(): void {
    const m = this.m;
    if (!this.plate || !m.font) return;
    const s = m.screen;
    const font = m.font;
    s.put(this.plate.indexed, this.plate.width, this.plate.height, PLATE_TOP, 0);
    const heading = SCORES_HEADING[this.progress.difficulty - 1];
    s.text(font, 0x1ab - (textWidth(font, heading) >> 1), 0x119, heading, SCORE_INK);
    m.sco.scores[this.progress.difficulty - 1].forEach((p, i) => {
      const y = 0x127 + i * 0xd;
      s.text(font, 0x166, y, p.name, SCORE_INK);
      const score = String(p.score);
      s.text(font, 0x1f1 - textWidth(font, score), y, score, SCORE_INK);
    });
  }

  /** 0x41733d, as the title opens: a score past the seventh place, the name asked for and put in */
  private *highScore(): Co {
    const m = this.m;
    const d = this.progress.difficulty;
    const score = this.hud.score;
    if (!qualifies(m.sco, d, score)) return;
    m.log(`a high score: ${score}, ${SCORES_HEADING[d - 1]}`);
    if (!this.opts.askName) return m.log("  no one to ask for a name");
    let name: string | null | undefined;
    this.asking = true;
    this.opts.askName((n) => (name = n));
    while (name === undefined) yield;
    this.asking = false;
    // 0x418af9: OK with no name is Cancel
    if (!name) return m.log("  no name: not put in");
    enter(m.sco, d, { score, name });
    m.log(`  "${name}" put in`);
    this.keepSco();
    this.drawScores();
  }

  /**
   * 0x418b50: Settings ▸ Keys. In a game the sound stops for it and the
   * ambience comes back after (0x417495); on the title the film waits.
   */
  private *keys(): Co {
    const m = this.m;
    const ask = this.opts.keysDialog;
    if (!ask) return m.log("Settings ▸ Keys: no dialog to show");
    const game = this.phase !== "title";
    if (game) m.stopSound(), m.stopAmbience();
    const fields = ACTIONS.map((_, i) => keyFor(m.sco.keys, i + 1));
    const defaults = ACTIONS.map((_, i) => keyFor(defaultTable(), i + 1));
    let answer: string[] | null | undefined;
    this.asking = true;
    ask(fields, defaults, (f) => (answer = f));
    while (answer === undefined) yield;
    this.asking = false;
    if (answer) {
      m.sco.keys = bindKeys(answer);
      m.log(`Settings ▸ Keys: ${ACTIONS.map((a, i) => `${a} ${keyFor(m.sco.keys, i + 1) || "-"}`).join(", ")}`);
      this.keepSco();
    }
    if (game) m.playAmbience();
  }

  private keepSco(): void {
    this.opts.keepSco?.(writeSco(this.m.sco));
  }

  /** File ▸ New, from the title */
  newGame(): void {
    this.newGameAsked = true;
    // the title film waits on the menu bar; File ▸ New ends it
    if (this.phase === "title") this.m.events.push({ kind: "key", key: ESCAPE });
  }

  /** one tick; false once the machine has stopped */
  tick(): boolean {
    if (!this.run) this.run = this.main();
    if (this.phase === "over" || this.phase === "not-ported") return false;
    this.m.ticks++;
    const r = this.run.next();
    if (r.done && (this.phase as Phase) !== "not-ported") this.phase = "over";
    return !r.done;
  }

  /**
   * Level 0 (0x416ec8): the intro chaining to the title, until File ▸ New —
   * then a new game (0x4184ec), the title closing for level 2 (0x4172ef).
   */
  private *title(intro: boolean): Co {
    const m = this.m;
    this.newGameAsked = false;
    if (intro) {
      this.phase = "title";
      m.stopAmbience();
      this.titleOpened = false;
      yield* playFilm(m, "intro.move", 1, { aside: () => this.titleTick() });
      // the site's escape key ends the intro's whole chain; the title is still the title
      while (!this.newGameAsked && !this.opened) yield* playFilm(m, "flip.move", 1, { aside: () => this.titleTick() });
      m.where = "the title: File ▸ New starts a game, File ▸ Open a saved one";
      while (!this.newGameAsked && !this.opened) yield;
    }
    // File ▸ Open: the file's game, not a new one
    if (this.opened) return this.applyOpened();
    Object.assign(this.progress, { level: NEW_GAME_LEVEL, came: 1, elevator: 0, day: 0, suit: false, weapon: false });
    Object.assign(this.hud, newHud());
    this.phase = "opening";
    m.stopSound();
    yield* playFilm(m, "first.move", 1);
  }

  private *main(): Co {
    const m = this.m;
    const { data: fon } = yield* this.lunicusFile("lunicus.fon");
    m.font = readFon(fon);
    const { data: dll } = yield* this.lunicusFile("lunires.dll");
    const clut = readClut(dll, "CLUT128");
    const cluts = Object.fromEntries([129, 130, 131, 132, 133, 134, 135].map((n) => [`CLUT${n}`, readClut(dll, `CLUT${n}`)]));
    const panel = readPanel((yield* m.file("panel", 1)).data);
    const bank = readBank((yield* m.file("moonsound", 1)).data);
    // read whether or not it is drawn, so a drawing page and a headless run read the same files at the same ticks
    const puppet = (yield* m.file("puppet", 1)).data;
    if (m.draws) this.plate = decodeFrameV0(readContainerFile(puppet).containers[1].data);

    yield* this.title(true);

    const ui = new Panel(m, this.hud, panel, () => dayOf(this.progress.level));
    ui.save = () => this.saveDialog(ui, clut);
    /** the level before this one (0x40684f is told it) */
    let prev = 0;
    /** the last combat level's maze: a level opened again from itself goes on with it */
    let kept: MazeView | null = null;
    for (;;) {
      const level = this.progress.level;
      if (level === 0) {
        // level 0 is the title (0x416ec8): the intro again, and File ▸ New
        if (m.quitAsked) m.quitAsked = false;
        else if (this.won && !this.wonTold) (this.wonTold = true), m.log("the queen is dead, the game is won: back to the title");
        else this.deaths++, m.log("the player died: back to the title");
        this.city = null;
        this.base = null;
        prev = 0;
        kept = null;
        yield* this.title(true);
        continue;
      }
      if (floorOf(level)) {
        this.phase = "base";
        this.city = null;
        const base = new Base(m, this.progress, this.hud, ui, clut, bank);
        this.base = base;
        yield* base.open(prev);
        this.progress.level = yield* base.run();
        if (this.opened) (this.applyOpened(), (kept = null));
      } else if (placeOf(level)) {
        this.phase = "city";
        this.base = null;
        const day = dayOf(level);
        const city = new City(m, this.progress, ui, clut, cluts, { get: function* (name) { return (yield* m.file(name, day)).data; } });
        this.city = city;
        yield* city.open(prev, kept);
        this.progress.level = yield* city.run();
        kept = city.world.maze;
        if (this.opened) (this.applyOpened(), (kept = null));
        if (city.won) this.won = true;
      } else {
        this.phase = "not-ported";
        this.city = null;
        this.stopped = `level ${level} is neither a base floor nor a place in the city — no level the game has`;
        m.log(this.stopped);
        return;
      }
      prev = level;
      m.log(`→ level ${this.progress.level}`);
    }
  }

  /** a file of the game's own folder, `lunicus/` */
  private *lunicusFile(name: string): Co<{ data: Uint8Array }> {
    const path = `lunicus/${name}`;
    for (;;) {
      const data = this.m.files.get(path);
      if (data) return { data };
      if (!this.m.files.has(path)) throw new Error(`${path} is not in the rip`);
      this.m.files.want(path);
      yield;
    }
  }
}
