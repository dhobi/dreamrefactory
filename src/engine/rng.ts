/**
 * A seedable random source for {@link GameSession.rng}.
 *
 * The game draws from `random()` at points that decide observable state (TAOOT:
 * the bomb delay in BEDSIT1, the arrival second in advanceday), so a playthrough
 * recorded against Math.random can't be diffed against a replay of itself.
 * Swapping in `seededRng(n)` makes those draws a function of the seed alone —
 * the run becomes reproducible without the harness having to mask the fields
 * the draws feed.
 *
 * mulberry32: 32-bit state, uniform enough for this (the engine only ever asks
 * for small integers) and identical across engines — the same seed gives the
 * same sequence in Node and in a browser, which is what lets a headless trace
 * and a Playwright trace be compared byte for byte.
 */
export function seededRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
