/**
 * The drones — LUNICUS.EXE 0x40374c … 0x4046a4: from day three on, `day − 2`
 * of them (at most four, 0x40374c), in the city and in the buildings. Each is a
 * 0x48-byte slot at 0x429f90 + 0x48·i.
 *
 * ## How one flies (0x403d3b)
 *
 * A cell at a time, and straight at the player: at each cell it takes the
 * longer way toward the player's cell if that cell is open, the shorter if
 * not (a coin decides between two as long), and flies to a random point of
 * the next cell, 0 … 70 above its floor — 0x50 higher over the tank or the
 * jeep, and at the player's own cell at the player's eyes, 0x3c up. Boxed in,
 * it turns a quarter one way (a coin says which) and tries again, four times.
 *
 * ## How it ends
 *
 * A drone is a flying bomb. Reaching the player it goes off (0x40453f): the
 * shields and energy take the drone's damage (0x41195b), a burst over the
 * view, a shake, and a new drone comes in five cells off. Hit by any of the
 * player's shots it goes off where it is (0x4043d5), and its kill takes its
 * worth off the ENEMIES bar and scores 50 (25 indoors).
 */
import type { FrameV0 } from "@dreamfactory/engine/df/image-v0";
import { CELL, CELL_CENTRE } from "../data";
import type { Target } from "./weapons";
import { World, tooFar, type Obj } from "./world";

/** 0x40428b's two: the tank's and the jeep's cells (0x40836b, 0x41b1bc) */
export interface Grounded {
  o: Obj;
}

const HALF = 0x1e;

export class Drone {
  o: Obj = { angle: 0, x: 0, y: 0, z: 0, cellX: 0, cellY: 0 };
  /** +0x18 its step, +0x24 the steps to its point */
  v: [number, number, number] = [0, 0, 0];
  steps = 0;
  /** +0x28 */
  state = 0;
  /** +0x2c its burst is mirrored */
  mirror = false;
  /** +0x30: 1 shot down, −1 gone off at the player */
  hit = 0;
  /** +0x34 the step of its end, +0x38 the size of its burst */
  dying = 0;
  size = 0;
  /** +0x3c its three-picture spin */
  spin = 0;
  /** +0x40 which way it turns when boxed in, +0x44 how often more */
  way = 1;
  tries = 0;

  constructor(
    readonly w: World,
    /** `drone.in` / `drone.out`: 3 spins × 28 distances */
    readonly frames: FrameV0[],
    readonly ground: Grounded[],
  ) {}

  /** 0x403827: five cells off, round the player (0x40393a — the tank's way in) */
  spawn(): void {
    const w = this.w;
    const cands: Obj[] = [];
    const px = w.pose.x;
    const py = w.pose.y;
    const ways: [number, number, number, boolean][] = [
      [0x40, px, py - 5, true],
      [0xc0, px, py + 5, true],
      [0x80, px + 5, py, false],
      [0, px - 5, py, false],
    ];
    ways.forEach(([angle, x0, y0, across], dir) => {
      const add = (x: number, y: number): void => void cands.push({ angle, x: 0, y: 0, z: 0, cellX: x, cellY: y });
      if (w.pose.dir !== dir && !w.blocked(x0, y0)) add(x0, y0);
      let [ax, ay, bx, by] = [x0, y0, x0, y0];
      for (let k = 0; k < 5; k++) {
        if (across) (ax++, bx--);
        else (ay++, by--);
        if (!w.blocked(ax, ay)) add(ax, ay);
        if (!w.blocked(bx, by)) add(bx, by);
      }
    });
    if (!cands.length) throw new Error(`a drone: nowhere to come from around ${px},${py}`);
    const c = cands[w.roll(cands.length) - 1];
    this.o = { ...c, x: c.cellX * CELL + CELL_CENTRE, y: c.cellY * CELL + CELL_CENTRE, z: w.building ? 0xc8 : 0x74 };
    this.mirror = w.roll(2) - 1 === 1;
    this.state = 0;
    this.dying = 0;
    this.hit = 0;
    this.spin = 0;
  }

  /** 0x403ad5, for one drone: a shot's point within 0x1e of it every way downs it, whatever the shot */
  shotAt(s: Obj, dmg: number): boolean {
    const o = this.o;
    if (o.z - HALF > s.z || o.z + HALF < s.z) return false;
    if (o.x - HALF > s.x || o.x + HALF < s.x) return false;
    if (o.y - HALF > s.y || o.y + HALF < s.y) return false;
    this.w.sound(dmg > this.w.params.bullet ? 4 : 1);
    // a drone going off at the player is not spared: its end starts over as a kill's, at the step it had got to
    this.hit = 1;
    return true;
  }

