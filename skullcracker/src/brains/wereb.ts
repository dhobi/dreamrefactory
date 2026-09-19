/**
 * The chained punk — `initwereb`, `0x44f3d0`, `LINK` on the panel.
 *
 * ## Its eight scripts, and therefore its eight states
 *
 * `0x45d090` writes a script's own kind into `obj+0x18`, so this table IS the
 * machine's alphabet. The jump table is `0x44f86c`, eight entries, and every
 * script below was read out of the class's own data region, `0x477610` up to
 * `0x477848`:
 *
 * ```
 *   0  0x477610  the patrol — ONE cel, no stride: it stands and waits
 *   1  0x477620  the stance — also one cel, and the state that DECIDES
 *   2  0x477630  the four walks: in, lunge, back off, shuffle
 *   3  0x477768  the three attacks: two big ones and the windup that picks
 *   4  0x477700  the special take, reached only by a blow of strength -9
 *   5  0x4776c8  what it walks while the player is down
 *   6  0x477820  the four flinches, one cel each
 *   7  0x477848  the death, and then the corpse
 * ```
 *
 * ## What this module owns, and what it does not
 *
 * States 0, 1, 2, 3 and 5 are the ones a LINK is in while it is on its feet,
 * and those are here. States 4, 6 and 7 are the hit reactions; the page already
 * drives those through {@link Foe.flinch}, {@link Foe.pick} and
 * {@link Foe.death}, and a brain is never called while an enemy is flinching or
 * dying. They are named at {@link NOT_HERE} so the next reader can see what is
 * deliberately elsewhere.
 *
 * ## How this class differs from the street punk, which is worth knowing first
 *
 * `initwerea` walks its patch, wants a side of you, crowds, taunts and leaps.
 * The LINK does none of that. Its AI struct (`0x450b40`, 0x36 bytes) is laid out
 * differently: **`AI+4` is a pointer to the player object**, not a decision
 * budget, and `AI+6` — the punk's wanted side — is never written and never read.
 * So there is no `e.side`, no `e.decisions` and no `k.crowded` in this file; the
 * only two AI words it spends are `AI+0` and `AI+2`.
 *
 * And `AI+0` here is not a separate nerve at all: `0x44f934`, in the hit
 * handler, does `sub word ptr [eax], di` against it with the blow's own strength,
 * and `0x44f95b` reads it back to choose between a flinch and the death. **`AI+0`
 * IS the health**, seeded `0x40e300(0xc8)` at `0x450ba0` — the 200 the panel
 * shows. The port's `e.hp` is that same word, so this file never touches
 * {@link Enemy.nerve}: two ports of one field would drift apart.
 *
 * ## The panel, which the prologue and not a state drives
 *
 * `0x44f3ea` runs before the jump table, every frame, and it is the only thing
 * the prologue does: when the band is 1 or nearer (`cmp word ptr [esp+0xc], 1`)
 * **and** the player is in front (`[esp+0x12]` > 0) **and** the state is neither
 * 0 nor 7, it calls `0x40d1c0(AI+0, 0x40e300(0xc8), 0x32ca, self.point)`.
 * `0x40d1c0` keeps the nearest claimant of the frame (`[0x46bd28]`) and writes
 * `[0x4a8a00]`, `[0x4a8a02]` and `[0x4a8a04]` — current, maximum, and the name
 * id. `0x32ca` is this class's, one past the street punk's `0x32c9` at
 * `0x44e5c2`. That is the enemy health bar, the page owns it ({@link Foe.panel}),
 * and it moves nothing — so it is read here and not done.
 */
import { install, type Brain, type BrainCtx, type Enemy } from "./kit";

