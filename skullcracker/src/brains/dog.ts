/**
 * The dog — `initdog`, think function `0x454be0`, jump table `0x455074`.
 *
 * ## Its nine scripts, and therefore its nine states
 *
 * `0x45d090` copies a script's own kind into `obj+0x18`, so the class's script
 * list IS its alphabet. The dog's nine sit end to end from `0x477f80` to
 * `0x478208`, each one `{i16 count, i16 ticksPerFrame, i16 kind, i16}` and then
 * `count` eight-byte frames, and the band list `0x478240` follows the last of
 * them:
 *
 * ```
 *   0  0x477f80  one cel, three frames a cel: sitting, and the whole patrol
 *   1  0x477f90  tag 0 standing, tag 1 the rear, tag 2 the bristle — the DECIDER
 *   2  0x477fe0  the walk, ten cels at 65
 *   3  0x478038  the trot, six cels at 110
 *   4  0x478070  the charge, the same six three times over at 150
 *   5  0x478108  tag 0 the lunge, tag 1 the snap
 *   6  0x4781b0  the pounce, the one script that leaves the ground twice
 *   7  0x4781f8  the flinch — one cel, four frames
 *   8  0x478208  the death, cels 4850…4855
 * ```
 *
 * ## What this module owns, and what it does not
 *
 * Seven of the nine — 0 through 6 — are the ones a dog is in while it is on its
 * feet, and those are here. 7 and 8 are the hit reactions, which the page
 * already drives through {@link Foe.flinch} and {@link Foe.death}; a brain is
 * never called while a thing is flinching or dying, so wiring them here would
 * give one animation two owners. What they do that the page's own path does not
 * is written out at {@link NOT_HERE}.
 *
 * ## The one thing the dog does NOT have
 *
 * A patrol. State 0 (`0x454c13`) is a single cel and one test — the player's
 * point against the record's own rect — and there is no walk in it and no way
 * back out of the fight once that test has passed. The punk's `0x44ec26`, which
 * puts it back on its record's point when the player stands up again, has no
 * counterpart here: a dog that has seen you is in state 1 until it dies.
 *
 * ## The stack frame, which is where every field number below comes from
 *
 * `0x454be0` does `sub esp, 0x10` and takes the output pointer with
 * `lea eax, [esp + 4]` **before** it pushes `ebx`, `esi` and `edi`, so in the
 * body the sixteen bytes `0x45efd0` filled sit at `esp+0x10`, not `esp+0xc` as
 * they do in `0x44e580`. That makes `esp+0x10` `out+0` (the side), `esp+0x14`
 * `out+4` (the band), `esp+0x16` `out+6` (the player mid-blow) and `esp+0x1a`
 * `out+0xa` (the forward distance) — and every one of those four is read
 * somewhere below, which is what confirms the count.
 *
 * `esi` is the object (`mov esi, [esp+0x28]`, the FIRST argument) and `edi` the
 * AI struct (`mov edi, [esp+0x24]`, the second). The dog's AI struct is the
 * thirty bytes `0x450f60` allocates, and its layout is its own: `AI+0` the
 * nerve, `AI+2` the beat, `AI+4` the flag the lunges raise, `AI+6`…`AI+0xc` the
 * record's rect and `AI+0xe` the tracker itself — `0x450fd6` hands `AI+0xe` to
 * `0x45ef70` with the band list, and `0x454bf2` hands the same pointer to
 * `0x45efd0` every frame. There is no home point: nothing sends a dog home.
 *
 * ## And the return value
 *
 * Every path of `0x454be0` falls through `0x455061`, which is `xor ax, ax` —
 * the waiting paths included. The single `mov ax, 1` is `0x45504d`, the frame
 * the corpse is removed, and that is state 8 and not here. **So every path of
 * this brain returns `false`.**
 */
import {
  install,
  rewind,
  type Brain,
  type BrainCtx,
  type Enemy,
  type Reaction,
} from "./kit";

