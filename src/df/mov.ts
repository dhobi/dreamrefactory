import { BinaryReader } from "./binary";
import { DFContainerFile, readContainerFile } from "./container";

/**
 * MOV files — cutscenes, item close-ups, clickable multi-frame objects.
 * Port of DFmov (dfet DFmov.cpp). Frames use the SET delta codec (decode in
 * order with a shared FrameBuffer; `keyframe` marks self-contained frames).
 * Audio uses the common bank layout in its MOV variant: the one-shot chunk
 * table location sits at container0+0x60 and identifiers are 31 chars.
 */

export interface MovClickRegion {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** 0 = cycle to the next pause frame (zoom toggle), 1 = leave the movie */
  action: number;
  /** event sound played on click (page rustle etc.), "" = none */
  sound: string;
}

export interface MovFrame {
  /** frame type: transition frames are 2; other values mark intro/exit */
  kind: number;
  height: number;
  width: number;
  locationFrame: number;
  name: string;
  /** click regions (e.g. the OK button) — playback pauses on such frames */
  regions: MovClickRegion[];
}

export interface MovFile {
  file: DFContainerFile;
  width: number;
  height: number;
  paletteRaw: Uint8Array;
  frames: MovFrame[];
  /** soundtrack chunk container locations, in playback order */
  audioChunks: number[];
}

export function readMovFile(data: Uint8Array): MovFile {
  const file = readContainerFile(data);
  const c0 = file.containers[0].data;
  const r = new BinaryReader(c0);

  r.seek(0x02);
  if (r.i32() !== 4) throw new Error("unsupported DreamFactory MOV version (need 4.0)");

  r.seek(0x60);
  const audioLocation = r.i32();
  const paletteRaw = c0.subarray(0x6c, 0x6c + 256 * 8);

  r.seek(0x870);
  const height = r.i16();
  const width = r.i16();
  r.skip(4);
  const frameCount = r.i32();

  const frames: MovFrame[] = [];
  for (let i = 0; i < frameCount; i++) {
    const kind = r.i32();
    r.skip(4); // 2 unknown words
    const h = r.i16();
    const w = r.i16();
    const locationFrame = r.i32();
    const locationClickRegion = r.i32();
    r.skip(2);
    r.skip(4); // frame container size
    const name = r.pstr(15);

    // frame-logic table: click regions at +1090 (64-byte records, coords
    // stored Y-first like everywhere else in this engine)
    const regions: MovClickRegion[] = [];
    const rd = file.containers[locationClickRegion]?.data;
    if (rd && rd.length >= 1094) {
      const rv = new DataView(rd.buffer, rd.byteOffset, rd.byteLength);
      const count = rv.getInt32(1090, true);
      for (let g = 0; g < count && 1094 + g * 64 + 24 <= rd.length; g++) {
        const off = 1094 + g * 64;
        const action = rv.getInt16(off + 6, true);
        // pascal event-sound name at +16 (page rustles etc.)
        const slen = rd[off + 16];
        let sound = "";
        if (slen > 0 && slen <= 16) {
          for (let c = 0; c < slen; c++) sound += String.fromCharCode(rd[off + 17 + c]);
          if (!/^[\x20-\x7e]+$/.test(sound)) sound = "";
        }
        regions.push({
          y0: rv.getInt16(off + 8, true),
          x0: rv.getInt16(off + 10, true),
          y1: rv.getInt16(off + 12, true),
          x1: rv.getInt16(off + 14, true),
          action,
          sound,
        });
      }
    }
    frames.push({ kind, height: h, width: w, locationFrame, name, regions });
  }

  // soundtrack: loop-chunk table in container 1 (same as TRK banks)
  const audioChunks: number[] = [];
  if (file.containers.length > 1 && file.containers[1].data.length >= 266) {
    const a = new BinaryReader(file.containers[1].data);
    a.skip(4);
    const totalLoops = a.i16();
    const order: number[] = [];
    for (let i = 0; i < totalLoops; i++) order.push(a.i16());
    a.seek(6 + 260);
    const loopCount = a.i16();
    if (loopCount > 0) {
      a.skip(2);
      const records: number[] = [];
      for (let i = 0; i < loopCount; i++) {
        a.skip(4);
        records.push(a.i16());
        a.skip(2);
        a.skip(2);
        a.pstr(15);
      }
      for (const o of order) {
        const loc = records[o - 1];
        if (loc !== undefined) audioChunks.push(loc);
      }
    }
  }
  // cutscene soundtracks are usually in the NON-looping chunk block
  // (they play once); MOV records are 42 bytes with 31-char identifiers
  if (!audioChunks.length && audioLocation > 0 && audioLocation < file.containers.length) {
    const b = new BinaryReader(file.containers[audioLocation].data);
    b.skip(4);
    const count = b.i16();
    b.seek(8);
    for (let i = 0; i < count; i++) {
      b.skip(4);
      audioChunks.push(b.i32());
      b.skip(2);
      b.pstr(31);
    }
  }

  return { file, width, height, paletteRaw, frames, audioChunks };
}
