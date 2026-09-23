/**
 * The one with the bat — `initbatboy`, think function `0x439240`, and the
 * second of MALL's gang of four.
 *
 * ## Its ten states, and the scripts they are
 *
 * `0x45d090` copies word 4 of a script's header into `obj+0x18`, so a class's
 * scripts ARE its alphabet. `0x439332` reads that word, **decrements it**, and
 * jumps through the ten-entry table at `0x439910`: the states are numbered
 * **1 to 10**, not 0 to 9, and there is no state 0 at all. The nine scripts sit
 * in one run of data from `0x474330` to the band list at `0x474558`:
 *
 * ```
 *   1  0x474330  one cel, 1901 — the stand it is BORN in, and the whole patrol
 *   2  0x474368  the read: tags 0/1 decide, tag 2 covers, tag 5 backs off
 *   3  ——        no script, and `0x439910[2]` points straight at the return
 *   4  0x474438  tags 0/1 the poise, tag 4 the RUN, tag 5 a step back
 *   5  0x474488  the bat: tags 0/1 wind up, tags 2/3 are the swing held
 *   6  0x4743b8  the lever job — tag 0 walks to it, tag 1 is the reach
 *   7  0x4744c0  the leap: tag 0 crouch and launch, tag 1 flight, tag 2 landing
 *   8  0x474340  what it does over a DOWNED player
 *   9  0x474528  the death
 *  10  0x474508  the flinch
 * ```
 *
 * ## What this module owns, and what it does not
 *
 * States 1, 2, 4, 5, 7 and 8 are the ones a batboy is in while it is on its
 * feet, and those are here. Three are deliberately elsewhere:
 *
 * - **9 and 10** are the hit reactions. `0x439b03` installs the death and
 *   `0x439b44` the flinch, both out of the hit handler `0x439980`, and the page
 *   already drives them through {@link Foe.death} and {@link Foe.flinch}. A
 *   brain is never called while an enemy is flinching or dying. See
 *   {@link NOT_HERE}.
 * - **6 is the lever**, and `stepFight` gets there first — `if (foe.lever &&
 *   leverFor(e, foe.lever.dir)) return false` runs before the brain is asked, so
 *   a keeper with a switch left in its patch never reaches this switch statement
 *   at all. See {@link THE_LEVER} for the whole of what state 6 does, including
 *   the one piece of it that is not lever work.
 *
 * ## The AI struct is NOT the punk's
 *
 * `0x436320`, the creator, mallocs **0x38 bytes** and lays them out its own way.
 * Nothing here maps onto `AI+0` nerve / `AI+2` beat / `AI+4` decisions:
 *
 * | slot | what `0x436320` puts there | here |
 * |------|---------------------------|------|
 * | `AI+0`    | `0x40e300(0x19)` — **health**, 25 scaled by difficulty (`0x43637e`) | {@link Enemy.hp}, already {@link Foe.panel}'s 25 |
 * | `AI+2`    | zero (`0x43639f`) — the **blocked counter**, see below | not carried |
 * | `AI+4`    | zero (`0x43638f`) — the **lever** `0x438200` finds | the page's `leverFor` |
 * | `AI+8`    | `[0x4ac3d4]`, the player object (`0x436374`) | {@link BrainCtx.player} |
 * | `AI+0xc`  | the record's **rect**, two dwords out of args 2 and 3 (`0x436397`) | `e.left`/`e.right`/`e.top`/`e.bottom`, and {@link Enemy.fighting} is `0x434200` against it |
 * | `AI+0x14` | the tracker input `0x45ef70` fills (`0x4363ad`) | {@link BrainCtx.track} |
 * | `AI+0x36` | zero (`0x4363a3`) — the corpse's linger, `[0x46b204]` at `0x439b30` | {@link Enemy.linger} |
 *
 * So the punk's `AI+8` rect is this class's `AI+0xc`, and this class's `AI+8` is
 * a player pointer. Reading it the punk's way gives a rect test against half a
 * pointer and still compiles.
 *
 * ## The stack frame, and how it was pinned
 *
 * `0x439240` does `sub esp, 0x10`, takes `lea eax, [esp]` for the sixteen-byte
 * buffer, then pushes **esi, edi and eax** before pushing the tracker input and
 * calling `0x45efd0`; `0x439257` drops eight. Net, the buffer is at
 * **`esp+8`** for the whole body — four bytes LOWER than the punk's `esp+0xc`,
 * because the punk's `lea` comes after two of its pushes and this one's comes
 * after none.
 *
 * `0x43924a` reads the AI struct from `[esp+0x24]` while three words are on the
 * stack above the buffer, and `0x439268` reads the object from `[esp+0x1c]`
 * once the call has been cleaned up. Those two are the argument slots, four and
 * eight bytes past the return address, and they pin the frame exactly:
 *
 * ```
 *   [esp+0x08]  out+0x00  side   (a DWORD — `0x45f00c` writes all four bytes)
 *   [esp+0x0c]  out+0x04  band
 *   [esp+0x0e]  out+0x06  the player's cel carries a strike box
 *   [esp+0x10]  out+0x08  player.y - self.y   — this class never reads it
 *   [esp+0x12]  out+0x0a  forward distance
 *   [esp+0x1c]  the object
 *   [esp+0x20]  the AI struct
 * ```
 *
 * Read four low and `cmp word ptr [esp+0xc], 3` — a BAND test, and the one that
 * makes it back off — reads as a side test that can never be 3.
 *
 * ## Two engine words the mover writes
 *
 * Both are written by the mover, not by this class, and both change what this
 * machine does.
 *
 * - **`obj+0x2c`** — set to 1 at `0x430181` when the object's own anchor is
 *   inside one of the level's obstacle rects. States 2 and 4 both open on it
 *   (`0x439394`, `0x439465`): four frames running with it set and `AI+2` spills
 *   over 3, which installs the LEAP. This page does not run foes through the
 *   obstacle solver (see `wered.ts` on the same flag), so the counter never
 *   advances and **state 7 is unreachable from inside this module**. The leap's
 *   own chain is implemented anyway, for whoever wires the solver up.
 * - **`obj+0xc`** — the sideways speed. `0x42f8b0` adds each frame's stride
 *   over the divisor into it and the ground takes `obj+0x1e` of it back, and
 *   the class sets that to 0.05 (`0x4391a4`), so a run of six cels leaves the
 *   batboy skating at forty-odd a frame and coasting for a dozen frames after.
 *   The page keeps a walker's speed in {@link Enemy.speed}, measured along its
 *   facing, and {@link ahead} reads the pair back as the engine's one word.
 *
 * ## The two things in `0x439240` that are bookkeeping, not behaviour
 *
 * - `0x439286` claims the on-screen enemy bar — `0x40d1c0(AI+0, 0x332d,
 *   0x40e300(0x19), obj.y)` — whenever the band is 1 or better AND the forward
 *   distance is positive. It is the panel, not a decision, and the page draws it
 *   from {@link Foe.panel}.
 * - `0x439902` writes `obj+0x1a = 0x64` on every path that is not the corpse's.
 *   That is the strength percent its blows are scaled by, and 100 is what
 *   {@link Enemy.strength} reads when nothing sets it.
 */
