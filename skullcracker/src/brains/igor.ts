/**
 * IGOR — `initigor`, think function `0x425230`, ten states.
 *
 * Chapter three's hunchback, and a different chapter from the street punk:
 * `0x425160` registers the class out of `0x424220`, the **RAVECAVE** loader,
 * which puts `ravecave.sbk` in the book slot `0x4a6220` the class message proc
 * files at `0x4251a0`. Its cels are the 3100s and they are nothing to do with
 * the 1900s `initwerea` draws out of `woods.sbk` — the same cel number is a
 * different creature one chapter over, so not one number below came from the
 * punk's book. Sounds come out of `0x4a5870`, which `0x41f301` loads from
 * `belfry.snd` (`0x4707b0`) once for the whole of chapter three.
 *
 * ## Its ten scripts, and therefore its ten states
 *
 * `0x45d090` copies word 4 of a script's header into `obj+0x18`, so the kinds of
 * the scripts this class installs ARE its alphabet. All ten were walked out of
 * the class's own data region, `0x46fe00`…`0x46ffd8`, and the jump table at
 * `0x425690` is `[0x4252f7, 0x425327, 0x4253cd, 0x42540a, 0x425441, 0x42545e,
 * 0x4254f9, 0x425516, 0x4255cd, 0x4255ea]`, one entry per kind, in order.
 *
 * ```
 *   0  0x46fe00  one cel, 3100: stand still until he walks into the rect
 *   1  0x46fe10  the same one cel — and the state that DECIDES
 *   2  0x46fe20  the walk in: 3100..3104, 55 a cel on the last four
 *   3  0x46fea0  the walk OUT: those five cels backwards, and travelling backwards
 *   4  0x46fe50  tag 0 and tag 1, the two jeers it answers the middle band with
 *   5  0x46ff98  tag 0 the held pose, tag 1 3140..3145 — the fall that kills it
 *   6  0x46fed0  3110 out to 3115 and home again: what the innermost band installs
 *   7  0x46ff30  tag 0 the throw, tag 1 the three cels after the thing has left
 *   8  0x46ff80  the flinch — tag 0 cel 3100, tag 1 cel 3140
 *   9  0x46ffd8  tag 0 the death, tag 1 the corpse
 * ```
 *
 * ## The shape of the machine, which is not the punk's
 *
 * There is no patrol. Kind 0 is one cel with no stride and its state does one
 * thing — `0x425304` puts the player's point through `0x434200` against the
 * record's rect and, when it is inside, installs kind 1 and nothing else. An
 * igor that has not been walked up to never moves.
 *
 * From there the whole class is **kind 1 and a jump table over the band**.
 * `0x425333` reads `out+4` and `0x425341` dispatches it through `0x4256b8` =
 * `[0x425348, 0x42535a, 0x42536c, 0x4253a9, 0x4253bb]`, five entries for the
 * four thresholds at `0x470018`, and every other on-its-feet state exists only
 * to hand back to kind 1 when its own script ends. So the five answers below
 * are the entire repertoire:
 *
 * ```
 *   band 0   past 350   walk in            kind 2
 *   band 1   300..350   throw              kind 7 tag 0
 *   band 2   150..300   screech and jeer   kind 4, tag 0 or 1
 *   band 3    80..150   walk back out      kind 3
 *   band 4   inside 80  the close answer   kind 6
 * ```
 *
 * Which is a coward's ladder and it is the reason the class reads oddly: the
 * band that closes is the FAR one and the band that opens the distance again is
 * 80 to 150, so an igor left alone oscillates in and out of its own third band
 * and throws at you from the far edge of the second. Nothing in `0x425230` asks
 * whether the player is down (`0x402f60` is never called), nothing asks which
 * shoulder it is standing on (`out+0`, the side, is read nowhere), nothing asks
 * whether he is mid-blow (`out+6`, likewise), and there is no crowding test and
 * no decision budget. It faces him, it measures him, it answers.
 *
 * ## What this module owns, and what it does not
 *
 * Seven of the ten — 0, 1, 2, 3, 4, 6 and 7 — are the ones it is in while it is
 * on its feet, and those are here. Kinds 8 and 9 are the hit reactions, driven
 * by `0x4256d0` (the hit handler, hung on `obj+0x12` at `0x4251ad`) and by the
 * page's own {@link Foe.flinch}/{@link Foe.death} path; a brain is never called
 * during them. Kind 5 is not a hit reaction at all but it is still not
 * behaviour — it is the drop that kills it — and it too ends in a removal. All
 * three are named at {@link NOT_HERE}.
 *
 * ## The preamble, which belongs to no state
 *
 * `0x42524a`…`0x4252e0` runs before the jump table and neither half of it is a
 * decision.
 *
 * The first half is the on-screen bar: while the player is inside the outermost
 * band (`[esp+0x14] >= 1`), in front (`[esp+0x1a] > 0`) and this one is neither
 * a statue (state 0) nor dying (state 9), `0x425288` calls
 * `0x40d1c0(AI+0, 0x40e300(0xc8), 0x3390, self.point)` — the nearest-claim on
 * the enemy panel, with plate 0x3390, and the same function `zomb.ts` documents
 * and does not port. It is the one place `AI+0` is read by the think function.
 *
 * The second half is the fall. `obj+0x32` is the engine's accumulated fall — a
 * sum of velocities since the apex, the same word {@link file://../walk.ts}
 * reads at `0x42a109` and {@link file://../props.ts} at `0x422401` — and
 * `0x425296` tests it against **200**. Past that, in any state but 5 or 0, the
 * igor is put on kind 5 tag 0 (`0x4252db`), given `AI+0x2c = [0x46b204] * 2`
 * frames and `belfry.snd` 0x0a, and state 5 then takes it away. A fall of two
 * hundred kills an igor outright. The kit hands a brain `e.vy` but not the fall
 * sum, so this is read and not done.
 */
