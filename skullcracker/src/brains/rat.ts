/**
 * The rat — `initrat`, think function `0x44e010`, and the smallest complete
 * machine in the chapter.
 *
 * ## It has no state 0
 *
 * `0x44e02f` reads `obj+0x18`, **decrements it**, and only then bounds it
 * against 5: `movsx eax, word ptr [esi+0x18]; dec eax; cmp eax, 5; ja
 * 0x44e345`. So the six table entries at `0x44e358` are states **1 to 6**, and
 * state 0 falls straight out of the unsigned compare into the common return.
 * The creator ends `0x450a3a` by installing `0x476f48` tag 0 — a kind-1 script
 * — so a rat is born in state 1 and there is nothing below it. This page's
 * `stepFight` zeroes `e.script` when the player leaves a record's rect, so
 * `case 0` here puts the hide back on, which is exactly what the creator does.
 *
 * ## Its five scripts, and therefore its five live states
 *
 * Walked out of the class's data region with the header `{i16 count, i16
 * ticksPerFrame, i16 kind}` and each script padded up to a multiple of four:
 *
 * ```
 *   1  0x476f48  16 frames, 3 ticks — five tags: the whole of coming OUT
 *   2  0x476fd0   3 frames, 4 ticks — three tags of ONE cel: standing about
 *   3  0x476ff0  12 frames, 1 tick  — three tags of the run
 *   4  0x477058   6 frames, 1 tick  — the pounce
 *   6  0x477090   9 frames, 1 tick  — the launch a blow puts it in
 * ```
 *
 * **There is no kind 5 script anywhere in the rat's data**, and the jump table's
 * fifth entry is `0x44e345` — the common `xor ax, ax` exit. State 5 has neither
 * a script nor a line of code; it is a hole in the table, not an omission here.
 *
 * ## What this module owns, and what it does not
 *
 * States 1 to 4 are everything a rat does on its feet and they are all here.
 * State 6 is the death, which the page drives through {@link Foe.frail} and
 * {@link Foe.death} — a brain is never called while an enemy is dying — and the
 * one thing its think case does beyond playing the script is named at
 * {@link NOT_HERE}. The rat has no flinch at all: `0x44e3f0` has no health test
 * and no branch, so one blow of any size is the launch.
 *
 * ## The stack frame
 *
 * `0x44e010` does `sub esp, 0xc` and then pushes **three** registers before the
 * two arguments to `0x45efd0`, so the sixteen bytes the tracker filled sit at
 * `esp+0xc`: `esp+0x10` is `out+4`, the BAND, and `esp+0x16` is `out+0xa`, the
 * forward distance. `0x44e1ec` reads `esp+0x10` against 2 and `0x44e17d` reads
 * `esp+0x16` against 0, and both of those are what they look like only at this
 * offset.
 *
 * And the tracker is seeded differently from the punk's: `0x450a32` calls
 * `0x45ef70(AI+0xa, obj, [0x4ac3d4], 0x4770e0)`, so the rat's band list lives in
 * the AI struct rather than in the think function, and `0x4770e0` is `200, 80,
 * 0` — two bands, which makes band 2 the innermost.
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
 * Three things `0x44e010` does that this port has nowhere to put, and the death
 * state, which the page owns.
 *
 * - **`obj+0x24`, the gravity multiplier.** `0x42f850(obj, f)` stores `f * 10.0`
 *   (`[0x46a110]`) into `obj+0x24`, and `0x450a1c` creates a rat with **zero**:
 *   a hidden rat does not fall. `0x44e0ff` turns it to `1.0` on the frame the rat
 *   decides to come out, and `0x44e2cf` turns it back to zero the frame it gets
 *   home. This page's {@link Enemy} carries no per-foe gravity scale — only the
 *   player has one (`walk.ts`'s `gravityScale`) — so the two calls are read and
 *   not spent.
 * - **`0x44e390`, the test that keeps it in.** It is NOT a crowd test of its own
 *   class. `[0x476a8c]` is the list `0x44fd2d` registers the **mailbox** class
 *   under, and `0x44e390` walks it looking for one within `0x4b` (75) in x and
 *   `0x96` (150) in y of the rat. Find one and the rat goes back to hiding
 *   instead of coming out. A brain here is handed no view of the other objects
 *   in the level — {@link BrainCtx} has `crowded`, which is the punk's own
 *   `0x44f020` and counts the punk's own class — so the mailbox is not asked
 *   about and a rat next to one comes out anyway.
 * - **`obj+0x2a`, the "something hit me" word.** `0x430663` — the elastic
 *   collision solver — sets it to 1 on the victim as it writes the new velocity
 *   pair. `0x44e218` clears it as the pounce goes on and `0x44e304` reads it back
 *   every frame of the pounce: a rat that collides with anything in mid-air
 *   abandons the leap and bolts for home on kind 3 tag 2. Nothing in this port
 *   writes a collision flag onto a foe, so state 4 here only ever takes its other
 *   branch.
 * - **state 6, `0x44e33f`, the death.** Two instructions: `mov word ptr
 *   [esi+0x10], 0xff6a` and fall into the common return. `obj+0x10` is the floor
 *   offset (see `props.ts` on `0x41a20e`'s −100 for the shower), so a dying rat
 *   has its contact point lifted **150** pixels above the foot of its cel for
 *   the whole of `0x477090`: nothing under it holds the drawn body up, and a
 *   rat that has weight drops through the street it died on. The page plays
 *   that script through {@link Foe.death} and the launch through
 *   {@link Foe.frail}; the offset is {@link ratReacts}.
 */
