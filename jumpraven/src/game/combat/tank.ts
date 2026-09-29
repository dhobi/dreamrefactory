/**
 * The tanks — RAVEN.EXE 0x4248bc … 0x426124: up to three (`[0x43cf92]` by the
 * difficulty) of the EXE's 0x84-byte records at 0x43a674, and their shots, 16
 * of 0x34 bytes at 0x43a800. The jeep's cousin (src/game/combat/jeep.ts): it
 * comes in the same way (0x42498e, the jeep's 0x40c807 without the half cell
 * back), is drawn the same (0x424d78) and hit the same, but it drives from
 * cell centre to cell centre and turns on the spot.
 *
 * It comes 800 … 1600 frames into the flight, and when it is gone after 400
 * frames the first time, 80 fewer each time after (0x424964).
 *
 * ## How one moves (0x424ed5)
 *
 *   0  choose: within a cell of the craft with it along its row or column in
 *      the open (0x4279cb), turn to face it (4); else the next cell toward the
 *      craft by the longer way, else by the shorter (a tie by a roll of 2);
 *      boxed in, wait
 *   1  turn on the spot (`[0x43cf96]` a frame) to that way, then roll (2, 3)
 *   2, 3  roll along x or y (`[0x43cf8a]` a frame) to the next cell's centre,
 *      wobbling up to 0x2a across the street, firing while the craft is down
 *      the line (0x4277e3)
 *   4  turn to face the craft, then 5
 *   5  fire while the craft is within two cells and down the line
 *   6  killed: burning, 1 … 12 frames, then it blows up (0x425375)
 *
 * ## Its shots (0x425430, 0x425771)
 *
 * Every `[0x43cf8e]` frames while it fires, from 0x26 up and 0x18 to the side,
 * the sides by turns; three in four a bullet like the jeep's (0x3c a step,
 * 0x1e frames, 0x15 strong); one in four a shell, 0x20 a step for 0x30 frames,
 * 0x2b strong, and one shell in four homes, re-aimed every frame (a decoy
 * draws it: 0x4276cb), 0x56 strong. A shell's burst shows two frames. The
 * pilot calls a shell's way (0x41438a), and the copilot counts it (0x404e11).
 */
import type { FrameV0 } from "@dreamfactory/engine/df/image-v0";
import type { Rect } from "@dreamfactory/engine/v0/screen";
import type { TankApi } from "./api";
import { comeIn, drawShot, drawVehicle, moveBullet, newShots, objOf, withinReach, type VehicleShot } from "./jeep";
import { aimAt, callShell, downTheLine, lookAlong, meets, tooFar, turnToward } from "./lib";
import { KIND, abs, copyObj, cosMul, inside, newObj, readPictures, setObj, sinMul, type Obj, type Pt, type World } from "./world";

/** a tank, the EXE's 0x84 bytes at 0x43a674 (its object the first 0x18) */
interface TankRec extends Obj {
  /** +0x18 where it was at the frame's start */
  last: Obj;
  /** +0x30 the state (0x43261c) */
  state: number;
  /** +0x34, +0x38 the cell centre it is rolling to */
  goalX: number;
  goalY: number;
  /** +0x3c rolling: 1 up x or y, 0 down; killed: frames till it blows up */
  way: number;
  /** +0x40 its speed (`[0x43cf8a]`), +0x44 its turn a frame (`[0x43cf96]`) */
  speed: number;
  turn: number;
  /** +0x48 its strength (`[0x43cfb6]`) */
  strength: number;
  /** +0x4c frames to its next shot */
  reload: number;
  /** +0x50 its picture's rect last frame, at least 0x14 square; +0x58 its depth; +0x5c it was drawn (for the aim) */
  rect: Rect;
  depth: number;
  shown: number;
  /** +0x60 its shots fired (the side they come from) */
  fired: number;
  /** +0x64 it drops a pod when it blows up */
  pod: number;
  /** +0x68 its slot while it is up, −1 while it is not */
  self: number;
  /** +0x6c, +0x70 the cell it is going to; +0x74 the heading it turns to */
  toX: number;
  toY: number;
  goal: number;
  /** +0x78 its slot; +0x7c frames till it comes; +0x80 the wait the next time it goes */
  slot: number;
  wait: number;
  nextWait: number;
}

export class Tank implements TankApi {
  /** 0x43a1f4: TANK's pictures (0x4248bc) */
  private readonly pics: (FrameV0 | undefined)[];
  /** 0x43a674 */
  private readonly recs: TankRec[] = [];
  /** 0x43a800 */
  private readonly shots = newShots();
  /** `[0x43a1ec]`: homing shells up */
  private homing = 0;

