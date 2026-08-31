/**
 * Every container index a header names, checked against what it points at.
 *
 *   npx vitest run engine/tests/container-refs.ts
 *
 * This is #325 made permanent. The bug class it guards is one shape: **a
 * container index that is guessed, searched for, or hardcoded by convention,
 * where the file names it.** The repo has been bitten by it three times —
 * `banks.ts` assumed the loop table was container 1 (true of 615 of 630 v4 banks,
 * false for exactly Skull Cracker's fifteen music banks), `sbk.ts` found the
 * palette by its 2056-byte size until `STREETS.SBK` turned out to have two, and
 * `set-v1.ts` read the main script from a header word that is a CONSTANT, which
 * cost `undertak.set` its entire script (#291).
 *
 * What makes the class dangerous is that a wrong reading is invisible in a
 * corpus where the convention holds. Every field here reads the same value in
 * every shipped file: the SHP and CST main scripts are container 1 in all 207
 * and all 13, the STG main script is container 1 in all 388. So this suite
 * cannot prove the offsets — the disassembly did that, and each reader carries
 * the instructions it was read from. What it CAN do, and what #291 needed, is
 * fail the moment a file turns up whose header points somewhere else and the
 * target is not a script. That is the file that would otherwise be read
 * silently wrong.
 *
 * So each test asserts two things per file:
 *
 *  1. the index is **in range** — a header word being read as a ref at all;
 *  2. the container it names is a **script** (or the 8-byte empty a shop with no
 *     main carries, which is the format's way of saying "none" and decompiles to
 *     nothing).
 *
 * Both would have been false on `undertak.set` before #291, on the old offset.
 *
 * It reads whatever rips are present and skips LOUDLY when none is, the way
 * `sbk.ts` and `byte-order.ts` do — a silent skip let five of `byte-order.ts`'s
 * tests pass by not running for a day.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { readContainerFile } from "@dreamfactory/engine/df/container";
import { sniffScript } from "@dreamfactory/engine/df/script";
import { readShpFile } from "@dreamfactory/engine/df/shp";
import { readStgFile } from "@dreamfactory/engine/df/stg";
import { readCstFile } from "@dreamfactory/engine/df/cst";
import { readPupFile } from "@dreamfactory/engine/df/pup";

/** every rip in the workspace, by package — absent ones are simply not there */
const RIPS = ["taoot", "dust", "timelapse", "skullcracker"]
  .map((pkg) => fileURLToPath(new URL(`../../${pkg}/gamefiles`, import.meta.url)))
  .filter(existsSync);

function* walk(dir: string): Generator<string> {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    let dirent;
    try {
      dirent = statSync(p);
    } catch {
      continue; // an unreadable entry is not a finding about the formats
    }
    if (dirent.isDirectory()) yield* walk(p);
    else yield p;
  }
}

/** every file in every rip whose name matches, sorted for a stable report */
function corpus(re: RegExp): string[] {
  const out: string[] = [];
  for (const rip of RIPS) for (const p of walk(rip)) if (re.test(p)) out.push(p);
  return out.sort();
}

/**
 * A file whose header says it is longer than it is — a damaged rip file, not a
 * finding about a reader. One exists: `ru/titanic1/PUPPETS2/NARRATE.PUP` declares
 * 8,195,712 bytes and is 6,225,917, about 1.97 MB short, where every other
 * edition's copy is whole. Reported by name rather than skipped in silence.
 */
function truncated(bytes: Uint8Array): boolean {
  if (bytes.length < 8) return true;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // the header's own size field, either way round — the same word detectByteOrder
  // asks, so a big-endian file is not mistaken for a broken one
  return dv.getUint32(4, true) !== bytes.length && dv.getUint32(4, false) !== bytes.length;
}

/** true when this container is a script, or the empty stub that means "none" */
function scriptOrEmpty(data: Uint8Array | undefined): boolean {
  if (!data) return false;
  if (data.length <= 8) return true; // the 8-byte empty container
  return !!sniffScript(data);
}

/**
 * Assert one header ref per file, and report the whole corpus rather than the
 * first failure — a systematic misread shows as hundreds of lines and a
 * single-file counterexample as one, which is the difference between "the offset
 * is wrong" and "here is the `undertak.set` of this format".
 */
