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
 * The disassembly is `tools/x86dis.ts`'s, modelled on `skullcracker/tools/scdis.mts`: function boundaries are "the
 * greatest call target at or before", which cannot see a function nothing calls.
 */
import { COMMON_MODES, X86Exe, runCommonMode } from "../../tools/x86dis";

const EXE = "redjack/gamefiles/RJDisk1/RedJack/RedJack.exe";
const exe = await X86Exe.open(EXE);

const [, , mode, arg] = process.argv;
if (mode === "cmd") {
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
    const fn = exe.dv.getUint32(exe.fileOff(table + id * 4), true);
    console.log(`${id} ${kind}: ${fn ? fn.toString(16) : "none"}`);
  }
} else if (!runCommonMode(exe, mode, arg)) {
  console.log(`modes: ${COMMON_MODES} | cmd NAME|ID`);
}
