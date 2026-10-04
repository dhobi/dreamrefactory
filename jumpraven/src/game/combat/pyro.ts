/**
 * The Raven itself, and everything the player does in a flight — RAVEN.EXE
 * 0x4191ec … 0x41d7a9: the craft in the view, its fuel, the weapons and their
 * shots (src/game/combat/shots.ts), what an enemy's shot does to it, and the
 * explosions, the wreckage and the smoke every actor leaves.
 *
 * ## The craft (0x4192ad, 0x4195f9)
 *
 * The Raven is drawn in the view at its own point (0x80 ahead of the eye),
 * one of `play`'s 21 pictures: seven rows by how low in the view the point is
 * and five columns by how far across, the two right ones the two left ones
 * mirrored (0x4195f9); in flight it bobs, a 24-frame table of up to 2 pixels
 * (0x431e0c). Every frame burns fuel — 2, or 4 on the move, below 0xa0 up, 4
 * or 6 above — and with the tank dry the craft falls, 2 faster each frame,
 * and is lost at 0x20 up (0x4192d3). Flying into an enemy rams it for 0x7d0.
 *
 * ## HOVER (0x419511)
 *
 * The rise is held within 0x46 … 0xfa, the slide across the street within
 * ±0x46, and a slide puts the craft back at its pose's centre and across by
 * it (the pose's facing: north +x, south −x, east +y, west −y). Neither moves
 * while the craft falls.
 *
 * ## The weapons (0x4196ad)
 *
 * A click in the view (0x419678) or the fire key (0x41a230) fires the weapon
 * the HUD has chosen; the fire key fires the defensive, at a random point to
 * the side the craft has slid toward, and gives the HUD its weapon back. A
 * lock (0x439bac) is the vehicle under the click (the tank's, the copter's, the
 * jeep's, then the bike's pick): at tier 2 and up lasers, shells, rockets and
 * missiles aim at it while it stays 0x140 away and in the view, and tier-3
 * rockets and missiles home on it (0x419fbe, 0x41a33f).
 *
 *   lasers     every frame the button is held, 0x50 a frame, 24 frames; 0x18 of the ammo
 *   shells     every third frame (tier 0), every other (1, 2), every (3); 0x3c a frame,
 *              a tracer every seventh (every one at tier 3); 0x1e of the ammo
 *   rockets    a click each, 0x20 a frame, a tier-0 one wobbling one time in four; 0xf0
 *   missiles   the same, a tier-0 one wobbling one time in six; 0x168
 *   bombs      a click each, falling 2 faster a frame and bouncing off the blocks:
 *              tier 0 bursts where it lands, 1 sets the ground afire, 2 splits into a
 *              napalm cloud after 12 frames, 3 bursts into sixteen pieces; 0x120
 *   defensive  tier 0 puffs chaff behind the craft (every other frame on the move,
 *              every eighth at rest); 1–3 throw a decoy behind that opens after 17
 *              frames, and a tier-3 one jams the enemies' sights for 500 frames
 *              when it is done (0x41adda, 0x41d2cf); 0xa0 (chaff 0x28)
 *
 * Each shot fired and each hit counts in the tally, the player's or the
 * copilot's (0x41c765, 0x41c6f6): a laser's or a shell's hit counts 2, held
 * to the shots, and a tier-3 bomb counts as 16 shots.
 *
 * ## Hit (0x41b820)
 *
 * An enemy's shot hits the craft when its path comes within its reach + 0x14
 * of it on every axis. A shot of 0x2b or more knocks the craft across and up,
 * by the damage over 0x5dc of how far the shot moved across and up, up to 10
 * (0x419511); the shields lose the damage (0x417dac) and at nothing the craft
 * blows up, every system and weapon lost, and the flight's state goes to 0.
 *
 * ## Wreckage (0x438c94, 0x41be96)
 *
 * Thirty-two pieces of the EXE's 0x50 bytes: a fireball (0x41bbc0, drifting to
 * rest, flashing the palette and shaking the view as it swells, 0x41c9e0) with
 * four sparks flung out of it (0x41bcab); a bomb's fire on the ground, its
 * napalm cloud bobbing in the air, and its sixteen pieces; and the salvage an
 * enemy drops (0x41bd9f) — a pod — which falls, rolls to the middle of its
 * cell, and is drawn in when the craft sits still over it below 0x5e: 0x50
 * points, and the HUD's PODS (`[0x4378c0]`) down by the difficulty's 0x43cf62.
 *
 * ## Smoke (0x439694, 0x41cfd0)
 *
 * Sixteen puffs: the chaff (200 frames), which jams a sight along its row or
 * column one time in five (0x41d2cf), and the smoke a fireball leaves (0x50).
 */
import type { FrameV0 } from "@dreamfactory/engine/df/image-v0";
import type { PyroApi, Shot } from "./api";
import { flash, inBlock, jolt, tooFar, unproject } from "./lib";
import { moveShots } from "./shots";
import { FLYING, KIND, VIEW_RECT, abs, copyObj, cosMul, dist, inside, newObj, readPictures, setObj, sinMul, type Obj, type Pt, type Targets, type World } from "./world";

/** `pyro`'s pictures (0x4379d0 + 4·index): each a row of 16 (or 4) by distance unless said */
export const PIC = {
  /** lasers' beams, tier 0 and 2 (4) and tier 1 and 3 (4) */
  laser: 0x00,
  laser2: 0x04,
  shell: 0x08,
  tracer: 0x18,
  fireball: 0x28,
  /** 32 */
  spark: 0x38,
  rocket: 0x58,
  missile: 0x68,
  /** a closed defensive, 8 frames */
  decoy: 0x78,
  /** an open one: tier 3 (9 frames), tier 2 (13), tier 1 (10) */
  open3: 0x80,
  open2: 0x89,
  open1: 0x96,
  bomb: 0xa0,
  chaff: 0xb0,
  blast: 0xc0,
  blast2: 0xd0,
  /** a shot on a wall */
  chip: 0xe0,
  /** the aim's and the homing's marks, 4 each */
  aimMark: 0xf0,
  homeMark: 0xf4,
  salvage: 0xf8,
  /** a shot on an enemy */
  hit: 0x108,
  smoke: 0x118,
  /** the salvage's mark, 4 */
  salvageMark: 0x128,
} as const;