/**
 * The hit-reaction states, 7 and 8, and the handler that picks between them.
 * Read, not done — the page owns those animations.
 *
 * - **the handler**, `0x4550b0`, is what `0x454b33` hangs on `obj+0x12`. It
 *   refuses the blow outright when its owner is of the dog's own class or of
 *   the two others at `[0x47760c]` and `[0x477c34]` (`0x430ee0` three times
 *   over, `0x455137`…`0x455179`), and again when the blow's strength word is
 *   negative (`0x45517f`). A strength of exactly **−9** (`0x4550d3`) kills it
 *   where it stands, health untouched, through `0x44ff20`.
 * - **7**, the flinch: `0x45521b` installs `0x4781f8`, one cel held four
 *   frames, and answers 1. State 7 at `0x454ff3` then waits for that cel to run
 *   out, **flips the mirror flag** (`0x454ffa`) and installs the charge
 *   `0x478070` — so a dog that has been hit turns round and bolts. The page
 *   plays the cel and hands the dog this brain's `case 7` the frame it ends
 *   (`FoeAnim.decides`), which does the flip and the charge.
 * - **8**, the death: `0x4550fa` and `0x4551de` install `0x478208`, say 0x18,
 *   clear `obj+0x26` so the corpse leaves the collision list, and write
 *   `[0x46b204]` into **`AI+2`** — the same word the beat below counts down.
 *   State 8 at `0x455010` spends it a frame at a time, drops `obj+0x10` to −12
 *   while it lasts ({@link dogReacts}), and on the frame it runs out removes
 *   the object.
 */
const NOT_HERE = "0x4550b0, 0x455010" as const;

/**
 * `0x45505b` — state 8, the corpse: `mov word ptr [esi+0x10], 0xfff4` on every
 * frame its count lasts, so the body settles twelve pixels into the ground it
 * fell on. A brain is never called while a thing is dying, so it is a
 * {@link Reaction}.
 */
export const dogReacts: Reaction = (e) => {
  if (e.state === "dead") e.floor = DOG_CORPSE_FLOOR;
};

/** `0x45505b` — `mov word ptr [esi+0x10], 0xfff4` */
const DOG_CORPSE_FLOOR = -12;

/**
 * The dog's repertoire, by kind and tag, straight out of `0x477f80`…`0x478208`.
 *
 * Every cel, hold, stride and lift is the script's own; `hold` is the script
 * header's `ticksPerFrame`, and the dog is the class that does not use one rate
 * throughout — the sit is three frames a cel, the decider one, everything it
 * moves on two. The cels are absolute: `0x454b26` writes `0x12c0` — 4800 — into
 * `obj+0`, which is the base the scripts are already counted from.
 *
 * The names are the roles the machine gives them, not what the art shows. Two
 * are worth saying out loud: `rear` is the lunge's own cels played backwards
 * (4822, 4822, 4821, 4820, 4820) and travels nowhere, and `bristle` is the only
 * thing in the class that uses cels 4830 and 4831 at all — and the only stance
 * tag from which an attack can be rolled (`0x454e2b`).
 */
