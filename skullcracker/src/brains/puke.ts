/**
 * The spitter — `initpuke`, think function `0x417ed0`, seven states.
 *
 * ## It is not a puncher, and nothing it plays carries a strike box
 *
 * Every other class in this port reaches the player with a cel. This one does
 * not: its whole offence is an object it SPAWNS. `0x418400` is the spawner,
 * state 4 is the only thing that calls it, and the thing it makes is a member
 * of a different class altogether — see {@link PUKE_SPIT}, which carries the
 * class, the script, the spawn offset and the launch speed so the projectile
 * can be wired later. A brain has no creator, so this module ports the
 * animation, the timing and the sound of the spit and nothing else.
 *
 * **This class belongs to a different chapter from `initwerea`.** Its cels are
 * the 3000 block and its sound bank is `0x4a56d0`, not the punk's `0x4a7910`;
 * no number in this file came out of `werea.ts`.
 *
 * ## Its seven scripts, and therefore its seven states
 *
 * `0x45d090` copies word 4 of a script's header into `obj+0x18`, so the KIND
 * printed below is the jump-table index at `0x418224`. Walked out of the
 * class's data region starting from the `push 0x<addr>` operands of the
 * `call 0x45d090` sites in `0x417ed0` and in the hit handler `0x418250`:
 *
 * ```
 *   0  0x46c9e8   1 frame,  1 tick  — cel 3000, standing still: the patrol
 *   1  0x46ca30   5 frames, 1 tick  — cels 3000..3004, dx 93: the walk
 *   2  0x46c9f8   6 frames, 2 ticks — cels 3090..3095: the stance, and the
 *                                     state that DECIDES
 *   3  0x46cac0  17 frames, 1 tick  — tag 0 the charge (3050..3057, strides up
 *                                     to 279), tag 1 the run-out (3070..3078)
 *   4  0x46ca60  11 frames, 2 ticks — tag 0 the high spit (3010..3014),
 *                                     tag 1 the low spit (3020..3025)
 *   5  0x46cb50  17 frames, 1 tick  — the three flinches
 *   6  0x46cbe0   6 frames, 2 ticks — the death, cels 3080..3085
 * ```
 *
 * ## What this module owns, and what it does not
 *
 * States 0 to 4 are everything a spitter does on its feet and they are all
 * here. States 5 and 6 are the hit reactions, which the page already drives
 * through {@link Foe.flinch}, {@link Foe.pick} and {@link Foe.death} — a brain
 * is never called while an enemy is flinching or dying — and what they and the
 * class's own hit handler do beyond playing a script is named at
 * {@link NOT_HERE}.
 *
 * ## The AI struct, which is NOT the punk's
 *
 * `0x411710` allocates `0x2e` bytes and lays them out like this:
 *
 * ```
 *   AI+0x00  word   HEALTH — `0x40e300(0x190)` at `0x411758`, so 400 scaled by
 *                   difficulty. `0x4182e0` subtracts the blow from it and
 *                   `0x4182ee` reads it against zero to decide the death.
 *   AI+0x02  4 words the record's own rect — `0x411776`/`0x411778` copy the two
 *                   points the level record handed the creator. `0x417f68`
 *                   tests the player's point against it, which is this page's
 *                   `e.fighting`.
 *   AI+0x0a  ...    the tracker input `0x45ef70` seeds at `0x411789`
 *   AI+0x2c  word   the corpse's remaining frames — `0x41177b` zeroes it,
 *                   `0x418351` loads it with `[0x46b204]` on the death and
 *                   `0x4181e1` counts it down
 * ```
 *
 * There is **no nerve, no beat, no decision budget and no side** anywhere in
 * it. The punk's `AI+0`/`AI+2`/`AI+4`/`AI+6` have no counterpart here, so this
 * brain touches none of {@link Enemy.nerve}, {@link Enemy.beat},
 * {@link Enemy.decisions} or {@link Enemy.side}: reading `AI+0` as a nerve
 * would be reading this class's HEALTH, which the page owns as {@link Enemy.hp}
 * and which nothing in a think function may spend.
 *
 * ## The stack frame
 *
 * `0x417ed0` does `sub esp, 0xc`, takes the buffer address with `lea eax,
 * [esp]` **before** pushing `ebx`, `esi` and `edi`, and then pushes the two
 * arguments to `0x45efd0`. So after `add esp, 8` at `0x417ee8` the sixteen
 * bytes the tracker filled sit at **`esp+0xc`**.
 *
 * What pins it is the argument slots: `0x417eda` reads the AI struct from
 * `[esp+0x20]` and `0x417ef9` reads the object from `[esp+0x1c]`, and with
 * three registers pushed above a `sub esp, 0xc` frame those are exactly
 * `arg1` and `arg0`. That leaves `esp+0xc` for `out+0`, so `esp+0x10` is
 * `out+4` the BAND, `esp+0x12` is `out+6` the player's strike box, and
 * `esp+0x16` is `out+0xa` the forward distance. `0x418018` reads `esp+0x10`
 * against 3 — the band list has exactly three entries, so 3 is its innermost
 * band and nothing else in the sixteen bytes ranges 0..3 — and `0x417ef3`
 * reads `esp+0x16` against 0 for "is he behind me". Four bytes low and the
 * band switch would be reading `out+0`, the side, which is 0..2 and would
 * still have compiled.
 *
 * ## The band list
 *
 * `0x41178e` hands `0x46cc18` to `0x45ef70` as its fourth argument, and
 * `0x45ef8a` walks it until a word stops being positive: **280, 180, 110**,
 * terminated by the zero at `0x46cc1e`. So band 0 is beyond 280, band 1 is
 * 180..280, band 2 is 110..180, band 3 is inside 110, and −1 is behind.
 */
