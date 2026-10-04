/**
 * The bikes — RAVEN.EXE 0x401684 … 0x402ea4: up to four (`[0x43cf82]` by the
 * difficulty) of the EXE's 0x88-byte records at 0x434020, riding the streets
 * 0xa0 up from one cell's edge to the next and firing along the street when
 * the craft is down it, and their shots, 16 of 0x34 bytes at 0x434240.
 *
 * ## Where one comes from (0x401756)
 *
 * Seven cells ahead of the craft's pose, beside its line one side or the other
 * (a roll of 2), and on outward along the line while that cell is a block;
 * it faces across the line, starts at its cell's edge behind it, up to 0x40
 * off to the side, and its height is spread by its slot, ±0x1e about 0xa0.
 * One time in eight, while fewer than two pieces of wreckage are up and the
 * flight is on, it carries a pod to drop. It comes 200 … 400 frames into the
 * flight, and when it is gone (killed, or nine cells from the craft: 0x427afd)
 * after 100 frames the first time, 10 fewer each time after (0x401729).
 *
 * ## How one moves (0x401ca4)
 *
 *   0  choose (0x431070's cases): the way toward the craft first — along the
 *      axis it is farther off on — else the others, one time in ten the second
 *      or third even when the first is open; only the city's blocks stop it
 *      (0x402724). The way it faces rides on; another turns a quarter circle
 *      about the cell's corner, at a step a frame of speed·64 / (r·π/2).
 *   1, 2  ride along x or y at its speed to the cell's edge, wobbling up to
 *      0x40 across the street, firing while the craft is down the line
 *   3, 4  turn a corner, left or right
 *   5  killed and tumbling (0x402afa): turning 0x20 a frame, falling 1 faster,
 *      until it meets the ground or a block and bursts
 *
 * At the edge it is in the next cell (0x4026c6) and chooses again.
 *
 * ## Its shots (0x4027bd, 0x40289e)
 *
 * Every `[0x43cf7e]` frames while it fires: from 10 ahead, 0x3c a step at the
 * weapons ship, the fuel station or the craft (0x4276cb), for 0x14 frames;
 * into a block or the ground it is gone, into ours 0x15 strong (0x41b7a9).
 * Riding into the craft rams it for 0x10e (0x41b820).
 *
 * ## A kill (0x402afa)
 *
 * A shot within its reach + 0x14 on every axis takes the damage off its
 * strength (`[0x43cfae]`); at nothing it is $15 (`[0x43cf76]`) and, one time in
 * four, tumbles (5); else it bursts where it is.
 *
 * Its pictures (BIKE, 0x129 of them) are 33 distances by 9 headings, picture
 * d + 33·h at (depth − 0x20) / 0x40 — the 33rd, 0x20, for any depth from 0x4a
 * to 0x76 — and the heading toward the eye h in sixteenths, the other seven
 * mirrored (0x401a8c). Some containers are empty (no picture).
 */
import type { FrameV0 } from "@dreamfactory/engine/df/image-v0";
import type { Rect } from "@dreamfactory/engine/v0/screen";
import type { BikeApi } from "./api";
import { aimAt, downTheLine, inBlock, meets, tooFar, turnToward, type EnemyShot } from "./lib";
import { KIND, abs, copyObj, cosMul, dist, inside, newObj, readPictures, setObj, sinMul, type Obj, type Pt, type World } from "./world";

/** `pyro`'s pictures the bikes draw (0x4379d0 + 4·index; src/game/combat/pyro.ts PIC) */
const SHELL = 0x08;
const BLAST = 0xc0;
const CHIP = 0xe0;
const HIT = 0x108;

/** the state a dying bike is in (0x402c35) */
const DYING = 5;