/** 0x431e0c: the bob, in pixels down */
const BOB = [0, 0, 0, 0, -1, -1, -2, -2, -2, -2, -1, -1, 0, 0, 0, 0, 1, 1, 2, 2, 2, 2, 1, 1];
/** 0x431ef8: a fireball's size by frame, added to its distance's */
const SWELL = [3, 3, 3, 2, 2, 2, 1, 1, 1, 0, 0, 0];
/** 0x431f28: a napalm cloud's bob */
const HOVERING = [-1, -2, -3, -4, -5, -6, -7, -8, -8, -7, -6, -5, -4, -3, -2, -1, 0, 0, 1, 2, 3, 4, 5, 6, 7, 8, 8, 7, 6, 5, 4, 3, 2, 1, 0, 0];

/** HOVER's bounds (0x419511) */
const RISE_MIN = 0x46;
const RISE_MAX = 0xfa;
const SLIDE_MAX = 0x46;

/** RAVENRES's `clut`s the fireballs flash the palette toward (`[0x43b324]`, `[0x43b31c]`, 0x40ed40) */
export const CLUT_BLAST = 0x81;
export const CLUT_EMBERS = 0x83;

/** the six kinds of weapon, the HUD's (records.ts KINDS) */
export const LASERS = 0;
export const SHELLS = 1;
export const ROCKETS = 2;
export const MISSILES = 3;
export const BOMBS = 4;
export const DEFENSIVE = 5;

/** a piece of wreckage, the EXE's 0x50 bytes at 0x438c94 */
export interface Wreck {
  /** +0x00 */
  on: number;
  /** +0x04: 0 a fireball, 1 a spark, 2 a bomb's piece, 3 a bomb's fire, 4 its napalm, 5 salvage */
  kind: number;
  /** +0x08 a fire's or napalm's frames since it went up, 0 before */
  burnt: number;
  /** +0x0c frames since it began (a fire's, napalm's: frames left) */
  t: number;
  /** +0x10, +0x14, +0x18 */
  vx: number;
  vy: number;
  vz: number;
  /** +0x1c */
  o: Obj;
  /** +0x34 a fireball's size, 0 to 2 by how far from the craft; napalm's bob */
  size: number;
  /** +0x38, +0x3c where salvage rolls to */
  homeX: number;
  homeY: number;
  /** +0x40 napalm's height */
  baseZ: number;
  /** +0x44 a fireball's end: 1 gone behind, 2 burnt out, 3 over */
  stage: number;
  /** +0x48 mirrored (0/1); salvage: −1 falling, 0 on the ground, 1 drawn in */
  spin: number;
  /** +0x4c whose bomb (the tally's) */
  who: number;
}

/** a puff, the EXE's 0x50 bytes at 0x439694 */
interface Puff {
  on: number;
  /** +0x04: 0 chaff, 1 smoke */
  kind: number;
  /** +0x08 */
  age: number;
  /** +0x0c a flicker in its size */
  flicker: number;
  /** +0x10 */
  mirror: number;
  /** +0x14 … +0x1c its drift */
  vx: number;
  vy: number;
  vz: number;
  /** +0x20 */
  o: Obj;
  /** +0x38 … +0x40 its cell's centre and its height */
  homeX: number;
  homeY: number;
  baseZ: number;
  /** +0x44 … +0x4c how far it has drifted, ×4 */
  dx: number;
  dy: number;
  dz: number;
}

const newShot = (): Shot => ({
  on: 0, kind: 0, tier: 0, who: 0, met: 0, life: 0, vx: 0, vy: 0, vz: 0, o: newObj(), flag: 0, opened: 0, aim: 0, at: newObj(), target: null, speed: 0,
});
const newWreck = (): Wreck => ({
  on: 0, kind: 0, burnt: 0, t: 0, vx: 0, vy: 0, vz: 0, o: newObj(), size: 0, homeX: 0, homeY: 0, baseZ: 0, stage: 0, spin: 0, who: 0,
});
const newPuff = (): Puff => ({
  on: 0, kind: 0, age: 0, flicker: 0, mirror: 0, vx: 0, vy: 0, vz: 0, o: newObj(), homeX: 0, homeY: 0, baseZ: 0, dx: 0, dy: 0, dz: 0,
});

/** held within ±n */
const clamp = (v: number, n: number): number => Math.min(Math.max(v, -n), n);

export class Pyro implements PyroApi {
  /** 0x4379d0: `pyro`'s pictures */
  readonly pics: (FrameV0 | undefined)[];
  /** 0x437f40: `play`'s, the craft's 21 */
  readonly play: (FrameV0 | undefined)[];

  /** 0x437f94: the shots */
  readonly shots: Shot[] = Array.from({ length: 0x20 }, newShot);
  /** 0x438c94: the wreckage */
  readonly wrecks: Wreck[] = Array.from({ length: 0x20 }, newWreck);
  /** 0x439694: the puffs */
  readonly puffs: Puff[] = Array.from({ length: 0x10 }, newPuff);

  /** `[0x4379c8]`: 0 flying, else how fast the craft is falling */
  falling = 0;
  /** `[0x4379cc]`: the enemy's last line (0x41c7d5) */
  lastTaunt = -1;
  /** `[0x439b94]`, `[0x439b9c]`: the craft's picture and whether mirrored; `[0x439b98]` its bob's frame */
  pose = 0;
  mirror = 0;
  bob = 0;
  /** `[0x439ba0]`: frames the button has been held since the press (the shells' and the chaff's rate) */
  held = 0;
  /** `[0x439ba4]`: shots fired, each odd one from the right */
  side = 0;
  /** `[0x439ba8]`: shells since the last tracer */
  tracers = 0;
  /** `[0x439bac]` and `[0x439bc8]`: the lock, as the vehicle's point was when locked */
  readonly lockAt: Obj = newObj();
  locked = 0;
  /** `[0x439bc4]`: the mouse, in the view */
  mouse: Pt = { y: 0, x: 0 };
  /** `[0x439bcc]`: rockets and missiles gone into the ground or a block since one hit */
  misses = 0;
  /** `[0x439bd0]`, `[0x439bd4]`, `[0x439bd8]`: chaff, salvage and defensive shots up */
  chaffs = 0;
  salvage = 0;
  decoys = 0;
  /** `[0x439bdc]`: this frame's fire is a press, not the button held */
  press = 0;
  /** `[0x439be0]`: fire this frame; `[0x439be4]` the weapon to give the HUD back, −1 none */
  firing = 0;
  restore = -1;

  /** 0x41d689, 0x41d68f: the craft, one target */
  readonly craftTargets: Targets = {
    count: () => 1,
    nth: () => ({ obj: copyObj(this.w.cam), kind: KIND.player, flag: 0, dying: 0 }),
  };
  /** 0x41d6c3, 0x41d6de: the salvage */
  readonly wreckTargets: Targets = {
    count: () => this.x41d6c3(),
    nth: (k) => {
      const obj = newObj();
      const kind = this.x41d6de(k, obj);
      return { obj, kind, flag: 0, dying: 0 };
    },
  };

