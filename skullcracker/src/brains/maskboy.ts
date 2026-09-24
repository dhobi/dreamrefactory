/**
 * The masked one of MALL's gang — `initmaskboy`, think `0x438760`, and the
 * first of chapter five's three siblings to have its machine read.
 *
 * ## Its scripts, and therefore its states
 *
 * `0x45d090` copies word 4 of a script's header — its KIND — into `obj+0x18`
 * and its tag into `obj+0x44` (`0x45d0a3`/`0x45d0d6`), so the class's own data
 * region IS the alphabet of its state machine. Walking `0x4740b8` forwards to
 * the band list at `0x474328` turns up nine scripts and nine kinds:
 *
 * ```
 *   1  0x4740b8  one cel, 1801: the dormant pose, and what the creator installs
 *   2  0x474170  the guard — two poses, a brace, and a give-ground
 *   4  0x4740c8  the lever job: tag 0 the walk to it, tag 1 the reach
 *   5  0x474230  travel — tag 4 the run, tags 0/1 the carried step, tag 5 back
 *   6  0x4741c0  the leap: crouch, flight, landing
 *   7  0x4742a0  the attack: tags 0/1 wind up, tags 2/3 strike
 *   8  0x474280  the gloat over a downed player
 *   9  0x4742f8  the death, five cels
 *  10  0x4742d8  the knockdown
 * ```
 *
 * There is **no kind 0 and no kind 3**. `0x4388b0` does `movsx eax, [esi+0x18];
 * dec eax; cmp eax, 9; ja <return>`, so the ten-entry table at `0x438e94`
 * covers states 1 to 10 and state 0 falls out of it unsigned; the third entry
 * (state 3) is `0x438e80`, the common return, and the class owns no kind-3
 * script to reach it with.
 *
 * ## What this module owns
 *
 * States 1, 2, 5, 6, 7 and 8 — everything it is in while it is on its feet and
 * not running an errand. State 4 is the lever job and the page drives it
 * through {@link Foe.lever}; 9 and 10 are the hit reactions and the page drives
 * those through {@link Foe.flinch} and {@link Foe.death}. All of them, plus the
 * four things `0x438760` does that this port has nowhere to put, are written
 * out at {@link NOT_HERE}.
 *
 * ## The stack frame, and how it was pinned
 *
 * `0x438760` is `sub esp, 0x18` and then `lea eax, [esp]` — the sixteen bytes
 * `0x45efd0` fills start at the BOTTOM of the frame, and the address is taken
 * **before** a single register is pushed. Four pushes follow (`ebx`, `esi`,
 * `edi`, `ebp`), so once the call's own two arguments are off the stack the
 * buffer sits at **`esp+0x10`**, not at `esp`:
 *
 * ```
 *   esp+0x10  out+0    side          esp+0x18  out+8    player.y - self.y
 *   esp+0x14  out+4    band          esp+0x1a  out+0xa  forward distance
 *   esp+0x16  out+6    his strike box
 * ```
 *
 * The argument slots settle it and leave no room for an off-by-four: both
 * `0x43876a  mov edi, [esp+0x2c]` (three registers pushed, so `base+0x20`, the
 * second argument — the AI struct) and `0x43878a  mov esi, [esp+0x2c]` (four
 * pushed and eight popped, so `base+0x1c`, the first — the object) read the
 * same displacement at different depths. Reading the buffer four bytes low
 * would turn `0x43895f`'s `cmp [esp+0x14], 3` — the BAND against the innermost
 * of three — into a test of the side word, which is never 3, and the guard
 * would silently never give ground.
 *
 * ## The AI struct, which is NOT the punk's
 *
 * `0x436280` mallocs `0x38` bytes and fills them; every slot below differs from
 * `initwerea`'s and two of them are pointers:
 *
 * ```
 *   AI+0     word   health, seeded 0x40e300(0x28) = 40    `0x4362d7`
 *   AI+2     dword  the player object                     `0x4362d4`
 *   AI+6     dword  the lever this one has claimed        `0x4362ef`, `0x4387d8`
 *   AI+0xa   word   consecutive frames blocked            `0x4362ff`, `0x438919`
 *   AI+0xc   8      the record's own rect                 `0x4362f7`
 *   AI+0x14  0x24   the tracker input `0x45ef70` fills    `0x43630d`
 *   AI+0x36  word   corpse frames left                    `0x436303`, `0x4390cb`
 * ```
 *
 * So `AI+0` is **health**, not a nerve: `0x43879b` hands it and a fresh
 * `0x40e300(0x28)` to the bar, and `0x43905f` is what spends it. This page
 * carries health as {@link Enemy.hp} and the hit handler owns it, so nothing
 * below reads or writes it. There is no beat, no decision budget and no side
 * word anywhere in the struct — this class does not circle and does not taunt.
 */
