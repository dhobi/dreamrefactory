/**
 * The big one — `initwbooly`, `0x455940`, PLAYGR's boss and the only thing in
 * that level that is not a dog.
 *
 * ## Its twelve scripts, and therefore its twelve states
 *
 * `0x45d090` copies word 4 of a script's header into `obj+0x18`, so the kinds
 * below ARE the alphabet of `0x4561cc`'s twelve-entry jump table. Every one was
 * walked out of the class's own data region, `0x4782e0` through `0x478780`
 * (headers are `{i16 count, i16 ticksPerFrame, i16 kind}` and each script is
 * padded up to a four-byte boundary, which is why walking them without the
 * alignment step loses kinds 7 and 9):
 *
 * ```
 *   0  0x4782e0  tag 0 the statue, tag 1 the stir, tag 2 climbing out
 *   1  0x478340  standing — and the state that DECIDES at range
 *   2  0x4786e0  the two fireball throws (tag 2 is never installed)
 *   3  0x478448  the low swipe
 *   4  0x4784e8  the overhead swat
 *   5  0x4785e8  the whole melee phase: crouch, walk, swing, rise, stance, run
 *   6  0x478478  the roar
 *   7  0x478518  the knockdown, tag 0 forwards and tag 1 backwards
 *   8  0x478578  the get-up that follows each of those
 *   9  0x478358  the two flinches
 *  10  0x4784b0  what it does while the player is down
 *  11  0x478370  the death, and then the burning wreck for ever
 * ```
 *
 * ## The shape of the fight, which is two halves and one counter
 *
 * `AI+4` is the whole rhythm. State 1 — kind 1, the stance — is the RANGED
 * half: it re-decides every frame, counts a beat down and throws a fireball,
 * and `0x455d4f` adds one to `AI+4` for each throw. The frame `AI+4` passes six
 * (`0x455b15`) it bellows, seeds `AI+4` with ten and installs kind 5 tag 0 —
 * and kind 5 is the MELEE half, where `0x455eae` spends one of those ten on
 * every pass through the stance. When they run out it turns towards its own
 * home point, runs back to it, and kind 5 tag 3 hands to kind 1 with `AI+4` at
 * zero. So: seven fireballs, a charge, ten decisions of walking and swinging,
 * and back out to throw again.
 *
 * ## What this module owns, and what it does not
 *
 * States 0 to 6 and 10 are the ones it is in while it is on its feet, and those
 * are here. 7, 8, 9 and 11 are the hit reactions, driven by the page's own
 * {@link Foe.flinch} / {@link Foe.pick} / {@link Foe.knockdown} /
 * {@link Foe.death} path — a brain is never called during them. They are named
 * at {@link NOT_HERE} together with the things they do that the page's own
 * path does not, because state 9 in particular hands back into the MELEE loop
 * rather than to standing and that is a behaviour, not an animation.
 */
import {
  install,
  type Brain,
  type BrainCtx,
  type CastCode,
  type CastKit,
  type Enemy,
} from "./kit";
import type { Foe } from "../foes";

/**
 * The hit-reaction states, and what the executable does in them that the page's
 * own flinch path does not. Read, not done — the page owns those animations.
 *
 * The router is `0x456310`, the class's damage handler (`0x4558a8` hangs it on
 * `obj+0x12`), and it is worth reading whole because three of its four exits
 * pick a script by the state the thing was ALREADY in:
 *
 * - **death**, `0x4563f2`: `obj+0x18 == 5` — struck during the melee half —
 *   takes kind 11 **tag 0**; struck anywhere else it goes straight to tag 1.
 *   But `0x45610f` installs tag 1 on the first frame state 11 thinks, with no
 *   `obj+0x46` test, so tag 0's seven frames are cut to one — the page's
 *   {@link Foe.death}, tags 1 and 2 run together, is what shows.
 * - **11 tag 2**, `0x456171`: the burning wreck is not a corpse that lingers.
 *   It counts `AI+4` down, and each time it reaches zero plays `0x434540(2)-1`
 *   — sound 0 or 1 — at the PLAYER's y through `0x40f090`, then reseeds `AI+4`
 *   with `0x434540(8) + 0xc`. And `0x4561b6` calls `0x42f870(obj, 0)` every
 *   frame, which is what takes it out of the census `0x4502d0` polls: the level
 *   opens as it starts to burn, not when it is removed, because it is never
 *   removed. {@link Foe.linger} `Infinity` is right for that.
 * - **9**, `0x456058`: the small flinch does NOT hand back to standing. Tag 0,
 *   the take it uses when the blow landed in state 5, installs `0x4785e8`
 *   **tag 4** — straight back into the melee stance, with `AI+4` untouched, so
 *   a boss interrupted mid-charge carries on charging. Tag 1, the take it uses
 *   when the blow landed anywhere else, goes to `0x4786e0` tag 0 — the throw.
 *   Neither one is kind 1, and each flinch's `resume` says which. `0x4564dc`
 *   picks between the two takes on `obj+0x18 == 5`, the state — the `pick`.
 * - **7 → 8**, `0x455fde` and `0x456033`: the knockdown hands to the get-up at
 *   the same tag (`0x456016` re-reads `obj+0x44` and passes it straight on) and
 *   the get-up hands to `0x4785e8` tag 4 — the melee stance again, never kind 1.
 * - **`0x456496`**: the third blow landed in the melee half (`AI+0x12`, which
 *   steps only while `obj+0x18 == 5`, `0x456461`) is a knockdown rather than a
 *   flinch, and it zeroes `AI+4` so the get-up goes home. A blow arriving while
 *   it is already in state 2, 8 or 9 takes its health and no reaction at all
 *   (`0x456470`). Both are {@link wboolyGate}.
 */
const NOT_HERE = "0x455fde, 0x456033, 0x456058, 0x4560ed, 0x456310" as const;

