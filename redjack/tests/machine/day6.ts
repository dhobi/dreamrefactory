/**
 * Day six, played: Cartagena, from the lock to Marquez in his study. The route
 * is `days/day6.ts`; days one to five are played first to get there.
 *
 *   npx tsx tests/machine/day6.ts        (from redjack/)
 */
import { fail, headless, ok, pass } from "./harness";
import { playDay1 } from "./days/day1";
import { playDay2 } from "./days/day2";
import { playDay3 } from "./days/day3";
import { playDay4 } from "./days/day4";
import { playDay5 } from "./days/day5";
import { playDay6 } from "./days/day6";

const h = await headless();
await playDay1(h);
await playDay2(h);
await playDay3(h);
await playDay4(h);
await playDay5(h);
ok("days one to five played");
await playDay6(h);
const errors = h.logs.filter((l) => /script error|cannot parse|not found on/i.test(l));
if (errors.length) fail(`script errors on the way:\n  ${errors.slice(0, 5).join("\n  ")}`);
ok("no script error in the six days");
pass("day6");
