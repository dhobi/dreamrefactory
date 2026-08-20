/**
 * The speedrun workbench — the panel under the game on `/speedrun/`.
 *
 * Write a sheet, press Play, watch it play, read which line broke. That loop is
 * the whole point: the Playwright runner takes a minute of process startup and a
 * terminal to read, and while a route is being written you want the answer in a
 * second, next to the thing it is about.
 *
 * ## The sheet is a program, and the pointer is where it is
 *
 * Three ideas hold this page together and each exists because the obvious
 * alternative was worse.
 *
 * **Sheets are the user's**, several of them, named and kept. A route gets tried
 * three ways and a leg gets pulled out to be worked on alone; with one box those
 * are the same box, and every attempt destroys the last.
 *
 * **The execution pointer** says where Play would start. It is a LINE, not an
 * index into a parse, so it survives the editing that goes on between runs.
 * Before it existed, jumping to a checkpoint meant rewriting the box with the
 * lines after it — a copy that immediately diverged from the sheet it came out
 * of, and that threw away everything above the cut.
 *
 * **Only three things move it**: Play (forward, one action at a time), a
 * checkpoint (to the line after its `save()`), and Stop or the end (back to the
 * top). Not the caret, not a click in the gutter. The point is that the game's
 * state and the pointer are one fact — a pointer you can drop anywhere is a way
 * to run a sheet from a place the game was never brought to, and the run that
 * follows is nonsense that takes an expert to recognise. A checkpoint is the
 * only jump because it is the only thing that moves both halves at once.
 *
 * It is deliberately a THIN layer. The parser, the action table and the run loop
 * are the same modules the CLI uses (`src/speedrun/`), so a sheet cannot mean one
 * thing here and another there — if it could, tuning here would be tuning against
 * the wrong game. All this file does is find the canvas, build the in-page driver,
 * and render what the runner reports.
 *
 * ## The one honest difference
 *
 * The events are synthetic. `main.ts` never asks `isTrusted`, so the engine
 * cannot tell — but they skip the browser's real input pipeline, which
 * Playwright's do not. The same sheet therefore finishes faster here. The page
 * says so under the controls, and this is not false modesty: two numbers that
 * measure different things should never be compared, and the moment someone
 * quotes a workbench time as a record the whole exercise stops meaning anything.
 *
 * ## Focus
 *
 * The textarea and the game share a document, and `main.ts` listens for keys on
 * `window`. That would be a problem — typing a sheet would walk the player around
 * — except the engine already guards for it: `focusOwnsKey(e.target, key)` bails
 * when the event came from a field. Typing in the textarea is typing; click away
 * and the arrows reach the game again. Nothing here has to do anything about it,
 * which is worth writing down so nobody later "fixes" it.
 */
import { parseSheet, describeSheet, type Step } from "./speedrun/sheet";
import { siteUrl } from "./site";
import { VERBS, CONDITIONS, UNIVERSAL_HELP, interruptible } from "./speedrun/actions";
import { pageDriver, saveKey, parseSaveKey, SAVE_PREFIX, Aborted } from "./speedrun/page-driver";
import { Paused } from "./speedrun/driver";
import {
  runSheet, stepsFrom, pointerAfter, TOP,
  type Pointer, type RunResult, type Split,
} from "./speedrun/runner";
import { gamefileSizes } from "./editions";
import { editionOfUrl, NEUTRAL } from "./files";
import { formatBytes, formatEta, formatRate, warmCache, warmupList } from "./cache-warmup";
import { attachEditor } from "./speedrun-editor";
import { attachRecorder } from "./speedrun-recorder";
import { attachInputMonitor } from "./speedrun-inputs";
import { installColumnOrder } from "./speedrun-columns";

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const sheetEl = $<HTMLTextAreaElement>("srsheet");
const playBtn = $<HTMLButtonElement>("srrun");
const pauseBtn = $<HTMLButtonElement>("srpause");
const stopBtn = $<HTMLButtonElement>("srstop");
const stepBtn = $<HTMLButtonElement>("srstep");
const checkBtn = $<HTMLButtonElement>("srcheck");
const clearBtn = $<HTMLButtonElement>("srclear");
const recBtn = $<HTMLButtonElement>("srrec");
const warmBtn = $<HTMLButtonElement>("srwarm");
const warmBar = $<HTMLDivElement>("srwarmbar");
const warmFill = $<HTMLDivElement>("srwarmfill");
const warmNum = $<HTMLDivElement>("srwarmnum");
const sheetsEl = $<HTMLDivElement>("srsheets");
const pointsEl = $<HTMLDivElement>("srparts");
const statusEl = $<HTMLDivElement>("srstatus");
const splitsEl = $<HTMLDivElement>("srsplits");

/** highlighting, line numbers and a Tab that indents — see speedrun-editor.ts */
const editor = attachEditor(sheetEl);

const ms = (n: number): string => {
  const s = n / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  return `${m}:${(s - m * 60).toFixed(1).padStart(4, "0")}`;
};

/**
 * The running clock: seconds since Play, counting.
 *
 * A route is a time, and until this existed the page did not show one until the
 * run was over — the splits table fills in a row at a time, so a leg with no
 * split in it showed nothing at all while it ran. This is the number a stopwatch
 * would be showing: it starts on Play, counts while the run does, and stops
 * where the run stopped so the last reading stays on screen to be read.
 *
 * Wall clock, deliberately, and it is the same wall clock the splits are
 * measured on — so the ticking number and the `elapsed` column agree, including
 * across a Pause (a pause is time the run took, and both count it).
 *
 * Ticking is a `setInterval` in the page, which is what {@link CLOCK_ALLOWED} in
 * tests/auto/reproducible.ts already covers this file for: nothing the engine
 * reads hangs off it.
 */
const clockEl = $<HTMLDivElement>("srclock");
let clockFrom: number | null = null;
let clockTick: number | null = null;

const showClock = (at: number): void => {
  clockEl.textContent = ms(at);
};

function startClock(): void {
  clockFrom = performance.now();
  showClock(0);
  clockEl.classList.add("live");
  if (clockTick !== null) window.clearInterval(clockTick);
  // 100 ms: a tenth is the smallest digit shown, so anything faster redraws a
  // number that has not changed
  clockTick = window.setInterval(() => {
    if (clockFrom !== null) showClock(performance.now() - clockFrom);
  }, 100);
}

/** stop counting, and LEAVE the reading where it stopped — the last thing a run
 *  did is the thing somebody wants to look at */
function stopClock(): void {
  if (clockTick !== null) window.clearInterval(clockTick);
  clockTick = null;
  if (clockFrom !== null) showClock(performance.now() - clockFrom);
  clockFrom = null;
  clockEl.classList.remove("live");
}

function say(message: string, kind: "" | "good" | "bad" = ""): void {
  statusEl.textContent = message;
  statusEl.className = kind;
}

/**
 * The splits table.
 *
 * Five columns, and the two time ones answer different questions. `time` is what
 * the split itself cost, which is what you tune against — it is the number that
 * moves when a leg gets better. `elapsed` is the clock since Play, which is what
 * a run IS: a route's time is read at the last row, and a split three legs in
 * only means something against how long it took to get there.
 *
 * `elapsed` is the running sum of the rows above it rather than a second reading
 * of the clock, so the column always adds up to what is printed beside it — a
 * reader can check the arithmetic, and a paused or resumed run cannot leave the
 * two disagreeing.
 *
 * Headed, because none of it is self-evident: four bare numbers in a row is a
 * puzzle, and "28f" only says frames to somebody who already knows. English
 * only, like the legend and for the same reason — this page is a workbench and
 * not part of the translated site.
 */
