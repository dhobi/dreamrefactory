/**
 * RAVEN.EXE's shared library helpers the actors call (0x426124 … 0x429314),
 * each by its address — the ones world.ts does not already hold.
 */
import type { Chatter } from "../comms";
import { dist, cosMul, sinMul, abs, newObj, CENTRE_X, CENTRE_Y, FOCAL, type Obj, type Pt, type World } from "./world";

/** 0x427b47: `o` is in a block — never above 500 up */
export function inBlock(w: World, o: Obj): boolean {
  if (o.z > 0x1f4) return false;
  return w.solid(o.cellX, o.cellY);
}

/**
 * 0x427b6d: a shot moved from `from` to `to` met the ground (held at 0) or a
 * block: into a block, it is put back on the wall between the two cells it
 * crossed, on each axis it crossed
 */
export function meets(w: World, from: Obj, to: Obj): boolean {
  let met = false;
  if (to.z <= 0) {
    to.z = 0;
    met = true;
  }
  if (inBlock(w, to)) {
    if (from.cellX !== to.cellX) {
      to.x = ((from.cellX + to.cellX) << 7) + 0x80;
      to.cellX = to.x >> 8;
      met = true;
    }
    if (from.cellY !== to.cellY) {
      to.y = ((from.cellY + to.cellY) << 7) + 0x80;
      to.cellY = to.y >> 8;
      met = true;
    }
  }
  return met;
}

/** 0x427afd: `o` is nine cells or more from the craft's cell, either way */
export function tooFar(w: World, o: Obj): boolean {
  return abs(o.cellX - w.cam.cellX) >= 9 || abs(o.cellY - w.cam.cellY) >= 9;
}

/**
 * 0x427c58: the point of the world `depth` ahead of the eye that the view's
 * point `pt` shows (the eye's heading, `[0x43cd34]`, is the craft's)
 */
export function unproject(w: World, pt: Pt, depth: number): Obj {
  const a = w.cam.angle;
  const o: Obj = { angle: 0, x: cosMul(a, depth) + w.eyeX, y: sinMul(a, depth) + w.eyeY, z: 0, cellX: 0, cellY: 0 };
  o.z = w.eyeZ - Math.trunc(((pt.y - CENTRE_Y) * depth) / FOCAL);
  const across = Math.trunc(((pt.x - CENTRE_X) * depth) / FOCAL);
  const side = (a + 0x40) & 0xff;
  o.x += cosMul(side, across);
  o.y += sinMul(side, across);
  o.cellX = o.x >> 8;
  o.cellY = o.y >> 8;
  return o;
}

/** 0x427d49: the view shaken (1, 2) or flashed (3) this frame, the most asked for */
export function jolt(w: World, n: number): void {
  if (n > w.jolt) w.jolt = n;
}

/**
 * 0x426b68: the palette to be taken `a`/`b` of the way to a CLUT (RAVENRES's
 * `clut` 0x81, `[0x43b324]`, an explosion's flash; 0x83, `[0x43b31c]`, a
 * fireball going out) — kept unless the one already asked for is at least
 * full; the flight shows it and puts the palette back (0x426b9b, 0x426c01)
 */
export function flash(w: World, clut: number, a: number, b: number): void {
  if (w.flash && w.flash.a >= w.flash.b) return;
  w.flash = { clut, a, b };
}

/**
 * 0x427778: `cur` turned `step` toward `target` the shorter way round a
 * circle of `n`, stopping at it
 */
export function turnToward(cur: number, target: number, step: number, n: number): number {
  if (cur < target) {
    if (target - cur < n - target + cur) return Math.min(cur + step, target);
    cur -= step;
    if (cur < 0 && (cur += n) < target) cur = target;
    return cur;
  }
  if (cur - target < n - cur + target) return Math.max(cur - step, target);
  cur += step;
  if (cur >= n && (cur -= n) > target) cur = target;
  return cur;
}

/**
 * 0x4277e3: the craft is down the line of `o`'s heading — in its row or column
 * ahead of it, no block between (the craft's cell counted), and the enemy's
 * sight not jammed along it (0x41d2cf); never while the craft is going down
 */
