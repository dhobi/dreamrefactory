/**
 * The run loop — one sheet, one game, timed.
 *
 * Shared by both hosts on purpose. The Playwright CLI and the in-page previewer
 * differ in how a key is delivered and how a predicate is evaluated, and in
 * nothing else: the same parser produces the same steps, the same action table
 * executes them, and this loop times them the same way. If the two ever
 * disagreed about what a sheet MEANS, the previewer would be worse than useless
 * — you would tune against one and run against the other.
 *
 * So everything host-shaped is behind {@link SpeedrunDriver}, and everything
 * presentation-shaped is behind {@link RunHooks}. What is left is the loop.
 */
import {
  clearWatches,
  resolveIn,
  verbsOf,
  watches,
  type Action,
  type ActionContext,
  type ActionTable,
  type Watch,
} from "./action";
import type { Step } from "@dreamfactory/engine/web/speedrun/sheet";
import type { Clock, SpeedrunDriver, WaitMode } from "@dreamfactory/engine/web/speedrun/driver";

/**
 * How often a standing watch is polled while a step runs (#255).
 *
 * A quarter of a second: fast enough that an unexpected film is answered while
 * the line it interrupted is still waiting, slow enough that the poll — one
 * round trip however many watches there are — is not what the run is spending
 * its time on. Nothing is polled when no watch is registered.
 */
const WATCH_TICK_MS = 250;

/**
 * Every `ms` below is LOAD-REMOVED, and every one of them says how much was
 * removed ([#251](https://github.com/dhobi/dreamrefactory/issues/251)).
 *
 * A route run in a browser spends part of its wall time downloading the game,
 * and that part belongs to the network rather than to the route: the same sheet
 * over a cold cache and a warm one is minutes apart with not one gesture
 * changed, so a wall-clock total cannot be compared with the wall-clock total of
 * the same sheet run yesterday, let alone somebody else's. So the number a run
 * is READ from has the loading taken out of it, which is what a PC speedrun's
 * load remover does and for the same reason.
 *
 * `loading` is not a footnote to that — it is how the removal is checkable.
 * `ms + loading` is the wall clock to the millisecond, so nothing is hidden and
 * a reader can always get back to what the stopwatch on the desk would have
 * said. It is also a number worth reading on its own: a leg that removed twenty
 * seconds is a leg whose real cost is a download, and warming the cache
 * (engine/src/web/cache-warmup.ts) will change the run more than tuning it will.
 */
/** what one action cost */
export interface Timing {
  step: Step;
  /** wall ms with the loading taken out — what the action cost the route */
  ms: number;
  frames: number;
  /** ms of it spent waiting on the network, and therefore not in `ms` */
  loading: number;
  /** ms of `after:` padding inside it — dead time, called out separately */
  padded: number;
  says: string[];
  suggestion?: string;
}

export interface Split {
  name: string;
  /** wall ms with the loading taken out — see the note above */
  ms: number;
  frames: number;
  /** ms of it spent waiting on the network, and therefore not in `ms` */
  loading: number;
  actions: number;
}

export interface RunResult {
  timings: Timing[];
  splits: Split[];
  total: { ms: number; frames: number; loading: number };
  failure: { step: Step; error: Error } | null;
  /** where the game was standing when it stopped — only sampled on failure */
  where: string | null;
}

/**
 * The route's own time between two readings: wall time, less the network.
 *
 * One function rather than the subtraction written out at each of the four
 * places a duration is taken, because the two halves have to agree — a split
 * whose `ms` removed the loading and a total whose did not would put a run's
 * legs and its headline in different units, and the page adds the legs up and
 * prints the total beside them.
 *
 * Clamped at zero. It cannot go negative from a fetch that began before the
 * first reading and landed after the second — the loading total only counts
 * time the wire was busy, which is a subset of the wall time either way — but a
 * clock that jumps (a suspended tab resuming, a system clock stepping under
 * `Date.now`) can produce anything, and a negative leg would be read as a
 * measurement rather than as the artefact it is.
 */
const netMs = (from: Clock, to: Clock): number =>
  Math.max(0, to.ms - from.ms - (to.loading - from.loading));

export interface RunHooks {
  /** before an action runs, so a UI can say what is happening now */
  onStep?(step: Step, index: number, total: number): void;
  /** after it runs, with what it cost */
  onDone?(timing: Timing): void;
  /** when a split closes */
  onSplit?(split: Split): void;
  /** a standing watch fired while a step was running — see `watchFor` (#255) */
  onWatch?(watch: Watch, said: string[]): void;
}

