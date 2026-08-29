import { defineConfig } from "vitest/config";

/**
 * The gate, assembled from whatever packages have suites.
 *
 * This file names no game, and that is the point: each package that has an
 * automatic suite carries its own `vitest.config.ts` next to the tests it
 * describes, and the glob below finds them. A fifth game joins the gate by
 * existing, and nothing at the root has to be told about it — the same rule the
 * dependency graph already follows, applied to the runner.
 *
 * Two categories are deliberately not here, and both are excluded by living
 * somewhere this glob cannot reach rather than by a list that could rot:
 * playthroughs (`taoot/vitest.playthrough.config.ts` — minutes of game time per
 * segment, its own budget) and browser suites (each package's `tests/browser/`,
 * which need a live dev server and are run by `tsx`).
 */
export default defineConfig({
  test: {
    projects: ["*/vitest.config.ts"],
  },
});
