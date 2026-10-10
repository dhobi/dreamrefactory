/**
 * Day three, played: Port Royal, from the docks to the trial at sea. The route
 * is `days/day3.ts`; days one and two are played first to get there.
 *
 *   npm test -w redjack -- day3
 */
import { test } from "vitest";
import { fail, headless, ok, pass, haveRip } from "./harness";
import { playDay1 } from "./days/day1";
import { playDay2 } from "./days/day2";
import { playDay3 } from "./days/day3";

test.skipIf(!haveRip())("day3", async () => {
  const h = await headless();
  await playDay1(h);
  await playDay2(h);
  ok("days one and two played");
  // Port Royal's walkonpath walks follow the room's DRIV routes (RedJack.exe
  // 0x41c820), which bend, rather than straight lines
  const routed: string[] = [];
  const startWalkPath = h.session.scheduler.startWalkPath.bind(h.session.scheduler);
  h.session.scheduler.startWalkPath = (name, points, arrive) => {
    if (points.length > 2) routed.push(`${name} -> ${arrive} (${points.length} points)`);
    startWalkPath(name, points, arrive);
  };
  await playDay3(h);
  if (!routed.length) fail("no walk in Port Royal followed a bending route");
  ok(`walks on the rooms' routes: ${[...new Set(routed)].slice(0, 4).join(", ")}`);
  const errors = h.logs.filter((l) => /script error|cannot parse|not found on/i.test(l));
  if (errors.length) fail(`script errors on the way:\n  ${errors.slice(0, 5).join("\n  ")}`);
  ok("no script error in the three days");
  pass("day3");
});
