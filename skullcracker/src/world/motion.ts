/**
 * How the player moves through the air and along the ground: gravity, drag,
 * the air steer and the jump, the engine frame and its divisors, the ladder and
 * the monkey bar, and the strides and holds of the walk.
 */
import type { Foe } from "../foes";
import { TICK_SCALE } from "../brains/kit";
import { OWN } from "../sound";
import { p, held, MEASURED, sound, ANIM, KIT, level } from "./state";

/**
 * Where a lift car's cel hangs off its deck: cel 1160 is 133x108 with its anchor
 * 51 rows down, and the anchor is the object's own position, so the art is drawn
 * from `y - 51` and the deck is the landing platform's own top edge.
 */
export const ELEVATOR_ANCHOR_Y = 51;

/**
 * The player's gravity as the executable stores it: `0x42f850(player, 1.0f)`
 * multiplies by the float at `0x46a110` — which is **10.0, not 100** — and
 * truncates (`0x45f270` sets the FPU to round-toward-zero before its `fistp`).
 * So `obj+0x24` is 10, and `0x430327` adds it to `obj+0xa` once an airborne
 * frame. `obj+0xa` is a velocity in WHOLE PIXELS per engine frame: the object
 * stepper `0x42fd80` opens with `pos.y += obj+0xa; pos.x += obj+0xc` and writes
 * the sum straight back to `obj+6`. Nothing divides it. The earlier "100 raw over
 * the divisor of 12" was a guess at that constant, and 8.33 is what a float
 * model needs to reproduce a 73px apex — the real arc is integer, and it is 80.
 */
export const PLAYER_GRAVITY = 10;
/**
 * Airborne steering, `0x429fef`..`0x42a036` in the jump script's tag-0 handler:
 * while FORWARD is held the horizontal velocity is driven to `0x1e` = **30 pixels
 * a frame** in the facing direction, first decelerating by `0xa` = 10 a frame if
 * it was moving the other way. BACKWARD alone goes through `0x402e40`, which swaps
 * the two flags and flips the facing, and zeroes it — so the next frame the same
 * key is forward and drives it the other way. Neither held: untouched, it coasts.
 * This, not the run speed, is what carries the player across a gap; tag 0's
 * records carry `dx 0`.
 */
export const AIR_SPEED = 30;
export const AIR_TURN = 10;

/**
 * The ground's drag — and it is the per-frame reset this page could not find.
 *
 * Every object is born with `obj+0x1e = 0x1666` (5734) and `obj+0x20 = 0x800`
 * in the allocator `0x42f550` (`0x42f5ba`, `0x42f5c0`), the player included:
 * `0x448875` overwrites two dozen of its fields and leaves those two alone. The
 * body stepper `0x42fd80` reads the first at `0x4302c0`, only on a frame that
 * ended on the ground, and takes `v.x * 5734 >> 13` off the velocity — 70% of it,
 * truncated toward zero, and never less than a whole pixel while anything is
 * left. So a walk is not 8 pixels a frame: each frame adds 8 and the ground
 * keeps 30% of what was there, and that settles at **12** — `12 - 8 = 4`,
 * `4 + 8 = 12`. The run's 15 settles at 22, the crawl's 4 at 6, and a landing
 * at 30 slides 9, 3, 1 and stops. `0x4302a4` skips it in the air, which is why
 * a jump coasts.
 *
 * The second field is the landing's `0x42ff83`: a body arriving faster than 2
 * keeps a quarter of its downward speed for a frame, snapped to the floor each
 * time, and is still for the next. Nothing this page draws depends on it.
 */
export const DRAG = 5734;
export const DRAG_ONE = 8192;
/**
 * One frame of ground drag, at the allocator's rate or at a class's own.
 *
 * `0x42f7a0(obj, f)` is how a class overrides it: the float is multiplied by
 * the 8192.0 at `0x46a108` and stored as the word `obj+0x1e`, so the allocator's
 * 0x1666 IS 0.6999 and the CHOPPER's `0x3d4ccccd` (0.05) is 409. That word is
 * the fraction TAKEN OFF, which is why a lower one is faster — see
 * {@link Foe.drag}.
 */
