import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // The suite is headless and file-based (no DOM at runtime).
    environment: "node",
    // Only the migrated suites are Vitest tests. nav.ts / parse.ts are
    // corpus/inspection scripts with top-level side effects (they'd run on
    // import), and browser.ts needs a live dev server — keep them out.
    include: ["tests/regression.ts", "tests/interp.ts"],
    // Scenarios boot a real GameSession and drive movies/walks/loops, which
    // can take a while; the default 5s per test is too tight.
    testTimeout: 30_000,
    // Tests within a file mutate a shared virtual clock and run in
    // registration order — Vitest already runs same-file tests sequentially.
  },
});
