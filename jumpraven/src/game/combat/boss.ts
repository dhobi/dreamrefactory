/**
 * The boss — RAVEN.EXE 0x402ea4 … 0x404230: the day's guardian of the pods,
 * one object at 0x434584 and its shots, 0x20 of 0x34 bytes at 0x4347d0.
 *
 * ## The end of a level
 *
 * Once the PODS bar is empty (0x40b5a7) the flight is 2 (0x40b5b8): the pods
 * come down (`pods.move`), the fuel station and the weapons ship go (0x4099ec,
 * 0x429355), and the pods' beacon is set on a street cell `2·[0x43cf5a]` cells
 * out with the boss over it (0x417d70 → 0x402ef5), 0x12c up. The boss's death
 * does not end the level: while the flight is 2 and the boss is down
 * (0x4041c9), the craft set down at rest on the beacon (0x418097) makes it 3
 * (0x418128), and 3 is the level done (0x40b5fd).
 *
 * ## What it does (0x402f75, 0x403083)
 *
 * It hangs over its cell turning 8 a frame (its heading kept unmasked, as the
 * EXE adds it), and every frame bumps the craft if it meets it (0x41b820,
 * 0x21c0 within 0x1e: a flash and a clang). Whenever the craft is along its
 * row or column in the open (0x4279cb) within six cells it fires — kept on
 * the same line, bullets for 100 frames (every other frame, `[0x43cf5e]`
 * apart), then 100 of shells, a roll of 2 between plain (1) and homing (2),
 * then on the 200th and after heavy homing shells (3); every shell but the
 * bullets every `[0x43cf5e]` frames. A new line starts the count again.
 *
 * ## Its death (0x403eb5)
 *
 * A hit costs it `dmg / 8` of `[0x43cfbe]` and must be within the reach +
 * 0x2d; killed it is worth 300 points, four fireballs burst round it, and it
 * falls (1): spinning 16 a frame nine times in ten (else 4), sinking one more
 * a frame nine times in ten (else it hangs), 8 … 23 frames, bouncing off the
 * ground and the blocks — and blows up at the end, or on the first bounce
 * (0x4032e9), the pilot whooping (0, 0x12). The fall's speed is never set
 * but by those bounces, so it starts where the last fall left it (the EXE's
 * globals); the port keeps it for the life of the module.
 *
 * ## Its shots (0x40372a)
 *
 *   0  a bullet, 0x3c a step for 0x1e frames, drawn as a beam from where it
 *      was (0x403bc8); into ours 0x15
 *   1  a shell, 0x20 a step for 0x30 frames; into ours 0x2b
 *   2  a homing shell, re-aimed every frame (a decoy draws it); 0x56
 *   3  a heavy homing shell, which no decoy draws; 0x159
 *
 * They move only while the boss is up. A shell's burst shows two frames.
 * Its pictures (BOSS, 0x80) are 32 distances by 4 quarters (0x402fd9).
 */
import type { FrameV0 } from "@dreamfactory/engine/df/image-v0";
import type { BossApi } from "./api";
import { drawShot, objOf, withinReach, type VehicleShot } from "./jeep";
import { aimAt, callShell, inBlock, lookAlong, meets } from "./lib";
import { KIND, abs, copyObj, cosMul, newObj, readPictures, sinMul, type Obj, type World } from "./world";

/** the boss, the EXE's globals from 0x434584 (its object the first 0x18) */
interface BossRec extends Obj {
  /** +0x18 `[0x43459c]` 0 hanging and firing, 1 falling */
  state: number;
  /** +0x1c `[0x4345a0]` its strength (`[0x43cfbe]`) */
  strength: number;
  /** +0x20 `[0x4345a4]` frames to its next shot */
  reload: number;
  /** +0x24 `[0x4345a8]` 0 while it is up, −1 while it is not */
  self: number;
  /** +0x28 … +0x30 `[0x4345ac]` … its fall's step */
  vx: number;
  vy: number;
  vz: number;
  /** +0x34 `[0x4345b8]` it spins fast as it falls; +0x38 `[0x4345bc]` it sinks */
  spin: number;
  sinks: number;
  /** +0x3c `[0x4345c0]` frames till it blows up */
  fuse: number;
  /** +0x40 `[0x4345c4]` the heading the craft was last seen down; +0x44 `[0x4345c8]` frames it has been seen so */
  seenWay: number;
  seen: number;
}