const NOT_HERE = "0x44e0ff, 0x44e390, 0x44e304" as const;

/**
 * `0x44e33f` — state 6's one write, made every frame the death plays: the
 * floor offset `obj+0x10 = −150`. A brain is never called while a thing is
 * dying, so it is a {@link Reaction}.
 */
export const ratReacts: Reaction = (e) => {
  if (e.state === "dead") e.floor = RAT_DYING_FLOOR;
};

/** `0x44e33f` — `mov word ptr [esi+0x10], 0xff6a` */
const RAT_DYING_FLOOR = -150;

/**
 * Its whole repertoire, by kind and tag, out of `0x476f48`…`0x477090`.
 *
 * Nothing it plays lifts except the pounce, whose first frame is `dx 150, dy
 * -250`. The three kind-2 entries are one cel apiece with no stride at all:
 * tags of a three-frame script with four ticks a frame and a `dx` of zero.
 *
 * And it BITES. Cels 3002…3005 — the back four of the pounce, and 3003/3004
 * are also the second and third pose — carry a strike box and no blow pair,
 * and `0x44e349` stamps `obj+0x1a = 0x64` on the way out of every frame. So
 * `0x42f910` makes the blow out of the rat's own velocity alone: the pounce
 * lands as hard as it is flying, and a pose it is merely standing in lands as
 * nothing much.
 */
