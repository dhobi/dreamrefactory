/**
 * The game itself — Skull Cracker's world, stepped a tick at a time, with no
 * page, no canvas and no clock of its own. {@link file://./walk.ts} shows it;
 * a headless run (`tests/machine`) drives it directly. See {@link tick}.
 */
import { readSbkFile, SbkCel, SbkEntity, SbkFile, SbkRoom, LEVEL_ORDER, PLANE_Z, PLAY_PLANE_Z, arrivalIn, placementRate, readRooms } from "@dreamfactory/engine/df/sbk";
import { decodeShpFrame, ShpFrame } from "@dreamfactory/engine/df/shp";
import { paletteToRGBA } from "@dreamfactory/engine/df/image";
import { AudioSink, DeferredAudioSink, WebAudioSink } from "@dreamfactory/engine/runtime/audio";
import { SkullFiles } from "./files";
import { Film } from "./film";
import { CORPSE_LINGER, FOES, FoeAnim, celAt, loopIndex, type Foe } from "./foes";
import { TICK_SCALE, install, type BrainCtx, type Aim, type CastCtx, type CastKit, type Enemy, type Hatch, type Hitter, type Track } from "./brains/kit";
import { BRAINS, GATES, REACTIONS } from "./brains";
import { COP_SLUG } from "./brains/cop";
import { EYEBALL_GLOBS } from "./brains/eyeball";
import { HARDCORE_THROW, HARDCORE_THROW_LOW } from "./brains/hardcore";
import { IGOR_THROW } from "./brains/igor";
import { SKEL_BONE } from "./brains/skel";
import { PUKE_GOB } from "./brains/puke";
import { TUBE_BREATH, TUBE_SHARDS } from "./brains/tube";
import { VPRIEST_BOLT } from "./brains/vpriest";
import { WBOOLY_HIGH, WBOOLY_LOW } from "./brains/wbooly";
import { KRAGG_SHOT_AIR, KRAGG_SHOT_GROUND } from "./brains/kragg";
import { GHENGIS_BLAST } from "./brains/ghengis";
import { KNIFEBOY_KNIFE, KNIFEBOY_LOB } from "./brains/knifeboy";
import { FIGHTS, FoeFight } from "./fights";
import { BLEED, CRAFT, Gob, Pop, SPARK, Spark, SPRAY, VANISH, dropCount, dryTime, gobCount, scatter } from "./effects";
import { FOE_SFX, OWN, Sounds } from "./sound";
import { CROW, Crow, ELEVATOR, Elevator, IBEAM, CRUSH, Ibeam, Crush, Feather, PLANK, Plank, burnCrow, crowCel, crowFrames, crowTag, type CrowState, elevatorFrames, ibeamCel, crushCel, ibeamFrames, crushFrames, plankCel, plankFrames, PICKUP, Pickup, SPRINKLER, Sprinkler, SHACK, Shack, shackFrames, BARREL, Barrel, PIPE, Pipe, SEWAGE, Sewage, BUSH, Bush, ROACH, SPILL, Nest2, Roach, DOOR, Door, doorFrames, ELEV, Elev, SWITCH, Switch, switchFrames, GOOP, Nest, Drip, dripCel, dripFrames, HOLE, Hole, HAND, Hand, AXE, Axe, BRIDGE, Bridge, FLOOR, Floor, SURGE, Surge, CAGE, Cage, ALARM, BIGGUN, Flypast, PROBE, Probe, BigGun, LIGHTFX, LightFx, Alarm, FAN, Fan, BELT, Belt, CHAIR, Chair, CLAW, Claw, FITTING, Fitting, BOGGS, Boggs, BoggsWorm, SKATEBOARD, Board, CAN, Can, HEAD, Head, FLAME, Flame, ROLLER, Roller } from "./props";
import { DEATH_FILMS, ENDING_FILM, MISSIONS, PIT_DEPTH, TIME_OUT_FILMS, allowanceFor, type Mission } from "./mission";
import { BOLT, GUNBOLT, CHAPTER_WEAPON, FLARE, GRAB, GUN_CODES, STREAMS, WEAPONS, type Bolt, type Flare, type Gun, type Stream, type StreamKit } from "./guns";
import { PLAYER_CODES, PLAYER_HELD, gripOf } from "./codes";
import { PLAYERS } from "./players";
import { PREFS_ACTIONS, keyName, loadPrefs } from "./prefs";
import { Cheat, CheatTyper } from "./cheats";
import { CEL as HUD_CEL, CLOCK, CLOCK_FULL, HudFighter, LABEL, WINDOW, buttonBit, dialCel } from "./hud";
import { random, roll as scRoll, seedRandom } from "./random";


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
/**
 * The page's switches — `?level=`, `?x=`, `?damage=` and the rest — read once.
 * In a browser they are the address bar's; a headless run hands the same
 * string in as `globalThis.SC_QUERY` before the game is loaded, so a test
 * says exactly what a URL would.
 */
export let QUERY = new URLSearchParams(
  (globalThis as { SC_QUERY?: string }).SC_QUERY ??
    (typeof location === "undefined" ? "" : location.search),
);

/**
 * What the game asks of whoever is showing it — the page, or nobody. Films,
 * the status line, the level picker and the end of a game are the page's
 * business; a headless run leaves these as they are and the game goes
 * straight on past each one.
 */
export interface GameUi {
  /** a line of text while something loads or fails */
  status(text: string): void;
  /** the level now running, for a picker to show */
  levelShown(index: number): void;
  /** play a film to its end (or its skip) */
  film(name: string): Promise<void>;
  /** the last life is gone: offer the score, and back to the menu */
  gameOver(score: number, level: number, difficulty: number): void;
}
export const ui: GameUi = {
  status: () => {},
  levelShown: () => {},
  film: async () => {},
  gameOver: () => {},
};

/**
 * WHICH of the two Skull Crackers this page is playing.
 *
 * `0x46b1a8` is the word `0x402950` reads to pick between `0x428080` and
 * `0x442ad0`, and input action 11 (`0x402d22`) toggles it — so the switch is the
 * game's own and so is changing it mid-level. See {@link file://./players.ts}
 * for the two of them and for every place they differ.
 *
 * `?char=1` picks one before the level loads; Shift+C is action 11.
 */
export let CHARACTER: 0 | 1 = QUERY.get("char") === "1" ? 1 : 0;
export let KIT = PLAYERS[CHARACTER];
export let ANIM = KIT.anim;
export let ACTIONS = KIT.actions;
export let MEASURED = KIT.measured;
export let STAND_FEET = KIT.standFeet;
export let TUCK_FEET = KIT.tuckFeet;
export let BLOW_CODES = PLAYER_CODES[CHARACTER];
export let HELD = PLAYER_HELD[CHARACTER];

/** action 11: the other player, and the level again so the pose is theirs */
export function useCharacter(n: 0 | 1): void {
  CHARACTER = n;
  KIT = PLAYERS[CHARACTER];
  ANIM = KIT.anim;
  ACTIONS = KIT.actions;
  MEASURED = KIT.measured;
  STAND_FEET = KIT.standFeet;
  TUCK_FEET = KIT.tuckFeet;
  BLOW_CODES = PLAYER_CODES[CHARACTER];
  HELD = PLAYER_HELD[CHARACTER];
}

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
 * This is the whole of the jump's shape and it took far too long to notice. The
 * mover does not move an object by a fraction of a pixel — it does an `idiv` with
 * an explicit away-from-zero adjustment (`sub ax,cx; inc ax` when negative,
 * `lea eax,[ecx+eax-1]` when positive) and adds a WHOLE number of pixels. So every
 * frame's step has its magnitude rounded UP, and over a jump that compounds:
 * stepping `-420` by hand at the player's divisor of 12 gives moves of
 * `-35 -27 -19 -10 -2` — an apex of 93px where the same numbers integrated as
 * floats give 73.5. The port had been integrating as floats.
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
function airThink(dir: number): void {
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
function startJump(run: boolean, moving: boolean): void {
  sound?.own(OWN.jump, p.x, p.y);
  p.leap = run;
  p.windup = run ? 1 : ANIM.launch.length;
  p.launchDx = run ? MEASURED.runJumpDx : moving ? MEASURED.launchDx : 0;
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
 * That is the number everything else was missing. The animation stepper advances
 * one cel per frame, so every animation in the game plays at 15fps — this page
 * had been running them at 34, which is why the punch was a blur. And it turns
 * {@link MEASURED}'s per-frame pixels into pixels per SECOND at last: the walk's
 * 8 a frame settles against the ground's drag at 12 — 180 a second — the run's
 * 15 at 22 (330), and the launch leaves the ground at 35 in one frame.
 */
export const ENGINE_HZ = 15;

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
 * `[0x46b1b8]` — set by the leave (`0x42ae98`), cleared by `0x42849c` the frame
 * the player is grounded again, and while it is set neither the idle state
 * (`0x429872`) nor the jump state (`0x429f5d`) asks for a ladder at all. Off a
 * ladder you LAND before you can climb again.
 */
export let ladderLatch = false;
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
function hanging(): boolean {
  return p.climbing || !!p.bar;
}

/** `0x40b940(2, anchor)` answering a room — what the knocks off a ladder ask */
function roomHolds(): boolean {
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

/**
 * Interface mode or full-screen, and Ctrl+P between them — `SC.EXE`'s own key,
 * and its own help screen is where the pair is named: *"Press Ctrl-P to toggle
 * between interface and full-screen mode"*. With the panel up the level plays
 * inside {@link WINDOW}, which is where the pause films play too; without it the
 * level has the whole 512x384 and nothing is drawn over it.
 */
export let iface = true;
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
export const FULL_H = 0x156;
export const VIEW = { x: WINDOW.x, y: WINDOW.y, w: WINDOW.w };
export const viewH = (): number => (iface ? WINDOW.h : FULL_H);

/**
 * Move the feet to where the POSE puts them, keeping the anchor where it was.
 *
 * The engine's `y` is the cel's anchor, and what the body stepper stands on a
 * floor is the CURRENT cel's own extent below it: `0x42fdcf` reads the cel's word
 * at +0x26 — `height - posY`, the bottom row of the art — and adds `obj+0x10`,
 * which the player's init zeroes (`0x42e43a`). Not the collision box, which is
 * authored separately and ends short of the art on most cels (cel 1's box stops
 * at 88 where its art reaches 90; character 1's tuck 5203 stops at 38 where its
 * art reaches 71). So a change of pose moves the FEET: standing cel 1 reaches 90
 * rows below the anchor and the airborne tuck (200, 220) 70 and 71, because the
 * knees come up. This page keeps `p.y` at the feet instead, so the same fact has
 * to be spelled the other way round — the offset changes and `p.y` moves with
 * it, leaving `p.y - p.feet` (the anchor, the thing every rect in the file is
 * measured against) continuous, and the floor under the new pose puts the feet
 * back on it.
 *
 * It is worth twenty pixels of clearance and CITY is built on them. Its first
 * jump is from a walkway at y4041 onto a tank roof at y3920 — 121 rows — and the
 * launch plus the lift raise the anchor 105: from 3951 to 3846, where the tuck's
 * feet are at 3917, over the roof by three pixels. Standing-footed the same jump
 * lands short, every time.
 *
 * The cel is the one on screen, which is the one the last frame's animation
 * chose. The ladder and the bar hang the player by the hands and have their own
 * ({@link LADDER}, {@link MONKEYBAR}), so the frame a climb ends in is not read
 * as a pose to stand on — the two fixed figures below stand in for it.
 */
export function poseFeet(): void {
  const rec = celRec(player, lastCel);
  const hung =
    ANIM.hang.includes(lastCel) ||
    ANIM.climb.some((t) => t.includes(lastCel)) ||
    ANIM.bar.some((t) => t.includes(lastCel));
  // the tuck's cels are 200 and 220: a run's leap from its first frame, a
  // standing jump's from the frame after 253's launch
  const tucked = !p.onGround && (p.leap || p.airFrames >= 1);
  const want = p.climbing
    ? p.feet
    : rec && !hung
      ? rec.height - rec.posY
      : tucked
        ? TUCK_FEET
        : STAND_FEET;
  if (want === p.feet) return;
  p.y += want - p.feet;
  p.feet = want;
}

/**
 * The camera — `0x4309f0`, and all of it is in `SC.EXE`.
 *
 * This page had an invented one for a long time, on the belief that the engine
 * "scrolls by moving the world rather than the view" and so has no camera
 * variable to read. It has one. `0x4309d0` answers with `[0x4a8970]`, the view
 * rect's own corner in WORLD coordinates, and every draw subtracts it. What
 * misled the earlier reading is that nothing writes that global directly: it is
 * written by `0x4308a0`, which takes a requested corner and clamps it.
 *
 * ```
 *   4309f0  per engine frame, mode 0 (follow the tracked object [0x4a8994])
 *   430a1c    target   = player point
 *   430a30    target.x += lead, or -= lead when [player+0x28] says left
 *   430a42    target.y -= lift
 *   430a81    chase    = [0x4a6938] translated by the view's own corner
 *   430ab2    dx = (target.x - chaseMidX) * maxDx / 0x118, clamped to +-maxDx
 *   430af2    dy = (target.y - chaseMidY) * maxDy / 0x64,  clamped to +-maxDy
 *   430b46    0x430820(dx, dy) -> corner += (dx, dy) -> 0x4308a0
 * ```
 *
 * `0x4308a0` is the clamp, and it is the ROOM's own rect — `0x40ba30` copies the
 * room's 48-byte entity record and the four sides are tested one at a time
 * behind four bits of {@link SbkRoom.flags}. The floor is applied after the cap,
 * so a room narrower than the view is pinned to its left edge.
 *
 * Two things this replaces. The old camera centred on the middle of the player's
 * collision box; the engine's target is the object's own point, held at the
 * middle of `0x4a6938` — which for a 512x232 window is its middle too, so the
 * pose no longer enters into it. And the old clamp used {@link roomSpan}, the
 * extent of the FLOOR, which is narrower than the room in nine levels: VAT's
 * chamber loses 35 pixels that way, and machine B — `0x46e088`'s `+373`, at
 * x6694 — could never be brought on screen.
 *
 * What is NOT the engine's: the ease runs once an engine frame here, the way it
 * does there, but this page's frame is a quarter of a tick rather than a whole
 * one of the disc's 15Hz. The numbers below are the disc's unchanged.
 */
export const CAMERA = {
  /**
   * `0x4a6938`, written at `0x42aec8` — the rect whose MIDDLE the target chases.
   * The ladder and the bar install `{0x6e, 0xc8, 0x7a, 0x138}` instead
   * (`0x42b216`, `0x42b464`), which has the same middle, (256, 116).
   */
  chase: { top: 0x32, left: 0xc8, bottom: 0xb6, right: 0x138 },
  /**
   * `0x430c20(chase, maxDx, maxDy, lead, lift)` — what the state installs, and
   * there are three of them. `lead` is pixels AHEAD of the player the target
   * sits (`0x430a30`); `lift` comes off the target's y (`0x430a42`); `maxDx` and
   * `maxDy` are the most the corner moves in one engine frame.
   *
   * - on foot: `0x42e67a` as a level begins, `0x42aec8` off a ladder and
   *   `0x42b53a` off a bar
   * - on a ladder: `0x42b216`, every frame of the mount — no lead at all, and a
   *   slower vertical
   * - on a bar: `0x42b464`, every frame of `0x42b410`'s preamble — the ladder's,
   *   with the target 100 BELOW the hands (a lift of −100)
   */
  rig: {
    foot: { lead: 0x78, lift: 0, maxDx: 0x32, maxDy: 0x32 },
    ladder: { lead: 0, lift: 0, maxDx: 0x32, maxDy: 0x1e },
    bar: { lead: 0, lift: -0x64, maxDx: 0x32, maxDy: 0x1e },
  },
  /** `0x430ab4` and `0x430ada` — the error at which each cap is reached */
  spanX: 0x118,
  spanY: 0x64,
  /** `0x428fe8` / `0x428ff1` — where an ARRIVAL puts the corner, before clamping */
  arriveX: 0xc8,
  arriveY: 0x64,
  /** `0x430914` / `0x43092c` / `0x430950` / `0x430968` — which sides clamp */
  capX: 8,
  floorX: 2,
  capY: 4,
  floorY: 1,
  from: "0x4309f0 / 0x4308a0 / 0x430c20 / 0x40ba30",
} as const;

/** the view's own corner in world coordinates — `[0x4a8970]` */
export const view = { x: 0, y: 0 };

/** `[0x46f680]` — the level's own frame counter, which only the lightning reads */
export let levelClock = 0;

/**
 * Engine frames since the level was built, which is what paces the backdrop's
 * animated placements: each is an object on the animator (`0x40c199` gives it
 * the script, `0x40c19c` sets it looping) and `0x45d0f0` holds each cel for the
 * script's hold, so the cel showing is `frames / hold` round the list, all of
 * them starting together at the load.
 */
export let backdropFrames = 0;

/** what the level's `probe` records have fired and not yet thrown away */
export let flypasts: Flypast[] = [];

/**
 * `[0x46bdd0]` — a palette index queued for the next paint, or -1 for none.
 *
 * `0x40e4c0` writes it and `0x40dfd0` spends it: the whole view rect is flooded
 * with that colour for one frame and the global is set back to -1. Two things
 * use it, the blaster's muzzle (0xe1) and TOWER's lightning (0).
 */
export let flashColour = -1;

/** the middle of {@link CAMERA.chase}, the way `0x430a98` and `0x430ad5` take it */
export const CHASE_X =
  CAMERA.chase.left + Math.trunc((CAMERA.chase.right - CAMERA.chase.left) / 2);
export const CHASE_Y =
  CAMERA.chase.top + Math.trunc((CAMERA.chase.bottom - CAMERA.chase.top) / 2);

/**
 * `0x4308a0` — put the corner where it is asked for, within the room's rect.
 *
 * Cap first, floor second, each behind its own bit, exactly as the four tests
 * run. A room with a bit clear is not clamped on that side at all, which is how
 * RAVECAVE (12) and SEWER's shafts (5) scroll off their own rects.
 *
 * The room is the player's `obj+0x16`, and `0x4308e2` clamps nothing at all
 * while it is negative — which it is for the whole of a climb: the mount writes
 * `0xffff` there (`0x42b273`) and only the leave asks `0x40b940` for a region
 * again (`0x42af28`). A ladder runs out of its region (MAZE's first crosses two
 * gaps with no region in them), and the view follows the climber through them.
 */
export function placeView(x: number, y: number): void {
  const r = p.climbing ? null : p.room;
  if (!r) {
    view.x = x;
    view.y = y;
    return;
  }
  const h = viewH();
  let sx = x;
  let sy = y;
  if (r.flags & CAMERA.capX && r.right - VIEW.w < sx) sx = r.right - VIEW.w;
  if (r.flags & CAMERA.floorX && r.left > sx) sx = r.left;
  if (r.flags & CAMERA.capY && r.bottom - h < sy) sy = r.bottom - h;
  if (r.flags & CAMERA.floorY && r.top > sy) sy = r.top;
  view.x = sx;
  view.y = sy;
}

/**
 * Which of {@link CAMERA.rig}'s three the player's state has installed. Each
 * state writes its own every frame it runs and the leave writes the foot's back,
 * so the rig is a function of the state and nothing else.
 */
export function cameraRig(): (typeof CAMERA.rig)[keyof typeof CAMERA.rig] {
  return p.climbing
    ? CAMERA.rig.ladder
    : p.bar
      ? CAMERA.rig.bar
      : CAMERA.rig.foot;
}

/** where the target is — the player's own point, led by the facing */
export function chaseTarget(): { x: number; y: number } {
  const rig = cameraRig();
  return {
    x: p.x + p.facing * rig.lead,
    y: (p.climbing ? p.climbY : p.y - p.feet) - rig.lift,
  };
}

/**
 * This engine frame's step, in whole pixels — `0x430ac8`'s `di` and `ax`.
 *
 * Kept rather than applied, because the frame is not this page's unit of time.
 * `0x4309f0` runs once an engine frame and jumps the corner the whole way; here
 * the player moves every TICK, four to the frame, so a camera that jumped once a
 * frame would scroll the world in 15Hz steps behind a man walking at 60 — which
 * is exactly how it looked. {@link driftCamera} spends the step across the
 * frame's four ticks instead, the same way the frame's fall is spent. At every
 * frame boundary the corner is where `0x4309f0` would have put it; in between it
 * is on the way there.
 */
export let camVx = 0;
export let camVy = 0;

/**
 * The probes — `0x4280d2`, which is a trigger table and not an object.
 *
 * Once an engine frame, against the LEVEL's own buffer: the player's point in
 * the record's rect fires it, `0x410170` stands up one flypast on the record's
 * `param` as a mode, and `0x402e80` shifts the record out of the table so it can
 * never fire again. See {@link PROBE}.
 */
export function stepProbes(): void {
  const lvl = level;
  if (!lvl) return;
  const py = p.y - p.feet;
  for (const q of lvl.probes) {
    if (q.fired) continue;
    if (p.x < q.left || p.x > q.right || py < q.top || py > q.bottom) continue;
    q.fired = true;
    // `0x410190` — the mode goes straight into `obj+0x28`, so for the crossing
    // pair it is the mirror flag as well as the branch
    const mirror = q.mode === 1;
    if (q.mode <= 1) {
      // `0x41025c` — half a screen to one side, and it comes towards you
      flypasts.push({
        x: p.x + (mirror ? PROBE.sideX : -PROBE.sideX),
        y: py,
        vx: 0,
        vy: 0,
        mirror,
        tag: 0,
        clock: 0,
      });
    } else {
      // `0x4102aa` / `0x41030a` — under your feet, or down out of the sky
      const below = q.mode === 2;
      flypasts.push({
        x: p.x,
        y: py + (below ? PROBE.offsetY : -PROBE.offsetY),
        vx: 0,
        vy: below ? -PROBE.startVy : PROBE.startVy,
        mirror: false,
        tag: 1,
        clock: 0,
      });
    }
    sound?.own(PROBE.sound[CHARACTER] ?? PROBE.sound[0], p.x, py);
  }
}

/**
 * ...and what one fired — `0x410480`, which is three comparisons and a clamp.
 *
 * The divisor `0x4103e2` writes is ONE, so the script's own `dx` goes into the
 * velocity undivided and the clamp at `0x410486` is what stops it: 27 a frame
 * across, 23 up or down. Nothing here carries a strike box, so none of it can
 * touch the player — it is scenery with a trigger.
 */
export function stepFlypasts(): void {
  const py = p.y - p.feet;
  for (let i = flypasts.length - 1; i >= 0; i--) {
    const f = flypasts[i];
    f.clock += 1;
    if (f.tag === 0) {
      // `0x45d18c` negates the script's own dx for a mirrored object, and
      // `0x42f8b0` adds it to the velocity through the divisor — which is 1
      f.vx += PROBE.cross.dx * (f.mirror ? -1 : 1);
      f.vx = Math.max(-PROBE.maxVx, Math.min(PROBE.maxVx, f.vx));
      f.x += f.vx;
      // `0x4104d5` / `0x4104f2` — gone once it is half a screen past you
      if (
        Math.abs(f.x - p.x) > PROBE.goneX &&
        (f.mirror ? f.x < p.x : f.x > p.x)
      )
        flypasts.splice(i, 1);
      continue;
    }
    // `0x410531` — it turns to face you, and keeps whichever way it was going
    f.mirror = p.x > f.x;
    f.vy = f.vy < 0 ? -PROBE.maxVy : PROBE.maxVy;
    f.y += f.vy;
    if (Math.abs(f.y - py) > PROBE.goneY && (f.vy < 0 ? f.y < py : f.y > py))
      flypasts.splice(i, 1);
  }
}

/** which cel a flypast is showing — `0x46bdf0`'s two tags, and both of them loop */
export function flypastCel(f: Flypast): number {
  const a = f.tag === 0 ? PROBE.cross : PROBE.hover;
  return a.cels[Math.floor(f.clock / a.hold) % a.cels.length];
}

/**
 * Looking up and looking down — `0x4309f0`'s mode 1, a fixed point instead of
 * the player.
 *
 * The player's think puts the camera back on the player every frame
 * (`0x4280a2`, `0x430cb0(0)`), and two states take it off again for that frame
 * with `0x430c70(point)`:
 *
 * ```
 *   standing, W held   0x4297fe  counter [0x4ac364]++, and past 13:
 *                      0x429821  0x42fad0(player, 512, 256) — nobody near
 *                      0x42983e  x = player.x + 240, or − 240 facing left
 *                      0x42985a  y = player.y − 140
 *   ducking, S held    0x42ab5a  the same count and the same test (0x42ab81)
 *                      0x42abbe  y = player.y + 100
 * ```
 *
 * The counter is zeroed the frame the key is not held (`0x429898`, `0x42abed`)
 * and as the duck begins (`0x42a9ba`), so a look takes fifteen frames of holding
 * — a second — and ends the frame the key comes up. The step toward the point
 * is the ordinary chase with the state's own rig.
 */
export const LOOK = {
  /** `cmp ax, 0xd; jle` — the count BEFORE this frame's increment must pass 13 */
  after: 0xd,
  /** `0x42983e` / `0x42aba2`: `sbb; and 0x1e0; sub 0xf0` — ±240 by the facing */
  aheadX: 0xf0,
  up: -0x8c,
  down: 0x64,
  /** `0x42fad0(player, 0x200, 0x100)` — the box nobody may be in */
  clearW: 0x200,
  clearH: 0x100,
} as const;
export let lookFrames = 0;
export let lookWay: "up" | "down" | null = null;

/**
 * `0x42fad0(obj, w, h)` — true when no object with `obj+0x1c` set has its point
 * inside the w×h box centred on this one's. `obj+0x1c` is the census flag
 * (`0x42f870`), cleared the first frame a creature is dead, so the objects are
 * the counted creatures still alive, and Boggs' head (`0x41c591`).
 */
export function nobodyNear(x: number, y: number, w: number, h: number): boolean {
  if (!level) return true;
  const left = x - Math.trunc(w / 2);
  const top = y - Math.trunc(h / 2);
  const inside = (px: number, py: number): boolean =>
    px >= left && px <= left + w && py >= top && py <= top + h;
  for (const r of level.spawned)
    for (const e of r)
      if (inCensus(e) && inside(e.x, e.y))
        return false;
  for (const r of level.boggs)
    for (const g of r) if (!g.dying && inside(g.headX, g.headY)) return false;
  return true;
}

/** this frame's fixed point, or null to follow the player — see {@link LOOK} */
export function lookTarget(): { x: number; y: number } | null {
  const idle =
    p.onGround &&
    !p.act &&
    !p.moving &&
    !p.climbing &&
    !p.bar &&
    p.windup === 0 &&
    p.landLeft === 0;
  const way =
    idle && !p.crouching && held.up
      ? "up"
      : idle && p.crouching && held.down
        ? "down"
        : null;
  if (way !== lookWay) lookFrames = 0;
  lookWay = way;
  if (!way) return null;
  const was = lookFrames++;
  const ay = p.y - p.feet;
  if (was <= LOOK.after || !nobodyNear(p.x, ay, LOOK.clearW, LOOK.clearH))
    return null;
  return {
    x: p.x + (p.facing < 0 ? -LOOK.aheadX : LOOK.aheadX),
    y: ay + (way === "up" ? LOOK.up : LOOK.down),
  };
}

/**
 * The jolt — `0x4307c0(n)` picks one of three short tables of pixels and
 * `0x430b85` spends it last thing in the camera's frame, one entry a frame from
 * the END of the table back to its start, each added to the view corner's y
 * through `0x430820` (and clamped with it). The chase then pulls the view back
 * on its own. The rolling landing asks for 1; the heavier things — the wraith's
 * arrival, the bishop, the ox — ask for 3.
 */
export const SHAKES: readonly (readonly number[])[] = [
  [],
  [8, 0, 4], // `0x472400`, three entries (`0x4307ee` counts 2 down to 0)
  [16, 0, 8, 0, 4], // `0x472408`
  [32, 0, 16, 0, 8, 0, 4], // `0x472418`
];
export let shaking: readonly number[] = [];
export let shakeAt = -1;
export function shake(n: 1 | 2 | 3): void {
  shaking = SHAKES[n];
  shakeAt = shaking.length - 1;
}

/** `0x4309f0`, once an engine frame — decide the step, do not take it */
export function stepCamera(): void {
  if (shakeAt >= 0) {
    placeView(view.x, view.y + shaking[shakeAt]);
    shakeAt -= 1;
  }
  const t = lookTarget() ?? chaseTarget();
  const { maxDx, maxDy } = cameraRig();
  // the point and the corner are words there (`0x430a86`, `0x430ae2`)
  const ex = Math.trunc(t.x) - Math.trunc(view.x + CHASE_X);
  const ey = Math.trunc(t.y) - Math.trunc(view.y + CHASE_Y);
  camVx = Math.max(
    -maxDx,
    Math.min(maxDx, Math.trunc((ex * maxDx) / CAMERA.spanX)),
  );
  camVy = Math.max(
    -maxDy,
    Math.min(maxDy, Math.trunc((ey * maxDy) / CAMERA.spanY)),
  );
}

/** ...and spend a quarter of it each tick, clamping every time as `0x430820` does */
export function driftCamera(): void {
  if (!camVx && !camVy) return;
  placeView(view.x + camVx * TICK_SCALE, view.y + camVy * TICK_SCALE);
}

/**
 * `0x428ff6` and `0x443a3d` — the arrival scroll, one per player class.
 *
 * Both do the same two subtractions the moment the player's point is moved to a
 * new room: the corner goes to `(x - 200, y - 100)` and `0x4308a0` clamps it. It
 * is not the chase point, which would be `(x - 256, y - 116)`, and the 56 and 16
 * of difference are the engine's, not a rounding of this page's.
 */
export function snapCamera(): void {
  camVx = 0;
  camVy = 0;
  placeView(
    p.x - CAMERA.arriveX,
    (p.climbing ? p.climbY : p.y - p.feet) - CAMERA.arriveY,
  );
}

/**
 * `0x42e6a7` — where a level BEGINS, and it is not the arrival: `0x42e580` puts
 * the corner on the start point itself, `0x4308a0(x, y)`, clamped by the room.
 * Where the room lets it, the player starts in the view's top-left corner and
 * the chase brings the view round onto them over the first second.
 */
export function startCamera(x: number, y: number): void {
  camVx = 0;
  camVy = 0;
  placeView(x, y);
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
export interface Solids {
  /**
   * COPIES of the records, not the records — a `platform` can be owned by an
   * object and follow it (`0x42fcb9`, see {@link file://./props.ts}), and a plank
   * that gives way takes its floor with it.
   */
  platforms: SbkEntity[];
  obstacles: readonly SbkEntity[];
  goal: SbkEntity | undefined;
}

export interface Level {
  sbk: SbkFile;
  pal: Uint8ClampedArray;
  /** the level's own rooms, floors rasterised and doors attached */
  rooms: SbkRoom[];
  /** what stands in each room, by its index in `rooms` */
  solids: Solids[];
  /**
   * The level's ladders, ALL of them, and deliberately not filed by room.
   *
   * `0x40b940` is the engine's only entity query and it is a linear scan of the
   * whole table — `[0x46b9a8]+0x1c`, stride 48, `[+0x18]` records — with no
   * reference to a region anywhere in it. The ladder lookup is that scan with
   * kind 2, the rect-contains-point test at `0x434200`.
   *
   * Filing a ladder into the room its CENTRE falls in, which is what this page
   * did, is wrong for the thing a ladder IS. Nine ladders ship and only two of
   * them stand inside one room:
   *
   * ```
   *   STREETS   1 ladder    room 0                     works
   *   RAVECAVE  1 ladder    room 1                     works
   *   SEWER     3 ladders   two of them span 2 rooms
   *   TOWER     3 ladders   span 2, 3 and 4 rooms
   *   MAZE      4 ladders   ALL FOUR centre in NO room at all
   * ```
   *
   * MAZE's four sit in the gaps between its seven regions, so `solidsIn` filed
   * them nowhere and the level had no ladders whatever; TOWER's answered only
   * while you were already in the one room that happened to own the middle of
   * them, which for two of the three is not the room you climb from.
   */
  ladders: readonly SbkEntity[];
  /**
   * The level's monkeybars, and there is exactly one in the game — VAT's.
   *
   * Filed whole rather than by room for the same reason the ladders are: the
   * record is found by `0x40b660`, which scans the entity table and consults no
   * room at all (its region argument is 0 at `0x41243b`). See {@link MONKEYBAR}.
   */
  bars: readonly SbkEntity[];
  /**
   * The shared AI's table, narrowed to what THIS book can draw.
   *
   * A class ships one repertoire and appears in several levels, and a level
   * carries only the cels it needs: `initwerea` has ten attacks in CITY and
   * STREETS holds the art for seven of them. An attack whose cels are not in the
   * book would play as nothing at all, so it is dropped here rather than swung.
   * See {@link file://./fights.ts}.
   */
  fights: Readonly<Record<string, FoeFight>>;
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
  /** ...and its two big guns, hatch and turret in one record */
  bigguns: BigGun[][];
  /** TOWER's two halves of one fork of lightning */
  lights: LightFx[][];
  /**
   * ...and the level's `probe` records, which are the LEVEL's and not any room's.
   * `0x40b526` fills one buffer for the whole book and `0x4280d2` walks all of
   * it, so filing these by room would be filing them by the wrong thing.
   */
  probes: Probe[];
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
  draw: {
    loc: number;
    cels: number[];
    x: number;
    y: number;
    rate: number;
    /** engine frames each of `cels` is held — see {@link backdropFrames} */
    hold: number;
    mirror: boolean;
    z: number;
  }[];
  anchorX: number;
  anchorY: number;
  name: string;
}
/** the decoded frame too, for anchors */
export const frameCache = new Map<string, ShpFrame>();
export function frameOf(level: Level, loc: number): ShpFrame | null {
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

export let files: SkullFiles;
/**
 * The disc's own sound — the level's theme and the banks the handlers play from,
 * see {@link file://./sound.ts}. Null until the rip is indexed, and silent
 * whenever a browser will not start an AudioContext, so nothing here has to check
 * twice.
 *
 * ...which is why a sound's index is never rolled INSIDE `sound?.effect(...)`:
 * an optional call does not evaluate its arguments when there is no sound, so
 * the `0x434540` roll would be made in a browser and skipped headless, and the
 * two would play different games from there on. SC.EXE rolls before it calls.
 */
export let sound: Sounds | null = null;
export let level: Level | null = null;
/** the player book, shared across levels */
export let player: SbkFile | null = null;
export let playerPal: Uint8ClampedArray | null = null;
export let levelIndex = 0;
/**
 * `[0x46b204]`, the corpse time every hit handler copies on a death — the
 * file's 50 ({@link CORPSE_LINGER}) until the first ox is made, when
 * `0x435c73` writes 80 over it for the rest of the run.
 */
export let corpseFrames = CORPSE_LINGER;
/** ?clock=, in engine frames, for the first level only */
export let startTicks: number | null = null;

export const p = {
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
  /** `player+0x18` is 15, INV's state (`0x428975`) — see {@link stepInv} */
  inv15: false,
  /** ...or the idle it hands you to while INV is down, which goes straight back */
  invLoop: false,
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
  /** the record you are on — `0x4ac3a0`, copied once by the grab and never re-asked */
  ladder: undefined as SbkEntity | undefined,
  /** the world y of the anchor the climb cels hang from, while on a ladder */
  climbY: 0,
  /**
   * The monkeybar being hung from, and where along it — see {@link MONKEYBAR}.
   *
   * `barHold` is a handhold counted from the record's `left` in its own `param`
   * exactly as a rung is counted from a ladder's `top`, `barTag` is which of
   * `0x472048`'s five tags is playing, and `barClock` counts engine frames into
   * it. The record itself is `0x4ac3a0`, copied once by the grab.
   */
  bar: undefined as SbkEntity | undefined,
  barHold: 0,
  barTag: 0,
  barClock: 0,
  /**
   * How far the feet are below the ANCHOR in the pose showing now — see
   * {@link poseFeet}. `p.y` is the feet, the engine's `y` is the anchor, and this
   * is the difference; it changes when the pose does, and `p.y` is converted with
   * it so the anchor never jumps.
   */
  feet: 90,
  /** the one-shot action playing, and how far into it, in engine frames */
  act: null as string | null,
  actClock: 0,
  /**
   * Which tag of the dying script `0x4721a0` is playing: 0, which every death
   * but one installs, or 3 — the lightning's (`0x42f3d4`), which jerks
   * through two shock cels before the fall. See {@link actOf}.
   */
  dyingTag: 0 as 0 | 3,
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
  /**
   * `[0x46b1b4]` clear — something is carrying him and its own cels draw him,
   * so `0x402980` is skipped (`0x419d25`): kragg's fist, the eyeball, the
   * skeleton's grip. Collision does not ask.
   */
  hidden: false,
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
  /** pixels fallen this flight — past 360 the tuck becomes the flail (0x4284ba) */
  fallPx: 0,
  /**
   * In the flail — kind 25, `0x472350`, which the state machine's preamble
   * forces on a fall past 360 ({@link PlayerAnim.flail}).
   */
  flail: false,
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
  /**
   * Off a ledge WITHOUT a jump, and so still in a ground state: `0x42999e` has
   * the walk state install the idle's tag 1 the frame there is no floor, and
   * `0x429bf0` the run its own tag 1. Neither the idle (`0x429690`) nor the run
   * (`0x429b80`) asks for a floor before it reads J, P or K, so a fall off an
   * edge can still jump — the launch's -35 on top of the fall — and still
   * punch and kick, with the ground's moves rather than the flight's. The
   * flail ends it at a fall of 360, as it ends everything.
   */
  fallState: null as "idle" | "run" | null,
};
/** `mov word ptr [0x4723f0], 2` — the allowance, and it is 2 in all eight places */
export const HOLD_FRAMES = 2;

/**
 * What a blow does to the PLAYER — read out of `SC.EXE`, and **off by default**.
 *
 * Everything in this block is the engine's, and none of it runs unless the switch
 * below is thrown. The reason is the levels: with damage on, a probe walking east
 * through WOODS meets three hydraulic presses and every route test in this repo
 * becomes a fight. So it ships ready and dark, and `?damage=1` or Shift+H
 * turns it on.
 *
 * The numbers:
 *
 * ```
 *   448ac2  max = trunc(difficulty * 600.0) + 0x4b0    ; 1200 at difficulty 0
 *   4490d5  di = 0x42f910(hitter)                      ; sqrt(blowX² + blowY²)
 *   449115  cmp di, 0x3c                               ; 60: stagger or knockdown
 *   44911b  0x448bf0()                                 ; ...and a knockdown disarms you
 *   449146  0x45b060(weapon, point, facing, cel)        ; the gun goes on the floor
 *   44914b  [0x479438] = 0                             ; and your hands are empty
 *   449209  0x402ac0(di)                               ; and the damage IS di
 *   402ad8  health floors at 0, and 0x402fa0(1) starts the dying script
 * ```
 *
 * And the fall, which is its own path (`0x443c2b`) and takes no blow at all:
 * past 360 of accumulated drop the player is cut into the flail, and on landing
 * past 530 it is simply death, under that a flat ten and a roll.
 */
export const HURT = {
  /** `0x448ad1` at difficulty 0 — the middle of 1800 / 1200 / 600 */
  max: 1200,
  /** `0x448ac2`'s own arithmetic: `trunc(d * 600) + 0x4b0` */
  maxAt: (d: number): number => Math.trunc(d * 600) + 0x4b0,
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
export let damageOn = QUERY.get("damage") === "1";

/**
 * ...and whether a CREATURE's blow is one of the things it may spend — `?foehit=1`,
 * and off even when {@link damageOn} is on.
 *
 * The enemy strike boxes have been read and wired the whole time (the loop in
 * {@link takeHits} that walks `spawnedHere()`), but until {@link stepFight} no
 * creature in the game ever came close enough to use one, so the switch above
 * only ever let the presses, the girders and the current through. Bringing the
 * shared AI in makes that loop live, and the brief for it was the behaviour and
 * NOT the damage — so the creature half gets a switch of its own and it starts
 * off. Everything else the switch above arms is unchanged.
 */
export let foesHurt = QUERY.get("foehit") === "1";

/**
 * `?foes=0` — the level with its creatures left out, and it is the page's, not
 * the game's: a suite that measures a lift or a press wants the machine alone,
 * and a punk put down on the same landing shoves the player off it
 * ({@link bodyPush}), exactly as the original would.
 */
export let foesOff = QUERY.get("foes") === "0";

/**
 * How hard — `0x46b20c`, and the preferences panel is what sets it.
 *
 * It was written down here once that nothing writes this word and that the
 * difficulty is therefore always zero. Three instructions say otherwise:
 * `0x45d788`, `0x45d79b` and `0x45d7ae` store **1, 0 and -1**, and they are the
 * three little boxes the prefs panel draws at `0x4791d8`, `0x4791e0` and
 * `0x4791e8` (see `src/main.ts`). What the number does:
 *
 * ```
 *   448ac2  max health = trunc(d * 600) + 0x4b0      1800 / 1200 / 600
 *   40e300  scale(n)   = n - (n / 2) * d             half a blow / n / half again
 * ```
 *
 * so **+1 is EASY**: more health and softer blows. Zero unless the front end
 * says otherwise, which is what it was before — the default and not the only
 * value.
 */
const difficultyOf = (q: URLSearchParams): -1 | 0 | 1 => {
  const n = Number(q.get("difficulty") ?? 0);
  return n === 1 || n === -1 ? n : 0;
};
export let DIFFICULTY = difficultyOf(QUERY);

/**
 * A new set of switches, for a headless run that stands the game up again in
 * the same process — every switch read at load is read again. The page never
 * calls it: its switches are its address bar's, once.
 */
export function setQuery(query: string): void {
  QUERY = new URLSearchParams(query);
  useCharacter(QUERY.get("char") === "1" ? 1 : 0);
  damageOn = QUERY.get("damage") === "1";
  foesHurt = QUERY.get("foehit") === "1";
  foesOff = QUERY.get("foes") === "0";
  DIFFICULTY = difficultyOf(QUERY);
}

/**
 * `0x40e300(n)` — `n - (n/2) * [0x46b20c]`, and what it scales is what the
 * LEVELS BUILD rather than what the player takes.
 *
 * It is called from the class constructors — Boggs' own four thousand
 * (`0x41be84`, `0x40e300(0xfa0)`) and his two machines' three (`0x41b474`,
 * `0x40e300(0xbb8)`) among them — and from nowhere in either player's hit
 * handler. The player's end of the difficulty is the max health at `0x448ac2`
 * instead. At zero this is the identity, which is why it can be applied
 * everywhere without moving a single number that was already measured.
 */
export function scaled(n: number): number {
  return n - Math.trunc(n / 2) * DIFFICULTY;
}
export const held = {
  left: false,
  right: false,
  up: false,
  down: false,
  jump: false,
  punch: false,
  kick: false,
  inv: false,
};
/**
 * The two edges: a door is entered by PRESSING up, and a jump by pressing jump.
 * Holding neither repeats.
 */
export let upPressed = false;
export let jumpPressed = false;
/** the attacks fire on the press too: holding K should not machine-gun kicks */
export let punchPressed = false;
export let kickPressed = false;

/**
 * `[0x46b1d4]` — does a key reach the player at all.
 *
 * `0x402be0` is the one place a key becomes an action (the window procedure's
 * two callers, `0x428090` and `0x442ae0`, hand it the action number), and it
 * opens `cmp word ptr [0x46b1d4], 0; je` — ret — so while the word is 0 a key
 * going down sets nothing and a key coming up clears nothing. `0x402e30(n)`
 * writes the word and falls into `0x402db0`, which zeroes all eight action
 * words ({@link dropKeys}). Its only two callers are the craft's think: `(0)`
 * the frame the screen starts down (`0x410702`) and `(1)` once the tally has
 * run (`0x410754`). `0x402df0` — the same eight zeroes with the word set to 1
 * — is what the player's own set-up calls (`0x42e583`, `0x448a93`), so every
 * level starts with the keys open.
 */
export let inputOpen = true;

/**
 * `0x402db0` — the eight action words, `0x4ac3d2` … `0x4ac386`, all zeroed: every
 * key held is let go and every edge not yet spent is thrown away.
 */
export function dropKeys(): void {
  for (const k of Object.keys(held) as (keyof typeof held)[]) held[k] = false;
  upPressed = false;
  jumpPressed = false;
  punchPressed = false;
  kickPressed = false;
}

/** `0x402e30(open)` — the word, then `0x402db0` */
export function setInput(open: boolean): void {
  inputOpen = open;
  dropKeys();
}

export async function loadLevel(index: number): Promise<void> {
  // a level loaded in the middle of the red is a level with its own palette
  // back (`0x402860` reads the CLUTs afresh): the death that was playing is over
  if (deathRed) {
    deathRed = null;
    advancing = false;
  }
  const name = LEVEL_ORDER[index];
  ui.status(`loading ${name}…`);
  const bytes = await files.load(`${name}.sbk`);
  if (!bytes) {
    ui.status(`${name}.sbk is not in this rip`);
    return;
  }
  const sbk = readSbkFile(bytes);
  const pal = paletteToRGBA(sbk.paletteRaw!, 256);
  const rooms = readRooms(sbk);
  const solids = rooms.map((r) => solidsIn(sbk, r));
  const start = pickStart(sbk);
  // the record's own point, which `0x42e603` writes into `obj+6` whole
  const anchorX = start ? start.pointX : 0;
  const anchorY = start ? start.pointY : 0;
  // planks before lifts: both OWN a platform record and a record has one owner,
  // so the planks claim theirs first and the lifts are told what is already spoken for
  const planks = rooms.map((r, i) => planksIn(sbk, r, solids[i]));
  drips = [];
  roaches = [];
  levelClock = 0;
  backdropFrames = 0;
  // `0x42e5fa` — the respawn index starts on the level's first `initplayer`
  spawnIndex = 0;
  flashColour = -1;
  flypasts = [];
  columns = new Map();
  raised = new Set();
  flares = [];
  bolts = [];
  streams = [];
  feathers = [];
  casts = [];
  skates = [];
  rollers = [];
  cans = [];
  heads = [];
  flames = [];
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
  // `0x448bc7` — and every level opens on the idle `0x475c88`, kind 0, whatever
  // you carried in from the last one: the gun waits for INV
  inv.drawn = false;
  p.inv15 = p.invLoop = false;
  level = {
    sbk,
    pal,
    rooms,
    solids,
    ladders: sbk.entities.filter((e) => e.isEntity && e.name === "ladder"),
    bars: sbk.entities.filter((e) => e.isEntity && e.name === "monkeybar"),
    fights: Object.fromEntries(
      Object.entries(FIGHTS).map(([kind, f]) => [
        kind,
        {
          ...f,
          close: f.close?.cels.every((id) => sbk.byId.has(id))
            ? f.close
            : undefined,
          attacks: f.attacks.filter((a) =>
            a.cels.every((id) => sbk.byId.has(id)),
          ),
        },
      ]),
    ),
    spawned: ((claimed: Set<SbkEntity>) =>
      rooms.map((r) => spawnIn(sbk, r, claimed)))(new Set<SbkEntity>()),
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
    pipes: rooms.map((r) =>
      placed(sbk, r, "initpipe", PIPE.mouth.cels, (e) => ({
        x: e.pointX,
        y: e.pointY,
        mirror: e.param < 0,
        clock: 0,
      })),
    ),
    sewage: rooms.map((r) =>
      placed(sbk, r, "initsewage", [], (e) => ({
        top: e.top,
        left: e.left,
        bottom: e.bottom,
        right: e.right,
        clock: SEWAGE.gulpEvery,
      })),
    ),
    bushes: rooms.map((r) =>
      placed(sbk, r, "initbush", BUSH.idle.cels, (e) => {
        // `0x435ba0`, once for the bush and — `param` 1, `0x435b30` — once more
        // for the partner that sits on it
        const make = (variant: 0 | 1, partner?: Bush): Bush => ({
          x: e.pointX,
          y: e.pointY + BUSH.below,
          restY: e.pointY + BUSH.below,
          top: e.pointY,
          left: e.left,
          right: e.right,
          wait: roll(5) + 10,
          mirror: roll(2) === 2,
          state: "idle",
          phase: 0,
          clock: 0,
          variant,
          partner,
        });
        const bush = make(0);
        return e.param === 1 ? [bush, make(1, bush)] : [bush];
      }).flat(),
    ),
    nests2: rooms.map((r) =>
      placed(sbk, r, "initroachmotel", ROACH.run.cels, (e) => ({
        x: e.pointX,
        y: e.pointY,
        top: e.top,
        left: e.left,
        bottom: e.bottom,
        right: e.right,
        clock: -17,
        made: 0,
      })),
    ),
    sprinklers: rooms.map((r) =>
      placed(sbk, r, "initsprinkler", SPRINKLER.rise.cels, (e) => ({
        x: e.pointX,
        y: e.pointY,
        slot: e.param,
        top: e.top,
        left: e.left,
        bottom: e.bottom,
        right: e.right,
      })),
    ),
    pickups: rooms.map((r) => pickupsIn(sbk, r)),
    guns: rooms.map((r) => gunsIn(sbk, r)),
    holes: rooms.map((r) =>
      placed(sbk, r, "initgrave", [HOLE.shut], (e) => ({
        x: e.pointX,
        y: e.pointY,
        top: e.top,
        left: e.left,
        bottom: e.bottom,
        right: e.right,
        state: "shut" as const,
        clock: 0,
      })),
    ),
    axes: rooms.map((r) =>
      placed(sbk, r, "initswingaxe", [AXE.swing[0]], (e) => ({
        x: e.pointX,
        y: e.pointY,
        clock: 0,
      })),
    ),
    floors: rooms.map((r) =>
      placed(sbk, r, "initfloor", [FLOOR.whole], (e) => ({
        x: e.pointX,
        y: e.pointY,
        top: e.top,
        left: e.left,
        bottom: e.bottom,
        right: e.right,
        state: "whole" as const,
        clock: 0,
      })),
    ),
    surges: rooms.map((r) =>
      placed(sbk, r, "initsurge", SURGE.arc.cels, (e) => ({
        // `0x41ec66` / `0x41ec6a`: the object stands at the rect's top-left
        x: e.left,
        y: e.top,
        top: e.top,
        left: e.left,
        bottom: e.bottom,
        right: e.right,
        clock: 0,
        on: false,
        mirror: e.param !== 0,
      })),
    ),
    cages: rooms.map((r) =>
      placed(sbk, r, "initcagedoor", [CAGE.shut], (e) => ({
        x: e.pointX,
        y: e.pointY,
        top: e.top,
        left: e.left,
        bottom: e.bottom,
        right: e.right,
        // a door's own number is the absolute value; SEWER's five are filed the
        // same way and MAZE's seven run 1, 2, -2, 3, 4, -4, 4
        param: Math.abs(e.param),
        state: e.param < 0 ? ("open" as const) : ("shut" as const),
        clock: 0,
      })),
    ),
    alarms: rooms.map((r) =>
      placed(sbk, r, "initalarm", [ALARM.quiet], (e) => ({
        x: e.pointX,
        y: e.pointY,
        param: e.param,
        clock: 0,
      })),
    ),
    // `0x4115b0` — one record, two objects, and the turret starts home ten
    // pixels above the point the hatch sits on
    bigguns: rooms.map((r) =>
      placed(
        sbk,
        r,
        "initbiggun",
        [BIGGUN.hatch.shut, BIGGUN.unfold.cels[0]],
        (e) => ({
          x: e.pointX,
          y: e.pointY,
          top: e.top,
          left: e.left,
          bottom: e.bottom,
          right: e.right,
          state: "wait" as const,
          clock: 0,
          gunY: e.pointY - BIGGUN.turretUp,
          shot: 0,
          hatch: 0,
          hatchClock: 0,
        }),
      ),
    ),
    // `0x40b526` — one buffer for the book, and `0x4280d2` walks the whole of it
    probes: sbk.entities
      .filter((e) => e.isEntity && e.name === "probe")
      .map((e) => ({
        top: e.top,
        left: e.left,
        bottom: e.bottom,
        right: e.right,
        mode: e.param,
        fired: false,
      })),
    // `0x4268c0` — and these stand up on their own clock, not on anything you do
    lights: rooms.map((r) =>
      placed(sbk, r, "initlightfx", LIGHTFX.bolt.cels, (e) => ({
        x: e.pointX,
        y: e.pointY,
        mirror: e.param < 0,
        clock: -1,
      })),
    ),
    belts: rooms.map((r) => [
      ...placed(sbk, r, "initbeltleft", BELT.roll.cels, (e) => ({
        x: e.pointX,
        y: e.pointY,
        top: e.top,
        left: e.left,
        bottom: e.bottom,
        right: e.right,
        dir: -1 as const,
        param: e.param,
        clock: 0,
      })),
      ...placed(sbk, r, "initbeltright", BELT.roll.cels, (e) => ({
        x: e.pointX,
        y: e.pointY,
        top: e.top,
        left: e.left,
        bottom: e.bottom,
        right: e.right,
        dir: 1 as const,
        param: e.param,
        clock: 0,
      })),
    ]),
    chairs: rooms.map((r) =>
      placed(sbk, r, "initchair", CHAIR.runs[0].cels, (e) => ({
        x: e.pointX,
        y: e.pointY,
        run: 0,
        clock: 0,
      })),
    ),
    claws: rooms.map((r) =>
      /**
       * It hangs at the record's POINT, ten pixels to the left of it.
       *
       * ```
       *   411cfd  mov dword ptr [eax+6], ecx    ; the point, Y and X together
       *   411d02  sub word ptr [ebx+8], 0xa     ; ...and ten off the X
       * ```
       *
       * This page hung it at the record's rect BOTTOM instead, and the reason it
       * had to was a bug in {@link strikeOf}: every prop's strike box was being
       * lifted by `height - posY`, so the only way to make a claw reach anybody
       * was to drop the claw by about as much. `bottom - point` is 113, 136, 115
       * and 177 across BARREL's four, and the lift is 76..127 — close enough to
       * work and never the same number, which is what a compensation looks like.
       *
       * With the box translated the way `0x40e680` translates it, the point is
       * enough: BARREL's fourth claw closes 34 pixels into a player standing
       * under it. Its other two hang 450 and 780 above their own floor and
       * reach nobody from either y.
       */
      placed(sbk, r, "initclaw", CLAW.running.cels, (e) => ({
        x: e.pointX - CLAW.leftBy,
        y: e.pointY,
        left: e.left,
        right: e.right,
        state: "idle" as const,
        clock: 0,
      })),
    ),
    fittings: rooms.map((r) => {
      /**
       * Filed by the middle of their RECT rather than by their point. VAT's
       * four floor showers stand thirty pixels under the floor, below the
       * bottom of the region they spray into, and the point is only where the
       * grate is drawn; `0x40b940` puts each in a region all the same, and it
       * thinks with the rest (`0x41a2a0`).
       */
      const mine = (e: SbkEntity): boolean => {
        const cx = (e.left + e.right) / 2;
        const cy = (e.top + e.bottom) / 2;
        return cx >= r.left && cx <= r.right && cy >= r.top && cy <= r.bottom;
      };
      const fitted = (e: SbkEntity, kind: Fitting["kind"]): Fitting => ({
        kind,
        // the think writes the record's point into `obj+6` every frame
        // (`0x41a2b6`, `0x41a7ec`); the −100 floor offset only moves the foot
        // the mover measures, and with no weight and no speed that is never
        // near a floor
        x: e.pointX,
        y: e.pointY,
        clock: 0,
        left: e.left,
        right: e.right,
        top: e.top,
        bottom: e.bottom,
        // `0x4117f7`: 1 when the point is nearer the rect's bottom
        tag: e.bottom - e.pointY < e.pointY - e.top ? 1 : 0,
        phase: "idle",
      });
      const art = (a: readonly { cels: readonly number[] }[]): boolean =>
        a.every((x) => x.cels.every((id) => sbk.byId.has(id)));
      const F = FITTING;
      return [
        ...(art([...F.shower.idle, ...F.shower.spray])
          ? sbk.entities.filter((e) => e.isEntity && e.name === "initshower" && mine(e)).map((e) => fitted(e, "shower"))
          : []),
        ...(art([F.ball.idle, F.ball.out, F.ball.back])
          ? sbk.entities.filter((e) => e.isEntity && e.name === "initball" && mine(e)).map((e) => fitted(e, "ball"))
          : []),
        ...placed(sbk, r, "initteeth", [FITTING.teeth.cel], (e) => fitted(e, "teeth")),
      ];
    }),
    boggs: rooms.map((r) =>
      placed(sbk, r, "initboggsbody", BOGGS.idle.cels, (e) => ({
        x: e.pointX,
        y: e.pointY,
        clock: 0,
        hp: scaled(BOGGS.health),
        lunge: null,
        vx: 0,
        // `0x4122fa`: the record's rect, whose two x `0x41bb40` clamps the body to
        span: [e.left, e.right] as [number, number],
        // `0x411ed0`: eight objects at eight offsets from the body, and it runs
        // again every frame ({@link placeBoggs})
        machines: BOGGS.machines.map((m) => ({
          x: e.pointX + m.dx,
          y: e.pointY + m.dy,
          clock: 0,
          hp: "health" in m ? scaled(m.health) : 0,
          wrecked: false,
          wreckClock: -1,
        })),
        // `0x46e080` and `0x46e084`, both `01 00` in `.data`
        flags: [true, true] as [boolean, boolean],
        headClock: 0,
        headTag: 0,
        snap: 0,
        dying: false,
        // `[0x46e0b0]` is a `.data` word and `.data` words start at zero, so
        // the first eligible frame throws and the roll only spaces the rest
        throwWait: 0,
        throwDrop: 0,
        worms: [],
        warned: false,
        // `0x41ac7f` — one record, read once, and every worm is kept inside it
        bounds: wormBounds(sbk, r),
        boundsOff: boundsAgainst(wormBounds(sbk, r), e),
        // the head has a record of its own, and `0x412364` stores the offset it
        // lands at; `0x41c4c0` re-places it at body + that offset every frame
        ...headAndArm(sbk, r, e),
        // the first machine on `0x46e4d0`, at the body itself until it sweeps
        zap: { kind: 0 as const, tag: 0, clock: 0, dy: 0, dx: 0, armed: false, taunted: false },
      })),
    ),
    fans: [
      ...rooms.map((r) => [
        // `0x415304`: created on tag 0 with the counter at 40 (`0x411b38`)
        ...placed(sbk, r, "inithfan", [FAN.h.stopped], (e) => ({
          x: e.pointX,
          y: e.pointY,
          horizontal: true,
          state: "suck" as const,
          clock: 0,
          count: FAN.first,
          top: e.top,
          left: e.left,
          bottom: e.bottom,
          right: e.right,
          param: e.param,
        })),
        ...placed(sbk, r, "initvfan", [FAN.v.stopped], (e) => ({
          x: e.pointX,
          y: e.pointY,
          horizontal: false,
          state: "suck" as const,
          clock: 0,
          count: FAN.first,
          top: e.top,
          left: e.left,
          bottom: e.bottom,
          right: e.right,
          param: e.param,
        })),
      ]),
    ],
    bridges: rooms.map((r) =>
      placed(sbk, r, "initbridge", [BRIDGE.whole], (e) => ({
        x: e.pointX,
        y: e.pointY,
        homeY: e.pointY,
        top: e.top,
        left: e.left,
        bottom: e.bottom,
        right: e.right,
        state: "whole" as const,
        stood: 0,
        clock: 0,
      })),
    ),
    hands: rooms.map((r) =>
      placed(sbk, r, "inithand", HAND.underfoot.up.cels, (e) => ({
        x: e.pointX,
        y: e.pointY,
        top: e.top,
        left: e.left,
        bottom: e.bottom,
        right: e.right,
        // `0x420cc4` — the record's own param, not a roll
        underfoot: e.param === 0,
        atX: e.pointX,
        atY: e.pointY,
        state: "down" as const,
        clock: 0,
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
        // sequence for the lamp (2360,2361,2362)
        cels: q.frameIds
          .map((id) => sbk.byId.get(id) ?? -1)
          .filter((l) => l >= 0),
        x: q.x,
        y: q.y,
        rate: placementRate(q),
        // `0x40c165`: an animated placement becomes an object whose script
        // header's hold (`script+2`, which `0x45d168` reloads every cel) is the
        // record's word at +0xa — the integer part of what `SbkPlacement` reads
        // as `parallax` (bytes +9..+11 over 256). 1 to 18 frames on the disc.
        hold: Math.max(1, q.hold),
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
  ui.levelShown(index);
  // the quota, the engine's own way round: count what was just spawned, then
  // take this stage's share off it (see src/mission.ts). The census counts only
  // the things that can claim the panel's bar, which is the same set the engine
  // counts — furniture never calls `0x40d1c0` and is not part of anyone's quota.
  stats.census =
    level.spawned.reduce(
      (n, r) => n + r.filter((e) => FOES[e.kind].counts).length,
      0,
    ) +
    // ...and Boggs, whose HEAD is the census entry: `0x41c591` is
    // `0x42f870(head, 1)` and the body is not registered at all. VAT spawns no
    // creatures, so without this its quota is zero of zero and the level can be
    // walked to its goal without touching the thing the chapter is named for.
    level.boggs.reduce((n, r) => n + r.length, 0);
  stats.allowance = allowanceFor(mission(), stats.census);
  // `0x448ad8` fills it on the way in, and `0x402760` does the same on a respawn
  stats.health = stats.maxHealth;
  // ?clock= starts the mission clock short, which is the only way to reach the
  // last two minutes of an eight-minute dial from a test. It is spent on the
  // first level it is given to, so a timed-out level does not time out again.
  stats.clockFull = clockFor(sbk);
  stats.ticks = startTicks ?? stats.clockFull;
  startTicks = null;
  stats.shown = null;
  goalOpen = false;
  // `0x437020` / `0x43d440`, `0x41fa0c` / `0x421fa0`, `0x412cfb` / `0x4165ac`
  bossDown.hardcore = bossDown.belfry = bossDown.lab = false;
  leftGoal = false;
  craft = null;
  // `0x448a93` / `0x42e583` — the player's set-up opens the keys (`0x402df0`)
  setInput(true);
  gobs = [];
  pops = [];
  sparks = [];
  dropAt(roomAt(anchorX, anchorY), anchorX, anchorY);
  // `0x42e580`: the corner goes on the start point itself, not the arrival's
  startCamera(anchorX, anchorY);
  // `0x4036ff` — and the dice start over, on the constant every level uses,
  // once its things have been made: see {@link file://./random.ts}
  seedRandom();
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
export function goalReady(): boolean {
  // RAVECAVE's and TOWER's cases ask the flag and NOT the count (`0x4219e5`,
  // `0x421a38`): what a split or a summon adds to the room is not counted
  const n = mission().number;
  const counted = n === 11 || n === 12 || aliveNow() <= stats.allowance;
  if (counted && !waitsFor()) goalOpen = true;
  return goalOpen;
}

/**
 * The goal's second condition — a kill the count does not stand for.
 *
 * Three of the four chapter end tests switch on the stage and, for some stages,
 * ask a flag besides (or instead of) the census:
 *
 * - SERVICE, level 6: `0x43b950`'s second case asks `[0x472574]` after the
 *   count (`0x43b9ec`), and only `inithardcore`'s death writes it
 *   (`0x43d309`) — so the goal waits for that one kill however far the count
 *   has gone.
 * - RAVECAVE and TOWER, levels 11 and 12: `0x421900`'s third and fourth cases
 *   (`0x4219e5`, `0x421a38`) ask `[0x46ece0]` and NOTHING else — their
 *   allowance is the census, see {@link MISSIONS}. The named wraith's fatal
 *   blow writes it (`0x4250eb`) and so does the bishop's (`0x426600`).
 * - LAB and VAT, levels 15 and 16: `0x415f50`'s third and fourth cases ask
 *   `[0x46bfbc]` after the count (`0x416047`, `0x4160a8`). The test tube's
 *   fatal blow writes it (`0x419ac9`) and so does Boggs going down
 *   (`0x41bdd8`).
 *
 * Every flag is cleared as its chapter's level begins (`0x437020`, `0x41fa0c`,
 * `0x412cfb` and their siblings). Answers what is still standing, or null.
 */
export function waitsFor(): string | null {
  const n = mission().number;
  if (n === 6 && !bossDown.hardcore) return "HARDCORE";
  if (n === 11 && !bossDown.belfry) return "the wraith";
  if (n === 12 && !bossDown.belfry) return "the bishop";
  if (n === 15 && !bossDown.lab) return "the test tube";
  if (n === 16 && !bossDown.lab) return "Boggs";
  return null;
}

/**
 * The three flags {@link waitsFor} reads: `[0x472574]` (`hardcore`),
 * `[0x46ece0]` (`belfry`) and `[0x46bfbc]` (`lab`).
 */
export const bossDown = { hardcore: false, belfry: false, lab: false };

/**
 * Has the player left the world? CITY is why this exists.
 *
 * Its ground is a ledge and then y7250 for the rest of the level, {@link
 * PIT_DEPTH}'s comment has the numbers, and landing on it put the player 2900px
 * below anything CITY draws with no way back. A room's rect is the world; more
 * than a shaft's depth below it, you are falling out of the level.
 *
 * This line is the port's: `SC.EXE` has no test like it. The mover clamps
 * nothing at a region's bottom (`0x430030` only hands the object on to a region
 * below), and the CITY fall ends on y7250 with the landing's own fatal-fall test
 * (`0x443c82`). It stays as the backstop for a floor that runs out under a
 * falling player, where the page would otherwise fall for ever.
 */
export function fellOut(): boolean {
  return !!p.room && p.y > p.room.bottom + PIT_DEPTH;
}

/**
 * Fell out: one of the seven KILL films, a life, and — when it was the last one
 * — the high-score board and the front door.
 *
 * `0x403340` is the state the seven vignettes belong to, and what it does after
 * the film is the whole of the game's ending:
 *
 * ```
 *   4033ca  0x40e990(KILLn.MOV)      ; one of seven, 0x434540(7)
 *   4033d9  ax = [0x46b20c]          ; the difficulty
 *   4033e3  0x40d4d0(ax)             ; ...and the score, [0x4a4f00]
 *   4033e9  0x40f650(score, ax)      ; offer it to that difficulty's ten rows
 *   4033ee  cx = 1                   ; and the shell goes back to the menu
 * ```
 *
 * So the board is not a menu button and it is not on the death screen: it is
 * what a finished game writes to, and the title film is where you read it. See
 * {@link file://./scores.ts}.
 *
 * And the film is the LAST life's, not every life's. The life is spent as the
 * dying animation ends, and the test comes after the body has lain there:
 *
 * ```
 *   4293eb  0x40d400(0x40d490() - 1)   ; [0x4a4d64], the lives, spent
 *   429454  state 27, and [0x4ac364] = 25 frames, or 40 with a creature within
 *           256 (0x42fad0(player, 512, 512))
 *   4294a6  0x429490 counts [0x4ac364] down, and once it is below zero:
 *   4294cb  0x40d490() < 0 ?  [0x4abdfe] = 9    ; state 9, 0x403340's vignette
 *   4294fb                 :  0x402760          ; back at the checkpoint
 * ```
 *
 * So a game over is the lives going BELOW zero: three on the panel is four
 * deaths, the last with no skull left to show. And the ordinary death does not
 * restart anything — `0x402760` moves the player and leaves the level exactly as
 * it was: see {@link respawn}.
 */
export async function died(): Promise<void> {
  if (advancing) return;
  advancing = true;
  stats.lives -= 1;
  // what reached here without the dying script lies still in it for the red:
  // `0x402fa0` puts every death through a kind-26 script, and this page plays
  // only the blow's
  if (p.act !== "dying") {
    p.act = "dying";
    p.actClock = Math.max(0, (actOf("dying")?.cels.length ?? 1) - 1) * (actOf("dying")?.hold ?? 1);
    p.vx = 0;
  }
  deathRed = { step: 0, hold: -1 };
}

/**
 * The red — what the screen does between a death and the checkpoint, and all
 * of it is `0x429392`, the dying state's handler, the frame its script ends.
 *
 * ```
 *   4293eb  0x40d400(0x40d490() - 1)            ; the life, spent
 *   429404  for step = 1 .. 50:
 *   429425    0x434680(firstredclut, redclut, step, 50)
 *   42942d    spin until 0x4087c0 has moved on  ; one sixtieth a step
 *   429454  state 27, and [0x4ac364] = 25 frames, or 40 if 0x42fad0 finds a
 *           creature in the 512x512 round the player
 *   4294a6  0x429490 counts it down, and once it is below zero:
 *   4294c3  0x434bf0([0x4a8960])                ; the level's own palette back
 *   4294cb  lives < 0 ? state 9, the vignette  :  0x402760, the checkpoint
 * ```
 *
 * The two CLUTs are `SC.EXE`'s own resources, `RAW/CLUT.FIRSTREDCLUT` and
 * `RAW/CLUT.REDCLUT` (`0x402860` loads them by those names at level start).
 * The first is 256 entries of pure red; the second is the Mac system palette
 * every level draws with, red channel kept and green and blue zeroed. So the
 * fade is: the frozen frame goes solid red, and over fifty sixtieths its red
 * channel comes back up through it — `0x434680` blends each 16-bit component
 * `a + (b - a) * step / 50`, truncated — and the world then runs on in red for
 * the hold. The loop at `0x429404` BLOCKS: nothing moves while it fades.
 */
export const DEATH_RED = {
  /** `mov esi, 0x32` at `0x4293e6`, one step per sixtieth */
  steps: 50,
  /** `0x429476` and `0x429485`: engine frames of state 27 */
  holdClear: 25,
  holdNear: 40,
  /** `0x42fad0(player, 0x200, 0x200)` at `0x429465` */
  box: 0x200,
} as const;

/** the red in progress: `step` counts the fade's sixtieths, `hold` state 27's frames */
export let deathRed: { step: number; hold: number } | null = null;

/**
 * One pixel under the red, at fade step `step` (50 and over is the finished
 * `REDCLUT`). Entries 0 and 255 are black and white in every level palette and
 * `0x434bf0` writes them so again, so those two stay as they are; everything
 * else is its own red channel, blended up from pure red. Only the red comes
 * back because in both CLUTs green and blue are nought.
 */
export function reddened(r: number, g: number, b: number, step: number): [number, number, number] {
  if ((r | g | b) === 0 || (r & g & b) === 255) return [r, g, b];
  if (step >= DEATH_RED.steps) return [r, 0, 0];
  const from = 0xffff;
  const to = r * 257;
  return [(from + Math.trunc(((to - from) * step) / DEATH_RED.steps)) >> 8, 0, 0];
}

/** the red, a frame at a time — frozen through the fade, then state 27's hold */
function stepDeathRed(frame: boolean): boolean {
  if (!deathRed) return false;
  if (deathRed.step < DEATH_RED.steps) {
    deathRed.step += 1;
    if (deathRed.step === DEATH_RED.steps)
      deathRed.hold = nobodyNear(p.x, p.y - p.feet, DEATH_RED.box, DEATH_RED.box)
        ? DEATH_RED.holdClear
        : DEATH_RED.holdNear;
    return true;
  }
  // `0x4294a6`: the count before the decrement, so 25 is 26 frames of it
  if (frame && deathRed.hold-- < 0) void deathOver();
  return false;
}

/** `0x4294c3` on: the palette back, and the vignette or the checkpoint */
async function deathOver(): Promise<void> {
  deathRed = null;
  if (stats.lives < 0) {
    await ui.film(DEATH_FILMS[Math.floor(random() * DEATH_FILMS.length)]);
    ui.gameOver(stats.score, levelIndex + 1, DIFFICULTY);
    return;
  }
  respawn();
  restoreBoards();
  advancing = false;
}

/**
 * `0x402760` — back at the checkpoint, with the level as it was left.
 *
 * ```
 *   402769  health = [0x4ac3d8]                 ; the whole bar again
 *   402784  0x42f850(player, 1.0)               ; gravity back on
 *   4027a8  point = initplayer[[0x4ac38a]].point
 *   4027b8  obj+0x16 = -1, then 0x4308a0(point) ; the corner on the point, unclamped
 *   4027eb  obj+0x16 = 0x40b940(2, point)       ; and the region found again
 *   402803  vx = vy = 0, facing right (obj+0x28 = 0), obj+0x32 = 0
 * ```
 *
 * `[0x4ac38a]` is {@link spawnIndex}: zero as the level begins (`0x42e5fa`), and
 * the debug key's cycle is the same respawn with it stepped (`0x402cfe`).
 * Nothing else is touched — the creatures, the pickups and the clock carry on.
 */
export function respawn(): void {
  if (!level) return;
  const starts = level.sbk.entities.filter((e) => e.name === "initplayer");
  const e = starts[spawnIndex] ?? starts[0];
  const x = e ? e.pointX : level.anchorX;
  const y = e ? e.pointY : level.anchorY;
  stats.health = stats.maxHealth;
  dropAt(roomAt(x, y), x, y);
  p.vx = 0;
  p.facing = 1;
  p.fallPx = 0;
  // `0x42950f` — and the idle script goes in, which ends any flail or duck, and
  // puts the gun away: it is kind 0, and `0x479438` is left as it was
  p.flail = false;
  inv.drawn = false;
  p.inv15 = p.invLoop = false;
  p.crouching = false;
  p.act = null;
  p.actClock = 0;
  p.dyingTag = 0;
  camVx = 0;
  camVy = 0;
  view.x = x;
  view.y = y;
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
export async function ranOut(): Promise<void> {
  if (advancing) return;
  advancing = true;
  const pick =
    TIME_OUT_FILMS[Math.floor(random() * TIME_OUT_FILMS.length)];
  stats.ticks = CLOCK_FULL; // so a slow film cannot fire this twice
  await ui.film(pick);
  await loadLevel(levelIndex);
  advancing = false;
}

/**
 * The goal was reached with the quota met: the next mission, briefing first.
 *
 * The score carries and everything else is the new level's own — which is what
 * `loadLevel` already does, the census and the clock included.
 *
 * ...and the sixteenth is the END. `0x41293d` plays `credits.mov` and drops the
 * chapter loop, which hands the game back to its title menu — see
 * {@link ENDING_FILM}. This page has no title menu to hand it to, so it plays
 * the credits and opens level one with the score kept, which is the nearest
 * thing to the front that a single page has.
 */
export async function nextLevel(): Promise<void> {
  advancing = true;
  if (levelIndex === MISSIONS.length - 1) {
    ended = true;
    await ui.film(ENDING_FILM);
    ended = false;
    await loadLevel(0);
    advancing = false;
    return;
  }
  const next = levelIndex + 1;
  const brief = MISSIONS[next];
  // BOGGS FIRST, and then the chapter card. Each stage's case queues its films
  // one after another through `0x40e330` (clear) and `0x40e990` (play and wait),
  // and the order is the order of the pushes:
  //
  // ```
  //   44d7b9  push 0x478a38   ; Boggs01.Mov      44d7de  push 0x478a2c  ; Chp01.Mov
  //   436a8b  push 0x475020   ; Boggs06.Mov      436ab0  push 0x475014  ; Chp06.Mov
  // ```
  //
  // — the same way round in a mid-chapter stage as in a chapter's first, so it
  // is the sequence and not an opening special case. Boggs says his piece on the
  // flying screen and the skull that names where you are going comes after him.
  // the stage's own queue, in its own order — which is not the same order in
  // every chapter, and includes the opener on the four stages that have one
  for (const reel of brief.films) await ui.film(reel);
  await loadLevel(next);
  advancing = false;
}

/** true while the credits are running, so a probe can see the ending happen */
export let ended = false;

/** true while the films between two levels are running */
export let advancing = false;

/** the mission this level is — its films, and the share of it that must die */
export function mission(): Mission {
  return MISSIONS[levelIndex] ?? MISSIONS[0];
}

/** how many of this level's population are still standing */
/**
 * Does this one still hold `obj+0x1c`, the census flag — enrolled by its
 * creator (`0x42f870(obj, 1)`, {@link Foe.counts}) and not yet let go.
 *
 * Most classes let go the first frame they are dead (`0x42f870(obj, 0)` in
 * their death state or handler). A class that never does is let go only as
 * the object is freed: `0x430fd0` → `0x42f6e0` → `0x42f750`, whose `0x42f778`
 * takes one off `[0x4a6e88]` for an object whose flag is still set — see
 * {@link Foe.countsDead}. A removal that is not a death (the ox's pit, igor's
 * fall, `BrainCtx.remove`) takes the thing out of the pool, and so out of
 * here, the frame the think answers 1.
 */
export function inCensus(e: Enemy): boolean {
  const foe = FOES[e.kind];
  return foe.counts && (e.state !== "dead" || !!foe.countsDead);
}

export function aliveNow(): number {
  // a body has already left: its state handler calls `0x42f870(obj, 0)` on the
  // first frame it is dead, fifty frames before the object itself goes
  if (!level) return 0;
  return (
    level.spawned.reduce(
      (n, r) =>
        n + r.filter(inCensus).length,
      0,
    ) +
    // and Boggs leaves the census the frame it starts dying, for the same reason
    level.boggs.reduce((n, r) => n + r.filter((b) => !b.dying).length, 0)
  );
}

/**
 * Has the goal appeared? `0x46b1b0` in the engine, and it latches for the same
 * reason: the goal is spawned once, when the quota is first met, and stays.
 */
export let goalOpen = false;

/**
 * The flying television, once the quota lets it in.
 *
 * `0x410170` mode −1 puts it at `(pointY − 180, pointX)` off the level's own
 * `goal` record — a hundred and eighty pixels up, in the air — facing the way the
 * record's `param` says, and `0x410480` flies it down, hovers it, and opens it
 * when the player is standing in the rect. {@link file://./effects.ts} has the
 * disassembly. `null` until the census falls to the allowance.
 */
export let craft: {
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
  /** the stage-end tally while it runs — see {@link startTally} */
  tally?: { dial: number; frames: number };
  /** ...and once it has run: `[0x46ba10]`, the flag the stage end waits for */
  tallied?: boolean;
} | null = null;

/**
 * Bring the craft in, fly it down, bob it, and open it when the player arrives.
 *
 * The order is `0x410480`'s: sink while it is above its rest height, otherwise
 * bob and test. The test is three things — `0x434200(player, rect)` for the goal
 * RECT, `0x42fad0(craft, 300, 200)` for the craft itself, and `0x402f60`, the
 * player not dying — so the rect the disc draws is still what you walk into,
 * and the thing you walk to is over it.
 */
export function stepCraft(): void {
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
    // `0x41020a`..`0x410230` — the hum's record armed to loop as it is made
    sound?.loop(CRAFT.hum[CHARACTER], true, true);
  }
  if (!craft) return;
  craft.clock += TICK_SCALE;
  // `0x4105d7`..`0x4105ef` — its hum, asked for every frame of kind 1, which
  // is all of the craft's life at a goal: through `0x40ef30`, so the mixer
  // turns the ask away while the hum still sounds — the loop armed above keeps
  // it sounding — and each ask moves it to where the craft now is
  const onFrame = Math.floor(craft.clock) !== Math.floor(craft.clock - TICK_SCALE);
  if (onFrame) sound?.own(CRAFT.hum[CHARACTER], craft.x, craft.y);
  if (craft.state === "open") {
    // `0x41073c`..`0x41074d` — the screen's last cel has run out and the flag
    // is not yet up: the tally, before anything else
    if (!craft.tallied && !craft.tally && craft.clock >= CRAFT.open.cels.length * CRAFT.open.hold)
      startTally(craft);
    return;
  }
  if (craft.y < craft.restY) {
    craft.y = Math.min(craft.restY, craft.y + CRAFT.sink * TICK_SCALE);
    return;
  }
  // the hover: two pixels a frame, turned round whenever it has drifted five
  if (Math.abs(craft.bobbed) > CRAFT.bobSpan) craft.drift = -craft.drift;
  craft.bobbed += craft.drift * TICK_SCALE;
  craft.y += craft.drift * TICK_SCALE;
  const box = playerBox();
  const inRect =
    box.right > g.left &&
    box.left < g.right &&
    box.bottom > g.top &&
    box.top < g.bottom;
  const close =
    Math.abs(p.x - craft.x) <= CRAFT.near.x &&
    Math.abs(p.y - craft.y) <= CRAFT.near.y;
  // ...and `0x4106a3` asks `0x402f60` last: the player's kind under 0x1a, both
  // characters alike (`0x402f79`, `0x402f8a`) — which is every state but the
  // two dying ones, a jump or a knockdown included. A dying player does not
  // open it
  if (inRect && close && leftGoal && p.act !== "dying") {
    craft.state = "open";
    craft.clock = 0;
    // `0x4106c1`..`0x4106d9` — the screen's own sound as it starts down, and
    // `0x4106f8` takes the hum's loop flag off again
    sound?.own(CRAFT.opens[CHARACTER], craft.x, craft.y);
    sound?.loop(CRAFT.hum[CHARACTER], false, true);
    // `0x410702` — `0x402e30(0)`: the keys are dropped and shut out until the
    // tally has run, so the player stands at the goal while the screen comes down
    setInput(false);
  }
}

/**
 * Has the screen finished coming down — `[0x46ba10]`, and the stage is over.
 * The tally ({@link startTally}) runs first, and the flag goes up after it.
 */
export function craftOpened(): boolean {
  return craft?.state === "open" && !!craft.tallied;
}

/**
 * The stage-end tally — `0x40ffe0`, which the craft's think calls the frame the
 * screen's last cel runs out (`0x41074d`) and before it raises `[0x46ba10]`.
 * It is called from `0x410480` alone, and every chapter's goal (`0x415f50`,
 * `0x421900`, `0x43b950`, `0x450190`) makes its craft through `0x410170`, so
 * every stage ends through it.
 *
 * It is a loop of its own that the rest of the game waits on. `0x40e120(1)`
 * puts the panel up if it was down. Then, from the dial's cel as `0x40d250`
 * last left it (`[0x4a4d60]`, `0x410026`) up to the empty 12717 (`0x410030`,
 * `0x41011e`): the dial is drawn on that cel (`0x410061`), and ten times
 * (`0x41004b`) a hundred goes on the score (`0x410072`), the score is drawn
 * again (`0x4100b0`), the character's own 0x1f — 0x18 for the second — plays
 * through `0x40f110` (`0x410109`), and `0x40e4f0` spins until four sixtieths
 * have passed: one engine frame (`0x40e50f`). So a thousand a step and ten
 * frames a step, with nothing else moving and no key read. Then the empty dial
 * (`0x41014f`), and the clock is set to 32000 (`0x410154`).
 *
 * The dial it counts from is the one on show, and past step 12 that flashes:
 * `0x40d2b3` puts the empty 12717 in `[0x4a4d60]` every other frame, and a
 * stage finished on one of those frames tallies nothing.
 *
 * Back in the think, `0x402e30(1)` opens the keys the opening shut
 * ({@link inputOpen}) and clears them (`0x402db0`), and the flag goes up
 * (`0x410759`); `0x410370` sees it the next frame and the stage ends.
 */
function startTally(c: NonNullable<typeof craft>): void {
  iface = true;
  const dial = dialCel(stats.ticks);
  if (dial >= HUD_CEL.dialOff) endTally(c);
  else c.tally = { dial, frames: 0 };
}

/** one frame of the tally — see {@link startTally} */
function stepTally(c: NonNullable<typeof craft>): void {
  const t = c.tally!;
  stats.score += CRAFT.tally.points;
  sound?.own(CRAFT.tally.sound[CHARACTER], p.x, p.y, "renew");
  t.frames += 1;
  if (t.frames >= (HUD_CEL.dialOff - t.dial) * CRAFT.tally.perStep) endTally(c);
}

function endTally(c: NonNullable<typeof craft>): void {
  c.tally = undefined;
  // `0x410154` — no limit, and the dial shows it empty
  stats.ticks = CLOCK.noLimit;
  // `0x410754` — `0x402e30(1)`: the keys open again, dropped as they open
  setInput(true);
  c.tallied = true;
}

/** the dial while the tally drives it, or undefined — `0x410061` */
export function tallyDial(): number | undefined {
  const t = craft?.tally;
  return t ? t.dial + Math.floor(Math.max(0, t.frames - 1) / CRAFT.tally.perStep) : undefined;
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
export let leftGoal = false;

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
export let film: Film | null = null;
export let sink: AudioSink = new DeferredAudioSink();
export let audioLive = false;

export function wakeAudio(): void {
  // the level's own sound wants the same gesture the films' bed does, and it can
  // be asked more than once: the context may not exist yet the first time
  sound?.resume();
  if (audioLive) return;
  audioLive = true;
  const real = new WebAudioSink();
  (sink as DeferredAudioSink).attach?.(real);
  sink = real;
}

/**
 * The PAUSE PANEL — one film a chapter, three buttons, and the game's own save.
 *
 * `0x403c7b` is the only caller of `0x404280`, and two keys reach it. The key
 * dispatcher uppercases a letter and then splits on the event record's modifier
 * word (`0x403c40`, `test ..., 0x1fa0`): zero goes to the ordinary game binding
 * through `0x46b210`, and nonzero goes to a second table at `0x403ea4`, where
 * only five characters are bound at all —
 *
 * ```
 *   '.'  0x2e  -> 0x403c7b   the panel        'P'  0x50 -> 0x403ce8
 *   'Q'  0x51  -> 0x403c7b   the panel        'T'  0x54 -> 0x403cfb
 *   '0'..'9'   -> 0x403cd2
 * ```
 *
 * — and on the PC the modifier word is not the Macintosh one it looks like.
 * `0x405787` asks `GetKeyState(VK_CONTROL)` and `0x4057a5` sets the word to
 * `0x1fa0` entire when the answer is down, leaving it zero otherwise. So the
 * mask is one bit of information and the panel's keys are **Ctrl+Q** and
 * **Ctrl+.** — not ESC, which is below the first table's range and does nothing
 * in a level. ESC is bound here as well because it is what a browser reader will
 * press, and because nothing else in this page wants it.
 *
 * ## Which film, and what is in it
 *
 * `0x4042af` picks by chapter, `[0x4abdfe] - 3`, and all four are one shape:
 * frames "X 3".."X 59" loop (the last is a type-2 frame targeting "X 3") with
 * three regions live the whole way, and the last three frames of the file are
 * the answers. Which answer is which is in the segment header, not in the
 * picture: `actionFrame1` names the MIDDLE button and `actionFrame2` the BOTTOM
 * one, and the top button is named by neither.
 *
 * ```
 *   pauseA   loop 3..59    actionframes "pauseA 61" "pauseA 62"
 *   pauseB   loop 3..120   actionframes "PauseB 122" "PauseB 123"
 *   pauseC   loop 3..59    actionframes "PauseC 61" "PauseC 62"
 *   pauseD   loop 3..89    actionframes "PauseD 91" "PauseD 92"
 * ```
 *
 * `0x449fbb` compares the playing frame against each name and calls
 * `0x45e1e0(1)` or `(2)`; that handler, while the shell state is 4 — which
 * `0x404280` sets on the way in — takes argument 2 to `[0x46b208] = 5` and
 * anything else to `GetSaveFileNameA`. So:
 *
 * ```
 *   top     no actionframe   the film just ends    ->  RESUME
 *   middle  actionframe 1    0x45e1e0(1)           ->  SAVE
 *   bottom  actionframe 2    0x45e1e0(2)           ->  QUIT the level
 * ```
 *
 * and `0x404303` closes it: state 5 leaves the level, anything else redraws
 * (`0x40cf00`) and plays on. There is no Load here — Load is the TITLE screen's
 * own button, `0x45df8d`.
 */
export const PAUSE = {
  /** `0x4042af`'s jump table, in chapter order */
  films: ["pauseA.mov", "pauseB.mov", "pauseC.mov", "pauseD.mov"],
  /** the second key table at `0x403ea4`, and both of these want Ctrl */
  keys: ["q", "."] as readonly string[],
  from: "0x403c7b -> 0x404280, films by [0x4abdfe] - 3",
} as const;

/** the standable, solid and climbable things standing inside one room */
export function solidsIn(sbk: SbkFile, room: SbkRoom): Solids {
  const mine = sbk.entities.filter((e) => {
    if (!e.isEntity) return false;
    const y = (e.top + e.bottom) >> 1;
    const x = (e.left + e.right) >> 1;
    return (
      y >= room.top && y <= room.bottom && x >= room.left && x <= room.right
    );
  });
  return {
    platforms: mine.filter((e) => e.name === "platform").map((e) => ({ ...e })),
    obstacles: mine.filter((e) => e.name === "obstacle"),
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
 *   two whole player implementations. The pairing is `0x402950`'s, and the
 *   addresses this page named before were wrong:
 *
 *   ```
 *     402950  movsx eax, word ptr [0x46b1a8]
 *     40295c  je 0x40296c  ->  call 0x428080   ; character 0 — the 4xxx cels
 *     402961  je 0x402975  ->  call 0x442ad0   ; character 1 — the 9xxx cels
 *   ```
 *
 *   `0x402900` and `0x402990` pair the rest the same way (`0x42e560`/`0x448a70`,
 *   `0x42e580`/`0x448a90`), and each character has its own hit handler and its
 *   own eight-slot blow-code table — see `src/codes.ts`. Character 1 is not
 *   wired here; the page plays character 0 throughout.
 *
 * The rest of the debug set needs a modifier held (the event's modifier word
 * against `0x1fa0`), which routes through a second table at `0x403ea4`:
 * **mod+0…9** jumps to a level, **mod+Q** and **mod+.** abort it, **mod+P** and
 * **mod+T** toggle two more things. So the game shipped with a level warp in it.
 */
export let spawnIndex = 0;
export function cycleSpawn(): void {
  if (!level) return;
  const starts = level.sbk.entities.filter((e) => e.name === "initplayer");
  if (!starts.length) return;
  spawnIndex = (spawnIndex + 1) % starts.length;
  const e = starts[spawnIndex];
  const y = e.pointY;
  const x = e.pointX;
  dropAt(roomAt(x, y), x, y);
}

/** every animation a kind can ever show, for the cels-are-present test */
export function everyAnim(foe: Foe): FoeAnim[] {
  return [
    foe.gait,
    ...(foe.flinch ?? []),
    ...(foe.death ? [foe.death] : []),
    ...(foe.burst ? [foe.burst.anim] : []),
  ];
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
export function spawnIn(sbk: SbkFile, room: SbkRoom, taken?: Set<SbkEntity>): Enemy[] {
  const out: Enemy[] = [];
  if (foesOff) return out;
  for (const e of sbk.entities) {
    const foe = FOES[e.name];
    if (!e.isEntity || !foe) continue;
    if (taken?.has(e)) continue;
    if (
      e.pointY < room.top ||
      e.pointY > room.bottom ||
      e.pointX < room.left ||
      e.pointX > room.right
    )
      continue;
    taken?.add(e);
    // every cel it needs has to be in this book, or it is some other level's —
    // and that now includes the flinches and the death, which is the check that
    // would have caught the old cross-chapter mix-up: this chapter's rat has no
    // 3080 to die on and the other chapter's does
    if (!everyAnim(foe).every((a) => a.cels.every((id) => sbk.byId.has(id))))
      continue;
    // this page carries a foe by its FEET and {@link foeAnchor} converts, so the
    // record's anchor is converted the other way here, through the same gait cel
    const g = celRec(sbk, foe.gait.cels[0]);
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
      // `AI+0x10` — the record's own point, which a class can be sent back to,
      // or the constant its creator writes there instead ({@link Foe.homeAt})
      home: (foe.homeAt ?? e.pointX) + g.width / 2 - g.posX,
      homeY: e.pointY + g.height - g.posY,
      weightless: foe.bornWeightless || undefined,
      // ...and the record's own param, which for `initcop` picks the creature
      param: e.param,
      asleep: foe.wake ? true : undefined,
      decisions: foe.drives?.decisions,
      clock: 0,
      state: "gait",
      // a dormant thing holds one cel and goes nowhere — its own, where its class
      // names one (`0x4386f5` installs cel 1801 over the build's 1940)
      anim: foe.wake
        ? { ...foe.gait, cels: [foe.wake.cel ?? foe.gait.cels[0]], dx: [0] }
        : foe.gait,
      linger: 0,
      dents: 0,
      vx: 0,
      vy: 0,
      hp: foe.health,
      max: foe.health,
      // `0x41ef5c` — the zombie's creator draws its plate, {@link Foe.panel}
      plate: foe.panel?.plates
        ? foe.panel.plate - 1 + roll(foe.panel.plates)
        : undefined,
    });
    // `0x435c73`: the ox's creator writes 80 into the corpse global, and
    // nothing ever puts the 50 back — see {@link corpseFrames}
    if (e.name === "initox") corpseFrames = 0x50;
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
export function elevatorsIn(
  sbk: SbkFile,
  room: SbkRoom,
  solids: Solids,
  planks: readonly Plank[],
): Elevator[] {
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
    if (cy < room.top || cy > room.bottom || cx < room.left || cx > room.right)
      continue;
    // the cels are one book's, exactly as the planks' are: only CITY carries these
    if (
      ![ELEVATOR.car.back, ELEVATOR.car.front, ...ELEVATOR.idle.cels].every((id) =>
        sbk.byId.has(id),
      )
    )
      continue;
    // `0x42fb70` at the shaft's BOTTOM — the car starts on its landing and owns it
    const floor = solids.platforms.find(
      (q) =>
        !taken.has(q) &&
        e.pointX >= q.left &&
        e.pointX < q.right &&
        e.bottom >= q.top &&
        e.bottom < q.bottom,
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
      vy: 0,
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
export function planksIn(sbk: SbkFile, room: SbkRoom, solids: Solids): Plank[] {
  const taken = new Set<SbkEntity>();
  const out: Plank[] = [];
  for (const e of sbk.entities) {
    if (!e.isEntity || e.name !== "initplank") continue;
    const cy = (e.top + e.bottom) >> 1;
    const cx = (e.left + e.right) >> 1;
    if (cy < room.top || cy > room.bottom || cx < room.left || cx > room.right)
      continue;
    // the cels are one book's: only CITY carries 1050..1061
    if (!PLANK.intact.cels.every((id) => sbk.byId.has(id))) continue;
    const floor =
      solids.platforms.find(
        (q) =>
          !taken.has(q) &&
          e.pointX >= q.left &&
          e.pointX < q.right &&
          e.pointY >= q.top &&
          e.pointY < q.bottom,
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
      homeY: e.pointY,
      homeFloor: floor ? { top: floor.top, bottom: floor.bottom } : null,
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
export function crowsIn(sbk: SbkFile, room: SbkRoom): Crow[] {
  const out: Crow[] = [];
  for (const e of sbk.entities) {
    if (!e.isEntity || e.name !== "initcrow") continue;
    const cy = (e.top + e.bottom) >> 1;
    const cx = (e.left + e.right) >> 1;
    if (cy < room.top || cy > room.bottom || cx < room.left || cx > room.right)
      continue;
    if (!CROW.sleep[0].cels.every((id) => sbk.byId.has(id))) continue;
    // `0x450910`: facing east, and `ctx+0x10`/`ctx+0x12` both zero
    out.push({
      x: e.pointX,
      y: e.pointY,
      top: e.top,
      left: e.left,
      bottom: e.bottom,
      right: e.right,
      state: "sleep",
      tag: 0,
      clock: 0,
      vx: 0,
      vy: 0,
      gravity: 0,
      grounded: false,
      hit: false,
      factor: 0,
    });
  }
  return out;
}

/**
 * Where a level opens: the `initplayer` record's own POINT.
 *
 * `0x4036dd` reads the record's `+24` as a packed dword and writes it straight
 * into `obj+6` — the point, both words at once. This read the rect's MIDPOINT
 * instead, which agrees with the point to within half a pixel in 30 of the 31
 * shipped records and is 37 pixels lower in the one that does not: SEWER's
 * entrance, the only level where the record's rect is not centred on its point.
 *
 * Both land you on the same floor, because you fall about three hundred pixels
 * either way, so this was never visible in the resting position — but the drop
 * was 37 pixels shorter than the game's, and guessing at a rect where the
 * executable reads a field is the kind of thing that is only ever right by
 * accident.
 */
export function pickStart(sbk: SbkFile): SbkEntity | undefined {
  // `0x40b46a` collects the `initplayer` records in file order (`0x40b850`), and
  // a level begins on the FIRST: `0x42e5ef` reads `[0x4aa3d8]`, record 0's point,
  // and `0x42e5fa` zeroes the index a respawn reads. A region with no floor
  // still stands you up — `0x40bbd0`'s flat floor — so MAZE and BARREL open in
  // theirs.
  return sbk.entities.find((e) => e.name === "initplayer");
}

/**
 * The room the spawn point falls in: the one whose rect holds it, and failing
 * that the one whose floor runs under it. A level with neither still gets a
 * room, so that walking is never impossible for want of a lookup.
 */
export function roomAt(x: number, y: number): SbkRoom {
  const rooms = level!.rooms;
  const covers = (r: SbkRoom): boolean =>
    r.ground !== null &&
    x >= r.ground.x0 &&
    x < r.ground.x0 + r.ground.ys.length;
  return (
    rooms.find(
      (r) =>
        y >= r.top && y <= r.bottom && x >= r.left && x <= r.right && covers(r),
    ) ??
    rooms.find(
      (r) => y >= r.top && y <= r.bottom && x >= r.left && x <= r.right,
    ) ??
    rooms.find(covers) ??
    rooms[0]
  );
}

/**
 * The mover's side walls, as they act on a point just placed: `0x40bbd0` hands
 * back the floor's own extent — the region's `x0 .. x0 + n` (`0x40bc66`), or the
 * room's rect less fifty each end where it has no region (`0x40bc92`) — and the
 * mover puts an object at or past a side one pixel inside it when the room's bit
 * for that side is set (`0x430064` left, bit 2; `0x4300db` right, bit 8).
 * BARREL's first `initplayer` point is x12 against a floor from x51, and this is
 * what stands the game's opening on x52 instead of dropping it past the end.
 */
export function insideSides(room: SbkRoom, x: number): number {
  const g = room.ground;
  const lo = g ? g.x0 : room.left + 50;
  const hi = g ? g.x0 + g.ys.length : room.right - 50;
  if (x <= lo && room.flags & 2) return lo + 1;
  if (x >= hi && room.flags & 8) return hi - 1;
  return x;
}

/**
 * The mover's side test on a point — `0x430058`..`0x430146`. Past the floor's
 * left end ({@link insideSides}' bounds) with flag 2 set the point is held at
 * left + 1 (`0x43006b`); with it clear the FIRST region in the table whose
 * rect holds the point (`0x40b940(2, point)` at `0x4300a0`, `0x434200`'s
 * half-open test) becomes the player's — its own included, whose rect often
 * runs on past its floor — and the point goes on unheld (`0x4300bd`); only with
 * none is it held all the same (`0x4300c3`). The right end the same with flag
 * 8 (`0x4300db`). Answers where the point is held, or null when it passes (the
 * room may have changed under it).
 */
export function sideWalls(nx: number): number | null {
  const r = p.room;
  if (!r || !level) return null;
  const g = r.ground;
  const lo = g ? g.x0 : r.left + 50;
  const hi = g ? g.x0 + g.ys.length : r.right - 50;
  const past = nx <= lo ? -1 : nx >= hi ? 1 : 0;
  if (past === 0) return null;
  const edge = past < 0 ? lo + 1 : hi - 1;
  const ay = p.y - p.feet;
  const next =
    r.flags & (past < 0 ? 2 : 8)
      ? undefined
      : level.rooms.find(
          (q) => nx >= q.left && nx < q.right && ay >= q.top && ay < q.bottom,
        );
  if (next) {
    p.room = next;
    return null;
  }
  return (nx - edge) * past > 0 ? edge : null;
}

/**
 * `0x42e603` / `0x402788` — how a level starts and a life restarts: the ANCHOR
 * goes on the record's point, both velocities go to nothing, and the mover
 * drops the player onto whatever is under it. Not onto the region floor: SEWER
 * starts over a walkway laid 150 above its channel, and snapping the feet to
 * the floor put the player in the sewage.
 */
export function dropAt(room: SbkRoom | undefined, x: number, anchorY: number): void {
  p.hidden = false;
  p.room = room ?? null;
  p.x = x;
  p.y = anchorY + p.feet;
  // ...facing east: the player is a new object, and the allocator zeroes its
  // mirror word (`0x42f56a`, `obj+0x28`)
  p.facing = 1;
  p.vx = 0;
  p.vy = 0;
  p.vyRaw = 0;
  p.stepPx = 0;
  p.onGround = false;
  p.climbing = false;
  p.bar = undefined;
  p.act = null;
  snapCamera();
}

/** move into a room, standing on its floor at `x` — `y` for a room with none */
export function enter(room: SbkRoom | undefined, x: number, y: number): void {
  p.room = room ?? null;
  p.x = room ? insideSides(room, x) : x;
  p.y = groundAt(p.x) ?? y;
  p.vy = 0;
  p.onGround = true;
  p.climbing = false;
  p.bar = undefined;
  p.act = null;
  // `0x428ff6` — the point moves, and the corner goes with it in one step
  snapCamera();
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
export function roomSpan(room: SbkRoom): { lo: number; hi: number } | null {
  if (!room.ground) return null;
  const lo = Math.max(room.left, room.ground.x0);
  const hi = Math.min(room.right, room.ground.x0 + room.ground.ys.length - 1);
  return hi > lo
    ? { lo, hi }
    : { lo: room.ground.x0, hi: room.ground.x0 + room.ground.ys.length - 1 };
}

/**
 * The floor under x in the room the player is in — `0x40bbd0`.
 *
 * A room with no region of its own still has a floor: `0x40bc7d` makes it flat,
 * at its top plus {@link SbkRoom.floorDrop}, across its rect less fifty pixels
 * at each end. MAZE's two floorless rooms (x1205..3060 and x4499..5904) stand
 * on 8535 and 8069 that way; answering nothing for them left the player with
 * no floor at all.
 */
export function groundAt(x: number): number | null {
  const room = p.room;
  const g = room?.ground;
  if (room && !g) {
    const xi = Math.round(x);
    return xi >= room.left + 50 && xi < room.right - 50
      ? room.top + room.floorDrop
      : null;
  }
  if (!g || !g.ys.length) return null;
  // ...and past either end of a region's floor, the end sample: `0x40bc34` and
  // `0x40bc4c` hold the floor flat beyond its ends rather than answering none
  const i = Math.round(x) - g.x0;
  return g.ys[Math.max(0, Math.min(g.ys.length - 1, i))];
}

/** what the player is standing in front of right now */
export function solids(): Solids {
  const i = level && p.room ? level.rooms.indexOf(p.room) : -1;
  return level && i >= 0
    ? level.solids[i]
    : { platforms: [], obstacles: [], goal: undefined };
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
export function surfaceCrossed(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): number | null {
  const steps = Math.max(
    1,
    Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) / 2),
  );
  for (let i = 1; i <= steps; i++) {
    const a = (i - 1) / steps;
    const b = i / steps;
    const hit = surfaceUnder(
      x0 + (x1 - x0) * b,
      y0 + (y1 - y0) * a,
      y0 + (y1 - y0) * b,
    );
    if (hit !== null) return hit;
  }
  return null;
}

/**
 * The ledge an OPEN grave lays across its own mouth — see {@link HOLE.lid}.
 *
 * `0x4212bb` appends a synthetic `platform` record to the engine's own platform
 * table the frame a grave's opening script ends, spanning two hundred pixels
 * across the grave's point and topped 0x4c below it. GRAVE's floor really does
 * fall 320 to 370 pixels at each of its five graves, and nine of its sixteen
 * zombies patrol over one, so without this the level eats its own population and
 * its 14-of-16 quota can never be met.
 *
 * Once a grave has opened, {@link layGraveLid} appends the record itself, for
 * everything, as `0x421470` does. This answers the same ledge to the FOES over a
 * grave in any state — see the note inside.
 */
export function graveLidUnder(x: number, fromY: number, toY: number): number | null {
  let best: number | null = null;
  for (const h of hereOf((l) => l.holes)) {
    // ...in EVERY state, not only the open one, and that is the deviation.
    // `0x4212bb` lays the ledge when the opening script ends, so the executable
    // has one only while the grave is open; a shut grave is kept clear of the
    // player by `0x4210bd` shoving them out of its rect instead, and nothing in
    // the class does anything for a foe. But the pit in the floor is there in
    // both states, so a zombie crossing a grave that is still shut — which is
    // any grave the player is more than a hundred away from — went in exactly as
    // before. A shut grave is a closed slab in its own art, so the foes get to
    // walk on it.
    if (x < h.x - HOLE.lid.halfWidth || x > h.x + HOLE.lid.halfWidth) continue;
    const top = h.y + HOLE.lid.top;
    if (top < fromY || top > toY) continue;
    if (best === null || top < best) best = top;
  }
  return best;
}

/** {@link surfaceUnder}, plus the ledge an open grave lays — for foes */
export function foeSurfaceUnder(x: number, fromY: number, toY: number): number | null {
  const floor = surfaceUnder(x, fromY, toY);
  const lid = graveLidUnder(x, fromY, toY);
  if (floor === null) return lid;
  if (lid === null) return floor;
  return Math.min(floor, lid);
}

export function surfaceUnder(x: number, fromY: number, toY: number): number | null {
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
      // crossed on the way down — or already INSIDE it: `0x42fe86` takes any
      // platform whose bottom is at or under the foot, and the snap then puts
      // the foot on its top, so a thing planted a few pixels into a walkway
      // (a bush's grip does it) stands on the walkway, not under it
      const crossed = e.top >= fromY && e.top <= toY;
      const inside = e.top <= toY && e.bottom >= toY;
      if (!crossed && !inside) continue;
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
export function ejectFromObstacles(): void {
  // the engine's point is the object's own y, which is the cel's anchor — this
  // page keeps `p.y` at the feet, so the standing cel's box bottom converts it.
  // A fixed offset on purpose: the engine's y does not move when the pose does,
  // and the airborne cels' boxes are 19 rows shallower than the standing one's.
  const ay = p.y - p.feet;
  for (const e of blockers()) {
    // `0x434200`: x0 <= x < x1 and y0 <= y < y1, and nothing else
    if (!(p.x >= e.left && p.x < e.right && ay >= e.top && ay < e.bottom))
      continue;
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
 * The ladder the player can GRAB, and it is the current cel's bitmap against
 * the record's rect — not a point, which is what this had.
 *
 * The idle state grabs with `0x42edd0(0, 1)`, which asks the chapter's
 * classifier `[0x4abe00]`, and every chapter's (`0x4123b0`, kind 0) begins
 *
 * ```
 *   0x40b660("ladder", player, 0, 1, 0x4ac3a0)  ->  4
 * ```
 *
 * `0x40b660` is the query by NAME; its third argument is the region and it is
 * 0, so no room is consulted; its fourth is the geometry, and 1 is
 * `0x434140(box, rect)` — a rectangle INTERSECTION with positive area. The box
 * is `0x42f9f0`'s: the current cel's whole bitmap about its anchor, `(-posY,
 * -posX, height - posY, width - posX)`, mirrored with the facing, and set down
 * at the player's anchor. The standing cel is 98 wide with its anchor 41 in,
 * so STREETS' rect of x9632..9779 is grabbed from 9575 to 9820, and the file's
 * pointX then puts you on the rail.
 *
 * Whom it answers is the other half, and it is why the port grabbed from too
 * far away: `0x429872` runs only in the IDLE state (kind 0, `0x429690`), only
 * with forward NOT held, and only with {@link ladderLatch} clear — W is the run
 * key, and a runner going past a ladder is in the run state, which never asks.
 * The jump state asks the same way (`0x429f5d`), so W in the air grabs. S is
 * `0x42edd0(1, 1)` from the idle, walk, run and jump states alike (`0x4298af`,
 * `0x429aaa`, `0x429caf`, `0x429e3b`), so a walker can take a ladder DOWN.
 *
 * The ladder state itself never re-asks: the record is copied into `0x4ac3a0`
 * by the grab and read from there until the leave, which is {@link canLetGo}.
 */
export function ladderAt(): SbkEntity | undefined {
  const rec = celRec(player, lastCel);
  if (!rec || !level) return undefined;
  // `p.y` is the feet and the bitmap's bottom edge; `p.x` is the anchor's x
  const [x0, x1] =
    p.facing < 0
      ? [rec.posX - rec.width, rec.posX]
      : [-rec.posX, rec.width - rec.posX];
  const top = p.y - rec.height;
  const left = p.x + x0;
  const right = p.x + x1;
  // the whole level's, because `0x40b660` scans the whole entity table and a
  // ladder is the one record that exists to carry you OUT of a region
  return level.ladders.find(
    (e) =>
      Math.max(top, e.top) < Math.min(p.y, e.bottom) &&
      Math.max(left, e.left) < Math.min(right, e.right),
  );
}

/**
 * The monkeybar the player's own point is inside — see {@link MONKEYBAR}.
 */
export function barAt(): SbkEntity | undefined {
  if (!level) return undefined;
  // `0x41243b` asks `0x40b660` with geometry 0, which is `0x434200`: the
  // player's own ANCHOR POINT inside the rect. Not the bitmap the ladder is
  // tested with, and not the feet — `p.y` is the feet on this page and the
  // engine's `obj+6` is the anchor, so the difference has to come off.
  const anchor = p.y - p.feet;
  return level.bars.find(
    (e) =>
      p.x >= e.left && p.x <= e.right && anchor >= e.top && anchor <= e.bottom,
  );
}

/**
 * Whether forward, backward or J may take you OFF the ladder this tick.
 *
 * `0x42ae50` leaves only when three things hold at once: the rung tag playing
 * has ENDED (`obj+0x46`), the tag is one of the four rungs (not the mount), and
 * the chapter's classifier asked with kind 2 (`0x412517`) does NOT answer 4 —
 * which it does when `0x40b940(2, point)` finds no record holding the player's
 * anchor. So you let go where a room is, and nowhere else: the mount put
 * `obj+0x16` to -1, and the leave writes the room back from that same query.
 *
 * The first of the three is what made this page's climb fast: a direction held
 * with W left the ladder the tick it was pressed and W grabbed it again the
 * next, one rung higher each time. Now the rung finishes, the hop is taken, and
 * {@link ladderLatch} keeps the ladder out of reach until the ground.
 *
 * A monkeybar's leave is none of this — see {@link MONKEYBAR}: S or J, from
 * the hang tag only, and straight down.
 */
export function canLetGo(): boolean {
  if (p.climbClock < LADDER.rungFrames) return false;
  return !!level?.rooms.some(
    (r) =>
      p.x >= r.left &&
      p.x <= r.right &&
      p.climbY >= r.top &&
      p.climbY <= r.bottom,
  );
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
 * attack sets, I is INV.
 *
 * And the eight letters are only the DEFAULTS. Every one of them is rebindable
 * from the preferences panel — `0x46b210` is what the panel writes and this is
 * what reads it, so see {@link file://./prefs.ts} and `keyTable` below. The four
 * shipped entries beside the letters are characters 24…27, which `0x40e980`
 * names `J4`, `J3`, `J2` and `J1`: a joystick's four buttons, bound to the
 * punch, the kick, the jump and INV. This port had them written down as arrow
 * keys.
 */

/**
 * What the preferences panel settled, read once at load.
 *
 * The panel is `main.html`'s and the level is this page's, so the eight
 * bindings come across in {@link file://./prefs.ts}'s store. Nothing here writes
 * them back: a level has no preferences panel in it, which is also true of the
 * original — `0x45d5a0` is only ever entered from the menu.
 */
export const PREFS = loadPrefs();

/**
 * The eight bindings, plus the four this page adds.
 *
 * `0x46b210` is indexed by the uppercased character, so a binding matches
 * whatever case the key arrives in. The arrows and the space bar are NOT in that
 * table — the shipped entries beside the letters are characters 24…27, which
 * `0x40e980` names `J4`, `J3`, `J2` and `J1`, a joystick's four buttons — so
 * they are this port's, kept because a page is not a 1996 game. A binding wins
 * over them: bind the punch to the space bar and the space bar stops jumping.
 */
export function keyTable(): Record<string, keyof typeof held> {
  const table: Record<string, keyof typeof held> = {
    ArrowLeft: "left",
    ArrowRight: "right",
    ArrowUp: "up",
    ArrowDown: "down",
    " ": "jump",
  };
  for (const action of PREFS_ACTIONS) {
    const bound = PREFS.keys[action.action - 1];
    if (!keyName(bound)) continue;
    table[bound.toUpperCase()] = action.held;
    table[bound.toLowerCase()] = action.held;
  }
  return table;
}

export const KEYS: Readonly<Record<string, keyof typeof held>> = keyTable();

/**
 * The eight words, and they are typed with the same keys that are walking you.
 *
 * `0x403c1b` hands every lowercase letter to `0x403ed0` BEFORE the letter is
 * uppercased and looked up as an action, so `a` is both "away" and the first
 * letter of nothing, and `zip` walks you while you type it. The recogniser is
 * {@link file://./cheats.ts}; this is what each match does here.
 */
export const cheats = new CheatTyper();

export function runCheat(cheat: Cheat): void {
  switch (cheat.word) {
    // `0x403f5c` — the same counter and the same jump Shift+N already spends
    case "zip":
      cycleSpawn();
      break;
    // `0x45ef30(0x78)`, behind `0x402ee0`: the player's kind has to be one of
    // 0x12…0x16, which is the armed set (`0x42e6e0`)
    case "eshs":
      if (inv.armed) loadRounds(inv.weapon, 0x78);
      break;
    // `0x404160` puts up "Enter level (1-16):" (`0x46b469`) filled in with the
    // level you are on, and turns the answer back into a chapter and a scene
    case "cthia": {
      const said = prompt("Enter level (1-16):", String(levelIndex + 1));
      const n = Number(said);
      if (Number.isInteger(n) && n >= 1 && n <= MISSIONS.length)
        void loadLevel(n - 1);
      break;
    }
    case "jetson":
      addClock(850);
      break;
    // `0x40d400(5)`, and five is also the most it would take
    case "bewitch":
      stats.lives = PICKUP.maxLives;
      break;
    case "harakari":
      takeHealth(0x1f4);
      break;
    // `0x402b20(0x400)` — up to `[0x4ac3d8]`, which is your own maximum and so
    // is the difficulty's
    case "marsupial":
      stats.health = Math.min(stats.maxHealth, stats.health + 0x400);
      break;
    // `0x40411e` makes the comparison and `0x404136` returns 1 either way
    default:
      break;
  }
}

/** the key each finger is holding down, so one lifting releases only its own */
export const padFingers = new Map<number, HTMLButtonElement>();

export const padAct = (el: HTMLButtonElement): keyof typeof held =>
  el.dataset.act as keyof typeof held;

export function padPress(el: HTMLButtonElement, id: number): void {
  const act = padAct(el);
  padFingers.set(id, el);
  el.classList.add("on");
  // the same four edges `keydown` takes: a door and a jump fire on the PRESS,
  // and a held fist must not machine-gun
  // `0x402be0` — nothing while the keys are shut ({@link inputOpen})
  if (!inputOpen) return;
  if (act === "up" && !held.up) upPressed = true;
  if (act === "jump" && !held.jump) jumpPressed = true;
  if (act === "punch" && !held.punch) punchPressed = true;
  if (act === "kick" && !held.kick) kickPressed = true;
  held[act] = true;
}

export function padLift(id: number): void {
  const el = padFingers.get(id);
  if (!el) return;
  padFingers.delete(id);
  el.classList.remove("on");
  const act = padAct(el);
  // a key is let go when the LAST finger on it lifts, not the first: a thumb
  // rolling from left to right puts two pointers on the pad for a moment
  for (const still of padFingers.values()) if (padAct(still) === act) return;
  if (inputOpen) held[act] = false;
}

/** every key at once — a film starting, or the page losing the fingers */
export function padLiftAll(): void {
  for (const id of [...padFingers.keys()]) padLift(id);
}

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
export function playerBox(): {
  top: number;
  left: number;
  bottom: number;
  right: number;
} {
  const art = celRec(player, ANIM.idle[0]);
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
export function takeDoor(): boolean {
  const room = p.room;
  if (!room || !level) return false;
  const b = playerBox();
  const hit = room.exits.find(
    (e) =>
      b.right >= e.left &&
      b.left <= e.right &&
      b.bottom >= e.top &&
      b.top <= e.bottom,
  );
  if (!hit) return false;
  const dest = level.rooms.find((r) => r.param === hit.to);
  if (!dest) return false;
  const at = arrivalIn(dest, room);
  if (!at) return false; // a room with no floor is not somewhere to be put
  /**
   * `0x428f63`..`0x42900c`: the record's point goes straight into the ANCHOR
   * (`obj+6` from `[0x4a6990]`, what `0x40b660` copied out), the view follows
   * it, and nothing touches the floor or the velocity — the mover drops the
   * player onto whatever is under the point. Every shipped arrival stands a
   * few dozen pixels above its floor, so you come through a door and land.
   * The player keeps its facing: it is the same object, unlike a level's
   * start ({@link dropAt}).
   */
  const facing = p.facing;
  dropAt(dest, at.x, at.y);
  p.facing = facing;
  return true;
}

/**
 * The enemies the current act has already struck — one hit per swing, cleared
 * when a new act starts, so a kick that overlaps for six ticks is one hit.
 */
export const struck = new Set<Enemy>();

/**
 * The player's `obj+0x1a`, the percentage `0x42f910` scales a blow by — and it
 * is not a constant. Repeating a move weakens it.
 *
 * Each striking tag's handler calls `0x4029e0(move)` on every frame it runs and
 * stores the answer in `obj+0x1a` ({@link PlayerAction.move} has the numbers):
 *
 * ```
 *   4029eb  if (move == [0x46b1cc] && facing == [0x46b1c8]
 *   402a0f      && now - [0x46b1c4] < 0xf0)            ; 240/60 s: four seconds
 *   402a35    strength -= (move is 2, 5, 7, 12 or 14) ? 25 : 5, floor 20
 *   402a5a  else strength = 100
 *           remember move, facing and now
 * ```
 *
 * `now` is `0x4087c0`, sixtieths of a second, so the window is four seconds of
 * the same move in the same direction; turning round or changing move restores
 * the full blow. The player's init (`0x42e463`) writes 0 there, which nothing
 * hits with, since every blow comes out of a tag that has called this first.
 */
export const blow = { strength: 100, move: -1, facing: 0, at: -Infinity };
/** engine frames since the page opened, in `0x4087c0`'s sixtieths */
export let blowClock = 0;
export function blowStrength(move: number): number {
  if (
    move === blow.move &&
    p.facing === blow.facing &&
    blowClock - blow.at < 0xf0
  ) {
    blow.strength -= [2, 5, 7, 12, 14].includes(move) ? 25 : 5;
    if (blow.strength < 0x14) blow.strength = 0x14;
  } else blow.strength = 100;
  blow.move = move;
  blow.facing = p.facing;
  blow.at = blowClock;
  return blow.strength;
}

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
 * The box is anchor-relative and goes into the world the way {@link strikeOf}
 * puts every hitter's there — `0x40e680`, negated about the anchor on mirror and
 * translated to the object's point, which for the player is `p.x` and the
 * anchor above the art's bottom edge at `p.y`.
 */
export function strikeBox(): {
  top: number;
  left: number;
  bottom: number;
  right: number;
  damage: number;
  blow: { dx: number; dy: number };
} | null {
  if (!player) return null;
  const rec = celRec(player, lastCel);
  if (!rec?.strike || !rec.blow) return null;
  const ay = p.y - rec.height + rec.posY;
  const box = strikeOf(rec, p.x, ay, p.facing)!;
  /**
   * Damage IS speed — `0x42f910`: the cel's pair, scaled by `obj+0x1a` unless
   * that is exactly 100 (`idiv 100` each, truncating), its dx negated on a
   * mirrored striker, plus the striker's own `obj+0xc` and `obj+0xa`, and the
   * integer square root (`0x434630`) of the sum of squares. So a running kick
   * hits harder than a standing one by the speed the run has actually built.
   * The pair is kept facing-relative here because the knockback applies the
   * facing itself.
   */
  const pct = blow.strength;
  const sx = pct === 100 ? rec.blow.dx : Math.trunc((rec.blow.dx * pct) / 100);
  const sy = pct === 100 ? rec.blow.dy : Math.trunc((rec.blow.dy * pct) / 100);
  const dx = sx + p.vx * p.facing;
  const dy = sy + p.vyRaw;
  return {
    ...box,
    damage: Math.floor(Math.sqrt(dx * dx + dy * dy)),
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
 * hitter's strength is above nothing, this — for every class, not only the
 * ones that fly. The hitter's side is its blow: the cel's pair scaled by its
 * strength, mirrored, plus its own velocity (`0x4304ab`..`0x4304e3`). Then for
 * each axis, in whole pixels a frame and each term truncated (`0x4305d5`..):
 *
 * ```
 *   victim' = v1·2·m1/(m1+m2) + victim·(m2−m1)/(m1+m2)
 *   hitter' = hitter·(m1−m2)/(m1+m2) + victim·2·m2/(m1+m2)
 * ```
 *
 * with `obj+0xe` as each mass. The player is 12 and a mailbox 7, so a kick's 55
 * comes out as 55 × 24/19 = 69 pixels a frame — which is why the original
 * throws a mailbox most of a screen — and the player's own run is spent on
 * what it hits (`0x430653`). What the victim's think does with the velocity
 * afterwards is its own: the hydrant zeroes it, most classes let the ground's
 * drag take it.
 */
export function knockback(
  m1: number,
  m2: number,
  blow: { dx: number; dy: number },
  hitter: { vx: number; vy: number },
  was: { vx: number; vy: number },
): { vx: number; vy: number; hvx: number; hvy: number } {
  const sum = m1 + m2 || 1;
  const t = Math.trunc;
  return {
    vx: t((blow.dx * 2 * m1) / sum) + t((was.vx * (m2 - m1)) / sum),
    vy: t((blow.dy * 2 * m1) / sum) + t((was.vy * (m2 - m1)) / sum),
    hvx: t((hitter.vx * (m1 - m2)) / sum) + t((was.vx * 2 * m2) / sum),
    hvy: t((hitter.vy * (m1 - m2)) / sum) + t((was.vy * 2 * m2) / sum),
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
/** `obj+8` — a foe's anchor x, the x every distance in the engine is taken from */
export function anchorX(e: Enemy): number {
  const g = level ? celRec(level.sbk, FOES[e.kind].gait.cels[0]) : undefined;
  return g ? e.x - g.width / 2 + g.posX : e.x;
}

export function foeAnchor(e: Enemy, lvl: Level): { x: number; y: number } | null {
  const g = celRec(lvl.sbk, FOES[e.kind].gait.cels[0]);
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
/**
 * One book's cels by id, remembered.
 *
 * `SbkFile.byId` maps an id to a LOCATION — the container the art lives in — and
 * everything that wants the record itself was scanning the array for it. That is
 * a linear walk of 1229 entries in the player's book and a few hundred in a
 * level's, and the fight put it on the hot path: `strikeBox` alone was doing one
 * per enemy per tick, twenty enemies at sixty ticks a second. MAZE went from 160
 * seconds to 216 and four suites starved of frames.
 */
export const celMemo = new WeakMap<SbkFile, Map<number, SbkCel | undefined>>();
export function celRec(
  book: SbkFile | null | undefined,
  id: number,
): SbkCel | undefined {
  if (!book) return undefined;
  let m = celMemo.get(book);
  if (!m) celMemo.set(book, (m = new Map()));
  if (!m.has(id))
    m.set(
      id,
      book.cels.find((c) => c.id === id),
    );
  return m.get(id);
}

/**
 * Where a foe meets the floor, the way `0x42fd80` measures it: the anchor, plus
 * the CURRENT cel's word at +0x26, plus the object's floor offset `obj+0x10`.
 *
 * +0x26 is the cel's own drawn extent below its anchor — `height - posY` in
 * every record read (the punk's 1900: 63, the rat's 3000: 23, its hole 3010:
 * 27, the mailbox's 2410: 93) — and it is NOT the collision box. `0x42fdcf`
 * adds `obj+0x10` to it and `0x42fdf0` takes the pair off the floor under the
 * point, so the offset sinks a class's art into the ground by that much (the
 * rat's −13, `0x44dfa0`) or holds it up. The platforms are measured against the
 * same foot (`0x42fe8c`).
 *
 * This used to stand things on the bottom of their collision BOX, which is
 * authored and not the art: the dog's pounce cels end their boxes 14 to 20
 * pixels above their art where its stand does not, so its feet leapt about in
 * the air and it fell through a rock; the CHOPPER's 4884 box ends 34 ABOVE its
 * anchor where the art ends 25 below; and the rat's hole cels carry no box at
 * all. The art's extent moves by a few pixels between poses, as the engine's
 * does.
 */
export function baseOf(e: Enemy, lvl: Level, cel = celOf(e)): number {
  const a = foeAnchor(e, lvl);
  const c = celRec(lvl.sbk, cel);
  if (!a || !c) return e.y;
  return a.y + c.height - c.posY + floorOffset(e);
}

/**
 * `obj+0x10` — the instance's own where a state has written one
 * ({@link Enemy.floor}), else its class init's ({@link Foe.floor}), else the
 * allocator's zero.
 */
export function floorOffset(e: Enemy): number {
  return e.floor ?? FOES[e.kind]?.floor ?? 0;
}

/** {@link baseOf} on the cel it is showing — `0x42fd80` knows no other */
export function footOf(e: Enemy, lvl: Level, _foe: Foe): number {
  return baseOf(e, lvl);
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
export function hurtBox(
  e: Enemy,
  c: SbkCel,
  lvl: Level,
): { top: number; left: number; bottom: number; right: number } {
  const a = foeAnchor(e, lvl);
  const b =
    e.facing < 0 && c.body
      ? { ...c.body, x0: -c.body.x1, x1: -c.body.x0 }
      : c.body;
  return a && b
    ? {
        left: a.x + b.x0,
        right: a.x + b.x1,
        top: a.y + b.y0,
        bottom: a.y + b.y1,
      }
    : {
        left: e.x - c.width / 2,
        right: e.x + c.width / 2,
        top: e.y - c.height,
        bottom: e.y,
      };
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
export const stats = {
  score: 0,
  lives: 3,
  /** `[0x4ac3d0]` and `[0x4ac3d8]` — and only {@link damageOn} ever spends it */
  health: HURT.max as number,
  maxHealth: HURT.maxAt(DIFFICULTY),
  /** what this level stood up with, and how many of them may still stand */
  census: 0,
  allowance: 0,
  /** engine frames left, counted down at the engine's rate */
  ticks: CLOCK_FULL,
  /** `[0x4a3b18]` — the dial's full scale, which is what a gift of time caps at */
  clockFull: CLOCK_FULL,
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
export function actOf(name: string): {
  cels: readonly number[];
  dx: readonly number[];
  dy?: readonly number[];
  hold?: number;
  move?: { id: number; held?: number; from: number };
  from: string;
} | null {
  // `0x42f111`: the statscepter is lifted on tag 1, held, not bent for
  if (name === "reach") {
    const cels = gunAhead()?.code === 17 ? GRAB.hold : GRAB.cels;
    return { cels, dx: cels.map(() => 0), from: GRAB.from };
  }
  // the reaction to a blow CODE, straight off the table at `0x4492b8`
  const code = Object.values(BLOW_CODES).find((r) => r.act === name);
  if (code) return { ...code.anim, dx: code.anim.cels.map(() => 0) };
  if (name === "held") return { ...HELD.loop, dx: HELD.loop.cels.map(() => 0) };
  if (name === "struggle")
    return { ...HELD.struggle, dx: HELD.struggle.cels.map(() => 0) };
  // `0x42f3d4` — the lightning's death is tag 3 of the same script
  if (name === "dying" && p.dyingTag === 3 && ACTIONS.dyingStruck) return ACTIONS.dyingStruck;
  if (name === "fire") {
    const w = WEAPONS[inv.weapon];
    if (!w) return null;
    const cels = [...w.moveset.fire, ...w.moveset.shot];
    return { cels, dx: cels.map(() => 0), from: w.moveset.from };
  }
  return ACTIONS[name] ?? null;
}

/**
 * Can a blow reach it at all. The water never — it is not a thing — and a
 * corpse only where its class's handler has no state test and its death is
 * drawn with a body ({@link Foe.corpseTakesHits}); everything else that
 * decides it is the body box of the cel on show, `0x4303b3`.
 */
function takesBlows(e: Enemy): boolean {
  if (e.state === "burst") return false;
  return e.state !== "dead" || !!FOES[e.kind].corpseTakesHits;
}

export function landHits(): void {
  if (!level || !player || !p.act) return;
  const i = level.rooms.indexOf(p.room!);
  if (i < 0) return;
  const mine = strikeBox();
  if (!mine) return; // this frame of the animation is not an impact frame
  // the crows first, because their own handler is the shortest in the game: no
  // health test at all, so any blow that reaches one takes it
  for (const c of level.crows[i]) {
    if (struckCrows.has(c)) continue;
    // the BODY box of the cel it shows, as `0x430350` takes every victim's —
    // the tumble's cels have none, which is what makes a dead crow unhittable
    const body = celRec(level.sbk, crowCel(c))?.body;
    if (!body) continue;
    const box = {
      left: c.x + body.x0,
      right: c.x + body.x1,
      top: c.y + body.y0,
      bottom: c.y + body.y1,
    };
    if (!(
      mine.right > box.left &&
      mine.left < box.right &&
      mine.bottom > box.top &&
      mine.top < box.bottom
    ))
      continue;
    struckCrows.add(c);
    strikeCrow(c, mine.damage);
  }
  // the heads, whose handler `0x420090` answers the player's own object and
  // nobody else's — see {@link HEAD}
  for (const h of heads) {
    if (struckHeads.has(h)) continue;
    const body = celRec(level.sbk, headCel(h))?.body;
    if (!body) continue;
    const [x0, x1] = h.west ? [-body.x1, -body.x0] : [body.x0, body.x1];
    if (!(
      mine.right > h.x + x0 &&
      mine.left < h.x + x1 &&
      mine.bottom > h.y + body.y0 &&
      mine.top < h.y + body.y1
    ))
      continue;
    struckHeads.add(h);
    kickHead(h, mine.blow);
  }
  const pool = level.spawned[i];
  for (const e of [...pool]) {
    // and once it has toppled it is out of the fight, the way `0x44fe80` opens
    // with `if (obj+0x18 != 2)`; the water is not a thing at all — its cels carry
    // no collision box, which is how the format says so
    if (struck.has(e) || !takesBlows(e)) continue;
    /**
     * ...and neither is a creature whose CURRENT cel carries no box.
     *
     * The same rule as the water, one line up, and `initrat` is what showed it
     * applies to creatures too. Its creator installs `0x476f48` tag 0 — the rat
     * still down its hole — and cels 3010 and 3011 carry no body rect at all,
     * where 3000, 3003 and 3004, the ones it comes out on, all do. Falling back
     * to the drawn extent makes a hole-bound rat 54 by 102 and a standing punch
     * kills it through the pavement. The fallback stays everywhere else, because
     * plenty of art has no rect and still has to stand on a floor; it is landing
     * a BLOW that needs the authored one.
     */
    if (!celRec(level.sbk, celOf(e))?.body) continue;
    if (e.state === "flinch" && e.anim.terminal) continue;
    const foe = FOES[e.kind];
    const c = celRec(level.sbk, celOf(e));
    if (!c) continue;
    const box = hurtBox(e, c, level);
    if (!(
      mine.right > box.left &&
      mine.left < box.right &&
      mine.bottom > box.top &&
      mine.top < box.bottom
    ))
      continue;
    struck.add(e);
    strikeFoe(
      e,
      mine.damage,
      mine.blow,
      p.facing,
      (mine.top + mine.bottom) / 2,
      box,
      0,
      {
        x: (Math.max(mine.left, box.left) + Math.min(mine.right, box.right)) / 2,
        y: (Math.max(mine.top, box.top) + Math.min(mine.bottom, box.bottom)) / 2,
      },
    );
  }
  // and BOGGS, which is four objects: `0x41aad0` turns a blow away only when the
  // striker is one of Boggs' own parts, so a fist is none of those and lands on
  // all of them — except the arm and the jaws, whose handler `0x41bb10` is
  // `xor ax, ax; ret` and turns everything away.
  for (const b of level.boggs[i]) {
    if (b.dying) continue;
    for (let k = 0; k < b.machines.length; k++) {
      const mb = machineBox(b, k);
      if (!mb) continue;
      if (!(
        mine.right > mb.left &&
        mine.left < mb.right &&
        mine.bottom > mb.top &&
        mine.top < mb.bottom
      ))
        continue;
      if (struckBoggs.has(String(k))) continue;
      struckBoggs.add(String(k));
      strikeMachine(b, k, mine.damage);
    }
    const art = celRec(level.sbk, boggsCel(b));
    if (!art) continue;
    const bb = {
      left: b.x - art.posX,
      right: b.x - art.posX + art.width,
      top: b.y - art.posY,
      bottom: b.y - art.posY + art.height,
    };
    if (!(
      mine.right > bb.left &&
      mine.left < bb.right &&
      mine.bottom > bb.top &&
      mine.top < bb.bottom
    ))
      continue;
    if (struckBoggs.has("body")) continue;
    struckBoggs.add("body");
    b.hp = Math.max(0, b.hp - mine.damage);
    // a fist is not a bolt, so it is the plain take
    boggsStruck(b, false);
  }
}

/**
 * The end of one — its death sound, {@link Foe.death}, and the award, once.
 *
 * Every class's death path is those three calls in some order: a blow that
 * empties the health, a burn that is {@link Foe.burns}' `dies` or runs out
 * `fatal`. The death sound goes through `0x40f090` rather than `0x40ef30`,
 * which is the same call with a different tail; the port does not tell them
 * apart.
 */
export function killFoe(e: Enemy, foe: Foe): void {
  const death = foe.deathFor?.(e) ?? foe.death;
  if (!death) return;
  if (foe.deathSound !== undefined)
    sound?.effect(foe.deathSound, e.x, e.y, foe.deathLead ? "lead" : "mix");
  e.state = "dead";
  e.anim = death;
  e.clock = 0;
  e.swing = false;
  // `0x45d0a7`, as in {@link react}; and a corpse struck again dies again from
  // the top, its one-shot reactions with it ({@link Foe.corpseTakesHits})
  if (death.kind !== undefined) {
    e.script = death.kind;
    e.tag = death.tag;
  }
  e.threw = false;
  e.linger =
    foe.linger ?? (foe.frail ? 0 : corpseFrames + (foe.lingerPlus ?? 0));
  /**
   * ...and it dies MOVING. `obj+0xc` is one word, and neither a class's hit
   * handler nor `0x45d090` installing the death writes it: the CHOPPER's
   * `0x454790` and `0x454863` leave it alone, and `0x454473` goes on clamping
   * it in state 5. This page keeps a walker's speed in `e.speed` and a
   * corpse's flight in `e.vx`, so the ride is handed from one to the other
   * here, or the bike stops dead on the frame it is killed.
   */
  if (e.speed && !foe.floats) {
    e.vx += e.speed * TICK_SCALE * e.facing;
    e.speed = 0;
  }
  stats.score += foe.award ?? foe.panel?.award ?? 0;
  // the flags three goals wait for — see {@link waitsFor}: `0x43d309`, the
  // bishop's `0x426600` and the named wraith's `0x4250eb`, and `0x419ac9`
  if (e.kind === "inithardcore") bossDown.hardcore = true;
  if (e.kind === "initvpriest" || (e.kind === "initwraith" && e.decisions !== 0))
    bossDown.belfry = true;
  if (e.kind === "inittube") bossDown.lab = true;
}

/**
 * Kragg's first bar is gone — {@link Foe.rallies} — and it is shot out of the
 * sky rather than killed. Two paths reach it and both do the same four things:
 * the blow at `0x441def` and the scald at `0x440c07`.
 *
 * - health to zero, and `[0x4a7574]` to the centre X of its region
 *   (`0x40ba30` copies the region record; `0x441e14`..`0x441e28` add half its
 *   width to its left), which is where the fall's first tag steers it and
 *   which the page keeps in {@link Enemy.home};
 * - `0x40ee90(bank, 0x17, 0)` lets its flying loop go ({@link FOE_SFX}
 *   `kraggFlies`);
 * - the scald alone zeroes both velocities (`0x440c59`, `0x440c69`); the blow
 *   leaves them;
 * - `0x473b60` tag 0 goes on, state 10, which its brain now runs.
 */
/**
 * The body stepper's floor and ceiling for a thing that flies — `0x42fd80`
 * holds every object to both, weight or none, and this page's floaters skip
 * the stepper's landing. Their states steer them (kragg's maul and dive at the
 * player's point, the eyeball's swoop, a bat's dive) and a velocity no state is
 * changing would otherwise carry one out of the room.
 *
 * - `0x42ff4c`: the foot within 8 of the region floor stands ON it; a vertical
 *   speed inside ±2 is zeroed (`0x42ff7b`), a bigger one is handed back
 *   through `obj+0x20` (`0x42ff83`) — the allocator's 0.25 (`0x42f5c0`), or
 *   kragg's 0.8 (`0x441c92`) turned round.
 * - `0x42ffbc`: the cel's top at or above the region's own is put back one
 *   below it (`0x42ffca`), and with the region's bit 1 and kragg's own flag 2
 *   (`0x441cb4` sets 0xf) the speed is handed back the same way.
 */
export function floaterInRegion(e: Enemy, foe: Foe, lvl: Level): void {
  const back = foe.restitution ?? 0.25;
  const floor = groundAt(e.x);
  const base = baseOf(e, lvl);
  if (floor !== null && base >= floor - 8) {
    e.y -= base - floor;
    e.vy = Math.abs(e.vy / TICK_SCALE) <= 2 ? 0 : e.vy * back;
  }
  const a = foeAnchor(e, lvl);
  const c = celRec(lvl.sbk, celOf(e));
  if (!p.room || !a || !c) return;
  const top = a.y - c.posY;
  if (top <= p.room.top) {
    e.y += p.room.top + 1 - top;
    if (p.room.flags & 1) e.vy *= back;
  }
}

export function rallyFall(
  e: Enemy,
  r: NonNullable<Foe["rallies"]>,
  stop: boolean,
): void {
  e.rallied = true;
  e.hp = 0;
  // `0x440c4b` / `0x441e34` — `0x40ee90(bank, 0x17, 0)`: the wing's loop let go
  sound?.loop(FOE_SFX.kraggFlies, false);
  e.state = "gait";
  e.swing = false;
  if (p.room) e.home = p.room.left + Math.trunc((p.room.right - p.room.left) / 2);
  if (stop) {
    e.vx = 0;
    e.vy = 0;
  }
  e.anim = r.fall;
  e.script = r.fall.kind;
  e.tag = r.fall.tag;
  e.clock = 0;
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
export function strikeFoe(
  e: Enemy,
  damage: number,
  shove: { dx: number; dy: number },
  from: number,
  mid: number,
  box: { top: number; left: number; bottom: number; right: number },
  /**
   * A CODE — and against a creature there is only one, which is fire.
   *
   * `0x448c84`'s range test is the player's table and −9 falls below it, so
   * against the player this lands as ordinary damage. Against a creature it is
   * read by a −9 arm of the class's own hit handler, before any of the
   * arithmetic below: `0x44f0aa`, `0x44f8bd`, `0x45296e`, `0x4547b3`,
   * `0x4550d3`, `0x45631e` and `0x441d30` here, and the crow's `0x4520d8` in
   * its own pass, and the mailbox's `0x44fe89`, the one on furniture. Kragg's
   * has a gate in front of it — {@link GATES} — and the two in the air are
   * casts'. See {@link Foe.burns} and `FLAME`.
   *
   * A class with no such handler is not set on fire and takes nothing, which
   * is why the flamer crosses these sixteen levels touching almost nothing.
   */
  code = 0,
  /**
   * Where the blow met the body — the middle of the two boxes' overlap, which
   * `0x43041e` hands the hit handler and the handler hands `0x40cba0` as the
   * point the goo leaves from.
   */
  contact?: { x: number; y: number },
  /**
   * The hitter, for `0x430470`'s exchange: its mass `obj+0xe`, its own velocity
   * in pixels a frame, and where its share of the exchange goes. The player's
   * fist by default.
   */
  hitter: {
    mass: number;
    vx: number;
    vy: number;
    recoil?: (vx: number, vy: number) => void;
    /** who it was, for the handlers that ask — see {@link Hitter} */
    by?: Hitter;
  } = {
    mass: DIVISOR,
    vx: p.vx,
    vy: p.vyRaw,
    recoil: (vx, vy) => {
      p.vx = vx;
      if (!p.onGround) p.vyRaw = vy;
    },
    by: { player: true },
  },
): void {
  if (!level) return;
  const foe = FOES[e.kind];
  // a handler that asks its own state first — `0x441d26`, and see {@link GATES}
  const gate = GATES[e.kind];
  let still = false;
  let quiet = false;
  let spare = false;
  if (gate) {
    const blow = gate(e, foe, { damage, code, by: hitter.by ?? {} });
    if (!blow) return;
    ({ damage, code } = blow);
    still = !!blow.still;
    quiet = !!blow.quiet;
    spare = !!blow.spare;
  }
  // a handler with no sign test takes a code as a blow like any other —
  // {@link Foe.codeBlind}, the bat's `0x4232f0`
  if (code < 0 && foe.codeBlind) code = 0;
  if (code === BURN_CODE) {
    const how = foe.burns;
    if (!how) return; // nothing in this class reads a −9
    if (!how.noFlame) burnFoe(e, how);
    // kragg's arm, in its own order: the hit sound, the spark, 0x13
    // (`0x441d41`, `0x441d60`, `0x441d72`)
    how.sounds?.forEach((set, i) => {
      const which = typeof set === "number" ? set : set[Math.floor(random() * set.length)];
      sound?.effect(which, e.x, e.y);
      if (i === 0 && how.spark) sparkAt(contact ?? { x: e.x, y: e.y - 70 });
    });
    // `0x4550d3`: the dog's arm is its death path, sound and award and all
    if (how.dies && foe.death) {
      killFoe(e, foe);
      return;
    }
    if (how.anim) {
      // a FLINCH even when it is fatal: the death is what the end of it
      // installs (`0x4526ef`), in {@link stepEnemies}, and a blow landed in
      // the meantime is read like any other — `0x452960` has no state test
      react(e, how.anim);
      e.swing = false;
    }
    // ...and every creature arm returns here and is done. The CHOPPER's
    // `0x4547b3` looked like the exception; it zeroes the health and its
    // negative strength is turned away at `0x4547f2` — see {@link GATES}
    if (!how.andHurts) return;
  }
  // the spray goes first, exactly as `0x40cba0` is called before the subtract —
  // and only for the kinds whose handler calls it at all
  const bleeds = typeof foe.bleeds === "function" ? foe.bleeds(e) : foe.bleeds;
  if (bleeds)
    spray(e, foe.sprayAmount ?? damage, shove, contact, bleeds === "scatter");
  // ...or a spark where the goo would have gone — {@link Foe.sparks}, kragg's
  // flying handler (`0x441db8`)
  else if (foe.sparks?.(e)) sparkAt(contact ?? { x: e.x, y: e.y - 70 });
  // and the kind's own sound, at the thing that was hit — see FOE_SFX for which
  // handler plays which index
  // ...unless this is the blow that kills and the class keeps the hit sound
  // for the ones that do not — {@link Foe.quietKill}
  const fatal = e.hp - (foe.oneHitEach ? 1 : damage) <= 0;
  if (foe.hitSound !== undefined && !quiet && !(foe.quietKill && fatal && !still)) {
    const set = foe.hitSound;
    // the roll is made whether or not anything is listening — see {@link sound}
    const which = typeof set === "number" ? set : set[Math.floor(random() * set.length)];
    sound?.effect(which, e.x, e.y);
  }
  // the fourth kind's handler keeps the damage only for the blood and takes a
  // single point off the health — `0x454821`, and see {@link Foe.oneHitEach}
  if (!spare) e.hp -= foe.oneHitEach ? 1 : damage;
  e.dents += 1;
  // the handler's own velocity write, which the exchange then reads back —
  // {@link Foe.hitVel}, the bat's `0x423334`
  if (foe.hitVel?.vx !== undefined) e.vx = foe.hitVel.vx * TICK_SCALE;
  if (foe.hitVel?.vy !== undefined) e.vy = foe.hitVel.vy * TICK_SCALE;
  // `0x43043b` — and the exchange of velocity, whoever it was, weighted by the
  // two masses; a thing bolted down is re-pinned by its own think (the
  // hydrant's `0x44fb43`), which this page says with {@link Foe.rooted}.
  // Only when the class's handler answers nonzero (`0x43042b`) — see
  // {@link Foe.noExchange}
  const turned =
    typeof foe.noExchange === "function" ? foe.noExchange(e) : !!foe.noExchange;
  if (damage > 0 && !turned) {
    const was = {
      vx: e.vx / TICK_SCALE + (e.vx === 0 && !foe.floats ? (e.speed ?? 0) * e.facing : 0),
      vy: e.vy / TICK_SCALE,
    };
    const v = knockback(
      hitter.mass,
      e.divisor ?? foe.divisor,
      { dx: shove.dx * from, dy: shove.dy },
      hitter,
      was,
    );
    if (!foe.rooted) {
      e.vx = v.vx * TICK_SCALE;
      e.vy = v.vy * TICK_SCALE;
      if (!foe.floats) e.speed = 0;
    }
    hitter.recoil?.(v.hvx, v.hvy);
  }
  // a blow the handler takes and answers 1 to, with no reaction — see {@link Gate}
  if (still) return;
  // a frail kind's handler never looks at health: one blow, whatever the blow.
  // The rat is the case — the launch is its death.
  /**
   * ...and one class stands up instead — see {@link Foe.rallies}.
   *
   * `0x441e4a` is the frame kragg's health runs out and it does not install the
   * death: it installs `0x473b60`, the fall — see {@link rallyFall}.
   */
  const spent = foe.survivesZero ? e.hp < 0 : e.hp <= 0;
  if (foe.rallies && !e.rallied && spent) {
    rallyFall(e, foe.rallies, false);
    return;
  }
  if ((foe.frail || spent) && foe.death) {
    killFoe(e, foe);
    // `0x4383d9`, `0x43a6f9`, `0x43908e`, `0x439af9` — the gang's four hit
    // handlers, on this frame
    if (foe.drops === "skateboard") dropBoard(e);
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
    react(e, over.anim);
    return;
  }
  if (!foe.flinch) return;
  // where the blow landed and which way it was facing — the two things the
  // handler consults besides the damage. "Where" is the contact's Y against the
  // victim's own point, `obj+6`: `|contact.y − self.y|` at `0x44f21e` (the
  // punk) and `0x452a87` (werec), and the signed pair at `0x41839d` (puke). A
  // blow handed in with no contact is taken at the middle of what struck
  const contactY = contact?.y ?? mid;
  const point = foeAnchor(e, level);
  const pointY = point?.y;
  const blow = {
    damage,
    // this blow included: `e.dents` was stepped above, and the boss's handler
    // counts its consecutive hits in `AI+0x12` (`0x456461`)
    hits: e.dents,
    dy: Math.abs(contactY - (pointY ?? (box.top + box.bottom) / 2)),
    facingAway: e.facing === from,
    contactY,
    pointY,
    contactX: contact?.x ?? (box.left + box.right) / 2,
    pointX: point?.x ?? e.x,
    playerX: p.x,
  };
  /**
   * ...and what the blow shakes OUT of it, before the animation is chosen.
   *
   * The Coke machine's two counters, kept where it keeps them: `AI+2`
   * ({@link Enemy.beat} here) steps on every blow under the burst, the light
   * ones included (`0x43b6c5`, `0x43b6ed`), and a MIDDLE blow that finds it
   * past two lets a can go and clears it (`0x43b6f5`, `0x43b710`); `AI+0`
   * ({@link Enemy.shaken}) counts the cans. A blow of seventy-five or more
   * throws everything left at once (`0x43b755`) and touches neither.
   */
  const shakes = foe.shakes;
  if (shakes) {
    const out = e.shaken ?? 0;
    let want = 0;
    if (damage >= shakes.bursts) want = shakes.holds - out;
    else {
      const counted = (e.beat ?? 0) + 1;
      e.beat = counted;
      if (damage >= shakes.counts && counted >= shakes.every) {
        want = 1;
        e.beat = 0;
      }
    }
    const n = Math.max(0, Math.min(want, shakes.holds - out));
    for (let i = 0; i < n; i += 1) canAt(e);
    e.shaken = out + n;
  }
  // a progressive kind advances one stage per blow instead of picking; a
  // hydrant's handler switches on the state it is already showing, not on how
  // hard it was hit
  const which = foe.progressive ? e.dents - 1 : foe.pick ? foe.pick(blow, e) : 0;
  if (foe.progressive && which >= foe.flinch.length) return; // beaten in already
  // ...and a pick of −1 is a handler that takes the blow and shows nothing:
  // the eyeball's on any cel but its three hover poses (`0x43e9d4`)
  if (which < 0) return;
  react(e, foe.flinch[Math.min(foe.flinch.length - 1, Math.max(0, which))]);
}

/**
 * Put a hit reaction on — the handler's `0x45d090`.
 *
 * Which writes the script's kind into `obj+0x18` and its tag into `obj+0x44`
 * (`0x45d0a7`) the moment the reaction goes on, so a second blow landing
 * during it — a {@link Foe.pick} or a {@link GATES} reading `e.script` — sees
 * the reaction's state and not the one the first blow interrupted. Only an
 * animation that says which script it is carries that over.
 *
 * And a blow wakes it: no handler tests the dormant state, and every reaction
 * ends by installing an awake one (the gang's run, `0x4398ee`; the cop's kind
 * 8, `0x41440e`; puke's stance, `0x4181c8`).
 */
function react(e: Enemy, anim: FoeAnim): void {
  e.state = "flinch";
  e.anim = anim;
  e.clock = 0;
  if (anim.kind !== undefined) {
    e.script = anim.kind;
    e.tag = anim.tag;
  }
  e.asleep = false;
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
export function spray(
  e: Enemy,
  damage: number,
  blow: { dx: number; dy: number },
  at?: { x: number; y: number },
  /**
   * The handler handed no hitter — `push 0` as the third argument (ghengis'
   * `0x422b73`, the hardcore's `0x43d28b`). `0x40cd70` finds it null and
   * `0x40ce7d`..`0x40ce9d` gives every gob `0x434540(0x50) - 0x28` on each
   * axis, −39..40, with nothing of the blow in it.
   */
  wild = false,
): void {
  // `0x40cd53`: from the point the handler was given — the contact — and,
  // for the callers that have none, about where a body is struck
  const from = at ?? { x: e.x, y: e.y - 70 };
  const loose = (): number => 1 + Math.floor(random() * 0x50) - 0x28;
  for (let n = 0; n < gobCount(damage); n++) {
    gobs.push({
      x: from.x,
      y: from.y,
      // the blow's own pair, scattered, written straight into `obj+0xa` and
      // `obj+0xc` (`0x40cdb6`) — a velocity, which the class's divisor of 2
      // never touches: that only scales a script's own steps (`0x42f8b0`)
      vx: (wild ? loose() : scatter(blow.dx * p.facing)) * TICK_SCALE,
      vy: (wild ? loose() : scatter(blow.dy)) * TICK_SCALE,
      age: 0,
      mirror: random() < 0.5,
      stage: -1,
      holds: 0,
    });
  }
}

/**
 * The player's own spray — `0x40c900`, and {@link BLEED} has the whole of it.
 *
 * From `at`, the point the caller hands it: the contact for a blow
 * (`0x42ebd3`), the player's own `obj+6` for everything else. With a
 * `striker`, the drops leave along its cel's blow pair plus a quarter of its
 * sideways speed and all of its fall; without one, anywhere within fifteen.
 * Sweat while the tank is two thirds full and `n` is not negative, blood
 * otherwise — `empty` for the one caller that has already spent the tank
 * (the fan, `0x4154c4`) and this page does not.
 */
export function bleed(
  n: number,
  at: { x: number; y: number },
  striker?: { blow: { dx: number; dy: number } | null; facing: number; vx: number; vy: number },
  empty = false,
): void {
  const [num, den] = BLEED.bleeds;
  const kind =
    empty || n < 0 || Math.trunc((stats.maxHealth * num) / den) > stats.health ? "blood" : "sweat";
  const loose = (): number => 1 + Math.floor(random() * BLEED.loose) - BLEED.loose / 2;
  for (let i = 0; i < dropCount(n); i++) {
    let vx: number, vy: number;
    if (striker) {
      const pair = striker.blow ?? { dx: 0, dy: 0 };
      // `0x40c9d9`: the hitter's own `obj+0xc`, a quarter of it, rounded toward
      // zero; the mirror at `0x40ca09` turns the pair and leaves the speed its own
      vx = scatter(pair.dx * (striker.facing < 0 ? -1 : 1) + Math.trunc(striker.vx / 4));
      vy = scatter(pair.dy + striker.vy);
    } else {
      vx = loose();
      vy = loose();
    }
    gobs.push({
      x: at.x,
      y: at.y,
      vx: vx * TICK_SCALE,
      vy: vy * TICK_SCALE,
      age: 0,
      mirror: random() < 0.5,
      stage: -1,
      holds: 0,
      kind,
    });
  }
}

/** the player's `obj+6` — the anchor, which is where `0x40c900`'s other callers throw from */
function ownPoint(): { x: number; y: number } {
  return { x: p.x, y: p.y - p.feet };
}

/** the goo — in the air, or a puddle on the pavement */
export let gobs: Gob[] = [];
/** the green balls bodies leave behind — see {@link VANISH} */
export let pops: Pop[] = [];
/** kragg's sparks — see {@link SPARK} */
export let sparks: Spark[] = [];

/** `0x4424a0(point)` — one spark, flying off sideways at its own random speed */
export function sparkAt(at: { x: number; y: number }): void {
  sparks.push({
    x: at.x,
    y: at.y,
    vx: 1 + Math.floor(random() * SPARK.across) - SPARK.across / 2,
    vy: 0,
    age: 0,
  });
}

/**
 * Step every gob: the arc, the landing, the merge and the drying.
 *
 * `0x40c480`'s, with the mover's fall: the allocator's gravity of ten, no cap.
 * When it arrives the velocity is zeroed where it lands, a gob landing on an
 * existing puddle advances that puddle instead of making its own, and a puddle
 * steps back down a stage every 40 to 79 frames until it is gone.
 */
export function stepGobs(): void {
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
    // the allocator's gravity, ten a frame² (`0x42f5ca`) — the effect class's
    // init `0x40c3c0` sets its divisor and nothing else — added after the move
    // and never capped (`0x430322`)
    const was = g.y;
    g.x += g.vx;
    g.y += g.vy;
    g.vy += 10 * TICK_SCALE * TICK_SCALE;
    // it lands on the region's floor and nothing else: `0x40c401` leaves
    // `obj+0x34` at 0, so the mover never searches the platforms for it
    // (`0x42fe4a`) — see {@link regionFloorUnder}
    const floor = ground(g.x);
    if (floor === null || g.y < floor) continue;
    // the sweat is gone the frame it lands: kind 3's switch answers 1 on
    // `obj+0x2e` in both its tags (`0x40c7a6`, `0x40c7bb`) and never pools
    if (g.kind === "sweat") {
      g.age = SPRAY.life;
      continue;
    }
    // landed. `0x40c810` looks for a puddle already here; if there is one it
    // grows and this gob is spent, which is how twenty gobs make one mess
    const pool = gobs.find(
      (q) => q !== g && q.stage >= 0 && Math.abs(q.x - g.x) < 40,
    );
    if (pool) {
      pool.stage = Math.min(SPRAY.pool.length - 1, pool.stage + 1);
      pool.holds = dryTime();
      // ...on the lander's own script (`0x40c591` / `0x40c6f3`), so blood
      // falling on goo turns the puddle red and goo on blood turns it green
      pool.kind = g.kind;
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
  // the spark: moved by its velocity, then the gravity added (`0x430322`),
  // and gone as its script ends (`0x442635`)
  for (const k of sparks) {
    k.x += k.vx * TICK_SCALE;
    k.y += k.vy * TICK_SCALE;
    k.vy += SPARK.gravity * TICK_SCALE;
    k.age += TICK_SCALE;
  }
  sparks = sparks.filter((k) => k.age < SPARK.cels.length * SPARK.hold);
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
export function claimBar(): void {
  let best = 1024;
  let won: Enemy | null = null;
  for (const e of spawnedHere()) {
    if (!FOES[e.kind].panel || e.state === "dead") continue;
    const d = Math.abs(p.x - e.x) + Math.abs(p.y - e.y);
    if (d >= best) continue;
    best = d;
    won = e;
  }
  /**
   * ...and BOGGS, which enters the same competition and is not a creature.
   *
   * `0x41bead` runs `0x40d1c0(0x4a50e8, 0x40e300(0xfa0), 0x33fa, head.pos)` out
   * of the body's own tick once a frame, at the HEAD's point. Nothing else in
   * VAT counts, so without this the last level of the game is the only one whose
   * right-hand bar never says anything — which is what it did here.
   *
   * The machinery does NOT enter it: `0x41b510` never calls `0x40d1c0`, so how
   * much is left of either breakable half is not a thing the disc ever shows
   * you. This page's debug line is the only place it appears.
   */
  let boggs: Boggs | null = null;
  for (const g of hereOf((l) => l.boggs)) {
    if (g.dying) continue;
    const d = Math.abs(p.x - g.headX) + Math.abs(p.y - g.headY);
    if (d >= best) continue;
    best = d;
    boggs = g;
  }
  if (boggs) {
    stats.shown = {
      health: Math.max(0, boggs.hp),
      max: scaled(BOGGS.health),
      nameCel: BOGGS.plate,
    };
    return;
  }
  if (!won) return;
  stats.shown = {
    health: Math.max(0, won.hp),
    max: won.max,
    nameCel: won.plate ?? FOES[won.kind].panel!.plate,
  };
}

/**
 * Where a hitter's strike box is, in the world.
 *
 * `0x430375` reads the CURRENT cel's own strike rect and skips a hitter whose is
 * degenerate, which is what makes a blow two frames of an animation rather than
 * the whole of it.
 *
 * And the rect goes into the world by TRANSLATION and nothing else. `0x40e680`
 * copies the cel's four words, negates the x pair if the object is mirrored, and
 * hands the result to `0x434270` — a rect translate — with the object's own
 * packed `obj+6`. So the box hangs off the anchor exactly the way the art does
 * in {@link drawLevelCel}, and there is no width or height in the arithmetic at
 * all.
 *
 * This read it as measured from the cel's top-left instead, which lifted every
 * prop's box by `height - posY`. On SEWER's bush that is sixty-four pixels, and
 * sixty-four pixels is the whole of why it could not reach a standing player:
 * the rise passed straight through you and the grab only landed once it had sunk
 * far enough to make the error back up. See {@link BUSH}.
 *
 * `y` here is the object's own — the engine's `obj+6`, which is what every
 * record-placed prop on this page stores. The PLAYER is the one that is not:
 * `p.y` is the ground it stands on, which is why {@link playerBody} converts and
 * this does not.
 */
export function strikeOf(
  cel: SbkCel,
  x: number,
  y: number,
  facing: number,
): { top: number; left: number; bottom: number; right: number } | null {
  if (!cel.strike) return null;
  // `0x40e6a2` — a mirrored rect is negated about the anchor, not flipped in a
  // box: `x0' = -x1` and `x1' = -x0`
  const [cx0, cx1] =
    facing < 0
      ? [-cel.strike.x1, -cel.strike.x0]
      : [cel.strike.x0, cel.strike.x1];
  return {
    left: x + cx0,
    right: x + cx1,
    top: y + cel.strike.y0,
    bottom: y + cel.strike.y1,
  };
}

/**
 * The player's own body box, from the cel showing now — and the reason a
 * knockdown is safe.
 *
 * `0x4303b3` skips a victim whose current cel has a degenerate body box, so
 * being untouchable is a property of the ART and not of a timer.
 *
 * The cels listed here before — 5900..5902, 5910..5915, 5940..5944, 9550..9558,
 * 5020/5021 — are CHARACTER 1's, and character 1 does carry no box through any
 * reaction. Character 0, which is what this page plays, is not so lucky: of its
 * 38 reaction cels twelve carry a body box — 922, the held loop 4570..4572, the
 * struggle 4575..4579 and the jolt 460..462. So a grab does NOT make you
 * untouchable here; a knockdown does.
 */
export function playerBody(): {
  top: number;
  left: number;
  bottom: number;
  right: number;
} | null {
  const rec = celRec(player, lastCel);
  if (!rec?.body) return null;
  // ...and the same translation `0x40e680` does, about the anchor — see
  // {@link strikeOf}. `p.x` IS the anchor's x (the art is drawn at `x - posX`),
  // so only the y needs converting: `p.y` is the ground the player stands on and
  // the anchor sits `height - posY` above it, which is where the art's bottom
  // edge falls.
  const [cx0, cx1] =
    p.facing < 0 ? [-rec.body.x1, -rec.body.x0] : [rec.body.x0, rec.body.x1];
  const ay = p.y - rec.height + rec.posY;
  return {
    left: p.x + cx0,
    right: p.x + cx1,
    top: ay + rec.body.y0,
    bottom: ay + rec.body.y1,
  };
}

/**
 * `0x40d350` — a NEGATIVE argument is a gift of time, and the dial is the cap.
 *
 * ```
 *   40d355  if (n >= 0)  [0x4a4d68] = n;  return      ; positive SETS the clock
 *   40d361  [0x4a4d68] -= n                           ; ...negative adds
 *   40d378  if ([0x4a3b18] < [0x4a4d68])  [0x4a4d68] = [0x4a3b18]
 * ```
 *
 * `[0x4a3b18]` is the dial's full scale, which every chapter's entry function
 * fills from the same `timer` record it fills the clock from — see
 * {@link clockFor}. So the clock pickup and `jetson` both hand over 850 and
 * neither can wind a level past the time it was authored with.
 */
export function addClock(n: number): void {
  stats.ticks = Math.min(stats.clockFull, stats.ticks + n);
}

/** `0x402ac0` — take it off, floor at zero, and start dying if that empties it */
export function takeHealth(n: number): void {
  stats.health = Math.max(0, stats.health - Math.round(n));
  if (stats.health > 0 || p.act === "dying") return;
  // `0x402f60` refuses a second death while the first is playing, and `0x402fa0`
  // installs `0x476758` tag 0 — the kind that IS being dead — having called
  // `0x402df0` first: every key dropped
  dropKeys();
  p.dyingTag = 0;
  p.act = "dying";
  p.actClock = 0;
  p.vx = 0;
}

/** `0x402f00`'s four: the judder, held, the spawn pose, knocked down */
const HELPLESS: ReadonlySet<string> = new Set(["jolt", "held", "struggle", "grabbed", "posed", "downFront", "downBack"]);

/**
 * `0x402fa0(mode)`, the player's pose setter — `0x402df0` drops every key,
 * then `0x42f280` puts out a running stream (`0x42e700`) and jumps through
 * `0x42f418` on `mode + 1`:
 *
 * ```
 *   -1  0x42f29b  0x471b18 tag 0, the spawn pose (kind 13), and nothing else
 *    2  0x42f319  0x4722a8 tag 0, the knockdown — unless he is on a ladder or
 *                 a bar (`[0x46b1bc] = 1` instead), already down (kind 0x18),
 *                 or dying (`0x402f60`)
 *    3  0x42f36d  0x4720e8 tag 0, held
 *    4  0x42f383  0x471fc8 tag 0, the judder (kind 9)
 * ```
 *
 * Character 1's own setter `0x449700` is the same table on its own scripts.
 * The ladder's flag is {@link knockedOff}.
 */
export function posePlayer(mode: -1 | 2 | 3 | 4): void {
  dropKeys();
  killStreams();
  let act: string;
  if (mode === -1) act = "posed";
  else if (mode === 2) {
    // `0x42f363` — on a ladder or a bar, no knockdown: knocked off instead
    if (hanging()) {
      knockedOff = true;
      return;
    }
    // `0x42f334` / `0x42f33f` — already down, or dying. The knockdown is the
    // only mode that asks the second: -1, 3 and 4 put their pose over a death
    // too, and the next health taken (`0x402ac0`, even none) starts it again
    if (p.act === "downFront" || p.act === "downBack" || p.act === "dying") return;
    act = "downFront";
  } else if (mode === 3) act = "held";
  else act = "jolt";
  p.act = act;
  p.actClock = 0;
}

/** a grabber writing the player's point and, where it does, his velocity and facing */
export function pinPlayer(
  at: { x: number; y: number },
  v?: { vx?: number; vy?: number; facing?: number; fell?: number },
): void {
  p.x = at.x;
  // the point is the ANCHOR and `p.y` is the feet — see {@link poseFeet}
  p.y = at.y + p.feet;
  p.onGround = false;
  if (v?.vx !== undefined) p.vx = v.vx;
  if (v?.vy !== undefined) {
    p.vyRaw = v.vy;
    p.vy = 0;
    // `0x42fdb0` — a vertical speed that is not downward is no fall at all
    if (v.vy <= 0) p.fallPx = 0;
  }
  if (v?.facing !== undefined) p.facing = v.facing > 0 ? 1 : -1;
  // `obj+0x32`, the fall so far — the eyeball's `0x43e39b` writes it to nothing
  if (v?.fell !== undefined) p.fallPx = v.fell;
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
export function gripAt(
  id: number,
  x: number,
  y: number,
  facing = 1,
): { x: number; y: number } | null {
  const cel = celRec(level?.sbk, id);
  return gripOf(cel, cel ? strikeOf(cel, x, y, facing) : null);
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
export function takeCode(
  code: number,
  grip?: () => { x: number; y: number } | null,
  what?: object,
  /** what struck, for the one reaction whose spray follows it (`0x42eb15`) */
  striker?: Parameters<typeof bleed>[2],
): boolean {
  const r = BLOW_CODES[code];
  if (!r) return false;
  // `0x448c19` and `0x448c40`: the FIRST thing the player's handler does, before
  // it has even looked at the strength, is cancel a running stream with -1
  killStreams();
  // the same thing, still holding you: `0x43045d` disarms a hitter the frame it
  // connects and the classes re-arm on the next, so without this the reaction
  // restarts every frame and the grab never reaches its own loop
  if (r.holds && what && p.heldWhat === what) return r.consumes;
  // `0x42e99d` / `0x42ea3c` — the grab and the jolt ask first whether he is
  // on a ladder or a bar, and there they install nothing: they knock him off
  // (`0x42ea26`, `0x42ea9c`) and answer 1
  if ((code === -3 || code === -2) && hanging()) {
    knockedOff = true;
    return true;
  }
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
  // No reaction in CHARACTER 0's table shoves — the ±50 this page used to apply
  // is `0x448cf4`, in character 1's. Kept because the field is still read.
  if (r.shove) p.vx -= r.shove * p.facing;
  if (r.sound !== undefined) {
    const which = r.sound + (r.soundRoll ? roll(r.soundRoll) : 0);
    sound?.own(which, p.x, p.y, r.soundWay);
  }
  // `0x42e7f6` hands the spray nothing to follow and `0x42eb21` the striker,
  // and −1's goes before its twenty come off (`0x42eb2b`)
  if (r.spray !== undefined) bleed(r.spray, ownPoint(), r.spray < 0 ? striker : undefined);
  // ...and `-1` spends twenty: `0x42eb2b` is `0x402ac0(0x14)`, the only reaction
  // in character 0's eight that costs health. Behind the damage switch, like
  // every other way the game takes a point off you.
  if (r.health && damageOn && p.act !== "dying") takeHealth(r.health);
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
/**
 * ...and what a creature swings or throws lands on the OTHER creatures too.
 *
 * `0x42fc9a` runs the hit pass `0x430350` for every object against every
 * object, not for the player against the rest: a strike box over anybody's
 * body box goes to that body's own hit handler. What stops a crowd of punks
 * felling each other is the HANDLERS — each turns away its own class first
 * (the dog's `0x430ee0([0x476a90])` at `0x455139`, the CHOPPER's `0x4547e1`)
 * and a negative strength that is not fire — so a punk's kick lands on the
 * CHOPPER, a skeleton's bone on a zombie, the CHOPPER's sink blast on whatever
 * lies under it, and the handler pays its award as it always does.
 *
 * The arithmetic is the player's (`0x42f910`, see {@link takeHits}). A thrown
 * thing is spent on the first body that takes it (`0x430470` sets `obj+0x2a`;
 * the blast, 0x65, is the exception and keeps hitting), and a swing lands once
 * per body per script, the way a flinch outlasts the frames that carry a box.
 * Under the creature switch, like every other creature blow.
 */
export const struckBy = new WeakMap<object, { anim: unknown; hit: Set<Enemy> }>();
/**
 * ...and the handlers that turn away MORE than their own class — the three
 * throwers whose handler refuses the thing they throw themselves, so none is
 * felled by what it has just let go in front of itself:
 *
 * - the igor's `0x4256e0` / `0x4256f8`: the bats' list `[0x46ecc4]`, then
 *   `[0x46ecd0]` — the thrown class `0x421310` makes, which is its own lob AND
 *   the skeleton's bone;
 * - the bishop's `0x426500` / `0x426518`: its bolt's `[0x46ecdc]`, then bats;
 * - PLAYGR's boss, `0x456310`: its fireballs' `[0x4782d8]` (`0x45635e`), then
 *   the dogs' `[0x476a90]` (`0x456376` — the list the dog's own handler turns
 *   its kind away with at `0x455139`).
 * - the gang of chapter five, whose four handlers read the same list: the
 *   roller's `[0x472564]` (`0x43a790` makes it), the knotboy's `[0x4740b4]`,
 *   the knife class `[0x4a7578]` (both of the knifeboy's throws, `0x43a462` /
 *   `0x43a512`), the batboy's `[0x4740ac]`, the maskboy's `[0x4740b0]` and the
 *   knifeboy's own `[0x4740a8]` (registered for `0x439bd0` at `0x439bbd`) —
 *   `0x438263`..`0x4382f4` (knotboy), `0x438f03`..`0x438f94` (maskboy),
 *   `0x439983`..`0x439a14` (batboy), `0x43a583`..`0x43a614` (knifeboy). The
 *   roller never lands on a creature here, so only the four and the knives
 *   are listed;
 * - the TCop's `0x4147d0`: the slurp's `[0x46c9e4]` (`0x4147e7`) and its own
 *   slug's `[0x46c620]` (`0x4147ff`) — and not its own class, so cops hurt
 *   cops ({@link Foe.hitsOwn});
 * - the tube's `0x419990`: its own glass `[0x46bfb4]` (the shards and the
 *   breath), puke's spit `[0x46cc60]` and the arm's `[0x46d1b0]`
 *   (`0x4199c3`…`0x419a05`);
 * - the CHOPPER's `0x454804`: the dogs' `[0x476a90]`, after its own class;
 * - the brain's `0x415100`: a TCop, class `[0x46c9e0]` (`0x415110`), and the
 *   tube's thrown glass `[0x46bfb4]` (`0x415170`), beside its own;
 * - the dog's `0x4550b0`: after its own class, the punk's `[0x47760c]`
 *   (`0x455150`, the list `0x450a61` fills) and the CHOPPER's `[0x477c34]`
 *   (`0x455168`);
 * - the skeleton's `0x423a30`: the thrown class `[0x46ecd0]` (`0x423a33`),
 *   the bats' `[0x46ecc4]` (`0x423a52`), then its own;
 * - the zombie's `0x4209f0`: the bats' `[0x46ecc4]` (`0x420a13`), and nothing
 *   else — not even its own class ({@link Foe.hitsOwn});
 * - kragg's `0x441cf0`: its own shots' `[0x472568]` (`0x441cff`);
 * - the wraith's `0x424f80`: the bats' `[0x46ecc4]`, its own class and the
 *   thrown class `[0x46ecd0]` (`0x424f90`..`0x424fc0`);
 * - ghengis' `0x422ad0`: its own class `[0x46f048]` — whose blast, and whose
 *   nine pieces, are objects of it (`0x422c60`) — then `[0x46ecd0]` and the
 *   surge's `[0x46ecc8]` (`0x422afb`..`0x422b41`). The pieces are casts of
 *   their own each time and are not listed; their strength is held at zero
 *   while they fly (`0x4229d2`).
 */
export const GANG = {
  kinds: ["initknotboy", "initbatboy", "initmaskboy", "initknifeboy"],
  kits: [KNIFEBOY_KNIFE, KNIFEBOY_LOB],
};
export const SPARES: Record<string, { kinds: readonly string[]; kits: readonly CastKit[] }> = {
  initigor: { kinds: ["initbat"], kits: [IGOR_THROW, SKEL_BONE] },
  initvpriest: { kinds: ["initbat"], kits: [VPRIEST_BOLT] },
  initwbooly: { kinds: ["initdog"], kits: [WBOOLY_HIGH, WBOOLY_LOW] },
  initknotboy: GANG,
  initbatboy: GANG,
  initmaskboy: GANG,
  initknifeboy: GANG,
  initwered: { kinds: ["initdog"], kits: [] },
  initslurp: { kinds: ["initcop"], kits: [...TUBE_SHARDS] },
  initcop: { kinds: ["initslurp"], kits: [COP_SLUG] },
  inittube: { kinds: ["initarm"], kits: [...TUBE_SHARDS, TUBE_BREATH, PUKE_GOB] },
  initdog: { kinds: ["initwerea", "initwered"], kits: [] },
  initskel: { kinds: ["initbat"], kits: [IGOR_THROW, SKEL_BONE] },
  initzomb: { kinds: ["initbat"], kits: [] },
  initkragg: { kinds: [], kits: [KRAGG_SHOT_AIR, KRAGG_SHOT_GROUND] },
  initwraith: { kinds: ["initbat"], kits: [IGOR_THROW, SKEL_BONE] },
  initghengis: { kinds: [], kits: [IGOR_THROW, SKEL_BONE, GHENGIS_BLAST] },
};
export function foesStrikeFoes(): void {
  const lvl = level;
  if (!lvl || !foesHurt) return;
  const bodies = spawnedHere().filter(takesBlows);
  const land = (
    who: object,
    kind: string | null,
    anim: unknown,
    cel: SbkCel,
    x: number,
    y: number,
    facing: number,
    vx: number,
    vy: number,
    code: number,
    mass: number,
    recoil: (vx: number, vy: number) => void,
    kit: CastKit | null = null,
  ): boolean => {
    if (code === 0 || (code < 0 && code !== BURN_CODE)) return false;
    const box = strikeOf(cel, x, y, facing);
    if (!box) return false;
    let mem = struckBy.get(who);
    if (!mem || mem.anim !== anim) struckBy.set(who, (mem = { anim, hit: new Set() }));
    let landed = false;
    for (const v of bodies) {
      if (v === who || mem.hit.has(v)) continue;
      // most handlers turn their own class away; {@link Foe.hitsOwn} are the ones that do not
      if (v.kind === kind && !FOES[v.kind].hitsOwn) continue;
      const spares = SPARES[v.kind];
      if (spares && ((kind && spares.kinds.includes(kind)) || (kit && spares.kits.includes(kit)))) continue;
      if (v.state === "flinch" && v.anim.terminal) continue;
      const vc = celRec(lvl.sbk, celOf(v));
      // `0x4303b3` — a body whose cel has no box takes nothing
      if (!vc?.body) continue;
      const hb = hurtBox(v, vc, lvl);
      if (!(box.right > hb.left && box.left < hb.right && box.bottom > hb.top && box.top < hb.bottom))
        continue;
      let damage = 0;
      if (code > 0) {
        const pair = cel.blow ?? { dx: 0, dy: 0 };
        const whole = code === 100 || code === 0x65;
        const moving = code === 0x65 ? 0 : 1;
        const bx =
          (whole ? pair.dx : Math.trunc((pair.dx * code) / 100)) * (facing < 0 ? -1 : 1) +
          vx * moving;
        const by = (whole ? pair.dy : Math.trunc((pair.dy * code) / 100)) + vy * moving;
        damage = Math.floor(Math.sqrt(bx * bx + by * by));
        if (damage === 0) continue;
      }
      mem.hit.add(v);
      landed = true;
      strikeFoe(
        v,
        damage,
        cel.blow ?? { dx: 0, dy: 0 },
        facing,
        (box.top + box.bottom) / 2,
        hb,
        code < 0 ? code : 0,
        {
          x: (Math.max(box.left, hb.left) + Math.min(box.right, hb.right)) / 2,
          y: (Math.max(box.top, hb.top) + Math.min(box.bottom, hb.bottom)) / 2,
        },
        { mass, vx, vy, recoil, by: { kind, kit } },
      );
    }
    return landed;
  };
  for (const e of spawnedHere()) {
    if (e.state === "dead" && e.strength !== 0x65) continue;
    if (e.state === "burst") continue;
    const c = celRec(lvl.sbk, celOf(e));
    if (!c?.strike) continue;
    const a = foeAnchor(e, lvl) ?? { x: e.x, y: e.y };
    const vx = e.vx / TICK_SCALE + (e.vx === 0 ? (e.speed ?? 0) * e.facing : 0);
    const foe = FOES[e.kind];
    land(e, e.kind, e.anim, c, a.x, a.y, e.facing, vx, e.vy / TICK_SCALE, e.strength ?? 100,
      e.divisor ?? foe.divisor, (hvx, hvy) => {
        if (foe.rooted) return;
        e.vx = hvx * TICK_SCALE;
        e.vy = hvy * TICK_SCALE;
        if (!foe.floats) e.speed = 0;
      });
  }
  for (const c of casts) {
    if (c.spent || c.landed !== undefined) continue;
    const code = castBlow(c);
    const cel = celRec(lvl.sbk, castCel(c));
    if (!cel?.strike) continue;
    // a cast is a class of its own, so it turns away nobody — though two
    // handlers turn IT away ({@link SPARES})
    const hit = land(c, null, c, cel, c.x, c.y, c.facing, c.vx, c.vy, code, c.kit.divisor ?? 1,
      (hvx, hvy) => {
        c.vx = hvx;
        c.vy = hvy;
      }, c.kit);
    if (hit && code !== 0x65) {
      if (c.kit.flyOn) c.struck = true;
      else c.spent = true;
    }
  }
}

export function takeHits(): void {
  if (!level || !player) return;
  // already staggering, already down, already dead: no body box, nothing to hit
  if (p.act === "dying") return;
  // ...and with the switch off and nothing in the room that carries a code,
  // there is nothing this function can do, so it does not look for the body box.
  // The wraith counts: it is the one CREATURE whose strength is a code.
  if (
    !damageOn &&
    !hereOf((l) => l.claws).length &&
    !hereOf((l) => l.hands).length &&
    !hereOf((l) => l.surges).length &&
    !hereOf((l) => l.bushes).length &&
    !hereOf((l) => l.boggs).some((b) => b.zap.armed)
  )
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
    if (!(
      box.right > mine.left &&
      box.left < mine.right &&
      box.bottom > mine.top &&
      box.top < mine.bottom
    ))
      return false;
    // `0x448c72` reads the SIGN first: a code is dispatched and the arithmetic
    // below never runs. A grab cel proves the order matters — 1556 and 2456
    // carry a strike box and no blow pair at all, so a damage-first reading
    // would throw the hold away before it got here.
    // ...and a CODE comes through whatever the damage switch says, because it is
    // not damage: no reaction in the table takes a point of health off anybody.
    // The switch is this port's, to keep the page walkable; the grab is the
    // game's, and turning one off has never had anything to do with the other.
    if (code < 0) return takeCode(code, grip, what, { blow: cel.blow, facing, vx, vy });
    // `0x430367`: a hitter whose strength is nothing hits nothing
    if (code === 0) return false;
    /**
     * `0x42f910`: the cel's own pair, scaled by the hitter's strength, plus
     * whatever the hitter was doing, rooted.
     *
     * A cel with a strike box and NO pair is still a blow: its pair reads as
     * zero and the hitter's own velocity is the whole of it. The rat's pounce
     * (3002..3005), the dog's bite (4824, 4825, 4831) and wbooly's walk are
     * all that shape, and all three hurt by how fast they arrive. The one
     * exception is 0x65, the blast, which takes the pair as it stands and
     * nothing of the hitter's (`0x42f9b8`).
     */
    const pair = cel.blow ?? { dx: 0, dy: 0 };
    const whole = code === 100 || code === 0x65;
    const moving = code === 0x65 ? 0 : 1;
    const bx =
      (whole ? pair.dx : Math.trunc((pair.dx * code) / 100)) *
        (facing < 0 ? -1 : 1) +
      vx * moving;
    const by = (whole ? pair.dy : Math.trunc((pair.dy * code) / 100)) + vy * moving;
    // `0x434630` is an integer square root: the magnitude is whole, rounded down
    const damage = Math.floor(Math.sqrt(bx * bx + by * by));
    if (damage === 0) return false;
    // `0x42ebda` / `0x42ed21` — hanging or not, the blow's own drops go first,
    // from where it landed, before the cry and before the health they are
    // coloured by comes off
    bleed(
      damage,
      {
        x: (Math.max(box.left, mine.left) + Math.min(box.right, mine.right)) / 2,
        y: (Math.max(box.top, mine.top) + Math.min(box.bottom, mine.bottom)) / 2,
      },
      { blow: cel.blow, facing, vx, vy },
    );
    // `0x42ebb1` — on a ladder or a bar there is no reaction and no disarm: the
    // cry (`0x42ed34`, 0xe + roll(7)) and the health (`0x42ed4f`), and he is
    // knocked off if a room holds him (`0x42ed84`), which is also the answer
    if (hanging()) {
      const cry = OWN.hurt[Math.floor(random() * OWN.hurt.length)];
      sound?.own(cry, p.x, p.y);
      takeHealth(damage);
      if (!roomHolds()) return false;
      knockedOff = true;
      return true;
    }
    // `0x44915c` / `0x44919e`: which side it came from decides the take
    const front = x > p.x === p.facing > 0;
    const knocked = damage > HURT.knockdown;
    p.act = knocked
      ? front
        ? "downFront"
        : "downBack"
      : front
        ? "hurtFront"
        : "hurtBack";
    p.actClock = 0;
    const hurt = OWN.hurt[Math.floor(random() * OWN.hurt.length)];
    sound?.own(hurt, p.x, p.y);
    // ...and a knockdown takes the gun out of your hands. The same `cmp di, 0x3c`
    // that chose the animation is the disarm's test too: `0x44911b` asks
    // `0x448bf0` whether `player+0x18` is one of the five armed kinds (0x12..0x16)
    // and, if it is, `0x45b060` throws the weapon on the floor exactly the way
    // reaching for another one does, clears `[0x479438]` and redraws the panel
    // (`0x40d4f0`). The other player class carries its own copy of the same six
    // instructions at `0x42ec07`, so it is both of them, not one.
    //
    // A CODE never gets here — `0x448c72` dispatched it before the arithmetic —
    // so a claw's grab and a wraith's hold leave you armed.
    if (knocked && inv.drawn) dropGun();
    // ...and asks it of `player+0x18`, not `0x479438`: with your fists out the
    // gun stays yours. Either way the knockdown `0x476890` is kind 24, unarmed
    if (knocked) inv.drawn = false;
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
    const cel = celRec(lvl.sbk, clawCel(c));
    if (!cel?.strike) continue;
    /**
     * `obj+0x2a` is set by the COLLISION, not by the damage — the exchange
     * `0x43043b` runs once the victim's handler takes the blow, and it marks the
     * hitter (`0x430663`) whatever the blow pair says. The claw's
     * jaw cels carry a strike box and no pair at all, so asking `hit` to report
     * contact would never mark one: the dive would touch you and go back up.
     */
    const reach = strikeOf(cel, c.x, c.y, 1);
    if (
      c.state === "dive" &&
      reach &&
      reach.right > mine.left &&
      reach.left < mine.right &&
      reach.bottom > mine.top &&
      reach.top < mine.bottom
    )
      c.caught = true;
    // `0x417208` gives it a hundred at the top of every think and only the
    // CLAMP (`0x417485`) writes the code, so a dive is a real blow and the grab
    // is what the blow leads to — see {@link Claw.caught}
    const code = c.state === "clamp" ? CLAW.grab : CLAW.blow;
    if (
      hit(cel, c.x, c.y, 1, 0, 0, code, () => gripAt(clawCel(c), c.x, c.y), c)
    )
      return;
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
    const cel = celRec(lvl.sbk, handCel(q));
    if (!cel?.strike) continue;
    const kind = q.underfoot ? HAND.underfoot : HAND.anywhere;
    if (
      hit(
        cel,
        q.atX,
        q.atY,
        1,
        0,
        0,
        kind.blow,
        () => gripAt(handCel(q), q.atX, q.atY),
        q,
      )
    )
      return;
  }
  // ...and SEWER's bush, whose last seven cels are a grip and whose blow is -3
  for (const q of hereOf((l) => l.bushes)) {
    const cel = celRec(lvl.sbk, bushCel(q));
    if (!cel?.strike) continue;
    // `0x43ee9d` against `0x43eedb`: the grab while it is still reaching, and the
    // half-gravity slump from the frame it has you — see {@link BUSH.grab}. A
    // partner's lash is the grab on every frame (`0x43f111`)
    const code =
      q.state === "lash" || q.phase === 0 ? BUSH.grab : BUSH.slump;
    // mirrored about its anchor with the object, as `0x4026d0` builds the rect
    const facing = q.mirror ? -1 : 1;
    if (
      hit(cel, q.x, q.y, facing, 0, 0, code, () => gripAt(bushCel(q), q.x, q.y, facing), q)
    )
      return;
  }
  // ...and TOWER's current, which carries -4 on every cel of its arc — while it
  // is on (`0x426a90`; `0x426b78` zeroes it as it goes off)
  for (const g of hereOf((l) => l.surges)) {
    if (!g.on) continue;
    const cel = celRec(lvl.sbk, surgeCel(g));
    if (!cel?.strike) continue;
    if (hit(cel, g.x, g.y, 1, 0, 0, SURGE.blow)) return;
  }
  // `0x41b022` — Boggs' first machine, armed with −1 while it sweeps, seen or
  // not ({@link BOGGS.zap}); its `obj+0x28` is 0 (`0x41b28b`). A blow the
  // player's handler takes disarms it (`0x43045d`, `obj+0x1a = 0`), and only
  // the next frame of the sweep puts the −1 back
  for (const b of hereOf((l) => l.boggs)) {
    if (!b.zap.armed) continue;
    const cel = celRec(lvl.sbk, BOGGS.zap.cel);
    const m = b.machines[0];
    if (!cel?.strike || !m) continue;
    if (hit(cel, m.x, m.y, 1, 0, 0, BOGGS.zap.code, undefined, b.zap)) {
      b.zap.armed = false;
      return;
    }
  }
  if (!damageOn) return;
  for (const e of foesHurt ? spawnedHere() : []) {
    /**
     * A corpse does not: `dead` has no box worth reading and never had —
     * unless its own death arms it, as the CHOPPER's sink does with a blast
     * (`0x454716`, `obj+0x1a = 0x65`), which a class says with
     * {@link Enemy.strength}.
     *
     * The hydrant's WATER comes through here and lands nothing. It is a second
     * object of the hydrant's own class (`0x44fb81`), kept as an enemy in the
     * `burst` state, and 9802..9807 carry a strike box and 9803..9807 a blow
     * pair — but its strength is the allocator's zero, which `0x430367` turns
     * away before the pair is read.
     */
    if (e.state === "dead" && e.strength !== 0x65) continue;
    const c = celRec(lvl.sbk, celOf(e));
    if (!c?.strike) continue;
    // ...and the hitter's velocity is ALL of it: `obj+0xc` is the walk as
    // well as a flight, and this page keeps a walker's in {@link Enemy.speed}
    const vx = e.vx / TICK_SCALE + (e.vx === 0 ? (e.speed ?? 0) * e.facing : 0);
    // the water is the exception: `0x44fb81` makes it with the allocator's
    // strength of nothing (`0x42f550`) and nothing gives it one, so it pushes
    // no one about — see {@link Enemy.strength} for the rest
    const strength = e.state === "burst" ? 0 : (e.strength ?? 100);
    // the box hangs off `obj+6`, the anchor, not the feet ({@link strikeOf})
    const a = foeAnchor(e, lvl) ?? { x: e.x, y: e.y };
    if (hit(c, a.x, a.y, e.facing, vx, e.vy / TICK_SCALE, strength)) {
      // `0x430663` — the exchange marks the hitter's `obj+0x2a`, for a blow
      // with a strength (`0x430430`)
      if (strength > 0) e.connected = true;
      return;
    }
  }
  /**
   * ...and the crows, whose dive cels (1875, 1877, 1884..1887) carry a strike
   * box and no pair — so the blow is the crow's own velocity at strength 100
   * (`0x45206f` rewrites it every frame). Touching is what sets `obj+0x2a`
   * (the exchange, `0x430663`), and that is what ends a dive's run ({@link stepCrows}).
   */
  for (const c of foesHurt ? crowsHere() : []) {
    const cel = celRec(lvl.sbk, crowCel(c));
    if (!cel?.strike) continue;
    const reach = strikeOf(cel, c.x, c.y, 1);
    if (
      reach &&
      reach.right > mine.left &&
      reach.left < mine.right &&
      reach.bottom > mine.top &&
      reach.top < mine.bottom
    )
      c.hit = true;
    if (hit(cel, c.x, c.y, 1, c.vx, c.vy)) return;
  }
  /**
   * ...and what the creatures have THROWN, which is a creature's blow at a
   * distance and so sits under the same switch as its fists.
   *
   * Spent on contact, and spent whether or not it landed a reaction: the
   * executable's own test is `obj+0x2a` — the collision word — going non-zero,
   * and touching the player is what sets it. A gob that has hit you is gone
   * even if you were already on your back.
   */
  /**
   * ...and what the creatures have THROWN, all of it under the creature switch.
   *
   * Codes included, and that is a decision rather than an oversight. This
   * function lets a CODE through whatever the switches say — the claw, the hand
   * underfoot, the bush and the wraith all reach the player with `?damage` off
   * — on the reasoning that a code is not damage and turning damage off was
   * never meant to turn the grab off.
   *
   * A thrown one is different, and SEWER is where it showed. Two of the four
   * casts built so far carry −2, the jolt; nine eyes spit it; and with the
   * jolts arriving whatever the switch said, `tests/machine/sewer.ts` could no
   * longer walk its own big shaft — the player was knocked off it and out of
   * the level, twice in two runs. The claw and the bush are LEVEL FURNITURE,
   * fixed things you walk into, and a route that meets one meets it by standing
   * there. A glob is a creature's attack, which is exactly what `foehit` was
   * added to hold back while the shared AI was being wired, and the sign of the
   * number it carries does not change what it is.
   *
   * So: a cast waits for the creature switch, code or blow. The suites keep
   * measuring routes, and `?foehit=1` — which is what the front door plays with
   * — gets the whole of it.
   */
  for (const c of foesHurt ? casts : []) {
    /**
     * ...and the one class whose flight is a DUD stays in this loop after it
     * has met something, because for that one the burst is the attack.
     *
     * `0x452e00` installs the burst on the collision words and `0x452ec0`
     * writes the hundred and one as its state comes up, so the frame it
     * touches you is the first frame it can hurt you and the flash goes on
     * hurting for as long as its own cels carry a pair. See
     * {@link CastKit.onImpact}.
     */
    const dud = c.kit.onImpact === true;
    if (c.landed !== undefined && !dud) continue; // already met something
    if (!dud && castBlow(c) === 0) continue; // still flying harmless — `0x413e43`
    const cel = celRec(lvl.sbk, castCel(c));
    if (!cel?.strike) continue;
    const box = strikeOf(cel, c.x, c.y, c.facing);
    if (!box) continue;
    if (!(box.right > mine.left && box.left < mine.right && box.bottom > mine.top && box.top < mine.bottom))
      continue;
    if (dud) {
      // meeting you IS the landing. The flight's own cels carry a strike box
      // and no blow pair (6004..6006), so `hit` resolves them to nothing of
      // its own accord and the first cel that can take health is 7000's.
      if (c.landed === undefined) burstCast(c);
      if (hit(cel, c.x, c.y, c.facing, 0, 0, c.kit.blow)) return;
      continue;
    }
    // ...or, for one that flies on, it is only worth nothing from now on
    // ({@link CastKit.flyOn}) — its blow is read before that is written
    const blow = castBlow(c);
    if (c.kit.flyOn) c.struck = true;
    else c.spent = true;
    // `0x42f910` adds what the HITTER was doing to the cel's own pair, and a
    // cast's velocity is already in the executable's units — a frame's worth
    if (hit(cel, c.x, c.y, c.facing, c.vx, 0, blow)) return;
  }
  /**
   * ...and Boggs' WORMS, which are the same argument as a cast.
   *
   * One is dropped by a creature's own machine and carries `0x41adf9`'s hundred
   * from the frame it lands, so it waits for `?foehit` exactly as a thrown thing
   * does. It does not move, so there is no velocity to hand the reaction.
   */
  for (const b of foesHurt ? hereOf((l) => l.boggs) : []) {
    for (const m of b.worms) {
      const cel = celRec(lvl.sbk, boggsWormCel(m));
      if (!cel?.strike) continue;
      const box = strikeOf(cel, m.x, m.y, 1);
      if (!box) continue;
      if (!(box.right > mine.left && box.left < mine.right && box.bottom > mine.top && box.top < mine.bottom))
        continue;
      if (hit(cel, m.x, m.y, 1, 0, 0, BOGGS.worms.strength)) return;
    }
  }
  /**
   * ...and the ROLLER, which is the same argument again and one number apart.
   *
   * `0x43a993` writes its strength every frame it is quick enough and
   * `0x43aa34` writes a zero every frame it is not, so what arms it is its own
   * speed rather than anything it has met — {@link rollerBlow}. It hands the
   * reaction its velocity the way a cast does, because it has a real one.
   */
  for (const r of foesHurt ? rollers : []) {
    const blow = rollerBlow(r);
    if (blow === 0) continue;
    const cel = celRec(lvl.sbk, rollerCel(r));
    if (!cel?.strike) continue;
    const face = r.vx < 0 ? -1 : 1;
    const box = strikeOf(cel, r.x, r.y, face);
    if (!box) continue;
    if (!(box.right > mine.left && box.left < mine.right && box.bottom > mine.top && box.top < mine.bottom))
      continue;
    if (hit(cel, r.x, r.y, face, Math.trunc(r.vx / ROLLER.divisor), 0, blow)) return;
  }
  // `0x454a38` arms a press only while its stroke runs, and only two of its cels
  // carry a box; `0x4537d0` arms a girder on every frame it has
  for (const c of crushesHere()) {
    if (c.state !== "slam") continue;
    const cel = celRec(lvl.sbk, crushCel(c));
    if (!cel?.strike) continue;
    if (hit(cel, c.x, c.y, 1, 0, 0)) return;
  }
  for (const b of ibeamsHere()) {
    if (b.delay > 0) continue;
    const cel = celRec(lvl.sbk, ibeamCel(b));
    if (!cel?.strike) continue;
    if (hit(cel, b.x, b.y, 1, 0, 0)) return;
  }
  // the big gun's shot, a hundred (`0x413bed`), tested where it stood as the
  // frame began on the record the step shows ({@link GUNBOLT}); a blow taken
  // is the exchange that sets its `obj+0x2a`, and its think lets it go
  for (const b of bolts) {
    if (b.code !== 100 || b.spent || !b.was) continue;
    const cel = celRec(lvl.sbk, boltCel(b));
    if (!cel?.strike) continue;
    if (hit(cel, b.was.x, b.was.y, b.facing, b.vx, 0)) {
      b.spent = true;
      return;
    }
  }
  // `0x423d29` and the four writes after it — the blade carries a blow of a
  // hundred at every tag it has, and it has nothing else
  for (const a of hereOf((l) => l.axes)) {
    const cel = celRec(lvl.sbk, axeCel(a));
    if (!cel?.strike) continue;
    if (hit(cel, a.x, a.y, 1, 0, 0)) return;
  }
  // ...and VAT's wrecking balls: `0x41a89e` writes a hundred every frame, and
  // every cel of the swing carries a box. It is pinned to its point with both
  // velocities zeroed (`0x41a7de`), so what it hits with is the cel's own pair
  for (const f of hereOf((l) => l.fittings)) {
    if (f.kind !== "ball") continue;
    const cel = celRec(lvl.sbk, fittingCel(f));
    if (!cel?.strike) continue;
    if (hit(cel, f.x, f.y, 1, 0, 0, FITTING.ball.blow)) return;
  }
  // ...and the goop, which carries `obj+0x1a = 0x64` and therefore its cel's own
  // pair unscaled — see {@link dripStrike} for why that is one cel of nine
  for (const d of drips) {
    const cel = dripStrike(d);
    if (!cel || d.hit) continue;
    // touching is what sets `obj+0x2a` (the exchange, `0x430663`), and a gob that has touched
    // bursts on its next think (`0x43746a`) whatever the blow came to
    const reach = strikeOf(cel, d.x, d.y, 1);
    if (
      reach &&
      reach.right > mine.left &&
      reach.left < mine.right &&
      reach.bottom > mine.top &&
      reach.top < mine.bottom
    )
      d.hit = true;
    // a drip keeps its velocity in pixels a FRAME already (see {@link stepGoop})
    if (hit(cel, d.x, d.y, 1, d.vx, d.vy)) return;
  }
  // ...and level eight's water, on whichever of its cels carries a box
  for (const [slot, clock] of columns) {
    const q = hereOf((l) => l.sprinklers).find((w) => w.slot === slot);
    if (!q) continue;
    const cel = celRec(lvl.sbk, columnCel(clock));
    if (!cel?.strike) continue;
    if (hit(cel, q.x, q.y, 1, 0, 0)) return;
  }
}

/** the things spawned in the player's room, or none */
export function spawnedHere(): Enemy[] {
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
export function celOf(e: Enemy): number {
  // ...and a script a brain installed to play ONCE holds its last cel when it
  // ends, as `0x45d0f0` does with a script that has no loop — kragg's held 7042
  return e.state === "gait" && !e.swing
    ? e.anim.cels[loopIndex(e.anim, e.clock)]
    : celAt(e.anim, e.clock);
}

/** the planks standing in the room the player is in */
export function planksHere(): Plank[] {
  const i = level && p.room ? level.rooms.indexOf(p.room) : -1;
  return level && i >= 0 ? level.planks[i] : [];
}

/**
 * Step every plank: whether the player is on it, whether that is one crossing too
 * many, and the fall — `0x4531d0`, and {@link PLANK} quotes it line by line.
 *
 * The engine publishes the owned platform at its owner's position every frame
 * (`0x42fcb9`); this moves the record with the plank, which is the same thing.
 * A falling plank drops 30 pixels in its first frame, past the rider's 8-pixel
 * snap (`0x42ff56`), so the rider is left behind at once.
 *
 * The plank falls until the room's floor holds it — its `obj+0x34` is 0
 * (`0x42f5a7`), so the mover gives it `0x40bbd0`'s floor and no platform — and
 * lies there on the art's foot, `+0x26`, with its record beside it.
 */
export function stepPlanks(): void {
  for (const k of planksHere()) {
    if (k.gone) continue;
    k.clock += TICK_SCALE;
    if (k.state === "fall") {
      if (k.vy === 0 && k.landed) continue;
      // `0x43032b`: `obj+0x24` (30, {@link PLANK.gravity}) added on every airborne
      // frame, uncapped
      k.vy += PLANK.gravity * TICK_SCALE * TICK_SCALE;
      let dy = k.vy;
      const rec = level ? celRec(level.sbk, plankCel(k)) : undefined;
      const ground = groundAt(k.x);
      if (rec && ground !== null) {
        const foot = k.y + rec.height - rec.posY;
        if (foot + dy >= ground) {
          // `0x42ff5d`: on the floor. A landing faster than 2 a frame keeps a
          // quarter of it (`obj+0x20`, 0x800/8192) and settles; slower stops dead
          dy = ground - foot;
          k.vy = k.vy / TICK_SCALE > 2 ? k.vy * 0.25 : 0;
          k.landed = true;
        }
      }
      k.y += dy;
      if (k.floor) {
        k.floor.top += dy;
        k.floor.bottom += dy;
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
    const on =
      p.x > k.left &&
      p.x < k.right &&
      p.onGround &&
      ay < k.y &&
      k.y - ay < PLANK.reach;
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
  // a plank past the end of the room's floor has nothing to land on. The engine's
  // region bounds would hold it at the room's edge; this port stops it and its
  // record once it is 400px below the room, which nobody can see, and keeps it
  // for the death that puts it back
  const room = p.room;
  if (!room) return;
  for (const k of planksHere()) {
    if (k.gone || k.state !== "fall" || k.landed || k.y < room.bottom + 400) continue;
    k.gone = true;
    if (k.floor) {
      // and it takes the record with it: nothing stands on a plank that has gone
      k.floor.top = room.bottom + 10000;
      k.floor.bottom = k.floor.top + 1;
    }
  }
}

/**
 * `0x453090` and `0x422230` — every plank and every rope bridge in the level
 * whole again, where its creator put it. Their class passes (`0x453040`,
 * `0x4221e0`) call them on the first frame the player is alive after being
 * dead, which is the respawn after a death's red — and only that: `zip` and
 * the debug key move a living player, and {@link PLANK} has the listing.
 */
export function restoreBoards(): void {
  if (!level) return;
  for (const k of level.planks.flat()) {
    k.state = "intact";
    k.clock = 0;
    k.crossings = 0;
    k.vy = 0;
    k.y = k.homeY;
    k.landed = false;
    k.gone = false;
    if (k.floor && k.homeFloor) {
      k.floor.top = k.homeFloor.top;
      k.floor.bottom = k.homeFloor.bottom;
    }
  }
  level.bridges.forEach((room, r) => {
    for (const b of room) {
      const d = b.y - b.homeY;
      // the platform it owns follows it home, as it followed it down
      if (d !== 0)
        for (const q of level!.solids[r].platforms)
          if (b.x >= q.left && b.x < q.right && b.y >= q.top && b.y < q.bottom) {
            q.top -= d;
            q.bottom -= d;
          }
      b.y = b.homeY;
      b.top -= d;
      b.bottom -= d;
      b.state = "whole";
      b.stood = 0;
      b.clock = 0;
      b.vy = 0;
    }
  });
}

/** the elevators in the room the player is in */
export function elevatorsHere(): Elevator[] {
  const i = level && p.room ? level.rooms.indexOf(p.room) : -1;
  return level && i >= 0 ? level.elevators[i] : [];
}

/** is the player standing on this car right now — their feet on its deck */
export function ridingElevator(e: Elevator): boolean {
  return (
    p.onGround &&
    p.x >= e.floor.left &&
    p.x < e.floor.right &&
    Math.abs(p.y - e.floor.top) <= 4
  );
}

/**
 * Step every elevator: `0x453470`'s five states, in the order its table runs them.
 *
 * The car is moved by moving its floor record, which is how the rider comes with
 * it — the engine publishes an owned platform at its owner's position every frame
 * (`0x42fcb9`), and the walk's own "follow the floor" allows {@link CLIMB_PX} of
 * climb a tick, far more than the 13 a frame a car climbs.
 *
 * The travelling tags push `obj+0xa` by `0x28 / 10 = 4` a frame (`0x42f8b0`) and
 * clamp it to 6 down and 13 up; the push is spread over the frame's four ticks.
 */
export function stepElevators(): void {
  const push = roundAway(ELEVATOR.speed / ELEVATOR.divisor) * TICK_SCALE;
  for (const e of elevatorsHere()) {
    e.clock += TICK_SCALE;
    if (e.state === "idle") {
      // `0x453490` waits on `obj+0x46`, and that field is written by exactly one
      // thing — the animation stepper, when a script's last frame completes. So
      // tag 0 is not waiting for a rider: it is waiting for its own eighteen
      // frames of 1160 to run out, and then it goes. The car shuttles whether or
      // not anyone is aboard, pausing 1.2s at each end; you catch it.
      if (e.clock < elevatorFrames(e)) continue;
      // `0x4534b6`: down (tag 1) while the car is above the shaft's bottom, up
      // (tag 3) once it is at or past it
      e.dir = e.floor.top < e.bottom ? 1 : -1;
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
    // `0x453518` / `0x4535d2`: push, clamp, and test the end against where the
    // car IS — before the mover spends this frame's velocity, so the last push
    // still carries it a few pixels past the end
    e.vy =
      e.dir > 0
        ? Math.min(e.vy + push, ELEVATOR.maxDown)
        : Math.max(e.vy - push, -ELEVATOR.maxUp);
    const done = e.dir > 0 ? e.floor.top >= e.bottom : e.floor.top < e.top;
    if (done) {
      e.vy = 0;
      e.state = "idle";
      e.clock = 0;
      sound?.effect(ELEVATOR.soundStop, e.x, e.y);
      continue;
    }
    const moved = e.vy * TICK_SCALE;
    e.floor.top += moved;
    e.floor.bottom += moved;
    e.y += moved;
  }
}

/**
 * Every `initibeam` in this room, standing where its record's point puts it.
 *
 * There is nothing to resolve and nothing to own: the frame function rewrites the
 * beam's position from the file every tick (`obj+6 = ctx+0`) and zeroes its
 * velocity, so the record IS the answer. See {@link IBEAM}.
 */
export function ibeamsIn(sbk: SbkFile, room: SbkRoom): Ibeam[] {
  const out: Ibeam[] = [];
  for (const e of sbk.entities) {
    if (!e.isEntity || e.name !== "initibeam") continue;
    const cy = (e.top + e.bottom) >> 1;
    const cx = (e.left + e.right) >> 1;
    if (cy < room.top || cy > room.bottom || cx < room.left || cx > room.right)
      continue;
    // the cels are one book's, as the planks' and the lifts' are
    if (!IBEAM.across.cels.every((id) => sbk.byId.has(id))) continue;
    // with no delay there is no script on the first frame and `obj+0x46` is the
    // reset's 1 (`0x45d07d`), so tag 0's handler (`0x45382a`) hands straight to
    // tag 1; with one, `0x453800` installs tag 0 as it runs out
    const now = e.param <= 0;
    out.push({
      x: e.pointX,
      y: e.pointY,
      state: now ? "across" : "out",
      clock: 0,
      // the record's own stagger — the creator loads ctx+4 from a word of it, and
      // CITY gives exactly one of its seven a nonzero one
      delay: e.param,
      side: now ? 1 : 0,
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
export function crushesIn(sbk: SbkFile, room: SbkRoom): Crush[] {
  const out: Crush[] = [];
  for (const e of sbk.entities) {
    if (!e.isEntity || e.name !== "initcrush") continue;
    if (
      e.pointY < room.top ||
      e.pointY > room.bottom ||
      e.pointX < room.left ||
      e.pointX > room.right
    )
      continue;
    if (!CRUSH.slam.cels.every((id) => sbk.byId.has(id))) continue;
    out.push({
      x: e.pointX,
      y: e.pointY,
      top: e.top,
      left: e.left,
      bottom: e.bottom,
      right: e.right,
      state: "idle",
      clock: 0,
    });
  }
  return out;
}

/** the presses in the room the player is in */
export function crushesHere(): Crush[] {
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
export function stepCrushes(): void {
  for (const c of crushesHere()) {
    if (c.state === "idle") {
      // the anchor is the point the cel hangs from, which is the player's y less
      // the feet — the same conversion {@link poseFeet} keeps
      const ay = p.y - p.feet;
      const inside =
        p.x >= c.left && p.x < c.right && ay >= c.top && ay < c.bottom;
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
export function switchesIn(sbk: SbkFile, room: SbkRoom): Switch[] {
  const out: Switch[] = [];
  for (const e of sbk.entities) {
    // SERVICE calls them `switch` and MAZE calls them `initswitch`, and they
    // are the same class: `0x473548` and `0x46c050` have the same four tags on
    // the same four cel runs, one per chapter's book
    if (!e.isEntity || (e.name !== "switch" && e.name !== "initswitch"))
      continue;
    if (
      e.pointY < room.top ||
      e.pointY > room.bottom ||
      e.pointX < room.left ||
      e.pointX > room.right
    )
      continue;
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
      // MAZE's lever is chapter two's class, whose throw `0x412550` plays nothing
      maze: e.name === "initswitch",
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
export function nestsIn(sbk: SbkFile, room: SbkRoom): Nest[] {
  const out: Nest[] = [];
  for (const e of sbk.entities) {
    if (!e.isEntity || e.name !== "initgoop") continue;
    if (
      e.pointY < room.top ||
      e.pointY > room.bottom ||
      e.pointX < room.left ||
      e.pointX > room.right
    )
      continue;
    if (!GOOP.bead.cels.every((id) => sbk.byId.has(id))) continue;
    out.push({
      top: e.top,
      left: e.left,
      bottom: e.bottom,
      right: e.right,
      param: e.param,
      on: false,
    });
  }
  return out;
}

/** the levers in the room the player is in */
export function switchesHere(): Switch[] {
  const i = level && p.room ? level.rooms.indexOf(p.room) : -1;
  return level && i >= 0 ? level.switches[i] : [];
}

/** the nests in the room the player is in */
export function nestsHere(): Nest[] {
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
export function throwSwitch(s: Switch, dir: 0 | 1): boolean {
  if (dir === 0 && s.state === "off") {
    s.state = "turningOn";
    s.clock = 0;
    // MAZE's `0x412550` installs the throw without a sound
    if (!s.maze) sound?.effect(SWITCH.throwOn, s.x, s.y);
    return true;
  }
  if (dir === 1 && s.state === "on") {
    s.state = "turningOff";
    s.clock = 0;
    if (!s.maze) sound?.effect(SWITCH.throwOff, s.x, s.y);
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
export function stepSwitches(): void {
  // every lever in the LEVEL, because a throw has to finish wherever it was made
  const here = level?.switches.flat() ?? [];
  if (!here.length) return;
  const ay = p.y - p.feet;
  for (const s of here) {
    const inside =
      p.x >= s.left && p.x < s.right && ay >= s.top && ay < s.bottom;
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
export function doorsIn(sbk: SbkFile, room: SbkRoom): Door[] {
  const out: Door[] = [];
  for (const e of sbk.entities) {
    if (!e.isEntity || e.name !== "door") continue;
    if (
      e.pointY < room.top ||
      e.pointY > room.bottom ||
      e.pointX < room.left ||
      e.pointX > room.right
    )
      continue;
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
export function elevsIn(sbk: SbkFile, room: SbkRoom, solids: Solids): Elev[] {
  const out: Elev[] = [];
  for (const e of sbk.entities) {
    if (!e.isEntity || e.name !== "initelev") continue;
    if (
      e.pointY < room.top ||
      e.pointY > room.bottom ||
      e.pointX < room.left ||
      e.pointX > room.right
    )
      continue;
    // ...and the cel is the CHAPTER's — see {@link ELEV.cels}. Requiring SEWER's
    // 3202 threw away all four of CAVERN's lifts, which are the only way up out
    // of its second room.
    const cel = ELEV.cels.find((c) => sbk.byId.has(c));
    if (cel === undefined) continue;
    const floor = solids.platforms.find(
      (q) =>
        e.pointX >= q.left &&
        e.pointX <= q.right &&
        e.pointY >= q.top - 40 &&
        e.pointY <= q.bottom + 40,
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
      cel,
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
export function placed<T>(
  sbk: SbkFile,
  room: SbkRoom,
  name: string,
  cels: readonly number[],
  make: (e: SbkEntity) => T,
): T[] {
  const out: T[] = [];
  for (const e of sbk.entities) {
    if (!e.isEntity || e.name !== name) continue;
    if (
      e.pointY < room.top ||
      e.pointY > room.bottom ||
      e.pointX < room.left ||
      e.pointX > room.right
    )
      continue;
    if (!cels.every((id) => sbk.byId.has(id))) continue;
    out.push(make(e));
  }
  return out;
}

/**
 * Where the head and the claw arm stand against the body — decided once, and
 * then kept to every frame as the body moves ({@link placeBoggs}).
 *
 * `initboggshead` has a record of its own in `VAT.SBK` and `0x412310` puts the
 * head on its point. `initbgclawarm` has no point at all: `0x4121ae` copies the
 * BODY's `+6` as a dword, so the arm's Y and X are the body's own, and the jaws
 * then hang at the centre of the arm cel's box (`0x412180`) — which is read per
 * frame in {@link jawsAt}, because the cel is what says where the centre is.
 */
export function headAndArm(
  sbk: SbkFile,
  room: SbkRoom,
  body: SbkEntity,
): { headX: number; headY: number; headOff: { dx: number; dy: number } } {
  const head = sbk.entities.find(
    (e) =>
      e.isEntity &&
      e.name === "initboggshead" &&
      e.pointY >= room.top &&
      e.pointY <= room.bottom &&
      e.pointX >= room.left &&
      e.pointX <= room.right,
  );
  const headX = head?.pointX ?? body.pointX;
  const headY = head?.pointY ?? body.pointY;
  return { headX, headY, headOff: { dx: headX - body.pointX, dy: headY - body.pointY } };
}

/**
 * The `wormbounds` record — one per room, and every worm is clamped inside it.
 *
 * `0x41ac70` reads it once, at the class's own setup, and stores the rect at
 * `[0x4a50c8]`; `0x41ac09`…`0x41ac26` then holds each worm's point inside it
 * every frame. The record carries no point of its own that anything reads — it
 * is a box and nothing else, which is why `levels.md` had nowhere to file it.
 */
export function wormBounds(
  sbk: SbkFile,
  room: SbkRoom,
): { left: number; right: number; top: number; bottom: number } | null {
  const r = sbk.entities.find(
    (e) =>
      e.name === BOGGS.worms.bounds &&
      e.top >= room.top &&
      e.top <= room.bottom &&
      e.left >= room.left &&
      e.left <= room.right,
  );
  return r ? { left: r.left, right: r.right, top: r.top, bottom: r.bottom } : null;
}

/** the worms' box against the body's own record point — `0x41acd9`..`0x41acfc` */
export function boundsAgainst(
  r: { left: number; right: number; top: number; bottom: number } | null,
  body: { pointX: number; pointY: number },
): { left: number; right: number; top: number; bottom: number } | undefined {
  if (!r) return undefined;
  return {
    left: r.left - body.pointX,
    right: r.right - body.pointX,
    top: r.top - body.pointY,
    bottom: r.bottom - body.pointY,
  };
}

/** every `initshack` in this room — CITY places eleven and nothing else places any */
export function shacksIn(sbk: SbkFile, room: SbkRoom): Shack[] {
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
export function barrelsIn(sbk: SbkFile, room: SbkRoom, solids: Solids): Barrel[] {
  return placed(sbk, room, "initbarrel", BARREL.bob.cels, (e) => ({
    x: e.pointX,
    y: e.pointY,
    homeX: e.pointX,
    homeY: e.pointY,
    top: e.top,
    left: e.left,
    bottom: e.bottom,
    right: e.right,
    clock: 0,
    aclock: 0,
    // `0x435d8a`: the param is the counter; `0x43fc40` makes a positive one a delay
    wait: e.param,
    // `0x435d91`: 0x434540(2) - 1
    sinker: roll(2) === 2,
    tag: e.param > 0 ? ("none" as const) : ("bob" as const),
    vx: 0,
    vy: 0,
    mirror: false,
    bounced: false,
    // `0x435d6e`: `0x42fb70` — the platform the point is inside — unless the
    // param is negative
    floor:
      e.param < 0
        ? undefined
        : solids.platforms.find(
            (q) =>
              e.pointX >= q.left &&
              e.pointX < q.right &&
              e.pointY >= q.top &&
              e.pointY < q.bottom,
          ),
  }));
}

/** what of each is in the room the player is in */
export function hereOf<T>(pick: (lvl: Level) => T[][]): T[] {
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
export const PICKUP_CODES: Readonly<Record<string, string>> = {
  stathealth: "-1",
  statlife: "-2",
  stattimer: "-8",
};

export function pickupsIn(sbk: SbkFile, room: SbkRoom): Pickup[] {
  const out: Pickup[] = [];
  for (const e of sbk.entities) {
    if (!e.isEntity) continue;
    // `0x451420`: one name, three codes, picked by the record's own param — 0, 1
    // and 2 are −6, −5 and −4, and any other param makes nothing (`0x45142e`)
    const code =
      e.name === "statscoreup"
        ? e.param >= 0 && e.param <= 2
          ? String(-6 + e.param)
          : undefined
        : PICKUP_CODES[e.name];
    if (!code || !PICKUP.kinds[code]) continue;
    if (
      e.pointY < room.top ||
      e.pointY > room.bottom ||
      e.pointX < room.left ||
      e.pointX > room.right
    )
      continue;
    out.push({
      code,
      x: e.pointX,
      y: e.pointY,
      top: e.top,
      left: e.left,
      bottom: e.bottom,
      right: e.right,
      clock: 0,
    });
  }
  return out;
}

/**
 * Is this pixel of a decoded frame opaque? — and mirror by reflecting the COLUMN.
 *
 * `decodeShpFrame` already hands back the mask the engine works from: the SHP
 * stores each row as a run of opaque spans, which is why `0x4320c0` compares
 * spans rather than pixels, and `opaque` is that run flattened.
 */
export function opaqueAt(f: ShpFrame, x: number, y: number, mirror: boolean): boolean {
  if (y < 0 || y >= f.height) return false;
  const cx = mirror ? f.width - 1 - x : x;
  return cx >= 0 && cx < f.width && f.opaque[y * f.width + cx] !== 0;
}

/**
 * The SECOND test — do the two sprites actually touch?
 *
 * `0x40e680` is the whole of it and it is two steps: `0x434140` intersects the
 * two drawn rects, and `0x4320c0` then walks that intersection looking for a
 * row where both cels have an opaque span. The rect alone is not the answer —
 * the player's cel is a tall rectangle with a great deal of nothing in it, and
 * a pickup sitting in the gap under an outstretched arm passes the rect test
 * and fails this one.
 *
 * The engine returns the centre of the RECT intersection rather than of the
 * pixels it found (`0x40e782` reads back the rect `0x434140` wrote), so the
 * pixel walk only ever answers yes or no and can stop at the first hit.
 */
export function spritesTouch(
  a: { f: ShpFrame; left: number; top: number; mirror: boolean },
  b: { f: ShpFrame; left: number; top: number; mirror: boolean },
): boolean {
  const x0 = Math.max(a.left, b.left);
  const x1 = Math.min(a.left + a.f.width, b.left + b.f.width);
  const y0 = Math.max(a.top, b.top);
  const y1 = Math.min(a.top + a.f.height, b.top + b.f.height);
  if (x1 <= x0 || y1 <= y0) return false;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      if (
        opaqueAt(a.f, x - a.left, y - a.top, a.mirror) &&
        opaqueAt(b.f, x - b.left, y - b.top, b.mirror)
      )
        return true;
    }
  }
  return false;
}

/** the player's own frame and where it is drawn, for {@link spritesTouch} */
export function playerSprite(): {
  f: ShpFrame;
  left: number;
  top: number;
  mirror: boolean;
} | null {
  const loc = player?.byId.get(lastCel);
  const f = loc === undefined ? null : playerFrame(loc);
  if (!f) return null;
  // the same placement the draw uses: the anchor on `p.x`, standing on `p.y`
  const rec = celRec(player, lastCel);
  return {
    f,
    left: Math.round(
      rec
        ? p.facing < 0
          ? p.x - (f.width - rec.posX)
          : p.x - rec.posX
        : p.x - f.width / 2,
    ),
    top: Math.round(p.y - f.height),
    mirror: p.facing < 0,
  };
}

/**
 * Step the pickups: animate them, and hand over whichever one the player is
 * standing in.
 *
 * `0x45b270` runs from the player's own think every frame and asks two
 * questions of each one — `0x434140`, the player's rect for the cel it is
 * showing (`0x45b296` → `0x42f9f0`) against the pickup's record rect, and then
 * `0x40e680`, which compares the two sprites pixel by pixel. It answers the
 * FIRST pickup that passes both (`0x45b38b`) and stops, so one is taken a frame.
 * There is no button and no facing: walking over one is the whole of it.
 *
 * What each one gives is `0x42827a`'s table, and every sound comes out of the
 * CHARACTER's bank rather than the level's ({@link PICKUP}).
 */
export function stepPickups(): void {
  const lvl = level;
  if (!lvl || !player) return;
  const here = hereOf((l) => l.pickups);
  if (!here.length) return;
  const me = playerSprite();
  const mine = me
    ? { left: me.left, top: me.top, right: me.left + me.f.width, bottom: me.top + me.f.height }
    : playerBox();
  const gone: Pickup[] = [];
  for (const q of here) {
    q.clock += TICK_SCALE;
    if (gone.length) continue;
    // `0x434140` against the pickup's own RECORD rect, which is what the creator
    // filed at `user+4` — the art is only what is drawn
    if (!(
      mine.right > q.left &&
      mine.left < q.right &&
      mine.bottom > q.top &&
      mine.top < q.bottom
    ))
      continue;
    const kind = PICKUP.kinds[q.code];
    // ...and then `0x40e680`, which is the art. See {@link spritesTouch}.
    const loc = player.byId.get(kind.cels[loopIndex(kind, q.clock)]);
    const pf = loc === undefined ? null : playerFrame(loc);
    if (
      pf &&
      me &&
      !spritesTouch(me, {
        f: pf,
        left: q.x - pf.posXraw,
        top: q.y - pf.posYraw,
        mirror: false,
      })
    )
      continue;
    gone.push(q);
    // at the PLAYER's point (`[0x4ac3d4]+6`), and each character plays its own
    if (CHARACTER === 1) sound?.own(kind.bones.sound, p.x, p.y, kind.bones.way);
    else sound?.own(kind.sound, p.x, p.y);
    if (q.code === "-1")
      stats.health = Math.min(stats.maxHealth, stats.health + PICKUP.health);
    else if (q.code === "-2")
      stats.lives = Math.min(PICKUP.maxLives, stats.lives + 1);
    else if (q.code === "-8") addClock(PICKUP.clock);
    else stats.score += PICKUP.score[q.code] ?? 0;
  }
  if (!gone.length) return;
  const i = lvl.rooms.indexOf(p.room!);
  lvl.pickups[i] = here.filter((q) => !gone.includes(q));
}

/**
 * Level nine's graves — `0x421040`, and there is no damage in it anywhere.
 *
 * Shut, it DRAWS you in: while your point is inside its rect and you are on your
 * feet, `0x4210bd` takes your distance from its point less half the rect's width
 * less one, and `0x42f8b0` pushes you TOWARD its point by that much every frame
 * (`0x4210f7`: +1 when you are west of it), with `0136 grave pull`. Come within a
 * hundred pixels of its point and it arms; still within a hundred the next frame,
 * it halves your speed and adds one to your fall once, and opens — `0x4704e8`,
 * ten cels. Eighty-six pixels below its point during those ten frames,
 * `0x402fa0(5)` ends the life. Then it stands open with a lid across it, and
 * does nothing more.
 *
 * So it is a hole and it behaves like one, which is the only thing in the game
 * that kills without a blow.
 */
export function stepHoles(): void {
  const here = hereOf((l) => l.holes);
  if (!here.length || !player) return;
  // Every one of this class's tests is against the player's POINT, which is the
  // ANCHOR: `0x421083` hands `[player+6]` to `0x434200` and `0x421211` subtracts
  // the grave's own `[esi+6]` from it. This page's `p.y` is the FEET, 112 below
  // the anchor when standing, and putting the feet into those comparisons made
  // level nine unplayable — the ground beside a grave is about 112 below the
  // grave's point, so `feet - point` already cleared `0x56` while merely walking
  // past, and every grave killed you on approach. See {@link poseFeet}.
  const py = p.y - p.feet;
  for (const h of here) {
    const dx = Math.abs(p.x - h.x);
    if (h.state === "shut") {
      // `0x421083`..`0x42113a`: only on your feet — `0x4210a7` lets a jump
      // (player kind 3) and anything off the ground straight past
      if (
        p.onGround &&
        p.x >= h.left &&
        p.x < h.right &&
        py >= h.top &&
        py < h.bottom
      ) {
        const half = Math.trunc(Math.abs(h.right - h.left) / 2);
        const pull = Math.abs(Math.trunc(dx) - half - 1) * (p.x <= h.x ? 1 : -1);
        p.vx += roundAway(pull / DIVISOR);
        sound?.effect(FOE_SFX.gravePull, h.x, h.y);
      }
      // `0x421151`: inside a hundred, tag 1
      if (dx < HOLE.nearPx) h.state = "near";
      continue;
    }
    if (h.state === "near") {
      // `0x421189`: out past a hundred again and it is shut
      if (dx > HOLE.nearPx) {
        h.state = "shut";
        continue;
      }
      // `0x4211af` and `0x4211c4` — half your speed away and one more unit of
      // fall, this once
      p.vx = p.vx / 2;
      p.vyRaw += HOLE.pullPerFrame;
      if (py - h.y > HOLE.soundBelowPx) sound?.effect(HOLE.openSound, h.x, h.y);
      h.state = "opening";
      h.clock = 0;
      continue;
    }
    if (h.state !== "opening") continue;
    // `0x42120c` — `0x402fa0(5)`, which is a DEATH and not a subtraction. There
    // is no health in this class at all, so it goes down the same path falling
    // out of the world does, whatever the damage switch says. And the ground
    // beside a grave is already 98 below its point, so standing there when one
    // opens is the whole of it: you have to be in the air over it.
    if (py - h.y > HOLE.deathPx && p.act !== "dying" && !film && !h.taken) {
      h.taken = true;
      // `0x421239` — `0x402fa0` opens with `0x402df0`: every key dropped
      dropKeys();
      sound?.effect(FOE_SFX.graveTake, h.x, h.y);
      void died();
    }
    h.clock += 1;
    if (h.clock < HOLE.opening.cels.length * HOLE.opening.hold) continue;
    // `0x421263`: the opening ends — `0x421470` lays the lid across the pit as a
    // platform record of the engine's own table, and kind 2 has no handler
    h.state = "open";
    layGraveLid(h);
  }
}

/**
 * `0x421470`'s record, appended to the room's platforms: two hundred wide across
 * the grave's point, from 0x4c to 0x7e below it (`0x421285`..`0x4212a0`).
 */
export function layGraveLid(h: Hole): void {
  const lvl = level;
  const room = p.room;
  if (!lvl || !room || h.lid) return;
  const solids = lvl.solids[lvl.rooms.indexOf(room)];
  const like = solids?.platforms[0] ?? lvl.sbk.entities.find((e) => e.isEntity);
  if (!solids || !like) return;
  h.lid = true;
  solids.platforms.push({
    ...like,
    name: "platform",
    top: h.y + HOLE.lid.top,
    left: h.x - HOLE.lid.halfWidth,
    bottom: h.y + HOLE.lid.bottom,
    right: h.x + HOLE.lid.halfWidth,
    pointY: h.y + HOLE.deathPx,
    pointX: h.x,
  });
}

/** which cel a grave is showing */
export function holeCel(h: Hole): number {
  // `0x4704d0`'s two tags are both 3310
  if (h.state === "shut" || h.state === "near") return HOLE.shut;
  if (h.state === "open") return HOLE.open;
  return HOLE.opening.cels[
    Math.min(
      HOLE.opening.cels.length - 1,
      Math.floor(h.clock / HOLE.opening.hold),
    )
  ];
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
export function stepHands(): void {
  const here = hereOf((l) => l.hands);
  if (!here.length) return;
  // `0x434200` against the player's own POINT, which is the anchor — the feet
  // stand below every rect in the file (see `poseFeet`)
  const ay = p.y - p.feet;
  for (const q of here) {
    const kind = q.underfoot ? HAND.underfoot : HAND.anywhere;
    // `0x434200` is inclusive low, exclusive high on both axes
    const inside =
      p.x >= q.left && p.x < q.right && ay >= q.top && ay < q.bottom;
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
        q.atX = q.left + roll(Math.max(1, q.right - q.left));
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
       *   420dc6  cmp [esi+0x48], 0x14 ; fewer than 20 frames left of the cel
       *   420dd1  cmp [esi+0x2a], 0    ; and nothing rebounded off it: SINK
       * ```
       *
       * `obj+0x2a` is set only by `0x430663`, on a positive blow, so for the
       * underfoot hand the second test always passes and it sinks on the frame
       * `obj+0x48` drops under 20 — eleven frames in. The other hand
       * (`0x420e54`) tests only the end and `obj+0x2a`, so it holds all thirty.
       * What lets go of you is the fist opening — which is the same thing
       * {@link gripOf} reads, from the other side.
       */
      const hold = q.underfoot
        ? HAND.holdFrames - HAND.underfootLeft + 1
        : HAND.holdFrames;
      if (q.clock >= hold) {
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
export function stepHeld(): void {
  if (!p.heldBy) return;
  const at = p.heldBy();
  if (!at) {
    // `0x4285c1` — out through the walk's own script, and `0x4285db` writes 1
    // into `obj+0x34` on the way: the player is SETTLED again, not dropped from
    // wherever the grip had them. This page said so in the comment and did not
    // do it, which is how SEWER's hall of lifts ended a grab: released a pixel
    // above its own walkway, still flagged airborne, the player fell straight
    // through the one-way platform into the sewage under it. Standing them up
    // is not a free pass — the gait's own `surfaceUnder` runs next and puts
    // them back in the air if there is nothing within `STICK_PX` of their feet,
    // which is what a grab over a pit wants.
    p.heldBy = null;
    p.heldWhat = null;
    p.gravityScale = 1;
    p.act = null;
    p.heldClock = 0;
    p.onGround = true;
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
export function handCel(q: Hand): number {
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
export function stepAxes(): void {
  for (const a of hereOf((l) => l.axes)) {
    const was = Math.floor(a.clock) % AXE.swing.length;
    a.clock += 1;
    const now = Math.floor(a.clock) % AXE.swing.length;
    // `0x423d9a` — the sound is at the seam where tag 2 hands back to tag 0
    if (now === AXE.soundAt && was !== AXE.soundAt)
      sound?.effect(AXE.sound, a.x, a.y);
  }
}

/** which cel a blade is showing */
export function axeCel(a: Axe): number {
  return AXE.swing[Math.floor(a.clock) % AXE.swing.length];
}

/**
 * ...and the rope bridges — `0x422370`. Standing on one for more than five
 * engine frames, or landing on one from more than a hundred pixels up, starts
 * it; after that it rocks, falls and is gone, and the gap it was over is a gap.
 */
export function stepBridges(): void {
  const here = hereOf((l) => l.bridges);
  if (!here.length) return;
  // `0x4223ac`..`0x4223ef` test the player's POINT, which is the anchor
  const ay = p.y - p.feet;
  for (const b of here) {
    if (b.state === "whole") {
      const on =
        p.x > b.left &&
        p.x < b.right &&
        p.onGround &&
        b.y - ay < BRIDGE.reachPx &&
        b.y > ay;
      if (!on) continue;
      b.clock = 0;
      if (b.stood <= BRIDGE.standFrames && p.fallPx <= BRIDGE.fallPx) {
        b.state = "rocking";
        sound?.effect(FOE_SFX.bridgeCrack, b.x, b.y);
      } else b.state = "falling";
      continue;
    }
    b.clock += 1;
    if (b.state === "rocking") {
      // `0x42244f`: the rock ends, one more on the counter, and it is whole again
      if (b.clock >= BRIDGE.rocking.cels.length * BRIDGE.rocking.hold) {
        b.stood += 1;
        b.state = "whole";
        b.clock = 0;
      }
    } else if (b.state === "falling") {
      // `0x42249c`: the falling cels end — gravity 1.0, 0x35, and tag 1
      if (b.clock >= BRIDGE.falling.cels.length * BRIDGE.falling.hold) {
        b.state = "gone";
        b.clock = 0;
        b.vy = 0;
        sound?.effect(FOE_SFX.bridgeFall, b.x, b.y);
      }
    } else {
      // dropping, and the platform it owns goes down with it (`0x42fcb9`). The
      // mover moves by the velocity and then adds gravity (`0x43032b`)
      const dy = b.vy ?? 0;
      b.vy = dy + BRIDGE.gravity;
      if (dy === 0) continue;
      const lvl2 = level;
      const r = lvl2 ? lvl2.rooms.indexOf(p.room!) : -1;
      if (lvl2 && r >= 0)
        for (const q of lvl2.solids[r].platforms)
          if (
            b.x >= q.left &&
            b.x < q.right &&
            b.y >= q.top &&
            b.y < q.bottom
          ) {
            q.top += dy;
            q.bottom += dy;
          }
      b.y += dy;
      b.top += dy;
      b.bottom += dy;
    }
  }
}

/** which cel a bridge is showing */
export function bridgeCel(b: Bridge): number {
  if (b.state === "whole") return BRIDGE.whole;
  if (b.state === "gone")
    return BRIDGE.gone.cels[Math.min(BRIDGE.gone.cels.length - 1, Math.floor(b.clock))];
  const a = b.state === "rocking" ? BRIDGE.rocking : BRIDGE.falling;
  return a.cels[Math.min(a.cels.length - 1, Math.floor(b.clock / a.hold))];
}

/**
 * Level twelve's floors — `0x426f80`, which is level nine's grave told the
 * other way round: it waits for you to stand on it, creaks, caves in and falls
 * with the platform it owns, and then `0x402fa0` ends whoever is under it.
 * {@link FLOOR} has the tests.
 */
export function stepFloors(): void {
  const here = hereOf((l) => l.floors);
  if (!here.length) return;
  const ay = p.y - p.feet;
  for (const f of here) {
    const dx = Math.abs(p.x - f.x);
    f.clock += 1;
    if (f.state === "whole") {
      // `0x426fb0`: the player's point in the record's rect, on the ground
      if (
        p.x >= f.left &&
        p.x < f.right &&
        ay >= f.top &&
        ay < f.bottom &&
        p.onGround
      ) {
        f.state = "settling";
        f.clock = 0;
      }
      continue;
    }
    if (f.state === "settling") {
      if (dx > FLOOR.nearPx) {
        // `0x427017`: away, and the grace runs down; past it, whole again
        f.grace = (f.grace ?? FLOOR.grace) - 1;
        if (f.grace < 0) {
          f.state = "whole";
          f.grace = FLOOR.regrace;
        }
        continue;
      }
      if (f.clock < FLOOR.holdFrames) continue;
      f.state = "creaking";
      f.clock = 0;
      sound?.effect(FOE_SFX.floorCreak, f.x, f.y);
      continue;
    }
    if (f.state === "creaking") {
      if (f.clock < FLOOR.creaking.cels.length * FLOOR.creaking.hold) continue;
      f.clock = 0;
      if (dx < FLOOR.nearPx && Math.abs(ay - f.y) < FLOOR.nearY) {
        f.state = "caving";
        sound?.effect(FOE_SFX.floorCave, f.x, f.y);
      } else f.state = "settling";
      continue;
    }
    // kind 2. `0x4270f9`: on the third cel it takes gravity 3.0, and the mover
    // moves it by its velocity before adding the gravity (`0x43032b`)
    if (f.state === "caving" && f.clock >= FLOOR.caving.cels.length) f.state = "gone";
    if (f.clock >= 2 || f.vy !== undefined) {
      const dy = f.vy ?? 0;
      f.vy = dy + FLOOR.gravity;
      if (dy) {
        const lvl2 = level;
        const r = lvl2 ? lvl2.rooms.indexOf(p.room!) : -1;
        // ...with the platform it owns, `0x42fb70` at its point (`0x41f1a9`)
        if (lvl2 && r >= 0)
          for (const q of lvl2.solids[r].platforms)
            if (f.x >= q.left && f.x < q.right && f.y >= q.top && f.y < q.bottom) {
              q.top += dy;
              q.bottom += dy;
            }
        f.y += dy;
      }
    }
    // `0x427114`: every frame of kind 2, the player's point in the death zone
    if (
      p.x >= f.left &&
      p.x < f.right &&
      ay >= f.bottom + FLOOR.deathFrom &&
      ay < f.bottom + FLOOR.deathTo &&
      p.act !== "dying" &&
      !film
    ) {
      // `0x42713e` — `0x402fa0(1)`, and `0x402df0` before it drops every key
      dropKeys();
      void died();
    }
  }
}

/** which cel a floor is showing */
export function floorCel(f: Floor): number {
  if (f.state === "whole" || f.state === "settling") return FLOOR.whole;
  if (f.state === "gone")
    return FLOOR.caving.cels[FLOOR.caving.cels.length - 1];
  const a = f.state === "creaking" ? FLOOR.creaking : FLOOR.caving;
  return a.cels[Math.min(a.cels.length - 1, Math.floor(f.clock / a.hold))];
}

/**
 * ...and the surges, which are the only hazard in the game that gives you
 * something — `0x426a70`, and {@link SURGE} has it. The lightning's counter
 * switches them on ({@link stepLights}); each runs down its column and goes off.
 */
export function stepSurges(): void {
  const all = level?.surges.flat() ?? [];
  if (!all.length) return;
  const ay = p.y - p.feet;
  for (const q of all) {
    q.clock += 1;
    if (!q.on) continue;
    // `0x426a88`..`0x426ab3` — every frame it is on, `0134 surge` armed to
    // loop and played at the arc: one looping voice the mixer keeps, moved
    // down the column as the arc hops
    sound?.loop(SURGE.sound, true);
    sound?.effect(SURGE.sound, q.x, q.y);
    // `0x426ad4`..`0x426b27`: the scepter in hand, near the arc — thirteen rounds
    if (
      // (`0x402ee0` is `0x448bf0` for this character — OUT, not just carried)
      inv.drawn &&
      inv.weapon === SURGE.weapon &&
      p.x >= q.left - SURGE.reachX &&
      p.x < q.right + SURGE.reachX &&
      ay >= q.top &&
      ay < q.bottom &&
      Math.abs(ay - q.y) < SURGE.reachY
    )
      loadRounds(SURGE.weapon, SURGE.rounds);
    // `0x426b2c`: the six cels end — hop down, or go off and back to the top
    if (q.clock < SURGE.arc.cels.length * SURGE.arc.hold) continue;
    if (Math.abs(q.bottom - SURGE.hop) > q.y) {
      q.clock = 0;
      q.y += SURGE.hop;
    } else {
      q.on = false;
      q.y = q.top;
      // `0x426b66` — the loop let go as it goes off
      sound?.loop(SURGE.sound, false);
    }
  }
}

/**
 * The lightning's counter reaching its wrap switches every surge on
 * (`0x42682b`), and the arc starts from the top of its run.
 */
export function switchSurgesOn(): void {
  for (const q of level?.surges.flat() ?? []) {
    // its script ran out long ago, so the next think hops at once (`0x426b2c`)
    q.on = true;
  }
}

/**
 * Which cel a surge is showing. Off, its script has run out on its last cel —
 * nothing reinstalls it (`0x426a7e`) — and it stands there at the top.
 */
export function surgeCel(q: Surge): number {
  return SURGE.arc.cels[
    Math.min(SURGE.arc.cels.length - 1, Math.floor(q.clock / SURGE.arc.hold))
  ];
}

/**
 * MAZE's cage doors, alarms and fans — three classes that keep their own time.
 *
 * `0x413100` is the whole of a cage door: the two moving tags hand over as they
 * end, and the shutting one calls `0x411460`, which appends its rect to the
 * engine's obstacle table. That is the only thing that makes it solid, and it is
 * the same table the level's own `obstacle` records fill.
 */
export function stepCages(): void {
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
export function cageCel(c: Cage): number {
  if (c.state === "shut") return CAGE.shut;
  if (c.state === "open") return 0;
  const a = c.state === "opening" ? CAGE.opening : CAGE.closing;
  return a.cels[Math.min(a.cels.length - 1, Math.floor(c.clock / a.hold))];
}

/**
 * ...the alarms, which sweep and sound while the vertical fan carrying their
 * param sucks (`0x412fc0`, `0x415dc0`), and the fans, which keep their own
 * counter — see {@link FAN}.
 */
/**
 * TOWER's lightning — `0x426800`, which is a metronome and nothing else.
 *
 * The counter belongs to the LEVEL rather than to any object, runs 0…201 and
 * strikes on 195, so the period is 202 engine frames and the bolt is standing
 * up for the last seven of them before the counter wraps. Nothing you do starts
 * it and nothing you do stops it.
 *
 * The flash is `0x40e4c0(0)`: a colour handed to the painter, flooded over the
 * whole view rect on the next frame and cleared again. In TOWER's own palette
 * colour 0 is blue.
 */
export function stepLights(): void {
  // ...and it is the LEVEL's, not the room's: `0x426800` is TOWER's own
  // per-frame function and `0x426870` walks the whole buffer, so the thunder and
  // the flash reach you in every room and only the bolts themselves are
  // somewhere in particular
  const all = level?.lights.flat() ?? [];
  if (!all.length && !level?.surges.some((r) => r.length)) return;
  for (const q of all) if (q.clock >= 0) q.clock += 1;
  // `0x426800`..`0x426815`: the test is on the count BEFORE the increment, so it
  // reaches 0xc9 for one frame and the period is 0xca
  const was = levelClock;
  levelClock += 1;
  if (was > LIGHTFX.period - 2) {
    levelClock = 0;
    // `0x426829`: and every surge in the level switches on
    switchSurgesOn();
  }
  stepStruck();
  // the bolt's second frame on its first cel — see {@link boltStrikes}
  if (all.some((q) => q.clock === 1)) boltStrikes(all);
  if (levelClock !== LIGHTFX.strikeAt || !all.length) return;
  for (const q of all) q.clock = 0;
  // `0x426857` — at the PLAYER's own y, not the bolt's, so it is overhead
  // wherever you are standing
  sound?.effect(LIGHTFX.sound, p.x, p.y, "lead");
  flashColour = LIGHTFX.flash;
  boltStrikes(all);
}

/**
 * ...and the bolt STRIKES. `0x426780`, the bolt's own think, asks on its
 * first frame (`obj+0x42` and `obj+0x44` both 0, `0x426785`/`0x42678c`) one
 * thing only: is its point BELOW the player's (`0x42679c`, `obj+6` against
 * the player's `obj+6`, a signed `jle`). No x, no distance — every bolt in
 * the level asks it, so a player who has climbed above a bolt's point is hit
 * wherever he is. Then `0x4267a2`: armed (`0x402ee0`) with the scepter,
 * weapon 16 (`0x4267ac`), `0x402fa0(6)`; anything else, `0x402fa0(7)`.
 *
 * And it asks TWICE. The bolt's script holds its first cel two frames
 * (`0x46f588`, two ticks a frame), so `obj+0x42` is 0 on both, and each time
 * `0x45d090` puts the reaction on from its first frame whatever was playing
 * (`0x45d0ab` zeroes the frame index, `0x45d0db` the tick count): the charge
 * or the shock starts over one frame late, and the shock's `0x40e4c0(5)`
 * floods a second frame. The life is spent once, as the death ends.
 */
function boltStrikes(all: readonly LightFx[]): void {
  const ay = p.y - p.feet;
  if (!all.some((q) => q.y > ay) || film) return;
  // `0x402fa0` opens with `0x402df0`: every key dropped
  dropKeys();
  if (inv.drawn && inv.weapon === LIGHTFX.rod) {
    // `0x42f3af` — `0x470c40` tag 18, the scepter's own script: the charge
    if (p.act === "fire") shutStreams();
    p.act = "struck";
    p.actClock = 0;
    p.flail = false;
    struckTags = 0;
    return;
  }
  // `0x42f3c5` — `0x40e4c0(5)` and `0x4721a0` TAG 3, the shock and the fall.
  // Unconditional: no `0x402f60` test here, so it is a death whatever the
  // health says, and it goes on from its first frame over whatever was playing
  flashColour = LIGHTFX.struckFlash;
  p.act = "dying";
  p.actClock = 0;
  p.vx = 0;
  p.dyingTag = 3;
  // ...and the life goes with it, once: `died` answers a second call with
  // nothing, as the disc spends it only as the death script ends
  void died();
}

/**
 * A lightning strike on the scepter — `0x470c40` tags 18..22 in the player's
 * armed state machine `0x42d2b0`, three frames each, all on one cel.
 *
 * ```
 *   42d93e  tags 18 and 20 end: 0x40e4c0(5), fire(3), the next tag
 *   42d98a  tags 19 and 21 end: fire(4), the next tag
 *   42d9c7  tag 22 ends:  weapon 16, 0x45ef30(0xa0), 0x45b060 — the scepter
 *           thrown on the floor — [0x479438] = 0, and 0x4722a8 tag 0
 * ```
 *
 * `fire` is `[0x4a7fd8]`, the scepter's fire function `0x41f6b0`, and its
 * variants 3 and 4 (`0x41f7e2`) cost nothing, hang the beam 48 along and 130
 * up, and turn it round (`user+8`, read at `0x42466c`). So the bolt goes out
 * of the rod four times, the gauge fills, and it is knocked out of your hands.
 */
function stepStruck(): void {
  if (p.act !== "struck") return;
  // each tag that has ended since last time, in order
  const now = Math.floor(p.actClock / LIGHTFX.charge.hold);
  for (; struckTags < now && struckTags < LIGHTFX.charge.tags; struckTags++) {
    const ended = struckTags;
    if (ended < LIGHTFX.charge.tags - 1) {
      if (ended % 2 === 0) flashColour = LIGHTFX.struckFlash;
      dischargeScepter(ended % 2 === 0 ? 3 : 4);
      continue;
    }
    // `0x42d9d7`..`0x42da31`
    inv.weapon = LIGHTFX.rod;
    loadRounds(LIGHTFX.rod, LIGHTFX.charge.rounds);
    dropGun();
    p.act = "downFront";
    p.actClock = 0;
    return;
  }
}

/** how many of the strike's tags {@link stepStruck} has already ended */
let struckTags = 0;

/** `0x41f7e2` — a beam of the scepter's, variant 3 or 4, and free */
function dischargeScepter(variant: 3 | 4): void {
  const kit = STREAMS[LIGHTFX.rod];
  if (!kit) return;
  // `0x41f73a` — 0x22 through `0x40f110`, at the beam
  sound?.effect(kit.sound.effect ?? 0x22, p.x, p.y, "renew");
  streams.push({
    weapon: LIGHTFX.rod,
    x: p.x,
    y: p.y,
    facing: -p.facing,
    state: "start",
    clock: 0,
    variant,
    flip: true,
  });
}

/** which cel a bolt is showing, or 0 while there is none */
export function lightCel(q: LightFx): number {
  if (q.clock < 0) return 0;
  const i = Math.floor(q.clock / LIGHTFX.bolt.hold);
  return i < LIGHTFX.bolt.cels.length ? LIGHTFX.bolt.cels[i] : 0;
}

/**
 * MAZE's big guns — `0x4135b0`, one handler and eight script kinds.
 *
 * The hatch and the turret are two objects in `SC.EXE` and one record here,
 * because they never disagree: both start on the same rect test and the hatch's
 * four tags simply shadow whatever the turret is doing. What is faithful is the
 * ORDER — every state that can be interrupted tests the rect first and folds
 * away the moment the player is outside it, so backing out of the rect stops
 * the gun wherever it had got to rather than letting it finish.
 */
export function stepBigGuns(): void {
  for (const g of hereOf((l) => l.bigguns)) {
    const inside =
      p.x >= g.left &&
      p.x <= g.right &&
      p.y - p.feet >= g.top &&
      p.y - p.feet <= g.bottom;
    stepHatch(g, inside);
    g.clock += 1;
    switch (g.state) {
      // `0x41360a` — waiting, and the rect is the only way out of it
      case "wait":
        if (inside) {
          g.state = "arm";
          g.clock = 0;
        }
        break;
      // `0x41363e` — 0x46c1e8 tag 1, eight frames at two, then it drops
      case "arm":
        if (g.clock >= BIGGUN.wait.frames * BIGGUN.wait.hold) {
          g.state = "drop";
          g.clock = 0;
        }
        break;
      // `0x41365f` — eight a frame until it is 0x6e below its HOME, and home is
      // the point already lifted by ten: `0x4115ec` decrements the user block's
      // own copy before `0x4115fb` reads it back out for the object's position,
      // so `0x41366b` measures from there and the drop is 100 below the record
      case "drop":
        g.gunY += BIGGUN.step;
        if (g.gunY >= g.y - BIGGUN.turretUp + BIGGUN.drop) {
          g.state = "unfold";
          g.clock = 0;
        }
        break;
      // `0x413692` — and from here on, leaving the rect folds it away
      case "unfold":
        if (!inside) {
          g.state = "fold";
          g.clock = 0;
        } else if (g.clock >= BIGGUN.unfold.cels.length * BIGGUN.unfold.hold) {
          g.state = "fire";
          g.shot = 0;
          g.clock = 0;
        }
        break;
      // `0x4136e3` — tags 0 and 1 each fire one bolt, tag 2 is the recovery
      case "fire": {
        if (!inside) {
          g.state = "fold";
          g.clock = 0;
          break;
        }
        const run =
          g.shot === 0
            ? BIGGUN.fire.one
            : g.shot === 1
              ? BIGGUN.fire.two
              : BIGGUN.fire.done;
        if (g.clock < run.cels.length * run.hold) break;
        if (g.shot < 2) {
          // `0x41373c` / `0x413770` — the sound, then `0x412a70(gun, 0)`, which
          // inverts the shooter's own mirror flag: the gun faces you and the
          // shot goes the other way round, which is the same way. Variant 0
          // is its own shot, not the blaster's — {@link GUNBOLT}
          sound?.effect(BIGGUN.sound, g.x, g.gunY);
          spawnBolt(g.x, g.gunY, p.x > g.x ? 1 : -1, 100);
          g.shot += 1;
          g.clock = 0;
        } else {
          g.state = "blink";
          g.clock = 0;
        }
        break;
      }
      // `0x4137b4` — and it asks again at the END of the blink, not during it
      case "blink":
        if (g.clock < BIGGUN.blink.cels.length * BIGGUN.blink.hold) break;
        g.state = inside ? "fire" : "fold";
        g.shot = 0;
        g.clock = 0;
        break;
      // `0x413830` — folding does not check anything; it finishes
      case "fold":
        if (g.clock >= BIGGUN.fold.cels.length * BIGGUN.fold.hold) {
          g.state = "rise";
          g.clock = 0;
        }
        break;
      // `0x413851` — eight a frame back up, and home is the record's own point
      case "rise":
        g.gunY -= BIGGUN.step;
        if (g.gunY <= g.y - BIGGUN.turretUp) {
          g.gunY = g.y - BIGGUN.turretUp;
          g.state = "wait";
          g.clock = 0;
        }
        break;
    }
  }
}

/** `0x41387c` — the hatch, which has its own four tags and its own clock */
export function stepHatch(g: BigGun, inside: boolean): void {
  g.hatchClock += 1;
  const run =
    g.hatch === 1
      ? BIGGUN.hatch.open
      : g.hatch === 2
        ? BIGGUN.hatch.held
        : g.hatch === 3
          ? BIGGUN.hatch.close
          : null;
  if (!run) {
    if (inside) {
      g.hatch = 1;
      g.hatchClock = 0;
    }
    return;
  }
  if (g.hatchClock < run.cels.length * run.hold) return;
  // tag 1 always goes to 2; tag 2 asks the rect again; tag 3 goes home
  g.hatch = g.hatch === 1 ? 2 : g.hatch === 2 ? (inside ? 2 : 3) : 0;
  g.hatchClock = 0;
}

/** which cel the hatch is showing — `0x46c238`'s four tags */
export function hatchCel(g: BigGun): number {
  if (g.hatch === 0) return BIGGUN.hatch.shut;
  const run =
    g.hatch === 1
      ? BIGGUN.hatch.open
      : g.hatch === 2
        ? BIGGUN.hatch.held
        : BIGGUN.hatch.close;
  const i = Math.min(run.cels.length - 1, Math.floor(g.hatchClock / run.hold));
  return run.cels[i];
}

/** which cel the turret is showing, or 0 while it is still behind the hatch */
export function gunCel(g: BigGun): number {
  const step = (
    a: { cels: readonly number[]; hold: number },
    clock: number,
  ): number => a.cels[Math.min(a.cels.length - 1, Math.floor(clock / a.hold))];
  switch (g.state) {
    case "wait":
      return 0;
    case "arm":
    case "drop":
      return BIGGUN.unfold.cels[0];
    case "unfold":
      return step(BIGGUN.unfold, g.clock);
    case "fire":
      return step(
        g.shot === 0
          ? BIGGUN.fire.one
          : g.shot === 1
            ? BIGGUN.fire.two
            : BIGGUN.fire.done,
        g.clock,
      );
    case "blink":
      return BIGGUN.blink.cels[
        Math.floor(g.clock / BIGGUN.blink.hold) % BIGGUN.blink.cels.length
      ];
    case "fold":
      return step(BIGGUN.fold, g.clock);
    case "rise":
      return BIGGUN.fold.cels[BIGGUN.fold.cels.length - 1];
  }
}

export function stepAlarms(): void {
  for (const a of level?.alarms.flat() ?? []) {
    // `0x412fc0`: tag 0 is the one quiet cel; tag 1 sweeps and sounds each time round
    if (!a.on) continue;
    const was =
      Math.floor(a.clock) % (ALARM.flash.cels.length * ALARM.flash.hold);
    a.clock += 1;
    if (
      Math.floor(a.clock) % (ALARM.flash.cels.length * ALARM.flash.hold) <
      was
    )
      sound?.effect(ALARM.sound, a.x, a.y);
  }
}

/** `0x415dc0` — every alarm carrying this param onto tag 0 (quiet) or tag 1 */
export function setAlarms(param: number, on: boolean): void {
  for (const a of level?.alarms.flat() ?? []) {
    if (a.param !== param) continue;
    a.on = on;
    a.clock = 0;
  }
}

export function alarmCel(a: Alarm): number {
  if (!a.on) return ALARM.quiet;
  const i = Math.floor(
    (a.clock % (ALARM.flash.cels.length * ALARM.flash.hold)) / ALARM.flash.hold,
  );
  return ALARM.flash.cels[Math.min(ALARM.flash.cels.length - 1, i)];
}

export function stepFans(): void {
  const ay = p.y - p.feet;
  // every fan in the LEVEL: the class list is the stage's, and the vertical ones
  // work alarms that may stand in another room
  for (const f of level?.fans.flat() ?? []) {
    f.clock += 1;
    // kind 1, the blades running red: its end hands to tag 1 (`0x4156e2`, `0x415c82`)
    if (f.red) {
      const red = f.horizontal ? FAN.h.red : FAN.v.red;
      if (f.clock < red.cels.length * red.hold) continue;
      f.red = false;
      f.state = "stop";
      f.clock = 0;
      continue;
    }
    // the player's point in the record's rect (`0x415445`, `0x415a14`)
    const inside =
      p.x >= f.left && p.x < f.right && ay >= f.top && ay < f.bottom;
    // `0x4153fa`: the test is on the count BEFORE the decrement
    const out = f.count < 0;
    f.count -= 1;
    if (f.state === "suck") {
      if (out) {
        f.state = "stop";
        f.clock = 0;
        f.count = FAN.offFrames;
        if (!f.horizontal) setAlarms(f.param, false);
        continue;
      }
      if (!inside || p.act === "dying" || film) continue;
      if (f.horizontal) {
        // `0x415464`: toward the fan's x; `0x4154a3`: within 140 it kills;
        // `0x415554`: within 270 it stops the fall and turns you to face it
        p.vx += roundAway((p.x <= f.x ? FAN.h.push : -FAN.h.push) / DIVISOR);
        const dx = Math.abs(p.x - f.x);
        if (dx < FAN.h.killPx) {
          fanKills(f);
        } else if (dx < 0x10e) {
          p.vyRaw = 0;
          p.facing = p.x > f.x ? -1 : 1;
          // `0x415588` — `0x402fa0(0)`, every frame of it: `0x402df0` drops
          // every key, so nothing held walks you out of the fan's pull
          dropKeys();
        }
      } else {
        // `0x415a2c`: up into it; `0x415a6e`: within 100 of it, it kills
        p.vyRaw += roundAway(FAN.v.suck / DIVISOR);
        if (Math.abs(ay - f.y) < FAN.v.killPx) fanKills(f);
      }
      continue;
    }
    if (f.state === "stop") {
      if (!out) continue;
      sound?.effect(FAN.change, f.x, f.y);
      f.state = "blow";
      f.clock = 0;
      f.count = FAN.onFrames;
      continue;
    }
    if (f.state === "blow") {
      if (out) {
        f.state = "rest";
        f.clock = 0;
        f.count = FAN.offFrames;
        continue;
      }
      if (!inside) continue;
      // `0x415650` / `0x415bf0`: the same push, away
      if (f.horizontal)
        p.vx += roundAway((p.x <= f.x ? -FAN.h.push : FAN.h.push) / DIVISOR);
      else p.vyRaw += roundAway(FAN.v.blow / DIVISOR);
      continue;
    }
    // "rest"
    if (!out) continue;
    sound?.effect(FAN.change, f.x, f.y);
    if (!f.horizontal) setAlarms(f.param, true);
    f.state = "suck";
    f.clock = 0;
    f.count = FAN.onFrames;
  }
}

/**
 * `0x4154ae` / `0x415a85`: `0x402fa0(8)` (`0x4154b7`, `0x415a89`), 0x16, and
 * the blades run red. `0x402fa0` opens with `0x402df0`, which drops every key.
 */
export function fanKills(f: Fan): void {
  dropKeys();
  // `0x4154d8` / `0x415aba` — `0x40c900(player, 0x78, fan)` once `0x402ac0(0x4b0)`
  // has emptied the tank, so it is always blood; the fan stands still
  const cel = level ? celRec(level.sbk, fanCel(f)) : null;
  bleed(0x78, ownPoint(), { blow: cel?.blow ?? null, facing: 1, vx: 0, vy: 0 }, true);
  sound?.effect(FAN.kill, f.x, f.y);
  f.red = true;
  f.clock = 0;
  void died();
}

/** which cel a fan is showing — each tag loops, as the think reinstalls it */
export function fanCel(f: Fan): number {
  const kit = f.horizontal ? FAN.h : FAN.v;
  const n = kit.spin.cels.length;
  if (f.red)
    return kit.red.cels[Math.min(kit.red.cels.length - 1, Math.floor(f.clock / kit.red.hold))];
  if (f.state === "rest") return kit.stopped;
  if (f.state === "stop") return kit.held;
  const i = Math.floor(f.clock / kit.spin.hold) % n;
  return f.state === "suck" ? kit.spin.cels[i] : kit.spin.cels[n - 1 - i];
}

/**
 * BARREL's conveyors — `0x416840`, which is one test and one number.
 *
 * The belt asks whether the bottom of the player's drawn box (`0x42f9f0`) is
 * above its own point by less than 20 (`0x416881`), whether their POINT's x is
 * strictly inside its rect (`0x416899`), and whether they are on the ground
 * (`0x4168d0`); if so it adds its record's `param` — 4, 6, 8 or 10 — to the
 * player's `obj+0xc`, every frame (`0x4168db`; a left-hand belt subtracts it,
 * `0x41694b`). The ground's drag keeps 30% of it (`0x4302c0`), so a belt
 * settles where `v = drag(v) + param`: 6 a frame for a param of 4, 13 for 10
 * — and walking adds to it.
 *
 * The belt thinks before the mover moves anyone (`0x417c20`); this runs after
 * the frame tick's quarter of the move, so it adds that quarter of the push to
 * the position as well. The three ticks that follow carry the rest at the new
 * velocity, and the frame moves exactly `drag(v) + param`, as the engine does.
 */
export function stepBelts(): void {
  const here = hereOf((l) => l.belts);
  if (!here.length) return;
  for (const b of here) {
    b.clock += 1;
    if (!p.onGround) continue;
    const me = playerSprite();
    const bottom = me ? me.top + me.f.height : p.y;
    const above = b.y - bottom;
    if (!(above > 0 && above < BELT.bandPx)) continue;
    if (!(p.x > b.left && p.x < b.right)) continue;
    p.vx += b.dir * b.param;
    p.x += b.dir * b.param * TICK_SCALE;
  }
}

/** which cel a belt is showing — backwards for a left-hand one, which is tag 1 */
export function beltCel(b: Belt): number {
  // `0x411532`: a param under 5 is `0x46c188` (three frames a cel), under 10
  // `0x46c130` (two), and otherwise `0x46c0d8` (one)
  const hold = b.param < 5 ? BELT.slowHold : b.param < 10 ? 2 : BELT.roll.hold;
  const i = Math.floor(b.clock / hold) % BELT.roll.cels.length;
  return b.dir < 0
    ? BELT.roll.cels[BELT.roll.cels.length - 1 - i]
    : BELT.roll.cels[i];
}

/** ...and the chairs, three tags handed round until you come near — {@link CHAIR} */
export function stepChairs(): void {
  for (const c of hereOf((l) => l.chairs)) {
    const run = CHAIR.runs[c.run];
    // tag 3 has no handler (`0x417a08`)
    if (!run) continue;
    const was = c.run;
    if (c.clock >= run.cels.length * run.hold) {
      c.clock = 0;
      c.run = (c.run + 1) % CHAIR.runs.length;
    }
    // `0x417a50`: only tag 2's handler tests the distance — after its own end
    // check, so it can take a chair from tag 2 to 3 on the frame it would go to 0
    if (was === 2 && Math.abs(c.x - p.x) < CHAIR.nearPx) {
      c.run = CHAIR.runs.length;
      c.clock = 0;
      continue;
    }
    c.clock += 1;
  }
}

export function chairCel(c: Chair): number {
  const run = CHAIR.runs[c.run];
  if (!run) return CHAIR.rest;
  return run.cels[
    Math.min(run.cels.length - 1, Math.floor(c.clock / run.hold))
  ];
}

/**
 * The claws — `0x4171e0`, a carriage on a rail that follows you.
 *
 * Its velocity is clamped to ±26 (`0x417344`, `0x417376`) and its position to
 * its own record's bounds (`0x417316`), so it tracks the player along its track
 * and cannot leave it. `0x417289` then measures the gap: inside 300 it reaches
 * down, past 600 it waits, and in between it runs.
 *
 * ...and while it runs it can also DIVE, which is the other claw: kind 1, the
 * 2450s, reached from the tracker's band table rather than from that distance
 * (`0x41734a`). It reaches at 140 pixels ahead and commits at 100, and if it
 * comes down on you it clamps with the code -3 on the only four cels of the
 * fifty-two that carry a grip. See {@link CLAW} and `src/codes.ts`.
 */
export function stepClaws(): void {
  const here = hereOf((l) => l.claws);
  if (!here.length) return;
  for (const c of here) {
    c.clock += 1;
    const want = Math.max(c.left, Math.min(c.right, p.x));
    const gap = Math.abs(p.x - c.x);
    // the DIVE, and it owns the claw until it is back up — `0x4173bf`'s four tags
    if (c.state === "dive" || c.state === "clamp" || c.state === "lift") {
      const a =
        c.state === "dive"
          ? CLAW.dive
          : c.state === "clamp"
            ? CLAW.jaws
            : CLAW.lift;
      if (c.clock < a.cels.length * a.hold) continue;
      c.clock = 0;
      if (c.state === "dive") {
        // `0x417448` — `obj+0x2a`, and a dive that touched nothing goes straight
        // back up without ever showing the code
        c.state = c.caught ? "clamp" : "lift";
        c.caught = false;
        if (c.state === "clamp") sound?.effect(CLAW.clamp, c.x, c.y);
      } else if (c.state === "clamp") {
        // `0x417496` writes the blow back to 0 before it rises, which is what
        // lets go: the grip goes with the cels
        c.state = "lift";
      } else c.state = "running";
      continue;
    }
    if (c.state === "down" || c.state === "shut" || c.state === "up") {
      const a =
        c.state === "down"
          ? CLAW.down
          : c.state === "shut"
            ? CLAW.shut
            : CLAW.up;
      if (c.clock < a.cels.length * a.hold) continue;
      c.clock = 0;
      c.state =
        c.state === "down" ? "shut" : c.state === "shut" ? "up" : "running";
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
    /**
     * What it does about the player, nearest test first.
     *
     * The original measures two different distances and this page has only ever
     * had one. `0x417289`'s 300 and 600 are from the RECORD's own point, which
     * is fixed; the band the diving kind comes off is from the CLAW's x, which
     * is not. This keeps the single gap the class was built on and orders the
     * tests by reach, so the nearer behaviour wins — which is what the numbers
     * say happens anyway: 140 is inside 300.
     *
     * `0x45efd0` hands `0x41734a` an index into `0x46dfc8` — 180, 140, 100 —
     * and only bands 2 and 3 install the diving kind, so it reaches at 140 and
     * commits at 100. A negative gap is band -1 and reaches for nothing; this
     * page has no facing on a claw, so it reaches either way and that is the
     * one liberty taken here.
     */
    if (gap > CLAW.restPx) {
      c.state = "idle";
    } else if (gap <= CLAW.reachBand) {
      c.state = "dive";
      c.clock = 0;
      sound?.effect(CLAW.wizz, c.x, c.y);
    } else if (gap < CLAW.reachPx && Math.abs(want - c.x) < 4) {
      c.state = "down";
      c.clock = 0;
    }
  }
}

/** which cel a claw is showing */
export function clawCel(c: Claw): number {
  const a =
    c.state === "idle"
      ? CLAW.idle
      : c.state === "running"
        ? CLAW.running
        : c.state === "down"
          ? CLAW.down
          : c.state === "shut"
            ? CLAW.shut
            : c.state === "dive"
              ? CLAW.dive
              : c.state === "clamp"
                ? CLAW.jaws
                : c.state === "lift"
                  ? CLAW.lift
                  : CLAW.up;
  const i =
    c.state === "idle" || c.state === "running"
      ? Math.floor(c.clock / a.hold) % a.cels.length
      : Math.min(a.cels.length - 1, Math.floor(c.clock / a.hold));
  return a.cels[i];
}

/**
 * What Boggs' body says as a blow lands — `0x41bc50`, and see
 * {@link BOGGS.struck} and {@link BOGGS.hint}. `bolted` is a blaster bolt,
 * the class `0x41bca7` asks about.
 */
export function boggsStruck(b: Boggs, bolted: boolean): void {
  const s = BOGGS.struck;
  const up = b.flags[0] || b.flags[1];
  // `0x41bcd6` through `0x40f110`, or `0x41bcf9` through `0x40ef30`
  if (up && bolted) {
    const which = s.bolted + roll(s.boltRoll);
    sound?.effect(which, b.x, b.y, "renew");
  } else {
    const which = s.sound + roll(s.roll);
    sound?.effect(which, b.x, b.y);
  }
  if (!up) return;
  const h = BOGGS.hint;
  const was = b.blows ?? 0;
  b.blows = was + 1;
  const m = b.machines[h.machine];
  if (was > h.after && m && m.x - h.westOf > p.x) {
    sound?.effect(h.sound, b.headX, b.headY, "lead");
    b.blows = 0;
  }
}

/** what a fitting is playing — see {@link FITTING} */
function fittingAnim(f: Fitting): { cels: readonly number[]; hold: number } {
  if (f.kind === "teeth") return { cels: [FITTING.teeth.cel], hold: 1 };
  if (f.kind === "ball")
    return f.phase === "out" ? FITTING.ball.out : f.phase === "back" ? FITTING.ball.back : FITTING.ball.idle;
  return f.phase === "spray" ? FITTING.shower.spray[f.tag] : FITTING.shower.idle[f.tag];
}

/** the cel a fitting is showing — the teeth's one, a shower's or a ball's script */
export function fittingCel(f: Fitting): number {
  const a = fittingAnim(f);
  return a.cels[Math.min(a.cels.length - 1, Math.floor(f.clock / a.hold))];
}

/**
 * `[0x46cd8c]` — the shower's first-time cue. It ships as 1 and `0x41a38f` is
 * the only write, so it is spent once in a run of the game.
 */
let showerFirst = true;

/**
 * VAT's showers and balls, one engine frame each — `0x41a2a0` and `0x41a7d0`.
 * See {@link FITTING} for the whole of both.
 */
export function stepFittings(): void {
  const lvl = level;
  if (!lvl) return;
  const px = p.x;
  const py = p.y - p.feet;
  // `0x434200`, half-open, the player's own point against the record's rect
  const inside = (f: Fitting): boolean => px >= f.left && px < f.right && py >= f.top && py < f.bottom;
  for (const f of hereOf((l) => l.fittings)) {
    if (f.kind === "teeth") continue;
    const a = fittingAnim(f);
    const ended = f.clock >= a.cels.length * a.hold;
    const at = Math.floor(f.clock / a.hold);
    if (f.kind === "shower") {
      const S = FITTING.shower;
      if (f.phase === "idle") {
        if (!inside(f)) continue;
        if (showerFirst) {
          showerFirst = false;
          sound?.effect(S.first, f.x, f.y, "lead");
        }
        const hiss = roll(S.hiss);
        sound?.effect(hiss, f.x, f.y);
        f.phase = "spray";
        f.clock = 0;
        continue;
      }
      // `0x41a2f8` — the x distance and nothing else, on the frames that burn,
      // and only while `0x402f60` says the player is on his feet
      if (Math.abs(px - f.x) < S.withinPx && S.burns(S.base[f.tag] + at) && p.act !== "dying") {
        if (damageOn) takeHealth(S.health);
        // `0x41a3f0` makes a new flame every frame it is called
        lightFlame(p, celRec(player, lastCel), p.facing < 0, { stack: true });
        sound?.effect(S.burn, px, py);
      }
      if (ended) {
        f.phase = "idle";
        f.clock = 0;
      } else f.clock += 1;
      continue;
    }
    const B = FITTING.ball;
    if (f.phase === "idle") {
      if (!inside(f)) continue;
      sound?.effect(B.cue, px, py, "lead");
      f.phase = "out";
      f.clock = 0;
      continue;
    }
    if (at === B.swishAt) sound?.effect(B.swish, f.x, f.y);
    if (ended) {
      f.phase = f.phase === "out" ? "back" : "idle";
      f.clock = 0;
    } else f.clock += 1;
  }
}

/**
 * ...and BOGGS, on the idle `0x46e6b0` gives it. Four thousand health and thirty
 * a frame back while its machine runs, which is what makes it the boss — its hit
 * handler turns away only its own parts. See {@link BOGGS}.
 */
/**
 * Boggs, once an engine frame — and it is four objects, not one.
 *
 * `0x41be68` heals the body while EITHER of the flags at `0x46e080` and
 * `0x46e084` is set, and the flags are not a phase it enters: both ship as
 * `01 00` in `.data`, nothing in `.text` ever sets one, and the only two writes
 * there are are the clears at `0x41b611` and `0x41b75d`. Both of those are in
 * the MACHINERY's hit handler, one per breakable half.
 *
 * So the fight is: break three thousand of machine to stop half the healing,
 * break three thousand more to stop the rest, and only then can the four
 * thousand on the head be spent. See {@link BOGGS.machines}.
 *
 * Everything else is placed against the body. VAT's frame loop runs the body's
 * tick (`0x41be50`), the first machine's think (`0x41afd0`) and the move pass,
 * and then re-places the head (`0x41c4c0`), the eight machines (`0x411ed0`)
 * and the arm (`0x412180`) from the body's new point — every frame, so all of
 * it lunges with the body. See {@link placeBoggs}.
 */
export function stepBoggs(): void {
  for (const b of hereOf((l) => l.boggs)) {
    b.clock += 1;
    if (b.snap > 0) b.snap -= 1;
    // the worms are a class of their own and run whatever the body is doing
    stepBoggsWorms(b);
    for (const m of b.machines) {
      if (m.wrecked) m.wreckClock += 1;
      else m.clock += 1;
    }
    boggsSendsZap(b);
    boggsBody(b);
    boggsMachinery(b);
    placeBoggs(b);
  }
}

/**
 * `0x41bef4` — the body's tick puts the first machine out: the player at or
 * right of the body, the machine on its kind 0 and `0x46e080` up. See
 * {@link BOGGS.zap}.
 */
export function boggsSendsZap(b: Boggs): void {
  const z = b.zap;
  if (b.x - p.x > 0 || z.kind !== 0 || !b.flags[0]) return;
  z.kind = 1;
  z.tag = 0;
  z.clock = 0;
  z.dy = BOGGS.zap.at.dy;
  z.dx = BOGGS.zap.at.dx;
}

/**
 * `0x41afd0`, the machinery's own think, once a frame: the first machine's
 * sweep and the price of the sixth machine's wreck — {@link BOGGS.zap},
 * {@link BOGGS.drain}.
 *
 * The think runs before the stepper does (`0x419c30`, then `0x42fc10`), so
 * `obj+0x46` — the script has ended — is what the step of the frame before
 * left, and a tag's end is read the frame after its last cel is spent.
 */
export function boggsMachinery(b: Boggs): void {
  const z = b.zap;
  const Z = BOGGS.zap;
  // `0x41afd3` — `lab.snd` 0x14 armed to loop, every frame whatever else, and
  // while either half of the machine still runs it plays at the second half's
  // point (`0x41aff8`..`0x41b008`): the machine's hum, one loop the mixer keeps
  // and each frame's play moves
  sound?.loop(BOGGS.hum, true);
  if (b.flags[0] || b.flags[1]) {
    const m = b.machines[BOGGS.humAt];
    sound?.effect(BOGGS.hum, m.x, m.y);
  }
  if (z.kind === 1) {
    z.armed = true; // `0x41b022`
    // `0x41b028` / `0x41b045` — 0x402f60 is his kind under 0x1a, which is
    // what the brains read as the player being down
    if (p.act !== "dying") z.taunted = false;
    else if (!z.taunted) {
      z.taunted = true;
      sound?.effect(Z.taunt, b.headX, b.headY, "lead");
    }
    z.dx += Z.step[z.tag] ?? 0;
    if (z.clock >= (Z.frames[z.tag] ?? 1) * Z.hold) {
      // each tag's end installs the next; 4's is `0x46e4d0`, kind 0
      // (`0x41b105`) — and the stepper takes its first step of it this frame
      if (z.tag < Z.frames.length - 1) {
        z.tag += 1;
        z.clock = 1;
      } else {
        z.kind = 0;
        z.tag = 0;
        z.clock = 0;
      }
    } else z.clock += 1;
  }
  // `0x41b156` — the sixth machine's wreck run, and what it takes
  const d = BOGGS.drain;
  const g = b.machines[d.machine];
  const spec = BOGGS.machines[d.machine];
  const run = "wreck" in spec ? spec.wreck.length * spec.hold : 0;
  if (!g?.wrecked || g.wreckClock < 1 || g.wreckClock > run + 1) return;
  b.hp -= d.perFrame;
  const r = roll(d.odds[1]);
  if (r < d.odds[0]) {
    const at = b.machines[d.at];
    const across = roll(d.across[0]) - d.across[1];
    const down = roll(d.down);
    pops.push({ x: at.x + across, y: at.y + down, age: 0 });
  }
  // `0x41b1e2` — the run has ended: the gauge stops on 5945
  if (g.wreckClock === run + 1) {
    b.machines[d.at].wrecked = true;
    b.machines[d.at].wreckClock = 0;
  }
}

/**
 * `0x41c4c0`, `0x411ed0` and `0x412180`, which VAT's frame loop runs every
 * frame after the move (`0x419c76`..`0x419c80`): the head at the body plus its
 * stored offset, the eight machines at the body plus `0x46e088`'s, and the
 * first of them at the body plus `[0x4a5168]` instead. The arm is drawn at the
 * body's own point, which is what `0x4121ae` copies.
 */
export function placeBoggs(b: Boggs): void {
  b.headX = b.x + b.headOff.dx;
  b.headY = b.y + b.headOff.dy;
  // `0x41ab90` — the worms' box with the body, and each worm at the body plus
  // its own offset, held inside the box (`0x41ac09`..`0x41ac46`)
  if (b.bounds && b.boundsOff) {
    b.bounds = {
      left: b.x + b.boundsOff.left,
      right: b.x + b.boundsOff.right,
      top: b.y + b.boundsOff.top,
      bottom: b.y + b.boundsOff.bottom,
    };
  }
  for (const w of b.worms) {
    if (!w.off) continue;
    w.x = b.x + w.off.dx;
    w.y = b.y + w.off.dy;
    if (b.bounds) {
      w.x = Math.min(Math.max(w.x, b.bounds.left), b.bounds.right);
      w.y = Math.min(Math.max(w.y, b.bounds.top), b.bounds.bottom);
    }
  }
  for (let i = 0; i < b.machines.length; i++) {
    const m = b.machines[i];
    const spec = BOGGS.machines[i];
    m.x = b.x + (i === 0 ? b.zap.dx : spec.dx);
    m.y = b.y + (i === 0 ? b.zap.dy : spec.dy);
  }
}

/** the body's own share of `0x41be50` — the heal, the head, the jaws and the lunge */
function boggsBody(b: Boggs): void {
  if (b.dying) {
    b.headClock += 1;
    return;
  }
  // `0x41bd69` — and `0x41bdd8` is the level's own cleared flag
  if (b.hp <= 0) {
    b.dying = true;
    bossDown.lab = true;
    b.clock = 0;
    b.headClock = 0;
    // `0x41bda0` — through `0x40f090`, the mixer's channel 0
    sound?.effect(BOGGS.dies.sound, b.headX, b.headY, "lead");
    return;
  }
  // `0x41c182` — the head re-aims whenever its own script has ended, which at
  // one frame a tag and three ticks a frame is every third frame
  b.headClock += 1;
  if (b.headClock >= BOGGS.head.hold) {
    b.headClock = 0;
    b.headTag = boggsAim(b);
  }
  // `0x41be68` — thirty a frame, and only while a flag is still up
  if (b.flags[0] || b.flags[1])
    b.hp = Math.min(scaled(BOGGS.health), b.hp + BOGGS.regen);
  // `0x41c164` — the 5-in-100 branch, and the jaws snap through `0x46e558`
  const jaws = BOGGS.arm.jaws;
  if (
    b.snap <= 0 &&
    Math.floor(random() * jaws.snapOdds[1]) < jaws.snapOdds[0]
  ) {
    b.snap = jaws.snap.cels.length * jaws.snap.hold;
  }
  const a = b.lunge ? BOGGS.lunge[b.lunge] : null;
  if (a) {
    // the stride is the script's own, an impulse through the biggest divisor
    // in the game (`0x45d0f0` → `0x42f8b0`: 470/100 is 5 a frame, every frame
    // the cel shows), and the mover spends it with the ground's drag
    const k = Math.floor(b.clock / a.hold);
    if (k >= a.cels.length) {
      // `0x41bb86`: the script's end puts it back on the idle
      b.lunge = null;
      b.clock = 0;
      boggsMove(b);
      return;
    }
    const dx = a.dx[k] ?? 0;
    if (dx) b.vx = (b.vx ?? 0) + roundAway(dx / BOGGS.divisor);
    boggsMove(b);
    return;
  }
  boggsMove(b);
  // `0x41bffc` — seven in forty-two, once a frame, and only out of the idle
  if (Math.floor(random() * BOGGS.lunge.odds[1]) >= BOGGS.lunge.odds[0]) {
    // ...and `0x41c068` is what the other thirty-five frames do
    boggsReach(b);
    return;
  }
  // `0x41c047` — against the head's x, and at or past it is tag 1
  b.lunge = p.x >= b.headX ? "right" : "left";
  b.clock = 0;
  const which = BOGGS.lunge.sound + Math.floor(random() * 2);
  sound?.effect(which, b.x, b.y);
}

/**
 * Boggs' share of the mover: move by `obj+0xc`, then the drag (`0x4302c0`) —
 * the body's own whole 1.0, {@link BOGGS.drag} — and `0x41bb40` keeps the
 * body inside its record's x.
 */
export function boggsMove(b: Boggs): void {
  const v = b.vx ?? 0;
  if (!v) return;
  b.x += v;
  b.vx = dragged(v, BOGGS.drag);
  if (b.span) b.x = Math.max(b.span[0], Math.min(b.span[1], b.x));
}

/**
 * `0x41c068` — the half of the idle that is not the lunge.
 *
 * Five in a hundred spends the frame, anything inside a hundred in front of it
 * spends the frame, and the rest is the range: past three hundred it throws
 * out of its second machine, and at or under it a worm goes down. See
 * {@link BOGGS.reach}.
 */
export function boggsReach(b: Boggs): void {
  const r = BOGGS.reach;
  // `0x41c068` — `0x434540(0x64)` under five, and it only snaps
  if (Math.floor(random() * r.idle[1]) < r.idle[0]) return;
  // `0x41c07b` — `si` is the same signed gap the head aims on
  const si = b.x - p.x;
  if (si > 0 && si < r.close) return;
  // `0x41c09d` — and only while the flag the second machine's wreck clears is up
  if (si > r.far && b.flags[0]) {
    boggsThrow(b);
    return;
  }
  // `0x41c0fd` — seven in fifty-five, and one goes down where it stands
  const w = BOGGS.worms;
  if (Math.floor(random() * w.odds[1]) >= w.odds[0]) return;
  const off = {
    dx: w.offX[0] - Math.floor(random() * w.offX[1]),
    dy: w.offY[0] + Math.floor(random() * w.offY[1]),
  };
  // `0x41c149` — 0x18 at the body, before the dropper has counted anything
  sound?.effect(w.sound, b.x, b.y);
  // `0x41c3c8` — `cmp [list+4], 0x13; jg`: a count past nineteen refuses, so
  // the twentieth goes down and the twenty-first does not
  if (b.worms.length > w.cap) return;
  const at = { x: b.x + off.dx, y: b.y + off.dy, kind: 0 as const, clock: 0, off };
  // `0x41ac09`…`0x41ac26` — and the record is what keeps it on the floor
  if (b.bounds) {
    at.x = Math.min(Math.max(at.x, b.bounds.left), b.bounds.right);
    at.y = Math.min(Math.max(at.y, b.bounds.top), b.bounds.bottom);
  }
  b.worms.push(at);
}

/**
 * `0x41c0a7` — and the counter is spent whether or not anything is thrown.
 *
 * `ax` is read BEFORE the decrement and tested against zero, so the frame the
 * word goes negative is the frame it fires; `0x41c0e4` then reseeds it with
 * `0x434540(0x1e) + 0x1e`. The throw itself leaves the second machine, eighty
 * along its facing, alternating between two heights — `0x41c38b` toggles
 * `[0x46e138]` on every call.
 */
export function boggsThrow(b: Boggs): void {
  const t = BOGGS.throwing;
  const was = b.throwWait;
  b.throwWait -= 1;
  if (was >= 0) return;
  b.throwWait = t.wait[0] + Math.floor(random() * t.wait[1]);
  const m = b.machines[t.machine];
  // `0x41c330` reads the machine's own `obj+0x28`, and the branch it is reached
  // through only runs with the player to its left
  const facing = -1;
  sound?.effect(t.sound, m.x, m.y);
  // `0x41c37e` ADDS its 140 and `0x41c386` its 40, and the engine's y grows
  // downward, so both of them are below the machine and not above it
  castAt(m.x, m.y + t.drop[b.throwDrop], facing, BOGGS_THROW);
  b.throwDrop = b.throwDrop === 0 ? 1 : 0;
}

/**
 * The worms, one engine frame each — `0x41adf0`, whose four kinds are one life.
 *
 * A dropped one waits on a single cel until the player is within
 * {@link BOGGS.worms.wake} in x, rises, strikes, sinks and is gone. It carries
 * a hundred the whole time (`0x41adf9`), and it never moves from where it was
 * put.
 */
export function stepBoggsWorms(b: Boggs): void {
  const w = BOGGS.worms;
  for (const m of b.worms) {
    m.clock += 1;
    if (m.kind === 0) {
      // `0x41ae18` — the only thing that wakes one
      if (Math.abs(p.x - m.x) >= w.wake) continue;
      m.kind = 1;
      m.clock = 0;
      continue;
    }
    const run =
      m.kind === 1 ? w.rise : m.kind === 2 ? w.strike : w.sink;
    if (m.clock < run.cels.length * run.hold) continue;
    if (m.kind === 1) {
      // `0x41ae5f` — the warning is played ONCE a level, and only for one that
      // rises to your left and within two hundred of your own height
      if (!b.warned && m.x < p.x && Math.abs(p.y - m.y) < w.warnBelow) {
        b.warned = true;
        sound?.effect(w.warn, m.x, m.y, "lead"); // `0x41ae9e`, through `0x40f090`
      } else sound?.effect(w.hiss, m.x, m.y);
      m.kind = 2;
      m.clock = 0;
    } else if (m.kind === 2) {
      sound?.effect(w.strikes, m.x, m.y); // `0x41aeeb`
      m.kind = 4;
      m.clock = 0;
    } else {
      m.clock = -1; // `0x41af3d` — gone, and the sweep below takes it
    }
  }
  b.worms = b.worms.filter((m) => m.clock >= 0);
}

/** every worm in the room the player is in — the debug line's own reader */
export function wormsHere(): BoggsWorm[] {
  const out: BoggsWorm[] = [];
  for (const b of hereOf((l) => l.boggs)) out.push(...b.worms);
  return out;
}

/** the cel a worm is showing, off its own kind and its own clock */
export function boggsWormCel(m: BoggsWorm): number {
  const w = BOGGS.worms;
  const run =
    m.kind === 0 ? w.sleep : m.kind === 1 ? w.rise : m.kind === 2 ? w.strike : w.sink;
  const i = Math.floor(m.clock / run.hold);
  return run.cels[Math.min(run.cels.length - 1, i)];
}

/**
 * Which of the head's nine look-at tags is aimed at you — `0x41bfe3` for the
 * column, `0x41c192` and `0x41c1b2` for the row.
 *
 * Both are measured off the BODY rather than the head, which is what the
 * disassembly does (`si` and `di` come from `0x4a5138`), and it matters once the
 * body has lunged out from under the head it is aiming.
 */
export function boggsAim(b: Boggs): number {
  const si = b.x - p.x; // positive when you are to its left
  const di = p.y - b.y; // positive when you are below it
  const col = si > BOGGS.head.far ? 0 : si > 0 ? 1 : 2;
  const row = di > BOGGS.head.below ? 6 : di > BOGGS.head.above ? 0 : 3;
  return row + col;
}

export function boggsCel(b: Boggs): number {
  if (b.dying) {
    const d = BOGGS.dies;
    return d.cels[Math.min(d.cels.length - 1, Math.floor(b.clock / d.hold))];
  }
  if (b.lunge) {
    const a = BOGGS.lunge[b.lunge];
    return a.cels[Math.min(a.cels.length - 1, Math.floor(b.clock / a.hold))];
  }
  return BOGGS.idle.cels[
    Math.floor(b.clock / BOGGS.idle.hold) % BOGGS.idle.cels.length
  ];
}

/** the head: `0x46e908` while it is dying, one of `0x46e7c0`'s nine otherwise */
export function boggsHeadCel(b: Boggs): number {
  if (b.dying) {
    const d = BOGGS.head.dies;
    return d.cels[
      Math.min(d.cels.length - 1, Math.floor(b.headClock / d.hold))
    ];
  }
  return BOGGS.head.look[b.headTag];
}

/**
 * Where the jaws hang — `0x412180`, the centre of the ARM cel's own collision
 * box, off the arm's anchor. Read per frame rather than frozen, for the reason
 * {@link gripAt} exists.
 */
export function jawsAt(b: Boggs): { x: number; y: number } {
  const art = celRec(level?.sbk, BOGGS.arm.poses[BOGGS.arm.tag]);
  const box = art?.body;
  if (!box) return { x: b.x, y: b.y };
  return {
    x: b.x + box.x0 + (box.x1 - box.x0) / 2,
    y: b.y + box.y0 + (box.y1 - box.y0) / 2,
  };
}

/** the jaws: `0x46e558` tag 3 while `0x41c164`'s snap runs, the placed pose otherwise */
export function jawsCel(b: Boggs): number {
  const jaws = BOGGS.arm.jaws;
  if (b.snap <= 0) return jaws.poses[BOGGS.arm.tag];
  const k = Math.floor(
    (jaws.snap.cels.length * jaws.snap.hold - b.snap) / jaws.snap.hold,
  );
  return jaws.snap.cels[Math.min(jaws.snap.cels.length - 1, k)];
}

/** one of the eight, on its own script — {@link BOGGS.machines} */
export function machineCel(b: Boggs, i: number): number {
  const spec = BOGGS.machines[i];
  const m = b.machines[i];
  if (m.wrecked && "wreck" in spec) {
    return spec.wreck[
      Math.min(spec.wreck.length - 1, Math.floor(m.wreckClock / spec.hold))
    ];
  }
  return spec.cels[Math.floor(m.clock / spec.hold) % spec.cels.length];
}

/**
 * A blow on one of the eight — `0x41b510`, after the friendly-fire filter and
 * the same `-1`-becomes-100 translation the body's handler does.
 *
 * Six of them only clang. The two that do not are three thousand each, and
 * emptying one clears one of the two healing flags — which is the whole of why
 * this boss can be killed.
 */
export function strikeMachine(b: Boggs, i: number, damage: number, bolted = false): boolean {
  const spec = BOGGS.machines[i];
  // `0x41b53f`..`0x41b56b` — every one of the eight answers with a sound
  const said = BOGGS.machineStruck;
  const at = b.machines[i];
  const which = (bolted ? said.bolted : said.sound) + roll(said.roll);
  sound?.effect(which, at.x, at.y);
  if (!("health" in spec)) return false;
  // `0x41b573`..`0x41b5cb` — and the two halves count toward a hint
  const a = b.machines[BOGGS.hint.machine];
  if (a && a.x - said.short < p.x) {
    const was = b.machineBlows ?? 0;
    b.machineBlows = was + 1;
    if (was > said.after) {
      b.machineBlows = 0;
      sound?.effect(said.hint, b.headX, b.headY, "lead");
    }
  }
  const m = b.machines[i];
  if (m.wrecked) return false;
  m.hp = Math.max(0, m.hp - damage);
  if (m.hp > 0) return true;
  // `0x41b611` / `0x41b75d` — the only two writes to either flag there are
  b.flags[spec.clears] = false;
  m.wrecked = true;
  m.wreckClock = 0;
  sound?.effect(spec.sound, m.x, m.y);
  // ...and the neighbours buckle with it: `0x41b65b` and `0x41b794`
  for (let k = 0; k < BOGGS.machines.length; k++) {
    const n = BOGGS.machines[k];
    if (
      !("wreckedBy" in n) ||
      n.wreckedBy !== spec.clears ||
      b.machines[k].wrecked
    )
      continue;
    b.machines[k].wrecked = true;
    b.machines[k].wreckClock = 0;
  }
  // `0x41b628` / `0x41b774` — the cue only the SECOND one to go plays
  // ...through `0x40f090`, the mixer's channel 0
  if (!b.flags[0] && !b.flags[1]) {
    sound?.effect(BOGGS.bothDownSound, m.x, m.y, "lead");
    // `0x41b640` / `0x41b78c` — and the hum is let go: its pass plays out
    sound?.loop(BOGGS.hum, false);
  }
  return true;
}

/**
 * The box a machine is STRUCK in, which is not the box it is drawn in.
 *
 * `0x4303b3` skips a victim whose cel carries a degenerate rect — the same rule
 * that makes the player untouchable through a knockdown — and of the eight
 * machinery cels only three carry one at all:
 *
 * ```
 *   5860  body y1..142   x-106..109    the breakable half at x6539
 *   5870  body y-8..133  x-46..168     the breakable half at x6694
 *   5960  body y28..56   x1..79        one piece of scenery, and a small box
 *   5630 5700 5720 5940 5650           no body box: cannot be hit at all
 * ```
 *
 * Reading the DRAWN extent instead made the decoration solid, and the decoration
 * is big: 5960 is drawn x6538..6767 across the whole right half of the machine
 * it stands beside, and 5720 is 193x319. A bolt fired at the breakable half was
 * being stopped by scenery that the disc says has no collision at all, clanging
 * off `0x41b510`'s "one of these two, or nothing happens" branch and taking
 * nothing. Fists reached it because a fist is swung from close enough to be
 * inside the machine's own box already.
 *
 * Translated by the anchor, the way `0x40e680` translates every rect — see
 * {@link strikeOf}.
 */
export function machineBox(
  b: Boggs,
  i: number,
): { left: number; right: number; top: number; bottom: number } | null {
  const art = celRec(level?.sbk, machineCel(b, i));
  if (!art?.body) return null;
  const m = b.machines[i];
  return {
    left: m.x + art.body.x0,
    right: m.x + art.body.x1,
    top: m.y + art.body.y0,
    bottom: m.y + art.body.y1,
  };
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
export const inv = {
  /** `0x479434` — which of {@link WEAPONS}, whether or not it is in your hands */
  weapon: 9,
  /**
   * `0x479438` — you are carrying it. The panel's icon (`0x40d663`) and the
   * swap at a different gun (`0x42f0a8`) read this, and nothing else does
   */
  armed: false,
  /**
   * ...and it is OUT: `player+0x18` is one of the five armed kinds 0x12..0x16
   * (`0x448bf0`). The fire button, the armed moveset, the knockdown's disarm and
   * the surge's recharge all ask this, not the flag above. INV flips it
   * (`0x428975`), and every unarmed script installed while you carry the gun
   * puts it away: the level's first idle, a respawn, a ladder, the bar, a
   * flail, a knockdown, and a reach that took anything but one of the five guns
   */
  drawn: false,
  /** `0x4a7f16 + id * 12`, per weapon */
  rounds: {} as Record<number, number>,
};

/** every flare in the air, and they outlive the room they were fired in */
export let flares: Flare[] = [];
/** the blaster's bolts in the air — see {@link BOLT} */
export let bolts: Bolt[] = [];
/** the flame, the water and the beam — see {@link STREAMS} */
export let streams: Stream[] = [];

/** which chapter's entry function has already run — see {@link CHAPTER_WEAPON} */
export let chapterWeapon: number | null = null;

/**
 * The positive-code records a room stands up, filed as {@link Gun}s.
 *
 * The join from a name to a code is {@link GUN_CODES}, which is the four
 * per-chapter blocks read together, and the band is the creator's own: not the
 * record's rect and not the drawn art, but `x ± 55` — `0x45af8a` writes exactly
 * that into the user struct and `0x45ae90` compares against nothing else.
 */
export function gunsIn(sbk: SbkFile, room: SbkRoom): Gun[] {
  const out: Gun[] = [];
  for (const e of sbk.entities) {
    if (!e.isEntity) continue;
    const code = Number(
      Object.keys(GUN_CODES).find(
        (c) => GUN_CODES[Number(c)].name === e.name,
      ) ?? NaN,
    );
    if (!Number.isFinite(code)) continue;
    if (
      e.pointY < room.top ||
      e.pointY > room.bottom ||
      e.pointX < room.left ||
      e.pointX > room.right
    )
      continue;
    out.push({
      code,
      x: e.pointX,
      y: e.pointY,
      left: e.pointX - GRAB.bandPx,
      right: e.pointX + GRAB.bandPx,
      clock: 0,
    });
  }
  return out;
}

/** how many rounds are in the named weapon */
export function roundsIn(id: number): number {
  return inv.rounds[id] ?? 0;
}

/** `0x45ef30` — add, and clamp to the weapon's own max */
export function loadRounds(id: number, n: number): void {
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
export function gunAhead(): Gun | null {
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
export function dropGun(): void {
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
  inv.drawn = false;
}

/**
 * The same throw from a dying gunner TCop — `0x45b060(6, point, mirror, region)`
 * out of `0x414599`, the blaster (weapon 6). `0x414580`..`0x414590` put it a
 * hundred pixels behind the cop: `-0xc8 + 0x64` facing east, `+0x64` west.
 */
export function dropBlaster(e: Enemy): void {
  const lvl = level;
  if (!lvl || !p.room) return;
  const i = lvl.rooms.indexOf(p.room);
  if (i < 0) return;
  const x = e.x - e.facing * 100;
  lvl.guns[i] = [
    ...lvl.guns[i],
    {
      code: 6,
      x,
      y: e.y,
      left: x - GRAB.bandPx,
      right: x + GRAB.bandPx,
      clock: 0,
      dropped: true,
      vy: 0,
      vx: 0,
    },
  ];
}

/**
 * INV, one engine frame of it — the button that puts the gun away and gets it
 * out again.
 *
 * Every player state, armed or not, answers `0x4ac386` with
 * `mov word ptr [eax+0x18], 0xf` — the unarmed idle unconditionally
 * (`0x4298c0`), the unarmed walk and run only while `0x479438` says you carry a
 * gun (`0x429af4`), and all five guns' handlers. State 15 (`0x428975`) then:
 *
 *   - while the button is DOWN, installs the unarmed idle `0x471648`
 *     (`0x428c46`). That is kind 0, so it has left state 15 — and kind 0's
 *     handler sees the button still down and puts it back. Held, the player
 *     alternates between the two every engine frame, standing on the idle
 *     and reading no direction;
 *   - when it is UP, dispatches on the weapon (`0x429624`) and, for each of the
 *     five, asks whether the gun's own script is the one installed
 *     (`0x4289c1`). If it is not and you carry it, the gun's script goes in:
 *     it is out. Otherwise the unarmed idle goes in — or the duck `0x4717c8`
 *     with S held (`0x4289ea`) — and it is away.
 *
 * So it is a toggle, decided on the release, and the release has to land on a
 * state-15 frame to do anything: coming up on one of kind 0's frames just leaves
 * the idle standing. A tap is two frames — in, and out on the next — and flips
 * cleanly; a long hold is whichever frame the finger leaves on.
 */
function stepInv(): void {
  if (p.inv15) {
    p.inv15 = false; // either branch installs a script, which sets the kind
    if (held.inv) inv.drawn = false;
    else {
      inv.drawn = inv.armed && !inv.drawn;
      p.invLoop = false;
    }
    return;
  }
  const free =
    p.onGround &&
    !p.act &&
    p.windup === 0 &&
    p.landLeft === 0 &&
    !p.climbing &&
    !p.bar &&
    !p.flail;
  if (!held.inv || !free) {
    p.invLoop = false;
    return;
  }
  // the unarmed walk and run do not answer it with nothing to get out
  if (!inv.drawn && !inv.armed && p.moving && !p.invLoop) return;
  p.inv15 = p.invLoop = true;
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
export function takeGun(): void {
  const lvl = level;
  const g = gunAhead();
  if (!lvl || !g || !p.room) return;
  const i = lvl.rooms.indexOf(p.room);
  if (i >= 0) lvl.guns[i] = lvl.guns[i].filter((q) => q !== g);
  const kind = GUN_CODES[g.code];
  // `0x428868` — the one code that is not a weapon at all: 150 health and the
  // player's own sound 0xa, for the thing a dying class drops
  if (g.code === 2) {
    // `0x43aff0` — the callback walks the can list for one lying at the
    // pickup's own point and puts its state to 2, which is the one case of
    // `0x43af00` that answers 1. Without this the can stays on the floor and
    // the health is free every time you press S at it.
    // ...and exactly ONE: `0x43aff0` walks the list until the first can whose
    // point matches and stops there, so two that came to rest on the same
    // pixel are two pickups and two takings.
    const mine = cans.findIndex(
      (c) => c.rest !== undefined && c.x === g.x && c.y === g.y,
    );
    if (mine >= 0) cans.splice(mine, 1);
    stats.health = Math.min(stats.maxHealth, stats.health + 150);
    // at the player's point — 0xa for character 0 (`0x428893`), 8 for
    // character 1 (`0x443319`), both through `0x40ef30`
    sound?.own(CHARACTER === 1 ? 8 : 0xa, p.x, p.y);
    inv.drawn = false; // `0x42887c` ends on the unarmed idle too
    return;
  }
  // every case but the five guns ends on `0x471648` (`0x42884d`), and that is
  // the unarmed idle: a refill taken with the gun out leaves your fists out
  if (!kind.arms) inv.drawn = false;
  if (kind.weapon === null) return;
  // the callback: the weapon, then the rounds, clamped
  inv.weapon = kind.weapon;
  loadRounds(kind.weapon, kind.rounds);
  // ...and `0x45eed0`, which is the only thing that arms you — plus its own
  // single round, which is what makes a bare `statflaregun` worth taking
  if (kind.arms) {
    inv.armed = true;
    // ...and the case installs the gun's own script (`0x4288b7`), so it is out
    inv.drawn = true;
    loadRounds(kind.weapon, 1);
  }
}

/**
 * Fire — `0x42cd53`, which waits for the wind-up's last frame and then calls
 * the weapon's own function through `0x4a7f10 + id * 12 + 8`.
 *
 * All five are here now: the flare gun's arc ({@link FLARE}), the blaster's bolt
 * ({@link BOLT}), and the three held streams ({@link STREAMS}). `0x436d43`
 * refuses outright with an empty magazine, so an armed player with no rounds
 * plays the wind-up and nothing comes out — which is the original's behaviour
 * and not an omission, and is exactly what RAVECAVE's scepter does: taking it
 * arms you with the one round `0x45eed0` gives and the weapon spends forty.
 */
export function fireGun(): void {
  if (STREAMS[inv.weapon]) return openStream();
  if (inv.weapon === 6) return fireBolt();
  if (inv.weapon !== 9 || roundsIn(9) <= 0) return;
  inv.rounds[9] = roundsIn(9) - 1;
  sound?.effect(FLARE.sound, p.x, p.y);
  flares.push({
    x: p.x + p.facing * FLARE.aheadPx,
    y: p.y - p.feet,
    // the script's dx is an impulse through the object's own divisor, and
    // nothing in the air takes it back again
    vx: roundAway((p.facing * FLARE.dx) / FLARE.divisor),
    vy: 0,
    facing: p.facing,
    // `0x434540(0x11) + 0xd` — see {@link FLARE.wobble}
    wobble: FLARE.wobble.lo - 1 + roll(FLARE.wobble.hi - FLARE.wobble.lo + 1),
    sign: -1,
    burn: null,
    age: 0,
    grounded: false,
    spent: false,
  });
}

/**
 * Open a held stream — the flamer, the soaker or the scepter.
 *
 * One at a time: the fire functions add to a list the player already owns, and
 * the state machine sends `-2` before it sends a fresh variant (`0x42ba49` then
 * `0x42ba7b`), so a second call replaces rather than doubles.
 */
export function openStream(): void {
  const kit = STREAMS[inv.weapon];
  if (!kit || roundsIn(inv.weapon) <= 0) return;
  if (streams.some((q) => q.state !== "stop")) return;
  const own = streamOwn(kit);
  if (own !== undefined) sound?.own(own, p.x, p.y);
  if (kit.sound.effect !== undefined) sound?.effect(kit.sound.effect, p.x, p.y);
  // `0x45ef00` in the fire function itself, for the one that is a shot
  if (kit.shot)
    inv.rounds[inv.weapon] = Math.max(0, roundsIn(inv.weapon) - kit.shot.rounds);
  streams.push({
    weapon: inv.weapon,
    x: p.x,
    y: p.y,
    facing: p.facing,
    state: "start",
    clock: 0,
  });
}

/** the character's own sound a stream starts with — {@link StreamKit.sound} */
function streamOwn(kit: StreamKit): number | undefined {
  return CHARACTER === 1 ? (kit.sound.own1 ?? kit.sound.own) : kit.sound.own;
}

/**
 * `-2`: every live one goes to its tag 2, the animation of shutting off — and
 * the state that sent it silences the weapon's own sound (`0x40eee0`, see
 * {@link StreamKit.sound})
 */
export function shutStreams(): void {
  for (const q of streams)
    if (q.state !== "stop") {
      q.state = "stop";
      q.clock = 0;
      const own = STREAMS[q.weapon] && streamOwn(STREAMS[q.weapon]);
      if (own !== undefined) sound?.mute(own, true);
    }
}

/**
 * `-1`: `0x448c19`'s cancel — the stream simply stops existing, and a flamer
 * cancelled so is silenced with it (`0x42e727`, `0x448c37`)
 */
export function killStreams(): void {
  for (const q of streams) {
    const own = q.weapon === 10 && STREAMS[10] ? streamOwn(STREAMS[10]) : undefined;
    if (own !== undefined) sound?.mute(own, true);
  }
  streams = [];
}

/**
 * The streams, one engine frame at a time.
 *
 * They hang off the player rather than travelling: the fire function files a
 * `(dx, dy)` for the pose and the object is redrawn there every frame, which is
 * why walking while you fire sweeps the flame across a room. Rounds come off
 * once a frame (`0x45ef00`), and the blow is whatever {@link STREAMS} says —
 * a hundred for two of them and the code -9 for the flame, which nothing in
 * these levels reads.
 */
export function stepStreams(): void {
  const lvl = level;
  if (!lvl) return;
  const i = lvl.rooms.indexOf(p.room!);
  const pool = i >= 0 ? lvl.spawned[i] : [];
  for (const q of streams) {
    const kit = STREAMS[q.weapon];
    if (!kit) continue;
    q.clock += 1;
    /**
     * `0x421700` plants it fresh every frame, and the formula is the whole of
     * how a stream behaves:
     *
     * ```
     *   42170a  if (player mirrored)  x = player.x - user[+4]
     *   42171e  else                  x = player.x + user[+4]
     *   42172f  x += player.vx        ; ...and it leads the player's own motion
     *   42173b  y = user[+2] + player.y + player.vy
     * ```
     *
     * So it is not fired and forgotten, it is redrawn where you are — which is
     * why walking while you hold the button sweeps it across a room.
     */
    const at = kit.at[q.variant ?? kit.standing] ?? kit.at[0];
    // `0x42466c` — a variant that sets `user+8` is drawn turned round
    q.facing = q.flip ? -p.facing : p.facing;
    q.x = p.x + p.facing * at.dx + p.vx;
    q.y = p.y - p.feet + at.dy + p.vyRaw;
    if (
      q.state === "start" &&
      q.clock >= kit.start.cels.length * kit.start.hold
    ) {
      // `0x424699` — a shot is freed the frame its script ends
      if (kit.shot) {
        q.state = "stop";
        q.clock = kit.stop.cels.length * kit.stop.hold;
        continue;
      }
      // `0x4217a5` — the start animation ending is what installs the loop
      q.state = "loop";
      q.clock = 0;
    }
    if (q.state === "stop") continue;
    // `0x45ef00(1)` or the scepter's forty, and an empty gauge shuts it off
    inv.rounds[q.weapon] = Math.max(0, roundsIn(q.weapon) - kit.perFrame);
    // ...but a lightning's discharge (`0x41f7e2`) asks the gauge nothing
    if (roundsIn(q.weapon) <= 0 && q.variant === undefined) {
      q.state = "stop";
      q.clock = 0;
      continue;
    }
    /**
     * ...and what it touches.
     *
     * A strength below 1 is not damage — but −9 is not damage either, it is a
     * CODE, and `0x453b9b` is where the flamer's flame gets it. This page read
     * "below 1" as "harmless" and so the flamethrower crossed sixteen levels
     * touching nothing at all. What it actually does is set things on fire:
     * see {@link Foe.burns}, and `0x44ff20` is the half all eight readers
     * share.
     *
     * A code needs no blow pair on the cel, because none of the arithmetic
     * runs — which matters, since the flame's own cels carry one anyway.
     */
    const burns = kit.blow === BURN_CODE;
    if (kit.blow < 1 && !burns) continue;
    const cel = celRec(lvl.sbk, streamCel(q));
    const box = streamBox(q, cel);
    if (!box || (!cel?.blow && !burns)) continue;
    for (const e of pool) {
      if (!takesBlows(e)) continue;
      const c = celRec(lvl.sbk, celOf(e));
      if (!c) continue;
      const hurt = hurtBox(e, c, lvl);
      if (!(
        box.right > hurt.left &&
        box.left < hurt.right &&
        box.bottom > hurt.top &&
        box.top < hurt.bottom
      ))
        continue;
      // `0x42f910`: the cel's OWN pair scaled by the object's strength, and the
      // magnitude of that is the damage. It is small on purpose — the soaker's
      // 9806 carries `dx 8`, so a stream is eight a frame rather than a blow,
      // and a two-hundred-health zombie takes about twenty-five frames of it.
      if (burns) {
        strikeFoe(e, 0, { dx: 0, dy: 0 }, q.facing, (box.top + box.bottom) / 2, hurt, BURN_CODE, undefined, { mass: 0, vx: 0, vy: 0, by: {} });
        continue;
      }
      const scale = kit.blow / 100;
      const bx = cel!.blow!.dx * scale;
      const by = cel!.blow!.dy * scale;
      strikeFoe(
        e,
        Math.sqrt(bx * bx + by * by),
        { dx: bx, dy: by },
        q.facing,
        (box.top + box.bottom) / 2,
        hurt,
        0,
        undefined,
        // the stream class leaves `obj+0xe` at the allocator's nothing
        // (`0x424534`), so it trades no momentum with what it wets
        { mass: 0, vx: 0, vy: 0, by: {} },
      );
    }
    /**
     * ...and what it does to a CAST, which is where the −9 stops being a
     * creature's business.
     *
     * `0x430367` walks every object in the room, not every creature, and hands
     * each one its own `obj+0x12`. The flame's box against a thing in the air
     * is the same test as against a thing on its feet, and what reads the code
     * at the far end of it is {@link CastKit.onCode} — `0x455763`, the boss's
     * fireball, and `0x452fcc` in `0x452f80`, MOLITOV's shot, which lights a
     * flame on it and bursts it.
     *
     * Only a code: the stream's other two are ordinary damage. (`0x452f80`
     * also bursts on a blow of exactly `0x65`, a shot's own burst; that is
     * {@link chainCasts}.)
     */
    if (burns)
      for (const c of casts) {
        if (c.spent || !c.kit.onCode) continue;
        const art = celRec(lvl.sbk, castCel(c));
        if (!art) continue;
        const hurt = castHurtBox(c, art);
        if (!(
          box.right > hurt.left &&
          box.left < hurt.right &&
          box.bottom > hurt.top &&
          box.top < hurt.bottom
        ))
          continue;
        strikeCast(c, BURN_CODE);
      }
    /**
     * ...and a CROW, whose `0x4520d8` was the last reader of the code to be
     * found — see `CROW.burns` in {@link file://./props.ts} for why it took the
     * class descriptor to name it.
     *
     * It is not in `pool` and it is not a `Foe`, so it needs its own pass, the
     * same shape as `landHits`'s: a crow's hurt box is its CURRENT cel about its
     * own point. `0x4520d0`'s first arm is `0x44ff20(self, 3, 0)` — a flame put
     * straight on its going-out stage — and `0x476e58`, the crow's own sixth
     * state, and then it answers 1, so there is no damage and no feathers.
     *
     * The flamer is CITY's own weapon and CITY is the level that perches twelve
     * of these, which is the whole reason this arm exists.
     */
    if (burns)
      for (const c of i >= 0 ? lvl.crows[i]! : []) {
        // its body box, the way `landHits` takes it — the tumble has none
        const art = celRec(lvl.sbk, crowCel(c));
        if (!art?.body) continue;
        const hurt = {
          left: c.x + art.body.x0,
          right: c.x + art.body.x1,
          top: c.y + art.body.y0,
          bottom: c.y + art.body.y1,
        };
        if (!(
          box.right > hurt.left &&
          box.left < hurt.right &&
          box.bottom > hurt.top &&
          box.top < hurt.bottom
        ))
          continue;
        // woods 17 is the fall's own sound and `0x451e5a` plays it under the
        // state, so it goes with entering it rather than with the blow
        if (c.state !== "fall") sound?.effect(CROW.sound.fall, c.x, c.y);
        lightFlame(c, art, false, CROW.burns);
        burnCrow(c);
      }
  }
  streams = streams.filter(
    (q) =>
      !(
        q.state === "stop" &&
        q.clock >=
          STREAMS[q.weapon]!.stop.cels.length * STREAMS[q.weapon]!.stop.hold
      ),
  );
}

/**
 * A stream's reach: its current cel's own STRIKE box, about the ANCHOR.
 *
 * The long cels are why this has to be the authored rect rather than the art —
 * the soaker's 9806 is 243 wide and its box is `x 8..200`, so the spray stops
 * short of its own pixels at both ends, and the flame's 9508 reaches `x 5..254`
 * of 255. And it is about the anchor, the way `hurtBox` does it and `0x4026d0`
 * mirrors: reflecting about the cel's centre instead puts a stream fired west
 * half a screen from where it is drawn.
 */
export function streamBox(
  q: Stream,
  cel: SbkCel | undefined,
): { top: number; left: number; bottom: number; right: number } | null {
  if (!cel?.strike) return null;
  const b =
    q.facing < 0
      ? { ...cel.strike, x0: -cel.strike.x1, x1: -cel.strike.x0 }
      : cel.strike;
  return {
    left: q.x + b.x0,
    right: q.x + b.x1,
    top: q.y + b.y0,
    bottom: q.y + b.y1,
  };
}

/**
 * The thing in the water — `0x43ec80`, one engine frame at a time.
 *
 * ```
 *   43ecf3  |player.x - bush.x| <  0x46    ; seventy across
 *   43ed0c  |player.y - bush.y| < 0x12c    ; three hundred down
 *   43ed28  0x45d090(bush, 0x472c20, 0)    ; ...and up it comes
 *   43eea3  [esi+8] = player.x             ; sliding under you as it rises
 *   43ef4a  y += 0xa                       ; and ten a frame back down after
 *   43f017  x held inside the record's rect, after every move
 * ```
 *
 * Its blow is the grab code -3 (`0x43ee9d`) and it carries the grip on the last
 * seven of its thirteen cels, so the first six are it breaking the water and
 * the rest are it closing. With nobody near it peeks (`0x43ed41`), and a
 * `param` 1 record's partner lashes (`0x43ed9b`). See {@link BUSH}.
 */
export function stepBushes(): void {
  // `0x43ef7c`/`0x43efbc`: six a frame toward the player's x
  const chase = (q: Bush): void => {
    q.x += p.x > q.x ? BUSH.peek.chasePx : -BUSH.peek.chasePx;
  };
  // `0x43f017`: the rect's x extent holds it, whichever arm moved it
  const hold = (q: Bush): void => {
    q.x = Math.max(q.left, Math.min(q.right, q.x));
  };
  const rise = (q: Bush): void => {
    q.state = "rise";
    q.phase = 0;
    q.clock = 0;
    // `0x43ed1e` and `0x43f071` — both through `0x40f090`, the mixer's channel 0
    sound?.effect(BUSH.sound, q.x, q.y, "lead");
  };
  const idle = (q: Bush): void => {
    q.state = "idle";
    q.clock = 0;
  };
  // the player can be taken: `0x402f00` (not held, down or spawning) and
  // `0x402f60` (alive)
  const free = (): boolean => p.act !== "dying" && !p.heldBy && p.act !== "held";
  for (const q of hereOf((l) => l.bushes)) {
    q.clock += 1;
    if (q.variant === 1) {
      const b = q.partner!;
      if (q.state === "lash") {
        // `0x43f10e`: ten above the bush, and at its end the bush goes down
        q.x = b.x;
        q.y = b.y - BUSH.lash.above;
        if (q.clock >= BUSH.lash.cels.length * BUSH.lash.hold) {
          // `0x43f136` sends it whatever the bush is doing
          idle(q);
          b.state = "liftDown";
          b.clock = 0;
        }
        continue;
      }
      // `0x43edb0`: it sits on the bush, turned toward you (`0x43eda4`)
      q.x = b.x;
      q.y = b.y;
      if ((p.x < q.x) !== q.mirror && p.x !== q.x) q.mirror = !q.mirror;
      if (
        Math.abs(p.x - q.x) < BUSH.lash.nearPx &&
        b.state === "idle" &&
        q.wait-- < 0 &&
        free()
      ) {
        q.wait = roll(40) + 10;
        sound?.effect(BUSH.lash.sound, q.x, q.y);
        q.state = "lash";
        q.clock = 0;
        b.state = "liftUp";
        b.clock = 0;
      }
      continue;
    }
    if (q.state === "idle") {
      if (
        Math.abs(p.x - q.x) >= BUSH.nearPx ||
        Math.abs(p.y - q.y) >= BUSH.dropPx
      ) {
        // `0x43ed41`: the wait is tested BEFORE it is counted down
        if (q.wait-- < 0) {
          sound?.effect(BUSH.homeSound, q.x, q.y);
          q.wait = roll(40) + 10;
          q.y = q.top + BUSH.peekDy;
          q.state = "peekUp";
          q.clock = 0;
        }
        continue;
      }
      rise(q);
      continue;
    }
    if (q.state === "peekUp" || q.state === "peekDown") {
      chase(q);
      if (q.state === "peekUp") {
        if (q.top < q.y) q.y -= BUSH.peek.stepPx;
        if (q.clock >= BUSH.peek.up.cels.length * BUSH.peek.up.hold) {
          q.state = "peekDown";
          q.clock = 0;
        }
      } else if (q.top + BUSH.peekDy >= q.y) q.y += BUSH.peek.stepPx;
      else {
        q.y = q.restY;
        idle(q);
      }
      hold(q);
      continue;
    }
    if (q.state === "liftUp" || q.state === "liftDown") {
      // `0x43f04d`: close enough and the lifted bush grabs the ordinary way
      if (Math.abs(p.x - q.x) < BUSH.lift.grabPx) {
        rise(q);
        continue;
      }
      if (q.state === "liftUp") {
        if (q.top < q.y) q.y -= BUSH.lift.stepPx;
      } else if (q.top + BUSH.below >= q.y) q.y += BUSH.lift.stepPx;
      else idle(q);
      continue;
    }
    // the grab's latch runs on both arms of `0x43ef31`, rising and sinking:
    // `0x43eea3` — it slides under you while it is still reaching; `0x43eeb0`
    // moves the latch on the frame after the grab has taken, `0x43eee1` again
    // once the cel that closes is up; and `0x43ef00`, with the latch closed,
    // asks every frame whether he is dead: dead, it takes the draw gate
    // (`0x43ef0a`) — it has swallowed him, and its cels are all that is drawn —
    // and plays 0x2a; alive, it hands the gate back (`0x43ef28`)
    if (q.phase === 0) q.x = p.x;
    if (q.phase === 0 && p.heldWhat === q) q.phase = 1;
    else if (q.phase === 1 && bushCel(q) >= BUSH.holdsAt) q.phase = 2;
    else if (q.phase === 2) {
      p.hidden = p.act === "dying";
      if (p.hidden) sound?.effect(BUSH.sinkSound, q.x, q.y);
    }
    if (q.state === "rise") {
      // `0x43ef65` — forty a frame up for as long as the top of its travel is
      // above it, so a rise that starts off the forty-pixel grid overshoots
      if (q.top < q.y) q.y -= BUSH.risePerFrame;
      // the script is thirteen cels at one tick each, and when it runs out
      // `obj+0x46` is set: from that frame `0x43ef31` takes the OTHER arm
      if (q.clock >= BUSH.rise.cels.length * BUSH.rise.hold) {
        q.state = "sink";
        q.clock = 0;
      }
      hold(q);
      continue;
    }
    // `0x43ef4a`: ten a frame back down while the bottom of its travel is not
    // above it — WITH you, if it has you, because `0x42857d` re-reads the grip
    // every frame and plants you at it. Nothing here asks whether it still has
    // hold of anybody.
    if (q.top + BUSH.below >= q.y) q.y += BUSH.sinkPerFrame;
    else {
      // `0x43ef57` → `0x43f007` installs `0x472b70`, whose cels carry no strike
      // box — which is what lets go of the player, and the only thing that
      // does. It stays where the last step left it, and hands the draw gate
      // back (`0x43ef57`) — a player it swallowed is drawn again, dead.
      p.hidden = false;
      q.phase = 0;
      idle(q);
    }
    hold(q);
  }
}

/** which cel a bush is showing */
export function bushCel(q: Bush): number {
  const at = (a: { cels: readonly number[]; hold: number }): number =>
    a.cels[Math.min(a.cels.length - 1, Math.floor(q.clock / a.hold))];
  switch (q.state) {
    case "idle":
      return BUSH.idle.cels[
        Math.floor(q.clock / BUSH.idle.hold) % BUSH.idle.cels.length
      ];
    // sinking is the script having ENDED — `0x43ef31` tests `obj+0x46` and moves
    // the object without installing anything, so it keeps showing its last
    // frame, grip and all, the whole way back down
    case "sink":
      return BUSH.rise.cels[BUSH.rise.cels.length - 1];
    case "peekUp":
      return at(BUSH.peek.up);
    case "peekDown":
      return at(BUSH.peek.down);
    case "liftUp":
      return BUSH.lift.up;
    case "liftDown":
      return BUSH.lift.down;
    case "lash":
      return at(BUSH.lash);
    default:
      return at(BUSH.rise);
  }
}
/** which cel a stream is showing */
export function streamCel(q: Stream): number {
  const kit = STREAMS[q.weapon]!;
  const a =
    q.state === "start" ? kit.start : q.state === "loop" ? kit.loop : kit.stop;
  const k = Math.floor(q.clock / a.hold);
  return q.state === "loop"
    ? a.cels[k % a.cels.length]
    : a.cels[Math.min(a.cels.length - 1, k)];
}

/**
 * The BLASTER — `0x412a70`'s `0x412b5b`, which is the case both of its firing
 * tags land on. See {@link BOLT}.
 */
export function fireBolt(): void {
  if (roundsIn(6) <= 0) return;
  inv.rounds[6] = roundsIn(6) - 1;
  sound?.effect(BOLT.sound, p.x, p.y);
  spawnBolt(p.x, p.y - p.feet, p.facing);
}

/**
 * `0x412a70` itself — a bolt from whoever fired it.
 *
 * The player is not the only caller: MAZE's big gun reaches the same function
 * (`0x41374c`) with variant 0, which is a shot of its own — {@link GUNBOLT}.
 * What the gun does NOT do is spend a round, because the rounds are
 * `0x412a83`'s caller's business and the gun has none.
 */
export function spawnBolt(
  x: number,
  y: number,
  facing: number,
  // the variant's strength — see {@link Bolt.code}: the player's −1, the gun's 100
  code: Bolt["code"] = BOLT.blow,
): void {
  // the gun's variant 0 is a shot of its own — {@link GUNBOLT}
  if (code === 100) {
    bolts.push({
      x: x + facing * GUNBOLT.aheadPx,
      y,
      vx: roundAway((facing * GUNBOLT.dx) / BOLT.divisor),
      facing,
      spent: false,
      code,
      age: 0,
    });
    return;
  }
  bolts.push({
    // `0x412b7f` puts it 120 ahead; `obj+0x28 == 1` is this port's facing -1
    x: x + facing * BOLT.aheadPx,
    // `y - 0x14 + 0x434540(0x28) - 0x14` — `0x412b87` and `0x412b8f`
    y: y - BOLT.risePx + roll(BOLT.scatterPx),
    vx: roundAway((facing * BOLT.dx) / BOLT.divisor),
    facing,
    spent: false,
    code,
    age: 0,
  });
}

/** the cel a bolt shows this frame — 4000 for the blaster's, {@link GUNBOLT} for the gun's */
export function boltCel(b: Bolt): number {
  if (b.code !== 100) return BOLT.cel;
  return b.age === 0 ? GUNBOLT.launch : GUNBOLT.flight[(b.age - 1) % GUNBOLT.flight.length];
}

/**
 * The bolts, one engine frame at a time — and the point of them is that they
 * mostly do nothing.
 *
 * Their strength is the code -1 (`0x413bf9`), so an ordinary handler throws
 * them away: `0x4199b9` compares the strength with 1 and anything below it is
 * not a blow. The bolt still ENDS on whatever it touched — `obj+0x2a` is set by
 * the collision whether or not the handler did anything with it — which is why
 * this expires on contact and takes no health.
 *
 * Boggs is the exception and the reason the gun exists: `0x41bc71` rewrites the
 * -1 as a hundred.
 */
export function stepBolts(): void {
  const lvl = level;
  if (!lvl) return;
  for (const b of bolts) {
    // the think, before anything moves: `0x413b95`..`0x413baf`, more than a
    // thousand pixels across from the player, lets it go where it stands
    if (Math.abs(b.x - p.x) > BOLT.rangePx) {
      b.spent = true;
      continue;
    }
    // ...and then the move, after the frame's hit pass has tested it where it
    // stood — see {@link boltHits} — and on the record this frame's step shows
    if (b.was) b.age += 1;
    b.was = { x: b.x, y: b.y };
    b.x += b.vx;
  }
  bolts = bolts.filter((b) => !b.spent);
}

/**
 * The bolts' part of the frame's hit pass ({@link hitPass}) — `0x430350` with
 * each bolt as the hitter, at the point it stood as the frame began.
 *
 * Its strike box is its cel's own, 4000's `x −4..2, y −4..2` about the anchor
 * and mirrored with it (`0x40e6a2`), tested once a frame where it is. The bolt
 * crosses a hundred pixels an engine frame, so the six-pixel box samples the
 * world every hundred and goes clean through anything it does not happen to
 * land in: a body whose box is narrower than the gap, standing in the gap, is
 * never struck. That is the engine's, and it is what the blaster is — where
 * you stand to shoot decides what it reaches.
 */
export function boltHits(): void {
  const lvl = level;
  if (!lvl) return;
  const i = lvl.rooms.indexOf(p.room!);
  const pool = i >= 0 ? lvl.spawned[i] : [];
  const span = p.room ? roomSpan(p.room) : null;
  for (const b of bolts) {
    if (b.spent || !b.was) continue;
    const art = celRec(lvl.sbk, boltCel(b));
    const sb = art?.strike ?? { y0: -4, x0: -4, y1: 2, x1: 2 };
    const at = b.was;
    const [x0, x1] = b.facing < 0 ? [-sb.x1, -sb.x0] : [sb.x0, sb.x1];
    const box = { left: at.x + x0, right: at.x + x1, top: at.y + sb.y0, bottom: at.y + sb.y1 };
    const was = at.x;
    /**
     * What it meets first. Boggs' body and a machine can both stand over the
     * point it is tested at; both take the same hundred — `0x41bc71` on the
     * body and `0x41b510` in the machinery's handler translate the `-1`
     * identically — and the nearer along the way it flies is taken.
     */
    const met: { edge: number; take: () => void }[] = [];
    for (const g of hereOf((l) => l.boggs)) {
      const cel = celRec(lvl.sbk, boggsCel(g));
      if (cel?.body) {
        // the cel's BODY box off the anchor, which is what the collision pass
        // tests a victim by (`0x4303b3` reads `cel+0xc`, `0x40e680` translates
        // it) — 5988's is x −151..31, y −36..127, so a bolt at a standing
        // player's knee height passes under the body and meets the machine
        // behind it
        const gb = {
          left: g.x + cel.body.x0,
          right: g.x + cel.body.x1,
          top: g.y + cel.body.y0,
          bottom: g.y + cel.body.y1,
        };
        if (
          box.right > gb.left &&
          box.left < gb.right &&
          box.bottom > gb.top &&
          box.top < gb.bottom
        ) {
          met.push({
            edge: b.vx >= 0 ? Math.max(gb.left, was) : Math.min(gb.right, was),
            take: () => {
              // `0x41bc71` -> 100, then `0x42f910` the usual way
              g.hp = Math.max(0, g.hp - BOGGS.translatesTo);
              sound?.effect(BOLT.sound, g.x, g.y);
              boggsStruck(g, true);
            },
          });
        }
      }
      for (let k = 0; k < g.machines.length; k++) {
        const mb = machineBox(g, k);
        if (!mb) continue;
        if (!(
          box.right > mb.left &&
          box.left < mb.right &&
          box.bottom > mb.top &&
          box.top < mb.bottom
        ))
          continue;
        met.push({
          // clamped to where the bolt STARTED this step: it materialises 120px
          // ahead of the muzzle and can be inside several boxes already, and a
          // leading edge behind it is not the thing it met first
          edge: b.vx >= 0 ? Math.max(mb.left, was) : Math.min(mb.right, was),
          take: () => {
            strikeMachine(g, k, BOGGS.translatesTo, true);
            sound?.effect(BOLT.sound, g.machines[k].x, g.machines[k].y);
          },
        });
      }
    }
    let hit = false;
    if (met.length) {
      met.sort((l, r) => (b.vx >= 0 ? l.edge - r.edge : r.edge - l.edge));
      met[0].take();
      hit = true;
    }
    if (hit) {
      b.spent = true;
      continue;
    }
    // ...and only now the room's own end — the page's, not the disc's — and
    // on the point it was tested at, because culling first would throw that
    // test away: the machine at x6694 stands past the end of chamber2's floor
    if (span && (was < span.lo || was > span.hi)) {
      b.spent = true;
      continue;
    }
    /**
     * ...and the creatures, which a bolt does NOT simply stop on.
     *
     * The hit pass `0x430350` hands the bolt to each body's handler in turn,
     * and what happens next is the handler's ANSWER and the bolt's strength
     * AFTER it:
     *
     * - an answer of 0 (`0x43042b`) moves on to the next body — nothing is
     *   exchanged, nothing marks the bolt, and it flies on. Every handler that
     *   turns a negative strength away answers 0 to the blaster's −1, and so
     *   does puke's, after its sound (`0x418278`): the bolt goes THROUGH them;
     * - an answer of 1 with a strength over 0 runs `0x430470`, which sets the
     *   bolt's `obj+0x2a` (`0x430663`), and the bolt's think lets it go on its
     *   next frame (`0x413b56`). A handler of {@link Foe.minusOne} `as` writes
     *   the 100 onto the BOLT before it answers (`0x4147e0`, `0x418b4e`,
     *   `0x4199a0`), which is what lets its 1 stop it;
     * - and a handler that rewrites and then answers 0 — an arm that has hold
     *   of you (`0x418b58`) — leaves a hundred-strength bolt going on to the
     *   next body in the same pass. The think puts the −1 back next frame
     *   (`0x413bf9`, from the variant, every frame).
     *
     * A cel with no body box is not there to a bolt either (`0x4303b3`): a
     * flinching TCop, the tube on its stand.
     */
    let str: number = b.code;
    for (const e of pool) {
      if (!takesBlows(e)) continue;
      const c = celRec(lvl.sbk, celOf(e));
      if (!c?.body) continue;
      const hurt = hurtBox(e, c, lvl);
      if (!(
        box.right > hurt.left &&
        box.left < hurt.right &&
        box.bottom > hurt.top &&
        box.top < hurt.bottom
      ))
        continue;
      const foe = FOES[e.kind];
      if (str === -1) {
        const minus = foe.minusOne;
        if (!minus) continue;
        if ("sound" in minus) {
          // puke's `0x41825e` answers it through `0x40f090` (`0x418273`)
          sound?.effect(minus.sound, b.x, b.y, "lead");
          continue;
        }
        str = minus.as;
      } else if (b.code === 100 && e.kind === "initcop") {
        // the big gun's bolt is the bolt class `[0x46c600]` below tag 2,
        // which the TCop turns away (`0x41482a`) — an answer of 0
        continue;
      } else if (b.code === 100 && !foesHurt) {
        // ...and to anything else it is a blow of a hundred, which lands
        // under the creature switch like every other blow a machine throws;
        // without it the bolt stops there and takes nothing
        b.spent = true;
        break;
      }
      // `0x42f910` at the strength it now has: 4000's own pair, scaled and
      // mirrored, plus `obj+0xc` — the bolt's hundred a frame, which is what
      // {@link Bolt.vx} already holds, a step being one engine frame — and the
      // integer root of the sum of squares (`0x434630`)
      const pair = art?.blow ?? { dx: 0, dy: 0 };
      const facing = b.vx < 0 ? -1 : 1;
      const vx = b.vx;
      const dx = Math.trunc((pair.dx * str) / 100) * facing + vx;
      const dy = Math.trunc((pair.dy * str) / 100);
      // a taken blow is a counted one; a gate that turned it away left the
      // count where it was — the handler's 1 or 0
      const dents = e.dents;
      strikeFoe(
        e,
        Math.floor(Math.hypot(dx, dy)),
        pair,
        facing,
        at.y,
        hurt,
        0,
        { x: at.x, y: at.y },
        { mass: BOLT.divisor, vx, vy: 0, by: {} },
      );
      if (e.dents !== dents) {
        b.spent = true;
        break;
      }
    }
  }
  bolts = bolts.filter((b) => !b.spent);
}

/**
 * The flares, one engine frame at a time.
 *
 * `0x43abf0`'s first block is the corkscrew and it is the whole character of the
 * weapon: the random 14..30 the spawner filed is read down two at a time, and
 * each frame its value is added to — or, from 7 up, simply written into — the
 * flare's vertical velocity, with the sign flipping every frame. So it leaves
 * the barrel thrashing and straightens out after about seven frames.
 *
 * What ends the flight is `0x43acae`: the ground under it (`obj+0x2e`) or
 * something it hit (`obj+0x2a`), either of which installs tag 4, the burn-out
 * — and the same think zeroes its strength once `obj+0x2a` is set
 * (`0x43ac19`), so it hits one thing. The mover keeps it: a burning flare
 * falls, lands and slides to a stop, and tag 5 frees it at rest.
 */
export function stepFlares(): void {
  const lvl = level;
  if (!lvl) return;
  for (const f of flares) {
    f.age += 1;
    if (f.burn !== null) {
      // the think: tag 4 a frame a cel, then tag 5 frees it on the first frame
      // the mover has left it at rest — `obj+0x30`, both velocities zero
      f.burn += 1;
      if (f.burn >= FLARE.burn.length && f.grounded && f.vx === 0) {
        f.spent = true;
        continue;
      }
    }
    if (f.wobble > 0) {
      // `0x43ac50` — and the counter goes straight into `obj+0xa`, with no
      // divisor on it at all. Under 7 it is ADDED and from 7 it is WRITTEN, so
      // the last few frames are a settle rather than a fresh throw.
      const v = f.sign * f.wobble;
      if (f.wobble < FLARE.wobble.settle) f.vy += v;
      else f.vy = v;
      f.sign = -f.sign;
      f.wobble -= FLARE.wobble.step;
    }
    // where it stands for the frame's hit pass, and with what — see
    // {@link flareHits}: the pass comes before this move in the engine's frame
    f.was = { x: f.x, y: f.y, vx: f.vx, vy: f.vy, armed: f.burn === null, cel: f.age <= 1 ? FLARE.muzzle : FLARE.flight };
    // the mover, `0x42fd80`: move, then the floor, then — airborne only —
    // gravity (`0x430322`); on the ground the drag instead (`0x4302c0`)
    const wasY = f.y;
    f.x += f.vx;
    if (!f.grounded) f.y += f.vy;
    // the foot is the cel's own extent below the anchor (`0x42fd80`)
    const art = celRec(lvl.sbk, f.age <= 1 ? FLARE.muzzle : FLARE.flight);
    const ext = art ? art.height - art.posY : 0;
    const land: number | null =
      !f.grounded && f.vy > 0 ? regionFloorUnder(f.x, wasY + ext, f.y + ext) : null;
    if (land !== null) {
      f.y = land - ext;
      f.vy = 0;
      f.grounded = true;
      // `0x43acae`: the ground ends the flight, and next frame's think
      // installs the burn-out
      if (f.burn === null) f.burn = -1;
    }
    if (f.grounded) f.vx = dragged(f.vx);
    // `0x42f850(obj, 0.5)` stores `trunc(0.5 * 10)` — half the player's own
    else f.vy += FLARE.gravity * PLAYER_GRAVITY;
  }
  flares = flares.filter((f) => !f.spent);
}

/**
 * The flares' part of the frame's hit pass ({@link hitPass}) — `0x430350`
 * with each flare as the hitter, at the point it stood as the frame began and
 * on the cel it shows this frame, and only while it still carries its strength
 * (`0x43ac19` zeroes it once it has hit or landed).
 */
export function flareHits(): void {
  const lvl = level;
  if (!lvl) return;
  const i = lvl.rooms.indexOf(p.room!);
  const pool = i >= 0 ? lvl.spawned[i] : [];
  for (const f of flares) {
    const at = f.was;
    if (f.spent || !at || !at.armed || (f.burn !== null && f.burn >= 0)) continue;
    const art = celRec(lvl.sbk, at.cel);
    // ...and anything it reaches: the flight cel's own STRIKE box, about its
    // anchor and mirrored with it (`0x4026d0`), against the body it meets
    const sb = art?.strike ?? { y0: -12, x0: -12, y1: 12, x1: 12 };
    const box = {
      left: at.x + (f.facing < 0 ? -sb.x1 : sb.x0),
      right: at.x + (f.facing < 0 ? -sb.x0 : sb.x1),
      top: at.y + sb.y0,
      bottom: at.y + sb.y1,
    };
    let struck = false;
    for (const e of pool) {
      if (!takesBlows(e)) continue;
      const c = celRec(lvl.sbk, celOf(e));
      if (!c) continue;
      const hurt = hurtBox(e, c, lvl);
      if (!(
        box.right > hurt.left &&
        box.left < hurt.right &&
        box.bottom > hurt.top &&
        box.top < hurt.bottom
      ))
        continue;
      /**
       * ...and on a STAGE 5 a flare is not a hundred at all — it is a −9.
       *
       * `0x43abfa` is the whole rule and it is two instructions: the flare's
       * own think writes `obj+0x1a = 0xfff7` while `[0x4abdfc]` is 5 and
       * `0x64` otherwise. `[0x4abdfc]` is the stage within a chapter — see
       * `SkullSave.stage`, which reads it as 2..5 — so 5 is the FOURTH level
       * of one, and that is levels 4, 8, 12 and 16.
       *
       * ARCADE is level 8. So the one level in the game with sprinklers in it
       * is also one of the four where a flare is a code rather than damage,
       * and that is not a coincidence: `0x441b60`'s only caller is inside
       * kragg's state 9, and the only way into state 9 is `0x441d30`'s −9.
       *
       * It matters for the rest of the level too. A flare on a stage 5 cannot
       * hurt anything that has no −9 handler, and sets alight everything that
       * has: see {@link Foe.burns}.
       */
      if (levelIndex % 4 === 3) {
        strikeFoe(e, 0, { dx: 0, dy: 0 }, f.facing, (box.top + box.bottom) / 2, hurt, BURN_CODE, undefined, { mass: FLARE.divisor, vx: 0, vy: 0, by: {} });
      } else {
        // `0x42f910` at strength 100: the cel's own pair, mirrored by facing,
        // plus the flare's own velocity, and the damage is the length of that —
        // 7207's `dx 8` and forty a frame of flight is about fifty, not a
        // flat hundred
        const pair = art?.blow ?? { dx: 0, dy: 0 };
        const dx = pair.dx + at.vx * f.facing;
        const dy = pair.dy + at.vy;
        strikeFoe(
          e,
          Math.round(Math.hypot(dx, dy)),
          { dx, dy },
          f.facing,
          (box.top + box.bottom) / 2,
          hurt,
          0,
          undefined,
          // the flare's own mass, its divisor of 5 (`0x43ab50`)
          { mass: FLARE.divisor, vx: at.vx * f.facing, vy: at.vy, by: {} },
        );
      }
      f.burn = -1;
      struck = true;
      break;
    }
    /**
     * ...and a cast, on the levels where a flare is a code.
     *
     * The same argument as the stream's own cast pass, and on PLAYGR it is the
     * likelier of the two: level 4 is a fourth level, so `0x43abfa` makes
     * every flare on it a −9, and the boss's fireball is the one thing in the
     * air that reads one. A flare that meets it is spent either way —
     * `0x43acae` installs the burn-out on anything it touches, whatever the
     * thing it touched made of the blow.
     *
     * There is deliberately no crow pass here, unlike the stream's. A crow is
     * CITY's and CITY is level 2, so `levelIndex % 4 === 3` is never true where
     * one stands and a flare there is `0x64`, not a code; and no `statflare` is
     * placed in CITY at all — the chapter's weapon is the flamer (see
     * `CHAPTER_WEAPON` in {@link file://./guns.ts}). The two can never meet.
     */
    if ((f.burn === null || f.burn < 0) && !struck && levelIndex % 4 === 3)
      for (const c of casts) {
        if (c.spent || !c.kit.onCode) continue;
        const art = celRec(lvl.sbk, castCel(c));
        if (!art) continue;
        const hurt = castHurtBox(c, art);
        if (!(
          box.right > hurt.left &&
          box.left < hurt.right &&
          box.bottom > hurt.top &&
          box.top < hurt.bottom
        ))
          continue;
        strikeCast(c, BURN_CODE);
        f.burn = -1;
        break;
      }
  }
}

/**
 * The dropped ones fall — `0x45b060` gives a thrown weapon gravity 1.0 and
 * clears `obj+0x30`, and the handler's think (`0x45ade5`) re-creates it as a
 * standing pickup the frame it lands.
 */
export function stepGuns(): void {
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
export function clockFor(sbk: SbkFile): number {
  const rec = sbk.entities.find((e) => e.name === "timer");
  return rec ? rec.param : CLOCK.noLimit;
}

/** every roach in the air or on the floor, nest or no nest */
export let roaches: Roach[] = [];

/** `0x4423a0(point, n)` — kragg's roaches, see {@link SPILL} */
export function spillRoaches(at: { x: number; y: number }, n: number): void {
  const room = p.room;
  if (!room) return;
  for (let i = 0; i < n; i++) {
    const facing = roll(2) === 1 ? 1 : -1;
    roaches.push({
      x: at.x + roll(SPILL.across),
      y: at.y - roll(SPILL.up),
      // the leap's one frame is spent through the divisor as it goes on
      vy: SPILL.rise[0] - roll(SPILL.rise[1]) + roundAway(SPILL.leap.dy / ROACH.divisor),
      facing,
      onGround: false,
      running: false,
      clock: 0,
      top: room.top,
      left: room.left,
      bottom: room.bottom,
      right: room.right,
      spilled: {
        vx: SPILL.speed[0] + roll(SPILL.speed[1]) + roundAway(SPILL.leap.dx / ROACH.divisor) * facing,
      },
    });
  }
}

/** which of the seven slots has water standing in it, and engine frames since it rose */
export let columns = new Map<number, number>();
/** `0x473728` — every slot that has ever gone up this level; never cleared */
export let raised = new Set<number>();

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
export function raiseSprinkler(e: Enemy): void {
  const all = hereOf((l) => l.sprinklers);
  if (!all.length) return;
  const over = all.find(
    (q) => e.x >= q.left && e.x < q.right && e.y >= q.top && e.y < q.bottom,
  );
  if (!over) return;
  const up = (slot: number): void => {
    raised.add(slot);
    columns.set(slot, 0);
  };
  if (!raised.has(over.slot)) return up(over.slot);
  // `0x441b7a`: it has gone up before, so roll `0x434540(7) - 1` for another
  // slot and try up to seven times
  for (let i = 0; i < SPRINKLER.slots; i++) {
    const slot = roll(SPRINKLER.slots) - 1;
    if (raised.has(slot) || !all.some((q) => q.slot === slot)) continue;
    return up(slot);
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
export function stepColumns(): void {
  const all = hereOf((l) => l.sprinklers);
  /**
   * ...and the boss's own hum, in the same prologue (`0x440b8e`, states 1..9):
   * `0x441b20` finds no sprinkler rect around its point and it arms and plays
   * `0x17` (`0x440c81`..`0x440ca2`), a loop the mixer keeps and each frame
   * moves. Over a sprinkler that is down it asks nothing that frame; over one
   * that is up it is the scald below.
   */
  for (const e of spawnedHere()) {
    const foe = FOES[e.kind];
    if (e.state === "dead" || e.rallied || !foe.drives?.raises || !foe.rallies) continue;
    if (Math.floor(e.clock) === Math.floor(e.clock - TICK_SCALE)) continue;
    if (all.some((q) => e.x >= q.left && e.x < q.right && e.y >= q.top && e.y < q.bottom)) continue;
    sound?.loop(FOE_SFX.kraggFlies, true);
    sound?.effect(FOE_SFX.kraggFlies, e.x, e.y);
  }
  if (!all.length && !columns.size) return;
  const gone: number[] = [];
  for (const [slot, clock] of columns) {
    const next = clock + TICK_SCALE;
    if (next >= SPRINKLER.life + SPRINKLER.sink.cels.length * SPRINKLER.sink.hold)
      gone.push(slot);
    else columns.set(slot, next);
  }
  for (const slot of gone) columns.delete(slot);
  if (!raised.size) return;
  /**
   * ...and three a frame off the boss standing in one — `0x440b99`.
   *
   * Asked in kragg's prologue for states 1..9 only (`0x440b8e`), so in its
   * flinches and the flare's thrash as much as on the wing, and never once it
   * is down: the fall and the ground form are 10 and up, which is
   * {@link Enemy.rallied} here. `0x441b20` names the one rect it is in and
   * `[0x473728 + 4n]` says whether that one is up; if so, two sparks, 0x14, and
   * `0x440bf9` takes three. The frame that takes it BELOW zero (`jns`) is the
   * fall, not a death — {@link rallyFall}, the scald's own way (`0x440c07`).
   */
  for (const e of spawnedHere()) {
    const foe = FOES[e.kind];
    if (e.state === "dead" || e.rallied || !foe.drives?.raises || !foe.rallies)
      continue;
    const lit = [...raised].some((slot) => {
      const q = all.find((w) => w.slot === slot);
      return (
        !!q && e.x >= q.left && e.x < q.right && e.y >= q.top && e.y < q.bottom
      );
    });
    if (!lit) continue;
    if (Math.floor(e.clock) !== Math.floor(e.clock - TICK_SCALE))
      sound?.effect(FOE_SFX.kraggScald, e.x, e.y);
    e.hp -= 3 * TICK_SCALE;
    if (e.hp < 0) rallyFall(e, foe.rallies, true);
  }
}

/** which cel a standing column is showing: rise, spray, and going */
export function columnCel(clock: number): number {
  const up = SPRINKLER.rise.cels.length * SPRINKLER.rise.hold;
  if (clock >= SPRINKLER.life)
    return SPRINKLER.sink.cels[
      Math.min(
        SPRINKLER.sink.cels.length - 1,
        Math.floor((clock - SPRINKLER.life) / SPRINKLER.sink.hold),
      )
    ];
  if (clock < up)
    return SPRINKLER.rise.cels[Math.floor(clock / SPRINKLER.rise.hold)];
  const i =
    Math.floor((clock - up) / SPRINKLER.spray.hold) %
    SPRINKLER.spray.cels.length;
  return SPRINKLER.spray.cels[i];
}

/**
 * Step the six pieces of scenery that do something.
 *
 * Each is one paragraph of its own class's think, and the addresses are in
 * {@link file://./props.ts}. None of them can be hit and none of them is in any
 * level's census; what they are is the difference between a room and a corridor.
 */
export function stepScenery(): void {
  const ay = p.y - p.feet;
  const inRect = (r: {
    top: number;
    left: number;
    bottom: number;
    right: number;
  }): boolean => p.x >= r.left && p.x < r.right && ay >= r.top && ay < r.bottom;

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

  // `0x43fc30` once an engine frame, then the script's impulses, then the mover's
  // share of the frame each tick — see {@link BARREL}
  for (const b of hereOf((l) => l.barrels)) {
    const wasX = b.x;
    const wasY = b.y;
    b.clock += TICK_SCALE;
    if (Math.floor(b.clock) !== Math.floor(b.clock - TICK_SCALE)) barrelFrame(b, ay);
    // the mover (`0x42fd80`): no gravity, no drag, and a floor that rises more
    // than 50 above its foot is a wall — the move is undone, the vertical speed
    // zeroed and the horizontal kept to a quarter (`0x42fef3`), and it has
    // bounced
    const rec = level ? celRec(level.sbk, barrelCel(b)) : undefined;
    const foot = rec ? rec.height - rec.posY : 0;
    const nx = b.x + b.vx * TICK_SCALE;
    const g = groundAt(nx);
    if (g !== null && g + 50 < b.y + foot) {
      b.vy = 0;
      b.vx = Math.trunc(b.vx / 4);
      b.bounced = true;
    } else b.x = nx;
    b.y += b.vy * TICK_SCALE;
    if (b.floor) {
      b.floor.left += b.x - wasX;
      b.floor.right += b.x - wasX;
      b.floor.top += b.y - wasY;
      b.floor.bottom += b.y - wasY;
    }
  }

  for (const q of hereOf((l) => l.pipes)) q.clock += TICK_SCALE;

  // `0x4404c0`: the splash going in, the gulp every ninth frame, and the health
  // — which only leaves when the switch that lets things hit back is on
  for (const w of hereOf((l) => l.sewage)) {
    if (!inRect(w)) {
      w.clock = SEWAGE.gulpEvery;
      continue;
    }
    if (p.vy / TICK_SCALE > SEWAGE.splashAbove)
      sound?.effect(SEWAGE.splash, p.x, p.y);
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
      facing: random() < 0.5 ? 1 : -1,
      onGround: false,
      running: false,
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
    if (r.running) {
      // the run carries `dx 65` on every one of its four cels, and the mover
      // spends it on the ground and off it alike
      const i = loopIndex(ROACH.run, r.clock);
      r.x += ((ROACH.run.dx[i] ?? 0) / ROACH.divisor) * TICK_SCALE * r.facing;
    }
    if (r.onGround) {
      const floor = surfaceUnder(r.x, r.y - CLIMB_PX, r.y + STICK_PX);
      if (floor !== null) {
        r.y = floor;
        continue;
      }
      // off the end of a ramp: the 0.6 gravity `0x43b1be` gave it is the
      // object's own and the mover spends it whenever there is no floor
      r.onGround = false;
    }
    r.vy += PLAYER_GRAVITY * (r.spilled ? SPILL.gravity : ROACH.gravity) * TICK_SCALE;
    r.y += r.vy * TICK_SCALE;
    // a spilled one carries its own speed across until it lands ({@link SPILL})
    if (r.spilled) r.x += r.spilled.vx * TICK_SCALE;
    const floor = surfaceUnder(
      r.x,
      r.y - Math.max(r.vy, 0) - CLIMB_PX,
      r.y + STICK_PX,
    );
    if (floor === null || r.y < floor) continue;
    r.y = floor;
    r.vy = 0;
    r.onGround = true;
    if (r.running) continue;
    // `0x43b17f` waits for the ground before the run starts at all: tag 0 of
    // `0x474db0`, which plays the run sound as it starts
    r.running = true;
    r.clock = 0;
    // ...where a spilled one lands out of tag 2 and starts it silently
    // (`0x43b35c`), and the run's own stride takes over from its speed
    if (r.spilled) r.spilled.vx = 0;
    else sound?.effect(ROACH.runSound, r.x, r.y);
  }
  // `0x43b1e8`: it removes itself the frame its own point leaves the rect
  roaches = roaches.filter(
    (r) =>
      r.x >= r.left &&
      r.x <= r.right &&
      r.y >= r.top - 200 &&
      r.y <= r.bottom + 200,
  );
}

/** the script a barrel is on, as {@link BARREL} names them */
export function barrelScript(b: Barrel): (typeof BARREL)["bob" | "wobble" | "sink"] {
  return b.tag === "wobble" ? BARREL.wobble : b.tag === "sink" ? BARREL.sink : BARREL.bob;
}

/** which cel a barrel is showing — its class's own 3180 while its delay runs */
export function barrelCel(b: Barrel): number {
  if (b.tag === "none") return BARREL.bob.cels[0];
  const s = barrelScript(b);
  return s.cels[Math.min(s.cels.length - 1, Math.floor(b.aclock / s.hold))];
}

/** start one of a barrel's scripts (`0x45d090`) */
export function barrelInstall(b: Barrel, tag: "bob" | "wobble" | "sink"): void {
  b.tag = tag;
  b.aclock = 0;
}

/**
 * One engine frame of a barrel: `0x43fc30`, and then what the animation stepper
 * adds (`0x45d0f0` → `0x42f8b0`: the shown cel's dx, flipped by `obj+0x28`, and
 * dy, each over the divisor of 10 and rounded away from zero).
 */
export function barrelFrame(b: Barrel, ay: number): void {
  const think = (): void => {
    // `0x43fc39`: the delay, with no script at all
    if (b.wait > 0) {
      b.wait -= 1;
      if (b.wait === 0) {
        barrelInstall(b, "bob");
        b.wait = BARREL.rest;
      }
      return;
    }
    if (b.bounced) b.mirror = !b.mirror;
    b.vx = Math.max(-BARREL.drift, Math.min(BARREL.drift, b.vx));
    if (b.y < b.top) b.y = b.top + BARREL.inset;
    else if (b.bottom < b.y) b.y = b.bottom - BARREL.inset;
    // `0x43fcce`: the record's rect, carried by how far the barrel is from its point
    const ox = b.x - b.homeX;
    const on =
      p.x < b.right + ox &&
      p.x > b.left + ox &&
      b.y - ay < BARREL.reach &&
      b.y - ay > 0;
    const s = barrelScript(b);
    const ended = b.aclock >= s.cels.length * s.hold;
    if (b.tag === "bob") {
      if (on && b.sinker) {
        const was = b.wait;
        b.wait += 1;
        if (was >= BARREL.wobbleAt) {
          b.vy = 0;
          barrelInstall(b, "wobble");
          return;
        }
      }
      if (ended) barrelInstall(b, "bob");
    } else if (b.tag === "sink") {
      // `0x43fd99`: down and along, whatever the mover does
      b.y += BARREL.sinkStep;
      b.x += b.mirror ? -BARREL.sinkStep : BARREL.sinkStep;
      if (ended) {
        b.y = b.homeY;
        barrelInstall(b, "bob");
      }
    } else if (b.tag === "wobble") {
      if (on) {
        const was = b.wait;
        b.wait += 1;
        if (was >= BARREL.sinkAt) {
          b.wait = BARREL.rest;
          b.vy = 0;
          barrelInstall(b, "sink");
          return;
        }
      }
      if (ended) barrelInstall(b, "wobble");
    }
  };
  think();
  b.bounced = false;
  if (b.tag === "none") return;
  const s = barrelScript(b);
  const i = Math.min(s.cels.length - 1, Math.floor(b.aclock / s.hold));
  const dx = s.dx[i] ?? 0;
  const dy = s.dy[i] ?? 0;
  if (dx) b.vx += roundAway(dx / BARREL.divisor) * (b.mirror ? -1 : 1);
  if (dy) b.vy += roundAway(dy / BARREL.divisor);
  b.aclock += 1;
}

/** the doors in the room the player is in */
export function doorsHere(): Door[] {
  const i = level && p.room ? level.rooms.indexOf(p.room) : -1;
  return level && i >= 0 ? level.doors[i] : [];
}

/** the lifts in the room the player is in */
export function elevsHere(): Elev[] {
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
export function blockers(): {
  top: number;
  left: number;
  bottom: number;
  right: number;
}[] {
  const out: { top: number; left: number; bottom: number; right: number }[] = [
    ...solids().obstacles,
  ];
  for (const d of doorsHere()) if (d.state !== "open") out.push(d);
  // `0x411460` is what a cage door does as it shuts: it appends its own rect to
  // the level's obstacle table, so it stops being a door and starts being wall
  for (const c of hereOf((l) => l.cages))
    if (c.state === "shut" || c.state === "closing") out.push(c);
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
export function stepDoors(): void {
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
export function stepElevs(): void {
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
      // `0x42f8b0`: the impulse is divided — 4 a frame, spread over its four
      // ticks — and the result never exceeds the cap
      e.vy = Math.min(
        ELEV.downCap,
        e.vy + roundAway(ELEV.push / ELEV.divisor) * TICK_SCALE,
      );
      e.y += e.vy * TICK_SCALE;
      if (e.y >= e.bottom) {
        e.y = e.bottom;
        e.vy = 0;
        e.state = "atBottom";
        e.clock = 0;
      }
    } else {
      const cap = ELEV.upCap[e.param] ?? ELEV.upCap[0];
      e.vy = Math.max(
        -cap,
        e.vy - roundAway(ELEV.push / ELEV.divisor) * TICK_SCALE,
      );
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
export function leverFor(e: Enemy, dir: 0 | 1): Switch | null {
  const want = dir === 0 ? "off" : "on";
  for (const s of switchesHere()) {
    if (s.state !== want) continue;
    if (s.x < e.left || s.x > e.right || s.y < e.top || s.y > e.bottom)
      continue;
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
export function broadcast(param: number): void {
  const lvl = level;
  if (!lvl) return;
  if (param >= 500) {
    for (const n of lvl.nests.flat()) {
      if (n.param !== param) continue;
      n.on = !n.on;
      // `0x43c3f8` — through `0x40f090`, the mixer's channel 0, so of a
      // broadcast that reaches several only the last is heard
      sound?.effect(SWITCH.toggle, (n.left + n.right) / 2, n.top, "lead");
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
  // — chapter two's own broadcast, `0x413410`, which sounds 0x21 at each cage
  // it turns (`0x413440`, `0x413457`)
  for (const c of lvl.cages.flat()) {
    if (c.param !== param) continue;
    if (c.state === "shut") {
      c.state = "opening";
      c.clock = 0;
      sound?.effect(CAGE.toggle, c.x, c.y);
    } else if (c.state === "open") {
      c.state = "closing";
      c.clock = 0;
      sound?.effect(CAGE.toggle, c.x, c.y);
    }
  }
  // `0x43c430` sounds 0x24 at each door it turns (`0x43c460`, `0x43c477`),
  // through `0x40f090` — channel 0 again
  for (const d of lvl.doors.flat()) {
    if (d.param !== param) continue;
    if (d.state === "shut") {
      d.state = "opening";
      d.clock = 0;
      sound?.effect(SWITCH.toggle, d.x, d.y, "lead");
    } else if (d.state === "open") {
      d.state = "closing";
      d.clock = 0;
      sound?.effect(SWITCH.toggle, d.x, d.y, "lead");
    }
  }
}

/** every drip of goop in the air, whichever string it belongs to */
export let drips: Drip[] = [];

/** `0x434540(n)` returns 1…n — level six's levers, and every class's own brain */
export function roll(n: number): number {
  return scRoll(n);
}

/**
 * The floor a foot moving from `fromY` to `toY` meets, for an object that
 * stands on the REGION and nothing else.
 *
 * `0x42fd80` searches the platform table only for an object whose `obj+0x34`
 * is set (`0x42fe4a`), and the allocator leaves it 0 (`0x42f5a7`): the player
 * and a thrown gun (`0x45b10c`) set it, and the flare, the crow and its
 * feathers, the goop and the spray's gobs (`0x40c401` writes 0) never do. So
 * those fall straight through a walkway to the floor under it.
 */
export function regionFloorUnder(x: number, fromY: number, toY: number): number | null {
  const g = groundAt(x);
  return g !== null && g >= fromY && g <= toY ? g : null;
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
export function stepGoop(): void {
  const lvl = level;
  if (!lvl) return;
  for (const n of nestsHere()) {
    if (!n.on) continue;
    if (random() >= GOOP.chance * TICK_SCALE) continue;
    const kind = roll(2) - 1 === 0 ? "bead" : "strand";
    drips.push({
      kind,
      x: n.left + roll(n.right - n.left),
      y: n.top,
      vx: 0,
      vy: 0,
      clock: 0,
    });
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
        born.push({
          kind: "gob",
          x: d.x,
          y: d.y + GOOP.gobBelow,
          vx: 0,
          vy: 0,
          clock: 0,
        });
        sound?.effect(GOOP.gobSound, d.x, d.y + GOOP.gobBelow);
      }
      continue;
    }
    // the three that move: gravity 1.0 for a drop and a gob, ½ for a splash
    // (`0x435e81`, `0x435eb9`, `0x435ee4`), each landing on what anything lands
    // on — the floor under its foot (`0x42fd80`), swept along the fall
    const g = d.kind === "splash" ? PLAYER_GRAVITY / 2 : PLAYER_GRAVITY;
    const art = celRec(lvl.sbk, dripCel(d));
    const ext = art ? art.height - art.posY : 0;
    const wasFoot = d.y + ext;
    d.vy += g * TICK_SCALE;
    d.y += d.vy * TICK_SCALE;
    d.x += d.vx * TICK_SCALE;
    if (d.vy >= 0 && regionFloorUnder(d.x, wasFoot, d.y + ext) !== null) d.landed = true;
  }
  drips.push(...born);
  // ...and nothing holds a drip that has fallen out of the room altogether
  const bottom = p.room ? p.room.bottom + 400 : Infinity;
  drips = drips.filter((d) => {
    if (d.kind === "bead") return d.clock < dripFrames(d);
    // the strand is removed when its own script ends, gob or no gob
    if (d.kind === "strand") return d.clock < dripFrames(d);
    // `0x437382`/`0x4373e0`: a drop and a splash go the frame they are down;
    // `0x43746a`: a gob goes when it is down OR has met something
    if (!d.landed && !d.hit) return d.y < bottom;
    if (d.kind === "gob") {
      // `0x43747c`: three of them, each with its own shove — `0x4373a9`'s
      // `0x434540(200) - 100` across and `0x434540(80) - 70` up, through the
      // divisor the way `0x42f8b0` divides, away from zero
      for (let i = 0; i < GOOP.splashes; i++) {
        drips.push({
          kind: "splash",
          x: d.x,
          y: d.y,
          vx: roundAway((roll(200) - 100) / GOOP.divisor),
          vy: roundAway((roll(80) - 70) / GOOP.divisor),
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
export function dripStrike(d: Drip): SbkCel | null {
  const c = celRec(level?.sbk, dripCel(d));
  return c?.strike && c.blow ? c : null;
}

/**
 * What goop does to the gang — `0x438339`, `0x438fd9`, `0x439a59`, `0x43a659`.
 *
 * Their hit handlers ask which class hit them before they do anything else, and
 * goop is the one answer that is good news: health goes UP by the class's own
 * figure, clamped to what it started with, one sound, and no spray and no
 * subtraction. Sixty for the one with the bat and twenty for the other three.
 * A full one is fed all the same: the clamp is the only ceiling, the sound
 * plays and the gob is spent (the handler returns 1). Only an empty one
 * (`test cx, cx; jle`) falls through to the blow.
 *
 * It reaches them the same way a blow does — the gob's own strike box against
 * the body box of the cel they are showing — so it is the same one cel that
 * feeds them and the same one that hurts you.
 */
export function feedTheGang(): void {
  const lvl = level;
  if (!lvl || !drips.length) return;
  for (const e of spawnedHere()) {
    // a sleeper is fed like anything else — the handlers test no state — but
    // only through a cel with a body box (`0x4303b3`): the gang's flinch and
    // death cels carry none, so a flinching one is out of reach
    if (e.state === "dead" || e.state === "burst") continue;
    const heal = GOOP.feeds[e.kind];
    if (heal === undefined) continue;
    const foe = FOES[e.kind];
    if (e.hp <= 0) continue;
    const c = celRec(lvl.sbk, celOf(e));
    if (!c?.body) continue;
    const box = hurtBox(e, c, lvl);
    const fed = drips.find((d) => {
      const cel = dripStrike(d);
      if (!cel) return false;
      const b = strikeOf(cel, d.x, d.y, 1);
      return (
        !!b &&
        b.right > box.left &&
        b.left < box.right &&
        b.bottom > box.top &&
        b.top < box.bottom
      );
    });
    if (!fed) continue;
    // clamped to `0x40e300` of the starting figure — the difficulty-scaled one
    e.hp = Math.min(e.max ?? foe.health, e.hp + heal);
    sound?.effect(GOOP.fedSound[e.kind] ?? 0xb, e.x, e.y);
    // the handler answers 1 and the gob's `obj+0x2a` is set: it bursts
    fed.hit = true;
  }
}

/** the girders in the room the player is in */
export function ibeamsHere(): Ibeam[] {
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
export function stepIbeams(): void {
  for (const b of ibeamsHere()) {
    if (b.delay > 0) {
      b.delay -= TICK_SCALE;
      continue;
    }
    b.clock += TICK_SCALE;
    if (b.clock < ibeamFrames(b)) continue;
    b.clock = 0;
    if (b.state === "out") {
      b.side = b.side ? 0 : 1;
      b.state = "across";
    } else if (b.state === "across") {
      b.side = b.side ? 0 : 1;
      b.state = "back";
      sound?.effect(IBEAM.sound, b.x, b.y);
    } else {
      // `0x453894`: back to tag 0 with sound 6, and no flip
      b.state = "out";
      sound?.effect(IBEAM.soundBack, b.x, b.y);
    }
  }
}

/** the crows in the room the player is in */
export function crowsHere(): Crow[] {
  const i = level && p.room ? level.rooms.indexOf(p.room) : -1;
  return level && i >= 0 ? level.crows[i] : [];
}

/** the feathers a struck crow has thrown off, wherever they are */
export let feathers: Feather[] = [];

/**
 * Step every crow, one engine frame — `0x451aa0`'s think, the animator's pushes
 * and the mover, in the engine's order. {@link CROW} has the states written out.
 */
export function stepCrows(): void {
  const lvl = level;
  // the player's point, `obj+6`
  const py = p.y - p.feet;
  const install = (c: Crow, state: CrowState, tag = 0): void => {
    c.state = state;
    c.tag = tag;
    c.clock = 0;
  };
  for (const c of crowsHere()) {
    // `obj+0x46`: the tag has shown every one of its cels
    const ended = c.clock >= crowFrames(c);
    // `0x451aeb` — airborne, from state 4 up, bar the feathers and the tumble
    let want = py - CROW.above;
    if (
      c.state !== "sleep" &&
      c.state !== "wake" &&
      c.state !== "rise" &&
      c.state !== "tumble" &&
      !c.grounded
    ) {
      want = (roll(CROW.jitter) + CROW.jitter) * c.factor + py - CROW.above;
      const gap = want - c.y;
      if (gap > CROW.band) c.vy += CROW.climb;
      else if (gap < -CROW.band) c.vy -= CROW.climb;
      else c.vy = 0;
      if (Math.abs(c.vy) > CROW.damp && c.state !== "strike")
        c.vy = Math.trunc(c.vy / 2);
    }
    switch (c.state) {
      case "sleep": {
        // `0x451ba3`: the player's own point inside the crow's rect
        if (p.x >= c.left && p.x < c.right && py >= c.top && py < c.bottom)
          install(c, "wake");
        else if (ended) {
          sound?.effect(CROW.sound.sleep, c.x, c.y);
          install(c, "sleep");
        }
        break;
      }
      case "wake":
        if (ended) install(c, "rise");
        break;
      case "rise":
        if (ended) {
          install(c, "fly");
          sound?.effect(CROW.sound.flap, c.x, c.y);
        }
        break;
      case "hop":
        if (c.tag === 0) {
          // `0x451c74`: its end picks one of the other two tags...
          if (ended) install(c, "hop", roll(2));
          // ...and a player less than 160 east of it — or west of it at all —
          // is dived at (`0x451ca3` is a signed compare)
          if (p.x - c.x < CROW.strikeAt) {
            sound?.effect(CROW.sound.strike, c.x, c.y);
            c.vx = Math.trunc(c.vx / 2);
            install(c, "strike", 1);
          }
        } else if (ended) install(c, "hop", 0);
        break;
      case "fly":
        if (c.tag === 0) {
          // `0x451d18`: shed speed, halving, until it is ten or less
          if (Math.abs(c.vx) > CROW.damp) c.vx = Math.trunc(c.vx / 2);
          else install(c, "fly", 1);
        } else if (c.tag === 1) {
          if (ended) install(c, "fly", 2);
        } else if (c.tag === 2) {
          // `0x451d70`: back away from a player less than 350 ahead
          if (p.x - c.x < CROW.farAt) c.vx -= CROW.backOff;
          if (Math.abs(c.vx) > CROW.backOffCap) c.vx = Math.trunc(c.vx / 2);
          if (ended) {
            c.vx = 0;
            install(c, "fly", 3);
          }
        } else if (ended) {
          // `0x451dfa`: 350 or more east of it and it strikes
          if (p.x - c.x < CROW.farAt) install(c, "fly", 0);
          else {
            c.vx = 0;
            sound?.effect(CROW.sound.strike, c.x, c.y);
            install(c, "strike", 0);
          }
        }
        break;
      case "fall":
        // `0x451e5a` — the eight frames of the burn are up, so gravity 1.0, the
        // tumble and `0x40d450(0x50)`, which is the same award a punch pays
        if (ended) {
          c.gravity = CROW.deadGravity;
          install(c, "tumble");
          stats.score += CROW.award;
        }
        break;
      case "strike":
        if (c.tag === 0) {
          // `0x451eb9`: three times in ten it gives the attack up
          if (roll(10) < CROW.giveUp) install(c, "hop", 0);
          else {
            install(c, "strike", 2);
            c.factor = roll(2);
          }
        } else if (c.tag === 1) {
          if (ended) {
            install(c, "fly", 0);
            sound?.effect(CROW.sound.flap, c.x, c.y);
          }
        } else if (c.tag === 2) {
          if (ended) install(c, "strike", 3);
        } else if (c.tag === 3) {
          // `0x451f53`: down to its height, then the run
          if (c.y >= want) {
            install(c, "strike", 4);
            c.vy = 0;
          } else if (ended) {
            install(c, "strike", 3);
            sound?.effect(CROW.sound.flap, c.x, c.y);
          }
        } else {
          // `0x451fac`: the run east, capped, and again while it is still west
          // of the player and has touched nothing
          if (Math.abs(c.vx) > CROW.runCap) c.vx = Math.trunc(c.vx / 2);
          if (ended) {
            if (c.x <= p.x && !c.hit) {
              install(c, "strike", 4);
              sound?.effect(CROW.sound.strike, c.x, c.y);
            } else {
              install(c, "fly", 0);
              c.hit = false;
              c.factor = 0;
            }
          }
        }
        break;
      case "tumble":
        break;
    }
    // the animator: the cel it shows pushes, through the divisor of one
    const tag = crowTag(c);
    if (c.clock < crowFrames(c)) {
      const k = Math.floor(c.clock / tag.hold);
      c.vx += roundAway((tag.dx?.[k] ?? 0) / CROW.divisor);
      c.vy += roundAway((tag.dy?.[k] ?? 0) / CROW.divisor);
    }
    c.clock += 1;
    // ...and the mover: the move, the floor under the foot, then gravity or drag
    const art = lvl ? celRec(lvl.sbk, crowCel(c)) : undefined;
    const ext =
      (art ? art.height - art.posY : 0) + (c.state === "tumble" ? CROW.deadFoot : 0);
    const wasFoot = c.y + ext;
    c.x += c.vx;
    c.y += c.vy;
    // the floor it crossed, or — already standing — one within the eight the
    // mover snaps to
    const floor =
      c.vy >= 0
        ? regionFloorUnder(c.x, wasFoot - (c.grounded ? 8 : 0), c.y + ext + (c.grounded ? 8 : 0))
        : null;
    if (floor !== null) {
      c.y = floor - ext;
      c.vy = 0;
      c.grounded = true;
      c.vx = dragged(c.vx);
    } else {
      c.grounded = false;
      c.vy += c.gravity;
    }
  }
  // and the feathers: `0x452035` lets one go the frame it is found on the
  // ground; until then it loops its script and falls at one pixel a frame²
  feathers = feathers.filter((f) => !f.grounded);
  for (const f of feathers) {
    f.age += 1;
    const art = lvl ? celRec(lvl.sbk, featherCel(f)) : undefined;
    const ext = art ? art.height - art.posY : 0;
    const wasFoot = f.y + ext;
    f.x += f.vx;
    f.y += f.vy;
    const floor = f.vy >= 0 ? regionFloorUnder(f.x, wasFoot, f.y + ext) : null;
    if (floor !== null) {
      f.y = floor - ext;
      f.vy = 0;
      f.grounded = true;
    } else f.vy += CROW.feather.gravity;
  }
  // a tumbling crow that has fallen out of the world is done with
  const room = p.room;
  const i = lvl && room ? lvl.rooms.indexOf(room) : -1;
  if (lvl && room && i >= 0) {
    lvl.crows[i] = lvl.crows[i].filter(
      (c) => c.state !== "tumble" || c.y < room.bottom + 400,
    );
  }
}

/** which cel a feather is showing — `0x476ea0`, looped until it lands */
export function featherCel(f: Feather): number {
  const a = CROW.feathers;
  return a.cels[Math.floor(f.age / a.hold) % a.cels.length];
}

/**
 * A blow landing on a crow — `0x4520d0`, which has no health test in it.
 *
 * One hit is all: feathers (one, or four when the blow beats 50 — `0x45213f`
 * adds three to the one `0x45215a` always makes), woods 18, gravity 1.0 and the
 * tumble, with whatever velocity it had. The award is `0x40d450(0x50)`.
 */
export function strikeCrow(c: Crow, damage: number): void {
  const puffs = damage > CROW.hardBlow ? 4 : 1;
  for (let i = 0; i < puffs; i++) {
    // `0x4521d0`: at the crow's own point, a random facing and push
    feathers.push({
      x: c.x,
      y: c.y,
      vx: roll(11) - 6,
      vy: roll(11),
      mirror: roll(2) === 2,
      age: 0,
      grounded: false,
    });
  }
  sound?.effect(CROW.sound.hit, c.x, c.y);
  c.state = "tumble";
  c.tag = 0;
  c.clock = 0;
  c.gravity = CROW.deadGravity;
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
/**
 * One projectile in the air, thrown by a class rather than by the player.
 *
 * The gun's {@link Bolt} is the same idea and not the same thing: a bolt is the
 * player's and expires on the first thing it meets, while these belong to a
 * creature, carry that creature's own strength, and are drawn out of the
 * LEVEL's book rather than the shared player book.
 */
export interface Cast {
  kit: CastKit;
  x: number;
  y: number;
  /** pixels an engine frame, along the facing it left with */
  vx: number;
  facing: number;
  /** engine frames since it launched — the flight cels are read off it */
  clock: number;
  /** ...and the pull's half of the velocity, for the ones that arc */
  vy: number;
  /** frames into its own impact, once it has landed — see {@link CastKit.impact} */
  landed?: number;
  /** where it started, for the kits whose end is a range rather than a reach */
  bornX: number;
  /** ...and the height it started at, which only the fall guard below reads */
  bornY: number;
  /** frames into the burst a BOUNCE plays, while the flight carries on under it */
  bounced?: number;
  /** has it come close enough to arm — see {@link CastKit.arm}. One-way */
  armed: boolean;
  /**
   * It is on FIRE — word 0 of the six bytes `0x456240` allocates beside the
   * object, and of the two casts with a −9 arm the fireball is the only one
   * that has any. One-way too, and {@link CastKit.onCode} owns it: see
   * {@link CastSelf.alight}.
   */
  alight?: boolean;
  /** its impact was started by another's burst — {@link chainCasts}; the probe's */
  setOff?: boolean;
  /** it has struck something and flies on worth nothing — {@link CastKit.flyOn} */
  struck?: boolean;
  /** where its thrower stood when it let go — `AI+4`/`AI+6` of the hardcore's */
  fromX: number;
  fromY: number;
  /** out on the far leg of a throw that comes back — {@link CastKit.returns} */
  out?: boolean;
  /** ...and engine frames into the way back, once it has turned */
  back?: number;
  spent: boolean;
}

/**
 * ...and the one kit that belongs to no class module, because the thing that
 * throws it is a MACHINE rather than a creature — see {@link BOGGS.throwing}.
 */
export const BOGGS_THROW: CastKit = {
  cels: BOGGS.throwing.cels,
  hold: 1,
  // no frame of tag 0 carries a speed of its own: every pixel of it is stride
  speed: 0,
  ahead: BOGGS.throwing.ahead,
  lift: 0,
  blow: BOGGS.throwing.strength,
  reach: BOGGS.throwing.reach,
  strides: BOGGS.throwing.strides,
  divisor: BOGGS.throwing.divisor,
  impact: { cels: BOGGS.throwing.splat, hold: 1 },
  from: BOGGS.throwing.from,
};

/** everything a creature has thrown and the world has not taken back yet */
export let casts: Cast[] = [];

/** every board two of level five's gang have dropped — {@link SKATEBOARD} */
export let skates: Board[] = [];

/**
 * One goes down where any of the gang died — `0x438450`.
 *
 * It is put ten above the surface under the thing that dropped it, keeps its
 * facing, and leaves on the hop its own script's first frame carries: `dx 15`
 * and `dy -50` through the class's divisor of five, so three across and ten up.
 * `0x4385af` then reads `noskateboards` at the board's own point and that is
 * the whole of how long it lies there.
 */
export function dropBoard(e: Enemy): void {
  const lvl = level;
  if (!lvl) return;
  const b = SKATEBOARD;
  if (!lvl.sbk.byId.has(b.hop.cel) || !lvl.sbk.byId.has(b.rest)) return;
  // `0x438487` — the REGION floor under the dropper's point (the board has no
  // ledges: `0x4384ee`), and `0x4384c3` takes the ten off that
  const floor = looseFloor(e.x);
  const y = (floor ?? e.y) - b.lift;
  // `0x438497`..`0x4384bf` — and its x kept to the floor's own span: past the
  // far end it is put fifty inside it, and short of the near end it is put
  // fifty past the FAR end, which is what the executable writes
  const g = p.room?.ground;
  let x = e.x;
  if (g) {
    // `0x40bc6d` — the span's end is its start plus its sample count
    const end = g.x0 + g.ys.length;
    if (end < x) x = end - 0x32;
    if (x < g.x0) x = end + 0x32;
  }
  // `0x4385bd` — one point-in-record test, once, at the moment it is dropped
  const swept = lvl.sbk.entities.some(
    (r) =>
      r.name === b.sweptBy &&
      x >= r.left &&
      x <= r.right &&
      y >= r.top &&
      y <= r.bottom,
  );
  skates.push({
    x,
    y,
    bornY: y,
    vx: roundAway((e.facing * b.hop.dx) / b.divisor),
    vy: roundAway(b.hop.dy / b.divisor),
    down: false,
    life: b.lasts[swept ? 1 : 0],
    facing: e.facing,
  });
}

/**
 * The board's rect — {@link SKATEBOARD.ride}: cel 2300's drawn box as
 * `0x438501`..`0x43855c` files it, at the board's own point.
 */
function boardRect(d: Board): { top: number; left: number; right: number } | null {
  const r = SKATEBOARD.ride;
  const c = celRec(level?.sbk, r.cel);
  if (!c) return null;
  let left = -r.widen - c.posX;
  let right = c.width - c.posX + r.widen;
  if (d.facing < 0) [left, right] = [-right, -left];
  return { top: d.y + r.topDown - c.posY, left: d.x + left, right: d.x + right };
}

/**
 * One frame of a board lying there with the player about — `0x437854`, and
 * see {@link SKATEBOARD.ride}. Answers the drag the mover takes this frame.
 */
function rideBoard(d: Board): number {
  const r = SKATEBOARD.ride;
  const box = boardRect(d);
  d.vx = Math.max(-r.maxSpeed, Math.min(r.maxSpeed, d.vx));
  const me = playerSprite();
  const bottom = me ? me.top + me.f.height : p.y;
  const on =
    !!box &&
    p.onGround &&
    p.x < box.right &&
    p.x > box.left &&
    Math.abs(bottom - box.top) < r.feetPx;
  if (on) {
    // `0x4378fa`..`0x437924`
    d.stood = true;
    d.vx += p.facing;
    d.facing = p.facing;
    return 0;
  }
  if (!d.stood || !box) return r.offDrag;
  d.stood = false;
  // `0x437951`..`0x43797e` — gone on ahead of him, the way it faces
  const behind = d.facing > 0 ? p.x < box.left : p.x > box.right;
  if (!behind) return r.offDrag;
  // `0x43798d` — tag 0 again, the hop, its script step spent as an impulse
  d.down = false;
  d.vx += roundAway((d.facing * SKATEBOARD.hop.dx) / SKATEBOARD.divisor);
  d.vy += roundAway(SKATEBOARD.hop.dy / SKATEBOARD.divisor);
  d.life -= r.kickedLife;
  // `0x4379a3` — out from under him at speed: `0x402fa0(2)`, which drops the
  // keys (`0x402df0`) and, off a ladder and not already down or dying
  // (`0x42f321`..`0x42f347`), installs `0x4722a8` tag 0 — kind 24, unarmed
  if (Math.abs(d.vx) > r.tripSpeed) {
    dropKeys();
    if (p.act !== "downFront" && p.act !== "downBack" && p.act !== "dying" && !p.ladder && !p.bar) {
      if (p.act === "fire") shutStreams();
      p.act = "downFront";
      p.actClock = 0;
      inv.drawn = false;
    }
  }
  return r.offDrag;
}

/**
 * The boards, one engine frame each.
 *
 * The same mover every object in the game runs through — {@link looseStep},
 * with the class's own restitution (`0x437661`) and drag (`0x437653`), the
 * allocator's weight, and the foot of whichever of its two cels it shows.
 * `0x4377c4` is the cel change — the frame the standing word is first set —
 * and `0x437809` is the countdown that follows.
 */
export function stepBoards(): void {
  const b = SKATEBOARD;
  for (const d of skates) {
    // state 1, the board lying there: the player can step on it — and what
    // that leaves the drag at is what the mover takes this frame
    const drag = d.down ? rideBoard(d) : b.friction;
    const moved = looseStep(d, {
      foot: celFoot(d.down ? b.rest : b.hop.cel),
      bounce: Math.trunc(b.bounce * -8192),
      drag: Math.trunc(drag * 8192),
      weight: b.pull,
    });
    if (moved.down) d.down = true; // `0x4377c4`
    // `0x437809` — and only once it is down, which is what `0x4377ea` waits for
    if (d.down) d.life -= 1;
    // the page's own guard, the casts' one exactly: a board is removed by its
    // countdown, and its countdown does not start until a surface is under it
    if (d.y - d.bornY > FALLS_FOREVER) d.life = -1;
  }
  skates = skates.filter((d) => d.life >= 0);
}


/**
 * A roller as the mover keeps it: its vertical half, the launch it is holding
 * in the script's own units until `0x43a9c4` spends it, and whether it has come
 * to rest (`obj+0x30`, which `0x43a9f1` reads).
 */
export type RollerBody = Roller & { vy: number; launch: number; still: boolean };

/** the one roller a level may have — {@link ROLLER} */
export let rollers: RollerBody[] = [];

/** what the Coke machines have thrown out — {@link CAN} */
export let cans: Can[] = [];

/**
 * `0xfff7` — the one strength that is a code against a creature.
 *
 * `0x453b9b` is the flamer's flame and `0x43ac04` is a flare on stage 5; those
 * are the only two things in the game that carry it.
 */
export const BURN_CODE = -9;

/** what is on fire — {@link FLAME}, and a blow of −9 is what lights one */
export let flames: Flame[] = [];

/**
 * Light one — `0x44ff20`, the half of a −9 that every class shares.
 *
 * The offset is a random point inside the victim's CURRENT cel bitmap, both
 * axes, and it is kept rather than re-rolled: `0x453ea0` reads `user+6` and
 * `user+4` back every frame and mirrors the first of them by the victim's own
 * facing. So a flame sits somewhere on the creature and stays there.
 */
export function burnFoe(e: Enemy, how: NonNullable<Foe["burns"]>): void {
  if (!level) return;
  lightFlame(e, celRec(level.sbk, celOf(e)), e.facing < 0, how);
}

/**
 * ...and on a CAST, which is the same function on a different kind of object.
 *
 * `0x44ff20` takes whatever it is given and asks `0x42f9f0` for its current
 * cel's box, so nothing in it cares that the fireball is not a creature — see
 * {@link CastKit.onCode}, which is the only caller.
 */
export function burnCast(
  c: Cast,
  how: { late?: boolean; forever?: boolean },
): void {
  if (!level) return;
  lightFlame(c, celRec(level.sbk, castCel(c)), c.facing < 0, how);
}

/**
 * The shared half: one flame, somewhere inside the victim's own cel.
 *
 * `mirror` is the victim's facing as it catches: `0x44ffee` copies its
 * `obj+0x28` into the flame's, once, and nothing writes it again. The flame
 * cels are not centred on their anchors (9620's is 11 of 34 across), so a flame
 * on something facing left is drawn reflected about that anchor, and it stays
 * so if the victim turns.
 */
export function lightFlame(
  on: object,
  art: SbkCel | undefined,
  mirror: boolean,
  how: { late?: boolean; forever?: boolean; stack?: boolean },
): void {
  const lvl = level;
  if (!lvl) return;
  // no art, no fire: only four books carry the 9600s
  if (!FLAME.grow.cels.every((id) => lvl.sbk.byId.has(id))) return;
  // ...and one flame at a time, which is this page's and not `0x44ff20`'s: the
  // function makes a new flame object every call, and a handler whose −9 arm
  // comes before its dying test (the punk's `0x44f0aa`) is called every frame a
  // stream stays on it. Kept so that a held stream reads as one fire — but a
  // flame lit to burn for ever (the CHOPPER's wreck, `0x4546b1`) is a second
  // object beside whatever was already burning, as it is on the disc
  // ...and the shower's `0x41a3f0` asks for its own too: one a frame for as
  // long as it burns, which is the point of it (`stack`)
  if (!how.forever && !how.stack && flames.some((f) => f.on === on)) return;
  // `0x44ff42` — halves of the victim's `0x42f9f0` rect, which is its current
  // cel's drawn extent; a cel the book does not carry has none
  const halfW = art ? Math.floor(art.width / 2) : 0;
  const halfH = art ? Math.floor(art.height / 2) : 0;
  // `0x434540` answers nothing for a range of nothing
  const pick = (n: number): number => (n > 0 ? roll(n) : 0);
  const f: Flame = {
    on,
    // `0x44ffa5`/`0x44ffc6`: `roll(half) - half/2`, so it is centred on the
    // middle of the box and spread half a box either way
    dx: pick(halfW) - Math.floor(halfW / 2),
    dy: pick(halfH) - Math.floor(halfH / 2),
    stage: how.late ? 2 : 0,
    clock: 0,
    forever: how.forever === true,
    mirror,
    x: 0,
    y: 0,
  };
  flames.push(f);
  // placed now as well as every frame, so a flame lit after the flame pass
  // (the CHOPPER's wreck, lit from its own think) is not drawn once elsewhere
  placeFlame(
    f,
    lvl,
    on === p ? "player" : crowsHere().includes(on as Crow) ? "crow" : casts.includes(on as Cast) ? "cast" : "foe",
  );
}

/**
 * Where a flame stands — `0x453eb7`, against its victim's `obj+8` and `obj+6`.
 *
 * Those are the victim's ANCHOR, the point its cels are drawn from, and not the
 * middle of anything. A creature's `e.x` on this page is the middle of its gait
 * cel, so the anchor is {@link foeAnchor}'s: for the CHOPPER, whose 4870 hangs
 * 197 of its 222 pixels right of the anchor, measuring from `e.x` put the flame
 * on its wreck 86 pixels off it.
 */
function placeFlame(f: Flame, lvl: Level, kind: "crow" | "cast" | "foe" | "player"): void {
  if (kind === "player") {
    // `0x41a019`..`0x41a055` — chapter four's flame, the same arithmetic
    // against the player's own point
    f.x = p.x + (p.facing < 0 ? -f.dx : f.dx);
    f.y = p.y - p.feet + f.dy;
  } else if (kind === "crow") {
    // a crow's point is its own anchor, and nothing on this page mirrors its
    // art, so `0x453eb7`'s facing has nothing to flip the offset by
    const c = f.on as Crow;
    f.x = c.x + f.dx;
    f.y = c.y + f.dy;
  } else if (kind === "cast") {
    // ...and a cast's own point IS its anchor: `obj+6` is what `0x453eb7`
    // reads back, and one of these has no separate foot to measure from
    const c = f.on as Cast;
    f.x = c.x + (c.facing < 0 ? -f.dx : f.dx);
    f.y = c.y + f.dy;
  } else {
    const e = f.on as Enemy;
    // `0x453eb7` — the offset is mirrored by the victim's facing, the
    // vertical one is not, and both are against the victim's own anchor
    const at = foeAnchor(e, lvl) ?? e;
    f.x = at.x + (e.facing < 0 ? -f.dx : f.dx);
    f.y = at.y + f.dy;
  }
}

/**
 * The flames, one engine frame at a time — `0x453ea0`.
 *
 * It follows its victim, it is worth a hundred every frame it exists
 * (`0x453eed`), and it goes out at the end of its third stage unless it was
 * lit to burn forever. A flame whose victim is gone goes with it: `0x453eae`
 * answers 1 the moment `user+8` is null.
 */
export function stepFlames(): void {
  const lvl = level;
  if (!lvl) return;
  const alive = new Set<object>(spawnedHere());
  // ...and a cast can be alight as well — `0x455763` and `0x452fcc`, the −9
  // arms on a cast, and `0x453eae` takes a flame with its victim
  const lit = new Set<object>(casts);
  for (const c of casts) alive.add(c);
  // ...and so can a crow — `0x4520d0`. `0x430367` hands every OBJECT in the room
  // its own `obj+0x12`, so what can be lit is not only what is in the pool
  const birds = new Set<object>(crowsHere());
  for (const c of birds) alive.add(c);
  // ...and the player, whom VAT's showers light (`0x41a3f0`)
  alive.add(p);
  for (const f of flames) {
    if (!alive.has(f.on)) continue;
    placeFlame(f, lvl, f.on === p ? "player" : birds.has(f.on) ? "crow" : lit.has(f.on) ? "cast" : "foe");
    f.clock += 1;
    const run =
      f.stage === 0
        ? FLAME.grow.cels.length * FLAME.grow.hold
        : f.stage === 1
          ? FLAME.burn.cels.length * FLAME.burn.hold
          : FLAME.fade.cels.length * FLAME.fade.hold;
    if (f.clock < run) continue;
    if (f.stage === 0) {
      f.stage = 1;
      f.clock = 0;
    } else if (f.stage === 1) {
      f.stage = 2;
      f.clock = 0;
    } else if (f.forever) {
      // `0x453f76` — tag 2 goes back on itself and the thing burns for ever
      f.clock = 0;
    }
  }
  // gone: the victim left the level, or the third stage ran out on one that
  // was not lit to last
  // `0x41a0d2` — and a flame on a player no longer on his feet goes the moment
  // it is in its third stage
  flames = flames.filter(
    (f) =>
      alive.has(f.on) &&
      !(f.on === p && f.stage === 2 && p.act === "dying") &&
      (f.forever ||
        f.stage !== 2 ||
        f.clock < FLAME.fade.cels.length * FLAME.fade.hold),
  );
}

/** the cel a flame is showing — {@link FLAME}'s three stages in order */
export function flameCel(f: Flame): number {
  const a =
    f.stage === 0 ? FLAME.grow : f.stage === 1 ? FLAME.burn : FLAME.fade;
  return a.cels[Math.min(a.cels.length - 1, Math.floor(f.clock / a.hold))];
}

/**
 * A can out of a machine — `0x43b780`, and the point is the machine's own.
 *
 * `0x43b7e2` turns it away from the player, and the first record of
 * `0x474ce0` is the only stride in the script: `dx 120, dy -70` over the
 * class's divisor of five. `0x43ae34` then gives this one its own drag.
 */
export function canAt(e: Enemy): void {
  const lvl = level;
  if (!lvl) return;
  // no art, no can — MALL is the only book with the 8600s and the only level
  // with a Coke machine, but a level list is not a guarantee
  if (!CAN.tumble.cels.every((id) => lvl.sbk.byId.has(id))) return;
  const away = p.x < e.x ? 1 : -1;
  // `0x43b7ad`/`0x43b7be` copy the machine's own `obj+6`, which is the ANCHOR
  // and not the feet. A Coke machine's anchor is under the floor it stands on,
  // so a can born there starts through it — and the mover's first frame puts
  // it back on top, as `0x42ff4c` does anything under its floor
  const at = foeAnchor(e, lvl) ?? { y: e.y };
  cans.push({
    x: e.x,
    y: at.y,
    vx: away * roundAway(CAN.launch.dx / CAN.divisor),
    vy: roundAway(CAN.launch.dy / CAN.divisor),
    clock: 0,
    tag: 0,
    drag: CAN.drags[Math.floor(random() * CAN.drags.length)],
  });
}

/**
 * The cans, one engine frame at a time — `0x43af00`.
 *
 * Tag 0 tumbles and tag 1 rolls; when tag 1 ends `0x43af4e` rolls one to three
 * and either goes round tag 1 again or settles on tag 2 or tag 3, both of
 * which hold one cel and wait for it to stop. Stopping is what makes the
 * pickup, and after that the can is scenery with a `Gun` underneath it.
 */
export function stepCans(): void {
  const lvl = level;
  if (!lvl) return;
  for (const c of cans) {
    if (c.rest !== undefined) continue; // down, and its pickup is made
    c.clock += 1;
    // the mover, with the can's own drag (`0x43ae5b`), the allocator's
    // restitution and weight, and no ledges (`0x43ae2e`)
    const { still } = looseStep(c, {
      foot: celFoot(canCel(c)),
      bounce: LOOSE_BORN.bounce,
      drag: Math.trunc(c.drag * 8192),
      weight: CAN.pull,
    });
    const len =
      c.tag === 0
        ? CAN.tumble.cels.length * CAN.tumble.hold
        : c.tag === 1
          ? CAN.settle.cels.length * CAN.settle.hold
          : 1;
    if (c.tag <= 1) {
      if (c.clock < len) continue;
      // `0x43af32` hands tag 0 to tag 1; `0x43af4e` rolls 1..3 out of tag 1
      c.tag = c.tag === 0 ? 1 : 1 + Math.floor(random() * 3);
      c.clock = 0;
      continue;
    }
    // tags 2 and 3 — `0x43af6c` and `0x43af9d`, both waiting on `obj+0x30`:
    // the can has stopped, not merely come down
    if (!still) continue;
    c.rest = CAN.rests[c.tag - 2] ?? CAN.rests[0];
    const i = lvl.rooms.findIndex(
      (r) => c.x >= r.left && c.x <= r.right && c.y >= r.top && c.y <= r.bottom,
    );
    if (i < 0) continue;
    // `0x45af60(2, point, 0, 0x43aff0)` — and the band is the pickup's own
    // fifty-five, not the thirty-six a placed record is filed with
    lvl.guns[i] = [
      ...lvl.guns[i],
      {
        code: CAN.code,
        x: c.x,
        y: c.y,
        left: c.x - CAN.reach,
        right: c.x + CAN.reach,
        clock: 0,
      },
    ];
  }
  // ...and the page's own guard, as every free object here has: out of the
  // room's span and it is gone. `0x43af00` has no such rule because a can that
  // has landed is a pickup, and the level owns those.
  const span = p.room ? roomSpan(p.room) : null;
  if (span)
    cans = cans.filter(
      (c) => c.rest !== undefined || (c.x >= span.lo && c.x <= span.hi),
    );
}

/** the heads creatures have shed — {@link HEAD} */
export let heads: Head[] = [];

/**
 * `0x4208e0` — a head off a dying creature, at the creature's own point
 * (`obj+6`) moved along its facing, with the velocity its death hands over
 * ({@link HEAD}'s `sheds`). Mode 1 says index 5 as it is made (`0x420951`).
 */
export function shedHead(e: Enemy, mode: 0 | 1): void {
  const lvl = level;
  if (!lvl) return;
  const tag = mode === 0 ? HEAD.hop : HEAD.roll;
  // no art, no head: the zombie's are in GRAVE and CAVERN, igor's in RAVECAVE
  if (!tag.cels.every((id) => lvl.sbk.byId.has(id))) return;
  const s = HEAD.sheds[mode];
  const at = foeAnchor(e, lvl) ?? { x: e.x, y: e.y };
  const vx = s.vx * e.facing;
  heads.push({
    x: at.x + s.dx * e.facing,
    y: at.y + s.dy,
    vx,
    vy: s.vy,
    // `0x42090c` — `obj+0x28 = 1` when the x it was handed is negative
    west: vx < 0,
    mode,
    clock: 0,
    down: false,
  });
  if (mode === 1) sound?.effect(HEAD.rollSound, at.x, at.y);
}

/**
 * `0x420090` — the player's foot on a zombie's head: `0135 basketball`, four
 * hundred points, a green ball where it was, and `return 1`, so `0x430470`
 * trades the blow with it at the head's divisor of five.
 */
function kickHead(h: Head, blow: { dx: number; dy: number }): void {
  sound?.effect(HEAD.kickSound, h.x, h.y);
  stats.score += HEAD.award;
  pops.push({ x: h.x, y: h.y, age: 0 });
  const v = knockback(
    DIVISOR,
    HEAD.divisor,
    { dx: blow.dx * p.facing, dy: blow.dy },
    { vx: p.vx, vy: p.vyRaw },
    { vx: h.vx, vy: h.vy },
  );
  h.vx = v.vx;
  h.vy = v.vy;
  p.vx = v.hvx;
  if (!p.onGround) p.vyRaw = v.hvy;
}

/**
 * The heads, one engine frame at a time, in the frame's own order: every
 * object's script is stepped first (`0x42fc2f`, `0x42fc4b` call `0x45d0f0`)
 * and the mover runs last (`0x42fd56`), so the think reads the landing the
 * mover has just left ({@link HEAD}).
 *
 * The step counts the hold down BEFORE it reads a record (`0x45d121`), and
 * `0x45d090` sets that count to the script's rate: so the first record shows
 * for one step, not two, and `0x45d1a3` adds its `dx / divisor` and
 * `dy / divisor`, rounded away from zero, into the velocity once — `dx`
 * turned round for a head facing west (`0x45d18c`).
 */
export function stepHeads(): void {
  const lvl = level;
  if (!lvl) return;
  heads = heads.filter((h) => {
    const tag = h.mode === 0 ? HEAD.hop : HEAD.roll;
    const len = tag.cels.length * tag.hold;
    h.clock += 1;
    const i = Math.min(tag.cels.length - 1, Math.floor(h.clock / tag.hold));
    const dx = tag.dx[i];
    const dy = tag.dy[i];
    if (dx) h.vx += roundAway(dx / HEAD.divisor) * (h.west ? -1 : 1);
    if (dy) h.vy += roundAway(dy / HEAD.divisor);
    h.down = looseStep(h, {
      foot: celFoot(headCel(h)),
      bounce: HEAD.bounce,
      drag: 0,
      weight: HEAD.weight,
    }).down;
    // `0x41ffc9` — out of the player's reach, and `0x41ffde` — going the
    // other way from the way it faces
    if (Math.abs(p.x - h.x) > HEAD.range) return false;
    if (h.west ? h.vx > 0 : h.vx < 0) return false;
    if (h.mode === 0) {
      // `0x420010` — standing: index 0x13 and tag 0 again, and so the hop
      if (h.down) {
        sound?.effect(HEAD.bounceSound, h.x, h.y);
        h.clock = 0;
      }
    } else if (h.clock >= len) {
      // `0x42003f` — the roll ran out: tag 1 again, and index 5 again
      h.clock = 0;
      sound?.effect(HEAD.rollSound, h.x, h.y);
    }
    return true;
  });
}

/** the cel a head is showing — {@link HEAD} */
export function headCel(h: Head): number {
  const tag = h.mode === 0 ? HEAD.hop : HEAD.roll;
  return tag.cels[Math.min(tag.cels.length - 1, Math.floor(h.clock / tag.hold))];
}

/** the cel a can is showing — {@link CAN} */
export function canCel(c: Can): number {
  if (c.rest !== undefined) return c.rest;
  const a = c.tag === 0 ? CAN.tumble : CAN.settle;
  if (c.tag >= 2) return CAN.rests[c.tag - 2] ?? CAN.rests[0];
  return a.cels[Math.min(a.cels.length - 1, Math.floor(c.clock / a.hold))];
}

/**
 * `0x426346` — how many of a summoned class may be alive before the creator
 * refuses.
 *
 * It is a test on the class's own object list (`[0x46ecc4]`, the bats') and it
 * is `jg`, so the sixteenth still gets made and the seventeenth does not.
 */
export const HATCH_CAP = 0x10;

/**
 * One of another class's creatures, let go where a machine says — `0x426340`.
 *
 * Everything {@link spawnIn} does from a record, done from a point instead: the
 * cel-presence test, the anchor conversion through the class's own first gait
 * cel, and the rect the thing will patrol — which is the SUMMONER's, not one of
 * its own. What it deliberately does NOT do is consult {@link Foe.wake}: the
 * creator installs the flight outright, so a summoned thing is awake.
 */
export function hatchAt(owner: Enemy, kind: string, at: Hatch): void {
  const lvl = level;
  if (!lvl) return;
  const foe = FOES[kind];
  if (!foe) return;
  // it goes on the list of the room it was let go IN — and one let go in no
  // room at all stays with its thrower. The creator gives every summoned thing
  // region -1 (`0x426378`), which `0x40bbd0` answers with a world-sized rect and
  // no floor, and the mover files it by its point once that point is in a
  // region's rect (`0x43000a`); until then it flies on with the rest of the
  // class. TOWER's bishop throws bats past its room's east wall, and the
  // nearest-floor lookup ({@link roomAt}) filed those in the first room, where
  // they were out of the fight for good.
  const inside = lvl.rooms.findIndex(
    (r) => at.x >= r.left && at.x < r.right && at.y >= r.top && at.y < r.bottom,
  );
  const room = inside >= 0 ? inside : lvl.spawned.findIndex((pool) => pool.includes(owner));
  if (room < 0) return;
  const pool = lvl.spawned[room];
  // the creator's own cap, counted the way it counts: the count word of the
  // class's one object list (`[0x46ecc4]+4`), which holds every one of the
  // class in the level and not only this room's
  const alive = lvl.spawned.reduce(
    (n, r) => n + r.filter((q) => q.kind === kind).length,
    0,
  );
  if (alive > HATCH_CAP) return;
  if (!everyAnim(foe).every((a) => a.cels.every((id) => lvl.sbk.byId.has(id))))
    return;
  // ...and no anchor conversion, which {@link spawnIn} has to do. A record's
  // point is the cel's anchor and this page carries a foe by its FEET; but the
  // caller here is a brain, and `e.x`/`e.y` are already feet. Converting would
  // move every summoned thing by half a body.
  pool.push({
    kind,
    x: at.x,
    y: at.y,
    facing: at.facing,
    // `0x4263af`/`0x4263b1` — AI+4 and AI+8 are the THROWER's two rect corners
    left: owner.left,
    right: owner.right,
    top: owner.top,
    bottom: owner.bottom,
    // it has no record, so the point it can be sent back to is where it was let go
    home: at.x,
    param: 0,
    // `0x4263cb` installs the flight, never the dormant cel
    asleep: undefined,
    decisions: foe.drives?.decisions,
    clock: 0,
    state: "gait",
    anim: foe.gait,
    linger: 0,
    dents: 0,
    vx: at.vx ?? 0,
    vy: 0,
    hp: foe.health,
    max: foe.health,
  });
}

/**
 * The roller, built where a keeper says and not moving yet — `0x43a790`.
 *
 * The latch is the length of this array: `[0x474868]` is set here and cleared
 * on the frame the thing is launched, so what it forbids is a second one
 * WAITING, and {@link stepRollers} drops the waiter from the count the moment
 * it rolls.
 */
export function rollerAt(x: number, y: number, vx: number): void {
  const lvl = level;
  if (!lvl) return;
  if (!lvl.sbk.byId.has(ROLLER.waits)) return;
  // `0x43a793` — one may be waiting, and it is never two
  if (rollers.some((r) => r.wait >= 0)) return;
  rollers.push({
    x,
    y,
    vx: 0,
    vy: 0,
    launch: vx,
    still: true,
    wait: ROLLER.wait,
    clock: 0,
  });
  // `0x43a82c` — through `0x40f090`, the mixer's channel 0
  sound?.effect(ROLLER.bornSound, x, y, "lead");
}

/**
 * The rollers, one engine frame each — `0x43a960`, then the mover.
 *
 * Forty-one frames of sitting on cel 1970, and then `0x43a9c4` hands the stored
 * velocity to `0x42f8b0`, which adds `-480/7` rounded away from zero — sixty-nine
 * — to `obj+0xc` once. From the first frame to the last it is in the same mover
 * as everything else ({@link looseStep}): no `0x42f850`, so the allocator's
 * weight of ten brings it down onto the floor whatever height it was built at,
 * and `0x43a7c8`'s drag of a tenth comes off every frame it stands. So it
 * leaves fast and slows — about six hundred pixels before `0x43a986` stops
 * counting it as a blow, which is the six hundred it was built away at.
 */
export function stepRollers(): void {
  for (const r of rollers) {
    if (r.wait >= 0) {
      // `0x43a99f` — the countdown, and the launch is the frame it goes under
      r.wait -= 1;
      if (r.wait < 0) {
        r.vx += roundAway(r.launch / ROLLER.divisor);
        sound?.effect(ROLLER.sound, r.x, r.y);
      }
    } else r.clock += 1;
    r.still = looseStep(r, {
      foot: celFoot(rollerCel(r)),
      bounce: LOOSE_BORN.bounce,
      drag: Math.trunc(ROLLER.friction * 8192),
      weight: LOOSE_BORN.weight,
    }).still;
  }
  /**
   * ...and nothing in `0x43a960` removes a roller that has merely stopped.
   *
   * State 3 is the only path that answers 1, and that is the one a BLOW puts it
   * in. A roller that slides to a halt is left lying there as scenery with a
   * strength of zero — which is honest, and would also be a slow leak across a
   * long level, so the page adds the guard it adds to every other free object:
   * out of the room's own span and it is gone.
   */
  const span = p.room ? roomSpan(p.room) : null;
  if (span)
    rollers = rollers.filter((r) => r.x >= span.lo && r.x <= span.hi);
}

/**
 * cel 1970 while it waits, and the two of {@link ROLLER.rolls} once it rolls —
 * which `0x43a9f1` puts back on each time they end only while it is not still,
 * so a roller that has stopped keeps the last one.
 */
export function rollerCel(r: RollerBody): number {
  if (r.wait >= 0) return ROLLER.waits;
  const c = ROLLER.rolls;
  const i = Math.floor(r.clock / c.hold);
  if (r.still && i >= c.cels.length) return c.cels[c.cels.length - 1];
  return c.cels[i % c.cels.length];
}

/** what a roller is worth this frame — `0x43a993`, and `0x43aa34` takes it away */
export function rollerBlow(r: Roller): number {
  return r.wait < 0 && Math.abs(r.vx) > ROLLER.fastBlow ? ROLLER.strength : 0;
}

/**
 * How far below its own launch a cast may fall before this page takes it.
 *
 * Not the disc's, and it is the page's own guard. `0x40bbd0` answers `0x7d00`
 * — a floor nothing reaches — off the band of a floorless room, and the region
 * edges (`0x40ba30`) that would hold a thing inside its room are not stepped
 * here; either way what is out there never stands again. A screen and a half
 * is past anything a room can be.
 */
export const FALLS_FOREVER = 1200;

/**
 * Put one in the air — {@link BrainCtx.cast}, called where a class calls its own
 * spawner.
 *
 * The three numbers the spawners share are the three every one of them writes
 * by hand: the thrower's POINT (not its feet), a step along the facing, and a
 * lift. `0x418433`/`0x418440`/`0x41843b` are the spitter's, and the others are
 * the same three instructions with their own constants.
 */
export function spawnCast(e: Enemy, kit: CastKit, aim?: Aim): void {
  const lvl = level;
  if (!lvl) return;
  const at = foeAnchor(e, lvl);
  if (!at) return;
  // the anchor, which is what `obj+6` is — a gob leaves the mouth, not the feet
  castAt(e.x, at.y, e.facing, kit, aim);
}

/**
 * ...and the same from a point rather than from a creature.
 *
 * Not every spawner is called by a class with a {@link Brain}: `0x41c330` is
 * called on one of Boggs' MACHINES, which is an object this page keeps as a
 * fixture rather than as an enemy. The three numbers are the same three.
 */
export function castAt(
  x: number,
  y: number,
  facing: number,
  kit: CastKit,
  aim?: Aim,
): void {
  if (!level) return;
  const bornX = x + facing * kit.ahead + (kit.offX ?? 0);
  const bornY = y - kit.lift;
  casts.push({
    kit,
    x: bornX,
    y: bornY,
    // an aim is already signed and already in the executable's own units, so
    // the facing has had its say before it got here — see {@link Aim}
    vx: aim ? aim.vx : facing * kit.speed,
    // up-positive in the kit, and this page's y grows downward
    vy: -(aim ? aim.rise : (kit.rise ?? 0)),
    facing,
    clock: 0,
    bornX,
    bornY,
    fromX: x,
    fromY: y,
    // a kit with no arming rule is dangerous from the frame it leaves
    armed: kit.arm === undefined,
    spent: false,
  });
}

/** the cel a cast is showing — the last one holds, as a finished script does */
export function castCel(c: Cast): number {
  // ...and one that has landed is playing its own impact and nothing else
  const smash = c.kit.impact;
  if (smash && c.landed !== undefined) {
    const i = Math.min(smash.cels.length - 1, Math.floor(c.landed / Math.max(1, smash.hold)));
    return smash.cels[i];
  }
  // ...and a bounce is a script install too: `0x45566e` puts the burst on and
  // `0x4556a0` puts the flight back, so it plays OVER a thing still in motion
  const burst = c.kit.burst;
  if (burst && c.bounced !== undefined) {
    const i = Math.min(burst.cels.length - 1, Math.floor(c.bounced / Math.max(1, burst.hold)));
    return burst.cels[i];
  }
  // an armed one is its own cel and nothing else: the arming IS a script
  // install, so there is no flight cycle left to be part way through
  if (c.kit.arm && c.armed) return c.kit.arm.cel;
  // the far leg of a throw that comes back loops its own two cels
  const out = c.kit.returns?.out;
  if (out && c.out) return out.cels[Math.floor(c.clock / Math.max(1, out.hold)) % out.cels.length];
  // ...and the way back is the launch and the flight again, from the turn
  return flightCel(c.kit, c.back ?? c.clock);
}

/** the launch, then the flight — looped, or once and then its own loop */
function flightCel(kit: CastKit, clock: number): number {
  const hold = Math.max(1, kit.hold);
  const i = Math.floor(clock / hold);
  if (i < kit.cels.length) return kit.cels[i];
  // the launch has run out: either the flight takes over and loops, or the last
  // cel holds, which is what a finished script does with nobody to reinstall it
  const then = kit.then;
  if (!then) return kit.cels[kit.cels.length - 1];
  const since = clock - kit.cels.length * hold;
  const j = Math.floor(since / Math.max(1, then.hold));
  const loop = kit.thenLoop;
  if (!loop) return then.cels[j % then.cels.length];
  if (j < then.cels.length) return then.cels[j];
  const after = since - then.cels.length * Math.max(1, then.hold);
  return loop.cels[Math.floor(after / Math.max(1, loop.hold)) % loop.cels.length];
}

/**
 * The stride the cel showing THIS frame carries, already divided.
 *
 * Every frame the cel is up spends it: `0x45d1a3` hands the current frame's
 * `dx` to `0x42f8b0` on each engine frame, held frames included, and a script
 * that has run out and holds its last cel goes on adding that cel's — which is
 * how Boggs' throw (`0x46e0b8`, dx 50 over 7) keeps gathering speed.
 */
export function castStride(c: Cast): number {
  const hold = Math.max(1, c.kit.hold);
  const div = c.kit.divisor ?? 1;
  const i = Math.floor(c.clock / hold);
  const then = c.kit.then;
  if (i < c.kit.cels.length || !then) {
    const dx = c.kit.strides?.[Math.min(i, c.kit.cels.length - 1)] ?? 0;
    return dx ? roundAway(dx / div) : 0;
  }
  if (!then.strides) return 0;
  const hold2 = Math.max(1, then.hold);
  const since = c.clock - c.kit.cels.length * hold;
  const j = Math.floor(since / hold2) % then.cels.length;
  const dx = then.strides[j] ?? 0;
  return dx ? roundAway(dx / div) : 0;
}

/** what it would hit for — zero until it arms, which is the slug's whole design */
export function castBlow(c: Cast): number {
  if (!c.armed) return 0;
  // `0x43c866` — `obj+0x2a` set, and the strength is held at nothing
  if (c.struck) return 0;
  // ...and the one whose flight is a dud is worth nothing until it bursts —
  // `0x452ec0` is where the hundred and one is written, and it is the burst's
  // own state that writes it. See {@link CastKit.onImpact}.
  if (c.kit.onImpact && c.landed === undefined) return 0;
  // ...and the ones that bounce are worth nothing once they have slowed down —
  // `0x4556d3`, which picks between `obj+0x1a = 0x64` and `obj+0x1a = 0`
  const fast = c.kit.fastBlow;
  if (fast !== undefined && Math.abs(c.vx) < fast && Math.abs(c.vy) < fast) return 0;
  return c.kit.blow;
}

/**
 * ...and a CODE landing on one — the same hit loop run at a cast instead of at
 * a creature, for the two classes that have anything to say about it.
 *
 * A creature goes to {@link strikeFoe} and reads its −9 out of {@link
 * Foe.burns}. A cast has no class module, no health and no reaction table, so
 * what answers for it is the handler its own kit carries — `obj+0x12`, which
 * `0x45554f` installs on the fireball and `0x452c83` on MOLITOV's shot. See
 * {@link CastKit.onCode}.
 *
 * `0x4303b3` comes first: a victim whose current cel has no body box is passed
 * over before its handler is looked at. Every fireball cel carries one; of
 * MOLITOV's shot only the flight does, so a shot that is already bursting is
 * handed nothing.
 *
 * The context is built per blow rather than shared the way `BRAIN_CTX` is,
 * because a hit handler is called once and about one thing: it needs no name
 * for the cast it is already holding.
 */
export function strikeCast(c: Cast, code: number): boolean {
  const own = c.kit.onCode;
  // no handler here: the blow is read by nobody and the thing carries on — the
  // executable's own answer for everything in the air but the fireball and
  // MOLITOV's shot
  if (!own) return false;
  if (!level || !celRec(level.sbk, castCel(c))?.body) return false;
  const k: CastCtx = {
    burn: (how) => burnCast(c, how ?? {}),
    burst: () => burstCast(c),
  };
  return own(c, code, k);
}

/**
 * ...and one as a VICTIM, which is the only thing that ever asks a cast for a
 * box other than the strike box it hits WITH.
 *
 * The body box if its art carries one, mirrored by the facing the way
 * {@link hurtBox} mirrors a creature's; otherwise the bitmap where
 * {@link drawLevelCel} puts it, which is the rect `0x42f9f0` builds.
 */
export function castHurtBox(
  c: Cast,
  art: SbkCel,
): { top: number; left: number; bottom: number; right: number } {
  const b =
    c.facing < 0 && art.body
      ? { ...art.body, x0: -art.body.x1, x1: -art.body.x0 }
      : art.body;
  if (b)
    return {
      left: c.x + b.x0,
      right: c.x + b.x1,
      top: c.y + b.y0,
      bottom: c.y + b.y1,
    };
  const left = c.facing < 0 ? c.x - (art.width - art.posX) : c.x - art.posX;
  return {
    left,
    right: left + art.width,
    top: c.y - art.posY,
    bottom: c.y - art.posY + art.height,
  };
}

/**
 * A free object as the engine's mover sees it: a point and the velocity it
 * spends on it, in whole pixels an engine frame.
 */
export interface Loose {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

/**
 * The four words of a free object that `0x42fd80` reads, each already in the
 * engine's own units.
 */
export interface LooseBuild {
  /**
   * How far under its point it meets the floor: the cel word +0x26 plus
   * `obj+0x10` (`0x42fdcf`/`0x42fdd7`) — the CURRENT cel's drawn extent below
   * its anchor, the way {@link baseOf} measures a creature.
   */
  foot: number;
  /**
   * `obj+0x20`, the word. The allocator writes `0x800` (`0x42f5c0`) — a quarter
   * kept the same way, which is a stop — and `0x42f7f0(obj, f)` writes
   * `f × −8192.0` (`0x46a10c`), which is where a bounce's flip lives.
   */
  bounce: number;
  /**
   * `obj+0x1e`, the word: the allocator's `0x1666` (`0x42f5ba`), or
   * `0x42f7a0(obj, f)`'s `f × 8192.0` (`0x46a108`). It is the share TAKEN OFF —
   * see {@link dragged}.
   */
  drag: number;
  /** `obj+0x24`: the allocator's ten (`0x42f5ca`), or `0x42f850`'s `f × 10` */
  weight: number;
  /**
   * `obj+0x34` — does the platform pass (`0x42fe4a`) run for it. The allocator
   * writes zero (`0x42f5a7`), and of the free objects only MOLITOV's shot turns
   * it on (`0x452c96`).
   */
  ledges?: boolean;
}

/** `0x42f5ba` / `0x42f5c0` / `0x42f5ca` — what every object is born with */
export const LOOSE_BORN = { bounce: 0x800, drag: DRAG, weight: 10 } as const;

/** a velocity through `obj+0x20` — `0x42ff83`'s `imul` and `sar 13`, toward zero */
export function restitute(v: number, word: number): number {
  return Math.trunc((v * word) / 8192);
}

/**
 * The region floor under x, the way `0x40bbd0` answers it.
 *
 * Past either end of a floor it answers the end sample rather than nothing
 * (`0x40bc34`, `0x40bc4c`); a region with no floor of its own is flat at its top
 * plus the drop, fifty in from each end (`0x40bc7d`), and `0x7d00` outside that
 * (`0x40bcc5`) — a floor nothing ever reaches, which is null here.
 */
export function looseFloor(x: number): number | null {
  const room = p.room;
  if (!room) return null;
  const xi = Math.round(x);
  const g = room.ground;
  if (!g)
    return xi >= room.left + 50 && xi < room.right - 50
      ? room.top + room.floorDrop
      : null;
  if (!g.ys.length) return null;
  return g.ys[Math.max(0, Math.min(g.ys.length - 1, xi - g.x0))];
}

/**
 * One engine frame of `0x42fd80` for a free object — a cast, a can, a board.
 *
 * The same mover every object in the game runs through, in its own order:
 *
 * - the velocity into the point, whole (`0x42fd9e`/`0x42fda7`);
 * - the floor under the NEW point, less the foot (`0x42fde7`), and the ledges
 *   above it for a thing that stands on them (`0x42fe76`: `x0 ≤ x ≤ x1`, the
 *   ledge's bottom at or under the foot as it was, the highest top wins);
 * - a floor more than fifty above the foot is a WALL (`0x42fedc`): the old point
 *   back, a step of the old `vx` further back, `vx` through `obj+0x20`, `vy`
 *   zeroed, the collision word set and the thing counted as standing;
 * - within eight of the floor, or anywhere under it, it is ON it
 *   (`0x42ff4c`): put on it, and `vy` zeroed inside ±2 (`0x42ff6f`) or sent
 *   through `obj+0x20` with the collision word set;
 * - standing, `obj+0x1e` comes off `vx` (`0x4302c0`); airborne, `obj+0x24`
 *   goes on `vy` for the next frame (`0x430327`) — so the weight is spent AFTER
 *   the step, and never on a frame it lands.
 *
 * Returns `obj+0x2e`, `obj+0x2c` and `obj+0x30`, which are what the classes'
 * thinks read.
 * The region's own edges (`0x40ba30`) and the obstacle pass (`0x430146`, which
 * only the cop's slug and MOLITOV's shot turn on) are not stepped here.
 */
export function looseStep(
  o: Loose,
  b: LooseBuild,
): { down: boolean; struck: boolean; still: boolean } {
  let x = o.x + o.vx;
  let y = o.y + o.vy;
  let down = false;
  let struck = false;
  const oldFoot = o.y + b.foot;
  const floorAt = (at: number): { y: number; ledge: boolean } | null => {
    const g = looseFloor(at);
    let best = g === null ? null : g - b.foot;
    let ledge = false;
    if (b.ledges)
      for (const room of level?.solids ?? [])
        for (const e of room.platforms) {
          if (at < e.left || at > e.right || e.bottom < oldFoot) continue;
          const top = e.top - b.foot;
          if (best === null || top < best) {
            best = top;
            ledge = true;
          }
        }
    return best === null ? null : { y: best, ledge };
  };
  let floor = floorAt(x);
  if (floor && !floor.ledge && floor.y + 50 < y) {
    down = true;
    struck = true;
    y = o.y;
    x = o.x - o.vx;
    o.vx = restitute(o.vx, b.bounce);
    o.vy = 0;
    floor = floorAt(x);
  }
  if (floor && floor.y - 8 <= y) {
    down = true;
    y = floor.y;
    if (Math.abs(o.vy) <= 2) o.vy = 0;
    else {
      o.vy = restitute(o.vy, b.bounce);
      struck = true;
    }
  }
  o.x = x;
  o.y = y;
  // `0x4302c7` — a drag of zero or less is not spent at all
  if (down && b.drag > 0) o.vx = dragged(o.vx, b.drag);
  // `0x4302fd` — `obj+0x30`, still in both axes, read before the weight goes on
  const still = o.vx === 0 && o.vy === 0;
  if (!down) o.vy += b.weight;
  return { down, struck, still };
}

/** a cel's word +0x26 in this page's terms — its drawn extent below the anchor */
export function celFoot(id: number): number {
  const c = level ? celRec(level.sbk, id) : undefined;
  return c ? c.height - c.posY : 0;
}

/**
 * The casts, one engine frame at a time.
 *
 * Each is a free object in the engine's own mover — {@link looseStep}, with its
 * current cel's foot, its class's restitution and drag where the kit carries
 * them, and its class's own weight — and what ends one is its class's think:
 * the standing word `obj+0x2e` for the classes that test it ({@link
 * CAST_LANDS}), coming to rest for the two that do instead, and the reach, the
 * life, the range or the passing that each kit carries. The player is the one
 * collision spent elsewhere, in {@link takeHits}.
 */
export function stepCasts(): void {
  const lvl = level;
  if (!lvl) return;
  for (const c of casts) {
    // ...a landed one is only playing itself out
    if (c.landed !== undefined) {
      c.landed += 1;
      const smash = c.kit.impact;
      // ...for its own count where it keeps one (`0x43cafb`), else its impact
      const lie = c.kit.lieFor;
      if (lie !== undefined ? c.landed > lie + 1 : !smash || c.landed >= smash.cels.length * Math.max(1, smash.hold))
        c.spent = true;
      continue;
    }
    // ...a bounce's burst runs on its own clock and hands the flight back
    if (c.bounced !== undefined) {
      c.bounced += 1;
      const burst = c.kit.burst;
      if (!burst || c.bounced >= burst.cels.length * Math.max(1, burst.hold)) c.bounced = undefined;
    }
    // ...the one that steers, in its think and so before anything moves it:
    // `0x4422b2` leans into the facing and reaches for a point above the
    // player, both deltas through the class's divisor
    const home = c.kit.home;
    if (home) {
      c.vx += roundAway((c.facing * home.along) / home.divisor);
      c.vy += roundAway(Math.trunc((p.y - c.y - home.lead) / home.drop) / home.divisor);
    }
    // ...and the one class that bounds what it may become — `0x452d4d`, at the
    // top of its think
    if (c.kit.capFall !== undefined)
      c.vy = Math.max(-c.kit.capFall, Math.min(c.kit.capFall, c.vy));
    // ...the stride this frame's cel carries, if its script carries any.
    // `0x42f8b0` adds `dx / obj+0xe` to the velocity as each frame comes round,
    // rounded away from zero, and what it adds stays added
    const stride = castStride(c);
    if (stride) c.vx += c.facing * stride;
    c.clock += 1;
    if (c.back !== undefined) c.back += 1;
    // the throw that comes back — {@link CastKit.returns}: the fork as the
    // launch cel ends (`0x43c917`), and the turn once it is far enough out
    const turn = c.kit.returns;
    if (turn) {
      if (c.back === undefined && !c.out && c.clock === c.kit.cels.length * Math.max(1, c.kit.hold))
        c.out = roll(turn.of) < turn.odds;
      if (c.out && Math.abs(c.fromX - c.x) > turn.far) {
        c.out = false;
        c.back = 0;
        c.facing = -c.facing;
        c.vy = 0;
        c.y = c.fromY + turn.drop;
        // `0x43c9ca`/`0x43c9cf` zero both speeds and `0x43c9e5` puts `0x4748c8`
        // on — and the think runs before the frame's script step (`0x42fc10`
        // after `0x430f10`), whose `0x45d0f0` spends the new tag's first frame
        // at once: its `dx 80` is read off the frame index the step ENTERS with
        // (`0x45d105`) and handed to `0x42f8b0` (`0x45d1a3`) that same frame,
        // before the move. So the zero never survives a frame, and it moves
        // back by eighty on the frame it turns
        c.vx = c.facing * turn.speed;
      }
    }
    // the whoosh, every frame it is in the air — see {@link CastKit.hum}
    const hum = c.kit.hum;
    if (hum !== undefined) {
      sound?.effect(hum, c.x, c.y);
      sound?.loop(hum, true);
    }
    // ...and the mover, whole pixels on the ENGINE frame, like the bolts — see
    // {@link CastKit.speed}
    const moved = looseStep(c, {
      foot: celFoot(castCel(c)),
      bounce:
        c.kit.bounce !== undefined ? Math.trunc(c.kit.bounce * -8192) : LOOSE_BORN.bounce,
      drag: c.kit.friction !== undefined ? Math.trunc(c.kit.friction * 8192) : LOOSE_BORN.drag,
      // absent is weightless: every class without one calls `0x42f850(obj, 0)`
      weight: c.kit.pull ?? 0,
      ledges: c.kit.onImpact === true,
    });
    const dx = Math.abs(c.x - p.x);
    // the class's own end, whichever of the two it keeps
    if (c.kit.reach !== undefined && dx > c.kit.reach) c.spent = true;
    if (c.kit.life !== undefined && c.clock > c.kit.life) c.spent = true;
    if (c.kit.range !== undefined && Math.abs(c.x - c.bornX) > c.kit.range) c.spent = true;
    // ...or it has gone by: `0x442306`/`0x44231a`, the homing shot's own end
    if (c.kit.past && ((c.vx < 0 && c.x < p.x) || (c.vx > 0 && c.x > p.x))) c.spent = true;
    // ...and its own arming, which never goes back
    if (c.kit.arm && !c.armed && dx < c.kit.arm.within) c.armed = true;
    // ...and the page's own guard: off the band of a floorless room `0x40bbd0`
    // answers `0x7d00`, a floor nothing reaches, and a thing out there would
    // fall for the rest of the level
    if (c.y - c.bornY > FALLS_FOREVER) c.spent = true;
    // a whoosh whose thing is gone some other way than landing: this page's
    // own ends, above — the engine's throw only ends by landing — let it go
    if (hum !== undefined && c.spent) sound?.loop(hum, false);
    if (!moved.down) continue;
    if (c.kit.bounce !== undefined) bounceCast(c);
    // `0x452e00` / `0x452e79` — MOLITOV's shot goes off once it is standing
    // still, not the frame it first meets the floor
    else if (c.kit.onImpact) {
      if (moved.still) landCast(c);
    } else if (CAST_LANDS.has(c.kit)) landCast(c);
  }
  chainCasts();
  casts = casts.filter((c) => !c.spent);
}

/**
 * The casts whose own think ends them on the mover's standing word `obj+0x2e`
 * — which the wall case sets as well as the floor (`0x42fef3`).
 *
 * The bone and Igor's throw (`0x41fd54`), the cop's slug (`0x413deb`), the
 * bishop's bolt (`0x426dc1`), Boggs' throw (`0x41aa36`), the hardcore's
 * (`0x43c8c0`) and the tube's shards (`0x41902c`). The eyeball's glob tests
 * `obj+0x30` instead (`0x43dc3d`), but its drag is a whole 1.0 (`0x43db79`), so
 * the frame it stands is the frame it is still.
 *
 * And the rest do NOT: the zombie's gob (`0x4201e0`), the wraith's beam
 * (`0x424620`), the tube's breath (`0x41911a`) and Ghengis' blast end on their
 * scripts alone, and Kragg's shot only on landing a blow (`0x442357`) or going
 * by — so the floor does not end any of those.
 */
export const CAST_LANDS: ReadonlySet<CastKit> = new Set<CastKit>([
  SKEL_BONE,
  IGOR_THROW,
  COP_SLUG,
  VPRIEST_BOLT,
  BOGGS_THROW,
  HARDCORE_THROW,
  HARDCORE_THROW_LOW,
  ...EYEBALL_GLOBS,
  ...TUBE_SHARDS,
]);

/**
 * `0x430367` run with a CAST as the hitter and the other casts as victims —
 * which is how one of MOLITOV's shots going off sets off the next.
 *
 * `0x452ec0` gives a burst the strength `0x65`, and `0x430443` is why it
 * matters: every other strength is zeroed after the first victim that answers
 * 1, and `0x65` alone stays on the hitter, so a burst hits everything its box
 * covers for as long as its cels carry one (7000..7002). What reads it is
 * `0x452f8d`, the shot's own handler, through {@link strikeCast} — which also
 * makes `0x4303b3`'s body-box test, so a shot already bursting is passed over.
 *
 * Only `0x65` goes round here. The other casts' blows are the player's
 * business in {@link takeHits}, and no other cast on this page is worth `0x65`.
 */
export function chainCasts(): void {
  const lvl = level;
  if (!lvl) return;
  for (const a of casts) {
    if (a.spent || castBlow(a) !== CHAIN_BLOW) continue;
    const cel = celRec(lvl.sbk, castCel(a));
    const box = cel && strikeOf(cel, a.x, a.y, a.facing);
    if (!box) continue;
    for (const b of casts) {
      if (b === a || b.spent || !b.kit.onCode) continue;
      const art = celRec(lvl.sbk, castCel(b));
      if (!art) continue;
      const hurt = castHurtBox(b, art);
      if (!(
        box.right > hurt.left &&
        box.left < hurt.right &&
        box.bottom > hurt.top &&
        box.top < hurt.bottom
      ))
        continue;
      const was = b.landed;
      strikeCast(b, CHAIN_BLOW);
      // for the status line: a burst this one did not start on its own
      if (was === undefined && b.landed !== undefined) b.setOff = true;
    }
  }
}

/** `0x430443`'s `cmp word ptr [esi+0x1a], 0x65` — the strength a hit leaves standing */
export const CHAIN_BLOW = 0x65;

/**
 * It is standing and it is one of the ones that comes back up.
 *
 * {@link looseStep} has already done the mover's half — put it on the floor,
 * sent `vy` back through its negative `obj+0x20` and taken its drag off `vx`.
 * What is left is the class's: `0x45566e` puts the burst on every frame it
 * stands in flight, and `0x4555e9` removes it once it is standing with no `vx`
 * and a `vy` inside its rest.
 */
export function bounceCast(c: Cast): void {
  c.bounced = 0;
  const rest = c.kit.rest;
  if (rest !== undefined && c.vx === 0 && Math.abs(c.vy) <= rest) landCast(c);
}

/**
 * It has met something — the ground here, or the player in {@link takeHits}.
 *
 * `0x41fd7b` is the shape: a collision word set, and the class installs its
 * impact script at `tag + 1` rather than looping its flight. A class with none
 * of that is simply gone, which is what the four flat ones do.
 */
export function landCast(c: Cast): void {
  // `0x43c8e1`..`0x43c8f9` — a whoosh lets its loop go and falls silent as it lands
  if (c.kit.hum !== undefined) {
    sound?.loop(c.kit.hum, false);
    sound?.mute(c.kit.hum);
  }
  if (!c.kit.impact) {
    c.spent = true;
    return;
  }
  burstCast(c);
}

/**
 * Put its impact on, from the first frame — `0x45d090`, which rewinds whatever
 * was playing — and announce it the way its class does.
 *
 * The one path for all three things that set an impact off: the ground, the
 * player in {@link takeHits}, and a blow its own handler answers with a burst
 * ({@link CastCtx.burst}). {@link CastKit.bang} is MOLITOV's shot's sound and
 * `0x452ef0`'s flash and shake; the flash is the closest of its three bands,
 * both axes strictly inside, and the shake falls off through all three.
 */
export function burstCast(c: Cast): void {
  c.landed = 0;
  c.vx = 0;
  c.vy = 0;
  const bang = c.kit.bang;
  if (!bang) return;
  // `0x452e19`, `0x452e99`, `0x452fa5`, `0x452fea` — all four `0x40f090`, the
  // mixer's channel 0
  sound?.effect(bang.sound, c.x, c.y, "lead");
  const dx = Math.abs(p.x - c.x);
  const dy = Math.abs(p.y - c.y);
  const near = dx < bang.near.x && dy < bang.near.y;
  if (near) flashColour = bang.flash;
  // `0x452f38` / `0x452f52` / `0x452f6c` — the closest band that holds it
  if (bang.shakes) {
    if (near) shake(3);
    else if (dx < 0x2ee && dy < 0x12c) shake(2);
    else if (dx < 0x4b0 && dy < 0x1f4) shake(1);
  }
}

/**
 * The wake — `0x434200(playerPoint, AI+6)` every frame while asleep: one cel,
 * no motion, until the player's point is inside the record's rect. Returns true
 * while it is still asleep and has taken the frame.
 */
export function wakeFoe(e: Enemy, foe: Foe): boolean {
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

/**
 * The fight — `0x45efd0`'s tracker and state 1's band dispatch, for the
 * twenty-six classes that have one. See {@link file://./fights.ts} for the
 * mechanism and where each number comes from.
 *
 * Returns true when it has taken the frame; false leaves the ordinary gait block
 * to move it, which is how a closing walk travels by its own `dx`.
 *
 * **Nothing here takes a single point of health off the player.** The attacks
 * choose themselves, travel and land where the scripts say, and the engine's own
 * damage word `0x4ac3d0` is not reached from any of it.
 */
/**
 * Does this class's own walk carry a stride?
 *
 * LAB's `initarm` is why it is asked. Its `0x46cf10` tag 0 is seven cels of an
 * arm reaching out of a wall and back, with no `dx` on any of them, and the
 * class's data does hold a script that travels — but the thing the level places
 * never installs it. Giving it one had ten arms crawling across the floor, and
 * letting its ATTACK's own `dx 200, dy -200` move it threw each one off the wall
 * and down the level. So a class the book reads as standing still keeps standing
 * still, in the fight as much as out of it.
 */
export function travels(foe: Foe): boolean {
  return foe.gait.dx?.some((n) => n !== 0) ?? false;
}

export function stepFight(e: Enemy, foe: Foe, run: number): boolean {
  const f = level?.fights[e.kind];
  const brain = BRAINS[e.kind];
  /**
   * A band table is what the SHARED reading needs; a class with a machine of
   * its own carries its own bands inside it. `initkragg` is the case that
   * matters — it has no `fights.ts` entry at all, because its creator hands the
   * tracker a list of its own from a global rather than per record.
   */
  if (!f && !brain) return false;
  if (e.state !== "gait" || e.asleep || foe.rooted) return false;
  if (!brain && (foe.haunts || foe.preaches || foe.drives || foe.chases))
    return false;
  /**
   * ...and a class whose own walk carries no stride does not close on anybody.
   *
   * LAB's `initarm` is the case and it is the one the regression caught: ten
   * arms out of a wall, whose `0x46cf10` tag 0 is seven cels of reaching and
   * nothing else. The class HAS a script with a stride in its data, but the
   * thing the level places does not use it, and giving it one had ten arms
   * crawling across the floor. If {@link Foe.gait} does not travel, neither does
   * this — it stands where it is and swings when you are inside the last band.
   */
  const rooted = !travels(foe);
  /**
   * ...and a keeper with a lever still in its patch goes for the lever.
   *
   * SERVICE is the level built on it — `0x438200` finds the first unlit switch
   * inside the class's own rect and the walk to it IS the patrol's six cels — and
   * the shared brain would otherwise take the same class over and march it at the
   * player instead, which leaves level six permanently dry. With nothing left to
   * throw, it fights like everything else.
   */
  if (foe.lever && leverFor(e, foe.lever.dir)) return false;
  // `0x402f60` is one test — that the player's own state is under `0x1a` — and
  // dying is the one this page has that reaches it. A class with a machine of
  // its own answers it in a state instead — the punk's kind 6
  if (!brain && p.act === "dying") {
    e.fighting = false;
    e.swing = false;
    return false;
  }
  /**
   * `0x44e5fb` — state 0, and the ONLY thing that ends the patrol is
   * `0x434200(player.point, AI+8)`: the player's own point inside the four
   * words the creator copied out of this `init` record. Not a sight line, not a
   * radius, and not the room.
   *
   * The engine never walks back out of state 1 on this test — it breaks off
   * through the class's own decision budget instead (`AI+4`, seeded three at
   * `0x450ad1`) — so leaving the rect putting it back on the patrol is this
   * page's, and it is what keeps a level walkable: step out of somebody's patch
   * and they go back to pacing it.
   */
  const anchor = p.y - p.feet;
  // `0x434200` is half-open: left <= x < right, top <= y < bottom
  const inside =
    p.x >= e.left && p.x < e.right && anchor >= e.top && anchor < e.bottom;
  /**
   * ...and from here a class with a machine of its own runs the whole of it,
   * the patrol included: state 0 is what a thing outside the rect is in, and
   * the rect is what moves it into state 1 — and nothing moves it back. No
   * think function installs its state-0 script again once it has left it (the
   * dog's `0x454c13`, the rat's `0x44e010`, wbooly's `0x455940` and every
   * other), so stepping out of the rect does not send a brain home: a dog
   * that has seen you keeps coming.
   */
  if (brain) {
    if (inside && !e.fighting) {
      e.fighting = true;
      e.swing = false;
    }
    /**
     * ...and it thinks once an ENGINE FRAME, not once a tick.
     *
     * A class's think function is called from the frame dispatcher, fifteen
     * times a second; this page ticks at sixty. Every state that ACCUMULATES is
     * wrong by a factor of four otherwise, and kragg is what showed it: kind 5
     * steers by adding `away(dy)` to its velocity every call (`0x440ff1`), so
     * four calls a frame put four times the correction in and the boss dived
     * through the floor and kept going. The same factor was quietly spending
     * `AI+2` beats and `AI+4` decision budgets four times too fast in every
     * other class.
     *
     * Between frames the thing still plays and still moves — that is the page's
     * job below, not the machine's.
     */
    if (Math.floor(e.clock) === Math.floor(e.clock - TICK_SCALE)) return false;
    return brain(e, foe, run, BRAIN_CTX);
  }
  // ...and past here is the shared reading, which is band table or nothing
  if (!f) return false;
  if (!inside) {
    if (!e.fighting) return false;
    e.fighting = false;
    e.swing = false;
    e.anim = foe.gait;
    e.clock = 0;
    // and walk home: the fight may have carried it clear of its own territory,
    // which the patrol's clamp below would otherwise snap it back through
    if (e.x < e.left) e.facing = 1;
    else if (e.x > e.right) e.facing = -1;
    return false;
  }
  if (!e.fighting) {
    e.fighting = true;
    e.swing = false;
    e.clock = 0;
  }
  // The block below is the shared reading — notice, face, close, swing — and it
  // stands for every class whose own state machine has not been read yet
  // an attack plays to its end before anything else is asked — `0x42afc4`'s own
  // rule for every state in the game, `obj+0x46`, the animation-ended word
  if (e.swing) {
    if (e.clock < run) return false;
    e.swing = false;
  }
  /**
   * The tracker, and its forward distance is measured through the class's OWN
   * FACING: `0x45efe4` takes `player.x - self.x` and `0x45eff3` negates it when
   * `obj+0x28` is set. A negative answer means the player is behind.
   */
  const forward = (p.x - e.x) * e.facing;
  /**
   * ...and the band, which is an index into the class's own descending table:
   * `0x45f050` walks it while the entry is still at or past the distance, so 0
   * is beyond the first threshold and `bands.length` is inside the last.
   * `0x45f042` answers -1 outright when the player is behind.
   */
  let band = -1;
  if (forward >= 0) {
    band = 0;
    while (band < f.bands.length && f.bands[band] >= forward) band += 1;
  }
  // `0x44e73c`: turn, and that is the whole of the frame — the band dispatch is
  // an unsigned `cmp eax, 4; ja`, and -1 falls straight through it
  if (band < 0) {
    e.facing = -e.facing;
    return true;
  }
  /**
   * The innermost band swings and the rest close.
   *
   * Which is what `initwerea`, `initdog`, `initwerec`, `initigor` and `initbat`
   * do at their last band, read one at a time out of their band branches. It is
   * not universal: `initvpriest` throws from its OUTERMOST band, because the
   * thing it throws has the distance to cover, and this page does not yet tell a
   * caster from a puncher. See {@link file://./fights.ts}.
   */
  /**
   * ...and nothing starts a swing while the PLAYER is swinging.
   *
   * `out+6` of the tracker is that question — `0x45f077` looks up the player's
   * current cel and answers 1 when its strike box is not degenerate — and the
   * classes read it in two ways. The dog will not commit while it is set
   * (`0x454e45`: `rand(30) < 3` AND `out+6` clear, or no bite), and the punk
   * turns it into a decision of its own at `0x44e7a8` — a coin flip between
   * backing off on `0x4771a0 tag 0` and stepping in on tag 1, which wants that
   * class's own two scripts and so waits for its own brain.
   *
   * The half that is the same everywhere is here: while you are mid-blow it does
   * not start one. An enemy that swung into every punch read as having no idea
   * you were there.
   */
  if (band >= f.bands.length && f.attacks.length > 0 && !playerSwinging) {
    e.anim = f.attacks[Math.floor(random() * f.attacks.length)];
    e.swing = true;
    e.clock = 0;
    return false;
  }
  e.anim = (rooted ? undefined : f.close) ?? foe.gait;
  return false;
}

/**
 * Is the player's own cel an attacking frame this tick?
 *
 * `out+6` of the tracker, and read ONCE a tick rather than once per enemy —
 * {@link strikeBox} looks the player's cel up by id and twenty enemies asking
 * separately was the single hottest thing the fight added. See {@link celRec}.
 */
export let playerSwinging = false;

export function track(e: Enemy, bands: readonly number[]): Track {
  // `0x45efe4` — `obj+8` from `obj+8`, anchor to anchor
  const ax = anchorX(e);
  const forward = (p.x - ax) * e.facing;
  let band = -1;
  if (forward >= 0) {
    band = 0;
    while (band < bands.length && bands[band] >= forward) band += 1;
  }
  // `0x45f014`: which side of the PLAYER it stands on — 1 in front, 0 behind, and
  // 2 when the player carries no velocity at all
  const still = p.vx === 0;
  const infront = p.x >= ax === p.facing < 0;
  // `0x45efe8` — and the height is anchor against anchor, `obj+6` from `obj+6`:
  // the player's is `p.y - p.feet`, the foe's is its gait cel's point above its
  // feet ({@link foeAnchor})
  const anchor = level ? foeAnchor(e, level) : null;
  return {
    forward,
    dy: p.y - p.feet - (anchor ? anchor.y : e.y),
    band,
    side: still ? 2 : infront ? 1 : 0,
  };
}

/**
 * `0x456550` — is it within sixty pixels of the bound it is walking towards?
 *
 * The engine keeps two of them in `obj+0x38` and `obj+0x3a` and picks by the
 * facing, and the classes ask before installing a walk: a punk that has run out
 * of ground does not take another step off it. The bounds are the mover's
 * ({@link measureGround}), not the record's rect — the rect is the territory
 * the think weighs the player against, and it says nothing about where a
 * ledge ends.
 */
export function atBound(e: Enemy): boolean {
  return Math.abs(anchorX(e) - ((e.facing > 0 ? e.hi : e.lo) ?? 0)) <= 60;
}

/** `0x456590` — the same, against the bound at its back */
export function atRear(e: Enemy): boolean {
  return Math.abs(anchorX(e) - ((e.facing > 0 ? e.lo : e.hi) ?? 0)) <= 60;
}

/**
 * `0x40bcd0` — where the floor under x stops being walkable, one way.
 *
 * It walks the region's floor from the point in eight-pixel samples, at most
 * 200 pixels, and stops at the first sample more than `reach` above or below
 * the one before it. Off the ends of the floor it answers the point itself on
 * the side that has run out and `0` or `0x7d00` on the other, and a region with
 * no floor is its rect, fifty pixels in from each end (`0x40bd2e`).
 */
export function floorEdge(x: number, dir: 1 | -1, reach: number): number {
  const room = p.room;
  const xi = Math.round(x);
  if (!room) return dir > 0 ? 0x7d00 : 0;
  const g = room.ground;
  if (!g) {
    const lo = room.left + 50;
    const hi = room.right - 50;
    if (xi >= hi) return dir > 0 ? xi : 0;
    if (xi < lo) return dir > 0 ? 0x7d00 : xi;
    return dir > 0 ? hi : lo;
  }
  const cx = xi - g.x0;
  if (cx < 0) return dir > 0 ? 0x7d00 : xi;
  if (cx >= g.ys.length) return dir > 0 ? xi : 0;
  const end = dir > 0 ? Math.min(cx + 200, g.ys.length) : Math.max(cx - 200, 0);
  let last = g.ys[cx];
  for (let bx = cx + 8 * dir; dir > 0 ? bx < end : bx > end; bx += 8 * dir) {
    if (Math.abs(last - g.ys[bx]) > reach) return g.x0 + bx;
    last = g.ys[bx];
  }
  return g.x0 + end;
}

/**
 * `0x42fd80`'s own measurement of the ground, `0x42fe02`…`0x42fed2`, into
 * {@link Enemy.lo} and {@link Enemy.hi} — see {@link Foe.span}.
 *
 * With `obj+0x3c` set the floor scan fills both; with `obj+0x34` set the
 * platform table is searched after it, and the highest row that spans the x
 * (both ends inclusive), reaches below the feet and tops out above the floor
 * replaces them with its own two ends — the ledge it stands on, or the one it
 * is falling onto. With neither, the two words keep what they last held.
 */
export function measureGround(e: Enemy, foe: Foe, lvl: Level): void {
  const span = foe.span;
  if (!span) return;
  // from the anchor, `obj+8`, as `0x40bcd0` is asked
  const ax = anchorX(e);
  if (span.reach > 0) {
    e.lo = floorEdge(ax, -1, span.reach);
    e.hi = floorEdge(ax, 1, span.reach);
  }
  if (!span.platforms) return;
  const feet = footOf(e, lvl, foe);
  const floor = groundAt(ax) ?? Infinity;
  let best = floor;
  for (const room of lvl.solids)
    for (const pl of room.platforms) {
      if (ax < pl.left || ax > pl.right || pl.bottom < feet) continue;
      if (pl.top >= best) continue;
      best = pl.top;
      e.lo = pl.left;
      e.hi = pl.right;
    }
}

/**
 * `0x44f020` — is this one's side of the player crowded?
 *
 * The class walks its own list, counts every member within two hundred pixels of
 * the PLAYER, adds one for each that wants the far side and subtracts one for
 * each that wants the near, and answers yes when its own side is more than three
 * ahead. `0x44e75b` then flips this one over.
 */
export function crowded(e: Enemy): boolean {
  let n = 0;
  // every member of the class list, the corpses still in it included — the
  // walk at `0x44f03c` asks nothing but the distance — and `AI+6` as the
  // creator seeds it, 0 (`0x450ad7`), for one that has not thought yet
  for (const other of spawnedHere()) {
    if (other.kind !== e.kind) continue;
    if (Math.abs(anchorX(other) - p.x) >= 200) continue;
    n += (other.side ?? 0) !== 0 ? 1 : -1;
  }
  return (e.side ?? 0) !== 0 ? n > 3 : n < -3;
}

/**
 * Everything a class's own machine is allowed to see, handed in rather than
 * reached for — see {@link file://./brains/kit.ts}.
 *
 * The player's fields are read fresh on every access, so one object can be
 * shared by every brain for the whole run of the page.
 */
export const BRAIN_CTX: BrainCtx = {
  player: {
    get x() {
      return p.x;
    },
    get y() {
      return p.y;
    },
    /** his own standing cel's height above his feet */
    get top() {
      return p.y - p.feet;
    },
    get anchor() {
      return p.y - p.feet;
    },
    get vy() {
      return p.vy / TICK_SCALE;
    },
    get swinging() {
      return playerSwinging;
    },
    get down() {
      return p.act === "dying";
    },
    get facing() {
      return p.facing;
    },
    get climbing() {
      return p.climbing;
    },
    get crouching() {
      return p.crouching;
    },
    get character() {
      return CHARACTER;
    },
    get jolted() {
      return p.act === "jolt";
    },
    get helpless() {
      return p.act !== null && HELPLESS.has(p.act);
    },
    get free() {
      return !p.hidden;
    },
  },
  ladderNear: (e) => {
    if (!level) return undefined;
    const x = anchorX(e);
    const y = BRAIN_CTX.anchorY(e);
    let best: SbkEntity | undefined;
    let far = 0x7fff;
    for (const l of level.ladders) {
      const d = Math.abs(y - l.pointY) + Math.abs(x - l.pointX);
      if (d < far) {
        far = d;
        best = l;
      }
    }
    return best && { x: best.pointX, y: best.pointY, top: best.top, bottom: best.bottom };
  },
  track,
  shake: (n) => shake(n),
  flash: (colour) => {
    flashColour = colour;
  },
  burn: (e, how) => burnFoe(e, { ...how, from: "BrainCtx.burn" }),
  spray: (e, damage) =>
    spray(e, damage, { dx: 0, dy: 0 }, level ? foeAnchor(e, level) ?? undefined : undefined),
  anchorX: (e) => anchorX(e),
  anchorY: (e) => (level ? foeAnchor(e, level)?.y : undefined) ?? e.y,
  atBound,
  atRear,
  crowded,
  roll,
  scaled,
  // `0x434630` — and it really is the integer one: the arcs it solves are whole
  // pixels in the engine and a fractional root would drift them
  root: (n) => Math.floor(Math.sqrt(Math.max(0, n))),
  say: (e, id, way) => sound?.effect(id, e.x, e.y, way),
  /**
   * `0x441519` — `0x40b660("initsprinkler", boss, 1, -1, out)`, and geometry
   * −1 is `0x40b756`: the record whose `pointY`/`pointX` is nearest in
   * MANHATTAN distance, not the one whose rect holds anything.
   */
  spill: (at, n) => spillRoaches(at, n),
  pin: (at, v) => pinPlayer(at, v),
  hide: (hidden) => {
    p.hidden = hidden;
  },
  drain: (n) => {
    if (damageOn && p.act !== "dying") takeHealth(n);
  },
  bleed: (n) => bleed(n, ownPoint()),
  pose: (mode) => posePlayer(mode),
  someIn: (e, state) =>
    spawnedHere().some((o) => o !== e && o.kind === e.kind && o.state !== "dead" && o.script === state),
  sprinkler: (e) => {
    const all = hereOf((l) => l.sprinklers);
    if (!all.length) return null;
    let best: Sprinkler | null = null;
    let by = Infinity;
    for (const q of all) {
      const d = Math.abs(q.y - e.y) + Math.abs(q.x - e.x);
      if (d < by) {
        by = d;
        best = q;
      }
    }
    return best ? { x: best.x, y: best.y } : null;
  },
  raise: (e) => raiseSprinkler(e),
  count: (kind) => spawnedHere().filter((q) => q.kind === kind && q.state !== "dead").length,
  every: (kind) =>
    (level?.spawned ?? []).flat().filter((q) => q.kind === kind && q.state !== "dead"),
  // `0x426450` — Manhattan, `|dx| + |dy|` against the player's point, and a
  // candidate has to come in strictly under the best so far (`0x426499`)
  nearest: (kind, within) => {
    let best: Enemy | null = null;
    let by = within;
    for (const q of spawnedHere()) {
      if (q.kind !== kind || q.state === "dead") continue;
      const d = Math.abs(q.x - p.x) + Math.abs(p.y - p.feet - q.y);
      if (d < by) {
        by = d;
        best = q;
      }
    }
    return best ? { x: best.x, y: best.y } : null;
  },
  /**
   * `0x4263e0` — every one of them, where it stands, with the lift and the
   * award its own death carries.
   */
  slayAll: (kind) => {
    for (const q of spawnedHere()) {
      if (q.kind !== kind || q.state === "dead") continue;
      const kid = FOES[kind];
      if (!kid.death) continue;
      // `0x4263fd` — goo first, `0x40cba0(obj+6, 0x3c, 0)` from its point
      spray(q, 0x3c, { dx: 0, dy: 0 }, level ? foeAnchor(q, level) ?? undefined : undefined);
      q.state = "dead";
      q.anim = kid.death;
      q.clock = 0;
      q.linger = kid.linger ?? corpseFrames + (kid.lingerPlus ?? 0);
      // `0x4263f7` — each one is thrown UP as it is taken, and `batReacts`
      // is told the throw is spent
      q.vy = -40 * TICK_SCALE;
      q.threw = true;
      stats.score += kid.award ?? kid.panel?.award ?? 0;
      // `0x426424` — `0x40ef30(0x4a5870, 1, obj+6)`, belfry.snd's record 1
      sound?.effect(1, q.x, q.y);
    }
  },
  remove: (e, award) => {
    stats.score += award;
    const pool = spawnedHere();
    const at = pool.indexOf(e);
    if (at >= 0) pool.splice(at, 1);
  },
  cast: (e, kit, aim) => spawnCast(e, kit, aim),
  hatch: (e, kind, at) => hatchAt(e, kind, at),
  roller: (_e, at) => rollerAt(at.x, at.y, at.vx),
  // `obj+0x24` as the allocator leaves it, 10 a frame² (`0x42f5ca`), per
  // tick²: the one reader is werea's arc (`0x44e878` reads its own `obj+0x24`),
  // and its creator `0x450a50` never calls `0x42f850`
  gravity: 10 * TICK_SCALE * TICK_SCALE,
};

/**
 * The body pass — `0x430680`, once per object per engine frame, between the
 * scripts and the hits (`0x42fc10`).
 *
 * Every object with a shove weight (`obj+0x26`) is weighed against every one
 * after it in the list, and a pair whose body rects overlap (`0x434140`) push
 * each other apart by `0x430720`:
 *
 * ```
 *   I     = the area of the overlap
 *   own   = the area of this object's rect
 *   push  = obj+0x26 × I / own          ; its OWN weight, truncated
 *   obj+0xc -= push, signed away from the other's x (obj+8)
 * ```
 *
 * So the weight is how easily a thing is shoved, not how hard it shoves: the
 * dog's 1 barely moves, the punks' 8 and the player's 8 part evenly, the big
 * ones' 12 give way faster, and a thing with 0 — the gang, the rats, anything
 * the allocator left alone (`0x42f5d0`) — is not in the pass at all, and walks
 * through you. A deep overlap is a hard push and a graze is a nudge; the rect is
 * the cel's drawn extent (`0x42f9f0`), and the drag spends what it adds.
 *
 * The player takes part at 8 (`0x429522`) until dying writes 0 (`0x4293d0`,
 * `0x4294a2`), and every class writes 0 over its corpse.
 */
export const pushes = new Map<Enemy, number>();
export function bodyRect(
  e: Enemy,
  lvl: Level,
): { x0: number; y0: number; x1: number; y1: number } | null {
  const c = celRec(lvl.sbk, celOf(e));
  const a = foeAnchor(e, lvl);
  if (!c || !a) return null;
  // mirrored about the anchor, as the draw is (`0x42fa2c`)
  const x0 = Math.round(e.facing < 0 ? a.x - (c.width - c.posX) : a.x - c.posX);
  const y0 = Math.round(a.y - c.posY);
  return { x0, y0, x1: x0 + c.width, y1: y0 + c.height };
}
export function shoveOf(e: Enemy): number {
  if (e.state === "dead" || e.state === "burst") return 0;
  return e.shove ?? FOES[e.kind]?.shove ?? 0;
}
export function bodyPush(ladder: boolean): void {
  const lvl = level;
  if (!lvl) return;
  type Body = {
    w: number;
    x: number;
    r: { x0: number; y0: number; x1: number; y1: number };
    shove: (dv: number) => void;
  };
  const bodies: Body[] = [];
  const me = playerSprite();
  // `0x42f550` puts the player first in the list
  if (me && p.act !== "dying" && !ladder && p.bar === undefined)
    bodies.push({
      w: 8,
      x: p.x,
      r: { x0: me.left, y0: me.top, x1: me.left + me.f.width, y1: me.top + me.f.height },
      shove: (dv) => (p.vx += dv),
    });
  for (const e of spawnedHere()) {
    const w = shoveOf(e);
    if (w === 0) continue;
    const r = bodyRect(e, lvl);
    if (!r) continue;
    bodies.push({ w, x: anchorX(e), r, shove: (dv) => pushes.set(e, (pushes.get(e) ?? 0) + dv) });
  }
  for (let i = 0; i < bodies.length; i++) {
    const a = bodies[i];
    for (let j = i + 1; j < bodies.length; j++) {
      const b = bodies[j];
      const x0 = Math.max(a.r.x0, b.r.x0);
      const x1 = Math.min(a.r.x1, b.r.x1);
      const y0 = Math.max(a.r.y0, b.r.y0);
      const y1 = Math.min(a.r.y1, b.r.y1);
      if (x1 <= x0 || y1 <= y0) continue;
      const overlap = (x1 - x0) * (y1 - y0);
      const own = (r: Body["r"]) => (r.x1 - r.x0) * (r.y1 - r.y0);
      // `0x430788` — the first is pushed west unless the second is west of it...
      const da = Math.trunc((a.w * overlap) / own(a.r));
      a.shove(b.x >= a.x ? -da : da);
      // `0x43079f` — ...and the second east unless it is west of (or on) the first
      const db = Math.trunc((b.w * overlap) / own(b.r));
      b.shove(b.x > a.x ? db : -db);
    }
  }
}

export function stepEnemies(): void {
  const lvl = level;
  const pool = spawnedHere();
  playerSwinging = strikeBox() !== null;
  for (const e of [...pool]) {
    const foe = FOES[e.kind];
    // ...and a thing that is no longer running a state of its own has weight
    // again, which only a brain that sets {@link Enemy.weightless} notices
    if (e.state !== "gait") e.weightless = false;
    e.clock += TICK_SCALE;
    /**
     * ...and the landing that gives one of them its second bar.
     *
     * `0x441726` — the fall's tag 1, weight on, waits for `obj+0x30` and
     * `obj+0x2e`, the body on the floor; then `0x441747` writes the X it landed
     * at into `[0x4a7574]` ({@link Enemy.home}), `0x473ba8` goes on,
     * `0x44176f` sprays `0x40cba0(point, 0x14, 0)`, `0x441787` writes
     * `0x40e300(0x3e8)` back into the health word whole and `0x44179b` says
     * 0x18. Past the tag's two lifts, a vertical speed of nothing is the floor.
     * See {@link Foe.rallies}.
     */
    if (
      foe.rallies &&
      e.rallied &&
      e.hp <= 0 &&
      e.state === "gait" &&
      e.script === foe.rallies.fall.kind &&
      e.tag === 1 &&
      e.clock >= 2 &&
      e.vy === 0
    ) {
      e.hp = scaled(foe.rallies.health);
      e.max = e.hp;
      e.home = e.x;
      e.anim = foe.rallies.rise;
      e.script = foe.rallies.rise.kind;
      e.tag = foe.rallies.rise.tag;
      e.clock = 0;
      // no hitter behind it (`0x441767 push 0`), so the goo flies loose
      spray(e, 0x14, { dx: 0, dy: 0 }, undefined, true);
      sound?.effect(FOE_SFX.kraggRise, e.x, e.y);
    }
    const run = e.anim.cels.length * e.anim.hold;
    /**
     * ...and a class that DOES something while the page plays its reaction.
     *
     * See {@link Reaction}: three classes have a state a brain is never called
     * during and that no animation can express — and all three were out of
     * reach for exactly that reason. It runs once an ENGINE FRAME, as a brain
     * does, and it may not install anything: the page goes on owning the
     * animation and the frame count.
     */
    // ...and what it answers, from a flinch, is a script of its own machine
    // that ends the flinch this frame ({@link Reaction}), handled with the
    // `resume` below once the frame's movement is done
    let cut: FoeAnim | undefined;
    if (
      (e.state === "flinch" || e.state === "dead") &&
      Math.floor(e.clock) !== Math.floor(e.clock - TICK_SCALE)
    ) {
      const to = REACTIONS[e.kind]?.(e, foe, run, BRAIN_CTX);
      if (to && e.state === "flinch") cut = to;
      // ...and from a death as well, where the think's preamble exempts the
      // death's state: the ox's `0x43f325` puts even a dying ox in the pit
      else if (to && e.state === "dead") {
        e.state = "gait";
        e.swing = false;
        install(e, to);
        e.clock = 0;
        continue;
      }
    }
    if (e.state === "dead") {
      /**
       * ...and what comes out of it. `0x454690` calls the punk's own creator
       * from the first tag of the CHOPPER's death, at the CHOPPER's own position, so
       * the thing that climbs out arrives as the death reaches its second group
       * of cels ({@link Foe.hatches}).
       */
      /**
       * ...and the HEAD, as the death's first tag ends — the zombie's
       * `0x420832` and igor's `0x425629` install tag 1 and call `0x4208e0` on
       * the same frame ({@link Foe.sheds}, {@link HEAD}).
       */
      const shed = foe.sheds;
      if (shed && !e.shed && e.clock >= shed.afterCels * e.anim.hold) {
        e.shed = true;
        shedHead(e, shed.mode);
      }
      const born = foe.hatches;
      if (born && !e.hatched && e.clock >= born.afterCels * e.anim.hold) {
        e.hatched = true;
        const kid = FOES[born.kind];
        const g = celRec(lvl?.sbk, kid.gait.cels[0]);
        if (kid && g) {
          // `0x454669` — through `0x40f110`, which restarts it if it sounds
          sound?.effect(FOE_SFX.weredHatch, e.x, e.y, "renew");
          // `0x450b11`: handed a parent, the creator launches what it makes off
          // it — the parent's way at a fixed thirty, fifty up, in its own leap
          // script, which the page plays as a reaction so no brain steers the
          // flight ({@link Foe.hatches})
          const leap = born.leap;
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
            state: leap ? "flinch" : "gait",
            anim: leap ? leap.anim : kid.gait,
            linger: 0,
            dents: 0,
            vx: leap ? leap.vx * TICK_SCALE * e.facing : 0,
            vy: leap ? leap.vy * TICK_SCALE : 0,
            hp: kid.health,
            max: kid.health,
            // `0x450add` — `AI+0x10` is the point the creator was handed, the
            // bike's own, and it is where FANG's state 6 sends it home to
            home: e.x,
          });
        }
      }
      /**
       * ...and the BIKE goes with it. Same frame, after the rider is out: the
       * wreck is thrown forward and up as an impulse and gravity brings it
       * down, which is what tags 2 and 3 of `0x477ba0` are drawn for. See
       * {@link Foe.deathThrow}.
       */
      const thrown = foe.deathThrow;
      if (
        thrown &&
        !e.threw &&
        e.clock >= thrown.afterCels * e.anim.hold
      ) {
        e.threw = true;
        // ADDED to the ride {@link killFoe} carried over, as `0x42f8b0` adds
        // every script step, and then `0x454473`'s clamp, which runs in state
        // 5 too: at speed the bike keeps its thirty and the impulse is spent
        // on the lift
        e.vx += (thrown.dx / foe.divisor) * TICK_SCALE * e.facing;
        e.vy = (thrown.dy / foe.divisor) * TICK_SCALE;
        if (foe.speedCap !== undefined) {
          const cap = foe.speedCap * TICK_SCALE;
          e.vx = Math.max(-cap, Math.min(cap, e.vx));
        }
      }
      // ...and a thrown wreck FLIES, which the ordinary mover below never gets
      // to do for it: the dead branch has always ended in `continue`. Same
      // arithmetic, kept here rather than hoisted, because a corpse does not
      // want the walls, the patrol rect or any of the rest of it. A body
      // still in the air keeps falling through an apex where both words
      // happen to read zero ({@link Enemy.lastBase} is only set in flight)
      // ...and a body at rest still meets the mover every frame: a death
      // state that raises its floor offset (the rat's −150 at `0x44e33f`, the
      // gang's −20, the dog's −12) leaves the foot above the ground, nothing
      // snaps it (`0x42ff56` only lifts), and gravity takes it down
      if (
        lvl &&
        e.vx === 0 &&
        e.vy === 0 &&
        e.lastBase === undefined &&
        !foe.floats &&
        !e.weightless &&
        foeGravity(foe) > 0
      ) {
        const b = baseOf(e, lvl);
        if (foeSurfaceUnder(e.x, b - CLIMB_PX, b + 8) === null) {
          e.vy = foeGravity(foe);
          e.lastBase = b;
        }
      }
      if (e.vx !== 0 || e.vy !== 0 || e.lastBase !== undefined) {
        e.vy += foeGravity(foe); // `0x430327` — and no cap: nothing limits obj+0xa
        e.x += e.vx;
        e.y += e.vy;
        const span = p.room ? roomSpan(p.room) : null;
        if (span) e.x = Math.max(span.lo, Math.min(span.hi, e.x));
        const base = lvl ? baseOf(e, lvl) : e.y;
        // ...from wherever the feet were last frame too: a brain that swaps
        // poses in the air (the dog's pounce and stand, whose boxes put the
        // foot 200 pixels apart) moves the base further than the fall, and the
        // sweep from the new one alone started under the floor it had crossed
        const from = Math.min(base - Math.max(e.vy, 0), e.lastBase ?? base);
        e.lastBase = base;
        // `0x42ff56`: within eight pixels of it counts as on it
        let floor = foeSurfaceUnder(e.x, from - CLIMB_PX, base + 8);
        // ...and the region's floor is solid all the way down: `0x42ff3a` reads
        // it under the point and puts anything at or below it back on top
        // (`0x42ff5b`), however far in it is. Only the platforms are one-way.
        // A pounce carried sideways into a rock face was under a floor the
        // sweep above could not see, and fell out of the level
        const ground = groundAt(e.x);
        if (ground !== null && base >= ground) floor = ground;
        if (floor !== null && base >= floor - landingWindow(e.vy)) {
          e.lastBase = undefined;
          e.y -= base - floor;
          // a body that bounces — {@link Foe.corpseBounce}: `0x42ff83` hands
          // back anything faster than 2 through `obj+0x20`, and the landing
          // sets the flag the death state plays its thud on. The speed is the
          // one it came down with: `0x430322` adds no gravity on a frame that
          // ends on the floor (`0x42ff5d` sets `di`), so a body at rest is not
          // handed its own tick of gravity back as a bounce
          const bounce = foe.corpseBounce;
          if (bounce && Math.abs((e.vy - foeGravity(foe)) / TICK_SCALE) > 2) {
            e.vy = -Math.trunc((e.vy / TICK_SCALE) * bounce.restitution) * TICK_SCALE;
            sound?.effect(bounce.sound, e.x, e.y);
          } else e.vy = 0;
          if (Math.floor(e.clock) !== Math.floor(e.clock - TICK_SCALE))
            e.vx =
              dragged(Math.round(e.vx / TICK_SCALE), foe.drag ?? DRAG) *
              TICK_SCALE;
        }
      }
      /**
       * ...a death that is two scripts hands to its second half at its own
       * rate, as a flinch does ({@link FoeAnim.then}). The gunner TCop's kind 9
       * tag 3 is the case: `0x414566` waits for it to end, drops the blaster a
       * hundred pixels behind it (`0x414599`, `0x45b060(6, …)`) and installs
       * kind 11 (`0x4145a4`), which is the removal.
       */
      if (e.anim.then && e.clock >= run) {
        if (e.kind === "initcop" && e.param) dropBlaster(e);
        e.anim = e.anim.then;
        e.clock = 0;
        if (e.anim.kind !== undefined) {
          e.script = e.anim.kind;
          e.tag = e.anim.tag;
        }
        continue;
      }
      // the death animation, then the body, then a green ball where it was
      if (e.clock >= run) {
        e.linger -= TICK_SCALE;
        if (e.linger <= 0) {
          // only the kinds whose corpse handler calls `0x40cba0(pos, -13, 0)`
          // ...at the corpse's own point, `obj+6` (`0x40cbf0`)
          if (foe.vanishes) {
            const at = (lvl && foeAnchor(e, lvl)) || { x: e.x, y: e.y };
            pops.push({ x: at.x, y: at.y, age: 0 });
          }
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
    // `0x42fd80` measures the ground before anything reads it this frame
    if (lvl) measureGround(e, foe, lvl);
    const brain = BRAINS[e.kind];
    // a dormant thing holds its one cel until the player's point is inside its
    // rect, and its think's state 0 is what it lands in the moment it is not
    if (e.state === "gait" && foe.wake && e.asleep && wakeFoe(e, foe)) continue;
    // ...and every other class fights through the one shared brain, until its
    // own has been read — see {@link BRAINS}
    if (stepFight(e, foe, run)) continue;
    // whatever it is doing, a thing carrying momentum flies, falls, and stops when
    // its OWN cel's box lands. This has to come before the animation states: the
    // mailbox's topple is four frames and its flight is far longer than that.
    // ...and kragg is a floater only until it is shot down: the fall's tag 1
    // calls `0x42f850(obj, 1.0)` at `0x4416e6` and it lands like anything else
    // from there, its brain holding the weight off through the steered first
    // tag ({@link Enemy.weightless}). See {@link Foe.rallies}
    const aloft = foe.floats && !(foe.rallies && e.rallied);
    if (e.vx !== 0 || e.vy !== 0) {
      // ...and a thing with no gravity keeps whatever velocity it was given:
      // the hover below is what moves level eight's boss up and down
      if (!aloft && !e.weightless)
        e.vy += foeGravity(foe); // `0x430327` — and no cap: nothing limits obj+0xa
      e.x += e.vx;
      e.y += e.vy;
      const span = p.room ? roomSpan(p.room) : null;
      if (span) e.x = Math.max(span.lo, Math.min(span.hi, e.x));
      // ...but kragg on the wing still meets its region's floor and ceiling
      if (aloft && lvl) floaterInRegion(e, foe, lvl);
      // ...and a thing with no gravity never lands, so none of the rest applies
      if (!aloft) {
        let base = lvl ? baseOf(e, lvl) : e.y;
        /**
         * `0x42fed4`: where the region's floor at the new point stands more
         * than fifty pixels ABOVE it, that is a wall, not a floor. The move
         * is undone, `obj+0xa` zeroed and `obj+0xc` multiplied by the
         * restitution (`0x42ff02`, the allocator's 0x800 = a quarter, the
         * dog's −0.3), and the thing counts as standing for the frame. A
         * pounce into a rock face stops against it rather than landing on
         * top of it — or, before the floor below was solid, falling out of
         * the level under it.
         */
        const wall = groundAt(e.x);
        if (wall !== null && wall + 50 < base) {
          e.x -= e.vx;
          e.y -= e.vy;
          e.vy = 0;
          e.vx *= foe.restitution ?? 0.25;
          if (Math.abs(e.vx) < 0.01) e.vx = 0;
          base = lvl ? baseOf(e, lvl) : e.y;
        }
        // the surfaces the PLAYER stands on — platform tops and then the room's
        // floor — swept along the fall so a fast one cannot tunnel through a
        // ledge, plus the one an open grave lays ({@link graveLidUnder}), so a
        // foe already in the air over one is caught by it too
        // ...from wherever the feet were last frame too: a brain that swaps
        // poses in the air (the dog's pounce and stand, whose boxes put the
        // foot 200 pixels apart) moves the base further than the fall, and the
        // sweep from the new one alone started under the floor it had crossed
        const from = Math.min(base - Math.max(e.vy, 0), e.lastBase ?? base);
        e.lastBase = base;
        // `0x42ff56`: within eight pixels of it counts as on it
        let floor = foeSurfaceUnder(e.x, from - CLIMB_PX, base + 8);
        // ...and the region's floor is solid all the way down: `0x42ff3a` reads
        // it under the point and puts anything at or below it back on top
        // (`0x42ff5b`), however far in it is. Only the platforms are one-way.
        // A pounce carried sideways into a rock face was under a floor the
        // sweep above could not see, and fell out of the level
        const ground = groundAt(e.x);
        if (ground !== null && base >= ground) floor = ground;
        if (floor !== null && base >= floor - landingWindow(e.vy)) {
          e.lastBase = undefined;
          // by the CEL's box, not by where the upright one would have stood
          e.y -= base - floor;
          e.vy = 0;
          // and on the ground the allocator's drag takes 70% a frame off it
          // ({@link dragged}) — once a frame, on the frame's whole pixels
          if (Math.floor(e.clock) !== Math.floor(e.clock - TICK_SCALE))
            e.vx =
              dragged(Math.round(e.vx / TICK_SCALE), foe.drag ?? DRAG) *
              TICK_SCALE;
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
    /**
     * ...and a reaction that is FATAL hands to the death when it ends.
     *
     * `0x4526ef` is the shape: the five frames of werec's state 3 run out, it
     * squeals, clears the bar and installs `0x477a78` — the death — rather
     * than going back to standing. So `fatal` does not mean "play this as the
     * death", it means "and then die", which is why the burn animation and
     * {@link Foe.death} are two different things.
     */
    if (
      e.state === "flinch" &&
      foe.burns?.fatal &&
      e.anim === foe.burns.anim &&
      e.clock >= run &&
      foe.death
    ) {
      killFoe(e, foe);
      // ...with the corpse time this death writes, where it has its own
      // (`0x452731`, {@link Foe.burns})
      if (foe.burns.linger !== undefined) e.linger = foe.burns.linger;
      continue;
    }
    // ...and a reaction that hands its class's machine a state of its own
    // rather than the gait — the punk's get-up ending on the taunt,
    // `0x44ee90`, and see {@link FoeAnim.resume}
    const resume = e.state === "flinch" && (cut ?? (e.clock >= run && e.anim.resume));
    if (resume) {
      e.state = "gait";
      e.swing = false;
      install(e, resume);
      e.clock = 0;
      continue;
    }
    /**
     * ...or a reaction that is itself a state of the machine, whose case
     * decides the moment the script ends ({@link FoeAnim.decides}): the brain
     * is handed the reaction's own kind with the script finished, and runs on
     * this same frame — the frame `obj+0x46` is set and the think installs
     * what follows.
     */
    if (e.state === "flinch" && e.clock >= run && e.anim.decides && brain) {
      e.state = "gait";
      e.swing = false;
      e.script = e.anim.kind;
      e.tag = e.anim.tag;
      stepFight(e, foe, run);
      continue;
    }
    if (e.state === "flinch" && e.clock >= run) {
      // out of stages: the LAST stage's frame ending is what bursts a hydrant, and
      // what bursts is a second object of the same class beside it — `0x44fb20`
      // spawns one on the water tag 25px to its facing side and puts this one
      // straight back on tag 0, whole, to be turned open all over again
      if (foe.burst && foe.flinch && e.dents >= foe.flinch.length) {
        // `0x44fb94`, on the frame the water is created
        if (foe.burst.sound !== undefined)
          sound?.effect(foe.burst.sound, e.x, e.y);
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
      // a blow ends whatever it was swinging
      e.swing = false;
      // `0x456058`: the boss's flinch hands back into the combat loop rather than
      // to standing — it is still in the fight
      e.anim = foe.drives && e.mode ? foe.drives.hover : foe.gait;
      if (foe.drives && e.mode) e.mode = "hover";
      // ...and a class with a machine of its own is put IN the state that
      // script belongs to, not left in the one the blow interrupted: every
      // hit handler installs its reaction through `0x45d090`, which writes the
      // script's kind into `obj+0x18`, so what the think dispatches on after
      // it is the reaction's own chain. A class whose chain goes somewhere
      // other than its gait says so with {@link FoeAnim.resume}, above
      if (brain) install(e, e.anim);
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
    const aim =
      foe.lever && (e.state === "gait" || e.state === "lever") && !e.asleep
        ? leverFor(e, foe.lever.dir)
        : null;
    // the frame one is FOUND — the batboy's `0x4392a4` turns to it, says
    // `0x4392d7` through `0x40f090` and puts the lever script on, once
    if (aim && e.aimed !== aim && foe.lever?.found !== undefined)
      sound?.effect(foe.lever.found, e.x, e.y, "lead");
    e.aimed = aim ?? undefined;
    if (e.state === "lever") {
      const L = foe.lever!;
      // ...and once it has thrown, the lever it threw is no longer the kind it
      // looks for, so the reach plays out on its own: `0x43f769` waits for the
      // script to end before the stand
      if (!aim && !e.thrown) {
        e.state = "gait";
        e.anim = foe.gait;
        e.clock = 0;
      } else {
        if (aim && !e.thrown && e.clock >= L.at * L.anim.hold) {
          e.thrown = true;
          // `0x43a191`: one roll in three, and then one of two takes
          if (L.sound.length && roll(3) === 1) {
            const which = L.sound[roll(L.sound.length) - 1];
            sound?.effect(which, e.x, e.y);
          }
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
      const L = foe.lever!;
      // a class with a run of its own goes to the lever on it — the ox's
      // `0x472ff0` tag 0 at dx 280 (`0x43f388`) — and the rest walk
      if (L.run && e.anim !== L.run) {
        e.anim = L.run;
        e.clock = 0;
      }
      if (
        Math.abs(aim.x - e.x) < L.reachPx &&
        (L.reachY === undefined || Math.abs(aim.y - e.y) < L.reachY)
      ) {
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
    // ...and not for a class with a machine of its own: the bat's `0x422ef0`
    // never reads the player's x to move, and this homed it on top of that
    if (foe.chases && !brain && !e.asleep && e.state === "gait") {
      const dx = p.x - e.x;
      const dy = p.y - p.feet - e.y;
      const px = foe.chases.px;
      e.facing = dx >= 0 ? 1 : -1;
      e.x += Math.max(-px, Math.min(px, dx)) * TICK_SCALE;
      if (foe.floats) e.y += Math.max(-px, Math.min(px, dy)) * TICK_SCALE;
      continue;
    }
    const i =
      e.state === "gait" && !e.swing
        ? loopIndex(e.anim, e.clock)
        : Math.min(e.anim.cels.length - 1, Math.floor(e.clock / e.anim.hold));
    /**
     * The stride is a SETTLED velocity, not the script's number.
     *
     * `0x42f8b0` ends `idiv cx` with `add word ptr [esp+6], ax` — the script's
     * `dx` over the divisor is an impulse ADDED to whatever velocity the object
     * already has, every frame, and `0x4302c0` takes `v * obj+0x1e >> 13` back
     * off on every frame that ended on the ground. So a walk is not its `dx`:
     * it accelerates until the drag balances the impulse, which is the same
     * arithmetic {@link DRAG} already describes for the player ("each frame adds
     * 8 and the ground keeps 30%, and that settles at 12").
     *
     * Assigning `dx / divisor` instead — which this did — gave every class its
     * impulse as a top speed, about 1.4x slow for the thirty that use the
     * allocator's drag and **twenty times** slow for the one that does not. The
     * CHOPPER settled at 142px a second, slower than the player walks; its own
     * drag of 409 ({@link Foe.drag}) puts it where a motorcycle belongs.
     *
     * The move itself is still positional — the wall, the step and the pin below
     * all read the place it is going — so this changes the speed and nothing
     * about how a foe negotiates ground.
     */
    const onFrame = Math.floor(e.clock) !== Math.floor(e.clock - TICK_SCALE);
    // ...and a class that stands still stands still while it fights: its attack's
    // own stride would otherwise walk it off the wall it reaches out of
    const still = !brain && (e.fighting || e.swing) && !travels(foe);
    // it only builds speed on the frames it is actually walking. Off its feet or
    // rooted in a fight it keeps none, so nothing it could not spend is waiting
    // to be spent the moment it lands.
    const rolling = !still && e.vx === 0 && (e.vy === 0 || foe.floats);
    if (onFrame) {
      e.speed = rolling
        ? dragged(e.speed ?? 0, foe.drag ?? DRAG) +
          roundAway((e.anim.dx?.[i] ?? 0) / (e.divisor ?? foe.divisor))
        : 0;
      // ...and its own think has the last word on how fast it may go
      const cap = foe.speedCap;
      if (cap !== undefined) e.speed = Math.max(-cap, Math.min(cap, e.speed));
    }
    // ...and whether what the body pass takes off `obj+0xc` goes into its
    // walk or its flight — see {@link bodyPush}, in the frame's {@link hitPass}
    if (onFrame) e.rolling = rolling && !foe.floats;
    /**
     * ...and a FLOATER is not dragged, because the drag is the ground's.
     *
     * `0x4302c0` sits behind `0x4302a4`, which skips it in the air — the same
     * test that lets the player's jump coast. A class built with
     * `0x42f850(obj, 0)` and `obj+0x30 = 0` is never on the ground and so never
     * meets it, and a velocity that only ever accumulates would run away. The
     * things that fly are steered by their own think function instead (the
     * probe's `0x410486` clamps `obj+0xc` to ±27 by hand), which this page has
     * never modelled through the stride. So they keep the stride they had.
     */
    const step = foe.floats
      ? foe.accrues
        ? 0
        : ((e.anim.dx?.[i] ?? 0) / (e.divisor ?? foe.divisor)) * TICK_SCALE
      : (e.speed ?? 0) * TICK_SCALE;
    // ...except a floater whose own think holds the velocity down, which gets
    // the engine's reading: `0x45d1a3` adds the frame's `dx / divisor`, rounded
    // away from zero, into `obj+0xc` on every frame it shows, with no drag in
    // the air — see {@link Foe.accrues}
    if (foe.floats && foe.accrues && onFrame && e.state === "gait") {
      const dx = e.anim.dx?.[i] ?? 0;
      if (dx !== 0)
        e.vx += roundAway(dx / (e.divisor ?? foe.divisor)) * TICK_SCALE * e.facing;
    }
    /**
     * A leap is an IMPULSE, not an offset — which is the whole of the fix.
     *
     * `0x477368 tag 0` carries `dy -480` on the frame cel 1942 shows, and the
     * engine spends a number like that the way it spends the player's own jump:
     * `0x42f8b0` rounds `dy / divisor` away from zero and writes it into
     * `obj+0xa`, ONCE, on the frame it appears. Gravity takes it from there.
     *
     * Adding it straight to `e.y` instead — which this did — moved the thing
     * ninety-six pixels in four frames with no velocity to show for it, so the
     * landing test never saw a fall: `foeSurfaceUnder` reaches {@link CLIMB_PX}
     * below the feet and no further, found nothing, and WOODS' CHOPPER went nine
     * thousand pixels out of the level still swinging. As velocity it uses the
     * flight path every knocked-back thing already uses, sweeping the surfaces
     * along the way down, and it lands.
     *
     * The frame's own `dx` goes with it — a leap that rises and does not travel
     * is not what tag 0 says — and the stride block below then leaves it alone,
     * because that only runs on a thing with no velocity.
     */
    const lift = e.anim.dy?.[i] ?? 0;
    // ...and a class with a machine of its own does not need {@link travels}
    // to vouch for it: it installed the script that carries the lift
    /**
     * ...and it is ADDED, on every frame the cel shows, not set once.
     *
     * `0x45d1a3` calls `0x42f8b0` for the current frame on every engine frame,
     * and that adds `dy / divisor` (and `dx / divisor`), rounded away from
     * zero, into the velocity; a cel held two frames pushes twice. Gravity
     * comes after the move and only in the air (`0x430322`), so a lift that
     * keeps pushing keeps rising: the dog's pounce, −80 −80 −160 −160 −80 −80
     * −80 −80 over its divisor of ten against a gravity of ten, climbs about
     * ninety-six pixels, where setting its first −8 once climbed four.
     */
    if (lift !== 0 && onFrame && (brain || travels(foe)) && !foe.floats) {
      // leaving the ground, it takes its walk with it...
      if (e.vy === 0 && e.vx === 0) e.vx = (step || 0) * e.facing;
      // ...and in the air the frame's own dx is pushed in with the lift
      else if (e.anim.dx?.[i])
        e.vx += roundAway(e.anim.dx[i] / (e.divisor ?? foe.divisor)) * TICK_SCALE * e.facing;
      e.vy += roundAway(lift / (e.divisor ?? foe.divisor)) * TICK_SCALE;
    }
    /**
     * ...and a class with a machine of its own is never pinned ({@link still}).
     *
     * {@link travels} reads {@link Foe.gait}, and `gait` was picked per class by
     * eye: for `initwerea`, `inittube`, `inithardcore`, `initarm`, `initslurp`
     * and `initknotboy` it landed on a standing, gesturing or lever script that
     * carries no stride, so those classes read as rooted and had every `dx`
     * thrown away. A brain installs the script the executable installs, by kind,
     * so it does not need the guess — and the guess is wrong for six of them.
     * A floater's own hover keeps `vy` busy for ever, and its script's stride
     * has to travel anyway.
     */
    // and a NEGATIVE stride is a stride: `0x4771a0 tag 0` is the punk walking
    // backwards at -225, and every class that gives ground has one
    /**
     * ...and the walk is SWEPT, because a stride can now be longer than a wall.
     *
     * Every test in this block — the climbable step, the patrol edge, the pin
     * that follows — reads the one place the move ends at. That was safe while
     * a stride was the script's `dx` over a divisor: a dozen pixels, less than
     * {@link CLIMB_PX}. It is not safe now that a stride is a settled velocity,
     * and the CHOPPER proved it: at two hundred pixels an engine frame it
     * stepped clean over WOODS' ledges, found nothing under the far side and
     * fell fifty-six thousand pixels out of the level.
     *
     * So the move is cut into pieces no longer than the wall it has to notice,
     * and each piece is tested and pinned on its own. Same arithmetic, sampled
     * often enough to mean what it says.
     */
    const SWEEP_PX = CLIMB_PX;
    if (step !== 0 && !still && e.vx === 0 && (e.vy === 0 || foe.floats)) {
      const total = step * e.facing;
      const parts = Math.max(1, Math.ceil(Math.abs(total) / SWEEP_PX));
      for (let part = 0; part < parts; part++) {
        const nx = e.x + total / parts;
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
        const baseNow = lvl ? footOf(e, lvl, foe) : e.y;
        const ground = groundAt(nx);
        const reach = foeSurfaceUnder(nx, baseNow - CLIMB_PX, baseNow + STICK_PX);
        // a floater has no feet to catch on a step
        const blocked =
          !foe.floats &&
          ground !== null &&
          ground < baseNow - CLIMB_PX &&
          reach === null;
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
        // ...and a class in a FIGHT is not on a patrol either: its territory is
        // where it noticed you, not where it may walk, and `0x44e580` reads no
        // rect at all once `obj+0x18` is 1
        // ...and a class with a state machine owns its facing: the stepper
        // `0x42fd80` has no rect turn at all, so turning one here fought its
        // brain, and a body already outside its rect turned every tick
        if (
          e.state === "gait" &&
          !aim &&
          !foe.drives &&
          !brain &&
          !e.fighting &&
          (nx < e.left || nx > e.right)
        ) {
          // it reached its patrol edge: turn, and spend no more of this stride
          // going the way it has just stopped going
          e.facing = -e.facing;
          break;
        } else if (!blocked) {
          const span = p.room ? roomSpan(p.room) : null;
          e.x =
            // ...nor is a brain class held to its rect ±200: `0x42fd80` clamps
            // at no rect, and the rat's run `0x44e226` goes where it goes
            foe.drives || e.fighting || brain
              ? span
                ? Math.max(span.lo, Math.min(span.hi, nx))
                : nx
              : // ...and never through where it already stands, so a foe walking
                // home from a fight it followed you out of is not teleported
                Math.max(
                  Math.min(e.left - 200, e.x),
                  Math.min(Math.max(e.right + 200, e.x), nx),
                );
        } else break; // it walked into a step it cannot climb: the rest is thrown away
        // ...and it is pinned HERE, not at the end of the whole stride, so it
        // meets a ledge where the ledge is and steps off it rather than over it
        if (parts > 1 && !foe.floats && e.vx === 0 && e.vy === 0) {
          const b = lvl ? footOf(e, lvl, foe) : e.y;
          const under = foeSurfaceUnder(e.x, b - CLIMB_PX, b + STICK_PX);
          if (under !== null) e.y += under - b;
          else {
            stepOff(e, foe);
            break;
          }
        }
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
    if (e.vx === 0 && e.vy === 0 && !aloft && !e.weightless) {
      const base = lvl ? footOf(e, lvl, foe) : e.y;
      const s = foeSurfaceUnder(e.x, base - CLIMB_PX, base + STICK_PX);
      if (s !== null) e.y += s - base;
      else stepOff(e, foe);
    }
  }
}

/**
 * A walker off the end of its ground, into the fall — and it keeps its walk.
 *
 * The engine has one `obj+0xc` and nothing on the way off a ledge touches it:
 * the mover finds no floor, gravity starts on `obj+0xa` (`0x430322`), and the
 * drag that would have taken the speed is the ground's and is skipped in the
 * air (`0x4302a4`). This page keeps a walker's speed in {@link Enemy.speed},
 * which is zeroed off its feet, so it goes into `e.vx` here. Dropping it left
 * every fall straight down — and a charging dog's jam test (`0x454f53`), which
 * reads "no speed along my facing" as a wall, turned it round on every frame
 * of the drop.
 */
function stepOff(e: Enemy, foe: Foe): void {
  e.vy = foeGravity(foe);
  if (e.vx === 0 && e.speed) e.vx = e.speed * TICK_SCALE * e.facing;
  e.speed = 0;
}

/**
 * One spawned thing, feet on the ground, flipped by its facing.
 *
 * ...and the flip is the correction. A creature's art is drawn facing EAST and
 * mirrored to face west, which is the same way round as the player
 * (`mirror: p.facing < 0`, where the player is composed); this drew a foe
 * mirrored when it faced east instead, so every one of them was turned the
 * wrong way. Nothing showed it up while the classes only patrolled, because a
 * thing pacing its own territory looks equally plausible either way. Give them
 * their own machines and they close on you with their backs turned.
 *
 * {@link hurtBox} mirrors on the same test, because a box that does not follow
 * the art is a box in the wrong place.
 */
/**
 * Each level's creature passes, in the order its frame function makes them,
 * with `"player"` where `0x402980` draws the player between them.
 *
 * Every level frame function paints one class at a time (`0x430f70` walks one
 * class's list, or a class's own collector walks it with a layer word), and
 * the player is one call in the middle of that list — so which creatures stand
 * IN FRONT of him is per level: STREETS' hydrants, MAZE's cops but BARREL's
 * behind him. A `[kind, layer]` pair is a collector that draws only the ones
 * whose layer word equals its argument ({@link enemyLayer}). Only creature
 * classes are listed; the level's other classes are drawn elsewhere.
 *
 * ```
 *   STREETS  0x44dc10  0x44df10(0) 0x44fd10 0x44e480 0x44f2d0 | 0x44df10(1) 0x44fa30
 *   CITY     0x4515d0  0x44e480 0x44f2d0 0x4522e0 |
 *   WOODS    0x453fd0  0x454ab0(0) 0x454300 0x44e480 0x44f2d0 0x4522e0 | 0x454ab0(1)
 *   PLAYGR   0x455260  0x454ab0(0) | 0x455850 0x454ab0(1)
 *   MAZE     0x412c30  | 0x4149d0 0x413ed0
 *   BARREL   0x4164f0  0x413ed0 |
 *   LAB      0x417b40  0x418690(0) 0x417df0 | 0x4191f0 0x418690(1)
 *   GRAVE    0x41f950  | 0x420230
 *   CAVERN   0x421ed0  0x423390(0) | 0x423390(1) 0x4225c0 0x420230 0x422de0
 *   RAVECAVE 0x424220  0x425150 | 0x4246f0 0x422de0
 *   TOWER    0x425840  0x423390(0) | 0x423390(1) 0x4225c0 0x422de0 0x425b60
 *   MALL     0x436f50  0x43b4d0 | 0x438660 0x437a20 0x439140 0x439ba0
 *   SERVICE  0x43bec0  | 0x437a20 0x438660 0x439ba0 0x439140 0x43cb80
 *   SEWER    0x43d370  | 0x43dcd0 0x43f1b0
 *   ARCADE   0x440560  | 0x442040
 * ```
 *
 * VAT (`0x419b20`) draws no creature class.
 */
export type EnemyPass = string | readonly [string, 0 | 1];
export const ENEMY_PASSES: Readonly<Record<string, readonly (EnemyPass | "player")[]>> = {
  STREETS: [["initrat", 0], "initmailbox", "initwerea", "initwereb", "player", ["initrat", 1], "inithydrant"],
  CITY: ["initwerea", "initwereb", "initwerec", "player"],
  WOODS: [["initdog", 0], "initwered", "initwerea", "initwereb", "initwerec", "player", ["initdog", 1]],
  PLAYGR: [["initdog", 0], "player", "initwbooly", ["initdog", 1]],
  MAZE: ["player", "initslurp", "initcop"],
  BARREL: ["initcop", "player"],
  LAB: [["initarm", 0], "initpuke", "player", "inittube", ["initarm", 1]],
  GRAVE: ["player", "initzomb"],
  CAVERN: [["initskel", 0], "player", ["initskel", 1], "initghengis", "initzomb", "initbat"],
  RAVECAVE: ["initigor", "player", "initwraith", "initbat"],
  TOWER: [["initskel", 0], "player", ["initskel", 1], "initghengis", "initbat", "initvpriest"],
  MALL: ["initcoke", "player", "initmaskboy", "initknotboy", "initbatboy", "initknifeboy"],
  SERVICE: ["player", "initknotboy", "initmaskboy", "initknifeboy", "initbatboy", "inithardcore"],
  SEWER: ["player", "initeyeball", "initox"],
  ARCADE: ["player", "initkragg"],
};

/**
 * The layer word a two-pass collector compares with its argument.
 *
 * - rat, `0x44df10`: `AI+4`, set to 1 as it comes out of its hole (`0x44e137`)
 * - dog, `0x454ab0`: `AI+4`, the flag its lunges raise and `0x454fc2` drops
 * - skeleton, `0x423390`: `AI+0xa`, 1 from its creator (`0x41edec`) until the
 *   corpse state zeroes it (`0x4239f9`)
 * - arm, `0x418690`: pass 0 takes the ones whose `AI+0x2a` (the record param)
 *   is still set — in the wall — and pass 1 the rest; `0x418877` clears it as
 *   the arm breaks out, which is where its shove weight stops being 0
 */
export function enemyLayer(e: Enemy): 0 | 1 {
  switch (e.kind) {
    case "initrat":
    case "initdog":
      return e.decisions ? 1 : 0;
    case "initskel":
      return e.state === "dead" ? 0 : 1;
    case "initarm":
      return e.shove === 0 ? 0 : 1;
    default:
      return 0;
  }
}

/**
 * The spawned things of this room in `ENEMY_PASSES` order, split at the
 * player. A kind the level's list does not name is drawn last before him.
 */
export function enemyPasses(): { before: Enemy[]; after: Enemy[] } {
  const all = spawnedHere();
  const list = level ? ENEMY_PASSES[level.name.toUpperCase()] : undefined;
  if (!list) return { before: [...all], after: [] };
  const split = list.indexOf("player");
  const slot = (e: Enemy): number => {
    const i = list.findIndex(
      (q) =>
        q !== "player" &&
        (typeof q === "string" ? q === e.kind : q[0] === e.kind && q[1] === enemyLayer(e)),
    );
    return i < 0 ? split - 0.5 : i;
  };
  const ranked = all
    .map((e, i) => ({ e, i, k: slot(e) }))
    .sort((a, b) => a.k - b.k || a.i - b.i);
  return {
    before: ranked.filter((r) => r.k < split).map((r) => r.e),
    after: ranked.filter((r) => r.k > split).map((r) => r.e),
  };
}

// ---- the loop -----------------------------------------------------------

/**
 * The swing — `0x434540(4) + 5`, one of four, and the same four whichever button
 * it was: the walk state plays it as it installs the punch (`0x429a03`) and again
 * as it installs the kick (`0x429a48`). Two of the four are the fist going past
 * and two are the man behind it.
 */
export function swing(): void {
  const which = OWN.swing[Math.floor(random() * OWN.swing.length)];
  sound?.own(which, p.x, p.y);
}

/** the crows this swing has already taken, so one blow is one crow */
export const struckCrows = new Set<Crow>();

/** and the Boggs parts this swing has already landed on — `"body"` or a machine index */
export const struckBoggs = new Set<string>();

/** ...and the heads it has already kicked — {@link HEAD} */
export const struckHeads = new Set<Head>();

/** the player cel drawn on the last frame — reported in the status line */
export let lastCel = 0;
/** which frame of the gait was showing last, so a footfall fires once per step */
export let lastGaitFrame = -1;

/**
 * Which of the player's cels is showing — the state picks the script and the
 * clock picks the frame. It is game state, not drawing: the hit boxes, the
 * pickups' pixel test and the body pass all read it ({@link lastCel}), and the
 * footfalls fire off its frame.
 */
export function choosePlayerCel(): void {
  // what the player is doing decides the script, and the DISTANCE they have
  // covered decides the frame — one cel per stride, the engine's own ratio
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
  /**
   * ...while it is OUT, which is {@link inv}'s `drawn` and not its `armed`: a
   * carried gun you have put away with INV ({@link stepInv}) leaves you on the
   * fists' own moveset.
   */
  const kit =
    inv.drawn ? (WEAPONS[inv.weapon]?.moveset ?? null) : null;
  const seq = acting
    ? acting.cels
    : p.bar
      ? (ANIM.bar[p.barTag] ?? ANIM.bar[0] ?? ANIM.hang)
      : p.climbing
        ? (ANIM.climb[p.climbTag] ?? ANIM.hang)
        : p.flail
          // `0x472350` whatever is in the player's hands: the preamble that
          // installs it runs ahead of every armed state's handler too
          ? ANIM.flail
          : p.landLeft > 0
          ? p.hardLand
            ? (kit?.fall ?? ANIM.air)
            : (kit?.land ?? ANIM.land)
          : !p.onGround || p.windup > 0
            ? (kit?.jump ?? ANIM.air)
            : p.crouching
              ? (kit?.duck ?? ANIM.crouch)
              : p.running
                ? (kit?.run ?? ANIM.run)
                : p.moving
                  ? (kit?.walk ?? ANIM.walk)
                  : (kit?.idle ?? ANIM.idle);
  // Three clocks, because the engine has three. An action and the idle run on
  // engine frames at their script's own ticksPerFrame; anything that covers
  // ground is clocked by the GROUND it covers, one cel per stride, so the feet
  // cannot slide whatever this page's Hz is; and the flight runs on its own.
  const running = seq === (kit?.run ?? ANIM.run);
  const stride = running ? runStridePx() : stridePx();
  let id: number;
  if (acting)
    id =
      seq[
        Math.min(seq.length - 1, Math.floor(p.actClock / (acting.hold ?? 1)))
      ];
  // `0x472048` is two engine frames a cel, and the last of a tag HOLDS —
  // which is what the chin-up standing still at the top of tag 3 is
  else if (p.bar)
    id = seq[Math.min(seq.length - 1, Math.floor(p.barClock / 2))];
  // a rung is four cels at one engine frame each, and the last of them is what a
  // ladder holds you on when you stop asking to move
  else if (p.climbing)
    id = seq[Math.min(seq.length - 1, Math.floor(p.climbClock))];
  else if (seq === (kit?.idle ?? ANIM.idle))
    // the fidgets are the fists' own two tags and no weapon script has any
    id =
      p.fidget && !kit
        ? p.fidget[
            Math.min(p.fidget.length - 1, Math.floor(p.fidgetClock / IDLE_HOLD))
          ]
        : seq[Math.floor(p.idleClock / IDLE_HOLD) % seq.length];
  else if (kit && seq === kit.duck) id = seq[0];
  else if (kit && (seq === kit.land || seq === kit.fall))
    id = seq[Math.min(seq.length - 1, Math.floor(p.actClock))];
  else if (kit && seq === kit.jump)
    // two records, the second carrying the dy: the wind-up cel, then the tuck
    id = seq[p.windup > 0 || p.airFrames === 0 ? 0 : seq.length - 1];
  else if (seq === ANIM.crouch)
    // moving while ducked is the crawl, clocked by ground covered like every
    // gait; still is the held duck, with its rare settle fidget over it
    id = p.moving
      ? ANIM.crawl[
          Math.floor(p.travelled / crawlStridePx()) % ANIM.crawl.length
        ]
      : p.fidget === ANIM.crouchFidget
        ? ANIM.crouchFidget[
            Math.min(ANIM.crouchFidget.length - 1, Math.floor(p.fidgetClock))
          ]
        : ANIM.crouch[0];
  else if (seq === ANIM.land)
    id =
      ANIM.land[Math.min(ANIM.land.length - 1, ANIM.land.length - p.landLeft)];
  else if (seq === ANIM.air && p.landLeft > 0) {
    // the hard landing, four frames a cel on the ground
    const f = Math.floor((ANIM.air.length * AIR_HOLD - p.landLeft) / AIR_HOLD);
    id = ANIM.air[Math.min(ANIM.air.length - 1, f)];
  } else if (seq === ANIM.air) {
    // the wind-up on the ground — 250 251 252 as the count runs down — then 253
    // for the launch frame, then the TUCK: 200 on the frame tag 0 is installed
    // and 220 held after. A run's leap is tag 4's single 200, then the same.
    if (p.windup > 0) id = ANIM.launch[ANIM.launch.length - 1 - p.windup];
    else if (p.leap)
      id =
        ANIM.tuck[Math.min(ANIM.tuck.length - 1, Math.max(0, p.airFrames - 1))];
    else if (p.airFrames === 0) id = ANIM.launch[ANIM.launch.length - 1];
    else id = ANIM.tuck[Math.min(ANIM.tuck.length - 1, p.airFrames - 1)];
  } else {
    const f = Math.floor(p.travelled / stride) % seq.length;
    // the footfalls, and the engine fires them off the CYCLE's frame number
    // rather than off a timer or a distance: `0x429b3d` plays skulz 0 on frame 1
    // and `0x429b5c` plays skulz 1 on frame 6, in the walk state and again in the
    // run's own branch. Twelve cels, two steps, whatever the speed.
    if (
      f !== lastGaitFrame &&
      (seq === ANIM.walk || seq === ANIM.run || seq === ANIM.crawl)
    ) {
      const which = OWN.stepFrames.indexOf(f as 1 | 6);
      if (which >= 0 && p.onGround) sound?.own(OWN.step[which], p.x, p.y);
      lastGaitFrame = f;
    }
    id = seq[f];
  }
  // which cel is on screen, for the status line and for the probes: an animation
  // that has stopped animating is invisible to every other assertion here
  lastCel = id;
}


/**
 * The goal, once a tick: a player who has stepped out of its rect since the
 * level began may be let in by it ({@link leftGoal}), and a craft that has
 * opened for them ends the level.
 */
export function stepGoal(): void {
  const goal = solids().goal;
  const box = playerBox();
  const inGoal =
    goal !== undefined &&
    box.right > goal.left &&
    box.left < goal.right &&
    box.bottom > goal.top &&
    box.top < goal.bottom;
  if (!inGoal) leftGoal = true;
  if (craftOpened() && !advancing) void nextLevel();
}

/**
 * Where every thing that can strike or be struck stood as the frame began —
 * see {@link hitPass}. Built on the frame tick, before anything moves.
 */
let frameStart: { o: { x: number; y: number }; x: number; y: number }[] = [];

function standing(): { o: { x: number; y: number }; x: number; y: number }[] {
  const all: { x: number; y: number }[] = [p, ...spawnedHere(), ...casts, ...crowsHere(), ...heads, ...rollers];
  for (const b of hereOf((l) => l.boggs)) all.push(b, ...b.machines, ...b.worms);
  for (const c of hereOf((l) => l.claws)) all.push(c);
  return all.map((o) => ({ o, x: o.x, y: o.y }));
}

/**
 * The frame's hit pass — `0x430350`, and WHERE it runs in the frame is the
 * point of this function.
 *
 * Every chapter's frame loop has one shape (VAT's `0x419c0b`..`0x419e35`,
 * STREETS' `0x44dcfc`..`0x44de83`, MALL's `0x43702c`..`0x4371a6`, GRAVE's
 * `0x41fa18`..`0x41fb6a` and the other twelve alike): the chapter's end
 * test, the player's think (`0x402950`), every class's think (`0x430f10` per
 * class), and then `0x42fc10`, which in one call steps every object's script
 * (`0x45d0f0`), fetches each current cel's rects (`0x42f9f0`), runs the body
 * pass (`0x430680`), runs THIS pass for every object as the hitter
 * (`0x42fc9a`), moves the platforms, and only then moves every object
 * (`0x42fd80`) and the camera (`0x4309f0`). VAT alone places Boggs' rig after
 * it (`0x41c4c0`, `0x411ed0`, `0x412180`, `0x41ab90`); then the draws.
 *
 * So a blow is judged on the cel this frame's think and script step put up,
 * at the place the LAST frame's move left everything. This page runs its
 * thinks and moves together across the frame's four ticks, so the pass waits
 * for the frame tick's thinks to be done and puts everything back at its
 * frame-start place while it runs; whatever the pass itself moves is kept.
 * The body pass comes first, as it does in `0x42fc10`; the flares and bolts,
 * whose steps run the same frame, carry the place they stood in
 * ({@link Flare.was}, {@link Bolt.was}) and are tested there.
 */
export function hitPass(ladder: boolean): void {
  const back = frameStart.map((s) => ({ ...s, dx: s.o.x - s.x, dy: s.o.y - s.y }));
  for (const s of back) {
    s.o.x = s.x;
    s.o.y = s.y;
  }
  // `0x430680` first, on the same cels and the same frame-start places: what
  // it takes off `obj+0xc` is taken now, as the hit's trade is — a walker's
  // along its facing in its walk, anything else's in `e.vx`
  bodyPush(ladder);
  for (const [e, pushed] of pushes) {
    if (e.rolling) e.speed = (e.speed ?? 0) + pushed * e.facing;
    else e.vx += pushed * TICK_SCALE;
  }
  pushes.clear();
  if (p.act) landHits();
  takeHits();
  foesStrikeFoes();
  flareHits();
  boltHits();
  for (const s of back) {
    s.o.x += s.dx;
    s.o.y += s.dy;
  }
  frameStart = [];
}

/**
 * One tick of the game — a quarter of an engine frame (see {@link INVENTED}).
 * Everything that happens in the world happens here; {@link loop} only paces
 * it against the clock and draws what it left.
 */
export function tick(): void {
  // the red's fade holds the whole world still — a tick is the sixtieth that
  // `0x42942d` spins on, so each one is a step of it and nothing else
  if (deathRed && deathRed.step < DEATH_RED.steps) {
    stepDeathRed(false);
    return;
  }
  // where the tick started, so a fall can be tested along the path it took
  const tickX = p.x;
  // one ENGINE frame in four ticks: the player's state machine, the impulses and
  // gravity all belong to the frame tick; the ticks between only move
  p.frameAcc += TICK_SCALE;
  const frame = p.frameAcc >= 1 - 1e-9;
  if (frame) p.frameAcc -= 1;
  // the stage-end tally holds the whole world still — {@link startTally}
  if (craft?.tally) {
    if (frame) stepTally(craft);
    return;
  }
  stepDeathRed(frame);
  // where everything stands before this frame moves it — {@link hitPass}
  if (frame) frameStart = standing();
  // `0x4309f0` is an engine-frame job like everything else in here; the step it
  // decides is spent across this frame's four ticks
  if (frame) stepCamera();
  if (frame) backdropFrames += 1;
  // `0x4087c0` counts sixtieths, and an engine frame is four of them
  if (frame) blowClock += 4;
  driftCamera();
  // an attack owns the player until it finishes — and it can start in the
  // air, which is where the flying moves live
  // (and state 15, INV held, reads no other key at all — `0x428975`)
  if (frame) stepInv();
  if (p.onGround && !p.act && p.windup === 0 && p.landLeft === 0 && !p.invLoop) {
    // W picks the bigger variant of either, which is what both state machines
    // do with `0x4ac3fe` before they look at their own button
    const big = held.up ? "Run" : "";
    // the punch tosses a coin: `0x42a400` calls `0x434540(2)` and adds it to
    // the base tag, so repeated presses alternate between two animations. The
    // kick does not — `0x42a670` picks its tag from the keys alone. BOTH
    // together are their own move: the 650s headbutt (`0x429706`).
    const both =
      (punchPressed && (kickPressed || held.kick)) ||
      (kickPressed && held.punch);
    // S is the pickup button and the duck button, and which one it is depends
    // entirely on what is 35 pixels in front of you: `0x4298a1` calls the reach
    // handler every frame S is held, and `0x42f081` ducks only when the probe
    // came back empty. See {@link GRAB}.
    if (held.down && gunAhead()) {
      p.act = "reach";
      // `0x42f0dc` — a GUN whose code is not the weapon you are holding makes
      // you throw yours down, BEFORE the reach plays; a refill never does.
      // `0x42f0b2` compares the pickup's CODE with `0x479434`, so the
      // statscepter (17) throws even the scepter (16) away
      const code = gunAhead()!.code;
      if (inv.armed && GRAB.drops.includes(code) && code !== inv.weapon)
        dropGun();
    }
    // ...and with a gun in your hands P is not a fist any more. The five armed
    // state machines read P (`[0x4ac394]`) and install their own wind-up tag;
    // none of them has a kick at all.
    else if (inv.drawn && punchPressed && !held.down) p.act = "fire";
    else if (both) p.act = held.down ? "duckCombo" : "headbutt";
    else if (punchPressed)
      p.act = held.down
        ? "duckPunch"
        : `punch${big}${random() < 0.5 ? "" : "2"}`;
    else if (kickPressed && p.running) {
      // the RUN handler's own kick (`0x429db9`) is the FLYING KICK — tag 4 of
      // `0x471d68`, whose first record carries its own leap: dx 190, dy -310
      p.act = "flyingKick";
      // the record's own -26 up and 16 forward go into the velocity from the
      // act's first frame below, the way every act record's dx and dy do
      p.leap = true;
    } else if (kickPressed) p.act = held.down ? "duckKick" : `kick${big}`;
    if (p.act) {
      p.actClock = 0;
      p.fired = false;
      struck.clear();
      struckCrows.clear();
      struckHeads.clear();
      struckBoggs.clear();
      swing();
    }
  } else if (!p.onGround && !p.act && !p.flail && p.windup === 0) {
    if (p.launched) {
      // mid-flight, the kind-3 handler accepts both buttons once the launch
      // is done (`0x42a036`, `0x42a082`): K is tag 8, P is tag 9 — the
      // flail's handler reads neither
      if (kickPressed) p.act = "airKick";
      else if (punchPressed) p.act = "airPunch";
    } else if (p.fallState && !inv.drawn && !p.invLoop) {
      // off a ledge the player is still in a GROUND state ({@link
      // Player.fallState}), and its handler plays its own ground moves in the
      // air. The idle (`0x4296fc`..`0x4297b5`) asks for both buttons first,
      // then P, then K; the run (`0x429d6a`, `0x429daf`) for P and then K, and
      // its K is the flying kick
      const big = held.up ? "Run" : "";
      // the punch's coin is tossed only when there is a punch — every roll
      // moves the dice on for everything else in the level
      const coin = (): string => (random() < 0.5 ? "" : "2");
      if (p.fallState === "run") {
        if (punchPressed) p.act = `punch${coin()}`;
        else if (kickPressed) {
          p.act = "flyingKick";
          p.leap = true;
        }
      } else if (punchPressed && (kickPressed || held.kick)) p.act = "headbutt";
      else if (kickPressed && held.punch) p.act = "headbutt";
      else if (punchPressed) p.act = `punch${big}${coin()}`;
      else if (kickPressed) p.act = `kick${big}`;
      if (p.act) p.fired = false;
    }
    if (p.act) {
      p.actClock = 0;
      struck.clear();
      struckCrows.clear();
      struckHeads.clear();
      struckBoggs.clear();
      swing();
    }
  }
  if (p.act) {
    let a = actOf(p.act);
    let f = a ? Math.floor(p.actClock / (a.hold ?? 1)) : 0;
    /**
     * The flight's attacks END on the ground, not with their script. The
     * player's scripts never loop (`0x45d070` clears `obj+0x4a` and nothing
     * sets it again), so a tag that runs out HOLDS its last cel, and:
     *
     * - tags 8 and 9 (`0x42a1e3`) leave only once the tag has ended AND the
     *   player is down (`0x42a33a`) — a kick that runs out in the air holds
     *   689 to the ground, and one that lands early plays out on it before
     *   the landing;
     * - the flying kick's tag 4 (`0x42a7b0`) goes on to tag 3 once it has
     *   ended and is falling at 32 or more, is down, or has connected
     *   (`obj+0x2a`, the collision word); tag 3 (`0x42a784`) holds to the
     *   ground and then goes to the idle.
     */
    const connected = struck.size + struckCrows.size + struckBoggs.size > 0;
    if (a && f >= a.cels.length && p.act === "flyingKick" && (p.onGround || p.vyRaw >= 32 || connected)) {
      p.act = "flyingKickEnd";
      p.actClock = 0;
      a = actOf(p.act);
      f = 0;
    }
    const holds =
      !!a &&
      f >= a.cels.length &&
      ((!p.onGround &&
        (p.act === "airKick" || p.act === "airPunch" || p.act === "flyingKick" || p.act === "flyingKickEnd")) ||
        // state 27 installs nothing (`0x429454`): the body lies in the dying
        // script's last cel until the checkpoint
        (p.act === "dying" && !!deathRed));
    if (!a || (f >= a.cels.length && !holds)) {
      // the reach ENDS in the take — `0x4287bd` is the kind-14 state, and it
      // probes the band a second time rather than remembering what it found
      if (p.act === "reach") takeGun();
      // ...but a HELD state does not end with its script. `0x4286e4` reinstalls
      // `0x4720e8` tag 0 every time the script reports itself finished, and
      // only the grabber letting go gets you out — see {@link stepHeld}.
      // a HELD weapon keeps firing while the button is down: its state
      // machine sits on the firing tag and calls the fire function again
      // every frame, and `-2` only goes out when the tag is left
      if (
        p.act === "fire" &&
        STREAMS[inv.weapon] &&
        held.punch &&
        roundsIn(inv.weapon) > 0
      ) {
        // ...and it goes back to the SHOT pose, not to the wind-up. The
        // flamer's gun rises through 1240..1242 once and then works out of
        // 1243/1244 (`0x46faf8` tag 0, whose own tail is 1243 1244), and the
        // muzzle offset the flame is drawn at belongs to those two cels. A
        // loop that replayed the rise would drop the gun under its own flame
        // once a second. A weapon with no shot pose restarts where it did.
        const back = WEAPONS[inv.weapon]?.moveset.shot.length
          ? (WEAPONS[inv.weapon]?.moveset.fire.length ?? 0) * (a?.hold ?? 1)
          : 0;
        p.actClock = back;
        p.fired = true;
      } else if (p.heldBy) {
        p.act = "held";
        p.actClock = 0;
      } else if (
        /^punch(Run)?2?$/.test(p.act) &&
        ACTIONS.punchStep &&
        p.onGround &&
        (p.facing > 0 ? held.right : held.left)
      ) {
        // a punch tag ending with forward down steps after the blow —
        // `0x42a513` / `0x444e94` install the punch script's step tag
        // rather than the idle ({@link PlayerActions} `punchStep`)
        p.act = "punchStep";
        p.actClock = 0;
      } else {
        if (p.act === "fire") shutStreams();
        // a ground move that ends in the air hands back to the idle, still
        // falling: the punch and kick states' ends all install `0x471648`
        // (`0x42a526`, `0x42a5fb`, `0x42a870`), and the idle reads no floor
        if (!p.onGround && !p.launched) p.fallState = "idle";
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
      /**
       * `0x42cd53` calls the weapon's fire function once the wind-up TAG has
       * ended (`cmp word ptr [eax+0x46], 0`), and the tag after it is the
       * pose held while the thing is in the air.
       *
       * Three of the five weapons have no such second tag — the flamer, the
       * soaker and the scepter hold nothing, they pour — so waiting for a
       * frame past the wind-up means waiting for a frame the act does not
       * have, and they never fired at all. The end of the wind-up is the
       * trigger; whether a shot pose follows it is the weapon's business.
       */
      const windUp = WEAPONS[inv.weapon]?.moveset.fire.length ?? 1;
      const after = WEAPONS[inv.weapon]?.moveset.shot.length ?? 0;
      if (p.act === "fire" && !p.fired && f >= windUp - (after ? 0 : 1)) {
        p.fired = true;
        fireGun();
      }
      /**
       * The record's own dx and dy, into the VELOCITY — `0x45d0f0` hands both
       * to `0x42f8b0`, which adds `round_away(d / 12)` to `obj+0xc`/`obj+0xa`
       * once for every engine frame the record shows. The mover then carries
       * it and the ground's drag takes it back, exactly as it does the walk's
       * impulse, so the headbutt's three frames of +95 are 8, 11 and 12
       * pixels and not three flat eights. The walk's own mover keeps the
       * player in the world.
       *
       * A lift only leaves the ground if it clears the landing's reach:
       * `0x42ff56` puts anything within 8 of its floor back on it, so the
       * duck combo's `-80` (7 a frame) never gets the player off the floor
       * and the flying kick's `-310` (26) does.
       */
      // the striking tag's handler asks `0x4029e0` once a frame — see
      // {@link blowStrength} — before this frame's cel lands anything
      if (frame && a.move && f >= a.move.from) {
        blowStrength(held.punch && a.move.held ? a.move.held : a.move.id);
        // ...and the punch tags turn you round on the way: `0x42a4c4` (and
        // `0x42a55b`) call `0x402e40` when backward is down, and the kick's
        // handlers do not
        const back = p.facing > 0 ? held.left && !held.right : held.right && !held.left;
        if (back && /^punch(Run)?2?$/.test(p.act)) p.facing = -p.facing as 1 | -1;
      }
      const hold = a.hold ?? 1;
      const entering =
        p.actClock === 0 ||
        Math.floor((p.actClock - TICK_SCALE) / hold) !== f;
      if (entering) {
        const dx = a.dx[f] ?? 0;
        const dy = a.dy?.[f] ?? 0;
        if (dx) p.vx += p.facing * roundAway(dx / DIVISOR);
        const lift = dy ? roundAway(dy / DIVISOR) : 0;
        if (lift && (!p.onGround || -lift > STICK_PX)) {
          p.vyRaw += lift;
          engineFrame();
          p.vy = p.stepPx * TICK_SCALE;
          p.onGround = false;
          p.airFrames = 0;
        }
      }
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
  // The latch goes on the ground OR once the fall passes 55: `0x42848a`
  // clears `[0x46b1b8]` unless `obj+0x32 <= 0x37` and the player is airborne,
  // so a long drop off a ladder may grab the next one on the way down.
  if (p.onGround || p.fallPx > 0x37) ladderLatch = false;
  const asked = held.right !== held.left || held.jump || jumpPressed;
  // `0x42ae6f` — knocked off asks as a key does, and `0x42aea1` spends it once
  // the rung is done, whether or not a room lets him go
  const bumped = p.climbing && !asked && knockedOff;
  if (p.climbing && (asked || knockedOff) && p.climbClock >= LADDER.rungFrames) knockedOff = false;
  const letGo = p.climbing && (asked || bumped) && canLetGo();
  let ladder: SbkEntity | undefined;
  if (p.climbing) ladder = p.act || letGo ? undefined : p.ladder;
  else if (
    !p.act &&
    !p.flail &&
    !ladderLatch &&
    (held.down || (held.up && held.right === held.left))
  )
    ladder = ladderAt();
  /**
   * ...and the other thing the same W reach finds — see {@link MONKEYBAR}.
   *
   * `0x412390` answers `monkeybar` only after `ladder`, `exitfarm` and
   * `exitroom` have all missed, so the bar is asked for last. Letting go is
   * S or J and **only out of the hang tag**: `0x42b522` is in tag 0's arm
   * and no other arm tests for it, so a swing always finishes.
   */
  const barLetGo =
    !!p.bar && p.barTag === 0 && (held.down || held.jump || jumpPressed);
  let bar: SbkEntity | undefined;
  if (p.bar) bar = p.act || barLetGo ? undefined : p.bar;
  else if (
    !ladder &&
    !p.act &&
    !p.flail &&
    !ladderLatch &&
    held.up &&
    held.right === held.left
  )
    bar = barAt();
  // ...and INV stands you still: state 15 reads no direction at all, and the
  // idle it hands you to goes straight back to it while the button is down
  const dir =
    ladder || bar || p.act || p.invLoop
      ? 0
      : (held.right ? 1 : 0) - (held.left ? 1 : 0);
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
  p.running =
    p.moving && held.up && ladder === undefined && bar === undefined && !held.down;
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
    else p.fallState = null;
    // the drag closes the frame before — `0x4302c0`, grounded frames only
    if (p.onGround) p.vx = dragged(p.vx);
    /**
     * The preamble, before any state's handler: `0x4284ba` (and `0x442f3f`
     * for character 1) installs the flail script the moment `obj+0x32` —
     * the fall so far — passes 360, whatever the player was doing, unless
     * they are already flailing, down or dead (kinds 25..27). An attack or
     * a jump in progress is simply replaced.
     */
    if (
      !p.onGround &&
      !p.flail &&
      p.fallPx > HURT.flailFall &&
      p.act !== "dying"
    ) {
      p.flail = true;
      inv.drawn = false; // `0x472350` is kind 25, and it ends on `0x471648`
      p.launched = false;
      p.fallState = null;
      p.landLeft = 0;
      if (p.act === "fire") shutStreams();
      p.act = null;
      p.gravityScale = 1;
    }
    // ---- think: the input handler
    if (p.flail) {
      // `0x4291e5`: kind 25 zeroes `obj+0xc` every frame and reads no key —
      // a flailing player drops straight down — and past 630 it screams
      // (`0x429211`). The landing is the body's, below.
      p.vx = 0;
      // asked every frame past it, through `0x40ef30`: the mixer turns the ask
      // away while the scream still sounds, and a long enough fall screams again
      if (p.fallPx > 0x276) sound?.own(KIT.flailSound, p.x, p.y);
    } else if (p.landLeft > 0) {
      // tag 1, or 0x471c68's tag 5: `0x42a182` reads ESC and nothing else until
      // the script ends on the ground. The keys do nothing; the slide is the drag's
      p.landLeft -= 1;
    } else if (p.act === "airKick" || p.act === "airPunch") {
      // `0x42a1e3`, tags 8 and 9: the same lift and the same steering as the
      // flight's own tag 0, on the ground too until the tag ends — the keys
      // themselves, since an act takes the walk's direction away
      airThink((held.right ? 1 : 0) - (held.left ? 1 : 0));
    } else if (p.onGround && p.launched) {
      // `0x42a0f0`, the tag-0 handler's first grounded frame: the allowance back
      // to 2 and `0x471b28` tag 1 with sound 4. Its other arm, `0x42a109`'s
      // fall past 360, is never taken: the preamble has already put any such
      // fall into the flail, whose own landing is the hard one
      p.launched = false;
      p.hold = HOLD_FRAMES;
      p.hardLand = false;
      p.landLeft = ANIM.land.length;
      sound?.own(OWN.land, p.x, p.y);
    } else if (!p.onGround) {
      if (p.launched && p.airFrames >= 2) airThink(dir);
      // a walk or run that left the ground without a jump has no steering: the
      // walk state installs the idle script's tag 1 (`0x42999e`) and the run
      // its own tag 1 (`0x429bf0`), and neither handler reads a direction —
      // but both read J, and neither asks whether there is a floor
      else if (p.fallState && p.windup === 0 && jumpPressed && !p.act && !p.invLoop)
        startJump(p.fallState === "run", false);
    } else if (p.windup === 0) {
      if (dir) p.facing = dir;
      if (jumpPressed && !p.act && !p.invLoop) startJump(p.running, p.moving);
    }
    // ---- animate: the current record's dx/dy through the mover, `0x45d196`
    // (a launch tag plays to its end wherever the player is: the jump state's
    // `0x42a1c2` waits for the tag and reads no floor)
    if (p.landLeft === 0 && (p.onGround || p.windup > 0)) {
      if (p.windup > 0) {
        p.windup -= 1;
        if (p.windup === 0) {
          // the launch record: dy -420 and tag 3's dx 100 or tag 4's dx 180,
          // each divided once, away from zero, into the velocity — -35, 9, 15
          p.vyRaw += roundAway(
            -(p.leap ? MEASURED.runJumpDy : MEASURED.jump) / DIVISOR,
          );
          p.vx += p.facing * roundAway(p.launchDx / DIVISOR);
          p.onGround = false;
          p.launched = true;
          p.fallState = null;
          p.airFrames = 0;
          p.hold = HOLD_FRAMES;
        }
      } else if (dir && p.onGround) {
        // the gait's own dx: the walk's 95, the run's 180, and ducked it is the
        // CRAWL — 0x4717c8 tag 4's 47, which cannot run
        const dx = held.down
          ? MEASURED.crawl
          : p.running
            ? MEASURED.run
            : MEASURED.walk;
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
  // ...and the side walls hold a point that is not moving too: the mover asks
  // them of every frame's point (`0x430058`), which is what stands BARREL's
  // opening record, x12 against a floor from x51, on x52 (`0x43006b`)
  if (!ladder && p.vx === 0 && p.room && level) {
    const nx = sideWalls(p.x);
    if (nx !== null) p.x = nx;
  }
  if (!ladder && p.vx !== 0) {
    let nx = p.x + p.vx * TICK_SCALE;
    /**
     * The region's side walls — `0x42ffa3`..`0x430146` — asked of the anchor
     * point. The bounds are `0x40bbd0`'s, filled at `0x42fde7` into the rect
     * `0x430058` and `0x4300cf` compare against: the region's own floor,
     * `x0 .. x0 + n` (`0x40bc66`), or its rect less fifty each end where it has
     * no floor (`0x40bc92`) — see {@link insideSides}. The flags are the
     * region record's (`0x40ba30` copies it). Nothing reserves half a sprite:
     *
     * - past the left edge with flag 2 set, the point is held at left + 1
     *   (`0x43006b`); with it clear, the region whose rect holds the point
     *   takes over (`0x40b940(2, point)`, `0x4300a0`), and with none it is
     *   held at the edge all the same (`0x4300c3`);
     * - the right edge the same, with flag 8 (`0x4300e2`, `0x430117`).
     *
     * MALL's three regions meet with the flags clear, so you walk from one into
     * the next; STREETS' ends are walls; and every region is walked the length
     * of its FLOOR, not its rect.
     */
    let inRoom = true;
    const from = p.room;
    const wallAt = sideWalls(nx);
    if (wallAt !== null) {
      nx = wallAt;
      if (nx === p.x) inRoom = false;
    }
    // world. Off a platform you certainly can: the floor is still under it.
    // ...and the wall below is asked first in the engine (`0x42fedc`, before
    // the side test at `0x430058`), so of the region the move STARTED in: at
    // MALL's seam region two's floor stands 94 higher four pixels before
    // region one's ends, and asked of region two it walled the hand-over off
    const handed = p.room;
    p.room = from;
    const ahead = groundAt(nx);
    p.room = handed;
    // and a floor that rises more than a step is a wall, not a slope. Without
    // this the player walks INTO the terrain and then falls through it
    // forever, because everything solid is now above them: BARREL's floor
    // climbs 141px between two adjacent columns.
    //
    // `0x42fedc` asks it of every move, in the air as much as on the ground,
    // and excuses it only where a platform stands under the point above that
    // floor (`0x42feec`, the platform search's flag): then the platform is
    // the floor. A wall in the air also stops the rise — `0x42ff0c` zeroes
    // `obj+0xa` with the move — so a jump that meets a step more than 50 above
    // its feet drops back rather than climbing it.
    const bridged =
      ahead !== null &&
      !!level?.solids.some((room) =>
        room.platforms.some(
          (e) =>
            nx >= e.left && nx <= e.right && e.top < ahead && e.bottom >= p.y,
        ),
      );
    // ...and it is asked of the position the WHOLE frame's move reaches:
    // `0x42fd9e` adds both velocities before `0x42fedc` compares, so the
    // launch frame's 35 pixels of rise count against a step it is jumping
    // at. This page spreads that rise across four ticks, so the frame's own
    // step stands in for it.
    const reachY = p.onGround ? p.y : p.y + Math.min(0, p.stepPx);
    const wall = ahead !== null && ahead < reachY - CLIMB_PX && !bridged;
    if (inRoom && !wall) {
      p.travelled += Math.abs(nx - p.x);
      p.x = nx;
    } else if (wall) {
      /**
       * A wall — `0x42fef3`..`0x42ff30`, on the ground as much as in the air:
       * nothing on that path asks whether the feet are down, so a walk into a
       * step more than 50 high is thrown back the frame's vx as a jump is.
       * The point goes back to where the frame began LESS the frame's vx
       * (`0x42ff13`), the vx keeps
       * `obj+0x20`'s quarter (`0x42ff0c`), and `obj+0xa` is zeroed — before
       * `0x43032e` adds this frame's gravity, so the next frame falls again.
       * Zeroing it after the gravity, and standing the player where the move
       * stopped, held a jump that met a wall hanging in the air for good:
       * GRAVE's graves have one at each side of the mouth.
       */
      p.x -= p.vx;
      p.vx = Math.trunc(p.vx / 4);
      if (!p.onGround) {
        p.vyRaw = PLAYER_GRAVITY * p.gravityScale;
        p.stepPx = 0;
      }
    } else p.vx = 0;
  }

  // up opens a door and climbs a ladder; jump is its own key, as it is in the
  // original. A touch still sends both, so a door still has to CONSUME the
  // press — otherwise the tap that opens it also jumps, and the player
  // arrives in the next room already in the air.
  // ...and only from a STANDSTILL, now that the same key is the run. Otherwise
  // every sprint past a doorway ends in the next room, which is the trap this
  // door already had once, arrived at from the other direction.
  if (upPressed && p.onGround && dir === 0 && takeDoor())
    upPressed = jumpPressed = false;
  const wasClimbing = p.climbing;
  p.climbing = ladder !== undefined;
  const wasHanging = p.bar !== undefined;
  p.bar = bar;
  // the climb `0x471e78` is kind 7 and the bar `0x472048` kind 8, and both end
  // on the unarmed fall `0x471b28` (`0x42af84`, `0x42b597`): the gun goes away
  // on the way up and INV is what brings it back
  if (ladder || bar) inv.drawn = false;
  if (ladder) {
    /**
     * Step ONTO it, where the record says and facing the way it says.
     *
     * Where the record says and facing the way it says: `0x42b2b2` writes the
     * record's own `pointX` straight into the player's x and `0x42b279` turns
     * them by the sign of the spacing, so neither is a snap of this page's
     * invention any more. {@link ladderAt} has the trigger the engine tests.
     */
    const spacing = Math.abs(ladder.param) || 35;
    const last = Math.floor((ladder.bottom - ladder.top) / spacing);
    // the resting cel's own box is how far the feet hang below the anchor, and
    // the anchor is what a rung IS
    const rest = celRec(player, LADDER.restCel);
    const feet = rest?.body ? rest.body.y1 : 96;
    if (!wasClimbing) {
      p.ladder = ladder;
      p.x = ladder.pointX;
      // `0x42b279`: a positive spacing wants `obj+0x28` SET and a negative one
      // wants it clear — which, for the player's book, is facing left and facing
      // right. See {@link LADDER}: the sign is the ladder art's own mirror flag,
      // so `+35` is rungs pointing east, and you climb those from the east side
      // facing back into them
      p.facing = ladder.param < 0 ? 1 : -1;
      // `0x42b300`: the rung you arrive on is the one above where you stood, and
      // the y it measures is the ANCHOR — `obj+6` as the pose you grabbed from
      // left it, which is the standing cel's 88 above the feet, not the climb
      // cel's 96
      const anchor = p.y - p.feet;
      p.rung =
        anchor > ladder.top
          ? Math.max(0, Math.floor((anchor - ladder.top) / spacing) - 1)
          : 0;
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
        // ...and a tag is INSTALLED only when there is a rung to take or a
        // direction to turn to. At rung 0 with W held — `cmp [0x4ac406], 0;
        // jle` in `0x42afc4` and `0x42b054` — or at the last with S
        // (`0x42b134`, `0x42b1cd`), the case is skipped whole: no tag, no
        // sound, and the cel HOLDS. This page installed the other tag of the
        // same direction instead, four frames each way, and the player
        // flickered at the top of every ladder in the game.
        let installed = true;
        if (held.down) {
          if (t === 2 || t === 3) {
            if (p.rung < last) {
              p.rung += 1;
              p.climbTag = t === 2 ? 3 : 2;
            } else installed = false;
          } else p.climbTag = t === 0 ? 3 : 2;
        } else if (held.up) {
          if (t === 0 || t === 1) {
            if (p.rung > 0) {
              p.rung -= 1;
              p.climbTag = t === 0 ? 1 : 0;
            } else installed = false;
          } else p.climbTag = t === 2 ? 1 : 0;
        } else installed = false;
        // nothing installed: the animation stays ended and the cel holds
        p.climbClock = installed ? 0 : LADDER.rungFrames;
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
    /**
     * ...and the region you are in is whichever one contains your point — on
     * THIS axis as much as on the other.
     *
     * The walk already re-asks `0x40b940(2, point)` every time it moves the
     * player sideways. Nothing re-asked it when the player moved UP, because
     * until now nothing moved the player far enough for it to matter. A
     * ladder does: seven of the nine reach out of the region they start in,
     * TOWER's second spans three and its third spans four, and MAZE's first
     * runs 1426px from room 1 down into room 5. Without this the climb tops
     * out still standing in the room below — which has no floor up there and
     * none of the platforms the ladder was put there to reach.
     */
    const here =
      !!p.room &&
      p.x >= p.room.left &&
      p.x <= p.room.right &&
      p.y >= p.room.top &&
      p.y <= p.room.bottom;
    if (!here) {
      const into = level?.rooms.find(
        (r) =>
          p.x >= r.left && p.x <= r.right && p.y >= r.top && p.y <= r.bottom,
      );
      if (into) p.room = into;
    }
    p.onGround = false;
  } else if (bar) {
    /**
     * State 8 — `0x42b410`, and its preamble runs before the dispatch does.
     *
     * Both velocities to zero, the anchor back on the record's `top` and x
     * clamped into `left..right`, every frame and whatever the tag. See
     * {@link MONKEYBAR}.
     */
    p.vx = 0;
    p.vy = 0;
    p.vyRaw = 0;
    p.stepPx = 0;
    if (p.x > bar.right) p.x = bar.right;
    if (p.x < bar.left) p.x = bar.left;
    const spacing = Math.abs(bar.param) || 65;
    // the swing reads the keys RAW: `dir` above is already zero because a
    // hanging player does not walk, and these are the engine's own two
    // flags, `[0x4ac3d2]` toward and `[0x4ac38c]` away, which are relative
    // to the facing and not to the screen
    const barDir = (held.right ? 1 : 0) - (held.left ? 1 : 0);
    const toward = barDir !== 0 && barDir === p.facing;
    const away = barDir !== 0 && barDir !== p.facing;
    if (!wasHanging) {
      // `0x42ef11` — tag 0, and nothing is snapped on the grab: you hang
      // where the jump put you and the first swing puts you on the grid
      p.barTag = 0;
      p.barClock = 0;
    } else if (p.barTag === 0) {
      // `0x42b4bf` reads toward, away and W in that order
      if (toward || away) {
        p.barTag = toward ? 1 : 2;
        p.barClock = 0;
      } else if (held.up) {
        p.barTag = 3;
        p.barClock = 0;
      }
    } else {
      const swinging = p.barTag === 1 || p.barTag === 2;
      /**
       * Which way the body is actually going, which is not the facing: tag 1
       * carries `dx +120` and tag 2 carries `-120`, and `0x45d18e` mirrors
       * either by `obj+0x28`. Nothing on a monkeybar ever turns the player,
       * so a westward swing is a player facing east playing tag 2.
       */
      const way = p.facing * (p.barTag === 1 ? 1 : -1);
      // the script's own `dx`, spent by `0x45d0f0` on EVERY frame and not
      // once a cel — `0x42b410` zeroes the velocity again next frame, so
      // what it really amounts to is 10 pixels of travel an engine frame
      if (swinging) p.x += way * (MEASURED.barSwing / DIVISOR) * TICK_SCALE;
      const before = MONKEYBAR.tagStart[p.barTag] + Math.floor(p.barClock / 2);
      p.barClock += TICK_SCALE;
      const frame = MONKEYBAR.tagStart[p.barTag] + Math.floor(p.barClock / 2);
      if (frame !== before)
        for (const hand of MONKEYBAR.soundAt[p.barTag] ?? [])
          if (hand.frame === frame) sound?.own(hand.own, p.x, p.y);
      const len = swinging ? MONKEYBAR.handFrames : MONKEYBAR.pullFrames;
      if (p.barClock >= len) {
        if (swinging) {
          /**
           * The snap — and the `+1` belongs to TRAVELLING EAST, not to the
           * facing, which is the thing that is easy to read wrong here.
           *
           * All four arms are written out separately in the executable and
           * only two of them carry the `inc`: `0x42b621` is tag 1 with
           * `obj+0x28` clear and `0x42b77b` is tag 2 with it set. Both of
           * those are the body going east — where truncation leaves you
           * short of the hold above — and the two without it are the body
           * going west, where truncation has already carried you past the
           * hold below. Take the facing alone and a westward swing snaps
           * fifteen pixels back east every time it completes.
           */
          const n =
            p.x > bar.left
              ? Math.trunc((p.x - bar.left) / spacing) + (way === 1 ? 1 : 0)
              : 0;
          p.x = Math.max(
            bar.left,
            Math.min(bar.right, bar.left + n * spacing),
          );
          // `0x42b67a` / `0x42b7a6`: the SAME direction carries on, W goes
          // to the chin-up, and anything else drops back to the hang. The
          // opposite direction is not tested, so a reversal costs a tag.
          const keep = p.barTag === 1 ? toward : away;
          p.barTag = keep ? p.barTag : held.up ? 3 : 0;
          p.barClock = 0;
        } else if (p.barTag === 3) {
          // `0x42b7ff` — W still down and the last cel simply HOLDS
          if (held.up) p.barClock = MONKEYBAR.pullFrames;
          else {
            p.barTag = 4;
            p.barClock = 0;
          }
        } else {
          p.barTag = 0;
          p.barClock = 0;
        }
      }
    }
    p.barHold = Math.round((p.x - bar.left) / spacing);
    // the anchor is the record's own `top`, and `p.y` is the feet, so the
    // hanging cel's own box is what stands between them
    const hung = celRec(player, (ANIM.bar[0] ?? [])[0] ?? 0);
    const feet = hung?.body ? hung.body.y1 : p.feet;
    p.y = bar.top + feet;
    p.feet = feet;
    p.onGround = false;
    // ...and the room is NOT re-asked, unlike the ladder: `0x42b410` never
    // calls `0x40b940`, and it does not have to — the one bar in the game
    // spans 5908..6617 inside a VAT room of 5719..6688
  } else {
    if (wasClimbing) {
      ladderLatch = true;
      p.ladder = undefined;
    }
    if (wasHanging) {
      // `0x42b53a` — gravity back to 1 and `0x471b28` tag 0, which is the
      // plain fall. No hop, no velocity, and no latch: the ladder's leave
      // sets `[0x46b1b8]` and this one does not, so you may grab again at
      // once if you can get your anchor back into the rect.
      p.vy = 0;
      p.vyRaw = 0;
      p.stepPx = 0;
      p.onGround = false;
      jumpPressed = false;
    }
    if (wasClimbing && !p.onGround && (dir || held.jump || jumpPressed || bumped)) {
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
      p.vx =
        p.facing *
        roundAway((leap ? MEASURED.runJumpDx : MEASURED.hopDx) / DIVISOR);
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
        // walked off: airborne on the gait's own velocity, with no steering,
        // and still in a ground state — see `p.fallState`
        p.onGround = false;
        p.airFrames = 0;
        p.fallState = p.running && !p.act ? "run" : "idle";
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
      // ...uncapped: the body stepper adds `obj+0x24` to `obj+0xa` every
      // airborne frame (`0x430327`) and nothing anywhere limits the sum
      p.vy = p.stepPx * TICK_SCALE;
      const ny = p.y + p.vy;
      const land = p.vy >= 0 ? surfaceCrossed(tickX, p.y, p.x, ny) : null;
      if (land !== null) {
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
      /**
       * ...and a flail's landing is the flail handler's: `0x42922c` stops
       * character 0's scream (character 1's `0x443c72` does not), and then past 530 of
       * accumulated fall the landing is fatal — straight into `0x4721a0` tag
       * 0 — and under it sound 5, `0x471c68` tag 5 and ten health off
       * (`0x4292bf`). The health and the death are behind the damage switch
       * like every other way the game takes a point off you; the roll is not.
       */
      if (p.flail && p.onGround) {
        p.flail = false;
        // `0x42923c` — character 0's scream is silenced as he lands
        // (`0x40eee0`); character 1's plays out (`0x443c72` has no such call)
        if (CHARACTER === 0) sound?.mute(KIT.flailSound, true);
        sound?.own(OWN.landHard, p.x, p.y);
        // `0x4292b7` / `0x429384` (character 1's `0x42a14b` / `0x42a38d`) — and
        // either way the view jolts
        shake(1);
        if (damageOn && p.fallPx > HURT.fatalFall && p.act !== "dying") {
          p.act = "dying";
          p.actClock = 0;
        } else if (p.act !== "dying") {
          p.act = "landRoll";
          p.actClock = 0;
          if (damageOn) takeHealth(HURT.fallDamage);
        }
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
    } else if (random() * 707 < 13 * TICK_SCALE) {
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
        if (random() * 42 < 13) {
          p.fidget = random() < 0.5 ? ANIM.fidgetA : ANIM.fidgetB;
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
  stepPlanks();
  stepElevators();
  stepIbeams();
  stepCrushes();
  stepSwitches();
  stepGoop();
  stepDoors();
  stepElevs();
  stepScenery();
  // a think, so once an engine frame: every step in it is a frame's
  if (frame) stepBushes();
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
  if (frame) stepBigGuns();
  if (frame) stepLights();
  if (frame) stepProbes();
  if (frame) stepFlypasts();
  if (frame) stepFans();
  if (frame) stepBelts();
  if (frame) stepChairs();
  if (frame) stepClaws();
  if (frame) stepFittings();
  // last of the props, because the grip is read off whatever moved just now
  if (frame) stepHeld();
  if (frame) stepBoggs();
  stepGuns();
  if (frame) stepFlares();
  if (frame) stepBolts();
  if (frame) stepStreams();
  if (frame) stepCasts();
  if (frame) stepBoards();
  if (frame) stepRollers();
  if (frame) stepCans();
  if (frame) stepHeads();
  if (frame) stepCrows();
  stepEnemies();
  // after the creatures, as WOODS' runner has it — the CHOPPER's pass
  // `0x4540d3` and then the flames' `0x4540ec` — so a flame on something
  // riding thirty a frame is where it is this frame, not where it was
  if (frame) stepFlames();
  stepGobs();
  stepCraft();
  claimBar();
  // the mission clock runs at the engine's rate, not this page's — and 32000
  // is no clock at all: `0x40d25b` returns before the `dec`
  if (stats.ticks < CLOCK.noLimit) stats.ticks = Math.max(0, stats.ticks - TICK_SCALE);
  if (stats.ticks <= 0 && !film) void ranOut();
  // `0x443dea`: the life is spent when the dying animation ENDS, not when the
  // health runs out, and `0x443ec7` turns the last one into the game-over state
  // ...and not `damageOn &&`: the switch decides whether anything may SPEND
  // health, not what an empty bar means. `harakari` empties it with the switch
  // off and the original has no switch at all
  if (stats.health <= 0 && p.act === null && !film) void died();
  if (fellOut() && !film) void died();
  upPressed = false;
  // J is read by the frame's think, not by the tick, so it waits for one
  if (frame) jumpPressed = false;
  punchPressed = false;
  kickPressed = false;
  choosePlayerCel();
  // ...and only now, every think and script of the frame done and the
  // player's cel put up, the hit pass — and the cel again, for a reaction
  if (frame) {
    hitPass(ladder !== undefined);
    choosePlayerCel();
  }
  stepGoal();
}

/** the eight buttons as one word, in the bit order `0x40da41` walks them in */
export function buttonMask(): number {
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

/**
 * `0x409a00(0xe1)` — the ink the panel typesets its key names in, out of the
 * book that holds the panel. Nothing is drawn in it until the book is loaded, so
 * this answers null-ish until then and the band simply goes unlabelled.
 */
export function panelInk(): string | undefined {
  if (!playerPal) return undefined;
  const i = LABEL.ink * 4;
  return `rgb(${playerPal[i]}, ${playerPal[i + 1]}, ${playerPal[i + 2]})`;
}

export const playerFrameCache = new Map<number, ShpFrame>();
export function playerFrame(loc: number): ShpFrame | null {
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

/** the page's writes into the game's own state — ES imports are read-only */
export function setFilm(v: typeof film): void {
  film = v;
}
export function setIface(v: typeof iface): void {
  iface = v;
}
export function setUpPressed(v: typeof upPressed): void {
  upPressed = v;
}
export function setJumpPressed(v: typeof jumpPressed): void {
  jumpPressed = v;
}
export function setPunchPressed(v: typeof punchPressed): void {
  punchPressed = v;
}
export function setKickPressed(v: typeof kickPressed): void {
  kickPressed = v;
}
export function setDamageOn(v: typeof damageOn): void {
  damageOn = v;
}
export function setFlashColour(v: typeof flashColour): void {
  flashColour = v;
}
export function setFiles(v: typeof files): void {
  files = v;
}
export function setSound(v: typeof sound): void {
  sound = v;
}
export function setPlayer(v: typeof player): void {
  player = v;
}
export function setPlayerPal(v: typeof playerPal): void {
  playerPal = v;
}
export function setStartTicks(v: typeof startTicks): void {
  startTicks = v;
}

/**
 * Stand the game up on whatever files have been set ({@link setFiles}): the
 * player's book, the level the switches name ({@link QUERY}), and what a loaded
 * game carries with it. The page calls this from its boot; a headless run calls
 * it directly. False when the rip has no player book.
 */
export async function startGame(): Promise<boolean> {
  const pb = await files.load("player.sbk");
  if (!pb) {
    ui.status("player.sbk is not in this rip");
    return false;
  }
  const book = readSbkFile(pb);
  setPlayer(book);
  setPlayerPal(paletteToRGBA(book.paletteRaw!, 256));
  const params = QUERY;
  const clock = params.get("clock");
  if (clock !== null && Number.isFinite(Number(clock)))
    setStartTicks(Math.max(0, Number(clock)));
  const want = Number(params.get("level") ?? "1");
  await loadLevel(Math.min(16, Math.max(1, want)) - 1);
  /**
   * ...and what a LOADED game brings with it — four numbers and nothing else.
   *
   * After `loadLevel`, not before, and that ordering is the file's own. A
   * chapter's entry function (`0x44da80` and its three siblings) zeroes all
   * twenty-one rounds counts and names its own weapon the moment the chapter
   * opens — but only while `[0x47913c]` is 0, and `0x45e068` sets it to 1 on a
   * load. Applying these after the level has stood up is the same exemption:
   * whatever the chapter did to the inventory, the file wins.
   *
   * `0x479438` is not in the file, but the reader sets it: `0x45e041` arms the
   * player whenever the saved weapon is not 1 (none), so a loaded gun is in
   * the player's hands. See {@link file://./savegame.ts}.
   */
  const carriedScore = params.get("score");
  if (carriedScore !== null)
    stats.score = Math.max(0, Number(carriedScore) || 0);
  const carriedLives = params.get("lives");
  if (carriedLives !== null) {
    stats.lives = Math.min(
      PICKUP.maxLives,
      Math.max(1, Number(carriedLives) || 1),
    );
  }
  // `0x45e039`: a saved 1 (none) skips the weapon, its rounds and the arming
  const carriedWeapon = params.get("weapon");
  if (carriedWeapon !== null && Number(carriedWeapon) !== 1) {
    inv.weapon = Number(carriedWeapon) || 0;
    inv.armed = true;
    inv.rounds = {
      [inv.weapon]: Math.max(0, Number(params.get("rounds") ?? 0) || 0),
    };
  }
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
  return true;
}
