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
 * | +4 | balls (v4's crickets' ids), `0x300` = 16 × 48 | `0x45FBD0`, `add esi,0x30` |
 * | +5 | walks, `0x520` = 16 × 82 | `0x45F170`, `add esi,0x52` |
 * | (var) | one waypoint payload per active walk carrying one | `0x41A41F` |
 *
 * Which means the indices are **positional**, not searched for: the count is
 * `7 + 3·banks + 5 + payloads`, so `banks` follows from the count and every index
 * follows from `banks`, checked against the file's own structures (see
 * {@link v1Index}). v4 is read the same way: hunting by content — a globals
 * probe looking for the strings `mission` and `playerdeath`, which are TAOOT's
 * vocabulary and appear in no Dust save — would read a Dust-shaped `.ti` as
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
 * The sound that was playing, as three words the writer asks the sound system
 * for (`0x419e36`–`0x419e68`).
 *
 * **+0xa00 is channel 3, the theme**: `0x429d10` writes channel 3's bank FILE
 * handle (`[0x45e2fd]`) here when the channel is busy and 0 when it is idle
 * (`0x409280(3)`, the channel-idle test). It fetches the record number too
 * (`[0x45e301]`) and throws it away into a local: the theme is not resumed from
 * a chunk, it is restarted from its bank's own loop list.
 *
 * **+0xa04 / +0xa08 are the effect channel's** bank file handle and 1-based
 * record number — channel 1 or 2, whichever `0x429e10` picks: channel 2's when
 * only channel 2 is busy (`0x429f20`, `[0x45e295]`/`[0x45e299]`), channel 1's
 * when only channel 1 is (`0x429ea0`, `[0x45e22d]`/`[0x45e231]`), and when both
 * are, the one whose sound record's word at +0x39 is greater. Both words are 0
 * while neither channel is busy, and each is written only while its channel is.
 *
 * The loader (`0x41ae10`) gives them back the same way: at `0x41b1a0` the
 * effect's record is replayed through `0x42a070` (the play-by-priority entry)
 * as its bank's records are re-registered, and at `0x41b2ec` the bank whose file
 * is the theme's has its loop list restarted (`0x429fa0`).
 *
 * Both are manifest handles, so they name the FILE — `NIGHT.SND` calls itself
 * `town.snd`, as `TOWN.SND` does, and only the handle says which one sounded.
 */
const C0_THEME = 0xa00;
const C0_EFFECT_FILE = 0xa04;
const C0_EFFECT_RECORD = 0xa08;
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
/**
 * Four settings a script makes and the loader takes back (all inside the window
 * it restores), each found at its builtin's handler:
 *
 *  - +268 `puppetgrab` (`0x4361fd`; the boot's default is 0, `0x42e121`);
 *  - +302 the frame interval `framerate (n)` sets — 60 Hz ticks per drawn frame,
 *    clamped 0..60, default 3; the pacing loop spins on it (`0x434167`, setter
 *    `0x42077d`);
 *  - +390 `setvisible` (`0x410151`; `opensetfile` resets it to 1, `0x40ea9f`,
 *    and a load does not run that);
 *  - +392/+394 the PLAYER's hitbox, `actorhitbox ("player", rz, rxy)`
 *    (`0x41314c`/`0x41315b`; `opensetfile` zeroes it).
 *
 * Every shipped save holds the defaults (1, 3, 1, 0/0), so these matter only to
 * a save taken inside a scene that changed them — which a port save can be.
 */
const C1_PUPPET_GRAB = 268;
const C1_FRAME_INTERVAL = 302;
const C1_SET_VISIBLE = 390;
const C1_PLAYER_HITBOX = 392;
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
 * offsets for the tail (`turn`, `speed`, `scale`, `zclip`) do not transfer
 * (`turn` and `speed` are pinned below, at +36 and +40). The placement is
 * pinned by measurement rather than by analogy: the three words at +26/+28/+30
 * match the world coordinates of the record's own named star in 23 of the 38
 * records whose star belongs to the open set, and no other offset in the record
 * matches even once.
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
 * Read off the RUNNING GAME rather than guessed from plausible-looking numbers.
 * The port's own boot is script-driven, so the values Dust's scripts set are observable:
 * Leroy, the dog and the horse all run at speed 3 and turn 7, the pig at 12 and
 * 16. The record reads exactly 3 at +40 and 7 at +36 for those three, and 16 at
 * +36 for the pig's group.
 *
 * Not +78 and +80, where the numbers are 32, 64, 100 and a uniform 100 and LOOK
 * like a speed and a turn rate: they are an order of magnitude out, and restored
 * as these every walker would cross the town at a sprint and spin on the spot.
 * Whatever those two fields are, they are not these.
 *
 * Worth restoring at all because only a script ever sets them and a load runs no
 * script: left at the cast's defaults, a resumed walk finishes at the wrong pace.
 */
const ACTOR_TURN = 36;
const ACTOR_SPEED = 40;
/** the screen anchor, y then x — `actorxy`'s second argument lands at +20 (`0x412f7b`) */
const ACTOR_ANCHOR_Y = 20;
const ACTOR_ANCHOR_X = 22;
/**
 * The star's TILE, x >> 8 and y >> 8, copied with the star (`0x414e53`) and not
 * kept up by a walk or `actorxyz` — so it is the cell of the star the actor was
 * last put on, not of where it stands.
 */
const ACTOR_TILE_X = 32;
const ACTOR_TILE_Y = 34;
/** the step within the pose's play list: reset by `actorpose` (`0x4122e3`), advanced by the draw (`0x4153b5`) */
const ACTOR_STEP = 38;
/**
 * `actordist`: set only for a screen actor and only to a negative layer
 * (`0x4124ae`); a world actor's draw overwrites it with its projected depth
 * (`0x4151d3`), and `actorxy` / `actoris3d (false)` make it −1.
 */