/** a bike, the EXE's 0x88 bytes at 0x434020 (its object the first 0x18) */
interface BikeRec extends Obj {
  /** +0x18 where it was at the frame's start */
  last: Obj;
  /** +0x30 the state (0x431058) */
  state: number;
  /** +0x34 the heading it is turning to */
  goal: number;
  /** +0x38, +0x3c the point it is going to: the cell's edge, or in a turn the corner it turns about */
  goalX: number;
  goalY: number;
  /** +0x40 riding: 1 up x or y, 0 down; turning: the step a frame */
  way: number;
  /** +0x44 its speed (`[0x43cf7a]`) */
  speed: number;
  /** +0x48 a turn's radius */
  radius: number;
  /** +0x4c its strength (`[0x43cfae]`) */
  strength: number;
  /** +0x50 frames to its next shot */
  reload: number;
  /** +0x54 its picture's rect last frame, at least 0x14 square; +0x5c its depth; +0x60 it was drawn (for the aim) */
  rect: Rect;
  depth: number;
  shown: number;
  /** +0x64 it drops a pod when it is killed */
  pod: number;
  /** +0x68 its slot while it is up, −1 while it is not */
  self: number;
  /** +0x6c, +0x70, +0x74 a tumble's step */
  vx: number;
  vy: number;
  vz: number;
  /** +0x78 its engine is still to be heard (once it comes near) */
  engine: number;
  /** +0x7c its slot; +0x80 frames till it comes; +0x84 the wait the next time it goes */
  slot: number;
  wait: number;
  nextWait: number;
}

/** a bike's shot, the EXE's 0x34 bytes at 0x434240 */
interface BikeShot extends EnemyShot {
  /** +0x00 */
  on: number;
  /** +0x04 always 0 (no decoy draws it, 0x4276cb) */
  kind: number;
  /** +0x08 what it met: 0 nothing, 1 a block or the ground, 2 ours */
  met: number;
  /** +0x0c frames left */
  life: number;
  /** +0x10, +0x14, +0x18 its step */
  vx: number;
  vy: number;
  vz: number;
  /** +0x1c where it is */
  o: Obj;
}

/** 0x402d39's copy of a record's object */
const objOf = (r: Obj): Obj => ({ angle: r.angle, x: r.x, y: r.y, z: r.z, cellX: r.cellX, cellY: r.cellY });

export class Bike implements BikeApi {
  /** 0x433b7c: BIKE's pictures (0x401684) */
  private readonly pics: (FrameV0 | undefined)[];
  /** 0x434020 */
  private readonly recs: BikeRec[] = [];
  /** 0x434240 */
  private readonly shots: BikeShot[] = Array.from({ length: 0x10 }, () => ({ on: 0, kind: 0, met: 0, life: 0, vx: 0, vy: 0, vz: 0, o: newObj() }));

  constructor(
    readonly w: World,
    pictures: Uint8Array,
  ) {
    this.pics = readPictures(pictures);
  }

  /** `[0x43cf82]` */
  private get n(): number {
    return this.w.params.x43cf82;
  }

  /** `[0x433b78]`: `pyro`'s pictures (0x41928d) */
  private pyro(i: number): FrameV0 | undefined {
    return this.w.pyro.pics[i];
  }

  /** 0x4016c5: every bike to come in 200 … 400 frames, the first wait after 100; the shots off (0x4027a2) */
  reset(): void {
    const w = this.w;
    if (this.n > 4) throw new Error("0x4016c5: more than four bikes (0x41e28a 0x6b, 1)");
    this.recs.length = 0;
    for (let i = 0; i < this.n; i++) {
      const r: BikeRec = {
        ...newObj(), last: newObj(), state: 0, goal: 0, goalX: 0, goalY: 0, way: 0, speed: 0, radius: 0, strength: 0, reload: 0,
        rect: [0, 0, 0, 0], depth: 0, shown: 0, pod: 0, self: -1, vx: 0, vy: 0, vz: 0, engine: 0, slot: i, wait: 0, nextWait: 0,
      };
      r.wait = w.roll(0xc8) + 0xc8;
      r.nextWait = 0x64;
      this.recs.push(r);
    }
    for (const s of this.shots) s.on = 0;
  }

  /** 0x401729: gone — back in `+0x84` frames, the next time 10 fewer; no missile homes on it */
  private gone(r: BikeRec): void {
    r.self = -1;
    r.wait = r.nextWait;
    r.nextWait -= 0xa;
    this.w.pyro.forget(r);
  }

