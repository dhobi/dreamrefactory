/**
 * `blackjack(800)` plays Jan's table until the cash in hand is at least that
 * much (dust/src/speedrun/blackjack.ts, #490).
 *
 *   npm run test:machine -w dust -- tests/speedrun/blackjack.ts
 *   SEEDS=4,5,6 npm run test:machine -w dust -- tests/speedrun/blackjack.ts
 *
 * From the disc's own save D1E_002: the saloon's ground floor, facing the
 * table, with $400. The seeds are picked so every way the verb can go is
 * played: 21 goes broke and is sent away by Jan, draws at the table, wins, and
 * loses part of a bet, each loss loaded back through the horn's panel; 22 is
 * paid 3:2 for a blackjack.
 */
import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { parseSheet } from "@dreamfactory/engine/web/speedrun/sheet";
import { runSheet } from "@dreamfactory/engine/web/speedrun/runner";
import { ACTIONS, VERBS } from "../../src/speedrun/actions";
import { haveRip, SAVES } from "../playthrough/harness";
import { headlessRun } from "./headless";

const START = "D1E_002";

const PLACE = `JSON.stringify({
  cash: window.dbg.session.interp.globals.get("playercash"),
  set: window.dbg.session.interp.globals.get("theset"),
  stage: window.dbg.session.stageName,
})`;

async function play(line: string, seed: number): Promise<{ cash: number; set: string; stage: string; said: string }> {
  const { driver } = await headlessRun({
    prepare: (s) => {
      s.nominalTime = true;
      s.sheetClock = true;
    },
    seed,
  });
  await driver.putSave!(START, new Uint8Array(readFileSync(`${SAVES}/${START}.RTD`)));
  const sheet = ["skipMovie(until: js == !!window.dbg.viewer, budget: 180000)", `load(${START})`, line].join("\n");
  const r = await runSheet(driver, parseSheet(sheet, { verbs: VERBS }), ACTIONS, {});
  if (r.failure) throw new Error(`line ${r.failure.step.line} (${r.failure.step.source}), seed ${seed}: ${r.failure.error.message}`);
  const last = r.timings.at(-1);
  const at = JSON.parse(await driver.evaluate<string>(PLACE)) as { cash: number; set: string; stage: string };
  return { ...at, said: `${last?.says.join("; ") ?? ""} (${((last?.game ?? 0) / 1000).toFixed(1)} s in game)` };
}

const run = haveRip() ? test : test.skip;
const SEEDS = process.env.SEEDS
  ? process.env.SEEDS.split(",").map((s) => [Number(s), 1000] as const)
  : ([[21, 1000], [22, 1000]] as const);

for (const [seed, target] of SEEDS) {
  run(`$400 to $${target} (seed ${seed})`, async () => {
    const { cash, set, stage, said } = await play(`blackjack(${target})`, seed);
    process.stderr.write(`\nseed ${seed}: ${said}\n`);
    expect(cash).toBeGreaterThanOrEqual(target);
    // up from the table, in the saloon, where the sheet's next line starts
    expect(set).toBe("sallower");
    expect(stage).not.toMatch(/salgames/i);
  }, 600_000);
}

run("a target already in hand plays nothing", async () => {
  const { cash, said } = await play("blackjack(300)", 1);
  expect(cash).toBe(400);
  expect(said).toMatch(/already \$400/);
}, 600_000);
