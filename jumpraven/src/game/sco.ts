/**
 * RAVEN.SCO — the key table and the high scores, 648 bytes, the block RAVEN.EXE
 * reads at startup into `[0x439f88]` (0x41e0e2(0x288)) and writes back as it
 * quits (0x421bab).
 *
 *   0x000  256 bytes: the key table, a character's action (the same table as
 *          LUNICUS.SCO's; the flying reads it)
 *   0x100  per difficulty 1 to 4, at 0x9e + 0x62 × difficulty, seven places
 *          of 14 bytes: i32 the score, then the name, a pstr of up to 9
 *
 * The places are kept best first: the screen sorts them before it draws
 * (0x4216be), and a new score takes the seventh place and is sorted in.
 */
export const SCO_SIZE = 0x288;
const PLACES = 7;
const PLACE_BYTES = 14;
const NAME_MAX = 9;
const placesAt = (difficulty: number): number => 0x9e + 0x62 * difficulty;

export interface Place {
  score: number;
  name: string;
}

export interface Sco {
  keys: Uint8Array;
  /** per difficulty 1 to 4 (index 0 is Training) */
  places: Place[][];
}

export function readSco(bytes: Uint8Array): Sco {
  if (bytes.length !== SCO_SIZE) throw new Error(`RAVEN.SCO: ${bytes.length} bytes, not ${SCO_SIZE}`);
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const places = [1, 2, 3, 4].map((d) =>
    Array.from({ length: PLACES }, (_, i): Place => {
      const at = placesAt(d) + i * PLACE_BYTES;
      const n = Math.min(bytes[at + 4], NAME_MAX);
      return { score: v.getInt32(at, true), name: String.fromCharCode(...bytes.subarray(at + 5, at + 5 + n)) };
    }),
  );
  return { keys: bytes.slice(0, 0x100), places };
}

export function writeSco(sco: Sco): Uint8Array {
  const bytes = new Uint8Array(SCO_SIZE);
  const v = new DataView(bytes.buffer);
  bytes.set(sco.keys.subarray(0, 0x100));
  sco.places.forEach((list, k) =>
    list.slice(0, PLACES).forEach((p, i) => {
      const at = placesAt(k + 1) + i * PLACE_BYTES;
      v.setInt32(at, p.score, true);
      const name = p.name.slice(0, NAME_MAX);
      bytes[at + 4] = name.length;
      for (let c = 0; c < name.length; c++) bytes[at + 5 + c] = name.charCodeAt(c) & 0xff;
    }),
  );
  return bytes;
}

/** 0x4216be: best first; equal scores keep their order */
export function sortPlaces(list: Place[]): void {
  list.sort((a, b) => b.score - a.score);
}

/** 0x420e31: a score that goes on the screen — over 1000, and over the seventh place */
export function qualifies(sco: Sco, difficulty: number, score: number): boolean {
  const list = sco.places[difficulty - 1];
  return score > 1000 && score > list[PLACES - 1].score;
}
