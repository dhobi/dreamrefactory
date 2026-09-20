/**
 * The zombie — `initzomb`, think function `0x420330`, eight states.
 *
 * ## Its eight scripts, and therefore its eight states
 *
 * `0x45d090` copies word 4 of a script's header into `obj+0x18`, so the kinds of
 * the scripts this class installs ARE its alphabet. All eight were read out of
 * the class's own data region, `0x470078`…`0x470270`; the jump table at
 * `0x4208b4` is `[0x4203a6, 0x4203d9, 0x420446, 0x420692, 0x4206f0, 0x4207a3,
 * 0x4207e7, 0x42080b]`, one entry per kind, in order.
 *
 * ```
 *   0  0x470078  one cel, 1800: stand still until he walks into the rect
 *   1  0x470110  the shamble — six cels, 65 a cel, and the ONLY thing that travels
 *   2  0x470088  tag 0 the sway, tag 1 the arms HELD up, tag 2 a flourish
 *   3  0x470180  tag 0 raises the arms, tag 1 lowers them again
 *   4  0x470148  tag 0 hawks the gob up, tag 1 holds the mouth open after it
 *   5  0x4701e0  tag 0 the claw, tag 1 the same six cels backwards
 *   6  0x470248  the four flinches
 *   7  0x470270  the death, and the corpse
 * ```
 *
 * ## The shape of the machine, which is not the punk's
 *
 * `initwerea` decides everything in one state. This one is a RING, and the hinge
 * is kind 2 tag 1 — the arms held up on cel 1846. Nothing strikes out of the
 * sway: the sway can only raise the arms (kind 3 tag 0), the raise hands to the
 * hold, and the hold is the only place a claw comes from. The claw hands back to
 * the hold, so once the arms are up the thing keeps clawing until the player
 * leaves the second band or gets behind it, and only then does kind 3 tag 1 put
 * them down again.
 *
 * And what opens the ring is `0x4204c3`: **`obj+0x28` against the player's own
 * `obj+0x28`** — the two of them facing the same way, which in a side-scroller
 * means his back is to it. A zombie you are looking at sways, shambles and spits;
 * turn away from one and it puts its arms up.
 *
 * ## What this module owns, and what it does not
 *
 * Six of the eight — 0 through 5 — are the ones it is in while it is on its
 * feet, and those are here. Kinds 6 and 7 are the hit reactions, driven by
 * `0x4209f0` (the object's frame handler, hung on `obj+0x12` at `0x42028d`) and
 * by the page's own {@link Foe.flinch}/{@link Foe.death} path; a brain is never
 * called during them. They are named at {@link NOT_HERE}.
 *
 * ## The preamble, which belongs to no state and cannot be ported
 *
 * `0x42034a`…`0x420390` runs before the jump table, and it is not behaviour: it
 * is a claim on the chapter's ambient moan. While the player is inside the
 * outermost band (`[esp+0x10] >= 1`), in front (`[esp+0x16] > 0`), and this one
 * is neither a statue (state 0) nor dying (state 7), it calls
 * `0x40d1c0(AI+0, 0x40e300(0xc8), AI+0x32, self.point)`. That function is NOT
 * `0x40ef30`, the one-shot effect: it measures `|player.y - self.y| +
 * |player.x - self.x|` and, if that beats the best distance so far in
 * `[0x46bd28]`, writes the triple into `[0x4a8a00]`. `0x40d734` reads that
 * triple back once a frame and clamps it into the mixer's level at `[0x4a3b50]`.
 * So the NEAREST zombie on screen is the one whose groan you hear, at a loudness
 * of its own `AI+0` out of a full `0x40e300(0xc8)`, playing whichever of nine
 * samples `AI+0x32` drew at the creator. The kit has one sound primitive,
 * {@link BrainCtx.say}, and no global arbiter, so this is read and not done.
 */
import { install, type Brain, type BrainCtx, type CastKit, type Enemy } from "./kit";

