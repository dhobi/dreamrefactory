/**
 * Lunicus, the whole game as far as it is ported: the opening, a new game and
 * the moon base's days. `new Lunicus(files).start()` gives a machine that
 * advances a tick per `tick()`.
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
 * The city, the buildings and the hive (the levels that are no base floor)
 * are not ported: the machine stops there and says so.
 */
import { Base, readBank, readPanel, type Progress } from "./base";
import { Panel, newHud, type Hud } from "./panel";
import { City, DIFFICULTY, placeOf } from "./city/city";
import { readSaveV0, writeSaveV0, type SaveGameV0 } from "@dreamfactory/engine/df/savegame-v0";
import type { MazeView } from "./maze";
import { NEW_GAME_LEVEL, dayOf, floorOf } from "./data";
import { ESCAPE, playFilm } from "./film";
import { readFon } from "./font";
import { Machine, type Co, type GameFiles, type Speaker } from "./machine";

/** the palette resource the base is drawn in: LUNIRES.DLL's CLUT 128 (0x40a988) */
export function readClut(dll: Uint8Array, name: string): Uint8ClampedArray {
  const v = new DataView(dll.buffer, dll.byteOffset, dll.byteLength);
  const pe = v.getUint32(0x3c, true);
  const nsec = v.getUint16(pe + 6, true);
  const opt = pe + 24;
  const secs = Array.from({ length: nsec }, (_, i) => {
    const s = opt + v.getUint16(pe + 20, true) + i * 40;
    return { va: v.getUint32(s + 12, true), size: Math.max(v.getUint32(s + 8, true), v.getUint32(s + 16, true)), raw: v.getUint32(s + 20, true) };
  });
  const off = (rva: number): number => {
    const s = secs.find((x) => rva >= x.va && rva < x.va + x.size);
    if (!s) throw new Error(`rva ${rva} in no section`);
    return rva - s.va + s.raw;
  };
  const root = off(v.getUint32(opt + 96 + 2 * 8, true));
  const nameAt = (o: number): string => String.fromCharCode(...Array.from({ length: v.getUint16(root + o, true) }, (_, i) => v.getUint16(root + o + 2 + i * 2, true)));
  const entries = (dir: number): { id: number | string; to: number }[] => {
    const n = v.getUint16(root + dir + 12, true) + v.getUint16(root + dir + 14, true);
    return Array.from({ length: n }, (_, i) => {
      const id = v.getUint32(root + dir + 16 + i * 8, true);
      return { id: id & 0x80000000 ? nameAt(id & 0x7fffffff) : id, to: v.getUint32(root + dir + 20 + i * 8, true) };
    });
  };
  const type = entries(0).find((e) => e.id === 10);
  const res = type && entries(type.to & 0x7fffffff).find((e) => e.id === name);
  if (!res) throw new Error(`no ${name} in LUNIRES.DLL`);
  const lang = entries(res.to & 0x7fffffff)[0];
  const at = off(v.getUint32(root + lang.to, true));
  const rgba = new Uint8ClampedArray(1024);
  for (let i = 0; i < 256; i++) {
    const e = at + 8 + i * 8;
    rgba[i * 4] = dll[e + 3];
    rgba[i * 4 + 1] = dll[e + 5];
    rgba[i * 4 + 2] = dll[e + 7];
    rgba[i * 4 + 3] = 255;
  }
  return rgba;
}

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
  /** skip the intro and the title: start a new game at once */
  quick?: boolean;
  /** a probe's shortcut: open this level with this progress and HUD, no films before it */
  start?: { level: number; progress?: Partial<Progress>; hud?: Partial<Hud> };
  log?: (line: string) => void;
}

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
    m.speaker.stop();
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
      yield* playFilm(m, "intro.move", 1);
      m.where = "the title: File ▸ New starts a game, File ▸ Open a saved one";
      while (!this.newGameAsked && !this.opened) yield;
    }
    // File ▸ Open: the file's game, not a new one
    if (this.opened) return this.applyOpened();
    Object.assign(this.progress, { level: NEW_GAME_LEVEL, came: 1, elevator: 0, day: 0, suit: false, weapon: false });
    Object.assign(this.hud, newHud());
    this.phase = "opening";
    m.speaker.stop();
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

    if (this.opts.start) {
      Object.assign(this.progress, { came: 1, elevator: 0, day: 0 }, this.opts.start.progress, { level: this.opts.start.level });
      Object.assign(this.hud, this.opts.start.hud);
    } else yield* this.title(!this.opts.quick);

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
        if (this.won && !this.wonTold) (this.wonTold = true), m.log("the queen is dead, the game is won: back to the title");
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
        this.stopped = `level ${level} (day ${dayOf(level)}'s ${placeOf(level) === 2 ? "engine rooms" : "hive"}) is not ported`;
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
