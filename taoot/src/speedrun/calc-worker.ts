/**
 * The workbench's Calculate button, off the page (#509): Titanic's game files
 * over the network, played headless (engine/src/web/speedrun/calculate.ts) in a
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
import { calculateSheet } from "@dreamfactory/engine/web/speedrun/calculate";
import { FileStore } from "../files";
import { ACTIONS } from "./actions";
import { deliverInput } from "./input";
import type { CalcMessage, CalcRequest } from "./calc";

const post = (m: CalcMessage): void => (self as unknown as Worker).postMessage(m);

self.onmessage = async (e: MessageEvent<CalcRequest>) => {
  const req = e.data;
  const saves = new Map(Object.entries(req.saves));
  try {
    const result = await calculateSheet(
      {
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
        getSave: async (name) => saves.get(name) ?? null,
        // kept for the rest of this calculation, never written back: Calculate
        // reports, it does not move the sheet's checkpoints
        putSave: async (name, bytes) => void saves.set(name, bytes),
        seed: req.seed,
      },
      req.text,
      ACTIONS,
      (p) => post({ kind: "progress", progress: p }),
    );
    post({ kind: "done", result });
  } catch (err) {
    post({ kind: "error", message: (err as Error).message });
  }
};
