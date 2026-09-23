/**
 * The thing in the pipe — `initox`, `0x43f2a0`, and the biggest brawler chapter
 * two has: 600 health, a stride of 85 and a run of 280.
 *
 * ## Its ten scripts, and therefore its ten states
 *
 * `0x45d090` writes a script's own kind into `obj+0x18`, so this table IS the
 * machine's alphabet. All ten were walked out of the class's data region, from
 * `0x472e88` up to the band list at `0x473320`; nothing else lives in between
 * and no other class names any of them:
 *
 * ```
 *   0  0x472e88  the patrol: two six-cel halves of one walk, alternating
 *   1  0x472f28  the approach — tag 0 the walk in, tag 1 the run PAST
 *   2  0x472ef0  one cel, going nowhere: the stand, and the state that DECIDES
 *   3  0x473140  the two idles — tag 0 the long one, tag 1 the short
 *   4  0x472ff0  the LEVER job — tag 0 the run to it, tag 1 the reach
 *   5  0x473098  the three attacks
 *   6  0x4731e0  the flinch — tag 0 one cel, tag 1 the long knockback
 *   7  0x472f00  the FALL — tag 0 while it drops, tag 1 as it is taken away
 *   8  0x473260  the charge
 *   9  0x4732d8  the death
 * ```
 *
 * The jump table is `0x43f90c`, ten entries, read straight out of the file:
 * `0x43f3ac, 0x43f485, 0x43f4f9, 0x43f696, 0x43f6e2, 0x43f789, 0x43f7a9,
 * 0x43f7c9, 0x43f868, 0x43f885`. Inside state 2 there is a SECOND table,
 * `0x43f934`, four entries over the band — `0x43f56a, 0x43f596, 0x43f621,
 * 0x43f641` — and that second table is the whole of the fight.
 *
 * ## What this module owns, and what it does not
 *
 * States 0, 1, 2, 3, 5 and 8 are the ones it is in while it is on its feet, and
 * those are here. Four are deliberately elsewhere and are named at
 * {@link NOT_HERE}: state 4 is the lever job, which {@link Foe.lever} and the
 * page's own `stepFight` already drive and which short-circuits before a brain
 * is ever called; states 6, 7 and 9 are the flinch, the fall and the death,
 * which {@link Foe.flinch}, {@link Foe.pick} and {@link Foe.death} own.
 *
 * ## The AI struct — and it is NOT the punk's
 *
 * `0x435c70` allocates `0x433f20(0x36)` and fills it in, so every slot below is
 * from the creator itself. **Read the punk's layout onto this one and every
 * field lands on the wrong thing:**
 *
 * ```
 *   AI+0x00  word   `0x40e300(0x258)` — its HEALTH, 600 scaled (0x435cdf)
 *   AI+0x02  dword  the PLAYER object, copied out of [0x4ac3d4] (0x435ccb)
 *   AI+0x06  dword  the record rect's first two words — top, left  (0x435cfd)
 *   AI+0x0a  dword  and its second two — bottom, right             (0x435cff)
 *   AI+0x0e  word   seeded 8 — the class's one COUNTDOWN           (0x435cd9)
 *   AI+0x10  dword  the lever it has found, or 0 — written by `0x43f950`
 *   AI+0x14  ...    the tracker input `0x45ef70` builds             (0x435d08)
 * ```
 *
 * So the punk's nerve slot is this one's health, the punk's beat slot is half a
 * pointer, and there is no `AI+4` decision budget and no `AI+6` side at all:
 * this class never picks a side of the player and never breaks off a fight on a
 * budget. The one countdown, `AI+0xe`, is carried here as {@link Enemy.beat} —
 * and it is the **only** slot this port spends.
 *
 * ## The rect it fights inside is WIDER than its record
 *
 * `0x43f2be`..`0x43f2d2` copies the record rect into a stack local and then
 * `sub word ptr [esp+0xe], 0xc8` / `add word ptr [esp+0x12], 0xc8` — 200 off the
 * left and 200 onto the right. `0x434200` is then run against THAT, both on the
 * way in (state 0, `0x43f3ac`) and on the way out (state 2, `0x43f518`). The
 * page's own `e.fighting` is the same call on the un-widened rect, so the two
 * disagree by 200 pixels either side; this file uses the executable's widened
 * one and leaves `e.fighting` to the page, which is why {@link inPatch} is
 * written out longhand instead of reading the flag.
 */