/**
 * Three things `0x455940` does that are not behaviour, so that the next reader
 * does not go looking for them in the states below.
 *
 * - **the bar**, `0x45595b`: the preamble claims the on-screen boss bar — band
 *   at least 1, forward distance positive, and the state neither 0 (still a
 *   statue) nor 11 (dead) — with `0x40d1c0(AI+0, 0x40e300(0x320), 0x32d1, pt)`.
 *   `AI+0` is the health word, seeded `0x40e300(0x320)` = 800 at `0x4510ae`,
 *   and 0x32d1 is a plate that lives in PLAYER.SBK. {@link Foe.panel} has it.
 * - **the camera**, `0x430c90`: two calls, and they are a pair. `0x455a1c`
 *   points it at the boss the frame it wakes; `0x455e46`, kind 5 tag 3, points
 *   it back at the player as the melee half ends. Nothing else in the class
 *   moves it.
 * - **the shake**, `0x4307c0(n)`: an amplitude of 2/4/6 for n of 1/2/3.
 *   `0x455e61` shakes on 2 as it comes down at home, and `0x456157` on 3 as the
 *   death's middle section ends.
 */
const NOT_BEHAVIOUR = "0x45595b, 0x430c90, 0x4307c0" as const;

/**
 * The fireball, `0x456240`, and both muzzles.
 *
 * It builds a second object of a class of its own (`[0x4782d8]`, script
 * `0x478250`, cels 7010..7015 in flight and 7016..7019 bursting), gives it a
 * restitution of 0.8 and a friction of 0.25 (`0x42f7f0` / `0x42f7a0` with the
 * floats `0x3f4ccccd` and `0x3e800000`), sets its velocity and then steps it
 * once by that velocity before installing its script.
 *
 * ## It is the only thing in the game that BOUNCES
 *
 * `0x455536`, the class's create, sets a divisor of 6 and a hit handler and
 * nothing else — no `0x42f850`, so it keeps the weight every object is born
 * with (`0x42f5ca` writes `0x24 = 0xa`), which is the same ten pixels a frame²
 * the player falls at. What makes it different is the two words the SPAWNER
 * writes over the birth defaults, and what the mover does with them:
 *
 * ```
 *   456264  0x42f7f0(obj, 0.8f)   ; obj+0x20, through a scale of -8192
 *   456272  0x42f7a0(obj, 0.25f)  ; obj+0x1e, through a scale of +8192
 *   42ff83  eax = obj+0x20 * vy / 8192   ; the flip, on every surface it meets
 *   4302c0  vx  = obj+0x1e * vx / 8192   ; ...and the drag while it is down
 * ```
 *
 * The burst is not a death: `0x45566e` installs `0x478290` when a surface is
 * under it and `0x4556a0` puts the flight straight back when those four cels
 * end, so it bounces along the floor until `0x4555e9` finds it at rest — no
 * horizontal velocity and a vertical one inside ten — and removes it.
 *
 * And it is only dangerous while it is moving. `0x4556d3` wants fifteen pixels
 * a frame in one axis or the other before it writes `obj+0x1a = 0x64`, and
 * writes a zero otherwise, so one that has rolled to a stop at your feet is
 * furniture until it goes out.
 *
 * `0x455cc3` and `0x455d01` are where the two are set up, through the globals
 * `[0x4a7908]`/`[0x4a790a]` (the muzzle, packed y then x) and
 * `[0x4a78d4]`/`[0x4a78d6]` (the velocity, packed vy then vx). `0x4562a8`
 * negates the vx word on the way in, and `0x455ce4`/`0x455d22`'s `sbb` picks
 * its sign off `obj+0x28`, so both come out travelling the way it faces.
 */
const THROW = {
  /** `0x455cc3` — kind 2 tag 0: out of the chest, lobbed, and it bounces */
  high: { dx: -30, dy: -20, vx: 250, vy: 366 },
  /** `0x455d01` — kind 2 tag 1: low and flat, and half again as fast */
  low: { dx: -30, dy: 30, vx: 300, vy: 0 },
  /** `0x455536` — no `0x42f850`, so `0x42f5ca`'s birth weight of ten stands */
  pull: 0xa,
  /** `0x455549`/`0x455542` — cel 7010 out of `[0x4a8400]`, divisor 6 */
  divisor: 6,
  /** `0x456264` — `0x42f7f0(0.8f)`, and the scale behind it flips the sign */
  bounce: 0.8,
  /** `0x456272` — `0x42f7a0(0.25f)`, the frames it spends on a surface */
  friction: 0.25,
  /** `0x4556d3` — slower than this in BOTH axes and it is worth nothing */
  fastBlow: 0xf,
  /** `0x4555e9` — at rest, and `0x455603` answers the removal */
  rest: 0xa,
  /** `0x455700` — a hundred, the same as the bishop's bolt */
  strength: 0x64,
  /** `0x455763` — the one code its own hit handler accepts, and nothing else */
  burns: -9,
  /** `0x4557af` — `0xfff6`, the ten it is sent UP by as it goes out */
  doused: 0xa,
  /** `0x478250` tag 0 is the one launch frame, tag 1 the flight it loops */
  flight: [7010, 7011, 7012, 7013, 7014, 7015],
  /** `0x478290` tag 0 — the bounce, after which `0x4556a0` flies again */
  burst: [7016, 7017, 7018, 7019],
  from: "0x455cc3 / 0x455d01 / 0x456240",
} as const;

