/**
 * The copilot — RAVEN.EXE 0x404b20 … 0x406fc4: the pilot in the other seat,
 * who takes what the HUD's three COPILOT buttons hand it (0x417617): the
 * navigation, HOVER, and the weapons. Each pilot of the six (`[0x43b300]`)
 * does it their own way, by the numbers 0x404b20 sets at each flight's start.
 *
 * ## The pilots' numbers (0x404b20, table 0x431138)
 *
 *   pilot  dodge after  slide  flee at (% of the danger)  burst  defensive
 *     0        2          8          0x42                  0x1c     6
 *     1        4          4          0x52                  0x10     4
 *     2        3          4          0x32                  0x10     8
 *     3        4          8          0x5a                  0x1c     2
 *     4        2          4          0x4a                  0x10     8
 *     5        2          8          0x3a                  0x1c     0xa
 *
 * The danger is the enemies' by the difficulty: 15 a tank, 10 a copter, 5 a
 * jeep (`[0x43cf92]`, `[0x43cfa6]`, `[0x43cf72]`).
 *
 * ## HOVER (0x404e7c)
 *
 * Over the beacon's cell at rest it sinks onto it — rising instead to the
 * weapons ship if it is there — and onto wreckage lying in the craft's cell,
 * held toward the street's centre line. Sat still under fire (0x404e11 counts
 * the shells fired at the craft while its slide and height hold) it dodges
 * after the pilot's count: a leap across and up or down to a rolled point,
 * mostly up or down while the shells come along its heading, mostly across
 * while they come from the side. Otherwise, a while after the last dodge, it
 * settles back to the centre line at the bottom.
 *
 * ## The navigation (0x406361, 0x40670d, 0x406b5b)
 *
 * With a beacon up it drives there (0x406361): the longer way first, the other
 * when that is blocked, one move at a time into the flight's queue (0x40b779);
 * over the fuel station or the weapons ship it turns to face it; it waits a
 * cell short of the pods while the boss is up. With none it goes to wreckage
 * on the ground, or weighs the enemies down each street within five cells
 * (0x406e20) and faces the worst — or, past the pilot's share of the danger,
 * turns off into a side street (0x406d73) and says so (0x406b0b, line 0x25).
 *
 * ## The weapons (0x4055ae, 0x4051a4, 0x405783, 0x406040)
 *
 * At rest or on a step, the first enemy down the craft's heading within five
 * cells — the boss, a copter, a tank, a jeep, a bike, in that order — is fired
 * at, with a weapon by what it is and what is left (0x4051a4): the heavy ones
 * in bursts, one shot in `burst`; defensive shots when homing things are up.
 * Its shots go into the player's table (0x419298) as the copilot's (`who` 1),
 * and count in the tally's copilot rows (0x41c765). Its aim is off by the
 * pilot's hand (0x406040): a drift for lasers and shells, a scatter for the
 * rest; tier 2 or better rockets and missiles are aimed, tier 3 home.
 *
 * The EXE's globals not set at a flight's start (0x434eb8, 0x434ec0 …
 * 0x434ed0, 0x434eec, the waypoint 0x434e90) are the object's own, so they
 * start at 0 each flight here, where the EXE carries them over.
 */
import type { CopilotApi, Shot } from "./api";
import { downFromCraft, turnToward, unproject } from "./lib";
import { abs, cosMul, dist, newObj, setObj, sinMul, type Obj, type World } from "./world";

/** the flight's moves (src/game/flight.ts): a step, a left turn, a right turn */
const UP = 1;
const LEFT = 3;
const RIGHT = 4;

/** 0x406d73's ways, the facings' order: north, south, east, west */
const NORTH = 0;
const SOUTH = 1;
const EAST = 2;
const WEST = 3;

/** what 0x4055ae found, the kinds 0x406040 homes on by (table 0x4311c4) */
const T_BIKE = 1;
const T_JEEP = 2;
const T_TANK = 3;
const T_COPTER = 4;
const T_BOSS = 5;

/** the weapons (the HUD's kinds) */
const LASERS = 0;
const SHELLS = 1;
const ROCKETS = 2;
const MISSILES = 3;
const BOMBS = 4;
const DEFENSIVE = 5;