const ACTOR_DIST = 42;
/** a serial number from the global counter at `0x45e490`, asserted on write-back (`0x414c9f`) */
const ACTOR_SERIAL = 48;
/** where the last draw put the actor's foot point on the screen — a cache (`0x414f3b`) */
const ACTOR_DRAW_Y = 64;
const ACTOR_DRAW_X = 66;
/** `actorvalue`, a number (`0x414933`) */
const ACTOR_VALUE = 74;
/**
 * `actorzclip`, subtracted from the projected depth before the far cull
 * (`0x4149d3`, used at `0x415083`) — not a speed, though it was once taken for
 * one beside +80 (cow 80, pig 16, Bolivar −8).
 */
const ACTOR_ZCLIP = 78;
/** `actorhitbox (name, rz, rxy)`: index 1 reads +80, 2 reads +82 (`0x413182`, `0x413297`) */
const ACTOR_HITBOX_RZ = 80;
const ACTOR_HITBOX_RXY = 82;
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
/** the star's tile, as the cast record's +32/+34 (`0x41d3c9`) */
const PROP_TILE_X = 32;
const PROP_TILE_Y = 34;
/** the step within the view's frames: reset by `propview` (`0x41c13a`), advanced by the draw (`0x41eb42`) */
const PROP_STEP = 36;
/**
 * `propspeed` (getter 0x41c690 reads +38, setter 0x41c490 writes it clamped to
 * 1..256). 4 in every record no script touched across the 56 shipped RTDs, and
 * 11 or 12 on the tumbleweeds, whose `initprop` sets `random (2) + 10`.
 */
const PROP_SPEED = 38;
/** the serial, as the cast record's +48 (`0x41d34d`, checked at `0x41e424`) */
const PROP_SERIAL = 46;
/** the last draw's foot point on the screen — a cache (`0x41e6cb`) */
const PROP_DRAW_Y = 62;
const PROP_DRAW_X = 64;
/** `propvalue`, a number (`0x41bbc3`) */
const PROP_VALUE = 72;
/** `propzclip` (`0x41bc63`), the cast record's +78 one record over */
const PROP_ZCLIP = 76;
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

/**
 * Open sound banks, 38 bytes each (`ds:0x460b38`): the bank's file handle at +0,
 * the counts of its first two record arrays at +4/+6, three heap pointers, and
 * its name at +0x16. Read by the loader at `0x41b0da`–`0x41b305`.
 */
const BANK_STRIDE = 38;
const BANK_FILE = 0;
const BANK_SOUNDS = 4;
const BANK_CHUNKS = 6;
const BANK_NAME = 0x16;

/**
 * One sound record, 104 bytes, as `0x429a30` registers it out of the bank file
 * and the loader copies it back. Three arrays per bank: the one-shot sounds
 * (`[bank+0xa]`, count at +4), the theme's loop chunks (`[bank+0xe]`, count at
 * +6), and the loop list built from those (`[bank+0x12]`, rebuilt by the loader
 * from the bank file and never read from the save).
 *
 * What a load takes back from the first two arrays is the three per-sound
 * settings a script can change (`0x41b12d`–`0x41b190`, and `0x41b1e2`–`0x41b22f`
 * for the chunks, volume and pan only):
 *
 *   - +0x2f `soundvol`, 0..255, registered at 0xff (`0x42a3b0` / `0x42a3c0`);
 *   - +0x31 `soundpan`, 0..255, registered at 0x80 (`0x42a4e0` / `0x42a4f0`);
 *   - +0x33 `soundloop`, registered at 0 (`0x42a500` / `0x42a510`).
 *
 * +0x41 is the record's 1-based number in its bank file, and +0x45 its name.
 */
const SOUND_STRIDE = 104;
const SOUND_VOLUME = 0x2f;
const SOUND_PAN = 0x31;
const SOUND_LOOP = 0x33;
const SOUND_RECORD = 0x41;
const SOUND_NAME = 0x45;

/**
 * The walk record: 82 bytes, where v4's is 110. Built by `walktostar` at
 * `0x439260`, served each pass by `0x4395c0`.
 *
 * **+26 is where the walk STARTED, and +40 is how far it has COME.** `walktostar`
 * copies the actor's own position block into the record (`0x439459`) and sets
 * the delta to start minus star (`0x4394a9`); the service adds the actor's speed
 * to +40, clamps it to the distance (`0x439880`) and places the walker at
 * `start − delta · covered / dist` (`0x439890`). AFTERDOG has Jones on his way
 * to `town.jones2` (1736, 2488):
 *
 *     start           (1624, 1872)        +26 / +28
 *     start − star    (-112, -616)        +8 / +12
 *     distance         626                +20, and hypot(112, 616) = 626.1
 *     covered          111                +40
 *     which puts him   (1643.9, 1981.2)   start − delta × 111/626
 *     the cast says    (1643, 1981)       cast record +26 / +28
 *
 * The same position falls out of reading +26 as the destination and +40 as the
 * distance left, which is how this was once read — and a walk resumed that way
 * walked BACK to where it started. 9 of 9 active straight walks in the shipped
 * saves name a star at `+26 − delta`.
 *
 * A walk on an authored route (`+36` non-zero) never writes +8..+23 at all:
 * they hold whatever was on the stack (D1E_005's Mwife "measures" 23086). Its
 * geometry is in the waypoint container instead — see {@link readPayload}.
 */
const WALK_STRIDE = 82;
const WALK_COUNT = 16;
const WALK_ACTIVE = 0;
/** `pausewalk` depth: true adds one, false takes one off down to 0 (`0x4399e0`) */
const WALK_PAUSE = 2;
/** a facing to end on, or −1 once the turn is done — v4 spells this the same way */
const WALK_TURN_TO = 4;
/** a turn on the spot (`turntodeg`, `0x439187`): the walk ends when the facing is reached */
const WALK_TURN_ONLY = 6;
/** start minus destination, i32 each: across, into the screen, up */
const WALK_DX = 8;
const WALK_DY = 12;
const WALK_DZ = 16;
/** the whole walk's length, i32 */
const WALK_DIST = 20;
/** the walker's current facing */
const WALK_DEG = 24;
/** where the walk started, in world units and then as a tile */
const WALK_START_X = 26;
const WALK_START_Y = 28;
const WALK_START_Z = 30;
const WALK_START_TILE_X = 32;
const WALK_START_TILE_Y = 34;
/** an authored route's waypoints, as the handle of a container of its own */
const WALK_PAYLOAD = 36;
/** how much of {@link WALK_DIST} is COVERED */
const WALK_COVERED = 40;
/** 1: the walker moves; 0: not in the open set, so it waits and is snapped on arrival (`0x4396f5`) */
const WALK_MOVER = 44;
/** the walker's slot in the cast table */
const WALK_CAST_SLOT = 46;
const WALK_ACTOR = 50;
const WALK_STAR = 66;