import { install, type Brain, type BrainCtx, type CastKit, type Enemy } from "./kit";

/**
 * The five things `0x417ed0` and its hit handler do that this port has nowhere
 * to put, and the two states the page owns. Read, not done.
 *
 * - **The enemy bar**, `0x417eeb`. Before the dispatch, and only when the
 *   player is in front (`out+0xa > 0`), inside band 1 or nearer, and the state
 *   is neither 0 nor 6, it calls
 *   `0x40d1c0(AI+0, 0x40e300(0x190), 0x33f5, self.point)` — its health against
 *   the same 400 the creator seeded, claiming the on-screen bar. That is
 *   chrome, not behaviour.
 * - **`obj+0x1a = 0x64`**, `0x418216`. Every returning path of the think
 *   function sets this class's strength to 100 on the way out. Nothing hits the
 *   player back in this port, so it is carried as read and spends nothing.
 * - **State 5**, the flinch, `0x4181c8`: when the flinch script ends it puts
 *   the stance back on. Which of the three flinches plays is the hit handler's
 *   choice, not the machine's — `0x41837c` takes tag 1 for a blow under `0x1e`
 *   strength, and otherwise `0x41839d` compares the spitter's own Y against the
 *   Y the blow arrived at and takes tag 0 when it stands lower, tag 2 when it
 *   does not. `0x418360` squeals `0x434540(2) + 5`, so sound 6 or 7.
 * - **State 6**, the corpse, `0x4181e1`: it counts `AI+0x2c` down, writes
 *   `obj+0x10 = -12` every frame it is still there, and on the frame the count
 *   goes negative calls `0x40cba0(self.point, -13, 0)` and returns **1** — the
 *   single path in the whole class that does not return zero. `[0x46b204]` is
 *   what `0x418351` loaded that count with, which is the page's
 *   {@link Enemy.linger}.
 * - **The death**, `0x4182f0`: clears the bar with `0x40d1c0(0,0,0,…)`, says
 *   sound 5, installs `0x46cbe0` and only then sets the corpse count.
 */
const NOT_HERE = "0x417eeb, 0x418216, 0x4181c8, 0x4181e1, 0x4182f0" as const;