import {
  install,
  rewind,
  type Brain,
  type BrainCtx,
  type Enemy,
  type Reaction,
} from "./kit";
import { ahead, gangCorpse, turn } from "./batboy";
import type { FoeAnim } from "../foes";

/**
 * Everything `0x438760` does that is deliberately not in this file, with the
 * address of each so the next reader can check the omission rather than trust
 * it.
 *
 * - **The bar claim, `0x43877c`.** With the player at band 1 or nearer and in
 *   front of it, `0x40d1c0(AI+0, 0x40e300(0x28), 0x332e, self.y)` puts this
 *   one's health on the screen under plate 13102. It is the display, not
 *   behaviour, and {@link Foe.panel} already carries the three numbers.
 * - **The lever job, `0x4387b6` and state 4, `0x4389e3`.** In states 5 and 2
 *   only, `0x438200(AI+0xc, AI+0x10)` walks `[0x472570]` for the first switch
 *   object whose point is inside this one's record rect and whose tag is 3 — an
 *   unlit one — parks it in `AI+6`, faces it and installs kind 4 tag 0. State 4
 *   then walks until `0x438a55` says it is within `0x25` of the lever, stops
 *   (`obj+0xc = 0`), and either reaches (kind 4 tag 1) or, with the player
 *   inside a hundred, swings instead. Frame `0x10` of the reach calls
 *   `0x436820(lever, 0)` and a one-in-three roll shouts 5 or 6. The page owns
 *   all of it as {@link Foe.lever} and `stepFight` returns before a brain is
 *   ever called while a lever is still in the patch — so porting it here would
 *   give one animation two owners. It is dead in MALL anyway: the level places
 *   no switch.
 * - **`obj+0x2c`, the blocked word.** `0x42ff8d`, `0x42ffe2`, `0x430088`,
 *   `0x4300ff` and `0x430181` — the level-geometry bounce inside `0x42ff40` —
 *   set it to 1 on the frame an object's stride is turned back by the scenery.
 *   States 2, 4 and 5 all open the same way: while it is set, count `AI+0xa` up,
 *   and on the fifth frame running install kind 6 tag 0, the leap, and zero the
 *   count (`0x438912`, `0x4389f9`, `0x438b00`). This page writes no such flag
 *   onto a foe, so the count never starts and **nothing can enter state 6** —
 *   its three tags are written below anyway, because they are the state and not
 *   a guess about it.
 * - **State 9, `0x438db5`, the death.** Tag 0 drops `obj+0x10` to −20 — the
 *   floor offset, so a dying one may sink twenty pixels through what it stood
 *   on — and both tags then spend `AI+0x36` a frame at a time, seeded from
 *   `[0x46b204]` by `0x4390cb`, and remove the object with `0x40cba0(pos, -13,
 *   0)`. This is the only path in the whole function that answers **1**
 *   (`0x438e0e`, `0x438e5a`); every other one answers 0.
 * - **State 10, `0x438e69`, the knockdown.** Two instructions: wait for
 *   `obj+0x2e`, being back on the ground, and then install kind 5 tag 4 — it
 *   gets up already running. There is no flinch at all in this class:
 *   `0x4390dd` installs the knockdown for every blow that does not finish it,
 *   which is why {@link Foe.flinch} here is one cel. Kind 5 tag 4 is
 *   {@link Foe.gait}, and {@link maskboyReacts} holds the knockdown until the
 *   landing.
 */
