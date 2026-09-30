import { globSync } from "node:fs";
import { dirname } from "node:path";
import { defineConfig } from "vitest/config";

/**
 * The coverage run (`npm run coverage`, tools/coverage.mts): the gate's suites
 * and every game's machine suites, with V8 coverage on, measured over the
 * engine and each game's own `src/`.
 *
 * Its own file rather than a flag on vitest.config.ts: the gate leaves the
 * machine suites out on purpose (their budget is their own, and CI runs only
 * the games a change reaches), and coverage wants all of them, since a
 * playthrough is where most of a game's code runs.
 *
 * `engine/src/web/` is left out: it is the browser shell (the page, the
 * speedrun workbench, the maze view), which a node suite can mostly not reach,
 * and the badge is for the engine's formats and runtime.
 */
export default defineConfig({
  test: {
    // Every config inline, to lift its own testTimeout: instrumented, and
    // sharing the machine with the playthroughs, a 30 s rip-reading test runs
    // past it (measured: two did, the first time this ran).
    projects: [
      ...globSync("*/vitest.config.ts").map((config) => ({
        extends: `./${config}`,
        test: { name: dirname(config), root: `./${dirname(config)}`, testTimeout: 600_000 },
      })),
      // named apart: a package's two configs would both take its package name
      ...globSync("*/vitest.machine.config.ts").map((config) => ({
        extends: `./${config}`,
        test: { name: `${dirname(config)} machine`, root: `./${dirname(config)}` },
      })),
    ],
    coverage: {
      provider: "v8",
      // every file of these, loaded or not, so an untested one counts as 0
      include: ["engine/src/**/*.ts", "*/src/**/*.ts"],
      exclude: ["engine/src/web/**", "site/**", "**/*.d.ts"],
      reporter: ["json-summary", "text-summary"],
      reportsDirectory: "coverage/vitest",
      reportOnFailure: true,
    },
  },
});
