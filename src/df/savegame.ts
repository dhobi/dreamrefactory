import { BinaryReader, latin1, pstrAtChecked } from "./binary";
import { Container, HEADER_SIZE, readContainerAt } from "./container";

/**
 * Titanic `.ti` save-game files.
 *
 * A save is a DreamFactory container file (same 1024-byte header + position
 * table skeleton as `container.ts`) but with the signature `ODTRTRFD` at
 * offset 32 (normal game files use `LPPALPPA`) and `fourCC` 0x00010000. The
 * containers are a serialization of the engine's live object graph — see
 * `docs/formats/savegame.md`. Many records embed live process pointers that the
 * original loader rebuilds; we preserve them verbatim for byte-exact round-trip
 * and ignore them on read.
 *
 * This module has two layers:
 *  - low level: `readSaveFile` / `writeSaveFile` — the raw container file, which
 *    round-trips byte-for-byte;
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
/**
 * Serialized prop records (the inventory container) sit on a fixed 158-byte grid.
 * Like the actor record, a prop record is the live struct dumped verbatim with
 * the numeric fields FIRST: the name is at record+0x4e (TI.EXE's own accessors
 * fetch a record into a stack buffer whose name field sits at buffer+0x4e), the
 * current view (propview state) 48 bytes after the name and the owner
 * (propowner) 64 after it. Offsets here are from the NAME, which is what
 * {@link walkPropGrid} locks onto; the numeric half is at negative offsets.
 */
const PROP_STRIDE = 158;
const PROP_VIEW_OFF = 48;
const PROP_OWNER_OFF = 64;
/** the name field's offset inside a prop record (TI.EXE `propvisible` 0x416f30
 *  reads record+0 out of a buffer whose name sits at +0x4e) */
const PROP_RECORD_OFF = -0x4e;
/**
 * The numeric half of the prop record, mapped from TI.EXE's own getters (each
 * fetches the record and reads its field at a fixed offset): `propvisible`
 * +0 (0x416f30), `propxy` +0x14/+0x16 (0x4175c0 — +0x14 is the screen Y and
 * +0x16 the X: the interface band's props all read (324, 256), the band anchor),
 * `propdeg` +0x18 (0x4168a0), `propdist` +0x26 (the open pocketwatch's
 * lid/hrs/min/sec read −6/−5/−5/−4, exactly the z-order its `open()` assigns),
 * `propscale` +0x28 (0x416a90), `propvalue` +0x46 (0x416240), `propzclip`
 * +0x4a (0x4162d0). All verified by range across the 109 shipped saves'
 * 72-record grids. (`propspeed` +0x24 is 4 in every record ever written, and
 * `propis3d` +0x12 is script-derived — neither is worth carrying.)
 */
const PROP_FIELDS = {
  visible: PROP_RECORD_OFF + 0x00,
  y: PROP_RECORD_OFF + 0x14,
  x: PROP_RECORD_OFF + 0x16,
  deg: PROP_RECORD_OFF + 0x18,
  dist: PROP_RECORD_OFF + 0x26,
  scale: PROP_RECORD_OFF + 0x28,
  value: PROP_RECORD_OFF + 0x46,
  zclip: PROP_RECORD_OFF + 0x4a,
} as const;

/**
 * Serialized ACTOR records — the cast's persistent state, on its own 160-byte
 * grid in a different container from the props.
 *
 * **A record is the live runtime struct, dumped verbatim**, and TI.EXE's own
 * accessors give the layout field for field. `0x410d00` is the one that fetches a
 * record by name, and it settles both the stride and the frame:
 *
 *     mov eax, [0x4605dc]           ; record index
 *     lea eax, [eax + eax*4]        ; 5i
 *     shl eax, 5                    ; 160i          <- the stride
 *     lea ecx, [eax + ebx + 0x50]   ; &record[i] + 0x50
 *     push ecx / push edi / call 0x435630            ; compare against the NAME
 *     ...
 *     mov ecx, 0x28 / rep movsd     ; hand the caller all 160 bytes
 *
 * so **the name is at +0x50, not at +0**: the five string fields are the record's
 * SECOND half and the numeric fields are the first. Every accessor then reads its
 * own field out of that 160-byte copy, which is how the rest is mapped — each one
 * takes the buffer at `esp+8` (`actorxyz` at `esp+0x10`) and reads:
 *
 *     +0   i16  actorvisible   (0x40eec0, `cmp word ptr [esp+8], 0` — >0 is visible)
 *     +24  i16  actordeg       (0x40e850, `movsx ecx, word ptr [esp+0x20]`)
 *     +26  i16  actorxyz(1)    (0x40f285) — X
 *     +28  i16  actorxyz(2)    (0x40f297) — Z in the SET's file order
 *     +30  i16  actorxyz(3)    (0x40f2a9) — Y
 *     +38  i16  actorspeed     (0x40ead0, `esp+0x2e`)
 *     +72  i32  actorvalue     (0x410be0, `esp+0x50`)
 *     +76  i16  actorzclip     (0x410c70, `esp+0x54`)
 *     +80  pstr name           +96 set   +112 star   +128 pose   +144 actorowner
 *
 * Checked against all 3465 records of the 109 shipped saves: `visible` is only
 * ever 0 or 1 and no visible record lacks a set; `deg` is 0..255; `speed` is one
 * of {4,5,15,25,30,40,45} and `zclip` one of {-2000…1000, 20000} — in both cases
 * exactly the values the scripts pass to those commands; and for the 2122 records
 * whose star is a real star of their recorded set, (+26,+28,+30) equals that
 * star's position **exactly in 2105 of them (99.2%)**. The 17 that differ are Max
 * mid-patrol on the boat deck and one record parked on the `walktostar` sentinel,
 * i.e. the cases where an actor is genuinely not standing on their star.
 *
 * The offsets below are named against the NAME field, because that is what
 * {@link walkActorGrid} locks the grid onto — a record's own base is 80 bytes
 * earlier ({@link ACTOR_RECORD_OFF}).
 */
