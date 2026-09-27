/**
 * Day one, played: the intro to the bed (the route is `days/day1.ts`).
 *
 *   npx tsx tests/machine/day1.ts        (from lunicus/)
 *
 * DRAW=1 decodes every picture as the page does.
 */
import { headless, pass } from "./harness";
import { playDay1 } from "./days/day1";

playDay1(headless({ draws: !!process.env.DRAW }));
pass("day1");
