/**
 * Day three, played: Port Royal, from the docks to the trial at sea. The route
 * is `days/day3.ts`; days one and two are played first to get there.
 *
 *   npx tsx tests/machine/day3.ts        (from redjack/)
 */
import { fail, headless, ok, pass } from "./harness";
import { playDay1 } from "./days/day1";
import { playDay2 } from "./days/day2";
import { playDay3 } from "./days/day3";

const h = await headless();
await playDay1(h);
await playDay2(h);
ok("days one and two played");
await playDay3(h);
const errors = h.logs.filter((l) => /script error|cannot parse|not found on/i.test(l));
if (errors.length) fail(`script errors on the way:\n  ${errors.slice(0, 5).join("\n  ")}`);
ok("no script error in the three days");
pass("day3");
