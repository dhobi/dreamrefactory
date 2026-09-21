/**
 * The street punk — `initwerea`, `0x44e580`, and the class every other one in
 * the chapter is a variation on.
 *
 * ## Its thirteen scripts, and therefore its thirteen states
 *
 * `0x45d090` writes a script's own kind into `obj+0x18`, so this table IS the
 * state machine's alphabet. Every one of them was read out of `0x4770f0` and
 * the twelve that follow it:
 *
 * ```
 *   0  0x4770f0  patrol: tag 0 the walk, tag 1 standing still
 *   1  0x4774b0  the stance — and the state that DECIDES
 *   2  0x477130  a walk that ends in the stance
 *   3  0x4771a0  tag 0 back off, tag 1 step in
 *   4  0x477240  five taunts
 *   5  0x4771d8  tag 0 the punch, tag 1 the long step in
 *   6  0x477168  what it does while the player is down
 *   7  0x477368  five leaps
 *   8  0x477408  the growl a blow lands on
 *   9  0x477488  the knockdown
 *  10  0x477580  getting up
 *  11  0x4774f8  the three flinches
 *  12  0x477518  the death
 * ```
 *
 * ## What this module owns, and what it does not
 *
 * Eight of the thirteen — 0 through 7 — are the ones a thing is in while it is
 * on its feet, and those are here. The last five are the hit reactions, and the
 * page already drives those through {@link Foe.flinch}, {@link Foe.pick} and
 * {@link Foe.death}; a brain is never called while an enemy is flinching or
 * dying, so wiring them here would mean two owners for one animation. They are
 * written out above so the next reader can see what is deliberately elsewhere,
 * and the three behaviours they carry that the page does NOT have are named at
 * {@link NOT_HERE}.
 */
import {
  install,
  type Brain,
  type BrainCtx,
  type Enemy,
  TICK_SCALE,
} from "./kit";

/**
 * The hit-reaction states, 8 to 12, and what they do that the page's own flinch
 * path does not. Read, not done — the page owns those animations.
 *
 * - **8**, the growl: `0x44ed8c` takes **ten off `AI+0`**, the nerve, every time
 *   a blow lands, and when the nerve runs out the punk does not flinch — it goes
 *   straight to the death script with `AI+2` set to 200 corpse frames. So a punk
 *   that has been worn down dies of the next tap, and the port's pure health
 *   subtraction cannot express that.
 * - **10**, getting up: `0x44ee90` ends the get-up by installing the standing
 *   **taunt**, not the stance, so a knocked-down punk comes back mouthing off.
 * - **11**, the flinch: `0x44eeb5` half the time returns to the stance, and the
 *   other half reads its nerve against `0x40e300(0xfa)/2` and either backs off
 *   (kind 3 tag 0) or steps straight in (tag 1) — the same coin the fight makes
 *   when the player swings.
 */
const NOT_HERE = "0x44ed8c, 0x44ee90, 0x44eeb5" as const;

/**
 * Its repertoire, by kind and tag, straight out of `0x4770f0`…`0x477580`.
 *
 * Every cel, hold, stride and lift below is the script's own. The walk carries
 * no strike box; the punch, the two swings and the three leaps that travel do,
 * which is the disc's own mark for a frame that hits.
 */
