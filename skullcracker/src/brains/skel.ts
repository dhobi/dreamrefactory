/**
 * The skeleton — `initskel`, think function `0x4234b0`, nine states.
 *
 * ## Its nine scripts, and therefore its nine states
 *
 * `0x45d090` copies word 4 of a script's header into `obj+0x18`, so the kinds
 * of the scripts this class installs ARE its alphabet. All nine were read out
 * of the class's own data region, which runs unbroken from `0x46fab0` to
 * `0x46fdf6` and is immediately followed by the band list at `0x46fdf0`. The
 * jump table at `0x423a08` is `[0x423546, 0x42357d, 0x4236b1, 0x423756,
 * 0x423822, 0x4238d8, 0x4238fc, 0x423965, 0x4239af]`, one entry per kind, in
 * order.
 *
 * ```
 *   0  0x46fab0  one cel, 1200: stand still until he walks into the rect
 *   1  0x46fac0  the walk — six cels, 65 a cel, and the state that DECIDES
 *   2  0x46fc88  tag 0 the short reach, tag 1 the long one — the grab's windup
 *   3  0x46faf8  the grab itself, tag 0 and tag 1 the two player characters
 *   4  0x46fb70  tag 0 winds the arm back, tag 1 lets the bone go
 *   5  0x46fbc0  tag 0 the standing leap, tag 1 the running one
 *   6  0x46fcf0  the knockdown, tag 0 flying and tag 1 getting up
 *   7  0x46fd58  the three flinches
 *   8  0x46fd90  the death and the corpse
 * ```
 *
 * The class is in the zombie chapter, not the punk's: its cels are the 1200s
 * and 1300s, its sound bank is `0x4a5870` — `zombie.snd`, the one
 * {@link file://./zomb.ts} names — and `0x427170`, its bound test, is
 * byte-for-byte `0x456550`. **No cel id here means what the same number means
 * in `werea.ts`.**
 *
 * ## The shape of the machine, which is neither the punk's nor the zombie's
 *
 * `initwerea` decides out of a stance it returns to after everything.
 * `initskel` decides out of the **walk**, and it decides while the walk is
 * still playing: `0x4235ff`, the band dispatch, is on the branch `0x4235ac`
 * takes when `obj+0x46` is still **clear**. The script-finished branch is the
 * short one — `0x4235b3` only chooses between walking again and leaping, on
 * `atBound`. So this thing commits mid-stride and every one of its four
 * committed states hands straight back to the walk when it is done. There is no
 * stance, no taunt, no backing off, no side to be on and no crowding test: the
 * whole repertoire is walk, reach, grab, sling a bone, leap.
 *
 * The two things that pre-empt the band entirely are at `0x423598` and
 * `0x4235a1`, and both answer with a leap — more than a hundred pixels below
 * him, or him rising faster than ten a frame. Depth and altitude are the only
 * reasons this class ever leaves the ground.
 *
 * ## What this module owns, and what it does not
 *
 * Six of the nine — 0 through 5 — are the ones it is in while it is on its
 * feet, and those are here. Kinds 6, 7 and 8 are the hit reactions, driven by
 * the object's own frame handler `0x423a30` (hung on `obj+0x12` at `0x423408`)
 * and by the page's {@link Foe.flinch}/{@link Foe.pick}/{@link Foe.death} path;
 * a brain is never called during them. They are named at {@link NOT_HERE}.
 *
 * ## The preamble, which belongs to no state
 *
 * `0x4234ca`…`0x42352c` runs before the jump table and is not behaviour. With
 * the player inside the outermost band (`[esp+0x14] >= 1`), in front
 * (`[esp+0x1a] > 0`), this one neither a statue (state 0) nor dead (state 8),
 * and `|self.y - player.y|` under 200, it calls `0x40d1c0(AI+0,
 * 0x40e300(0xc8), 0x3392, self.point)`. `0x40d1c0` is an arbiter, not an
 * effect: it measures `|player.y - y| + |player.x - x|` and, only if that beats
 * both `[0x46bd28]` and 0x400, writes the three words into `[0x4a8a00]` and the
 * distance back into `[0x46bd28]`. So one claimant a frame wins, the nearest,
 * and it offers its own `AI+0` against a full `0x40e300(0xc8)` and the constant
 * `0x3392`. {@link file://./wered.ts} reads that triple as the on-screen enemy
 * bar's claim and {@link file://./zomb.ts} reads it as the chapter's ambient
 * groan; this module does not need to settle it, because either way the page
 * already has the bar as {@link Foe.panel} and the kit has no global arbiter.
 * It is named only so the next reader does not go hunting for a sound here.
 *
 * ## The AI struct, which is NOT the punk's
 *
 * `0x41ed70` mallocs `0x30` bytes and fills them:
 *
 * ```
 *   AI+0x00  0x41edc9  0x40e300(0xc8) — HEALTH, and the hit handler's subtrahend
 *   AI+0x02  0x41ede7  the record's rect, four words, from arguments 1 and 2
 *   AI+0x0a  0x41edec  1, and only state 8 ever writes it again (zero, 0x4239f9)
 *   AI+0x0c  0x41edfa  the tracker input 0x45ef70 fills, and 0x45efd0 reads
 *   AI+0x2e  0x423b37  seeded from [0x46b204] as the thing dies: corpse frames
 * ```
 *
 * The punk's `AI+0` is a nerve and its rect is at `AI+8`; here `AI+0` is plain
 * health — `0x423ad9` takes the blow's own power straight off it and
 * `0x423ae3` kills the thing when it reaches zero — and the rect is at `AI+2`,
 * which is what `0x423546` hands `0x434200`. There is no home point, no beat,
 * no decision counter and no side: this class uses four of the forty-eight
 * bytes it allocates. The page already carries the health as {@link Enemy.hp}
 * and the rect test as {@link Enemy.fighting}, so nothing below reaches for
 * either.
 *
 * Also at the creator: `obj+0x26 = 8` (`0x41edbe`), the shove weight the
 * overlap pass `0x430680` gates on, and at the class message proc's init
 * (`0x4233f7`) `obj+0x1a = 0x64`, `obj+0x34 = 1`, `obj+0x3c = 0xc8`, base cel
 * `0x4b0` = 1200, cel bank `0x4a6220`, and kind 0 installed as the first
 * script.
 */
