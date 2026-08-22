import { BinaryReader } from "./binary";
import { DFContainerFile } from "./container";
import { versionOf } from "./version";
import { readSndFileFrom, sndLoopChunks } from "./snd";

/**
 * Shared audio-bank chunk tables. TRK/SFX/11K banks (audio.ts) and MOV
 * soundtracks (mov.ts) store their chunk tables in the same on-disk layout;
 * these readers are the one implementation both use.
 *
 * The write half — {@link patchTrackName}, {@link patchLoopOrder},
 * {@link patchChunkIdentifier} — is what the track editor (editors/tracks.html) edits
 * a bank through. Every patch is copy-on-write on one container and touches
 * only its own field.
 */
export interface BankChunk {
  identifier: string;
  containerLoc: number;
  /**
   * Offset of this record's identifier field (its Pascal length byte) inside
   * the table container it was read from — the anchor
   * {@link patchChunkIdentifier} renames it at.
   */
  idOffset: number;
  /**
   * The record's SECOND name field, read only when the caller asks for one —
   * a MOV one-shot record carries the frame its sound carries the picture on to
   * (see MovSegment.soundFollows). "" when absent or not asked for.
   */
  follow: string;
}

/** identifier field width of a chunk record — the same 15 in TRK and in MOV */
export const CHUNK_ID_FIELD = 15;
/** the loop table's play-order field is a fixed 260 bytes: 130 i16 slots */
export const LOOP_ORDER_MAX = 130;
const LOOP_ORDER_AT = 6;
const LOOP_COUNT_AT = 4;
const LOOP_RECORDS_AT = LOOP_ORDER_AT + LOOP_ORDER_MAX * 2 + 4;
/** the shortest loop table that can hold a count and its (fixed-size) order */
const LOOP_TABLE_MIN = LOOP_RECORDS_AT;
/** container 0 fields: the one-shot table's location, then the bank's name */
const BANK_CHUNKINFO2_AT = 32;
const BANK_NAME_AT = 36;
/** a name field's cap, matching the other 31-char name fields of the formats */
const BANK_NAME_MAX = 31;

/**
 * The looping-music chunk table (container 1 of a bank / MOV soundtrack): a
 * fixed-size order list of 1-based indices, then the chunk records — {i32
 * unknown, i16 container loc, i16 pad, i16 bool+pad, char[16] id}.
 */
export interface LoopTable {
  /** 1-based indices into `records`, in playback order */
  order: number[];
  /** the chunk records in file order */
  records: BankChunk[];
}

export function readLoopTable(data: Uint8Array): LoopTable {
  if (data.length < LOOP_TABLE_MIN) return { order: [], records: [] };
  const r = new BinaryReader(data);
  r.seek(LOOP_COUNT_AT);
  const totalLoops = r.i16();
  const order: number[] = [];
  for (let i = 0; i < Math.min(totalLoops, LOOP_ORDER_MAX); i++) order.push(r.i16());
  r.seek(LOOP_RECORDS_AT - 4);

  const records: BankChunk[] = [];
  const loopCount = r.i16();
  if (loopCount > 0) {
    r.seek(LOOP_RECORDS_AT);
    for (let i = 0; i < loopCount; i++) {
      r.skip(4); // unknown int
      const containerLoc = r.i16();
      r.skip(2);
      r.skip(2); // bool + pad
      const idOffset = r.pos;
      const identifier = r.pstr(CHUNK_ID_FIELD);
      records.push({ identifier, containerLoc, idOffset, follow: "" });
    }
  }
  return { order, records };
}

/** the loop chunks already reordered into playback order (missing ones dropped) */
export function readLoopChunks(data: Uint8Array): BankChunk[] {
  const { order, records } = readLoopTable(data);
  return order.map((o) => records[o - 1]).filter((x): x is BankChunk => x !== undefined);
}

/**
 * The one-shot chunk table (the non-looping block): {i32 count} then `count`
 * records of {i32 unknown, i32 container loc, i16 bool+pad, char[16] id} —
 * 26 bytes in a TRK/SFX bank. A MOV record is 42, the extra 16 being a second
 * name field (`followFieldSize`, {@link BankChunk.follow}) that TI.EXE reads at
 * record +0x1a. Records are returned in file order; callers key/filter them as
 * needed.
 */
