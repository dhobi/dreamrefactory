/**
 * DreamFactory 0's palettes that are not in any game file: *Lunicus* keeps the
 * one its base, city and mazes are drawn in, and the flashes over it, as `CLUT`
 * resources in LUNIRES.DLL (CLUT128, and 129 to 135). A resource is a Mac
 * `clut`: an 8-byte header, then 256 entries of {u16 index, u16 r, g, b}, big
 * endian, of which the high byte of each colour is kept.
 */

/** a named CLUT resource of LUNIRES.DLL, as RGBA; the base is drawn in CLUT128 (0x40a988) */
export function readClutV0(dll: Uint8Array, name: string): Uint8ClampedArray {
  const v = new DataView(dll.buffer, dll.byteOffset, dll.byteLength);
  const pe = v.getUint32(0x3c, true);
  const nsec = v.getUint16(pe + 6, true);
  const opt = pe + 24;
  const secs = Array.from({ length: nsec }, (_, i) => {
    const s = opt + v.getUint16(pe + 20, true) + i * 40;
    return { va: v.getUint32(s + 12, true), size: Math.max(v.getUint32(s + 8, true), v.getUint32(s + 16, true)), raw: v.getUint32(s + 20, true) };
  });
  const off = (rva: number): number => {
    const s = secs.find((x) => rva >= x.va && rva < x.va + x.size);
    if (!s) throw new Error(`rva ${rva} in no section`);
    return rva - s.va + s.raw;
  };
  const root = off(v.getUint32(opt + 96 + 2 * 8, true));
  const nameAt = (o: number): string => String.fromCharCode(...Array.from({ length: v.getUint16(root + o, true) }, (_, i) => v.getUint16(root + o + 2 + i * 2, true)));
  const entries = (dir: number): { id: number | string; to: number }[] => {
    const n = v.getUint16(root + dir + 12, true) + v.getUint16(root + dir + 14, true);
    return Array.from({ length: n }, (_, i) => {
      const id = v.getUint32(root + dir + 16 + i * 8, true);
      return { id: id & 0x80000000 ? nameAt(id & 0x7fffffff) : id, to: v.getUint32(root + dir + 20 + i * 8, true) };
    });
  };
  const type = entries(0).find((e) => e.id === 10);
  const res = type && entries(type.to & 0x7fffffff).find((e) => e.id === name);
  if (!res) throw new Error(`no ${name} in LUNIRES.DLL`);
  const lang = entries(res.to & 0x7fffffff)[0];
  const at = off(v.getUint32(root + lang.to, true));
  const rgba = new Uint8ClampedArray(1024);
  for (let i = 0; i < 256; i++) {
    const e = at + 8 + i * 8;
    rgba[i * 4] = dll[e + 3];
    rgba[i * 4 + 1] = dll[e + 5];
    rgba[i * 4 + 2] = dll[e + 7];
    rgba[i * 4 + 3] = 255;
  }
  return rgba;
}