/** 0x406e20's four sums, by where the enemies are from the craft */
interface Danger {
  /** `[ebp-0x18]` */
  north: number;
  /** `[ebp-0x14]` */
  south: number;
  /** `[ebp-0x10]` */
  east: number;
  /** `[ebp-0xc]` */
  west: number;
}

export class Copilot implements CopilotApi {
  /** `[0x434e8c]`: going to the waypoint `[0x434e90]` (a side street it fled into) */
  private toWaypoint = 0;
  private readonly waypoint: Obj = newObj();
  /** `[0x434ea8]`: when HOVER settles back to the centre line (ticks), 0 once it has */
  private settleAt = 0;
  /** `[0x434eac]`, `[0x434eb0]`: the slide and the height the shells were counted at */
  private stillSlide = -1;
  private stillZ = -1;
  /** `[0x434eb4]`: shells fired at the craft sitting still; `[0x434eb8]` of them not along its heading */
  private shells = 0;
  private sideShells = 0;
  /** `[0x434ebc]`: a dodge under way, `[0x434ec0]` frames of it left, `[0x434ec8]`, `[0x434ec4]` its slide and rise a frame */
  private dodging = 0;
  private dodgeLeft = 0;
  private dodgeAcross = 0;
  private dodgeUp = 0;
  /** `[0x434ecc]`: shots fired, the side the next comes from */
  private fired = 0;
  /** `[0x434ed0]`: shells to the next tracer; tier-0 defensives to the next puff of chaff */
  private tracer = 0;
  /** `[0x434ed4]`: the heavy weapon's shots held back toward `burst` */
  private held = 0;
  /** `[0x434ed8]`: against bikes and jeeps, lasers first (1) or shells (0) — a one-in-60 roll a shot turns it over */
  private lasersFirst = 0;
  /** `[0x434edc]`, `[0x434ee0]`, `[0x434ee4]`: the aim's drift */
  private driftX = 0;
  private driftY = 0;
  private driftZ = 0;
  /** `[0x434ee8]`: what the last target was (T_BIKE … T_BOSS) */
  private targetKind = T_BIKE;
  /** `[0x434eec]`: the weapon last fired */
  private lastWeapon = 0;

  /** the pilot's numbers (0x404b20): `[0x434ef0]` … `[0x434f00]` */
  private dodgeAfter = 0;
  private slideStep = 0;
  private fleeAt = 0;
  private burst = 0;
  private defensive = 0;

  /**
   * 0x40b779: the flight's queue made this one move (`[0x4365d0]`, `[0x4365f4]`
   * 1) — the flight sets it to its own (src/game/flight.ts)
   */
  steer: (move: number) => void = () => {};

  constructor(private readonly w: World) {}

  /** 0x404b20: a flight's start */
  reset(): void {
    const w = this.w;
    this.driftX = 0;
    this.driftY = 0;
    this.driftZ = 0;
    this.dodging = 0;
    this.targetKind = T_BIKE;
    this.toWaypoint = 0;
    this.stillSlide = -1;
    this.stillZ = -1;
    this.held = 0;
    this.lasersFirst = 0;
    this.shells = 0;
    this.settleAt = w.roll(0x28) + w.m.ticks + 0x3c;
    const p = w.params;
    const danger = p.x43cf92 * 0xf + (p.x43cfa6 * 10 + p.x43cf72 * 5);
    const set = (dodgeAfter: number, slideStep: number, pct: number, burst: number, defensive: number): void => {
      this.dodgeAfter = dodgeAfter;
      this.slideStep = slideStep;
      this.fleeAt = Math.trunc((danger * pct) / 100);
      this.burst = burst;
      this.defensive = defensive;
    };
    switch (w.r.pilot) {
      case 0: return set(2, 8, 0x42, 0x1c, 6);
      case 1: return set(4, 4, 0x52, 0x10, 4);
      case 2: return set(3, 4, 0x32, 0x10, 8);
      case 3: return set(4, 8, 0x5a, 0x1c, 2);
      case 4: return set(2, 4, 0x4a, 0x10, 8);
      case 5: return set(2, 8, 0x3a, 0x1c, 0xa);
    }
  }

