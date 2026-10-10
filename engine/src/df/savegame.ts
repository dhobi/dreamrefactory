import { BinaryReader, latin1, pstrAtChecked } from "./binary";
// The variable list and its string pool — shared with the v1 (Dust) reader,
// because that half of the format never changed. See `save-vars.ts`.
import {
  DFVALUE_BOOLEAN,
  DFVALUE_NUMBER_WRITTEN,
  DFVALUE_STRING,
  NODE_TYPE,
  NODE_VALUE,
  SavedVar,
  decodeVars,
  freeVarSlots,
  newVarRecord,
  poolIntern,
  pstrField,
  recordOffsets,
  writePstrField,
} from "./save-vars";
// re-exported: they were this module's own API before the split, and both are
// part of what a caller reads a save for
export type { SavedVar };
export { freeVarSlots };
import { Container, HEADER_SIZE, readContainerAt } from "./container";
import {
  PROP_STRIDE,
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
  C1_STAGE,
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

/**
 * Titanic `.ti` save-game files.
 *
 * A save is a DreamFactory container file (same 1024-byte header + position
 * table skeleton as `container.ts`) but with the signature `ODTRTRFD` at
 * offset 32 (normal game files use `LPPALPPA`) and `fourCC` 0x00010000. The
 * containers are a serialization of the engine's live object graph — see
 * `docs/engine/formats/savegame.md`. Many records embed live process pointers that the
 * original loader rebuilds; we preserve them verbatim for byte-exact round-trip
 * and ignore them on read.
 *
 * This module has two layers:
 *  - low level: `readSaveFile` / `writeSaveFile` — the raw container file, which
 *    round-trips byte-for-byte, leftovers included (see RawSaveFile.table);
 *  - high level: `parseSave` — decodes the fields the engine needs to load a
 *    game (globals, current location, inventory), keeping the raw file so the
 *    writer can reproduce untouched containers exactly.
 */

const SAVE_SIGNATURE = "ODTRTRFD";
const SAVE_FOURCC = 0x00010000;
/** container 0 begins here — after the 1024-byte header + 512-byte (128-entry) position-table region. */
const DATA_START = 1536;
/** every container is aligned to this many bytes. */
const ALIGN = 64;
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

const roundUp = (n: number, a: number) => Math.ceil(n / a) * a;

/** the raw container file — enough to reproduce the exact bytes. A save is
 *  built from the same {@link Container} records as every other DF file. */
export interface RawSaveFile {
  /** verbatim 1024-byte file header (fourCC, size, signature, …). */
  header: Uint8Array;
  /**
   * The position-table region, verbatim: 128 u32 slots between the header and
   * {@link DATA_START}, of which the header's `containerCount` are live.
   *
   * Carried rather than rebuilt because the rest of it is NOT ours. The original
   * writes the table into a buffer it does not clear, so a real save has the
   * writing process's leftovers behind the live slots — Mac heap pointers, ends
   * of path strings — and a reader that drops them makes a writer that cannot
   * put them back. The port's saves are patched copies of the game's own files,
   * offered back to a program we cannot debug, so "reproduce every byte you were
   * given" is the only defensible rule for the bytes we do not understand.
   */
  table: Uint8Array;
  containers: Container[];
}

/** Read the low-level container file. Preserves order and empty containers. */
export function readSaveFile(bytes: Uint8Array): RawSaveFile {
  const r = new BinaryReader(bytes);
  const fourCC = r.i32();
  if (fourCC !== SAVE_FOURCC) throw new Error(`not a save file (fourCC 0x${(fourCC >>> 0).toString(16)})`);
  const sig = latin1(bytes.subarray(32, 40));
  if (sig !== SAVE_SIGNATURE) throw new Error(`not a save file (signature "${sig}")`);
  r.seek(20);
  const count = r.i32();
  const header = bytes.slice(0, HEADER_SIZE);
  // padded, so a truncated or hand-built file still yields the full region
  const table = new Uint8Array(DATA_START - HEADER_SIZE);
  table.set(bytes.subarray(HEADER_SIZE, Math.min(bytes.length, DATA_START)));

  const positions: number[] = [];
  r.seek(HEADER_SIZE);
  for (let i = 0; i < count; i++) positions.push(r.u32());

  const containers: Container[] = [];
  for (let i = 0; i < count; i++) {
    const p = positions[i];
    // saves are always type 0; an empty container still has a real position
    // with size 0 (it is not a header-pointing gap).
    if (p <= HEADER_SIZE) {
      containers.push({ id: i, data: new Uint8Array(0) });
      continue;
    }
    containers.push(readContainerAt(bytes, p));
  }
  return { header, table, containers };
}

/**
 * Reassemble the exact bytes of a save file: container 0 at {@link DATA_START},
 * every container 64-byte aligned, file size rounded up to 64. The header's
 * `fileSize` (offset 4) and `containerCount` (offset 20) are refreshed; all
 * other header bytes are preserved from `raw.header`.
 */
export function writeSaveFile(raw: RawSaveFile): Uint8Array {
  const count = raw.containers.length;
  // first pass: compute positions and total size.
  const positions: number[] = [];
  let off = DATA_START;
  for (const c of raw.containers) {
    positions.push(off);
    off = roundUp(off + 8 + c.data.length, ALIGN);
  }
  const fileSize = off;

  const out = new Uint8Array(fileSize);
  out.set(raw.header.subarray(0, HEADER_SIZE), 0);
  // the table region as it came, live slots and leftovers alike (RawSaveFile.table)
  out.set((raw.table ?? new Uint8Array(0)).subarray(0, DATA_START - HEADER_SIZE), HEADER_SIZE);
  const dv = new DataView(out.buffer);
  dv.setUint32(4, fileSize, true);
  dv.setInt32(20, count, true);
  // position table
  for (let i = 0; i < count; i++) dv.setUint32(HEADER_SIZE + i * 4, positions[i], true);
  // containers
  for (let i = 0; i < count; i++) {
    const c = raw.containers[i];
    const p = positions[i];
    dv.setInt32(p, c.id, true);
    dv.setUint32(p + 4, c.data.length, true);
    out.set(c.data, p + 8);
  }
  return out;
}

// ---------------------------------------------------------------------------
// High-level decode
// ---------------------------------------------------------------------------

/** A serialized script variable (from the globals container). */

/**
 * A serialized prop's persistent runtime state, from the inventory container:
 * every loaded prop (inventory items first, then the interface band). The
 * `owner` is who holds the item ("frank" = in Frank's possession) or, for the
 * band's chrome, the band's memo of what was on screen; `view` is the propview
 * state; and the numeric half ({@link PROP_FIELDS}) is where and how it draws —
 * which is what lets a load put the screen back instead of re-running the room's
 * `showinterface`/`setupsigns`/`setuparrow` to re-derive it (#143).
 */
export interface SavedProp {
  /** prop (inven.shp group) name, lowercased. */
  name: string;
  /** current propview state at name+48 (e.g. "large", "panel1"). */
  view: string;
  /** propowner at name+64 (e.g. "frank", "none", "vlad", "purser"). */
  owner: string;
  /** `propset` at name+16 — the set a world prop is drawn in ("" for none). */
  set: string;
  /** `propstar` at name+32 — the star it was placed on (or a sentinel). */
  star: string;
  /** `propvisible` — shown right now. */
  visible: boolean;
  /** `propis3d` — placed in the WORLD (propxyz) rather than on the screen. The
   * one field that says whether the x/y anchor below is meaningful. */
  is3d: boolean;
  /** screen anchor (propxy) — X at name−0x38, Y at name−0x3a. */
  x: number;
  y: number;
  /** world place (`propxyz` axes 1..3): the ground pair, then the height. */
  worldX: number;
  worldY: number;
  worldZ: number;
  /** `propdeg` — the deg-selector frame (nav arrow lit, the watch wheels). */
  deg: number;
  /** `propdist` — z-order, more negative = closer (the watch assembly's stack). */
  dist: number;
  /** `propscale`. */
  scale: number;
  /** `propvalue`. */
  value: number;
  /** `propzclip`. */
  zclip: number;
}

/**
 * What a writer offers for one prop record: the owner always; the view and the
 * numeric half when the caller holds them. A view the caller never modelled is
 * left out and keeps the base save's — a real reading taken by the original
 * engine rather than a guess of ours.
 */
export type SavedPropPatch = Pick<SavedProp, "name" | "owner"> &
  Partial<Pick<SavedProp, "view" | "set" | "star" | "visible" | "is3d" | "x" | "y" | "worldX" | "worldY" | "worldZ" | "deg" | "dist" | "scale" | "value" | "zclip">>;

/**
 * One live `makeloop` slot from the loops table — the room's scheduled work
 * (idle loops, scene timers). The table is TI.EXE's own 32-slot service table
 * (0x48bcd0, stride 42) dumped verbatim by the save writer; `period` is the live
 * countdown in 50 ms service ticks, mid-flight.
 */
export interface SavedLoop {
  /** loop kind — the record stores 1..4 for actor/prop/scene/flat (0x4449f0). */
  kind: string;
  /** who the loop belongs to (the actor/prop/scene name). */
  name: string;
  /** the handler script it fires. */
  handler: string;
  /** ticks remaining until it fires. */
  period: number;
}
/**
 * One live `makecricket` slot from the crickets table (0x48b830, 16 × 74,
 * dumped verbatim): a positional ambient one-shot with its re-arm state.
 */
export interface SavedCricket {
  /** the cricket's sound name. */
  name: string;
  /** the set it was made in (record +0x2a — crickets are per-room ambience). */
  set: string;
  x: number;
  y: number;
  radius: number;
  /** base re-arm period in ticks. */
  base: number;
  /** re-arm jitter; −1 = one-shot. */
  jitter: number;
  /** ticks remaining until the next fire (base + rand(jitter), mid-count). */
  next: number;
}

/**
 * One active walk slot from the walks table (0x48b150, 16 × 110) — the record
 * TI.EXE's walk service reads, dumped verbatim, and enough of it to put the walk
 * back mid-stride.
 *
 * The fields are the ones the mover touches (0x443E7C), at the offsets it reads
 * them from:
 *
 *     +0x00 u16 active   +0x02 u16 paused   +0x04 i16 type   +0x08 i16 turn target
 *     +0x0A i16 facing   +0x0C/0E/10 i16 start x/y/z         +0x12 i32 path payload
 *     +0x16 i32 progress +0x1A/1E/22 i32 deltas              +0x26 i32 distance
 *     +0x2E pstr actor   +0x3E pstr arrival star
 *
 * The deltas are SUBTRACTED — `pos = start - delta * progress / dist` — so the
 * destination is `start - delta`, which is why {@link destX} exists rather than
 * making every caller remember the sign.
 *
 * **The type is which mover, and only one of the three writes those words.** A
 * type-0 slot is a `turntodeg` — a facing target, no movement at all — and a
 * type-3 route keeps its waypoints AND its total length in the payload container
 * hanging off +0x12. Both leave the movement words holding whatever the slot held
 * last, so both read as nonsense (`vlad`'s distance is -202637146, `hack`'s
 * -1422655421) and neither may be believed. Only type 1 fills them in.
 *
 * 16 slots live across 12 of the 109 shipped saves: 12 turns, one straight line,
 * and three routes.
 */
export interface SavedWalk {
  actor: string;
  /** 0 = a `turntodeg` with no mover, 1 = a straight line, 3 = an authored route */
  type: number;
  /** an authored route's waypoints hang off +0x12, in a payload container of
   *  their own — see {@link path}, which is that container decoded. The
   *  DECODER's report, and only that: the writer derives the payload decision
   *  from {@link type} and {@link path} and never reads this field, so the rule
   *  "payload ⇔ type 3" has one owner (a type-3 patch without waypoints is
   *  dropped through onDrop, not written as a shape no shipped save has). */
  hasPayload: boolean;
  paused: boolean;
  /** the facing to reach before moving; negative once the turn is done */
  turnTo: number;
  /** the walk's own copy of the actor's facing (+0x0A) */
  deg: number;
  startX: number;
  startY: number;
  startZ: number;
  /** where it is headed — `start - delta`, see the docblock */
  destX: number;
  destY: number;
  destZ: number;
  /** how far along, in the same world units as {@link dist} */
  progress: number;
  dist: number;
  /** the arrival star (+0x3E) — what `actorstar` settles on when it lands */
  star: string;
  /**
   * A type-3 route's waypoints, from its payload container: each point with the
   * cumulative distance to it, so `path[last].cum` is {@link dist}.
   *
   * The container stores each point's distance from the one BEFORE it (the
   * first's is 0) and the total at +0; this runs them up. Reconstructing the
   * position from the route and {@link progress} lands on the actor record's
   * own for all three shipped routes, which is what says the walk can be put
   * back rather than dropped.
   */
  path?: { x: number; y: number; z: number; cum: number }[];
}

/**
 * The music that was PLAYING: the track whose playing/looping arrays are
 * non-empty. Each open track serializes three arrays of 104-byte sound records
 * (registered / playing / looping — index u16, track# u16, volume u16 (255
 * default), pan u16 (128 centre), name pstr@+8); exactly one track carries
 * playing records in every shipped save, and it is the live theme.
 */
export interface SavedTheme {
  /** track file name, e.g. "deckbd.trk". */
  track: string;
  /** channel volume of the playing record, 0..255. */
  volume: number;
  /** how many MORE records the playing/looping lists held (positional sound
   *  loops a load does not restore — reported, not silently dropped). */
  extras: number;
}

/**
 * What {@link SavePatch.theme} writes: the track plus its bank's own loop
 * table, because the playing/looping lists must mirror the bank record for
 * record — TI.EXE's resume indexes both by the bank's tables, not by the
 * save's counts (see {@link SavePatch.theme} for the failure mode).
 */
export interface ThemePatch {
  /** track file name as the open-tracks list names it, e.g. "cargo.trk". */
  track: string;
  /** record volume, 0..255 (the live theme volume; shipped saves hold 127/255). */
  volume?: number;
  /** the bank's loop records in table order: container location + identifier. */
  chunks: { index: number; name: string }[];
  /** the bank's play order, 1-based into `chunks` — becomes the looping list. */
  order: number[];
}

/**
 * A serialized actor's persistent state, from the actor container.
 *
 * `actorowner` is the one-word memory each character keeps of you, and it is a
 * story gate rather than decoration: the Purser's whole mission-2 errand ladder
 * is his ("none" → "sendgram" → … → "left2"), the chief engineer's turbine job is
 * `actorowner("csea")`, and Morrow's permission to enter the wireless room is
 * "enterwireless". A save that drops it reloads with the characters having
 * forgotten what you did.
 */
export interface SavedActor {
  /** actor (cast member) name, lowercased. */
  name: string;
  /** `actorowner` (e.g. "none", "sendgram", "enterwireless"). */
  owner: string;
  /** `actorvalue`: conversations had — see {@link ACTOR_VALUE_OFF}. */
  value: number;
  /**
   * Where the character was STANDING, and whether they were on screen.
   *
   * Read, not yet restored: a load re-runs `initactors` and lets each room's own
   * scripts place whoever they place, which is why Vlad is missing from the engine
   * room catwalk unless you re-enter by the one scene that stands him up (#86). The
   * record has always carried the answer — see the layout note above for how each
   * field was mapped and checked. Restoring it needs the WRITER to serialize these
   * from the live cast first, or a load would put back the base template's
   * arrangement instead of the player's.
   */
  placement: {
    /** `actorvisible` — the whole of "was this character on screen". */
    visible: boolean;
    /** the set the character is in ("engine", "boil"), "" when never placed. */
    set: string;
    /** `actorstar` — the named spot they were put on, or a walk sentinel. */
    star: string;
    /** `actorpose` — "stand", "walk", "dead", "standlj"… */
    pose: string;
    /** `actorxyz` 1/2/3 — the SET's own X, Z, Y order. */
    x: number;
    y: number;
    z: number;
    /** `actordeg`, 0..255. */
    deg: number;
    /** `actorspeed` — world units per service pass. */
    speed: number;
    /** `actorturn` (+32) — degrees of facing per pass while turning; 10 is
     *  `stdturn`, 16 the engine's default before a room sets one. */
    turn: number;
    /** `actorscale` (+42) — 1000 neutral; 0 places correctly but never draws. */
    scale: number;
    /** `actorzclip`. */
    zclip: number;
  };
}

/**
 * What a writer may say about one character: their memory of the player always,
 * and their placement when the caller has one to give.
 */
export type SavedActorPatch = Pick<SavedActor, "name" | "owner" | "value"> & {
  placement?: SavedActor["placement"];
  /**
   * The cast FILE the character came from (`extra.cst` for the crowd). Written
   * as that file's manifest handle at record +2, which TI.EXE's resume
   * (0x414b9c) resolves through the manifest to the open cast it re-reads the
   * member from. Every record in the shipped corpus carries one; omitted, the
   * base's is kept (and an appended record's stays 0).
   */
  cast?: string;
};

export interface SaveGame {
  /** "Titanic 1.0" version string from container 0. */
  title: string;
  /** disk family, e.g. "Titanic1" / "Titanic2" (c0 @256). */
  disk: string;
  /** current set base name (C1 @596), e.g. "bedsit1" / "turkstrs". */
  set: string;
  /** current scene name (C1 @612), e.g. "scene2". */
  scene: string;
  /** current view name (C1 @628), e.g. "view14". */
  view: string;
  /** current stage file (C1 @520), normally "main.stg". */
  stage: string;
  /** the engine's displayed-frame counter (C1 @442) — what `frame()` reads, and
   * the scale every frame stamp in {@link numGlobals} was written on. */
  frame: number;
  /**
   * The pending day event, as text — the head variable's value ("bedsit"…), or
   * the game time as digits once calctime owns it ("1301"). "" if it didn't
   * decode. A convenience read: {@link numGlobals}/{@link strGlobals} carry the
   * same value with its real type, and that is what a load restores.
   */
  clock: string;
  /** hallway facing ("port"/"star") from its variable record, or "". Only ever
   * read inside hall sets. There is no fallback: the 4 shipped saves with no
   * record (measured: exactly the pre-boarding ones, bedsit1/c73) never visited
   * a hallway, so there is nothing to fall back TO. */
  hallside: string;
  /** staircase deck-plan selector ("a".."g"/"bd"), best-effort: derived from the
   * current hall set's deck when it is a hall/deck set, else "". Only read at the
   * grand staircase (stair2c/gstair3); elsewhere the map page is set-derived. */
  savedeck: string;
  /** decoded script variables from the globals container, in file order. */
  vars: SavedVar[];
  /** numeric globals to restore (type-2/4 records): name → value. */
  numGlobals: Map<string, number>;
  /** string globals to restore (type-3 records, decoded via the string pool):
   * name → value. Includes hallside, savedeck, handitem, savestage1-3… */
  strGlobals: Map<string, string>;
  /** every prop serialized in the inventory container (inventory items + more). */
  inventory: SavedProp[];
  /** every actor serialized in the actor container, with its `actorowner`. */
  actors: SavedActor[];
  /** the cast files that were open, in file order — `gang.cst` always, plus
   * `extra.cst` in the rooms with a crowd. A load has to reopen these before it
   * restores the actors, because the crowd is instanced from them (#186). */
  castFiles: string[];
  /** the audio banks that were open, in file order — every `.trk`/`.sfx` the
   * open-tracks list names, not just the one that was playing. A load has to
   * reopen these, because the loop table it restores plays out of them (#199). */
  trackFiles: string[];
  /** the live `makeloop` table — the room's scheduled work, mid-count. */
  loops: SavedLoop[];
  /** the live `makecricket` table — the room's positional ambience. */
  crickets: SavedCricket[];
  /** active walk slots (mid-`walkto` characters; see {@link SavedWalk}). */
  walks: SavedWalk[];
  /** the playing theme, or null when the room was scored silent. */
  theme: SavedTheme | null;
  /** the raw file, retained so the writer can reproduce untouched containers. */
  raw: RawSaveFile;
  /** where each interesting container sits (see {@link saveIndex}). */
  index: SaveIndex;
}






// ---------------------------------------------------------------------------
// Container discovery — POSITIONAL, and self-validating.
// ---------------------------------------------------------------------------

/** how many containers a save has that are not an open track's three */
const FIXED_CONTAINERS = 7 + 5;

/** where each interesting container sits — computed, never searched for */
export interface SaveIndex {
  /** 2 — the cast, n × 160 */
  actors: number;
  /** 3 — open cast files, n × 28 */
  casts: number;
  /** 4 — every loaded prop, n × 158 */
  inventory: number;
  /** 5 — open shop files, n × 28 */
  shops: number;
  /** 6 — open tracks, n × 40 descriptors */
  tracks: number;
  /** how many audio banks are open — container 6's own record count */
  trackCount: number;
  /** 7 + 3·{@link trackCount} — the script globals */
  globals: number;
  /** the globals' string pool */
  pool: number;
  /** the `makeloop` table */
  loops: number;
  /** the `makecricket` table */
  crickets: number;
  /** the `walkto` table; the waypoint payloads follow it */
  walks: number;
}

/**
 * Which container is which, from the file's own numbers.
 *
 * The writer is ONE routine (`0x413910`, called by `savegame`'s implementation at
 * `0x4137a0`) emitting one fixed sequence, so nothing here is a search: containers
 * 0-6 are always the manifest, the standpoint, the cast, the open casts, the
 * inventory, the open shops and the open-tracks list; container 6's own length
 * says how many tracks are open; three arrays per track follow; and the globals,
 * the string pool and the three service tables follow those. See the container
 * table in `docs/engine/formats/savegame.md`: "every index here is computed and
 * none is searched for".
 *
 * Not content probes — `mission`/`playerdeath`/`clock` for the globals,
 * longest-prop-grid for the inventory, longest-actor-grid for the cast, an
 * all-records-end-in-`.cst` test, a size triple, a descriptor/array shape check
 * for the tracks — for three reasons (#325): the reading exists and is
 * documented; probes would run a second time inside {@link applyPatch}, so a
 * mis-lock would *write* to the wrong container; and they misfire — the globals
 * blob is a grid of 32-byte variable nodes and 32 divides 160, so every fifth
 * node sits one actor stride from the last and a pair of variable names 64
 * bytes apart decodes as an actor name/owner record. Three shipped saves
 * (ENDGAME2 09/12/13) prefer it to their real cast container on record count
 * alone. Probes are also silently Titanic-specific: a Dust- or Timelapse-shaped
 * save carries none of those three variable names and would read as having no
 * globals at all.
 *
 * VALIDATION, which is what makes this a reading rather than a second
 * convention, and two-sided in both directions:
 *
 *  - the track count has to divide container 6 exactly, and each track's three
 *    arrays have to be as long as the descriptor's own three counts say — so a
 *    file with one track too many or too few fails on the array it lands on;
 *  - the three service tables are fixed sizes (32 × 42, 16 × 74, 16 × 110), so
 *    the tail of the map has to land on all three.
 *
 * Measured on all 654 shipped saves (109 × six editions): every one satisfies
 * both, and the map agrees with what those content probes return in every case.
 */
export function saveIndex(raw: RawSaveFile): SaveIndex {
  const n = raw.containers.length;
  if (n < FIXED_CONTAINERS) {
    throw new Error(`save: ${n} containers, fewer than the ${FIXED_CONTAINERS} every save has`);
  }
  const list = raw.containers[6].data;
  if (list.length % TRACK_STRIDE) {
    throw new Error(`save: open-tracks list is ${list.length} bytes, not a multiple of ${TRACK_STRIDE}`);
  }
  const trackCount = list.length / TRACK_STRIDE;
  const globals = 7 + 3 * trackCount;
  if (globals + 5 > n) {
    throw new Error(`save: ${trackCount} open tracks needs ${globals + 5} containers, file has ${n}`);
  }
  // each track's registered / playing / looping arrays, against the descriptor's
  // own counts
  const dv = new DataView(list.buffer, list.byteOffset, list.byteLength);
  for (let k = 0; k < trackCount; k++) {
    for (const [j, off] of TRACK_COUNTS.entries()) {
      const want = dv.getInt16(k * TRACK_STRIDE + off, true) * SOUND_STRIDE;
      const got = raw.containers[7 + 3 * k + j].data.length;
      if (got !== want) {
        throw new Error(
          `save: track ${k} array ${j} is ${got} bytes, descriptor says ${want}`,
        );
      }
    }
  }
  // and the tail: three service tables of fixed size, in this order
  for (const [at, size, what] of (
    [
      [globals + 2, LOOPS_SIZE, "loops"],
      [globals + 3, CRICKETS_SIZE, "crickets"],
      [globals + 4, WALKS_SIZE, "walks"],
    ] as const
  )) {
    const got = raw.containers[at].data.length;
    if (got !== size) {
      throw new Error(`save: container ${at} should be the ${what} table (${size} bytes), got ${got}`);
    }
  }
  return {
    actors: 2,
    casts: 3,
    inventory: 4,
    shops: 5,
    tracks: 6,
    trackCount,
    globals,
    pool: globals + 1,
    loops: globals + 2,
    crickets: globals + 3,
    walks: globals + 4,
  };
}

/** true for a plausible prop-record name (identifier at record+0). */
function isPropName(s: string): boolean {
  return s.length >= 2 && s.length <= 20 && /^[a-z][a-z0-9]*$/i.test(s);
}

/** Decode the prop record whose NAME is at offset `o`, or null if it isn't one.
 *  The numeric half sits at negative offsets from the name (the record base is
 *  0x4e bytes earlier), so each read is bounds-checked like the actor grid's. */
function propRecordAt(d: Uint8Array, o: number): SavedProp | null {
  const name = pstrField(d, o);
  if (!isPropName(name)) return null;
  const view = pstrField(d, o + PROP_VIEW_OFF);
  const owner = pstrField(d, o + PROP_OWNER_OFF);
  if (!view || !owner) return null;
  const dv = new DataView(d.buffer, d.byteOffset, d.byteLength);
  const num = (at: number, wide = false): number => {
    const p = o + at;
    if (p < 0 || p + (wide ? 4 : 2) > d.length) return 0;
    return wide ? dv.getInt32(p, true) : dv.getInt16(p, true);
  };
  return {
    name: name.toLowerCase(),
    view: view.toLowerCase(),
    owner: owner.toLowerCase(),
    set: pstrField(d, o + PROP_SET_OFF).toLowerCase(),
    star: pstrField(d, o + PROP_STAR_OFF).toLowerCase(),
    visible: num(PROP_FIELDS.visible) > 0,
    is3d: num(PROP_FIELDS.is3d) === 1,
    x: num(PROP_FIELDS.x),
    y: num(PROP_FIELDS.y),
    worldX: num(PROP_FIELDS.worldX),
    worldY: num(PROP_FIELDS.worldY),
    worldZ: num(PROP_FIELDS.worldZ),
    deg: num(PROP_FIELDS.deg),
    dist: num(PROP_FIELDS.dist),
    scale: num(PROP_FIELDS.scale),
    // the record's one u32 field (its getter reads a dword)
    value: num(PROP_FIELDS.value, true),
    zclip: num(PROP_FIELDS.zclip),
  };
}

/**
 * Walk the fixed 158-byte prop grid in a container, returning one record per
 * slot. Locks onto the grid from the first offset that decodes as two
 * consecutive records (rejecting stray name-like strings in pointer junk), then
 * rewinds to the grid base and walks forward until a slot fails to decode.
 * Returns `[offset, prop]` pairs so the writer can patch records in place.
 */
function walkPropGrid(d: Uint8Array): { off: number; prop: SavedProp }[] {
  const last = d.length - PROP_OWNER_OFF;
  let seed = -1;
  for (let o = 0; o < last; o++) {
    if (propRecordAt(d, o) && propRecordAt(d, o + PROP_STRIDE)) {
      seed = o;
      break;
    }
  }
  if (seed < 0) return [];
  let base = seed;
  while (base - PROP_STRIDE >= 0 && propRecordAt(d, base - PROP_STRIDE)) base -= PROP_STRIDE;
  const out: { off: number; prop: SavedProp }[] = [];
  for (let o = base; o < last; o += PROP_STRIDE) {
    const prop = propRecordAt(d, o);
    if (!prop) break;
    out.push({ off: o, prop });
  }
  return out;
}


/**
 * Decode the actor record whose NAME is at offset `o`, or null if it isn't one.
 *
 * `o` is the name rather than the record base because that is what the grid can be
 * located by; every numeric field is therefore at a negative offset from it (see
 * {@link ACTOR_RECORD_OFF}). The first record of a container can begin before
 * offset 0 of the slice we hold, so each numeric read is bounds-checked and falls
 * back to 0 — the grid is located by name and owner alone, so a field that cannot
 * be read can never make a non-record parse as one.
 */
function actorRecordAt(d: Uint8Array, o: number): SavedActor | null {
  const name = pstrField(d, o);
  if (!isPropName(name)) return null;
  const owner = pstrField(d, o + ACTOR_OWNER_OFF);
  if (!owner) return null;
  const view = new DataView(d.buffer, d.byteOffset, d.byteLength);
  /** a field at `at` bytes from the NAME, 0 when it falls outside the slice */
  const num = (at: number, wide = false): number => {
    const p = o + at;
    if (p < 0 || p + (wide ? 4 : 2) > d.length) return 0;
    return wide ? view.getInt32(p, true) : view.getInt16(p, true);
  };
  return {
    name: name.toLowerCase(),
    owner: owner.toLowerCase(),
    value: num(ACTOR_VALUE_OFF, true),
    placement: {
      visible: num(ACTOR_PLACEMENT.visible) > 0,
      set: pstrField(d, o + ACTOR_SET_OFF).toLowerCase(),
      star: pstrField(d, o + ACTOR_STAR_OFF).toLowerCase(),
      pose: pstrField(d, o + ACTOR_POSE_OFF).toLowerCase(),
      deg: num(ACTOR_PLACEMENT.deg),
      x: num(ACTOR_PLACEMENT.x),
      y: num(ACTOR_PLACEMENT.y),
      z: num(ACTOR_PLACEMENT.z),
      speed: num(ACTOR_PLACEMENT.speed),
      turn: num(ACTOR_PLACEMENT.turn),
      scale: num(ACTOR_PLACEMENT.scale),
      zclip: num(ACTOR_PLACEMENT.zclip),
    },
  };
}

/**
 * Walk the 160-byte actor grid, exactly as {@link walkPropGrid} walks the props:
 * lock onto the grid from the first pair of consecutive records, rewind to its
 * base, then run forward until a slot fails. Returns `[offset, actor]` pairs so
 * the writer can patch owners in place.
 */
function walkActorGrid(d: Uint8Array): { off: number; actor: SavedActor }[] {
  const last = d.length - ACTOR_OWNER_OFF;
  let seed = -1;
  for (let o = 0; o < last; o++) {
    if (actorRecordAt(d, o) && actorRecordAt(d, o + ACTOR_STRIDE)) {
      seed = o;
      break;
    }
  }
  if (seed < 0) return [];
  let base = seed;
  while (base - ACTOR_STRIDE >= 0 && actorRecordAt(d, base - ACTOR_STRIDE)) base -= ACTOR_STRIDE;
  const out: { off: number; actor: SavedActor }[] = [];
  for (let o = base; o < last; o += ACTOR_STRIDE) {
    const actor = actorRecordAt(d, o);
    if (!actor) break;
    out.push({ off: o, actor });
  }
  return out;
}


/**
 * The file a list record opens, the way TI.EXE's resume finds it: by the old
 * handle at +0, through the container-0 manifest (0x4152e0), falling back to the
 * record's own name. The two agree in every record of the shipped corpus (156
 * casts, 373 banks); a record whose handle the manifest lacks is fatal 0x1127 in
 * the original, and the name is what the port can still use.
 */
function recordFile(d: Uint8Array, o: number, nameOff: number, files: Map<number, string>): string {
  const own = (pstrAtChecked(d, o + nameOff, 1, 40) ?? "").toLowerCase();
  return files.get(new DataView(d.buffer, d.byteOffset, d.byteLength).getUint32(o, true)) ?? own;
}

/** the manifest's handle → basename map, for {@link recordFile} */
const manifestByHandle = (raw: RawSaveFile): Map<number, string> =>
  new Map(manifestFiles(raw.containers[0].data).map((f) => [f.handle, f.file]));

/** Decode the open-cast-file list (see {@link CAST_STRIDE}), lowercased. */
function decodeCastFiles(raw: RawSaveFile, castsIndex: number): string[] {
  const d = raw.containers[castsIndex].data;
  const files = manifestByHandle(raw);
  const out: string[] = [];
  for (let o = 0; o + CAST_STRIDE <= d.length; o += CAST_STRIDE) {
    const name = recordFile(d, o, CAST_NAME, files);
    if (name) out.push(name);
  }
  return out;
}

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


/** Decode the live `makeloop` table (see {@link SavedLoop}). */
function decodeLoops(d: Uint8Array): SavedLoop[] {
  const dv = new DataView(d.buffer, d.byteOffset, d.byteLength);
  const out: SavedLoop[] = [];
  for (let s = 0; s + 42 <= d.length; s += 42) {
    if (dv.getUint16(s, true) === 0) continue; // slot free
    const kind = LOOP_KINDS[dv.getUint16(s + 4, true)];
    const name = pstrField(d, s + 10);
    const handler = pstrField(d, s + 26);
    if (!kind || !name || !handler) continue; // junk in a free-but-nonzero slot
    out.push({
      kind,
      name: name.toLowerCase(),
      handler: handler.toLowerCase(),
      period: dv.getUint32(s + 6, true),
    });
  }
  return out;
}

/** Decode the live `makecricket` table (see {@link SavedCricket}). */
function decodeCrickets(d: Uint8Array): SavedCricket[] {
  const dv = new DataView(d.buffer, d.byteOffset, d.byteLength);
  const out: SavedCricket[] = [];
  for (let s = 0; s + 74 <= d.length; s += 74) {
    if (dv.getUint16(s, true) === 0) continue;
    const name = pstrField(d, s + 0x3a);
    if (!name) continue;
    out.push({
      name: name.toLowerCase(),
      set: pstrField(d, s + 0x2a).toLowerCase(),
      x: dv.getInt16(s + 4, true),
      y: dv.getInt16(s + 6, true),
      radius: dv.getUint32(s + 8, true),
      base: dv.getUint32(s + 0x0c, true),
      jitter: dv.getInt32(s + 0x10, true),
      next: dv.getUint32(s + 0x14, true),
    });
  }
  return out;
}

/**
 * One type-3 walk's waypoint payload: a total length @+0, a count @+8, and that
 * many 8-byte `{i16 x, y, z, u16 distance from the previous point}` from +20.
 * The container is a raw allocation, so slack trails the last point — the count
 * is what bounds it, never the length.
 */
function decodeWalkPath(d: Uint8Array): SavedWalk["path"] {
  if (d.length < 20) return undefined;
  const dv = new DataView(d.buffer, d.byteOffset, d.byteLength);
  const count = dv.getUint32(8, true);
  if (count < 2 || 20 + count * 8 > d.length) return undefined;
  const path: NonNullable<SavedWalk["path"]> = [];
  let cum = 0;
  for (let i = 0; i < count; i++) {
    const o = 20 + i * 8;
    cum += dv.getUint16(o + 6, true);
    path.push({ x: dv.getInt16(o, true), y: dv.getInt16(o + 2, true), z: dv.getInt16(o + 4, true), cum });
  }
  // the running sum has to arrive at the total the header states, or these are
  // not the waypoints we think they are
  return cum === dv.getUint32(0, true) ? path : undefined;
}

/**
 * Build one type-3 walk's waypoint payload — {@link decodeWalkPath} backwards.
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
 * Decode the active walk slots (see {@link SavedWalk}).
 *
 * `payloads` are the containers that follow the walks table, which the writer
 * appends one per active slot carrying a route — in SLOT ORDER, which is what
 * lets them be matched up positionally.
 */
function decodeWalks(d: Uint8Array, payloads: Uint8Array[]): SavedWalk[] {
  const dv = new DataView(d.buffer, d.byteOffset, d.byteLength);
  const out: SavedWalk[] = [];
  for (let s = 0; s + 110 <= d.length; s += 110) {
    if (dv.getUint16(s + WALK_SLOT.active, true) === 0) continue;
    const actor = pstrField(d, s + WALK_SLOT.actor);
    if (!actor) continue;
    const type = dv.getInt16(s + WALK_SLOT.type, true);
    const path =
      dv.getUint32(s + WALK_SLOT.payload, true) !== 0
        ? decodeWalkPath(payloads.shift() ?? new Uint8Array())
        : undefined;
    const startX = dv.getInt16(s + WALK_SLOT.x, true);
    const startY = dv.getInt16(s + WALK_SLOT.y, true);
    const startZ = dv.getInt16(s + WALK_SLOT.z, true);
    // ONLY the straight-line mover writes the movement words. A turn has no
    // mover at all, and a route keeps its total length in its own payload
    // container — both leave whatever the slot held last, which is how `hack`'s
    // route comes to claim a distance of -1422655421 (see {@link SavedWalk})
    const moves = type === 1;
    let dist = 0;
    if (path) dist = path.at(-1)!.cum;
    else if (moves) dist = dv.getInt32(s + WALK_SLOT.dist, true);
    out.push({
      actor: actor.toLowerCase(),
      type,
      hasPayload: dv.getUint32(s + WALK_SLOT.payload, true) !== 0,
      paused: dv.getUint16(s + WALK_SLOT.paused, true) !== 0,
      turnTo: dv.getInt16(s + WALK_SLOT.turnTo, true),
      deg: dv.getInt16(s + WALK_SLOT.deg, true),
      startX, startY, startZ,
      destX: moves ? startX - dv.getInt32(s + WALK_SLOT.dx, true) : startX,
      destY: moves ? startY - dv.getInt32(s + WALK_SLOT.dy, true) : startY,
      destZ: moves ? startZ - dv.getInt32(s + WALK_SLOT.dz, true) : startZ,
      // a route's progress IS written (it is the one movement word the path
      // mover keeps in the record); its length comes from the payload header
      progress: moves || path ? dv.getInt32(s + WALK_SLOT.progress, true) : 0,
      dist,
      star: pstrField(d, s + WALK_SLOT.star) ?? "",
      path,
    });
  }
  return out;
}

/**
 * Every open audio bank, in the order the list holds them.
 *
 * Not the same question as {@link decodeTheme}: that one asks which bank was
 * SOUNDING, and a bank can be open with nothing playing out of it and still be
 * the one a restored loop reaches for. The sinking's ambience is exactly that —
 * `insddest.sfx` is open in the mission-4 saves with all three of its arrays
 * empty, because BOOTFILE's `playcrickets` opens the bank once and then picks a
 * random one-shot out of it on every tick (#199).
 */
function decodeTrackFiles(raw: RawSaveFile, tracksIndex: number): string[] {
  if (tracksIndex < 0) return [];
  const d = raw.containers[tracksIndex].data;
  const files = manifestByHandle(raw);
  const out: string[] = [];
  for (let k = 0; k < d.length / TRACK_STRIDE; k++) {
    const name = recordFile(d, k * TRACK_STRIDE, TRACK_NAME_OFF, files);
    if (name) out.push(name);
  }
  return out;
}

/**
 * The playing theme, from the track whose playing/looping arrays are non-empty.
 * One track carries them in 107 of the 109 shipped saves, and it is always the
 * room's live theme — `savetheme`, the global, is NOT it: that records the
 * theme to restore after an interlude and lags the file by up to a whole act in
 * 91 of the 109. The two exceptions are the London-flat saves, where TWO tracks
 * are live: bedrad1.trk's 15 radio-programme chunks (the audible score, and the
 * one BEDSIT1.SET's hotspot gate demands — #36) and bedsit1.trk's 5 armed
 * plane/bomb loops, waiting for the bombing. So the score is the live track
 * with the MOST live records, and any other live track's sounds are counted as
 * `extras` (reported by the loader, not restored — the room's own scripts
 * re-arm them). The port scores a room at track granularity, which is also why
 * a multi-chunk theme (decka.trk loops 11 ambience chunks at once) is one
 * restore, not eleven.
 */
function decodeTheme(raw: RawSaveFile, tracksIndex: number): SavedTheme | null {
  if (tracksIndex < 0) return null;
  const d = raw.containers[tracksIndex].data;
  const live: { track: string; volume: number; count: number; names: Set<string> }[] = [];
  for (let k = 0; k < d.length / TRACK_STRIDE; k++) {
    const track = pstrField(d, k * TRACK_STRIDE + TRACK_NAME_OFF).toLowerCase();
    const names = new Set<string>();
    let volume = 255;
    let count = 0;
    for (const j of [1, 2]) {
      const arr = raw.containers[tracksIndex + 1 + 3 * k + j].data;
      const dv = new DataView(arr.buffer, arr.byteOffset, arr.byteLength);
      for (let s = 0; s + SOUND_STRIDE <= arr.length; s += SOUND_STRIDE) {
        if (!count) volume = dv.getUint16(s + 4, true);
        count++;
        names.add(pstrField(arr, s + 8).toLowerCase());
      }
    }
    if (count) live.push({ track, volume, count, names });
  }
  if (!live.length) return null;
  // the score is the busiest live track; a later track wins a tie (it was
  // opened later, i.e. it is the room's own)
  let best = live[0];
  for (const t of live) if (t.count >= best.count) best = t;
  let extras = 0;
  for (const t of live) if (t !== best) extras += t.names.size;
  return { track: best.track, volume: best.volume, extras };
}

/** Hall/deck set → the deck-plan page it sits on (MAP.STG currentpage cases).
 * Used only as a sane fallback for the staircase deck selector on load. */
const HALL_DECK: Record<string, string> = {
  halla: "a",
  hallb: "b",
  hallc: "c",
  halld: "d",
  hallf2c: "f",
  hallf3c: "f",
  decka: "a",
  deckbd: "bd",
  deckbd2: "bd",
};

export function parseSave(bytes: Uint8Array): SaveGame {
  const raw = readSaveFile(bytes);
  // container 0: title (@0) + disk family (@256).
  const title = new BinaryReader(raw.containers[0].data).pstr();
  const disk = pstrField(raw.containers[0].data, 256);

  // container 1: current stage / set / scene / view at fixed offsets.
  const c1 = raw.containers[1].data;
  const stage = pstrField(c1, C1_STAGE);
  const set = pstrField(c1, C1_SET);
  const scene = pstrField(c1, C1_SCENE);
  const view = pstrField(c1, C1_VIEW);
  const frame =
    c1.length >= C1_FRAME + 4
      ? new DataView(c1.buffer, c1.byteOffset, c1.byteLength).getUint32(C1_FRAME, true)
      : 0;

  const index = saveIndex(raw);

  // the string pool is the container right after the globals container — the
  // original loader reads them as a pair (pool handle stored at blob+0x10).
  const vars = decodeVars(raw.containers[index.globals].data, raw.containers[index.pool].data);
  const inventory = walkPropGrid(raw.containers[index.inventory].data).map((r) => r.prop);
  const actors = walkActorGrid(raw.containers[index.actors].data).map((r) => r.actor);

  // which cast files were open — the crowd is instanced from them, and a load
  // runs no openset to reopen them (#186).
  const castFiles = decodeCastFiles(raw, index.casts);

  // the scheduler tables (loops/crickets/walks) and the open-track sound state —
  // what a load restores instead of re-running the room's openset (#143).
  const loops = decodeLoops(raw.containers[index.loops].data);
  const crickets = decodeCrickets(raw.containers[index.crickets].data);
  // the walks table, and the waypoint payloads that follow it — one per active
  // slot with a route, in slot order (see decodeWalks)
  const walks = decodeWalks(
    raw.containers[index.walks].data,
    raw.containers.slice(index.walks + 1).map((c) => c.data),
  );
  const trackFiles = decodeTrackFiles(raw, index.tracks);
  const theme = decodeTheme(raw, index.tracks);

  // Split the decoded variables by DFValue type: 2/4 = numbers (inline), 3 =
  // strings (decoded via the pool). First-wins on duplicate names — the engine's
  // lookup walks the list from the head. See docs/engine/formats/savegame.md.
  const numGlobals = new Map<string, number>();
  const strGlobals = new Map<string, string>();
  for (const v of vars) {
    if (v.type === DFVALUE_STRING) {
      if (v.str !== null && !strGlobals.has(v.name)) strGlobals.set(v.name, v.str);
    } else if (!numGlobals.has(v.name)) numGlobals.set(v.name, v.num);
  }

  // hallside ("port"/"star") decodes from its variable record, and only from it.
  // A pool-scanning fallback stood here for a long time, resting on a container
  // that does not exist: the "location savestate stack" it walked was the string
  // POOL (the heuristic locked onto it in 109 of 109 shipped saves — the pool
  // holds the same facing/side/coordinate strings, in allocation order). And it
  // never fired with a value: exactly 4 shipped saves lack the record, all
  // pre-boarding (bedsit1/c73), and none of their pools hold a side token,
  // because no hallway had ever been entered. An unset hallside is what a fresh
  // game has until the first hall assigns one.
  const hallside = strGlobals.get("hallside") ?? "";

  // savedeck (the staircase deck-plan selector, "a".."g"/"bd") likewise; the
  // fallback derives it from the current hall/deck set when unambiguous.
  const savedeck = strGlobals.get("savedeck") ?? HALL_DECK[set.toLowerCase()] ?? "";

  // clock, as text, for a caller that only wants to read it. The restore path
  // does NOT use this: clock rides numGlobals/strGlobals like every other
  // variable, so a mission-4 save puts back the NUMBER calctime left there.
  const clock = strGlobals.get("clock") ?? (numGlobals.has("clock") ? String(numGlobals.get("clock")) : "");

  return {
    title, disk, set, scene, view, stage, frame, clock, hallside, savedeck,
    vars, numGlobals, strGlobals, inventory, actors, castFiles, trackFiles,
    loops, crickets, walks, theme, raw, index,
  };
}

// ---------------------------------------------------------------------------
// High-level write (patch a base save with the current progress)
// ---------------------------------------------------------------------------

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
 * The container-0 manifest, as the loader reads it: the records' old handles and
 * the BASENAME each path ends in — `0x4152e0` finds a record by handle
 * (`0x4153f0`), strips its path to the last ":" (`0x42bc20`) and opens that.
 */
function manifestFiles(c0: Uint8Array): { handle: number; file: string; path: string }[] {
  const dv = new DataView(c0.buffer, c0.byteOffset, c0.byteLength);
  const out: { handle: number; file: string; path: string }[] = [];
  const n = c0.length >= C0_FILE_RECORDS ? dv.getInt32(C0_FILE_COUNT, true) : 0;
  for (let i = 0; i < n; i++) {
    const o = C0_FILE_RECORDS + i * C0_FILE_STRIDE;
    if (o + C0_FILE_STRIDE > c0.length) break;
    const path = pstrAtChecked(c0, o + 4, 0, 255) ?? "";
    out.push({ handle: dv.getUint32(o, true), file: path.slice(path.lastIndexOf(":") + 1).toLowerCase(), path });
  }
  return out;
}

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
