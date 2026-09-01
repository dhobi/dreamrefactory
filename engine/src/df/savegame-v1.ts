/**
 * Dust's saved games (`.rtd`) — DreamFactory 1's save format.
 *
 * *Prerequisite: [`savegame.ts`](savegame.ts), the v4 (Titanic) format, and
 * `save-vars.ts`, the variable list both versions share.*
 *
 * ## It is the same file, three years earlier
 *
 * A `.rtd` is the SAME container a `.ti` is — `fourCC 0x00010000` at 0, the
 * signature `ODTRTRFD` at 32, a 128-slot position table, container 0 at 1536 and
 * every later one aligned to 64 — so `readSaveFile` and `writeSaveFile` take
 * these files unchanged, and reproduce every shipped one byte for byte
 * (`dust/tests/saves.ts`). The writer that made them is DF.EXE's
 * `0x419CD0`, and it is recognisably the ancestor of TI.EXE's `0x413910`: the
 * same containers, in the same order, from the same kind of live engine tables.
 *
 * So this module is not a second implementation of the format. It is the DELTA:
 * the offsets inside container 0 and container 1, and four record strides that
 * grew or shrank between the two engines. Everything else — the framing, the
 * variable list, the string pool, the loop table — is shared code.
 *
 * ## The container order (DF.EXE `0x419CD0`, one container per write step)
 *
 * | # | contents | proof |
 * |---|----------|-------|
 * | 0 | version string, the nine resource paths, the live CLUT, the open-file manifest | built on the stack at `0x419D53` (`push 0x1210`), 260-byte records at `0x419D92` |
 * | 1 | the standpoint: a verbatim 542-byte dump of the engine block at `0x4609E0` | `GlobalAlloc(2, 0x21E)` at `0x419F01` |
 * | 2 | the cast — n × 164 | `ds:0x460B18`; stride from `0x411DF0` and `add edi,0xa4` at `0x4129B3` |
 * | 3 | open cast files — n × 28 | `ds:0x460B20` |
 * | 4 | the props — n × 158 | `ds:0x460B28`; stride from `0x41B8B2` |
 * | 5 | open prop files — n × 28 | `ds:0x460B30` |
 * | 6 | open sound banks — n × 38 | `ds:0x460B38`, count `ds:0x460B3C` |
 * | 7 … 6+3n | three arrays per bank (registered / playing / looping), 104 per record | loop at `0x41A0A0`, `add edi,0x26` |
 * | +1 | the globals | `ds:0x460E18` |
 * | +2 | the string pool | `*(globals + 0x10)` at `0x41A2A5` — the same handle slot v4 uses |
 * | +3 | loops, `0x540` = 32 × 42 | `0x45F690`, stride from `0x438840` |
 * | +4 | crickets, `0x300` = 16 × 48 | `0x45FBD0`, `add esi,0x30` |
 * | +5 | walks, `0x520` = 16 × 82 | `0x45F170`, `add esi,0x52` |
 * | (var) | one waypoint payload per active walk carrying one | `0x41A41F` |
 *
 * Which means the indices are **positional**, not searched for: the count is
 * `7 + 3·banks + 5 + payloads`, so `banks` follows from the count and every index
 * follows from `banks`, checked against the file's own structures (see
 * {@link v1Index}). v4 is read the same way now — it used to hunt by content, and
 * its globals probe looked for the strings `mission` and `playerdeath`, which are
 * TAOOT's vocabulary and appear in no Dust save, so a Dust-shaped `.ti` read as
 * having no globals at all (#325).
 *
 * ## What a load may and may not touch
 *
 * DF.EXE's loader (`0x41A4B0`) does two things a writer has to respect:
 *
 *  - **it checks the version string** (`0x4303C0` at `0x41A599`, a byte-exact
 *    Pascal-string compare against container 0 + 0) and refuses the file
 *    otherwise — "This saved game is from a different version of this title.";
 *  - **it only restores part of container 1.** At `0x41A681` it stashes the live
 *    block's `[0,122)` and `[122,244)` plus the dword at `+308`, copies all 542
 *    bytes in, then puts the stashed bytes back. So `[244,542)` minus
 *    `[308,312)` is the only part of the standpoint block that comes out of the
 *    file — which is where every field below happens to be, and is why a patch
 *    may copy `[0,244)` from its base without thinking about it.
 */

import { pstrAtChecked } from "./binary";
import { Container } from "./container";
import { RawSaveFile, readSaveFile, writeSaveFile } from "./savegame";
import {
  DFVALUE_BOOLEAN,
  DFVALUE_NUMBER_WRITTEN,
  DFVALUE_STRING,
  NODE_TYPE,
  NODE_VALUE,
  SavedVar,
  decodeVars,
  ensureVarRoom,
  newVarRecord,
  poolIntern,
  recordSlots,
  writePstrField,
} from "./save-vars";

// ---------------------------------------------------------------------------
// Container 0 — the manifest
// ---------------------------------------------------------------------------

/** the version string the loader compares (`savegame`'s own argument) */
const C0_VERSION = 0;
/** nine 256-byte resource path prefixes (`appl:`, `dust:data:`, …) */
const C0_PATHS = 0x100;
const C0_PATH_COUNT = 9;
const C0_PATH_STRIDE = 256;
/**
 * The live loop-sound state: `{u32 bank file, u32 playing bank, u32 chunk}`,
 * three heap handles' worth of what DF.EXE calls the theme.
 *
 * Both bank words are handles into the open-file manifest and the second is not
 * a flag: it is the bank whose loop is SOUNDING, zero when none is. They are
 * usually the same handle and they can differ — `D2M_004.RTD` carries no loop
 * bank and a playing one (mayor.snd, the clock in the hall) — so a parse that
 * read the second as a boolean off the first lost that save's theme entirely.
 */
const C0_THEME = 0xa00;
/** the live CLUT, 256 × {i16 index, i16 rgb[3]} — v4's 0xb0c, 0x100 lower */
const C0_CLUT = 0xa0c;
const C0_CLUT_SIZE = 256 * 8;
/** how many open-file records follow — v4's 0x130c, 0x100 lower */
const C0_FILE_COUNT = 0x120c;
/** the records themselves: {u32 old heap handle, pstr path[256]} */
const C0_FILE_RECORDS = 0x1210;
const C0_FILE_STRIDE = 260;

// ---------------------------------------------------------------------------
// Container 1 — the standpoint (the engine block at 0x4609e0, offsets relative)
// ---------------------------------------------------------------------------

/**
 * The frame counter, which is what `frame()` answers.
 *
 * `inc DWORD ds:0x460ad8` at `0x4334ad` runs once per service pass, and the
 * accessor at `0x42bd60` builds its DFValue straight off that address. It is also
 * the one field that orders the shipped saves by when they were taken:
 * START 167, DOG 312, HELP 525, GOTBONE 705, AFTERDOG 958.
 */
const C1_FRAME = 248;
/** the open flat file's base name, no extension ("new") */
const C1_FLAT = 372;
/**
 * Where the player stands, and it is a GRID CELL rather than a scene name.
 *
 * This is the sharpest difference from v4, which writes the scene's and view's
 * names as Pascal strings. Dust addresses a standpoint the way its SET does — a
 * column, a row and one of four facings — and the names ("Scene G15") live only
 * in the set's own scene table. Proven by identity on a fresh game: START.RTD
 * reads (6, 14, 1), and NITE.SET's own "where the player stands when no scene is
 * named" triple is (6, 14, 1).
 */
const C1_CELL_X = 446;
const C1_CELL_Z = 448;
const C1_FACING = 450;
/** the camera's heading, 0..255 — 192 north, 0 east, 64 south, 128 west */
const C1_DEG = 458;
/** the camera in world units: `cell * 256 + 128` when standing still */
const C1_CAM_X = 460;
const C1_CAM_Y = 462;
/**
 * The camera the actor projection actually looks through — and the reason a
 * restored character can hover.
 *
 * `0x433c60`, the world-to-screen projection every drawn actor goes through,
 * reads its eye from c1+472/474/476 (`[0x460bb8]`/`[0x460bba]`/`[0x460bbc]`) —
 * x, y, and HEIGHT — not from the cell fields the port was writing. The load
 * rebuilds x and y from the grid cell (`0x433d20`: `cell·256+128`), but the
 * height it copies from c1+430 (`[0x460b8e]`) — so +430 is the load-bearing
 * byte pair, and it is PER ROOM: it is the set file's own `eyeHeight`
 * ({@link SetFileV1.eyeHeight}, c0+0x1a), 62 in the town and 130 upstairs at
 * the mayor's. Verified across all 61 shipped saves: +476 == +430 == the
 * save's own set's eyeHeight, every time.
 *
 * A save that changes the room and leaves +430 alone projects the new room's
 * cast through the old room's eye height, and the error lands on the screen's
 * vertical axis: `(eyeHeight_room − eyeHeight_stale) · focal / depth` pixels of
 * hover — the Mayor's wife floating 68 world units up the wall of `mayupper`
 * (#320).
 *
 * +428 is the companion `cameraSetback` (c0+0x18): how far the eye stands
 * back from the cell centre along the facing. 64 in every set on the disc and
 * every shipped save, but written with +430 because they travel together in
 * the set header. The eye pair at +472/474 obeys, in all 61 shipped saves:
 * facing 1 → y+setback, 2 → y−setback, 3 → x−setback, 4 → x+setback.
 */