/**
 * The hit-reaction states — 4, 6 and 7 — and what the class's own handler
 * (`0x44f8b0`) does with them. Read, not done: the page owns those animations.
 *
 * - **`0x44f8b5`, the strength gate.** The handler opens on `[attacker+0x1a]`,
 *   the striking object's strength percent. `-9` (`0xfff7`) is a code, not a
 *   number: it calls `0x44ff20(self, 0, 0)` — which allocates from class
 *   `[0x4789d0]` at a random point inside this one's own box — and installs
 *   `0x477700`, kind 4. And `0x44f8ee` then drops **every other negative
 *   strength on the floor**: `jge` to the damage path, `xor ax, ax` otherwise.
 *   A LINK cannot be hurt by a negative-strength blow that is not exactly -9.
 * - **4**, `0x44f735`, the state that -9 puts it in: it takes **ten off `AI+0`
 *   every frame** the script plays (`sub word ptr [edi], 0xa`) and growls
 *   `0x23` every frame with it. When the script ends it goes back to the stance
 *   if anything is left, and if not it sets `AI+2` to 200 corpse frames and
 *   installs the death. The script itself is twelve frames of the walk cels at
 *   one tick each — twice the walk's rate — so the thing scuttles while it is
 *   being drained. Pure health subtraction cannot express that.
 * - **6**, `0x477820`, the flinches: FOUR of them, one cel each (5080..5083) at
 *   four ticks, and `0x44f9d3` picks with `0x434540(4) - 1` — a flat roll, not
 *   the punk's facing test and not a dent count. `0x44f7e2`, the state, returns
 *   to the stance when the cel is done.
 * - **7**, `0x477848`, the death: twelve frames, 5060..5063 then 5070..5077, at
 *   three ticks. `0x44f967` plays sound `0x1b` through `0x40f090`, blanks the
 *   panel with `0x40d1c0(0, ...)`, and `0x44f9ad` calls `0x40d450(0xf0)`.
 *   `0x44f802`, the corpse state, counts `AI+2` down from `[0x46b204]`, holds
 *   `obj+0x10` at -27, and on the frame it expires is the one and only place in
 *   this whole function that answers **1** instead of 0.
 * - **the growl**, `0x44f942`: `0x434540(4) + 0x23`, so 0x23..0x26 — four of
 *   them — every time a blow lands.
 */
const NOT_HERE = "0x44f8b0, 0x44f735, 0x44f7e2, 0x44f802" as const;

/**
 * Its repertoire, by kind and tag, straight out of `0x477610`…`0x477848`.
 *
 * Every cel, hold and stride below is the script's own, dumped with
 * `scdis anims <addr>:full`. The class's cel base is `0x1388` = 5000
 * (`0x44f340`) and its bank is `0x4a8400` (`0x44f326`).
 */
export const WEREB = {
  /**
   * kind 0 — the patrol, and it is ONE cel with no stride.
   *
   * The LINK does not pace its patch. `0x477610` holds a single frame of cel
   * 5000 and `0x44f44a`, the state, installs no walk of any kind: it turns to
   * face the player and waits for his point to land in its rect. This is where
   * `0x44f364` — the creator's own install, at the bottom of the class message
   * proc — leaves a freshly placed one.
   */
  patrol: { cels: [5000], hold: 1, kind: 0, tag: 0, from: "0x477610 tag 0" },
  /** kind 1 — the stance, the same lone cel, and the state that decides */
  stance: { cels: [5000], hold: 1, kind: 1, tag: 0, from: "0x477620 tag 0" },
  /** kind 2 tag 0 — the ordinary walk in, six cels of 75 */
  walkIn: {
    cels: [5000, 5001, 5002, 5003, 5004, 5005],
    hold: 2,
    dx: [75, 75, 75, 75, 75, 75],
    kind: 2,
    tag: 0,
    from: "0x477630 tag 0",
  },
  /** kind 2 tag 1 — three cels of a much longer stride: the closing lunge */
  lunge: {
    cels: [5000, 5002, 5004],
    hold: 2,
    dx: [300, 225, 300],
    kind: 2,
    tag: 1,
    from: "0x477630 tag 1",
  },
  /** kind 2 tag 2 — the walk run backwards, six cels of alternating -150/-75 */
  away: {
    cels: [5005, 5004, 5003, 5002, 5001, 5000],
    hold: 2,
    dx: [-150, -75, -150, -75, -150, -75],
    kind: 2,
    tag: 2,
    from: "0x477630 tag 2",
  },
  /** kind 2 tag 3 — three cels of 75: the short shuffle the beat spends */
  shuffle: {
    cels: [5000, 5001, 5002],
    hold: 2,
    dx: [75, 75, 75],
    kind: 2,
    tag: 3,
    from: "0x477630 tag 3",
  },
  /**
   * kind 3 tag 0 — the first big attack, and the two 5000s are the recovery.
   *
   * One tick a cel, where the walks hold two, so the whole thing is over in
   * eight engine frames. It travels nowhere: every dx and dy in `0x477768` is
   * zero, which is what a chain is for.
   */
  swingA: {
    cels: [5020, 5021, 5022, 5023, 5024, 5025, 5000, 5000],
    hold: 1,
    kind: 3,
    tag: 0,
    from: "0x477768 tag 0",
  },
  /** kind 3 tag 1 — the second, a different six cels and the same recovery */
  swingB: {
    cels: [5040, 5041, 5042, 5043, 5044, 5045, 5000, 5000],
    hold: 1,
    kind: 3,
    tag: 1,
    from: "0x477768 tag 1",
  },
  /**
   * kind 3 tag 2 — three cels of windup, and the only thing it does is choose.
   *
   * `0x44f6c7` is where it is spent: when these three are done it rolls
   * `0x434540(7)` and installs tag 0 or tag 1. So the inner band never throws an
   * attack directly — it throws this, and this throws the attack.
   */
  ready: {
    cels: [5010, 5011, 5012],
    hold: 1,
    kind: 3,
    tag: 2,
    from: "0x477768 tag 2",
  },
  /**
   * kind 5 — what it walks while the player is down. Six cels of 75, the walk's
   * own, but a script of its own kind so the machine can tell them apart.
   */
  mill: {
    cels: [5000, 5001, 5002, 5003, 5004, 5005],
    hold: 2,
    dx: [75, 75, 75, 75, 75, 75],
    kind: 5,
    tag: 0,
    from: "0x4776c8 tag 0",
  },
  /**
   * `0x4778b0` — the descending list `0x45efd0` reads the band out of, handed to
   * the tracker as `0x45ef70`'s fourth argument at `0x450bb6`.
   *
   * Four thresholds, so five bands, and they are nothing like the punk's
   * `330/200/150/80`: they are bunched between 160 and 350 because this class
   * fights at ARM'S LENGTH plus a chain. Band 3 — 160 to 200 — is the only one
   * that attacks, and band 4, anything nearer than 160, backs away from you.
   */
  bands: [350, 250, 200, 160],
  /** `0x44f6e5`/`0x44f70d` — `woods.snd` 0x19 with the first swing, 0x1a with the second */
  shoutA: 0x19,
  shoutB: 0x1a,
  from: "0x44f3d0",
} as const;