const ACTOR_STRIDE = 160;
/** the name field's offset inside a record — the grid is located by it */
const ACTOR_RECORD_OFF = -80;
const ACTOR_OWNER_OFF = 64;
/**
 * `actorvalue` — how many conversations you have had with this character, and
 * the gate on whether they will approach you again.
 *
 * TAOOT's `runpuppet` ends every exchange with `actorvalue(target,
 * actorvalue(target) + 1)`, and each character's idle reads it back:
 * `if actorvalue(me) <= 0 → hasattention(4)`, else `clearattention()`. So a save
 * that drops it reloads with everyone still remembering, and nobody ever walks
 * up to you again for the rest of the session.
 *
 * A DWORD at record+0x48, i.e. **8 bytes BEFORE the name**. This was +152 for a
 * long time, which is `(name + 160) - 8` — the same field one record along, so
 * every character was restored with their neighbour's count. The disassembly had
 * already been read correctly (record+0x48) and then rejected for not fitting a
 * frame based at the name; the 80-byte shift that reconciles the two is the same
 * one that puts "runtime owner at +144" and "saved owner at +64" in agreement.
 *
 * What made the old offset look right is that it produces a plausible series —
 * only it belongs to the next record: 0→1→3→5→8→13→21 over disk 1 is **Penny's**,
 * the character you report to after every errand, and Morrow's own is 0→2→3.
 */
const ACTOR_VALUE_OFF = ACTOR_RECORD_OFF + 0x48;

/**
 * The placement half of the record, all offsets from the NAME — the fields a load
 * needs in order to put the cast back where the player left them rather than
 * re-deriving them from each room's own scripts (#86).
 *
 * `visible` is the one that makes restoring safe at all: without it the only rule
 * available was "place anyone whose recorded set is the set being loaded", which
 * would resurrect everybody who had ever walked through that room, because
 * `putdownactor` hides a character without touching `actorset`.
 */
const ACTOR_PLACEMENT = {
  visible: ACTOR_RECORD_OFF + 0,
  deg: ACTOR_RECORD_OFF + 24,
  x: ACTOR_RECORD_OFF + 26,
  y: ACTOR_RECORD_OFF + 28,
  z: ACTOR_RECORD_OFF + 30,
  speed: ACTOR_RECORD_OFF + 38,
  /**
   * `actorscale` — confirmed three ways: the accessor (0x40ea40 reads
   * `[esp+0x32]` of a buffer at esp+8 → record+42), the value distribution
   * (4–6 round values per actor across the corpus, 1000 neutral), and the
   * per-character clustering (about one scale per room, because `stdscale` is a
   * per-room constant). It is the field that makes a restored character
   * DRAWABLE — a scale of 0 places and gates correctly but never draws — and
   * it carries the two script overrides `stdscale(set)` cannot reproduce
   * (extra.cst 0003's 2700, gang.cst 1323's stoker at 9000).
   */
  scale: ACTOR_RECORD_OFF + 42,
  zclip: ACTOR_RECORD_OFF + 76,
} as const;
/** a world coordinate as the record's i16, clamped rather than wrapped */
function clampI16(n: number): number {
  return Math.max(-32768, Math.min(32767, Math.trunc(n) || 0));
}

/** the three pstr fields between the name and the owner */
const ACTOR_SET_OFF = 16;
const ACTOR_STAR_OFF = 32;
const ACTOR_POSE_OFF = 48;

/**
 * The 32-byte variable-list node of the globals container (see decodeVarSlots
 * for the crucial name/value pairing): [+0/+4 heap ptrs][+8 name: len byte +
 * chars, 12 bytes][+20 DFValue vtable][+24 type u16][+26 value 16-bit].
 */
const NODE_STRIDE = 32;
const NODE_NAME = 8;
const NODE_VTABLE = 20;
const NODE_TYPE = 24;
const NODE_VALUE = 26;
/** DFValue type tags (node +24): 2 and 4 are numbers with the value inline
 *  (signed 16-bit; the engine emits both — our writer tags 4), 3 is a string
 *  whose value is a byte offset into the string-pool container. */
const DFVALUE_STRING = 3;
const DFVALUE_NUMBER_WRITTEN = 4;
/**
 * The globals blob's own header describes the string pool it owns: the u32 at +8
 * is the allocator's next free offset and the u32 at +12 the pool's size (see
 * {@link poolIntern}, which is what makes a written string readable by the
 * ORIGINAL engine and not just by this one). +16 is the pool's heap pointer,
 * rebuilt on load.
 */
const POOL_MARK = 8;
const POOL_SIZE = 12;

/** container 1: current stage/set/scene/view Pascal strings at fixed offsets
 *  (set/scene/view sit on a 16-byte stride) */
const C1_STAGE = 520;
const C1_SET = 596;
const C1_SCENE = 612;
const C1_VIEW = 628;

const roundUp = (n: number, a: number) => Math.ceil(n / a) * a;

/** the raw container file — enough to reproduce the exact bytes. A save is
 *  built from the same {@link Container} records as every other DF file. */
