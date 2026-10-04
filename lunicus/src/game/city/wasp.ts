/**
 * The wasp, and the node that takes its place — LUNICUS.EXE 0x41dd08 …
 * 0x41fec8. One slot (0x42c9d0) holds either: a wasp while the city's ENEMIES
 * bar has something left (and always indoors), the node once it is empty.
 *
 * ## How it flies (0x41e5f6)
 *
 * It keeps a cell of its own (`[0x42c9e0]`) and sits at that cell's edge,
 * 0xd2 back from the centre along its heading. At each cell it picks a way —
 * the one toward the player by the longer way first, the other then, back the
 * way it came last, once in ten a random one of the other two — and flies it:
 * straight to the next cell (1), round a corner on a quarter circle of radius
 * 0xd2 (2, 3), or at a dead end to the centre, a half turn and out again (4,
 * 5, 6). Down its heading at the player it fires: a wasp two shells, the node
 * one.
 *
 * ## How it dies (0x41f96a)
 *
 * A wasp at 250 damage — and in the city with the ENEMIES bar empty, at the
 * first hit — explodes, scores 800 (400 indoors), takes its worth off the
 * bar and is replaced. The node at 2500 explodes in thirteen steps, scores
 * 2000 and sets `[0x42d110]` to 1: the day's city is done.
 */
import type { FrameV0 } from "@dreamfactory/engine/df/image-v0";
import { CELL, CELL_CENTRE } from "../data";
import { turnToward } from "../crew";
import type { Target } from "./weapons";
import { World, aim, along, shotWall, tooFar, type Obj } from "./world";

interface Shell {
  on: boolean;
  burst: boolean;
  life: number;
  v: [number, number, number];
  o: Obj;
}

const EDGE = 0xd2;

/** the coordinate `d` ahead along its quarter heading */
function ahead(o: Obj, d: number): number {
  if (o.angle === 0) return o.x + d;
  if (o.angle === 0x40) return o.y + d;
  if (o.angle === 0x80) return o.x - d;
  return o.y - d;
}

/** the cell beside `x`, `y` the way the quarter `a` goes */
function beside(a: number, x: number, y: number): [number, number] {
  if (a === 0) return [x + 1, y];
  if (a === 0x40) return [x, y + 1];
  if (a === 0x80) return [x - 1, y];
  return [x, y - 1];
}

export class Wasp implements Target {
  o: Obj = { angle: 0, x: 0, y: 0, z: 0, cellX: 0, cellY: 0 };
  /** `[0x42cfe0]` a wasp, not the node */
  wasp = true;
  /** `[0x42cfc0]` the flight's state, `[0x42cfdc]` its goal, `[0x42cfe8]` the arc's centre, `[0x42cff0]` the arc's turn */
  state = 0;
  goal = 0;
  arc: [number, number] = [0, 0];
  arcTurn = 1;
  /** `[0x42cfc8]` its damage */
  damage = 0;
  /** `[0x42cfcc]` … its explosion */
  dying = 0;
  blastFrame = 0;
  blastEnd = 0;
  mirror = false;
  /** `[0x42cfe4]` the node's three-picture spin */
  spin = 0;
  /** `[0x42c9e8]` shells fired */
  fired = 0;
  shells: Shell[] = Array.from({ length: 10 }, () => ({ on: false, burst: false, life: 0, v: [0, 0, 0], o: { angle: 0, x: 0, y: 0, z: 0, cellX: 0, cellY: 0 } }));
  /** `[0x42cfc4]` a shell is in the air */
  shellsOut = false;
  frames: FrameV0[] = [];

  constructor(
    readonly w: World,
    /** the wasp's 252 pictures (`wasp.in` / `wasp.out`) and the node's 84 (`node`) */
    readonly waspFrames: FrameV0[],
    readonly nodeFrames: FrameV0[],
  ) {}

