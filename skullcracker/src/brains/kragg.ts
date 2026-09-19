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
 * `0x441d30` — the FIRST thing the hit handler asks, before it computes any
 * damage at all — is whether the striking cel's strength is exactly **−9**. That
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
  type Brain,
  type BrainCtx,
  type Enemy,
  TICK_SCALE,
} from "./kit";

/**
 * The five states a brain is never called during, and the three things they do
 * that the page's own flinch/death path does not know about.
 *
 * - **7**, the flinches (`0x4411e6`). `0x441ea4` sorts a blow by `0x2d`: under
 *   it, one of the three single cels of `0x473a28` at `0x434540(3) - 1`; at or
 *   over it, the six-cel `0x473a48` tag 3. A blow landed while the dive is
 *   already running (`obj+0x18 == 8`) uses the same threshold for tags **4** and
 *   3 of the same script — and tag 4, cel 7044, is the one the page's `flinch`
 *   table is missing. Tags 0…3 hand back to the idle; **tag 4 hands to
 *   `0x473950` tag 1**, so a heavy blow mid-dive drops it straight back into the
 *   dive's recovery rather than into the hover.
 * - **9**, the flare thrash (`0x441509`). Described above: it is the ONLY thing
 *   in the executable that raises a sprinkler, and the page currently attributes
 *   that to the dive. It is installed only from `0x441d8f`, only by a −9 blow,
 *   only while `obj+0x18 < 9`.
 * - **10**, the fall (`0x441615`). Tag 0 is steered at `[0x4a7574]` — which the
 *   death path set to the ROOM's own centre X out of `0x40ba30` — at double
 *   weight, and loops itself `[0x473de0]` = 4 more times before handing to tag
 *   1. Tag 1 turns real physics back on (`0x42f850(obj, 1.0)`,
 *   `0x42f7f0(obj, 0.15)`, `0x42f7a0(obj, 1.0)`), waits for `obj+0x30` and
 *   `obj+0x2e`, then pins `[0x4a7574]` to where it actually landed, plays sound
 *   `0x18`, **restores its health to `0x40e300(0x3e8)`** and installs kind 11.
 * - **11 tags 1 and 2**, the ground flinches. `0x441fa3` picks one of the three
 *   cels of `0x473ba8` at `0x434540(3) - 1`. Tag **0** of the same script is the
 *   rise out of state 10, which is why this module owns state 11's hand-back and
 *   nothing else.
 * - **16**, the death that sticks (`0x4419fe`). `0x42f870(obj, 0)` takes it out
 *   of the census, floor offset −25, and tags 0/1 hand to tag 2 while playing
 *   sound `0x1b` and calling `0x4423a0(point, 0xf)` — fifteen pieces of debris,
 *   each with a random arc, out of `0x474db0`.
 *
 * The ground form's hit handler is its own machine and worth naming here too.
 * `0x441ef0`: states 9, 10 and 11 take **no hits at all**; from state 12 up a
 * blow with a negative strength is worth a flat `0x46` and anything else is
 * `0x42f910`'s own figure; `[0x473de4]` counts them, three give the flinch, and
 * every FOURTH one either spins it round (`0x473bd8` tags 2/3, the two-cel turn)
 * if the player has got behind it, or makes it swing back (`0x473cc8` tag 1).
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
  from: "0x440ab0",
} as const;

/** `[0x473ddc]` — how far below itself it wants the player */
const WANT_BELOW = 35;
/** the `± 0xa` `0x440d80`/`0x440d9b` put either side of that */
const SLACK = 10;
/** `0x440aff` — the sideways speed is pinned to this every frame, both ways */
const CAP_VX = 40;
/** `mov word ptr [ecx+0xe], 0x32` at `0x441c1a` — what `0x42f8b0` divides by */
const DIVISOR = 50;
/** the port's tick is half an engine frame, the same as {@link file://./werea.ts} */
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
 *   water that is already up. The page owns that in `stepColumns`, which is
 *   right; what the page has wrong is which state raises the water.
 */
/** `0x440b1c` — at eleven and above it is the grounded second form */
const GROUND = 11;

