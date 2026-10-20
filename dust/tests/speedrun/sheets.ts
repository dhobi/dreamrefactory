/**
 * Every contributed speedrun sheet plays to its end (dust/speedrun/sheets/).
 *
 *   npm run test:machine -w dust -- tests/speedrun/sheets.ts
 *   SHEETS=my-route npm run test:machine -w dust -- tests/speedrun/sheets.ts   # only files matching
 *
 * Titanic's check (taoot/tests/speedrun/sheets.ts) for Dust, and held to the
 * same rules (dust/speedrun/sheets/README.md): line 1 is the title, a seeded
 * sheet (`reset(seed: N)`) is one run, and an unseeded one is played on three
 * seeds and must finish on each — Dust's dice are the cards, the poker and the
 * gunfights, and a route that only finishes on lucky ones is not a route. Each
 * play is a whole game on the sheet clock, about a minute and a half here.
 *
 * Skips without the rip, as Dust's machine suites do. The times are written to
 * `out/speedrun/dust-sheets.md`, and to the job summary when CI runs this.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, expect, test } from "vitest";
import { parseSheet, SheetError, type Step } from "@dreamfactory/speedrun/sheet";
import { readSheetHeader, sheetSeed } from "@dreamfactory/speedrun/sheet-header";
import { runSheet } from "@dreamfactory/speedrun/runner";
import { ACTIONS, VERBS } from "../../src/speedrun/actions";
import { haveRip, SAVES } from "../playthrough/harness";
import { headlessRun } from "./headless";

const DIR = join(import.meta.dirname, "..", "..", "speedrun", "sheets");
/** the seeds an unseeded sheet is played on */
const UNSEEDED = [1, 2, 3];

const only = process.env.SHEETS;
const files = readdirSync(DIR)
  .filter((f) => f.endsWith(".sheet.txt"))
  .filter((f) => !only || f.includes(only))
  .sort();

const run = haveRip() ? test : test.skip;

/** in-game ms as m:ss.t, the workbench's own format */
const clock = (ms: number): string => {
  const t = Math.round(ms / 100);
  return `${Math.floor(t / 600)}:${String(Math.floor((t % 600) / 10)).padStart(2, "0")}.${t % 10}`;
};

const rows: string[] = [];

async function play(steps: Step[], seed: number): Promise<{ game: number; frames: number }> {
  // the page's base for a save it writes (src/saves.ts dustTemplate), for the
  // verbs that save through the game's own menu and load on a lost hand
  const template = new Uint8Array(readFileSync(join(SAVES, "D1E_001.RTD")));
  const { driver } = await headlessRun({
    prepare: (s) => {
      s.nominalTime = true;
      s.sheetClock = true;
      s.saveTemplate = () => template;
      s.seedRandom(seed);
    },
    seed,
  });
  const r = await runSheet(driver, steps, ACTIONS, {});
  if (r.failure) {
    throw new Error(
      `stopped at line ${r.failure.step.line} (${r.failure.step.source}) after ${clock(r.total.game)} in game, seed ${seed}: ${r.failure.error.message}`,
    );
  }
  return { game: r.total.game, frames: r.total.frames };
}

test("the sheets folder has sheets", () => {
  expect(files.length, `no *.sheet.txt in ${DIR}`).toBeGreaterThan(0);
});

/** a table cell can hold no pipe and no line break */
const cell = (v: string): string => v.replaceAll("|", "\\|").replaceAll(/\r?\n/g, " ");

/** play one sheet to its end: its times, or the first reason it does not get there */
async function check(file: string): Promise<{ title: string; author: string; seed: string; times: string[] }> {
  const text = readFileSync(join(DIR, file), "utf8");
  const head = readSheetHeader(text);
  if ("error" in head) throw new Error(head.error);
  const { title, author = "" } = head.header;
  const row = { title, author, seed: "", times: [] as string[] };
  try {
    let steps: Step[];
    try {
      steps = parseSheet(text, { verbs: VERBS });
    } catch (e) {
      const where = e instanceof SheetError ? "line " + e.line + ": " : "";
      throw new Error(where + (e as Error).message);
    }
    const pinned = sheetSeed(steps);
    row.seed = pinned === null ? "unseeded" : "seed " + pinned;
    for (const seed of pinned === null ? UNSEEDED : [pinned]) {
      const { game, frames } = await play(steps, seed);
      const which = pinned === null ? ", seed " + seed : "";
      row.times.push(`${clock(game)} (${frames} frames${which})`);
    }
    return row;
  } catch (e) {
    throw Object.assign(e as Error, { row });
  }
}

for (const file of files) {
  run(`${file} plays to its end`, async () => {
    try {
      const r = await check(file);
      expect(r.times.length).toBeGreaterThan(0);
      rows.push(`| ${cell(r.title)} | ${cell(r.author)} | ${r.seed} | ${r.times.join("<br>")} | \`${file}\` |`);
    } catch (e) {
      const r = (e as { row?: { title: string; author: string; seed: string } }).row;
      rows.push(`| ${cell(r?.title ?? "")} | ${cell(r?.author ?? "")} | ${r?.seed ?? ""} | ❌ ${cell((e as Error).message)} | \`${file}\` |`);
      throw new Error(`${file}: ${(e as Error).message}`);
    }
  }, 1_200_000);
}

afterAll(() => {
  if (!rows.length) return;
  const table = [
    "### Dust speedrun sheets",
    "",
    "| Title | Author | Seed | In-game time | File |",
    "|---|---|---|---|---|",
    ...rows,
    "",
  ].join("\n");
  const out = join(process.cwd(), "out", "speedrun");
  if (!existsSync(out)) mkdirSync(out, { recursive: true });
  writeFileSync(join(out, "dust-sheets.md"), table);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, table);
});
