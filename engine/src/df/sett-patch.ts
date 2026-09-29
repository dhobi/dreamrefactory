import { DFContainerFile } from "./container";
import { MazeQuad, MazeStar } from "./sett";

/**
 * The SETT editor's write path (site/editors/setts.html): an edit to a quad or
 * a star, written over the bytes it came from.
 *
 * A DreamFactory 5 room does not survive {@link writeContainerFile}: its
 * records are laid out with padding the writer does not keep, so a repack
 * changes bytes nobody edited. These patches never repack. The file's
 * containers are views into the one buffer it was read from, so a patch
 * writes into that buffer and the buffer is the export: every byte an edit
 * does not name is the byte it was, and a fresh {@link readSettFile} of it
 * reads the edit back.
 *
 * The records are found the way the reader walks them (engine/src/df/sett.ts):
 * a quad is the n-th 80-byte BLI3 record across the file's BLI3 containers,
 * and a star the n-th star across MARK's 66-byte records, a record's second
 * star counted after its first. Names are pstrs in 16-byte fields, so a name
 * keeps 15 characters.
 *
 * What the scripts ask for by name is not followed. A renamed quad is a quad
 * the room's scripts no longer find, and a moved star leaves a route that ends
 * on it (DRIV) where it was.
 */

const tagOf = (d: Uint8Array): string =>
  d.length >= 8 ? String.fromCharCode(d[7], d[6], d[5], d[4]) : "";
const view = (d: Uint8Array): DataView => new DataView(d.buffer, d.byteOffset, d.byteLength);

/** the longest name a quad's or a star's field holds */
export const SETT_NAME_MAX = 15;

/**
 * A pstr over the one in the field: its length and its characters, and nothing
 * past them. The shipped fields keep whatever was there before in their tails,
 * and the reader never looks past the length, so the tail is left alone.
 */
function writeName(d: Uint8Array, off: number, s: string): void {
  const n = Math.min(s.length, SETT_NAME_MAX);
  d[off] = n;
  for (let i = 0; i < n; i++) {
    const c = s.charCodeAt(i);
    d[off + 1 + i] = c > 0xff ? 0x3f : c;
  }
}

interface Record {
  data: Uint8Array;
  at: number;
}

function quadRecord(file: DFContainerFile, index: number): Record | null {
  let n = 0;
  for (const { data } of file.containers) {
    if (tagOf(data) !== "BLI3") continue;
    const count = view(data).getInt32(0x18, true);
    for (let i = 0; i < count; i++) {
      const at = 0x20 + i * 0x50;
      if (at + 0x50 > data.length) break;
      if (n++ === index) return { data, at };
    }
  }
  return null;
}

/** a star's point: +6 for a record's first, +0x26 for its second; the name 12 bytes on */
function starRecord(file: DFContainerFile, index: number): Record | null {
  let n = 0;
  for (const { data } of file.containers) {
    if (tagOf(data) !== "MARK") continue;
    const v = view(data);
    for (let i = 0, count = v.getInt32(0x18, true); i < count; i++) {
      const r = 0x20 + i * 0x42;
      if (r + 0x42 > data.length) break;
      if (n++ === index) return { data, at: r + 6 };
      if (!v.getInt32(r + 0x22, true)) continue;
      if (n++ === index) return { data, at: r + 0x26 };
    }
  }
  return null;
}

/** a quad's name and shape, as far as `q` gives them; false for no such quad */
export function patchQuad(file: DFContainerFile, index: number, q: Partial<Omit<MazeQuad, "script">>): boolean {
  const rec = quadRecord(file, index);
  if (!rec) return false;
  const { data, at } = rec;
  const v = view(data);
  if (q.name !== undefined) writeName(data, at + 0x1c, q.name);
  if (q.x !== undefined) v.setInt32(at + 0x2c, Math.round(q.x), true);
  if (q.y !== undefined) v.setInt32(at + 0x30, Math.round(q.y), true);
  if (q.z !== undefined) v.setInt32(at + 0x34, Math.round(q.z), true);
  if (q.heading !== undefined) v.setFloat64(at + 0x38, q.heading, true);
  if (q.pitch !== undefined) v.setFloat64(at + 0x40, q.pitch, true);
  if (q.w !== undefined) v.setInt32(at + 0x48, Math.round(q.w), true);
  if (q.h !== undefined) v.setInt32(at + 0x4c, Math.round(q.h), true);
  return true;
}

/** a star's name and point; false for no such star */
export function patchStar(file: DFContainerFile, index: number, s: Partial<MazeStar>): boolean {
  const rec = starRecord(file, index);
  if (!rec) return false;
  const { data, at } = rec;
  const v = view(data);
  if (s.x !== undefined) v.setInt32(at, Math.round(s.x), true);
  if (s.y !== undefined) v.setInt32(at + 4, Math.round(s.y), true);
  if (s.z !== undefined) v.setInt32(at + 8, Math.round(s.z), true);
  if (s.name !== undefined) writeName(data, at + 12, s.name);
  return true;
}
