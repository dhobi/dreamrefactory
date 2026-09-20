/**
 * The bishop — `initvpriest`, think `0x425c90`, seven states.
 *
 * ## Its seven scripts, and therefore its seven states
 *
 * `0x45d090` writes a script's own kind into `obj+0x18`, so the kinds of the
 * scripts in `0x46f050`…`0x46f4be` ARE this machine's alphabet. The jump table
 * is `0x426314`, seven entries wide, and `0x425d21` guards it with
 * `cmp eax, 6; ja`:
 *
 * ```
 *   0  0x46f160  the statue — one cel, 2500, and the creator stands it on this
 *   1  0x46f170  the float — nine cels going nowhere; the state that DECIDES
 *   2  0x46f1c0  the attacks, sub-dispatched on the TAG through `0x426330`:
 *                  tag 0  the cast, fourteen cels, and it lets a bolt go
 *                  tag 1  the recoil, dx -30/-20/-10 authored into the script
 *                  tag 2  the summon, sixteen cels, and three bats come out
 *                  tag 3  the settle, four cels, back to the float
 *   3  0x46f2f0  the flinch — one cel, 2640 or 2641, three frames of it
 *   4  0x46f308  the VANISH — twelve cels, 2670..2681, and it comes back
 *   5  0x46f370  the re-form — the same twelve cels backwards, 2681..2670
 *   6  0x46f3d8  the death — 2640/2641 guttering, then 2670..2681, and gone
 * ```
 *
 * Two of those are a surprise and are worth saying out loud, because the page's
 * old hand-rolled reading had them the other way round. **`0x46f308` is not the
 * death.** `0x4264f0`, the hit handler, sends the bishop there when one blow is
 * big enough, and state 4 dissolves it, throws a dozen bats out of where it
 * stood, teleports it to one of them and re-forms it on kind 5. The death is
 * `0x46f3d8`, kind 6, and it is the one path in the whole function that answers
 * `mov ax, 1` (`0x426308`) — the frame the object is removed.
 *
 * ## What this module owns, and what it does not
 *
 * States 0, 1 and 2 — the statue, the float and the attacks — are the ones it is
 * in while it is on its feet, and those are here. States 3 to 6 are reached only
 * from the hit handler and the page already drives those through
 * {@link Foe.flinch} and {@link Foe.death}; a brain is never called while an
 * enemy is flinching or dying. They are named above so the next reader can see
 * what is deliberately elsewhere, and the four behaviours they carry that the
 * page does NOT have are written out at {@link NOT_HERE}.
 */
import {
  install,
  type Brain,
  type BrainCtx,
  type Enemy,
  TICK_SCALE,
} from "./kit";

/**
 * States 3 to 6, and what they do that the page's own flinch and death path
 * does not. Read, not done — the page owns those animations.
 *
 * - **the hit handler, `0x4264f0`.** It keeps the bishop's health in `AI+0`, not
 *   in the object, and takes the blow off it there (`0x42656c`). Then it sorts
 *   the blow three ways. Nothing at all left — `0x426599` — and it is the death,
 *   kind 6, with `belfry.snd 0x1e` and a downward shove of 30. Otherwise
 *   `0x426620` weighs the blow against **half of `AI+6`**, which the creator
 *   seeded at `0x40e300(0x4b0)` and which this handler then overwrites with each
 *   blow that passes the test (`0x426633`): a blow that big is the VANISH, kind
 *   4, with sound `0x1f`. Anything smaller is kind 3, the flinch, on
 *   `0x434540(2) - 1` — tag 0 or tag 1, one cel either way.
 * - **3**, the flinch: `0x4260b7` asks `0x4271b0` — the same "within sixty of
 *   the bound it faces" test as `k.atBound` — and a bishop pinned against its own
 *   bound is kicked 100 up and 100 along its facing to get it out of the corner.
 *   Then it bleeds two a frame off both velocities until the two cels are up.
 * - **4**, the vanish: `0x42615c` is the whole trick. Once its script has run it
 *   throws **twelve** bats out of itself through `0x426340`, records how many
 *   bats are then alive in `AI+4`, and holds — motionless, invisible — until that
 *   count has fallen to half (`0x4261f8`). Then `0x426450` picks the surviving
 *   bat nearest the player, or a point fifty pixels west of the player if none is
 *   within five hundred, drops the bishop there, plays `0x1c`, and hands to kind
 *   5. `AI+2` is the one-shot that stops it throwing the twelve twice.
 * - **6**, the death: `0x426258` bleeds the velocities to zero, and on an odd
 *   `obj+0x42` fires `0x40e4c0(0xe1)` and `0x4307c0(3)` — the end-of-chapter
 *   business. When the script ends it throws twelve more bats, calls `0x4263e0`
 *   — which kills every bat on the level, each with a lift of −40, `0x40d450(0x46)`
 *   of award and its own two-cel death `0x46f140` — and returns 1.
 */
