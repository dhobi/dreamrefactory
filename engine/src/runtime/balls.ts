import { s16 } from "./point";
import { CELL_UNITS } from "../df/set-v1-to-v4";
import { becomeWorldProp } from "./props";
import type { CricketOpcodes } from "./crickets";
import { ScriptError, logic, toStr, truthy, type Logic, type Value } from "./interp";
import type { GameSession } from "./session";

/**
 * DreamFactory 1's ballistic props: `makeball`, `stopball`, `pauseball`,
 * `isball`, `countballs`, `indextoball`, and the `endball(reason)` each one
 * ends with.
 *
 * v1 ids 12007/12012/16047/20011/20101/20104 — v4 gave the same ids to its
 * crickets, which are an ambient sound scheduler and nothing like this (see
 * engine/src/df/opcodes.ts). Everything here is read out of ALT31 DF.EXE.
 *
 * A ball is a slot in a 16-entry table of 0x30-byte records at 0x45fbd0:
 *
 *     +0x00 active   +0x02 pause depth   +0x04/06/08 velocity x, y, z
 *     +0x0a gravity  +0x0c bounce        +0x0e frames left
 *     +0x10 the prop's propdeg, x, y, z, tile x, tile y (copied at makeball)
 *     +0x20 the prop's name
 *
 * The activity pass (0x438840) services the walks, then this table slot by slot
 * (0x439cf0 per ball), then the loops — so a ball moves once per 50 ms pass.
 * Everything is 16-bit: positions, velocities and tiles are WORDs, a tile is
 * `position >> 8` (arithmetic, so it floors), and the counters wrap.
 */

/** DF.EXE's table size: 16 slots of 0x30 bytes at 0x45fbd0 */
export const BALL_SLOTS = 16;

export interface Ball {
  /** the prop it moves, as `makeball` was given it (+0x20) */
  name: string;
  /** +0x02: pauseball(name, true) adds one, (name, false) takes one off */
  pause: number;
  vx: number;
  vy: number;
  vz: number;
  /** +0x0a: nonzero pulls vz down by 2 a pass */
  gravity: number;
  /** +0x0c: nonzero bounces off the ground and off built-on cells */
  bounce: number;
  /** +0x0e: passes left; the ball ends with "frames" when it goes negative */
  frames: number;
  /** +0x10: the prop's propdeg when the ball was made, written back every pass */
  deg: string | number;
  x: number;
  y: number;
  z: number;
  tx: number;
  ty: number;
}

/** C's `/ 2` on a signed int: towards zero (cdq; sub eax, edx; sar eax, 1) */
const half = (v: number): number => Math.trunc(v / 2);

/**
 * The swept-box test, DF.EXE 0x43a1c0 (an actor) and 0x43a320 (the player).
 *
 * Not a ray against a box: each axis on its own, and a miss only when the pass
 * started AND ended strictly beyond the same face. `rz` is the first hitbox
 * word (the z half-height), `rxy` the second (the half-width on x and y); a box
 * with either one <= 0 is never hit, which is how the range's water jets
 * (`actorhitbox (name, -1, -1)`) stay out of the way.
 */
export function ballHits(
  from: { x: number; y: number; z: number },
  to: { x: number; y: number; z: number },
  cx: number,
  cy: number,
  cz: number,
  rz: number,
  rxy: number,
): boolean {
  if (rxy <= 0 || rz <= 0) return false;
  const miss = (o: number, n: number, c: number, r: number): boolean =>
    (c - r > o && n < c - r) || (c + r < o && n > c + r);
  if (miss(from.z, to.z, cz, rz)) return false;
  if (miss(from.x, to.x, cx, rxy)) return false;
  if (miss(from.y, to.y, cy, rxy)) return false;
  return true;
}

export class BallRuntime implements CricketOpcodes {
  constructor(private readonly session: GameSession) {}

  readonly slots: (Ball | null)[] = new Array<Ball | null>(BALL_SLOTS).fill(null);

