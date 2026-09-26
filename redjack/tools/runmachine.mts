/**
 * Run every machine suite — `tests/machine/*.ts` but the harness and the route — each in a
 * process of its own (the game keeps its world in module state, one per
 * process), several at a time, and say which failed.
 *
 *   npx tsx tools/runmachine.mts            every suite
 *   npx tsx tools/runmachine.mts speed foes  just these
 */
import { spawn } from "node:child_process";
import { readdirSync } from "node:fs";
import { availableParallelism } from "node:os";
import { join, resolve } from "node:path";

const dir = resolve(import.meta.dirname, "../tests/machine");
const want = process.argv.slice(2);
const suites = readdirSync(dir)
  // the suites, not the modules they are written in (and not a scratch dot-file)
  .filter((f) => f.endsWith(".ts") && !f.startsWith(".") && !["harness.ts", "route.ts", "fight.ts", "cannons.ts"].includes(f))
  .map((f) => f.slice(0, -3))
  .filter((s) => !want.length || want.includes(s))
  .sort();
const width = Math.max(1, Math.min(suites.length, availableParallelism() - 1));

type Result = { suite: string; ok: boolean; ms: number; last: string; out: string };
const run = (suite: string): Promise<Result> =>
  new Promise((done) => {
    const t0 = Date.now();
    const child = spawn(process.execPath, ["--import", "tsx", join(dir, `${suite}.ts`)], {
      cwd: resolve(dir, "../.."),
      env: process.env,
    });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("close", (code) => {
      const lines = out.split("\n").filter((l) => /^(ok|FAIL|PASS)\b/.test(l));
      const fail = lines.find((l) => l.startsWith("FAIL"));
      done({ suite, ok: code === 0 && !fail, ms: Date.now() - t0, last: fail ?? lines.at(-1) ?? out.trim().split("\n").at(-1) ?? "", out });
    });
  });

const t0 = Date.now();
const results: Result[] = [];
const queue = [...suites];
await Promise.all(
  Array.from({ length: width }, async () => {
    for (let s = queue.shift(); s; s = queue.shift()) {
      const r = await run(s);
      results.push(r);
      console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.suite.padEnd(10)} ${(r.ms / 1000).toFixed(1).padStart(5)}s  ${r.ok ? "" : r.last.replace(/^FAIL\s+/, "")}`);
      if (!r.ok && process.env.VERBOSE) console.log(r.out);
    }
  }),
);
const failed = results.filter((r) => !r.ok).map((r) => r.suite).sort();
console.log(`\n${results.length - failed.length} of ${results.length} in ${((Date.now() - t0) / 1000).toFixed(1)}s${failed.length ? ` - ${failed.join(" ")} failed` : ""}`);
process.exit(failed.length ? 1 : 0);
