/**
 * Pull a DreamFactory engine build's mouse cursors out of its .EXE.
 *
 *   npx tsx tools/dumpcursors.ts                       # Timelapse -> timelapse/src/cursor-art.ts
 *   npx tsx tools/dumpcursors.ts <pe> --show           # ASCII art, nothing written
 *   npx tsx tools/dumpcursors.ts <pe> --out <ts> --const NAME
 *
 * ## Where the cursors are, and how the game asks for one
 *
 * `cursor("touch")` is opcode 12039, and what the engine does with the name is
 * build a RESOURCE name out of it and hand that to `LoadCursorA`. The composition
 * is at tl.exe 0x421060: a 4-character type tag is written into a buffer and
 * `sprintf`-ed with the script's string through `"%s.%s"` (0x45be18), and the
 * resulting `"CURS.TOUCH"` goes to 0x4210e0, which is the engine's one resource
 * loader — `cmp dword [esp+8], 0x43555253` is it testing that tag for `CURS` and
 * branching to `LoadCursorA(hInstance, name)` (0x421195) instead of the
 * `FindResourceA` path every other resource type takes.
 *
 * So the art is Windows cursor resources in the executable, the script's string
 * IS the resource name after `CURS.`, and Win32 resource lookup folds case —
 * which the scripts rely on: Timelapse spells two of them `HyperLink` and `None`
 * and the other eleven in lower case.
 *
 * ## The set is per BUILD, not per engine
 *
 * Timelapse's `tl.exe` carries seventeen, four of which Titanic's `ti.exe` does
 * not have at all (`GOLEFTBACK`, `GORIGHTBACK`, `HYPERLINK`, `NONE`) — and of the
 * thirteen both have, eleven are byte-identical while `GODOWN` and `GOUP` were
 * REDRAWN for Timelapse: Titanic's are plain arrows, Timelapse's have a foot on
 * the up arrow and fletching on the down one. Those two are 11,031 of the 13,200
 * `cursor(...)` calls on the discs, so a port that borrowed Titanic's would get
 * the two the player sees most often wrong. That is why this writes a table for
 * one game from one file rather than an engine-wide set.
 *
 * `CURS131` and `CURS2002` are duplicates of `CURS.TOUCH` and `CURS.WATCH` (the
 * same 308 bytes, the same hotspot) under the names an older build's numeric
 * resource ids left behind. Nothing names them, and they are dropped.
 *
 * ## What is written
 *
 * The two 1bpp planes exactly as the resource holds them — the colour plane then
 * the AND mask — normalised to top-down rows and base64'd, 344 characters per
 * cursor. Not PNGs: the browser needs the cursor at whatever integer scale the
 * canvas is being shown at (see engine/src/web/cursors.ts), and a bitmap it can
 * blow up by nearest neighbour is both smaller than one PNG per scale and crisp
 * at all of them.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

/** a cursor, as the resource holds it */
interface Cursor {
  /** the script's name for it: the resource name after `CURS.`, folded */
  name: string;
  hx: number;
  hy: number;
  /** 32x32 colour plane then 32x32 AND mask, top-down, 4 bytes a row */
  planes: Uint8Array;
}

const CURSOR_W = 32;
const CURSOR_H = 32;
const PLANE = (CURSOR_W >> 3) * CURSOR_H; // 128

/** RT_CURSOR / RT_GROUP_CURSOR, the two resource types this reads */
const RT_CURSOR = 1;
const RT_GROUP_CURSOR = 12;

/** one leaf of the resource tree */
interface Leaf {
  type: number | string;
  name: number | string;
  offset: number;
  size: number;
}

/**
 * Walk a PE's resource directory.
 *
 * Deliberately its own thirty lines rather than a dependency: the tree is three
 * levels of the same node shape (type, name, language), a leaf is an RVA and a
 * size, and the only subtlety is that every offset in it is relative to the
 * START of the resource section rather than to the file or to the image.
 */
