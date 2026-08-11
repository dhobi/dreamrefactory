/**
 * Two runs of one route produce one answer — the rules that keep it true.
 *
 * A value that differs between two runs of the same route cannot be compared
 * against a golden, so anything that could vary has to come from the engine's own
 * clock or the engine's own seeded stream. There are exactly two ways to break
 * that, and this file bans both at the source.
 *
 * Source rules rather than behaviour tests, because the behaviour they protect is
 * unaffordable to assert directly: proving it takes two full 27-segment
 * playthrough runs and a byte comparison of 27 goldens, which is five minutes.
 * What that comparison caught is cheap to state, so state it here.
 *
 * ## 1. The engine never asks the wall clock anything
 *
 * `SetViewer.walkAfterFade` polled `session.fading` with `setTimeout(r, 0)`.
 * `fading` clears in `GameSession.tickFade`, which steps the ramp on the GAME
 * clock one `ENGINE_STEP_MS` at a time — so that line asked a question about game
 * time and waited for an answer in real milliseconds. Headless the pump drives
 * one engine step per `setImmediate` and an arbitrary, load-dependent number of
 * those fit inside the ~1 ms a `setTimeout(0)` takes, so the arrival walk into a
 * room landed a different number of engine steps after the fade on every run.
 * That one line was the whole of why the playthrough oracle was not
 * deterministic: two identical headless runs first diverged at `attentionspan`
 * 15388 against 15393 in segment 10 — the frame Max's `hasattention(4)` is
 * measured from, in the room the staircase arrives into — every later segment
 * inherited the drift, and the run that lost the race failed outright with `gave
 * up hunting for max in recept1c`. On `session.nextFrame` all 27 goldens record
 * byte-identical across two full runs.
 *
 * So: anything the engine waits on has to be the engine's own frame or the
 * engine's own clock. `session.nextFrame` is that primitive — `setImmediate`
 * headless (interleaving FIFO with the pump's own drain, one iteration per engine
 * step) and `requestAnimationFrame` in a browser.
 *
 * Reading wall time is banned alongside waiting on it, and for the same reason: a
 * value derived from `Date.now()` differs between two runs of the same route, so
 * it cannot be compared against a golden either.
 *
 * ## 2. Every draw comes from a session stream, and both are seeded
 *
 * There are TWO, seeded together by `session.seedRandom` (tests/harness.ts,
 * tests/playthrough/play.ts, and page-side in the browser suites) so they cannot
 * drift apart: `session.rng` is what a script's `random()` draws from, and
 * `session.ambientRng` is what the engine's own ambient timers draw from — today
 * just cricket re-arm jitter. `Scheduler.rand` was calling bare `Math.random` —
 * the one draw in the engine no seed reached, and the reason this rule is a test
 * rather than a convention.
 *
 * It was latent rather than active, which is what made it worth pinning down. The
 * only crickets in the corpus with a jitter are `steam1`/`steam2` in BOOTFILE
 * container 2 (`200, 200`; every other one is 0, or the -1 one-shot), so the draw
 * only ever chose when a steam hiss re-armed in the boiler and engine rooms. But a
 * cricket writes its name to sound channel 2 when it fires, `currentsound(2)` is
 * how a script asks whether a sound has finished, and that is exactly how the
 * bedsit landlady sequences her five lines. One route not polling it today is not
 * a property to rely on.
 *
 * TI.EXE has one `rand()`, so ONE stream is the faithful arrangement, and this
 * file used to say that settled it. It doesn't, and the reason is worth keeping.
 * Pointing the crickets at `session.rng` re-recorded 24 goldens once (a different
 * maze, the Vlad fight 4-8 units apart, different crowd extras, the plant's
 * accumulators by one, `min` one minute on in three segments) — and then went on
 * re-recording them, because those draws happen ON THE CLOCK. Measured over carried
 * segments 1-5: the crickets draw **4 times** against the scripts' **834**, and
 * un-shadowing `trackbut` changed the script draw COUNT not at all while still
 * flipping the Gorse/Jones coin and reshuffling the crowd — 4 ambient draws had
 * slid to different places in the shared sequence and re-valued all 834.
 *
 * So they are split (`GameSession.ambientRng`), which cost one more re-record and
 * ends that class of failure. The fidelity point given up is unobservable in
 * principle: which arbitrary value a draw returns is arbitrary either way, and the
 * original seeded its `rand()` from the clock, so its sequence is not a thing this
 * port could match even if it tried. What was bought is that an engine change with
 * no effect on what scripts ASK for now has no effect on what they GET — and the
 * headless golden can assert the coin flip again (src/engine/masks.ts).
 */
