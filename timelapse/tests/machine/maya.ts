/**
 * The Maya, continuing from Egypt: the chameleon, the Castillo's counting
 * stones and calendar, the four temples and their gems, the gene pod on the
 * podium, and the Sun temple's stones, to the console and on to the Anasazi.
 *
 *   npm test -w timelapse -- maya
 *
 * The route is `worlds/maya.ts`.
 */
import { test } from "vitest";
import { fail, headless, ok, pass, haveRip } from "./harness";
import { playEaster } from "./worlds/easter";
import { playEgypt } from "./worlds/egypt";
import { playMaya } from "./worlds/maya";

test.skipIf(!haveRip())("maya", async () => {
  const h = await headless();
  await h.settle("the hilltop");
  await playEaster(h);
  await playEgypt(h);
  const t0 = h.session.clock.now;
  await playMaya(h);
  if (h.g("haspodM") !== "1") fail("left the Maya without its gene pod");
  const errors = h.logs.filter((l) => /script error|cannot parse/i.test(l));
  if (errors.length) fail(`${errors.length} script error(s), first: ${errors[0]}`);
  ok(`no script error; ${Math.round((h.session.clock.now - t0) / 60_000)} game minutes with the Maya`);
  pass("maya");
});
