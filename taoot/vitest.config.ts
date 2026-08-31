import { defaultExclude, defineConfig } from "vitest/config";

/**
 * Titanic's automatic category: scenario and unit suites that jump to a state
 * and probe it.
 *
 * The other two categories are excluded by living elsewhere — `tests/playthrough/`
 * costs minutes of game time per segment and has its own config beside this one,
 * and `tests/browser/` needs a live dev server.
 */

/**
 * The suites that open the rip, and so cannot run on a machine without one.
 *
 * This list lives here, next to the files it names, because it is a fact about
 * Titanic's tests and nothing else. It used to sit in `.github/workflows/tests.yml`
 * as an `--exclude` on a root vitest run, where a suite renamed in this directory
 * would not have moved it.
 *
 * `NO_GAMEFILES=1` is the repository-wide way to ask for "only what runs
 * anywhere" (`npm run test:portable`); any other package that grows a
 * rip-reading suite honours the same variable in its own config. Excluding is
 * deliberate rather than listing the portable ones: a suite added later runs by
 * default, and if it turns out to need `gamefiles/` it fails loudly and gets
 * added here. The other direction would have skipped it in silence.
 */
const NEEDS_THE_RIP = [
  "regression",
  "savegame",
  "re_builtins",
  "interp",
  "nav",
  "text",
  "audio-rates",
  "sound-channels",
  "shp-play-order",
  "cst-play-order",
  "smokestack",
];

export default defineConfig({
  test: {
    // headless and file-based; no DOM at runtime
    environment: "node",
    include: ["tests/auto/*.ts"],
    exclude: [
      ...defaultExclude,
      ...(process.env.NO_GAMEFILES ? NEEDS_THE_RIP.map((n) => `tests/auto/${n}.ts`) : []),
    ],
    // scenarios boot a real GameSession and drive movies, walks and loops,
    // which can take a while; the default 5 s per test is too tight
    testTimeout: 30_000,
    // tests within a file mutate a shared virtual clock and run in
    // registration order — Vitest already runs same-file tests sequentially
  },
});
