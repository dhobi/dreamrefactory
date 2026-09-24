/**
 * KRAGG — `initkragg`, `0x440ab0`, what chapter two ends on, and the only class
 * in the game that is two creatures wearing one object.
 *
 * ## It is a singleton, and its "AI struct" is a row of globals
 *
 * Every other class in this folder is handed an instance struct as the think
 * function's second argument. This one is not. `0x441bd0` builds the object
 * ONCE, at level load, and parks the pointer in `[0x4a6ff8]`; `0x440ab0` reads
 * that global rather than its own `obj` argument on every single line. What the
 * punk keeps in `AI+0`..`AI+0x14` this class keeps in fixed addresses:
 *
 * ```
 *   [0x4a6ff8]  the object itself
 *   [0x4a75c8]  its health — `0x40e300(0x3e8)`, seeded at `0x441c5b`
 *   [0x4a75d0]  the tracker context `0x45ef70` filled in at `0x441ce3`
 *   [0x4a7574]  the X the GROUND form is pinned to, once it has landed
 *   [0x473dd0]  which way the hover is going, ±1            (init 1)
 *   [0x473dd4]  the vertical speed it may not go below      (init -5)
 *   [0x473dd8]  ...and may not go above                     (init 5)
 *   [0x473ddc]  how far below itself it wants the player    (35)
 *   [0x473de0]  how many times the fall loops its first tag (4)
 *   [0x473de4]  blows landed on the ground form since the last stagger
 * ```
 *
 * Which is why `initkragg`'s "creator" creates nothing. `0x436180` writes the
 * record's point into `obj+6`, clears `obj+0x10` (the floor offset), looks the
 * room up with `0x40b940` into `obj+0x16` and installs `0x473840` — the one-cel
 * idle — and that is the whole of it. The level spawner calls it once because
 * there is only ever one thing to call it for. *(Re-checked here against
 * `0x436180`: confirmed, it takes `[0x4a6ff8]` and never allocates.)*
 *
 * Because the state lives in globals rather than per-instance, the two hover
 * limits below are module-level `let`s. That is not a shortcut — it is exactly
 * the storage the disc uses, and it is only sound because there is exactly one
 * kragg.
 *
 * ## Its sixteen states
 *
 * `0x440cb3` does `dec eax` before `jmp [eax*4 + 0x441a9c]`, so the table is
 * indexed by **kind − 1** and the states are numbered **1 to 16**, not 0 to 15.
 * Fifteen scripts carry those kinds, laid out end to end from `0x473840` to
 * `0x473dc8`; there is no kind 4 at all and entry 3 of the table is the common
 * epilogue, so state 4 is a hole.
 *
 * ```
 *   kind  script               what it is
 *    1    0x473840  0x440cc4   the hover — one cel, and the state that DECIDES
 *    2    0x473850  0x440ed3   tag 0 closes on him, tag 1 stops dead
 *    3    0x473870  0x440f90   the air turn, and it sinks 30px doing it
 *    4    —         —          no script; the table's entry is the epilogue
 *    5    0x473900  0x440fbe   the maul: tag 0 homes, tag 1 lands it, LOOPS
 *    6    0x4738a8  0x4410a3   the air volley — three shots, then it commits
 *    7    0x473a28  0x4411e6   the flinches, and 0x473a48 is the heavy one
 *    8    0x473950  0x441250   the dive, and tags 2/3 are the GRAB
 *    9    0x473a88  0x441509   what the FLARE does to it — see below
 *   10    0x473b60  0x441615   shot out of the sky, and what it gets up as
 *   11    0x473ba8  0x4417a8   tag 0 the rise; tags 1/2 the ground flinches
 *   12    0x473bc8  0x4417cd   the ground idle, and the ground's DECIDING state
 *   13    0x473bd8  0x44185f   the ground turn
 *   14    0x473c80  0x4418d4   the ground volley — three shots, then it swings
 *   15    0x473cc8  0x4419d9   the two ground swings
 *   16    0x473d38  0x4419fe   the death that sticks
 * ```
 *
 * ## The phase line is drawn at eleven
 *
 * `0x440b1c` tests `obj+0x18` against 11 before anything else happens:
 *
 * - **states 1…10** — the FLYING form. Shove weight 40 (`obj+0x26`), floor
 *   offset 0 (`obj+0x10`), strength 100 (`obj+0x1a`), and the inertia divisor
 *   `obj+0xe` stays at the 50 `0x441c1a` gave it.
 * - **states 11…16** — the GROUND form. Shove weight 100, floor offset −15,
 *   divisor 200, `obj+0xc` forced to zero and **`obj+8` snapped back to
 *   `[0x4a7574]` every frame** — the ground form cannot move sideways at all,
 *   which is why state 12's outermost band does nothing.
 *
 * And the crossing is state 10. `0x441e4a` (health gone) and `0x440c5d` (drowned
 * in its own sprinkler) both install `0x473b60`, the fall; the fall bounces it
 * on real gravity; and when it settles, `0x441741` remembers where it landed,
 * `0x441787` **puts its health back to `0x40e300(0x3e8)` in full** and it stands
 * up as kind 11. Killing kragg means killing it twice.
 *
 * ## The flare, and the sprinklers
 *
 * `0x441d30` — asked before any damage is computed, once the hit handler
 * `0x441cf0` has skipped kragg's own shots, a strength of 0 and states 9 and up
 * (which go to `0x441ef0`) — is whether the striking cel's strength is exactly
 * **−9**. That
 * is `statflare`, which level eight places a `statflaregun` for. A −9 hit costs
 * kragg nothing: it plays sound `0x13`, throws a spark, installs `0x473a88` and
 * returns. `0x473a88` is state 9, and state 9 is the whole tactic of the level:
 * `0x441509` drags it toward the nearest `initsprinkler` record (120px below the
 * record's point) with `0x42f8b0` while it thrashes through five tags, and on
 * each of tags 1…4 `0x4415af`/`0x4415bd` asks which sprinkler rect it is
 * standing in and **sends that one up**.
 *
 * Then the prologue collects: `0x440b99` runs `0x441b20` every frame it is in
 * states 1…9, and if the sprinkler it is over is already lit it throws two
 * sparks, plays sound `0x14` and takes **three health a frame** (`0x440bf9`).
 * Standing in the water is what kills the flying form.
 *
 * See {@link NOT_HERE} for what of that is the page's and not this module's.
 */
import {
  install,
  rewind,
  type Brain,
  type BrainCtx,
  type CastKit,
  type Enemy,
  type Reaction,
  TICK_SCALE,
} from "./kit";
import type { Foe } from "../foes";

