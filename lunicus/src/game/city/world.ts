/**
 * What every actor of a city or building level shares: the camera, the maze,
 * the HUD's numbers, the random roll, the sounds, the palette flashes and the
 * frame's list of things to draw.
 *
 * The actors (the tank, the jeep, the wasp and the node, the player's shots)
 * are transliterations of LUNICUS.EXE's, and keep its shapes: an object is the
 * EXE's 0x18 bytes, {angle, x, y, z, cell x, cell y} (`Placed`), and a shot's
 * slot keeps the EXE's fields by the names of what they hold.
 */
import type { FrameV0 } from "@dreamfactory/engine/df/image-v0";
import { CELL } from "../data";
import type { Machine } from "../machine";
import { corridor, project, type Camera, type MazeView, type Placed, type Pose } from "../maze";
import { clip, type Rect } from "@dreamfactory/engine/v0/screen";
import type { Hud } from "../panel";
import type { CombatParams } from "./params";

export type Obj = Placed;

/** the HUD's numbers the combat moves (0x41070e, 0x4107b4, 0x41084d, 0x410adb) */
export type Gauges = Hud;

export interface DrawItem {
  depth: number;
  clip: Rect;
  frame: FrameV0;
  /** a picture at a fixed size: its anchor at (y, x), mirrored or not (0x40477c) */
  y: number;
  x: number;
  mirror: boolean;
}

export const FULL_VIEW: Rect = [0, 0, 264, 384];

export class World {
  cam!: Camera;
  /** where the player stands and where a move is going (`[0x42e0c8]`, `[0x42e0ce]`) */
  pose: Pose = { x: 0, y: 0, dir: 0 };
  target: Pose = { x: 0, y: 0, dir: 0 };
  /**
   * `[0x42d110]`: 0 in play, −1 the node is going up, 1 the node is gone and
   * the player may leave, 2 the player is dead
   */
  state = 0;
  /** `[0x42e08c]` the screen shakes this hard this frame (0x41d8c9) */
  shake = 0;
  /** `[0x42c8b8]` … : a palette flash, its CLUT and how long (0x41c88c) */
  flash: { clut: Uint8ClampedArray; frames: number; hold: number } | null = null;
  /** this frame's pictures, gathered then drawn farthest first (0x409b87, 0x409a8d) */
  draws: DrawItem[] = [];
  /** HUD messages asked for this frame (0x4106cf) */
  said: number[] = [];
  /** `[0x42e0e8]`: how high a shot may go — 0x1a4 indoors, 10000 in the open, 0x1ae in the hive */
  ceiling = 10000;
  /** `[0x42b468]` the node is out: the radar shows it (0x4107a7) */
  radarOn = false;

  constructor(
    readonly m: Machine,
    readonly maze: MazeView,
    readonly params: CombatParams,
    readonly g: Gauges,
    readonly level: number,
    readonly day: number,
    /** 0x40a467: a building, the engine rooms, the hive — indoors, the base's heights */
    readonly building: boolean,
    readonly sounds: Uint8Array[],
    readonly cluts: Record<string, Uint8ClampedArray>,
  ) {}

  roll(n: number): number {
    return this.m.roll(n);
  }

  /** 0x40359c: true when the maze has no cell there */
  blocked(x: number, y: number): boolean {
    return !this.maze.has(x, y);
  }

  has = (x: number, y: number): boolean => this.maze.has(x, y);

  /** the cell an object's point is in */
  static cellOf(o: Obj): void {
    o.cellX = Math.trunc(o.x / CELL);
    o.cellY = Math.trunc(o.y / CELL);
  }

  /** the camera's centre as an object: what shots aim at (0x42e098) */
  camObj(): Obj {
    return { angle: this.cam.angle, x: this.cam.x, y: this.cam.y, z: this.cam.z, cellX: this.cam.cellX, cellY: this.cam.cellY };
  }

  /** 0x409e00 */
  visible(o: Obj): Rect | null {
    return corridor(this.cam, o, this.has);
  }

  /** 0x41d9a0 */
  project(o: Obj): { depth: number; y: number; x: number } {
    return project(this.cam, o);
  }

  /** 0x409b87 with a mirror flag: a picture at its own size, if any of it shows */
  addFixed(within: Rect, depth: number, y: number, x: number, frame: FrameV0 | undefined, mirror: boolean): void {
    if (!frame) return;
    const top = y - frame.anchorY;
    const left = x - (mirror ? frame.width - frame.anchorX : frame.anchorX);
    const r = clip([top, left, top + frame.height, left + frame.width], within);
    if (r[0] >= r[2] || r[1] >= r[3]) return;
    this.draws.push({ depth, clip: within, frame, y, x, mirror });
  }

