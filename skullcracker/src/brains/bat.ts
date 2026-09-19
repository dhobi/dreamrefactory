/**
 * The bat — `initbat`, `0x422ef0`, and the smallest class machine in the game.
 *
 * Forty-five of them across three books (CAVERN 10, RAVECAVE 27, TOWER 8), and
 * the only flying creature that is not a boss. Creator `0x41ead0`, class proc
 * `0x422e10`, think `0x422ef0`, hit `0x4232f0`.
 *
 * ## Its five scripts, and therefore its four states
 *
 * `0x45d090` writes a script's own kind into `obj+0x18`, so the kinds ARE the
 * alphabet. `0x422f3c` is `jmp [eax*4 + 0x4232c8]` over `obj+0x18 - 1`, four
 * entries, so the machine runs on kinds **1 to 4**:
 *
 * ```
 *   0  0x46f050  one cel, 2200 — and NOTHING installs it. No table entry either
 *   1  0x46f130  one cel, 2206 — hanging up there. `0x422f43`
 *   2  0x46f0b8  three tags: the stir, the drop, the levelling out. `0x422f96`
 *   3  0x46f060  four tags: the cruise and its three dives. `0x423071`
 *   4  0x46f140  two cels — the death, and the page owns it. `0x42329e`
 * ```
 *
 * ## It does NOT home on the player, and that is the headline
 *
 * The page currently drives this class through {@link Foe.chases}, whose whole
 * reading is one instruction misread: `0x422f0e`..`0x422f26` is
 *
 * ```
 *   mov  ax, word ptr [esi+0xc]        ; READ the horizontal velocity
 *   cmp  ax, 0x1b       jle ...
 *   mov  word ptr [esi+0xc], 0x1b      ; ...and clamp it to +27
 *   cmp  ax, 0xffe5     jge ...
 *   mov  word ptr [esi+0xc], 0xffe5    ; ...or to -27
 * ```
 *
 * — a **clamp on `obj+0xc`**, the first thing the think does, every frame,
 * whatever state it is in. It never reads the player's x at all. `Foe.chases`
 * took the 27 to be "the brain's reading of how far ahead the player is,
 * clamped to ±px and written straight into `obj+0xc`", and flies the thing at
 * the player on both axes at a fixed rate. Nothing in `0x422ef0` does that.
 *
 * What the class actually does is fly **flat, in the direction it faces**, and
 * turn round only when the player has fallen a long way behind it (140 pixels in
 * the cruise, `0x4230bf`; 100 in a dive, `0x4231f4` and `0x42324b`). Vertically
 * it flutters UP by one to seven pixels a frame for ever (`0x4230a3`) until the
 * room's ceiling stops it, and it only descends inside a dive. So it is a
 * ceiling-hugger that drops on you, not a heat-seeker; and the one thing it
 * homes on is your HEIGHT — every dive is armed by `player.y - self.y >= 100`
 * (`0x4230e9`) and steered by `player.y - self.y > 45` (`0x4231b7`,
 * `0x423240`), with the horizontal left entirely to which way it happens to be
 * pointing.
 *
 * ## The horizontal speed is the script's own `dx`, accumulating
 *
 * This is the part without which the machine reads as dead code, so it is set
 * out in full. `0x45d1a3` hands every animation frame's `dx` and `dy` to
 * `0x42f8b0`, which divides each by the class's `obj+0xe` — **1** for a bat
 * (`0x422e2b`), the lowest divisor in the game — rounds away from zero, and
 * **adds** them into `obj+0xc` and `obj+0xa`. A script's stride is an IMPULSE
 * into the velocity, not an offset on the position; `0x42fd9e` then moves the
 * object by `obj+0xc`/`obj+0xa` and by nothing else.
 *
 * So the cruise's `dx 3` accelerates the bat by three pixels a frame², and the
 * clamp above is its terminal speed of 27. That is what arms the dive:
 * `0x4230d5` wants `|obj+0xc| >= 13`, which a bat reaches about five frames
 * after it starts cruising and which a bat that has just this moment dropped off
 * the ceiling does not have. **This page's foe mover applies a script's `dx`
 * straight to `e.x` instead**, and leaves `e.vx` at zero — under which
 * `0x4230d5` is never satisfied and a bat never dives at all. So {@link fly}
 * below keeps `e.vx` itself, the way `0x42f8b0` does; the page then moves the
 * thing by `e.vx` (its stride block is gated on `e.vx === 0`) and the two models
 * do not double up.
 *
 * The other class that spawns these is the check on that reading: `0x426340`,
 * the belfry boss's own bat-thrower, caps the population at sixteen and launches
 * each one with `obj+0xc = ±30` already on it (`0x42638f`: `sbb eax, eax; and
 * eax, 0x3c; sub eax, 0x1e`) straight onto `0x46f060` **tag 1**, the dive. A
 * thrown bat dives at once because it is thrown up to speed; a hanging one has
 * to fly itself up to speed first.
 *
 * ## What this module owns, and what it does not
 *
 * States 1, 2 and 3 are the ones a bat is in while it is alive, and those are
 * here. State 4 is the death and the page already drives it through
 * {@link Foe.death} and {@link Foe.frail}; see {@link NOT_HERE}.
 *
 * ## The stack frame, which is where the field numbers come from
 *
 * `0x422ef0` does `sub esp, 0x10`, takes the output pointer as `lea eax,
 * [esp+4]` **before** any push, and then pushes `esi` and `edi`. So after the
 * `add esp, 8` at `0x422f0b` the twelve bytes `0x45efd0` fills sit at
 * **`esp+0xc`**, and `esp+0x16` is `out+0xa`, the forward distance.
 *
 * Two readings of the same literal pin it. `mov edi, [esp+0x24]` at `0x422efa`
 * runs with three dwords pushed (`esi`, `edi`, the out pointer) and answers the
 * AI struct, `E+8`; `mov esi, [esp+0x24]` at `0x422f07` runs with four pushed
 * and answers the object, `E+4`. Both are the argument slots, and they fix `E`
 * exactly — from which the buffer is `E-0xc` and `esp+0x16` is `E-2`, its last
 * word. Read four bytes low and `esp+0x12` would be the strike-box flag, which
 * would compile and would be a different animal.
 *
 * And `obj+6` is the **Y**, `obj+8` the X: `0x42fd9e` adds `obj+0xc` to the high
 * word of the dword at `obj+6` and `obj+0xa` to the low word, which settles both
 * the position pair and the velocity pair at once.
 *
 * ## The band list is registered and never read
 *
 * `0x41eb2c` pushes `0x46f158` as the fourth argument to `0x45ef70`, and the
 * words there are `600, 250, 50, 0` — three bands, since `0x45ef8a` stops at the
 * first non-positive. Every one of them is dead weight: the only slot of
 * `0x45efd0`'s output this class ever reads is `esp+0x16`. There is no band
 * test, no side test, no "is he mid-blow" test anywhere in `0x422ef0`. The list
 * is carried below for the record and {@link bat} asks the tracker for it only
 * because `forward` comes out of the same call.
 */