  /** 0x404d26: a frame — HOVER, the navigation, the weapons, as the buttons hand them over */
  frame(): void {
    const w = this.w;
    if (w.state <= 0) return;
    const [nav, hover, arms] = w.hud.x417617();
    if (hover) this.hover(w.hud.enginesHit() ? 2 : this.slideStep);
    if (nav && (w.moveFrame === -1 || w.moveFrame === 7)) {
      const mark = { n: -1 };
      const at = newObj();
      w.hud.x417d4d(mark, at);
      if (mark.n !== -1) {
        this.toWaypoint = 0;
        this.goTo(at, mark.n);
      } else this.wander();
    }
    if (arms && (w.moveFrame < 0 || w.speed !== 0)) {
      const t = newObj();
      const k = this.pick(t);
      if (!k) return;
      this.targetKind = k;
      const weapon = this.choose(k);
      if (weapon >= 0) this.fire(weapon, t);
    }
  }

  /** 0x406df9: the world moved — the waypoint with it */
  shift(dx: number, dy: number): void {
    this.waypoint.x += dx;
    this.waypoint.y += dy;
    this.waypoint.cellX += dx >> 8;
    this.waypoint.cellY += dy >> 8;
  }

  /** 0x404e11 */
  x404e11(heading: number): void {
    const w = this.w;
    if (this.stillSlide === w.slide && this.stillZ === w.cam.z && w.speed === 0) {
      this.shells++;
      const a = w.cam.angle;
      if (heading === a || ((a + 0x80) & 0xff) === heading) return;
      this.sideShells++;
      return;
    }
    this.sideShells = 0;
    this.shells = 0;
    this.stillSlide = w.slide;
    this.stillZ = w.cam.z;
  }

  // ---- HOVER -------------------------------------------------------------------

  /** the slide held within ±step, which 0x404e7c takes back toward the centre line */
  private centred(step: number): number {
    let b = this.w.slide;
    if (-step > this.w.slide) b = -step;
    if (b > step) b = step;
    return b;
  }

  /** 0x404e7c: HOVER's frame, `step` a frame (2 with the engines hit) */
  private hover(step: number): void {
    const w = this.w;
    const c = w.cam;
    const mark = { n: -1 };
    const at = newObj();
    w.hud.x417d4d(mark, at);
    if (mark.n !== -1 && at.cellX === c.cellX && at.cellY === c.cellY && w.moveFrame < 0) {
      const b = this.centred(step);
      if (mark.n === 1) {
        const ship = w.weap.nth(0).obj;
        if (ship.cellX === c.cellX && ship.cellY === c.cellY) return w.pyro.slide(-b, step);
      }
      // 0x404f1a: the station asked for, its answer unread
      if (mark.n === 0) w.fuel.nth(0);
      return w.pyro.slide(-b, -step);
    }
    if (w.moveFrame < 0) {
      const n = w.pyro.x41d6c3();
      const o = newObj();
      for (let k = 0; k < n; k++) {
        w.pyro.x41d6de(k, o);
        if (o.z > 0 || o.cellX !== c.cellX || o.cellY !== c.cellY) continue;
        return w.pyro.slide(-this.centred(step), -step);
      }
    }
    if (this.dodging) {
      w.pyro.slide(this.dodgeAcross, this.dodgeUp);
      this.dodgeLeft--;
      this.sideShells = 0;
      this.shells = 0;
      if (this.dodgeLeft <= 0) this.dodging = 0;
      return;
    }
    if (this.shells < this.dodgeAfter) {
      if (this.settleAt !== 0 && w.m.ticks > this.settleAt) {
        w.pyro.slide(-this.centred(step), -step);
        if (w.slide === 0 && c.z === 0x46) this.settleAt = 0;
      }
      return;
    }
    // 0x405056: a dodge — mostly up or down to shells along the heading, mostly across to the others
    this.dodging = 1;
    let across: number;
    let up: number;
    if (Math.trunc(this.shells / 2) <= this.sideShells) {
      across = w.slide > 0 ? w.slide - w.roll(0x28) : w.roll(0x28) + w.slide;
      up = c.z > 0xa0 ? c.z - (w.roll(0x28) + 0x1e) : w.roll(0x28) + c.z + 0x1e;
    } else {
      across = w.slide > 0 ? w.slide - (w.roll(0x28) + 0x1e) : w.roll(0x28) + w.slide + 0x1e;
      up = c.z > 0xa0 ? c.z - w.roll(0x28) : w.roll(0x28) + c.z;
    }
    this.dodgeLeft = Math.trunc(dist(across - w.slide, up - c.z, 0) / step);
    this.dodgeAcross = Math.trunc((across - w.slide) / this.dodgeLeft);
    this.dodgeUp = Math.trunc((up - c.z) / this.dodgeLeft);
    this.settleAt = w.roll(0x28) + w.m.ticks + 0x3c;
  }

