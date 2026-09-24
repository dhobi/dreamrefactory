/**
 * The WRAITH — `initwraith`, think function `0x424800`, nine states.
 *
 * ## Its nine scripts, and therefore its nine states
 *
 * `0x45d090` copies word 4 of a script's header into `obj+0x18`, so the kinds of
 * the scripts this class installs ARE its alphabet. All nine were walked out of
 * the class's own data region, `0x46f688`…`0x46f8f6`, which ends exactly where
 * the band list `0x46f8f8` begins. The jump table at `0x424ef8` is
 * `[0x42487f, 0x4248ba, 0x424c54, 0x424c54, 0x424c6a, 0x424d57, 0x424d9b,
 * 0x424ded, 0x424e51]`, one entry per kind, in order — and kinds 2 and 3 share
 * an entry, which is the first hint that this class is much smaller than its
 * script count suggests.
 *
 * ```
 *   0  0x46f688  one cel, 3260: the statue, until his point enters the rect
 *   1  0x46f698  the hover — five cels going nowhere, and the state that DECIDES
 *   2  0x46f6c8  tag 0 the CLAW, in place; tag 1 the same nine with dx 20/10
 *   3  0x46f760  3240..3244, a shudder that travels nowhere and hands straight back
 *   4  0x46f7e0  the TELEPORT: tag 0 fades out, tag 1 is gone, tag 2 fades back in
 *   5  0x46f790  tag 0 the cast, tag 1 the follow-through
 *   6  0x46f860  the SPLIT — it calls its own creator and a second wraith appears
 *   7  0x46f898  one cel at four frames: the flinch
 *   8  0x46f8a8  3200..3208: the death
 * ```
 *
 * ## The shape of the machine, which is a star and not a ring
 *
 * Kind 1 is the hub. Every other standing state does one thing and then installs
 * kind 1 again (`0x424899`, reached from eight separate places), and kind 1 is
 * the only state that ever looks at the band. There is no patrol: kind 0 is a
 * single cel and the only thing that ends it is `0x434200(player.point, AI+6)`.
 *
 * What the band dispatch (`0x424f1c`, five entries, indexed by `out+4`) does
 * with him:
 *
 * ```
 *   band 0,1  beyond 230   0x4248e9  installs NOTHING — it steers, and drifts
 *   band 2    130..230     0x424963  vanish, or a shudder on its own beat
 *   band 3    60..130      0x424abf  a shudder, a SPLIT, or the cast
 *   band 4    inside 60    0x424bd1  the claw, and only if it is level with him
 * ```
 *
 * The first of those is the one the old reading missed entirely. At long range
 * this thing does not walk: `0x4248e9` never touches a script, it pushes a pair
 * of numbers through `0x42f8b0` — which divides them by `obj+0xe`, the class's
 * divisor of ten, and ADDS them to `obj+0xa`/`obj+0xc`. So the wraith accelerates
 * at one pixel a frame sideways and two vertically while the hover keeps
 * looping. `0x46f6c8` tag 1, the only script in the class with a stride, is
 * not a walk either: only the two ladder branches install it (`0x424a57`,
 * `0x424b8c`). What goes out at band 4 with `belfry.snd` 0x23, `0082 wraith
 * cla[w]`, is tag 0 (`0x424c05`), the same nine cels going nowhere.
 *
 * ## The two states nothing else in the game has
 *
 * **Kind 4 is a teleport, not a rise.** Tag 0 fades it out on 3220→3225, tag 1
 * is one cel held by a counter — and `0x4247c0`, the class's DRAW message, skips
 * the blit entirely while `obj+0x18` is 4 and `obj+0x44` is 1, so tag 1 is
 * literally invisible. Tag 2 then fades back in, after `0x424cee` has written
 * the player's own y into `obj+6` and put `obj+8` a hundred pixels plus
 * `0x434540(0x2f)` on the side of him he is facing AWAY from. It reappears
 * behind you. The two sounds settle it: `0x4249cc` plays 0x27, `0086 wrath
 * tele[port]`, on the way out and `0x424ccf` plays 0x26, `0085 wraith
 * tel[eport]`, on the way back.
 *
 * **Kind 6 is a split.** `0x424de0` calls `0x41ec80`, this class's OWN creator,
 * with the record rect out of `AI+6`/`AI+0xa`, the mirror flag inverted, a point
 * seventy pixels behind itself, and the creator's fifth argument set — which is
 * the argument that makes the new one start in kind 4 tag 0 and materialise. The
 * sound on it is 0x28, `0087 wraith spl[it]`. `0x41ec8d` refuses a fifth
 * instance, so there are never more than four.
 *
 * ## The one flag the whole class turns on: `AI+4`
 *
 * `0x41ed12` sets `AI+4` to 1 when `[0x46f904]`'s instance count is 1 at the
 * moment of creation, and 0 otherwise — so the ONE wraith the level places is
 * the named one and every wraith it splits off is a lesser one. `AI+4` gates the
 * on-screen health bar (`0x424846`), the cast at bands 3 and 4, the split from
 * both the fight and the flinch, and — in the hit handler — whether a blow
 * subtracts at all: `0x42503d` kills a lesser wraith outright with any hit,
 * where the named one spends `0x40e300(0x2bc)` of health. And when the named one
 * dies `0x424f30` walks the class list and dissolves every lesser one with it.
 *
 * This page has no field for "first of my class", so {@link Enemy.decisions}
 * carries it, seeded from the class's live count the first time it thinks.
 *
 * ## What this module owns, and what it does not
 *
 * Seven of the nine — 0 through 6 — are the ones it is in while it is on its
 * feet, and those are here, with 7's closing roll. Kinds 7 and 8 are the hit
 * reactions, installed by `0x424f80` (the frame handler hung on `obj+0x12` at
 * `0x42475f`) and animated by the page's own {@link Foe.flinch}/{@link Foe.death}
 * path; what they do besides is {@link wraithReacts} and {@link wraithGate}.
 */