/**
 * ...and what a −9 does to one — `0x455730`, the class's own hit handler.
 *
 * `0x45554f` writes it into `obj+0x12` as the object is created, which is the
 * same word every creature's class writes its own handler into and makes the
 * fireball the only thing in the game that is not a creature and still answers
 * a code. Two things carry one: the flamer's flame (`0x453b9b`) and a flare on
 * the fourth level of a chapter (`0x43abfa`) — and PLAYGR is a fourth level, so
 * on this level both of them are −9 and either can put a fireball out.
 *
 * ## Three tests, in this order
 *
 * ```
 *   455751  the record's word 0 is set  -> ax = 0, and nothing happens
 *   455763  the hitter's obj+0x1a != -9 -> the burst arm at 0x4557ba
 *   45576a  obj+0x18 == 2               -> the PINNED arm at 0x455771
 * ```
 *
 * The first is a re-entry guard and it guards everything rather than just the
 * code: one already alight takes no further notice of anything at all, the
 * player's fists included.
 *
 * The flying arm is the one this page can reach, and it is four writes:
 *
 * ```
 *   455791  0x44ff20(self, 1, 0)     ; a LATE flame, so it starts going out
 *   4557a1  word[record] = 1         ; ...and it cannot catch twice
 *   4557a9  word[obj+0xc] = 0        ; the horizontal velocity, dead
 *   4557af  word[obj+0xa] = 0xfff6   ; ...and ten UP
 * ```
 *
 * Which kills it by the class's own rules rather than by a death. Ten is inside
 * `0x4556d3`'s fifteen, so {@link CastKit.fastBlow} makes it harmless from that
 * frame; and a vertical velocity that small on the next surface it meets is
 * `0x4555e9`'s rest test — `obj+0x2e` set, no horizontal velocity and
 * `|obj+0xa| <= 10` — which answers 1 and removes it. A doused fireball hops,
 * drops and is gone, and it cannot hurt anybody on the way down.
 *
 * ## The other two arms, which are read and have nothing here to hang on
 *
 * State 2 is not a fireball anybody threw. `0x450ff0` builds one of this class
 * for every `inittirepile` record a level places — weightless, facing 1, cel
 * 7020, and `0x4556b9` pins it to the record's own point every frame — and THAT
 * is what `0x455771` is for: `0x44ff20(self, 0, 1)` sticks a flame on it that
 * never goes out, it answers 0 so the blow is not even spent, and `0x455781`
 * latches `[0x4782dc]`.
 *
 * The latch is the point of the thing. `0x4562d3` reads it as every fireball is
 * built and lights that one at birth (`0x4562e7` writes its record's word), and
 * `0x4556f6` reads it in the strength gate, where it beats the fifteen: while
 * it is set no fireball on the level is worth its hundred again. Nothing else
 * in the executable writes that word, so burning one of these would disarm the
 * boss's throws for the rest of the level — except that no book in the rip
 * places an `inittirepile`, so the object is never built and the latch is never
 * set in the original either. This page carries neither.
 *
 * `0x4557ba` is the not-a-code arm: struck by the PLAYER (`0x4ac3d4`) or by
 * another fireball (`0x430ee0` against the class's own list) it installs the
 * burst `0x478290` once and plays sound 2, and struck by anything else it
 * answers 0. Nothing in this port puts a fist through a cast, so that arm has
 * no site here either.
 */
const ballBurns: CastCode = (self, code, k) => {
  // `0x455751` — the record's own word, read before the code and before the
  // state, through `0x430eb0`'s walk of the class list
  if (self.alight) return false;
  // `0x455763` — this handler accepts exactly one number
  if (code !== THROW.burns) return false;
  // `0x455791` — late, and not for ever: the thing is about to be removed
  k.burn({ late: true });
  self.alight = true;
  self.vx = 0;
  // ...and `0xfff6` is ten UP, this page's y growing downward as the engine's
  self.vy = -THROW.doused;
  return true;
};

/**
 * ...and the two of them as the page flies them.
 *
 * `speed` and `rise` are the spawner's own words through the class's divisor of
 * six, rounded away from zero the way `0x42f8b0` rounds: 250 and 366 become 42
 * and 61, 300 becomes 50. The rise is NEGATIVE on the high one because the
 * engine's y grows downward and `0x455ce4` writes a positive 366 — the lob is
 * hurled at the floor and what carries it to you is the bounce.
 *
 * `offX` rather than `ahead` because both muzzles are `sub ax, 0x1e` with no
 * `sbb` in front: thirty to the left whichever way it is turned. The one thing
 * not carried is `0x4562c7`'s single step at birth, which leaves the disc's own
 * fireball exactly one frame further along than this one.
 */
function ball(t: { dx: number; dy: number; vx: number; vy: number }): CastKit {
  const over = (n: number) => Math.trunc((Math.abs(n) + THROW.divisor - 1) / THROW.divisor) * Math.sign(n);
  return {
    cels: [THROW.flight[0]],
    hold: 1,
    speed: over(t.vx),
    ahead: 0,
    offX: t.dx,
    lift: -t.dy,
    blow: THROW.strength,
    rise: -over(t.vy),
    pull: THROW.pull,
    bounce: THROW.bounce,
    friction: THROW.friction,
    fastBlow: THROW.fastBlow,
    rest: THROW.rest,
    then: { cels: THROW.flight, hold: 1 },
    burst: { cels: THROW.burst, hold: 1 },
    onCode: ballBurns,
    from: "0x456240 / 0x478250, class 0x455520",
  };
}

/** `0x455cc3` — kind 2 tag 0, out of the chest and down at the floor */
export const WBOOLY_HIGH: CastKit = ball(THROW.high);
/** `0x455d01` — kind 2 tag 1, low and flat and half again as fast */
export const WBOOLY_LOW: CastKit = ball(THROW.low);

/**
 * Its repertoire, by kind and tag, straight out of `0x4782e0`…`0x478370`.
 *
 * `hold` is each script's own `ticksPerFrame` and every `dx` is the script's
 * own, in the engine's pre-divisor units — this class's divisor is 30
 * (`0x45589b`), the heaviest in the game, so the walk's 310 is eleven pixels a
 * frame and the run's 610 is twenty-one.
 */
