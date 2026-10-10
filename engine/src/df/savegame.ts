import { BinaryReader, latin1 } from "./binary";
// The variable list and its string pool — shared with the v1 (Dust) reader,
// because that half of the format never changed. See `save-vars.ts`.
import { SavedVar, freeVarSlots } from "./save-vars";
// re-exported: they were this module's own API before the split, and both are
// part of what a caller reads a save for
export type { SavedVar };
export { freeVarSlots };
import { Container, HEADER_SIZE, readContainerAt } from "./container";
import {
  PROP_FIELDS,
  ACTOR_VALUE_OFF,
  LOOPS_SIZE,
  CRICKETS_SIZE,
  WALKS_SIZE,
  TRACK_STRIDE,
  TRACK_COUNTS,
  SOUND_STRIDE,
} from "./savegame-layout";
export { parseSave } from "./savegame-read";
import type { SavePatch } from "./savegame-patch";
export type { SavePatch };
export { applyPatch, globalsCapacity } from "./savegame-patch";

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
 * documented; probes would run a second time inside
 * {@link import("./savegame-patch").applyPatch}, so a
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
