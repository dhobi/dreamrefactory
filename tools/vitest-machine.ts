import { readFileSync, readdirSync } from "node:fs";
import { availableParallelism } from "node:os";
import { join } from "node:path";
import { defineConfig } from "vitest/config";

/**
 * The machine suites: the whole game played in node, one suite per file
 * (`tests/machine/`, docs/reference/tests.md). Each file runs in a process of
 * its own, because the game keeps its world in module state — vitest's forks
 * pool gives every test file one, which is what `tools/runmachine.mts` did by
 * hand before these were vitest suites.
 *
 * A suite is a file with a `test(` in it; the others there are the harness and
 * the players the suites are written in.
 *
 * Shared by the games whose suites live in `tests/machine/`; `pkg` is the
 * package's own directory (`import.meta.dirname` in its config).
 */
export function machineConfig(pkg: string) {
  const dir = join(pkg, "tests/machine");
  const suites = readdirSync(dir)
    .filter((f) => f.endsWith(".ts") && !f.startsWith(".") && /^test\b/m.test(readFileSync(join(dir, f), "utf8")))
    .map((f) => `tests/machine/${f}`);

  return defineConfig({
    test: {
      environment: "node",
      include: suites,
      pool: "forks",
      maxWorkers: Math.max(1, availableParallelism() - 1),
      // a suite is a whole day of the game; it is bounded by its own tick limits
      testTimeout: 1_800_000,
    },
  });
}
