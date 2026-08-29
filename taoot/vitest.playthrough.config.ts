import { defineConfig } from "vitest/config";

/**
 * Playthroughs — the game played rather than probed.
 *
 * Split from the fast gate (`vitest.config.ts` beside this file) because these are a different
 * kind of test with a different budget: a segment covers minutes of game time
 * against the virtual clock, drives the real route, and asserts a recorded
 * state trace rather than a hand-written expectation. Keeping them here means
 * `npm test` stays a commit-time gate while the playthrough grows a mission at
 * a time.
 *
 *   npm run test:playthrough -w taoot
 *   TAOOT_RECORD=1 npm run test:playthrough -w taoot   # re-record the traces
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/playthrough/playthrough.ts"],
    // a segment plays the game; the cold boot alone is 154 s of game time
    testTimeout: 300_000,
  },
});