/**
 * A route's waypoints (builder `0x410f00` → `0x411300`): {u32 count, u32 total
 * length, 8 bytes carried over from the set and never read}, then per point
 * {i16 x, i16 y, i16 z, i16 length from the previous point}. No current point is
 * stored: the walker finds its leg by subtracting leg lengths from the covered
 * distance (`0x43aa3b`). Checked on all 13 shipped payloads: the position that
 * predicts is the cast record's to within a unit.
 */
const PAYLOAD_HEAD = 16;
const PAYLOAD_POINT = 8;

/**
 * DF.EXE's ball table, 16 × 48 at `0x45fbd0` — `makeball`'s projectiles
 * (insert `0x439cb0`, served by `0x439cf0`), not v4's crickets, whose ids
 * these commands reuse. {u16 active, u16 pause depth, i16 vx vy vz, i16 gravity,
 * i16 bounce, i16 frames left, i16 deg x y z, i16 tile x y, u32 prop slot,
 * pstr name @0x20}. A cleared slot keeps its last record with `active` 0.
 */
const BALL_STRIDE = 0x30;
const BALL_COUNT = 16;
const BALL_NAME = 0x20;
const BALL_PROP_SLOT = 0x1c;

/** the loop table, byte-identical to v4's: 32 × 42 */
const LOOP_STRIDE = 42;
const LOOP_COUNT = 32;
const LOOP_ACTIVE = 0;
/** `pauseloop` depth, as the walk's (`0x43904d`) */
const LOOP_PAUSE = 2;
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
  /** the screen anchor `actorxy` sets */
  anchorX: number;
  anchorY: number;
  /** the step within the pose */
  step: number;
  /** `actordist` for a screen actor; the last projected depth for a world one */
  dist: number;
  /** `actorvalue` */
  value: number;
  /** `actorzclip` */
  zclip: number;
  /** `actorhitbox`: [rz, rxy] */
  hitbox: [number, number];
  /** the tile of the star last given (x >> 8, y >> 8) */
  tileX: number;
  tileY: number;
  /** read-only engine bookkeeping: the serial, and where the last draw put it */
  serial: number;
  drawX: number;
  drawY: number;
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
  /** the step within the view's frames */
  step: number;
  /** `propspeed` */
  speed: number;
  /** `propvalue` */
  value: number;
  /** `propzclip` */
  zclip: number;
  /** the tile of the star last given */
  tileX: number;
  tileY: number;
  /** read-only engine bookkeeping: the serial, and where the last draw put it */
  serial: number;
  drawX: number;
  drawY: number;
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
  /** `pausewalk` held it when the save was taken */
  paused?: boolean;
  /** ...this many deep (+2); absent = `paused ? 1 : 0` */
  pauseDepth?: number;
  /**
   * The walker was not in the open set (+44 = 0): DF.EXE moves nothing and, once
   * the set is open, puts the actor on the destination star and ends the walk
   * (`0x4396f5`). Its +8..+23 are never written — stack leftovers, which is the
   * "junk walk" seventeen shipped records carry, every one on a `walknodata` actor.
   */
  waiting?: boolean;
  /** the walk follows an authored route, whose waypoints are {@link path} */
  hasPath: boolean;
  /** the route's points with the cumulative distance to each, `dist` being the last */
  path?: { x: number; y: number; z: number; cum: number }[];
}

/** one `makeball` slot */
export interface SavedBallV1 {
  /** the slot, 0..15 — the table is positional */
  slot: number;
  /** the prop it throws */
  name: string;
  /** false for a cleared slot, which keeps its last record */
  active: boolean;
  pause: number;
  vx: number;
  vy: number;
  vz: number;
  gravity: number;
  bounce: number;
  frames: number;
  deg: number;
  x: number;
  y: number;
  z: number;
  tx: number;
  ty: number;
}

/** one sound record out of a bank's tables (see {@link SOUND_STRIDE}) */
export interface SavedSoundV1 {
  /** the bank FILE it belongs to */
  bank: string;
  /** "sound" for a one-shot, "chunk" for one of the theme's loop chunks */
  kind: "sound" | "chunk";
  name: string;
  /** 1-based, in the bank file */
  record: number;
  volume: number;
  pan: number;
  /** `soundloop` — restored for one-shots only, as the loader does */
  loop: boolean;
}

