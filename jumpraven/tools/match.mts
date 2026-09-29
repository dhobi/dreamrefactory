/**
 * Pair RAVEN.EXE's functions with LUNICUS.EXE's.
 *
 *   npx tsx jumpraven/tools/match.mts                 the table, Raven VA → Lunicus VA
 *   npx tsx jumpraven/tools/match.mts lu 0x40e038     the Raven function for a Lunicus one
 *   npx tsx jumpraven/tools/match.mts rv 0x40d000     the Lunicus function for a Raven one
 *
 * The two engines are a month apart (RAVEN.EXE 1994-06-14, LUNICUS.EXE
 * 1994-07-19) and share most of their code, and Lunicus's has been read
 * (lunicus/src/game/ cites its addresses). A function is its instructions with
 * every address masked, since the two images lay out their code and data
 * differently. Identical sequences pair outright; the rest pair by the
 * similarity of their instruction trigrams, and a pair is kept only if each is
 * the other's best.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { Capstone, Const, loadCapstone } from "capstone-wasm";

interface Exe { data: Uint8Array; dv: DataView; base: number; text: { va: number; raw: number; size: number }; }
function load(path: string): Exe {
  const data = new Uint8Array(readFileSync(path));
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const pe = dv.getUint32(0x3c, true);
  const optsz = dv.getUint16(pe + 20, true);
  const base = dv.getUint32(pe + 24 + 28, true);
  for (let i = 0; i < dv.getUint16(pe + 6, true); i++) {
    const o = pe + 24 + optsz + i * 40;
    if (new TextDecoder().decode(data.subarray(o, o + 5)) === ".text")
      return { data, dv, base, text: { va: base + dv.getUint32(o + 12, true), raw: dv.getUint32(o + 20, true), size: dv.getUint32(o + 16, true) } };
  }
  throw new Error(`${path}: no .text`);
}

await loadCapstone();
const cs = new Capstone(Const.CS_ARCH_X86, Const.CS_MODE_32);
cs.setOption(Const.CS_OPT_SYNTAX, Const.CS_OPT_SYNTAX_INTEL);

interface Fn { va: number; ops: string[]; key: string; grams: Set<string>; }
function functions(e: Exe): Fn[] {
  const { data, dv, text } = e;
  const set = new Set<number>();
  for (let o = text.raw; o < text.raw + text.size - 5; o++) {
    if (data[o] !== 0xe8) continue;
    const t = text.va + (o - text.raw) + 5 + dv.getInt32(o + 1, true);
    if (t >= text.va && t < text.va + text.size) set.add(t);
  }
  const starts = [...set].sort((a, b) => a - b);
  return starts.map((va, i) => {
    const end = starts[i + 1] ?? va + 0x400;
    const off = text.raw + (va - text.va);
    let ops: string[] = [];
    try {
      ops = cs.disasm(data.subarray(off, off + Math.min(end - va, 0x4000)), { address: va }).map((ins) => {
        let op = ins.opStr.replace(/0x4[0-9a-f]{5}\b/g, "A");
        if (/^(call|j)/.test(ins.mnemonic)) op = /^0x|^A$/.test(op) ? "T" : op;
        return `${ins.mnemonic} ${op}`;
      });
    } catch { /* data in .text */ }
    const grams = new Set<string>();
    for (let k = 0; k + 2 < ops.length; k++) grams.add(ops[k] + "|" + ops[k + 1] + "|" + ops[k + 2]);
    return { va, ops, key: ops.join(";"), grams };
  });
}

const rv = functions(load("jumpraven/gamefiles/RAVEN/RAVEN/RAVEN.EXE"));
const lu = functions(load("lunicus/gamefiles/LUNICUS/lunicus/lunicus.exe"));

const pairs = new Map<number, { lu: number; score: number }>();
const luTaken = new Set<number>();
// exact, and unique on both sides
const byKey = (fs: Fn[]) => { const m = new Map<string, Fn[]>(); for (const f of fs) m.set(f.key, [...(m.get(f.key) ?? []), f]); return m; };
const rk = byKey(rv), lk = byKey(lu);
for (const [k, rs] of rk) { const ls = lk.get(k); if (rs.length === 1 && ls?.length === 1 && rs[0].ops.length > 3) { pairs.set(rs[0].va, { lu: ls[0].va, score: 1 }); luTaken.add(ls[0].va); } }
// fuzzy, mutual best
const sim = (a: Fn, b: Fn) => { let n = 0; for (const g of a.grams) if (b.grams.has(g)) n++; return n / Math.max(1, a.grams.size + b.grams.size - n); };
const rLeft = rv.filter((f) => !pairs.has(f.va) && f.grams.size >= 4);
const lLeft = lu.filter((f) => !luTaken.has(f.va) && f.grams.size >= 4);
const best = (f: Fn, pool: Fn[]) => { let b: Fn | null = null, s = 0; for (const g of pool) { if (Math.abs(g.grams.size - f.grams.size) > Math.max(f.grams.size, g.grams.size) * 0.6) continue; const x = sim(f, g); if (x > s) (s = x), (b = g); } return { b, s }; };
for (const f of rLeft) {
  const { b, s } = best(f, lLeft);
  if (!b || s < 0.35) continue;
  if (best(b, rLeft).b !== f) continue;
  pairs.set(f.va, { lu: b.va, score: s });
}

const [, , mode, arg] = process.argv;
const hex = (n: number) => "0x" + n.toString(16);
const containing = (fs: Fn[], va: number) => { let c: Fn | undefined; for (const f of fs) if (f.va <= va) c = f; return c; };
if (mode === "lu") {
  const want = Number(arg), f = containing(lu, want)!;
  const hit = [...pairs].find(([, p]) => p.lu === f.va);
  console.log(hit ? `lunicus ${hex(f.va)} (+${want - f.va}) = raven ${hex(hit[0])} (score ${hit[1].score.toFixed(2)})` : `lunicus ${hex(f.va)}: no pair`);
} else if (mode === "rv") {
  const want = Number(arg), f = containing(rv, want)!;
  const p = pairs.get(f.va);
  console.log(p ? `raven ${hex(f.va)} (+${want - f.va}) = lunicus ${hex(p.lu)} (score ${p.score.toFixed(2)})` : `raven ${hex(f.va)}: no pair`);
} else {
  for (const f of rv) { const p = pairs.get(f.va); console.log(`${hex(f.va)} ${p ? hex(p.lu) + " " + p.score.toFixed(2) : "-"} ${f.ops.length}`); }
  mkdirSync("out/jumpraven", { recursive: true });
  writeFileSync("out/jumpraven/pairs.json", JSON.stringify(Object.fromEntries([...pairs].map(([r, p]) => [r, `0x${p.lu.toString(16)}`])), null, 0));
  const exact = [...pairs.values()].filter((p) => p.score === 1).length;
  console.error(`raven ${rv.length} functions, lunicus ${lu.length}; paired ${pairs.size} (${exact} exact)`);
}