function resources(pe: Buffer): Leaf[] {
  const off = pe.readUInt32LE(0x3c);
  const nsec = pe.readUInt16LE(off + 6);
  const optsz = pe.readUInt16LE(off + 20);
  const magic = pe.readUInt16LE(off + 24);
  const dirs = off + 24 + (magic === 0x10b ? 96 : 112);
  const secs: { va: number; vsz: number; raw: number; rsz: number }[] = [];
  for (let i = 0; i < nsec; i++) {
    const s = off + 24 + optsz + 40 * i;
    secs.push({
      vsz: pe.readUInt32LE(s + 8), va: pe.readUInt32LE(s + 12),
      rsz: pe.readUInt32LE(s + 16), raw: pe.readUInt32LE(s + 20),
    });
  }
  const fileOffset = (rva: number): number => {
    for (const s of secs) {
      if (rva >= s.va && rva < s.va + Math.max(s.vsz, s.rsz)) return s.raw + (rva - s.va);
    }
    throw new Error(`rva ${rva.toString(16)} is in no section`);
  };
  const rsrc = pe.readUInt32LE(dirs + 2 * 8);
  if (!rsrc) return [];
  const base = fileOffset(rsrc);

  const out: Leaf[] = [];
  const walk = (node: number, path: (number | string)[]): void => {
    const named = pe.readUInt16LE(node + 12);
    const ids = pe.readUInt16LE(node + 14);
    for (let i = 0; i < named + ids; i++) {
      const e = node + 16 + 8 * i;
      const nm = pe.readUInt32LE(e);
      const data = pe.readUInt32LE(e + 4);
      let id: number | string;
      if (nm & 0x8000_0000) {
        const so = base + (nm & 0x7fff_ffff);
        id = pe.toString("utf16le", so + 2, so + 2 + 2 * pe.readUInt16LE(so));
      } else id = nm;
      if (data & 0x8000_0000) walk(base + (data & 0x7fff_ffff), [...path, id]);
      else {
        const d = base + data;
        out.push({
          type: path[0], name: path[1] ?? id,
          offset: fileOffset(pe.readUInt32LE(d)), size: pe.readUInt32LE(d + 4),
        });
      }
    }
  };
  walk(base, []);
  return out;
}

/**
 * The cursors, by the name a script would use.
 *
 * A GROUP_CURSOR is the name; it holds a directory of candidate sizes, each
 * pointing at a numbered CURSOR resource by ordinal. Every one of these groups
 * has exactly one candidate, which is what a game with a fixed screen would
 * ship, and it is 32x32 monochrome.
 */