/**
 * Its repertoire, by kind and tag, straight out of `0x46c9e8`…`0x46cbe0`.
 *
 * Every cel, hold and stride below is the script's own, read with
 * `scdis anims <addr>:full`. **None of them carries a strike box** — this class
 * does not reach the player with a cel at all, it spits, and the projectile is
 * the hit. See {@link PUKE_SPIT}.
 *
 * The flinches (`0x46cb50`, kind 5, tags 0/1/2 = cels 3034..3030, 3032..3030,
 * 3038..3035) and the death (`0x46cbe0`, kind 6, cels 3080..3085) are not in
 * this table on purpose: the page owns those animations, and two owners for one
 * animation is what {@link NOT_HERE} exists to prevent.
 */
export const PUKE = {
  /** kind 0 — one cel going nowhere. A spitter out of its rect just stands */
  idle: { cels: [3000], hold: 1, kind: 0, tag: 0, from: "0x46c9e8 tag 0" },
  /** kind 1 — the only walk it has, and every stride is the same 93 */
  walk: {
    cels: [3000, 3001, 3002, 3003, 3004],
    hold: 1,
    dx: [93, 93, 93, 93, 93],
    kind: 1,
    tag: 0,
    from: "0x46ca30 tag 0",
  },
  /** kind 2 — six cels going nowhere: the stance, and the state that decides */
  stance: {
    cels: [3090, 3091, 3092, 3093, 3094, 3095],
    hold: 2,
    kind: 2,
    tag: 0,
    from: "0x46c9f8 tag 0",
  },
  /**
   * kind 3 tag 0 — the charge, and the strides are the story: 186, 93, 186,
   * 93, 279, 93, 279, 93. It does not stop at the player, it runs THROUGH him.
   */
  charge: {
    cels: [3050, 3051, 3052, 3053, 3054, 3055, 3056, 3057],
    hold: 1,
    dx: [186, 93, 186, 93, 279, 93, 279, 93],
    kind: 3,
    tag: 0,
    from: "0x46cac0 tag 0",
  },
  /**
   * kind 3 tag 1 — the run-out the charge always hands to. Seven more strides
   * of 93 and two frames standing, and `0x418167` flips the facing at the end
   * of it, so the pair is a charge past and a turn round.
   */
  runOut: {
    cels: [3070, 3071, 3072, 3073, 3074, 3075, 3076, 3077, 3078],
    hold: 1,
    dx: [93, 93, 93, 93, 93, 93, 93, 0, 0],
    kind: 3,
    tag: 1,
    from: "0x46cac0 tag 1",
  },
  /**
   * kind 4 tag 0 — the high spit. `0x418400` takes 0x41 off the gob's Y for
   * this tag, so it leaves the mouth; the animation itself travels nowhere.
   */
  spitHigh: {
    cels: [3010, 3011, 3012, 3013, 3014],
    hold: 2,
    kind: 4,
    tag: 0,
    from: "0x46ca60 tag 0",
  },
  /** kind 4 tag 1 — the low spit; the gob leaves at the spitter's own Y */
  spitLow: {
    cels: [3020, 3021, 3022, 3023, 3024, 3025],
    hold: 2,
    kind: 4,
    tag: 1,
    from: "0x46ca60 tag 1",
  },
  /** `0x46cc18`, the fourth argument of `0x45ef70` at `0x411789` */
  bands: [280, 180, 110],
  /**
   * `0x4a56d0` — this chapter's bank, NOT the punk's `0x4a7910`.
   *
   * - `advance` `0xa`, `0x417fc8`/`0x418033`/`0x418088`/`0x4180c5` — every path
   *   that puts the walk on says it
   * - `charge` `9`, `0x4180de` — the one that goes with the charge
   * - `spit` `8`, `0x4181a9` — and `spitAlt` `4` at `0x4181a5` is the branch
   *   that can never be taken; see {@link puke} case 4
   */
  voice: { advance: 0xa, charge: 9, spit: 8, spitAlt: 4 },
  from: "0x417ed0",
} as const;

