/**
 * The floating brain — `initslurp`, think function `0x414ae0`, eight states.
 *
 * `slurp` is only what the book calls it. `lab.snd`, which is the bank every
 * sound in this function comes out of, calls it what it is: index 0 is
 * `#0005 Brain fly` and index 1 is `#0007 Brain hyp`. It is the thing that
 * drifts at you in MAZE and hypnotises you — twenty of MAZE's twenty-seven
 * records are these ({@link FOES.initslurp}).
 *
 * ## Its eight scripts, and therefore its eight states
 *
 * `0x45d090` copies word 4 of a script's header into `obj+0x18` and clears
 * `obj+0x46` as it goes, so the kinds of the scripts this class installs ARE
 * its alphabet. The jump table at `0x4150c8` is
 * `[0x414ba3, 0x414bdc, 0x414bf1, 0x414e12, 0x414e22, 0x41505a, 0x41506a,
 * 0x41507a]`, one entry per kind, in order:
 *
 * ```
 *   0  0x46d268  one cel, 2550: the dormant hover, and what the creator installs
 *   1  0x46d288  six cels of drifting IN — 2551/2552/2553, 50 on two of them
 *   2  0x46d2c0  tag 0 a walk, tag 1 climbing UP, tag 2 climbing DOWN
 *   3  0x46d278  one cel, 2550: the flinch
 *   4  0x46d440  two cels, 2550/2551: the stance, and the state that DECIDES
 *   5  0x46d370  twelve cels, 2650..2656 then 2700..2704: the bolt
 *   6  0x46d3d8  twelve cels, 2500..2505 doubled: the hypnosis
 *   7  0x46d458  two tags of one cel, 2550: the death and the corpse
 * ```
 *
 * Three of those scripts — 0, 3 and 7 — are cel **2550** and nothing else, so
 * dormant, flinching and dying all look identical; only kinds 1, 2, 5 and 6
 * draw anything different.
 *
 * ## The shape of the machine, which is not the punk's
 *
 * State 4 is the whole fight, the way `initwerea`'s state 1 is, and it hangs on
 * one question the punk never asks: **which way is the player facing**. At the
 * middle two bands `0x414ee7` and `0x414fa8` compare `obj+0x28` against the
 * PLAYER's own `obj+0x28`, and the two agreeing — his back to it — is what
 * turns a drift into a bolt or a hypnosis. A brain you are looking at closes;
 * a brain behind you strikes.
 *
 * And it has a second machine bolted to the side of it. `0x414e22` opens with
 * two tests that skip the bands entirely: the player's own state being **7**,
 * which `players.ts` names the LADDER, or two hundred pixels between the two
 * of them in Y. Either one sets `AI+0x30 = 1` and hands to kind 2, and kind 2
 * is a three-mode machine that finds the level's `ladder` record, walks to it
 * and climbs it. The brain follows you up the ladder. See {@link LADDER} for
 * why none of that could be written here.
 *
 * ## What this module owns, and what it does not
 *
 * Kinds 0, 1, 2, 4, 5 and 6 are the ones it is in while it is on its feet —
 * or rather off them, since it never has any — and those are here. Kinds 3 and
 * 7 are the hit reactions, installed by the hit handler `0x415100` and driven
 * by the page's own {@link Foe.flinch}/{@link Foe.death} path; a brain is never
 * called during them. They are named at {@link NOT_HERE}.
 *
 * ## The stack frame, and how it was pinned
 *
 * `0x414ae0` takes the tracker's sixteen bytes at **`esp+8`**, not `esp+0xc`
 * like the punk's and not `esp+0x10` like the dog's, and getting that wrong
 * here is the difference between reading the BAND and reading the side.
 *
 * The prologue is `sub esp, 0x3c` and then `lea eax, [esp]` — the buffer
 * address is taken BEFORE anything is pushed, so the buffer is the bottom of
 * the frame — and then two registers go on (`esi`, `edi`) and the two call
 * arguments after them, with `add esp, 8` putting the balance at four words
 * below the buffer... which is `esp + 8`, because `esi` and `edi` are still
 * down there. The argument slots settle it: at `0x414aea` the function reads
 * its AI struct from `[esp+0x50]` and at `0x414b08` its object from
 * `[esp+0x48]`, four bytes apart in the right order, which fixes the frame
 * exactly. So:
 *
 * ```
 *   [esp+0x08]  out+0     side          (never read by this class)
 *   [esp+0x0c]  out+4     BAND          `0x414afa`, and the switch at `0x414eaa`
 *   [esp+0x0e]  out+6     his strike box (never read)
 *   [esp+0x10]  out+8     player.y - self.y (never read)
 *   [esp+0x12]  out+0xa   forward       `0x414b02`, `0x414be3`, `0x414e90`
 * ```
 *
 * `0x414afa` is `cmp word ptr [esp+0xc], 1` and that is a BAND test, not a side
 * test: read four low it would have said "he is in front of me", which is
 * plausible and wrong.
 *
 * ## Its AI struct, which is not the punk's either
 *
 * `0x433f20(0x44)` at `0x411a26`, sixty-eight bytes, and only two of its slots
 * mean what the same offsets mean in `initwerea`:
 *
 * ```
 *   AI+0x00   HEALTH, 0x40e300(0x3c) = 60          `0x411a7b`, spent by 0x415100
 *   AI+0x02   written 0 by the creator and never read again
 *   AI+0x04   the record's own rect — the punk keeps this at AI+8
 *   AI+0x0c   the tracker struct `0x45ef70` seeds        `0x411aa1`
 *   AI+0x30   the LADDER mode: 0 none, 1 find, 2 walk to it, 3 climb it
 *   AI+0x32   the ladder record's point, y then x         `0x414c40`
 *   AI+0x36   its rect's top-left, y then x               `0x414c43`
 *   AI+0x3a   its rect's bottom-right, y then x           `0x414c53`
 *   AI+0x3e   the LIFT, seeded 15 at `0x411ab2` — see {@link SLURP.lift}
 *   AI+0x42   which way it is climbing: 1 up, 2 down, and it is the script TAG
 * ```
 *
 * `AI+0` being health rather than a nerve is the one to watch: the punk's
 * `AI+0` is a nerve that a blow takes ten off and that decides taunts, and
 * reading this one the same way would have the brain taunting on its hit
 * points. Nothing in `0x414ae0` reads `AI+0` at all — only the health bar
 * claim does — so it is carried as {@link Enemy.hp} by the page and not
 * touched here.
 *
 * ## The health bar claim, which is not behaviour
 *
 * `0x414afa`…`0x414b3a` runs before the jump table: while the player is inside
 * the outermost band and in front, and this one is neither dormant (state 0)
 * nor dying (state 7), it calls
 * `0x40d1c0(AI+0, 0x40e300(0x3c), 0x33f4, self.point)` — the on-screen enemy
 * bar's claim, plate 13300, sixty out of sixty. {@link FOES.initslurp} already
 * carries those numbers. Read, not done.
 */