const NOT_HERE =
  "0x43877c, 0x4387b6, 0x4389e3, 0x438848, 0x438912, 0x438db5, 0x438e69" as const;

/**
 * Its repertoire, by kind and tag, out of `0x4740b8`…`0x4742a0`.
 *
 * Every cel, hold, stride and lift is the script's own; `hold` is the header's
 * `ticksPerFrame` and the strides are the engine's pre-divisor units, which
 * this class divides by seven (`0x4386ab`).
 *
 * Which of them HIT is not in the executable — a strike box is a property of
 * the cel in `mall.sbk` — and `fights.ts`'s own `initmaskboy.attacks` is the
 * reading of it: kind 6 tag 2 and kind 7 tags 1, 2 and 3 carry one, and kind 7
 * tag 0's 1810/1811 do not. So the first wind-up is pure posture and the second
 * is already a blow.
 */
export const MASKBOY = {
  /**
   * `0x438848` — the roll that builds the level's one roller, and its three
   * gates. See {@link ROLLER} for what the thing then does.
   */
  roller: {
    /**
     * `push 0x44` then `cmp eax, 3; jge` — two in sixty-eight, every ENGINE
     * frame, and the brain is called once an engine frame, so the roll is
     * taken as it stands.
     */
    odds: [0x44, 3] as const,
    /** `0x438871` — and only with the player this close in x */
    within: 0x12c,
    /** `0x43889c` — it is built this far the FAR side of him */
    beyond: 0x258,
    /** `0x43887d` — `vx`, pre-divisor, so it comes back towards him */
    vx: -0x1e0,
    from: "0x438848 / 0x43a790",
  },
  /** kind 1 tag 0 — one cel, and what `0x4386f5` stands it up on */
  dormant: { cels: [1801], hold: 1, kind: 1, tag: 0, from: "0x4740b8 tag 0" },
  /**
   * kind 2 tags 0 and 1 — the guard, and the two are one cel apiece: the state
   * it waits in, picked between by a coin at `0x4389c1`.
   */
  guard: [
    { cels: [1801], hold: 1, kind: 2, tag: 0, from: "0x474170 tag 0" },
    { cels: [1804], hold: 1, kind: 2, tag: 1, from: "0x474170 tag 1" },
  ] as const,
  /** kind 2 tag 2 — cel 1803 three times over, going nowhere: the brace */
  brace: {
    cels: [1803, 1803, 1803],
    hold: 1,
    kind: 2,
    tag: 2,
    from: "0x474170 tag 2",
  },
  /** kind 2 tag 5 — four cels walking backwards out of the innermost band */
  giveGround: {
    cels: [1803, 1803, 1802, 1801],
    hold: 1,
    dx: [0, -70, -80, -70],
    kind: 2,
    tag: 5,
    from: "0x474170 tag 5",
  },
  /**
   * kind 5 tag 4 — the run, six cels with the stride on four of them, and the
   * script `0x438e70` hands back to from eleven different places. It is also
   * {@link Foe.gait}: this class has one walk and it uses it to fight.
   */
  run: {
    cels: [1800, 1801, 1802, 1803, 1804, 1805],
    hold: 1,
    dx: [0, 60, 70, 80, 120, 0],
    kind: 5,
    tag: 4,
    from: "0x474230 tag 4",
  },
  /**
   * kind 5 tags 0 and 1 — one cel each and no stride: the frames it coasts on
   * with the run's momentum still under it, which is the only reason state 5
   * reads `obj+0xc` at all.
   */
  carry: [
    { cels: [1805], hold: 1, kind: 5, tag: 0, from: "0x474230 tag 0" },
    { cels: [1800], hold: 1, kind: 5, tag: 1, from: "0x474230 tag 1" },
  ] as const,
  /** kind 5 tag 5 — one cel with a backwards stride: what every attack ends in */
  backOff: {
    cels: [1804],
    hold: 1,
    dx: [-40],
    kind: 5,
    tag: 5,
    from: "0x474230 tag 5",
  },
  /** kind 6 tag 0 — three cels shuffling back and then `dy -325`, the take-off */
  spring: {
    cels: [1805, 1805, 1805, 1806],
    hold: 1,
    dx: [-10, -50, -50, 80],
    dy: [0, 0, 0, -325],
    kind: 6,
    tag: 0,
    from: "0x4741c0 tag 0",
  },
  /** kind 6 tag 1 — the flight */
  flight: {
    cels: [1806, 1810, 1810],
    hold: 1,
    dx: [40, 80, 40],
    dy: [-5, 10, 10],
    kind: 6,
    tag: 1,
    from: "0x4741c0 tag 1",
  },
  /** kind 6 tag 2 — coming down out of it, and these cels carry a strike box */
  landing: {
    cels: [1811, 1811, 1812, 1811, 1812, 1813],
    hold: 1,
    dx: [10, 10, 10, 10, 10, 10],
    kind: 6,
    tag: 2,
    from: "0x4741c0 tag 2",
  },
  /**
   * kind 7 tags 0 and 1 — the two wind-ups, each two cels at two ticks with the
   * stride on the first. Tag 0 is posture and tag 1 already hits.
   */
  windUp: [
    {
      cels: [1810, 1811],
      hold: 2,
      dx: [60, 0],
      kind: 7,
      tag: 0,
      from: "0x4742a0 tag 0",
    },
    {
      cels: [1813, 1814],
      hold: 2,
      dx: [60, 0],
      kind: 7,
      tag: 1,
      from: "0x4742a0 tag 1",
    },
  ] as const,
  /**
   * kind 7 tags 2 and 3 — the strikes, one cel apiece, and `0x438d09` reaches
   * them by adding **2** to the tag already playing: wind-up 0 strikes with 2
   * and wind-up 1 with 3.
   */
  strike: [
    { cels: [1812], hold: 2, kind: 7, tag: 2, from: "0x4742a0 tag 2" },
    { cels: [1815], hold: 2, kind: 7, tag: 3, from: "0x4742a0 tag 3" },
  ] as const,
  /** kind 8 tag 0 — the two cels it loops while the player is down */
  gloat: {
    cels: [1820, 1821],
    hold: 2,
    kind: 8,
    tag: 0,
    from: "0x474280 tag 0",
  },
  /** kind 8 tag 1 — and the one it flashes nine times in a hundred */
  gloatB: { cels: [1810], hold: 2, kind: 8, tag: 1, from: "0x474280 tag 1" },
  /**
   * `0x474328` — the descending list the creator hands `0x45ef70` as its fourth
   * argument (`0x4362f2`), zero-terminated, so three thresholds and four bands:
   * 0 beyond 400, 1 from 150, 2 from 85, 3 inside 85, and −1 behind it.
   */
  bands: [400, 150, 85],
  /**
   * `0x438cf8` — `mall.snd` 5 as a strike goes out. The bank is `0x4a75b0`, NOT
   * the punk's `0x4a7910`; `k.say` takes the id and the page knows the chapter.
   *
   * The other three this class plays are elsewhere by right: 3 as it wakes
   * (`0x4388f4`, and the page plays it through {@link Foe.wake}), 5 or 6 at the
   * lever (`0x438ae3`, {@link Foe.lever}) and 4 on a blow that lands
   * (`0x43906d`, {@link Foe.hitSound}).
   */
  shout: 5,
  from: "0x438760",
} as const;