const C1_CAMERA_SETBACK = 428;
const C1_EYE_HEIGHT = 430;
const C1_EYE_X = 472;
const C1_EYE_Y = 474;
const C1_EYE_Z = 476;
/**
 * The open set's NAME ("town"), which is not the same thing as its file.
 *
 * Dust has two versions of the same town — `town.set` by day and `nite.set` by
 * night — and both are NAMED "town" inside. So the name cannot say which file to
 * reopen, and a load that trusted it came back at noon out of a save taken at
 * midnight, with the day palette over a night room.
 */
const C1_SET = 482;
/**
 * The open set's FILE, as a handle into container 0's manifest.
 *
 * The same indirection v4 uses (its set id at c1+544), and for the same reason:
 * the engine reopens the room it had OPEN, not the room it can name. Resolving
 * the handle resolves the two apart: a night save gives `dust:data:nite.set` — the night
 * town — while the name field beside it says "town" in every one of them.
 *
 * The flat file is the same trick one field earlier, at +356 (`appl:local:new.flt`).
 */
const C1_SET_FILE = 396;
/**
 * The two container indices the loader re-acquires from the reopened set file,
 * and they are the room's, not the save's.
 *
 * DF.EXE copies container 1 verbatim into its global block at `0x4607a0`, so
 * these are `[0x460934]` and `[0x460940]` — two globals with exactly one code
 * reference each in the whole binary, the reads at `0x42ef3d` and `0x42ef10`:
 *
 *     0x42eed5  call 0x42f010            ; reopen the set file by path
 *     0x42eee2  push 0x460930 / 0 / eax
 *     0x42eeea  call 0x42d160            ; acquire pack 0        -> line 5360
 *     0x42ef0b  push 0x460944
 *     0x42ef10  mov eax, [0x460940]      ; the ACTOR register, from the save
 *     0x42ef1d  call 0x42d160            ; acquire it            -> line 5361
 *     0x42ef4a  call 0x42d160            ; the TRANSITION register -> line 5362
 *
 * and a failed acquire is the fatal "Dust cannot find a file. Be sure the Dust
 * CD is in your computer's CD-ROM drive (Error line %d, code %ld)".
 *
 * See {@link SetFileV1.transitionRegister} for what they are and what leaving
 * them stale did.
 */
const C1_TRANSITION_REGISTER = 404;
const C1_ACTOR_REGISTER = 416;
const C1_FLAT_FILE = 356;
/** the open puppet's manifest handle, and its name; 0 when none is open */
const C1_PUPPET_HANDLE = 506;
const C1_PUPPET_NAME = 526;
/** the block's full length, which the loader copies whole */
const C1_SIZE = 542;

/**
 * A view is named for the direction it looks along, and the heading says which.
 *
 * The same four-entry table `set-v1-to-v4.ts` builds its view names from, and it
 * has to be the same one or a loaded save would name a view the set does not
 * have. North is where −z is; a right turn raises the heading by 64, so
 * 192 → 0 → 64 → 128 is north → east → south → west, clockwise.
 */
const COMPASS: Record<number, string> = { 192: "north", 0: "east", 64: "south", 128: "west" };

// ---------------------------------------------------------------------------
// Record strides
// ---------------------------------------------------------------------------

/**
 * The actor record: 164 bytes, where v4's is 160.
 *
 * The string half is v4's exactly — name, then set, star, pose and owner on a
 * 16-byte stride after it — and the numeric half is four bytes longer, so v4's
 * offsets for the tail (`turn`, `speed`, `scale`, `zclip`) do not transfer and
 * are not guessed at here. What IS pinned is the placement, and by measurement
 * rather than by analogy: the three words at +26/+28/+30 match the world
 * coordinates of the record's own named star in 23 of the 38 records whose star
 * belongs to the open set, and no other offset in the record matches even once.
 */
const ACTOR_STRIDE = 164;
const ACTOR_VISIBLE = 0;
/**
 * `is3d` — the same offset and meaning the PROP record documents at +18, and the
 * one bit both of a port save's visual faults in the original turned on.
 *
 * `DF.EXE`'s per-actor draw gate at `0x414fd0` branches on this word before it
 * does anything else. Nonzero takes the world path: the actor's set (+100) is
 * compared against the standpoint's set name (c1+482) — which is what keeps a
 * visible actor from another room off the screen — and the draw rect is computed
 * by projecting the world position and scale (`0x415320`; the rect at +56…+70 is
 * where the result is CACHED, never a load-time input). Zero takes the
 * screen-anchored path at `0x4151f8` instead: no set filter, no projection, the
 * rect read straight off the anchor words at +20/+22.
 *
 * So a visible actor written with 0 here is drawn in every room, at the anchor a
 * never-placed record holds — (0, 0), the top-left corner — at its raw per-mille
 * scale (#319, #320). Measured across all 61 shipped saves: no record is visible
 * with 0 here, and 1521 invisible records hold 1 — the original sets it when an
 * actor is first placed in the world and never clears it.
 */
const ACTOR_IS3D = 18;
const ACTOR_DEG = 24;
/**
 * The world position, in the engine's own axis names: x across, **y into the
 * screen**, z up.
 *
 * Worth stating because "y" reading as depth is the surprise, and getting it
 * wrong is invisible in the file and fatal on screen: relabelled as x/y/z with y
 * up, every restored character lands at depth 0 — which is the camera's own eye,
 * so the projection refuses them and the town comes back deserted with every
 * other field perfectly restored.
 *
 * The three words map straight onto `ActorInstance.worldX/worldY/worldZ`, and
 * the port's own boot proves it: script-placed `dog` stands at (1620, 2748, 0)
 * and the record for `dog` reads 1620, 2748, 0 in that order.
 */
const ACTOR_X = 26;
const ACTOR_Y = 28;
const ACTOR_Z = 30;
/**
 * `actorscale`, per mille — and the field that decides whether a restored
 * character is DRAWN at all.
 *
 * A load resets the cast before applying the file's records, and a reset actor
 * has scale 0; the draw list skips scale 0, so a restore that could not read
 * this field brought the whole town back invisible. (It did, once: the street
 * outside the saloon came back empty, which is how the field got looked for.)
 *
 * Identified by what the values ARE: the cow reads 2400 and the dog 880, Leroy
 * 1100 and Help 1450, and every character who has never been placed reads
 * exactly 1000 — a neutral default is what an untouched record should hold. It
 * sits two bytes past v4's own `actorscale`, which is where the v1 record's
 * four extra numeric bytes put it.
 */
const ACTOR_SCALE = 44;
/**
 * `actorturn` and `actorspeed` — how fast a character turns on the spot, and how
 * fast they walk.
 *
 * Read off the RUNNING GAME rather than guessed from plausible-looking numbers,
 * which is what makes these two right where a first attempt was wrong. The port's
 * own boot is script-driven, so the values Dust's scripts set are observable:
 * Leroy, the dog and the horse all run at speed 3 and turn 7, the pig at 12 and
 * 16. The record reads exactly 3 at +40 and 7 at +36 for those three, and 16 at
 * +36 for the pig's group.
 *
 * The first attempt took +78 and +80 — where the numbers are 32, 64, 100 and a
 * uniform 100 — because they LOOK like a speed and a turn rate. They are an order
 * of magnitude out, so every restored walker crossed the town at a sprint and
 * spun on the spot. Whatever those two fields are, they are not these.
 *
 * Worth restoring at all because only a script ever sets them and a load runs no
 * script: left at the cast's defaults, a resumed walk finishes at the wrong pace.
 */