/**
 * The projectile — a DIFFERENT class, and the only thing this one hits with.
 *
 * Nothing here is installed by {@link puke}: the brain's case 4 calls
 * `0x418400`, which makes an object of another class, and that object runs its
 * own machine. These are the facts the wiring will need.
 *
 * ## The class
 *
 * Its message proc is `0x4184c0` and its class list lives in `[0x46cc60]`,
 * built by `0x4184a0`. `0x4184d7` is its create: it takes the same cel bank as
 * the spitter (`0x4a5178`), a base cel of `0xbf8` = **3064**, `obj+0xe = 0xd`
 * — the divisor every stride in its script is spent through — `0x42f850(obj,
 * 0)` so it has no weight and flies flat, `0x42f840(obj, 0xf)` for its flags,
 * a hit handler at `0x418640`, and then installs `0x46cc28` tag 0. Its think
 * function is `0x4185b0`.
 *
 * ## The spawn — `0x418400(spitter, tag)`
 *
 * Two bytes of AI, an object on `[0x46cc60]`, and then:
 *
 * - `0x41842b` copies the spitter's mirror flag, so the gob faces the way the
 *   spitter does;
 * - `0x418433` copies the spitter's point, Y and X together;
 * - `0x41843b` — **and only when the tag is 0** — takes `0x41` = **65** off the
 *   Y, which is the high spit leaving the mouth;
 * - `0x418440` adds **+100 to X facing east, −100 facing west**, so the gob
 *   starts a hundred pixels in front either way.
 *
 * No velocity is written here. The gob gets its speed from its own script.
 *
 * ## The script — `0x46cc28`, kind 0, ticksPerFrame 1
 *
 * ```
 *   tag 0  1 frame   cel 3064, dx 400   — the launch
 *   tag 1  5 frames  cels 3064, 3063, 3062, 3061, 3060, no stride — the flight
 * ```
 *
 * Tag 0 is one frame long, so it ends on its first tick; `0x4185d7` sees
 * `obj+0x46` and installs tag 1. What the one frame does is spend its `dx`
 * through `0x42f8b0`, which adds `dx / obj+0xe` to `obj+0xc` — **400 / 13,
 * rounded away from zero, so 31 pixels a tick** in the facing direction, and
 * that velocity persists for the rest of the gob's life. Tag 1 carries no
 * stride at all: it is the gob coasting.
 *
 * ## What ends it
 *
 * `0x4185f0`, tag 1 only: any of `obj+0x2a`, `obj+0x2c`, `obj+0x2e` or
 * `obj+0x30` going non-zero — the collision words — removes it, and so does
 * `0x418621`, `|self.x − player.x| > 0x3e8` = 1000. `0x41862c` sets its
 * strength `obj+0x1a` to `0x64` = 100 every frame, and its hit handler
 * `0x418640` answers 1 for any blow with a strength above zero, so a swing
 * destroys a gob in flight.
 */
export const PUKE_SPIT = {
  /** `0x4184a0` builds it, `0x4184c0` is the proc, `0x4185b0` the think */
  classList: "0x46cc60",
  proc: "0x4184c0",
  think: "0x4185b0",
  hit: "0x418640",
  /** `0x4181be` — the only caller, and the only thing that makes one */
  spawner: "0x418400",
  /** kind 0 tag 0 — one frame, and its `dx` IS the launch impulse */
  launch: {
    cels: [3064],
    hold: 1,
    dx: [400],
    kind: 0,
    tag: 0,
    from: "0x46cc28 tag 0",
  },
  /** kind 0 tag 1 — the gob coasting on what tag 0 gave it */
  flight: {
    cels: [3064, 3063, 3062, 3061, 3060],
    hold: 1,
    kind: 0,
    tag: 1,
    from: "0x46cc28 tag 1",
  },
  /** `0x41843b` — the high spit only, and it is a LIFT: Y less 65 */
  liftHigh: 0x41,
  /** `0x418440` — a hundred pixels in front, whichever way it faces */
  ahead: 100,
  /** `0x42f8b0` against `obj+0xe = 0xd`: ceil(400 / 13) pixels a tick */
  divisor: 0xd,
  speed: 31,
  /** `0x418621` — and it is gone once it is this far from the player in X */
  reach: 0x3e8,
  /** `0x41862c` — its `obj+0x1a`, rewritten every frame it is in the air */
  strength: 0x64,
  from: "0x418400",
} as const;

