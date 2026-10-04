/**
 * The player's weapons (LUNICUS.EXE 0x4118d4 … 0x413dcd): the gun in the hand,
 * the shots, and what they hit.
 *
 * A click in a weapon's mode fires toward it: the heading turns a ninth of a
 * pixel off the middle, the rise from how high it is (0x411f7e). Sixteen
 * shots may be in the air, each a slot of the EXE's 0x50 bytes:
 *
 *   bullets   (days 1–3) 60 a step, two steps a frame, 16 frames, gone at a
 *             wall; 12 of the ammo each (6 on day 3)
 *   pulse gun (days 4–6) the same, but bounces off walls; 20 of the ammo (10)
 *   grenades  40 a step and falling a little faster each frame; burst on
 *             whatever they touch; 160 of the ammo (80 on day 6)
 *   rockets   30 a step, level after the eighth; they look ahead, and round the
 *             next corner, for something to fly at; 640 of the ammo
 *
 * A shot hits whatever of the tank, the jeep, the wasp (or the node) and the
 * drones its point is inside (0x413d71).
 */
import type { FrameV0 } from "@dreamfactory/engine/df/image-v0";
import { CELL } from "../data";
import { World, along, shotWall, type Obj } from "./world";

export interface Target {
  /** a shot at this point for `dmg`: 0 missed, 1 a hit, 2 a hit where it counts double */
  hit(s: Obj, dmg: number): number;
  /** where it is, for a rocket looking for it (the tank, the jeep, the wasp — 0x413d03); null when it is not there */
  at(): Obj | null;
}

interface Shot {
  on: boolean;
  /** the button it was fired from: 3 bullets, 4 grenades, 5 rockets */
  kind: number;
  /** a rocket: the heading it left on, the corner to turn at, which way, how long, whether it has a target */
  heading: number;
  cornerX: number;
  cornerY: number;
  turnLeft: boolean;
  steer: number;
  locked: boolean;
  /** a grenade's frames in the air */
  falling: number;
  /** what it hit last frame, drawn once more before it goes */
  done: number;
  /** bullets: frames left; rockets: frames flown */
  life: number;
  v: [number, number, number];
  o: Obj;
}

const newShot = (): Shot => ({
  on: false, kind: 0, heading: 0, cornerX: -1, cornerY: -1, turnLeft: false, steer: 0, locked: false, falling: 0, done: 0, life: 0,
  v: [0, 0, 0], o: { angle: 0, x: 0, y: 0, z: 0, cellX: 0, cellY: 0 },
});

export class Weapons {
  shots: Shot[] = Array.from({ length: 16 }, newShot);
  /** `[0x42bcac]` shots fired, for the odd ones' head start */
  fired = 0;
  /** `[0x42bcbc]` the hand's picture (27: three rises × nine headings), `[0x42bcc0]` a recoil, `[0x42bcb0]` its step */
  pose = 4;
  recoil = 0;
  recoilStep = 0;
  /** `[0x42bcc8]` the hand jolted by a hit */
  jolt = 0;
  /** `[0x42bcb4]` a shot is in the air */
  out = false;

  constructor(
    readonly w: World,
    /** `shared/hand.` indoors, `shared/play.` in the open: 27 pictures of the gun in the hand */
    readonly hand: FrameV0[],
    readonly targets: Target[],
  ) {}

  private get pyro(): FrameV0[] {
    return this.w.pyro;
  }

