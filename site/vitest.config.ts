import { defineConfig } from "vitest/config";

/**
 * The web presence's own suites: where a page sits in the deployed tree, the
 * chrome every page shares, the locale catalogues, and `layering.ts` — the test
 * that says the dependencies point one way only.
 *
 * `tests/browser/` is excluded by the glob rather than by a list: those drive a
 * live dev server through Playwright and are run by `tsx`, not by Vitest.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/*.ts"],
    testTimeout: 30_000,
  },
});