  // ---- the navigation ----------------------------------------------------------

  /**
   * 0x406361: toward `t`'s cell, `kind` what the beacon marks (0 the fuel,
   * 1 the ammunition, 2 the pods, 3 the repair bay) or −1: a step when the
   * craft faces the way and it is open, else a turn toward it
   */
  private goTo(t: Obj, kind: number): void {
    const w = this.w;
    const c = w.cam;
    let x1 = c.cellX;
    let y1 = c.cellY;
    let x2 = c.cellX;
    let y2 = c.cellY;
    const dy = c.cellY - t.cellY;
    const dx = c.cellX - t.cellX;
    if (dx === 0 && dy === 0) {
      if (kind !== 0 && kind !== 1) return;
      // over the fuel station or the weapons ship: face it; not there, face the enemies (0x406b5b)
      const it = kind === 0 ? w.fuel.nth(0).obj : w.weap.nth(0).obj;
      if (it.cellX !== c.cellX || it.cellY !== c.cellY) return this.faceWorst();
      if (c.angle === it.angle) return;
      return this.turn(it.angle);
    }
    let ok1 = 1;
    let ok2 = 1;
    let h1: number;
    let h2: number;
    if (abs(dx) > abs(dy)) {
      if (dx > 0) {
        h1 = 0x80;
        x1--;
      } else {
        if (dx === 0) ok1 = 0;
        h1 = 0;
        x1++;
      }
      if (dy > 0) {
        h2 = 0xc0;
        y2--;
      } else {
        if (dy === 0) ok2 = 0;
        h2 = 0x40;
        y2++;
      }
    } else {
      if (dy > 0) {
        h1 = 0xc0;
        y1--;
      } else {
        if (dy === 0) ok1 = 0;
        h1 = 0x40;
        y1++;
      }
      if (dx > 0) {
        h2 = 0x80;
        x2--;
      } else {
        if (dx === 0) ok2 = 0;
        h2 = 0;
        x2++;
      }
    }
    // a cell short of the pods while the boss is up, it waits
    const waits = (): boolean => kind === 2 && abs(dx) <= 1 && abs(dy) <= 1 && w.boss.up() !== 0;
    if (ok1 && c.angle === h1 && !w.solid(x1, y1)) {
      if (!waits()) this.steer(UP);
      return;
    }
    if (ok2 && c.angle === h2 && !w.solid(x2, y2)) {
      if (!waits()) this.steer(UP);
      return;
    }
    let want = h1;
    if (w.solid(x1, y1)) {
      if (w.solid(x2, y2)) return;
      want = h2;
      x1 = x2;
      y1 = y2;
    }
    if (c.angle === want && !w.solid(x1, y1)) {
      if (!waits()) this.steer(UP);
      return;
    }
    this.turn(want);
  }

  /**
   * 0x40664a (and 0x406a4a, 0x406cb2): a quarter turn toward `want`, the
   * shorter way (0x427778), into the queue as a left or right turn (tables
   * 0x4311d4, 0x4311f4, 0x431214)
   */
  private turn(want: number): void {
    const a = this.w.cam.angle;
    const to = turnToward(a, want, 0x40, 0x100);
    switch (a) {
      case 0:
        if (to === 0xc0) this.steer(LEFT);
        if (to === 0x40) this.steer(RIGHT);
        return;
      case 0x40:
        if (to === 0) this.steer(LEFT);
        if (to === 0x80) this.steer(RIGHT);
        return;
      case 0x80:
        if (to === 0xc0) this.steer(RIGHT);
        if (to === 0x40) this.steer(LEFT);
        return;
      case 0xc0:
        if (to === 0x80) this.steer(LEFT);
        if (to === 0) this.steer(RIGHT);
        return;
    }
  }