  /** 0x401756: a bike comes in, seven cells ahead of the pose (the pose's facing by 0x431028) */
  private comeIn(r: BikeRec): void {
    const w = this.w;
    r.self = r.slot;
    let angle = 0;
    let x = 0;
    let y = 0;
    switch (w.poseDir) {
      case 0:
      case 1: {
        const dy = w.poseDir === 0 ? -1 : 1;
        y = w.poseY + 7 * dy;
        if (w.roll(2) === 1) {
          angle = 0x80;
          x = w.poseX + 1;
        } else {
          x = w.poseX - 1;
        }
        while (w.solid(x, y)) y += dy;
        break;
      }
      case 2:
      case 3: {
        const dx = w.poseDir === 2 ? 1 : -1;
        x = w.poseX + 7 * dx;
        if (w.roll(2) === 1) {
          angle = 0xc0;
          y = w.poseY + 1;
        } else {
          angle = 0x40;
          y = w.poseY - 1;
        }
        while (w.solid(x, y)) x += dx;
        break;
      }
    }
    r.angle = angle;
    r.cellX = x;
    r.cellY = y;
    r.x = (r.cellX << 8) + 0x80;
    r.y = (r.cellY << 8) + 0x80;
    r.z = 0xa0;
    if (this.n !== 0) r.z += Math.trunc((r.self * 0x3c + 0x3c) / this.n) - 0x1e;
    switch (r.angle) {
      case 0:
        r.x -= 0x80;
        r.y += w.roll(0x81) - 0x41;
        break;
      case 0x40:
        r.y -= 0x80;
        r.x += w.roll(0x81) - 0x41;
        break;
      case 0x80:
        r.x += 0x80;
        r.y += w.roll(0x81) - 0x41;
        break;
      case 0xc0:
        r.y += 0x80;
        r.x += w.roll(0x81) - 0x41;
        break;
    }
    r.speed = w.params.x43cf7a;
    r.state = 0;
    r.shown = 0;
    r.reload = 0;
    r.strength = w.params.x43cfae;
    setObj(r.last, r);
    r.pod = 0;
    if (w.pyro.wreckage() < 2 && w.roll(8) === 1 && w.state < 2) r.pod = 1;
    r.engine = 1;
  }

  /** 0x401a5a: a frame of every bike, then their shots */
  frame(): void {
    for (const r of this.recs) this.frameOf(r);
    this.moveShots();
  }

  /** 0x401a8c: one bike's frame — come in, move, ram the craft, and its picture */
  private frameOf(r: BikeRec): void {
    const w = this.w;
    r.shown = 0;
    if (r.self < 0) {
      if (--r.wait <= 0) this.comeIn(r);
      return;
    }
    if (tooFar(w, r)) {
      this.gone(r);
      return;
    }
    setObj(r.last, r);
    this.move(r);
    if (w.pyro.hitsCraft(r.last, r, 0x10e, 0)) {
      this.blast(r);
      w.sound(0x31);
    }
    const p = w.project(r);
    const depth = p.depth;
    if (depth < 0x20) return;
    let pic = (depth - 0x20) >> 6;
    if (pic >= 0x20) pic = 0x1f;
    if (depth >= 0x4a && depth <= 0x76) pic = 0x20;
    if (depth < 0x96 && r.engine) {
      w.sound(0x16);
      r.engine = 0;
    }
    let mirror = false;
    let h = (((w.cam.angle - r.angle + 8) & 0xff) >> 4);
    if (h >= 9) {
      h = 0x10 - h;
      mirror = true;
    }
    pic += h * 0x21;
    const rect = w.sprite(this.pics[pic], p.y, p.x, depth, mirror);
    if (depth < 0x140 || !rect) return;
    r.rect = widen(rect);
    r.depth = depth;
    r.shown = 1;
  }

  /** 0x401c50: the blast where it rammed the craft */
  private blast(o: Obj): void {
    const w = this.w;
    const p = w.project(o);
    if (p.depth < 0x40) return;
    let i = (p.depth - 0x40) >> 7;
    if (i >= 0x10) i = 0xf;
    w.sprite(this.pyro(BLAST + i), p.y, p.x, p.depth - 1);
  }