import {
  install,
  type Brain,
  type BrainCtx,
  type Enemy,
  type Reaction,
} from "./kit";

/**
 * The four states a brain is never in, and what each of them does that this
 * file therefore does not.
 *
 * - **4**, the lever, `0x43f6e2`. `0x43f950` walks the world's switch list at
 *   `[0x472570]` and answers the first one whose point is inside this keeper's
 *   own record rect and whose `obj+0x44` is **1** — a lever that is ON. The
 *   preamble at `0x43f371` stores it in `AI+0x10` and installs `0x472ff0` tag 0,
 *   the run, **before the jump table is ever reached**: while a lever is
 *   standing the machine below does not run at all. Tag 0 closes until
 *   `|dx| < 0x89` AND `|dy| < 0x89` (`0x43f706`, `0x43f71c` — the only reach
 *   test in the game that weighs the height too), then installs tag 1 and calls
 *   `0x436820(lever, 1)` on the same frame, which is the direction that puts a
 *   LIT lever out. Tag 1 ends in the stand. The page's `stepFight` already does
 *   all of this through {@link Foe.lever} and returns before the brain, so
 *   porting it here would give one animation two owners.
 * - **6**, the flinch, `0x43f7a9`: waits for the script and stands up. What is
 *   worth knowing is what installs it — `0x43f9a0`, the hit handler, rolls
 *   `0x434540(3)` and on a **2 or a 3** does not flinch at all: it rolls again
 *   and answers the blow with one of the three ATTACKS of `0x473098`, sound
 *   `0x2f + n` to match. Only a 1 reaches `0x4731e0` tag 1, the long knockback.
 *   So two blows in three are answered rather than taken.
 * - **7**, the fall, `0x43f7c9` — and this one is not a hit reaction at all, it
 *   is the pit. `0x42fdbc` accumulates `obj+0x32 += vy` for every airborne frame
 *   the thing is falling, and the preamble at `0x43f325` watches for that to pass
 *   **100**: more than a hundred pixels of drop and it is put into `0x472f00`
 *   tag 0 with `AI+0xe` set to twice `[0x46b204]` and sound `0x35`, which the
 *   bank names `#0390 ox scooby`. Tag 0 holds until the counter runs out and the
 *   fall has stopped; tag 1 plays three cels, pays `0x40d450(0x140)` — the same
 *   320 points the kill pays — drops the bar, shakes the screen with
 *   `0x4307c0(3)` and **returns 1**, the one answer in this class that removes
 *   the object.
 * - **9**, the death, `0x43f885`: `0x4732d8`, eight cels at two ticks each, with
 *   sound `0x3d` and another `0x4307c0(3)` on frame 5. `AI+0xe` counts the
 *   corpse down from ten times `[0x46b204]` (`0x43fa6f`) and the last frame
 *   answers 1.
 */
const NOT_HERE = "0x43f6e2, 0x43f7a9, 0x43f7c9, 0x43f885" as const;

/**
 * Its repertoire, by kind and tag, straight out of `0x472e88`…`0x473260`.
 *
 * Every cel, hold and stride below is the script's own; `hold` is the header's
 * `ticksPerFrame`, which is 1 on all nine of the scripts this file installs.
 * The strides are the engine's pre-divisor units and `obj+0xe` is **13**
 * (`0x43f1fb`), so the walk's 85 is 6.5 pixels a frame and the run's 280 is
 * 21.5 — faster than the player.
 */