export const DOG = {
  /** kind 0 — `0x477f80`. One cel, three frames of it, and it does not travel */
  sit: { cels: [4800], hold: 3, kind: 0, tag: 0, from: "0x477f80 tag 0" },
  /** kind 1 tag 0 — the standing cel the whole fight is decided over */
  stand: { cels: [4800], hold: 1, kind: 1, tag: 0, from: "0x477f90 tag 0" },
  /** kind 1 tag 1 — the lunge's first cels in reverse, going nowhere */
  rear: {
    cels: [4822, 4822, 4821, 4820, 4820],
    hold: 1,
    kind: 1,
    tag: 1,
    from: "0x477f90 tag 1",
  },
  /** kind 1 tag 2 — cels 4830/4831, and the only tag that can roll an attack */
  bristle: {
    cels: [4830, 4831, 4830],
    hold: 1,
    kind: 1,
    tag: 2,
    from: "0x477f90 tag 2",
  },
  /** kind 2 — `0x477fe0`, the walk: ten cels, 65 apiece */
  walk: {
    cels: [4800, 4801, 4802, 4803, 4804, 4805, 4806, 4807, 4808, 4809],
    hold: 2,
    dx: [65, 65, 65, 65, 65, 65, 65, 65, 65, 65],
    kind: 2,
    tag: 0,
    from: "0x477fe0 tag 0",
  },
  /** kind 3 — `0x478038`, the trot: the running cels once, 110 apiece */
  trot: {
    cels: [4810, 4811, 4812, 4813, 4814, 4815],
    hold: 2,
    dx: [110, 110, 110, 110, 110, 110],
    kind: 3,
    tag: 0,
    from: "0x478038 tag 0",
  },
  /**
   * kind 4 — `0x478070`, the charge: the same six cels **three times over** at
   * 150, and the one script the dog stops colliding for (`0x454f4d` clears
   * `obj+0x26`). It is what it does after an attack, after a flinch, and when
   * the player is nearer than the innermost band: it runs straight through him.
   */
  charge: {
    cels: [
      4810, 4811, 4812, 4813, 4814, 4815, 4810, 4811, 4812, 4813, 4814, 4815,
      4810, 4811, 4812, 4813, 4814, 4815,
    ],
    hold: 2,
    dx: [
      150, 150, 150, 150, 150, 150, 150, 150, 150, 150, 150, 150, 150, 150, 150,
      150, 150, 150,
    ],
    kind: 4,
    tag: 0,
    from: "0x478070 tag 0",
  },
  /** kind 5 tag 0 — the lunge; 4824 is where it is off the ground and hits */
  lunge: {
    cels: [4820, 4821, 4822, 4823, 4824, 4824, 4825, 4825, 4813, 4814, 4815],
    hold: 2,
    dx: [0, 110, 110, 110, 160, 160, 110, 110, 110, 110, 110],
    dy: [0, 0, 0, 0, -80, -80, 0, 0, 0, 0, 0],
    kind: 5,
    tag: 0,
    from: "0x478108 tag 0",
  },
  /** kind 5 tag 1 — the snap: the same shape, winding up on the spot first */
  snap: {
    cels: [4820, 4821, 4822, 4823, 4824, 4825, 4813, 4814, 4815],
    hold: 2,
    dx: [0, 0, 0, 65, 160, 110, 65, 65, 65],
    dy: [0, 0, 0, 0, -80, 0, 0, 0, 0],
    kind: 5,
    tag: 1,
    from: "0x478108 tag 1",
  },
  /**
   * kind 6 — `0x4781b0`, the pounce, and the only script in the class that
   * lifts twice: −80, −160, −80, −80 over four cels. It is thrown on height
   * alone (`0x454c5e`), never on the band.
   */
  pounce: {
    cels: [4823, 4824, 4824, 4825, 4825, 4813, 4814, 4815],
    hold: 2,
    dx: [110, 0, 0, 160, 0, 0, 0, 110],
    dy: [0, -80, -160, -80, -80, 0, 0, 0],
    kind: 6,
    tag: 0,
    from: "0x4781b0 tag 0",
  },
  /**
   * `0x478240` — the descending list `0x450fd6` hands `0x45ef70`, which copies
   * it into the tracker at `AI+0xe` and stops at the terminating zero. Five
   * thresholds, so six bands, and `0x454c94` bounds the dispatch at 5.
   *
   * They are much wider than the punk's `[330, 200, 150, 80]`: the dog opens
   * from a screen and a half out.
   */
  bands: [1200, 650, 410, 320, 180],
  /** `0x4a7910` sound ids. `0x16` is the take and `0x18` the death — page's */
  bay: 0x14,
  yip: 0x15,
  growl: 0x17,
  from: "0x454be0",
} as const;

/**
 * `0x454c6d` — more than this much height between the two of them and the dog
 * pounces, whatever the band says. The one test that outranks the distance.
 */
const HEIGHT = 0x96;

/**
 * `0x454d3a` — the width the band-3 break-off is gated on. See {@link close}:
 * at band 3 the forward distance is already 320 or more, so this can never be
 * true and the branch is dead. It is written out anyway because it is in the
 * executable and the next reader will otherwise go looking for it.
 */
const BREAK_OFF = 0x12c;