/**
 * The hit reactions, kinds 6 and 7, and the handler that installs them. Read,
 * not done — the page owns those animations.
 *
 * - **6**, the flinch, `0x470248`: four one-cel tags at three engine frames
 *   apiece, 1860/1861/1862 and 1846. `0x420afe` picks one of the first three
 *   with `0x434540(3) - 1`, but `0x420ae1` takes tag **3** instead — cel 1846,
 *   the arms still up — whenever it is hit in state 5, state 3, or state 2 tag
 *   1. A zombie mid-claw does not drop its guard for a punch; it just holds the
 *   pose. `0x4207e7`, the state's own handler, then ends every flinch back in
 *   kind 2 tag 1, the hold, whichever tag it played.
 * - **7**, the death, `0x470270`: tag 0 is 1863–1865, tag 1 is 1866–1868, three
 *   engine frames a cel. `0x420aaa` installs tag 0 and seeds `AI+0x2e` from
 *   `[0x46b204]` — fifty corpse frames, the same word this page's
 *   {@link Enemy.linger} already carries. `0x420827` then clears `obj+0x26`
 *   (the creator set it 8 at `0x41ef2e`), hands to tag 1, and spawns one more
 *   object thirty pixels above itself through `0x4208e0` — velocity `{vy: -10,
 *   vx: -1 east / +1 west}`, class `[0x46faa8]`, script `0x46fa68` — the thing
 *   that rises off a zombie as it dies and drifts back over it. `0x420883`
 *   counts `AI+0x2e` down and, on the frame it runs out, calls
 *   `0x40cba0(self.point, -0xd, 0)` and returns **1**: the only `mov ax, 1` in
 *   the whole of `0x420330`, and the frame the object is removed.
 */
const NOT_HERE = "0x4207e7, 0x42080b, 0x4209f0" as const;

/**
 * Its repertoire, by kind and tag, straight out of `0x470078`…`0x470270`.
 *
 * Every cel and hold below is the script's own header and frame list. Only the
 * shamble travels — `0x470110` carries 65 on all six of its cels and every
 * other script in the class is `dx 0, dy 0`, so this thing never leaves the
 * ground and never lunges. Its whole approach is the walk.
 */
/**
 * What the zombie hawks up — `0x420990`, class `0x420140`, script `0x470028`.
 *
 * It is the strangest of the casts so far, and every part of that is in the
 * code rather than in a guess: **it does not move.** The spawner writes the
 * point, the facing and the room and nothing else; the class's create
 * (`0x42015a`) gives it a divisor of 1, the chapter's bank at `0x4a6220`, no
 * weight (`0x42f850(obj, 0)`) and — worth saying — `obj+0x12 = 0`, no hit
 * handler at all; and `0x470028` is eight cels at one engine frame each with a
 * `dx` of zero on every one of them. There is nowhere for a speed to come from.
 *
 * So it hangs where it left: a cloud in front of the mouth, forty pixels up and
 * sixty-five in front, for the eight frames its script lasts. `0x4201e0` is the
 * whole think — write `obj+0x1a = 0xfffe` and answer 1 once `obj+0x46` says the
 * script has finished, which is what takes it away.
 *
 * `0xfffe` is **−2**, the same jolt the eyeball's glob carries, and this is the
 * second class a level places that sends one. CAVERN puts up eight of these and
 * GRAVE sixteen.
 */
export const ZOMB_GOB: CastKit = {
  cels: [1890, 1891, 1892, 1893, 1894, 1895, 1896, 1897],
  hold: 1,
  /** nothing writes one: not the spawner, not the creator, not the script */
  speed: 0,
  /** `0x420723` — sixty-five in front, whichever way it faces */
  ahead: 0x41,
  /** `0x42072c` — and forty above the point */
  lift: 0x28,
  /** `0x4201e4`, every frame it exists */
  blow: -2,
  /** `0x4201ea` — gone the frame its own eight-cel script reports finished */
  life: 8,
  from: "0x420990, script 0x470028, class 0x420140",
};

