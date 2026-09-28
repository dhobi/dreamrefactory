/**
 * Easter Island, cold from the discs: the boot, `open.mov`, and the island
 * played through to the time gate and on into Egypt.
 *
 *   npx tsx tests/machine/easter.ts        (from timelapse/)
 *
 * The route is `worlds/easter.ts`; every step checks the game's own global for
 * what it did (gCameraTaken, gLanternLit, gHeadsplaced, gPortalOpen …).
 */
import { STEP, fail, headless, ok, pass } from "./harness";
import * as easter from "./worlds/easter";

const h = await headless();
const films = h.logs.flatMap((l) => (/^movie: (\S+) \(1\/\d+ segments\)/.exec(l) ?? /^movie: (\S+) \(/.exec(l) ?? []).slice(1, 2));
if (films[0]?.toLowerCase() !== "open.mov") fail(`the boot plays ${films.join(", ") || "no film"}; enterworld ("I") plays open.mov`);
await h.settle("the hilltop");
const w = h.where();
if (w.world !== "I" || w.stage !== 1 || w.frame !== 100) fail(`the game opens at ${h.here()}; enterworld ("I") says stage 1, frame 100`);
ok(`open.mov, then the hilltop: ${h.here()}`);

const t0 = h.session.clock.now;
await easter.camp(h);
await easter.lantern(h);
await easter.masks(h);
await easter.gate(h);
await easter.travel(h, "Button10", "E");
const errors = h.logs.filter((l) => /script error|cannot parse/i.test(l));
if (errors.length) fail(`${errors.length} script error(s) on the island, first: ${errors[0]}`);
ok(`no script error; ${Math.round((h.session.clock.now - t0) / 60_000)} game minutes on the island (${STEP.toFixed(1)} ms a pass)`);
pass("easter");