function renderSplits(splits: Split[], total?: { ms: number; frames: number }): void {
  if (!splits.length) {
    splitsEl.textContent = "";
    return;
  }
  let elapsed = 0;
  const rows = splits
    .map((s) => {
      elapsed += s.ms;
      return (
        `<tr><td>${escape(s.name)}</td><td class="n">${ms(s.ms)}</td>` +
        `<td class="n">${ms(elapsed)}</td>` +
        `<td class="n">${s.frames}f</td><td class="n">${s.actions}</td></tr>`
      );
    })
    .join("");
  // A `tfoot`, not the last row of the body: it is a summary of the rows and not
  // one of them, and the table is a scrollport with its head pinned (see
  // #srsplits) — so the total pins to the bottom of it the same way, and the
  // number the run is judged on is on screen wherever the splits are scrolled to.
  const totalRow = total
    ? `<tfoot><tr class="total"><td>TOTAL</td><td class="n">${ms(total.ms)}</td>` +
      `<td class="n">${ms(total.ms)}</td>` +
      `<td class="n">${total.frames}f</td><td class="n"></td></tr></tfoot>`
    : "";
  const head =
    `<thead><tr><th>split</th><th class="n">time</th><th class="n">elapsed</th>` +
    `<th class="n">frames</th><th class="n">actions</th></tr></thead>`;
  splitsEl.innerHTML = `<table>${head}<tbody>${rows}</tbody>${totalRow}</table>`;
}

const escape = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** parse, reporting the error where the user can see it rather than throwing */
function parse(): Step[] | null {
  try {
    const steps = parseSheet(sheetEl.value, { verbs: VERBS });
    say(describeSheet(steps), "good");
    return steps;
  } catch (e) {
    say((e as Error).message, "bad");
    return null;
  }
}

/**
 * The legend, built from the action table itself.
 *
 * Generated rather than written out, so it cannot describe a verb that no longer
 * exists or miss one that was just added — the same reason the parser and the
 * runner share one table. English only and deliberately not translated: this
 * page is a workbench, not part of the site.
 */
function renderLegend(): void {
  const body = document.getElementById("srlegendbody");
  if (!body) return;
  const dl = (rows: [string, string][]): string =>
    `<dl>${rows.map(([t, d]) => `<dt>${escape(t)}</dt><dd>${escape(d)}</dd>`).join("")}</dl>`;

  // The signature as a sheet would write it, and the verb's own options after
  // it. `sig` carries the camelCase spelling — the table is keyed lowercase, so
  // taking the key would print `clickat`, which is not a thing anyone types.
  const verbs = Object.entries(VERBS).map(([name, spec]) => {
    // `name:` and not `name=`. The grammar took an equals until it didn't (see
    // the named-argument regex in src/speedrun/sheet.ts, which now rejects one
    // by hand precisely because every sheet ever written is full of them), and
    // the one place still printing the old shape was the manual that tells a
    // first-time reader what to type.
    const opts = spec.opts?.length ? `  ·  ${spec.opts.map((o) => `${o}:`).join(" ")}` : "";
    return [(spec.sig ?? `${name}()`) + opts, spec.help] as [string, string];
  });

  body.innerHTML =
    `<h3>Actions</h3>${dl(verbs)}` +
    `<h3>Conditions — for <code>wait</code> and <code>until:</code></h3>` +
    dl(CONDITIONS.map((c) => [c.name, c.help] as [string, string])) +
    `<h3>On any line</h3>${dl(UNIVERSAL_HELP)}` +
    `<p class="n">Every action is a call: <code>up()</code>, ` +
    `<code>clickAt(169, 311)</code>, <code>closeUp(memory, by: esc)</code>, ` +
    `<code>wait(set == c73, budget: 90000)</code>, <code>talk(purser[1,3,5])</code>. ` +
    `<code>#</code> comments to end of line, <code>;</code> separates actions on ` +
    `one line, <code>xN</code> inside the brackets repeats it N times, and a value ` +
    `needing a comma of its own is quoted: <code>wait(js="a, b")</code>.</p>`;
}
renderLegend();

/**
 * A control that has been CLICKED gives the keyboard back to the game.
 *
 * Reported against Record, where it costs the most: arm it with the mouse, play
 * a few moves, and every key is written into the sheet except SPACE — the one
 * that opens doors. The button still had focus, and a focused button owns Space
 * (that is how a button is pressed without a mouse — src/keys.ts says so, and
 * the recorder asks `focusOwnsKey` before it writes). So the press toggled
 * recording off again instead of opening a door, and `space()` could not be
 * recorded at all. Every other control here has the same shape: Stop, then
 * Space, and you have pressed Stop twice.
 *
 * `detail > 0` is a POINTER click. A button activated from the keyboard — tab to
 * it, press Enter — reports 0, and that one keeps focus, because taking it away
 * would strand someone who is not using a mouse on the body element. So this is
 * "you clicked it, you are looking at the game" and nothing wider.
 *
 * The same fix the play page makes for its picture dropdown, and for the same
 * reason: the arrows and Space belong to the game unless something is genuinely
 * being typed into.
 */
// Both sections, because the panel is two now (#srpanel and #srtimer in
// speedrun/index.html): a control that lands in the timer's column has to lose
// focus for the same reason one in the sheet's does.
for (const section of ["srpanel", "srtimer"]) {
  $<HTMLElement>(section).addEventListener("click", (e) => {
    const el = (e.target as HTMLElement)?.closest?.("button");
    if (el && (e as MouseEvent).detail > 0) el.blur();
  });
}

/**
 * The legend, opened and shut.
 *
 * The save browser's modal, reused rather than reinvented: same `.modal` box,
 * same backdrop, so this page has one dialog and not two that nearly match. It
 * is a reference of about forty verbs — looked up, read, and dismissed — which
 * is what a modal is for and what the `<details>` under the button row was not:
 * shut it said nothing, and open it pushed the status, the splits and the caveat
 * off the bottom of a 26rem panel.
 *
 * Escape closes it, and closing on Escape is not free here — the game takes
 * Escape too, and the run's own `esc()` is a sheet action. `focusOwnsKey` does
 * not help: the dialog is not a text field. So the listener answers only while
 * the dialog is OPEN, and stops the event there, which is the one case where
 * this page may take a key off the game: the player is reading the manual, not
 * playing.
 */
const legendModal = $<HTMLDivElement>("srlegend");
/** whether it is up. A boolean and not `style.display`, which reads `""` rather
 *  than `"none"` until something has set it — so asking the element would have
 *  had the Escape handler below swallowing the game's ESC on a page nobody had
 *  opened the manual on yet. */
let legendOpen = false;
const showLegend = (on: boolean): void => {
  legendOpen = on;
  legendModal.style.display = on ? "flex" : "none";
};
$<HTMLButtonElement>("srhelp").addEventListener("click", () => showLegend(true));
$<HTMLButtonElement>("srlegendclose").addEventListener("click", () => showLegend(false));
// the backdrop, but not the box: a click that lands on the panel itself is a
// click in the manual, and closing on it would eat every attempt to select text
legendModal.addEventListener("click", (e) => {
  if (e.target === legendModal) showLegend(false);
});
window.addEventListener(
  "keydown",
  (e) => {
    if (e.key !== "Escape" || !legendOpen) return;
    showLegend(false);
    e.stopPropagation();
    e.preventDefault();
  },
  true,
);

/* ------------------------------------------------------------------ *
 * The execution pointer
 * ------------------------------------------------------------------ */

