/**
 * Day four, played: RedJack's island, from the beach to Rockfish's boat. The
 * route is `days/day4.ts`; days one to three are played first to get there.
 *
 *   npx tsx tests/machine/day4.ts        (from redjack/)
 */
import { fail, headless, ok, pass } from "./harness";
import { playDay1 } from "./days/day1";
import { playDay2 } from "./days/day2";
import { playDay3 } from "./days/day3";
import { playDay4 } from "./days/day4";

const h = await headless();
await playDay1(h);
await playDay2(h);
await playDay3(h);
ok("days one to three played");
await playDay4(h);
const errors = h.logs.filter((l) => /script error|cannot parse|not found on/i.test(l));
if (errors.length) fail(`script errors on the way:\n  ${errors.slice(0, 5).join("\n  ")}`);
ok("no script error in the four days");
pass("day4");
