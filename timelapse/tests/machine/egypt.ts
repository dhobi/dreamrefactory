/**
 * Egypt, continuing from Easter Island: the water that opens the dock, the
 * crocodile, the crystals, the red gem, the snakes game, the gene pod and the
 * pyramid, to the console and on to the Maya.
 *
 *   npm test -w timelapse -- egypt
 *
 * The route is `worlds/egypt.ts`.
 */
import { test } from "vitest";
import { fail, headless, ok, pass, haveRip } from "./harness";
import { playEaster } from "./worlds/easter";
import { playEgypt } from "./worlds/egypt";

test.skipIf(!haveRip())("egypt", async () => {
  const h = await headless();
  await h.settle("the hilltop");
  await playEaster(h);
  const t0 = h.session.clock.now;
  await playEgypt(h);
  if (h.g("haspodE") !== "1") fail("left Egypt without its gene pod");
  const errors = h.logs.filter((l) => /script error|cannot parse/i.test(l));
  if (errors.length) fail(`${errors.length} script error(s), first: ${errors[0]}`);
  ok(`no script error; ${Math.round((h.session.clock.now - t0) / 60_000)} game minutes in Egypt`);
  pass("egypt");
});