  /** 0x401ca4: a bike's move by its state (0x431058) */
  private move(r: BikeRec): void {
    const w = this.w;
    switch (r.state) {
      case 0: {
        const [a, b, c] = this.ways(r);
        if (!this.blocked(r, a)) {
          r.goal = a;
          if (w.roll(10) <= 1) {
            if (!this.blocked(r, b)) r.goal = b;
            else if (!this.blocked(r, c)) r.goal = c;
          }
        } else if (!this.blocked(r, b)) {
          r.goal = b;
        } else {
          // 0x402157: boxed in all three ways the EXE reports a logic error (0x41e28a 0x6b, 2) and goes on
          r.goal = c;
        }
        r.goalX = (r.cellX << 8) + 0x80;
        r.goalY = (r.cellY << 8) + 0x80;
        if (r.goal === r.angle) {
          // 0x431090: ride on to the cell's far edge
          switch (r.angle) {
            case 0:
              r.goalX += 0x80;
              r.state = 1;
              r.way = 1;
              break;
            case 0x40:
              r.goalY += 0x80;
              r.state = 2;
              r.way = 1;
              break;
            case 0x80:
              r.goalX -= 0x80;
              r.state = 1;
              r.way = 0;
              break;
            case 0xc0:
              r.goalY -= 0x80;
              r.state = 2;
              r.way = 0;
              break;
          }
          this.move(r);
          return;
        }
        // 0x4310b0: turn about the corner on the side it turns to
        switch (r.angle) {
          case 0:
            if (r.goal === 0xc0) {
              r.state = 3;
              r.goalX -= 0x80;
              r.goalY -= 0x80;
            }
            if (r.goal === 0x40) {
              r.state = 4;
              r.goalX -= 0x80;
              r.goalY += 0x80;
            }
            break;
          case 0x40:
            if (r.goal === 0) {
              r.state = 3;
              r.goalX += 0x80;
              r.goalY -= 0x80;
            }
            if (r.goal === 0x80) {
              r.state = 4;
              r.goalX -= 0x80;
              r.goalY -= 0x80;
            }
            break;
          case 0x80:
            if (r.goal === 0xc0) {
              r.state = 4;
              r.goalX += 0x80;
              r.goalY -= 0x80;
            }
            if (r.goal === 0x40) {
              r.state = 3;
              r.goalX += 0x80;
              r.goalY += 0x80;
            }
            break;
          case 0xc0:
            if (r.goal === 0x80) {
              r.state = 3;
              r.goalX -= 0x80;
              r.goalY += 0x80;
            }
            if (r.goal === 0) {
              r.state = 4;
              r.goalX += 0x80;
              r.goalY += 0x80;
            }
            break;
        }
        r.radius = dist(r.goalX - r.x, r.goalY - r.y, 0);
        // a quarter turn is 0x40 of heading along a quarter circle, r·0x3d5b/10000 (π/2) long
        r.way = Math.trunc((r.speed << 6) / Math.trunc((r.radius * 0x3d5b) / 0x2710));
        r.engine = 1;
        this.move(r);
        return;
      }
      case 1: {
        const ty = r.goalY;
        r.y += w.roll(5) - 3;
        if (r.y < ty - 0x40) r.y = ty - 0x40;
        if (r.y > ty + 0x40) r.y = ty + 0x40;
        if (r.way) {
          r.x += r.speed;
          if (r.x >= r.goalX) this.arrive(r);
        } else {
          r.x -= r.speed;
          if (r.x <= r.goalX) this.arrive(r);
        }
        if (downTheLine(w, r)) this.fire(r);
        return;
      }
      case 2: {
        const tx = r.goalX;
        r.x += w.roll(5) - 3;
        if (r.x < tx - 0x40) r.x = tx - 0x40;
        if (r.x > tx + 0x40) r.x = tx + 0x40;
        if (r.way) {
          r.y += r.speed;
          if (r.y >= r.goalY) this.arrive(r);
        } else {
          r.y -= r.speed;
          if (r.y <= r.goalY) this.arrive(r);
        }
        if (downTheLine(w, r)) this.fire(r);
        return;
      }
      case 3:
      case 4: {
        r.angle = turnToward(r.angle, r.goal, r.way, 0x100);
        const t = (r.angle + (r.state === 3 ? 0x40 : -0x40)) & 0xff;
        r.x = cosMul(t, r.radius) + r.goalX;
        r.y = sinMul(t, r.radius) + r.goalY;
        if (r.angle === r.goal) this.arrive(r);
        return;
      }
      case DYING: {
        r.angle = (r.angle - 0x20) & 0xff;
        const was = copyObj(r);
        r.vz--;
        r.x += r.vx;
        r.y += r.vy;
        r.z += r.vz;
        r.cellX = r.x >> 8;
        r.cellY = r.y >> 8;
        let met = false;
        if (r.z <= 0) {
          r.z = 0;
          r.vz = -Math.trunc(r.vz / 4);
          met = true;
        }
        if (inBlock(w, r)) {
          if (r.cellX !== was.cellX) {
            r.x = ((r.cellX + was.cellX) << 7) + 0x80;
            r.cellX = r.x >> 8;
            r.vx = -Math.trunc(r.vx / 2);
            met = true;
          }
          if (r.cellY !== was.cellY) {
            r.y = ((r.cellY + was.cellY) << 7) + 0x80;
            r.cellY = r.y >> 8;
            r.vy = -Math.trunc(r.vy / 2);
            met = true;
          }
        }
        if (met) {
          w.pyro.burst(r, r.vx, r.vy, r.vz);
          if (r.pod) w.pyro.drop(r, r.vx, r.vy, r.vz);
          this.gone(r);
        }
        return;
      }
    }
  }