import {
  install,
  rewind,
  type Brain,
  type BrainCtx,
  type Enemy,
  type Reaction,
  TICK_SCALE,
} from "./kit";

/**
 * The hit reactions, 9 and 10, and the one thing each does that the page's own
 * flinch path does not. Read, not done — the page owns those animations.
 *
 * - **10**, the flinch (`0x474508`, one cel 1920 per tag): `0x4398e7` is two
 *   instructions long. It waits on `obj+0x2e` — back on the ground — and then
 *   installs the RUN, `0x474438` tag 4, not a stance. So a batboy knocked into
 *   the air comes down already charging, and it is the landing rather than the
 *   animation ending that releases it.
 * - **9**, the death (`0x474528`, cels 1920..1924): `0x439837` sets
 *   `obj+0x10 = -20` — the floor offset, so the corpse floats twenty pixels off
 *   whatever it fell on — counts `AI+0x36` down from the `[0x46b204]` the hit
 *   handler seeded at `0x439b30`, and is the **only** path in the whole function
 *   that answers `mov ax, 1`: `0x439890` and `0x4398da` remove the object.
 *   Everything else, the "my script has not finished" return included, answers
 *   zero.
 *
 * Also in the handler and not in any state: `0x439a4a` asks whether the thing
 * that hit it belongs to the goop class `[0x472560]` and if so **adds 60** to
 * `AI+0`, clamps to `0x40e300(0x19)`, plays 3 and returns without spraying. MALL
 * places no goop.
 */