/**
 * Where Play would start.
 *
 * A sheet is a program and this is the instruction pointer, which is the whole
 * reason a checkpoint no longer rewrites the box. Loading `m1p1` used to mean
 * "here is a new sheet that starts at m1p1" — a copy, immediately diverging from
 * the sheet it was cut out of, and losing everything before it. It means "you
 * are now at line 233 of THIS sheet" instead: one text, one route, and the parts
 * you have already validated stay where you wrote them.
 *
 * Only three things move it, and the smallness of that list is deliberate:
 *
 *   - PLAY advances it, one action at a time, as each completes.
 *   - a CHECKPOINT sets it to the line after its `save()`, because that is the
 *     line the restored game is standing at.
 *   - STOP, and reaching the end, put it back to the top.
 *
 * Not the caret, not a click in the gutter, not a keyboard shortcut. A pointer
 * you can drop anywhere is a way to run a sheet from a place the game was never
 * brought to, and the run that follows is nonsense you have to be an expert to
 * recognise. The game's state and the pointer are one fact, and only a load can
 * set both.
 */
let pointer: Pointer = TOP;

function setPointer(next: Pointer | null, reveal = false): void {
  pointer = next ?? TOP;
  editor.mark(pointer.line);
  if (reveal) editor.reveal(pointer.line);
}

/** "line 42" / "the top" — how the pointer reads in the status line */
const where = (): string => (pointer.line === 1 && !pointer.skip ? "the top" : `line ${pointer.line}`);

/* ------------------------------------------------------------------ *
 * Running
 * ------------------------------------------------------------------ */

let running: AbortController | null = null;
/** the cache warmup in flight, if there is one — see the section at the bottom */
let warming: AbortController | null = null;
/** the run in flight, so it can be waited out rather than merely cancelled */
let inFlight: Promise<void> = Promise.resolve();
/** a Pause, as opposed to a Stop — the difference is only what happens after */
let paused = false;
/**
 * A Pause has been asked for but the action in flight has to finish first.
 *
 * Because an aborted action cannot say whether it got as far as its gesture, and
 * the pointer stays on it so Resume does it again — which for a movement key is
 * a second walk. Measured: pausing inside the `up()` that leaves c73 aborted the
 * WAIT and not the WALK, and the Resume's press then found `roads 0` and
 * reported "three ArrowUp presses and the world did not move" — in a room with a
 * road it would silently have walked twice instead, which is the "it goes
 * further than the sheet says" this rule exists to stop.
 *
 * So a Pause on anything that presses, clicks or drags is honoured at the next
 * LINE (in `onStep`, before that line has done anything). The verbs that only
 * watch — see `interruptible` in actions.ts — are aborted where they stand,
 * which is what keeps the button responsive during the long ones.
 */
let pauseWanted = false;
/** the verb being run right now, so Pause knows whether it may interrupt it */
let inStep: string | null = null;
/** a Stop is in flight: the dying run's hooks must not move the pointer */
let stopping = false;

function setButtons(live: boolean): void {
  // A warmup and a run are mutually exclusive, and that is a measurement
  // decision rather than a technical one: a route timed while 1.13 GB is coming
  // down the same link is not a reading of the route.
  playBtn.disabled = live || !!warming;
  // With Play, and for its reasons: both start the run, and neither may while
  // one is going or while the cache is coming down. Step is the one control
  // whose tooltip does not change with the pointer — "the next single action" is
  // true at the top and in the middle alike.
  stepBtn.disabled = live || !!warming;
  recBtn.disabled = !!warming;
  warmBtn.disabled = live;
  pauseBtn.disabled = !live;
  // The glyph is ▶ either way — a transport does not relabel itself — so the
  // difference between starting at the top and carrying on from the pointer is
  // said in the tooltip, which is also what a screen reader reads. A control
  // greyed out for a reason on the OTHER side of the panel says the reason
  // there too, rather than leaving somebody clicking a dead button.
  const what = pointer.line === 1 && !pointer.skip ? "Play" : "Resume";
  playBtn.title = warming ? "Waiting for the cache warmup to finish" : what;
  playBtn.setAttribute("aria-label", what);
  warmBtn.title = live
    ? "Not while a run is going — it would be measured against the download"
    : "Fetch every file of the English edition so the run is not waiting on the network";
}

/**
 * Stop whatever is running, and WAIT for it to have stopped.
 *
 * Abort is a request, not an event: the loop notices at its next wait and then
 * unwinds through its own `finally`. Firing the next thing without waiting for
 * that would have two runs holding the same game for as long as the unwind takes
 * — the aborted one still pressing keys into a room the new one has just
 * replaced.
 */
async function stopRun(): Promise<void> {
  if (!running) return;
  running.abort();
  await inFlight;
}

/**
 * Play the sheet from the pointer.
 *
 * Re-parsed on every Play rather than held from the last one, because the text
 * is edited between runs and the pointer is a place in the TEXT — so the steps
 * it names are whatever is written there now.
 */
/**
 * Run the next single action, then stop.
 *
 * Everything about it is Play — same parse, same pointer, same loop, same
 * driver — with the Pause asked for in advance. Sharing that path rather than
 * having a quiet second one matters for the reason the runner is shared between
 * the two hosts: a Step that meant something subtly different from "Play, then
 * Pause" would be a way to see behaviour the real run does not have.
 *
 * The last action of a sheet is the one case where nothing follows it to pause
 * before, so it finishes the run and the pointer goes back to the top — which is
 * what reaching the end means, stepped or played.
 */
function stepSheet(): Promise<void> {
  return playSheet(true);
}

/**
 * @param once run a single ACTION and pause again — see {@link stepSheet}. A
 * parameter and not a flag beside `paused`: `start()` plays a resumed sheet on
 * its own at the bottom of this file, and a flag that outlived a Step it never
 * got to spend would make that reload single-step instead.
 */
function playSheet(once = false): Promise<void> {
  const all = parse();
  if (!all) return Promise.resolve();
  const todo = stepsFrom(all, pointer);
  if (!todo.length) {
    setPointer(TOP, true);
    setButtons(false);
    say("nothing left below the pointer — back to the top", "good");
    return Promise.resolve();
  }
  inFlight = playing(all, todo, once);
  return inFlight;
}