  /**
   * 0x406e20: `o` weighs `weight` on the side of the craft it is down, fewer
   * than five cells along its row or column with no block between — the
   * EXE's own four walks, each 0x41444c's
   */
  private weigh(o: Obj, weight: number, d: Danger): void {
    const w = this.w;
    if (downFromCraft(w, 0, o)) d.east += weight;
    else if (downFromCraft(w, 0x40, o)) d.south += weight;
    else if (downFromCraft(w, 0x80, o)) d.west += weight;
    else if (downFromCraft(w, 0xc0, o)) d.north += weight;
  }

  /** the jeeps 5, the tanks 15, the copters 10 each (0x4067aa …, 0x406b70 …) */
  private danger(): Danger {
    const w = this.w;
    const d: Danger = { north: 0, south: 0, east: 0, west: 0 };
    for (const [m, weight] of [[w.jeep, 5], [w.tank, 0xf], [w.copter, 0xa]] as const) {
      const n = m.count();
      for (let k = 0; k < n; k++) this.weigh(m.nth(k).obj, weight, d);
    }
    return d;
  }

  /**
   * 0x40670d: no beacon — the waypoint it fled to, else wreckage on the ground,
   * else the enemies weighed: faced, or past the pilot's share fled from into
   * a side street
   */
  private wander(): void {
    const w = this.w;
    const c = w.cam;
    if (this.toWaypoint) {
      this.goTo(this.waypoint, -1);
      if (this.waypoint.cellX === c.cellX && this.waypoint.cellY === c.cellY) this.toWaypoint = 0;
      return;
    }
    const n = w.pyro.x41d6c3();
    const o = newObj();
    for (let k = 0; k < n; k++) {
      w.pyro.x41d6de(k, o);
      if (o.z > 0) continue;
      this.toWaypoint = 0;
      return this.goTo(o, -1);
    }
    const { north: N, south: S, east: E, west: W } = this.danger();
    const flee = (...ways: number[]): boolean => {
      for (const way of ways) if (this.aside(way)) return true;
      return false;
    };
    let want = c.angle;
    if (E > W && E > S && E > N) {
      if (E >= this.fleeAt && ((S < N && this.aside(SOUTH)) || flee(NORTH, WEST))) return this.fled();
      want = 0;
    } else if (W > E && W > S && W > N) {
      if (W >= this.fleeAt && ((S < N && this.aside(SOUTH)) || flee(NORTH, EAST))) return this.fled();
      want = 0x80;
    } else if (S > E && S > W && S > N) {
      if (S >= this.fleeAt && ((E < W && this.aside(EAST)) || flee(WEST, NORTH))) return this.fled();
      want = 0x40;
    } else if (N > E && N > W && N > S) {
      if (N >= this.fleeAt && ((E < W && this.aside(EAST)) || flee(WEST, SOUTH))) return this.fled();
      want = 0xc0;
    }
    if (c.angle === want) return;
    this.turn(want);
  }

  /** 0x406b0b: fleeing — the pilot says so and it goes (pilot 2 one time in three, pilot 5 one in two) */
  private fled(): void {
    const w = this.w;
    const p = w.r.pilot;
    if (p === 2 && w.roll(3) !== 1) return;
    if (p === 5 && w.roll(2) === 1) return;
    w.comms.ask(0, 0x25);
    this.toWaypoint = 1;
  }

  /** 0x406b5b: over a beacon whose station is not there — the worst side faced */
  private faceWorst(): void {
    const w = this.w;
    const { north: N, south: S, east: E, west: W } = this.danger();
    let want = w.cam.angle;
    if (E > W && E > S && E > N) want = 0;
    else if (W > E && W > S && W > N) want = 0x80;
    else if (S > E && S > W && S > N) want = 0x40;
    else if (N > E && N > W && N > S) want = 0xc0;
    if (w.cam.angle === want) return;
    this.turn(want);
  }

  /** 0x406d73: the next cell `way` (0 north, 1 south, 2 east, 3 west) is open — the waypoint put on its centre */
  private aside(way: number): boolean {
    const w = this.w;
    let x = w.cam.cellX;
    let y = w.cam.cellY;
    if (way === NORTH) y--;
    else if (way === SOUTH) y++;
    else if (way === EAST) x++;
    else if (way === WEST) x--;
    if (w.solid(x, y)) return false;
    const p = this.waypoint;
    p.angle = w.cam.angle;
    p.cellX = x;
    p.cellY = y;
    p.x = (x << 8) + 0x80;
    p.y = (y << 8) + 0x80;
    return true;
  }