/**
 * `0x438848` — the roller, and it is the preamble's business rather than any
 * one state's.
 *
 * Both arms of the player-down test at `0x438805` fall into `0x438841`, and
 * `0x438841` skips the roll in state 9, the death, and nowhere else — so it is
 * rolled in every state the brain runs AND in state 10, the knockdown the page
 * plays, which is why {@link maskboyReacts} calls it too.
 *
 * The three conditions are its own: the roll, the player within 300 in x, and
 * this one WEST of him (`0x438878 cmp bx, bp; jge`) — so the roller is always
 * built on the side of the player this one is not, and rolls back through
 * him. {@link BrainCtx.roller} carries the latch that keeps it to one.
 */
function rollRoller(e: Enemy, k: BrainCtx): void {
  const r = MASKBOY.roller;
  if (
    k.roll(r.odds[0]) < r.odds[1] &&
    Math.abs(k.player.x - k.anchorX(e)) < r.within &&
    k.anchorX(e) < k.player.x
  )
    k.roller(e, { x: k.player.x + r.beyond, y: k.player.y, vx: r.vx });
}

/**
 * What it does while the page plays its knockdown and its death: the gang's
 * own ({@link gangCorpse} — the knockdown held until it lands, the corpse
 * stopped and lowered), and the roller's roll, which `0x438841` takes in
 * state 10 as in any other.
 */