  /** 0x411f7e: fire the pressed weapon at a point of the view */
  fire(y: number, x: number): void {
    const w = this.w;
    if (w.ammo() <= 0) return;
    const s = this.shots.find((t) => !t.on);
    if (!s) return;
    const kind = w.g.mode;
    let heading = (Math.trunc((x - 0xc0) / 9) + w.cam.angle) & 0xff;
    if (y > 0xf0) y = 0xf0;
    Object.assign(s, newShot(), { on: true, kind });
    const move = (): void => {
      s.o.x += s.v[0];
      s.o.y += s.v[1];
      s.o.z += s.v[2];
    };
    if (kind === 3) {
      w.ammoBy(rocketCost(w.day));
      s.life = 0x10;
      s.o = { angle: 0, x: w.cam.x, y: w.cam.y, z: w.cam.z + 10, cellX: 0, cellY: 0 };
      const [vx, vy] = along(heading, 0x3c);
      s.v = [vx, vy, Math.trunc((0xdc - y) / 9)];
      move();
      if (this.fired & 1) move();
      World.cellOf(s.o);
      w.sound(w.day >= 4 ? 2 : 0);
      this.fired++;
      this.recoil = 1;
    } else if (kind === 5) {
      w.ammoBy(-0x280);
      y = 0x78;
      x = Math.min(0xfc, Math.max(0x84, x));
      heading = (Math.trunc((x - 0xc0) / 9) + w.cam.angle) & 0xff;
      s.steer = 0;
      s.life = -1;
      s.cornerX = s.cornerY = -1;
      s.heading = w.cam.angle;
      s.o = { angle: heading, x: w.cam.x, y: w.cam.y, z: w.cam.z + (w.building ? -4 : -0x12), cellX: 0, cellY: 0 };
      const [vx, vy] = along(heading, 0x1e);
      s.v = [vx, vy, 8];
      const [ox, oy] = along(heading, 0x3c);
      s.o.x += ox;
      s.o.y += oy;
      World.cellOf(s.o);
      w.sound(3);
      this.recoilStep = 0;
      this.recoil = 2;
    } else if (kind === 4) {
      w.ammoBy(w.day === 6 ? -0x50 : -0xa0);
      s.falling = 0;
      s.o = { angle: 0, x: w.cam.x, y: w.cam.y, z: w.cam.z + 10, cellX: 0, cellY: 0 };
      const [vx, vy] = along(heading, 0x28);
      s.v = [vx, vy, Math.trunc((0xdc - y) / 9)];
      const [ox, oy] = along(heading, 0x3c);
      s.o.x += ox;
      s.o.y += oy;
      s.o.z += s.v[2];
      World.cellOf(s.o);
      w.sound(0);
      this.recoilStep = 0;
      this.recoil = 3;
    }
    const col = Math.min(8, Math.trunc(x / 0x2a));
    const row = Math.min(2, Math.trunc(y / 0x42));
    this.pose = (2 - row) * 9 + (8 - col);
  }

  /** 0x413d71: what the shot is inside */
  private strike(o: Obj, dmg: number): number {
    for (const t of this.targets) {
      const r = t.hit(o, dmg);
      if (r) return r;
    }
    return 0;
  }

  /** one frame of every shot (0x412528) */
  frame(): void {
    this.out = false;
    for (const s of this.shots) {
      if (!s.on) continue;
      this.out = true;
      if (s.kind === 3) this.w.day >= 4 ? this.pulse(s) : this.bullet(s);
      else if (s.kind === 4) this.grenade(s);
      else if (s.kind === 5) this.rocket(s);
    }
  }

  private step(s: Shot, sign = 1): void {
    s.o.x += sign * s.v[0];
    s.o.y += sign * s.v[1];
    s.o.z += sign * s.v[2];
    World.cellOf(s.o);
  }

  /** days 1–3 (0x412967) */
  private bullet(s: Shot): void {
    const w = this.w;
    const dmg = w.day === 3 ? w.params.bullet >> 1 : w.params.bullet;
    if (s.done) {
      w.shotPicture(s.o, s.done);
      s.on = false;
      return;
    }
    if (--s.life < 0) {
      s.on = false;
      return;
    }
    for (let k = 0; k < 2; k++) {
      this.step(s);
      if (shotWall(w, s.o)) {
        this.step(s, -1);
        w.shotPicture(s.o, 1);
        s.done = 3;
        return;
      }
      const hit = this.strike(s.o, dmg);
      if (hit) {
        w.shotPicture(s.o, hit);
        s.done = hit + 2;
        return;
      }
    }
    w.shotPicture(s.o, 0);
  }