export function readOneShotChunks(
  data: Uint8Array,
  idFieldSize: number,
  followFieldSize = 0,
): BankChunk[] {
  const r = new BinaryReader(data);
  r.skip(4);
  const count = r.i16();
  r.seek(8);
  const out: BankChunk[] = [];
  for (let i = 0; i < count; i++) {
    r.skip(4); // unknown int
    const containerLoc = r.i32();
    r.skip(2); // bool + pad
    const idOffset = r.pos;
    const identifier = r.pstr(idFieldSize);
    const follow = followFieldSize ? r.pstr(followFieldSize) : "";
    out.push({ identifier, containerLoc, idOffset, follow });
  }
  return out;
}

/**
 * Both chunk tables of a TRK/SFX/11K bank as they are STORED — the loop order
 * kept apart from the records it indexes, identifiers unstripped. This is the
 * editor's view of a bank; {@link readAudioBank} is the runtime's, which only
 * wants playable chunks.
 *
 * Container 0: one-shot table location @32, track name (Pascal) @36.
 * Container 1: the loop table. Banks that carry no music (most .SFX) have an
 * empty or absent one.
 */
export interface BankTables {
  /** the stored name, which on shipped banks usually still carries ".WAV" */
  trackName: string;
  /** characters {@link patchTrackName} may write without leaving the field */
  trackNameLimit: number;
  /** container holding the loop table, 0 when the file has none */
  loopTable: number;
  /** container holding the one-shot table, 0 when the file has none */
  oneShotTable: number;
  /** 1-based indices into `loopRecords`, in playback order */
  loopOrder: number[];
  loopRecords: BankChunk[];
  singles: BankChunk[];
}

export function readBankTables(file: DFContainerFile): BankTables {
  const c0 = file.containers[0].data;
  const v0 = new DataView(c0.buffer, c0.byteOffset, c0.byteLength);
  const chunkInfo2Loc = v0.getInt32(BANK_CHUNKINFO2_AT, true);
  const trackName = new BinaryReader(c0, BANK_NAME_AT).pstr();

  const hasLoops = file.containers.length > 1 && file.containers[1].data.length >= LOOP_TABLE_MIN;
  const { order, records } = hasLoops
    ? readLoopTable(file.containers[1].data)
    : { order: [], records: [] };

  const oneShotTable =
    chunkInfo2Loc > 0 && chunkInfo2Loc < file.containers.length ? chunkInfo2Loc : 0;

  return {
    trackName,
    trackNameLimit: nameFieldLimit(c0, BANK_NAME_AT),
    loopTable: hasLoops ? 1 : 0,
    oneShotTable,
    loopOrder: order,
    loopRecords: records,
    singles: oneShotTable
      ? readOneShotChunks(file.containers[oneShotTable].data, CHUNK_ID_FIELD)
      : [],
  };
}

/**
 * How long a name at `off` may grow. What follows the track-name field in
 * container 0 isn't known, so the writer stays inside what the field already
 * proves is its own: the stored characters plus the zero padding after them,
 * capped at the 31 the format's other name fields use. Shipped names are short
 * ("BEDRAD1.WAV"), so this leaves room in practice while never writing over a
 * byte that carried information.
 */
function nameFieldLimit(d: Uint8Array, off: number): number {
  const len = d[off] ?? 0;
  let pad = 0;
  while (off + 1 + len + pad < d.length && d[off + 1 + len + pad] === 0) pad++;
  return Math.min(BANK_NAME_MAX, len + pad);
}

export interface AudioBank {
  trackName: string;
  /** looping music chunks, already in playback order */
  loopChunks: number[];
  /** one-shot sounds by lowercase identifier */
  singles: Map<string, BankChunk>;
}

/**
 * Read the audio bank tables of a TRK/SFX/11K file (non-MOV layout) the way
 * the runtime wants them: the loop chunks resolved to container locations in
 * playback order, and the one-shots keyed by the name a script asks for.
 *
 * Dust spells the same thing `.SND` and stores it differently — see
 * {@link file://./snd.ts} — so a v1 bank is routed there and reshaped into the
 * same three fields. Everything above this call keeps working unchanged, which is
 * the point of doing it here: `opentrackfile("unilib.snd")` and
 * `opentrackfile("unilib.trk")` are the same builtin and should be the same code
 * path from here up.
 *
 * A v1 bank has no loop ORDER table, and the order is what a loop bed IS — but it
 * is not missing, it is spelled in the names, so `sndLoopChunks` reads it (see
 * {@link file://./snd.ts}). That is what gives Dust its music.
 */
