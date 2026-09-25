/**
 * Disassemble RedJack.exe — DreamFactory 5's engine — which is where the v5
 * formats are settled: what a reader of `.move`, `.stag` or `.sett` must do is
 * whatever the code that consumed them did.
 *
 *   npx tsx redjack/tools/rjdis.mts at 0x401000:200     disassemble from a VA
 *   npx tsx redjack/tools/rjdis.mts func 0x4012a0        the whole function a VA is in
 *   npx tsx redjack/tools/rjdis.mts bytes 0x53544550     a 32-bit literal in .text
 *   npx tsx redjack/tools/rjdis.mts callers 0x4012a0     every call site of a function
 *   npx tsx redjack/tools/rjdis.mts find 640             instructions mentioning a number
 *   npx tsx redjack/tools/rjdis.mts str "Flat.c"         code that pushes a string's address
 *   npx tsx redjack/tools/rjdis.mts cmd propflip         a script command's handlers
 *
 * Modelled on `skullcracker/tools/scdis.mts`: function boundaries are "the
 * greatest call target at or before", which cannot see a function nothing calls.
 */
import { readFileSync } from "node:fs";
import { Capstone, Const, loadCapstone } from "capstone-wasm";

const EXE = "redjack/gamefiles/RJDisk1/RedJack/RedJack.exe";
const data = new Uint8Array(readFileSync(EXE));
const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);

const pe = dv.getUint32(0x3c, true);
const nsec = dv.getUint16(pe + 6, true);
const optsz = dv.getUint16(pe + 20, true);
const imageBase = dv.getUint32(pe + 24 + 28, true);
interface Sec { name: string; va: number; vsize: number; raw: number; rsize: number }
const secs: Sec[] = [];
for (let i = 0; i < nsec; i++) {
  const o = pe + 24 + optsz + i * 40;
  secs.push({
    name: new TextDecoder().decode(data.subarray(o, o + 8)).replace(/\0+$/, ""),
    vsize: dv.getUint32(o + 8, true),
    va: dv.getUint32(o + 12, true),
    rsize: dv.getUint32(o + 16, true),
    raw: dv.getUint32(o + 20, true),
  });
}
const text = secs.find((s) => s.name === ".text")!;

function fileOff(va: number): number {
  const rva = va - imageBase;
  for (const s of secs) if (rva >= s.va && rva < s.va + Math.max(s.vsize, s.rsize)) return s.raw + (rva - s.va);
  return -1;
}
const vaOf = (off: number, s: Sec): number => imageBase + s.va + (off - s.raw);

await loadCapstone();
const cs = new Capstone(Const.CS_ARCH_X86, Const.CS_MODE_32);
cs.setOption(Const.CS_OPT_SYNTAX, Const.CS_OPT_SYNTAX_INTEL);

const CALL_TARGETS: number[] = (() => {
  const set = new Set<number>();
  for (let o = text.raw; o < text.raw + text.rsize - 5; o++) {
    if (data[o] !== 0xe8) continue;
    const t = vaOf(o, text) + 5 + dv.getInt32(o + 1, true);
    if (t >= imageBase + text.va && t < imageBase + text.va + text.vsize) set.add(t);
  }
  return [...set].sort((a, b) => a - b);
})();

function entryBefore(va: number): number {
  let lo = 0, hi = CALL_TARGETS.length - 1, best = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (CALL_TARGETS[mid] <= va) { best = CALL_TARGETS[mid]; lo = mid + 1; } else hi = mid - 1;
  }
  return best;
}
const entryAfter = (va: number): number => CALL_TARGETS.find((t) => t > va) ?? va + 0x400;

/** a C string at a VA, for annotating pushes */
function cstr(va: number): string | null {
  const off = fileOff(va);
  if (off < 0) return null;
  let s = "";
  for (let i = off; i < off + 80 && data[i]; i++) {
    if (data[i] < 32 || data[i] > 126) return null;
    s += String.fromCharCode(data[i]);
  }
  return s.length >= 2 ? s : null;
}

function show(va: number, bytes: number): void {
  const off = fileOff(va);
  if (off < 0) return console.log(`(VA ${va.toString(16)} is in no section)`);
  for (const i of cs.disasm(data.subarray(off, off + bytes), { address: va })) {
    let note = "";
    const m = /0x([0-9a-f]{6,8})\b/.exec(i.opStr);
    if (m) {
      const t = parseInt(m[1], 16);
      const s = cstr(t) ?? cstr(t + 1);
      if (s) note = `   ; "${s}"`;
    }
    console.log(`${Number(i.address).toString(16)}  ${i.mnemonic.padEnd(8)} ${i.opStr}${note}`);
  }
}

