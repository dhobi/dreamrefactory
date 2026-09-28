/**
 * The Anasazi, continuing from the Maya: the log over the chasm, the calendar
 * lever and the four ways it sends you — the fire, the arrow through the
 * spire, the hand glyphs, the feathers — the tablets and the gene pod, the
 * corn, and the cliff city's snake, loom, drums, rag and kiva, to the console
 * and on to Atlantis.
 *
 *   npx tsx tests/machine/anasazi.ts        (from timelapse/)
 *
 * The route is `worlds/anasazi.ts`.
 */
import { fail, headless, ok, pass } from "./harness";
import { playEaster } from "./worlds/easter";
import { playEgypt } from "./worlds/egypt";
import { playMaya } from "./worlds/maya";
import { playAnasazi } from "./worlds/anasazi";

const h = await headless();
await h.settle("the hilltop");
await playEaster(h);
await playEgypt(h);
await playMaya(h);
const t0 = h.session.clock.now;
await playAnasazi(h);
if (h.g("haspodA") !== "1") fail("left the Anasazi without its gene pod");
const errors = h.logs.filter((l) => /script error|cannot parse/i.test(l));
if (errors.length) fail(`${errors.length} script error(s), first: ${errors[0]}`);
ok(`no script error; ${Math.round((h.session.clock.now - t0) / 60_000)} game minutes with the Anasazi`);
pass("anasazi");
