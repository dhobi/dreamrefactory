/**
 * A city or building level — LUNICUS.EXE's 0x406240, which the level
 * dispatcher (0x40ad60) sends the city's and the buildings' events to.
 *
 * ## Opening (0x40684f)
 *
 * The city's maze is `citymaze`, stood in at (3,0) facing east; a building's
 * is `buildmaze`, at (7,14) facing north, the same maze on every floor. The
 * tank, the jeep and the wasp (the node, once the ENEMIES bar is empty) come
 * in round the player, the cabinets are stocked with two of each thing, and
 * the city says which city it is (ENTERING: LOS ANGELES on day 2).
 *
 * ## A frame (0x407260)
 *
 * Every three ticks, and every frame of a step or a turn: the tank's shells,
 * the tank, the jeep's, the jeep, the wasp's, the wasp, the drones, the player's shots,
 * the gun in the hand — then the pictures farthest first over the view.
 *
 * ## The way out
 *
 * `[0x42d110]` 1 — the node destroyed — plays `cityrise.move` and goes to the
 * day's upper floor with the progress at 3; 2 — the player dead — goes back to
 * the title. A building's door takes its elevator between its five floors, and
 * down from the first to the street (0x401c84).
 *
 * ## The engine rooms (day 5, levels 19 and 20)
 *
 * `engin1maze` and `engin2maze`, stood in at (6,12) facing north, indoors —
 * no node, only the ENEMIES bar to empty. Their elevator (0x4018db) goes
 * nowhere up, and down to the other room until the bar is empty; then down to
 * the hive (`tohive.move`, level 21), everything full again.
 *
 * ## The hive and the final chamber (day 6, levels 21 and 22)
 *
 * `hivemaze` and `finalmaze` at (7,14) facing north, under a ceiling of 0x1ae.
 * The hive's elevator (0x402243) rides and brings the player back to the hive
 * with its cabinets full while the ENEMIES bar has anything left, and with it
 * empty goes down to the final chamber, where the bar is full again. Its bar
 * emptied, the queen (0x402061) ends the game: `finalin.move`, `trans.move`,
 * her talk (`queen.1`), `final.move`, and the title.
 *
 * ## A level opened again from itself
 *
 * A building's next floor, an engine room's elevator ride, the hive's: the
 * level is the same, and the EXE does not read its maze again (0x4068b5) — a
 * cabinet emptied on one floor is empty on the next. The city's is read every
 * time.
 */
import { decodeFrameV0, type FrameV0 } from "@dreamfactory/engine/df/image-v0";
import { readContainerFile } from "@dreamfactory/engine/df/container";
import { BAR_FULL, FORWARD, FRAME_TICKS, LEFT, RIGHT, SCREEN_W, VIEW_H, VIEW_W, WALK_RECTS, dayOf } from "../data";
import { playFilm, type FilmHooks } from "@dreamfactory/engine/v0/film";
import type { Co, Machine } from "../machine";
import { INDOORS, MazeView, OUTDOORS, camera, moved } from "../maze";
import { Panel } from "../panel";
import type { Progress } from "../base";
import { inRect, type Rect } from "@dreamfactory/engine/v0/screen";
import { talk, type TalkState } from "@dreamfactory/engine/v0/talk";
import { combatParams } from "./params";
import { JEEP, TANK, Vehicle } from "./vehicle";
import { Drone, dronesTarget } from "./drone";
import { Wasp } from "./wasp";
import { Weapons, type Target } from "./weapons";
import { World } from "./world";

const VIEW: Rect = [0, 0, VIEW_H, VIEW_W];

/** 0x40a4d4: 4 the city, 1 a building, 2 the engine rooms, 3 the hive */
export function placeOf(level: number): number {
  return [0, 0, 0, 0, 0, 0, 0, 4, 1, 0, 0, 4, 1, 0, 0, 4, 1, 0, 0, 2, 2, 3, 3][level] ?? 0;
}

/** 0x40a489: the first (1) or second (2) of a pair — a building, an engine room, the hive or the final chamber */
export function roomOf(level: number): number {
  if ([8, 12, 16, 19, 21].includes(level)) return 1;
  return [20, 22].includes(level) ? 2 : 0;
}

