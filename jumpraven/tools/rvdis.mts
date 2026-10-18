/**
 * Disassemble RAVEN.EXE — DreamFactory 0's engine, and the whole of the game's
 * logic: Jump Raven has no script containers, so how it plays is this code.
 *
 *   npx tsx jumpraven/tools/rvdis.mts at 0x401000:200     disassemble from a VA
 *   npx tsx jumpraven/tools/rvdis.mts func 0x4012a0        the whole function a VA is in
 *   npx tsx jumpraven/tools/rvdis.mts bytes 0x53544550     a 32-bit literal in .text
 *   npx tsx jumpraven/tools/rvdis.mts callers 0x4012a0     every call site of a function
 *   npx tsx jumpraven/tools/rvdis.mts find 640             instructions mentioning a number
 *   npx tsx jumpraven/tools/rvdis.mts str "Flat.c"         code that pushes a string's address
 *   npx tsx jumpraven/tools/rvdis.mts map 0x404000:0x40c000  every function in a range: size, callers,
 *                                                          its Lunicus pair and the strings it pushes
 *   npx tsx jumpraven/tools/rvdis.mts sum 0x40b190         a function's callees, strings and globals,
 *                                                          each callee with its LUNICUS.EXE pair
 *                                                          (jumpraven/tools/match.mts writes the pairs
 *                                                          to out/jumpraven/pairs.json)
 *
 * The disassembly is `tools/x86dis.ts`'s, as `lunicus/tools/ludis.mts`'s is: function boundaries are "the
 * greatest call target at or before", which cannot see a function nothing calls.
 */
import { existsSync, readFileSync } from "node:fs";
import { COMMON_MODES, X86Exe, runCommonMode } from "../../tools/x86dis";

const EXE = "jumpraven/gamefiles/RAVEN/RAVEN/RAVEN.EXE";
const exe = await X86Exe.open(EXE);
const { cs, data } = exe;

/** RAVEN.EXE function -> its LUNICUS.EXE pair, as jumpraven/tools/match.mts wrote them */
const pairsFile = "out/jumpraven/pairs.json";
const pairs: Record<string, string> = existsSync(pairsFile) ? JSON.parse(readFileSync(pairsFile, "utf8")) : {};
const lu = (va: number): string => (pairs[va] ? "=lu" + pairs[va].replace("0x", "") : "");

/** a function's instructions, from its entry to the next */
const body = (start: number) => {
  const off = exe.fileOff(start);
  return cs.disasm(data.subarray(off, off + (exe.entryAfter(start) - start)), { address: start });
};

/** the strings a function pushes, longer than two characters */
function pushedStrings(start: number): Set<string> {
  const strs = new Set<string>();
  try {
    for (const i of body(start)) {
      if (i.mnemonic !== "push") continue;
      for (const m of i.opStr.matchAll(/0x(4[0-9a-f]{5})\b/g)) {
        const t = parseInt(m[1], 16);
        const str = exe.cstr(t) ?? exe.cstr(t + 1);
        if (str && str.length > 2) strs.add(str);
      }
    }
  } catch { /* data */ }
  return strs;
}

/** every function in a range: size, callers, its Lunicus pair and the strings it pushes */
function map(from: number, to: number): void {
  const callers = new Map<number, number>();
  for (const { target } of exe.calls()) callers.set(target, (callers.get(target) ?? 0) + 1);
  for (const start of exe.callTargets.filter((t) => t >= from && t < to)) {
    const strs = pushedStrings(start);
    const size = exe.entryAfter(start) - start;
    console.log(`${start.toString(16)} ${String(size).padStart(5)}B ×${callers.get(start) ?? 0}${pairs[start] ? " " + lu(start) : ""} ${[...strs].map((x) => JSON.stringify(x)).join(" ")}`);
  }
}

/** "w" when the instruction writes the global `g`, else "r" */
function access(mnemonic: string, opStr: string, g: string): "w" | "r" {
  const writes = /^(mov|add|sub|inc|dec|and|or|xor)$/.test(mnemonic) && opStr.startsWith("dword ptr [" + g);
  return writes || opStr.startsWith("word ptr [" + g) ? "w" : "r";
}

/** a function's callees, strings and globals, each callee with its LUNICUS.EXE pair */
function sum(va: number): void {
  const start = exe.entryBefore(va);
  const end = exe.entryAfter(start);
  const calls = new Map<number, number>();
  const strs = new Set<string>();
  const globals = new Map<string, Set<string>>();
  /** an address an instruction names: a string it loads, an import, or a global it reads or writes */
  const note = (mnemonic: string, opStr: string, t: number): void => {
    const s = exe.cstr(t) ?? exe.cstr(t + 1);
    if (s && (mnemonic === "push" || mnemonic === "mov")) strs.add(s);
    else if (exe.imports.has(t)) strs.add(`import ${exe.imports.get(t)}`);
    else if (t >= 0x431000) {
      const g = `0x${t.toString(16)}`;
      if (!globals.has(g)) globals.set(g, new Set());
      globals.get(g)!.add(access(mnemonic, opStr, g));
    }
  };
  for (const i of body(start)) {
    if (i.mnemonic === "call" && /^0x[0-9a-f]+$/.test(i.opStr)) {
      const t = Number(i.opStr);
      calls.set(t, (calls.get(t) ?? 0) + 1);
      continue;
    }
    for (const m of i.opStr.matchAll(/0x(4[0-9a-f]{5})\b/g)) note(i.mnemonic, i.opStr, parseInt(m[1], 16));
  }
  console.log(`; function ${start.toString(16)}..${end.toString(16)}, ${exe.callSites(start).length} caller(s), ${pairs[start] ? "lunicus " + pairs[start] : "no lunicus pair"}`);
  console.log("calls:", [...calls].map(([t, n]) => `${t.toString(16)}${n > 1 ? "×" + n : ""}${lu(t)}`).join(" "));
  console.log("strings:", [...strs].map((s) => JSON.stringify(s)).join(" "));
  console.log("globals:", [...globals].map(([g, h]) => g + (h.has("w") ? "!" : "")).sort().join(" "));
}

const [, , mode, arg] = process.argv;
if (mode === "map") {
  const [from, to] = arg.split(":").map(Number);
  map(from, to);
} else if (mode === "sum") {
  sum(Number(arg));
} else if (!runCommonMode(exe, mode, arg)) {
  console.log(`modes: ${COMMON_MODES} | map FROM:TO | sum VA`);
}