  /** 0x41ddf2: a new wasp — or, in the city with the bar empty, the node */
  spawn(): void {
    const w = this.w;
    if (!w.building && w.g.enemies <= 0 && this.wasp) this.wasp = false;
    this.frames = this.wasp ? this.waspFrames : this.nodeFrames;
    const cands: [number, number, number][] = [];
    const px = w.pose.x;
    const py = w.pose.y;
    const ways: [number, number, number, boolean][] = [
      [0x40, px, py - 5, true],
      [0xc0, px, py + 5, true],
      [0x80, px + 5, py, false],
      [0, px - 5, py, false],
    ];
    ways.forEach(([angle, x0, y0, across], dir) => {
      if (w.pose.dir !== dir && !w.blocked(x0, y0)) cands.push([angle, x0, y0]);
      let [ax, ay, bx, by] = [x0, y0, x0, y0];
      for (let k = 0; k < 5; k++) {
        if (across) (ax++, bx--);
        else (ay++, by--);
        if (!w.blocked(ax, ay)) cands.push([angle, ax, ay]);
        if (!w.blocked(bx, by)) cands.push([angle, bx, by]);
      }
    });
    if (!cands.length) throw new Error(`the wasp: nowhere to come from around ${px},${py}`);
    const [angle, cx, cy] = cands[w.roll(cands.length) - 1];
    const [bx, by] = along(angle, EDGE);
    this.o = { angle, x: cx * CELL + CELL_CENTRE - bx, y: cy * CELL + CELL_CENTRE - by, z: w.building ? 0x13a : 0x126, cellX: cx, cellY: cy };
    this.mirror = w.roll(2) - 1 === 1;
    this.dying = 0;
    this.state = 0;
    this.damage = 0;
    this.spin = 0;
    for (const s of this.shells) s.on = false;
  }

  at(): Obj | null {
    return this.o;
  }

  /** 0x41e176 */
  hit(s: Obj, dmg: number): number {
    const w = this.w;
    const inside = (half: number, lo: number, hi: number): boolean =>
      s.z >= lo && s.z <= hi && s.x >= this.o.x - half && s.x <= this.o.x + half && s.y >= this.o.y - half && s.y <= this.o.y + half;
    if (this.wasp) {
      if (w.building ? !inside(0x32, 0x112, 0x14e) : !inside(0x5a, 0xfe, 0x13a)) return 0;
      w.sound(dmg > w.params.bullet ? 4 : 1);
      this.damage = Math.min(0xfa, this.damage + dmg);
      if (!w.building && w.g.enemies <= 0) this.damage = 0xfa;
      return 1;
    }
    if (!inside(0x46, 0xe0, 0x14e)) return 0;
    w.sound(dmg > w.params.bullet ? 4 : 1);
    if (w.g.energy > 0) {
      this.damage = Math.min(0x9c4, this.damage + dmg);
      if (this.damage >= 0x9c4 && w.state === 0) w.state = -1;
    }
    return 1;
  }

  /** 0x41e3da */
  frame(): void {
    const w = this.w;
    if (!this.wasp) w.radarOn = true;
    if (this.damage >= (this.wasp ? 0xfa : 0x9c4)) return this.die();
    if (tooFar(w, this.o)) return this.spawn();
    this.fly();
    const within = w.visible(this.o);
    if (!within) return;
    const pt = w.project(this.o);
    if (pt.depth < 0x19a) return;
    const dist = Math.min(0x1b, Math.max(0, Math.trunc((pt.depth - 0x19a) / 0x69)));
    if (this.wasp) {
      let a = ((w.cam.angle - this.o.angle + 8) & 0xff) >> 4;
      let mirror = false;
      if (a >= 9) {
        a = 16 - a;
        mirror = true;
      }
      w.addFixed(within, pt.depth, 0x84, pt.x, this.frames[a * 28 + dist], mirror);
    } else {
      const f = (this.spin >> 1) * 28 + dist;
      this.spin = (this.spin + 1) % 6;
      w.addFixed(within, pt.depth, 0x84, pt.x, this.frames[f], false);
    }
  }

  /** 0x41f1fa: the cell beyond its own the way `a` goes is shut */
  private shut(a: number): boolean {
    const { cellX: x, cellY: y } = this.o;
    return this.w.blocked(...beside(a, x, y));
  }

