/**
 * Day five, played: days one to five from the intro, through three cities and
 * the engine rooms, to the hive's door (the routes are `days/`).
 *
 *   npm test -w lunicus -- day5
 */
import { test } from "vitest";
import { headless, pass, haveRip } from "./harness";
import { playDay1 } from "./days/day1";
import { playCityDay } from "./days/city-day";
import { playDay5 } from "./days/day5";

test.skipIf(!haveRip())("day5", async () => {
  const h = headless({ draws: !!process.env.DRAW });
  playDay1(h);
  for (const day of [2, 3, 4]) playCityDay(h, day);
  playDay5(h);
  pass("day5");
});