export const OX = {
  /** kind 0 tag 0 — the first half of the patrol walk */
  patrolA: {
    cels: [5090, 5091, 5092, 5093, 5094, 5095],
    hold: 1,
    dx: [85, 85, 85, 85, 85, 85],
    kind: 0,
    tag: 0,
    from: "0x472e88 tag 0",
  },
  /**
   * kind 0 tag 1 — the second half, and the patrol alternates the two.
   *
   * `0x43f449` does not pick: it computes `1 - obj+0x44` and installs whichever
   * half is not the one that just played, so the twelve cels are one walk cut in
   * two and each hand-over is a fresh sound.
   */
  patrolB: {
    cels: [5096, 5097, 5098, 5099, 5100, 5101],
    hold: 1,
    dx: [85, 85, 85, 85, 85, 85],
    kind: 0,
    tag: 1,
    from: "0x472e88 tag 1",
  },
  /** kind 2 — one cel and no stride: the stand, and state 2 is the whole fight */
  stand: {
    cels: [5090],
    hold: 1,
    kind: 2,
    tag: 0,
    from: "0x472ef0 tag 0",
  },
  /** kind 1 tag 0 — all twelve walk cels at the walk's own 85 */
  walkIn: {
    cels: [
      5090, 5091, 5092, 5093, 5094, 5095, 5096, 5097, 5098, 5099, 5100, 5101,
    ],
    hold: 1,
    dx: [85, 85, 85, 85, 85, 85, 85, 85, 85, 85, 85, 85],
    kind: 1,
    tag: 0,
    from: "0x472f28 tag 0",
  },
  /**
   * kind 1 tag 1 — the same twelve cels at **280**, and it is a run PAST.
   *
   * `0x43f634` flips the mirror flag before installing it, so the one band-2
   * answer in four that is not an attack turns the thing round and sends it
   * away at more than three times its walking speed.
   */
  runPast: {
    cels: [
      5090, 5091, 5092, 5093, 5094, 5095, 5096, 5097, 5098, 5099, 5100, 5101,
    ],
    hold: 1,
    dx: [280, 280, 280, 280, 280, 280, 280, 280, 280, 280, 280, 280],
    kind: 1,
    tag: 1,
    from: "0x472f28 tag 1",
  },
  /**
   * kind 3 — the two idles, and neither travels.
   *
   * Tag 0 is fourteen cels of standing about with a sound on frame 2, and the
   * bank calls that sound `#0370 buttpicks`, which is what the fourteen cels
   * are. Tag 1 is five.
   */
  taunt: [
    {
      cels: [
        5180, 5181, 5181, 5182, 5182, 5181, 5181, 5182, 5182, 5183, 5184, 5185,
        5186, 5187,
      ],
      hold: 1,
      kind: 3,
      tag: 0,
      from: "0x473140 tag 0",
    },
    {
      cels: [5110, 5111, 5112, 5113, 5114],
      hold: 1,
      kind: 3,
      tag: 1,
      from: "0x473140 tag 1",
    },
  ] as const,
  /**
   * kind 5 — the three attacks, and this class has more of them than anything
   * else in its chapter.
   *
   * All three step in on their opening cels and then plant. They are also what
   * the hit handler answers a blow with two times in three (see
   * {@link NOT_HERE}), which is why the page carries the same three cel lists
   * as `initox`'s `flinch`: one set of scripts, two ways in.
   */
  attack: [
    {
      cels: [5160, 5161, 5162, 5163, 5164],
      hold: 1,
      dx: [85, 85, 85, 85, 0],
      kind: 5,
      tag: 0,
      from: "0x473098 tag 0",
    },
    {
      cels: [5170, 5171, 5172, 5173, 5174, 5175],
      hold: 1,
      dx: [85, 85, 105, 0, 0, 0],
      kind: 5,
      tag: 1,
      from: "0x473098 tag 1",
    },
    {
      cels: [5120, 5121, 5122, 5123, 5124, 5123, 5122, 5121, 5120],
      hold: 1,
      dx: [85, 85, 105, 0, 0, 0, 0, 0, 0],
      kind: 5,
      tag: 2,
      from: "0x473098 tag 2",
    },
  ] as const,
  /**
   * kind 8 — the charge, fourteen cels that break into a run halfway.
   *
   * `0x4731e0` tag 1, the long knockback, is this same run played backwards
   * from 5155 down to 5140, which is the giveaway for what it is: the thing
   * builds up and shoulders through, and a blow that lands sends it back along
   * its own tracks. See {@link ox}'s state 2 for why it is never seen.
   */
  charge: {
    cels: [
      5140, 5141, 5142, 5143, 5144, 5145, 5146, 5147, 5150, 5151, 5152, 5153,
      5154, 5155,
    ],
    hold: 1,
    dx: [85, 85, 85, 85, 85, 85, 280, 85, 280, 280, 280, 280, 280, 280],
    kind: 8,
    tag: 0,
    from: "0x473260 tag 0",
  },
  /**
   * `0x473320` — the descending list `0x45efd0` reads the band out of, pushed as
   * the fourth argument of `0x45ef70` at `0x435cf5` and zero-terminated
   * (`0x45ef9f`). Three entries, so state 2's four-way table is every band there
   * is: 0 beyond 300, 1 from 140, 2 from 100, 3 inside 100.
   */
  bands: [300, 140, 100],
  /**
   * `mall.snd`, bank `0x4a75b0`, and the bank's own names settle what each one
   * is: `#0320 ox left foot`, `#0330 ox flip`, `#0340 ox walk`, `#0345 ox walk
   * 2`, `#0350`/`#0360`/`#0365 ox attack`, `#0370 buttpicks`.
   */
  foot: 0x2b,
  flip: 0x2c,
  /** `0x43f46b` and `0x43f57c` — `0x434540(2) + 0x2c`, so 0x2d or 0x2e */
  walk: 0x2d,
  /** `0x43f655` and `0x43fa9e` — `0x2f + tag`, one per attack */
  attackSay: 0x2f,
  /** `0x43f6b3` — frame 2 of the long idle */
  idle: 0x32,
  /** `0x43f890` — frame 5 of the death, and again as the fall ends (`0x43f81f`) */
  fall: 0x3d,
  from: "0x43f2a0",
} as const;