export function readAudioBank(file: DFContainerFile): AudioBank {
  if (versionOf(file.containers[0].data) === 1) return readV1Bank(file);
  const tables = readBankTables(file);
  const loopChunks = tables.loopOrder
    .map((o) => tables.loopRecords[o - 1])
    .filter((c): c is BankChunk => c !== undefined)
    .map((c) => c.containerLoc);

  const singles = new Map<string, BankChunk>();
  for (const chunk of tables.singles) {
    // identifiers sometimes carry a subfolder prefix — strip it
    singles.set(chunk.identifier.replace(/^.*\//, "").toLowerCase(), chunk);
  }

  return { trackName: tables.trackName.replace(/\.wav$/i, ""), loopChunks, singles };
}

/** a Dust `.SND` in the shape the runtime already knows */
function readV1Bank(file: DFContainerFile): AudioBank {
  const snd = readSndFileFrom(file);
  const singles = new Map<string, BankChunk>();
  for (const chunk of snd.chunks) {
    singles.set(chunk.identifier.replace(/^.*\//, "").toLowerCase(), chunk);
  }
  // VERBATIM, extension and all — a v4 bank stores "BEDRAD1.WAV" and is asked for
  // as `playnewtheme("bedrad1.trk")`, so stripping is right there. A v1 bank is
  // asked for by exactly the name it stores: Dust's eight playtheme targets are
  // `town.snd`, `bountytheme`, `saloonsep.snd`, `mission.snd`, `mine`,
  // `isaopractice.sn`, `helptheme` and `flute`, and each is some bank's refName
  // character for character. Stripping ".snd" made three of the eight unfindable,
  // among them the town theme — the one piece of music the game opens with.
  return { trackName: snd.refName, loopChunks: sndLoopChunks(snd), singles };
}

// --- the write half ---------------------------------------------------------

/** what a latin1 name field can hold: anything else becomes "?" */
const printable = (s: string): string => s.replace(/[^\u0020-\u00ff]/g, "?");

/** replace one container, leaving every other byte of the file alone */
function patchContainer(file: DFContainerFile, loc: number, edit: (d: Uint8Array) => void): void {
  const old = file.containers[loc];
  const data = old.data.slice();
  edit(data);
  file.containers[loc] = { id: old.id, data };
}

/**
 * Rename the bank's track. Writes only the characters it needs plus the ones
 * it is clearing, so nothing past the name field is touched even if the field
 * is shorter than {@link BankTables.trackNameLimit} guesses; the name is
 * clamped to that limit. Returns the name as stored.
 */
export function patchTrackName(file: DFContainerFile, name: string): string {
  const limit = nameFieldLimit(file.containers[0].data, BANK_NAME_AT);
  const s = printable(name.slice(0, limit));
  patchContainer(file, 0, (d) => {
    const was = d[BANK_NAME_AT] ?? 0;
    d[BANK_NAME_AT] = s.length;
    for (let i = 0; i < Math.max(was, s.length); i++) {
      d[BANK_NAME_AT + 1 + i] = i < s.length ? s.charCodeAt(i) : 0;
    }
  });
  return s;
}

/**
 * Rewrite the loop table's playback order — the musical edit: reorder the
 * chunks a theme is made of, repeat one, or drop it. `order` holds 1-based
 * record indices; out-of-range entries are dropped and the list is clamped to
 * the field's {@link LOOP_ORDER_MAX} slots. Returns the order as stored.
 */
export function patchLoopOrder(file: DFContainerFile, order: number[]): number[] {
  const tables = readBankTables(file);
  if (!tables.loopTable) return [];
  const kept = order
    .filter((o) => Number.isInteger(o) && o >= 1 && o <= tables.loopRecords.length)
    .slice(0, LOOP_ORDER_MAX);
  patchContainer(file, tables.loopTable, (d) => {
    const v = new DataView(d.buffer, d.byteOffset, d.byteLength);
    v.setInt16(LOOP_COUNT_AT, kept.length, true);
    for (let i = 0; i < LOOP_ORDER_MAX; i++) {
      v.setInt16(LOOP_ORDER_AT + i * 2, kept[i] ?? 0, true);
    }
  });
  return kept;
}

/**
 * Rename a chunk — the name a script's `singlesound` asks for. `tableLoc` is
 * the container the record lives in and `idOffset` its identifier field
 * ({@link BankChunk.idOffset}); the field is a fixed 15 characters, so this
 * one is bounded by the format rather than by a guess. Returns what fit.
 */
export function patchChunkIdentifier(
  file: DFContainerFile,
  tableLoc: number,
  idOffset: number,
  identifier: string,
): string {
  const s = printable(identifier.slice(0, CHUNK_ID_FIELD));
  patchContainer(file, tableLoc, (d) => {
    d[idOffset] = s.length;
    for (let i = 0; i < CHUNK_ID_FIELD; i++) {
      d[idOffset + 1 + i] = i < s.length ? s.charCodeAt(i) : 0;
    }
  });
  return s;
}
