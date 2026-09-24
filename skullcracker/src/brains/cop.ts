/**
 * The TCop — `initcop`, creator `0x411660`, class `0x413f00`, think function
 * `0x413fd0`, jump table `0x4146e4`, hit handler `0x4147d0`.
 *
 * Chapter FOUR's opening act and `lab.snd` names it outright: `#0084 TCop
 * Dies`, `#0085 TCop eats`, four `#0087…#0090 TCop punc[h]`es. Nineteen of
 * them, seven in MAZE and twelve in BARREL, 250 health and 550 points.
 *
 * ## Its twelve scripts, and therefore its twelve states
 *
 * `0x45d090` copies a script's own kind into `obj+0x18`, so the class's script
 * list IS the alphabet its jump table spells. The twelve sit end to end from
 * `0x46c628` to `0x46c9a8` and the band list `0x46c9d8` follows the last of
 * them:
 *
 * ```
 *   0  0x46c628  one cel, and the whole of the patrol
 *   1  0x46c638  the stance — and the state that DECIDES
 *   2  0x46c788  tag 0 the slug gun up, tag 1 the shot, tag 2 down again
 *   3  0x46c660  five swings: 0 the wind-up, 1 and 2 travel, 3 and 4 stand
 *   4  0x46c720  tag 0 the walk in at 65, tag 1 the walk out at −195…−65
 *   5  0x46c840  eight cels of the doughnut, and forty health back
 *   6  0x46c7d8  the two cels it stands on while the player is down
 *   7  0x46c7f0  the same two cels three times over — NOTHING installs it
 *   8  0x46c828  the flinch
 *   9  0x46c8f0  the GUNNER: 0 the run in, 1 the run out, 2 the spray, 3 its death
 *  10  0x46c888  the switch run — 0 the turn, 1 the run to it, 2 the reach
 *  11  0x46c9a8  the death it gets standing up
 * ```
 *
 * ## What this module owns, and what it does not
 *
 * Ten of the twelve — 0 to 9 — are here. 8 is the flinch's aftermath: the
 * page plays `0x46c828` through {@link Foe.flinch} and hands kind 8 back when
 * it ends. 11 is the death, which the page drives through {@link Foe.death}; a
 * brain is never called while a thing is dying. **10 is the lever**, and the page owns that
 * too — {@link Foe.lever}, and {@link stepFight} returns before any brain while
 * an unlit switch is still standing in this one's rect, so the machine below is
 * only ever reached once there is none. What those three do that the page's own
 * paths do not is written out at {@link NOT_HERE}.
 *
 * ## The two TCops, and the one word that tells them apart
 *
 * `0x4116e2` files the **record's own `param`** at `AI+0x32`, and three places
 * read it: `0x414131` and `0x4141a2`, which send a cop with a param into kind 9
 * instead of kind 2, and `0x4148ed`, which gives it kind 9 tag 3 to die on
 * rather than kind 11. So a param-0 cop is the one with the slug gun — raise,
 * one shot, lower — and a param-1 cop is the GUNNER, who shuffles in and out on
 * cels 2110…2115 and sprays on 2120/2121. BARREL places seven of the latter and
 * five of the former; all seven of MAZE's are param 0.
 *
 * {@link gunner} reads it off {@link Enemy.param}, which the level fills from
 * the record, and so does the page's own death choice, {@link Foe.deathFor}.
 *
 * ## Its AI struct, which is not the punk's
 *
 * `0x411660` allocates sixty-four bytes and lays them out its own way:
 *
 * | slot        | what it is                                                   |
 * |-------------|--------------------------------------------------------------|
 * | `AI+0`      | the HEALTH — `0x40e300(0xfa)`, and `0x414898` subtracts the blow |
 * | `AI+2`      | the beat, seeded **0x16** at `0x4116af` ({@link Enemy.beat})   |
 * | `AI+4`…`+0xb` | the record's own rect, which `0x414069` tests the player against |
 * | `AI+0xc`…`+0x2d` | the tracker block `0x45ef70` fills and `0x45efd0` reads   |
 * | `AI+0x2e`   | zeroed at `0x4116ec` and never read again                      |
 * | `AI+0x30`   | the switch-run stage — 1 find, 2 run, 3 reach, −1 done          |
 * | `AI+0x32`   | the record's `param`, above                                    |
 * | `AI+0x34`…`+0x3f` | the switch record it found: its point, then its rect      |
 *
 * `AI+0` is health and not a nerve: `0x414898` does `sub word ptr [eax], di`
 * against it with the blow's own strength and `0x4148c2` reads it back to
 * choose between a flinch and a death. The port's `e.hp` is that same word, so
 * this file never touches {@link Enemy.nerve} — two ports of one field would
 * drift apart — and state 5, the only state that WRITES it, writes `e.hp`.
 *
 * ## The stack frame, which is where every field number below comes from
 *
 * `0x413fd0` does `sub esp, 0x40` and takes the output pointer with
 * `lea eax, [esp + 4]` **before** it pushes `esi` and `edi`, so in the body the
 * sixteen bytes `0x45efd0` filled sit at `esp+0xc`: `esp+0xc` is `out+0` (the
 * side), `esp+0x10` `out+4` (the band), `esp+0x12` `out+6` (the player
 * mid-blow), `esp+0x14` `out+8` (the drop) and `esp+0x16` `out+0xa` (the
 * forward distance). The two argument slots pin it — after the tracker call's
 * `add esp, 8` the body sits at `base−0x48`, which makes `[esp+0x54]` at
 * `0x413fe7` `base+4`, the object, and `[esp+0x54]` at `0x413fda` (one push
 * deeper) `base+8`, the AI struct — and every one of the five is read below,
 * which is what confirms the count. Reading them four bytes low would turn
 * `0x41410d`'s band dispatch into a side dispatch and still compile.
 *
 * And `obj+6` is the **Y**, `obj+8` the X: `0x4144df` weighs `obj+8` against
 * the player's `obj+8` for the spray's 512-pixel cutoff and `0x4144fa` weighs
 * `obj+6` against his for the 200-pixel one.
 *
 * ## The prologue, which is three things and no behaviour
 *
 * - `0x413fee` — more than ten pixels off the ground (`obj+0x32`) while in any
 *   state but 0 clears `obj+0x34`, and anything else sets it. That is the
 *   settled flag the dog's leaps also spend (`0x454c81`/`0x454fe8`): physics
 *   bookkeeping, not a decision.
 * - `0x41400a` — the enemy bar. With the band 1 or nearer, the player in front
 *   and the state neither 0 nor 11, it calls
 *   `0x40d1c0(AI+0, 0x40e300(0xfa), 0x33f7, self.point)`. The page owns that
 *   panel ({@link Foe.panel}) and it moves nothing, so it is read here and not
 *   done.
 * - `0x41408a` — every single return path writes `0x64` into `obj+0x1a`, the
 *   strength percent, so a TCop's blow is always at full. **Nothing hits the
 *   player back in this port**, so that is carried as read and spends nothing.
 *
 * ## And the return value
 *
 * Every path of `0x413fd0` falls through `0x414086`, which is `xor ax, ax` —
 * the waiting paths included. The single `mov ax, 1` is `0x4146d7`, the frame
 * the corpse is removed, and that is state 11 and not here. **So every path of
 * this brain returns `false`.** Returning `true` would freeze the thing
 * mid-swing with its stride unspent.
 */