  constructor(
    readonly w: World,
    pictures: Uint8Array,
  ) {
    this.pics = readPictures(pictures);
  }

  /** `[0x43cf92]` */
  private get n(): number {
    return this.w.params.x43cf92;
  }

  /** 0x4248fd: every tank to come in 800 … 1600 frames, the first wait after 400; the shots off (0x4253f4) */
  reset(): void {
    const w = this.w;
    if (this.n > 3) throw new Error("0x4248fd: more than three tanks (0x41e28a 0x6b, 0xa3)");
    this.recs.length = 0;
    for (let i = 0; i < this.n; i++) {
      const r: TankRec = {
        ...newObj(), last: newObj(), state: 0, goalX: 0, goalY: 0, way: 0, speed: 0, turn: 0, strength: 0, reload: 0,
        rect: [0, 0, 0, 0], depth: 0, shown: 0, fired: 0, pod: 0, self: -1, toX: 0, toY: 0, goal: 0, slot: i, wait: 0, nextWait: 0,
      };
      r.wait = w.roll(0x320) + 0x320;
      r.nextWait = 0x190;
      this.recs.push(r);
    }
    for (const s of this.shots) s.on = 0;
    this.homing = 0;
  }

  /** 0x425412: how many homing shells are up (the flight's check that none is left over) */
  x425412(): number {
    if (this.homing < 0) throw new Error("0x425412: fewer than no homing shells (0x41e28a 0x6b, 0xa4)");
    return this.homing;
  }

  /** 0x424964: gone — back in `+0x80` frames, the next time 80 fewer; no missile homes on it */
  private gone(r: TankRec): void {
    r.self = -1;
    r.wait = r.nextWait;
    r.nextWait -= 0x50;
    this.w.pyro.forget(r);
  }

  /** 0x42498e */
  private comeIn(r: TankRec): void {
    const w = this.w;
    r.self = r.slot;
    const c = comeIn(w, (x, y) => this.blocked(x, y, r.self));
    r.angle = c.angle;
    r.cellX = c.cellX;
    r.cellY = c.cellY;
    r.x = (r.cellX << 8) + 0x80;
    r.y = (r.cellY << 8) + 0x80;
    r.z = 1;
    r.toX = c.cellX;
    r.toY = c.cellY;
    r.speed = w.params.x43cf8a;
    r.turn = w.params.x43cf96;
    r.state = 0;
    r.shown = 0;
    r.reload = 0;
    r.strength = w.params.x43cfb6;
    setObj(r.last, r);
    r.pod = 0;
    if (w.pyro.wreckage() < 2 && w.roll(8) === 1 && w.state < 2) r.pod = 1;
  }

  /** 0x424d46: every tank, then the shots (0x425771) */
  frame(): void {
    for (const r of this.recs) this.one(r);
    this.moveShots();
  }

  /** 0x424d78 */
  private one(r: TankRec): void {
    const w = this.w;
    r.shown = 0;
    if (r.self < 0) {
      if (--r.wait <= 0) this.comeIn(r);
      return;
    }
    if (tooFar(w, r)) return this.gone(r);
    setObj(r.last, r);
    this.think(r);
    const d = drawVehicle(w, r, this.pics);
    if (!d) return;
    r.rect = d.rect;
    r.depth = d.depth;
    r.shown = 1;
  }