  // ---- the weapons -------------------------------------------------------------

  /** 0x4055ae: the first enemy down the heading within five cells, into `out`; what it is, 0 none */
  private pick(out: Obj): number {
    const w = this.w;
    const first = (m: { nth(k: number): { obj: Obj; dying: number } }, n: number): boolean => {
      for (let k = 0; k < n; k++) {
        const t = m.nth(k);
        if (t.dying !== 0 || !downFromCraft(w, w.cam.angle, t.obj)) continue;
        setObj(out, t.obj);
        return true;
      }
      return false;
    };
    if (first(w.boss, w.boss.up())) return T_BOSS;
    if (first(w.copter, w.copter.count())) return T_COPTER;
    if (first(w.tank, w.tank.count())) return T_TANK;
    if (first(w.jeep, w.jeep.count())) return T_JEEP;
    if (first(w.bike, w.bike.count())) return T_BIKE;
    return 0;
  }

  /** one of a heavy weapon's shots: every `burst`-th fires (`[0x434ed4]`) */
  private burstOf(weapon: number): number {
    this.held++;
    if (this.held < this.burst) return -1;
    this.held = 0;
    return weapon;
  }

  /** 0x4051a4: the weapon for a target of kind `k`, −1 for none this frame */
  private choose(k: number): number {
    const w = this.w;
    const hud = w.hud;
    const level = 2 * w.day + 1;
    if (hud.ammo(DEFENSIVE) > 0) {
      if (hud.tier(DEFENSIVE) === 0 && w.r.pilot === 5) {
        // pilot 5 puffs chaff sitting over the beacon
        const mark = { n: -1 };
        const at = newObj();
        hud.x417d4d(mark, at);
        if (mark.n !== -1 && at.cellX === w.cam.cellX && at.cellY === w.cam.cellY && w.moveFrame < 0) return DEFENSIVE;
      }
      const homing = w.tank.x425412() + (w.copter.missiles() + w.boss.homing());
      if (hud.tier(DEFENSIVE) === 1 && level === 5 && w.roll(10) <= this.defensive && homing > 0 && w.pyro.x41b6bd() === 0) return DEFENSIVE;
      if (hud.tier(DEFENSIVE) === 2 && level === 3 && w.roll(10) <= this.defensive && homing > 0 && w.pyro.x41b6bd() === 0) return DEFENSIVE;
      if (hud.tier(DEFENSIVE) === 3 && w.roll(10) <= this.defensive && homing > 0 && w.pyro.x41b6bd() === 0) return DEFENSIVE;
    }
    if (hud.ammo(BOMBS) > 0 && (k === T_JEEP || k === T_TANK)) {
      const drop = w.r.pilot === 1 ? w.roll(2) <= 1 : w.roll(3) <= 1;
      if (drop) return this.burstOf(BOMBS);
    }
    if (k === T_BIKE || k === T_JEEP) {
      if (w.roll(0x3c) === 1) this.lasersFirst = w.roll(2) - 1;
      if (this.lasersFirst !== 0) {
        if (hud.ammo(LASERS) > 0) return LASERS;
        if (hud.ammo(SHELLS) > 0) return SHELLS;
      } else {
        if (hud.ammo(SHELLS) > 0) return SHELLS;
        if (hud.ammo(LASERS) > 0) return LASERS;
      }
      if (hud.ammo(ROCKETS) > 0) return this.burstOf(ROCKETS);
      if (hud.ammo(MISSILES) > 0) return this.burstOf(MISSILES);
      if (hud.ammo(BOMBS) > 0 && k === T_JEEP) return this.burstOf(BOMBS);
      return -1;
    }
    if (k === T_TANK || k === T_COPTER || k === T_BOSS) {
      if (w.roll(2) === 1) {
        if (hud.ammo(ROCKETS) > 0) return this.burstOf(ROCKETS);
        if (hud.ammo(MISSILES) > 0) return this.burstOf(MISSILES);
      } else {
        if (hud.ammo(MISSILES) > 0) return this.burstOf(MISSILES);
        if (hud.ammo(ROCKETS) > 0) return this.burstOf(ROCKETS);
      }
      if (hud.ammo(BOMBS) > 0 && k === T_TANK) return this.burstOf(BOMBS);
      if (hud.ammo(SHELLS) > 0) return SHELLS;
      if (hud.ammo(LASERS) > 0) return LASERS;
    }
    return -1;
  }