import { install, type Brain } from "./kit";

/**
 * The hit reactions, kinds 6 to 8, and `0x423a30` — the frame handler that
 * installs them. Read, not done: the page owns those animations.
 *
 * - **`0x423a30`, the handler.** It answers 0 outright for a blow from classes
 *   `[0x46ecd0]` (its own thrown bone), `[0x46ecc4]` and `[0x46fdf8]` (another
 *   skeleton), so skeletons neither hurt each other nor catch their own bones.
 *   Then `0x42f910` gives it the blow's power, `0x423ad9` takes that off
 *   `AI+0`, and `zombie.snd` 0x16 plays on every blow that lands.
 * - **8, the death**, `0x46fd90`: cels 1350–1359 at three engine frames each,
 *   one tag. `0x423ae9` stops the object, releases the bar claim with
 *   `0x40d1c0(0, 0, 0, player.point)`, installs the script, scores
 *   `0x40d450(0x1c2)` — 450 — and seeds `AI+0x2e` from `[0x46b204]`, the same
 *   corpse count this page keeps as {@link Enemy.linger}. State 8 itself
 *   (`0x4239af`) clears `obj+0x26` so a corpse stops shoving, plays
 *   `zombie.snd` 0x15 on frame 2, counts `AI+0x2e` down and, on the frame it
 *   runs out, calls `0x40cba0(self.point, -0xd, 0)` and returns **1** — the
 *   only `mov ax, 1` in the whole of `0x4234b0`.
 * - **6, the knockdown**, `0x46fcf0`: `0x423b41` takes it whenever the blow's
 *   power is **0x3c or more**. Tag 0 is cels 1260–1265, and cel 1265 carries
 *   `dx 170, dy -420` — the frame it is thrown backwards off its feet. State 6
 *   (`0x4238fc`) waits for both `obj+0x46` AND `obj+0x2e`, back on the ground,
 *   before handing to tag 1, cels 1266–1268, getting up; that hands to the
 *   walk.
 * - **7, the flinch**, `0x46fd58`: three engine frames a cel. `0x423b61`
 *   compares the blow's own x against `obj+8` and reads `obj+0x28` to decide
 *   whether it came from behind. From the front it is tag 0, cel 1260. From
 *   **behind** it is tag 1 or 2 — `0x434540(2)`, cels 1212 and 1261 — and
 *   `0x423b9a` takes a further **0x14 off `AI+0`** on top of the blow. A
 *   skeleton hit in the back loses twenty more health than one hit in the face,
 *   and the port's flat health subtraction cannot express that.
 * - And the way out of a flinch is a **leap**: `0x423965` rolls
 *   `0x434540(5)` and, three times in five, installs kind 5 tag 0 rather than
 *   the walk. So a skeleton you tap springs away six times in ten.
 */