  /**
   * `actorhitbox ("player", rz, rxy)` — DF.EXE keeps these at 0x460b68/0x460b6a
   * (setter 0x4130a0, getter 0x4131b0). The town's bounty days set (100, 50)
   * and the nights put it back to (0, 0), so a stray bullet only finds the player
   * while somebody is shooting at him.
   */
  playerHitbox: [number, number] = [0, 0];

  /** a pass whose endball is still running: the next one waits for it */
  private inflight = false;

  private find(name: string): number {
    const want = name.toLowerCase();
    return this.slots.findIndex((b) => b?.name.toLowerCase() === want);
  }

  /**
   * `makeball (prop, vx, vy, vz, gravity, bounce, frames)` — 0x439a90.
   *
   * Seven arguments, all but the name integers (error 0xe otherwise). The ball
   * starts where the prop stands, with its facing; any ball already moving that
   * prop is stopped first (0x439cb0 calls 0x438a40), and the first free slot
   * takes it — a full table is error 8, "Too many balls." (0x439cdb).
   */
  make(name: string, args: number[]): void {
    const p = this.session.propRuntime.get(name);
    // the prop is looked up between the third and the fourth number (0x439b43)
    if (!p) throw new ScriptError(0xa, `makeball: no prop ${name}`);
    this.stop(name);
    const i = this.slots.indexOf(null);
    if (i < 0) throw new ScriptError(8, `makeball (${name}): all ${BALL_SLOTS} balls are moving`);
    const [vx, vy, vz, gravity, bounce, frames] = args.map((a) => s16(a || 0));
    const x = s16(p.worldX), y = s16(p.worldY), z = s16(p.worldZ);
    this.slots[i] = {
      name,
      pause: 0,
      vx, vy, vz, gravity, bounce, frames,
      deg: p.deg,
      x, y, z,
      tx: x >> 8,
      ty: y >> 8,
    };
  }

  /** `stopball (name)` — 0x438a40: "all" empties the table, a name the first ball it finds */
  stop(name: string): void {
    if (name.toLowerCase() === "all") {
      this.slots.fill(null);
      return;
    }
    const i = this.find(name);
    if (i >= 0) this.slots[i] = null;
  }

  /**
   * `pauseball (name, flag)` — 0x43a4f0. A depth, not a flag: true adds one,
   * false takes one off and stops at 0. "all" reaches every slot.
   */
  pause(name: string, on: boolean): void {
    const bump = (b: Ball) => {
      b.pause = on ? s16(b.pause + 1) : Math.max(0, s16(b.pause - 1));
    };
    if (name.toLowerCase() === "all") {
      for (const b of this.slots) if (b) bump(b);
      return;
    }
    const i = this.find(name);
    if (i >= 0) bump(this.slots[i]!);
  }

  /**
   * `pauseball (name)` as a getter — 0x43a4a0: the depth, 0 for no ball.
   *
   * DF.EXE answers it under the BOOLEAN tag with the depth as the payload
   * (0x42d074 writes tag 2, 0x42d079 the count) — builtins/timing.ts hands it
   * back as such (interp.ts Logic), so a depth of 2 is unequal to `true` as
   * DF.EXE's `=` (0x40d4fd) finds it. No script in the Dust, Titanic or
   * Timelapse corpus reads the getter.
   */
  pauseDepth(name: string): number {
    const i = this.find(name);
    return i >= 0 ? this.slots[i]!.pause : 0;
  }

  /** `isball (name)` — 0x438b60 */
  isBall(name: string): boolean {
    return this.find(name) >= 0;
  }

  /** `countballs ()` — 0x43a420 */
  count(): number {
    return this.slots.filter(Boolean).length;
  }

  /** `indextoball (n)` — 0x43a440: the n-th active ball, 1-based */
  indexToBall(n: number): string {
    let k = n;
    for (const b of this.slots) {
      if (!b) continue;
      if (--k <= 0) return b.name;
    }
    return "none";
  }

  // ---- the cricket opcodes, which are these in DF.EXE (Crickets.opcodes) ----

