import { BinaryReader } from "./binary";

/**
 * Shared audio-bank chunk tables. TRK/SFX/11K banks (audio.ts) and MOV
 * soundtracks (mov.ts) store their chunk tables in the same on-disk layout;
 * these readers are the one implementation both use.
 */
export interface BankChunk {
  identifier: string;
  containerLoc: number;
}

/**
 * The looping-music chunk table (container 1 of a bank / MOV soundtrack): a
 * fixed-size order list of 1-based indices, then the chunk records — {i32
 * unknown, i16 container loc, i16 pad, i16 bool+pad, char[16] id}. Returns the
 * records already reordered into playback order (missing indices dropped).
 */
export function readLoopChunks(data: Uint8Array): BankChunk[] {
  const r = new BinaryReader(data);
  r.skip(4);
  const totalLoops = r.i16();
  const order: number[] = [];
  for (let i = 0; i < totalLoops; i++) order.push(r.i16());
  r.seek(6 + 260); // order field is fixed-size

  const records: BankChunk[] = [];
  const loopCount = r.i16();
  if (loopCount > 0) {
    r.skip(2); // rest of the i32 the count sits in (+4 total from count pos)
    for (let i = 0; i < loopCount; i++) {
      r.skip(4); // unknown int
      const containerLoc = r.i16();
      r.skip(2);
      r.skip(2); // bool + pad
      const identifier = r.pstr(15);
      records.push({ identifier, containerLoc });
    }
  }
  return order
    .map((o) => records[o - 1])
    .filter((x): x is BankChunk => x !== undefined);
}

/**
 * The one-shot chunk table (the non-looping block): {i32 count} then `count`
 * records of {i32 unknown, i32 container loc, i16 bool+pad, char[idFieldSize+1]
 * id}. TRK banks use a 15-char id field; MOV soundtracks use 31. Records are
 * returned in file order; callers key/filter them as needed.
 */
export function readOneShotChunks(data: Uint8Array, idFieldSize: number): BankChunk[] {
  const r = new BinaryReader(data);
  r.skip(4);
  const count = r.i16();
  r.seek(8);
  const out: BankChunk[] = [];
  for (let i = 0; i < count; i++) {
    r.skip(4); // unknown int
    const containerLoc = r.i32();
    r.skip(2); // bool + pad
    const identifier = r.pstr(idFieldSize);
    out.push({ identifier, containerLoc });
  }
  return out;
}
