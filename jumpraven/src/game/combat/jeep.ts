/**
 * The jeeps — RAVEN.EXE 0x40c738 … 0x40e04c: up to three (`[0x43cf72]` by the
 * difficulty) of the EXE's 0x84-byte records at 0x436aa8, each driving the
 * streets from one cell's edge to the next and firing along its street when
 * the craft is down it, and their shots, 16 of 0x34 bytes at 0x436c34.
 *
 * ## Where one comes from (0x40c807)
 *
 * Seven cells ahead of the craft's pose, across its way: the cell beside the
 * pose's line one side or the other (a roll of 2), and on outward along the
 * row while that cell is a block, another jeep's, a tank's or the fuel
 * station's; it faces back across toward the line, starts half a cell behind
 * its cell's centre, up to 0x40 off to the side, and one time in eight, while
 * fewer than two pieces of wreckage are up and the flight is on, it carries a
 * pod to drop. It comes 400 … 800 frames into the flight, and when it is gone
 * (killed, or nine cells from the craft: 0x427afd) after 200 frames the first
 * time, 40 fewer each time after (0x40c7dd).
 *
 * ## How one moves (0x40cded)
 *
 *   0  choose: of the three ways it can take without turning back (0x431558's
 *      cases), the one toward the craft first, else the next; one time in ten
 *      the second or third even when the first is open. Within a cell of the
 *      craft and with it down the line it stops (5); boxed in, it fires if it
 *      can and waits.
 *   1, 2  roll along x or y at its speed to the next cell's edge, wobbling up
 *      to 0x40 across the street, firing while the craft is down the line
 *   3, 4  turn a corner, round a quarter circle about the cell's corner
 *   5  stand and fire while the craft is within two cells and down the line
 *
 * Reaching the edge it is in the next cell (0x40d782) and chooses again.
 *
 * ## Its shots (0x40d89a, 0x40d9c3)
 *
 * Every `[0x43cf6e]` frames while it fires: from 0x26 up and 0xc to the side,
 * the sides by turns, 0x3c a step at the weapons ship, the fuel station or the
 * craft (0x4276cb), for 0x14 frames; into a block or the ground it is gone,
 * into ours 0x15 strong (0x41b7a9).
 *
 * Its pictures (JEEP, 0x120 of them) are 32 distances by 9 headings, picture
 * d + 32·h at (depth − 0x10) / 0x40 and the heading toward the eye h in
 * sixteenths, the other seven mirrored (0x40cc90).
 */
import type { FrameV0 } from "@dreamfactory/engine/df/image-v0";
import type { JeepApi } from "./api";
import { countUp, drawPyro, findAt, nthUp, objOf, occupiedBy, pickNearest, shiftFleet, shiftTo, standFire, type Unit } from "./fleet";
import { aimAt, downTheLine, meets, tooFar, waysToward, type EnemyShot } from "./lib";
import { chooseWay, rollAlong, setOff, turnRound } from "./street";
import { KIND, abs, copyObj, cosMul, newObj, readPictures, setObj, sinMul, type Obj, type Pt, type World } from "./world";
import type { Rect } from "@dreamfactory/engine/v0/screen";

/** a jeep, the EXE's 0x84 bytes at 0x436aa8 (its object the first 0x18) */
interface JeepRec extends Obj {
  /** +0x18 where it was at the frame's start */
  last: Obj;
  /** +0x30 the state (0x431540) */
  state: number;
  /** +0x34 the heading it is turning to */
  goal: number;
  /** +0x38, +0x3c the point it is going to: the cell's edge, or in a turn the corner it turns about */
  goalX: number;
  goalY: number;
  /** +0x40 rolling: 1 up x or y, 0 down; turning: the step a frame */
  way: number;
  /** +0x44 its speed (`[0x43cf6a]`) */
  speed: number;
  /** +0x48 a turn's radius */
  radius: number;
  /** +0x4c its strength (`[0x43cfb2]`) */
  strength: number;
  /** +0x50 frames to its next shot */
  reload: number;
  /** +0x54 its picture's rect last frame, at least 0x14 square; +0x5c its depth; +0x60 it was drawn (for the aim) */
  rect: Rect;
  depth: number;
  shown: number;
  /** +0x64 its shots fired (the side they come from) */
  fired: number;
  /** +0x68 it drops a pod when it is killed */
  pod: number;
  /** +0x6c its slot while it is up, −1 while it is not */
  self: number;
  /** +0x70, +0x74 the cell it is going to */
  toX: number;
  toY: number;
  /** +0x78 its slot; +0x7c frames till it comes; +0x80 the wait the next time it goes */
  slot: number;
  wait: number;
  nextWait: number;
}

