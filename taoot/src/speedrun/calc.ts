/**
 * The page's half of Calculate (#509): start calc-worker.ts, pass it what the
 * play page knows, relay its progress, and hand back its answer.
 */
import type { CalcProgress, CalcResult } from "@dreamfactory/engine/web/speedrun/calculate";

export interface CalcRequest {
  text: string;
  /** every hosted game file, by the name the engine asks for and its URL */
  files: [name: string, url: string][];
  edition: string;
  /** the sheet's checkpoints, for its `load()` lines */
  saves: Record<string, Uint8Array>;
  /** the shipped saves a fresh game writes its own over, disc 1 and disc 2 */
  templates: [Uint8Array | null, Uint8Array | null];
  seed: number | null;
}

export type CalcMessage =
  | { kind: "progress"; progress: CalcProgress }
  | { kind: "done"; result: CalcResult }
  | { kind: "error"; message: string };

/** run the worker to an answer; aborting `signal` ends it at once */
export function calculateInWorker(
  req: CalcRequest,
  onProgress: (p: CalcProgress) => void,
  signal: AbortSignal,
): Promise<CalcResult> {
  const worker = new Worker(new URL("./calc-worker.ts", import.meta.url), { type: "module" });
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
