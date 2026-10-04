/**
 * The fuel station — RAVEN.EXE 0x4099b8 … 0x40b190: one of the EXE's records
 * at 0x4360dc, a tanker the HUD calls in when the fuel runs low (0x41839d),
 * which drives the streets to the beacon, waits there for the craft to set
 * down behind it, fills it up for points, and drives off.
 *
 * ## Where it comes from (0x4099f7)
 *
 * Seven cells ahead of the craft's pose, across its way, like a jeep
 * (0x40c807): out along the row from beside the pose's line to the first cell
 * that is not a block, a jeep's or a tank's (0x40b085), facing back across,
 * starting at its cell's edge. The fuel man says he is coming (1, 4).
 *
 * ## How it moves (0x409e30)
 *
 *   0  choose: of the three ways it can take without turning back, the one
 *      toward the beacon's cell first (0x417d4d), one time in ten the second
 *      or third even when the first is open; in the beacon's cell, 5. Once it
 *      has served (not called any more) it heads for a cell 40 behind the
 *      craft (0x40ac0c) until it is nine cells away and gone (0x427afd)
 *   1, 2  roll along x or y (0x18 a frame) to the next cell's edge, wobbling up
 *      to 0x33 across the street
 *   3, 4  turn a corner, round a quarter circle about the cell's corner
 *   5  in the beacon's cell: straight to its centre, 0x18 a step each way;
 *      there the fuel man calls the craft in (1, 5 with enemies about, else 8)
 *   6  wait, 500 frames at most (then 1, 7 and it goes), for the craft at rest
 *      0x5a up at most, facing its way, within 0x14 of it
 *   7  fill: a point for each 0x56 of fuel while the craft stays so and is not
 *      full (0x4380), and there are points to pay
 *   8  the beacon off, it drives on to its cell's edge when that is clear, and
 *      chooses again (0)
 *   9  killed while called: burning 0x20 … 0x33 frames, a fireball one frame
 *      in three, scorching the craft nearby (0x41b820, 0xd8 within 0x64)
 *
 * A hit (0x40ae4a) costs its strength (`[0x43cfc2]`) — the fuel man complains
 * the first time (1, 6) — and killing it costs 100 points: while called it
 * burns (9), else it blows up at once. Its pictures (FUEL, 0x120 of them) are a
 * jeep's: 32 distances by 9 headings, the other seven mirrored (0x409d5f).
 *
 * The weapons ship (src/game/combat/weap.ts) is the same record and the same
 * streets with other ends; what they share is here.
 */
import type { FrameV0 } from "@dreamfactory/engine/df/image-v0";
import type { FuelApi } from "./api";
import { comeIn, objOf, withinReach } from "./jeep";
import { tooFar, turnToward, waysToward } from "./lib";
import { KIND, cosMul, dist, newObj, readPictures, setObj, sinMul, type Obj, type World } from "./world";

/**
 * The fuel station's record, the EXE's at 0x4360dc — and the weapons ship's at
 * 0x43ac5c, the same fields at the same offsets (its object the first 0x18)
 */
export interface DepotRec extends Obj {
  /** +0x18 where it was at the frame's start */
  last: Obj;
  /** +0x30 the state (0x431314; the ship's 0x432afc) */
  state: number;
  /** +0x34 the heading it is turning to */
  goal: number;
  /** +0x38, +0x3c the point it is going to: the cell's edge, or in a turn the corner it turns about */
  goalX: number;
  goalY: number;
  /** +0x40 rolling: 1 up x or y, 0 down; turning: the step a frame; the ship's fall: frames till it blows up */
  way: number;
  /** +0x44 its speed, 0x18 */
  speed: number;
  /** +0x48 a turn's radius */
  radius: number;
  /** +0x4c its strength (`[0x43cfc2]`, the ship's `[0x43cfc6]`) */
  strength: number;
  /** +0x58 0 while it is up, −1 while it is not */
  self: number;
  /** +0x5c, +0x60 the cell it is going to */
  toX: number;
  toY: number;
  /** +0x64 it is the beacon's: on its way to it, or there (cleared when it has served) */
  called: number;
  /** +0x68 frames it waits at the beacon */
  wait: number;
  /** +0x6c its man has complained of a hit */
  complained: number;
  /** +0x70 frames the station burns (not the ship's) */
  burn: number;
}

