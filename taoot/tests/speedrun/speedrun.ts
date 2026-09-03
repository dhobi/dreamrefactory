/**
 * The speedrun — one game, cold boot to credits, against the clock.
 *
 *   npm run dev
 *   npm run speedrun -w taoot                    # run the sheet, print the splits
 *   npm run speedrun:watch -w taoot              # a real window, same run, watchable
 *   npm run speedrun:lint -w taoot               # parse the sheet and say nothing else
 *   npm run speedrun -w taoot -- --verbs         # what a sheet may contain
 *   npm run speedrun -w taoot -- --from="m4p0 cabin"   # enter at one of its save points
 *   SHEET=taoot/tests/speedrun/any.sheet npm run speedrun -w taoot
 *
 * This is NOT a test and does not gate anything. `npm run test:browser:playthrough -w taoot`
 * is still the browser gate and `npm run test:playthrough` is still the oracle;
 * both are untouched by everything in this directory, goldens included. What this
 * does is play the game as fast as a human legally can and say how long it took.
 *
 * ## What "human-legal" costs, and why it is worth it
 *
 * Every gesture is a real Playwright mouse or keyboard event at the canvas. The
 * engine is never written to, `framerate()` is never touched, no fade is
 * collapsed, no event is dispatched page-side. So the floor is the game's own:
 * movies play until ESC reaches them, walks play their frames, spoken lines take
 * as long as they take. A run is therefore something a person could in principle
 * do, and watching it in `--headed` shows exactly the run the number describes.
 *
 * The one deliberate concession is the SEED. `session.seedRandom` is called once
 * before the boot, exactly as the playthrough suites do it, because the
 * smokestack draws its maze from that stream (`mazenumber = random(4)`) and one
 * of the four mazes has a dead-end entry. An unseeded run is a different course
 * every time and its times cannot be compared to each other. `--noseed` runs wild
 * for anyone who wants that; the report says which it was.
 *
 * ## Reading the report
 *
 * Two clocks, and the difference between them is the point:
 *
 *   - **time** is the speedrun. It is what a stopwatch says, less what the run
 *     spent downloading the game (see **load** below), and it still moves with
 *     machine load — so a 3 % gain is not distinguishable from a quiet afternoon.
 *   - **frames** is `session.frameCounter`, the engine's own displayed-frame
 *     count. It is reproducible and immune to load, and it is what actually goes
 *     down when a route gets better.
 *
 * Tune against frames. Brag about seconds.
 *
 * **load** is the third column, and only appears when there was something to
 * report ([#251](https://github.com/dhobi/dreamrefactory/issues/251)). It is how
 * long the leg spent waiting on a DOWNLOAD, and it has already been taken OUT of
 * the time beside it — a load remover, the same device a PC speedrun uses so
 * that an SSD is not a route improvement.
 *
 * Only a download counts ([#369](https://github.com/dhobi/dreamrefactory/issues/369)):
 * a cache hit, and any fetch off a server on this machine, is a disk read of the
 * kind the original did off its CD, and the original's clock counted those. So
 * against a dev server this column is **empty and `time` is the wall clock** —
 * there was no link in the way to take out. It fills in against the deployed
 * page, where the rip really does arrive over one. `time + load` is the wall
 * clock either way, to the millisecond.
 *
 * A fetch nobody is waiting for is not loading either: the engine's own misses
 * (`FileStore.provide`) are answered "not yet" and the game carries on, so the
 * run is progressing while they land. Only the fetches the game is STOPPED for
 * come out of the clock.
 *
 * Three things are called out under the splits because they are where the time
 * hides: the slowest actions, every `after:` pad (dead time bought with a guess
 * rather than a condition), and every `travel` still in the sheet (the planner,
 * which aims for reachable rather than shortest).
 */
import { chromium, type Browser, type Page } from "playwright";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { parseSheet, describeSheet, type Step } from "@dreamfactory/engine/web/speedrun/sheet";
import { ACTIONS, VERBS, setPlanner } from "../../src/speedrun/actions";
import { speedrunDriver } from "./driver";
import { runSheet, type Split, type Timing } from "@dreamfactory/engine/web/speedrun/runner";
import { playwrightPlanner } from "./planner";
import { playUrl } from "../browser/driver";
import { DEFAULT_LANGUAGE } from "../../src/languages";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");

