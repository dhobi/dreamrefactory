/**
 * The flying eyeball — `initeyeball`, think function `0x43dde0`, and the first
 * class in the chapter that never touches the player with a cel of its own.
 *
 * ## It has no strike box anywhere, because it SPITS
 *
 * Every other class read so far lands its blow with a frame of its own
 * animation. This one does not: `0x43e6cc` — state 7, the spit — calls
 * `0x43e800`, and that routine **creates a second object** of a class of its
 * own and walks away. The glob is the hit. What `0x43e800` does, exactly, is
 * written out at {@link GLOB}, because the page has no spawner to hand it to
 * yet and the numbers must not be lost.
 *
 * The one other thing that reaches the player is the carry — state 5 tags 2 to
 * 5 — and that is `0x402ac0(0xa)`, ten health a frame straight out of the
 * player's own word while he is held. **Nothing here hits the player**, so both
 * are carried as read, with their addresses, and neither spends anything.
 *
 * ## Its nine scripts, and therefore its nine states
 *
 * `0x45d090` copies word 4 of a script's header into `obj+0x18`, so this table
 * IS the alphabet the jump table at `0x43e7c4` spells. All nine were read out of
 * the class's data region with `scdis anims <addr>:full`:
 *
 * ```
 *   0  0x472788  the idle hover — twelve cels going nowhere
 *   1  0x472aa0  one cel with a stride: the drift towards him
 *   2  0x472a68  the turn, tag 0 facing east and tag 1 facing west
 *   3  0x4727f0  knocked out of the air (tag 0) and the splat (tag 4)
 *      0x472878  ...and the three flinches, tags 1, 2 and 3 — ALSO kind 3
 *   4  0x472b38  the hover that DECIDES, and state 4 is the whole fight
 *   5  0x472ad0  six tags: climb, dive, and the carry, twice over
 *   6  0x472998  the ladder — tag 0 hunts for one, tags 1 and 2 climb it
 *   7  0x472ab0  three cels of the spit
 *   8  0x4728e0  the pop (tag 0) and the burst (tag 1): the death
 * ```
 *
 * Two scripts share kind 3 — `0x4727f0` and `0x472878` — which is legal and is
 * the reason the flinch and the fall are one state: `0x43dfc4` sub-dispatches on
 * `obj+0x44`, the tag, not on the script.
 *
 * ## What this module owns, and what it does not
 *
 * States 0, 1, 2, 4, 5, 6 and 7 are the ones a live eyeball is in, and they are
 * all here. State 3 is the hit reaction and state 8 is the death; the page
 * already drives those through {@link Foe.flinch}, {@link Foe.pick} and
 * {@link Foe.death}, and a brain is never called during them. Everything those
 * two cases do that the page's own path does not is named at {@link NOT_HERE}.
 *
 * ## The stack frame, which is where every field number below comes from
 *
 * `0x43dde0` opens `sub esp, 0x40` and takes the buffer's address **before** it
 * pushes anything: `lea eax, [esp]`, then `push ebx`, `push esi`, `push edi`,
 * `push ebp`, and then the two arguments to `0x45efd0`. By the `add esp, 8` that
 * follows the call, four registers and one dword of arguments are still down, so
 * the sixteen bytes the tracker filled sit at **`esp+0x10`** — `esp+0x14` is
 * `out+4`, the BAND, `esp+0x16` is `out+6`, and `esp+0x1a` is `out+0xa`, the
 * forward distance.
 *
 * What pins it is the argument slots, which are read at two different depths
 * with the same displacement. `0x43ddea` does `mov edi, [esp+0x54]` after three
 * pushes and gets the **AI struct** (`lea ecx, [edi+0xe]` is then the tracker
 * context the creator seeded at `0x435aaa`); `0x43de0a` does `mov esi,
 * [esp+0x54]` after the `add esp, 8` and gets the **object** (`[esi+0x18]` is
 * the state). Those two can only both be true at one depth, and at that depth
 * the buffer is at `esp+0x10`. Read four bytes low and `0x43e088`'s band switch
 * becomes a side switch and still compiles.
 *
 * ## The AI struct, which is NOT the punk's
 *
 * `0x435a30` allocates **0x4c** bytes and fills them in:
 *
 * ```
 *   AI+0x00  0x435a88  `0x40e300(0x32)` — the eyeball's own HEALTH, not a nerve
 *   AI+0x02  0x435aba  0 — the struggle count while it is carrying him
 *   AI+0x04  0x435acc  0 — which of the glob's five cel sets goes out next
 *   AI+0x06  0x435aa5  the record's rect, four words (the punk's is at AI+8)
 *   AI+0x0e  0x435ab5  the tracker context, `0x45ef70(AI+0xe, obj, player, list)`
 *   AI+0x30  0x43e0da  2 — the spit's metronome
 *   AI+0x32  0x435ad9  0 — which phase of the ladder hunt it is in
 *   AI+0x34  0x435ad5  0 — which way it is climbing, 1 up and 2 down
 *   AI+0x36  0x43e195  the swoop's twenty-frame patience
 *   AI+0x38  0x43e550  the ladder's point, and AI+0x40/AI+0x44 its rect
 *   AI+0x3c  0x435ae0  the point the level put it on
 *   AI+0x48  0x435ac6  0xf — the bob, and AI+0x4a is the zero above it
 * ```
 *
 * **`AI+0` is health.** `0x43de37` hands it to `0x40d1c0` against
 * `0x40e300(0x32)` as the on-screen bar's numerator, and `0x43e933` in the hit
 * handler is what takes the blow off it. It is emphatically not the punk's
 * `AI+0`, which is a nerve that decides how it fights; nothing in this class
 * reads its own health at all. So it is not carried on {@link Enemy.nerve} here
 * — `e.nerve` is given the spit's metronome instead, and the health belongs to
 * whatever {@link Foe.panel} says.
 */