/**
 * The states a brain is never called during, and what the page does for each.
 *
 * - **7**, the flinches (`0x4411e6`). `0x441ea4` sorts a blow by `0x2d`: under
 *   it, one of the three single cels of `0x473a28` at `0x434540(3) - 1`; at or
 *   over it, the six-cel `0x473a48` tag 3. A blow landed while the dive is
 *   running (`obj+0x18 == 8`) takes tag **4** under the threshold and tag 3
 *   over it. Tags 0…3 hand back to the idle; tag 4 hands to `0x473950` tag 1,
 *   so a light blow mid-dive drops it into the dive's recovery. All five are
 *   kind 7 in {@link Foe.flinch}, so a second blow reads state 7.
 * - **9**, the flare thrash (`0x441509`), installed only from `0x441d8f`, only
 *   by a −9 blow, only while `obj+0x18 < 9` — the one thing in the executable
 *   that raises a sprinkler. {@link kraggReacts}.
 * - **10**, the fall (`0x441615`): its tag 0 and the laps are the brain's
 *   state 10 below. What stays the page's is the landing — tag 1 waits for
 *   `obj+0x30` and `obj+0x2e`, then pins `[0x4a7574]` to where it actually
 *   landed, plays sound `0x18`, **restores its health to `0x40e300(0x3e8)`**
 *   and installs kind 11 — which {@link Foe.rallies} runs.
 * - **11 tags 0..2**, the ground takes. `0x441fa3` picks one of the three
 *   cels of `0x473ba8` at `0x434540(3) - 1` — the page's {@link Foe.pick} —
 *   and state 11 (`0x4417a8`) stands it on kind 12 as each ends, which is
 *   the flinch's `resume`. A blow during one is taken by nothing
 *   (`0x441ef4`; {@link kraggGate}).
 * - **16**, the death that sticks (`0x4419fe`). `0x42f870(obj, 0)` takes it out
 *   of the census, floor offset −25, and the end of tag 0 or 1 hands to tag 2
 *   while playing sound `0x1b` and calling `0x4423a0(point, 0xf)` — fifteen
 *   roaches, each on its own arc. {@link kraggReacts}.
 *
 * The ground form's hit handler is its own machine. `0x441ef0`: states 9, 10
 * and 11 take **no hits at all**; from state 12 up a blow with a negative
 * strength is worth a flat `0x46` and anything else is `0x42f910`'s own
 * figure; `[0x473de4]` counts them, three give a take, and every FOURTH one
 * either spins it round (`0x473bd8` tags 2/3) if the player has got behind it
 * or makes it swing back (`0x473cc8` tag 1). The gate is {@link kraggGate}, the
 * count and what it picks {@link Foe.pick}.
 */
const NOT_HERE = "0x4411e6, 0x441509, 0x441615, 0x4417a8, 0x4419fe" as const;

/**
 * Every script the class owns, read out of `0x473840`…`0x473d38`.
 *
 * None of them travel except `0x473850` tag 0 and the two carries: this thing
 * moves by its own velocity, not by its animation's stride, which is what the
 * `0x42f8b0` calls below are for.
 */
