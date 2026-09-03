/**
 * Titanic's speedrun workbench — this page's entry point, and what it tells the
 * panel about this game.
 *
 * The workbench itself is the engine's (`engine/src/web/speedrun/workbench.ts`):
 * the sheet, the pointer, the clock, the splits, the checkpoints and the whole
 * argument for how they behave. It named this game only in five places, and the
 * five are below — everything else about a run is the same on any DreamFactory
 * disc, which is why the panel moved and this file is what was left.
 *
 * `speedrun/index.html` loads it by name, and it must be the module that runs
 * LAST of the two the page loads: `main.ts` boots the game, this opens the
 * workbench over it.
 */
import { startWorkbench } from "@dreamfactory/engine/web/speedrun/workbench";
import { warmupList, type WarmFile } from "@dreamfactory/engine/web/cache-warmup";
import { siteUrl } from "@dreamfactory/site/site";
import { ACTIONS } from "./speedrun/actions";
import { gamefileSizes } from "./editions";
import { editionOfUrl, NEUTRAL } from "./files";

/**
 * Which edition the Warm button pulls through the cache.
 *
 * ENGLISH, ALWAYS — the same `<meta name="edition">` the page pins the game to
 * (taoot/src/main.ts `pinnedEdition`), read here rather than shared because the
 * two want different things from it and neither should have to know the other
 * asked. A route is a sequence of clicks in one tree's data; warming a second
 * tree would be a gigabyte fetched for a game this page will not boot.
 */
const warmEdition = (): string =>
  document.querySelector('meta[name="edition"]')?.getAttribute("content")?.toLowerCase() ?? "en";

/**
 * The edition's own files plus the edition-NEUTRAL ones, which is not a detail:
 * `lang.stg` and `nightdive.mov` sit outside every tree and the boot reads both
 * (taoot/src/files.ts `NEUTRAL`).
 *
 * Biggest first, and `warmupList` is what does that — see the reason there; it
 * is about how a fetch pool empties, not about this game.
 */
async function warmup(): Promise<WarmFile[]> {
  const edition = warmEdition();
  const sizes = await gamefileSizes();
  return warmupList(
    sizes,
    (path) => {
      const e = editionOfUrl(path);
      return e === edition || e === NEUTRAL;
    },
    siteUrl,
  );
}

startWorkbench({
  // the namespace of every key this page keeps, and the one already in a
  // reader's browser: `taoot:speedrun:…`
  game: "taoot",
  actions: ACTIONS,
  warmup,
  warmWhat: `every file of the ${warmEdition().toUpperCase()} edition`,
  /**
   * The repository's own sheet, published beside this page by the `run-sheet`
   * plugin (vite.config.ts) — middleware in dev, an emitted asset in a build, at
   * the same path either way.
   *
   * Resolved HERE, through `siteUrl`, and handed over whole: where a page sits in
   * the deployed tree is `site/`'s question and the engine may not ask it
   * (site/tests/layering.ts). Which is also the bug this line used to have —
   * written "/speedrun/…" it asked the host's root rather than this game's, so it
   * worked in dev and fetched nothing once deployed under a subdirectory.
   */
  fixtureSheet: siteUrl("speedrun/run.sheet.txt"),
});
