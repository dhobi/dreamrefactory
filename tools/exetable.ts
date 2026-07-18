/**
 * Locate the DreamFactory script-command dispatch table inside TI.EXE.
 *
 * Strategy: parse PE sections, compute the virtual address of known command
 * name strings, scan the file for 32-bit little-endian pointers to them, and
 * dump the records around the hits to recover the table layout
 * (name pointer -> command ID -> handler address).
 *
 *   npx tsx tools/exetable.ts gamefiles/TI.EXE
 */
import { readFileSync } from "node:fs";

const exePath = process.argv[2] ?? "gamefiles/TI.EXE";
const data = new Uint8Array(readFileSync(exePath));
const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

// --- PE parsing ---
const peOff = view.getUint32(0x3c, true);
if (view.getUint32(peOff, true) !== 0x00004550) throw new Error("not a PE file");
const numSections = view.getUint16(peOff + 6, true);
const optSize = view.getUint16(peOff + 20, true);
const imageBase = view.getUint32(peOff + 24 + 28, true);
const secTable = peOff + 24 + optSize;

interface Section {
  name: string;
  va: number;
  vsize: number;
  raw: number;
  rawSize: number;
}
const sections: Section[] = [];
for (let i = 0; i < numSections; i++) {
  const o = secTable + i * 40;
  let name = "";
  for (let c = 0; c < 8 && data[o + c]; c++) name += String.fromCharCode(data[o + c]);
  sections.push({
    name,
    vsize: view.getUint32(o + 8, true),
    va: view.getUint32(o + 12, true),
    rawSize: view.getUint32(o + 16, true),
    raw: view.getUint32(o + 20, true),
  });
}
console.log(`imageBase 0x${imageBase.toString(16)}`);
for (const s of sections) {
  console.log(
    `  ${s.name.padEnd(8)} va 0x${(imageBase + s.va).toString(16)} raw 0x${s.raw.toString(16)} size 0x${s.rawSize.toString(16)}`,
  );
}

function fileToVA(off: number): number | null {
  for (const s of sections) {
    if (off >= s.raw && off < s.raw + s.rawSize) return imageBase + s.va + (off - s.raw);
  }
  return null;
}
function vaToFile(va: number): number | null {
  const rva = va - imageBase;
  for (const s of sections) {
    if (rva >= s.va && rva < s.va + Math.max(s.vsize, s.rawSize)) return s.raw + (rva - s.va);
  }
  return null;
}

// --- find a known command name string ---
function findString(s: string): number[] {
  const needle = new TextEncoder().encode(s + "\0");
  const hits: number[] = [];
  outer: for (let i = 0; i < data.length - needle.length; i++) {
    // must be preceded by NUL or padding to be a string start
    if (i > 0 && data[i - 1] !== 0) continue;
    for (let j = 0; j < needle.length; j++) {
      if (data[i + j] !== needle[j]) continue outer;
    }
    hits.push(i);
  }
  return hits;
}

function pointersTo(va: number): number[] {
  const hits: number[] = [];
  for (let i = 0; i < data.length - 4; i += 1) {
    if (view.getUint32(i, true) === va) hits.push(i);
  }
  return hits;
}

// --- walk the full 6-byte {u32 nameVA, u16 cmdID} table around a known hit ---
function readCString(off: number): string | null {
  let s = "";
  for (let i = off; i < data.length && data[i]; i++) {
    const c = data[i];
    if (c < 0x20 || c > 0x7e) return null;
    s += String.fromCharCode(c);
    if (s.length > 24) return null;
  }
  return s.length ? s : null;
}

function validRecord(off: number): { name: string; id: number } | null {
  const nameVA = view.getUint32(off, true);
  const id = view.getUint16(off + 4, true);
  const f = vaToFile(nameVA);
  if (f === null) return null;
  const name = readCString(f);
  if (!name) return null;
  const band = Math.floor(id / 4000);
  if (id !== 1 && (band < 1 || band > 6 || id % 4000 > 200)) return null;
  return { name, id };
}

{
  // scan the whole file for {u32 nameVA, u16 id} records; the real table
  // shows up as a dense cluster of hits with plausible names/ids
  const NAME_RE = /^[a-z0-9]{2,20}$|^[!=<>()@&|,*/+-]{1,2}$|^ $/;
  const hits: { off: number; name: string; id: number }[] = [];
  for (let off = 0; off < data.length - 6; off += 2) {
    const rec = validRecord(off);
    if (rec && NAME_RE.test(rec.name)) hits.push({ off, ...rec });
  }
  // dedupe by id, prefer names that differ; report conflicts
  const byId = new Map<number, Set<string>>();
  for (const h of hits) {
    let s = byId.get(h.id);
    if (!s) byId.set(h.id, (s = new Set()));
    s.add(h.name);
  }
  console.log(`\nFULL SCAN: ${hits.length} candidate records, ${byId.size} distinct ids`);
  for (const [id, names] of [...byId.entries()].sort((a, b) => a[0] - b[0])) {
    console.log(`${id}\t${[...names].join(" | ")}`);
  }
}

for (const name of ["sendtoactor", "actorxyz", "puppetspeak", "walkonroad"]) {
  for (const off of findString(name)) {
    const va = fileToVA(off);
    if (va === null) continue;
    const ptrs = pointersTo(va);
    console.log(`\n"${name}" @file 0x${off.toString(16)} va 0x${va.toString(16)} — ${ptrs.length} pointer(s)`);
    for (const p of ptrs) {
      // dump a few 4-byte words around the pointer to reveal record layout
      const words: string[] = [];
      for (let w = -4; w <= 8; w++) {
        const v = view.getUint32(p + w * 4, true);
        words.push((w === 0 ? ">" : "") + v.toString(16).padStart(8, "0"));
      }
      console.log(`  ptr @file 0x${p.toString(16)}: ${words.join(" ")}`);
    }
  }
}