async function playing(all: Step[], todo: Step[], once = false): Promise<void> {
  const canvas = document.getElementById("screen") as HTMLCanvasElement | null;
  if (!canvas) return say("no #screen canvas on this page", "bad");
  if (!(window as unknown as { dbg?: unknown }).dbg) {
    return say("the game has not booted yet — wait for the screen to come up", "bad");
  }

  paused = false;
  pauseWanted = false;
  inStep = null;
  running = new AbortController();
  setButtons(true);
  splitsEl.textContent = "";
  startClock();

  const d = pageDriver({
    win: window,
    canvas,
    signal: running.signal,
    sheet: () => active,
    beforeRestart: () => keepPlace(true),
  });
  const live: Split[] = [];

  try {
    const result: RunResult = await runSheet(d, todo, {
      // The pointer sits ON the running action, not past it: a Pause lands
      // mid-gesture, that gesture did not finish, and Resume has to do it again.
      // Re-pressing a key is cheap and skipping one silently is not.
      onStep: (step, i, total) => {
        if (stopping) return;
        setPointer({ line: step.line, skip: countBefore(all, step) }, true);
        setButtons(true);
        // A deferred Pause lands HERE — before this line has pressed anything, so
        // the pointer sitting on it is honest and Resume runs it exactly once.
        // `onStep` is called outside the runner's try, so throwing stops the run.
        if (pauseWanted) {
          pauseWanted = false;
          throw new Aborted();
        }
        inStep = step.verb;
        say(`[${i + 1}/${total}] line ${step.line}: ${step.source}`);
      },
      // A save() writes its point the moment it runs, so the chip for it should
      // be there the moment it runs — not at the end of a two-minute sheet.
      onDone: (t) => {
        inStep = null;
        if (!stopping) setPointer(pointerAfter(all, t.step));
        remark();
        // A Step: one action, and that was it. Asking for the Pause HERE rather
        // than aborting is what makes a Step a whole action — the next `onStep`
        // honours it before pressing anything, so the pointer left behind names
        // an action that has not started rather than one half-done.
        //
        // One ACTION, not one line: `left(); up(); left()` stops after the
        // first, because `pointerAfter` above has already counted it and the
        // pointer's `skip` is what carries "which of the three" (see Pointer in
        // src/speedrun/runner.ts). The machinery for stopping between two
        // actions on a line was built for Pause; this only asks for it.
        if (once) {
          paused = true;
          pauseWanted = true;
        }
      },
      onSplit: (s) => {
        live.push(s);
        renderSplits(live);
      },
    });
    renderSplits(result.splits, result.total);
    if (result.failure?.error instanceof Paused) {
      // `pause()` is the one stop that does NOT go back onto its own step. The
      // pointer is where `onDone` left it — the line after — because a
      // breakpoint you cannot get past is a deadlock: Resume would run the
      // `pause()` again and stop in the same place forever.
      paused = true;
      setPointer(pointer, true);
      setButtons(false);
      say(`pause() at line ${result.failure.step.line} — press Resume to carry on`, "");
    } else if (result.failure) {
      // BACK ONTO THE STEP THAT DID NOT FINISH. `onDone` fires for a failed
      // action as well as a successful one — the runner times it either way —
      // so by here the pointer has already moved past it, and both the things
      // that end a run early want it not to have: a Pause resumes by doing that
      // action again, and a failure is fixed and retried from itself. Only
      // reaching the END goes back to the top.
      setPointer({ line: result.failure.step.line, skip: countBefore(all, result.failure.step) }, true);
      // An abort is not a failure and must not be dressed as one. It arrives
      // here rather than as an exception because `runSheet` catches what an
      // action throws into `failure` and returns normally.
      if (result.failure.error instanceof Aborted) {
        say(paused ? `paused at ${where()} — press Resume` : "stopped.", "");
      } else {
        say(
          `line ${result.failure.step.line}: ${result.failure.step.source}\n` +
            `  ${result.failure.error.message}` +
            (result.where ? `\n  standing in: ${result.where}` : "") +
            `\n  pointer left on line ${result.failure.step.line} — fix it and press Resume`,
          "bad",
        );
      }
    } else {
      setPointer(TOP, true);
      say(`finished — ${ms(result.total.ms)}, ${result.total.frames} engine frames`, "good");
    }
  } catch (e) {
    if (e instanceof Aborted) say(paused ? `paused at ${where()}` : "stopped.", "");
    else say((e as Error).message, "bad");
  } finally {
    running = null;
    stopClock();
    setButtons(false);
    remark();
  }
}

/** how many actions on this step's line come before it */
function countBefore(all: Step[], step: Step): number {
  const i = all.indexOf(step);
  let n = 0;
  for (let k = 0; k < i; k++) if (all[k].line === step.line) n++;
  return n;
}

/**
 * A one-off sheet run beside the user's — a checkpoint's `load()`, the boot.
 *
 * Deliberately does not touch the pointer. What it plays is not part of the
 * sheet being written, so it has no place in it; the pointer is moved by the
 * caller, to the line the load actually corresponds to.
 */
async function playAside(steps: Step[], label: string): Promise<void> {
  const canvas = document.getElementById("screen") as HTMLCanvasElement | null;
  if (!canvas) return say("no #screen canvas on this page", "bad");
  running = new AbortController();
  setButtons(true);
  const d = pageDriver({
    win: window,
    canvas,
    signal: running.signal,
    sheet: () => active,
    beforeRestart: () => keepPlace(true),
  });
  try {
    const result = await runSheet(d, steps, { onStep: (s) => say(`${label}: ${s.source}`) });
    const said = result.timings.flatMap((t) => t.says).join(" · ");
    if (result.failure) say(`${label}: ${result.failure.error.message}`, "bad");
    else say(`${label}${said ? ` — ${said}` : ""}`, "good");
  } catch (e) {
    if (!(e instanceof Aborted)) say((e as Error).message, "bad");
  } finally {
    running = null;
    stopClock();
    setButtons(false);
    remark();
  }
}

/**
 * Empty the sheet — and let it be taken back.
 *
 * Undo rather than a confirm, because the two cases pull opposite ways: the box
 * usually holds something pasted a moment ago that is already wrong, where a
 * confirm is a nag, and occasionally twenty minutes of tuning, where losing it
 * to a stray click is a real cost. Stashing the text and offering it back for
 * one click gets both. The offer lapses as soon as anything else is typed, since
 * by then "undo" would mean discarding the NEW text.
 */
let cleared: string | null = null;

function setCleared(text: string | null): void {
  cleared = text;
  clearBtn.textContent = text === null ? "Clear" : "Undo clear";
}

clearBtn.addEventListener("click", () => {
  if (cleared !== null) {
    const back = cleared;
    setCleared(null);
    sheetEl.value = back;
    editor.refresh();
    saveActive();
    parse();
    return;
  }
  if (!sheetEl.value.trim()) return;
  setCleared(sheetEl.value);
  sheetEl.value = "";
  editor.refresh();
  saveActive();
  setPointer(TOP);
  splitsEl.textContent = "";
  say("cleared — press Undo clear to put it back");
  sheetEl.focus();
});

playBtn.addEventListener("click", () => void playSheet());
stepBtn.addEventListener("click", () => void stepSheet());
pauseBtn.addEventListener("click", () => {
  paused = true;
  // Only a verb that merely WATCHES may be cut off where it stands; anything
  // that has already pressed a key has to be allowed to finish, or Resume does
  // it a second time. See `pauseWanted`.
  if (inStep === null || interruptible(inStep)) {
    pauseWanted = false;
    running?.abort();
    return;
  }
  pauseWanted = true;
  say(`pausing — letting ${inStep}() finish first`);
});
/**
 * Stop: abort, WAIT for the abort to land, and only then go back to the top.
 *
 * The order is the bug this had. Abort is a request the run notices at its next
 * wait, so an action already in flight can still complete and fire `onDone`
 * AFTER the click — and `onDone` advances the pointer. Setting the top first
 * therefore set it to line 1 and then watched the dying run move it to 138.
 */
stopBtn.addEventListener("click", () => void stopAll());

async function stopAll(): Promise<void> {
  paused = false;
  pauseWanted = false;
  inStep = null;
  stopping = true;
  await stopRun();
  stopping = false;
  setPointer(TOP, true);
  setButtons(false);
  say("stopped — pointer back at the top");
}
checkBtn.addEventListener("click", () => parse());

/* ------------------------------------------------------------------ *
 * Record mode
 * ------------------------------------------------------------------ */

/**
 * WHERE THE NEXT RECORDED ACTION GOES — ours, not the browser's.
 *
 * The caret cannot be used for this and the reason is not subtle: recording
 * means clicking on the game, clicking on the game blurs the textarea, and a
 * blurred textarea has no caret. What `selectionStart` reports after that is up
 * to the browser, and relying on it is how continuous recording ended up putting
 * every gesture in the same place.
 *
 * So the offset is held here and advanced by exactly what was inserted. It is
 * ADOPTED from the caret whenever the user actually touches the editor — a
 * click, a focus, a keystroke, a selection — which is the only time the caret is
 * the better answer, and is what makes "put the cursor there and record into it"
 * still work.
 *
 * `null` means nothing has been chosen, and the end of the sheet is used: an
 * untouched box reports `selectionStart` 0, which is a real answer and the wrong
 * one — arming record and finding the first gesture wedged above the header of a
 * 500-line sheet is nobody's intention.
 */
let insertAt: number | null = null;
/** set while WE are writing, so our own `input` event is not read as the user's */
let writing = false;

const lineAt = (offset: number): number => sheetEl.value.slice(0, offset).split("\n").length;

/** take the caret's word for it — the user just put it somewhere */
function adoptCaret(): void {
  if (writing) return;
  insertAt = sheetEl.selectionStart;
  if (recorder.on) editor.markRecord(lineAt(insertAt));
}
for (const ev of ["focus", "click", "keyup", "select", "input"]) {
  sheetEl.addEventListener(ev, adoptCaret);
}

