/**
 * What every part of a flight shares — RAVEN.EXE's globals from 0x43cd14 on,
 * the draw list at 0x43b728 and the helpers every actor calls: the camera,
 * the projection, the city's solid cells, the roll, the sounds and the frame's
 * list of pictures, drawn farthest first behind the buildings' depth.
 *
 * The actors (src/game/combat/*.ts) are transliterations of RAVEN.EXE's, and
 * keep its shapes: an object is the EXE's 0x18 bytes, {angle, x, y, z, cell x,
 * cell y} ({@link Obj}); a record keeps the EXE's fields by the names of what
 * they hold, each with its offset.
 *
 * ## The camera (0x40b85f, 0x40bd17)
 *
 * The craft is `[0x43cd1c]` as an object: its heading, its point (8.8 fixed
 * point, a cell 256 wide — the city's cell (x, y) is 256·x … 256·x + 255), its
 * height (`[0x43cd28]`, HOVER's rise) and its cell. The eye is 0x80 behind it
 * along the heading and 0xa0 up (`[0x43cd38]` …), and a point projects to
 *
 *   depth  = (dx·cos + dy·sin) / 0x4000,   across = (dy·cos − dx·sin) / 0x4000
 *   x = 0x80 + across·0x9b / depth,        y = 0x9b − dz·0x9b / depth
 *
 * in the view's own pixels, 256 by 310 (0x427e15). Nothing with a depth of 0
 * or less is ahead.
 *
 * ## The draw list (0x40e271, 0x40e31b, 0x40e3b6; 0x40e1e1; 0x40e634)
 *
 * A frame's pictures are gathered, sorted farthest first (0x40e1e1, which
 * swaps an earlier item with any later one that is farther), and drawn into
 * the view over the city's frame. A picture nearer than 0x100 is drawn whole
 * (0x4091f4); one farther is drawn only where the city's depth layer at that
 * pixel is at least its depth / 8 (0x408ee2, 0x40911d), which is how a
 * building hides what is behind it. A beam (a laser's) is one picture stamped
 * at every point of a line (0x40e6c5).
 */
import { solidV0, type MazeV0 } from "@dreamfactory/engine/df/maze-v0";
import type { FrameV0 } from "@dreamfactory/engine/df/image-v0";
import { readBankV0 } from "@dreamfactory/engine/df/banks";
import { readContainerFile } from "@dreamfactory/engine/df/container";
import { decodeFrameV0 } from "@dreamfactory/engine/df/image-v0";
import type { Rect } from "@dreamfactory/engine/v0/screen";
import type { Machine } from "../machine";
import type { Records } from "../records";
import type { BikeApi, BossApi, CommsApi, CopilotApi, CopterApi, FuelApi, HudApi, JeepApi, PyroApi, TankApi, WeapApi } from "./api";

/** the view: 256 across, 310 down (`[0x43b2d4]`) */
export const VIEW_W = 0x100;
export const VIEW_H = 0x136;
export const VIEW_RECT: Rect = [0, 0, VIEW_H, VIEW_W];
/** the projection's focal length and the view's centre (0x427e98) */
export const FOCAL = 0x9b;
export const CENTRE_X = 0x80;
export const CENTRE_Y = 0x9b;
/** a picture this near or nearer is drawn whole, in front of the buildings (0x40e664) */
export const UNMASKED = 0x100;

/** the tables' cosine and sine by heading, 0x4000 to 1 (`[0x43cd64]`, `[0x43cd60]`: RAVENRES.DLL's TRIG 1 and 2, round(0x4000·cos) to within one) */
export const COS = Array.from({ length: 256 }, (_, a) => Math.round(Math.cos((a * Math.PI) / 128) * 0x4000));
export const SIN = Array.from({ length: 256 }, (_, a) => Math.round(Math.sin((a * Math.PI) / 128) * 0x4000));