  /** 0x41f155: into the next cell, at its edge, choosing again */
  private nextCell(): void {
    const a = this.o.angle;
    if (a === 0) this.o.cellX++;
    else if (a === 0x40) this.o.cellY++;
    else if (a === 0x80) this.o.cellX--;
    else this.o.cellY--;
    const [bx, by] = along(a, EDGE);
    this.o.x = this.o.cellX * CELL + CELL_CENTRE - bx;
    this.o.y = this.o.cellY * CELL + CELL_CENTRE - by;
    this.state = 0;
  }

  /** the ways to try at a cell, by its heading and where the player is (0x41e613 … 0x41ea28) */
  private ways(): [number, number, number] {
    const w = this.w;
    const dx = this.o.cellX - w.cam.cellX;
    const dy = this.o.cellY - w.cam.cellY;
    const r2 = (): boolean => w.roll(2) === 1;
    const ax = Math.abs(dx);
    const ay = Math.abs(dy);
    switch (this.o.angle) {
      case 0:
        if (ax > ay) {
          if (dx < 0) return dy > 0 || (dy === 0 && r2()) ? [0, 0xc0, 0x40] : [0, 0x40, 0xc0];
          return dy > 0 || (dy === 0 && r2()) ? [0xc0, 0x40, 0] : [0x40, 0xc0, 0];
        }
        return dy < 0 ? [0x40, 0, 0xc0] : [0xc0, 0, 0x40];
      case 0x40:
        if (ax < ay) {
          if (dy < 0) return dx < 0 || (dx === 0 && r2()) ? [0x40, 0, 0x80] : [0x40, 0x80, 0];
          return dx < 0 || (dx === 0 && r2()) ? [0, 0x80, 0x40] : [0x80, 0, 0x40];
        }
        return dx < 0 ? [0, 0x40, 0x80] : [0x80, 0x40, 0];
      case 0x80:
        if (ax > ay) {
          if (dx > 0) return dy > 0 || (dy === 0 && r2()) ? [0x80, 0xc0, 0x40] : [0x80, 0x40, 0xc0];
          return dy > 0 || (dy === 0 && r2()) ? [0xc0, 0x40, 0x80] : [0x40, 0xc0, 0x80];
        }
        return dy < 0 ? [0x40, 0x80, 0xc0] : [0xc0, 0x80, 0x40];
      case 0xc0:
        if (ax < ay) {
          if (dy > 0) return dx < 0 || (dx === 0 && r2()) ? [0xc0, 0, 0x80] : [0xc0, 0x80, 0];
          return dx < 0 || (dx === 0 && r2()) ? [0, 0x80, 0xc0] : [0x80, 0, 0xc0];
        }
        return dx < 0 ? [0, 0xc0, 0x80] : [0x80, 0xc0, 0];
    }
    throw new Error(`the wasp's heading ${this.o.angle} is no quarter`);
  }

