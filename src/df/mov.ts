import { BinaryReader } from "./binary";
import { DFContainerFile, readContainerFile } from "./container";

/**
 * MOV files — cutscenes, item close-ups, clickable multi-frame objects.
 * Frames use the SET delta codec (decode in order with a shared FrameBuffer).
 *
 * Playback semantics recovered from TI.EXE's movie interaction loop
 * (fn at 0x449310): a movie is a frame state machine. Each frame's
 * click-region container carries a TYPE word plus optional event/target
 * strings; the same type codes drive both frames (auto-action when the frame
 * has no regions) and regions (action on click):
 *   1 = exit the movie
 *   2 = go to the frame named `target`
 *   3 = exit + chain to the movie named `event`
 *   4 = push (this movie, `target` frame) on the return stack, chain to `event`
 *   5 = pop the return stack and resume there (max depth 5 in the original)
 *   6 = advance one frame            7 = step back one frame
 * A frame WITH regions waits modally for a click; clicks outside all regions
 * do nothing. The i16 at record+6 (an "action" flag in earlier guesses) is
 * never read by the engine. Region coords are Y-first (top,left,bottom,right).
 */

export interface MovClickRegion {
  /** action type 1..7 (see module comment) */
  type: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** event sound played on click (page rustle etc.), "" = none */
  sound: string;
  /** movie chained to by types 3/4, "" = none */
  event: string;
  /** frame name jumped to by types 2/4, "" = none */
  target: string;
}

export interface MovFrame {
  /** auto-action type 1..7 applied when the frame has no regions */
  type: number;
  height: number;
  width: number;
  locationFrame: number;
  name: string;
  /** event sound fired when playback enters this frame (faucet on/off) */
  sound: string;
  /** movie chained to by frame types 3/4, "" = none */
  event: string;
  /** frame name jumped to by frame types 2/4, "" = none */
  target: string;
  /** click regions — playback waits on frames that have any */
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
  /** named one-shot chunks (event sounds for click regions), lowercase */
  sounds: Map<string, number>;
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
    r.skip(4); // frame-table kind — authoring metadata, the engine ignores it
    r.skip(4); // 2 unknown words
    const h = r.i16();
    const w = r.i16();
    const locationFrame = r.i32();
    const locationClickRegion = r.i32();
    r.skip(2);
    r.skip(4); // frame container size
    const name = r.pstr(15);

    // the click-region container drives playback: type word at +0, frame
    // event sound at +0x12, event movie at +0x22, target frame name at
    // +0x32, region table at +1090
    let type = 6;
    let sound = "";
    let event = "";
    let target = "";
    const regions: MovClickRegion[] = [];
    const rd = file.containers[locationClickRegion]?.data;
    if (rd && rd.length >= 0x42) {
      const rv = new DataView(rd.buffer, rd.byteOffset, rd.byteLength);
      const pascal = (off: number, max: number): string => {
        const len = rd[off];
        if (len <= 0 || len > max) return "";
        let s = "";
        for (let c = 0; c < len; c++) s += String.fromCharCode(rd[off + 1 + c]);
        return /^[\x20-\x7e]+$/.test(s) ? s : "";
      };
      type = rv.getInt16(0, true);
      sound = pascal(0x12, 15);
      event = pascal(0x22, 15);
      target = pascal(0x32, 15);
      if (rd.length >= 1094) {
        const count = rv.getInt32(1090, true);
        for (let g = 0; g < count && 1094 + g * 64 + 64 <= rd.length; g++) {
          const off = 1094 + g * 64;
          regions.push({
            type: rv.getInt16(off, true),
            y0: rv.getInt16(off + 8, true),
            x0: rv.getInt16(off + 10, true),
            y1: rv.getInt16(off + 12, true),
            x1: rv.getInt16(off + 14, true),
            sound: pascal(off + 16, 15), // event sound (page rustles etc.)
            event: pascal(off + 32, 15), // movie chained to (types 3/4)
            target: pascal(off + 48, 15), // frame jumped to (types 2/4)
          });
        }
      }
    }
    frames.push({ type, height: h, width: w, locationFrame, name, sound, event, target, regions });
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
  // one-shot chunks in the NON-looping block: named event sounds for click
  // regions, or the play-once soundtrack of a plain cutscene. MOV records
  // are 42 bytes with 31-char identifiers.
  const sounds = new Map<string, number>();
  if (audioLocation > 0 && audioLocation < file.containers.length) {
    const b = new BinaryReader(file.containers[audioLocation].data);
    b.skip(4);
    const count = b.i16();
    b.seek(8);
    const order: number[] = [];
    for (let i = 0; i < count; i++) {
      b.skip(4);
      const loc = b.i32();
      b.skip(2);
      const name = b.pstr(31);
      order.push(loc);
      if (name) sounds.set(name.toLowerCase(), loc);
    }
    if (!audioChunks.length) audioChunks.push(...order);
  }

  return { file, width, height, paletteRaw, frames, audioChunks, sounds };
}