export interface RawSaveFile {
  /** verbatim 1024-byte file header (fourCC, size, signature, …). */
  header: Uint8Array;
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
  return { header, containers };
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
export interface SavedVar {
  name: string;
  /** DFValue type tag: 2/4 = number (value inline), 3 = string (value is a byte
   * offset into the string-pool container that follows the globals container). */
  type: number;
  /** the 16-bit payload: the number itself (type 2/4, signed), or the string's
   * byte offset in the pool (type 3, unsigned). */
  num: number;
  /** the decoded string for type-3 variables (from the pool), else null. Null
   * also when the pool is missing or the offset doesn't decode cleanly. */
  str: string | null;
}

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
  /** `propvisible` — shown right now. */
  visible: boolean;
  /** screen anchor (propxy) — X at name−0x38, Y at name−0x3a. */
  x: number;
  y: number;
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
  Partial<Pick<SavedProp, "view" | "visible" | "x" | "y" | "deg" | "dist" | "scale" | "value" | "zclip">>;

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
/** record kind tag ↔ name, from the `makeloop` builder's 0x4449f0. */
const LOOP_KINDS = ["", "actor", "prop", "scene", "flat"] as const;

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
 * One active walk slot from the walks table (0x48b150, 16 × 110). A walk's
 * waypoint path is a separate payload container the writer appends per active
 * slot with a non-null handle at +0x12 (the loader reads it back into +0x12) —
 * parsed only far enough to say it exists: the port drops mid-flight walks on
 * load (the actor's position is restored; their idle loop re-decides), and says
 * so, rather than resuming a walk whose arrival dispatch is not understood.
 */
export interface SavedWalk {
  actor: string;
  type: number;
  hasPayload: boolean;
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
  /** facing direction word from the location container ("north"…), or "". */
  facing: string;
  /**
   * The pending day event, as text — the head variable's value ("bedsit"…), or
   * the game time as digits once calctime owns it ("1301"). "" if it didn't
   * decode. A convenience read: {@link numGlobals}/{@link strGlobals} carry the
   * same value with its real type, and that is what a load restores.
   */
  clock: string;
  /** hallway facing ("port"/"star") — the last such token in the location
   * container's savestate stack, which is the current side. "" if none (a save
   * outside any hallway; the value is only read inside hall sets). */
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
  /** raw current-location Pascal strings (facing/road/coords/clock/set/stage/flat). */
  location: string[];
  /** every prop serialized in the inventory container (inventory items + more). */
  inventory: SavedProp[];
  /** every actor serialized in the actor container, with its `actorowner`. */
  actors: SavedActor[];
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
  /** index of the globals container within `raw.containers`. */
  globalsIndex: number;
  /** index of the location container within `raw.containers`. */
  locationIndex: number;
  /** index of the inventory (all-props) container within `raw.containers`. */
  inventoryIndex: number;
  /** index of the actor container within `raw.containers`. */
  actorsIndex: number;
  /** index of the loops container (crickets/walks follow it), or -1. */
  schedulerIndex: number;
  /** index of the open-tracks list container (its 3 arrays per track follow), or -1. */
  tracksIndex: number;
}

/** Read a Pascal string at a fixed offset, or "" if it isn't a clean string. */
function pstrField(d: Uint8Array, o: number): string {
  return pstrAtChecked(d, o, 1, 40) ?? "";
}

/** All Pascal strings in a blob (length byte + chars), min 1 char. Used for the
 * string-stream containers (location, open-file manifests). A byte that doesn't
 * start a clean string is skipped. */
function pascalStream(d: Uint8Array): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < d.length) {
    const s = pstrAtChecked(d, i, 1, 255);
    if (s === null) {
      i++;
      continue;
    }
    out.push(s);
    i += 1 + s.length;
  }
  return out;
}

/** Read the Pascal string ([u8 len][chars]) at `off` in the string pool, or
 * null if the offset doesn't decode cleanly. "" (len 0) is a valid value. */
function poolStringAt(pool: Uint8Array, off: number): string | null {
  return pstrAtChecked(pool, off, 0, 255);
}

/** the slot walk shared by {@link decodeVars} and {@link recordOffsets}. */
function decodeVarSlots(d: Uint8Array): { name: string; valueSlot: number }[] {
  const VT = [0x0f, 0x1e, 0x43, 0x00]; // the DFValue vtable 0x00431e0f, little-endian
  // the name field holds 1 length byte + up to 11 chars; names of 12..15 chars
  // spill into the vtable (see vtableAt)
  const nameAt = (slot: number): string | null => pstrAtChecked(d, slot + NODE_NAME, 1, 15);
  const vtableAt = (slot: number): boolean => {
    if (slot + 28 > d.length) return false;
    // a name longer than 11 chars overflows its 12-byte field and clobbers the
    // low vtable bytes (len - 11 of them); skip the clobbered ones
    const skip = Math.max(0, d[slot + NODE_NAME] - 11);
    for (let i = skip; i < 4; i++) if (d[slot + NODE_VTABLE + i] !== VT[i]) return false;
    return true;
  };
  let base = -1;
  for (let o = 0; o + NODE_STRIDE <= d.length; o++) {
    if (nameAt(o) !== null && vtableAt(o)) {
      base = o;
      break;
    }
  }
  if (base < 0) return [];
  const out: { name: string; valueSlot: number }[] = [];
  // The head node's own name pairs one stride BACK, into the blob header — the
  // list is laid out [header][node 0]… and the pairing makes the header the
  // head's DFValue. Its type/value land at header+20/+22, past the pool handle
  // at +0x10, so they are real bytes and not a read off the front of the
  // container. Measured across all 110 shipped saves (TAOOT: the head is
  // `clock`): missions 0-3 read type 3 -> "bedsit", and every mission-4 save
  // reads type 4 -> hrs*100+min, exactly what BOOTFILE's calctime writes there.
  const headName = nameAt(base);
  if (headName !== null && base - NODE_STRIDE + NODE_TYPE >= 0) {
    out.push({ name: headName, valueSlot: base - NODE_STRIDE });
  }
  for (let slot = base + NODE_STRIDE; slot + NODE_STRIDE <= d.length; slot += NODE_STRIDE) {
    const name = nameAt(slot);
    if (name === null || !vtableAt(slot - NODE_STRIDE)) continue;
    out.push({ name, valueSlot: slot - NODE_STRIDE });
  }
  return out;
}

