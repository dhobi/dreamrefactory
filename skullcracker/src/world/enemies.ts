/**
 * The creatures stepped: the shared fight, the tracker and the bounds, the
 * {@link BRAIN_CTX} the brains are handed, the bodies' pushes, and the passes the
 * creatures are drawn in.
 */
import { SbkEntity } from "@dreamfactory/engine/df/sbk";
import { FOES, FoeAnim, loopIndex, type Foe } from "../foes";
import { TICK_SCALE, install, type BrainCtx, type Enemy, type Track } from "../brains/kit";
import { BRAINS, REACTIONS } from "../brains";
import { FOE_SFX } from "../sound";
import { Sprinkler } from "../props";
import { p, level, type Level, character, scaled, sound, damageOn } from "./state";
import { foeGravity, CLIMB_PX, landingWindow, dragged, DRAG, roundAway, STICK_PX } from "./motion";
import { foeAnchor, footOf, celRec, celOf, baseOf } from "./cels";
import { shake, setFlashColour } from "./camera";
import { groundAt, spawnedHere, roll, hereOf, corpseFrames, foeSurfaceUnder, roomSpan } from "./rooms";
import { dropBlaster } from "./arsenal";
import { anchorX, spray, bleed, ownPoint, stats, strikeBox, pops, floaterInRegion, killFoe } from "./blows";
import { HELPLESS, pinPlayer, takeHealth, posePlayer } from "./hurt";
import { playerSprite, throwSwitch } from "./fixtures";
import { leverFor, spillRoaches, raiseSprinkler } from "./scenery";
import { burnFoe, spawnCast, hatchAt, rollerAt, shedHead, wakeFoe } from "./casts";

export function stepFight(e: Enemy, foe: Foe, run: number): boolean {
  /**
   * Every class runs a machine of its own (`brains/`, each carrying its own
   * bands), and `tests/brains.ts` holds every class in {@link FOES} to having
   * one. The shared notice-face-close-swing reading that stood in for a class
   * not yet read went when the last of them was.
   */
  const brain = BRAINS[e.kind];
  if (!brain) return false;
  if (e.state !== "gait" || e.asleep || foe.rooted) return false;
  /**
   * ...and a keeper with a lever still in its patch goes for the lever.
   *
   * SERVICE is the level built on it — `0x438200` finds the first unlit switch
   * inside the class's own rect and the walk to it IS the patrol's six cels — and
   * its machine would otherwise take the same class over and march it at the
   * player instead, which leaves level six permanently dry. With nothing left to
   * throw, it fights like everything else.
   */
  if (foe.lever && leverFor(e, foe.lever.dir)) return false;
  /**
   * `0x44e5fb` — state 0, and the ONLY thing that ends the patrol is
   * `0x434200(player.point, AI+8)`: the player's own point inside the four
   * words the creator copied out of this `init` record. Not a sight line, not a
   * radius, and not the room.
   */
  const anchor = p.y - p.feet;
  // `0x434200` is half-open: left <= x < right, top <= y < bottom
  const inside =
    p.x >= e.left && p.x < e.right && anchor >= e.top && anchor < e.bottom;
  /**
   * ...and from here the class's machine runs the whole of it, the patrol
   * included: state 0 is what a thing outside the rect is in, and
   * the rect is what moves it into state 1 — and nothing moves it back. No
   * think function installs its state-0 script again once it has left it (the
   * dog's `0x454c13`, the rat's `0x44e010`, wbooly's `0x455940` and every
   * other), so stepping out of the rect does not send a brain home: a dog
   * that has seen you keeps coming.
   */
  if (inside && !e.fighting) {
    e.fighting = true;
    e.swing = false;
  }
  /**
   * ...and it thinks once an ENGINE FRAME, not once a tick.
   *
   * A class's think function is called from the frame dispatcher, fifteen
   * times a second; this page ticks at sixty. Every state that ACCUMULATES is
   * wrong by a factor of four otherwise: kragg's kind 5 steers by adding
   * `away(dy)` to its velocity every call (`0x440ff1`), so four calls a frame
   * would put four times the correction in and dive the boss through the
   * floor, and every other class would spend `AI+2` beats and `AI+4` decision
   * budgets four times too fast.
   *
   * Between frames the thing still plays and still moves — that is the page's
   * job below, not the machine's.
   */
  if (Math.floor(e.clock) === Math.floor(e.clock - TICK_SCALE)) return false;
  return brain(e, foe, run, BRAIN_CTX);
}

/**
 * Is the player's own cel an attacking frame this tick?
 *
 * `out+6` of the tracker, and read ONCE a tick rather than once per enemy —
 * {@link strikeBox} looks the player's cel up by id and twenty enemies asking
 * separately was the single hottest thing the fight added. See {@link celRec}.
 */
export let playerSwinging = false;

export function track(e: Enemy, bands: readonly number[]): Track {
  // `0x45efe4` — `obj+8` from `obj+8`, anchor to anchor
  const ax = anchorX(e);
  const forward = (p.x - ax) * e.facing;
  let band = -1;
  if (forward >= 0) {
    band = 0;
    while (band < bands.length && bands[band] >= forward) band += 1;
  }
  // `0x45f014`: which side of the PLAYER it stands on — 1 in front, 0 behind, and
  // 2 when the player carries no velocity at all
  const still = p.vx === 0;
  const infront = p.x >= ax === p.facing < 0;
  // `0x45efe8` — and the height is anchor against anchor, `obj+6` from `obj+6`:
  // the player's is `p.y - p.feet`, the foe's is its gait cel's point above its
  // feet ({@link foeAnchor})
  const anchor = level ? foeAnchor(e, level) : null;
  let side: 0 | 1 | 2 = 0;
  if (still) side = 2;
  else if (infront) side = 1;
  return {
    forward,
    dy: p.y - p.feet - (anchor ? anchor.y : e.y),
    band,
    side,
  };
}

/**
 * `0x456550` — is it within sixty pixels of the bound it is walking towards?
 *
 * The engine keeps two of them in `obj+0x38` and `obj+0x3a` and picks by the
 * facing, and the classes ask before installing a walk: a punk that has run out
 * of ground does not take another step off it. The bounds are the mover's
 * ({@link measureGround}), not the record's rect — the rect is the territory
 * the think weighs the player against, and it says nothing about where a
 * ledge ends.
 */
export function atBound(e: Enemy): boolean {
  return Math.abs(anchorX(e) - ((e.facing > 0 ? e.hi : e.lo) ?? 0)) <= 60;
}

/** `0x456590` — the same, against the bound at its back */
export function atRear(e: Enemy): boolean {
  return Math.abs(anchorX(e) - ((e.facing > 0 ? e.lo : e.hi) ?? 0)) <= 60;
}

/**
 * `0x40bcd0` — where the floor under x stops being walkable, one way.
 *
 * It walks the region's floor from the point in eight-pixel samples, at most
 * 200 pixels, and stops at the first sample more than `reach` above or below
 * the one before it. Off the ends of the floor it answers the point itself on
 * the side that has run out and `0` or `0x7d00` on the other, and a region with
 * no floor is its rect, fifty pixels in from each end (`0x40bd2e`).
 */
export function floorEdge(x: number, dir: 1 | -1, reach: number): number {
  const room = p.room;
  const xi = Math.round(x);
  if (!room) return dir > 0 ? 0x7d00 : 0;
  const g = room.ground;
  if (!g) {
    const lo = room.left + 50;
    const hi = room.right - 50;
    if (xi >= hi) return dir > 0 ? xi : 0;
    if (xi < lo) return dir > 0 ? 0x7d00 : xi;
    return dir > 0 ? hi : lo;
  }
  const cx = xi - g.x0;
  if (cx < 0) return dir > 0 ? 0x7d00 : xi;
  if (cx >= g.ys.length) return dir > 0 ? xi : 0;
  const end = dir > 0 ? Math.min(cx + 200, g.ys.length) : Math.max(cx - 200, 0);
  let last = g.ys[cx];
  for (let bx = cx + 8 * dir; dir > 0 ? bx < end : bx > end; bx += 8 * dir) {
    if (Math.abs(last - g.ys[bx]) > reach) return g.x0 + bx;
    last = g.ys[bx];
  }
  return g.x0 + end;
}