  /** days 4–6: the pulse gun, which bounces (0x412585) */
  private pulse(s: Shot): void {
    const w = this.w;
    const dmg = w.day === 6 ? w.params.pulse >> 1 : w.params.pulse;
    if (s.done) {
      w.shotPicture(s.o, s.done, true);
      s.on = false;
      return;
    }
    if (--s.life < 0) {
      s.on = false;
      return;
    }
    for (let k = 0; k < 2; k++) {
      this.step(s);
      const wall = shotWall(w, s.o);
      if (wall === 2) {
        s.o.z -= s.v[2];
        s.v[2] = -s.v[2];
        s.o.z += s.v[2];
      }
      if (wall === 1) {
        const movedX = s.o.cellX;
        this.step(s, -1);
        if (s.o.cellX === movedX) {
          if (!s.v[0]) return void (w.shotPicture(s.o, 1, true), (s.done = 3));
          s.v[1] = -s.v[1];
        } else {
          if (!s.v[1]) return void (w.shotPicture(s.o, 1, true), (s.done = 3));
          s.v[0] = -s.v[0];
        }
        this.step(s);
      }
      const hit = this.strike(s.o, dmg);
      if (hit) {
        w.shotPicture(s.o, hit, true);
        s.done = hit + 2;
        return;
      }
    }
    w.shotPicture(s.o, 0, true);
  }

  /** 0x412bdb */
  private grenade(s: Shot): void {
    const w = this.w;
    const dmg = w.day === 6 ? w.params.grenade >> 1 : w.params.grenade;
    if (s.done) return void (this.grenadePicture(s.o, 2), (s.on = false));
    s.v[2] -= s.falling >> 3;
    s.falling++;
    for (let k = 0; k < 2; k++) {
      this.step(s);
      if (shotWall(w, s.o)) {
        this.step(s, -1);
        this.grenadePicture(s.o, 1);
        w.sound(4);
        s.done = 1;
        return;
      }
      if (this.strike(s.o, dmg)) {
        this.grenadePicture(s.o, 1);
        s.done = 1;
        return;
      }
    }
    this.grenadePicture(s.o, 0);
  }

  /** 0x412e5f */
  private rocket(s: Shot): void {
    const w = this.w;
    const dmg = w.params.rocket;
    if (s.done) return void (this.rocketPicture(s.o, -2), (s.on = false));
    s.life++;
    const burst = (): void => {
      this.rocketPicture(s.o, -1);
      s.done = 1;
    };
    if (s.life < 8) {
      this.step(s);
      if (shotWall(w, s.o)) {
        this.step(s, -1);
        burst();
        w.sound(4);
        if (s.locked) w.say(6);
        return;
      }
      if (this.strike(s.o, dmg)) return burst();
    } else {
      if (s.steer > 0) {
        s.o.angle = (s.o.angle + (s.turnLeft ? -8 : 8)) & 0xff;
        [s.v[0], s.v[1]] = along(s.o.angle, 0x1e);
        if (--s.steer <= 0) {
          const t = this.lookDown(s.o.angle, s.o.cellX, s.o.cellY);
          if (t) this.flyAt(s, t);
          s.steer = -1;
        }
      }
      if (s.life === 8) {
        s.v[2] = 0;
        this.seek(s);
      }
      for (let k = 0; k < 2; k++) {
        this.step(s);
        if (shotWall(w, s.o)) {
          this.step(s, -1);
          burst();
          w.sound(4);
          if (s.locked) w.say(6);
          return;
        }
        if (this.strike(s.o, dmg)) return burst();
      }
      if (s.steer === 0 && s.o.cellX === s.cornerX && s.o.cellY === s.cornerY) s.steer = 8;
    }
    this.rocketPicture(s.o, s.life);
  }

  /** 0x413bb4: the first thing a rocket could fly at, up to eight open cells along a heading */
  private lookDown(angle: number, x: number, y: number): Obj | null {
    const [dx, dy] = LOOK.get(angle) ?? [0, 0];
    if (!dx && !dy) throw new Error(`a rocket looking along ${angle}`);
    for (let k = 1; k <= 8; k++) {
      const cx = x + dx * k;
      const cy = y + dy * k;
      if (this.w.blocked(cx, cy)) return null;
      for (const t of this.targets) {
        const o = t.at();
        if (o?.cellX === cx && o.cellY === cy) return { ...o };
      }
    }
    return null;
  }

  /** 0x413b48: a heading at a point, 30 a step */
  private flyAt(s: Shot, t: Obj): void {
    const dx = t.x - s.o.x;
    const dy = t.y - s.o.y;
    const dz = t.z - s.o.z;
    const n = Math.trunc(Math.trunc(Math.sqrt(dx * dx + dy * dy + dz * dz)) / 0x1e) + 1;
    s.v = [Math.trunc(dx / n), Math.trunc(dy / n), Math.trunc(dz / n)];
  }