export const ZOMB = {
  /** kind 0 — one cel, one engine frame, going nowhere: the statue */
  wait: { cels: [1800], hold: 1, kind: 0, tag: 0, from: "0x470078 tag 0" },
  /** kind 1 — the shamble, and the ONLY script in the class with a stride */
  walk: {
    cels: [1800, 1801, 1802, 1803, 1804, 1805],
    hold: 2,
    dx: [65, 65, 65, 65, 65, 65],
    kind: 1,
    tag: 0,
    from: "0x470110 tag 0",
  },
  /** kind 2 tag 0 — the sway, and the state that decides */
  sway: {
    cels: [1810, 1811, 1812, 1813, 1814, 1815],
    hold: 2,
    kind: 2,
    tag: 0,
    from: "0x470088 tag 0",
  },
  /** kind 2 tag 1 — one cel: the arms held up, and the hinge of the machine */
  hold: { cels: [1846], hold: 2, kind: 2, tag: 1, from: "0x470088 tag 1" },
  /** kind 2 tag 2 — nine cels of flourish the sway drops into about one frame in seven */
  twitch: {
    cels: [1820, 1821, 1822, 1823, 1824, 1825, 1826, 1827, 1828],
    hold: 2,
    kind: 2,
    tag: 2,
    from: "0x470088 tag 2",
  },
  /** kind 3 tag 0 — seven cels bringing the arms up, ending on 1846, the hold's own cel */
  raise: {
    cels: [1840, 1841, 1842, 1843, 1844, 1845, 1846],
    hold: 2,
    kind: 3,
    tag: 0,
    from: "0x470180 tag 0",
  },
  /** kind 3 tag 1 — four of those same cels backwards, putting them down again */
  lower: {
    cels: [1843, 1842, 1841, 1840],
    hold: 2,
    kind: 3,
    tag: 1,
    from: "0x470180 tag 1",
  },
  /** kind 4 tag 0 — five cels hawking it up, and the last of them lets the gob go */
  spit: {
    cels: [1880, 1881, 1882, 1883, 1884],
    hold: 2,
    kind: 4,
    tag: 0,
    from: "0x470148 tag 0",
  },
  /** kind 4 tag 1 — one cel, the mouth still open, held out by a count rather than a script */
  gape: { cels: [1885], hold: 2, kind: 4, tag: 1, from: "0x470148 tag 1" },
  /** kind 5 tag 0 — the claw. `0x4207a3` sets `obj+0x1a` to 100 for the whole state */
  claw: {
    cels: [1850, 1851, 1852, 1853, 1854, 1855],
    hold: 2,
    kind: 5,
    tag: 0,
    from: "0x4701e0 tag 0",
  },
  /** kind 5 tag 1 — the same six backwards: what goes out when the PLAYER is mid-blow */
  backhand: {
    cels: [1855, 1854, 1853, 1852, 1851, 1850],
    hold: 2,
    kind: 5,
    tag: 1,
    from: "0x4701e0 tag 1",
  },
  /** `0x4702a8` — the descending list `0x45efd0` reads the band out of, three deep */
  bands: [300, 200, 100],
  /**
   * `zombie.snd` — the bank is `0x4a5870`, not the punk chapter's `0x4a7910`.
   *
   * `moan` `0x4204cf` as it puts its arms up, `hawk` `0x420519` as it starts to
   * spit, `shuffle` `0x420580` as it sets off walking, `swipe` `0x420608` as it
   * claws a player who is facing it, `hiss` `0x420653` as it claws one who is
   * standing still, `gob` `0x42074e` on the frame the spit leaves it.
   */
  moan: 0x0e,
  hawk: 0x11,
  shuffle: 0x10,
  swipe: 0x20,
  hiss: 0x0d,
  gob: 0x12,
  from: "0x420330",
} as const;

