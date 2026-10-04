/**
 * What the four vehicles' modules — the jeeps (0x40c738 …), the tanks
 * (0x4248bc …), the bikes (0x401684 …) and the copters (0x406fc4 …) — each
 * carry their own copy of in RAVEN.EXE, the copies alike but for the record
 * they walk and the numbers they hand on: the world moved under the fleet,
 * the aim's questions of it (count, nth, pick, find) and whose cell is taken,
 * a pyro picture by distance, a wreck's fall, the stand and fire, and the
 * tank's and copter's drive from cell centre to cell centre. What only the
 * jeep and the tank share (their coming in and their frame) is in jeep.ts,
 * the streets the jeep shares with the fuel station in street.ts.
 */
import type { Rect } from "@dreamfactory/engine/v0/screen";
import { downTheLine, inBlock, lookAlong, turnToward } from "./lib";
import { abs, inside, newObj, setObj, type Obj, type Pt, type Targets, type World } from "./world";

/** what every vehicle's record holds that its fleet's bookkeeping reads */
export interface Unit extends Obj {
  /** its slot while it is up, −1 while it is not */
  self: number;
  /** the point it is going to */
  goalX: number;
  goalY: number;
  /** its picture's rect last frame, its depth, and whether it was drawn (for the aim) */
  rect: Rect;
  depth: number;
  shown: number;
  /** it drops a pod when it is killed */
  pod: number;
}

/** a vehicle's shot as the world's move reads it */
interface Moved {
  on: number;
  o: Obj;
}

/**
 * The world moved (dx, dy) (0x40dd68, 0x425e2c, 0x402c7e, 0x408779): every
 * record up, its goal, and with `also` whatever else it holds in cells (the
 * cell it is going to: not the bike's), then every shot up
 */
export function shiftFleet<R extends Unit>(recs: R[], shots: Moved[], dx: number, dy: number, also?: (r: R, cx: number, cy: number) => void): void {
  const cx = dx >> 8;
  const cy = dy >> 8;
  for (const r of recs) {
    if (r.self < 0) continue;
    r.x += dx;
    r.y += dy;
    r.cellX += cx;
    r.cellY += cy;
    r.goalX += dx;
    r.goalY += dy;
    also?.(r, cx, cy);
  }
  for (const s of shots) {
    if (!s.on) continue;
    s.o.x += dx;
    s.o.y += dy;
    s.o.cellX += cx;
    s.o.cellY += cy;
  }
}

/** the cell it is going to, moved with the world (the jeep's, the tank's, the copter's) */
export const shiftTo = (r: { toX: number; toY: number }, cx: number, cy: number): void => {
  r.toX += cx;
  r.toY += cy;
};

/**
 * Another than `self` (−1 for any) is in cell (x, y), or going to it (the
 * jeep's 0x40dfe6, the tank's 0x4260bc, the copter's 0x408a03)
 */
export function occupiedBy(recs: (Unit & { toX: number; toY: number })[], x: number, y: number, self: number): boolean {
  for (const r of recs) {
    if (r.self < 0 || r.self === self) continue;
    if ((r.toX === x && r.toY === y) || (r.cellX === x && r.cellY === y)) return true;
  }
  return false;
}

/** how many are up (0x40de04, 0x425ec8, 0x402d0d, 0x408815) */
export function countUp(recs: Unit[]): number {
  return recs.filter((r) => r.self >= 0).length;
}

/**
 * The k-th up, 0 the first (0x40de30, 0x425ef4, 0x402d39, 0x408841): its
 * object, `kind`, its pod and whether it is `dying`; none is the EXE's logic
 * error `missing`
 */
export function nthUp<R extends Unit>(recs: R[], k: number, kind: number, dying: (r: R) => boolean, missing: string): ReturnType<Targets["nth"]> {
  for (const r of recs) {
    if (r.self >= 0) k--;
    if (k < 0) return { obj: objOf(r), kind, flag: r.pod, dying: dying(r) ? 1 : 0 };
  }
  throw new Error(missing);
}

/** the nearest drawn last frame (0x140 away or more) whose rect holds the point (0x40dea3, 0x425f76, 0x402db6, 0x4088c0) */
export function pickNearest<R extends Unit>(recs: R[], pt: Pt): R | null {
  let best: R | null = null;
  let near = 0x7fff;
  for (const r of recs) {
    if (r.shown && r.depth < near && inside(pt.y, pt.x, r.rect)) {
      best = r;
      near = r.depth;
    }
  }
  return best;
}