  /** 0x4191ec: SHARED\PLAY and SHARED\PYRO read */
  constructor(
    readonly w: World,
    play: Uint8Array,
    pyro: Uint8Array,
  ) {
    this.play = readPictures(play);
    this.pics = readPictures(pyro);
  }

  pic(i: number): FrameV0 | undefined {
    return this.pics[i];
  }

  /** 0x41924c: a flight begins */
  reset(): void {
    this.lastTaunt = -1;
    this.falling = 0;
    this.w.state = FLYING;
    this.firing = 0;
    this.restore = -1;
    for (const s of this.shots) s.on = 0; // 0x41b60a
    this.misses = 0;
    this.decoys = 0;
    for (const r of this.wrecks) r.on = 0; // 0x41ba13
    this.salvage = 0;
    for (const p of this.puffs) p.on = 0; // 0x41cd78
    this.chaffs = 0;
    this.w.cam.z = 0x50;
  }

  /** 0x4192ad: a frame of the craft, then the shots, the wreckage and the smoke */
  frame(): void {
    const w = this.w;
    const cam = w.cam;
    if (w.state <= 0) {
      w.state--;
      this.after();
      return;
    }
    if (this.falling) {
      cam.z -= this.falling;
      this.falling += 2;
      if (cam.z <= 0x20) {
        this.hitsCraft(cam, cam, 0x4380, 0);
        this.falling = 0;
      }
      const p = w.project(cam);
      this.posed(p);
      w.sprite(this.play[this.pose], p.y, p.x, p.depth - 1, this.mirror !== 0);
      this.after();
      return;
    }
    const hud = w.hud;
    if (cam.z < 0xa0) hud.addFuel(w.speed ? -4 : -2);
    else hud.addFuel(w.speed ? -6 : -4);
    if (hud.fuel() <= 0) this.falling = 1;
    if (w.hitEnemies(cam, cam, 0x7d0, 0)) {
      this.rammed(cam);
      w.sound(0x31);
    }
    const p = w.project(cam);
    this.posed(p);
    const pt: Pt = { y: p.y + BOB[this.bob], x: p.x };
    if (++this.bob >= 0x18) this.bob = 0;
    w.sprite(this.play[this.pose], pt.y, pt.x, p.depth - 1, this.mirror !== 0);
    if (this.firing) this.shoot(pt);
    this.after();
  }

  /** 0x41a3de, 0x41be96, 0x41cfd0 */
  private after(): void {
    moveShots(this);
    this.moveWrecks();
    this.movePuffs();
  }

  /** 0x4194c1: the craft rammed something — a blast just in front of it */
  private rammed(o: Obj): void {
    const { depth, y, x } = this.w.project(o);
    if (depth < 0x40) return;
    const i = Math.min((depth - 0x40) >> 7, 0xf);
    this.w.sprite(this.pic(PIC.blast + i), y, x, depth - 2);
  }

  /** 0x419511 */
  slide(across: number, up: number): void {
    const w = this.w;
    if (this.falling) return;
    const cam = w.cam;
    if (up) {
      cam.z += up;
      if (cam.z < RISE_MIN) cam.z = RISE_MIN;
      if (cam.z > RISE_MAX) cam.z = RISE_MAX;
    }
    if (!across) return;
    w.slide += across;
    if (w.slide < -SLIDE_MAX) w.slide = -SLIDE_MAX;
    if (w.slide > SLIDE_MAX) w.slide = SLIDE_MAX;
    cam.y = (w.poseY << 8) + 0x80;
    cam.x = (w.poseX << 8) + 0x80;
    // 0x431e78
    if (w.poseDir === 0) cam.x += w.slide;
    else if (w.poseDir === 1) cam.x -= w.slide;
    else if (w.poseDir === 2) cam.y += w.slide;
    else if (w.poseDir === 3) cam.y -= w.slide;
  }

  /** 0x4195f9: the craft's picture for where its point is in the view */
  private posed(pt: { y: number; x: number }): void {
    let col = Math.trunc((pt.x * 5 - 0x64) / 0xd8);
    if (col < 0) col = 0;
    if (col >= 5) col = 4;
    let row = Math.trunc((pt.y * 7 - 0x118) / 0xe6);
    if (row < 0) row = 0;
    if (row >= 7) row = 6;
    this.mirror = 0;
    if (col >= 3) {
      this.mirror = 1;
      col = 4 - col;
    }
    this.pose = row * 3 + col;
  }

  /** 0x419678 */
  aim(pt: Pt, fire: boolean): void {
    this.firing = 1;
    this.restore = -1;
    this.mouse = { y: pt.y, x: pt.x };
    this.press = fire ? 1 : 0;
    if (fire) this.locked = 0;
  }

  /** 0x41a230: the fire key — the defensive, at a point beside the craft */
  fire(): void {
    const w = this.w;
    const b = w.roll(0x14) + 0x14;
    let x = w.slide < 0 ? 0x100 - b : b;
    if (abs(w.slide) < 0x11) x = w.roll(2) === 1 ? 0x100 - b : b;
    const y = w.roll(0x1e) + 0x28;
    this.firing = 1;
    this.press = 1;
    this.locked = 0;
    this.restore = w.hud.weapon();
    this.mouse = { y, x };
    w.hud.choose(DEFENSIVE);
  }

