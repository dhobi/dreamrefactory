/**
 * Day two, played: aboard the Marauder, from the crate to Port Royal. The
 * route is `days/day2.ts`; day one is played first to get there, the way a
 * player would.
 *
 *   npx tsx tests/machine/day2.ts        (from redjack/)
 */
import { fail, headless, ok, pass } from "./harness";
import { playDay1 } from "./days/day1";
import { playDay2 } from "./days/day2";

const h = await headless();
await playDay1(h);
ok("day one played");
await playDay2(h);
const errors = h.logs.filter((l) => /script error|cannot parse|not found on/i.test(l));
if (errors.length) fail(`script errors on the way:\n  ${errors.slice(0, 5).join("\n  ")}`);
ok("no script error in the two days");
pass("day2");
