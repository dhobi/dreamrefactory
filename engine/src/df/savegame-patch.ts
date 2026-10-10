/**
 * Writing a Titanic `.ti` save: `applyPatch` carries the live game state
 * (a `SavePatch`) into a copy of a base save, record by record, and
 * `globalsCapacity` says how many globals a base could hold if patched.
 */
import { Container } from "./container";
import {
  DFVALUE_BOOLEAN,
  DFVALUE_NUMBER_WRITTEN,
  DFVALUE_STRING,
  NODE_TYPE,
  NODE_VALUE,
  freeVarSlots,
  newVarRecord,
  poolIntern,
  pstrField,
  recordOffsets,
  writePstrField,
} from "./save-vars";
import { readSaveFile, writeSaveFile, saveIndex } from "./savegame";
import type {
  RawSaveFile,
  SaveGame,
  SaveIndex,
  SavedActorPatch,
  SavedCricket,
  SavedLoop,
  SavedPropPatch,
  SavedWalk,
  ThemePatch,
} from "./savegame";
import { isPropName, manifestFiles, walkActorGrid, walkPropGrid } from "./savegame-read";
import {
  PROP_SET_OFF,
  PROP_STAR_OFF,
  PROP_VIEW_OFF,
  PROP_OWNER_OFF,
  PROP_FIELDS,
  ACTOR_STRIDE,
  ACTOR_RECORD_OFF,
  ACTOR_OWNER_OFF,
  ACTOR_VALUE_OFF,
  ACTOR_PLACEMENT,
  ACTOR_SET_OFF,
  ACTOR_STAR_OFF,
  ACTOR_POSE_OFF,
  C1_SET,
  C1_SCENE,
  C1_VIEW,
  C1_FRAME,
  C0_FILE_COUNT,
  C0_FILE_RECORDS,
  C0_FILE_STRIDE,
  LOOP_KINDS,
  CAST_STRIDE,
  CAST_NAME,
  LOOPS_SIZE,
  CRICKETS_SIZE,
  WALKS_SIZE,
  WALK_SLOT,
  TRACK_STRIDE,
  TRACK_NAME_OFF,
  TRACK_COUNTS,
  SOUND_STRIDE,
} from "./savegame-layout";

/** record +2: the old handle of the cast FILE the member comes from, resolved
 *  through the manifest on load (0x414b9c → 0x415370) — gang.cst's or
 *  extra.cst's in every one of the shipped corpus's records */
const ACTOR_CAST_OFF = 2;
/** a world coordinate as the record's i16, clamped rather than wrapped */
function clampI16(n: number): number {
  return Math.max(-32768, Math.min(32767, Math.trunc(n) || 0));
}

/** container 1 also carries the open SET FILE's identity and shape, and the
 *  original's loader restores the room from these three, not from the set
 *  name: @544 is the set file's old heap handle, which the loader (0x41514a)
 *  resolves through the container-0 manifest — the record whose first dword
 *  matches yields the PATH that names the file to treat as the open set — and
 *  @644/@652 are the set's actor/main-scene register container refs, which it
 *  reads from that file to look up the saved scene and view names (0x43a0b0;
 *  a scene the register lacks is the DosBox fatal at line 4248). Verified
 *  against all 109 shipped saves: @544 matches exactly one manifest record,
 *  its path names a set file holding the saved scene, and @644/@652 equal
 *  that file's own register refs. */
const C1_SETFILE_ID = 544;
const C1_ACTOR_REGISTER = 644;
const C1_SCENE_REGISTER = 652;
/** the scene register's RECORD COUNT — restored verbatim, never recomputed:
 *  the scene lookup walks exactly this many 42-byte records of the register
 *  it just re-read (0x409e50 bounds itself by the global at 0x489fd0 = c1
 *  @656). Equal to the open set's scene count in all 109 shipped saves; a
 *  base from a smaller set leaves later scenes unreachable — the second way
 *  a cross-room save died at line 4248. */
const C1_SCENE_COUNT = 656;
/** container 0 also carries the live CLUT: 256 × {i16 index, i16 rgb[3]} at
 *  +0xb0c, which the loader copies straight into the palette global and
 *  applies (0x414aa8..0x414b07) — the room comes back in whatever colours
 *  this table holds, so a cross-room patch must bring the new set's palette
 *  with it or the old room's stays on screen until the next set change.
 *  Measured: the lower 128 entries equal the open set's own palette table
 *  (SET c0+0xf2) at 1018/1024 bytes in the cargo base — the set owns 0..127
 *  and the stage 128..255, so only the lower half is the set's to replace. */
const C0_CLUT = 0xb0c;
const C0_CLUT_SET_HALF = 128 * 8;
/** container 0 @256: the CD VOLUME this game was saved on, as a pstr — the very
 *  label `setpath` mounts it by (`currentcd("Titanic2")`), and what the original's
 *  loader restores the resource path table from. See {@link SavePatch.disk}. */
const C0_DISK = 256;

/**
 * What a walk slot's `+0x12` gets when it has a waypoint payload.
 *
 * The shipped values are DOS heap addresses TI.EXE allocated (0xa6b4b0,
 * 0xa6c1f0, 0xa6d820 — one per shipped route), and they are not a pointer this
 * writer has to forge: the loader at 0x4149bd reads the NEXT container and
 * stores the new handle straight back over this word, so the field is a flag
 * that says "I have one" and the container ORDER is what matches payloads to
 * slots. This is one of the real ones, kept so a save we write is shaped like a
 * save TI.EXE wrote.
 */
const WALK_PATH_HANDLE = 0xa6b4b0;

/**
 * Build one type-3 walk's waypoint payload —
 * {@link import("./savegame-read").decodeWalkPath} backwards.
 *
 * The container is written at its exact size (20 + 8n): the shipped ones are
 * raw allocations and two of the three are exactly that, the third trailing a
 * row of slack, and the count is what bounds the read in either engine.
 *
 * The block is the SAME structure as the set file's authored path (see
 * `readStarPath` in engine/src/df/set.ts) — the runtime copy `walkonpath` makes of it,
 * points snapped to the live stars, reversed when the walker starts from the
 * `b` end, leg lengths and total recomputed to match. So the two header fields
 * past the count are the authored container's: `+4` is 0 in every authored path
 * and every shipped payload, and **`+12..+19` is the path's bounding box** —
 * (Zmin, Xmin, Zmax, Xmax) in the set file's axis naming, which in this
 * decoder's terms is (min y, min x, max y, max x). TI.EXE copies the box
 * verbatim and never updates it when it snaps or reverses the points, which is
 * why the shipped boxes fit their AUTHORED polylines exactly (checked against
 * `ga.1→ga.2` and `hack1→hack2` in the set files, byte-identical at +12) and
 * miss the runtime ones by the width of the snap.
 *
 * This writer computes the box over the points it is writing — exact where the
 * original's is stale. Nothing reads it on a resume: the mover's position
 * function (0x444d70, the payload's only reader once a walk is in flight) reads
 * the total, the count and the points, never +4 or the box; the box serves the
 * path LOOKUP at `walkonpath` start, which queries the set's own registry and
 * never a save's payload. Written right anyway, because now it can be.
 */
