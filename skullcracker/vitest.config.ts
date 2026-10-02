import { defineConfig } from "vitest/config";

/**
 * Skull Cracker's suites that are not a playthrough — the page's own pieces
 * (the panel's painter, the file store, the film player) checked on their own.
 *
 * The playthroughs are `vitest.machine.config.ts`'s, and the gate leaves them
 * out; these are quick and run with every other package's.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/*.ts"],
    testTimeout: 30_000,
  },
});
