/**
 * The one with the knife — `initknifeboy`, think function `0x439ca0`, ten
 * states, and the only class in the chapter whose whole machine is built on
 * momentum rather than on distance.
 *
 * ## Its nine scripts, and therefore its ten states
 *
 * `0x45d090` copies word 4 of a script's header into `obj+0x18`, so the kinds of
 * the scripts this class installs ARE its alphabet. All nine were walked out of
 * the class's own data region, `0x474560`…`0x4747b8`, and the jump table at
 * `0x43a3e0` is indexed by `obj+0x18 - 1` (`0x439d8e`: `movsx eax, [esi+0x18];
 * dec eax; cmp eax, 9; ja <return>`), so it is **kinds 1 to 10** and state 0 is
 * not a state at all — a zero falls through the `ja` to the common return.
 *
 * ```
 *   1  0x474560  one cel, 1841: the statue, until the player enters its rect
 *   2  0x474570  tag 0/1 two standing poses, tag 2 the guard, tag 5 the back-off
 *   3  ——        no script; table entry 2 is the common return
 *   4  0x474648  tag 0/1 the coast, tag 4 the six-cel push-off, tag 5 the brake
 *   5  0x4745f8  tag 0 the crouch and jump, tag 1 the arc, tag 2 the landing
 *   6  0x4746a8  tag 0 the walk to the switch, tag 1 the pull — the LEVER job
 *   7  0x4746f8  tag 0/1 the two knife lunges, 2/3 the follow-through,
 *                tag 4 the wind-up that THROWS, tag 5 the recovery
 *   8  0x4745c0  the push-off it takes away while the player is down
 *   9  0x474790  the death, 1860…1864
 *  10  0x474770  the flinch, three one-cel tags
 * ```
 *
 * ## The AI struct, which is NOT the punk's
 *
 * `0x4363c0` mallocs `0x38` bytes and fills them, and only two of the slots line
 * up with `initwerea`:
 *
 * ```
 *   AI+0x00  word   0x40e300(0x19) — HEALTH, 25 scaled. Not a nerve.
 *   AI+0x02  dword  [0x4ac3d4], the player object
 *   AI+0x06  dword  the LEVER this one is minding, or 0 — `0x438200` fills it
 *   AI+0x0a  dword  the record rect's low point   (creator arg 3)
 *   AI+0x0e  dword  the record rect's high point  (creator arg 4)
 *   AI+0x12  word   the blocked counter, 0..3 — how many frames it has been
 *                   stuck against an obstacle before it jumps
 *   AI+0x14  ...    the tracker `0x45ef70` seeds, and the second argument to
 *                   `0x45efd0` at `0x439cb2`
 *   AI+0x36  word   the corpse countdown, `[0x46b204]` — {@link Enemy.linger}
 * ```
 *
 * So `AI+0` is what the bar reads and what the hit handler spends, **not**
 * {@link Enemy.nerve}: nothing in this class rolls a coin against it. The rect
 * is at `AI+0xa`, not `AI+8`, which is why `0x439da5` does `add edi, 0xa` before
 * handing it to `0x434200`. There is no side slot, no beat and no decision
 * budget — this class never carries any of the three.
 *
 * ## The stack frame, and how it was pinned
 *
 * `0x439ca0` does `sub esp, 0x10` and takes the buffer address with `lea eax,
 * [esp]` **before** it pushes anything, so the sixteen bytes `0x45efd0` fills
 * sit at `esp0-0x10`. Three pushes (`esi`, `edi`, the buffer) and one more (the
 * tracker) go under it, and `add esp, 8` at `0x439cb7` leaves `esp = esp0-0x18`
 * for the whole body. That puts the buffer at **`esp+8`**, one slot lower than
 * the punk's:
 *
 * ```
 *   [esp+0x08]  out+0    side — 1 in front, 0 behind, 2 he carries no vx
 *   [esp+0x0c]  out+4    band
 *   [esp+0x0e]  out+6    his cel carries a strike box
 *   [esp+0x10]  out+8    player.y - self.y
 *   [esp+0x12]  out+0xa  forward distance, negated when this one faces west
 * ```
 *
 * The cross-check is the argument slots, and both land: `mov edi, [esp+0x24]` at
 * `0x439caa` (esp is `esp0-0x1c` there) is `esp0+8`, the AI struct, and `mov
 * esi, [esp+0x1c]` at `0x439cc8` is `esp0+4`, the object. Read the buffer four
 * bytes high instead and `cmp word [esp+0xc], 3` — the band test that opens the
 * fight — becomes a test on the strike box, which compiles and looks sane.
 *
 * The band list is the fourth argument the creator pushes to `0x45ef70`
 * (`0x436432`): **`0x4747c0`**, `[400, 150, 85]` terminated by a zero, which
 * `0x45ef9f` copies while the next word is positive. `fights.ts` already carries
 * the same three.
 *
 * ## The one thing this port cannot express: `obj+0xc`
 *
 * This is a class on wheels. `0x45d1a3` hands every frame's `dx` to `0x42f8b0`,
 * which **adds** `dx / obj+0xe` into `obj+0xc` — an impulse, not an offset — and
 * `0x4363c0`'s sibling `0x439bd0` gives it `obj+0x1e = 0.05` through `0x42f7a0`,
 * a friction that bleeds that speed back off. So the six-cel push-off
 * (`0 60 70 80 120 0` over a divisor of 7) spends about 47 pixels a frame into
 * `obj+0xc` and the thing then COASTS on one cel, and three of its states are
 * written against how much of that coast is left:
 *
 * - `0x439f57` — under **20** and it pushes off again (state 4 tag 0/1);
 * - `0x43a21c` — under **10** and the knife lunge commits (state 7 tag 0/1);
 * - `0x439feb` — `obj+0x30`, which `0x430314`/`0x43031c` set exactly when
 *   `obj+0xa` and `obj+0xc` are BOTH zero, ends the brake (state 4 tag 5).
 *
 * The page moves a live foe by position, not by velocity: `walk.ts` spends a
 * frame's `dx` straight into `e.x` and only ever writes {@link Enemy.vx} for a
 * leap that lifts or a blow that throws, so a knifeboy on its feet has `e.vx`
 * flat zero. The three tests are written here against `e.vx` all the same, in
 * the disc's own engine-frame units ({@link coasting}), because that is the
 * quantity they ask about and a page that ever gives foes momentum gets the real
 * behaviour back for nothing. **What they answer today** is: the coast is always
 * spent, so state 4 tag 0/1 re-pushes at once, state 4 tag 5 brakes for exactly
 * one script, and — the one that shows — the knife lunge commits on its first
 * frame instead of riding the glide in. Cels 1850/1853 flash rather than travel.
 * That is a consequence of the missing momentum, not a choice made here.
 *
 * ## What this module owns, and what it does not
 *
 * States 1, 2, 4, 5, 7 and 8 are the ones it is in on its feet, and those are
 * here. State 3 has no script and no handler. State 6 is the lever job, which
 * the page owns outright ({@link Foe.lever}, and `walk.ts` returns before the
 * brain is ever called while a switch is still unlit); states 9 and 10 are the
 * death and the flinch, driven by `0x43a580` and by the page's own
 * {@link Foe.flinch}/{@link Foe.death} path. All four are named at
 * {@link NOT_HERE}.
 */