export function downTheLine(w: World, o: Obj): boolean {
  if (w.state <= 0) return false;
  const cx = w.cam.cellX;
  const cy = w.cam.cellY;
  switch (o.angle) {
    case 0:
      if (o.cellY !== cy || o.cellX >= cx) return false;
      for (let k = o.cellX + 1; k <= cx; k++) if (w.solid(k, o.cellY)) return false;
      return !w.pyro.x41d2cf(1, o.cellX + 1, cx);
    case 0x40:
      if (o.cellX !== cx || o.cellY >= cy) return false;
      for (let k = o.cellY + 1; k <= cy; k++) if (w.solid(o.cellX, k)) return false;
      return !w.pyro.x41d2cf(0, o.cellY + 1, cy);
    case 0x80:
      if (o.cellY !== cy || o.cellX <= cx) return false;
      for (let k = o.cellX - 1; k >= cx; k--) if (w.solid(k, o.cellY)) return false;
      return !w.pyro.x41d2cf(1, cx, o.cellX - 1);
    case 0xc0:
      if (o.cellX !== cx || o.cellY <= cy) return false;
      for (let k = o.cellY - 1; k >= cy; k--) if (w.solid(o.cellX, k)) return false;
      return !w.pyro.x41d2cf(0, cy, o.cellY - 1);
  }
  throw new Error(`0x4277e3: a heading of ${o.angle} is no quarter (0x41e28a 0x6b, 0xb2)`);
}

/**
 * 0x4279cb: the heading from `o` down its row or column to the craft with no
 * block between (the craft's cell counted; in the craft's own cell, 0xc0),
 * whichever way `o` faces; null if there is none or the craft is going down.
 * Unlike 0x4277e3 no jamming blinds it.
 */
export function lookAlong(w: World, o: Obj): number | null {
  if (w.state <= 0) return null;
  const cx = w.cam.cellX;
  const cy = w.cam.cellY;
  if (o.cellX !== cx && o.cellY !== cy) return null;
  if (o.cellX === cx) {
    if (o.cellY < cy) {
      for (let k = o.cellY + 1; k <= cy; k++) if (w.solid(o.cellX, k)) return null;
      return 0x40;
    }
    for (let k = o.cellY - 1; k >= cy; k--) if (w.solid(o.cellX, k)) return null;
    return 0xc0;
  }
  if (o.cellX < cx) {
    for (let k = o.cellX + 1; k <= cx; k++) if (w.solid(k, o.cellY)) return null;
    return 0;
  }
  for (let k = o.cellX - 1; k >= cx; k--) if (w.solid(k, o.cellY)) return null;
  return 0x80;
}

/** an enemy's shot as 0x4276cb reads it: +0x04 its kind, +0x10 … its step, +0x1c where it is */
export interface EnemyShot {
  kind: number;
  vx: number;
  vy: number;
  vz: number;
  o: Obj;
}

/**
 * 0x4276cb: an enemy's shot aimed at `speed` a step: at a decoy that draws it
 * if it is of kind 2 (0x41b62d), else at the weapons ship if it is up
 * (0x42aa99), else the fuel station (0x40b112), else the craft; true when it
 * is there within a step
 */
export function aimAt(w: World, s: EnemyShot, speed: number): boolean {
  const decoy: Obj = { angle: 0, x: 0, y: 0, z: 0, cellX: 0, cellY: 0 };
  const t = (s.kind === 2 && w.pyro.x41b62d(decoy) ? decoy : null) ?? w.weap.where() ?? w.fuel.where() ?? w.cam;
  const dx = t.x - s.o.x;
  const dy = t.y - s.o.y;
  const dz = t.z - s.o.z;
  const n = Math.trunc(dist(dx, dy, dz) / speed) + 1;
  s.vx = Math.trunc(dx / n);
  s.vy = Math.trunc(dy / n);
  s.vz = Math.trunc(dz / n);
  return n <= 1;
}

/**
 * 0x41444c: `o` is down heading `a` from the craft, fewer than five cells
 * along its row or column, no block between (its own cell counted)
 */
export function downFromCraft(w: World, a: number, o: Obj): boolean {
  const cx = w.cam.cellX;
  const cy = w.cam.cellY;
  switch (a) {
    case 0:
      if (o.cellY !== cy || o.cellX <= cx || cx + 5 <= o.cellX) return false;
      for (let k = cx + 1; k <= o.cellX; k++) if (w.solid(k, cy)) return false;
      return true;
    case 0x40:
      if (o.cellX !== cx || o.cellY <= cy || cy + 5 <= o.cellY) return false;
      for (let k = cy + 1; k <= o.cellY; k++) if (w.solid(cx, k)) return false;
      return true;
    case 0x80:
      if (o.cellY !== cy || o.cellX >= cx || cx - 5 >= o.cellX) return false;
      for (let k = cx - 1; k >= o.cellX; k--) if (w.solid(k, cy)) return false;
      return true;
    case 0xc0:
      if (o.cellX !== cx || o.cellY >= cy || cy - 5 >= o.cellY) return false;
      for (let k = cy - 1; k >= o.cellY; k--) if (w.solid(cx, k)) return false;
      return true;
  }
  throw new Error(`0x41444c: a heading of ${a} is no quarter (0x41e28a 0x6b, 0x57)`);
}

