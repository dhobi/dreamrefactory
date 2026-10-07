/**
 * `blackjack(win|lose, bet:)` gets Mission 4's game to the end it was asked for
 * (taoot/src/speedrun/blackjack.ts, #487).
 *
 *   npm run test:machine -w taoot -- tests/speedrun/blackjack.ts
 *   SEEDS=4,5,6 npm run test:machine -w taoot -- tests/speedrun/blackjack.ts
 *
 * From the shipped save "In the Smoking Room" (en/save/ENDGAME1): Mission 4,
 * Buick at his table with the boat pass, and Frank carrying both things Buick
 * will play for. The seeds are picked so every way the verb can go is played:
 * 5 wins and loses on the first hand, 3 loses a hand and loads to win, 22 wins
 * by accident and loads to lose, and 28 draws and plays again at the table.
 * Each load goes through the control panel, as a player's would.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import { parseSheet } from "@dreamfactory/engine/web/speedrun/sheet";
import { runSheet } from "@dreamfactory/engine/web/speedrun/runner";
import { ACTIONS, VERBS } from "../../src/speedrun/actions";
import { gamefilesRoot } from "../../tools/gamefiles";
import { headlessRun } from "./headless";

const SAVE = join(gamefilesRoot(), "en", "save", "ENDGAME1", "03 - In the Smoking Room.ti");
const START = "blackjack start";

const OWNERS = `JSON.stringify(Object.fromEntries(["boatpass", "rubaiyat", "realneck"].map((p) =>
  [p, (window.dbg.session.propRuntime.props.get(p) || {}).owner])))`;

async function play(line: string, seed: number): Promise<{ owners: Record<string, string>; said: string }> {
  const { driver } = await headlessRun({
    prepare: (s) => {
      s.nominalTime = true;
      s.sheetClock = true;
      s.seedRandom(seed);
    },
    seed,
  });
  await driver.putSave!(START, new Uint8Array(readFileSync(SAVE)));
  const sheet = [
    "intro()",
    "skipMovie(until: awaiting)",
    "clickAt(266, 254)",
    "skipMovie(until: quiet)",
    `load(${START})`,
    "stand(view44)",
    line,
  ].join("\n");
  const r = await runSheet(driver, parseSheet(sheet, { verbs: VERBS }), ACTIONS, {});
  if (r.failure) throw new Error(`line ${r.failure.step.line} (${r.failure.step.source}), seed ${seed}: ${r.failure.error.message}`);
  const owners = JSON.parse(await driver.evaluate<string>(OWNERS)) as Record<string, string>;
  const last = r.timings.at(-1);
  return { owners, said: `${last?.says.join("; ") ?? ""} (${((last?.game ?? 0) / 1000).toFixed(1)} s in game)` };
}

const SEEDS = process.env.SEEDS ? process.env.SEEDS.split(",").map(Number) : [5, 3, 22, 28];

for (const seed of SEEDS) {
  test(`win, betting the Rubaiyat (seed ${seed})`, async () => {
    const { owners, said } = await play("blackjack(win, bet: rubaiyat)", seed);
    process.stderr.write(`\nwin, seed ${seed}: ${said}\n`);
    expect(owners).toMatchObject({ boatpass: "frank", rubaiyat: "frank", realneck: "frank" });
  }, 600_000);

  test(`lose, betting the real necklace (seed ${seed})`, async () => {
    const { owners, said } = await play("blackjack(lose, bet: realneck)", seed);
    process.stderr.write(`\nlose, seed ${seed}: ${said}\n`);
    expect(owners).toMatchObject({ boatpass: "buick", rubaiyat: "frank", realneck: "buick" });
  }, 600_000);
}