export const WBOOLY = {
  /** kind 0 tag 0 — one cel, no stride: the statue it is until you walk in */
  statue: { cels: [3040], hold: 1, kind: 0, tag: 0, from: "0x4782e0 tag 0" },
  /** kind 0 tag 1 — four frames of the head lifting */
  stir: {
    cels: [3041, 3040, 3041, 3040],
    hold: 1,
    kind: 0,
    tag: 1,
    from: "0x4782e0 tag 1",
  },
  /** kind 0 tag 2 — and six of it pulling itself out of the ground */
  climb: {
    cels: [3122, 3123, 3124, 3124, 3123, 3122],
    hold: 1,
    kind: 0,
    tag: 2,
    from: "0x4782e0 tag 2",
  },
  /** kind 1 — two cels going nowhere, and the state that decides at range */
  stance: {
    cels: [3040, 3041],
    hold: 2,
    kind: 1,
    tag: 0,
    from: "0x478340 tag 0",
  },
  /** kind 2 tag 0 — the overhead wind-up, and {@link THROW}.high leaves it */
  lob: {
    cels: [3010, 3011, 3012, 3013, 3014, 3015, 3016],
    hold: 1,
    kind: 2,
    tag: 0,
    from: "0x4786e0 tag 0",
  },
  /** kind 2 tag 1 — the low wind-up, and {@link THROW}.low leaves it */
  hurl: {
    cels: [3020, 3021, 3022, 3023, 3024, 3025],
    hold: 1,
    kind: 2,
    tag: 1,
    from: "0x4786e0 tag 1",
  },
  /**
   * kind 2 tag 2 — six cels nothing installs.
   *
   * Every `push 0x4786e0` in the class passes tag 0 or tag 1 (`0x455b81` rolls
   * `0x434540(2) - 1`, `0x455bc3`/`0x455bdd` alternate them, `0x456086` takes
   * tag 0), so cels 3030..3035 are dead in the executable. Carried because the
   * state-2 handler's `else` arm at `0x455d3d` would fire the spawner for it off
   * whatever was last left in the muzzle globals.
   */
  unused: {
    cels: [3030, 3031, 3032, 3033, 3034, 3035],
    hold: 1,
    kind: 2,
    tag: 2,
    from: "0x4786e0 tag 2",
  },
  /** kind 3 — the low swipe, two frames a cel */
  swipe: {
    cels: [3052, 3052, 3053, 3054, 3055],
    hold: 2,
    kind: 3,
    tag: 0,
    from: "0x478448 tag 0",
  },
  /** kind 4 — the overhead swat, the one it uses on somebody off the ground */
  swat: {
    cels: [3130, 3131, 3132, 3133, 3134],
    hold: 1,
    kind: 4,
    tag: 0,
    from: "0x4784e8 tag 0",
  },
  /** kind 5 tag 0 — three cels of it gathering, the door INTO the melee half */
  crouch: {
    cels: [3090, 3091, 3092],
    hold: 1,
    kind: 5,
    tag: 0,
    from: "0x4785e8 tag 0",
  },
  /** kind 5 tag 1 — the walk, 310 a cel */
  walk: {
    cels: [3000, 3001, 3002, 3003, 3004, 3005, 3006],
    hold: 1,
    dx: [310, 310, 310, 310, 310, 310, 310],
    kind: 5,
    tag: 1,
    from: "0x4785e8 tag 1",
  },
  /** kind 5 tag 2 — the swing, and only its last cel travels */
  swing: {
    cels: [3060, 3061, 3062, 3063, 3064, 3065, 3066, 3067, 3068],
    hold: 1,
    dx: [0, 0, 0, 0, 0, 0, 0, 0, 310],
    kind: 5,
    tag: 2,
    from: "0x4785e8 tag 2",
  },
  /** kind 5 tag 3 — the crouch backwards, and the door OUT of the melee half */
  rise: {
    cels: [3092, 3091, 3090],
    hold: 1,
    kind: 5,
    tag: 3,
    from: "0x4785e8 tag 3",
  },
  /** kind 5 tag 4 — one cel, and the frame that decides inside the melee */
  hover: { cels: [3000], hold: 1, kind: 5, tag: 4, from: "0x4785e8 tag 4" },
  /** kind 5 tag 5 — the same seven cels at 610, twice the walk */
  run: {
    cels: [3000, 3001, 3002, 3003, 3004, 3005, 3006],
    hold: 1,
    dx: [610, 610, 610, 610, 610, 610, 610],
    kind: 5,
    tag: 5,
    from: "0x4785e8 tag 5",
  },
  /** kind 6 — six cels of roaring, and it travels nowhere */
  bellow: {
    cels: [3040, 3041, 3042, 3043, 3044, 3045],
    hold: 1,
    kind: 6,
    tag: 0,
    from: "0x478478 tag 0",
  },
  /** kind 10 — what it stands there doing while the player is down */
  mill: {
    cels: [3040, 3041, 3040, 3040, 3041, 3040],
    hold: 2,
    kind: 10,
    tag: 0,
    from: "0x4784b0 tag 0",
  },
  /** `0x478780`, the fourth argument `0x451050` hands `0x45ef70` — six of them */
  bands: [1000, 750, 500, 400, 160, 60],
  /**
   * `0x4510dd`/`0x4510e3` — the home point, and it is a CONSTANT.
   *
   * Unlike every class that copies its home out of the level record, this one
   * has `AI+0xe = 0x892` and `AI+0x10 = 0x122a` written in by the creator, and
   * `0x455e7c`/`0x4560cd` put the packed dword straight back into `obj+6` — the
   * y AND the x — to snap it home. Only the x is used here: this page's y is a
   * room anchor rather than the engine's absolute. The x reaches the brain as
   * `e.home`, through {@link FOES.initwbooly}'s `homeAt` — PLAYGR's record puts
   * the boss at x4199, four hundred and fifty short of where it goes home to.
   */
  homeX: 4650,
  homeY: 2194,
  /**
   * `woods.snd` through the creature bank `0x4a7910`, which is the one
   * {@link BrainCtx.say} is wired to — so every id below goes through the
   * helper unchanged.
   *
   * With one caveat worth stating: the class plays out of that bank through TWO
   * entry points. `0x40ef30` is `k.say`'s; `0x40f090` is its twin — identical
   * but for the last call, `0x427d20` where `0x40ef30` uses `0x427b20` — and
   * the class uses it for exactly four cues: `stirLoop` at `0x455a50`, and
   * three inside the death (`0x456138`, `0x45619c`, `0x456411`). Those four are
   * the sustained ones. `k.say` is used for them here because the bank and the
   * id are the same and this page has no second entry point; the difference is
   * named rather than pretended away.
   */
  wake: 0x2c,
  stirLoop: 0x2b,
  roar: 0x2a,
  charge: 0x29,
  grunt: 0x28,
  thud: 0x31,
  from: "0x455940",
} as const;