import { install, type Brain, type BrainCtx, type Enemy } from "./kit";

/**
 * The four states that are deliberately elsewhere, and what they carry.
 *
 * - **state 3** is not a state. Entry 2 of `0x43a3e0` is `0x43a3cf`, the common
 *   return, and no script in the class has kind 3. Nothing installs it.
 * - **state 6, `0x43a0c2`** — the lever, `0x4746a8`. The preamble at `0x439d04`
 *   runs `0x438200(AI+0xa, AI+0xe)` whenever `obj+0x18` is 2 or 4 — walk the
 *   world list for the first object whose point is inside this record's rect and
 *   whose `obj+0x44` is **3**, an unthrown switch — stores it at `AI+6`, turns
 *   to face it and installs kind 6 tag 0 on the spot. Tag 0 walks until
 *   `0x43a134` finds it within **0x25** (37) of the switch's x, and then either
 *   pulls it (tag 1) or, if the player is inside a hundred pixels, forgets the
 *   switch and knifes him instead. Tag 1, `0x43a188`, waits for `obj+0x42 == 7`
 *   — the second of the pull's three frames, 1857 — and calls
 *   `0x436820(lever.point, 0)`, which sounds `0x4a` or `0x4b` and turns the
 *   switch's own `0x473548` over; one time in three it also plays
 *   `0x434540(2) + 5` out of the mall bank. {@link Foe.lever} is all of that and
 *   `walk.ts` short-circuits the brain while a switch is still up, so porting it
 *   here would give one animation two owners.
 * - **state 9, `0x43a308`** — the corpse, `0x474790`. Tag 0 sets `obj+0x10` to
 *   `0xffec`, −20, so a dead one is free to lie twenty pixels above whatever it
 *   died on, and both tags count `AI+0x36` down and, on the frame it runs out,
 *   call `0x40cba0(self.point, -0xd, 0)` and return **1** — the only `mov ax, 1`
 *   in the whole of `0x439ca0`, and the frame the object is removed.
 * - **state 10, `0x43a3b8`** — the flinch, `0x474770`. Two instructions: wait
 *   for `obj+0x2e`, back on the ground, and then install kind 4 tag 4 and push
 *   off again. `0x43a744` only ever installs its tag 0, so the other two one-cel
 *   tags of that script are never played.
 *
 * And the handler that feeds the last two, `0x43a580`: `AI+0` is the health, a
 * blow takes the striking cel's speed off it and sounds `0xf`, GOOP **adds**
 * twenty and sounds `0xb`, and at zero it puts the friction back to 1.0, drops a
 * skateboard through `0x438450`, installs `0x474790`, pays `0xf0` and seeds
 * `AI+0x36` from `[0x46b204]`.
 */
