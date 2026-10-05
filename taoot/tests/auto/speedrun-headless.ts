/**
 * A sheet played headless (#509): the same in-game time and frames every time.
 *
 *   npx vitest run taoot/tests/auto/speedrun-headless.ts
 *
 * The opening of the real sheet — cold boot, the title menu, the London flat's
 * card trick — played twice in node under the sheet clock. The browser gives
 * the same numbers for it (measured when this landed: 3.6 s in
 * game to the millisecond on every line), but a browser is not something a node
 * suite can ask; what it can ask is that the run is a function of the sheet.
 */
import { expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseSheet } from "@dreamfactory/engine/web/speedrun/sheet";
import { runSheet } from "@dreamfactory/engine/web/speedrun/runner";
import { ACTIONS, VERBS } from "../../src/speedrun/actions";
import { headlessRun } from "../speedrun/headless";

/** the sheet up to its second split, `flat scored` */
function opening(): string {
  const text = readFileSync(join(import.meta.dirname, "..", "speedrun", "run.sheet.txt"), "utf8");
  const end = text.indexOf("split(flat scored)");
  return text.slice(0, end + "split(flat scored)".length);
}

async function play(): Promise<{ game: number; frames: number; splits: string[] }> {
  const { driver } = await headlessRun({
    prepare: (s) => {
      s.nominalTime = true;
      s.sheetClock = true;
      s.seedRandom(20);
    },
    seed: 20,
  });
  const r = await runSheet(driver, parseSheet(opening(), { verbs: VERBS }), ACTIONS, {});
  if (r.failure) throw r.failure.error;
  return { game: r.total.game, frames: r.total.frames, splits: r.splits.map((s) => `${s.name} ${s.game}`) };
}

test("the sheet's opening, played headless twice, ends on the same pass", async () => {
  const a = await play();
  const b = await play();
  expect(a.splits).toHaveLength(2);
  expect(a.game).toBeGreaterThan(0);
  expect(b).toEqual(a);
}, 120_000);
