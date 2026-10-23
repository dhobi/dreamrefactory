/**
 * The workbench's Calculate button, off the page (#509): the Dust disc over the
 * network, played headless in a Web Worker as `npm run speedrun -w dust` plays
 * it in node (./headless.ts is both runs' host and input), so the page beside
 * it stays responsive while a CPU core runs the sheet flat out.
 *
 * A worker has no document to read the site's root off and no IndexedDB of
 * shipped saves, so the page sends both: where the site is, and the save a
 * fresh game writes its own over (src/saves.ts dustTemplate). The files come
 * through the browser's cache, so what the page has already loaded costs no
 * second download.
 */
import { serveCalculation } from "@dreamfactory/speedrun/calc-worker";
import { DustFiles } from "../files";
import { ACTIONS } from "./actions";
import { headlessGame, headlessHost } from "./headless";

serveCalculation<{ site: string; template: Uint8Array | null }>(ACTIONS, ({ game }) => ({
  ...headlessGame(async () => headlessHost(await DustFiles.open("gamefiles/dustcd/", game.site))),
  prepare: (s) => {
    s.saveTemplate = () => game.template;
  },
}));
