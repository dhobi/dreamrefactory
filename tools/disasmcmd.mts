/**
 * Disassemble the TI.EXE handler for a DreamFactory script command, to recover
 * the semantics of commands not yet implemented in src/engine/builtins.
 *
 * The interpreter dispatches on the command's opcode id through per-band jump
 * tables (found by disassembling around the indexed `jmp [eax*4 + <table>]`
 * sites): handler_VA = jumpTable[id - base]. Two dispatch routines exist — one
 * that evaluates value-returning commands (queries/property-gets) and one that
 * executes action statements; both are consulted below.
 *
 *   npx tsx tools/disasmcmd.mts path calcvectx calcvecty calcdeg
 */
import { readFileSync } from "node:fs";
import { Capstone, Const, loadCapstone } from "capstone-wasm";
import { OPCODES } from "../src/df/script";
import { gameExePath } from "./gamefiles";

const data = new Uint8Array(readFileSync(gameExePath()));
const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
const peOff = view.getUint32(0x3c, true);
const numSections = view.getUint16(peOff + 6, true);
const optSize = view.getUint16(peOff + 20, true);
const imageBase = view.getUint32(peOff + 24 + 28, true);
const secTable = peOff + 24 + optSize;
interface Sec { name: string; va: number; vsize: number; raw: number; rawSize: number; }
const sections: Sec[] = [];
for (let i = 0; i < numSections; i++) {
  const o = secTable + i * 40;
  let name = ""; for (let c = 0; c < 8 && data[o + c]; c++) name += String.fromCharCode(data[o + c]);
  sections.push({ name, vsize: view.getUint32(o + 8, true), va: view.getUint32(o + 12, true), rawSize: view.getUint32(o + 16, true), raw: view.getUint32(o + 20, true) });
}
const text = sections.find((s) => s.name === ".text")!;
const vaToFile = (va: number): number | null => {
  const rva = va - imageBase;
  for (const s of sections) if (rva >= s.va && rva < s.va + Math.max(s.vsize, s.rawSize)) return s.raw + (rva - s.va);
  return null;
};
const isCode = (va: number) => { const rva = va - imageBase; return rva >= text.va && rva < text.va + text.vsize; };
const nameToId = new Map([...OPCODES].map(([id, n]) => [n, id]));

/**
 * The C string at a VA, or null. Handlers that ANSWER with a word push one of
 * these — `hittest`'s six kinds ("actor", "prop", "painting", "scene", "button",
 * "flat", "None") are pushed literals — so annotating them turns a wall of
 * branches into the order the engine answers in. They are stored with a leading
 * NUL, so skip one.
 */
const stringAt = (va: number): string | null => {
  const off = vaToFile(va);
  if (off === null || off < 0 || off >= data.length) return null;
  const start = data[off] === 0 ? off + 1 : off;
  let s = "";
  for (let i = 0; i < 48; i++) {
    const c = data[start + i];
    if (c === 0) break;
    if (c < 0x20 || c > 0x7e) return null;
    s += String.fromCharCode(c);
  }
  return s.length >= 3 ? s : null;
};

// Jump tables recovered from the two dispatch routines (see header). Each band
// maps id -> handler via table[id - base]. `count` is the cmp bound + 1.
type Band = { base: number; table: number; count: number };
const VALUE_BANDS: Band[] = [ // value-returning dispatch @0x4258xx
  { base: 16001, table: 0x426e98, count: 56 },
  { base: 20002, table: 0x426f78, count: 120 },
];
const ACTION_BANDS: Band[] = [ // action-statement dispatch @0x43c7xx
  { base: 12001, table: 0x43d8a0, count: 110 },
  { base: 16002, table: 0x43da58, count: 55 },
];

function handlerVA(id: number, bands: Band[]): number | null {
  for (const b of bands) {
    const idx = id - b.base;
    if (idx < 0 || idx >= b.count) continue;
    const off = vaToFile(b.table)!;
    const va = view.getUint32(off + idx * 4, true);
    if (isCode(va)) return va;
  }
  return null;
}

await loadCapstone();
const cs = new Capstone(Const.CS_ARCH_X86, Const.CS_MODE_32);
cs.setOption(Const.CS_OPT_SYNTAX, Const.CS_OPT_SYNTAX_INTEL);

const EPILOGUE = new Set([0x426e5e, 0x426e61, 0x43d86b, 0x43d868]); // shared "store result & return"

/**
 * disasm a block; stop at ret or a jmp into the dispatcher epilogue. returns
 * call targets seen. `linear` runs THROUGH the rets instead: a handler that
 * answers several ways has a ret per answer, so stopping at the first one shows
 * only its error path — reading `hittest`'s six needs the whole body.
 */
function disasmBlock(va: number, indent = "  ", maxBytes = 4096, linear = false): number[] {
  const off = vaToFile(va)!;
  const insns = cs.disasm(data.subarray(off, off + maxBytes), { address: va, count: 400 });
  const calls: number[] = [];
  for (const ins of insns) {
    let note = "";
    for (const m of (ins.opStr ?? "").matchAll(/0x([0-9a-f]{6,8})/g)) {
      const s = stringAt(parseInt(m[1], 16));
      if (s) note += `   ; "${s}"`;
    }
    console.log(`${indent}0x${Number(ins.address).toString(16)}: ${ins.mnemonic}\t${ins.opStr}${note}`);
    if (ins.mnemonic === "call") {
      const t = parseInt(ins.opStr, 16);
      if (!Number.isNaN(t) && isCode(t)) calls.push(t);
    }
    if (linear) continue;
    if (ins.mnemonic === "ret" || ins.mnemonic === "retn") break;
    if (ins.mnemonic === "jmp") {
      const t = parseInt(ins.opStr, 16);
      if (EPILOGUE.has(t)) break;
    }
  }
  return calls;
}

for (const name of process.argv.slice(2)) {
  // raw address: disasm that function. `0x4277f0:900` reads 900 bytes straight
  // through, rets and all — how the whole of a multi-answer handler is read.
  const raw = /^(0x[0-9a-f]+)(?::(\d+))?$/i.exec(name);
  if (raw) {
    const va = parseInt(raw[1], 16);
    const span = raw[2] ? parseInt(raw[2], 10) : 0;
    console.log(`\n===== fn @${raw[1]}${span ? ` (${span} bytes, linear)` : ""} =====`);
    disasmBlock(va, "  ", span || 4096, !!span);
    continue;
  }
  const id = nameToId.get(name);
  console.log(`\n===== ${name} (id ${id ?? "?"}) =====`);
  if (id === undefined) { console.log("  unknown command name"); continue; }
  const va = handlerVA(id, VALUE_BANDS) ?? handlerVA(id, ACTION_BANDS);
  if (va === null) { console.log("  no handler found in dispatch tables"); continue; }
  const src = handlerVA(id, VALUE_BANDS) !== null ? "value-dispatch" : "action-dispatch";
  console.log(`  dispatch stub @0x${va.toString(16)} (${src}):`);
  const calls = disasmBlock(va, "  ");
  for (const t of calls) {
    console.log(`  -- implementation @0x${t.toString(16)}:`);
    disasmBlock(t, "    ");
  }
}
