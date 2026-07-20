import { BinaryReader } from "./binary";
import { Container, DFContainerFile, readContainerFile } from "./container";

/**
 * SHP ("shop") files — prop definitions. Port of DFshp (dfet DFshp.h).
 *
 * A shop holds prop groups; each group is one prop with a script and a set
 * of named states ("views" in propview() terms, e.g. "idleclosed", "open");
 * each state has animation frame containers in the transparent-image codec,
 * which carry their own screen draw position.
 */

export interface PropState {
  identifier: string;
  /** container location of the state's descriptor */
  location: number;
  /** frame container locations (animation frames of this state) */
  frames: number[];
  /** per-frame depth-scale reference (i16 @+42 of each 44-byte frame record,
   *  the same field GANG.CST stores for actors — uniformly 96 in the shipped
   *  shops). world→screen scale is scale×refScale/(1000×depth). */
  refScales: number[];
}

export interface PropGroup {
  name: string;
  location: number;
  scriptContainerLocation: number;
  states: PropState[];
}

export interface ShpFile {
  file: DFContainerFile;
  refName: string;
  mainScriptLocation: number;
  /** raw palette block ({i16 index, i16 rgb[3]} * 256) */
  paletteRaw: Uint8Array;
  groups: PropGroup[];
}

export function readShpFile(data: Uint8Array): ShpFile {
  const file = readContainerFile(data);
  const containers = file.containers;
  const c0 = containers[0].data;
  const r = new BinaryReader(c0);

  r.seek(0x02);
  if (r.i32() !== 4) throw new Error("unsupported DreamFactory SHP version (need 4.0)");

  r.seek(20);
  // Container 0 is always the header, so a stored 0 means "unset" — the main
  // script lives in container 1 by convention (the stage shops wireless/trunk/
  // cargo store 0; house/inven store 1 explicitly).
  const mainScriptLocation = r.i32() || 1;
  const paletteRaw = c0.subarray(36, 36 + 256 * 8);
  r.seek(2344);
  const refName = r.pstr();
  r.seek(2360);
  const groupCount = r.i32();

  const groups: PropGroup[] = [];
  for (let g = 0; g < groupCount; g++) {
    r.seek(2364 + g * 16);
    groups.push(readGroup(r.i32(), containers));
  }
  return { file, refName, mainScriptLocation, paletteRaw, groups };
}

function readGroup(location: number, containers: Container[]): PropGroup {
  const r = new BinaryReader(containers[location].data);
  r.seek(24);
  r.skip(4); // unknown int
  r.skip(5 * 2); // 5 unknown shorts
  const scriptContainerLocation = r.i32();
  const name = r.pstr(47);
  const entryCount = r.i32();

  const states: PropState[] = [];
  for (let e = 0; e < entryCount; e++) {
    const entryLoc = r.i32();
    r.skip(12); // 3 unknown ints
    const identifier = r.pstr(15);
    const ed = containers[entryLoc].data;
    const ev = new DataView(ed.buffer, ed.byteOffset, ed.byteLength);
    const subCount = ev.getInt32(114, true);
    const frames: number[] = [];
    const refScales: number[] = [];
    for (let s = 0; s < subCount; s++) {
      frames.push(ev.getInt32(118 + 44 * s, true));
      refScales.push(ev.getInt16(118 + 44 * s + 42, true) || 96);
    }
    states.push({ identifier, location: entryLoc, frames, refScales });
  }
  return { name, location, scriptContainerLocation, states };
}

export interface ShpFrame {
  width: number;
  height: number;
  /** raw stored position shorts (Y first, X second, center-relative) */
  posYraw: number;
  posXraw: number;
  /** palette indexes, width*height */
  indexed: Uint8Array;
  /** 1 = opaque, 0 = transparent, width*height */
  opaque: Uint8Array;
}

/**
 * Transparent-image codec used by SHP/STG/prop frames.
 * Port of DFfile::writeTransPNGimage, kept palette-independent: props are
 * colorized at composite time with the ACTIVE SET's palette (the engine
 * shares one CLUT — see the clut/mixclut script commands).
 */
export function decodeShpFrame(container: Container): ShpFrame {
  const data = container.data;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const height = view.getInt16(0, true);
  const width = view.getInt16(2, true);
  const posYraw = view.getInt16(4, true);
  const posXraw = view.getInt16(6, true);

  const indexed = new Uint8Array(width * height);
  const opaque = new Uint8Array(width * height);
  let inPos = 8;
  let outPos = 0;

  for (let row = 0; row < height; row++) {
    const segmentSize = view.getInt16(inPos, true);
    inPos += 2;
    const segmentEnd = inPos + segmentSize;
    while (inPos < segmentEnd) {
      const flag = data[inPos++];
      const count = flag >> 2;
      if (flag & 1) {
        if (flag & 2) {
          // literal run: copy `count` palette pixels
          for (let i = 0; i < count; i++) {
            indexed[outPos] = data[inPos++];
            opaque[outPos++] = 1;
          }
        } else {
          // transparent run
          outPos += count;
        }
      } else {
        if (flag & 2) {
          // repeat one palette pixel `count` times
          indexed.fill(data[inPos], outPos, outPos + count);
          opaque.fill(1, outPos, outPos + count);
          outPos += count;
          inPos++;
        } else {
          // copy from previous row
          indexed.copyWithin(outPos, outPos - width, outPos - width + count);
          opaque.copyWithin(outPos, outPos - width, outPos - width + count);
          outPos += count;
        }
      }
    }
  }

  return { width, height, posYraw, posXraw, indexed, opaque };
}