const NOT_HERE = "0x4238fc, 0x423965, 0x4239af, 0x423a30" as const;

/**
 * Its repertoire, by kind and tag, straight out of `0x46fab0`…`0x46fd90`.
 *
 * Every cel, hold, stride and lift below is the script's own header and frame
 * list. Only two things travel: the walk, 65 on all six cels, and the two leaps
 * of kind 5, which are the only scripts in the class carrying a `dy` at all.
 * Neither reach nor grab nor throw moves the skeleton a pixel.
 */
export const SKEL = {
  /** kind 0 — one cel, one engine frame, going nowhere: the statue */
  wait: { cels: [1200], hold: 1, kind: 0, tag: 0, from: "0x46fab0 tag 0" },
  /** kind 1 — the walk, the ONLY script with a stride, and the state that decides */
  walk: {
    cels: [1200, 1201, 1202, 1203, 1204, 1205],
    hold: 2,
    dx: [65, 65, 65, 65, 65, 65],
    kind: 1,
    tag: 0,
    from: "0x46fac0 tag 0",
  },
  /** kind 2 tag 0 — three cels: the short reach, taken from inside a hundred */
  stoop: {
    cels: [1320, 1321, 1322],
    hold: 2,
    kind: 2,
    tag: 0,
    from: "0x46fc88 tag 0",
  },
  /** kind 2 tag 1 — nine cels out and back: the long reach, from the middle band */
  reach: {
    cels: [1290, 1291, 1292, 1293, 1294, 1293, 1292, 1291, 1290],
    hold: 2,
    kind: 2,
    tag: 1,
    from: "0x46fc88 tag 1",
  },
  /** kind 3 tag 0 — the grab, held on 1243/1244 while the player is in it */
  grab: {
    cels: [1240, 1241, 1242, 1243, 1244, 1243, 1244],
    hold: 2,
    kind: 3,
    tag: 0,
    from: "0x46faf8 tag 0",
  },
  /** kind 3 tag 1 — the same seven beats for the other player character, 1340s */
  grabAlt: {
    cels: [1340, 1341, 1342, 1343, 1344, 1343, 1344],
    hold: 2,
    kind: 3,
    tag: 1,
    from: "0x46faf8 tag 1",
  },
  /** kind 4 tag 0 — winding the arm back, and the frame it ends is the throw */
  wind: {
    cels: [1220, 1221, 1222, 1223, 1224, 1224],
    hold: 2,
    kind: 4,
    tag: 0,
    from: "0x46fb70 tag 0",
  },
  /** kind 4 tag 1 — three cels of follow-through; the bone is already gone */
  sling: {
    cels: [1225, 1225, 1226],
    hold: 2,
    kind: 4,
    tag: 1,
    from: "0x46fb70 tag 1",
  },
  /**
   * kind 5 tag 0 — the standing leap: it rocks BACK 130 first, then goes.
   *
   * Twelve cels at one engine frame each, and the three 1273s are the whole of
   * the flight: `-130`, then `65` with `dy -650`, then `130` with `dy -100`.
   */
  leap: {
    cels: [
      1270, 1271, 1272, 1273, 1273, 1273, 1274, 1275, 1276, 1277, 1278, 1279,
    ],
    hold: 1,
    dx: [0, 0, 0, -130, 65, 130, 65, 0, 0, 0, 0, 0],
    dy: [0, 0, 0, 0, -650, -100, 0, 0, 0, 0, 0, 0],
    kind: 5,
    tag: 0,
    from: "0x46fbc0 tag 0",
  },
  /** kind 5 tag 1 — the running leap: no rock back, 65 a frame and `dy -600` */
  lunge: {
    cels: [
      1270, 1271, 1272, 1273, 1273, 1273, 1274, 1275, 1276, 1277, 1278, 1279,
    ],
    hold: 1,
    dx: [0, 0, 0, 65, 65, 65, 0, 0, 0, 0, 0, 0],
    dy: [0, 0, 0, -600, 0, 0, 0, 0, 0, 0, 0, 0],
    kind: 5,
    tag: 1,
    from: "0x46fbc0 tag 1",
  },
  /** `0x46fdf0` — the descending list `0x45efd0` reads the band out of, three deep */
  bands: [400, 140, 100],
  /**
   * `zombie.snd` — the bank is `0x4a5870`, the zombie chapter's, not the punk
   * chapter's `0x4a7910`.
   *
   * `call` `0x42364e` as the long reach goes out, `crunch` `0x4237bb` over and
   * over while the grab holds. The other two the class plays are hit
   * reactions and belong to {@link NOT_HERE}: 0x16 on every blow that lands
   * (`0x423ac6`) and 0x15 on the second frame of the corpse (`0x4239c2`).
   */
  call: 0x14,
  crunch: 0x17,
  from: "0x4234b0",
} as const;

