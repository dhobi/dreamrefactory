/**
 * The CHOPPER — `initwered`, `0x454410`, the thing that hatches a punk when it dies.
 *
 * ## Its five scripts, and therefore its six states
 *
 * `0x45d090` copies word 4 of a script's header into `obj+0x18`, so the kinds of
 * the scripts a class owns ARE its state machine's alphabet. The CHOPPER's live in
 * one run of `.data` and they were read out of it whole:
 *
 * ```
 *   0  0x477ad0  one cel, no stride: the CHOPPER standing in its patch
 *   1  0x477ae0  tag 0 the four-cel walk, tag 1 the lurch that loops and squeals
 *   2  0x477b28  the maul — six cels that travel, and the only attack it has
 *   3  0x477b70  one cel, no stride: the turn, and a state that lasts one frame
 *   4  0x477b80  UNREFERENCED — see {@link ORPHAN}
 *   5  0x477ba0  the death, four tags run together
 * ```
 *
 * The jump table is `0x454764`, six entries, and two of them are the same
 * address: state 4 and state 2 both land on `0x4545d5`. Nothing installs a
 * script of kind 4, so state 4 is a door onto a room the class never enters, and
 * it is written below only because the table really does point there.
 *
 * ## How little it thinks
 *
 * This is the simplest machine in the chapter and the reason is that it has no
 * decisions to spend. Its AI struct is not the punk's: the creator `0x450cb0`
 * writes the literal **3** into `AI+0` (`0x450d1c`) — that is its HEALTH, not a
 * nerve — parks the player's object at `AI+2`, copies the record's rect into
 * `AI+6`, zeroes `AI+0x12` and `AI+0x14`, and hands `0x45ef70` the band list at
 * `0x477c28`. There is no `AI+4` decision budget, no `AI+2` beat, no `AI+6`
 * side: the two words this class ever spends are `AI+0x12`, the count the corpse
 * lies still for, and `AI+0x14`, the flag one particular blow sets. So the CHOPPER
 * does not circle, does not back off, does not taunt and never once turns to
 * face you inside four hundred pixels. It walks the way it is pointed, turns at
 * a wall or when you have got six hundred behind it, and mauls whatever is
 * inside a hundred and sixty in front.
 *
 * ## What this module owns, and what it does not
 *
 * States 0 to 4 are the ones a CHOPPER is in while it is on its feet, and those are
 * here. State 5 is the whole of the death, which the page drives through
 * {@link Foe.death} and {@link Foe.hatches}; a brain is never called during it,
 * and what the death's own tags do on the way is {@link weredReacts}. It is
 * laid out at {@link NOT_HERE}. **There is no flinch state at all** — the table
 * has no entry for one and nothing installs the one script that holds flinch
 * cels. The one thing its hit handler does besides count is {@link weredGate}.
 */
import type { Foe } from "../foes";
import {
  install,
  rewind,
  type Brain,
  type Enemy,
  type Reaction,
  TICK_SCALE,
} from "./kit";

/**
 * State 5, `0x454634`, and the hit handler `0x454790` that walks into it. The
 * page owns the animation; the sounds, the lying-still and the flame the wreck
 * burns with for good are {@link weredReacts}.
 *
 * - The handler: `0x454821` is `dec word ptr [eax]` on `AI+0`, the 3 the creator
 *   wrote, with the blow's own strength fetched at `0x454812` and spent only on
 *   the blood. **Three hits of any size.** When it reaches zero `0x454866`
 *   installs kind 5 tag 0 and `0x454873` calls `0x40d450(0x12c)`.
 * - **5 tag 0**, `0x454653`: the fall (4890, 4891) ends, sound 0x20 goes out
 *   through `0x40f110`, kind 5 tag 1 goes on, and then `0x454690` calls
 *   `0x450a50` — the punk's own creator — at the CHOPPER's point with the CHOPPER's
 *   own rect out of `AI+6` and `AI+0xa`. That is {@link Foe.hatches}.
 * - **5 tag 1**, `0x4546a1`: `0x44ff20(obj, 3, 1)`, sound 0x20 through
 *   `0x40ef30`, kind 5 tag 2, and `AI+0x12 = 0x434540(0x4b) + 0x32` — between
 *   fifty and a hundred and twenty-five frames of lying there.
 * - **5 tag 2**, `0x4546f7`: counts `AI+0x12` down a frame at a time and then,
 *   with `obj+0x1a` raised to 0x65, plays sound 0x34 through `0x40f090` and puts
 *   on kind 5 tag 3, the sink (4905..4911).
 * - **5 tag 3**, `0x454748`: the one `mov ax, 1` in the class (`0x454759`) — the
 *   frame the object is taken out of the world.
 */