  /** 0x403c01, for one drone */
  frame(): void {
    const w = this.w;
    if (this.hit > 0) return this.shotDown();
    if (this.hit < 0) return this.goOff();
    if (w.playerHit(this.o, w.params.droneShot)) {
      this.hit = -1;
      return this.goOff();
    }
    if (tooFar(w, this.o)) return this.spawn();
    this.think();
    const within = w.visible(this.o);
    if (!within) return;
    const pt = w.project(this.o);
    if (pt.depth < 0) return;
    const dist = Math.min(0x1b, Math.max(0, Math.trunc(pt.depth / 0x69)));
    const n = dist + this.spin * 0x1c;
    if (++this.spin >= 3) this.spin = 0;
    w.addFixed(within, pt.depth, pt.y, pt.x, this.frames[n], false);
  }

  /** 0x41d66d: the player down a row or a column, nothing between — only once `[0x42d110]` > 0 */
  private sees(): number | null {
    const w = this.w;
    if (w.state <= 0) return null;
    const { cellX: x, cellY: y } = this.o;
    const cx = w.cam.cellX;
    const cy = w.cam.cellY;
    if (x !== cx && y !== cy) return null;
    if (x === cx) {
      if (y < cy) {
        for (let k = y + 1; k <= cy; k++) if (w.blocked(x, k)) return null;
        return 0x40;
      }
      for (let k = y - 1; k >= cy; k--) if (w.blocked(x, k)) return null;
      return 0xc0;
    }
    if (x < cx) {
      for (let k = x + 1; k <= cx; k++) if (w.blocked(k, y)) return null;
      return 0;
    }
    for (let k = x - 1; k >= cx; k--) if (w.blocked(k, y)) return null;
    return 0x80;
  }

  /** 0x403d3b */
  private think(): void {
    const w = this.w;
    const o = this.o;
    switch (this.state) {
      case 0: {
        const a = this.sees();
        if (a !== null) {
          o.angle = a;
          this.state = 4;
          return;
        }
        const dx = o.cellX - w.cam.cellX;
        const dy = o.cellY - w.cam.cellY;
        // the longer way first: its heading and the cell it leads to, then the other's
        let [pa, px, py] = [0, o.cellX, o.cellY];
        let [sa, sx, sy] = [0, o.cellX, o.cellY];
        if (Math.abs(dx) > Math.abs(dy)) {
          if (dx > 0) (pa = 0x80), px--;
          else (pa = 0), px++, dx === 0 && (px = -1);
          if (dy > 0) (sa = 0xc0), sy--;
          else (sa = 0x40), sy++, dy === 0 && (sy = -1);
        } else {
          if (dy > 0) (pa = 0xc0), py--;
          else (pa = 0x40), py++, dy === 0 && (py = -1);
          if (dx > 0) (sa = 0x80), sx--;
          else (sa = 0), sx++, dx === 0 && (sx = -1);
        }
        if (Math.abs(dx) === Math.abs(dy) && w.roll(2) === 1) [pa, px, py, sa, sx, sy] = [sa, sx, sy, pa, px, py];
        if (!w.blocked(px, py)) {
          o.angle = pa;
          this.state = 4;
        } else if (!w.blocked(sx, sy)) {
          o.angle = sa;
          this.state = 4;
        } else {
          this.way = w.roll(2);
          this.turn();
          this.state = 6;
          this.tries = 4;
        }
        return;
      }
      case 4:
      case 6:
        this.steps = this.aimNext();
        this.state++;
        return;
      case 5:
      case 7:
        o.x += this.v[0];
        o.y += this.v[1];
        o.z += this.v[2];
        World.cellOf(o);
        if (--this.steps <= 0) this.state = this.state === 5 ? 0 : 8;
        return;
      case 8: {
        const a = this.sees();
        if (a !== null) {
          o.angle = a;
          this.state = 4;
          return;
        }
        if (--this.tries <= 0) {
          this.state = 0;
          return;
        }
        this.turn();
        this.state = 6;
        return;
      }
    }
  }

