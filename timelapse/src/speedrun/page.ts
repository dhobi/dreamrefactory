/**
 * Timelapse's speedrun workbench — this page's entry point.
 *
 * Dust's (dust/src/speedrun/page.ts) with this game's name and its verbs
 * (./actions.ts): the workbench is the speedrun workspace's, and the page under
 * it is the play page, Details column and all (`play/index.html`, rearranged by
 * speedrun/vite.ts from timelapse/speedrun/workbench.ts).
 *
 * No `warmup` and no Calculate, for the reasons Dust gives none: the boot's own
 * prefetch already takes the 70 MB a run starts with in front of the first
 * frame, and a headless worker is wanted once there is a route long enough to
 * want one.
 */
import { startWorkbench } from "@dreamfactory/speedrun/workbench";
import { siteUrl } from "@dreamfactory/chrome/site";
import { ACTIONS } from "./actions";

startWorkbench({
  // its own key space: a Timelapse checkpoint must never be offered to another
  // game's workbench on the same origin (dust/src/speedrun/page.ts)
  game: "timelapse",
  actions: ACTIONS,
  /** the route (tests/speedrun/run.sheet.txt), published beside this page by speedrun/vite.ts */
  fixtureSheet: siteUrl("speedrun/run.sheet.txt"),
  /** the contributed sheets (timelapse/speedrun/sheets/), resolved the same way */
  contributedSheets: siteUrl("speedrun/sheets.json"),
});