import {
  install,
  type Brain,
  type BrainCtx,
  type Enemy,
  type Reaction,
  TICK_SCALE,
} from "./kit";
import type { Foe } from "../foes";

/**
 * The hit reactions, kinds 3 and 7, and the handler that installs them. The
 * page owns those animations; the one thing the corpse does besides vanish is
 * {@link slurpReacts}.
 *
 * - **`0x415100`**, the hit handler, hung on `obj+0x12` at `0x414a2f`. It reads
 *   the STRIKER (`[esp+0x14]`) and turns five things away before it spends
 *   anything: a TCop, class `[0x46c9e0]` (`0x415110`); a negative strength
 *   (`0x415121`); its own class `[0x46c9e4]` (`0x415133`); a strength of 0
 *   (`0x415160`); and the tube's thrown glass, `[0x46bfb4]` (`0x415170`) —
 *   the page's `SPARES`. Then blood along the blow (`0x415194`) and the
 *   strength off `AI+0`: over zero installs `0x46d278` — kind 3, the flinch —
 *   and at or under zero it deregisters from the census (`0x42f870(obj, 0)`),
 *   clears the bar, installs `0x46d458` tag 0 and writes `[0x46b204]` into
 *   `AI+0x2e` (`0x415207`, through the pointer `0x430eb0` found). It plays no
 *   sound and calls no `0x40d450`: **a brain is worth nothing**, which is why
 *   {@link FOES.initslurp}'s award is 0.
 * - **3**, the flinch, `0x414e12`: two instructions. Wait for the script to
 *   end, then install `0x46d440` — back to the stance, the flinch's
 *   {@link FoeAnim.resume}.
 * - **7**, the corpse, `0x41507a`: tag 1 answers **1** at once, and tag 0 plays
 *   `lab.snd` index 13 — `#0084 TCop Dies`, which is not this creature's own
 *   sound and is what the disc plays anyway — then two `0x40cba0` effects,
 *   `-0xd` and `0x78`, and answers 1 as well. Those two answers are the ONLY
 *   `mov ax, 1` in the whole of `0x414ae0`: the frame the object is removed,
 *   which is the first think after the blow. There is no corpse, and the
 *   `AI+0x2e` the handler wrote is never read — {@link FOES.initslurp}
 *   carries that as a `linger` of 0.
 */