import {
  install,
  type Brain,
  type BrainCtx,
  type Enemy,
  TICK_SCALE,
} from "./kit";

/**
 * The two states the page owns, and the six things they do beyond playing an
 * animation. Read out of `0x43dde0` and `0x43e8b0`, not done here.
 *
 * - **3**, the fall and the flinch (`0x43dfc4`). Two scripts, one kind. The hit
 *   handler `0x43e8b0` picks between them: `0x43e9af` sends any blow harder than
 *   **0x46** — and any blow at all that lands while it is spitting — to
 *   `0x4727f0` tag 0, twelve cels of a dead-weight fall; anything softer reads
 *   `obj+0`, the cel now showing, and answers cel **6206/6207/6208** with
 *   `0x472878` tags **1/2/3**. So which flinch it plays is chosen by which frame
 *   of the hover the blow caught, and a cel not in that list is not a flinch at
 *   all: `0x43e9d4` returns 1 with nothing installed.
 * - **3** again, the splat: `0x43dfc4` watches `obj+0x2c` — the mover's "this
 *   thing is inside an obstacle" flag — and the frame a falling eyeball hits
 *   something it plays `0x4727f0` **tag 4**, cels 6527 down to 6524, with
 *   `woods`-bank sound **0x3c** (`0x43dfd8`). Only when THAT ends does it go
 *   back to the hover, and `0x43e002` gives it `vy = -5` to climb out on.
 * - **8**, the death (`0x43e716`). Tag 0 halves its sideways speed each frame,
 *   and on the frame it ends `0x43e750` plays sound **0x3b** through `0x40f090`,
 *   installs tag 1 — the burst, cels 6600 to 6609 — and calls
 *   `0x40cba0(self.point, 0x32, 0)` **four times**: four gibs out of one
 *   eyeball. Tag 1 then returns **1** the frame its own script ends, which is
 *   the one `mov ax, 1` in the whole function and the frame the object goes.
 * - **8** again, and this one is the hit handler's: `0x43e940` clears the hum's
 *   loop flag (`0x40ee90(bank, 0x38, 0)`) and **stops** it (`0x40eee0`) before
 *   playing the death sound **0x3a**, then blanks the bar with
 *   `0x40d1c0(0, 0, 0, player.point)` and calls `0x40d450(0x50)`. A dead eyeball
 *   is the only one that goes quiet — the hum is unconditional everywhere else.
 */
const NOT_HERE = "0x43dfc4, 0x43e716, 0x43e8b0" as const;

/**
 * `0x43e800` — the spit, which is the only thing this class hits with.
 *
 * It is not an animation and not a state: it is an object creation, and the
 * eyeball never looks at what it made. Written out here so that wiring it later
 * needs no second pass over the executable.
 *
 * - **class** — `[0x472780]`, registered at `0x43db00` from the class procedure
 *   at `0x43db20`. Cel bank `0x4a7020`, the eyeball's own; first cel `0x2134` =
 *   **8500**; think function `0x43dbd0`; hit handler `0x43dc90`, which is
 *   `xor ax, ax; ret` — **the glob cannot be hit**. `0x43db71` gives it gravity
 *   `0` and `0x43db67` restitution `0`, so it flies flat and for ever.
 * - **script** — `0x4725c0`, three ticks a frame, ten tags. `0x43e871` installs
 *   tag **`2 * AI+4`**, and `AI+4` runs 0, 1, 2, 3, 4 and wraps (`0x43e6f6`), so
 *   the five globs go out as tags **0, 2, 4, 6, 8**: cels 8500‑8504, 8520‑8523
 *   +8504, 8540‑8544, 8560‑8564 and 8580‑8584. Its own think dispatches on the
 *   tag through `0x43dc68`, and every EVEN tag is `0x43dbf7` — when this script
 *   ends, install **tag + 1**, the six-cel flight (8505‑8510, 8525‑8530,
 *   8545‑8550, 8565‑8570, 8585‑8590). So a glob launches once and then loops its
 *   flight.
 * - **spawn offset** — `0x43e825` copies the eyeball's own point, then
 *   `0x43e83c` adds **+25 px** to the x facing east and **−25** facing west.
 *   There is no lift: it leaves at the eyeball's own height.
 * - **velocity** — `0x43e84d` sets `obj+0xc` to **+13** facing east, **−13**
 *   facing west, and `0x43e851` sets `obj+0xa` to **0**.
 * - **range** — `0x43e862` stores the spawn point in the glob's own four-byte
 *   AI struct, and `0x43dc28` removes the object once it is **600 px** from it,
 *   or the frame any of `obj+0x2a`, `obj+0x2c` or `obj+0x30` — the mover's three
 *   collision words — is set.
 * - **the blow** — `0x43dbda` writes **`obj+0x1a` = −2** every frame, where the
 *   eyeball's own states all write +100 (`0x43df91`). Carried as read.
 */
const GLOB = "0x43e800 -> [0x472780], script 0x4725c0" as const;

