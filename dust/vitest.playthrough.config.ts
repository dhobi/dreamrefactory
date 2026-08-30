import { defineConfig } from "vitest/config";

/**
 * Dust's playthrough — the game played rather than probed, and checked against
 * the disc rather than against a golden.
 *
 * Split from the fast gate (`vitest.config.ts`) for the budget: a rung covers
 * minutes of game time against the virtual clock and drives the real route.
 *
 *   npm run test:playthrough -w dust
 *   npm run test:playthrough -w dust -- -t "D2A_001 → D2A_002"    # one rung
 *
 * The paths here are relative to THIS package, the way Titanic's playthrough
 * config beside it is, so both are run through their own workspace rather than
 * with a `--config` from the repository root.
 *
 * It lives HERE rather than at the root, and the name is load-bearing.
 * `.github/workflows/tests.yml` picks the playthroughs a change can reach by
 * asking whether `<package>/vitest.playthrough.config.ts` exists — so a game
 * whose config sits anywhere else narrows to "none" and its route lands green
 * having never run.
 *
 * What it asserts is what Titanic's cannot: both ends of every rung are saves
 * `DF.EXE` wrote in 1995 ([the golden thread](../docs/dust/thread.md)), so a
 * pass says the port arrived where the original engine arrived.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/playthrough/playthrough.ts"],
    // a rung plays the game; the cold boot alone is 154 s of game time
    testTimeout: 300_000,
  },
});
