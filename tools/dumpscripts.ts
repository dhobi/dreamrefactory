/**
 * Scan DreamFactory game files, extract every script container, and write:
 *   <outDir>/scripts/<file>/<container>.txt   decompiled scripts
 *   <outDir>/opcode-frequency.tsv             usage stats across the corpus
 *
 *   npx tsx tools/dumpscripts.ts                  # whichever rip is installed
 *   npx tsx tools/dumpscripts.ts <rip> <outDir>   # or say which
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { readContainerFile } from "@dreamfactory/engine/df/container";
import { sniffScript, scriptToText, Token } from "@dreamfactory/engine/df/script";
import { carriesScript } from "./script-bearing";

/**
 * Which rip to read when the caller does not say.
 *
 * This tool takes a rip as an ARGUMENT — that is what makes it a shared tool
 * rather than a game's — so it may not import a game to find one, and the
 * default has to be discovered rather than depended on.
 *
 * It used to be the bare string `"gamefiles"`, which was right while there was
 * one rip at the repository root. Each game has its own now, and a bare literal
 * is resolved against the WORKING DIRECTORY, so the zero-argument form named a
 * path that stopped existing. These are resolved from THIS FILE instead, so the
 * tool answers the same from anywhere, and the two environment variables come
 * first because that is what the CI runner sets.
 */
function defaultRip(): string {
  const candidates = [
    process.env.TAOOT_GAMEFILES,
    fileURLToPath(new URL("../taoot/gamefiles", import.meta.url)),
    process.env.DUST_GAMEFILES,
    fileURLToPath(new URL("../dust/gamefiles", import.meta.url)),
  ];
  for (const c of candidates) if (c && existsSync(c)) return c;
  console.error(
    "no rip found: pass one as the first argument, or set TAOOT_GAMEFILES / DUST_GAMEFILES.",
  );
  process.exit(1);
}

const [, , rootDir = defaultRip(), outDir = "out"] = process.argv;


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
  if (!carriesScript(name)) continue;

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