const ACTOR_TURN = 36;
const ACTOR_SPEED = 40;
const ACTOR_NAME = 84;
const ACTOR_SET = 100;
const ACTOR_STAR = 116;
const ACTOR_POSE = 132;
const ACTOR_OWNER = 148;

/**
 * The prop record: 158 bytes — the same stride v4 uses, and the same offsets for
 * every string field (name at +78, then set, star, view and owner). The numeric
 * half agrees on `visible` and `is3d` and then goes its own way; `scale` at +42
 * is per-mille as it is everywhere else in v1 (800, 1000, 1200, 4230 across the
 * corpus), and −20000 at the world coordinates is the put-down sentinel.
 */
const PROP_STRIDE = 158;
const PROP_VISIBLE = 0;
const PROP_IS3D = 18;
/**
 * The screen anchor, and it is a PAIR — Y first.
 *
 * Pinned by the game's own arithmetic rather than by analogy with v4: INVEN.PRP
 * puts a dropped item back with `propxy(handitem, 316, 320)`, and every prop the
 * panel owns reads exactly 320 at +20 and 316 at +22. So +22 is x and +20 is y,
 * in that order, which is the reverse of the order the command takes them in.
 */
const PROP_SCREEN_Y = 20;
const PROP_SCREEN_X = 22;
const PROP_DEG = 24;
/**
 * The world position, on the same three axes the cast record uses — x across, y
 * into the screen, z up (see {@link ACTOR_X}).
 *
 * Two props confirm it independently of the cast: `shootingstar` reads
 * (2784, 4864, 499), and a star is up in the sky, so 499 is its height and 4864
 * its distance; the Bone lying in the street reads (1478, 3752, 0), height zero,
 * on the ground.
 */
const PROP_X = 26;
const PROP_Y = 28;
const PROP_Z = 30;
/**
 * `propdist` — the z-order a screen prop is drawn at.
 *
 * NEW.FLT's `showprop` sets every panel item to `propdist(thename, -1)` and the
 * inventory's drag lifts the held one with `propdist(handitem, -30000)`; the
 * panel's props read exactly −1 here and the world's `shootingstar` reads a real
 * depth (1472), which is what tells the field apart from a flag.
 */
const PROP_DIST = 40;
const PROP_SCALE = 42;
const PROP_NAME = 78;
const PROP_SET = 94;
const PROP_STAR = 110;
const PROP_VIEW = 126;
const PROP_OWNER = 142;

/** open cast / prop file lists: {u32 ptr, u32, u32, pstr name[16]} — and the
 *  name carries NO extension ("gang", "house"), which is why v4's `/\.cst$/`
 *  test finds nothing here. The extension comes from the c0 manifest. */
const FILE_LIST_STRIDE = 28;
const FILE_LIST_NAME = 12;

/** open sound banks: counts and pointers for the three arrays that follow */
const BANK_STRIDE = 38;
const BANK_NAME = 0x16;

/**
 * The walk record: 82 bytes, where v4's is 110.
 *
 * Mapped by RECONSTRUCTION, which is the strongest kind of evidence this format
 * offers: the fields below predict where the walker is standing, and the cast
 * record — written by the same engine at the same instant, from a different
 * table — says whether the prediction is right. AFTERDOG has Jones 82% of the way
 * along a 626-unit walk to `town.jones2`:
 *
 *     destination     (1624, 1872)        +26 / +28
 *     delta           (-112, -616)        +8 / +12
 *     start           (1736, 2488)        destination - delta
 *     distance         626                +20, and hypot(112, 616) = 626.1
 *     remaining        111                +40
 *     so covered       515                626 - 111
 *     which puts him   (1643.9, 1981.2)   start + delta x 515/626
 *     the cast says    (1643, 1981)       cast record +26 / +28
 *
 * and Help, 29% along a 131-unit step in the same file, lands the same way:
 * predicted (1732.2, 3007.9), recorded (1732, 3007). Two walkers, two files, no
 * field left over.
 *
 * `+40` being the distance REMAINING rather than the distance covered is the one
 * thing worth flagging: it is why the port converts it (`progress = dist - here`)
 * instead of passing it through.
 */
const WALK_STRIDE = 82;
const WALK_COUNT = 16;
const WALK_ACTIVE = 0;
/** a facing to end on, or −1 for none — v4 spells this the same way */
const WALK_TURN_TO = 4;
/** the three deltas, i32 each: across, into the screen, up */
const WALK_DX = 8;
const WALK_DY = 12;
const WALK_DZ = 16;
/** the whole walk's length, i32 */
const WALK_DIST = 20;
/** the walker's current facing */
const WALK_DEG = 24;
/** where they are going, in world units and then as a grid cell */
const WALK_DEST_X = 26;
const WALK_DEST_Y = 28;
const WALK_DEST_Z = 30;
/** the destination as a grid cell, beside the world units */
const WALK_DEST_CELL_X = 32;
const WALK_DEST_CELL_Z = 34;
/** an authored route's waypoints, as a handle to a container of its own */
const WALK_PAYLOAD = 36;
/** how much of {@link WALK_DIST} is LEFT */
const WALK_REMAINING = 40;
const WALK_ACTOR = 50;
const WALK_STAR = 66;

/** the loop table, byte-identical to v4's: 32 × 42 */
const LOOP_STRIDE = 42;
const LOOP_COUNT = 32;
const LOOP_ACTIVE = 0;
const LOOP_KIND = 4;
const LOOP_PERIOD = 6;
const LOOP_NAME = 10;
const LOOP_HANDLER = 26;
/** loop kinds, as the `makeloop` first argument spells them */
const LOOP_KINDS: Record<number, string> = { 1: "actor", 2: "prop", 3: "scene", 4: "flat" };

/** how many containers a save has that are not a sound bank's three */
const FIXED_CONTAINERS = 7 + 5;

// ---------------------------------------------------------------------------
// The parsed save
// ---------------------------------------------------------------------------

/** one character, as the file has them */
export interface SavedActorV1 {
  name: string;
  owner: string;
  set: string;
  star: string;
  pose: string;
  visible: boolean;
  /** in the world (drawn via set filter + projection) rather than screen-anchored — see {@link ACTOR_IS3D} */
  is3d: boolean;
  deg: number;
  /** per-mille `actorscale`; 0 would make the character undrawable */
  scale: number;
  /** `actorspeed` and `actorturn`, which only a script ever sets */
  speed: number;
  turn: number;
  x: number;
  y: number;
  z: number;
}

/** one prop, as the file has them */
export interface SavedPropV1 {
  name: string;
  owner: string;
  view: string;
  set: string;
  star: string;
  visible: boolean;
  is3d: boolean;
  /** where a screen-space prop is anchored (see PROP_SCREEN_Y) */
  screenX: number;
  screenY: number;
  deg: number;
  /** `propdist` — the z-order, and a real depth for a world prop */
  dist: number;
  scale: number;
  /** the world position: x across, y into the screen, z up */
  x: number;
  y: number;
  z: number;
}

/** a walk in flight — a character caught mid-stride by the save */
export interface SavedWalkV1 {
  actor: string;
  /** the star they are walking to, if the walk names one */
  star: string;
  /** where they set off from, and the deltas to where they are going */
  startX: number;
  startY: number;
  startZ: number;
  dx: number;
  dy: number;
  dz: number;
  /** the whole distance, and how much of it has been covered */
  dist: number;
  progress: number;
  /** a facing to end on, or −1 */
  turnTo: number;
  /** the walker's facing right now */
  deg: number;
  /** true if this is a turn on the spot rather than a journey */
  turnOnly: boolean;
  /** the walk follows an authored route whose waypoints are a container of
   *  their own — which this port does not read, so the straight line is used */
  hasPath: boolean;
}

/** one armed `makeloop` slot */
export interface SavedLoopV1 {
  kind: string;
  name: string;
  handler: string;
  period: number;
}

/** where the player is standing, in the file's own terms */
export interface SavedStandpointV1 {
  /** the set's NAME, which two different files can share ("town") */
  set: string;
  /** the set FILE that was open ("nite.set") — see C1_SET_FILE */
  setFile: string;
  /** the open flat file's base name ("new") */
  flat: string;
  /** and its file ("new.flt") */
  flatFile: string;
  /** the grid cell, and the facing 1..4 */
  cellX: number;
  cellZ: number;
  facing: number;
  /** the camera's heading 0..255, and its world position */
  deg: number;
  camX: number;
  camY: number;
  /** the view name that heading looks along ("north"), or "" if it is mid-turn */
  view: string;
  /** the room's camera height — the set's own `eyeHeight`, see {@link C1_EYE_HEIGHT} */
  eyeHeight: number;
}