export const KRAGG = {
  /** kind 1 — the hover. One cel, five ticks, and it decides every frame */
  idle: { cels: [7040], hold: 5, kind: 1, tag: 0, from: "0x473840 tag 0" },
  /** kind 2 tag 0 — closing, and the stride is all on the second cel */
  closeIn: {
    cels: [7041, 7042],
    hold: 2,
    dx: [0, 120],
    kind: 2,
    tag: 0,
    from: "0x473850 tag 0",
  },
  /** kind 2 tag 1 — the stop, held until the drift is spent */
  halt: { cels: [7041], hold: 2, kind: 2, tag: 1, from: "0x473850 tag 1" },
  /**
   * kind 3 — the air turn, by the mirror flag it is turning OUT of, and it
   * sinks ten pixels a cel while it does it.
   */
  turn: [
    {
      cels: [7090, 7091, 7092],
      hold: 3,
      dy: [10, 10, 10],
      kind: 3,
      tag: 0,
      from: "0x473870 tag 0",
    },
    {
      cels: [7093, 7094, 7095],
      hold: 3,
      dy: [10, 10, 10],
      kind: 3,
      tag: 1,
      from: "0x473870 tag 1",
    },
  ],
  /** kind 5 tag 0 — the homing half of the maul, and it LOOPS while it homes */
  maulIn: {
    cels: [7041, 7042, 7043],
    hold: 2,
    kind: 5,
    tag: 0,
    from: "0x473900 tag 0",
  },
  /** kind 5 tag 1 — and the blow, which hands straight back to tag 0 */
  maul: {
    cels: [7051, 7052, 7053, 7053],
    hold: 2,
    kind: 5,
    tag: 1,
    from: "0x473900 tag 1",
  },
  /**
   * kind 5 tag 2 — and **nothing in `SC.EXE` installs it**. Both `push 0x473900`
   * sites inside the machine push tag 0 (`0x440e87`, `0x44106b`, `0x4411ce`) and
   * the third pushes tag 1 (`0x441029`); cels 7054 and 7055 are unreachable. It
   * is carried here so the next reader does not go looking for a caller.
   */
  maulEnd: {
    cels: [7054, 7055],
    hold: 2,
    kind: 5,
    tag: 2,
    from: "0x473900 tag 2",
  },
  /** kind 6 — the air volley: tag 0 winds up, 1 and 2 repeat, 3 decides */
  spit: [
    {
      cels: [7080, 7081, 7082, 7083, 7084],
      hold: 3,
      kind: 6,
      tag: 0,
      from: "0x4738a8 tag 0",
    },
    { cels: [7085, 7086], hold: 3, kind: 6, tag: 1, from: "0x4738a8 tag 1" },
    { cels: [7085, 7086], hold: 3, kind: 6, tag: 2, from: "0x4738a8 tag 2" },
    { cels: [7085], hold: 3, kind: 6, tag: 3, from: "0x4738a8 tag 3" },
  ],
  /** kind 8 tag 0 — the dive, homed at him every frame it is not in range */
  dive: {
    cels: [7040, 7041, 7042, 7043, 7044],
    hold: 2,
    kind: 8,
    tag: 0,
    from: "0x473950 tag 0",
  },
  /** kind 8 tag 1 — one cel: the dive's own recovery, and it homes too */
  divePull: {
    cels: [7045],
    hold: 2,
    kind: 8,
    tag: 1,
    from: "0x473950 tag 1",
  },
  /**
   * kind 8 tags 2 and 3 — the GRAB, eight cels of `dy -25` carrying him up.
   *
   * `0x441306` picks between them on `[0x46b1a8]`, which `0x402fa0` also reads:
   * it is which of the two playable characters is in the level, so 7046 is one
   * of them in kragg's fist and 7047 is the other. This port has the character
   * `[0x46b1a8] == 0` selects, which is the tag-3 one.
   */
  carry: [
    {
      cels: [7046, 7046, 7046, 7046, 7046, 7046, 7046, 7046],
      hold: 2,
      dy: [-25, -25, -25, -25, -25, -25, -25, -25],
      kind: 8,
      tag: 2,
      from: "0x473950 tag 2",
    },
    {
      cels: [7047, 7047, 7047, 7047, 7047, 7047, 7047, 7047],
      hold: 2,
      dy: [-25, -25, -25, -25, -25, -25, -25, -25],
      kind: 8,
      tag: 3,
      from: "0x473950 tag 3",
    },
  ],
  /**
   * kind 11 tag 0 — the rise, one cel.
   *
   * The same script's tags 1 and 2 (cels 7105, 7106) are the ground flinches and
   * belong to the page — see {@link NOT_HERE}.
   */
  rise: { cels: [7104], hold: 3, kind: 11, tag: 0, from: "0x473ba8 tag 0" },
  /**
   * kind 10 tag 1 — the second half of the fall, `0x473b60` tag 1: the last cel
   * of the drop four times over, and the first two lift 150. Tag 0 is the page's
   * {@link Foe.rallies} `fall`, which the blow that empties the bar installs.
   */
  fallLand: {
    cels: [7036, 7036, 7036, 7036],
    hold: 1,
    dy: [-150, -150, 0, 0],
    kind: 10,
    tag: 1,
    from: "0x473b60 tag 1",
  },
  /** kind 12 — the ground idle. One cel, ONE tick, and it decides every frame */
  stand: { cels: [7100], hold: 1, kind: 12, tag: 0, from: "0x473bc8 tag 0" },
  /**
   * kind 13 — the ground turn, four ticks a cel.
   *
   * Tags 0 and 1 are the long one the idle installs, by the mirror flag it is
   * turning out of; tags 2 and 3 are the two-cel snap the hit handler installs
   * (`0x441fef`) when a fourth blow lands from behind.
   */
  groundTurn: [
    {
      cels: [7100, 7100, 7100, 7100, 7101, 7101, 7101, 7102],
      hold: 4,
      kind: 13,
      tag: 0,
      from: "0x473bd8 tag 0",
    },
    {
      cels: [7100, 7100, 7100, 7100, 7103, 7103, 7103, 7102],
      hold: 4,
      kind: 13,
      tag: 1,
      from: "0x473bd8 tag 1",
    },
    { cels: [7101, 7102], hold: 4, kind: 13, tag: 2, from: "0x473bd8 tag 2" },
    { cels: [7103, 7102], hold: 4, kind: 13, tag: 3, from: "0x473bd8 tag 3" },
  ],
  /** kind 14 — the ground volley, the same shape as the air one */
  lob: [
    {
      cels: [7020, 7021, 7022],
      hold: 3,
      kind: 14,
      tag: 0,
      from: "0x473c80 tag 0",
    },
    { cels: [7023, 7022], hold: 3, kind: 14, tag: 1, from: "0x473c80 tag 1" },
    { cels: [7023, 7022], hold: 3, kind: 14, tag: 2, from: "0x473c80 tag 2" },
    { cels: [7023], hold: 3, kind: 14, tag: 3, from: "0x473c80 tag 3" },
  ],
  /** kind 15 tag 0 — the short jab, what it answers the innermost band with */
  jab: {
    cels: [7000, 7001, 7002, 7001, 7000],
    hold: 1,
    kind: 15,
    tag: 0,
    from: "0x473cc8 tag 0",
  },
  /** kind 15 tag 1 — the full swing, and what every volley ends in */
  swing: {
    cels: [7000, 7001, 7002, 7003, 7004, 7002, 7001, 7000],
    hold: 1,
    kind: 15,
    tag: 1,
    from: "0x473cc8 tag 1",
  },
  /**
   * `0x473dc8`, pushed as `0x45ef70`'s fourth argument at `0x441cd7` and
   * terminated by the zero at `0x473dce`. Three thresholds, four bands.
   */
  bands: [250, 150, 80],
  /** `0x440e36`, `0x441110`, `0x441160`, `0x44193f`, `0x44198f` — every volley */
  cry: 0x15,
  /** `0x4412f2` — the frame the grab closes */
  grab: 0x16,
  /** `0x441698` — each lap of the fall's first tag */
  thud: 0x14,
  from: "0x440ab0",
} as const;

/**
 * What a volley actually throws — `0x4420c0`, class `[0x472568]`.
 *
 * Both volleys throw the same thing and differ only in where it leaves from:
 * `0x4420ff` is the flying form's muzzle and `0x442131` the grounded one's, and
 * the argument that picks between them is the `0` and the `1` at the call
 * sites. `0x4421c7` is the create — divisor 5, no weight, cel 10000 out of
 * `[0x4a7020]` — and `0x474cc0` is three cels held two frames each, with no
 * stride on any of them. **A shot does not leave with a speed at all.**
 *
 * What moves it is its think, `0x442290`, which steers: twenty along the facing
 * and a tenth of the gap to a point forty-five above the player's own, both
 * added to the velocity every frame through the divisor. So it drifts out of
 * the muzzle, accelerates, and curves onto your height — and `0x442306` takes
 * it away the frame it is past you rather than at any reach.
 *
 * `0x44236d` is its strength: **−2**, a reaction CODE rather than a blow, which
 * is the jolt the eyeball's globs carry. `0x44235e` zeroes it against a wall.
 */
const SHOT = {
  /** `0x474cc0` — three cels, `ticksPerFrame` 2, and it loops */
  cels: [1000, 1001, 1002],
  hold: 2,
  /** `0x4421df` — `obj+0xe`, what both deltas are divided by */
  divisor: 5,
  /** `0x4422c7` — twenty along the facing, every frame */
  along: 0x14,
  /** `0x4422db` — it wants to be forty-five above your point... */
  lead: 0x2d,
  /** ...and closes a tenth of what is left of that a frame */
  drop: 10,
  /** `0x4421cb` — `obj+0x1a` at birth and `0x44236d` every frame after */
  strength: -2,
  from: "0x4420c0 / 0x474cc0, class 0x4421b0",
} as const;

function shot(ahead: number, lift: number, from: string): CastKit {
  return {
    cels: SHOT.cels,
    hold: SHOT.hold,
    speed: 0,
    ahead,
    lift,
    blow: SHOT.strength,
    home: { along: SHOT.along, lead: SHOT.lead, drop: SHOT.drop, divisor: SHOT.divisor },
    past: true,
    from,
  };
}