export class Boss implements BossApi {
  /** 0x4345d0: BOSS's pictures (0x402ea4) */
  private readonly pics: (FrameV0 | undefined)[];
  private readonly r: BossRec = {
    ...newObj(), state: 0, strength: 0, reload: 0, self: -1, vx: 0, vy: 0, vz: 0, spin: 0, sinks: 0, fuse: 0, seenWay: -1, seen: 0,
  };
  /** 0x4347d0 */
  private readonly shots: VehicleShot[] = Array.from({ length: 0x20 }, () => ({
    on: 0, kind: 0, met: 0, life: 0, vx: 0, vy: 0, vz: 0, o: newObj(),
  }));
  /** `[0x434580]`: homing shells (2 and 3) up */
  private homingUp = 0;

  constructor(
    readonly w: World,
    pictures: Uint8Array,
  ) {
    this.pics = readPictures(pictures);
  }

  /** 0x402ee5: down; the shots off (0x403327) */
  reset(): void {
    this.r.self = -1;
    for (const s of this.shots) s.on = 0;
    this.homingUp = 0;
  }

  /** 0x403345: how many of its homing shells are up (the copilot's 0x405222, the chatter's 0x4140cd) */
  homing(): number {
    if (this.homingUp < 0) throw new Error("0x403345: fewer than no homing shells (0x41e28a 0x6b, 6)");
    return this.homingUp;
  }

  /** 0x402ef5: over cell (x, y)'s centre, 0x12c up, facing east, hanging, full strength */
  callIn(x: number, y: number): void {
    const r = this.r;
    r.angle = 0;
    r.cellX = x;
    r.cellY = y;
    r.x = (x << 8) + 0x80;
    r.y = (y << 8) + 0x80;
    r.z = 0x12c;
    r.state = 0;
    r.reload = 0;
    r.strength = this.w.params.x43cfbe;
    r.self = 0;
    r.seenWay = -1;
  }

  /** 0x402f6a: the boss (0x402f75), then its shots (0x40372a) */
  frame(): void {
    this.one();
    if (this.r.self >= 0) this.moveShots();
  }

  /** 0x402f75 */
  private one(): void {
    const w = this.w;
    const r = this.r;
    if (r.self < 0) return;
    this.think();
    if (w.pyro.hitsCraft(r, r, 0x21c0, 0x1e)) {
      this.flash(r);
      w.sound(0x31);
    }
    const p = w.project(r);
    if (p.depth < 0x10) return;
    let d = (p.depth - 0x10) >> 6;
    if (d >= 0x20) d = 0x1f;
    let q = ((w.cam.angle - r.angle + 8) & 0xff) >> 6;
    if (q >= 4) q = 3;
    // the EXE passes a stack slot it never set as the mirror flag (0x403014); its four quarters need none
    w.sprite(this.pics[d + (q << 5)], p.y, p.x, p.depth, false);
  }

  /** 0x40302f: pyro's burst picture over `o`, just in front of it */
  private flash(o: Obj): void {
    const w = this.w;
    const p = w.project(o);
    if (p.depth < 0x40) return;
    let n = (p.depth - 0x40) >> 7;
    if (n >= 0x10) n = 0xf;
    w.sprite(w.pyro.pics[0xc0 + n], p.y, p.x, p.depth - 1, false);
  }