/** `0x455ac9` — the single roll state 1 makes, and `0x455ae2`'s share of it */
const ROAR_ROLL = 0x19d;
const ROAR_ODDS = 0x1d;
/** `0x455b15` — six throws made is the last one; `0x455b42` seeds the melee */
const THROWS = 6;
const DECISIONS = 0xa;
/** `0x4510d7` seeds the beat state 1 throws on with ten; `0x455bad` reseeds
 * it fifteen, so the first throw of a fight comes a third sooner than the rest */
const BEAT0 = 0xa;
const BEAT = 0xf;
/** `0x455bbd` — two lobs then a low one, and `0x455bf0` starts over */
const LOBS = 3;
/** `0x455c74` — the vertical gap that picks the swat over the swipe */
const OVERHEAD = 0x50;
/** `0x455ee7` — near enough to home to stop running at it */
const HOME_PX = 0x6e;

/**
 * `initwbooly`'s own machine — states 0 to 6 and 10.
 *
 * ## The stack frame, and how it was pinned
 *
 * `0x455940` does `sub esp, 0xc`, takes `lea eax, [esp]` **before** it pushes
 * ebx, esi and edi, and then pushes that. So the twelve bytes `0x45efd0` fills
 * sit at **`esp+0xc`** once the three registers are down. Two things settle it
 * independently of the arithmetic: the second tracker call, `0x455e9c`, spells
 * the same buffer out as `lea eax, [esp+0xc]` from inside the body where no
 * extra pushes are live; and the argument slots line up — `esi` comes from
 * `[esp+0x1c]` (the object) and `edi` from `[esp+0x20]` (the AI struct), which
 * is exactly `0xc + 0x10` and `0xc + 0x14`.
 *
 * That makes `[esp+0x10]` `out+4`, the BAND, and `[esp+0x16]` `out+0xa`, the
 * forward distance, and `[esp+0x12]` `out+6`, "his cel carries a strike box".
 * Read four bytes low and `cmp word ptr [esp+0x10], 5` — the one edge the whole
 * melee turns on — becomes a test on the side instead, and still compiles.
 *
 * ## The AI struct, which is NOT the punk's
 *
 * `0x451050` allocates 0x38 bytes and fills them in:
 *
 * ```
 *   AI+0     0x4510ae  0x40e300(0x320) — HEALTH, 800. Not a nerve.
 *   AI+2     0x4510d7  10 — the beat state 1 throws on          -> e.beat
 *   AI+4     0x4510d3  0 — throws made, then decisions left     -> e.decisions
 *   AI+6..c  0x4510c9  the record's rect, as two dwords         -> e.fighting
 *   AI+0xe   0x4510e3  home y, 0x892 — a constant, not the record
 *   AI+0x10  0x4510dd  home x, 0x122a — likewise                -> e.home
 *   AI+0x12  0x4510e9  consecutive blows, for the knockdown rule
 *   AI+0x14  0x4510f0  which throw comes next, 0..2             -> e.nerve (!)
 *   AI+0x16  0x4510fc  0x45ef70's tracker input, band list 0x478780
 * ```
 *
 * **`e.nerve` here is `AI+0x14` and has nothing to do with the punk's nerve.**
 * This class keeps its health in `AI+0`, which is `e.hp` and the bar's figure,
 * so the field was free; `AI+0x14` is a three-step counter and no other
 * {@link Enemy} slot corresponds to it at all.
 *
 * ## And every path returns false
 *
 * Every exit of `0x455940` is `xor ax, ax` — the twelve "my script has not
 * finished" returns through `0x4561c1` included. The single `mov ax, 1` in the
 * whole class is `0x4558fb`, in the message proc, and it is the frame the think
 * function has asked for the object to go. So nothing below returns true:
 * waiting is exactly when the current script must keep playing.
 */