  /**
   * DF.EXE reads the arguments as it goes (0x439a90): the name and three
   * numbers (0x42dfa0), the prop, then the last three (0x42dee0). Each reader
   * wants a `,` after every argument but the last, so a call that runs out of
   * them is error 0x1c, "Expected comma"; a number that is not an integer, or
   * an empty argument, is 0xe — and the prop is missing (0xa) only once the
   * first three have read.
   */
  makeCricket(name: string, args: readonly (Value | undefined)[]): void {
    const read = (from: number, to: number): void => {
      if (args.length < to) throw new ScriptError(0x1c, `makeball (${name}) takes 7 arguments, called with ${args.length + 1}`);
      for (let k = from; k < to; k++) {
        if (typeof args[k] !== "number") throw new ScriptError(0xe, `makeball (${name}): argument ${k + 2} is not an integer`);
      }
    };
    read(0, 3);
    if (!this.session.propRuntime.get(name)) throw new ScriptError(0xa, `makeball: no prop ${name}`);
    read(3, 6);
    this.make(name, args.slice(0, 6) as number[]);
  }
  stopCricket(name: string): void {
    this.stop(name);
  }
  /** `pauseball (name)` with no flag is the getter, its depth under the boolean tag (see {@link pauseDepth}) */
  pauseCricket(name: Value | undefined, flag: Value | undefined): boolean | Logic | undefined {
    if (flag === undefined) return logic(this.pauseDepth(toStr(name ?? "")));
    this.pause(toStr(name ?? "all"), truthy(flag));
    return undefined;
  }
  isCricket(name: string): boolean {
    return this.isBall(name);
  }
  countCrickets(): number {
    return this.count();
  }
  indexToCricket(n: number): string {
    return this.indexToBall(n);
  }

  /**
   * Empty the table — the scheduler's reset, before a load rebuilds the timed
   * state. The player's hitbox is left alone: it is a setting the set scripts
   * make, not something in flight.
   */
  reset(): void {
    this.slots.fill(null);
    this.inflight = false;
  }

  /** is the cell under (tx, ty) built on? — 0x434630, scene record +8 */
  private blocked(tx: number, ty: number): boolean {
    const set = this.session.currentBinding?.set;
    if (!set) return false;
    const sc = set.scenes.find(
      (s) => Math.floor(s.xAxisMap / CELL_UNITS) === tx && Math.floor(s.zAxisMap / CELL_UNITS) === ty,
    );
    return !!sc?.build;
  }

  /**
   * One service pass over the table, in slot order. A ball that ends is cleared
   * BEFORE its prop hears `endball`, so the handler may throw it again — the
   * tumbleweed's does, `makecricket (me, 0, 0, -2, 1, 1, 80)` while it is still
   * in the air.
   */
  step(): void {
    if (!this.inflight) this.serviceFrom(0);
  }

  /**
   * Service slots `from`.. in order. Moving is synchronous; only an ending
   * ball's `endball` is awaited, and the slots after it wait for it, as they do
   * in DF.EXE's single-threaded pass. A pass with no ending ball dispatches
   * nothing and leaves no script in flight.
   */
  private serviceFrom(from: number): void {
    for (let i = from; i < BALL_SLOTS; i++) {
      const b = this.slots[i];
      if (!b) continue;
      const reason = this.advance(i, b);
      if (reason === null) continue;
      this.inflight = true;
      void this.session
        .track(
          (async () => {
            try {
              await this.session.sendEvent("sendtoprop", b.name, "endball", [reason], b.name);
            } catch (e) {
              this.session.onLog(`endball ${b.name}: ${(e as Error).message}`);
            }
          })(),
          "endball",
        )
        .finally(() => {
          this.inflight = false;
          this.serviceFrom(i + 1);
        });
      return;
    }
  }

