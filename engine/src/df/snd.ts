import { DFContainerFile, readContainerFile } from "./container";
import { versionOf } from "./version";
import type { BankChunk } from "./banks";

/**
 * SND files — Dust's sound banks, which DreamFactory 1 spells `.SND` and
 * DreamFactory 4 spells `.TRK`.
 *
 * The boot script says which they are: `opentrackfile("unilib.snd")`, the same
 * builtin Titanic calls with `unilib.trk`. Same role, same audio containers (the
 * codec in {@link file://./audio.ts} reads both unchanged) — but a different way
 * of saying which sound is which, and that is why this is its own file rather
 * than a branch in {@link file://./banks.ts}.
 *
 * ## The difference, and it is a simplification
 *
 * A v4 bank keeps its chunk tables in containers of their own: container 0 points
 * at a one-shot table and a loop table, and each record in them carries the
 * container its audio lives in. `unilib.trk`'s container 0 is 52 bytes — a name
 * and two pointers.
 *
 * A v1 bank has no tables. Container 0 carries the names INLINE, and the audio is
 * simply the containers after it, in the same order:
 *
 *     158   the bank's own name, pascal
 *     186   the name table: 24 bytes per sound, the name pascal at +0
 *           sound i lives in container i + 1
 *
 * `unilib.snd` reads out as pageturn, hotbell, doorclose3, dooropen3 … — 22 names
 * for 23 containers.
 *
 * ## Why the count is not read from the header
 *
 * There is an i32 at 0x18 that equals the sound count in 38 of the 40 banks on
 * the disc, and in FLUTE.SND and MINE.SND it reads 327687 and 720896. So it is
 * either not the count or not only the count, and guessing which would cost two
 * banks. The container count answers it exactly instead: `containers - 1` holds
 * on 40 of 40, which is the same fact the layout above already asserts — one
 * container per sound, after the header.
 */

export interface SndFile {
  file: DFContainerFile;
  version: 1;
  /** the bank's own name, as the file gives it (`"unilib.snd"`, `"gossip"`) */
  refName: string;
  /**
   * The sounds, in file order — the same shape {@link BankChunk} has on the v4
   * side, so a consumer that resolves a name to a container does not care which
   * engine wrote the bank. `follow` is always "": a v1 record has no second name
   * field, which is a MOV one-shot's idea and does not exist here.
   */
  chunks: BankChunk[];
  /** what did not read the way this reader expects — empty on all 40 Dust banks */
  warnings: string[];
}

/** the bank's own name */
const REF_NAME_AT = 158;
/** the name table, and the stride between its records */
const TABLE_AT = 186;
const RECORD_SIZE = 24;
/** characters that fit a record's name field (the length byte is not counted) */
export const SND_NAME_FIELD = RECORD_SIZE - 1;

const pstr = (d: Uint8Array, o: number, max: number): string => {
  const n = d[o];
  if (n < 1 || n > max || o + 1 + n > d.length) return "";
  return String.fromCharCode(...d.subarray(o + 1, o + 1 + n));
};

export function readSndFile(data: Uint8Array): SndFile {
  return readSndFileFrom(readContainerFile(data));
}

/**
 * The same read, from a container file already opened.
 *
 * {@link file://./banks.ts} routes a v1 bank here and has the envelope in hand
 * by then; re-parsing it to get back to the same containers would be the second
 * pass for nothing.
 */
export function readSndFileFrom(file: DFContainerFile): SndFile {
  const c0 = file.containers[0].data;
  const version = versionOf(c0);
  if (version !== 1) {
    throw new Error(`not a DreamFactory 1 SND (container 0 says version ${version})`);
  }
  const warnings: string[] = [];
  const refName = pstr(c0, REF_NAME_AT, 31);
  if (!refName) warnings.push("no bank name at 158");

  // one sound per container after the header — see the note on the count above
  const count = file.containers.length - 1;
  const chunks: BankChunk[] = [];
  for (let i = 0; i < count; i++) {
    const o = TABLE_AT + i * RECORD_SIZE;
    if (o + 1 > c0.length) {
      warnings.push(`the name table stops after ${i} of ${count} sounds`);
      break;
    }
    const identifier = pstr(c0, o, SND_NAME_FIELD);
    if (!identifier) {
      warnings.push(`sound ${i}: no name at ${o}`);
      break;
    }
    chunks.push({ identifier, containerLoc: i + 1, idOffset: o, follow: "" });
  }
  return { file, version: 1, refName, chunks, warnings };
}

/**
 * The bank's LOOP BED — the music `playtheme` plays — as container locations in
 * playback order.
 *
 * A v4 bank keeps a loop ORDER table in a container of its own, and a v1 bank has
 * no tables at all, which is why this file used to answer "no loop chunks" and
 * Dust ran without music. The order is not missing: it is in the NAMES. A bank's
 * bed is the run at the END of its name table that is one stem plus ascending
 * numbers from 1 — `daymusic1..daymusic10`, `nightwind1..nightwind5`,
 * `rag1..rag5`, `helptheme1..helptheme11`, or a bare `1..16`.
 *
 * Which is checkable rather than suggestive, because the scripts name the banks
 * they want music out of and there are only eight of them: `town.snd`,
 * `bountytheme`, `saloonsep.snd`, `mission.snd`, `mine`, `isaopractice.sn`,
 * `helptheme` and `flute`. Every one resolves to a bank with such a run, and the
 * run is the music every time — 12 banks between them, because TOWN and NIGHT both
 * answer to `town.snd` (the day bed and the night bed, and the set opens whichever
 * the clock wants) and the three SALOONs all answer to `saloonsep.snd`.
 *
 * Two rules keep dialogue out. A stem ending in `.` is a SPEAKER — `ruby.108`,
 * `fear.44`, `bol.98` are lines, not bars — and a run must start at 1, which the
 * line numbering does not. Between them they drop every bank whose tail is
 * dialogue and keep all twelve that are asked for.
 */
export function sndLoopChunks(snd: SndFile): number[] {
  const numbered = (name: string): { stem: string; n: number } | null => {
    const m = /^(.*?)\s*(\d+)$/.exec(name);
    return m ? { stem: m[1].toLowerCase(), n: Number(m[2]) } : null;
  };
  let i = snd.chunks.length - 1;
  if (i < 1 || !numbered(snd.chunks[i].identifier)) return [];
  while (i > 0) {
    const prev = numbered(snd.chunks[i - 1].identifier);
    const here = numbered(snd.chunks[i].identifier)!;
    if (!prev || prev.stem !== here.stem || prev.n !== here.n - 1) break;
    i--;
  }
  const first = numbered(snd.chunks[i].identifier)!;
  if (first.n !== 1 || first.stem.endsWith(".")) return [];
  const run = snd.chunks.slice(i);
  return run.length > 1 ? run.map((c) => c.containerLoc) : [];
}

/** the container a named sound lives in, or -1 — the one thing callers want */
export function sndContainerOf(snd: SndFile, name: string): number {
  const want = name.toLowerCase();
  return snd.chunks.find((c) => c.identifier.toLowerCase() === want)?.containerLoc ?? -1;
}