/** 0x40a50b: which bank a level plays — 1 the base's, 2 … 4 the cities', 5 the engine rooms', 6 the hive's */
export function bankOf(level: number): number {
  return [0, 1, 1, 0, 0, 1, 1, 2, 2, 1, 1, 3, 3, 1, 1, 4, 4, 1, 1, 5, 5, 6, 6][level] ?? 0;
}

/** 0x40a4b2: a level of this mode — a city, a building, an engine room or the hive */
export function combatLevel(level: number): boolean {
  return [7, 8, 11, 12, 15, 16].includes(level) || (level >= 19 && level <= 22);
}

/** the cell beside `x`, `y` the way a pose's `dir` faces */
function cellAhead(x: number, y: number, dir: number): [number, number] {
  if (dir === 0) return [x, y - 1];
  if (dir === 1) return [x, y + 1];
  if (dir === 2) return [x + 1, y];
  return [x - 1, y];
}

const pictures = (data: Uint8Array): FrameV0[] => readContainerFile(data).containers.map((c) => decodeFrameV0(c.data));

export interface CityFiles {
  /** by the game's names; `citysound` is the bank */
  get(name: string): Co<Uint8Array>;
}

/** the difficulty, `[0x42c15c]`: Intermediate unless the settings say otherwise */
export const DIFFICULTY = 2;

export class City {
  world!: World;
  tank!: Vehicle;
  jeep!: Vehicle;
  wasp!: Wasp;
  /** 0x429f90: `day − 2` of them, none before day three (0x40374c) */
  drones: Drone[] = [];
  weapons!: Weapons;
  private readonly view = new Uint8Array(VIEW_W * VIEW_H);
  private lastPresent = -FRAME_TICKS;
  /** set by whatever ends the level: the level to go to */
  next: number | null = null;
  busy = false;
  films: string[] = [];
  /** `[0x42bcb8]` the player's death, a step a frame */
  private dying = 0;
  /** `[0x429f20]` … the cabinets' stock and what the last one gave */
  stock = [2, 2, 2, 2, 2, 2];
  private item = -1;
  private jammed = false;
  /** the queen's talk, as the base's (0x415000) */
  readonly talkState: { talk: TalkState | null } = { talk: null };
  /** the game is won: the next level, 0, is the title */
  won = false;
  /** `[0x429f28]` the byte of the cell last used */
  private lastByte = 0;
  /** `[0x429f24]` which way the elevator was asked to go: 0 up */
  private elevatorDown = 0;

  constructor(
    readonly m: Machine,
    readonly p: Progress,
    readonly panel: Panel,
    readonly clut: Uint8ClampedArray,
    readonly cluts: Record<string, Uint8ClampedArray>,
    readonly load: CityFiles,
  ) {}

  get day(): number {
    return dayOf(this.p.level);
  }
  get building(): boolean {
    return placeOf(this.p.level) !== 4;
  }
  get hud() {
    return this.panel.hud;
  }