/**
 * `0x42fd80`'s own measurement of the ground, `0x42fe02`…`0x42fed2`, into
 * {@link Enemy.lo} and {@link Enemy.hi} — see {@link Foe.span}.
 *
 * With `obj+0x3c` set the floor scan fills both; with `obj+0x34` set the
 * platform table is searched after it, and the highest row that spans the x
 * (both ends inclusive), reaches below the feet and tops out above the floor
 * replaces them with its own two ends — the ledge it stands on, or the one it
 * is falling onto. With neither, the two words keep what they last held.
 */
export function measureGround(e: Enemy, foe: Foe, lvl: Level): void {
  const span = foe.span;
  if (!span) return;
  // from the anchor, `obj+8`, as `0x40bcd0` is asked
  const ax = anchorX(e);
  if (span.reach > 0) {
    e.lo = floorEdge(ax, -1, span.reach);
    e.hi = floorEdge(ax, 1, span.reach);
  }
  if (!span.platforms) return;
  const feet = footOf(e, lvl, foe);
  const floor = groundAt(ax) ?? Infinity;
  let best = floor;
  for (const room of lvl.solids)
    for (const pl of room.platforms) {
      if (ax < pl.left || ax > pl.right || pl.bottom < feet) continue;
      if (pl.top >= best) continue;
      best = pl.top;
      e.lo = pl.left;
      e.hi = pl.right;
    }
}

/**
 * `0x44f020` — is this one's side of the player crowded?
 *
 * The class walks its own list, counts every member within two hundred pixels of
 * the PLAYER, adds one for each that wants the far side and subtracts one for
 * each that wants the near, and answers yes when its own side is more than three
 * ahead. `0x44e75b` then flips this one over.
 */
export function crowded(e: Enemy): boolean {
  let n = 0;
  // every member of the class list, the corpses still in it included — the
  // walk at `0x44f03c` asks nothing but the distance — and `AI+6` as the
  // creator seeds it, 0 (`0x450ad7`), for one that has not thought yet
  for (const other of spawnedHere()) {
    if (other.kind !== e.kind) continue;
    if (Math.abs(anchorX(other) - p.x) >= 200) continue;
    n += (other.side ?? 0) !== 0 ? 1 : -1;
  }
  return (e.side ?? 0) !== 0 ? n > 3 : n < -3;
}

/**
 * Everything a class's own machine is allowed to see, handed in rather than
 * reached for — see {@link file://../brains/kit.ts}.
 *
 * The player's fields are read fresh on every access, so one object can be
 * shared by every brain for the whole run of the page.
 */
export const BRAIN_CTX: BrainCtx = {
  player: {
    get x() {
      return p.x;
    },
    get y() {
      return p.y;
    },
    /** his own standing cel's height above his feet */
    get top() {
      return p.y - p.feet;
    },
    get anchor() {
      return p.y - p.feet;
    },
    get vy() {
      return p.vy / TICK_SCALE;
    },
    get swinging() {
      return playerSwinging;
    },
    get down() {
      return p.act === "dying";
    },
    get facing() {
      return p.facing;
    },
    get climbing() {
      return p.climbing;
    },
    get crouching() {
      return p.crouching;
    },
    get character() {
      return character;
    },
    get jolted() {
      return p.act === "jolt";
    },
    get helpless() {
      return p.act !== null && HELPLESS.has(p.act);
    },
    get free() {
      return !p.hidden;
    },
  },
  ladderNear: (e) => {
    if (!level) return undefined;
    const x = anchorX(e);
    const y = BRAIN_CTX.anchorY(e);
    let best: SbkEntity | undefined;
    let far = 0x7fff;
    for (const l of level.ladders) {
      const d = Math.abs(y - l.pointY) + Math.abs(x - l.pointX);
      if (d < far) {
        far = d;
        best = l;
      }
    }
    return best && { x: best.pointX, y: best.pointY, top: best.top, bottom: best.bottom };
  },
  track,
  shake: (n) => shake(n),
  flash: (colour) => {
    setFlashColour(colour);
  },
  burn: (e, how) => burnFoe(e, { ...how, from: "BrainCtx.burn" }),
  spray: (e, damage) =>
    spray(e, damage, { dx: 0, dy: 0 }, level ? foeAnchor(e, level) ?? undefined : undefined),
  anchorX: (e) => anchorX(e),
  anchorY: (e) => (level ? foeAnchor(e, level)?.y : undefined) ?? e.y,
  atBound,
  atRear,
  crowded,
  roll,
  scaled,
  // `0x434630` — and it really is the integer one: the arcs it solves are whole
  // pixels in the engine and a fractional root would drift them
  root: (n) => Math.floor(Math.sqrt(Math.max(0, n))),
  say: (e, id, way) => sound?.effect(id, e.x, e.y, way),
  /**
   * `0x441519` — `0x40b660("initsprinkler", boss, 1, -1, out)`, and geometry
   * −1 is `0x40b756`: the record whose `pointY`/`pointX` is nearest in
   * MANHATTAN distance, not the one whose rect holds anything.
   */
  spill: (at, n) => spillRoaches(at, n),
  pin: (at, v) => pinPlayer(at, v),
  hide: (hidden) => {
    p.hidden = hidden;
  },
  drain: (n) => {
    if (damageOn && p.act !== "dying") takeHealth(n);
  },
  bleed: (n) => bleed(n, ownPoint()),
  pose: (mode) => posePlayer(mode),
  someIn: (e, state) =>
    spawnedHere().some((o) => o !== e && o.kind === e.kind && o.state !== "dead" && o.script === state),
  sprinkler: (e) => {
    const all = hereOf((l) => l.sprinklers);
    if (!all.length) return null;
    let best: Sprinkler | null = null;
    let by = Infinity;
    for (const q of all) {
      const d = Math.abs(q.y - e.y) + Math.abs(q.x - e.x);
      if (d < by) {
        by = d;
        best = q;
      }
    }
    return best ? { x: best.x, y: best.y } : null;
  },
  raise: (e) => raiseSprinkler(e),
  count: (kind) => spawnedHere().filter((q) => q.kind === kind && q.state !== "dead").length,
  every: (kind) =>
    (level?.spawned ?? []).flat().filter((q) => q.kind === kind && q.state !== "dead"),
  // `0x426450` — Manhattan, `|dx| + |dy|` against the player's point, and a
  // candidate has to come in strictly under the best so far (`0x426499`)
  nearest: (kind, within) => {
    let best: Enemy | null = null;
    let by = within;
    for (const q of spawnedHere()) {
      if (q.kind !== kind || q.state === "dead") continue;
      const d = Math.abs(q.x - p.x) + Math.abs(p.y - p.feet - q.y);
      if (d < by) {
        by = d;
        best = q;
      }
    }
    return best ? { x: best.x, y: best.y } : null;
  },
  /**
   * `0x4263e0` — every one of them, where it stands, with the lift and the
   * award its own death carries.
   *
   * Every one on the LEVEL: it walks the class's own list (`[0x46ecc4]` for the
   * bat, `0x4263e1`), which holds whatever `0x430d40` filed under the class —
   * and `0x41e450` makes a bat for every `initbat` in the book with
   * `0x40b850`'s room test off (`push 0` at `0x41e748`). Nothing on the walk
   * asks which room a bat is in.
   */
  slayAll: (kind) => {
    for (const q of (level?.spawned ?? []).flat()) {
      if (q.kind !== kind || q.state === "dead") continue;
      const kid = FOES[kind];
      if (!kid.death) continue;
      // `0x4263fd` — goo first, `0x40cba0(obj+6, 0x3c, 0)` from its point
      spray(q, 0x3c, { dx: 0, dy: 0 }, level ? foeAnchor(q, level) ?? undefined : undefined);
      q.state = "dead";
      q.anim = kid.death;
      q.clock = 0;
      q.linger = kid.linger ?? corpseFrames + (kid.lingerPlus ?? 0);
      // `0x4263f7` — each one is thrown UP as it is taken, and `batReacts`
      // is told the throw is spent
      q.vy = -40 * TICK_SCALE;
      q.threw = true;
      stats.score += kid.award ?? kid.panel?.award ?? 0;
      // `0x426424` — `0x40ef30(0x4a5870, 1, obj+6)`, belfry.snd's record 1
      sound?.effect(1, q.x, q.y);
    }
  },
  remove: (e, award) => {
    stats.score += award;
    const pool = spawnedHere();
    const at = pool.indexOf(e);
    if (at >= 0) pool.splice(at, 1);
  },
  cast: (e, kit, aim) => spawnCast(e, kit, aim),
  hatch: (e, kind, at) => hatchAt(e, kind, at),
  roller: (_e, at) => rollerAt(at.x, at.y, at.vx),
  // `obj+0x24` as the allocator leaves it, 10 a frame² (`0x42f5ca`), per
  // tick²: the one reader is werea's arc (`0x44e878` reads its own `obj+0x24`),
  // and its creator `0x450a50` never calls `0x42f850`
  gravity: 10 * TICK_SCALE * TICK_SCALE,
};

