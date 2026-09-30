/**
 * Atlantis, continuing from the Anasazi — and so the whole game, from the boot
 * to the end: the four buildings and the elevator's panel, the red crystal,
 * the stasis tube, the six wheels, the robot trapped, the gene pods on the
 * transmission panel, and the escape.
 *
 *   npm test -w timelapse -- atlantis
 *
 * The route is `worlds/atlantis.ts`.
 */
import { test } from "vitest";
import { fail, headless, ok, pass, haveRip } from "./harness";
import { playEaster } from "./worlds/easter";
import { playEgypt } from "./worlds/egypt";
import { playMaya } from "./worlds/maya";
import { playAnasazi } from "./worlds/anasazi";
import { playAtlantis } from "./worlds/atlantis";

test.skipIf(!haveRip())("atlantis", async () => {
  const h = await headless();
  await h.settle("the hilltop");
  await playEaster(h);
  await playEgypt(h);
  await playMaya(h);
  await playAnasazi(h);
  const t0 = h.session.clock.now;
  await playAtlantis(h);
  const errors = h.logs.filter((l) => /script error|cannot parse|parse error/i.test(l));
  if (errors.length) fail(`${errors.length} script error(s), first: ${errors[0]}`);
  ok(`no script error; ${Math.round((h.session.clock.now - t0) / 60_000)} game minutes in Atlantis, ${Math.round(h.session.clock.now / 60_000)} in all`);
  pass("atlantis");
});