/** one armed `makeloop` slot */
export interface SavedLoopV1 {
  kind: string;
  name: string;
  handler: string;
  period: number;
  /** `pauseloop` held it */
  paused?: boolean;
  /** ...this many deep (+2); absent = `paused ? 1 : 0` */
  pauseDepth?: number;
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
  /** the script settings at {@link C1_PUPPET_GRAB} and after */
  puppetGrab: boolean;
  frameInterval: number;
  setVisible: boolean;
  playerHitbox: [number, number];
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
   * The theme that was playing — channel 3's bank FILE, out of the manifest
   * ({@link C0_THEME}) — or null when the save was taken with the theme idle.
   */
  theme: { bank: string } | null;
  /**
   * The sound on the effect channel (1 or 2) when the save was taken: its bank
   * file and its 1-based record number there — see {@link C0_THEME}. A load
   * replays it from the start, as DF.EXE's does.
   */
  effect: { bank: string; record: number } | null;
  /** every registered one-shot sound and loop chunk with its script settings */
  sounds: SavedSoundV1[];
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
  /** the {@link numGlobals} whose record is a BOOLEAN (type 2) */
  boolGlobals: Set<string>;
  loops: SavedLoopV1[];
  /** characters caught mid-stride */
  walks: SavedWalkV1[];
  /** the ball table, every slot that has ever held a ball */
  balls: SavedBallV1[];
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
 * this a reading rather than a second convention (#325 — container 6's capacity
 * alone would be one-sided: an over-derived count that still fits the array
 * would pass silently):
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
    // the list keeps the name the SCRIPT opened the file by, and HUB.SET's
    // openset says `openshopfile ("hub.prp")` where every other room says
    // `"house"` — so a name can already be the file's whole name (D4MINES.RTD,
    // MSKPZL.RTD, ENDPZL.RTD: "hub.prp", read as "hub.prp.prp" before)
    if (name === low) return name;
    const dot = name.lastIndexOf(".");
    if (dot > 0 && name.slice(0, dot) === low) return name;
  }
  return low.endsWith(`.${fallback}`) ? low : `${low}.${fallback}`;
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
    anchorX: dv.getInt16(at + ACTOR_ANCHOR_X, true),
    anchorY: dv.getInt16(at + ACTOR_ANCHOR_Y, true),
    step: dv.getInt16(at + ACTOR_STEP, true),
    dist: dv.getInt16(at + ACTOR_DIST, true),
    value: dv.getInt32(at + ACTOR_VALUE, true),
    zclip: dv.getInt16(at + ACTOR_ZCLIP, true),
    hitbox: [dv.getInt16(at + ACTOR_HITBOX_RZ, true), dv.getInt16(at + ACTOR_HITBOX_RXY, true)],
    tileX: dv.getInt16(at + ACTOR_TILE_X, true),
    tileY: dv.getInt16(at + ACTOR_TILE_Y, true),
    serial: dv.getUint32(at + ACTOR_SERIAL, true),
    drawX: dv.getInt16(at + ACTOR_DRAW_X, true),
    drawY: dv.getInt16(at + ACTOR_DRAW_Y, true),
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
    step: dv.getInt16(at + PROP_STEP, true),
    speed: dv.getInt16(at + PROP_SPEED, true),
    value: dv.getInt32(at + PROP_VALUE, true),
    zclip: dv.getInt16(at + PROP_ZCLIP, true),
    tileX: dv.getInt16(at + PROP_TILE_X, true),
    tileY: dv.getInt16(at + PROP_TILE_Y, true),
    serial: dv.getUint32(at + PROP_SERIAL, true),
    drawX: dv.getInt16(at + PROP_DRAW_X, true),
    drawY: dv.getInt16(at + PROP_DRAW_Y, true),
  };
}

/**
 * The walks in flight, each with its route's waypoints if it has one.
 *
 * A slot whose `active` word is clear is not a walk — it is the LAST walk that
 * slot ran, left in place. `payloads` are the containers after the walks table,
 * one per active slot that declares one, in slot order (the writer's
 * `0x41A41F`).
 */
function readWalks(d: Uint8Array, payloads: Uint8Array[]): SavedWalkV1[] {
  const dv = new DataView(d.buffer, d.byteOffset, d.byteLength);
  const out: SavedWalkV1[] = [];
  let next = 0;
  for (let i = 0; i < WALK_COUNT; i++) {
    const at = i * WALK_STRIDE;
    if (at + WALK_STRIDE > d.length) break;
    if (!dv.getUint16(at + WALK_ACTIVE, true)) continue;
    const declares = dv.getUint32(at + WALK_PAYLOAD, true) !== 0;
    const payload = declares ? payloads[next++] : undefined;
    const actor = pstr(d, at + WALK_ACTOR);
    if (!actor) continue;
    const startX = dv.getInt16(at + WALK_START_X, true);
    const startY = dv.getInt16(at + WALK_START_Y, true);
    const startZ = dv.getInt16(at + WALK_START_Z, true);
    const covered = dv.getInt32(at + WALK_COVERED, true);
    const base = {
      actor,
      star: pstr(d, at + WALK_STAR),
      turnTo: dv.getInt16(at + WALK_TURN_TO, true),
      deg: dv.getUint16(at + WALK_DEG, true),
      turnOnly: dv.getInt16(at + WALK_TURN_ONLY, true) !== 0,
      paused: dv.getUint16(at + WALK_PAUSE, true) > 0,
      pauseDepth: dv.getUint16(at + WALK_PAUSE, true),
      waiting: dv.getInt16(at + WALK_MOVER, true) === 0,
    };
    const path = payload ? readPayload(payload) : null;
    if (path) {
      const end = path.at(-1)!;
      const dist = end.cum;
      out.push({
        ...base,
        startX: path[0].x,
        startY: path[0].y,
        startZ: path[0].z,
        dx: end.x - path[0].x,
        dy: end.y - path[0].y,
        dz: end.z - path[0].z,
        dist,
        progress: Math.max(0, Math.min(dist, covered)),
        hasPath: true,
        path,
      });
      continue;
    }
    // start minus destination, so the walk's own delta is its negation
    const dx = -dv.getInt32(at + WALK_DX, true);
    const dy = -dv.getInt32(at + WALK_DY, true);
    const dz = -dv.getInt32(at + WALK_DZ, true);
    const dist = dv.getInt32(at + WALK_DIST, true);
    out.push({
      ...base,
      startX,
      startY,
      startZ,
      dx,
      dy,
      dz,
      dist,
      progress: Math.max(0, covered),
      // A turn on the spot is flagged (+6), and also goes nowhere
      turnOnly: base.turnOnly || (dist <= 0 && dx === 0 && dy === 0 && dz === 0),
      hasPath: declares,
    });
  }
  return out;
}

