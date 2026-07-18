import { DFContainerFile, readContainerFile } from "./container";

/**
 * STG files — "stages": full-screen 2D UI layers (flats) with their own
 * scripts. MAIN.STG is the standard in-game frame (the wood-panelled band
 * below the 512×264 view); INVEN1/2.STG are the inventory screens; the
 * mini-games (BLKJACK, FIGHT, …) are multi-flat stages.
 *
 * Container 0 header: palette @56 (256×8), flat count @2120, then 46-byte
 * flat records @2124. Container 1 is the stage's main script. Flat images
 * use the common frame codec.
 */

export interface StgFlat {
  condition: number;
  locationScript: number;
  locationFrame: number;
  locationClickLogic: number;
  width: number;
  height: number;
  name: string;
}

export interface StgFile {
  file: DFContainerFile;
  paletteRaw: Uint8Array;
  flats: StgFlat[];
}

export function readStgFile(data: Uint8Array): StgFile {
  const file = readContainerFile(data);
  const c0 = file.containers[0].data;
  const v = new DataView(c0.buffer, c0.byteOffset, c0.byteLength);

  const paletteRaw = c0.subarray(56, 56 + 256 * 8);
  const count = v.getInt32(2120, true);
  const flats: StgFlat[] = [];
  let off = 2124;
  for (let i = 0; i < count; i++) {
    const condition = v.getInt32(off, true);
    const locationScript = v.getInt32(off + 6, true);
    const locationFrame = v.getInt32(off + 10, true);
    const locationClickLogic = v.getInt32(off + 14, true);
    const height = v.getInt16(off + 22, true);
    const width = v.getInt16(off + 24, true);
    const len = c0[off + 30];
    let name = "";
    for (let c = 0; c < len && c < 15; c++) name += String.fromCharCode(c0[off + 31 + c]);
    flats.push({ condition, locationScript, locationFrame, locationClickLogic, width, height, name });
    off += 46;
  }
  return { file, paletteRaw, flats };
}