/**
 * The gob as the page throws it — every number is {@link PUKE_SPIT}'s, by name
 * rather than by copy.
 *
 * The lift is the HIGH spit's, and it is the only one that is ever used: see
 * case 4 below for why the executable cannot reach its own low-spit spawn.
 */
export const PUKE_GOB: CastKit = {
  cels: PUKE_SPIT.flight.cels,
  hold: PUKE_SPIT.flight.hold,
  speed: PUKE_SPIT.speed,
  ahead: PUKE_SPIT.ahead,
  lift: PUKE_SPIT.liftHigh,
  blow: PUKE_SPIT.strength,
  reach: PUKE_SPIT.reach,
  from: "0x418400, script 0x46cc28",
};

/**
 * `initpuke`'s own machine, states 0 to 4.
 *
 * ## Every path returns false
 *
 * A think function never suppresses the animation. `0x418212` is where all
 * five of these states end — `xor ax, ax` — including the "my script has not
 * finished" return that most of them take most frames. The only `mov ax, 1` in
 * the whole class is `0x4181fe`, the frame the corpse is removed, and that is
 * state 6, which the page owns. So every branch below answers `false`.
 *
 * ## The roll comes before the dispatch
 *
 * `0x417f37` calls `0x434540(0x190)` — 1..400 — into `bx` on EVERY frame,
 * before it has even looked at the state, and only state 2 ever reads it. It
 * is rolled here in the same place for the same reason.
 */
export const puke: Brain = (e, foe, run, k) => {
  const done = e.clock >= run;
  const t = k.track(e, PUKE.bands);
  // `0x417f37` — rand(1..400), rolled every frame whether or not it is spent
  const roll = k.roll(0x190);
  switch (e.script ?? 0) {
    /**
     * ---- 0, `0x417f5b`: the patrol, which is not a patrol at all.
     *
     * Kind 0 is a single cel with no stride, and the state does exactly one
     * thing: `0x434200(player.point, AI+2)`, the player's own point inside the
     * rect the level record handed the creator. Nothing else ends it — no
     * radius, no sight line — and there is no walking in it. A spitter outside
     * its patch is a statue.
     */
    case 0:
      return e.fighting ? install(e, PUKE.stance) : false;
    /**
     * ---- 1, `0x417f8e`: the walk, and all it does is end facing him.
     */
    case 1:
      if (!done) return false;
      if (t.forward < 0) e.facing = -e.facing;
      return install(e, PUKE.stance);
    // ---- 2, `0x417fba`: the stance, and the whole of the fight
    case 2:
      return decide(e, k, t, done, roll);
    /**
     * ---- 3, `0x41811d`: the charge, which is two scripts and a turn.
     *
     * It sub-dispatches on `obj+0x44`, the tag now playing. Tag 0 — the eight
     * long strides — hands to tag 1 when it ends, and tag 1 hands back to the
     * stance with `0x418167` flipping the mirror flag on the way. Neither half
     * looks at the player: once this is committed to it runs its course.
     */
    case 3: {
      const tag = e.tag ?? 0;
      if (tag !== 0 && tag !== 1) return false;
      if (!done) return false;
      if (tag === 0) return install(e, PUKE.runOut, true);
      install(e, PUKE.stance);
      e.facing = -e.facing;
      return false;
    }
    /**
     * ---- 4, `0x418173`: the spit, and the gob leaves at the END of it.
     *
     * Turn to face him, wait for the animation to finish, put the stance back
     * on, say the spit, and only then call `0x418400`.
     *
     * ## The tag it spits with is always 0, and that is the executable's doing
     *
     * `0x41819d` reads `obj+0x44` to pick the sound and `0x4181b5` reads it
     * again to pick the spawn tag — but both reads happen **after**
     * `0x418192` has installed the stance, and `0x45d0d6` writes the requested
     * tag into `obj+0x44` as part of installing. By the time either read runs
     * the tag is the stance's own 0, so the `push 4` at `0x4181a5` is
     * unreachable and `0x418400` is never called with anything but 0. That is
     * checked in the raw bytes, not inferred: `66 83 7e 44 00` sits at
     * `0x41819d`, after the `e8` to `0x45d090`.
     *
     * The visible consequence is that the LOW spit still plays its own
     * animation — `0x4180d1` really does install `0x46ca60` tag 1 — but the gob
     * it throws is the high one, spawned 65 pixels above the feet. Ported as
     * the executable does it; do not "fix" it here.
     */
    case 4: {
      if (t.forward < 0) e.facing = -e.facing;
      if (!done) return false;
      install(e, PUKE.stance);
      k.say(e, PUKE.voice.spit);
      // `0x4181be` — `0x418400(self, 0)`, the gob, and this is the instruction
      // it happens at: the stance is already on and the sound already said.
      k.cast(e, PUKE_GOB);
      return false;
    }
    default:
      return false;
  }
};