export function dragged(v: number, rate: number = DRAG): number {
  if (v === 0) return 0;
  let off = Math.trunc((v * rate) / DRAG_ONE);
  if (off === 0) off = Math.sign(v);
  return v - off;
}

/**
 * Divide the way `0x42f8b0` divides: round AWAY from zero.
 *
 * This is the whole of the jump's shape. The mover does not move an object by a fraction of a pixel — it does an `idiv` with
 * an explicit away-from-zero adjustment (`sub ax,cx; inc ax` when negative,
 * `lea eax,[ecx+eax-1]` when positive) and adds a WHOLE number of pixels. So every
 * frame's step has its magnitude rounded UP, and over a jump that compounds:
 * stepping `-420` by hand at the player's divisor of 12 gives moves of
 * `-35 -27 -19 -10 -2` — an apex of 93px where the same numbers integrated as
 * floats give 73.5.
 */
export function roundAway(v: number): number {
  return v < 0 ? -Math.ceil(-v) : Math.ceil(v);
}

/**
 * `obj+0x24`, a foe's gravity, in this page's per-tick units: the allocator's
 * 10 whole pixels a frame² (`0x42f5ca`) unless its class init calls
 * `0x42f850(obj, f)` for `f × 10` ({@link Foe.gravity}). The mover adds it to
 * `obj+0xa` once a frame, after the move, only while off the ground
 * (`0x430322`).
 */
export function foeGravity(foe: Foe): number {
  return (foe.gravity ?? 10) * TICK_SCALE * TICK_SCALE;
}

/**
 * One ENGINE frame of vertical motion: move by what the velocity currently says,
 * then let gravity accumulate — the order `0x42f8b0` and `0x430327` run in.
 */
/**
 * One engine frame of airborne steering — `0x429fef`..`0x42a036`. With a
 * direction held: if the velocity opposes the facing, pull it 10 toward zero;
 * otherwise set it to 30 in the facing direction. With none held (`0x4ac3d2`
 * clear, via the clear-input helper `0x402e40`): zero it.
 */
export function steerAir(): void {
  // `0x402be0` names the two flags by swapping them on the facing: `0x4ac3d2` is
  // FORWARD held and `0x4ac38c` is BACKWARD held. This is the forward branch,
  // `0x429fef`; the caller has already done backward's turn-and-zero
  if (p.facing > 0 && p.vx < 0) p.vx += AIR_TURN;
  else if (p.facing < 0 && p.vx > 0) p.vx -= AIR_TURN;
  else p.vx = p.facing * AIR_SPEED;
}

/**
 * One frame of the flight's own handler — `0x429f1f` for tag 0 and, the same
 * code again, `0x42a201` for the air attacks' tags 8 and 9: the lift, then the
 * steering.
 */
export function airThink(dir: number): void {
  if (held.up && p.hold > 0) {
    p.vyRaw += roundAway(-MEASURED.rise / DIVISOR);
    p.hold -= 1;
  }
  if (dir && dir !== p.facing) {
    // backward alone: `0x402e40` swaps the two flags and turns the player
    // round, and `0x429fdf` zeroes the velocity — and then `0x429fe5` reads
    // the forward flag, which now holds that same key, so the steering drives
    // 30 the new way on this very frame
    p.facing = dir as 1 | -1;
    p.vx = 0;
    steerAir();
  } else if (dir) steerAir();
}

/**
 * J pressed: `0x4296d6`, `0x429a76`, `0x429c65` — one sound, then the standing
 * state installs tag 2, the walk tag 3 and the run tag 4: three frames of 250
 * 251 252 before 253 launches, or the run's one record of 200.
 */
export function startJump(run: boolean, moving: boolean): void {
  sound?.own(OWN.jump, p.x, p.y);
  p.leap = run;
  p.windup = run ? 1 : ANIM.launch.length;
  if (run) p.launchDx = MEASURED.runJumpDx;
  else p.launchDx = moving ? MEASURED.launchDx : 0;
}