  /** 0x424ed5 */
  private think(r: TankRec): void {
    const w = this.w;
    switch (r.state) {
      case 0: {
        let ax = r.cellX;
        let ay = r.cellY;
        const dx = ax - w.cam.cellX;
        const dy = ay - w.cam.cellY;
        const seen = lookAlong(w, r);
        if (seen !== null) r.goal = seen;
        if (seen !== null && abs(dx) <= 1 && abs(dy) <= 1) return void (r.state = 4);
        let bx = ax;
        let by = ay;
        let a: number;
        let b: number;
        if (abs(dx) > abs(dy)) {
          if (dx > 0) (a = 0x80), ax--;
          else (a = 0), ax++;
          if (dy > 0) (b = 0xc0), by--;
          else (b = 0x40), by++;
        } else {
          if (dy > 0) (a = 0xc0), ay--;
          else (a = 0x40), ay++;
          if (dx > 0) (b = 0x80), bx--;
          else (b = 0), bx++;
        }
        if (abs(dx) === abs(dy) && w.roll(2) === 1) {
          [ax, bx] = [bx, ax];
          [ay, by] = [by, ay];
          [a, b] = [b, a];
        }
        if (!this.blocked(ax, ay, r.self)) {
          r.toX = ax;
          r.toY = ay;
          r.goal = a;
          r.state = 1;
        } else if (!this.blocked(bx, by, r.self)) {
          r.toX = bx;
          r.toY = by;
          r.goal = b;
          r.state = 1;
        }
        return;
      }
      case 1:
        if (r.angle !== r.goal) return void (r.angle = turnToward(r.angle, r.goal, r.turn, 0x100));
        r.goalX = (r.cellX << 8) + 0x80;
        r.goalY = (r.cellY << 8) + 0x80;
        // 0x432638
        switch (r.angle) {
          case 0:
            r.goalX += 0x100;
            r.state = 2;
            r.way = 1;
            break;
          case 0x40:
            r.goalY += 0x100;
            r.state = 3;
            r.way = 1;
            break;
          case 0x80:
            r.goalX -= 0x100;
            r.state = 2;
            r.way = 0;
            break;
          case 0xc0:
            r.goalY -= 0x100;
            r.state = 3;
            r.way = 0;
            break;
        }
        return;
      case 2:
      case 3: {
        const alongX = r.state === 2;
        const t = alongX ? r.goalY : r.goalX;
        let across = (alongX ? r.y : r.x) + w.roll(5) - 3;
        if (t - 0x2a > across) across = t - 0x2a;
        if (t + 0x2a < across) across = t + 0x2a;
        if (alongX) r.y = across;
        else r.x = across;
        const goal = alongX ? r.goalX : r.goalY;
        let v = alongX ? r.x : r.y;
        if (r.way) {
          v += r.speed;
          if (v >= goal) (v = goal), (r.state = 0);
        } else {
          v -= r.speed;
          if (v <= goal) (v = goal), (r.state = 0);
        }
        if (alongX) (r.x = v), (r.cellX = v >> 8);
        else (r.y = v), (r.cellY = v >> 8);
        if (downTheLine(w, r)) this.fire(r);
        return;
      }
      case 4:
        if (r.angle === r.goal) r.state = 5;
        else r.angle = turnToward(r.angle, r.goal, r.turn, 0x100);
        return;
      case 5: {
        const dx = r.cellX - w.cam.cellX;
        const dy = r.cellY - w.cam.cellY;
        if (downTheLine(w, r) && abs(dx) <= 2 && abs(dy) <= 2) this.fire(r);
        else r.state = 0;
        return;
      }
      case 6: {
        if (--r.way > 0) return;
        // 0x425375: the blast 0x18 ahead of it, 6 up
        const at = objOf(r);
        at.x += cosMul(at.angle, 0x18);
        at.y += sinMul(at.angle, 0x18);
        at.z += 6;
        w.pyro.burst(at, 0, 0, 0);
        if (r.pod) w.pyro.drop(r, 0, 0, 0);
        this.gone(r);
        return;
      }
    }
  }

  /** 0x426065: a block, another tank's cell, a jeep's or the fuel station's */
  private blocked(x: number, y: number, self: number): boolean {
    const w = this.w;
    return w.solid(x, y) || this.occupied(x, y, self) || w.jeep.occupied(x, y, -1) || w.fuel.occupied(x, y);
  }

  /** 0x4260bc */
  occupied(x: number, y: number, self: number): boolean {
    for (const r of this.recs) {
      if (r.self < 0 || r.self === self) continue;
      if ((r.toX === x && r.toY === y) || (r.cellX === x && r.cellY === y)) return true;
    }
    return false;
  }

  /** 0x425430: a shot, if one is due and a slot is free */
  private fire(r: TankRec): void {
    const w = this.w;
    if (--r.reload > 0) return;
    r.reload = w.params.x43cf8e;
    const s = this.shots.find((s) => !s.on);
    if (!s) return;
    let kind = 0;
    if (w.roll(4) === 1) kind = w.roll(4) === 1 ? 2 : 1;
    s.on = 1;
    s.kind = kind;
    s.met = 0;
    s.life = kind ? 0x30 : 0x1e;
    s.o.x = cosMul(r.angle, 1) + r.x;
    s.o.y = sinMul(r.angle, 1) + r.y;
    s.o.z = r.z + 0x26;
    r.fired++;
    const side = (r.fired & 1 ? r.angle + 0x40 : r.angle - 0x40) & 0xff;
    s.o.x += cosMul(side, 0x18);
    s.o.y += sinMul(side, 0x18);
    drawShot(w, s, 0xe0);
    aimAt(w, s, kind ? 0x20 : 0x3c);
    s.o.x -= s.vx;
    s.o.y -= s.vy;
    s.o.z -= s.vz;
    s.o.cellX = s.o.x >> 8;
    s.o.cellY = s.o.y >> 8;
    if (!kind) return void w.sound(4);
    w.sound(5);
    callShell(w, s.o);
    w.copilot.x404e11(r.angle);
    if (kind === 2) this.homing++;
  }