const NOT_HERE = "0x4264f0, 0x4260b7, 0x42615c, 0x426248, 0x426258" as const;

/**
 * Its repertoire, by kind and tag, straight out of `0x46f160`…`0x46f3d8`.
 *
 * Every cel and hold below is the script's own. Only the recoil travels, and it
 * travels backwards: three records carrying dx −30, −20, −10, which through the
 * class's divisor of 10 (`0x425bdd` sets `obj+0xe`) is three, two and one pixel
 * of shuffle away from what it just threw. Nothing else in the class has a
 * stride at all — the bishop moves on its velocity and nothing else.
 */
export const VPRIEST = {
  /** kind 0 — one cel. `0x425c26`, the creation message, stands it on this */
  statue: { cels: [2500], hold: 1, kind: 0, tag: 0, from: "0x46f160 tag 0" },
  /** kind 1 — nine cels going nowhere: the float, and state 1 */
  float: {
    cels: [2500, 2501, 2502, 2503, 2504, 2505, 2506, 2507, 2508],
    hold: 2,
    kind: 1,
    tag: 0,
    from: "0x46f170 tag 0",
  },
  /** kind 2 tag 0 — fourteen cels, and the bolt leaves on the frame it ENDS */
  cast: {
    cels: [
      2600, 2601, 2602, 2603, 2604, 2605, 2606, 2607, 2608, 2609, 2610, 2611,
      2610, 2611,
    ],
    hold: 1,
    kind: 2,
    tag: 0,
    from: "0x46f1c0 tag 0",
  },
  /** kind 2 tag 1 — the recoil, and the shuffle back is in the script */
  recoil: {
    cels: [2612, 2613, 2614],
    hold: 1,
    dx: [-30, -20, -10],
    kind: 2,
    tag: 1,
    from: "0x46f1c0 tag 1",
  },
  /** kind 2 tag 2 — sixteen cels, and three bats come out of the end of it */
  summon: {
    cels: [
      2650, 2651, 2652, 2653, 2654, 2655, 2656, 2657, 2658, 2657, 2656, 2655,
      2654, 2652, 2652, 2653,
    ],
    hold: 1,
    kind: 2,
    tag: 2,
    from: "0x46f1c0 tag 2",
  },
  /** kind 2 tag 3 — what the summon settles on before floating again */
  settle: {
    cels: [2654, 2653, 2654, 2653],
    hold: 1,
    kind: 2,
    tag: 3,
    from: "0x46f1c0 tag 3",
  },
  /**
   * `0x46f4c0` — the descending list the creator hands `0x45ef70` at `0x41ec04`,
   * `dc 00 aa 00 64 00 00 00`: 220, 170, 100, and the zero `0x45ef9f` stops on.
   */
  bands: [220, 170, 100],
  /**
   * `0x4a5870` is the bank — `belfry.snd` — and these are the three ids a thing
   * on its feet plays. The rest of the class's are in {@link NOT_HERE}: `0x1c`
   * as it re-forms, `0x1e` as it dies, `0x1f` as it vanishes, and
   * `0x434540(2) + 0x18` — `0x19` or `0x1a` — on every blow that lands.
   */
  wake: 0x1d,
  chant: 0x18,
  hurl: 0x1b,
  /**
   * What the cast lets go — `0x426bc0`, called from `0x425fd6` on the frame the
   * fourteen cels run out, one object per cast.
   *
   * **A brain has no creator**, so nothing here spawns it; this is the record of
   * what it is so the caller can wire it later.
   *
   * - class `[0x46ecdc]`, proc `0x426c80`, hit handler `0x426e30`
   * - `0x426ca3` base cel **2700**, `0x426c9d` divisor **13**, `0x426cbc`
   *   gravity **0** — it floats dead level, it does not arc
   * - script `0x46f908` **tag 0**: one frame, cel 2700, **dx 600** — 600/13, so
   *   forty-six pixels an engine frame in the facing it was given. Tag 1, cels
   *   2700..2704, is what it plays when it stops being a bolt.
   * - spawned at `0x426bf7`/`0x426c0c`: the bishop's own point, **35 up** and
   *   **100 along its facing** (`+100` east, `−100` west), carrying the bishop's
   *   `obj+0x28` as its own.
   */
  /**
   * ...and it is the one cast in the game that is NOT wired, for a reason worth
   * writing down rather than leaving as a silence.
   *
   * Everything else about it is read. `0x426bc0` stands it a hundred in front
   * and thirty-five up, copies the facing, and installs `0x46f908` tag 0 —
   * `dx 600` over the class's own divisor of 13, so 46 pixels an engine frame;
   * `0x426c97` gives the class no weight, so it flies flat; `0x426db3` takes it
   * away on any collision word or at a thousand pixels from the player, the
   * same reach the spitter's gob keeps; and its hit handler `0x426e30` is
   * `mov ax, 1` — anything destroys it.
   *
   * What nothing does is write **`obj+0x1a`**. Not the spawner, not the class's
   * create, not its think — which is unlike every other projectile here, where
   * the strength is written at birth (the slug, the knife) or rewritten every
   * frame (the gob, the glob, the zombie's cloud, Igor's). A strength the
   * object never sets is whatever `0x42f550` left, and that is zero: a bolt
   * that cannot take a point off anybody. That may be right — this class also
   * has the fireball at `0x456240`, which levels.md calls "the one attack of
   * the six that exists to hit you" — or it may mean the strength arrives from
   * somewhere this reading has not found. Wiring a harmless bolt on a guess is
   * the wrong way to resolve it.
   */
  bolt: {
    cel: 2700,
    divisor: 13,
    dx: 600,
    up: 0x23,
    ahead: 0x64,
    /** 46 a frame: `dx 600` over `obj+0xe = 0xd` (`0x426c9d`) */
    speed: 46,
    /** `0x426ddd` — `|self.x − player.x| > 0x3e8`, the gob's own rule */
    reach: 0x3e8,
    /** `0x46f908` tag 1, which `0x426d9a` installs when the launch ends */
    flight: [2700, 2701, 2702, 2703, 2704],
    /** and nothing anywhere writes one — see above */
    strength: "never written",
    from: "0x426bc0 / 0x46f908 tag 0, class 0x426c80",
  },
  /**
   * ...and what the summon lets go: **three bats**, the very class `initbat`
   * places (creator `0x41ead0`, same `[0x46ecc4]` list, same `0x46f158` band
   * table of 600/250/50).
   *
   * `0x42601a` sets the loop count to three and `0x426340` makes each one:
   * sixty health (`0x4263a7`), the bishop's own record rect copied into its
   * `AI+4`/`AI+8`, the bishop's facing, `obj+0xc` = **±30** of sideways velocity
   * (`0x426394`), and script `0x46f060` **tag 1** — cel 2204, dx 4. `0x426346`
   * caps the whole level at sixteen of them.
   *
   * Each is placed, per `0x426031`…`0x426085`, at
   * `y − 0x23 + (roll(0x46) − 0x23)` and `x ± (0x26 + roll(0x23))` — so within
   * seventy above the bishop and thirty-nine to seventy-three out in front.
   */
  bat: {
    count: 3,
    health: 0x3c,
    vx: 0x1e,
    up: 0x23,
    upSpread: 0x46,
    ahead: 0x26,
    aheadSpread: 0x23,
    from: "0x426340 / 0x46f060 tag 1",
  },
  from: "0x425c90",
} as const;

