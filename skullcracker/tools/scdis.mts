/**
 * Disassemble SC.EXE, Skull Cracker's engine, around the constants its sprite
 * book reader must use.
 *
 *   npx tsx skullcracker/tools/scdis.mts find 342
 *   npx tsx skullcracker/tools/scdis.mts at 0x4a1b0:400
 *
 * The point is not to port the game. `engine/src/df/sbk.ts` reads the format by
 * inference — strides that divide, fields that agree with each other — and this
 * is the only available ORACLE for that reading: the code that actually consumed
 * these files. What it can settle is exactly what inference cannot: which of the
 * bytes this port calls dead are read, and whether a field it reads as i16 was
 * ever wider.
 *
 * Modelled on `taoot/tools/disasmcmd.mts`, which does the same job against
 * TI.EXE for the interpreter's builtins.
 */
import { readFileSync } from "node:fs";
import { Capstone, Const, loadCapstone } from "capstone-wasm";

const EXE = "skullcracker/gamefiles/SKULL/INSTALL/BIN/SC.EXE";
const data = new Uint8Array(readFileSync(EXE));
const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);

// ---- the PE, enough of it to turn a VA into a file offset ------------------
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

/** virtual address -> file offset, or -1 outside every section */
function fileOff(va: number): number {
  const rva = va - imageBase;
  for (const s of secs) if (rva >= s.va && rva < s.va + Math.max(s.vsize, s.rsize)) return s.raw + (rva - s.va);
  return -1;
}
const vaOf = (off: number, s: Sec): number => imageBase + s.va + (off - s.raw);

await loadCapstone();
const cs = new Capstone(Const.CS_ARCH_X86, Const.CS_MODE_32);
cs.setOption(Const.CS_OPT_SYNTAX, Const.CS_OPT_SYNTAX_INTEL);

/**
 * Every address that is the target of a `call rel32`, computed by bytes.
 *
 * This is the real function-entry oracle. `int3`-run detection was wrong twice
 * — MSVC pads with fewer than three, and a jump table before a function leaves
 * no padding at all — so a boundary is better taken as "the greatest call target
 * at or before this address". A function that nothing calls (a jump-table case,
 * a tail) is invisible to this, which is a known and stated limit rather than a
 * silent misread.
 */
const CALL_TARGETS: number[] = (() => {
  const set = new Set<number>();
  for (let o = text.raw; o < text.raw + text.rsize - 5; o++) {
    if (data[o] !== 0xe8) continue;
    const t = vaOf(o, text) + 5 + dv.getInt32(o + 1, true);
    if (t >= imageBase + text.va && t < imageBase + text.va + text.vsize) set.add(t);
  }
  return [...set].sort((a, b) => a - b);
})();

/** the call target at or before `va` — a function entry, by the oracle above */
function entryBefore(va: number): number {
  let lo = 0, hi = CALL_TARGETS.length - 1, best = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (CALL_TARGETS[mid] <= va) { best = CALL_TARGETS[mid]; lo = mid + 1; }
    else hi = mid - 1;
  }
  return best;
}

function show(va: number, bytes: number, indent = ""): void {
  const off = fileOff(va);
  if (off < 0) return console.log(`${indent}(VA ${va.toString(16)} is in no section)`);
  for (const i of cs.disasm(data.subarray(off, off + bytes), { address: va })) {
    console.log(`${indent}${Number(i.address).toString(16)}  ${i.mnemonic.padEnd(8)} ${i.opStr}`);
  }
}

/** every `call rel32` in .text whose target is `to` */
function callSites(to: number): number[] {
  const out: number[] = [];
  for (let off = text.raw; off < text.raw + text.rsize - 5; off++) {
    if (data[off] !== 0xe8) continue;
    const va = vaOf(off, text);
    if (va + 5 + dv.getInt32(off + 1, true) === to) out.push(va);
  }
  return out;
}

const [, , mode, arg] = process.argv;

