/**
 * The tank and the jeep — LUNICUS.EXE's 0x41ab08 … 0x41c88c and 0x407cac …
 * 0x409936, which are one piece of code twice: diffed with their globals
 * rebased they differ only in the constants below.
 *
 * ## Where one comes from (0x41ab8a)
 *
 * Five cells from the player along each of the four ways, and the cells beside
 * those five either side, whichever are open and not the player's; one of them
 * at random, facing the player. One that ends up nine cells away is sent back
 * the same way (0x41d79f).
 *
 * ## How one moves (0x41b3dd)
 *
 *   0  choose: toward the player's cell by the longer way, else the shorter,
 *      else turn off one way or the other (6)
 *   1  turn to the way; once facing it, fire if the player is down the line
 *      (4), else roll on to the next cell's centre (2)
 *   2  roll forward to it (the wall or the other vehicle: 9); 3 the same backward
 *   4  fire from where it stands while the player is down the line; now and
 *      then, the more it has been hit the likelier, back off (5) or come on
 *   5  sidestep across the line, or back off
 *   6, 7, 8  a detour: turn, roll a cell, count down
 *   9  stuck: back up to the cell's centre
 *
 * Its pictures are prerendered at 28 distances for nine headings, the other
 * seven mirrored, drawn with their foot on the screen's line 132 (0x41b1d5).
 */
import type { FrameV0 } from "@dreamfactory/engine/df/image-v0";
import { CELL, CELL_CENTRE } from "../data";
import { turnToward } from "../crew";
import { World, aim, along, shotWall, tooFar, type Obj } from "./world";

export interface VehicleKind {
  name: "tank" | "jeep";
  /** z standing, indoors and out */
  zIn: number;
  zOut: number;
  /** its hit box's half width and heights, indoors and out (0x41afbb, 0x40815c) */
  half: number;
  topIn: number;
  topOut: number;
  /** where a hit counts double: a band of z, indoors and out */
  critIn: [number, number];
  critOut: [number, number];
  /** the damage that kills it */
  dies: number;
  /** its chance to back off, in `roll(n)` against 5 × the damage taken, and to come on */
  fireRoll: number;
  fireCome: number;
  /** points, and a kill's worth off the ENEMIES bar */
  score: number;
  /** the frame the explosion stops going down at, below where it started */
  blast: number;
}

export const TANK: VehicleKind = {
  name: "tank", zIn: 0x6e, zOut: 0x46, half: 0x50, topIn: 0xc8, topOut: 0x6e,
  critIn: [0x96, 0x7fffffff], critOut: [0x46, 0x7fffffff], dies: 0x320, fireRoll: 0x2ee0, fireCome: 0xfa0, score: 300, blast: 8,
};
export const JEEP: VehicleKind = {
  name: "jeep", zIn: 0x6e, zOut: 0x50, half: 0x46, topIn: 0xc8, topOut: 0x78,
  critIn: [0x5f, 0x91], critOut: [0x32, 0x5a], dies: 0x1f4, fireRoll: 0x1d4c, fireCome: 0x9c4, score: 200, blast: 6,
};

/** one of its shells (0x42c2b8, ten slots of 0x30 bytes) */
interface Shell {
  on: boolean;
  /** it hit a wall last frame: show the burst and go */
  burst: boolean;
  life: number;
  v: [number, number, number];
  o: Obj;
}

export class Vehicle {
  o: Obj = { angle: 0, x: 0, y: 0, z: 0, cellX: 0, cellY: 0 };
  /** `+0x5f0` the state, `+0x60c` the heading or the coordinate it is going to */
  state = 0;
  goal = 0;
  /** `+0x614` which way a detour turns, `+0x610` its count, `+0x618` the fire's cool-down */
  turnWay = 1;
  count = 0;
  cool = 0;
  /** `+0x5f8` the damage it has taken */
  damage = 0;
  /** `+0x604` / `+0x5fc` … its explosion: mirrored, the step, the frame, the frame it stops at */
  mirror = false;
  dying = 0;
  blastFrame = 0;
  blastEnd = 0;
  /** `+0x18` its shots fired, for the tank's two guns taking turns */
  fired = 0;
  shells: Shell[] = Array.from({ length: 10 }, () => ({ on: false, burst: false, life: 0, v: [0, 0, 0], o: { angle: 0, x: 0, y: 0, z: 0, cellX: 0, cellY: 0 } }));
  /** `+0x5f4` a shell is in the air */
  shellsOut = false;
  /** the other vehicle, which it must not drive into */
  other: Vehicle | null = null;