  /** states 4 and 6 (0x403f13, 0x40407c): a point of the next cell, and the steps there (0x40421d) */
  private aimNext(): number {
    const w = this.w;
    const o = this.o;
    const to = { x: o.cellX * CELL + CELL_CENTRE, y: o.cellY * CELL + CELL_CENTRE, z: w.building ? 0xc8 : 0x74 };
    to.x += w.roll(0x118) - 0x8c;
    to.y += w.roll(0x118) - 0x8c;
    to.z += w.roll(0x46);
    if (o.angle === 0) to.x += CELL;
    else if (o.angle === 0x40) to.y += CELL;
    else if (o.angle === 0x80) to.x -= CELL;
    else if (o.angle === 0xc0) to.y -= CELL;
    const cx = Math.trunc(to.x / CELL);
    const cy = Math.trunc(to.y / CELL);
    // 0x40428b: over the tank or the jeep
    if (this.ground.some((g) => g.o.cellX === cx && g.o.cellY === cy)) to.z += 0x50;
    if (w.cam.cellX === cx && w.cam.cellY === cy) (to.x = w.cam.x), (to.y = w.cam.y), (to.z = w.cam.z + 0x3c);
    const dx = to.x - o.x;
    const dy = to.y - o.y;
    const dz = to.z - o.z;
    const n = Math.trunc(Math.trunc(Math.sqrt(dx * dx + dy * dy + dz * dz)) / w.params.droneSpeed) + 1;
    this.v = [Math.trunc(dx / n), Math.trunc(dy / n), Math.trunc(dz / n)];
    return n;
  }

  /** 0x4042d2: a quarter turn `way`, else straight on, else the other quarter, else back */
  private turn(): void {
    const w = this.w;
    const d = this.way === 1 ? -0x40 : 0x40;
    let a = (this.o.angle + d) & 0xff;
    for (let k = 0; k < 4; k++) {
      if (!this.blockedToward(a)) {
        this.o.angle = a;
        return;
      }
      a = (a - d) & 0xff;
    }
    throw new Error(`a drone at ${this.o.cellX},${this.o.cellY} of ${w.maze.name}: boxed in`);
  }

  /** 0x404357 */
  private blockedToward(a: number): boolean {
    const { cellX: x, cellY: y } = this.o;
    const w = this.w;
    if (a === 0) return w.blocked(x + 1, y);
    if (a === 0x40) return w.blocked(x, y + 1);
    if (a === 0x80) return w.blocked(x - 1, y);
    return w.blocked(x, y - 1);
  }

  /** where it shows, for its end's pictures */
  private seen(): { within: ReturnType<World["visible"]>; pt: ReturnType<World["project"]> } {
    const within = this.w.visible(this.o);
    const pt = this.w.project(this.o);
    return { within: pt.depth < 0 ? null : within, pt };
  }

  /** 0x4043d5: shot down — a burst its distance's size, then its worth */
  private shotDown(): void {
    const w = this.w;
    const { within, pt } = this.seen();
    if (this.dying === 0) {
      w.sound(4);
      w.flashWith("CLUT129", 1, 2);
      this.size = Math.min(6, Math.max(0, Math.trunc(pt.depth / CELL)));
      if (within) w.addFixed(within, pt.depth, pt.y, pt.x, w.pyro[this.size], this.mirror);
      this.dying++;
    } else if (this.dying === 1) {
      if (within) w.addFixed(within, pt.depth, pt.y, pt.x, w.pyro[this.size + 7], this.mirror);
      w.enemiesBy(w.building ? -(w.params.droneWorth >> 1) : -w.params.droneWorth);
      w.scoreBy(w.building ? 0x19 : 0x32);
      this.spawn();
    }
    // any later step (a drone shot as it went off at the player) does nothing, and the slot stays so
  }

  /** 0x40453f: gone off at the player — a burst over the view, a shake, a flash */
  private goOff(): void {
    const w = this.w;
    const { within, pt } = this.seen();
    const burst = (n: number): void => {
      if (within) w.addFixed(within, -1, pt.y, pt.x, w.pyro[n], this.mirror);
    };
    switch (this.dying) {
      case 0:
        w.flashWith("CLUT129", 1, 1);
        break;
      case 1:
        w.sound(5);
        w.flashWith("CLUT129", 1, 2);
        burst(113);
        break;
      case 2:
        burst(114);
        break;
      case 3:
        burst(115);
        break;
      case 4:
        w.shakeAt(4);
        break;
      case 5:
        w.flashWith("CLUT134", 1, 1);
        break;
      case 6:
        w.flashWith("CLUT134", 1, 2);
        break;
      case 7:
        w.shakeAt(2);
        return this.spawn();
      default:
        return;
    }
    this.dying++;
  }
}

/** 0x403ad5: the drones as one target of the player's shots — the first a shot's point is at goes down */
export function dronesTarget(drones: Drone[]): Target {
  return {
    hit: (s, dmg) => (drones.some((d) => d.shotAt(s, dmg)) ? 1 : 0),
    at: () => null,
  };
}