if (mode === "find") {
  // every instruction in .text whose operand text mentions this number, in any
  // of the ways an assembler can spell it
  const want = Number(arg);
  const forms = new Set([
    `${want}`,
    `0x${want.toString(16)}`,
    `-0x${(-want).toString(16)}`,
  ]);
  let hits = 0;
  // disassemble .text in overlapping windows: a linear sweep from one point can
  // desynchronise, and this is a search rather than a decompilation
  const STEP = 0x8000;
  for (let off = text.raw; off < text.raw + text.rsize; off += STEP) {
    const end = Math.min(off + STEP + 16, text.raw + text.rsize);
    const insns = cs.disasm(data.subarray(off, end), { address: vaOf(off, text) });
    for (const i of insns) {
      const ops = i.opStr;
      let match = false;
      for (const f of forms) if (new RegExp(`(^|[^\\w])${f.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^\\w]|$)`).test(ops)) match = true;
      if (!match) continue;
      hits++;
      console.log(`${Number(i.address).toString(16)}  ${i.mnemonic.padEnd(8)} ${ops}`);
    }
  }
  console.log(`\n${hits} instruction(s) mentioning ${want}`);
} else if (mode === "bytes") {
  /**
   * Every place in `.text` where this value appears as a literal 32-bit word.
   *
   * `find` disassembles and matches the operand text, and a disassembler has to
   * pick a starting point: sweeping in windows can begin mid-instruction and
   * silently skip real references. That is not hypothetical here — a byte search
   * for the platform array found references at addresses the sweep never
   * produced. So when a negative result matters, this is the mode to trust: it
   * reads bytes, cannot desynchronise, and reports the function each hit is in
   * so the sweep can then be pointed at the right place.
   *
   * The cost is the other error: four bytes that happen to spell the value
   * inside some longer instruction or a jump table are reported too. Each hit
   * says which function it landed in, which is usually enough to tell.
   */
  const want = Number(arg) >>> 0;
  const b = [want & 0xff, (want >>> 8) & 0xff, (want >>> 16) & 0xff, (want >>> 24) & 0xff];
  let hits = 0;
  for (let off = text.raw; off < text.raw + text.rsize - 4; off++) {
    if (data[off] !== b[0] || data[off + 1] !== b[1] || data[off + 2] !== b[2] || data[off + 3] !== b[3]) continue;
    const va = vaOf(off, text);
    hits++;
    const fn = entryBefore(va);
    console.log(`${va.toString(16)}  in ${fn >= 0 ? fn.toString(16) : "?"} (+${fn >= 0 ? va - fn : "?"})`);
  }
  console.log(`\n${hits} literal occurrence(s) of 0x${want.toString(16)} in .text`);
} else if (mode === "callers") {
  /** every `call rel32` site targeting this address, with the function each is in */
  const to = Number(arg);
  const sites = callSites(to);
  for (const va of sites) {
    const fn = entryBefore(va);
    console.log(`${va.toString(16)}  in ${fn >= 0 ? fn.toString(16) : "?"} (+${fn >= 0 ? va - fn : "?"})`);
  }
  console.log(`\n${sites.length} call site(s) of 0x${to.toString(16)}`);
} else if (mode === "classes") {
  /**
   * Every entity class SC.EXE registers, with where its id is kept.
   *
   * The registration is one call — `0x40b850`, 125 sites — reached through one
   * string helper, and the shape around it varies only in where the id goes:
   *
   *     push <name>            68 imm32     the class name, in .data
   *     call 0x404440                       wrap it
   *     [xor si, si]                        sometimes
   *     add  esp, 4
   *     push eax
   *     call 0x40b850                       register -> id in AX
   *     mov  word ptr [g], ax   OR   mov si, ax
   *
   * So rather than assume a byte layout (a first version did, and matched 7 of
   * 125), this disassembles the window before each site and takes the last
   * `push imm32` that resolves to a string in .data. A site with no such push
   * is reported, never guessed.
   */
  const rows: { name: string; where: string; site: number }[] = [];
  const odd: number[] = [];
  for (const site of callSites(0x40b850)) {
    const o = fileOff(site);
    /**
     * A window is only trustworthy if its decode lands ON the call — start it
     * one byte too late and every instruction after is nonsense. So try each
     * start and keep the first whose stream contains an instruction beginning
     * exactly at the site.
     */
    let insns: ReturnType<typeof cs.disasm> = [];
    for (let back = 40; back >= 6; back--) {
      let got: ReturnType<typeof cs.disasm>;
      try {
        got = cs.disasm(data.subarray(o - back, o + 12), { address: site - back });
      } catch {
        continue;
      }
      if (got.some((i) => Number(i.address) === site)) { insns = got; break; }
    }
    let name = "";
    for (const i of insns) {
      if (Number(i.address) >= site) break;
      const m = /^push\s+(0x[0-9a-f]+)$/.exec(`${i.mnemonic} ${i.opStr}`);
      if (!m) continue;
      const at = fileOff(Number(m[1]));
      if (at < 0) continue;
      let p = at;
      while (p < data.length && data[p] === 0 && p - at < 4) p++;
      let e = p;
      while (e < data.length && data[e] >= 0x20 && data[e] < 0x7f) e++;
      if (e - p >= 3) name = new TextDecoder().decode(data.subarray(p, e));
    }
    if (!name) { odd.push(site); continue; }
    const after = insns.find((i) => Number(i.address) === site + 5);
    rows.push({ name, where: after ? `${after.mnemonic} ${after.opStr}` : "?", site });
  }
  rows.sort((a, b) => a.name.localeCompare(b.name));
  for (const r of rows) console.log(`${r.name.padEnd(18)} ${r.where.padEnd(28)} at 0x${r.site.toString(16)}`);
  console.log(`\n${rows.length} of ${rows.length + odd.length} registration sites read${odd.length ? `; unread: ${odd.map((x) => "0x" + x.toString(16)).join(" ")}` : ""}`);
} else if (mode === "books") {
  /**
   * Which function opens each sprite book, and what else it names.
   *
   * Approached from the DATA rather than the code, because guessing at which
   * function is a "level loader" from its call count did not survive contact:
   * `0x450030` is called from sixteen places and the game has sixteen levels,
   * which was suggestive and wrong. A `.sbk` filename, by contrast, is only
   * useful to whatever opens that book.
   */
  const startOf = (va: number): number => {
    let o = fileOff(va);
    for (let back = 0; back < 0x4000 && o - back > text.raw; back++) {
      if (data[o - back] === 0xcc && data[o - back - 1] === 0xcc && data[o - back - 2] === 0xcc) {
        return vaOf(o - back + 1, text);
      }
    }
    return -1;
  };
  const endOf = (start: number): number => {
    const o = fileOff(start);
    for (let i = o; i < text.raw + text.rsize - 3; i++) {
      if (data[i] === 0xcc && data[i + 1] === 0xcc && data[i + 2] === 0xcc) return i;
    }
    return text.raw + text.rsize;
  };
  const stringAt = (va: number): string => {
    const at = fileOff(va);
    if (at < 0) return "";
    let p = at;
    while (p < data.length && data[p] === 0 && p - at < 4) p++;
    let e = p;
    while (e < data.length && data[e] >= 0x20 && data[e] < 0x7f) e++;
    return new TextDecoder().decode(data.subarray(p, e));
  };
  // every *.sbk string in .data, and every push of it in .text
  const dataSec = secs.find((x) => x.name === ".data")!;
  const books: { name: string; va: number }[] = [];
  for (let i = dataSec.raw; i < dataSec.raw + dataSec.rsize; i++) {
    if (data[i] !== 0 || data[i + 1] === 0) continue;
    const s = stringAt(vaOf(i, dataSec));
    if (/^[a-z0-9]+\.sbk$/i.test(s)) books.push({ name: s, va: vaOf(i, dataSec) });
  }
  console.log(`${books.length} sprite book name(s) in .data\n`);
  for (const b of books) {
    const pushes: number[] = [];
    for (let i = text.raw; i < text.raw + text.rsize - 5; i++) {
      if (data[i] === 0x68 && dv.getUint32(i + 1, true) === b.va) pushes.push(vaOf(i, text));
    }
    const funcs = [...new Set(pushes.map(startOf))].filter((x) => x > 0);
    // what else does that function name?
    const also = new Set<string>();
    for (const f of funcs) {
      const stop = endOf(f);
      for (let i = fileOff(f); i < stop - 5; i++) {
        if (data[i] !== 0x68) continue;
        const s = stringAt(dv.getUint32(i + 1, true));
        if (/\.(snd|mov)$/i.test(s)) also.add(s);
      }
    }
    console.log(
      `${b.name.padEnd(13)} pushed ${pushes.length}x from ${funcs.map((f) => "0x" + f.toString(16)).join(" ") || "(nowhere)"}` +
      (also.size ? `   with ${[...also].join(" ")}` : ""),
    );
  }
} else if (mode === "levels") {
  /**
   * The sixteen level loaders, and which sprite book each one opens.
   *
   * `0x450030` registers one class and is called from sixteen places — the
   * shipped game has sixteen levels ("Enter level (1-16):" is in this binary's
   * own strings), so its callers are the level setups. Naming them is then a
   * matter of reading each body for the `.sbk` it pushes.
   */
  const startOf = (va: number): number => {
    let o = fileOff(va);
    for (let back = 0; back < 0x4000 && o - back > text.raw; back++) {
      if (data[o - back] === 0xcc && data[o - back - 1] === 0xcc && data[o - back - 2] === 0xcc) {
        return vaOf(o - back + 1, text);
      }
    }
    return -1;
  };
  const setups = [...new Set(callSites(0x450030).map(startOf))].filter((x) => x > 0).sort((a, b) => a - b);
  console.log(`${setups.length} level setup function(s)\n`);
  /** the byte after this function: MSVC pads with int3, so the next run ends it */
  const endOf = (start: number): number => {
    let o = fileOff(start);
    for (let i = o; i < text.raw + text.rsize - 3; i++) {
      if (data[i] === 0xcc && data[i + 1] === 0xcc && data[i + 2] === 0xcc) return i;
    }
    return text.raw + text.rsize;
  };
  /** every string this function pushes that looks like a filename */
  const filesIn = (start: number): string[] => {
    const o = fileOff(start);
    const stop = endOf(start);
    const out = new Set<string>();
    for (let i = o; i < stop - 5; i++) {
      if (data[i] !== 0x68) continue;                       // push imm32
      const at = fileOff(dv.getUint32(i + 1, true));
      if (at < 0) continue;
      let p = at;
      while (p < data.length && data[p] === 0 && p - at < 4) p++;
      let e = p;
      while (e < data.length && data[e] >= 0x20 && data[e] < 0x7f) e++;
      const s = new TextDecoder().decode(data.subarray(p, e));
      if (/\.(sbk|snd|mov)$/i.test(s)) out.add(s);
    }
    return [...out];
  };
  setups.forEach((f, i) => {
    console.log(`level setup ${String(i + 1).padStart(2)}  0x${f.toString(16)}  ${filesIn(f).join("  ")}`);
  });
} else if (mode === "funcs") {
  /**
   * Which FUNCTION each class registration sits in, and who calls it.
   *
   * Clustering the sites by address was a proxy for this and a poor one — it
   * cannot tell one long function from two adjacent ones. MSVC pads between
   * functions with `int3`, so a real boundary is findable: walk back to the last
   * run of `0xcc` and the function starts after it. Then count the call sites
   * that reach that address, which is what says whether it is a level loader
   * (called from one place) or a shared helper.
   */
  const startOf = (va: number): number => {
    let o = fileOff(va);
    for (let back = 0; back < 0x4000 && o - back > text.raw; back++) {
      // three int3 in a row is padding, not code
      if (data[o - back] === 0xcc && data[o - back - 1] === 0xcc && data[o - back - 2] === 0xcc) {
        return vaOf(o - back + 1, text);
      }
    }
    return -1;
  };
  const byFunc = new Map<number, Set<string>>();
  const rows = callSites(0x40b850);
  // reuse the classes pass to name each site
  for (const site of rows) {
    const f = startOf(site);
    (byFunc.get(f) ?? byFunc.set(f, new Set()).get(f)!).add(`0x${site.toString(16)}`);
  }
  console.log(`${rows.length} registration sites in ${byFunc.size} function(s):\n`);
  /** registration function -> the functions that call it */
  const callersOf = new Map<number, Set<number>>();
  for (const [f, sites] of [...byFunc].sort((a, b) => a[0] - b[0])) {
    const raw = f > 0 ? callSites(f) : [];
    // several calls from inside ONE function is one caller, not four: the level
    // setup calls each registration function in turn
    const owners = new Set(raw.map(startOf).filter((x) => x > 0));
    callersOf.set(f, owners);
    console.log(
      `reg 0x${f.toString(16)}  ${String(sites.size).padStart(2)} classes  ` +
      `${raw.length} call(s) from ${owners.size} function(s)` +
      (owners.size <= 5 ? `: ${[...owners].sort((a, b) => a - b).map((c) => "0x" + c.toString(16)).join(" ")}` : ""),
    );
  }
  // the level setups: whoever calls a registration function that only they call
  const setups = new Map<number, number>();
  for (const [f, owners] of callersOf) {
    if (owners.size > 6) continue;   // a shared helper, not a level's own
    for (const o of owners) setups.set(o, (setups.get(o) ?? 0) + 1);
  }
  console.log(`\n${setups.size} distinct level-setup function(s), each calling this many registration functions:`);
  for (const [f, n] of [...setups].sort((a, b) => a[0] - b[0])) {
    console.log(`  0x${f.toString(16)}  ${n}`);
  }
} else if (mode === "xref") {
  /**
   * Every instruction in .text that mentions an address, with its neighbours.
   *
   * The way into behaviour: a class id lives in a global, and whoever compares
   * against that global is the code that treats that kind of thing specially.
   *
   * It sweeps linearly rather than decoding backwards from each occurrence of
   * the bytes. Backwards was the first attempt and it is a trap: start a decode
   * one byte early and you get a real-looking instruction whose operand text
   * contains the address you were looking for — `xor eax, 0x46b9ac` where the
   * truth is `mov word ptr [0x46b9ac], ax` three bytes back. Eleven of fifteen
   * hits were that.
   */
  const target = Number(arg);
  const want = `0x${target.toString(16)}`;
  const STEP = 0x8000;
  let hits = 0;
  for (let off = text.raw; off < text.raw + text.rsize; off += STEP) {
    const end = Math.min(off + STEP + 16, text.raw + text.rsize);
    let insns: ReturnType<typeof cs.disasm>;
    try {
      insns = cs.disasm(data.subarray(off, end), { address: vaOf(off, text) });
    } catch {
      continue;
    }
    insns.forEach((i, n) => {
      if (!i.opStr.includes(want)) return;
      hits++;
      // two instructions either side, because what a comparison MEANS is the
      // branch after it
      const from = Math.max(0, n - 2);
      for (let k = from; k <= Math.min(insns.length - 1, n + 3); k++) {
        const m = insns[k];
        const mark = k === n ? ">" : " ";
        console.log(`  ${mark} 0x${Number(m.address).toString(16)}  ${m.mnemonic.padEnd(8)} ${m.opStr}`);
      }
      console.log("");
    });
  }
  console.log(`${hits} instruction(s) mentioning ${want}`);
} else if (mode === "range") {
  /**
   * Every instruction whose operand names an address inside a range.
   *
   * For a per-class record array in BSS, the base is often referenced only once
   * — where it is handed to the collector — and every later access is
   * `[reg*stride + base + field]`, a different constant per field. So the way to
   * find who reads a field is to sweep the whole range the array occupies and
   * group what turns up by its offset from the base.
   *
   *   scdis.mts range 0x4aa600:4800
   */
  const [loS, lenS] = arg.split(":");
  const lo = Number(loS);
  const hi = lo + Number(lenS ?? 4800);
  const STEP = 0x8000;
  const byOffset = new Map<number, string[]>();
  for (let off = text.raw; off < text.raw + text.rsize; off += STEP) {
    const end = Math.min(off + STEP + 16, text.raw + text.rsize);
    let insns: ReturnType<typeof cs.disasm>;
    try {
      insns = cs.disasm(data.subarray(off, end), { address: vaOf(off, text) });
    } catch {
      continue;
    }
    for (const i of insns) {
      for (const m of i.opStr.matchAll(/0x([0-9a-f]{6,8})/g)) {
        const v = parseInt(m[1], 16);
        if (v < lo || v >= hi) continue;
        const rel = v - lo;
        (byOffset.get(rel) ?? byOffset.set(rel, []).get(rel)!).push(
          `0x${Number(i.address).toString(16)}  ${i.mnemonic} ${i.opStr}`,
        );
      }
    }
  }
  console.log(`base 0x${lo.toString(16)}, ${hi - lo} bytes: ${byOffset.size} distinct offset(s) touched\n`);
  for (const [rel, lines] of [...byOffset].sort((a, b) => a[0] - b[0])) {
    console.log(`  +${rel} (record field +${rel % 48}, record ${Math.floor(rel / 48)})  ${lines.length} site(s)`);
    for (const l of lines.slice(0, 4)) console.log(`      ${l}`);
  }
} else if (mode === "func") {
  /**
   * Disassemble the whole function containing an address.
   *
   * Necessary because a decode has to START somewhere true. MSVC pads between
   * functions with `int3`, so walking back to the last run of three gives a real
   * entry point, and from there the stream is in sync all the way down. Every
   * earlier mode in this file that swept from an arbitrary offset was guessing at
   * that, and one of them silently missed 18 of 22 references.
   */
  const inside = Number(arg.split(":")[0]);
  // entry = the call target at or before the address (see CALL_TARGETS); the end
  // is the next entry, so a jump table or missing padding no longer matters
  const entry = entryBefore(inside);
  if (entry < 0) { console.log("no call target at or before that address"); }
  else {
    const idx = CALL_TARGETS.indexOf(entry);
    const nextEntry = idx + 1 < CALL_TARGETS.length ? CALL_TARGETS[idx + 1] : imageBase + text.va + text.vsize;
    const start = fileOff(entry);
    let end = fileOff(nextEntry);
    // trim trailing int3 padding from the display
    while (end > start && data[end - 1] === 0xcc) end--;
    console.log(`function 0x${entry.toString(16)}..0x${vaOf(end, text).toString(16)} (${end - start} bytes)\n`);
    for (const i of cs.disasm(data.subarray(start, end), { address: entry })) {
      const a = Number(i.address);
      const here = a === inside || (a < inside && a + i.size > inside);
      console.log(`${here ? ">" : " "} 0x${a.toString(16)}  ${i.mnemonic.padEnd(8)} ${i.opStr}`);
    }
  }
} else if (mode === "imm") {
  /**
   * Find a constant in .text by BYTES, then decode it in context.
   *
   * The alignment-independent search, which is the only kind whose negative
   * result means anything. `find` sweeps in fixed windows and can miss — it
   * reported 5 sites for 342 where this reports 15 — so anything concluded from
   * an absence should be concluded from here.
   *
   * Each hit is decoded from its enclosing function's real entry point, so the
   * instruction shown is the instruction that is there.
   */
  const want = Number(arg);
  const le = new Uint8Array(4);
  new DataView(le.buffer).setUint32(0, want, true);
  const widths = want < 0x10000 ? [4, 2] : [4];
  const seen = new Set<number>();
  const hex = `0x${want.toString(16)}`;
  for (const w of widths) {
    for (let i = text.raw; i < text.raw + text.rsize - w; i++) {
      let match = true;
      for (let k = 0; k < w; k++) if (data[i + k] !== le[k]) { match = false; break; }
      if (!match) continue;
      const va = vaOf(i, text);
      const entry = entryBefore(va);
      if (entry < 0) continue;
      const start = fileOff(entry);
      let insns: ReturnType<typeof cs.disasm>;
      try {
        insns = cs.disasm(data.subarray(start, Math.min(start + 0x4000, text.raw + text.rsize)), { address: entry });
      } catch {
        continue;
      }
      for (const ins of insns) {
        const a = Number(ins.address);
        if (a > va || a + ins.size <= va) continue;
        if (seen.has(a)) break;
        // only report it if the DECODE agrees the constant is there
        if (!ins.opStr.includes(hex) && !ins.opStr.includes(`${want}`)) break;
        seen.add(a);
        console.log(`0x${a.toString(16)}  ${ins.mnemonic.padEnd(8)} ${ins.opStr}`);
        break;
      }
    }
  }
  console.log(`\n${seen.size} instruction(s) really using ${hex}`);
} else if (mode === "anims") {
  /**
   * Every animation script the engine installs, decoded from its install sites.
   *
   * An animation script is `{i16 count, i16 ticksPerFrame, i16 kind}` followed by
   * `count` entries of `{i16 tag, i16 celId, i16 dx, i16 dy}`, and `0x45d090`
   * installs one: it stores the script at `obj+0x3e`, copies the script's `kind`
   * into the object's state field `obj+0x18`, then walks forward from frame 0
   * until it finds the TAG it was asked for. So a script is a bundle of named
   * sequences and a tag picks one.
   *
   * Scripts live in `.data` back to back with nothing delimiting them, so they
   * cannot be found by sweeping — but every one of them is `push`ed as an imm32
   * at a call to `0x45d090`, which can be. That makes this list complete by
   * construction: it is every animation the code can start, with the tags it is
   * ever started with and the functions that start it.
   *
   *   scdis.mts anims                 every script
   *   scdis.mts anims 3000-3099       only scripts drawing cels in that range
   *   scdis.mts anims 0x439240        only scripts a given function installs
   *   scdis.mts anims 0x4743b8:full   one script, frame by frame
   */
  interface Frame { tag: number; cel: number; dx: number; dy: number }
  const readScript = (va: number): { count: number; hold: number; kind: number; frames: Frame[] } | null => {
    const o = fileOff(va);
    if (o < 0 || o + 6 > data.length) return null;
    const count = dv.getInt16(o, true), hold = dv.getInt16(o + 2, true), kind = dv.getInt16(o + 4, true);
    // the shipped scripts run 1..41 frames and hold 1..4; the bounds are loose
    // on purpose, because their job is only to reject a pushed constant that is
    // not a script at all
    if (count < 1 || count > 400 || hold < 0 || hold > 200) return null;
    if (o + 6 + count * 8 > data.length) return null;
    const frames: Frame[] = [];
    for (let i = 0; i < count; i++) {
      const f = o + 6 + i * 8;
      frames.push({ tag: dv.getInt16(f, true), cel: dv.getInt16(f + 2, true), dx: dv.getInt16(f + 4, true), dy: dv.getInt16(f + 6, true) });
    }
    return { count, hold, kind, frames };
  };
  const full = /:full$/.test(arg ?? "");
  const one = full ? Number(arg.replace(/:full$/, "")) : NaN;
  if (full) {
    const s = readScript(one);
    if (!s) { console.log("not a script"); }
    else {
      console.log(`0x${one.toString(16)}  kind ${s.kind}  ticksPerFrame ${s.hold}  ${s.count} frame(s)`);
      let tag = NaN;
      for (const f of s.frames) {
        const mark = f.tag !== tag ? "*" : " ";
        tag = f.tag;
        console.log(`  ${mark} tag ${String(f.tag).padStart(3)}  cel ${String(f.cel).padStart(6)}  dx ${String(f.dx).padStart(5)}  dy ${String(f.dy).padStart(5)}`);
      }
    }
  } else {
    const range = /^\d+-\d+$/.test(arg ?? "") ? (arg ?? "").split("-").map(Number) : null;
    const owner = /^0x/.test(arg ?? "") ? Number(arg) : NaN;
    const byScript = new Map<number, { tags: Set<string>; fns: Set<number> }>();
    let unread = 0, sites = 0;
    for (const site of callSites(0x45d090)) {
      sites++;
      const o = fileOff(site);
      // as in `classes`: a window is only trustworthy if its decode lands ON the
      // call, so try each start and keep the first that does
      let insns: ReturnType<typeof cs.disasm> = [];
      for (let back = 48; back >= 6; back--) {
        try {
          const got = cs.disasm(data.subarray(o - back, o + 6), { address: site - back });
          if (got.some((i) => Number(i.address) === site)) { insns = got; break; }
        } catch { continue; }
      }
      const pushes = insns.filter((i) => Number(i.address) < site && i.mnemonic === "push").map((i) => i.opStr).slice(-3);
      let script = -1;
      for (const p of pushes) { const v = Number(p); if (Number.isFinite(v) && readScript(v)) script = v; }
      if (script < 0) { unread++; continue; }
      // the call is `push tag; push script; push obj`, so the tag is the first
      // of the three — a register when the tag is computed (a random flinch)
      const tag = pushes.length >= 3 ? pushes[0] : "?";
      const fn = entryBefore(site);
      const e = byScript.get(script) ?? { tags: new Set<string>(), fns: new Set<number>() };
      e.tags.add(Number.isFinite(Number(tag)) ? String(Number(tag)) : String(tag));
      e.fns.add(fn);
      byScript.set(script, e);
    }
    let shown = 0;
    for (const [va, e] of [...byScript].sort((a, b) => a[0] - b[0])) {
      const s = readScript(va)!;
      const cels = s.frames.map((f) => f.cel);
      if (range && !cels.some((c) => c >= range[0] && c <= range[1])) continue;
      if (Number.isFinite(owner) && !e.fns.has(owner)) continue;
      shown++;
      const tags = [...new Set(s.frames.map((f) => f.tag))].join(",");
      console.log(
        `0x${va.toString(16)}  kind ${String(s.kind).padStart(2)}  hold ${String(s.hold).padStart(2)}  ` +
        `${String(s.count).padStart(3)} frames  cels ${Math.min(...cels)}..${Math.max(...cels)}  ` +
        `tags [${tags}] used {${[...e.tags].join(",")}}  in ${[...e.fns].sort((a, b) => a - b).map((f) => "0x" + f.toString(16)).join(" ")}`,
      );
    }
    console.log(`\n${sites} install site(s), ${byScript.size} distinct script(s)${shown !== byScript.size ? `, ${shown} shown` : ""}${unread ? `, ${unread} site(s) whose script could not be read` : ""}`);
  }
} else if (mode === "calls") {
  const to = Number(arg);
  const sites = callSites(to);
  console.log(`${sites.length} call(s) to 0x${to.toString(16)}`);
  for (const s of sites) console.log(`  0x${s.toString(16)}`);
} else if (mode === "at") {
  const [va, n] = arg.split(":");
  show(Number(va), Number(n ?? 256));
} else {
  console.log(`sections: ${secs.map((s) => s.name).join(" ")}  imagebase=0x${imageBase.toString(16)}`);
  console.log(`.text VA 0x${(imageBase + text.va).toString(16)}..0x${(imageBase + text.va + text.vsize).toString(16)}`);
  console.log(`usage: scdis.mts find <n> | bytes <n> | imm <n> | callers <va> | calls <va> | at <va>[:<n>] | func <va> | xref <va> | range <va>:<n> | classes | books | levels | funcs | anims [<lo>-<hi> | <fn> | <va>:full]`);
}
cs.close();