/**
 * Decode the variable list from the globals container (+ its string pool, the
 * container that follows it in the file — TI.EXE's loader reads them as a pair
 * and stores the pool handle at blob+0x10).
 *
 * The blob is a small header followed by 32-byte list nodes. Each node's fields
 * sit at fixed offsets: [+0/+4 heap ptrs][+8 name: len byte + chars][+20 DFValue
 * vtable 0x00431e0f][+24 type u16][+26 value 16-bit]. The crucial subtlety
 * (recovered by decompiling TI.EXE's writer and cross-checking same-session
 * DosBox save pairs): the C++ object is laid out [DFValue][links][name], so the
 * DFValue in node k belongs to the name in node k+1 — a node's name pairs with
 * the PREVIOUS node's value. The first name ("clock", the list head) pairs with
 * the header, which holds no DFValue, so it is not decodable here.
 *
 * Value semantics by type tag: 2 and 4 = a number, inline (signed 16-bit);
 * 3 = a string, the value being its byte offset in the pool ([len][chars]).
 * The pool is a live engine structure saved and restored wholesale, which is
 * why the offsets stay valid across processes.
 *
 * Names up to 15 chars overflow the 12-byte name field and clobber the low
 * bytes of their own node's vtable (a DreamFactory quirk the original engine
 * tolerates); validation skips the clobbered bytes.
 */
function decodeVars(d: Uint8Array, pool?: Uint8Array): SavedVar[] {
  const dv = new DataView(d.buffer, d.byteOffset, d.byteLength);
  const vars: SavedVar[] = [];
  for (const { name, valueSlot } of decodeVarSlots(d)) {
    const type = dv.getUint16(valueSlot + NODE_TYPE, true);
    const num = type === DFVALUE_STRING
      ? dv.getUint16(valueSlot + NODE_VALUE, true)
      : dv.getInt16(valueSlot + NODE_VALUE, true);
    const str = type === DFVALUE_STRING && pool ? poolStringAt(pool, num) : null;
    vars.push({ name, type, num, str });
  }
  return vars;
}

// ---------------------------------------------------------------------------
// Container discovery — HEURISTICS. Which container holds what is not recorded
// anywhere in the file; these locate the interesting ones by their content.
// ---------------------------------------------------------------------------

/** Locate the globals container: the one holding the core progress variables. */
function findGlobalsIndex(raw: RawSaveFile): number {
  for (let i = 0; i < raw.containers.length; i++) {
    const s = latin1(raw.containers[i].data.subarray(0, raw.containers[i].data.length));
    if (s.includes("mission") && s.includes("playerdeath") && s.includes("clock")) return i;
  }
  return -1;
}

/** Locate the current-location container: the clean Pascal-string stream that
 * carries a comma coordinate list and a facing direction word. */