  /** 0x403083 */
  private think(): void {
    const w = this.w;
    const r = this.r;
    if (r.state === 0) {
      r.angle += 8;
      const way = lookAlong(w, r);
      if (way === null) return;
      if (way !== r.seenWay) r.seen = 0;
      r.seenWay = way;
      if (abs(r.cellX - w.cam.cellX) > 6 || abs(r.cellY - w.cam.cellY) > 6) return;
      if (r.seen < 0x64) this.fire(0);
      if (r.seen >= 0x64 && r.seen < 0xc8) this.fire(w.roll(2) === 1 ? 1 : 2);
      if (r.seen >= 0xc8) return this.fire(3);
      r.seen++;
      return;
    }
    if (r.state !== 1) return;
    // 0x403195: falling
    r.angle = (r.angle + (r.spin ? -0x10 : -4)) & 0xff;
    const last = copyObj(r);
    if (r.sinks) r.vz--;
    r.x += r.vx;
    r.y += r.vy;
    r.z += r.vz;
    r.cellX = r.x >> 8;
    r.cellY = r.y >> 8;
    let ended = false;
    if (r.z <= 0) {
      r.z = 0;
      r.vz = -Math.trunc(r.vz / 4);
      ended = true;
    }
    if (inBlock(w, r)) {
      if (last.cellX !== r.cellX) {
        r.x = ((last.cellX + r.cellX) << 7) + 0x80;
        r.cellX = r.x >> 8;
        r.vx = -Math.trunc(r.vx / 2);
        ended = true;
      }
      if (last.cellY !== r.cellY) {
        r.y = ((last.cellY + r.cellY) << 7) + 0x80;
        r.cellY = r.y >> 8;
        r.vy = -Math.trunc(r.vy / 2);
        ended = true;
      }
    }
    if (--r.fuse < 0) ended = true;
    if (!ended) return;
    w.pyro.burst(r, r.vx, r.vy, r.vz);
    r.self = -1;
    w.comms.ask(0, 0x12);
  }

  /**
   * 0x403360: a shot of `kind` from the first free slot, if one is due (none
   * free, the reload waits); from its point 0xc up at the weapons ship, the
   * fuel station or the craft (0x4276cb)
   */
  private fire(kind: number): void {
    const w = this.w;
    const r = this.r;
    const s = this.shots.find((s) => !s.on);
    if (!s) return;
    if (kind === 0) {
      // bullets on every other frame of the reload
      if (--r.reload < 0) r.reload = w.params.x43cf5e;
      if (r.reload & 1) return;
    } else {
      if (--r.reload > 0) return;
      r.reload = w.params.x43cf5e;
    }
    s.on = 1;
    s.kind = kind;
    s.met = 0;
    s.life = kind ? 0x30 : 0x1e;
    s.o.x = cosMul(r.angle, 0) + r.x;
    s.o.y = sinMul(r.angle, 0) + r.y;
    s.o.z = r.z + 0xc;
    drawShot(w, s, 0xe0);
    aimAt(w, s, kind ? 0x20 : 0x3c);
    s.o.x -= s.vx;
    s.o.y -= s.vy;
    s.o.z -= s.vz;
    s.o.cellX = s.o.x >> 8;
    s.o.cellY = s.o.y >> 8;
    if (!kind) return void w.sound(0x1d);
    w.sound(5);
    callShell(w, s.o);
    // the heading as the boss keeps it, unmasked (0x403462)
    w.copilot.x404e11(r.angle);
    if (kind >= 2) this.homingUp++;
  }

  /** 0x40372a (0x431128's cases) */
  private moveShots(): void {
    const w = this.w;
    for (const s of this.shots) {
      if (!s.on) continue;
      if (s.kind === 0) {
        if (--s.life < 0) {
          s.on = 0;
          continue;
        }
        const last = copyObj(s.o);
        this.step(s);
        if (meets(w, last, s.o)) {
          s.met = 1;
          w.sound(w.roll(4) === 1 ? 0xf : 0xd);
        }
        if (w.pyro.hitsOurs(last, s.o, 0x15, 0)) {
          s.met = 2;
          w.sound(7);
        }
        this.drawBullet(last, s);
        if (s.met) s.on = 0;
        continue;
      }
      if (s.kind > 3) continue;
      const homes = s.kind >= 2;
      if (--s.life < 0) {
        s.on = 0;
        if (homes) this.homingUp--;
        continue;
      }
      if (s.met) {
        s.met++;
        this.drawShell(s);
        if (s.met >= 2) {
          s.on = 0;
          if (homes) this.homingUp--;
        }
        continue;
      }
      const last = copyObj(s.o);
      if (homes && aimAt(w, s, 0x20)) this.burst(s, 0x10);
      this.step(s);
      if (meets(w, last, s.o)) this.burst(s, 0x10);
      if (w.pyro.hitsOurs(last, s.o, [0, 0x2b, 0x56, 0x159][s.kind], 0)) this.burst(s, 9);
      this.drawShell(s);
    }
  }