/**
 * `initzomb`'s own machine, states 0 to 5.
 *
 * ## The stack frame, which is where the field numbers come from
 *
 * `0x420330` does `sub esp, 0x14`, takes the output pointer with
 * `lea eax, [esp + 4]`, and then pushes **esi, edi, eax and ecx** before
 * `0x45efd0` is called. Four pushes, but the last two are the call's own
 * arguments and `0x420347` pops them again, so at every test below the stack is
 * two registers deep and the sixteen bytes sit at **`esp+0xc`**: `esp+0xc` is
 * `out+0` the side, `esp+0x10` is `out+4` the BAND, `esp+0x12` is `out+6` the
 * player's strike box, `esp+0x16` is `out+0xa` the forward distance. Reading
 * `esp+0x10` as the side rather than the band would make this class look like it
 * decides on which shoulder you stand, and it does not.
 *
 * ## Its AI struct, which is not the punk's either
 *
 * `0x41eee0` mallocs `0x34` bytes and lays them out its own way: `AI+0` the
 * nerve, `0x40e300(0xc8)` at `0x41ef34`; `AI+2`..`AI+9` the record's rect, the
 * creator's two point arguments written straight in at `0x41ef51`/`0x41ef53`,
 * which is what `0x4203b3` hands to `0x434200`; `AI+0xa` the tracker's own input
 * (`0x41ef6c` adds ten before registering it with `0x45ef70`); and three loose
 * words in the tail — `AI+0x2e` a countdown, `AI+0x30` a bump counter seeded 0
 * at `0x41ef56`, `AI+0x32` the ambient sample, `0x3489 + 0x434540(9)` at
 * `0x41ef61`. The page's {@link Enemy.beat} carries `AI+0x2e` and
 * {@link Enemy.decisions} carries `AI+0x30`; neither is what those fields are
 * named for on the punk, and both are the right width and lifetime.
 *
 * ## A think function never suppresses the animation
 *
 * Every path in `0x420330` ends `xor ax, ax`, the "my script has not finished"
 * returns at `0x4203d0` included. The one `mov ax, 1` is `0x4208a4`, the frame
 * the corpse is removed, and that is state 7. So every path below returns
 * `false`.
 */