  /**
   * 0x401cc1 (0x431070's cases): the three ways to try, first to last — the
   * way toward the craft along the axis it is farther off on first, a tie on
   * the other axis broken by a roll of 2
   */
  private ways(r: BikeRec): [number, number, number] {
    const w = this.w;
    const dx = r.cellX - w.cam.cellX;
    const dy = r.cellY - w.cam.cellY;
    // (p, q): two ways across, in the order the side it is off on says (a tie rolls)
    const across = (d: number, p: number, q: number): [number, number] => (d > 0 || (d === 0 && w.roll(2) === 1) ? [p, q] : [q, p]);
    const acrossNeg = (d: number, p: number, q: number): [number, number] => (d < 0 || (d === 0 && w.roll(2) === 1) ? [p, q] : [q, p]);
    switch (r.angle) {
      case 0:
        if (abs(dx) > abs(dy)) {
          if (dx < 0) return [0, ...across(dy, 0xc0, 0x40)];
          const [a, b] = across(dy, 0xc0, 0x40);
          return [a, b, 0];
        }
        return dy < 0 ? [0x40, 0, 0xc0] : [0xc0, 0, 0x40];
      case 0x40:
        if (abs(dx) < abs(dy)) {
          if (dy < 0) return [0x40, ...acrossNeg(dx, 0, 0x80)];
          const [a, b] = acrossNeg(dx, 0, 0x80);
          return [a, b, 0x40];
        }
        return dx < 0 ? [0, 0x40, 0x80] : [0x80, 0x40, 0];
      case 0x80:
        if (abs(dx) > abs(dy)) {
          if (dx > 0) return [0x80, ...across(dy, 0xc0, 0x40)];
          const [a, b] = across(dy, 0xc0, 0x40);
          return [a, b, 0x80];
        }
        return dy < 0 ? [0x40, 0x80, 0xc0] : [0xc0, 0x80, 0x40];
      case 0xc0:
        if (abs(dx) < abs(dy)) {
          if (dy > 0) return [0xc0, ...acrossNeg(dx, 0, 0x80)];
          const [a, b] = acrossNeg(dx, 0, 0x80);
          return [a, b, 0xc0];
        }
        return dx < 0 ? [0, 0xc0, 0x80] : [0x80, 0xc0, 0];
    }
    throw new Error(`0x401cc1: a heading of ${r.angle} is no quarter`);
  }