export function engineFrame(): void {
  // `vyRaw` now holds the velocity in whole pixels a frame, as `obj+0xa` does;
  // the name is kept so the call sites read unchanged. Move by it, then gravity.
  p.stepPx = p.vyRaw;
  /**
   * `obj+0x32`, and it is a sum of VELOCITIES rather than a distance — the
   * difference decides whether a plank holds. `0x42fdbc` adds `obj+0xa` to it
   * here, at the top of the body step, BEFORE the move and long before the
   * landing clips that move short; `0x42fdc2` stores zero instead on any frame
   * that begins on the ground or that is still rising. So the frame a fall ends
   * on contributes its whole velocity, not the few pixels left above the floor,
   * and a jump that lands 14 pixels lower than it left carries a fifth step of
   * 45 that a jump landing level never reaches.
   */
  p.fallPx = p.stepPx > 0 ? p.fallPx + p.stepPx : 0;
  p.vyRaw += PLAYER_GRAVITY * p.gravityScale;
}
/**
 * The player's own speed divisor, `mov word ptr [eax+0xe], 0xc` at `0x42e412`.
 * It turns {@link MEASURED} into pixels per engine frame — walk 8, run 15, jump
 * 35 — by the rounding-away-from-zero divide in `0x42f8b0`.
 *
 * It is a constant, which took a byte scan to establish rather than a
 * disassembly: `0x42e412` sits inside `0x42dbd0`, the player's state machine,
 * and a windowed sweep that starts mid-instruction disassembles it as garbage —
 * which is how this number came to be doubted. Searching `.text` for the literal
 * encoding of `mov word ptr [reg+0xe], imm16` instead finds every write to the
 * field: about eighty of them, one per creature kind (a rat is 10, a lamp 1, a
 * bullet 50), and exactly two write twelve — `0x42dbd0` and `0x4480f0`, the two
 * playable characters' state machines. No register write to `+0xe` occurs in any
 * function that touches the player pointer `0x4ac3d4`. So the player's divisor
 * is 12, always, and it is never scaled by depth or by anything else.
 */
export const DIVISOR = 12;
/**
 * The engine's frame rate: **15 per second**, measured.
 *
 * `0x4087c0` reads the clock and returns `ms * 3 / 50`, which is units of 1/60s.
 * `0x40e4f0` then spins — `lea ecx, [esi + 4]; cmp eax, ecx; jl` — until four of
 * those units have passed since the last frame, and `0x40dfd0`, which calls it,
 * is called from **all sixteen level frame functions** (STREETS' `0x44dc10` at
 * +614). Four sixtieths is a fifteenth: a frame is 1/15s.
 *
 * The animation stepper advances one cel per frame, so every animation in the
 * game plays at 15fps. It also turns {@link MEASURED}'s per-frame pixels into
 * pixels per SECOND: the walk's
 * 8 a frame settles against the ground's drag at 12 — 180 a second — the run's
 * 15 at 22 (330), and the launch leaves the ground at 35 in one frame.
 */
export const ENGINE_HZ = 15;

/**
 * There is no jump scale: with the engine's own integer velocity model the
 * disc's numbers clear everything they should at exactly 1.0. Gravity is
 * `0x46a110`'s 10.0 with `obj+0x24` simply 10 (not `100/12`), and the airborne
 * horizontal is not the run speed: tag 5's frames carry `dx 0` and `0x429fef`
 * drives `obj+0xc` to 30.
 */

export const INVENTED = {
  /**
   * The page's tick, and it is the port's: four to an engine frame, so that
   * motion the engine takes in 15Hz jumps is drawn in quarters. The frame
   * itself is the engine's — `0x40e4f0` waits four of `0x4087c0`'s 1/60s
   * units, see {@link ENGINE_HZ} — and everything the engine does once a frame
   * runs on the tick where `frameAcc` wraps. Nothing the game does is decided
   * here; this is only how finely it is drawn.
   */
  tickMs: 1000 / 60,
};

/**
 * **50 pixels, and a rise steeper than that is a WALL.** `0x42fedc`: the body
 * stepper adds 0x32 to the floor it found under the object's new position and
 * compares that against the new y. If the floor is further above than 50 and no
 * platform was found under the point, `0x42fef3` throws the whole move away —
 * it restores the packed position from `obj+6`, subtracts `obj+0xc` back out of
 * the x, zeroes the vertical velocity and bounces what is left of the horizontal
 * off `obj+0x20`. That is the only terrain wall the engine has.
 *
 * So the designers' walls are of two kinds, and CITY uses both: an `obstacle`
 * record where they wanted to stop you outright (its five include the 60x308 one
 * at x1873 that this port's own test walks into), and a step over 50 where they
 * wanted you to jump. WOODS is built on the second — the ground east of x8745
 * stands 70 pixels up, and there is no record there at all.
 */
