import { defineConfig } from "vitest/config";

/**
 * RedJack's own suites — the page's file store and its saved-games seeding,
 * which need no rip. The game itself is played by the machine suites
 * (`vitest.machine.config.ts`), which have a budget of their own.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/*.ts"],
    testTimeout: 30_000,
  },
});