import { install, type Brain, type Enemy } from "./kit";

/**
 * The three states a brain is never in, and what they do that the page's own
 * flinch and death path does not. Read, not done.
 *
 * - **5**, `0x42545e` — the fall death, and the only state with two tags that
 *   are not an animation and its tail. Tag 0 is cel 3100 held while `AI+0x2c`
 *   counts down at `0x425470`; `0x425480` keeps it there for as long as
 *   `obj+0x32` is still non-zero, so the igor stands stunned until it has
 *   stopped falling OR the count runs out, whichever comes first. Tag 1,
 *   `0x42549d`, plays 3140..3145, sounds `belfry.snd` 0x36, clears the panel
 *   with `0x40d1c0(0, 0, 0, ...)`, books 350 points through `0x40d450(0x15e)`,
 *   calls `0x4307c0(1)`, and returns **1** — one of the three `mov ax, 1` in the
 *   function and a frame on which the object is removed.
 * - **8**, `0x4255cd` — the flinch. `0x4257eb` installs `0x46ff80` with tag
 *   `0x434540(2) - 1`, so a struck igor shows either cel 3100 or cel 3140 for
 *   four engine frames, and the state does nothing but put it back in kind 1.
 *   The hit handler that chooses it, `0x4256d0`, takes the blow off **`AI+0`**
 *   and plays `belfry.snd` 8 or 4 on `0x434540(5) >= 3`; `AI+0` is this class's
 *   health, seeded `0x40e300(0xc8)` at `0x41ee98`, not a nerve.
 * - **9**, `0x4255ea` — the death and the corpse. `0x4257b5` installs tag 0 and
 *   seeds `AI+0x2c` from `[0x46b204]`, the same word {@link Enemy.linger}
 *   carries. `0x42561b` hands tag 0 to tag 1 when it ends and spawns one more
 *   object through `0x4208e0` — class `[0x46faa8]`, twelve pixels up
 *   (`0xfff4`), velocity `vx` ±30 and then ±10, the thing that comes off an
 *   igor as it dies. `0x4255f1` counts `AI+0x2c` down and on the frame it runs
 *   out calls `0x40cba0(self.point, -0xd, 0)` and returns 1.
 *
 * Note for whoever wires this up: {@link file://../foes.ts}'s `initigor` entry
 * reads `0x46ff30 tag 0` as the flinch and `0x46ff98 tag 1` as the death. Out of
 * `0x4256d0` the flinch is `0x46ff80` and the death is `0x46ffd8`; `0x46ff30 tag
 * 0` is the throw and `0x46ff98 tag 1` is the fall death. That file is not mine
 * to edit.
 */
const NOT_HERE = "0x42545e, 0x4255cd, 0x4255ea, 0x4256d0" as const;

/**
 * Its repertoire, by kind and tag, straight out of `0x46fe00`…`0x46ffd8`.
 *
 * Every cel, hold and stride below is the script's own header and frame list.
 * Two of the ten travel and they travel in opposite directions: kind 2 carries
 * 55 on its last four cels, and kind 3 carries −110, −55, −110, −55, −110 on
 * the same five cels run backwards. An igor retreats along its own footprints.
 *
 * `hold` is the header's `ticksPerFrame`, except that `0x46fea0`'s is **zero**.
 * `0x45d121` decrements `obj+0x48` and advances the frame whenever the result is
 * not greater than zero, so a zero and a one both mean one cel per engine
 * frame; it is written as 1 here because that is what it does.
 */