import {
  install,
  type Brain,
  type BrainCtx,
  type CastKit,
  type Enemy,
  type Reaction,
} from "./kit";
import type { FoeAnim } from "../foes";

/**
 * The three states this file deliberately leaves alone, and what they do that
 * the page's own paths do not. Read, not done.
 *
 * - **8**, the flinch (`0x46c828`, cels 2250/2251). `0x414898` takes the blow
 *   off `AI+0` and `0x4148a1` rolls `0x434540(4) + 0xe` for the noise — lab.snd
 *   **15…18**, the four `#0087…#0090 TCop punc[h]`es. What follows it is state
 *   8 itself (`0x41440e`), and that is below: the flinch's `resume` hands the
 *   machine kind 8 the frame the page's animation ends. `0x414933` is the
 *   other thing in the handler: a blow that leaves it under half health with
 *   `AI+0x30` still 0 starts the switch run instead of the flinch — that is
 *   {@link Foe.pick}'s second reaction for this class.
 * - **10**, the switch run (`0x46c888`). `0x4145d6` asks `0x404440` for the
 *   nearest **`initswitch`**, files its point at `AI+0x34`, runs to it on
 *   2100…2105 at 130, and inside ten pixels of `AI+0x36` plays the reach and
 *   calls `0x412550(point, 0)` — which hands that switch's tag 3 to tag 0, the
 *   throw up. The page has all of that as {@link Foe.lever}, and `0x4140eb` —
 *   the one door into it from the fight, when the player is more than 150
 *   pixels off in Y and `AI+0x30` is still 0 — is left out with it, because
 *   installing kind 10 with no state 10 would strand the thing. Finding
 *   nothing is the other leg: `0x414618` puts `AI+0x30` to −1 and goes back to
 *   the stance, which is what every cop in a level with no switch does.
 * - **11**, the death (`0x46c9a8`, cels 2190…2194). `0x414696` zeroes
 *   `obj+0x26`, the shove weight, every frame of it, and on frame 3 of the
 *   script (`obj+0x42`) plays lab.snd 0xd — `#0084 TCop Dies` — sprays
 *   `0x40cba0` twice (the green ball, and 0x78 of goo) and answers 1, the one
 *   frame in the whole function that does. The page plays the three cels and
 *   {@link copReacts} says and sprays on the last of them. The gunner's death
 *   is kind 9 tag 3 instead (`0x4148f4`, {@link Foe.deathFor}), four cels that
 *   carry a body and so still take blows, and `0x414566` ends THAT by handing
 *   to kind 11 anyway, after one `0x45b060(6, …)` a hundred pixels BEHIND it
 *   (`0x414588`: `sbb`, `and 0xff38`, `add 0x64`) — the blaster, which the
 *   page drops as the one death hands to the other.
 */
