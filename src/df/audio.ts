import { BinaryReader } from "./binary";
import { readLoopChunks, readOneShotChunks } from "./banks";
import { Container, DFContainerFile } from "./container";

/**
 * Audio container decoding — port of DFfile::audioDecoder_v40 / _v41 and
 * the AudioBlockInfos bank structure (dfet DFfile.cpp / DFfile.h).
 *
 * Sound container layout: i32 0x00010000 magic, codec flag i16 @0x1A
 * (1 = v40 8-bit, 2 = v41 16-bit), sample rate i32 @28, uncompressed byte
 * size i32 @36, data start offset i32 @44.
 */

export interface DecodedAudio {
  sampleRate: number;
  /** mono samples in [-1, 1] */
  samples: Float32Array;
}

/** v40 codec step tables (256 entries each), as in the original engine */
const STEP_SIZE = new Int8Array(256);
const INDEX_TAB = new Int8Array(256);
for (let i = 0; i < 256; i++) {
  // step: 16 entries each of 0..7, then -8..-1 (sign-extended nibble of i>>4)
  const hi = i >> 4;
  STEP_SIZE[i] = hi < 8 ? hi : hi - 16;
  // index: repeating 0..7, -8..-1 (sign-extended nibble of i&0xf)
  const lo = i & 0x0f;
  INDEX_TAB[i] = lo < 8 ? lo : lo - 16;
}

export function decodeAudioContainer(container: Container): DecodedAudio {
  const data = container.data;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (view.getInt32(0, true) !== 0x00010000) {
    throw new Error("audio container: bad magic");
  }
  const codec = view.getInt16(0x1a, true);
  const sampleRate = view.getInt32(28, true);
  const byteSize = view.getInt32(36, true);
  const dataStart = view.getInt32(44, true);

  if (codec === 1) {
    return { sampleRate, samples: decodeV40(data, dataStart, byteSize) };
  }
  return { sampleRate, samples: decodeV41(data, dataStart, byteSize) };
}

/** 8-bit codec: literal / step-pair / repeat modes, output centred at 0x40 */
function decodeV40(data: Uint8Array, start: number, byteSize: number): Float32Array {
  const out = new Float32Array(byteSize);
  // decode in int8 space exactly like the original, convert at the end
  const raw = new Int8Array(byteSize + 2); // slack: mode II writes pairs
  let inPos = start;
  let outPos = 0;

  let next = (data[inPos++] << 24) >> 24;
  raw[outPos++] = next + 0x40;
  let prev = next;

  while (outPos < byteSize) {
    next = (data[inPos++] << 24) >> 24;
    if ((next & 0x80) === 0) {
      raw[outPos++] = next + 0x40;
      prev = next;
    } else if ((next & 0x40) === 0) {
      // step-table pairs
      let count = next & 0x3f;
      do {
        const b = data[inPos++];
        const step = (prev + STEP_SIZE[b]) << 24 >> 24;
        const index = (step + INDEX_TAB[b]) << 24 >> 24;
        raw[outPos++] = (step + 0x40) << 24 >> 24;
        raw[outPos++] = (index + 0x40) << 24 >> 24;
        prev = index;
      } while (count--);
    } else {
      // repeat previous
      const count = (next & 0x3f) + 1;
      const v = (prev + 0x40) << 24 >> 24;
      for (let i = 0; i < count; i++) raw[outPos++] = v;
    }
  }
  // raw holds unsigned-8-style values in int8 space: reinterpret as u8, centre 128
  for (let i = 0; i < byteSize; i++) out[i] = ((raw[i] & 0xff) - 128) / 128;
  return out;
}

/** 16-bit codec: high bit selects delta vs absolute, 9-bit shifted */
function decodeV41(data: Uint8Array, start: number, byteSize: number): Float32Array {
  const numSamples = byteSize >> 1;
  const out = new Float32Array(numSamples);
  let current = 0;
  for (let i = 0; i < numSamples; i++) {
    const b = data[start + i];
    if ((b & 0x80) === 0) {
      // delta: sign-extend (b<<9) as i16, then >>4
      const delta = (((b << 9) << 16) >> 16) >> 4;
      current = (current + delta) << 16 >> 16;
    } else {
      current = ((b << 9) << 16) >> 16;
    }
    out[i] = current / 32768;
  }
  return out;
}

// ---------------------------------------------------------------------------

export interface AudioChunkRef {
  identifier: string;
  containerLoc: number;
}

export interface AudioBank {
  trackName: string;
  /** looping music chunks, already in playback order */
  loopChunks: number[];
  /** one-shot sounds by lowercase identifier */
  singles: Map<string, AudioChunkRef>;
}

/**
 * Read the audio bank tables of a TRK/SFX/11K file (non-MOV layout).
 * Container 0: chunk-info-2 location @32, track name pascal @36.
 * Container 1: loop order + loop chunk records; second block holds
 * non-looping one-shot records.
 */
export function readAudioBank(file: DFContainerFile): AudioBank {
  const c0 = file.containers[0].data;
  const v0 = new DataView(c0.buffer, c0.byteOffset, c0.byteLength);
  const chunkInfo2Loc = v0.getInt32(32, true);
  let trackName = new BinaryReader(c0, 36).pstr();
  trackName = trackName.replace(/\.wav$/i, "");

  // looping music chunks (container 1), already in playback order
  const loopChunks = readLoopChunks(file.containers[1].data).map((c) => c.containerLoc);

  const singles = new Map<string, AudioChunkRef>();
  if (chunkInfo2Loc > 0 && chunkInfo2Loc < file.containers.length) {
    for (const chunk of readOneShotChunks(file.containers[chunkInfo2Loc].data, 15)) {
      // identifiers sometimes carry a subfolder prefix — strip it
      const key = chunk.identifier.replace(/^.*\//, "").toLowerCase();
      singles.set(key, chunk);
    }
  }

  return { trackName, loopChunks, singles };
}