export const CLIMB_PX = 50;
/**
 * **8 pixels, and a floor further below than that is not underfoot.** The same
 * stepper's landing test, `0x42ff56`: `floor - 8 <= newY` is what makes the feet
 * stick, so walking off anything with more than 8 pixels of air under it puts the
 * player in the air for the frame it takes to fall the rest.
 */
export const STICK_PX = 8;
/**
 * ...and for a foe in flight, that window is measured against a whole ENGINE
 * frame's move, which this page takes in four ticks.
 *
 * `0x42ff4c` runs once a frame after `obj+0xa` has been added whole, so a thing
 * RISING is caught only when the frame's lift is 8 or less: the dog's lunge
 * (−80 over its divisor of ten, `0x478108`) stays on the ground, its pounce's
 * −160 (`0x4781b0`) takes it off. Tested every tick against eight, a quarter
 * of any lift under 32 is inside the window and nothing ever left the floor —
 * so rising, the window is a tick's share of the eight.
 */
export const landingWindow = (vy: number): number =>
  vy < 0 ? STICK_PX * TICK_SCALE : STICK_PX;

/**
 * A ladder is counted in RUNGS, and both of its numbers are the disc's.
 *
 * `0x42ae50` is the whole ladder state (kind 7) and it never moves the player by
 * a speed. It keeps a rung index in `[0x4ac406]`, and the last thing it does every
 * frame is
 *
 * ```
 *   0x42b3c9  y = [0x4ac406] * [0x4ac3a0] + [0x4ac3a2]
 * ```
 *
 * — so a climbing player's position is a rung number times a spacing, and nothing
 * in between exists. The three globals come from the `ladder` record itself, which
 * `0x40b940` copies whole into the buffer at `0x4ac3a0` (kind 2: the record whose
 * rect contains the player). Against `SbkEntity`'s own field offsets:
 *
 * ```
 *   [0x4ac3a0]  record +0     param      the RUNG SPACING, and its sign the facing
 *   [0x4ac3a2]  record +2     top        rung 0 — the top of the climb
 *   [0x4ac3a6]  record +6     bottom     the last rung: (bottom - top) / spacing
 *   [0x4ac3ba]  record +0x1a  pointX     the x the player is put at, exactly
 * ```
 *
 * **Every `ladder` in the game has `param` ±35** — the nine of them across MAZE,
 * SEWER, TOWER, RAVECAVE and STREETS — so a rung is 35 pixels, and one rung is one
 * four-frame tag of {@link ANIM.climb}: 8.75px an engine frame, 131 a second.
 *
 * ## The sign is which side of the ladder you hang on
 *
 * `0x42b279` turns the player by it — a positive spacing wants `obj+0x28` set, a
 * negative one wants it clear — and the disc says what that means, because the
 * sign is the ladder ART's own mirror flag. Cel 1100, the ladder these levels
 * paint, is a pole with rungs sticking out to ONE side and a yellow grip on the
 * end of each; across the eight ladders that use it the correlation is exact:
 *
 * ```
 *   STREETS  +35   1100 x3,  unmirrored     TOWER  -35   1100 x6, MIRRORED
 *   TOWER    +35   1100 x10, unmirrored     TOWER  -35   1100 x7, MIRRORED
 *   SEWER    +35   1100 x6,  unmirrored     SEWER  -35   1100 x5, MIRRORED
 *   SEWER    +35   1100 x5,  unmirrored
 * ```
 *
 * So `+35` is the ladder whose rungs point EAST, and the player stands east of the
 * pole with their hands on the yellow — which is facing LEFT. `-35` is the same
 * ladder mirrored and every part of that inverts. The record's `pointX` is already
 * on the yellow (STREETS' 9714 against rungs that end at 9721), so the grip lands
 * where it belongs as soon as the facing is right.
 *
 * ## Why the top of the climb was 122 pixels too high
 *
 * Because a ladder rect is in ANCHOR space, and this page's `p.y` is the feet.
 *
 * STREETS' ladder is `(732, 9632, 1223, 9779)` and the roof beside its top is
 * y854. Clamping the FEET to 732 leaves the player standing in the air, a fact
 * which is entirely this page's doing: the engine's `y` is the object's anchor, and
 * a climb cel's anchor is up at the hands. Cel 405 carries a collision box
 * reaching `y1 96` — the feet, 96px BELOW the anchor — so rung 0 puts them at 828,
 * which is the roof. The bottom rung, 14, puts them at 1318 against a street floor
 * of 1346. A ladder reaches exactly from the ground to the roof, and it only does
 * that when the rect is read as the engine reads it.
 *
 * So the rung is kept in anchor space, the feet follow from the resting cel's own
 * box, and the climb cels are drawn by their anchors like every other cel in the
 * game.
 */
