import { latin1, writeNameAt } from "./binary";
import { DFContainerFile, patchContainerData, readContainerFile } from "./container";
import { versionOf, type DfVersion } from "./version";

/**
 * STG files — "stages": full-screen 2D UI layers (flats) with their own
 * scripts. MAIN.STG is the standard in-game frame (the wood-panelled band
 * below the 512×264 view); INVEN1/2.STG are the inventory screens; the
 * mini-games (BLKJACK, FIGHT, …) are multi-flat stages.
 *
 * Container 0 header: palette @56 (256×8), flat count @2120, then 46-byte
 * flat records @2124. Container 1 is the stage's main script. Flat images
 * use the common frame codec.
 *
 * ## Both engines, one reader
 *
 * Dust (DreamFactory 1) calls these `.FLT` and its boot says
 * `openstagefile("new.flt")` — the same builtin, a renamed extension — and the
 * MODEL is the same one: flats, each with a script, a picture and a table of
 * clickable regions. So this reads both, which is the opposite of the call made
 * for SET (see {@link file://./set-v1.ts}, where v1 movement is a different idea
 * and got its own file).
 *
 * What differs is where the fields sit, and v4 is the one that grew:
 *
 *                       v1 (.FLT)      v4 (.STG)
 *   palette                  0x24           0x38
 *   flat count               2100           2120
 *   flat record              28 B           46 B
 *   region count      +0 of the      +1028 of the click-logic container
 *
 * A v1 flat record carries only the three container refs and its name; the
 * `condition`, `width` and `height` that v4 added are not there, so a v1 flat is
 * reported at the stage's own screen size, which is what it is — 512x384, from
 * the header, for every flat on the disc.
 */

export interface StgFlat {
  condition: number;
  locationScript: number;
  locationFrame: number;
  locationClickLogic: number;
  width: number;
  height: number;
  name: string;
  /** byte offset of this 46-byte record in container 0 (edit target — see
   *  {@link patchFlatName}) */
  record: number;
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
  /** byte offset of this 32-byte record in the flat's click-logic container
   *  (edit target — see {@link patchRegionName} / {@link patchRegionRect}) */
  record: number;
}

export interface StgFile {
  file: DFContainerFile;
  /** which engine wrote it — 1 is Dust's `.FLT`, 4 is Titanic's `.STG` */
  version: DfVersion;
  paletteRaw: Uint8Array;
  flats: StgFlat[];
}

/** container 0: the palette and the flat table, per version */
const C0_BY_VERSION = {
  4: { palette: 56, flatCount: 2120, flats: 2124, flatSize: 46, screen: 0x28 },
  1: { palette: 36, flatCount: 2100, flats: 2104, flatSize: 28, screen: 0x1c },
} as const;

/** the flat record. `-1` is a field the version does not store. */
const FLAT_BY_VERSION = {
  4: { condition: 0, script: 6, frame: 10, clickLogic: 14, height: 22, width: 24, name: 30 },
  1: { condition: -1, script: 0, frame: 4, clickLogic: 8, height: -1, width: -1, name: 12 },
} as const;

/**
 * A click-logic container. The records are the same 32 bytes in both engines —
 * {i32 flag, i16 top/left/bottom/right, i32 script, pstr name} — and only the
 * header ahead of the count differs: v4 puts 1028 bytes there, v1 nothing at all.
 * Sizes confirm it exactly on every v1 flat: 100 = 4 + 3*32, 36 = 4 + 1*32,
 * 420 = 4 + 13*32.
 */
const REGION_BY_VERSION = {
  4: { count: 1028, first: 1032 },
  1: { count: 0, first: 4 },
} as const;

const REGION = { size: 32, top: 4, script: 12, name: 16 } as const;

/** characters that fit the name fields (the length byte is not counted) */
export const FLAT_NAME_FIELD = 15;
export const REGION_NAME_FIELD = 15;

/** the stage's main script, by convention (`gotospecial` lives in MAIN.STG's) */
export const MAIN_SCRIPT_LOCATION = 1;

/**
 * Decode a flat's click-logic container: a 1028-byte header, an int32 region
 * count @0x404, then `count` 32-byte records — {i32 flag, i16 top/left/bottom/
 * right, i32 scriptContainer, char[16] name}. Verified across all MAP.STG
 * decks (size always == 1032 + count*32).
 */
export function readStgRegions(data: Uint8Array, version: DfVersion = 4): StgRegion[] {
  const at = REGION_BY_VERSION[version];
  if (data.length < at.first) return [];
  const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const count = v.getInt32(at.count, true);
  if (count < 0 || at.first + count * REGION.size > data.length) return [];
  const out: StgRegion[] = [];
  for (let r = 0; r < count; r++) {
    const o = at.first + r * REGION.size;
    // name is a pascal string: length byte at +16, then the characters
    const nameLen = Math.min(data[o + REGION.name], REGION_NAME_FIELD);
    const name = latin1(data.subarray(o + REGION.name + 1, o + REGION.name + 1 + nameLen));
    out.push({
      top: v.getInt16(o + REGION.top, true),
      left: v.getInt16(o + REGION.top + 2, true),
      bottom: v.getInt16(o + REGION.top + 4, true),
      right: v.getInt16(o + REGION.top + 6, true),
      script: v.getInt32(o + REGION.script, true),
      name,
      record: o,
    });
  }
  return out;
}