/**
 * `0x425bdd` — `obj+0xe` is ten, and `0x42f8b0` divides every velocity delta by
 * it before adding it on. So the `±10` the float pushes with is one pixel an
 * engine frame, accumulating.
 */
const DIVISOR = 10;

/** an engine frame is two of this page's ticks, and `e.vx` is pixels per TICK */
const TICKS = TICK_SCALE;

/** `0x425d86` and `0x425de6` — ten a frame, sign taken from `obj+0x28` */
const DRIFT = 10;

/** `0x425ded` — inside twenty-five of his y it stops climbing and lets vy decay */
const ALIGNED = 0x19;

/** `0x425f40` — and inside thirty of it, mid-attack, it can bob up out of the way */
const DODGE_Y = 0x1e;

/** `0x425f62` — ninety pixels a frame of lift, which is what `0xfc7c / 10` is */
const DODGE_LIFT = -900;

/** `0x425e94` — the roll that reaches for the bats rather than the bolt */
const SUMMON_ROLL = 13;

/** `0x41ebc4`/`0x425e99` — `0x40e300(0x4b0)`, the twelve hundred it stands up with */
const HEALTH = 0x4b0;

/**
 * `0x42f8b0` — add a delta to `obj+0xa`/`obj+0xc`, through the divisor.
 *
 * The engine does this once an ENGINE frame and this page thinks twice a frame,
 * so half of it goes on a tick; and `e.vy`/`e.vx` are pixels per tick where the
 * engine's are pixels per frame, so the whole thing is scaled by {@link TICKS}
 * twice. Nothing caps it: `0x42f850(obj, 0)` gives the class no gravity and
 * `0x42f7a0(obj, 0)` leaves `obj+0x1e` zero, so `0x4302c0`'s drag never runs and
 * `0x430327`'s fall never runs either. What bounds it is the halving below —
 * every frame of an attack takes half of both back off.
 */
