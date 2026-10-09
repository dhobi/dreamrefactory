/**
 * `menuSave(name)` and `menuLoad(name)` save and load through the control
 * panel, on the clock, and `load()` makes a run's time not a valid one (#523).
 *
 *   npm run test:machine -w taoot -- tests/speedrun/menu-saves.ts
 *
 * From the shipped save "In the Smoking Room" (en/save/ENDGAME1): the save is
 * made, the boat pass is handed to Frank behind the game's back, and the load
 * has to take it away again.
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
const PASS = `String((window.dbg.session.propRuntime.props.get("boatpass") || {}).owner ?? "")`;
const STAGE = `String(window.dbg.session.stageName)`;

test("menuSave and menuLoad go through the control panel, and only load() voids the time", async () => {
  const { driver } = await headlessRun({
    prepare: (s) => {
      s.nominalTime = true;
      s.sheetClock = true;
    },
    seed: 1,
  });
  await driver.putSave!("start", new Uint8Array(readFileSync(SAVE)));
  const run = (lines: string[]) => runSheet(driver, parseSheet(lines.join("\n"), { verbs: VERBS }), ACTIONS, {});

  const first = await run(["intro()", "skipMovie(until: awaiting)", "clickAt(266, 254)", "skipMovie(until: quiet)", "load(start)", "menuSave(a)"]);
  expect(first.failure).toBeNull();
  expect(first.invalid).toEqual(["load(start) on line 5"]);
  const saved = first.timings.at(-1)!;
  process.stderr.write(`\nmenuSave: ${saved.game} ms in game, ${saved.frames} frames\n`);
  // the panel's way in and out is time a player spends: a fade each way and a lever
  expect(saved.game).toBeGreaterThan(500);
  expect(await driver.evaluate<string>(STAGE)).toBe("main.stg");
  expect(await driver.evaluate<string>(PASS)).toBe("buick");

  await driver.evaluate(`void (window.dbg.session.propRuntime.props.get("boatpass").owner = "frank")`);
  const second = await run(["menuLoad(a)"]);
  process.stderr.write(`menuLoad: ${second.timings[0].game} ms in game, ${second.timings[0].frames} frames\n`);
  expect(second.failure).toBeNull();
  expect(second.invalid).toEqual([]);
  expect(second.timings[0].game).toBeGreaterThan(500);
  expect(await driver.evaluate<string>(STAGE)).toBe("main.stg");
  expect(await driver.evaluate<string>(PASS)).toBe("buick");

  // a point save() wrote for free is not menuLoad's to load
  const third = await run(["save(b)", "menuLoad(b)"]);
  expect(third.failure?.error.message).toMatch(/menuLoad\(b\) loads what menuSave\(b\) wrote/);
}, 600_000);