/**
 * The body pass — `0x430680`, once per object per engine frame, between the
 * scripts and the hits (`0x42fc10`).
 *
 * Every object with a shove weight (`obj+0x26`) is weighed against every one
 * after it in the list, and a pair whose body rects overlap (`0x434140`) push
 * each other apart by `0x430720`:
 *
 * ```
 *   I     = the area of the overlap
 *   own   = the area of this object's rect
 *   push  = obj+0x26 × I / own          ; its OWN weight, truncated
 *   obj+0xc -= push, signed away from the other's x (obj+8)
 * ```
 *
 * So the weight is how easily a thing is shoved, not how hard it shoves: the
 * dog's 1 barely moves, the punks' 8 and the player's 8 part evenly, the big
 * ones' 12 give way faster, and a thing with 0 — the gang, the rats, anything
 * the allocator left alone (`0x42f5d0`) — is not in the pass at all, and walks
 * through you. A deep overlap is a hard push and a graze is a nudge; the rect is
 * the cel's drawn extent (`0x42f9f0`), and the drag spends what it adds.
 *
 * The player takes part at 8 (`0x429522`) until dying writes 0 (`0x4293d0`,
 * `0x4294a2`), and every class writes 0 over its corpse.
 */
export const pushes = new Map<Enemy, number>();
export function bodyRect(
  e: Enemy,
  lvl: Level,
): { x0: number; y0: number; x1: number; y1: number } | null {
  const c = celRec(lvl.sbk, celOf(e));
  const a = foeAnchor(e, lvl);
  if (!c || !a) return null;
  // mirrored about the anchor, as the draw is (`0x42fa2c`)
  const x0 = Math.round(e.facing < 0 ? a.x - (c.width - c.posX) : a.x - c.posX);
  const y0 = Math.round(a.y - c.posY);
  return { x0, y0, x1: x0 + c.width, y1: y0 + c.height };
}
export function shoveOf(e: Enemy): number {
  if (e.state === "dead" || e.state === "burst") return 0;
  return e.shove ?? FOES[e.kind]?.shove ?? 0;
}
export function bodyPush(ladder: boolean): void {
  const lvl = level;
  if (!lvl) return;
  type Body = {
    w: number;
    x: number;
    r: { x0: number; y0: number; x1: number; y1: number };
    shove: (dv: number) => void;
  };
  const bodies: Body[] = [];
  const me = playerSprite();
  // `0x42f550` puts the player first in the list
  if (me && p.act !== "dying" && !ladder && p.bar === undefined)
    bodies.push({
      w: 8,
      x: p.x,
      r: { x0: me.left, y0: me.top, x1: me.left + me.f.width, y1: me.top + me.f.height },
      shove: (dv) => (p.vx += dv),
    });
  for (const e of spawnedHere()) {
    const w = shoveOf(e);
    if (w === 0) continue;
    const r = bodyRect(e, lvl);
    if (!r) continue;
    bodies.push({ w, x: anchorX(e), r, shove: (dv) => pushes.set(e, (pushes.get(e) ?? 0) + dv) });
  }
  for (let i = 0; i < bodies.length; i++) {
    const a = bodies[i];
    for (let j = i + 1; j < bodies.length; j++) {
      const b = bodies[j];
      const x0 = Math.max(a.r.x0, b.r.x0);
      const x1 = Math.min(a.r.x1, b.r.x1);
      const y0 = Math.max(a.r.y0, b.r.y0);
      const y1 = Math.min(a.r.y1, b.r.y1);
      if (x1 <= x0 || y1 <= y0) continue;
      const overlap = (x1 - x0) * (y1 - y0);
      const own = (r: Body["r"]) => (r.x1 - r.x0) * (r.y1 - r.y0);
      // `0x430788` — the first is pushed west unless the second is west of it...
      const da = Math.trunc((a.w * overlap) / own(a.r));
      a.shove(b.x >= a.x ? -da : da);
      // `0x43079f` — ...and the second east unless it is west of (or on) the first
      const db = Math.trunc((b.w * overlap) / own(b.r));
      b.shove(b.x > a.x ? db : -db);
    }
  }
}

/**
 * What one creature's step this frame works on, built once per creature in
 * {@link stepEnemies}: the creature, its class, how long its animation runs,
 * the pool it lives in and the level.
 */
interface EnemyStep {
  readonly e: Enemy;
  readonly foe: Foe;
  readonly run: number;
  readonly pool: Enemy[];
  readonly lvl: Level | null;
}

export function stepEnemies(): void {
  const lvl = level;
  const pool = spawnedHere();
  playerSwinging = strikeBox() !== null;
  const stepping = pool.slice();
  for (const e of stepping) {
    const foe = FOES[e.kind];
    // ...and a thing that is no longer running a state of its own has weight
    // again, which only a brain that sets {@link Enemy.weightless} notices
    if (e.state !== "gait") e.weightless = false;
    e.clock += TICK_SCALE;
    rally(e, foe);
    const run = e.anim.cels.length * e.anim.hold;
    const ctx: EnemyStep = { e, foe, run, pool, lvl };
    /**
     * ...and a class that DOES something while the page plays its reaction.
     *
     * See {@link Reaction}: three classes have a state a brain is never called
     * during and that no animation can express — and all three were out of
     * reach for exactly that reason. It runs once an ENGINE FRAME, as a brain
     * does, and it may not install anything: the page goes on owning the
     * animation and the frame count.
     */
    // ...and what it answers, from a flinch, is a script of its own machine
    // that ends the flinch this frame ({@link Reaction}), handled with the
    // `resume` below once the frame's movement is done
    let cut: FoeAnim | undefined;
    if (
      (e.state === "flinch" || e.state === "dead") &&
      Math.floor(e.clock) !== Math.floor(e.clock - TICK_SCALE)
    ) {
      const to = REACTIONS[e.kind]?.(e, foe, run, BRAIN_CTX);
      if (to && e.state === "flinch") cut = to;
      // ...and from a death as well, where the think's preamble exempts the
      // death's state: the ox's `0x43f325` puts even a dying ox in the pit
      else if (to && e.state === "dead") {
        e.state = "gait";
        e.swing = false;
        install(e, to);
        e.clock = 0;
        continue;
      }
    }
    if (e.state === "dead") {
      stepCorpse(ctx);
      continue;
    }
    // the water: it plays once where it was put and then the object goes, which is
    // `0x44fbb4` returning 1 on the frame its animation ends. It has no weight, no
    // floor and no collision box of its own to stand on one with
    if (e.state === "burst") {
      if (e.clock >= run) pool.splice(pool.indexOf(e), 1);
      continue;
    }
    // `0x42fd80` measures the ground before anything reads it this frame
    if (lvl) measureGround(e, foe, lvl);
    // a dormant thing holds its one cel until the player's point is inside its
    // rect, and its think's state 0 is what it lands in the moment it is not
    if (e.state === "gait" && foe.wake && e.asleep && wakeFoe(e, foe)) continue;
    // ...and every other class fights through the one shared brain, until its
    // own has been read — see {@link BRAINS}
    if (stepFight(e, foe, run)) continue;
    // ...and kragg is a floater only until it is shot down: the fall's tag 1
    // calls `0x42f850(obj, 1.0)` at `0x4416e6` and it lands like anything else
    // from there, its brain holding the weight off through the steered first
    // tag ({@link Enemy.weightless}). See {@link Foe.rallies}
    const aloft = foe.floats && !(foe.rallies && e.rallied);
    fly(ctx, aloft);
    if (endFlinch(ctx, cut)) continue;
    if (seekLever(ctx)) continue;
    const step = settleStride(e, foe);
    walkSwept(ctx, step);
    standOnSurface(ctx, aloft);
  }
}