/**
 * `initdog`'s own machine, states 0 to 6.
 *
 * `obj+0x1a` — the strength percent — is not set per state here the way the
 * punk sets it: `0x455065` writes 0x64 on the way out of **every** path, so a
 * dog's blow is always at full strength, and {@link Enemy.strength} is put
 * back to it every frame. Its bite cels (4824, 4825, and the bristle's 4831)
 * carry a strike box and no blow pair, so what lands is the dog's own
 * velocity (`0x42f910`): a lunge bites, a dog standing still barely does.
 */
export const dog: Brain = (e, foe, run, k) => {
  const done = e.clock >= run;
  const t = k.track(e, DOG.bands);
  /**
   * `0x450faa` — `0x40e300(0xa)` into `AI+0`, and it is not a nerve: it is the
   * HEALTH word `0x4551a9` subtracts every blow from, which the page keeps as
   * {@link Enemy.hp}. The think never reads it.
   * `0x450fc8` seeds `AI+4` to zero and nothing seeds `AI+2`, so the first
   * frame the beat is looked at it has already expired and one is rolled.
   */
  e.nerve ??= k.scaled(0xa);
  e.beat ??= 0;
  e.decisions ??= 0;
  e.strength = 0x64; // `0x455065`, on the way out of every path
  switch (e.script ?? 0) {
    /**
     * ---- 0, `0x454c13`: sitting, and the single test that ends it for good.
     *
     * `0x434200(player.point, AI+6)` — his point inside this record's own rect,
     * which is the four words `0x450fc3`/`0x450fc5` wrote there. There is no
     * walk, no bound test and no way back: the dog sits on its cel until he is
     * inside, and then it is in state 1 for the rest of its life.
     */
    case 0:
      // `0x454b65` installed the sit and state 0 keeps it; `0x454c31` stands
      return install(e, e.fighting ? DOG.stand : DOG.sit);
    // ---- 1, `0x454c46`: the decider, and the only state that thinks every frame.
    // It puts the shove weight back to 1 on every one
    case 1:
      e.shove = undefined;
      return decide(e, k, t, done);
    /**
     * ---- 2 and 3, `0x454ef1` and `0x454f1f`: the walk and the trot, and the
     * two handlers are the same instructions twice.
     *
     * Either the script has run out or `0x456550` says it is within sixty of
     * the bound it is walking at; both hand straight back to the stance, which
     * re-reads the band next frame.
     */
    case 2:
    case 3:
      return done || k.atBound(e) ? install(e, DOG.stand) : false;
    /**
     * ---- 4, `0x454f4d`: the charge, which is the dog running THROUGH him.
     *
     * `0x454f4d` clears `obj+0x26`, the word `0x430696` and `0x4306bc` gate the
     * overlap pass on, so for the eighteen cels of this script the dog is out
     * of the collision list altogether. State 1 puts it back (`0x454c46`) and
     * so does nothing else; the death handler clears it again for the corpse.
     */
    case 4: {
      e.shove = 0;
      /**
       * `0x454f53` — the jam test. It weighs the mirror flag against `obj+0xc`,
       * its actual sideways speed: facing west and not travelling west, or
       * facing east and not travelling east, means it has run into something,
       * so it turns and starts the charge again from the top.
       *
       * `obj+0xc` is one word in the executable. This page keeps it in two:
       * {@link Enemy.vx} while the thing is off its feet and
       * {@link Enemy.speed}, signed along its facing, while it walks — so the
       * word is put back together here before it is weighed. On the ground a
       * charge's own `dx 150` over the divisor of 10 has already been added by
       * the time the next frame thinks, so a dog running free always passes;
       * what fails it is a wall, whose `0x42ff02` hands back `obj+0xc` times
       * the dog's −0.3 ({@link Foe.restitution}) — travelling backwards.
       */
      const vx = e.vx !== 0 ? e.vx : (e.speed ?? 0) * e.facing;
      if (e.facing > 0 ? vx <= 0 : vx >= 0) {
        e.facing = -e.facing;
        // `0x454f7d` — the charge from its first cel, though it is the one playing
        return rewind(e, DOG.charge);
      }
      return done ? install(e, DOG.stand) : false;
    }
    /**
     * ---- 5, `0x454faa`: an attack never hands back to the stance.
     *
     * Whichever of the two tags it was, the dog charges straight out of it and
     * drops `AI+4` (`0x454fc2`) — the flag the three lunge sites raise.
     */
    case 5:
      if (!done) return false;
      e.decisions = 0;
      return install(e, DOG.charge);
    /**
     * ---- 6, `0x454fd0`: the pounce lands back in the stance.
     *
     * And `0x454fe8` puts `obj+0x34` back to 1, which `0x454c81` had cleared as
     * the pounce was thrown — see {@link decide}.
     */
    case 6:
      return done ? install(e, DOG.stand) : false;
    /**
     * ---- 7, `0x454ff3`: the flinch has run out, so it turns and bolts.
     *
     * The page plays the flinch itself (`0x4781f8`, one cel held four frames)
     * and hands the dog here ({@link FoeAnim.decides}) on the frame it ends — which is the frame `0x454ff3`'s `obj+0x46` test passes.
     * `0x454ffa` flips the mirror flag and `0x455006` installs the charge: a
     * dog that has been hit runs off the way it came.
     */
    case 7:
      e.facing = -e.facing;
      return install(e, DOG.charge);
    default:
      return false;
  }
};