export const WEREA = {
  /** kind 0 tag 0 — the patrol walk. Six cels that travel, and the ONLY walk */
  patrol: {
    cels: [1910, 1911, 1912, 1913, 1914, 1915],
    hold: 2,
    dx: [75, 75, 75, 75, 75, 75],
    kind: 0,
    tag: 0,
    from: "0x4770f0 tag 0",
  },
  /** kind 0 tag 1 — one cel, no stride: a territory too narrow to walk */
  stand: { cels: [1900], hold: 2, kind: 0, tag: 1, from: "0x4770f0 tag 1" },
  /** kind 1 — eight cels going nowhere: the fighting stance, and state 1 */
  stance: {
    cels: [1900, 1901, 1902, 1903, 1904, 1905, 1906, 1907],
    hold: 2,
    kind: 1,
    tag: 0,
    from: "0x4774b0 tag 0",
  },
  /** kind 2 — the same six cels as the patrol, but ending in the stance */
  approach: {
    cels: [1910, 1911, 1912, 1913, 1914, 1915],
    hold: 2,
    dx: [75, 75, 75, 75, 75, 75],
    kind: 2,
    tag: 0,
    from: "0x477130 tag 0",
  },
  /** kind 3 tag 0 — out of reach, walking backwards */
  away: {
    cels: [1915, 1914, 1913],
    hold: 2,
    dx: [-225, -150, -75],
    kind: 3,
    tag: 0,
    from: "0x4771a0 tag 0",
  },
  /** kind 3 tag 1 — and back into it */
  near: {
    cels: [1910, 1911, 1912],
    hold: 2,
    dx: [75, 75, 75],
    kind: 3,
    tag: 1,
    from: "0x4771a0 tag 1",
  },
  /** kind 4 — the five taunts. Tags 0 and 1 stand; 2, 3 and 4 walk in */
  taunt: [
    {
      cels: [1930, 1930, 1930, 1931, 1932, 1932, 1932],
      hold: 1,
      kind: 4,
      tag: 0,
      from: "0x477240 tag 0",
    },
    {
      cels: [1933, 1933, 1933, 1934, 1935, 1935, 1935],
      hold: 1,
      kind: 4,
      tag: 1,
      from: "0x477240 tag 1",
    },
    {
      cels: [1930, 1930, 1930, 1931, 1932, 1932, 1932],
      hold: 1,
      dx: [75, 75, 75, 75, 75, 75, 75],
      kind: 4,
      tag: 2,
      from: "0x477240 tag 2",
    },
    {
      cels: [1933, 1933, 1933, 1934, 1935, 1935, 1935],
      hold: 1,
      dx: [75, 75, 75, 75, 75, 75, 75],
      kind: 4,
      tag: 3,
      from: "0x477240 tag 3",
    },
    {
      cels: [1920, 1921, 1922, 1923, 1924, 1922, 1921, 1920],
      hold: 1,
      dx: [75, 75, 75, 75, 75, 75, 75, 75],
      kind: 4,
      tag: 4,
      from: "0x477240 tag 4",
    },
  ] as const,
  /** kind 5 tag 0 — the punch, and 1923/1924 are where it hits */
  punch: {
    cels: [1920, 1920, 1921, 1922, 1923, 1924, 1922, 1921, 1920],
    hold: 2,
    kind: 5,
    tag: 0,
    from: "0x4771d8 tag 0",
  },
  /** kind 5 tag 1 — three cels of a longer step in */
  stepIn: {
    cels: [1910, 1911, 1912],
    hold: 2,
    dx: [225, 150, 150],
    kind: 5,
    tag: 1,
    from: "0x4771d8 tag 1",
  },
  /** kind 6 — what it walks while the player is down */
  mill: {
    cels: [1910, 1911, 1912, 1913, 1914, 1915],
    hold: 2,
    dx: [75, 75, 75, 75, 75, 75],
    kind: 6,
    tag: 0,
    from: "0x477168 tag 0",
  },
  /** kind 7 tag 0 — the flying kick, 1943 the frame that hits */
  kick: {
    cels: [1940, 1941, 1942, 1943],
    hold: 2,
    dx: [0, 0, 150, 25],
    dy: [0, 0, -480, 0],
    kind: 7,
    tag: 0,
    from: "0x477368 tag 0",
  },
  /** kind 7 tag 1 — the landing every one of the other four ends in */
  land: {
    cels: [1944, 1944, 1945],
    hold: 2,
    kind: 7,
    tag: 1,
    from: "0x477368 tag 1",
  },
  /** kind 7 tag 2 — the same four cels going nowhere: the leap it aims itself */
  hop: {
    cels: [1940, 1941, 1942, 1943],
    hold: 2,
    kind: 7,
    tag: 2,
    from: "0x477368 tag 2",
  },
  /** kind 7 tag 3 — the anti-air, thrown when the player is on the way up */
  antiAir: {
    cels: [1940, 1941, 1942, 1932],
    hold: 2,
    dx: [0, 0, 0, -25],
    dy: [0, 0, -480, 0],
    kind: 7,
    tag: 3,
    from: "0x477368 tag 3",
  },
  /** kind 7 tag 4 — the big one, and what it is FOR is changing sides */
  over: {
    cels: [1940, 1941, 1942, 1943],
    hold: 2,
    dx: [0, 0, 225, 75],
    dy: [0, 0, -600, 0],
    kind: 7,
    tag: 4,
    from: "0x477368 tag 4",
  },
  /** `0x44e5cc` — the descending list `0x45efd0` reads the band out of */
  bands: [330, 200, 150, 80],
  /** `0x44e5d5` and `0x44e9a8` — `woods.snd` 0x22 as it closes, 0x23 as it taunts */
  grunt: 0x22,
  growl: 0x23,
  from: "0x44e580",
} as const;