/**
 * Its repertoire, by kind and tag, straight out of `0x472788`…`0x472b38`.
 *
 * Not one frame in this table carries a strike box — see {@link GLOB} for why
 * — and only three of them travel at all: the drift, the ladder hunt and the
 * two climbs. Everything else is moved by velocity the think function writes.
 */
export const EYEBALL = {
  /** kind 0 — twelve cels of hanging in the air, and what it is born in */
  idle: {
    cels: [
      6000, 6001, 6002, 6003, 6004, 6005, 6006, 6007, 6008, 6009, 6010, 6011,
    ],
    hold: 2,
    kind: 0,
    tag: 0,
    from: "0x472788 tag 0",
  },
  /** kind 1 — one cel and a stride: closing on him, and where the carry ends */
  drift: {
    cels: [6206],
    hold: 2,
    dx: [20],
    kind: 1,
    tag: 0,
    from: "0x472aa0 tag 0",
  },
  /** kind 2 tag 0 — the turn it plays while the mirror flag still reads east */
  turnEast: {
    cels: [6202, 6201, 6200],
    hold: 2,
    kind: 2,
    tag: 0,
    from: "0x472a68 tag 0",
  },
  /** kind 2 tag 1 — and the one it plays while it still reads west */
  turnWest: {
    cels: [6209, 6210, 6211],
    hold: 2,
    kind: 2,
    tag: 1,
    from: "0x472a68 tag 1",
  },
  /** kind 4 — four cels going nowhere, and the state that decides everything */
  hover: {
    cels: [6206, 6207, 6208, 6207],
    hold: 4,
    kind: 4,
    tag: 0,
    from: "0x472b38 tag 0",
  },
  /** kind 5 tag 0 — one cel, held while it climbs to a hundred above his head */
  climb: { cels: [6540], hold: 4, kind: 5, tag: 0, from: "0x472ad0 tag 0" },
  /** kind 5 tag 1 — and one more, held while it homes in on that point */
  dive: { cels: [6541], hold: 4, kind: 5, tag: 1, from: "0x472ad0 tag 1" },
  /** kind 5 tag 2 — carrying him off, the first playable character's cel */
  carryA: { cels: [6542], hold: 4, kind: 5, tag: 2, from: "0x472ad0 tag 2" },
  /** kind 5 tag 3 — and shaking him, five frames of the one cel */
  shakeA: {
    cels: [6543, 6543, 6543, 6543, 6543],
    hold: 4,
    kind: 5,
    tag: 3,
    from: "0x472ad0 tag 3",
  },
  /** kind 5 tag 4 — the same carry, the second character's cel */
  carryB: { cels: [6562], hold: 4, kind: 5, tag: 4, from: "0x472ad0 tag 4" },
  /** kind 5 tag 5 — and his shake, three frames rather than five */
  shakeB: {
    cels: [6563, 6563, 6563],
    hold: 4,
    kind: 5,
    tag: 5,
    from: "0x472ad0 tag 5",
  },
  /** kind 6 tag 0 — the same cel and stride as the drift: hunting for a ladder */
  hunt: {
    cels: [6206],
    hold: 2,
    dx: [20],
    kind: 6,
    tag: 0,
    from: "0x472998 tag 0",
  },
  /** kind 6 tag 1 — climbing, and the lift is in the SCRIPT, four frames in twelve */
  climbUp: {
    cels: [
      6100, 6101, 6102, 6103, 6104, 6105, 6106, 6107, 6108, 6109, 6110, 6111,
    ],
    hold: 2,
    dy: [-100, 0, -100, 0, 0, 0, -100, 0, 0, -100, 0, 0],
    kind: 6,
    tag: 1,
    from: "0x472998 tag 1",
  },
  /** kind 6 tag 2 — the same twelve cels, the same four frames, downwards */
  climbDown: {
    cels: [
      6100, 6101, 6102, 6103, 6104, 6105, 6106, 6107, 6108, 6109, 6110, 6111,
    ],
    hold: 2,
    dy: [100, 0, 100, 0, 0, 0, 100, 0, 0, 100, 0, 0],
    kind: 6,
    tag: 2,
    from: "0x472998 tag 2",
  },
  /** kind 7 — three cels at seven ticks each, and five globs leave during them */
  spit: {
    cels: [6503, 6504, 6505],
    hold: 7,
    kind: 7,
    tag: 0,
    from: "0x472ab0 tag 0",
  },
  /**
   * `0x435aa0` — the descending list `0x45ef70` copies into the tracker context,
   * zero-terminated at `0x472b66`. Three entries, so band 3 is the innermost.
   */
  bands: [260, 180, 140],
  /**
   * `0x4a75b0` — the bank every one of this class's voices comes out of, and it
   * is NOT the punk's `0x4a7910`.
   *
   * - `hawk` `0x43e0e6` — the frame it decides to spit
   * - `snatch` `0x43e213` — the frame the swoop latches on
   * - `hum` `0x43df29`/`0x43df3c` — see {@link HUM}
   * - `grabA`/`grabB` `0x43e282`/`0x43e286` and again at `0x43e3d8`/`0x43e3dc`
   *   — one per playable character, chosen by `[0x46b1a8]`
   */
  hawk: 0x36,
  snatch: 0x37,
  hum: 0x38,
  grabA: 0x4c,
  grabB: 0x4d,
  from: "0x43dde0",
} as const;