/** `0x43f2cb`/`0x43f2d2` — what the record rect is widened by, each side */
const MARGIN = 200;

/** `0x43f5aa` and `0x435cd9` — what `AI+0xe` is seeded and re-seeded with */
const BEAT = 8;

/**
 * `0x434200(point, rect)`, written out because this class does not hand it the
 * rect the page does.
 *
 * The rect is four words in the order **top, left, bottom, right** — `0x434209`
 * and `0x434213` bound `point+2` with words 1 and 3, `0x434222` and `0x43422b`
 * bound `point+0` with words 0 and 2, and an object's point is `obj+6` = Y,
 * `obj+8` = X. The far edges are exclusive, which is `jle`/`jg` rather than the
 * page's inclusive `inside`.
 *
 * The player's own Y here is his ANCHOR, not his feet — the engine compares the
 * record rect against his `obj+6`, and `k.player.top` is the page's name for
 * that same number.
 */
function inPatch(e: Enemy, k: BrainCtx): boolean {
  const x = k.player.x;
  const y = k.player.top;
  return (
    e.left - MARGIN <= x && x < e.right + MARGIN && e.top <= y && y < e.bottom
  );
}

/**
 * `initox`'s own machine — states 0, 1, 2, 3, 5 and 8.
 *
 * ## The stack frame, which is where the field numbers come from
 *
 * `0x43f2a0` opens `sub esp, 0x18` and takes `lea eax, [esp+0xc]` **before** it
 * pushes `ebx`, `esi` and `edi`, so the twelve bytes `0x45efd0` fills sit at
 * `esp+0xc` from the prologue's point of view and at **`esp+0x18`** everywhere
 * after the pushes. That pins the reads: `esp+0x1c` is `out+4`, the BAND — which
 * is what the second jump table at `0x43f934` indexes — and `esp+0x22` is
 * `out+0xa`, the forward distance, the thing every turn-to-face test weighs
 * against zero. The cross-check is the argument slots: `0x43f2aa` reads the AI
 * struct from `[esp+0x2c]` and `0x43f2e7` the object from `[esp+0x28]`, which
 * are `esp0+8` and `esp0+4` only if `esp` is `esp0-0x24` there, and it is.
 *
 * Read four bytes low and `esp+0x18` looks like the band while it is really
 * `out+0`, the side — three values instead of four, and the fight still
 * compiles.
 *
 * ## The other rule
 *
 * **A think function never suppresses the animation.** Every path in
 * `0x43f2a0` falls through `0x43f8fa`, which sets `obj+0x1a` to 100 and answers
 * `xor ax, ax`. The only two `mov ax, 1` in the whole function are `0x43f85a`,
 * the frame the fallen one is taken away, and `0x43f8e6`, the frame the corpse
 * is removed — both in states this file does not own. So every path below
 * returns **false**, the waiting ones included.
 *
 * ## What the preamble does that this file does not
 *
 * - `0x43f2f7`..`0x43f31c` claims the on-screen bar with `0x32ce` and
 *   `0x40e300(0x258)` whenever the player is in front and inside the first band.
 *   That is the HUD, not behaviour.
 * - `0x43f325` is the pit — see {@link NOT_HERE}.
 * - `0x43f371` is the lever search, and it runs before the jump table — see
 *   {@link NOT_HERE} again.
 * - `obj+0x1a = 0x64` on the way out is this class committing its full strength
 *   on every frame of every state. **Nothing hits the player back in this
 *   port**, so it is carried as read and spends nothing.
 * - `obj+0x42`, the engine's frame index into the running script (`0x45d0ab`
 *   rewinds it), is watched in four places for a sound: frames 6 and 11 of the
 *   patrol and of the approach for `0x2b`, the footfall, frame 2 of the long
 *   idle for `0x32`, and frame 5 of the death for `0x3d`. The page has no
 *   per-frame hook, and the footfall ones also fire `0x4307c0(1)` — the small
 *   screen-shake envelope `[8, 4]` at `[0x4a89a2]` — so all four are documented
 *   here and none is said. The sounds a state makes as it is CHOSEN are ported,
 *   because those happen once where this brain can see them.
 */