  /** 0x425771 */
  private moveShots(): void {
    const w = this.w;
    for (const s of this.shots) {
      if (!s.on) continue;
      if (s.kind === 0) {
        if (--s.life < 0) {
          s.on = 0;
          continue;
        }
        moveBullet(w, s);
      } else if (s.kind === 1 || s.kind === 2) {
        const homes = s.kind === 2;
        if (--s.life < 0) {
          s.on = 0;
          if (homes) this.homing--;
          continue;
        }
        if (s.met) {
          s.met++;
          this.drawShell(s);
          if (s.met >= 2) {
            s.on = 0;
            if (homes) this.homing--;
          }
          continue;
        }
        const last = copyObj(s.o);
        if (homes && aimAt(w, s, 0x20)) this.burst(s, 0x10);
        s.o.x += s.vx;
        s.o.y += s.vy;
        s.o.z += s.vz;
        s.o.cellX = s.o.x >> 8;
        s.o.cellY = s.o.y >> 8;
        if (meets(w, last, s.o)) this.burst(s, 0x10);
        if (w.pyro.hitsOurs(last, s.o, homes ? 0x56 : 0x2b, 0)) this.burst(s, 9);
        this.drawShell(s);
      }
    }
  }

  /** a shell bursts: shown next frame and gone (its 0x1f4 frames never run out first), with sound `n` */
  private burst(s: VehicleShot, n: number): void {
    s.met = 1;
    s.life = 0x1f4;
    this.w.sound(n);
  }

  /** 0x425b49: a shell's picture — bursting (pyro's 0xc0 …, then 0xd0 …), homing (0x12c …), or not (0x13c …) */
  private drawShell(s: VehicleShot): void {
    drawShot(this.w, s, s.met === 1 ? 0xc0 : s.met === 2 ? 0xd0 : s.kind === 2 ? 0x12c : 0x13c);
  }

  /** 0x425c89: the first tank the shot meets (0x425cd9) */
  hit(a: Obj, b: Obj, dmg: number, r: number): boolean {
    for (const t of this.recs) if (this.hitOne(t, a, b, dmg, r)) return true;
    return false;
  }

  /** 0x425cd9: within `r` + 0x28 and not already burning; killed, 0x37 points, the tally, a fireball 0x18 behind it, and it burns (6) */
  private hitOne(t: TankRec, a: Obj, b: Obj, dmg: number, r: number): boolean {
    const w = this.w;
    if (t.self < 0 || t.state === 6) return false;
    if (!withinReach(t, a, b, r + 0x28)) return false;
    t.strength -= dmg;
    if (t.strength > 0) return true;
    w.hud.addScore(0x37);
    w.r.tally.kills.tank++;
    const at = objOf(t);
    at.x += cosMul(at.angle, -0x18);
    at.y += sinMul(at.angle, -0x18);
    at.z += 0x10;
    w.pyro.burst(at, 0, 0, 0);
    t.way = w.roll(0xc);
    t.state = 6;
    return true;
  }

  /** 0x425e2c */
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
      r.toX += cx;
      r.toY += cy;
    }
    for (const s of this.shots) {
      if (!s.on) continue;
      s.o.x += dx;
      s.o.y += dy;
      s.o.cellX += cx;
      s.o.cellY += cy;
    }
  }

  /** 0x425ec8 */
  count(): number {
    return this.recs.filter((r) => r.self >= 0).length;
  }

  /** 0x425ef4: a burning one is dying */
  nth(k: number): { obj: Obj; kind: number; flag: number; dying: number } {
    for (const r of this.recs) {
      if (r.self >= 0) k--;
      if (k < 0) return { obj: objOf(r), kind: KIND.tank, flag: r.pod, dying: r.state === 6 ? 1 : 0 };
    }
    throw new Error("0x425ef4: no such tank (0x41e28a 0x6b, 0xa5)");
  }

  /** 0x425f76 */
  pick(pt: Pt): Obj | null {
    let best: TankRec | null = null;
    let near = 0x7fff;
    for (const r of this.recs) {
      if (r.shown && r.depth < near && inside(pt.y, pt.x, r.rect)) {
        best = r;
        near = r.depth;
      }
    }
    return best;
  }

  /** 0x425fef */
  find(o: Obj): Obj {
    const r = this.recs.find((r) => r.x === o.x && r.y === o.y && r.z === o.z);
    if (!r) throw new Error("0x425fef: no tank there (0x41e28a 0x6b, 0xa6)");
    return r;
  }
}