/**
 * The record at exactly `o`'s point (0x40df1c, 0x425fef, 0x402e2f, 0x408939):
 * up or not, or with `upOnly` (the copter's) up; none is the logic error `missing`
 */
export function findAt<R extends Unit>(recs: R[], o: Obj, missing: string, upOnly = false): R {
  const r = recs.find((r) => (!upOnly || r.self >= 0) && r.x === o.x && r.y === o.y && r.z === o.z);
  if (!r) throw new Error(missing);
  return r;
}

/** a record's object alone, the EXE's `movsd` ×6 into a local */
export function objOf(r: Obj): Obj {
  const o = newObj();
  setObj(o, r);
  return o;
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

/**
 * A pyro picture by distance at `o` (the shots, the muzzle flashes, the
 * blasts): none nearer than 0x40, else `base` and one of sixteen a 0x80 of
 * depth further, drawn `nearer` in front of where it is
 */
export function drawPyro(w: World, o: Obj, base: number, nearer = 0): void {
  const p = w.project(o);
  if (p.depth < 0x40) return;
  let n = (p.depth - 0x40) >> 7;
  if (n >= 0x10) n = 0xf;
  w.sprite(w.pyro.pics[base + n], p.y, p.x, p.depth - nearer, false);
}

/** a wreck's fall as the bike's and the copter's read it */
interface Falling extends Obj {
  vx: number;
  vy: number;
  vz: number;
}

/**
 * A falling wreck's step (the bike's 0x401ca4 and the copter's 0x407678,
 * dying): on by its step from `was`; into the ground it stops there and
 * bounces up a quarter as fast, into a block it is put back on the wall and
 * bounces off half as fast. True when it met either.
 */
export function tumble(w: World, r: Falling, was: Obj): boolean {
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
  return met;
}

/**
 * State 5, the jeep's (0x40cded), the tank's (0x424ed5) and the copter's
 * (0x407678): stand and `fire` while the craft is within two cells and down
 * the line, else choose again
 */
export function standFire<R extends Obj & { state: number }>(w: World, r: R, fire: (r: R) => void): void {
  const dx = r.cellX - w.cam.cellX;
  const dy = r.cellY - w.cam.cellY;
  if (downTheLine(w, r) && abs(dx) <= 2 && abs(dy) <= 2) fire(r);
  else r.state = 0;
}

/** what the tank's record and the copter's share for their drive from cell centre to cell centre */
export interface CellRec extends Unit {
  /** 0 choose, 1 turn to the way, 2 and 3 along x or y, 4 turn to face the craft, 5 stand and fire */
  state: number;
  /** the heading it is turning to */
  goal: number;
  /** along: 1 up x or y, 0 down */
  way: number;
  speed: number;
  /** its turn a frame */
  turn: number;
  /** the cell it is going to */
  toX: number;
  toY: number;
}

/**
 * States 0 to 5 of the tank's 0x424ed5 and the copter's 0x407678, which are
 * the same: from cell centre to cell centre toward the craft, not `blocked`
 * (its own slot aside), turning on the spot, wobbling up to 0x2a across and
 * firing while it is down the line; within a cell of the craft and facing
 * down the line it turns to it and stands (4, 5)
 */
export function cellToCell<R extends CellRec>(w: World, r: R, blocked: (x: number, y: number, self: number) => boolean, fire: (r: R) => void): void {
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
      if (!blocked(x1, y1, r.self)) {
        r.toX = x1;
        r.toY = y1;
        r.goal = h1;
        r.state = 1;
      } else if (!blocked(x2, y2, r.self)) {
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
      // 0x431278 (the copter's), 0x432638 (the tank's): on to the next cell's centre
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
        if (v >= goal) {
          v = goal;
          r.state = 0;
        }
      } else {
        v -= r.speed;
        if (v <= goal) {
          v = goal;
          r.state = 0;
        }
      }
      if (alongX) {
        r.x = v;
        r.cellX = v >> 8;
      } else {
        r.y = v;
        r.cellY = v >> 8;
      }
      if (downTheLine(w, r)) fire(r);
      return;
    }
    case 4:
      if (r.angle === r.goal) r.state = 5;
      else r.angle = turnToward(r.angle, r.goal, r.turn, 0x100);
      return;
    case 5:
      return standFire(w, r, fire);
  }
}