/**
 * Engine frames per tick of this page, and the only thing that converts a number
 * out of a script into a number this file may write.
 *
 * `walk.ts:766` is the authority: `TICK_SCALE = ENGINE_HZ * tickMs / 1000`, and
 * with `ENGINE_HZ = 15` and `tickMs = 1000/60` that is **a quarter** — four
 * brain calls to the engine frame, `e.clock += TICK_SCALE` once per call, and
 * `e.x += e.vx` once per call, so a velocity written as pixels per engine FRAME
 * becomes pixels per tick by multiplying by this.
 *
 * **`werea.ts` and `wered.ts` both carry a local `TICKS = 0.5`** with the
 * comment "a tick is half of one". That is not what `walk.ts` computes and the
 * two cannot both be right; this file may not edit theirs, so it takes the
 * number the page actually runs on and says so here. If the halves turn out to
 * be the intended reading, this constant is the one line to change.
 */
const TICKS = TICK_SCALE;

/**
 * `0x43df1e` — the hum, which is a LOOP and is therefore not `k.say`.
 *
 * Every frame, for every live eyeball, and whatever state it is in bar the
 * death, `0x43df25` calls `0x40ee90(0x4a75b0, 0x38, 1)` and then
 * `0x40ef30(0x4a75b0, 0x38, self.point)`. The first of those sets a flag on the
 * bank's slot for that sound and the hit handler clears it again with
 * `0x40ee90(bank, 0x38, 0)` immediately before `0x40eee0` **stops** it
 * (`0x43e940`), which is what a looping voice looks like: armed once, positioned
 * every frame, stopped at death.
 *
 * {@link BrainCtx.say} is the second call only — a one-shot — and the kit has no
 * handle for a loop. Calling it here would fire the sample four times an engine
 * frame for as long as the thing is alive, so the hum is carried as
 * {@link EYEBALL.hum} and left for whoever gives the kit a looping voice. Every
 * OTHER `0x40ef30` in this class is a genuine one-shot and is ported.
 */
const HUM = "0x43df25" as const;

/**
 * `0x43e195`/`0x43e240` — how long the dive keeps homing before it gives up.
 *
 * `AI+0x36` is seeded **0x14** on the frame the climb hands over, and tag 1
 * spends one a frame with `ax = AI+0x36; AI+0x36 = ax - 1; if (ax >= 0) <carry
 * on>`. Read it out: the pre-decrement value is 20, 19, … 0 for twenty-one
 * frames and −1 on the twenty-second, which is the frame it breaks off. Tag 1's
 * own script is one cel at four ticks, so `obj+0x46` has been set since frame
 * four and the counter is the only clock in it — which means `e.clock`, which
 * `install` rewound when the dive went on and which nothing in tag 1 rewinds
 * again, IS that counter and no slot is needed for it.
 */
const DIVE_FRAMES = 21;

/**
 * `0x43e0da`/`0x43e6ee` — a glob every fourth engine frame while the spit plays.
 *
 * `AI+0x30` is seeded **2** the frame the spit is chosen and re-seeded 2 after
 * every shot, and state 7 spends it the same way the dive spends its patience:
 * `ax = AI+0x30; AI+0x30 = ax - 1; if (ax >= 0) <nothing happens>`. 2, 1 and 0
 * all skip and the fourth frame reads −1 and fires, so the gap is four frames
 * flat. The spit's own script is three cels at seven ticks — twenty-one frames —
 * which fits the five shots `AI+4` has cel sets for, at frames 4, 8, 12, 16 and
 * 20, exactly once each.
 *
 * Here it is counted UP in engine frames on {@link Enemy.nerve} rather than down
 * on `AI+0x30`, because this page's brain runs four times an engine frame and a
 * bare `- 1` a call would fire four times as often.
 */
const SPIT_GAP = 4;

/**
 * `0x435ac6`/`0x43deb0` — the bob, which is what keeps it in the air.
 *
 * `AI+0x48` is 0xf and `obj+0xe` is 8 (`0x43dd1b`), and `0x42f8b0` adds
 * `AI+0x48 / obj+0xe` to `obj+0xa` every frame, rounding away from zero before
 * the divide: **two pixels a frame**, up or down. What makes it a bob rather
 * than a drift is `0x43dec0` — whenever the vertical speed passes five, the sign
 * of `AI+0x48` is forced to the OPPOSITE of the sign of the speed, so the
 * acceleration always turns back on itself and the thing oscillates in roughly
 * ±7. `AI+0x4a`, the high half of the dword `0x43ded7` passes, is zero, so
 * nothing is ever added sideways.
 */
const BOB = 15;
const BOB_DIVISOR = 8;
const BOB_LIMIT = 5;

/** `0x43de75`/`0x43de8c` — outside a hundred of his height it stops bobbing and climbs */
const REACH = 100;
/** `0x43de82`/`0x43de96` — and it climbs at seven a frame */
const CLIMB = 7;
/** `0x43deff` — fifty a frame sideways is the cap, and anything over it is halved */
const DRIFT_CAP = 50;
/** `0x43e6a1` — the same rule on the ladder, at ten */
const LADDER_CAP = 10;
/** `0x43e04a` — this far off his height and it breaks off to find a ladder */
const GIVE_UP = 200;
/** `0x43e17e`/`0x43e1c7` — the point it wants to be at is a hundred above him */
const STRIKE = 100;
/** `0x43e18c` — and within ten of it counts as arrived */
const ARRIVED = 10;
/** `0x43e155` — the climb goes up at twenty-seven a frame... */
const CLIMB_RATE = 27;
/** ...`0x43e163` — and sideways at five, towards him */
const CLIMB_DRIFT = 5;
/** `0x43e1ba` — the dive closes a third of the remaining gap each frame */
const DIVE_DIVISOR = 3;
/** `0x43e1f5`/`0x43e20a` — and latches inside twenty-five by fifteen */
const LATCH_Y = 25;
const LATCH_X = 15;
/** `0x43e259`/`0x43e3af` — carrying him off rises at ten a frame... */
const CARRY_RATE = 10;
/** ...`0x43e2f5`/`0x43e449` — and shaking him at three */
const SHAKE_RATE = 3;
/** `0x43e371`/`0x43e4c5` — five turns of the stick and he is out of its feet */
const STRUGGLE = 4;