export const RAT = {
  /** kind 1 tag 0 — where a rat lives: cel 3011 three times, and it LOOPS */
  hide: {
    cels: [3011, 3011, 3011],
    hold: 3,
    kind: 1,
    tag: 0,
    from: "0x476f48 tag 0",
  },
  /** kind 1 tag 1 — the twitch that breaks the wait */
  twitch: {
    cels: [3010, 3010, 3011, 3010, 3011],
    hold: 3,
    kind: 1,
    tag: 1,
    from: "0x476f48 tag 1",
  },
  /** kind 1 tag 2 — the look, and the only tag that asks where the player is */
  look: {
    cels: [3010, 3011, 3010],
    hold: 3,
    kind: 1,
    tag: 2,
    from: "0x476f48 tag 2",
  },
  /** kind 1 tag 3 — it has decided to come out */
  stir: {
    cels: [3014, 3015],
    hold: 3,
    kind: 1,
    tag: 3,
    from: "0x476f48 tag 3",
  },
  /** kind 1 tag 4 — and out, onto the street */
  emerge: {
    cels: [3016, 3017, 3018],
    hold: 3,
    kind: 1,
    tag: 4,
    from: "0x476f48 tag 4",
  },
  /** kind 2 — three tags of ONE cel each, four ticks, no stride: standing about */
  pose: [
    { cels: [3000], hold: 4, kind: 2, tag: 0, from: "0x476fd0 tag 0" },
    { cels: [3003], hold: 4, kind: 2, tag: 1, from: "0x476fd0 tag 1" },
    { cels: [3004], hold: 4, kind: 2, tag: 2, from: "0x476fd0 tag 2" },
  ] as const,
  /** kind 3 tag 0 — the run, six cels at 85 a frame */
  run: {
    cels: [3025, 3024, 3023, 3022, 3021, 3020],
    hold: 1,
    dx: [85, 85, 85, 85, 85, 85],
    kind: 3,
    tag: 0,
    from: "0x476ff0 tag 0",
  },
  /** kind 3 tag 1 — the same run, three cels of it: another lap */
  dash: {
    cels: [3025, 3024, 3023],
    hold: 1,
    dx: [85, 85, 85],
    kind: 3,
    tag: 1,
    from: "0x476ff0 tag 1",
  },
  /** kind 3 tag 2 — the same three cels at DOUBLE the stride: going home */
  bolt: {
    cels: [3025, 3024, 3023],
    hold: 1,
    dx: [170, 170, 170],
    kind: 3,
    tag: 2,
    from: "0x476ff0 tag 2",
  },
  /** kind 4 tag 0 — the pounce, and the lift is all on the first frame */
  pounce: {
    cels: [3000, 3001, 3002, 3003, 3004, 3005],
    hold: 1,
    dx: [150, 0, 0, 0, 0, 0],
    dy: [-250, 0, 0, 0, 0, 0],
    kind: 4,
    tag: 0,
    from: "0x477058 tag 0",
  },
  /** `0x4770e0` — the descending list the creator hands `0x45ef70`, and its 0 end */
  bands: [200, 80],
  /** `0x44e19d` — `0x40ef30(0x4a7910, 0xb, y)`, the squeak as it starts running */
  squeak: 0xb,
  /** `0x44e1fc` — and 0xd as it goes up: the sound of a rat leaving the ground */
  hiss: 0xd,
  /** `0x4509f3` — `0x40e300(0xc8)` into `AI+0`, and no state of its own reads it */
  nerve: 0xc8,
  from: "0x44e010",
} as const;

/**
 * `0x44e2c0` — near enough home to stop, in pixels.
 *
 * `cmp eax, 0x28` against `|self.x - AI+8|`, and AI+8 is the x half of the
 * record's own point (`0x450a07` copies the creator's point argument into AI+6
 * as a dword, y then x, the same dword it put in `obj+6`).
 */
const HOME_PX = 0x28;

/**
 * `initrat`'s own machine, states 1 to 4.
 *
 * ## Shape of it
 *
 * A rat is a two-halves animal. States 1 and 3-tag-2 are the burrow: wait, peer
 * out, decide, come out — and, when it is done, run home at twice speed and turn
 * back into a cel that does not move. States 2, 3 and 4 are what it does while
 * it is out: stand in one of three poses, run, and pounce when the player gets
 * inside the inner band.
 *
 * **Not one state of it asks whether the player's point is inside the record's
 * rect.** `0x434200` is never called from `0x44e010`, and that matters here
 * because a rat's records are 20x20 markers: the page's `e.fighting` would be
 * false almost always, and the disc's rat does not care. What wakes it is
 * `0x44e0e6` — the player's x greater than its own — and what sends it back is
 * its own coin.
 *
 * ## Every path returns false
 *
 * `0x44e345` is the single exit and it is `xor ax, ax`. There is no `mov ax, 1`
 * anywhere in `0x44e010`, not even in the death case — the rat's `mov ax, 1` is
 * in its HIT handler (`0x44e43d`), which is a different function and not a
 * brain. So a waiting state here returns `false` and lets its script play.
 *
 * ## Every install is a rewind
 *
 * Each `0x45d090` in `0x44e010` is behind an `obj+0x46` test or a beat, so it
 * runs once per event, and it starts the script from its first frame even when
 * it is the one already playing (`0x45d0ab` zeroes the frame index). A second
 * lap of the dash (`0x44e27b`) or the same pose rolled twice (`0x44e1d1`,
 * `0x44e322`) plays whole again — so these are {@link rewind}, not the
 * idempotent install.
 */