/**
 * `0x423598` — more than this far BELOW him and it leaps instead of thinking.
 *
 * `movsx ecx, [esi+6]` less `movsx edx, [player+6]`, `cmp ecx, 0x64`, `jg`. The
 * same expression `0x44e76e` uses on the punk, and `obj+6` is the Y.
 */
const DEPTH = 100;

/** `0x4235a1` — and him rising faster than this, in the engine's own units */
const RISING = -10;

/** `0x4236e9` — the grab needs him within this much of its own row */
const GRAB_ROW = 50;

/**
 * `initskel`'s own machine, states 0 to 5.
 *
 * ## The stack frame, which is where the field numbers come from
 *
 * `0x4234b0` does `sub esp, 0x14` and then takes the buffer address **before**
 * it pushes anything: `lea eax, [esp+8]` at `0x4234b3` is `E-0xc`, where `E` is
 * the entry `esp`. Two registers and the two arguments then go on, `0x45efd0`
 * fills the buffer, and `add esp, 8` at `0x4234c7` leaves `esp` at `E-0x1c` for
 * the whole of the jump table. So through every state below:
 *
 * ```
 *   [esp+0x10]  E-0xc   out+0     side
 *   [esp+0x14]  E-8     out+4     BAND
 *   [esp+0x16]  E-6     out+6     his cel carries a strike box
 *   [esp+0x18]  E-4     out+8     player.y - self.y
 *   [esp+0x1a]  E-2     out+0xa   forward distance
 *   [esp+0x20]  E+4     argument 0, the object
 *   [esp+0x24]  E+8     argument 1, the AI struct
 * ```
 *
 * The last two lines are what pin it: `0x4234d8` reads `esi` from `[esp+0x20]`
 * and every `push esi; call 0x45d090` in the function is an object, while
 * `0x4234ba` reads `edi` from `[esp+0x28]` at a moment when `esp` is `E-0x20`,
 * which is `E+8`, and `0x4234be` immediately takes `edi+0xc` — the tracker
 * input the creator registered at `0x41edfa`. Four bytes low and `0x4235ff`'s
 * three-way on `[esp+0x14]` would be reading `out+0`, the side, which only ever
 * answers 0, 1 or 2 and would still have compiled into something plausible.
 *
 * The buffer is sixteen bytes and only twelve of them are inside the frame —
 * `E-0xc` through `E-1`. Nothing this class reads lives past `out+0xa`.
 *
 * ## And the return value
 *
 * Every path out of `0x4234b0` is `xor ax, ax` except `0x4239ec`, the frame the
 * corpse is removed, which is in state 8 and therefore not here. **So every
 * path below returns `false`**, the waiting ones included: a think function
 * never suppresses the animation, and returning `true` would freeze the thing
 * mid-leap with its stride unspent.
 */