  /**
   * 0x41380c: the rocket, level now, looks straight on for something to fly at
   * — ENEMY TARGET AQUIRED — and if nothing, down the side ways of every cell
   * on until a wall: it aims past the corner and turns at it.
   */
  private seek(s: Shot): void {
    const w = this.w;
    const direct = this.lookDown(s.heading, s.o.cellX, s.o.cellY);
    if (direct) {
      this.flyAt(s, direct);
      w.say(5);
      s.locked = true;
      return;
    }
    const a = s.heading;
    const along = a === 0 || a === 0x80;
    const step = a === 0 || a === 0x40 ? 1 : -1;
    const [sa, sb] = along ? [0xc0, 0x40] : [0, 0x80];
    let found: { t: Obj; cx: number; cy: number; left: boolean } | null = null;
    for (let k = 1; k <= 8 && !found; k++) {
      const cx = along ? s.o.cellX + step * k : s.o.cellX;
      const cy = along ? s.o.cellY : s.o.cellY + step * k;
      if (w.blocked(cx, cy)) break;
      for (const [side, far] of [[sa, true], [sb, false]] as [number, boolean][]) {
        const t = this.lookDown(side, cx, cy);
        if (!t) continue;
        // it flies past the side way's mouth, close to the far or near wall
        if (along) t.y = cy * CELL + (far ? 0x17a : 0x2a);
        else t.x = cx * CELL + (far ? 0x2a : 0x17a);
        // which way it turns: the tables at 0x4138d0 … 0x413ad0
        const left = step === 1 ? far : !far;
        found = { t, cx, cy, left };
        break;
      }
    }
    if (!found) return;
    s.cornerX = found.cx;
    s.cornerY = found.cy;
    s.o.angle = s.heading;
    s.turnLeft = found.left;
    found.t.z += (s.o.z - found.t.z) >> 1;
    this.flyAt(s, found.t);
    w.say(5);
    s.locked = true;
  }

  /** 0x413598: a grenade in flight (0), bursting (1, 2) */
  private grenadePicture(o: Obj, kind: number): void {
    const w = this.w;
    const within = w.visible(o);
    if (!within) return;
    const pt = w.project(o);
    if (pt.depth < 0xfc) return;
    if (kind === 0) return w.addFixed(within, pt.depth, pt.y, pt.x, this.pyro[70 + Math.min(13, Math.trunc((pt.depth - 0xfc) / 0xd2))], false);
    const d = Math.min(6, Math.trunc((pt.depth - 0xfc) / CELL));
    w.addFixed(within, pt.depth, pt.y, pt.x, this.pyro[(kind === 1 ? 0 : 7) + d], false);
    if (kind === 2) w.flashWith("CLUT131", 1, 2);
  }

  /** 0x4136bc: a rocket leaving (its first 8 frames), in flight, bursting (−1, −2) */
  private rocketPicture(o: Obj, k: number): void {
    const w = this.w;
    const within = w.visible(o);
    if (!within) return;
    const pt = w.project(o);
    if (pt.depth < 0xfc) return;
    if (k < 0) {
      const d = Math.min(6, Math.trunc((pt.depth - 0xfc) / CELL));
      w.addFixed(within, pt.depth, pt.y, pt.x, this.pyro[(k === -1 ? 0 : 7) + d], false);
      if (k === -2) w.flashWith("CLUT131", 1, 2);
      return;
    }
    if (k < 8) return w.addFixed(within, pt.depth, 0x9a, pt.x, this.pyro[84 + k], false);
    w.addFixed(within, pt.depth, pt.y, pt.x, this.pyro[91 + Math.min(13, Math.trunc((pt.depth - 0xfc) / 0xd2))], false);
  }