const argv = process.argv.slice(2);
const flag = (name: string) => argv.includes(`--${name}`);
const HEADED = flag("headed") || (!!process.env.HEADED && process.env.HEADED !== "0");
/**
 * Slow motion is a debugging aid and the enemy of the thing being measured, so
 * it is off unless asked for — including in `--headed`, where the browser suite
 * defaults it to 250 ms. A watched speedrun should be the speedrun.
 */
const SLOWMO = Number(process.env.SLOWMO ?? 0);
/**
 * Unseeded by default: every run is a fresh course, the way a real attempt is.
 *
 * The playthrough suites pin 19120415 because they diff against a golden and a
 * trace is only comparable per-seed. A speedrun compares nothing, and pinning
 * would quietly turn two of the game's own dice into constants — the raid's fuse
 * (`makeloop(... random(100))`, 0 to 100 engine steps of dead wait) and the
 * smokestack's `mazenumber = random(4)`. Freezing those makes a time that no
 * unseeded run could match.
 *
 * So the dice are live, the maze is solved rather than known (`climbStack`), and
 * a fuse is however long it is. `SEED=<n>` or `--seed=<n>` pins one anyway, for
 * comparing two routes against each other rather than against the clock.
 */
const seedArg = argv.find((a) => a.startsWith("--seed="))?.split("=")[1] ?? process.env.SEED;
const SEED = seedArg ? Number(seedArg) : null;
const SHEET = process.env.SHEET ?? join(HERE, "run.sheet.txt");
/**
 * `--from="m4p0 cabin"` — run the sheet from one of its own `save()` points.
 *
 * The sheet is not edited and no second sheet is kept: the route stays the one
 * file, and this only changes where the run is entered. Everything up to and
 * including that `save(...)` is dropped, a four-line boot is put in front, and
 * `load()` restores the checkpoint the dropped half would have produced.
 *
 * WHY THE BOOT LINES ARE NOT OPTIONAL. `restoreProps` applies a record only to a
 * prop that already exists — the shops belong to the game, not to the save file
 * — so a load into a page that has not clicked GAME on the title menu drops all
 * 72 records without a word and arrives in the right room carrying nothing.
 * `load()` guards against exactly that and names this gesture in its error; the
 * preamble is that error's advice, written down once.
 *
 * The point is the edit loop. A failure in mission 4 costs seven minutes to
 * reach from a cold boot and about fifty seconds from here, and the checkpoint
 * is written by the same run that would otherwise have to be replayed — so the
 * fast path is always as current as the last full attempt.
 */
const FROM = argv.find((a) => a.startsWith("--from="))?.split("=").slice(1).join("=") ?? process.env.FROM;

const ms = (n: number): string => {
  const s = n / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  return `${m}:${(s - m * 60).toFixed(1).padStart(4, "0")}`;
};

/**
 * The sheet re-entered at one of its `save()` points, for `--from`.
 *
 * Built out of the sheet's own steps rather than a second file, so a leg cannot
 * drift from the route it belongs to: whatever `run.sheet.txt` says today is
 * what this runs, minus its first half.
 *
 * The preamble is parsed rather than hand-built so it is checked by the same
 * grammar as everything else — a typo here should be a sheet error, not a
 * mystery at run time. `reset()` is deliberately absent: the page is fresh
 * (Playwright launches a browser per run), and reset's own job is to undo a
 * game that has already been played.
 */
