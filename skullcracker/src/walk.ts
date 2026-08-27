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
 * platforms and 20 planks, the most in the game. Its ground is the fall, and the
 * platforms are the level.
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
import { CROW, Crow, Feather, PLANK, Plank, crowCel, crowFrames, plankCel, plankFrames } from "./props";
import { DEATH_FILMS, MISSIONS, PIT_DEPTH, TIME_OUT_FILMS, allowanceFor, type Mission } from "./mission";
import {
  CEL,
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
const MEASURED = { walk: 95, run: 180, jump: 420, rise: 125, launchDx: 100, runJumpDx: 180, crawl: 47, flyKickDy: 310 };
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
 * {@link MEASURED}'s per-tick pixels into pixels per SECOND at last: the player
 * walks 8x15 = 120, runs 225, and leaves the ground at 35 in one frame.
 */
const ENGINE_HZ = 15;

/**
 * How much higher than the original this page jumps — the one deliberate
 * departure from the executable, and a dial rather than a rewrite.
 *
 * The measured jump is an apex of 73px in 557ms (see {@link INVENTED.gravityPx}
 * for how that was got off a screen capture of the original). Against a 145px
 * player and 139-142px punks that is half a character, and it plays LOW.
 *
 * This scales the launch impulse only, leaving gravity at its measured value, so
 * height and hang time stay independent: `apex` goes as the square of this and
 * `airtime` goes linearly.
 *
 * ```
 *   1.0   apex  73px   airtime  557ms   the original, exactly
 *   1.2   apex 105px   airtime  668ms   <- here: clears a punk, still snappy
 *   1.41  apex 146px   airtime  787ms   twice the original's height
 * ```
 *
 * The reason not to go to 1.41 by default: STREETS' hardest jump is its 85px roof
 * gap, which sits between the original's plain jump (73) and its jump-with-lift
 * (94), and that is what gives the lift a purpose. Much above 105 and the gap is
 * trivial and the lift is dead weight.
 */
const JUMP_SCALE = 1.2;

const INVENTED = {
  tickMs: 1000 / 60,
  /**
   * Not invented at all any more, either of them: `MEASURED` gives the engine's
   * pixels per engine frame and {@link ENGINE_HZ} gives the frames, so the walk
   * is 8 x 15/60 = 2px a tick — 120px a second — and the jump leaves the ground
   * at 35 x 15/60. They were 4.52 and 20 when the frame rate was still unknown.
   */
  get walkPx(): number {
    return (MEASURED.walk / DIVISOR) * TICK_SCALE;
  },
  get runPx(): number {
    return (MEASURED.run / DIVISOR) * TICK_SCALE;
  },
  get jumpPx(): number {
    return (MEASURED.jump / DIVISOR) * TICK_SCALE * JUMP_SCALE;
  },
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
    return (MEASURED.rise / DIVISOR) * TICK_SCALE;
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
   *   0x42f850  obj+0x24 = f * 100.0       ; so the player's is 100
   *   0x430327  if (!landed) obj+0xa = obj+0x24 + <this frame's vy>
   * ```
   *
   * `obj+0xa` is a velocity in the RAW units every script uses, divided by the
   * class's own `obj+0xe` when it moves the object (`0x42f8b0`) — the player's is
   * 12. So the player accelerates downward by **100/12 = 8.33 pixels a frame²**,
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
   * The value stays as it is, because gravity is the number that sets the SHAPE of
   * the jump — how long the player hangs — and the shape is the thing that read as
   * flying. Height is tuned with
   * {@link JUMP_SCALE} instead, which is the launch, so the two can move
   * independently. Weakening gravity to gain height couples them: `apex = v²/2g`
   * and `T = 2v/g`, so halving g doubles the apex and doubles the hang on top of
   * it — 146px cost 2.2 SECONDS of airtime that way, four times the original's.
   *
   * The old 0.2 hung the player in the air for 1.46 SECONDS with a 191px apex,
   * which is why it read as flying; it is 69px and 525ms now, and the engine's
   * own vertical rate constant (10.4px a frame², 0.65 a tick²) sits just above
   * the answer rather than being it.
   */
  gravityPx: 0.524,
  maxFallPx: 12,
  /**
   * How fast the ground drags a sliding thing to a stop, per tick.
   *
   * Nothing found in `SC.EXE` cancels a knocked object's velocity: `obj+0xa` and
   * `obj+0xc` persist, an object that should not drift zeroes them itself, and
   * a kicked mailbox's frame function `0x44fe10` never does — so on the code
   * alone it slides for ever, which it plainly does not.
   *
   * So this is invented, and calibrated against the one thing about it that can be
   * observed in the original: a kicked mailbox travels **about a screen width**
   * before it stops. `0x430470` launches it at 69 pixels an engine frame — 17 a
   * tick — and it spends the first fifty of them in the air, because a kick's blow
   * has no vertical component and it has to fall the 37 pixels between its upright
   * box and its fallen one before the ground can drag on it at all. Measured on
   * the page rather than solved: 0.7 puts it down 520px from where it stood.
   */
  slidePx: 0.7,
  /**
   * How far the feet follow the floor without leaving it — a curb you step over
   * rather than jump. It has to exist: STREETS' floor rises and falls by up to
   * 24px between adjacent columns, and without a step the first rise puts the
   * player UNDER the floor, where nothing is ever below them again. That was the
   * first thing gravity broke.
   */
  stepPx: 26,
};


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
   * kind 2 (`0x471988`) — twelve cels, dx 180, so 15px a frame and 225px a
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
  air: [251, 252, 251, 250], // the deep-fall flail — see {@link ANIM.tuck}
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
const ACTIONS: Readonly<Record<string, { cels: readonly number[]; dx: readonly number[]; from: string }>> = {
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
/** `0x471b28`'s — the launch runs at one frame a cel, and there are four */
const LAUNCH_HOLD = 1;
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
type FoeState = "gait" | "flinch" | "dead" | "burst";

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
   * and cannot be killed. Enemies do not hit back yet — damage TO the player is
   * parked, by request, so the levels stay walkable while this is tested.
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
  const want = p.climbing ? p.feet : !p.onGround && p.airClock >= ANIM.launch.length * LAUNCH_HOLD ? TUCK_FEET : STAND_FEET;
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
  /** engine frames since leaving the ground — the launch and loop clock */
  airClock: 0,
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
  level = {
    sbk,
    pal,
    rooms,
    solids,
    spawned: rooms.map((r) => spawnIn(sbk, r)),
    planks: rooms.map((r, i) => planksIn(sbk, r, solids[i])),
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
  // ?clock= starts the mission clock short, which is the only way to reach the
  // last two minutes of an eight-minute dial from a test. It is spent on the
  // first level it is given to, so a timed-out level does not time out again.
  stats.ticks = startTicks ?? CLOCK_FULL;
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

/** every `init*` record standing in this room that this page has cels for */
function spawnIn(sbk: SbkFile, room: SbkRoom): Enemy[] {
  const out: Enemy[] = [];
  for (const e of sbk.entities) {
    const foe = FOES[e.name];
    if (!e.isEntity || !foe) continue;
    const cy = (e.top + e.bottom) >> 1;
    const cx = (e.left + e.right) >> 1;
    if (cy < room.top || cy > room.bottom || cx < room.left || cx > room.right) continue;
    // every cel it needs has to be in this book, or it is some other level's —
    // and that now includes the flinches and the death, which is the check that
    // would have caught the old cross-chapter mix-up: this chapter's rat has no
    // 3080 to die on and the other chapter's does
    if (!everyAnim(foe).every((a) => a.cels.every((id) => sbk.byId.has(id)))) continue;
    out.push({
      kind: e.name,
      x: cx,
      y: e.bottom,
      // the record's own param, for the kinds whose creator takes it as the
      // facing — everything else stands the way the art is drawn
      facing: foe.facesByParam && e.param ? 1 : -1,
      left: e.left,
      right: e.right,
      clock: 0,
      state: "gait",
      anim: foe.gait,
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
  for (const e of solids().platforms) {
    if (x < e.left || x >= e.right) continue;
    if (e.top < fromY || e.top > toY) continue;
    if (best === null || e.top < best) best = e.top;
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
  for (const e of solids().obstacles) {
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
 *   way through. That is 225px a second against the walk's 120, and it is the
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
  else if (e.key === "[") void loadLevel((levelIndex + 15) % 16);
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
 *   - **the mission clock** is a per-level figure too (`0x40d350`, and `32000`
 *     means no limit — `0x43be9c` passes exactly that). This page starts every
 *     level with the full dial, which is {@link CLOCK_FULL} frames.
 */
const stats = {
  score: 0,
  lives: 3,
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
    const damage = mine.damage;
    // the spray goes first, exactly as `0x40cba0` is called before the subtract —
    // and only for the kinds whose handler calls it at all
    if (foe.bleeds) spray(e, damage, mine.blow);
    // and the kind's own sound, at the thing that was hit — see FOE_SFX for which
    // handler plays which index
    if (foe.hitSound !== undefined) {
      const set = foe.hitSound;
      sound?.effect(typeof set === "number" ? set : set[Math.floor(Math.random() * set.length)], e.x, e.y);
    }
    e.hp -= damage;
    // knocked the way the blow travels, kept inside its own territory — unless it
    // is bolted down, which a hydrant is (`0x44fb43` re-pins it every frame)
    if (!foe.rooted) e.x = Math.max(e.left, Math.min(e.right, e.x + p.facing * 20));
    e.dents += 1;
    // and the momentum, for the kinds that keep it
    if (foe.flies) {
      const v = knockback(foe, { dx: mine.blow.dx * p.facing, dy: mine.blow.dy }, e);
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
      e.linger = foe.frail ? 0 : CORPSE_LINGER;
      stats.score += foe.panel?.award ?? 0;
      continue;
    }
    if (!foe.flinch) continue;
    // where the blow landed and which way it was facing — the two things the
    // handler consults besides the damage
    const blow = {
      damage,
      dy: Math.abs((mine.top + mine.bottom) / 2 - (box.top + box.bottom) / 2),
      facingAway: e.facing === p.facing,
    };
    // a progressive kind advances one stage per blow instead of picking; a
    // hydrant's handler switches on the state it is already showing, not on how
    // hard it was hit
    const which = foe.progressive ? e.dents - 1 : foe.pick ? foe.pick(blow) : 0;
    if (foe.progressive && which >= foe.flinch.length) continue; // beaten in already
    e.state = "flinch";
    e.anim = foe.flinch[Math.min(foe.flinch.length - 1, Math.max(0, which))];
    e.clock = 0;
  }
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
function stepEnemies(): void {
  const lvl = level;
  const pool = spawnedHere();
  for (const e of [...pool]) {
    const foe = FOES[e.kind];
    e.clock += TICK_SCALE;
    const run = e.anim.cels.length * e.anim.hold;
    if (e.state === "dead") {
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
    // whatever it is doing, a thing carrying momentum flies, falls, and stops when
    // its OWN cel's box lands. This has to come before the animation states: the
    // mailbox's topple is four frames and its flight is far longer than that.
    if (e.vx !== 0 || e.vy !== 0) {
      e.vy = Math.min(e.vy + INVENTED.gravityPx, INVENTED.maxFallPx);
      e.x += e.vx;
      e.y += e.vy;
      const span = p.room ? roomSpan(p.room) : null;
      if (span) e.x = Math.max(span.lo, Math.min(span.hi, e.x));
      const floor = groundAt(e.x);
      const base = lvl ? baseOf(e, lvl) : e.y;
      if (floor !== null && base >= floor) {
        // by the CEL's box, not by where the upright one would have stood
        e.y -= base - floor;
        e.vy = 0;
        // and on the ground it is dragged to a stop — the one invented number in
        // this, since nothing in the executable slows a slide down
        const drag = INVENTED.slidePx;
        e.vx = Math.abs(e.vx) <= drag ? 0 : e.vx - Math.sign(e.vx) * drag;
      }
    }
    // a terminal flinch holds its last cel for good — the toppled mailbox
    if (e.state === "flinch" && e.anim.terminal && e.clock >= run) {
      e.clock = run;
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
      e.anim = foe.gait;
      e.clock = 0;
    }
    const i = e.state === "gait" ? loopIndex(e.anim, e.clock) : Math.min(e.anim.cels.length - 1, Math.floor(e.clock / e.anim.hold));
    const step = ((e.anim.dx?.[i] ?? 0) / foe.divisor) * TICK_SCALE;
    if (step > 0 && e.vx === 0 && e.vy === 0) {
      const nx = e.x + step * e.facing;
      // a flinch that travels is a knockdown: it goes the way it was hit and is
      // not turned round by its own rect
      if (e.state === "gait" && (nx < e.left || nx > e.right)) e.facing = -e.facing;
      else e.x = Math.max(e.left - 200, Math.min(e.right + 200, nx));
    }
    // they stand on the room's floor, the same one the player walks — unless they
    // are still in the air
    if (e.vx === 0 && e.vy === 0) e.y = groundAt(e.x) ?? e.y;
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
    // an attack owns the player until it finishes — and it can start in the
    // air, which is where the flying moves live
    if (p.onGround && !p.act) {
      // W picks the bigger variant of either, which is what both state machines
      // do with `0x4ac3fe` before they look at their own button
      const big = held.up ? "Run" : "";
      // the punch tosses a coin: `0x42a400` calls `0x434540(2)` and adds it to
      // the base tag, so repeated presses alternate between two animations. The
      // kick does not — `0x42a670` picks its tag from the keys alone. BOTH
      // together are their own move: the 650s headbutt (`0x429706`).
      const both = (punchPressed && (kickPressed || held.kick)) || (kickPressed && held.punch);
      if (both) p.act = held.down ? "duckCombo" : "headbutt";
      else if (punchPressed) p.act = held.down ? "duckPunch" : `punch${big}${Math.random() < 0.5 ? "" : "2"}`;
      else if (kickPressed && p.running) {
        // the RUN handler's own kick (`0x429db9`) is the FLYING KICK — tag 4 of
        // `0x471d68`, whose first record carries its own leap: dx 190, dy -310
        p.act = "flyingKick";
        p.vy = -(MEASURED.flyKickDy / DIVISOR) * TICK_SCALE;
        p.onGround = false;
        p.leap = true;
      } else if (kickPressed) p.act = held.down ? "duckKick" : `kick${big}`;
      if (p.act) {
        p.actClock = 0;
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
      const a = ACTIONS[p.act];
      const f = Math.floor(p.actClock);
      if (f >= a.cels.length) p.act = null;
      else {
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
    const ladder = p.act ? undefined : held.up || held.down ? onLadder() : undefined;
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
    if (dir) {
      p.facing = dir;
      // ducked movement is the CRAWL — 0x4717c8 tag 4's own dx 47, about half
      // the walk — and it cannot run
      const speed =
        held.down && p.onGround
          ? (MEASURED.crawl / DIVISOR) * TICK_SCALE
          : p.running
            ? INVENTED.runPx
            : INVENTED.walkPx;
      const nx = p.x + dir * speed;
      // the room's floor SPAN is the room's extent — you cannot walk off the
      // world. Off a platform you certainly can: the floor is still under it.
      const ahead = groundAt(nx);
      // the BODY stays in the room, not just the point under it — otherwise the
      // last step of a level walks the sprite half off the side of the screen,
      // because the camera has already stopped at the room's end
      const span = p.room ? roomSpan(p.room) : null;
      const half = (playerBox().right - playerBox().left) / 2;
      const inRoom = !span || (nx - half >= span.lo && nx + half <= span.hi);
      // and a floor that rises more than a step is a wall, not a slope. Without
      // this the player walks INTO the terrain and then falls through it
      // forever, because everything solid is now above them: BARREL's floor
      // climbs 141px between two adjacent columns.
      const wall = p.onGround && ahead !== null && ahead < p.y - INVENTED.stepPx;
      if (inRoom && !wall) {
        p.travelled += Math.abs(nx - p.x);
        p.x = nx;
      }
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
      p.climbY = ladder.top + p.rung * spacing;
      const was = p.y;
      p.y = p.climbY + feet;
      p.travelled += Math.abs(p.y - was);
      p.onGround = false;
    } else {
      if (p.onGround && jumpPressed && !p.act) {
        // `0x429a76`: one sound, always the same one, on the frame J is read
        sound?.own(OWN.jump, p.x, p.y);
        p.vy = -INVENTED.jumpPx;
        p.onGround = false;
        p.hold = HOLD_FRAMES;
        /**
         * The launch carries horizontal by how the ground was left, and both
         * numbers are the script's: walking is tag 3, `250 251 252 253(dx 100,
         * dy -420)`; RUNNING is tag 4, the single record `200(dx 180, dy -420)`
         * — no wind-up at all, an instant leap already in the tuck, at the run's
         * own 180. That last is `p.leap`, and the frame picker skips the
         * wind-up cels for it.
         */
        p.leap = p.running;
        const kick = p.running ? MEASURED.runJumpDx : p.moving ? MEASURED.launchDx : 0;
        if (kick) {
          const nx = p.x + p.facing * (kick / DIVISOR);
          p.x = nx;
        }
      }
      /**
       * The lift — hold W and go higher, which is the original's own mechanic
       * and the reason the same key runs, climbs and jumps. `0x429f00` spends
       * one frame of `0x4723f0` and moves `dy -125` for each frame the key is
       * down, so this does the same and stops when the allowance is gone.
       *
       * It is what makes STREETS' 85px rise clearable without the floaty
       * gravity that used to do it: 77px from the launch, 21px from the lift.
       */
      if (!p.onGround && held.up && p.vy < 0 && p.hold > 0) {
        p.y -= INVENTED.risePx;
        p.hold -= TICK_SCALE;
      }
      poseFeet();
      if (p.onGround) {
        // follow the floor: up a curb, down a step, off an edge
        const s = surfaceUnder(p.x, p.y - INVENTED.stepPx, p.y + INVENTED.stepPx);
        if (s === null) p.onGround = false;
        else {
          p.y = s;
          p.vy = 0;
        }
      }
      if (!p.onGround) {
        // fall, and stop at the first surface crossed on the way down
        p.vy = Math.min(p.vy + INVENTED.gravityPx, INVENTED.maxFallPx);
        const ny = p.y + p.vy;
        const land = p.vy >= 0 ? surfaceCrossed(tickX, p.y, p.x, ny) : null;
        if (land !== null) {
          p.y = land;
          p.vy = 0;
          p.onGround = true;
        } else p.y = ny;
        // last resort: under the floor is not a place. Nothing here can be
        // below the terrain, so anything that gets there is put back on top of
        // it rather than falling out of the level.
        const g = groundAt(p.x);
        if (g !== null && p.y > g) {
          p.y = g;
          p.vy = 0;
          p.onGround = true;
        }
      }
    }
    // the airborne clocks: cels by time, and the fall depth that decides when
    // the tuck gives way to the flail (0x42a109's 360px test)
    if (p.onGround) {
      p.airClock = 0;
      p.fallPx = 0;
      p.leap = false;
    } else {
      p.airClock += TICK_SCALE;
      if (p.vy > 0) p.fallPx += p.vy;
    }
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
    stepPlanks();
    stepCrows();
    stepEnemies();
    stepGobs();
    stepCraft();
    claimBar();
    // the mission clock runs at the engine's rate, not this page's
    stats.ticks = Math.max(0, stats.ticks - TICK_SCALE);
    if (stats.ticks <= 0 && !film) void ranOut();
    if (fellOut() && !film) void died();
    upPressed = false;
    jumpPressed = false;
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
  for (const c of crowsHere()) drawLevelCel(crowCel(c), c.x, c.y, camX, camY);
  for (const f of feathers) {
    const id = CROW.feathers.cels[Math.min(CROW.feathers.cels.length - 1, Math.floor(f.age / CROW.feathers.hold))];
    drawLevelCel(id, f.x, f.y, camX, camY);
  }
  for (const e of spawnedHere()) drawEnemy(e, camX, camY);
  // the goal's craft and the goo share the play plane with the player: the
  // engine's own effect class is collected with the actors, not the backdrop
  drawCraft(camX, camY);
  drawGobs(camX, camY);
  drawPops(camX, camY);

  // the player, feet on the ground, between the rate-1 planes and the
  // foreground — the disc's own cels for both facings, so nothing is mirrored
  // what the player is doing decides the script, and the DISTANCE they have
  // covered decides the frame — one cel per STRIDE_PX, the engine's own ratio
  const acting = p.act ? ACTIONS[p.act] : null;
  const seq = acting
    ? acting.cels
    : p.climbing
      ? ANIM.climb[p.climbTag] ?? ANIM.hang
      : !p.onGround
        ? ANIM.air
        : p.crouching
          ? ANIM.crouch
          : p.running
            ? ANIM.run
            : p.moving
              ? ANIM.walk
              : ANIM.idle;
  // Three clocks, because the engine has three. An action and the idle run on
  // engine frames at their script's own ticksPerFrame; anything that covers
  // ground is clocked by the GROUND it covers, one cel per stride, so the feet
  // cannot slide whatever this page's Hz is; and the flight runs on its own.
  const stride = seq === ANIM.run ? RUN_STRIDE_PX : STRIDE_PX;
  let id: number;
  if (acting) id = seq[Math.min(seq.length - 1, Math.floor(p.actClock))];
  // a rung is four cels at one engine frame each, and the last of them is what a
  // ladder holds you on when you stop asking to move
  else if (p.climbing) id = seq[Math.min(seq.length - 1, Math.floor(p.climbClock))];
  else if (seq === ANIM.idle)
    id = p.fidget
      ? p.fidget[Math.min(p.fidget.length - 1, Math.floor(p.fidgetClock / IDLE_HOLD))]
      : seq[Math.floor(p.idleClock / IDLE_HOLD) % seq.length];
  else if (seq === ANIM.crouch)
    // moving while ducked is the crawl, clocked by ground covered like every
    // gait; still is the held duck, with its rare settle fidget over it
    id = p.moving
      ? ANIM.crawl[Math.floor(p.travelled / CRAWL_STRIDE_PX) % ANIM.crawl.length]
      : p.fidget === ANIM.crouchFidget
        ? ANIM.crouchFidget[Math.min(ANIM.crouchFidget.length - 1, Math.floor(p.fidgetClock))]
        : ANIM.crouch[0];
  else if (seq === ANIM.air) {
    // the wind-up (skipped by a running leap, which is tag 4's single record),
    // then the TUCK held — cels 200 and 220, tag 0, which is what the kind-3
    // dispatch actually installs after any launch — and the flail only past
    // the 360px fall that 0x42a109 tests for
    const f = Math.floor(p.airClock / LAUNCH_HOLD) + (p.leap ? ANIM.launch.length : 0);
    if (f < ANIM.launch.length) id = ANIM.launch[f];
    else if (p.fallPx > FLAIL_FALL_PX) id = ANIM.air[Math.floor(p.airClock / AIR_HOLD) % ANIM.air.length];
    else id = ANIM.tuck[Math.min(ANIM.tuck.length - 1, f - ANIM.launch.length)];
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
      player: { health: 1024, max: 1024, nameCel: CEL.skullcracker },
      enemy: stats.shown,
      score: stats.score,
      lives: stats.lives,
      // the engine's own expression: what is alive, less what may remain
      // (`0x415f55` computes it with the same subtraction the win test makes)
      quota: Math.max(0, aliveNow() - stats.allowance),
      ticks: stats.ticks,
      buttons: buttonMask(),
      // no inventory on this page yet: an empty hand shows an empty gauge, which
      // is what the engine draws when `[0x479438]` is clear
      weapon: null,
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
          : p.running
          ? " · RUNNING 225px/s"
          : p.moving
            ? " · walking 120px/s"
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
      ` at x ${Math.round(near.x)}, y ${Math.round(near.y)} cel ${celOf(near)}`
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
  const valves = spawnedHere()
    .filter((e) => FOES[e.kind].burst)
    .map((e) => `${e.state === "burst" ? "water" : e.kind} cel ${celOf(e)} at x ${Math.round(e.x)}`);
  const valve = valves.length ? ` · ${valves.join(" · ")}` : "";
  // where a struck thing ends up, which is the only way to see a slide from a
  // probe: the flying kinds have no health bar to read
  const flew = spawnedHere().find((e) => FOES[e.kind].flies && (e.vx !== 0 || e.dents > 0));
  const slid = flew ? ` · ${flew.kind} at x ${Math.round(flew.x)}` : "";
  const lives = ` · ${stats.lives} ${stats.lives === 1 ? "life" : "lives"}`;
  // the panel already shows it in the disc's own digits; this is for the probes,
  // which can read a number out of text and can only count pixels off a canvas
  const points = ` · ${stats.score} points`;
  hud.innerHTML =
    `<b>level ${levelIndex + 1} · ${lvl.name}</b> · room ${lvl.rooms.indexOf(room!) + 1} of ` +
    `${lvl.rooms.length} (${which})${doors}` +
    `${room && !room.ground ? " · <b>no floor in this room</b>" : ""}` +
    ` · x ${Math.round(p.x)}, y ${Math.round(p.y)}${state}${celNow}${mob}${foe}${valve}${board}${bird}${slid}${lives}${points}${quotaSay}${prompt}${toGoal}` +
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
  // ?x= drops the player at a world x, for looking at a specific spot
  const atX = params.get("x");
  if (atX !== null) {
    const x = Number(atX);
    enter(roomAt(x, p.y), x, p.y);
  }
  requestAnimationFrame(loop);
}

void boot().catch((e) => {
  hud.textContent = String(e);
});