import {
  install,
  type Brain,
  type BrainCtx,
  type Enemy,
  TICK_SCALE,
} from "./kit";
import type { FoeAnim } from "../foes";

/**
 * State 4 and the hit handler — read, not done, because the page owns them.
 *
 * - **state 4, `0x42329e`, the death.** `0x42f850(obj, 1.0f)` turns its gravity
 *   back on — the creator gave it **zero** (`0x422e5f`), which is why a live bat
 *   floats ({@link Foe.floats}) — and `obj+0x10`, the floor offset, goes to
 *   **-150**, so the body is free to fall a hundred and fifty pixels past
 *   whatever it would have stood on. It is the one path in the class that
 *   answers `mov ax, 1` rather than `xor ax, ax`, and only on the frame
 *   `obj+0x2e` says it has landed: that return is the object being removed.
 * - **`0x4232f0`, the hit handler.** There is no subtraction in it anywhere. It
 *   asks `0x430ee0` whether the thing that hit it is one of its own class and
 *   does nothing if so; otherwise it sprays sixty (`0x40cba0(point, 0x3c, 0)`),
 *   installs `0x46f140`, sets `obj+0xa = -40` so the corpse is thrown upward
 *   first, pays **seventy** points (`0x40d450(0x46)`) and plays `0012 bat hit`.
 *   One blow of any size, which is {@link Foe.frail}.
 * - **`obj+0x1a`, the strength percent.** `0x422f30` zeroes it at the top of
 *   every think and `0x423199` sets it to **0x14** — twenty — for the two dive
 *   tags that carry the strike, and for nothing else; the steep dive, tag 3,
 *   goes in at zero. `0x430470` scales the shove it lands by that. Nothing hits
 *   the player back in this port, so it is read and spends nothing.
 * - **`obj+0x22 |= 0xc`, `0x422e75`.** Bits 4 and 8 are the two horizontal wall
 *   bounces (`0x430072`, `0x4300e9`) — a bat rebounds off the room's left and
 *   right edges rather than walking through them — but its restitution
 *   (`obj+0x20`, `0x422e6a`) is zero, so the rebound is simply a stop. The page
 *   pins a foe inside `roomSpan` already, which is the same outcome.
 */