function enterAt(steps: Step[], name: string): Step[] {
  const at = steps.findIndex(
    (s) => s.verb === "save" && (s.args[0] ?? "").toLowerCase() === name.toLowerCase(),
  );
  if (at < 0) {
    const points = steps.filter((s) => s.verb === "save").map((s) => `"${s.args[0]}"`);
    throw new Error(
      `no save point called "${name}" in this sheet.\n  It has: ${points.join(", ") || "none at all"}`,
    );
  }
  const boot = parseSheet(
    [
      "intro()",
      "skipMovie(until: awaiting, budget: 90000)",
      "clickAt(266, 254)",
      // AND WAIT FOR THE BOOT TO FINISH. Clicking GAME starts a `coldBoot`
      // dispatch that runs the whole London-flat opening, and a load fired into
      // it leaves that dispatch in flight for good: measured, `script busy
      // (coldBoot)` still true sixty seconds later, with the game sitting
      // correctly in c73 and refusing every key. `scriptBusy` is what the input
      // queue waits on, so the run is not slow there, it is deaf.
      "skipMovie(until: quiet, budget: 90000)",
      // rest: true on load(), so a name with spaces needs no quoting
      `load(${steps[at].args[0]})`,
    ].join("\n"),
    { verbs: VERBS },
  );
  return [...boot, ...steps.slice(at + 1)];
}

const pad = (s: string, n: number): string => (s.length >= n ? s.slice(0, n) : s + " ".repeat(n - s.length));
const padl = (s: string, n: number): string => (s.length >= n ? s : " ".repeat(n - s.length) + s);

function printVerbs(): void {
  console.log("\nWhat a speedrun sheet may contain:\n");
  // the signature as a sheet writes it, which is also the only place the
  // camelCase spelling exists — the table is keyed lowercase
  const sigOf = (name: string): string => VERBS[name].sig ?? `${name}()`;
  const width = Math.max(...Object.keys(VERBS).map((v) => sigOf(v).length));
  for (const [name, spec] of Object.entries(VERBS)) {
    const bits = spec.opts?.length ? spec.opts.map((o) => `${o}:`).join(" ") : "";
    console.log(`  ${pad(sigOf(name), width)}  ${spec.help}${bits ? `\n  ${" ".repeat(width)}  · ${bits}` : ""}`);
  }
  console.log(`
  Every verb also takes:
    wait: none|taken|ready|quiet  how much of the consequence to wait for
    after: <ms>                   dead padding, reported as such
    budget: <ms>                  how long its own wait may take (default 10000)
    gap: <ms>                     between repeated presses in a hammering verb
    xN                            do it N times

  A named argument takes a COLON. A condition takes an equals, doubled —
  set == c73 — or a dot for a named thing: owns.map, actor.purs,
  global.mission == 1. Whitespace round any operator is optional.
`);
}

async function main(): Promise<void> {
  // the pathfinder is Node-only (it parses .SET files off disk), so it is handed
  // to the action table rather than imported by it — see actions.ts setPlanner
  setPlanner(playwrightPlanner);
  if (flag("verbs")) {
    printVerbs();
    return;
  }

  if (!existsSync(SHEET)) throw new Error(`no sheet at ${SHEET}`);
  const text = readFileSync(SHEET, "utf8");
  const whole = parseSheet(text, { verbs: VERBS });
  const steps = FROM ? enterAt(whole, FROM) : whole;
  console.log(
    `sheet ${relative(ROOT, SHEET)} — ${describeSheet(whole)}` +
      (FROM ? `\n  from "${FROM}" — ${describeSheet(steps)}` : ""),
  );
  if (flag("lint")) {
    console.log("sheet parses.");
    return;
  }

  const url = playUrl();
  url.searchParams.set("edition", process.env.TAOOT_LANG ?? DEFAULT_LANGUAGE);

  const browser: Browser = await chromium.launch({ headless: !HEADED, slowMo: SLOWMO });
  const page: Page = await browser.newPage({ viewport: { width: 1400, height: 1300 } });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("crash", () => errors.push("the page CRASHED (renderer gone)"));
  page.on("close", () => errors.push("the page was CLOSED"));
  browser.on("disconnected", () => errors.push("the browser DISCONNECTED"));

  await page.goto(url.toString());
  await page.waitForFunction(() => !!(window as unknown as { dbg?: unknown }).dbg, null, { timeout: 20_000 });

  // before anything runs: advanceday draws the arrival second at the very end of
  // the boot, and the bomb's fuse is drawn in the flat
  const seedIt = async (): Promise<void> => {
    if (SEED === null) return;
    await page.evaluate((seed) => (window as any).dbg.session.seedRandom(seed), SEED);
  };
  await seedIt();

  const d = await speedrunDriver(page, {
    log: (m) => process.env.VERBOSE && console.log(`    ${m}`),
    // a `reset()` reloads the page, which throws the seeded stream away with it
    onReload: seedIt,
  });

  // the loop is shared with the in-page previewer (taoot/src/speedrun/runner.ts) so the
  // two hosts cannot drift about what a sheet MEANS — only about how a key gets
  // delivered. VERBOSE narrates; the report below is what a run is read from.
  const r = await runSheet(d, steps, ACTIONS, {
    onWatch: (w, said) =>
      console.log(`  WATCH ${w.source} -> ${w.action.source}${said.length ? `  (${said.join("; ")})` : ""}`),
    onStep: (step, i, total) =>
      process.env.VERBOSE && console.log(`  [${i + 1}/${total}] ${step.source}`),
  });

  report({ steps, ...r, errors, seeded: SEED });

  const failed = !!r.failure || errors.length > 0;
  if (HEADED && process.env.KEEPOPEN !== "0") {
    console.log("\n(window left open — KEEPOPEN=0 to close it)");
    await new Promise(() => {});
  }
  await browser.close();
  process.exit(failed ? 1 : 0);
}