export const LADDER = {
  /** how many engine frames one rung takes — one tag of {@link ANIM.climb} */
  rungFrames: 4,
  /** the cel a ladder holds you on, and whose box says where the feet are */
  /** character 0's; character 1 rests on 5405 — {@link PlayerKit.restCel} */
  get restCel(): number {
    return KIT.restCel;
  },
  from: "0x42ae50 / 0x471e78 / the ladder records' own param",
};

/**
 * The monkeybar — the one of the five regions `0x412390` sorts the player's
 * point into that had nothing on this page's side at all.
 *
 * ## Getting on is the ladder's reach and a different test
 *
 * `0x42edd0(0, 1)` is the W reach, gated on W itself at `0x4297f0` in the idle
 * state and at `0x429f1f` in the jump state. It asks the chapter's classifier
 * `[0x4abe00]`, and `0x412390` tries five names in a fixed order: `ladder`
 * answers 4, `exitfarm` 1, `exitroom` 2, **`monkeybar` 3** and `initswitch` 5.
 * A bar is only ever found where no ladder and no exit is, which is the order
 * {@link barAt} is asked in.
 *
 * The test is not the ladder's. A ladder is `0x40b660` geometry **1**,
 * `0x434140` — the current cel's whole bitmap against the rect. A monkeybar is
 * geometry **0**, `0x434200` — the player's own ANCHOR POINT inside the rect
 * and nothing else. VAT's rect is `y 1779..1899`, 120 rows of air above the
 * floor, so the anchor has to be up there already: you jump to a bar, you
 * cannot walk into one.
 *
 * ## Installing the script IS the state
 *
 * `0x42ef11` is four things — `0x42f850(player, 0)` to take gravity off, the
 * anchor to the record's own `top`, `0x45d090(player, 0x472048, 0)`, and return
 * 1 so the calling state ends its tick. Nothing there assigns a state number,
 * because `0x45d090` already has: it copies the script's KIND into `obj+0x18`,
 * and `0x472048` is kind 8. Hanging IS state 8, and `0x42b410` is its handler.
 *
 * ## A hold is a number, the way a rung is
 *
 * `0x42b410` opens every frame by zeroing both velocities, putting the anchor
 * back on the record's `top` and clamping x into `left..right`, and only then
 * dispatches the five tags of `0x472048` on `obj+0x44`. What ends a swing is
 * not a distance but the TAG: `0x42b5e5` waits for `obj+0x46`, and then
 *
 * ```
 *   n = (x - left) / param        ...and + 1 when obj+0x28 is clear
 *   x = n * param + left
 * ```
 *
 * — the same "a number times a spacing, and nothing in between" the ladder is
 * built out of ({@link LADDER}). The `+1` on one facing and not the other is
 * what makes it symmetric rather than lopsided: the swing carries 10 pixels an
 * engine frame either way, and truncation already rounds the westward one past
 * the hold below where the eastward one is still short of the hold above.
 *
 * **One record ships**, VAT's: `param 65, top 1779, left 5908, right 6617` —
 * eleven holds across 709 pixels, two of them to a swing.
 *
 * ## Tags 3 and 4 are a chin-up, and nothing else
 *
 * `0x42b7ff` holds the last cel while W is down and installs tag 4 when it
 * comes up; `0x42b827` goes back to tag 0 when that ends. Neither touches x,
 * the hold, or y — the preamble puts the anchor back on the bar regardless. It
 * is a flourish, and it is here because W does nothing else while hanging.
 *
 * ## Letting go
 *
 * S or J, `0x42b522`, **and only from tag 0** — the four other arms never test
 * for it, so a swing cannot be abandoned half way. Gravity goes back to 1 and
 * `0x471b28` tag 0 goes in: the plain fall, with no hop and no velocity, which
 * is not at all how the ladder leaves ({@link canLetGo}).
 */
