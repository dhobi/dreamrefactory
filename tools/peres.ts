/**
 * The resources a Win32 executable carries: its PE resource tree, walked.
 *
 * Three levels — type, name, language — each an IMAGE_RESOURCE_DIRECTORY of
 * entries whose id is a number or (high bit set) the offset of a counted UTF-16
 * name, and whose leaf is {u32 RVA, u32 size} of the data. `tools/rtmenu.ts`
 * reads the menus with it and `tools/rtdialog.ts` the dialogs.
 */
import { readFileSync } from "node:fs";

export interface Resource {
  /** the resource's name, or its number as a string */
  name: string;
  /** its number, or -1 for a named one */
  id: number;
  bytes: Uint8Array;
}

/** every resource of one type (RT_MENU 4, RT_DIALOG 5, …), in the tree's order */
export function readResources(path: string, type: number): Resource[] {
  const data = new Uint8Array(readFileSync(path));
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

  // ---- the PE section table, so a resource RVA can be turned into a file offset ----
  const peOff = view.getUint32(0x3c, true);
  if (view.getUint32(peOff, true) !== 0x4550) throw new Error(`${path}: not a PE file`);
  const numSections = view.getUint16(peOff + 6, true);
  const optSize = view.getUint16(peOff + 20, true);
  const secTable = peOff + 24 + optSize;
  const sections: { name: string; va: number; vsize: number; raw: number; rawSize: number }[] = [];
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
  /**
   * Strictly bounded, both ways.
   *
   * A sloppy version of this — "the first section whose start is below the RVA,
   * plus a bit of slack" — reads whatever happens to sit at that file offset and
   * reports it as data, which is a fault that looks like a decoding bug for as long
   * as you care to look at the decoder. So an RVA must be inside the section's
   * VIRTUAL size and inside what the file actually stores for it. (Some linkers
   * leave the virtual size 0, as LUNIRES.DLL's does; then the stored size is it.)
   */
  const rvaToFile = (rva: number): number | null => {
    for (const s of sections) {
      if (rva >= s.va && rva < s.va + (s.vsize || s.rawSize) && rva - s.va < s.rawSize) return s.raw + (rva - s.va);
    }
    return null;
  };

  const rsrc = sections.find((s) => s.name === ".rsrc");
  if (!rsrc) return [];
  const rsrcFile = rsrc.raw;

  const dirEntries = (at: number) => {
    const named = view.getUint16(rsrcFile + at + 12, true);
    const ided = view.getUint16(rsrcFile + at + 14, true);
    const out: { name: string; id: number; offset: number; isDir: boolean }[] = [];
    for (let i = 0; i < named + ided; i++) {
      const e = rsrcFile + at + 16 + i * 8;
      const raw = view.getUint32(e, true);
      const off = view.getUint32(e + 4, true);
      let name = String(raw);
      if (raw & 0x80000000) {
        const s = rsrcFile + (raw & 0x7fffffff);
        name = "";
        for (let c = 0; c < view.getUint16(s, true); c++) name += String.fromCharCode(view.getUint16(s + 2 + c * 2, true));
      }
      out.push({ name, id: raw & 0x80000000 ? -1 : raw, offset: off & 0x7fffffff, isDir: (off & 0x80000000) !== 0 });
    }
    return out;
  };

  const typeDir = dirEntries(0).find((e) => e.id === type && e.isDir);
  if (!typeDir) return [];
  const out: Resource[] = [];
  for (const named of dirEntries(typeDir.offset)) {
    if (!named.isDir) continue;
    for (const lang of dirEntries(named.offset)) {
      if (lang.isDir) continue;
      const at = rvaToFile(view.getUint32(rsrcFile + lang.offset, true));
      if (at === null) continue;
      const size = view.getUint32(rsrcFile + lang.offset + 4, true);
      out.push({ name: named.name, id: named.id, bytes: data.subarray(at, at + size) });
    }
  }
  return out;
}