/**
 * ...and the landing that gives one of them its second bar.
 *
 * `0x441726` — the fall's tag 1, weight on, waits for `obj+0x30` and
 * `obj+0x2e`, the body on the floor; then `0x441747` writes the X it landed
 * at into `[0x4a7574]` ({@link Enemy.home}), `0x473ba8` goes on,
 * `0x44176f` sprays `0x40cba0(point, 0x14, 0)`, `0x441787` writes
 * `0x40e300(0x3e8)` back into the health word whole and `0x44179b` says
 * 0x18. Past the tag's two lifts, a vertical speed of nothing is the floor.
 * See {@link Foe.rallies}.
 */
function rally(e: Enemy, foe: Foe): void {
  if (
    foe.rallies &&
    e.rallied &&
    e.hp <= 0 &&
    e.state === "gait" &&
    e.script === foe.rallies.fall.kind &&
    e.tag === 1 &&
    e.clock >= 2 &&
    e.vy === 0
  ) {
    e.hp = scaled(foe.rallies.health);
    e.max = e.hp;
    e.home = e.x;
    e.anim = foe.rallies.rise;
    e.script = foe.rallies.rise.kind;
    e.tag = foe.rallies.rise.tag;
    e.clock = 0;
    // no hitter behind it (`0x441767 push 0`), so the goo flies loose
    spray(e, 0x14, { dx: 0, dy: 0 }, undefined, true);
    sound?.effect(FOE_SFX.kraggRise, e.x, e.y);
  }
}

/** a dead thing: what comes out of it, the wreck it throws, its fall, and then the body and the green ball */
function stepCorpse(ctx: EnemyStep): void {
  const { e, foe, run, pool, lvl } = ctx;
  shedAndHatch(ctx);
  throwWreck(e, foe);
  dropCorpse(ctx);
  /**
   * ...a death that is two scripts hands to its second half at its own
   * rate, as a flinch does ({@link FoeAnim.next}). The gunner TCop's kind 9
   * tag 3 is the case: `0x414566` waits for it to end, drops the blaster a
   * hundred pixels behind it (`0x414599`, `0x45b060(6, …)`) and installs
   * kind 11 (`0x4145a4`), which is the removal.
   */
  if (e.anim.next && e.clock >= run) {
    if (e.kind === "initcop" && e.param) dropBlaster(e);
    e.anim = e.anim.next;
    e.clock = 0;
    if (e.anim.kind !== undefined) {
      e.script = e.anim.kind;
      e.tag = e.anim.tag;
    }
    return;
  }
  // the death animation, then the body, then a green ball where it was
  if (e.clock >= run) {
    e.linger -= TICK_SCALE;
    if (e.linger <= 0) {
      // only the kinds whose corpse handler calls `0x40cba0(pos, -13, 0)`
      // ...at the corpse's own point, `obj+6` (`0x40cbf0`)
      if (foe.vanishes) {
        const at = (lvl && foeAnchor(e, lvl)) || { x: e.x, y: e.y };
        pops.push({ x: at.x, y: at.y, age: 0 });
      }
      pool.splice(pool.indexOf(e), 1);
    }
  }
}

/**
 * ...and what comes out of it. `0x454690` calls the punk's own creator
 * from the first tag of the CHOPPER's death, at the CHOPPER's own position, so
 * the thing that climbs out arrives as the death reaches its second group
 * of cels ({@link Foe.hatches}).
 *
 * ...and the HEAD, as the death's first tag ends — the zombie's
 * `0x420832` and igor's `0x425629` install tag 1 and call `0x4208e0` on
 * the same frame ({@link Foe.sheds}, {@link HEAD}).
 */
function shedAndHatch(ctx: EnemyStep): void {
  const { e, foe, pool, lvl } = ctx;
  const shed = foe.sheds;
  if (shed && !e.shed && e.clock >= shed.afterCels * e.anim.hold) {
    e.shed = true;
    shedHead(e, shed.mode);
  }
  const born = foe.hatches;
  if (born && !e.hatched && e.clock >= born.afterCels * e.anim.hold) {
    e.hatched = true;
    const kid = FOES[born.kind];
    const g = celRec(lvl?.sbk, kid.gait.cels[0]);
    if (kid && g) {
      // `0x454669` — through `0x40f110`, which restarts it if it sounds
      sound?.effect(FOE_SFX.weredHatch, e.x, e.y, "renew");
      // `0x450b11`: handed a parent, the creator launches what it makes off
      // it — the parent's way at a fixed thirty, fifty up, in its own leap
      // script, which the page plays as a reaction so no brain steers the
      // flight ({@link Foe.hatches})
      const leap = born.leap;
      pool.push({
        kind: born.kind,
        x: e.x,
        y: e.y,
        facing: e.facing,
        left: e.left,
        right: e.right,
        top: e.top,
        bottom: e.bottom,
        clock: 0,
        state: leap ? "flinch" : "gait",
        anim: leap ? leap.anim : kid.gait,
        linger: 0,
        dents: 0,
        vx: leap ? leap.vx * TICK_SCALE * e.facing : 0,
        vy: leap ? leap.vy * TICK_SCALE : 0,
        hp: kid.health,
        max: kid.health,
        // `0x450add` — `AI+0x10` is the point the creator was handed, the
        // bike's own, and it is where FANG's state 6 sends it home to
        home: e.x,
      });
    }
  }
}

/**
 * ...and the BIKE goes with it. Same frame, after the rider is out: the
 * wreck is thrown forward and up as an impulse and gravity brings it
 * down, which is what tags 2 and 3 of `0x477ba0` are drawn for. See
 * {@link Foe.deathThrow}.
 */
function throwWreck(e: Enemy, foe: Foe): void {
  const thrown = foe.deathThrow;
  if (
    thrown &&
    !e.threw &&
    e.clock >= thrown.afterCels * e.anim.hold
  ) {
    e.threw = true;
    // ADDED to the ride {@link killFoe} carried over, as `0x42f8b0` adds
    // every script step, and then `0x454473`'s clamp, which runs in state
    // 5 too: at speed the bike keeps its thirty and the impulse is spent
    // on the lift
    e.vx += (thrown.dx / foe.divisor) * TICK_SCALE * e.facing;
    e.vy = (thrown.dy / foe.divisor) * TICK_SCALE;
    if (foe.speedCap !== undefined) {
      const cap = foe.speedCap * TICK_SCALE;
      e.vx = Math.max(-cap, Math.min(cap, e.vx));
    }
  }
}

/**
 * ...and a thrown wreck FLIES, which the ordinary mover below never gets
 * to do for it: the dead branch has always ended in `continue`. Same
 * arithmetic, kept here rather than hoisted, because a corpse does not
 * want the walls, the patrol rect or any of the rest of it. A body
 * still in the air keeps falling through an apex where both words
 * happen to read zero ({@link Enemy.lastBase} is only set in flight)
 *
 * ...and a body at rest still meets the mover every frame: a death
 * state that raises its floor offset (the rat's −150 at `0x44e33f`, the
 * gang's −20, the dog's −12) leaves the foot above the ground, nothing
 * snaps it (`0x42ff56` only lifts), and gravity takes it down
 */