/** an enemy's shot, the EXE's 0x34 bytes (the jeeps' at 0x436c34, the tanks' at 0x43a800) */
export interface VehicleShot extends EnemyShot {
  /** +0x00 */
  on: number;
  /** +0x04 0 a bullet; the tank's 1 a shell, 2 a homing shell */
  kind: number;
  /** +0x08 what it met: 0 nothing, 1 a block or the ground, 2 ours; a tank's shell's frames since */
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

export const newShots = (): VehicleShot[] =>
  Array.from({ length: 0x10 }, () => ({ on: 0, kind: 0, met: 0, life: 0, vx: 0, vy: 0, vz: 0, o: newObj() }));

/**
 * 0x40c807 / 0x42498e: the cell and heading a vehicle comes in at, seven cells
 * ahead of the pose and out along the row from beside its line to the first
 * cell not `blocked`
 */
export function comeIn(w: World, blocked: (x: number, y: number) => boolean): { angle: number; cellX: number; cellY: number } {
  let angle: number;
  let x: number;
  let y: number;
  switch (w.poseDir) {
    case 0:
    case 1:
      y = w.poseY + (w.poseDir === 0 ? -7 : 7);
      if (w.roll(2) === 1) {
        angle = 0x80;
        for (x = w.poseX + 1; blocked(x, y); x++);
      } else {
        angle = 0;
        for (x = w.poseX - 1; blocked(x, y); x--);
      }
      break;
    case 2:
    case 3:
      x = w.poseX + (w.poseDir === 2 ? 7 : -7);
      if (w.roll(2) === 1) {
        angle = 0xc0;
        for (y = w.poseY + 1; blocked(x, y); y++);
      } else {
        angle = 0x40;
        for (y = w.poseY - 1; blocked(x, y); y--);
      }
      break;
    default:
      throw new Error(`0x40c807: a pose facing ${w.poseDir}`);
  }
  return { angle, cellX: x, cellY: y };
}

/**
 * 0x40cc90 / 0x424d78's picture: a vehicle's picture into the draw list; its
 * rect (widened to at least 0x14 each way) and depth when it can be aimed at —
 * drawn, and 0x140 or more away
 */
export function drawVehicle(w: World, o: Obj, pics: (FrameV0 | undefined)[]): { rect: Rect; depth: number } | null {
  const p = w.project(o);
  let depth = p.depth;
  if (depth < 0x10) return null;
  let d = (depth - 0x10) >> 6;
  if (d >= 0x20) d = 0x1f;
  let mirror = false;
  let h = ((w.cam.angle - o.angle + 8) & 0xff) >> 4;
  if (h >= 9) {
    h = 0x10 - h;
    mirror = true;
  }
  if (depth < 0x80) depth = 0x80;
  const r = w.sprite(pics[d + (h << 5)], p.y, p.x, depth, mirror);
  if (depth < 0x140 || !r) return null;
  let [top, left, bottom, right] = r;
  const wide = right - left;
  if (wide < 0x14) {
    left += (wide >> 1) - 0xa;
    right = left + 0x14;
  }
  const high = bottom - top;
  if (high < 0x14) {
    top += (high >> 1) - 0xa;
    bottom = top + 0x14;
  }
  return { rect: [top, left, bottom, right], depth };
}

/** 0x40db7a / 0x425c34 (pyro's 0xe0 … by distance), 0x40dac4 / 0x425a93 (0x108 … into ours, 0xe0 … into a block, 8 … flying): a shot's picture by `base` */
export function drawShot(w: World, s: VehicleShot, base: number): void {
  drawPyro(w, s.o, base);
}

/** 0x40d9c3 / 0x425771's bullets: a step, into a block or the ground, into ours (0x15 strong), drawn; gone if it met anything */
export function moveBullet(w: World, s: VehicleShot): void {
  const last = copyObj(s.o);
  s.o.x += s.vx;
  s.o.y += s.vy;
  s.o.z += s.vz;
  s.o.cellX = s.o.x >> 8;
  s.o.cellY = s.o.y >> 8;
  if (meets(w, last, s.o)) {
    s.met = 1;
    w.sound(w.roll(4) === 1 ? 0xf : 0xd);
  }
  if (w.pyro.hitsOurs(last, s.o, 0x15, 0)) {
    s.met = 2;
    w.sound(7);
  }
  let base = 8;
  if (s.met === 2) base = 0x108;
  else if (s.met) base = 0xe0;
  drawShot(w, s, base);
  if (s.met) s.on = 0;
}

/**
 * 0x40dc1f / 0x425cd9's test: the shot from `a` to `b` is within `reach` of
 * `o` on every axis (on each, not both ends beyond it the same way)
 */
export function withinReach(o: Obj, a: Obj, b: Obj, reach: number): boolean {
  if (o.z - reach > a.z && o.z - reach > b.z) return false;
  if (o.z + reach < a.z && o.z + reach < b.z) return false;
  if (o.x - reach > a.x && o.x - reach > b.x) return false;
  if (o.x + reach < a.x && o.x + reach < b.x) return false;
  if (o.y - reach > a.y && o.y - reach > b.y) return false;
  if (o.y + reach < a.y && o.y + reach < b.y) return false;
  return true;
}

/** what the jeep's record and the tank's share, each at its own offsets */
export interface Roller extends Unit {
  /** where it was at the frame's start */
  last: Obj;
  state: number;
  speed: number;
  strength: number;
  /** frames to its next shot */
  reload: number;
  /** the cell it is going to */
  toX: number;
  toY: number;
  /** its slot; frames till it comes */
  slot: number;
  wait: number;
}

/**
 * 0x40c807 / 0x42498e's start: up in its slot, at the cell and heading
 * {@link comeIn} finds clear of what `blocked` says (its own slot aside), at
 * the cell's centre 1 up, going to that cell
 */
export function comeInAt(w: World, r: Roller, blocked: (x: number, y: number, self: number) => boolean): void {
  r.self = r.slot;
  const c = comeIn(w, (x, y) => blocked(x, y, r.self));
  r.angle = c.angle;
  r.cellX = c.cellX;
  r.cellY = c.cellY;
  r.x = (r.cellX << 8) + 0x80;
  r.y = (r.cellY << 8) + 0x80;
  r.z = 1;
  r.toX = c.cellX;
  r.toY = c.cellY;
}

/**
 * 0x40c807 / 0x42498e's end: choosing, not drawn, loaded, `strength` strong,
 * where it is its frame's start, and one time in eight, while fewer than two
 * pieces of wreckage are up and the flight is on, a pod to drop
 */
export function setOut(w: World, r: Roller, strength: number): void {
  r.state = 0;
  r.shown = 0;
  r.reload = 0;
  r.strength = strength;
  setObj(r.last, r);
  r.pod = 0;
  if (w.pyro.wreckage() < 2 && w.roll(8) === 1 && w.state < 2) r.pod = 1;
}

/**
 * 0x40cc90 / 0x424d78: one's frame — down, it counts its wait to `comeIn`;
 * nine cells from the craft it is `gone`; else it moves (`think`) from where
 * it was and is drawn, and while it can be aimed at its rect and depth are kept
 */
export function rollOne<R extends Roller>(w: World, r: R, pics: (FrameV0 | undefined)[], comeIn: (r: R) => void, gone: (r: R) => void, think: (r: R) => void): void {
  r.shown = 0;
  if (r.self < 0) {
    if (--r.wait <= 0) comeIn(r);
    return;
  }
  if (tooFar(w, r)) return gone(r);
  setObj(r.last, r);
  think(r);
  const d = drawVehicle(w, r, pics);
  if (!d) return;
  r.rect = d.rect;
  r.depth = d.depth;
  r.shown = 1;
}

export class Jeep implements JeepApi {
  /** 0x436628: JEEP's pictures (0x40c738) */
  private readonly pics: (FrameV0 | undefined)[];
  /** 0x436aa8 */
  private readonly recs: JeepRec[] = [];
  /** 0x436c34 */
  private readonly shots = newShots();