/** `0x4420ff` — the flying form's muzzle: eighty out and thirty-five up */
export const KRAGG_SHOT_AIR: CastKit = shot(0x50, 0x23, "0x4420c0(obj, 0)");
/** `0x442131` — the grounded form's: seventy out and eighty up */
export const KRAGG_SHOT_GROUND: CastKit = shot(0x46, 0x50, "0x4420c0(obj, 1)");

/** `[0x473ddc]` — how far below itself it wants the player */
const WANT_BELOW = 35;
/** the `± 0xa` `0x440d80`/`0x440d9b` put either side of that */
const SLACK = 10;
/** `0x440aff` — the sideways speed is pinned to this every frame, both ways */
const CAP_VX = 40;
/** `mov word ptr [ecx+0xe], 0x32` at `0x441c1a` — what `0x42f8b0` divides by */
const DIVISOR = 50;
/** the port's tick is a QUARTER of an engine frame — {@link TICK_SCALE} is the authority */
const TICKS = TICK_SCALE;

/**
 * `[0x473dd4]` and `[0x473dd8]` — the two hover limits, as module state.
 *
 * They belong here rather than on the {@link Enemy} because that is literally
 * where the disc keeps them: two words in `.data`, seeded −5 and 5, shared by
 * the one object that exists. And the ORDER matters — `0x440d10` tests the
 * velocity against them and only then does `0x440d64` recompute them from this
 * frame's distance, so the test always runs against the PREVIOUS frame's pair.
 * Keeping them out here is what preserves that one-frame lag.
 */
let hoverLo = -5;
let hoverHi = 5;

/**
 * `0x42f8b0` — add a step towards `(dy, dx)` to the velocity.
 *
 * `vx += dx / obj+0xe` and `vy += dy / obj+0xe`, both rounded **away from
 * zero**: the executable computes `(n + c - 1) / c` for a positive `n` and
 * `(n - c + 1) / c` for a negative one and truncates, so any non-zero distance
 * is worth at least one pixel a frame. The divisor is `obj+0xe`, 50 while it
 * flies; the ground form's 200 never reaches here because nothing below state
 * 11 steers.
 */
function steer(e: Enemy, dy: number, dx: number): void {
  /**
   * ...and the vertical is held to the same forty the horizontal is.
   *
   * `0x440af2` clamps `obj+0xc` to ±0x28 every frame and writes nothing about
   * `obj+0xa`, because in the shipped game it does not need to: the maul lasts
   * the handful of frames it takes to reach band 3, and a sign-integrator over
   * that many frames goes nowhere. Here the boss can stay in it much longer —
   * a player who keeps his distance never lets it reach band 3 — and an
   * unbounded one climbs out of the level. **This clamp is the port's**, and it
   * is the only number in this file that is not the executable's.
   */
  const CAP_VY = 40;
  const vy = e.vy / TICKS + away(dy);
  e.vy = Math.max(-CAP_VY, Math.min(CAP_VY, vy)) * TICKS;
  e.vx = (e.vx / TICKS + away(dx)) * TICKS;
}

function away(n: number): number {
  return Math.trunc((n >= 0 ? n + DIVISOR - 1 : n - DIVISOR + 1) / DIVISOR);
}

/**
 * `0x440cc4` and `0x440f4a` — one off the magnitude a frame.
 *
 * The engine's word is an integer, so `v += v >= 0 ? -1 : 1` lands exactly on
 * zero. This port's velocity is a fraction of one, so the last step is clamped
 * rather than allowed to cross; that clamp is the port's, nothing else here is.
 */
function bleed(v: number): number {
  if (v === 0) return 0;
  if (Math.abs(v) <= 1) return 0;
  return v + (v > 0 ? -1 : 1);
}

/** `0x440ab0`'s prologue, and everything below it reads a velocity in these */
function engineVx(e: Enemy): number {
  return e.vx / TICKS;
}

/**
 * `0x440cc4`..`0x440db6` — how the flying form holds its height.
 *
 * A direction of ±1 goes into the vertical velocity every frame and reverses
 * when the velocity walks past one of the two limits, and the limits are what it
 * is actually trying to do: it wants the player {@link WANT_BELOW} below it, and
 * the limit it relaxes is the one that gets it there. Closer than 25 and it may
 * climb at 9 but only sink at 5; further than 45 and it may sink at 9 but only
 * climb at 5; in between, 5 both ways.
 *
 * **This is not a symmetric pair**, which is what the page's `bob.far` made of
 * it: only ever one of the two limits is loosened, never both.
 */
function bob(e: Enemy, dy: number): void {
  e.hover ??= 1;
  // `0x440ce6` — the direction goes straight into the velocity, and stays
  const v = e.vy / TICKS + e.hover;
  e.vy = v * TICKS;
  /**
   * `0x440cf6` — and if it has touched the floor (`obj+0x2e`) it flips to
   * climbing and lifts itself ten pixels clear. **Not ported**: the kit hands a
   * brain no ground flag, and the page's own floor pin is what stops a floater
   * sinking. Named so the next reader knows a line is missing, not wrong.
   */
  // `0x440d10` — the flip, against LAST frame's limits, and it does not clamp
  if ((e.hover < 0 && v < hoverLo) || (e.hover > 0 && v > hoverHi)) {
    e.hover = e.hover === 1 ? -1 : 1;
  }
  // `0x440d64` — and only now are the limits for the next frame worked out
  if (WANT_BELOW - SLACK > dy) {
    hoverLo = -9;
    hoverHi = 5;
  } else {
    hoverLo = -5;
    hoverHi = WANT_BELOW + SLACK < dy ? 9 : 5;
  }
}

/**
 * `initkragg`'s own machine — states 1, 2, 3, 5, 6, 8 in the air, 11, 12, 13,
 * 14, 15 on the ground.
 *
 * ## The two traps, and where this one's answers came from
 *
 * **The stack frame.** `0x440ab0` opens `sub esp, 0x74`, then takes the buffer
 * address with `lea eax, [esp+4]` **before** its single `push esi`, so the
 * sixteen bytes `0x45efd0` fills sit at **`esp+8`** for the rest of the body —
 * `esp+8` side, `esp+0xc` band, `esp+0xe` strike box, `esp+0x10` his dy,
 * `esp+0x12` the forward distance. The cross-check that pins it is `0x440e0b`,
 * `cmp dword ptr [esp+8], 2`: `out+0` is the only field `0x45f00c` writes as a
 * DWORD, and 2 is the only value it ever compares one to. Reading the frame four
 * low would turn that side test into a band test and still compile.
 *
 * (The argument slots would be `[esp+0x7c]` and `[esp+0x80]`, and the function
 * never touches either — it reads `[0x4a6ff8]` and `[0x4a75d0]` instead, which
 * is the singleton story above.)
 *
 * **The return value.** Every path out of `0x440ab0` is `xor ax, ax` at
 * `0x441a95` or an inlined copy of it. There is no `mov ax, 1` anywhere in the
 * function — not even in the death state — so **every path here returns false**,
 * waiting states included. Returning true would freeze it mid-dive with its
 * velocity unspent.
 *
 * ## What the prologue does that is not a state
 *
 * - `0x440acf` claims the on-screen bar with `0x40d1c0(health, 0x40e300(0x3e8),
 *   0x3332, point)`. Documented, not behaviour, not ported.
 * - `0x440af2` pins `obj+0xc` to ±40. Ported, below.
 * - `0x440b1c` sets the phase's shove weight (`obj+0x26` 40 or 100), floor
 *   offset (`obj+0x10` 0 or −15), strength (`obj+0x1a` 100) and inertia divisor
 *   (`obj+0xe` 50 or 200), and snaps the ground form's `obj+8` to `[0x4a7574]`.
 *   None of those five words exist on this page's {@link Enemy}; **nothing hits
 *   the player back in this port**, so the strength is carried as read.
 * - `0x440b99` is the sprinkler scald — three health a frame for standing in
 *   water that is already up, states 1..9 only, and the frame it goes below
 *   zero is the fall. The page owns that in `stepColumns`.
 */