function dropCorpse(ctx: EnemyStep): void {
  const { e, foe, lvl } = ctx;
  if (
    lvl &&
    e.vx === 0 &&
    e.vy === 0 &&
    e.lastBase === undefined &&
    !foe.floats &&
    !e.weightless &&
    foeGravity(foe) > 0
  ) {
    const b = baseOf(e, lvl);
    if (foeSurfaceUnder(e.x, b - CLIMB_PX, b + 8) === null) {
      e.vy = foeGravity(foe);
      e.lastBase = b;
    }
  }
  if (e.vx !== 0 || e.vy !== 0 || e.lastBase !== undefined) {
    e.vy += foeGravity(foe); // `0x430327` — and no cap: nothing limits obj+0xa
    e.x += e.vx;
    e.y += e.vy;
    const span = p.room ? roomSpan(p.room) : null;
    if (span) e.x = Math.max(span.lo, Math.min(span.hi, e.x));
    const base = lvl ? baseOf(e, lvl) : e.y;
    // ...from wherever the feet were last frame too: a brain that swaps
    // poses in the air (the dog's pounce and stand, whose boxes put the
    // foot 200 pixels apart) moves the base further than the fall, and the
    // sweep from the new one alone started under the floor it had crossed
    const from = Math.min(base - Math.max(e.vy, 0), e.lastBase ?? base);
    e.lastBase = base;
    // `0x42ff56`: within eight pixels of it counts as on it
    let floor = foeSurfaceUnder(e.x, from - CLIMB_PX, base + 8);
    // ...and the region's floor is solid all the way down: `0x42ff3a` reads
    // it under the point and puts anything at or below it back on top
    // (`0x42ff5b`), however far in it is. Only the platforms are one-way.
    // A pounce carried sideways into a rock face was under a floor the
    // sweep above could not see, and fell out of the level
    const ground = groundAt(e.x);
    if (ground !== null && base >= ground) floor = ground;
    if (floor !== null && base >= floor - landingWindow(e.vy)) {
      e.lastBase = undefined;
      e.y -= base - floor;
      // a body that bounces — {@link Foe.corpseBounce}: `0x42ff83` hands
      // back anything faster than 2 through `obj+0x20`, and the landing
      // sets the flag the death state plays its thud on. The speed is the
      // one it came down with: `0x430322` adds no gravity on a frame that
      // ends on the floor (`0x42ff5d` sets `di`), so a body at rest is not
      // handed its own tick of gravity back as a bounce
      const bounce = foe.corpseBounce;
      if (bounce && Math.abs((e.vy - foeGravity(foe)) / TICK_SCALE) > 2) {
        e.vy = -Math.trunc((e.vy / TICK_SCALE) * bounce.restitution) * TICK_SCALE;
        sound?.effect(bounce.sound, e.x, e.y);
      } else e.vy = 0;
      if (Math.floor(e.clock) !== Math.floor(e.clock - TICK_SCALE))
        e.vx =
          dragged(Math.round(e.vx / TICK_SCALE), foe.drag ?? DRAG) *
          TICK_SCALE;
    }
  }
}

/**
 * whatever it is doing, a thing carrying momentum flies, falls, and stops when
 * its OWN cel's box lands. This has to come before the animation states: the
 * mailbox's topple is four frames and its flight is far longer than that.
 */
function fly(ctx: EnemyStep, aloft: boolean | undefined): void {
  const { e, foe, lvl } = ctx;
  if (e.vx !== 0 || e.vy !== 0) {
    // ...and a thing with no gravity keeps whatever velocity it was given:
    // the hover below is what moves level eight's boss up and down
    if (!aloft && !e.weightless)
      e.vy += foeGravity(foe); // `0x430327` — and no cap: nothing limits obj+0xa
    e.x += e.vx;
    e.y += e.vy;
    const span = p.room ? roomSpan(p.room) : null;
    if (span) e.x = Math.max(span.lo, Math.min(span.hi, e.x));
    // ...but kragg on the wing still meets its region's floor and ceiling
    if (aloft && lvl) floaterInRegion(e, foe, lvl);
    // ...and a thing with no gravity never lands, so none of the rest applies
    if (!aloft) {
      let base = lvl ? baseOf(e, lvl) : e.y;
      /**
       * `0x42fed4`: where the region's floor at the new point stands more
       * than fifty pixels ABOVE it, that is a wall, not a floor. The move
       * is undone, `obj+0xa` zeroed and `obj+0xc` multiplied by the
       * restitution (`0x42ff02`, the allocator's 0x800 = a quarter, the
       * dog's −0.3), and the thing counts as standing for the frame. A
       * pounce into a rock face stops against it rather than landing on
       * top of it — or, before the floor below was solid, falling out of
       * the level under it.
       */
      const wall = groundAt(e.x);
      if (wall !== null && wall + 50 < base) {
        e.x -= e.vx;
        e.y -= e.vy;
        e.vy = 0;
        e.vx *= foe.restitution ?? 0.25;
        if (Math.abs(e.vx) < 0.01) e.vx = 0;
        base = lvl ? baseOf(e, lvl) : e.y;
      }
      // the surfaces the PLAYER stands on — platform tops and then the room's
      // floor — swept along the fall so a fast one cannot tunnel through a
      // ledge, plus the one an open grave lays ({@link graveLidUnder}), so a
      // foe already in the air over one is caught by it too
      // ...from wherever the feet were last frame too: a brain that swaps
      // poses in the air (the dog's pounce and stand, whose boxes put the
      // foot 200 pixels apart) moves the base further than the fall, and the
      // sweep from the new one alone started under the floor it had crossed
      const from = Math.min(base - Math.max(e.vy, 0), e.lastBase ?? base);
      e.lastBase = base;
      // `0x42ff56`: within eight pixels of it counts as on it
      let floor = foeSurfaceUnder(e.x, from - CLIMB_PX, base + 8);
      // ...and the region's floor is solid all the way down: `0x42ff3a` reads
      // it under the point and puts anything at or below it back on top
      // (`0x42ff5b`), however far in it is. Only the platforms are one-way.
      // A pounce carried sideways into a rock face was under a floor the
      // sweep above could not see, and fell out of the level
      const ground = groundAt(e.x);
      if (ground !== null && base >= ground) floor = ground;
      if (floor !== null && base >= floor - landingWindow(e.vy)) {
        e.lastBase = undefined;
        // by the CEL's box, not by where the upright one would have stood
        e.y -= base - floor;
        e.vy = 0;
        // and on the ground the allocator's drag takes 70% a frame off it
        // ({@link dragged}) — once a frame, on the frame's whole pixels
        if (Math.floor(e.clock) !== Math.floor(e.clock - TICK_SCALE))
          e.vx =
            dragged(Math.round(e.vx / TICK_SCALE), foe.drag ?? DRAG) *
            TICK_SCALE;
      }
    }
  }
}