/* ------------------------------------------------------------------ *
 * The execution pointer
 * ------------------------------------------------------------------ */

/**
 * Where the next action is — as a place in the TEXT, not an index into a parse.
 *
 * The distinction is the whole design. A sheet is edited between runs, constantly
 * — that is what the workbench is for — and an index into "the steps as they were
 * parsed ten seconds ago" means something different the moment a line is added
 * above it. A line number survives that: insert three lines at the top and the
 * pointer moves with the text, because the text is what it names.
 *
 * `skip` is the second half of the same honesty. `left(); up(); left()` is three
 * actions on one line, so a line number alone cannot say WHICH of them is next —
 * and resuming a pause after the first `left` by re-running all three is a
 * different route. `skip` counts how many of that line's actions are already
 * done.
 */
export interface Pointer {
  /** 1-based line of the next action */
  line: number;
  /** actions already done ON that line, for a line holding several */
  skip: number;
}

/** the top of the sheet — where a finished or stopped run goes back to */
export const TOP: Pointer = { line: 1, skip: 0 };

/** the steps still to run, given where the pointer is */
export function stepsFrom(steps: Step[], at: Pointer): Step[] {
  let seen = 0;
  const out: Step[] = [];
  for (const step of steps) {
    if (step.line < at.line) continue;
    if (step.line === at.line && seen++ < at.skip) continue;
    out.push(step);
  }
  return out;
}

/** the pointer that names a given step of a parse */
export function pointerAt(steps: Step[], index: number): Pointer {
  const step = steps[index];
  if (!step) return TOP;
  let skip = 0;
  for (let i = 0; i < index; i++) if (steps[i].line === step.line) skip++;
  return { line: step.line, skip };
}

/**
 * The pointer just past a step — where a run that has completed it resumes.
 *
 * Past the END of the sheet is reported as null rather than as some line past
 * the last one, because "there is nothing left" is a different answer from "the
 * next thing is here" and the caller has to do something different with it.
 */
export function pointerAfter(steps: Step[], step: Step): Pointer | null {
  const i = steps.indexOf(step);
  if (i < 0 || i + 1 >= steps.length) return null;
  return pointerAt(steps, i + 1);
}

/**
 * The wait each verb does unless the line says otherwise.
 *
 * Takes the table for the same reason {@link runSheet} does: what a verb waits
 * for is a fact about the vocabulary in play, and there is more than one.
 */
export function waitOf(actions: ActionTable, step: Step): WaitMode {
  const asked = step.opts.wait as WaitMode | undefined;
  if (asked) {
    if (!["none", "taken", "ready", "quiet"].includes(asked)) {
      throw new Error(`sheet line ${step.line}: wait: ${asked} is not none|taken|ready|quiet`);
    }
    return asked;
  }
  return resolveIn(actions, step.verb)?.wait ?? "taken";
}

/**
 * Where the game was standing when it stopped.
 *
 * A failed run says "nothing called poster is clickable from here" and the only
 * useful next question is "from WHERE?". Sampled once, after the fact, so a
 * passing run pays nothing for it and a failing one does not need re-running to
 * find out. It has already earned its keep twice — it is what revealed that the
 * London flat opens on View14 rather than View12, and that c73 arrives in a
 * different scene from the one the route wanted.
 */