import type { Foe } from "../foes";
import {
  install,
  type Brain,
  type BrainCtx,
  type CastKit,
  type Enemy,
  type Hitter,
  type Reaction,
  TICK_SCALE,
} from "./kit";

/**
 * The hit reactions, kinds 7 and 8, and the handler that installs them. The
 * page owns those animations; what they do besides is here, in
 * {@link wraithReacts}, {@link wraithGate} and state 7 of the machine.
 *
 * `0x4250fa` installs `0x46f898` — kind 7, cel 3243 alone — when the blow is
 * survived, and `0x425044`/`0x4250d9` install `0x46f8a8` — kind 8, 3200..3208
 * — when it is not. State 8 is the only state in `0x424800` that answers 1
 * (`0x424eb6` and `0x424ee7`, both followed by `0x40cba0(point, -0xd, 0)`).
 *
 * - **7**, the flinch, `0x424ded`: halves both velocities every frame, and when
 *   the cel ends rolls `0x434540(10)`. Under 3 — and only if `AI+4` is set — it
 *   plays 0x28 and goes to kind 6: **a named wraith splits when you hit it.**
 *   Otherwise straight back to the hover.
 * - **8**, the death, `0x424e51`: a LESSER wraith (`AI+4` zero) is removed on
 *   the frame it enters the state — `0x424ea7` does not wait for the script at
 *   all — where the named one plays all nine cels, calls `0x424f30` to dissolve
 *   every lesser wraith left alive with `belfry.snd` 0x21 on each, and only then
 *   goes. `0x4250eb` also sets `[0x46ece0]` to 1 as the named one falls, which
 *   is the level's own flag and not behaviour.
 * - `0x424f80`'s damage line is `0x425075`, `sub word ptr [eax], di` against
 *   `AI+0`, and `0x42507c` plays `0x434540(2) + 0x23` — 0x23 or 0x24 — as it
 *   lands. A lesser one never gets there: `0x42503d` sends it straight to the
 *   death with 0x21 and no subtraction.
 */
const NOT_HERE = "0x424ded, 0x424e51, 0x424f80, 0x424f30" as const;

/**
 * The three tests this class makes that the kit cannot answer, and what they do.
 *
 * All three read `[0x4ac3d4]+0x18` — the PLAYER's own animation kind, dispatched
 * through the 28-entry table at `0x429570` — and the kit exposes only
 * {@link BrainCtx.player.down} (`0x402f60`, his kind under 0x1a) and
 * {@link BrainCtx.player.swinging}. So the branches below are read and not done,
 * and the code says where each one would go.
 *
 * - **his kind is 7 — he is on a LADDER** (`0x471e78` for character 0,
 *   `0x476428` for character 1; cels 400..407). Three sites:
 *   `0x424a25` at band 2, and within 200px of his row it either drifts in on a
 *   roll of 1 in 3 or casts; `0x424b6d` at band 3, and within 80px it drifts in;
 *   `0x424c1a` at band 4, where all it does is write the dead -3 below.
 * - **his kind is 0x15 — he is holding the SCEPTER** (`0x470c40`, the 3320s,
 *   state `0x42d2b0`; see `guns.ts`, `0x41f640` / fire `0x41f6b0`). `0x4249b2`,
 *   at band 2: five times in thirty it teleports away. The wraith dodges its own
 *   weapon, and `0x41f6b0` is literally the function it casts with.
 */
const UNREACHED = "0x4249b2, 0x424a25, 0x424b6d, 0x424c1a" as const;

