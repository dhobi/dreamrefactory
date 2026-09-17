/**
 * How much of the sixteen books is actually on the page.
 *
 *   npx tsx skullcracker/tools/records.mts
 *   npx tsx skullcracker/tools/records.mts --gaps
 *
 * The coverage figure in `docs/skullcracker/README.md` used to be a number
 * somebody counted once, and every level built since made it a little more
 * wrong. This counts it instead: every entity record in every shipped book,
 * against the class names `walk.ts` actually asks `placed()` for.
 *
 * The one thing it cannot see is a record placed by some other route — a
 * `goal`, a `platform`, a `ladder`, the level's own `initplayer` — so those are
 * named here rather than inferred, and changing this list is a deliberate act.
 */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readSbkFile } from "../../engine/src/df/sbk";
import { FOES } from "../src/foes";
import { GUN_CODES } from "../src/guns";

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA = resolve(HERE, "../gamefiles/SKULL/DATA");

/**
 * Records the page reads without going through `placed()`.
 *
 * `initplayer` is where a level opens, `goal` is the television's record,
 * `platform`/`obstacle`/`ladder` are the solids the floor is built from, and
 * `initboggshead` is looked up by name beside its body rather than placed.
 */
const OTHERWISE = new Set([
  // where a level opens, the television's record, and the solids the floor is built from
  "initplayer", "goal", "platform", "obstacle", "ladder",
  // Boggs' arm and machinery have no placement of their own: `0x411da0` and
  // `0x412130` take no point at all and hang everything off the body
  "initbgclawarm", "initbgmachinery",
]);

/**
 * Every record name the page mentions in code.
 *
 * Block comments are stripped first, because this file's own prose names the
 * records it has not built and a name in a sentence is not a placement. What is
 * left is string literals, and a record name only appears as one where something
 * looks for it: `placed(sbk, r, "initbush")`, `e.name === "initboggshead"`, the
 * keys of `FOES` and `PICKUP_CODES`, a door finder's own `"door"`.
 */
const SRC = resolve(HERE, "../src");
const strip = (t: string): string => t.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
let code = strip(readFileSync(resolve(HERE, "../../engine/src/df/sbk.ts"), "utf8"));
for (const f of readdirSync(SRC).filter((n) => n.endsWith(".ts"))) {
  code += strip(readFileSync(`${SRC}/${f}`, "utf8"));
}
const placed = new Set<string>(OTHERWISE);
for (const m of code.matchAll(/"([A-Za-z][A-Za-z0-9_]*)"/g)) placed.add(m[1]);
// the creatures and the guns, whose names are keys and fields rather than literals
for (const k of Object.keys(FOES)) placed.add(k);
for (const c of Object.values(GUN_CODES)) if (c.name) placed.add(c.name);

const gaps = process.argv.includes("--gaps");
const missing = new Map<string, { n: number; books: Set<string> }>();
let total = 0;
let covered = 0;
let regions = 0;

const rows: string[] = [];
for (const f of readdirSync(DATA).filter((n) => n.endsWith(".SBK") && n !== "PLAYER.SBK").sort()) {
  const sbk = readSbkFile(new Uint8Array(readFileSync(`${DATA}/${f}`)));
  const book = f.replace(".SBK", "");
  let here = 0;
  let ok = 0;
  for (const e of sbk.entities) {
    if (!e.isEntity) { regions += 1; continue; }
    here += 1;
    // CITY carries one record with no name at all, which nothing can place
    if (placed.has(e.name) || !e.name) { ok += 1; continue; }
    const row = missing.get(e.name) ?? { n: 0, books: new Set<string>() };
    row.n += 1;
    row.books.add(book.toLowerCase());
    missing.set(e.name, row);
  }
  total += here;
  covered += ok;
  rows.push(`  ${book.padEnd(10)} ${String(ok).padStart(3)} of ${String(here).padStart(3)}${ok === here ? "   complete" : ""}`);
}

console.log(rows.join("\n"));
console.log(
  `\n${covered} of ${total} entity records placed — ${((covered / total) * 100).toFixed(1)}%.` +
  ` ${regions} region records, all handled.`,
);
if (missing.size) {
  console.log(`\nwhat is not placed:`);
  for (const [name, r] of [...missing.entries()].sort((a, b) => b[1].n - a[1].n)) {
    console.log(`  ${name.padEnd(17)} ${String(r.n).padStart(2)}   ${[...r.books].sort().join(" ")}`);
  }
}
if (gaps) {
  const complete = rows.filter((r) => r.includes("complete")).map((r) => r.trim().split(/\s+/)[0]);
  console.log(`\nno gap at all: ${complete.join(" ")}`);
}