function encodeWalkPath(path: NonNullable<SavedWalk["path"]>): Uint8Array {
  const d = new Uint8Array(20 + path.length * 8);
  const dv = new DataView(d.buffer);
  dv.setUint32(8, path.length, true);
  dv.setInt16(12, clampI16(Math.min(...path.map((p) => p.y))), true);
  dv.setInt16(14, clampI16(Math.min(...path.map((p) => p.x))), true);
  dv.setInt16(16, clampI16(Math.max(...path.map((p) => p.y))), true);
  dv.setInt16(18, clampI16(Math.max(...path.map((p) => p.x))), true);
  let prev = 0;
  let total = 0;
  for (const [i, p] of path.entries()) {
    const o = 20 + i * 8;
    dv.setInt16(o, clampI16(p.x), true);
    dv.setInt16(o + 2, clampI16(p.y), true);
    dv.setInt16(o + 4, clampI16(p.z), true);
    // each point stores its distance from the one BEFORE it (the first's is 0)
    const leg = Math.min(0xffff, Math.max(0, (p.cum - prev) | 0));
    dv.setUint16(o + 6, leg, true);
    prev = p.cum;
    total += leg;
  }
  // the total is the SUM OF THE LEGS AS WRITTEN, not the last cum as given:
  // decodeWalkPath (and, one has to assume, the original's own pacing) holds the
  // header to the legs' running sum, so a clamp that fired above must land in
  // the total too or the payload comes back unreadable from our own file
  dv.setUint32(0, total, true);
  return d;
}

/**
 * The live game state to write into a save. Byte-compatibility is only provable
 * by exact round-trip (the original binary is not run), so writing works by
 * patching a *base* save — a real `.ti` (the one that was loaded, or a per-disk
 * template) — with the current progress, then re-emitting. Everything the loader
 * ignores (pointer/padding bytes) comes from the base unchanged; the meaningful
 * fields we understand (globals, set/scene/view) are overwritten in place.
 */
export interface SavePatch {
  /** numeric globals to write into the globals-container records, by name. */
  numGlobals: Map<string, number>;
  /** string globals to write, by name. Each value must already exist in the
   * base save's string pool (they're stored as pool offsets and the pool's
   * allocator watermark lives in engine state we don't rewrite); a value not
   * found in the pool leaves that variable's base value untouched. In practice
   * the strings our engine persists (sides, decks, keys, "", stage names) are
   * present in every shipped pool. */
  strGlobals?: Map<string, string>;
  set: string;
  scene: string;
  view: string;
  /**
   * The CD volume in play, by the label `setpath` mounts it under
   * ({@link SaveGame.disk}, container 0 @256). Omitted leaves the base's.
   *
   * A save is written by patching a skeleton — a shipped save, or the last one
   * loaded — and left alone, this field would make a save inherit whichever disc
   * that skeleton came off. It is not decoration: it
   * says which CD the save's rooms are to be read from, to the original engine
   * (which asks for that disc by name) and to this port (whose load mounts it —
   * see mountSavedDisc). 93 basenames ship on both, 70 of them differing byte for
   * byte, so a mislabelled save opens the wrong act's rooms. The reachable way to
   * write one is to load a mission-3 save and play on into mission 4: the story
   * crosses back to disc 1 there and the skeleton still says disc 2.
   *
   * Written into the field the base already has and never past it — every label
   * in the corpus is the same eight characters, and what follows the pstr in
   * container 0 is process junk this port does not otherwise disturb.
   */
  disk?: string;
  /** the engine's displayed-frame counter (C1 @442). Written on the same scale
   * as the frame stamps in {@link numGlobals}, because the game subtracts one
   * from the other; omitted leaves the base's. */
  frame?: number;
  /**
   * The current set FILE and its register container refs — required for a save
   * taken in a DIFFERENT room than the base. TI.EXE's loader ignores the set
   * NAME at C1 @596 when it re-opens the room: it resolves the set file id at
   * C1 @544 through the container-0 manifest to a PATH, opens that file, and
   * looks the saved scene/view up in the registers named by C1 @644/@652.
   * A base from another room therefore re-opens the base's set, and the saved
   * scene misses its register — TI.EXE dies with "Fatal error at line 4248
   * (code 2)". Writing this re-paths the manifest record the set id resolves
   * to (the id itself is left alone, so every other record still matches) and
   * writes the current set's register refs. Omitted, the base's values stand —
   * only safe when the base save is from the same set file.
   */
  setFile?: {
    file: string;
    actorRegister: number;
    sceneRegister: number;
    sceneCount: number;
    /** the set's raw 2048-byte palette table (SET c0+0xf2). Its lower 128
     *  entries are written into the manifest's CLUT at +0xb0c — the loader
     *  restores the screen palette from there, and without this a cross-room
     *  save comes back in the base room's colours (the set owns entries
     *  0..127; the stage's 128..255 keep the base's bytes). */
    clut?: Uint8Array;
  };
  /**
   * Current prop state to write into the inventory container, by prop name.
   * Captures the player's collected items (each prop's owner, and its view where
   * the caller has one) — without it, a save would keep the base save's stale
   * inventory. A prop with no record in the base is skipped, not appended.
   */
  inventory?: SavedPropPatch[];
  /**
   * The cast, written into the actor container.
   *
   * `owner` and `value` are the characters' memory of the player, and without them
   * a save keeps the base template's — every character back at "none", their
   * errands forgotten. `placement` is optional because a caller may have nothing
   * to say about where anybody is standing (a test patching one owner); when it is
   * given, the whole placement half of the record is written, which is what lets a
   * load put the cast back instead of re-deriving it from each room (#86).
   */
  actors?: SavedActorPatch[];
  /**
   * The live scheduler, written over the base's three service tables (they are
   * fixed-size — 32×42 / 16×74 / 16×110 — so writing them never changes a
   * container's length).
   *
   * `walks` is the one table that can grow the FILE, because a `walkonpath`
   * keeps its waypoints in a payload container of its own (see
   * {@link SavedWalk} and docs/engine/formats/savegame.md). Each type-3 slot appends
   * one, in SLOT ORDER, and the slot's `+0x12` is set non-zero to say it has
   * one — the loader (0x4149bd) reads the next container and stores the new
   * handle back over the old, so the value is a flag and the ORDER is what
   * carries the meaning. The base's own payloads are ALWAYS dropped, walks
   * passed or not: they belong to the base's moment, and leaving them would
   * hand a new save's slot the previous one's route. Measured over the corpus,
   * the walks table is the last container in all 109 shipped saves except the
   * 3 that carry a payload, so this only ever appends past the end.
   *
   * Omitted (`walks` undefined) or empty, the table is ZEROED — the two spell
   * the same thing and write the same bytes: no walk is in flight.
   */
  scheduler?: { loops: SavedLoop[]; crickets: SavedCricket[]; walks?: SavedWalk[] };
  /**
   * The playing theme with its bank's loop table, or null for a room scored
   * silent. Written by emptying every track's playing/looping arrays (their
   * descriptor counts and container lengths together, so they stay consistent)
   * and then writing the named track's lists the way TI.EXE's own writer does —
   * IF that track is on the open-bank list ({@link banks}, or the base's when
   * that is omitted); a theme whose bank is not open is reported through
   * {@link onDrop}.
   *
   * The lists are NOT free-form, and an invented record is a crash in the
   * original engine, not a quieter room. TI.EXE's post-load resume (0x414a70,
   * called by `opengame` after the restore) pairs playing record *n* with the
   * BANK's loop-table record *n* — the save record contributes only volume and
   * pan — and then rebuilds the looping list by copying `playing[order[n]-1]`
   * for every entry of the bank's play order, bounded by the bank's chunk
   * count, not by the save's. A playing list shorter than the bank's tables is
   * therefore an out-of-bounds read AND write on 104-byte-per-record heap
   * blocks; the smashed heap surfaces as the DreamFactory fatal "Memory error
   * at line 301 (code 2): Unknown compression format" (the codec lookup at
   * 0x401539 reading a clobbered sound header). Measured against all 109
   * shipped saves (111 live tracks, 2583 records, zero exceptions): playing =
   * one record per loop-table record in table order, looping = one per
   * play-order entry, `index` = the chunk's container location, +2 = 0,
   * pan = 128, name = the chunk identifier verbatim.
   */
  theme?: ThemePatch | null;
  /**
   * The cast files open now, in the order they were opened — written as the
   * open-cast list (container 3). Omitted, the base's list stands.
   *
   * The list is the live engine table at 0x489f0c, dumped as it is by the
   * writer (0x413910), and a load reopens what it names (0x414b32): the crowd
   * is instanced from `extra.cst`, which three rooms open from their `openset`
   * and which a load, running no `openset`, gets only from here. Copying the
   * base's list would make a save name whatever its SKELETON had open (#486: a
   * London-flat template, so a smoking-room save during the sinking would reload
   * without its crowd). See {@link openFilesPatch}.
   */
  casts?: string[];
  /**
   * The audio banks open now — written as the open-tracks list (container 6)
   * and its three arrays per bank. Omitted, the base's list stands.
   *
   * The live table at 0x489f24, reopened by a load (0x414cf2) whether a bank is
   * sounding or not: the sinking's `insddest.sfx` is a silent bank a restored
   * loop plays out of (#199). A bank the base also had keeps its record and
   * arrays; a new one gets an empty record. {@link theme} is then written into
   * this list, so a theme the base never had open is not dropped.
   */
  banks?: string[];
  /**
   * Told about any global that could not be written, and why.
   *
   * A base save has a finite number of free variable slots and a finite string
   * pool, and neither is grown (see {@link newVarRecord}), so a patch can leave
   * something out. Saying so is the difference between a known limit and state
   * that vanishes quietly — which is how `zeitclue` cost a mission.
   */
  onDrop?(name: string, why: string): void;
}

