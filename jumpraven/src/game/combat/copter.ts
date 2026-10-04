/**
 * The helicopters — RAVEN.EXE 0x406fc4 … 0x408a68: up to three (`[0x43cfa6]`
 * by the difficulty) of the EXE's 0x98-byte records at 0x43538c, flying 0x12c
 * up from one cell's centre to the next toward the craft and firing along the
 * street when it is down it, and their shots, 16 of 0x34 bytes at 0x435554.
 *
 * ## Where one comes from (0x407096)
 *
 * Seven cells ahead of the craft's pose, across its way: the cell beside the
 * pose's line one side or the other (a roll of 2), and on outward along the
 * row while that cell is taken (0x4089ae: a block, another copter's cell or
 * the one it is going to, the weapons ship's, the boss's); it faces back
 * across toward the line, at its cell's centre, its height spread by its slot,
 * ±0x1e about 0x12c. One time in eight, while fewer than two pieces of
 * wreckage are up and the flight is on, it carries a pod to drop. It comes
 * 600 … 1200 frames into the flight, and when it is gone (killed, or nine
 * cells from the craft: 0x427afd) after 300 frames the first time, 60 fewer
 * each time after (0x407069).
 *
 * ## How one moves (0x407678)
 *
 *   0  choose: with the craft down its row or column in sight (0x4279cb) and
 *      within a cell, turn to face it (4); else the next cell toward the craft
 *      along the axis it is farther off on, else along the other (a tie swaps
 *      them one time in two), if that cell is not taken; boxed in, it waits
 *   1  turn toward the next cell at its turn rate (`[0x43cfaa]`), then fly
 *   2, 3  fly along x or y at its speed (`[0x43cf9e]`) to the next cell's
 *      centre, wobbling up to 0x2a across the street, firing while the craft
 *      is down the line; there, choose again
 *   4  turn to face the craft, then hover (5)
 *   5  hover and fire while the craft is within two cells and down the line
 *   6  killed and going down (0x408579): spinning (0x10 a frame nine times in
 *      ten, else 4), falling 1 faster a frame nine times in ten (else drifting
 *      level), until it meets the ground or a block, or 8 … 23 frames are up,
 *      and bursts
 *
 * ## Its shots (0x407cd0, 0x408011)
 *
 * Every `[0x43cfa2]` frames while it fires, from 0xc below and 0x18 to the
 * side, the sides by turns, at the weapons ship, the fuel station or the craft
 * (0x4276cb): three times in four a bullet, 0x3c a step for 0x1e frames, into
 * a block or the ground gone, into ours 0x15 strong; else a missile, 0x20 a
 * step for 0x30 frames — the pilot calls it (0x41438a) and the copilot counts
 * it (0x404e11) — one in four of them homing, turned toward its target every
 * frame and counted up (`[0x434f04]`, 0x407cb5); a missile bursts on a block
 * or the ground, or on ours, 0x2b strong (0x56 homing), and is done the frame
 * after. Flying into the craft rams it for 0x21c, 0xf wide (0x41b820).
 *
 * ## A kill (0x408579)
 *
 * A shot within its reach + 0x19 on every axis takes the damage off its
 * strength (`[0x43cfba]`); at nothing it is $35 (`[0x43cf9a]`), nine times in
 * ten a burst from its tail, and it goes down (6).
 *
 * Its pictures (COPT, 0x120 of them) are 32 distances by 9 headings, picture
 * d + 32·h at (depth − 0x10) / 0x40 and the heading toward the eye h in
 * sixteenths, the other seven mirrored (0x407495).
 */
import type { FrameV0 } from "@dreamfactory/engine/df/image-v0";
import type { Rect } from "@dreamfactory/engine/v0/screen";
import type { CopterApi } from "./api";
import { widen } from "./bike";
import { aimAt, callShell, downTheLine, inBlock, lookAlong, meets, tooFar, turnToward, type EnemyShot } from "./lib";
import { KIND, abs, copyObj, cosMul, inside, newObj, readPictures, setObj, sinMul, type Obj, type Pt, type World } from "./world";

/** `pyro`'s pictures the copters draw (0x4379d0 + 4·index; src/game/combat/pyro.ts PIC) */
const SHELL = 0x08;
const BLAST = 0xc0;
const BLAST2 = 0xd0;
const CHIP = 0xe0;
const HIT = 0x108;
/** a homing missile's 16, a missile's 16 (past the salvage's mark) */
const HOMING = 0x12c;
const MISSILE = 0x13c;