/** 0x427ddb: r along a heading's x */
export const cosMul = (a: number, r: number): number => Math.trunc((COS[a & 0xff] * r) / 0x4000);
/** 0x427df8: r along a heading's y */
export const sinMul = (a: number, r: number): number => Math.trunc((SIN[a & 0xff] * r) / 0x4000);
/** 0x427da2 */
export const abs = Math.abs;
/** 0x427db2: the length of (x, y, z), truncated (fsqrt, then the C runtime's ftol) */
export const dist = (x: number, y: number, z: number): number => Math.trunc(Math.sqrt(x * x + y * y + z * z));
/** 0x4270e9: a point (y, x) in a rect [top, left, bottom, right] */
export const inside = (y: number, x: number, r: Rect): boolean => x >= r[1] && x < r[3] && y >= r[0] && y < r[2];

/**
 * 0x40e08a: a file of pictures, one a container, each its own allocation; a
 * container of no picture (BIKE has eleven, 0 by 0) is none
 */
export function readPictures(data: Uint8Array): (FrameV0 | undefined)[] {
  return readContainerFile(data).containers.map((c) => {
    try {
      return decodeFrameV0(c.data);
    } catch {
      return undefined;
    }
  });
}

/** a thing in the world, the EXE's 0x18 bytes */
export interface Obj {
  /** +0x00 heading, 0 to 255, 0 east, 0x40 south */
  angle: number;
  /** +0x04, +0x08, +0x0c */
  x: number;
  y: number;
  z: number;
  /** +0x10, +0x14: its cell, as it was last set (not always x >> 8) */
  cellX: number;
  cellY: number;
}

export const newObj = (): Obj => ({ angle: 0, x: 0, y: 0, z: 0, cellX: 0, cellY: 0 });
export const copyObj = (o: Obj): Obj => ({ ...o });
/** `movsd` ×6: one object's six fields over another's */
export function setObj(to: Obj, from: Obj): void {
  to.angle = from.angle;
  to.x = from.x;
  to.y = from.y;
  to.z = from.z;
  to.cellX = from.cellX;
  to.cellY = from.cellY;
}

/** a point in the view, the Macintosh's {v, h} */
export interface Pt {
  y: number;
  x: number;
}

/**
 * What 0x40c5d5 answers of a target, the kinds the copilot and the HUD tell
 * apart (each module's `nth` returns its kind; the bike's 0x402d39 answers
 * only the eax it zeroed, 0)
 */
export const KIND = { bike: 0, fuel: 1, weap: 2, player: 3, jeep: 4, tank: 5, copter: 6, boss: 7, debris: 8 } as const;

/** a draw list item, the EXE's 40 bytes (0x40e2a8) */
export interface DrawItem {
  /** +0x00: 0 a beam, 1 a picture, 2 a picture whose rect was asked for */
  kind: 0 | 1 | 2;
  frame: FrameV0;
  /** +0x04 / +0x08: the point (a beam's first end) */
  y: number;
  x: number;
  /** +0x0c: drawn mirrored */
  mirror: boolean;
  /** +0x10 */
  depth: number;
  /** a beam's other end (+0x1c) */
  y2: number;
  x2: number;
}

/**
 * Each enemy module's part of the world's lists: the order is the EXE's in
 * each list, which the World keeps (0x40c517 the frame, 0x40c184 a wrap,
 * 0x40c545 / 0x40c5d5 the targets, 0x41b70b a shot's hits).
 */
export interface Module {
  /** once per flight, after its pictures are read (0x40c4b5's list) */
  reset(): void;
  /** a frame: move, fire, and add its pictures to the draw list (0x40c517's list) */
  frame(): void;
  /** the whole world moved by (dx, dy) when the craft wrapped (0x40c184's list) */
  shift(dx: number, dy: number): void;
}

export interface Targets {
  /** how many are there to aim at (0x40c545's list) */
  count(): number;
  /** the k-th of them, 0 the first: its object, the kind ({@link KIND}), its +0x64-style flag and whether it is dying (0x40c5d5's list) */
  nth(k: number): { obj: Obj; kind: number; flag: number; dying: number };
}

export interface Hittable {
  /**
   * A shot moving from `a` to `b`, doing `dmg`, `r` wider either side than
   * the thing's own reach: true if it hits one of these, which takes the
   * damage (0x41b70b's list, each module's hit test; the EXE's argument order
   * — the damage third, the reach fourth: 0x40dc1f adds its 4th to its box)
   */
  hit(a: Obj, b: Obj, dmg: number, r: number): boolean;
}