const NOT_HERE = "0x4398e7, 0x439837, 0x439980, 0x439a4a" as const;

/**
 * State 6, `0x439647` — the lever job, which the page already owns.
 *
 * It is worth writing down in full because it is not only lever work, and
 * because what starts it is not in state 6 at all.
 *
 * **What starts it.** `0x4392a4`, in the preamble, runs on every frame the
 * state is 2 or 4. It calls `0x438200(AI+0xc, AI+0x10)` — walk the prop list
 * `[0x472570]`, take the first whose point is inside this record's own rect and
 * whose `obj+0x44` is tag **3**, the unlit switch — stores it at `AI+4`, turns
 * to face it by comparing `prop+8` against `obj+8`, plays `0x40f090(mall.snd,
 * 0xb)` and installs `0x4743b8` tag 0. So a batboy in the read or the run drops
 * whatever it was doing the moment a switch is available.
 *
 * **Tag 0, `0x43965d`** — the same six cels as the run. Every frame it re-aims
 * itself at `AI+4` (`0x4396a4`), and when it is within **0x25 = 37** pixels in x
 * it stops dead (`obj+0xc = 0`) and branches on the PLAYER: `|forward| < 0x64`
 * and it attacks him instead, `0x474488` tag `rand(2)-1`; otherwise it starts
 * the reach. Further out than 37 it just keeps walking on script end.
 *
 * **Tag 1, `0x43970d`** — nine cels, and `obj+0x42`, the absolute frame index,
 * is watched for **0xb**: frame 11 of the script is frame 5 of this tag, cel
 * 1921, and that is where `0x436820(AI+4->point, 0)` throws the switch. Zero is
 * the ON direction. One time in three (`0x43972f`) it also plays mall.snd
 * `rand(2)+5`. The animation then finishes and it goes back to the run.
 *
 * All of it is already {@link Foe.lever} — `dir: 0`, `at: 5`, `reachPx: 37`,
 * `sound: [5, 6]` and `0x4743b8 tag 1` as its animation — and `stepFight`
 * short-circuits the brain entirely while a switch is left in the patch. Two
 * owners for one animation is the thing this split is for, so state 6 is not
 * implemented here.
 */
const THE_LEVER = "0x4392a4, 0x438200, 0x43965d, 0x43970d, 0x436820" as const;

/**
 * Its repertoire, by kind and tag, straight out of `0x474330`…`0x474528`.
 *
 * Every cel, hold, stride and lift is the script's own; the header's
 * `ticksPerFrame` is `hold`, and only `0x474488` runs at two. Nothing in the
 * class carries a `dy` but the leap.
 */
