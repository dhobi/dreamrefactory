import { defineConfig } from "vitest/config";

/**
 * Lunicus's suites that play no game: the page's own pieces (the menu bar, the
 * two dialogs, the shipped saves) and the formats it keeps. The playthroughs
 * are vitest.machine.config.ts's.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/*.ts"],
    testTimeout: 30_000,
  },
});