/** `0x440b1c` — at eleven and above it is the grounded second form */
const GROUND = 11;

export const kragg: Brain = (e, foe, run, k) => {
  const took = think(e, foe, run, k);
  // `0x45d1a3` — then the animator, and the cel's own dy with it, which the
  // page leaves to a floater's brain
  lift(e);
  return took;
};

const think: Brain = (e, foe, run, k) => {
  const done = e.clock >= run;
  const t = k.track(e, KRAGG.bands);
  // `0x440af2` — whatever put speed into it, it may not carry more than forty
  const capped = Math.max(-CAP_VX, Math.min(CAP_VX, engineVx(e)));
  e.vx = capped * TICKS;
  /**
   * `0x441c6d` — the FLYING form has no gravity, in every one of its states.
   *
   * `0x42f850(obj, 0)` at setup, and nothing gives it weight until the fall's
   * tag 1 calls `0x42f850(obj, 1.0)` at `0x4416e6`. Its height is whatever its
   * own states put in `obj+0xa` — the hover's ±1, the maul's steer, the fall's
   * pull — and nothing pulls on it in between. The page reads this per frame;
   * {@link Foe.rallies} is what tells it the class is no longer a floater.
   */
  const state = e.script ?? 1;
  e.weightless = state < 10 || (state === 10 && (e.tag ?? 0) === 0);
  /**
   * `0x440b31` / `0x440b43` — the grounded form keeps no sideways speed and is
   * put back on `[0x4a7574]` every frame, the X the fall steered it to and the
   * landing wrote (`0x441747`). The page keeps that word in {@link Enemy.home}.
   */
  if (state >= GROUND) {
    e.vx = 0;
    if (e.home !== undefined) e.x = e.home;
  }
  // `0x440b55` / `0x440b78` — and the floor offset, −15 grounded and 0 flying,
  // rewritten every frame (the frame function's `0x442080` again for the first)
  e.floor = state >= GROUND ? -15 : 0;
  // `0x440b28` / `0x440b6d` — the shove weight, 100 grounded and 40 flying,
  // and the maul (`0x440fc3`), the dive (`0x441255`) and the death (`0x441a1e`)
  // clear it for as long as they run
  e.shove = state === 5 || state === 8 || state === 16 ? 0 : state >= GROUND ? 100 : 40;
  switch (state) {
    /**
     * ---- 1, `0x440cc4`: the hover, and the only air state that thinks.
     *
     * It has **no `obj+0x46` gate**. Unlike every waiting state in the class, it
     * re-decides on every single frame, which is why one cel held for five ticks
     * is enough of an animation for it.
     */
    case 1: {
      // `0x440cc4` — the sideways drift bleeds off one a frame
      e.vx = bleed(engineVx(e)) * TICKS;
      bob(e, t.dy);
      /**
       * `0x440db6` — he has got behind it, so it turns. And this one does NOT
       * return: it installs the turn and then falls straight through into the
       * band switch, which may install over the top of it on the same frame.
       * Bands 1 and 3 are the two that can decline, and those are the frames the
       * turn actually survives.
       */
      if (t.forward < 0) install(e, KRAGG.turn[e.facing < 0 ? 1 : 0]);
      // `0x440ddc` — `jmp [eax*4 + 0x441adc]`, four entries, on the band
      switch (t.band) {
        /**
         * `0x440df1` — beyond 250, and it just comes at him. Played once and
         * HELD: a finished script stays on its last frame and `0x45d1a3` goes
         * on adding that frame's `dx 120` — three a frame — until state 2
         * stops it, so it closes at the ±40 the prologue allows
         * ({@link Foe.accrues}).
         */
        case 0:
          return install(e, KRAGG.closeIn, true);
        /**
         * `0x440e0b` — 150…250, and it wants `out+0` to be exactly **2**, which
         * `0x45f00c` writes when the target is carrying no horizontal velocity
         * at all. It spits at a man standing still and does nothing to a man who
         * is moving.
         */
        case 1:
          if (t.side !== 2) return false;
          k.say(e, KRAGG.cry);
          return install(e, KRAGG.spit[0], true);
        /**
         * `0x440e48` — 80…150, split on two thirds of a full tank: still strong
         * and it mauls, worn down and it dives. The disc recomputes
         * `0x40e300(0x3e8)` on the spot rather than remembering a maximum, so
         * this does too.
         */
        case 2:
          return e.hp < Math.trunc((k.scaled(0x3e8) * 2) / 3)
            ? install(e, KRAGG.dive)
            : install(e, KRAGG.maulIn);
        /**
         * `0x440e9f` — inside 80 it dives, but only once it has been hurt at
         * all. Untouched, it hangs there and lets him hit it.
         */
        case 3:
          return e.hp < k.scaled(0x3e8) ? install(e, KRAGG.dive) : false;
        default:
          return false;
      }
    }
    /** ---- 2, `0x440ed3`: closing, and then stopping */
    case 2: {
      if ((e.tag ?? 0) === 0) {
        // `0x440eea` — the vertical drift bleeds off while it closes
        e.vy = bleed(e.vy / TICKS) * TICKS;
        if (!done) return false;
        // `0x440f1c` — it keeps coming while he is in front AND still outside
        if (t.forward >= 0 && t.band <= 0) return false;
        return install(e, KRAGG.halt);
      }
      // `0x440f4a` — and the stop holds until the sideways drift is exactly gone
      e.vx = bleed(engineVx(e)) * TICKS;
      if (e.vx !== 0) return false;
      return install(e, KRAGG.idle);
    }
    /** ---- 3, `0x440f90`: the turn ends by flipping `obj+0x28` */
    case 3:
      if (!done) return false;
      e.facing = -e.facing;
      return install(e, KRAGG.idle);
    /**
     * ---- 5, `0x440fbe`: the maul, and it is a LOOP with no exit of its own.
     *
     * Tag 0 homes at him until he is inside 80; tag 0 does not watch its own
     * script end, so it keeps homing however long that takes. Tag 1 lands the
     * blow, halves the sideways speed and hands **back to tag 0** (`0x44106b`).
     * Nothing in the state leaves it: the only way out is a blow, which the hit
     * handler answers with kind 7. That is deliberate — once it commits to
     * mauling, it mauls until it is interrupted.
     *
     * `0x440fbe` also drops `obj+0x26` to zero for the whole state: it stops
     * shoving other bodies around while it is on him.
     */
    case 5: {
      const tag = e.tag ?? 0;
      if (tag === 0) {
        // `0x440fe9` — band 3 EXACTLY, and it lands it
        if (t.band === 3) return install(e, KRAGG.maul, true);
        // `0x440ff1` — otherwise `0x42f8b0` at his own point, every frame
        steer(e, t.dy, k.player.x - k.anchorX(e));
        return false;
      }
      if (tag === 1) {
        // `0x441043` — half the sideways speed a frame while the blow lands
        e.vx = Math.trunc(engineVx(e) / 2) * TICKS;
        if (!done) return false;
        return install(e, KRAGG.maulIn);
      }
      // `0x44107e` — tag 2, which nothing installs. Kept for completeness
      if (!done) return false;
      return install(e, KRAGG.idle);
    }
    /**
     * ---- 6, `0x4410a3`: the air volley.
     *
     * Three shots — tags 0, 1 and 2 each end with `0x4420c0(obj, 0)`, which
     * makes a new object out of `[0x472568]` and puts it at `obj.x ± 80`,
     * `obj.y - 35`, facing the way kragg faces. Tags 1 and 2 share a handler,
     * which is why `0x441aec` has four entries and only two call sites.
     * (`0x441cff` is the other half of it — a hit from something already in
     * `[0x472568]` is kragg's own shot and is ignored outright.) See
     * {@link KRAGG_SHOT_AIR}.
     */
    case 6: {
      const tag = e.tag ?? 0;
      // `0x4410bf` — and the wind-up alone will turn instead of firing
      if (tag === 0 && t.forward < 0)
        return install(e, KRAGG.turn[e.facing < 0 ? 1 : 0]);
      if (!done) return false;
      if (tag <= 2) {
        k.say(e, KRAGG.cry);
        k.cast(e, KRAGG_SHOT_AIR); // `0x441128` / `0x441178`
        return install(e, KRAGG.spit[tag + 1], true);
      }
      /**
       * `0x441185` — tag 3 is where the volley decides what it was for: under
       * half of `0x40e300(0x3e8)` it dives, and at half or over it mauls.
       */
      return Math.trunc(k.scaled(0x3e8) / 2) > e.hp
        ? install(e, KRAGG.dive)
        : install(e, KRAGG.maulIn);
    }
    /**
     * ---- 8, `0x441250`: the dive, and the grab at the end of it.
     *
     * `0x441250` clears `obj+0x26` for the whole state, the same way the maul
     * does. Tags 0 and 1 share one handler and both home; the grab fires on pure
     * geometry — inside 80 forward AND within forty of his own height, on the
     * frame the script ends — with no test at all for whether it connected.
     */
    case 8: {
      const tag = e.tag ?? 0;
      if (tag <= 1) {
        // `0x441274` — he is behind it, and the whole dive is abandoned
        if (t.forward < 0) return install(e, KRAGG.idle);
        // `0x441296` / `0x4412bc` — band 3 and no more than forty of height
        if (t.band === 3 && Math.abs(t.dy) <= 40) {
          // `0x4412c5` — a quarter of the sideways speed a frame, closing in
          e.vx = Math.trunc(engineVx(e) / 4) * TICKS;
          if (!done) return false;
          k.say(e, KRAGG.grab);
          e.vy = 0;
          // `0x441306` — tag 2 for the second character, tag 3 for the first
          return install(e, KRAGG.carry[k.player.character === 1 ? 0 : 1], true);
        }
        // `0x44134a` — out of range, so it keeps homing
        steer(e, t.dy, k.player.x - k.anchorX(e));
        if (!done) return false;
        return install(e, KRAGG.divePull);
      }
      /**
       * `0x4413a8` — the carry, and the only state in the class that is a
       * transaction rather than a move. It takes him with no test of whether
       * anything connected: the dive's end found him in reach, and that is all.
       *
       * Every frame of it: floor offset −150 so it rises clear; `[0x46b1b4]`
       * cleared, so he is not drawn — 7046/7047 are him in its fist;
       * `[0x4a75c8] += 0xa`, capped at `0x40e300(0x3e8)`, and `0x402ac0(0xa)`
       * — ten out of him and into kragg; he is put at `obj.x ± 50` (+50 while
       * `obj+0x28` is clear), `obj.y`, both velocities zeroed; and kragg turns
       * whenever he faces the way it does. His own think still runs — nothing
       * puts him in a held state until the end — and the carry holds him where
       * it wants him after it.
       *
       * When the eight cels run out: his vertical speed zeroed and ten of
       * sideways along kragg's facing, `[0x46b1b4]` back, `0x402fa0(2)` — the
       * knockdown — and kragg recoils on thirty of its own and ten down.
       */
      // `0x4413b2` — the floor offset −150 over the prologue's 0, every frame
      // of the carry, so it rises clear
      e.floor = -150;
      k.hide(true); // `0x4413b8`
      // `0x4413c9` / `0x4413f1` — ten a frame, capped at a full tank
      e.hp = Math.min(e.hp + 10, k.scaled(0x3e8));
      k.drain(0xa); // `0x4413fc`
      // `0x44141e` / `0x441438` — at its side and height, standing still
      k.pin(
        { x: k.anchorX(e) + (e.facing > 0 ? CARRY_SIDE : -CARRY_SIDE), y: k.anchorY(e) },
        { vx: 0, vy: 0 },
      );
      // `0x441462` — facing him the same way means facing the wrong way
      if (k.player.facing === e.facing) e.facing = -e.facing;
      if (!done) return false;
      // `0x441490` / `0x4414b6` — let go with ten along its facing, and knocked down
      k.pin({ x: k.player.x, y: k.player.anchor }, { vx: e.facing > 0 ? CARRY_THROW : -CARRY_THROW, vy: 0 });
      k.hide(false);
      k.pose(2); // `0x4414c3`
      // `0x4414cb` / `0x4414ef` — thirty back and ten down as it lets go
      e.vx = -30 * e.facing * TICKS;
      e.vy = 10 * TICKS;
      return install(e, KRAGG.idle);
    }
    /**
     * ---- 11, `0x4417a8`: the rise, and the ONLY door into the ground phase.
     *
     * Two lines: wait for the script, install kind 12. It is here rather than in
     * {@link NOT_HERE} because the page's flinch path owns the same script's
     * tags 1 and 2 and has nothing to say about tag 0 — a brain called with kind
     * 11 is a kragg that has just stood back up, and this is where it goes.
     */
    case 11:
      if (!done) return false;
      return install(e, KRAGG.stand);
    /**
     * ---- 12, `0x4417cd`: the ground idle, and the ground's deciding state.
     *
     * Like state 1 it has no script gate and re-decides every frame — one cel at
     * one tick. And like state 1 it turns on a negative forward distance, except
     * that here the turn **does** return: the band switch is the `else`.
     *
     * Band 0 answers nothing, and that is not an oversight. The prologue pins
     * `obj+8` to `[0x4a7574]` on every ground frame, so the ground form cannot
     * close the distance; beyond 250 it simply waits for him to come back.
     */
    case 12: {
      if (t.forward < 0)
        return install(e, KRAGG.groundTurn[e.facing < 0 ? 1 : 0]);
      switch (t.band) {
        // `0x441811` — 150…250: the volley
        case 1:
          return install(e, KRAGG.lob[0], true);
        // `0x44182b` — 80…150: the full swing
        case 2:
          return install(e, KRAGG.swing, true);
        // `0x441845` — inside 80: the short jab
        case 3:
          return install(e, KRAGG.jab, true);
        default:
          return false;
      }
    }
    /**
     * ---- 13, `0x44185f`: the ground turn — the brain's own from the volley's
     * wind-up, and the page's as a blow's take, which hands here the frame it
     * ends ({@link FoeAnim.decides}); state 15 below the same.
     *
     * `0x44185f` also carries a roar — on tag 1, while the script's frame
     * index `obj+0x42` is 0xa (the index counts the whole script, and tag 0 is
     * eight records long, so that is tag 1's third), `0x434540(0x64) < 0x1e`
     * picks `0x434540(2) + 0x1b`, 0x1c or 0x1d, through `0x40f090`
     * (`0x44189e`). It asks on every frame that record shows, and the lead
     * starts over each time it is asked.
     */
    case 13:
      if ((e.tag ?? 0) === 1 && Math.floor(e.clock / e.anim.hold) === ROAR_AT && k.roll(0x64) < 0x1e)
        k.say(e, 0x1b + k.roll(2), "lead");
      if (!done) return false;
      // `0x4418b6` — and it flips `obj+0x28` on the way out, like the air turn
      e.facing = -e.facing;
      return install(e, KRAGG.stand);
    /**
     * ---- 14, `0x4418d4`: the ground volley — the air one's shape exactly.
     *
     * Three shots through `0x4420c0(obj, 1)`, which puts each one at
     * `obj.x ± 70`, `obj.y - 80` — higher and closer in than the flying form's.
     * Tag 3 hands to the full swing rather than deciding anything. See
     * {@link KRAGG_SHOT_GROUND}.
     */
    case 14: {
      const tag = e.tag ?? 0;
      // `0x4418f0` — again only the wind-up will break off to turn
      if (tag === 0 && t.forward < 0)
        return install(e, KRAGG.groundTurn[e.facing < 0 ? 1 : 0]);
      if (!done) return false;
      if (tag <= 2) {
        k.say(e, KRAGG.cry);
        k.cast(e, KRAGG_SHOT_GROUND); // `0x441957` / `0x4419a7`
        return install(e, KRAGG.lob[tag + 1], true);
      }
      // `0x4419c4` — and the volley always ends in kind 15 tag 1
      return install(e, KRAGG.swing, true);
    }
    /** ---- 15, `0x4419d9`: both swings hand straight back to the ground idle */
    case 15:
      if (!done) return false;
      return install(e, KRAGG.stand);
    /**
     * ---- 10, `0x441615`: shot out of the sky, and where it comes down.
     *
     * Tag 0 is still weightless and it is STEERED: `0x44165d` doubles the gap
     * to `[0x4a7574]` — the room's own centre, which the blow or the scald that
     * emptied the bar wrote there out of `0x40ba30` — and `0x44166d` doubles
     * the gap to the player's height, and both go through `0x42f8b0`. Each
     * time tag 0 ends it says 0x14 and plays again while `[0x473de0]` — seeded
     * 4, decremented every lap and never reset — was still at or above zero,
     * so five laps; then tag 1, which turns the weight on (above). What tag 1
     * waits for, the landing and the second bar, is {@link Foe.rallies}'s.
     */
    case 10: {
      if ((e.tag ?? 0) !== 0) return false;
      steer(e, t.dy * 2, ((e.home ?? e.x) - e.x) * 2);
      if (!done) return false;
      k.say(e, KRAGG.thud);
      const lap = fallLaps;
      fallLaps -= 1;
      return lap >= 0 && foe.rallies
        ? rewind(e, foe.rallies.fall)
        : install(e, KRAGG.fallLand, true);
    }
    /**
     * States 4, 7, 9 and 16. Four is a hole in the table with no script
     * behind it (`0x441a9c[3]` is the epilogue); the rest are {@link NOT_HERE}.
     */
    default:
      return false;
  }
};