  /** 0x40684f */
  *open(prev: number, kept: MazeView | null = null): Co {
    const { m, p } = this;
    const building = this.building;
    const place = placeOf(p.level);
    const first = roomOf(p.level) === 1;
    const name = [undefined, "buildmaze", first ? "engin1maze" : "engin2maze", first ? "hivemaze" : "finalmaze", "citymaze"][place]!;
    // a level opened again from itself keeps its maze as it was, emptied cabinets and all; the city's is always read afresh
    const reuse = !!kept && place !== 4 && prev === p.level && kept.name === name;
    const maze = reuse ? kept! : new MazeView(name, yield* this.load.get(name));
    // 0x4069cb: the final chamber's four cells round the queen's do nothing
    if (!reuse && name === "finalmaze") for (const [x, y] of [[7, 6], [6, 7], [7, 8], [8, 7]]) for (let dir = 0; dir < 4; dir++) maze.setByte({ x, y, dir }, 0);
    const sounds = readContainerFile(yield* this.load.get("citysound")).containers.map((c) => c.data);
    // 0x406b70: a new bank — from the base, or from another day's place — and its ambience
    if (bankOf(prev) !== bankOf(p.level)) {
      m.setAmbience("citysound", sounds);
      m.playAmbience();
    }
    const w = new World(m, maze, combatParams(p.difficulty, this.day), this.hud, p.level, this.day, building, sounds, this.cluts);
    if (place === 3) w.ceiling = 0x1ae;
    else w.ceiling = building ? 0x1a4 : 10000;
    w.pyro = pictures(yield* this.load.get("pyro"));
    if (place === 2) w.pose = { x: 6, y: 12, dir: 0 };
    else if (place === 3 || building) w.pose = { x: 7, y: 14, dir: 0 };
    else w.pose = { x: 3, y: 0, dir: 2 };
    w.target = { ...w.pose };
    w.cam = camera(w.pose, w.pose.dir, 0, FORWARD, building ? INDOORS : OUTDOORS);
    this.world = w;
    const io = building ? ".in" : ".out";
    this.tank = new Vehicle(w, TANK, pictures(yield* this.load.get(`tank${io}`)), w.pyro);
    this.jeep = new Vehicle(w, JEEP, pictures(yield* this.load.get(`jeep${io}`)), w.pyro);
    this.tank.other = this.jeep;
    this.jeep.other = this.tank;
    this.wasp = new Wasp(w, pictures(yield* this.load.get(`wasp${io}`)), pictures(yield* this.load.get("node")));
    const targets: Target[] = [
      { hit: (s, d) => this.tank.hit(s, d), at: () => this.tank.o },
      { hit: (s, d) => this.jeep.hit(s, d), at: () => this.jeep.o },
      this.wasp,
    ];
    const drones = Math.min(4, Math.max(0, this.day - 2));
    if (drones) {
      const frames = pictures(yield* this.load.get(`drone${io}`));
      this.drones = Array.from({ length: drones }, () => new Drone(w, frames, [this.tank, this.jeep]));
      targets.push(dronesTarget(this.drones));
    }
    this.weapons = new Weapons(w, pictures(yield* this.load.get(building ? "hand" : "play")), targets);
    this.tank.spawn();
    this.jeep.spawn();
    this.wasp.spawn();
    for (const d of this.drones) d.spawn();
    // 0x40688e, 0x406a5a: the side panel's picture, 0x12 indoors and 0x11 the city
    this.panel.side = { picture: building ? 0x12 : 0x11 };
    // 0x4076ef: the jeep, the tank, the wasp, then the drones as dots
    this.panel.radar = () => ({
      cam: w.cam,
      blips: [this.jeep.o, this.tank.o, this.wasp.o].map((o) => ({ x: o.x, y: o.y, dot: false })).concat(this.drones.map((d) => ({ x: d.o.x, y: d.o.y, dot: true }))),
      nodeOut: w.radarOn,
    });
    this.stockUp();
    const rest = maze.restFrame(w.pose);
    if (rest < 0) throw new Error(`${name}: no view at ${JSON.stringify(w.pose)}`);
    this.rest = rest;
    this.showFrame(rest);
    m.screen.setPalette(this.clut);
    this.panel.draw();
    m.log(`${name} (level ${p.level}, day ${this.day}): at ${w.pose.x},${w.pose.y}; tank ${this.tank.o.cellX},${this.tank.o.cellY} jeep ${this.jeep.o.cellX},${this.jeep.o.cellY} ${this.wasp.wasp ? "wasp" : "node"} ${this.wasp.o.cellX},${this.wasp.o.cellY}`);
    yield* this.frame();
    // 0x40a4b2: ENTERING … when the level before was not one of these
    if (!combatLevel(prev)) this.panel.say(0x2c + this.day);
  }

  private rest = -1;

  private showFrame(container: number): void {
    const px = this.world.maze.draw(container, this.m.draws);
    if (px) this.view.set(px.subarray(0, VIEW_W * VIEW_H));
  }

