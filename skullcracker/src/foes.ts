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
  pick?: (blow: Blow) => number;
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
   * every trigger in this engine uses — and the two animations are the stirring
   * and the climb out of the ground. The dog has the same mechanism (`0x454c13`),
   * which this page does not give it: WOODS' six are awake from the first frame.
   */
  wake?: { stir: FoeAnim; burst: FoeAnim; sound: number; stirSound: number; from: string };
  /**
   * The states its class drives while it is alive and unhurt, beyond standing.
   *
   * Only the boss has one. Its loop is `0x455e87`: hover a frame, decide on the
   * distance to the player, charge or swing, and every so often go home and stand
   * down again. The charge frames carry no strike box at all — they close the
   * distance and nothing else — so the whole of it is honest here even though
   * nothing in this port hits the player back.
   */
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
    from: string;
  };
  /**
   * A blow every so often puts it down instead of making it flinch, and getting
   * up takes its own animation. `0x456496`: the boss counts consecutive hits in
   * `AI+0x12` and the third one knocks it over.
   */
  knockdown?: { anim: FoeAnim; every: number; sound: number; from: string };
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
    gait: { cels: [1900, 1901, 1902, 1903, 1904, 1905, 1906, 1907], hold: 2, dx: [75, 75, 75, 75, 75, 75, 75, 75], from: "0x4774b0 tag 0" },
    divisor: 20,
    // 0x4774f8, three tags of one cel each, held four frames
    flinch: [
      { cels: [1970], hold: 4, from: "0x4774f8 tag 0" },
      { cels: [1971], hold: 4, from: "0x4774f8 tag 1" },
      { cels: [1972], hold: 4, from: "0x4774f8 tag 2" },
      // 0x477580 tag 0 — the knockdown a blow over 50 earns, and it travels
      { cels: [1960, 1961, 1962, 1963], hold: 2, dx: [150, 150, 75, 75], from: "0x477580 tag 0" },
    ],
    // 0x44f1fd..0x44f280, in the order the handler tests
    pick: ({ damage, dy, facingAway }) =>
      damage > 50 ? 3 : dy > 50 ? 0 : dy >= 30 && !facingAway ? 2 : 1,
    death: {
      cels: [1960, 1961, 1962, 1963, 1980, 1981, 1982, 1983, 1984, 1985, 1986, 1987],
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
    gait: { cels: [5000, 5001, 5002, 5003, 5004, 5005], hold: 2, dx: [75, 75, 75, 75, 75, 75], from: "0x477630 tag 0" },
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
      cels: [5060, 5061, 5062, 5063, 5070, 5071, 5072, 5073, 5074, 5075, 5076, 5077],
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
   * What it does while it lives is a real loop and most of it is here. What is
   * NOT here is the fireball: `0x456240` builds a second object of its own class
   * (cels 7010..7015 in flight, 7016..7019 bursting) with a restitution of 0.8 so
   * the low shot bounces, and every frame of it carries a strike box — it is the
   * one attack of the six that exists to hit you, and nothing in this port hits
   * the player back yet. Its two muzzle points and both velocities are at
   * `0x455cc3` and `0x455d01` for when they can be used. The charge, by contrast,
   * carries **no** strike box on any frame: it closes the distance and nothing
   * else, so it is honest to run it.
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
      burst: { cels: [3122, 3123, 3124, 3124, 3123, 3122], hold: 1, from: "0x4782e0 tag 2" },
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
      charge: { cels: [3000, 3001, 3002, 3003, 3004, 3005, 3006], hold: 1, dx: [310, 310, 310, 310, 310, 310, 310], from: "0x4785e8 tag 1" },
      rush: { cels: [3000, 3001, 3002, 3003, 3004, 3005, 3006], hold: 1, dx: [610, 610, 610, 610, 610, 610, 610], from: "0x4785e8 tag 5" },
      combo: { cels: [3060, 3061, 3062, 3063, 3064, 3065, 3066, 3067, 3068], hold: 1, dx: [0, 0, 0, 0, 0, 0, 0, 0, 310], from: "0x4785e8 tag 2" },
      land: { cels: [3092, 3091, 3090], hold: 1, from: "0x4785e8 tag 3" },
      melee: { cels: [3052, 3052, 3053, 3054, 3055], hold: 2, from: "0x478448 tag 0" },
      antiAir: { cels: [3130, 3131, 3132, 3133, 3134], hold: 1, from: "0x4784e8 tag 0" },
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
        then: { cels: [3110, 3100, 3111, 3101, 3112, 3102, 3113], hold: 3, from: "0x478578 tag 0" },
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
        3081, 3080, 3000, 3083, 3083, 3000, 3001, 3000, 3083, 3083, 3000, 3081, 3080, 3070, 3071, 3072, 3073, 3074,
        3140,
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
    from: "0x451050 / 0x455880 / 0x455940 / 0x456310",
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
    gait: { cels: [4800, 4801, 4802, 4803, 4804, 4805, 4806, 4807, 4808, 4809], hold: 2, dx: [65, 65, 65, 65, 65, 65, 65, 65, 65, 65], from: "0x477fe0 tag 0" },
    // `0x454b20`: the lowest in the chapter after the rat's seven
    divisor: 10,
    // `0x4781f8` — ONE cel held four frames, and no pick behind it: `0x4551c3`
    // tests the health and nothing else
    flinch: [{ cels: [4820], hold: 4, from: "0x4781f8 tag 0" }],
    death: { cels: [4850, 4851, 4852, 4853, 4854, 4855], hold: 1, from: "0x478208 tag 0" },
    health: 10,
    hitSound: FOE_SFX.dogHit,
    deathSound: FOE_SFX.dogDeath,
    // `0x4551f7`: `0x40d450(0xc8)`, with no bar to go with it
    award: 200,
    counts: false,
    bleeds: true,
    vanishes: true,
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
    gait: { cels: [5090, 5091, 5092, 5093, 5094, 5095], hold: 2, dx: [75, 75, 75, 75, 75, 75], from: "0x4778e0 tag 0" },
    divisor: 20,
    // 0x477a48, three tags of one cel each, held four frames — the same shape as
    // the punk's 0x4774f8
    flinch: [
      { cels: [6040], hold: 4, from: "0x477a48 tag 0" },
      { cels: [6041], hold: 4, from: "0x477a48 tag 1" },
      { cels: [6042], hold: 4, from: "0x477a48 tag 2" },
    ],
    // 0x452a87..0x452ae3, and the punk's 0x44f21e is the same four comparisons
    pick: ({ dy, facingAway }) => (dy > 50 ? 0 : dy >= 30 && !facingAway ? 2 : 1),
    death: { cels: [6030, 6031, 6032, 6033, 6034, 6035, 6036, 6037], hold: 3, from: "0x477a78 tag 0" },
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
    gait: { cels: [4870, 4871, 4872, 4873], hold: 1, dx: [190, 190, 190, 190], from: "0x477ae0 tag 0" },
    divisor: 20,
    /**
     * 0x477ba0, its four tags run together: it falls (4890, 4891), the punk comes
     * out of it (4900, whose record carries dx 190 and dy −140 — the only lift in
     * either class), and the husk sinks (4905..4911).
     */
    death: {
      cels: [4890, 4891, 4900, 4901, 4902, 4903, 4904, 4905, 4906, 4907, 4908, 4909, 4910, 4911],
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
    gait: { cels: [3025, 3024, 3023, 3022, 3021, 3020], hold: 1, dx: [85, 85, 85, 85, 85, 85], from: "0x476ff0 tag 0" },
    divisor: 7,
    death: { cels: [3040, 3041, 3042, 3043, 3044, 3045, 3046, 3047, 3048], hold: 1, from: "0x477090 tag 0" },
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
      { cels: [2410, 2411, 2412, 2413], hold: 1, terminal: true, from: "0x4787a8 tag 1" },
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
