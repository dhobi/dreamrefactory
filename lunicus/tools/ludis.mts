/**
 * Disassemble LUNICUS.EXE — DreamFactory 0's engine, and the whole of the game's
 * logic: Lunicus has no script containers, so how it plays is this code.
 *
 *   npx tsx lunicus/tools/ludis.mts at 0x401000:200     disassemble from a VA
 *   npx tsx lunicus/tools/ludis.mts func 0x4012a0        the whole function a VA is in
 *   npx tsx lunicus/tools/ludis.mts bytes 0x53544550     a 32-bit literal in .text
 *   npx tsx lunicus/tools/ludis.mts callers 0x4012a0     every call site of a function
 *   npx tsx lunicus/tools/ludis.mts find 640             instructions mentioning a number
 *   npx tsx lunicus/tools/ludis.mts str "Flat.c"         code that pushes a string's address
 *
 * The disassembly is `tools/x86dis.ts`'s, modelled on `skullcracker/tools/scdis.mts`: function boundaries are "the
 * greatest call target at or before", which cannot see a function nothing calls.
 */
import { COMMON_MODES, X86Exe, runCommonMode } from "../../tools/x86dis";

const EXE = "lunicus/gamefiles/LUNICUS/lunicus/lunicus.exe";
const exe = await X86Exe.open(EXE);

const [, , mode, arg] = process.argv;
if (!runCommonMode(exe, mode, arg)) console.log(`modes: ${COMMON_MODES}`);