/** `0x44e68e`/`0x44e69f` — a territory this wide is patrolled 100px inside its ends */
const WIDE = 300;
/**
 * `0x44e68e` / `0x44e69f` — and the hundred is a WALL, not a line it turns on.
 *
 * The two arms of that test do not only flip the facing: each writes the margin
 * itself straight into `obj+0x8` before it turns, so a patrol that has drifted
 * past its own margin is PUT BACK on it.
 *
 * ```
 *   44e68e  sub edx, 0x64          ; right - 100, against my own x
 *   44e695  sub bx, 0x64
 *   44e699  mov word ptr [esi+8], bx    ; ...and I am standing on it now
 *   44e69f  add ecx, 0x64          ; left + 100, the same the other way
 *   44e6aa  mov word ptr [esi+8], di
 * ```
 *
 * A turn alone leaves a thing that overshot its margin outside it for as many
 * frames as the overshoot is wide, and its walk cel is what decides how big
 * that is. `0x4770f0` is three pixels a frame, so it is small — and it is the
 * difference between a patrol that keeps its hundred and one that wanders.
 */
const MARGIN = 100;

/**
 * `initwerea`'s own machine, states 0 to 7.
 *
 * ## The one thing to get right before writing another of these
 *
 * **A think function never suppresses the animation.** Every path in
 * `0x44e580` ends `xor ax, ax` — including `0x44ef9a`, the "my script has not
 * finished" return that most states take most frames. The single exception is
 * `0x44ef38`, the corpse, which answers 1 on the frame the object is removed.
 * So a brain returns `false` from everywhere: waiting states included, because
 * waiting is exactly when the current script needs to keep playing. Returning
 * `true` freezes the thing mid-leap with its stride unspent, which is what
 * `0x477600's last band is 80px and it never got nearer than 402px` looked like.
 *
 * ## The stack frame, which is where the field numbers come from
 *
 * `0x44e580` does `sub esp, 0x10` and then pushes three registers, so the
 * sixteen bytes `0x45efd0` filled sit at **`esp+0xc`**, not `esp+0x10`:
 * `esp+0x10` is `out+4`, the BAND, and `esp+0x16` is `out+0xa`, the forward
 * distance. Reading them four bytes low turns every band test into a side test
 * and still looks plausible.
 *
 * And `obj+6` is the **Y**, `obj+8` the X — `0x44e68a` weighs `obj+8` against
 * the record rect's left and right edge, which settles it.
 */