/**
 * Its repertoire, by kind and tag, straight out of `0x46f688`…`0x46f8a8`.
 *
 * Every cel and hold below is the script's own header and frame list. Exactly
 * one tag in the class travels — `0x46f6c8` tag 1, dx 20 for three cels and then
 * 10 for six — and everything else in the class is `dx 0, dy 0`. Only the
 * ladder branches install that tag, so a wraith moves on the velocity
 * `0x4248e9` gives it and nothing else.
 */
export const WRAITH = {
  /** kind 0 — one cel at one engine frame: the statue, and there is no patrol */
  statue: { cels: [3260], hold: 1, kind: 0, tag: 0, from: "0x46f688 tag 0" },
  /** kind 1 — five cels going nowhere: the hover, and the hub of the machine */
  hover: {
    cels: [3260, 3261, 3262, 3263, 3264],
    hold: 2,
    kind: 1,
    tag: 0,
    from: "0x46f698 tag 0",
  },
  /**
   * kind 2 tag 0 — the CLAW, nine cels going nowhere: what band 4 installs
   * (`0x424c05` pushes tag 0).
   */
  claw: {
    cels: [3250, 3251, 3252, 3253, 3252, 3253, 3252, 3251, 3250],
    hold: 2,
    kind: 2,
    tag: 0,
    from: "0x46f6c8 tag 0",
  },
  /**
   * kind 2 tag 1 — the same nine with a stride, 20 and then 10: the lunge
   * the two ladder branches install (`0x424a57`, `0x424b8c`), which the kit
   * cannot reach — see {@link UNREACHED}.
   */
  lunge: {
    cels: [3250, 3251, 3252, 3253, 3252, 3253, 3252, 3251, 3250],
    hold: 2,
    dx: [20, 20, 20, 10, 10, 10, 10, 10, 10],
    kind: 2,
    tag: 1,
    from: "0x46f6c8 tag 1",
  },
  /** kind 3 — five cels at three engine frames apiece, and it hands straight back */
  shudder: {
    cels: [3240, 3241, 3242, 3243, 3244],
    hold: 3,
    kind: 3,
    tag: 0,
    from: "0x46f760 tag 0",
  },
  /** kind 4 tag 0 — fading out, and 3225 is held twice at the end of it */
  fade: {
    cels: [3220, 3221, 3222, 3223, 3224, 3225, 3225],
    hold: 1,
    kind: 4,
    tag: 0,
    from: "0x46f7e0 tag 0",
  },
  /** kind 4 tag 1 — one cel, and `0x4247c0` refuses to draw this tag at all */
  gone: { cels: [3225], hold: 1, kind: 4, tag: 1, from: "0x46f7e0 tag 1" },
  /** kind 4 tag 2 — the same seven backwards, played where it has just arrived */
  back: {
    cels: [3225, 3225, 3224, 3223, 3222, 3221, 3220],
    hold: 1,
    kind: 4,
    tag: 2,
    from: "0x46f7e0 tag 2",
  },
  /** kind 5 tag 0 — the cast, and the bolt leaves on the frame it ENDS */
  cast: {
    cels: [3210, 3211, 3212, 3213, 3214, 3215],
    hold: 2,
    kind: 5,
    tag: 0,
    from: "0x46f790 tag 0",
  },
  /** kind 5 tag 1 — 3213 three times: the arm still out after the bolt */
  held: {
    cels: [3213, 3213, 3213],
    hold: 2,
    kind: 5,
    tag: 1,
    from: "0x46f790 tag 1",
  },
  /** kind 6 — six cels, and `0x424de0` makes a second wraith while they play */
  split: {
    cels: [3230, 3231, 3232, 3233, 3234, 3235],
    hold: 2,
    kind: 6,
    tag: 0,
    from: "0x46f860 tag 0",
  },
  /**
   * `0x46f8f8` — `bc 02 e6 00 82 00 3c 00 00 00`, the descending list
   * `0x45efd0` reads the band out of, four deep and terminated by the zero
   * `0x45ef9f` stops on. Four thresholds, so five bands, 0 to 4.
   */
  bands: [700, 230, 130, 60],
  /**
   * `belfry.snd`, bank `0x4a5870` — and its own names are the check. The file's
   * 33rd entry on is `0080 wraith lau[gh]`, `0081 wraith lig[htning]`,
   * `0082 wraith cla[w]`, `0083 wraith get[s hit]`, `0084 wraith get[s hit]`,
   * `0085 wraith tel[eport]`, `0086 wrath tele[port]`, `0087 wraith spl[it]`,
   * `0088 wraith die` — ids 0x21 through 0x29 in order.
   */
  claws: 0x23,
  /** `0x41f733` — as the beam is made */
  lightning: 0x22,
  arrive: 0x26,
  leave: 0x27,
  splits: 0x28,
  /**
   * `obj+0xe` — `0x42474b`, `mov word ptr [esi+0xe], 0xa`, written on the class
   * birth message. It is what `0x42f8b0` divides an impulse by before adding it.
   */
  divisor: 10,
  from: "0x424800",
} as const;