export const MONKEYBAR = {
  /** engine frames one swing takes: six records of `0x472048` at two each */
  handFrames: 12,
  /** and the chin-up's three */
  pullFrames: 6,
  /**
   * `0x42b5b7` and `0x42b5d8` going out, `0x42b6e5` and `0x42b704` coming back,
   * and the bank is the ladder's own two — one hand, then the other.
   *
   * The index is the SCRIPT's, which runs across the whole of `0x472048` rather
   * than from the start of the tag: tag 1 is frames 1..6 and tag 2 is 7..12, so
   * these are the third and sixth cel of the swing out and the first and fourth
   * of the swing back.
   */
  soundAt: {
    1: [
      { frame: 3, own: OWN.rung[1] },
      { frame: 6, own: OWN.rung[0] },
    ],
    2: [
      { frame: 7, own: OWN.rung[1] },
      { frame: 10, own: OWN.rung[0] },
    ],
  } as Record<number, readonly { frame: number; own: number }[]>,
  /** where each tag starts in `0x472048`, so that index can be the script's */
  tagStart: { 0: 0, 1: 1, 2: 7, 3: 13, 4: 16 } as Record<number, number>,
  from: "0x42b410 / 0x42ef11 / 0x472048 / VAT's one record",
};
/**
 * `[0x46b1bc]` — knocked off. A blow that lands on a player on a ladder or a
 * bar sets it in place of a reaction (`0x42ea26`, `0x42ea9c`, `0x42ed90`,
 * `0x42f363`; character 1's `0x448f6e`, `0x44929e`, `0x4497e3`), and the ladder
 * state reads it as it reads forward, backward and J (`0x42ae6f`): at the end
 * of the rung he hops off. Only the ladder's leave clears it (`0x42aea1`) and
 * nothing resets it — the bar never reads it, so a blow taken on the bar is
 * spent on the next ladder he climbs.
 */
export let knockedOff = false;

/**
 * `0x471e78` or `0x472048` — on a ladder or a bar, the two scripts each of the
 * player's blow handlers asks after before it reacts (`0x42e99d`, `0x42ea3c`,
 * `0x42ebb1`)
 */
export function hanging(): boolean {
  return p.climbing || !!p.bar;
}

/** `0x40b940(2, anchor)` answering a room — what the knocks off a ladder ask */
export function roomHolds(): boolean {
  const y = p.climbing ? p.climbY : p.y - p.feet;
  return !!level?.rooms.some((r) => p.x >= r.left && p.x <= r.right && y >= r.top && y <= r.bottom);
}

/**
 * How far the player travels per animation cel: `MEASURED.walk / DIVISOR` = 8px.
 *
 * The engine holds each walk cel for one tick and moves 8px in that tick, so a
 * cel is worth exactly 8px of ground and the twelve-frame cycle covers 96. Tying
 * the animation to DISTANCE rather than to a clock keeps that true whatever this
 * page's frame rate is, and it is what stops the feet sliding: on a timer, the
 * cycle and the stride drift apart and the walk reads as a shuffle.
 */
// ...and they are functions rather than constants because the character can
// change under them: character 1 walks at 105 and runs at 200
export const stridePx = (): number => MEASURED.walk / DIVISOR;
/** the same for the run: dx 180 over one frame, so 15px of ground a cel */
export const runStridePx = (): number => MEASURED.run / DIVISOR;
/** and the crawl: dx 47, so 3.9px of ground a cel */
export const crawlStridePx = (): number => MEASURED.crawl / DIVISOR;
/** `0x471c68`'s `ticksPerFrame` — engine frames each airborne cel is held */
export const AIR_HOLD = 4;
/** `0x471648`'s — engine frames each idle cel is held */
export const IDLE_HOLD = 2;

/** the other modules' writes into this one's state — ES imports are read-only */
export function setKnockedOff(v: typeof knockedOff): void {
  knockedOff = v;
}
