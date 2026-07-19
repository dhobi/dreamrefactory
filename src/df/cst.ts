import { BinaryReader } from "./binary";
import { DFContainerFile, readContainerFile } from "./container";

/**
 * CST ("cast") files — the characters. GANG.CST holds the 25 named story
 * characters, EXTRA.CST the background passengers. Each cast member has a
 * script (setupactor/idle/mousedown live there) and a list of image SETS
 * (poses): "stand"/"standlj"/"walk"..., each holding sprite frames in the
 * SHP transparent codec, 8 view directions per animation step.
 *
 * Layout (validated against GANG.CST):
 *   container 0: palette @36 (256*8), puppet count i32 @0x938,
 *                16-byte records @0x93C -> logic container
 *   logic container: script loc i32 @0x26, name pascal @0x2A,
 *                    set count i32 @0x5A, 32-byte set records @0x5E
 *                    (i32 set container + pascal name @+16)
 *   set container: frame count i32 @0x72, 44-byte records @0x76:
 *                  i32 frame container, i16 direction (0..7) @+10,
 *                  i16 flag @+12, padded size Y-first @+22, offset
 *                  Y-first @+26, depicted angle i16 (dir*0x2000) @+40,
 *                  reference scale i16 @+42
 */

export interface CastFrame {
  location: number;
  direction: number;
  /** depicted facing, 16-bit angle units (dir * 0x2000) */
  angle16: number;
  /** reference scale for depth scaling (like the SHP state header's 180) */
  refScale: number;
}

export interface CastPose {
  name: string;
  location: number;
  /** frames[step][direction] — stand poses have a single step */
  steps: CastFrame[][];
  frameCount: number;
}

export interface CastMember {
  name: string;
  logicLocation: number;
  scriptLocation: number;
  poses: CastPose[];
}

export interface CstFile {
  file: DFContainerFile;
  paletteRaw: Uint8Array;
  members: CastMember[];
}

export function readCstFile(data: Uint8Array): CstFile {
  const file = readContainerFile(data);
  const c0 = file.containers[0].data;
  const r0 = new BinaryReader(c0);
  r0.seek(0x938);
  const count = r0.i32();
  const members: CastMember[] = [];
  for (let i = 0; i < count; i++) {
    r0.seek(0x93c + i * 16);
    const logicLocation = r0.i32();
    const p = file.containers[logicLocation].data;
    const rp = new BinaryReader(p);
    rp.seek(0x26);
    const scriptLocation = rp.i32();
    const name = rp.pstr();
    rp.seek(0x5a);
    const setCount = rp.i32();
    const poses: CastPose[] = [];
    for (let s = 0; s < setCount; s++) {
      rp.seek(0x5e + s * 32);
      const setLoc = rp.i32();
      rp.seek(0x5e + s * 32 + 16);
      const poseName = rp.pstr(15);
      const sc = file.containers[setLoc].data;
      const rs = new BinaryReader(sc);
      rs.seek(0x72);
      const frameCount = rs.i32();
      const steps: CastFrame[][] = [];
      for (let fi = 0; fi < frameCount; fi++) {
        const base = 0x76 + fi * 44;
        rs.seek(base);
        const location = rs.i32();
        rs.seek(base + 10);
        const direction = rs.i16();
        rs.seek(base + 40);
        const angle16 = rs.i16();
        const refScale = rs.i16();
        const step = Math.floor(fi / 8);
        (steps[step] ??= [])[direction & 7] = { location, direction, angle16, refScale };
      }
      poses.push({ name: poseName.toLowerCase(), location: setLoc, steps, frameCount });
    }
    members.push({ name: name.toLowerCase(), logicLocation, scriptLocation, poses });
  }
  return { file, paletteRaw: c0.subarray(36, 36 + 2048), members };
}