export const ox: Brain = (e, foe, run, k) => {
  const done = e.clock >= run;
  const t = k.track(e, OX.bands);
  // `AI+0xe`, and it is the only slot of the struct this port spends
  e.beat ??= BEAT;
  switch (e.script ?? 0) {
    /**
     * ---- 0, `0x43f3ac`: the patrol, and the two things that end it.
     *
     * It walks its record between the rect's own left and right — `AI+8` and
     * `AI+0xc`, the second and fourth words — turning at either end and turning
     * again within sixty pixels of the level's walk bound, and each time a half
     * of the walk finishes it starts the other half and says one of the two
     * walk sounds.
     */
    case 0: {
      // `0x43f3b8`/`0x43f3c5` — both the widened rect AND the player upright
      if (inPatch(e, k) && !k.player.down) return install(e, OX.stand);
      // `0x43f3e4` — a footfall on script frames 6 and 11, which are the first
      // and last of tag 1's six
      if ((e.tag ?? 0) === 1) footfall(e, k, 6);
      /**
       * `0x43f407` — the rect's ends, read against `obj+8`, the X.
       *
       * Past the right edge while facing east, or past the left while facing
       * west: `0x43f418` and `0x43f427` both test `obj+0x28`, the mirror flag,
       * so a thing already walking back out of the overshoot is left alone.
       */
      if (e.x > e.right && e.facing > 0) e.facing = -e.facing;
      else if (e.x < e.left && e.facing < 0) e.facing = -e.facing;
      // `0x43f42d` — `0x442670` is `0x456550` byte for byte: within 60 of the
      // bound it FACES, `obj+0x38` or `obj+0x3a` by the mirror flag
      if (k.atBound(e)) e.facing = -e.facing;
      if (!done) return false;
      // `0x43f449` — `1 - obj+0x44`, so the halves alternate for ever
      k.say(e, OX.flip + k.roll(2));
      return install(e, (e.tag ?? 0) === 0 ? OX.patrolB : OX.patrolA);
    }
    /**
     * ---- 1, `0x43f485`: the approach, and the bound cuts it short.
     *
     * The walk in and the run past are one state, and neither of them looks at
     * the player at all: they play, and they hand back to the stand, which is
     * where every decision is made. The one thing that interrupts is the level's
     * own walk bound — `0x43f48e` turns the thing round and stands it up on the
     * spot rather than letting it march into the wall.
     */
    case 1:
      if (k.atBound(e)) {
        e.facing = -e.facing;
        return install(e, OX.stand);
      }
      // `0x43f4ac` — the same footfall on frames 6 and 11, which only tag 0's
      // twelve reach, and `0x43f4d1` shakes the screen with it
      if ((e.tag ?? 0) === 0 && footfall(e, k, 0)) k.shake(1);
      return done ? install(e, OX.stand) : false;
    // ---- 2, `0x43f4f9`: the stand, and the only state that thinks
    case 2:
      return decide(e, k, t, done);
    /**
     * ---- 3, `0x43f696`: the idles, and both of them just end.
     *
     * The handler's only other business is `0x43f6a8`: sound 0x32 on frame 2
     * of tag 0, the long one.
     */
    case 3:
      if ((e.tag ?? 0) === 0 && Math.floor(e.clock / e.anim.hold) === 2)
        k.say(e, OX.idle);
      return done ? install(e, OX.stand) : false;
    // ---- 5, `0x43f789`: an attack plays through and hands back to the stand
    case 5:
      return done ? install(e, OX.stand) : false;
    /**
     * ---- 8, `0x43f868`: the charge, which ends in the stand like everything
     * else — and which the executable never actually leaves installed.
     *
     * `0x473260` is referenced from exactly one place in the whole file,
     * `0x43f612`, and that is state 2's band-1 second roll: it says `0x2c`,
     * installs the charge, and then `jmp 0x43f641` falls into the THIRD roll's
     * body, which installs one of `0x473098`'s attacks over the top of it on the
     * same frame. The missing `jmp 0x43f676` is a bug in the original, and the
     * net effect is that roll 2 is a third way of reaching the attacks with a
     * different sound in front of it. The state is implemented because the
     * handler is real; it is documented because nothing can reach it.
     */
    case 8:
      return done ? install(e, OX.stand) : false;
    /**
     * Kind 4 is the lever and kinds 6, 7 and 9 are the flinch, the fall and the
     * death — all four are somebody else's, see {@link NOT_HERE}, and the page
     * never calls a brain while one of them is running.
     */
    default:
      return false;
  }
};