import { describe, expect, test } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const SRC = join(new URL("../..", import.meta.url).pathname, "src");

/**
 * Real-time primitives. `setImmediate` is deliberately absent: it is a
 * macrotask yield with no time in it, which is exactly what a pumped host wants.
 */
const WALL_CLOCK = /\b(setTimeout|setInterval|Date\.now|performance\.now|new Date)\s*\(/;

/**
 * Files allowed to touch wall time, each because it IS the boundary with the real
 * world rather than something behind it.
 *
 * - `main.ts` is the browser shell: it owns the rAF loop and prints the date.
 * - `host.ts` defines the frame source. Its `setTimeout(0)` is the fallback for
 *   a host with no `setImmediate` — that is, it is where a macrotask yield comes
 *   from, not somewhere one is awaited.
 * - the save modules stamp `mtime` on a saved file, which is a fact about the
 *   filesystem and not about the game.
 * - `booklet.ts` is on the collection page and never runs while a game does.
 *   Its timer is how long a CSS page-turn lasts, which is a fact about the
 *   stylesheet — and it cannot be a `transitionend`, because src/theme.css
 *   turns every transition off under `prefers-reduced-motion` and an event
 *   that never fires would leave a leaf standing in mid-air.
 * - `bug-report.ts` is a button and a form. Its timer holds an object URL open
 *   long enough for the download it was created for to start, which is a fact
 *   about the browser; nothing in the game waits on it, and the engine steps on
 *   through either way.
 */
const CLOCK_ALLOWED = new Set([
  "main.ts",
  "host.ts",
  "save-browser.ts",
  "save-seed.ts",
  "booklet.ts",
  "bug-report.ts",
]);

/**
 * A CALL to `Math.random`, which is the thing that draws off-stream. The two
 * places the name appears as a default VALUE — `GameSession.rng` and
 * `registerCoreBuiltins`' parameter — are the fallback for a host that never
 * seeds, and are matched by neither this nor the allow-list below.
 */
const OFF_STREAM_RANDOM = /\bMath\.random\s*\(/;

function* walk(dir: string): Generator<string> {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (p.endsWith(".ts")) yield p;
  }
}

/** every line of src/, as (file-relative path, 1-based line, code without comments) */
const lines: { rel: string; line: number; code: string; text: string }[] = [];
for (const path of walk(SRC)) {
  const rel = path.slice(SRC.length + 1);
  readFileSync(path, "utf8")
    .split("\n")
    .forEach((text, i) => {
      // a mention in prose is fine — these rules are about code
      const code = text.replace(/\/\/.*$/, "").replace(/^\s*\*.*$/, "");
      lines.push({ rel, line: i + 1, code, text });
    });
}

const offending = (
  pattern: RegExp,
  allowed: Set<string> = new Set(),
): string[] =>
  lines
    .filter((l) => !allowed.has(l.rel) && pattern.test(l.code))
    .map((l) => `${l.rel}:${l.line}: ${l.text.trim()}`);

describe("two runs of one route produce one answer", () => {
  test("the engine waits on its own clock, never on the wall", () => {
    expect(
      offending(WALL_CLOCK, CLOCK_ALLOWED),
      "wait on session.nextFrame / session.clock instead",
    ).toEqual([]);
  });

  test("the engine draws from session.rng, never from Math.random", () => {
    expect(offending(OFF_STREAM_RANDOM), "draw from session.rng instead").toEqual([]);
  });
});