const NOT_HERE = "0x414e12, 0x41507a, 0x415100" as const;

/**
 * Kind 2, the ladder machine — read in full, and unreachable from a brain.
 *
 * `0x414bf1` dispatches on `AI+0x30`, which only `0x415048` and `0x414db6`
 * ever set, and the three modes are:
 *
 * - **1, find it.** `0x414c0d` calls `0x404440(0x46eb14)` — the length byte of
 *   a Pascal string, and the string is `ladder` — and hands the result to
 *   `0x40b660(name, player, 0, -1, &out)`, the level's record search. On a hit
 *   it copies three of the record's own fields into `AI+0x32`, `AI+0x36` and
 *   `AI+0x3a` — the point at record `+0x18`, and the rect's two corners at
 *   `+2` and `+6`, exactly the offsets `walk.ts`'s own `LADDER` already reads
 *   a ladder record by — and sets `AI+0x30 = 2`. **On a miss, `0x414c5b`
 *   installs `0x46d440` and the thing simply goes back to the stance.**
 * - **2, walk to it.** `0x414c67` faces the record's x and waits until it is
 *   within ten pixels of it, then zeroes `obj+0xc`, sets `AI+0x30 = 3`, picks
 *   a climb tag and clears `obj+0x16`, its region index.
 * - **3, climb it.** `0x414cd8` faces the player, re-picks the climb tag every
 *   frame from the rect's top and bottom edges and from `player.y - 0x14`, and
 *   ends the climb one of two ways: inside the innermost band and within
 *   twenty pixels of him in Y it installs `0x46d370`, the bolt, with `obj+0xa`
 *   zeroed; otherwise, within twenty pixels of him in Y and with him NOT on a
 *   ladder himself, it asks `0x40b940(2, 0, 0, self.point, &out)` which region
 *   record it is standing in, and on an answer goes back to the stance with
 *   `AI+0x30 = 0`.
 *
 * Two readings in there disagree and I could not settle which is intended.
 * Mode 3 picks tag 2 (dy +100, down the screen) when the rect's top is at or
 * below it, which is right; mode 2 picks tag **1** (dy -100, up) when the
 * record's POINT is below it, which is the opposite sign. Mode 3 re-picks on
 * its very next frame, so the disagreement never lasts more than a frame, and
 * nothing here depends on resolving it.
 *
 * ## Why none of it is written below
 *
 * {@link BrainCtx} is the whole of what a class module is allowed to know, and
 * it has no record search in it — no `0x40b660`, no `0x40b940`, no way to ask
 * where the level's ladders are. The nine `ladder` records across MAZE, SEWER,
 * TOWER, RAVECAVE and STREETS are read by `walk.ts` and are not offered here,
 * and inventing a reach into them would be exactly the kind of guess this file
 * is not allowed to make. So the port takes the executable's own answer for
 * the case it CAN express — the search that finds nothing, `0x414c5b` — and
 * state 2 goes straight back to the stance. The visible loss is that a brain
 * will not follow you up a ladder; it will drift at the foot of one.
 */
const LADDER = "0x414bf1 / 0x40b660 / 0x46eb14" as const;

/**
 * The hypnosis, `0x402fa0(4)`, which is the one thing this class does to the
 * player.
 *
 * Kind 6 is installed at `0x414f52` and `0x414fe1`, and both sites call
 * `0x402fa0(4)` beside it. That function is the player's own pose setter: a
 * jump table at `0x42f418` over `n + 1`, and entry 5 is `0x42f383`, which
 * installs `0x471fc8` on the player object. `players.ts` names that script
 * kind **9**, the judder. So the brain's kind 6 puts the player into a state he
 * does not choose, which is what `#0007 Brain hyp` is the sound of.
 *
 * The judder runs its fifteen frames (thirty engine frames) and its handler
 * hands him back to the idle; nothing else holds him, and nothing is taken.
 * `0x414f2e` and `0x414fb4` ask whether he is ALREADY in kind 9 — a brain will
 * not hypnotise a man who is already hypnotised, and bolts him instead — and
 * the eyeball's swoop opens on the same kind.
 */