/**
 * State 2, `0x43f4f9` — the stand, and the whole of the fight.
 *
 * Three gates and then a band. The first two are the way OUT: the player on the
 * floor, or the player out of the widened rect, and either sends it back to the
 * patrol. The third turns it round. Then `0x43f555` reads the band and jumps
 * through `0x43f934`.
 *
 * Every one of those four branches falls through `0x43f676`, which re-installs
 * the stand if the script has ended — harmless after a branch that installed
 * something, because `0x45d0db` has just cleared `obj+0x46`, and the actual
 * point of it for the one branch that can decline to choose.
 */
function decide(
  e: Enemy,
  k: BrainCtx,
  t: ReturnType<BrainCtx["track"]>,
  done: boolean,
): boolean {
  // `0x43f4f9` — `0x402f60`, the player upright, and this class walks away
  // rather than milling round him: `0x43f505` is the patrol, tag 0
  if (k.player.down) return install(e, OX.patrolA);
  // `0x43f527` — and the same widened rect that let it in lets it out again
  if (!inPatch(e, k)) return install(e, OX.patrolA);
  // `0x43f549` — this one does NOT return: it turns and carries on deciding, so
  // the band below is still the one measured through the OLD facing
  if (t.forward < 0) e.facing = -e.facing;
  switch (t.band) {
    /**
     * Beyond 300 — `0x43f56a`, and there is nothing to think about: say a walk
     * sound and walk the twelve cels in.
     */
    case 0:
      k.say(e, OX.flip + k.roll(2));
      return install(e, OX.walkIn);
    /**
     * 140..300 — `0x43f596`, the only band with a clock on it.
     *
     * `AI+0xe` counts down one a frame and the test is on the value BEFORE the
     * decrement, so a fresh 8 is nine frames of standing there. When it runs out
     * it is re-seeded to 8 and `0x434540(3)` picks one of three:
     *
     * 1. one of the two idles, with `0x2d + n` to match;
     * 2. the charge — which, as {@link ox}'s state 8 explains, is immediately
     *    overwritten by roll 3's attack, leaving only its `0x2c`;
     * 3. one of the three attacks, `0x2f + n`.
     */
    case 1: {
      const beat = e.beat ?? BEAT;
      e.beat = beat - 1;
      if (beat >= 0) return done ? install(e, OX.stand) : false;
      e.beat = BEAT;
      const roll = k.roll(3);
      if (roll === 1) {
        // `0x43f5ce` — `0x434540(2) - 1`, and the sound carries the same index
        const n = k.roll(2) - 1;
        k.say(e, OX.walk + n);
        return install(e, OX.taunt[n]);
      }
      if (roll === 2) {
        /**
         * `0x43f5fc` — the charge, and the missing `jmp` underneath it.
         *
         * Both installs are written out because both really happen: `0x45d090`
         * runs on `0x473260` and then again on `0x473098` before the frame is
         * over, so the charge's kind reaches `obj+0x18` and is gone again
         * without a cel of it being drawn.
         */
        k.say(e, OX.flip);
        install(e, OX.charge, true);
      }
      // `0x43f641` — roll 3's body, and roll 2 falls into it
      return strike(e, k);
    }
    /**
     * 100..140 — `0x43f621`, and this is the band with the odd answer in it.
     *
     * `0x434540(4) - 1`: three of the four are the three attacks, and the
     * fourth, index 3, flips the mirror flag and runs the twelve walk cels at
     * 280 — away from the player, at a speed he cannot match. It is how the
     * thing disengages, and it is the only place `0x472f28` tag 1 is used.
     */
    case 2: {
      const n = k.roll(4) - 1;
      if (n === 3) {
        e.facing = -e.facing;
        return install(e, OX.runPast);
      }
      k.say(e, OX.attackSay + n);
      return install(e, OX.attack[n], true);
    }
    /** inside 100 — `0x43f641`, a flat one of the three attacks */
    case 3:
      return strike(e, k);
    /**
     * ...and behind it. `0x43f55a` is `cmp eax, 3; ja`, unsigned, so the
     * tracker's −1 for "he is behind me" falls past all four cases and reaches
     * `0x43f676`: nothing is chosen this frame, the facing flip above has
     * already happened, and the next frame reads a band that means something.
     */
    default:
      return done ? install(e, OX.stand) : false;
  }
}

