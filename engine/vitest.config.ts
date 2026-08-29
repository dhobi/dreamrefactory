import { defineConfig } from "vitest/config";

/**
 * The engine's own suites: the container formats and the runtime that plays
 * them, against fixtures the write path builds (`src/df/*-build.ts`) rather
 * than against any game's rip. Nothing here opens `gamefiles/`, so all of it
 * runs on GitHub's machines as well as on the self-hosted one.
 */
export default defineConfig({
  test: {
    // headless and file-based; no DOM at runtime
    environment: "node",
    include: ["tests/*.ts"],
    testTimeout: 30_000,
  },
});