export const werea: Brain = (e, foe, run, k) => {
  const done = e.clock >= run;
  const t = k.track(e, WEREA.bands);
  e.nerve ??= k.scaled(0xfa);
  e.beat ??= 8;
  e.decisions ??= 3;
  e.side ??= 1;
  switch (e.script ?? 0) {
    // ---- 0, `0x44e5fb`: the patrol, and the one thing that ends it
    case 0: {
      // `0x434200(player.point, AI+8)` — his point inside this record's rect
      if (e.fighting) {
        // `0x44e616`: which side of him to want is decided ONCE, on the way in
        e.side = k.player.x < e.x ? 1 : 0;
        return install(e, WEREA.stance);
      }
      // `0x44e64b`: a territory under three hundred wide is not walked at all
      if (e.right - e.left <= WIDE) {
        if (t.forward < 0) e.facing = -e.facing;
        return install(e, WEREA.stand);
      }
      // `0x44e68a`: and a wide one is walked a hundred pixels inside its ends,
      // which it is put back onto rather than merely turned at
      const lo = e.left + MARGIN;
      const hi = e.right - MARGIN;
      if (e.x > hi) {
        e.x = hi; // `0x44e699`
        e.facing = -e.facing;
      } else if (e.x < lo) {
        e.x = lo; // `0x44e6aa`
        e.facing = -e.facing;
      } else if (k.atBound(e)) e.facing = -e.facing;
      return done ? install(e, WEREA.patrol) : false;
    }
    // ---- 1, `0x44e6e7`: the stance, and the only state that thinks every frame
    case 1:
      return decide(e, k, t, done);
    // ---- 2, `0x44ea58`: a walk that ends in the stance
    case 2:
      return done ? install(e, WEREA.stance) : false;
    // ---- 3, `0x44ea7d`: the back-off and the step-in both end facing him
    case 3:
      if (!done) return false;
      if (t.forward < 0) e.facing = -e.facing;
      return install(e, WEREA.stance);
    // ---- 4, `0x44eaae`: and the taunts answer by WHICH taunt it was
    case 4: {
      if (!done) return false;
      // `0x44eac2` — the two it stands still for, and it steps in six times in ten
      if ((e.tag ?? 0) <= 1) {
        return k.roll(100) < 60
          ? install(e, WEREA.near)
          : install(e, WEREA.stance);
      }
      /**
       * `0x44eb16` — and the three it walks in on keep it going, but only while
       * the player is still two bands out. `cmp word ptr [esp+0x10], 2` is the
       * BAND, four fifths of the time, and anything nearer than that ends the
       * mouthing off and puts it back in the stance.
       */
      if (k.roll(100) < 80 && t.band >= 2) {
        k.say(e, WEREA.growl);
        return install(e, WEREA.taunt[1 + k.roll(3)]);
      }
      return install(e, WEREA.stance);
    }
    // ---- 5, `0x44eb90`: the punch backs off, the step-in punches
    case 5:
      if (!done) return false;
      return (e.tag ?? 0) === 0
        ? install(e, WEREA.away)
        : install(e, WEREA.punch, true);
    /**
     * ---- 6, `0x44ebf7`: what it does while the player is down.
     *
     * And what ends it: the frame the player is back on his feet the punk is put
     * back on its own record's point and starts patrolling again.
     */
    case 6:
      if (!done) return false;
      if (k.player.down) return install(e, WEREA.mill);
      e.x = e.home ?? e.x;
      e.fighting = false;
      return install(e, WEREA.patrol);
    /**
     * ---- 7, `0x44ec46`: every leap lands before it does anything else.
     *
     * Four of the five wait for `obj+0x2e` — being back on the ground — and then
     * hand to tag 1, the landing, which hands to the stance. Tag 2 is the one
     * that steers: `0x44ecb5` nudges its sideways speed ten a frame while it is
     * within thirty of him, so it comes down on the side it wanted.
     */
    case 7: {
      const tag = e.tag ?? 0;
      if (tag === 1) return done ? install(e, WEREA.stance) : false;
      if (tag === 2 && e.y - k.player.y < 30) {
        const east = e.facing > 0;
        e.vx = (e.side !== 0 ? (east ? -10 : 10) : east ? 10 : -10) * TICKS;
      }
      if (!done || e.vy !== 0) return false;
      return install(e, WEREA.land);
    }
    default:
      return false;
  }
};

/** the leap's steering is ten pixels an ENGINE frame, and a tick is a QUARTER of one */
const TICKS = TICK_SCALE;

/**
 * State 1, `0x44e6e7` — the whole of the fight, decided fresh every frame.
 *
 * Face him, choose a side, answer the two things that override the band — he is
 * in the air, or he is mid-blow — and then act on the band.
 */
