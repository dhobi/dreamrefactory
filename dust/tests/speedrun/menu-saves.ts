/**
 * `menuSave(name)` and `menuLoad(name)` save and load through the panel behind
 * the horn, on the clock, and `load()` makes a run's time not a valid one (#523).
 *
 *   npm run test:machine -w dust -- tests/speedrun/menu-saves.ts
 *
 * From the disc's save D1E_002 ($400, in the saloon): the save is made, the
 * cash is changed behind the game's back, and the load has to put it back.
 */
import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { parseSheet } from "@dreamfactory/engine/web/speedrun/sheet";
import { runSheet } from "@dreamfactory/engine/web/speedrun/runner";
import { ACTIONS, VERBS } from "../../src/speedrun/actions";
import { haveRip, SAVES } from "../playthrough/harness";
import { headlessRun } from "./headless";

const START = "D1E_002";
const CASH = `Number(window.dbg.session.interp.globals.get("playercash"))`;
const FLAT = `String(window.dbg.session.currentFlat)`;

const run = haveRip() ? test : test.skip;

run("menuSave and menuLoad go through the horn's panel, and only load() voids the time", async () => {
  const { driver } = await headlessRun({
    prepare: (s) => {
      s.nominalTime = true;
      s.sheetClock = true;
    },
    seed: 1,
  });
  await driver.putSave!(START, new Uint8Array(readFileSync(`${SAVES}/${START}.RTD`)));
  const sheet = (lines: string[]) => runSheet(driver, parseSheet(lines.join("\n"), { verbs: VERBS }), ACTIONS, {});

  const first = await sheet(["skipMovie(until: js == !!window.dbg.viewer, budget: 180000)", `load(${START})`, "menuSave(a)"]);
  expect(first.failure).toBeNull();
  expect(first.invalid).toEqual([`load(${START}) on line 2`]);
  const saved = first.timings.at(-1)!;
  process.stderr.write(`\nmenuSave: ${saved.game} ms in game\n`);
  // the panel's way in and out is time a player spends: a wipe each way and a button
  expect(saved.game).toBeGreaterThan(300);
  expect(await driver.evaluate<string>(FLAT)).toBe("mainpanel");

  await driver.evaluate(`void window.dbg.session.interp.globals.set("playercash", 7)`);
  const second = await sheet(["menuLoad(a)"]);
  expect(second.failure).toBeNull();
  expect(second.invalid).toEqual([]);
  process.stderr.write(`menuLoad: ${second.timings[0].game} ms in game\n`);
  expect(second.timings[0].game).toBeGreaterThan(300);
  expect(await driver.evaluate<number>(CASH)).toBe(400);
  expect(await driver.evaluate<string>(FLAT)).toBe("mainpanel");

  // a point save() wrote for free is not menuLoad's to load
  const third = await sheet(["save(b)", "menuLoad(b)"]);
  expect(third.failure?.error.message).toMatch(/menuLoad\(b\) loads what menuSave\(b\) wrote/);
}, 600_000);
