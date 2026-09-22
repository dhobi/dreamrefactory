/**
 * The thrower — `initwerec`, `0x4523d0`, and the first class in the chapter that
 * fights at RANGE.
 *
 * ## Its nine scripts, and therefore its nine states
 *
 * `0x45d090` writes a script's own kind into `obj+0x18`, so this table IS the
 * machine's alphabet. The class's data region is contiguous from `0x4778c0` to
 * `0x477abe` and then the band list starts, so these nine are all of them —
 * there is no orphan script in the gap the way the CHOPPER has one:
 *
 * ```
 *   0  0x4778c0  the idle: one cel, no stride — it does NOT patrol
 *   1  0x4778d0  the same cel again, and the state that DECIDES
 *   2  0x4778e0  tag 0 the walk, tag 1 the same six cels at double stride
 *   3  0x477a68  the one-cel reaction a −9 blow puts it in, and it is fatal
 *   4  0x4779b0  the swipe, its only blow in reach
 *   5  0x477978  what it walks while the player is down
 *   6  0x477a00  the throw: tag 0 winds up, tag 1 follows through, tag 2 fans
 *   7  0x477a48  the three flinches
 *   8  0x477a78  the death
 * ```
 *
 * ## What this module owns, and what it does not
 *
 * Six of the nine — 0, 1, 2, 4, 5 and 6 — are the ones a thing is in while it is
 * on its feet, and those are here. 3, 7 and 8 are the hit reactions, and the
 * page already drives the last two through {@link Foe.flinch}, {@link Foe.pick}
 * and {@link Foe.death}; a brain is never called while an enemy is flinching or
 * dying. They are written out above so the next reader can see what is
 * deliberately elsewhere, and what they carry that the page does not is named at
 * {@link NOT_HERE}.
 *
 * ## The thing it throws
 *
 * `0x452b20` is a projectile creator of its own: it allocates out of `0x477ca0`,
 * copies the thrower's mirror flag, starts the shot seventeen above and twenty
 * either side of the thrower (`0x452b54`, `0x452b6a`), and solves the arc from
 * the horizontal gap to the target through `0x434630`, the integer square root
 * (`0x452b85`). Its third argument picks the shape, and the two shapes are not
 * variations on each other:
 *
 * ```
 *   452b85  v = isqrt(|self.x - target.x| * obj+0x24) >> 1
 *   452ba6  mode 0   vx = +-v by the SHOT's facing, vy = -v      an arc
 *   452bc0  mode n   vy = 0, obj+0x34 = 0, vx = +-13n by the THROWER's
 * ```
 *
 * `obj+0x24` is 10, the engine's default weight, because `0x452c67` never calls
 * `0x42f850` — so the arc's range works out at exactly **half the gap it was
 * aimed across**, and the aimed throw is a lob that lands short on purpose.
 * The fan is the attack that reaches, and `obj+0x34` going to zero is why: it
 * is the flag `0x42fe4a` tests before scanning the object list at `0x4a69d0`,
 * and `0x452d9d` sets it back the frame the player is within two hundred in y.
 * A fan shot is a ghost until it is on your row.
 *
 * ## ...and the thing it throws cannot hurt you, which is the point
 *
 * `0x452c67` never writes `obj+0x1a` either, so the shot flies at strength
 * ZERO, and its three flight cels — 6004, 6005, 6006 — carry a strike box with
 * **no blow pair at all**. `0x452ec0` writes `0x65` the frame the burst script
 * `0x477c60` becomes its state, and the burst's first three cels (7000, 7001,
 * 7002) are the ones that carry `dx 43`. So the dud is the delivery and the
 * flash is the weapon, and {@link CastKit.onImpact} is that rule.
 *
 * What kept all of it out was "nothing in this port hits the player back", and
 * that stopped being true. It is here now.
 *
 * ## Two fields that are NOT what the punk's are
 *
 * `AI+0` is this class's **health**, not a nerve: `0x450c4c` seeds it
 * `0x40e300(0xb4)` and `0x4529e7` subtracts the blow from it. Nothing else reads
 * it except the preamble below, so `e.nerve` is left alone and the port's own
 * `e.hp` is the health.
 *
 * `AI+6` is not a side either. `0x4526bd` and `0x452851` step it and wrap it
 * past five, and the only thing it is ever spent on is choosing which of the
 * fan's shots goes out — so it is carried on `e.side` (which is that word) and
 * steers nothing here until the shot above is flown.
 *
 * ## The preamble, which is the health bar and not a decision
 *
 * `0x4523ec`..`0x45242a` runs before the jump table and does one thing: when the
 * band is 2 or nearer, the player is in front, and the state is neither the idle
 * nor the death, it claims the on-screen enemy bar with
 * `0x40d1c0(AI+0, 0x40e300(0xb4), 0x32cc, own point)` — current, maximum, plate.
 * `0x40d1c0` keeps whichever claimant is nearest the player (`0x46bd28`), which
 * is why the test is a band and not a flag. The page draws that bar from
 * {@link Foe.panel} and a brain has no hook into it, so it is read here and not
 * done.
 */
