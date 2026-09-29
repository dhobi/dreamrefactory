/**
 * Jump Raven's saved game, `.RVN`: 0x94 bytes, no container, no header.
 *
 * The HUD's SAVE (0x421094(0)) asks for a name (0x4225b3, "Jump Raven
 * (.RVN)"), and 0x4218a8 builds the record on its stack and writes it whole
 * (Mac type `RSAV`, creator `RAVE`). File ▸ Open (0x4222fb(2)) reads the same
 * 0x94 bytes into `0x439ee8` (0x421487) and 0x421199 puts them back.
 *
 * A game is what it holds between its levels (src/game/records.ts), the
 * difficulty, the pilot, the band and the level — nothing of the flight: a
 * save made in a flight opens at that flight's start. Little-endian words,
 * but for the score and the weapons' shots and hits, which are dwords; the
 * kills are words, cut from the EXE's dwords.
 */
import { KINDS, type Records } from "./records";

export const RVN_SIZE = 0x94;

export interface SavedGame {
  /** +0x00 `[0x439fb0]` 1 to 4 */
  difficulty: number;
  /** +0x02 `[0x43b2fc]` */
  level: number;
  /** +0x04 `[0x43b300]` 0 to 5 */
  pilot: number;
  /** +0x06 `[0x43b304]` */
  band: number;
  /** +0x08, +0x0c …, +0x88 … and +0x18 … +0x1e, and the tally from +0x20 */
  records: Records;
}

/** 0x4218a8: the record as the stack has it, [ebp−0xa4, ebp−0x10) */
export function writeRvn(s: SavedGame): Uint8Array {
  const b = new Uint8Array(RVN_SIZE);
  const v = new DataView(b.buffer);
  const w = (at: number, n: number): void => v.setInt16(at, n, true);
  const d = (at: number, n: number): void => v.setInt32(at, n, true);
  const r = s.records;
  const t = r.tally;
  w(0x00, s.difficulty);
  w(0x02, s.level);
  w(0x04, s.pilot);
  w(0x06, s.band);
  d(0x08, r.score);
  KINDS.forEach((_, k) => {
    w(0x0c + 2 * k, r.ammo[k]);
    d(0x20 + 4 * k, t.copilotShots[k]);
    d(0x38 + 4 * k, t.copilotHits[k]);
    d(0x50 + 4 * k, t.shots[k]);
    d(0x68 + 4 * k, t.hits[k]);
    w(0x88 + 2 * k, r.tier[k]);
  });
  // 0x417923 PODS, 0x417929 the lives, 0x417917 SHLD, 0x41791d FUEL
  w(0x18, r.bars[1]);
  w(0x1a, r.lives);
  w(0x1c, r.bars[0]);
  w(0x1e, r.bars[2]);
  // `[0x43cf66]` jeeps, `[0x43cf76]` bikes, `[0x43cf86]` tanks, `[0x43cf9a]` copters
  w(0x80, t.kills.jeep);
  w(0x82, t.kills.bike);
  w(0x84, t.kills.tank);
  w(0x86, t.kills.copter);
  return b;
}

/**
 * 0x421487 and 0x421199: the fields as the EXE takes them back — the records
 * zeroed (0x415f51) and each added through its own adder, which keeps it in
 * its range (the score not below 0, the lives 0 to 4, the bars and the
 * ammunition 0 to 0x4380); the tiers and the tally are stored as they come.
 */
export function readRvn(bytes: Uint8Array): SavedGame {
  if (bytes.length !== RVN_SIZE) throw new Error(`a Jump Raven save is ${RVN_SIZE} bytes, not ${bytes.length}`);
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const w = (at: number): number => v.getInt16(at, true);
  const d = (at: number): number => v.getInt32(at, true);
  const clamp = (n: number, hi: number): number => Math.max(0, Math.min(hi, n));
  const FULL = 0x4380;
  const each = (at: number, step: number, read: (at: number) => number): number[] => KINDS.map((_, k) => read(at + step * k));
  return {
    difficulty: w(0x00),
    level: w(0x02),
    pilot: w(0x04),
    band: w(0x06),
    records: {
      score: Math.max(0, d(0x08)),
      pilot: w(0x04),
      ammo: each(0x0c, 2, w).map((n) => clamp(n, FULL)),
      tier: each(0x88, 2, w),
      lives: clamp(w(0x1a), 4),
      bars: [clamp(w(0x1c), FULL), clamp(w(0x18), FULL), clamp(w(0x1e), FULL)],
      tally: {
        kills: { jeep: w(0x80), bike: w(0x82), tank: w(0x84), copter: w(0x86) },
        copilotShots: each(0x20, 4, d),
        copilotHits: each(0x38, 4, d),
        shots: each(0x50, 4, d),
        hits: each(0x68, 4, d),
      },
    },
  };
}

/** what a page may take for a save: the size, and fields a game could hold */
export function isRvn(bytes: Uint8Array): boolean {
  if (bytes.length !== RVN_SIZE) return false;
  const s = readRvn(bytes);
  return s.difficulty >= 1 && s.difficulty <= 4 && s.level >= 0 && s.level <= 8 && s.pilot >= 0 && s.pilot <= 5 &&
    s.records.tier.every((t) => t >= 0 && t <= 3);
}