export const maskboyReacts: Reaction = (e, foe, run, k) => {
  // `0x438805` comes first: the gloat goes on over the knockdown, and the roll
  // at `0x438841` is taken on the state it has just written
  const down = e.state === "flinch" && k.player.down ? maskboyDown(e, k) : undefined;
  gangCorpse(e, foe, run, k);
  if (e.state === "flinch") rollRoller(e, k);
  return down;
};

/**
 * The preamble's gloat, `0x438825`: kind 8 tag 0, turned to face him when he
 * is behind (`0x438835`). The brain installs it over any state but 1, 8 and 9;
 * {@link maskboyReacts} over the knockdown, state 10.
 */
export function maskboyDown(e: Enemy, k: BrainCtx): FoeAnim {
  if (k.track(e, MASKBOY.bands).forward < 0) turn(e);
  return MASKBOY.gloat;
}

/**
 * `initmaskboy`'s machine — states 1, 2, 5, 6, 7 and 8.
 *
 * ## The shape of it
 *
 * It stands dormant until the player's point is inside its record's rect, and
 * then it runs. The run ends in either a coast or a wind-up; the wind-up ends
 * in a strike; the strike gives ground; the give-ground settles into the guard;
 * and the guard reads the band and runs in again. There is no stance that
 * re-decides every frame the way `0x44e6e7` does for the punk — every state
 * here waits for its own script and then commits — and there is no taunt, no
 * circling and no decision budget, because the struct has nowhere to keep one.
 *
 * ## Every path returns false
 *
 * `0x438e80` is the common return and it is `xor ax, ax`. The only `mov ax, 1`
 * in the whole function is `0x438e0e`/`0x438e5a`, the two frames the corpse is
 * removed, and the page owns those. So every path below answers `false`,
 * waiting ones included: answering `true` would hold the animation where it is
 * with its stride unspent.
 *
 * `0x438e84` also writes `obj+0x1a = 0x64` on the way out of every frame — the
 * strength percent, re-asserted whatever the state. {@link Foe} carries that
 * number, so it is not written again here.
 */