const NOT_HERE = "0x41440e, 0x4145b0, 0x414696" as const;

/**
 * Its repertoire, by kind and tag, straight out of `0x46c628`…`0x46c9a8`.
 *
 * Every cel, hold and stride below is the script's own. The walks and the
 * stance carry no strike box; the five of kind 3 and the spray do, which is the
 * disc's own mark for a frame that hits — see {@link FIGHTS}`.initcop`, which
 * reads the same four travelling ones off the same script.
 */
/**
 * The slug — `0x414740`, and the class it belongs to is `0x413ce0`.
 *
 * ## What the creator writes
 *
 * ```
 *   414751  class [0x46c620], 4 bytes of AI          the object
 *   414768  AI+2 = 0x64                              a hundred frames to live
 *   414771  obj+6 = cop's point                      the cop's own Y, unlifted
 *   41478e  obj+8 += mirror ? -100 : +100            a hundred pixels in front
 *   4147a0  obj+0xc = mirror ? -35 : +35             and that is its speed
 *   4147c2  0x45d090(obj, 0x46c608, 0)               its script, tag 0
 * ```
 *
 * `0x413cf8` — the create — gives it `obj+0xe = 5`, the chapter's own bank at
 * `0x4a5178`, a restitution of 0.4 and no weight at all, so it flies flat.
 * Nothing divides the 35: `0x42f8b0` divides a SCRIPT's stride by `obj+0xe`,
 * and the creator writes the velocity itself.
 *
 * ## The two tags, which are the whole of it
 *
 * `0x46c608` is one cel per tag and no stride either side — 2240 and 2241 —
 * and the think function `0x413dd0` swaps them:
 *
 * - **tag 0** holds `obj+0x1a` at **zero** (`0x413e43`) and measures
 *   `|player.x − self.x|` every frame. A slug crossing the room hurts nothing.
 * - inside `0x82` = **130 pixels** it installs tag 1, and `0x413e79` writes
 *   `obj+0x1a = 0x64`. Now it is a hundred points of blow with a second cel on
 *   it, and the install is one-way.
 *
 * ## And what takes it away
 *
 * Any of the four collision words (`0x413dd5`..`0x413df6`), a velocity that
 * disagrees with the mirror flag — which is what the restitution does to one
 * that bounces (`0x413e01`..`0x413e1b`) — or the hundred frames running out
 * (`0x413e21`). There is no distance test: a slug that misses leaves the level
 * and keeps going until its count does.
 */