export const zomb: Brain = (e, foe, run, k) => {
  const done = e.clock >= run;
  const t = k.track(e, ZOMB.bands);
  // `0x41ef34` — seeded and carried, and spent only by the ambient arbiter above
  e.nerve ??= k.scaled(0xc8);
  // `0x41ef56` — AI+0x30, the count of times the shamble has reached its bound
  e.decisions ??= 0;
  switch (e.script ?? 0) {
    /**
     * ---- 0, `0x4203a6`: the statue, and the one thing that ends it.
     *
     * There is no patrol. Kind 0 is a single cel and this state installs
     * nothing until `0x434200(player.point, AI+2)` answers yes — the player's
     * own point inside the four words the level record gave the creator. The
     * page already keeps that test as {@link Enemy.fighting}. It does not even
     * wait for its script to end, because its script is one frame long.
     */
    case 0:
      return e.fighting ? install(e, ZOMB.sway) : false;
    /**
     * ---- 1, `0x4203d9`: the shamble, and what it does at the end of its rope.
     *
     * `0x427170` is this chapter's `atBound` — the bound is `obj+0x38` when the
     * mirror flag is set and `obj+0x3a` when it is not, and sixty pixels is
     * near enough. Reaching it does NOT turn the thing round here; kind 2 does
     * that, on the next frame. What this state keeps is a count, and the count
     * is a way out of a corner: `0x4203e7` stops for the stance the first three
     * times it arrives, and then lets the next seven arrivals go by without
     * stopping at all before wrapping the counter at nine and starting over. A
     * zombie wedged against the end of its patch shrugs and keeps walking
     * rather than juddering on the spot.
     *
     * And with room left, `0x420426` is the ordinary end: when the six cels run
     * out it goes back to the sway.
     */
    case 1: {
      if (k.atBound(e)) {
        const bumps = e.decisions ?? 0;
        e.decisions = bumps + 1;
        // `0x4203f6` — the test is on the count BEFORE the increment
        if (bumps <= 2) return install(e, ZOMB.sway);
        // `0x4203fc` — and the tenth arrival rewinds it
        if (bumps + 1 > 9) e.decisions = 0;
        return false;
      }
      return done ? install(e, ZOMB.sway) : false;
    }
    // ---- 2, `0x420446`: three tags, and two completely different jobs
    case 2: {
      // `0x420454` — out of territory, and this is where the turn happens
      if (k.atBound(e)) {
        e.facing = -e.facing;
        return install(e, ZOMB.walk);
      }
      const tag = e.tag ?? 0;
      // `0x420479` — tag 1 is the held guard; tags 0 and 2 share one body
      if (tag === 1) return guard(e, k, t);
      if (tag !== 0 && tag !== 2) return false;
      return idle(e, k, t, done);
    }
    /**
     * ---- 3, `0x420692`: the arms go up into the guard and come down into the sway.
     *
     * Two tags, one rule each, and both wait for their own script. Tag 0 ends on
     * cel 1846, which is exactly the one cel kind 2 tag 1 holds, so the hand-over
     * does not move a pixel.
     */
    case 3:
      if (!done) return false;
      return (e.tag ?? 0) === 0 ? install(e, ZOMB.hold) : install(e, ZOMB.sway);
    /**
     * ---- 4, `0x4206f0`: the spit, and the only thing this class throws.
     *
     * Tag 0 waits out the five cels of hawking and then, at `0x420711`, builds a
     * point forty pixels above its own and sixty-five in front — `0x42072c`'s
     * `sub 0x28` on the Y and `0x420723`'s branchless `and 0x82 / sub 0x41` on
     * the X — and hands it to `0x420990`. See {@link ZOMB_GOB}.
     *
     * Tag 1 is the mouth left open afterwards, and it is held by a COUNT and not
     * by its script — one cel would otherwise be gone in two frames.
     * `0x420741` seeds `AI+0x2e` with 8 and `0x420776` spends it, so the gape
     * lasts nine engine frames however long the script is.
     */
    case 4: {
      if ((e.tag ?? 0) === 0) {
        if (!done) return false;
        // `0x420711` — the point is built and handed over here, on the frame
        // the hawking script ends
        k.cast(e, ZOMB_GOB);
        // `0x420741` — the gape's own clock, set before the script that uses it
        e.beat = 8;
        k.say(e, ZOMB.gob);
        return install(e, ZOMB.gape);
      }
      const left = e.beat ?? 0;
      e.beat = left - 1;
      // `0x420784` — the test is on the value BEFORE the decrement, so 8 is nine frames
      if (left >= 0) return false;
      return install(e, ZOMB.sway);
    }
    /**
     * ---- 5, `0x4207a3`: the claw, and where it puts the arms afterwards.
     *
     * `0x4207a3` sets `obj+0x1a` to **100** for the whole state, tag 0 and tag 1
     * alike: this is the class committing its full strength. **Nothing hits the
     * player in this port**, so that is carried as read and spends nothing.
     *
     * `0x4207a9` also watches `obj+0x42` for the value 2 — the engine's
     * once-per-blow marker, the frame the reach actually connects — and lets out
     * sound `0x20` when it sees it. The page has no equivalent word, so the
     * swipe is said once as the claw is chosen instead (`0x420608`, below) and
     * not again here.
     *
     * And when the six cels are done it goes back to the guard, not to the sway.
     * That is the loop: hold, claw, hold, claw.
     */
    case 5:
      return done ? install(e, ZOMB.hold) : false;
    default:
      return false;
  }
};