function callSites(to: number): number[] {
  const out: number[] = [];
  for (let off = text.raw; off < text.raw + text.rsize - 5; off++) {
    if (data[off] !== 0xe8) continue;
    const va = vaOf(off, text);
    if (va + 5 + dv.getInt32(off + 1, true) === to) out.push(va);
  }
  return out;
}

function literal(want: number): number[] {
  const b = [want & 0xff, (want >>> 8) & 0xff, (want >>> 16) & 0xff, (want >>> 24) & 0xff];
  const out: number[] = [];
  for (let off = text.raw; off < text.raw + text.rsize - 4; off++) {
    if (data[off] === b[0] && data[off + 1] === b[1] && data[off + 2] === b[2] && data[off + 3] === b[3]) out.push(vaOf(off, text));
  }
  return out;
}
const where = (va: number): string => {
  const fn = entryBefore(va);
  return `${va.toString(16)}  in ${fn >= 0 ? fn.toString(16) : "?"} (+${fn >= 0 ? va - fn : "?"})`;
};

const [, , mode, arg] = process.argv;
if (mode === "at") {
  const [a, n = "200"] = arg.split(":");
  show(Number(a), Number(n));
} else if (mode === "func") {
  const start = entryBefore(Number(arg));
  const end = entryAfter(start);
  console.log(`; function ${start.toString(16)}..${end.toString(16)}, ${callSites(start).length} caller(s)`);
  show(start, end - start);
} else if (mode === "bytes") {
  const hits = literal(Number(arg) >>> 0);
  for (const va of hits) console.log(where(va));
  console.log(`\n${hits.length} literal occurrence(s)`);
} else if (mode === "callers") {
  const sites = callSites(Number(arg));
  for (const va of sites) console.log(where(va));
  console.log(`\n${sites.length} call site(s)`);
} else if (mode === "str") {
  // every address a string with this text starts at (or one before, for the
  // flag-byte-prefixed names), then every literal reference to it
  const needle = new TextEncoder().encode(arg);
  for (let o = 0; o < data.length - needle.length; o++) {
    let ok = true;
    for (let j = 0; j < needle.length && ok; j++) ok = data[o + j] === needle[j];
    if (!ok) continue;
    for (const s of secs) {
      if (o < s.raw || o >= s.raw + s.rsize) continue;
      const va = vaOf(o, s);
      for (const back of [0, 1]) for (const hit of literal(va - back)) console.log(`"${cstr(va)}" @${(va - back).toString(16)} <- ${where(hit)}`);
    }
  }
} else if (mode === "find") {
  const want = Number(arg);
  const forms = [`${want}`, `0x${want.toString(16)}`, `-0x${(-want).toString(16)}`];
  const STEP = 0x8000;
  let hits = 0;
  for (let off = text.raw; off < text.raw + text.rsize; off += STEP) {
    const end = Math.min(off + STEP + 16, text.raw + text.rsize);
    let insns: ReturnType<typeof cs.disasm> = [];
    try { insns = cs.disasm(data.subarray(off, end), { address: vaOf(off, text) }); } catch { continue; }
    for (const i of insns) {
      if (!forms.some((f) => new RegExp(`(^|[^\\w])${f}([^\\w]|$)`).test(i.opStr))) continue;
      hits++;
      console.log(`${Number(i.address).toString(16)}  ${i.mnemonic.padEnd(8)} ${i.opStr}`);
    }
  }
  console.log(`\n${hits} instruction(s)`);
} else if (mode === "cmd") {
  // A command runs through one of two dispatchers, each indexing tables of
  // handlers by id: a statement (0x4085c0) looks in the 12xxx and 16xxx
  // tables, a value (0x4173b0) in the 16xxx and 20xxx. The 16xxx commands are
  // the get/set pairs: `propflip (p, 1)` is its statement handler and
  // `propflip (p)` its value handler.
  const { DF5_OPCODES, OPCODES } = await import("@dreamfactory/engine/df/opcodes");
  const byName = new Map([...OPCODES, ...DF5_OPCODES].map(([id, n]) => [n, id]));
  const id = /^\d+$/.test(arg) ? Number(arg) : byName.get(arg);
  if (id === undefined) throw new Error(`no command ${arg}`);
  const TABLES = [
    ["statement", 0x2ee0, 0x2f6e, 0x4ad5d0], ["statement", 0x3e80, 0x3ee6, 0x4a9988],
    ["value", 0x3e80, 0x3ee6, 0x4aa4d0], ["value", 0x4e20, 0x4edc, 0x4a6360],
  ] as const;
  for (const [kind, lo, hi, table] of TABLES) {
    if (id <= lo || id >= hi) continue;
    const fn = dv.getUint32(fileOff(table + id * 4), true);
    console.log(`${id} ${kind}: ${fn ? fn.toString(16) : "none"}`);
  }
} else {
  console.log("modes: at VA[:len] | func VA | bytes N | callers VA | find N | str TEXT | cmd NAME|ID");
}