export const COP_SLUG: CastKit = {
  cels: [2240],
  hold: 1,
  speed: 35,
  ahead: 100,
  lift: 0,
  blow: 0x64,
  life: 100,
  arm: { within: 0x82, cel: 2241 },
  from: "0x414740, script 0x46c608, class 0x413ce0",
};

export const COP = {
  /** kind 0 — one cel, no stride: the whole patrol, and state 0 */
  stand: { cels: [2100], hold: 1, kind: 0, tag: 0, from: "0x46c628 tag 0" },
  /** kind 1 — four cels going nowhere: the stance, and the state that decides */
  stance: {
    cels: [2080, 2081, 2082, 2083],
    hold: 2,
    kind: 1,
    tag: 0,
    from: "0x46c638 tag 0",
  },
  /** kind 2 tag 0 — the slug gun coming up */
  raise: {
    cels: [2140, 2141, 2142, 2143, 2144],
    hold: 2,
    kind: 2,
    tag: 0,
    from: "0x46c788 tag 0",
  },
  /** kind 2 tag 1 — one cel, and the frame `0x414740` puts a slug in the air */
  fire: { cels: [2145], hold: 2, kind: 2, tag: 1, from: "0x46c788 tag 1" },
  /** kind 2 tag 2 — and the same cel three times, putting it down again */
  lower: {
    cels: [2146, 2146, 2146],
    hold: 2,
    kind: 2,
    tag: 2,
    from: "0x46c788 tag 2",
  },
  /** kind 3 tag 0 — two cels of wind-up, and the only thing it winds into is tag 1 */
  wind: {
    cels: [2160, 2161],
    hold: 1,
    kind: 3,
    tag: 0,
    from: "0x46c660 tag 0",
  },
  /** kind 3 tag 1 — the swing that steps in, 130 and 105 on the first two cels */
  swing: {
    cels: [2160, 2161, 2162, 2163, 2164, 2163, 2162],
    hold: 1,
    dx: [130, 105, 0, 0, 0, 0, 0],
    kind: 3,
    tag: 1,
    from: "0x46c660 tag 1",
  },
  /** kind 3 tag 2 — the long one: 130 on all seven, and it crosses a room */
  charge: {
    cels: [2160, 2161, 2170, 2171, 2172, 2173, 2172],
    hold: 1,
    dx: [130, 130, 130, 130, 130, 130, 130],
    kind: 3,
    tag: 2,
    from: "0x46c660 tag 2",
  },
  /** kind 3 tag 3 — the same swing standing still, for a cop out of territory */
  jab: {
    cels: [2162, 2163, 2164],
    hold: 1,
    dx: [0, 0, -10],
    kind: 3,
    tag: 3,
    from: "0x46c660 tag 3",
  },
  /** kind 3 tag 4 — and the long one standing still */
  hook: {
    cels: [2170, 2171, 2172, 2173],
    hold: 1,
    dx: [0, 0, 0, -10],
    kind: 3,
    tag: 4,
    from: "0x46c660 tag 4",
  },
  /** kind 4 tag 0 — the walk in, six cels at 65 */
  walkIn: {
    cels: [2100, 2101, 2102, 2103, 2104, 2105],
    hold: 2,
    dx: [65, 65, 65, 65, 65, 65],
    kind: 4,
    tag: 0,
    from: "0x46c720 tag 0",
  },
  /** kind 4 tag 1 — and back out. It backs away three times faster than it comes on */
  walkOut: {
    cels: [2105, 2104, 2103, 2102, 2101, 2100],
    hold: 2,
    dx: [-195, -130, -65, -65, -65, -65],
    kind: 4,
    tag: 1,
    from: "0x46c720 tag 1",
  },
  /** kind 5 — eight cels of the doughnut, and forty health back at the end of it */
  eat: {
    cels: [2180, 2181, 2182, 2183, 2184, 2185, 2186, 2187],
    hold: 2,
    kind: 5,
    tag: 0,
    from: "0x46c840 tag 0",
  },
  /** kind 6 — the two cels it stands on while the player is down */
  gloat: {
    cels: [2260, 2261],
    hold: 2,
    kind: 6,
    tag: 0,
    from: "0x46c7d8 tag 0",
  },
  /**
   * kind 7 — the same two cels three times over, and **nothing installs it**.
   *
   * `struct.pack('<I', 0x46c7f0)` appears nowhere in `SC.EXE`, and the jump
   * table sends state 7 to `0x4143fe`, the same handler state 6 uses. It is
   * carried here because the state exists and the script exists; it is
   * unreachable in the shipped game.
   */
  gloatLong: {
    cels: [2260, 2261, 2260, 2261, 2260, 2261],
    hold: 2,
    kind: 7,
    tag: 0,
    from: "0x46c7f0 tag 0",
  },
  /** kind 9 tag 0 — the gunner's run in: 2110…2115 at a frame a cel, twice the walk's rate */
  runIn: {
    cels: [2110, 2111, 2112, 2113, 2114, 2115],
    hold: 1,
    dx: [65, 65, 65, 65, 65, 65],
    kind: 9,
    tag: 0,
    from: "0x46c8f0 tag 0",
  },
  /** kind 9 tag 1 — and the run out, on the walk's own −195…−65 */
  runOut: {
    cels: [2115, 2114, 2113, 2112, 2111, 2110],
    hold: 1,
    dx: [-195, -130, -65, -65, -65, -65],
    kind: 9,
    tag: 1,
    from: "0x46c8f0 tag 1",
  },
  /** kind 9 tag 2 — the spray, and the −30 on every other cel is the recoil */
  spray: {
    cels: [2121, 2120, 2121, 2120, 2121, 2120],
    hold: 1,
    dx: [-30, 0, -30, 0, -30, 0],
    kind: 9,
    tag: 2,
    from: "0x46c8f0 tag 2",
  },
  /** `0x4116d5` — the descending list `0x45efd0` reads the band out of */
  bands: [350, 180, 70],
  /** `0x41429e` — lab.snd 0xc, `#0072 Slug laun[cher]`, as the shot goes out */
  slug: 0xc,
  /** `0x414189` — lab.snd 0xe, `#0085 TCop eats` */
  munch: 0xe,
  from: "0x413fd0",
} as const;