  private step(s: VehicleShot): void {
    s.o.x += s.vx;
    s.o.y += s.vy;
    s.o.z += s.vz;
    s.o.cellX = s.o.x >> 8;
    s.o.cellY = s.o.y >> 8;
  }

  /** a shell bursts: shown next frame and gone (its 0x1f4 frames never run out first), with sound `n` */
  private burst(s: VehicleShot, n: number): void {
    s.met = 1;
    s.life = 0x1f4;
    this.w.sound(n);
  }

  /**
   * 0x403bc8: a bullet — into ours pyro's 0x108 …, into a block 0xe0 …, by
   * distance; flying, a beam from where it is back to where it was, pyro's
   * 0 … 3 by distance
   */
  private drawBullet(last: Obj, s: VehicleShot): void {
    const w = this.w;
    const p = w.project(s.o);
    if (p.depth < 0x40) return;
    let n = (p.depth - 0x40) >> 7;
    if (s.met) {
      if (n >= 0x10) n = 0xf;
      w.sprite(w.pyro.pics[(s.met === 2 ? 0x108 : 0xe0) + n], p.y, p.x, p.depth, false);
      return;
    }
    const q = w.project(last);
    if (q.depth < 0x40) return;
    if (n >= 4) n = 3;
    w.beam(w.pyro.pics[n], p.y, p.x, q.y, q.x, p.depth);
  }

  /** 0x403c96 / 0x403d81: a shell — bursting (pyro's 0xc0 …, then 0xd0 …), else by kind 0x13c …, 0x12c …, 0x14c … */
  private drawShell(s: VehicleShot): void {
    let base = [0, 0x13c, 0x12c, 0x14c][s.kind];
    if (s.met === 1) base = 0xc0;
    else if (s.met === 2) base = 0xd0;
    drawShot(this.w, s, base);
  }

  /** 0x403e8f / 0x403eb5: within `reach` + 0x2d and not falling; `dmg` / 8 of its strength */
  hit(a: Obj, b: Obj, dmg: number, reach: number): boolean {
    const w = this.w;
    const r = this.r;
    if (r.self < 0 || r.state === 1) return false;
    if (!withinReach(r, a, b, reach + 0x2d)) return false;
    r.strength -= dmg >> 3;
    if (r.strength > 0) return true;
    w.hud.addScore(0x12c);
    // four fireballs, 0x20 back from each quarter, 8 up
    for (const q of [0, 0x40, 0x80, 0xc0]) {
      const at = objOf(r);
      at.x += cosMul(q, -0x20);
      at.y += sinMul(q, -0x20);
      at.z += 8;
      w.pyro.burst(at, 0, 0, 0);
    }
    r.fuse = w.roll(0x10) + 8;
    r.spin = w.roll(0xa) <= 8 ? 1 : 0;
    r.sinks = w.roll(0xa) <= 8 ? 1 : 0;
    r.state = 1;
    return true;
  }

  /** 0x40415d: the boss and its shots, while it is up */
  shift(dx: number, dy: number): void {
    const r = this.r;
    if (r.self < 0) return;
    const cx = dx >> 8;
    const cy = dy >> 8;
    r.x += dx;
    r.y += dy;
    r.cellX += cx;
    r.cellY += cy;
    for (const s of this.shots) {
      if (!s.on) continue;
      s.o.x += dx;
      s.o.y += dy;
      s.o.cellX += cx;
      s.o.cellY += cy;
    }
  }

  /** 0x4041c9: 1 while it is up (falling included), 0 once it is down — also its count of targets (0x40c563) */
  up(): number {
    return this.r.self < 0 ? 0 : 1;
  }

  count(): number {
    return this.up();
  }

  /** 0x4041d6: falling, it is dying */
  nth(_k: number): { obj: Obj; kind: number; flag: number; dying: number } {
    return { obj: objOf(this.r), kind: KIND.boss, flag: 0, dying: this.r.state === 1 ? 1 : 0 };
  }

  /** 0x404208 */
  at(x: number, y: number): boolean {
    const r = this.r;
    return r.self >= 0 && r.cellX === x && r.cellY === y;
  }
}