const HYPNOSIS = "0x402fa0 / 0x42f383 / 0x471fc8" as const;

/**
 * Its repertoire, by kind and tag, straight out of `0x46d268`…`0x46d458`.
 *
 * Every cel, hold, stride and lift below is the script's own header and frame
 * list. Only kinds 1 and 2 travel: `0x46d288` carries 50 on two of its six
 * cels, `0x46d2c0` tag 0 carries 50 on two of its seven, and its tags 1 and 2
 * carry ∓100 on the same two — the climb. Everything else is `dx 0, dy 0`.
 */
export const SLURP = {
  /**
   * kind 0 — one cel, going nowhere: what the creator installs at `0x411aca`
   * and what it hangs in until the player walks into its rect.
   *
   * Its header's `ticksPerFrame` is **0**, which no other script in the class
   * has and which nothing can divide by; {@link FOES.initslurp} already reads
   * it as 1, and with one cel in the script nothing is drawn differently
   * either way.
   */
  idle: { cels: [2550], hold: 1, kind: 0, tag: 0, from: "0x46d268 tag 0" },
  /** kind 1 — the drift in, and the first and fourth cels are the ones that move */
  drift: {
    cels: [2552, 2551, 2553, 2553, 2551, 2552],
    hold: 3,
    dx: [50, 0, 0, 50, 0, 0],
    kind: 1,
    tag: 0,
    from: "0x46d288 tag 0",
  },
  /** kind 2 tag 0 — the walk it hunts a ladder on, same two cels carrying the stride */
  walk: {
    cels: [2602, 2601, 2600, 2601, 2602, 2603, 2602],
    hold: 3,
    dx: [50, 0, 0, 0, 50, 0, 0],
    kind: 2,
    tag: 0,
    from: "0x46d2c0 tag 0",
  },
  /** kind 2 tag 1 — the same seven cels lifting 100 twice: climbing UP */
  climbUp: {
    cels: [2602, 2601, 2600, 2601, 2602, 2603, 2602],
    hold: 3,
    dy: [-100, 0, 0, 0, -100, 0, 0],
    kind: 2,
    tag: 1,
    from: "0x46d2c0 tag 1",
  },
  /** kind 2 tag 2 — and dropping 100 twice: climbing DOWN */
  climbDown: {
    cels: [2602, 2601, 2600, 2601, 2602, 2603, 2602],
    hold: 3,
    dy: [100, 0, 0, 0, 100, 0, 0],
    kind: 2,
    tag: 2,
    from: "0x46d2c0 tag 2",
  },
  /** kind 4 — two cels going nowhere: the stance, and state 4 is the whole fight */
  stance: {
    cels: [2550, 2551],
    hold: 2,
    kind: 4,
    tag: 0,
    from: "0x46d440 tag 0",
  },
  /** kind 5 — the bolt: seven cels of one block and five of another, one frame each */
  bolt: {
    cels: [
      2650, 2651, 2652, 2653, 2654, 2655, 2656, 2700, 2701, 2702, 2703, 2704,
    ],
    hold: 1,
    kind: 5,
    tag: 0,
    from: "0x46d370 tag 0",
  },
  /** kind 6 — the hypnosis, six cels held twice over, backing off 10 at the end */
  latch: {
    cels: [
      2500, 2500, 2501, 2501, 2502, 2502, 2503, 2503, 2504, 2504, 2505, 2505,
    ],
    hold: 2,
    dx: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, -10, -10],
    kind: 6,
    tag: 0,
    from: "0x46d3d8 tag 0",
  },
  /**
   * `0x46d470`, the fourth argument the creator hands `0x45ef70` at `0x411a8c`
   * — three thresholds and the zero that ends the list, so the bands run 0
   * (beyond 260) to 3 (inside 140). {@link FIGHTS.initslurp} has the same three.
   */
  bands: [260, 180, 140],
  /**
   * `0x414e47` — two hundred pixels between the two of them in Y and it stops
   * fighting and goes looking for a ladder.
   */
  apart: 200,
  /**
   * `0x411ab2` — the lift, and the reason a brain bobs.
   *
   * `AI+0x3e` is seeded 15, and the preamble spends it every single frame in
   * every single state: `0x414b68` calls `0x42f8b0(obj, [AI+0x3e])`, which
   * rounds `15 / obj+0xe` away from zero — the divisor is 8
   * ({@link FOES.initslurp}) so it is **2** — and adds it to `obj+0xa`. Then
   * `0x414b43`, at the top of the next frame, negates `AI+0x3e` whenever
   * `|obj+0xa|` has passed {@link SLURP.limit}. Two up, two up, two up, turn;
   * the cycle is twelve frames, sums to zero, and carries the thing eighteen
   * pixels each way.
   *
   * The dword at `AI+0x3e` is read whole and its high half — `AI+0x40`, which
   * the creator zeroes at `0x411aad` and nothing ever writes — is what
   * `0x42f8b0` adds to `obj+0xc`. So the sideways half of the lift is always
   * nothing, and only the vertical half moves.
   */
  lift: 15,
  /** `0x414b4c` — past five in either direction and the lift turns round */
  limit: 5,
  /** `0x414b81` — a sideways speed over thirty is halved, every frame, in every state */
  clamp: 30,
  /**
   * `lab.snd`, the bank `0x4128c2` opens into `0x4a56d0` for this chapter, and
   * MAZE's own effects bank ({@link LEVEL_BANKS}). The names are the check on
   * every one of these:
   *
   * - **0**, `#0005 Brain fly` — `0x414ec5`, `0x414ef8`, `0x414f7c` and
   *   `0x415004`, every site that starts a drift.
   * - **1**, `#0007 Brain hyp` — `0x414f4a` and `0x414fcf`, the two sites that
   *   start a hypnosis. See {@link HYPNOSIS}.
   * - **2**, `#0046 MadDoc wh` — `0x415020`, the bolt. The name is the one
   *   thing in this class that does not obviously belong to it; the index is
   *   not in doubt.
   */
  sfxFly: 0,
  sfxHyp: 1,
  sfxBolt: 2,
  from: "0x414ae0",
} as const;