/**
 * `initeyeball`'s own machine, states 0, 1, 2, 4, 5, 6 and 7.
 *
 * ## Every path returns false, including the ones that do nothing
 *
 * `0x43dde0` has exactly one `mov ax, 1` — `0x43e7b5`, the frame the burst ends
 * and the corpse is removed — and every other exit, `0x43df8d` included, is
 * `xor ax, ax`. `0x43df8d` is also where the strength percent is written:
 * `mov word ptr [esi+0x1a], 0x64`, a hundred, on **every** frame of every state.
 * Nothing hits the player in this port, so that is read and not spent.
 *
 * ## The preamble runs before the jump table, and it is most of the class
 *
 * `0x43ddfc` to `0x43df49` happens whatever state the thing is in, and three
 * separate things live there: the health bar's claim, the hover, and the hum.
 * {@link float} is the second of them; the other two are documented where they
 * are and deliberately not ported.
 */
export const eyeball: Brain = (e, foe, run, k) => {
  const done = e.clock >= run;
  const t = k.track(e, EYEBALL.bands);
  const state = e.script ?? 0;
  // AI+0x48's sign, +1 sinking and -1 rising — `0x435ac6` starts it positive
  e.hover ??= 1;
  // AI+0x30, but counted up in engine frames — see {@link SPIT_GAP}
  e.nerve ??= 0;
  // AI+4 — which of the glob's five cel sets goes out next, `0x435acc`
  e.decisions ??= 0;
  // AI+0x32 — the ladder hunt's phase, `0x435ad9`
  e.side ??= 0;
  // AI+2 — how many times he has turned in its grip, `0x435aba`
  e.beat ??= 0;

  /**
   * `0x43ddfc` — the on-screen bar, and it is not behaviour.
   *
   * With the player inside the first band and in front, and the thing neither
   * idling nor dead, `0x43de37` calls `0x40d1c0(AI+0, 0x40e300(0x32), 0x32c8,
   * self.point)` — its own health against what it stood up with. Documented, not
   * ported, the same way the punk's is.
   */
  float(e, k, state);

  switch (state) {
    /**
     * ---- 0, `0x43df59`: the idle, and the one thing that ends it.
     *
     * `0x434200(player.point, AI+6)` — his own point inside the four words the
     * creator copied out of the level record, which is {@link Enemy.fighting} —
     * AND `0x402f60`, that he is on his feet. Both, or it keeps hanging there.
     */
    case 0:
      if (e.fighting && !k.player.down) return install(e, EYEBALL.hover);
      return done ? install(e, EYEBALL.idle) : false;
    // ---- 1, `0x43dfae`: the drift ends in the hover, and does nothing else
    case 1:
      return done ? install(e, EYEBALL.hover) : false;
    /**
     * ---- 2, `0x43dfb7`: the turn, and the turn IS the state.
     *
     * `0x43dfbe` is `xor byte ptr [esi+0x28], 1` — the mirror flag, flipped the
     * frame the three cels run out, and then straight back to the hover. The
     * script it played was chosen by which way it was already facing, so the
     * animation and the flag agree at every frame.
     */
    case 2:
      if (!done) return false;
      e.facing = -e.facing;
      return install(e, EYEBALL.hover);
    // ---- 4, `0x43e00c`: the whole of the fight, decided fresh every frame
    case 4:
      return decide(e, k, t, done);
    // ---- 5, `0x43e13d`: the swoop, six tags through the table at `0x43e7e8`
    case 5:
      return swoop(e, k, done);
    // ---- 6, `0x43e503`: the ladder, three phases through `AI+0x32`
    case 6:
      return ladder(e, done);
    /**
     * ---- 7, `0x43e6cc`: the spit, and the only state that makes anything.
     *
     * The metronome first — see {@link SPIT_GAP} — and then `0x43e6e2` calls
     * `0x43e800(obj, AI+4)`, which builds a glob and forgets it. `AI+4` then
     * advances and wraps at 4 (`0x43e6fa`), so the five cel sets go out in
     * order. The state ends the ordinary way: when the three cels run out,
     * back to the hover.
     */
    case 7: {
      const beat = (e.nerve ?? 0) + TICKS;
      e.nerve = beat;
      if (beat >= SPIT_GAP) {
        e.nerve = 0;
        /**
         * `0x43e800(obj, AI+4)` — a glob of class `[0x472780]` on script
         * `0x4725c0` tag `2 * AI+4`, twenty-five pixels in front of this one and
         * thirteen a frame further. See {@link GLOB}; the page has no spawner to
         * give it to, so all that happens here is the counter.
         */
        e.decisions = ((e.decisions ?? 0) + 1) % 5;
      }
      return done ? install(e, EYEBALL.hover) : false;
    }
    default:
      return false;
  }
};