const NOT_HERE = "0x43a0c2, 0x43a308, 0x43a3b8, 0x43a580" as const;

/**
 * The preamble, `0x439cba`, which is not behaviour and is not ported.
 *
 * While the player is inside the outermost band (`[esp+0xc] >= 1`) and in front
 * (`[esp+0x12] > 0`) it calls `0x40d1c0(AI+0, 0x40e300(0x19), 0x3330,
 * self.point)` — the on-screen enemy bar's claim, the same arbiter the zombie's
 * groan goes through. `foes.ts` already carries the triple as
 * `panel: { health: 25, plate: 13104, award: 240 }`.
 */
const PANEL = "0x439cd2" as const;

/**
 * What the wind-up throws, which a brain cannot make — there is no creator in
 * {@link BrainCtx} and nothing here spawns objects.
 *
 * `0x43a26c` ends kind 7 tag 4 by rolling `0x434540(4)` once and taking one of
 * two makers with it. Both do the same three things first: `0x430d40` a new
 * object of the class registered at **`0x43c500`** into `[0x4a7578]` (message
 * proc `0x43c520`, think `0x43c6f0`, two bytes of AI, cel bank `0x4a7020` — the
 * knifeboy's own book, one row along), copy the thrower's `obj+0x28` onto it,
 * copy the thrower's point, and then shift it: `obj+8 += 30` facing east or
 * `-= 30` facing west (`cmp [esi+0x28],1; sbb eax,eax; and eax,0x3c; sub eax,
 * 0x1e`), and `obj+6 -= 0x14`, twenty pixels up.
 *
 * Neither maker writes `obj+0xa` or `obj+0xc`. **The script is the velocity** —
 * `0x45d1a3` spends each frame's `dx`/`dy` into the pair through `0x42f8b0`,
 * over the projectile's own divisor of **2** (`0x43c53d`), so a `dx` of 100
 * reads as fifty pixels a frame.
 *
 * - **rolls 1 and 2 — `0x43a450`, sound `0x12`:** script `0x473670`, tag 0 on a
 *   further `0x434540(2)` of 1 and tag **2** on a 2. Both tags are one cel,
 *   **1870, `dx 100, dy 0`** — the knife itself, flat and fast. `0x43c621`
 *   hands tag 0 on to tag 1 and tag 2 on to tag 3 when it ends, seven cels
 *   1871…1877 with `dx 0 50 0 50 0 0 0`: the knife sticking and rattling.
 * - **rolls 3 and 4 — `0x43a500`, sound `0x11`:** script `0x4736f8` tag 0, one
 *   cel **1877, `dx 0, dy -30`** — something that goes straight up instead, and
 *   `0x43c691` drops it back down through 1876…1873.
 *
 * Both die on `obj+0x2e` or `obj+0x2a` — landing, or hitting something.
 */
