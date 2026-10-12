/**
 * Dust's sound banks, and the field that says which of their sounds are music.
 *
 *   npx vitest run dust/tests/banks.ts
 *
 * A v4 `.trk` keeps a loop ORDER table in a container of its own. A v1 `.snd` has
 * no such container, and the NAMES are only a heuristic: the trailing run of one
 * stem plus ascending numbers from 1, with two rules to keep dialogue out. It
 * fits the eight banks the scripts ask for music from — "eight positive cases
 * and no negative control" (#325 item 8).
 *
 * The bank says. Container 0 carries a pair of i16s at `0x18`: how many one-shots,
 * then how many loop chunks follow them. The two tests below are the two halves of
 * why that is a reading and not another guess:
 *
 *  1. the halves **account for every sound** in all forty banks, which is what
 *     identifies the pair and its order (read as one i32 the field looks like
 *     nonsense — 327687 and 720896 are (7,5) and (0,11));
 *  2. the loop half **lands on the run the names suggest**, for every bank where
 *     the names suggest one unambiguously — so the field and the name heuristic are
 *     measuring the same thing, on the 37 of 40 where they agree.
 *
 * And the three where they disagree are pinned by name, because they are the whole
 * reason the field is worth reading: the heuristic invents a bed for two banks
 * that have none and finds two bars of a five-bar one.
 *
 * Skips LOUDLY without the Dust rip, the way `dust/tests/movies.ts` does.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { readContainerFile } from "@dreamfactory/engine/df/container";
import { readSndFile, readSndFileFrom, sndLoopChunks } from "@dreamfactory/engine/df/snd";

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

test("the theme a script asks for plays the bank's own loop order", () => {
  const files = banks();
  if (skip(files)) return;
  // the banks the Dust scripts name for music: how many loops each holds, and how
  // many entries its playback order at 0x1c has. Several files answer to one name,
  // which is why the pair is the key
  const THEMES: [string, string, number, number][] = [
    ["TOWN.SND", "town.snd", 10, 58],
    ["NIGHT.SND", "town.snd", 5, 34],
    ["BOUNTY.SND", "bountytheme", 16, 64],
    ["SALOON1.SND", "saloonsep.snd", 5, 5],
    ["SALOON2.SND", "saloonsep.snd", 7, 48],
    ["SALOON3.SND", "saloonsep.snd", 4, 23],
    ["HELP.SND", "helptheme", 11, 11],
    ["ISAOPRAC.SND", "isaopractice.sn", 3, 10],
    ["MINE.SND", "mine", 11, 59],
    ["FLUTE.SND", "flute", 5, 21],
    ["MISSION.SND", "mission.snd", 5, 20],
    ["CREDITS.SND", "credits", 5, 8],
  ];
  for (const [file, asked, loops, entries] of THEMES) {
    const p = files.find((f) => name(f) === file);
    expect(p, `${file} is on the disc`).toBeTruthy();
    const snd = read(p!);
    expect(snd.refName.toLowerCase(), `${file} answers to "${asked}"`).toBe(asked);
    expect(snd.loops, `${file}'s loops`).toBe(loops);
    expect(snd.order.length, `${file}'s playback order`).toBe(entries);
    // each entry names one of the loops at the TAIL of the bank, whose containers
    // run consecutively: one container per sound, after the header
    const tail = snd.chunks.slice(-loops).map((c) => c.containerLoc);
    expect(sndLoopChunks(snd), `${file}'s bed`).toEqual(snd.order.map((n) => tail[n - 1]));
  }
});

test("NIGHT.SND's bed is loop 3 with the other four dropped in once each", () => {
  const p = banks().find((f) => name(f) === "NIGHT.SND");
  if (skip(p ? [p] : [])) return;
  // the order DF.EXE's bank loader (0x406ec8) links into the theme ring. Played
  // once each in stored order, the night town got 1,2,3,4,5 instead
  expect(read(p!).order).toEqual([
    3, 3, 3, 3, 3, 4, 3, 3, 3, 3, 3, 3, 1, 3, 3, 3, 3,
    3, 3, 3, 5, 3, 3, 3, 3, 3, 2, 3, 3, 3, 3, 3, 3, 3,
  ]);
});

test("an order entry outside the loops is dropped, as DF.EXE's loader drops it", () => {
  const p = banks().find((f) => name(f) === "NIGHT.SND");
  if (skip(p ? [p] : [])) return;
  // no shipped bank does either of these, so a copy of NIGHT.SND is made to
  const patched = (edit: (dv: DataView) => void) => {
    const file = readContainerFile(new Uint8Array(readFileSync(p!)));
    const c0 = file.containers[0].data;
    edit(new DataView(c0.buffer, c0.byteOffset, c0.byteLength));
    return readSndFileFrom(file);
  };
  // entry 0 says loop 0 and entry 1 loop 6 of five: both go, the other 32 stay
  const bad = patched((dv) => {
    dv.setInt16(0x1e, 0, true);
    dv.setInt16(0x20, 6, true);
  });
  expect(bad.order).toHaveLength(32);
  expect(bad.warnings).toEqual([
    "playback order entry 0 is loop 0, outside 1..5",
    "playback order entry 1 is loop 6, outside 1..5",
  ]);
  // a count past the 64 slots before the name reads the 64 and says so
  const long = patched((dv) => dv.setInt16(0x1c, 99, true));
  expect(long.warnings[0]).toBe("a playback order of 99 does not fit the 64 slots before the name");
  expect(long.order.length).toBeLessThanOrEqual(64);
});
