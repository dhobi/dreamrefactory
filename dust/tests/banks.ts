/**
 * Dust's sound banks, and the field that says which of their sounds are music.
 *
 *   npx vitest run dust/tests/banks.ts
 *
 * A v4 `.trk` keeps a loop ORDER table in a container of its own. A v1 `.snd` has
 * no such container, and this port therefore derived the music bed from the NAMES
 * for a while: the trailing run of one stem plus ascending numbers from 1, with
 * two rules to keep dialogue out. It worked on the eight banks the scripts ask for
 * music from, which was also all the evidence it had — "eight positive cases and
 * no negative control", as its own docblock said (#325 item 8).
 *
 * The bank says. Container 0 carries a pair of i16s at `0x18`: how many one-shots,
 * then how many loop chunks follow them. The two tests below are the two halves of
 * why that is a reading and not another guess:
 *
 *  1. the halves **account for every sound** in all forty banks, which is what
 *     identifies the pair and its order (read as one i32 the field looks like
 *     nonsense — 327687 and 720896 are (7,5) and (0,11));
 *  2. the loop half **lands on the run the names suggest**, for every bank where
 *     the names suggest one unambiguously — so the field and the old heuristic are
 *     measuring the same thing, on the 37 of 40 where they agree.
 *
 * And the three where they disagree are pinned by name, because they are the whole
 * reason the field is worth reading: the heuristic invented a bed for two banks
 * that have none and found two bars of a five-bar one.
 *
 * Skips LOUDLY without the Dust rip, the way `dust/tests/movies.ts` does.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { readSndFile, sndLoopChunks } from "@dreamfactory/engine/df/snd";

const RIP = fileURLToPath(new URL("../gamefiles", import.meta.url));

function* walk(dir: string): Generator<string> {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (/\.(snd|sn)$/i.test(e)) yield p;
  }
}

/** every bank on the disc, sorted by basename so a report reads alphabetically */
function banks(): string[] {
  if (!existsSync(RIP)) return [];
  return [...walk(RIP)].sort((a, b) => name(a).localeCompare(name(b)));
}
const name = (p: string): string => p.split("/").pop()!.toUpperCase();
const read = (p: string) => readSndFile(new Uint8Array(readFileSync(p)));

function skip(list: string[]): boolean {
  if (list.length) return false;
  console.warn(`no .snd under ${RIP} — skipping (needs the Dust rip)`);
  return true;
}

/**
 * The one bank that warns, and what about.
 *
 * `DRUGS.SND` stores a zero-length name at 158 — one sound (`mortar`) and no
 * `refName` — so it can only be reached by filename, which is the only way
 * anything asks for it. Pinned rather than tolerated, so a SECOND nameless bank
 * would be a finding instead of a shrug.
 */
const NAMELESS = { "DRUGS.SND": ["no bank name at 158"] } as Record<string, string[]>;

test("every bank's one-shot and loop counts account for all of its sounds", () => {
  const files = banks();
  if (skip(files)) return;
  const bad: string[] = [];
  for (const p of files) {
    const snd = read(p);
    if (snd.oneshots + snd.loops !== snd.chunks.length) {
      bad.push(`${name(p)}: ${snd.oneshots} + ${snd.loops} != ${snd.chunks.length}`);
    }
    // the reader says the same thing through its warnings, and nothing else does
    expect(snd.warnings, name(p)).toEqual(NAMELESS[name(p)] ?? []);
  }
  expect(bad, `${files.length} banks`).toEqual([]);
});

/**
 * The bed, as the names spell it — the heuristic the field replaced, kept here as
 * the independent measurement it always was rather than in the reader.
 */
function bedByName(identifiers: string[]): number {
  const numbered = (s: string): { stem: string; n: number } | null => {
    const m = /^(.*?)\s*(\d+)$/.exec(s);
    return m ? { stem: m[1].toLowerCase(), n: Number(m[2]) } : null;
  };
  let i = identifiers.length - 1;
  if (i < 1 || !numbered(identifiers[i])) return 0;
  while (i > 0) {
    const prev = numbered(identifiers[i - 1]);
    const here = numbered(identifiers[i])!;
    if (!prev || prev.stem !== here.stem || prev.n !== here.n - 1) break;
    i--;
  }
  const first = numbered(identifiers[i])!;
  if (first.n !== 1 || first.stem.endsWith(".")) return 0;
  return identifiers.length - i > 1 ? identifiers.length - i : 0;
}

/** the three banks where the names and the field disagree, and what each really is */
const DISAGREE: Record<string, { field: number; byName: number; why: string }> = {
  "DOORLIB.SND": { field: 0, byName: 3, why: "lsing1..3 are hinge squeaks, not bars" },
  "SALGAMES.SND": { field: 0, byName: 4, why: "discard1..4 are card sounds, not bars" },
  "MISSION.SND": { field: 5, byName: 2, why: "the bed is two stems: silence wind1 wind2 chantwind1 chantwind2" },
};

test("the loop count lands on the run the names suggest, and names the three it does not", () => {
  const files = banks();
  if (skip(files)) return;
  const bad: string[] = [];
  const surprises: string[] = [];
  for (const p of files) {
    const snd = read(p);
    const byName = bedByName(snd.chunks.map((c) => c.identifier));
    const expected = DISAGREE[name(p)];
    if (expected) {
      // pinned: the field and the names, both, so a change to either shows here
      if (snd.loops !== expected.field || byName !== expected.byName) {
        bad.push(
          `${name(p)}: field=${snd.loops} names=${byName}, expected ${expected.field}/${expected.byName}` +
            ` (${expected.why})`,
        );
      }
      continue;
    }
    if (byName !== snd.loops) surprises.push(`${name(p)}: field=${snd.loops} names=${byName}`);
  }
  expect(bad, "the three known disagreements").toEqual([]);
  expect(surprises, "banks where the names and the field newly disagree").toEqual([]);
});

test("the theme a script asks for is the bed at the end of the bank", () => {
  const files = banks();
  if (skip(files)) return;
  // the banks the Dust scripts name for music, and how many bars each holds —
  // several files answer to one name, which is why the pair is the key
  const THEMES: [string, string, number][] = [
    ["TOWN.SND", "town.snd", 10],
    ["NIGHT.SND", "town.snd", 5],
    ["BOUNTY.SND", "bountytheme", 16],
    ["SALOON1.SND", "saloonsep.snd", 5],
    ["SALOON2.SND", "saloonsep.snd", 7],
    ["SALOON3.SND", "saloonsep.snd", 4],
    ["HELP.SND", "helptheme", 11],
    ["ISAOPRAC.SND", "isaopractice.sn", 3],
    ["MINE.SND", "mine", 11],
    ["FLUTE.SND", "flute", 5],
    ["MISSION.SND", "mission.snd", 5],
    ["CREDITS.SND", "credits", 5],
  ];
  for (const [file, asked, bars] of THEMES) {
    const p = files.find((f) => name(f) === file);
    expect(p, `${file} is on the disc`).toBeTruthy();
    const snd = read(p!);
    expect(snd.refName.toLowerCase(), `${file} answers to "${asked}"`).toBe(asked);
    const bed = sndLoopChunks(snd);
    expect(bed.length, `${file}'s bed`).toBe(bars);
    // the bed is the TAIL of the bank, and its containers run consecutively —
    // one container per sound, after the header
    expect(bed, `${file}'s bed is the last ${bars} containers`).toEqual(
      snd.chunks.slice(-bars).map((c) => c.containerLoc),
    );
  }
});
