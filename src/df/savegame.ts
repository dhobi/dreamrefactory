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
 * Serialized prop records (the inventory container) sit on a fixed 158-byte grid
 * — the name is at record+0, the current view (propview state) at +48, and the
 * owner (propowner) at +64 — recovered empirically across all shipped saves.
 */
const PROP_STRIDE = 158;
const PROP_VIEW_OFF = 48;
const PROP_OWNER_OFF = 64;

/**
 * Serialized ACTOR records — the cast's persistent state, on its own 160-byte
 * grid in a different container from the props.
 *
 * A DFObject looks the same here whether it is a prop or a character: the name
 * is at record+0 and the owner (`actorowner`) at record+64, exactly as in the
 * prop grid above. Between them a record carries the set the actor is in (+16),
 * sometimes a path or idle-script name (+32), and the current action (+48,
 * "stand"/"walk") — none of which is restored, because a load re-runs the room's
 * own `initactors` and those are what it rebuilds.
 *
 * Recovered from the shipped saves by looking for a state the port was losing:
 * "12 - Sending Telegram for Jack Thayer.ti" holds `purs` at c2+3760 with
 * "sendgram" 64 bytes after it, and `morrow` → "enterwireless", `csea` →
 * "thanks1", `max` → "yofrank" on the same grid. The stride is what separates
 * this container from the prop one — 158 against 160 — since a walk at the wrong
 * stride drifts two bytes per record and fails on the second.
 */
const ACTOR_STRIDE = 160;
const ACTOR_OWNER_OFF = 64;

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
 * A serialized prop's persistent runtime state, from the inventory container.
 * The inventory container serializes every loaded prop (inventory items first);
 * for a load only the `inven.shp` props matter — their `owner` is who holds the
 * item ("frank" = in Frank's possession) and `view` is the propview state
 * ("large" / "panel1" / "panel2" — the inventory slot it sits in).
 */
export interface SavedProp {
  /** prop (inven.shp group) name, lowercased. */
  name: string;
  /** current propview state at record+48 (e.g. "large", "panel1"). */
  view: string;
  /** propowner at record+64 (e.g. "frank", "none", "vlad", "purser"). */
  owner: string;
}

/**
 * Globals never restored from the variable records. `clock` is the head node of
 * the variable list — its name pairs with the blob header instead of a real
 * DFValue (see {@link decodeVars}) — and its string value (the pending
 * clock-event script) is recovered from the location container instead.
 */
export const STRING_GLOBALS = new Set(["clock"]);

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
  /** `actorowner` at record+64 (e.g. "none", "sendgram", "enterwireless"). */
  owner: string;
}

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
  /** clock-event script name from the location container ("startdisk1"…), or "". */
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

/** Decode the prop record at offset `o`, or null if it isn't a valid one. */
function propRecordAt(d: Uint8Array, o: number): SavedProp | null {
  const name = pstrField(d, o);
  if (!isPropName(name)) return null;
  const view = pstrField(d, o + PROP_VIEW_OFF);
  const owner = pstrField(d, o + PROP_OWNER_OFF);
  if (!view || !owner) return null;
  return { name: name.toLowerCase(), view: view.toLowerCase(), owner: owner.toLowerCase() };
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

/** Decode the actor record at offset `o`, or null if it isn't a valid one. */
function actorRecordAt(d: Uint8Array, o: number): SavedActor | null {
  const name = pstrField(d, o);
  if (!isPropName(name)) return null;
  const owner = pstrField(d, o + ACTOR_OWNER_OFF);
  if (!owner) return null;
  return { name: name.toLowerCase(), owner: owner.toLowerCase() };
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

  // clock event: the location stream token that names a script (…disk1 / silence
  // / begins with a lowercase word and isn't a path/coord). Take the token right
  // after the first disk path ("titanicN:").
  let clock = "";
  const diskIdx = location.findIndex((s) => /^titanic\d?:$/i.test(s));
  if (diskIdx >= 0 && diskIdx + 1 < location.length) clock = location[diskIdx + 1];
  // facing: the last direction word in the stream.
  const facing = [...location].reverse().find((s) => DIRS.has(s.toLowerCase())) ?? "";

  // Split the decoded variables by DFValue type: 2/4 = numbers (inline), 3 =
  // strings (decoded via the pool). First-wins on duplicate names — the engine's
  // lookup walks the list from the head. See docs/formats/savegame.md.
  const numGlobals = new Map<string, number>();
  const strGlobals = new Map<string, string>();
  for (const v of vars) {
    if (STRING_GLOBALS.has(v.name)) continue;
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

  return {
    title, disk, set, scene, view, stage, facing, clock, hallside, savedeck,
    vars, numGlobals, strGlobals, location, inventory, actors, raw,
    globalsIndex, locationIndex, inventoryIndex, actorsIndex,
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
   * Captures the player's collected items (each prop's owner + view) — without
   * it, a save would keep the base save's stale inventory.
   */
  inventory?: SavedProp[];
  /**
   * Current `actorowner` per character, written into the actor container. Without
   * it a save keeps the base's — which for a fresh template means every character
   * back at "none", their errands forgotten.
   */
  actors?: SavedActor[];
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
 * Filling a FREE slot needs no such bet. Every shipped save has some (4 in the
 * template, 26 in one of the boiler saves): the array is allocated at `capacity`
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
    for (const [name, off] of offs) if (!writeVar(name, off)) patch.onDrop?.(name, "no pool room");
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
      const offs = new Map(walkPropGrid(d).map((r) => [r.prop.name, r.off]));
      for (const sp of patch.inventory) {
        const off = offs.get(sp.name.toLowerCase());
        if (off === undefined) continue;
        writePstrField(d, off + PROP_VIEW_OFF, sp.view);
        writePstrField(d, off + PROP_OWNER_OFF, sp.owner);
      }
    }
  }

  // actors: the same in-place write, one field per record. Only the owner — the
  // rest of an actor record is where he is standing and what he is doing, which
  // a load rebuilds by running the room's own initactors.
  if (patch.actors?.length) {
    const ai = findActorsIndex(raw, [findInventoryIndex(raw), gi, gi + 1]);
    if (ai >= 0) {
      const d = containers[ai].data;
      const offs = new Map(walkActorGrid(d).map((r) => [r.actor.name, r.off]));
      for (const sa of patch.actors) {
        const off = offs.get(sa.name.toLowerCase());
        if (off === undefined) continue;
        // the field is a length byte + 15 characters, and the longest owner any
        // script assigns is "readhackerclue" at 14 — but a truncated owner would
        // be a DIFFERENT rung of somebody's ladder, so refuse rather than trim
        if (sa.owner.length > 15) {
          patch.onDrop?.(`actorowner(${sa.name})`, `"${sa.owner}" is longer than the record's 15 characters`);
          continue;
        }
        writePstrField(d, off + ACTOR_OWNER_OFF, sa.owner);
      }
    }
  }

  return writeSaveFile(raw);
}