import {
  install,
  type Brain,
  type BrainCtx,
  type CastKit,
  type Enemy,

  type Reaction,
} from "./kit";

/**
 * The three states this module leaves alone, and what they do that the page's
 * own flinch and death path does not.
 *
 * - **3**, `0x45269b`: the reaction to a blow whose strength is exactly **−9**
 *   (`0x45296e` tests `obj+0x1a` against `0xfff7` before anything else). It is
 *   not a flinch — it is a death with a tantrum in it. For the five engine
 *   frames of `0x477a68` the think function jitters its own point up to forty up
 *   and forty either side (`0x45269b`, `0x4526a8`), fires a shot from there,
 *   flips its own mirror flag and puts the point back; then when the script ends
 *   it squeals `0x21`, clears the bar, installs the death and pays **0x104** to
 *   the score (`0x452737`). The spawner is here now and the shot it fires is
 *   {@link WEREC_SHOT} — `0x4526db` passes SELF as the target, so the gap is
 *   zero and every one of them comes out flat. What is still out of reach is
 *   the state: the page has no notion of a blow strength of −9, and a brain is
 *   never called during {@link Foe.death}, which is where these five frames
 *   live. It would want the death path to run a think, not another seam.
 * - **7**, `0x452898`: the flinch, and it ends in the stance rather than in
 *   anything of its own — one branch shorter than the punk's, which is what
 *   {@link Foe.pick} already says.
 * - **8**, `0x4528ba`: the corpse. It zeroes the shove weight, counts `AI+2`
 *   down as the linger, holds `obj+0x10` at −12 while it lasts and is the ONLY
 *   path in the whole function that answers 1 — the frame the object is removed.
 */
const NOT_HERE = "0x45269b, 0x452898, 0x4528ba" as const;

/**
 * Its repertoire, by kind and tag, straight out of `0x4778c0`…`0x477a78`.
 *
 * Every cel, hold and stride below is the script's own. Nothing it plays on its
 * feet travels vertically and nothing leaves the ground: this class has no leap
 * at all, which is the whole of why it throws.
 */