export const rat: Brain = (e, foe, run, k) => {
  const done = e.clock >= run;
  const t = k.track(e, RAT.bands);
  // `0x4509f3`/`0x450a0a`: the creator's seeds — nerve scaled, beat and the
  // decision word both zero. `AI+2` is the only one the machine spends
  e.nerve ??= k.scaled(RAT.nerve);
  e.beat ??= 0;
  e.decisions ??= 0;
  e.strength = 0x64; // `0x44e349`, on the way out of every path
  switch (e.script ?? 0) {
    /**
     * ---- 0: not a state at all — `0x44e02f`'s `dec eax` puts it out of range.
     *
     * The creator's last act is `0x450a3a`, `0x45d090(obj, 0x476f48, 0)`, so a
     * rat that has no script yet gets the hide.
     */
    case 0:
      return install(e, RAT.hide);
    // ---- 1, `0x44e044`: coming out, in five tags, sub-dispatched at `0x44e370`
    case 1:
      return burrow(e, k, done);
    /**
     * ---- 2, `0x44e17d`: standing about, and THREE things happen in order.
     *
     * This is the one state with no `switch` and no early return: it turns, it
     * counts its beat down, it re-poses, and it checks the band, in that order,
     * and each install overwrites the last. That ordering is real and not
     * incidental — `0x45d090` clears `obj+0x46` at `0x45d0db`, so an install made
     * by the beat suppresses the re-pose that follows it, while the band test at
     * the end reads no flag at all and therefore always wins.
     */
    case 2: {
      // `0x44e17d`: `[esp+0x16]` is the forward distance, and behind it turns
      if (t.forward < 0) e.facing = -e.facing;
      let ended = done;
      // `0x44e189`: `AI+2` down one a frame, and at the bottom it squeaks and runs
      const beat = e.beat ?? 0;
      e.beat = beat - 1;
      if (beat < 0) {
        k.say(e, RAT.squeak);
        rewind(e, RAT.run);
        // `0x44e1bc`: and a fresh beat of one to seven
        e.beat = k.roll(7);
        ended = false;
      }
      // `0x44e1ca`: otherwise, when the pose it is holding runs out, another pose
      if (ended) rewind(e, RAT.pose[k.roll(3) - 1]);
      /**
       * `0x44e1ec`: `cmp word ptr [esp+0x10], 2` — the BAND, and 2 is the
       * innermost of `0x4770e0`'s two, which is inside eighty pixels. It goes up
       * with `0x40ef30(0x4a7910, 0xd, y)` and with `obj+0x2a` cleared so that
       * anything it collides with on the way can abort the leap — see
       * {@link NOT_HERE}.
       */
      if (t.band === 2) {
        k.say(e, RAT.hiss);
        rewind(e, RAT.pounce, true);
      }
      return false;
    }
    // ---- 3, `0x44e226`: the run, and tag 2 of it is a different animal
    case 3:
      return running(e, k, done);
    /**
     * ---- 4, `0x44e304`: the pounce, which only ever ends one way here.
     *
     * `0x44e304` opens on `obj+0x2a` — knocked in mid-air, bolt for home — and
     * this port has no such flag ({@link NOT_HERE}). What is left is the tail:
     * when the six cels have played, it stands about again.
     */
    case 4:
      return done ? rewind(e, RAT.pose[k.roll(3) - 1]) : false;
    /**
     * ---- 5: the table's fifth entry is `0x44e345`, the common return, and the
     * class owns no kind-5 script. Nothing can put a rat here.
     * ---- 6, `0x44e33f`: the death, and the page plays it — see {@link NOT_HERE}.
     */
    default:
      return false;
  }
};

/**
 * State 1, `0x44e044` — the burrow, sub-dispatched on `obj+0x44` at `0x44e370`.
 *
 * Five tags and it is a chain: wait, twitch, look, decide, out. Only the wait is
 * on a beat; every other tag waits for its own script to finish, which is the
 * `cmp word ptr [esi+0x46], 0` each of them opens with.
 */
