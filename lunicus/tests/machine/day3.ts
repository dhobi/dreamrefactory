/**
 * Day three, played: days one to three from the intro, through two cities,
 * to the bed that ends day three (the routes are `days/`).
 *
 *   npx tsx tests/machine/day3.ts        (from lunicus/)
 */
import { headless, pass } from "./harness";
import { playDay1 } from "./days/day1";
import { playCityDay } from "./days/city-day";

const h = headless({ draws: !!process.env.DRAW });
playDay1(h);
playCityDay(h, 2);
playCityDay(h, 3);
pass("day3");