  /** the shot put `ahead` along the heading and `side` to the side, the sides by turns, `up` above the craft */
  private muzzle(s: Shot, ahead: number, up: number, side: number): void {
    const c = this.w.cam;
    s.o.x = cosMul(c.angle, ahead) + c.x;
    s.o.y = sinMul(c.angle, ahead) + c.y;
    s.o.z = c.z + up;
    this.fired++;
    const a = this.fired & 1 ? (c.angle + 0x40) & 0xff : (c.angle - 0x40) & 0xff;
    s.o.x += cosMul(a, side);
    s.o.y += sinMul(a, side);
  }

  /** a shot put a step back, so its first move puts it at the muzzle; its cell */
  private stepBack(s: Shot): void {
    s.o.x -= s.vx;
    s.o.y -= s.vy;
    s.o.z -= s.vz;
    s.o.cellX = s.o.x >> 8;
    s.o.cellY = s.o.y >> 8;
  }

  /** 0x405783: `weapon` fired at `t`, into the first free slot of the player's table */
  private fire(weapon: number, t: Obj): void {
    const w = this.w;
    const hud = w.hud;
    const shots = w.pyro.x419298();
    const tier = hud.tier(weapon);
    const s = shots.find((x) => x.on === 0);
    if (!s) return;
    s.on = 1;
    s.kind = weapon;
    s.tier = tier;
    s.who = 1;
    s.met = 0;
    s.aim = 0;
    switch (weapon) {
      case LASERS:
        s.life = 0x18;
        this.muzzle(s, 0x12, 6, 7);
        this.aimShot(s, t, 0x50);
        s.o.cellX = s.o.x >> 8;
        s.o.cellY = s.o.y >> 8;
        w.sound(tier === 0 || tier === 2 ? 0x1c : 0x1d);
        hud.setAmmo(weapon, -0x18);
        w.pyro.x41c765(1, LASERS, tier);
        return;
      case SHELLS:
        this.tracer++;
        s.flag = 0;
        if (this.tracer >= 7) {
          this.tracer = 0;
          s.flag = 1;
        }
        if (tier === 3) s.flag = 1;
        s.life = 0x20;
        this.muzzle(s, 0x1e, -4, 7);
        this.aimShot(s, t, 0x3c);
        this.stepBack(s);
        if (tier <= 3) w.sound([0x1e, 0x1f, 0x1f, 0x20][tier]); // 0x43117c
        hud.setAmmo(weapon, -0x1e);
        w.pyro.x41c765(1, SHELLS, tier);
        return;
      case ROCKETS:
      case MISSILES:
        const odds = weapon === ROCKETS ? 4 : 6;
        s.flag = tier === 0 && w.roll(odds) === 1 ? 1 : 0;
        s.life = 0x40;
        this.muzzle(s, 6, 0xa, 0x14);
        this.aimShot(s, t, 0x20);
        this.stepBack(s);
        if (tier <= 3) w.sound((weapon === ROCKETS ? [0x21, 0x22, 0x22, 0x23] : [0x24, 0x25, 0x26, 0x27])[tier]); // 0x43118c, 0x43119c
        hud.setAmmo(weapon, weapon === ROCKETS ? -0xf0 : -0x168);
        w.pyro.x41c765(1, weapon, tier);
        return;
      case BOMBS: {
        const c = w.cam;
        s.life = 0x1f4;
        s.o.x = cosMul(c.angle, 2) + c.x;
        s.o.y = sinMul(c.angle, 2) + c.y;
        s.o.z = c.z - 0xa;
        this.aimShot(s, t, 0x20);
        this.stepBack(s);
        w.sound(0x17);
        hud.setAmmo(weapon, -0x120);
        w.pyro.x41c765(1, BOMBS, tier);
        return;
      }
      case DEFENSIVE: {
        if (tier === 0) {
          // chaff: the slot given back, a puff behind the craft one time in eight
          s.on = 0;
          this.tracer++;
          if (this.tracer < 8) return;
          this.tracer = 0;
          w.pyro.x41cd96(w.cam);
          w.soundOver(0x18);
          hud.setAmmo(weapon, -0x28);
          return;
        }
        s.opened = 0;
        s.flag = 0;
        s.life = 0x1f4;
        const r = w.roll(0x14) + 0x14;
        let h = w.slide < 0 ? (0x100 - r) & 0xffff : r;
        if (abs(w.slide) < 0x11) h = w.roll(2) === 1 ? (0x100 - r) & 0xffff : r;
        const v = (w.roll(0x1e) + 0x28) & 0xffff;
        const c = w.cam;
        const back = (c.angle + 0x80) & 0xff;
        s.o.x = cosMul(back, 0x10) + c.x;
        s.o.y = sinMul(back, 0x10) + c.y;
        s.o.z = c.z + 8;
        const p = unproject(w, { y: v, x: h }, 0x70);
        s.vx = Math.trunc((p.x - s.o.x) / 0x10);
        s.vy = Math.trunc((p.y - s.o.y) / 0x10);
        s.vz = Math.trunc((p.z - s.o.z) / 0x10) + 0x13;
        if (w.speed !== 0) {
          s.vx += cosMul(c.angle, w.speed);
          s.vy += sinMul(c.angle, w.speed);
        }
        this.stepBack(s);
        w.sound(0x17);
        hud.setAmmo(weapon, -0xa0);
        w.pyro.x41b704();
        return;
      }
    }
  }