function cursors(pe: Buffer): Cursor[] {
  const leaves = resources(pe);
  const byOrdinal = new Map<number, Leaf>();
  for (const l of leaves) if (l.type === RT_CURSOR && typeof l.name === "number") byOrdinal.set(l.name, l);

  const out: Cursor[] = [];
  for (const group of leaves) {
    if (group.type !== RT_GROUP_CURSOR || typeof group.name !== "string") continue;
    const count = pe.readUInt16LE(group.offset + 4);
    if (count !== 1) throw new Error(`${group.name}: ${count} candidates, expected 1`);
    const dir = group.offset + 6;
    const w = pe.readUInt16LE(dir);
    // the DIRECTORY's height is the image's, the DIB header's is doubled (colour
    // plane plus mask); this is the honest one
    const h = pe.readUInt16LE(dir + 2);
    const bpp = pe.readUInt16LE(dir + 6);
    const ordinal = pe.readUInt16LE(dir + 12);
    const leaf = byOrdinal.get(ordinal);
    if (!leaf) throw new Error(`${group.name}: no CURSOR ${ordinal}`);
    if (bpp !== 1 || w !== CURSOR_W || h !== 2 * CURSOR_H) {
      throw new Error(`${group.name}: ${w}x${h} ${bpp}bpp — this reads 32x32 monochrome`);
    }
    const o = leaf.offset;
    const hx = pe.readUInt16LE(o);
    const hy = pe.readUInt16LE(o + 2);
    const hdr = pe.readUInt32LE(o + 4); // BITMAPINFOHEADER, 40
    const colours = pe.readUInt32LE(o + 4 + 32) || 2;
    const pal = o + 4 + hdr;
    // index 0 black, index 1 white, in every one of these. Checked rather than
    // assumed: a reversed palette would render every cursor inside out.
    if (pe[pal] !== 0 || pe[pal + 4] !== 255) throw new Error(`${group.name}: unexpected palette`);
    const bits = pal + 4 * colours;

    // bottom-up in the file, like every DIB; flipped here so nothing downstream
    // has to know that
    const planes = new Uint8Array(2 * PLANE);
    const stride = CURSOR_W >> 3;
    for (let plane = 0; plane < 2; plane++) {
      for (let y = 0; y < CURSOR_H; y++) {
        const src = bits + plane * PLANE + (CURSOR_H - 1 - y) * stride;
        planes.set(pe.subarray(src, src + stride), plane * PLANE + y * stride);
      }
    }
    // AND=1 with colour=1 is Windows' "invert the screen here", which no CSS
    // cursor can do. Nothing in these builds asks for it, and this is the guard
    // that keeps that true — engine/src/web/cursors.ts renders three states.
    for (let i = 0; i < PLANE; i++) {
      if (planes[i] & planes[PLANE + i]) throw new Error(`${group.name}: uses screen inversion`);
    }
    out.push({ name: group.name.replace(/^CURS\./, "").toLowerCase(), hx, hy, planes });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** ASCII art, which is how the shapes get checked by eye */
function show(c: Cursor): void {
  console.log(`=== ${c.name}  hotspot ${c.hx},${c.hy}`);
  for (let y = 0; y < CURSOR_H; y++) {
    let line = "";
    for (let x = 0; x < CURSOR_W; x++) {
      const i = y * (CURSOR_W >> 3) + (x >> 3);
      const bit = 7 - (x & 7);
      const colour = (c.planes[i] >> bit) & 1;
      const mask = (c.planes[PLANE + i] >> bit) & 1;
      line += mask ? " " : colour ? "." : "#";
    }
    if (line.trim()) console.log(`|${line}|`);
  }
}

/**
 * What a browser should show if it will not take the image.
 *
 * Every navigation arrow falls back to `pointer` rather than to a resize arrow:
 * the resize cursors point the right way but they promise a drag, and these are
 * all single clicks. `none` for the blank one is exact.
 */
const FALLBACK: Record<string, string> = {
  arrow: "default", touch: "pointer", hand: "grab", fist: "grabbing",
  watch: "wait", sight: "crosshair", hyperlink: "pointer", none: "none",
};

function emit(cs: Cursor[], constName: string, source: string, dropped: string[]): string {
  const rows = cs.map((c) => {
    const b64 = Buffer.from(c.planes).toString("base64");
    const fallback = FALLBACK[c.name] ?? "pointer";
    return `  ${c.name}: { hx: ${c.hx}, hy: ${c.hy}, fallback: "${fallback}",\n    bits: "${b64}" },`;
  });
  const also = dropped.length
    ? `, minus ${dropped.length === 1 ? "one that is a duplicate" : `${dropped.length} that are duplicates`} under an old numeric name (${dropped.join(", ")})`
    : "";
  return `/**
 * The mouse cursors this game's engine build carries — GENERATED, do not edit.
 *
 *   npx tsx tools/dumpcursors.ts ${source} --out <this file> --const ${constName}
 *
 * ${cs.length} \`CURS.*\` resources out of \`${source.replace(/^.*\//, "")}\`${also}.
 * What they are, how \`cursor("touch")\` reaches one and why a table is per BUILD
 * rather than per engine is in that tool's header; how a browser is given one is
 * in engine/src/web/cursors.ts.
 */
import type { CursorArt } from "@dreamfactory/engine/web/cursors";

/** by the name a script passes \`cursor(...)\`, folded — Win32 resource lookup
 *  folds case and the discs rely on it */
export const ${constName}: Record<string, CursorArt> = {
${rows.join("\n")}
};
`;
}

const argv = process.argv.slice(2);
const here = fileURLToPath(new URL(".", import.meta.url));
const flags = new Set(["--out", "--const"]);
const flag = (name: string): string | undefined => {
  const i = argv.indexOf(name);
  return i < 0 ? undefined : argv[i + 1];
};
/** the one positional: a PE. Anything a `--flag` consumed is not it. */
const file = argv.find((a, i) => !a.startsWith("--") && !flags.has(argv[i - 1] ?? ""))
  ?? join(here, "..", "timelapse/gamefiles/TLAPSE1/install/bin/tl.exe");

const found = cursors(readFileSync(file));
console.log(`${file}: ${found.length} cursor(s) — ${found.map((c) => c.name).join(" ")}`);
if (argv.includes("--show")) {
  for (const c of found) show(c);
} else {
  /**
   * The numeric names go, but only after this has SEEN that they are copies —
   * the tool's header claims it, so the run that writes the table is the run
   * that checks it.
   */
  const same = (a: Cursor, b: Cursor): boolean =>
    a.hx === b.hx && a.hy === b.hy && Buffer.compare(Buffer.from(a.planes), Buffer.from(b.planes)) === 0;
  const keep = found.filter((c) => !/^curs\d+$/.test(c.name));
  const dropped = found.filter((c) => /^curs\d+$/.test(c.name));
  for (const d of dropped) {
    const twin = keep.find((c) => same(c, d));
    if (!twin) throw new Error(`${d.name} is not a duplicate of anything kept — it would be lost`);
    console.log(`  ${d.name} = ${twin.name}, dropped`);
  }
  const out = flag("--out") ?? join(here, "..", "timelapse/src/cursor-art.ts");
  writeFileSync(out, emit(keep, flag("--const") ?? "TL_CURSORS", file.replace(/^.*gamefiles\//, ""), dropped.map((d) => d.name)));
  console.log(`wrote ${out} (${keep.length} cursors)`);
}
