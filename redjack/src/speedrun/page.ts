/**
 * RedJack's speedrun workbench — this page's entry point.
 *
 * Timelapse's (timelapse/src/speedrun/page.ts) with this game's name and its
 * verbs (./actions.ts): the workbench is the speedrun workspace's, and the page
 * under it is the play page, Details column and all (`play/index.html`,
 * rearranged by speedrun/vite.ts from redjack/speedrun/workbench.ts).
 */
import { startWorkbench } from "@dreamfactory/speedrun/workbench";
import { siteUrl } from "@dreamfactory/chrome/site";
import { ACTIONS } from "./actions";

startWorkbench({
  // its own key space: a RedJack checkpoint must never be offered to another
  // game's workbench on the same origin (dust/src/speedrun/page.ts)
  game: "redjack",
  actions: ACTIONS,
  /** the route (tests/speedrun/run.sheet.txt), published beside this page by speedrun/vite.ts */
  fixtureSheet: siteUrl("speedrun/run.sheet.txt"),
  /** the contributed sheets (redjack/speedrun/sheets/), resolved the same way */
  contributedSheets: siteUrl("speedrun/sheets.json"),
});