export const kragg: Brain = (e, foe, run, k) => {
  const done = e.clock >= run;
  const t = k.track(e, KRAGG.bands);
  // `0x440af2` — whatever put speed into it, it may not carry more than forty
  const capped = Math.max(-CAP_VX, Math.min(CAP_VX, engineVx(e)));
  e.vx = capped * TICKS;
  /**
   * `0x441c1f` — the FLYING form has no gravity, in every one of its states.
   *
   * `0x440b1c` splits the class at eleven, and everything below that is the
   * thing in the air: its height is whatever its own states put in `obj+0xa`,
   * the hover's ±1 and the maul's steer, and nothing pulls on it in between.
   * Weight is the grounded form's, and it gets it the moment it stands up.
   * Setting this in the hover alone was not enough — the maul is where it
   * spends a fight, and a boss with weight in the maul sinks out of the level.
   */
  e.weightless = (e.script ?? 1) < GROUND;
  switch (e.script ?? 1) {
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
        // `0x440df1` — beyond 250, and it just comes at him
        case 0:
          return install(e, KRAGG.closeIn);
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
        steer(e, t.dy, k.player.x - e.x);
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
     * `obj.y - 35`, facing the way kragg faces. **Not spawned here**: nothing
     * hits the player back in this port, so the volley is three animations and a
     * cry. (`0x441cff` is the other half of it — a hit from something already in
     * `[0x472568]` is kragg's own shot and is ignored outright.)
     */
    case 6: {
      const tag = e.tag ?? 0;
      // `0x4410bf` — and the wind-up alone will turn instead of firing
      if (tag === 0 && t.forward < 0)
        return install(e, KRAGG.turn[e.facing < 0 ? 1 : 0]);
      if (!done) return false;
      if (tag <= 2) {
        k.say(e, KRAGG.cry);
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
          return install(e, KRAGG.carry[1], true);
        }
        // `0x44134a` — out of range, so it keeps homing
        steer(e, t.dy, k.player.x - e.x);
        if (!done) return false;
        return install(e, KRAGG.divePull);
      }
      /**
       * `0x4413a8` — the carry, and the only state in the class that is a
       * transaction rather than a move.
       *
       * The disc: floor offset −150 so it rises clear; `0x402ac0(0xa)` takes
       * **ten off the player a frame**; `[0x4a75c8] += 0xa` a frame puts the
       * same ten into kragg, capped at `0x40e300(0x3e8)`; the player is held at
       * `obj.x ± 50`, `obj.y`, with his velocity zeroed and kragg turned to face
       * him; and when the eight cels run out `0x402fa0(2)` throws him down with
       * ten of sideways speed while kragg recoils on thirty of its own.
       *
       * **The drain is not ported and never will be — nothing hits the player
       * back in this port.** The heal is kragg's own word and is ported, with
       * its address; a caller that does not want a free heal for an attack that
       * cannot connect should gate it, and this comment is the reason it can.
       */
      // `0x4413c9` / `0x4413f1` — ten a frame, capped at a full tank
      e.hp = Math.min(e.hp + 10, k.scaled(0x3e8));
      // `0x441462` — facing him the same way means facing the wrong way
      if (k.player.facing === e.facing) e.facing = -e.facing;
      if (!done) return false;
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
     * ---- 13, `0x44185f`: the ground turn.
     *
     * `0x44185f` also carries a roar — on tag 1, on script frame `obj+0x42 ==
     * 0xa` exactly, `0x434540(0x64) < 0x1e` picks `0x40f090` sound `0x1c` or
     * `0x1d`. **Not emitted here**: the kit's `say` is `0x40ef30` and this is the
     * distance-gated `0x40f090`, and the port carries no script-frame index to
     * hang the test on. Both halves of that are missing, so neither is faked.
     */
    case 13:
      if (!done) return false;
      // `0x4418b6` — and it flips `obj+0x28` on the way out, like the air turn
      e.facing = -e.facing;
      return install(e, KRAGG.stand);
    /**
     * ---- 14, `0x4418d4`: the ground volley — the air one's shape exactly.
     *
     * Three shots through `0x4420c0(obj, 1)`, which puts each one at
     * `obj.x ± 70`, `obj.y - 80` — higher and closer in than the flying form's.
     * Not spawned, for the same reason. Tag 3 hands to the full swing rather
     * than deciding anything.
     */
    case 14: {
      const tag = e.tag ?? 0;
      // `0x4418f0` — again only the wind-up will break off to turn
      if (tag === 0 && t.forward < 0)
        return install(e, KRAGG.groundTurn[e.facing < 0 ? 1 : 0]);
      if (!done) return false;
      if (tag <= 2) {
        k.say(e, KRAGG.cry);
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
     * States 4, 7, 9, 10 and 16. Four is a hole in the table with no script
     * behind it (`0x441a9c[3]` is the epilogue); the rest are {@link NOT_HERE}.
     */
    default:
      return false;
  }
};

export { NOT_HERE as KRAGG_NOT_HERE };
