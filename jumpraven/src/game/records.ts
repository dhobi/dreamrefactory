/**
 * What a game holds between its levels, as RAVEN.EXE keeps it from 0x437858
 * on. File ▸ New fills it (0x4222fb(1)); the Mart spends and fills the
 * weapons; the flying (not ported yet) uses it all.
 */

/** a full load of anything: a weapon's ammunition, and the three bars (0x417c81, 0x417fd5 …) */
export const AMMO_FULL = 0x4380;
/** the six kinds of weapon, the Mart's columns */
export const KINDS = ["lasers", "shells", "rockets", "missiles", "bombs", "defensive"] as const;

export interface Records {
  /** `[0x43788c]`: the score, which the Mart spends as cash; a new game adds 1000 (0x42232b) */
  score: number;
  /** `[0x43b300]`: the pilot, 0 to 5 — which `trans<n>.move` ends the game (0x4268b3) */
  pilot: number;
  /** `[0x437858 + 4k]`: each kind's tier, 0 to 3 (0x417cc1) */
  tier: number[];
  /** `[0x437890 + 4k]`: each kind's ammunition, of {@link AMMO_FULL}; 0 is none (0x418044) */
  ammo: number[];
  /** `[0x4378c8]`, up to 4: a new game adds 4 (0x422346) */
  lives: number;
  /**
   * `[0x4378bc]`, `[0x4378c0]`, `[0x4378c4]`: three bars of up to {@link AMMO_FULL},
   * each filled by a new game (0x42233e, 0x422356, 0x422364) — which is which
   * is the flying's, not read yet
   */
  bars: [number, number, number];
  /** the flying's tally, which the debrief reads (src/game/debrief.ts) */
  tally: Tally;
}

/**
 * What the flying counts (0x43cf66 …), zeroed by File ▸ New (0x42236c): the
 * kills of each enemy the damage screen prices, and the shots and hits of each
 * weapon, the player's and the copilot's. Which kill is which enemy is read off
 * the damage screen's pictures (DAY2\DAMAGE), where each count is drawn.
 */
export interface Tally {
  /** `[0x43cf76]` $15, `[0x43cf66]` $25, `[0x43cf86]` $55, `[0x43cf9a]` $35 */
  kills: { bike: number; copter: number; tank: number; jeep: number };
  /** `[0x43cffa + 4k]`, `[0x43d012 + 4k]` */
  shots: number[];
  hits: number[];
  /** `[0x43cfca + 4k]`, `[0x43cfe2 + 4k]` */
  copilotShots: number[];
  copilotHits: number[];
}

export const newTally = (): Tally => ({
  kills: { bike: 0, copter: 0, tank: 0, jeep: 0 },
  shots: KINDS.map(() => 0),
  hits: KINDS.map(() => 0),
  copilotShots: KINDS.map(() => 0),
  copilotHits: KINDS.map(() => 0),
});

export const newRecords = (): Records => ({ score: 0, pilot: 0, tier: KINDS.map(() => 0), ammo: KINDS.map(() => 0), lives: 0, bars: [0, 0, 0], tally: newTally() });

/**
 * File ▸ New (0x4222fb(1)): every record zeroed (0x415f51) — but the pilot,
 * who is not among them — then 1000 points, four lives and the three bars full.
 */
export function startGame(r: Records): void {
  Object.assign(r, { ...newRecords(), pilot: r.pilot });
  r.score = 1000;
  r.lives = 4;
  r.bars = [AMMO_FULL, AMMO_FULL, AMMO_FULL];
}