/** a route's waypoints, with the cumulative distance the walker paces by — or null if malformed */
function readPayload(d: Uint8Array): { x: number; y: number; z: number; cum: number }[] | null {
  if (d.length < PAYLOAD_HEAD) return null;
  const dv = new DataView(d.buffer, d.byteOffset, d.byteLength);
  const n = dv.getUint32(0, true);
  if (n < 1 || PAYLOAD_HEAD + n * PAYLOAD_POINT > d.length) return null;
  const out: { x: number; y: number; z: number; cum: number }[] = [];
  let cum = 0;
  for (let k = 0; k < n; k++) {
    const at = PAYLOAD_HEAD + k * PAYLOAD_POINT;
    if (k > 0) cum += dv.getInt16(at + 6, true);
    out.push({ x: dv.getInt16(at, true), y: dv.getInt16(at + 2, true), z: dv.getInt16(at + 4, true), cum });
  }
  return out;
}

/** a route as a waypoint container, the inverse of {@link readPayload} */
function writePayload(path: { x: number; y: number; z: number; cum: number }[]): Uint8Array {
  const size = PAYLOAD_HEAD + path.length * PAYLOAD_POINT;
  const d = new Uint8Array(Math.ceil(size / 32) * 32);
  const dv = new DataView(d.buffer);
  dv.setUint32(0, path.length, true);
  dv.setUint32(4, path.at(-1)?.cum ?? 0, true);
  path.forEach((p, k) => {
    const at = PAYLOAD_HEAD + k * PAYLOAD_POINT;
    dv.setInt16(at, p.x, true);
    dv.setInt16(at + 2, p.y, true);
    dv.setInt16(at + 4, p.z, true);
    dv.setInt16(at + 6, k > 0 ? p.cum - path[k - 1].cum : 0, true);
  });
  return d;
}

/** the ball table: every slot that names a prop, cleared or not */
function readBalls(d: Uint8Array): SavedBallV1[] {
  const dv = new DataView(d.buffer, d.byteOffset, d.byteLength);
  const out: SavedBallV1[] = [];
  for (let i = 0; i < BALL_COUNT && (i + 1) * BALL_STRIDE <= d.length; i++) {
    const at = i * BALL_STRIDE;
    const name = pstr(d, at + BALL_NAME);
    if (!name) continue;
    const w = (o: number) => dv.getInt16(at + o, true);
    out.push({
      slot: i,
      name,
      active: dv.getUint16(at, true) !== 0,
      pause: dv.getUint16(at + 2, true),
      vx: w(4),
      vy: w(6),
      vz: w(8),
      gravity: w(0xa),
      bounce: w(0xc),
      frames: w(0xe),
      deg: w(0x10),
      x: w(0x12),
      y: w(0x14),
      z: w(0x16),
      tx: w(0x18),
      ty: w(0x1a),
    });
  }
  return out;
}