export const IGOR = {
  /** kind 0 — one cel, going nowhere, and the state that owns it never walks */
  wait: { cels: [3100], hold: 1, kind: 0, tag: 0, from: "0x46fe00 tag 0" },
  /** kind 1 — the same cel again, and the state that decides everything */
  stance: { cels: [3100], hold: 1, kind: 1, tag: 0, from: "0x46fe10 tag 0" },
  /** kind 2 — the walk in. The first record carries no stride, the other four 55 */
  approach: {
    cels: [3100, 3101, 3102, 3103, 3104],
    hold: 2,
    dx: [0, 55, 55, 55, 55],
    kind: 2,
    tag: 0,
    from: "0x46fe20 tag 0",
  },
  /**
   * kind 3 — the walk out: those five cels backwards, and the dx negative.
   *
   * Worth knowing before this is wired: {@link file://../walk.ts}'s stride block
   * is gated `step > 0`, so a negative `dx` spends nothing and this script
   * currently plays on the spot. The numbers here are the script's.
   */
  retreat: {
    cels: [3104, 3103, 3102, 3101, 3100],
    hold: 1,
    dx: [-110, -55, -110, -55, -110],
    kind: 3,
    tag: 0,
    from: "0x46fea0 tag 0 (ticksPerFrame 0)",
  },
  /** kind 4 — the two jeers, three engine frames a cel, neither of them travelling */
  jeer: [
    {
      cels: [3130, 3131, 3131, 3132, 3133],
      hold: 3,
      kind: 4,
      tag: 0,
      from: "0x46fe50 tag 0",
    },
    {
      cels: [3135, 3136, 3135, 3136],
      hold: 3,
      kind: 4,
      tag: 1,
      from: "0x46fe50 tag 1",
    },
  ] as const,
  /**
   * kind 6 — eleven cels out to 3115 and back, one engine frame apiece.
   *
   * `swipe` is this page's name for it, not the disc's: the executable says only
   * that `0x4253bb` is the one thing band 4 installs, that it travels nowhere,
   * and that `0x4254f9` hands it straight back to the stance. Whether its cels
   * carry a strike box is in `ravecave.sbk` and not in `SC.EXE`.
   * {@link file://../fights.ts} already carries it as this class's close attack.
   */
  swipe: {
    cels: [3110, 3111, 3112, 3113, 3114, 3115, 3114, 3113, 3112, 3111, 3110],
    hold: 1,
    kind: 6,
    tag: 0,
    from: "0x46fed0 tag 0",
  },
  /** kind 7 tag 0 — the throw, and 3121 is held three records of the six */
  hurl: {
    cels: [3120, 3121, 3121, 3121, 3122, 3123],
    hold: 2,
    kind: 7,
    tag: 0,
    from: "0x46ff30 tag 0",
  },
  /** kind 7 tag 1 — cel 3124 three times: the arm still out, the thing gone */
  recover: {
    cels: [3124, 3124, 3124],
    hold: 2,
    kind: 7,
    tag: 1,
    from: "0x46ff30 tag 1",
  },
  /** `0x470018`, the fourth argument `0x41eea9` hands `0x45ef70` — four deep */
  bands: [350, 300, 150, 80],
  /**
   * `belfry.snd` — the bank is `0x4a5870`, loaded from `0x4707b0` at `0x41f301`
   * for the whole of chapter three, not the punk chapter's `0x4a7910`.
   *
   * `jeers` is `0x425377`'s `0x434540(2) + 5`, so one of two as it starts the
   * middle band's jeer; `cry` is `0x42558b`'s flat 9, played on the frame the
   * thrown thing leaves it. The rest of the class's ids belong to states this
   * module does not own and are listed at {@link NOT_HERE}.
   */
  jeers: [6, 7],
  cry: 9,
  from: "0x425230",
} as const;