  constructor(
    readonly w: World,
    pictures: Uint8Array,
  ) {
    this.pics = readPictures(pictures);
  }

  /** `[0x43cf72]` */
  private get n(): number {
    return this.w.params.x43cf72;
  }

  /** 0x40c779: every jeep to come in 400 … 800 frames, the first wait after 200; the shots off (0x40d87f) */
  reset(): void {
    const w = this.w;
    if (this.n > 3) throw new Error("0x40c779: more than three jeeps (0x41e28a 0x6b, 0x22)");
    this.recs.length = 0;
    for (let i = 0; i < this.n; i++) {
      const r: JeepRec = {
        ...newObj(), last: newObj(), state: 0, goal: 0, goalX: 0, goalY: 0, way: 0, speed: 0, radius: 0, strength: 0,
        reload: 0, rect: [0, 0, 0, 0], depth: 0, shown: 0, fired: 0, pod: 0, self: -1, toX: 0, toY: 0, slot: i, wait: 0, nextWait: 0,
      };
      r.wait = w.roll(0x190) + 0x190;
      r.nextWait = 0xc8;
      this.recs.push(r);
    }
    for (const s of this.shots) s.on = 0;
  }

  /** 0x40c7dd: gone — back in `+0x80` frames, the next time 40 fewer; no missile homes on it */
  private gone(r: JeepRec): void {
    r.self = -1;
    r.wait = r.nextWait;
    r.nextWait -= 0x28;
    this.w.pyro.forget(r);
  }