  /** 0x4026c6 (0x4310d0): at the cell's edge — into the next cell, and choose again */
  private arrive(r: BikeRec): void {
    switch (r.angle) {
      case 0:
        r.cellX++;
        r.x = r.cellX << 8;
        break;
      case 0x40:
        r.cellY++;
        r.y = r.cellY << 8;
        break;
      case 0x80:
        r.x = r.cellX << 8;
        r.cellX--;
        break;
      case 0xc0:
        r.y = r.cellY << 8;
        r.cellY--;
        break;
    }
    r.state = 0;
  }

  /** 0x402724 (0x4310f0): the next cell along `heading` is a block */
  private blocked(r: BikeRec, heading: number): boolean {
    const w = this.w;
    switch (heading) {
      case 0:
        return w.solid(r.cellX + 1, r.cellY);
      case 0x40:
        return w.solid(r.cellX, r.cellY + 1);
      case 0x80:
        return w.solid(r.cellX - 1, r.cellY);
      case 0xc0:
        return w.solid(r.cellX, r.cellY - 1);
    }
    throw new Error(`0x402724: a heading of ${heading} is no quarter (0x41e28a 0x6b, 3)`);
  }

  /** 0x4027bd: every `[0x43cf7e]` frames a shot from 10 ahead, 0x3c a step at ours or the craft */
  private fire(r: BikeRec): void {
    const w = this.w;
    if (--r.reload > 0) return;
    r.reload = w.params.x43cf7e;
    const s = this.shots.find((s) => !s.on);
    if (!s) return;
    s.on = 1;
    s.kind = 0;
    s.met = 0;
    s.life = 0x14;
    s.o.x = cosMul(r.angle, 0xa) + r.x;
    s.o.y = sinMul(r.angle, 0xa) + r.y;
    s.o.z = r.z;
    this.muzzle(s);
    aimAt(w, s, 0x3c);
    s.o.x -= s.vx;
    s.o.y -= s.vy;
    s.o.z -= s.vz;
    s.o.cellX = s.o.x >> 8;
    s.o.cellY = s.o.y >> 8;
    w.sound(4);
  }

  /** 0x40289e: the shots move; into a block or the ground, or into ours (0x15), they are done */
  private moveShots(): void {
    const w = this.w;
    for (const s of this.shots) {
      if (!s.on) continue;
      if (--s.life < 0) {
        s.on = 0;
        continue;
      }
      const was = copyObj(s.o);
      s.o.x += s.vx;
      s.o.y += s.vy;
      s.o.z += s.vz;
      s.o.cellX = s.o.x >> 8;
      s.o.cellY = s.o.y >> 8;
      if (meets(w, was, s.o)) {
        s.met = 1;
        w.sound(w.roll(4) === 1 ? 0xf : 0xd);
      }
      if (w.pyro.hitsOurs(was, s.o, 0x15, 0)) {
        s.met = 2;
        w.sound(7);
      }
      this.drawShot(s);
      if (s.met) s.on = 0;
    }
  }

  /** 0x40299f: a shot's picture — a shell, a chip off a wall, a hit */
  private drawShot(s: BikeShot): void {
    const w = this.w;
    const p = w.project(s.o);
    if (p.depth < 0x40) return;
    let i = (p.depth - 0x40) >> 7;
    if (i >= 0x10) i = 0xf;
    let base = SHELL;
    if (s.met === 2) base = HIT;
    else if (s.met) base = CHIP;
    w.sprite(this.pyro(base + i), p.y, p.x, p.depth);
  }

  /** 0x402a55: the flash where a shot leaves */
  private muzzle(s: BikeShot): void {
    const w = this.w;
    const p = w.project(s.o);
    if (p.depth < 0x40) return;
    let i = (p.depth - 0x40) >> 7;
    if (i >= 0x10) i = 0xf;
    w.sprite(this.pyro(CHIP + i), p.y, p.x, p.depth);
  }

  /** 0x402aaa: a shot from `a` to `b` hits the first bike it meets */
  hit(a: Obj, b: Obj, dmg: number, r: number): boolean {
    for (const k of this.recs) if (this.hitOne(k, a, b, dmg, r)) return true;
    return false;
  }