export const BATBOY = {
  /**
   * kind 1 — one cel and nothing else, and the state the class is BORN in.
   *
   * `0x43919f` stamps the build's own base cel `0x794` (1940) on the object and
   * `0x4391d5`, four instructions later, installs this script straight over it.
   * So what a level places stands on **1901** holding one frame until the
   * player's point is inside its rect — which is exactly {@link Foe.wake}, cel
   * 1901, cited there as `0x439365 / 0x43937b`.
   */
  dormant: { cels: [1901], hold: 1, kind: 1, tag: 0, from: "0x474330 tag 0" },
  /** kind 2 tag 0 — one cel, and the state that DECIDES */
  read: { cels: [1901], hold: 1, kind: 2, tag: 0, from: "0x474368 tag 0" },
  /** kind 2 tag 1 — the other one cel it decides from, and the same branch */
  read2: { cels: [1904], hold: 1, kind: 2, tag: 1, from: "0x474368 tag 1" },
  /** kind 2 tag 2 — three frames of 1903 going nowhere: what it does mid-blow */
  cover: {
    cels: [1903, 1903, 1903],
    hold: 1,
    kind: 2,
    tag: 2,
    from: "0x474368 tag 2",
  },
  /** kind 2 tag 5 — out of the innermost band, walking backwards */
  away: {
    cels: [1903, 1903, 1902, 1901],
    hold: 1,
    dx: [0, -70, -80, -70],
    kind: 2,
    tag: 5,
    from: "0x474368 tag 5",
  },
  /** kind 4 tag 0 — one cel, the poise the run hands to inside 400..150 */
  poise: { cels: [1905], hold: 1, kind: 4, tag: 0, from: "0x474438 tag 0" },
  /** kind 4 tag 1 — the other poise, and the same handler */
  poise2: { cels: [1900], hold: 1, kind: 4, tag: 1, from: "0x474438 tag 1" },
  /** kind 4 tag 4 — the RUN, and {@link Foe.gait}: six cels, four of them travel */
  run: {
    cels: [1900, 1901, 1902, 1903, 1904, 1905],
    hold: 1,
    dx: [0, 60, 70, 80, 120, 0],
    kind: 4,
    tag: 4,
    from: "0x474438 tag 4",
  },
  /** kind 4 tag 5 — one cel with forty pixels of backward stride on it */
  back: {
    cels: [1904],
    hold: 1,
    dx: [-40],
    kind: 4,
    tag: 5,
    from: "0x474438 tag 5",
  },
  /** kind 5 tag 0 — the low wind-up, two engine frames a cel */
  swingLo: {
    cels: [1910, 1911],
    hold: 2,
    dx: [60, 0],
    kind: 5,
    tag: 0,
    from: "0x474488 tag 0",
  },
  /** kind 5 tag 1 — the high wind-up */
  swingHi: {
    cels: [1913, 1914],
    hold: 2,
    dx: [60, 0],
    kind: 5,
    tag: 1,
    from: "0x474488 tag 1",
  },
  /** kind 5 tag 2 — the low swing held. `0x439617` is the `tag + 2` that gets here */
  strikeLo: { cels: [1912], hold: 2, kind: 5, tag: 2, from: "0x474488 tag 2" },
  /** kind 5 tag 3 — the high swing held */
  strikeHi: { cels: [1915], hold: 2, kind: 5, tag: 3, from: "0x474488 tag 3" },
  /** kind 7 tag 0 — three cels of crouch and then 325 of lift with 80 of travel */
  crouch: {
    cels: [1900, 1905, 1905, 1904],
    hold: 1,
    dx: [-10, -50, -50, 80],
    dy: [0, 0, 0, -325],
    kind: 7,
    tag: 0,
    from: "0x4744c0 tag 0",
  },
  /** kind 7 tag 1 — the flight, one cel and the arc over it */
  fly: {
    cels: [1905, 1905, 1905],
    hold: 1,
    dx: [40, 80, 40],
    dy: [-5, 10, 10],
    kind: 7,
    tag: 1,
    from: "0x4744c0 tag 1",
  },
  /** kind 7 tag 2 — the landing */
  land: { cels: [1910], hold: 1, kind: 7, tag: 2, from: "0x4744c0 tag 2" },
  /** kind 8 tag 0 — three cels over a downed player, going nowhere */
  gloat: {
    cels: [1920, 1921, 1922],
    hold: 1,
    kind: 8,
    tag: 0,
    from: "0x474340 tag 0",
  },
  /** kind 8 tag 1 — and the one cel it drops to one time in ten */
  gloat2: { cels: [1921], hold: 1, kind: 8, tag: 1, from: "0x474340 tag 1" },
  /**
   * `0x474558` — the descending list `0x45ef70` copies into the tracker input,
   * stopping at the first word that is not positive (`0x45ef9f`). Three of them,
   * so `band` runs −1 (behind) and 0 (beyond 400) to 3 (inside 85).
   */
  bands: [400, 150, 85],
  /** `0x43937b` — `mall.snd` 0x0b, the squeal the frame it wakes (`FOE_SFX.batboyWake`) */
  squeal: 0x0b,
  /** `0x43960b` — `mall.snd` 0x0d, played as the wind-up turns into the swing */
  strike: 0x0d,
  from: "0x439240",
} as const;

/**
 * `obj+0xc`, the one sideways word, measured along the facing: positive is the
 * way the mirror flag points and negative is sliding backwards.
 *
 * The page splits it in two — {@link Enemy.speed}, a walker's own, already in
 * engine pixels a frame and along the facing, and {@link Enemy.vx}, a thrown
 * thing's, in pixels a tick and absolute — and only one of them is ever
 * non-zero, so the sum is the engine's word.
 */
export function ahead(e: Enemy): number {
  return (e.speed ?? 0) + (e.vx / TICK_SCALE) * e.facing;
}