  /** 0x41e5f6 */
  private fly(): void {
    const w = this.w;
    const speed = w.params.waspSpeed;
    const o = this.o;
    switch (this.state) {
      case 0: {
        const [first, second, third] = this.ways();
        if (!this.shut(first)) {
          this.goal = first;
          if (w.roll(10) <= 1) {
            if (!this.shut(second)) this.goal = second;
            else if (!this.shut(third)) this.goal = third;
          }
        } else if (!this.shut(second)) this.goal = second;
        else if (!this.shut(third)) this.goal = third;
        else {
          this.state = 4;
          this.goal = ahead(o, EDGE);
          return this.fly();
        }
        if (this.goal === o.angle) {
          this.state = 1;
          this.goal = ahead(o, CELL);
          return this.fly();
        }
        this.arc = [o.x, o.y];
        const a = o.angle;
        const g = this.goal;
        const corner = (state: number, axis: 0 | 1, by: number): void => {
          this.state = state;
          this.arc[axis] += by;
        };
        if (a === 0) {
          if (g === 0xc0) corner(2, 1, -EDGE);
          if (g === 0x40) corner(3, 1, EDGE);
        } else if (a === 0x40) {
          if (g === 0) corner(2, 0, EDGE);
          if (g === 0x80) corner(3, 0, -EDGE);
        } else if (a === 0x80) {
          if (g === 0xc0) corner(3, 1, -EDGE);
          if (g === 0x40) corner(2, 1, EDGE);
        } else {
          if (g === 0) corner(3, 0, EDGE);
          if (g === 0x80) corner(2, 0, -EDGE);
        }
        this.arcTurn = Math.trunc(0x1900 / Math.trunc(0x8084 / speed));
        return this.fly();
      }
      case 1: {
        if (this.lineOfFire()) {
          this.w.warnFrom(o);
          if (this.wasp) {
            this.fire(0);
            this.fire(1);
          } else this.fireNode();
          this.fired++;
        }
        if (this.advance(speed)) this.nextCell();
        return;
      }
      case 2:
      case 3: {
        o.angle = turnToward(o.angle, this.goal, this.arcTurn);
        if (o.angle === this.goal) return this.nextCell();
        const [rx, ry] = along((o.angle + (this.state === 2 ? 0x40 : -0x40)) & 0xff, EDGE);
        o.x = this.arc[0] + rx;
        o.y = this.arc[1] + ry;
        return;
      }
      case 4: {
        if (!this.advance(speed)) return;
        if (o.angle === 0 || o.angle === 0x80) o.x = this.goal;
        else o.y = this.goal;
        this.state = 5;
        this.goal = (o.angle + 0x80) & 0xff;
        return;
      }
      case 5: {
        o.angle = turnToward(o.angle, this.goal, w.params.waspTurn);
        if (o.angle !== this.goal) return;
        this.state = 6;
        this.goal = ahead(o, EDGE);
        return;
      }
      case 6: {
        if (this.advance(speed)) this.nextCell();
        return;
      }
    }
  }

  /** on along its quarter heading by `speed`; at or past the goal */
  private advance(speed: number): boolean {
    const o = this.o;
    const a = o.angle;
    if (a === 0) {
      o.x += speed;
      return o.x >= this.goal;
    }
    if (a === 0x40) {
      o.y += speed;
      return o.y >= this.goal;
    }
    if (a === 0x80) {
      o.x -= speed;
      return o.x <= this.goal;
    }
    o.y -= speed;
    return o.y <= this.goal;
  }

  /** 0x41d500 */
  private lineOfFire(): boolean {
    return this.w.downTheLine(this.o);
  }

  /** 0x41f286: a wasp's shell from one side */
  private fire(side: number): void {
    const w = this.w;
    const s = this.shells.find((x) => !x.on);
    if (!s) return;
    Object.assign(s, { on: true, burst: false, life: 0x14 });
    const gun = (this.o.angle + (side ? 0x40 : -0x40)) & 0xff;
    const [sd, fw, dz] = w.building ? [0x24, 0x50, -6] : [0x14, 0x3c, -0xc];
    const [gx, gy] = along(gun, sd);
    const [fx, fy] = along(this.o.angle, fw);
    s.o = { angle: 0, x: this.o.x + gx + fx, y: this.o.y + gy + fy, z: this.o.z + dz, cellX: 0, cellY: 0 };
    aim(s, w.camObj(), 0x3c);
    if (this.fired & 1) {
      s.o.x += s.v[0];
      s.o.y += s.v[1];
      s.o.z += s.v[2];
      World.cellOf(s.o);
    } else {
      World.cellOf(s.o);
      w.shotPicture(s.o, 1);
    }
    w.sound(0);
  }

  /** 0x41f43c: the node's shell */
  private fireNode(): void {
    const w = this.w;
    const s = this.shells.find((x) => !x.on);
    if (!s) return;
    Object.assign(s, { on: true, burst: false, life: 0x14 });
    const [fx, fy] = along(this.o.angle, 0x3c);
    s.o = { angle: 0, x: this.o.x + fx, y: this.o.y + fy, z: this.o.z - 0x46, cellX: 0, cellY: 0 };
    aim(s, w.camObj(), 0x3c);
    if (this.fired & 1) {
      s.o.x += s.v[0];
      s.o.y += s.v[1];
      s.o.z += s.v[2];
    } else w.shotPicture(s.o, 1, true);
    World.cellOf(s.o);
    w.sound(2);
  }

