/**
 * Day four, played: days one to four from the intro, through three cities,
 * to the bed that ends day four (the routes are `days/`).
 *
 *   npx tsx tests/machine/day4.ts        (from lunicus/)
 */
import { headless, pass } from "./harness";
import { playDay1 } from "./days/day1";
import { playCityDay } from "./days/city-day";

const h = headless({ draws: !!process.env.DRAW });
playDay1(h);
playCityDay(h, 2);
playCityDay(h, 3);
playCityDay(h, 4);
pass("day4");
