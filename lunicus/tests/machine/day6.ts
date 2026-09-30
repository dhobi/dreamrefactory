/**
 * Day six, played: the whole game, from the intro through the base's five
 * days, three cities, the engine rooms and the hive, to the queen and the end
 * (the routes are `days/`).
 *
 *   npm test -w lunicus -- day6
 *   RECORD=out/playthrough.json npm test -w lunicus -- day6
 *   SAVES=gamefiles/save npm test -w lunicus -- day6    the page's day saves
 *
 * `RECORD` keeps the run as a browser replays it: every gesture and the tick
 * it came before, the files read, and a checkpoint at each `ok`
 * (tests/browser/playthrough.ts).
 */
import { test } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { headless, pass, haveRip } from "./harness";
import { playDay1 } from "./days/day1";
import { playCityDay } from "./days/city-day";
import { playDay5 } from "./days/day5";
import { playDay6 } from "./days/day6";

test.skipIf(!haveRip())("day6", async () => {
  const h = headless({ draws: !!process.env.DRAW });
  /** `SAVES=<dir>`: a `.LUN` at the start of each day, the page's port-made saves (gamefiles/save/) */
  const daySave = (day: number): void => {
    if (!process.env.SAVES) return;
    mkdirSync(process.env.SAVES, { recursive: true });
    writeFileSync(`${process.env.SAVES}/day${day}.lun`, h.game.saveBytes());
    console.log(`  saved day${day}.lun: level ${h.game.progress.level}`);
  };
  playDay1(h);
  daySave(2);
  for (const day of [2, 3, 4]) playCityDay(h, day), daySave(day + 1);
  playDay5(h);
  daySave(6);
  playDay6(h);
  if (process.env.RECORD) {
    const r = h.recording();
    mkdirSync(dirname(process.env.RECORD), { recursive: true });
    writeFileSync(process.env.RECORD, JSON.stringify(r));
    console.log(`  recorded ${r.gestures.length} gestures, ${r.checkpoints.length} checkpoints, ${r.files.length} files, ${r.ticks} ticks → ${process.env.RECORD}`);
  }
  pass("day6");
});
