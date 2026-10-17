/**
 * The 32-bit Windows executables' disassembly, shared by the per-game tools:
 * `lunicus/tools/ludis.mts`, `jumpraven/tools/rvdis.mts`,
 * `redjack/tools/rjdis.mts` and `skullcracker/tools/scdis.mts`. Each opens its
 * EXE here and adds the modes of its own (Jump Raven's Lunicus pairs, RedJack's
 * command tables, Skull Cracker's class tables) after {@link runCommonMode}.
 *
 * Function boundaries are "the greatest call target at or before this address".
 * `int3`-run detection is not an oracle — MSVC pads with fewer than three, and a
 * jump table before a function leaves no padding at all. A function that nothing
 * calls (a jump-table case, a tail) is invisible to this, which is a known and
 * stated limit rather than a silent misread.
 */
import { readFileSync } from "node:fs";
import { Capstone, Const, loadCapstone } from "capstone-wasm";

export interface Section {
  name: string;
  va: number;
  vsize: number;
  raw: number;
  rsize: number;
}

/** what {@link runCommonMode} answers, for a tool's usage line */
export const COMMON_MODES = "at VA[:len] | func VA | bytes N | callers VA | find N | str TEXT";

export class X86Exe {
  readonly dv: DataView;
  readonly imageBase: number;
  readonly secs: Section[] = [];
  readonly text: Section;
  /** the import table, so `call dword ptr [0x4301fc]` reads as `_portplaywave` */
  readonly imports = new Map<number, string>();
  /** every address that is the target of a `call rel32` into .text, sorted: the function-entry oracle */
  readonly callTargets: number[];

  private constructor(
    readonly data: Uint8Array,
    readonly cs: Capstone,
  ) {
    const dv = (this.dv = new DataView(data.buffer, data.byteOffset, data.byteLength));
    const pe = dv.getUint32(0x3c, true);
    const optsz = dv.getUint16(pe + 20, true);
    this.imageBase = dv.getUint32(pe + 24 + 28, true);
    for (let i = 0; i < dv.getUint16(pe + 6, true); i++) {
      const o = pe + 24 + optsz + i * 40;
      this.secs.push({
        name: new TextDecoder().decode(data.subarray(o, o + 8)).split("\0")[0],
        vsize: dv.getUint32(o + 8, true),
        va: dv.getUint32(o + 12, true),
        rsize: dv.getUint32(o + 16, true),
        raw: dv.getUint32(o + 20, true),
      });
    }
    this.text = this.secs.find((s) => s.name === ".text")!;
    this.readImports(pe + 24);
    this.callTargets = this.findCallTargets();
  }

  static async open(path: string): Promise<X86Exe> {
    await loadCapstone();
    const cs = new Capstone(Const.CS_ARCH_X86, Const.CS_MODE_32);
    cs.setOption(Const.CS_OPT_SYNTAX, Const.CS_OPT_SYNTAX_INTEL);
    return new X86Exe(new Uint8Array(readFileSync(path)), cs);
  }

  /** virtual address -> file offset, or -1 outside every section */
  fileOff(va: number): number {
    const rva = va - this.imageBase;
    for (const s of this.secs) if (rva >= s.va && rva < s.va + Math.max(s.vsize, s.rsize)) return s.raw + (rva - s.va);
    return -1;
  }
  vaOf(off: number, s: Section = this.text): number {
    return this.imageBase + s.va + (off - s.raw);
  }

  private readImports(opt: number): void {
    const { data, dv, imageBase } = this;
    const cstrAt = (off: number) => {
      let e = off;
      while (data[e]) e++;
      return new TextDecoder().decode(data.subarray(off, e));
    };
    const dir = dv.getUint32(opt + 104, true);
    if (!dir) return;
    for (let d = this.fileOff(imageBase + dir); dv.getUint32(d + 12, true); d += 20) {
      const dll = cstrAt(this.fileOff(imageBase + dv.getUint32(d + 12, true)));
      const ilt = dv.getUint32(d, true) || dv.getUint32(d + 16, true);
      for (let k = 0; ; k++) {
        const e = dv.getUint32(this.fileOff(imageBase + ilt) + k * 4, true);
        if (!e) break;
        this.imports.set(imageBase + dv.getUint32(d + 16, true) + k * 4, e & 0x80000000 ? `${dll}#${e & 0xffff}` : cstrAt(this.fileOff(imageBase + e) + 2));
      }
    }
  }

  /** each `call rel32` in .text, as its site and its target */
  *calls(): Generator<{ site: number; target: number }> {
    const { data, dv, text } = this;
    for (let o = text.raw; o < text.raw + text.rsize - 5; o++) {
      if (data[o] !== 0xe8) continue;
      const site = this.vaOf(o);
      yield { site, target: site + 5 + dv.getInt32(o + 1, true) };
    }
  }

  private findCallTargets(): number[] {
    // the section's raw size, not only its virtual size: the DreamFactory 0
    // linker leaves .text's virtual size 0
    const lo = this.imageBase + this.text.va;
    const hi = lo + Math.max(this.text.vsize, this.text.rsize);
    const set = new Set<number>();
    for (const { target } of this.calls()) if (target >= lo && target < hi) set.add(target);
    return [...set].sort((a, b) => a - b);
  }