/**
 * Write one action into the sheet, one per line.
 *
 * Through `setRangeText` rather than by rebuilding `value`, because that is the
 * one insertion the browser folds into the textarea's own undo stack — a
 * recording that could not be Ctrl-Z'd would be worse than no recording, since
 * the whole point is to play loosely and tidy up after.
 *
 * Inserted rather than replacing: `setRangeText` is given a collapsed range even
 * when the user has a selection, because a recording that ate the selected lines
 * on the first gesture would be a surprising way to lose work.
 *
 * The newline handling is what makes a session read as a list. Writing at a line
 * start leaves the offset at the start of the next line, so the next gesture
 * lands under this one; mid-line, a break goes in first rather than jamming an
 * action into the middle of something already written.
 */
function record(line: string): void {
  const at = insertAt ?? sheetEl.value.length;
  const fresh = at === 0 || sheetEl.value.slice(0, at).endsWith("\n");
  const text = `${fresh ? "" : "\n"}${line}\n`;

  writing = true;
  sheetEl.setRangeText(text, at, at, "end");
  writing = false;

  insertAt = at + text.length;
  sheetEl.dispatchEvent(new Event("input", { bubbles: true }));
  editor.markRecord(lineAt(insertAt));
  editor.reveal(lineAt(insertAt));
}

const recorder = attachRecorder({
  win: window,
  canvas: document.getElementById("screen") as HTMLCanvasElement,
  write: record,
});

// What the run is pressing, drawn in the corner of the screen. Not switchable:
// it costs nothing when nothing is pressed, and a run you cannot see the input
// of is the thing this page exists to avoid. Watches the same events the
// recorder does and answers `isTrusted` the other way round — see the module.
attachInputMonitor({
  win: window,
  canvas: document.getElementById("screen") as HTMLCanvasElement,
  mount: document.getElementById("inputs") as HTMLDivElement,
});

// Which of the two panels comes first, dragged by its heading and remembered.
// Installed early, before anything is drawn into either of them: the sections
// are MOVED, and moving one after the fact would be a visible jump.
installColumnOrder();

function setRecording(on: boolean): void {
  recorder.set(on);
  recBtn.classList.toggle("on", on);
  // the dot does not change — a record button is a red dot whether or not it is
  // recording, and `.on` is what says which
  recBtn.setAttribute("aria-label", on ? "Stop recording" : "Record");
  recBtn.title = on
    ? "every key and click you make at the game is written into the sheet where the red band is — click to stop"
    : "write what you do at the game into the sheet, one action per line";
  if (!on) {
    editor.markRecord(null);
    say("recording off");
    return;
  }
  // The band replaces the caret, which is about to become invisible: the first
  // click at the game blurs the editor and takes the caret with it.
  const at = insertAt ?? sheetEl.value.length;
  insertAt = at;
  editor.markRecord(lineAt(at));
  editor.reveal(lineAt(at));
  say(`recording into line ${lineAt(at)} — the red band is where the next action lands`);
}

recBtn.addEventListener("click", () => setRecording(!recorder.on));

/* ------------------------------------------------------------------ *
 * Sheets
 * ------------------------------------------------------------------ */

/**
 * The user's own sheets, by name.
 *
 * A speedrun is not one file. A route is tried three ways, a leg is pulled out
 * to be worked on alone, the repository's sheet is kept as a reference while
 * something else is written next to it — and until now the box held exactly one
 * text, so every one of those meant destroying the last. They live in
 * localStorage because that is what this page has; they are small, and a browser
 * gives an origin megabytes.
 */
const SHEETS_KEY = "taoot:speedrun:sheets";
const ACTIVE_KEY = "taoot:speedrun:active";
/** what the single-sheet workbench used, migrated on first load */
const LEGACY_KEY = "taoot:speedrun:sheet";

type Sheets = Record<string, string>;

function readSheets(): Sheets {
  try {
    const raw = JSON.parse(localStorage.getItem(SHEETS_KEY) ?? "{}");
    return raw && typeof raw === "object" ? (raw as Sheets) : {};
  } catch {
    return {};
  }
}

const writeSheets = (s: Sheets): void => localStorage.setItem(SHEETS_KEY, JSON.stringify(s));

let active = localStorage.getItem(ACTIVE_KEY) ?? "";

/** save what is in the box into the active sheet */
function saveActive(): void {
  if (!active) return;
  const sheets = readSheets();
  sheets[active] = sheetEl.value;
  writeSheets(sheets);
}

/** a name nothing else is using */
function freeName(base: string): string {
  const sheets = readSheets();
  if (!sheets[base]) return base;
  for (let n = 2; ; n++) if (!sheets[`${base} ${n}`]) return `${base} ${n}`;
}

/**
 * Put a sheet in the box and make it the active one.
 *
 * The pointer goes back to the top, always. It names a line, and a different
 * sheet's line 233 is a different action — carrying a pointer across would be
 * the one thing this design is built to prevent, a resume into a game that was
 * never brought there.
 */
function openSheet(name: string): void {
  const sheets = readSheets();
  if (sheets[name] === undefined) return;
  saveActive();
  active = name;
  localStorage.setItem(ACTIVE_KEY, name);
  sheetEl.value = sheets[name];
  editor.refresh();
  setPointer(TOP);
  setButtons(!!running);
  splitsEl.textContent = "";
  renderSheets();
  remark(); // a different sheet has different checkpoints
  parse();
}

function addSheet(name: string, text: string): void {
  const sheets = readSheets();
  sheets[name] = text;
  writeSheets(sheets);
  openSheet(name);
}

/**
 * Rename a sheet, keeping whatever is in the box.
 *
 * The route is the thing worth having here — a sheet accumulates hours of
 * tuning — and until this existed the only way to fix a name typed into the
 * `+ New` prompt was to make a second sheet, copy the text across by hand and
 * delete the first. Three steps, one of them a `confirm()` warning that the
 * route cannot be got back.
 *
 * The sheet's CHECKPOINTS come with it. They are keyed by sheet as well as by
 * point (page-driver's `saveKey`), so a rename that moved only the text would
 * leave every one of them stranded under a sheet that no longer exists —
 * invisible, unreachable, and still taking up the storage.
 */
function renameSheet(from: string): void {
  const to = (prompt(`Rename the sheet "${from}" to?`, from) ?? "").trim();
  if (!to || to === from) return;
  const sheets = readSheets();
  if (sheets[to] !== undefined) return say(`there is already a sheet called "${to}"`, "bad");
  // the box may be ahead of what was last written, so take the live text for the
  // sheet being renamed rather than the stored copy
  if (from === active) saveActive();
  sheets[to] = readSheets()[from] ?? "";
  delete sheets[from];
  writeSheets(sheets);
  moveCheckpoints(from, to);
  if (from === active) {
    active = to;
    try {
      localStorage.setItem(ACTIVE_KEY, to);
    } catch {
      /* not remembering which sheet was open is survivable */
    }
  }
  renderSheets();
  say(`renamed "${from}" to "${to}"`);
}

/**
 * Re-key a sheet's checkpoints, or throw them away when `to` is null.
 *
 * Done by hand over `localStorage` rather than by reading and rewriting each
 * save: the values are 40 kB of base64 apiece and there is nothing to change
 * inside them — only the name they hang under.
 */
function moveCheckpoints(from: string, to: string | null): void {
  const moving: { name: string; value: string }[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    const point = parseSaveKey(key ?? "");
    if (!point || point.sheet !== from) continue;
    moving.push({ name: point.name, value: localStorage.getItem(key!) ?? "" });
  }
  for (const { name, value } of moving) {
    localStorage.removeItem(saveKey(from, name));
    if (to !== null) localStorage.setItem(saveKey(to, name), value);
  }
}

