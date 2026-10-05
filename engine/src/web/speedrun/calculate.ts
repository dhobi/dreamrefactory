/**
 * A sheet's time, worked out rather than watched (#509): the workbench's
 * Calculate button.
 *
 * The sheet is played headless (headless.ts) on a sheet's clock, as fast as the
 * CPU goes, in a Web Worker beside the page — so the answer is the in-game time
 * the same sheet shows when it is played on screen, without the minutes it takes
 * to play it there. Everything here is plain data in and out, because it crosses
 * a worker's message boundary both ways.
 */
import { verbsOf, type ActionTable } from "./action";
import { headlessRun, type HeadlessGame } from "./headless";
import { runSheet } from "./runner";
import { SheetError, parseSheet } from "./sheet";

/** how far a calculation has got — the line it is on, of how many */
export interface CalcProgress {
  /** actions done, of {@link total} */
  done: number;
  total: number;
  /** the sheet line now running */
  line: number;
  /** in-game ms so far */
  game: number;
}

export type CalcResult =
  | { ok: true; game: number; frames: number; real: number }
  | {
      ok: false;
      /** the sheet line it stopped at */
      line: number;
      error: string;
      /** in-game ms before it stopped */
      game: number;
      real: number;
    };

/** play `text` to its end, or to the line it fails at */
export async function calculateSheet(
  game: Omit<HeadlessGame, "prepare"> & { prepare?: HeadlessGame["prepare"] },
  text: string,
  actions: ActionTable,
  onProgress: (p: CalcProgress) => void,
): Promise<CalcResult> {
  const started = performance.now();
  const real = (): number => performance.now() - started;
  let steps;
  try {
    steps = parseSheet(text, { verbs: verbsOf(actions) });
  } catch (e) {
    const line = e instanceof SheetError ? e.line : 1;
    return { ok: false, line, error: (e as Error).message, game: 0, real: real() };
  }
  const { driver, host } = await headlessRun({
    ...game,
    prepare: (s) => {
      // a sheet's clock, as on the workbench while a sheet runs (#508)
      s.nominalTime = true;
      s.sheetClock = true;
      if (game.seed !== null) s.seedRandom(game.seed);
      game.prepare?.(s);
    },
  });
  let from: number | null = null;
  const gameSoFar = (): number => host().session.gameNow - (from ?? host().session.gameNow);
  const r = await runSheet(driver, steps, actions, {
    onStep: (step, done, total) => {
      from ??= host().session.gameNow;
      onProgress({ done, total, line: step.line, game: gameSoFar() });
    },
  });
  if (r.failure) {
    return { ok: false, line: r.failure.step.line, error: r.failure.error.message, game: r.total.game, real: real() };
  }
  return { ok: true, game: r.total.game, frames: r.total.frames, real: real() };
}