/** the state a copter going down is in (0x408768) */
const DYING = 6;

/** a shot's kinds (+0x04) */
const BULLET = 0;
const ROCKET = 1;
const HOMER = 2;

/** a copter, the EXE's 0x98 bytes at 0x43538c (its object the first 0x18) */
interface CopterRec extends Obj {
  /** +0x18 where it was at the frame's start */
  last: Obj;
  /** +0x30 the state (0x43125c) */
  state: number;
  /** +0x34, +0x38 the point it is flying to, the next cell's centre */
  goalX: number;
  goalY: number;
  /** +0x3c flying: 1 up x or y, 0 down; going down: the frames left */
  way: number;
  /** +0x40 its speed (`[0x43cf9e]`) */
  speed: number;
  /** +0x44 its turn a frame (`[0x43cfaa]`) */
  turn: number;
  /** +0x48 its strength (`[0x43cfba]`) */
  strength: number;
  /** +0x4c frames to its next shot */
  reload: number;
  /** +0x50 its picture's rect last frame, at least 0x14 square; +0x58 its depth; +0x5c it was drawn (for the aim) */
  rect: Rect;
  depth: number;
  shown: number;
  /** +0x60 its shots fired (the side they come from) */
  fired: number;
  /** +0x64 it drops a pod when it is killed */
  pod: number;
  /** +0x68 its slot while it is up, −1 while it is not */
  self: number;
  /** +0x6c, +0x70, +0x74 going down, its step */
  vx: number;
  vy: number;
  vz: number;
  /** +0x78, +0x7c the cell it is going to */
  toX: number;
  toY: number;
  /** +0x80 the heading it is turning to */
  goal: number;
  /** +0x84 going down it spins fast; +0x88 it falls */
  spins: number;
  falls: number;
  /** +0x8c its slot; +0x90 frames till it comes; +0x94 the wait the next time it goes */
  slot: number;
  wait: number;
  nextWait: number;
}

/** a copter's shot, the EXE's 0x34 bytes at 0x435554 */
interface CopterShot extends EnemyShot {
  /** +0x00 */
  on: number;
  /** +0x04 0 a bullet, 1 a missile, 2 a homing missile */
  kind: number;
  /** +0x08 a bullet: 0 nothing met, 1 a block or the ground, 2 ours; a missile: the frames since it burst */
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

/** 0x408841's copy of a record's object */
const objOf = (r: Obj): Obj => ({ angle: r.angle, x: r.x, y: r.y, z: r.z, cellX: r.cellX, cellY: r.cellY });

export class Copter implements CopterApi {
  /** 0x434f0c: COPT's pictures (0x406fc4) */
  private readonly pics: (FrameV0 | undefined)[];
  /** 0x43538c */
  private readonly recs: CopterRec[] = [];
  /** 0x435554 */
  private readonly shots: CopterShot[] = Array.from({ length: 0x10 }, () => ({ on: 0, kind: 0, met: 0, life: 0, vx: 0, vy: 0, vz: 0, o: newObj() }));
  /** `[0x434f04]`: homing missiles up */
  private homing = 0;

  constructor(
    readonly w: World,
    pictures: Uint8Array,
  ) {
    this.pics = readPictures(pictures);
  }

  /** `[0x43cfa6]` */
  private get n(): number {
    return this.w.params.x43cfa6;
  }

  /** `[0x434f08]`: `pyro`'s pictures (0x41928d) */
  private pyro(i: number): FrameV0 | undefined {
    return this.w.pyro.pics[i];
  }

  /** 0x407005: every copter to come in 600 … 1200 frames, the first wait after 300; the shots off (0x407c97) */
  reset(): void {
    const w = this.w;
    if (this.n > 3) throw new Error("0x407005: more than three copters (0x41e28a 0x6b, 0x1b)");
    this.recs.length = 0;
    for (let i = 0; i < this.n; i++) {
      const r: CopterRec = {
        ...newObj(), last: newObj(), state: 0, goalX: 0, goalY: 0, way: 0, speed: 0, turn: 0, strength: 0, reload: 0,
        rect: [0, 0, 0, 0], depth: 0, shown: 0, fired: 0, pod: 0, self: -1, vx: 0, vy: 0, vz: 0, toX: 0, toY: 0, goal: 0,
        spins: 0, falls: 0, slot: i, wait: 0, nextWait: 0,
      };
      r.wait = w.roll(0x258) + 0x258;
      r.nextWait = 0x12c;
      this.recs.push(r);
    }
    for (const s of this.shots) s.on = 0;
    this.homing = 0;
  }