  /** 0x41954a: a sound of the level's bank (`citysound`) */
  sound(n: number): void {
    const s = this.sounds[n + 1];
    if (s) this.m.sound(s);
  }

  /** 0x41d8c9 */
  shakeAt(n: number): void {
    if (n > this.shake) this.shake = n;
  }

  /** 0x41c88c: a flash is not cut short by a weaker one */
  flashWith(clut: string, frames: number, hold: number): void {
    const c = this.cluts[clut];
    if (!c) return;
    if (this.flash && this.flash.frames >= this.flash.hold) return;
    this.flash = { clut: c, frames, hold };
  }

  say(n: number): void {
    this.said.push(n);
  }

  /** `shared/pyro.` — the shells, flashes and bursts, in rows of 14 distances */
  pyro: FrameV0[] = [];
  /** `[0x42bcc4]` hits taken, for the gun's kick */
  hitsTaken = 0;

  /**
   * 0x41195b: an enemy's shot at `s` hits the player if it is within 40 of
   * the view's centre and not above 200: the shields take the damage, and the
   * energy the share of it the shields no longer stop.
   */
  playerHit(s: Obj, dmg: number): boolean {
    const c = this.cam;
    if (s.z > 0xc8 || s.z < 0) return false;
    if (s.x < c.x - 0x28 || s.x > c.x + 0x28 || s.y < c.y - 0x28 || s.y > c.y + 0x28) return false;
    this.sound(dmg >= this.params.nodeShot ? 4 : 1);
    if (this.state === 0) {
      this.shieldsBy(-dmg);
      const through = Math.max(0, Math.trunc(((10000 - this.g.shields) * dmg) / 10000));
      this.energyBy(-through);
      this.hitsTaken++;
      this.flashWith("CLUT132", 1, 2);
    }
    return true;
  }

  /**
   * 0x41331a (and the jeep's 0x413459): a shot's picture at its distance —
   * kind 0 in flight, 1 a flash, 2 and 4 a hit, 3 the burst on a wall
   */
  shotPicture(o: Obj, kind: number, jeep = false): void {
    const within = this.visible(o);
    if (!within) return;
    const pt = this.project(o);
    if (pt.depth < 0xfc) return;
    const d = Math.min(13, Math.trunc((pt.depth - 0xfc) / 0xd2));
    const row = kind === 0 && jeep ? 147 : (SHOT_ROWS[kind] ?? -1);
    if (row < 0) return;
    this.addFixed(within, pt.depth, pt.y, pt.x, this.pyro[row + d], false);
  }

  /** 0x41d500: the player straight down its heading, nothing between */
  downTheLine(o: Obj): boolean {
    const { cellX: x, cellY: y } = o;
    const cx = this.cam.cellX;
    const cy = this.cam.cellY;
    switch (o.angle) {
      case 0:
        if (y !== cy || x >= cx) return false;
        for (let k = x + 1; k <= cx; k++) if (this.blocked(k, y)) return false;
        return true;
      case 0x40:
        if (x !== cx || y >= cy) return false;
        for (let k = y + 1; k <= cy; k++) if (this.blocked(x, k)) return false;
        return true;
      case 0x80:
        if (y !== cy || x <= cx) return false;
        for (let k = x - 1; k >= cx; k--) if (this.blocked(k, y)) return false;
        return true;
      case 0xc0:
        if (x !== cx || y <= cy) return false;
        for (let k = y - 1; k >= cy; k--) if (this.blocked(x, k)) return false;
        return true;
    }
    throw new Error(`a heading of ${o.angle} is no quarter`);
  }

  /** 0x4112a9: DANGER — ENEMY AHEAD, ON THE LEFT, ON THE RIGHT, BEHIND */
  warnFrom(o: Obj): void {
    const q = (this.cam.angle + 0x20) & 0xc0;
    const facing = (a: number): boolean => this.facingPlayer(o, a & 0xff);
    if (facing(q + 0x80)) this.say(4);
    else if (facing(q - 0x40)) this.say(2);
    else if (facing(q + 0x40)) this.say(3);
    else if (facing(q)) this.say(1);
  }