  constructor(
    readonly w: World,
    readonly k: VehicleKind,
    /** 252 pictures: 9 headings × 28 distances */
    readonly frames: FrameV0[],
    /** `shared/pyro.`: its explosion is pictures 28 … 41 */
    readonly pyro: FrameV0[],
  ) {}

  get speed(): number {
    return this.k.name === "tank" ? this.w.params.tankSpeed : this.w.params.jeepSpeed;
  }
  get turn(): number {
    return this.k.name === "tank" ? this.w.params.tankTurn : this.w.params.jeepTurn;
  }

  /** 0x41c153 / 0x4092e6: the player's cells, the other vehicle's, or no cell at all */
  private blockedAt(x: number, y: number): boolean {
    const w = this.w;
    if ((w.target.x === x && w.target.y === y) || (w.cam.cellX === x && w.cam.cellY === y)) return true;
    if (this.other?.o.cellX === x && this.other.o.cellY === y) return true;
    return w.blocked(x, y);
  }

  /** 0x41ab8a */
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
      if (w.pose.dir !== dir && !this.blockedAt(x0, y0)) add(x0, y0);
      let [ax, ay, bx, by] = [x0, y0, x0, y0];
      for (let k = 0; k < 5; k++) {
        if (across) (ax++, bx--);
        else (ay++, by--);
        if (!this.blockedAt(ax, ay)) add(ax, ay);
        if (!this.blockedAt(bx, by)) add(bx, by);
      }
    });
    if (!cands.length) throw new Error(`${this.k.name}: nowhere to come from around ${px},${py}`);
    const c = cands[w.roll(cands.length) - 1];
    this.o = { ...c, x: c.cellX * CELL + CELL_CENTRE, y: c.cellY * CELL + CELL_CENTRE, z: w.building ? this.k.zIn : this.k.zOut };
    this.mirror = w.roll(2) - 1 === 1;
    this.dying = 0;
    this.state = 0;
    this.damage = 0;
    this.shellsOut = false;
    for (const s of this.shells) s.on = false;
  }

  /** 0x41afbb / 0x40815c: a player's shot at `s`; answers 0, a hit (1) or a hit in the weak band (2) */
  hit(s: Obj, dmg: number): number {
    const w = this.w;
    const top = w.building ? this.k.topIn : this.k.topOut;
    if (s.z > top || s.z < 0) return 0;
    const h = this.k.half;
    if (s.x < this.o.x - h || s.x > this.o.x + h || s.y < this.o.y - h || s.y > this.o.y + h) return 0;
    w.sound(dmg > w.params.bullet ? 4 : 1);
    let r = 1;
    this.damage += dmg;
    const [lo, hi] = w.building ? this.k.critIn : this.k.critOut;
    const inner = (s.x > this.o.x - 0x1e && s.x < this.o.x + 0x1e) || (s.y > this.o.y - 0x1e && s.y < this.o.y + 0x1e);
    if (s.z > lo && s.z < hi && inner) {
      this.damage += dmg >> 1;
      r = 2;
    }
    if (this.damage >= this.k.dies) this.damage = this.k.dies;
    return r;
  }

  /** a frame (0x41b1d5 / 0x408384) */
  frame(): void {
    const w = this.w;
    if (this.damage >= this.k.dies) return this.die();
    if (tooFar(w, this.o)) return this.spawn();
    this.think();
    const within = w.visible(this.o);
    if (!within) return;
    const pt = w.project(this.o);
    if (pt.depth < 0x19a) return;
    let a = (((w.cam.angle - this.o.angle + 8) & 0xff) >> 4);
    let mirror = false;
    if (a >= 9) {
      a = 16 - a;
      mirror = true;
    }
    const dist = Math.min(0x1b, Math.max(0, Math.trunc((pt.depth - 0x19a) / 0x69)));
    w.addFixed(within, pt.depth, 0x84, pt.x, this.frames[a * 28 + dist], mirror);
  }

  /** the cell ahead of its heading `a` (0x41bec5) */
  private ahead(a: number): [number, number] {
    const { cellX: x, cellY: y } = this.o;
    if (a === 0) return [x + 1, y];
    if (a === 0x40) return [x, y + 1];
    if (a === 0x80) return [x - 1, y];
    return [x, y - 1];
  }

  /** 0x41be48: the first way open of a quarter turn, straight on, and the other two */
  private detour(way: number): number | null {
    const step = way === 1 ? -0x40 : 0x40;
    let a = (this.o.angle + step) & 0xff;
    for (let k = 0; k < 4; k++) {
      if (!this.blockedAt(...this.ahead(a))) return a;
      a = (a - step) & 0xff;
    }
    return null;
  }

  /** the next cell's centre along the heading, as the coordinate that moves (0x41b60e) */
  private nextCentre(sign: 1 | -1): number {
    const a = this.o.angle;
    let v: number;
    if (a === 0) v = this.o.x + sign * CELL;
    else if (a === 0x40) v = this.o.y + sign * CELL;
    else if (a === 0x80) v = this.o.x - sign * CELL;
    else v = this.o.y - sign * CELL;
    return Math.trunc(v / CELL) * CELL + CELL_CENTRE;
  }

  /** 0x41d66d: the player in the same row or column with nothing between — only once `[0x42d110]` > 0 */
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

  /** move along the heading by `sign`; on reaching `goal` go to `then`; a blocked cell puts it back (states 2, 3, 7) */
  private roll(sign: 1 | -1, then: number): void {
    const { x, y } = this.o;
    const a = this.o.angle;
    const s = this.speed * sign;
    const ahead = (a === 0 || a === 0x40) === (sign === 1);
    if (a === 0 || a === 0x80) this.o.x += a === 0 ? s : -s;
    else this.o.y += a === 0x40 ? s : -s;
    const v = a === 0 || a === 0x80 ? "x" : "y";
    if (ahead ? this.o[v] >= this.goal : this.o[v] <= this.goal) {
      this.o[v] = this.goal;
      this.state = then;
    }
    World.cellOf(this.o);
    if (this.blockedAt(this.o.cellX, this.o.cellY)) {
      this.o.x = x;
      this.o.y = y;
      this.state = 9;
      World.cellOf(this.o);
    }
  }

  /** 0x41b3dd */
  private think(): void {
    const w = this.w;
    switch (this.state) {
      case 0: {
        const saw = this.sees();
        if (saw !== null) return void ((this.goal = saw), (this.state = 1));
        const { cellX: x, cellY: y } = this.o;
        const dx = x - w.cam.cellX;
        const dy = y - w.cam.cellY;
        let a: [number, number];
        let b: [number, number];
        let da: number;
        let db: number;
        if (Math.abs(dx) > Math.abs(dy)) {
          [da, a] = dx > 0 ? [0x80, [x - 1, y]] : [0, [dx === 0 ? -1 : x + 1, y]];
          [db, b] = dy > 0 ? [0xc0, [x, y - 1]] : [0x40, [x, dy === 0 ? -1 : y + 1]];
        } else {
          [da, a] = dy > 0 ? [0xc0, [x, y - 1]] : [0x40, [x, dy === 0 ? -1 : y + 1]];
          [db, b] = dx > 0 ? [0x80, [x - 1, y]] : [0, [dx === 0 ? -1 : x + 1, y]];
        }
        if (Math.abs(dx) === Math.abs(dy) && w.roll(2) === 1) [a, b, da, db] = [b, a, db, da];
        if (!this.blockedAt(...a)) {
          this.goal = da;
          this.state = 1;
          return;
        }
        if (!this.blockedAt(...b)) {
          this.goal = db;
          this.state = 1;
          return;
        }
        this.turnWay = w.roll(2);
        const d = this.detour(this.turnWay);
        if (d !== null) {
          this.goal = d;
          this.state = 6;
          this.count = 6;
        }
        return;
      }
      case 1:
        if (this.o.angle === this.goal) {
          if (this.w.downTheLine(this.o)) {
            this.state = 4;
            this.cool = 6;
            return;
          }
          this.goal = this.nextCentre(1);
          this.state = 2;
        } else this.o.angle = turnToward(this.o.angle, this.goal, this.turn);
        return;
      case 2:
        return this.roll(1, 0);
      case 3:
        return this.roll(-1, 0);
      case 4: {
        if (--this.cool < 0) {
          this.cool = 0;
          const hurt = this.damage * 5;
          if (w.roll(this.k.fireRoll) < hurt) {
            this.state = 5;
            return;
          }
          if (w.roll(this.k.fireRoll) < this.k.fireCome - hurt && this.forward()) return;
        }
        if (this.w.downTheLine(this.o)) {
          this.w.warnFrom(this.o);
          this.fire(0);
          if (this.k.name === "tank") this.fire(1);
          this.fired++;
        } else this.state = 0;
        return;
      }
      case 5: {
        if (this.sees() === null) {
          this.state = 0;
          return;
        }
        const { cellX: x, cellY: y } = this.o;
        let [da, db] = [0xc0, 0x40];
        let [a, b]: [number, number][] = [[x, y - 1], [x, y + 1]];
        if (!(this.o.angle === 0 || this.o.angle === 0x80)) {
          [da, db] = [0x80, 0];
          [a, b] = [[x - 1, y], [x + 1, y]];
        }
        if (w.roll(2) === 1) [a, b, da, db] = [b, a, db, da];
        for (const [c, d] of [[a, da], [b, db]] as [[number, number], number][]) {
          if (this.blockedAt(...c)) continue;
          this.state = 1;
          this.goal = d;
          if (w.roll(3) === 1) {
            this.state = 6;
            this.turnWay = w.roll(2);
            this.count = 5;
          }
          return;
        }
        if (!this.backward()) this.state = 0;
        return;
      }
      case 6:
        if (this.o.angle === this.goal) {
          this.goal = this.nextCentre(1);
          this.state = 7;
        } else this.o.angle = turnToward(this.o.angle, this.goal, this.turn);
        return;
      case 7:
        return this.roll(1, 8);
      case 8: {
        if (this.sees() !== null) {
          this.state = 1;
          return;
        }
        if (--this.count <= 0) {
          this.state = 0;
          return;
        }
        const d = this.detour(this.turnWay);
        if (d !== null) {
          this.goal = d;
          this.state = 6;
        }
        return;
      }
      case 9: {
        if (this.blockedAt(this.o.cellX, this.o.cellY)) throw new Error(`${this.k.name} stuck in a closed cell`);
        const v = this.o.angle === 0 || this.o.angle === 0x80 ? this.o.x : this.o.y;
        this.goal = Math.trunc(v / CELL) * CELL + CELL_CENTRE;
        this.state = 3;
        return;
      }
    }
  }

  /** 0x41bf51: a cell forward, if open */
  private forward(): boolean {
    if (this.blockedAt(...this.ahead(this.o.angle))) return false;
    this.goal = this.nextCentre(1);
    this.state = 2;
    return true;
  }

  /** 0x41c052: a cell back, if open */
  private backward(): boolean {
    if (this.blockedAt(...this.ahead((this.o.angle + 0x80) & 0xff))) return false;
    this.goal = this.nextCentre(-1);
    this.state = 3;
    return true;
  }

  /** 0x41c1ba / 0x40934d: a shell from the gun on `side` */
  private fire(side: number): void {
    const w = this.w;
    const s = this.shells.find((x) => !x.on);
    if (!s) return;
    s.on = true;
    s.burst = false;
    s.life = 0x14;
    s.o = { angle: 0, x: this.o.x, y: this.o.y, z: 0, cellX: 0, cellY: 0 };
    if (this.k.name === "tank") {
      const gun = (this.o.angle + (side ? 0x40 : -0x40)) & 0xff;
      const [sd, fw] = w.building ? [0x4e, 0x50] : [0x26, 0x14];
      s.o.z = this.o.z + (w.building ? 8 : 0x1e);
      const [gx, gy] = along(gun, sd);
      const [fx, fy] = along(this.o.angle, fw);
      s.o.x += gx + fx;
      s.o.y += gy + fy;
    } else {
      const [fx, fy] = along(this.o.angle, 0x28);
      s.o.x += fx;
      s.o.y += fy;
      s.o.z = this.o.z + (w.building ? 0x50 : 0x14);
    }
    aim(s, w.camObj(), 0x3c);
    if (this.fired & 1) {
      s.o.x += s.v[0];
      s.o.y += s.v[1];
      s.o.z += s.v[2];
    } else this.effect(s.o, 1);
    World.cellOf(s.o);
    w.sound(0);
  }

  /** its shells in flight (0x41c370 / 0x40945e) */
  shellsFrame(): void {
    const w = this.w;
    this.shellsOut = false;
    for (const s of this.shells) {
      if (!s.on) continue;
      this.shellsOut = true;
      if (s.burst) {
        this.effect(s.o, 3);
        s.on = false;
        continue;
      }
      if (--s.life < 0) {
        s.on = false;
        continue;
      }
      let gone = false;
      for (let step = 0; step < 2 && !gone; step++) {
        s.o.x += s.v[0];
        s.o.y += s.v[1];
        s.o.z += s.v[2];
        World.cellOf(s.o);
        if (shotWall(w, s.o)) {
          s.o.x -= s.v[0];
          s.o.y -= s.v[1];
          s.o.z -= s.v[2];
          World.cellOf(s.o);
          this.effect(s.o, 1);
          s.burst = true;
          gone = true;
        } else if (w.playerHit(s.o, this.k.name === "tank" ? w.params.tankHit : w.params.jeepHit)) {
          this.effect(s.o, 0);
          s.on = false;
          gone = true;
        }
      }
      if (!gone) this.effect(s.o, 0);
    }
  }

  /** 0x41331a / 0x413459: a shell's picture — in flight, a flash, a burst */
  private effect(o: Obj, kind: number): void {
    this.w.shotPicture(o, kind, this.k.name === "jeep");
  }

  /** 0x41c587 / 0x409675: the explosion, a step a frame */
  private die(): void {
    const w = this.w;
    const within = w.visible(this.o);
    const pt = w.project(this.o);
    const shows = !!within && pt.depth >= 0x19a;
    const draw = (): void => {
      if (shows) w.addFixed(within!, pt.depth, pt.y, pt.x, this.pyro[28 + this.blastFrame], this.mirror);
    };
    const tank = this.k.name === "tank";
    const s = this.dying;
    if (s === 0) {
      w.flashWith("CLUT129", 1, 1);
    } else if (s === 1) {
      w.sound(5);
      w.flashWith("CLUT129", 1, 2);
      w.say(0);
      this.blastFrame = Math.max(0, Math.trunc((pt.depth - 0x19a) / 0xd2));
      if (this.blastFrame >= 14) throw new Error(`${this.k.name}: blast frame ${this.blastFrame}`);
      this.blastEnd = this.blastFrame - this.k.blast;
      draw();
    } else if (s === 2) {
      this.blastFrame = Math.max(0, this.blastFrame - 1);
      draw();
      if (!(this.blastFrame <= this.blastEnd || this.blastFrame <= 0)) return;
    } else if (tank ? s === 11 : s === 7) {
      w.shakeAt(1);
      w.scoreBy(w.building ? this.k.score >> 1 : this.k.score);
      const worth = tank ? w.params.tankWorth : w.params.jeepWorth;
      w.enemiesBy(w.building ? -(worth >> 1) : -worth);
      return this.spawn();
    } else if (tank) {
      const e = this.blastEnd;
      if (s === 3 && e < 0) w.shakeAt(5);
      if (s === 4 && e < -1) w.shakeAt(5);
      if (s === 5 && e < -2) w.flashWith("CLUT131", 1, 1);
      if (s === 6 && e < -3) w.flashWith("CLUT131", 1, 1);
      if (s === 7 && e < -4) w.flashWith("CLUT131", 1, 2);
      if (s === 8 && e < -5) w.flashWith("CLUT131", 1, 2);
      if (s === 9) w.shakeAt(2);
    } else {
      const e = this.blastEnd;
      if (s === 3 && e < 0) w.shakeAt(5);
      if (s === 4 && e < -1) w.flashWith("CLUT131", 1, 1);
      if (s === 5 && e < -2) w.flashWith("CLUT131", 1, 2);
    }
    this.dying++;
  }

  /** the cell it stands in, for the player's rockets and moves (0x41b1bc) */
  cell(): [number, number] {
    return [this.o.cellX, this.o.cellY];
  }
}
