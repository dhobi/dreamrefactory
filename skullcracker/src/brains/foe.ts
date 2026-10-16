/**
 * What a class IS, as the executable's tables and handlers describe it: its
 * animations ({@link FoeAnim}), the blow its hit handler is handed ({@link Blow})
 * and the record it reads that blow against ({@link Foe}). The table of them,
 * one per `init` name, is `FOES` in {@link file://../foes.ts}.
 *
 * It lives here rather than beside that table so the brains can name a class's
 * animations without importing anything from the game above them: `src` imports
 * `brains`, and nothing in `brains` imports `src`.
 */
import type { Enemy } from "./kit";

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
   * `dy -480` on the frame it leaves the ground — and is absent from every walk,
   * stance and flinch. See
   * {@link file://../fights.ts}.
   */
  dy?: readonly number[];
  /**
   * When this one ends the thing holds its last cel for good and takes no more
   * hits.
   *
   * The Coke machine's emptied cel is the case: 8505 carries no body box, so
   * once it shows nothing can reach it. (The mailbox on its side is NOT: its
   * handler still plays the sound and answers 1 there — see `MAILBOX_DOWN`.)
   */
  terminal?: boolean;
  /**
   * What follows this one when it ends, where a state is two scripts rather than
   * one. The boss of level four is why: its knockdown (`0x478518`, two frames a
   * cel) and the get-up that follows it (`0x478578`, three) are separate scripts
   * with separate rates, and flattening them into one list would play the get-up
   * a third too fast.
   */
  next?: FoeAnim;
  /**
   * What the class's own machine is handed when this reaction ends: installed
   * as its state, script and tag, rather than the gait. The punk's get-up is
   * the case: `0x44ee90` ends `0x477580` tag 2 by installing the taunt,
   * `0x477240` tag 0, and the taunt's own state (`0x44eac2`) decides from there.
   */
  resume?: FoeAnim;
  /**
   * ...or the reaction IS a state of the machine, whose own case decides the
   * moment its script ends: `obj+0x46` is set on the reaction's last frame and
   * that frame's think installs what follows (the wraith's `0x424e05`,
   * Ghengis' `0x422a25`). When this one ends the brain is handed the reaction's
   * own {@link kind} and tag with the script finished and runs on the same
   * frame — no stand-in cel between, which would put the next script a frame
   * late. Needs {@link kind}.
   */
  decides?: boolean;
  /**
   * The script's own KIND — word 4 of its header, what `0x45d090` copies into
   * `obj+0x18`.
   *
   * This is the STATE a class's think function dispatches on, so a class whose
   * machine has been read needs it on every script it installs. `scdis anims
   * <addr>:full` prints it. Absent on the scripts nobody's machine installs by
   * name. See {@link file://./kit.ts}.
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
   * the special one is a blow to the face.
   */
  facingAway: boolean;
  /**
   * The Y of the contact point `0x43041e` hands the handler, and the victim's
   * own `obj+6` Y (its anchor) to weigh it against — `0x41839d` does. Absent
   * for a blow that came with no contact.
   */
  contactY?: number;
  pointY?: number;
  /**
   * ...and the same two along x — the contact's own X against the victim's
   * `obj+8` (the skeleton's back test, `0x423b61`, compares these, not the
   * two facings).
   */
  contactX?: number;
  pointX?: number;
  /** the player's `obj+8`, which kragg's ground snap weighs its own x against (`0x441fd3`) */
  playerX?: number;
}

/**
 * The two words of a creature's own state that {@link Foe.pick} may touch.
 *
 * Structural on purpose: `foes.ts` describes classes and must not depend on
 * the runtime `Enemy` the level runner keeps them in.
 */
