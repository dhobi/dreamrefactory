/**
 * Both halves of the workbench's Calculate button (#509), for any game: the
 * page's, which starts the game's worker, hands it the sheet, relays its
 * progress and gives back its answer; and the worker's, which plays the sheet
 * headless (calculate.ts) and posts both back.
 *
 * What is the game's is what it takes to boot it off the network with no
 * `document` to read anything from — which files the site has, where it is, a
 * save to write over. That travels as the request's `game`, and the game's own
 * worker module turns it into a {@link HeadlessGame}; everything else a
 * calculation needs is here. The worker MODULE has to be the game's for a
 * second reason: `new Worker(new URL("./calc-worker.ts", import.meta.url))`
 * is what Vite bundles, and it bundles the file the literal names.
 */
import type { ActionTable } from "./action";
import { calculateSheet, type CalcProgress, type CalcResult } from "./calculate";
import type { HeadlessGame } from "./headless";

export interface CalcRequest<G> {
  text: string;
  /** the sheet's checkpoints, for its `load()` lines */
  saves: Record<string, Uint8Array>;
  seed: number | null;
  /** what the game's worker needs to boot it, gathered by the game's page */
  game: G;
}

export type CalcMessage =
  | { kind: "progress"; progress: CalcProgress }
  | { kind: "done"; result: CalcResult }
  | { kind: "error"; message: string };

/** run `worker` to an answer; aborting `signal` ends it at once */
export function calculateInWorker<G>(
  worker: Worker,
  req: CalcRequest<G>,
  onProgress: (p: CalcProgress) => void,
  signal: AbortSignal,
): Promise<CalcResult> {
  return new Promise<CalcResult>((resolve, reject) => {
    const end = (): void => worker.terminate();
    signal.addEventListener(
      "abort",
      () => {
        end();
        reject(new Error("stopped"));
      },
      { once: true },
    );
    worker.onmessage = (e: MessageEvent<CalcMessage>) => {
      const m = e.data;
      if (m.kind === "progress") return onProgress(m.progress);
      end();
      if (m.kind === "done") resolve(m.result);
      else reject(new Error(m.message));
    };
    worker.onerror = (e) => {
      end();
      reject(new Error(e.message || "the calculation's worker failed to start"));
    };
    worker.postMessage(req);
  });
}

/** the game's part of a {@link HeadlessGame}: everything but the saves and the seed, which are the request's */
export type CalcGame = Omit<HeadlessGame, "getSave" | "putSave" | "seed" | "prepare"> & {
  prepare?: HeadlessGame["prepare"];
};

/**
 * The worker's half: answer each request by playing its sheet with `actions`
 * on the game `game` builds from it.
 *
 * The sheet's checkpoints are kept for the rest of the calculation and never
 * written back: Calculate reports, it does not move the sheet's checkpoints.
 */
export function serveCalculation<G>(actions: ActionTable, game: (req: CalcRequest<G>) => CalcGame): void {
  const post = (m: CalcMessage): void => (self as unknown as Worker).postMessage(m);
  self.onmessage = async (e: MessageEvent<CalcRequest<G>>) => {
    const req = e.data;
    const saves = new Map(Object.entries(req.saves));
    try {
      const result = await calculateSheet(
        {
          ...game(req),
          getSave: (name) => Promise.resolve(saves.get(name) ?? null),
          putSave: (name, bytes) => {
            saves.set(name, bytes);
            return Promise.resolve();
          },
          seed: req.seed,
        },
        req.text,
        actions,
        (p) => post({ kind: "progress", progress: p }),
      );
      post({ kind: "done", result });
    } catch (err) {
      post({ kind: "error", message: (err as Error).message });
    }
  };
}