/** everything this reader takes out of a `.rtd` */
export interface SaveGameV1 {
  /** the version string the original loader gates on ("dust 0.3") */
  title: string;
  /** the nine resource path prefixes, in the engine's own order */
  paths: string[];
  /** the open-file manifest: every file the session had open, by old heap handle */
  files: { handle: number; path: string }[];
  /** the live CLUT, verbatim (256 × {i16 index, i16 rgb[3]}) */
  clut: Uint8Array;
  /**
   * The loop sound, as {@link C0_THEME} holds it: the bank it belongs to, the
   * bank actually sounding (null when the save was taken silent), and the chunk
   * index within it.
   *
   * Null only when neither word names a file. `loopBank` and `playingBank` are
   * FILE names out of the manifest, which matters because a bank's own track name
   * need not be its filename — `NIGHT.SND` calls itself `town.snd`, exactly as
   * `TOWN.SND` does — so the handle is the only thing that says which of the two
   * was playing.
   */
  theme: { loopBank: string | null; playingBank: string | null; chunk: number } | null;
  /** the service-pass counter `frame()` answers */
  frame: number;
  standpoint: SavedStandpointV1;
  /** the open puppet's file (a conversation was up when the save was taken) */
  puppet: string | null;
  actors: SavedActorV1[];
  props: SavedPropV1[];
  /** open cast and prop files, with the extension the manifest gives them */
  castFiles: string[];
  propFiles: string[];
  /** open sound banks, by file name */
  bankFiles: string[];
  vars: SavedVar[];
  numGlobals: Map<string, number>;
  strGlobals: Map<string, string>;
  loops: SavedLoopV1[];
  /** characters caught mid-stride */
  walks: SavedWalkV1[];
  /** the file itself, kept so a writer can reproduce untouched containers */
  raw: RawSaveFile;
  /** where each interesting container sits — computed, never searched for */
  index: V1Index;
}

/** the positional container map (see the table in the module doc) */
export interface V1Index {
  banks: number;
  globals: number;
  pool: number;
  loops: number;
  crickets: number;
  walks: number;
}

/** the three service tables' fixed sizes — the writer `memcpy`s them whole, so
 *  these are constants in every save, and the triple is what says the tail of the
 *  map landed where it should (32 × 42, 16 × 48, 16 × 82) */
const V1_LOOPS_SIZE = 0x540;
const V1_CRICKETS_SIZE = 0x300;
const V1_WALKS_SIZE = 0x520;

/** does `banks` put the three service tables where they belong? */
function tailFits(raw: RawSaveFile, banks: number): boolean {
  const g = 7 + 3 * banks;
  return (
    raw.containers[g + 2]?.data.length === V1_LOOPS_SIZE &&
    raw.containers[g + 3]?.data.length === V1_CRICKETS_SIZE &&
    raw.containers[g + 4]?.data.length === V1_WALKS_SIZE
  );
}

/**
 * Which container is which, from the file's own numbers.
 *
 * `count = 7 + 3·banks + 5 + payloads`, and a payload only exists for an active
 * walk carrying waypoints. `banks` therefore follows from the count — but only
 * while `payloads < 3`, because three payloads and one extra bank cost the same
 * three containers. Every shipped save carries at most one (measured: 43 with
 * none, 13 with one, across all 56), so the count alone has never been wrong on
 * a real file; our own writer can produce a save with more.
 *
 * So the count proposes and the file confirms, and the confirmation is what makes
 * this a reading rather than a second convention (#325 — the check used to be
 * container 6's capacity alone, which is one-sided: an over-derived count that
 * still fits the array passed silently):
 *
 *  - the three service tables are FIXED sizes, so the tail of the map has to land
 *    on all three. Measured over the 56 shipped saves, exactly one `banks` value
 *    satisfies that in each — so when the count's proposal fails, solving for the
 *    one that fits recovers the map rather than giving up;
 *  - the leftover container count then has to equal the number of active walk
 *    slots that DECLARE a payload (`+0x24` non-zero). True in all 56, and it is
 *    the check that catches a `banks` off by one in the direction the fixed sizes
 *    cannot see;
 *  - and container 6 still has to have room for the banks.
 */
export function v1Index(raw: RawSaveFile): V1Index {
  const n = raw.containers.length;
  const proposed = Math.max(0, Math.floor((n - FIXED_CONTAINERS) / 3));
  let banks = proposed;
  if (!tailFits(raw, banks)) {
    // three payloads cost what a bank costs; the fixed tables say which it was
    const fits: number[] = [];
    for (let b = 0; FIXED_CONTAINERS + 3 * b <= n; b++) if (tailFits(raw, b)) fits.push(b);
    if (fits.length !== 1) {
      throw new Error(
        `v1 save: ${n} containers proposes ${proposed} sound banks, and ` +
          `${fits.length} value${fits.length === 1 ? "" : "s"} put the loops/crickets/walks tables at the tail`,
      );
    }
    banks = fits[0];
  }
  const room = Math.floor((raw.containers[6]?.data.length ?? 0) / BANK_STRIDE);
  // the bank array is capacity-sized, so it may have room to spare — but never
  // less room than there are banks
  if (banks > room) {
    throw new Error(`v1 save: ${banks} sound banks by container count, room for ${room} in container 6`);
  }
  const globals = 7 + 3 * banks;
  // the tail's own count, against the walks table's own answer
  const payloads = n - (FIXED_CONTAINERS + 3 * banks);
  const declared = declaredPayloads(raw.containers[globals + 4].data);
  if (payloads !== declared) {
    throw new Error(
      `v1 save: ${payloads} container${payloads === 1 ? "" : "s"} past the walks table, ` +
        `but ${declared} walk slot${declared === 1 ? "" : "s"} declare${declared === 1 ? "s" : ""} waypoints`,
    );
  }
  return { banks, globals, pool: globals + 1, loops: globals + 2, crickets: globals + 3, walks: globals + 4 };
}

/** how many active walk slots carry a waypoint container of their own */
function declaredPayloads(walks: Uint8Array): number {
  const dv = new DataView(walks.buffer, walks.byteOffset, walks.byteLength);
  let n = 0;
  for (let at = 0; at + WALK_STRIDE <= walks.length; at += WALK_STRIDE) {
    if (dv.getUint16(at + WALK_ACTIVE, true) && dv.getUint32(at + WALK_PAYLOAD, true)) n++;
  }
  return n;
}

/** a Pascal string field, or "" — the 16-byte fields hold 15 characters */
function pstr(d: Uint8Array, off: number, max = 15): string {
  return pstrAtChecked(d, off, 1, max) ?? "";
}

/** how many records a table container holds, given its stride and its slack */
function records(c: Container | undefined, stride: number): number {
  return c ? Math.floor(c.data.length / stride) : 0;
}

/** read the open-file manifest: the table every handle in the file resolves through */
function readFiles(d: Uint8Array): { handle: number; path: string }[] {
  const dv = new DataView(d.buffer, d.byteOffset, d.byteLength);
  const n = Math.min(dv.getUint32(C0_FILE_COUNT, true), 64);
  const out: { handle: number; path: string }[] = [];
  for (let i = 0; i < n; i++) {
    const at = C0_FILE_RECORDS + i * C0_FILE_STRIDE;
    if (at + C0_FILE_STRIDE > d.length) break;
    out.push({ handle: dv.getUint32(at, true), path: pstrAtChecked(d, at + 4, 0, 255) ?? "" });
  }
  return out;
}

/**
 * The extension a bare list name should have, from the manifest.
 *
 * The cast and prop lists name their files without one (`gang`, `house`), and a
 * load has to reopen them — `opencastfile("gang")` opens nothing. The manifest
 * has the answer for every file the session had open, as a full DOS-ish path
 * (`appl:local:gang.cst`), so the extension is read rather than assumed. Falls
 * back to the given default, because a file the manifest somehow lacks is still
 * better opened with a guess than not at all.
 */
function withExtension(files: { path: string }[], base: string, fallback: string): string {
  const low = base.toLowerCase();
  for (const f of files) {
    const name = f.path.split(":").pop()?.toLowerCase() ?? "";
    const dot = name.lastIndexOf(".");
    if (dot > 0 && name.slice(0, dot) === low) return name;
  }
  return `${low}.${fallback}`;
}

/** the file name a manifest handle refers to, or "" */
function fileByHandle(files: { handle: number; path: string }[], handle: number): string {
  if (!handle) return "";
  for (const f of files) {
    if (f.handle === handle) return f.path.split(":").pop() ?? "";
  }
  return "";
}