/**
 * `0x43f641` — one of the three attacks, flat, with the sound that goes with it.
 *
 * Reached from band 1's third roll, from band 1's second roll by fall-through,
 * and from band 3 directly. `0x434540(3) - 1` is the take and `0x2f + take` the
 * sound — the same pair `0x43fa8d` uses when a blow is answered rather than
 * taken.
 */
function strike(e: Enemy, k: BrainCtx): boolean {
  const n = k.roll(3) - 1;
  k.say(e, OX.attackSay + n);
  return install(e, OX.attack[n], true);
}

/**
 * `0x43f3e4`/`0x43f4ac` — `obj+0x42` is 6 or 11, and `0x40ef30(bank, 0x2b)`.
 *
 * `obj+0x42` counts frames from the top of the SCRIPT, not the tag, so `first`
 * is where the playing tag starts in it.
 */
function footfall(e: Enemy, k: BrainCtx, first: number): boolean {
  const at = first + Math.floor(e.clock / e.anim.hold);
  if (at !== 6 && at !== 11) return false;
  k.say(e, OX.foot);
  return true;
}

/**
 * What the ox does while the page plays its reaction or its death.
 *
 * - The answer to a blow (`0x43fa7e`): an attack of `0x473098` is installed
 *   with its voice, `0x2f + n` through `0x40ef30`, and the slide of `0x4731e0`
 *   with `0x2c` through `0x40f090`. The page picks and plays; the voice goes
 *   out on the first frame here.
 * - The death, `0x43f885`: sound 0x3d on script frame 5, with `0x43f8a1`
 *   shaking the screen.
 */
export const oxReacts: Reaction = (e, foe, _run, k) => {
  const frame = Math.floor(e.clock / e.anim.hold);
  if (e.state === "dead") {
    if (e.anim !== foe.death) return;
    // `0x43f8f4` — `obj+0x10 = -15` on every frame the body's count is still
    // running, which is all of it: it settles fifteen into the floor
    e.floor = -15;
    if (Math.floor(e.clock) === 5 * e.anim.hold) {
      k.say(e, OX.fall);
      k.shake(3);
    }
    return;
  }
  if (Math.floor(e.clock) !== 1 || frame > 1) return;
  const n = foe.flinch?.indexOf(e.anim) ?? -1;
  if (n >= 0 && n < 3) k.say(e, OX.attackSay + n);
  else if (n === 3) k.say(e, OX.flip);
};

export { NOT_HERE as OX_NOT_HERE };