export const WEREC = {
  /** kind 0 — one cel and no stride. It stands in its patch; it does not pace */
  idle: { cels: [5090], hold: 1, kind: 0, tag: 0, from: "0x4778c0 tag 0" },
  /** kind 1 — the same single cel, and state 1 is where the whole fight is */
  stance: { cels: [5090], hold: 1, kind: 1, tag: 0, from: "0x4778d0 tag 0" },
  /** kind 2 tag 0 — six cels that travel, the ordinary closing walk */
  walk: {
    cels: [5090, 5091, 5092, 5093, 5094, 5095],
    hold: 2,
    dx: [75, 75, 75, 75, 75, 75],
    kind: 2,
    tag: 0,
    from: "0x4778e0 tag 0",
  },
  /**
   * kind 2 tag 1 — the SAME six cels twice over at double the stride.
   *
   * Eighteen records sit in `0x4778e0` and the last twelve are this: 150 a cel
   * instead of 75. It is what the outermost band closes on and what the third
   * band RETREATS on, so the one script is both its charge and its bolt.
   */
  charge: {
    cels: [
      5090, 5091, 5092, 5093, 5094, 5095, 5090, 5091, 5092, 5093, 5094, 5095,
    ],
    hold: 2,
    dx: [150, 150, 150, 150, 150, 150, 150, 150, 150, 150, 150, 150],
    kind: 2,
    tag: 1,
    from: "0x4778e0 tag 1",
  },
  /** kind 4 — the swipe, and the only thing it does inside eighty pixels */
  swipe: {
    cels: [6010, 6010, 6011, 6012, 6013, 6014, 6012, 6011, 6010],
    hold: 2,
    kind: 4,
    tag: 0,
    from: "0x4779b0 tag 0",
  },
  /** kind 5 — what it walks while the player is down, at the ordinary stride */
  mill: {
    cels: [5090, 5091, 5092, 5093, 5094, 5095],
    hold: 2,
    dx: [75, 75, 75, 75, 75, 75],
    kind: 5,
    tag: 0,
    from: "0x477978 tag 0",
  },
  /** kind 6 tag 0 — the wind-up, and `0x4527fd` lets the aimed shot go as it ends */
  throwUp: {
    cels: [6000, 6001, 6002],
    hold: 2,
    kind: 6,
    tag: 0,
    from: "0x477a00 tag 0",
  },
  /** kind 6 tag 1 — one cel held four records: the follow-through both throws end in */
  release: {
    cels: [6003, 6003, 6003, 6003],
    hold: 2,
    kind: 6,
    tag: 1,
    from: "0x477a00 tag 1",
  },
  /** kind 6 tag 2 — a single cel: the flat shot it fans off a different row */
  fan: { cels: [6002], hold: 2, kind: 6, tag: 2, from: "0x477a00 tag 2" },
  /** `0x477ac0` — the descending list `0x45efd0` reads the band out of */
  bands: [550, 450, 220, 80],
  /** `0x452584` and `0x452644` — `woods.snd` 0x1c, the squeal both throws open on */
  squeal: 0x1c,
  from: "0x4523d0",
} as const;

/**
 * What `0x452b20` builds — one shot, whichever of the two shapes it is.
 *
 * `0x452c67` is the whole of its constructor and it sets five things: the
 * divisor 6, the cel bank, the think, cel 6004, and the script `0x477c38`. It
 * calls neither `0x42f850` nor anything that writes `obj+0x1a`, so the weight
 * is the engine's default 1.0 and the strength is the engine's default zero.
 *
 * The three flight cels and the seven burst cels come out of the books the
 * same way everything else here does, and what settles which half of it is the
 * attack is that **only 7000, 7001 and 7002 carry a blow pair** (`dx 43`);
 * 6004, 6005 and 6006 carry a strike box and nothing to put through it.
 */