/** read one 164-byte cast record */
function readActor(d: Uint8Array, at: number): SavedActorV1 {
  const dv = new DataView(d.buffer, d.byteOffset, d.byteLength);
  return {
    name: pstr(d, at + ACTOR_NAME),
    owner: pstr(d, at + ACTOR_OWNER),
    set: pstr(d, at + ACTOR_SET),
    star: pstr(d, at + ACTOR_STAR),
    pose: pstr(d, at + ACTOR_POSE),
    visible: dv.getUint16(at + ACTOR_VISIBLE, true) !== 0,
    is3d: dv.getUint16(at + ACTOR_IS3D, true) !== 0,
    deg: dv.getUint16(at + ACTOR_DEG, true),
    scale: dv.getInt16(at + ACTOR_SCALE, true),
    speed: dv.getInt16(at + ACTOR_SPEED, true),
    turn: dv.getInt16(at + ACTOR_TURN, true),
    x: dv.getInt16(at + ACTOR_X, true),
    y: dv.getInt16(at + ACTOR_Y, true),
    z: dv.getInt16(at + ACTOR_Z, true),
  };
}

/** read one 158-byte prop record */
function readProp(d: Uint8Array, at: number): SavedPropV1 {
  const dv = new DataView(d.buffer, d.byteOffset, d.byteLength);
  return {
    name: pstr(d, at + PROP_NAME),
    owner: pstr(d, at + PROP_OWNER),
    view: pstr(d, at + PROP_VIEW),
    set: pstr(d, at + PROP_SET),
    star: pstr(d, at + PROP_STAR),
    visible: dv.getUint16(at + PROP_VISIBLE, true) !== 0,
    is3d: dv.getUint16(at + PROP_IS3D, true) !== 0,
    screenX: dv.getInt16(at + PROP_SCREEN_X, true),
    screenY: dv.getInt16(at + PROP_SCREEN_Y, true),
    deg: dv.getUint16(at + PROP_DEG, true),
    dist: dv.getInt16(at + PROP_DIST, true),
    scale: dv.getInt16(at + PROP_SCALE, true),
    x: dv.getInt16(at + PROP_X, true),
    y: dv.getInt16(at + PROP_Y, true),
    z: dv.getInt16(at + PROP_Z, true),
  };
}

/**
 * The walks in flight.
 *
 * A slot whose `active` word is clear is not a walk — it is the LAST walk that
 * slot ran, left in place.
 *
 * **And the `active` word does not settle it.** Across the 56 shipped saves the
 * filter above passes 140 records, and 58 of them have nothing left to walk:
 * `progress >= dist`, or a `dist` that is NEGATIVE — five of `D2A_008`'s records
 * read −1941692191, and the same 1941xxxxxx magnitude turns up as `progress` on
 * three others, which is one junk word read into two fields. Whatever tells
 * DF.EXE those records are spent is not the flag this reader honours, and is not
 * yet known. See the note in
 * [the format doc](../../../docs/engine/formats/savegame-v1.md).
 */
function readWalks(d: Uint8Array): SavedWalkV1[] {
  const dv = new DataView(d.buffer, d.byteOffset, d.byteLength);
  const out: SavedWalkV1[] = [];
  for (let i = 0; i < WALK_COUNT; i++) {
    const at = i * WALK_STRIDE;
    if (at + WALK_STRIDE > d.length) break;
    if (!dv.getUint16(at + WALK_ACTIVE, true)) continue;
    const actor = pstr(d, at + WALK_ACTOR);
    if (!actor) continue;
    const dx = dv.getInt32(at + WALK_DX, true);
    const dy = dv.getInt32(at + WALK_DY, true);
    const dz = dv.getInt32(at + WALK_DZ, true);
    const dist = dv.getInt32(at + WALK_DIST, true);
    const left = dv.getInt32(at + WALK_REMAINING, true);
    out.push({
      actor,
      star: pstr(d, at + WALK_STAR),
      // the record holds where the walk ENDS; where it began is that minus the
      // delta, which is what the mover wants
      startX: dv.getInt16(at + WALK_DEST_X, true) - dx,
      startY: dv.getInt16(at + WALK_DEST_Y, true) - dy,
      startZ: dv.getInt16(at + WALK_DEST_Z, true) - dz,
      dx,
      dy,
      dz,
      dist,
      // covered, not remaining — see WALK_STRIDE
      progress: Math.max(0, dist - left),
      turnTo: dv.getInt32(at + WALK_TURN_TO, true),
      deg: dv.getUint16(at + WALK_DEG, true),
      // A turn on the spot goes nowhere, so it is recognised by that rather than
      // by a type field: v1's own type word reads 1 for every sample in the
      // corpus, walkers and all, so it cannot be the thing that distinguishes
      // them and is not guessed at.
      turnOnly: dist <= 0 && dx === 0 && dy === 0 && dz === 0,
      hasPath: dv.getUint32(at + WALK_PAYLOAD, true) !== 0,
    });
  }
  return out;
}

/** the armed loop slots, from the table the engine hands the writer verbatim */
function readLoops(d: Uint8Array): SavedLoopV1[] {
  const dv = new DataView(d.buffer, d.byteOffset, d.byteLength);
  const out: SavedLoopV1[] = [];
  for (let i = 0; i < LOOP_COUNT; i++) {
    const at = i * LOOP_STRIDE;
    if (at + LOOP_STRIDE > d.length) break;
    if (!dv.getUint16(at + LOOP_ACTIVE, true)) continue;
    const kind = LOOP_KINDS[dv.getUint16(at + LOOP_KIND, true)];
    const name = pstr(d, at + LOOP_NAME);
    const handler = pstr(d, at + LOOP_HANDLER);
    if (!kind || !handler) continue;
    out.push({ kind, name, handler, period: dv.getUint32(at + LOOP_PERIOD, true) });
  }
  return out;
}

/**
 * Read a Dust save.
 *
 * Throws on a file that is not one (the framing reader's own gate), and on a
 * container map that contradicts itself. It does NOT check the version string —
 * that is the caller's decision, because this port is more forgiving about it
 * than DF.EXE is (see {@link saveTitleMatches}).
 */
export function parseSaveV1(bytes: Uint8Array): SaveGameV1 {
  const raw = readSaveFile(bytes);
  const index = v1Index(raw);
  const c0 = raw.containers[0].data;
  const c1 = raw.containers[1].data;
  const dv1 = new DataView(c1.buffer, c1.byteOffset, c1.byteLength);
  const files = readFiles(c0);

  const paths: string[] = [];
  for (let i = 0; i < C0_PATH_COUNT; i++) {
    paths.push(pstrAtChecked(c0, C0_PATHS + i * C0_PATH_STRIDE, 0, 255) ?? "");
  }

  const dv0 = new DataView(c0.buffer, c0.byteOffset, c0.byteLength);
  const loopBank = fileByHandle(files, dv0.getUint32(C0_THEME, true));
  const playingBank = fileByHandle(files, dv0.getUint32(C0_THEME + 4, true));
  const theme =
    loopBank || playingBank
      ? { loopBank: loopBank ?? null, playingBank: playingBank ?? null, chunk: dv0.getUint32(C0_THEME + 8, true) }
      : null;

  const deg = dv1.getUint16(C1_DEG, true);
  const standpoint: SavedStandpointV1 = {
    set: pstr(c1, C1_SET),
    // the file the room was open FROM, which is the one to reopen; the name is
    // kept beside it because scripts and actor records speak in names
    setFile: fileByHandle(files, dv1.getUint32(C1_SET_FILE, true)),
    flat: pstr(c1, C1_FLAT),
    flatFile: fileByHandle(files, dv1.getUint32(C1_FLAT_FILE, true)),
    cellX: dv1.getUint16(C1_CELL_X, true),
    cellZ: dv1.getUint16(C1_CELL_Z, true),
    facing: dv1.getUint16(C1_FACING, true),
    deg,
    camX: dv1.getUint16(C1_CAM_X, true),
    camY: dv1.getUint16(C1_CAM_Y, true),
    view: COMPASS[deg & 0xff] ?? "",
    eyeHeight: dv1.getInt16(C1_EYE_HEIGHT, true),
  };

  const actors: SavedActorV1[] = [];
  const ca = raw.containers[2];
  for (let i = 0; i < records(ca, ACTOR_STRIDE); i++) {
    const a = readActor(ca.data, i * ACTOR_STRIDE);
    if (a.name) actors.push(a);
  }

  const props: SavedPropV1[] = [];
  const cp = raw.containers[4];
  for (let i = 0; i < records(cp, PROP_STRIDE); i++) {
    const p = readProp(cp.data, i * PROP_STRIDE);
    if (p.name) props.push(p);
  }

  const list = (c: Container | undefined, ext: string): string[] => {
    const out: string[] = [];
    for (let i = 0; i < records(c, FILE_LIST_STRIDE); i++) {
      const name = pstr(c!.data, i * FILE_LIST_STRIDE + FILE_LIST_NAME, 12);
      if (name) out.push(withExtension(files, name, ext));
    }
    return out;
  };

  const bankFiles: string[] = [];
  const cb = raw.containers[6];
  for (let i = 0; i < index.banks; i++) {
    const name = pstr(cb.data, i * BANK_STRIDE + BANK_NAME, 12);
    if (name) bankFiles.push(name);
  }

  const globals = raw.containers[index.globals]?.data ?? new Uint8Array(0);
  const pool = raw.containers[index.pool]?.data;
  const vars = decodeVars(globals, pool);
  const numGlobals = new Map<string, number>();
  const strGlobals = new Map<string, string>();
  for (const v of vars) {
    if (v.type === DFVALUE_STRING) {
      if (v.str !== null) strGlobals.set(v.name, v.str);
    } else {
      numGlobals.set(v.name, v.num);
    }
  }

  return {
    title: pstrAtChecked(c0, C0_VERSION, 0, 255) ?? "",
    paths,
    files,
    clut: c0.subarray(C0_CLUT, C0_CLUT + C0_CLUT_SIZE),
    theme,
    frame: dv1.getUint32(C1_FRAME, true),
    standpoint,
    puppet: fileByHandle(files, dv1.getUint32(C1_PUPPET_HANDLE, true)) || null,
    actors,
    props,
    castFiles: list(raw.containers[3], "cst"),
    propFiles: list(raw.containers[5], "prp"),
    bankFiles,
    vars,
    numGlobals,
    strGlobals,
    loops: readLoops(raw.containers[index.loops]?.data ?? new Uint8Array(0)),
    walks: readWalks(raw.containers[index.walks]?.data ?? new Uint8Array(0)),
    raw,
    index,
  };
}