const NOT_HERE = "0x42329e, 0x4232f0, 0x423199, 0x422e75" as const;

/**
 * Its whole repertoire, by kind and tag, out of `0x46f050`…`0x46f150`.
 *
 * Five scripts and eleven tags between them, which is the smallest book any
 * creature in the game has. Nothing it plays carries a `dy` — a bat's whole
 * vertical is `obj+0xa` written by the states below — and every `dx` is an
 * impulse of three or four through a divisor of one.
 */
export const BAT = {
  /**
   * kind 0 tag 0 — cel 2200, one frame, and **no state owns it**.
   *
   * `0x422f36` is `dec eax` before the range check, so kind 0 falls through to
   * the common `xor ax, ax`: a bat in state 0 does nothing for ever. Nothing in
   * the executable installs `0x46f050` either — no `push 0x46f050` exists
   * anywhere in `SC.EXE`. It is left over, and it is listed only so the next
   * reader does not go looking for the state it would belong to.
   */
  orphan: { cels: [2200], hold: 1, kind: 0, tag: 0, from: "0x46f050 tag 0" },
  /** kind 1 — one cel, going nowhere: hanging from the roof of the cave */
  hang: { cels: [2206], hold: 1, kind: 1, tag: 0, from: "0x46f130 tag 0" },
  /**
   * kind 2 tag 0 — the stir. Eight cels of 2206/2207 at two ticks apiece, and
   * no stride at all: it shuffles on the spot before it lets go.
   */
  stir: {
    cels: [2206, 2207, 2206, 2206, 2207, 2206, 2207, 2207],
    hold: 2,
    kind: 2,
    tag: 0,
    from: "0x46f0b8 tag 0",
  },
  /** kind 2 tag 1 — three cels of 2206 with gravity on: the drop */
  drop: {
    cels: [2206, 2206, 2206],
    hold: 2,
    kind: 2,
    tag: 1,
    from: "0x46f0b8 tag 1",
  },
  /** kind 2 tag 2 — three cels of 2205 with gravity off again: levelling out */
  level: {
    cels: [2205, 2205, 2205],
    hold: 2,
    kind: 2,
    tag: 2,
    from: "0x46f0b8 tag 2",
  },
  /** kind 3 tag 0 — the cruise: four cels of wingbeat, `dx 3`, and it LOOPS */
  cruise: {
    cels: [2200, 2201, 2202, 2203],
    hold: 1,
    dx: [3, 3, 3, 3],
    kind: 3,
    tag: 0,
    from: "0x46f060 tag 0",
  },
  /** kind 3 tag 1 — one cel, 2204, `dx 4`: the dive, wings back */
  dive: {
    cels: [2204],
    hold: 1,
    dx: [4],
    kind: 3,
    tag: 1,
    from: "0x46f060 tag 1",
  },
  /** kind 3 tag 2 — one cel, 2201, `dx 4`: the same dive gone shallow */
  glide: {
    cels: [2201],
    hold: 1,
    dx: [4],
    kind: 3,
    tag: 2,
    from: "0x46f060 tag 2",
  },
  /** kind 3 tag 3 — the cruise's four cels at `dx 4`: every third dive */
  stoop: {
    cels: [2200, 2201, 2202, 2203],
    hold: 1,
    dx: [4, 4, 4, 4],
    kind: 3,
    tag: 3,
    from: "0x46f060 tag 3",
  },
  /**
   * `0x41eb2c` — the descending list handed to `0x45ef70`, and **nothing reads
   * it**. Carried because it is the class's, not because it is spent: see the
   * head of this file.
   */
  bands: [600, 250, 50],
  /**
   * `belfry.snd`, the chapter-three bank at `0x4a5870` — not the punk chapter's
   * `0x4a7910` — and the bank's own record names are the check on all three:
   * `0010 bat flappy`, `0011 bat squeak`, `0012 bat hit`.
   *
   * `0x423165` chirps 0 on every lap of the cruise it does not turn into a dive;
   * `0x422fd7` and `0x4230fa` squeak 1 as it lets go of the roof and as it
   * commits to a dive. 2 is the death's, and {@link Foe.hitSound} already plays
   * it.
   */
  flap: 0,
  squeak: 1,
  die: 2,
  from: "0x422ef0",
} as const;