  /** 0x4196ad: the chosen weapon fired from the craft's point in the view */
  private shoot(pt: Pt): void {
    const w = this.w;
    const hud = w.hud;
    const cam = w.cam;
    this.firing = 0;
    const kind = hud.weapon();
    if (this.restore >= 0) {
      hud.choose(this.restore);
      this.restore = -1;
    }
    if (hud.ammo(kind) <= 0) {
      if (this.press) w.sound(3);
      return;
    }
    const tier = hud.tier(kind);
    if (this.press) this.held = 0;
    else this.held++;
    const s = this.shots.find((t) => !t.on);
    if (!s) return;
    s.on = 1;
    s.kind = kind;
    s.tier = tier;
    s.who = 0;
    s.met = 0;
    s.aim = 0;
    /** from the craft, `ahead` along its heading, `up`, and `side` to the left or the right in turn */
    const from = (ahead: number, up: number, side: number): void => {
      s.o.x = cosMul(cam.angle, ahead) + cam.x;
      s.o.y = sinMul(cam.angle, ahead) + cam.y;
      s.o.z = cam.z + up;
      const a = ++this.side & 1 ? (cam.angle + 0x40) & 0xff : (cam.angle - 0x40) & 0xff;
      s.o.x += cosMul(a, side);
      s.o.y += sinMul(a, side);
    };
    /** a step back, so that its first frame is at the muzzle */
    const back = (): void => {
      s.o.x -= s.vx;
      s.o.y -= s.vy;
      s.o.z -= s.vz;
    };
    const cells = (): void => {
      s.o.cellX = s.o.x >> 8;
      s.o.cellY = s.o.y >> 8;
    };
    switch (kind) {
      case LASERS:
        s.life = 0x18;
        from(0x12, 6, 7);
        this.aimShot(s, pt, 0x50);
        cells();
        w.sound(tier === 0 || tier === 2 ? 0x1c : 0x1d);
        hud.setAmmo(kind, -0x18);
        this.x41c765(0, LASERS, tier);
        return;
      case SHELLS:
        if (tier === 0) {
          if (this.held >= 3) this.held = 0;
          if (this.held) {
            s.on = 0;
            return;
          }
        }
        if (tier === 1 || tier === 2) {
          if (this.held >= 2) this.held = 0;
          if (this.held) {
            s.on = 0;
            return;
          }
        }
        this.tracers++;
        s.flag = 0;
        if (this.tracers >= 7) {
          this.tracers = 0;
          s.flag = 1;
        }
        if (tier === 3) s.flag = 1;
        s.life = 0x20;
        from(0x1e, -4, 7);
        this.aimShot(s, pt, 0x3c);
        back();
        cells();
        w.sound([0x1e, 0x1f, 0x1f, 0x20][tier]);
        hud.setAmmo(kind, -0x1e);
        this.x41c765(0, SHELLS, tier);
        return;
      case ROCKETS:
      case MISSILES: {
        if (!this.press) {
          s.on = 0;
          return;
        }
        const odds = kind === ROCKETS ? 4 : 6;
        s.flag = s.tier === 0 && w.roll(odds) === 1 ? 1 : 0;
        s.life = 0x40;
        from(6, 0xa, 0x14);
        this.aimShot(s, pt, 0x20);
        back();
        cells();
        w.sound(kind === ROCKETS ? [0x21, 0x22, 0x22, 0x23][tier] : [0x24, 0x25, 0x26, 0x27][tier]);
        hud.setAmmo(kind, kind === ROCKETS ? -0xf0 : -0x168);
        this.x41c765(0, kind, tier);
        return;
      }
      case BOMBS: {
        if (!this.press) {
          s.on = 0;
          return;
        }
        s.life = 0x1f4;
        const ahead = pt.y > 0x9b ? 2 : -2;
        s.o.x = cosMul(cam.angle, ahead) + cam.x;
        s.o.y = sinMul(cam.angle, ahead) + cam.y;
        s.o.z = cam.z - 0xa;
        this.aimShot(s, pt, 0x20);
        back();
        cells();
        w.sound(0x17);
        hud.setAmmo(kind, -0x120);
        this.x41c765(0, BOMBS, tier);
        return;
      }
      case DEFENSIVE: {
        if (tier === 0) {
          if (w.speed) {
            if (this.held >= 2) this.held = 0;
          } else if (this.held >= 8) this.held = 0;
          if (this.held === 0) this.x41cd96(cam);
          w.soundOver(0x18);
          s.on = 0;
          hud.setAmmo(kind, -0x28);
          return;
        }
        if (!this.press) {
          s.on = 0;
          return;
        }
        s.opened = 0;
        s.flag = 0;
        s.life = 0x1f4;
        const behind = (cam.angle + 0x80) & 0xff;
        s.o.x = cosMul(behind, 0x10) + cam.x;
        s.o.y = sinMul(behind, 0x10) + cam.y;
        s.o.z = cam.z + 8;
        const t = unproject(w, this.mouse, 0x70);
        s.vx = Math.trunc((t.x - s.o.x) / 0x10);
        s.vy = Math.trunc((t.y - s.o.y) / 0x10);
        s.vz = Math.trunc((t.z - s.o.z) / 0x10) + 0x13;
        if (w.speed) {
          s.vx += cosMul(cam.angle, w.speed);
          s.vy += sinMul(cam.angle, w.speed);
        }
        back();
        cells();
        w.sound(0x17);
        hud.setAmmo(kind, -0xa0);
        this.decoys++;
        return;
      }
    }
  }

  /**
   * 0x419fbe: a shot's step, `speed` long — at the lock, at the vehicle under
   * a press, or straight: turned a sixth of a pixel across and raised a
   * seventh of one up from the craft's point to the mouse's
   */
  aimShot(s: Shot, pt: Pt, speed: number): void {
    const w = this.w;
    if (s.tier >= 2 && s.kind < BOMBS) {
      if (!this.press) {
        if (this.locked) {
          const p = w.project(this.lockAt);
          if (p.depth >= 0x140 && inside(p.y, p.x, VIEW_RECT)) {
            this.toward(s, this.lockAt, speed + w.speed);
            return;
          }
        }
      } else {
        const target = this.picked();
        if (target) {
          const v = speed + w.speed;
          this.toward(s, target, v);
          if (s.kind >= ROCKETS && s.tier >= 3) {
            s.aim = 2;
            s.target = target;
            s.speed = v;
            w.sound(0x33);
          } else {
            s.aim = 1;
            setObj(s.at, target);
            w.sound(0x32);
          }
          this.locked = 1;
          setObj(this.lockAt, target);
          return;
        }
      }
    }
    const heading = (Math.trunc((this.mouse.x - pt.x) / 6) + w.cam.angle) & 0xff;
    const pitch = Math.trunc((pt.y - this.mouse.y) / 7) & 0xff;
    s.vz = sinMul(pitch, speed);
    const flat = cosMul(pitch, speed);
    s.vx = cosMul(heading, flat);
    s.vy = sinMul(heading, flat);
    if (w.speed) {
      s.vx += cosMul(w.cam.angle, w.speed);
      s.vy += sinMul(w.cam.angle, w.speed);
    }
    this.locked = 0;
  }

  /** 0x41a0f8 / 0x41a33f: the step toward `t`, as many frames as `speed` takes to cover it, plus one */
  toward(s: Shot, t: Obj, speed: number): void {
    const dx = t.x - s.o.x;
    const dy = t.y - s.o.y;
    const dz = t.z - s.o.z;
    const n = Math.trunc(dist(dx, dy, dz) / speed) + 1;
    s.vx = Math.trunc(dx / n);
    s.vy = Math.trunc(dy / n);
    s.vz = Math.trunc(dz / n);
  }