/**
 * Is this save's version string one we should accept?
 *
 * DF.EXE compares the two strings byte for byte and case matters
 * (`0x4303c0`) — and the shipped game contradicts itself about the case. The
 * menu's Save and Open buttons both pass `"dust 0.3"`, but the two quit dialogs
 * and the debug menu pass `"Dust 0.3"`, so a save written on the way out of the
 * original game **cannot be reopened by the original game**. That is a bug in
 * Dust, not a version difference, and reproducing it would only mean refusing
 * files the player has every reason to expect us to read.
 *
 * So the comparison here is case-insensitive, and that is the only liberty taken:
 * a genuinely different title still fails.
 */
export function saveTitleMatches(title: string, want: string): boolean {
  return title.trim().toLowerCase() === want.trim().toLowerCase();
}

// ---------------------------------------------------------------------------
// Writing — a patch over a base save
// ---------------------------------------------------------------------------

/** what a snapshot asks to be written into a base save */
export interface SavePatchV1 {
  numGlobals: Map<string, number>;
  strGlobals?: Map<string, string>;
  /** where the player is: the set's base name and the grid cell they stand on */
  standpoint?: {
    set: string;
    /** the set FILE ("apoth.set") — see the manifest rewrite in applyPatchV1 */
    setFile?: string;
    cellX: number;
    cellZ: number;
    facing: number;
    deg: number;
    camX: number;
    camY: number;
  };
  frame?: number;
  /**
   * What the LOADER needs from the set FILE itself, when the room changes.
   *
   * The counterpart of Titanic's `SavePatch.setFile` (engine/src/df/savegame.ts),
   * and the same two omissions it already covers: the registers the load
   * re-acquires ({@link C1_TRANSITION_REGISTER}) and the palette the screen comes
   * back in.
   */
  openSet?: {
    /** {@link SetFileV1.transitionRegister} of the room being written */
    transitionRegister: number;
    /** {@link SetFileV1.actorRegister} of the room being written */
    actorRegister: number;
    /**
     * {@link SetFileV1.eyeHeight} and {@link SetFileV1.cameraSetback} of the
     * room being written — the camera the actor projection looks through
     * (see {@link C1_EYE_HEIGHT}). Left stale, the new room's cast hovers.
     */
    eyeHeight: number;
    cameraSetback: number;
    /**
     * The set's own 256-entry palette ({@link SetFileV1.paletteRaw}), 8 bytes an
     * entry, written into container 0's live CLUT.
     *
     * Measured against the disc: in all 61 shipped saves the live CLUT is
     * palette 0 of the save's own set, byte for byte, except entries 0 and 255 —
     * black and white, the two slots Windows reserves — which are always
     * `{0, 0,0,0}` and `{255, -1,-1,-1}`. So those two are forced rather than
     * copied, and the rest is the room's.
     *
     * Without it a cross-room save loads in the base save's colours, which is
     * what a night-town palette does to the Mayor's landing.
     */
    clut?: Uint8Array;
  };
  props?: PropPatchV1[];
  actors?: ActorPatchV1[];
  loops?: SavedLoopV1[];
  /** the walks in flight — the whole table, like the loops */
  walks?: SavedWalkV1[];
  /** called for anything the base had no room for, with why */
  onDrop?: (name: string, why: string) => void;
}

export type PropPatchV1 = { name: string } & Partial<Omit<SavedPropV1, "name">>;
export type ActorPatchV1 = { name: string } & Partial<Omit<SavedActorV1, "name">>;

/** deep-copy a save so a patch cannot write through to the caller's bytes */
function copyOf(raw: RawSaveFile): RawSaveFile {
  return {
    header: raw.header.slice(),
    table: raw.table.slice(),
    containers: raw.containers.map((c) => ({ id: c.id, data: c.data.slice(), gap: c.gap })),
  };
}

/** write a u16/i16/u32 field inside a record */
function put16(d: Uint8Array, off: number, v: number): void {
  new DataView(d.buffer, d.byteOffset, d.byteLength).setInt16(off, v | 0, true);
}
function put32(d: Uint8Array, off: number, v: number): void {
  new DataView(d.buffer, d.byteOffset, d.byteLength).setUint32(off, v >>> 0, true);
}

/** every record in a table, by the name at `nameOff` */
function byName(d: Uint8Array, stride: number, nameOff: number): Map<string, number> {
  const out = new Map<string, number>();
  for (let at = 0; at + stride <= d.length; at += stride) {
    const name = pstrAtChecked(d, at + nameOff, 1, 15);
    if (name) out.set(name.toLowerCase(), at);
  }
  return out;
}

/**
 * Write a snapshot into a base save and serialize it.
 *
 * The same bargain v4's `applyPatch` makes, for the same reason: a save is a
 * serialized C++ object graph — heap pointers, a DFValue vtable, an allocator's
 * watermark — and nothing can build one from nothing. So a base file is copied
 * and the fields we understand are overwritten in place; everything else stays
 * exactly as the base had it, which is what keeps the file loadable by DF.EXE as
 * well as by this port.
 *
 * What is written: every global (numbers inline, strings interned into the base's
 * own pool), the standpoint, the frame counter, the prop and cast records the
 * base has a name for, and the loop table. What is not: the CLUT, the open-file
 * manifest, the sound banks, the crickets and the walks — the base's own answers
 * carry, and each is reported through `onDrop` where a caller asked for
 * something that could not be placed.
 */