/**
 * State 2 tags 0 and 2, `0x42048b` — the sway, and everything it can become.
 *
 * ## The fall-through at `0x420498`, which is deliberate and looks like a bug
 *
 * The first thing it does is roll thirteen and, on a 1 or a 2, install kind 2
 * tag 2 — the nine-cel flourish. It does **not** return. Execution falls into
 * the band tests below, any of which may install something else straight over
 * it, so the flourish only ever survives on the one path that returns without
 * installing: `0x42055b`, the "my sway has not finished yet" return. That is
 * genuinely what the code does, and {@link install} being idempotent for the
 * same animation is what keeps it from restarting the flourish every frame.
 *
 * ## And the facing test, `0x4204c3`
 *
 * The executable compares its own `obj+0x28` with the player's, and that is
 * asked directly: {@link BrainCtx.player.facing} is his mirror flag as a port
 * facing. Deriving it out of `out+0` instead would have been wrong for the
 * commonest case in a fight — `0x45f00c` answers 2, telling you nothing about
 * his mirror, whenever he is standing still.
 */
function idle(
  e: Enemy,
  k: BrainCtx,
  t: ReturnType<BrainCtx["track"]>,
  done: boolean,
): boolean {
  // `0x42048b` — two chances in thirteen of the flourish, and NO return after it
  if (k.roll(13) < 3) install(e, ZOMB.twitch);
  // `0x4204c3` — his back is to it, and that is the whole entry to the melee
  const sameWay = e.facing === k.player.facing;
  if ((t.band === 2 || t.band === 3) && sameWay) {
    k.say(e, ZOMB.moan);
    return install(e, ZOMB.raise);
  }
  /**
   * `0x4204fd` — inside the last band, facing him, it spits instead.
   *
   * Two gates in the executable have nothing to answer them here.
   * `[0x470070]`'s word 4 is the live count of the gob class and `0x420502`
   * refuses a third one in the air; a brain cannot see that list, so the port
   * does not hold the count. `0x402f00` is the second: it answers 0 while the
   * player's own `obj+0x18` is 9, 0xa, 0xd or 0x18 — four specific states of
   * his, none of which this page names — and {@link BrainCtx.player.down} is
   * the only part of that question the kit exposes.
   */
  if (t.band >= 3 && !k.player.down) {
    k.say(e, ZOMB.hawk);
    return install(e, ZOMB.spit);
  }
  /**
   * `0x42053f` — with him anywhere inside the outermost band it mostly just
   * keeps swaying: `0x434540(0x48)` and anything from 7 up, which is sixty-six
   * chances in seventy-two, and only once the sway itself has finished.
   */
  if (t.band >= 1 && k.roll(72) >= 7) {
    return done ? install(e, ZOMB.sway) : false;
  }
  // `0x42057a` — otherwise it sets off walking, turning first if he is behind it
  k.say(e, ZOMB.shuffle);
  if (t.forward < 0) e.facing = -e.facing;
  return install(e, ZOMB.walk);
}

/**
 * State 2 tag 1, `0x4205b2` — the arms up, and the only place a claw comes from.
 *
 * Four answers, in the executable's own order: he has got behind it or backed
 * out of the second band, so put them down; he is mid-blow, so the backhand goes
 * out; he is facing it, so claw with the swipe; he is standing still and right
 * on top of it, so claw about a third of the time with the hiss. Side 0 — this
 * one behind him, with him moving — is the one case that does nothing at all and
 * simply holds the pose.
 */
function guard(
  e: Enemy,
  k: BrainCtx,
  t: ReturnType<BrainCtx["track"]>,
): boolean {
  // `0x4205b2`/`0x4205be` — behind it, or further out than the second band
  if (t.forward < 0 || t.band < 2) return install(e, ZOMB.lower);
  // `0x4205ca` — `out+6`, the player's current cel carrying a strike box
  if (k.player.swinging) return install(e, ZOMB.backhand, true);
  // `0x4205ef` — `out+0` 1: it stands on the side he faces
  if (t.side === 1) {
    k.say(e, ZOMB.swipe);
    return install(e, ZOMB.claw, true);
  }
  // `0x42062e` — `out+0` 2: he is carrying no velocity, and only the last band counts
  if (t.side === 2 && t.band === 3 && k.roll(58) < 0x15) {
    k.say(e, ZOMB.hiss);
    return install(e, ZOMB.claw, true);
  }
  return false;
}

export { NOT_HERE as ZOMB_NOT_HERE };
