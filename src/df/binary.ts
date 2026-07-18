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