/** the end of a reaction, in all its forms; true when the thing is done for the frame */
function endFlinch(ctx: EnemyStep, cut: FoeAnim | undefined): boolean {
  const { e, foe, run, pool } = ctx;
  // a terminal flinch holds its last cel for good — the toppled mailbox
  if (e.state === "flinch" && e.anim.terminal && e.clock >= run) {
    e.clock = run;
    return true;
  }
  // a two-script state hands to its second half at its own rate — the boss's
  // knockdown into its get-up, {@link FoeAnim.next}
  if (e.state === "flinch" && e.anim.next && e.clock >= run) {
    e.anim = e.anim.next;
    e.clock = 0;
    return true;
  }
  /**
   * ...and a reaction that is FATAL hands to the death when it ends.
   *
   * `0x4526ef` is the shape: the five frames of werec's state 3 run out, it
   * squeals, clears the bar and installs `0x477a78` — the death — rather
   * than going back to standing. So `fatal` does not mean "play this as the
   * death", it means "and then die", which is why the burn animation and
   * {@link Foe.death} are two different things.
   */
  if (
    e.state === "flinch" &&
    foe.burns?.fatal &&
    e.anim === foe.burns.anim &&
    e.clock >= run &&
    foe.death
  ) {
    killFoe(e, foe);
    // ...with the corpse time this death writes, where it has its own
    // (`0x452731`, {@link Foe.burns})
    if (foe.burns.linger !== undefined) e.linger = foe.burns.linger;
    return true;
  }
  // ...and a reaction that hands its class's machine a state of its own
  // rather than the gait — the punk's get-up ending on the taunt,
  // `0x44ee90`, and see {@link FoeAnim.resume}
  const resume = e.state === "flinch" && (cut ?? (e.clock >= run && e.anim.resume));
  if (resume) {
    e.state = "gait";
    e.swing = false;
    install(e, resume);
    e.clock = 0;
    return true;
  }
  /**
   * ...or a reaction that is itself a state of the machine, whose case
   * decides the moment the script ends ({@link FoeAnim.decides}): the brain
   * is handed the reaction's own kind with the script finished, and runs on
   * this same frame — the frame `obj+0x46` is set and the think installs
   * what follows.
   */
  if (e.state === "flinch" && e.clock >= run && e.anim.decides) {
    e.state = "gait";
    e.swing = false;
    e.script = e.anim.kind;
    e.tag = e.anim.tag;
    stepFight(e, foe, run);
    return true;
  }
  if (e.state === "flinch" && e.clock >= run) {
    // out of stages: the LAST stage's frame ending is what bursts a hydrant, and
    // what bursts is a second object of the same class beside it — `0x44fb20`
    // spawns one on the water tag 25px to its facing side and puts this one
    // straight back on tag 0, whole, to be turned open all over again
    if (foe.burst && foe.flinch && e.dents >= foe.flinch.length) {
      // `0x44fb94`, on the frame the water is created
      if (foe.burst.sound !== undefined)
        sound?.effect(foe.burst.sound, e.x, e.y);
      pool.push({
        ...e,
        state: "burst",
        anim: foe.burst.anim,
        clock: 0,
        x: e.x + foe.burst.dx * (e.facing > 0 ? 1 : -1),
        dents: 0,
        vx: 0,
        vy: 0,
      });
      e.dents = 0;
    }
    e.state = "gait";
    // a blow ends whatever it was swinging
    e.swing = false;
    // `0x456058`: the boss's flinch hands back into the combat loop rather than
    // to standing — it is still in the fight
    e.anim = foe.drives && e.mode ? foe.drives.hover : foe.gait;
    if (foe.drives && e.mode) e.mode = "hover";
    // ...and a class with a machine of its own is put IN the state that
    // script belongs to, not left in the one the blow interrupted: every
    // hit handler installs its reaction through `0x45d090`, which writes the
    // script's kind into `obj+0x18`, so what the think dispatches on after
    // it is the reaction's own chain. A class whose chain goes somewhere
    // other than its gait says so with {@link FoeAnim.resume}, above
    install(e, e.anim);
    e.clock = 0;
  }
  return false;
}

/**
 * ...and a lever of its own, which is the whole of level six.
 *
 * `0x438200` is the finder: the first object of the switch class whose
 * position is inside this thing's own record rect **and whose tag is 3**, an
 * unlit one. With one in hand the class turns to face it and walks — on the
 * same six cels it patrols with, because the kind-6 script's tag 0 IS the
 * walk — and inside `0x25` pixels stops and plays tag 1, the reach. One
 * named frame of the reach calls `0x436820(lever, 0)`.
 *
 * SERVICE lays this out so that every one of its six levers is inside
 * somebody's territory, which is why a level that starts dry does not stay
 * dry, and why turning them off is a job rather than a one-off.
 */
function seekLever(ctx: EnemyStep): boolean {
  const { e, foe, run } = ctx;
  const aim =
    foe.lever && (e.state === "gait" || e.state === "lever") && !e.asleep
      ? leverFor(e, foe.lever.dir)
      : null;
  // the frame one is FOUND — the batboy's `0x4392a4` turns to it, says
  // `0x4392d7` through `0x40f090` and puts the lever script on, once
  if (aim && e.aimed !== aim && foe.lever?.found !== undefined)
    sound?.effect(foe.lever.found, e.x, e.y, "lead");
  e.aimed = aim ?? undefined;
  if (e.state === "lever") {
    const L = foe.lever!;
    // ...and once it has thrown, the lever it threw is no longer the kind it
    // looks for, so the reach plays out on its own: `0x43f769` waits for the
    // script to end before the stand
    if (!aim && !e.thrown) {
      e.state = "gait";
      e.anim = foe.gait;
      e.clock = 0;
    } else {
      if (aim && !e.thrown && e.clock >= L.at * L.anim.hold) {
        e.thrown = true;
        // `0x43a191`: one roll in three, and then one of two takes
        if (L.sound.length && roll(3) === 1) {
          const which = L.sound[roll(L.sound.length) - 1];
          sound?.effect(which, e.x, e.y);
        }
        throwSwitch(aim, foe.lever!.dir);
      }
      if (e.clock >= run) {
        e.state = "gait";
        e.anim = foe.gait;
        e.clock = 0;
        e.thrown = false;
      }
      return true;
    }
  } else if (aim) {
    e.facing = aim.x > e.x ? 1 : -1;
    const L = foe.lever!;
    // a class with a run of its own goes to the lever on it — the ox's
    // `0x472ff0` tag 0 at dx 280 (`0x43f388`) — and the rest walk
    if (L.run && e.anim !== L.run) {
      e.anim = L.run;
      e.clock = 0;
    }
    if (
      Math.abs(aim.x - e.x) < L.reachPx &&
      (L.reachY === undefined || Math.abs(aim.y - e.y) < L.reachY)
    ) {
      e.state = "lever";
      e.anim = foe.lever!.anim;
      e.clock = 0;
      e.thrown = false;
      return true;
    }
  }
  return false;
}

/**
 * The stride is a SETTLED velocity, not the script's number.
 *
 * `0x42f8b0` ends `idiv cx` with `add word ptr [esp+6], ax` — the script's
 * `dx` over the divisor is an impulse ADDED to whatever velocity the object
 * already has, every frame, and `0x4302c0` takes `v * obj+0x1e >> 13` back
 * off on every frame that ended on the ground. So a walk is not its `dx`:
 * it accelerates until the drag balances the impulse, which is the same
 * arithmetic {@link DRAG} already describes for the player ("each frame adds
 * 8 and the ground keeps 30%, and that settles at 12").
 *
 * Assigning `dx / divisor` instead — which this did — gave every class its
 * impulse as a top speed, about 1.4x slow for the thirty that use the
 * allocator's drag and **twenty times** slow for the one that does not. The
 * CHOPPER settled at 142px a second, slower than the player walks; its own
 * drag of 409 ({@link Foe.drag}) puts it where a motorcycle belongs.
 *
 * The move itself is still positional — the wall, the step and the pin below
 * all read the place it is going — so this changes the speed and nothing
 * about how a foe negotiates ground.
 */