  /** the call target at or before `va` — a function entry, by the oracle */
  entryBefore(va: number): number {
    const t = this.callTargets;
    let lo = 0, hi = t.length - 1, best = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (t[mid] <= va) {
        best = t[mid];
        lo = mid + 1;
      } else hi = mid - 1;
    }
    return best;
  }
  entryAfter(va: number): number {
    return this.callTargets.find((t) => t > va) ?? va + 0x400;
  }

  /** every `call rel32` in .text whose target is `to` */
  callSites(to: number): number[] {
    const out: number[] = [];
    for (const { site, target } of this.calls()) if (target === to) out.push(site);
    return out;
  }

  /** a printable C string at a VA, for annotating pushes */
  cstr(va: number): string | null {
    const off = this.fileOff(va);
    if (off < 0) return null;
    let s = "";
    for (let i = off; i < off + 80 && this.data[i]; i++) {
      if (this.data[i] < 32 || this.data[i] > 126) return null;
      s += String.fromCharCode(this.data[i]);
    }
    return s.length >= 2 ? s : null;
  }

  /** every place in .text a 32-bit literal sits */
  literal(want: number): number[] {
    const { data, text } = this;
    const b = [want & 0xff, (want >>> 8) & 0xff, (want >>> 16) & 0xff, (want >>> 24) & 0xff];
    const out: number[] = [];
    for (let off = text.raw; off < text.raw + text.rsize - 4; off++) {
      if (data[off] === b[0] && data[off + 1] === b[1] && data[off + 2] === b[2] && data[off + 3] === b[3]) out.push(this.vaOf(off));
    }
    return out;
  }

  /** "4012a6  in 4012a0 (+6)" */
  where(va: number): string {
    const fn = this.entryBefore(va);
    return `${va.toString(16)}  in ${fn >= 0 ? fn.toString(16) : "?"} (+${fn >= 0 ? va - fn : "?"})`;
  }

  /** disassemble `bytes` from `va`, an import's name or a string beside an address that is one */
  show(va: number, bytes: number, indent = ""): void {
    const off = this.fileOff(va);
    if (off < 0) return console.log(`${indent}(VA ${va.toString(16)} is in no section)`);
    for (const i of this.cs.disasm(this.data.subarray(off, off + bytes), { address: va })) {
      console.log(`${indent}${Number(i.address).toString(16)}  ${i.mnemonic.padEnd(8)} ${i.opStr}${this.note(i.opStr)}`);
    }
  }
  private note(opStr: string): string {
    const m = /0x([0-9a-f]{6,8})\b/.exec(opStr);
    if (!m) return "";
    const t = parseInt(m[1], 16);
    const imp = this.imports.get(t);
    if (imp) return `   ; ${imp}`;
    const s = this.cstr(t) ?? this.cstr(t + 1);
    return s ? `   ; "${s}"` : "";
  }
}

/**
 * The modes every tool has ({@link COMMON_MODES}); false when `mode` is none of
 * them, for the tool to try its own.
 */
export function runCommonMode(exe: X86Exe, mode: string | undefined, arg: string): boolean {
  switch (mode) {
    case "at": {
      const [a, n = "200"] = arg.split(":");
      exe.show(Number(a), Number(n));
      return true;
    }
    case "func": {
      const start = exe.entryBefore(Number(arg));
      const end = exe.entryAfter(start);
      console.log(`; function ${start.toString(16)}..${end.toString(16)}, ${exe.callSites(start).length} caller(s)`);
      exe.show(start, end - start);
      return true;
    }
    case "bytes": {
      const hits = exe.literal(Number(arg) >>> 0);
      for (const va of hits) console.log(exe.where(va));
      console.log(`\n${hits.length} literal occurrence(s)`);
      return true;
    }
    case "callers": {
      const sites = exe.callSites(Number(arg));
      for (const va of sites) console.log(exe.where(va));
      console.log(`\n${sites.length} call site(s)`);
      return true;
    }
    case "str":
      strRefs(exe, arg);
      return true;
    case "find":
      findNumber(exe, Number(arg));
      return true;
    default:
      return false;
  }
}

/**
 * Every address a string with this text starts at (or one before, for the
 * flag-byte-prefixed names), then every literal reference to it.
 */
function strRefs(exe: X86Exe, text: string): void {
  const { data } = exe;
  const needle = new TextEncoder().encode(text);
  for (let o = 0; o < data.length - needle.length; o++) {
    if (!needle.every((b, j) => data[o + j] === b)) continue;
    for (const s of exe.secs) {
      if (o < s.raw || o >= s.raw + s.rsize) continue;
      const va = exe.vaOf(o, s);
      for (const back of [0, 1]) for (const hit of exe.literal(va - back)) console.log(`"${exe.cstr(va)}" @${(va - back).toString(16)} <- ${exe.where(hit)}`);
    }
  }
}

/** every instruction in .text whose operands mention `want`, in decimal or hex */
function findNumber(exe: X86Exe, want: number): void {
  const { data, text, cs } = exe;
  const forms = [`${want}`, `0x${want.toString(16)}`, `-0x${(-want).toString(16)}`].map((f) => new RegExp(`(^|[^\\w])${f}([^\\w]|$)`));
  const STEP = 0x8000;
  let hits = 0;
  for (let off = text.raw; off < text.raw + text.rsize; off += STEP) {
    const end = Math.min(off + STEP + 16, text.raw + text.rsize);
    let insns: ReturnType<typeof cs.disasm> = [];
    try {
      insns = cs.disasm(data.subarray(off, end), { address: exe.vaOf(off) });
    } catch {
      continue;
    }
    for (const i of insns) {
      if (!forms.some((f) => f.test(i.opStr))) continue;
      hits++;
      console.log(`${Number(i.address).toString(16)}  ${i.mnemonic.padEnd(8)} ${i.opStr}`);
    }
  }
  console.log(`\n${hits} instruction(s)`);
}