/**
 * State 1, `0x454c46` — face him, answer the height, then answer the band.
 *
 * Three things in order and no more: turn if he is behind, pounce if he is far
 * enough above or below, and otherwise jump `0x455098` on the band.
 */
function decide(
  e: Enemy,
  k: BrainCtx,
  t: ReturnType<BrainCtx["track"]>,
  done: boolean,
): boolean {
  // `0x454c46` — obj+0x26 = 1: whatever the charge did, it collides again now
  // `0x454c4c` — and this one does NOT return: it turns and carries on
  if (t.forward < 0) e.facing = -e.facing;
  /**
   * `0x454c5e` — `|obj+6 − player+6|`, the two Y's, against 150.
   *
   * This is read straight off the objects and not out of the tracker's `out+8`,
   * and it comes before the band dispatch, so a dog that is a storey above or
   * below him pounces from any distance at all — including from behind, where
   * the band would have been −1 and the frame would otherwise have ended here.
   *
   * `0x454c81` clears `obj+0x34` as it goes; state 6 puts it back on landing.
   * What reads that word is not in this class and is not resolved.
   */
  if (Math.abs(k.anchorY(e) - k.player.anchor) > HEIGHT) return install(e, DOG.pounce, true);
  // `0x454c8f`/`0x455098` — and otherwise the band, six ways
  switch (t.band) {
    /**
     * Beyond 650 — both far bands go to the same handler, `0x454ca4`: it bays
     * and trots. Six cels at 110 and then the stance reads the band again.
     */
    case 0:
    case 1:
      k.say(e, DOG.bay);
      return install(e, DOG.trot);
    // 410..650 — `0x454ccc`, and it slows to the walk. No sound with this one
    case 2:
      return install(e, DOG.walk);
    // 320..410 — `0x454ce1`, the band that does the work
    case 3:
      return close(e, k, t, done);
    /**
     * 180..320 — `0x454e9b`, and this is the one that bites. No roll, no beat,
     * no wind-up: at this distance the lunge goes out every frame the stance is
     * reached, `AI+4` goes up and it growls.
     */
    case 4:
      e.decisions = 1;
      k.say(e, DOG.growl);
      return install(e, DOG.lunge, true);
    /**
     * Inside 180 — `0x454ec9`. Too close to bite, so it bays and charges: the
     * eighteen-cel run at 150 with its collision off, straight through him and
     * out the other side.
     */
    case 5:
      k.say(e, DOG.bay);
      return install(e, DOG.charge);
    /**
     * `0x454c97` — `ja` on the unsigned compare, so the −1 the tracker answers
     * for a player who is behind this one (`0x45f047`) falls out here. The turn
     * above has already happened; next frame the band will be a real one.
     */
    default:
      return false;
  }
}