export type Enemy = Module & Targets & Hittable;

/**
 * The difficulty's numbers (0x421f0a, by `[0x439fb0]` 1 to 4): named by
 * address until a module that reads one names it. Known: 0x43cf6a the jeep's
 * speed, 0x43cf6e its shots' interval, 0x43cf72 how many jeeps, 0x43cfb2 a
 * jeep's strength (src/game/combat/jeep.ts); 0x43cf8a the tank's speed,
 * 0x43cf8e its shots' interval, 0x43cf92 how many tanks, 0x43cf96 its turn a
 * frame, 0x43cfb6 its strength (tank.ts); 0x43cf7a the bike's speed,
 * 0x43cf7e its shots' interval, 0x43cf82 how many bikes, 0x43cfae its strength
 * (bike.ts); 0x43cf9e the copter's speed, 0x43cfa2 its shots' interval,
 * 0x43cfa6 how many copters, 0x43cfaa its turn a frame, 0x43cfba its strength
 * (copter.ts).
 */
export interface Params {
  x43cf5a: number; x43cf5e: number; x43cf62: number; x43cf6a: number; x43cf6e: number; x43cf72: number;
  x43cf7a: number; x43cf7e: number; x43cf82: number; x43cf8a: number; x43cf8e: number; x43cf92: number;
  x43cf96: number; x43cf9e: number; x43cfa2: number; x43cfa6: number; x43cfaa: number; x43cfae: number;
  x43cfb2: number; x43cfb6: number; x43cfba: number; x43cfbe: number; x43cfc2: number; x43cfc6: number;
}

/** 0x421f24 … 0x422263 */
export const PARAMS: Record<number, Params> = {
  1: {
    x43cf6a: 5, x43cf6e: 10, x43cf72: 1, x43cfb2: 0xbb8, x43cf7a: 10, x43cf7e: 10, x43cf82: 2, x43cfae: 0x5dc,
    x43cf8a: 4, x43cf8e: 10, x43cf92: 1, x43cf96: 4, x43cfb6: 0x2ee0, x43cf9e: 4, x43cfa2: 10, x43cfa6: 1,
    x43cfaa: 8, x43cfba: 0x12c0, x43cf5a: 0xc, x43cf5e: 0x10, x43cfbe: 0x32c8, x43cfc2: 0x6a4, x43cfc6: 0x3fc, x43cf62: 0x2bc,
  },
  2: {
    x43cf6a: 8, x43cf6e: 7, x43cf72: 2, x43cfb2: 0xfa0, x43cf7a: 0xc, x43cf7e: 7, x43cf82: 3, x43cfae: 0x7d0,
    x43cf8a: 5, x43cf8e: 7, x43cf92: 2, x43cf96: 5, x43cfb6: 0x3e80, x43cf9e: 5, x43cfa2: 7, x43cfa6: 2,
    x43cfaa: 0xa, x43cfba: 0x1770, x43cf5a: 0x12, x43cf5e: 0xc, x43cfbe: 0x4650, x43cfc2: 0x578, x43cfc6: 0x348, x43cf62: 0x258,
  },
  3: {
    x43cf6a: 0xa, x43cf6e: 5, x43cf72: 2, x43cfb2: 0x1388, x43cf7a: 0x10, x43cf7e: 5, x43cf82: 3, x43cfae: 0x9c4,
    x43cf8a: 8, x43cf8e: 5, x43cf92: 2, x43cf96: 8, x43cfb6: 0x4e20, x43cf9e: 8, x43cfa2: 5, x43cfa6: 2,
    x43cfaa: 0x10, x43cfba: 0x1c20, x43cf5a: 0x18, x43cf5e: 8, x43cfbe: 0x59d8, x43cfc2: 0x44c, x43cfc6: 0x294, x43cf62: 0x1f4,
  },
  4: {
    x43cf6a: 0x10, x43cf6e: 3, x43cf72: 2, x43cfb2: 0x1770, x43cf7a: 0x15, x43cf7e: 3, x43cf82: 4, x43cfae: 0xbb8,
    x43cf8a: 0xa, x43cf8e: 3, x43cf92: 3, x43cf96: 0x10, x43cfb6: 0x5dc0, x43cf9e: 0x10, x43cfa2: 3, x43cfa6: 3,
    x43cfaa: 0x20, x43cfba: 0x20d0, x43cf5a: 0x1e, x43cf5e: 4, x43cfbe: 0x6d60, x43cfc2: 0x320, x43cfc6: 0x1e0, x43cf62: 0x190,
  },
};