/**
 * `e.vx`/`e.vy` are pixels a TICK and the engine's are pixels an engine frame,
 * so every velocity this module writes or adds is scaled by this once.
 *
 * `0x42f8b0` is the accumulator: it rounds its argument away from zero through
 * `obj+0xe` and adds the result to `obj+0xa`/`obj+0xc` once a frame — and the
 * brain is called once an engine frame, so one call is one addition.
 */
const TICKS = TICK_SCALE;

/** `0x42f8b0`'s own rounding — away from zero, through the divisor */
const through = (n: number): number =>
  n >= 0
    ? Math.trunc((n + WRAITH.divisor - 1) / WRAITH.divisor)
    : Math.trunc((n - WRAITH.divisor + 1) / WRAITH.divisor);

/**
 * `sar` after `sub eax, edx` — the halving `0x424932`, `0x424963`, `0x424ded`
 * and the rest do on a velocity word: toward zero, and a one halves to nothing.
 */
const halve = (v: number): number =>
  Math.trunc(Math.round(v / TICKS) / 2) * TICKS;

/**
 * What the cast lets go — `0x41f6b0(self, 0)`, the scepter's own fire function,
 * variant 0 (`0x41f755`).
 *
 * The object is of the scepter's class (list `[0x46f580]`, proc `0x424510`),
 * and its user words are `+2 = 0x46`, `+0 = 0`, `+4` the caster. `0x424620`,
 * its think, plants it every frame at the caster's `obj+8 ± 0x46` and
 * `obj+6`, writes `obj+0x1a = 0x64`, and — in kind 0, which `0x46f4d0` tag 0
 * is — answers 1 the frame the six cels have run. `0x41f733` plays `0x22`,
 * `0081 wraith lig[htning]`, as it is made.
 *
 * It hangs off the WRAITH, not the player: the page's streams are the player's
 * own held weapons, and the wraith's is a thing in the level. It is flown here
 * as a cast that does not move, born where the think would first plant it; the
 * wraith is frozen under its cast, so the six frames it lasts are where it
 * started.
 */
export const WRAITH_BEAM: CastKit = {
  cels: [3270, 3271, 3272, 3273, 3272, 3273],
  hold: 1,
  speed: 0,
  /** `0x41f755` — `user+2 = 0x46` along the caster's facing */
  ahead: 0x46,
  /** `user+0 = 0`: level with the caster's own point */
  lift: 0,
  /** `0x424630`, every frame */
  blow: 0x64,
  /** `0x424699` — gone the frame `0x46f4d0` tag 0's six cels report finished */
  life: 6,
  from: "0x41f6b0 variant 0 / 0x46f4d0 tag 0 / class 0x424510",
};

/**
 * How many times `0x424f30` has walked the class list — which dissolves every
 * wraith whose `AI+4` is clear. Two things call it: the named one's death as
 * it ends (`0x424ed5`), and a blow from the wraith's own beam
 * (`0x424ff7`, see {@link wraithGate}). A lesser one remembers the count it
 * was born under ({@link Enemy.side}) and goes the frame it changes.
 */
let namedFallen = 0;

/** `0x424f47`…`0x424f6a` — `AI+0 = 0`, `belfry.snd` 0x21, the dissolve, and gone */
function dissolve(e: Enemy, foe: Foe): void {
  e.hp = 0;
  e.state = "dead";
  e.anim = foe.death ?? e.anim;
  e.swing = false;
  e.linger = 0;
  // `0x424ea7`: a lesser one is removed on the frame it ENTERS state 8, so the
  // page's corpse clock is put at the end of the script it would have played
  e.clock = e.anim.cels.length * e.anim.hold - TICKS;
  e.vx = 0;
  e.vy = 0;
}

