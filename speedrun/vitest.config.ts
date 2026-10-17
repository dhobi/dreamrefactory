import { defineConfig } from "vitest/config";

/**
 * The workbench's own suites: the sheet language, conditions, the aim sweep and
 * the pointer maths, none of which needs a game's rip. A game's verbs and its
 * sheets are checked in that game's package.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/*.ts"],
    testTimeout: 30_000,
  },
});