  /** a frame of everything (0x407260), three ticks after the last */
  *frame(): Co {
    const w = this.world;
    w.draws = [];
    w.said = [];
    this.tank.shellsFrame();
    this.tank.frame();
    this.jeep.shellsFrame();
    this.jeep.frame();
    this.wasp.shellsFrame();
    this.wasp.frame();
    for (const d of this.drones) d.frame();
    this.weapons.frame();
    const handFrom = w.draws.length;
    if (this.hud.energy > 0) this.weapons.draw();
    else this.death();
    for (const n of w.said) this.panel.say(n);
    if (this.m.draws) {
      const s = this.m.screen;
      const paint = (list: typeof w.draws): void => {
        list.sort((a, b) => b.depth - a.depth);
        for (const d of list) {
          if (d.mirror) s.spriteMirrored(d.frame, d.y, d.x, d.clip);
          else s.sprite(d.frame, d.y, d.x, d.clip);
        }
      };
      // 0x40739c: a shake. 1 and 2 paint the view's top 8 or 16 rows black over the frame;
      // 3 and 4 leave the last frame's picture up, this one's pictures dropped; 5 and 6 draw the hand again over it
      if (w.shake >= 3) {
        if (w.shake >= 5) paint(w.draws.slice(handFrom));
        s.version++;
      } else {
        s.put(this.view, VIEW_W, VIEW_H, 0, 0);
        paint(w.draws);
        if (w.shake) for (let y = 0; y < (w.shake === 2 ? 16 : 8); y++) s.pixels.fill(0xff, y * SCREEN_W, y * SCREEN_W + VIEW_W);
      }
    }
    w.shake = 0;
    if (w.flash) {
      this.m.screen.setPalette(w.flash.clut);
      if (++w.flash.frames > w.flash.hold) {
        w.flash = null;
        this.m.screen.setPalette(this.clut);
      }
    }
    while (this.m.ticks < this.lastPresent + FRAME_TICKS) yield;
    this.lastPresent = this.m.ticks;
    this.panel.draw();
    this.panel.tick();
  }

  /** 0x413dcd: the player's death, three explosions over the view */
  private death(): void {
    const w = this.world;
    const s = this.dying;
    const at: [number, number, boolean][] = [[0xfa, 0x70, false], [0xc8, 0xc0, true], [0xe1, 0x110, false]];
    if (s === 0) w.flashWith("CLUT129", 1, 1);
    else if (s >= 1 && s <= 6) {
      if (s === 1) {
        w.sound(5);
        w.flashWith("CLUT129", 1, 2);
      }
      const base = 35 - (s - 1);
      at.forEach(([y, x, mirror], k) => w.addFixed(VIEW, 0, y, x, w.pyro[base - [0, 2, 1][k]], mirror));
    } else if (s === 7 || s === 8) w.shakeAt(3);
    else if (s === 9 || s === 10) w.flashWith("CLUT131", 1, 1);
    else if (s === 11 || s === 12) w.flashWith("CLUT131", 1, 2);
    else if (s === 13 || s === 15) w.shakeAt(2);
    else if (s === 17) w.shakeAt(1);
    else if (s === 18) w.state = 2;
    if (s <= 18) this.dying++;
  }

  /* ---------------------------------------------------------------------- *
   * Moving
   * ---------------------------------------------------------------------- */

  /** 0x406ca3: a move; false when a wall or a vehicle is in the way */
  *move(kind: number): Co<boolean> {
    const w = this.world;
    const to = moved(w.pose, kind);
    w.target = to;
    const blockers = [this.tank.o, this.jeep.o];
    if (kind === FORWARD && blockers.some((o) => o.cellX === to.x && o.cellY === to.y)) {
      w.target = { ...w.pose };
      return false;
    }
    const t = w.maze.transition(w.pose, to);
    if (!t) {
      w.target = { ...w.pose };
      return false;
    }
    const n = MazeView.framesOf(t);
    this.showFrame(t.firstFrame);
    const heights = this.building ? INDOORS : OUTDOORS;
    for (let i = 1; i <= n; i++) {
      this.showFrame(t.firstFrame + i);
      w.cam = camera(w.pose, to.dir, i, kind, heights);
      yield* this.frame();
    }
    w.pose = to;
    w.cam = camera(w.pose, w.pose.dir, 0, kind, heights);
    this.rest = w.maze.restFrame(w.pose);
    if (this.rest < 0) throw new Error(`${w.maze.name}: no view at ${JSON.stringify(to)}`);
    return true;
  }