/**
 * Band 3, `0x454ce1` — 320 to 410 out, and the only place the dog chooses.
 *
 * Everything else in {@link decide} reads the distance and acts. Here it looks
 * at which way *he* is facing first, and only if that decides nothing does it
 * sub-dispatch on `obj+0x44`, the tag of the stance script now playing —
 * kind 1's three tags being a small machine of their own.
 */
function close(
  e: Enemy,
  k: BrainCtx,
  t: ReturnType<BrainCtx["track"]>,
  done: boolean,
): boolean {
  /**
   * `0x454cea` — `cmp [player+0x28], [self+0x28]`, the two mirror flags against
   * each other. Equal means they face the same way, and since `0x454c54` has
   * already turned this one to face him, equal means **his back is to the dog**
   * — so it growls, raises `AI+4` and lunges from four hundred out.
   *
   * {@link BrainCtx.player.facing} is that mirror flag as a port facing, so the
   * test is asked as the executable asks it. Reading it out of `out+0` instead
   * would have lost the commonest case in a fight: `0x45f00c` answers 2 for a
   * player carrying no velocity, which says nothing about his mirror at all.
   */
  if (e.facing === k.player.facing) {
    e.decisions = 1;
    k.say(e, DOG.growl);
    return install(e, DOG.lunge, true);
  }
  /**
   * `0x454d1e` — in front of him and within 300 across, turn round, bay and
   * charge away.
   *
   * **This cannot fire.** `0x454d2b` measures `|obj+8 − player+8|`, the two X's,
   * and the band was measured on the same difference at `0x45efe4`; reaching
   * band 3 at all means it is at least 320. The branch is transcribed because
   * it is what `0x454be0` contains, not because a dog ever takes it.
   */
  if (t.side === 1 && Math.abs(k.anchorX(e) - k.player.x) < BREAK_OFF) {
    e.facing = -e.facing;
    k.say(e, DOG.bay);
    return install(e, DOG.charge);
  }
  // `0x454d70` — and otherwise, which of kind 1's three tags is playing
  switch (e.tag ?? 0) {
    /**
     * tag 0, `0x454d8f` — standing, on a beat of its own.
     *
     * `AI+2` comes down a frame at a time and when it goes under it rolls
     * `0x434540(5) + 6`, which is 7 to 11. **Eleven** — one roll in five — is
     * the bristle and the growl; the other four are the rear and the yip. So
     * the wind-up that can turn into an attack comes up a fifth of the time and
     * the rest is noise.
     */
    case 0: {
      const beat = e.beat ?? 0;
      e.beat = beat - 1;
      if (beat >= 0) return false;
      const next = k.roll(5) + 6;
      e.beat = next;
      // `0x454db5` — `jge 0xb`, and the roll tops out at 11, so it is that one
      if (next >= 0xb) {
        k.say(e, DOG.growl);
        return install(e, DOG.bristle);
      }
      k.say(e, DOG.yip);
      return install(e, DOG.rear);
    }
    // tag 1, `0x454e0b` — the rear ends and hands straight back to standing
    case 1:
      return done ? install(e, DOG.stand) : false;
    /**
     * tag 2, `0x454e2b` — the bristle, and the roll it ends on.
     *
     * `0x434540(0x1e)` is 1 to 30 and only 1 and 2 pass (`cmp eax, 3; jge`), so
     * two frames in thirty — and `0x454e45` refuses even those while `out+6` is
     * set, which is the player's current cel carrying a strike box. A dog will
     * not walk into a swing. When it does go, `0x434540(2) − 1` picks the tag:
     * 0 the lunge, 1 the snap.
     */
    case 2: {
      if (!done) return false;
      if (k.roll(0x1e) < 3 && !k.player.swinging) {
        const tag = k.roll(2) - 1;
        e.decisions = 1;
        k.say(e, DOG.growl);
        return install(e, tag === 0 ? DOG.lunge : DOG.snap, true);
      }
      return install(e, DOG.stand);
    }
    // `0x454d8a` — kind 1 has no other tag, and the fall-through is a return
    default:
      return false;
  }
}

export { NOT_HERE as DOG_NOT_HERE };