/**
 * `initwraith`'s own machine, states 0 to 6.
 *
 * ## The stack frame, which is where the field numbers come from
 *
 * `0x424800` does `sub esp, 0x10` and takes the output pointer with
 * `lea eax, [esp + 4]` **before** any register is pushed, so the sixteen bytes
 * sit four above the frame base. Then ebx, esi, edi and ebp go down — four
 * pushes that stay down for the whole function, since the two arguments to
 * `0x45efd0` are popped again by `0x424819` — and at every test below the buffer
 * is therefore at **`esp+0x14`**:
 *
 * ```
 *   esp+0x14  out+0    the side
 *   esp+0x18  out+4    the BAND          0x42481c, 0x4248d4
 *   esp+0x1a  out+6    his strike box    0x4249f0, 0x424b05
 *   esp+0x1c  out+8    player.y - self.y
 *   esp+0x1e  out+0xa  the forward       0x424824, 0x4248ba
 * ```
 *
 * What pins it is the argument slots. `0x42480a` reads the AI struct from
 * `[esp+0x24]` while three registers are down and `0x42482a` reads the object
 * from `[esp+0x24]` while four are — the same literal, one push apart, which can
 * only be the two arguments at frame+0x18 and frame+0x14. That fixes the frame
 * base, and `esp+0x10`/`esp+0x12` — the two scratch words `0x4248e9` builds the
 * drift out of — fall neatly BELOW the buffer, in the four bytes of the
 * `sub esp, 0x10` that the tracker does not use.
 *
 * ## Its AI struct, which is 0x30 bytes and is not the punk's
 *
 * `0x41ec95` mallocs 48 and `0x41ec80` lays them out its own way:
 *
 * ```
 *   AI+0     HEALTH, 0x40e300(0x2bc) at 0x41ecf2 — seven hundred, not a nerve
 *   AI+2     the beat, a countdown reseeded 5 (0x424ab4, 0x424ca9)
 *   AI+4     1 if this is the FIRST of its class, else 0 — see the class doc
 *   AI+6..d  the record's rect, the creator's two point arguments written in
 *   AI+0xe   the tracker's own input, registered by 0x41ed35 against 0x46f8f8
 * ```
 *
 * {@link Enemy.beat} carries `AI+2`, which is what that field is named for.
 * {@link Enemy.decisions} carries `AI+4`, which is NOT — on the punk that slot
 * is a decision budget and here it is a one-bit rank. It is the right width and
 * the right lifetime and there is nothing else on {@link Enemy} for it.
 *
 * ## A think function never suppresses the animation
 *
 * Every path in `0x424800` ends at `0x4248a9`, `xor ax, ax` — the "my script has
 * not finished" returns included, which is most frames of most states. The only
 * `mov ax, 1` in the function is `0x424eb6`/`0x424ee7`, state 8, the frame the
 * corpse is removed. So every path below returns `false`.
 *
 * ## And `obj+0x1a`, which is dead in the shipped binary
 *
 * `0x424c54` (states 2 and 3) and `0x424c21` (band 4) both write -3 into it, and
 * -3 is the grab. But `0x4248a9` is the function's only exit and its third
 * instruction is `mov word ptr [esi+0x1a], 0x64`: every path writes a hundred
 * back on the way out, so both writes are dead and the wraith hits like
 * everything else, at the page's default strength.
 */
