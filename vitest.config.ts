import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // The suite is headless and file-based (no DOM at runtime).
    environment: "node",
    // The automatic category: scenario + unit suites that jump to a state and
    // probe it. The other two categories are excluded by living elsewhere —
    // tests/playthrough/ costs minutes of game time per segment (its own config)
    // and tests/browser/ needs a live dev server.
    include: ["tests/auto/*.ts"],
    // Scenarios boot a real GameSession and drive movies/walks/loops, which
    // can take a while; the default 5s per test is too tight.
    testTimeout: 30_000,
    // Tests within a file mutate a shared virtual clock and run in
    // registration order — Vitest already runs same-file tests sequentially.
  },
});