const NOT_HERE = "0x454634, 0x454653, 0x4546a1, 0x4546f7, 0x454748" as const;

/**
 * `0x477b80` — kind 4, three tags of one cel each, `1970`, `1971` and `1972` at
 * four frames a cel.
 *
 * Those are the PUNK's flinch cels, not the CHOPPER's; the CHOPPER's own art is the
 * 4870..4911 run. A raw search of the image for `struct.pack('<I', 0x477b80)`
 * finds no reference anywhere in `SC.EXE`, so no `0x45d090` call ever installs
 * it and `obj+0x18` is never 4. It is a leftover of whichever class this one was
 * copied from, and it is the reason the CHOPPER cannot flinch: the table at
 * `0x454764` has no flinch state and the hit handler `0x454790` never reaches
 * for one. A blow on a CHOPPER is a sound, some blood, and one off three.
 */
const ORPHAN = "0x477b80" as const;

/**
 * Its whole repertoire, by kind and tag, straight out of `0x477ad0`…`0x477ba0`.
 *
 * Every cel, hold and stride below is the script's own. `Foe.divisor` for this
 * class is 20, so the 190 each frame carries is nine and a half pixels of
 * ground — a big slow thing covering about the same distance as the punk's walk.
 */
export const WERED = {
  /** kind 0 — one cel, no stride: what a CHOPPER nobody has walked up to is doing */
  idle: { cels: [4870], hold: 1, kind: 0, tag: 0, from: "0x477ad0 tag 0" },
  /** kind 1 tag 0 — the four-cel walk, and every frame of it travels */
  walk: {
    cels: [4870, 4871, 4872, 4873],
    hold: 1,
    dx: [190, 190, 190, 190],
    kind: 1,
    tag: 0,
    from: "0x477ae0 tag 0",
  },
  /**
   * kind 1 tag 1 — the same stride on half the cels: 4871 and 4873 twice each,
   * which is the walk with its two extremes held. This is the state the CHOPPER
   * spends its life in, and the one that decides.
   */
  lurch: {
    cels: [4871, 4871, 4873, 4873],
    hold: 1,
    dx: [190, 190, 190, 190],
    kind: 1,
    tag: 1,
    from: "0x477ae0 tag 1",
  },
  /**
   * kind 2 — the maul, and the only attack a live CHOPPER has. Six cels, all of
   * them travelling, and `fights.ts` already has it as this class's attack
   * because its cels carry a strike box where the walk's do not.
   */
  maul: {
    cels: [4880, 4881, 4882, 4883, 4884, 4885],
    hold: 1,
    dx: [190, 190, 190, 190, 190, 190],
    kind: 2,
    tag: 0,
    from: "0x477b28 tag 0",
  },
  /** kind 3 — one cel, no stride, and a state that never survives a frame */
  turn: { cels: [4870], hold: 1, kind: 3, tag: 0, from: "0x477b70 tag 0" },
  /**
   * `0x477c28` — the descending list the creator hands `0x45ef70` at `0x450d15`,
   * and what `0x45efd0` reads `out+4` out of.
   *
   * The first two entries are both 600, which makes band 1 unreachable:
   * `0x45f050` walks the list while the entry is still at or past the distance,
   * so anything at or inside 600 clears both in the same pass. What is left is
   * 0 beyond 600, 2 from 600 in to 160, 3 from 160 in to 70, and 4 inside 70 —
   * and the maul answers to 3 and 4 alike, so the number that matters is 160.
   */
  bands: [600, 600, 160, 70],
  /** `0x45457f` — `woods.snd` 0x1e, the cry it goes into the maul on */
  squeal: 0x1e,
  /** `0x4545ad` — and 0x1d every time the lurch comes round again */
  tread: 0x1d,
  /** `0x4546bd` — the wreck's cry as FANG is clear of it, the hatch's own 0x20 */
  cry: 0x20,
  /** `0x454720` — and 0x34 as it sinks */
  sink: 0x34,
  from: "0x454410",
} as const;