/**
 * The load points written before checkpoints belonged to a sheet.
 *
 * Their key was the prefix and the point's name and nothing else, so they are
 * the keys `parseSaveKey` cannot take apart — no ":" in them. Each one is given
 * to the first sheet (by name) whose text actually writes it, which is the sheet
 * that made it in every case that matters; one nothing claims goes to whatever
 * sheet is open, because deleting somebody's hour-long leg to tidy up a key
 * shape is not a trade this gets to make.
 *
 * Runs once, at load, before anything reads a checkpoint.
 */
function migrateUnscopedCheckpoints(): void {
  const old: { name: string; value: string }[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key?.startsWith(SAVE_PREFIX) || parseSaveKey(key)) continue;
    old.push({ name: key.slice(SAVE_PREFIX.length), value: localStorage.getItem(key) ?? "" });
  }
  if (!old.length) return;
  const sheets = readSheets();
  const names = Object.keys(sheets).sort();
  for (const { name, value } of old) {
    const writes = new RegExp(`\\bsave\\s*\\(\\s*${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\)`, "i");
    const owner = names.find((n) => writes.test(sheets[n] ?? "")) ?? active;
    localStorage.setItem(saveKey(owner, name), value);
    localStorage.removeItem(SAVE_PREFIX + name);
  }
}

function renderSheets(): void {
  sheetsEl.textContent = "";
  const label = document.createElement("span");
  label.className = "sep";
  label.textContent = "sheets";
  sheetsEl.append(label);

  for (const name of Object.keys(readSheets()).sort()) {
    const chip = document.createElement("span");
    chip.className = `chip${name === active ? " on" : ""}`;

    const open = document.createElement("button");
    open.type = "button";
    open.textContent = name;
    open.title = name === active ? "the sheet in the box" : `open ${name}`;
    open.addEventListener("click", () => openSheet(name));

    // Rename lives on the OPEN sheet only. Every chip could carry one, but the
    // row is chips already and a third button on each is a lot of furniture for
    // something done once a sheet: the one you are looking at is the one you
    // have just noticed the name of.
    const rename = document.createElement("button");
    rename.type = "button";
    rename.className = "rename";
    rename.textContent = "✎";
    rename.title = `rename the sheet "${name}"`;
    rename.setAttribute("aria-label", `rename ${name}`);
    rename.addEventListener("click", () => renameSheet(name));

    const drop = document.createElement("button");
    drop.type = "button";
    drop.className = "drop";
    drop.textContent = "✕";
    drop.title = `delete the sheet "${name}"`;
    drop.setAttribute("aria-label", `delete ${name}`);
    // A confirm here and none on a checkpoint, and the difference is what is
    // lost: a checkpoint is a cached replay that running the leg again rebuilds,
    // and a sheet is the route itself, which nothing rebuilds.
    drop.addEventListener("click", () => {
      if (!confirm(`Delete the sheet "${name}"? The route in it cannot be got back.`)) return;
      const sheets = readSheets();
      delete sheets[name];
      writeSheets(sheets);
      // and its load points, which belong to it and to nothing else — left
      // behind they would be storage nobody can see, let alone clear
      moveCheckpoints(name, null);
      if (name === active) {
        const left = Object.keys(sheets).sort()[0];
        if (left) openSheet(left);
        else addSheet(freeName("new sheet"), "");
      } else renderSheets();
      say(`deleted the sheet "${name}"`);
    });

    chip.append(open, ...(name === active ? [rename] : []), drop);
    sheetsEl.append(chip);
  }

  const add = document.createElement("button");
  add.type = "button";
  add.textContent = "+ New";
  add.title = "start an empty sheet";
  add.addEventListener("click", () => {
    const name = (prompt("Name for the new sheet?", freeName("new sheet")) ?? "").trim();
    if (!name) return;
    if (readSheets()[name] !== undefined) return say(`there is already a sheet called "${name}"`, "bad");
    addSheet(name, "");
    sheetEl.focus();
  });
  sheetsEl.append(add);

  if (repoSheet !== null) {
    const copy = document.createElement("button");
    copy.type = "button";
    copy.className = "full";
    copy.textContent = "Copy the full run";
    copy.title = "a copy of tests/speedrun/run.sheet.txt, as a sheet of your own";
    copy.addEventListener("click", () => {
      const name = freeName("full run");
      addSheet(name, repoSheet!);
      say(`copied the repository's sheet into "${name}"`, "good");
    });
    sheetsEl.append(copy);
  }
}

/* ------------------------------------------------------------------ *
 * Reset, and surviving the reload it costs
 * ------------------------------------------------------------------ */

/**
 * Where the run was when the page went away.
 *
 * `reset()` is a document reload, so in this host it does not return: the run
 * loop, the driver and the pointer all go with it. What comes back is a fresh
 * page, and the only way it can know it is the middle of something is to have
 * been told before the reload — which is what `beforeRestart` is for.
 *
 * Stamped with a time and honoured only for a minute. A flag that outlived its
 * moment would make the page run itself on some later visit, which is the one
 * behaviour a workbench must never have: you open it to look at a sheet and it
 * starts playing the game.
 */
const RESUME_KEY = "taoot:speedrun:resume";
const RESUME_WINDOW_MS = 60_000;

interface Resume {
  sheet: string;
  line: number;
  skip: number;
  /** press Play on the other side, or just put the pointer there */
  play: boolean;
  at: number;
}

function keepPlace(play: boolean): void {
  saveActive();
  const it: Resume = { sheet: active, line: pointer.line, skip: pointer.skip, play, at: Date.now() };
  localStorage.setItem(RESUME_KEY, JSON.stringify(it));
}

function takePlace(): Resume | null {
  const raw = localStorage.getItem(RESUME_KEY);
  localStorage.removeItem(RESUME_KEY);
  if (!raw) return null;
  try {
    const it = JSON.parse(raw) as Resume;
    if (typeof it?.line !== "number" || Date.now() - it.at > RESUME_WINDOW_MS) return null;
    return it;
  } catch {
    return null;
  }
}

/**
 * The reset chip: the beginning, as a checkpoint.
 *
 * It sits with the checkpoints because it is one — the earliest state there is,
 * and the only one that needs no `save()` to exist. It closes the gap Stop left:
 * Stop puts the POINTER back to the top while the game stays wherever the run
 * abandoned it, so pressing Play then replayed the boot against a game already
 * halfway across the Atlantic. Reset moves both, which is the rule every jump on
 * this page follows.
 */
function resetChip(): HTMLSpanElement {
  const chip = document.createElement("span");
  chip.className = "chip reset";
  const go = document.createElement("button");
  go.type = "button";
  go.textContent = "reset";
  go.title = "reload the page for a cold boot, and put the pointer back at the top";
  go.addEventListener("click", () => void resetGame());
  chip.append(go);
  return chip;
}

async function resetGame(): Promise<void> {
  await stopRun();
  pointer = TOP;
  // written before the reload, because after it there is nobody left to write it
  keepPlace(false);
  say("reloading for a cold boot…");
  location.reload();
}

/* ------------------------------------------------------------------ *
 * Checkpoints
 * ------------------------------------------------------------------ */

/** repaint the checkpoints — a `save()` that just ran has made a new one */
let remark = (): void => {};

/**
 * Every load point this browser is holding, whatever it is called.
 *
 * By the PREFIX and not by a `m\d+p\d+` pattern, because `save()` takes any
 * name and a point called `scratch` is no less stale than one called `m1p1`.
 * The prefix is the boundary that matters: it belongs to the speedrun and to
 * nothing else, so sweeping it cannot reach the game's own saved games.
 */
