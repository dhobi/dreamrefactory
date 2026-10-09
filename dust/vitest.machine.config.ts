import { defineConfig } from "vitest/config";

/**
 * Dust's machine suites — the game played rather than probed, and checked
 * against the disc rather than against a golden.
 *
 * Split from the fast gate (`vitest.config.ts`) for the budget: a rung covers
 * minutes of game time against the virtual clock and drives the real route.
 *
 *   npm run test:machine -w dust
 *   npm run test:machine -w dust -- -t "D2A_001 → D2A_002"    # one rung
 *
 * The paths here are relative to THIS package, the way Titanic's playthrough
 * config beside it is, so both are run through their own workspace rather than
 * with a `--config` from the repository root.
 *
 * `.github/workflows/tests.yml` runs it on every change, in a step of its own
 * ("Dust machine suites"), as it does each game's machine suites.
 *
 * What it asserts is what Titanic's cannot: both ends of every rung are saves
 * `DF.EXE` wrote in 1995 ([the golden thread](../docs/dust/thread.md)), so a
 * pass says the port arrived where the original engine arrived.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/playthrough/playthrough.ts", "tests/speedrun/blackjack.ts", "tests/speedrun/menu-saves.ts"],
    // a rung plays the game; the cold boot alone is 154 s of game time
    testTimeout: 300_000,
  },
});
