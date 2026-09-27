/**
 * LUNICUS.FON — the one font the game draws its text in ("Raven Digital", 12
 * point, 16 pixels high). The EXE adds it with `AddFontResourceA` at startup
 * (0x40b387) and every string it draws — the HUD's message line and a
 * conversation's menu — is in it.
 *
 * A .FON is a Windows NE module whose FONT resources are .FNT bitmap fonts. This
 * one has a single version-3 font: a 148-byte header, a table of {u16 width,
 * u32 offset} per character, and each glyph stored a column of 8 pixels at a
 * time, top to bottom, a bit a pixel with the leftmost the high bit.
 */

export interface BitmapFont {
  height: number;
  ascent: number;
  first: number;
  last: number;
  /** per character code: its width and its rows as bits, leftmost first */
  glyphs: Map<number, { width: number; rows: Uint8Array[] }>;
}

export function readFon(data: Uint8Array): BitmapFont {
  const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const ne = v.getUint32(0x3c, true);
  if (v.getUint16(ne, true) !== 0x454e) throw new Error("not an NE font file");
  const table = ne + v.getUint16(ne + 0x24, true);
  const shift = v.getUint16(table, true);
  for (let p = table + 2; v.getUint16(p, true); ) {
    const type = v.getUint16(p, true);
    const count = v.getUint16(p + 2, true);
    p += 8;
    for (let i = 0; i < count; i++, p += 12) {
      if (type !== 0x8008) continue;
      return readFnt(data.subarray(v.getUint16(p, true) << shift));
    }
  }
  throw new Error("no FONT resource");
}

function readFnt(f: Uint8Array): BitmapFont {
  const v = new DataView(f.buffer, f.byteOffset, f.byteLength);
  const version = v.getUint16(0, true);
  const height = v.getUint16(0x58, true);
  const ascent = v.getUint16(0x4a, true);
  const first = f[0x5f];
  const last = f[0x60];
  const v3 = version >= 0x300;
  const at = v3 ? 148 : 118;
  const glyphs = new Map<number, { width: number; rows: Uint8Array[] }>();
  for (let c = first; c <= last; c++) {
    const e = at + (c - first) * (v3 ? 6 : 4);
    const width = v.getUint16(e, true);
    const off = v3 ? v.getUint32(e + 2, true) : v.getUint16(e + 2, true);
    const cols = Math.ceil(width / 8);
    const rows = Array.from({ length: height }, () => new Uint8Array(width));
    for (let col = 0; col < cols; col++) {
      for (let y = 0; y < height; y++) {
        const byte = f[off + col * height + y];
        for (let b = 0; b < 8 && col * 8 + b < width; b++) rows[y][col * 8 + b] = (byte >> (7 - b)) & 1;
      }
    }
    glyphs.set(c, { width, rows });
  }
  return { height, ascent, first, last, glyphs };
}

export function textWidth(font: BitmapFont, text: string): number {
  let w = 0;
  for (const ch of text) w += font.glyphs.get(ch.charCodeAt(0))?.width ?? 0;
  return w;
}
