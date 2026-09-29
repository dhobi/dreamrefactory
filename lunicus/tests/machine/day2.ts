/**
 * Day two, played: days one and two from the intro, through the city of Los
 * Angeles, to the bed that ends day two (the routes are `days/`).
 *
 *   npx tsx tests/machine/day2.ts        (from lunicus/)
 */
import { headless, pass } from "./harness";
import { playDay1 } from "./days/day1";
import { playCityDay } from "./days/city-day";

const h = headless({ draws: !!process.env.DRAW });
playDay1(h);
playCityDay(h, 2);
pass("day2");