function settleStride(e: Enemy, foe: Foe): number {
  const i =
    e.state === "gait" && !e.swing
      ? loopIndex(e.anim, e.clock)
      : Math.min(e.anim.cels.length - 1, Math.floor(e.clock / e.anim.hold));
  const onFrame = Math.floor(e.clock) !== Math.floor(e.clock - TICK_SCALE);
  // it only builds speed on the frames it is actually walking. Off its feet or
  // rooted in a fight it keeps none, so nothing it could not spend is waiting
  // to be spent the moment it lands.
  const rolling = e.vx === 0 && (e.vy === 0 || foe.floats);
  if (onFrame) {
    e.speed = rolling
      ? dragged(e.speed ?? 0, foe.drag ?? DRAG) +
        roundAway((e.anim.dx?.[i] ?? 0) / (e.divisor ?? foe.divisor))
      : 0;
    // ...and its own think has the last word on how fast it may go
    const cap = foe.speedCap;
    if (cap !== undefined) e.speed = Math.max(-cap, Math.min(cap, e.speed));
  }
  // ...and whether what the body pass takes off `obj+0xc` goes into its
  // walk or its flight — see {@link bodyPush}, in the frame's {@link hitPass}
  if (onFrame) e.rolling = rolling && !foe.floats;
  /**
   * ...and a FLOATER is not dragged, because the drag is the ground's.
   *
   * `0x4302c0` sits behind `0x4302a4`, which skips it in the air — the same
   * test that lets the player's jump coast. A class built with
   * `0x42f850(obj, 0)` and `obj+0x30 = 0` is never on the ground and so never
   * meets it, and a velocity that only ever accumulates would run away. The
   * things that fly are steered by their own think function instead (the
   * probe's `0x410486` clamps `obj+0xc` to ±27 by hand), which this page has
   * never modelled through the stride. So they keep the stride they had.
   */
  let step: number;
  if (!foe.floats) step = (e.speed ?? 0) * TICK_SCALE;
  else if (foe.accrues) step = 0;
  else step = ((e.anim.dx?.[i] ?? 0) / (e.divisor ?? foe.divisor)) * TICK_SCALE;
  // ...except a floater whose own think holds the velocity down, which gets
  // the engine's reading: `0x45d1a3` adds the frame's `dx / divisor`, rounded
  // away from zero, into `obj+0xc` on every frame it shows, with no drag in
  // the air — see {@link Foe.accrues}
  if (foe.floats && foe.accrues && onFrame && e.state === "gait") {
    const dx = e.anim.dx?.[i] ?? 0;
    if (dx !== 0)
      e.vx += roundAway(dx / (e.divisor ?? foe.divisor)) * TICK_SCALE * e.facing;
  }
  /**
   * A leap is an IMPULSE, not an offset.
   *
   * `0x477368 tag 0` carries `dy -480` on the frame cel 1942 shows, and the
   * engine spends a number like that the way it spends the player's own jump:
   * `0x42f8b0` rounds `dy / divisor` away from zero and writes it into
   * `obj+0xa`, ONCE, on the frame it appears. Gravity takes it from there.
   *
   * Adding it straight to `e.y` instead moves the thing ninety-six pixels in
   * four frames with no velocity to show for it, so the landing test never
   * sees a fall: `foeSurfaceUnder` reaches {@link CLIMB_PX} below the feet and
   * no further, finds nothing, and WOODS' CHOPPER goes nine thousand pixels
   * out of the level still swinging. As velocity it uses the
   * flight path every knocked-back thing already uses, sweeping the surfaces
   * along the way down, and it lands.
   *
   * The frame's own `dx` goes with it — a leap that rises and does not travel
   * is not what tag 0 says — and the stride block below then leaves it alone,
   * because that only runs on a thing with no velocity.
   */
  const lift = e.anim.dy?.[i] ?? 0;
  /**
   * ...and it is ADDED, on every frame the cel shows, not set once.
   *
   * `0x45d1a3` calls `0x42f8b0` for the current frame on every engine frame,
   * and that adds `dy / divisor` (and `dx / divisor`), rounded away from
   * zero, into the velocity; a cel held two frames pushes twice. Gravity
   * comes after the move and only in the air (`0x430322`), so a lift that
   * keeps pushing keeps rising: the dog's pounce, −80 −80 −160 −160 −80 −80
   * −80 −80 over its divisor of ten against a gravity of ten, climbs about
   * ninety-six pixels, where setting its first −8 once climbed four.
   */
  if (lift !== 0 && onFrame && !foe.floats) {
    // leaving the ground, it takes its walk with it...
    if (e.vy === 0 && e.vx === 0) e.vx = (step || 0) * e.facing;
    // ...and in the air the frame's own dx is pushed in with the lift
    else if (e.anim.dx?.[i])
      e.vx += roundAway(e.anim.dx[i] / (e.divisor ?? foe.divisor)) * TICK_SCALE * e.facing;
    e.vy += roundAway(lift / (e.divisor ?? foe.divisor)) * TICK_SCALE;
  }
  return step;
}

/**
 * ...and a class with a machine of its own is never pinned ({@link still}).
 *
 * {@link travels} reads {@link Foe.gait}, and `gait` is picked per class by
 * eye: for `initwerea`, `inittube`, `inithardcore`, `initarm`, `initslurp`
 * and `initknotboy` it is a standing, gesturing or lever script that carries
 * no stride, so pinned by it those classes would read as rooted and lose
 * every `dx`. A brain installs the script the executable installs, by kind,
 * so it does not need the guess.
 * A floater's own hover keeps `vy` busy for ever, and its script's stride
 * has to travel anyway.
 *
 * And a NEGATIVE stride is a stride: `0x4771a0 tag 0` is the punk walking
 * backwards at -225, and every class that gives ground has one.
 *
 * ...and the walk is SWEPT, because a stride can be longer than a wall.
 *
 * Every test in this block — the climbable step, the patrol edge, the pin
 * that follows — reads the one place the move ends at, and a stride is a
 * settled velocity, not a dozen pixels under {@link CLIMB_PX}: the CHOPPER
 * at two hundred pixels an engine frame steps clean over WOODS' ledges,
 * finds nothing under the far side and falls out of the level.
 *
 * So the move is cut into pieces no longer than the wall it has to notice,
 * and each piece is tested and pinned on its own. Same arithmetic, sampled
 * often enough to mean what it says.
 */
function walkSwept(ctx: EnemyStep, step: number): void {
  const { e, foe, lvl } = ctx;
  const SWEEP_PX = CLIMB_PX;
  if (step !== 0 && e.vx === 0 && (e.vy === 0 || foe.floats)) {
    const total = step * e.facing;
    const parts = Math.max(1, Math.ceil(Math.abs(total) / SWEEP_PX));
    for (let part = 0; part < parts; part++) {
      const nx = e.x + total / parts;
      /**
       * ...unless the ground there stands too high to climb, in which case the
       * whole move is thrown away.
       *
       * This is `0x42fef3` — the body stepper's own wall, {@link CLIMB_PX} — and
       * everything the stepper does applies to every object, not just the player.
       * Without it a foe that walks into a rise it cannot climb is left standing
       * where no floor is within reach of its feet, and the pin below then reads
       * that as thin air and drops it: WOODS' ground steps up 85 pixels in ONE
       * column at x10230, and the werewolf patrolling east of it fell through the
       * world every time it walked west into that step.
       */
      const baseNow = lvl ? footOf(e, lvl, foe) : e.y;
      const ground = groundAt(nx);
      const reach = foeSurfaceUnder(nx, baseNow - CLIMB_PX, baseNow + STICK_PX);
      // a floater has no feet to catch on a step
      const blocked =
        !foe.floats &&
        ground !== null &&
        ground < baseNow - CLIMB_PX &&
        reach === null;
      /**
       * ...and nothing turns it at the edge of its rect, nor holds it there.
       *
       * The rect is the alarm, not a territory: every class runs a machine of
       * its own, the stepper `0x42fd80` has no rect turn and clamps at no rect,
       * and the rat's run `0x44e226` goes where it goes. Level eight's boss has
       * a **twenty-pixel box** at x1373, and turning it round at the edges of
       * that pinned it there for ever. The room is the only bound.
       */
      if (!blocked) {
        const span = p.room ? roomSpan(p.room) : null;
        e.x = span ? Math.max(span.lo, Math.min(span.hi, nx)) : nx;
      } else break; // it walked into a step it cannot climb: the rest is thrown away
      // ...and it is pinned HERE, not at the end of the whole stride, so it
      // meets a ledge where the ledge is and steps off it rather than over it
      if (parts > 1 && !foe.floats && e.vx === 0 && e.vy === 0) {
        const b = lvl ? footOf(e, lvl, foe) : e.y;
        const under = foeSurfaceUnder(e.x, b - CLIMB_PX, b + STICK_PX);
        if (under !== null) e.y += under - b;
        else {
          stepOff(e, foe);
          break;
        }
      }
    }
  }
}