/**
 * `xor byte ptr [esi+0x28], 1` — the mirror flips and `obj+0xc` does not.
 *
 * The engine's velocity is absolute, so a batboy that turns round mid-coast
 * is sliding backwards until the drag or a push-off says otherwise, and that
 * is exactly what the "speed pointing the wrong way" tests read. The page's
 * walker speed is measured along the facing, so it changes sign with it.
 */
export function turn(e: Enemy): void {
  e.facing = -e.facing;
  e.speed = -(e.speed ?? 0);
}

/**
 * The corpse stops where it falls. Every one of the gang's hit handlers puts
 * `obj+0x1e` back to 1.0 on the killing blow (`0x439aea`, `0x43907f`,
 * `0x4383ca`, `0x43a6ea`) — full friction against the 0.05 it lived on — so
 * the first frame on the ground takes the whole of the slide.
 *
 * ...and it lies lower. The death is state 9, and its tag-0 handler writes
 * `obj+0x10 = -20` on every frame it runs (`0x439849` here, `0x438dc7` mask,
 * `0x4380cb` knot, `0x43a31a` knife) over the −6 the class init gave it.
 */
export const gangCorpse: Reaction = (e) => {
  if (e.state !== "dead") return;
  e.floor = -20;
  if (e.vy === 0) e.vx = 0;
};

/** `0x4394d9` — still sliding this fast and the poise does not restart the run */
const COASTING = 0x14;
/** `0x4395f7` — and the wind-up waits until it is under this before it swings */
const PLANTED = 0x0a;

/**
 * `initbatboy`'s own machine, states 1, 2, 4, 5, 7 and 8.
 *
 * **Every path returns `false`.** Every return in `0x439240` is `xor ax, ax` —
 * `0x4398fe`, which is where the "my script has not finished" branches land —
 * bar the two at `0x439890` and `0x4398da`, which are the frame the corpse is
 * removed and belong to state 9. A think function never suppresses the
 * animation; returning `true` from a waiting state freezes the thing
 * mid-animation with its stride unspent.
 */