/**
 * `0x456590` — within sixty of the bound BEHIND it, which is a different
 * question from `k.atBound`.
 *
 * The two are byte-for-byte the same function but for one branch: `0x456554`
 * picks `obj+0x38` when the mirror flag is set and `0x456594` picks it when the
 * flag is CLEAR. So `0x456550` is the bound this one faces — the kit's
 * `atBound` — and `0x456590` is the one at its back. This class asks both, and
 * asks the second one in the two places it is about to walk backwards, so the
 * distinction is load-bearing rather than cosmetic. Sixty is `0x4565b7`'s own
 * `cmp eax, 0x3c`.
 */
function atRear(e: Enemy): boolean {
  return Math.abs(e.x - (e.facing > 0 ? e.left : e.right)) <= 60;
}

/**
 * `initwereb`'s own machine, states 0, 1, 2, 3 and 5.
 *
 * ## The stack frame, which is where the field numbers come from
 *
 * `0x44f3d0` does `sub esp, 0x10` and then pushes **two** registers — `esi` and
 * `edi`, where `0x44e587` pushes three — so after `0x44f3e7`'s `add esp, 8` the
 * sixteen bytes `0x45efd0` filled sit at **`esp+8`**, not `esp+0xc`:
 * `esp+0xc` is `out+4`, the BAND, and `esp+0x12` is `out+0xa`, the forward
 * distance. `0x44f4e9`'s `movsx eax, word ptr [esp+0xc]` is therefore the band
 * jump — five entries at `0x44f88c` — and not a side test, which is exactly what
 * it looks like if the frame is counted with the punk's three pushes.
 *
 * The same count settles the arguments: `0x44f3da` reads the AI struct from
 * `[esp+0x24]`, the SECOND argument, and `0x44f3f8` reads the object from
 * `[esp+0x1c]`, the first.
 *
 * ## A think function never suppresses the animation
 *
 * Every path in `0x44f3d0` ends `xor ax, ax` — `0x44f863`, the shared "my script
 * has not finished" return that most states take most frames, included. The one
 * exception is `0x44f850`, the corpse, which answers 1 on the frame the object
 * is removed and is not in this file. So every branch below returns `false`,
 * waiting branches as well, because waiting is precisely when the script now
 * playing needs to keep playing.
 *
 * ## `obj+0x26`, which is set here and has nowhere to live
 *
 * `0x44f48b` opens the stance by writing **8** into `obj+0x26`, the shove weight
 * the class message proc already seeded at `0x44f32d`, and the innermost band —
 * `0x44f5db` and `0x44f5fa` — writes **0** into it as it commits to the step
 * that ends the stand-off, so a LINK that has decided to close stops pushing
 * you. The port has no field for it ({@link Enemy} carries no shove weight), so
 * it is carried as read on both sites and spends nothing.
 */