  /**
   * 0x406040: the shot's step toward `t` at `speed` (the craft's added), off
   * by the pilot's hand; tier 2 or better rockets and missiles are aimed at
   * the point (1), tier 3 home on the record (2) — not at the boss
   */
  private aimShot(s: Shot, t: Obj, speed: number): void {
    const w = this.w;
    let off = 0;
    const at = { ...t };
    if (s.tier < 2 || s.kind >= 4) {
      // table 0x4311ac: each pilot's hand, steady with one weapon
      switch (w.r.pilot) {
        case 0: if (s.kind !== SHELLS) off = 0x3c; break;
        case 1: if (s.kind !== BOMBS) off = 0x1e; break;
        case 2: if (s.kind !== LASERS && w.roll(2) === 1) off = 0x3c; break;
        case 3: if (s.kind !== MISSILES) off = 0x1e; break;
        case 4: if (s.kind !== ROCKETS) off = 0x1e; break;
        case 5: if (s.kind !== DEFENSIVE) off = 0x3c; break;
      }
      if (s.kind <= 1) {
        this.driftX += w.roll(7) - 4;
        this.driftY += w.roll(7) - 4;
        this.driftZ += w.roll(7) - 4;
        const hold = (d: number): number => {
          if (d > off) d = off;
          if (-off > d) d = -off;
          return d;
        };
        this.driftX = hold(this.driftX);
        this.driftY = hold(this.driftY);
        this.driftZ = hold(this.driftZ);
        at.x += this.driftX;
        at.y += this.driftY;
        at.z += this.driftZ;
      } else {
        const span = off << 1;
        at.x += w.roll(span) - off;
        at.y += w.roll(span) - off;
        at.z += w.roll(span) - off;
      }
    }
    speed += w.speed;
    const dx = at.x - s.o.x;
    const dy = at.y - s.o.y;
    const dz = at.z - s.o.z;
    const n = Math.trunc(dist(dx, dy, dz) / speed) + 1;
    s.vx = Math.trunc(dx / n);
    s.vy = Math.trunc(dy / n);
    s.vz = Math.trunc(dz / n);
    if (s.kind === BOMBS) s.vz += n;
    if (s.tier >= 2 && s.kind < 4 && this.targetKind < T_BOSS) {
      if (s.kind >= 2 && s.tier >= 3) {
        const m = [null, w.bike, w.jeep, w.tank, w.copter][this.targetKind]; // 0x4311c4
        s.aim = 2;
        s.target = m ? m.find(t) : null;
        s.speed = speed;
        w.sound(0x33);
      } else {
        if (s.kind <= 1 && s.kind === this.lastWeapon) return;
        s.aim = 1;
        setObj(s.at, t);
        w.sound(0x32);
      }
    }
    this.lastWeapon = s.kind;
  }
}