const WEREC_SHOT: CastKit = {
  // `0x477c38` kind 0: tag 0 is two records of 6004, tag 1 is 6005 and tag 2
  // is 6006, one engine frame each. `0x452dbf` leaves tag 0 the frame the
  // thing starts to FALL, so the launch pair is only ever what it looks like
  // on the way up.
  cels: [6004, 6004],
  hold: 1,
  /** ...and then the flight cel, which holds — `0x452dea` installs tag 1 */
  then: { cels: [6005], hold: 1 },
  /** unused: every shot's velocity is worked out at the throw. See {@link Aim} */
  speed: 0,
  /** `0x452b6a` — twenty along the facing... */
  ahead: 0x14,
  /** ...and `0x452b54`, seventeen above the anchor */
  lift: 0x11,
  /** `obj+0x24`, which nothing writes, so it is `0x42f5ca`'s own ten */
  pull: 10,
  /** `0x452d4d` — the think pins `obj+0xa` inside forty either way */
  capFall: 0x28,
  /** `0x452ec0` — and {@link CastKit.onImpact} is why it is not spent in flight */
  blow: 0x65,
  onImpact: true,
  /**
   * `0x477c60` — seven cels at one frame each, and `0x452ed1` removes the
   * object when the script ends. The first three are the flash that hurts.
   */
  impact: { cels: [7000, 7000, 7001, 7002, 7003, 7004, 7005], hold: 1 },
  /**
   * The page's own, and it has to be: `0x452d40` ends a shot on the collision
   * words and this page runs no obstacle solver for casts, so a fan shot that
   * meets nothing would otherwise cross the level. A thousand is the same
   * figure `0x418621` keeps the gob to.
   */
  reach: 0x3e8,
  from: "0x452b20 / 0x452c50, script 0x477c38 and burst 0x477c60",
};

/**
 * The arc, solved the way `0x452b85` solves it.
 *
 * `v = isqrt(|gap| * 10) >> 1`, and both halves of the velocity are that same
 * number — `0x452ba6` writes it into `obj+0xc` and `0x452ba9` writes its
 * negation into `obj+0xa`. Which makes the range `2v²/g`, which is `|gap|/2`:
 * the lob is meant to fall short.
 */
function arc(e: Enemy, k: BrainCtx): { vx: number; rise: number } {
  const v = k.root(Math.abs(e.x - k.player.x) * (WEREC_SHOT.pull ?? 10)) >> 1;
  return { vx: e.facing * v, rise: v };
}

/**
 * ...and the fan's, which solves nothing — `0x452bc0`.
 *
 * Flat, and thirteen pixels a frame per step of the counter. `0x452bcd`'s
 * `and eax, 0x1a; sub eax, 0xd` is +13 facing east and −13 facing west, times
 * `AI+6`, so the six shots of a fan go out at 13, 26, 39, 52, 65 and 78 — and
 * the one thrown on a counter of zero does not move at all.
 */
const FAN_STEP = 0xd;

/** `0x4524cc` — the player this far below is on another row, and it fans instead */
const ROW = 0x28;
/** `0x45262c` — and past this the fan is not worth throwing at all */
const TOO_FAR = 0x3e8;
/** `0x450c77` — `AI+2`, the beat between throws, as the creator seeds it */
const BEAT = 0x14;

/**
 * `initwerec`'s own machine, the six states it is in on its feet.
 *
 * ## The stack frame, which is where the field numbers come from
 *
 * `0x4523d0` does `sub esp, 0x10`, takes the buffer's address immediately, and
 * then pushes **four** registers — `ebx`, `esi`, `edi`, `ebp` — before the two
 * arguments to `0x45efd0` go on and come back off again. So by the time the
 * fields are read the sixteen bytes sit at `esp+0x10`: `esp+0x10` is `out+0`,
 * the side, `esp+0x14` is `out+4`, the BAND, `esp+0x18` is `out+8`, the drop to
 * the player, and `esp+0x1a` is `out+0xa`, the forward distance. `0x4523fa`
 * settles it — `[esp+0x24]` there is the first argument, the object, which only
 * works with four registers down.
 *
 * `out+6`, whether the player's own cel is mid-blow, is never read by this
 * class. The punk answers a swing with a coin flip; the thrower does not care.
 *
 * ## And the return value
 *
 * Every path in `0x4523d0` ends `xor ax, ax`, the waiting ones included. The one
 * `mov ax, 1` is `0x452908`, the frame the corpse is removed, and that is state
 * 8's and not this module's. So everything below returns `false`.
 */