/** thirty pixels an ENGINE frame, and a tick is half of one — as {@link werea} */
const TICKS = TICK_SCALE;

/**
 * `0x422f12`/`0x422f20` — the horizontal speed cap, applied before the dispatch.
 *
 * Twenty-seven pixels an engine frame, both ways, on every think in every state.
 * It exists because the cruise's own `dx` would otherwise accelerate the thing
 * without limit — see the head of this file.
 */
const CAP = 27;

/** `0x422e2b` — `obj+0xe`, and a bat is the one class in the game that divides by one */
const DIVISOR = 1;

/**
 * `0x4230d5` — how fast it must already be going before it will dive at all.
 *
 * Thirteen pixels a frame, which the cruise's `dx 3` reaches on its fifth frame.
 */
const UP_TO_SPEED = 13;

/** `0x4230e9` — and how far below it the player must be for a dive to be worth it */
const DIVE_BELOW = 100;

/** `0x4231b7`/`0x423240` — inside this, a dive levels off rather than steepening */
const PULL_UP = 45;

/** `0x4230bf` — the player this far behind it turns the cruise round */
const TURN_CRUISE = -140;

/** `0x4231f4`/`0x42324b` — and this far behind it breaks a dive off */
const TURN_DIVE = -100;

/**
 * `0x46a110` — the float `0x42f850` multiplies its argument by, so the player's
 * own `0x42f850(player, 1.0f)` leaves `obj+0x24 = 10`, ten pixels a frame².
 *
 * The bat's drop is `0x42f850(obj, 1.0f / 0x434540(3))` at `0x422ff5`, a THIRD,
 * a HALF or the whole of it, and `0x45f270` truncates: 3, 5 or 10.
 */
const ENGINE_GRAVITY = 10;

/**
 * The one number in this file that is not the disc's, and what it stands in for.
 *
 * The cruise sets `obj+0xa = -0x434540(7)` on **every** think (`0x4230a3`), so a
 * cruising bat rises one to seven pixels a frame for as long as it cruises, and
 * the only thing that ever stops it is the engine's own ceiling: `0x42ffbc`
 * compares the stepped y against the top of the rect `0x40ba30` hands back and
 * `0x42ffca` pins it at `top + 1`. (`obj+0x22` bit 2 is clear on a bat, so no
 * restitution is applied and `obj+0xa` is left pointing up — the position is
 * pinned and the velocity is not, which is what this reproduces.)
 *
 * This page runs no room rect for a floater — `stepEnemies` clamps a foe's x to
 * `roomSpan` and its y to nothing at all — so without a ceiling of some kind a
 * woken bat climbs out of the level in about five seconds. The record's own
 * `top` is the nearest thing {@link Enemy} carries, and the books say it is very
 * nearly right: every bat's point sits just under its record's top edge —
 * CAVERN's by 18 pixels (`top 2421`, `pointY 2439`), TOWER's by 9 to 11,
 * RAVECAVE's by up to 83. So it is where the level hung the thing, give or take
 * the height of a bat.
 *
 * If foes are ever given the room rect, this is the line to delete.
 */
const CEILING =
  "e.top — the record's own, standing in for 0x42ffbc's room rect";

/**
 * `0x45d090` rewinds the frame index unconditionally — `obj+0x42 = 0`,
 * `obj+0x46 = 0` — **including onto the script already playing**, which the
 * shared {@link install} deliberately does not.
 *
 * This class needs the difference. `0x42314f` reinstalls the cruise on top of
 * itself at the end of every lap and chirps as it does; leaving `e.clock` alone
 * there would keep `done` true for ever and the thing would chirp, and re-test
 * the dive, on every tick instead of every fourth frame.
 */