/** kind 9's three tags in the order `0x434540(3) − 1` picks them */
const GUN = [COP.runIn, COP.runOut, COP.spray] as const;

/**
 * `AI+0x32` — is this the GUNNER?
 *
 * `0x4116e2` files the record's own `param` there and `0x414131`, `0x4141a2`
 * and `0x4148ed` are the three that read it. The port keeps no record `param`
 * on an {@link Enemy} and this file may not add one, so it is read out of
 * {@link Enemy.param}: the record's own word, which is where the executable
 * four bytes the punk spends as a decision budget are this class's record rect.
 * **That slot means something else here and the caller has to say so** — until
 * something seeds it, every cop is the param-0 one with the slug gun, which is
 * twelve of the nineteen the game places and all seven of MAZE's.
 */
function gunner(e: Enemy): boolean {
  return (e.param ?? 0) !== 0;
}

/**
 * `0x41c630` — within sixty pixels of the bound BEHIND it.
 *
 * The engine's pair: `0x41c5f0` is the bound it FACES, which the kit already
 * has as {@link BrainCtx.atBound}, and `0x41c630` is the same fifty-one bytes
 * with the `je` and the `jne` swapped. `obj+0x28` set is facing west and picks
 * `obj+0x38`, clear is facing east and picks `obj+0x3a`, so `obj+0x38` is the
 * left bound and `obj+0x3a` the right — the kit's {@link BrainCtx.atRear},
 * against the mover's bounds rather than the rect ({@link Foe.span}). It is only
 * ever asked while the cop is walking BACKWARDS.
 */
const behind = (e: Enemy, k: BrainCtx): boolean => k.atRear(e);

/**
 * `0x45d090` on the script that is already playing — the rewind, which
 * {@link install} does not do.
 *
 * `install` only rewinds when the animation CHANGES, and it has to: the states
 * that re-install the same looping walk every frame would otherwise freeze it
 * on its first cel. But four of this class's tails re-install the script they
 * are already on *after* it has finished — `0x41423f` the stance, and the three
 * of state 9 — and there the rewind is the whole mechanism. Without it the
 * stance never restarts, `e.clock >= run` stays true, and `AI+2` becomes a beat
 * of TICKS rather than one of stance cycles: twenty-two frames of standing
 * still instead of a hundred and seventy-six.
 */
function rewind(e: Enemy, a: FoeAnim, once = false): false {
  e.clock = 0;
  return install(e, a, once);
}