/**
 * How many distinct globals a base save could carry if it were patched: the
 * variables it already has a record for, plus the records that could still be
 * made in the free tail of its node array.
 *
 * This is what makes one `.ti` a better structural template than another, and the
 * spread across the shipped 109 is wide enough to decide a mission. Every save
 * holds the variable list that existed when it was TAKEN, so an early save simply
 * has no record for a later global — and the earliest are the ones a fresh
 * playthrough was being handed. Against the 163 globals the shipped corpus knows
 * between them:
 *
 *     1/01 - April 14th, 1942         96 records   holds  99   drops 64
 *     1/25 - In Squash Court         121 records   holds 119   drops 44
 *     ENDGAME2/01 - Found Notebook   126 records   holds 139   drops 24
 *
 * and `1/01` — the first file in `save/1`, which is what the template picker used
 * to take — is the worst of the 109. What it dropped was not bookkeeping: the
 * whole turbine puzzle (`boiler`, `turbine`, `condensor`, `steamtank`, the four
 * pressures), the smokestack maze (`mazenumber`, `stacklevel`), the darkroom's
 * plates (`picone`…`badthree`), `stokerphase`, `troutmoney`, `turkwater`,
 * `fencelevel`, `stackmax`. See {@link SaveEntry} ranking in save-seed.ts.
 *
 * Answered by counting, not by making the records on a copy — ranking 109 saves
 * costs 15 ms that way and 200 ms the other, which is real time on a page load.
 * What keeps the count honest is {@link freeVarSlots} applying the same rule
 * `newVarRecord` does, and the suite asserting the two agree on all 109.
 */
export function globalsCapacity(bytes: Uint8Array | RawSaveFile): { records: number; free: number } {
  let d: Uint8Array;
  try {
    const raw = bytes instanceof Uint8Array ? readSaveFile(bytes) : bytes;
    d = raw.containers[saveIndex(raw).globals].data;
  } catch {
    // a file that is not a save, or not shaped like one — the ranker asks this of
    // whatever it is handed, so "no capacity" is the answer rather than a throw
    return { records: 0, free: 0 };
  }
  return { records: recordOffsets(d).size, free: freeVarSlots(d) };
}

/**
 * Which globals get the base save's free variable slots, when there are fewer
 * slots than names wanting one.
 *
 * The order is by what a load cannot recover any other way. `savedeck` and
 * `hallside` are first because they decide where you come back standing: the
 * staircase's deck plan and which side of a hallway you face, and `halla`'s
 * keydown guard `error()`s on a missing side and swallows every key. Then the
 * sub-plot flags, which are story state no room script re-derives. Everything
 * else takes what is left in the order the engine holds it, and whatever does not
 * fit is reported rather than dropped quietly (see {@link applyPatch}'s `onDrop`).
 */
const NEW_RECORD_PRIORITY = ["savedeck", "hallside", "handitem", "pennybrush", "handflag"];

/**
 * The manifest handle that opens `file`, adding a record for it when the base
 * has none.
 *
 * Every record of the open-cast and open-bank lists, and every actor record's
 * cast reference, leads with an OLD HANDLE that the loader resolves through the
 * manifest — a handle the manifest does not hold is TI.EXE's fatal 0x1127. The
 * manifest is the open-file list (`0x413910` walks it from the file chain), so a
 * file open now and not in the base belongs in it. The new record's handle only
 * has to be one no other record has, since it is matched by equality; its path
 * borrows the directory of a record with the same extension (only the basename
 * is read, see SavePatch.setFile). Container 0 is `0x1310 + n × 0x104` bytes in
 * every shipped save, so the record goes on the end and the count moves with it.
 */