const THROW = {
  knife: {
    cls: "[0x4a7578], registered 0x43c500, think 0x43c6f0",
    maker: "0x43a450",
    script: "0x473670 tag 0 or tag 2",
    cel: 1870,
    dx: 100,
    dy: 0,
    divisor: 2,
    sound: 0x12,
  },
  lob: {
    cls: "[0x4a7578], registered 0x43c500, think 0x43c6f0",
    maker: "0x43a500",
    script: "0x4736f8 tag 0",
    cel: 1877,
    dx: 0,
    dy: -30,
    divisor: 2,
    sound: 0x11,
  },
  /** `0x43a475`…`0x43a499` — both makers, identically */
  offset: { x: 30, y: -20, from: "0x43a495 / 0x43a499" },
} as const;

/**
 * Its repertoire, by kind and tag, straight out of `0x474560`…`0x4747b8`.
 *
 * A tag's frames are the contiguous run starting at the first frame carrying it
 * (`0x45d0b9` scans forward for the tag, `0x45d14a` ends the script when the
 * next frame's tag differs), which is why `0x474648`'s two trailing cel-0 frames
 * — they carry tag 0 again, after tag 5 — are unreachable padding and not part
 * of the coast.
 *
 * Nothing here auto-repeats: `obj+0x4a` is the animator's own loop flag
 * (`0x45d1b2`) and neither `0x439bd0` nor `0x4363c0` ever sets it, so every
 * script in this class ends, raises `obj+0x46`, holds its last cel, and waits
 * for the machine to install the next one.
 */