export const wbooly: Brain = (e, foe, run, k) => {
  const done = e.clock >= run;
  const t = k.track(e, WBOOLY.bands);
  e.beat ??= BEAT0; // `0x4510d7` — ten, and reseeded fifteen after
  e.decisions ??= 0; // `0x4510d3`
  e.nerve ??= 0; // `0x4510f0` — AI+0x14, NOT a nerve; see above
  // `0x4510dd` — a constant, not the record's point: {@link Foe.homeAt} puts
  // it in `e.home` at spawn, converted to the page's foot x
  e.home ??= WBOOLY.homeX;
  switch (e.script ?? 0) {
    /**
     * ---- 0, `0x4559bb`: the statue, the stir and the climb.
     *
     * The tag chain is `movsx eax, word ptr [esi + 0x44]` — the TAG — because
     * all three live in one script, `0x4782e0`, and share kind 0. The page
     * reaches the same three through {@link Foe.wake}'s `stir` and `burst`,
     * which hold the same cels at the same rate; whichever owner runs, the
     * sequence and the two sounds are these.
     */
    case 0:
      switch (e.tag ?? 0) {
        /**
         * `0x4559db` — one cel, and the ONLY thing that ends it is
         * `0x434200(player.point, AI+6)`: the player's own point inside the
         * four words the creator copied out of the record. That test is
         * {@link Enemy.fighting}. `0x455a1c` then points the camera at it.
         */
        case 0:
          if (!e.fighting) return false;
          k.say(e, WBOOLY.wake); // `0x455a0d`
          return install(e, WBOOLY.stir);
        // `0x455a2f` — and the stir puts the sustained cue under the climb
        case 1:
          if (!done) return false;
          k.say(e, WBOOLY.stirLoop); // `0x455a50`, through `0x40f090`
          return install(e, WBOOLY.climb);
        /**
         * `0x455a67` — out of the ground, `AI+4` cleared, and it does NOT
         * start at range: it opens in the MELEE half, kind 5 tag 0, which is
         * the one entry into it that is not the seven-throw counter.
         */
        case 2:
          if (!done) return false;
          e.decisions = 0; // `0x455a72`
          k.say(e, WBOOLY.wake); // `0x455a7c`
          return install(e, WBOOLY.crouch);
        // `0x4559d1` — `xor ax, ax`: kind 0 has no other tag
        default:
          return false;
      }
    /**
     * ---- 1, `0x455aa5`: standing, and the RANGED half.
     *
     * No `obj+0x46` gate anywhere in it: like the punk's stance this state
     * thinks on every frame, and what paces it is `AI+2` rather than the length
     * of the script.
     */
    case 1: {
      // `0x455aa5` — `0x402f60`: off his feet and it just mills
      if (k.player.down) return install(e, WBOOLY.mill);
      /**
       * `0x455ac9` — one roll of 1..413 is taken FIRST, every frame, before
       * anything is looked at. Kept in that order because it is a draw on the
       * same generator everything else in the level shares.
       */
      const roll = k.roll(ROAR_ROLL);
      // `0x455ad6` — turn to face him, and this one does NOT return
      if (t.forward < 0) e.facing = -e.facing;
      // `0x455ae2` — twenty-eight in four hundred and thirteen, it just roars
      if (roll < ROAR_ODDS) {
        k.say(e, WBOOLY.roar); // `0x455aec`
        return install(e, WBOOLY.bellow);
      }
      /**
       * `0x455b15` — and the seventh throw is the last one. It bellows, seeds
       * `AI+4` with ten and drops into kind 5, the melee half, which will spend
       * those ten and come back here with the counter at zero.
       */
      if ((e.decisions ?? 0) > THROWS) {
        k.say(e, WBOOLY.charge); // `0x455b20`
        e.decisions = DECISIONS; // `0x455b42`
        return install(e, WBOOLY.crouch);
      }
      /**
       * `0x455b4f` — the band, through the byte map at `0x45620c`:
       * `[0,0,0,0,0,1,2]`, so bands 0 to 4 throw, band 5 swings, band 6 swats.
       * The `ja` is unsigned, so band −1 — behind it, which the turn above will
       * fix next frame — falls out doing nothing.
       */
      if (t.band < 0) return false;
      if (t.band === 6) {
        // `0x455c3b` — inside sixty there is only the overhead swat
        return install(e, WBOOLY.swat, true);
      }
      if (t.band === 5) {
        /**
         * `0x455bfd` — sixty to a hundred and sixty, and the question is
         * `word ptr [player + 0x2e]`: is he back on the ground. On his feet it
         * swipes low, off them it swats overhead.
         *
         * This page has no `obj+0x2e` for the player. `k.player.vy === 0` is
         * the nearest honest stand-in — a player on the floor carries no
         * vertical speed — and it differs from the flag at exactly one moment,
         * the apex of a jump. Named, not hidden.
         */
        return k.player.vy === 0
          ? install(e, WBOOLY.swipe, true)
          : install(e, WBOOLY.swat, true);
      }
      /**
       * `0x455b6c` — beyond a hundred and sixty it throws, and there are two
       * ways in. The first: `[esp+0x12]`, `out+6`, his cel carrying a strike
       * box — the frame he swings it answers immediately with `0x434540(2) - 1`,
       * one of the two throws at random, and the beat is not touched.
       */
      if (k.player.swinging) {
        return install(e, k.roll(2) - 1 === 0 ? WBOOLY.lob : WBOOLY.hurl);
      }
      /**
       * `0x455b99` — otherwise `AI+2` counts down and only a lapsed beat
       * throws. `0x455bad` reseeds it fifteen, and `AI+0x14` then walks 0, 1, 2
       * through the lob and takes the low one on the third before starting over
       * — two high, one low, for ever.
       */
      const beat = e.beat ?? BEAT;
      e.beat = beat - 1;
      if (beat >= 0) return false;
      e.beat = BEAT;
      const nth = (e.nerve ?? 0) + 1; // `0x455bb3` — AI+0x14
      e.nerve = nth;
      if (nth < LOBS) return install(e, WBOOLY.lob);
      e.nerve = 0; // `0x455bf0`
      return install(e, WBOOLY.hurl);
    }
    /**
     * ---- 2, `0x455c55`: the throw, and the one thing that cancels it.
     *
     * The wind-up is not committed. Every frame of it re-reads the band, and if
     * he has closed inside a hundred and sixty the fireball is abandoned
     * mid-script for a swing — and which swing is the VERTICAL gap, `0x455c65`,
     * not the band: more than eighty above or below and it goes overhead.
     */
    case 2: {
      if (t.band >= 5) {
        return Math.abs(k.anchorY(e) - k.player.anchor) > OVERHEAD
          ? install(e, WBOOLY.swat, true)
          : install(e, WBOOLY.swipe, true);
      }
      if (!done) return false;
      /**
       * `0x455cc3` / `0x455d01` / `0x455d3d` — the muzzle and the velocity go
       * into four globals and `0x456240` builds the fireball out of them. Which
       * of the two it is comes off `0x455cba`'s own dispatch on the TAG: tag 0
       * is the high one and tag 1 the low, and `0x455cc1` — any other tag —
       * falls past both and throws nothing.
       *
       * Then `0x455d4f` adds one to `AI+4`, which is the seven-throw counter,
       * and it goes back to standing.
       */
      if ((e.tag ?? 0) === 0) k.cast(e, WBOOLY_HIGH);
      else if (e.tag === 1) k.cast(e, WBOOLY_LOW);
      e.decisions = (e.decisions ?? 0) + 1;
      return install(e, WBOOLY.stance);
    }
    /**
     * ---- 3, 4 and 6, `0x455d70`: all three share one handler.
     *
     * The low swipe, the overhead swat and the roar play through and hand back
     * to standing, and the only other thing the handler does is stamp
     * `obj+0x1a = 0x64` — a hundred percent of this class's blow — on the way
     * past, which is {@link Enemy.strength}.
     */
    case 3:
    case 4:
    case 6:
      e.strength = 0x64; // `0x455d70`
      return done ? install(e, WBOOLY.stance) : false;
    /**
     * ---- 5, `0x455d9b`: the melee half, all six tags of it.
     *
     * `obj+0x1a = 0x64` again on entry, every frame, for every tag. The tag
     * dispatch is `0x456214`, six entries, and `0x455da8`'s `ja 5` sends
     * anything else to "wait, then take the stance".
     */
    case 5: {
      e.strength = 0x64; // `0x455d9b`
      switch (e.tag ?? 0) {
        // `0x455db8` — the gather ends and the stance takes over
        case 0:
          return done ? install(e, WBOOLY.hover) : false;
        /**
         * `0x455dc8` — the walk, and it does NOT run to the end. The frame the
         * band reaches 5 — inside a hundred and sixty — it grunts and swings
         * out of the middle of the stride (`0x455df1`); short of that it plays
         * out and hands to the stance.
         *
         * `0x455dc8` opens `cmp ax, 7` on `obj+0x44`, which in this state is
         * the tag and is therefore 1. **Dead code**: see {@link DEAD}.
         */
        case 1:
          if (t.band >= 5) {
            k.say(e, WBOOLY.grunt); // `0x455df7`
            return install(e, WBOOLY.swing, true);
          }
          return done ? install(e, WBOOLY.hover) : false;
        // `0x455e26` — the swing plays whole and hands back
        case 2:
          return done ? install(e, WBOOLY.hover) : false;
        /**
         * `0x455e36` — the rise, and it is the door OUT of the melee half.
         *
         * Four things at once: the camera goes back on the player (`0x455e46`),
         * kind 1 is installed, the screen shakes on 2 with a thud (`0x455e61`),
         * and `0x455e7c` writes the packed home point straight into `obj+6` —
         * it does not walk home, it IS home. Only the x is taken here; see
         * {@link WBOOLY.homeY}.
         */
        case 3:
          if (!done) return false;
          k.say(e, WBOOLY.thud); // `0x455e6d`
          e.x = e.home ?? WBOOLY.homeX;
          return install(e, WBOOLY.stance);
        // `0x455e87` — one cel, and the frame that decides
        case 4:
          return decide(e, k, done);
        /**
         * `0x455f7b` — the run, twice the walk's stride, and it simply ends in
         * the stance. Its own `cmp ax, 0x1b` is the second of the three dead
         * tests; see {@link DEAD}.
         */
        case 5:
          return done ? install(e, WBOOLY.hover) : false;
        default:
          return done ? install(e, WBOOLY.hover) : false;
      }
    }
    /**
     * ---- 10, `0x45609e`: what it does while the player is down.
     *
     * It loops its own six cels until `0x402f60` says he is upright again, and
     * the frame he is, `0x4560cd` snaps it back onto the home point and puts it
     * in the stance — the ranged half, with `AI+4` wherever the fight left it.
     */
    case 10:
      if (!done) return false;
      if (k.player.down) return install(e, WBOOLY.mill);
      e.x = e.home ?? WBOOLY.homeX;
      return install(e, WBOOLY.stance);
    default:
      return false;
  }
};