  /** 0x41134b: the player, looking along `a`, has this vehicle down that way in the open */
  private facingPlayer(o: Obj, a: number): boolean {
    const cx = this.cam.cellX;
    const cy = this.cam.cellY;
    const { cellX: x, cellY: y } = o;
    if (a === 0) {
      if (y !== cy || x <= cx) return false;
      for (let k = cx + 1; k <= x; k++) if (this.blocked(k, cy)) return false;
      return true;
    }
    if (a === 0x40) {
      if (x !== cx || y <= cy) return false;
      for (let k = cy + 1; k <= y; k++) if (this.blocked(cx, k)) return false;
      return true;
    }
    if (a === 0x80) {
      if (y !== cy || x >= cx) return false;
      for (let k = cx - 1; k >= x; k--) if (this.blocked(k, cy)) return false;
      return true;
    }
    if (x !== cx || y >= cy) return false;
    for (let k = cy - 1; k >= y; k--) if (this.blocked(cx, k)) return false;
    return true;
  }

  /* ---------------------------------------------------------------------- *
   * The HUD's numbers
   * ---------------------------------------------------------------------- */

  /** 0x41070e */
  energyBy(d: number): void {
    const before = this.g.energy;
    this.g.energy = Math.max(0, Math.min(10000, this.g.energy + d));
    if (this.g.energy >= 10000 && before < 10000) this.say(14);
    else if (this.g.energy <= 0 && before > 0) this.say(12);
    else if (this.g.energy <= 2500 && before > 2500) this.say(11);
  }

  /** 0x4107b4 */
  shieldsBy(d: number): void {
    const before = this.g.shields;
    this.g.shields = Math.max(0, Math.min(10000, this.g.shields + d));
    if (this.g.shields >= 10000 && before < 10000) this.say(13);
    else if (this.g.shields <= 0 && before > 0) this.say(10);
    else if (this.g.shields <= 2500 && before > 2500) this.say(8);
  }

  /** 0x41084d */
  enemiesBy(d: number): void {
    this.g.enemies = Math.max(0, Math.min(10000, this.g.enemies + d));
  }

  /** 0x410c5b */
  scoreBy(d: number): void {
    this.g.score += d;
  }

  /** 0x410aa4 */
  ammo(): number {
    const key = this.ammoKey();
    return key ? this.g[key] : 0;
  }

  /** the pressed weapon's ammo */
  private ammoKey(): "bullets" | "rockets" | "grenades" | null {
    if (this.g.mode === 3) return "bullets";
    if (this.g.mode === 5) return "rockets";
    if (this.g.mode === 4) return "grenades";
    return null;
  }

  /** 0x410adb: the pressed weapon's ammo moved */
  ammoBy(d: number): void {
    const key = this.ammoKey();
    if (!key) return;
    const before = this.g[key];
    this.g[key] = Math.max(0, Math.min(10000, this.g[key] + d));
    if (this.g[key] >= 10000 && before < 10000) this.say(15);
    else if (this.g[key] <= 0 && before > 0) this.say(9);
    else if (this.g[key] <= 2500 && before > 2500) this.say(7);
  }
}

/** the pyro row of each shot kind's picture, 0 … 4 (a jeep's kind 0 is 147) */
const SHOT_ROWS = [14, 42, 119, 56, 133];

/** 0x41d79f: nine cells or more from the camera — an actor that far goes and comes back */
export function tooFar(w: World, o: Obj): boolean {
  return Math.abs(o.cellX - w.cam.cellX) >= 9 || Math.abs(o.cellY - w.cam.cellY) >= 9;
}

/** 0x41d7e9: a shot out of the air (2) or into a wall (1), else 0 */
export function shotWall(w: World, o: Obj): number {
  if (o.z > w.ceiling || o.z < 0) return 2;
  if (o.x < 0) o.cellX = -1;
  if (o.y < 0) o.cellY = -1;
  return w.blocked(o.cellX, o.cellY) ? 1 : 0;
}

/** 0x41d429: a shot's velocity toward a point, at most `speed` a step */
export function aim(shot: { v: [number, number, number]; o: Obj }, to: Obj, speed: number): void {
  const dx = to.x - shot.o.x;
  const dy = to.y - shot.o.y;
  const dz = to.z - shot.o.z;
  const n = Math.trunc(Math.trunc(Math.sqrt(dx * dx + dy * dy + dz * dz)) / speed) + 1;
  shot.v = [Math.trunc(dx / n), Math.trunc(dy / n), Math.trunc(dz / n)];
}

/** 0x41d962 / 0x41d981: a length along a heading */
export const COS = Array.from({ length: 256 }, (_, a) => Math.round(Math.cos((a * Math.PI) / 128) * 0x4000));
export const SIN = Array.from({ length: 256 }, (_, a) => Math.round(Math.sin((a * Math.PI) / 128) * 0x4000));
export const along = (angle: number, r: number): [number, number] => [Math.trunc((COS[angle & 0xff] * r) / 0x4000), Math.trunc((SIN[angle & 0xff] * r) / 0x4000)];