export const KNIFEBOY = {
  /** kind 1 — one cel, going nowhere: what `0x439c2f` puts a fresh one down in */
  statue: { cels: [1841], hold: 1, kind: 1, tag: 0, from: "0x474560 tag 0" },
  /**
   * kind 2 tags 0 and 1 — the two poses it stands in between decisions, and the
   * pair `0x439ec1` and nothing else rolls between
   */
  poise: [
    { cels: [1841], hold: 1, kind: 2, tag: 0, from: "0x474570 tag 0" },
    { cels: [1844], hold: 1, kind: 2, tag: 1, from: "0x474570 tag 1" },
  ] as const,
  /** kind 2 tag 2 — three frames of one cel: the guard it puts up on a swing */
  guard: {
    cels: [1843, 1843, 1843],
    hold: 1,
    kind: 2,
    tag: 2,
    from: "0x474570 tag 2",
  },
  /** kind 2 tag 5 — the only script in the class that travels BACKWARDS */
  backOff: {
    cels: [1843, 1843, 1842, 1841],
    hold: 1,
    dx: [0, -70, -80, -70],
    kind: 2,
    tag: 5,
    from: "0x474570 tag 5",
  },
  /**
   * kind 4 tags 0 and 1 — the coast. One cel apiece and no stride at all: the
   * push-off's speed is already in `obj+0xc` and these are what it rides on
   */
  coast: [
    { cels: [1845], hold: 1, kind: 4, tag: 0, from: "0x474648 tag 0" },
    { cels: [1840], hold: 1, kind: 4, tag: 1, from: "0x474648 tag 1" },
  ] as const,
  /** kind 4 tag 4 — the six-cel push-off, and {@link Foe.gait} is this exactly */
  push: {
    cels: [1840, 1841, 1842, 1843, 1844, 1845],
    hold: 1,
    dx: [0, 60, 70, 80, 120, 0],
    kind: 4,
    tag: 4,
    from: "0x474648 tag 4",
  },
  /** kind 4 tag 5 — one cel of −40: the brake, and what every attack ends in */
  brake: {
    cels: [1844],
    hold: 1,
    dx: [-40],
    kind: 4,
    tag: 5,
    from: "0x474648 tag 5",
  },
  /** kind 5 tag 0 — three frames of gathering and then the jump, `dy -325` */
  crouch: {
    cels: [1841, 1841, 1841, 1840],
    hold: 1,
    dx: [-10, -50, -50, 80],
    dy: [0, 0, 0, -325],
    kind: 5,
    tag: 0,
    from: "0x4745f8 tag 0",
  },
  /** kind 5 tag 1 — the arc over whatever it was stuck on */
  arc: {
    cels: [1842, 1842, 1842],
    hold: 1,
    dx: [40, 80, 40],
    dy: [-5, 10, 10],
    kind: 5,
    tag: 1,
    from: "0x4745f8 tag 1",
  },
  /** kind 5 tag 2 — and down */
  land: {
    cels: [1842, 1841],
    hold: 1,
    kind: 5,
    tag: 2,
    from: "0x4745f8 tag 2",
  },
  /**
   * kind 7 tags 0 and 1 — the two knife lunges, the pair `0x439f7b`,
   * `0x439fd6` and `0x43a14e` all roll between. `dx 60` on the first cel and
   * nothing on the second: the lunge is meant to be ridden in on the coast
   */
  lunge: [
    {
      cels: [1850, 1851],
      hold: 2,
      dx: [60, 0],
      kind: 7,
      tag: 0,
      from: "0x4746f8 tag 0",
    },
    {
      cels: [1853, 1854],
      hold: 2,
      dx: [60, 0],
      kind: 7,
      tag: 1,
      from: "0x4746f8 tag 1",
    },
  ] as const,
  /** kind 7 tags 2 and 3 — the follow-through, and `0x43a23c` picks it by tag+2 */
  follow: [
    { cels: [1852], hold: 2, kind: 7, tag: 2, from: "0x4746f8 tag 2" },
    { cels: [1855], hold: 2, kind: 7, tag: 3, from: "0x4746f8 tag 3" },
  ] as const,
  /** kind 7 tag 4 — six cels going nowhere, and the frame it ends is the THROW */
  windUp: {
    cels: [1850, 1851, 1852, 1853, 1854, 1855],
    hold: 2,
    kind: 7,
    tag: 4,
    from: "0x4746f8 tag 4",
  },
  /** kind 7 tag 5 — what it stands through while the knife is in the air */
  recover: {
    cels: [1857, 1858],
    hold: 2,
    kind: 7,
    tag: 5,
    from: "0x4746f8 tag 5",
  },
  /** kind 8 — the same six cels as the push-off, at half the rate, going AWAY */
  flee: {
    cels: [1840, 1841, 1842, 1843, 1844, 1845],
    hold: 2,
    dx: [0, 60, 70, 80, 120, 0],
    kind: 8,
    tag: 0,
    from: "0x4745c0 tag 0",
  },
  /** `0x4747c0` — the descending list `0x45efd0` reads the band out of */
  bands: [400, 150, 85],
  /**
   * `0x4a75b0` sound ids, and note the bank: this is `mall.snd`, **not** the
   * `0x4a7910` {@link BrainCtx.say} is documented against. `coke.ts` has the
   * same note for the same chapter.
   *
   * `0x439dd2` wakes it with 0xe; `0x43a229` grunts 0x10 on the frame the lunge
   * commits. The throws' own two are in {@link THROW}, and the blow sounds
   * (0xf and 0xb) belong to `0x43a580`, not here.
   */
  wake: 0xe,
  strike: 0x10,
  from: "0x439ca0",
} as const;

/** the port's `e.vx` is per TICK and `obj+0xc` is per engine frame — `walk.ts` */
const TICK = 0.5;

/**
 * `obj+0xc`, read the way the three states that care about it read it.
 *
 * `0x439f4e` and `0x43a213` both do `movsx eax, [esi+0xc]; cdq; xor; sub` — an
 * absolute value on the signed word — and compare it against a plain constant in
 * engine-frame pixels. {@link Enemy.vx} is the same quantity per tick, so the
 * scale comes back out before the comparison. See the module note: a live foe on
 * this page carries none of it, so this answers `false` every time today.
 */
