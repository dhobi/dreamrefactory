/**
 * The workbench's Calculate button, off the page (#509): Timelapse's discs over
 * the network, played headless in a Web Worker as `npm run speedrun -w
 * timelapse` plays them in node (./headless.ts is both runs' host and input),
 * so the page beside it stays responsive while a CPU core runs the sheet flat
 * out.
 *
 * A worker has no document to read the site's root off, so the page sends it;
 * the files come through the browser's cache, so what the page has already
 * loaded costs no second download.
 */
import { serveCalculation } from "@dreamfactory/speedrun/calc-worker";
import { TimelapseFiles } from "../files";
import { ACTIONS } from "./actions";
import { headlessGame, headlessHost } from "./headless";

serveCalculation<{ site: string }>(ACTIONS, ({ game }) =>
  headlessGame(async () => headlessHost(await TimelapseFiles.open("gamefiles/", game.site))),
);