/**
 * Three `if`s in `0x455940` that can never be true, and are worth naming
 * because each one costs the fight a cue.
 *
 * `0x455dc8` (kind 5 tag 1) asks `obj+0x44 == 7`, `0x455f7b` (kind 5 tag 5)
 * asks `obj+0x44 == 0x1b`, and `0x455fde` (the knockdown) asks
 * `obj+0x44 == 3 || obj+0x44 == 9`. All three would shake the screen and play
 * the thud, 0x31 or 0x32, on one particular frame of a long script — a footfall
 * in the walk at frame 7, another in the run at frame 27, and the impact of the
 * knockdown at frames 3 and 9.
 *
 * But `obj+0x44` is the TAG, and `0x45d090` is the only thing that writes it:
 * the frame advance `0x45d0f0` walks `obj+0x42` and leaves `obj+0x44` alone. So
 * in kind 5 tag 1 the word is 1, in tag 5 it is 5, and in kind 7 it is 0 or 1 —
 * never 7, 0x1b, 3 or 9. The constants are frame indices and the field is a
 * tag; `0x455fde` then re-reads the same word two instructions later and hands
 * it to `0x45d090` as the tag for `0x478578`, where it plainly IS one.
 *
 * Nothing is ported for them, because nothing happens.
 */
const DEAD = "0x455dc8, 0x455f7b, 0x455fde" as const;