function burrow(e: Enemy, k: BrainCtx, done: boolean): boolean {
  switch (e.tag ?? 0) {
    /**
     * tag 0, `0x44e058` — the wait, and it does NOT look at `obj+0x46`.
     *
     * Cel 3011 three times over at three ticks a frame, looping for as long as
     * `AI+2` says. When the beat runs out it twitches and takes a new one of
     * `0x434540(7) + 0xe` — fifteen to twenty-one.
     */
    case 0: {
      const beat = e.beat ?? 0;
      e.beat = beat - 1;
      if (beat >= 0) return false;
      rewind(e, RAT.twitch);
      e.beat = k.roll(7) + 0xe;
      return false;
    }
    // tag 1, `0x44e093` — `0x434540(4)`, and it is an even coin: back in, or look
    case 1:
      if (!done) return false;
      return k.roll(4) < 3 ? rewind(e, RAT.hide) : rewind(e, RAT.look);
    /**
     * tag 2, `0x44e0d7` — the look, and the one place a rat asks about the player.
     *
     * `0x44e0e6` fetches `[0x4ac3d4]`, the player, and compares HIS x with its
     * own: `jle` back to the hide. So a rat only ever comes out for a player
     * standing to its EAST, and a player who has not yet walked past it never
     * sees one. The other half of the gate is `0x44e390`, the mailbox test, which
     * this port cannot ask — {@link NOT_HERE}.
     */
    case 2:
      if (!done) return false;
      if (k.player.x <= k.anchorX(e)) return rewind(e, RAT.hide);
      // `0x44e0ff`: `0x42f850(obj, 1.0)` — out it comes, and it falls now
      e.weightless = false;
      return rewind(e, RAT.stir);
    /**
     * tag 3, `0x44e137` — out it comes, and `AI+4` is set to one on the way.
     *
     * `mov word ptr [edi+4], 1`. Nothing in `0x44e010` ever reads `AI+4` back —
     * only `0x44e2d4` writes it again, zero, when the rat gets home — so unlike
     * the punk's decision budget it spends nothing. It is carried because it is
     * written.
     */
    case 3:
      if (!done) return false;
      e.decisions = 1;
      return rewind(e, RAT.emerge);
    // tag 4, `0x44e15d` — and the last cel of coming out hands to kind 2 tag 0
    case 4:
      return done ? rewind(e, RAT.pose[0]) : false;
    default:
      return false;
  }
}

/**
 * State 3, `0x44e226` — the run, sub-dispatched on `obj+0x44` inline.
 *
 * `0x44e22a` throws out a negative tag and `0x44e237` sends only tag 2 to its own
 * block, so tags 0 and 1 share one and tags above 2 do nothing.
 */
function running(e: Enemy, k: BrainCtx, done: boolean): boolean {
  const tag = e.tag ?? 0;
  /**
   * tags 0 and 1, `0x44e241` — another lap, or stop.
   *
   * `0x434540(5)` against 3: three of the five keep it running on tag 1, the
   * three-cel lap, and two of them stop it in one of the three poses.
   */
  if (tag >= 0 && tag <= 1) {
    if (!done) return false;
    return k.roll(5) >= 3
      ? rewind(e, RAT.dash)
      : rewind(e, RAT.pose[k.roll(3) - 1]);
  }
  if (tag !== 2) return false;
  /**
   * tag 2, `0x44e290` — going home at a hundred and seventy a frame.
   *
   * It faces the record's own point rather than the player: `0x44e294` compares
   * `AI+8` with its own x and sets `obj+0x28` — the mirror flag, 1 for west —
   * from the sign, every frame, whether or not the script has ended. Then, when
   * it has, `0x44e2c0` measures the gap: inside forty it stops dead, and further
   * out it runs another three cels.
   */
  const home = e.home ?? e.x;
  e.facing = home < e.x ? -1 : 1;
  if (!done) return false;
  if (Math.abs(e.x - home) < HOME_PX) {
    /**
     * `0x44e2c5`: velocity pair cleared, gravity back to zero ({@link NOT_HERE}),
     * `AI+4` zeroed, and then `0x44e2db` copies the dword at `AI+6` straight into
     * `obj+6` — it is PUT back on the record's point, both halves at once, not
     * walked there. This page's {@link Enemy} keeps only the x half of that point
     * (`home`), so the y half of `0x44e2e4` has nothing to restore from.
     */
    e.vx = 0;
    e.vy = 0;
    e.decisions = 0;
    e.x = home;
    if (e.homeY !== undefined) e.y = e.homeY;
    e.weightless = true;
    return rewind(e, RAT.hide);
  }
  return rewind(e, RAT.bolt);
}

export { NOT_HERE as RAT_NOT_HERE };