export const batboy: Brain = (e, foe, run, k) => {
  const done = e.clock >= run;
  const t = k.track(e, BATBOY.bands);
  /**
   * This class has no kind 0 — `0x439336` decrements before it indexes, so zero
   * falls through `ja` to the return, and nothing ever installs one. The thing
   * it was born in is kind 1 (`0x4391cf`), and a page-spawned one that has not
   * been installed into anything yet carries no kind at all, so both read as 1.
   */
  let now = e.script ? e.script : 1;
  /**
   * `0x4392f6`, the preamble, and it runs before the dispatch rather than inside
   * a state.
   *
   * The frame `0x402f60` says the player is no longer upright, anything that is
   * not already gloating, still dormant, or dead is put on `0x474340` tag 0 and
   * turned to face him. `0x439332` then re-reads `obj+0x18`, so the state-8
   * handler runs on the very same frame — on a freshly rewound script, which is
   * why it does nothing that frame.
   */
  if (k.player.down && now !== 1 && now !== 8 && now !== 9) {
    install(e, BATBOY.gloat);
    // `0x439326` — and only then, and only if he is behind it
    if (t.forward < 0) turn(e);
    now = 8;
  }
  switch (now) {
    /**
     * ---- 1, `0x439347`: the stand, and the one thing that ends it.
     *
     * It kills both velocities every frame — `obj+0xa` and `obj+0xc` at
     * `0x43934c`/`0x439351` — and then asks `0x434200(player.point, AI+0xc)`,
     * the player's own point inside the four words the creator copied out of the
     * level record. Not a sight line, not a radius, and not the room. That test
     * is {@link Enemy.fighting} here, and `stepFight` runs it.
     *
     * The page reaches the same place from the other side: {@link Foe.wake} is
     * this script's single cel, and while `e.asleep` is set `stepFight` returns
     * before the brain is asked at all. So a level's batboy holds 1901 under the
     * page's wake rule and holds it again here if it ever breaks off.
     *
     * `0x43937b` squeals as it leaves, and the page has already played that
     * squeal on the frame it woke ({@link Foe.wake}'s sound), so it is not
     * said twice here.
     */
    case 1: {
      e.vx = 0;
      e.vy = 0;
      e.speed = 0;
      if (!e.fighting) return false;
      // `0x4398ee` — straight into the run
      return install(e, BATBOY.run);
    }
    /**
     * ---- 2, `0x439388`: the read — one cel, and the state that chooses.
     *
     * Two things happen before the tag is looked at. `0x439388` turns it round
     * if the player is behind — and does NOT return, so the rest of the frame
     * runs on a tracker reading that was taken before the turn, exactly as the
     * engine does. Then `0x439394` counts `AI+2` while `obj+0x2c` is set and
     * spills into the leap at four; neither the flag nor the counter exists on
     * this page, so that branch is named and not written.
     */
    case 2: {
      if (t.forward < 0) turn(e);
      switch (e.tag ?? 0) {
        /**
         * `0x4393db` — tags 0 and 1 are the same branch, and it is pure band.
         *
         * Inside 85 it backs off; anywhere between 85 and beyond 400 it runs in;
         * and BEHIND it — band −1, which the turn above will fix next frame —
         * it only does anything at all if the player is mid-blow, in which case
         * it covers.
         */
        case 0:
        case 1: {
          if (t.band === 3) return install(e, BATBOY.away, true);
          if (t.band === 0 || t.band === 1 || t.band === 2)
            return install(e, BATBOY.run);
          // `0x439413` — `out+6`, the player's own cel carrying a strike box
          if (!k.player.swinging) return false;
          return install(e, BATBOY.cover);
        }
        /**
         * `0x43942b` — and the cover breaks the moment he swings AGAIN.
         *
         * It is the other way round from how it reads: a player who has stopped
         * swinging leaves it covering, and a second blow is what flips it back
         * to one of the two deciding cels on a coin.
         */
        case 2: {
          if (!k.player.swinging) return false;
          return install(
            e,
            k.roll(2) - 1 === 0 ? BATBOY.read : BATBOY.read2,
            true,
          );
        }
        // `0x43944e` — the back-off plays out and hands to the decision
        case 5:
          return done ? install(e, BATBOY.read) : false;
        default:
          return false;
      }
    }
    /**
     * ---- 4, `0x439465`: the run, the poise it lands in, and the step back.
     *
     * Same opening as state 2 — `obj+0x2c` and `AI+2` spilling into the leap at
     * four blocked frames, which this page cannot reach.
     */
    case 4: {
      switch (e.tag ?? 0) {
        /**
         * `0x4394ac` — tags 0 and 1, the two one-cel poises, and the whole
         * branch is about MOMENTUM.
         *
         * Speed pointing the wrong way for the mirror flag, or under twenty of
         * it, and the run starts again; still coasting hard and it acts —
         * backwards if the player got behind it, and into the bat if he is in
         * band 1. What it is coasting on is the run's own speed, which the
         * class's 0.05 friction leaves under it for a dozen frames.
         */
        case 0:
        case 1: {
          const speed = ahead(e);
          if (speed < 0) return install(e, BATBOY.run);
          if (Math.abs(speed) < COASTING) return install(e, BATBOY.run);
          // `0x4394e2` — he is behind it, so it gives ground instead
          if (t.forward < 0) return install(e, BATBOY.back);
          // `0x4394f1` — and only band 1, 150 to 400, swings from a standstill
          if (t.band !== 1) return false;
          return install(
            e,
            k.roll(2) - 1 === 0 ? BATBOY.swingLo : BATBOY.swingHi,
            true,
          );
        }
        /**
         * `0x439514` — the run, and it decides when the six cels are up.
         *
         * `0x43951f` looks like a third branch and is not one: behind him
         * (`out+0 == 0`) or beyond four hundred, it installs `0x474438` tag 4 at
         * `0x439536` — and then **falls through** to `0x43953e`, where both arms
         * install something else on top. The tag-4 store is dead in every path.
         * What survives is the band: 1 drops it into a poise, anything else
         * swings the bat.
         */
        case 4: {
          if (!done) return false;
          if (t.band === 1)
            return install(
              e,
              k.roll(2) - 1 === 0 ? BATBOY.poise : BATBOY.poise2,
            );
          return install(
            e,
            k.roll(2) - 1 === 0 ? BATBOY.swingLo : BATBOY.swingHi,
            true,
          );
        }
        /**
         * `0x43956d` — the step back repeats itself until the slide is over.
         *
         * `obj+0x30` is the mover's at-rest word: `0x43031c` sets it when both
         * velocities are zero and `0x430314` clears it while either is not. That
         * or a speed pointing against the facing ends the retreat, turns it to
         * face him and hands to the read; otherwise it plays the one cel again
         * each time it ends.
         */
        case 5: {
          const speed = ahead(e);
          const rest = speed === 0 && e.vy === 0;
          if (!rest && speed >= 0) return done ? rewind(e, BATBOY.back) : false;
          if (t.forward < 0) turn(e);
          return install(e, BATBOY.read);
        }
        default:
          return false;
      }
    }
    /**
     * ---- 5, `0x4395ba`: the bat, in two halves.
     *
     * `0x4395bf` comes first and overrides the tag entirely: the frame the
     * player goes down mid-swing it abandons the blow and steps back. (The
     * preamble's gloat cannot take this state — it only skips 1, 8 and 9 — so
     * both fire on the same frame and the gloat, installed first, is what the
     * dispatch above already switched to. This arm is reached only when the
     * player went down on a frame the preamble did not see him down.)
     */
    case 5: {
      if (k.player.down) return install(e, BATBOY.back);
      switch (e.tag ?? 0) {
        /**
         * `0x4395df` — the wind-up waits to be PLANTED, then swings.
         *
         * Three ways out, any one of which sends it to `tag + 2` (`0x439617`)
         * with `mall.snd` 0x0d: `obj+0x2a` set, the player behind it, or under
         * ten units of sideways speed left — so a swing thrown out of a coast
         * rides in on it and lands when the glide has bled off. `obj+0x2a` is
         * the collision solver's "something hit me" word (`0x430663`, and
         * `rat.ts` documents it) and nothing on this page writes it;
         * `0x439627` clears it on the way through.
         */
        case 0:
        case 1: {
          if (!(t.forward < 0 || Math.abs(ahead(e)) < PLANTED)) return false;
          k.say(e, BATBOY.strike);
          return install(
            e,
            (e.tag ?? 0) === 0 ? BATBOY.strikeLo : BATBOY.strikeHi,
            true,
          );
        }
        // `0x439635` — and the swing held hands straight into the step back
        case 2:
        case 3:
          return done ? install(e, BATBOY.back) : false;
        default:
          return false;
      }
    }
    /**
     * ---- 7, `0x439764`: the leap, which is three scripts in a row.
     *
     * Crouch to flight to landing to the step back, each one waiting for its own
     * `obj+0x46`, and nothing chooses anything. It is here for completeness:
     * the only thing in the class that installs `0x4744c0` is the blocked
     * counter in states 2 and 4, and `obj+0x2c` is never set on this page, so
     * nothing reaches state 7 until foes are run through the obstacle solver.
     */
    case 7: {
      if (!done) return false;
      switch (e.tag ?? 0) {
        case 0:
          return install(e, BATBOY.fly, true);
        case 1:
          return install(e, BATBOY.land, true);
        case 2:
          return install(e, BATBOY.back);
        default:
          return false;
      }
    }
    /**
     * ---- 8, `0x4397bb`: what it does over a downed player.
     *
     * The preamble put it here and the preamble does not take it out again —
     * this does. `0x4397c0` asks `0x402f60` first, and the frame the player is
     * upright it goes straight back to the run. Otherwise the two tags trade
     * places on a one-in-ten roll each time their script ends: the three-cel
     * loop mostly stays a three-cel loop, and the single cel mostly stays
     * single. Unlike the punk's kind 6 it is not sent home and it does not walk
     * anywhere — neither tag of `0x474340` carries a stride.
     */
    case 8: {
      if (!k.player.down) return install(e, BATBOY.run);
      const tag = e.tag ?? 0;
      if (tag === 0) {
        if (!done) return false;
        // `0x4397f0` — `0x434540(0x64)` answers 1..100, so this is nine in a hundred
        // ...and the loop is `0x439801` putting the same script on again, which
        // rewinds it: one roll a lap, not one a frame
        return k.roll(100) < 10
          ? install(e, BATBOY.gloat2)
          : rewind(e, BATBOY.gloat);
      }
      if (tag === 1) {
        if (!done) return false;
        return k.roll(100) < 10 ? install(e, BATBOY.gloat) : false;
      }
      return false;
    }
    default:
      return false;
  }
};

export { NOT_HERE as BATBOY_NOT_HERE, THE_LEVER as BATBOY_LEVER };