/**
 * State 2, `0x417fba` — the stance, and the only state that thinks.
 *
 * Three things in order: the player on the floor, the facing, and the band.
 */
function decide(
  e: Enemy,
  k: BrainCtx,
  t: ReturnType<BrainCtx["track"]>,
  done: boolean,
  roll: number,
): boolean {
  /**
   * `0x417fba` — `0x402f60` is "the player is upright", and its negation is
   * this branch: it says the advance sound, puts the walk on, and then faces
   * **away** from him.
   *
   * `0x417ff0` compares the player's X against its own and sets `obj+0x28` to
   * 1 — facing west — when the player is to the EAST, which is the opposite of
   * every other class's turn-towards. It is not a misread: `0x45eff3` negates
   * the forward distance when `obj+0x28` is set, which is what fixes 1 as
   * west, and the walk's stride is spent in the facing direction. A spitter
   * backs off a downed player rather than standing over him, which is what a
   * thing that fights at 280 pixels would want.
   */
  if (k.player.down) {
    k.say(e, PUKE.voice.advance);
    install(e, PUKE.walk);
    e.facing = k.player.x > e.x ? -1 : 1;
    return false;
  }
  // `0x41800c` — and with him upright it turns towards him first
  if (t.forward < 0) e.facing = -e.facing;
  /**
   * `0x418018` — `cmp eax, 3; ja` is UNSIGNED, so band −1 lands in the
   * default with everything above 3: the player is behind, and it holds the
   * stance rather than choosing anything.
   */
  switch (t.band) {
    // beyond 280 — it walks in, and says so
    case 0:
      k.say(e, PUKE.voice.advance);
      return install(e, PUKE.walk);
    /**
     * 180..280, `0x41804c` — the band it mostly ignores.
     *
     * `cmp word ptr [esp+0x12], 0` is `out+6`, the player's own cel carrying a
     * strike box. Unless he is mid-blow, a roll of 40 or more out of 400 ends
     * the frame with nothing chosen — so nine times in ten at this distance it
     * just keeps swaying. When it does act, the low bit of the same roll picks
     * between walking in and the HIGH spit.
     */
    case 1:
      if (!k.player.swinging && roll >= 0x28) break;
      if (roll % 2 !== 0) {
        install(e, PUKE.walk);
        k.say(e, PUKE.voice.advance);
        return false;
      }
      return install(e, PUKE.spitHigh, true);
    /**
     * 110..180, `0x41809b` — the same coin, no gate on it at all, and the
     * other half is the LOW spit. This is the band the class is built for.
     */
    case 2:
      if (roll % 2 !== 0) {
        install(e, PUKE.walk);
        k.say(e, PUKE.voice.advance);
        return false;
      }
      return install(e, PUKE.spitLow, true);
    // inside 110, `0x4180da` — too close to spit, so it charges through him
    case 3:
      k.say(e, PUKE.voice.charge);
      return install(e, PUKE.charge, true);
    default:
      break;
  }
  /**
   * `0x4180fd` — and the frames that chose nothing fall to here: hold the
   * stance until it ends, then start it again.
   *
   * The branches above reach this too, but harmlessly: `0x45d0db` clears
   * `obj+0x46` as part of installing, so a state that has just chosen a script
   * always fails this test on the same frame.
   */
  if (!done) return false;
  return install(e, PUKE.stance);
}

export { NOT_HERE as PUKE_NOT_HERE };