function checkRefs(
  what: string,
  files: string[],
  refOf: (bytes: Uint8Array) => { ref: number; count: number } | null,
): void {
  if (!files.length) {
    console.warn(`no ${what} under ${RIPS.join(", ") || "(no rip present)"} — skipping`);
    return;
  }
  const bad: string[] = [];
  const short: string[] = [];
  for (const p of files) {
    const bytes = new Uint8Array(readFileSync(p));
    if (truncated(bytes)) {
      short.push(p);
      continue;
    }
    let got;
    try {
      got = refOf(bytes);
    } catch {
      continue; // not a file of this format after all (a name collision)
    }
    if (!got) continue;
    const { ref, count } = got;
    if (ref <= 0 || ref >= count) {
      bad.push(`${p}: names container ${ref} of ${count}`);
      continue;
    }
    const data = readContainerFile(bytes).containers[ref].data;
    if (!scriptOrEmpty(data)) bad.push(`${p}: container ${ref} is ${data.length} bytes and not a script`);
  }
  if (short.length) console.warn(`${short.length} truncated ${what} skipped: ${short.join(", ")}`);
  expect(bad, `${files.length} ${what}`).toEqual([]);
}

test("every shop names a main script container that holds one", () => {
  checkRefs("shp/prp", corpus(/\.(shp|prp)$/i), (bytes) => {
    const shp = readShpFile(bytes);
    return { ref: shp.mainScriptLocation, count: shp.file.containers.length };
  });
});

test("every stage names a main script container that holds one", () => {
  checkRefs("stg/flt", corpus(/\.(stg|flt)$/i), (bytes) => {
    const stg = readStgFile(bytes);
    return { ref: stg.mainScriptLocation, count: stg.file.containers.length };
  });
});

test("every cast names a main script container that holds one", () => {
  checkRefs("cst", corpus(/\.cst$/i), (bytes) => {
    const cst = readCstFile(bytes);
    return { ref: cst.mainScriptLocation, count: cst.file.containers.length };
  });
});

/**
 * A puppet's script table and stance side are containers 2 and 3 as IMMEDIATES —
 * both engines push the literal (TI.EXE `0x43ef30`, DF.EXE `0x435910`), so there
 * is no field to be wrong about and nothing here to compare against. What is
 * worth holding is the outcome: every puppet reads, and the stance each of its
 * dialogue lines NAMES actually draws something. A puppet with a voice, a
 * subtitle and no face was a real report.
 *
 * "The stance a line names", not "every stance in the directory": the shipped
 * puppets pad theirs. `narrate.pup` holds four and only the first draws; `bsea2`'s
 * last three carry one frame in one layer. Every dialogue line in both names
 * stance 0, so the padding is unused entries rather than missing art.
 *
 * This is what found the German `bsea2.pup` — a Macintosh build in a Windows rip,
 * whose fields `readPupFile` was reading the wrong way round.
 */
test("every puppet reads, and the stances its lines name draw something", () => {
  const files = corpus(/\.pup$/i);
  if (!files.length) {
    console.warn(`no .pup under ${RIPS.join(", ") || "(no rip present)"} — skipping`);
    return;
  }
  const bad: string[] = [];
  const short: string[] = [];
  for (const p of files) {
    const bytes = new Uint8Array(readFileSync(p));
    if (truncated(bytes)) {
      short.push(p);
      continue;
    }
    let pup;
    try {
      pup = readPupFile(bytes);
    } catch (e) {
      bad.push(`${p}: ${(e as Error).message}`);
      continue;
    }
    if (pup.file.containers.length < 4) bad.push(`${p}: ${pup.file.containers.length} containers`);
    if (!pup.stances.length) bad.push(`${p}: no stance`);
    for (const stance of new Set([...pup.dialogue.values()].map((d) => d.stance))) {
      const st = pup.stances[stance];
      if (!st) bad.push(`${p}: dialogue names stance ${stance}, the file has ${pup.stances.length}`);
      else if (!st.layers.some((l) => l.frames.length)) bad.push(`${p}: stance ${stance} draws nothing`);
    }
  }
  if (short.length) console.warn(`${short.length} truncated .pup skipped: ${short.join(", ")}`);
  expect(bad, `${files.length} puppets`).toEqual([]);
});