/** the first two record arrays of bank `i`: its one-shots, then its loop chunks */
function readBankSounds(raw: RawSaveFile, files: { handle: number; path: string }[], i: number): SavedSoundV1[] {
  const cb = raw.containers[6].data;
  const dvb = new DataView(cb.buffer, cb.byteOffset, cb.byteLength);
  const at = i * BANK_STRIDE;
  const bank = fileByHandle(files, dvb.getUint32(at + BANK_FILE, true));
  const out: SavedSoundV1[] = [];
  const arrays: [SavedSoundV1["kind"], number, number][] = [
    ["sound", 7 + 3 * i, dvb.getInt16(at + BANK_SOUNDS, true)],
    ["chunk", 8 + 3 * i, dvb.getInt16(at + BANK_CHUNKS, true)],
  ];
  for (const [kind, ci, count] of arrays) {
    const d = raw.containers[ci]?.data;
    if (!d) continue;
    const dv = new DataView(d.buffer, d.byteOffset, d.byteLength);
    for (let r = 0; r < count && (r + 1) * SOUND_STRIDE <= d.length; r++) {
      const o = r * SOUND_STRIDE;
      out.push({
        bank,
        kind,
        name: pstr(d, o + SOUND_NAME, 31),
        record: dv.getInt32(o + SOUND_RECORD, true),
        volume: dv.getInt16(o + SOUND_VOLUME, true),
        pan: dv.getInt16(o + SOUND_PAN, true),
        loop: dv.getInt16(o + SOUND_LOOP, true) !== 0,
      });
    }
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
    out.push({
      kind,
      name,
      handler,
      period: dv.getUint32(at + LOOP_PERIOD, true),
      paused: dv.getUint16(at + LOOP_PAUSE, true) > 0,
      pauseDepth: dv.getUint16(at + LOOP_PAUSE, true),
    });
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
  const themeBank = fileByHandle(files, dv0.getUint32(C0_THEME, true));
  const theme = themeBank ? { bank: themeBank } : null;
  const effectBank = fileByHandle(files, dv0.getUint32(C0_EFFECT_FILE, true));
  const effectRecord = dv0.getUint32(C0_EFFECT_RECORD, true);
  const effect = effectBank && effectRecord ? { bank: effectBank, record: effectRecord } : null;

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
    puppetGrab: dv1.getUint16(C1_PUPPET_GRAB, true) !== 0,
    frameInterval: dv1.getInt16(C1_FRAME_INTERVAL, true),
    setVisible: dv1.getUint16(C1_SET_VISIBLE, true) !== 0,
    playerHitbox: [dv1.getInt16(C1_PLAYER_HITBOX, true), dv1.getInt16(C1_PLAYER_HITBOX + 2, true)],
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
  const sounds: SavedSoundV1[] = [];
  const cb = raw.containers[6];
  for (let i = 0; i < index.banks; i++) {
    const name = pstr(cb.data, i * BANK_STRIDE + BANK_NAME, 12);
    if (name) bankFiles.push(name);
    sounds.push(...readBankSounds(raw, files, i));
  }

  const globals = raw.containers[index.globals]?.data ?? new Uint8Array(0);
  const pool = raw.containers[index.pool]?.data;
  const vars = decodeVars(globals, pool);
  const numGlobals = new Map<string, number>();
  const strGlobals = new Map<string, string>();
  const boolGlobals = new Set<string>();
  for (const v of vars) {
    if (v.type === DFVALUE_STRING) {
      if (v.str !== null) strGlobals.set(v.name, v.str);
    } else {
      numGlobals.set(v.name, v.num);
      if (v.type === DFVALUE_BOOLEAN) boolGlobals.add(v.name);
      else boolGlobals.delete(v.name);
    }
  }

  return {
    title: pstrAtChecked(c0, C0_VERSION, 0, 255) ?? "",
    paths,
    files,
    clut: c0.subarray(C0_CLUT, C0_CLUT + C0_CLUT_SIZE),
    theme,
    effect,
    sounds,
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
    boolGlobals,
    loops: readLoops(raw.containers[index.loops]?.data ?? new Uint8Array(0)),
    walks: readWalks(
      raw.containers[index.walks]?.data ?? new Uint8Array(0),
      raw.containers.slice(index.walks + 1).map((c) => c.data),
    ),
    balls: readBalls(raw.containers[index.crickets]?.data ?? new Uint8Array(0)),
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
  /** which {@link numGlobals} are BOOLEANS (tag 2) — see SavePatch.boolGlobals */
  boolGlobals?: Set<string>;
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
   * The counterpart of Titanic's `SavePatch.setFile` (engine/src/df/savegame-patch.ts),
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
  /** the ball table — the whole of it, by slot */
  balls?: Omit<SavedBallV1, "active">[];
  /** the script settings in the standpoint block (see {@link C1_PUPPET_GRAB}) */
  settings?: { puppetGrab?: boolean; frameInterval?: number; setVisible?: boolean; playerHitbox?: [number, number] };
  /**
   * The sound, as {@link C0_THEME} holds it. `theme` is the theme's bank FILE
   * (null: the theme channel is idle); `effect` the sound on the effect channel,
   * by bank file and name (null: neither effect channel is busy). Undefined
   * keeps the base's words.
   */
  theme?: string | null;
  effect?: { bank: string; name: string } | null;
  /**
   * Script settings per sound, by bank FILE and name — written into whichever
   * of the base's registered records match (see {@link SOUND_STRIDE}).
   * `kind: "chunk"` carries a theme's `themevol`, which the bank keeps on every
   * one of its loop chunks, so its `name` is ignored and only `volume` is used.
   */
  sounds?: { bank: string; kind: "sound" | "chunk"; name: string; volume: number; pan: number; loop: boolean }[];
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
 * own pool), the standpoint and its script settings, the frame counter, the
 * prop and cast records the base has a name for, the theme and effect words and
 * the per-sound settings of every bank the base has open, and the loop, ball
 * and walk tables with each route's waypoints. What is not: the open-file
 * manifest beyond the set's own record, and the bank list — the base's own
 * answers carry, and each is reported through `onDrop` where a caller asked for
 * something that could not be placed.
 */
export function applyPatchV1(base: RawSaveFile, patch: SavePatchV1): Uint8Array {
  const out = copyOf(base);
  const index = v1Index(out);
  const drop = patch.onDrop ?? (() => {});

  patchGlobalsV1(base, out, index, patch, drop);
  patchStandpointV1(base, out, index, patch, drop);
  patchSoundV1(base, out, index, patch, drop);
  patchPropsAndCastV1(base, out, index, patch, drop);
  patchLoopsV1(base, out, index, patch, drop);
  patchBallsV1(base, out, index, patch, drop);
  patchWalksV1(base, out, index, patch, drop);

  return writeSaveFile(out);
}

/** the globals and the string pool they point into */
function patchGlobalsV1(base: RawSaveFile, out: RawSaveFile, index: V1Index, patch: SavePatchV1, drop: NonNullable<SavePatchV1["onDrop"]>): void {
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
     * The offset may legitimately be NEGATIVE, and getting that wrong costs
     * Dust's most important global. The pairing rule (see
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
      // EVERY slot the name decodes at, because a reader keeps the last and a
      // writer patching only the first would lose the write — see {@link recordSlots}
      const have = slots.get(name)?.filter((at) => at + NODE_TYPE >= 0);
      if (have?.length) return have;
      // the base has no record for this variable: make one in the free tail of
      // its node array, exactly as a script assigning a new global would
      const made = newVarRecord(globals, name);
      if (made < 0) return null;
      slots = recordSlots(globals.data);
      return [made];
    };
    /** why a name has no record: its length, or (in a base that could not be
     *  grown — see ensureVarRoom) the room */
    const homeless = (name: string): string =>
      name.length > 15 ? "longer than a record's 15 characters" : "no record and no free node in the base";
    for (const [name, value] of patch.numGlobals) {
      const at = slotFor(name);
      if (at === null) {
        drop(name, homeless(name));
        continue;
      }
      for (const slot of at) {
        // Keep a boolean a boolean: the two tags are distinct runtime types and
        // DF.EXE's boolean-taking commands check for exactly 2 (see DFVALUE_BOOLEAN
        // in save-vars.ts). The interpreter says which (boolGlobals); without
        // it, a 0/1 in a slot the base wrote as boolean stays one.
        const was = gv.getUint16(slot + NODE_TYPE, true);
        const isBool = patch.boolGlobals
          ? patch.boolGlobals.has(name)
          : was === DFVALUE_BOOLEAN && (value === 0 || value === 1);
        const tag = isBool ? DFVALUE_BOOLEAN : DFVALUE_NUMBER_WRITTEN;
        gv.setUint16(slot + NODE_TYPE, tag, true);
        gv.setInt32(slot + NODE_VALUE, value | 0, true);
      }
    }
    for (const [name, text] of patch.strGlobals ?? []) {
      const at = slotFor(name);
      if (at === null) {
        drop(name, homeless(name));
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
}

/** the standpoint, the frame counter, the set file and the open set */
function patchStandpointV1(base: RawSaveFile, out: RawSaveFile, index: V1Index, patch: SavePatchV1, drop: NonNullable<SavePatchV1["onDrop"]>): void {
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
    const set = patch.settings;
    if (set?.puppetGrab !== undefined) put16(c1, C1_PUPPET_GRAB, set.puppetGrab ? 1 : 0);
    if (set?.frameInterval !== undefined) put16(c1, C1_FRAME_INTERVAL, set.frameInterval);
    if (set?.setVisible !== undefined) put16(c1, C1_SET_VISIBLE, set.setVisible ? 1 : 0);
    if (set?.playerHitbox) {
      put16(c1, C1_PLAYER_HITBOX, set.playerHitbox[0]);
      put16(c1, C1_PLAYER_HITBOX + 2, set.playerHitbox[1]);
    }
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
}

/** the sound: per-sound settings of every open bank */
function patchSoundV1(base: RawSaveFile, out: RawSaveFile, index: V1Index, patch: SavePatchV1, drop: NonNullable<SavePatchV1["onDrop"]>): void {
  // ---- the sound -----------------------------------------------------------
  const c0 = out.containers[0]?.data;
  const files = c0 ? readFiles(c0) : [];
  const handleOf = (file: string): number => {
    const want = file.toLowerCase();
    return files.find((f) => (f.path.split(":").pop() ?? "").toLowerCase() === want)?.handle ?? 0;
  };
  if (c0 && patch.theme !== undefined) {
    const h = patch.theme ? handleOf(patch.theme) : 0;
    if (patch.theme && !h) drop(patch.theme, "the theme's bank is not in the base's open-file manifest");
    put32(c0, C0_THEME, h);
  }
  // the bank tables, as (bank file, kind, name) -> record offset
  const records = new Map<string, { data: Uint8Array; at: number }[]>();
  const cb = out.containers[6]?.data;
  if (cb) {
    const dvb = new DataView(cb.buffer, cb.byteOffset, cb.byteLength);
    for (let i = 0; i < index.banks; i++) {
      const bank = fileByHandle(files, dvb.getUint32(i * BANK_STRIDE + BANK_FILE, true)).toLowerCase();
      const arrays: ["sound" | "chunk", number, number][] = [
        ["sound", 7 + 3 * i, dvb.getInt16(i * BANK_STRIDE + BANK_SOUNDS, true)],
        ["chunk", 8 + 3 * i, dvb.getInt16(i * BANK_STRIDE + BANK_CHUNKS, true)],
      ];
      for (const [kind, ci, count] of arrays) {
        const d = out.containers[ci]?.data;
        if (!d) continue;
        for (let r = 0; r < count && (r + 1) * SOUND_STRIDE <= d.length; r++) {
          const name = pstr(d, r * SOUND_STRIDE + SOUND_NAME, 31).toLowerCase();
          const key = kind === "chunk" ? `${bank}|chunk` : `${bank}|sound|${name}`;
          const list = records.get(key) ?? [];
          // a one-shot is one record; a theme's volume is on all of its chunks
          if (kind === "chunk" || !list.length) list.push({ data: d, at: r * SOUND_STRIDE });
          records.set(key, list);
        }
      }
    }
  }
  if (c0 && patch.effect !== undefined) {
    let file = 0;
    let record = 0;
    if (patch.effect) {
      const e = patch.effect;
      const rec = records.get(`${e.bank.toLowerCase()}|sound|${e.name.toLowerCase()}`)?.[0];
      file = handleOf(e.bank);
      record = rec ? new DataView(rec.data.buffer, rec.data.byteOffset).getInt32(rec.at + SOUND_RECORD, true) : 0;
      if (!file || !record) {
        drop(e.name, "the playing sound's bank is not one the base has open");
        file = 0;
        record = 0;
      }
    }
    put32(c0, C0_EFFECT_FILE, file);
    put32(c0, C0_EFFECT_RECORD, record);
  }
  for (const snd of patch.sounds ?? []) {
    const bank = snd.bank.toLowerCase();
    const key = snd.kind === "chunk" ? `${bank}|chunk` : `${bank}|sound|${snd.name.toLowerCase()}`;
    // a bank the base never had open has no records to carry it
    for (const rec of records.get(key) ?? []) {
      put16(rec.data, rec.at + SOUND_VOLUME, snd.volume);
      if (snd.kind === "chunk") continue;
      put16(rec.data, rec.at + SOUND_PAN, snd.pan);
      put16(rec.data, rec.at + SOUND_LOOP, snd.loop ? 1 : 0);
    }
  }
}

/** the props' and the cast's records, in place */
function patchPropsAndCastV1(base: RawSaveFile, out: RawSaveFile, index: V1Index, patch: SavePatchV1, drop: NonNullable<SavePatchV1["onDrop"]>): void {
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
      if (p.step !== undefined) put16(cp, o + PROP_STEP, p.step);
      if (p.speed !== undefined) put16(cp, o + PROP_SPEED, p.speed);
      if (p.value !== undefined) put32(cp, o + PROP_VALUE, p.value);
      if (p.zclip !== undefined) put16(cp, o + PROP_ZCLIP, p.zclip);
      if (p.tileX !== undefined) put16(cp, o + PROP_TILE_X, p.tileX);
      if (p.tileY !== undefined) put16(cp, o + PROP_TILE_Y, p.tileY);
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
      if (a.anchorX !== undefined) put16(ca, o + ACTOR_ANCHOR_X, a.anchorX);
      if (a.anchorY !== undefined) put16(ca, o + ACTOR_ANCHOR_Y, a.anchorY);
      if (a.step !== undefined) put16(ca, o + ACTOR_STEP, a.step);
      if (a.dist !== undefined) put16(ca, o + ACTOR_DIST, a.dist);
      if (a.value !== undefined) put32(ca, o + ACTOR_VALUE, a.value);
      if (a.zclip !== undefined) put16(ca, o + ACTOR_ZCLIP, a.zclip);
      if (a.hitbox !== undefined) {
        put16(ca, o + ACTOR_HITBOX_RZ, a.hitbox[0]);
        put16(ca, o + ACTOR_HITBOX_RXY, a.hitbox[1]);
      }
      if (a.tileX !== undefined) put16(ca, o + ACTOR_TILE_X, a.tileX);
      if (a.tileY !== undefined) put16(ca, o + ACTOR_TILE_Y, a.tileY);
    }
  }
}

/** the loop table */
function patchLoopsV1(base: RawSaveFile, out: RawSaveFile, index: V1Index, patch: SavePatchV1, drop: NonNullable<SavePatchV1["onDrop"]>): void {
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
      put16(cl, at + LOOP_PAUSE, l.paused ? Math.max(1, l.pauseDepth ?? 1) : 0);
      put16(cl, at + LOOP_KIND, kind);
      put32(cl, at + LOOP_PERIOD, l.period);
      writePstrField(cl, at + LOOP_NAME, l.name);
      writePstrField(cl, at + LOOP_HANDLER, l.handler);
      slot++;
    }
  }
}