export const skel: Brain = (e, foe, run, k) => {
  const done = e.clock >= run;
  const t = k.track(e, SKEL.bands);
  switch (e.script ?? 0) {
    /**
     * ---- 0, `0x423546`: the statue, and the one thing that ends it.
     *
     * `0x434200(player.point, AI+2)` — the player's own point inside the four
     * words the level record gave the creator — and nothing else. No
     * script-finished test, because kind 0 is a single cel; no facing, no
     * patrol. The page already keeps that rect test as {@link Enemy.fighting},
     * and it is the same rect.
     */
    case 0:
      return e.fighting ? install(e, SKEL.walk) : false;
    /**
     * ---- 1, `0x42357d`: the walk, and the whole of the skeleton's judgement.
     *
     * The order matters and it is not the punk's. Turn to face him; then the
     * two pre-emptions, which do NOT wait for the script; then, only if the
     * script is still running, the band. The script-finished case is the
     * narrow one at `0x4235b3` and it is a single question: am I at the end of
     * my rope.
     */
    case 1: {
      // `0x42357d` — `xor byte [esi+0x28], 1`: he is behind me, turn round
      if (t.forward < 0) e.facing = -e.facing;
      /**
       * `0x423598` and `0x4235a1` — depth and altitude, the only two reasons
       * this class ever leaves the ground, and neither waits for the walk to
       * finish. `0x42368d` then tosses for which leap: `0x434540(2) - 1`, so
       * the standing one that rocks back and the running one are even money.
       */
      if (e.y - k.player.y > DEPTH || k.player.vy < RISING) {
        return install(e, k.roll(2) - 1 === 0 ? SKEL.leap : SKEL.lunge, true);
      }
      /**
       * `0x4235ac` — and here is the branch the punk does not have. When the
       * walk ENDS the band is not consulted at all: `0x4235b3` re-checks the
       * facing, and `0x427170` — this chapter's `atBound`, byte-for-byte
       * `0x456550`, sixty pixels from `obj+0x38` facing west or `obj+0x3a`
       * facing east — decides between springing forward off the end of its
       * territory and simply walking again.
       */
      if (done) {
        if (t.forward < 0) e.facing = -e.facing;
        return k.atBound(e)
          ? install(e, SKEL.lunge, true)
          : install(e, SKEL.walk);
      }
      /**
       * `0x4235ff` — the band, read mid-stride, and only three of the four
       * cases do anything. Band 0 (beyond four hundred) and band −1 (behind
       * it) fall out at `0x423613` and the walk carries on.
       */
      switch (t.band) {
        /**
         * 140..400, `0x42361c` — the bone, and it is rare: `0x434540(0xe)`
         * has to come up 1 or 2, so two frames in fourteen of the ones spent
         * at this distance. Everything else returns without installing.
         */
        case 1:
          return k.roll(0xe) < 3 ? install(e, SKEL.wind, true) : false;
        /**
         * 100..140, `0x423648` — `zombie.snd` 0x14 and the LONG reach. Which
         * is a bluff at this distance: kind 2 will want band 3 by the time it
         * ends, and the reach does not travel, so it only lands if he walks in.
         */
        case 2:
          k.say(e, SKEL.call);
          return install(e, SKEL.reach, true);
        // inside 100, `0x423674` — the short reach, and no cry with it
        case 3:
          return install(e, SKEL.stoop, true);
        default:
          return false;
      }
    }
    /**
     * ---- 2, `0x4236b1`: the reach, and the four things the grab needs.
     *
     * `0x4236b1` opens by setting `obj+0x1a` to 0x64 — the strength percent
     * this thing would land a blow at. **Nothing hits the player back in this
     * port**, so it is carried as read and spends nothing.
     *
     * Then, on the frame the reach ends, all four of these or it just walks
     * away: the band is 3, inside a hundred (`0x4236c2`); `[0x46b1b4]` is set
     * (`0x4236ca`); `|self.y - player.y|` is under fifty (`0x4236e9`); and
     * `0x402f60` says he is upright (`0x4236ee`). `[0x46b1b4]` is the
     * chapter-wide "nobody is holding him" latch — thirty-seven sites across
     * the executable touch it, and `0x4236f8` takes it as it grabs while
     * `0x4237f8` puts it back as it lets go. This port has no grab to hold him
     * with and therefore no way for the latch to be down, so it is read as
     * always set; that is the disc's own resting value.
     *
     * The tag is `[0x46b1a8]` (`0x423701`), the index of which of the two
     * player characters is being played — the same global `0x402f60` and
     * `0x402fa0` dispatch on. Cels 1240s hold one of them and 1340s the other.
     * The page has one player, so {@link SKEL.grab} is the one taken and
     * {@link SKEL.grabAlt} is named for the reader.
     */
    case 2: {
      if (!done) return false;
      const near = Math.abs(e.y - k.player.y) < GRAB_ROW;
      if (t.band >= 3 && near && !k.player.down) {
        return install(e, SKEL.grab, true);
      }
      return install(e, SKEL.walk);
    }
    /**
     * ---- 3, `0x423756`: the grab, and almost none of it can be ported.
     *
     * Every frame it holds him, `0x423756` does four things to the PLAYER:
     * turns his `obj+0x28` to the opposite of its own so he faces it, plants
     * him at `obj+8 ± 0x33` — fifty-one pixels in front — and `obj+6 - 0x26`,
     * thirty-eight up, and calls `0x402ac0(5)`, which takes five off
     * `[0x4ac3d0]`. Then `0x42379d` reads the frame index `obj+0x42` and plays
     * `zombie.snd` 0x17 on every frame whose index is not a multiple of four —
     * the bones grinding, three beats in four.
     *
     * And on the frame the script ends, `0x4237c8` throws him: `obj+8 ± 0x64`,
     * a hundred pixels the way the skeleton faces, `obj+6 - 0x1e`, thirty up,
     * `[0x46b1b4]` handed back, and `0x402fa0(2)` — which dispatches on the
     * character index and puts him into his own thrown state. Only then kind 1.
     *
     * **Nothing hits the player back in this port** and the kit hands a brain
     * no way to move him, so all five of those are read and not done. What
     * survives is the transition, which is the state machine: hold the grab
     * until it ends, then walk.
     */
    case 3:
      return done ? install(e, SKEL.walk) : false;
    /**
     * ---- 4, `0x423822`: the throw, and the bone is a separate object.
     *
     * Tag 0 is the wind-up and `0x42383c` is the release: on the frame it ends
     * it installs tag 1 and then calls `0x421310(point, velocity, 0)`.
     * `0x421310` mallocs an object of class `[0x46ecd0]`, seeds `AI+0` with
     * `0x4cb` — cel **1227** — and installs `0x46f978` tag 0, which is cels
     * 1227 to 1230 at one engine frame each: the bone tumbling. It is born at
     * `obj+8 ± 0x46` (seventy pixels in front, `0x42385b`) and `obj+6 - 0x28`
     * (forty up, `0x423872`), with `obj+0xa = -0x1a` and `obj+0xc = ±0x23` —
     * `vy -26`, `vx ±35`. `0x423a3e` is the other half of it: a skeleton
     * ignores any blow that came from class `[0x46ecd0]`, so the bones cannot
     * hurt the thing that threw them.
     *
     * The kit has no way to spawn an object and **nothing hits the player back
     * in this port**, so the bone is read and not made. Tag 1 plays out the
     * follow-through and `0x4238b4` hands to the walk.
     */
    case 4: {
      const tag = e.tag ?? 0;
      if (!done) return false;
      // `0x423847` — the wind-up always ends in the follow-through
      if (tag === 0) return install(e, SKEL.sling, true);
      // `0x4238bf` — and the follow-through always ends in the walk
      if (tag === 1) return install(e, SKEL.walk);
      // `0x423833` — any other tag falls straight out
      return false;
    }
    /**
     * ---- 5, `0x4238d8`: both leaps land the same way.
     *
     * The one state in the class with no sub-dispatch and no test but
     * `obj+0x46` — no `obj+0x2e`, no ground check, because the lift is the
     * script's own `dy` and not a ballistic the solver has to bring back down.
     * Twelve cels, and cels 1275 to 1279 are the recovery built into it.
     */
    case 5:
      return done ? install(e, SKEL.walk) : false;
    default:
      return false;
  }
};

export { NOT_HERE as SKEL_NOT_HERE };