  /** 0x4075ac */
  private classify(y: number, x: number): number {
    if (this.building && this.world.maze.byte(this.world.pose) === 3 && inRect(WALK_RECTS[0], y, x)) return 3;
    if (x < 0x60) return LEFT;
    if (x > 0x120) return RIGHT;
    return 3;
  }

  private interrupted(): boolean {
    return this.m.events.some((e) => e.kind === "down" || e.kind === "key");
  }

  /** 0x40627e: a mouse-down */
  *click(y: number, x: number): Co {
    const w = this.world;
    if (this.hud.energy <= 0) return;
    if (!inRect(VIEW, y, x)) return yield* this.button(y, x);
    if (this.hud.mode === 2) {
      // 0x407621
      const b = w.maze.byte(w.pose);
      if (b) {
        const kind = this.classify(y, x);
        if (kind === 3) {
          yield* this.use();
          return;
        }
        yield* this.move(kind);
        return;
      }
      for (const r of WALK_RECTS) {
        if (!inRect(r, y, x)) return void (yield* this.move(x > 0xc0 ? RIGHT : LEFT));
        if (!(yield* this.move(FORWARD))) return;
        if (this.interrupted()) return;
      }
      return;
    }
    if (yield* this.use()) return;
    // fire, and again while the button is held — rockets once a click (0x406300)
    this.weapons.fire(y, x);
    if (this.hud.mode === 5) return;
    while (this.m.mouseHeld && this.hud.energy > 0 && this.hud.mode > 2) {
      if (this.hud.mode === 3 && this.day !== 6) yield* this.frame();
      if (this.day !== 3) yield* this.frame();
      if (this.hud.mode === 4) yield* this.frame();
      const up = this.m.events.findIndex((e) => e.kind === "up");
      if (up >= 0) {
        this.m.events.splice(up, 1);
        return;
      }
      this.weapons.fire(Math.min(VIEW_H - 1, Math.max(0, this.m.pointer.y)), Math.min(VIEW_W - 1, Math.max(0, this.m.pointer.x)));
    }
  }

  /** 0x410671: the panel's buttons — help, save, navigation and the three weapons; then 0x4175c3 */
  private *button(y: number, x: number): Co {
    const i = Panel.buttonAt(y, x);
    if (i < 0) return;
    yield* this.press(i);
  }

  /**
   * 0x417412: a menu command, between one thing and the next — File ▸ Save as
   * the save button, Help ▸ Help as the help button, Settings ▸ Keys its
   * dialog (0x417495), File ▸ Exit the game ended there and then (0x41745e), no
   * confirmation, the title again.
   */
  private *command(c: { menu: number; item: number }): Co {
    if (c.menu === 2 && c.item === 3) yield* this.press(1);
    if (c.menu === 1 && c.item === 2) yield* this.press(0);
    if (c.menu === 4 && c.item === 6) yield* this.m.keysDialog();
    if (c.menu === 2 && c.item === 4) {
      this.m.log("File ▸ Exit: the game ended, the title again");
      Object.assign(this.p, { came: 0, elevator: 0, day: 0 });
      this.m.quitAsked = true;
      this.next = 0;
    }
  }

  /** 0x4175c3 for button `i` */
  private *press(i: number): Co {
    this.setMode(i);
    if (this.hud.mode === 0) yield* this.panel.help(this.day, () => this.showFrame(this.rest), this.clut);
    if (this.hud.mode === 1 && this.panel.save) yield* this.panel.save();
    if (this.hud.mode === 1) this.hud.mode = 2;
  }

  /** 0x410a13: a weapon only with ammo in it */
  setMode(mode: number): void {
    if (mode >= 3 && this.panel.button(mode) === 15) return;
    this.hud.mode = mode;
  }