  /** 0x40c807 */
  private comeIn(r: JeepRec): void {
    const w = this.w;
    comeInAt(w, r, (x, y, self) => this.blocked(x, y, self));
    switch (r.angle) {
      case 0:
        r.x -= 0x80;
        r.toX--;
        r.y += w.roll(0x81) - 0x41;
        break;
      case 0x40:
        r.y -= 0x80;
        r.toY--;
        r.x += w.roll(0x81) - 0x41;
        break;
      case 0x80:
        r.x += 0x80;
        r.toX++;
        r.y += w.roll(0x81) - 0x41;
        break;
      case 0xc0:
        r.y += 0x80;
        r.toY++;
        r.x += w.roll(0x81) - 0x41;
        break;
    }
    r.speed = w.params.x43cf6a;
    setOut(w, r, w.params.x43cfb2);
  }

  /** 0x40cc5e: every jeep, then the shots (0x40d9c3) */
  frame(): void {
    for (const r of this.recs) this.one(r);
    this.moveShots();
  }

  /** 0x40cc90 */
  private one(r: JeepRec): void {
    rollOne(this.w, r, this.pics, (r) => this.comeIn(r), (r) => this.gone(r), (r) => this.think(r));
  }

  /** 0x40cded */
  private think(r: JeepRec): void {
    const w = this.w;
    switch (r.state) {
      case 0: {
        const dx = r.cellX - w.cam.cellX;
        const dy = r.cellY - w.cam.cellY;
        if (downTheLine(w, r) && abs(dx) <= 1 && abs(dy) <= 1) {
          r.state = 5;
          return;
        }
        if (!chooseWay(w, r, waysToward(w, r.angle, dx, dy), (a) => !this.blockedWay(r, a))) {
          if (downTheLine(w, r)) this.fire(r);
          return;
        }
        setOff(r);
        return this.think(r);
      }
      case 1:
      case 2:
        rollAlong(w, r, 0x40);
        if (downTheLine(w, r)) this.fire(r);
        return;
      case 3:
      case 4:
        return turnRound(r);
      case 5:
        return standFire(w, r, (r) => this.fire(r));
    }
  }