function restart(e: Enemy, a: FoeAnim): false {
  install(e, a);
  e.clock = 0;
  return false;
}

/**
 * `0x45d1a3` → `0x42f8b0`, and `0x422f0e`'s clamp on top of it.
 *
 * The frame's own `dx`, divided by `obj+0xe` and rounded away from zero, added
 * into `obj+0xc` once an engine frame and negated when the mirror flag is set.
 * Every tag a bat owns carries one `dx` across all its cels, so the frame index
 * does not have to be found: the first entry is the frame's.
 *
 * It is spent here at half strength every TICK rather than whole once a frame,
 * which sums to the same acceleration and needs no frame-edge test — and a test
 * on `e.clock` would be wrong anyway, since `0x423189` reinstalls the dive on
 * top of itself and rewinds the clock while it does. Hence `TICKS` twice: once
 * to turn the engine's pixels-a-FRAME into this page's pixels-a-tick, and once
 * to split the frame's impulse across the two ticks that make it up.
 */
function fly(e: Enemy): void {
  const dx = e.anim.dx?.[0] ?? 0;
  if (dx !== 0) {
    const step = dx / DIVISOR;
    e.vx +=
      (step < 0 ? -Math.ceil(-step) : Math.ceil(step)) *
      e.facing *
      TICKS *
      TICKS;
  }
  const cap = CAP * TICKS;
  e.vx = Math.max(-cap, Math.min(cap, e.vx));
}

/**
 * `initbat`'s own machine, states 1 to 3.
 *
 * ## The one thing to get right before writing another of these
 *
 * **A think function never suppresses the animation.** Every path in
 * `0x422ef0` ends `xor ax, ax`, the "my script has not finished" returns at
 * `0x422f6d` included. The single exception is `0x4232bd`, the frame the corpse
 * is removed, which is a state this module does not own. So every path below
 * returns `false`.
 */
export const bat: Brain = (e, foe, run, k) => {
  const done = e.clock >= run;
  // the tracker, for `out+0xa` alone — see the head of this file on the bands
  const t = k.track(e, BAT.bands);
  // `0x41eb39` — `AI+2`, the dive counter, seeded zero by the creator
  e.beat ??= 0;
  // the mover's impulse and then `0x422f0e`'s clamp, in that order
  fly(e);
  // ...and the ceiling the engine has and this page does not — {@link CEILING}
  if (e.y < e.top) e.y = e.top;
  switch (e.script ?? 0) {
    /**
     * ---- 0: not a state. `0x422f36`'s `dec eax` drops kind 0 into the common
     * return, and nothing installs `0x46f050` anyway ({@link BAT.orphan}).
     *
     * The only thing that can put a bat here is this page: `stepFight` sets
     * `e.script = 0` on the frame the player leaves a foe's rect. Nothing in
     * `SC.EXE` ever takes a woken bat back to a dormant state — `0x46f130` is
     * installed exactly twice, by the creator at `0x41eb51` and by state 1 on
     * itself at `0x422f7f` — so that reset has no counterpart here and should
     * be suppressed for this class. Falling through to state 1, the state a
     * newly created bat is in, is the least surprising thing to do with it.
     */
    case 0:
    /* falls through */
    /**
     * ---- 1, `0x422f43`: hanging, and the only thing that ends it.
     *
     * `0x434200(player.point, AI+4)` — his own point inside the four words
     * `0x41eb31` copied out of this `init` record. Not a radius and not a sight
     * line; the rect is an alarm and nothing else, and once it has gone off the
     * bat never comes back to this state.
     *
     * If the page's {@link Foe.wake} is left on this class it owns the same
     * test and this state never runs; with it off, this is it.
     */
    case 1:
      if (e.fighting) return restart(e, BAT.stir);
      // `0x422f7d` — otherwise it hangs there, reinstalling the one cel
      return done ? restart(e, BAT.hang) : false;
    /**
     * ---- 2, `0x422f96`: letting go of the roof, in three tags.
     *
     * Each one waits out its own script and hands to the next, and what the
     * middle one is FOR is the fall: `0x422ff5` turns the bat's gravity from
     * zero to a third, a half or the whole of the player's, `0x42302e` turns it
     * straight back off, and `0x42303f` then halves what is left of `obj+0xa`
     * every frame until the thing is flying level again.
     */
    case 2:
      return fall(e, k, done);
    // ---- 3, `0x423071`: the flight, and everything the class is for
    case 3:
      return flight(e, k, t, done);
    /**
     * ---- 4, `0x42329e`: the death, which the page plays — see {@link NOT_HERE}.
     */
    default:
      return false;
  }
};