export const wereb: Brain = (e, foe, run, k) => {
  const done = e.clock >= run;
  const t = k.track(e, WEREB.bands);
  // `0x450bc7` — the creator seeds `AI+2` at zero, so the first beat is spent
  // on the frame after the one that first reaches the band that counts it
  e.beat ??= 0;
  switch (e.script ?? 0) {
    /**
     * ---- 0, `0x44f44a`: the patrol, which is a stand and a stare.
     *
     * Two instructions and a boundary test. It turns to face the player if he
     * has got behind it, and `0x434200(player.point, AI+8)` — his own point
     * inside the four words the level record handed the creator — is the only
     * thing that moves it on. Anything else and it falls through `0x44f46c` to
     * the shared zero return with its one cel still playing.
     */
    case 0:
      // `0x44f450`
      if (t.forward < 0) e.facing = -e.facing;
      // `0x44f461`, and the page keeps the rect test as `e.fighting`
      return e.fighting ? install(e, WEREB.stance) : false;
    // ---- 1, `0x44f48b`: the stance, and the only state that thinks every frame
    case 1:
      return decide(e, k, t);
    /**
     * ---- 2, `0x44f606`: the walks, and each one ends when it RUNS OUT of room.
     *
     * `0x44f613` sub-dispatches on `obj+0x44` through a four-entry table at
     * `0x44f8a0` whose three forward tags — 0, 1 and 3 — all land on `0x44f61a`
     * and whose backward one, tag 2, lands on `0x44f64c`. The two bodies are the
     * same shape and differ only in which bound they ask about: the forward
     * walks stop at the bound they face, the back-off stops at the one behind
     * it. Either way the answer is the stance.
     */
    case 2: {
      // `0x44f60a` — `cmp eax, 3; ja` drops a tag past the table's four entries
      if ((e.tag ?? 0) > 3) return false;
      const wall = (e.tag ?? 0) === 2 ? atRear(e) : k.atBound(e);
      // `0x44f61f`/`0x44f651` — script finished OR out of room, whichever first
      if (!done && !wall) return false;
      return install(e, WEREB.stance);
    }
    /**
     * ---- 3, `0x44f67e`: the attacks, and the windup is the one that chooses.
     *
     * `0x44f682` re-asserts `obj+0x1a = 0x64` before it looks at anything — a
     * hundred percent strength, the same value the class message proc set at
     * `0x44f346`. **Nothing hits the player back in this port**, so that is read
     * and not spent; it matters only in the other direction, where `0x44f8b5`
     * reads the ATTACKER's copy of the same field looking for -9.
     *
     * Then three ways out, by tag. Tags 0 and 1 — the two big swings — go back
     * to the stance when they end. Tag 2, the windup, rolls `0x434540(7)` and
     * spends it: `0x44f6dc`'s `cmp eax, 3; jg` sends 1..3 to the first swing
     * with shout `0x19` and 4..7 to the second with shout `0x1a`, so the second
     * one comes up four times in seven. And a tag below zero or above two falls
     * out at `0x44f68a` or `0x44f69a` having done nothing at all.
     */
    case 3: {
      const tag = e.tag ?? 0;
      // `0x44f688` — `test eax, eax; jl` drops a negative tag before anything
      if (tag < 0) return false;
      // `0x44f6a8`/`0x44f6cc` — neither branch moves until its script is done
      if (!done) return false;
      if (tag <= 1) return install(e, WEREB.stance);
      if (tag !== 2) return false;
      if (k.roll(7) <= 3) {
        k.say(e, WEREB.shoutA);
        return install(e, WEREB.swingA, true);
      }
      k.say(e, WEREB.shoutB);
      return install(e, WEREB.swingB, true);
    }
    /**
     * ---- 5, `0x44f795`: what it does while the player is down, and how it ends.
     *
     * `0x402f60` is the test — the player's own state word under `0x1a` — and
     * while it answers no the LINK just reinstalls the walk and keeps going. The
     * frame he is upright again `0x44f7c3` writes `AI+0x10` back over `obj+6` as
     * a DWORD, which is both the Y and the X: the thing is teleported to the
     * point the level record placed it on and put back on the patrol. The port
     * keeps only the X in {@link Enemy.home}, so only the X is restored.
     */
    case 5:
      if (!done) return false;
      if (k.player.down) return install(e, WEREB.mill);
      e.x = e.home ?? e.x;
      e.fighting = false;
      return install(e, WEREB.patrol);
    default:
      return false;
  }
};