/**
 * `0x45454a` — the player more than six hundred pixels BEHIND it.
 *
 * `cmp word ptr [esp+0x12], 0xfda8` is a signed word compare against −600.
 * `out+0xa` is already negated when `obj+0x28` is set (`0x45eff3`), so a
 * negative forward distance means behind and this is the one thing short of a
 * wall that makes a CHOPPER think about turning round.
 */
const TURN_BEHIND = -600;

/**
 * `0x454617`/`0x45461c` — the hundred pixels the turn shunts it.
 *
 * `sbb eax, eax; and eax, 0xc8; sub eax, 0x64` is a branchless ±100 keyed on the
 * mirror flag it has just flipped: now facing east, `x += 100`; now facing west,
 * `x -= 100`. It is a step clear of whatever it walked into, in the direction it
 * has just turned to face, and it goes straight onto `obj+8`, so it is real
 * pixels and not the scripts' pre-divisor units.
 */
const STEP_OFF = 100;

/**
 * `0x454477`/`0x45448b` — the sideways speed cap, applied before the dispatch.
 *
 * `obj+0xc` is clamped to ±0x1e on every think, whatever state the thing is in.
 * The CHOPPER is the one class in the chapter carrying a drag and a restitution of
 * its own (`0x45436a` pushes 0.05f, `0x454378` pushes 0.3f), so it is the one
 * that can be bounced hard enough off an obstacle to need the cap.
 */
const SPEED_CAP = 30;

/** thirty pixels an ENGINE frame, and a tick is a QUARTER of one — {@link TICK_SCALE} */
const TICKS = TICK_SCALE;

/**
 * `initwered`'s own machine, states 0 to 4.
 *
 * ## The stack frame, which is where the field numbers come from
 *
 * `0x454410` does `sub esp, 0xc` — not the punk's 0x10; twelve bytes is exactly
 * what `0x45efd0` fills, `out+0` through `out+0xa` — and then pushes **two**
 * registers before the output pointer, so after the `add esp, 8` at `0x454427`
 * the sixteen-byte block sits at **`esp+8`**: `esp+0xc` is `out+4`, the BAND, and
 * `esp+0x12` is `out+0xa`, the forward distance. `[esp+0x18]` being `obj` and
 * `[esp+0x20]` being the AI struct is what settles it — those are the two
 * arguments, at `E+4` and `E+8`.
 *
 * ## The preamble, which is not a state
 *
 * Two things happen at `0x454473` and `0x454495` before the jump table:
 * `obj+0xc` is capped ({@link SPEED_CAP}) and `obj+0x1a` is set to 0x64. The
 * second is the strength percent this thing would land a blow at. **Nothing hits
 * the player back in this port**, so it is carried as read and spends nothing.
 *
 * And before both of those, `0x45442a`: with the player at band 2 or better and
 * in front, and the CHOPPER neither asleep (state 0) nor dead (state 5),
 * `0x40d1c0` is handed `AI+0` — its three points of health — against
 * `0x40e300(0x64)` and plate `0x32cb`. That is the boss bar's claim, decided by
 * Manhattan distance across every claimant in the room, and the page already has
 * it as `Foe.panel`; it is named here only so the next reader does not go
 * looking for a sound at `0x40d1c0`.
 *
 * ## And the return value
 *
 * Every path out of `0x454410` is `xor ax, ax` except `0x454759`, the frame the
 * corpse is removed — which is in state 5 and therefore not here. **So every
 * path below returns `false`**, the waiting ones included: a think function
 * never suppresses the animation, and returning `true` would freeze the CHOPPER
 * mid-stride with its nine and a half pixels unspent.
 */
