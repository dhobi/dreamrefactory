/**
 * What the things a level spawns are made of, read out of `SC.EXE`.
 *
 * ## How a creature is put together
 *
 * Four separate objects in the executable describe one enemy, and all four have
 * to be found before any of its numbers mean anything:
 *
 * - a **name** (`initwerea`), registered once per chapter by `0x40b850`, which
 *   also collects every record in the book that carries that name;
 * - a **creator** called once per record, which allocates the instance struct,
 *   stores the starting health and enrols the thing in the level census;
 * - a **class descriptor**, installed by `0x430cc0`, whose message 1 fills in the
 *   object's speed divisor `+0xe`, its type id `+0`, and — the field that matters
 *   here — the **hit handler** at `+0x12`;
 * - the **hit handler** itself, which is where the flinch, the death, the award
 *   and the sound all live.
 *
 * ## What a hit handler does
 *
 * Every one of them has the same shape, and `0x44f0a0` (this chapter's punk) is
 * the clearest:
 *
 * ```
 *   if (obj+0x1a < 0) return                  already dying — a corpse is not hittable
 *   dmg = 0x42f910(hitter)                    the blow's strength, scaled by its own +0x1a
 *   0x40cba0(victim, dmg, hitter)             the spray — see effects.ts
 *   health -= dmg
 *   if (health <= 0) {
 *      0x45d090(obj, DEATH_SCRIPT, 0)         the death animation
 *      instance+2 = [0x46b204]                the corpse's countdown: 50 frames
 *      0x40d450(award)                        the score
 *   } else {
 *      0x45d090(obj, FLINCH_SCRIPT, tag)      one of several, chosen below
 *   }
 * ```
 *
 * So a hit is: spray, subtract, and then either flinch or fall. The flinch TAG is
 * the interesting part, because each class chooses it differently and the choice
 * is readable:
 *
 * | class          | how the tag is picked                                          |
 * |----------------|----------------------------------------------------------------|
 * | `initwerea`    | a blow over 50 knocks it down outright; otherwise by where it   |
 * |                | was hit — `|Δy| > 50` high, `>= 30` and facing away, else low   |
 * | `initwereb`    | `0x434540(4)` — a random one of four                            |
 * | `initmailbox`  | under 55 dents it, 55 or over crumples it                      |
 * | `inithydrant`  | by the stage it is ALREADY in: 0→1, 1→2, 2→3, then nothing      |
 *
 * And two of them do not follow the shape above at all. The rat's `0x44e3f0` has
 * no health test and no branch: one blow of any size installs the launch and that
 * is the whole handler ({@link Foe.frail}). The hydrant's `0x44fbd0` never
 * subtracts either — it has three stages and a burst ({@link Foe.progressive},
 * {@link Foe.burst}).
 *
 * ## Which chapter's class is which
 *
 * The trap this table was built to avoid: **the same cel numbers mean different
 * creatures in different chapters.** Each of the four chapters registers its own
 * classes, its four books each put a walking figure at cel 1900, and a class
 * function from the wrong chapter will therefore look plausible and be wrong. An
 * earlier version of this port read `initwerea` off `0x439240` — health 25, plate
 * `13101` NALLY, award 250 — and that function belongs to the chapter of gang
 * members (`initbatboy`, `initknifeboy`, `initmaskboy`); `initwerea` is registered
 * exactly once in the whole executable, at `0x4504d1`, and its creator is
 * `0x450a50`: health **250**, plate **13001**, award **220**. The same mistake had
 * given the rat 400 health and a 440 award off `0x417ed0`.
 *
 * The check that settles it is the registration site, not the cels: whichever
 * function calls `0x40b850` with the name owns the class, and the creator it
 * loops with owns the numbers.
 *
 * ## The census
 *
 * Whether a creature counts towards a level's kill quota is one call:
 * `0x42f870(obj, 1)` sets `obj+0x1c` and increments the live count at
 * `0x4a6e88`, which is what `0x42f540` returns and what `0x450060` takes its
 * share of. Of this chapter's classes exactly four make that call — `initwerea`,
 * `initwereb`, `initwerec`, `initwered` — and the rat, the crow, the mailbox and
 * the hydrant do not. That also replaces this port's earlier rule of thumb
 * ("whatever claims the health bar"), which was right about the punks and wrong
 * about the rat.
 *
 * Not counting is not the same as not dying, and reading it that way was this
 * file's second mistake: the rat was briefly unkillable here because a search for
 * its hit handler used the wrong register and came back empty. The handler is at
 * `0x44e3f0` and the class descriptor names it at `obj+0x12` like every other —
 * the way to enumerate them is `scdis.mts callers 0x430cc0`, which finds all eight
 * of this chapter's descriptors, not a grep.
 */

import { FOE_SFX } from "./sound";

/** one animation, as its script in `.data` carries it */
export interface FoeAnim {
  cels: readonly number[];
  /** engine frames each cel is held — the script header's `ticksPerFrame` */
  hold: number;
  /**
   * The per-cel stride, in the engine's pre-divisor units. One entry per cel, or
   * absent for an animation that does not travel.
   */
  dx?: readonly number[];
  /**
   * The per-cel LIFT, same units as {@link dx} and the same one entry per cel.
   *
   * Only the attacks carry one — the punk's flying kick is `0x477368 tag 0`,
   * `dy -480` on the frame it leaves the ground — so it is absent everywhere the
   * old reading looked, which is why this page had no field for it. See
   * {@link file://./fights.ts}.
   */
  dy?: readonly number[];
  /**
   * When this one ends the thing holds its last cel for good and takes no more
   * hits.
   *
   * The mailbox's hard topple is the case. `0x44fe10` — its frame function —
   * watches for the animation to finish and then sets `obj+0x18 = 2`, a state with
   * no script of its own, and its hit handler opens with `if (obj+0x18 != 2)`. So
   * cel 2413, the mailbox on its side, is where it stays. Its LIGHT dent is the
   * opposite: `0x44fe3d` reinstalls the intact cel when that one ends, so a punch
   * marks it and it springs back.
   */
  terminal?: boolean;
  /**
   * What follows this one when it ends, where a state is two scripts rather than
   * one. The boss of level four is why: its knockdown (`0x478518`, two frames a
   * cel) and the get-up that follows it (`0x478578`, three) are separate scripts
   * with separate rates, and flattening them into one list would play the get-up
   * a third too fast.
   */
  then?: FoeAnim;
  /**
   * The script's own KIND — word 4 of its header, what `0x45d090` copies into
   * `obj+0x18`.
   *
   * This is the STATE a class's think function dispatches on, so a class whose
   * machine has been read needs it on every script it installs. `scdis anims
   * <addr>:full` prints it. Absent on the scripts nobody's machine installs by
   * name. See {@link file://./brains/kit.ts}.
   */
  kind?: number;
  /** which tag of that script this one is — `obj+0x44`, sub-dispatched on */
  tag?: number;
  /** the script and tag it was read from */
  from: string;
}

/** what the class's hit handler knows when it picks a flinch */
export interface Blow {
  /** the blow's strength, in the victim's own health units */
  damage: number;
  /** how many blows this thing has taken, this one included — some classes count */
  hits: number;
  /** how far up the victim the blow landed */
  dy: number;
  /**
   * Is the victim facing the same way as whoever hit it — its back to them.
   *
   * The handlers test it as `cmp [blow+0x28], [self+0x28]`, two mirror flags, and
   * jump to the PLAIN flinch when they are equal (`0x44f257` for the punk,
   * `0x452ac0` for the thrower). So the turned-away one is the ordinary take and
   * the special one is a blow to the face; this page had the branch the wrong way
   * round and gave the face take to a back.
   */
  facingAway: boolean;
}

/**
 * The two words of a creature's own state that {@link Foe.pick} may touch.
 *
 * Structural on purpose: `foes.ts` describes classes and must not depend on
 * the runtime `Enemy` the level runner keeps them in.
 */
export interface FoeState {
  /** `AI+6` on the bishop — the size of the last blow that moved it */
  nerve?: number;
  /** its scaled health, which is what that word is seeded from */
  max: number;
}