  /** 0x41f534 */
  shellsFrame(): void {
    const w = this.w;
    this.shellsOut = false;
    const node = !this.wasp;
    const dmg = node ? w.params.nodeShot : w.params.waspShot;
    for (const s of this.shells) {
      if (!s.on) continue;
      this.shellsOut = true;
      if (s.burst) {
        w.shotPicture(s.o, node ? 2 : 3, node);
        s.on = false;
        continue;
      }
      if (--s.life < 0) {
        s.on = false;
        continue;
      }
      let gone = false;
      for (let k = 0; k < 2 && !gone; k++) {
        s.o.x += s.v[0];
        s.o.y += s.v[1];
        s.o.z += s.v[2];
        World.cellOf(s.o);
        if (shotWall(w, s.o)) {
          s.o.x -= s.v[0];
          s.o.y -= s.v[1];
          s.o.z -= s.v[2];
          World.cellOf(s.o);
          w.shotPicture(s.o, 1, node);
          s.burst = true;
          gone = true;
        } else if (w.playerHit(s.o, dmg)) {
          w.shotPicture(s.o, 0, node);
          s.on = false;
          gone = true;
        }
      }
      if (!gone) w.shotPicture(s.o, 0, node);
    }
  }

  /** 0x41f96a */
  private die(): void {
    const w = this.w;
    const within = w.visible(this.o);
    const pt = w.project(this.o);
    const shows = !!within && pt.depth >= 0x19a;
    const draw = (): void => {
      if (shows) w.addFixed(within!, pt.depth, pt.y, pt.x, w.pyro[28 + this.blastFrame], this.mirror);
    };
    const s = this.dying;
    const e = this.blastEnd;
    if (s === 0) w.flashWith("CLUT129", 1, 1);
    else if (s === 1) {
      w.sound(5);
      w.flashWith("CLUT129", 1, 2);
      w.say(0);
      this.blastFrame = Math.max(0, Math.trunc((pt.depth - 0x19a) / 0xd2));
      if (this.blastFrame >= 14) throw new Error(`the ${this.wasp ? "wasp" : "node"}: blast frame ${this.blastFrame}`);
      this.blastEnd = this.blastFrame - (this.wasp ? 6 : 8);
      draw();
    } else if (s === 2) {
      this.blastFrame = Math.max(0, this.blastFrame - 1);
      draw();
      if (!(this.blastFrame <= this.blastEnd || this.blastFrame <= 0)) return;
    } else if (this.wasp) {
      if (s === 3 && e < 0) w.shakeAt(5);
      if (s === 4 && e < -1) w.flashWith("CLUT131", 1, 1);
      if (s === 5 && e < -2) w.flashWith("CLUT131", 1, 2);
      if (s === 7) {
        w.shakeAt(1);
        w.scoreBy(w.building ? 0x190 : 0x320);
        w.enemiesBy(w.building ? -(w.params.waspWorth >> 1) : -w.params.waspWorth);
        return this.spawn();
      }
    } else {
      if (s === 3 && e < 0) w.shakeAt(5);
      if (s === 4 && e < -1) w.shakeAt(5);
      if (s === 5 && e < -2) w.flashWith("CLUT131", 1, 1);
      if (s === 6 && e < -3) w.flashWith("CLUT131", 1, 1);
      if (s === 7 && e < -4) w.flashWith("CLUT131", 1, 2);
      if (s === 8 && e < -5) w.flashWith("CLUT131", 1, 2);
      if (s === 9) w.shakeAt(2);
      if (s === 11) w.shakeAt(1);
      if (s === 12) {
        w.scoreBy(0x7d0);
        w.state = 1;
      }
      if (s > 12) return;
    }
    this.dying++;
  }
}
