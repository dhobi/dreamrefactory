import { defineConfig } from "vitest/config";

/**
 * Dust's suites — DreamFactory 1 read by the same engine, which is what most of
 * these are checking. `tests/browser/` is excluded by the glob: it needs a live
 * dev server and is run by `tsx`.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/*.ts"],
    testTimeout: 30_000,
  },
});