export const maskboy: Brain = (e, foe, run, k) => {
  const done = e.clock >= run;
  const t = k.track(e, MASKBOY.bands);
  const state = e.script ?? 0;
  rollRoller(e, k);
  /**
   * `0x438805` — `0x402f60` says the player is down, and then everything on its
   * feet but the dormant one and the gloat itself drops what it is doing,
   * installs kind 8 tag 0 and turns to face him.
   *
   * It does not return: `0x4388b0` re-reads `obj+0x18` and dispatches on the
   * state the install has just written. State 8's tag 0 then opens on
   * `obj+0x46`, which `0x45d0db` cleared an instant earlier, so the frame ends
   * there — which is why this is written as a return.
   *
   * State 0 is this page's own marker, not the executable's: a page-spawned
   * one carries no kind until it is first installed, and case 0 below stands
   * for the class's state 1. It is excluded here for the same reason state 1
   * is.
   */
  if (k.player.down && state !== 0 && state !== 1 && state !== 8) {
    return install(e, maskboyDown(e, k));
  }
  switch (state) {
    /**
     * ---- 0 and 1, `0x4388c5`: dormant, and the ONLY thing that ends it.
     *
     * State 0 is not the executable's — `0x4388b0`'s `dec eax` puts it out of
     * the table — but a page-spawned one has no kind yet and `0x4386f5` stands
     * a fresh one up on kind 1, so both mean the same thing here: the dormant
     * cel.
     *
     * It zeroes both velocities every frame (`0x4388ca`, `0x4388cf`) and tests
     * `0x434200(player.point, AI+0xc)` — the player's own point inside the four
     * words the creator copied out of the `init` record, which is
     * {@link Enemy.fighting}. Not a radius and not the room. There is no patrol
     * walk at all: outside the rect this class stands still for ever.
     *
     * `0x4388f4` shouts `mall.snd` 3 as it starts, and the page already plays
     * that through {@link Foe.wake} on the same test, so it is not repeated
     * here — saying it twice would be one blow of the disc's and two of ours.
     */
    case 0:
    case 1:
      e.vx = 0;
      e.vy = 0;
      e.speed = 0;
      return e.fighting ? install(e, MASKBOY.run) : install(e, MASKBOY.dormant);
    // ---- 2, `0x438906`: the guard, sub-dispatched at `0x438ebc`
    case 2:
      return guard(e, k, t, done);
    /**
     * ---- 3: the table's third entry is `0x438e80`, the common return, and the
     * class owns no kind-3 script — nothing can put it here.
     * ---- 4, `0x4389e3`: the lever job, and the page owns it — {@link NOT_HERE}.
     */
    case 3:
    case 4:
      return false;
    // ---- 5, `0x438b00`: travel, sub-dispatched at `0x438ed4`
    case 5:
      return travel(e, k, t, done);
    /**
     * ---- 6, `0x438c55`: the leap, and it is a straight chain.
     *
     * Each of the three tags waits for `obj+0x46` and hands to the next:
     * `0x438c6c` take-off to flight, `0x438c83` flight to landing, `0x438c9a`
     * landing to the give-ground. The whole state is only reachable through the
     * blocked-word counter, which this port never starts — see
     * {@link NOT_HERE} — so it is written for completeness, not for use.
     */
    case 6:
      if (!done) return false;
      if ((e.tag ?? 0) === 0) return install(e, MASKBOY.flight, true);
      if ((e.tag ?? 0) === 1) return install(e, MASKBOY.landing, true);
      if ((e.tag ?? 0) === 2) return install(e, MASKBOY.backOff);
      return false;
    // ---- 7, `0x438cac`: the attack, sub-dispatched at `0x438eec`
    case 7:
      return attack(e, k, t, done);
    /**
     * ---- 8, `0x438d39`: the gloat, and what ends it is him standing up.
     *
     * `0x438d39` re-tests `0x402f60` before anything else: the frame the player
     * is upright again this hands straight to the run. Otherwise the two tags
     * are a pair of loops with a nine-in-a-hundred leak between them —
     * `0x438d6e` out of tag 0 and `0x438da0` out of tag 1, both
     * `0x434540(0x64)` against 10.
     */
    case 8: {
      if (!k.player.down) return install(e, MASKBOY.run);
      if (!done) return false;
      if ((e.tag ?? 0) === 0) {
        // `0x438d7f` puts tag 0 on again, rewinding it: one roll a lap
        return k.roll(100) < 10
          ? install(e, MASKBOY.gloatB)
          : rewind(e, MASKBOY.gloat);
      }
      return k.roll(100) < 10 ? install(e, MASKBOY.gloat) : false;
    }
    /**
     * ---- 9 and 10, `0x438db5` and `0x438e69`: the death and the knockdown,
     * which the page's own hit path drives — {@link NOT_HERE}.
     */
    default:
      return false;
  }
};