function manifestHandle(containers: Container[], file: string): number {
  const want = file.toLowerCase();
  const files = manifestFiles(containers[0].data);
  const have = files.find((f) => f.file === want);
  if (have) return have.handle;
  const ext = want.slice(want.lastIndexOf("."));
  const like = files.find((f) => f.file.endsWith(ext) && f.path.includes(":"))
    ?? files.find((f) => f.path.includes(":"));
  const path = (like ? like.path.slice(0, like.path.lastIndexOf(":") + 1) : "") + want;
  const handle = (files.reduce((m, f) => Math.max(m, f.handle), 0) + 0x10) >>> 0;
  const c0 = containers[0].data;
  const at = C0_FILE_RECORDS + files.length * C0_FILE_STRIDE;
  const grown = new Uint8Array(at + C0_FILE_STRIDE);
  grown.set(c0.subarray(0, Math.min(c0.length, at)), 0);
  const dv = new DataView(grown.buffer);
  dv.setUint32(at, handle, true);
  writePstrField(grown, at + 4, path, 255);
  dv.setInt32(C0_FILE_COUNT, files.length + 1, true);
  containers[0].data = grown;
  return handle;
}

/** the open-cast record's u32 at +8 — 1 in all 156 records of the shipped corpus */
const CAST_FLAG = 8;
/** the longest name an open-cast record's field holds (28 − 12, less the length byte) */
const CAST_NAME_MAX = CAST_STRIDE - CAST_NAME - 1;
/** the longest name an open-bank descriptor's field holds (40 − 0x16, less the length byte) */
const TRACK_NAME_MAX = TRACK_STRIDE - TRACK_NAME_OFF - 1;

/**
 * Write the open-cast list (container 3) and the open-bank list (container 6 and
 * the three arrays per bank after it) from the session's, before anything else in
 * {@link applyPatch} reads the map — the bank count places every container after
 * them, so this is the one step that moves the index.
 *
 * TI.EXE's writer (0x413910) dumps both tables verbatim (handles 0x489f0c and
 * 0x489f24), and its resume (0x414a70) walks them record by record: each cast
 * record's handle at +0 is reopened through the manifest ("ODCC", 0x414b32) and
 * its directory re-read into +4; each bank descriptor's handle at +0 likewise
 * ("GNOS", 0x414cf2), and then its three arrays are re-read from the containers
 * that follow. So a record is its handle, its name, and — for a bank — its
 * counts: everything else in it is pointers the loader overwrites.
 *
 * A file the base also had keeps the base's record (and a bank its three arrays,
 * whose playing/looping halves the theme step rewrites anyway). A new file gets a
 * fresh record shaped like the corpus's — handle, +8 = 1 for a cast, counts 0 for
 * a bank — and a manifest record if the base had none for it.
 */
function openFilesPatch(containers: Container[], index: SaveIndex, patch: SavePatch): void {
  if (patch.casts) {
    const d = containers[index.casts].data;
    const base = new Map<string, Uint8Array>();
    for (let o = 0; o + CAST_STRIDE <= d.length; o += CAST_STRIDE) {
      const name = pstrField(d, o + CAST_NAME).toLowerCase();
      if (name && !base.has(name)) base.set(name, d.slice(o, o + CAST_STRIDE));
    }
    const recs: Uint8Array[] = [];
    for (const cast of patch.casts) {
      const name = cast.toLowerCase();
      if (name.length > CAST_NAME_MAX) {
        patch.onDrop?.(`cast(${name})`, `the name is longer than the record's ${CAST_NAME_MAX} characters`);
        continue;
      }
      const rec = base.get(name) ?? new Uint8Array(CAST_STRIDE);
      const dv = new DataView(rec.buffer, rec.byteOffset, rec.byteLength);
      dv.setUint32(0, manifestHandle(containers, name), true);
      if (!base.has(name)) {
        dv.setUint32(CAST_FLAG, 1, true);
        writePstrField(rec, CAST_NAME, name, CAST_NAME_MAX);
      }
      recs.push(rec);
    }
    const out = new Uint8Array(recs.length * CAST_STRIDE);
    recs.forEach((r, k) => out.set(r, k * CAST_STRIDE));
    containers[index.casts].data = out;
  }

  if (patch.banks) {
    const ti = index.tracks;
    const d = containers[ti].data;
    const base = new Map<string, { rec: Uint8Array; arrays: Uint8Array[] }>();
    for (let k = 0; k < index.trackCount; k++) {
      const name = pstrField(d, k * TRACK_STRIDE + TRACK_NAME_OFF).toLowerCase();
      if (!name || base.has(name)) continue;
      base.set(name, {
        rec: d.slice(k * TRACK_STRIDE, (k + 1) * TRACK_STRIDE),
        arrays: [0, 1, 2].map((j) => containers[ti + 1 + 3 * k + j].data),
      });
    }
    const recs: Uint8Array[] = [];
    const arrays: Uint8Array[] = [];
    for (const bank of patch.banks) {
      const name = bank.toLowerCase();
      if (name.length > TRACK_NAME_MAX) {
        patch.onDrop?.(`bank(${name})`, `the name is longer than the record's ${TRACK_NAME_MAX} characters`);
        continue;
      }
      const had = base.get(name);
      const rec = had?.rec ?? new Uint8Array(TRACK_STRIDE);
      if (!had) writePstrField(rec, TRACK_NAME_OFF, name, TRACK_NAME_MAX);
      new DataView(rec.buffer, rec.byteOffset, rec.byteLength).setUint32(0, manifestHandle(containers, name), true);
      recs.push(rec);
      // counts and arrays travel together, which is what saveIndex validates
      arrays.push(...(had?.arrays ?? [0, 1, 2].map(() => new Uint8Array(0))));
    }
    const list = new Uint8Array(recs.length * TRACK_STRIDE);
    recs.forEach((r, k) => list.set(r, k * TRACK_STRIDE));
    containers[ti].data = list;
    containers.splice(ti + 1, 3 * index.trackCount, ...arrays.map((data) => ({ id: 0, data })));
    // a container's id is its place in the file (the walks step appends the same way)
    containers.forEach((c, i) => (c.id = i));
  }
}

/**
 * Produce the bytes of a save that carries `patch`'s progress, using `base` as
 * the structural template. The base's containers are copied; the globals-
 * container values and container 1's set/scene/view are overwritten in place.
 */