/**
 * The flight's state (`[0x43cd70]`): 1 flying, 2 the pods are down (0x40b5b8),
 * 3 the level is done (0x40b5fd); 0 and below the craft is going down, one a
 * frame, and under −100 it is lost (0x40b447)
 */
export const FLYING = 1;

export class World {
  /** `[0x43cd1c]` … `[0x43cd30]`: the craft */
  readonly cam: Obj = newObj();
  /** `[0x43cd38]`, `[0x43cd3c]`, `[0x43cd40]`: the eye; `[0x43cd44]`, `[0x43cd48]` its cell */
  eyeX = 0;
  eyeY = 0;
  eyeZ = 0xa0;
  eyeCellX = 0;
  eyeCellY = 0;
  /** `[0x43cd80]`, `[0x43cd7c]`: the heading's cosine and sine */
  cos = 0x4000;
  sin = 0;
  /** `[0x43cd84]`: 0x20 while a step is under way, 0 in a turn or at rest — the craft's speed */
  speed = 0;
  /** `[0x43cd6c]`: HOVER's slide across the street */
  slide = 0;
  /** `[0x43cd70]` ({@link FLYING}) */
  state = FLYING;
  /** `[0x43cd68]`: the view shaken this frame, 1 by 8 pixels, 2 by 16; 3 flashed (0x40c35a) */
  jolt = 0;
  /** `[0x43cd78]`: the move's frame, −1 at rest */
  moveFrame = -1;
  /** `[0x43cd4c]`, `[0x43cd4e]`, `[0x43cd50]`: the pose the craft is at, cell and facing 0 north, 1 south, 2 east, 3 west (the flight keeps it; 0x419511 slides from it) */
  poseX = 0;
  poseY = 0;
  poseDir = 0;
  /** `[0x43cd88]`: frames the enemies' sights are jammed, 500 from a tier-3 defensive (0x41adda); the flight counts it down (0x40b3ce) */
  jammer = 0;
  /** `[0x43ab44]` …: a palette flash asked for (0x426b68, src/game/combat/lib.ts), which the flight shows and clears (0x426b9b) */
  flash: { clut: number; a: number; b: number } | null = null;

  /** the modules (src/game/combat/api.ts), made by the flight before anything runs */
  comms!: CommsApi;
  bike!: BikeApi;
  boss!: BossApi;
  copilot!: CopilotApi;
  copter!: CopterApi;
  fuel!: FuelApi;
  hud!: HudApi;
  jeep!: JeepApi;
  pyro!: PyroApi;
  tank!: TankApi;
  weap!: WeapApi;

  /** this frame's pictures (0x43b728, `[0x43c6d0]` of them) */
  items: DrawItem[] = [];

  /** the modules, each in the lists it is in (set by the flight once they are made) */
  frameList: Module[] = [];
  shiftList: Module[] = [];
  targetList: Targets[] = [];
  /** 0x40c4b5: what a new craft starts over (pyro, bike, jeep, tank, copter, boss, fuel, weap) */
  resetList: Module[] = [];
  /** 0x41b70b: bike, tank, copter, boss, jeep, fuel, weap */
  hitList: Hittable[] = [];

  /** the sound bank's sounds, 0 the first (the band's file: 0x422ef6) */
  private sounds: Uint8Array[] = [];

  constructor(
    readonly m: Machine,
    readonly maze: MazeV0,
    readonly r: Records,
    readonly params: Params,
    /** `[0x439fb0]` 1 to 4 */
    readonly difficulty: number,
    readonly day: number,
  ) {}

