/**
 * Skull Cracker's dice — the executable's own generator, so that a level plays
 * the same rolls every time it starts, as the original does.
 *
 * `0x434560` is a lagged Fibonacci generator over a table of 55 words at
 * `0x4a6f00`, with lags 24 and 55:
 *
 * ```
 *   i = (i + 1) % 55                           ; [0x4a6fdc]
 *   t[i] = (t[(i + 54) % 55] + t[(i + 23) % 55]) & 0x7fffffff
 *   return the sum before the mask
 * ```
 *
 * and `0x4344f0(seed)` fills the table — `t[0] = seed`, then each word is the
 * last times 31 plus 1 — and zeroes the index. Both of the level's entry
 * routines seed it with the same constant, `0x149052` (`0x4036ff`,
 * `0x403770`), so the dice are not random at all: every level opens on the
 * same sequence.
 */
const table = new Int32Array(55);
let index = 0;

/** `0x4344f0` */
export function seedRandom(seed = 0x149052): void {
  table[0] = seed;
  for (let i = 1; i < 55; i++) table[i] = (Math.imul(table[i - 1], 31) + 1) & 0x7fffffff;
  index = 0;
}

/** `0x434560` — the next word, unmasked as the executable returns it */
export function nextRandom(): number {
  index = (index + 1) % 55;
  const sum = (table[(index + 54) % 55] + table[(index + 23) % 55]) | 0;
  table[index] = sum & 0x7fffffff;
  return sum;
}

/** `0x434540(n)` — 1…n, and 0 for a count of nothing */
export function roll(n: number): number {
  if (n <= 0) return 0;
  return ((nextRandom() & 0x7fffffff) % n) + 1;
}

/**
 * A fraction in [0, 1) off the same dice, for the places this port rolls where
 * the executable's own call has not been traced to a count — so that they too
 * repeat with the level.
 */
export function random(): number {
  return (nextRandom() & 0x7fffffff) / 0x80000000;
}

seedRandom();