function findLocationIndex(raw: RawSaveFile): number {
  for (let i = 0; i < raw.containers.length; i++) {
    if (raw.containers[i].data.length > 8192) continue;
    const strs = pascalStream(raw.containers[i].data);
    if (strs.some((s) => /^\d+,\d+,/.test(s)) && strs.some((s) => /^(north|south|east|west)$/i.test(s))) {
      return i;
    }
  }
  return -1;
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
    visible: num(PROP_FIELDS.visible) > 0,
    x: num(PROP_FIELDS.x),
    y: num(PROP_FIELDS.y),
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

/** Locate the inventory container: the one with the longest serialized prop grid. */
function findInventoryIndex(raw: RawSaveFile): number {
  let best = -1;
  let bestN = 0;
  for (let i = 0; i < raw.containers.length; i++) {
    const n = walkPropGrid(raw.containers[i].data).length;
    if (n > bestN) {
      bestN = n;
      best = i;
    }
  }
  return bestN >= 10 ? best : -1;
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
 * Locate the actor container: the longest 160-byte actor grid, excluding the
 * containers we have already identified as something else.
 *
 * The exclusions are not tidiness. The GLOBALS container is a grid of 32-byte
 * variable nodes, and 32 divides 160 exactly — so every fifth node sits one
 * actor stride from the last, and a pair of variable names 64 bytes apart reads
 * as a perfectly good name/owner record. Three of the shipped saves
 * (ENDGAME2 09/12/13) prefer it to their real actor container on record count
 * alone, and a patch would then write actor owners over variable names. The prop
 * container cannot collide (158 against 160 drifts two bytes a record and fails
 * on the second) but is excluded on the same principle.
 */
function findActorsIndex(raw: RawSaveFile, exclude: number[]): number {
  let best = -1;
  let bestN = 0;
  for (let i = 0; i < raw.containers.length; i++) {
    if (exclude.includes(i)) continue;
    const n = walkActorGrid(raw.containers[i].data).length;
    if (n > bestN) {
      bestN = n;
      best = i;
    }
  }
  return bestN >= 10 ? best : -1;
}

/** the three master service tables' fixed sizes: 32×42 loops, 16×74 crickets,
 *  16×110 walks. The save writer (0x413910) dumps them verbatim, back to back,
 *  right after the string pool — the triple is the fingerprint. */
const LOOPS_SIZE = 32 * 42;
const CRICKETS_SIZE = 16 * 74;
const WALKS_SIZE = 16 * 110;

/** Locate the loops table: the 1344/1184/1760 container triple (present, in
 * this order, in every shipped save — the writer emits them unconditionally). */
function findSchedulerIndex(raw: RawSaveFile): number {
  for (let i = 0; i + 2 < raw.containers.length; i++) {
    if (
      raw.containers[i].data.length === LOOPS_SIZE &&
      raw.containers[i + 1].data.length === CRICKETS_SIZE &&
      raw.containers[i + 2].data.length === WALKS_SIZE
    ) {
      return i;
    }
  }
  return -1;
}

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

/** Decode the active walk slots (see {@link SavedWalk}). */
function decodeWalks(d: Uint8Array): SavedWalk[] {
  const dv = new DataView(d.buffer, d.byteOffset, d.byteLength);
  const out: SavedWalk[] = [];
  for (let s = 0; s + 110 <= d.length; s += 110) {
    if (dv.getUint16(s, true) === 0) continue;
    const actor = pstrField(d, s + 0x2e);
    if (!actor) continue;
    out.push({
      actor: actor.toLowerCase(),
      type: dv.getUint16(s + 4, true),
      hasPayload: dv.getUint32(s + 0x12, true) !== 0,
    });
  }
  return out;
}

/** a track-list record's name field (pstr at +0x16 of the 40-byte descriptor). */
const TRACK_STRIDE = 40;
const TRACK_NAME_OFF = 0x16;
/** the three per-track array counts (registered / playing / looping). */
const TRACK_COUNTS = [4, 6, 8] as const;
/** one 104-byte sound record: index u16, track# u16, volume u16, pan u16, name pstr@8. */
const SOUND_STRIDE = 104;

/**
 * Locate the open-tracks list: the container of 40-byte descriptors whose names
 * are audio banks and whose three per-descriptor counts match the sizes of the
 * 3×n containers that follow it. Positionally it is container 6 in every
 * shipped save, but the shape is cheap to verify so nothing relies on that.
 */
function findTracksIndex(raw: RawSaveFile): number {
  for (let i = 2; i < raw.containers.length; i++) {
    const d = raw.containers[i].data;
    if (!d.length || d.length % TRACK_STRIDE) continue;
    const n = d.length / TRACK_STRIDE;
    if (i + 3 * n >= raw.containers.length) continue;
    let ok = true;
    for (let k = 0; k < n && ok; k++) {
      const name = pstrField(d, k * TRACK_STRIDE + TRACK_NAME_OFF).toLowerCase();
      if (!/\.(trk|sfx)$/.test(name)) ok = false;
      const dv = new DataView(d.buffer, d.byteOffset, d.byteLength);
      for (const [j, off] of TRACK_COUNTS.entries()) {
        const count = dv.getInt16(k * TRACK_STRIDE + off, true);
        if (raw.containers[i + 1 + 3 * k + j].data.length !== count * SOUND_STRIDE) ok = false;
      }
    }
    if (ok) return i;
  }
  return -1;
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

const DIRS = new Set(["north", "south", "east", "west"]);

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

  const globalsIndex = findGlobalsIndex(raw);
  const locationIndex = findLocationIndex(raw);
  const inventoryIndex = findInventoryIndex(raw);
  // the string pool is the container right after the globals container — the
  // original loader reads them as a pair (pool handle stored at blob+0x10).
  const pool = globalsIndex >= 0 ? raw.containers[globalsIndex + 1]?.data : undefined;
  const vars = globalsIndex >= 0 ? decodeVars(raw.containers[globalsIndex].data, pool) : [];
  const location = locationIndex >= 0 ? pascalStream(raw.containers[locationIndex].data) : [];
  const inventory =
    inventoryIndex >= 0
      ? walkPropGrid(raw.containers[inventoryIndex].data).map((r) => r.prop)
      : [];
  // the pool is globalsIndex + 1 (see above), and it is a string blob a grid can
  // just as easily lock onto
  const actorsIndex = findActorsIndex(raw, [inventoryIndex, globalsIndex, globalsIndex + 1]);
  const actors =
    actorsIndex >= 0 ? walkActorGrid(raw.containers[actorsIndex].data).map((r) => r.actor) : [];

  // the scheduler tables (loops/crickets/walks) and the open-track sound state —
  // what a load restores instead of re-running the room's openset (#143).
  const schedulerIndex = findSchedulerIndex(raw);
  const loops = schedulerIndex >= 0 ? decodeLoops(raw.containers[schedulerIndex].data) : [];
  const crickets = schedulerIndex >= 0 ? decodeCrickets(raw.containers[schedulerIndex + 1].data) : [];
  const walks = schedulerIndex >= 0 ? decodeWalks(raw.containers[schedulerIndex + 2].data) : [];
  const tracksIndex = findTracksIndex(raw);
  const theme = decodeTheme(raw, tracksIndex);

  // facing: the last direction word in the stream.
  const facing = [...location].reverse().find((s) => DIRS.has(s.toLowerCase())) ?? "";

  // Split the decoded variables by DFValue type: 2/4 = numbers (inline), 3 =
  // strings (decoded via the pool). First-wins on duplicate names — the engine's
  // lookup walks the list from the head. See docs/formats/savegame.md.
  const numGlobals = new Map<string, number>();
  const strGlobals = new Map<string, string>();
  for (const v of vars) {
    if (v.type === DFVALUE_STRING) {
      if (v.str !== null && !strGlobals.has(v.name)) strGlobals.set(v.name, v.str);
    } else if (!numGlobals.has(v.name)) numGlobals.set(v.name, v.num);
  }

  // hallside ("port"/"star") decodes from its variable record; fall back to the
  // last side token in the location container's savestate stack (the current
  // side) for a save whose record didn't decode.
  let hallside = strGlobals.get("hallside") ?? "";
  if (!hallside) for (const s of location) if (s === "port" || s === "star") hallside = s;

  // savedeck (the staircase deck-plan selector, "a".."g"/"bd") likewise; the
  // fallback derives it from the current hall/deck set when unambiguous.
  const savedeck = strGlobals.get("savedeck") ?? HALL_DECK[set.toLowerCase()] ?? "";

  // clock, as text, for a caller that only wants to read it. The restore path
  // does NOT use this: clock rides numGlobals/strGlobals like every other
  // variable, so a mission-4 save puts back the NUMBER calctime left there.
  const clock = strGlobals.get("clock") ?? (numGlobals.has("clock") ? String(numGlobals.get("clock")) : "");

  return {
    title, disk, set, scene, view, stage, facing, clock, hallside, savedeck,
    vars, numGlobals, strGlobals, location, inventory, actors,
    loops, crickets, walks, theme, raw,
    globalsIndex, locationIndex, inventoryIndex, actorsIndex,
    schedulerIndex, tracksIndex,
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
   * fixed-size — 32×42 / 16×74 / 16×110 — so this never changes a container's
   * length). The walks table is ZEROED: the port does not serialize mid-flight
   * walks, and an active base slot would otherwise make the original loader read
   * the slot's payload container, which is the previous save's moment. Any base
   * payload containers become unreferenced trailing data, which the loader never
   * reads.
   */
  scheduler?: { loops: SavedLoop[]; crickets: SavedCricket[] };
  /**
   * The playing theme's track file name ("deckbd.trk"), or null for a room
   * scored silent. Written by emptying every track's playing/looping arrays
   * (their descriptor counts and container lengths together, so they stay
   * consistent) and then writing one playing + one looping record into the named
   * track — IF the base has that track open; a theme track the base never opened
   * is reported through {@link onDrop} (the container 0 manifest names the open
   * files, and this writer does not rewrite the manifest).
   */
  theme?: string | null;
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
 * Map of variable name → the slot holding ITS DFValue within the globals
 * container. Because a name pairs with the previous node's value (see
 * {@link decodeVars}), that is the slot before the one carrying the name;
 * type/value live at that offset +24/+26. First occurrence wins (list order).
 */
function recordOffsets(d: Uint8Array): Map<string, number> {
  const out = new Map<string, number>();
  const vars = decodeVarSlots(d);
  for (const { name, valueSlot } of vars) if (!out.has(name)) out.set(name, valueSlot);
  return out;
}


/**
 * Make a variable record for a name the base save has never held, using a FREE
 * slot of its node array, and answer the slot the DFValue goes in — or -1 when
 * there is no room.
 *
 * ## Why a record has to be makeable at all
 *
 * A `.ti` carries the variable list that existed when it was taken, and the
 * engine creates a global on first assignment, so an early save simply has no
 * record for a later one. `savedeck` and `hallside` are the ones that cost
 * something: they are absent from exactly the four pre-boarding saves of the 109
 * shipped, and `shippedSaveTemplate` picks the first file in `save/1`, which is
 * one of them. With that template 12 of the globals the engine holds by mission 2
 * could not be written at all — the deck the staircase shows, the side of the
 * hallway you are on, the map's jump target.
 *
 * ## Why it does not grow anything
 *
 * A save has to load in the ORIGINAL engine, not only in this port, and the blob
 * describes its own storage: `length = 20 + 32 × capacity` for the node array
 * (the u16 at +2), and the pool's size at +12 (see {@link poolIntern}). TI.EXE
 * allocates from those and copies the container in, so a container that has grown
 * past what its own header declares is either truncated on load or overflows the
 * block it is copied into — and neither is something to find out about from a
 * corrupted DosBox session.
 *
 * Filling a FREE slot needs no such bet. Most shipped saves have some (4 spare
 * NODES in the London flat save, 26 in the smokestack one — which is 3 and 13 new
 * *globals*, since the first one made costs two nodes and each after it one; see
 * {@link globalsCapacity}, and note 11 of the 109 have none at all): the array is
 * allocated at `capacity`
 * and the engine takes the next slot when a script assigns a new global — which
 * is precisely the gesture being reproduced here, at the same stride, inside the
 * same block, with the same length in the header. The file stays exactly the shape
 * the original writes.
 *
 * The room this leaves is finite, so the caller has to choose what gets it (see
 * {@link NEW_RECORD_PRIORITY}) and say what it dropped.
 *
 * ## How the slot is written
 *
 * The pairing quirk (see {@link decodeVars}) does the work: a node's name pairs
 * with the PREVIOUS node's DFValue, so the LAST named node's own DFValue belongs
 * to nobody — dangling, and zero in every shipped save. A name written one stride
 * past it adopts that DFValue and leaves its own as the next dangling one, so
 * there is nothing to relink.
 *
 * The u16 at +0 is NOT touched. It reads as a node count in one save (96, against
 * 96 names in 1/01) and cannot be one in the next (92, against the same 96 names
 * in 1/04), so whatever it counts is not the list length and guessing would be
 * inventing a fact.
 */
function newVarRecord(container: { data: Uint8Array }, name: string): number {
  if (!name.length || name.length > 15) return -1;
  const slots = decodeVarSlots(container.data);
  if (!slots.length) return -1;
  // the dangling DFValue sits one stride past the last name's value slot; the new
  // name goes one stride past THAT
  const valueSlot = slots[slots.length - 1].valueSlot + NODE_STRIDE;
  const nameSlot = valueSlot + NODE_STRIDE;
  // the whole node must fit as it stands — no growing, for the reason above. A
  // full stride rather than just the name+vtable, so the NEXT one can pair
  // against this node's DFValue too.
  if (nameSlot + NODE_STRIDE > container.data.length) return -1;
  const d = container.data;
  // The vtable FIRST, then the name over the top of it. That order is the format's
  // own: the name field holds 1 length byte + 11 characters before it runs into the
  // vtable, and a longer name overflows into it — which is why `attentionspan` and
  // `curattention` sit on clobbered vtables in the shipped saves, and why reading
  // one skips the clobbered bytes. Writing the vtable last would win that collision
  // instead and truncate the name, which no real save does.
  for (const [i, b] of [0x0f, 0x1e, 0x43, 0x00].entries()) d[nameSlot + NODE_VTABLE + i] = b;
  d[nameSlot + NODE_NAME] = name.length;
  for (let j = 0; j < name.length; j++) d[nameSlot + NODE_NAME + 1 + j] = name.charCodeAt(j) & 0xff;
  return valueSlot;
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
  let raw: RawSaveFile;
  try {
    raw = bytes instanceof Uint8Array ? readSaveFile(bytes) : bytes;
  } catch {
    return { records: 0, free: 0 };
  }
  const gi = findGlobalsIndex(raw);
  if (gi < 0) return { records: 0, free: 0 };
  const d = raw.containers[gi].data;
  return { records: recordOffsets(d).size, free: freeVarSlots(d) };
}

/**
 * How many more variable records {@link newVarRecord} could make in this globals
 * container — its own rule, counted instead of performed.
 *
 * That rule is: the new name goes two nodes past the last name's DFValue and the
 * whole node has to fit. A record made that way leaves its own DFValue as the next
 * dangling one, so every record after the first advances the frontier by a single
 * node — which is why 4 spare nodes are 3 new globals and not 4.
 */
export function freeVarSlots(d: Uint8Array): number {
  const slots = decodeVarSlots(d);
  if (!slots.length) return 0;
  const frontier = slots[slots.length - 1].valueSlot + 3 * NODE_STRIDE;
  return frontier > d.length ? 0 : Math.floor((d.length - frontier) / NODE_STRIDE) + 1;
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

/** Find the byte offset of Pascal string `s` in the pool below `limit`, or -1. */
function poolFind(pool: Uint8Array, s: string, limit = pool.length): number {
  for (let p = 0; p < limit; ) {
    const n = pool[p];
    if (p + 1 + n > pool.length) return -1;
    if (n === s.length) {
      let eq = true;
      for (let j = 0; j < n; j++) if (pool[p + 1 + j] !== s.charCodeAt(j)) { eq = false; break; }
      if (eq) return p;
    }
    p += 1 + n;
  }
  return -1;
}

/**
 * The pool offset for a string, ALLOCATING it in the pool if the base save has
 * never held it — at the pool allocator's own watermark, inside the block.
 *
 * A string global's value is a `Uint16` offset into the globals' string pool, so
 * a patch can only name strings that are in there. Refusing to add them was a
 * quiet way to lose story state: a save taken after mission 1's Enigma work came
 * back with `zeitclue = 0` instead of "decoder", and PENNY1.PUP's `m1p4()` calls
 * `error()` when it is neither "decoder" nor "mirror" — so the debrief that ends
 * mission 1 could not be held at all. `handitem` and `savedeck` went the same
 * way ("rubaiyat", "boil3").
 *
 * ## The watermark, and why this no longer appends past the end
 *
 * The blob describes the pool it owns: the u32 at **+12 is the pool's size** —
 * 2048 in every one of the 109 shipped saves, and equal to the pool container's
 * length in every one of them — and the u32 at **+8 is the allocator's next free
 * offset**: it is exactly the end of the highest string any variable points at in
 * 81 of the 109, and past it (an allocation whose variable was later overwritten)
 * in the rest. +16 is the pool's heap pointer, which the loader rebuilds.
 *
 * The first version of this appended to the END of the container instead, leaving
 * a pool longer than the size its own header declares. This port reads a string
 * by offset and never notices; TI.EXE allocates +12 bytes and copies the container
 * into it, so an over-long pool is either truncated (the string is lost, silently)
 * or copied past the end of its block. A save has to load in the original engine,
 * so allocating the way the original allocator does — bump the watermark, stay
 * inside the block — is the only version of this that is safe in both. The
 * template has 1930 of its 2048 bytes free, so in practice everything fits.
 *
 * -1 means the string cannot be represented (no room, or longer than a Pascal
 * string), and the caller leaves that global as it found it.
 */
function poolIntern(globals: Uint8Array, pool: { data: Uint8Array }, s: string): number {
  if (s.length > 0xff) return -1;
  const dv = new DataView(globals.buffer, globals.byteOffset, globals.byteLength);
  const capacity = dv.getUint32(POOL_SIZE, true);
  const mark = dv.getUint32(POOL_MARK, true);
  // only trust the watermark on a base whose header describes the pool we have;
  // otherwise fall back to reuse-only, which cannot make the file inconsistent
  const sound = capacity === pool.data.length && mark > 0 && mark <= pool.data.length;
  const found = poolFind(pool.data, s, sound ? mark : pool.data.length);
  if (found >= 0) return found;
  if (!sound) return -1;
  const at = poolFloor(globals, pool.data, mark);
  if (at + 1 + s.length > capacity || at + 1 + s.length > 0xffff) return -1;
  pool.data[at] = s.length;
  for (let j = 0; j < s.length; j++) pool.data[at + 1 + j] = s.charCodeAt(j) & 0xff;
  dv.setUint32(POOL_MARK, at + 1 + s.length, true);
  return at;
}

/**
 * The lowest offset it is safe to allocate at: the allocator's watermark, or past
 * the end of any string a record still points at — whichever is higher.
 *
 * They are usually the same thing, and in the template they are exactly the same
 * (both 118). In 28 of the 109 shipped saves they are not: a record holds a stale
 * offset ABOVE the watermark, in pool space that is still zeroed, so it decodes as
 * the empty string — the blackjack down-cards do this, and `saveeast`. Allocating
 * at the watermark alone would eventually write real bytes under one of those
 * offsets and turn that variable's "" into whatever landed there, in this engine
 * and the original alike. Starting above both means a patch cannot change the value
 * of a global it was never asked to touch.
 */
function poolFloor(globals: Uint8Array, pool: Uint8Array, mark: number): number {
  let end = mark;
  for (const v of decodeVars(globals, pool)) {
    if (v.type === DFVALUE_STRING && v.str !== null) end = Math.max(end, v.num + 1 + v.str.length);
  }
  return end;
}

/**
 * Overwrite a Pascal string in place: length byte + up to 15 characters (the
 * set/scene/view fields in container 1 sit on a 16-byte stride). Bytes past the
 * new string are left as they were — the loader reads only `len` characters, and
 * zeroing them would clobber adjacent meaningful bytes.
 */
function writePstrField(d: Uint8Array, off: number, s: string, max = 15): void {
  const n = Math.min(s.length, max);
  d[off] = n;
  for (let j = 0; j < n; j++) d[off + 1 + j] = s.charCodeAt(j);
}

/**
 * Produce the bytes of a save that carries `patch`'s progress, using `base` as
 * the structural template. The base's containers are copied; the globals-
 * container values and container 1's set/scene/view are overwritten in place.
 */
export function applyPatch(base: RawSaveFile, patch: SavePatch): Uint8Array {
  // deep-copy so we can mutate container data without touching the base.
  const containers: Container[] = base.containers.map((c) => ({ id: c.id, data: c.data.slice() }));
  const raw: RawSaveFile = { header: base.header.slice(), containers };

  // globals: overwrite each variable's DFValue (type at slot+24, value at
  // slot+26 — the slot recordOffsets maps to already accounts for the
  // name/value node pairing). Numbers are written inline and tagged type 4;
  // strings are written as a pool offset (type 3) when the value exists in the
  // base's string pool — see {@link SavePatch.strGlobals}.
  const gi = findGlobalsIndex(raw);
  if (gi >= 0) {
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
        dv.setInt16(off + NODE_VALUE, Math.max(-32768, Math.min(32767, num | 0)), true);
        dv.setUint16(off + NODE_TYPE, DFVALUE_NUMBER_WRITTEN, true);
        return true;
      }
      const str = patch.strGlobals?.get(name);
      if (str === undefined || !containers[gi + 1]) return false;
      const p = poolIntern(containers[gi].data, containers[gi + 1], str);
      if (p < 0) return false;
      const dv = view();
      dv.setUint16(off + NODE_VALUE, p, true);
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
  }

  // container 1: set/scene/view live in 16-byte fields at fixed offsets.
  const c1 = containers[1].data;
  if (c1.length >= C1_VIEW + 16) {
    writePstrField(c1, C1_SET, patch.set);
    writePstrField(c1, C1_SCENE, patch.scene);
    writePstrField(c1, C1_VIEW, patch.view);
  }

  // inventory: overwrite each named prop's view (record+48) and owner (record+64)
  // in place. Both are read at fixed offsets, so writing them as Pascal strings
  // there preserves the 158-byte grid (the value field trailing owner is ignored
  // on read — see docs/formats/savegame.md).
  if (patch.inventory?.length) {
    const ii = findInventoryIndex(raw);
    if (ii >= 0) {
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
        put(PROP_FIELDS.visible, sp.visible === undefined ? undefined : sp.visible ? 1 : 0);
        put(PROP_FIELDS.x, sp.x);
        put(PROP_FIELDS.y, sp.y);
        put(PROP_FIELDS.deg, sp.deg);
        put(PROP_FIELDS.dist, sp.dist);
        put(PROP_FIELDS.scale, sp.scale);
        // propvalue is the record's one u32 (its getter reads a dword)
        put(PROP_FIELDS.value, sp.value, true);
        put(PROP_FIELDS.zclip, sp.zclip);
      }
    }
  }

  // actors: the same in-place write — the memory of the player (owner, conversation
  // count) and, when the caller supplies one, the whole placement half.
  if (patch.actors?.length) {
    const ai = findActorsIndex(raw, [findInventoryIndex(raw), gi, gi + 1]);
    if (ai >= 0) {
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
       * extras), which a load must place from the file now that it no longer
       * re-runs the room's own scripts (#143).
       */
      const append = (): number => {
        const d = containers[ai].data;
        const grid = walkActorGrid(d);
        // the last record ends 80 bytes past its name (name at +0x50 of 160);
        // records are back to back from 0, so that must be the length — refuse
        // a container whose grid doesn't end there (unknown trailing bytes are
        // not ours to bury)
        const end = grid.length ? grid[grid.length - 1].off - ACTOR_RECORD_OFF : 0;
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
        put(off + ACTOR_PLACEMENT.scale, clampI16(p.scale));
        put(off + ACTOR_PLACEMENT.zclip, clampI16(p.zclip));
      }
    }
  }

  // the scheduler: the three fixed-size service tables, written whole.
  if (patch.scheduler) {
    const si = findSchedulerIndex(raw);
    if (si < 0) {
      patch.onDrop?.("scheduler", "the base save has no loops/crickets/walks tables");
    } else {
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
      // walks zeroed — see {@link SavePatch.scheduler}. Any payload containers
      // the base carried become unreferenced tails the loader never reads.
      containers[si + 2].data = new Uint8Array(WALKS_SIZE);
    }
  }

  // the theme: empty every track's playing/looping lists, then mark the named
  // track's as playing. Counts and container lengths move together so the file
  // stays the shape the original writes.
  if (patch.theme !== undefined) {
    const ti = findTracksIndex(raw);
    if (ti < 0) {
      patch.onDrop?.("theme", "the base save has no open-tracks list");
    } else {
      const d = containers[ti].data;
      const dv = new DataView(d.buffer, d.byteOffset, d.byteLength);
      const want = patch.theme?.toLowerCase() ?? null;
      let written = false;
      for (let k = 0; k < d.length / TRACK_STRIDE; k++) {
        const name = pstrField(d, k * TRACK_STRIDE + TRACK_NAME_OFF).toLowerCase();
        for (const [j, cOff] of ([[1, TRACK_COUNTS[1]], [2, TRACK_COUNTS[2]]] as const)) {
          const idx = ti + 1 + 3 * k + j;
          if (name === want) {
            // one playing + one looping record: the port scores at track
            // granularity, so one record naming the track is what its own
            // loader reads back; index 1, this track, full volume, centred.
            const rec = new Uint8Array(SOUND_STRIDE);
            const rdv = new DataView(rec.buffer);
            rdv.setUint16(0, 1, true);
            rdv.setUint16(2, k, true);
            rdv.setUint16(4, 255, true);
            rdv.setUint16(6, 128, true);
            writePstrField(rec, 8, want.replace(/\.(trk|sfx)$/, ""));
            containers[idx].data = rec;
            dv.setInt16(k * TRACK_STRIDE + cOff, 1, true);
            written = true;
          } else {
            containers[idx].data = new Uint8Array(0);
            dv.setInt16(k * TRACK_STRIDE + cOff, 0, true);
          }
        }
      }
      if (want && !written) {
        patch.onDrop?.(`theme(${want})`, "the base save has no such track open — the room will load silent");
      }
    }
  }

  return writeSaveFile(raw);
}