export const wraith: Brain = (e, foe, run, k) => {
  const done = e.clock >= run;
  const t = k.track(e, WRAITH.bands);
  // `0x424ab4`/`0x424ca9` — the beat is only ever reseeded to five
  e.beat ??= 5;
  /**
   * `AI+4` — `0x41ed12` sets it to 1 when the class's live count is 1 at the
   * moment of creation, and to 0 otherwise. The level places exactly one, so
   * that one is alone the first time it thinks; a split is born beside its
   * parent and counts two. A lesser one also remembers how many named ones
   * had fallen when it was born — see {@link namedFallen} — and, being made by
   * `0x424de0` with the creator's fifth argument set, starts materialising in
   * kind 4 tag 0 (`0x41ed47`) rather than standing as a statue.
   */
  if (e.decisions === undefined) {
    e.decisions = k.count("initwraith") <= 1 ? 1 : 0;
    if (e.decisions === 0) {
      e.side = namedFallen;
      e.vx = 0;
      e.vy = 0;
      return install(e, WRAITH.fade, true);
    }
  }
  // `0x424f30` — the named one has gone, and it took this one with it
  if (e.decisions === 0 && e.side !== namedFallen) {
    k.say(e, WRAITH_GONE);
    e.hatched = true;
    dissolve(e, foe);
    return false;
  }
  switch (e.script ?? 0) {
    /**
     * ---- 0, `0x42487f`: the statue, and the one thing that ends it.
     *
     * `0x434200(player.point, AI+6)` — his own point inside the four words the
     * level record gave the creator — and nothing else. There is no patrol to
     * walk and the state does not even wait for its script, because its script
     * is one cel. The page keeps that test as {@link Enemy.fighting}.
     */
    case 0:
      return e.fighting ? install(e, WRAITH.hover) : false;
    // ---- 1, `0x4248ba`: the hover, and the only state that reads the band
    case 1:
      return fight(e, k, t, done);
    /**
     * ---- 2 and 3, `0x424c54`: both share one jump-table entry.
     *
     * The claw and the shudder do exactly the same thing when they end — put
     * the hover back on — and neither of them decides anything. `0x424c54`'s
     * first instruction is the dead -3 described above.
     */
    case 2:
    case 3:
      return done ? install(e, WRAITH.hover) : false;
    /**
     * ---- 4, `0x424c6a`: the teleport, and it is frozen for the whole of it.
     *
     * `obj+0xa` and `obj+0xc` are cleared every frame of every tag, so whatever
     * drift it had going in is spent. Then the tags run in order: fade out, gone
     * for five frames of the beat, and back in somewhere else.
     */
    case 4: {
      e.vx = 0;
      e.vy = 0;
      const tag = e.tag ?? 0;
      // `0x424c91` — the fade ends, it goes invisible, and the beat is set to 5
      if (tag === 0) {
        if (!done) return false;
        e.beat = 5;
        return install(e, WRAITH.gone, true);
      }
      /**
       * `0x424cb7` — five frames of nothing, and then it arrives.
       *
       * `0x424cee` takes the player's own y outright and puts x a hundred plus
       * `0x434540(0x2f)` on the far side of him from the way he is facing:
       * `obj+0x28` set on HIM (facing west) puts the wraith east of him, and
       * clear puts it west. Either way it comes back behind you.
       */
      if (tag === 1) {
        const beat = e.beat ?? 5;
        e.beat = beat - 1;
        if (beat >= 0) return false;
        k.say(e, WRAITH.arrive);
        // `obj+6` onto his: anchor on anchor, and its feet fall where they fall
        e.y += k.player.anchor - k.anchorY(e);
        e.x =
          k.player.facing < 0
            ? k.player.x + k.roll(0x2f) + 100
            : k.player.x - k.roll(0x2f) - 100;
        return install(e, WRAITH.back, true);
      }
      // `0x424d47` — and the fade back in hands to the hover like everything else
      return done ? install(e, WRAITH.hover) : false;
    }
    /**
     * ---- 5, `0x424d57`: the cast, and the bolt leaves at the END of it.
     *
     * `0x424d77` calls `0x41f6b0(self, 0)` on the frame the six cels finish —
     * the scepter's own fire function, variant 0, the one that spends no rounds
     * and plays `belfry.snd` 0x22, `0081 wraith lig[htning]`, as it creates the
     * object. See {@link WRAITH_BEAM}.
     *
     * Tag 1 is then three frames of the arm still out, and hands to the hover.
     */
    case 5:
      if (!done) return false;
      if ((e.tag ?? 0) === 0) {
        k.say(e, WRAITH.lightning);
        k.cast(e, WRAITH_BEAM);
        return install(e, WRAITH.held, true);
      }
      return install(e, WRAITH.hover);
    /**
     * ---- 6, `0x424d9b`: the split.
     *
     * `0x424da6`..`0x424de5` takes its own point, moves x seventy pixels behind
     * itself (`obj+0x28` set adds 70, clear subtracts it), and calls
     * `0x41ec80(point, AI+6, AI+0xa, !obj+0x28, 1)` — its own creator, with the
     * record rect it was given and the fifth argument that starts the new one in
     * kind 4 tag 0, so the copy materialises rather than standing there. The new
     * one gets `AI+4` of 0 because the class count is no longer 1, and
     * `0x41ec88` refuses a fifth instance.
     */
    case 6:
      if (!done) return false;
      if (k.count("initwraith") <= 3)
        k.hatch(e, "initwraith", {
          x: e.x - e.facing * 0x46,
          y: e.y,
          facing: -e.facing,
        });
      return install(e, WRAITH.hover);
    /**
     * ---- 7, `0x424ded`: the flinch has run out ({@link WRAITH_FLINCHED}).
     *
     * `0x424e14` rolls `0x434540(10)`: under 3, and only for the named one, it
     * cries 0x28 and splits; anything else is the hover again.
     */
    case 7:
      if (k.roll(10) < 3 && e.decisions === 1) {
        k.say(e, WRAITH.splits);
        return install(e, WRAITH.split, true);
      }
      return install(e, WRAITH.hover);
    default:
      return false;
  }
};

/** `0x424f51` / `0x425058` — `belfry.snd` 0x21, a lesser one going */
const WRAITH_GONE = 0x21;

/**
 * The two reaction states, as far as a page-owned animation can carry them.
 *
 * - **7**, `0x424ded`: both velocities halved every frame the take shows.
 * - **8**, a lesser one struck ({@link wraithGate}) cries 0x21 on its way
 *   out; the named one's death, the frame it ends, dissolves every lesser one
 *   still up (`0x424ed5` → `0x424f30`) — which each of them sees as
 *   {@link namedFallen} moving.
 */