  /** 0x407069: gone — back in `+0x94` frames, the next time 60 fewer; no missile homes on it */
  private gone(r: CopterRec): void {
    r.self = -1;
    r.wait = r.nextWait;
    r.nextWait -= 0x3c;
    this.w.pyro.forget(r);
  }

  /** 0x4089ae: cell (x, y) is taken for copter `self` — a block, another copter's, the weapons ship's or the boss's */
  private blocked(x: number, y: number, self: number): boolean {
    const w = this.w;
    return w.solid(x, y) || this.occupied(x, y, self) || w.weap.x42aa71(x, y) || w.boss.at(x, y);
  }

  /** 0x407096: a copter comes in, seven cells ahead of the pose (the pose's facing by 0x43124c) */
  private comeIn(r: CopterRec): void {
    const w = this.w;
    r.self = r.slot;
    let angle = 0;
    let x = 0;
    let y = 0;
    switch (w.poseDir) {
      case 0:
      case 1:
        y = w.poseY + (w.poseDir === 0 ? -7 : 7);
        if (w.roll(2) === 1) {
          angle = 0x80;
          for (x = w.poseX + 1; this.blocked(x, y, r.self); x++);
        } else {
          for (x = w.poseX - 1; this.blocked(x, y, r.self); x--);
        }
        break;
      case 2:
      case 3:
        x = w.poseX + (w.poseDir === 2 ? 7 : -7);
        if (w.roll(2) === 1) {
          angle = 0xc0;
          for (y = w.poseY + 1; this.blocked(x, y, r.self); y++);
        } else {
          angle = 0x40;
          for (y = w.poseY - 1; this.blocked(x, y, r.self); y--);
        }
        break;
    }
    r.angle = angle;
    r.cellX = x;
    r.cellY = y;
    r.x = (r.cellX << 8) + 0x80;
    r.y = (r.cellY << 8) + 0x80;
    r.z = 0x12c;
    if (this.n !== 0) r.z += Math.trunc((r.self * 0x3c + 0x3c) / this.n) - 0x1e;
    r.toX = x;
    r.toY = y;
    r.speed = w.params.x43cf9e;
    r.turn = w.params.x43cfaa;
    r.state = 0;
    r.shown = 0;
    r.reload = 0;
    r.strength = w.params.x43cfba;
    setObj(r.last, r);
    r.pod = 0;
    if (w.pyro.wreckage() < 2 && w.roll(8) === 1 && w.state < 2) r.pod = 1;
  }

  /** 0x407463: a frame of every copter, then their shots */
  frame(): void {
    for (const r of this.recs) this.frameOf(r);
    this.moveShots();
  }

  /** 0x407495: one copter's frame — come in, move, ram the craft, and its picture */
  private frameOf(r: CopterRec): void {
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
    if (w.pyro.hitsCraft(r.last, r, 0x21c, 0xf)) {
      this.blast(r);
      w.sound(0x31);
    }
    const p = w.project(r);
    const depth = p.depth;
    if (depth < 0x10) return;
    let pic = (depth - 0x10) >> 6;
    if (pic >= 0x20) pic = 0x1f;
    let mirror = false;
    let h = ((w.cam.angle - r.angle + 8) & 0xff) >> 4;
    if (h >= 9) {
      h = 0x10 - h;
      mirror = true;
    }
    pic += h << 5;
    const rect = w.sprite(this.pics[pic], p.y, p.x, depth, mirror);
    if (depth < 0x140 || !rect) return;
    r.rect = widen(rect);
    r.depth = depth;
    r.shown = 1;
  }

  /** 0x407624: the blast where it rammed the craft */
  private blast(o: Obj): void {
    const w = this.w;
    const p = w.project(o);
    if (p.depth < 0x40) return;
    let i = (p.depth - 0x40) >> 7;
    if (i >= 0x10) i = 0xf;
    w.sprite(this.pyro(BLAST + i), p.y, p.x, p.depth - 1);
  }

