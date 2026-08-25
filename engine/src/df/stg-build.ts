/**
 * Building a STG stage from nothing — the write path that matches
 * [`stg.ts`](stg.ts)'s reader, one layer above the per-field patches the stage
 * editor makes. See [`build.ts`](build.ts) for why these modules exist.
 *
 * The reader documents the layout; this builds it: container 0 with the palette
 * at 56 and the 46-byte flat table at 2124, container 1 as the stage main
 * script, then per flat a script container, an art container (the common frame
 * codec) and a click-logic container of 32-byte region records.
 *
 * Its first caller is the language chooser (taoot/tools/mklangstg.ts), a stage the
 * engine opens with `openstagefile` like any shipped one — `readStgFile` reads it
 * back and the stage editor round-trips it.
 */
import { ContainerBuilder, checkName, emptyScript, i16, i32, paletteBlock, pstr } from "./build";
import { ContainerRef, DFContainerFile, writeContainerFile } from "./container";
import { encodeFrame } from "./image";
import { FLAT_NAME_FIELD, REGION_NAME_FIELD, STAGE_NAME_FIELD } from "./stg";

/** offsets in container 0 and in one flat record — the reader's constants */
const C0 = { palette: 56, refName: 2104, flatCount: 2120, flats: 2124, flatSize: 46 } as const;
const FLAT = { condition: 0, script: 6, frame: 10, clickLogic: 14, height: 22, width: 24, name: 30 } as const;
const REGION = { count: 1028, first: 1032, size: 32, top: 4, script: 12, name: 16 } as const;

/** a full-screen indexed image (a flat's art) */
export interface StgArt {
  /** one byte per pixel, indexes into the stage palette */
  pixels: Uint8Array;
  width: number;
  height: number;
}

export interface StgBuildRegion {
  /** the "button" name scripts reach with sendtobutton/pointinbutton (≤15 chars) */
  name: string;
  top: number;
  left: number;
  bottom: number;
  right: number;
  /**
   * The region's own script — its `mousedown` is what a click runs. A region
   * WITHOUT one is a bare hotspot: the click reaches the flat script and the
   * stage main with the region's name as `target` (see the runtime doc's click
   * order), which is how the shipped fusebox works.
   */
  script?: Uint8Array;
}

export interface StgBuildFlat {
  /** what `gotoflat`/`transtoflat` ask for and `currentflat()` answers (≤15 chars) */
  name: string;
  /** the reader's flat `condition` field; 0 unless a stage means something by it */
  condition?: number;
  art: StgArt;
  /** the flat's script — its `openflat`/`closeflat`/`mousedown` handlers */
  script?: Uint8Array;
  regions?: StgBuildRegion[];
}

export interface StgBuildOptions {
  /** the colour table, as RGB triples (up to 256 entries) */
  palette: ArrayLike<number>;
  /**
   * The stage's main script (container 1 by convention — `MAIN_SCRIPT_LOCATION`).
   * Its `openstage` handler runs before any flat is shown. Omitted, a minimal
   * empty script is written, because the slot itself is conventional.
   */
  main?: Uint8Array;
  /**
   * The stage's OWN name, which is not its filename — `currentstage()`'s answer,
   * and the twin of `ShpBuildOptions.refName` (≤15 chars).
   *
   * Omitted, the field is left empty and `currentstage()` falls back to the file,
   * which is what the language chooser's generated stage wants. Worth writing when
   * a stage is meant to be *recognised* by a script: Timelapse's `p.stg` is called
   * `"interface"` and its space bar tests for exactly that (see
   * {@link StgFile.refName}).
   */
  refName?: string;
  flats: StgBuildFlat[];
  /** dummy gap containers after the main script, as the shipped files carry */
  gaps?: number;
}

/** the 1028-byte header, the region count, then the 32-byte records */
function clickLogicBlock(
  regions: StgBuildRegion[],
  scriptLoc: (r: StgBuildRegion) => ContainerRef,
): Uint8Array {
  const d = new Uint8Array(REGION.first + regions.length * REGION.size);
  i32(d, REGION.count, regions.length);
  regions.forEach((r, i) => {
    const o = REGION.first + i * REGION.size;
    i32(d, o, 1); // the record's flag, 1 in every shipped region
    i16(d, o + REGION.top, r.top);
    i16(d, o + REGION.top + 2, r.left);
    i16(d, o + REGION.top + 4, r.bottom);
    i16(d, o + REGION.top + 6, r.right);
    i32(d, o + REGION.script, scriptLoc(r));
    pstr(d, o + REGION.name, r.name, REGION_NAME_FIELD);
  });
  return d;
}

/**
 * Assemble a stage into a container file. Returns the {@link DFContainerFile} so
 * a caller can keep editing it (or hand it to the editors' own patch functions);
 * {@link buildStgBytes} is the one-liner that just wants the file's bytes.
 */
export function buildStgFile(opts: StgBuildOptions): DFContainerFile {
  const { flats, palette } = opts;
  if (!flats.length) throw new Error("stg: a stage needs at least one flat");

  const b = new ContainerBuilder();
  // container 0: the palette and (patched at the end) the flat table
  const { data: c0 } = b.reserve(C0.flats + flats.length * C0.flatSize);
  c0.set(paletteBlock(palette), C0.palette);
  // container 1: the stage main, by convention
  b.add(opts.main ?? emptyScript());
  for (let g = 0; g < (opts.gaps ?? 0); g++) b.gap();

  if (opts.refName) {
    checkName("stg: stage", opts.refName, STAGE_NAME_FIELD);
    pstr(c0, C0.refName, opts.refName, STAGE_NAME_FIELD);
  }
  i32(c0, C0.flatCount, flats.length);
  flats.forEach((f, i) => {
    checkName("stg: flat", f.name, FLAT_NAME_FIELD);
    const { pixels, width, height } = f.art;
    if (pixels.length < width * height) {
      throw new Error(`stg: flat "${f.name}" art is ${pixels.length} bytes, needs ${width * height}`);
    }
    const scriptLoc = f.script ? b.add(f.script) : 0;
    const frameLoc = b.add(encodeFrame(pixels, width, height));
    const regions = f.regions ?? [];
    for (const r of regions) checkName("stg: region", r.name, REGION_NAME_FIELD);
    // a region's script is its own container, so a click on one button cannot
    // reach another's code — the same shape the shipped stages have
    const regionScripts = new Map<StgBuildRegion, ContainerRef>();
    for (const r of regions) if (r.script) regionScripts.set(r, b.add(r.script));
    const clickLoc = regions.length
      ? b.add(clickLogicBlock(regions, (r) => regionScripts.get(r) ?? 0))
      : 0;

    const o = C0.flats + i * C0.flatSize;
    i32(c0, o + FLAT.condition, f.condition ?? 0);
    i32(c0, o + FLAT.script, scriptLoc);
    i32(c0, o + FLAT.frame, frameLoc);
    i32(c0, o + FLAT.clickLogic, clickLoc);
    i16(c0, o + FLAT.height, height);
    i16(c0, o + FLAT.width, width);
    pstr(c0, o + FLAT.name, f.name, FLAT_NAME_FIELD);
  });

  return b.finish();
}

/** {@link buildStgFile}, serialized — a stage as bytes to write or upload */
export function buildStgBytes(opts: StgBuildOptions): Uint8Array {
  return writeContainerFile(buildStgFile(opts));
}