export const werec: Brain = (e, foe, run, k) => {
  const done = e.clock >= run;
  const t = k.track(e, WEREC.bands);
  e.beat ??= BEAT;
  e.side ??= 0;
  switch (e.script ?? 0) {
    /**
     * ---- 0, `0x45244c`: the idle, and the one thing that ends it.
     *
     * It turns to face the player whether or not it is fighting, and then asks
     * `0x434200(player.point, AI+8)` — his point inside this record's own rect.
     * There is no patrol branch and no territory width test: kind 0 is one cel
     * with no stride, so a thrower waiting for you stands perfectly still.
     */
    case 0:
      if (t.forward < 0) e.facing = -e.facing;
      return install(e, e.fighting ? WEREC.stance : WEREC.idle);
    // ---- 1, `0x452491`: the stance, and the only state that thinks every frame
    case 1:
      return decide(e, k, t);
    /**
     * ---- 2, `0x452667`: a walk that ends in the stance.
     *
     * Two ways out and either will do — the script running out, or reaching the
     * bound it is walking towards — so a thrower that has run to the end of its
     * patch stops and starts deciding again instead of grinding into the wall.
     */
    case 2:
      return done || k.atBound(e) ? install(e, WEREC.stance) : false;
    // ---- 4, `0x45274f`: the swipe asserts `obj+0x1a` 100 and hands back
    case 4:
      // `0x45274f` — the strength it would land is 100, the same figure
      // `0x452355` gives it at init. Nothing hits the player back here.
      return done ? install(e, WEREC.stance) : false;
    /**
     * ---- 5, `0x45277b`: what it does while the player is down.
     *
     * And what ends it: the frame he is back on his feet the thrower is put back
     * on its own record's point — `0x4527b5` copies the whole dword at `AI+0x10`
     * over `obj+6`, so the Y goes back with the X — and it stands idle again.
     */
    case 5:
      if (!done) return false;
      if (k.player.down) return install(e, WEREC.mill);
      e.x = e.home ?? e.x;
      e.fighting = false;
      return install(e, WEREC.idle);
    /**
     * ---- 6, `0x4527cc`: the throw, sub-dispatched on `obj+0x44`.
     *
     * Both shapes end in tag 1 and tag 1 ends in the stance, so the fan and the
     * aimed throw share a follow-through. What the disc does as tag 0 ends is
     * `0x452b20(self, the player, 0)` and as tag 2 ends is the same call with
     * the `AI+6` counter — the shot, which this port does not spawn.
     */
    case 6: {
      if (!done) return false;
      const tag = e.tag ?? 0;
      // `0x4527fd` — the aimed shot, then the follow-through
      if (tag === 0) {
        k.cast(e, WEREC_SHOT, arc(e, k));
        return install(e, WEREC.release, true);
      }
      // `0x452820` — and the follow-through hands back to the stance
      if (tag === 1) return install(e, WEREC.stance);
      if (tag === 2) {
        /**
         * `0x452851` — step the counter, and wrap it the way the disc does:
         * the compare is against the value BEFORE the increment, so it runs
         * 0,1,2,3,4,5,6 and only then back to 0. Seven, not six.
         */
        const was = e.side ?? 0;
        e.side = was > 5 ? 0 : was + 1;
        // `0x452875` — and the counter it throws on is the one AFTER the step
        k.cast(e, WEREC_SHOT, {
          vx: e.facing * FAN_STEP * e.side,
          rise: 0,
        });
        return install(e, WEREC.release, true);
      }
      // `0x4527de` — a fourth tag would fall straight out, and there isn't one
      return false;
    }
    default:
      return false;
  }
};

/**
 * State 1, `0x452491` — the whole of the fight, decided fresh every frame.
 *
 * Face him, answer the two things that come before the band — he is down, or he
 * is on another row — and then act on the band. It never waits for its own
 * script: kind 1 is a single cel, so the stance is a place to think from rather
 * than something to play out.
 */