/**
 * The checkpoints that exist, in the order the RUN reaches them.
 *
 * Alphabetical was the wrong axis. A checkpoint is a place in the route, and the
 * names are route names, so sorting them as words puts them in an order that
 * LOOKS like a sequence and is not one: `m1p1cig`, `m1p1penny`, `m1p1switchrub`
 * and `m1p1turb` come out in an order the run never takes, and `m2p0` sorts
 * ahead of `m1p1turb` the moment a name drops a digit. localStorage's own
 * enumeration is no better — that is the order the legs happened to be RUN in,
 * so it changes under you as you work.
 *
 * The sheet already knows the answer: the position of the checkpoint's own
 * `save()` line, which is where {@link pointerForCheckpoint} sends the pointer.
 * Same source, so a chip's place in the row and the line it jumps to can never
 * disagree.
 *
 * A checkpoint whose `save()` is no longer in the sheet has no position — the
 * sheet was edited out from under it — so those go last, in name order, where
 * they read as the leftovers they are rather than as part of the route.
 *
 * Only the ACTIVE sheet's, because a checkpoint belongs to one (see
 * page-driver's `saveKey`). Before that was true this listed every point in the
 * browser, so opening a second route showed the first one's chips — and pressing
 * one restored a game the open sheet had no line for.
 */
function savedPoints(): string[] {
  const out: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const point = parseSaveKey(localStorage.key(i) ?? "");
    if (point && point.sheet === active) out.push(point.name);
  }
  const order = saveOrder();
  const rank = (n: string): number => order.get(n.toLowerCase()) ?? Infinity;
  return out.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

/**
 * Every `save(name)` in the sheet, by lowercased name, in the order the run
 * reaches them.
 *
 * Read out of the parse rather than by scanning for the word, for the reason
 * {@link pointerForCheckpoint} gives: `a(); save(x); b()` is one line and three
 * actions. An unparseable sheet answers nothing rather than guessing — every
 * name then ranks equal and the row falls back to name order, which is what it
 * did before this existed.
 */
function saveOrder(): Map<string, number> {
  const out = new Map<string, number>();
  let steps: Step[];
  try {
    steps = parseSheet(sheetEl.value, { verbs: VERBS });
  } catch {
    return out;
  }
  for (const step of steps) {
    if (step.verb !== "save") continue;
    const name = step.args[0]?.toLowerCase();
    if (name && !out.has(name)) out.set(name, out.size);
  }
  return out;
}

/**
 * The line a checkpoint belongs to: the one after its own `save()`.
 *
 * Found in the text every time rather than recorded in the savegame, and that is
 * the right way round — a `.ti` is a snapshot of a game, and which line wrote it
 * is a property of the sheet, which is edited constantly. Read out of the parse
 * rather than by scanning lines, so a `save()` written inside `a(); save(x); b()`
 * lands the pointer on `b()` and not on the line after.
 */
function pointerForCheckpoint(name: string): Pointer | null {
  let steps: Step[];
  try {
    steps = parseSheet(sheetEl.value, { verbs: VERBS });
  } catch {
    return null;
  }
  const at = steps.findIndex(
    (s) => s.verb === "save" && s.args[0]?.toLowerCase() === name.toLowerCase(),
  );
  if (at < 0) return null;
  return pointerAfter(steps, steps[at]);
}

/**
 * Getting the game to the point where a savegame can be restored INTO it.
 *
 * A load applies the file's prop records to the props the boot opened; before
 * `openshop` there are none, and all 72 records are dropped without a word — the
 * room is right, the standpoint is right, and the inventory band is empty. The
 * chips are on screen the moment the canvas lights up, which is a good ten
 * seconds before that is true, so pressing one on a fresh page has to mean "get
 * there", not "fail accurately".
 *
 * Written as sheet lines rather than as page code because it IS the boot, and
 * the sheet already spells it: press past the logos, answer the title menu's
 * GAME region, then let the date card go. `load()` refuses if this did not work,
 * so nothing here has to check.
 */
const START_A_GAME = [
  "intro()",
  "skipMovie(until: awaiting, budget: 90000)",
  "clickAt(266, 254)",
  "skipMovie(until: quiet, budget: 90000)",
].join("\n");

const bootReady = (): boolean => {
  const w = window as unknown as { dbg?: { session?: { propRuntime?: { props?: Map<string, unknown> } } } };
  return (w.dbg?.session?.propRuntime?.props?.size ?? 0) > 0;
};

/**
 * Take the run to a checkpoint: stop, restore the game, move the pointer.
 *
 * The two halves are one gesture on purpose. A checkpoint is a game state AND a
 * place in the route, and setting either without the other gives you a run that
 * looks right and is not — the game standing somewhere the pointer does not
 * name. This is the only thing on the page that moves both, which is why it is
 * the only jump the design allows.
 */
async function jump(name: string): Promise<void> {
  await stopRun();
  const at = pointerForCheckpoint(name);
  const prelude = bootReady() ? "" : `${START_A_GAME}\n`;
  if (prelude) say("starting a game first — a load needs the boot's prop shops open");
  await playAside(parseSheet(`${prelude}load(${name})`, { verbs: VERBS }), `jumped to ${name}`);
  if (at) {
    setPointer(at, true);
    setButtons(!!running);
    say(`${statusEl.textContent}\n  pointer moved to line ${at.line} — press Resume`);
  } else {
    say(
      `${statusEl.textContent}\n  no save(${name}) line in this sheet, so the pointer has not moved`,
    );
  }
}

/**
 * One stop on the timeline: the chip, plus the line and the node that put it on
 * one.
 *
 * A wrapper rather than styling the chip itself, for a mechanical reason — the
 * chip is `overflow: hidden` so its two halves keep the rounded corners, and the
 * connector and the node have to be drawn OUTSIDE it, where that clips them.
 * The wrapper carries both as pseudo-elements and the chip inside it is
 * untouched, so what a milestone does when you press it is exactly what a chip
 * did.
 *
 * The line is drawn per node and leads to the LEFT, which is what makes the row
 * survive wrapping: a single rule behind the whole row would be right for one
 * line of chips and cut across empty space on the second.
 */
function milestone(chip: HTMLElement, extra = ""): HTMLSpanElement {
  const stop = document.createElement("span");
  // `origin` is set rather than left to `:first-of-type`, which does not mean
  // what it looks like here: the row's first <span> is the "checkpoints" label,
  // so the selector matched that and no milestone was ever the first of its type
  stop.className = extra ? `ms ${extra}` : "ms";
  stop.append(chip);
  return stop;
}

function checkpoints(): { el: HTMLDivElement; refresh(): void } {
  const el = document.createElement("div");
  el.className = "sr-points";

  const refresh = (): void => {
    const points = savedPoints();
    el.textContent = "";

    const label = document.createElement("span");
    label.className = "sep";
    label.textContent = "checkpoints";
    label.title = "written by save(), read by load(); the game's own saved games are elsewhere";
    el.append(label, milestone(resetChip(), "origin"));

    for (const name of points) {
      const chip = document.createElement("span");
      chip.className = "chip";

      const go = document.createElement("button");
      go.type = "button";
      go.textContent = name;
      go.title = `restore ${name} and move the pointer to the line after its save()`;
      go.addEventListener("click", () => void jump(name));

      const drop = document.createElement("button");
      drop.type = "button";
      drop.className = "drop";
      drop.textContent = "✕";
      drop.title = `forget ${name}`;
      drop.setAttribute("aria-label", `forget ${name}`);
      drop.addEventListener("click", () => {
        localStorage.removeItem(saveKey(active, name));
        remark();
        say(`forgot ${name} — the legs that start from it need running again`);
      });

      chip.append(go, drop);
      el.append(milestone(chip));
    }

    if (points.length) {
      const all = document.createElement("button");
      all.type = "button";
      all.className = "points";
      all.textContent = `Clear all ${points.length}`;
      all.title = `delete every checkpoint (${points.join(", ")}) — the game's saved games are not touched`;
      all.addEventListener("click", () => {
        for (const name of points) localStorage.removeItem(saveKey(active, name));
        remark();
        say(
          `cleared ${points.length} checkpoint${points.length === 1 ? "" : "s"}: ${points.join(", ")} — ` +
            `the legs that start from one need running again`,
        );
      });
      el.append(all);
    }
  };

  refresh();
  return { el, refresh };
}