function decide(
  e: Enemy,
  k: BrainCtx,
  t: ReturnType<BrainCtx["track"]>,
  done: boolean,
): boolean {
  /**
   * `0x44e6f7` — with the fight off it walks, and it walks AWAY.
   *
   * `0x44e710` compares the player's x with its own and writes `obj+0x28` **1
   * when the player is east**, and `0x45eff3` settles that 1 is facing west. So
   * a punk standing west of a floored man turns his back on him and wanders
   * off. This page had it the other way round — punks standing over you — and
   * four separate readings of `initwraith`, `initvpriest`, `inithardcore` and
   * `initknotboy` all found the identical four instructions in their own class
   * and read them this way.
   */
  if (k.player.down) {
    e.facing = k.player.x > e.x ? -1 : 1;
    return install(e, WEREA.mill);
  }
  // `0x44e736` — and this one does NOT return: it turns and carries on deciding
  if (t.forward < 0) e.facing = -e.facing;
  // `0x44e749` — standing behind him is a reason to want the other side
  if (t.side === 0) e.side = e.side === 0 ? 1 : 0;
  // `0x44e75b` — and so is finding this side crowded
  if (k.crowded(e)) e.side = e.side === 0 ? 1 : 0;
  // `0x44e76e` — more than a hundred below him and the band is read as the far one
  const band = e.y - k.player.y > 100 ? 0 : t.band;
  // `0x44e77f` — he is on the way UP, so the anti-air goes out instead
  if (k.player.vy < -5) return install(e, WEREA.antiAir, true);
  /**
   * `0x44e7a0` — and if he is mid-blow, half the time it answers the blow
   * rather than the distance: `0x40e300(0xfa) / 2` against its own nerve decides
   * whether that means out of reach or straight in.
   */
  if (k.player.swinging && k.roll(100) < 50) {
    return install(
      e,
      k.scaled(0xfa) / 2 > (e.nerve ?? 0) ? WEREA.away : WEREA.near,
    );
  }
  /**
   * `0x44e806` — on the wrong side of him, and far enough out to fix it.
   *
   * `AI+6` is 1 for wanting to stand WEST of him and `obj+0x28` is the mirror
   * flag, 1 for facing west, so the two agreeing means it is already where it
   * means to be. Disagreeing at the outermost band leaps it clean over him.
   */
  const wanted = e.side === 1 ? -1 : 1;
  if (wanted !== e.facing && band <= 0) return install(e, WEREA.over, true);
  switch (band) {
    /**
     * Beyond 330: it leaps. Within three hundred of his height that is the
     * flying kick; below him by more, `0x44e878` solves the arc instead —
     * `sqrt(gravity * drop * 2)` out of `0x434630`, an integer square root, and
     * it lifts itself fifty pixels first.
     */
    case 0: {
      const drop = e.y - k.player.y;
      if (drop < 300) return install(e, WEREA.kick, true);
      e.vy = -k.root(k.gravity * drop * 2);
      e.vx = 0;
      e.y -= 50;
      return install(e, WEREA.hop, true);
    }
    // 200..330 — out of territory it kicks, otherwise it walks in
    case 1:
      return k.atBound(e)
        ? install(e, WEREA.kick, true)
        : install(e, WEREA.approach);
    /**
     * 150..200 — the decision band, and it only counts when the stance ENDS.
     * `0x44e909` spends one of `AI+4` each time round, and when they run out it
     * commits: a coin flip between a long step in and a short one, and three
     * more on the clock.
     */
    case 2: {
      if (!done) return false;
      const left = e.decisions ?? 3;
      e.decisions = left - 1;
      if (left >= 0) return install(e, WEREA.stance);
      e.decisions = k.roll(3);
      return k.roll(2) === 1
        ? install(e, WEREA.stepIn)
        : install(e, WEREA.near);
    }
    /**
     * 80..150 — it taunts, on a beat of its own. `0x44e982` counts `AI+2` down,
     * reseeds it with `rand(8)`, growls, and picks out of the five: the three
     * that walk in while its nerve holds, the two that stand when it does not.
     */
    case 3: {
      const beat = e.beat ?? 8;
      e.beat = beat - 1;
      if (beat >= 0) return false;
      e.beat = k.roll(8);
      k.say(e, WEREA.growl);
      if (k.roll(100) < 50 && k.scaled(0xfa) / 2 < (e.nerve ?? 0)) {
        return install(e, WEREA.taunt[1 + k.roll(3)]);
      }
      return install(e, WEREA.taunt[k.roll(2) - 1]);
    }
    // inside 80 — the punch, and `0x44ea2f` grunts as it goes
    default:
      k.say(e, WEREA.grunt);
      return install(e, WEREA.punch, true);
  }
}

export { NOT_HERE as WEREA_NOT_HERE };