/**
 * Kind 5 tag 4, `0x455e87` — one cel, and the whole of the melee half decides
 * on it.
 *
 * The order matters and is unusual: it takes a **second** tracker reading of
 * its own (`0x455e9c`, into the same `esp+0xc`) before it does anything, so the
 * band and the forward distance it acts on are this frame's and not the
 * preamble's. Then it spends one of `AI+4`, and only when those run out does it
 * look at home rather than at the player.
 */
function decide(e: Enemy, k: BrainCtx, done: boolean): boolean {
  /**
   * `0x455e87` — with the player off his feet the budget is put back to zero
   * and it holds the stance. Not the mill: kind 10 belongs to state 1, and a
   * boss that is already in the melee half stands there instead.
   */
  if (k.player.down) {
    e.decisions = 0; // `0x455e91`
    return done ? install(e, WBOOLY.hover) : false;
  }
  // `0x455e9c` — the fresh reading, taken before the counter is touched
  const t = k.track(e, WBOOLY.bands);
  // `0x455eae` — one decision a pass, and `jg` means it commits AT zero
  const left = (e.decisions ?? 0) - 1;
  e.decisions = left;
  if (left <= 0) {
    if (!done) return false;
    /**
     * `0x455ec4` — out of decisions, so it stops looking at the player and
     * turns towards its own x: `obj+0x28 = 1` when home is at or west of it,
     * 0 when home is east.
     */
    const home = e.home ?? WBOOLY.homeX;
    e.facing = home <= e.x ? -1 : 1;
    // `0x455ee7` — within a hundred and ten of home it is home enough
    if (Math.abs(e.x - home) < HOME_PX) {
      e.decisions = 0; // `0x455eec`
      e.facing = -1; // `0x455ef2` — `obj+0x28 = 1`, due west, unconditionally
      return install(e, WBOOLY.rise);
    }
    k.say(e, WBOOLY.charge); // `0x455f03`
    return install(e, WBOOLY.run);
  }
  // `0x455f19` — face him, and again this does NOT return
  if (t.forward < 0) e.facing = -e.facing;
  /**
   * `0x455f25` — and the band, through the second byte map at `0x456238`:
   * `[0,0,0,0,0,1,1]`. Bands 0 to 4 close, bands 5 and 6 swing, and band −1 —
   * behind it — falls out on the unsigned `ja` with the stance held.
   */
  if (t.band < 0) return done ? install(e, WBOOLY.hover) : false;
  if (t.band >= 5) {
    k.say(e, WBOOLY.grunt); // `0x455f68`
    return install(e, WBOOLY.swing, true);
  }
  k.say(e, WBOOLY.charge); // `0x455f46`
  /**
   * `0x455f55` — **and this is the one that reads wrong until you check it.**
   * The choice between the walk (310) and the run (610) is not the distance and
   * not the budget: it is `cmp word ptr [esi + 0x28], 0`, the mirror flag.
   * Facing west it walks; facing east it runs, at twice the speed, on the same
   * seven cels. Read as written — the disc really does close on you half again
   * as fast when it is coming east as when it is coming west.
   */
  return install(e, e.facing < 0 ? WBOOLY.walk : WBOOLY.run);
}

/**
 * `0x456310` asks the STATE before it reacts — the part of it the page's own
 * flinch path cannot ask for itself.
 *
 * ```
 *   4563c1  AI+0 -= blow                     the health, whatever the state
 *   4563ce  AI+0 <= 0 -> the death           ...and a lethal blow always kills
 *   456461  obj+0x18 == 5 -> AI+0x12 += 1    blows counted only in the melee
 *   456470  obj+0x18 in {8, 2, 9} -> ax = 1  getting up, throwing, flinching:
 *                                            taken, and no reaction at all
 *   456496  AI+0x12 > 2 -> the knockdown,    and AI+4 = 0, AI+0x12 = 0
 *   4564dc  otherwise the flinch             tag by the state, see the pick
 * ```
 *
 * The absorbed states are answered here: the health comes off and the blow
 * lands as nothing else. A blow that empties the health goes through, because
 * `0x4563ce` kills before `0x456470` is reached.
 *
 * `AI+0x12` is kept in {@link Enemy.dents}, which the page steps once per blow
 * after this gate and weighs against {@link Foe.knockdown}'s `every`. Written
 * as `1 + AI+0x12` after that step — so 1, 2, 3 for a count of 0, 1, 2, and 4
 * on the blow that knocks it down, which is why `every` is 4 for this class.
 */
export function wboolyGate(
  e: Enemy,
  foe: Foe,
  blow: { damage: number; code: number },
): { damage: number; code: number } | null {
  // `0x45631e` — the −9 arm lights it and returns before any of this
  if (blow.code < 0) return blow;
  const over = foe.knockdown?.anim;
  const state =
    e.state !== "flinch"
      ? (e.script ?? 0)
      : e.anim === over
        ? 7
        : e.anim === over?.then
          ? 8
          : 9;
  // `0x456470` — absorbed, unless it is the blow that kills
  if (state === 8 || state === 2 || state === 9) {
    if (e.hp - blow.damage > 0) {
      e.hp -= blow.damage;
      return null;
    }
    return blow;
  }
  // `0x456461` / `0x456496` — the count, read back out of `dents` (see above)
  const count = e.dents >= 4 ? 0 : Math.max(0, e.dents - 1);
  const next = state === 5 ? count + 1 : count;
  if (next > 2) {
    e.dents = 3; // -> 4 after the page's step: the knockdown
    e.decisions = 0; // `0x4564c5`
  } else e.dents = next; // -> next + 1
  return blow;
}

export {
  NOT_HERE as WBOOLY_NOT_HERE,
  NOT_BEHAVIOUR as WBOOLY_NOT_BEHAVIOUR,
  DEAD as WBOOLY_DEAD,
  THROW as WBOOLY_THROW,
};