  /**
   * Move one ball one pass — 0x439cf0 — and say how it ended, or null if it
   * flies on. Exported through {@link step}; separate so a test can drive a
   * single pass without the dispatch.
   */
  advance(i: number, b: Ball): string | null {
    if (b.pause) return null;
    const p = this.session.propRuntime.get(b.name);
    if (!p) {
      // 0x439d27 fails the whole pass on a missing prop; the ball is of no use
      this.session.onLog(`ball: no prop ${b.name}`);
      this.slots[i] = null;
      return null;
    }
    b.frames = s16(b.frames - 1);
    if (b.frames < 0) {
      // 0x439d4a: out of frames — the prop is NOT moved, endball("frames") 0x439d83
      this.slots[i] = null;
      return "frames";
    }
    const from = { x: b.x, y: b.y, z: b.z, tx: b.tx, ty: b.ty };
    b.x = s16(b.x + b.vx);
    b.y = s16(b.y + b.vy);
    b.z = s16(b.z + b.vz);
    b.tx = b.x >> 8;
    b.ty = b.y >> 8;
    if (b.gravity) b.vz = s16(b.vz - 2);
    let reason: string | null = null;
    if (b.bounce) {
      if (b.z <= 0) {
        // 0x439e2f: on the ground, half the (already pulled-down) speed back up,
        // and nothing at all once |vz| <= 2 (0x4304f0 is a 16-bit abs)
        b.z = 0;
        b.vz = s16(-half(b.vz));
        if (Math.abs(b.vz) <= 2) b.vz = 0;
      }
      if (this.blocked(b.tx, b.ty)) {
        // 0x439e76: back to the edge of the cell it came from, half speed back
        if (from.tx !== b.tx) {
          b.x = s16((from.tx + b.tx + 1) << 7);
          b.tx = b.x >> 8;
          b.vx = s16(-half(b.vx));
        }
        if (from.ty !== b.ty) {
          b.y = s16((from.ty + b.ty + 1) << 7);
          b.ty = b.y >> 8;
          b.vy = s16(-half(b.vy));
        }
      }
    } else if (b.z <= 0 || this.blocked(b.tx, b.ty)) {
      // 0x439ee4: a ball that does not bounce stops at the ground or a building
      reason = "building";
    }
    if (reason === null) {
      // 0x439f00: every actor, in table order — visible (+0), in the world
      // (+0x12, actoris3d) and in the set on screen (+0x64 against 0x460bc2) ...
      const here = this.session.actorRuntime.currentSet.toLowerCase();
      for (const a of this.session.actorRuntime.actors.values()) {
        if (!a.visible || !a.worldSpace || a.setName.toLowerCase() !== here) continue;
        if (ballHits(from, b, s16(a.worldX), s16(a.worldY), s16(a.worldZ), a.hitbox[0], a.hitbox[1])) {
          reason = a.name; // 0x43a07c, the actor's own name (+0x54)
          break;
        }
      }
    }
    if (reason === null) {
      // ... then the player, 0x43a320: playerxyz's x and y (0x460bac/0x460bae)
      // and its z, 0x460bb0 — which is 0. No instruction in ALT31 stores to it
      // directly; the one write that reaches it is opengame's restore of the
      // whole 0x21e-byte engine block at 0x4609e0 (0x41a6c5, `rep movsd` out of
      // the RTD's container 1), and savegame fills that container from the same
      // memory (0x419f21). So it holds what a save says, and every save DF.EXE
      // wrote says 0: c1+464 is 0 in all the shipped RTDs (dust/tests/saves.ts).
      // Not the camera height — that is 0x460bbc (c1+476), a different word.
      const lis = this.session.listener();
      if (lis && ballHits(from, b, s16(lis.x), s16(lis.y), 0, this.playerHitbox[0], this.playerHitbox[1])) {
        reason = "player"; // 0x439fc1
      }
    }
    // 0x43a0e8 / 0x43a11e: the prop goes where the ball is, in the world, facing
    // the way it faced when it was thrown — on a hit and a building too
    becomeWorldProp(p, true);
    p.deg = b.deg;
    p.worldX = b.x;
    p.worldY = b.y;
    p.worldZ = b.z;
    p.starPending = false;
    if (reason !== null) this.slots[i] = null;
    return reason;
  }
}