/**
 * What it throws, which a brain cannot spawn and so is written down instead.
 *
 * `0x4255a6` calls `0x421310(point, velocity, 1)`. That makes an object in the
 * class at `[0x46ecd0]` — the one `0x4256f8` also checks the igor's own
 * immunity against, so an igor cannot be hurt by one of these — and the third
 * argument picks the flavour out of the table at `0x421454`: index **1** is
 * `0x4213a2`, cel base `0xc58` = 3160 on script `0x46f978` tag 2, cels
 * 3160..3163.
 *
 * `0x425544`…`0x425582` build the two points out of `obj+0x28`: it is born
 * **70 pixels in front** (`0x8c - 0x46`, so +70 facing east and −70 facing
 * west) and **20 above** (`obj+6 - 0x14`), with velocity `vy = -26` (`0xffe6`)
 * and `vx = ±35` (`0x46 - 0x23`). Nothing in this port hits the player back, so
 * it is carried as read.
 */
const THROWN = "0x4255a6 / 0x421310 index 1 / 0x46f978 tag 2" as const;

/**
 * `initigor`'s own machine, states 0, 1, 2, 3, 4, 6 and 7.
 *
 * ## The stack frame, which is where the field numbers come from
 *
 * `0x425230` does `sub esp, 0x14` and takes the output pointer with
 * `lea eax, [esp + 8]` **before** any register is pushed, so the twelve bytes
 * `0x45efd0` actually writes sit at the frame's own `+8` and the three pushes
 * that follow (`esi`, `edi`, `eax`) move the reading, not the buffer. Two of
 * those three are the call's own arguments and `0x425247` pops them, leaving the
 * stack two registers deep for every test below: **`esp+0x10` is `out+0` the
 * side, `esp+0x14` is `out+4` the BAND, `esp+0x16` is `out+6` the player's
 * strike box, `esp+0x18` is `out+8` the drop and `esp+0x1a` is `out+0xa` the
 * forward distance.**
 *
 * What pins it is the argument slots. `0x425258` reads the object from
 * `[esp+0x20]` and `0x42523a` read the AI struct from `[esp+0x28]` three pushes
 * earlier — the same word — so `esp+0x20` is argument one and `esp+0x24` is
 * argument two, the frame is 0x14 deep with two registers on top of it, and the
 * buffer can only be at `esp+0x10`. Read four bytes low and `0x425333`'s band
 * dispatch would be a dispatch on the side, which has three values and not
 * five, and it would still compile.
 *
 * ## Its AI struct, which is not the punk's
 *
 * `0x41ee40` mallocs `0x2e` bytes and lays them out its own way:
 *
 * - `AI+0` — **health**, not a nerve. `0x41ee98` seeds it `0x40e300(0xc8)`,
 *   `0x42574c` takes the blow off it and `0x42577b` reads it to decide between
 *   the flinch and the death. The think function reads it once, for the panel.
 *   {@link Enemy.hp} is the field that corresponds and the page already owns it.
 * - `AI+2`..`AI+9` — the record's rect, the creator's two point arguments
 *   written straight in at `0x41eeb1`/`0x41eeb3`, which is what `0x4252f7` adds
 *   two to and hands to `0x434200`. That is {@link Enemy.fighting}'s test and
 *   the page already makes it.
 * - `AI+0xa` — the tracker's own input, `0x41eeae` adding ten before registering
 *   it with `0x45ef70(input, self, player, 0x470018)`.
 * - `AI+0x2c` — a countdown, and the only loose word in the struct. The fall
 *   death seeds it `[0x46b204] * 2` and the death seeds it `[0x46b204]`; both
 *   spend it in states this module does not own.
 *
 * There is **no** nerve, no beat, no decision budget, no wanted side and no home
 * point in it, so {@link Enemy.nerve}, {@link Enemy.beat},
 * {@link Enemy.decisions}, {@link Enemy.side} and {@link Enemy.home} are left
 * alone: this class has nothing to put in them.
 *
 * ## A think function never suppresses the animation
 *
 * Every path in `0x425230` ends at `0x425681`, `xor ax, ax` — the "my script has
 * not finished" returns included — and `0x425685` then writes 100 into
 * `obj+0x1a`, this class's strength, on every one of them without exception.
 * The three `mov ax, 1` are `0x4254ec`, `0x42560e` and the handler's own, and
 * all three are frames on which the object is removed. So every path below
 * returns `false`, waiting included; returning `true` would freeze the thing
 * mid-throw with its stride unspent. Nothing hits the player back in this port,
 * so the 100 is carried as read and spends nothing.
 */