/** `[0x473de0]` — the fall's laps, seeded 4 in `.data` and never reset */
let fallLaps = 4;

/**
 * Put `[0x473de0]` back to its `.data` value, as a fresh process has it. The
 * game never calls this — the word is spent once per run, as on the disc — but
 * a test that drives the fall off the page must not inherit what an earlier
 * one spent.
 */
export function seedKraggFall(laps = 4): void {
  fallLaps = laps;
}

/**
 * `0x45d1a3` — the frame's own `dy`, added to `obj+0xa` through `0x42f8b0`
 * on every frame it shows, and on the last one for as long as a finished
 * script holds it. The page does this for everything that walks; a floater's
 * is its brain's, and kragg's are the air turn's sink, the carry's climb and
 * the fall's two lifts. Called after the think, so a script installed this
 * frame spends its first frame now, as `0x45d0f0` does straight after it.
 */
function lift(e: Enemy): void {
  const dy = e.anim.dy;
  if (!dy?.length) return;
  const i = Math.min(dy.length - 1, Math.floor(e.clock / e.anim.hold));
  if (dy[i]) e.vy += away(dy[i]) * TICKS;
}

export { NOT_HERE as KRAGG_NOT_HERE };

/**
 * State 9, `0x441509` — what a −9 does to it, and the whole tactic of the
 * level.
 *
 * `0x441d30` is the only way in: a blow of −9 (a flare, on stage 5 — and
 * ARCADE is stage 5) costs kragg nothing and installs `0x473a88`. Two things
 * then happen for the twenty-six frames it lasts.
 *
 * **It is DRAGGED.** Before the tag dispatch, every frame:
 *
 * ```
 *   441519  0x40b660("initsprinkler", self, 1, -1, out)   the NEAREST record
 *   44153a  dx = out.pointX - self.x
 *   44154c  dy = out.pointY - self.y + 0x78               ...120 BELOW it
 *   44155b  0x42f8b0(self, packed)                        into the velocity
 * ```
 *
 * A hundred and twenty below the point, not the point: the record's own
 * `pointY` is where the water comes out of the floor, and the boss is being
 * pulled down onto it.
 *
 * **And it RAISES.** `0x4415a9` runs on every frame of tags 1 to 4 — not once
 * a tag — asking `0x441b20` which rect holds its own point and handing the
 * answer to `0x441b60`. Tag 0 is the ten frames before any of that, which is
 * the boss thrashing its way there.
 *
 * What ends it is tag 4 running out, and `0x441608` puts the hover back on:
 * this page's `gait`, which is where a flinch that finishes goes anyway.
 */
