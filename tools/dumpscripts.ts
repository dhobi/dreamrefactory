/**
 * Scan DreamFactory game files, extract every script container, and write:
 *   <outDir>/scripts/<file>/<container>.txt   decompiled scripts
 *   <outDir>/opcode-frequency.tsv             usage stats across the corpus
 *
 *   npx tsx tools/dumpscripts.ts gamefiles out/
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { join, basename } from "node:path";
import { readContainerFile } from "@dreamfactory/engine/df/container";
import { sniffScript, scriptToText, Token } from "@dreamfactory/engine/df/script";

const [, , rootDir = "gamefiles", outDir = "out"] = process.argv;

const SCRIPT_BEARING = /\.(SET|STG|PUP|SHP|CST|MOV)$/i;

function* walk(dir: string): Generator<string> {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) yield* walk(p);
    else yield p;
  }
}

const opcodeCount = new Map<string, number>();
const opcodeFiles = new Map<string, Set<string>>();
let filesScanned = 0;
let scriptsFound = 0;
let tokensTotal = 0;

mkdirSync(join(outDir, "scripts"), { recursive: true });

for (const path of walk(rootDir)) {
  const name = basename(path);
  const isBoot = /^BOOTFILE$/i.test(name);
  if (!SCRIPT_BEARING.test(name) && !isBoot) continue;

  let file;
  try {
    file = readContainerFile(new Uint8Array(readFileSync(path)));
  } catch {
    continue; // not a DF container file
  }
  filesScanned++;

  let dirMade = false;
  for (let i = 0; i < file.containers.length; i++) {
    const tokens = sniffScript(file.containers[i].data);
    if (!tokens) continue;
    // require at least one real opcode to filter false positives
    const ops = tokens.filter((t): t is Token & { kind: "op" } => t.kind === "op");
    if (!ops.length) continue;

    scriptsFound++;
    tokensTotal += tokens.length;
    for (const op of ops) {
      if (op.name === " ") continue;
      opcodeCount.set(op.name, (opcodeCount.get(op.name) ?? 0) + 1);
      let set = opcodeFiles.get(op.name);
      if (!set) opcodeFiles.set(op.name, (set = new Set()));
      set.add(name);
    }
    const fdir = join(outDir, "scripts", name.replace(/[^\w.-]/g, "_"));
    if (!dirMade) {
      mkdirSync(fdir, { recursive: true });
      dirMade = true;
    }
    writeFileSync(join(fdir, `${String(i).padStart(4, "0")}.txt`), scriptToText(tokens));
  }
}

const rows = [...opcodeCount.entries()].sort((a, b) => b[1] - a[1]);
const tsv =
  "opcode\tcount\tfiles\n" +
  rows.map(([op, n]) => `${op}\t${n}\t${opcodeFiles.get(op)!.size}`).join("\n");
writeFileSync(join(outDir, "opcode-frequency.tsv"), tsv);

console.log(`files scanned:   ${filesScanned}`);
console.log(`scripts found:   ${scriptsFound}`);
console.log(`tokens total:    ${tokensTotal}`);
console.log(`distinct opcodes used: ${rows.length} of ~280 known`);
console.log(`\ntop 40 opcodes:`);
for (const [op, n] of rows.slice(0, 40)) {
  console.log(`  ${op.padEnd(18)} ${String(n).padStart(7)}  (${opcodeFiles.get(op)!.size} files)`);
}