/**
 * `initcop`'s own machine, states 0 to 7 and 9.
 */
export const cop: Brain = (e, foe, run, k) => {
  const done = e.clock >= run;
  const t = k.track(e, COP.bands);
  // `0x4116af` — the creator's own seed, and the two bands below respend it
  e.beat ??= 0x16;
  switch (e.script ?? 0) {
    /**
     * ---- 0, `0x41405c`: the patrol, which is one cel and one test.
     *
     * There is no walk in it. `0x414069` is `0x434200(player.point, AI+4)` —
     * the player's own point inside the four words the creator copied out of
     * this record — and passing it installs the stance. Nothing walks a TCop
     * back out of the fight either: the punk's `0x44ec26`, which puts it back
     * on its record's point when the player stands up again, has no
     * counterpart here. Leaving the rect putting it back on the patrol is
     * {@link stepFight}'s, and it is what keeps a level walkable.
     */
    case 0:
      return e.fighting ? install(e, COP.stance) : false;
    // ---- 1, `0x414095`: the stance, and the only state that thinks every frame
    case 1:
      return decide(e, k, t, done);
    /**
     * ---- 2, `0x41424f`: the slug gun, which is three scripts in a row.
     *
     * Up, the one frame that fires, down, and back to the stance. `0x4142ac`
     * calls `0x414740` — the slug, and {@link COP_SLUG} is what that function
     * and the class behind it say.
     */
    case 2:
      switch (e.tag ?? 0) {
        case 0:
          return done ? install(e, COP.fire, true) : false;
        case 1:
          if (!done) return false;
          install(e, COP.lower, true);
          k.say(e, COP.slug);
          // `0x4142ac` — the shot itself, at the instruction that fires it
          k.cast(e, COP_SLUG);
          return false;
        case 2:
          return done ? install(e, COP.stance) : false;
        default:
          return false;
      }
    /**
     * ---- 3, `0x4142c9`: the swings, and the one thing that can interrupt one.
     *
     * `0x4142ca` asks `0x41c5f0` every frame, finished or not: a cop within
     * sixty pixels of the bound it faces swaps a travelling swing (tags 0, 1,
     * 2) for one that stands still, `0x434540(2) + 2` choosing between tag 3
     * and tag 4. It will not walk out of its own patch to reach you.
     */
    case 3: {
      const tag = e.tag ?? 0;
      if (k.atBound(e) && tag < 3) {
        return install(e, k.roll(2) === 1 ? COP.jab : COP.hook, true);
      }
      if (!done) return false;
      // `0x4142fe` — tag 0 is a wind-up and tag 1 is what it winds into
      if (tag === 0) return install(e, COP.swing, true);
      return install(e, COP.stance);
    }
    /**
     * ---- 4, `0x414329`: the walks, and three ways out of one.
     *
     * Out of territory ahead it turns round and walks the other way; backed
     * into the bound behind it (`0x41c630`, and only while it is the walk OUT
     * that is playing) it stops retreating and comes at you on the long swing;
     * and when the walk simply ends it faces you, and his back being turned is
     * a swing where anything else is the stance.
     */
    case 4: {
      if (k.atBound(e)) {
        e.facing = -e.facing;
        return install(e, COP.walkIn);
      }
      if ((e.tag ?? 0) === 1 && behind(e, k)) return install(e, COP.charge, true);
      if (!done) return false;
      if (t.forward < 0) e.facing = -e.facing;
      // `0x414383` — the two mirror flags agreeing means he is looking away
      if (k.player.facing === e.facing) {
        return install(e, k.roll(2) === 1 ? COP.swing : COP.charge, true);
      }
      return install(e, COP.stance);
    }
    /**
     * ---- 5, `0x4143ab`: the doughnut, and it is the only state that HEALS.
     *
     * `0x4143c6` rolls `0x40e300(0xfa)` — the same figure the creator stood it
     * up with — and if there is forty pixels of room under it puts forty back
     * on `AI+0`, otherwise fills it. `AI+0` is the health word the hit handler
     * subtracts from, so this is `e.hp`, and because the cap is the health it
     * was made with the sum can never pass {@link Enemy.max}.
     */
    case 5: {
      if (!done) return false;
      install(e, COP.stance);
      const full = k.scaled(0xfa);
      e.hp = full - 0x28 >= e.hp ? e.hp + 0x28 : full;
      return false;
    }
    /**
     * ---- 6 and 7, `0x4143fe`: one handler, and it waits and stands up.
     *
     * 6 is what `0x41409f` puts it on while the player is down. 7 is the same
     * two cels three times over and nothing in the executable installs it.
     */
    case 6:
    case 7:
      return done ? install(e, COP.stance) : false;
    /**
     * ---- 8, `0x41440e`: what follows the flinch, and the flinch has already
     * ended by the time the machine is handed this — {@link Foe.flinch}'s
     * `resume`. A cop on its way to a switch (`AI+0x30` over 0) goes back to
     * that stage of the run (`0x414422`), which the page's {@link Foe.lever}
     * owns; otherwise `0x434540(3)`: one time in three the wind-up
     * (`0x46c660` tag 0), and otherwise the walk out (`0x46c720` tag 1).
     */
    case 8:
      return k.roll(3) === 1
        ? install(e, COP.wind, true)
        : install(e, COP.walkOut);
    /**
     * ---- 9, `0x414456`: the gunner, and it is a machine inside the machine.
     *
     * Once a param-1 cop is in kind 9 it stays there: each of the three tags
     * ends by rolling `0x434540(3) − 1` for the next one, so it shuffles in,
     * shuffles out and sprays until something else takes it. Tag 3 is its
     * death and the page owns it.
     */
    case 9:
      switch (e.tag ?? 0) {
        // `0x41446a` — out of territory ahead it turns, and keeps running
        case 0:
          if (k.atBound(e)) e.facing = -e.facing;
          if (!done) return false;
          return rewind(e, GUN[k.roll(3) - 1]);
        // `0x41449e` — and backed into the bound behind it, it comes forward
        case 1:
          if (behind(e, k)) return install(e, COP.runIn);
          if (!done) return false;
          return rewind(e, GUN[k.roll(3) - 1]);
        case 2: {
          /**
           * `0x4144da` — the spray has a range of its own and it is not a
           * band: more than 512 pixels away in X or 200 in Y and it stops
           * shooting and walks in on kind 4 instead.
           */
          if (Math.abs(k.player.x - k.anchorX(e)) > 0x200 || Math.abs(t.dy) > 0xc8) {
            return install(e, COP.walkIn);
          }
          /**
           * `0x414510` — and on every ODD frame of the script (`obj+0x42`, the
           * frame index `0x45d090` rewinds) it calls `0x412a70(self, 1)`,
           * which plays lab.snd 0x23 and stands a tracer on cel 4000 at
           * `dx 1000` seventy-five pixels ahead. **Nothing in this port hits
           * the player**, so that is read and not done — and with it the
           * sound, which belongs to the thing that is not made.
           */
          if (!done) return false;
          // `0x41453b` — one spray in four is followed by another
          return k.roll(4) === 1
            ? rewind(e, COP.spray, true)
            : install(e, COP.stance);
        }
        default:
          return false;
      }
    default:
      return false;
  }
};