function decide(
  e: Enemy,
  k: BrainCtx,
  t: ReturnType<BrainCtx["track"]>,
): boolean {
  // `0x452491` — and it puts its shove weight back to 8 here, the figure
  // `0x45233c` gives it at init. The port has no shove weight.
  // `0x452497` — turn to face him, and carry on deciding
  if (t.forward < 0) e.facing = -e.facing;
  /**
   * `0x4524a3` — `0x402f60` answers 1 while the player's own state is under
   * `0x1a`, which is to say while he is upright. With him down the thrower turns
   * its back — the flip at `0x4524ad` is a SECOND one, on top of the turn above,
   * so it ends up facing away — and walks off on kind 5.
   */
  if (k.player.down) {
    e.facing = -e.facing;
    return install(e, WEREC.mill);
  }
  // `0x4524cc` — forty or more below it he is on another row, and that is its own branch
  if (t.dy >= ROW) return offRow(e, k, t);
  // `0x4524e0` — the band dispatch is an unsigned `cmp eax, 4; ja`, and standing
  // behind him is band −1, which falls clean through it and does nothing
  if (t.band < 0) return false;
  switch (t.band) {
    /**
     * Beyond 550 — `0x4524ed`. It runs at him on the double-stride tag, unless
     * it is already within sixty of the bound it faces, in which case it holds
     * the stance rather than walk into the wall.
     */
    case 0:
      return k.atBound(e) ? false : install(e, WEREC.charge);
    // 450..550 — `0x45251a`, the same test and the ordinary walk
    case 1:
      return k.atBound(e) ? false : install(e, WEREC.walk);
    /**
     * 220..450 — `0x452547`, and this is the throwing band.
     *
     * `AI+2` counts down a frame at a time and the throw goes out when it passes
     * zero. Standing in FRONT of the player takes four extra off it each frame
     * (`0x45254e`, and `out+0` is the dword the side lives in), so a thrower he
     * is walking towards throws five times as often as one he has his back to.
     * The reseed is `0x434540(0x32) + 0x32` — fifty-one to a hundred frames.
     */
    case 2: {
      let beat = e.beat ?? BEAT;
      if (t.side === 1) beat -= 4;
      e.beat = beat - 1;
      if (beat >= 0) return false;
      e.beat = k.roll(0x32) + 0x32;
      k.say(e, WEREC.squeal);
      return install(e, WEREC.throwUp, true);
    }
    /**
     * 80..220 — `0x4525a7`, and it BACKS OFF. He is too close to throw at.
     *
     * The bound it asks about here is `0x456590`, which picks `obj+0x38` and
     * `obj+0x3a` by the opposite half of the mirror flag from `0x456550` — the
     * bound behind it rather than the one it faces. Clear of that, it flips away
     * from the player and bolts on the double-stride tag; backed up against it,
     * it keeps the facing the turn above gave it and the same fast walk carries
     * it INTO him instead. `0x4525b9` drops its shove weight to 0 on the way, so
     * the retreat pushes through its own kind.
     */
    case 3:
      if (!atBackBound(e, k)) e.facing = -e.facing;
      return install(e, WEREC.charge);
    // inside 80 — `0x4525da`, the swipe, and there is nothing else in here
    default:
      return install(e, WEREC.swipe, true);
  }
}

/**
 * `0x4525f5` — the player is forty or more below, so the band list is wrong
 * about him and the fan answers instead.
 *
 * One beat, counted the same way as the throwing band's but with no side bonus
 * and a shorter reseed — `(0x434540(0x19) + 0x32) / 2`, twenty-five to
 * thirty-seven frames. The reseed happens whether or not the throw goes out
 * (`0x452622` stores it before either test), so a thrower that is too far out
 * still spends the beat rather than banking it.
 */