export function readStgFile(data: Uint8Array): StgFile {
  const file = readContainerFile(data);
  const c0 = file.containers[0].data;
  const v = new DataView(c0.buffer, c0.byteOffset, c0.byteLength);
  /**
   * v1 when the file says so, v4 otherwise — and NOT a throw on anything else.
   *
   * This reader never asked for a version before, so demanding one now would
   * reject callers that were always fine. `engine/src/df/stg-build.ts` is one: the
   * language chooser's stage is generated at run time and leaves the tag at 0,
   * which never mattered because there was only ever one layout. Widening a
   * reader should add a case, not take one away.
   */
  const version: DfVersion = versionOf(c0) === 1 ? 1 : 4;
  const C0 = C0_BY_VERSION[version];
  const FLAT = FLAT_BY_VERSION[version];
  // a v1 flat stores no size of its own, so it is the whole screen — which is
  // what the header says it is, and what every flat on the Dust disc measures
  const screenW = v.getInt16(C0.screen, true);
  const screenH = v.getInt16(C0.screen + 2, true);

  const paletteRaw = c0.subarray(C0.palette, C0.palette + 256 * 8);
  const count = v.getInt32(C0.flatCount, true);
  const flats: StgFlat[] = [];
  let off = C0.flats;
  for (let i = 0; i < count; i++) {
    const condition = FLAT.condition < 0 ? 0 : v.getInt32(off + FLAT.condition, true);
    const locationScript = v.getInt32(off + FLAT.script, true);
    const locationFrame = v.getInt32(off + FLAT.frame, true);
    const locationClickLogic = v.getInt32(off + FLAT.clickLogic, true);
    const height = FLAT.height < 0 ? screenH : v.getInt16(off + FLAT.height, true);
    const width = FLAT.width < 0 ? screenW : v.getInt16(off + FLAT.width, true);
    const len = Math.min(c0[off + FLAT.name], FLAT_NAME_FIELD);
    const name = latin1(c0.subarray(off + FLAT.name + 1, off + FLAT.name + 1 + len));
    flats.push({
      condition,
      locationScript,
      locationFrame,
      locationClickLogic,
      width,
      height,
      name,
      record: off,
    });
    off += C0.flatSize;
  }
  return { file, version, paletteRaw, flats };
}

// ---------------------------------------------------------------------------
// Edits — the write path of the stage editor (editors/stages.html)
// ---------------------------------------------------------------------------
// Two containers hold everything editable that is not art: the flat names live
// in container 0's flat table, and a flat's regions in its own click-logic
// container. Flat ART is replaced by the caller, which swaps a whole container
// for an `encodeFrame` result (see taoot/tests/auto/stg-editor.ts).

const i16clamp = (v: number): number => Math.max(-32768, Math.min(32767, Math.round(v)));

/**
 * A flat's name — what `gotoflat`/`transtoflat` asks for and what
 * `currentflat()` answers, so renaming one means renaming it in the scripts
 * that call for it too. Stored in container 0's flat table.
 */
export function patchFlatName(stg: StgFile, flatIdx: number, name: string): string {
  const flat = stg.flats[flatIdx];
  if (!flat) return "";
  let stored = flat.name;
  // through the SAME tables the read used, so an edit lands on the byte the
  // name came out of whichever engine wrote the file
  const name0 = FLAT_BY_VERSION[stg.version].name;
  const pal = C0_BY_VERSION[stg.version].palette;
  patchContainerData(stg.file, 0, (d) => {
    stored = writeNameAt(d, flat.record + name0, name, FLAT_NAME_FIELD);
    // the palette is a window into container 0, which the copy just replaced
    stg.paletteRaw = d.subarray(pal, pal + 256 * 8);
  });
  flat.name = stored;
  return stored;
}

/**
 * A region's name — the "button" identity a script reaches with
 * `sendtobutton`/`pointinbutton` and which `indextobutton` enumerates. Same
 * caveat as a flat's: the scripts name it too.
 */
export function patchRegionName(
  stg: StgFile,
  flat: StgFlat,
  region: StgRegion,
  name: string,
): string {
  let stored = region.name;
  patchContainerData(stg.file, flat.locationClickLogic, (d) => {
    stored = writeNameAt(d, region.record + REGION.name, name, REGION_NAME_FIELD);
  });
  region.name = stored;
  return stored;
}

/**
 * A region's clickable rectangle, in flat pixels (a flat is the whole 512×384
 * screen, so these are screen coordinates). Stored Y-first — top, left, bottom,
 * right — and callers pass the edges by name so the axis order stays in one
 * place. The parsed region is updated with the bytes, since it is what the
 * editor draws its overlay from.
 */
export function patchRegionRect(
  stg: StgFile,
  flat: StgFlat,
  region: StgRegion,
  rect: { top: number; left: number; bottom: number; right: number },
): boolean {
  const next = {
    top: i16clamp(rect.top),
    left: i16clamp(rect.left),
    bottom: i16clamp(rect.bottom),
    right: i16clamp(rect.right),
  };
  const ok = patchContainerData(stg.file, flat.locationClickLogic, (d) => {
    const v = new DataView(d.buffer, d.byteOffset, d.byteLength);
    const at = region.record + REGION.top;
    v.setInt16(at, next.top, true);
    v.setInt16(at + 2, next.left, true);
    v.setInt16(at + 4, next.bottom, true);
    v.setInt16(at + 6, next.right, true);
  });
  if (ok) Object.assign(region, next);
  return ok;
}