export const WHERE = `(() => {
  const s = window.dbg.session, v = window.dbg.viewer;
  const set = String(s.currentSetFile || s.currentSetName || "?");
  if (!v) return set + " (no viewer — still booting?)";
  const view = v.scene.views[v.viewIdx];
  const bits = [
    set + " " + v.scene.sceneName + "/" + (view ? view.viewName : "?"),
    // "the room is not showing" is the half a reader needs and the name alone
    // cannot give: a room carries the HUD band (main 1) as a flat too, so an
    // open FIGHT.STG printed exactly like an ordinary room, and one of the two
    // means every walk from here is going to fail.
    s.currentFlat && s.currentFlat !== "none"
      ? 'flat "' + s.currentFlat + '"' + (s.viewShowing ? "" : " (OVERLAY STAGE — the room is not showing)")
      : "",
    v.moviePlaying ? "movie " + (v.movieFile || "?") + (v.movieRegions.length ? " (parked, " + v.movieRegions.length + " regions)" : " (playing)") : "",
    v.conversing ? "talking to " + (v.conversingWith || "?") : "",
    s.fading ? "fading" : "",
    // "script busy" is half an answer and the engine keeps the other half:
    // session.pending() names every in-flight dispatch, which is the difference
    // between "something is running" and "c73.set openscene never came back".
    // A stall reported without it is a stall nobody can act on.
    // (No backticks in here — this whole thing is a template literal.)
    s.scriptBusy ? "script busy (" + (s.pending().join(", ") || "unlabelled") + ")" : "",
    // The one refusal that is not a state of the viewer, and so the one a
    // failure report could not previously mention: lockevents is a script
    // global, read straight out of the click dispatch and the keydown chain,
    // and a gesture made while it is set is dropped without being run, queued
    // or logged. Every other line here can be false and the world still deaf.
    // (No backticks in here — this whole thing is a template literal.)
    (() => {
      const l = s.interp.globals.get("lockevents") ?? 0;
      return (typeof l === "number" ? l !== 0 : String(l).length > 0) ? "WORLD FROZEN (lockevents)" : "";
    })(),
    "clickable here: " + (view ? view.objects.map((o) => o.identifier).filter(Boolean).join(", ") || "nothing" : "?"),
    // Who is in the room, and who is merely LOADED. "gave up hunting for max"
    // is only half an answer — the other half is whether he is absent, present
    // but invisible, or standing there under a name the route does not use.
    (() => {
      const all = [...s.actorRuntime.actors.entries()];
      const shown = all.filter(([, a]) => a.visible).map(([n]) => n);
      const hidden = all.filter(([, a]) => !a.visible).map(([n]) => n);
      return "cast: " + (shown.join(", ") || "nobody visible") +
        (hidden.length ? " · loaded but hidden: " + hidden.join(", ") : "");
    })(),
  ];
  return bits.filter(Boolean).join(" · ");
})()`;