  /** 0x41a2df: the vehicle under the mouse, the tank's first */
  private picked(): Obj | null {
    const w = this.w;
    const pt = this.mouse;
    return w.tank.pick(pt) ?? w.copter.pick(pt) ?? w.jeep.pick(pt) ?? w.bike.pick(pt);
  }

  /** 0x41a3a7 */
  forget(target: Obj): void {
    for (const s of this.shots) if (s.on && s.aim === 2 && s.target === target) s.aim = 0;
  }

  /** 0x41b7a9 */
  hitsOurs(a: Obj, b: Obj, dmg: number, r: number): boolean {
    const w = this.w;
    if (w.weap.where() && w.weap.hit(a, b, dmg, r)) return true;
    if (w.fuel.where() && w.fuel.hit(a, b, dmg, r)) return true;
    return this.hitsCraft(a, b, dmg, r);
  }

  /** 0x41b820 */
  hitsCraft(a: Obj, b: Obj, dmg: number, r: number): boolean {
    const w = this.w;
    const cam = w.cam;
    if (w.state <= 0) return false;
    const e = r + 0x14;
    const misses = (c: number, p: number, q: number): boolean => (c - e > p && c - e > q) || (c + e < p && c + e < q);
    if (misses(cam.z, a.z, b.z) || misses(cam.x, a.x, b.x) || misses(cam.y, a.y, b.y)) return false;
    if (dmg >= 0x2b) {
      const across = Math.trunc(((this.across(b) - this.across(a)) * dmg) / 0x5dc);
      const up = Math.trunc(((b.z - a.z) * dmg) / 0x5dc);
      this.slide(clamp(across, 0xa), clamp(up, 0xa));
    }
    const hud = w.hud;
    hud.addShields(-dmg);
    if (hud.shields() > 0) return true;
    this.burst(cam, cosMul(cam.angle, w.speed), sinMul(cam.angle, w.speed), 0);
    hud.x417af1();
    hud.x417b1c();
    hud.x417b3d();
    hud.x417b5e();
    hud.x417ba5();
    for (let k = 0; k <= 5; k++) hud.lose(k);
    w.state = 0;
    return true;
  }

  /** 0x41d737: how far `o` is across the craft's heading */
  private across(o: Obj): number {
    const w = this.w;
    const dx = o.x - w.cam.x;
    const dy = o.y - w.cam.y;
    return Math.trunc((w.cos * dy - w.sin * dx) / 0x4000);
  }

  /** 0x41c765 */
  x41c765(who: number, kind: number, tier: number): void {
    const t = this.w.r.tally;
    const n = kind === BOMBS && tier === 3 ? 0x10 : 1;
    if (who) t.copilotShots[kind] += n;
    else t.shots[kind] += n;
  }

  /** 0x41c6f6: a hit, for the tally — lasers' and shells' count 2, held to the shots */
  hits(who: number, kind: number): void {
    const t = this.w.r.tally;
    const hits = who ? t.copilotHits : t.hits;
    const shots = who ? t.copilotShots : t.shots;
    if (kind <= SHELLS) {
      hits[kind] += 2;
      if (hits[kind] > shots[kind]) hits[kind] = shots[kind];
    } else hits[kind]++;
  }

  /** 0x41c7a8: the pilot's line `n`, unless `[0x4378d4]` */
  pilotSays(n: number): void {
    if (this.w.hud.x417617()[2] === 0) this.w.comms.ask(0, n);
  }

  /** 0x41c7d5: a hit with `kind` — now and then the pilot (with `[0x4378d4]`) or the enemy has something to say */
  taunt(kind: number): void {
    const w = this.w;
    if (w.hud.x417617()[2] !== 0) {
      if (w.roll(0x20) === 1) w.comms.ask(0, 0x1d);
      return;
    }
    if (kind <= SHELLS) {
      if (w.roll(0x1e) > 1) return;
    } else if (w.roll(0xf) > 1) return;
    if (w.comms.talking() === 4) return;
    let n: number;
    do n = w.roll(4);
    while (n === this.lastTaunt);
    this.lastTaunt = n;
    w.comms.ask(4, [1, 2, 3, 5][n - 1]); // 0x431fd0
    w.comms.x414b8f();
  }

  /** 0x419298 */
  x419298(): Shot[] {
    return this.shots;
  }

  /** 0x41b62d */
  x41b62d(out: Obj): boolean {
    const w = this.w;
    let tier = -1;
    // `[0x43b2fc]` the level: 3 is day 1's flying, 5 day 2's
    const level = 2 * w.day + 1;
    if (this.decoys <= 0) return false;
    if (level === 3) tier = 2;
    if (level === 5) tier = 1;
    for (const s of this.shots) {
      if (s.on && s.kind === DEFENSIVE && s.tier === tier && s.opened > 0) {
        setObj(out, s.o);
        return true;
      }
    }
    return false;
  }

  /** 0x41b6bd */
  x41b6bd(): number {
    if (this.decoys <= 0) return 0;
    return this.shots.some((s) => s.on && s.kind === DEFENSIVE) ? 1 : 0;
  }

  /** 0x41b704 */
  x41b704(): void {
    this.decoys++;
  }

  /** 0x41d2cf */
  x41d2cf(byX: number, lo: number, hi: number): number {
    const w = this.w;
    if (w.jammer > 0 && w.roll(0x1f4) <= w.jammer) return 1;
    if (this.chaffs <= 0) return 0;
    for (const p of this.puffs) {
      if (!p.on || p.kind !== 0) continue;
      const c = byX ? p.o.cellX : p.o.cellY;
      if (c < lo || c > hi) continue;
      if (w.roll(5) === 1) return 1;
    }
    return 0;
  }

  /** 0x41d396 */
  x41d396(o: Obj): number {
    const w = this.w;
    let near = 0;
    for (const list of [w.jeep, w.tank, w.copter, w.boss]) {
      const n = list.count();
      for (let k = 0; k < n; k++) {
        const t = list.nth(k).obj;
        if (abs(t.cellX - o.cellX) <= 2 || abs(t.cellY - o.cellY) <= 2) near++;
      }
    }
    const all = w.boss.count() + w.copter.count() + w.jeep.count() + w.tank.count();
    return Math.trunc(all / 2) < near ? 1 : 0;
  }

  // ---- the wreckage ----

  private freeWreck(): Wreck | undefined {
    return this.wrecks.find((r) => !r.on);
  }

  /** 0x41ba31 */
  wreckage(): number {
    return this.salvage;
  }

  /** 0x41d6c3 */
  x41d6c3(): number {
    return this.salvage;
  }

