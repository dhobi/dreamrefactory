/**
 * The DreamFactory 0 saved game, `.LUN`: Lunicus's.
 *
 * *Prerequisite: [docs/engine/formats/dreamfactory-0.md](../../../docs/engine/formats/dreamfactory-0.md),
 * "Saved games".*
 *
 * Twenty-six bytes and nothing else — no container, no header: LUNICUS.EXE
 * writes a record of little-endian words straight to the file (0x417944, Mac
 * type `LSAV`, creator `STAR`, "Lunicus (.LUN)" in the dialog) and reads the
 * same 26 bytes back into `0x42c02c` (0x41771d). A game is its level, its
 * place on it and the day's progress, and the HUD: which is why a save holds
 * neither the suit nor the gun, nor the crew, nor which cabinets are empty — a
 * loaded level opens as a level does (0x4184cc, File ▸ Open).
 */

export const SAVE_V0_SIZE = 0x1a;

export interface SaveGameV0 {
  /** `[0x42c15c]` Settings ▸ Beginner 1 … Expert 4 */
  difficulty: number;
  /** `[0x42d1bc]` 1 … 22 */
  level: number;
  /** `[0x42d1c0]` where the player came in: a floor of a building, which door of the base */
  came: number;
  /** `[0x42d1c4]` which of the base's elevators */
  elevator: number;
  /** `[0x42d1c8]` the day's progress */
  progress: number;
  /** `[0x42b3c0]`, the one dword */
  score: number;
  /** `[0x42b448]`, `[0x42b440]`, `[0x42b438]`: 0 … 10000 */
  enemies: number;
  energy: number;
  shields: number;
  /** `[0x42b458]`, `[0x42b450]`, `[0x42b454]` */
  bullets: number;
  grenades: number;
  rockets: number;
}

/** 0x417944 */
export function writeSaveV0(s: SaveGameV0): Uint8Array {
  const b = new Uint8Array(SAVE_V0_SIZE);
  const v = new DataView(b.buffer);
  const words: [number, number][] = [
    [0x00, s.difficulty], [0x02, s.level], [0x04, s.came], [0x06, s.elevator], [0x08, s.progress],
    [0x0e, s.enemies], [0x10, s.energy], [0x12, s.shields], [0x14, s.bullets], [0x16, s.grenades], [0x18, s.rockets],
  ];
  for (const [at, n] of words) v.setInt16(at, n, true);
  v.setInt32(0x0a, s.score, true);
  return b;
}

/** 0x41771d, and the fields 0x4184cc puts back */
export function readSaveV0(bytes: Uint8Array): SaveGameV0 {
  if (bytes.length !== SAVE_V0_SIZE) throw new Error(`a Lunicus save is ${SAVE_V0_SIZE} bytes, not ${bytes.length}`);
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const w = (at: number): number => v.getInt16(at, true);
  return {
    difficulty: w(0x00), level: w(0x02), came: w(0x04), elevator: w(0x06), progress: w(0x08),
    score: v.getInt32(0x0a, true),
    enemies: w(0x0e), energy: w(0x10), shields: w(0x12), bullets: w(0x14), grenades: w(0x16), rockets: w(0x18),
  };
}

/** what a page may take for a save: the size, and fields a game could hold */
export function isSaveV0(bytes: Uint8Array): boolean {
  if (bytes.length !== SAVE_V0_SIZE) return false;
  const s = readSaveV0(bytes);
  const gauge = (n: number): boolean => n >= 0 && n <= 10000;
  return s.difficulty >= 1 && s.difficulty <= 4 && s.level >= 1 && s.level <= 22 && s.score >= 0 &&
    [s.enemies, s.energy, s.shields, s.bullets, s.grenades, s.rockets].every(gauge);
}