function offRow(
  e: Enemy,
  k: BrainCtx,
  t: ReturnType<BrainCtx["track"]>,
): boolean {
  const beat = e.beat ?? BEAT;
  e.beat = beat - 1;
  if (beat >= 0) return false;
  e.beat = Math.trunc((k.roll(0x19) + 0x32) / 2);
  // `0x45261c` — behind him, or beyond the outermost band, and it throws nothing
  if (t.band < 1) return false;
  // `0x45262c` — and a thousand below is off the bottom of anything worth aiming at
  if (t.dy >= TOO_FAR) return false;
  k.say(e, WEREC.squeal);
  return install(e, WEREC.fan, true);
}

/**
 * `0x456590` — within sixty of the bound it has its BACK to.
 *
 * It is `0x456550` with the mirror test inverted and nothing else changed, and
 * the page's {@link BrainCtx.atBound} is `0x456550`. Rather than copy the sixty
 * out a second time and have two of them to keep in step, the facing is turned
 * round for the length of the question and put back.
 */
function atBackBound(e: Enemy, k: BrainCtx): boolean {
  e.facing = -e.facing;
  const at = k.atBound(e);
  e.facing = -e.facing;
  return at;
}

export { NOT_HERE as WEREC_NOT_HERE };

/**
 * State 3, `0x45269b` — the death throw, and the one thing in this class that
 * is not reachable from a {@link Brain}.
 *
 * A blow of −9 — the flamer's flame, or a flare on stage 5 — is the first
 * thing `0x452960` tests (`0x45296e`). It costs no health at all: the arm
 * lights the thing with `0x44ff20` and installs `0x477a68`, one cel at five
 * engine frames a cel, and answers 1 before any arithmetic runs. Which makes
 * state 3 a five-frame window, and this is what it does with it:
 *
 * ```
 *   45269b  bx = 0x434540(0x28)             ; 1..40
 *   4526a8  bp = 0x434540(0x50) - 0x28      ; -39..+40
 *   4526b2  self.y -= bx ; self.x -= bp     ; ...move, fire, move back
 *   4526bd  AI+6 = AI+6 > 5 ? 0 : AI+6 + 1
 *   4526db  0x452b20(self, SELF, AI+6)      ; the target is ITSELF
 *   4526e0  self.facing ^= 1
 *   4526e4  self.y += bx ; self.x += bp
 * ```
 *
 * The target being **itself** is what makes these different from the throws:
 * the gap is zero, so `isqrt(0) >> 1` is zero and the arc collapses — every
 * one of them comes out as the fan's flat shot at `13 * AI+6`, and the facing
 * flips between each, so a corpse throws them alternately left and right.
 *
 * And the jitter is not decoration. The shot is built at the thrower's point,
 * so moving the point, firing, and moving back is how five shots leave five
 * different places without the body appearing to move at all.
 *
 * `0x4526ef` is the end of it: when the script runs out it squeals `0x21`,
 * clears the bar and installs the death. The page's own path owns that last
 * part — which is why this returns nothing and installs nothing.
 */
export const werecReacts: Reaction = (e, foe, run, k) => {
  // the page only ever puts it here through {@link Foe.burns}, and only this
  // class's burn animation is the throw — a flinch from an ordinary blow is
  // still an ordinary flinch
  if (e.anim !== foe.burns?.anim) return;
  const up = k.roll(0x28);
  const along = k.roll(0x50) - 0x28;
  const wasX = e.x;
  const wasY = e.y;
  e.y -= up;
  e.x -= along;
  // `0x4526bd` — the same seven-step wrap the fan uses, and the shot goes out
  // on the counter AFTER the step
  const was = e.side ?? 0;
  e.side = was > 5 ? 0 : was + 1;
  k.cast(e, WEREC_SHOT, { vx: e.facing * FAN_STEP * e.side, rise: 0 });
  // `0x4526e0` — and it turns between every one of them
  e.facing = e.facing > 0 ? -1 : 1;
  e.x = wasX;
  e.y = wasY;
  // `0x4526fa`: the squeal belongs to the frame the script runs out, and the
  // death the page installs after it is {@link Foe.death}
  if (e.clock >= run - 1) k.say(e, WEREC.squeal);
};