  /** 0x41d6de: the k-th salvage (counting down from k, so 0 and 1 are both the first) */
  x41d6de(k: number, out: Obj): number {
    for (const r of this.wrecks) {
      if (!r.on || r.kind !== 5) continue;
      if (--k > 0) continue;
      setObj(out, r.o);
      return KIND.debris;
    }
    throw new Error("0x41d6de: no such wreckage");
  }

  /** 0x41ba4c: one of a tier-3 bomb's sixteen pieces, flung along `angle` */
  fan(o: Obj, angle: number, who: number): void {
    const w = this.w;
    const r = this.freeWreck();
    if (!r) return;
    r.on = 1;
    r.kind = 2;
    r.t = 0;
    const pitch = w.roll(0x21) + 0x2f;
    const v = w.roll(0x10) + 8;
    r.vz = sinMul(pitch, v);
    const flat = cosMul(pitch, v);
    r.vx = cosMul(angle, flat);
    r.vy = sinMul(angle, flat);
    setObj(r.o, o);
    r.who = who;
  }

  /** 0x41bb06: a tier-1 bomb's fire on the ground */
  fire1(o: Obj, who: number): void {
    const r = this.freeWreck();
    if (!r) return;
    r.on = 1;
    r.burnt = 0;
    r.kind = 3;
    r.t = 0x190;
    setObj(r.o, o);
    r.who = who;
  }

  /** 0x41bb5e: a tier-2 bomb's napalm cloud */
  napalm(o: Obj, who: number): void {
    const r = this.freeWreck();
    if (!r) return;
    r.on = 1;
    r.burnt = 0;
    r.kind = 4;
    r.t = 0x190;
    setObj(r.o, o);
    r.size = 0;
    r.baseZ = o.z;
    r.who = who;
  }

  /** 0x41bbc0: a fireball, bigger the nearer the craft, and four sparks out of it */
  burst(o: Obj, dx: number, dy: number, dz: number): void {
    const w = this.w;
    let size = Math.trunc(dist(o.x - w.cam.x, o.y - w.cam.y, 0) / 0x200);
    if (size < 0) size = 0;
    if (size > 2) size = 2;
    const r = this.freeWreck();
    if (!r) return;
    r.on = 1;
    r.kind = 0;
    r.t = -1;
    r.vx = dx;
    r.vy = dy;
    r.vz = dz;
    setObj(r.o, o);
    r.size = size;
    r.stage = 0;
    r.spin = w.roll(2) - 1;
    for (let k = 0; k < 4; k++) this.fling(1, o, dx, dy, dz);
  }

  /** 0x41bcab (a spark, kind 1) and 0x41bd9f (salvage, kind 5): flung from `o` a random way, 12 to 19 fast */
  private fling(kind: 1 | 5, o: Obj, dx: number, dy: number, dz: number): void {
    const w = this.w;
    const r = this.freeWreck();
    if (!r) return;
    r.on = 1;
    r.kind = kind;
    r.t = 0;
    const heading = w.roll(0x100) - 1;
    const pitch = w.roll(0x100) - 1;
    const v = w.roll(8) + 0xc;
    dz += sinMul(pitch, v);
    if (o.z <= 0 && dz < 0) dz = -dz;
    const flat = cosMul(pitch, v);
    dx += cosMul(heading, flat);
    dy += sinMul(heading, flat);
    r.vx = dx;
    r.vy = dy;
    r.vz = dz;
    setObj(r.o, o);
    if (kind === 1) r.spin = w.roll(2) - 1;
    else {
      r.spin = -1;
      this.salvage++;
    }
  }

  /** 0x41bd9f */
  drop(o: Obj, dx: number, dy: number, dz: number): void {
    this.fling(5, o, dx, dy, dz);
  }

  /** 0x41c8c2: a piece moved from `from` bounces off the ground or a block, at half its speed */
  private bounce(from: Obj, r: Wreck): boolean {
    let met = false;
    if (r.o.z <= 0) {
      r.o.z = 0;
      r.vz = -Math.trunc(r.vz / 2);
      met = true;
    }
    if (inBlock(this.w, r.o)) {
      if (from.cellX !== r.o.cellX) {
        r.o.x = ((from.cellX + r.o.cellX) << 7) + 0x80;
        r.o.cellX = r.o.x >> 8;
        r.vx = -Math.trunc(r.vx / 2);
        met = true;
      }
      if (from.cellY !== r.o.cellY) {
        r.o.y = ((from.cellY + r.o.cellY) << 7) + 0x80;
        r.o.cellY = r.o.y >> 8;
        r.vy = -Math.trunc(r.vy / 2);
        met = true;
      }
    }
    return met;
  }

  private static step(r: Wreck): void {
    r.o.x += r.vx;
    r.o.y += r.vy;
    r.o.z += r.vz;
    r.o.cellX = r.o.x >> 8;
    r.o.cellY = r.o.y >> 8;
  }

  /** a step's speed one nearer nothing */
  private static slow(v: number): number {
    if (v > 0) v--;
    if (v < 0) v++;
    return v;
  }

  /** 0x41be96 */
  private moveWrecks(): void {
    const w = this.w;
    for (const r of this.wrecks) {
      if (!r.on) continue;
      switch (r.kind) {
        case 0: {
          r.t++;
          const old = copyObj(r.o);
          r.vx = Pyro.slow(r.vx);
          r.vy = Pyro.slow(r.vy);
          r.vz = Pyro.slow(r.vz);
          Pyro.step(r);
          if (this.bounce(old, r) && r.o.z > 0) {
            w.sound(0x15);
            this.flashAt(r);
          }
          if (w.hitEnemies(old, r.o, 0xbb8, 0x1e) || this.hitsCraft(old, r.o, 0x10e, 0x1e)) {
            w.sound(0x31);
            this.flashAt(r);
            this.drawFireball(r);
            r.on = 0;
            break;
          }
          this.drawFireball(r);
          if (r.stage === 3) r.on = 0;
          break;
        }
        case 1: {
          if (++r.t >= 0x30) {
            r.on = 0;
            break;
          }
          const old = copyObj(r.o);
          r.vz -= 2;
          Pyro.step(r);
          if (this.bounce(old, r)) {
            if (r.o.z > 0) {
              w.sound(0x15);
              this.flashAt(r);
            } else if (abs(r.vz) <= 2) {
              r.on = 0;
              break;
            }
          }
          if (w.hitEnemies(old, r.o, 0x3e8, 0xa) || this.hitsCraft(old, r.o, 0x87, 0)) {
            w.sound(0x31);
            this.flashAt(r);
            this.drawSpark(r);
            r.on = 0;
            break;
          }
          this.drawSpark(r);
          break;
        }
        case 2: {
          r.t++;
          const old = copyObj(r.o);
          r.vz -= 2;
          Pyro.step(r);
          if (r.t > 2 && w.hitEnemies(old, r.o, 0x12c, 0x14)) {
            w.sound(0x29);
            this.hits(r.who, BOMBS);
            this.drawPiece(r, true);
            r.on = 0;
            break;
          }
          if (this.bounce(old, r)) {
            w.sound(0x29);
            this.drawPiece(r, true);
            r.on = 0;
            break;
          }
          this.drawPiece(r, false);
          break;
        }
        case 3:
        case 4: {
          if (tooFar(w, r.o)) {
            r.on = 0;
            break;
          }
          if (r.burnt) {
            r.burnt++;
            this.drawFire(r);
            if (r.burnt >= 4) r.on = 0;
            break;
          }
          const old = copyObj(r.o);
          if (r.kind === 4) {
            r.o.z = r.baseZ + HOVERING[r.size];
            if (++r.size >= 0x24) r.size = 0;
          }
          if (w.hitEnemies(old, r.o, 0xed8, 0x14)) {
            w.sound(0x2a);
            this.hits(r.who, BOMBS);
            r.burnt = 1;
          }
          if (--r.t < 0) {
            w.sound(0x2a);
            r.burnt = 1;
          }
          this.drawFire(r);
          break;
        }
        case 5:
          this.moveSalvage(r);
          break;
      }
    }
  }