export function applyPatchV1(base: RawSaveFile, patch: SavePatchV1): Uint8Array {
  const out = copyOf(base);
  const index = v1Index(out);
  const drop = patch.onDrop ?? (() => {});

  // ---- globals -----------------------------------------------------------
  const globals = out.containers[index.globals];
  const pool = out.containers[index.pool];
  if (globals && pool) {
    // Room for everything, BEFORE the DataView below is taken over the blob —
    // this may replace both containers' buffers. Without it a base with no free
    // node or no pool room simply drops the difference, which on Dust's small
    // bases is real state and twice over is `handitem` (#357).
    ensureVarRoom(
      globals,
      pool,
      [...patch.numGlobals.keys(), ...(patch.strGlobals?.keys() ?? [])],
      patch.strGlobals?.values() ?? [],
    );
    const gv = new DataView(globals.data.buffer, globals.data.byteOffset, globals.data.byteLength);
    let slots = recordSlots(globals.data);
    /**
     * Where this variable's DFValue is, or null if it cannot be placed.
     *
     * The offset may legitimately be NEGATIVE, and getting that wrong cost this
     * writer Dust's most important global. The pairing rule (see
     * `save-vars.ts`) is that a node's name goes with the PREVIOUS node's
     * DFValue — so the list HEAD's value sits one stride back, in the blob's own
     * header, at +20/+22. That is real storage: the header's other fields are
     * the pool watermark at +8, its size at +12 and its handle at +16, and
     * nothing claims +20. The play page's writer declines to touch its head
     * anyway, and can afford to — TAOOT's head is `clock`. Dust's is **day**,
     * the variable the entire five-day story is counted in, and a save that
     * could not write it would come back on the wrong day.
     */
    const slotFor = (name: string): number[] | null => {
      // EVERY slot the name decodes at, because a reader keeps the last and this
      // writer used to patch only the first — see {@link recordSlots}
      const have = slots.get(name)?.filter((at) => at + NODE_TYPE >= 0);
      if (have?.length) return have;
      // the base has no record for this variable: make one in the free tail of
      // its node array, exactly as a script assigning a new global would
      const made = newVarRecord(globals, name);
      if (made < 0) return null;
      slots = recordSlots(globals.data);
      return [made];
    };
    for (const [name, value] of patch.numGlobals) {
      const at = slotFor(name);
      if (at === null) {
        drop(name, "no record and no free node in the base");
        continue;
      }
      for (const slot of at) {
        // Keep a boolean a boolean: the two tags are distinct runtime types and
        // DF.EXE's boolean-taking commands check for exactly 2 (see DFVALUE_BOOLEAN
        // in save-vars.ts). A 0/1 in a slot the base wrote as boolean stays one.
        const was = gv.getUint16(slot + NODE_TYPE, true);
        const tag =
          was === DFVALUE_BOOLEAN && (value === 0 || value === 1) ? DFVALUE_BOOLEAN : DFVALUE_NUMBER_WRITTEN;
        gv.setUint16(slot + NODE_TYPE, tag, true);
        gv.setInt32(slot + NODE_VALUE, value | 0, true);
      }
    }
    for (const [name, text] of patch.strGlobals ?? []) {
      const at = slotFor(name);
      if (at === null) {
        drop(name, "no record and no free node in the base");
        continue;
      }
      const off = poolIntern(globals.data, pool, text);
      if (off < 0) {
        drop(name, `no room in the string pool for ${JSON.stringify(text)}`);
        continue;
      }
      for (const slot of at) {
        gv.setUint16(slot + NODE_TYPE, DFVALUE_STRING, true);
        gv.setInt32(slot + NODE_VALUE, off, true);
      }
    }
  }

  // ---- the standpoint and the frame counter -------------------------------
  const c1 = out.containers[1]?.data;
  if (c1 && c1.length >= C1_SIZE) {
    if (patch.standpoint) {
      const s = patch.standpoint;
      writePstrField(c1, C1_SET, s.set);
      put16(c1, C1_CELL_X, s.cellX);
      put16(c1, C1_CELL_Z, s.cellZ);
      put16(c1, C1_FACING, s.facing);
      put16(c1, C1_DEG, s.deg);
      put16(c1, C1_CAM_X, s.camX);
      put16(c1, C1_CAM_Y, s.camY);
      // the second copy of the triple, which the engine keeps for the walk it is
      // not in the middle of; written together so a load cannot read a stale one
      put16(c1, C1_CELL_X + 6, s.cellX);
      put16(c1, C1_CELL_Z + 6, s.cellZ);
      put16(c1, C1_FACING + 6, s.facing);
    }
    if (patch.frame !== undefined) put32(c1, C1_FRAME, patch.frame);
  }

  /*
   * ---- the room, in the manifest ----------------------------------------
   *
   * The set NAME just written is not what reopens the room: the loader follows
   * the handle at c1+396 into container 0's file manifest and opens the PATH it
   * finds there (see C1_SET_FILE). A base save carries the room it was taken in —
   * every shipped one is `dust:data:nite.set` — so a save written anywhere else
   * would name its own room in the name field and still send a load back to the
   * night town.
   *
   * So the manifest record is rewritten in place: the same handle, keeping its
   * volume prefix, with the new file's name. Rewriting the PATH rather than the
   * handle is what keeps the file coherent — the handle is what every other
   * container's reference resolves through, and inventing a new one would point
   * those references at nothing.
   */
  const setFile = patch.standpoint?.setFile;
  if (setFile && c1 && c1.length >= C1_SIZE) {
    const c0 = out.containers[0]?.data;
    const want = new DataView(c1.buffer, c1.byteOffset, c1.byteLength).getUint32(C1_SET_FILE, true);
    if (c0 && want) {
      const dv0 = new DataView(c0.buffer, c0.byteOffset, c0.byteLength);
      const n = Math.min(dv0.getUint32(C0_FILE_COUNT, true), 64);
      let found = false;
      for (let i = 0; i < n; i++) {
        const at = C0_FILE_RECORDS + i * C0_FILE_STRIDE;
        if (at + C0_FILE_STRIDE > c0.length) break;
        if (dv0.getUint32(at, true) !== want) continue;
        const was = pstrAtChecked(c0, at + 4, 0, 255) ?? "";
        const cut = was.lastIndexOf(":");
        const path = (cut >= 0 ? was.slice(0, cut + 1) : "") + setFile.toLowerCase();
        writePstrField(c0, at + 4, path, 255);
        found = true;
        break;
      }
      if (!found) drop(setFile, "the base's manifest has no record for the open set");
    }
  }

  /*
   * ---- the room's own two packs, and its colours ------------------------
   *
   * Reopening the set file is not the whole of arriving in a room: the loader
   * then acquires three packs out of it — pack 0, the ACTOR register and the
   * TRANSITION register — and it takes the last two indices from the save
   * (C1_TRANSITION_REGISTER). They belong to the room, so a save that changes
   * the room and not these sends the load looking for a container the new file
   * may not have. `mayupper.set` has 205 containers; `nite.set`, which every
   * shipped Dust save was taken in, says its actor register is 259.
   *
   * The CLUT is the same omission one layer over: container 0 carries the live
   * palette, and a room that arrives under the previous room's colours is what
   * the original showed when the registers alone were fixed.
   */
  const openSet = patch.openSet;
  if (openSet && c1 && c1.length >= C1_SIZE) {
    put32(c1, C1_TRANSITION_REGISTER, openSet.transitionRegister);
    put32(c1, C1_ACTOR_REGISTER, openSet.actorRegister);
    // the camera the actor projection looks through (see C1_EYE_HEIGHT). The
    // eye is rederived from the cell AS WRITTEN ABOVE rather than taken from
    // the patch, so the trio can never disagree with the standpoint beside it.
    put16(c1, C1_CAMERA_SETBACK, openSet.cameraSetback);
    put16(c1, C1_EYE_HEIGHT, openSet.eyeHeight);
    {
      const dv1 = new DataView(c1.buffer, c1.byteOffset, c1.byteLength);
      const facing = dv1.getUint16(C1_FACING, true);
      let ex = dv1.getUint16(C1_CELL_X, true) * 256 + 128;
      let ey = dv1.getUint16(C1_CELL_Z, true) * 256 + 128;
      const sb = openSet.cameraSetback;
      if (facing === 1) ey += sb;
      else if (facing === 2) ey -= sb;
      else if (facing === 3) ex -= sb;
      else if (facing === 4) ex += sb;
      put16(c1, C1_EYE_X, ex);
      put16(c1, C1_EYE_Y, ey);
      put16(c1, C1_EYE_Z, openSet.eyeHeight);
    }
    const c0 = out.containers[0]?.data;
    if (openSet.clut && c0 && c0.length >= C0_CLUT + C0_CLUT_SIZE) {
      if (openSet.clut.length < C0_CLUT_SIZE) {
        drop("clut", `${openSet.clut.length} bytes of palette, ${C0_CLUT_SIZE} needed`);
      } else {
        c0.set(openSet.clut.subarray(0, C0_CLUT_SIZE), C0_CLUT);
        // the two slots the live palette always holds itself — see openSet.clut
        const black = C0_CLUT;
        const white = C0_CLUT + 255 * 8;
        put16(c0, black, 0);
        put16(c0, black + 2, 0);
        put16(c0, black + 4, 0);
        put16(c0, black + 6, 0);
        put16(c0, white, 255);
        put16(c0, white + 2, -1);
        put16(c0, white + 4, -1);
        put16(c0, white + 6, -1);
      }
    }
  }

  // ---- props and cast ----------------------------------------------------
  const cp = out.containers[4]?.data;
  if (cp && patch.props) {
    const at = byName(cp, PROP_STRIDE, PROP_NAME);
    for (const p of patch.props) {
      const o = at.get(p.name.toLowerCase());
      if (o === undefined) {
        drop(p.name, "the base has no prop record with that name");
        continue;
      }
      if (p.owner !== undefined) writePstrField(cp, o + PROP_OWNER, p.owner);
      if (p.view !== undefined) writePstrField(cp, o + PROP_VIEW, p.view);
      if (p.set !== undefined) writePstrField(cp, o + PROP_SET, p.set);
      if (p.star !== undefined) writePstrField(cp, o + PROP_STAR, p.star);
      if (p.visible !== undefined) put16(cp, o + PROP_VISIBLE, p.visible ? 1 : 0);
      if (p.is3d !== undefined) put16(cp, o + PROP_IS3D, p.is3d ? 1 : 0);
      if (p.screenX !== undefined) put16(cp, o + PROP_SCREEN_X, p.screenX);
      if (p.screenY !== undefined) put16(cp, o + PROP_SCREEN_Y, p.screenY);
      if (p.deg !== undefined) put16(cp, o + PROP_DEG, p.deg);
      if (p.dist !== undefined) put16(cp, o + PROP_DIST, p.dist);
      if (p.scale !== undefined) put16(cp, o + PROP_SCALE, p.scale);
      if (p.x !== undefined) put16(cp, o + PROP_X, p.x);
      if (p.y !== undefined) put16(cp, o + PROP_Y, p.y);
      if (p.z !== undefined) put16(cp, o + PROP_Z, p.z);
    }
  }

  const ca = out.containers[2]?.data;
  if (ca && patch.actors) {
    const at = byName(ca, ACTOR_STRIDE, ACTOR_NAME);
    for (const a of patch.actors) {
      const o = at.get(a.name.toLowerCase());
      if (o === undefined) {
        drop(a.name, "the base has no cast record with that name");
        continue;
      }
      if (a.owner !== undefined) writePstrField(ca, o + ACTOR_OWNER, a.owner);
      if (a.set !== undefined) writePstrField(ca, o + ACTOR_SET, a.set);
      if (a.star !== undefined) writePstrField(ca, o + ACTOR_STAR, a.star);
      if (a.pose !== undefined) writePstrField(ca, o + ACTOR_POSE, a.pose);
      if (a.visible !== undefined) put16(ca, o + ACTOR_VISIBLE, a.visible ? 1 : 0);
      if (a.is3d !== undefined) put16(ca, o + ACTOR_IS3D, a.is3d ? 1 : 0);
      if (a.deg !== undefined) put16(ca, o + ACTOR_DEG, a.deg);
      if (a.scale !== undefined) put16(ca, o + ACTOR_SCALE, a.scale);
      if (a.speed !== undefined) put16(ca, o + ACTOR_SPEED, a.speed);
      if (a.turn !== undefined) put16(ca, o + ACTOR_TURN, a.turn);
      if (a.x !== undefined) put16(ca, o + ACTOR_X, a.x);
      if (a.z !== undefined) put16(ca, o + ACTOR_Z, a.z);
      if (a.y !== undefined) put16(ca, o + ACTOR_Y, a.y);
    }
  }

  // ---- the loop table ----------------------------------------------------
  // Rewritten whole rather than merged: it IS the live scheduler (the writer
  // memcpy's the engine's own table), so a slot the running game does not have
  // is a slot that must not come back.
  const cl = out.containers[index.loops]?.data;
  if (cl && patch.loops) {
    cl.fill(0, 0, Math.min(cl.length, LOOP_COUNT * LOOP_STRIDE));
    const kindOf = new Map(Object.entries(LOOP_KINDS).map(([k, v]) => [v, Number(k)]));
    let slot = 0;
    for (const l of patch.loops) {
      if (slot >= LOOP_COUNT) {
        drop(l.name, `more than ${LOOP_COUNT} loops — the table has no more slots`);
        continue;
      }
      const kind = kindOf.get(l.kind);
      if (kind === undefined) {
        drop(l.name, `unknown loop kind ${JSON.stringify(l.kind)}`);
        continue;
      }
      const at = slot * LOOP_STRIDE;
      if (at + LOOP_STRIDE > cl.length) break;
      put16(cl, at + LOOP_ACTIVE, 1);
      put16(cl, at + LOOP_KIND, kind);
      put32(cl, at + LOOP_PERIOD, l.period);
      writePstrField(cl, at + LOOP_NAME, l.name);
      writePstrField(cl, at + LOOP_HANDLER, l.handler);
      slot++;
    }
  }

  // ---- the walks ---------------------------------------------------------
  // The same wholesale rewrite the loops get, and for the same reason: the table
  // IS the live mover, so a slot the running game does not have is a walker who
  // must not set off again on load. A walk on an authored route is written as the
  // straight line it carries — the waypoint container is not reproduced, and the
  // caller is told, because arriving by a different road is a smaller lie than
  // not arriving at all.
  const cw = out.containers[index.walks]?.data;
  if (cw && patch.walks) {
    cw.fill(0, 0, Math.min(cw.length, WALK_COUNT * WALK_STRIDE));
    let slot = 0;
    for (const w of patch.walks) {
      if (slot >= WALK_COUNT) {
        drop(w.actor, `more than ${WALK_COUNT} walks — the table has no more slots`);
        continue;
      }
      const at = slot * WALK_STRIDE;
      if (at + WALK_STRIDE > cw.length) break;
      const dv = new DataView(cw.buffer, cw.byteOffset, cw.byteLength);
      put16(cw, at + WALK_ACTIVE, 1);
      dv.setInt32(at + WALK_TURN_TO, w.turnTo, true);
      dv.setInt32(at + WALK_DX, w.dx, true);
      dv.setInt32(at + WALK_DY, w.dy, true);
      dv.setInt32(at + WALK_DZ, w.dz, true);
      dv.setInt32(at + WALK_DIST, w.dist, true);
      put16(cw, at + WALK_DEG, w.deg);
      // the record holds the DESTINATION; the port carries the start and the delta
      put16(cw, at + WALK_DEST_X, w.startX + w.dx);
      put16(cw, at + WALK_DEST_Y, w.startY + w.dy);
      put16(cw, at + WALK_DEST_Z, w.startZ + w.dz);
      put16(cw, at + WALK_DEST_CELL_X, Math.floor((w.startX + w.dx) / 256));
      put16(cw, at + WALK_DEST_CELL_Z, Math.floor((w.startY + w.dy) / 256));
      // ...and how much is LEFT, not how much is done
      dv.setInt32(at + WALK_REMAINING, Math.max(0, w.dist - w.progress), true);
      dv.setUint32(at + WALK_PAYLOAD, 0, true); // no waypoint container is written
      writePstrField(cw, at + WALK_ACTOR, w.actor);
      writePstrField(cw, at + WALK_STAR, w.star);
      if (w.hasPath) drop(w.actor, "walking an authored route — written as the straight line");
      slot++;
    }
    // No slot references a waypoint container any more, so the base's own
    // payloads go with the table that named them. DF.EXE's loader reads one
    // container per DECLARING slot, so leaving them would be harmless to it —
    // but it would leave the file's own count disagreeing with its own walks
    // table, which is exactly what {@link v1Index} validates (#325), and v4's
    // `applyPatch` re-emits the tail for the same reason.
    out.containers.length = index.walks + 1;
  }

  return writeSaveFile(out);
}

/** the title a save written by this port carries — Dust's own, as its menu
 *  spells it (`NEW.FLT`'s save button passes exactly this) */
export const DUST_SAVE_TITLE = "dust 0.3";

/** a one-line description of a save, for a log or a list */
export function describeSaveV1(save: SaveGameV1): string {
  const s = save.standpoint;
  const day = save.numGlobals.get("day");
  const cash = save.numGlobals.get("playercash");
  return (
    `${save.title} · ${s.setFile || `${s.set}.set`} (${s.cellX},${s.cellZ}) facing ${s.view || s.facing}` +
    ` · frame ${save.frame} · day ${day ?? "?"} · $${cash ?? "?"}` +
    ` · ${save.actors.length} cast, ${save.props.length} props, ${save.loops.length} loops` +
    (save.puppet ? ` · ${save.puppet} open` : "")
  );
}
