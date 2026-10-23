/**
 * RedJack's speedrun workbench — this page's entry point.
 *
 * Timelapse's (timelapse/src/speedrun/page.ts) with this game's name, its
 * verbs (./actions.ts) and its files: the workbench is the speedrun
 * workspace's, and the page under it is the play page, Details column and all
 * (`play/index.html`, rearranged by speedrun/vite.ts from
 * redjack/speedrun/workbench.ts).
 */
import { startWorkbench } from "@dreamfactory/speedrun/workbench";
import { calculateInWorker } from "@dreamfactory/speedrun/calc-worker";
import { siteBase } from "@dreamfactory/engine/web/page-url";
import { siteUrl } from "@dreamfactory/chrome/site";
import { RedJackFiles } from "../files";
import { ACTIONS } from "./actions";

startWorkbench({
  // its own key space: a RedJack checkpoint must never be offered to another
  // game's workbench on the same origin (dust/src/speedrun/page.ts)
  game: "redjack",
  actions: ACTIONS,
  // every file the game can ask for, on all three discs
  warmup: async () => (await RedJackFiles.open()).warmFiles(),
  warmWhat: "every file of the three discs",
  /** the route (tests/speedrun/run.sheet.txt), published beside this page by speedrun/vite.ts */
  fixtureSheet: siteUrl("speedrun/run.sheet.txt"),
  /** the contributed sheets (redjack/speedrun/sheets/), resolved the same way */
  contributedSheets: siteUrl("speedrun/sheets.json"),
  // headless in a worker (./calc-worker.ts), told where the site is
  calculate: (sheet, onProgress, signal) =>
    calculateInWorker(
      new Worker(new URL("./calc-worker.ts", import.meta.url), { type: "module" }),
      { ...sheet, seed: null, game: { site: siteBase() } },
      onProgress,
      signal,
    ),
});