/**
 * `0x43de45` — the hover, which runs before the state does and is what makes
 * this class fly.
 *
 * Three states hold perfectly still while their own code drives them —
 * `0x43de49` tests for 7, 5 and 0 and `0x43df10` zeroes both speeds — and
 * everything else is dragged towards the player's height: more than a hundred
 * below him and it climbs at seven, more than a hundred above and it sinks at
 * seven, and inside that it bobs. See {@link BOB}.
 *
 * Two of its four jobs cannot be done here:
 *
 * - `0x43dee4` reads **`obj+0x2e`** — back on the ground — and lifts the thing
 *   twenty pixels outright when it is set, which is how an eyeball that has
 *   settled on the floor gets airborne again. {@link Enemy} has no such flag;
 *   this page does not run foes through the ground solver in a way a brain can
 *   ask about, and `e.vy` is not it.
 * - the hum, {@link HUM}.
 */
function float(e: Enemy, k: BrainCtx, state: number): void {
  // `0x43df10` — the idle, the swoop and the spit steer themselves
  if (state === 0 || state === 5 || state === 7) {
    e.vx = 0;
    e.vy = 0;
    return;
  }
  const dy = k.player.y - e.y;
  if (dy > REACH) {
    // `0x43de82` — he is below it, so down
    e.vy = CLIMB * TICKS;
  } else if (dy < -REACH) {
    // `0x43de96` — and 0xfff9 is −7
    e.vy = -CLIMB * TICKS;
  } else {
    /**
     * `0x43deb0` — the spring. `AI+0x48`'s sign is forced opposite to the
     * vertical speed's once that speed passes five, and then
     * `0x42f8b0` adds `AI+0x48 / 8` to it, rounded away from zero: two pixels
     * per engine FRAME. An acceleration converts twice — once for the velocity's
     * own units and once because this brain runs four times a frame.
     */
    if (Math.abs(e.vy) > BOB_LIMIT * TICKS) e.hover = e.vy > 0 ? -1 : 1;
    const push = Math.ceil(BOB / BOB_DIVISOR) * (e.hover ?? 1);
    e.vy += push * TICKS * TICKS;
  }
  // `0x43def0` — and fifty a frame sideways is as fast as it drifts
  if (Math.abs(e.vx) > DRIFT_CAP * TICKS) e.vx = e.vx / 2;
}

/**
 * State 4, `0x43e00c` — the hover, and every decision the class makes.
 *
 * The order matters and it is the executable's: he is down, he is on a ladder,
 * he is too far off its height, he is behind it, he is there for the taking, and
 * only then the band. Each of the first five is a plain `jmp` to an install and
 * the frame is over.
 *
 * ## The two tests this port cannot make, and what it does instead
 *
 * `0x43e02b` and `0x43e06c` read the PLAYER's own `obj+0x18`. Neither
 * {@link Enemy} nor {@link BrainCtx} carries it — `k.player.down` is
 * `0x402f60`, the single test that his state is under 0x1a, and states 7 and 9
 * are both well under that — so:
 *
 * - **state 7, on a ladder.** `0x43e02f` sends the eyeball off to find a ladder
 *   of its own and follow him up it. The port has no ladders and no way to ask,
 *   so this branch is not taken and the class reaches state 6 through its other
 *   door, the two-hundred-pixel one below, which IS expressible.
 * - **state 9.** `0x43e070` is the swoop's only door: he is in state 9 and
 *   `0x43e880` — a walk of the class's own object list looking for a member
 *   already in state 5 — says no other eyeball has him. Nine is one of the four
 *   `0x402f00` also names (9, 0xa, 0xd, 0x18) and those four are what the spit
 *   declines to go out at, so it is a helpless state: stunned, or already held.
 *   **The swoop is therefore unreachable in this port**, and {@link swoop} is
 *   written out in full anyway so that the day the page can answer "is he
 *   stunned" it is one condition, not a re-read of `0x43e13d`.
 *   For the same reason `0x402f00` is taken as true at the spit below: the port
 *   can never see the player in any of the four states that would refuse it.
 */