export const newDepot = (): DepotRec => ({
  ...newObj(), last: newObj(), state: 0, goal: 0, goalX: 0, goalY: 0, way: 0, speed: 0, radius: 0, strength: 0,
  self: -1, toX: 0, toY: 0, called: 0, wait: 0, complained: 0, burn: 0,
});

/**
 * 0x4099f7 / 0x429360: called in — seven cells ahead of the pose (0x40c807's
 * way) out to the first cell not `blocked`, at its cell's edge facing back
 * across, `z` up, at 0x18 a step, `strength` strong, the beacon's
 */
export function callDepot(w: World, r: DepotRec, blocked: (x: number, y: number) => boolean, z: number, strength: number): void {
  const c = comeIn(w, blocked);
  r.angle = c.angle;
  r.cellX = c.cellX;
  r.cellY = c.cellY;
  r.x = (r.cellX << 8) + 0x80;
  r.y = (r.cellY << 8) + 0x80;
  r.z = z;
  r.toX = r.cellX;
  r.toY = r.cellY;
  // 0x4312f4
  switch (r.angle) {
    case 0:
      r.x -= 0x80;
      r.toX--;
      break;
    case 0x40:
      r.y -= 0x80;
      r.toY--;
      break;
    case 0x80:
      r.x += 0x80;
      r.toX++;
      break;
    case 0xc0:
      r.y += 0x80;
      r.toY++;
      break;
  }
  r.speed = 0x18;
  r.state = 0;
  r.strength = strength;
  setObj(r.last, r);
  r.called = 1;
  r.self = 0;
  r.complained = 0;
}

/**
 * 0x40ac0c / 0x42a5b7: where it goes once it has served — 40 cells behind the
 * craft's pose along its line, on past blocks, as a cell (the rest of the
 * object the EXE leaves as its stack had it)
 */
function awayCell(w: World): { cellX: number; cellY: number } {
  let x = w.cam.cellX;
  let y = w.cam.cellY;
  switch (w.poseDir) {
    case 0:
      for (y += 0x28; w.solid(x, y); y++);
      break;
    case 1:
      for (y -= 0x28; w.solid(x, y); y--);
      break;
    case 2:
      for (x -= 0x28; w.solid(x, y); x--);
      break;
    case 3:
      for (x += 0x28; w.solid(x, y); x++);
      break;
  }
  return { cellX: x, cellY: y };
}

/** 0x40adc1 / 0x42a76c: the next cell along heading `a` is `blocked` */
export function blockedWay(r: DepotRec, a: number, blocked: (x: number, y: number) => boolean): boolean {
  switch (a) {
    case 0:
      return blocked(r.cellX + 1, r.cellY);
    case 0x40:
      return blocked(r.cellX, r.cellY + 1);
    case 0x80:
      return blocked(r.cellX - 1, r.cellY);
    case 0xc0:
      return blocked(r.cellX, r.cellY - 1);
  }
  throw new Error(`0x40adc1: a heading of ${a} (0x41e28a 0x6b, 0x1f)`);
}