/**
 * State 1, `0x414095` — the whole of the fight, decided fresh every frame.
 *
 * Answer the player being down, face him, and then act on the band. There is no
 * side to want and no crowding test: `AI+6` is inside this class's record rect
 * and `0x44f020` is never called, so the punk's whole business of choosing
 * which flank to stand on has no counterpart here.
 */
function decide(
  e: Enemy,
  k: BrainCtx,
  t: ReturnType<BrainCtx["track"]>,
  done: boolean,
): boolean {
  /**
   * `0x414095` — `0x402f60`, the player upright, and the gate every fight
   * state opens with. With him down the cop stands on kind 6 and `0x4140af`
   * rolls a ten: under five it turns round, and that is the whole of it.
   */
  if (k.player.down) {
    install(e, COP.gloat);
    if (k.roll(10) < 5) e.facing = -e.facing;
    return false;
  }
  // `0x4140c4` — and this one does NOT return: it turns and carries on deciding
  if (t.forward < 0) e.facing = -e.facing;
  /**
   * `0x4140d0` is the switch run and it is left out — see {@link NOT_HERE}.
   * More than 150 pixels off in Y with `AI+0x30` still 0 sends the cop to the
   * nearest `initswitch` instead of at the player, and the page owns that as
   * {@link Foe.lever}.
   */
  /**
   * `0x41410d` — and the band, which is `out+4` against `0x46c9d8`. The
   * dispatch is an unsigned `ja`, so −1 — the player standing behind this one
   * altogether — falls past the table to the tail with everything else.
   */
  switch (t.band) {
    /**
     * Beyond 350: `0x414122` walks in seven times in eight, and the eighth is
     * the class's ranged answer — the gunner backs off onto kind 9 and finds
     * its spray from there, and the slug-gun cop raises the gun.
     */
    case 0:
      if (k.roll(8) !== 1) return install(e, COP.walkIn);
      return gunner(e) ? install(e, COP.runOut) : install(e, COP.raise, true);
    /**
     * 180…350 — `0x414157`, and this band is a clock. `AI+2` counts down a
     * frame at a time and does nothing until it goes under; then it takes a
     * new one of `0x434540(0xd) + 8` — nine to twenty-one — and **the number
     * it drew is the decision**: under fourteen it stops for the doughnut, and
     * fourteen or over it shoots.
     */
    case 1: {
      const beat = e.beat ?? 0x16;
      e.beat = beat - 1;
      if (beat >= 0) break;
      const next = k.roll(0xd) + 8;
      e.beat = next;
      if (next < 0xe) {
        k.say(e, COP.munch);
        return install(e, COP.eat, true);
      }
      return gunner(e) ? install(e, COP.runOut) : install(e, COP.raise, true);
    }
    /**
     * 70…180 — `0x4141be`, the swinging band, and it has two triggers.
     *
     * His back being turned starts the walk in — and that one does NOT return,
     * so the beat below is still spent and can install a swing straight over
     * it. Then `AI+2` again, except that here **his blow overrides the beat**:
     * `0x4141ed` only takes the tail when the countdown has not expired AND
     * `out+6` is clear, so a cop that sees the player swing answers it that
     * frame. Four or five back on the clock, and a coin between the short
     * swing and the long one.
     */
    case 2: {
      const backTurned = k.player.facing === e.facing;
      if (backTurned) install(e, COP.walkIn);
      const beat = e.beat ?? 0x16;
      e.beat = beat - 1;
      if (beat >= 0 && !k.player.swinging) {
        // ...and the walk above already cleared `obj+0x46`, which takes the frame
        return backTurned ? false : done ? rewind(e, COP.stance) : false;
      }
      e.beat = k.roll(2) + 3;
      /**
       * `0x414207` — `0x434540(2)` is 1 or 2 and both are answered, so
       * `0x41421b`, the leg that falls through to the tail, is unreachable.
       */
      return k.roll(2) === 1
        ? install(e, COP.swing, true)
        : install(e, COP.charge, true);
    }
    // inside 70 — `0x41422f`, and it backs off. It has no close attack at all
    case 3:
      return install(e, COP.walkOut);
  }
  /**
   * `0x41423f` — the tail every band falls through to when it installed
   * nothing: hold the stance until it ends, then play it again. The replay is
   * `0x45d090`'s rewind and not a no-op — see {@link rewind}.
   */
  return done ? rewind(e, COP.stance) : false;
}

/**
 * State 11's last frame, `0x41469c`: once the script's index `obj+0x42` reaches
 * 3 it says lab.snd **0xd** (`0x4146ab`), puts the green ball down
 * (`0x4146c2`, which is {@link Foe.vanishes}) and throws **0x78** of goo out of
 * its own point with no blow behind it (`0x4146d2`), and answers 1. The hit
 * handler says nothing as it kills (`0x4148c7`…`0x41490d` has no sound), so
 * the death's noise is here and not at the blow. The gunner's four cels of
 * kind 9 tag 3 come first and are not this animation.
 */
export const copReacts: Reaction = (e, foe, run, k) => {
  if (e.state !== "dead" || e.anim !== foe.death || e.clock < run) return;
  k.say(e, COP_GONE.sound);
  k.spray(e, COP_GONE.goo);
};

/** `0x4146ab` and `0x4146d2` — the frame a TCop is taken away */
export const COP_GONE = { sound: 0xd, goo: 0x78 } as const;

export { NOT_HERE as COP_NOT_HERE };