export interface FoeState {
  /** `AI+6` on the bishop — the health it had when it last vanished */
  nerve?: number;
  /** its scaled health, which is what that word is seeded from */
  max: number;
  /** what is left of it, the blow already taken off (`0x426593` reads it) */
  hp?: number;
  /** the Coke machine's `AI+0`, cans let go so far, this blow's included (`0x43b71a`) */
  shaken?: number;
  /** `obj+0x18` and `obj+0x44` as the blow found them (`0x420ae1` reads both) */
  script?: number;
  tag?: number;
  /** `obj+0x28` as a facing, +1 east (kragg's ground snap picks its tag by it) */
  facing?: number;
  /** kragg's second bar — the grounded form, whose handler is `0x441ef0` */
  rallied?: boolean;
  /** the record's own parameter — a TCop's `AI+0x32`, the gunner */
  param?: number;
  /** a TCop's `AI+0x30`, the switch-run stage — nonzero once it has started one */
  switchRun?: number;
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
   * What a blow of **−9** does to it — see `FLAME` in {@link file://../props.ts}.
   *
   * −9 is not damage and not one of the player's codes: eight creature classes
   * read it in an arm of their own hit handler, and all but one of those arms
   * start by calling `0x44ff20` to stick a flame on itself. What differs
   * after that is the two arguments it passes and the script it then installs.
   * Kragg's arm (`0x441d30`) is the one that lights nothing — see
   * {@link noFlame}.
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
    /**
     * ...and whether that is the end of it: when `anim` runs out the class
     * dies as it would of a blow — {@link Foe.deathSound}, {@link Foe.death}
     * and the award. `0x4526ef` is the case: werec's state 3 ends in the
     * squeal, the death and `0x40d450(0x104)`.
     */
    fatal?: boolean;
    /**
     * ...and the corpse time THAT death writes, in engine frames, where it is
     * a literal of its own rather than {@link CORPSE_LINGER}'s global: werec's
     * `0x452731` stores `0xc8` into `AI+2`, where its blow death at
     * `0x452a6a` copies `[0x46b204]`.
     */
    linger?: number;
    /**
     * The arm IS the death: nothing of its own plays first, the class goes
     * straight to {@link Foe.death} with its death sound and pays its award on
     * the frame it catches. `0x4550d3` is the case — the dog's arm plays 0x18,
     * installs `0x478208` and calls `0x40d450(0xc8)`, which is its death path
     * at `0x4551c9` word for word, less the subtract.
     */
    dies?: boolean;
    /**
     * Whether the blow ALSO lands as damage. No creature's does: seven of the
     * eight arms answer 1 and are done, and `0x4547b3`, which falls through,
     * falls into `0x4547f2`'s negative-strength test and is thrown away there
     * (see `weredGate`).
     */
    andHurts?: boolean;
    /**
     * The arm calls no `0x44ff20` at all. Kragg's `0x441d30`..`0x441d9f`
     * plays its sounds, throws a spark and installs its thrash, and nothing in
     * the class ever lights a flame on it.
     */
    noFlame?: boolean;
    /**
     * What the arm plays, in order, at the thing it lands on — an array is a
     * random one of them. Kragg's plays its own hit sound, `0x434540(2) + 0x17`
     * (`0x441d41`), and then 0x13 (`0x441d72`).
     */
    sounds?: readonly (number | readonly number[])[];
    /** ...and throws a spark at the contact, `0x4424a0` (`0x441d60`) — see `SPARK` */
    spark?: boolean;
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
   * {@link file://../props.ts}.
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
   * Its hit handler returns 0 even on a blow it takes, so the dispatcher never
   * runs the velocity exchange for it — neither its own velocity nor the
   * hitter's recoil changes.
   *
   * `0x430425` calls the victim's `obj+0x12` and only a nonzero answer reaches
   * `0x43043b call 0x430470`. Nearly every creature's handler ends in
   * `mov ax, 1` on a blow it takes and keeps `xor ax, ax` for the blows it
   * refuses. Two answer 0 on every path: the CHOPPER's `0x454790` (`0x454880`,
   * `0x45488a`), so a CHOPPER killed at its thirty a frame keeps riding the way
   * it was going, and the hydrant's `0x44fbd0`, whose valve turns all end in
   * `xor ax, ax` — a kick to a hydrant does not bounce the kicker off it.
   *
   * A class whose answer depends on its state says so with a test of the
   * object: kragg's handler answers 1 only while `0x441d26` finds it below
   * state 9, the flying form; from there the grounded branch at `0x441ef0`
   * takes the blow off the bar and answers 0 on every way out (`0x441f82`,
   * `0x441fb5`, `0x442004`, `0x442024`).
   */
  noExchange?: boolean | ((e: Enemy) => boolean);
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
   * CHOPPER with a man inside it.
   *
   * `leap` is what the creator does when it is handed a parent, which
   * `0x454690` does (`push esi`, the fourth argument). `0x450afc..0x450b23`:
   *
   * ```
   *   cmp [parent+0x28], 1 ; sbb ecx, ecx ; and ecx, 0x3c ; sub ecx, 0x1e
   *   mov [obj+0xc], cx        ; +30 when the parent faces right, -30 left
   *   mov [obj+0xa], 0xffce    ; -50
   *   mov [obj+0x28], [parent+0x28]
   *   0x45d090(obj, 0x477488, 0)
   * ```
   *
   * So the rider leaves the bike at thirty pixels a frame the way the bike was
   * going, which is the bike's own clamp ({@link speedCap}), and fifty up.
   * It is a constant, not the parent's velocity: the two match because a
   * CHOPPER at speed is at its clamp. The air takes nothing off it
   * (`0x4302a4`), so it carries the thirty until it lands.
   */
  hatches?: {
    kind: string;
    afterCels: number;
    from: string;
    leap?: { vx: number; vy: number; anim: FoeAnim; from: string };
  };
  /**
   * The HEAD it sheds as its death reaches its second tag — `0x4208e0`, see
   * `HEAD` in {@link file://../props.ts}. `mode` is the creator's third
   * argument, which picks the head (0 the zombie's, 1 igor's), and `afterCels`
   * is where in this page's one flat death list that tag begins.
   */
  sheds?: { mode: 0 | 1; afterCels: number; from: string };
  /**
   * The class's own GROUND DRAG, when it is not the allocator's.
   *
   * This is the field that made the CHOPPER a motorcycle, and missing it made
   * it slower than a walk. A script's `dx` is not a speed: `0x42f8b0` divides it
   * by the object's divisor and **adds** it to the velocity (`add word ptr
   * [esp+6], ax`), once a frame, for ever. What stops the sum running away is
   * `0x4302c0`, which on any frame that ended on the ground takes
   * `v * obj+0x1e >> 13` back off. So the speed a thing settles at is its
   * impulse over its drag, not its impulse:
   *
   * ```
   *   allocator  0x42f550   obj+0x1e = 0x1666 = 5734   ->  70% off, x1.43
   *   CHOPPER    0x45436a   0x42f7a0(obj, 0.05f) = 409  ->   5% off, x20
   * ```
   *
   * 8192 is the scale, read as the float at `0x46a108`; the 0x800 restitution
   * beside it comes from `0x42f7f0` against the −8192.0 at `0x46a10c`. The
   * CHOPPER is the only class in chapter one that sets either.
   */
  drag?: number;
  /**
   * What the mover measures the ground under it with: `obj+0x3c` and
   * `obj+0x34`, both zero out of the allocator (`0x42f5a7`, `0x42f5e1`) and set
   * by the class's own init.
   *
   * Every frame `0x42fd80` fills `obj+0x38` and `obj+0x3a` — the left and the
   * right bound {@link BrainCtx.atBound} (`0x456550`) and its rear twin
   * (`0x456590`) measure sixty pixels against:
   *
   * ```
   *   42fe02  obj+0x3c > 0:   0x40bcd0(point, region, 0, obj+0x3c) -> obj+0x38
   *                           0x40bcd0(point, region, 1, obj+0x3c) -> obj+0x3a
   *   42fe4a  obj+0x34 != 0:  each row of the platform table 0x4a69d0 that spans
   *                           the x, reaches below the feet and tops out above
   *                           the floor; the highest one's ends -> 0x38, 0x3a
   * ```
   *
   * `0x40bcd0` walks the region's floor from the point in eight-pixel samples,
   * up to 200 pixels, and stops at the first sample that differs from the last
   * by more than `reach` — a cliff up or down. So `reach` is how big a step the
   * class treats as the end of its ground, and `platforms` is whether a ledge's
   * own ends bound it: a class with neither never has a bound nearer than the
   * zero it was allocated with, and never reads as at one. Nothing else keeps a
   * thing on a ledge; the mover lets anything walk off one.
   */
  span?: { reach: number; platforms: boolean };
  /**
   * A FLOATER whose script `dx` is added into its velocity every frame the cel
   * shows (`0x45d1a3` → `0x42f8b0`) rather than spent as a stride. There is no
   * drag in the air, so it builds until the class's own think clamps it —
   * slurp halves above 30 (`0x414b79`), kragg holds ±40 (`0x440aff`) — and a
   * class sets this only once that clamp is in its brain.
   */
  accrues?: boolean;
  /**
   * Its hit handler plays {@link Foe.hitSound} only on a blow that leaves it
   * standing; the killing one plays the death sound alone. Puke (`0x418362`),
   * ghengis (`0x422c30`), hardcore (`0x43d317`) and the punks all branch that
   * way; a class that plays both leaves this unset.
   */
  quietKill?: boolean;
  /**
   * The engine x its creator writes as its home instead of the record's point.
   * `initwbooly` is the one: `0x4510dd` puts the constant `0x122a` in `AI+0x10`,
   * and `0x455e7c`/`0x4560cd` snap it back onto that, wherever the level placed
   * it. Converted to this page's foot x the same way the record's point is.
   */
  homeAt?: number;
  /**
   * `obj+0x24` in whole pixels a frame²: 10 out of the allocator (`0x42f5ca`)
   * unless the class init calls `0x42f850(obj, f)`, which writes `f × 10`.
   */
  gravity?: number;
  /**
   * `obj+0x10` as its class init leaves it — added to the cel's drawn extent
   * to find where it meets the floor (`0x42fdd7`). The allocator's 0; the rat
   * −13 (`0x44dfa0`), the four gang members −6 (`0x437a95`, `0x4386d5`,
   * `0x4391b5`, `0x439c15`). A state that changes it sets {@link Enemy.floor}.
   */
  floor?: number;
  /**
   * Its creator calls `0x42f850(obj, 0)`: it is made with no gravity and so
   * stays on its record's point, stood on nothing, until its own think turns
   * gravity on. The rat (`0x450a1c`) — a hidden rat sits where the level put
   * it, and `0x44e0ff` lets it drop as it comes out.
   */
  bornWeightless?: boolean;
  /**
   * `obj+0x26`, the shove weight — how hard the body pass `0x430680` pushes this
   * object off anything it overlaps. The allocator leaves it 0 (`0x42f5d0`), and
   * 0 takes no part at all; each class init that wants a body writes its own.
   */
  shove?: number;
  /**
   * `obj+0x20`, the fraction of `obj+0xc` a wall hands back (`0x42ff02`):
   * the allocator's 0x800 = 0.25 unless the class calls `0x42f7f0` (the dog's
   * −0.3 turns it round).
   */
  restitution?: number;
  /**
   * A ceiling its own think puts on `obj+0xc`, in whole pixels an engine frame.
   *
   * The drag is not the only thing holding a speed down: a class whose think
   * function clamps its velocity by hand has the last word, and reading the
   * drag without the clamp is how the CHOPPER first came out at three thousand
   * pixels a second. Its `0x454410` opens with the clamp, before the state
   * switch and before anything else it does:
   *
   * ```
   *   454473  mov ax, word ptr [esi + 0xc]
   *   454477  cmp ax, 0x1e            ; +30
   *   45447d  mov word ptr [esi + 0xc], 0x1e
   *   454485  cmp ax, 0xffe2          ; -30
   *   45448b  mov word ptr [esi + 0xc], 0xffe2
   * ```
   *
   * Thirty a frame is 450 pixels a second — half again the player's run, which
   * is what a motorcycle ought to be. The probe does the same thing at
   * `0x410486` with ±27 ({@link PROBE.maxVx}).
   */
  speedCap?: number;
  /**
   * The death that THROWS the body clear — the CHOPPER's wrecking bike.
   *
   * Four of the seven kinds' deaths are one animation played where the thing
   * stood. This one is not: `0x477ba0` is four tags, and the first frame of tag
   * 1 — cel 4900, the frame `0x454690` hatches FANG on — carries **dx 190, dy
   * -140**, the only motion in either class's death. Through the class's own
   * divisor of 20 (`0x454364`) that is nine and a half pixels forward and seven
   * up, spent as an impulse the way every other script number is, with gravity
   * taking it from there. Then tags 2 and 3 (cels 4904, 4905..4911) are the
   * bike coming down and wrecking — `woods.snd`'s "0550 cycle wrec[k]".
   *
   * Reading the four tags as one flat fourteen-cel animation, which is what this
   * page did, played the whole wreck on the spot: the rider stood up out of a
   * bike that never went anywhere.
   */
  deathThrow?: { dx: number; dy: number; afterCels: number; from: string };
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
   * The dog has the same mechanism (`0x454c13`) in its own brain's state 0: it
   * sits on cel 4800 until the player's point is inside its rect.
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
   * lever off. See {@link file://../props.ts} for what that switches on, and why
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
    /** ...and in height too, for the one class that asks (`0x43f71c`) */
    reachY?: number;
    /** what it goes to the lever on, when that is not its gait */
    run?: FoeAnim;
    /** `0x434540(3) == 1` and then `0x434540(2) + 5`: a one-in-three chance of 5 or 6 */
    sound: readonly number[];
    /**
     * ...and what it says the moment it FINDS one, where it says anything —
     * the batboy's `0x4392d7`, `mall.snd` 0xb through `0x40f090`, as its
     * preamble turns it to the lever and puts the lever script on.
     */
    found?: number;
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
  /**
   * ...or, for a class whose count IS `[0x46b204]` but starts somewhere else
   * than the end of the death script, what to add to it. The global is 50 until
   * the first ox is made and 80 after (`0x435c76`), and SEWER comes before
   * every level these classes live in, so a count baked at 50 is wrong in a
   * run.
   */
  lingerPlus?: number;
  /** what it stood up with — `0x40e300`'s argument in the creator */
  health: number;
  /** the three figures it tells the interface panel, when it claims the bar */
  panel?: {
    health: number;
    plate: number;
    award: number;
    /**
     * ...and when the plate is the creator's draw rather than one number:
     * `plate - 1 + 0x434540(plates)`, one of `plates` consecutive cels per
     * instance, kept in {@link file://./kit.ts}'s `Enemy.plate`
     */
    plates?: number;
  };
  /**
   * A thing whose slide the panel reports — the mailbox, which a kick sends
   * most of a screen. Every class takes `0x430470`'s velocity on every blow
   * (see `knockback` in walk.ts) and keeps it until its own think or the drag
   * spends it; the hydrant, whose `0x44fb20` zeroes both words first thing, is
   * {@link Foe.rooted}.
   */
  flies?: boolean;
  /**
   * What its hit handler plays out of the chapter's bank, as a record index —
   * {@link file://../sound.ts} has the sites and the names. An array is a random
   * one of them, which is what `0x434540` in front of the call means.
   */
  hitSound?: number | readonly number[];
  /** what its death path plays */
  deathSound?: number;
  /**
   * ...and whether it plays it through `0x40f090` — the mixer's channel 0,
   * which takes it whatever it held — rather than `0x40ef30`'s two channels by
   * priority. See `Mixer` in sound.ts.
   */
  deathLead?: boolean;
  /** does it enrol in the level census — `0x42f870(obj, 1)` in its creator */
  counts: boolean;
  /**
   * ...and it stays counted as a corpse. Nothing in the class calls
   * `0x42f870(obj, 0)`, so its census flag outlives the death and the count
   * comes down only as the object is freed (`0x42f750`'s `0x42f778`). Three
   * classes: the eyeball (`0x435a60` enrols, nothing lets go), the ox
   * (`0x435ca7`) and the hardcore (`0x4364a6`) — none of the 45 calls to
   * `0x42f870` falls inside their classes' code.
   */
  countsDead?: boolean;
  /**
   * Does a blow throw goo out of it — whether its hit handler calls `0x40cba0`.
   *
   * The three creatures do (`0x44f12e`, `0x44f90f`, `0x44e411`) and the two pieces
   * of furniture do not: `0x44fe80` and `0x44fbd0` fetch the blow with `0x42f910`,
   * install a dent and play a sound, and never touch the spray. A mailbox does not
   * bleed.
   *
   * `"scatter"` is a handler that hands `0x40cba0` no hitter — `push 0` as its
   * third argument (the hardcore's `0x43d28b`, ghengis' `0x422b73`) — so every
   * gob takes `0x40ce7d`'s random velocity on both axes instead of the blow's.
   * A function is a class whose handler bleeds on one path and not another
   * (kragg sparks in the air and bleeds on the ground).
   */
  bleeds?: boolean | "scatter" | ((e: FoeState) => boolean);
  /**
   * ...and where it does not bleed, whether it SPARKS: `0x4424a0(contact)`
   * in place of `0x40cba0`. Kragg's flying handler is the one — `0x441db8`
   * on every blow its first bar takes; the ground form bleeds (`0x441f1a`).
   * See `SPARK` in {@link file://../effects.ts}.
   */
  sparks?: (e: FoeState) => boolean;
  /**
   * The amount the handler hands `0x40cba0`, when it is a constant rather than
   * the blow — the bat's `push 0x3c` at `0x423313`.
   */
  sprayAmount?: number;
  /**
   * The handler's own velocity write, made BEFORE `0x430470`'s exchange reads
   * the victim's velocity back — pixels an engine frame, and a missing axis is
   * left alone. The bat's `0x423334` (`obj+0xa = -40`) is the case: the
   * exchange weighs that in, so what the body leaves with is the mix of the
   * two, not the -40.
   */
  hitVel?: { vx?: number; vy?: number };
  /**
   * The handler reads no code at all — a −9 is only a strength like any other
   * and goes through the ordinary blow. The bat's `0x4232f0` has no sign test
   * anywhere, so a flare on a stage 5 or the flamer kills one outright.
   */
  codeBlind?: boolean;
  /**
   * Its corpse can still be struck. The dispatcher `0x430350` has no state
   * test — only the body box of the cel on show (`0x4303b3`) — so a class
   * whose handler has none either and whose death cels carry a body takes the
   * whole handler again: goo, sound, the death from its first frame and the
   * award again. Most deaths are drawn without a body and need nothing.
   */
  corpseTakesHits?: boolean;
  /**
   * Its handler falls or dies on a health BELOW zero (`jge` past the death,
   * kragg's `0x441ded` and `0x441f56`) where the others die on zero or less
   * (`jg`, the punk's shape). A blow that leaves exactly nothing is a take.
   */
  survivesZero?: boolean;
  /**
   * The death bounces: `0x42f7f0(obj, f)` on the body, so the floor branch of
   * `0x42ff40` hands back `vy × f` every landing faster than 2 (`0x42ff83`)
   * and sets `obj+0x2c` (`0x42ff8d`), which the death state reads to play
   * `sound` — the hardcore's `0x43d0c5` / `0x43d0d3`.
   */
  corpseBounce?: { restitution: number; sound: number };
  /**
   * The death, when the handler picks between more than one — a gunner TCop
   * dies on a different script (`0x4148ed`). Falls back to {@link death}.
   */
  deathFor?: (e: FoeState) => FoeAnim | undefined;
  /**
   * Its handler does NOT turn its own class away. Most do, and the page skips
   * a blow between two of a kind; the ones listed here have no such test
   * (`0x44e3f0`, `0x44f8b0`, `0x452960`, …), so under `?foehit=1` they hurt
   * each other.
   */
  hitsOwn?: boolean;
  /**
   * What the handler does with a −1, the blaster bolt's strength
   * (`0x412bb1`). `as` rewrites it to a strength and takes the blow — the
   * TCop's `0x4147d9` and the tube's `0x419999`, 100 — and `sound` answers it
   * with a sound at the bolt and nothing else (puke's `0x41825e`). A class
   * without one stops the bolt and takes nothing.
   */
  minusOne?: { as: number } | { sound: number };
  /**
   * Does its body leave a green ball behind — whether its CORPSE state handler
   * calls `0x40cba0(pos, -13, 0)` when `[0x46b204]`'s fifty frames expire.
   *
   * Both punk classes do (`0x44ef7e` and `0x44f848`, each right after `0x42fa80`
   * fetches the body's own rect), and the rat does not: its launch is a different
   * state, which sinks the body out of sight and never frees it. See {@link VANISH} in
   * {@link file://../effects.ts} for the eleven cels.
   */
  vanishes?: boolean;
  /**
   * ...and it leaves its BOARD behind — `0x438450`, see `SKATEBOARD`.
   *
   * All four of the gang carry one: `0x4383d9` drops it out of `initknotboy`'s
   * hit handler, `0x43a6f9` out of `initknifeboy`'s, `0x43908e` out of
   * `initmaskboy`'s and `0x439af9` out of `initbatboy`'s, each on the frame the
   * thing dies and nowhere else.
   */
  drops?: "skateboard";
  /** the four functions above, for whoever checks this */
  from: string;
}