export interface Foe {
  /** how it moves about its own rect */
  gait: FoeAnim;
  /**
   * Its `obj+0xe` — the divisor the mover divides a script's `dx` by, and the
   * MASS the collision solver weighs it with.
   *
   * Both, and it is the same field. `0x42f8b0` divides an animation frame's stride
   * by it, so a bigger number is a slower thing; and `0x430470` — which the
   * collision dispatcher calls after a hit handler returns — puts it through the
   * textbook elastic collision, per axis:
   *
   * ```
   *   m1 = hitter+0xe   m2 = victim+0xe
   *   victim.v = (v1 * 2*m1 + v2 * (m2 - m1)) / (m1 + m2)
   *   hitter.v = (v2 * 2*m2 + v1 * (m1 - m2)) / (m1 + m2)
   * ```
   *
   * where `v1` is the hitter's cel blow pair (see `SbkCel.blow`) plus whatever it
   * was already doing. The player is 12, a punk 20, a mailbox 7, a rat 7, a
   * hydrant 10, a bullet 50 — light things fly and heavy ones shrug.
   */
  divisor: number;
  /** the flinches its hit handler picks between, indexed by tag */
  flinch?: readonly FoeAnim[];
  /** which flinch, the way the class's own handler decides */
  /**
   * ...and the ONE class that remembers a blow gets the enemy too.
   *
   * `0x426620` weighs a blow against **half of `AI+6`** and `0x426633`
   * overwrites `AI+6` with any blow that clears it, so the bishop's bar rises
   * every time it is beaten hard enough. That is per-creature state, which a
   * pure function of the blow cannot hold.
   */
  pick?: (blow: Blow, e: FoeState) => number;
  /** what it does instead when it dies; without one it cannot be killed */
  death?: FoeAnim;
  /**
   * Its hit handler has no health test at all: one blow of any size and it is
   * gone. `0x44e3f0`, the rat's, is the case — it fetches the blow, sprays,
   * plays a sound and installs the launch, and never touches the 200 its creator
   * gave it.
   */
  frail?: boolean;
  /**
   * Each blow advances one flinch instead of picking one, and the LAST of them
   * lets go of {@link Foe.burst}. `0x44fbd0` is the hydrant's and it is a
   * three-line switch on the tag it is already showing: 0 goes to 1, 1 to 2, 2 to
   * 3, and nothing after that.
   */
  progressive?: boolean;
  /**
   * What the last flinch lets go of — and it is a SEPARATE OBJECT, which is the
   * correction. See {@link FOES.inithydrant}: `0x44fb20` spawns one of its own
   * class `dx` pixels to the side on the burst tag and puts ITSELF back on tag 0,
   * so the hydrant is whole again while the water is a thing of its own that
   * sprays once and goes.
   */
  burst?: { anim: FoeAnim; dx: number; sound?: number; from: string };
  /**
   * What a blow of **−9** does to it — see `FLAME` in {@link file://./props.ts}.
   *
   * −9 is not damage and not one of the player's codes: eight classes read it
   * with a handler of their own that accepts nothing else, and every one of
   * them starts by calling `0x44ff20` to stick a flame on itself. What differs
   * after that is the two arguments it passes and the script it then installs.
   *
   * A class without this entry cannot be set on fire, which is the executable's
   * own answer for everything that has no such handler.
   */
  burns?: {
    /**
     * `0x44ff20`'s second argument — nonzero installs `0x478978` tag 2 outright
     * instead of `0x4788d0` tag 0, so the flame starts at the stage it goes
     * out on rather than taking hold first. The fireball's non-death arm
     * (`0x455791`) passes 1.
     */
    late?: boolean;
    /**
     * ...and its third. `0x453f6f` reinstalls tag 2 at the end of tag 2 while
     * this is set, so the flame never goes out. One caller passes it, and it
     * is the one for a thing that is already dead.
     */
    forever?: boolean;
    /** what the class plays out of its own book while it burns */
    anim?: FoeAnim;
    /** ...and whether that is the end of it */
    fatal?: boolean;
    /** a sound of its own as it catches — the dog's `0x4550eb` plays 0x18 */
    sound?: number;
    /**
     * Whether the blow ALSO lands as damage. Seven of the eight answer 1 and
     * are done; `0x4547b3` is the one that falls through into the ordinary
     * arithmetic after lighting itself, so a burning husk takes the hit too.
     */
    andHurts?: boolean;
    from: string;
  };
  /**
   * What it throws OUT when it is hit, and on what count.
   *
   * One class does it and it is the Coke machine. `0x43b6ab` sorts the blow
   * into three bands and keeps two counters in its own AI: `AI+2` steps on
   * every blow of thirty or more and lets a can go each time it passes two —
   * so every THIRD counted blow — while `AI+0` counts the cans and stops the
   * machine at four (`0x43b71a`). A blow of seventy-five or more skips both
   * counters: `0x43b755` loops `4 - AI+0` times and throws everything that is
   * left at once.
   *
   * What comes out is not this class at all — see `CAN` in
   * {@link file://./props.ts}.
   */
  shakes?: {
    /** `0x43b6ab` — a blow under this does not count towards the next one */
    counts: number;
    /** `0x43b6f5` — and it takes this many counted blows to shake one loose */
    every: number;
    /** `0x43b71a` — how many the thing holds */
    holds: number;
    /** `0x43b6d3` — a blow of this much throws every one that is left */
    bursts: number;
    from: string;
  };
  /**
   * It does not die the first time: it falls, lands, and STANDS UP whole.
   *
   * `initkragg` is the only one. `0x440b1c` splits its think function on
   * `obj+0x18 >= 11`, and everything at or above eleven is a second, grounded
   * creature — `0x441e4a`, the frame its health runs out, installs `0x473b60`,
   * the fall; it drops on real gravity, and `0x441747` catches the landing,
   * sprays `0x40cba0(point, 0x14, 0)`, installs `0x473ba8` — the rise, kind 11
   * — and `0x441787` writes `0x40e300(0x3e8)` straight back into the health
   * word at `0x4a75c8`. A full bar, a second time.
   *
   * So felling it is two fights, and the second one is against something that
   * cannot move sideways at all: the ground form's prologue pins `obj+8` to
   * `[0x4a7574]` every frame.
   */
  rallies?: { fall: FoeAnim; rise: FoeAnim; health: number; from: string };
  /**
   * Nothing can move it — its frame function writes its own home point back into
   * `obj+6` every single frame.
   *
   * `0x44fb43` is the hydrant's, two instructions in, and `0x44fb2e`/`0x44fb32`
   * zero its velocity pair on top of that. So a blow that would shove anything
   * else along leaves a hydrant exactly where the level put it, which is what a
   * hydrant is: bolted to the pavement.
   */
  rooted?: boolean;
  /**
   * Does its creator take the record's `param` as the object's FACING.
   *
   * The level's own spawner (`0x4503a0`) hands each creator different pieces of
   * the record, and the hydrant's is the one that takes two: `0x450896` pushes
   * `record+0x18` — the point — and `record+0` — the param — and `0x44fc70` writes
   * that second word straight into `obj+0x28`. STREETS' one hydrant has `param 1`,
   * and that is the whole reason its water goes east.
   */
  facesByParam?: boolean;
  /**
   * Its hit handler subtracts ONE, whatever the blow.
   *
   * `0x454811` fetches the damage and `0x454817` keeps it — but only to hand to
   * the blood call. What reaches the health is `0x454821 dec word ptr [eax]`. So
   * the fourth kind is not tough, it is three-hit: its creator never calls the
   * difficulty scaler at all and simply writes 3 (`0x450d1c`).
   */
  oneHitEach?: boolean;
  /**
   * What comes OUT of it when it dies, and where in the death that happens.
   *
   * `0x454690`, in the first tag of the fourth kind's death: `call 0x450a50` —
   * the punk's own creator, at the dying thing's own position. The big one is a
   * husk with a man inside it.
   */
  hatches?: { kind: string; afterCels: number; from: string };
  /**
   * What killing it pays, when that is not the panel's own figure.
   *
   * The two are usually the same call — `0x40d450(n)` — but a kind can pay
   * without ever claiming the bar. The dog is the case: `0x4551f7` awards 200
   * and nothing in the class ever calls `0x40d1c0`, so it has an award and no
   * name plate at all.
   */
  award?: number;
  /**
   * It stands as a statue until the player's point is inside its own record's
   * rect, and then gets up.
   *
   * `0x4559e8` is the test — `0x434200(playerPoint, AI+6)`, the same point-in-rect
   * every trigger in this engine uses. The level-four boss has two animations for
   * it, a stirring and a climb out of the ground; **all three of level five's
   * enemies have none** — their dormant state is one cel and they go straight
   * into the walk when the player arrives (`0x4388dd`, `0x439365`, `0x437c41`).
   * The dog has the same mechanism (`0x454c13`) and this page does not give it:
   * WOODS' six are awake from the first frame.
   */
  wake?: {
    cel?: number;
    stir?: FoeAnim;
    burst?: FoeAnim;
    sound?: number;
    stirSound?: number;
    from: string;
  };
  /**
   * It comes to YOU rather than walking its rect.
   *
   * `0x422f12` is the whole of the bat's: the brain's reading of how far ahead
   * the player is, clamped to `±px` and written straight into `obj+0xc`. A
   * creature with this ignores its own territory once it is awake; what the
   * rect is for is waking it.
   */
  chases?: { px: number; from: string };
  /**
   * The states its class drives while it is alive and unhurt, beyond standing.
   *
   * Only the boss has one. Its loop is `0x455e87`: hover a frame, decide on the
   * distance to the player, charge or swing, and every so often go home and stand
   * down again. The charge frames carry no strike box at all — they close the
   * distance and nothing else — so the whole of it is honest here even though
   * nothing in this port hits the player back.
   */
  /**
   * The WRAITH's own machine — see `initwraith`. It is not {@link Foe.drives}:
   * that shape was cut for the booly and the kragg, which charge and swing, and
   * this one hovers, rises, casts and lunges by a band table instead.
   */
  /**
   * The BISHOP's own machine — see `initvpriest`. A third shape again: it walks
   * in, and at range it rolls for whether to attack and then for which attack.
   */
  preaches?: {
    /** `0x46f4c0`, biggest first: 220, 170, 100 */
    bands: readonly number[];
    /** `0x46f1c0` tag 0 — the twelve-cel throw, and the commonest */
    throw_: FoeAnim;
    /** tag 1 — three records carrying dx -30, -20, -10: the recoil is authored */
    recoil: FoeAnim;
    /** tag 2 — the sixteen-cel one, which `0x425e94` reaches on a roll of 13 in 42 */
    sweep: FoeAnim;
    /** tag 3 — what it settles on afterwards */
    settle: FoeAnim;
    /** `0x425e70` — at band 1 it only commits on 3 in 10 */
    farOdds: readonly [number, number];
    /** `0x425e8c` — and then 13 in 42 picks the sweep over the throw */
    sweepOdds: readonly [number, number];
    /** `0x425d4a` — `belfry.snd` 0x1d, played the frame it wakes */
    wakeSound: number;
    from: string;
  };
  haunts?: {
    /** `0x46f8f8`, biggest first — the band is how many the gap is still past */
    bands: readonly number[];
    rouse: FoeAnim;
    hover: FoeAnim;
    rise: FoeAnim;
    held: FoeAnim;
    sink: FoeAnim;
    cast: FoeAnim;
    lunge: FoeAnim;
    sweep: FoeAnim;
    from: string;
  };
  drives?: {
    hover: FoeAnim;
    charge: FoeAnim;
    rush: FoeAnim;
    combo: FoeAnim;
    land: FoeAnim;
    melee: FoeAnim;
    antiAir: FoeAnim;
    /** `AI+0x10` — the point it returns to, from its creator */
    homeX: number;
    /** `AI+4`'s budget: how many decisions before it goes home (`0x455b42`) */
    decisions: number;
    /** `0x478780`'s band 5 edge — inside this it swings instead of charging */
    nearPx: number;
    /** `0x455ef8`'s `cmp eax, 0x6e` — close enough to home to stand down */
    homePx: number;
    /**
     * The FORWARD distances that sort what it does, biggest first, as
     * `0x45efd0` reads them: the band is how many of these are at or above the
     * distance to the player, so three thresholds make four bands.
     *
     * Level eight's is `{250, 150, 80}` at `0x473dc8`, terminated by the zero
     * `0x45ef9f` stops on. A boss with these is driven by them rather than by
     * {@link nearPx} and the decision budget.
     */
    bands?: readonly number[];
    /**
     * How it holds its height, for the one boss that has no gravity.
     *
     * `0x440ce6`..`0x440db6`: a direction of ±1 is added to the vertical
     * velocity every frame and reversed at the limits, and the limits are what
     * the boss is trying to do — it wants the player `offset` below it, and when
     * the player is more than `slack` off that it allows the faster pair rather
     * than the slower.
     */
    bob?: {
      /** `[0x473ddc]` — how far below itself it wants the player */
      offset: number;
      /** the `± 0xa` either side of that offset */
      slack: number;
      /** `0xfffb` and `5` — the limits while it is near enough */
      near: readonly [number, number];
      /** `0xfff7` and `9` — and the limits while it is not */
      far: readonly [number, number];
      from: string;
    };
    /**
     * The state that ends over a sprinkler, and what it does when it gets there.
     *
     * `0x4415a9`, inside the dive: `0x441b20` asks which `initsprinkler` record's
     * rect contains the boss's OWN point and `0x441b60` raises that one, or rolls
     * `0x434540(7)` for a free one and tries up to seven times.
     */
    raises?: "rush";
    from: string;
  };
  /**
   * A blow every so often puts it down instead of making it flinch, and getting
   * up takes its own animation. `0x456496`: the boss counts consecutive hits in
   * `AI+0x12` and the third one knocks it over.
   */
  knockdown?: { anim: FoeAnim; every: number; sound: number; from: string };
  /**
   * It walks to a `switch` in its own territory and throws it ON.
   *
   * Four classes have this and they all have it the same way, three calls deep:
   * the think tests its own state (`0x439cf4`), `0x438200` hands back the first
   * object of the switch class whose POSITION is inside the thing's own record
   * rect **and whose tag is 3**, which is to say an unlit one, and the class
   * installs its kind-6 script — whose tag 0 is the ordinary walk and whose tag 1
   * is the reach. Within `0x25` pixels of the lever it stops walking and plays
   * the reach, and one named frame of that reach calls `0x436820(lever, 0)`.
   *
   * Direction ZERO, every time. Nothing in the game ever asks an enemy to turn a
   * lever off. See {@link file://./props.ts} for what that switches on, and why
   * a gang that heals under goop wants it on.
   */
  lever?: {
    /**
     * Which way it throws — `0x436820`'s second argument, and a lever only
     * answers the throw that suits it: 0 finds an unlit one and lights it, 1
     * finds a lit one and puts it out. All four of the gang pass 0. Level
     * seven's beast passes **1** (`0x43f736`), which is to say it goes round
     * shutting the doors you have opened.
     */
    dir: 0 | 1;
    /** the kind-6 script's tag 1 — the reach */
    anim: FoeAnim;
    /** which frame of it makes the call — the script index `obj+0x42` is tested against, less tag 0's six */
    at: number;
    /** `cmp eax, 0x25` — how close it has to get before it stops walking */
    reachPx: number;
    /** `0x434540(3) == 1` and then `0x434540(2) + 5`: a one-in-three chance of 5 or 6 */
    sound: readonly number[];
    from: string;
  };
  /**
   * It has no gravity and stands on nothing — `0x42f850(obj, 0)` in its class.
   *
   * One class in the game does: level seven's floating eye, which is given a
   * standing rise of five pixels a frame on top of the zero (`obj+0xa = -5` at
   * `0x43dd3c`) and flies on its own script's `dy` impulses. This page holds
   * such a thing at the height its record's point put it, which is the part of
   * the behaviour that needs no state machine to be true.
   */
  floats?: boolean;
  /** how long the body lies there before it goes, in engine frames; Infinity never */
  linger?: number;
  /** what it stood up with — `0x40e300`'s argument in the creator */
  health: number;
  /** the three figures it tells the interface panel, when it claims the bar */
  panel?: { health: number; plate: number; award: number };
  /**
   * Does a blow's momentum STAY with it — whether its own frame function leaves
   * `obj+0xa`/`obj+0xc` alone.
   *
   * Those two words are a persistent velocity, not a per-frame stride, and an
   * object that should not drift cancels them itself: the hydrant's `0x44fb20`
   * zeroes both on its first two instructions, which is why a hydrant never
   * budges, and a gob of goo zeroes them the frame it lands. The mailbox's
   * `0x44fe10` never touches them — so the velocity `0x430470` hands it is kept,
   * and a kick sends it most of a screen.
   *
   * The creatures are left out of this deliberately. Their knockbacks are in their
   * own scripts (the punk's `0x477580` travels `dx 150, 150, 75, 75`) and whether
   * they also keep the solver's momentum has not been settled, so this page does
   * not give them any.
   */
  flies?: boolean;
  /**
   * What its hit handler plays out of the chapter's bank, as a record index —
   * {@link file://./sound.ts} has the sites and the names. An array is a random
   * one of them, which is what `0x434540` in front of the call means.
   */
  hitSound?: number | readonly number[];
  /** what its death path plays, through `0x40f090` */
  deathSound?: number;
  /** does it enrol in the level census — `0x42f870(obj, 1)` in its creator */
  counts: boolean;
  /**
   * Does a blow throw goo out of it — whether its hit handler calls `0x40cba0`.
   *
   * The three creatures do (`0x44f12e`, `0x44f90f`, `0x44e411`) and the two pieces
   * of furniture do not: `0x44fe80` and `0x44fbd0` fetch the blow with `0x42f910`,
   * install a dent and play a sound, and never touch the spray. A mailbox does not
   * bleed.
   */
  bleeds?: boolean;
  /**
   * Does its body leave a green ball behind — whether its CORPSE state handler
   * calls `0x40cba0(pos, -13, 0)` when `[0x46b204]`'s fifty frames expire.
   *
   * Both punk classes do (`0x44ef7e` and `0x44f848`, each right after `0x42fa80`
   * fetches the body's own rect), and the rat does not: its launch is a different
   * state and ends with the object simply gone. See {@link VANISH} in
   * {@link file://./effects.ts} for the eleven cels.
   */
  vanishes?: boolean;
  /**
   * ...and it leaves its BOARD behind — `0x438450`, see `SKATEBOARD`.
   *
   * Two of the gang carry one: `0x4383d9` drops it out of `initknotboy`'s hit
   * handler and `0x43a6f9` out of `initknifeboy`'s, both on the frame the thing
   * dies and neither anywhere else.
   */
  drops?: "skateboard";
  /** the four functions above, for whoever checks this */
  from: string;
}

/**
 * How long a corpse stays on screen: `[0x46b204]`, **50 engine frames**.
 *
 * Every hit handler in the game reads the same global into its instance struct on
 * death, and the class's state 9 handler decrements it once a frame and removes
 * the object when it goes negative. At fifteen frames a second that is three and
 * a third seconds of body on the ground.
 */
export const CORPSE_LINGER = 50;

/**
 * This chapter's classes — levels 1 to 4, registered by `0x4503a0`.
 *
 * These are the five the shipped STREETS places, and the same registration
 * covers CITY, WOODS and PLAYGR. The other three chapters have their own
 * classes and their own numbers, and none of them is in here: a name absent from
 * this table simply is not drawn, which is what the page has always done.
 */
