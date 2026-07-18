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
  const mainScriptLocation = r.i32();
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
    for (let s = 0; s < subCount; s++) {
      frames.push(ev.getInt32(118 + 44 * s, true));
    }
    states.push({ identifier, location: entryLoc, frames });
  }
  return { name, location, scriptContainerLocation, states };
}

export interface ShpFrame {
  width: number;
  height: number;
  /** raw stored position shorts (Y first, X second, center-relative) */
  posYraw: number;
  posXraw: number;
  /** RGBA pixels with transparency */
  rgba: Uint8ClampedArray;
}

/**
 * Transparent-image codec used by SHP/STG/prop frames.
 * Port of DFfile::writeTransPNGimage. Palette color (0xFF,0xFF,0xFF) in the
 * raw table marks pure white handled specially by dfet; here every palette
 * index maps through paletteRGBA and flag-runs become transparent pixels.
 */
export function decodeShpFrame(container: Container, paletteRGBA: Uint8ClampedArray): ShpFrame {
  const data = container.data;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const height = view.getInt16(0, true);
  const width = view.getInt16(2, true);
  const posYraw = view.getInt16(4, true);
  const posXraw = view.getInt16(6, true);

  const rgba = new Uint8ClampedArray(width * height * 4);
  let inPos = 8;
  let outPos = 0;

  const emit = (palIdx: number) => {
    const p = palIdx * 4;
    rgba[outPos++] = paletteRGBA[p];
    rgba[outPos++] = paletteRGBA[p + 1];
    rgba[outPos++] = paletteRGBA[p + 2];
    rgba[outPos++] = 255;
  };

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
          for (let i = 0; i < count; i++) emit(data[inPos++]);
        } else {
          // transparent run
          outPos += count * 4;
        }
      } else {
        if (flag & 2) {
          // repeat one palette pixel `count` times
          for (let i = 0; i < count; i++) emit(data[inPos]);
          inPos++;
        } else {
          // copy from previous row
          rgba.copyWithin(outPos, outPos - width * 4, outPos - width * 4 + count * 4);
          outPos += count * 4;
        }
      }
    }
  }

  return { width, height, posYraw, posXraw, rgba };
}
