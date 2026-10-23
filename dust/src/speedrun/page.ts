/**
 * Dust's speedrun workbench — this page's entry point.
 *
 * The workbench is the speedrun workspace's (`speedrun/src/workbench.ts`); what
 * this game tells it is its name, its verbs (./actions.ts), its route, and the
 * two things it has to know about its files: which ones the Warm button pulls
 * through the cache, and what a Calculate worker (./calc-worker.ts) needs to
 * boot off them.
 *
 * The route is the repository's — `tests/speedrun/run.sheet.txt`, published
 * beside this page by the shared speedrun plugin (speedrun/vite.ts), so the
 * panel offers "copy the full run": cold boot to the credits in one sequence,
 * planned from the story's gates (docs/dust/README.md, "The speedrun").
 */
import { startWorkbench } from "@dreamfactory/speedrun/workbench";
import { calculateInWorker } from "@dreamfactory/speedrun/calc-worker";
import { siteUrl } from "@dreamfactory/chrome/site";
import { DustFiles } from "../files";
import { dustTemplate, loadDustTemplate } from "../saves";
import { ACTIONS } from "./actions";

startWorkbench({
  // Its own key space, and this is the whole reason the namespace exists: the
  // deployed site serves every game from one origin, so `dust:speedrun:save:…`
  // is what keeps a Dust checkpoint out of Titanic's workbench — where the
  // engine would happily load it and then find itself in a room this disc
  // does not have.
  game: "dust",
  actions: ACTIONS,
  // every file the game can ask for — the disc's, not its installer's or its readers'
  warmup: async () => (await DustFiles.open()).warmFiles(),
  warmWhat: "every file of the disc",
  /**
   * The repository's own route, published beside this page by the speedrun
   * plugin (speedrun/vite.ts) — middleware in dev, an emitted asset in a build, at
   * the same path either way.
   *
   * Resolved HERE, through `siteUrl`, and handed over whole: where a page sits in
   * the deployed tree is `site/`'s question and the engine may not ask it
   * (site/tests/layering.ts). Written "/speedrun/…" it would ask the host's root
   * rather than this game's, so it would work in dev and fetch nothing once
   * deployed under a subdirectory.
   */
  fixtureSheet: siteUrl("speedrun/run.sheet.txt"),
  /** the contributed sheets (dust/speedrun/sheets/), resolved the same way */
  contributedSheets: siteUrl("speedrun/sheets.json"),
  // headless in a worker (./calc-worker.ts), told where the site is and handed
  // the save main.ts lends a fresh game — loaded here if a press beat main.ts to it
  calculate: async (sheet, onProgress, signal) => {
    if (!dustTemplate()) await loadDustTemplate();
    return calculateInWorker(
      new Worker(new URL("./calc-worker.ts", import.meta.url), { type: "module" }),
      { ...sheet, seed: null, game: { site: siteUrl(""), template: dustTemplate() } },
      onProgress,
      signal,
    );
  },
});