export const FOES: Readonly<Record<string, Foe>> = {
  /**
   * The red-mohawked punk. Creator `0x450a50`, class `0x44e4b0`, hit `0x44f0a0`.
   *
   * Its gait is the one place here that is not wholly read. `0x4774b0` is the
   * walk — eight cels, 1900 to 1907, held two frames each — and every one of its
   * `dx` fields is **zero**: this class's stride comes from the AI struct
   * `0x45ef70` fills from the table at `0x477600` (330, 200, 150, 80), which has
   * not been read. The 75 below is the figure the class's OTHER two gaits carry
   * (`0x4770f0`'s prowl and, in its sibling, `0x477630`'s walk), so it is the
   * disc's number for a walking punk even though it is not this script's.
   */
  initwerea: {
    /**
     * `0x4770f0` tag 0, kind 0 — the patrol, and the correction here is that it
     * is not `0x4774b0`.
     *
     * `0x4774b0` is kind 1, the fighting stance: eight cels of shifting weight
     * with **`dx` 0 on every one of them**. This page had it as the walk and
     * gave it a stride of 75 that no frame of it carries, so the punk paced its
     * territory on the standing cels. The thing state 0 actually installs is
     * `0x4770f0` — six cels, 1910 to 1915, each carrying 75 of its own.
     */
    gait: {
      cels: [1910, 1911, 1912, 1913, 1914, 1915],
      hold: 2,
      dx: [75, 75, 75, 75, 75, 75],
      kind: 0,
      tag: 0,
      from: "0x4770f0 tag 0",
    },
    divisor: 20,
    // 0x4774f8, three tags of one cel each, held four frames
    flinch: [
      { cels: [1970], hold: 4, from: "0x4774f8 tag 0" },
      { cels: [1971], hold: 4, from: "0x4774f8 tag 1" },
      { cels: [1972], hold: 4, from: "0x4774f8 tag 2" },
      // 0x477580 tag 0 — the knockdown a blow over 50 earns, and it travels
      {
        cels: [1960, 1961, 1962, 1963],
        hold: 2,
        dx: [150, 150, 75, 75],
        from: "0x477580 tag 0",
      },
    ],
    // 0x44f1fd..0x44f280, in the order the handler tests
    pick: ({ damage, dy, facingAway }) =>
      damage > 50 ? 3 : dy > 50 ? 0 : dy >= 30 && !facingAway ? 2 : 1,
    death: {
      cels: [
        1960, 1961, 1962, 1963, 1980, 1981, 1982, 1983, 1984, 1985, 1986, 1987,
      ],
      hold: 3,
      from: "0x477518 tag 0",
    },
    health: 250,
    // `0x44f15a` and `0x44f184` — four hit takes, one death
    hitSound: FOE_SFX.punkHit,
    deathSound: FOE_SFX.wereaDeath,
    panel: { health: 250, plate: 13001, award: 220 },
    counts: true,
    bleeds: true,
    vanishes: true,
    /**
     * `0x44f0aa` — `0x44ff20(self, 0, 0)` and then `0x477408` tag 0, fifteen
     * frames of `1940 1941 1942 1942 1942` three times over. Every third cel
     * of it carries `dy -240`, so a burning werewolf LEAPS, three times,
     * and none of the three cels carries a strike box: it is thrashing, not
     * attacking.
     */
    burns: {
      anim: {
        cels: [1940, 1941, 1942, 1942, 1942, 1940, 1941, 1942, 1942, 1942, 1940, 1941, 1942, 1942, 1942],
        hold: 1,
        from: "0x477408 tag 0",
      },
      from: "0x44f0aa",
    },
    from: "0x450a50 / 0x44e4b0 / 0x44e580 / 0x44f0a0",
  },
  /**
   * The chained punk — LINK on the panel. Creator `0x450b40`, class `0x44f300`,
   * hit `0x44f8b0`. Its walk carries its own stride, so nothing here is invented.
   *
   * Its death is the longest in the chapter: twelve cels held three frames each,
   * 5060 to 5063 falling and then 5070 to 5077 lying still while green goo runs
   * out of its head — which is the same goo the spray throws (see effects.ts).
   */
  initwereb: {
    gait: {
      cels: [5000, 5001, 5002, 5003, 5004, 5005],
      hold: 2,
      dx: [75, 75, 75, 75, 75, 75],
      from: "0x477630 tag 0",
    },
    divisor: 20,
    // 0x477820 — four single-cel flinches held four frames, picked at random
    flinch: [
      { cels: [5080], hold: 4, from: "0x477820 tag 0" },
      { cels: [5081], hold: 4, from: "0x477820 tag 1" },
      { cels: [5082], hold: 4, from: "0x477820 tag 2" },
      { cels: [5083], hold: 4, from: "0x477820 tag 3" },
    ],
    // 0x44f9d3: `push 4; call 0x434540; dec ax` — one of four, uniformly
    pick: () => Math.floor(Math.random() * 4),
    death: {
      cels: [
        5060, 5061, 5062, 5063, 5070, 5071, 5072, 5073, 5074, 5075, 5076, 5077,
      ],
      hold: 3,
      from: "0x477848 tag 0",
    },
    health: 200,
    // `0x44f942` — the same four takes; `0x44f965` drops its chain instead
    hitSound: FOE_SFX.punkHit,
    deathSound: FOE_SFX.werebDeath,
    panel: { health: 200, plate: 13002, award: 240 },
    counts: true,
    bleeds: true,
    vanishes: true,
    /**
     * `0x44f8bd` — and what a burning chained punk does is RUN. `0x477700` is
     * kind 4, twelve frames of its own walk cels 5000..5005 twice over, and
     * every one of them carries the walk's own `dx 75`. So it bolts, on the
     * same art it patrols with, for twelve frames.
     */
    burns: {
      anim: {
        cels: [5000, 5001, 5002, 5003, 5004, 5005, 5000, 5001, 5002, 5003, 5004, 5005],
        hold: 1,
        dx: [75, 75, 75, 75, 75, 75, 75, 75, 75, 75, 75, 75],
        from: "0x477700 tag 0",
      },
      from: "0x44f8bd",
    },
    from: "0x450b40 / 0x44f300 / 0x44f3d0 / 0x44f8b0",
  },
  /**
   * The boss of level four. Creator `0x451050`, class `0x455880`, hit `0x456310`.
   *
   * PLAYGR places exactly one, and the level is it: seventeen records, of which
   * seven are dogs that count for nothing and one is this. Its share is the one
   * that stores zero — everything — and the engine wants two things before the
   * level will end, the census clear AND a flag at `0x476a94` that only this
   * thing's death path writes (`0x456431`, tested at `0x4502e2`). They become
   * true together, because it takes itself out of the census as it starts to burn.
   *
   * **It begins as a statue.** Cel 3040, one frame, doing nothing, until the
   * player's own point crosses into its record's rect; then it stirs, climbs out
   * of the ground and comes for you. Eight hundred health at `0x4510b8`, four
   * times the chained punk's and the largest number in the chapter, and 2500
   * points for it at `0x456420` — ten times a werewolf.
   *
   * What it does while it lives is a real loop and all of it is here, the
   * fireball included: `0x456240` builds a second object of its own class (cels
   * 7010..7015 in flight, 7016..7019 bursting) with a restitution of 0.8 so the
   * low shot bounces, and every frame of it carries a strike box. Its two muzzle
   * points and both velocities are at `0x455cc3` and `0x455d01`, and the module
   * flies both through {@link BrainCtx.cast}. The charge, by contrast, carries
   * **no** strike box on any frame: it closes the distance and nothing else.
   */
  initwbooly: {
    // `0x478340` kind 1 — standing, two frames a cel, going nowhere
    gait: { cels: [3040, 3041], hold: 2, dx: [0, 0], from: "0x478340 tag 0" },
    // `0x45589b`: thirty, the highest in the game — it is very heavy
    divisor: 30,
    /**
     * `0x4782e0` tags 1 and 2: four frames of the head lifting, then six of the
     * thing pulling itself out of the ground. `0x455a14` plays its wake as a
     * one-shot and `0x455a55` puts a loop under the climb.
     */
    wake: {
      stir: { cels: [3041, 3040, 3041, 3040], hold: 1, from: "0x4782e0 tag 1" },
      burst: {
        cels: [3122, 3123, 3124, 3124, 3123, 3122],
        hold: 1,
        from: "0x4782e0 tag 2",
      },
      sound: FOE_SFX.boolyWake,
      stirSound: FOE_SFX.boolyStir,
      from: "0x4559e8 / 0x455a2f / 0x455a67",
    },
    /**
     * `0x455d9b`'s kind 5, the combat loop, and `0x455e87` is the frame that
     * decides. The bands are its own table at `0x478780` — 1000, 750, 500, 400,
     * 160, 60 — and what they pick is: inside 160, swing; outside it, charge. The
     * charge is `dx 310` over a divisor of 30, so eleven pixels a frame, and the
     * one it uses to get home again is 610, twenty-one.
     */
    drives: {
      hover: { cels: [3000], hold: 1, from: "0x4785e8 tag 4" },
      charge: {
        cels: [3000, 3001, 3002, 3003, 3004, 3005, 3006],
        hold: 1,
        dx: [310, 310, 310, 310, 310, 310, 310],
        from: "0x4785e8 tag 1",
      },
      rush: {
        cels: [3000, 3001, 3002, 3003, 3004, 3005, 3006],
        hold: 1,
        dx: [610, 610, 610, 610, 610, 610, 610],
        from: "0x4785e8 tag 5",
      },
      combo: {
        cels: [3060, 3061, 3062, 3063, 3064, 3065, 3066, 3067, 3068],
        hold: 1,
        dx: [0, 0, 0, 0, 0, 0, 0, 0, 310],
        from: "0x4785e8 tag 2",
      },
      land: { cels: [3092, 3091, 3090], hold: 1, from: "0x4785e8 tag 3" },
      melee: {
        cels: [3052, 3052, 3053, 3054, 3055],
        hold: 2,
        from: "0x478448 tag 0",
      },
      antiAir: {
        cels: [3130, 3131, 3132, 3133, 3134],
        hold: 1,
        from: "0x4784e8 tag 0",
      },
      // `0x4510dd`: the dword at AI+0xe is a packed point, x4650 y2194
      homeX: 4650,
      // `0x455b42` seeds AI+4 with ten, and `0x455eae` spends one a decision
      decisions: 10,
      nearPx: 160,
      homePx: 110,
      from: "0x455d9b / 0x455e87",
    },
    /**
     * `0x478358` — one cel each, three frames. Tag 0 is the take it uses when the
     * blow lands mid-combat and tag 1 the one it uses standing; this page keeps
     * both and picks between them the way `0x4564dc` does.
     */
    flinch: [
      { cels: [3080], hold: 3, from: "0x478358 tag 0" },
      { cels: [3124], hold: 3, from: "0x478358 tag 1" },
    ],
    // `0x456470`: a blow arriving while it is already down, throwing or flinching
    // does nothing at all; `0x4564dc` picks the mid-combat take otherwise
    pick: ({ hits }) => (hits % 2 === 0 ? 0 : 1),
    /**
     * `0x456496`: every third consecutive blow puts it over instead. The get-up
     * is its own script at its own rate, which is what {@link FoeAnim.then} is
     * for — `0x478518` runs two frames a cel and `0x478578` three.
     */
    knockdown: {
      anim: {
        cels: [3070, 3071, 3072, 3073, 3074, 3074],
        hold: 2,
        then: {
          cels: [3110, 3100, 3111, 3101, 3112, 3102, 3113],
          hold: 3,
          from: "0x478578 tag 0",
        },
        from: "0x478518 tag 0",
      },
      every: 3,
      sound: FOE_SFX.boolyKnock,
      from: "0x456496",
    },
    /**
     * `0x478370` tags 1 and 2, run together: eighteen frames of it coming apart,
     * and then cel 3140, the burning wreck, which is where it stays. The object is
     * never destroyed — `0x4560ed` loops tag 2 for ever — so the body does not go.
     */
    death: {
      cels: [
        3081, 3080, 3000, 3083, 3083, 3000, 3001, 3000, 3083, 3083, 3000, 3081,
        3080, 3070, 3071, 3072, 3073, 3074, 3140,
      ],
      hold: 2,
      terminal: true,
      from: "0x478370 tags 1 and 2",
    },
    linger: Infinity,
    health: 800,
    hitSound: FOE_SFX.boolyHit,
    deathSound: FOE_SFX.boolyDeath,
    // `0x455999`: the bar with plate 0x32d1, which lives in PLAYER.SBK and not in
    // this level's book; `0x456420` pays 0x9c4
    panel: { health: 800, plate: 13009, award: 2500 },
    counts: true,
    bleeds: true,
    /**
     * `0x45631e` — the shortest of the eight, and the only one that installs
     * NOTHING. It lights itself with `0x44ff20(self, 0, 0)` and returns 0 at
     * `0x456332`, before the handler's own arithmetic: so the boss catches
     * fire, goes on doing whatever it was doing, and takes not a point for it.
     */
    burns: { from: "0x45631e" },
    from: "0x451050 / 0x455880 / 0x455940 / 0x456310",
  },
  /**
   * The masked one — level five's commonest, nine of them. Creator `0x436280`,
   * class `0x438690`, think `0x438760`, hit `0x438f00`.
   *
   * MALL opens a chapter this port had nothing of, and the two classes here are
   * built to the same pattern as each other rather than to chapter four's: a
   * divisor of seven (fast and light), a blow pinned at 100 and re-stamped every
   * frame by the think's own epilogue, no gravity call and no restitution call, a
   * single flinch cel with no pick rule at all, and an award paid straight out of
   * the hit handler rather than carried on the object.
   *
   * Its state machine is larger than anything here drives: four distance bands at
   * `0x474328` choosing between backing off, walking in and a two-sided attack; a
   * leap when it has been blocked four frames running (`0x438912`); a gloat over
   * a downed player (`0x438805`); and a whole sub-state for walking to a `switch`
   * record and throwing it. That last is **dead in MALL** — the level places no
   * `switch` at all, and the cels its script wants (3260..3268) are not even in
   * the book — so what the level actually shows is spawn, walk, idle, attack,
   * leap, flinch and death, which is what is here.
   *
   * It is also the only class in the chapter that spawns a hazard: a two-in-68
   * roll each frame (`0x438848`), inside 300 pixels and from behind, sends
   * `0x43a790` to put a roller 600 pixels the far side of the player. Only one
   * may be WAITING — `0x474868` latches at `0x43a841` and `0x43a9dc` clears it
   * on the frame the thing starts to roll, not when it dies. It goes through
   * {@link BrainCtx.roller}; see `ROLLER` in {@link file://./props.ts}.
   */
  initmaskboy: {
    lever: {
      dir: 0,
      anim: {
        cels: [
          1821, 1821, 1822, 1822, 1823, 1823, 1822, 1822, 1821, 1821, 1820,
          1821, 1821, 1820,
        ],
        hold: 1,
        from: "0x4740c8 tag 1",
      },
      at: 10,
      reachPx: 37,
      sound: [5, 6],
      from: "0x438a55 / 0x438aa9 / 0x438ab9",
    },
    // `0x474230` tag 4 — six cels, and the stride is on four of them
    gait: {
      cels: [1800, 1801, 1802, 1803, 1804, 1805],
      hold: 1,
      dx: [0, 60, 70, 80, 120, 0],
      from: "0x474230 tag 4",
    },
    // `0x4386ab`: seven, against chapter four's twelve and twenty
    divisor: 7,
    // `0x4742d8` tag 0 — ONE cel, and `0x4390df` installs it unconditionally:
    // this chapter's handlers have no Δy test, no facing test and no random roll
    flinch: [{ cels: [1820], hold: 1, from: "0x4742d8 tag 0" }],
    death: {
      cels: [1820, 1821, 1822, 1823, 1824],
      hold: 1,
      from: "0x4742f8 tag 0",
    },
    // `0x4388dd`: it stands on cel 1801 doing nothing until the player's point is
    // inside its own record's rect, and then walks
    wake: {
      cel: 1801,
      sound: FOE_SFX.maskboyWake,
      from: "0x4388dd / 0x4388f4",
    },
    health: 40,
    hitSound: FOE_SFX.maskboyHit,
    // `0x439033`'s damage branch plays one sound and the death path plays none
    panel: { health: 40, plate: 13102, award: 220 },
    counts: true,
    bleeds: true,
    vanishes: true,
    from: "0x436280 / 0x438690 / 0x438760 / 0x438f00",
  },
  /**
   * The one with the bat — four of them. Creator `0x436320`, class `0x439170`,
   * think `0x439240`, hit `0x439980`.
   *
   * The same class one number down: twenty-five health where the masked one has
   * forty, and worth more for it (250 against 220). Its kind numbers are swapped
   * against its sibling's — its walk is kind 4 where the other's is 5 — and its
   * wind-up cel 1911 carries a strike box where the masked one's 1811 does not,
   * so it has four hitting frames to the other's three.
   *
   * Both of them can be HEALED, which nothing in chapter four could: a blow from
   * `initgoop` adds health instead of taking it (`0x439a4a`), sixty for this one
   * and twenty for its sibling. MALL places no goop, so it never happens here.
   */
  initbatboy: {
    lever: {
      dir: 0,
      anim: {
        cels: [1906, 1906, 1920, 1921, 1920, 1921, 1922, 1921, 1920],
        hold: 1,
        from: "0x4743b8 tag 1",
      },
      at: 5,
      reachPx: 37,
      sound: [5, 6],
      from: "0x4396c1 / 0x43970d / 0x43971d",
    },
    gait: {
      cels: [1900, 1901, 1902, 1903, 1904, 1905],
      hold: 1,
      dx: [0, 60, 70, 80, 120, 0],
      from: "0x474438 tag 4",
    },
    divisor: 7,
    flinch: [{ cels: [1920], hold: 1, from: "0x474508 tag 0" }],
    death: {
      cels: [1920, 1921, 1922, 1923, 1924],
      hold: 1,
      from: "0x474528 tag 0",
    },
    wake: { cel: 1901, sound: FOE_SFX.batboyWake, from: "0x439365 / 0x43937b" },
    health: 25,
    hitSound: FOE_SFX.batboyHit,
    panel: { health: 25, plate: 13101, award: 250 },
    counts: true,
    bleeds: true,
    vanishes: true,
    from: "0x436320 / 0x439170 / 0x439240 / 0x439980",
  },
  /**
   * The third of level five's three, and the one that carries a skateboard.
   * Creator `0x4361e0`, class `0x437a50`, think `0x437c00`, hit `0x438260`.
   *
   * Fifty health, the most of the three, and worth the least — eighty, against
   * the masked one's 220 and the bat's 250. It drops its board when it dies
   * (`0x438450` builds cels 2300 and 2302..2311 on their own script). See
   * `SKATEBOARD` for what that board then does.
   *
   * The three of them share a handler shape that says a good deal about the
   * chapter: six classes are named in an ignore list so they cannot hurt each
   * other, the flinch is one cel installed unconditionally, and the award is paid
   * straight out of the hit handler rather than carried on the object.
   */
  initknotboy: {
    lever: {
      dir: 0,
      anim: {
        cels: [1946, 1946, 1961, 1961, 1946, 1946, 1961, 1960, 1961],
        hold: 1,
        from: "0x473e50 tag 1",
      },
      at: 6,
      reachPx: 37,
      sound: [5, 6],
      from: "0x437f4b / 0x437fb0 / 0x437fef",
    },
    gait: {
      cels: [1940, 1941, 1942, 1943, 1944, 1945],
      hold: 1,
      dx: [0, 60, 70, 80, 120, 0],
      from: "0x473e50 tag 0",
    },
    divisor: 7,
    flinch: [{ cels: [1960], hold: 1, from: "0x474048 tag 0" }],
    death: {
      cels: [1960, 1961, 1962, 1963, 1964],
      hold: 1,
      from: "0x474068 tag 0",
    },
    wake: {
      cel: 1940,
      sound: FOE_SFX.knotboyWake,
      from: "0x437c41 / 0x437c5a",
    },
    health: 50,
    hitSound: FOE_SFX.knotboyHit,
    // `0x437b66`: plate 0x332f, which like the other two lives in PLAYER.SBK;
    // `0x4383f7` pays 0x50
    panel: { health: 50, plate: 13103, award: 80 },
    counts: true,
    bleeds: true,
    vanishes: true,
    drops: "skateboard", // `0x4383d9`
    from: "0x4361e0 / 0x437a50 / 0x437c00 / 0x438260",
  },
  /**
   * The fourth of the gang, and the one level six adds. Creator `0x4363c0`,
   * class `0x439bd0`, think `0x439ca0`, hit `0x43a580`.
   *
   * Everything about it is the chapter's pattern one more time — divisor seven,
   * blow pinned at 100, one flinch cel installed with no pick rule, the award
   * paid out of the hit handler — and its numbers sit where you would expect
   * between its three siblings: 25 health like the one with the bat, and 240 for
   * killing it, between the bat's 250 and the masked one's 220. Its plate,
   * `0x3330`, is the fourth in the row 13101, 13102, 13103, **13104**.
   *
   * Two things it does are not in MALL, because MALL has nothing for them to do
   * them to.
   *
   * **It throws switches.** `0x439d04` runs when its state is 2 or 4: `0x438200`
   * hands back the nearest object of the switch class, the thing turns to face
   * it, walks over on `0x4746a8`, and at frame 7 of that walk `0x43a1c7` calls
   * `0x436820(switch.pos, 0)` — the same call the player makes by standing at
   * one. Zero is the ON direction. All four of the gang do this (`0x437fef`,
   * `0x438ab9`, `0x43971d`, `0x43a1c7`); SERVICE is the first level that places
   * a `switch` for them to walk to, and what the switches turn on is the goop.
   *
   * **Goop heals it.** `0x43a64a` asks whether the thing that hit it belongs to
   * the goop class before it does anything else, and if it does, adds 20 to its
   * health, clamps it to the 25 it started with, plays 11, and returns without
   * spraying or subtracting. Its siblings do the same for 60 and for 20. So the
   * shower the switches turn on is the gang's, and a player who walks past a
   * switch the wrong way feeds the level.
   *
   * It drops a skateboard when it dies — `0x43a6f9` calls `0x438450`, the same
   * maker the third one uses. See `SKATEBOARD`.
   */
  initknifeboy: {
    lever: {
      dir: 0,
      anim: { cels: [1858, 1857, 1856], hold: 1, from: "0x4746a8 tag 1" },
      at: 1,
      reachPx: 37,
      sound: [5, 6],
      from: "0x43a134 / 0x43a188 / 0x43a1c7",
    },
    // `0x474648` tag 4 — the same six-cel walk and the same stride as its three
    // siblings, one book row along
    gait: {
      cels: [1840, 1841, 1842, 1843, 1844, 1845],
      hold: 1,
      dx: [0, 60, 70, 80, 120, 0],
      from: "0x474648 tag 4",
    },
    divisor: 7,
    // `0x474770` has three tags of one cel each and `0x43a744` installs tag 0
    // and only ever tag 0
    flinch: [{ cels: [1860], hold: 1, from: "0x474770 tag 0" }],
    death: {
      cels: [1860, 1861, 1862, 1863, 1864],
      hold: 1,
      from: "0x474790 tag 0",
    },
    // `0x439da3`: it stands on 1841 with its velocity zeroed until the player's
    // point is inside its record's rect, and `0x439dd0` sounds as it starts
    wake: {
      cel: 1841,
      sound: FOE_SFX.knifeboyWake,
      from: "0x439da3 / 0x439dd0",
    },
    health: 25,
    hitSound: FOE_SFX.knifeboyHit,
    // `0x439cd2` claims the bar with 0x3330; `0x43a711` pays 0xf0
    panel: { health: 25, plate: 13104, award: 240 },
    counts: true,
    bleeds: true,
    vanishes: true,
    drops: "skateboard", // `0x43a6f9`
    from: "0x4363c0 / 0x439bd0 / 0x439ca0 / 0x43a580",
  },
  /**
   * What stands between level six and its goal. Creator `0x436460`, class
   * `0x43cbb0`, think `0x43cc60`, hit `0x43d250`.
   *
   * One of them, at x9017, in a territory that runs from x8418 to the east wall
   * — which is to say the last six hundred pixels of the level, with the goal
   * inside it. It is built like the boss of level four rather than like the gang:
   * **750 health**, nearly twice the whole gang put together, a divisor of 13
   * against their 7, a shove weight of 12 at `obj+0x26` that nothing else in the
   * chapter sets, and a walk whose cels carry no stride at all — it travels on
   * its velocity, not on script impulses.
   *
   * Its hit handler is the shortest of the chapter and the only one with **no
   * ignore list**: the gang name six classes they cannot hurt, and this one names
   * none, so goop, knives and its own allies all land on it. The one thing it
   * does test is a blow strength of exactly −6, which it swallows.
   *
   * Unlike the boss of level four the level does not wait for it: SERVICE's share
   * is chapter two's ordinary 0.75, so the goal opens on the count and this is
   * simply the biggest thing standing in front of it.
   */
  inithardcore: {
    // `0x474960` — twelve frames, two cels' worth of walk cycled twice, and every
    // dx is zero
    gait: {
      cels: [6050, 6051, 6052, 6053, 6054, 6055],
      hold: 2,
      from: "0x474960 tag 0",
    },
    // `0x43cbcb`: thirteen
    divisor: 13,
    // `0x474b88` — four cels that carry their own knockback, dx -100 on two of them
    flinch: [
      {
        cels: [6030, 6031, 6032, 6033],
        hold: 2,
        dx: [0, -100, 0, -100],
        from: "0x474b88 tag 0",
      },
    ],
    // `0x474bb0` — and the first frame throws it, dx -65 dy -180
    death: {
      cels: [6000, 6001, 6002, 6003, 6004, 6005],
      hold: 2,
      from: "0x474bb0 tag 0",
    },
    // `0x43ccda`: the same point-in-rect the gang use, and it holds 6070 until then
    wake: {
      cel: 6070,
      sound: FOE_SFX.hardcoreHit,
      from: "0x43ccda / 0x43cd1b",
    },
    health: 750,
    hitSound: FOE_SFX.hardcoreHit,
    // `0x43cca1` claims the bar with 0x3331 and 0x2ee; `0x43d2e8` pays 0x15e
    panel: { health: 750, plate: 13105, award: 350 },
    counts: true,
    bleeds: true,
    vanishes: true,
    from: "0x436460 / 0x43cbb0 / 0x43cc60 / 0x43d250",
  },
  /**
   * Level seven's floating eye — `initeyeball`, nine of them, and the first
   * thing in this port that does not stand on anything. Creator `0x435a30`,
   * class `0x43dd00`, think `0x43dde0`, hit `0x43e8b0`.
   *
   * `0x43dd43` gives it `0x42f850(obj, 0)` — no gravity at all — and the class
   * writes `obj+0xa = -5` on top of that, a standing rise of five pixels a
   * frame. It has a shove weight of 3, the lightest thing in the game, and a
   * divisor of 8.
   *
   * Its own state machine flies it: `0x472998` is three tags on the same twelve
   * cels, a level cruise on 6206 with `dx 20` and then a climb and a dive that
   * carry `dy -100` and `dy +100` on four frames each. This port holds it at the
   * height its record's point puts it and cruises; the climb and the dive are
   * not driven, and nor is `0x4728e0` tag 1, the ten cels of 6600 the death
   * bursts into.
   *
   * **Which flinch it takes is decided by the cel it is showing.** `0x43e9bc`
   * compares the current cel against 6206, 6207 and 6208 — the three angles the
   * eye can be caught at — and picks tag 1, 2 or 3 of `0x472878` to match, so
   * the eye that is hit shuts the way it was open. A blow over `0x46` skips all
   * three for `0x4727f0`, twelve cels of 6300. Its ignore list is one class
   * long, and the class is the pipe.
   */
  initeyeball: {
    // `0x472aa0` tag 0 — one cel and a stride, which is the whole of its cruise
    gait: { cels: [6206], hold: 2, dx: [20], from: "0x472aa0 tag 0" },
    // `mov word ptr [esi+0xe], 8` at `0x43dd1b`
    divisor: 8,
    // `0x472878` tags 1, 2 and 3 — the eye shutting from each of its angles,
    // and this page's gait holds the first of the three
    flinch: [
      { cels: [6006, 6006, 6106, 6206], hold: 3, from: "0x472878 tag 1" },
      { cels: [6007, 6007, 6107, 6207], hold: 3, from: "0x472878 tag 2" },
      { cels: [6008, 6008, 6108, 6207], hold: 3, from: "0x472878 tag 3" },
    ],
    death: {
      cels: [
        6009, 6009, 6109, 6109, 6109, 6209, 6209, 6209, 6209, 6209, 6209, 6209,
      ],
      hold: 1,
      from: "0x4728e0 tag 0",
    },
    health: 50,
    hitSound: FOE_SFX.eyeballHit,
    deathSound: FOE_SFX.eyeballDeath,
    // `0x43de23` claims the bar with 0x32c8; `0x43e99a` pays 0x50
    panel: { health: 50, plate: 13000, award: 80 },
    // `0x42f850(obj, 0)` at `0x43dd43`, and `obj+0xa = -5` on top of it
    floats: true,
    counts: true,
    bleeds: true,
    vanishes: true,
    from: "0x435a30 / 0x43dd00 / 0x43dde0 / 0x43e8b0",
  },
  /**
   * And what shares the sewer with them — `initox` with 600 health, the most of
   * anything this port has built. Creator `0x435c70`, class `0x43f1e0`, think
   * `0x43f2a0`, hit `0x43f9a0`.
   *
   * Two of them, one in the tube room and one in the second hall, and each one
   * stands in a territory that contains a `switch`. **It throws them the other
   * way.** `0x43f736` calls `0x436820(lever, 1)` — the direction that answers a
   * lit lever and puts it out — after closing to within `0x89` pixels in BOTH
   * axes, which is the only reach test in the game that tests the height as well
   * as the distance. So level seven's two big ones spend their time shutting the
   * doors you have opened.
   *
   * Its other habit is worth the note: `0x472ff0` tag 0 is a charge on the same
   * twelve cels as its walk carrying `dx 280` against the walk's 85, which over
   * a divisor of 13 is 323 pixels a second — faster than the player can run.
   *
   * A blow is not certain to move it. `0x43fa7e` rolls `0x434540(3)` and does
   * nothing at all on a 1; on a 2 or a 3 it rolls again for which of the three
   * takes of `0x473098`, and plays 47, 48 or 49 to match the take it picked.
   */
  initox: {
    gait: {
      cels: [5090, 5091, 5092, 5093, 5094, 5095],
      hold: 1,
      dx: [85, 85, 85, 85, 85, 85],
      from: "0x472e88 tag 0",
    },
    // `mov word ptr [esi+0xe], 0xd` at `0x43f1fb`
    divisor: 13,
    flinch: [
      {
        cels: [5160, 5161, 5162, 5163, 5164],
        hold: 1,
        dx: [85, 85, 85, 85, 0],
        from: "0x473098 tag 0",
      },
      {
        cels: [5170, 5171, 5172, 5173, 5174, 5175],
        hold: 1,
        dx: [85, 85, 105, 0, 0, 0],
        from: "0x473098 tag 1",
      },
      {
        cels: [5120, 5121, 5122, 5123, 5124, 5123, 5122, 5121, 5120],
        hold: 1,
        dx: [85, 85, 105, 0, 0, 0, 0, 0, 0],
        from: "0x473098 tag 2",
      },
    ],
    // `0x43fa8d`: `0x434540(3) - 1`, a flat one of the three
    pick: () => Math.floor(Math.random() * 3),
    death: {
      cels: [5190, 5190, 5191, 5192, 5193, 5194, 5194, 5195],
      hold: 2,
      from: "0x4732d8 tag 0",
    },
    lever: {
      dir: 1,
      anim: {
        cels: [5170, 5171, 5172, 5173, 5174, 5175],
        hold: 1,
        from: "0x472ff0 tag 1",
      },
      // `0x43f723` installs the reach and `0x43f73c` throws on the same frame
      at: 0,
      // `cmp eax, 0x89` at `0x43f706` and again at `0x43f71c`
      reachPx: 137,
      // `0x43f6b3` — the one it makes as it goes
      sound: [0x32],
      from: "0x43f6f4 / 0x43f70d / 0x43f73c",
    },
    health: 600,
    hitSound: FOE_SFX.oxHit,
    deathSound: FOE_SFX.oxDeath,
    // `0x43f300` claims the bar with 0x32ce and 0x258; `0x43fa36` pays 0x140
    panel: { health: 600, plate: 13006, award: 320 },
    counts: true,
    bleeds: true,
    vanishes: true,
    from: "0x435c70 / 0x43f1e0 / 0x43f2a0 / 0x43f9a0",
  },
  /**
   * What chapter two ends on — `initkragg`, and there is exactly one of it, in
   * level eight, in a room 1845 pixels wide with nothing else in it. Creator
   * `0x436180`, setup `0x441bd0`, think `0x440ab0`, hit `0x441cf0`.
   *
   * It is not built like anything else in the game. There is no class descriptor
   * and no instance struct: the object is made once at `0x441bd0` and kept in a
   * global at `0x4a6ff8`, its health lives in another global at `0x4a75c8`, and
   * `initkragg`'s "creator" does not create at all — `0x436180` takes the thing
   * that already exists, moves it onto the record's point, and installs its idle.
   * Which is why the level's spawner calls it **once** rather than once a record.
   *
   * **A thousand health**, a divisor of fifty — the slowest thing here — no
   * gravity, and `0x42f870(obj, 1)`, so it is the census; and level eight's share
   * is the one that stores zero, which means the goal does not come until it is
   * dead. It also pays **nothing**: there is no `0x40d450` anywhere in its code.
   *
   * Its takes are sorted by one number. `0x441ea4`: a blow under `0x2d` picks a
   * random one of the three single cels of `0x473a28`, and `0x2d` or over gets
   * the six-cel `0x473a48` tag 3. A blow landed while it is in the air (kind 8)
   * uses the same threshold for tags 4 and 3 of the same script.
   *
   * And there is a third kind of blow it knows about. `0x441d30` tests the
   * hitter's strength for exactly **-9** before it tests anything else, and
   * answers with a script of its own — twenty-six frames of `0x473a88` — and an
   * extra sound. Minus nine is the flare, and level eight is the level that
   * places a `statflaregun` and a `statflare` to throw at it.
   *
   * What is not here is its state machine, which is three thousand bytes at
   * `0x440ab0` and includes the one thing that makes the room a fight: standing
   * over one of the seven `initsprinkler` positions and sending it up
   * ({@link file://./props.ts}).
   */
  initkragg: {
    // `0x473840` — one cel, five frames, and it does not travel
    gait: { cels: [7040], hold: 5, from: "0x473840 tag 0" },
    // `mov word ptr [ecx+0xe], 0x32` at `0x441c1a`
    divisor: 50,
    flinch: [
      { cels: [7062], hold: 3, from: "0x473a28 tag 0" },
      { cels: [7061], hold: 3, from: "0x473a28 tag 1" },
      { cels: [7063], hold: 3, from: "0x473a28 tag 2" },
      // `0x473a48` tag 3 — the one a blow of 0x2d or more earns
      {
        cels: [7090, 7093, 7091, 7094, 7092, 7095],
        hold: 2,
        from: "0x473a48 tag 3",
      },
    ],
    // `0x441ea4` / `0x441e67`: the threshold is 0x2d, and under it the three are
    // picked with `0x434540(3) - 1`
    pick: ({ damage }) => (damage >= 45 ? 3 : Math.floor(Math.random() * 3)),
    // `0x473b60` tag 0, and tag 1 carries `dy -150` twice as it goes up
    death: { cels: [7033, 7034, 7035, 7036], hold: 1, from: "0x473b60 tag 0" },
    /**
     * Its state machine, as far as `0x440ab0`'s first two states carry it.
     *
     * The prologue hovers it — see {@link Foe.drives.bob} — turns it round when
     * the player is behind (`0x440db6` tests the brain's own `dx` for a
     * negative), and then sorts what to do by the band the player is in:
     *
     * ```
     *   band 0   over 250 forward    0x473850, and it closes
     *   band 1   150 … 250           0x4738a8, with 0x15, and only from one side
     *   band 2   80 … 150            over two thirds health: 0x473900
     *                                under:                  0x473950
     *   band 3   80 or under         hurt at all:            0x473950
     * ```
     *
     * `0x473950` is the dive, and the dive is what turns the water on: whichever
     * `initsprinkler` rect it ends up inside goes up. Standing in one costs it
     * **three health a frame** (`0x440bf9`) — so the room is a fight you win by
     * making it stand in its own sprinklers.
     */
    rallies: {
      fall: {
        cels: [7033, 7034, 7035, 7036],
        hold: 1,
        kind: 10,
        tag: 0,
        from: "0x473b60 tag 0",
      },
      rise: { cels: [7104], hold: 3, kind: 11, tag: 0, from: "0x473ba8 tag 0" },
      health: 1000,
      from: "0x441e4a / 0x441747 / 0x441787",
    },
    drives: {
      // the idle its creator installs, and what it holds between decisions
      hover: { cels: [7040], hold: 5, from: "0x473840 tag 0" },
      // `0x473850` tag 0 — two cels and a stride on the second
      charge: {
        cels: [7041, 7042],
        hold: 2,
        dx: [0, 120],
        from: "0x473850 tag 0",
      },
      // `0x473950` tag 0..3 — the dive, and `dy -25` on sixteen of its frames
      rush: {
        cels: [7040, 7041, 7042, 7043, 7044, 7045, 7046, 7047],
        hold: 2,
        from: "0x473950",
      },
      // `0x473900` — what it does at the middle band while it is still strong
      combo: {
        cels: [7041, 7042, 7043, 7051, 7052, 7053, 7053, 7054, 7055],
        hold: 2,
        from: "0x473900",
      },
      land: { cels: [7040], hold: 5, from: "0x473840 tag 0" },
      melee: {
        cels: [7041, 7042, 7043, 7051, 7052, 7053, 7053, 7054, 7055],
        hold: 2,
        from: "0x473900",
      },
      // `0x4738a8` — the long one, ten frames at three
      antiAir: {
        cels: [7080, 7081, 7082, 7083, 7084, 7085, 7086, 7085, 7086, 7085],
        hold: 3,
        from: "0x4738a8",
      },
      homeX: 0,
      decisions: 0,
      // `0x473dc8`'s last threshold
      nearPx: 80,
      homePx: 0,
      bands: [250, 150, 80],
      bob: {
        offset: 35,
        slack: 10,
        near: [-5, 5],
        far: [-9, 9],
        from: "0x473dd0 … 0x473ddc, driven at 0x440ce6",
      },
      raises: "rush",
      from: "0x440ab0 / 0x441adc / 0x473dc8",
    },
    health: 1000,
    hitSound: FOE_SFX.kraggHit,
    // `0x440acf` claims the bar with 0x3332 and 0x3e8; nothing pays for it
    panel: { health: 1000, plate: 13106, award: 0 },
    // `0x42f850(obj, 0)` at `0x441c6d`
    floats: true,
    counts: true,
    bleeds: true,
    vanishes: true,
    /**
     * `0x441d30` — the FIRST thing its handler asks, and the arm costs it no
     * health: it plays `0x13`, throws a spark, installs `0x473a88` and returns
     * at `0x441d94` before any damage is computed. `0x473a88` is state 9, and
     * state 9 is the whole tactic of level eight — see `kraggReacts` in
     * {@link file://./brains/kragg.ts}.
     *
     * The twenty-six frames below are the script's five tags run end to end,
     * because that is what `0x441584` and `0x4415df` do with them: tag 0 hands
     * to tag 1 and each of 1..3 hands to the next, and only tag 4's ending
     * puts the boss back on `0x473840` — the hover, which is this page's
     * `gait`. So a flinch that runs out and hands back IS the executable's own
     * path, and nothing here needs to install anything.
     */
    burns: {
      anim: {
        cels: [
          7060, 7061, 7062, 7063, 7064,
          7065, 7066, 7067, 7068,
          7030, 7030, 7030, 7065, 7066, 7067, 7068,
          7031, 7031, 7031, 7065, 7066, 7067, 7068,
          7032, 7032, 7032,
        ],
        hold: 2,
        from: "0x473a88 tags 0..4",
      },
      from: "0x441d30",
    },
    from: "0x436180 / 0x441bd0 / 0x440ab0 / 0x441cf0",
  },
  /**
   * The Coke machine — `initcoke`, five of them down level five's arcade, and
   * `mall.snd` names the sound it makes: index 32 is "#0120 coke mach[ine]".
   * Creator `0x4365f0`, class `0x43b500`, frame `0x43b5d0`, hit `0x43b630`.
   *
   * It is furniture you punch, and it holds exactly four cans. `0x43b6ab` sorts
   * the blow into three: under 30 it rocks on 8501/8502 and nothing else; from 30
   * to 75 it rocks harder and counts, and every third counted blow pops a can
   * (`0x43b6f5`); over 75 it bursts through 8550..8558 and throws **all** the cans
   * it has left at once (`0x43b74f`). Weak hits still count toward the next one.
   *
   * **What stops it is its art, not a number.** It has no health word at all: cels
   * 8500..8504 carry a body box and 8505 — the emptied machine — does not, so
   * `0x4303b6` stops offering it as a victim the moment it shows that cel. The
   * same trick is the player's own invulnerability while staggering.
   *
   * The cans are their own object (cels 8600..8614): each arcs out, lands, and
   * makes a type-2 pickup through `0x45af60` — worth a hundred and fifty
   * health at `0x428868`. `CAN` in {@link file://./props.ts} has the rest, and
   * {@link Foe.shakes} is what shakes them loose.
   */
  initcoke: {
    gait: { cels: [8500], hold: 1, dx: [0], from: "0x474e10 tag 0" },
    // `0x43b51b`: forty-five, and it never moves anyway
    divisor: 45,
    flinch: [
      { cels: [8501, 8502], hold: 1, from: "0x474e70 tag 0" },
      { cels: [8501, 8502, 8504, 8504, 8503], hold: 1, from: "0x474e70 tag 2" },
      // 8505 is the emptied machine, and it carries no body box: once it is
      // showing, nothing can hit it again
      { cels: [8505], hold: 1, terminal: true, from: "0x474e10 tag 1" },
      // ...and `0x43b6d3`, the one blow big enough to open it in a single go:
      // nine cels of it coming apart, and every can it has left at once
      {
        cels: [8550, 8551, 8552, 8553, 8554, 8555, 8556, 8557, 8558],
        hold: 1,
        terminal: true,
        from: "0x474e10 tag 2",
      },
    ],
    /**
     * `0x43b6ab`'s three bands, with the fourth can as the end of it. Twelve is
     * this page's arithmetic rather than the disc's — four cans at three counted
     * blows each — because the engine keeps the can count and the blow count in
     * its own context and this page keeps only the blows.
     */
    pick: ({ damage, hits }) =>
      damage >= 75 ? 3 : hits >= 12 ? 2 : damage < 30 ? 0 : 1,
    /** `0x43b6f5` / `0x43b71a` / `0x43b6d3` — every third counted blow, four of them */
    shakes: { counts: 30, every: 3, holds: 4, bursts: 75, from: "0x43b6ab" },
    rooted: true,
    health: Infinity,
    hitSound: FOE_SFX.cokeHit,
    counts: false,
    from: "0x4365f0 / 0x43b500 / 0x43b5d0 / 0x43b630",
  },
  /**
   * The dog, and `woods.snd` calls it a **wolfy**. Creator `0x450f60`, class
   * `0x454b00`, hit `0x4550b0`.
   *
   * Ten health, and the only enemy in the chapter with a real repertoire: the AI
   * at `0x454be0` measures the distance to the player against its own five bands
   * (`0x478240` = 1200, 650, 410, 320, 180) and picks a state from them — a trot
   * past 650 (`0x478038`, dx 110), the walk below that (`0x477fe0`, dx 65), a
   * LEAP at 180..410 (`0x478108`, whose middle records carry `dx 160, dy -80`
   * twice — it leaves the ground), and inside 180 a flat-out CHARGE
   * (`0x478070`, eighteen records of dx 150, with `obj+0x26` set to 0 so it
   * barges through instead of being shouldered aside). A gap of more than 150
   * pixels in height gets the high pounce instead (`0x4781b0`, `dy -160`). Left
   * alone it sniffs and barks on a one-in-five roll (`0x454d8f`), and a blow
   * turns it round and makes it bolt (`0x454ffa`).
   *
   * None of that is here. This port's foes walk their territory and nothing more,
   * because nothing in this port hits the player back yet — the same reason the
   * thrower does not throw. What is here is the gait, the flinch, the death and
   * the numbers, all of them the disc's.
   *
   * It has **no name plate and no bar** (`0x40d1c0` is never called from any of
   * its functions) and it is **not in the census** (`0x42f870` likewise), so six
   * dogs in WOODS change nobody's quota — but it pays 200 (`0x4551f7`), which is
   * more than the thrower's 50.
   */
  initdog: {
    gait: {
      cels: [4800, 4801, 4802, 4803, 4804, 4805, 4806, 4807, 4808, 4809],
      hold: 2,
      dx: [65, 65, 65, 65, 65, 65, 65, 65, 65, 65],
      from: "0x477fe0 tag 0",
    },
    // `0x454b20`: the lowest in the chapter after the rat's seven
    divisor: 10,
    // `0x4781f8` — ONE cel held four frames, and no pick behind it: `0x4551c3`
    // tests the health and nothing else
    flinch: [{ cels: [4820], hold: 4, from: "0x4781f8 tag 0" }],
    death: {
      cels: [4850, 4851, 4852, 4853, 4854, 4855],
      hold: 1,
      from: "0x478208 tag 0",
    },
    health: 10,
    hitSound: FOE_SFX.dogHit,
    deathSound: FOE_SFX.dogDeath,
    // `0x4551f7`: `0x40d450(0xc8)`, with no bar to go with it
    award: 200,
    counts: false,
    bleeds: true,
    vanishes: true,
    /**
     * `0x4550d3` — the only one of the eight that plays a sound of its own as
     * it catches: `0x4550eb` is `0x40ef30(0x4a7910, 0x18, point)`, out of the
     * PLAYER's bank rather than the chapter's. Then `0x478208` tag 0, six
     * cels, and none of them carries a strike box either.
     */
    burns: {
      anim: { cels: [4850, 4851, 4852, 4853, 4854, 4855], hold: 1, from: "0x478208 tag 0" },
      sound: 0x18,
      from: "0x4550d3",
    },
    from: "0x450f60 / 0x454b00 / 0x454be0 / 0x4550b0",
  },
  /**
   * The thrower. Creator `0x450bf0`, class `0x452310`, hit `0x452960`.
   *
   * WOODS is the first level with one, and it is the first enemy in this port
   * that fights at RANGE: `0x452b20` is a projectile creator of its own, which
   * copies the thrower's facing, works the arc out of the height difference to
   * the player through `0x434630` (a square root) and lets fly — once straight
   * (`0x4527fd`), and from the far state a fan of six flatter ones as a counter
   * cycles 0..5 (`0x452851`). The thing thrown is cels 6004..6006 and it bursts
   * into 7000..7005. None of that is here: nothing in this port hits the player
   * back yet, so a thrown rock would be scenery. The cels are in the book and
   * the addresses are above for when one can.
   *
   * Its flinch pick is the punk's, one branch shorter — there is no knockdown for
   * a heavy blow, because there is no fourth flinch to knock it into.
   */
  initwerec: {
    gait: {
      cels: [5090, 5091, 5092, 5093, 5094, 5095],
      hold: 2,
      dx: [75, 75, 75, 75, 75, 75],
      from: "0x4778e0 tag 0",
    },
    divisor: 20,
    // 0x477a48, three tags of one cel each, held four frames — the same shape as
    // the punk's 0x4774f8
    flinch: [
      { cels: [6040], hold: 4, from: "0x477a48 tag 0" },
      { cels: [6041], hold: 4, from: "0x477a48 tag 1" },
      { cels: [6042], hold: 4, from: "0x477a48 tag 2" },
    ],
    // 0x452a87..0x452ae3, and the punk's 0x44f21e is the same four comparisons
    pick: ({ dy, facingAway }) =>
      dy > 50 ? 0 : dy >= 30 && !facingAway ? 2 : 1,
    death: {
      cels: [6030, 6031, 6032, 6033, 6034, 6035, 6036, 6037],
      hold: 3,
      from: "0x477a78 tag 0",
    },
    health: 180,
    // `0x4529ee`: `0x434540(4) + 0x23`, the same four takes the punks use
    hitSound: FOE_SFX.punkHit,
    // `0x452a18` — and it is the punk's death sound too
    deathSound: FOE_SFX.wereaDeath,
    // `0x452420`: the bar is claimed with plate 0x32cc and `obj+0x3c` is 0x32
    panel: { health: 180, plate: 13004, award: 50 },
    counts: true,
    bleeds: true,
    vanishes: true,
    /**
     * `0x45296e` — the first thing its handler tests, and the arm costs it no
     * health at all: it lights itself with `0x44ff20` and installs `0x477a68`,
     * ONE cel at five engine frames a cel, then answers 1 before any of the
     * arithmetic runs. Those five frames are the death throw, and what happens
     * in them is `werecReacts` in {@link file://./brains/werec.ts}.
     */
    burns: {
      anim: { cels: [6040], hold: 5, from: "0x477a68 tag 0" },
      fatal: true,
      from: "0x45296e",
    },
    from: "0x450bf0 / 0x452310 / 0x4523d0 / 0x452960",
  },
  /**
   * The husk. Creator `0x450cb0`, class `0x454330`, hit `0x454790`.
   *
   * The biggest thing in the chapter and the strangest: **it dies in three blows
   * of any size and a punk climbs out of it**. Its creator never calls the
   * difficulty scaler — it writes the literal 3 into its state (`0x450d1c`) — and
   * its hit handler fetches the damage only to hand to the blood and then does
   * `dec word ptr [eax]` (`0x454821`). Then the first tag of its death calls
   * `0x450a50`, the punk's own creator, at its own position (`0x454690`).
   *
   * It has no flinch at all: the class's jump table has no flinch state, and the
   * one script that holds flinch cels (`0x477b80`, which is the PUNK's 1970..1972)
   * is referenced by nothing. A blow gets a sound and blood and nothing else.
   *
   * It is also immune to its own kind and to one other (`0x4547e1` and
   * `0x454804` filter the blow by its owner's class), it carries a drag and a
   * restitution nothing else in the chapter has (`0x45436a`, `0x454378`), and it
   * pays no award of its own — the punk it hatches carries the 300.
   */
  initwered: {
    gait: {
      cels: [4870, 4871, 4872, 4873],
      hold: 1,
      dx: [190, 190, 190, 190],
      from: "0x477ae0 tag 0",
    },
    divisor: 20,
    /**
     * 0x477ba0, its four tags run together: it falls (4890, 4891), the punk comes
     * out of it (4900, whose record carries dx 190 and dy −140 — the only lift in
     * either class), and the husk sinks (4905..4911).
     */
    death: {
      cels: [
        4890, 4891, 4900, 4901, 4902, 4903, 4904, 4905, 4906, 4907, 4908, 4909,
        4910, 4911,
      ],
      hold: 2,
      from: "0x477ba0 tags 0..3",
    },
    hatches: { kind: "initwerea", afterCels: 2, from: "0x454690" },
    oneHitEach: true,
    health: 3,
    // `0x454828` — one index, and no random pick behind it
    hitSound: FOE_SFX.weredHit,
    deathSound: FOE_SFX.weredDeath,
    // `0x454465`: plate 0x32cb, bar scaled to 0x64, and `obj+0x3c` is never written
    panel: { health: 100, plate: 13003, award: 0 },
    counts: true,
    bleeds: true,
    vanishes: true,
    /**
     * `0x4547b3` — the odd one out of the eight. It lights itself, writes 1
     * into `AI+0x14` and zeroes the caller's own word, and then **falls
     * through into the ordinary damage arithmetic** instead of answering 1.
     * So a husk is the one thing that both catches fire and takes the hit, and
     * it installs no script of its own while it burns.
     */
    burns: { andHurts: true, from: "0x4547b3" },
    from: "0x450cb0 / 0x454330 / 0x454410 / 0x454790",
  },
  /**
   * The rat. Creator `0x4509b0`, class `0x44df70`, hit `0x44e3f0`.
   *
   * **One blow and it is punted.** Its hit handler is the shortest in the game
   * and it has no health test: it fetches the blow, sprays, plays sound 12, and
   * installs `0x477090` — nine cels at one frame each in which the rat flips over
   * and is launched end over end, its tail whipping, the last of them 259 pixels
   * tall. Then it is gone. Its creator does store 200 health through `0x40e300`
   * and nothing ever subtracts from it.
   *
   * It never claims the panel's bar (`0x44e010` has no `0x40d1c0` call), never
   * pays an award, and never calls `0x42f870(obj, 1)`, so it is not part of any
   * level's quota. Vermin, worth nothing, killable by looking at it.
   *
   * Its divisor is **7**, the second-lowest in the chapter, so `0x476ff0`'s run
   * carries it at 85/7 = 12 pixels a frame — 182 a second, faster than the player
   * walks. That is the animation used here, and it is the recognisable rat: cels
   * 3025 down to 3020, side-on, tail out.
   *
   * Its creator installs a different one, `0x476f48` tag 0, which is cel 3011 —
   * and 3011 is a 54x102 near-black shape with no rat visible in it. Whatever
   * that state is (in shadow, in a hole, about to emerge), a page that draws it on
   * a dark street draws nothing at all, which is exactly what happened when this
   * table tried to be literal about it. The run is what a rat in STREETS looks
   * like.
   *
   * **It cannot be punched.** Cel 3020's collision box is `y -14..21` and the
   * punch's fist box is `y -40..-16`: the two miss each other by two pixels, and
   * the standing kick's boot at `y -6..18` is aimed at a standing man's midriff.
   * What reaches a rat is the duck-kick — S+K, cel 724, whose box is `y 38..83`,
   * a boot along the ground. The boxes are authored, so that is design and not
   * arithmetic: things on the floor need a low attack.
   *
   * Its nine records are 20x20 markers rather than territories — the same size as
   * every `stat*` pickup — so what it patrols is 20 pixels of street and where it
   * would really go is in the AI nothing has read.
   */
  initrat: {
    gait: {
      cels: [3025, 3024, 3023, 3022, 3021, 3020],
      hold: 1,
      dx: [85, 85, 85, 85, 85, 85],
      from: "0x476ff0 tag 0",
    },
    divisor: 7,
    death: {
      cels: [3040, 3041, 3042, 3043, 3044, 3045, 3046, 3047, 3048],
      hold: 1,
      from: "0x477090 tag 0",
    },
    frail: true,
    health: 200,
    // `0x44e423` — one blow of any size, and this is the sound of it
    hitSound: FOE_SFX.rat,
    counts: false,
    bleeds: true,
    from: "0x4509b0 / 0x44df70 / 0x44e010 / 0x44e3f0",
  },
  /**
   * The mailbox. Creator `0x451110`, class `0x44fd40`, hit `0x44fe80`.
   *
   * Furniture with a hit handler and two outcomes, both of them by SPEED. A blow
   * under 10 does nothing at all. Between 10 and 54 — a punch, at 47 — it plays
   * cel 2411 and then springs back to 2410: a dent that does not last. At 55 or
   * over — a kick, at 55 — it plays 2410, 2411, 2412, 2413 and **stays on 2413**,
   * which is the mailbox lying on its side; `0x44fe10` sets `obj+0x18 = 2` when
   * that animation ends and the hit handler will not touch it again.
   *
   * Anchored, those four cels are a topple: the anchor sits near the top of the
   * box in all of them, the art swings from 93 pixels below it to 58, and the
   * width spreads from `-38..35` to `-55..46`. Its divisor is 7 — the heaviest in
   * the chapter — and nothing in its own scripts moves it, so the fall is all in
   * the art.
   */
  initmailbox: {
    gait: { cels: [2410], hold: 1, from: "0x4787a8 tag 1 frame 0" },
    divisor: 7,
    flinch: [
      { cels: [2411], hold: 1, from: "0x4787a8 tag 0" },
      {
        cels: [2410, 2411, 2412, 2413],
        hold: 1,
        terminal: true,
        from: "0x4787a8 tag 1",
      },
    ],
    // 0x44fec4: under 10 does nothing at all, under 55 dents, else crumples
    pick: ({ damage }) => (damage >= 55 ? 1 : 0),
    flies: true,
    health: Infinity,
    // `0x44feea` — the same sound whether it dents or goes over
    hitSound: FOE_SFX.mailbox,
    counts: false,
    from: "0x451110 / 0x44fd40 / 0x44fe80",
  },
  /**
   * The hydrant, and it is a VALVE being turned rather than a thing being beaten
   * in. Creator `0x44fc70`, class `0x44fa60`, hit `0x44fbd0`.
   *
   * Three blows and it bursts, and the handler is a switch on the state it is
   * already in rather than on the damage: tag 0 goes to 1, 1 to 2, 2 to 3, and
   * nothing after. Cels 9700 to 9703 say what those stages are — the black bar
   * across the cap swings round a quarter turn per hit, so what a kick does to a
   * hydrant is open it.
   *
   * What happens when the third one's frame finishes is the thing this page had
   * wrong. `0x44fb20`, its own frame function, does not put the water on the
   * hydrant:
   *
   * ```
   *   0x44fb55  if (tag == 3 && ended)
   *   0x44fb77     x += (facing == 1 ? 25 : -25)      the water's own place
   *   0x44fb81     0x44fc70(point, facing, 1)         a SECOND object, on tag 4
   *   0x44fb94     0x40ef30(0x4a7910, 4, point)       and the sound of it
   *   0x44fba4     0x45d090(this, 0x477d30, 0)        and this one is tag 0 again
   *   0x44fbb4  if (tag == 4 && ended) return 1       the water, once played, goes
   * ```
   *
   * So the hydrant is whole again the moment it bursts — cel 9700, the valve shut,
   * ready to be turned three more times — and the water is its own object twenty
   * five pixels to the side which sprays once and is removed. The jet cels grow
   * from 35x17 to 510x96 across ten frames and carry no collision box at all,
   * which is the format's way of saying nothing can touch it; six of them do carry
   * a STRIKE box, so in the original the water knocks things about, and that is
   * not wired here.
   *
   * It also refuses to be hit by another hydrant: `0x44fc40` walks its own class
   * list looking for the striker, which is the only guard of its kind found so
   * far.
   */
  inithydrant: {
    gait: { cels: [9700], hold: 1, from: "0x477d30 tag 0" },
    divisor: 10,
    flinch: [
      { cels: [9701], hold: 1, from: "0x477d30 tag 1" },
      { cels: [9702], hold: 1, from: "0x477d30 tag 2" },
      { cels: [9703], hold: 1, from: "0x477d30 tag 3" },
    ],
    progressive: true,
    rooted: true,
    burst: {
      // the whole of tag 4, which ends on 9806 9807 rather than stopping at 9806
      anim: {
        cels: [9800, 9801, 9802, 9803, 9804, 9805, 9806, 9807, 9806, 9807],
        hold: 1,
        from: "0x477d30 tag 4",
      },
      dx: 25,
      // `0x44fb94`, played on the frame the water object is created
      sound: FOE_SFX.hydrant,
      from: "0x44fb77",
    },
    facesByParam: true,
    health: Infinity,
    counts: false,
    from: "0x44fc70 / 0x44fa60 / 0x44fb20 / 0x44fbd0",
  },
  /**
   * CHAPTER THREE opens here, and its population is one creature repeated.
   * Creator `0x41eee0`, class `0x420260`, think `0x420330`, hit `0x4209f0`.
   *
   * Twenty-four of them across two levels — sixteen in GRAVE and eight in
   * CAVERN — and they are the biggest ordinary thing the game has put in front
   * of the player so far: **a hundred health** against chapter two's gang of 25
   * and 40, a divisor of 10 against their 7, and **310 points** for one, which
   * is more than the masked one's 220.
   *
   * Its own blow strength is a hundred as well (`0x4202a4`), the same number the
   * flare carries — so a zombie hits as hard as the chapter's gun.
   *
   * Eight scripts, one per state, and the kinds are the states the way they are
   * everywhere in this engine: `0x470078` is the one dormant cel, `0x470088` the
   * idle and its fidget, `0x470110` the walk, `0x470180` and `0x4701e0` two
   * attacks, `0x470148` a fifth thing, `0x470248` the flinches and `0x470270`
   * the death. What this port drives is the same set it drives for every other
   * creature: dormant until the player's point is inside the record's rect
   * (`0x4203b3`), then a patrol, a flinch and a death.
   */
  initzomb: {
    // `0x470110` tag 0 — six cels at TWO frames each, dx 65
    gait: {
      cels: [1800, 1801, 1802, 1803, 1804, 1805],
      hold: 2,
      dx: [65, 65, 65, 65, 65, 65],
      from: "0x470110 tag 0",
    },
    // `0x420280` — the slowest divisor in the game outside a boss
    divisor: 10,
    // `0x470248` tags 0, 1 and 2 at FOUR frames a cel, rolled `0x434540(3)`
    flinch: [
      { cels: [1860], hold: 4, from: "0x470248 tag 0" },
      { cels: [1861], hold: 4, from: "0x470248 tag 1" },
      { cels: [1862], hold: 4, from: "0x470248 tag 2" },
    ],
    // `0x470270` tag 0 — three cels at three frames each
    death: { cels: [1863, 1864, 1865], hold: 3, from: "0x470270 tag 0" },
    // `0x4203b3`: it stands on the creator's own single cel until the player's
    // point is inside its record's rect, and then `0x470088` takes over
    wake: { cel: 1800, from: "0x4203a6 / 0x420294" },
    // `0x41ef34` — `0x40e300(0xc8)`, which is `n - (n/2) * difficulty` and so
    // two hundred at the shipped setting. `obj+0x3c`'s 0x64 is not this: the
    // hit handler subtracts from `user+0` (`0x420a55`) and the panel is claimed
    // with the same pair (`0x420388`).
    health: 200,
    hitSound: FOE_SFX.zombHit,
    deathSound: FOE_SFX.zombDeath,
    // `0x420abf` pays 0x136
    panel: { health: 200, plate: 13200, award: 310 },
    counts: true,
    bleeds: true,
    vanishes: true,
    from: "0x41eee0 / 0x420260 / 0x420330 / 0x4209f0",
  },
  /**
   * The bat — `initbat`, forty-five of them across CAVERN, RAVECAVE and TOWER,
   * and the only flying thing in the game that is not a boss. Creator
   * `0x41ead0`, class `0x422e10`, think `0x422ef0`, hit `0x4232f0`.
   *
   * Its divisor is **1**, the lowest in the game — every other creature divides
   * its script's dx by 7, 10, 13 or 20 and the bat divides by nothing. What
   * saves it from being a blur is that its dx is 3 and 4 rather than 60 and 120.
   *
   * And it is FRAIL in the engine's own sense: `0x4232f0` has no subtraction in
   * it anywhere. It sprays sixty, plays `0012 bat hit`, installs `0x46f140` and
   * pays seventy points. One blow, whatever the blow. It does not count towards
   * the level's census either — `0x41ead0` never calls `0x42f870`.
   */
  initbat: {
    // `0x46f060` tag 0 — four cels, dx 3, through a divisor of one
    gait: {
      cels: [2200, 2201, 2202, 2203],
      hold: 1,
      dx: [3, 3, 3, 3],
      from: "0x46f060 tag 0",
    },
    divisor: 1,
    floats: true,
    // `0x422f18` and `0x422f26` — the clamp, both ways, and nothing else
    chases: { px: 0x1b, from: "0x422f12" },
    // `0x422f50` — the record's rect is what wakes it, not what holds it
    wake: { cel: 2206, from: "0x422e45 / 0x422f50" },
    flinch: [{ cels: [2205], hold: 4, from: "0x46f140 tag 0" }],
    death: { cels: [2205, 2206], hold: 4, from: "0x46f140 tag 0" },
    health: 1,
    frail: true,
    hitSound: FOE_SFX.batDeath,
    panel: { health: 1, plate: 13201, award: 70 },
    counts: false,
    bleeds: true,
    vanishes: true,
    from: "0x41ead0 / 0x422e10 / 0x422ef0 / 0x4232f0",
  },
  /**
   * GHENGIS — `initghengis`, five in CAVERN and three in TOWER. Creator
   * `0x41ea20`, class `0x4225f0`, think `0x422680`, hit `0x422ad0`.
   *
   * Two hundred health, four hundred points, a divisor of 13, and a walk that
   * comes in two speeds: `0x46ee60` tag 0 at dx 85 and tag 1 at 170 for the
   * first half of the cycle. It swallows a blow strength of exactly −4
   * (`0x422b52`), which is the second class in the game with a code in its
   * ignore test.
   */
  initghengis: {
    gait: {
      cels: [400, 401, 402, 403, 404, 405],
      hold: 2,
      dx: [85, 85, 85, 85, 85, 85],
      from: "0x46ee60 tag 0",
    },
    divisor: 13,
    // `0x46eee0` tag 0, kind 4 — nine cels, one frame each
    flinch: [
      {
        cels: [470, 471, 472, 473, 474, 475, 476, 477, 478],
        hold: 1,
        from: "0x46eee0 tag 0",
      },
    ],
    // `0x46efe0` tag 0, kind 9 — and it changes row half way down
    death: {
      cels: [430, 431, 432, 433, 434, 440, 441, 442, 443, 444, 445],
      hold: 1,
      from: "0x46efe0 tag 0",
    },
    // `0x46ed80` tag 0 — one cel, and the think installs it before anything
    wake: { cel: 420, from: "0x46ed80 tag 0" },
    health: 200,
    hitSound: FOE_SFX.ghengisHit,
    deathSound: FOE_SFX.ghengisDeath,
    panel: { health: 200, plate: 13202, award: 400 },
    counts: true,
    bleeds: true,
    vanishes: true,
    from: "0x41ea20 / 0x4225f0 / 0x422680 / 0x422ad0",
  },
  /**
   * The skeleton — `initskel`, six in CAVERN and four in TOWER. Creator
   * `0x41ed70`, class `0x4233e0`, think `0x4234b0`, hit `0x423a30`.
   *
   * Two hundred health and **450 points**, the most any ordinary creature in the
   * game is worth. Nine scripts, and two of them carry a leap in their own
   * records: `0x46fbc0` tag 0 has `1273` at dy −650 and `0x46fcf0` tag 0 has
   * `1265` at dx 170, dy −420 — so both its jump and the blow that knocks it
   * over are authored in the animation rather than applied to it.
   */
  initskel: {
    gait: {
      cels: [1200, 1201, 1202, 1203, 1204, 1205],
      hold: 2,
      dx: [65, 65, 65, 65, 65, 65],
      from: "0x46fac0 tag 0",
    },
    divisor: 13,
    // `0x46fcf0` tag 0, kind 6 — and its last record carries the throw
    flinch: [
      {
        cels: [1260, 1261, 1262, 1263, 1263, 1263, 1264, 1265],
        hold: 2,
        from: "0x46fcf0 tag 0",
      },
    ],
    // `0x46fd90` tag 0, kind 8, three frames a cel
    death: {
      cels: [1350, 1351, 1352, 1353, 1354, 1355, 1356, 1357, 1358, 1359],
      hold: 3,
      from: "0x46fd90 tag 0",
    },
    // `0x46fab0` tag 0 — the one cel the creator stands it on
    wake: { cel: 1200, from: "0x42340f / 0x46fab0 tag 0" },
    health: 200,
    hitSound: FOE_SFX.skelHit,
    panel: { health: 200, plate: 13203, award: 450 },
    counts: true,
    bleeds: true,
    vanishes: true,
    from: "0x41ed70 / 0x4233e0 / 0x4234b0 / 0x423a30",
  },
  /**
   * IGOR — `initigor`, three of them and all three in RAVECAVE. Creator
   * `0x41ee40`, class `0x425180`, think `0x425230`, hit `0x4256d0`.
   *
   * Two hundred health, 350 points, divisor 10, and a gait whose second half
   * carries dx 55. What is peculiar about it is `0x46fea0`, a script whose
   * `ticksPerFrame` is **zero** and every one of whose five records carries a
   * NEGATIVE dx — 3104 back to 3100 at −110, −55, −110, −55, −110. It is the
   * same five cels as the walk, run backwards and travelling backwards: Igor
   * retreats along its own footprints.
   */
  initigor: {
    // `0x46fe20` tag 0, kind 2 — the first record carries no stride
    gait: {
      cels: [3100, 3101, 3102, 3103, 3104],
      hold: 2,
      dx: [0, 55, 55, 55, 55],
      from: "0x46fe20 tag 0",
    },
    divisor: 10,
    // `0x46ff30` tag 0, kind 7 — and its second cel is held three frames
    flinch: [
      {
        cels: [3120, 3121, 3121, 3121, 3122, 3123],
        hold: 2,
        from: "0x46ff30 tag 0",
      },
    ],
    // `0x46ff98` tag 1, kind 5
    death: {
      cels: [3140, 3141, 3142, 3143, 3144, 3145],
      hold: 1,
      from: "0x46ff98 tag 1",
    },
    // `0x46fe10` tag 0 — one cel, which is what the class stands it on
    wake: { cel: 3100, from: "0x4251a7 / 0x46fe10 tag 0" },
    health: 200,
    panel: { health: 200, plate: 13204, award: 350 },
    counts: true,
    bleeds: true,
    vanishes: true,
    from: "0x41ee40 / 0x425180 / 0x425230 / 0x4256d0",
  },
  /**
   * The WRAITH — `initwraith`, and there is exactly one in the game, at
   * RAVECAVE's own x13043. Creator `0x41ec80`, class `0x424730`, think
   * `0x424800`, hit `0x424f80`.
   *
   * Seven hundred health (`0x40e300(0x2bc)`), a shove weight of 4, gravity zero
   * — and **no award at all**: `0x424f80` has no call to `0x40d450` anywhere in
   * it. Nothing else in the game is worth nothing, and the reason is the level:
   * chapter three's third stage asks for no kills (`0x4218ca` stores the whole
   * census as the allowance), so what beating this opens is the way out rather
   * than a number.
   *
   * Its own creator files cel `0x9c4` — 2500 — and there is no cel 2500 in
   * RAVECAVE.SBK. The think installs `0x46f6c8` before anything is drawn, so
   * what the level actually shows is the 3200s, and 2500 is a leftover.
   */
  initwraith: {
    // `0x46f6c8` tag 1 — nine cels, dx 20 falling to 10 half way through
    gait: {
      cels: [3250, 3251, 3252, 3253, 3252, 3253, 3252, 3251, 3250],
      hold: 2,
      dx: [20, 20, 20, 10, 10, 10, 10, 10, 10],
      from: "0x46f6c8 tag 1",
    },
    divisor: 10,
    floats: true,
    // `0x46f8a8` tag 0, kind 8
    flinch: [
      {
        cels: [3200, 3201, 3202, 3203, 3204, 3205, 3206, 3207, 3208],
        hold: 2,
        from: "0x46f8a8 tag 0",
      },
    ],
    // `0x46f898` tag 0, kind 7 — one cel at four frames, and that is all of it
    death: { cels: [3243], hold: 4, from: "0x46f898 tag 0" },
    // `0x46f6c8` tag 0 — the hover, which is the walk with its strides removed
    wake: { cel: 3250, from: "0x46f6c8 tag 0" },
    health: 700,
    hitSound: FOE_SFX.wraithHit,
    deathSound: FOE_SFX.wraithDeath,
    panel: { health: 700, plate: 13205, award: 0 },
    counts: true,
    bleeds: true,
    vanishes: true,
    /**
     * ...and it has a machine of its own, which this page fought without.
     *
     * `0x424800` reads the same TRACKER the claw uses (`0x45efd0` on `user+0xe`)
     * and dispatches kind 1 on the band index against `0x46f8f8`:
     *
     * ```
     *   bc 02  e6 00  82 00  3c 00  00 00      ; 700, 230, 130, 60
     * ```
     *
     * Four thresholds, so five bands, and `0x424f1c` sorts them into four
     * behaviours: over 230 it closes, 130..230 and 60..130 are where it fights,
     * and inside 60 it simply hangs there (`0x424c07` installs the standing
     * hover and nothing else).
     *
     * What it does when it fights is picked by `0x434540` out of the moves
     * below, and the one that matters is the BEAM: `0x424d77` calls
     * `0x41f6b0(self, 0)` — the scepter's own fire function, variant 0, the one
     * that spends no rounds. The thing you take the scepter from in this level
     * casts it at you first.
     *
     * It does NOT carry a code, and that took a measurement to settle. `0x424c54`
     * is the first instruction of its kinds 2 and 3 and it writes -3, which read
     * like the grab — but `0x4248a9` is the function's ONLY exit and its third
     * instruction is `mov word ptr [esi+0x1a], 0x64`. Every path writes a
     * hundred back on the way out, so both of the -3 writes are dead in the
     * shipped binary and the wraith hits like everything else.
     *
     * What caught it was building the grab first: two hundred and sixty kicks
     * took nothing off it, because a wraith that grabs on contact locks the
     * player out of fighting entirely.
     */
    haunts: {
      /** `0x46f8f8` — the tracker's own thresholds, biggest first */
      bands: [700, 230, 130, 60],
      /** `0x46f698` — what it does on being woken, five cels and then it fights */
      rouse: {
        cels: [3260, 3261, 3262, 3263, 3264],
        hold: 2,
        from: "0x46f698 tag 0",
      },
      /** `0x46f6c8` tag 0 — hanging still, which is all it does inside 60px */
      hover: {
        cels: [3250, 3251, 3252, 3253, 3252, 3253, 3252, 3251, 3250],
        hold: 2,
        from: "0x46f6c8 tag 0",
      },
      /** `0x46f7e0` — up, held, and down again */
      rise: {
        cels: [3220, 3221, 3222, 3223, 3224, 3225, 3225],
        hold: 1,
        from: "0x46f7e0 tag 0",
      },
      held: { cels: [3225], hold: 1, from: "0x46f7e0 tag 1" },
      sink: {
        cels: [3225, 3225, 3224, 3223, 3222, 3221, 3220],
        hold: 1,
        from: "0x46f7e0 tag 2",
      },
      /** `0x46f790` tag 0 — the cast, and `0x424d77` is what comes out of it */
      cast: {
        cels: [3210, 3211, 3212, 3213, 3214, 3215],
        hold: 2,
        from: "0x46f790 tag 0",
      },
      /** `0x46f760` and `0x46f860` — the two it throws in between */
      lunge: {
        cels: [3240, 3241, 3242, 3243, 3244],
        hold: 3,
        from: "0x46f760 tag 0",
      },
      sweep: {
        cels: [3230, 3231, 3232, 3233, 3234, 3235],
        hold: 2,
        from: "0x46f860 tag 0",
      },
      from: "0x424800, bands 0x46f8f8, beam 0x41f6b0",
    },
    from: "0x41ec80 / 0x424730 / 0x424800 / 0x424f80",
  },
  /**
   * The BISHOP — `initvpriest` in the records and `bishop` in the sound bank,
   * which is `belfry.snd`'s own name for it (`0060 bishopchar[ge]`,
   * `0064 bishopthro[w]`, `0067 bishop die`). One of them, at TOWER's x17602,
   * standing on the goal. Creator `0x41eb70`, class `0x425bc0`, think
   * `0x425c90`, hit `0x4264f0`.
   *
   * **Twelve hundred health** — `0x40e300(0x4b0)`, the same number the player
   * has — and, like the wraith, no award at all. Chapter three's fourth stage
   * asks for no kills either (`0x4218d9`), so this is the last thing standing
   * between the player and the end of the chapter and it pays in exit.
   *
   * Gravity zero and a divisor of 10. Its attacks are `0x46f1c0`: tag 0 is
   * twelve cels of 2600s, tag 1 three records carrying dx −30, −20, −10 — a
   * recoil authored into the animation — and tag 2 sixteen cels of 2650s.
   */
  initvpriest: {
    /**
     * Its own machine — `0x425c90`, which this page fought without.
     *
     * The same tracker again (`0x45efd0` on `user+0x10`), banded against
     * `0x46f4c0` — `dc 00 aa 00 64 00 00 00`, so 220, 170 and 100. Kind 0 is
     * dormant until the player's point is in its rect (`0x434200`), and then:
     *
     * ```
     *   425e56  band 1        -> 0x434540(10) < 3 or nothing at all
     *   425e64  band 2 or 3   -> always considers
     *   425e8c  0x434540(0x2a) <= 13 -> tag 2, the sixteen cels
     *                          else  -> tag 0, the throw
     * ```
     *
     * So it commits on three in ten at the far band and always inside 170, and
     * then the sweep is thirteen in forty-two against the throw. The throw's
     * follow-through is kind 2, whose tag 1 carries dx -30, -20, -10 — the
     * recoil is authored into the animation rather than applied to it.
     */
    preaches: {
      bands: [220, 170, 100],
      throw_: {
        cels: [
          2600, 2601, 2602, 2603, 2604, 2605, 2606, 2607, 2608, 2609, 2610,
          2611, 2610, 2611,
        ],
        hold: 1,
        from: "0x46f1c0 tag 0",
      },
      recoil: {
        cels: [2612, 2613, 2614],
        hold: 1,
        dx: [-30, -20, -10],
        from: "0x46f1c0 tag 1",
      },
      sweep: {
        cels: [
          2650, 2651, 2652, 2653, 2654, 2655, 2656, 2657, 2658, 2657, 2656,
          2655, 2654, 2652, 2652, 2653,
        ],
        hold: 1,
        from: "0x46f1c0 tag 2",
      },
      settle: {
        cels: [2654, 2653, 2654, 2653],
        hold: 1,
        from: "0x46f1c0 tag 3",
      },
      farOdds: [3, 10],
      sweepOdds: [13, 42],
      wakeSound: 0x1d,
      from: "0x425c90, bands 0x46f4c0",
    },
    // `0x46f170` tag 0, kind 1 — nine cels, two frames each, and no stride in
    // any of them: it travels on its velocity
    gait: {
      cels: [2500, 2501, 2502, 2503, 2504, 2505, 2506, 2507, 2508],
      hold: 2,
      from: "0x46f170 tag 0",
    },
    divisor: 10,
    floats: true,
    /**
     * `0x46f2f0` kind 3 — one cel at THREE frames, and which of the two is
     * `0x434540(2) - 1`. Index 2 is not a flinch at all: it is the VANISH,
     * `0x46f308` kind 4, which `0x4264f0` sends it to for a blow big enough.
     *
     * Both of those were wrong here. The page had the death script's own
     * first eight frames as the flinch and the VANISH as the death — see the
     * kind table in {@link file://./brains/vpriest.ts}, which had it right all
     * along: `0x46f308` is the state the bishop comes BACK from, and the one
     * path in the whole function that answers 1 is kind 6.
     */
    flinch: [
      { cels: [2640], hold: 3, from: "0x46f2f0 tag 0" },
      { cels: [2641], hold: 3, from: "0x46f2f0 tag 1" },
      {
        cels: [
          2670, 2671, 2672, 2673, 2674, 2675, 2676, 2677, 2678, 2679, 2680,
          2681,
        ],
        hold: 1,
        from: "0x46f308 tag 0",
      },
    ],
    /**
     * `0x426620` / `0x426633` — half of what it last took, and the bar rises
     * with every blow that clears it. Under that, one of the two single cels.
     */
    pick: ({ damage }, e) => {
      const bar = e.nerve ?? e.max;
      if (damage >= bar / 2) {
        e.nerve = damage;
        return 2;
      }
      return Math.floor(Math.random() * 2);
    },
    /**
     * `0x46f3d8` kind 6 — sixteen frames of 2640/2641 guttering and then the
     * twelve of the dissolve. The one path that answers 1.
     */
    death: {
      cels: [
        2640, 2640, 2641, 2641, 2640, 2640, 2641, 2641, 2640, 2640, 2641, 2641,
        2640, 2640, 2641, 2641, 2670, 2671, 2672, 2673, 2674, 2675, 2676, 2677,
        2678, 2679, 2680, 2681,
      ],
      hold: 1,
      from: "0x46f3d8 tag 0",
    },
    // `0x46f160` tag 0 — the one cel the creator stands it on
    wake: { cel: 2500, from: "0x425be3 / 0x46f160 tag 0" },
    health: 1200,
    hitSound: FOE_SFX.priestHit,
    deathSound: FOE_SFX.priestDeath,
    panel: { health: 1200, plate: 13206, award: 0 },
    counts: true,
    bleeds: true,
    vanishes: true,
    from: "0x41eb70 / 0x425bc0 / 0x425c90 / 0x4264f0",
  },
  /**
   * CHAPTER FOUR opens with the TCop — `initcop` in the records, and `lab.snd`
   * calls it that outright: `#0084 TCop Dies`, `#0085 TCop eats`, and three
   * `#0087..#0089 TCop punc[h]`es. Creator `0x411660`, class `0x413f00`, think
   * `0x413fd0`, hit `0x4147d0`.
   *
   * Nineteen of them, seven in MAZE and twelve in BARREL. **250 health and 550
   * points** — the most any creature outside a boss is worth, past the
   * skeleton's 450 — a divisor of 13 and a shove weight of 3.
   *
   * It has eleven scripts and two of them are the same walk in reverse:
   * `0x46c720` tag 0 is 2100..2105 at dx 65 and tag 1 is 2105..2100 at −195,
   * −130, −65, −65, −65, −65. It backs away faster than it comes on.
   *
   * And it dies two ways: `0x4148ed` tests `obj+0x32`, the accumulated fall, and
   * a cop killed off the ground gets `0x46c8f0` tag 3 instead of `0x46c9a8`.
   */
  initcop: {
    /**
     * ...and it works the LEVERS. `0x414664` is inside the cop's own think: it
     * walks to a switch, and inside ten pixels calls `0x412550(point, 0)` —
     * which finds the `initswitch` at that point and hands its tag 3 to tag 0,
     * the throw up. Level thirteen's cage doors are opened by its guards, the
     * way level six's showers are turned on by its gang.
     */
    lever: {
      dir: 0,
      anim: { cels: [2170, 2171, 2171, 2171], hold: 2, from: "0x46c888 tag 2" },
      at: 3,
      reachPx: 10,
      sound: [],
      from: "0x414644 / 0x414664 / 0x412550",
    },
    gait: {
      cels: [2100, 2101, 2102, 2103, 2104, 2105],
      hold: 2,
      dx: [65, 65, 65, 65, 65, 65],
      from: "0x46c720 tag 0",
    },
    divisor: 13,
    // `0x46c828` tag 0, kind 8
    flinch: [{ cels: [2250, 2251], hold: 2, from: "0x46c828 tag 0" }],
    // `0x46c9a8` tag 0, kind 11 — the one it gets standing up
    death: {
      cels: [2190, 2191, 2192, 2193, 2194],
      hold: 2,
      from: "0x46c9a8 tag 0",
    },
    // `0x413f40` — the cel the creator stands it on
    wake: { cel: 2100, from: "0x413f40 / 0x46c628 tag 0" },
    // `0x4116b5` — `0x40e300(0xfa)`
    health: 250,
    hitSound: FOE_SFX.copHit,
    deathSound: FOE_SFX.copDeath,
    // `0x41490d` pays 0x226
    panel: { health: 250, plate: 13301, award: 550 },
    counts: true,
    bleeds: true,
    vanishes: true,
    from: "0x411660 / 0x413f00 / 0x413fd0 / 0x4147d0",
  },
  /**
   * The SLURP — `initslurp`, twenty of them and all twenty in MAZE. Creator
   * `0x411a20`, class `0x414a00`, think `0x414ae0`, hit `0x415100`.
   *
   * One cel. `0x46d268`, `0x46d278` and `0x46d458` are three different scripts
   * of three different kinds and every record in all of them is **2550**, so
   * whatever state it is in it looks the same.
   *
   * Sixty health, no gravity, and `0x414a36` gives it `obj+0xa = 0xfffb` — a
   * standing vertical velocity of **−5**, so it drifts upward from the moment it
   * is made. It pays nothing: `0x415100` has no `0x40d450` in it. It counts
   * towards the census all the same, and twenty of MAZE's twenty-seven are these.
   */
  initslurp: {
    gait: { cels: [2550], hold: 1, from: "0x46d268 tag 0" },
    divisor: 8,
    floats: true,
    flinch: [{ cels: [2550], hold: 1, from: "0x46d278 tag 0" }],
    death: { cels: [2550], hold: 1, from: "0x46d458 tag 0" },
    // `0x411a74` — `0x40e300(0x3c)`
    health: 60,
    // `0x414b21` claims the bar with plate 0x33f4
    panel: { health: 60, plate: 13300, award: 0 },
    counts: true,
    bleeds: true,
    vanishes: true,
    from: "0x411a20 / 0x414a00 / 0x414ae0 / 0x415100",
  },
  /**
   * PUKE BOY — `initpuke`, six of them and all six in LAB, and `lab.snd` names
   * it: `#0061 Pukeboy d[ies]`, `#0062 Pukeboy p[unched]`. Creator `0x411710`,
   * class `0x417e20`, think `0x417ed0`, hit `0x418250`.
   *
   * Four hundred health, 440 points, a divisor of 13, and **three gaits**: a
   * walk at dx 93 (`0x46ca30`) and a run whose eight records carry 186, 93,
   * 186, 93, 279, 93, 279, 93 (`0x46cac0` tag 0). Nothing else in the game
   * alternates its stride like that — it lurches.
   */
  initpuke: {
    gait: {
      cels: [3000, 3001, 3002, 3003, 3004],
      hold: 1,
      dx: [93, 93, 93, 93, 93],
      from: "0x46ca30 tag 0",
    },
    divisor: 13,
    // `0x46cb50` tag 0, kind 5 — seven records, the first held three frames
    flinch: [
      {
        cels: [3034, 3034, 3034, 3033, 3032, 3031, 3030],
        hold: 1,
        from: "0x46cb50 tag 0",
      },
    ],
    // `0x46cbe0` tag 0, kind 6
    death: {
      cels: [3080, 3081, 3082, 3083, 3084, 3085],
      hold: 2,
      from: "0x46cbe0 tag 0",
    },
    // `0x46c9f8` tag 0 — the six it stands on before anything happens
    wake: { cel: 3090, from: "0x417e40 / 0x46c9f8 tag 0" },
    // `0x411753` — `0x40e300(0x190)`
    health: 400,
    hitSound: FOE_SFX.pukeHit,
    deathSound: FOE_SFX.pukeDeath,
    // `0x418335` pays 0x1b8
    panel: { health: 400, plate: 13302, award: 440 },
    counts: true,
    bleeds: true,
    vanishes: true,
    from: "0x411710 / 0x417e20 / 0x417ed0 / 0x418250",
  },
  /**
   * The ARM — `initarm`, ten of them, all in LAB. `lab.snd` calls it
   * `#2013 arm hit`, `#2016 armhits g[round]`, `#2019 arm crawl`. Creator
   * `0x4118f0`, class `0x418710`, think `0x4187a0`, hit `0x418b40`.
   *
   * It has no health at all — `0x418b40` sprays, sounds, installs `0x46d0b0`
   * and pays 113, with nothing subtracted anywhere. One blow, whatever the blow,
   * the way a bat is. It does not count towards the census either.
   *
   * Its own leap is in the animation: `0x46d120` tag 0's seventh record carries
   * `dx 200, dy -200` and its death's first carries `dy -130`.
   */
  initarm: {
    // `0x46cf10` tag 0, kind 0 — seven cels, three frames each, out and back
    gait: {
      cels: [500, 501, 502, 503, 502, 501, 500],
      hold: 3,
      from: "0x46cf10 tag 0",
    },
    divisor: 13,
    flinch: [{ cels: [3360, 3361], hold: 3, from: "0x46cfc8 tag 0" }],
    // `0x46d0b0` tag 0, kind 8 — and the first record throws it 130 up
    death: {
      cels: [3390, 3391, 3392, 3393, 3394, 3395],
      hold: 3,
      from: "0x46d0b0 tag 0",
    },
    health: 1,
    frail: true,
    hitSound: FOE_SFX.armHit,
    // `0x418bc3` pays 0x71
    panel: { health: 1, plate: 13303, award: 113 },
    counts: false,
    bleeds: true,
    vanishes: true,
    from: "0x4118f0 / 0x418710 / 0x4187a0 / 0x418b40",
  },
  /**
   * The TEST TUBE — `inittube`, and there is one in the game, in LAB. Creator
   * `0x411ba0`, class `0x419220`, think `0x4192c0`, hit `0x419990`. `lab.snd`
   * 0x19 is `#0201 test tube`.
   *
   * **Twelve hundred health** — the player's own number, and the third thing in
   * the game to carry it after TOWER's bishop — a shove weight of 6, and it pays
   * NOTHING: `0x419990` has no `0x40d450` in it. It counts towards LAB's census
   * of seven, so what it is worth is the level.
   *
   * It stands on one cel: `0x46d790` tag 0 is 5350 and its flinch `0x46da20` is
   * 5350 again. Only the death moves.
   */
  inittube: {
    gait: { cels: [5350], hold: 1, from: "0x46d790 tag 0" },
    divisor: 13,
    flinch: [{ cels: [5350], hold: 1, from: "0x46da20 tag 0" }],
    // `0x46da30` tag 0, kind 10
    death: {
      cels: [5440, 5441, 5442, 5443, 5444, 5445],
      hold: 3,
      from: "0x46da30 tag 0",
    },
    // `0x411be4` — `0x40e300(0x4b0)`
    health: 1200,
    hitSound: FOE_SFX.tube,
    panel: { health: 1200, plate: 13304, award: 0 },
    counts: true,
    bleeds: true,
    vanishes: true,
    from: "0x411ba0 / 0x419220 / 0x4192c0 / 0x419990",
  },
};

/** how many engine frames one run of an animation lasts */
export function animFrames(a: FoeAnim): number {
  return a.cels.length * a.hold;
}

/** which cel of a one-shot animation is showing after `frames` engine frames */
export function celAt(a: FoeAnim, frames: number): number {
  const i = Math.min(a.cels.length - 1, Math.floor(frames / a.hold));
  return a.cels[i];
}

/** which cel of a LOOPING animation is showing, and its stride index */
export function loopIndex(a: FoeAnim, frames: number): number {
  return Math.floor(frames / a.hold) % a.cels.length;
}
