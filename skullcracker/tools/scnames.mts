/**
 * Cross-check the sprite books' entity names against SC.EXE's own strings.
 *
 *   npx tsx skullcracker/tools/scnames.mts
 *
 * The books name every placed thing; the executable registers a class per name
 * it knows. So the two lists are one fact stated twice, and the disagreements
 * are the interesting part:
 *
 * - a name in the books and NOT in the binary is a label a level designer typed,
 *   which the engine never compares. All of them are areas (`newroom`, `roomtwo`,
 *   `entrance`) — and the file agrees, because those are exactly the records whose
 *   +22 flag says "region" rather than "object" (`SbkEntity.isEntity`).
 * - a name in the binary that NO shipped level places is content that was built
 *   and not used.
 *
 * One name is in neither camp and is worth its own mention: `inithealth`, once, in
 * a level whose every other pickup is `stat*`. The binary has `stathealth` and has
 * never heard of `inithealth`, so that pickup could not have spawned in 1996.
 */
import { readFileSync, readdirSync } from "node:fs";
import { readSbkFile } from "@dreamfactory/engine/df/sbk";

const DATA = "skullcracker/gamefiles/SKULL/DATA";
const exe = readFileSync("skullcracker/gamefiles/SKULL/INSTALL/BIN/SC.EXE", "latin1");

const found = new Map<string, number>();
for (const n of readdirSync(DATA).filter((n) => /\.sbk$/i.test(n))) {
  for (const e of readSbkFile(new Uint8Array(readFileSync(`${DATA}/${n}`))).entities) {
    found.set(e.name, (found.get(e.name) ?? 0) + 1);
  }
}
const inExe = (s: string): boolean => exe.includes(`${s}\0`);
const missing = [...found].filter(([n]) => !inExe(n));
console.log(`${found.size} distinct names in the books; ${found.size - missing.length} appear in SC.EXE as C strings`);
if (missing.length) {
  console.log(`NOT in the binary (${missing.length}):`);
  for (const [n, c] of missing.sort((a, b) => b[1] - a[1])) console.log(`  ${String(c).padStart(4)} x ${JSON.stringify(n)}`);
}
const shaped = /(?:^|\0)((?:init|stat)[a-z0-9]{2,14}|platform|obstacle|ladder|goal|newroom|exitroom|switch|door|probe|timer|suckto)\0/g;
const known = new Set<string>();
for (const m of exe.matchAll(shaped)) known.add(m[1]);
const unused = [...known].filter((n) => !found.has(n)).sort();
console.log(`\n${known.size} such names in the binary; ${unused.length} that NO shipped level places:`);
console.log("  " + unused.join(" "));