  /**
   * 0x411a49: the gun in the hand, over everything — its pose follows the last
   * shot's aim and the view's turns, a hit jolts it, and each weapon has its
   * kick and muzzle flash
   */
  draw(): void {
    const w = this.w;
    const view: [number, number, number, number] = [0, 0, 264, 384];
    let y = 0x84;
    let x = 0xc0;
    if (this.jolt) {
      w.addFixed(view, 0, y, x, this.hand[this.jolt], false);
      this.pose = this.jolt - 9;
      this.jolt = 0;
      return;
    }
    if (w.hitsTaken > 0) {
      w.hitsTaken = -10;
      this.jolt = (this.pose % 9) + 0x12;
      w.addFixed(view, 0, y, x, this.hand[this.jolt], false);
      return;
    }
    const c = w.cam;
    if (c.frame) {
      if (c.move === 3) {
        this.pose = 4;
        if (w.building) {
          if (c.frame === 2) y = 0x85;
          if (c.frame === 4 || c.frame === 6) y++;
        }
      } else if (c.move === 1) this.pose = stridePose(c.frame, 5, 6);
      else if (c.move === 2) this.pose = stridePose(c.frame, 3, 2);
    }
    const kick = KICK[this.pose];
    const muzzle = (w.building ? MUZZLE_IN : MUZZLE_OUT)[this.pose];
    if (this.recoil === 1) {
      this.recoil = 0;
      this.recoilStep = (this.recoilStep + 1) % 3;
      x = kick[1] + 0xc0;
      y += kick[0];
      w.addFixed(view, 0, muzzle[0], muzzle[1], this.pyro[(w.day >= 4 ? 116 : 106) + this.recoilStep], false);
    } else if (this.recoil === 2 || this.recoil === 3) {
      const [ky, kx] = this.recoil === 3 ? [kick[0] * 2, kick[1] * 2] : kick;
      if (this.recoilStep < 1) {
        x = kx + 0xc0;
        y += ky;
      }
      if (this.recoilStep < 2) {
        x += kx;
        y += ky;
      }
      w.addFixed(view, 0, muzzle[0], muzzle[1], this.pyro[109 + this.recoilStep], false);
      if (++this.recoilStep >= 4) {
        this.recoil = 0;
        this.recoilStep = 0;
      }
    }
    w.addFixed(view, 0, y, x, this.hand[this.pose], false);
  }
}

/** what a rocket costs of the ammunition, by day */
function rocketCost(day: number): number {
  if (day === 6) return -10;
  if (day >= 4) return -20;
  if (day === 3) return -6;
  return -12;
}

/** the hand's pose on a walking frame: `step` at frames 1 and 5, 4 at 6, `rest` else */
function stridePose(frame: number, step: number, rest: number): number {
  if (frame === 1 || frame === 5) return step;
  if (frame === 6) return 4;
  return rest;
}

/** a cell's step along each quarter heading */
const LOOK = new Map<number, [number, number]>([
  [0, [1, 0]],
  [0x40, [0, 1]],
  [0x80, [-1, 0]],
  [0xc0, [0, -1]],
]);

/** 0x428320: how far a shot kicks the hand, {down, across}, per pose */
const KICK: [number, number][] = [
  [1, -2], [1, -2], [1, -1], [1, -1], [1, 0], [1, 1], [1, 1], [1, 2], [1, 2],
  [2, -2], [2, -2], [2, -1], [2, -1], [2, 0], [2, 1], [2, 1], [2, 2], [2, 2],
  [3, -2], [3, -2], [3, -1], [3, -1], [3, 0], [3, 1], [3, 1], [3, 2], [3, 2],
];
/** where the muzzle is, per pose: 0x4282b4 indoors, 0x428248 in the open */
const MUZZLE_IN: [number, number][] = [
  [220, 232], [220, 222], [219, 212], [219, 202], [219, 191], [219, 182], [219, 171], [220, 161], [221, 152],
  [203, 231], [202, 222], [202, 212], [201, 202], [200, 192], [201, 182], [201, 172], [202, 162], [203, 153],
  [188, 229], [187, 221], [186, 211], [185, 201], [186, 192], [186, 182], [186, 173], [186, 163], [187, 153],
];
const MUZZLE_OUT: [number, number][] = [
  [218, 232], [217, 222], [217, 211], [216, 202], [215, 192], [216, 181], [217, 171], [217, 161], [218, 151],
  [206, 233], [205, 222], [204, 212], [204, 201], [204, 192], [204, 180], [204, 171], [205, 160], [206, 151],
  [194, 233], [194, 222], [192, 212], [192, 202], [192, 192], [192, 182], [192, 172], [193, 161], [194, 150],
];
