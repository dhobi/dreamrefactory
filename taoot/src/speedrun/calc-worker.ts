/**
 * The workbench's Calculate button, off the page (#509): Titanic's game files
 * over the network, played headless (speedrun/src/calculate.ts) in a
 * Web Worker, so the page beside it stays responsive while a CPU core runs the
 * sheet flat out.
 *
 * Everything the play page would know comes in with the request — which files
 * the site has, the edition, the sheet's checkpoints, a save to write over —
 * because a worker has no `document` to read it off and no `localStorage`.
 * The files themselves come through the browser's cache, so what the page has
 * already loaded costs no second download.
 */
import { GameHost } from "@dreamfactory/engine/web/host";
import { NullAudioSink } from "@dreamfactory/engine/runtime/audio";
import { serveCalculation } from "@dreamfactory/speedrun/calc-worker";
import { FileStore } from "../files";
import { ACTIONS } from "./actions";
import { deliverInput } from "./input";
import type { TitanicCalc } from "./calc";

serveCalculation<TitanicCalc>(ACTIONS, ({ game: req }) => ({
  game: "taoot",
  makeHost: async () => {
    const files = new FileStore();
    for (const [name, url] of req.files) files.registerServerFile(name, url);
    files.setEdition(req.edition);
    const host = new GameHost(files, new NullAudioSink());
    files.setVolumes((await host.bootPlan()).volumes);
    return host;
  },
  prepare: (s) => {
    // what main.ts sets: a fresh game borrows a shipped save to write its own over
    s.saveTemplate = () => {
      const mission = s.interp.globals.get("mission");
      return typeof mission === "number" && mission >= 4
        ? (req.templates[1] ?? req.templates[0])
        : (req.templates[0] ?? req.templates[1]);
    };
  },
  deliver: deliverInput,
}));
