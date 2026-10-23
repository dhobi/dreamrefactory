/**
 * The page's half of Titanic's Calculate (#509): start calc-worker.ts and hand
 * it what the play page knows. The rest of both halves is the workbench's
 * (speedrun/src/calc-worker.ts).
 */
import type { CalcProgress, CalcResult } from "@dreamfactory/speedrun/calculate";
import { calculateInWorker as runWorker, type CalcRequest } from "@dreamfactory/speedrun/calc-worker";

/** what the worker needs to boot Titanic off the network */
export interface TitanicCalc {
  /** every hosted game file, by the name the engine asks for and its URL */
  files: [name: string, url: string][];
  edition: string;
  /** the shipped saves a fresh game writes its own over, disc 1 and disc 2 */
  templates: [Uint8Array | null, Uint8Array | null];
}

/** run the worker to an answer; aborting `signal` ends it at once */
export function calculateInWorker(
  req: CalcRequest<TitanicCalc>,
  onProgress: (p: CalcProgress) => void,
  signal: AbortSignal,
): Promise<CalcResult> {
  const worker = new Worker(new URL("./calc-worker.ts", import.meta.url), { type: "module" });
  return runWorker(worker, req, onProgress, signal);
}
