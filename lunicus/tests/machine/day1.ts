/**
 * Day one, played: the intro to the bed (the route is `days/day1.ts`).
 *
 *   npm test -w lunicus -- day1
 *
 * DRAW=1 decodes every picture as the page does.
 */
import { test } from "vitest";
import { headless, pass, haveRip } from "./harness";
import { playDay1 } from "./days/day1";

test.skipIf(!haveRip())("day1", async () => {
  playDay1(headless({ draws: !!process.env.DRAW }));
  pass("day1");
});