/**
 * State 2, `0x438906` — the guard, which is where this class waits.
 *
 * The turn comes first and does NOT return (`0x438906`: forward negative and
 * `obj+0x28` is flipped), then the tag decides. Tags 3 and 4 are the table's
 * common return and the class owns no such frames.
 */
function guard(
  e: Enemy,
  k: BrainCtx,
  t: ReturnType<BrainCtx["track"]>,
  done: boolean,
): boolean {
  // `0x438906` — turn, and carry on
  if (t.forward < 0) turn(e);
  switch (e.tag ?? 0) {
    /**
     * tags 0 and 1, `0x438959` — the pose, and the whole of the distance
     * reading is here.
     *
     * `0x438959` takes the innermost band first: inside 85 it walks backwards
     * out of it. `0x43896d`, `0x438979` and `0x438985` then take bands 0, 1 and
     * 2 — every distance in FRONT of it — and answer all three the same way,
     * with the run. What is left is band −1, the player behind it, and
     * `0x438991` reads `out+6`: it braces only while his own cel carries a
     * strike box, and otherwise holds the pose and looks at nothing.
     */
    case 0:
    case 1:
      if (t.band === 3) return install(e, MASKBOY.giveGround);
      if (t.band === 0 || t.band === 1 || t.band === 2) {
        return install(e, MASKBOY.run);
      }
      if (!k.player.swinging) return false;
      return install(e, MASKBOY.brace);
    /**
     * tag 2, `0x4389a9` — the brace, and it is held until he swings.
     *
     * No `obj+0x46` test at all: three cels of 1803 loop for as long as the
     * player is not mid-blow, and the frame he is, a coin at `0x4389b5` drops it
     * back into one of the two poses.
     */
    case 2:
      if (!k.player.swinging) return false;
      return install(e, MASKBOY.guard[k.roll(2) - 1]);
    // tag 5, `0x4389cc` — the give-ground runs out into the first pose
    case 5:
      return done ? install(e, MASKBOY.guard[0]) : false;
    default:
      return false;
  }
}

/**
 * State 5, `0x438b00` — travel, and every branch of it weighs `obj+0xc`.
 *
 * `obj+0xc` is the sideways speed each frame's stride is added into, and the
 * class's 0.05 friction (`0x4386c4`) leaves most of a run's worth of it under
 * the thing for a dozen frames; {@link ahead} reads it along the facing.
 * `obj+0x30` is the at-rest word the mover sets from the velocity pair
 * (`0x430314` clears it while either is non-zero, `0x43031c` sets it when both
 * are).
 */