  /** 0x422ef6: a band's bank, its first container the count of sounds, pieces and the music's order */
  setBank(bank: Uint8Array[]): void {
    const { sounds } = readBankV0(bank[0]);
    this.sounds = bank.slice(1, 1 + sounds);
  }

  /** 0x423306: sound n of the bank */
  sound(n: number): void {
    const s = this.sounds[n];
    if (s) this.m.sound(s);
  }

  /**
   * 0x4232ac: the same sound, asked for the other way — the bank's sounds each
   * carry a priority, and 0x423306 takes a channel from a sound of lower or
   * equal priority where this one takes it only from a lower (0x428a23,
   * 0x428a95). The machine mixes every sound it is given, so both play it.
   */
  soundOver(n: number): void {
    this.sound(n);
  }

  /** 0x427d91: 1 to n */
  roll(n: number): number {
    return this.m.roll(n);
  }

  /** 0x4049a4: the city's cell is a block, wrapping round */
  solid(x: number, y: number): boolean {
    return solidV0(this.maze, x, y);
  }

  /** 0x427e15: the depth, and the point in the view when it is ahead */
  project(o: Obj): { depth: number; y: number; x: number } {
    const dx = o.x - this.eyeX;
    const dy = o.y - this.eyeY;
    const dz = o.z - this.eyeZ;
    const depth = Math.trunc((this.cos * dx + this.sin * dy) / 0x4000);
    if (depth <= 0) return { depth, y: 0, x: 0 };
    const across = Math.trunc((this.cos * dy - this.sin * dx) / 0x4000);
    return { depth, y: CENTRE_Y - Math.trunc((dz * FOCAL) / depth), x: CENTRE_X + Math.trunc((across * FOCAL) / depth) };
  }

  /** 0x408e77: where a picture lands with its anchor at (y, x) */
  static rectOf(f: FrameV0, y: number, x: number, mirror: boolean): Rect {
    const ax = mirror ? f.width - f.anchorX : f.anchorX;
    const top = y - f.anchorY;
    const left = x - ax;
    return [top, left, top + f.height, left + f.width];
  }

  /**
   * 0x40e271 (and 0x40e31b, which answers nothing): a picture at (y, x),
   * `depth` away, added if any of it is in the view; answers its rect in the
   * view, or null
   */
  sprite(f: FrameV0 | undefined, y: number, x: number, depth: number, mirror = false): Rect | null {
    if (!f) return null;
    const r = World.rectOf(f, y, x, mirror);
    const c: Rect = [Math.max(r[0], 0), Math.max(r[1], 0), Math.min(r[2], VIEW_H), Math.min(r[3], VIEW_W)];
    if (c[0] >= c[2] || c[1] >= c[3]) return null;
    this.items.push({ kind: 2, frame: f, y, x, mirror, depth, y2: 0, x2: 0 });
    return c;
  }

