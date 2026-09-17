/**
 * Run the browser suites, all of them, in one process and one Chromium.
 *
 *   npm run dev -w skullcracker               # in one terminal
 *   npm run test:browser:all -w skullcracker  # in another
 *   npm run test:browser:all -w skullcracker -- vat sewer codes
 *
 * Thirty separate `tsx` processes each imported Playwright from scratch and each
 * launched a browser of its own. The first cost about a second apiece. The
 * second cost correctness: on a machine with a gigabyte free, suites run back to
 * back failed in ways they never failed alone — a score that did not arrive, a
 * HUD with no position in it, a TypeError out of the page, a pickup not taken —
 * and every one of those cost a re-run to tell apart from a real regression.
 *
 * One process, one browser, one import of Playwright. A suite gets a context of
 * its own and gives it back; see `tests/browser/harness.ts`.
 *
 * A suite is a module whose top level awaits its own work, so importing it IS
 * running it, and a `fail()` inside one throws rather than exiting. That is the
 * only thing the suites had to change.
 */
import { readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

process.env.SC_POOLED_BROWSER = "1";

const HERE = dirname(fileURLToPath(import.meta.url));
const DIR = resolve(HERE, "../tests/browser");

/** how long one suite may take before the run gives up on it */
const LIMIT = Number(process.env.SC_SUITE_TIMEOUT ?? 900_000);

const all = readdirSync(DIR)
  .filter((f) => f.endsWith(".ts") && f !== "harness.ts")
  .map((f) => f.replace(/\.ts$/, ""))
  .sort();

const wanted = process.argv.slice(2).filter((a) => !a.startsWith("-"));
const unknown = wanted.filter((w) => !all.includes(w));
if (unknown.length) {
  console.error(`no such suite: ${unknown.join(" ")}\nhave: ${all.join(" ")}`);
  process.exit(2);
}
const suites = wanted.length ? wanted : all;

const results: { name: string; ok: boolean; why: string; ms: number }[] = [];
const started = Date.now();

for (const name of suites) {
  const at = Date.now();
  console.log(`\n=== ${name} ${"=".repeat(Math.max(0, 60 - name.length))}`);
  let why = "";
  try {
    await Promise.race([
      import(pathToFileURL(join(DIR, `${name}.ts`)).href),
      new Promise((_, no) => setTimeout(() => no(new Error(`timed out after ${LIMIT}ms`)), LIMIT)),
    ]);
  } catch (e) {
    // `fail()` has already printed the reason; anything else has not
    why = e instanceof Error ? e.message : String(e);
    if (!(e instanceof Error) || e.name !== "SuiteFailure") console.error(`FAIL  ${why}`);
  }
  results.push({ name, ok: !why, why, ms: Date.now() - at });
}

const { shutdown } = await import(pathToFileURL(join(DIR, "harness.ts")).href);
await shutdown();

console.log(`\n=== results ${"=".repeat(50)}`);
for (const r of results) {
  console.log(
    `${r.ok ? "PASS" : "FAIL"}  ${r.name.padEnd(10)} ${(r.ms / 1000).toFixed(1).padStart(6)}s` +
      (r.ok ? "" : `  ${r.why}`),
  );
}
const bad = results.filter((r) => !r.ok);
console.log(
  `\n${results.length - bad.length} of ${results.length} in ${((Date.now() - started) / 1000).toFixed(1)}s` +
    (bad.length ? ` - ${bad.map((r) => r.name).join(" ")} failed` : ""),
);
process.exit(bad.length ? 1 : 0);