function shove(e: Enemy, dvy: number, dvx: number): void {
  e.vy += (dvy / DIVISOR) * TICKS * TICKS;
  e.vx += (dvx / DIVISOR) * TICKS * TICKS;
}

/**
 * `movsx eax, [esi+0xa]; cdq; sub eax, edx; sar eax, 1` — halve, toward zero.
 *
 * The engine's velocity is a whole number of pixels a frame and that sequence
 * truncates; this page's is fractional, so the truncation is not reproduced and
 * the decay is a clean halving instead.
 */
function halve(e: Enemy): void {
  e.vy /= 2;
  e.vx /= 2;
}

/**
 * `initvpriest`'s own machine, states 0, 1 and 2.
 *
 * ## The stack frame, which is where the field numbers come from
 *
 * `0x425c90` opens `sub esp, 0x40` and then takes the tracker's buffer with
 * `lea eax, [esp+4]` **before** it pushes anything, so the buffer is at
 * `entry − 0x3c`; four registers go on after it (ebx, esi, edi, ebp), which puts
 * the body's `esp` at `entry − 0x50` and the sixteen bytes at **`esp+0x14`**.
 * The argument slots pin it: `0x425cba` reads the object from `[esp+0x54]` and
 * `0x425c9a` read the AI struct from `[esp+0x54]` three pushes earlier, which is
 * `entry+4` and `entry+8`. So `esp+0x14` is `out+0` the side, `esp+0x18` is
 * `out+4` the BAND, `esp+0x1a` is `out+6`, `esp+0x1c` is `out+8` and `esp+0x1e`
 * is `out+0xa`, the forward distance. Read four low and `cmp [esp+0x18], 2` — the
 * band test the whole fight turns on — becomes a side test and still compiles.
 *
 * The other four bytes of frame that matter are `esp+0x10`: a `{word vy, word
 * vx}` pair the state builds and hands to `0x42f8b0`, and which `0x426040`
 * re-uses as a spawn point. `0x42f8b0` takes the LOW word into `obj+0xa` and the
 * HIGH word into `obj+0xc`, so `esp+0x10` is the lift and `esp+0x12` the stride.
 *
 * ## The AI struct, which is NOT the punk's
 *
 * `0x41eb70` allocates fifty bytes and fills in:
 *
 * ```
 *   AI+0     0x40e300(0x4b0)   HEALTH — this class keeps it here, not in the
 *                              object, and `0x4264f0` takes blows off it here
 *   AI+2     1                 a one-shot: "the vanish may throw its bats"
 *   AI+4     -                 how many bats were alive when it vanished
 *   AI+6     0x40e300(0x4b0)   the biggest blow it will shrug off, halved
 *   AI+8..f  the record rect   what state 0 tests the player's point against
 *   AI+0x10  the tracker input `0x45ef70(AI+0x10, obj, player, 0x46f4c0)`
 * ```
 *
 * So `AI+0` is `e.hp`, and there is no nerve, no beat, no decision budget and no
 * side in this class at all. `0x425cd3` hands `AI+0` and a fresh
 * `0x40e300(0x4b0)` to `0x40d1c0` whenever the player is in front and past band
 * 2 — that is the on-screen enemy bar's claim, not behaviour, and it is not
 * ported. Neither is `0x425d8d`, which keeps `obj+0x16` — the room id — in step
 * with the player's by testing its own point against `0x40ba30`'s rect for the
 * room the player has just walked into.
 *
 * ## And the return value
 *
 * Every path of `0x425c90` falls through `0x425d69`, which is
 * `xor ax, ax` with `mov word ptr [esi+0x1a], 0x64` beside it — the strength
 * percent, set to a hundred every frame, and **nothing hits the player back in
 * this port**, so it is carried as read. The single `mov ax, 1` is `0x426308`,
 * the frame the corpse goes. So every path here returns `false`, the waiting
 * ones included.
 */