/**
 * 0x41438a (the comms' range): an enemy's shell fired from `o` — unless the
 * copilot navigates, a line is playing (`[0x4373f8]` ≥ 0) or the craft is on
 * the move, the pilot calls where it came from, of the craft's quarter
 * (heading + 0x20): behind (line 0x1a), the left (0x1c) or the right (0x1b)
 */
export function callShell(w: World, o: Obj): void {
  const [navigates] = w.hud.x417617();
  if (navigates !== 0 || w.comms.keyframe() >= 0 || w.speed !== 0) return;
  const q = (w.cam.angle + 0x20) & 0xc0;
  if (downFromCraft(w, (q + 0x80) & 0xff, o)) return void w.comms.ask(0, 0x1a);
  if (downFromCraft(w, (q - 0x40) & 0xff, o)) return void w.comms.ask(0, 0x1c);
  if (downFromCraft(w, (q + 0x40) & 0xff, o)) w.comms.ask(0, 0x1b);
}

/**
 * 0x40ce63's cases (0x431558; the fuel station's 0x43133c, the weapons ship's
 * 0x432b20): facing `angle`, `dx`, `dy` from the cell it is heading for, the
 * three ways a street-bound thing may take without turning back, the first
 * toward it by the longer way; a tie across is settled by a roll of 2 (the
 * jeep keeps its own copy, src/game/combat/jeep.ts)
 */
export function waysToward(w: World, angle: number, dx: number, dy: number): [number, number, number] {
  const ax = abs(dx);
  const ay = abs(dy);
  /** [p, q] if `yes`, or on a tie one time in two; else [q, p] */
  const pair = (yes: boolean, tie: boolean, p: number, q: number): [number, number] =>
    yes || (tie && w.roll(2) === 1) ? [p, q] : [q, p];
  switch (angle) {
    case 0:
      if (ax > ay) {
        if (dx < 0) return [0, ...pair(dy > 0, dy === 0, 0xc0, 0x40)];
        return [...pair(dy > 0, dy === 0, 0xc0, 0x40), 0];
      }
      return dy < 0 ? [0x40, 0, 0xc0] : [0xc0, 0, 0x40];
    case 0x40:
      if (ax < ay) {
        if (dy < 0) return [0x40, ...pair(dx < 0, dx === 0, 0, 0x80)];
        return [...pair(dx < 0, dx === 0, 0, 0x80), 0x40];
      }
      return dx < 0 ? [0, 0x40, 0x80] : [0x80, 0x40, 0];
    case 0x80:
      if (ax > ay) {
        if (dx > 0) return [0x80, ...pair(dy > 0, dy === 0, 0xc0, 0x40)];
        return [...pair(dy > 0, dy === 0, 0xc0, 0x40), 0x80];
      }
      return dy < 0 ? [0x40, 0x80, 0xc0] : [0xc0, 0x80, 0x40];
    case 0xc0:
      if (ax < ay) {
        if (dy > 0) return [0xc0, ...pair(dx < 0, dx === 0, 0, 0x80)];
        return [...pair(dx < 0, dx === 0, 0, 0x80), 0xc0];
      }
      return dx < 0 ? [0, 0xc0, 0x80] : [0x80, 0xc0, 0];
  }
  throw new Error(`0x409eb4: facing ${angle}, no ways to choose`);
}

/**
 * What the comms box's chatter in flight (0x413c6d(1), src/game/comms.ts)
 * reads of the world, each by the EXE's call
 */
export function chatterOf(w: World): Chatter {
  const beacon = (): { n: number; at: Obj } => {
    const out = { n: -1 };
    const at = newObj();
    w.hud.x417d4d(out, at);
    return { n: out.n, at };
  };
  return {
    copilots: () => w.hud.x417617(),
    shields: () => w.hud.shields(),
    wreckage: () => w.pyro.x41d6c3(),
    beacon: () => beacon().n,
    squared: () => (w.cam.angle & 0x3f) === 0,
    ahead: (kind) => {
      if (kind === 0) return downFromCraft(w, w.cam.angle, w.fuel.nth(0).obj);
      if (kind === 1) return downFromCraft(w, w.cam.angle, w.weap.nth(0).obj);
      return downFromCraft(w, w.cam.angle, beacon().at);
    },
    homing: () => {
      const missiles = w.copter.missiles();
      const boss = w.boss.homing();
      return missiles + (boss + w.tank.x425412());
    },
  };
}