/** `e.vx`/`e.vy` are pixels per TICK and the engine's words pixels per FRAME */
const TICKS = TICK_SCALE;

/**
 * `initslurp`'s own machine, kinds 0, 1, 2, 4, 5 and 6.
 *
 * ## The one thing to get right
 *
 * **A think function never suppresses the animation.** Every path through
 * `0x414ae0` ends at `0x414bcd` — `xor ax, ax`, after setting `obj+0x1a` to
 * 100 — and that includes every "my script has not finished" return. The two
 * exceptions are both inside state 7, the corpse, and both are the frame the
 * object is removed. So every path below answers `false`, waiting states
 * included: waiting is exactly when the current script needs to keep playing.
 *
 * `obj+0x1a = 0x64` is the strength percent this class sets on itself as it
 * hands the frame back, and **nothing hits the player in this port**, so it is
 * carried as read and spends nothing.
 */
export const slurp: Brain = (e, foe, run, k) => {
  const done = e.clock >= run;
  const t = k.track(e, SLURP.bands);
  // `0x414a36` — the class's create stands it on a vertical speed of −5
  if (e.hover === undefined) e.vy = -5 * TICKS;
  e.hover ??= SLURP.lift;
  bob(e, foe);
  switch (e.script ?? 0) {
    /**
     * ---- 0, `0x414ba3`: the dormant hover, and the one thing that ends it.
     *
     * `0x434200(player.point, AI+4)` — his own point inside the four words the
     * creator copied out of this `init` record, and nothing else: not a sight
     * line, not a radius. It does not wait for its script to finish, because
     * kind 0 is one cel and never does.
     */
    case 0:
      return e.fighting ? install(e, SLURP.stance) : false;
    /**
     * ---- 1, `0x414bdc`: the drift ends facing him.
     *
     * `0x414be3` reads `[esp+0x12]`, the forward distance, and a negative one —
     * he got behind it while it was closing — flips `obj+0x28` before it hands
     * back to the stance. Both paths hand back to the stance.
     */
    case 1:
      if (!done) return false;
      if (t.forward < 0) e.facing = -e.facing;
      return install(e, SLURP.stance);
    /**
     * ---- 2, `0x414bf1`: the ladder machine, and all this port can reach of it.
     *
     * The only way into kind 2 is `0x415048`, which sets `AI+0x30 = 1` on the
     * way, so mode 1 — the search — is where a brain always arrives. The search
     * is `0x40b660` against the level's `ladder` records and {@link BrainCtx}
     * cannot make it, so what runs here is the executable's own answer for a
     * search that finds nothing: `0x414c5b`, back to the stance. See
     * {@link LADDER} for the two modes beyond it and for what is lost.
     *
     * The state's tail at `0x414dda` — halve `obj+0xa` when it is over ten, and
     * otherwise reinstall kind 2 on the tag it is already playing — is dead
     * either way: {@link SLURP.limit} turns the lift round at five, so the
     * vertical speed never reaches ten, and the reinstall only runs on a frame
     * that has not already installed something else.
     */
    case 2:
      return install(e, SLURP.stance);
    // ---- 4, `0x414e22`: the stance, and the only state that thinks every frame
    case 4:
      return decide(e, k, t, done);
    /**
     * ---- 5 and 6, `0x41505a` and `0x41506a`: the bolt and the hypnosis are
     * the same two instructions each. Play to the end, then back to the stance.
     */
    case 5:
    case 6:
      return done ? install(e, SLURP.stance) : false;
    default:
      return false;
  }
};