function coasting(e: Enemy, atLeast: number): boolean {
  return Math.abs(e.vx) / TICK >= atLeast;
}

/**
 * Is the speed it has pointing the way it faces — `0x439f2a` and `0x439ff2`.
 *
 * Both spell it out the long way: mirror set and `obj+0xc > 0`, or mirror clear
 * and `obj+0xc < 0`, is speed going the WRONG way. A zero answers neither test
 * and so counts as going the right way, which is what keeps the brake's loop at
 * `0x43a00e` closed until `obj+0x30` opens it.
 */
function slidingBack(e: Enemy): boolean {
  return e.facing < 0 ? e.vx > 0 : e.vx < 0;
}

/**
 * `obj+0x30`, and it is the one velocity flag the port CAN answer.
 *
 * `0x430314`/`0x43031c` — the mover's last act — writes 1 when `obj+0xa` and
 * `obj+0xc` are both zero and 0 otherwise. A foe this page is not throwing has
 * neither, so a knifeboy standing on the floor is at rest, exactly as the disc
 * would have it.
 */
function atRest(e: Enemy): boolean {
  return e.vx === 0 && e.vy === 0;
}

/**
 * `initknifeboy`'s own machine — states 1, 2, 4, 5, 7 and 8.
 *
 * ## The return value
 *
 * Every path in `0x439ca0` ends at `0x43a3cf`, `xor ax, ax`, the waiting returns
 * included; the two `mov ax, 1` are both inside state 9, on the frame the corpse
 * is deleted. So **every path here returns `false`**. Returning `true` would
 * freeze the thing mid-push with its stride unspent.
 *
 * ## The preamble, which runs before the jump table
 *
 * Three things, in order. The bar claim is {@link PANEL} and is not behaviour.
 * The lever seek at `0x439d04` is {@link NOT_HERE}. The third is here: from
 * `0x439d43`, if `0x402f60` says the player is not upright and this one is not
 * already fleeing (state 8), not a statue (state 1) and not dying (state 9), it
 * installs kind 8 and turns **away** from him — `0x439d7c` sets the mirror to 1,
 * west, when its own x is BELOW his, which is the far side from where he is
 * lying. It then falls into the jump table with `obj+0x18` freshly rewritten to
 * 8, whose handler opens on the `obj+0x46` that `0x45d090` has just cleared, so
 * the frame ends there. The punk faces a downed player and mills at him
 * (`0x44e6f7`); this one skates off.
 */
