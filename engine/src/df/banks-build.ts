/**
 * Building an audio bank (TRK / SFX / 11K) from nothing — the write side of
 * [`banks.ts`](banks.ts)'s reader. See [`build.ts`](build.ts) for why these
 * modules exist.
 *
 * A bank holds two kinds of sound and a name:
 *
 *  - **loop chunks** — a piece of music, cut into chunks with a *play order* that
 *    indexes them 1-based and may repeat one (`1-2-3-2`), which is how the
 *    shipped themes loop a middle section;
 *  - **one-shots** — effects addressed by identifier (`doorlocked`), sometimes
 *    with a subfolder prefix (`sfx/creak`) as the real banks carry.
 *
 * The samples themselves are `encodeAudioContainer` results (the v41 codec); this
 * places them and writes the two tables that name them.
 */
import { DecodedAudio, encodeAudioContainer } from "./audio";
import { ContainerBuilder, i16, i32, pstr } from "./build";
import { ContainerRef, DFContainerFile, writeContainerFile } from "./container";
import { CHUNK_ID_FIELD, LOOP_ORDER_MAX } from "./banks";

/**
 * Container 0. Both table pointers are written, which they always should have
 * been: the reader used to take the loop table's location as a constant 1 and now
 * reads the field at +28 the way every shipped bank fills it in (see
 * `readBankTables`). A file that named only its one-shot table read back with no
 * music at all.
 */
const C0 = { size: 64, loopTable: 28, oneShotTable: 32, name: 36, nameField: 31 } as const;

/** the loop table: the order list, then the chunk records */
const LOOP = { count: 4, order: 6, records: 6 + LOOP_ORDER_MAX * 2 + 4, recordSize: 26, loc: 4, flag: 8, id: 10 } as const;

/** the one-shot table: a count, then the records */
const SINGLE = { count: 4, first: 8, recordSize: 26, loc: 4, flag: 8, id: 10 } as const;

/** what the reader treats as "this record is live" */
const LIVE = 1;

export interface BankBuildChunk {
  /** the name a script asks for (`singlesound("doorlocked")`, ≤15 chars) */
  identifier: string;
  /** the waveform — encoded with the v41 codec as it is placed */
  audio: DecodedAudio;
}

export interface BankBuildOptions {
  /**
   * The stored bank name. Shipped banks usually still carry a ".WAV" extension
   * here; nothing looks a bank up by it (scripts use the FILENAME), so it is a
   * label.
   */
  name?: string;
  /** the music chunks, in stored order */
  loops?: BankBuildChunk[];
  /**
   * Play order over `loops`, **1-based**. Omitted, the stored order is written.
   * Repeats are the point: `[1, 2, 3, 2]` plays the third chunk then returns to
   * the second, which is how a theme loops its middle.
   */
  loopOrder?: number[];
  /** the one-shot effects */
  singles?: BankBuildChunk[];
}

export interface BankBuildResult {
  file: DFContainerFile;
  /** where each chunk's audio landed, by the chunk it came from */
  audioLocs: Map<BankBuildChunk, ContainerRef>;
}

/**
 * Assemble a bank. Containers 0-2 are the header and the two tables even when a
 * bank has only one kind of sound — the reader looks for them there, and a bank
 * with no music still has a loop-table slot.
 */
export function buildBankFile(opts: BankBuildOptions): BankBuildResult {
  const loops = opts.loops ?? [];
  const singles = opts.singles ?? [];
  const order = opts.loopOrder ?? loops.map((_, i) => i + 1);
  if (order.length > LOOP_ORDER_MAX) {
    throw new Error(`bank: play order has ${order.length} entries, the field holds ${LOOP_ORDER_MAX}`);
  }

  const b = new ContainerBuilder();
  const { data: c0 } = b.reserve(C0.size);
  const { loc: loopLoc, data: c1 } = b.reserve(LOOP.records + loops.length * LOOP.recordSize);
  const { loc: singleLoc, data: c2 } = b.reserve(SINGLE.first + singles.length * SINGLE.recordSize);

  i32(c0, C0.loopTable, loopLoc);
  i32(c0, C0.oneShotTable, singleLoc);
  if (opts.name !== undefined) pstr(c0, C0.name, opts.name, C0.nameField);

  const audioLocs = new Map<BankBuildChunk, ContainerRef>();
  const place = (chunk: BankBuildChunk): ContainerRef => {
    const loc = b.add(encodeAudioContainer(chunk.audio));
    audioLocs.set(chunk, loc);
    return loc;
  };
  const loopLocs = loops.map(place);
  const singleLocs = singles.map(place);

  i16(c1, LOOP.count, order.length);
  order.forEach((o, i) => i16(c1, LOOP.order + i * 2, o));
  i32(c1, LOOP.records - 4, loops.length);
  loops.forEach((chunk, i) => {
    const at = LOOP.records + i * LOOP.recordSize;
    // a loop record's location field is an i16 — a bank never has that many
    // containers, and the format spends the other two bytes on padding
    i16(c1, at + LOOP.loc, loopLocs[i]);
    i16(c1, at + LOOP.flag, LIVE);
    pstr(c1, at + LOOP.id, chunk.identifier, CHUNK_ID_FIELD);
  });

  i16(c2, SINGLE.count, singles.length);
  singles.forEach((chunk, i) => {
    const at = SINGLE.first + i * SINGLE.recordSize;
    i32(c2, at + SINGLE.loc, singleLocs[i]);
    i16(c2, at + SINGLE.flag, LIVE);
    pstr(c2, at + SINGLE.id, chunk.identifier, CHUNK_ID_FIELD);
  });

  return { file: b.finish(), audioLocs };
}

/** {@link buildBankFile}, serialized */
export function buildBankBytes(opts: BankBuildOptions): Uint8Array {
  return writeContainerFile(buildBankFile(opts).file);
}
