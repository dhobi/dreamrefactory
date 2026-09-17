/**
 * One browser for all of them.
 *
 * Every suite in this directory used to be its own `tsx` process with its own
 * `chromium.launch()`, and that cost twice:
 *
 *   - each process imports Playwright from scratch, which is about a second
 *     apiece and thirty seconds across the set;
 *   - each launch is another Chromium, and this machine has around a gigabyte
 *     free with several gigabytes held by things that are not this repo. Running
 *     suites back to back produced failures that did not reproduce alone —
 *     `woods` losing a score, `service` reporting "no position in the HUD",
 *     `arcade` throwing a TypeError, `guns` losing a pickup. Four different
 *     symptoms of one cause, and each one cost a re-run to identify.
 *
 * So a suite no longer owns a browser. It asks for one, and what it gets depends
 * on who is asking:
 *
 *   - run on its own (`npm run test:browser:vat`), it gets a fresh Chromium and
 *     closes it at the end, exactly as before;
 *   - run under `tools/runsuites.mts`, it gets the shared one and gives back
 *     only its own contexts.
 *
 * The pooled browser is launched with the union of the options the suites ask
 * for, because the first suite to ask would otherwise decide for the rest:
 * `sound` needs `--autoplay-policy=no-user-gesture-required` and would be the
 * only one to get it.
 */
import { type Browser, type LaunchOptions, chromium } from "playwright";

/** what the pooled browser is launched with, whoever asks for it first */
export const POOLED_OPTIONS: LaunchOptions = {
  // `sound.ts` cannot hear anything without it, and it costs the others nothing
  args: ["--autoplay-policy=no-user-gesture-required"],
  headless: !process.env.HEADED,
};

let shared: Browser | null = null;

/** true while `tools/runsuites.mts` is driving */
export const pooled = (): boolean => process.env.SC_POOLED_BROWSER === "1";

/** a browser to run this suite in — shared under the runner, its own otherwise */
export async function launch(opts: LaunchOptions = {}): Promise<Browser> {
  if (!pooled()) return chromium.launch(opts);
  shared ??= await chromium.launch(POOLED_OPTIONS);
  return shared;
}

/**
 * Give it back. Standalone that is a close; pooled it is the contexts only,
 * because the next suite is about to want the browser.
 */
export async function finish(browser: Browser): Promise<void> {
  if (!pooled()) {
    await browser.close();
    return;
  }
  for (const c of browser.contexts()) await c.close();
}

/** the runner's own, once every suite has had its turn */
export async function shutdown(): Promise<void> {
  await shared?.close();
  shared = null;
}

/**
 * A suite has found something wrong.
 *
 * Standalone this is the exit code npm reads. Pooled it has to be a throw: one
 * process is running every suite, and `process.exit` there would take the rest
 * of the run with it.
 */
export function fail(why: string): never {
  console.error(`FAIL  ${why}`);
  if (pooled()) throw new SuiteFailure(why);
  process.exit(1);
}

/** what {@link fail} throws under the runner, so the runner can tell it apart */
export class SuiteFailure extends Error {
  constructor(why: string) {
    super(why);
    this.name = "SuiteFailure";
  }
}