export const knifeboy: Brain = (e, foe, run, k) => {
  const done = e.clock >= run;
  const t = k.track(e, KNIFEBOY.bands);
  const state = e.script ?? 0;
  const tag = e.tag ?? 0;

  // `0x439d43` — and states 1, 8 and 9 are the three it does not interrupt
  if (k.player.down && state !== 1 && state !== 8 && state !== 0) {
    e.facing = e.x < k.player.x ? -1 : 1; // `0x439d7c`, and it is AWAY from him
    return install(e, KNIFEBOY.flee);
  }

  switch (state) {
    /**
     * ---- 0 and 1, `0x439da3`: the statue.
     *
     * Zero its speed, and do nothing at all until `0x434200` puts the player's
     * own point inside `AI+0xa`, this record's rect — {@link Enemy.fighting}.
     * Then one sound and straight into the push-off.
     *
     * Kind 0 is folded in because the PAGE uses it: `walk.ts` writes
     * `e.script = 0` on the frame the player leaves the rect, and this class has
     * no state 0 — `0x439c2f` lays a fresh one down in kind 1 and the table's
     * `dec eax` drops a zero through to the common return. Installing the statue
     * on that frame is what puts the port back on a state the disc has.
     */
    case 0:
    case 1: {
      e.vx = 0; // `0x439da8`
      e.vy = 0;
      if (!e.fighting) return install(e, KNIFEBOY.statue);
      k.say(e, KNIFEBOY.wake); // `0x439dd2`
      return install(e, KNIFEBOY.push);
    }
    /**
     * ---- 2, `0x439de4`: standing, guarding, backing off — and it turns first.
     *
     * `0x439dec` flips the mirror whenever the forward distance has gone
     * negative, and that happens before anything else, every frame, without
     * returning. `0x439df0` then reads `obj+0x2c` — the mover's own "I am inside
     * an obstacle" flag, which `wered.ts` already documents and which this page
     * cannot set, because it does not run foes through the obstacle solver. Four
     * frames of it in a row (`AI+0x12`) sends the class into kind 5, the jump.
     * That counter and that entry are dead here; kind 5 is written out below all
     * the same.
     */
    case 2: {
      if (t.forward < 0) e.facing = -e.facing;
      switch (tag) {
        // `0x439e37` — the two standing poses, and the whole of its opening move
        case 0:
        case 1: {
          // inside 85 and it wants out: the one script in the class that retreats
          if (t.band === 3) return install(e, KNIFEBOY.backOff);
          /**
           * `0x439e63` — and the band being none of 0, 1 or 2 means −1, behind
           * it. Then it only reacts at all if the player is actually mid-blow
           * (`out+6`, his cel's strike box); otherwise it stands and waits.
           */
          if (t.band < 0 || t.band > 2) {
            if (!k.player.swinging) return false;
            return install(e, KNIFEBOY.guard);
          }
          /**
           * `0x439e7b` — half the time the wind-up goes out regardless, and the
           * other half it compares the two mirror flags: facing the same way as
           * him is his back turned, and that is also a wind-up. Only a player
           * looking at it gets walked at instead.
           */
          if (k.roll(2) === 1) return install(e, KNIFEBOY.windUp, true);
          if (k.player.facing !== e.facing) return install(e, KNIFEBOY.push);
          return install(e, KNIFEBOY.windUp, true);
        }
        // `0x439ea9` — the guard holds until he swings again, then it shifts pose
        case 2:
          if (!k.player.swinging) return false;
          return install(e, KNIFEBOY.poise[k.roll(2) - 1]);
        // `0x439ecc` — and the back-off simply ends, on its own script's clock
        case 5:
          return done ? install(e, KNIFEBOY.poise[0]) : false;
        // tags 3 and 4 do not exist in `0x474570`; the table sends them home
        default:
          return false;
      }
    }
    /**
     * ---- 4, `0x439ee3`: the skate — push off, coast, brake.
     *
     * Same `obj+0x2c` preamble as state 2 and the same four-frame counter into
     * the jump, and the same reason it is not here.
     */
    case 4: {
      switch (tag) {
        /**
         * `0x439f2a` — the coast, and the three things that end it.
         *
         * Speed pointing the wrong way, or under twenty a frame, and it pushes
         * off again. Otherwise: the player behind it brakes; the player in the
         * second band — 150 to 400, which is exactly a coast's length — draws a
         * lunge; anything else and it keeps rolling.
         */
        case 0:
        case 1: {
          if (slidingBack(e) || !coasting(e, 20))
            return install(e, KNIFEBOY.push);
          if (t.forward < 0) return install(e, KNIFEBOY.brake);
          if (t.band !== 1) return false;
          return install(e, KNIFEBOY.lunge[k.roll(2) - 1], true);
        }
        /**
         * `0x439f92` — the push-off ends, and what it ends in is the band.
         *
         * Band 1 drops onto one of the two coast poses; every other band —
         * beyond 400, inside 150, or behind — goes straight to a lunge.
         *
         * `0x439fac` installs kind 4 tag 4 first, on the player being behind or
         * beyond the outermost band, and then falls through into the install
         * below without a jump. `0x45d090` rewrites `obj+0x3e`, `0x18`, `0x42`,
         * `0x44`, `0x46` and `0x48` wholesale, so the second one erases the
         * first completely: it is a dead store in the disc and is not ported.
         */
        case 4: {
          if (!done) return false;
          return t.band === 1
            ? install(e, KNIFEBOY.coast[k.roll(2) - 1])
            : install(e, KNIFEBOY.lunge[k.roll(2) - 1], true);
        }
        /**
         * `0x439feb` — the brake, which repeats until the speed is gone.
         *
         * `obj+0x30` set, or the speed already pointing back the other way, and
         * it is done: turn to face him and take one of the standing poses. On
         * this page {@link atRest} is true the moment it arrives, so the brake
         * plays once and hands over.
         */
        case 5: {
          if (!atRest(e) && !slidingBack(e)) {
            return done ? install(e, KNIFEBOY.brake) : false;
          }
          if (t.forward < 0) e.facing = -e.facing; // `0x43a028`
          return install(e, KNIFEBOY.poise[0]);
        }
        // tags 2 and 3 do not exist in `0x474648`
        default:
          return false;
      }
    }
    /**
     * ---- 5, `0x43a038`: the jump, and nothing on this page can start it.
     *
     * Its only entry is the `obj+0x2c` counter in states 2, 4 and 6 — four
     * frames wedged against an obstacle — and the port has no obstacle flag to
     * set. The three tags are a straight chain all the same: the crouch can
     * re-trigger itself while it is still stuck, then the arc, then the landing,
     * and the landing hands to the brake like every other attack in the class.
     */
    case 5: {
      if (!done) return false;
      if (tag === 0) return install(e, KNIFEBOY.arc, true); // `0x43a08d`
      if (tag === 1) return install(e, KNIFEBOY.land, true); // `0x43a0a4`
      if (tag === 2) return install(e, KNIFEBOY.brake); // `0x43a0bb`
      return false;
    }
    /**
     * ---- 7, `0x43a1df`: the knife.
     *
     * The state opens on `0x402f60` — the player going down mid-lunge abandons
     * it into the brake — and then splits six ways on the tag.
     */
    case 7: {
      if (k.player.down) return install(e, KNIFEBOY.brake);
      switch (tag) {
        /**
         * `0x43a204` — the lunge, and the frame it commits on.
         *
         * Three ways in: `obj+0x2a`, the elastic solver's "something hit me"
         * word (`rat.ts` documents it; nothing on this page writes one, so that
         * branch is dead here too), the player slipping behind, or the coast
         * dropping under ten a frame. Any of them and it grunts and advances to
         * `tag + 2`, its own follow-through cel.
         */
        case 0:
        case 1: {
          if (t.forward >= 0 && coasting(e, 10)) return false;
          k.say(e, KNIFEBOY.strike); // `0x43a229`
          return install(e, KNIFEBOY.follow[tag], true);
        }
        // `0x43a25a` — and the follow-through brakes
        case 2:
        case 3:
          return done ? install(e, KNIFEBOY.brake) : false;
        /**
         * `0x43a26c` — the wind-up, and the frame it ends is the only frame this
         * class makes anything.
         *
         * It installs the recovery first and then rolls `0x434540(4)` once: 1
         * and 2 take `0x43a450` and sound `0x12`, 3 and 4 take `0x43a500` and
         * sound `0x11`. A brain has no creator, so what comes out is written
         * down at {@link THROW} and only the sound is played.
         */
        case 4: {
          if (!done) return false;
          const out = install(e, KNIFEBOY.recover, true);
          k.say(e, k.roll(4) < 3 ? THROW.knife.sound : THROW.lob.sound);
          return out;
        }
        // `0x43a2d1` — and the recovery brakes, same as the follow-through
        case 5:
          return done ? install(e, KNIFEBOY.brake) : false;
        default:
          return false;
      }
    }
    /**
     * ---- 8, `0x43a2e3`: what it does while the player is down.
     *
     * Keep skating away for as long as he stays down; the frame `0x402f60` says
     * he is upright again, push off — and the facing it kept from the preamble
     * is the one pointing away, so it turns itself round through state 4's own
     * `0x43a028` a script or two later rather than here.
     */
    case 8: {
      if (!done) return false;
      return k.player.down
        ? install(e, KNIFEBOY.flee)
        : install(e, KNIFEBOY.push);
    }
    // state 3 has no script, and 9 and 10 are the page's — see `NOT_HERE`
    default:
      return false;
  }
};

export {
  NOT_HERE as KNIFEBOY_NOT_HERE,
  PANEL as KNIFEBOY_PANEL,
  THROW as KNIFEBOY_THROW,
};
