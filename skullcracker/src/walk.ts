/**
 * Walk a Skull Cracker level — the reconstruction, not the game.
 *
 * Everything DRAWN here is the disc's: the backdrop placements at their stored
 * depths, the ground rasterised the way `SC.EXE` rasterises it (per-column
 * heights interpolated between the region polyline's points — its `0x40ba70`,
 * reimplemented in {@link rasterise}), the player's own cels. What the disc does
 * not contain is how it MOVES, and every number of that kind lives in
 * {@link INVENTED}, named, in one place. The game's executable has the real
 * values; until someone reads them out, these are this port's, and the page
 * says so.
 *
 * ## What walking is, in this data
 *
 * A level is a set of ROOMS, and that is the file's own structure rather than
 * this port's: `readRooms` in the engine has the binding and the evidence. Each
 * room owns one region, that region rasterises to a height map — for every x
 * column, the y of the floor — and the player is in exactly one room at a time.
 * They are a point (x, on-the-ground-at-x) with a facing and a gait; arrows move
 * x, their own room's ground supplies y, the camera follows, and each placement
 * scrolls at the ENGINE's own rate — `placementRate`, recovered from SC.EXE's
 * draw path: `(x − centre) · k/6000 + centre`, horizontal only, with most of the
 * art on rate-1 planes so it aligns exactly as stored.
 *
 * Walking into an `exitroom` rect moves you to the room its param names and puts
 * you beside the door back. That replaced an earlier guess — "of the regions
 * under you, take the floor nearest your feet" — which happened to keep STREETS'
 * street and basement apart and had no basis in the file. The rooms were in the
 * file all along.
 *
 * It can leave the floor. `platform` is the commonest object in the game and
 * `SC.EXE` says what one is — a rect that carries whatever stands on it — so
 * every platform's top edge is a ledge here, `obstacle` is solid, and a `ladder`
 * is climbed. What the executable does NOT say, anywhere in the platform path,
 * is how fast anything falls: gravity and the jump's shape are in INVENTED with
 * the rest of the guesses. The climb is not among them any more — a ladder is
 * counted in rungs of the record's own 35 pixels ({@link LADDER}).
 *
 * That matters most for CITY, whose ground is a ledge from x271 to x691 and then
 * y = 7250 for the rest of the level, 2900px below anything it draws. CITY has 73
 * platforms, 20 planks and 5 elevators, the most in the game. Its ground is the
 * fall, and the platforms are the level.
 *
 * The elevators are how the top of it is entered at all. CITY places no `ladder`,
 * its goal sits at y1802, and the walk east tops out around y3590: without the
 * five cars 45 of its 73 platforms are reachable and the goal is not one of them,
 * and with them all 73 are. Each owns its landing and carries the record upward,
 * which is the same mechanism a falling plank uses to take its floor down —
 * `0x42fcb9`, and {@link file://./props.ts} has both.
 */
import {
  readSbkFile,
  SbkCel,
  SbkEntity,
  SbkFile,
  SbkRoom,
  LEVEL_ORDER,
  PLANE_Z,
  PLAY_PLANE_Z,
  arrivalIn,
  placementRate,
  readRooms,
} from "@dreamfactory/engine/df/sbk";
import { decodeShpFrame, ShpFrame } from "@dreamfactory/engine/df/shp";
import { paletteToRGBA } from "@dreamfactory/engine/df/image";
import { readMovFile } from "@dreamfactory/engine/df/mov";
import { indexedToRGBA } from "@dreamfactory/engine/df/image";
import { AudioSink, DeferredAudioSink, WebAudioSink } from "@dreamfactory/engine/runtime/audio";
import { focusOwnsKey } from "@dreamfactory/engine/web/keys";
import { SkullFiles } from "./files";
import { Film } from "./film";
import { CORPSE_LINGER, FOES, FoeAnim, celAt, loopIndex, type Foe } from "./foes";
import { CRAFT, Gob, Pop, SPRAY, VANISH, dryTime, gobCount, scatter } from "./effects";
import { FOE_SFX, OWN, REACH, Sounds } from "./sound";
import {
  CROW,
  Crow,
  ELEVATOR,
  Elevator,
  IBEAM,
  CRUSH,
  Ibeam,
  Crush,
  Feather,
  PLANK,
  Plank,
  crowCel,
  crowFrames,
  elevatorCel,
  elevatorFrames,
  ibeamCel,
  crushCel,
  ibeamFrames,
  crushFrames,
  plankCel,
  plankFrames,
  PICKUP,
  Pickup,
  SPRINKLER,
  Sprinkler,
  SHACK,
  Shack,
  shackCel,
  shackFrames,
  BARREL,
  Barrel,
  PIPE,
  Pipe,
  SEWAGE,
  Sewage,
  BUSH,
  Bush,
  ROACH,
  Nest2,
  Roach,
  DOOR,
  Door,
  doorCel,
  doorFrames,
  ELEV,
  Elev,
  SWITCH,
  Switch,
  switchCel,
  switchFrames,
  GOOP,
  Nest,
  Drip,
  dripCel,
  dripFrames,
  HOLE,
  Hole,
  HAND,
  Hand,
  AXE,
  Axe,
  BRIDGE,
  Bridge,
  FLOOR,
  Floor,
  SURGE,
  Surge,
  CAGE,
  Cage,
  ALARM,
  Alarm,
  FAN,
  Fan,
  BELT,
  Belt,
  CHAIR,
  Chair,
  CLAW,
  Claw,
  FITTING,
  Fitting,
  BOGGS,
  Boggs,
} from "./props";
import { DEATH_FILMS, MISSIONS, PIT_DEPTH, TIME_OUT_FILMS, allowanceFor, type Mission } from "./mission";
import { CHAPTER_WEAPON, FLARE, GRAB, GUN_CODES, WEAPONS, type Flare, type Gun } from "./guns";
import { BLOW_CODES, HELD, gripOf } from "./codes";
import {
  CEL,
  CLOCK,
  CLOCK_FULL,
  HudFighter,
  WINDOW,
  buttonBit,
  paintHud,
} from "./hud";

/**
 * The numbers the disc does not carry. Change them here or nowhere.
 *
 * `walkPx` per tick at `tickMs` gives the stride; `animMs` is how long each
 * walk cel is held; `mirrorLeft` says the right-facing cels are flipped for
 * leftward walking rather than a left-facing set being used. All four are this
 * port's inventions, pending their recovery from SC.EXE.
 */
/**
 * The engine's own motion units, read out of `SC.EXE`.
 *
 * Skull Cracker has no velocity and no gravity constant. Movement is authored
 * PER ANIMATION FRAME: every frame of every animation script in `.data` carries
 * a `(dx, dy)` pair, and `0x42f8b0` applies it each tick as
 * `x += round_away(dx / obj[+0xe])`, `dx` negated when the object faces left.
 * The scripts are `{i16 count, i16 ticksPerFrame, i16 kind}` followed by `count`
 * entries of `{i16 tag, i16 celId, i16 dx, i16 dy}`, installed by `0x45d090`,
 * which seeks to the first frame carrying the tag it is asked for.
 *
 * Four characters' scripts (the player's at `0x470f98`, and `0x470a78`,
 * `0x470c40`, `0x471260`) carry the same three numbers, and one more script pair
 * at `0x471920`/`0x471988` gives the first character's walk and run outright:
 *
 * ```
 *   walk          dx  95        twelve cels, one tick each
 *   run           dx 180        twelve cels
 *   jump      dy -420           ONE frame, dx 0 standing or 95 running
 * ```
 *
 * Nothing about the scale is missing any more. The scripts themselves are in
 * `.data` and each carries its own header, so the rate is in the file too:
 *
 * ```
 *   0x471920  count 12  ticksPerFrame 1  kind  1   cels 100..111  dx  95   walk
 *   0x471988  count 30  ticksPerFrame 1  kind  2   cels 150..161  dx 180   run
 *   0x471c68  count  4  ticksPerFrame 4  kind  3   251 252 251 250         in the air
 *   0x471e78  count 20  ticksPerFrame 1  kind  7   cels 400..407           the ladder
 *   0x471c90  count 26  ticksPerFrame 1  kind  4   600s punch, 650s kick
 * ```
 *
 * `ticksPerFrame` is the header's second field and `0x45d0f0` counts it down at
 * `obj+0x48`, advancing the cel only when it reaches zero — so the walk changes
 * cel every frame and the airborne loop holds each of its four for four frames.
 * The dx is applied on EVERY call either way, which is what makes speed a
 * property of the frame rate alone and not of the animation's length.
 */
// launchDx is the WALKING launch (0x471b28 tag 3); a RUNNING jump is tag 4's
// single record `200(dx 180, dy -420)` and keeps the run's own 180
const MEASURED = { walk: 95, run: 180, jump: 420, rise: 125, launchDx: 100, runJumpDx: 180, crawl: 47, flyKickDx: 190, flyKickDy: 310, hopDx: 120, hopDy: 210 };
/**
 * Where a lift car's cel hangs off its deck: cel 1160 is 133x108 with its anchor
 * 51 rows down, and the anchor is the object's own position, so the art is drawn
 * from `y - 51` and the deck is the landing platform's own top edge.
 */
const ELEVATOR_ANCHOR_Y = 51;

/**
 * The player's gravity in the engine's OWN units: `0x42f850(player, 1.0f)` stores
 * `f * 10.0` into `obj+0x24` (the float at `0x46a110` — read as 100.0 for a long
 * time, wrongly), and `0x430327` adds it to `obj+0xa` once a frame.
 * Raw, undivided — the division happens in the mover, once, per frame.
 */
const GRAVITY_RAW = 100; // kept for the objects that still integrate raw (planks, gobs)

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
const PLAYER_GRAVITY = 10;
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
const AIR_SPEED = 30;
const AIR_TURN = 10;

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
const DRAG = 5734;
const DRAG_ONE = 8192;
function dragged(v: number): number {
  if (v === 0) return 0;
  let off = Math.trunc((v * DRAG) / DRAG_ONE);
  if (off === 0) off = Math.sign(v);
  return v - off;
}

/**
 * Divide the way `0x42f8b0` divides: round AWAY from zero.
 *
 * This is the whole of the jump's shape and it took far too long to notice. The
 * mover does not move an object by a fraction of a pixel — it does an `idiv` with
 * an explicit away-from-zero adjustment (`sub ax,cx; inc ax` when negative,
 * `lea eax,[ecx+eax-1]` when positive) and adds a WHOLE number of pixels. So every
 * frame's step has its magnitude rounded UP, and over a jump that compounds:
 * stepping `-420` by hand at the player's divisor of 12 gives moves of
 * `-35 -27 -19 -10 -2` — an apex of 93px where the same numbers integrated as
 * floats give 73.5. The port had been integrating as floats.
 */
function roundAway(v: number): number {
  return v < 0 ? -Math.ceil(-v) : Math.ceil(v);
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
function steerAir(): void {
  // `0x402be0` names the two flags by swapping them on the facing: `0x4ac3d2` is
  // FORWARD held and `0x4ac38c` is BACKWARD held. This is the forward branch,
  // `0x429fef`; the caller has already done backward's turn-and-zero
  if (p.facing > 0 && p.vx < 0) p.vx += AIR_TURN;
  else if (p.facing < 0 && p.vx > 0) p.vx -= AIR_TURN;
  else p.vx = p.facing * AIR_SPEED;
}

function engineFrame(): void {
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
const DIVISOR = 12;
/**
 * The engine's frame rate: **15 per second**, measured.
 *
 * `0x4087c0` reads the clock and returns `ms * 3 / 50`, which is units of 1/60s.
 * `0x40e4f0` then spins — `lea ecx, [esi + 4]; cmp eax, ecx; jl` — until four of
 * those units have passed since the last frame, and `0x40dfd0`, which calls it,
 * is called from **all sixteen level frame functions** (STREETS' `0x44dc10` at
 * +614). Four sixtieths is a fifteenth: a frame is 1/15s.
 *
 * That is the number everything else was missing. The animation stepper advances
 * one cel per frame, so every animation in the game plays at 15fps — this page
 * had been running them at 34, which is why the punch was a blur. And it turns
 * {@link MEASURED}'s per-frame pixels into pixels per SECOND at last: the walk's
 * 8 a frame settles against the ground's drag at 12 — 180 a second — the run's
 * 15 at 22 (330), and the launch leaves the ground at 35 in one frame.
 */
const ENGINE_HZ = 15;

/**
 * There is no jump scale any more, and the history of the one there was is worth
 * a paragraph. `JUMP_SCALE = 1.2` was a deliberate 20% boost on the launch, added
 * because the float-integrated jump "played low" — and then found to be
 * load-bearing: at 1.0 the port could not clear CITY's first wall. It was
 * compensating for two misreadings at once. Gravity was taken as `100/12` when
 * `0x46a110` is 10.0 and `obj+0x24` is simply 10; and the airborne horizontal was
 * taken as the run speed when tag 5's frames carry `dx 0` and `0x429fef` drives
 * `obj+0xc` to 30. With the engine's own integer velocity model in place the disc's
 * numbers clear everything they should at exactly 1.0, and the dial is deleted
 * rather than parked, so that nothing can quietly lean on it again.
 */

const INVENTED = {
  tickMs: 1000 / 60,
  /**
   * There is no walk or run speed here any more. The walk's `dx 95` and the run's
   * `dx 180` are IMPULSES into `obj+0xc` — `round_away(dx/12)`, 8 and 15, once a
   * frame through `0x42f8b0` — and the ground's drag ({@link dragged}) is what
   * turns them into a speed: 12 and 22 pixels a frame, 180 and 330 a second. The
   * two getters that stood here gave 8 and 15 a frame flat, on the belief that
   * nothing cancelled `obj+0xc` between frames, and the walk ran a third slow.
   */
  /**
   * The extra lift while W is held, and it is the engine's own number:
   * `0x429f00` builds the dword `0xff83` — −125 — and hands it to `0x42f8b0`,
   * once per frame, for as long as the allowance at `0x4723f0` lasts. 125/12 is
   * 10.4px a frame.
   *
   * The climb used to borrow it, on the reading that a ladder is this same lift
   * with the allowance refreshed. It is not: the ladder state moves nobody by a
   * speed at all — see {@link LADDER} — and 35 pixels a tag is the file's.
   */
  get risePx(): number {
    return roundAway(MEASURED.rise / DIVISOR) * TICK_SCALE;
  },
  /** how fast backdrop animations (the lamp glow, the strobing sign) cycle —
   *  the frames are the disc's, this cadence is this port's, untraced */
  bgAnimMs: 120,
  /**
   * Gravity — and it is the executable's after all, which is the correction this
   * comment exists to make.
   *
   * It was hunted in the wrong place. Every animation script in the binary was
   * enumerated and filtered for a nonzero `dy` — all 50-odd of them — and the
   * player's cel ranges yield exactly one record with any vertical motion at all,
   * the launch (`0x470f98` kind 18, `c1261(dx 0, dy -420)` standing and
   * `(dx 95, dy -420)` running; the armed variants carry the same -420 and the
   * second character's `0x475130` carries -500). True, and beside the point: the
   * fall is not in a script, it is a FIELD, and the mover adds it.
   *
   * ```
   *   0x402784  0x42f850(player, 1.0f)     ; where the player is placed
   *   0x42f850  obj+0x24 = trunc(f * 10.0) ; 0x46a110 is 10.0 — so the player's is 10
   *   0x430327  if (!landed) obj+0xa = obj+0x24 + <this frame's vy>
   * ```
   *
   * `obj+0xa` is a velocity in the RAW units every script uses, divided by the
   * class's own `obj+0xe` when it moves the object (`0x42f8b0`) — the player's is
   * 12 — but `obj+0xa` is never divided: the stepper adds it to the position as it
   * is. So the player accelerates downward by **10 pixels a frame²** (the 8.33
   * this once said came from misreading `0x46a110` as 100.0 and then dividing),
   * and the whole engine's gravity is one float per object: a falling plank's is
   * `0x42f850(obj, 3.0f)` — three times the player's — and a thing that should not
   * fall gets 0.
   *
   * At this page's tick that is `8.33 × 0.25² = 0.52`, and what makes the find
   * worth the correction is that the number below was already **0.524**: measured
   * off a screen capture of the original, a year of reading later, and right.
   * The two derivations are independent and they agree to three decimals.
   *
   * The measurement, kept because it is what checked the reading: The engine's camera follows the player vertically and the draw
   * transform is `screenX = (x − camX)·rate + W/2` with y plain — no vertical
   * parallax on any plane — so the background's vertical shift between frames IS
   * the player's, exactly, for every layer at once. Cross-correlating each
   * frame's row profile against the previous one gives the whole trajectory in
   * game pixels, and `dx` came out 0 on every frame, which is the standing jump's
   * own tag (dx 0) confirming what was measured:
   *
   * ```
   *   193ms  +20      451ms  +68
   *   290ms  +40      483ms  +71   <- apex
   *   354ms  +57      580ms  +57
   * ```
   *
   * **The apex is 73px**, reached at 483ms, and the player is back down by 741ms.
   * That number was then checked against a SECOND layer, because a global row
   * correlation averages every plane at once and the first attempt at this drifted
   * badly: a local template match of a patch of the billboard (a near layer, and
   * the plane the player stands on) and one of the city skyline (far) return
   * *identical* dy on every frame, to the pixel. There is no vertical parallax,
   * so the camera's rise is the player's rise, and 73px is the jump.
   *
   * With the launch fixed at the file's own 35px a frame — 8.75 a tick — an apex
   * of 73 means `g = 8.75² / (2 × 73)` = **0.524**, which is `100/12` a frame²
   * within a third of a percent.
   *
   * One thing the code says that the capture could not: the engine steps this
   * ONCE A FRAME, so its rise is a sum of five terms and not an integral —
   * 35 + 26.7 + 18.3 + 10 + 1.7 = **91.7px**, and 112.5 with the lift's two
   * frames on top. The capture's 73px apex is the same jump seen through a camera
   * that cannot show the first frame's full 35 pixels. So the original clears
   * CITY's 101-pixel wall with eleven pixels to spare, which is the check that
   * says this reading of the level is right too.
   *
   * (Historical: this paragraph once argued for tuning height at the launch and
   * leaving gravity alone, because `apex = v²/2g` and `T = 2v/g` couple them. The
   * argument was sound and the premise was not — there is nothing to tune now that
   * the player's gravity is read as 10 and integrated as the engine does.)
   *
   * The old 0.2 hung the player in the air for 1.46 SECONDS with a 191px apex,
   * which is why it read as flying; it is 69px and 525ms now, and the engine's
   * own vertical rate constant (10.4px a frame², 0.65 a tick²) sits just above
   * the answer rather than being it.
   */
  /**
   * 0.524 px a tick^2 is `8.33 / 16`: the OLD reading of the player's gravity as
   * `100/12` per engine frame, scaled to sixty ticks. That reading was wrong —
   * `0x46a110` is 10.0, not 100.0, so the player's `obj+0x24` is 10 and the
   * player now integrates in whole pixels through {@link engineFrame}. This
   * value is kept ONLY for the things that still fall as floats here — gobs,
   * feathers, a dying crow, the enemies' knockback — each of which has its own
   * `0x42f850(obj, f)` and deserves the same reading before it is trusted.
   */
  gravityPx: 0.524,
  maxFallPx: 12,
  /*
   * There was a `slidePx: 0.7` here — "how fast the ground drags a sliding thing
   * to a stop", invented because nothing found in `SC.EXE` cancelled a knocked
   * object's velocity, and calibrated against a kicked mailbox crossing about a
   * screen. The allocator does: every object is born with `obj+0x1e = 5734`
   * and the body stepper takes 5734/8192 of `obj+0xc` off it every grounded
   * frame — see {@link dragged}. That the invented number came out at 0.7 is the
   * calibration having found 5734/8192 = 0.6999 by eye.
   */
  /*
   * There was a `stepPx: 26` here — "how far the feet follow the floor without
   * leaving it" — invented because STREETS' floor rises and falls by up to 24px
   * between adjacent columns. The engine has both halves of it as literals, and
   * they are not the same number: see {@link CLIMB_PX} and {@link STICK_PX}.
   */
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
const CLIMB_PX = 50;
/**
 * **8 pixels, and a floor further below than that is not underfoot.** The same
 * stepper's landing test, `0x42ff56`: `floor - 8 <= newY` is what makes the feet
 * stick, so walking off anything with more than 8 pixels of air under it puts the
 * player in the air for the frame it takes to fall the rest.
 */
const STICK_PX = 8;


/**
 * Which cels are which — `SC.EXE`'s own table, not a guess any more.
 *
 * The engine's animation scripts live in `.data` (see {@link MEASURED} for the
 * format and how they move things). Each is `{count, ticksPerFrame, kind}` and
 * `count` entries of `{tag, celId, dx, dy}`, and the player's are:
 *
 * ```
 *   0x471b18  kind 13   cel 1, held 12 ticks        the state a level starts in
 *   0x471920  kind  1   cels 100..111, dx  95       the walk
 *   0x471988  kind  2   cels 150..161, dx 180       the run
 *   0x471648  kind  0   cels 1..8 punch, 10..25     the attacks and the fidget
 * ```
 *
 * The level's own init settles which of them the player wears: after building
 * the player at `0x42f550`, `0x42e46d` calls `0x42f840(player, 13)`, and kind 13
 * is the single unarmed standing cel. The other cel ranges in `PLAYER.SBK` —
 * 1200s, 2700s, 3200s, 3300s — are the SAME man holding the blaster, the
 * flamer, the soaker and the scepter, each with a complete script of its own;
 * 7700s and 8300s are the second character, whose walk is 105 and run 200.
 *
 * Two things this corrects, both of which had been guessed by looking at cel
 * runs and both of which were wrong:
 *
 * - **the walk was not 650..655.** The engine's script for those cels is
 *   `650 651 652 653(+95) 654(+95) 655(+95) 654(-95) 653(-95) 652 651` — it goes
 *   out and comes back, so it is a lunge or a swing. The walk is 100..111, and
 *   it is twelve frames rather than six.
 * - **the player IS mirrored.** The old table paired 660..665 with 650..655 as
 *   "the disc carries both facings". It does not: there is one set of cels, and
 *   the engine flips them, which is exactly what `0x45d0f0` does to the frame's
 *   own `dx` when `obj+0x28` says the other way.
 */
const ANIM = {
  /**
   * `0x471648` kind 0 tag 0, at its own `ticksPerFrame` of **2** — the idle, and
   * it is an ANIMATION rather than the single cel this used to be. Fourteen
   * frames out and back, `1 2 3 4 5 6 7 8` then `7 6 5 4 3 2`, held two frames
   * each: 1.87s of breathing on a loop. The walk state installs it whenever no
   * direction is held (`0x429acc`), so it is what the player does when the keys
   * are quiet, and standing on cel 1 forever was simply missing it.
   *
   * The same script carries two more idles that this page cannot reach yet, and
   * they are worth writing down because they are gated on HEALTH: `0x429690`
   * compares `[0x4ac3d0]` against `[0x4ac3d8]` and installs tag 4 (`20 21 22 21`)
   * once the player is at or below half, which is a hurt man's idle. Damage is
   * still parked, so nothing here can drop below full.
   */
  idle: [1, 2, 3, 4, 5, 6, 7, 8, 7, 6, 5, 4, 3, 2],
  /** kind 1 (`0x471920`) — twelve cels, one engine tick each, dx 95 */
  walk: [100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111],
  /**
   * kind 2 (`0x471988`) — twelve cels, dx 180, so 15 a frame into the velocity and 330px a
   * second. This is the game's real travelling speed and it is a HELD key: see
   * {@link KEYS}, where W turns out to be the run rather than "up".
   *
   * The script's later tags are the exits from it — tag 1 is the same twelve
   * cels with dx 0 (running in place, which is what a run against a wall looks
   * like), tag 2 is `106 107 108` at dx 95 (the run decaying back into the
   * walk), and tag 3 is cel 921 three times. Only tag 0 is used here.
   */
  run: [150, 151, 152, 153, 154, 155, 156, 157, 158, 159, 160, 161],
  /**
   * `0x471b28` kind 3, tags 2 and 3 — the launch, and where the crouch lives.
   *
   * ```
   *   tag 2   250 251 252 253(dx   0, dy -420)   standing
   *   tag 3   250 251 252 253(dx 100, dy -420)   running
   * ```
   *
   * Four frames at `ticksPerFrame` 1, and **the impulse is on the LAST of them**:
   * the original crouches through 250, 251 and 252 — three frames, 200ms — and
   * only then leaves the ground.
   *
   * The RUN state does not wind up at all: `0x429b80` installs tag 4, a single
   * record `200(dx 180, dy -420)` — an instant leap in the tuck, carrying the
   * run's own 180.
   *
   * This page plays the four cels but keeps its instant impulse, so the crouch is
   * the opening of the flight rather than a commitment before it. The faithful
   * version costs 200ms of standing still before every jump AND takes the
   * horizontal with it — those three frames carry `dx 0`, so the run does not
   * carry through the wind-up — which changes how a gap is crossed, not just how
   * it looks.
   */
  launch: [250, 251, 252, 253],
  /**
   * `0x471b28` tag 0 — the TUCK, cels `200 220` (94x129 and 82x127 against the
   * 145 standing): knees drawn up and forward. The kind-3 handler's dispatch
   * table (`0x42a3d4`) sends the launch tags 2/3/4 to `0x42a1c2`, which installs
   * tag 0 — so the pose held in FLIGHT is this, not the 251/252 flail. The flail
   * is the deep-fall pose: `0x42a109` compares `[player+0x32]` against 0x168 and
   * only a fall past 360 gets `0x471c68`'s slow loop (plus sound 10 through
   * `0x402ac0`). The legs-forward jump is the tuck, and this page used to skip
   * it entirely.
   */
  tuck: [200, 220],
  /**
   * The CROUCH, and it exists — reading only the unarmed handlers said it did
   * not, and that was the misread. `[player+0x18]` is the animation KIND,
   * dispatched through the 28-entry table at `0x429570`, and each kind handler
   * re-dispatches on the running script's current TAG (`[player+0x44]`). The
   * unarmed standing handler (kind 0, `0x429690`) really has no duck. The ARMED
   * ones all do, symmetrically:
   *
   * ```
   *   42b8ae  cmp [0x4ac3fc], 0          ; S held?          (1200s, blaster)
   *           push 5; push 0x471128      ; -> cel 1220, then 1222..1225 settled
   *   42cc03  cmp [0x4ac3fc], 0          ;                  (2700s)
   *           push 4; push 0x470a78      ; -> cel 2730, 2732 settled
   *   42c23f  tag 5 of 0x4713f8          ;                  (3200s) -> cel 3240
   * ```
   *
   * The settled crouch cels are ~116 tall against 145 standing. Jumping OUT of
   * the duck is real too: `0x42b90b`, J while ducked, installs tag 12 — `1260
   * 1261(0,-420)`, a launch from the knees.
   *
   * And the UNARMED duck is real too, one indirection further: the kind-15
   * standing handler's no-weapon branch reads S at `0x4289ea` and installs
   * `0x4717c8` tag 1 — cel **703**, one knee down, fists up, 116 tall against
   * the 145 standing. Installing a script sets the player's kind from the
   * script's own header (`0x4717c8` is kind 6), and kind 6's handler
   * (`0x42a9a0`) is a whole crouch STATE MACHINE:
   *
   * ```
   *   S held            tag 1   703            the duck, held
   *   (13 in 707 roll)  tag 2   704..707       the settle fidget
   *   S + A/D           tag 4   1000..1004     the CRAWL, dx 47 — 59px/s
   *   S + P             tags 5,6/7  710, 711..716   the duck-punch
   *   S + K             tags 8,9    720, 721..724   the duck-kick
   *   S + P + K         0x471d68 tag 6  630..632    the duck combo
   * ```
   *
   * The collision box follows the drawn cel, so ducking genuinely shortens the
   * player.
   */
  crouch: [703],
  /** `0x4717c8` tag 2 — the duck's own fidget, rolled 13 in 707 per frame */
  crouchFidget: [704, 704, 705, 705, 706, 706, 707, 707, 706, 706, 707, 707],
  /** `0x4717c8` tag 4 — the crawl, five cels each carrying dx 47 */
  crawl: [1000, 1001, 1002, 1003, 1004],
  /**
   * The idle FIDGETS — `0x471648` tags 1 and 2, `1 3 4 5 7 6 4 2` and
   * `10 10 11 11 12 11 12 12 13`. At the end of each idle cycle `0x42993c`
   * rolls `0x434540(0x2a) < 13` and, 13 times in 42, plays `0x434540(2) + 1`:
   * one of these two, at the script's own two frames a cel.
   */
  fidgetA: [1, 3, 4, 5, 7, 6, 4, 2],
  fidgetB: [10, 10, 11, 11, 12, 11, 12, 12, 13],
  /**
   * `0x471c68`, the whole script: four records, all tag 5, `251 252 251 250` —
   * and a header whose `ticksPerFrame` is **4**, the only one of the player's
   * that is not 1. So the airborne loop runs at 3.75 cels a second while
   * everything else runs at 15, which is why it reads as a held pose rather than
   * a flutter. Every record's dx and dy is 0: the jump's motion is not in here.
   */
  /**
   * `0x471c68` — tag 5, `251 252 251 250` at FOUR frames a cel, and it is not an
   * airborne loop. `0x42a109` is in the tag-0 handler's GROUNDED branch: the frame
   * after a fall of more than 360 lands, this is installed for sixteen frames, with
   * sound 5 and ten health off through `0x402ac0`. The hard landing. In the air the
   * tuck holds all the way down. This page used to play it as a mid-air flail past
   * 360 pixels fallen, which is the same test read on the wrong side of the ground.
   */
  air: [251, 252, 251, 250],
  /**
   * `0x471b28` tag 1 — the LANDING, `251 252 251 250` at one frame a cel. Every
   * jump ends in it (`0x42a154`, with sound 4): four frames in which `0x42a182`
   * reads no key at all and the ground's drag is what slows the slide.
   */
  land: [251, 252, 251, 250],
  /**
   * kind 7 (`0x471e78`), the ladder — four tags of four cels, and one tag is one
   * RUNG. Tags 0 and 1 run 400…407 upward, tags 2 and 3 run them back down, and
   * the engine alternates between the two of each so the feet keep swapping. See
   * {@link LADDER} for what makes them move.
   */
  climb: [
    [400, 401, 402, 403],
    [404, 405, 406, 407],
    [407, 406, 405, 404],
    [403, 402, 401, 400],
  ] as const,
  /** tags 6 and 7 — one cel, held: hanging on a rung, going nowhere */
  hang: [405],
};

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
const LADDER = {
  /** how many engine frames one rung takes — one tag of {@link ANIM.climb} */
  rungFrames: 4,
  /** the cel a ladder holds you on, and whose box says where the feet are */
  restCel: 405,
  from: "0x42ae50 / 0x471e78 / the ladder records' own param",
};

/**
 * The two attacks — and the kick is a SEPARATE SCRIPT, which is the correction.
 *
 * The lower band reads JUMP / KICK / PUNCH / INV. and the keys are the initials,
 * J K P I. What each installs was read wrong here once: both attacks were taken
 * out of `0x471c90`, and K was given that script's tag 8 — `650 651 652 653(+95)
 * 654(+95) 655(+95) 654(-95) 653(-95) 652 651`, which goes out and comes back and
 * is a **headbutt**, not a kick. The walk state settles it in six instructions:
 *
 * ```
 *   429a1e  cmp word ptr [0x4ac394], 0    P -> 0x45d090(player, 0x471c90, 0)
 *   429a1e  cmp word ptr [0x4ac404], 0    K -> 0x45d090(player, 0x471d68, 0)
 * ```
 *
 * Two scripts, one each. Tag 0 of both is the same single cel 600 — the guard the
 * attack opens from — and then each button's own state machine picks what follows,
 * and BOTH of them pick a bigger version when W is held:
 *
 * ```
 *   punch  0x42a400  W held: tag 4 or 5 at random (0x434540(2) + 4)
 *                    P held: tag 2 or 3 at random (0x434540(2) + 2)
 *   kick   0x42a670  W held: tag 2      -> 740 741 742 743 744 745
 *                    K held: tag 1      -> 662 663
 *                    neither: tag 5     -> 663
 * ```
 *
 * So the attacks are randomised in the original — two variants each, chosen per
 * swing — and W is a modifier on them exactly as it is on everything else. This
 * page takes one variant of each and switches on W; the random pick is not
 * modelled, and tag 4 of `0x471d68` is not here either: that one is installed by
 * the RUN state (`0x429b80`) and carries `dx 190, dy -310`, which makes it a
 * flying kick.
 */
const ACTIONS: Readonly<Record<string, { cels: readonly number[]; dx: readonly number[]; hold?: number; from: string }>> = {
  // 0x471c90 tag 0 then tag 3 — the guard, then the jab
  punch: { cels: [600, 601, 602], dx: [0, 0, 0], from: "0x471c90 tags 0, 3" },
  // ...or tag 2, the other half of the coin `0x434540(2)` tosses
  punch2: { cels: [600, 604], dx: [0, 0], from: "0x471c90 tags 0, 2" },
  // ...and tags 4 and 5 with W held, which are the same toss one pair up
  punchRun: { cels: [600, 603, 604], dx: [0, 0, 0], from: "0x471c90 tags 0, 4" },
  punchRun2: { cels: [600, 620, 621, 622, 623], dx: [0, 0, 0, 0, 0], from: "0x471c90 tags 0, 5" },
  // 0x471d68 tag 0 then tag 1 — NOT 0x471c90's 650s, which is the headbutt
  kick: { cels: [600, 662, 663], dx: [0, 0, 0], from: "0x471d68 tags 0, 1" },
  // ...and tag 2 with W held: the six-frame kick
  kickRun: {
    cels: [600, 740, 741, 742, 743, 744, 745],
    dx: [0, 0, 0, 0, 0, 0, 0],
    from: "0x471d68 tags 0, 2",
  },
  /**
   * P and K TOGETHER — the idle handler checks the two flags jointly at
   * `0x429706` (`[0x4ac394] && [0x4ac404]`) before either alone, and installs
   * `0x471c90` tag 8: the 650s, out at 95 a frame and back at −95. So the
   * lunge this page once mistook for a walk and then for the kick is a combo
   * move, and this is its real trigger.
   */
  // `0x4717c8` tags 5 then 6 — S+P: the duck-punch, from the knee
  duckPunch: { cels: [710, 711, 712, 713, 714, 715, 716], dx: [0, 0, 0, 0, 0, 0, 0], from: "0x4717c8 tags 5, 6" },
  // tags 8 then 9 — S+K: the duck-kick, out and back
  duckKick: { cels: [720, 721, 722, 723, 724, 724, 722, 720], dx: [0, 0, 0, 0, 0, 0, 0, 0], from: "0x4717c8 tags 8, 9" },
  // S+P+K — the crouch machine reaches into the kick script for tag 6
  duckCombo: { cels: [630, 631, 632], dx: [0, 0, 0], from: "0x471d68 tag 6, from 0x42ab4a" },
  /**
   * What a blow does TO the player, and which one is which.
   *
   * `0x449115` is the whole of the choice: `cmp di, 0x3c`. Sixty or less is a
   * stagger out of `0x4766f0` and more is a knockdown out of `0x476890`, and each
   * has a front take and a back one picked by which side the hitter is on
   * (`0x44915c` for the knockdown, `0x44919e` for the stagger). Every record of
   * all four carries `dx 0 dy 0` — the throw is not in the script, it is the
   * velocity exchange `0x430470` does afterwards.
   */
  hurtFront: { cels: [5901, 5901, 5901], dx: [0, 0, 0], from: "0x4766f0 tag 1" },
  hurtBack: { cels: [5902, 5902, 5902], dx: [0, 0, 0], from: "0x4766f0 tag 2" },
  downFront: { cels: [5910, 5911, 5912, 5913, 5914, 5915, 5915, 5915, 5915], dx: [0, 0, 0, 0, 0, 0, 0, 0, 0], from: "0x476890 tag 0" },
  downBack: { cels: [5940, 5941, 5942, 5943, 5944, 5944, 5944], dx: [0, 0, 0, 0, 0, 0, 0], from: "0x476890 tag 2" },
  /** `0x476758` tag 0, kind 26 — two frames a cel, and the kind that IS being dead */
  dying: { cels: [5910, 5911, 5912, 5913, 5914, 5915], dx: [0, 0, 0, 0, 0, 0], hold: 2, from: "0x476758 tag 0" },
  /** `0x476220` tag 5 — four frames a cel, the roll out of a bad landing */
  landRoll: { cels: [5208, 5207, 5206], dx: [0, 0, 0], hold: 4, from: "0x476220 tag 5" },
  /**
   * The FLYING moves, and they are real — a legitimate question answered by
   * three installs:
   *
   * ```
   *   429db9  RUN + K       -> 0x471d68 tag 4: 684(dx 190, dy -310) 685..688
   *   42a036  airborne + K  -> 0x471b28 tag 8: 687 688 688 689
   *   42a082  airborne + P  -> 0x471b28 tag 9: 604 604 689
   * ```
   *
   * The flying kick's first record carries its own LEAP — 190 forward, 310 up,
   * about 74%% of a jump — so kicking out of a run leaves the ground. The two
   * airborne moves are poses struck mid-flight; the air punch holds the big
   * punch cel. (Running + P goes through the punch's own machine, which is the
   * punchRun pair above.)
   */
  flyingKick: { cels: [684, 685, 686, 687, 688], dx: [190, 0, 0, 0, 0], from: "0x471d68 tag 4, from 0x429db9" },
  airKick: { cels: [687, 688, 688, 689], dx: [0, 0, 0, 0], from: "0x471b28 tag 8, from 0x42a036" },
  airPunch: { cels: [604, 604, 689], dx: [0, 0, 0], from: "0x471b28 tag 9, from 0x42a082" },
  headbutt: {
    cels: [650, 651, 652, 653, 654, 655, 654, 653, 652, 651],
    dx: [0, 0, 0, 95, 95, 95, -95, -95, 0, 0],
    from: "0x471c90 tag 8, on P+K",
  },
};

/**
 * How far the player travels per animation cel: `MEASURED.walk / DIVISOR` = 8px.
 *
 * The engine holds each walk cel for one tick and moves 8px in that tick, so a
 * cel is worth exactly 8px of ground and the twelve-frame cycle covers 96. Tying
 * the animation to DISTANCE rather than to a clock keeps that true whatever this
 * page's frame rate is, and it is what stops the feet sliding: on a timer, the
 * cycle and the stride drift apart and the walk reads as a shuffle.
 */
const STRIDE_PX = MEASURED.walk / DIVISOR;
/** the same for the run: dx 180 over one frame, so 15px of ground a cel */
const RUN_STRIDE_PX = MEASURED.run / DIVISOR;
/** and the crawl: dx 47, so 3.9px of ground a cel */
const CRAWL_STRIDE_PX = MEASURED.crawl / DIVISOR;
/** `0x471c68`'s `ticksPerFrame` — engine frames each airborne cel is held */
const AIR_HOLD = 4;
/** `0x471648`'s — engine frames each idle cel is held */
const IDLE_HOLD = 2;
/** `0x42a109`'s `cmp word ptr [eax+0x32], 0x168` — the fall that earns the flail */
const FLAIL_FALL_PX = 360;

/**
 * What a level spawns, and the one table that says what each kind is.
 *
 * The cels, the strides, the flinches, the deaths, the health, the awards and
 * whether a thing counts towards the quota are all in {@link FOES}, read out of
 * `SC.EXE` a class at a time — {@link file://./foes.ts} has the shape of a
 * creature and the four objects in the executable it takes to describe one.
 *
 * What is NOT there is behaviour. `SC.EXE` gives each spawned enemy a 54-byte AI
 * struct (`0x450a50` allocates it, `0x45ef70` fills it from a per-class table —
 * the punk's is `0x477600`: 330, 200, 150, 80) and what that AI does with those
 * four numbers has not been read. So these patrol their own rect and turn at its
 * edges, which is this port's guess at what a territory is for.
 */

/**
 * Engine frames per tick of this page — 15/60, so a quarter.
 *
 * Every engine number in this file is per engine FRAME, and this is the only
 * thing that converts one. It sets the animation rate, the walk, the enemies'
 * strides and the jump, so none of them is a separate guess.
 */
const TICK_SCALE = (ENGINE_HZ * INVENTED.tickMs) / 1000;

/**
 * What state a spawned thing is in, which is the same division `SC.EXE` makes:
 * the class's own script `kind` field IS the object's state (`0x45d090` copies
 * `script+4` into `obj+0x18`), so a creature is only ever doing one animation and
 * the animation is the state.
 *
 * `gait` loops; the other three play once. `dead` is followed by
 * {@link CORPSE_LINGER} frames of lying there, then the thing is gone.
 */
/**
 * `gait`, `flinch` and `dead` are the kind's own animations; `burst` is the one
 * state an object is SPAWNED in — the hydrant's water, which sprays once and is
 * removed ({@link Foe.burst}).
 */
type FoeState = "gait" | "lever" | "flinch" | "dead" | "burst";

/** one spawned thing: where it is, which way it faces, and how far it may roam */
interface Enemy {
  kind: string;
  x: number;
  y: number;
  facing: number;
  /** the record's own rect — its territory */
  left: number;
  right: number;
  /** engine frames elapsed in the current animation, fractional */
  clock: number;
  /** which animation is running, and which of the kind's it is */
  state: FoeState;
  anim: FoeAnim;
  /** engine frames a corpse has left before it is removed — `[0x46b204]` */
  linger: number;
  /** how many blows it has taken, for the kinds whose flinches advance in order */
  dents: number;
  /** has the husk already let out what was inside it — see {@link Foe.hatches} */
  hatched?: boolean;
  /** the record's rect, top and bottom — what a sleeper watches ({@link Foe.wake}) */
  top: number;
  bottom: number;
  /** still a statue: the player's point has not been inside that rect yet */
  asleep?: boolean;
  /** which of {@link Foe.drives}' states is running, for the one kind that has them */
  mode?: "hover" | "charge" | "rush" | "combo" | "land" | "melee" | "antiAir";
  /** `AI+4` — decisions left before it breaks off and goes home */
  decisions?: number;
  /** has the reach already made its one call — `obj+0x42` passes the frame once */
  thrown?: boolean;
  /** `[0x473dd0]` — which way the hover is going, +1 down and -1 up */
  hover?: number;
  /**
   * Pixels per TICK, and it persists — `obj+0xa`/`obj+0xc`, which the collision
   * solver `0x430470` writes and which only the kinds that cancel it stop
   * carrying. Zero for everything but a struck {@link Foe.flies} kind.
   */
  vx: number;
  vy: number;
  /**
   * Health left, in the disc's own units — {@link Foe.panel}'s figure, so a
   * `LINK` really does stand up with 200 of it, and what a blow takes off is the
   * striking cel's own speed ({@link strikeBox}). The furniture gets `Infinity`
   * and cannot be killed. **Nothing hits the player back yet** — no enemy's
   * blow, no hydraulic press, no swinging girder, no fall takes health off — so
   * the classes below carry their attacks as read, the addresses and the cels
   * and the blow each one would land, with none of it wired to a victim. The
   * engine's own health word is `0x4ac3d0` and `0x402ac0` is what spends it;
   * when this page does take damage it will be behind a switch that starts off,
   * so a level under test stays walkable.
   */
  hp: number;
  /** what it stood up with, for the bar's fraction */
  max: number;
}

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>("screen");
const ctx = canvas.getContext("2d")!;
const hud = $("hud");
const levelPick = $<HTMLSelectElement>("level");
const W = canvas.width;
const H = canvas.height;

/**
 * Interface mode or full-screen, and Ctrl+P between them — `SC.EXE`'s own key,
 * and its own help screen is where the pair is named: *"Press Ctrl-P to toggle
 * between interface and full-screen mode"*. With the panel up the level plays
 * inside {@link WINDOW}, which is where the pause films play too; without it the
 * level has the whole 512x384 and nothing is drawn over it.
 */
let iface = true;
/** the y the level is drawn about — the middle of whichever window it has */
/**
 * The play window, and both of its heights are `SC.EXE`'s own.
 *
 * `0x40e120` is the Ctrl-P handler and it does one thing besides toggling the
 * flag at `0x46ba20`: it hands `0x430860` a view rect, and the rect is
 * `{0, 0, 0xe8, 0x200}` with the panel up and `{0, 0, 0x156, 0x200}` without —
 * **512x232** and **512x342**. Those are surface coordinates, and the level's
 * surface starts 42 rows down the screen (which is what the interface's top band
 * occupies and what {@link WINDOW} already had), so 42 + 342 is exactly the 384
 * the screen is tall: full-screen mode is the window grown DOWNWARDS into the
 * panel's space, not the whole screen.
 */
const FULL_H = 0x156;
const VIEW = { x: WINDOW.x, y: WINDOW.y, w: WINDOW.w };
const viewH = (): number => (iface ? WINDOW.h : FULL_H);

/**
 * Move the feet to where the POSE puts them, keeping the anchor where it was.
 *
 * The engine's `y` is the cel's anchor and what touches a floor is the cel's own
 * collision box, so a change of pose moves the FEET: standing cel 1's box reaches
 * 88 rows below the anchor and the airborne tuck's (cel 200) reaches 69, because
 * the knees come up. This page keeps `p.y` at the feet instead, so the same fact
 * has to be spelled the other way round — the offset changes and `p.y` moves with
 * it, leaving `p.y - p.feet` (the anchor, the thing every rect in the file is
 * measured against) continuous.
 *
 * It is worth 23 pixels of clearance and CITY is built on them. Its first jump is
 * from a walkway at y4041 onto a tank roof at y3920 — 121 rows — and the launch
 * plus the lift raise the anchor 105. In the tuck the feet are 69 below the anchor
 * rather than 88, so they pass 3917 while the anchor is at 3848: over the roof by
 * three pixels, and over the wall beside it by four. Standing-footed the same jump
 * lands 19 pixels short, every time, which is where this level stopped.
 *
 * Two values and not a per-cel lookup: the wind-up cels 250..253 keep their box at
 * 87..93 (the feet are still down while the knees bend) and the tuck pair 200/220
 * hold 69 and 65, so the airborne figure is the tuck's for all but its first two
 * frames. The ladder has its own ({@link LADDER}), and this leaves it alone.
 */
function poseFeet(): void {
  // the tuck's cels are 200 and 220: a run's leap from its first frame, a
  // standing jump's from the frame after 253's launch
  const tucked = !p.onGround && (p.leap || p.airFrames >= 1);
  const want = p.climbing ? p.feet : tucked ? TUCK_FEET : STAND_FEET;
  if (want === p.feet) return;
  p.y += want - p.feet;
  p.feet = want;
}

/**
 * How far the standing player's feet are below the engine's own y for them.
 *
 * Cel 1 is 98x145 with its anchor 55 rows down and a collision box running
 * `y -55..88`, so the box bottom — what touches a floor — is 88 rows under the
 * anchor. That is the one number that converts this page's feet-based `p.y` into
 * the point every rect in the file is measured against.
 */
const STAND_FEET = 88;
/** and the tuck's, cel 200's own — the knees are up, so the feet are 19 higher */
const TUCK_FEET = 69;

/**
 * What the camera is centred on: the middle of the player's own collision box.
 *
 * Not the feet, which is what this page centred on until now and what cut the top
 * off the player. An object's `y` in this engine is wherever the artist put the
 * cel's anchor and its ground contact is the cel's box — standing cel 1 is 98x145
 * with its anchor 55 rows down and a box running `y -55..88`, so the engine's own y
 * is at the chest and the head is 55 above it. Keeping `p.y` at the FEET is a fine
 * convention for a floor and a bad one for a camera: 232 rows of window centred on
 * the feet leave 116 above them for a sprite 145 tall, so **the top 29 rows of the
 * player were cut off** wherever the room's own clamp was not already holding the
 * view down. At street level it is; up on STREETS' roof it is not, which is where
 * it showed.
 *
 * So: the box's own middle, from whichever cel represents what the player is doing
 * — the idle on their feet, the resting climb cel on a ladder, where the anchor is
 * the rung itself and the box is the body hanging off it. Both numbers are the
 * disc's; which cel to take them from is this page's, because there is no camera
 * in `SC.EXE` to read (see {@link viewTop}).
 */
function eyeY(): number {
  const c = player?.cels.find((q) => q.id === (p.climbing ? LADDER.restCel : ANIM.idle[0]));
  const b = c?.body ?? { y0: -55, x0: 0, y1: STAND_FEET, x1: 0 };
  const anchor = p.climbing ? p.climbY : p.y - p.feet;
  return anchor + (b.y0 + b.y1) / 2;
}

/**
 * The top edge of the view, in world coordinates — this page's camera.
 *
 * The engine scrolls by moving the world rather than the view: its view rect is
 * fixed at the window and every drawn thing carries a position already relative
 * to it, so there is no camera variable in `SC.EXE` to read. What there is, is a
 * shape: a room's rect is the world (which is how {@link fellOut} knows the
 * difference between a shaft and the void), and the view is a 232-tall slot in
 * it.
 *
 * So: follow the player, and clamp to the room's own rect — the same rule this
 * page already used horizontally through {@link roomSpan}, applied to y as well.
 * A room shorter than the view is centred. That replaces two invented constants
 * (a `p.y − 120` camera and a 60px lift on every draw) with one rule and puts the
 * player's feet where the original's screenshots put them: near the bottom of the
 * window, with the ground filling the last few rows rather than a third of it.
 */
function viewTop(): number {
  const h = viewH();
  const r = p.room;
  const eye = eyeY();
  if (!r) return eye - h / 2;
  const want = eye - h / 2;
  const lo = r.top;
  const hi = r.bottom - h;
  return hi > lo ? Math.min(Math.max(want, lo), hi) : (r.top + r.bottom - h) / 2;
}

/**
 * The things in a room you can stand on, walk into, or climb.
 *
 * All three are entity rects off the disc, sorted into their room by the same
 * containment test `readRooms` uses for doors. What each one MEANS is the
 * engine's, as far as it has been read:
 *
 * - **`platform`** is the commonest object in the game (263 across the sixteen
 *   levels) and `SC.EXE`'s platform path says what it is: a rect that carries
 *   whatever stands on it. Here only its TOP edge is used, as a ledge.
 * - **`obstacle`** is drawn as a tall rect at the ends of levels and against
 *   walls; taken here as solid. The executable has not been read on it.
 * - **`ladder`** is a tall thin rect, and STREETS puts an `initplayer` at the
 *   top of its one ladder — which is the only thing in the data that says a
 *   ladder is for getting up there.
 * - **`goal`** is one rect per level, and every level has exactly one. It is the
 *   end. Its param is 0 or 1 with no relation to any room, so it is not a door.
 */
interface Solids {
  /**
   * COPIES of the records, not the records — a `platform` can be owned by an
   * object and follow it (`0x42fcb9`, see {@link file://./props.ts}), and a plank
   * that gives way takes its floor with it.
   */
  platforms: SbkEntity[];
  obstacles: readonly SbkEntity[];
  ladders: readonly SbkEntity[];
  goal: SbkEntity | undefined;
}

interface Level {
  sbk: SbkFile;
  pal: Uint8ClampedArray;
  /** the level's own rooms, floors rasterised and doors attached */
  rooms: SbkRoom[];
  /** what stands in each room, by its index in `rooms` */
  solids: Solids[];
  /** what each room spawns — the `init*` records this page knows how to draw */
  spawned: Enemy[][];
  /** the room's planks, each holding the platform record it owns */
  planks: Plank[][];
  /** the room's elevators, each holding the platform record its car IS */
  elevators: Elevator[][];
  /** the room's swinging girders, pinned where their records put them */
  ibeams: Ibeam[][];
  crushes: Crush[][];
  /** the room's wall levers, each holding the `param` it broadcasts on */
  switches: Switch[][];
  /** the room's goop nests — invisible, and off until a lever says otherwise */
  nests: Nest[][];
  /** the room's doors, shut and solid until a lever on their number is thrown */
  doors: Door[][];
  /** the room's sump lifts, each carrying the platform record laid over it */
  elevs: Elev[][];
  /** the room's shack fronts, which open as you come level with them */
  shacks: Shack[][];
  /** the room's floating barrels, each with the platform it claimed */
  barrels: Barrel[][];
  /** the room's outfalls, and the pools they have made */
  pipes: Pipe[][];
  sewage: Sewage[][];
  /** the room's `initbush`, hanging where its record put it */
  bushes: Bush[][];
  /** the room's roach nests — invisible, and only busy while you are in them */
  nests2: Nest2[][];
  /** the seven places level eight's water can come from, by their own slot */
  sprinklers: Sprinkler[][];
  /** the `stat*` records, as the codes their chapter's init hands the creator */
  pickups: Pickup[][];
  /** the positive-code records — the guns, and the ammunition for them */
  guns: Gun[][];
  /** level nine's five graves, shut until you come near one */
  holes: Hole[][];
  /** and its four hands, up out of the ground while you stand in their rect */
  hands: Hand[][];
  /** the swinging blades of levels ten and eleven */
  axes: Axe[][];
  /** and level ten's four rope bridges */
  bridges: Bridge[][];
  /** level twelve's five floors, which will not hold either */
  floors: Floor[][];
  /** ...and its two surges, the only hazard in the game that gives you something */
  surges: Surge[][];
  /** level thirteen's seven cage doors, which become obstacles when they shut */
  cages: Cage[][];
  /** its six alarms and its eight fans */
  alarms: Alarm[][];
  fans: Fan[][];
  /** level fourteen's forty-two conveyors, its two chairs and its four claws */
  belts: Belt[][];
  chairs: Chair[][];
  claws: Claw[][];
  /** LAB's and VAT's one-cel furniture, and the last thing in the game */
  fittings: Fitting[][];
  boggs: Boggs[][];
  /** the room's crows, asleep until something walks into their rect */
  crows: Crow[][];
  /** placements back-to-front with their cel container and engine rate resolved */
  draw: { loc: number; cels: number[]; x: number; y: number; rate: number; mirror: boolean; z: number }[];
  anchorX: number;
  anchorY: number;
  name: string;
}

const celCache = new Map<string, HTMLCanvasElement>();
/**
 * A cel as an opaque-masked canvas, optionally dimmed.
 *
 * The dim is baked into the PIXELS, not applied with `ctx.filter` at draw time:
 * canvas filters are silently ignored on some browsers, so the background dim
 * simply did not happen there while it did in a headless probe. Multiplying the
 * RGB here cannot be ignored. Cached per (loc, dim), so the two variants of a
 * cel that appears both dimmed and not are each built once.
 */
function cel(level: Level, loc: number, dim = 1): HTMLCanvasElement | null {
  const key = `${level.name}:${loc}:${dim}`;
  const had = celCache.get(key);
  if (had) return had;
  const container = level.sbk.file.containers[loc];
  if (!container) return null;
  let f: ShpFrame;
  try {
    f = decodeShpFrame(container.data);
  } catch {
    return null;
  }
  const c = document.createElement("canvas");
  c.width = f.width;
  c.height = f.height;
  const cc = c.getContext("2d")!;
  const img = cc.createImageData(f.width, f.height);
  for (let i = 0; i < f.width * f.height; i++) {
    if (!f.opaque[i]) continue;
    const p = f.indexed[i] * 4;
    img.data[i * 4] = level.pal[p] * dim;
    img.data[i * 4 + 1] = level.pal[p + 1] * dim;
    img.data[i * 4 + 2] = level.pal[p + 2] * dim;
    img.data[i * 4 + 3] = 255;
  }
  cc.putImageData(img, 0, 0);
  celCache.set(key, c);
  return c;
}
/** the decoded frame too, for anchors */
const frameCache = new Map<string, ShpFrame>();
function frameOf(level: Level, loc: number): ShpFrame | null {
  const key = `${level.name}:${loc}`;
  let f = frameCache.get(key) ?? null;
  if (!f) {
    try {
      f = decodeShpFrame(level.sbk.file.containers[loc].data);
      frameCache.set(key, f);
    } catch {
      return null;
    }
  }
  return f;
}

// ---- state -------------------------------------------------------------------

let files: SkullFiles;
/**
 * The disc's own sound — the level's theme and the banks the handlers play from,
 * see {@link file://./sound.ts}. Null until the rip is indexed, and silent
 * whenever a browser will not start an AudioContext, so nothing here has to check
 * twice.
 */
let sound: Sounds | null = null;
let level: Level | null = null;
/** the player book, shared across levels */
let player: SbkFile | null = null;
let playerPal: Uint8ClampedArray | null = null;
let levelIndex = 0;
/** ?clock=, in engine frames, for the first level only */
let startTicks: number | null = null;

const p = {
  x: 0,
  y: 0,
  facing: 1,
  moving: false,
  /** W held and not on a ladder — `[0x4ac3fe]`, the engine's own run flag */
  running: false,
  /** ground covered since the level opened — what drives the walk cycle */
  travelled: 0,
  /** which room they are standing in — the level's own division of itself */
  room: null as SbkRoom | null,
  /** downward speed in px per tick; 0 while standing */
  vy: 0,
  /** the engine's vertical velocity, in RAW units and advanced once an ENGINE frame */
  vyRaw: 0,
  /**
   * The horizontal velocity, `obj+0xc`: whole pixels a frame, on the ground and
   * off it. The gait's dx is an impulse into it and the ground's drag takes it
   * back ({@link dragged}); in the air the tag-0 handler steers it and nothing
   * slows it. Ticks move by a quarter of it.
   */
  vx: 0,
  /** this engine frame's whole-pixel vertical step, spread across its four ticks */
  stepPx: 0,
  /** ticks into the current engine frame: TICK_SCALE each, so one frame per four */
  frameAcc: 0,
  onGround: true,
  climbing: false,
  /**
   * Where on a ladder they are, and it is a RUNG rather than a height — see
   * {@link LADDER}. Rung 0 is the ladder record's own top; the anchor is
   * `top + rung * 35` and `climbTag` is which of the climb script's four tags is
   * playing, clocked in engine frames by `climbClock`.
   */
  rung: 0,
  climbTag: 0,
  climbClock: 0,
  /** the world y of the anchor the climb cels hang from, while on a ladder */
  climbY: 0,
  /**
   * How far the feet are below the ANCHOR in the pose showing now — see
   * {@link poseFeet}. `p.y` is the feet, the engine's `y` is the anchor, and this
   * is the difference; it changes when the pose does, and `p.y` is converted with
   * it so the anchor never jumps.
   */
  feet: 88,
  /** the one-shot action playing, and how far into it, in engine frames */
  act: null as string | null,
  actClock: 0,
  /**
   * `obj+0x24`, the float `0x42f850` sets — what the constant gravity is
   * multiplied by before it is added.
   *
   * It is 1 for the whole of ordinary play and the reaction table is the only
   * thing that moves it: a grab sets it to 0 (`0x448ef4`), the surge and the
   * unreachable -6 set it to 1, and the bush's -5 sets it to a half. Which is
   * how being held stops you falling without any state anywhere saying so.
   */
  gravityScale: 1,
  /**
   * What has hold of the player, as a function returning the world point its
   * current cel's grip is at — or null the frame that grip goes away, which is
   * how a grab ends. See {@link gripOf}.
   */
  heldBy: null as (() => { x: number; y: number } | null) | null,
  /**
   * WHICH thing that is — `0x4ac408`, the engine's own one-slot memory of it.
   *
   * It is here for the same reason the engine keeps it: a grabber asks whether
   * it still has hold of anything (`obj+0x2a`, tested at `0x420dd1`) and that
   * answer has to come from somewhere.
   */
  heldWhat: null as object | null,
  /** engine frames into the held loop, once the reaction's own script has run */
  heldClock: 0,
  /** whether the fire act has already let its round go — `0x42cd53` fires once */
  fired: false,
  /**
   * Engine frames completed since leaving the ground. The tag-0 handler — the
   * lift and the steering — first runs on the second: the launch frame ends the
   * launch tag, the frame after installs tag 0 (`0x42a1c2`), and only then does
   * `0x429f1f` read a key.
   */
  airFrames: 0,
  /**
   * Frames of the launch tag still to play, the last of which is the launch:
   * four for a standing or walking jump (`250 251 252 253`), one for the run's
   * (`200`). While it counts the player is on the ground and the keys do nothing.
   */
  windup: 0,
  /** the dx the launch record carries — 0 standing, 100 walking, 180 running */
  launchDx: 0,
  /** in the air by a JUMP — the kind-3 state, which steers, lifts and lands in tag 1 */
  launched: false,
  /** frames of the landing tag still to play; the keys do nothing until it ends */
  landLeft: 0,
  /** and whether that landing is `0x471c68`'s — the fall was more than 360 */
  hardLand: false,
  /** engine frames spent standing still — the idle fidget's clock */
  idleClock: 0,
  /** S held on the ground — the duck (see {@link ANIM.crouch}) */
  crouching: false,
  /** pixels fallen this flight — past 360 the tuck becomes the flail (0x42a109) */
  fallPx: 0,
  /** a running jump is tag 4's instant leap: no wind-up, straight to the tuck */
  leap: false,
  /** the fidget playing over the idle, if the end-of-cycle roll picked one */
  fidget: null as readonly number[] | null,
  fidgetClock: 0,
  /**
   * What is left of the jump's lift allowance, in engine frames — `0x4723f0`,
   * which the engine only ever sets to 2.
   */
  hold: 0,
};
/** `mov word ptr [0x4723f0], 2` — the allowance, and it is 2 in all eight places */
const HOLD_FRAMES = 2;

/**
 * What a blow does to the PLAYER — read out of `SC.EXE`, and **off by default**.
 *
 * Everything in this block is the engine's, and none of it runs unless the switch
 * below is thrown. The reason is the levels: with damage on, a probe walking east
 * through WOODS meets three hydraulic presses and every route test in this repo
 * becomes a fight. So it ships ready and dark, and `?damage=1` or the `h` key
 * turns it on.
 *
 * The numbers:
 *
 * ```
 *   448ac2  max = trunc(difficulty * 600.0) + 0x4b0    ; 1200 at difficulty 0
 *   4490d5  di = 0x42f910(hitter)                      ; sqrt(blowX² + blowY²)
 *   449115  cmp di, 0x3c                               ; 60: stagger or knockdown
 *   449209  0x402ac0(di)                               ; and the damage IS di
 *   402ad8  health floors at 0, and 0x402fa0(1) starts the dying script
 * ```
 *
 * And the fall, which is its own path (`0x443c2b`) and takes no blow at all:
 * past 360 of accumulated drop the player is cut into the flail, and on landing
 * past 530 it is simply death, under that a flat ten and a roll.
 */
const HURT = {
  /** `0x448ad1` at difficulty 0 — the middle of 1800 / 1200 / 600 */
  max: 1200,
  /** `0x449115`'s `cmp di, 0x3c` */
  knockdown: 60,
  /** `0x442f3f`'s `cmp [player+0x32], 0x168` — the drop that forces the flail */
  flailFall: 360,
  /** `0x443c82`'s `cmp [player+0x32], 0x212` — past this a landing is fatal */
  fatalFall: 530,
  /** `0x443ce7`'s `push 0xa` — what an ordinary bad landing costs */
  fallDamage: 10,
  from: "0x448a90 / 0x448c60 / 0x402ac0 / 0x443c2b",
} as const;

/**
 * Is the damage above switched on? `?damage=1` at load, `h` at any time.
 *
 * It starts off. See {@link HURT} for why, and for everything it turns on.
 */
let damageOn = new URLSearchParams(location.search).get("damage") === "1";
const held = { left: false, right: false, up: false, down: false, jump: false, punch: false, kick: false, inv: false };
/**
 * The two edges: a door is entered by PRESSING up, and a jump by pressing jump.
 * Holding neither repeats.
 */
let upPressed = false;
let jumpPressed = false;
/** the attacks fire on the press too: holding K should not machine-gun kicks */
let punchPressed = false;
let kickPressed = false;

async function loadLevel(index: number): Promise<void> {
  const name = LEVEL_ORDER[index];
  hud.textContent = `loading ${name}…`;
  const bytes = await files.load(`${name}.sbk`);
  if (!bytes) {
    hud.textContent = `${name}.sbk is not in this rip`;
    return;
  }
  const sbk = readSbkFile(bytes);
  const pal = paletteToRGBA(sbk.paletteRaw!, 256);
  const rooms = readRooms(sbk);
  const solids = rooms.map((r) => solidsIn(sbk, r));
  const start = pickStart(sbk, rooms);
  const anchorX = start ? (start.left + start.right) / 2 : 0;
  const anchorY = start ? (start.top + start.bottom) / 2 : 0;
  // planks before lifts: both OWN a platform record and a record has one owner,
  // so the planks claim theirs first and the lifts are told what is already spoken for
  const planks = rooms.map((r, i) => planksIn(sbk, r, solids[i]));
  drips = [];
  roaches = [];
  columns = new Map();
  flares = [];
  // the chapter's own entry function: zero every count, name the chapter's
  // weapon, and leave the hands empty (`0x4511f0` and its three siblings). It
  // runs once per CHAPTER, not once per level, and that is the whole reason
  // SEWER places two `statflare` and no gun to fire them with — you are
  // expected to still be holding SERVICE's.
  const chapter = CHAPTER_WEAPON[name.toUpperCase()];
  if (chapter !== undefined && chapter !== chapterWeapon) {
    chapterWeapon = chapter;
    inv.weapon = chapter;
    inv.armed = false;
    inv.rounds = {};
  }
  level = {
    sbk,
    pal,
    rooms,
    solids,
    spawned: ((claimed: Set<SbkEntity>) => rooms.map((r) => spawnIn(sbk, r, claimed)))(new Set<SbkEntity>()),
    planks,
    elevators: rooms.map((r, i) => elevatorsIn(sbk, r, solids[i], planks[i])),
    ibeams: rooms.map((r) => ibeamsIn(sbk, r)),
    crushes: rooms.map((r) => crushesIn(sbk, r)),
    switches: rooms.map((r) => switchesIn(sbk, r)),
    nests: rooms.map((r) => nestsIn(sbk, r)),
    doors: rooms.map((r) => doorsIn(sbk, r)),
    elevs: rooms.map((r, i) => elevsIn(sbk, r, solids[i])),
    shacks: rooms.map((r) => shacksIn(sbk, r)),
    barrels: rooms.map((r, i) => barrelsIn(sbk, r, solids[i])),
    pipes: rooms.map((r) => placed(sbk, r, "initpipe", PIPE.mouth.cels, (e) => ({ x: e.pointX, y: e.pointY, mirror: e.param < 0, clock: 0 }))),
    sewage: rooms.map((r) => placed(sbk, r, "initsewage", [], (e) => ({ top: e.top, left: e.left, bottom: e.bottom, right: e.right, clock: SEWAGE.gulpEvery }))),
    bushes: rooms.map((r) => placed(sbk, r, "initbush", BUSH.idle.cels, (e) => ({ x: e.pointX, y: e.pointY + BUSH.below, mirror: Math.random() < 0.5, clock: 0 }))),
    nests2: rooms.map((r) => placed(sbk, r, "initroachmotel", ROACH.run.cels, (e) => ({ x: e.pointX, y: e.pointY, top: e.top, left: e.left, bottom: e.bottom, right: e.right, clock: -17, made: 0 }))),
    sprinklers: rooms.map((r) => placed(sbk, r, "initsprinkler", SPRINKLER.rise.cels, (e) => ({ x: e.pointX, y: e.pointY, slot: e.param, top: e.top, left: e.left, bottom: e.bottom, right: e.right }))),
    pickups: rooms.map((r) => pickupsIn(sbk, r)),
    guns: rooms.map((r) => gunsIn(sbk, r)),
    holes: rooms.map((r) =>
      placed(sbk, r, "initgrave", [HOLE.shut], (e) => ({
        x: e.pointX, y: e.pointY, top: e.top, left: e.left, bottom: e.bottom, right: e.right,
        state: "shut" as const, clock: 0,
      })),
    ),
    axes: rooms.map((r) => placed(sbk, r, "initswingaxe", [AXE.swing[0]], (e) => ({ x: e.pointX, y: e.pointY, clock: 0 }))),
    floors: rooms.map((r) =>
      placed(sbk, r, "initfloor", [FLOOR.whole], (e) => ({
        x: e.pointX, y: e.pointY, top: e.top, left: e.left, bottom: e.bottom, right: e.right,
        state: "whole" as const, clock: 0,
      })),
    ),
    surges: rooms.map((r) =>
      placed(sbk, r, "initsurge", SURGE.arc.cels, (e) => ({
        x: e.pointX, y: e.pointY, top: e.top, left: e.left, bottom: e.bottom, right: e.right, clock: 0,
      })),
    ),
    cages: rooms.map((r) =>
      placed(sbk, r, "initcagedoor", [CAGE.shut], (e) => ({
        x: e.pointX, y: e.pointY, top: e.top, left: e.left, bottom: e.bottom, right: e.right,
        // a door's own number is the absolute value; SEWER's five are filed the
        // same way and MAZE's seven run 1, 2, -2, 3, 4, -4, 4
        param: Math.abs(e.param), state: e.param < 0 ? ("open" as const) : ("shut" as const), clock: 0,
      })),
    ),
    alarms: rooms.map((r) => placed(sbk, r, "initalarm", [ALARM.quiet], (e) => ({ x: e.pointX, y: e.pointY, param: e.param, clock: 0 }))),
    belts: rooms.map((r) => [
      ...placed(sbk, r, "initbeltleft", BELT.roll.cels, (e) => ({
        x: e.pointX, y: e.pointY, top: e.top, left: e.left, bottom: e.bottom, right: e.right,
        dir: -1 as const, param: e.param, clock: 0,
      })),
      ...placed(sbk, r, "initbeltright", BELT.roll.cels, (e) => ({
        x: e.pointX, y: e.pointY, top: e.top, left: e.left, bottom: e.bottom, right: e.right,
        dir: 1 as const, param: e.param, clock: 0,
      })),
    ]),
    chairs: rooms.map((r) => placed(sbk, r, "initchair", CHAIR.runs[0].cels, (e) => ({ x: e.pointX, y: e.pointY, run: 0, clock: 0 }))),
    claws: rooms.map((r) =>
      placed(sbk, r, "initclaw", CLAW.running.cels, (e) => ({
        x: e.pointX, y: e.pointY, left: e.left, right: e.right, state: "idle" as const, clock: 0,
      })),
    ),
    fittings: rooms.map((r) => [
      ...placed(sbk, r, "initshower", [FITTING.shower.on], (e) => ({ kind: "shower" as const, x: e.pointX, y: e.pointY + FITTING.shower.below, clock: 0 })),
      ...placed(sbk, r, "initball", [FITTING.ball.cel], (e) => ({ kind: "ball" as const, x: e.pointX, y: e.pointY, clock: 0 })),
      ...placed(sbk, r, "initteeth", [FITTING.teeth.cel], (e) => ({ kind: "teeth" as const, x: e.pointX, y: e.pointY, clock: 0 })),
    ]),
    boggs: rooms.map((r) => placed(sbk, r, "initboggsbody", BOGGS.idle.cels, (e) => ({ x: e.pointX, y: e.pointY, clock: 0 }))),
    fans: [
      ...rooms.map((r) => [
        ...placed(sbk, r, "inithfan", [FAN.h.stopped], (e) => ({ x: e.pointX, y: e.pointY, horizontal: true, state: "off" as const, clock: 0 })),
        ...placed(sbk, r, "initvfan", [FAN.v.stopped], (e) => ({ x: e.pointX, y: e.pointY, horizontal: false, state: "off" as const, clock: 0 })),
      ]),
    ],
    bridges: rooms.map((r) =>
      placed(sbk, r, "initbridge", [BRIDGE.whole], (e) => ({
        x: e.pointX, y: e.pointY, top: e.top, left: e.left, bottom: e.bottom, right: e.right,
        state: "whole" as const, stood: 0, clock: 0,
      })),
    ),
    hands: rooms.map((r) =>
      placed(sbk, r, "inithand", HAND.underfoot.up.cels, (e) => ({
        x: e.pointX, y: e.pointY, top: e.top, left: e.left, bottom: e.bottom, right: e.right,
        // `0x420cc4` — the record's own param, not a roll
        underfoot: e.param === 0, atX: e.pointX, atY: e.pointY,
        state: "down" as const, clock: 0,
      })),
    ),
    crows: rooms.map((r) => crowsIn(sbk, r)),
    // z is the ENGINE's paint order, which is its collection order: the level's
    // frame fn (SC.EXE 0x412c30) collects plane lists p3, p0, then the actors,
    // then p4, p1, p2 into one node array that 0x40e520 paints in order. So the
    // player sits between p0 and p4, and plane 2 — the giant lamp-post and the
    // overhead cables — is painted LAST, in FRONT of everything. (An earlier
    // build drew it behind AND dimmed it; both were wrong. The cables are light
    // grey on purpose, and they belong over the wall, not mixed into it.)
    draw: sbk.placements
      .map((q) => ({
        // the frame cels this placement cycles — [id] for a still one, the glow
        // sequence for the lamp (2360,2361,2362). The frames are the disc's; the
        // rate they cycle at (INVENTED.bgAnimMs) is this port's, untraced.
        cels: q.frameIds.map((id) => sbk.byId.get(id) ?? -1).filter((l) => l >= 0),
        x: q.x,
        y: q.y,
        rate: placementRate(q),
        mirror: q.mirror,
        z: PLANE_Z[q.plane] ?? PLAY_PLANE_Z,
      }))
      .filter((q) => q.cels.length > 0)
      .map((q) => ({ ...q, loc: q.cels[0] }))
      .filter((q) => q.loc >= 0)
      .sort((a, b) => a.z - b.z),
    anchorX,
    anchorY,
    name,
  };
  levelIndex = index;
  levelPick.value = String(index + 1);
  // the quota, the engine's own way round: count what was just spawned, then
  // take this stage's share off it (see src/mission.ts). The census counts only
  // the things that can claim the panel's bar, which is the same set the engine
  // counts — furniture never calls `0x40d1c0` and is not part of anyone's quota.
  stats.census = level.spawned.reduce((n, r) => n + r.filter((e) => FOES[e.kind].counts).length, 0);
  stats.allowance = allowanceFor(mission(), stats.census);
  // `0x448ad8` fills it on the way in, and `0x402760` does the same on a respawn
  stats.health = stats.maxHealth;
  // ?clock= starts the mission clock short, which is the only way to reach the
  // last two minutes of an eight-minute dial from a test. It is spent on the
  // first level it is given to, so a timed-out level does not time out again.
  stats.ticks = startTicks ?? clockFor(sbk);
  startTicks = null;
  stats.shown = null;
  goalOpen = false;
  leftGoal = false;
  craft = null;
  gobs = [];
  pops = [];
  enter(roomAt(anchorX, anchorY), anchorX, anchorY);
  // the level's own theme and its chapter's effects bank — LEVEL_BANKS is the
  // table SC.EXE's own opens spell out, keyed by this book's name
  void sound?.open(name);
}

/**
 * The two-part win, and it is the engine's own order.
 *
 * `0x415f7f` (and `0x450190` for this chapter) tests the census against the
 * allowance FIRST and only then spawns the goal, which latches `0x46b1b0`; the
 * stage ends when `0x410370` reads `0x46ba10`, which the goal object sets for
 * itself once its own animation has finished.
 *
 * So the rect does nothing at all until the quota is met, and then what appears
 * is a THING rather than a live rect — see {@link craft} and
 * {@link file://./effects.ts}. Two frames of this port used to stand in for that
 * thing (a rect that became touchable, plus a latch so a level whose spawn sits
 * in its own goal could not complete on load); the latch is still here, because
 * the craft should not open on the frame it arrives either.
 */
function goalReady(): boolean {
  if (aliveNow() <= stats.allowance) goalOpen = true;
  return goalOpen;
}

/**
 * Has the player left the world? CITY is why this exists.
 *
 * Its ground is a ledge and then y7250 for the rest of the level, {@link
 * PIT_DEPTH}'s comment has the numbers, and landing on it put the player 2900px
 * below anything CITY draws with no way back. A room's rect is the world; more
 * than a shaft's depth below it, you are falling out of the level.
 */
function fellOut(): boolean {
  return !!p.room && p.y > p.room.bottom + PIT_DEPTH;
}

/**
 * Fell out: one of the seven KILL films, a life, and the level again.
 *
 * A life is spent because the panel has five of them and nothing else on this
 * page can spend one; when the last goes, they come back and the level starts
 * over, which is this page standing in for a game over it has not read. The
 * score is kept, since nothing says it should not be.
 */
async function died(): Promise<void> {
  if (advancing) return;
  advancing = true;
  stats.lives -= 1;
  const gameOver = stats.lives <= 0;
  if (gameOver) stats.lives = 3;
  await playFilm(DEATH_FILMS[Math.floor(Math.random() * DEATH_FILMS.length)]);
  await loadLevel(levelIndex);
  advancing = false;
}

/**
 * The clock ran out: one of the four TIME films, then this level again.
 *
 * `0x40e9d0` is the whole of the original's choice — `0x434540(4)`, the same
 * random helper the punch tosses for its variant, picking `TIME1.MOV` through
 * `TIME4.MOV`. What follows the film in the original is a state this page has not
 * read; it restarts the level and leaves the lives alone, since nothing found so
 * far spends one here.
 */
async function ranOut(): Promise<void> {
  if (advancing) return;
  advancing = true;
  const pick = TIME_OUT_FILMS[Math.floor(Math.random() * TIME_OUT_FILMS.length)];
  stats.ticks = CLOCK_FULL; // so a slow film cannot fire this twice
  await playFilm(pick);
  await loadLevel(levelIndex);
  advancing = false;
}

/**
 * The goal was reached with the quota met: the next mission, briefing first.
 *
 * The score carries and everything else is the new level's own — which is what
 * `loadLevel` already does, the census and the clock included. Sixteen wraps to
 * one; the original has an ending and this page has not read it.
 */
async function nextLevel(): Promise<void> {
  const next = (levelIndex + 1) % MISSIONS.length;
  const brief = MISSIONS[next];
  advancing = true;
  await playFilm(brief.film);
  await playFilm(brief.boggs);
  await loadLevel(next);
  advancing = false;
}

/** true while the films between two levels are running */
let advancing = false;

/**
 * Fill the chooser and keep it pointing at the level on screen.
 *
 * `[` and `]` have always stepped through the sixteen and `?level=N` has always
 * opened one; neither is visible on the page. The game itself was no more
 * discoverable and no less direct about it — "Enter level (1-16):" is a string in
 * `SC.EXE` — so this is the same thing with the names filled in.
 *
 * The select gives the keyboard back as soon as it is used: a focused `<select>`
 * eats the arrow keys, and the arrows are how the player walks.
 */
function fillPicker(): void {
  levelPick.innerHTML = MISSIONS.map(
    (m) => `<option value="${m.number}">${m.number}. ${m.book}</option>`,
  ).join("");
  levelPick.addEventListener("change", () => {
    const want = Number(levelPick.value) - 1;
    levelPick.blur();
    if (want !== levelIndex) void loadLevel(want);
  });
}

/** the mission this level is — its films, and the share of it that must die */
function mission(): Mission {
  return MISSIONS[levelIndex] ?? MISSIONS[0];
}

/** how many of this level's population are still standing */
function aliveNow(): number {
  // a body has already left: its state handler calls `0x42f870(obj, 0)` on the
  // first frame it is dead, fifty frames before the object itself goes
  return level
    ? level.spawned.reduce((n, r) => n + r.filter((e) => FOES[e.kind].counts && e.state !== "dead").length, 0)
    : 0;
}

/**
 * Has the goal appeared? `0x46b1b0` in the engine, and it latches for the same
 * reason: the goal is spawned once, when the quota is first met, and stays.
 */
let goalOpen = false;

/**
 * The flying television, once the quota lets it in.
 *
 * `0x410170` mode −1 puts it at `(pointY − 180, pointX)` off the level's own
 * `goal` record — a hundred and eighty pixels up, in the air — facing the way the
 * record's `param` says, and `0x410480` flies it down, hovers it, and opens it
 * when the player is standing in the rect. {@link file://./effects.ts} has the
 * disassembly. `null` until the census falls to the allowance.
 */
let craft: {
  x: number;
  /** where it is now, and where it is coming down to */
  y: number;
  restY: number;
  facing: number;
  /** hover | open, and how many engine frames into it */
  state: "hover" | "open";
  clock: number;
  /** the bob: `[0x46ba0c]`, reversed each time the offset passes five */
  drift: number;
  bobbed: number;
} | null = null;

/**
 * Bring the craft in, fly it down, bob it, and open it when the player arrives.
 *
 * The order is `0x410480`'s: sink while it is above its rest height, otherwise
 * bob and test. The test is two things — `0x434200(player, rect)` for the goal
 * RECT and `0x42fad0(craft, 300, 200)` for the craft itself — so the rect the
 * disc draws is still what you walk into, and the thing you walk to is over it.
 */
function stepCraft(): void {
  const g = solids().goal;
  if (!g || !level) return;
  if (!craft && goalReady()) {
    craft = {
      x: g.pointX,
      y: g.pointY - CRAFT.above,
      restY: g.pointY,
      // the record's `param` is 0 or 1 and this is the only thing in the engine
      // that reads it: `0x450060` keeps it and `0x410170` stores it as the
      // object's facing
      facing: g.param ? 1 : -1,
      state: "hover",
      clock: 0,
      drift: CRAFT.bob,
      bobbed: 0,
    };
  }
  if (!craft) return;
  craft.clock += TICK_SCALE;
  if (craft.state === "open") return;
  if (craft.y < craft.restY) {
    craft.y = Math.min(craft.restY, craft.y + CRAFT.sink * TICK_SCALE);
    return;
  }
  // the hover: two pixels a frame, turned round whenever it has drifted five
  if (Math.abs(craft.bobbed) > CRAFT.bobSpan) craft.drift = -craft.drift;
  craft.bobbed += craft.drift * TICK_SCALE;
  craft.y += craft.drift * TICK_SCALE;
  const box = playerBox();
  const inRect = box.right > g.left && box.left < g.right && box.bottom > g.top && box.top < g.bottom;
  const close = Math.abs(p.x - craft.x) <= CRAFT.near.x && Math.abs(p.y - craft.y) <= CRAFT.near.y;
  if (inRect && close && leftGoal) {
    craft.state = "open";
    craft.clock = 0;
  }
}

/** has the screen finished coming down — `[0x46ba10]`, and the stage is over */
function craftOpened(): boolean {
  return craft?.state === "open" && craft.clock >= CRAFT.open.cels.length * CRAFT.open.hold;
}

/** the craft, from the shared player book, on the play plane with everything else */
function drawCraft(camX: number, camY: number): void {
  if (!craft || !player) return;
  const a = craft.state === "open" ? CRAFT.open : CRAFT.hover;
  const i =
    craft.state === "open"
      ? Math.min(a.cels.length - 1, Math.floor(craft.clock / a.hold))
      : Math.floor(craft.clock / a.hold) % a.cels.length;
  const loc = player.byId.get(a.cels[i]);
  if (loc === undefined) return;
  const art = playerCel(loc);
  if (!art) return;
  // by the cel's OWN anchor, the way `0x4026d0` places everything: all sixteen
  // deploy cels put their anchor within a few pixels of the hull's top (4 to 7 of
  // heights from 44 to 117), so the screen unfolds downwards out of a hull that
  // does not move — which is what the anchors are for
  const f = playerFrame(loc);
  if (!f) return;
  const left = craft.x - camX + W / 2 - f.posXraw;
  const top = craft.y - camY + VIEW.y - f.posYraw;
  if (left + art.width < 0 || top + art.height < 0 || left > W || top > H) return;
  if (craft.facing > 0) {
    ctx.save();
    ctx.scale(-1, 1);
    ctx.drawImage(art, -(left + art.width), top);
    ctx.restore();
  } else ctx.drawImage(art, left, top);
}

/**
 * Has the player been anywhere but inside the goal since the level loaded?
 *
 * Without this latch a level whose quota is already met and whose spawn point
 * falls inside its own goal rect opens the television on the frame it loads —
 * `arcade` does exactly that, because none of the classes this page can draw
 * stand in it, so its census is zero. Standing where the craft is about to
 * arrive is not walking up to it.
 */
let leftGoal = false;

// ---- the films ------------------------------------------------------------

/**
 * The film on screen, if any — the same player the films page uses.
 *
 * A film owns the screen while it runs: the world stops stepping and nothing
 * repaints under it, which is what lets a window-sized film keep the interface
 * around itself. The chapter films are 512x384 and cover everything; the four
 * TIME films are 512x232 at origin (0, 42), so the panel stays exactly where the
 * engine leaves it.
 *
 * There is no sound on this page until something is pressed — the browser will
 * not start an audio context before a gesture — so the sink starts deferred and
 * the first key or finger attaches a real one. The films' beds then play, and so
 * does the level's own theme ({@link file://./sound.ts}).
 */
let film: Film | null = null;
let sink: AudioSink = new DeferredAudioSink();
let audioLive = false;

function wakeAudio(): void {
  // the level's own sound wants the same gesture the films' bed does, and it can
  // be asked more than once: the context may not exist yet the first time
  sound?.resume();
  if (audioLive) return;
  audioLive = true;
  const real = new WebAudioSink();
  (sink as DeferredAudioSink).attach?.(real);
  sink = real;
}

/** the film's screen, kept across frames: a frame is a PATCH over the last one */
let filmRGBA: ImageData | null = null;

/**
 * Play one film and resolve when it ends — or when it is skipped, which is the
 * same thing to the caller.
 *
 * Every film named here sets its own ESC-skips header bit, so `Film.skip()` is
 * the film's own permission and not this page overriding it.
 */
async function playFilm(name: string): Promise<void> {
  const bytes = files.has(name) ? files.provide(name) : await files.load(name);
  if (!bytes) return; // a rip without this film simply goes straight on
  let mov;
  try {
    mov = readMovFile(bytes);
  } catch {
    return;
  }
  filmRGBA = ctx.getImageData(0, 0, W, H);
  await new Promise<void>((done) => {
    film = new Film(name, mov, {
      audio: sink,
      paint: (pixels, width, height, palette, originX, originY) => {
        const screen = filmRGBA;
        if (!screen) return;
        const small = indexedToRGBA(pixels, width, height, palette);
        for (let y = 0; y < height; y++) {
          const dy = y + originY;
          if (dy < 0 || dy >= H) continue;
          const from = y * width * 4;
          const wide = Math.min(width, W - originX) * 4;
          screen.data.set(small.subarray(from, from + wide), (dy * W + originX) * 4);
        }
        ctx.putImageData(screen, 0, 0, originX, originY, Math.min(width, W - originX), Math.min(height, H - originY));
      },
      log: () => {},
      // a film that chains plays the next one in its place, and the promise
      // waits for the end of the chain
      onChain: (next) => void playFilm(next).then(done),
      onEnd: () => {
        film = null;
        done();
      },
    });
  });
}

/** the standable, solid and climbable things standing inside one room */
function solidsIn(sbk: SbkFile, room: SbkRoom): Solids {
  const mine = sbk.entities.filter((e) => {
    if (!e.isEntity) return false;
    const y = (e.top + e.bottom) >> 1;
    const x = (e.left + e.right) >> 1;
    return y >= room.top && y <= room.bottom && x >= room.left && x <= room.right;
  });
  return {
    platforms: mine.filter((e) => e.name === "platform").map((e) => ({ ...e })),
    obstacles: mine.filter((e) => e.name === "obstacle"),
    ladders: mine.filter((e) => e.name === "ladder"),
    goal: mine.find((e) => e.name === "goal"),
  };
}

/**
 * The engine's own level-testing tool, which the shipped key table leaves out.
 *
 * `SC.EXE`'s input dispatcher (`0x402be0`) has twenty handlers for actions −8…11,
 * and the 256-byte key table at `0x46b210` binds only eight of them. Two are
 * unbound, and both are a designer's:
 *
 * - **action 10** (`0x402cfe`) increments a counter, wraps it at the level's
 *   `initplayer` count (`0x46b9b4`) and jumps to `0x402760` — it walks the level's
 *   spawn points and teleports the player to each. That is this function.
 * - **action 11** (`0x402d22`) toggles `0x46b1a8`, and that word selects between
 *   two whole player implementations — 0 dispatches to `0x42e360`/`0x428080`,
 *   1 to `0x448870`/`0x448bf0`. It is a CHARACTER switch, and the second one is
 *   the 7700/8300 cel set whose walk is 105 and run 200. Not wired here yet.
 *
 * The rest of the debug set needs a modifier held (the event's modifier word
 * against `0x1fa0`), which routes through a second table at `0x403ea4`:
 * **mod+0…9** jumps to a level, **mod+Q** and **mod+.** abort it, **mod+P** and
 * **mod+T** toggle two more things. So the game shipped with a level warp in it.
 */
let spawnIndex = 0;
function cycleSpawn(): void {
  if (!level) return;
  const starts = level.sbk.entities.filter((e) => e.name === "initplayer");
  if (!starts.length) return;
  spawnIndex = (spawnIndex + 1) % starts.length;
  const e = starts[spawnIndex];
  const y = (e.top + e.bottom) / 2;
  const x = (e.left + e.right) / 2;
  enter(roomAt(x, y), x, y);
}

/** every animation a kind can ever show, for the cels-are-present test */
function everyAnim(foe: Foe): FoeAnim[] {
  return [foe.gait, ...(foe.flinch ?? []), ...(foe.death ? [foe.death] : []), ...(foe.burst ? [foe.burst.anim] : [])];
}

/**
 * Every `init*` record standing in this room that this page has cels for.
 *
 * **A creator places its object at the record's POINT**, and reading that settled
 * what an object's own y is — which {@link foeAnchor} had to leave open. The
 * level's spawner `0x4503a0` hands every creator the same three things off the
 * 48-byte record: the point as one dword, then the rect's two corners. Each
 * creator's second instruction on it is `mov dword [obj+6], eax` with that first
 * argument (`0x450f90` for the dog, `0x450a7b` for the punk, `0x450cdc` for the
 * fourth kind), and `0x4026d0` draws a cel with its ANCHOR at `obj+6`. So the
 * record's point is the anchor, and the rect is only the patrol territory the AI
 * struct keeps (`0x450fc3` stores both corners into it).
 *
 * This page had been standing them on the rect's BOTTOM edge, centred in its
 * width. In STREETS and CITY the two are close enough that nothing showed; in
 * WOODS the rects are wide territories whose bottom edge is well under the
 * ground, so every foe in the level spawned inside the terrain, fell through it
 * and was still falling thousands of pixels down when the level ended.
 */
/**
 * ...and a record belongs to ONE room, which is the engine's own rule.
 *
 * `0x40b940`'s kind 2 walks the region table and answers with the FIRST region
 * whose rect contains the point. Rooms overlap — that is how you walk out of one
 * and into the next — and a creature standing in a seam was being spawned once
 * per room it fell in. BARREL's rooms overlap x7464..7691 and its cop at x7521
 * stands in that seam, which is why a level of twelve had a census of thirteen
 * and a kill quota that could never be met.
 */
function spawnIn(sbk: SbkFile, room: SbkRoom, taken?: Set<SbkEntity>): Enemy[] {
  const out: Enemy[] = [];
  for (const e of sbk.entities) {
    const foe = FOES[e.name];
    if (!e.isEntity || !foe) continue;
    if (taken?.has(e)) continue;
    if (e.pointY < room.top || e.pointY > room.bottom || e.pointX < room.left || e.pointX > room.right) continue;
    taken?.add(e);
    // every cel it needs has to be in this book, or it is some other level's —
    // and that now includes the flinches and the death, which is the check that
    // would have caught the old cross-chapter mix-up: this chapter's rat has no
    // 3080 to die on and the other chapter's does
    if (!everyAnim(foe).every((a) => a.cels.every((id) => sbk.byId.has(id)))) continue;
    // this page carries a foe by its FEET and {@link foeAnchor} converts, so the
    // record's anchor is converted the other way here, through the same gait cel
    const g = sbk.cels.find((c) => c.id === foe.gait.cels[0]);
    if (!g) continue;
    out.push({
      kind: e.name,
      x: e.pointX + g.width / 2 - g.posX,
      y: e.pointY + g.height - g.posY,
      // the record's own param, for the kinds whose creator takes it as the
      // facing — everything else stands the way the art is drawn
      facing: foe.facesByParam && e.param ? 1 : -1,
      left: e.left,
      right: e.right,
      top: e.top,
      bottom: e.bottom,
      asleep: foe.wake ? true : undefined,
      decisions: foe.drives?.decisions,
      clock: 0,
      state: "gait",
      // a dormant thing holds one cel and goes nowhere — its own, where its class
      // names one (`0x4386f5` installs cel 1801 over the build's 1940)
      anim: foe.wake ? { ...foe.gait, cels: [foe.wake.cel ?? foe.gait.cels[0]], dx: [0] } : foe.gait,
      linger: 0,
      dents: 0,
      vx: 0,
      vy: 0,
      hp: foe.health,
      max: foe.health,
    });
  }
  return out;
}

/**
 * Every `initelevator` in this room, each as a car that IS a platform.
 *
 * CITY places five and no other book places any, which is the same shape the
 * planks have: a class only the second level uses, with its art (cels 1160..1163)
 * sitting in that book's directory and placed by nothing in its backdrop.
 *
 * The record's rect is the SHAFT and the car's surface travels between its two
 * ends. That is a reading of the data rather than a convenience: the bottom of
 * all five shafts lands within 9..21 pixels of a real platform top, and #102's
 * top matches platform #105's to three pixels — the shaft says where the car
 * goes, not merely where it is drawn.
 *
 * The car's floor is APPENDED to the room's platforms because the disc has none
 * for it. `0x450dc0` calls `0x42fb70`, the plank's "claim the platform record
 * containing my point", and no elevator's point lands inside any platform in
 * CITY — all five checked — so the engine is appending one at runtime and so is
 * this. See {@link ELEVATOR} for the state machine and for the one guess in it.
 */
function elevatorsIn(sbk: SbkFile, room: SbkRoom, solids: Solids, planks: readonly Plank[]): Elevator[] {
  // a platform has ONE owner: `0x42fb70` refuses a record something already
  // holds, and the planks were claimed first. No CITY landing is also a plank's
  // floor, so this changes nothing today and stops a level that did from handing
  // one record to two movers
  const taken = new Set<unknown>(planks.map((k) => k.floor).filter(Boolean));
  const out: Elevator[] = [];
  for (const e of sbk.entities) {
    if (!e.isEntity || e.name !== "initelevator") continue;
    const cy = (e.top + e.bottom) >> 1;
    const cx = (e.left + e.right) >> 1;
    if (cy < room.top || cy > room.bottom || cx < room.left || cx > room.right) continue;
    // the cels are one book's, exactly as the planks' are: only CITY carries these
    if (![...ELEVATOR.car.cels, ...ELEVATOR.idle.cels].every((id) => sbk.byId.has(id))) continue;
    // `0x42fb70` at the shaft's BOTTOM — the car starts on its landing and owns it
    const floor = solids.platforms.find(
      (q) => !taken.has(q) && e.pointX >= q.left && e.pointX < q.right && e.bottom >= q.top && e.bottom < q.bottom,
    );
    if (!floor) continue;
    taken.add(floor);
    out.push({
      x: e.pointX,
      y: e.bottom,
      winchY: e.top,
      // from its landing up to 200px shy of the shaft's head — `0x453606`, and
      // the 200 is the winch's room, not travel
      bottom: floor.top,
      top: floor.top - Math.max(0, e.bottom - e.top - ELEVATOR.headroom),
      state: "idle",
      clock: 0,
      dir: -1,
      floor,
    });
  }
  return out;
}

/**
 * Every `initplank` standing in this room, each holding the platform it owns.
 *
 * The ownership is the engine's `0x42fb70`, which the plank's creator calls: the
 * platform whose rect contains the plank's own POINT becomes the plank's, and only
 * if nothing has claimed it already. CITY lays every one of its twenty planks
 * inside a platform record for exactly this.
 */
function planksIn(sbk: SbkFile, room: SbkRoom, solids: Solids): Plank[] {
  const taken = new Set<SbkEntity>();
  const out: Plank[] = [];
  for (const e of sbk.entities) {
    if (!e.isEntity || e.name !== "initplank") continue;
    const cy = (e.top + e.bottom) >> 1;
    const cx = (e.left + e.right) >> 1;
    if (cy < room.top || cy > room.bottom || cx < room.left || cx > room.right) continue;
    // the cels are one book's: only CITY carries 1050..1061
    if (!PLANK.intact.cels.every((id) => sbk.byId.has(id))) continue;
    const floor =
      solids.platforms.find(
        (q) => !taken.has(q) && e.pointX >= q.left && e.pointX < q.right && e.pointY >= q.top && e.pointY < q.bottom,
      ) ?? null;
    if (floor) taken.add(floor);
    out.push({
      x: e.pointX,
      y: e.pointY,
      left: e.left,
      right: e.right,
      state: "intact",
      clock: 0,
      crossings: 0,
      vy: 0,
      floor,
    });
  }
  return out;
}

/**
 * Every `initcrow` in this room, perched where the record's point puts it.
 *
 * Its rect is its territory and the trigger both: `0x451ba3` tests the player's
 * own point against it and that is what wakes the bird. CITY places twelve, each
 * one 148 wide and 300 tall — a column of air over a rooftop.
 */
function crowsIn(sbk: SbkFile, room: SbkRoom): Crow[] {
  const out: Crow[] = [];
  for (const e of sbk.entities) {
    if (!e.isEntity || e.name !== "initcrow") continue;
    const cy = (e.top + e.bottom) >> 1;
    const cx = (e.left + e.right) >> 1;
    if (cy < room.top || cy > room.bottom || cx < room.left || cx > room.right) continue;
    if (!CROW.sleep.cels.every((id) => sbk.byId.has(id))) continue;
    out.push({
      x: e.pointX,
      y: e.pointY,
      top: e.top,
      left: e.left,
      bottom: e.bottom,
      right: e.right,
      state: "sleep",
      clock: 0,
      vy: 0,
      factor: 1,
      slack: CROW.jitter[0],
    });
  }
  return out;
}

/**
 * Where to put the player when a level opens.
 *
 * The file does not say. A level has between one and five `initplayer` records
 * — STREETS three, BARREL five — and only three in the whole game are drawn at
 * player size (STREETS' 102x148, SEWER's 134x195, BARREL's 30x35); the rest are
 * 20x20 markers, the same size as every `stat` pickup. Checkpoints, most likely,
 * but that is a guess and not one worth acting on.
 *
 * So: the first one, which is right for fourteen of the sixteen levels — except
 * that MAZE's first and BARREL's first stand in a room with no floor, where
 * there is nothing to stand on and no way to move. For those two, the first that
 * lands in a room with a floor. This is a choice about where to start and not a
 * claim about the format.
 */
function pickStart(sbk: SbkFile, rooms: SbkRoom[]): SbkEntity | undefined {
  const starts = sbk.entities.filter((e) => e.name === "initplayer");
  const onAFloor = starts.find((e) => {
    const y = (e.top + e.bottom) / 2;
    const x = (e.left + e.right) / 2;
    const host = rooms.find((r) => y >= r.top && y <= r.bottom && x >= r.left && x <= r.right);
    return host?.ground != null;
  });
  return onAFloor ?? starts[0];
}

/**
 * The room the spawn point falls in: the one whose rect holds it, and failing
 * that the one whose floor runs under it. A level with neither still gets a
 * room, so that walking is never impossible for want of a lookup.
 */
function roomAt(x: number, y: number): SbkRoom {
  const rooms = level!.rooms;
  const covers = (r: SbkRoom): boolean =>
    r.ground !== null && x >= r.ground.x0 && x < r.ground.x0 + r.ground.ys.length;
  return (
    rooms.find((r) => y >= r.top && y <= r.bottom && x >= r.left && x <= r.right && covers(r)) ??
    rooms.find((r) => y >= r.top && y <= r.bottom && x >= r.left && x <= r.right) ??
    rooms.find(covers) ??
    rooms[0]
  );
}

/** move into a room, standing on its floor at `x` — `y` for a room with none */
function enter(room: SbkRoom | undefined, x: number, y: number): void {
  p.room = room ?? null;
  p.x = x;
  p.y = groundAt(x) ?? y;
  p.vy = 0;
  p.onGround = true;
  p.climbing = false;
  p.act = null;
}

/**
 * How far a room can be walked: where its rect and its floor BOTH reach.
 *
 * The two disagree, and neither is reliably the wider. STREETS' street runs
 * 1623…10104 as a rect and 1458…10246 as a floor, and its art stops at 10112 —
 * so the floor's last 134px are past the end of the level, and walking them
 * takes the player out of the drawn world. TOWER's top room is the other way
 * round: rect 16970…18246, floor 17225…17987.
 *
 * The designers bounded the player with `obstacle` where they wanted a wall —
 * STREETS has exactly one and it is the left-hand end, at x1344…1649. Nothing
 * stops the right, so the right must be structural, and the tightest structure
 * the file offers is where the two agree.
 */
function roomSpan(room: SbkRoom): { lo: number; hi: number } | null {
  if (!room.ground) return null;
  const lo = Math.max(room.left, room.ground.x0);
  const hi = Math.min(room.right, room.ground.x0 + room.ground.ys.length - 1);
  return hi > lo ? { lo, hi } : { lo: room.ground.x0, hi: room.ground.x0 + room.ground.ys.length - 1 };
}

/** the floor under x in the room the player is in, or null past its ends */
function groundAt(x: number): number | null {
  const g = p.room?.ground;
  if (!g) return null;
  const i = Math.round(x) - g.x0;
  return i < 0 || i >= g.ys.length ? null : g.ys[i];
}

/** what the player is standing in front of right now */
function solids(): Solids {
  const i = level && p.room ? level.rooms.indexOf(p.room) : -1;
  return level && i >= 0 ? level.solids[i] : { platforms: [], obstacles: [], ladders: [], goal: undefined };
}

/**
 * The first surface a falling player would meet between `fromY` and `toY`.
 *
 * The room's floor and every platform top under x, whichever is highest inside
 * the span — so a fall stops at the first thing it crosses rather than the
 * lowest. Both ends are inclusive at the top so that standing still, where the
 * floor is exactly at the feet, keeps landing on it.
 *
 * A platform is caught only if the player is over it: `left <= x < right`, which
 * is `SC.EXE`'s own point-in-rect at `0x434200` (inclusive low, exclusive high)
 * applied to the one edge that matters here.
 */
/**
 * The same test, SWEPT along the tick's whole path rather than taken at its end.
 *
 * A tick moves the player up to 3.75px across and 12px down, and a roof's edge is
 * a point: crossing it diagonally, the x that has the roof under it and the y that
 * is still above the roof's top can belong to different ticks, and then nothing
 * is ever under the player again. That is exactly how STREETS' gap stopped being
 * jumpable when gravity went up — the landing was not missed by height, it was
 * missed by one tick of tunnelling — so the path is sampled at 2px of travel
 * rather than tested once at the end.
 */
function surfaceCrossed(x0: number, y0: number, x1: number, y1: number): number | null {
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) / 2));
  for (let i = 1; i <= steps; i++) {
    const a = (i - 1) / steps;
    const b = i / steps;
    const hit = surfaceUnder(x0 + (x1 - x0) * b, y0 + (y1 - y0) * a, y0 + (y1 - y0) * b);
    if (hit !== null) return hit;
  }
  return null;
}

function surfaceUnder(x: number, fromY: number, toY: number): number | null {
  let best: number | null = null;
  const g = groundAt(x);
  if (g !== null && g >= fromY && g <= toY) best = g;
  /**
   * ...and the platforms are the LEVEL's, not the room's.
   *
   * The engine keeps one table for them — `0x4a69d0`, rebuilt every frame from
   * every `platform` record in the book, twelve bytes a row — and `0x42fd80`
   * searches the whole of it. A region owns a floor; it does not own the ledges.
   * Level seven is where the difference shows: the plank across the bottom of
   * its last two rooms runs from x6147 to x9471 and its middle is in the second,
   * so filing it by its centre left the first with nothing under it and dropped
   * the player out of the world at the foot of its own shaft.
   */
  for (const room of level?.solids ?? []) {
    for (const e of room.platforms) {
      if (x < e.left || x >= e.right) continue;
      if (e.top < fromY || e.top > toY) continue;
      if (best === null || e.top < best) best = e.top;
    }
  }
  return best;
}

/**
 * An `obstacle` is a volume your ANCHOR may not be inside — and this page had it
 * as a box your whole sprite may not touch, which made CITY impassable.
 *
 * `0x430146` is the engine's rule, in the same mover that steps every object:
 *
 * ```
 *   if (obj+0x36 == 0) skip                     ; a per-object opt-out
 *   for each of [0x46b9b0] records at 0x4a8a10, stride 0x30:
 *     if (!0x434200(obj's point, record + 2)) continue    ; POINT in rect
 *     obj+0x2c = 1                              ; it is inside one
 *     take the SMALLEST of the four penetrations:
 *       0  point.y - rect.y0     up             3  rect.x1 - point.x   east
 *       1  point.x - rect.x0     west           2  rect.y1 - point.y   down
 *     and move the object that far along that axis, scaling the velocity it had
 *     on that axis by obj+0x20 >> 13 — a restitution
 * ```
 *
 * Two things follow, and CITY is built on both. The test is the object's own
 * point, so **being above an obstacle is a matter of one pixel and not of a whole
 * sprite**: CITY's first wall is the west side of a wooden water tank, rect
 * `y3852..4160, x1873..1933`, with the tank's roof a `platform` at y3920 starting
 * at the same x. Standing on the walkway below (feet 4041, anchor 3953) the wall
 * ejects you west; a jump that lifts the anchor past 3852 — 101 pixels — is over
 * it, and the roof platform catches the feet. Tested as a BOX that needed the
 * sprite's whole 148 rows clear of y3852, which is 189 pixels of jump: there is no
 * such jump, and the level ended there.
 *
 * And an obstacle is not a surface. The engine ejects UPWARD when that is the
 * shortest way out, which lands the anchor on the rect's top edge with the feet 88
 * rows inside it — so what you actually stand on is the `platform` record laid
 * along the top, which every one of these obstacles has. A wall is the two records
 * together.
 */
function ejectFromObstacles(): void {
  // the engine's point is the object's own y, which is the cel's anchor — this
  // page keeps `p.y` at the feet, so the standing cel's box bottom converts it.
  // A fixed offset on purpose: the engine's y does not move when the pose does,
  // and the airborne cels' boxes are 19 rows shallower than the standing one's.
  const ay = p.y - p.feet;
  for (const e of blockers()) {
    // `0x434200`: x0 <= x < x1 and y0 <= y < y1, and nothing else
    if (!(p.x >= e.left && p.x < e.right && ay >= e.top && ay < e.bottom)) continue;
    const up = ay - e.top;
    const west = p.x - e.left;
    const down = e.bottom - ay;
    const east = e.right - p.x;
    const least = Math.min(up, west, down, east);
    if (least === up) {
      p.y -= up;
      if (p.vy > 0) p.vy = 0;
    } else if (least === west) p.x -= west;
    else if (least === down) {
      p.y += down;
      if (p.vy < 0) p.vy = 0;
    } else p.x += east;
  }
}

/**
 * The ladder the player is AT, and it is a point test — which is a hundred
 * pixels narrower than what this page had.
 *
 * `0x40b940` is the engine's record finder and its kind 2 is "the record whose
 * rect contains this point": it walks the entity table and calls
 * `0x434200(point, rect + 2)`, and `0x434200` is four comparisons against one
 * `(y, x)` — the player's own position — with no box and no sprite in it.
 *
 * So the trigger is the rect and nothing more. STREETS' is `x9632..9779`, 147px
 * against a painted ladder (cel 1100, placed three times) of 48 at x9673..9721:
 * generous, 41px of slack west and 58 east, and the file's own. Testing the
 * player's whole 98px-wide sprite box against it instead — which is what this did
 * — spread that to x9583..9828 and 245px, and it read as grabbing at nothing.
 *
 * The y stays a body overlap, and that part is not settled: the engine's own mount
 * arithmetic (`0x42b307`) explicitly handles a player BELOW the rect, so whatever
 * test admits them there is not this rect either. STREETS' ladder stops 123px
 * above the pavement at its foot, so a point test on y would put it out of reach.
 */
function onLadder(): SbkEntity | undefined {
  const b = playerBox();
  return solids().ladders.find((e) => p.x >= e.left && p.x < e.right && b.bottom > e.top && b.top < e.bottom);
}

// ---- input ---------------------------------------------------------------

/**
 * `SC.EXE`'s own bindings — and **W is the run, not "up"**.
 *
 * Two tables settle this together. The 256-byte one at `0x46b210`, which
 * `0x403b90` indexes with the uppercased character, gives an action code; then
 * `0x402be0` adds 8 and jumps through the 20-entry table at `0x402d54`, where
 * every entry is a one-line handler that sets or clears a single global. Reading
 * both and joining them on the action code:
 *
 * ```
 *   W  action  1  ->  [0x4ac3fe] = 1        S  action 3  ->  [0x4ac3fc] = 1
 *   D  action  2  ->  toward   (by facing)  A  action 4  ->  away  (by facing)
 *   P  action  5  ->  [0x4ac394] = 1        K  action 6  ->  [0x4ac404] = 1
 *   I  action  7  ->  [0x4ac386] = 1        J  action 8  ->  [0x4ac3da] = 1
 *   -               (action 10 spawn cycler, action 11 character switch: unbound)
 * ```
 *
 * `0x4ac3fe` — W — is read by every one of the player's movement states, and
 * what it does is context-dependent, one flag with two jobs:
 *
 * - **on the ground it RUNS.** The walk state `0x429990` tests it first of all
 *   (`cmp word ptr [0x4ac3fe], 0`) and installs `0x471988` tag 0, dx 180, on the
 *   way through. That is 330px a second against the walk's 180, and it is the
 *   speed the game actually travels at.
 * - **on a ladder it CLIMBS.** The ladder state `0x42ae50` tests the same flag
 *   four times over, installing the climb script `0x471e78` and decrementing a
 *   rung counter at `0x4ac406` each time — so a ladder is counted in rungs.
 *
 * Which is why this page felt slow: it had W as "up", the run had no key at all,
 * and the game only ever walked. Holding it now does both jobs, as the original
 * does. The other four are the band's own labels: J jumps, K and P are the two
 * attack sets, I is INV. And the character codes 24…27 are aliases for P, K, J
 * and I rather than arrow keys — the arrows here are this port's, kept alongside
 * WASD because a page is not a 1996 game.
 */
const KEYS: Readonly<Record<string, keyof typeof held>> = {
  ArrowLeft: "left",
  a: "left",
  ArrowRight: "right",
  d: "right",
  ArrowUp: "up",
  w: "up",
  ArrowDown: "down",
  s: "down",
  j: "jump",
  " ": "jump",
  k: "kick",
  p: "punch",
  i: "inv",
};
addEventListener("keydown", (e) => {
  wakeAudio();
  // the chooser is a real form control: while it has the focus, its own keys are
  // its own (the engine's `focusOwnsKey` is the same test the films page makes)
  if (focusOwnsKey(e.target, e.key)) return;
  // a film owns the keyboard while it runs, and ESC is what the films' own
  // header bit permits — see Film.skip
  if (film) {
    if (e.key === "Escape") film.skip();
    e.preventDefault();
    return;
  }
  // the interface toggle goes first, because P is also the punch: Ctrl+P is the
  // original's own chord and it must not land on the fist
  if (e.ctrlKey && (e.key === "p" || e.key === "P")) {
    iface = !iface;
    e.preventDefault();
    return;
  }
  const k = KEYS[e.key];
  if (k === "up" && !held.up) upPressed = true;
  if (k === "jump" && !held.jump) jumpPressed = true;
  if (k === "punch" && !held.punch) punchPressed = true;
  if (k === "kick" && !held.kick) kickPressed = true;
  if (k) held[k] = true;
  // the damage switch — see {@link HURT}. It starts off, and `?damage=1` is the
  // same switch thrown before the level loads
  else if (e.key === "h" || e.key === "H") {
    damageOn = !damageOn;
    if (!damageOn) stats.health = stats.maxHealth;
  } else if (e.key === "[") void loadLevel((levelIndex + 15) % 16);
  else if (e.key === "]") void loadLevel((levelIndex + 1) % 16);
  else if (e.key === "n") cycleSpawn();
  // M is this page's own, and it is the only key here that is: the original's
  // table has no mute in it — see {@link Sounds.toggle}
  else if (e.key === "m" || e.key === "M") sound?.toggle();
  else return;
  e.preventDefault();
});
addEventListener("keyup", (e) => {
  const k = KEYS[e.key];
  if (k) held[k] = false;
});
// touch: hold a screen half to walk that way, the top third to jump or climb
canvas.addEventListener("pointerdown", (e) => {
  wakeAudio();
  // a tap skips a film, the way it does on the films page
  if (film) {
    film.skip();
    return;
  }
  const r = canvas.getBoundingClientRect();
  const leftHalf = e.clientX - r.left < r.width / 2;
  const high = e.clientY - r.top < r.height / 3;
  const low = e.clientY - r.top > (r.height * 2) / 3;
  held.left = leftHalf && !high && !low;
  held.right = !leftHalf && !high && !low;
  // one finger, two jobs: the top third means "up", and up that finds no door
  // and no ladder becomes a jump, which is the only way to give a touchscreen
  // both without a second control
  if (high && !held.up) {
    upPressed = true;
    jumpPressed = true;
  }
  held.up = high;
  held.jump = high;
  held.down = low;
  canvas.setPointerCapture(e.pointerId);
});
const lift = (): void => {
  held.left = held.right = held.up = held.down = held.jump = false;
  held.punch = held.kick = false;
};
canvas.addEventListener("pointerup", lift);
canvas.addEventListener("pointercancel", lift);

/**
 * The player's collision box: the drawn cel's own size, standing on the ground.
 *
 * The disc's, by way of the art — the sprite is as wide as it is drawn. (The
 * `initplayer` records are no help: STREETS has three and only one is
 * player-sized, the other two being 20px markers like every `stat` pickup.)
 * A door's rect sits at BODY height, not foot height — STREETS' street door ends
 * at y1348 and the pavement under it is at y1362 — so the test has to be an
 * overlap of boxes and not "is the point in the rect".
 */
function playerBox(): { top: number; left: number; bottom: number; right: number } {
  const art = player && playerCel(player.byId.get(ANIM.idle[0]) ?? -1);
  const w = art?.width ?? 100;
  const h = art?.height ?? 148;
  return { top: p.y - h, left: p.x - w / 2, bottom: p.y, right: p.x + w / 2 };
}

/**
 * Press up in an `exitroom` and you are in the room its param names.
 *
 * Press, not touch. Two builds tried touching — first plain contact, which
 * bounced the player between the street and the basement for as long as an arrow
 * was held, then contact plus the direction the door's point implies, which
 * stopped the bouncing and trapped the player in the basement instead. Both fail
 * for the same reason, and the file says why: STREETS' street door stands
 * between the spawn and the goal, and its own arrival point is eight pixels
 * beyond its right edge while the player is a hundred wide. You always come out
 * of a door still standing in it. So entering one has to be something you do.
 */
function takeDoor(): boolean {
  const room = p.room;
  if (!room || !level) return false;
  const b = playerBox();
  const hit = room.exits.find(
    (e) => b.right >= e.left && b.left <= e.right && b.bottom >= e.top && b.top <= e.bottom,
  );
  if (!hit) return false;
  const dest = level.rooms.find((r) => r.param === hit.to);
  if (!dest) return false;
  const at = arrivalIn(dest, room);
  if (!at) return false; // a room with no floor is not somewhere to be put
  p.room = dest;
  // the file's point says where beside the door; the floor says how high
  p.x = at.x;
  p.y = groundAt(at.x) ?? at.y;
  p.vy = 0;
  p.onGround = true;
  return true;
}

/**
 * The enemies the current act has already struck — one hit per swing, cleared
 * when a new act starts, so a kick that overlaps for six ticks is one hit.
 */
const struck = new Set<Enemy>();

/**
 * The player's `obj+0x1a`, the percentage `0x42f910` scales a blow by.
 *
 * 100, and that is not quite a read: `0x42e463` writes the field from a register
 * inside the player's 2435-byte state machine and the value has not been traced.
 * But every class in the game writes `0x64` there, and `0x42f910` special-cases
 * exactly 100 and 101 to skip the scaling altogether — so 100 is the neutral
 * value the field was built around, and a blow at 100% is the cel's own number.
 */
const BLOW_PERCENT = 100;

/**
 * The strike box of the cel the player is showing this frame, in world
 * coordinates, with the blow it carries — or null, which is most frames.
 *
 * This is the whole of the engine's attack test and it is entirely in the file.
 * A cel record carries a strike rect at +4 and a `(dy, dx)` at +20 ({@link
 * SbkCel.strike}, {@link SbkCel.blow}), 42 of `PLAYER.SBK`'s 1229 cels have them,
 * and they are the impact frames: the punch lands on cels 602 and 604 and the
 * kick on 655, each with a two-dozen-pixel box where the fist or the boot
 * actually is. Every other frame of the animation cannot hit anything.
 *
 * The box is anchor-relative, so it is placed the way this page places the cel:
 * centred on `p.x` with the feet at `p.y`, which puts the anchor `(posX, posY)`
 * into that. Facing left reflects it about the anchor, which is what the engine's
 * own rect builder does on mirror (`0x4026d0`) — not about the cel's centre.
 */
function strikeBox():
  | { top: number; left: number; bottom: number; right: number; damage: number; blow: { dx: number; dy: number } }
  | null {
  if (!player) return null;
  const rec = player.cels.find((c) => c.id === lastCel);
  if (!rec?.strike || !rec.blow) return null;
  const s = rec.strike;
  // in the cel's own pixels, measured from its LEFT edge — because that is where
  // the box has to be mirrored. This page draws the player centred on `p.x` and
  // flips the cel within that band, so facing left reverses the box inside the
  // cel and not about the anchor. Reflecting about the anchor is what the engine's
  // own rect builder does, and doing it here put the kick's box 165px behind the
  // player: cel 663's anchor is at `posX -12`, outside its own art, so the two
  // conventions disagree by more than the cel is wide.
  const band = p.x - rec.width / 2;
  const [cx0, cx1] =
    p.facing < 0
      ? [rec.width - (rec.posX + s.x1), rec.width - (rec.posX + s.x0)]
      : [rec.posX + s.x0, rec.posX + s.x1];
  const ay = p.y - rec.height + rec.posY;
  // damage IS speed: the cel's own pair, scaled by the striker's percentage, plus
  // whatever the striker was already doing — so a running kick hits harder than a
  // standing one, which is `0x42f910` adding `obj+0xa`/`obj+0xc` before the root
  const dx = (rec.blow.dx * BLOW_PERCENT) / 100 + (p.running ? MEASURED.run : p.moving ? MEASURED.walk : 0) / DIVISOR;
  const dy = (rec.blow.dy * BLOW_PERCENT) / 100 + p.vy;
  return {
    left: band + cx0,
    right: band + cx1,
    top: ay + s.y0,
    bottom: ay + s.y1,
    damage: Math.round(Math.hypot(dx, dy)),
    // the pair itself, because the spray leaves along the blow rather than along
    // its magnitude — `0x40cba0` takes the same `(dy, dx)` this came from
    blow: { dx, dy },
  };
}

/**
 * The velocity a blow leaves the thing it hit with — `0x430470`, the engine's own
 * elastic collision, with `obj+0xe` as the mass.
 *
 * The dispatcher `0x430350` calls the victim's hit handler and then, if the
 * hitter is still live, this: for each axis,
 * `v = (v1·2·m1 + v2·(m2 − m1)) / (m1 + m2)`. The player is 12 and a mailbox 7, so
 * a kick's 55 comes out as 55 × 24/19 = 69 pixels a frame — a thousand a second,
 * which is why the original throws a mailbox most of a screen.
 */
function knockback(foe: Foe, blow: { dx: number; dy: number }, was: { vx: number; vy: number }): { vx: number; vy: number } {
  const m1 = DIVISOR;
  const m2 = foe.divisor;
  const solve = (v1: number, v2: number): number => (v1 * 2 * m1 + v2 * (m2 - m1)) / (m1 + m2);
  return {
    vx: solve(blow.dx, was.vx / TICK_SCALE) * TICK_SCALE,
    vy: solve(blow.dy, was.vy / TICK_SCALE) * TICK_SCALE,
  };
}

/**
 * Where a spawned thing's ANCHOR is, in the world.
 *
 * Every cel carries one (`posX`, `posY`) and `0x4026d0` places a cel so that its
 * anchor lands at the object's position — which is the only thing that makes an
 * animation whose cels are different sizes hold together. The rat's launch is the
 * case that forces this: `0x477090` runs 3040 through 3048 and the cels go from
 * 111x53 to 115x259 to 132x87, and their anchors follow one point on the rat
 * while the art around it looms (3046 reaches 137px ABOVE the anchor) and then
 * drops away (3048's `posY` is −35, so the whole cel hangs BELOW it). Hung from
 * their feet, as this page hung every enemy cel until now, that animation is a rat
 * growing upwards out of the pavement and off the top of the window.
 *
 * What the object's own y IS in the engine has not been read — the punk's walking
 * cel anchors 63px above its own feet, so it is not the ground. So the anchor is
 * derived from the placement this page already had verified: the GAIT cel, feet on
 * the floor and centred. For the gait that is a no-op, and every other cel of the
 * kind then hangs off the same point the artist kept fixed.
 */
function foeAnchor(e: Enemy, lvl: Level): { x: number; y: number } | null {
  const g = lvl.sbk.cels.find((c) => c.id === FOES[e.kind].gait.cels[0]);
  if (!g) return null;
  return { x: e.x - g.width / 2 + g.posX, y: e.y - g.height + g.posY };
}

/**
 * The world y of what actually touches the floor: the bottom of the CURRENT cel's
 * collision box.
 *
 * Every cel carries its own, and for a thing that changes shape they are not the
 * same box. The mailbox is the case: upright, cel 2410's box reaches 93 pixels
 * below the anchor; on its side, cel 2413's reaches 56. Landing a fallen mailbox
 * where the upright one's base would go leaves it floating 37 pixels up, which is
 * what this page did until the two boxes were told apart.
 *
 * For a gait cel the box bottom and the cel's own extent agree to within a pixel,
 * which is why the standing placement never needed this.
 */
function baseOf(e: Enemy, lvl: Level): number {
  const a = foeAnchor(e, lvl);
  const c = lvl.sbk.cels.find((q) => q.id === celOf(e));
  if (!a || !c) return e.y;
  return a.y + (c.body ? c.body.y1 : c.height - c.posY);
}

/**
 * The box a spawned thing can be hit IN — its cel's own collision rect where it
 * has one, and the drawn cel where it has not.
 *
 * 741 of `PLAYER.SBK`'s cels carry one and only 43 of those are the cel's own
 * extent, so this is authored art-department data and not a bounding box: the
 * punk's walking frame is 103 wide and its box is 82, tighter on both sides. And
 * the rat's is why nothing standing can hit one: it tops out at `y -14` where the
 * punch's fist box bottoms out at `y -16`.
 */
function hurtBox(e: Enemy, c: SbkCel, lvl: Level): { top: number; left: number; bottom: number; right: number } {
  const a = foeAnchor(e, lvl);
  const b = e.facing > 0 && c.body ? { ...c.body, x0: -c.body.x1, x1: -c.body.x0 } : c.body;
  return a && b
    ? { left: a.x + b.x0, right: a.x + b.x1, top: a.y + b.y0, bottom: a.y + b.y1 }
    : { left: e.x - c.width / 2, right: e.x + c.width / 2, top: e.y - c.height, bottom: e.y };
}

/**
 * What the interface panel shows, and where each figure comes from.
 *
 * The score and the two bars are real: the score is the sum of the awards the
 * classes themselves carry, and the enemy bar is the health `SC.EXE` gives them.
 * The other three are this page standing in for a level script it does not read:
 *
 *   - **lives** start at three of a maximum five (`0x40d400` clamps to five, and
 *     the game's own help screen shows three lit) and never change, because
 *     nothing here can kill the player.
 *   - **the kill quota** is the disc's per-level figure, set through one of the
 *     four script wrappers around `0x40d4a0`; with no script read, this counts
 *     what is still standing in the level instead.
 *   - **the mission clock** is a per-level figure, and it is a RECORD: see
 *     {@link clockFor}.
 */
const stats = {
  score: 0,
  lives: 3,
  /** `[0x4ac3d0]` and `[0x4ac3d8]` — and only {@link damageOn} ever spends it */
  health: HURT.max as number,
  maxHealth: HURT.max as number,
  /** what this level stood up with, and how many of them may still stand */
  census: 0,
  allowance: 0,
  /** engine frames left, counted down at the engine's rate */
  ticks: CLOCK_FULL,
  /** whoever holds the right-hand bar — sticky, the way `0x46bd28` makes it */
  shown: null as HudFighter | null,
};

/**
 * Land the current act on anything it overlaps, and do to it what the class's
 * own hit handler does.
 *
 * The TEST is the engine's own kind of test — plain rect intersection
 * (`0x434140`) of the two DRAWN cels — so an attack reaches exactly as far as
 * its art does: the kick's 663 is 115 wide against the 71 standing, and that
 * widening is the reach.
 *
 * What follows a landed blow is the handler's own sequence, in its own order
 * (`0x44f0a0` for the punk, and every other one in the game is the same shape):
 * the spray first, then the subtraction, then either the death or a flinch.
 *
 * Nothing in it is invented any more. The strike box and the damage come off the
 * cel ({@link strikeBox}), the health and the award off the class, and the flinch
 * off the handler's own test — which is why a punch and a kick now do visibly
 * different things: a punch is 47 and staggers a punk, a kick is 87 and puts it
 * on the ground, because `0x44f1fd` compares the blow with 50. A punk takes six
 * punches or three kicks to its 250.
 *
 * Furniture takes the same path with `Infinity` health: a mailbox flinches and
 * never dies, and `0x44fe80` picks WHICH dent by the same speed — 10 to mark it,
 * 55 to cave it in, so again a punch dents and a kick caves.
 */
/**
 * The animation one act plays, including the two that are not in
 * {@link ACTIONS} because they are not the fists'.
 *
 * `reach` is `0x472360`, the game's one kind-14 script, and `fire` is whichever
 * weapon is in your hands — its own script's wind-up tag followed by whatever
 * it holds afterwards, which for the flare gun is `2720 2721 2722` then `2723`.
 */
function actOf(name: string): { cels: readonly number[]; dx: readonly number[]; hold?: number; from: string } | null {
  if (name === "reach") return { cels: GRAB.cels, dx: GRAB.cels.map(() => 0), from: GRAB.from };
  // the reaction to a blow CODE, straight off the table at `0x4492b8`
  const code = Object.values(BLOW_CODES).find((r) => r.act === name);
  if (code) return { ...code.anim, dx: code.anim.cels.map(() => 0) };
  if (name === "held") return { ...HELD.loop, dx: HELD.loop.cels.map(() => 0) };
  if (name === "struggle") return { ...HELD.struggle, dx: HELD.struggle.cels.map(() => 0) };
  if (name === "fire") {
    const w = WEAPONS[inv.weapon];
    if (!w) return null;
    const cels = [...w.moveset.fire, ...w.moveset.shot];
    return { cels, dx: cels.map(() => 0), from: w.moveset.from };
  }
  return ACTIONS[name] ?? null;
}

function landHits(): void {
  if (!level || !player || !p.act) return;
  const i = level.rooms.indexOf(p.room!);
  if (i < 0) return;
  const mine = strikeBox();
  if (!mine) return; // this frame of the animation is not an impact frame
  // the crows first, because their own handler is the shortest in the game: no
  // health test at all, so any blow that reaches one takes it
  for (const c of level.crows[i]) {
    if (c.state === "tumble" || struckCrows.has(c)) continue;
    const art = level.sbk.cels.find((q) => q.id === crowCel(c));
    if (!art) continue;
    const box = {
      left: c.x - art.posX,
      right: c.x - art.posX + art.width,
      top: c.y - art.posY,
      bottom: c.y - art.posY + art.height,
    };
    if (!(mine.right > box.left && mine.left < box.right && mine.bottom > box.top && mine.top < box.bottom)) continue;
    struckCrows.add(c);
    strikeCrow(c, mine.damage);
  }
  const pool = level.spawned[i];
  for (const e of [...pool]) {
    // and once it has toppled it is out of the fight, the way `0x44fe80` opens
    // with `if (obj+0x18 != 2)`; the water is not a thing at all — its cels carry
    // no collision box, which is how the format says so
    if (struck.has(e) || e.state === "dead" || e.state === "burst") continue;
    if (e.state === "flinch" && e.anim.terminal) continue;
    const foe = FOES[e.kind];
    const c = level.sbk.cels.find((c) => c.id === celOf(e));
    if (!c) continue;
    const box = hurtBox(e, c, level);
    if (!(mine.right > box.left && mine.left < box.right && mine.bottom > box.top && mine.top < box.bottom)) continue;
    struck.add(e);
    strikeFoe(e, mine.damage, mine.blow, p.facing, (mine.top + mine.bottom) / 2, box);
  }
}

/**
 * What a landed blow DOES to one creature — the class handler's own sequence,
 * lifted out of {@link landHits} so that something other than a fist can land
 * one. A flare is the other thing: {@link FLARE} gives it 100 and `0x43ad80`
 * hands it to the same handler a punch goes through.
 *
 * `from` is which way the blow travelled (the shove is along it) and `mid` is
 * how high it landed, which is the second thing a handler's flinch picks on.
 */
function strikeFoe(
  e: Enemy,
  damage: number,
  shove: { dx: number; dy: number },
  from: number,
  mid: number,
  box: { top: number; left: number; bottom: number; right: number },
): void {
  if (!level) return;
  const foe = FOES[e.kind];
  // the spray goes first, exactly as `0x40cba0` is called before the subtract —
  // and only for the kinds whose handler calls it at all
  if (foe.bleeds) spray(e, damage, shove);
  // and the kind's own sound, at the thing that was hit — see FOE_SFX for which
  // handler plays which index
  if (foe.hitSound !== undefined) {
    const set = foe.hitSound;
    sound?.effect(typeof set === "number" ? set : set[Math.floor(Math.random() * set.length)], e.x, e.y);
  }
  // the fourth kind's handler keeps the damage only for the blood and takes a
  // single point off the health — `0x454821`, and see {@link Foe.oneHitEach}
  e.hp -= foe.oneHitEach ? 1 : damage;
  // knocked the way the blow travels, kept inside its own territory — unless it
  // is bolted down, which a hydrant is (`0x44fb43` re-pins it every frame)
  if (!foe.rooted) e.x = Math.max(e.left, Math.min(e.right, e.x + from * 20));
  e.dents += 1;
  // and the momentum, for the kinds that keep it
  if (foe.flies) {
    const v = knockback(foe, { dx: shove.dx * from, dy: shove.dy }, e);
    e.vx = v.vx;
    e.vy = v.vy;
  }
  // a frail kind's handler never looks at health: one blow, whatever the blow.
  // The rat is the case, and no corpse lingers — the launch IS the exit.
  if ((foe.frail || e.hp <= 0) && foe.death) {
    // the death sound goes through `0x40f090` rather than `0x40ef30`, which is
    // the same call with a different tail; the port does not tell them apart
    if (foe.deathSound !== undefined) sound?.effect(foe.deathSound, e.x, e.y);
    e.state = "dead";
    e.anim = foe.death;
    e.clock = 0;
    e.linger = foe.frail ? 0 : foe.linger ?? CORPSE_LINGER;
    stats.score += foe.award ?? foe.panel?.award ?? 0;
    return;
  }
  /**
   * ...and the blow that puts it over instead. `0x456496` counts the boss's
   * consecutive hits and every third one installs the knockdown rather than a
   * take. The get-up follows on {@link FoeAnim.then} at its own rate.
   */
  const over = foe.knockdown;
  if (over && e.dents % over.every === 0) {
    sound?.effect(over.sound, e.x, e.y);
    e.state = "flinch";
    e.anim = over.anim;
    e.clock = 0;
    return;
  }
  if (!foe.flinch) return;
  // where the blow landed and which way it was facing — the two things the
  // handler consults besides the damage
  const blow = {
    damage,
    // this blow included: `e.dents` was stepped above, and the boss's handler
    // counts its consecutive hits in `AI+0x12` (`0x456461`)
    hits: e.dents,
    dy: Math.abs(mid - (box.top + box.bottom) / 2),
    facingAway: e.facing === from,
  };
  // a progressive kind advances one stage per blow instead of picking; a
  // hydrant's handler switches on the state it is already showing, not on how
  // hard it was hit
  const which = foe.progressive ? e.dents - 1 : foe.pick ? foe.pick(blow) : 0;
  if (foe.progressive && which >= foe.flinch.length) return; // beaten in already
  e.state = "flinch";
  e.anim = foe.flinch[Math.min(foe.flinch.length - 1, Math.max(0, which))];
  e.clock = 0;
}

/**
 * The goo a blow throws — `0x40cba0`, and {@link file://./effects.ts} has the
 * whole of it.
 *
 * One gob per six points of damage up to twenty of them, each leaving along the
 * blow's own direction with the engine's own scatter, each living sixty frames.
 * The blow's direction is the player's facing and the strike's own height, since
 * the engine takes it from the hitting object's type record and the punch and
 * the kick are two different objects there.
 */
function spray(e: Enemy, damage: number, blow: { dx: number; dy: number }): void {
  const from = { x: e.x, y: e.y - 70 };
  for (let n = 0; n < gobCount(damage); n++) {
    gobs.push({
      x: from.x,
      y: from.y,
      // the blow's own pair, scattered, through the effect class's divisor of 2
      vx: (scatter(blow.dx * p.facing) / SPRAY.divisor) * TICK_SCALE,
      vy: (scatter(blow.dy) / SPRAY.divisor) * TICK_SCALE,
      age: 0,
      mirror: Math.random() < 0.5,
      stage: -1,
      holds: 0,
    });
  }
}

/** the goo — in the air, or a puddle on the pavement */
let gobs: Gob[] = [];
/** the green balls bodies leave behind — see {@link VANISH} */
let pops: Pop[] = [];

/**
 * Step every gob: the arc, the landing, the merge and the drying.
 *
 * All of it is `0x40c480`'s except the fall — there is no gravity constant in
 * `SC.EXE`, so a gob falls under the same {@link INVENTED.gravityPx} the player
 * does. What IS the executable's is everything that happens when it arrives: the
 * velocity is zeroed where it lands, a gob landing on an existing puddle advances
 * that puddle instead of making its own, and a puddle steps back down a stage
 * every 40 to 79 frames until it is gone.
 */
function stepGobs(): void {
  const ground = (x: number): number | null => {
    const g = p.room?.ground;
    if (!g) return null;
    const i = Math.round(x) - g.x0;
    return i < 0 || i >= g.ys.length ? null : g.ys[i];
  };
  for (const g of gobs) {
    g.age += TICK_SCALE;
    if (g.stage >= 0) {
      // a puddle: it holds its stage, then dries back one
      g.holds -= TICK_SCALE;
      if (g.holds <= 0) {
        g.stage -= 1;
        g.holds = dryTime();
      }
      continue;
    }
    // the same fall the player takes, per TICK and clamped the same way — see the
    // note above about there being no gravity constant to read for either of them
    g.vy = Math.min(g.vy + INVENTED.gravityPx, INVENTED.maxFallPx);
    g.x += g.vx;
    g.y += g.vy;
    const floor = ground(g.x);
    if (floor === null || g.y < floor) continue;
    // landed. `0x40c810` looks for a puddle already here; if there is one it
    // grows and this gob is spent, which is how twenty gobs make one mess
    const pool = gobs.find((q) => q !== g && q.stage >= 0 && Math.abs(q.x - g.x) < 40);
    if (pool) {
      pool.stage = Math.min(SPRAY.pool.length - 1, pool.stage + 1);
      pool.holds = dryTime();
      g.age = SPRAY.life; // spent: dropped by the filter below
      continue;
    }
    g.y = floor;
    g.vx = 0;
    g.vy = 0;
    g.stage = 0;
    g.holds = dryTime();
  }
  // in the air, sixty frames is all it gets; on the ground, it goes when the last
  // stage has dried
  gobs = gobs.filter((g) => g.stage >= 0 || g.age < SPRAY.life);
  for (const q of pops) q.age += TICK_SCALE;
  pops = pops.filter((q) => q.age < VANISH.cels.length * VANISH.hold);
}

/**
 * Hand the right-hand bar to whoever is nearest, exactly as the engine does.
 *
 * `0x40d1c0` is a competition every enemy enters once a frame: the Manhattan
 * distance from the player has to beat both the best so far and 1024, and the
 * painter resets the best to `0x7fff` afterwards. So the winner is the closest
 * thing within 1024px THIS frame — and when nothing is in range nobody calls,
 * the dirty flags stay clear, and the bar keeps the last one it was given.
 */
function claimBar(): void {
  let best = 1024;
  let won: Enemy | null = null;
  for (const e of spawnedHere()) {
    if (!FOES[e.kind].panel || e.state === "dead") continue;
    const d = Math.abs(p.x - e.x) + Math.abs(p.y - e.y);
    if (d >= best) continue;
    best = d;
    won = e;
  }
  if (!won) return;
  stats.shown = { health: Math.max(0, won.hp), max: won.max, nameCel: FOES[won.kind].panel!.plate };
}

/**
 * Where a hitter's strike box is, in the world — the mirror of {@link strikeBox}.
 *
 * `0x430375` reads the CURRENT cel's own strike rect and skips a hitter whose is
 * degenerate, which is what makes a blow two frames of an animation rather than
 * the whole of it.
 */
function strikeOf(
  cel: SbkCel,
  x: number,
  y: number,
  facing: number,
): { top: number; left: number; bottom: number; right: number } | null {
  if (!cel.strike) return null;
  const band = x - cel.width / 2;
  const [cx0, cx1] =
    facing < 0
      ? [cel.width - (cel.posX + cel.strike.x1), cel.width - (cel.posX + cel.strike.x0)]
      : [cel.posX + cel.strike.x0, cel.posX + cel.strike.x1];
  const ay = y - cel.height + cel.posY;
  return { left: band + cx0, right: band + cx1, top: ay + cel.strike.y0, bottom: ay + cel.strike.y1 };
}

/**
 * The player's own body box, from the cel showing now — and the reason a
 * knockdown is safe.
 *
 * `0x4303b3` skips a victim whose current cel has a degenerate body box, and
 * every reaction cel in `PLAYER.SBK` has none: 5900..5902, 5910..5915,
 * 5940..5944, 9550..9558 and 5020/5021 all carry a strike box or nothing at all.
 * So the player cannot be touched for the whole of a stagger, a knockdown or a
 * death — that, and not a timer, is the invulnerability this engine has.
 */
function playerBody(): { top: number; left: number; bottom: number; right: number } | null {
  const rec = player?.cels.find((c) => c.id === lastCel);
  if (!rec?.body) return null;
  const band = p.x - rec.width / 2;
  const [cx0, cx1] =
    p.facing < 0
      ? [rec.width - (rec.posX + rec.body.x1), rec.width - (rec.posX + rec.body.x0)]
      : [rec.posX + rec.body.x0, rec.posX + rec.body.x1];
  const ay = p.y - rec.height + rec.posY;
  return { left: band + cx0, right: band + cx1, top: ay + rec.body.y0, bottom: ay + rec.body.y1 };
}

/** `0x402ac0` — take it off, floor at zero, and start dying if that empties it */
function takeHealth(n: number): void {
  stats.health = Math.max(0, stats.health - Math.round(n));
  if (stats.health > 0 || p.act === "dying") return;
  // `0x402f60` refuses a second death while the first is playing, and `0x402fa0`
  // installs `0x476758` tag 0 — the kind that IS being dead
  p.act = "dying";
  p.actClock = 0;
  p.vx = 0;
}

/**
 * Where the cel a grabber is showing RIGHT NOW would hold you.
 *
 * The frame-by-frame re-read is the whole of it and not an implementation
 * detail: `0x42857d` fetches the grabber's cel record every frame the held state
 * runs, which is why the hold ends by itself when the fist opens. Reading it
 * once, at the moment of the grab, gives a grip that never goes away — the hand
 * sinks back into the ground with the player still pinned to where it was.
 */
function gripAt(id: number, x: number, y: number): { x: number; y: number } | null {
  const cel = level?.sbk.cels.find((c) => c.id === id);
  return gripOf(cel, cel ? strikeOf(cel, x, y, 1) : null);
}

/**
 * A blow CODE landed: run its row of the table at `0x4492b8`.
 *
 * Returns what the original's handler returns — true where it answered 1, which
 * tells `0x430367`'s loop the blow was consumed. {@link BLOW_CODES} is the whole
 * of the data; this is only the eight side effects the eight cases share.
 *
 * `-9` and anything below it is NOT in the table (`0x448c84`'s range test sends
 * it to the damage path), so this returns false for them and the caller falls
 * through to the arithmetic exactly as the original does.
 */
function takeCode(code: number, grip?: () => { x: number; y: number } | null, what?: object): boolean {
  const r = BLOW_CODES[code];
  if (!r) return false;
  // the same thing, still holding you: `0x43045d` disarms a hitter the frame it
  // connects and the classes re-arm on the next, so without this the reaction
  // restarts every frame and the grab never reaches its own loop
  if (r.holds && what && p.heldWhat === what) return r.consumes;
  p.act = r.act;
  p.actClock = 0;
  p.heldClock = 0;
  // `0x448eda`/`0x448fc9` zero `obj+0xa` and `obj+0xc` both
  if (r.stops) {
    p.vx = 0;
    p.vy = 0;
    p.vyRaw = 0;
  }
  if (r.gravity !== null) p.gravityScale = r.gravity;
  // `0x448cf4`: along the PLAYER's own facing, not the striker's
  if (r.shove) p.vx += r.shove * p.facing;
  if (r.sound !== undefined) sound?.own(r.sound, p.x, p.y);
  if (r.holds) {
    // a grab with no grip is still a grab: the engine enters the held state and
    // `0x4285b8` throws it straight back out on the next frame, which restores
    // the gravity this just took away. Giving it a grip that is already gone is
    // that, and it is why a grabber whose art carries no strike box is harmless
    // rather than a player stuck in mid-air.
    p.heldBy = grip ?? ((): null => null);
    p.heldWhat = what ?? null;
  }
  return r.consumes;
}

/**
 * Everything that can hit the player, once a frame — `0x430367` onward, which is
 * the same loop that lets the player hit everything else, run the other way.
 *
 * A hitter counts when its own `obj+0x1a` is live, its current cel carries a
 * strike box, and that box overlaps the victim's body box. Then the victim's
 * handler runs, and the player's (`0x448c60`) takes the blow's magnitude off the
 * health and picks a reaction off the one threshold at `0x449115`.
 *
 * `0x43045d` disarms a hitter after one connect — but almost every class in this
 * chapter re-arms itself on the next tick (`0x455065` for the dog, `0x454495` for
 * the fourth punk, four sites in the girder), so the disarm buys the player one
 * frame and no more. One blow a frame is therefore the whole of it, which is why
 * this stops at the first thing it finds: the reaction it installs takes the
 * player's body box away for the several frames that follow, and THAT is the
 * invulnerability.
 */
function takeHits(): void {
  if (!level || !player) return;
  // already staggering, already down, already dead: no body box, nothing to hit
  if (p.act === "dying") return;
  // ...and with the switch off and nothing in the room that carries a code,
  // there is nothing this function can do, so it does not look for the body box
  if (!damageOn && !hereOf((l) => l.claws).length && !hereOf((l) => l.hands).length && !hereOf((l) => l.surges).length)
    return;
  const mine = playerBody();
  if (!mine) return;
  const hit = (
    cel: SbkCel,
    x: number,
    y: number,
    facing: number,
    vx: number,
    vy: number,
    /** the hitter's own `obj+0x1a`; negative is a CODE and never damage */
    code = 100,
    /** where this hitter would hold you, re-read every frame — see {@link gripOf} */
    grip?: () => { x: number; y: number } | null,
    /** the hitter itself, so it can ask later whether it still has you */
    what?: object,
  ): boolean => {
    const box = strikeOf(cel, x, y, facing);
    if (!box) return false;
    if (!(box.right > mine.left && box.left < mine.right && box.bottom > mine.top && box.top < mine.bottom)) return false;
    // `0x448c72` reads the SIGN first: a code is dispatched and the arithmetic
    // below never runs. A grab cel proves the order matters — 1556 and 2456
    // carry a strike box and no blow pair at all, so a damage-first reading
    // would throw the hold away before it got here.
    // ...and a CODE comes through whatever the damage switch says, because it is
    // not damage: no reaction in the table takes a point of health off anybody.
    // The switch is this port's, to keep the page walkable; the grab is the
    // game's, and turning one off has never had anything to do with the other.
    if (code < 0) return takeCode(code, grip, what);
    if (!cel.blow) return false;
    // `0x42f910`: the cel's own pair plus whatever the hitter was doing, rooted
    const bx = cel.blow.dx * (facing < 0 ? -1 : 1) + vx;
    const by = cel.blow.dy + vy;
    const damage = Math.sqrt(bx * bx + by * by);
    // `0x44915c` / `0x44919e`: which side it came from decides the take
    const front = (x > p.x) === (p.facing > 0);
    p.act = damage > HURT.knockdown ? (front ? "downFront" : "downBack") : front ? "hurtFront" : "hurtBack";
    p.actClock = 0;
    sound?.own(OWN.hurt[Math.floor(Math.random() * OWN.hurt.length)], p.x, p.y);
    takeHealth(damage);
    return true;
  };
  const lvl = level;
  /**
   * The three that carry a CODE go first, and they are the only three this
   * function runs at all with the damage switch off.
   *
   * Order is not the reason — a code is not damage, so the switch has nothing
   * to do with it, and the reactions have to land either way. Cost is: with the
   * switch off this used to do nothing, and letting the whole loop below run
   * instead added a linear scan of the level's cel table per hitter per frame.
   * ARCADE is the suite that noticed, because it is the one that judges a boss
   * fight by the wall clock, and it went from passing to failing two runs in
   * three. Three short loops always; the long one only when it can do anything.
   */
  // `0x417208` — the claw's first blow is a hundred, and its second is the code
  for (const c of hereOf((l) => l.claws)) {
    const cel = lvl.sbk.cels.find((q) => q.id === clawCel(c));
    if (!cel?.strike) continue;
    const code = c.state === "shut" ? CLAW.grab : CLAW.blow;
    if (hit(cel, c.x, c.y, 1, 0, 0, code, () => gripAt(clawCel(c), c.x, c.y), c)) return;
  }
  /**
   * ...and the HANDS, whose whole point is the code.
   *
   * `0x420da6` sets -3 as the hand under your feet closes and `0x420e3b` sets
   * -7 for the one that comes up anywhere, and of the thirteen cels its scripts
   * name only the two closed ones — 1556 and 1562 — carry a strike box at all. So a hand can only
   * take hold on the frame it is shut, and the box it takes hold BY is the fist
   * the artist drew.
   */
  for (const q of hereOf((l) => l.hands)) {
    const cel = lvl.sbk.cels.find((c) => c.id === handCel(q));
    if (!cel?.strike) continue;
    const kind = q.underfoot ? HAND.underfoot : HAND.anywhere;
    if (hit(cel, q.atX, q.atY, 1, 0, 0, kind.blow, () => gripAt(handCel(q), q.atX, q.atY), q)) return;
  }
  // ...and TOWER's current, which carries -4 on every cel of its arc
  for (const g of hereOf((l) => l.surges)) {
    const cel = lvl.sbk.cels.find((c) => c.id === surgeCel(g));
    if (!cel?.strike) continue;
    if (hit(cel, g.x, g.y, 1, 0, 0, SURGE.blow)) return;
  }
  if (!damageOn) return;
  for (const e of spawnedHere()) {
    if (e.state === "dead" || e.state === "burst") continue;
    const c = lvl.sbk.cels.find((q) => q.id === celOf(e));
    if (!c?.strike) continue;
    if (hit(c, e.x, e.y, e.facing, e.vx / TICK_SCALE, e.vy / TICK_SCALE)) return;
  }
  // `0x454a38` arms a press only while its stroke runs, and only two of its cels
  // carry a box; `0x4537d0` arms a girder on every frame it has
  for (const c of crushesHere()) {
    if (c.state !== "slam") continue;
    const cel = lvl.sbk.cels.find((q) => q.id === crushCel(c));
    if (!cel?.strike) continue;
    if (hit(cel, c.x, c.y, 1, 0, 0)) return;
  }
  for (const b of ibeamsHere()) {
    if (b.delay > 0) continue;
    const cel = lvl.sbk.cels.find((q) => q.id === ibeamCel(b));
    if (!cel?.strike) continue;
    if (hit(cel, b.x, b.y, 1, 0, 0)) return;
  }
  // `0x423d29` and the four writes after it — the blade carries a blow of a
  // hundred at every tag it has, and it has nothing else
  for (const a of hereOf((l) => l.axes)) {
    const cel = lvl.sbk.cels.find((q) => q.id === axeCel(a));
    if (!cel?.strike) continue;
    if (hit(cel, a.x, a.y, 1, 0, 0)) return;
  }
  // ...and the goop, which carries `obj+0x1a = 0x64` and therefore its cel's own
  // pair unscaled — see {@link dripStrike} for why that is one cel of nine
  for (const d of drips) {
    const cel = dripStrike(d);
    if (!cel) continue;
    if (hit(cel, d.x, d.y, 1, d.vx / TICK_SCALE, d.vy / TICK_SCALE)) return;
  }
  // ...and level eight's water, on whichever of its cels carries a box
  for (const [slot, clock] of columns) {
    const q = hereOf((l) => l.sprinklers).find((w) => w.slot === slot);
    if (!q) continue;
    const cel = lvl.sbk.cels.find((c) => c.id === columnCel(clock));
    if (!cel?.strike) continue;
    if (hit(cel, q.x, q.y, 1, 0, 0)) return;
  }
}

/** the things spawned in the player's room, or none */
function spawnedHere(): Enemy[] {
  const i = level && p.room ? level.rooms.indexOf(p.room) : -1;
  return level && i >= 0 ? level.spawned[i] : [];
}

/**
 * Which cel a spawned thing is showing.
 *
 * The gait loops; a flinch and a death play once and hold their last cel, which
 * is what leaves a body on the ground for {@link CORPSE_LINGER} frames. Both go
 * through the script's own `ticksPerFrame`, so the punk's eight-cel walk takes
 * sixteen engine frames and its twelve-cel death takes thirty-six.
 */
function celOf(e: Enemy): number {
  return e.state === "gait"
    ? e.anim.cels[loopIndex(e.anim, e.clock)]
    : celAt(e.anim, e.clock);
}

/** the planks standing in the room the player is in */
function planksHere(): Plank[] {
  const i = level && p.room ? level.rooms.indexOf(p.room) : -1;
  return level && i >= 0 ? level.planks[i] : [];
}

/**
 * Step every plank: whether the player is on it, whether that is one crossing too
 * many, and the fall — `0x4531d0`, and {@link PLANK} quotes it line by line.
 *
 * The one thing here that is not the engine's is what happens to the floor. The
 * engine keeps publishing the owned platform offset by however far the owner has
 * moved (`0x42fcb9`), so the player rides a falling plank for as long as the
 * mover's carry can keep up with it; this moves the record itself, which is the
 * same thing for a plank — at three times the player's gravity it is 30 pixels a
 * frame gone, and nothing rides that.
 */
function stepPlanks(): void {
  for (const k of planksHere()) {
    k.clock += TICK_SCALE;
    if (k.state === "fall") {
      // its own gravity, in its own units: raw 300 over the class's divisor of 10
      k.vy = Math.min(k.vy + (PLANK.gravity / PLANK.divisor) * TICK_SCALE * TICK_SCALE, INVENTED.maxFallPx);
      k.y += k.vy;
      if (k.floor) {
        k.floor.top += k.vy;
        k.floor.bottom += k.vy;
      }
      continue;
    }
    if (k.state === "wobble") {
      // `0x4532a7`: the sag ends, that is one crossing, and it is a plank again
      if (k.clock >= plankFrames(k)) {
        k.crossings += 1;
        k.state = "intact";
        k.clock = 0;
      }
      continue;
    }
    // `0x4531fc`..`0x45323f`: inside its rect, on the ground, above it, and near.
    // "Above" and "near" are measured from the player's own POINT the way every
    // other test in the engine is — their feet are level with the plank when they
    // stand on it, and a feet test never fires
    const ay = p.y - p.feet;
    const on = p.x > k.left && p.x < k.right && p.onGround && ay < k.y && k.y - ay < PLANK.reach;
    if (!on) continue;
    if (k.crossings <= PLANK.crossings && p.fallPx <= PLANK.hardFallPx) {
      k.state = "wobble";
      k.clock = 0;
      continue;
    }
    k.state = "fall";
    k.clock = 0;
    k.vy = 0;
    sound?.effect(PLANK.sound, k.x, k.y);
  }
  // a plank that has fallen out of the room is done with, and so is its floor
  const room = p.room;
  if (!room) return;
  const i = level ? level.rooms.indexOf(room) : -1;
  if (!level || i < 0) return;
  level.planks[i] = level.planks[i].filter((k) => {
    if (k.state !== "fall" || k.y < room.bottom + 400) return true;
    if (k.floor) {
      // and it takes the record with it: nothing stands on a plank that has gone
      k.floor.top = room.bottom + 10000;
      k.floor.bottom = k.floor.top + 1;
    }
    return false;
  });
}

/** the elevators in the room the player is in */
function elevatorsHere(): Elevator[] {
  const i = level && p.room ? level.rooms.indexOf(p.room) : -1;
  return level && i >= 0 ? level.elevators[i] : [];
}

/** is the player standing on this car right now — their feet on its deck */
function ridingElevator(e: Elevator): boolean {
  return p.onGround && p.x >= e.floor.left && p.x < e.floor.right && Math.abs(p.y - e.floor.top) <= 4;
}

/**
 * Step every elevator: `0x453470`'s five states, in the order its table runs them.
 *
 * The car is moved by moving its floor record, which is how the rider comes with
 * it — the same trick the plank uses, and it works upward here because the walk's
 * own "follow the floor" allows {@link CLIMB_PX} of climb a frame and the
 * car climbs one. Four pixels an engine frame is one pixel a tick.
 *
 * What is NOT the engine's is when a car decides to go: `obj+0x46` gates every
 * state in the original and nothing this port has read writes it. Here the rider's
 * weight is the trigger — see {@link ELEVATOR.trigger}.
 */
function stepElevators(): void {
  const step = (ELEVATOR.speed / ELEVATOR.divisor) * TICK_SCALE;
  for (const e of elevatorsHere()) {
    e.clock += TICK_SCALE;
    if (e.state === "idle") {
      // `0x453490` waits on `obj+0x46`, and that field is written by exactly one
      // thing — the animation stepper, when a script's last frame completes. So
      // tag 0 is not waiting for a rider: it is waiting for its own eighteen
      // frames of 1160 to run out, and then it goes. The car shuttles whether or
      // not anyone is aboard, pausing 1.2s at each end; you catch it.
      if (e.clock < elevatorFrames(e)) continue;
      // `0x453490`: the direction is whichever end is NOT the one it is sitting at
      e.dir = e.floor.top <= e.top ? 1 : -1;
      e.state = "starting";
      e.clock = 0;
      sound?.effect(ELEVATOR.soundStart, e.x, e.y);
      continue;
    }
    if (e.state === "starting") {
      // `0x4534f4` / `0x4535ae`: one beat of wind-up, then the travelling tag
      if (e.clock >= elevatorFrames(e)) {
        e.state = e.dir > 0 ? "down" : "up";
        e.clock = 0;
      }
      continue;
    }
    // `0x453518` / `0x4535d2`: move, and stop at the end of the shaft
    const want = e.floor.top + e.dir * step;
    const at = Math.min(e.bottom, Math.max(e.top, want));
    const moved = at - e.floor.top;
    e.floor.top += moved;
    e.floor.bottom += moved;
    e.y += moved;
    if (at === e.top || at === e.bottom) {
      e.state = "idle";
      e.clock = 0;
      sound?.effect(ELEVATOR.soundStop, e.x, e.y);
    }
  }
}

/**
 * Every `initibeam` in this room, standing where its record's point puts it.
 *
 * There is nothing to resolve and nothing to own: the frame function rewrites the
 * beam's position from the file every tick (`obj+6 = ctx+0`) and zeroes its
 * velocity, so the record IS the answer. See {@link IBEAM}.
 */
function ibeamsIn(sbk: SbkFile, room: SbkRoom): Ibeam[] {
  const out: Ibeam[] = [];
  for (const e of sbk.entities) {
    if (!e.isEntity || e.name !== "initibeam") continue;
    const cy = (e.top + e.bottom) >> 1;
    const cx = (e.left + e.right) >> 1;
    if (cy < room.top || cy > room.bottom || cx < room.left || cx > room.right) continue;
    // the cels are one book's, as the planks' and the lifts' are
    if (!IBEAM.across.cels.every((id) => sbk.byId.has(id))) continue;
    out.push({
      x: e.pointX,
      y: e.pointY,
      state: "out",
      clock: 0,
      // the record's own stagger — the creator loads ctx+4 from a word of it, and
      // CITY gives exactly one of its seven a nonzero one
      delay: e.param,
      side: 0,
    });
  }
  return out;
}

/**
 * Every `initcrush` in this room — WOODS places three and no other book places
 * any, which is the shape the planks, the lifts and the girders all have.
 *
 * The record's rect is what arms it and the record's point is where it stands,
 * and the class uses both without a creator's worth of arithmetic in between
 * (`0x450f19` keeps the point and both corners in a twelve-byte context, and
 * `0x4549c3` rewrites the object onto the point every frame).
 */
function crushesIn(sbk: SbkFile, room: SbkRoom): Crush[] {
  const out: Crush[] = [];
  for (const e of sbk.entities) {
    if (!e.isEntity || e.name !== "initcrush") continue;
    if (e.pointY < room.top || e.pointY > room.bottom || e.pointX < room.left || e.pointX > room.right) continue;
    if (!CRUSH.slam.cels.every((id) => sbk.byId.has(id))) continue;
    out.push({ x: e.pointX, y: e.pointY, top: e.top, left: e.left, bottom: e.bottom, right: e.right, state: "idle", clock: 0 });
  }
  return out;
}

/** the presses in the room the player is in */
function crushesHere(): Crush[] {
  const i = level && p.room ? level.rooms.indexOf(p.room) : -1;
  return level && i >= 0 ? level.crushes[i] : [];
}

/**
 * Step every press — `0x4549b0`, and {@link CRUSH} has its nine instructions.
 *
 * The trigger is `0x434200(player+6, ctx+4)`: the player's own POINT inside the
 * record's own rect, which is the same point-in-rect test a ladder and a door
 * use. It is re-tested on every frame the press is up, so standing under one
 * works it until you move.
 */
function stepCrushes(): void {
  for (const c of crushesHere()) {
    if (c.state === "idle") {
      // the anchor is the point the cel hangs from, which is the player's y less
      // the feet — the same conversion {@link poseFeet} keeps
      const ay = p.y - p.feet;
      const inside = p.x >= c.left && p.x < c.right && ay >= c.top && ay < c.bottom;
      if (!inside) continue;
      sound?.effect(CRUSH.sound, c.x, c.y);
      c.state = "slam";
      c.clock = 0;
      continue;
    }
    c.clock += TICK_SCALE;
    if (c.clock < crushFrames(c)) continue;
    c.clock = 0;
    c.state = c.state === "slam" ? "lift" : "idle";
  }
}

/**
 * Every `switch` in this room. SERVICE places six and no other book places one —
 * which is why level five's gang, who all know how to walk to a lever, never do.
 *
 * `0x436020` keeps the record's point as the position and the record's `param`
 * in its own six-byte context; the rect is what the player has to be standing in
 * and what an enemy's territory has to contain.
 */
function switchesIn(sbk: SbkFile, room: SbkRoom): Switch[] {
  const out: Switch[] = [];
  for (const e of sbk.entities) {
    // SERVICE calls them `switch` and MAZE calls them `initswitch`, and they
    // are the same class: `0x473548` and `0x46c050` have the same four tags on
    // the same four cel runs, one per chapter's book
    if (!e.isEntity || (e.name !== "switch" && e.name !== "initswitch")) continue;
    if (e.pointY < room.top || e.pointY > room.bottom || e.pointX < room.left || e.pointX > room.right) continue;
    if (!SWITCH.off.cels.every((id) => sbk.byId.has(id))) continue;
    out.push({
      x: e.pointX,
      y: e.pointY,
      top: e.top,
      left: e.left,
      bottom: e.bottom,
      right: e.right,
      param: e.param,
      state: "off",
      clock: 0,
    });
  }
  return out;
}

/**
 * Every `initgoop` in this room, as the nest a negative kind makes.
 *
 * The level's spawner hands the creator `-1` (`0x435987`), and that branch keeps
 * the rect and the param and gives the object a script whose kind is 3 — the one
 * the class's draw case will not paint. So a level's goop records are twenty-two
 * invisible volumes, and everything you can see comes out of them at run time.
 */
function nestsIn(sbk: SbkFile, room: SbkRoom): Nest[] {
  const out: Nest[] = [];
  for (const e of sbk.entities) {
    if (!e.isEntity || e.name !== "initgoop") continue;
    if (e.pointY < room.top || e.pointY > room.bottom || e.pointX < room.left || e.pointX > room.right) continue;
    if (!GOOP.bead.cels.every((id) => sbk.byId.has(id))) continue;
    out.push({ top: e.top, left: e.left, bottom: e.bottom, right: e.right, param: e.param, on: false });
  }
  return out;
}

/** the levers in the room the player is in */
function switchesHere(): Switch[] {
  const i = level && p.room ? level.rooms.indexOf(p.room) : -1;
  return level && i >= 0 ? level.switches[i] : [];
}

/** the nests in the room the player is in */
function nestsHere(): Nest[] {
  const i = level && p.room ? level.rooms.indexOf(p.room) : -1;
  return level && i >= 0 ? level.nests[i] : [];
}

/**
 * Throw one lever — `0x436820(pos, dir)`, and it is the only way either state
 * changes.
 *
 * Direction zero answers a lever that is OFF and direction one a lever that is
 * ON; anything else it ignores, which is why a gang member standing at a lever
 * it has already thrown does nothing at all. The sounds are `0x436895`'s 0x4b
 * going up and `0x4368c9`'s 0x4a coming back.
 */
function throwSwitch(s: Switch, dir: 0 | 1): boolean {
  if (dir === 0 && s.state === "off") {
    s.state = "turningOn";
    s.clock = 0;
    sound?.effect(SWITCH.throwOn, s.x, s.y);
    return true;
  }
  if (dir === 1 && s.state === "on") {
    s.state = "turningOff";
    s.clock = 0;
    sound?.effect(SWITCH.throwOff, s.x, s.y);
    return true;
  }
  return false;
}

/**
 * Step every lever, and let the player work one.
 *
 * `0x43c2c0` is four lines: pin the object on its point, zero the velocity pair,
 * and when the current tag's script has ended install the next. The two throws
 * broadcast as they end — `0x43c3d0` flips the tag of every goop with the same
 * `param` and plays 0x24 at each of them — and the two resting tags simply
 * reinstall themselves.
 *
 * The player's half is `0x429870`, in the standing state, asking the chapter's
 * own "what am I at" query twice a frame: with no direction held it asks kind 0,
 * which throws a lever ON, and with S held it asks kind 1, which throws one OFF.
 * So stopping on a lever starts the shower and S is how you stop it, which is
 * exactly backwards from what you want and exactly what the file says.
 */
function stepSwitches(): void {
  // every lever in the LEVEL, because a throw has to finish wherever it was made
  const here = level?.switches.flat() ?? [];
  if (!here.length) return;
  const ay = p.y - p.feet;
  for (const s of here) {
    const inside = p.x >= s.left && p.x < s.right && ay >= s.top && ay < s.bottom;
    if (inside && p.act === null) {
      // `0x4298ab`: S first, and it is the only one of the two that turns it off
      if (held.down) throwSwitch(s, 1);
      else if (!held.left && !held.right) throwSwitch(s, 0);
    }
    s.clock += TICK_SCALE;
    if (s.clock < switchFrames(s)) continue;
    s.clock = 0;
    if (s.state === "turningOn") {
      s.state = "on";
      broadcast(s.param);
    } else if (s.state === "turningOff") {
      s.state = "off";
      broadcast(s.param);
    }
  }
}

/**
 * Every `door` in this room. SEWER places five and no other book places one.
 *
 * The creator keeps `abs(param)` as the number its lever has to carry and the
 * sign as the frame's mirror flag, and hands the record's rect to `0x435ff0`,
 * which appends it to the engine's own obstacle table — so a shut door is solid
 * in exactly the way an `obstacle` record is, and an open one is not there at
 * all ({@link blockers}).
 */
function doorsIn(sbk: SbkFile, room: SbkRoom): Door[] {
  const out: Door[] = [];
  for (const e of sbk.entities) {
    if (!e.isEntity || e.name !== "door") continue;
    if (e.pointY < room.top || e.pointY > room.bottom || e.pointX < room.left || e.pointX > room.right) continue;
    if (!DOOR.shut.cels.every((id) => sbk.byId.has(id))) continue;
    out.push({
      x: e.pointX,
      y: e.pointY,
      top: e.top,
      left: e.left,
      bottom: e.bottom,
      right: e.right,
      param: Math.abs(e.param),
      mirror: e.param < 0,
      state: "shut",
      clock: 0,
    });
  }
  return out;
}

/**
 * Every `initelev` in this room, with the `platform` record it claimed.
 *
 * `0x435a19` calls `0x42fb70` from the creator — the same claim a plank and a
 * girder make — and SEWER lays a `platform` over each of its six lifts, the two
 * records agreeing to a few pixels. Whichever platform holds the lift's own
 * point is its floor, and moving one moves the other.
 */
function elevsIn(sbk: SbkFile, room: SbkRoom, solids: Solids): Elev[] {
  const out: Elev[] = [];
  for (const e of sbk.entities) {
    if (!e.isEntity || e.name !== "initelev") continue;
    if (e.pointY < room.top || e.pointY > room.bottom || e.pointX < room.left || e.pointX > room.right) continue;
    if (!sbk.byId.has(ELEV.cel)) continue;
    const floor = solids.platforms.find(
      (q) => e.pointX >= q.left && e.pointX <= q.right && e.pointY >= q.top - 40 && e.pointY <= q.bottom + 40,
    );
    out.push({
      x: e.pointX,
      y: e.pointY,
      top: e.top,
      bottom: e.bottom,
      param: e.param,
      state: "atBottom",
      clock: 0,
      vy: 0,
      floor,
    });
  }
  return out;
}

/**
 * Every record of one name in this room, turned into whatever that class is.
 *
 * All six of the classes below are placed the same way — the record's point is
 * where the thing stands and the record's rect is what it watches — so the
 * filter is one function: the point has to be in the room, and every cel the
 * class draws has to be in the book, which is what keeps another chapter's
 * `initbush` out of this one.
 */
function placed<T>(
  sbk: SbkFile,
  room: SbkRoom,
  name: string,
  cels: readonly number[],
  make: (e: SbkEntity) => T,
): T[] {
  const out: T[] = [];
  for (const e of sbk.entities) {
    if (!e.isEntity || e.name !== name) continue;
    if (e.pointY < room.top || e.pointY > room.bottom || e.pointX < room.left || e.pointX > room.right) continue;
    if (!cels.every((id) => sbk.byId.has(id))) continue;
    out.push(make(e));
  }
  return out;
}

/** every `initshack` in this room — CITY places eleven and nothing else places any */
function shacksIn(sbk: SbkFile, room: SbkRoom): Shack[] {
  return placed(sbk, room, "initshack", SHACK.opening.cels, (e) => ({
    x: e.pointX,
    y: e.pointY,
    top: e.top,
    left: e.left,
    bottom: e.bottom,
    right: e.right,
    mirror: e.param !== 0,
    state: "shut" as const,
    clock: 0,
  }));
}

/**
 * Every `initbarrel` in this room, with the `platform` it claimed.
 *
 * `0x435d6e` calls `0x42fb70` — the plank's own "claim the platform record my
 * point is inside" — whenever the record's `param` is not negative, and level
 * seven lays one over each of its five. A barrel you cannot stand on is only
 * half a barrel.
 */
function barrelsIn(sbk: SbkFile, room: SbkRoom, solids: Solids): Barrel[] {
  return placed(sbk, room, "initbarrel", BARREL.bob.cels, (e) => ({
    x: e.pointX,
    y: e.pointY,
    homeX: e.pointX,
    homeY: e.pointY,
    clock: 0,
    floor: solids.platforms.find(
      (q) => e.pointX >= q.left && e.pointX <= q.right && e.pointY >= q.top - 40 && e.pointY <= q.bottom + 40,
    ),
  }));
}

/** what of each is in the room the player is in */
function hereOf<T>(pick: (lvl: Level) => T[][]): T[] {
  const i = level && p.room ? level.rooms.indexOf(p.room) : -1;
  return level && i >= 0 ? pick(level)[i] : [];
}

/**
 * Every `stat*` record in this room, as the code its chapter's init hands
 * `0x45b160`.
 *
 * The name is the level's and the code is the executable's, and the join between
 * them is the four blocks at `0x4512a1`, `0x43bbae`, `0x421b9e` and `0x4161c1` —
 * one per chapter, all four handing the same negative for the same name. Only
 * `statscoreup` needs the record as well as the name: `0x451420` switches on its
 * `param` for −6, −5 or −4.
 *
 * The two codes with no name anywhere — `statpunch` at −3 and `statshield` at
 * −7 — are left out because nothing in the game places them and their art
 * (18000, 18062) is in no book in the rip.
 */
const PICKUP_CODES: Readonly<Record<string, string>> = {
  stathealth: "-1",
  statlife: "-2",
  stattimer: "-8",
};

function pickupsIn(sbk: SbkFile, room: SbkRoom): Pickup[] {
  const out: Pickup[] = [];
  for (const e of sbk.entities) {
    if (!e.isEntity) continue;
    // `0x451420`: one name, three codes, picked by the record's own param
    const code = e.name === "statscoreup" ? String(-6 + Math.min(2, Math.max(0, e.param))) : PICKUP_CODES[e.name];
    if (!code || !PICKUP.kinds[code]) continue;
    if (e.pointY < room.top || e.pointY > room.bottom || e.pointX < room.left || e.pointX > room.right) continue;
    out.push({ code, x: e.pointX, y: e.pointY, top: e.top, left: e.left, bottom: e.bottom, right: e.right, clock: 0 });
  }
  return out;
}

/**
 * Step the pickups: animate them, and hand over whichever one the player is
 * standing in.
 *
 * `0x45b270` runs from the player's own think every frame and asks two
 * questions of each one — `0x434140` for a rect overlap and then `0x40e680`,
 * which compares the two sprites pixel by pixel. This does the first and not
 * the second, so the reach here is the drawn boxes rather than the art inside
 * them. There is no button and no facing: walking over one is the whole of it.
 *
 * What each one gives is `0x42827a`'s table, and every sound comes out of the
 * CHARACTER's bank rather than the level's ({@link PICKUP}).
 */
function stepPickups(): void {
  const lvl = level;
  if (!lvl || !player) return;
  const here = hereOf((l) => l.pickups);
  if (!here.length) return;
  const mine = playerBox();
  const gone: Pickup[] = [];
  for (const q of here) {
    q.clock += TICK_SCALE;
    if (!mine) continue;
    // `0x434140` against the pickup's own RECORD rect, which is what the creator
    // filed at `user+4` — the art is only what is drawn
    if (!(mine.right > q.left && mine.left < q.right && mine.bottom > q.top && mine.top < q.bottom)) continue;
    const kind = PICKUP.kinds[q.code];
    gone.push(q);
    sound?.own(kind.sound, q.x, q.y);
    if (q.code === "-1") stats.health = Math.min(stats.maxHealth, stats.health + PICKUP.health);
    else if (q.code === "-2") stats.lives = Math.min(PICKUP.maxLives, stats.lives + 1);
    else if (q.code === "-8") stats.ticks += PICKUP.clock;
    else stats.score += PICKUP.score[q.code] ?? 0;
  }
  if (!gone.length) return;
  const i = lvl.rooms.indexOf(p.room!);
  lvl.pickups[i] = here.filter((q) => !gone.includes(q));
}

/**
 * Level nine's graves — `0x421040`, and there is no damage in it anywhere.
 *
 * Shut, it is a slab you cannot stand on: `0x4210bd` measures how far into its
 * own rect you are and `0x42f8b0` throws you back out by that much, with
 * `0136 grave pull`. Come within a hundred pixels of its point and it opens —
 * `0x4704e8`, ten cels — and from that frame on it **pulls**: half your speed
 * away every frame and one more unit of fall added to you. Eighty-six pixels
 * below its point, `0x402fa0(5)` ends the level.
 *
 * So it is a hole and it behaves like one, which is the only thing in the game
 * that kills without a blow.
 */
function stepHoles(): void {
  const here = hereOf((l) => l.holes);
  if (!here.length || !player) return;
  for (const h of here) {
    // SHUT: a slab you cannot walk through — but only on your feet. `0x4210a7`
    // lets a jump (player kind 3) and anything off the ground straight past,
    // which is what makes level nine a jumping level.
    if (h.state === "shut" && p.onGround && p.x > h.left && p.x < h.right && p.y >= h.top && p.y <= h.bottom) {
      const half = (h.right - h.left) / 2;
      const out = Math.abs(Math.abs(h.x - p.x) - half - 1) * (p.x <= h.x ? -1 : 1);
      p.vx += out / DIVISOR;
      sound?.effect(FOE_SFX.gravePull, h.x, h.y);
    }
    const near = Math.abs(p.x - h.x) < HOLE.nearPx;
    if (h.state === "shut") {
      if (near) {
        h.state = "opening";
        h.clock = 0;
      }
      continue;
    }
    h.clock += 1;
    if (h.state === "opening" && h.clock >= HOLE.opening.cels.length * HOLE.opening.hold) h.state = "open";
    if (!near) continue;
    // `0x4211af` and `0x4211c4` — half your speed away and one more unit of fall
    p.vx = p.vx / 2;
    p.vyRaw += HOLE.pullPerFrame;
    // `0x42120c` — `0x402fa0(5)`, which is a DEATH and not a subtraction. There
    // is no health in this class at all, so it goes down the same path falling
    // out of the world does, whatever the damage switch says. And the ground
    // beside a grave is already 98 below its point, so standing there when one
    // opens is the whole of it: you have to be in the air over it.
    if (p.y - h.y >= HOLE.deathPx && !film && !h.taken) {
      h.taken = true;
      sound?.effect(FOE_SFX.graveTake, h.x, h.y);
      void died();
    }
  }
}

/** which cel a grave is showing */
function holeCel(h: Hole): number {
  if (h.state === "shut") return HOLE.shut;
  if (h.state === "open") return HOLE.open;
  return HOLE.opening.cels[Math.min(HOLE.opening.cels.length - 1, Math.floor(h.clock / HOLE.opening.hold))];
}

/**
 * ...and the hands between them — `0x420c60`, which is the record's rect and
 * nothing else. The player's point goes in, one of the two sizes is rolled and
 * it comes up; it holds for `0x4704b8`'s thirty frames a cel; it goes back down
 * when the point leaves.
 *
 * Its blow is a CODE (−3 or −7) rather than a number, so nothing here is hurt by
 * one. See {@link HAND}.
 */
function stepHands(): void {
  const here = hereOf((l) => l.hands);
  if (!here.length) return;
  // `0x434200` against the player's own POINT, which is the anchor — the feet
  // stand below every rect in the file (see `poseFeet`)
  const ay = p.y - p.feet;
  for (const q of here) {
    const kind = q.underfoot ? HAND.underfoot : HAND.anywhere;
    const inside = p.x > q.left && p.x < q.right && ay >= q.top && ay <= q.bottom;
    q.clock += 1;
    if (q.state === "down") {
      // `0x420ca9` — it only comes up under someone standing on the ground
      if (!inside || !p.onGround) continue;
      q.state = "up";
      q.clock = 0;
      sound?.effect(HAND.sound, q.x, q.y);
      if (q.underfoot) {
        // `0x420ce7` and `0x420d1b`: your own x, and two above your feet
        q.atX = p.x;
        q.atY = p.y - 2;
      } else {
        // `0x420d4b` — anywhere across its own rect, at the record's own height
        q.atX = q.left + Math.floor(Math.random() * Math.max(1, q.right - q.left));
        q.atY = q.y;
      }
    } else if (q.state === "up") {
      if (q.clock >= kind.up.cels.length * kind.up.hold) {
        q.state = "held";
        q.clock = 0;
      }
    } else if (q.state === "held") {
      /**
       * `0x4704b8`'s thirty frames, and having hold of you does not extend them:
       *
       * ```
       *   420dbf  cmp [esi+0x46], 0    ; the script ended
       *   420dc4  jne 0x420ddc         ; ...then SINK, whatever else is true
       *   420dc6  cmp [esi+0x48], 0x14 ; only now the other two tests, and they
       *   420dd1  cmp [esi+0x2a], 0    ; can only end the hold EARLY
       * ```
       *
       * So the grab is exactly as long as the animation and not a frame more,
       * and what lets go of you is the fist opening — which is the same thing
       * {@link gripOf} reads, from the other side.
       */
      if (q.clock >= HAND.holdFrames) {
        q.state = "sinking";
        q.clock = 0;
      }
    } else if (q.clock >= kind.down.cels.length * kind.down.hold) {
      q.state = "down";
      q.clock = 0;
    }
  }
}

/**
 * While something has hold of you: ride its grip, or be let go.
 *
 * `0x428080`'s kind-10 case, once a frame. It re-reads the GRABBER's current cel
 * every frame rather than remembering anything about the grab, which is what
 * makes this so short: the hold is wherever the art says it is this frame, and
 * the frame the art stops saying is the frame you are free.
 *
 * ```
 *   42857d  the grabber's current cel record
 *   4285b8  cmp [0x4a693a], ax    ; x0 == x1 -> let go
 *   428660  x = x1 + (x0 - x1) / 2
 *   428689  y = y0 + (y1 - y0) / 2
 *   4286bb  P, and only from tag 0 -> the struggle
 * ```
 *
 * Letting go restores gravity (`0x4285ec`) and stands the player back up
 * (`0x4285db` writes 1 into `obj+0x34`); nothing gives any health back, because
 * a grab never took any.
 */
function stepHeld(): void {
  if (!p.heldBy) return;
  const at = p.heldBy();
  if (!at) {
    // `0x4285c1` — out through the walk's own script, upright and falling again
    p.heldBy = null;
    p.heldWhat = null;
    p.gravityScale = 1;
    p.act = null;
    p.heldClock = 0;
    return;
  }
  p.x = at.x;
  // the grip is an ANCHOR point and `p.y` is the feet — see {@link poseFeet}
  p.y = at.y + p.feet;
  p.vx = 0;
  p.vy = 0;
  p.vyRaw = 0;
  p.onGround = false;
  p.heldClock += 1;
  // `0x4286cf`: P restarts the struggle, but only from the loop — mashing it
  // does not stack, and nothing in the state shortens the hold
  if (punchPressed && p.act === "held") {
    p.act = "struggle";
    p.actClock = 0;
  }
}

/** which cel a hand is showing, or 0 while it is under the ground */
function handCel(q: Hand): number {
  const kind = q.underfoot ? HAND.underfoot : HAND.anywhere;
  if (q.state === "down") return 0;
  if (q.state === "held") return kind.hold;
  const a = q.state === "up" ? kind.up : kind.down;
  return a.cels[Math.min(a.cels.length - 1, Math.floor(q.clock / a.hold))];
}

/**
 * The swinging blades — `0x423d00`, which is three tags handed round in a ring
 * and nothing else. Twenty-seven cels, one engine frame each, and the blow is a
 * hundred on every one of them.
 */
function stepAxes(): void {
  for (const a of hereOf((l) => l.axes)) {
    const was = Math.floor(a.clock) % AXE.swing.length;
    a.clock += 1;
    const now = Math.floor(a.clock) % AXE.swing.length;
    // `0x423d9a` — the sound is at the seam where tag 2 hands back to tag 0
    if (now === AXE.soundAt && was !== AXE.soundAt) sound?.effect(AXE.sound, a.x, a.y);
  }
}

/** which cel a blade is showing */
function axeCel(a: Axe): number {
  return AXE.swing[Math.floor(a.clock) % AXE.swing.length];
}

/**
 * ...and the rope bridges — `0x422370`. Standing on one for more than five
 * engine frames, or landing on one from more than a hundred pixels up, starts
 * it; after that it rocks, falls and is gone, and the gap it was over is a gap.
 */
function stepBridges(): void {
  const here = hereOf((l) => l.bridges);
  if (!here.length) return;
  for (const b of here) {
    const on = p.onGround && Math.abs(p.x - b.x) < BRIDGE.reachPx && Math.abs(p.y - b.y) < 60;
    if (b.state === "whole") {
      b.stood = on ? b.stood + 1 : 0;
      if (on && (b.stood > BRIDGE.standFrames || p.fallPx > BRIDGE.fallPx)) {
        b.state = "rocking";
        b.clock = 0;
        sound?.effect(FOE_SFX.bridgeCrack, b.x, b.y);
      }
      continue;
    }
    b.clock += 1;
    if (b.state === "rocking" && b.clock >= BRIDGE.rocking.cels.length * BRIDGE.rocking.hold) {
      b.state = "falling";
      b.clock = 0;
      sound?.effect(FOE_SFX.bridgeFall, b.x, b.y);
    } else if (b.state === "falling" && b.clock >= BRIDGE.falling.cels.length * BRIDGE.falling.hold) {
      b.state = "gone";
      // and the platform goes with it. Every `initbridge` record in CAVERN has a
      // `platform` record with the SAME rect laid over it — records 13, 75, 76
      // and 22 against bridges 72, 73, 74 and 77 — so what you were standing on
      // is the thing that just fell.
      const lvl2 = level;
      if (lvl2) {
        const r = lvl2.rooms.indexOf(p.room!);
        if (r >= 0)
          lvl2.solids[r].platforms = lvl2.solids[r].platforms.filter(
            (q) => !(q.left === b.left && q.right === b.right && q.top === b.top),
          );
      }
    }
  }
}

/** which cel a bridge is showing */
function bridgeCel(b: Bridge): number {
  if (b.state === "whole") return BRIDGE.whole;
  if (b.state === "gone") return BRIDGE.gone;
  const a = b.state === "rocking" ? BRIDGE.rocking : BRIDGE.falling;
  return a.cels[Math.min(a.cels.length - 1, Math.floor(b.clock / a.hold))];
}

/**
 * Level twelve's floors — `0x426f80`, which is level nine's grave told the
 * other way round. The player's point inside its rect starts it; four frames of
 * the whole cel, three of `0120 floor crea[ks]`, six of `0121 floor cave[s in]`
 * — and then `0x402fa0`, the same death a grave gives.
 */
function stepFloors(): void {
  const here = hereOf((l) => l.floors);
  if (!here.length) return;
  const ay = p.y - p.feet;
  for (const f of here) {
    const inside = p.x > f.left && p.x < f.right && ay >= f.top && ay <= f.bottom;
    if (f.state === "whole") {
      if (!inside || !p.onGround) continue;
      f.state = "creaking";
      f.clock = 0;
      sound?.effect(FOE_SFX.floorCreak, f.x, f.y);
      continue;
    }
    f.clock += 1;
    if (f.state === "creaking" && f.clock >= FLOOR.creaking.cels.length * FLOOR.creaking.hold) {
      f.state = "caving";
      f.clock = 0;
      sound?.effect(FOE_SFX.floorCave, f.x, f.y);
      // `0x42703e` writes 5 into the floor offset and what is left falls: the
      // platform laid over it, if the book filed one, goes too
      const lvl2 = level;
      if (lvl2) {
        const r = lvl2.rooms.indexOf(p.room!);
        if (r >= 0)
          lvl2.solids[r].platforms = lvl2.solids[r].platforms.filter(
            (q) => !(q.left >= f.left - 8 && q.right <= f.right + 8 && Math.abs(q.top - f.top) < 220),
          );
      }
    } else if (f.state === "caving" && f.clock >= FLOOR.caving.cels.length * FLOOR.caving.hold) {
      f.state = "gone";
      if (inside && !film) {
        sound?.effect(FOE_SFX.graveTake, f.x, f.y);
        void died();
      }
    }
  }
}

/** which cel a floor is showing */
function floorCel(f: Floor): number {
  if (f.state === "whole") return FLOOR.whole;
  if (f.state === "gone") return FLOOR.caving.cels[FLOOR.caving.cels.length - 1];
  const a = f.state === "creaking" ? FLOOR.creaking : FLOOR.caving;
  return a.cels[Math.min(a.cels.length - 1, Math.floor(f.clock / a.hold))];
}

/**
 * ...and the surges, which are the only hazard in the game that gives you
 * something: `0x426b21` calls `0x45ef30`, the ammunition adder, and then
 * `0x40d4f0` to redraw the panel. Its blow is the code −4 and this port does not
 * carry codes, so what is left of one here is the refill.
 */
function stepSurges(): void {
  const here = hereOf((l) => l.surges);
  if (!here.length) return;
  const ay = p.y - p.feet;
  for (const q of here) {
    q.clock += 1;
    if (!inv.armed) continue;
    if (!(p.x > q.left && p.x < q.right && ay >= q.top && ay <= q.bottom)) continue;
    const w = WEAPONS[inv.weapon];
    if (!w || roundsIn(inv.weapon) >= w.max) continue;
    loadRounds(inv.weapon, 1);
    if (Math.floor(q.clock) % SURGE.arc.cels.length === 0) sound?.effect(SURGE.sound, q.x, q.y);
  }
}

/** which cel a surge is showing */
function surgeCel(q: Surge): number {
  return SURGE.arc.cels[Math.floor(q.clock / SURGE.arc.hold) % SURGE.arc.cels.length];
}

/**
 * MAZE's cage doors, alarms and fans — three classes that keep their own time.
 *
 * `0x413100` is the whole of a cage door: the two moving tags hand over as they
 * end, and the shutting one calls `0x411460`, which appends its rect to the
 * engine's obstacle table. That is the only thing that makes it solid, and it is
 * the same table the level's own `obstacle` records fill.
 */
function stepCages(): void {
  const lvl = level;
  if (!lvl) return;
  for (const c of lvl.cages.flat()) {
    if (c.state === "shut" || c.state === "open") continue;
    c.clock += 1;
    const a = c.state === "opening" ? CAGE.opening : CAGE.closing;
    if (c.clock < a.cels.length * a.hold) continue;
    c.state = c.state === "opening" ? "open" : "shut";
    c.clock = 0;
    if (c.state === "shut") sound?.effect(CAGE.sound, c.x, c.y);
  }
}

/** which cel a cage door is showing, or 0 for the open tag — which draws nothing */
function cageCel(c: Cage): number {
  if (c.state === "shut") return CAGE.shut;
  if (c.state === "open") return 0;
  const a = c.state === "opening" ? CAGE.opening : CAGE.closing;
  return a.cels[Math.min(a.cels.length - 1, Math.floor(c.clock / a.hold))];
}

/**
 * ...the alarms, which are one sweep and one sound handed round for ever
 * (`0x412fc0`), and the fans, which keep their own counter: `0x41541d` writes
 * fifteen frames of stillness into `user+0xc` and `0x4155ef` writes sixty of
 * turning, and nothing in the level starts or stops one.
 */
function stepAlarms(): void {
  for (const a of hereOf((l) => l.alarms)) {
    const was = Math.floor(a.clock) % (ALARM.flash.cels.length * ALARM.flash.hold);
    a.clock += 1;
    if (Math.floor(a.clock) % (ALARM.flash.cels.length * ALARM.flash.hold) < was) sound?.effect(ALARM.sound, a.x, a.y);
  }
}

function alarmCel(a: Alarm): number {
  const i = Math.floor((a.clock % (ALARM.flash.cels.length * ALARM.flash.hold)) / ALARM.flash.hold);
  return ALARM.flash.cels[Math.min(ALARM.flash.cels.length - 1, i)];
}

function stepFans(): void {
  for (const f of hereOf((l) => l.fans)) {
    const kit = f.horizontal ? FAN.h : FAN.v;
    f.clock += 1;
    if (f.state === "off" && f.clock >= FAN.offFrames) {
      f.state = "up";
      f.clock = 0;
      sound?.effect(FAN.spinUp, f.x, f.y);
    } else if (f.state === "up" && f.clock >= kit.spin.cels.length * kit.spin.hold) {
      f.state = "on";
      f.clock = 0;
    } else if (f.state === "on" && f.clock >= FAN.onFrames) {
      f.state = "down";
      f.clock = 0;
      sound?.effect(FAN.spinDown, f.x, f.y);
    } else if (f.state === "down" && f.clock >= kit.spin.cels.length * kit.spin.hold) {
      f.state = "off";
      f.clock = 0;
    }
  }
}

/** which cel a fan is showing */
function fanCel(f: Fan): number {
  const kit = f.horizontal ? FAN.h : FAN.v;
  if (f.state === "off") return kit.stopped;
  if (f.state === "on") return kit.held;
  const i = Math.min(kit.spin.cels.length - 1, Math.floor(f.clock / kit.spin.hold));
  return f.state === "up" ? kit.spin.cels[i] : kit.spin.cels[kit.spin.cels.length - 1 - i];
}

/**
 * BARREL's conveyors — `0x416840`, which is one test and one number.
 *
 * The belt asks whether the player's own drawn bottom sits inside its band and
 * whether they are on the ground, and if so writes twenty into its user struct.
 * Standing on one carries you; walking on one adds to it, which is what makes
 * the level's east runs fast and its west runs impossible.
 *
 * The strip animates whether or not anybody is on it — `0x46c0d8` at one engine
 * frame a cel, `0x46c188` at three, and the record's own `param` picks.
 */
function stepBelts(): void {
  const here = hereOf((l) => l.belts);
  if (!here.length) return;
  // ...and one belt carries you, not every belt you overlap
  let carried = false;
  for (const b of here) {
    b.clock += 1;
    if (!p.onGround || carried) continue;
    // `0x416899` tests the player's own drawn BOX against the strip's bounds,
    // not their point — and it has to: BARREL lays its belts end to end with a
    // seven-pixel gap between one record's right and the next one's left, and a
    // point test drops you in it.
    const mine = playerBox();
    if (!mine || mine.right < b.left || mine.left > b.right) continue;
    if (p.y < b.top - 8 || p.y > b.bottom + BELT.bandPx) continue;
    p.x += b.dir * BELT.carry;
    carried = true;
  }
}

/** which cel a belt is showing — backwards for a left-hand one, which is tag 1 */
function beltCel(b: Belt): number {
  const hold = b.param >= 8 ? BELT.slowHold : BELT.roll.hold;
  const i = Math.floor(b.clock / hold) % BELT.roll.cels.length;
  return b.dir < 0 ? BELT.roll.cels[BELT.roll.cels.length - 1 - i] : BELT.roll.cels[i];
}

/** ...and the chairs, which are four tags handed round and nothing else */
function stepChairs(): void {
  for (const c of hereOf((l) => l.chairs)) {
    c.clock += 1;
    const run = CHAIR.runs[c.run];
    const len = run ? run.cels.length * run.hold : 2;
    if (c.clock < len) continue;
    c.clock = 0;
    c.run = (c.run + 1) % (CHAIR.runs.length + 1);
  }
}

function chairCel(c: Chair): number {
  const run = CHAIR.runs[c.run];
  if (!run) return CHAIR.rest;
  return run.cels[Math.min(run.cels.length - 1, Math.floor(c.clock / run.hold))];
}

/**
 * The claws — `0x4171e0`, a carriage on a rail that follows you.
 *
 * Its velocity is clamped to ±26 (`0x417344`, `0x417376`) and its position to
 * its own record's bounds (`0x417316`), so it tracks the player along its track
 * and cannot leave it. `0x417289` then measures the gap: inside 300 it reaches
 * down, past 600 it waits, and in between it runs. Its grab is the code −3,
 * which this port does not carry — see {@link CLAW}.
 */
function stepClaws(): void {
  const here = hereOf((l) => l.claws);
  if (!here.length) return;
  for (const c of here) {
    c.clock += 1;
    const want = Math.max(c.left, Math.min(c.right, p.x));
    const gap = Math.abs(p.x - c.x);
    if (c.state === "down" || c.state === "shut" || c.state === "up") {
      const a = c.state === "down" ? CLAW.down : c.state === "shut" ? CLAW.shut : CLAW.up;
      if (c.clock < a.cels.length * a.hold) continue;
      c.clock = 0;
      c.state = c.state === "down" ? "shut" : c.state === "shut" ? "up" : "running";
      if (c.state === "shut") sound?.effect(CLAW.clamp, c.x, c.y);
      continue;
    }
    // it moves whether or not it is going to reach: `0x417344` is outside the
    // distance test
    const step = Math.max(-CLAW.speed, Math.min(CLAW.speed, want - c.x));
    if (step !== 0 && c.state !== "running") {
      c.state = "running";
      c.clock = 0;
      sound?.effect(CLAW.wizz, c.x, c.y);
    }
    c.x += step;
    if (gap > CLAW.restPx) {
      c.state = "idle";
    } else if (gap < CLAW.reachPx && Math.abs(want - c.x) < 4) {
      c.state = "down";
      c.clock = 0;
    }
  }
}

/** which cel a claw is showing */
function clawCel(c: Claw): number {
  const a =
    c.state === "idle" ? CLAW.idle : c.state === "running" ? CLAW.running : c.state === "down" ? CLAW.down : c.state === "shut" ? CLAW.shut : CLAW.up;
  const i = c.state === "idle" || c.state === "running" ? Math.floor(c.clock / a.hold) % a.cels.length : Math.min(a.cels.length - 1, Math.floor(c.clock / a.hold));
  return a.cels[i];
}

/** LAB's and VAT's one-cel furniture, which does nothing but stand where it is */
function fittingCel(f: Fitting): number {
  if (f.kind === "ball") return FITTING.ball.cel;
  if (f.kind === "teeth") return FITTING.teeth.cel;
  return FITTING.shower.on;
}

/**
 * ...and BOGGS, on the idle `0x46e6b0` gives it. Four thousand health, thirty a
 * frame back, and a hit handler that refuses anything whose blow is not the
 * code −1 — see {@link BOGGS} for what of that is here and what is not.
 */
function boggsCel(b: Boggs): number {
  return BOGGS.idle.cels[Math.floor(b.clock / BOGGS.idle.hold) % BOGGS.idle.cels.length];
}

// ---- the guns ------------------------------------------------------------

/**
 * What you are carrying — `0x479434`, `0x479438` and the 21 rounds counts at
 * `0x4a7f16 + id * 12`.
 *
 * All three are GLOBAL, not per level: a chapter's entry function
 * ({@link CHAPTER_WEAPON}) zeroes every count and names its own weapon as the
 * selected one, leaving `armed` at 0, and after that the state travels with
 * you. So a gun taken in WOODS is still in your hands in CITY, and the rounds
 * in it are still the same rounds.
 */
const inv = {
  /** `0x479434` — which of {@link WEAPONS}, whether or not it is in your hands */
  weapon: 9,
  /** `0x479438` — and this is what the fire button reads */
  armed: false,
  /** `0x4a7f16 + id * 12`, per weapon */
  rounds: {} as Record<number, number>,
};

/** every flare in the air, and they outlive the room they were fired in */
let flares: Flare[] = [];

/** which chapter's entry function has already run — see {@link CHAPTER_WEAPON} */
let chapterWeapon: number | null = null;

/**
 * The positive-code records a room stands up, filed as {@link Gun}s.
 *
 * The join from a name to a code is {@link GUN_CODES}, which is the four
 * per-chapter blocks read together, and the band is the creator's own: not the
 * record's rect and not the drawn art, but `x ± 55` — `0x45af8a` writes exactly
 * that into the user struct and `0x45ae90` compares against nothing else.
 */
function gunsIn(sbk: SbkFile, room: SbkRoom): Gun[] {
  const out: Gun[] = [];
  for (const e of sbk.entities) {
    if (!e.isEntity) continue;
    const code = Number(Object.keys(GUN_CODES).find((c) => GUN_CODES[Number(c)].name === e.name) ?? NaN);
    if (!Number.isFinite(code)) continue;
    if (e.pointY < room.top || e.pointY > room.bottom || e.pointX < room.left || e.pointX > room.right) continue;
    out.push({ code, x: e.pointX, y: e.pointY, left: e.pointX - GRAB.bandPx, right: e.pointX + GRAB.bandPx, clock: 0 });
  }
  return out;
}

/** how many rounds are in the named weapon */
function roundsIn(id: number): number {
  return inv.rounds[id] ?? 0;
}

/** `0x45ef30` — add, and clamp to the weapon's own max */
function loadRounds(id: number, n: number): void {
  const w = WEAPONS[id];
  if (!w) return;
  inv.rounds[id] = Math.min(w.max, roundsIn(id) + n);
}

/**
 * Which pickup is under the reach, and it is a POINT test 35 pixels ahead.
 *
 * `0x42f017` shifts the player's own point by `0x23` in the direction they face
 * and hands it to `0x45ae90`, which asks three things of every positive pickup:
 * that the point is inside its `x ± 55` band, that the two are within 150
 * pixels vertically, and that `obj+0x30` is set — which a weapon still bouncing
 * after a swap is not.
 */
function gunAhead(): Gun | null {
  const at = p.x + p.facing * GRAB.aheadPx;
  for (const g of hereOf((l) => l.guns)) {
    if (g.dropped && g.vy !== undefined) continue; // still in the air, not yours yet
    if (at < g.left || at > g.right) continue;
    if (Math.abs(p.y - g.y) >= GRAB.liftPx) continue;
    return g;
  }
  return null;
}

/**
 * Throw down what you are holding — `0x45b060`, called BEFORE the reach begins.
 *
 * `0x42f0dc` runs it the moment you press S at a gun that is not the one in
 * your hands, so the old one is already falling while you bend for the new one.
 * It comes out at your own point with gravity 1.0 and a bounce of 0.3, and its
 * `obj+0x30` stays 0 until it settles — which is what stops you catching it
 * again on the way down.
 */
function dropGun(): void {
  const lvl = level;
  if (!lvl || !p.room) return;
  const i = lvl.rooms.indexOf(p.room);
  if (i < 0) return;
  lvl.guns[i] = [
    ...lvl.guns[i],
    {
      code: inv.weapon,
      x: p.x,
      y: p.y,
      left: p.x - GRAB.bandPx,
      right: p.x + GRAB.bandPx,
      clock: 0,
      dropped: true,
      vy: 0,
      vx: 0,
    },
  ];
  inv.armed = false;
}

/**
 * The end of the reach — `0x4287bd`, the kind-14 state, which probes the same
 * band again and then runs `0x428846`'s table.
 *
 * The callback at `user+0xc` has already set the weapon and added the rounds by
 * the time that table is reached; what the table adds is `0x45eed0` for the
 * five base weapons, and that is the whole of being armed. The two refills fall
 * through to `0x42884d` — back to the fists — which is why picking up a tank
 * with nothing in your hands leaves you with nothing in your hands.
 */
function takeGun(): void {
  const lvl = level;
  const g = gunAhead();
  if (!lvl || !g || !p.room) return;
  const i = lvl.rooms.indexOf(p.room);
  if (i >= 0) lvl.guns[i] = lvl.guns[i].filter((q) => q !== g);
  const kind = GUN_CODES[g.code];
  // `0x428868` — the one code that is not a weapon at all: 150 health and the
  // player's own sound 0xa, for the thing a dying class drops
  if (g.code === 2) {
    stats.health = Math.min(stats.maxHealth, stats.health + 150);
    sound?.own(0xa, g.x, g.y);
    return;
  }
  if (kind.weapon === null) return;
  // the callback: the weapon, then the rounds, clamped
  inv.weapon = kind.weapon;
  loadRounds(kind.weapon, kind.rounds);
  // ...and `0x45eed0`, which is the only thing that arms you — plus its own
  // single round, which is what makes a bare `statflaregun` worth taking
  if (kind.arms) {
    inv.armed = true;
    loadRounds(kind.weapon, 1);
  }
}

/**
 * Fire — `0x42cd53`, which waits for the wind-up's last frame and then calls
 * the weapon's own function through `0x4a7f10 + id * 12 + 8`.
 *
 * Only the flare gun's is here; {@link FLARE} says why the other four are not.
 * `0x436d43` refuses outright with an empty magazine, so an armed player with
 * no rounds plays the wind-up and nothing comes out — which is the original's
 * behaviour and not an omission.
 */
function fireGun(): void {
  if (inv.weapon !== 9 || roundsIn(9) <= 0) return;
  inv.rounds[9] = roundsIn(9) - 1;
  sound?.effect(FLARE.sound, p.x, p.y);
  flares.push({
    x: p.x + p.facing * FLARE.aheadPx,
    y: p.y - p.feet,
    // the script's dx is an impulse through the object's own divisor, and
    // nothing in the air takes it back again
    vx: (p.facing * FLARE.dx) / FLARE.divisor,
    vy: 0,
    facing: p.facing,
    wobble: FLARE.wobble.lo + Math.floor(Math.random() * (FLARE.wobble.hi - FLARE.wobble.lo + 1)),
    sign: -1,
    burn: null,
    spent: false,
  });
}

/**
 * The flares, one engine frame at a time.
 *
 * `0x43abf0`'s first block is the corkscrew and it is the whole character of the
 * weapon: the random 13..29 the spawner filed is read down two at a time, and
 * each frame its value is added to — or, over 7, simply written into — the
 * flare's vertical velocity, with the sign flipping every frame. So it leaves
 * the barrel thrashing and straightens out after about seven frames.
 *
 * What ends it is `0x43acae`: the ground under it or something it hit, either
 * of which installs tag 4, the burn-out. Its blow is 100 (`0x43ab2d`) and it
 * goes through the same class handlers a fist does.
 */
function stepFlares(): void {
  const lvl = level;
  if (!lvl) return;
  const i = lvl.rooms.indexOf(p.room!);
  const pool = i >= 0 ? lvl.spawned[i] : [];
  for (const f of flares) {
    if (f.burn !== null) {
      f.burn += 1;
      if (f.burn >= FLARE.burn.length * FLARE.burnHold) f.spent = true;
      continue;
    }
    if (f.wobble > 0) {
      // `0x43ac50` — and the counter goes straight into `obj+0xa`, with no
      // divisor on it at all. Under 7 it is ADDED and over 7 it is WRITTEN, so
      // the last few frames are a settle rather than a fresh throw.
      const v = f.sign * f.wobble;
      if (f.wobble < FLARE.wobble.settle) f.vy += v;
      else f.vy = v;
      f.sign = -f.sign;
      f.wobble -= FLARE.wobble.step;
    }
    // `0x42f850(obj, 0.5)` stores `trunc(0.5 * 10)` — half the player's own
    f.vy += FLARE.gravity * PLAYER_GRAVITY;
    const wasY = f.y;
    f.x += f.vx;
    f.y += f.vy;
    // the ground stops it — the same surface test the player falls onto
    const land = f.vy > 0 ? surfaceUnder(f.x, wasY, f.y) : null;
    if (land !== null) {
      f.y = land;
      f.burn = 0;
      continue;
    }
    // ...and so does anything it reaches, at 100 a time
    const art = player?.cels.find((c) => c.id === FLARE.flight);
    const box = {
      left: f.x - (art ? art.width / 2 : 12),
      right: f.x + (art ? art.width / 2 : 12),
      top: f.y - (art ? art.height / 2 : 12),
      bottom: f.y + (art ? art.height / 2 : 12),
    };
    for (const e of pool) {
      if (e.state === "dead" || e.state === "burst") continue;
      const c = lvl.sbk.cels.find((q) => q.id === celOf(e));
      if (!c) continue;
      const hurt = hurtBox(e, c, lvl);
      if (!(box.right > hurt.left && box.left < hurt.right && box.bottom > hurt.top && box.top < hurt.bottom)) continue;
      strikeFoe(e, FLARE.blow, { dx: FLARE.dx, dy: 0 }, f.facing, (box.top + box.bottom) / 2, hurt);
      f.burn = 0;
      break;
    }
  }
  flares = flares.filter((f) => !f.spent);
}

/**
 * The dropped ones fall — `0x45b060` gives a thrown weapon gravity 1.0 and
 * clears `obj+0x30`, and the handler's think (`0x45ade5`) re-creates it as a
 * standing pickup the frame it lands.
 */
function stepGuns(): void {
  for (const g of hereOf((l) => l.guns)) {
    g.clock += TICK_SCALE;
    if (!g.dropped || g.vy === undefined) continue;
    // `0x45b060` — `0x42f850(obj, 1.0)`, the same pull the player takes
    g.vy += PLAYER_GRAVITY * TICK_SCALE;
    const wasY = g.y;
    g.y += g.vy * TICK_SCALE;
    const land = surfaceUnder(g.x, wasY, g.y);
    if (land === null) continue;
    g.y = land;
    g.vy = undefined;
    g.vx = undefined;
  }
}

/**
 * How long this level gives you, and it was in the books all along.
 *
 * Every chapter's entry function ends with the same block — `0x421e60` is
 * chapter three's, and `0x4164a2`, `0x43be72` and `0x451582` are its three
 * siblings. It asks the book for its `timer` records, and:
 *
 * ```
 *   421e8f  mov  eax, [esp]        ; the first record, and +0 is its PARAM
 *   421e94  call 0x40d340          ; -> [0x4a3b18], the dial's full scale
 *   421e99  mov  eax, [esp+4]      ; esp moved: the SAME dword again
 *   421ea1  call 0x40d350          ; -> [0x4a4d68], the clock itself
 *   421ead  push 0x7d00            ; no record at all: both get 32000
 * ```
 *
 * So one number does both, and it is the record's own `param`. Eleven books
 * carry one and five do not, and the five that do not have **no time limit** —
 * `0x40d250` reads 32000 as "no dial". Which is exactly the five you would
 * expect: PLAYGR and ARCADE, whose bosses the level waits for, and CAVERN,
 * TOWER and VAT.
 *
 * ```
 *   streets 4000   city 8200   woods 7200   playgr    —
 *   mall    5220   service 5300  sewer 7200  arcade   —
 *   grave   2100   cavern   —   ravecave 2500  tower  —
 *   maze    3200   barrel 8200  lab 2500    vat      —
 * ```
 *
 * This page had been giving all sixteen the full dial, which is `CLOCK_FULL`
 * — 7200, and so right only for WOODS and SEWER by accident.
 */
function clockFor(sbk: SbkFile): number {
  const rec = sbk.entities.find((e) => e.name === "timer");
  return rec ? rec.param : CLOCK.noLimit;
}

/** every roach in the air or on the floor, nest or no nest */
let roaches: Roach[] = [];

/** which of the seven slots has water standing in it, and how far into its script */
let columns = new Map<number, number>();

/**
 * `0x441b20` and `0x441b60` — send up the sprinkler the boss is standing over.
 *
 * The test is on the BOSS's own point, not the player's: `0x40b660` asks which
 * `initsprinkler` record's rect contains it and hands back that record's `param`,
 * which is its slot. If the slot is already taken `0x441b60` rolls
 * `0x434540(7)` for another and tries up to seven times, so a boss that keeps
 * diving into the same corner still fills the room.
 *
 * And it is not free to it: `0x440bf9` takes **three health a frame** off the
 * boss for standing in water that is already up, which is the whole tactic of
 * level eight.
 */
function raiseSprinkler(e: Enemy): void {
  const all = hereOf((l) => l.sprinklers);
  if (!all.length) return;
  const over = all.find((q) => e.x >= q.left && e.x < q.right && e.y >= q.top && e.y < q.bottom);
  if (!over) return;
  if (!columns.has(over.slot)) {
    columns.set(over.slot, 0);
    return;
  }
  // `0x441b7a`: it is already up, so roll for a free one and try up to seven times
  for (let i = 0; i < SPRINKLER.slots; i++) {
    const q = all[roll(all.length) - 1];
    if (columns.has(q.slot)) continue;
    columns.set(q.slot, 0);
    return;
  }
}

/**
 * Step the water — `0x473748`'s own three tags, and what standing in one costs.
 *
 * A column rises through seven cels, sprays while its context's own `0x15e`
 * frames run down, and goes. The boss pays three health a frame for being in one
 * (`0x440bf9`) and the player pays the blow the spraying cels carry, which is
 * the same rule every other strike box in the game follows.
 */
function stepColumns(): void {
  const all = hereOf((l) => l.sprinklers);
  if (!all.length && !columns.size) return;
  const gone: number[] = [];
  for (const [slot, clock] of columns) {
    const next = clock + TICK_SCALE;
    if (next >= SPRINKLER.rise.cels.length * SPRINKLER.rise.hold + SPRINKLER.life) gone.push(slot);
    else columns.set(slot, next);
  }
  for (const slot of gone) columns.delete(slot);
  if (!columns.size) return;
  // and three a frame off whatever boss is standing in one
  for (const e of spawnedHere()) {
    if (e.state !== "gait" || !FOES[e.kind].drives?.raises) continue;
    for (const [slot] of columns) {
      const q = all.find((w) => w.slot === slot);
      if (!q || e.x < q.left || e.x >= q.right || e.y < q.top || e.y >= q.bottom) continue;
      e.hp = Math.max(0, e.hp - 3 * TICK_SCALE);
      if (e.hp <= 0) {
        const foe = FOES[e.kind];
        e.state = "dead";
        e.anim = foe.death ?? foe.gait;
        e.clock = 0;
        e.linger = foe.linger ?? CORPSE_LINGER;
        stats.score += foe.award ?? foe.panel?.award ?? 0;
      }
    }
  }
}

/** which cel a standing column is showing, rise then spray */
function columnCel(clock: number): number {
  const up = SPRINKLER.rise.cels.length * SPRINKLER.rise.hold;
  if (clock < up) return SPRINKLER.rise.cels[Math.floor(clock / SPRINKLER.rise.hold)];
  const i = Math.floor((clock - up) / SPRINKLER.spray.hold) % SPRINKLER.spray.cels.length;
  return SPRINKLER.spray.cels[i];
}

/**
 * Step the six pieces of scenery that do something.
 *
 * Each is one paragraph of its own class's think, and the addresses are in
 * {@link file://./props.ts}. None of them can be hit and none of them is in any
 * level's census; what they are is the difference between a room and a corridor.
 */
function stepScenery(): void {
  const ay = p.y - p.feet;
  const inRect = (r: { top: number; left: number; bottom: number; right: number }): boolean =>
    p.x >= r.left && p.x < r.right && ay >= r.top && ay < r.bottom;

  // `0x453a60`: shut until your point is inside, then up; and down again only
  // once the opening has finished AND you have gone
  for (const k of hereOf((l) => l.shacks)) {
    if (k.state === "shut") {
      if (inRect(k)) {
        k.state = "opening";
        k.clock = 0;
      }
      continue;
    }
    k.clock += TICK_SCALE;
    if (k.clock < shackFrames(k)) continue;
    if (k.state === "opening") {
      if (inRect(k)) {
        // `0x453ace`: still there, so it stays up
        k.clock = shackFrames(k) - 1;
        continue;
      }
      k.state = "closing";
      k.clock = 0;
    } else {
      k.state = "shut";
      k.clock = 0;
    }
  }

  // `0x43fc30`: the script's own bob, clamped, and walked back towards the point
  // its record gave it
  for (const b of hereOf((l) => l.barrels)) {
    const wasX = b.x;
    const wasY = b.y;
    b.clock += TICK_SCALE;
    const i = loopIndex(BARREL.bob, b.clock);
    b.x += ((BARREL.bob.dx[i] ?? 0) / BARREL.divisor) * TICK_SCALE;
    b.y += ((BARREL.bob.dy[i] ?? 0) / BARREL.divisor) * TICK_SCALE;
    if (Math.abs(b.x - b.homeX) > BARREL.drift) b.x += Math.sign(b.homeX - b.x) * BARREL.home * TICK_SCALE;
    if (Math.abs(b.y - b.homeY) > BARREL.drift) b.y += Math.sign(b.homeY - b.y) * BARREL.home * TICK_SCALE;
    if (b.floor) {
      b.floor.left += b.x - wasX;
      b.floor.right += b.x - wasX;
      b.floor.top += b.y - wasY;
      b.floor.bottom += b.y - wasY;
    }
  }

  for (const q of hereOf((l) => l.pipes)) q.clock += TICK_SCALE;
  for (const q of hereOf((l) => l.bushes)) q.clock += TICK_SCALE;

  // `0x4404c0`: the splash going in, the gulp every ninth frame, and the health
  // — which only leaves when the switch that lets things hit back is on
  for (const w of hereOf((l) => l.sewage)) {
    if (!inRect(w)) {
      w.clock = SEWAGE.gulpEvery;
      continue;
    }
    if (p.vy / TICK_SCALE > SEWAGE.splashAbove) sound?.effect(SEWAGE.splash, p.x, p.y);
    w.clock -= TICK_SCALE;
    if (w.clock <= 0) {
      w.clock = SEWAGE.gulpEvery;
      sound?.effect(SEWAGE.gulp, p.x, p.y);
    }
    if (damageOn && p.act !== "dying") takeHealth(SEWAGE.perFrame * TICK_SCALE);
  }

  // `0x43b3a4`: four in a rush while you are standing in the rect, and then a
  // little over two seconds of nothing
  for (const n of hereOf((l) => l.nests2)) {
    if (!inRect(n)) continue;
    n.clock += TICK_SCALE;
    if (n.clock <= -2) continue;
    n.made += 1;
    roaches.push({
      x: n.x,
      y: n.y,
      vy: 0,
      facing: Math.random() < 0.5 ? 1 : -1,
      onGround: false,
      clock: 0,
      top: n.top,
      left: n.left,
      bottom: n.bottom,
      right: n.right,
    });
    if (n.made >= ROACH.burst) {
      n.clock = -ROACH.gapOut;
      n.made = 0;
    } else n.clock = roll(ROACH.gapIn) - ROACH.gapIn;
  }
  for (const r of roaches) {
    r.clock += TICK_SCALE;
    if (!r.onGround) {
      // `0x43b17f` waits for the ground before the run starts at all
      r.vy += PLAYER_GRAVITY * ROACH.gravity * TICK_SCALE;
      r.y += r.vy * TICK_SCALE;
      const floor = surfaceUnder(r.x, r.y - CLIMB_PX, r.y + Math.max(r.vy, 0) + STICK_PX);
      if (floor !== null && r.y >= floor) {
        r.y = floor;
        r.vy = 0;
        r.onGround = true;
        r.clock = 0;
        sound?.effect(ROACH.runSound, r.x, r.y);
      }
      continue;
    }
    // the run carries `dx 65` on every one of its four cels
    const i = loopIndex(ROACH.run, r.clock);
    r.x += ((ROACH.run.dx[i] ?? 0) / ROACH.divisor) * TICK_SCALE * r.facing;
    const floor = surfaceUnder(r.x, r.y - CLIMB_PX, r.y + STICK_PX);
    if (floor !== null) r.y = floor;
  }
  // `0x43b1e8`: it removes itself the frame its own point leaves the rect
  roaches = roaches.filter((r) => r.x >= r.left && r.x <= r.right && r.y >= r.top - 200 && r.y <= r.bottom + 200);
}

/** the doors in the room the player is in */
function doorsHere(): Door[] {
  const i = level && p.room ? level.rooms.indexOf(p.room) : -1;
  return level && i >= 0 ? level.doors[i] : [];
}

/** the lifts in the room the player is in */
function elevsHere(): Elev[] {
  const i = level && p.room ? level.rooms.indexOf(p.room) : -1;
  return level && i >= 0 ? level.elevs[i] : [];
}

/**
 * What the player's anchor may not be inside: the room's `obstacle` records, and
 * every door in it that is not yet open.
 *
 * The engine keeps one table for both — `0x435ff0` appends a door's rect to the
 * same `0x4a89e2` array the level's walls are read into, and `0x440060` takes it
 * out again as the door finishes opening — so this is one list there too.
 */
function blockers(): { top: number; left: number; bottom: number; right: number }[] {
  const out: { top: number; left: number; bottom: number; right: number }[] = [...solids().obstacles];
  for (const d of doorsHere()) if (d.state !== "open") out.push(d);
  // `0x411460` is what a cage door does as it shuts: it appends its own rect to
  // the level's obstacle table, so it stops being a door and starts being wall
  for (const c of hereOf((l) => l.cages)) if (c.state === "shut" || c.state === "closing") out.push(c);
  return out;
}

/**
 * Step every door — `0x43ffd0`, which is two branches.
 *
 * Only the two moving tags do anything: the opening one, when its script ends,
 * becomes the open tag and takes the rect out of the obstacle table; the closing
 * one becomes the shut tag, puts the rect back, and sounds. The two resting tags
 * wait for a lever.
 */
function stepDoors(): void {
  /**
   * ...and every door in the LEVEL, not in the room.
   *
   * Four of level seven's five levers stand in a different region from the door
   * they open, so a door that only moved while you were looking at it would be
   * left half open for ever — which is exactly what happened: throw the lever on
   * the ledge, walk east, and find the door still on the second frame of its
   * opening animation and still solid.
   */
  for (const d of level?.doors.flat() ?? []) {
    if (d.state === "shut" || d.state === "open") continue;
    d.clock += TICK_SCALE;
    if (d.clock < doorFrames(d)) continue;
    d.clock = 0;
    if (d.state === "opening") d.state = "open";
    else {
      d.state = "shut";
      sound?.effect(DOOR.shutSound, d.x, d.y);
    }
  }
}

/**
 * Step every lift — `0x43d810`, and {@link ELEV} has its five tags.
 *
 * The cycle needs nothing from outside it: at rest it asks whether the rect's
 * bottom is below it and goes the other way, and each moving tag adds its
 * impulse, clamps, and watches for the end of the shaft. Its platform record
 * goes with it, which is what a rider stands on.
 */
function stepElevs(): void {
  for (const e of elevsHere()) {
    e.clock += TICK_SCALE;
    if (e.state === "atBottom") {
      if (e.clock < ELEV.waitFrames) continue;
      e.clock = 0;
      // `0x43d84e`: is the bottom of the shaft below me? then sink; else rise
      e.state = e.bottom > e.y ? "startDown" : "startUp";
      continue;
    }
    if (e.state === "startDown" || e.state === "startUp") {
      if (e.clock < ELEV.startFrames) continue;
      e.clock = 0;
      e.state = e.state === "startDown" ? "down" : "up";
      continue;
    }
    const was = e.y;
    if (e.state === "down") {
      // `0x42f8b0`: the impulse is divided, and the result never exceeds the cap
      e.vy = Math.min(ELEV.downCap, e.vy + ELEV.push / ELEV.divisor);
      e.y += e.vy * TICK_SCALE;
      if (e.y >= e.bottom) {
        e.y = e.bottom;
        e.vy = 0;
        e.state = "atBottom";
        e.clock = 0;
      }
    } else {
      const cap = ELEV.upCap[e.param] ?? ELEV.upCap[0];
      e.vy = Math.max(-cap, e.vy - ELEV.push / ELEV.divisor);
      e.y += e.vy * TICK_SCALE;
      if (e.y <= e.top) {
        e.y = e.top;
        e.vy = 0;
        e.state = "atBottom";
        e.clock = 0;
      }
    }
    const moved = e.y - was;
    if (e.floor && moved !== 0) {
      e.floor.top += moved;
      e.floor.bottom += moved;
      // a rider goes with it, which is what owning a floor MEANS
      // the rider is not moved here: the platform record IS the floor, and the
      // player's own pin finds it again where it now is ({@link surfaceUnder})
    }
  }
}

/**
 * `0x438200` — the first unlit lever standing inside this thing's own territory.
 *
 * The rect is the enemy record's, and the test is on the LEVER's position, not
 * the enemy's: a gang member is the keeper of whatever lever its patrol covers,
 * and SERVICE gives every one of its six a keeper.
 */
function leverFor(e: Enemy, dir: 0 | 1): Switch | null {
  const want = dir === 0 ? "off" : "on";
  for (const s of switchesHere()) {
    if (s.state !== want) continue;
    if (s.x < e.left || s.x > e.right || s.y < e.top || s.y > e.bottom) continue;
    return s;
  }
  return null;
}

/**
 * What a lever's throw broadcasts, and there are two of them.
 *
 * `0x43c3d0` takes a `param` of 500 or more and flips every goop that carries
 * it. `0x43c430` takes one under 500 and flips every DOOR that carries it: a
 * shut one starts opening, an open one starts shutting, and a door already
 * moving is left alone. Level six's levers are all in the first range and level
 * seven's are all in the second, which is why each level has exactly one of the
 * two behaviours.
 */
function broadcast(param: number): void {
  const lvl = level;
  if (!lvl) return;
  if (param >= 500) {
    for (const n of lvl.nests.flat()) {
      if (n.param !== param) continue;
      n.on = !n.on;
      sound?.effect(SWITCH.toggle, (n.left + n.right) / 2, n.top);
    }
    return;
  }
  /**
   * ...and both lists are the LEVEL's, not the room's. The engine holds one
   * linked list per class for the whole stage, and `0x43c430` walks the lot —
   * which is the point of level seven's levers: four of its five stand in a
   * different region from the door they open, and the last of them is two rooms
   * and a shaft away from it.
   */
  // ...and MAZE's seven cage doors take the same broadcast, out of the same
  // range: its switches carry 1, 2, 3, 4 the way SEWER's carry -1, 2, 7, 8, -4
  for (const c of lvl.cages.flat()) {
    if (c.param !== param) continue;
    if (c.state === "shut") {
      c.state = "opening";
      c.clock = 0;
    } else if (c.state === "open") {
      c.state = "closing";
      c.clock = 0;
    }
  }
  for (const d of lvl.doors.flat()) {
    if (d.param !== param) continue;
    if (d.state === "shut") {
      d.state = "opening";
      d.clock = 0;
    } else if (d.state === "open") {
      d.state = "closing";
      d.clock = 0;
    }
  }
}

/** every drip of goop in the air, whichever string it belongs to */
let drips: Drip[] = [];

/** `0x434540(n)` returns 1…n, and these are the three places level six rolls it */
function roll(n: number): number {
  return Math.floor(Math.random() * n) + 1;
}

/**
 * Run the goop — `0x437502` for the nests and `0x437310`'s other three branches
 * for what they make.
 *
 * A running nest drips 42 times in 512 frames, from anywhere along the top edge
 * of its own rect, and tosses for which of the two strings it gets. After that
 * every link is on rails: the two that hang are still and turn into the two that
 * fall, the gob bursts into three splashes where it lands, and everything is
 * gone the frame it touches the floor.
 */
function stepGoop(): void {
  const lvl = level;
  if (!lvl) return;
  for (const n of nestsHere()) {
    if (!n.on) continue;
    if (Math.random() >= GOOP.chance * TICK_SCALE) continue;
    const kind = roll(2) - 1 === 0 ? "bead" : "strand";
    drips.push({ kind, x: n.left + roll(n.right - n.left), y: n.top, vx: 0, vy: 0, clock: 0 });
  }
  const born: Drip[] = [];
  for (const d of drips) {
    d.clock += TICK_SCALE;
    const done = d.clock >= dripFrames(d);
    if (d.kind === "bead") {
      // `0x437350`: the bead hangs still and becomes a drop where it is
      if (!done) continue;
      d.spent = true;
      born.push({ kind: "drop", x: d.x, y: d.y, vx: 0, vy: 0, clock: 0 });
      sound?.effect(GOOP.dropSound, d.x, d.y);
      continue;
    }
    if (d.kind === "strand") {
      // `0x437408`: the gob comes at the strand's EIGHTH cel, not at its end
      if (!d.spent && dripCel(d) === GOOP.gobAtCel) {
        d.spent = true;
        born.push({ kind: "gob", x: d.x, y: d.y + GOOP.gobBelow, vx: 0, vy: 0, clock: 0 });
        sound?.effect(GOOP.gobSound, d.x, d.y + GOOP.gobBelow);
      }
      continue;
    }
    // the three that move: gravity 1.0 for a drop and a gob, ½ for a splash
    const g = d.kind === "splash" ? PLAYER_GRAVITY / 2 : PLAYER_GRAVITY;
    d.vy += g * TICK_SCALE;
    d.y += d.vy * TICK_SCALE;
    d.x += d.vx * TICK_SCALE;
  }
  drips.push(...born);
  const floor = (d: Drip): boolean => {
    const g = groundAt(d.x);
    return g !== null && d.y >= g;
  };
  drips = drips.filter((d) => {
    if (d.kind === "bead") return d.clock < dripFrames(d);
    // the strand is removed when its own script ends, gob or no gob
    if (d.kind === "strand") return d.clock < dripFrames(d);
    if (!floor(d) && d.clock < dripFrames(d) * 4) return true;
    if (d.kind === "gob") {
      // `0x43747c`: three of them, each with its own shove
      for (let i = 0; i < GOOP.splashes; i++) {
        drips.push({
          kind: "splash",
          x: d.x,
          y: d.y,
          vx: Math.round((roll(200) - 100) / GOOP.divisor),
          vy: Math.round((roll(80) - 70) / GOOP.divisor),
          clock: 0,
        });
      }
    }
    return false;
  });
  feedTheGang();
}

/**
 * Which drips can touch anything at all — and it is **one cel in the whole
 * family**.
 *
 * Of the nine cels the two strings use, only 518, the gob, carries a strike box
 * (`y -2 … 20`, `x -8 … 11`) and a blow pair (`dy 25, dx -1`). The bead, the
 * drop it turns into, the strand and the three splashes carry neither, so they
 * are weather: they fall through the player and through the gang and land. What
 * the level actually throws at you is the second string's gob, at 25 plus
 * whatever it has picked up falling, which is under the player's own knockdown
 * threshold of 60 for about the first three frames of its drop and over it after.
 */
function dripStrike(d: Drip): SbkCel | null {
  const c = level?.sbk.cels.find((q) => q.id === dripCel(d));
  return c?.strike && c.blow ? c : null;
}

/**
 * What goop does to the gang — `0x438339`, `0x438fd9`, `0x439a59`, `0x43a659`.
 *
 * Their hit handlers ask which class hit them before they do anything else, and
 * goop is the one answer that is good news: health goes UP by the class's own
 * figure, clamped to what it started with, one sound, and no spray and no
 * subtraction. Sixty for the one with the bat and twenty for the other three.
 *
 * It reaches them the same way a blow does — the gob's own strike box against
 * the body box of the cel they are showing — so it is the same one cel that
 * feeds them and the same one that hurts you.
 */
function feedTheGang(): void {
  const lvl = level;
  if (!lvl || !drips.length) return;
  for (const e of spawnedHere()) {
    if (e.state === "dead" || e.state === "burst" || e.asleep) continue;
    const heal = GOOP.feeds[e.kind];
    if (heal === undefined) continue;
    const foe = FOES[e.kind];
    if (e.hp <= 0 || e.hp >= foe.health) continue;
    const c = lvl.sbk.cels.find((q) => q.id === celOf(e));
    if (!c) continue;
    const box = hurtBox(e, c, lvl);
    const fed = drips.find((d) => {
      const cel = dripStrike(d);
      if (!cel) return false;
      const b = strikeOf(cel, d.x, d.y, 1);
      return !!b && b.right > box.left && b.left < box.right && b.bottom > box.top && b.top < box.bottom;
    });
    if (!fed) continue;
    e.hp = Math.min(foe.health, e.hp + heal);
    sound?.effect(GOOP.fedSound, e.x, e.y);
    drips = drips.filter((d) => d !== fed);
  }
}

/** the girders in the room the player is in */
function ibeamsHere(): Ibeam[] {
  const i = level && p.room ? level.rooms.indexOf(p.room) : -1;
  return level && i >= 0 ? level.ibeams[i] : [];
}

/**
 * Step every girder: the delay, then tag 0 to 1 to 2 and round again.
 *
 * `0x4537d0` returns without touching the state machine while `ctx+4` is counting,
 * and installs the next tag at each script end, flipping `ctx+6`'s low bit so the
 * passes alternate. It never moves the thing — the arc is entirely in the cels.
 */
function stepIbeams(): void {
  for (const b of ibeamsHere()) {
    if (b.delay > 0) {
      b.delay -= TICK_SCALE;
      continue;
    }
    b.clock += TICK_SCALE;
    if (b.clock < ibeamFrames(b)) continue;
    b.clock = 0;
    b.side = b.side ? 0 : 1;
    if (b.state === "out") b.state = "across";
    else if (b.state === "across") {
      b.state = "back";
      sound?.effect(IBEAM.sound, b.x, b.y);
    } else b.state = "out";
  }
}

/** the crows in the room the player is in */
function crowsHere(): Crow[] {
  const i = level && p.room ? level.rooms.indexOf(p.room) : -1;
  return level && i >= 0 ? level.crows[i] : [];
}

/** the feathers a struck crow has thrown off, wherever they are */
let feathers: Feather[] = [];

/**
 * Step every crow — `0x451aa0`, and {@link CROW} has its nine states written out.
 *
 * The one thing to keep hold of while reading this: **no frame of any of the
 * crow's scripts carries a `dx` or a `dy`.** All of its motion is the frame
 * function's, and all the frame function moves is height — ten pixels a frame
 * toward `player.y - 100`, jittered, held inside a five-pixel band. A crow keeps
 * the x the level gave it.
 *
 * The port's simplification is the dive: `0x451ea5` splits state 8 across five
 * tags — a beat that abandons the attack four times in ten, a recovery, and three
 * that hold the crow at the player's height while it is west of them — and this
 * runs the whole 1870..1887 sequence as one pass with the same give-up roll and
 * the same undamped descent, which is what the five tags add up to.
 */
function stepCrows(): void {
  const lvl = level;
  for (const c of crowsHere()) {
    c.clock += TICK_SCALE;
    const run = crowFrames(c);
    if (c.state === "tumble") {
      // dead: `0x42f850(obj, 1.0f)` — the player's own gravity, and it is gone
      // once it is out of the room
      c.vy = Math.min(c.vy + (CROW.deadGravity / 12) * TICK_SCALE * TICK_SCALE, INVENTED.maxFallPx);
      c.y += c.vy;
      continue;
    }
    if (c.state === "sleep") {
      // `0x451ba3`: the player's own point inside the crow's rect, and nothing else
      const ay = p.y - p.feet;
      if (p.x >= c.left && p.x < c.right && ay >= c.top && ay < c.bottom) {
        c.state = "wake";
        c.clock = 0;
      } else if (c.clock >= run) {
        sound?.effect(CROW.sound.sleep, c.x, c.y);
        c.clock = 0;
      }
      continue;
    }
    // airborne from here: hold the height the frame function wants
    if (c.state !== "wake") {
      const want = p.y - p.feet - CROW.above + c.slack * c.factor;
      const gap = want - c.y;
      const step = (CROW.climb / CROW.divisor) * TICK_SCALE;
      if (gap > CROW.band) c.y += Math.min(step, gap);
      else if (gap < -CROW.band) c.y -= Math.min(step, -gap);
    }
    if (c.state === "wake" && c.clock >= run) {
      c.state = "rise";
      c.clock = 0;
    } else if (c.state === "rise" && c.clock >= run) {
      c.state = "fly";
      c.clock = 0;
      sound?.effect(CROW.sound.flap, c.x, c.y);
    } else if (c.state === "fly") {
      // `0x451c94` and `0x451dfa`: inside 160 it strikes at once, and its own
      // circling loop strikes anything further than 350 away
      const near = Math.abs(p.x - c.x) < CROW.strikeAt;
      const far = Math.abs(p.x - c.x) >= CROW.farAt;
      if (c.clock >= run && (near || far)) {
        c.state = "strike";
        c.clock = 0;
        c.factor = 1 + Math.floor(Math.random() * 2);
        c.slack = CROW.jitter[0] + Math.floor(Math.random() * (CROW.jitter[1] - CROW.jitter[0] + 1));
        sound?.effect(CROW.sound.strike, c.x, c.y);
      } else if (c.clock >= run) c.clock = 0;
    } else if (c.state === "strike" && c.clock >= run) {
      // `0x451eb9`: four times in ten it gives the attack up
      c.state = "fly";
      c.clock = 0;
      if (Math.floor(Math.random() * 10) >= CROW.giveUp) sound?.effect(CROW.sound.flap, c.x, c.y);
    }
  }
  // and the feathers: they fall at the player's own gravity and go on landing
  for (const f of feathers) {
    f.age += TICK_SCALE;
    f.vy = Math.min(f.vy + INVENTED.gravityPx, INVENTED.maxFallPx);
    f.y += f.vy;
  }
  feathers = feathers.filter((f) => {
    const g = groundAt(f.x);
    return f.age < CROW.feathers.cels.length * CROW.feathers.hold && (g === null || f.y < g);
  });
  // a tumbling crow is done with once it has left the room
  const room = p.room;
  const i = lvl && room ? lvl.rooms.indexOf(room) : -1;
  if (lvl && room && i >= 0) {
    lvl.crows[i] = lvl.crows[i].filter((c) => c.state !== "tumble" || c.y < room.bottom + 400);
  }
}

/**
 * A blow landing on a crow — `0x4520d0`, which has no health test in it.
 *
 * One hit is all: feathers (one puff, or three when the blow beats 50), woods 18,
 * gravity on and the tumble. The award is `0x40d450(0x50)`.
 */
function strikeCrow(c: Crow, damage: number): void {
  const puffs = damage > CROW.hardBlow ? 3 : 1;
  for (let i = 0; i < puffs; i++) {
    feathers.push({ x: c.x + (Math.random() - 0.5) * 30, y: c.y + (Math.random() - 0.5) * 30, vy: 0, age: 0 });
  }
  sound?.effect(CROW.sound.hit, c.x, c.y);
  c.state = "tumble";
  c.clock = 0;
  c.vy = 0;
  stats.score += CROW.award;
}

/**
 * Step each spawned thing: its animation, then whatever that animation moves.
 *
 * The frame decides the step, not a speed: `dx` is the engine's per-frame number
 * for that cel, divided by the CLASS's own divisor (`obj+0xe` — 20 for a punk, 7
 * for a mailbox) the way `0x42f8b0` divides it, and scaled by {@link TICK_SCALE}
 * because this page's tick is shorter than the engine's.
 *
 * A flinch or a death runs to its end and then hands back: a flinch returns to
 * the gait, a death counts `[0x46b204]`'s fifty frames down and the thing is
 * removed. It stays in the level's census the whole time it is lying there,
 * because the engine's own census only drops when the OBJECT goes (`0x42f750`
 * decrements `0x4a6e88` on destruction, and the death path never calls
 * `0x42f870(obj, 0)`) — so the quota is not met until the bodies are gone.
 *
 * Turning at the rect's edge is this port's; the class's territory numbers are in
 * the AI struct nothing has read. See {@link FOES}.
 */
/**
 * The statue, and the fight it turns into — the two states this page gives the
 * one class that has them ({@link Foe.wake}, {@link Foe.drives}).
 *
 * Returns true only while it is still a statue, which is the one state that has
 * to suppress everything else. The rest of it just chooses the animation and
 * lets the ordinary path play and MOVE it, since the charge's eleven pixels a
 * frame are the script's own `dx` and the gait block already applies those.
 */
function stepBoss(e: Enemy, foe: Foe, run: number): boolean {
  // asleep: one cel, no motion, and `0x434200(playerPoint, AI+6)` every frame
  if (e.asleep) {
    if (!foe.wake) return false;
    const ay = p.y - p.feet;
    const inside = p.x >= e.left && p.x < e.right && ay >= e.top && ay < e.bottom;
    if (!inside) return true;
    e.asleep = false;
    e.mode = undefined;
    // a kind with no stirring of its own simply starts walking
    e.anim = foe.wake.stir ?? foe.gait;
    e.clock = 0;
    if (foe.wake.sound !== undefined) sound?.effect(foe.wake.sound, e.x, e.y);
    return false;
  }
  if (foe.wake?.stir && e.anim === foe.wake.stir) {
    if (e.clock < run) return false;
    // `0x455a67`: the climb out of the ground, with a loop playing under it
    e.anim = foe.wake.burst ?? foe.gait;
    e.clock = 0;
    if (foe.wake.stirSound !== undefined) sound?.effect(foe.wake.stirSound, e.x, e.y);
    return false;
  }
  const d = foe.drives;
  if (!d) {
    // no combat states: the walk is where a woken thing lives
    if (foe.wake?.burst && e.anim === foe.wake.burst && e.clock >= run) {
      e.anim = foe.gait;
      e.clock = 0;
    }
    return false;
  }
  if (foe.wake?.burst && e.anim === foe.wake.burst) {
    if (e.clock < run) return false;
    e.anim = d.hover;
    e.mode = "hover";
    e.clock = 0;
    e.decisions = d.decisions;
    return false;
  }
  /**
   * A boss with no dormancy is in its states from the first frame. The one in
   * level four is woken by its rect and climbs out of the ground before any of
   * this runs; level eight's is simply there when the room loads, because
   * `0x436180` installs its idle and `0x440ab0` takes over on the next frame.
   */
  if (!e.mode) {
    if (foe.wake) return false;
    e.mode = "hover";
    e.anim = d.hover;
    e.clock = 0;
  }
  /**
   * ...and the boss with no gravity holds its own height every frame, not only
   * on the frames it decides.
   *
   * `0x440ce6`: a direction of ±1 goes into the vertical velocity each frame and
   * is reversed whenever the velocity reaches the limit its distance from the
   * player allows — the slow pair while the player is within `slack` of the
   * `offset` it wants them at, the fast pair while they are not.
   */
  if (d.bob && foe.floats) {
    const want = d.bob.offset;
    // both sides are ANCHORS, as `0x440d6f` compares `obj+6` against `obj+6`:
    // the player's is their feet less the standing box, and the foe's is what
    // {@link foeAnchor} converts back to
    const mine = level ? foeAnchor(e, level) : null;
    const dy = p.y - p.feet - (mine ? mine.y : e.y);
    const [lo, hi] = dy < want - d.bob.slack || dy > want + d.bob.slack ? d.bob.far : d.bob.near;
    if (!e.hover) e.hover = 1;
    let v = e.vy / TICK_SCALE + e.hover;
    if (v < lo || v > hi) {
      e.hover = -e.hover;
      v = Math.max(lo, Math.min(hi, v));
    }
    // the velocity only: the mover below is what turns it into a position
    e.vy = v * TICK_SCALE;
    // `0x440db6`: the brain's own forward distance going negative is what turns it
    const ahead = (p.x - e.x) * e.facing;
    if (ahead < 0) e.facing = -e.facing;
  }
  if (e.clock < run) return false;
  e.clock = 0;
  /**
   * `0x440ddc`, the frame that decides, when the class has bands rather than one
   * near edge: `0x45efd0` counts how many of the thresholds are at or above the
   * forward distance to the player, and `0x441adc` dispatches on the count.
   */
  if (d.bands) {
    /**
     * Every state but the closing one plays once and hands back to the hover,
     * and the hover is where the band is read. `0x440ddc` is inside kind 1 and
     * nowhere else: the attacks do not re-decide, they finish.
     */
    if (e.mode !== "hover" && e.mode !== "charge") {
      // `0x4415a9`: the dive ends over a sprinkler, and that sprinkler goes up
      if (d.raises && e.mode === d.raises) raiseSprinkler(e);
      e.mode = "hover";
      e.anim = d.hover;
      return false;
    }
    const ahead = (p.x - e.x) * e.facing;
    let band = 0;
    for (const t of d.bands) {
      if (t < ahead) break;
      band += 1;
    }
    /**
     * `0x440df1` / `0x440e0b` / `0x440e48` / `0x440e9f`, and two of the four ask
     * a second question before they answer:
     *
     * - band 1 wants the brain's `side` to be **2**, which `0x45f00c` sets when
     *   the target's own horizontal velocity is zero — it lunges at someone
     *   standing still and hangs back from someone moving.
     * - band 2 splits on two thirds of its health, and band 3 does nothing at
     *   all until it has been hurt.
     */
    const still = Math.abs(p.vx) < 1e-6;
    const strong = e.hp > (e.max * 2) / 3;
    const pick: Enemy["mode"] =
      band === 0
        ? "charge"
        : band === 1
          ? still
            ? "antiAir"
            : "hover"
          : band === 2
            ? strong
              ? "combo"
              : "rush"
            : e.hp < e.max
              ? "rush"
              : "hover";
    if (pick !== e.mode) {
      e.mode = pick;
      e.anim = d[pick as "charge" | "antiAir" | "combo" | "rush" | "hover"];
    }
    return false;
  }
  /**
   * `0x455e87`, the frame that decides, kept to what can be honest here: the
   * distance forward, the one band edge that chooses between closing and
   * swinging, and the budget that sends it home.
   *
   * The engine's own version reads six bands off `0x478780` and has a second
   * ladder for whether the player is airborne (`0x455bfd` picks the overhead
   * swat for one in the air and the ground swing for one on his feet). Those two
   * animations are in {@link Foe.drives} and this does not yet reach for them.
   */
  if (e.mode !== "hover") {
    e.anim = d.hover;
    e.mode = "hover";
    return false;
  }
  const dx = p.x - e.x;
  e.decisions = (e.decisions ?? d.decisions) - 1;
  if (e.decisions <= 0) {
    // `0x455ec4`: face home, and stand down once it is near enough
    const home = d.homeX - e.x;
    if (Math.abs(home) < d.homePx) {
      e.decisions = d.decisions;
      e.anim = d.land;
      e.mode = "land";
      return false;
    }
    e.facing = home > 0 ? 1 : -1;
    e.anim = d.rush;
    e.mode = "rush";
    return false;
  }
  e.facing = dx > 0 ? 1 : -1;
  if (Math.abs(dx) <= d.nearPx) {
    // `0x455f64`: inside the near band it swings rather than closes
    e.anim = d.combo;
    e.mode = "combo";
    return false;
  }
  e.anim = d.charge;
  e.mode = "charge";
  return false;
}

function stepEnemies(): void {
  const lvl = level;
  const pool = spawnedHere();
  for (const e of [...pool]) {
    const foe = FOES[e.kind];
    e.clock += TICK_SCALE;
    const run = e.anim.cels.length * e.anim.hold;
    if (e.state === "dead") {
      /**
       * ...and what comes out of it. `0x454690` calls the punk's own creator
       * from the first tag of the husk's death, at the husk's own position, so
       * the thing that climbs out arrives as the death reaches its second group
       * of cels ({@link Foe.hatches}).
       */
      const born = foe.hatches;
      if (born && !e.hatched && e.clock >= born.afterCels * e.anim.hold) {
        e.hatched = true;
        const kid = FOES[born.kind];
        const g = lvl?.sbk.cels.find((c) => c.id === kid.gait.cels[0]);
        if (kid && g) {
          sound?.effect(FOE_SFX.weredHatch, e.x, e.y);
          pool.push({
            kind: born.kind,
            x: e.x,
            y: e.y,
            facing: e.facing,
            left: e.left,
            right: e.right,
            top: e.top,
            bottom: e.bottom,
            clock: 0,
            state: "gait",
            anim: kid.gait,
            linger: 0,
            dents: 0,
            vx: 0,
            vy: 0,
            hp: kid.health,
            max: kid.health,
          });
        }
      }
      // the death animation, then the body, then a green ball where it was
      if (e.clock >= run) {
        e.linger -= TICK_SCALE;
        if (e.linger <= 0) {
          // only the kinds whose corpse handler calls `0x40cba0(pos, -13, 0)`
          if (foe.vanishes) pops.push({ x: e.x, y: e.y - 20, age: 0 });
          pool.splice(pool.indexOf(e), 1);
        }
      }
      continue;
    }
    // the water: it plays once where it was put and then the object goes, which is
    // `0x44fbb4` returning 1 on the frame its animation ends. It has no weight, no
    // floor and no collision box of its own to stand on one with
    if (e.state === "burst") {
      if (e.clock >= run) pool.splice(pool.indexOf(e), 1);
      continue;
    }
    // the one class with states of its own gets them first, and takes the frame
    // when it is using it — see {@link stepBoss}
    if (e.state === "gait" && (foe.wake || foe.drives) && stepBoss(e, foe, run)) continue;
    // whatever it is doing, a thing carrying momentum flies, falls, and stops when
    // its OWN cel's box lands. This has to come before the animation states: the
    // mailbox's topple is four frames and its flight is far longer than that.
    if (e.vx !== 0 || e.vy !== 0) {
      // ...and a thing with no gravity keeps whatever velocity it was given:
      // the hover below is what moves level eight's boss up and down
      if (!foe.floats) e.vy = Math.min(e.vy + INVENTED.gravityPx, INVENTED.maxFallPx);
      e.x += e.vx;
      e.y += e.vy;
      const span = p.room ? roomSpan(p.room) : null;
      if (span) e.x = Math.max(span.lo, Math.min(span.hi, e.x));
      // ...and a thing with no gravity never lands, so none of the rest applies
      if (!foe.floats) {
        const base = lvl ? baseOf(e, lvl) : e.y;
        // the surfaces the PLAYER stands on — platform tops and then the room's
        // floor — swept along the fall so a fast one cannot tunnel through a ledge
        const floor = surfaceUnder(e.x, base - Math.max(e.vy, 0) - CLIMB_PX, base + 1);
        if (floor !== null && base >= floor) {
          // by the CEL's box, not by where the upright one would have stood
          e.y -= base - floor;
          e.vy = 0;
          // and on the ground the allocator's drag takes 70% a frame off it
          // ({@link dragged}) — once a frame, on the frame's whole pixels
          if (Math.floor(e.clock) !== Math.floor(e.clock - TICK_SCALE)) e.vx = dragged(Math.round(e.vx / TICK_SCALE)) * TICK_SCALE;
        }
      }
    }
    // a terminal flinch holds its last cel for good — the toppled mailbox
    if (e.state === "flinch" && e.anim.terminal && e.clock >= run) {
      e.clock = run;
      continue;
    }
    // a two-script state hands to its second half at its own rate — the boss's
    // knockdown into its get-up, {@link FoeAnim.then}
    if (e.state === "flinch" && e.anim.then && e.clock >= run) {
      e.anim = e.anim.then;
      e.clock = 0;
      continue;
    }
    if (e.state === "flinch" && e.clock >= run) {
      // out of stages: the LAST stage's frame ending is what bursts a hydrant, and
      // what bursts is a second object of the same class beside it — `0x44fb20`
      // spawns one on the water tag 25px to its facing side and puts this one
      // straight back on tag 0, whole, to be turned open all over again
      if (foe.burst && foe.flinch && e.dents >= foe.flinch.length) {
        // `0x44fb94`, on the frame the water is created
        if (foe.burst.sound !== undefined) sound?.effect(foe.burst.sound, e.x, e.y);
        pool.push({
          ...e,
          state: "burst",
          anim: foe.burst.anim,
          clock: 0,
          x: e.x + foe.burst.dx * (e.facing > 0 ? 1 : -1),
          dents: 0,
          vx: 0,
          vy: 0,
        });
        e.dents = 0;
      }
      e.state = "gait";
      // `0x456058`: the boss's flinch hands back into the combat loop rather than
      // to standing — it is still in the fight
      e.anim = foe.drives && e.mode ? foe.drives.hover : foe.gait;
      if (foe.drives && e.mode) e.mode = "hover";
      e.clock = 0;
    }
    /**
     * ...and a lever of its own, which is the whole of level six.
     *
     * `0x438200` is the finder: the first object of the switch class whose
     * position is inside this thing's own record rect **and whose tag is 3**, an
     * unlit one. With one in hand the class turns to face it and walks — on the
     * same six cels it patrols with, because the kind-6 script's tag 0 IS the
     * walk — and inside `0x25` pixels stops and plays tag 1, the reach. One
     * named frame of the reach calls `0x436820(lever, 0)`.
     *
     * SERVICE lays this out so that every one of its six levers is inside
     * somebody's territory, which is why a level that starts dry does not stay
     * dry, and why turning them off is a job rather than a one-off.
     */
    const aim = foe.lever && (e.state === "gait" || e.state === "lever") && !e.asleep ? leverFor(e, foe.lever.dir) : null;
    if (e.state === "lever") {
      const L = foe.lever!;
      if (!aim) {
        e.state = "gait";
        e.anim = foe.gait;
        e.clock = 0;
      } else {
        if (!e.thrown && e.clock >= L.at * L.anim.hold) {
          e.thrown = true;
          // `0x43a191`: one roll in three, and then one of two takes
          if (L.sound.length && roll(3) === 1) sound?.effect(L.sound[roll(L.sound.length) - 1], e.x, e.y);
          throwSwitch(aim, foe.lever!.dir);
        }
        if (e.clock >= run) {
          e.state = "gait";
          e.anim = foe.gait;
          e.clock = 0;
          e.thrown = false;
        }
        continue;
      }
    } else if (aim) {
      e.facing = aim.x > e.x ? 1 : -1;
      if (Math.abs(aim.x - e.x) < foe.lever!.reachPx) {
        e.state = "lever";
        e.anim = foe.lever!.anim;
        e.clock = 0;
        e.thrown = false;
        continue;
      }
    }
    /**
     * ...or it simply comes at you, which is what a bat does.
     *
     * `0x422f12` reads the brain's forward distance, clamps it to ±27 and writes
     * it into `obj+0xc` — the velocity, not the territory. So a chaser leaves its
     * rect the moment it wakes, and the rect was only ever the alarm.
     */
    if (foe.chases && !e.asleep && e.state === "gait") {
      const dx = p.x - e.x;
      const dy = p.y - p.feet - e.y;
      const px = foe.chases.px;
      e.facing = dx >= 0 ? 1 : -1;
      e.x += Math.max(-px, Math.min(px, dx)) * TICK_SCALE;
      if (foe.floats) e.y += Math.max(-px, Math.min(px, dy)) * TICK_SCALE;
      continue;
    }
    const i = e.state === "gait" ? loopIndex(e.anim, e.clock) : Math.min(e.anim.cels.length - 1, Math.floor(e.clock / e.anim.hold));
    const step = ((e.anim.dx?.[i] ?? 0) / foe.divisor) * TICK_SCALE;
    // a floater's own hover keeps `vy` busy for ever, and its script's stride has
    // to travel anyway
    if (step > 0 && e.vx === 0 && (e.vy === 0 || foe.floats)) {
      const nx = e.x + step * e.facing;
      /**
       * ...unless the ground there stands too high to climb, in which case the
       * whole move is thrown away.
       *
       * This is `0x42fef3` — the body stepper's own wall, {@link CLIMB_PX} — and
       * everything the stepper does applies to every object, not just the player.
       * Without it a foe that walks into a rise it cannot climb is left standing
       * where no floor is within reach of its feet, and the pin below then reads
       * that as thin air and drops it: WOODS' ground steps up 85 pixels in ONE
       * column at x10230, and the werewolf patrolling east of it fell through the
       * world every time it walked west into that step.
       */
      const baseNow = lvl ? baseOf(e, lvl) : e.y;
      const ground = groundAt(nx);
      const reach = surfaceUnder(nx, baseNow - CLIMB_PX, baseNow + STICK_PX);
      // a floater has no feet to catch on a step
      const blocked = !foe.floats && ground !== null && ground < baseNow - CLIMB_PX && reach === null;
      // a flinch that travels is a knockdown: it goes the way it was hit and is
      // not turned round by its own rect
      /**
       * ...and a class with states of its own is not on a patrol.
       *
       * The rect is a territory for the things that walk up and down one; a boss
       * hunts. Level eight's record is a **twenty-pixel box** at x1373, and
       * turning it round at the edges of that pinned it there for ever — while
       * its own state machine was asking it to close from a thousand away.
       */
      if (e.state === "gait" && !aim && !foe.drives && (nx < e.left || nx > e.right)) e.facing = -e.facing;
      else if (!blocked) {
        const span = p.room ? roomSpan(p.room) : null;
        e.x = foe.drives
          ? span
            ? Math.max(span.lo, Math.min(span.hi, nx))
            : nx
          : Math.max(e.left - 200, Math.min(e.right + 200, nx));
      }
    }
    /**
     * They stand on the same surfaces the player does — and that is the whole of
     * this fix. It used to be `groundAt(e.x)` alone, the ROOM's floor, which is
     * fine in fifteen levels and catastrophic in the sixteenth: CITY's floor is a
     * ledge to x691 and then y7250, so every one of its eight foes was pinned
     * 3300 pixels under the level on the first frame and none could ever be
     * fought. The level's kill quota was unmeetable and its goal therefore
     * unreachable, which looked exactly like "no opponents spawn".
     *
     * A platform top counts, the floor counts, and finding neither within a step
     * means there is nothing underfoot — so it falls, rather than teleporting to
     * whatever the region says.
     */
    // ...and a thing with no gravity stands on nothing: it keeps the height its
    // record's point gave it ({@link Foe.floats})
    if (e.vx === 0 && e.vy === 0 && !foe.floats) {
      const base = lvl ? baseOf(e, lvl) : e.y;
      const s = surfaceUnder(e.x, base - CLIMB_PX, base + STICK_PX);
      if (s !== null) e.y += s - base;
      else e.vy = INVENTED.gravityPx;
    }
  }
}

/**
 * One cel of the level's own book, placed by its anchor — which is what
 * `0x4026d0` does for everything the engine draws.
 */
function drawLevelCel(id: number, x: number, y: number, camX: number, camY: number): void {
  const lvl = level;
  if (!lvl) return;
  const loc = lvl.sbk.byId.get(id);
  if (loc === undefined) return;
  const art = cel(lvl, loc);
  const rec = lvl.sbk.cels.find((q) => q.id === id);
  if (!art || !rec) return;
  const left = x - camX + W / 2 - rec.posX;
  const top = y - camY + VIEW.y - rec.posY;
  if (left + art.width < 0 || top + art.height < 0 || left > W || top > H) return;
  ctx.drawImage(art, left, top);
}

/**
 * One plank, by its own anchor at the record's point.
 *
 * Its cels are 204 wide with the anchor near the middle and at the bottom (cel
 * 1050 is 204x17 anchored at (94, 13)), which puts the board's top surface right
 * on the platform record laid under it — the two agreeing is how the plank was
 * matched to its floor in the first place ({@link planksIn}).
 */
function drawPlank(k: Plank, camX: number, camY: number): void {
  drawLevelCel(plankCel(k), k.x, k.y, camX, camY);
}

/** one spawned thing, feet on the ground, flipped by its facing */
function drawEnemy(e: Enemy, camX: number, camY: number): void {
  const lvl = level;
  if (!lvl) return;
  const id = celOf(e);
  const loc = lvl.sbk.byId.get(id);
  if (loc === undefined) return;
  const art = cel(lvl, loc);
  const c = lvl.sbk.cels.find((q) => q.id === id);
  const a = foeAnchor(e, lvl);
  if (!art || !c || !a) return;
  // by this cel's own anchor about the kind's fixed point — see foeAnchor. On
  // mirror the cel reflects about the anchor and not about its own centre, which
  // is what `0x4026d0` does and what keeps a mirrored looming rat in place.
  const left = e.facing > 0 ? a.x - camX + W / 2 - (art.width - c.posX) : a.x - camX + W / 2 - c.posX;
  const top = a.y - camY + VIEW.y - c.posY;
  if (left + art.width < 0 || top + art.height < 0 || left > W || top > H) return;
  if (e.facing > 0) {
    ctx.save();
    ctx.scale(-1, 1);
    ctx.drawImage(art, -(left + art.width), top);
    ctx.restore();
  } else ctx.drawImage(art, left, top);
}

/** the `stat*` records, from the shared player book, on their record's own point */
function drawPickups(camX: number, camY: number): void {
  for (const q of hereOf((l) => l.pickups)) {
    const kind = PICKUP.kinds[q.code];
    const loc = player?.byId.get(kind.cels[loopIndex(kind, q.clock)]);
    if (loc === undefined) continue;
    const art = playerCel(loc);
    const f = playerFrame(loc);
    if (!art || !f) continue;
    const left = q.x - camX + W / 2 - f.posXraw;
    const top = q.y - camY + VIEW.y - f.posYraw;
    if (left + art.width < 0 || top + art.height < 0 || left > W || top > H) continue;
    ctx.drawImage(art, left, top);
  }
}

/**
 * The weapons on the floor, out of `PLAYER.SBK` like every other pickup —
 * `0x45adc0`'s create sets `obj+2` to `0x4abe10`, the shared character book,
 * whatever level you are standing in.
 */
function drawGuns(camX: number, camY: number): void {
  for (const g of hereOf((l) => l.guns)) {
    const loc = player?.byId.get(GUN_CODES[g.code]?.cel ?? -1);
    if (loc === undefined) continue;
    const art = playerCel(loc);
    const f = playerFrame(loc);
    if (!art || !f) continue;
    const left = g.x - camX + W / 2 - f.posXraw;
    const top = g.y - camY + VIEW.y - f.posYraw;
    if (left + art.width < 0 || top + art.height < 0 || left > W || top > H) continue;
    ctx.drawImage(art, left, top);
  }
}

/**
 * The flares — one frame of the muzzle, then `7207` all the way out, then the
 * four-cel burn-out where it stopped. The art is the LEVEL's, not the player's:
 * `0x43ab33` files book `0x4a7020`, and 7200..7211 are in MALL, SERVICE, SEWER
 * and ARCADE and in no other book in the rip — which is the same four levels
 * that place a `statflare`.
 */
function drawFlares(camX: number, camY: number): void {
  if (!level) return;
  for (const f of flares) {
    const id =
      f.burn !== null
        ? FLARE.burn[Math.min(FLARE.burn.length - 1, Math.floor(f.burn / FLARE.burnHold))]
        : f.wobble >= FLARE.wobble.hi - FLARE.wobble.step
          ? FLARE.muzzle
          : FLARE.flight;
    drawLevelCel(id, f.x, f.y, camX, camY);
  }
}

/** the green balls, from the shared player book, centred on their own anchors */
function drawPops(camX: number, camY: number): void {
  for (const q of pops) {
    const id = VANISH.cels[Math.min(VANISH.cels.length - 1, Math.floor(q.age / VANISH.hold))];
    const loc = player?.byId.get(id);
    if (loc === undefined) continue;
    const art = playerCel(loc);
    const f = playerFrame(loc);
    if (!art || !f) continue;
    const left = q.x - camX + W / 2 - f.posXraw;
    const top = q.y - camY + VIEW.y - f.posYraw;
    if (left + art.width < 0 || top + art.height < 0 || left > W || top > H) continue;
    ctx.drawImage(art, left, top);
  }
}

/**
 * The goo, drawn from the shared player book so it works in every level.
 *
 * A gob is one of three cels held three frames each and then the last one held
 * for the rest of its sixty; the coin toss `0x40cea1` makes flips half of them,
 * which is the only reason twenty of them do not look like one.
 */
function drawGobs(camX: number, camY: number): void {
  for (const g of gobs) {
    // rising, falling, or a puddle — `0x40c480`'s three cases, and the switch to
    // the falling cels is the sign of vy exactly as it tests `obj+0xa > 0`
    const id =
      g.stage >= 0
        ? SPRAY.pool[g.stage]
        : g.vy > 0
          ? SPRAY.fall.cels[Math.min(SPRAY.fall.cels.length - 1, Math.floor(g.age / SPRAY.fall.hold))]
          : SPRAY.rise.cels[Math.min(SPRAY.rise.cels.length - 1, Math.floor(g.age / SPRAY.rise.hold))];
    const loc = player?.byId.get(id);
    if (loc === undefined) continue;
    const art = playerCel(loc);
    if (!art) continue;
    const f = playerFrame(loc);
    if (!f) continue;
    const left = g.x - camX + W / 2 - f.posXraw;
    const top = g.y - camY + VIEW.y - f.posYraw;
    if (left + art.width < 0 || top + art.height < 0 || left > W || top > H) continue;
    if (g.mirror) {
      ctx.save();
      ctx.scale(-1, 1);
      ctx.drawImage(art, -(left + art.width), top);
      ctx.restore();
    } else ctx.drawImage(art, left, top);
  }
}

// ---- the loop -----------------------------------------------------------

/**
 * The swing — `0x434540(4) + 5`, one of four, and the same four whichever button
 * it was: the walk state plays it as it installs the punch (`0x429a03`) and again
 * as it installs the kick (`0x429a48`). Two of the four are the fist going past
 * and two are the man behind it.
 */
function swing(): void {
  sound?.own(OWN.swing[Math.floor(Math.random() * OWN.swing.length)], p.x, p.y);
}

/** the crows this swing has already taken, so one blow is one crow */
const struckCrows = new Set<Crow>();

/** the player cel drawn on the last frame — reported in the status line */
let lastCel = 0;
/** which frame of the gait was showing last, so a footfall fires once per step */
let lastGaitFrame = -1;
let lastTick = 0;
function loop(now: number): void {
  requestAnimationFrame(loop);
  if (film) {
    // hold it in a local: `tick` is what ends a film, and the ending clears
    // `film` from under this frame
    const reel = film;
    reel.tick(now);
    hud.textContent = `${reel.where} — press ESC to skip`;
    lastTick = 0; // the world resumes from now, not from before the film
    return;
  }
  if (!level || !player) return;
  // fixed-step movement so the stride does not depend on the display's Hz
  if (!lastTick) lastTick = now;
  while (now - lastTick >= INVENTED.tickMs) {
    lastTick += INVENTED.tickMs;
    // where the tick started, so a fall can be tested along the path it took
    const tickX = p.x;
    // one ENGINE frame in four ticks: the player's state machine, the impulses and
    // gravity all belong to the frame tick; the ticks between only move
    p.frameAcc += TICK_SCALE;
    const frame = p.frameAcc >= 1 - 1e-9;
    if (frame) p.frameAcc -= 1;
    // an attack owns the player until it finishes — and it can start in the
    // air, which is where the flying moves live
    if (p.onGround && !p.act && p.windup === 0 && p.landLeft === 0) {
      // W picks the bigger variant of either, which is what both state machines
      // do with `0x4ac3fe` before they look at their own button
      const big = held.up ? "Run" : "";
      // the punch tosses a coin: `0x42a400` calls `0x434540(2)` and adds it to
      // the base tag, so repeated presses alternate between two animations. The
      // kick does not — `0x42a670` picks its tag from the keys alone. BOTH
      // together are their own move: the 650s headbutt (`0x429706`).
      const both = (punchPressed && (kickPressed || held.kick)) || (kickPressed && held.punch);
      // S is the pickup button and the duck button, and which one it is depends
      // entirely on what is 35 pixels in front of you: `0x4298a1` calls the reach
      // handler every frame S is held, and `0x42f081` ducks only when the probe
      // came back empty. See {@link GRAB}.
      if (held.down && gunAhead()) {
        p.act = "reach";
        // `0x42f0dc` — a gun that is not the one you are holding makes you throw
        // the one you are holding down, and it does it BEFORE the reach plays
        const want = GUN_CODES[gunAhead()!.code]?.weapon;
        if (inv.armed && want !== undefined && want !== null && want !== inv.weapon) dropGun();
      }
      // ...and with a gun in your hands P is not a fist any more. The five armed
      // state machines read P (`[0x4ac394]`) and install their own wind-up tag;
      // none of them has a kick at all.
      else if (inv.armed && punchPressed && !held.down) p.act = "fire";
      else if (both) p.act = held.down ? "duckCombo" : "headbutt";
      else if (punchPressed) p.act = held.down ? "duckPunch" : `punch${big}${Math.random() < 0.5 ? "" : "2"}`;
      else if (kickPressed && p.running) {
        // the RUN handler's own kick (`0x429db9`) is the FLYING KICK — tag 4 of
        // `0x471d68`, whose first record carries its own leap: dx 190, dy -310
        p.act = "flyingKick";
        // through the mover like every other record: -26 up and 16 forward into
        // the velocity, on top of whatever the run had built
        p.vyRaw += roundAway(-MEASURED.flyKickDy / DIVISOR);
        p.vx += p.facing * roundAway(MEASURED.flyKickDx / DIVISOR);
        engineFrame();
        p.vy = p.stepPx * TICK_SCALE;
        p.onGround = false;
        p.leap = true;
        p.airFrames = 0;
      } else if (kickPressed) p.act = held.down ? "duckKick" : `kick${big}`;
      if (p.act) {
        p.actClock = 0;
        p.fired = false;
        struck.clear();
        struckCrows.clear();
        swing();
      }
    } else if (!p.onGround && !p.act) {
      // mid-flight, the kind-3 handler accepts both buttons once the launch is
      // done (`0x42a036`, `0x42a082`): K is tag 8, P is tag 9
      if (kickPressed) p.act = "airKick";
      else if (punchPressed) p.act = "airPunch";
      if (p.act) {
        p.actClock = 0;
        struck.clear();
        struckCrows.clear();
        swing();
      }
    }
    // an air act ends with the flight: landing hands the player back
    if (p.act && (p.act === "airKick" || p.act === "airPunch" || p.act === "flyingKick") && p.onGround && p.actClock > 0)
      p.act = null;
    if (p.act) {
      const a = actOf(p.act);
      const f = a ? Math.floor(p.actClock / (a.hold ?? 1)) : 0;
      if (!a || f >= a.cels.length) {
        // the reach ENDS in the take — `0x4287bd` is the kind-14 state, and it
        // probes the band a second time rather than remembering what it found
        if (p.act === "reach") takeGun();
        // ...but a HELD state does not end with its script. `0x4286e4` reinstalls
        // `0x4720e8` tag 0 every time the script reports itself finished, and
        // only the grabber letting go gets you out — see {@link stepHeld}.
        if (p.heldBy) {
          p.act = "held";
          p.actClock = 0;
        } else {
          p.act = null;
          // ...and the gravity a reaction took goes back with it. In the engine
          // nothing restores it either — the NEXT state's own `0x42f850` does,
          // and every ordinary one passes 1. Here the ordinary states do not
          // touch it at all, so the reaction ending has to hand it back or the
          // bush's -5 leaves the player at half weight for the rest of the level.
          p.gravityScale = 1;
        }
      } else {
        // `0x42cd53` waits for the wind-up tag to END and only then calls the
        // weapon's own fire function; the tag it installs afterwards is the pose
        // held while the thing is in the air
        if (p.act === "fire" && !p.fired && f >= (WEAPONS[inv.weapon]?.moveset.fire.length ?? 1)) {
          p.fired = true;
          fireGun();
        }
        // the frame's own dx, mirrored by facing, and it may not leave the room
        const step = ((a.dx[f] ?? 0) / DIVISOR) * TICK_SCALE * p.facing;
        const nx = p.x + step;
        const span = p.room ? roomSpan(p.room) : null;
        const half = (playerBox().right - playerBox().left) / 2;
        if (step !== 0 && (!span || (nx - half >= span.lo && nx + half <= span.hi))) p.x = nx;
        p.actClock += TICK_SCALE;
      }
    }

    // a ladder is climbed, not walked along, so it is decided before the walk
    // W or S GRABS a ladder; what lets go of one is a direction or J, not a
    // release. `0x42ae50` stays in the ladder state until forward, backward or
    // the jump key is down, and then leaves through the hop below. Letting go on
    // a release — which this did — dropped the player straight down the rail the
    // moment the key came up, and whether the step west registered first was a
    // race between two key events and one tick.
    const letGo = p.climbing && (held.right !== held.left || held.jump || jumpPressed);
    const ladder = p.act || letGo ? undefined : p.climbing || held.up || held.down ? onLadder() : undefined;
    const dir = ladder || p.act ? 0 : (held.right ? 1 : 0) - (held.left ? 1 : 0);
    p.moving = dir !== 0;
    /**
     * The run — `[0x4ac3fe]`, which is W held, and see {@link KEYS} for why that
     * was not obvious. One flag with two jobs in the original: the ladder state
     * reads it as "up", so a ladder takes it and the run does not happen, which
     * is what `ladder` being defined means here.
     *
     * The air keeps it, as the original does: the jump script's tag 3 is the
     * RUNNING launch, `250 251 252 253` with dx 100 where the standing one has
     * dx 0, so a run-jump carries its speed off the edge.
     */
    p.running = p.moving && held.up && ladder === undefined && !held.down;
    /**
     * THE ENGINE'S FRAME, in the engine's order. The level loop (`0x417c20`)
     * runs the player's input handler first — `0x402950` → `0x428080`, the
     * dispatch on `[player+0x18]` — and then `0x42fc10` steps every script
     * (`0x45d0f0`: the record's dx/dy into the velocity) and then every body
     * (`0x42fd80`: the move, the landing, the drag). Think, animate, move. So a
     * jump pressed on frame A crouches through A, B and C, launches on D, has
     * tag 0 installed on E and is first steered on F; and a walk's impulse
     * lands on the same frame's move. Nothing here happens between frames.
     */
    if (frame && !ladder) {
      if (!p.onGround) p.airFrames += 1;
      // the drag closes the frame before — `0x4302c0`, grounded frames only
      if (p.onGround) p.vx = dragged(p.vx);
      // ---- think: the input handler
      if (p.landLeft > 0) {
        // tag 1, or 0x471c68's tag 5: `0x42a182` reads ESC and nothing else until
        // the script ends on the ground. The keys do nothing; the slide is the drag's
        p.landLeft -= 1;
      } else if (p.onGround && p.launched) {
        // `0x42a0f0`, the tag-0 handler's first grounded frame: the allowance back
        // to 2, and the fall since the apex decides which landing this is
        p.launched = false;
        p.hold = HOLD_FRAMES;
        p.hardLand = p.fallPx > FLAIL_FALL_PX;
        p.landLeft = p.hardLand ? ANIM.air.length * AIR_HOLD : ANIM.land.length;
        // 0x402ac0(10) takes ten health here too; this page has no health to take
        sound?.own(p.hardLand ? OWN.landHard : OWN.land, p.x, p.y);
      } else if (!p.onGround) {
        if (p.launched && p.airFrames >= 2) {
          // `0x429f1f`, tag 0's frame: the lift, then the steering
          if (held.up && p.hold > 0) {
            p.vyRaw += roundAway(-MEASURED.rise / DIVISOR);
            p.hold -= 1;
          }
          if (dir && dir !== p.facing) {
            // backward alone: `0x402e40` turns the player round and `0x429fdf`
            // zeroes the velocity; next frame the same key is forward
            p.facing = dir;
            p.vx = 0;
          } else if (dir) steerAir();
        }
        // a walk or run that left the ground without a jump has no steering: the
        // walk state installs the idle script's tag 1 (`0x42999e`) and the run
        // its own tag 1 (`0x429bf0`), and neither handler reads a direction
      } else if (p.windup === 0) {
        if (dir) p.facing = dir;
        if (jumpPressed && !p.act) {
          // `0x4296d6`, `0x429a76`, `0x429c65`: one sound, then the standing state
          // installs tag 2, the walk tag 3 and the run tag 4 — three frames of
          // 250 251 252 before 253 launches, or the run's one record of 200
          sound?.own(OWN.jump, p.x, p.y);
          p.leap = p.running;
          p.windup = p.leap ? 1 : ANIM.launch.length;
          p.launchDx = p.running ? MEASURED.runJumpDx : p.moving ? MEASURED.launchDx : 0;
        }
      }
      // ---- animate: the current record's dx/dy through the mover, `0x45d196`
      if (p.onGround && p.landLeft === 0) {
        if (p.windup > 0) {
          p.windup -= 1;
          if (p.windup === 0) {
            // the launch record: dy -420 and tag 3's dx 100 or tag 4's dx 180,
            // each divided once, away from zero, into the velocity — -35, 9, 15
            p.vyRaw += roundAway(-MEASURED.jump / DIVISOR);
            p.vx += p.facing * roundAway(p.launchDx / DIVISOR);
            p.onGround = false;
            p.launched = true;
            p.airFrames = 0;
            p.hold = HOLD_FRAMES;
          }
        } else if (dir) {
          // the gait's own dx: the walk's 95, the run's 180, and ducked it is the
          // CRAWL — 0x4717c8 tag 4's 47, which cannot run
          const dx = held.down ? MEASURED.crawl : p.running ? MEASURED.run : MEASURED.walk;
          p.vx += p.facing * roundAway(dx / DIVISOR);
        }
      }
      // ---- the body: this frame's vertical step, and gravity into the velocity
      if (!p.onGround) engineFrame();
      // ...and a frame that begins on the ground stores zero over the fall
      // instead (`0x42fdc2`). This is the engine's order and it is what keeps the
      // count readable: the think above has already had it, and so has the plank,
      // whose own frame function runs in the think pass (`0x40c8f0` at 0x417c52,
      // one call before the body step at 0x417c57)
      else p.fallPx = 0;
    }
    // every tick moves by a quarter of the frame's velocity, in the air and on the
    // ground alike: the stepper adds `obj+0xc` to the position whatever the input,
    // so a released jump coasts and a landing slides
    if (!ladder && p.vx !== 0) {
      const nx = p.x + p.vx * TICK_SCALE;
      // the room's floor SPAN is the room's extent — you cannot walk off the
      /**
       * ...but a room's end is not always the world's. MALL is three regions laid
       * SIDE BY SIDE with no `exitroom` between them — they share a few pixels of
       * overlap and the player simply walks from one into the next, which is what
       * `0x40b940(2, point)` does for every object every frame: the region you are
       * in is whichever one contains you.
       *
       * This page had rooms as places you are put into, by a door or by the level
       * loading, and never as places you walk out of. So the run east through
       * level five stopped dead at x6729, the right edge of its first region, with
       * two thirds of the level and its goal on the other side.
       */
      /**
       * A room is a place you can walk OUT of, and the point is what decides.
       *
       * MALL is three regions laid side by side with no `exitroom` between them:
       * they share six pixels of overlap, and the player walks from one into the
       * next. That is what `0x40b940(2, point)` does for every object on every
       * frame — the region you are in is whichever one contains your point.
       *
       * This page had rooms as places you are PUT into, by a door or by the level
       * loading, and never as places you leave on foot, so the run east through
       * level five stopped at x6729 with two thirds of the level and its goal on
       * the far side. What stopped it was the old rule here, which reserved half a
       * sprite at each end of the room — and half a sprite is wider than the
       * overlap, so the point could never reach the next region at all.
       *
       * So: the point may go anywhere its own region's floor reaches, and when it
       * lands inside a different one that region takes over. The half-sprite is
       * still reserved, but against the WORLD — the union of the regions standing
       * at this height — which is what it was really for: without it the last step
       * of a level walks the sprite half off the side of the screen, because the
       * camera has already stopped at the end of the floor.
       */
      const span = p.room ? roomSpan(p.room) : null;
      const half = (playerBox().right - playerBox().left) / 2;
      /**
       * Which region you are in is `0x40b940(2, point)`: the one whose RECT
       * holds the point, with no reference to a floor anywhere in it. This page
       * has always asked the narrower question — is the point over this room's
       * own GROUND — because that is what keeps a walk from carrying on into
       * nothing, and for five levels the two agreed. Level seven is where they
       * part: its regions are joined at seams where one floor has ended and the
       * next has not begun, and a `platform` laid across the gap is what you
       * walk over. So the rect answers first and the ground span second, and the
       * reservation below is still what stops you leaving the world.
       */
      const inRect = !!p.room && nx >= p.room.left && nx <= p.room.right;
      let inRoom = !span || inRect || (nx >= span.lo && nx <= span.hi);
      if (!inRoom && p.room && level) {
        const next = level.rooms.find((r) => {
          if (r === p.room) return false;
          const sp = roomSpan(r);
          return sp !== null && nx >= sp.lo && nx <= sp.hi && p.y >= r.top && p.y <= r.bottom;
        });
        /**
         * ...and failing that, the engine's own answer: `0x40b940(2, point)` is
         * the region whose RECT contains the point, and it knows nothing about
         * floors at all.
         *
         * Level five could be crossed on floors alone, because its three regions
         * overlap and each carries its own ground the whole way. Level seven
         * cannot: its thirteen regions meet where one region's floor has ended
         * and the next one's has not begun, and what bridges the two is a
         * `platform` record laid across the seam — the walkway from the entrance
         * into the first shaft is one, from x2567 to x3229, and it belongs to the
         * shaft because that is where its middle is. So the hand-over has to
         * happen on the rects, and the floor is found again on the far side.
         */
        const rect =
          next ??
          level.rooms.find(
            (r) => r !== p.room && nx >= r.left && nx <= r.right && p.y >= r.top && p.y <= r.bottom,
          );
        if (rect) {
          p.room = rect;
          inRoom = true;
        }
      }
      if (inRoom && span && level) {
        const reach = level.rooms
          .filter((r) => p.y >= r.top && p.y <= r.bottom)
          .map((r) => roomSpan(r))
          .filter((sp): sp is { lo: number; hi: number } => sp !== null);
        if (reach.length) {
          const lo = Math.min(...reach.map((sp) => sp.lo));
          const hi = Math.max(...reach.map((sp) => sp.hi));
          /**
           * ...and the reservation is tested only against the end you are
           * WALKING AT.
           *
           * Testing both ends rejects a move that would improve matters, and a
           * rejected move leaves you exactly where you were — which is a pin,
           * not a wall. The foot of level seven's first shaft is the case: its
           * floor begins at x2822 and its west wall is right there, so a player
           * standing at x2860 already has half a body over the line and could
           * never take a step in EITHER direction.
           */
          if (nx > p.x ? nx + half > hi : nx - half < lo) inRoom = false;
        }
      }
      // world. Off a platform you certainly can: the floor is still under it.
      const ahead = groundAt(nx);
      // and a floor that rises more than a step is a wall, not a slope. Without
      // this the player walks INTO the terrain and then falls through it
      // forever, because everything solid is now above them: BARREL's floor
      // climbs 141px between two adjacent columns.
      const wall = p.onGround && ahead !== null && ahead < p.y - CLIMB_PX;
      if (inRoom && !wall) {
        p.travelled += Math.abs(nx - p.x);
        p.x = nx;
      } else p.vx = 0;
    }

    // up opens a door and climbs a ladder; jump is its own key, as it is in the
    // original. A touch still sends both, so a door still has to CONSUME the
    // press — otherwise the tap that opens it also jumps, and the player
    // arrives in the next room already in the air.
    // ...and only from a STANDSTILL, now that the same key is the run. Otherwise
    // every sprint past a doorway ends in the next room, which is the trap this
    // door already had once, arrived at from the other direction.
    if (upPressed && p.onGround && dir === 0 && takeDoor()) upPressed = jumpPressed = false;
    const wasClimbing = p.climbing;
    p.climbing = ladder !== undefined;
    if (ladder) {
      /**
       * Step ONTO it, where the record says and facing the way it says.
       *
       * Where the record says and facing the way it says: `0x42b2b2` writes the
       * record's own `pointX` straight into the player's x and `0x42b279` turns
       * them by the sign of the spacing, so neither is a snap of this page's
       * invention any more. {@link onLadder} has the trigger the engine tests.
       */
      const spacing = Math.abs(ladder.param) || 35;
      const last = Math.floor((ladder.bottom - ladder.top) / spacing);
      // the resting cel's own box is how far the feet hang below the anchor, and
      // the anchor is what a rung IS
      const rest = player?.cels.find((c) => c.id === LADDER.restCel);
      const feet = rest?.body ? rest.body.y1 : 96;
      if (!wasClimbing) {
        p.x = ladder.pointX;
        // `0x42b279`: a positive spacing wants `obj+0x28` SET and a negative one
        // wants it clear — which, for the player's book, is facing left and facing
        // right. See {@link LADDER}: the sign is the ladder art's own mirror flag,
        // so `+35` is rungs pointing east, and you climb those from the east side
        // facing back into them
        p.facing = ladder.param < 0 ? 1 : -1;
        // `0x42b300`: the rung you arrive on is the one above where you stood, and
        // the y it measures is the ANCHOR, not the feet
        const anchor = p.y - feet;
        p.rung = anchor > ladder.top ? Math.max(0, Math.floor((anchor - ladder.top) / spacing) - 1) : 0;
        p.climbTag = held.down ? 3 : 0;
        p.climbClock = 0;
      } else {
        p.climbClock += TICK_SCALE;
        // one rung per completed tag, and a change of mind costs a tag without
        // moving — `0x42afc4`'s four cases, which only ever step the rung on the
        // two tags already going that way. S is tested after W, so S wins.
        if (p.climbClock >= LADDER.rungFrames) {
          const t = p.climbTag;
          const was = p.rung;
          let moved = true;
          if (held.down) {
            if (t === 2 || t === 3) {
              if (p.rung < last) p.rung += 1;
              else moved = false;
              p.climbTag = t === 2 ? 3 : 2;
            } else p.climbTag = t === 0 ? 3 : 2;
          } else if (held.up) {
            if (t === 0 || t === 1) {
              if (p.rung > 0) p.rung -= 1;
              else moved = false;
              p.climbTag = t === 0 ? 1 : 0;
            } else p.climbTag = t === 2 ? 1 : 0;
          }
          // nothing to install: the animation stays ended and the cel holds
          p.climbClock = moved ? 0 : LADDER.rungFrames;
          // one hand then the other: the ladder state plays skulz 3 as it
          // installs the odd tags and skulz 2 as it installs the even ones
          if (p.rung !== was) sound?.own(OWN.rung[p.climbTag % 2], p.x, p.y);
        }
      }
      p.vy = 0;
      p.vx = 0;
      p.climbY = ladder.top + p.rung * spacing;
      const was = p.y;
      p.y = p.climbY + feet;
      p.travelled += Math.abs(p.y - was);
      p.onGround = false;
    } else {
      if (wasClimbing && !p.onGround && (dir || held.jump || jumpPressed)) {
        /**
         * Off the ladder sideways. `0x42ae50` leaves the ladder state on
         * forward, backward or J — at the end of the rung tag playing — and
         * `0x42af30` does the leaving: gravity back on, a turn if it was
         * backward, and tag 6 with J held (the leap's own `200(dx 180, dy
         * -420)`) or tag 7 without (`200(dx 120, dy -210)`: a HOP, 10 forward
         * and 18 up). Both tags dispatch to the steering handler from their
         * first frame, so a held direction drives this to 30 at once. Without
         * it — which was the old behaviour — the player drops straight down the
         * rail and misses the roof the ladder was there to reach.
         */
        if (dir) p.facing = dir;
        const leap = held.jump || jumpPressed;
        p.vyRaw = roundAway(-(leap ? MEASURED.jump : MEASURED.hopDy) / DIVISOR);
        p.vx = p.facing * roundAway((leap ? MEASURED.runJumpDx : MEASURED.hopDx) / DIVISOR);
        p.stepPx = 0;
        p.launched = true;
        p.leap = true;
        p.airFrames = 2;
        p.hold = HOLD_FRAMES;
        jumpPressed = false;
      }
      /**
       * The jump itself is decided and launched in the frame block above, in
       * the engine's own order. What is left here is the body: the feet under
       * the pose, the floor under the feet, and the fall.
       *
       * The lift — hold W and go higher, the original's own mechanic and the
       * reason the same key runs, climbs and jumps — is up there too: `0x429f55`
       * calls `0x42f8b0` with `-125`, which is `+= round_away(-125/12)` = -11
       * on the VELOCITY, once a frame, for the two frames `0x4723f0` lasts, and
       * only once tag 0 is playing. A held jump is 137 high to a plain one's 80.
       */
      poseFeet();
      if (p.onGround) {
        // follow the floor: up a curb, down a step, off an edge
        const s = surfaceUnder(p.x, p.y - CLIMB_PX, p.y + STICK_PX);
        if (s === null) {
          // walked off: airborne on the gait's own velocity, with no steering
          p.onGround = false;
          p.airFrames = 0;
        } else {
          p.y = s;
          p.vy = 0;
          p.vyRaw = 0;
          p.stepPx = 0;
        }
      }
      if (!p.onGround) {
        /**
         * Fall the way `SC.EXE` falls, and stop at the first surface crossed.
         *
         * The velocity is advanced ONCE AN ENGINE FRAME in whole pixels and the
         * frame's step is spread across its four ticks so the sweep still
         * catches a ledge it crosses diagonally. Integrating this as floats —
         * which is what this did — loses the away-from-zero rounding on every
         * single frame, and the jump comes out about a fifth short.
         */
        p.vy = Math.min(p.stepPx * TICK_SCALE, INVENTED.maxFallPx);
        const ny = p.y + p.vy;
        const land = p.vy >= 0 ? surfaceCrossed(tickX, p.y, p.x, ny) : null;
        if (land !== null) {
          /**
           * ...and what the drop cost. `0x443c82` is the whole rule: past 530 of
           * accumulated fall the landing is simply fatal — no blow, no health
           * call, straight into the dying script — and under it a flat ten and
           * the roll at `0x476220` tag 5. Both are gated on the flail state,
           * which `0x442f3f` forces at 360.
           */
          if (damageOn && p.fallPx > HURT.flailFall && p.act !== "dying") {
            if (p.fallPx > HURT.fatalFall) {
              p.act = "dying";
              p.actClock = 0;
            } else {
              p.act = "landRoll";
              p.actClock = 0;
              takeHealth(HURT.fallDamage);
            }
          }
          // `0x42ff5d`: the feet to the floor and the fall stopped. The
          // horizontal is left alone — the ground's drag has it from here
          p.y = land;
          p.vy = 0;
          p.vyRaw = 0;
          p.stepPx = 0;
          p.onGround = true;
        } else p.y = ny;
        // last resort: under the floor is not a place. Nothing here can be
        // below the terrain, so anything that gets there is put back on top of
        // it rather than falling out of the level.
        const g = groundAt(p.x);
        if (g !== null && p.y > g) {
          p.y = g;
          p.vy = 0;
          p.vyRaw = 0;
          p.stepPx = 0;
          p.onGround = true;
        }
      }
    }
    // the fall since the apex is kept by the body step above, in the engine's own
    // units — see {@link engineFrame}. It outlives the landing by the one frame
    // the tag-0 handler needs to read it (0x42a109's 360 test), and the plank's
    // handler reads the same field on the same frame ({@link PLANK.hardFallPx})
    if (p.onGround && p.landLeft === 0 && !p.launched) p.leap = false;
    // the duck: S on the ground with nothing else going on. The engine's is
    // reached the same way — from the standing state, not out of a walk.
    p.crouching = p.onGround && held.down && !p.act && !p.climbing;
    // the duck's own fidget: tag 1 is a single cel, so its script ends every
    // frame, and 0x42aadd rolls rand(0x2c3) < 13 at each end — 13 in 707
    if (p.crouching && !p.moving) {
      if (p.fidget === ANIM.crouchFidget) {
        p.fidgetClock += TICK_SCALE;
        if (p.fidgetClock >= ANIM.crouchFidget.length) p.fidget = null;
      } else if (Math.random() * 707 < 13 * TICK_SCALE) {
        p.fidget = ANIM.crouchFidget;
        p.fidgetClock = 0;
      }
    } else if (p.fidget === ANIM.crouchFidget) p.fidget = null;
    // the idle only runs while genuinely idle, and restarts each time it stops.
    // At each cycle's end, 0x42993c rolls rand(42) < 13 for a fidget.
    if (p.onGround && !p.moving && !p.act && !p.climbing && !p.crouching) {
      if (p.fidget) {
        p.fidgetClock += TICK_SCALE;
        if (p.fidgetClock >= p.fidget.length * IDLE_HOLD) p.fidget = null;
      } else {
        p.idleClock += TICK_SCALE;
        const cycle = ANIM.idle.length * IDLE_HOLD;
        if (p.idleClock >= cycle) {
          p.idleClock -= cycle;
          if (Math.random() * 42 < 13) {
            p.fidget = Math.random() < 0.5 ? ANIM.fidgetA : ANIM.fidgetB;
            p.fidgetClock = 0;
          }
        }
      }
    } else {
      p.idleClock = 0;
      p.fidget = null;
    }
    // and the obstacles, once the whole move is in — the engine resolves them in
    // the mover after everything else has had its say (`0x430146`)
    if (!p.climbing) ejectFromObstacles();
    if (p.act) landHits();
    // ...and everything that can hit back, on the frame tick — see {@link takeHits}
    if (frame) takeHits();
    stepPlanks();
    stepElevators();
    stepIbeams();
    stepCrushes();
    stepSwitches();
    stepGoop();
    stepDoors();
    stepElevs();
    stepScenery();
    stepColumns();
    stepPickups();
    if (frame) stepHoles();
    if (frame) stepHands();
    if (frame) stepAxes();
    if (frame) stepBridges();
    if (frame) stepFloors();
    if (frame) stepSurges();
    if (frame) stepCages();
    if (frame) stepAlarms();
    if (frame) stepFans();
    if (frame) stepBelts();
    if (frame) stepChairs();
    if (frame) stepClaws();
    // last of the props, because the grip is read off whatever moved just now
    if (frame) stepHeld();
    if (frame) for (const b of hereOf((l) => l.boggs)) b.clock += 1;
    stepGuns();
    if (frame) stepFlares();
    stepCrows();
    stepEnemies();
    stepGobs();
    stepCraft();
    claimBar();
    // the mission clock runs at the engine's rate, not this page's
    stats.ticks = Math.max(0, stats.ticks - TICK_SCALE);
    if (stats.ticks <= 0 && !film) void ranOut();
    // `0x443dea`: the life is spent when the dying animation ENDS, not when the
    // health runs out, and `0x443ec7` turns the last one into the game-over state
    if (damageOn && stats.health <= 0 && p.act === null && !film) void died();
    if (fellOut() && !film) void died();
    upPressed = false;
    // J is read by the frame's think, not by the tick, so it waits for one
    if (frame) jumpPressed = false;
    punchPressed = false;
    kickPressed = false;
  }
  // ---- draw: the engine's own transform — screenX = (x − camX)·rate + W/2,
  // horizontal only, y plain — camera centred on the player
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, W, H);
  // the level is confined to its window in BOTH modes, which is what makes it a
  // window: without the clip the parallax and the player run under the two bands
  // and reappear at the screen's edges. Full-screen mode is the same window 110
  // rows taller — see VIEW.
  ctx.save();
  ctx.beginPath();
  ctx.rect(VIEW.x, VIEW.y, VIEW.w, viewH());
  ctx.clip();
  const lvl = level;
  // the camera follows the player but stops at the room's ends, so the view
  // never runs past the drawn world — without this, walking to the last pixel
  // of STREETS' floor scrolls 130px of black in from the right
  const span = p.room ? roomSpan(p.room) : null;
  const camX =
    span && span.hi - span.lo > W
      ? Math.min(Math.max(p.x, span.lo + W / 2), span.hi - W / 2)
      : span
        ? (span.lo + span.hi) / 2
        : p.x;
  const camY = viewTop();
  // where the sounds are heard from: `0x40efb0` takes the camera rect and adds
  // (256, 192) to its corner, which is the middle of a 512-wide view
  sound?.listen(camX, camY + REACH.centreY);
  sound?.pump();
  const animStep = Math.floor(now / INVENTED.bgAnimMs);
  const drawOne = (q: (typeof lvl.draw)[number]): void => {
    // cycle the disc's frame cels; still placements have one and never move
    const loc = q.cels.length > 1 ? q.cels[animStep % q.cels.length] : q.loc;
    const art = cel(lvl, loc);
    const f = frameOf(lvl, loc);
    if (!art || !f) return;
    // the ANCHOR's screen position: SC.EXE's rect builder (0x4026d0) places the
    // cel so its stored anchor lands here, and on mirror it reflects the cel
    // about that anchor — NOT the cel's centre. That distinction is invisible
    // for a near-centred anchor and glaring for an off-centre one: the lamp's
    // tiny glow cels (anchor 31 of 73) landed in the wrong place, the full lamp
    // (anchor 144 of 186) barely moved.
    const sx = (q.x - camX) * q.rate + W / 2;
    const y = q.y - camY + VIEW.y - f.posYraw;
    // left edge: anchor at sx normally, or reflected about sx when mirrored
    const left = q.mirror ? sx - (art.width - f.posXraw) : sx - f.posXraw;
    if (left + art.width < 0 || y + art.height < 0 || left > W || y > H) return;
    if (q.mirror) {
      ctx.save();
      ctx.scale(-1, 1);
      // scale(-1,1) maps x→−x, so drawing at −(left+width) lands the reversed
      // cel spanning [left, left+width], anchor back at sx
      ctx.drawImage(art, -(left + art.width), y);
      ctx.restore();
    } else {
      ctx.drawImage(art, left, y);
    }
  };
  // everything the engine paints before the player (planes 3 and 0)
  for (const q of lvl.draw) if (q.z < PLAY_PLANE_Z) drawOne(q);

  // the level's own spawned things, on the play plane with the player
  for (const k of planksHere()) drawPlank(k, camX, camY);
  // the cage, then the winch that hauls it at the head of its shaft
  for (const e of elevatorsHere()) {
    drawLevelCel(ELEVATOR.car.cels[0], e.x, e.y, camX, camY);
    drawLevelCel(elevatorCel(e), e.x, e.winchY, camX, camY);
  }
  for (const b of ibeamsHere()) drawLevelCel(ibeamCel(b), b.x, b.y, camX, camY);
  for (const c of crushesHere()) drawLevelCel(crushCel(c), c.x, c.y, camX, camY);
  // the lever is on the wall behind whatever is standing at it, and the goop is
  // in front: its class is collected with the actors, the switch's is not
  for (const w of switchesHere()) drawLevelCel(switchCel(w), w.x, w.y, camX, camY);
  // an open door shows cel 0, which is nothing; a lift is one cel for ever
  for (const d of doorsHere()) if (d.state !== "open") drawLevelCel(doorCel(d), d.x, d.y, camX, camY);
  for (const e of elevsHere()) drawLevelCel(ELEV.cel, e.x, e.y, camX, camY);
  // the scenery that does something, each on its own class's cels
  for (const k of hereOf((l) => l.shacks)) drawLevelCel(shackCel(k), k.x, k.y, camX, camY);
  for (const b of hereOf((l) => l.barrels)) {
    drawLevelCel(BARREL.bob.cels[loopIndex(BARREL.bob, b.clock)], b.x, b.y, camX, camY);
  }
  for (const q of hereOf((l) => l.pipes)) {
    drawLevelCel(PIPE.mouth.cels[0], q.x, q.y, camX, camY);
    drawLevelCel(PIPE.flow.cels[loopIndex(PIPE.flow, q.clock)], q.x, q.y, camX, camY);
  }
  for (const q of hereOf((l) => l.bushes)) {
    drawLevelCel(BUSH.idle.cels[loopIndex(BUSH.idle, q.clock)], q.x, q.y, camX, camY);
  }
  for (const r of roaches) {
    drawLevelCel(r.onGround ? ROACH.run.cels[loopIndex(ROACH.run, r.clock)] : ROACH.drop.cels[0], r.x, r.y, camX, camY);
  }
  for (const [slot, clock] of columns) {
    const q = hereOf((l) => l.sprinklers).find((w) => w.slot === slot);
    if (q) drawLevelCel(columnCel(clock), q.x, q.y, camX, camY);
  }
  for (const d of drips) drawLevelCel(dripCel(d), d.x, d.y, camX, camY);
  for (const c of crowsHere()) drawLevelCel(crowCel(c), c.x, c.y, camX, camY);
  for (const f of feathers) {
    const id = CROW.feathers.cels[Math.min(CROW.feathers.cels.length - 1, Math.floor(f.age / CROW.feathers.hold))];
    drawLevelCel(id, f.x, f.y, camX, camY);
  }
  for (const e of spawnedHere()) drawEnemy(e, camX, camY);
  // the goal's craft and the goo share the play plane with the player: the
  // engine's own effect class is collected with the actors, not the backdrop
  drawCraft(camX, camY);
  for (const c of hereOf((l) => l.cages)) {
    const id = cageCel(c);
    if (id) drawLevelCel(id, c.x, c.y, camX, camY);
  }
  for (const a of hereOf((l) => l.alarms)) drawLevelCel(alarmCel(a), a.x, a.y, camX, camY);
  for (const b of hereOf((l) => l.belts)) drawLevelCel(beltCel(b), b.x, b.y, camX, camY);
  for (const c of hereOf((l) => l.chairs)) drawLevelCel(chairCel(c), c.x, c.y, camX, camY);
  for (const c of hereOf((l) => l.claws)) drawLevelCel(clawCel(c), c.x, c.y, camX, camY);
  for (const f of hereOf((l) => l.fittings)) drawLevelCel(fittingCel(f), f.x, f.y, camX, camY);
  for (const b of hereOf((l) => l.boggs)) drawLevelCel(boggsCel(b), b.x, b.y, camX, camY);
  for (const q of hereOf((l) => l.fans)) drawLevelCel(fanCel(q), q.x, q.y, camX, camY);
  for (const f of hereOf((l) => l.floors)) drawLevelCel(floorCel(f), f.x, f.y, camX, camY);
  for (const q of hereOf((l) => l.surges)) drawLevelCel(surgeCel(q), q.x, q.y, camX, camY);
  for (const b of hereOf((l) => l.bridges)) drawLevelCel(bridgeCel(b), b.x, b.y, camX, camY);
  for (const a of hereOf((l) => l.axes)) drawLevelCel(axeCel(a), a.x, a.y, camX, camY);
  for (const h of hereOf((l) => l.holes)) drawLevelCel(holeCel(h), h.x, h.y, camX, camY);
  for (const q of hereOf((l) => l.hands)) {
    const id = handCel(q);
    if (id) drawLevelCel(id, q.atX, q.atY, camX, camY);
  }
  drawPickups(camX, camY);
  drawGuns(camX, camY);
  drawFlares(camX, camY);
  drawGobs(camX, camY);
  drawPops(camX, camY);

  // the player, feet on the ground, between the rate-1 planes and the
  // foreground — the disc's own cels for both facings, so nothing is mirrored
  // what the player is doing decides the script, and the DISTANCE they have
  // covered decides the frame — one cel per STRIDE_PX, the engine's own ratio
  const acting = p.act ? actOf(p.act) : null;
  /**
   * The ARMED player is a different player, and the swap is total.
   *
   * `0x45eed0` sets `0x479438` and the pickup case installs the weapon's own
   * script; that script's `kind` becomes `player+0x18`, and `0x4284ed`'s table
   * sends the whole state machine somewhere else — `0x42cb80` for the flare
   * gun rather than `0x429690` and its neighbours. Every one of those handlers
   * re-implements the idle, the walk, the run, the jump, the fall, the landing
   * and the duck in its weapon's own cels. See {@link Moveset}.
   */
  const kit = inv.armed ? WEAPONS[inv.weapon]?.moveset ?? null : null;
  const seq = acting
    ? acting.cels
    : p.climbing
      ? ANIM.climb[p.climbTag] ?? ANIM.hang
      : p.landLeft > 0
        ? p.hardLand
          ? kit?.fall ?? ANIM.air
          : kit?.land ?? ANIM.land
        : !p.onGround || p.windup > 0
          ? kit?.jump ?? ANIM.air
          : p.crouching
          ? kit?.duck ?? ANIM.crouch
          : p.running
            ? kit?.run ?? ANIM.run
            : p.moving
              ? kit?.walk ?? ANIM.walk
              : kit?.idle ?? ANIM.idle;
  // Three clocks, because the engine has three. An action and the idle run on
  // engine frames at their script's own ticksPerFrame; anything that covers
  // ground is clocked by the GROUND it covers, one cel per stride, so the feet
  // cannot slide whatever this page's Hz is; and the flight runs on its own.
  const running = seq === (kit?.run ?? ANIM.run);
  const stride = running ? RUN_STRIDE_PX : STRIDE_PX;
  let id: number;
  if (acting) id = seq[Math.min(seq.length - 1, Math.floor(p.actClock / (acting.hold ?? 1)))];
  // a rung is four cels at one engine frame each, and the last of them is what a
  // ladder holds you on when you stop asking to move
  else if (p.climbing) id = seq[Math.min(seq.length - 1, Math.floor(p.climbClock))];
  else if (seq === (kit?.idle ?? ANIM.idle))
    // the fidgets are the fists' own two tags and no weapon script has any
    id = p.fidget && !kit
      ? p.fidget[Math.min(p.fidget.length - 1, Math.floor(p.fidgetClock / IDLE_HOLD))]
      : seq[Math.floor(p.idleClock / IDLE_HOLD) % seq.length];
  else if (kit && seq === kit.duck) id = seq[0];
  else if (kit && (seq === kit.land || seq === kit.fall)) id = seq[Math.min(seq.length - 1, Math.floor(p.actClock))];
  else if (kit && seq === kit.jump)
    // two records, the second carrying the dy: the wind-up cel, then the tuck
    id = seq[p.windup > 0 || p.airFrames === 0 ? 0 : seq.length - 1];
  else if (seq === ANIM.crouch)
    // moving while ducked is the crawl, clocked by ground covered like every
    // gait; still is the held duck, with its rare settle fidget over it
    id = p.moving
      ? ANIM.crawl[Math.floor(p.travelled / CRAWL_STRIDE_PX) % ANIM.crawl.length]
      : p.fidget === ANIM.crouchFidget
        ? ANIM.crouchFidget[Math.min(ANIM.crouchFidget.length - 1, Math.floor(p.fidgetClock))]
        : ANIM.crouch[0];
  else if (seq === ANIM.land) id = ANIM.land[Math.min(ANIM.land.length - 1, ANIM.land.length - p.landLeft)];
  else if (seq === ANIM.air && p.landLeft > 0) {
    // the hard landing, four frames a cel on the ground
    const f = Math.floor((ANIM.air.length * AIR_HOLD - p.landLeft) / AIR_HOLD);
    id = ANIM.air[Math.min(ANIM.air.length - 1, f)];
  } else if (seq === ANIM.air) {
    // the wind-up on the ground — 250 251 252 as the count runs down — then 253
    // for the launch frame, then the TUCK: 200 on the frame tag 0 is installed
    // and 220 held after. A run's leap is tag 4's single 200, then the same.
    if (p.windup > 0) id = ANIM.launch[ANIM.launch.length - 1 - p.windup];
    else if (p.leap) id = ANIM.tuck[Math.min(ANIM.tuck.length - 1, Math.max(0, p.airFrames - 1))];
    else if (p.airFrames === 0) id = ANIM.launch[ANIM.launch.length - 1];
    else id = ANIM.tuck[Math.min(ANIM.tuck.length - 1, p.airFrames - 1)];
  } else {
    const f = Math.floor(p.travelled / stride) % seq.length;
    // the footfalls, and the engine fires them off the CYCLE's frame number
    // rather than off a timer or a distance: `0x429b3d` plays skulz 0 on frame 1
    // and `0x429b5c` plays skulz 1 on frame 6, in the walk state and again in the
    // run's own branch. Twelve cels, two steps, whatever the speed.
    if (f !== lastGaitFrame && (seq === ANIM.walk || seq === ANIM.run || seq === ANIM.crawl)) {
      const which = OWN.stepFrames.indexOf(f as 1 | 6);
      if (which >= 0 && p.onGround) sound?.own(OWN.step[which], p.x, p.y);
      lastGaitFrame = f;
    }
    id = seq[f];
  }
  // which cel is on screen, for the status line and for the probes: an animation
  // that has stopped animating is invisible to every other assertion here
  lastCel = id;
  const loc = player.byId.get(id);
  if (loc !== undefined) {
    const art = playerCel(loc);
    if (art) {
      // one set of cels, flipped by facing — the engine's own arrangement, and
      // about the drawn centre because that is where this page stands them.
      //
      // A ladder is the exception, and it has to be: the climb cels are hung from
      // the HANDS (cel 405 is 63x163 with its anchor 6px from the top and its
      // collision box running 9 to 96 BELOW it) and the rung the engine keeps is
      // that anchor. So while climbing the cel goes where `0x4026d0` would put it
      // — anchor on the rung, reflected about the anchor on mirror — which is the
      // only placement that puts the grip on the rungs.
      const rec = p.climbing ? player.cels.find((c) => c.id === id) : undefined;
      const sx = p.x - camX + W / 2;
      const left = rec
        ? p.facing < 0
          ? sx - (art.width - rec.posX)
          : sx - rec.posX
        : (p.x - camX) + W / 2 - art.width / 2;
      const top = rec ? p.climbY - camY + VIEW.y - rec.posY : p.y - camY + VIEW.y - art.height;
      if (p.facing < 0) {
        ctx.save();
        ctx.scale(-1, 1);
        ctx.drawImage(art, -(left + art.width), top);
        ctx.restore();
      } else ctx.drawImage(art, left, top);
    }
  }
  // and everything after (planes 4, 1, 2 — the lamp-post and cables in front)
  for (const q of lvl.draw) if (q.z > PLAY_PLANE_Z) drawOne(q);

  ctx.restore();
  if (iface) {
    paintHud(ctx, HUD_ART, {
      // nothing here can hurt the player, so the left-hand bar reads full: 1024
      // is the engine's own default max (`0x40d3a0`'s `mov dx, 0x400`)
      player: { health: stats.health, max: stats.maxHealth, nameCel: CEL.skullcracker },
      enemy: stats.shown,
      score: stats.score,
      lives: stats.lives,
      // the engine's own expression: what is alive, less what may remain
      // (`0x415f55` computes it with the same subtraction the win test makes)
      quota: Math.max(0, aliveNow() - stats.allowance),
      ticks: stats.ticks,
      buttons: buttonMask(),
      // `0x40d663` — the icon is drawn only while `[0x479438]` is set, but the
      // four gauge rows are drawn whatever, out of the weapon record's own
      // `max` and `rounds`. So an empty hand still shows the rounds you are
      // carrying for the gun you are looking for.
      weapon: {
        iconCel: inv.armed ? WEAPONS[inv.weapon]?.icon ?? 0 : 0,
        ammo: roundsIn(inv.weapon),
        magazine: WEAPONS[inv.weapon]?.max ?? 0,
      },
    });
  }

  const room = p.room;
  const which = room ? `${room.name}/p${room.param}` : "nowhere";
  const doors = room?.exits.length
    ? ` · doors to ${room.exits.map((e) => `p${e.to}`).join(", ")}`
    : "";
  const celNow = ` · cel ${lastCel}`;
  const state = p.act
    ? ` · ${p.act}`
    : p.climbing
      ? " · climbing"
      : !p.onGround
        ? " · in the air"
        : p.crouching
          ? " · crouching"
          : p.moving
            ? ` · ${p.running ? "RUNNING" : "walking"} ${Math.abs(p.vx) * ENGINE_HZ}px/s`
            : "";
  const here = solids();
  const box = playerBox();
  const inside = (e: SbkEntity): boolean =>
    box.right > e.left && box.left < e.right && box.bottom > e.top && box.top < e.bottom;
  const atDoor = room?.exits.some((e) => inside(e as unknown as SbkEntity)) ?? false;
  const alive = aliveNow();
  const ready = goalReady();
  const inGoal = here.goal !== undefined && inside(here.goal);
  if (!inGoal) leftGoal = true;
  const won = craftOpened();
  if (won && !advancing) void nextLevel();
  // the level is thousands of pixels wide and its end is one rect in it, so say
  // where that rect is rather than leaving it to be found by walking
  const g = here.goal;
  const away = g ? ((g.left + g.right) / 2 - p.x) : 0;
  const toGoal = won
    ? ` · <b>THE GOAL — level ${levelIndex + 1} complete</b>`
    : !g
      ? ""
      : craft?.state === "open"
        ? ` · <b>the screen is coming down</b>`
        : craft
          ? inGoal
            ? ` · <b>at the goal</b> — the television is overhead`
            : ` · <b>the television is in</b> ${Math.abs(Math.round(away))}px ${away < 0 ? "west" : "east"}, y ${g.top}`
          : inGoal
            ? ` · <b>at the goal</b> — ${Math.max(0, alive - stats.allowance)} still to kill`
            : ready
              ? ` · <b>the television is coming</b>`
              : ` · goal ${Math.abs(Math.round(away))}px ${away < 0 ? "west" : "east"}, y ${g.top} — ` +
                `<b>${Math.max(0, alive - stats.allowance)} still to kill</b>`;
  // the quota the same way the panel says it: alive minus what may remain
  const quotaSay = ` · quota ${Math.max(0, alive - stats.allowance)} of ${Math.max(0, stats.census - stats.allowance)}` +
    ` (kill ${Math.round(mission().kill * 100)}% of ${stats.census})`;
  const prompt = atDoor && !won ? " · <b>press ↑ for the door</b>" : "";
  const mob = spawnedHere().length ? ` · ${spawnedHere().length} spawned` : "";
  // the nearest thing that can be fought, and what it is doing — without this the
  // only window into a fight is the panel's bar, which is sticky and cannot say
  // whose it is or why a blow is missing
  const near = spawnedHere()
    .filter((e) => FOES[e.kind].panel)
    .sort((a, b) => Math.abs(a.x - p.x) - Math.abs(b.x - p.x))[0];
  const foe = near
    ? ` · nearest ${near.kind} ${Math.round(near.hp)}/${near.max}hp ${near.state}` +
      ` at x ${Math.round(near.x)}, y ${Math.round(near.y)} cel ${celOf(near)}` +
      // the state of the one class that has states, so a probe can see it decide
      (near.mode ? ` mode ${near.mode}` : "")
    : "";
  // ...and the nearest thing that can be fought and claims no PLATE, which the
  // line above cannot show. The dog is the case — `0x40d1c0` is never called from
  // any of its functions, so it has no bar and no name on the panel — and so is
  // the rat. Without this a probe cannot see either of them at all.
  const plain = spawnedHere()
    .filter((e) => !FOES[e.kind].panel && (FOES[e.kind].death || FOES[e.kind].flinch))
    .sort((a, b) => Math.abs(a.x - p.x) - Math.abs(b.x - p.x))[0];
  const unplated = plain
    ? ` · unplated ${plain.kind} ${Math.round(plain.hp)}/${plain.max}hp ${plain.state}` +
      ` at x ${Math.round(plain.x)}, y ${Math.round(plain.y)} cel ${celOf(plain)}`
    : "";
  // the hydrant and its water: neither has a health bar, and the whole point of
  // the burst is that one object turns into two and back into one
  // the crows, which are the only thing on this page that flies
  const birds = crowsHere();
  // whichever is nearest, plus anything that is not asleep — the two things worth
  // knowing, and a probe can read either
  const shown = [
    ...birds.filter((c) => c.state !== "sleep"),
    ...[...birds].sort((a, c) => Math.abs(a.x - p.x) - Math.abs(c.x - p.x)).slice(0, 1),
  ].filter((c, i, all) => all.indexOf(c) === i);
  const bird = birds.length
    ? ` · ${birds.length} crow${birds.length === 1 ? "" : "s"}: ` +
      shown
        .slice(0, 3)
        .map((c) => `${c.state} cel ${crowCel(c)} at ${Math.round(c.x)},${Math.round(c.y)}`)
        .join(" · ")
    : "";
  // the planks: a probe cannot otherwise tell a sound board from one about to go
  const boards = planksHere().filter((k) => k.state !== "intact" || k.crossings > 0);
  const board = boards.length
    ? ` · ${boards.map((k) => `plank ${k.state} cel ${plankCel(k)} x${Math.round(k.x)} crossed ${k.crossings}`).join(" · ")}`
    : "";
  // the elevators: a probe cannot otherwise tell a car that is waiting from one
  // it never boarded, and the deck's y is the only way to see a ride happen
  const cars = elevatorsHere();
  const car = cars.length
    ? ` · ${cars
        .map(
          (e) =>
            `lift ${e.state} car ${ELEVATOR.car.cels[0]} winch ${elevatorCel(e)} deck y${Math.round(e.floor.top)} of ${e.top}..${e.bottom}` +
            `${ridingElevator(e) ? " RIDDEN" : ""}`,
        )
        .join(" · ")}`
    : "";
  // the girders, so a probe can see a swing happen at all: nothing else moves them
  const swung = ibeamsHere().filter((b) => b.delay <= 0);
  const beam = swung.length
    ? ` · ${swung.slice(0, 3).map((b) => `beam ${b.state} cel ${ibeamCel(b)} at ${b.x},${b.y}`).join(" · ")}`
    : "";
  // the presses: a probe cannot otherwise tell one that is up and watching from
  // one that is coming down, and the two cels that hurt are named in CRUSH
  const presses = crushesHere().filter((c) => c.state !== "idle");
  const press = presses.length
    ? ` · ${presses.slice(0, 3).map((c) => `press ${c.state} cel ${crushCel(c)} at ${c.x},${c.y}`).join(" · ")}`
    : "";
  // level six's levers and what they are pouring, so a probe can see both
  const levers = switchesHere();
  const lever = levers.length
    ? ` · ${levers.map((w) => `switch ${w.param} ${w.state} cel ${switchCel(w)} at x ${w.x}`).join(" · ")}`
    : "";
  // the level's doors, not the room's: one lever in one region opens a door in
  // another, and the engine holds one list for the stage ({@link broadcast})
  const gates = level?.doors.flat() ?? [];
  const gate = gates.length
    ? ` · ${gates.map((d) => `door ${d.param} ${d.state}`).join(" · ")}`
    : "";
  const sumps = elevsHere();
  const sump = sumps.length
    ? ` · ${sumps.map((e) => `lift x${e.x} ${e.state} y${Math.round(e.y)}`).join(" · ")}`
    : "";
  // the scenery, so a probe can see the two of it that move on their own
  const props = [
    ...hereOf((l) => l.shacks).filter((k) => k.state !== "shut").map((k) => `shack ${k.state} cel ${shackCel(k)}`),
    ...hereOf((l) => l.barrels).map((b) => `barrel at ${Math.round(b.x)},${Math.round(b.y)}`),
    ...hereOf((l) => l.pipes).map((q) => `pipe at x${q.x}`),
    ...hereOf((l) => l.holes).map((h) => `grave ${h.state} cel ${holeCel(h)} at x${h.x}`),
    ...hereOf((l) => l.axes).map((a) => `axe cel ${axeCel(a)} at x${a.x}`),
    ...hereOf((l) => l.floors).map((f) => `floor ${f.state} cel ${floorCel(f)} at x${f.x}`),
    ...hereOf((l) => l.cages).map((c) => `cage ${c.param} ${c.state} cel ${cageCel(c)} at x${c.x}`),
    ...hereOf((l) => l.fans).map((q) => `fan ${q.horizontal ? "h" : "v"} ${q.state} cel ${fanCel(q)} at x${q.x}`),
    hereOf((l) => l.belts).length ? `${hereOf((l) => l.belts).length} belts` : "",
    ...hereOf((l) => l.chairs).map((c) => `chair ${c.run} cel ${chairCel(c)} at x${c.x}`),
    ...hereOf((l) => l.claws).map((c) => `claw ${c.state} cel ${clawCel(c)} at x${Math.round(c.x)}`),
    ...hereOf((l) => l.fittings).map((f) => `${f.kind} cel ${fittingCel(f)} at x${f.x}`),
    ...hereOf((l) => l.boggs).map((b) => `boggs cel ${boggsCel(b)} at x${b.x}, ${BOGGS.health}hp and only a -1 blow lands`),
    ...hereOf((l) => l.surges).map((q) => `surge cel ${surgeCel(q)} at x${q.x}`),
    ...hereOf((l) => l.bridges).map((b) => `bridge ${b.state} cel ${bridgeCel(b)} at x${b.x}`),
    ...hereOf((l) => l.hands).map((q) => `hand ${q.state}${q.underfoot ? " underfoot" : ""} cel ${handCel(q)} at x${Math.round(q.atX)}`),
    ...hereOf((l) => l.bushes).map((q) => `bush at x${q.x}`),
    roaches.length ? `${roaches.length} roaches` : "",
    hereOf((l) => l.sprinklers).length
      ? `${hereOf((l) => l.sprinklers).length} sprinklers, ${columns.size} up${columns.size ? ` cel ${columnCel([...columns.values()][0])}` : ""}`
      : "",
  ].filter(Boolean);
  const prop = props.length ? ` · ${props.join(" · ")}` : "";
  const got = hereOf((l) => l.pickups);
  const gots = got.length
    ? (() => {
        const q = got.reduce((a, b) => (Math.abs(b.x - p.x) < Math.abs(a.x - p.x) ? b : a));
        return ` · ${got.length} pickups · nearest ${PICKUP.kinds[q.code].name} ${q.code} at x ${q.x}, y ${q.y}`;
      })()
    : "";
  const arms = hereOf((l) => l.guns);
  const gun = WEAPONS[inv.weapon];
  const far = (g: Gun): number => Math.hypot(g.x - p.x, g.y - p.y);
  const lying = arms.length ? arms.reduce((a, b) => (far(b) < far(a) ? b : a)) : null;
  const armed =
    ` · ${inv.armed ? "holding" : "no"} ${gun ? gun.name : inv.weapon} ${roundsIn(inv.weapon)}/${gun ? gun.max : 0}` +
    (arms.length
      ? ` · ${arms.length} guns · nearest ${GUN_CODES[lying!.code]?.name ?? lying!.code} at x ${Math.round(lying!.x)}, y ${Math.round(lying!.y)}${gunAhead() ? " IN REACH" : ""}`
      : "") +
    (flares.length ? ` · ${flares.length} flares` : "");
  const pools = hereOf((l) => l.sewage);
  const pool = pools.length ? ` · ${pools.length} sewage` : "";
  const nests = nestsHere();
  const goop = nests.length
    ? ` · goop ${nests.filter((n) => n.on).length} of ${nests.length} on, ${drips.length} falling${drips.length ? ` cel ${dripCel(drips[0])} at ${Math.round(drips[0].x)},${Math.round(drips[0].y)}` : ""}`
    : "";
  const valves = spawnedHere()
    .filter((e) => FOES[e.kind].burst)
    .map((e) => `${e.state === "burst" ? "water" : e.kind} cel ${celOf(e)} at x ${Math.round(e.x)}`);
  const valve = valves.length ? ` · ${valves.join(" · ")}` : "";
  // where a struck thing ends up, which is the only way to see a slide from a
  // probe: the flying kinds have no health bar to read
  const flew = spawnedHere().find((e) => FOES[e.kind].flies && (e.vx !== 0 || e.dents > 0));
  const slid = flew ? ` · ${flew.kind} at x ${Math.round(flew.x)}` : "";
  // the blow CODES — the reaction playing, what has hold of you, and the state
  // of the nearest hand, none of which the panel shows and all of which a probe
  // needs to see the system at all
  const reacting = Object.values(BLOW_CODES).find((r) => r.act === p.act);
  const code =
    (reacting ? ` · <b>code ${reacting.code}</b> ${reacting.act} frame ${Math.floor(p.actClock)}` : "") +
    (p.act === "held" || p.act === "struggle" ? ` · <b>${p.act}</b> frame ${p.heldClock}` : "") +
    (p.heldBy ? ` · HELD, gravity x${p.gravityScale}` : "");
  const nearHand = hereOf((l) => l.hands).sort((a, b) => Math.abs(a.atX - p.x) - Math.abs(b.atX - p.x))[0];
  const hand = nearHand
    ? ` · nearest hand ${nearHand.underfoot ? "underfoot" : "anywhere"} ${nearHand.state}` +
      ` cel ${handCel(nearHand)} at x ${Math.round(nearHand.atX)}` +
      ` blow ${(nearHand.underfoot ? HAND.underfoot : HAND.anywhere).blow}`
    : "";
  const lives = ` · ${stats.lives} ${stats.lives === 1 ? "life" : "lives"} · clock ${Math.round(stats.ticks)}`;
  // the switch, and what it is spending — a probe has no other way to see either
  const hurt = damageOn ? ` · <b>damage ON</b> ${Math.round(stats.health)}/${stats.maxHealth}hp` : " · damage off";
  // the panel already shows it in the disc's own digits; this is for the probes,
  // which can read a number out of text and can only count pixels off a canvas
  const points = ` · ${stats.score} points`;
  hud.innerHTML =
    `<b>level ${levelIndex + 1} · ${lvl.name}</b> · room ${lvl.rooms.indexOf(room!) + 1} of ` +
    `${lvl.rooms.length} (${which})${doors}` +
    `${room && !room.ground ? " · <b>no floor in this room</b>" : ""}` +
    ` · x ${Math.round(p.x)}, y ${Math.round(p.y)}${state}${celNow}${mob}${foe}${unplated}${valve}${board}${car}${beam}${press}${lever}${goop}${gate}${sump}${prop}${pool}${gots}${armed}${bird}${slid}${code}${hand}${lives}${hurt}${points}${quotaSay}${prompt}${toGoal}` +
    ` · every pixel is the disc's, both facings included; the speed and cadence are this port's — see INVENTED in src/walk.ts`;
}

/**
 * The panel's cels, by the book's own ids.
 *
 * `src/hud.ts` knows every id and every coordinate and nothing about where the
 * pixels come from; this is the join. The player's book holds all of them — the
 * two bands, the sliding bars, the name plates, the numerals, the dial and the
 * eight button lights are all in `PLAYER.SBK`.
 */
const HUD_ART = {
  art: (id: number): CanvasImageSource | null => {
    const loc = player?.byId.get(id);
    return loc === undefined ? null : playerCel(loc);
  },
  hdr: (id: number): ShpFrame | null => {
    const loc = player?.byId.get(id);
    return loc === undefined ? null : playerFrame(loc);
  },
};

/** the eight buttons as one word, in the bit order `0x40da41` walks them in */
function buttonMask(): number {
  let m = 0;
  if (held.up) m |= buttonBit("up");
  if (held.right) m |= buttonBit("right");
  if (held.down) m |= buttonBit("down");
  if (held.left) m |= buttonBit("left");
  if (held.punch || (p.act ?? "").startsWith("punch")) m |= buttonBit("punch");
  if (held.kick || (p.act ?? "").startsWith("kick")) m |= buttonBit("kick");
  if (held.inv) m |= buttonBit("inv");
  if (held.jump || !p.onGround) m |= buttonBit("jump");
  return m;
}

const playerFrameCache = new Map<number, ShpFrame>();
function playerFrame(loc: number): ShpFrame | null {
  const had = playerFrameCache.get(loc);
  if (had) return had;
  if (!player) return null;
  try {
    const f = decodeShpFrame(player.file.containers[loc].data);
    playerFrameCache.set(loc, f);
    return f;
  } catch {
    return null;
  }
}

const playerCelCache = new Map<number, HTMLCanvasElement>();
function playerCel(loc: number): HTMLCanvasElement | null {
  const had = playerCelCache.get(loc);
  if (had) return had;
  if (!player || !playerPal) return null;
  let f: ShpFrame;
  try {
    f = decodeShpFrame(player.file.containers[loc].data);
  } catch {
    return null;
  }
  const c = document.createElement("canvas");
  c.width = f.width;
  c.height = f.height;
  const cc = c.getContext("2d")!;
  const img = cc.createImageData(f.width, f.height);
  for (let i = 0; i < f.width * f.height; i++) {
    if (!f.opaque[i]) continue;
    const q = f.indexed[i] * 4;
    img.data[i * 4] = playerPal[q];
    img.data[i * 4 + 1] = playerPal[q + 1];
    img.data[i * 4 + 2] = playerPal[q + 2];
    img.data[i * 4 + 3] = 255;
  }
  cc.putImageData(img, 0, 0);
  playerCelCache.set(loc, c);
  return c;
}

async function boot(): Promise<void> {
  files = await SkullFiles.open();
  sound = new Sounds(files);
  const pb = await files.load("player.sbk");
  if (!pb) {
    hud.textContent = "player.sbk is not in this rip";
    return;
  }
  player = readSbkFile(pb);
  playerPal = paletteToRGBA(player.paletteRaw!, 256);
  fillPicker();
  const params = new URLSearchParams(location.search);
  const clock = params.get("clock");
  if (clock !== null && Number.isFinite(Number(clock))) startTicks = Math.max(0, Number(clock));
  const want = Number(params.get("level") ?? "1");
  await loadLevel(Math.min(16, Math.max(1, want)) - 1);
  // ?x= drops the player at a world x, for looking at a specific spot — and ?y=
  // with it, because in CITY the column under an x is usually the void: its
  // ground is a ledge and then y7250, so `?x=` alone is a death on arrival for
  // most of the level and cannot be used to reach anything in it
  const atX = params.get("x");
  const atY = params.get("y");
  if (atX !== null || atY !== null) {
    const x = atX !== null ? Number(atX) : p.x;
    const y = atY !== null ? Number(atY) : p.y;
    enter(roomAt(x, y), x, y);
    if (atY !== null) {
      // `enter` takes the room's FLOOR under x, which is the whole point of it
      // for a door — and exactly wrong here, because in CITY that floor is the
      // void. An explicit y is an instruction, so it wins.
      p.y = y;
      p.vy = 0;
      p.onGround = true;
    }
  }
  requestAnimationFrame(loop);
}

void boot().catch((e) => {
  hud.textContent = String(e);
});