  /** 0x406603: a key */
  *key(key: string): Co {
    const k = key.length === 1 ? key.toLowerCase() : key;
    if (k === " ") {
      const was = this.hud.mode;
      this.setMode(5);
      if (this.hud.mode === 5) this.weapons.fire(0x84, 0xc0);
      this.hud.mode = was;
      return;
    }
    // 0x40666d: the key table's action — 1–3 a step, 4–7 navigation and the three weapons
    const action = this.m.action(key);
    if (action >= 4) return this.setMode(action - 2);
    const kind = [0, FORWARD, LEFT, RIGHT][action] ?? 0;
    if (!kind) return;
    if (this.hud.mode === 2) this.setMode(3);
    let moved = yield* this.move(kind);
    while (moved && this.m.keysHeld.has(key)) moved = yield* this.move(kind);
  }

  /* ---------------------------------------------------------------------- *
   * What the cells do (0x4017f2)
   * ---------------------------------------------------------------------- */

  /** answers whether the cell ahead had something to do */
  *use(): Co<boolean> {
    const w = this.world;
    const b = w.maze.byte(w.pose);
    // 0x4017f2: what a film's word and deed will be about
    this.item = -1;
    this.elevatorDown = 0;
    this.lastByte = b;
    this.jammed = false;
    const place = placeOf(this.p.level);
    if (place === 4) {
      // 0x401859: a building's door
      if (!b) return false;
      if (b >= 0xf) return (this.panel.say(0x25), true);
      yield* this.film("enter.move");
      Object.assign(this.p, { came: 1, elevator: 0, day: 0 });
      this.next = this.p.level + 1;
      return true;
    }
    if (place === 2) {
      // 0x4018db: the engine rooms
      switch (b) {
        case 9:
          return (this.panel.say(0x12), true);
        case 3:
          yield* this.engineElevator();
          return true;
        case 2:
          yield* this.cabinet();
          return true;
      }
      return false;
    }
    if (place === 3) {
      // 0x401fc1: the hive and the final chamber
      switch (b) {
        case 2:
          yield* this.cabinet();
          return true;
        case 3:
          yield* this.hiveElevator();
          return true;
        case 4:
          yield* this.film("disc.move");
          return true;
        case 6:
          yield* this.film("star.move");
          return true;
        case 8:
          return yield* this.queen();
        case 9:
          yield* this.film("switch.move");
          return true;
        case 10:
          return (this.panel.say(0x12), true);
      }
      return false;
    }
    switch (b) {
      case 2:
        yield* this.cabinet();
        return true;
      case 3:
        yield* this.elevator();
        return true;
      case 4:
        return (this.panel.say(0x23), true);
      case 5:
        return (this.panel.say(0x21), true);
      case 6:
        return (this.panel.say(0x22), true);
      case 8:
        return (this.panel.say(0x24), true);
      case 9:
        return (this.panel.say(0x12), true);
    }
    return b >= 2 && b <= 9;
  }

  /** 0x401e40: a cabinet gives one thing, the likelier the more are left, and is empty */
  private *cabinet(): Co {
    const w = this.world;
    const total = this.stock.reduce((a, b) => a + b, 0);
    if (total <= 0) throw new Error("the cabinets are out of everything");
    let r = w.roll(total);
    this.item = this.stock.findIndex((n) => (r -= n) <= 0);
    this.stock[this.item]--;
    // the hive's empty cabinets are 10 — its 9 is the switch that fills them again
    w.maze.setByte(w.pose, placeOf(this.p.level) === 3 ? 10 : 9);
    const film = ["gren.move", "rock.move", "bull.move", "shie.move", "ener.move", "alien.move"][this.item];
    yield* this.film(film);
  }