export const kraggReacts: Reaction = (e, foe, _run, k) => {
  /**
   * The prologue's floor offset runs in the page's states too: 0 flying and
   * −15 grounded (`0x440b78` / `0x440b55`), and the death that sticks writes
   * −25 over it every frame (`0x441a13`).
   */
  e.floor = e.state === "dead" ? -25 : e.rallied ? -15 : 0;
  /**
   * ---- 16, `0x441a42`: tag 0's eight cels end and tag 2 goes on, and with
   * it 0x1b through `0x40f090` and `0x4423a0(point, 0xf)` — fifteen roaches.
   * The point is its own `obj+6` moved 25 up (`0x441a5f`) and 20 BEHIND it
   * (`0x441a65`..`0x441a79`: −20 when `obj+0x28` is 0, +20 when it is 1).
   */
  if (e.state === "dead") {
    if (e.threw || e.clock < DEATH_TAG0 * e.anim.hold) return;
    e.threw = true;
    const at = {
      x: k.anchorX(e) + (e.facing > 0 ? -DEATH_BEHIND : DEATH_BEHIND),
      y: k.anchorY(e) - DEATH_UP,
    };
    // `0x441a7e` — through `0x40f090`, the mixer's channel 0
    k.say({ ...e, ...at }, DEATH_SPILL_SOUND, "lead");
    k.spill(at, DEATH_SPILL);
    return;
  }
  if (e.anim !== foe.burns?.anim) return;
  const to = k.sprinkler(e);
  if (to) {
    // `0x42f8b0` divides each half by `obj+0xe` and ADDS it, so the pull
    // compounds every frame it is applied — which is what drags rather than
    // steers. `0x44154c`'s 0x78 is the drop below the record's own point.
    // Whole engine pixels a frame, as the velocity words hold them, and this
    // runs once a frame: into the page's per-tick velocity through TICKS
    const dx = to.x - e.x;
    const dy = to.y - e.y + SPRINKLER_DROP;
    e.vx += away(dx) * TICKS;
    e.vy += away(dy) * TICKS;
  }
  // `0x440af2` — the prologue's ±40 runs in state 9 as in every other
  e.vx = Math.max(-CAP_VX, Math.min(CAP_VX, engineVx(e))) * TICKS;
  // `0x441584`: tag 0 is the first five cels, and nothing is raised during it
  const lead = 5 * (foe.burns.anim?.hold ?? 2);
  if (e.clock >= lead) k.raise(e);
};

