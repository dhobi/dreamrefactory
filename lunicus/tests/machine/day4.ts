/**
 * Day four, played: days one to four from the intro, through three cities,
 * to the bed that ends day four (the routes are `days/`).
 *
 *   npm test -w lunicus -- day4
 */
import { test } from "vitest";
import { headless, pass, haveRip } from "./harness";
import { playDay1 } from "./days/day1";
import { playCityDay } from "./days/city-day";

test.skipIf(!haveRip())("day4", async () => {
  const h = headless({ draws: !!process.env.DRAW });
  playDay1(h);
  playCityDay(h, 2);
  playCityDay(h, 3);
  playCityDay(h, 4);
  pass("day4");
});