  /** 0x4024a5: a film's word — the elevator's floor, or what the cabinet held */
  private word(): void {
    const place = placeOf(this.p.level);
    if (place === 3) {
      if (this.lastByte === 3) this.panel.say(0x1d);
      if (this.lastByte === 2 && this.item >= 0 && this.item <= 4) this.panel.say([0x13, 0x14, 0x20, 0x16, 0x17][this.item]);
      if (this.lastByte === 9) this.panel.say(0x2c);
      return;
    }
    if (place !== 1 && place !== 2) return;
    if (this.lastByte === 3) this.panel.say(this.jammed ? 0x1e : 0x1d);
    if (this.lastByte === 2 && this.item >= 0) this.panel.say([0x13, 0x14, this.day >= 4 ? 0x20 : 0x15, 0x16, 0x17, 0x18][this.item]);
  }

  /** 0x40264d: a film's deed — what the cabinet's thing does, up to 50 steps of 100, two ticks apart */
  private *deed(): Co {
    const place = placeOf(this.p.level);
    if (place === 3 && this.lastByte === 9) {
      // 0x4027ee: the switch — the cabinets stocked and full again
      this.restock();
      return;
    }
    if (place === 4 || place === 0 || this.lastByte !== 2 || this.item < 0) return;
    const h = this.hud;
    const i = this.item;
    for (let k = 0; k < (i === 5 ? 0x19 : 0x32); k++) {
      if (i <= 2) {
        const key = (["grenades", "rockets", "bullets"] as const)[i];
        h[key] = Math.min(10000, h[key] + 100);
        if (h[key] >= 10000) break;
      } else if (i === 3) {
        h.shields = Math.min(10000, h.shields + 100);
        if (h.shields >= 10000) break;
      } else if (i === 4) {
        h.energy = Math.min(10000, h.energy + 100);
        if (h.energy >= 10000) break;
      } else h.score += 0x14;
      this.panel.draw();
      yield* this.m.wait(2);
    }
  }

  /** 0x401d33: the building's elevator — a floor up or down, out at the bottom */
  private *elevator(): Co {
    const p = this.p;
    Object.assign(p, { elevator: 0, day: 0 });
    this.panel.say(0x1c);
    yield* this.film("buildin.move", { button: (b) => (this.elevatorDown = b) });
    p.came += this.elevatorDown ? -1 : 1;
    if (p.came > 5) {
      this.jammed = true;
      p.came = 5;
    }
    if (p.came >= 1) {
      yield* this.film("buildout.move");
      this.next = p.level;
      return;
    }
    yield* this.film("exit.move");
    p.came = 0;
    this.next = p.level - 1;
  }

  /**
   * 0x40192a: an engine room's elevator. Up goes nowhere (FLOOR LOCKED); down
   * takes the player to the other room while the ENEMIES bar has anything
   * left, and once it is empty down to the hive, everything full again.
   */
  private *engineElevator(): Co {
    const p = this.p;
    const first = roomOf(p.level) === 1;
    Object.assign(p, { elevator: 0, day: 0 });
    this.panel.say(0x1c);
    yield* this.film(first ? "engin1in.move" : "engin2in.move", { button: (b) => (this.elevatorDown = b) });
    p.came += this.elevatorDown ? -1 : 1;
    if (p.came > 0) {
      this.jammed = true;
      p.came = 0;
      yield* this.film("engin1out.move");
      this.next = p.level;
      return;
    }
    if (this.hud.enemies > 0) {
      yield* this.film(first ? "engin2out.move" : "engin1out.move");
      this.next = first ? p.level + 1 : p.level - 1;
      return;
    }
    yield* this.m.fadeOut();
    this.films.push("tohive.move");
    yield* playFilm(this.m, "tohive.move", this.day);
    this.m.clear();
    p.came = 1;
    Object.assign(this.hud, { enemies: BAR_FULL, shields: BAR_FULL, energy: BAR_FULL, bullets: BAR_FULL, grenades: BAR_FULL, rockets: BAR_FULL });
    this.next = 0x15;
  }

  /** 0x4017b8: two of everything in the cabinets — no alien on day 6 */
  private stockUp(): void {
    this.stock = [2, 2, 2, 2, 2, this.day === 6 ? 0 : 2];
  }

