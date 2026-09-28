/**
 * LUNICUS.SCO — the keys and the high scores, one 1040-byte file.
 *
 * LUNICUS.EXE keeps it in one block (`[0x42c050]`, 0x410 bytes, 0x416f4c):
 *
 *   0x000  the key table: a byte per character code, the action that
 *          character is (0 none, 1 forward, 2 left, 3 right, 4 navigate,
 *          5 bullets, 6 grenades, 7 rockets); looked up at 0x4173ff by the
 *          city (0x40666d) and the base (0x40cd1b)
 *   0x100  the high scores: 4 difficulties x 7 places x 28 bytes — an i32
 *          score, then the name as a Pascal string of at most 23 characters
 *          (0x4189f8) — best first (0x417a44 sorts them)
 *
 * At startup (0x416fae → 0x417c59) the block is the defaults — the EXE's own
 * key table (0x428674) and 28 empty places — and then the file read over it
 * (0x417d01); the arrows' three entries are put back whatever the file said
 * (0x417efb). It is written back when the window closes (0x417ce4 → 0x417da5,
 * type 'LSCO', creator 'STAR'). The rip's file is the defaults to the byte, but
 * for leftovers after the empty names.
 */

export const SCO_SIZE = 0x410;
const TABLE = 0x100;
const PLACE = 0x1c;
const DIFFICULTY = PLACE * 7;
/** the name's longest (0x4189f8) */
export const NAME_MAX = 23;

/** the actions a key can be (the dialog's fields, 0x418b96: ids 108–114 in this order) */
export const ACTIONS = ["Forward", "Left", "Right", "Navigate", "Bullets", "Grenades", "Rockets"] as const;

/**
 * The arrows as the EXE sees them: Macintosh character codes, 0x1c–0x1f for
 * left, right, up and down. Up, left and right are always forward, left and
 * right (0x417efb); down is nothing.
 */
const ARROWS: Record<string, number> = { ArrowLeft: 0x1c, ArrowRight: 0x1d, ArrowUp: 0x1e, ArrowDown: 0x1f };

export interface Place {
  score: number;
  name: string;
}

export interface Sco {
  keys: Uint8Array;
  /** per difficulty 1–4 (index 0 is Beginner), seven places, best first */
  scores: Place[][];
}

/** 0x428674: W A D walk, H J K L the modes, in either case */
function defaultKeys(): Uint8Array {
  const t = new Uint8Array(TABLE);
  "WADHJKL".split("").forEach((c, i) => (t[c.charCodeAt(0)] = t[c.toLowerCase().charCodeAt(0)] = i + 1));
  return t;
}

/** 0x417efb: the arrows are forward, left and right, whatever the table said */
function fixArrows(t: Uint8Array): void {
  t[ARROWS.ArrowUp] = 1;
  t[ARROWS.ArrowLeft] = 2;
  t[ARROWS.ArrowRight] = 3;
}

/** the block before a file is read over it (0x417c59), the arrows put in */
export function defaultSco(): Sco {
  const keys = defaultKeys();
  fixArrows(keys);
  return { keys, scores: [1, 2, 3, 4].map(() => Array.from({ length: 7 }, () => ({ score: 0, name: "" }))) };
}

export function readSco(bytes: Uint8Array): Sco {
  if (bytes.length !== SCO_SIZE) throw new Error(`lunicus.sco is ${bytes.length} bytes, not ${SCO_SIZE}`);
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const keys = bytes.slice(0, TABLE);
  fixArrows(keys);
  const scores = [0, 1, 2, 3].map((d) =>
    Array.from({ length: 7 }, (_, i) => {
      const at = TABLE + d * DIFFICULTY + i * PLACE;
      const n = Math.min(bytes[at + 4], NAME_MAX);
      return { score: v.getInt32(at, true), name: String.fromCharCode(...bytes.subarray(at + 5, at + 5 + n)) };
    }),
  );
  return { keys, scores };
}

export function writeSco(s: Sco): Uint8Array {
  const out = new Uint8Array(SCO_SIZE);
  const v = new DataView(out.buffer);
  out.set(s.keys.subarray(0, TABLE));
  s.scores.forEach((places, d) =>
    places.forEach((p, i) => {
      const at = TABLE + d * DIFFICULTY + i * PLACE;
      v.setInt32(at, p.score, true);
      const name = p.name.slice(0, NAME_MAX);
      out[at + 4] = name.length;
      for (let k = 0; k < name.length; k++) out[at + 5 + k] = name.charCodeAt(k) & 0xff;
    }),
  );
  return out;
}

/** a key as `KeyboardEvent.key` names it, as the EXE's character code; -1 for none it has */
export function charOf(key: string): number {
  if (key in ARROWS) return ARROWS[key];
  return key.length === 1 && key.charCodeAt(0) < TABLE ? key.charCodeAt(0) : -1;
}

/** 0x4173ff: the action a key is, 0 for none */
export function actionOf(keys: Uint8Array, key: string): number {
  const c = charOf(key);
  return c < 0 ? 0 : keys[c];
}

/**
 * 0x417ead: what the Keys dialog shows for an action — the first letter, then
 * the first digit, bound to it; "" for none.
 */
export function keyFor(keys: Uint8Array, action: number): string {
  for (let c = 0x41; c <= 0x5a; c++) if (keys[c] === action) return String.fromCharCode(c);
  for (let c = 0x30; c <= 0x39; c++) if (keys[c] === action) return String.fromCharCode(c);
  return "";
}

/**
 * 0x418c29: the dialog's OK — the table emptied, each field's first character
 * bound (a letter in both cases, 0x418db1), the arrows put back. `fields` are in
 * {@link ACTIONS} order.
 */
export function bindKeys(fields: readonly string[]): Uint8Array {
  const t = new Uint8Array(TABLE);
  fields.forEach((f, i) => {
    let c = f.length ? f.charCodeAt(0) & 0xff : 0;
    if (c >= 0x61 && c <= 0x7a) c -= 0x20;
    t[c] = i + 1;
    if (c >= 0x41) t[c | 0x20] = i + 1;
  });
  fixArrows(t);
  return t;
}

/** the EXE's own table, for the dialog's Default button (0x418d03) */
export function defaultTable(): Uint8Array {
  const t = defaultKeys();
  fixArrows(t);
  return t;
}

/** 0x41735a: does this score go in? Only past the seventh place, strictly */
export function qualifies(s: Sco, difficulty: number, score: number): boolean {
  return score > s.scores[difficulty - 1][6].score;
}

/**
 * 0x4173b1: the seventh place taken, then 0x417a44's sort — each place against
 * every one below it, swapped only when strictly lower, so a tie stays under.
 */
export function enter(s: Sco, difficulty: number, place: Place): void {
  const p = s.scores[difficulty - 1];
  p[6] = { ...place, name: place.name.slice(0, NAME_MAX) };
  for (let i = 0; i < 6; i++) for (let j = i + 1; j < 7; j++) if (p[i].score < p[j].score) [p[i], p[j]] = [p[j], p[i]];
}