export const vpriest: Brain = (e, foe, run, k) => {
  const done = e.clock >= run;
  const t = k.track(e, VPRIEST.bands);
  switch (e.script ?? 0) {
    /**
     * ---- 0, `0x425d2d`: the statue, and the one thing that ends it.
     *
     * `0x434200(player.point, AI+8)` — the player's own point inside the four
     * words the creator copied out of the level record. Not a sight line, not a
     * radius. The page has already done that test as `e.fighting`.
     */
    case 0:
      if (!e.fighting) return install(e, VPRIEST.statue);
      k.say(e, VPRIEST.wake);
      return install(e, VPRIEST.float);
    // ---- 1, `0x425d7a`: the float, and the only state that thinks every frame
    case 1:
      return hover(e, k, t, done);
    // ---- 2, `0x425f32`: the attacks, sub-dispatched on the tag by `0x426330`
    case 2:
      return attack(e, k, t, done);
    // 3 to 6 are the hit reactions and the page owns them — see NOT_HERE
    default:
      return false;
  }
};

/**
 * State 1, `0x425d7a` — the float: drift at him, climb to his height, and once
 * level with him decide whether to commit.
 *
 * It never walks. `0x46f170` carries no stride in any of its nine cels; the
 * whole of the approach is the pixel a frame `0x42f8b0` puts on `obj+0xc`.
 */
function hover(
  e: Enemy,
  k: BrainCtx,
  t: ReturnType<BrainCtx["track"]>,
  done: boolean,
): boolean {
  // `0x425d7a` — and this one does NOT return: it turns and carries on deciding
  if (t.forward < 0) e.facing = -e.facing;
  /**
   * `0x425ded` — the climb, and it is measured `obj+6` against `obj+6`: the
   * player's own y, not the top of him.
   *
   * `0x425cfd` adds fifty to it while the player's own `obj+0x18` is 6 — one of
   * his upright scripts, which this page does not model and which is therefore
   * the one number in this state left out rather than guessed.
   */
  const drop = k.player.y - e.y;
  let lift = 0;
  let level = false;
  if (drop > ALIGNED) lift = DRIFT;
  else if (-drop > ALIGNED) lift = -DRIFT;
  else {
    level = true;
    // `0x425e2c` — level with him, the climb stops and what is left of it decays
    e.vy /= 2;
  }
  // `0x425d86`/`0x425de6` — ten a frame along the facing, whatever else happens
  shove(e, lift, DRIFT * e.facing);
  /**
   * `0x425f07` — with the player down it only sets its facing, and it sets it
   * the wrong way round.
   *
   * `cmp [player+8], cx; jg` keeps `obj+0x28` at **1** when the player is EAST
   * of it, and 1 is the mirror flag's west: the drift above then carries it away
   * from a man on the floor. The punk's `0x44e710` is the identical four
   * instructions — `werea.ts` ports them as turning TOWARDS him, which reads
   * better and is not what either function does. Read literally here.
   */
  if (k.player.down) {
    e.facing = k.player.x > e.x ? -1 : 1;
    return tail(e, done);
  }
  /**
   * `0x425e51` — the band, and the dispatch is a plain chain of three compares.
   *
   * Band 0 is beyond 220 and band −1 is behind it: both fall straight out.
   * Band 1 — 170 to 220 — is a roll, and it is **eight in ten**, not three:
   * `0x434540(10)` answers 1..10 and `cmp eax, 3; jl` is what walks away. Bands
   * 2 and 3, anything inside 170, always consider.
   */
  let commit: boolean;
  if (t.band === 1) commit = k.roll(10) >= 3;
  else if (t.band === 2 || t.band === 3) commit = true;
  else commit = false;
  // `0x425e81` — and nothing is thrown at all until it is level with him
  if (!commit || !level) return tail(e, done);
  /**
   * `0x425e8a` — thirteen in forty-two reaches for the bats, and then only when
   * it is hurt.
   *
   * `0x425e99` recomputes `0x40e300(0x4b0)`, halves it, and compares it with
   * `AI+0`: still above half its twelve hundred and it casts anyway. So the
   * summon is what a **wounded** bishop does, roughly one commitment in three,
   * and a healthy one only ever throws.
   */
  if (k.roll(0x2a) <= SUMMON_ROLL && k.scaled(HEALTH) / 2 >= e.hp) {
    return install(e, VPRIEST.summon, true);
  }
  // `0x425ec6` — it drops half its drift into the cast and calls out
  halve(e);
  k.say(e, VPRIEST.chant);
  return install(e, VPRIEST.cast, true);
}

