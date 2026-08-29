import { defineConfig } from "vitest/config";

/**
 * Timelapse's suites — the game with no `.SET` anywhere, which navigates by the
 * shape of the cursor.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/*.ts"],
    testTimeout: 30_000,
  },
});