function travel(
  e: Enemy,
  k: BrainCtx,
  t: ReturnType<BrainCtx["track"]>,
  done: boolean,
): boolean {
  switch (e.tag ?? 0) {
    /**
     * tags 0 and 1, `0x438b47` — the coast, and it is all momentum.
     *
     * `0x438b47` weighs the mirror flag against `obj+0xc`: facing west and
     * travelling east, or facing east and travelling west, means the run has
     * been turned back, and `0x438b6b` adds that anything under twenty is not
     * travelling at all. Either way it hands straight to the run again.
     */
    case 0:
    case 1: {
      const speed = ahead(e);
      if (speed < 0 || Math.abs(speed) < 20) return install(e, MASKBOY.run);
      // `0x438b7d` — he got behind it while it was coasting: give ground
      if (t.forward < 0) return install(e, MASKBOY.backOff);
      // `0x438b8c` — and only the second band, 150 to 400, commits to a swing
      if (t.band !== 1) return false;
      return install(e, MASKBOY.windUp[k.roll(2) - 1], true);
    }
    /**
     * tag 4, `0x438baf` — the run, and what it does when its six cels are up.
     *
     * `0x438bba` looks as though it re-installs the run when the player's back
     * is turned (`out+0` zero) or he is beyond the first band — and it does
     * nothing at all. `0x45d090` has no early-out; its whole body is stores.
     * Control falls out of that install straight into `0x438bd9`, which
     * installs over it unconditionally two instructions later. So the
     * re-install is dead in the executable and what is observable is the choice
     * below: band 1 coasts, anything else winds up.
     */
    case 4:
      if (!done) return false;
      if (t.band === 1) return install(e, MASKBOY.carry[k.roll(2) - 1]);
      return install(e, MASKBOY.windUp[k.roll(2) - 1], true);
    /**
     * tag 5, `0x438c08` — the give-ground, and it ends in the guard.
     *
     * While it is still carried forward and not yet at rest it replays its own
     * cel each time the script runs out (`0x438c2b`). At rest — or drifting
     * backwards — it turns to face him (`0x438c3d`) and takes the guard.
     */
    case 5: {
      const speed = ahead(e);
      const atRest = speed === 0 && e.vy === 0;
      if (!atRest && speed >= 0) {
        return done ? rewind(e, MASKBOY.backOff) : false;
      }
      if (t.forward < 0) turn(e);
      return install(e, MASKBOY.guard[0]);
    }
    // tags 2 and 3 are `0x438e80` in the table, and no kind-5 script carries them
    default:
      return false;
  }
}

/**
 * State 7, `0x438cac` — the attack: wind up, strike, give ground.
 *
 * It opens on `0x402f60` before it looks at the tag, so the frame the player
 * goes down mid-swing it abandons the blow and steps back instead. (That is a
 * second `0x402f60` in the same frame — the prologue at `0x438805` has already
 * asked and already installed the gloat — and state 7 is not one of the three
 * the prologue spares, so this arm is only reachable through the page's own
 * ordering. It is written because the executable writes it.)
 */
function attack(
  e: Enemy,
  k: BrainCtx,
  t: ReturnType<BrainCtx["track"]>,
  done: boolean,
): boolean {
  // `0x438cac` — he is down: drop the swing
  if (k.player.down) return install(e, MASKBOY.backOff);
  const tag = e.tag ?? 0;
  switch (tag) {
    /**
     * tags 0 and 1, `0x438cd1` — the wind-up, held while it is still travelling.
     *
     * Three things let the blow go, and any one of them is enough: `obj+0x2a`,
     * the "something hit me" word `0x430663` writes on the victim of an elastic
     * collision and which nothing in this port sets; the player getting behind
     * it; or its own sideways speed falling under ten — so a wind-up thrown
     * out of a coast rides in on it.
     *
     * `0x438cf2` shouts `mall.snd` 5, `0x438d09` adds **2** to the tag to pick
     * the strike, and `0x438d19` clears `obj+0x2a` behind it.
     */
    case 0:
    case 1:
      if (t.forward >= 0 && Math.abs(ahead(e)) >= 10) return false;
      k.say(e, MASKBOY.shout);
      return install(e, MASKBOY.strike[tag], true);
    // tags 2 and 3, `0x438d27` — one cel of a blow, and then it steps back
    case 2:
    case 3:
      return done ? install(e, MASKBOY.backOff) : false;
    default:
      return false;
  }
}

export { NOT_HERE as MASKBOY_NOT_HERE };
