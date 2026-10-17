/**
 * What LUNICUS.SCO and RAVEN.SCO have in common: a 256-byte key table, a byte
 * per character code naming the action that character is, then the high scores
 * as places of an i32 score and a Pascal-string name. Where each puts its
 * places, how many characters a name keeps and where the arrows go are the
 * game's (lunicus/ and jumpraven/src/game/sco.ts).
 */

/** one high score */
export interface Place {
  score: number;
  name: string;
}

/** the key table's size: a byte per character code */
export const KEY_TABLE = 0x100;

/** the place at `at`: the i32 score, then the name's length byte and at most `nameMax` characters */
export function readPlace(bytes: Uint8Array, at: number, nameMax: number): Place {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const n = Math.min(bytes[at + 4], nameMax);
  return { score: v.getInt32(at, true), name: String.fromCharCode(...bytes.subarray(at + 5, at + 5 + n)) };
}

/** {@link readPlace}'s other way, the name cut to `nameMax` */
export function writePlace(bytes: Uint8Array, at: number, place: Place, nameMax: number): void {
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setInt32(at, place.score, true);
  const name = place.name.slice(0, nameMax);
  bytes[at + 4] = name.length;
  for (let k = 0; k < name.length; k++) bytes[at + 5 + k] = name.charCodeAt(k) & 0xff;
}

/** what the Keys dialog shows for an action: the first letter, then the first digit, bound to it; "" for none */
export function letterOrDigitFor(keys: Uint8Array, action: number): string {
  for (let c = 0x41; c <= 0x5a; c++) if (keys[c] === action) return String.fromCharCode(c);
  for (let c = 0x30; c <= 0x39; c++) if (keys[c] === action) return String.fromCharCode(c);
  return "";
}

/**
 * The Keys dialog's OK: an empty table, each field's first character bound to
 * its action (1 for the first field), a letter in both cases. The arrows are
 * the caller's to put back.
 */
export function bindFirstCharacters(fields: readonly string[]): Uint8Array {
  const t = new Uint8Array(KEY_TABLE);
  fields.forEach((f, i) => {
    let c = f.length ? f.charCodeAt(0) & 0xff : 0;
    if (c >= 0x61 && c <= 0x7a) c -= 0x20;
    t[c] = i + 1;
    if (c >= 0x41) t[c | 0x20] = i + 1;
  });
  return t;
}