export const wraithReacts: Reaction = (e, _foe, run, k) => {
  if (e.state === "flinch") {
    e.vx = halve(e.vx);
    e.vy = halve(e.vy);
    return;
  }
  if (e.state !== "dead" || e.hatched) return;
  // `0x424e6d` — the named one's death lights and shakes on every odd frame
  if (e.decisions !== 0 && Math.floor(e.clock / e.anim.hold) % 2 === 1) {
    k.flash(0xe1); // `0x424e89`
    k.shake(3); // `0x424e96`
  }
  if (e.decisions === 0) {
    // `0x425058` — the gate put it here without a sound; this is that sound
    e.hatched = true;
    k.say(e, WRAITH_GONE);
    return;
  }
  if (e.clock >= run) {
    e.hatched = true;
    namedFallen += 1;
  }
};

/**
 * `0x424f80`'s gate, in front of the page's own arithmetic.
 *
 * The bats, its own class and the thrown class are turned away first
 * (`0x424f90`..`0x424fcb`, `SPARES` in the page), and then `0x424fd1` any
 * strength of zero or less, which is every code.
 *
 * `0x424fdd`: a blow from the scepter's class on its tag 0 — variant 0, which
 * is the wraith's own beam; the player's shot is tag 1 — takes nothing off
 * the one it hits and calls `0x424f30`, which dissolves every lesser wraith
 * there is, and answers 0.
 *
 * Then `0x425018` sprays, whoever it is, and `0x42503d`: a LESSER wraith
 * takes no subtraction at all — the death is installed with 0x21 and
 * `0x424ea7` removes it the next frame, so any blow that lands is the end of
 * it, with neither the named one's hit sound nor its death sound. It answers
 * 1 (`0x425064`), so the blow is `still` — goo and the exchange, and no death
 * of the page's.
 */
export function wraithGate(
  e: Enemy,
  foe: Foe,
  blow: { damage: number; code: number; by: Hitter },
): { damage: number; code: number; still?: boolean; quiet?: boolean; spare?: boolean } | null {
  if (blow.code < 0) return null;
  if (blow.by.kit === WRAITH_BEAM) {
    namedFallen += 1;
    return null;
  }
  if (e.decisions !== 0) return blow;
  dissolve(e, foe);
  return { ...blow, still: true, quiet: true, spare: true };
}

/** `0x424c44` — every band falls through here: restart the hover, or wait */
function tail(e: Enemy, done: boolean): boolean {
  return done ? install(e, WRAITH.hover) : false;
}

/**
 * State 1, `0x4248ba` — the hover, and the whole of the fight.
 *
 * Turn to face him, hand the frame to the band, and on the way out restart the
 * hover if it has finished. Unlike the punk's, this state's band dispatch is NOT
 * gated on the script ending: `0x4248d4` reads the band every single frame and
 * only `0x424c44` at the bottom waits.
 */