/** the balls */
function patchBallsV1(base: RawSaveFile, out: RawSaveFile, index: V1Index, patch: SavePatchV1, drop: NonNullable<SavePatchV1["onDrop"]>): void {
  // ---- the balls ---------------------------------------------------------
  const cp = out.containers[4]?.data;
  // Positional, like the table it is: a ball's slot is the one it was made in.
  const cbl = out.containers[index.crickets]?.data;
  if (cbl && patch.balls) {
    cbl.fill(0, 0, Math.min(cbl.length, BALL_COUNT * BALL_STRIDE));
    const props = cp ? byName(cp, PROP_STRIDE, PROP_NAME) : new Map<string, number>();
    for (const b of patch.balls) {
      const at = b.slot * BALL_STRIDE;
      if (b.slot < 0 || b.slot >= BALL_COUNT || at + BALL_STRIDE > cbl.length) {
        drop(b.name, `ball slot ${b.slot} is not in the table`);
        continue;
      }
      const words = [1, b.pause, b.vx, b.vy, b.vz, b.gravity, b.bounce, b.frames, b.deg, b.x, b.y, b.z, b.tx, b.ty];
      words.forEach((v, k) => put16(cbl, at + 2 * k, v));
      const prop = props.get(b.name.toLowerCase());
      put32(cbl, at + BALL_PROP_SLOT, prop === undefined ? 0 : prop / PROP_STRIDE);
      writePstrField(cbl, at + BALL_NAME, b.name);
    }
  }
}

