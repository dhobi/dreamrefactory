import { defineConfig } from "vitest/config";

/**
 * Jump Raven's suites that are not a playthrough: the page's pieces a node
 * test can hold — the dialogs, the menu bar, the saved-games kind — run in
 * the gate. The playthroughs are `vitest.machine.config.ts`'s.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/*.ts"],
    testTimeout: 30_000,
  },
});
