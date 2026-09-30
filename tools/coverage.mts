/**
 * How much of the engine, and of each game's own code, the tests run, and the
 * shields.io badges that say so on the README (docs/reference/ci.md#coverage).
 *
 *   npm run coverage                every suite, then the badges
 *   npm run coverage -- --report    the badges only, from the last run's data
 *
 * The run is vitest.coverage.config.ts: every package's automatic suites and
 * every game's machine suites, with V8 coverage on. This sums its per-file
 * summary by directory, one badge each: the engine without `web/`, and each
 * game's own `src/`, measured by every suite that runs it. Rangers has no
 * package and no suites yet, so it has no badge.
 *
 * A badge is a shields.io endpoint file, `coverage/badges/coverage-<key>.json`;
 * the coverage workflow publishes the folder to the `badges` branch, which is
 * where the README's badges read it from.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const OUT = resolve(ROOT, "coverage");

/** what gets a badge: the directory measured and the name on the badge */
const BADGES = [
  { key: "engine", dir: "engine/src/", label: "engine" },
  { key: "taoot", dir: "taoot/src/", label: "Titanic" },
  { key: "dust", dir: "dust/src/", label: "Dust" },
  { key: "timelapse", dir: "timelapse/src/", label: "Timelapse" },
  { key: "redjack", dir: "redjack/src/", label: "RedJack" },
  { key: "skullcracker", dir: "skullcracker/src/", label: "Skull Cracker" },
  { key: "lunicus", dir: "lunicus/src/", label: "Lunicus" },
  { key: "jumpraven", dir: "jumpraven/src/", label: "Jump Raven" },
];

let ok = true;
if (!process.argv.includes("--report")) {
  rmSync(OUT, { recursive: true, force: true });
  const t0 = Date.now();
  const r = spawnSync("npx", ["vitest", "run", "--config", "vitest.coverage.config.ts", "--coverage.enabled"], {
    cwd: ROOT,
    stdio: "inherit",
  });
  ok = r.status === 0;
  console.log(`\nsuites ${ok ? "passed" : `FAILED (${r.status})`} in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
}

type Counts = { total: number; covered: number };
const summary: Record<string, { lines: Counts }> = JSON.parse(
  readFileSync(resolve(OUT, "vitest/coverage-summary.json"), "utf8"),
);

const color = (pct: number): string =>
  pct >= 90 ? "brightgreen" : pct >= 80 ? "green" : pct >= 70 ? "yellowgreen" : pct >= 60 ? "yellow" : pct >= 50 ? "orange" : "red";

mkdirSync(resolve(OUT, "badges"), { recursive: true });
const rows: string[] = [];
for (const b of BADGES) {
  const under = resolve(ROOT, b.dir) + "/";
  let files = 0;
  let covered = 0;
  let total = 0;
  for (const [file, s] of Object.entries(summary)) {
    if (!file.startsWith(under)) continue;
    files++;
    covered += s.lines.covered;
    total += s.lines.total;
  }
  const pct = total ? (100 * covered) / total : 0;
  writeFileSync(
    resolve(OUT, "badges", `coverage-${b.key}.json`),
    JSON.stringify({ schemaVersion: 1, label: `${b.label} coverage`, message: `${Math.floor(pct)}%`, color: color(pct) }) + "\n",
  );
  rows.push(`| ${b.label} | \`${b.dir}\` | ${files} | ${covered}/${total} | ${pct.toFixed(1)}% |`);
}
const table = ["| | measured | files | lines run | |", "|---|---|---|---|---|", ...rows].join("\n");
writeFileSync(resolve(OUT, "summary.md"), table + "\n");
console.log("\n" + table);
if (!ok) {
  // a partial run's numbers are not the badge's: the workflow publishes nothing
  console.error("\nsome suites failed: these numbers are from a partial run");
  process.exit(1);
}