/**
 * `0x425f22` — nothing was chosen, so the float plays on and is put back on when
 * it runs out. `0x425f2d` jumps into state 0's own installer to do it.
 */
function tail(e: Enemy, done: boolean): false {
  if (!done) return false;
  return install(e, VPRIEST.float);
}

/**
 * State 2, `0x425f32` — the attacks, and the dodge that runs under all four.
 *
 * The dodge comes BEFORE the tag dispatch, so it is asked on every frame of
 * every one of the four scripts: level with him within thirty, with the player
 * facing this way and carrying velocity (`out+0 == 1`), it rolls 1..100 and on
 * anything under thirty throws ninety pixels a frame of lift into itself and
 * floats up out of the swing. Tags 0 and 2 then halve that away again over the
 * frames that follow, which is what keeps it from leaving the screen.
 */
function attack(
  e: Enemy,
  k: BrainCtx,
  t: ReturnType<BrainCtx["track"]>,
  done: boolean,
): boolean {
  // `0x425f32`/`0x425f45`/`0x425f4c` — the three gates, in that order
  if (
    Math.abs(e.y - k.player.y) < DODGE_Y &&
    t.side === 1 &&
    k.roll(100) < 30
  ) {
    shove(e, DODGE_LIFT, 0);
  }
  switch (e.tag ?? 0) {
    /**
     * ---- tag 0, `0x425f8b`: the cast.
     *
     * Fourteen cels with both velocities halved under every one of them, so it
     * hangs still while it casts. `0x425fb2` hands to the recoil, calls out on
     * `0x1b`, and `0x425fd6` is `0x426bc0` — the bolt. See {@link VPRIEST.bolt}:
     * a brain has no creator, so the bolt is documented and not made here.
     */
    case 0:
      halve(e);
      if (!done) return false;
      k.say(e, VPRIEST.hurl);
      return install(e, VPRIEST.recoil, true);
    // ---- tag 1, `0x425fe3`: the recoil shuffles back on its own dx and is done
    case 1:
      return done ? install(e, VPRIEST.float) : false;
    /**
     * ---- tag 2, `0x425ff3`: the summon.
     *
     * The same halving under sixteen cels, and then `0x42601a` counts three bats
     * out through `0x426340` before handing to the settle. See
     * {@link VPRIEST.bat} — again, no creator here.
     */
    case 2:
      halve(e);
      if (!done) return false;
      return install(e, VPRIEST.settle, true);
    // ---- tag 3, `0x4260a7`: and the settle just ends, back into the float
    default:
      return done ? install(e, VPRIEST.float) : false;
  }
}

export { NOT_HERE as VPRIEST_NOT_HERE };