/** the walks, each route's waypoints re-emitted after the table */
function patchWalksV1(base: RawSaveFile, out: RawSaveFile, index: V1Index, patch: SavePatchV1, drop: NonNullable<SavePatchV1["onDrop"]>): void {
  // ---- the walks ---------------------------------------------------------
  const ca = out.containers[2]?.data;
  // The same wholesale rewrite the loops get, and for the same reason: the table
  // IS the live mover, so a slot the running game does not have is a walker who
  // must not set off again on load. A walk on an authored route takes its
  // waypoints with it, as a container after the table — one per declaring slot,
  // in slot order, which is how the loader reads them back.
  const cw = out.containers[index.walks]?.data;
  if (cw && patch.walks) {
    cw.fill(0, 0, Math.min(cw.length, WALK_COUNT * WALK_STRIDE));
    const cast = ca ? byName(ca, ACTOR_STRIDE, ACTOR_NAME) : new Map<string, number>();
    const payloads: Uint8Array[] = [];
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
      put16(cw, at + WALK_PAUSE, w.paused ? Math.max(1, w.pauseDepth ?? 1) : 0);
      put16(cw, at + WALK_TURN_TO, w.turnTo);
      put16(cw, at + WALK_TURN_ONLY, w.turnOnly ? 1 : 0);
      // start minus destination: the record's sign, not the port's
      dv.setInt32(at + WALK_DX, -w.dx, true);
      dv.setInt32(at + WALK_DY, -w.dy, true);
      dv.setInt32(at + WALK_DZ, -w.dz, true);
      dv.setInt32(at + WALK_DIST, w.dist, true);
      put16(cw, at + WALK_DEG, w.deg);
      put16(cw, at + WALK_START_X, w.startX);
      put16(cw, at + WALK_START_Y, w.startY);
      put16(cw, at + WALK_START_Z, w.startZ);
      put16(cw, at + WALK_START_TILE_X, w.startX >> 8);
      put16(cw, at + WALK_START_TILE_Y, w.startY >> 8);
      // ...and how far it has COME
      dv.setInt32(at + WALK_COVERED, Math.max(0, w.progress), true);
      put16(cw, at + WALK_MOVER, w.waiting ? 0 : 1);
      const castAt = cast.get(w.actor.toLowerCase());
      dv.setUint32(at + WALK_CAST_SLOT, castAt === undefined ? 0 : castAt / ACTOR_STRIDE, true);
      writePstrField(cw, at + WALK_ACTOR, w.actor);
      writePstrField(cw, at + WALK_STAR, w.star);
      if (w.path?.length) {
        // any non-zero handle declares the payload; the loader allocates its own
        dv.setUint32(at + WALK_PAYLOAD, 0x10000 + slot, true);
        payloads.push(writePayload(w.path));
      } else {
        dv.setUint32(at + WALK_PAYLOAD, 0, true);
        if (w.hasPath) drop(w.actor, "walking an authored route with no points — written as the straight line");
      }
      slot++;
    }
    // the base's payloads go with the table that named them; ours follow it
    out.containers.length = index.walks + 1;
    for (const data of payloads) out.containers.push({ id: out.containers.length, data });
  }
}

/** the title a save written by this port carries — Dust's own, as its menu
 *  spells it (`NEW.FLT`'s save button passes exactly this) */
export const DUST_SAVE_TITLE = "dust 0.3";

/** a one-line description of a save, for a log or a list */
export function describeSaveV1(save: SaveGameV1): string {
  const s = save.standpoint;
  const day = save.numGlobals.get("day");
  const cash = save.numGlobals.get("playercash");
  const setFile = s.setFile || s.set + ".set";
  return (
    `${save.title} · ${setFile} (${s.cellX},${s.cellZ}) facing ${s.view || s.facing}` +
    ` · frame ${save.frame} · day ${day ?? "?"} · $${cash ?? "?"}` +
    ` · ${save.actors.length} cast, ${save.props.length} props, ${save.loops.length} loops` +
    (save.puppet ? ` · ${save.puppet} open` : "")
  );
}