/**
 * The preamble, `0x414b43`…`0x414b93`, which belongs to no state and runs
 * before the jump table in every one of them.
 *
 * Two clamps and a lift. The lift is {@link SLURP.lift} and it is the whole of
 * why a brain hangs in the air bobbing; the sideways clamp at `0x414b79` halves
 * anything over {@link SLURP.clamp}, which in this port only ever has a
 * knock-back left over from a blow to work on.
 *
 * The arithmetic, because the units differ: `0x42f8b0` spends the lift once an
 * ENGINE frame, and so does this — the brain is called once a frame — while
 * `e.vy` is pixels per TICK. So the engine's `ceil(15 / 8) = 2` pixels a frame
 * is `2 * TICKS` of port velocity, added once. The turn-round test goes the
 * other way, `e.vy / TICKS` back into engine pixels before it is weighed
 * against five.
 *
 * The third line of the preamble, `0x414b5c`, lifts it twenty pixels on any
 * frame `obj+0x2e` — its own floor-contact word — is set. This page never lands
 * a floater, so it has no such word to read and the push is not made.
 */
function bob(e: Enemy, foe: Foe): void {
  // `0x414b43` — `|obj+0xa|` past five and `AI+0x3e` is negated
  // (the word is whole pixels; the port's velocity carries float dust)
  if (Math.abs(Math.round(e.vy / TICKS)) > SLURP.limit)
    e.hover = -(e.hover ?? SLURP.lift);
  // `0x414b68` → `0x42f8b0`: the lift through the object's own divisor
  const lift = e.hover ?? SLURP.lift;
  const step = Math.sign(lift) * Math.ceil(Math.abs(lift) / foe.divisor);
  e.vy += step * TICKS;
  // `0x414b79` — and a sideways speed over thirty is halved
  if (Math.abs(e.vx / TICKS) > SLURP.clamp) halve(e);
}

/** `cdq; sub eax, edx; sar eax, 1` — half of `obj+0xc`, toward zero */
function halve(e: Enemy): void {
  e.vx = Math.trunc(e.vx / TICKS / 2) * TICKS;
}

/**
 * State 4, `0x414e22` — the whole of the fight, decided fresh every frame.
 *
 * Answer the two things that skip the bands, turn to face him, and then act on
 * the band. Three of the four bands ask which way HE is facing before they ask
 * anything else, which is this class's own question and the punk never asks it.
 */