  /** 0x402afa: within its reach + 0x14 on every axis the shot hits; killed, $15, and it tumbles (one in four) or bursts */
  private hitOne(k: BikeRec, a: Obj, b: Obj, dmg: number, r: number): boolean {
    const w = this.w;
    if (k.self < 0 || k.state === DYING) return false;
    const reach = r + 0x14;
    if (k.z - reach > a.z && k.z - reach > b.z) return false;
    if (k.z + reach < a.z && k.z + reach < b.z) return false;
    if (k.x - reach > a.x && k.x - reach > b.x) return false;
    if (k.x + reach < a.x && k.x + reach < b.x) return false;
    if (k.y - reach > a.y && k.y - reach > b.y) return false;
    if (k.y + reach < a.y && k.y + reach < b.y) return false;
    k.strength -= dmg;
    if (k.strength > 0) return true;
    w.hud.addScore(0xf);
    w.r.tally.kills.bike++;
    let vx = k.x - k.last.x;
    let vy = k.y - k.last.y;
    const vz = k.z - k.last.z;
    if (w.roll(4) === 1) {
      if (vx === 0) vx = w.roll(0xd) - 7;
      if (vy === 0) vy = w.roll(0xd) - 7;
      k.vx = vx;
      k.vy = vy;
      k.vz = vz;
      k.state = DYING;
      return true;
    }
    w.pyro.burst(k, vx, vy, vz);
    if (k.pod) w.pyro.drop(k, vx, vy, vz);
    this.gone(k);
    return true;
  }

  /** 0x402c7e: the world moved (dx, dy) — every bike up and every shot */
  shift(dx: number, dy: number): void {
    const cx = dx >> 8;
    const cy = dy >> 8;
    for (const r of this.recs) {
      if (r.self < 0) continue;
      r.x += dx;
      r.y += dy;
      r.cellX += cx;
      r.cellY += cy;
      r.goalX += dx;
      r.goalY += dy;
    }
    for (const s of this.shots) {
      if (!s.on) continue;
      s.o.x += dx;
      s.o.y += dy;
      s.o.cellX += cx;
      s.o.cellY += cy;
    }
  }

  /** 0x402d0d */
  count(): number {
    return this.recs.filter((r) => r.self >= 0).length;
  }

  /** 0x402d39: the k-th bike up, KIND.bike (0: it answers the eax it zeroed) */
  nth(k: number): { obj: Obj; kind: number; flag: number; dying: number } {
    for (const r of this.recs) {
      if (r.self >= 0) k--;
      if (k < 0) return { obj: objOf(r), kind: KIND.bike, flag: r.pod, dying: r.state === DYING ? 1 : 0 };
    }
    throw new Error("0x402d39: no such bike (0x41e28a 0x6b, 4)");
  }

  /** 0x402db6: the nearest bike drawn last frame (0x140 away or more) whose rect holds the point */
  pick(pt: Pt): Obj | null {
    let best: BikeRec | null = null;
    let near = 0x7fff;
    for (const r of this.recs) {
      if (r.shown && r.depth < near && inside(pt.y, pt.x, r.rect)) {
        best = r;
        near = r.depth;
      }
    }
    return best;
  }

  /** 0x402e2f: the bike at exactly `o`'s point, up or not */
  find(o: Obj): Obj {
    const r = this.recs.find((r) => r.x === o.x && r.y === o.y && r.z === o.z);
    if (!r) throw new Error("0x402e2f: no bike there (0x41e28a 0x6b, 5)");
    return r;
  }
}

/** 0x401be4 / 0x4075b8: a rect narrower or shorter than 0x14 widened to 0x14 about its middle (the aim's) */
export function widen(r: Rect): Rect {
  let [top, left, bottom, right] = r;
  const wd = right - left;
  if (wd < 0x14) {
    left += (wd >> 1) - 0xa;
    right = left + 0x14;
  }
  const ht = bottom - top;
  if (ht < 0x14) {
    top += (ht >> 1) - 0xa;
    bottom = top + 0x14;
  }
  return [top, left, bottom, right];
}