/** 0x40ad36 / 0x42a6e1: at the edge — into the next cell, its point on the edge, and choose again */
function arrive(r: DepotRec): void {
  r.toX = r.cellX;
  r.toY = r.cellY;
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

/**
 * States 0 to 4 of 0x409e30 / 0x42982f, which the two share but for the
 * wobble (0x33 the station's, 0x2a the ship's): choose a way toward the
 * beacon's cell (or, served, away), roll to the cell's edge, turn a corner.
 * In the beacon's cell it is 5; boxed in it waits.
 */
export function driveDepot(w: World, r: DepotRec, blocked: (x: number, y: number) => boolean, wobble: number, again: () => void): void {
  switch (r.state) {
    case 0: {
      let dx: number;
      let dy: number;
      if (r.called) {
        const mark = { n: 0 };
        const b = newObj();
        w.hud.x417d4d(mark, b);
        dy = r.cellY - b.cellY;
        dx = r.cellX - b.cellX;
        if (dx === 0 && dy === 0) {
          r.state = 5;
          return;
        }
      } else {
        const to = awayCell(w);
        dx = r.cellX - to.cellX;
        dy = r.cellY - to.cellY;
      }
      const way = waysToward(w, r.angle, dx, dy);
      const open = (a: number): boolean => !blockedWay(r, a, blocked);
      if (open(way[0])) {
        r.goal = way[0];
        if (w.roll(10) <= 1) {
          if (open(way[1])) r.goal = way[1];
          else if (open(way[2])) r.goal = way[2];
        }
      } else if (open(way[1])) r.goal = way[1];
      else if (open(way[2])) r.goal = way[2];
      else return;
      r.toX = r.cellX;
      r.toY = r.cellY;
      r.goalX = (r.cellX << 8) + 0x80;
      r.goalY = (r.cellY << 8) + 0x80;
      if (r.goal === r.angle) {
        // 0x43135c: on to the cell's far edge
        switch (r.angle) {
          case 0:
            r.goalX += 0x80;
            r.state = 1;
            r.way = 1;
            r.toX++;
            break;
          case 0x40:
            r.goalY += 0x80;
            r.state = 2;
            r.way = 1;
            r.toY++;
            break;
          case 0x80:
            r.goalX -= 0x80;
            r.state = 1;
            r.way = 0;
            r.toX--;
            break;
          case 0xc0:
            r.goalY -= 0x80;
            r.state = 2;
            r.way = 0;
            r.toY--;
            break;
        }
        return again();
      }
      // 0x43137c: round the corner the turn is about
      switch (r.angle) {
        case 0:
          if (r.goal === 0xc0) {
            r.state = 3;
            r.goalX -= 0x80;
            r.goalY -= 0x80;
            r.toY--;
          }
          if (r.goal === 0x40) {
            r.state = 4;
            r.goalX -= 0x80;
            r.goalY += 0x80;
            r.toY++;
          }
          break;
        case 0x40:
          if (r.goal === 0) {
            r.state = 3;
            r.goalX += 0x80;
            r.goalY -= 0x80;
            r.toX++;
          }
          if (r.goal === 0x80) {
            r.state = 4;
            r.goalX -= 0x80;
            r.goalY -= 0x80;
            r.toX--;
          }
          break;
        case 0x80:
          if (r.goal === 0xc0) {
            r.state = 4;
            r.goalX += 0x80;
            r.goalY -= 0x80;
            r.toY--;
          }
          if (r.goal === 0x40) {
            r.state = 3;
            r.goalX += 0x80;
            r.goalY += 0x80;
            r.toY++;
          }
          break;
        case 0xc0:
          if (r.goal === 0x80) {
            r.state = 3;
            r.goalX -= 0x80;
            r.goalY += 0x80;
            r.toX--;
          }
          if (r.goal === 0) {
            r.state = 4;
            r.goalX += 0x80;
            r.goalY += 0x80;
            r.toX++;
          }
          break;
      }
      r.radius = dist(r.goalX - r.x, r.goalY - r.y, 0);
      // a quarter circle, 0x3d5b / 0x2710 ≈ π/2 of the radius, in 0x40 of heading
      r.way = Math.trunc((r.speed << 6) / Math.trunc((r.radius * 0x3d5b) / 0x2710));
      return again();
    }
    case 1:
    case 2: {
      const alongX = r.state === 1;
      const t = alongX ? r.goalY : r.goalX;
      let across = (alongX ? r.y : r.x) + w.roll(5) - 3;
      if (t - wobble > across) across = t - wobble;
      if (t + wobble < across) across = t + wobble;
      if (alongX) r.y = across;
      else r.x = across;
      const goal = alongX ? r.goalX : r.goalY;
      if (r.way) {
        if (alongX) r.x += r.speed;
        else r.y += r.speed;
        if ((alongX ? r.x : r.y) >= goal) arrive(r);
      } else {
        if (alongX) r.x -= r.speed;
        else r.y -= r.speed;
        if ((alongX ? r.x : r.y) <= goal) arrive(r);
      }
      return;
    }
    case 3:
    case 4: {
      r.angle = turnToward(r.angle, r.goal, r.way, 0x100);
      const a = (r.angle + (r.state === 3 ? 0x40 : -0x40)) & 0xff;
      r.x = cosMul(a, r.radius) + r.goalX;
      r.y = sinMul(a, r.radius) + r.goalY;
      if (r.angle === r.goal) arrive(r);
      return;
    }
  }
}

/** state 5 (0x40a822 / 0x42a221): a step toward the beacon's centre, at most the speed each way; true there */
export function approach(w: World, r: DepotRec): boolean {
  const mark = { n: 0 };
  const b = newObj();
  w.hud.x417d4d(mark, b);
  let dy = b.y - r.y;
  let dx = b.x - r.x;
  if (dx > r.speed) dx = r.speed;
  if (-r.speed > dx) dx = -r.speed;
  if (dy > r.speed) dy = r.speed;
  if (-r.speed > dy) dy = -r.speed;
  r.x += dx;
  r.y += dy;
  r.cellX = r.x >> 8;
  r.cellY = r.y >> 8;
  r.toX = r.cellX;
  r.toY = r.cellY;
  return r.x === b.x && r.y === b.y;
}

/**
 * the station's state 8 (0x40aa52), the ship's 7 (0x42a3fd): once the next
 * cell along its heading is clear, on to its cell's edge (0x43139c); true when
 * it goes
 */
export function driveOff(r: DepotRec, blocked: (x: number, y: number) => boolean): boolean {
  if (blockedWay(r, r.angle, blocked)) return false;
  r.goalX = r.x;
  r.goalY = r.y;
  switch (r.angle) {
    case 0:
      r.goalX += 0x80;
      r.state = 1;
      r.way = 1;
      r.toX++;
      break;
    case 0x40:
      r.goalY += 0x80;
      r.state = 2;
      r.way = 1;
      r.toY++;
      break;
    case 0x80:
      r.goalX -= 0x80;
      r.state = 1;
      r.way = 0;
      r.toX--;
      break;
    case 0xc0:
      r.goalY -= 0x80;
      r.state = 2;
      r.way = 0;
      r.toY--;
      break;
  }
  return true;
}

/** the craft at rest within 0x14 of it (0x40a97e, 0x42a385) */
export function craftOver(w: World, r: DepotRec): boolean {
  const c = w.cam;
  return w.speed === 0 && r.x - 0x14 <= c.x && r.x + 0x14 >= c.x && r.y - 0x14 <= c.y && r.y + 0x14 >= c.y;
}

/** 0x40b112 / 0x42aa99: waiting at the beacon (6) with the craft within 0x12c — what the enemies aim at */
export function depotWhere(w: World, r: DepotRec): Obj | null {
  if (r.self < 0 || r.state !== 6) return null;
  const c = w.cam;
  if (r.x - 0x12c > c.x || r.x + 0x12c < c.x || r.y - 0x12c > c.y || r.y + 0x12c < c.y) return null;
  return objOf(r);
}

/** 0x40afe9 / 0x42a99e: the world moved — not the frame's start point */
export function shiftDepot(r: DepotRec, dx: number, dy: number): void {
  if (r.self < 0) return;
  const cx = dx >> 8;
  const cy = dy >> 8;
  r.x += dx;
  r.y += dy;
  r.cellX += cx;
  r.cellY += cy;
  r.goalX += dx;
  r.goalY += dy;
  r.toX += cx;
  r.toY += cy;
}

/**
 * 0x409d5f / 0x4296c7's picture: 32 distances by 9 headings, the other seven
 * mirrored, from `near` on (the station 0x10, the ship 0x20); no rect kept —
 * neither can be aimed at
 */
export function drawDepot(w: World, r: DepotRec, pics: (FrameV0 | undefined)[], near: number): void {
  const p = w.project(r);
  if (p.depth < near) return;
  let d = (p.depth - near) >> 6;
  if (d >= 0x20) d = 0x1f;
  let mirror = false;
  let h = ((w.cam.angle - r.angle + 8) & 0xff) >> 4;
  if (h >= 9) {
    h = 0x10 - h;
    mirror = true;
  }
  w.sprite(pics[d + (h << 5)], p.y, p.x, p.depth, mirror);
}

/** who the fuel man is on the comms (0x4142b9's 1) */
const FUELMAN = 1;

export class Fuel implements FuelApi {
  /** 0x436150: FUEL's pictures (0x4099b8, read once at startup) */
  private readonly pics: (FrameV0 | undefined)[];
  /** 0x4360dc */
  private readonly r = newDepot();

  constructor(
    readonly w: World,
    pictures: Uint8Array,
  ) {
    this.pics = readPictures(pictures);
  }

  /** 0x4099ec: gone (a flight's start, and when the pods come down, 0x40b5c3) */
  reset(): void {
    this.r.self = -1;
  }

  /** 0x40b085: a block, a jeep's cell or a tank's */
  private readonly blocked = (x: number, y: number): boolean => {
    const w = this.w;
    return w.solid(x, y) || w.jeep.occupied(x, y, -1) || w.tank.occupied(x, y, -1);
  };

  /** 0x4099f7 */
  callIn(): void {
    callDepot(this.w, this.r, this.blocked, 1, this.w.params.x43cfc2);
    this.w.comms.ask(FUELMAN, 4);
  }

  /** 0x409d5f: gone once nine cells off when it is not the beacon's; else it moves, and is drawn */
  frame(): void {
    const w = this.w;
    const r = this.r;
    if (r.self < 0) return;
    if (tooFar(w, r) && !r.called) {
      r.self = -1;
      return;
    }
    setObj(r.last, r);
    this.think();
    drawDepot(w, r, this.pics, 0x10);
  }

  /** 0x409e30 */
  private think(): void {
    const w = this.w;
    const r = this.r;
    switch (r.state) {
      case 0:
      case 1:
      case 2:
      case 3:
      case 4:
        return driveDepot(w, r, this.blocked, 0x33, () => this.think());
      case 5:
        if (!approach(w, r)) return;
        r.state = 6;
        w.sound(0x14);
        w.comms.ask(FUELMAN, w.pyro.x41d396(r) ? 5 : 8);
        r.wait = 0x1f4;
        return;
      case 6:
        if (--r.wait <= 0) {
          w.comms.ask(FUELMAN, 7);
          return this.served();
        }
        if (w.cam.z <= 0x5a && w.cam.angle === r.angle && craftOver(w, r)) r.state = 7;
        return;
      case 7:
        // 0x40a9dd: a point a fill, while it stays down facing its way and is not full
        if (w.hud.score() > 0) {
          w.hud.addScore(-1);
          w.hud.addFuel(0x56);
          if (w.cam.z <= 0x5a && w.cam.angle === r.angle && w.speed === 0 && w.hud.fuel() < 0x4380 && w.state > 0) return;
        }
        return this.served();
      case 8:
        if (driveOff(r, this.blocked)) w.sound(0x13);
        return;
      case 9: {
        // 0x40ab3b: burning
        if (w.roll(3) === 1) {
          const dx = r.x - r.last.x;
          const dy = r.y - r.last.y;
          const dz = r.z - r.last.z;
          const at = objOf(r);
          at.x += w.roll(0x30) + 0x10;
          at.y += w.roll(0x30);
          at.z += w.roll(0x30);
          w.pyro.burst(at, dx, dy, dz);
        }
        r.burn--;
        if (w.comms.talking() === FUELMAN) w.comms.x414bce();
        if (r.burn <= 0) r.self = -1;
        w.pyro.hitsCraft(r, r, 0xd8, 0x64);
        return;
      }
    }
  }

  /** 0x40aa34: the beacon off, no longer the beacon's, and away (8) */
  private served(): void {
    this.w.hud.x417d33();
    this.r.called = 0;
    this.r.state = 8;
  }

  /** 0x40ae4a (0x41b70b's list, and 0x41b7a9's while it is waiting): within `r` + 0x28, not burning */
  hit(a: Obj, b: Obj, dmg: number, reach: number): boolean {
    const w = this.w;
    const r = this.r;
    if (r.self < 0 || r.state === 9) return false;
    if (!withinReach(r, a, b, reach + 0x28)) return false;
    r.strength -= dmg;
    if (!r.complained) {
      w.comms.ask(FUELMAN, 6);
      r.complained = 1;
    }
    if (r.strength > 0) return true;
    w.hud.addScore(-0x64);
    if (w.comms.talking() === FUELMAN) w.comms.x414bce();
    if (r.called) {
      w.hud.x417d33();
      r.burn = w.roll(0x14) + 0x20;
      r.state = 9;
      return true;
    }
    const at = objOf(r);
    at.z += 6;
    w.pyro.burst(at, r.x - r.last.x, r.y - r.last.y, r.z - r.last.z);
    r.self = -1;
    return true;
  }

  /** 0x40afe9 */
  shift(dx: number, dy: number): void {
    shiftDepot(this.r, dx, dy);
  }

  /** 0x40b03f */
  count(): number {
    return this.r.self < 0 ? 0 : 1;
  }

  /** 0x40b04c */
  nth(k: number): { obj: Obj; kind: number; flag: number; dying: number } {
    if (k >= 1 || this.r.self < 0) throw new Error("0x40b04c: no such fuel station (0x41e28a 0x6b, 0x20)");
    return { obj: objOf(this.r), kind: KIND.fuel, flag: 0, dying: 0 };
  }

  /** 0x40b0d5 */
  occupied(x: number, y: number): boolean {
    const r = this.r;
    if (r.self < 0) return false;
    return (r.cellX === x && r.cellY === y) || (r.toX === x && r.toY === y);
  }

  /** 0x40b112 */
  where(): Obj | null {
    return depotWhere(this.w, this.r);
  }
}