function decide(
  e: Enemy,
  k: BrainCtx,
  t: ReturnType<BrainCtx["track"]>,
  done: boolean,
): boolean {
  // `0x43e016` — he is off his feet, so it goes back to hanging about
  if (k.player.down) return install(e, EYEBALL.idle);
  /**
   * `0x43e04a` — two hundred off his height and it stops trying.
   *
   * `0x43e12b` sets `AI+0x32` to 1, the first phase of the hunt, and installs
   * the kind-6 drift. This is the door into state 6 that the port can still open
   * — the ladder one above is not — and {@link ladder} says what happens after.
   */
  if (Math.abs(e.y - k.player.y) > GIVE_UP) {
    e.side = 1;
    return install(e, EYEBALL.hunt);
  }
  /**
   * `0x43e055` — he is behind it, so turn, and the tag is its CURRENT mirror
   * flag: `mov ax, word ptr [esi+0x28]; push eax`. State 2 flips the flag when
   * the three cels end, so tag 0 is the east-facing set and tag 1 the west one.
   */
  if (t.forward < 0) {
    return install(e, e.facing > 0 ? EYEBALL.turnEast : EYEBALL.turnWest);
  }
  /**
   * `0x43e07c` — the swoop's door, which this port cannot open. See above.
   *
   * ```
   *   if (player.state == 9 && !anyEyeballAlreadySwooping())
   *       install(0x472ad0, 0);   // kind 5 tag 0, the climb
   * ```
   */
  switch (t.band) {
    // beyond 260 — nothing to think about, close on him
    case 0:
      return install(e, EYEBALL.drift);
    /**
     * 180..260 — the only band it ever spits from, and it will not spit at a
     * back. `0x43e0a1` compares the player's mirror flag with its own and closes
     * instead when they agree, which is exactly the case where he is looking the
     * other way; a glob is for somebody facing it.
     */
    case 1: {
      if (k.player.facing === e.facing) return install(e, EYEBALL.drift);
      // `0x43e0ac` — and whatever it does next, it halves its sideways speed
      e.vx = e.vx / 2;
      const roll = k.roll(2);
      if (roll === 1) {
        // `0x43e0d0` — `0x402f00`, which this port reads as always true
        e.nerve = 0;
        k.say(e, EYEBALL.hawk);
        return install(e, EYEBALL.spit, true);
      }
      if (roll === 2) return install(e, EYEBALL.drift);
      break;
    }
    /**
     * 140..180 — nothing. The switch at `0x43e08d` has cases for 0, 1 and 3 and
     * no case for 2, so the middle band falls straight through to the tail: it
     * hovers where it is until its own four cels run out. Band −1 lands here
     * too, but `t.forward < 0` above has already turned it round.
     */
    case 2:
      break;
    // inside 140 — half the time it closes further, half the time it just hangs
    case 3:
      if (k.roll(2) === 1) return install(e, EYEBALL.drift);
      break;
    default:
      break;
  }
  /**
   * `0x43e11b` — the tail, and every install above falls INTO it in the
   * executable rather than returning.
   *
   * That costs nothing: `0x45d090` clears `obj+0x46` at `0x45d0db`, so a state
   * that has just installed something always reads its script as unfinished here
   * and takes the `je` back to the common exit. Returning at the install instead
   * of falling through is the same machine.
   */
  return done ? install(e, EYEBALL.hover) : false;
}

/**
 * State 5, `0x43e13d` — the swoop, six tags through the table at `0x43e7e8`.
 *
 * Climb to a point a hundred pixels above his head, home in on it, and then
 * carry him off by it. The class does the carry twice over, once per playable
 * character: `[0x46b1a8]` chooses tags 2 and 3 for the first and tags 4 and 5
 * for the second, with a sound each, and the two halves are otherwise the same
 * code twice (`0x43e259`/`0x43e3af` and `0x43e2f5`/`0x43e449`, instruction for
 * instruction). This port has one player, so it takes the first pair and names
 * the second in the table.
 *
 * **Nothing here reaches the player.** The carry writes his x, his y and his
 * vertical speed every frame (`0x43e2ab`…`0x43e2d4`), puts him in a held state
 * with `0x402fa0(-1)`, marks him held at `[0x46b1b4]`, and the shake takes
 * `0x402ac0(0xa)` — ten health — off him every frame it plays. All of that is
 * read and none of it is done: this file moves the eyeball and nothing else.
 *
 * And see {@link decide} for why the state is unreachable as things stand.
 */
function swoop(e: Enemy, k: BrainCtx, done: boolean): boolean {
  switch (e.tag ?? 0) {
    /**
     * tag 0, `0x43e151` — the climb, and it is one frame long in practice.
     *
     * It throws itself up at twenty-seven a frame and sideways at five towards
     * him, and then hands over unless it happens to already be within ten of the
     * strike height — in which case it holds, the climb carries it out of that
     * ten, and the next frame hands over anyway.
     */
    case 0: {
      e.vy = -CLIMB_RATE * TICKS;
      e.vx = (k.player.x >= e.x ? CLIMB_DRIFT : -CLIMB_DRIFT) * TICKS;
      if (Math.abs(k.player.y - STRIKE - e.y) <= ARRIVED) return false;
      return install(e, EYEBALL.dive);
    }
    /**
     * tag 1, `0x43e1a7` — the dive: a third of the remaining gap every frame,
     * in both axes, towards the point a hundred above his head.
     *
     * `0x43e1d2` and `0x43e1e8` are both `idiv ebp` with `ebp = 3`, so the
     * speeds are whole pixels truncated towards zero, not a smooth chase, and
     * the whole thing gives up after {@link DIVE_FRAMES}.
     */
    case 1: {
      // `0x43e1af` — he went down mid-dive, so there is nothing to catch
      if (k.player.down) return install(e, EYEBALL.hover);
      const stale = e.clock >= DIVE_FRAMES;
      const lift = k.player.y - STRIKE - e.y;
      const reach = k.player.x - e.x;
      e.vy = Math.trunc(lift / DIVE_DIVISOR) * TICKS;
      e.vx = Math.trunc(reach / DIVE_DIVISOR) * TICKS;
      if (Math.abs(lift) < LATCH_Y && Math.abs(reach) < LATCH_X) {
        k.say(e, EYEBALL.snatch);
        install(e, EYEBALL.carryA);
      }
      /**
       * `0x43e240` — and the countdown is spent whether it latched or not, so a
       * dive that latches on its last frame is overwritten by the hover one
       * frame later. That is what the executable does; it is reproduced rather
       * than tidied.
       */
      return stale ? install(e, EYEBALL.hover) : false;
    }
    /**
     * tags 2 and 4, `0x43e259`/`0x43e3af` — carrying him off, ten a frame up.
     *
     * `0x43e292` is the struggle in miniature: if he is facing the same way the
     * eyeball is, the eyeball flips itself, so the pair of them keep swapping
     * which way they look while he is held. Here it costs nothing but the flag.
     * The counter it feeds is zeroed as the shake goes on, `0x43e2e3`.
     */
    case 2:
    case 4: {
      e.vy = -CARRY_RATE * TICKS;
      k.say(e, e.tag === 4 ? EYEBALL.grabB : EYEBALL.grabA);
      if (k.player.facing === e.facing) e.facing = -e.facing;
      if (!done) return false;
      e.beat = 0;
      return install(e, e.tag === 4 ? EYEBALL.shakeB : EYEBALL.shakeA);
    }
    /**
     * tags 3 and 5, `0x43e2f5`/`0x43e449` — the shake, and how he gets out.
     *
     * `0x43e32d` counts `AI+2` up every frame he manages to face the way the
     * eyeball does, and `0x43e371` drops him the moment that passes four — or
     * the moment the script ends, whichever comes first. What it drops him into
     * is the kind-1 drift, not the hover.
     */
    case 3:
    case 5: {
      e.vy = -SHAKE_RATE * TICKS;
      // `0x43e2fa` — `0x402ac0(0xa)`, ten health a frame. Read, never spent.
      if (k.player.facing === e.facing) {
        e.facing = -e.facing;
        e.beat = (e.beat ?? 0) + 1;
      }
      if (!done && (e.beat ?? 0) <= STRUGGLE) return false;
      // `0x43e38c` — `0x402fa0(2)` hands him back to himself, and `[0x46b1b4]`
      return install(e, EYEBALL.drift);
    }
    default:
      return false;
  }
}