  /** 0x40d7f5: the next cell along heading `a` is blocked */
  private blockedWay(r: JeepRec, a: number): boolean {
    switch (a) {
      case 0:
        return this.blocked(r.cellX + 1, r.cellY, r.self);
      case 0x40:
        return this.blocked(r.cellX, r.cellY + 1, r.self);
      case 0x80:
        return this.blocked(r.cellX - 1, r.cellY, r.self);
      case 0xc0:
        return this.blocked(r.cellX, r.cellY - 1, r.self);
    }
    throw new Error(`0x40d7f5: a heading of ${a} (0x41e28a 0x6b, 0x23)`);
  }

  /** 0x40df8f: a block, another jeep's cell, a tank's or the fuel station's */
  private blocked(x: number, y: number, self: number): boolean {
    const w = this.w;
    return w.solid(x, y) || this.occupied(x, y, self) || w.tank.occupied(x, y, -1) || w.fuel.occupied(x, y);
  }

  /** 0x40dfe6 */
  occupied(x: number, y: number, self: number): boolean {
    return occupiedBy(this.recs, x, y, self);
  }

  /** 0x40d89a: a shot, if one is due and a slot is free */
  private fire(r: JeepRec): void {
    const w = this.w;
    if (--r.reload > 0) return;
    r.reload = w.params.x43cf6e;
    const s = this.shots.find((s) => !s.on);
    if (!s) return;
    s.on = 1;
    s.kind = 0;
    s.met = 0;
    s.life = 0x14;
    s.o.x = cosMul(r.angle, 1) + r.x;
    s.o.y = sinMul(r.angle, 1) + r.y;
    s.o.z = r.z + 0x26;
    r.fired++;
    const side = (r.fired & 1 ? r.angle + 0x40 : r.angle - 0x40) & 0xff;
    s.o.x += cosMul(side, 0xc);
    s.o.y += sinMul(side, 0xc);
    drawShot(w, s, 0xe0);
    aimAt(w, s, 0x3c);
    s.o.x -= s.vx;
    s.o.y -= s.vy;
    s.o.z -= s.vz;
    s.o.cellX = s.o.x >> 8;
    s.o.cellY = s.o.y >> 8;
    w.sound(4);
  }

  /** 0x40d9c3 */
  private moveShots(): void {
    for (const s of this.shots) {
      if (!s.on) continue;
      if (--s.life < 0) {
        s.on = 0;
        continue;
      }
      moveBullet(this.w, s);
    }
  }

  /** 0x40dbcf: the first jeep the shot meets (0x40dc1f) */
  hit(a: Obj, b: Obj, dmg: number, r: number): boolean {
    for (const j of this.recs) if (this.hitOne(j, a, b, dmg, r)) return true;
    return false;
  }

  /** 0x40dc1f: within `r` + 0x1e; killed, 0x19 points, the tally, a fireball moving as it moved, its pod */
  private hitOne(j: JeepRec, a: Obj, b: Obj, dmg: number, r: number): boolean {
    const w = this.w;
    if (j.self < 0) return false;
    if (!withinReach(j, a, b, r + 0x1e)) return false;
    j.strength -= dmg;
    if (j.strength > 0) return true;
    w.hud.addScore(0x19);
    w.r.tally.kills.jeep++;
    const dx = j.x - j.last.x;
    const dy = j.y - j.last.y;
    const dz = j.z - j.last.z;
    const at = objOf(j);
    at.z += 4;
    w.pyro.burst(at, dx, dy, dz);
    if (j.pod) w.pyro.drop(at, dx, dy, dz);
    this.gone(j);
    return true;
  }

  /** 0x40dd68 */
  shift(dx: number, dy: number): void {
    shiftFleet(this.recs, this.shots, dx, dy, shiftTo);
  }

  /** 0x40de04 */
  count(): number {
    return countUp(this.recs);
  }

  /** 0x40de30 */
  nth(k: number): { obj: Obj; kind: number; flag: number; dying: number } {
    return nthUp(this.recs, k, KIND.jeep, () => false, "0x40de30: no such jeep (0x41e28a 0x6b, 0x24)");
  }

  /** 0x40dea3 */
  pick(pt: Pt): Obj | null {
    return pickNearest(this.recs, pt);
  }

  /** 0x40df1c */
  find(o: Obj): Obj {
    return findAt(this.recs, o, "0x40df1c: no jeep there (0x41e28a 0x6b, 0x25)");
  }
}