  /** 0x41c18a: salvage falls, rolls to its cell's middle, and is drawn in by a craft sitting over it */
  private moveSalvage(r: Wreck): void {
    const w = this.w;
    const cam = w.cam;
    if (tooFar(w, r.o)) {
      r.on = 0;
      this.salvage--;
      return;
    }
    if (r.spin > 0) {
      const dy = clamp(r.o.y - cam.y, 0xa);
      const dz = clamp(r.o.z - (cam.z - 0xa), 0xa);
      const dx = clamp(r.o.x - cam.x, 0xa);
      r.o.x -= dx;
      r.o.y -= dy;
      r.o.z -= dz;
      r.o.cellX = r.o.x >> 8;
      r.o.cellY = r.o.y >> 8;
      this.drawSalvage(r);
      if (dx || dy || dz) return;
      r.on = 0;
      this.salvage--;
      w.hud.x417fd5(-w.params.x43cf62);
      w.hud.addScore(0x50);
      w.sound(0x2c); // 0x423360: the same bank's sound, on its own channel
      if (w.roll(4) === 1) w.comms.ask(0, 0x19);
      return;
    }
    if (r.spin === 0) {
      const dy = clamp(r.o.y - r.homeY, 8);
      const dx = clamp(r.o.x - r.homeX, 8);
      r.o.x -= dx;
      r.o.y -= dy;
      r.o.cellX = r.o.x >> 8;
      r.o.cellY = r.o.y >> 8;
      this.drawSalvage(r);
      if (r.o.cellX === cam.cellX && r.o.cellY === cam.cellY && cam.z < 0x5e && w.speed === 0) r.spin = 1;
      return;
    }
    const old = copyObj(r.o);
    r.vz -= 2;
    Pyro.step(r);
    if (this.bounce(old, r)) {
      if (r.o.z > 0) {
        w.sound(0x15);
        this.flashAt(r);
      } else if (abs(r.vz) <= 2) {
        r.spin = 0;
        r.homeX = (old.cellX << 8) + 0x80;
        r.homeY = (old.cellY << 8) + 0x80;
      }
    }
    this.drawSalvage(r);
  }

  /** 0x41c9e0: a fireball — its flash and sounds as it swells, gone to smoke when it is out or behind */
  private drawFireball(r: Wreck): void {
    const w = this.w;
    if (r.t === 0) {
      if (r.size === 0) {
        w.sound(0x30);
        flash(w, CLUT_BLAST, 1, 1);
      }
      if (r.size === 1) flash(w, CLUT_BLAST, 1, 2);
      if (r.size === 2) flash(w, CLUT_BLAST, 1, 4);
    }
    if (r.t === 4 && r.size === 1) w.sound(0x2f);
    if (r.t === 6 && r.size === 2) w.sound(0x2e);
    if (r.size === 0) {
      if (r.t === 7) jolt(w, 2);
      if (r.t === 9) jolt(w, 1);
    }
    if (r.stage === 0) {
      const { depth, y, x } = w.project(r.o);
      if (depth < 0x40) {
        r.stage = 1;
        jolt(w, 3);
        return;
      }
      const i = Math.min(((depth - 0x40) >> 7) + SWELL[r.t], 0xf);
      w.sprite(this.pic(PIC.fireball + i), y, x, depth, r.spin !== 0);
      if (r.t >= 0xb) r.stage = 2;
      return;
    }
    if (r.stage === 1) {
      r.stage = 2;
      flash(w, CLUT_EMBERS, 1, 1);
    }
    this.x41cee3(r.o);
    r.stage = 3;
  }

  /** 0x41cb50 */
  private drawSpark(r: Wreck): void {
    const { depth, y, x } = this.w.project(r.o);
    if (depth < 0x20) return;
    const i = Math.min((depth - 0x20) >> 6, 0x1f);
    this.w.sprite(this.pic(PIC.spark + i), y, x, depth, r.spin !== 0);
  }

  /** 0x41cba3: salvage, and its mark in front of everything while it is not drawn in */
  private drawSalvage(r: Wreck): void {
    const w = this.w;
    const { depth, y, x } = w.project(r.o);
    if (depth < 0x20) return;
    const i = Math.min((depth - 0x20) >> 6, 0xf);
    if (r.spin > 0) {
      w.sprite(this.pic(PIC.salvage + i), y, x, w.cam.z > 0xa0 ? depth - 2 : depth + 1);
      return;
    }
    w.sprite(this.pic(PIC.salvage + i), y, x, depth + 1);
    const m = Math.min((depth - 0x20) >> 7, 3);
    w.sprite(this.pic(PIC.salvageMark + m), y, x, -1);
  }

  /** 0x41cc64: a bomb's fire or napalm, and its blast once it has gone up */
  private drawFire(r: Wreck): void {
    const w = this.w;
    const { depth, y, x } = w.project(r.o);
    if (depth < 0x40) return;
    const i = Math.min((depth - 0x40) >> 7, 0xf);
    if (r.burnt === 0) {
      w.sprite(this.pic(PIC.bomb + i), y, x, depth);
      if (r.kind === 4 && r.size === 0xa) w.sound(0x2b);
    } else w.sprite(this.pic((r.burnt === 2 || r.burnt === 3 ? PIC.blast2 : PIC.blast) + i), y, x, depth);
  }