export async function runSheet(
  d: SpeedrunDriver,
  steps: Step[],
  /**
   * The vocabulary to run against — the engine's verbs plus this game's
   * (`taoot/src/speedrun/actions.ts`, `ACTIONS`).
   *
   * A parameter and not an import, which is the seam that let this loop into the
   * engine at all: it used to reach for one module-level table, and that table
   * was Titanic's. The run loop has no opinion about what verbs exist — it looks
   * each line's verb up, asks how much to wait for, and calls it — so the table
   * is the caller's to supply, and a second game supplies its own.
   *
   * It also has to be the SAME table the sheet was parsed with. A line that
   * parsed against one vocabulary and ran against another would fail here as a
   * missing verb, which is a confusing way to report a mismatch nobody made on
   * purpose: `parseSheet(text, { verbs: VERBS })` and `runSheet(d, steps,
   * ACTIONS)` are two halves of one statement.
   */
  actions: ActionTable,
  hooks: RunHooks = {},
): Promise<RunResult> {
  const resolve = (verb: string): Action | undefined => resolveIn(actions, verb);
  /** what `watchFor` parses its action against — see {@link ActionContext.verbs} */
  const verbs = verbsOf(actions);
  const timings: Timing[] = [];
  const splits: Split[] = [];
  let failure: { step: Step; error: Error } | null = null;

  // a watch belongs to the run that registered it, not to the process
  clearWatches();

  const started: Clock = await d.clock();
  let splitFrom = started;
  let splitActions = 0;
  const actionCount = steps.filter((s) => s.verb !== "split").length;
  let index = 0;

  /**
   * The standing watches, polled ALONGSIDE the running step (#255).
   *
   * Not between steps, which would be too late: the step that needs rescuing is
   * the one already waiting. During mission 4 the sinking films arrive at a
   * moment no sheet can name, block input, and the line waiting on the world
   * times out through no fault of its own — so something has to press ESC while
   * that line is still waiting. This is that something.
   *
   * Safe to gesture from, because a step that is WAITING is only polling: the
   * driver's holds read the page and nothing else. A watch that fires while a
   * step is mid-gesture is the one hazard, and it is the sheet author's to avoid
   * — a watch is for recovery (an unexpected film, a stray dialog), not for
   * playing the game.
   *
   * One round trip per tick however many watches there are: they are evaluated
   * as a single array. Nothing is polled at all when no watch is registered, so
   * a sheet that does not use them pays nothing.
   */
  const runWatches = async (): Promise<void> => {
    const live = watches();
    if (!live.length) return;
    const probe = `[${live.map((w) => `!!(${w.expr})`).join(",")}]`;
    let now: boolean[];
    try {
      now = await d.evaluate<boolean[]>(probe);
    } catch {
      return; // a page mid-navigation is not a watch failing
    }
    for (let i = 0; i < live.length; i++) {
      const w = live[i];
      if (!now[i]) {
        w.armed = false; // the edge is re-armed by the condition going false
        continue;
      }
      if (w.armed) continue;
      w.armed = true;
      w.fired++;
      const act = resolve(w.action.verb);
      if (!act) continue;
      const said: string[] = [];
      try {
        await act.run({
          d,
          step: w.action,
          wait: waitOf(actions, w.action),
          budget: Number(w.action.opts.budget ?? 10_000),
          gap: Number(w.action.opts.gap ?? 16),
          say: (m: string) => said.push(m),
          suggest: () => {},
          verbs,
        });
        hooks.onWatch?.(w, said);
      } catch (e) {
        hooks.onWatch?.(w, [`failed: ${(e as Error).message}`]);
      }
    }
  };

  /** poll the watches until the step it is running beside is done */
  const watchdog = (done: () => boolean): Promise<void> =>
    (async () => {
      while (!done()) {
        await runWatches();
        if (done()) return;
        await d.sleep(WATCH_TICK_MS);
      }
    })();

  for (const step of steps) {
    if (step.verb === "split") {
      const now = await d.clock();
      const split: Split = {
        name: step.args[0] ?? `split ${splits.length + 1}`,
        ms: netMs(splitFrom, now),
        frames: now.frames - splitFrom.frames,
        loading: now.loading - splitFrom.loading,
        actions: splitActions,
      };
      splits.push(split);
      hooks.onSplit?.(split);
      splitFrom = now;
      splitActions = 0;
      continue;
    }

    hooks.onStep?.(step, index++, actionCount);
    const action = resolve(step.verb)!;
    const says: string[] = [];
    let suggestion: string | undefined;
    const before = await d.clock();
    const paddedBefore = d.padded();

    try {
      const ctx: ActionContext = {
        d,
        step,
        wait: waitOf(actions, step),
        /**
         * TEN SECONDS, and the point of it is the sheet rather than the run.
         *
         * This was 120 s, and a two-minute ceiling is not a default so much as
         * an absence of one: nothing in a working run ever reaches it, so it
         * never appears in the report and never has to be justified. What it
         * bought instead was a `budget:` on 51 lines of the sheet of which 47
         * were at or below the default — four of them exactly 120000 — written
         * out of caution rather than measurement, and each one a number a
         * reader has to decide whether to believe.
         *
         * At ten seconds the option means something again. Every line that
         * needs longer has to SAY it needs longer, which turns `budget:` from
         * noise into the sheet's list of the genuinely slow moments — the
         * intro film, the fight, the smokestack climb, a walk across the ship.
         * And a leg that hangs is called stuck in ten seconds instead of two
         * minutes, which is the whole edit loop when a sheet is being written.
         *
         * It costs nothing when a line works: the budget is a ceiling on a
         * hold, not a wait, and a hold resolves the moment its condition does.
         */
        budget: Number(step.opts.budget ?? 10_000),
        gap: Number(step.opts.gap ?? 16),
        say: (m: string) => says.push(m),
        suggest: (line: string) => (suggestion = line),
        verbs,
      };
      let over = false;
      const dog = watches().length && step.verb !== "watchfor"
        ? watchdog(() => over)
        : null;
      try {
        for (let i = 0; i < step.repeat; i++) {
          await action.run(ctx);
          if (step.opts.after) await d.pad(Number(step.opts.after));
        }
      } finally {
        over = true;
        if (dog) await dog;
      }
    } catch (e) {
      failure = { step, error: e as Error };
    }

    const after = await d.clock().catch(() => before);
    const timing: Timing = {
      step,
      ms: netMs(before, after),
      frames: after.frames - before.frames,
      loading: after.loading - before.loading,
      padded: d.padded() - paddedBefore,
      says,
      suggestion,
    };
    timings.push(timing);
    hooks.onDone?.(timing);
    splitActions++;
    if (failure) break;
  }

  const ended = await d.clock().catch(() => started);
  if (splitActions) {
    const split: Split = {
      name: failure ? "(unfinished)" : "(final)",
      ms: netMs(splitFrom, ended),
      frames: ended.frames - splitFrom.frames,
      loading: ended.loading - splitFrom.loading,
      actions: splitActions,
    };
    splits.push(split);
    hooks.onSplit?.(split);
  }

  const where = failure ? await d.evaluate<string>(WHERE).catch(() => "could not be sampled") : null;

  return {
    timings,
    splits,
    total: {
      ms: netMs(started, ended),
      frames: ended.frames - started.frames,
      loading: ended.loading - started.loading,
    },
    failure,
    where,
  };
}