function decide(
  e: Enemy,
  k: BrainCtx,
  t: ReturnType<BrainCtx["track"]>,
  done: boolean,
): boolean {
  /**
   * `0x414e27` and `0x414e47` — the two ways out of the fight and into the
   * ladder hunt, and `0x415048` is the same three lines for both: `AI+0x30 = 1`
   * and kind 2 tag 0, the walk.
   *
   * The first is `player+0x18 == 7`, the player's own state being the LADDER
   * ({@link BrainCtx}'s `player.climbing`); the second is the two hundred
   * pixels of {@link SLURP.apart}.
   */
  if (k.player.climbing || Math.abs(k.anchorY(e) - k.player.anchor) > SLURP.apart)
    return install(e, SLURP.walk);
  /**
   * `0x414e52` — and while it is off a ladder it has no region index, so it
   * asks `0x40b940` which record's rect it is standing in and takes the stance
   * again on an answer. `Enemy` carries no region index and the reinstall is of
   * the script already playing, so there is nothing here to do.
   */
  /**
   * `0x414e90` — behind it: halve the sideways speed and turn. Like the punk's
   * `0x44e736` this one does NOT return; it turns and carries on deciding.
   */
  if (t.forward < 0) {
    halve(e);
    e.facing = -e.facing;
  }
  /**
   * `0x414eaa` — and `[esp+0xc]` is the band. Sign-extended and then compared
   * unsigned against 3, so −1, the player behind this one altogether, falls
   * through to the default with everything past the innermost threshold.
   */
  switch (t.band) {
    /**
     * Beyond 260: `0x414ebf` calls, and drifts. One sound, one script, no
     * question asked about him at all.
     */
    case 0:
      k.say(e, SLURP.sfxFly);
      return install(e, SLURP.drift);
    /**
     * 180..260 — `0x414ede`, and the first band that looks at him.
     *
     * `obj+0x28` against his own `obj+0x28`: facing the same way means his back
     * is turned, and a brain behind you just keeps closing. Looking at it, it
     * halves its speed and tosses a coin — `0x434540(2)` — for whether to
     * hypnotise instead, and takes that only while he is upright.
     */
    case 1: {
      if (e.facing === k.player.facing) {
        k.say(e, SLURP.sfxFly);
        return install(e, SLURP.drift);
      }
      halve(e);
      // `0x414f29` — not a man already juddering — and `0x402f60`, upright
      if (k.roll(2) === 1 && !k.player.jolted && !k.player.down) {
        k.say(e, SLURP.sfxHyp);
        install(e, SLURP.latch, true);
        k.pose(4); // `0x414f64`
        return false;
      }
      k.say(e, SLURP.sfxFly);
      return install(e, SLURP.drift);
    }
    /**
     * 140..180 — `0x414f90`, the same question with the answers swapped round.
     *
     * At this range his back being turned is not a reason to close but a reason
     * to strike: `0x414fac` goes straight to the bolt. Facing it, and upright,
     * he is hypnotised instead; facing it and already down, `0x414fc2` lets the
     * stance run out and asks again.
     */
    case 2: {
      halve(e);
      // `0x414fb4` — already juddering, and he is bolted instead
      if (e.facing !== k.player.facing && !k.player.jolted) {
        if (k.player.down) return done ? install(e, SLURP.stance) : false;
        k.say(e, SLURP.sfxHyp);
        k.pose(4); // `0x414fd9`
        return install(e, SLURP.latch, true);
      }
      k.say(e, SLURP.sfxBolt);
      return install(e, SLURP.bolt, true);
    }
    /**
     * Inside 140 — `0x414fea`, and the closest band is the simplest: a coin,
     * and no question about him whatsoever. Heads it drifts closer still, tails
     * it bolts.
     */
    case 3:
      if (k.roll(2) === 1) {
        k.say(e, SLURP.sfxFly);
        return install(e, SLURP.drift);
      }
      k.say(e, SLURP.sfxBolt);
      return install(e, SLURP.bolt, true);
    /**
     * `0x415038` — behind it, or beyond the table: let the stance play out and
     * then put it on again. This is the only path in state 4 that waits for
     * `obj+0x46` at all.
     */
    default:
      return done ? install(e, SLURP.stance) : false;
  }
}

/**
 * State 7 tag 0, `0x41508b` — the frame after the killing blow, and the brain
 * goes up in goo.
 *
 * Besides the sound (the page's {@link Foe.deathSound}) and the green ball
 * (`0x4150a6`, {@link Foe.vanishes}), `0x4150b6` calls
 * `0x40cba0(self.point, 0x78, 0)`: a hundred and twenty's worth — the twenty
 * gobs the spray tops out at — and with no hitter (`push 0`), so every one of
 * them takes `0x40ce7d`'s random velocity. Once: the object is gone the same
 * frame.
 */
export const slurpReacts: Reaction = (e, _foe, _run, k) => {
  if (e.state !== "dead" || e.hatched) return;
  e.hatched = true;
  k.spray(e, BURST);
};

/** `0x4150b3` — `push 0x78` */
const BURST = 0x78;

export {
  NOT_HERE as SLURP_NOT_HERE,
  LADDER as SLURP_LADDER,
  HYPNOSIS as SLURP_HYPNOSIS,
};