/** `0x473d38` tag 0 — eight cels before tag 2 */
const DEATH_TAG0 = 8;
/** `0x44186b` — `obj+0x42 == 0xa`, less tag 0's eight records */
const ROAR_AT = 0xa - 8;

/** `0x441a79` / `0x441a5f` — where the roaches come out, against its own point */
const DEATH_BEHIND = 0x14;
const DEATH_UP = 0x19;
/** `0x441a6c` — 0x1b, through `0x40f090` */
const DEATH_SPILL_SOUND = 0x1b;
/** `0x441a8a` — fifteen of them */
const DEATH_SPILL = 0xf;

/** `0x441416` / `0x441419` — how far to its side it holds him */
const CARRY_SIDE = 0x32;
/** `0x4414ae` / `0x4414b3` — and the sideways speed it drops him with */
const CARRY_THROW = 0xa;

/** `0x44154c` — the boss is pulled to a point this far BELOW the record's own */
const SPRINKLER_DROP = 0x78;

/**
 * What a blow is by the time it reaches one of `0x441cf0`'s arms — `null` for
 * nothing at all.
 *
 * The handler asks two things of kragg's STATE before it asks anything of the
 * blow. `0x441d26`: from state 9 up, every blow goes to `0x441ef0` and the
 * −9 arm at `0x441d30` is never reached — so the flare's thrash runs only out
 * of states 1..8, the flying form on its own terms. And `0x441ef0` then splits
 * at eleven (`0x441ef4`): 9, 10 and 11 take nothing whatever it is (`0x442024`
 * answers 0), and from 12 up a blow with a negative strength is worth a flat
 * `0x46` (`0x441efa`) — so a −9 on the ground form is seventy health and no
 * fire.
 *
 * The page keeps kragg's state where the brain keeps it, in `Enemy.script`,
 * and every reaction it puts on writes its own kind there as `0x45d090`
 * does: the thrash 9, the fall 10 (`rallyFall`), the ground takes 11,
 * the death 16. The burn is still read off the animation as well, since a
 * flinch that ends hands the machine its gait without a kind of its own. The
 * rest of `0x441ef0` — `[0x473de4]`'s count and the turn or swing the fourth
 * blow picks — is {@link Foe.pick}; the death it reinstalls on a corpse is
 * {@link Foe.corpseTakesHits}.
 */
export function kraggGate(
  e: Enemy,
  foe: Foe,
  blow: { damage: number; code: number },
): { damage: number; code: number } | null {
  const state =
    e.anim === foe.burns?.anim ? 9 : (e.script ?? 1);
  if (state < 9) return blow;
  if (state <= 11) return null;
  // `0x441efa` — `mov ax, 0x46` before `0x441efe` asks whether the strength is
  // negative; a code is, and it lands as that and nothing else
  return blow.code < 0 ? { damage: GROUND_FLAT, code: 0 } : blow;
}

/** `0x441efa` — what the ground form takes for any negative strength */
const GROUND_FLAT = 0x46;