export function applyPatch(base: RawSaveFile, patch: SavePatch): Uint8Array {
  // deep-copy so we can mutate container data without touching the base.
  const containers: Container[] = base.containers.map((c) => ({ id: c.id, data: c.data.slice() }));
  const raw: RawSaveFile = { header: base.header.slice(), table: base.table.slice(), containers };
  /**
   * Read once the open-file lists are written ({@link openFilesPatch}, the one
   * step that moves the map), and valid for the rest of the patch — which is a
   * property of the map rather than luck. Nothing after it changes container 6
   * or the count of containers before the walks table; the scheduler block truncates the tail to
   * re-emit the waypoint payloads, and every index it and the theme block use
   * sits at or before that cut.
   */
  openFilesPatch(containers, saveIndex(raw), patch);
  const index = saveIndex(raw);

  // globals: overwrite each variable's DFValue (type at slot+24, value at
  // slot+26 — the slot recordOffsets maps to already accounts for the
  // name/value node pairing). Numbers are written inline and tagged type 4;
  // strings are written as a pool offset (type 3) when the value exists in the
  // base's string pool — see {@link SavePatch.strGlobals}.
  const gi = index.globals;
  // fetched per write: appending a record can REPLACE the container's array
  // (it grows), so a DataView taken once would end up writing into the old one
  const view = (): DataView => {
    const d = containers[gi].data;
    return new DataView(d.buffer, d.byteOffset, d.byteLength);
  };
  const writeVar = (name: string, off: number): boolean => {
    const num = patch.numGlobals.get(name);
    if (num !== undefined) {
      const dv = view();
      // 32 bits, the node's full value field — see decodeVars. A word here
      // would clamp `paintframe`/`secframe`/`lastsail` to 32767 the moment a
      // session runs past 27 minutes, which is where every frame stamp in a
      // real playthrough lives (#221).
      const v = Math.max(-0x80000000, Math.min(0x7fffffff, num | 0));
      // Type 2 is BOOLEAN, not a second number tag, and TI.EXE's commands
      // check: propvisible's argument fetch is `cmp word [esp], 2` and a 4
      // there is the DosBox scripting error "Bad argument type." (found by
      // bisecting a port save down to exactly ten 02->04 tag bytes). The
      // port's interpreter carries booleans as 0/1 numbers, so the
      // boolean-ness survives only in the base record's tag: a tag-2 record
      // stays tag 2 while the value is still boolean-shaped, and a real
      // number retypes it, the way an assignment in the original would.
      const keepBool = dv.getUint16(off + NODE_TYPE, true) === DFVALUE_BOOLEAN && (v === 0 || v === 1);
      dv.setInt32(off + NODE_VALUE, v, true);
      if (!keepBool) dv.setUint16(off + NODE_TYPE, DFVALUE_NUMBER_WRITTEN, true);
      return true;
    }
    const str = patch.strGlobals?.get(name);
    if (str === undefined || !containers[gi + 1]) return false;
    const p = poolIntern(containers[gi].data, containers[gi + 1], str);
    if (p < 0) return false;
    const dv = view();
    // the whole field, so a node that held a wide number (a frame
    // stamp) doesn't keep its high word behind the new pool offset — a
    // string's high word is 0 in all 3380 shipped string records
    dv.setUint32(off + NODE_VALUE, p, true);
    dv.setUint16(off + NODE_TYPE, DFVALUE_STRING, true);
    return true;
  };
  const offs = recordOffsets(containers[gi].data);
  // A record the patch was not asked about is not a loss: the base keeps its own
  // value, which is the whole design. Reporting one as dropped was noise that
  // grew with the base — a session holding 100 globals patched onto a 126-record
  // save would have complained about the other 26, and with the wrong reason
  // ("no pool room"). Only a global we were given and could not store is news.
  const asked = (name: string) => patch.numGlobals.has(name) || !!patch.strGlobals?.has(name);
  for (const [name, off] of offs) {
    if (!asked(name)) continue;
    if (!writeVar(name, off)) patch.onDrop?.(name, "no pool room");
  }
  // and the globals the base has no record for at all — a save from before the
  // engine had ever assigned them. Making the record is what stops `savedeck`
  // and `hallside` being dropped; the base's free slots are finite, so the ones
  // a load cannot do without go first (see {@link NEW_RECORD_PRIORITY}).
  const wanted = [...patch.numGlobals.keys(), ...(patch.strGlobals?.keys() ?? [])].filter(
    (n) => !offs.has(n),
  );
  wanted.sort((a, b) => {
    const ra = NEW_RECORD_PRIORITY.indexOf(a);
    const rb = NEW_RECORD_PRIORITY.indexOf(b);
    return (ra < 0 ? NEW_RECORD_PRIORITY.length : ra) - (rb < 0 ? NEW_RECORD_PRIORITY.length : rb);
  });
  for (const name of wanted) {
    const slot = newVarRecord(containers[gi], name);
    if (slot < 0) {
      patch.onDrop?.(name, "the base save has no record and no free slot for it");
      continue;
    }
    offs.set(name, slot);
    if (!writeVar(name, slot)) patch.onDrop?.(name, "no pool room");
  }

  // container 1: set/scene/view live in 16-byte fields at fixed offsets.
  const c1 = containers[1].data;
  if (c1.length >= C1_VIEW + 16) {
    writePstrField(c1, C1_SET, patch.set);
    writePstrField(c1, C1_SCENE, patch.scene);
    writePstrField(c1, C1_VIEW, patch.view);
  }
  // ...and the frame counter beside them, so the game's frame stamps still
  // measure from the same zero when the save is read back (C1_FRAME).
  if (patch.frame !== undefined && c1.length >= C1_FRAME + 4) {
    new DataView(c1.buffer, c1.byteOffset, c1.byteLength).setUint32(C1_FRAME, patch.frame >>> 0, true);
  }

  // the CD the save is taken on (see SavePatch.disk). Same-or-shorter than the
  // label already there, so the write cannot reach past the field the base
  // defines: the pstr's own length byte is the only bound container 0 gives us.
  if (patch.disk !== undefined) {
    const c0 = containers[0].data;
    const room = c0.length > C0_DISK ? c0[C0_DISK] : 0;
    if (patch.disk.length <= room) writePstrField(c0, C0_DISK, patch.disk, room);
    else patch.onDrop?.(`disk(${patch.disk})`, `longer than the ${room}-byte label it replaces`);
  }

  // the set FILE: re-path the manifest record the set id at C1 @544 resolves
  // to, and write the set's register refs at C1 @644/@652 — the loader opens
  // the room from these three, not from the set name (see SavePatch.setFile).
  // The record keeps its old id and its directory prefix; only the basename
  // after the last ":" changes, which is also all that distinguishes the
  // shipped saves' set records from one another.
  //
  // KEEPING THE PREFIX IS SAFE, including across a disc boundary, and it is
  // worth saying why because the record looks like it should matter: a save
  // written after the story crosses back to disc 1 at mission 4 inherits its
  // skeleton's `titanic2:data:` and so names the wrong volume for the room it
  // points at. The original does not read it. Its loader resolves the handle to
  // this path (0x4153f0, walking the same records at +0x1310) and then hands the
  // buffer to 0x42bc20, which strips everything up to and including the LAST
  // ":" — reducing `titanic2:data:deckbd2.set` to `deckbd2.set` — before
  // 0x429e30 opens it. What it opens is therefore a BASENAME resolved through
  // the resource path table, exactly as a script's own `opensetfile("deckbd2.set")`
  // is, and which disc that finds is settled by the mounted volume: the CD named
  // at container 0 @256, which `SavePatch.disk` above keeps true. Verified
  // against the corpus too — no shipped save names the volume it was not taken
  // on, so the original never has to rely on this, but nothing reads the field
  // either way.
  if (patch.setFile && c1.length >= C1_SCENE_REGISTER + 4) {
    const c0 = containers[0].data;
    const v0 = new DataView(c0.buffer, c0.byteOffset, c0.byteLength);
    const v1 = new DataView(c1.buffer, c1.byteOffset, c1.byteLength);
    const setId = v1.getUint32(C1_SETFILE_ID, true);
    const count = c0.length >= C0_FILE_COUNT + 4 ? v0.getUint32(C0_FILE_COUNT, true) : 0;
    let recOff = -1;
    for (let r = 0; r < count; r++) {
      const off = C0_FILE_RECORDS + r * C0_FILE_STRIDE;
      if (off + C0_FILE_STRIDE <= c0.length && v0.getUint32(off, true) === setId) { recOff = off; break; }
    }
    if (recOff < 0) {
      patch.onDrop?.(`setFile(${patch.setFile.file})`, "the set id at C1 @544 matches no manifest record");
    } else {
      const len = c0[recOff + 4];
      let path = "";
      for (let j = 0; j < len; j++) path += String.fromCharCode(c0[recOff + 5 + j]);
      const cut = path.lastIndexOf(":");
      const newPath = path.slice(0, cut + 1) + patch.setFile.file.toLowerCase();
      writePstrField(c0, recOff + 4, newPath, C0_FILE_STRIDE - 4 - 1);
      v1.setUint32(C1_ACTOR_REGISTER, patch.setFile.actorRegister, true);
      v1.setUint32(C1_SCENE_REGISTER, patch.setFile.sceneRegister, true);
      v1.setUint32(C1_SCENE_COUNT, patch.setFile.sceneCount, true);
      // the set's half of the restored CLUT — without it the room comes back
      // in the base room's colours until the next set change
      const clut = patch.setFile.clut;
      if (clut && c0.length >= C0_CLUT + C0_CLUT_SET_HALF) {
        c0.set(clut.subarray(0, C0_CLUT_SET_HALF), C0_CLUT);
      }
    }
  }

  // inventory: overwrite each named prop's view (record+48) and owner (record+64)
  // in place. Both are read at fixed offsets, so writing them as Pascal strings
  // there preserves the 158-byte grid (the value field trailing owner is ignored
  // on read — see docs/engine/formats/savegame.md).
  if (patch.inventory?.length) {
    const ii = index.inventory;
    const d = containers[ii].data;
    const dv = new DataView(d.buffer, d.byteOffset, d.byteLength);
    const offs = new Map(walkPropGrid(d).map((r) => [r.prop.name, r.off]));
    for (const sp of patch.inventory) {
      const off = offs.get(sp.name.toLowerCase());
      // A prop the base has no record for. The original writes one record per
      // prop it has LOADED, so a save taken with a room's own shop open holds
      // more than the 72 boot-shop ones — and a container cannot be grown here.
      // Not a loss worth reporting: the caller offers every loaded prop and the
      // extras are per-room furniture the arriving room rebuilds anyway.
      if (off === undefined) continue;
      if (sp.view !== undefined) writePstrField(d, off + PROP_VIEW_OFF, sp.view);
      if (sp.set !== undefined) writePstrField(d, off + PROP_SET_OFF, sp.set);
      if (sp.star !== undefined) writePstrField(d, off + PROP_STAR_OFF, sp.star);
      writePstrField(d, off + PROP_OWNER_OFF, sp.owner);
      // the numeric half — where and how the prop draws. Bounds-checked like
      // the reader: the fields sit BEFORE the name and the first record's
      // begin at offset 0 of the container.
      const put = (at: number, value: number | undefined, wide = false): void => {
        if (value === undefined) return;
        const p = off + at;
        if (p < 0 || p + (wide ? 4 : 2) > d.length) return;
        if (wide) dv.setInt32(p, value | 0, true);
        else dv.setInt16(p, clampI16(value), true);
      };
      const flag = (b: boolean | undefined): number | undefined => (b === undefined ? undefined : Number(b));
      put(PROP_FIELDS.visible, flag(sp.visible));
      put(PROP_FIELDS.is3d, flag(sp.is3d));
      put(PROP_FIELDS.x, sp.x);
      put(PROP_FIELDS.y, sp.y);
      put(PROP_FIELDS.worldX, sp.worldX);
      put(PROP_FIELDS.worldY, sp.worldY);
      put(PROP_FIELDS.worldZ, sp.worldZ);
      put(PROP_FIELDS.deg, sp.deg);
      put(PROP_FIELDS.dist, sp.dist);
      put(PROP_FIELDS.scale, sp.scale);
      // propvalue is the record's one u32 (its getter reads a dword)
      put(PROP_FIELDS.value, sp.value, true);
      put(PROP_FIELDS.zclip, sp.zclip);
    }
  }

  // actors: the same in-place write — the memory of the player (owner, conversation
  // count) and, when the caller supplies one, the whole placement half.
  if (patch.actors?.length) {
    const ai = index.actors;
    /** a field at `at` bytes from the name; false when it falls outside the slice.
     *  Every placement offset is NEGATIVE, so the lower bound matters as much as
     *  the upper one — a container's first record can begin before the slice.
     *  The view is fetched per write: appending a record replaces the array. */
    const put = (at: number, value: number, wide = false): boolean => {
      const d = containers[ai].data;
      if (at < 0 || at + (wide ? 4 : 2) > d.length) return false;
      const view = new DataView(d.buffer, d.byteOffset, d.byteLength);
      if (wide) view.setInt32(at, value | 0, true);
      else view.setInt16(at, value, true);
      return true;
    };
    /**
     * Grow the actor container by one blank record and answer its NAME offset.
     *
     * Growable where the globals blob is not: the actor container has no
     * self-declared capacity — TI.EXE's save writer dumps the live actor-list
     * handle and its loader (0x4143d2) stores the read container's handle
     * straight back into the list global, so the record count is implicit in
     * the container's size. The grid also starts at offset 0 in all 109
     * shipped saves, so "the end of the last record" is just the length.
     * This is what lets a save carry the crowd (`setupgroup`'s per-room
     * extras), which a load must place from the file since it does not
     * re-run the room's own scripts (#143).
     */
    const append = (): number => {
      const d = containers[ai].data;
      const grid = walkActorGrid(d);
      // the last record ends 80 bytes past its name (name at +0x50 of 160);
      // records are back to back from 0, so that must be the length — refuse
      // a container whose grid doesn't end there (unknown trailing bytes are
      // not ours to bury)
      const end = grid.length ? grid.at(-1)!.off - ACTOR_RECORD_OFF : 0;
      if (end !== d.length) return -1;
      const grown = new Uint8Array(d.length + ACTOR_STRIDE);
      grown.set(d, 0);
      containers[ai].data = grown;
      return d.length - ACTOR_RECORD_OFF; // the new record's NAME offset
    };
    const offs = new Map(walkActorGrid(containers[ai].data).map((r) => [r.actor.name, r.off]));
    for (const sa of patch.actors) {
      let off = offs.get(sa.name.toLowerCase());
      if (off === undefined) {
        // No record in the base — the crowd extras, which `setupgroup` makes
        // per room (the shipped saves hold 25 to 64 records for exactly this
        // reason). Append one; a load places the crowd from the file now.
        // Only a PLACED actor is worth a record: an unplaced one carries
        // nothing a fresh instance doesn't.
        if (!sa.placement?.set && sa.owner === "none" && !sa.value) continue;
        const at = sa.name.length <= 15 && isPropName(sa.name) ? append() : -1;
        if (at < 0) {
          patch.onDrop?.(`actor(${sa.name})`, "no record in the base save and none appendable");
          continue;
        }
        writePstrField(containers[ai].data, at, sa.name);
        offs.set(sa.name.toLowerCase(), at);
        off = at;
      }
      // the cast file the member comes from, as its manifest handle (record +2)
      if (sa.cast) put(off + ACTOR_RECORD_OFF + ACTOR_CAST_OFF, manifestHandle(containers, sa.cast), true);
      const d = containers[ai].data;
      // the field is a length byte + 15 characters, and the longest owner any
      // script assigns is "readhackerclue" at 14 — but a truncated owner would
      // be a DIFFERENT rung of somebody's ladder, so refuse rather than trim
      if (sa.owner.length > 15) {
        patch.onDrop?.(`actorowner(${sa.name})`, `"${sa.owner}" is longer than the record's 15 characters`);
        continue;
      }
      writePstrField(d, off + ACTOR_OWNER_OFF, sa.owner);
      put(off + ACTOR_VALUE_OFF, Math.max(0, Math.trunc(sa.value)), true);
      const p = sa.placement;
      if (!p) continue;
      // A name that will not fit is refused rather than trimmed, for the same
      // reason as the owner: half a set name is a different room.
      const tooLong = ([["set", p.set], ["star", p.star], ["pose", p.pose]] as const)
        .find(([, v]) => v.length > 15);
      if (tooLong) {
        patch.onDrop?.(`actor${tooLong[0]}(${sa.name})`, `"${tooLong[1]}" is longer than the record's 15 characters`);
        continue;
      }
      writePstrField(d, off + ACTOR_SET_OFF, p.set);
      writePstrField(d, off + ACTOR_STAR_OFF, p.star);
      writePstrField(d, off + ACTOR_POSE_OFF, p.pose);
      put(off + ACTOR_PLACEMENT.visible, p.visible ? 1 : 0);
      put(off + ACTOR_PLACEMENT.deg, p.deg & 0xff);
      // the coordinate fields are i16 in the original and the world is inside
      // that range (measured over the corpus: x 0..18414, y 0..16336,
      // z -2441..6800), but a clamp is cheaper than a wrapped position
      put(off + ACTOR_PLACEMENT.x, clampI16(p.x));
      put(off + ACTOR_PLACEMENT.y, clampI16(p.y));
      put(off + ACTOR_PLACEMENT.z, clampI16(p.z));
      put(off + ACTOR_PLACEMENT.speed, clampI16(p.speed));
      put(off + ACTOR_PLACEMENT.turn, clampI16(p.turn));
      put(off + ACTOR_PLACEMENT.scale, clampI16(p.scale));
      put(off + ACTOR_PLACEMENT.zclip, clampI16(p.zclip));
    }
  }

  // the scheduler: the three fixed-size service tables, written whole.
  if (patch.scheduler) {
    const si = index.loops;
    const loops = new Uint8Array(LOOPS_SIZE);
    const ldv = new DataView(loops.buffer);
    for (const [i, l] of patch.scheduler.loops.slice(0, 32).entries()) {
      const kind = LOOP_KINDS.indexOf(l.kind as (typeof LOOP_KINDS)[number]);
      if (kind <= 0 || l.name.length > 15 || l.handler.length > 15) {
        patch.onDrop?.(`makeloop(${l.kind}, ${l.name})`, "kind or name not representable");
        continue;
      }
      const s = i * 42;
      ldv.setUint16(s, 1, true); // active; +2 stays 0 (not mid-service)
      ldv.setUint16(s + 4, kind, true);
      ldv.setUint32(s + 6, Math.max(1, l.period | 0), true);
      writePstrField(loops, s + 10, l.name);
      writePstrField(loops, s + 26, l.handler);
    }
    containers[si].data = loops;
    const crickets = new Uint8Array(CRICKETS_SIZE);
    const cdv = new DataView(crickets.buffer);
    for (const [i, c] of patch.scheduler.crickets.slice(0, 16).entries()) {
      if (c.name.length > 15 || c.set.length > 15) {
        patch.onDrop?.(`makecricket(${c.name})`, "name not representable");
        continue;
      }
      const s = i * 74;
      cdv.setUint16(s, 1, true);
      cdv.setInt16(s + 4, clampI16(c.x), true);
      cdv.setInt16(s + 6, clampI16(c.y), true);
      cdv.setUint32(s + 8, Math.max(0, c.radius | 0), true);
      cdv.setUint32(s + 0x0c, Math.max(0, c.base | 0), true);
      cdv.setInt32(s + 0x10, c.jitter | 0, true);
      cdv.setUint32(s + 0x14, Math.max(0, c.next | 0), true);
      // +0x18.. (listener position, distance, pan) are the service pass's own
      // working state, recomputed when the cricket next fires; pan centred.
      cdv.setUint16(s + 0x20, 128, true);
      writePstrField(crickets, s + 0x2a, c.set);
      writePstrField(crickets, s + 0x3a, c.name);
    }
    containers[si + 1].data = crickets;
    const walks = new Uint8Array(WALKS_SIZE);
    const wdv = new DataView(walks.buffer);
    const payloads: Uint8Array[] = [];
    let slot = 0;
    for (const w of patch.scheduler.walks ?? []) {
      // the table is 16 fixed slots, and a walk past them is LOST, not queued —
      // say so, the way every other unwritable item here is said (#191 review:
      // the corpus itself shows 12 concurrent turns in one save, so a crowded
      // room can genuinely reach the wall)
      if (slot >= 16) {
        patch.onDrop?.(`walk(${w.actor})`, "the walks table holds 16 slots");
        continue;
      }
      if (w.actor.length > 15 || w.star.length > 15) {
        patch.onDrop?.(`walk(${w.actor})`, "actor or arrival star not representable");
        continue;
      }
      // a route without its waypoints is a slot claiming the path mover with
      // nothing behind it — a shape no shipped save has (hasPayload ⇔ type 3
      // across the corpus) and neither loader is specified for. The caller's
      // hasPayload is not consulted: it is the DECODER's report, and this is
      // the one place the rule is enforced (#191 review).
      const path = w.type === 3 ? w.path : undefined;
      if (w.type === 3 && (!path || path.length < 2)) {
        patch.onDrop?.(`walk(${w.actor})`, "a route with no waypoints");
        continue;
      }
      const s = slot++ * 110;
      wdv.setUint16(s + WALK_SLOT.active, 1, true);
      wdv.setUint16(s + WALK_SLOT.paused, w.paused ? 1 : 0, true);
      wdv.setInt16(s + WALK_SLOT.type, w.type, true);
      // the facing TARGET, and -1 once the turn is done — which is what all
      // three shipped routes carry, and what the loader reads back as "no turn"
      wdv.setInt16(s + WALK_SLOT.turnTo, w.turnTo, true);
      wdv.setInt16(s + WALK_SLOT.deg, w.deg & 0xff, true);
      wdv.setInt16(s + WALK_SLOT.x, clampI16(w.startX), true);
      wdv.setInt16(s + WALK_SLOT.y, clampI16(w.startY), true);
      wdv.setInt16(s + WALK_SLOT.z, clampI16(w.startZ), true);
      wdv.setInt32(s + WALK_SLOT.progress, w.progress | 0, true);
      // the deltas are SUBTRACTED — `pos = start - delta * progress / dist`
      // (see {@link SavedWalk}) — so what goes in the record is start - dest,
      // and a caller holding dest - start has the sign the mover does not
      wdv.setInt32(s + WALK_SLOT.dx, (w.startX - w.destX) | 0, true);
      wdv.setInt32(s + WALK_SLOT.dy, (w.startY - w.destY) | 0, true);
      wdv.setInt32(s + WALK_SLOT.dz, (w.startZ - w.destZ) | 0, true);
      wdv.setInt32(s + WALK_SLOT.dist, w.dist | 0, true);
      writePstrField(walks, s + WALK_SLOT.actor, w.actor);
      writePstrField(walks, s + WALK_SLOT.star, w.star);
      // a route's waypoints go in a container of their own, and +0x12 says so
      if (path) {
        wdv.setUint32(s + WALK_SLOT.payload, WALK_PATH_HANDLE, true);
        payloads.push(encodeWalkPath(path));
      }
    }
    containers[si + 2].data = walks;
    // The payloads follow the walks table, one per type-3 slot in slot order —
    // and the base's own payloads go UNCONDITIONALLY, walks passed or not:
    // they belong to the base's moment (dropping them is why an omitted table
    // is zeroed, see {@link SavePatch.scheduler}), the zeroed
    // table references none, and one behaviour means `walks: []` and an
    // omitted `walks` produce the same bytes (#191 review).
    containers.length = si + 3;
    for (const p of payloads) containers.push({ id: containers.length, data: p });
  }

  // the theme: empty every track's playing/looping lists, then write the named
  // track's as ONE RECORD PER LOOP CHUNK, exactly the shape TI.EXE's writer
  // dumps and — the part that is not optional — the shape its post-load resume
  // assumes. The resume pairs playing record n with the bank's loop-table
  // record n and rebuilds the looping list from the bank's play order over the
  // playing array, so lists shorter than the bank's tables are read and
  // written PAST their heap blocks in the original engine ("Memory error at
  // line 301 (code 2): Unknown compression format" — see SavePatch.theme).
  // Counts and container lengths move together so the file stays the shape the
  // original writes.
  if (patch.theme !== undefined) {
    const ti = index.tracks;
    const d = containers[ti].data;
    const dv = new DataView(d.buffer, d.byteOffset, d.byteLength);
    const want = patch.theme?.track.toLowerCase() ?? null;
    const volume = patch.theme?.volume ?? 255;
    // playing = the bank's loop records in table order; looping = the play
    // order expanded over them. All shipped records: +2 = 0, pan = 128.
    const soundRecord = (c: { index: number; name: string }): Uint8Array => {
      const rec = new Uint8Array(SOUND_STRIDE);
      const rdv = new DataView(rec.buffer);
      rdv.setUint16(0, c.index, true);
      rdv.setUint16(4, volume, true);
      rdv.setUint16(6, 128, true);
      writePstrField(rec, 8, c.name);
      return rec;
    };
    const playing = patch.theme?.chunks ?? [];
    const looping = (patch.theme?.order ?? [])
      .map((v) => playing[v - 1])
      .filter((c): c is { index: number; name: string } => c !== undefined);
    const pack = (list: { index: number; name: string }[]): Uint8Array => {
      const out = new Uint8Array(list.length * SOUND_STRIDE);
      list.forEach((c, r) => out.set(soundRecord(c), r * SOUND_STRIDE));
      return out;
    };
    let written = false;
    for (let k = 0; k < d.length / TRACK_STRIDE; k++) {
      const name = pstrField(d, k * TRACK_STRIDE + TRACK_NAME_OFF).toLowerCase();
      for (const [j, cOff, list] of (
        [[1, TRACK_COUNTS[1], playing], [2, TRACK_COUNTS[2], looping]] as const
      )) {
        const idx = ti + 1 + 3 * k + j;
        if (name === want && playing.length) {
          containers[idx].data = pack([...list]);
          dv.setInt16(k * TRACK_STRIDE + cOff, list.length, true);
          written = true;
        } else {
          containers[idx].data = new Uint8Array(0);
          dv.setInt16(k * TRACK_STRIDE + cOff, 0, true);
        }
      }
    }
    if (want && playing.length && !written) {
      patch.onDrop?.(`theme(${want})`, "the save has no such bank open — the room will load silent");
    } else if (want && !playing.length) {
      patch.onDrop?.(`theme(${want})`, "the bank's loop table was not readable — the room will load silent");
    }
  }

  return writeSaveFile(raw);
}
