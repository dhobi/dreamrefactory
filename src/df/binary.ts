/**
 * Little helper around DataView for the DreamFactory binary formats.
 * Integers are little-endian; doubles/floats are stored big-endian
 * (the engine's Mac heritage), matching dfet's swapEndians().
 */
export class BinaryReader {
  readonly view: DataView;
  readonly bytes: Uint8Array;
  pos: number;

  constructor(data: Uint8Array, pos = 0) {
    this.bytes = data;
    this.view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    this.pos = pos;
  }

  u8(): number {
    return this.bytes[this.pos++];
  }
  i16(): number {
    const v = this.view.getInt16(this.pos, true);
    this.pos += 2;
    return v;
  }
  u16(): number {
    const v = this.view.getUint16(this.pos, true);
    this.pos += 2;
    return v;
  }
  i32(): number {
    const v = this.view.getInt32(this.pos, true);
    this.pos += 4;
    return v;
  }
  u32(): number {
    const v = this.view.getUint32(this.pos, true);
    this.pos += 4;
    return v;
  }
  /** big-endian double (dfet: swapEndians for double) */
  f64be(): number {
    const v = this.view.getFloat64(this.pos, false);
    this.pos += 8;
    return v;
  }
  /** big-endian float (dfet: swapEndians for float) */
  f32be(): number {
    const v = this.view.getFloat32(this.pos, false);
    this.pos += 4;
    return v;
  }
  /**
   * Pascal string: one length byte followed by the characters.
   * `fieldSize` is the total reserved size of the character field
   * (excluding the length byte); pos always advances past the whole field.
   * When fieldSize is omitted the cursor advances just past the string.
   */
  pstr(fieldSize?: number): string {
    const len = this.bytes[this.pos];
    const start = this.pos + 1;
    const s = latin1(this.bytes.subarray(start, start + len));
    this.pos = fieldSize !== undefined ? start + fieldSize : start + len;
    return s;
  }
  skip(n: number): void {
    this.pos += n;
  }
  seek(p: number): void {
    this.pos = p;
  }
}

export function latin1(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return s;
}

/**
 * Pascal string ([u8 length][chars]) at an absolute offset, unvalidated —
 * for fields known to hold a string. See {@link pstrAtChecked} for probing.
 */
export function pstrAt(d: Uint8Array, off: number): string {
  const len = d[off] ?? 0;
  return latin1(d.subarray(off + 1, off + 1 + len));
}

/**
 * Write a Pascal string into a fixed-size field: length byte + latin1 chars,
 * the rest of the field zeroed. `fieldSize` is the reserved character count
 * (excluding the length byte), matching {@link BinaryReader.pstr}; the string
 * is clamped to it and non-latin1 characters become "?".
 */
export function writePstrAt(d: Uint8Array, off: number, s: string, fieldSize: number): void {
  const n = Math.min(s.length, fieldSize);
  d[off] = n;
  for (let i = 0; i < fieldSize; i++) {
    const c = i < n ? s.charCodeAt(i) : 0;
    d[off + 1 + i] = c > 0xff ? 0x3f : c;
  }
}

/**
 * Write a pascal name into a fixed-size field, clamped to the field AND to
 * what the container actually holds, and answer what was stored. The second
 * clamp matters because a shipped record's name field is sometimes the last
 * thing in its container: writing the full field would run off the end.
 * The editors show the stored string back, so a clamped name is visible.
 */
export function writeNameAt(d: Uint8Array, off: number, s: string, fieldSize: number): string {
  const fit = Math.max(0, Math.min(fieldSize, d.length - off - 1));
  writePstrAt(d, off, s, fit);
  return s.slice(0, fit);
}

/**
 * Pascal string at an absolute offset, VALIDATED: the length must be within
 * [minLen, maxLen], fit the buffer, and every character must be printable
 * ASCII. Returns null otherwise. This is the prober the heuristic scanners
 * (save-game containers, movie tables) use to tell real strings from
 * pointer/padding junk.
 */
export function pstrAtChecked(
  d: Uint8Array,
  off: number,
  minLen: number,
  maxLen: number,
): string | null {
  if (off < 0 || off >= d.length) return null;
  const n = d[off];
  if (n < minLen || n > maxLen || off + 1 + n > d.length) return null;
  let s = "";
  for (let j = 0; j < n; j++) {
    const c = d[off + 1 + j];
    if (c < 0x20 || c > 0x7e) return null;
    s += String.fromCharCode(c);
  }
  return s;
}