/**
 * State 2, `0x422f96` — the three tags of coming off the ceiling.
 *
 * `obj+0x44` sub-dispatches; anything but 0, 1 or 2 falls into `0x422fac`'s bare
 * return, and the script has no other tags.
 */
function fall(e: Enemy, k: BrainCtx, done: boolean): boolean {
  switch (e.tag ?? 0) {
    /**
     * tag 0, `0x422fb5` — the stir, and it is where the fall is armed.
     *
     * `0x422fd7` squeaks, and `0x422fdf`..`0x422fff` is
     * `0x42f850(obj, 1.0f / 0x434540(3))`: the bat's gravity becomes a third, a
     * half or the whole of the player's, rolled fresh each time. Nothing else
     * in the class ever changes it, so the roll is the whole of how far this
     * particular bat drops before it levels out.
     */
    case 0: {
      if (!done) return false;
      k.say(e, BAT.squeak);
      /**
       * **`e.nerve` is NOT a nerve here.** `AI+0` on a bat is `0x3c` — sixty,
       * written once at `0x41eb23` and never read by anything — so the slot the
       * punk keeps its nerve in is free, and the drop's gravity divisor is kept
       * in it because {@link Enemy} has no per-foe gravity scale of its own and
       * the page never integrates one for a {@link Foe.floats} class. The three
       * frames of tag 1 below are the only place it is spent.
       */
      e.nerve = k.roll(3);
      e.vy = 0;
      return restart(e, BAT.drop);
    }
    /**
     * tag 1, `0x423010` — the drop itself. The think does nothing at all here
     * but wait for the three cels to play; the fall is `0x430327` adding
     * `obj+0x24` to `obj+0xa` once an airborne frame, which is what is spent
     * below. `0x42302e` then puts the gravity back to zero as it hands on.
     */
    case 1:
      // the engine's ten a frame² over the divisor tag 0 rolled, truncated by
      // `0x45f270` exactly as `0x42f850` truncates — 10, 5 or 3
      // ...spent per TICK rather than per frame, which is the same acceleration:
      // `g` pixels a frame² is `g * TICKS` more velocity a frame, half of it a tick
      e.vy += Math.trunc(ENGINE_GRAVITY / (e.nerve || 1)) * TICKS * TICKS;
      if (!done) return false;
      return restart(e, BAT.level);
    /**
     * tag 2, `0x42303f` — levelling out. `obj+0xa` is halved toward zero on
     * every think, in whole pixels a frame, and when the three cels are done the
     * bat is in the air and cruising.
     */
    default:
      // once an ENGINE frame: this tag is installed once and then simply waits,
      // so the clock runs clean and its whole-number ticks are the frame edges
      if (Number.isInteger(e.clock)) {
        e.vy = Math.trunc(e.vy / TICKS / 2) * TICKS;
      }
      if (!done) return false;
      return restart(e, BAT.cruise);
  }
}

/**
 * State 3, `0x423071` — the flight, and the four tags it is made of.
 *
 * The preamble is the one branch in the class that cannot fire as shipped:
 * `0x423071` turns the bat round and restarts the cruise when `obj+0x20` is
 * non-zero, and `obj+0x20` is the RESTITUTION (`0x42f7f0` stores `f * -8192`
 * there; `0x42ff02` and `0x430085` are what read it). `0x422e6a` gives a bat
 * `0.0f`, and nothing else ever writes the field, so the test is dead. It is
 * left unported rather than guessed at — if it was meant to be `obj+0x2c`, the
 * "I was pushed off something" flag the same mover sets, this page carries no
 * such flag either.
 */