export const igor: Brain = (e, foe, run, k) => {
  const done = e.clock >= run;
  const t = k.track(e, IGOR.bands);
  switch (e.script ?? 0) {
    /**
     * ---- 0, `0x4252f7`: the statue, and the one thing that ends it.
     *
     * `0x434200(player.point, AI+2)` — his point inside the four words the
     * creator copied out of this `init` record, which is exactly the test the
     * page makes for {@link Enemy.fighting}. There is no walk here and no
     * territory clamp: kind 0 is one cel with no stride, so an igor stands where
     * the level put it until somebody comes into its rect.
     */
    case 0:
      return e.fighting ? install(e, IGOR.stance) : false;
    /**
     * ---- 1, `0x425327`: the stance, and the whole of the class.
     *
     * It does not wait for its own script — kind 1 is one cel at one engine
     * frame and `0x425327` has no `obj+0x46` test — so this runs every frame.
     * Face him, then answer the band and nothing else.
     */
    case 1: {
      // `0x42532d` — and this one does NOT return: it turns and carries on
      if (t.forward < 0) e.facing = -e.facing;
      switch (t.band) {
        // `0x425348` — past 350: walk in, and kind 2's own state ends the walk
        case 0:
          return install(e, IGOR.approach);
        // `0x42535a` — 300..350 is where it throws, the far edge and not the near
        case 1:
          return install(e, IGOR.hurl, true);
        /**
         * `0x42536c` — 150..300: it screeches and jeers, and both halves are a
         * separate `0x434540(2)`. The sound is `+5` on the roll, so 6 or 7; the
         * tag is `-1` on a fresh roll, so kind 4's tag 0 or tag 1.
         */
        case 2:
          k.say(e, IGOR.jeers[k.roll(2) - 1]);
          return install(e, IGOR.jeer[k.roll(2) - 1]);
        // `0x4253a9` — 80..150 and it backs off. This is the band that retreats
        case 3:
          return install(e, IGOR.retreat);
        // `0x4253bb` — inside 80, the one close answer the class has
        case 4:
          return install(e, IGOR.swipe, true);
        /**
         * `0x42533b` is `cmp eax, 4; ja` on a sign-extended word, so a band of
         * −1 — the player behind it — runs off the end of the table and takes
         * the bare return. The turn above has already happened, so the next
         * frame has him in front.
         */
        default:
          return false;
      }
    }
    /**
     * ---- 2, `0x4253cd`: the walk in, and the edge of its own patch ends it.
     *
     * `0x4253ce` is `0x427170`, which is `0x456550` byte for byte — within 60 of
     * `obj+0x38` facing west or `obj+0x3a` facing east, the bound it is walking
     * towards. This is tested BEFORE the script-finished flag, so reaching the
     * end of its ground aborts the walk mid-stride and turns it into a retreat.
     */
    case 2:
      if (k.atBound(e)) return install(e, IGOR.retreat);
      return done ? install(e, IGOR.stance) : false;
    /**
     * ---- 3, `0x42540a`: the retreat, and it repeats until he is far enough.
     *
     * `0x42540a` is `cmp word ptr [esp+0x14], 1; jg` — the BAND, not the side.
     * Band 1 or less means he is past 300 away (or behind, which is −1), and
     * that stops the backing off at once, without waiting for the script. Band 2
     * or worse and it backs off again the moment this one ends, so the igor
     * keeps walking out of the fight until the distance is made.
     */
    case 3:
      if (t.band <= 1) return install(e, IGOR.stance);
      return done ? install(e, IGOR.retreat) : false;
    // ---- 4, `0x425441`: the jeer plays out and hands back. That is all it does
    case 4:
      return done ? install(e, IGOR.stance) : false;
    // ---- 6, `0x4254f9`: and so does the close answer
    case 6:
      return done ? install(e, IGOR.stance) : false;
    /**
     * ---- 7, `0x425516`: the throw, in two tags.
     *
     * Tag 0 ends by installing tag 1 (`0x42553f`), crying `belfry.snd` 9
     * (`0x42558d`) and letting the thing go — see {@link THROWN}, which is where
     * the object it spawns and the point and velocity it spawns it with are
     * written down, since a brain has nothing to spawn with. Tag 1 then hands
     * back to the stance like everything else.
     */
    case 7:
      if (!done) return false;
      if ((e.tag ?? 0) === 0) {
        k.say(e, IGOR.cry);
        return install(e, IGOR.recover);
      }
      return install(e, IGOR.stance);
    /**
     * 5, 8 and 9 are {@link NOT_HERE} — the fall death, the flinch and the
     * death. The page drives those and a brain is not called during them.
     */
    default:
      return false;
  }
};

export { NOT_HERE as IGOR_NOT_HERE, THROWN as IGOR_THROWN };
