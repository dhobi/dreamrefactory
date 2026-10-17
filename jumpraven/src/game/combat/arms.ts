/**
 * The weapons' names both the pyro (pyro.ts, which fires them) and the shots
 * in the air (shots.ts, which move and draw them) use: the six kinds, and
 * where each is in `pyro`'s pictures.
 */

/** the six kinds of weapon, the HUD's (records.ts KINDS) */
export const LASERS = 0;
export const SHELLS = 1;
export const ROCKETS = 2;
export const MISSILES = 3;
export const BOMBS = 4;
export const DEFENSIVE = 5;

/** `pyro`'s pictures (0x4379d0 + 4·index): each a row of 16 (or 4) by distance unless said */
export const PIC = {
  /** lasers' beams, tier 0 and 2 (4) and tier 1 and 3 (4) */
  laser: 0x00,
  laser2: 0x04,
  shell: 0x08,
  tracer: 0x18,
  fireball: 0x28,
  /** 32 */
  spark: 0x38,
  rocket: 0x58,
  missile: 0x68,
  /** a closed defensive, 8 frames */
  decoy: 0x78,
  /** an open one: tier 3 (9 frames), tier 2 (13), tier 1 (10) */
  open3: 0x80,
  open2: 0x89,
  open1: 0x96,
  bomb: 0xa0,
  chaff: 0xb0,
  blast: 0xc0,
  blast2: 0xd0,
  /** a shot on a wall */
  chip: 0xe0,
  /** the aim's and the homing's marks, 4 each */
  aimMark: 0xf0,
  homeMark: 0xf4,
  salvage: 0xf8,
  /** a shot on an enemy */
  hit: 0x108,
  smoke: 0x118,
  /** the salvage's mark, 4 */
  salvageMark: 0x128,
} as const;
