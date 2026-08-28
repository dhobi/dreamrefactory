/**
 * Parse every script container in the game files into an AST and report the
 * success rate — validates the grammar in parser.ts against the full corpus.
 *
 *   npx tsx tools/parse.ts gamefiles
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, basename } from "node:path";
import { readContainerFile } from "@dreamfactory/engine/df/container";
import { sniffScript } from "@dreamfactory/engine/df/script";
import { carriesScript } from "./script-bearing";
import { parseScript } from "@dreamfactory/engine/runtime/parser";

const rootDir = process.argv[2] ?? "gamefiles";

function* walk(dir: string): Generator<string> {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) yield* walk(p);
    else yield p;
  }
}

let ok = 0;
let failed = 0;
let codeBlocks = 0;
const errors = new Map<string, { count: number; example: string }>();

for (const path of walk(rootDir)) {
  const name = basename(path);
  if (!carriesScript(name)) continue;
  let file;
  try {
    file = readContainerFile(new Uint8Array(readFileSync(path)));
  } catch {
    continue;
  }
  for (let i = 0; i < file.containers.length; i++) {
    const tokens = sniffScript(file.containers[i].data);
    if (!tokens || !tokens.some((t) => t.kind === "op" && t.id !== 1)) continue;
    try {
      const script = parseScript(tokens);
      codeBlocks += script.codes.size;
      ok++;
    } catch (e) {
      failed++;
      const msg = (e as Error).message.slice(0, 100);
      const entry = errors.get(msg);
      if (entry) entry.count++;
      else errors.set(msg, { count: 1, example: `${name}#${i}` });
    }
  }
}

console.log(`parsed OK: ${ok}`);
console.log(`failed:    ${failed}  (${((100 * ok) / (ok + failed)).toFixed(2)}% success)`);
console.log(`code blocks total: ${codeBlocks}`);
if (errors.size) {
  console.log("\nerrors by message:");
  for (const [msg, e] of [...errors].sort((a, b) => b[1].count - a[1].count).slice(0, 15)) {
    console.log(`  ${String(e.count).padStart(5)}x  ${msg}   e.g. ${e.example}`);
  }
}