export const wered: Brain = (e, foe, run, k) => {
  const done = e.clock >= run;
  const t = k.track(e, WERED.bands);
  // `0x454473` — the cap, and it is applied whatever the state is
  const cap = SPEED_CAP * TICKS;
  if (e.vx > cap) e.vx = cap;
  else if (e.vx < -cap) e.vx = -cap;
  switch (e.script ?? 0) {
    /**
     * ---- 0, `0x4544a7`: standing in its patch, and the one thing that ends it.
     *
     * `0x434200(player.point, AI+6)` — the player's own point inside the four
     * words the creator copied out of this record — and nothing else. There is
     * no script-finished test and no alternative branch: a CHOPPER outside the
     * fight holds cel 4870 and does not move. The page's own boundary test is
     * `e.fighting`, and it is the same rect.
     */
    case 0:
      return e.fighting ? install(e, WERED.walk) : install(e, WERED.idle);
    /**
     * ---- 1, `0x4544d8`: the walk, and the whole of the CHOPPER's judgement.
     *
     * It opens on the wall test and then sub-dispatches on `obj+0x44`; a tag
     * that is neither 0 nor 1 falls straight out at `0x454521`, which is what
     * the `default` below is.
     */
    case 1: {
      // `0x4544d8` — bounced off something it walked into: turn round
      if (bounced(e)) return install(e, WERED.turn);
      const tag = e.tag ?? 0;
      // `0x45452a` — the plain walk plays through once and hands to the lurch
      if (tag === 0) return done ? install(e, WERED.lurch) : false;
      if (tag !== 1) return false;
      // `0x45454a` — and this is the only turn that is about the player at all
      if (t.forward < TURN_BEHIND) return install(e, WERED.turn);
      /**
       * `0x45456c` — band 3 or 4, which with {@link WERED.bands} is anything
       * inside a hundred and sixty pixels IN FRONT. Not gated on the script
       * ending: the maul goes on the frame you cross the line, and because
       * `0x45d090` clears `obj+0x46` as it installs, the script-finished test
       * eight instructions later at `0x45459e` reads the zero it has just
       * written and returns. Installing is the whole of the frame.
       */
      if (t.band >= 3 && t.band <= 4) {
        k.say(e, WERED.squeal);
        return install(e, WERED.maul, true);
      }
      // `0x45459e` — otherwise the lurch simply comes round again, out loud,
      // from its first cel: `0x45d090` rewinds the script it is handed even
      // when it is the one already playing, so 0x1d is once a lap of four
      if (!done) return false;
      k.say(e, WERED.tread);
      return rewind(e, WERED.lurch);
    }
    /**
     * ---- 2, `0x4545d5`: the maul ends and it goes back to walking.
     *
     * ---- 4 is the same handler — the jump table's entries 2 and 4 are both
     * `0x4545d5` — and it is unreachable, because nothing in the image installs
     * a script of kind 4. See {@link ORPHAN}.
     */
    case 2:
    case 4:
      return done ? install(e, WERED.walk) : false;
    /**
     * ---- 3, `0x4545f9`: the turn, and it never survives the frame it is in.
     *
     * `xor al, 1` on the mirror flag, `obj+0xc` cleared, a hundred pixels along
     * the way it now faces ({@link STEP_OFF}), and the walk back on. There is no
     * script-finished test here either: kind 3 is one cel of 4870 going nowhere,
     * a marker rather than an animation, and the first think that sees it undoes
     * it. What makes it a state at all is that `0x45d090` is the only way to set
     * `obj+0x18`, so "turn round" has to be spelled as a script.
     */
    case 3:
      e.facing = -e.facing;
      // `0x4545ff` — `obj+0xc`, the ride itself: it stops dead and pulls away
      // again from nothing. The page keeps the ride in `e.speed` and a flight
      // in `e.vx`, and the engine's one word is both
      e.speed = 0;
      e.vx = 0;
      e.x += STEP_OFF * e.facing;
      return install(e, WERED.walk);
    default:
      return false;
  }
};