  /** 0x407678: a copter's move by its state (0x43125c) */
  private move(r: CopterRec): void {
    const w = this.w;
    switch (r.state) {
      case 0: {
        const dx = r.cellX - w.cam.cellX;
        const dy = r.cellY - w.cam.cellY;
        const face = lookAlong(w, r);
        if (face !== null) r.goal = face;
        if (face !== null && abs(dx) <= 1 && abs(dy) <= 1) {
          r.state = 4;
          return;
        }
        // the first way and the second, each a cell and a heading
        let x1 = r.cellX;
        let y1 = r.cellY;
        let x2 = r.cellX;
        let y2 = r.cellY;
        let h1: number;
        let h2: number;
        if (abs(dx) > abs(dy)) {
          if (dx > 0) {
            h1 = 0x80;
            x1--;
          } else {
            h1 = 0;
            x1++;
          }
          if (dy > 0) {
            h2 = 0xc0;
            y2--;
          } else {
            h2 = 0x40;
            y2++;
          }
        } else {
          if (dy > 0) {
            h1 = 0xc0;
            y1--;
          } else {
            h1 = 0x40;
            y1++;
          }
          if (dx > 0) {
            h2 = 0x80;
            x2--;
          } else {
            h2 = 0;
            x2++;
          }
        }
        if (abs(dx) === abs(dy) && w.roll(2) === 1) {
          [x1, x2] = [x2, x1];
          [y1, y2] = [y2, y1];
          [h1, h2] = [h2, h1];
        }
        if (!this.blocked(x1, y1, r.self)) {
          r.toX = x1;
          r.toY = y1;
          r.goal = h1;
          r.state = 1;
        } else if (!this.blocked(x2, y2, r.self)) {
          r.toX = x2;
          r.toY = y2;
          r.goal = h2;
          r.state = 1;
        }
        return;
      }
      case 1:
        if (r.angle !== r.goal) {
          r.angle = turnToward(r.angle, r.goal, r.turn, 0x100);
          return;
        }
        r.goalX = (r.cellX << 8) + 0x80;
        r.goalY = (r.cellY << 8) + 0x80;
        // 0x431278: on to the next cell's centre
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
      case 2: {
        const ty = r.goalY;
        r.y += w.roll(5) - 3;
        if (r.y < ty - 0x2a) r.y = ty - 0x2a;
        if (r.y > ty + 0x2a) r.y = ty + 0x2a;
        if (r.way) {
          r.x += r.speed;
          if (r.x >= r.goalX) {
            r.x = r.goalX;
            r.state = 0;
          }
        } else {
          r.x -= r.speed;
          if (r.x <= r.goalX) {
            r.x = r.goalX;
            r.state = 0;
          }
        }
        r.cellX = r.x >> 8;
        if (downTheLine(w, r)) this.fire(r);
        return;
      }
      case 3: {
        const tx = r.goalX;
        r.x += w.roll(5) - 3;
        if (r.x < tx - 0x2a) r.x = tx - 0x2a;
        if (r.x > tx + 0x2a) r.x = tx + 0x2a;
        if (r.way) {
          r.y += r.speed;
          if (r.y >= r.goalY) {
            r.y = r.goalY;
            r.state = 0;
          }
        } else {
          r.y -= r.speed;
          if (r.y <= r.goalY) {
            r.y = r.goalY;
            r.state = 0;
          }
        }
        r.cellY = r.y >> 8;
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
      case DYING: {
        r.angle = (r.angle - (r.spins ? 0x10 : 4)) & 0xff;
        const was = copyObj(r);
        if (r.falls) r.vz--;
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
        if (--r.way < 0) met = true;
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
   * 0x407cd0: every `[0x43cfa2]` frames a shot from below and to the side, the
   * sides by turns: one time in four a missile (one in four of those homing),
   * else a bullet
   */
  private fire(r: CopterRec): void {
    const w = this.w;
    if (--r.reload > 0) return;
    r.reload = w.params.x43cfa2;
    const s = this.shots.find((s) => !s.on);
    if (!s) return;
    const missile = w.roll(4) === 1;
    let kind = BULLET;
    if (missile) kind = w.roll(4) === 1 ? HOMER : ROCKET;
    s.on = 1;
    s.kind = kind;
    s.met = 0;
    s.life = kind === BULLET ? 0x1e : 0x30;
    s.o.x = cosMul(r.angle, 1) + r.x;
    s.o.y = sinMul(r.angle, 1) + r.y;
    s.o.z = r.z + 0xc;
    r.fired++;
    const side = (r.fired & 1 ? r.angle + 0x40 : r.angle - 0x40) & 0xff;
    s.o.x += cosMul(side, 0x18);
    s.o.y += sinMul(side, 0x18);
    this.muzzle(s);
    aimAt(w, s, kind === BULLET ? 0x3c : 0x20);
    s.o.x -= s.vx;
    s.o.y -= s.vy;
    s.o.z -= s.vz;
    s.o.cellX = s.o.x >> 8;
    s.o.cellY = s.o.y >> 8;
    if (kind === BULLET) {
      w.sound(4);
      return;
    }
    w.sound(5);
    callShell(w, s.o);
    w.copilot.x404e11(r.angle);
    if (kind === HOMER) this.homing++;
  }

  /** 0x408011: the shots move, by their kind */
  private moveShots(): void {
    const w = this.w;
    for (const s of this.shots) {
      if (!s.on) continue;
      switch (s.kind) {
        case BULLET: {
          if (--s.life < 0) {
            s.on = 0;
            break;
          }
          const was = this.step(s);
          if (meets(w, was, s.o)) {
            s.met = 1;
            w.sound(w.roll(4) === 1 ? 0xf : 0xd);
          }
          if (w.pyro.hitsOurs(was, s.o, 0x15, 0)) {
            s.met = 2;
            w.sound(7);
          }
          this.drawBullet(s);
          if (s.met) s.on = 0;
          break;
        }
        case ROCKET: {
          if (--s.life < 0) {
            s.on = 0;
            break;
          }
          if (s.met) {
            s.met++;
            this.drawMissile(s);
            if (s.met >= 2) s.on = 0;
            break;
          }
          const was = this.step(s);
          if (meets(w, was, s.o)) this.burst(s, 0x10);
          if (w.pyro.hitsOurs(was, s.o, 0x2b, 0)) this.burst(s, 9);
          this.drawMissile(s);
          break;
        }
        case HOMER: {
          if (--s.life < 0) {
            s.on = 0;
            this.homing--;
            break;
          }
          if (s.met) {
            s.met++;
            this.drawMissile(s);
            if (s.met >= 2) {
              s.on = 0;
              this.homing--;
            }
            break;
          }
          const was = copyObj(s.o);
          if (aimAt(w, s, 0x20)) this.burst(s, 0x10);
          s.o.x += s.vx;
          s.o.y += s.vy;
          s.o.z += s.vz;
          s.o.cellX = s.o.x >> 8;
          s.o.cellY = s.o.y >> 8;
          if (meets(w, was, s.o)) this.burst(s, 0x10);
          if (w.pyro.hitsOurs(was, s.o, 0x56, 0)) this.burst(s, 9);
          this.drawMissile(s);
          break;
        }
      }
    }
  }

  /** a shot's step, answering where it was */
  private step(s: CopterShot): Obj {
    const was = copyObj(s.o);
    s.o.x += s.vx;
    s.o.y += s.vy;
    s.o.z += s.vz;
    s.o.cellX = s.o.x >> 8;
    s.o.cellY = s.o.y >> 8;
    return was;
  }

  /** a missile bursts (0x4081b2, 0x4081e4): 500 frames left, which the next frame ends */
  private burst(s: CopterShot, sound: number): void {
    s.met = 1;
    s.life = 0x1f4;
    this.w.sound(sound);
  }

  /** 0x408333: a bullet's picture — a shell, a chip off a wall, a hit */
  private drawBullet(s: CopterShot): void {
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

  /** 0x4083e9: a missile's picture, or its burst's two frames */
  private drawMissile(s: CopterShot): void {
    const w = this.w;
    const p = w.project(s.o);
    if (p.depth < 0x40) return;
    let i = (p.depth - 0x40) >> 7;
    if (i >= 0x10) i = 0xf;
    let base = s.kind === HOMER ? HOMING : MISSILE;
    if (s.met === 1) base = BLAST;
    else if (s.met === 2) base = BLAST2;
    w.sprite(this.pyro(base + i), p.y, p.x, p.depth);
  }

  /** 0x4084d4: the flash where a shot leaves */
  private muzzle(s: CopterShot): void {
    const w = this.w;
    const p = w.project(s.o);
    if (p.depth < 0x40) return;
    let i = (p.depth - 0x40) >> 7;
    if (i >= 0x10) i = 0xf;
    w.sprite(this.pyro(CHIP + i), p.y, p.x, p.depth);
  }

  /** 0x408529: a shot from `a` to `b` hits the first copter it meets */
  hit(a: Obj, b: Obj, dmg: number, r: number): boolean {
    for (const k of this.recs) if (this.hitOne(k, a, b, dmg, r)) return true;
    return false;
  }

  /** 0x408579: within its reach + 0x19 on every axis the shot hits; killed, $35, and it goes down */
  private hitOne(k: CopterRec, a: Obj, b: Obj, dmg: number, r: number): boolean {
    const w = this.w;
    if (k.self < 0 || k.state === DYING) return false;
    const reach = r + 0x19;
    if (k.z - reach > a.z && k.z - reach > b.z) return false;
    if (k.z + reach < a.z && k.z + reach < b.z) return false;
    if (k.x - reach > a.x && k.x - reach > b.x) return false;
    if (k.x + reach < a.x && k.x + reach < b.x) return false;
    if (k.y - reach > a.y && k.y - reach > b.y) return false;
    if (k.y + reach < a.y && k.y + reach < b.y) return false;
    k.strength -= dmg;
    if (k.strength > 0) return true;
    w.hud.addScore(0x23);
    w.r.tally.kills.copter++;
    let vy = k.y - k.last.y;
    const vz = k.z - k.last.z;
    let vx = k.x - k.last.x;
    if (vx === 0) vx = w.roll(0xd) - 7;
    if (vy === 0) vy = w.roll(0xd) - 7;
    k.vx = vx;
    k.vy = vy;
    k.vz = vz;
    if (w.roll(10) <= 8) {
      // a burst from its tail, 0x10 behind and 8 up
      const t = copyObj(k);
      t.x += cosMul(t.angle, -0x10);
      t.y += sinMul(t.angle, -0x10);
      t.z += 8;
      w.pyro.burst(t, 0, 0, 0);
    }
    k.way = w.roll(0x10) + 8;
    k.spins = 0;
    if (w.roll(10) <= 8) k.spins = 1;
    k.falls = 0;
    if (w.roll(10) <= 8) k.falls = 1;
    k.state = DYING;
    return true;
  }

  /** 0x408779: the world moved (dx, dy) — every copter up and every shot */
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

  /** 0x408815 */
  count(): number {
    return this.recs.filter((r) => r.self >= 0).length;
  }

  /** 0x408841: the k-th copter up, KIND.copter */
  nth(k: number): { obj: Obj; kind: number; flag: number; dying: number } {
    for (const r of this.recs) {
      if (r.self >= 0) k--;
      if (k < 0) return { obj: objOf(r), kind: KIND.copter, flag: r.pod, dying: r.state === DYING ? 1 : 0 };
    }
    throw new Error("0x408841: no such copter (0x41e28a 0x6b, 0x1d)");
  }

  /** 0x4088c0: the nearest copter drawn last frame (0x140 away or more) whose rect holds the point */
  pick(pt: Pt): Obj | null {
    let best: CopterRec | null = null;
    let near = 0x7fff;
    for (const r of this.recs) {
      if (r.shown && r.depth < near && inside(pt.y, pt.x, r.rect)) {
        best = r;
        near = r.depth;
      }
    }
    return best;
  }

  /** 0x408939: the copter up at exactly `o`'s point */
  find(o: Obj): Obj {
    const r = this.recs.find((r) => r.self >= 0 && r.x === o.x && r.y === o.y && r.z === o.z);
    if (!r) throw new Error("0x408939: no copter there (0x41e28a 0x6b, 0x1e)");
    return r;
  }

  /** 0x407cb5: the homing missiles up (`[0x434f04]`; below 0 is a logic error, 0x41e28a 0x6b, 0x1c) */
  missiles(): number {
    if (this.homing < 0) throw new Error("0x407cb5: fewer than no homing missiles (0x41e28a 0x6b, 0x1c)");
    return this.homing;
  }

  /** 0x408a03: another copter than `self` (−1 for any) is in cell (x, y), or going to it */
  occupied(x: number, y: number, self: number): boolean {
    for (const r of this.recs) {
      if (r.self < 0 || r.self === self) continue;
      if ((r.toX === x && r.toY === y) || (r.cellX === x && r.cellY === y)) return true;
    }
    return false;
  }
}