/**
 * State 6, `0x43e503` — the ladder, and the one state this port cannot finish.
 *
 * `AI+0x32` runs it in three phases and the first of them is a search of the
 * level: `0x43e529` pushes the length-prefixed string at `0x46eb14`, which is
 * **"ladder"**, through `0x404440` and hands it to `0x40b660` along with the
 * eyeball itself. What comes back is the nearest ladder's point and rect, which
 * `0x43e550` stores at `AI+0x38`, `AI+0x40` and `AI+0x44`, and only then does
 * `AI+0x32` become 2.
 *
 * **There is no scenery lookup in {@link BrainCtx}** — a brain sees the player,
 * its own record's rect and nothing else — so phase 1 cannot succeed here, and
 * that is not a shortcut: it is what `0x43e542` does on a level with no ladder
 * on it. `test ax, ax; je 0x43e696` drops straight to the tail, the tail
 * re-installs the same tag when the one-cel script ends, and the eyeball drifts
 * sideways at twenty a frame for as long as it lives. **An eyeball that reaches
 * state 6 in this port does not come back**, because the only way out is inside
 * phase 3. The door it comes in by is {@link decide}'s two-hundred-pixel test,
 * which the hover normally keeps it well clear of; if that turns out to bite, the
 * fix is a ladder lookup, not a change here.
 *
 * The two phases that need one are written out rather than guessed at:
 *
 * - **phase 2**, `0x43e56b`: face the ladder (`obj+0x28` from the sign of
 *   `AI+0x3a − self.x`), and once it is within **fifty** pixels of it sideways,
 *   stop dead, choose a direction — `AI+0x34` is **1** if the ladder's point is
 *   below it and **2** if it is above — install `0x472998` at that tag and go to
 *   phase 3.
 * - **phase 3**, `0x43e5d9`: climb. `AI+0x34` is re-decided every frame against
 *   the ladder's own top and bottom and the point a hundred above the player
 *   (`0x43e5e3` through `0x43e606`), and when the tag it wants differs from the
 *   one playing, `0x43e665` swaps the script — saving `obj+0x42`, the frame
 *   index, first and putting it back **± 0xc** afterwards, because the two climbs
 *   are twelve frames each and that keeps the flap in phase across the swap. It
 *   leaves the ladder at `0x43e629`: inside **a hundred** of his height and with
 *   him no longer climbing, back to the hover with `vy = -5` and `AI+0x32` = 0.
 */
function ladder(e: Enemy, done: boolean): boolean {
  switch (e.side ?? 0) {
    case 1:
      // `0x43e51f` — `0x40b660(<"ladder">, self, 0, -1, &out)`. See above: the
      // port has no scenery lookup, so this never advances past phase 1.
      break;
    default:
      break;
  }
  /**
   * `0x43e696` — the tail, which every phase falls into.
   *
   * Ten a frame is the vertical cap on a ladder rather than the fifty the drift
   * gets, and then the ordinary rule: when the script ends, put the same tag on
   * again. `obj+0x44` is what it re-installs with, so a climb keeps climbing and
   * the hunt keeps hunting.
   */
  if (Math.abs(e.vy) > LADDER_CAP * TICKS) e.vy = e.vy / 2;
  if (!done) return false;
  const tag = e.tag ?? 0;
  if (tag === 1) return install(e, EYEBALL.climbUp);
  if (tag === 2) return install(e, EYEBALL.climbDown);
  return install(e, EYEBALL.hunt);
}

export {
  NOT_HERE as EYEBALL_NOT_HERE,
  GLOB as EYEBALL_GLOB,
  HUM as EYEBALL_HUM,
};