function flight(
  e: Enemy,
  k: BrainCtx,
  t: ReturnType<BrainCtx["track"]>,
  done: boolean,
): boolean {
  const below = k.player.y - e.y;
  switch (e.tag ?? 0) {
    /**
     * tag 0, `0x4230a3` — the cruise, and the state a bat spends its life in.
     *
     * `obj+0xa = -0x434540(7)` every think: it flutters upward at one to seven
     * pixels a frame and keeps flapping until the ceiling stops it. Everything
     * else waits for the four cels to finish.
     */
    case 0: {
      // `0x4230a5`/`0x4230aa` — rolled fresh every frame, and always upward
      e.vy = -k.roll(7) * TICKS;
      if (!done) return false;
      // `0x4230bf` — he has fallen a long way behind: come about
      if (t.forward < TURN_CRUISE) e.facing = -e.facing;
      /**
       * `0x4230d5` and `0x4230e9` — the two the dive needs at once: up to
       * speed, and the player a hundred pixels or more below. `0x4230ee` then
       * throws the horizontal away, so every dive starts from a standstill and
       * builds again on its own tag's `dx 4`.
       */
      if (Math.abs(e.vx / TICKS) >= UP_TO_SPEED && below >= DIVE_BELOW) {
        e.vx = 0;
        k.say(e, BAT.squeak);
        /**
         * `0x423104` — `AI+2` counts the dives. Two on tag 1 and then one on
         * tag 3, the steep one, and round again; `0x423130` is what resets it.
         */
        const n = e.beat ?? 0;
        if (n < 2) {
          e.beat = n + 1;
          return restart(e, BAT.dive);
        }
        e.beat = 0;
        return restart(e, BAT.stoop);
      }
      // `0x42314f` — another lap, and `0x423165` chirps on each one
      restart(e, BAT.cruise);
      k.say(e, BAT.flap);
      return false;
    }
    /**
     * tags 1 and 2, `0x42317b` — the dive, and the two cels it wears.
     *
     * The table sends both here. The first thing it does is pick which of the
     * two the next frame shows: `2 * obj+0xa <= obj+0xc` — twice the descent
     * against the forward speed — puts it on tag 2, cel 2201, the shallow wing;
     * steeper than that and it stays on 2204 with its wings back. Both carry
     * `0x14` on `obj+0x1a`, which is the only strength a bat ever has.
     */
    case 1:
    case 2: {
      // `0x423183` — and it is the PREVIOUS frame's `obj+0xa`, read before the
      // one below is written
      if (2 * e.vy <= e.vx) restart(e, BAT.glide);
      // `0x423199` — strength 20, for the shove nothing in this port takes
      // `0x4231af`/`0x4231bc` — seven a frame down, or level inside 45 pixels
      e.vy = (below > PULL_UP ? 7 : 0) * TICKS;
      /**
       * `0x4231c2` — and the way out of a dive that connects: `obj+0x2a` is the
       * "something shoved me" word `0x430663` writes, and a bat that has hit
       * anything pulls up five a frame with ten of forward speed and goes back
       * to cruising. Nothing in this port writes a collision flag onto a foe —
       * the same gap `rat.ts` names on `0x44e304` — so this branch is never the
       * one taken here and the dive always ends the other way.
       */
      // `0x4231f4` — he is behind it, or he is above it: break off and climb
      if (t.forward < TURN_DIVE || k.player.y < e.y) {
        e.facing = -e.facing;
        return restart(e, BAT.cruise);
      }
      return false;
    }
    /**
     * tag 3, `0x423228` — every third dive, and it is the committed one.
     *
     * Ten pixels a frame down instead of seven, two instead of nothing when it
     * gets close, and it loops its own four cels rather than handing back. It
     * sets no strength at all — `0x422f30`'s zero stands — so the steep dive is
     * the one that does not carry the blow.
     */
    default:
      // `0x423238`/`0x423245`
      e.vy = (below > PULL_UP ? 10 : 2) * TICKS;
      // `0x42324b` — the same two tests as the shallow dive
      if (t.forward < TURN_DIVE || k.player.y < e.y) {
        e.facing = -e.facing;
        return restart(e, BAT.cruise);
      }
      // `0x42325e` — otherwise round again on the same four cels
      return done ? restart(e, BAT.stoop) : false;
  }
}

export { NOT_HERE as BAT_NOT_HERE, CEILING as BAT_CEILING };
