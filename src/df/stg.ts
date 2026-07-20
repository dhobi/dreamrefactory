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

/**
 * A clickable region of a flat, decoded from its click-logic container. The
 * rect is stored Y-first (top, left, bottom, right) like SET hotspots; a click
 * inside it runs `script`'s mousedown handler (e.g. gotopage(3), exitmap,
 * jumpbaby(...) on the deck map).
 */
export interface StgRegion {
  top: number;
  left: number;
  bottom: number;
  right: number;
  /** container index of the region's mousedown script */
  script: number;
  name: string;
}

export interface StgFile {
  file: DFContainerFile;
  paletteRaw: Uint8Array;
  flats: StgFlat[];
}

/**
 * Decode a flat's click-logic container: a 1028-byte header, an int32 region
 * count @0x404, then `count` 32-byte records — {i32 flag, i16 top/left/bottom/
 * right, i32 scriptContainer, char[16] name}. Verified across all MAP.STG
 * decks (size always == 1032 + count*32).
 */
export function readStgRegions(data: Uint8Array): StgRegion[] {
  if (data.length < 1032) return [];
  const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const count = v.getInt32(1028, true);
  if (count < 0 || 1032 + count * 32 > data.length) return [];
  const out: StgRegion[] = [];
  for (let r = 0; r < count; r++) {
    const o = 1032 + r * 32;
    // name is a pascal string: length byte at +16, then the characters
    const nameLen = Math.min(data[o + 16], 15);
    let name = "";
    for (let k = 0; k < nameLen; k++) name += String.fromCharCode(data[o + 17 + k]);
    out.push({
      top: v.getInt16(o + 4, true),
      left: v.getInt16(o + 6, true),
      bottom: v.getInt16(o + 8, true),
      right: v.getInt16(o + 10, true),
      script: v.getInt32(o + 12, true),
      name,
    });
  }
  return out;
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
