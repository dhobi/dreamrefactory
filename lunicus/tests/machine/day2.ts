/**
 * Day two, played: days one and two from the intro, through the city of Los
 * Angeles, to the bed that ends day two (the routes are `days/`).
 *
 *   npm test -w lunicus -- day2
 */
import { test } from "vitest";
import { headless, pass, haveRip } from "./harness";
import { playDay1 } from "./days/day1";
import { playCityDay } from "./days/city-day";

test.skipIf(!haveRip())("day2", async () => {
  const h = headless({ draws: !!process.env.DRAW });
  playDay1(h);
  playCityDay(h, 2);
  pass("day2");
});