  /** 0x40e3b6: a beam from (y1, x1) to (y2, x2), `depth` away, added if its bounds meet the view */
  beam(f: FrameV0 | undefined, y1: number, x1: number, y2: number, x2: number, depth: number): void {
    if (!f) return;
    const a = World.rectOf(f, y1, x1, false);
    const b = World.rectOf(f, y2, x2, false);
    const u: Rect = [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])];
    if (Math.max(u[0], 0) >= Math.min(u[2], VIEW_H) || Math.max(u[1], 0) >= Math.min(u[3], VIEW_W)) return;
    this.items.push({ kind: 0, frame: f, y: y1, x: x1, mirror: false, depth, y2, x2 });
  }

  /** 0x40e1e1: farthest first, the EXE's exchange sort (its order among equals is its own) */
  sortItems(): void {
    const it = this.items;
    for (let i = 0; i < it.length - 1; i++)
      for (let j = i + 1; j < it.length; j++)
        if (it[i].depth < it[j].depth) [it[i], it[j]] = [it[j], it[i]];
  }

  /**
   * 0x40e634: the list drawn into `view` (256 by 310 palette indexes), each
   * picture past {@link UNMASKED} only where `z` (the city frame's depth
   * layer, same size) is at least its depth / 8
   */
  drawItems(view: Uint8Array, z: Uint8Array | null): void {
    for (const d of this.items) {
      if (d.kind === 0) this.drawBeam(view, z, d);
      else stamp(view, z, d.frame, d.y, d.x, d.mirror, d.depth);
    }
  }

  /** 0x40e6c5: the picture at every point of the line, Bresenham's way */
  private drawBeam(view: Uint8Array, z: Uint8Array | null, d: DrawItem): void {
    let [v1, h1, v2, h2] = [d.y, d.x, d.y2, d.x2];
    if (h2 < h1) [v1, h1, v2, h2] = [v2, h2, v1, h1];
    const dh = h2 - h1;
    const dv = v2 - v1;
    let v = v1;
    let h = h1;
    const put = (): void => stamp(view, z, d.frame, v, h, false, d.depth);
    if (dv < 0) {
      if (-dv > dh) {
        let err = Math.trunc(dv / 2);
        for (let n = -dv; ; ) {
          put();
          if (--n <= 0) break;
          v--;
          err += dh;
          if (err >= 0) (h++, (err += dv));
        }
      } else {
        let err = -Math.trunc(dh / 2);
        for (let n = dh; ; ) {
          put();
          if (--n <= 0) break;
          h++;
          err -= dv;
          if (err >= 0) (v--, (err -= dh));
        }
      }
    } else if (dv > dh) {
      let err = -Math.trunc(dv / 2);
      for (let n = dv; ; ) {
        put();
        if (--n <= 0) break;
        v++;
        err += dh;
        if (err >= 0) (h++, (err -= dv));
      }
    } else {
      let err = -Math.trunc(dh / 2);
      for (let n = dh; ; ) {
        put();
        if (--n <= 0) break;
        h++;
        err += dv;
        if (err >= 0) (v++, (err -= dh));
      }
    }
  }

  /** 0x41b70b: a shot's hits, the first of the list it meets (the damage third, the reach fourth) */
  hitEnemies(a: Obj, b: Obj, dmg: number, r: number): boolean {
    for (const h of this.hitList) if (h.hit(a, b, dmg, r)) return true;
    return false;
  }

  /** 0x40c545: every target there is */
  targetCount(): number {
    return this.targetList.reduce((n, t) => n + t.count(), 0);
  }

  /** 0x40c5d5: the k-th target of all of them, in the list's order */
  target(k: number): { obj: Obj; kind: number; flag: number; dying: number } {
    for (const t of this.targetList) {
      const n = t.count();
      if (k < n) return t.nth(k);
      k -= n;
    }
    throw new Error("0x40c5d5: no such target");
  }

  /** 0x40c184: the world moved (dx, dy) — the eye and everything in it */
  shift(dx: number, dy: number): void {
    this.eyeX += dx;
    this.eyeY += dy;
    this.eyeCellX += dx >> 8;
    this.eyeCellY += dy >> 8;
    for (const s of this.shiftList) s.shift(dx, dy);
  }
}

/**
 * 0x4091f4 / 0x408ee2: one picture with its anchor at (v, h) into the view,
 * clipped to it; past {@link UNMASKED}, only over depth layer values of at
 * least depth / 8
 */
function stamp(view: Uint8Array, z: Uint8Array | null, f: FrameV0, v: number, h: number, mirror: boolean, depth: number): void {
  const [top, left] = World.rectOf(f, v, h, mirror);
  const masked = depth > UNMASKED && z !== null;
  const level = depth >> 3;
  for (let r = 0; r < f.height; r++) {
    const y = top + r;
    if (y < 0 || y >= VIEW_H) continue;
    for (let c = 0; c < f.width; c++) {
      const x = left + (mirror ? f.width - 1 - c : c);
      if (x < 0 || x >= VIEW_W) continue;
      const i = r * f.width + c;
      if (!f.opaque[i]) continue;
      const at = y * VIEW_W + x;
      if (masked && z![at] < level) continue;
      view[at] = f.indexed[i];
    }
  }
}