  /** 0x41c968: a bomb's piece, or its blast */
  private drawPiece(r: Wreck, lit: boolean): void {
    const { depth, y, x } = this.w.project(r.o);
    if (depth < 0x40) return;
    const i = Math.min((depth - 0x40) >> 7, 0xf);
    this.w.sprite(this.pic((lit ? PIC.blast : PIC.shell) + i), y, x, depth);
  }

  /** 0x41cd26: a flash where a piece struck */
  private flashAt(r: Wreck): void {
    const { depth, y, x } = this.w.project(r.o);
    if (depth < 0x40) return;
    const i = Math.min((depth - 0x40) >> 7, 0xf);
    this.w.sprite(this.pic(PIC.blast + i), y, x, depth + 1);
  }

  // ---- the smoke ----

  /** 0x41cd96 and 0x41cee3: a puff at `o` (chaff 0x10 behind the craft, 8 up), drifting a random way */
  private puff(kind: 0 | 1, o: Obj): void {
    const w = this.w;
    const p = this.puffs.find((q) => !q.on);
    if (!p) return;
    p.on = 1;
    p.kind = kind;
    p.mirror = w.roll(2) - 1;
    p.age = 0;
    p.flicker = 0;
    const v = w.roll(5);
    const heading = w.roll(0x100) - 1;
    p.vx = cosMul(heading, v);
    p.vy = sinMul(heading, v);
    p.vz = w.roll(3) + 2;
    if (kind === 0) {
      const behind = (w.cam.angle + 0x80) & 0xff;
      p.o.x = cosMul(behind, 0x10) + o.x;
      p.o.y = sinMul(behind, 0x10) + o.y;
      p.o.z = o.z + 8;
      p.o.cellX = p.o.x >> 8;
      p.o.cellY = p.o.y >> 8;
    } else setObj(p.o, o);
    p.homeX = (p.o.cellX << 8) + 0x80;
    p.homeY = (p.o.cellY << 8) + 0x80;
    p.baseZ = p.o.z;
    p.dx = (p.o.x - p.homeX) << 2;
    p.dy = (p.o.y - p.homeY) << 2;
    p.dz = 0;
    if (kind === 0) this.chaffs++;
  }

  /** 0x41cd96 */
  x41cd96(o: Obj): void {
    this.puff(0, o);
  }

  /** 0x41cee3: smoke where a fireball went out */
  private x41cee3(o: Obj): void {
    this.puff(1, o);
  }

  /** 0x41cfd0 */
  private movePuffs(): void {
    const w = this.w;
    for (const p of this.puffs) {
      if (!p.on) continue;
      if (p.kind === 0) {
        if (tooFar(w, p.o)) {
          p.on = 0;
          this.chaffs--;
          continue;
        }
        if (++p.age >= 0xc8) {
          p.on = 0;
          this.chaffs--;
          continue;
        }
      } else if (p.kind === 1) {
        if (++p.age >= 0x50) {
          p.on = 0;
          continue;
        }
      } else continue;
      p.dx += p.vx;
      p.dy += p.vy;
      p.dz += p.vz;
      p.dx = clamp(p.dx, 0x100);
      p.dy = clamp(p.dy, 0x100);
      p.o.x = Math.trunc(p.dx / 4) + p.homeX;
      p.o.y = Math.trunc(p.dy / 4) + p.homeY;
      p.o.z = Math.trunc(p.dz / 4) + p.baseZ;
      if (p.kind === 0) this.drawChaff(p);
      else this.drawSmoke(p);
    }
  }

  /** 0x41d157: chaff swells for 50 frames, flickers, and thins after 150 */
  private drawChaff(p: Puff): void {
    const w = this.w;
    const { depth, y, x } = w.project(p.o);
    if (depth < 0x40) return;
    let i = (depth - 0x40) >> 7;
    const age = p.age;
    if (age < 0x32) i += Math.trunc(((0x32 - age) << 4) / 0x32);
    if (age >= 0x32 && age <= 0x96) {
      if (w.roll(0x14) === 1) p.flicker = w.roll(3) - 2;
      i += p.flicker;
    }
    if (age > 0x96) i += Math.trunc(((age - 0x96) << 4) / 0x32);
    if (i < 0) i = 0;
    if (i >= 0x10) i = 0xf;
    w.sprite(this.pic(PIC.chaff + i), y, x, depth, p.mirror !== 0);
  }

  /** 0x41d21c: smoke, small at first, flickering, then thinning after 40 frames */
  private drawSmoke(p: Puff): void {
    const w = this.w;
    const { depth, y, x } = w.project(p.o);
    if (depth < 0x40) return;
    let i = (depth - 0x40) >> 7;
    if (p.age < 6) i += p.age < 3 ? 2 : 1;
    else if (p.age <= 0x28) {
      if (w.roll(0x14) === 1) p.flicker = w.roll(3) - 2;
      i += p.flicker;
    } else i += Math.trunc(((p.age << 4) - 0x280) / 0x28);
    if (i < 0) i = 0;
    if (i >= 0x10) i = 0xf;
    w.sprite(this.pic(PIC.smoke + i), y, x, depth, p.mirror !== 0);
  }

  /** 0x41d576: the world moved (dx, dy) — the craft, the lock, the shots, the wreckage and the smoke */
  shift(dx: number, dy: number): void {
    const cam = this.w.cam;
    const cx = dx >> 8;
    const cy = dy >> 8;
    cam.x += dx;
    cam.y += dy;
    cam.cellX += cx;
    cam.cellY += cy;
    if (this.locked) {
      this.lockAt.x += dx;
      this.lockAt.y += dy;
      // the EXE moves the lock's cell y by dx's cells too (0x41d5bb)
      this.lockAt.cellX += cx;
      this.lockAt.cellY += cx;
    }
    for (const s of this.shots) {
      if (!s.on) continue;
      s.o.x += dx;
      s.o.y += dy;
      s.o.cellX += cx;
      s.o.cellY += cy;
      if (s.aim === 1) {
        s.at.x += dx;
        s.at.y += dy;
        s.at.cellX += cx;
        s.at.cellY += cy;
      }
    }
    for (const r of this.wrecks) {
      if (!r.on) continue;
      r.o.x += dx;
      r.o.y += dy;
      r.o.cellX += cx;
      r.o.cellY += cy;
      r.homeX += dx;
      r.homeY += dy;
    }
    for (const p of this.puffs) {
      if (!p.on) continue;
      p.o.x += dx;
      p.o.y += dy;
      p.o.cellX += cx;
      p.o.cellY += cy;
      p.homeX += dx;
      p.homeY += dy;
    }
  }
}