function fight(
  e: Enemy,
  k: BrainCtx,
  t: ReturnType<BrainCtx["track"]>,
  done: boolean,
): boolean {
  // `0x4248ba` — and this one does NOT return: it turns and carries on
  if (t.forward < 0) e.facing = -e.facing;
  /**
   * `0x4248c6` — `0x402f60`, his own kind under 0x1a, and the whole of the
   * answer is at `0x424c29`: `obj+0x28` goes to 1 when he is to the EAST.
   *
   * `0x45eff3` negates the forward distance when `obj+0x28` is set, so set is
   * facing WEST — which means a wraith turns its back on a player who is down
   * and to the east of it. The punk's `0x44e710` is the identical comparison
   * with the identical result; `werea.ts` ports that one as facing him, and one
   * of the two readings is wrong. This module follows the instruction.
   */
  if (k.player.down) {
    e.facing = k.player.x > k.anchorX(e) ? -1 : 1;
    return tail(e, done);
  }
  switch (t.band) {
    /**
     * Beyond 230 — `0x4248e9`, and it installs nothing at all.
     *
     * Two scratch words are built and handed to `0x42f8b0`: the high one is
     * `±0xa` by the mirror flag, so ten a frame in the direction it faces, and
     * the low one is `0x14`, `0` or `-0x14` by where his row is. `0x42f8b0`
     * divides both by `obj+0xe` — ten — and ADDS them, so the wraith gains one
     * pixel a frame sideways and two vertically and simply drifts in while the
     * hover loops. This is the class's whole approach; it has no walk.
     *
     * The `obj+0x2e` in both tests is "back on the ground", and `Foe.initwraith`
     * floats, so it is never set and the middle branch is the live one.
     */
    case 0:
    case 1: {
      const dy = k.player.y - e.y;
      // `0x42490f` — more than fifteen below it, so drop towards him
      let lift = 20;
      if (dy <= 15) {
        if (-dy <= 15) {
          // `0x424932` — level with him: stop pushing, and halve what is left
          lift = 0;
          e.vy = halve(e.vy);
        } else {
          // `0x424949` — he is more than fifteen ABOVE it, so climb
          lift = -20;
        }
      }
      e.vx += through(e.facing * 10) * TICKS;
      e.vy += through(lift) * TICKS;
      return tail(e, done);
    }
    /**
     * 130..230 — `0x424963`, and the first thing it does is line itself up.
     *
     * The sideways speed is halved every frame and the vertical one is WRITTEN,
     * not accumulated: `mov word ptr [esi+0xa], ax` with twenty in it, or the
     * old value halved once it is within fifty of his row.
     */
    case 2: {
      e.vx = halve(e.vx);
      close(e, k, 20, 0x32);
      /**
       * `0x4249b2` is the scepter dodge and `0x424a20` the ladder pair, and
       * neither can be asked here — see {@link UNREACHED}. What is left is the
       * one test the kit does answer, and it is unconditional:
       * `0x4249f0` — he is MID-BLOW, so it goes.
       */
      if (k.player.swinging) {
        k.say(e, WRAITH.leave);
        return install(e, WRAITH.fade, true);
      }
      /**
       * `0x424a81` — otherwise it counts its beat down, and on the frame the
       * beat runs out rolls `0x434540(0x2f)`: under 7 — seven chances in
       * forty-seven — it shudders, and either way the beat goes back to five.
       */
      const beat = e.beat ?? 5;
      e.beat = beat - 1;
      if (beat >= 0) return tail(e, done);
      e.beat = 5;
      if (k.roll(0x2f) < 7) return install(e, WRAITH.shudder, true);
      return tail(e, done);
    }
    /**
     * 60..130 — `0x424abf`, the same alignment at twenty-five a frame, and the
     * band where this thing is dangerous.
     */
    case 3: {
      e.vx = halve(e.vx);
      close(e, k, 25, 0x32);
      /**
       * `0x424b05` — he is mid-blow, and the answer is a coin.
       *
       * `0x434540(10)` under 5 shudders; five and over it SPLITS, but only if
       * `AI+4` is set — a lesser wraith that loses the coin does nothing at all
       * and rides the blow out.
       */
      if (k.player.swinging) {
        if (k.roll(10) < 5) return install(e, WRAITH.shudder, true);
        if ((e.decisions ?? 1) === 0) return tail(e, done);
        k.say(e, WRAITH.splits);
        return install(e, WRAITH.split, true);
      }
      // `0x424b68` is the ladder branch — {@link UNREACHED}
      /**
       * `0x424ba1` — and with him doing nothing in particular, the cast:
       * `AI+4` set and `0x434540(0x2f)` under 6, six chances in forty-seven.
       */
      if ((e.decisions ?? 1) === 0) return tail(e, done);
      if (k.roll(0x2f) < 6) return install(e, WRAITH.cast, true);
      return tail(e, done);
    }
    /**
     * Inside 60 — `0x424bd1`, and it is three tests and one animation.
     *
     * No velocity is touched here at all: whatever the approach gave it is still
     * running. `AI+4` must be set, it must be within fifty of his row, and then
     * `belfry.snd` 0x23 — `0082 wraith cla[w]` — goes out with `0x46f6c8` tag 0
     * (`0x424c05` pushes 0), the nine cels in place. `0x424c21`'s -3 after it
     * is the dead write.
     */
    case 4: {
      if ((e.decisions ?? 1) === 0) return tail(e, done);
      if (Math.abs(e.y - k.player.y) >= 0x32) return tail(e, done);
      k.say(e, WRAITH.claws);
      return install(e, WRAITH.claw, true);
    }
    // behind it — `0x4248dc`'s `cmp eax, 4; ja` is unsigned and -1 falls through
    default:
      return tail(e, done);
  }
}

/**
 * `0x424963` and `0x424abf`'s shared opening — get level with his row.
 *
 * Within `slack` of it the vertical speed is halved and nothing is pushed;
 * outside it the speed is WRITTEN to `rate` towards him, positive when he is at
 * or below this one's own y. `rate` is 0x14 at band 2 and 0x19 at band 3, and
 * neither goes through the divisor — these are direct stores into `obj+0xa`.
 */
function close(e: Enemy, k: BrainCtx, rate: number, slack: number): void {
  if (Math.abs(k.player.y - e.y) < slack) {
    e.vy = halve(e.vy);
    return;
  }
  e.vy = (k.player.y >= e.y ? rate : -rate) * TICKS;
}

export { NOT_HERE as WRAITH_NOT_HERE, UNREACHED as WRAITH_UNREACHED };