function report(r: {
  steps: Step[];
  timings: Timing[];
  splits: Split[];
  total: { ms: number; frames: number; loading: number };
  failure: { step: Step; error: Error } | null;
  where: string | null;
  errors: string[];
  seeded: number | null;
}): void {
  const line = "─".repeat(72);
  console.log(`\n${line}`);
  console.log(`SPLITS${r.seeded === null ? "   (unseeded — a fresh course, dice live)" : `   (seed ${r.seeded} — pinned, not a clean run)`}`);
  console.log(line);
  // `time`, not `wall`, and the difference is the load remover (#251): every
  // number in the column has the run's downloading taken out of it, and the
  // `load` column beside it is what came out. A `load` column only when there
  // was loading to remove — over a warm cache it is a column of zeroes, and the
  // report is read at 72 characters wide.
  const loads = r.splits.some((s) => s.loading > 0) || r.total.loading > 0;
  /** the load cell of a row, or nothing at all when the column is not there */
  const loadCol = (n: number): string => (loads ? padl(n ? ms(n) : "", 10) : "");
  const loadHead = loads ? padl("load", 10) : "";
  console.log(
    `${pad("split", 34)}${padl("time", 10)}${loadHead}${padl("frames", 10)}${padl("actions", 9)}`,
  );
  for (const s of r.splits) {
    console.log(
      `${pad(s.name, 34)}${padl(ms(s.ms), 10)}${loadCol(s.loading)}${padl(String(s.frames), 10)}${padl(String(s.actions), 9)}`,
    );
  }
  console.log(line);
  console.log(
    `${pad(r.failure ? "TOTAL (incomplete)" : "TOTAL", 34)}${padl(ms(r.total.ms), 10)}${loadCol(r.total.loading)}${padl(String(r.total.frames), 10)}${padl(String(r.timings.length), 9)}`,
  );

  /**
   * What an action removed, named on its own row (#251).
   *
   * The tuning list is sorted on the load-removed time, which is the right sort
   * — a step that is slow because it downloads a 37 MB film is not a step to
   * tune — but it leaves the reader wondering where the film went. So a row that
   * removed anything says so, and a step whose real cost is the wire can be told
   * apart from one that is genuinely slow.
   */
  const load = (t: Timing): string => (t.loading > 0 ? `  [+${ms(t.loading)} load]` : "");

  // -- where the time went -------------------------------------------------
  // --all prints every action in sheet order instead of the worst twelve by
  // time. The worst-twelve view answers "what should I fix"; this one answers
  // "where did a particular stretch go", which is the question when a pause is
  // between two named steps rather than inside one.
  if (flag("all")) {
    console.log(`\nEVERY ACTION, in order`);
    console.log(line);
    for (const t of r.timings) {
      const said = t.says.length ? `  (${t.says.join("; ")})` : "";
      console.log(
        `${padl(ms(t.ms), 8)} ${padl(`${t.frames}f`, 7)}  ${pad(`L${t.step.line}`, 6)}${t.step.source}${said}${load(t)}`,
      );
    }
  }
  const slowest = [...r.timings].sort((a, b) => b.ms - a.ms).slice(0, 12);
  console.log(`\nSLOWEST ACTIONS — the tuning list`);
  console.log(line);
  for (const t of slowest) {
    const share = ((t.ms / Math.max(1, r.total.ms)) * 100).toFixed(1);
    const said = t.says.length ? `  (${t.says.join("; ")})` : "";
    console.log(
      `${padl(ms(t.ms), 8)} ${padl(`${share}%`, 6)}  ${pad(`L${t.step.line}`, 6)}${t.step.source}${said}${load(t)}`,
    );
  }

  // -- dead time, bought with a guess --------------------------------------
  const padded = r.timings.filter((t) => t.padded > 0);
  if (padded.length) {
    const total = padded.reduce((n, t) => n + t.padded, 0);
    console.log(`\nPADDING — ${ms(total)} spent in after:, i.e. waiting on a guess rather than a condition`);
    console.log(line);
    for (const t of padded) console.log(`${padl(ms(t.padded), 8)}  ${pad(`L${t.step.line}`, 6)}${t.step.source}`);
    console.log(`  Each of these is a wait: or a wait <condition> that hasn't been found yet.`);
  }

  // -- the planner, still in the sheet -------------------------------------
  //
  // By what it PRODUCED, not by the verb's name. `stand` reaches a view in the
  // room you are standing in by planning over the loaded set — no pathfinder, no
  // aim sweeps, nothing given away — and only falls through to the planner when
  // the target is somewhere else entirely. Listing it either way printed a line
  // under "replace each with the literal lines it produced" with no lines under
  // it, which is the report telling the reader to fix something that is not
  // wrong. A step that suggested nothing has nothing to replace.
  const PLANNERS = new Set(["travel", "hunt", "stand"]);
  const planned = r.timings.filter((t) => PLANNERS.has(t.step.verb) && (t.suggestion ?? "").trim());
  if (planned.length) {
    const total = planned.reduce((n, t) => n + t.ms, 0);
    console.log(`\nPLANNER — ${planned.length} step(s), ${ms(total)}`);
    console.log(line);
    console.log(`  travel/hunt/stand pathfind for "reachable", not "shortest", and pay aim sweeps to do it.`);
    console.log(`  Replace each with the literal lines it produced:\n`);
    for (const t of planned) {
      console.log(`  L${t.step.line}  ${t.step.source}  ->`);
      for (const l of (t.suggestion ?? "").split("\n").filter(Boolean)) console.log(`      ${l}`);
    }
  }

  // -- the verdict ---------------------------------------------------------
  console.log(`\n${line}`);
  if (r.failure) {
    console.log(`FAILED at sheet line ${r.failure.step.line}: ${r.failure.step.source}`);
    console.log(`  ${r.failure.error.message}`);
    if (r.where) console.log(`  standing in: ${r.where}`);
    const done = r.timings.length;
    console.log(`  ${done} of ${r.steps.filter((s) => s.verb !== "split").length} actions ran.`);
  } else {
    // "wall" is what this said before the load remover, and it would be a lie
    // now: the headline is the route's time with the downloading taken out
    // (#251). What came out is named beside it rather than left in the table —
    // this is the line that gets quoted, and a time is only comparable with
    // another time if both say what they removed.
    console.log(
      `FINISHED — ${ms(r.total.ms)}, ${r.total.frames} engine frames` +
        (r.total.loading > 0 ? ` (${ms(r.total.loading)} of loading removed)` : ""),
    );
  }
  for (const e of r.errors) console.log(`  page error: ${e}`);
  console.log(line);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