/* ------------------------------------------------------------------ *
 * Warming the cache
 * ------------------------------------------------------------------ */

/**
 * "Warm cache": fetch the whole English tree once so the run that follows is
 * timed against the browser's cache rather than against the network (#147).
 *
 * The workbench is where this matters most and where it is least defensible
 * anywhere else — 1.2 GB fetched on purpose, for a page nobody arrives at by
 * accident. A player gets the file when the room needs it, which is right for
 * playing; a route gets run fifty times, and the first of those fifty is the one
 * where a 34 MB set lands in the middle of a walk and the leg looks broken.
 *
 * ENGLISH, ALWAYS — the same `<meta name="edition">` the page pins the game to
 * (src/main.ts pinnedEdition), read here rather than shared because the two want
 * different things from it and neither should have to know the other asked. A
 * route is a sequence of clicks in one tree's data; warming a second tree would
 * be a gigabyte fetched for a game this page will not boot.
 *
 * The edition's own files plus the edition-NEUTRAL ones, which is not a detail:
 * `lang.stg` and `nightdive.mov` sit outside every tree and the boot reads both
 * (src/files.ts NEUTRAL).
 */
const warmEdition = (): string =>
  document.querySelector('meta[name="edition"]')?.getAttribute("content")?.toLowerCase() ?? "en";

function showWarm(p: {
  bytes: number;
  total: number;
  done: number;
  files: number;
  failed: number;
  rate: number;
}): void {
  warmBar.hidden = false;
  warmFill.style.width = `${p.total ? Math.round((p.bytes / p.total) * 100) : 0}%`;
  const left = p.files - p.done;
  const eta = p.rate > 0 && p.bytes < p.total ? formatEta((p.total - p.bytes) / p.rate) : "";
  warmNum.textContent = [
    `${formatBytes(p.bytes)} / ${formatBytes(p.total)}`,
    formatRate(p.rate),
    eta,
    left ? `${left} file${left === 1 ? "" : "s"} left` : "",
    p.failed ? `${p.failed} missing` : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

async function warmup(): Promise<void> {
  // A second press is Stop. The button is the same button because the thing it
  // controls is the same thing — and a warmup somebody stops is finished, not
  // failed: what came down stays in the cache.
  if (warming) {
    warming.abort();
    return;
  }
  const edition = warmEdition();
  const sizes = await gamefileSizes();
  const files = warmupList(
    sizes,
    (path) => {
      const e = editionOfUrl(path);
      return e === edition || e === NEUTRAL;
    },
    siteUrl,
  );
  if (!files.length) {
    // No manifest, or a manifest with no such tree in it. Both are real — a
    // deployment regenerates `gamefiles.json` against the data it actually
    // uploaded (tools/mkmanifest.ts) — and neither is worth a bar.
    say(`nothing to warm: no ${edition} files in the manifest`, "bad");
    return;
  }

  warming = new AbortController();
  warmBtn.classList.add("on");
  warmBtn.textContent = "Stop warming";
  setButtons(!!running);
  say(`warming ${files.length} files (${formatBytes(files.reduce((n, f) => n + f.bytes, 0))})…`);
  try {
    const end = await warmCache(files, { signal: warming.signal, onProgress: showWarm });
    showWarm(end);
    const what = `${formatBytes(end.bytes)} across ${end.done} files`;
    if (end.stopped) say(`warmup stopped — ${what} is cached and stays cached`);
    else if (end.failed) say(`warmed ${what}, ${end.failed} could not be fetched`, "bad");
    else say(`warmed ${what} — the run is not waiting on the network now`, "good");
  } finally {
    warming = null;
    warmBtn.classList.remove("on");
    warmBtn.textContent = "Warm cache";
    setButtons(!!running);
  }
}

warmBtn.addEventListener("click", () => void warmup());

/* ------------------------------------------------------------------ *
 * Boot
 * ------------------------------------------------------------------ */

/** the repository's sheet, offered as a starting point rather than as THE sheet */
let repoSheet: string | null = null;

async function start(): Promise<void> {
  /*
   * Published beside this page by the `run-sheet` plugin (vite.config.ts) — in
   * dev as middleware, in a build as an emitted asset, at the same path either
   * way.
   *
   * Through `siteUrl` and not as "/speedrun/…", which is the bug this line used
   * to have and the exact one src/site.ts exists to prevent: a leading slash is
   * a path off the HOST's root, so on a site served from a subdirectory it
   * asked danielhobi.ch/tests/… instead of danielhobi.ch/taoot/tests/…. In dev
   * the two roots are the same, so it worked everywhere it was tested and
   * nowhere it was deployed — and silently, because a missing sheet just means
   * no button.
   */
  try {
    const res = await fetch(siteUrl("speedrun/run.sheet.txt"));
    if (!res.ok) throw new Error(String(res.status));
    repoSheet = await res.text();
  } catch {
    repoSheet = null;
  }

  // Whatever the single-sheet workbench was holding becomes a sheet, so nobody
  // opens this page and finds their route gone.
  const sheets = readSheets();
  const legacy = localStorage.getItem(LEGACY_KEY);
  if (!Object.keys(sheets).length) {
    if (legacy && legacy.trim()) sheets["my sheet"] = legacy;
    else if (repoSheet) sheets["full run"] = repoSheet;
    else sheets["new sheet"] = "";
    writeSheets(sheets);
    localStorage.removeItem(LEGACY_KEY);
  }
  if (!sheets[active]) active = Object.keys(sheets).sort()[0];

  sheetEl.value = sheets[active] ?? "";
  editor.refresh();
  localStorage.setItem(ACTIVE_KEY, active);

  // after the sheets exist and `active` is settled — the migration needs both to
  // decide which sheet an old name-only load point belongs to
  migrateUnscopedCheckpoints();

  const points = checkpoints();
  pointsEl.append(points.el);
  remark = points.refresh;

  renderSheets();
  setPointer(TOP);
  setButtons(false);
  setRecording(false);
  parse();
  sheetsEl.hidden = false;
  pointsEl.hidden = false;

  // A `reset()` or the reset chip has just reloaded us. Put the pointer back
  // where it was, and carry on if the reload happened in the middle of a run —
  // from the page's point of view the reset is one action of a sheet that is
  // still going, and it should look like one.
  const back = takePlace();
  if (!back || back.sheet !== active) return;
  setPointer({ line: back.line, skip: back.skip }, true);
  setButtons(false);
  if (!back.play) {
    say(`cold boot — pointer at ${where()}`);
    return;
  }
  say("cold boot — picking the run back up…");
  // the game has to be up before a sheet can be played into it, and this page is
  // seconds old
  const ready = async (): Promise<void> => {
    for (let i = 0; i < 600 && !(window as unknown as { dbg?: unknown }).dbg; i++) {
      await new Promise((r) => setTimeout(r, 100));
    }
  };
  await ready();
  void playSheet();
}
void start();

// Every keystroke is saved into the active sheet. No Save button, because a
// workbench that can lose twenty minutes to a forgotten click is a workbench
// people stop trusting.
sheetEl.addEventListener("input", () => {
  saveActive();
  if (cleared !== null && sheetEl.value.trim()) setCleared(null);
  // The text under the pointer may not be the text that was there — but the
  // pointer names a LINE, so it stays valid through edits elsewhere in the
  // file, which is most of them. Nothing to do here but keep drawing it.
  editor.mark(pointer.line);
});