/**
 * They stand on the same surfaces the player does, not on `groundAt(e.x)`
 * alone, the ROOM's floor: CITY's floor is a ledge to x691 and then y7250,
 * so on it every one of its eight foes would be pinned 3300 pixels under the
 * level on the first frame, its kill quota unmeetable and its goal
 * unreachable.
 *
 * A platform top counts, the floor counts, and finding neither within a step
 * means there is nothing underfoot — so it falls, rather than teleporting to
 * whatever the region says.
 *
 * ...and a thing with no gravity stands on nothing: it keeps the height its
 * record's point gave it ({@link Foe.floats})
 */
function standOnSurface(ctx: EnemyStep, aloft: boolean | undefined): void {
  const { e, foe, lvl } = ctx;
  if (e.vx === 0 && e.vy === 0 && !aloft && !e.weightless) {
    const base = lvl ? footOf(e, lvl, foe) : e.y;
    const s = foeSurfaceUnder(e.x, base - CLIMB_PX, base + STICK_PX);
    if (s !== null) e.y += s - base;
    else stepOff(e, foe);
  }
}

/**
 * A walker off the end of its ground, into the fall — and it keeps its walk.
 *
 * The engine has one `obj+0xc` and nothing on the way off a ledge touches it:
 * the mover finds no floor, gravity starts on `obj+0xa` (`0x430322`), and the
 * drag that would have taken the speed is the ground's and is skipped in the
 * air (`0x4302a4`). This page keeps a walker's speed in {@link Enemy.speed},
 * which is zeroed off its feet, so it goes into `e.vx` here. Dropping it left
 * every fall straight down — and a charging dog's jam test (`0x454f53`), which
 * reads "no speed along my facing" as a wall, turned it round on every frame
 * of the drop.
 */
function stepOff(e: Enemy, foe: Foe): void {
  e.vy = foeGravity(foe);
  if (e.vx === 0 && e.speed) e.vx = e.speed * TICK_SCALE * e.facing;
  e.speed = 0;
}

/**
 * One spawned thing, feet on the ground, flipped by its facing.
 *
 * A creature's art is drawn facing EAST and mirrored to face west, which is the
 * same way round as the player (`mirror: p.facing < 0`, where the player is
 * composed). A thing pacing its own territory looks equally plausible either
 * way round; one closing on you with its back turned does not.
 *
 * {@link hurtBox} mirrors on the same test, because a box that does not follow
 * the art is a box in the wrong place.
 */
/**
 * Each level's creature passes, in the order its frame function makes them,
 * with `"player"` where `0x402980` draws the player between them.
 *
 * Every level frame function paints one class at a time (`0x430f70` walks one
 * class's list, or a class's own collector walks it with a layer word), and
 * the player is one call in the middle of that list — so which creatures stand
 * IN FRONT of him is per level: STREETS' hydrants, MAZE's cops but BARREL's
 * behind him. A `[kind, layer]` pair is a collector that draws only the ones
 * whose layer word equals its argument ({@link enemyLayer}). Only creature
 * classes are listed; the level's other classes are drawn elsewhere.
 *
 * ```
 *   STREETS  0x44dc10  0x44df10(0) 0x44fd10 0x44e480 0x44f2d0 | 0x44df10(1) 0x44fa30
 *   CITY     0x4515d0  0x44e480 0x44f2d0 0x4522e0 |
 *   WOODS    0x453fd0  0x454ab0(0) 0x454300 0x44e480 0x44f2d0 0x4522e0 | 0x454ab0(1)
 *   PLAYGR   0x455260  0x454ab0(0) | 0x455850 0x454ab0(1)
 *   MAZE     0x412c30  | 0x4149d0 0x413ed0
 *   BARREL   0x4164f0  0x413ed0 |
 *   LAB      0x417b40  0x418690(0) 0x417df0 | 0x4191f0 0x418690(1)
 *   GRAVE    0x41f950  | 0x420230
 *   CAVERN   0x421ed0  0x423390(0) | 0x423390(1) 0x4225c0 0x420230 0x422de0
 *   RAVECAVE 0x424220  0x425150 | 0x4246f0 0x422de0
 *   TOWER    0x425840  0x423390(0) | 0x423390(1) 0x4225c0 0x422de0 0x425b60
 *   MALL     0x436f50  0x43b4d0 | 0x438660 0x437a20 0x439140 0x439ba0
 *   SERVICE  0x43bec0  | 0x437a20 0x438660 0x439ba0 0x439140 0x43cb80
 *   SEWER    0x43d370  | 0x43dcd0 0x43f1b0
 *   ARCADE   0x440560  | 0x442040
 * ```
 *
 * VAT (`0x419b20`) draws no creature class.
 */
export type EnemyPass = string | readonly [string, 0 | 1];
export const ENEMY_PASSES: Readonly<Record<string, readonly EnemyPass[]>> = {
  STREETS: [["initrat", 0], "initmailbox", "initwerea", "initwereb", "player", ["initrat", 1], "inithydrant"],
  CITY: ["initwerea", "initwereb", "initwerec", "player"],
  WOODS: [["initdog", 0], "initwered", "initwerea", "initwereb", "initwerec", "player", ["initdog", 1]],
  PLAYGR: [["initdog", 0], "player", "initwbooly", ["initdog", 1]],
  MAZE: ["player", "initslurp", "initcop"],
  BARREL: ["initcop", "player"],
  LAB: [["initarm", 0], "initpuke", "player", "inittube", ["initarm", 1]],
  GRAVE: ["player", "initzomb"],
  CAVERN: [["initskel", 0], "player", ["initskel", 1], "initghengis", "initzomb", "initbat"],
  RAVECAVE: ["initigor", "player", "initwraith", "initbat"],
  TOWER: [["initskel", 0], "player", ["initskel", 1], "initghengis", "initbat", "initvpriest"],
  MALL: ["initcoke", "player", "initmaskboy", "initknotboy", "initbatboy", "initknifeboy"],
  SERVICE: ["player", "initknotboy", "initmaskboy", "initknifeboy", "initbatboy", "inithardcore"],
  SEWER: ["player", "initeyeball", "initox"],
  ARCADE: ["player", "initkragg"],
};

/**
 * The layer word a two-pass collector compares with its argument.
 *
 * - rat, `0x44df10`: `AI+4`, set to 1 as it comes out of its hole (`0x44e137`)
 * - dog, `0x454ab0`: `AI+4`, the flag its lunges raise and `0x454fc2` drops
 * - skeleton, `0x423390`: `AI+0xa`, 1 from its creator (`0x41edec`) until the
 *   corpse state zeroes it (`0x4239f9`)
 * - arm, `0x418690`: pass 0 takes the ones whose `AI+0x2a` (the record param)
 *   is still set — in the wall — and pass 1 the rest; `0x418877` clears it as
 *   the arm breaks out, which is where its shove weight stops being 0
 */
export function enemyLayer(e: Enemy): 0 | 1 {
  switch (e.kind) {
    case "initrat":
    case "initdog":
      return e.decisions ? 1 : 0;
    case "initskel":
      return e.state === "dead" ? 0 : 1;
    case "initarm":
      return e.shove === 0 ? 0 : 1;
    default:
      return 0;
  }
}

/**
 * The spawned things of this room in `ENEMY_PASSES` order, split at the
 * player. A kind the level's list does not name is drawn last before him.
 */
export function enemyPasses(): { before: Enemy[]; after: Enemy[] } {
  const all = spawnedHere();
  const list = level ? ENEMY_PASSES[level.name.toUpperCase()] : undefined;
  if (!list) return { before: [...all], after: [] };
  const split = list.indexOf("player");
  const slot = (e: Enemy): number => {
    const i = list.findIndex(
      (q) =>
        q !== "player" &&
        (typeof q === "string" ? q === e.kind : q[0] === e.kind && q[1] === enemyLayer(e)),
    );
    return i < 0 ? split - 0.5 : i;
  };
  const ranked = all
    .map((e, i) => ({ e, i, k: slot(e) }))
    .sort((a, b) => a.k - b.k || a.i - b.i);
  return {
    before: ranked.filter((r) => r.k < split).map((r) => r.e),
    after: ranked.filter((r) => r.k > split).map((r) => r.e),
  };
}