/**
 * State 1, `0x44f48b` — the whole of the fight, decided fresh every frame.
 *
 * Face him, answer the two things that override the band — he is down, or he is
 * on the way up — and then act on the band. There is no side to want here and
 * nothing is asked about crowding: `AI+6` is never written by `0x450b40` and
 * never read by `0x44f3d0`.
 */
function decide(
  e: Enemy,
  k: BrainCtx,
  t: ReturnType<BrainCtx["track"]>,
): boolean {
  // `0x44f48b` — obj+0x26 = 8, the shove weight, re-asserted every frame
  // `0x44f497`
  if (t.forward < 0) e.facing = -e.facing;
  /**
   * `0x44f4a5` — and with him down it turns AWAY and walks off.
   *
   * Two flips, not one: `0x44f499` has already turned it to face him and
   * `0x44f4a7` turns it straight back, so whichever side he fell on the LINK
   * ends up pointing away from him and the mill's `+75` carries it off. The
   * street punk does the opposite at `0x44e6f7` and stands over you.
   */
  if (k.player.down) {
    e.facing = -e.facing;
    return install(e, WEREB.mill);
  }
  /**
   * `0x44f4c9` — he is leaving the ground, so the first swing goes out now.
   *
   * `[0x4ac3d4]` is the player and `+0xa` is his vertical speed; the test is a
   * bare `jge`, against zero and not against the punk's `-5` at `0x44e77f`. Any
   * upward motion at all gets swing A, band ignored.
   */
  if (k.player.vy < 0) return install(e, WEREB.swingA, true);
  /**
   * `0x44f4f7` — and otherwise the band, five ways, through `0x44f88c`.
   *
   * Band -1 is the player behind it, and `cmp eax, 4; ja` throws that at the
   * shared zero return: the facing has already been flipped above, so the frame
   * it turns is a frame it does nothing else.
   */
  switch (t.band) {
    /**
     * Beyond 350 — the lunge, three cels of 300/225/300. `0x44f4fe` asks
     * `0x456550` first and takes the step only if there is room in front of it;
     * with none it stands in the stance rather than walk into its own bound.
     */
    case 0:
      return k.atBound(e) ? false : install(e, WEREB.lunge);
    // 250..350 — `0x44f529`, the same gate and the ordinary six-cel walk
    case 1:
      return k.atBound(e) ? false : install(e, WEREB.walkIn);
    /**
     * 200..250 — `0x44f554`, and this is the band with a clock on it.
     *
     * `AI+2` comes down by one a frame and nothing happens until it goes
     * negative; then it is reseeded `0x434540(0x32)` — one to fifty, where the
     * punk's is one to eight — and the thing takes three cels of shuffle
     * forward. So a LINK held at this distance edges in, then waits out as much
     * as fifty frames before edging again.
     */
    case 2: {
      const beat = e.beat ?? 0;
      e.beat = beat - 1;
      if (beat >= 0) return false;
      e.beat = k.roll(0x32);
      return k.atBound(e) ? false : install(e, WEREB.shuffle);
    }
    // 160..200 — `0x44f5a1`, its ONE attacking band, and it throws the windup
    case 3:
      return install(e, WEREB.ready, true);
    /**
     * Inside 160 — `0x44f5ba`, and it does not attack: it gets away from you.
     *
     * This is the whole character of the class. Nearer than its innermost
     * threshold the LINK backs off six cels, and the only thing that stops it is
     * having nowhere to back into — `0x456590`, the bound at its BACK, at which
     * point it lunges past you instead. Both arms then zero `obj+0x26`
     * (`0x44f5db`, `0x44f5fa`), which the port carries as read.
     */
    default:
      return atRear(e) ? install(e, WEREB.lunge) : install(e, WEREB.away);
  }
}

export { NOT_HERE as WEREB_NOT_HERE };