  /** 0x4017b8 and 0x402a96: the cabinets stocked, and every empty one (10) full again (2) */
  private restock(): void {
    this.stockUp();
    const maze = this.world.maze;
    for (let x = 0; x < 32; x++)
      for (let y = 0; y < 32; y++) {
        if (!maze.has(x, y)) continue;
        for (let dir = 0; dir < 4; dir++) if (maze.byte({ x, y, dir }) === 0xa) maze.setByte({ x, y, dir }, 2);
      }
  }

  /**
   * 0x402243: the hive's elevator. It rides and comes back to the hive, its
   * cabinets full again, while the ENEMIES bar has anything left; with the bar
   * empty it goes down to the final chamber, and the bar is full again. In the
   * final chamber it goes nowhere.
   */
  private *hiveElevator(): Co {
    const p = this.p;
    if (p.level === 0x16) return this.panel.say(0x1e);
    Object.assign(p, { elevator: 0, day: 0 });
    this.panel.say(0x1c);
    yield* this.film("hivein.move");
    p.came++;
    if (this.hud.enemies <= 0) {
      this.world.enemiesBy(BAR_FULL);
      yield* this.film("finalout.move");
      p.came = 1;
      this.next = 0x16;
      return;
    }
    yield* this.film("hiveout.move");
    this.restock();
    this.next = p.level;
  }

  /**
   * 0x402061: the queen. Not with the tank, the jeep or the wasp in the cell
   * ahead, and not while the ENEMIES bar has anything left (0x2d); then the
   * way in, the transport, her words, the end — and the title.
   */
  private *queen(): Co<boolean> {
    const w = this.world;
    const { x, y, dir } = w.pose;
    const [ax, ay] = cellAhead(x, y, dir);
    if ([this.jeep.o, this.tank.o, this.wasp.o].some((o) => o.cellX === ax && o.cellY === ay)) return false;
    if (this.hud.enemies > 0) {
      this.panel.say(0x2d);
      return true;
    }
    const m = this.m;
    // each of them followed by the window painted black (0x41cb30)
    for (const film of ["finalin.move", "trans.move"]) {
      this.films.push(film);
      yield* playFilm(m, film, this.day);
      m.clear();
    }
    m.screen.setPalette(this.cluts.CLUT130);
    // the fade out Lunicus's talks start with (0x401570's, at 0x401616)
    yield* m.fadeOut();
    yield* talk(m, "queen.1", this.day, this.talkState);
    m.clear();
    this.films.push("final.move");
    yield* playFilm(m, "final.move", this.day);
    m.clear();
    m.screen.setPalette(this.clut);
    Object.assign(this.p, { elevator: 0, came: 0, day: 0 });
    this.won = true;
    m.log("the queen is dead: the game is won");
    this.next = 0;
    return true;
  }

  /** a film over the view, then the view again */
  *film(name: string, hooks: FilmHooks = {}): Co {
    this.films.push(name);
    // the level hears every film's word and deed (0x406723, 0x40672a)
    yield* playFilm(this.m, name, this.day, { word: () => this.word(), deed: () => this.deed(), ...hooks });
    this.m.screen.setPalette(this.clut);
    this.showFrame(this.rest);
    this.panel.draw();
  }

  /* ---------------------------------------------------------------------- *
   * The level's loop
   * ---------------------------------------------------------------------- */

  *run(): Co<number> {
    const w = this.world;
    while (this.next === null) {
      if (w.state === 1) {
        // 0x4064e2: the node is gone
        Object.assign(this.p, { elevator: 0 });
        yield* this.m.fadeOut();
        yield* this.film("cityrise.move");
        Object.assign(this.p, { came: 2, day: 3 });
        return this.p.level - 2;
      }
      if (w.state === 2) {
        Object.assign(this.p, { elevator: 0, came: 0, day: 0 });
        yield* this.m.fadeOut();
        return 0;
      }
      const c = this.m.commands.shift();
      if (c) {
        yield* this.command(c);
        continue;
      }
      const e = this.m.take();
      this.busy = !!e;
      if (e?.kind === "down") yield* this.click(e.y, e.x);
      else if (e?.kind === "key") yield* this.key(e.key);
      else yield* this.frame();
      this.busy = false;
    }
    return this.next;
  }
}
