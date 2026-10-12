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
 * A v1 bank has no table containers. Container 0 carries the names and the loop
 * order INLINE, and the audio is simply the containers after it, in the same order:
 *
 *     0x1c  i16: entries in the loop playback order
 *     0x1e  i16[]: the order, 1-based loop numbers (see {@link sndLoopChunks})
 *     158   the bank's own name, pascal
 *     186   the name table: 24 bytes per sound, the name pascal at +0
 *           sound i lives in container i + 1
 *
 * `unilib.snd` reads out as pageturn, hotbell, doorclose3, dooropen3 … — 22 names
 * for 23 containers.
 *
 * ## The two counts at 0x18, which are one field read as the wrong width
 *
 * Read as one i32, 0x18 equals the sound count in 38 of the 40 banks, and reads
 * 327687 and 720896 in FLUTE.SND and MINE.SND — so either not the count or not
 * only the count.
 *
 * It is **two i16s**, and together they are the bank's own split:
 *
 *     0x18   i16: how many ONE-SHOTS the bank holds
 *     0x1a   i16: how many LOOP chunks — the music bed — follow them
 *
 * The two sum to the sound count in **40 of 40** banks on the disc, which is what
 * says the pair is one field and which way round it is: TOWN.SND is (15, 10) and
 * its bed is `daymusic1..daymusic10`; NIGHT.SND (16, 5) and `nightwind1..5`;
 * HELP.SND (0, 11) and `helptheme1..11`; BOUNTY.SND (13, 16) and a bare `1..16`.
 * The "impossible" values were the halves showing through: 327687 is (7, 5) and
 * 720896 is (0, 11).
 *
 * The sound COUNT is still `containers - 1` rather than the sum, because that is
 * the same fact the layout above already asserts — one container per sound, after
 * the header — and it holds on 40 of 40 too. What the pair gives is the split, and
 * {@link sndLoopChunks} is what needed it.
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
  /**
   * The bank's own split of {@link chunks}: this many one-shots, then the rest are
   * the loop bed {@link sndLoopChunks} answers with. Read from the pair at 0x18,
   * and validated against the sound count — the two sum to it on all 40 Dust banks,
   * which is what identifies the pair (see the module doc).
   */
  oneshots: number;
  loops: number;
  /**
   * The bed's PLAYBACK ORDER: 1-based loop numbers, repeats allowed, out-of-range
   * entries already dropped. Read from the table at 0x1c (see {@link sndLoopChunks}).
   */
  order: number[];
  /**
   * What did not read the way this reader expects. One shipped bank warns:
   * `DRUGS.SND` stores a zero-length name at 158 — one sound, `mortar`, and no
   * `refName`, so nothing can ask for it by name and nothing does. Pinned in
   * `dust/tests/banks.ts` so a second one would be a finding.
   */
  warnings: string[];
}

/** i16: how many ONE-SHOTS the bank holds — the sounds before the bed */
const ONESHOT_COUNT_AT = 0x18;
/** i16: how many LOOP chunks follow them (see {@link sndLoopChunks}) */
const LOOP_COUNT_AT = 0x1a;
/** i16: how many entries the bed's playback order holds */
const ORDER_COUNT_AT = 0x1c;
/** i16[]: the order itself, 1-based loop numbers, up to the bank name at 158 */
const ORDER_AT = 0x1e;
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

  // the one-shot/loop split, and the check that makes it a reading: the halves
  // have to account for every sound the bank holds
  const dv = new DataView(c0.buffer, c0.byteOffset, c0.byteLength);
  const oneshots = c0.length >= ONESHOT_COUNT_AT + 2 ? dv.getInt16(ONESHOT_COUNT_AT, true) : 0;
  const loops = c0.length >= LOOP_COUNT_AT + 2 ? dv.getInt16(LOOP_COUNT_AT, true) : 0;
  if (oneshots + loops !== count) {
    warnings.push(`${oneshots} one-shots + ${loops} loops is not the ${count} sounds the bank holds`);
  }

  // the bed's playback order. DF.EXE's bank loader (0x406ec8, ALT31 build) walks
  // the i16 count at 0x1c and the i16 entries from 0x1e, skips any outside
  // 1..loops, and links the rest into a ring of theme nodes
  const order: number[] = [];
  const orderCount = c0.length >= ORDER_COUNT_AT + 2 ? dv.getInt16(ORDER_COUNT_AT, true) : 0;
  const orderMax = (REF_NAME_AT - ORDER_AT) / 2;
  if (orderCount > orderMax) {
    warnings.push(`a playback order of ${orderCount} does not fit the ${orderMax} slots before the name`);
  }
  for (let i = 0; i < Math.min(orderCount, orderMax); i++) {
    const n = dv.getInt16(ORDER_AT + i * 2, true);
    if (n >= 1 && n <= loops) order.push(n);
    else warnings.push(`playback order entry ${i} is loop ${n}, outside 1..${loops}`);
  }
  return { file, version: 1, refName, chunks, oneshots, loops, order, warnings };
}

/**
 * The bank's LOOP BED — the music `playtheme` plays — as container locations in
 * playback order.
 *
 * A v4 bank keeps a loop ORDER table in a container of its own. A v1 bank keeps
 * one too, inline in container 0: an i16 count at 0x1c and that many i16 loop
 * numbers from 0x1e, 1-based into the last `i16 @ 0x1a` sounds of the name table
 * (see the module doc's split). DF.EXE's bank loader reads it at 0x406ec8 and
 * builds the theme from it, skipping entries outside 1..loops.
 *
 * The order is not the loops once each. NIGHT.SND's 34 entries are mostly loop 3,
 * with 1, 2, 4 and 5 dropped in once each. TOWN.SND's 58 are mostly loop 5, and
 * BOUNTY.SND fills all 64 slots. Every bank with loops carries a table, and every
 * entry on the disc is in range. A bank with no table has no theme, as in DF.EXE.
 */
export function sndLoopChunks(snd: SndFile): number[] {
  const first = snd.chunks.length - snd.loops;
  if (snd.loops < 1 || first < 0) return [];
  return snd.order.map((n) => snd.chunks[first + n - 1].containerLoc);
}