/**
 * `0x4544d8` — has it walked into something and been pushed back off it?
 *
 * The engine's mover sets `obj+0x2c` when the object's own anchor is inside one
 * of the level's obstacle rects (`0x430146`, which `walk.ts` already documents),
 * ejects it along the shortest axis, and scales the velocity it had on that axis
 * by the restitution at `obj+0x20`. The CHOPPER is the only class in the chapter
 * that is given one — `0x454378` pushes 0.3f at it through `0x42f7f0` — so it is
 * the only one that comes off a wall with speed pointing the wrong way, and the
 * test is exactly that: `obj+0x2c` set AND `obj+0xc` disagreeing with the mirror
 * flag. East and a negative speed, or west and a positive one.
 *
 * **The port keeps only the second half.** `Enemy` carries no obstacle flag —
 * this page does not run foes through the obstacle solver — so `obj+0x2c` cannot
 * be asked for. Dropping it costs nothing here: the CHOPPER has no flinch and does
 * not fly ({@link Foe.flies} is not set on it), so the only thing that could put
 * sideways speed on a live one is the bounce this test is looking for, and
 * `e.vx` is otherwise flat zero for its whole life. If foes are ever given the
 * solver, the flag is the half to add back, not the velocity.
 */
function bounced(e: Enemy): boolean {
  if (e.vx === 0) return false;
  return e.facing > 0 ? e.vx < 0 : e.vx > 0;
}

/**
 * `0x4547b3`…`0x4547d5` — the flame's arm of the hit handler, which the page
 * asks before any of its own arithmetic.
 *
 * It lights the thing (`0x44ff20(self, 0, 0)`, the page's {@link Foe.burns}),
 * writes 1 into `AI+0x14`, and writes **0 into `AI+0`** — the three blows'
 * worth of health. Then it falls through to `0x4547f2`, which throws any
 * negative strength away: no `dec`, no sound, no blood, no death this blow. So
 * a CHOPPER set alight is still riding, and the next blow of anything, `dec`ed
 * from 0 to −1, is the one that fells it.
 */
export function weredGate(
  e: Enemy,
  _foe: Foe,
  blow: { damage: number; code: number },
): { damage: number; code: number } | null {
  if (blow.code === BURNS) e.hp = 0;
  return blow;
}

/** `0x4547b3` — `cmp word ptr [edi+0x1a], -9` */
const BURNS = -9;

/**
 * State 5 while the page plays it — `0x4546a1` and `0x4546f7`, once an engine
 * frame.
 *
 * Tag 1 ending (the frame the death reaches its seventh cel) cries `0x20` a
 * second time and rolls how long the wreck lies there, `0x434540(0x4b) + 0x32`
 * into `AI+0x12`. Tag 2 is that lie: one cel, 4904, that `0x4546f7` holds while
 * the count runs down, and when it has run out the sink goes on with `0x34`
 * (`0x454720`). The page keeps that count on `e.beat`, which this class uses
 * for nothing else, and holds the death's clock on the tag-2 cel to hold it.
 *
 * The sink is a blast: `0x454716` sets `obj+0x1a = 0x65` as it goes on and
 * `0x454748` holds it there, and a dead thing worth `0x65` still hits (see
 * `takeHits`). And `0x4546ac` lights the wreck with `0x44ff20(self, 3, 1)` —
 * a flame from its last stage that never goes out.
 */
export const weredReacts: Reaction = (e, foe, _run, k) => {
  if (e.state !== "dead" || e.anim !== foe.death) return;
  const lie = LIE_CEL * e.anim.hold;
  if (e.clock < lie) return;
  if (e.beat === undefined) {
    k.burn(e, { late: true, forever: true }); // `0x4546ac`
    k.say(e, WERED.cry); // `0x4546bd`
    e.beat = k.roll(0x4b) + 0x32; // `0x4546dc`
  }
  // `0x454748` — tag 3, the sink, re-asserts the blast every frame it plays
  if (e.clock >= lie + e.anim.hold) {
    e.strength = BLAST;
    return;
  }
  const left = e.beat;
  e.beat = left - 1;
  if (left >= 0) {
    e.clock = lie;
    return;
  }
  // `0x454716` — the count is out: the wreck goes up, `obj+0x1a = 0x65`
  e.strength = BLAST;
  k.say(e, WERED.sink); // `0x454720`
  e.clock = lie + e.anim.hold;
};

/** `0x454716` / `0x454748` — `0x65`, the strength a blast lands with */
const BLAST = 0x65;

/** where tag 2's one cel sits in {@link Foe.death}: 4890, 4891, then 4900..4904 */
const LIE_CEL = 7;

export { NOT_HERE as WERED_NOT_HERE, ORPHAN as WERED_ORPHAN };
