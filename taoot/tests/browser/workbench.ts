/**
 * The speedrun workbench in a real browser: does the page ASSEMBLE, and does
 * Play run a sheet?
 *
 * Run against a live dev server (`npm run dev -w taoot`):
 *
 *   npx tsx taoot/tests/browser/workbench.ts
 *   HEADED=1 …                                   # watch it
 *
 * ## Why this suite exists
 *
 * `/speedrun/` is the one page in the repository nothing else can check. Its
 * panel is eight modules the PAGE loads by name — the in-page driver, the
 * editor, the column order, the widths, the input display, the recorder — and
 * every one of them finds its elements with `getElementById`. So a wrong import,
 * a renamed id or a missing option is invisible to `tsc` and to the whole
 * headless gate, and shows up only as a panel that never appears in front of
 * somebody who wanted to work on a route.
 *
 * That was the gap when the panel's game-neutral half moved to
 * `engine/src/web/speedrun/` (the play page has probes, the CLI runner has
 * `npm run speedrun`, and the thing between them had neither).
 *
 * ## What it asserts, and why not less
 *
 * The INTENDED outcome, never mere difference — a status line that changed is
 * satisfied by a run that failed. So: the editor repainted the text it was
 * given, the game booted far enough to have a viewer, Play drove the sheet to
 * `FINISHED`, and the split the sheet asks for is in the splits table. A page
 * error or a console error fails the run whatever the panel says, because half
 * of what can go wrong here throws in a module the page then carries on without.
 *
 * The sheet is deliberately the smallest one that still goes through the whole
 * loop — parse, pointer, driver, report — and touches nothing in the game, so
 * this suite has no route to keep working and cannot fail for a reason that is
 * about Titanic rather than about the page.
 */
import { chromium } from "playwright";
import { playUrl } from "./driver";
import { DEFAULT_LANGUAGE } from "../../src/languages";

/**
 * The workbench, with the edition pinned.
 *
 * `playUrl` names the PLAY page, and this is its sibling — so the last segment
 * is swapped rather than appended. `?edition=` for the reason `appUrl` gives:
 * the page would otherwise ask which edition to use and wait forever for an
 * answer no suite is there to give.
 */
const workbenchUrl = (): string => {
  const url = playUrl();
  url.pathname = url.pathname.replace(/play\/?$/, "speedrun/");
  url.searchParams.set("edition", process.env.TAOOT_LANG ?? DEFAULT_LANGUAGE);
  return url.toString();
};

const HEADED = !!process.env.HEADED && process.env.HEADED !== "0";

/**
 * The smallest sheet that still goes all the way round the loop.
 *
 * Deliberately game-free. The first version opened with `settle()` and failed —
 * correctly, and with a useful message: a workbench that has just been opened is
 * mid-`coldBoot` with `logo.mov` on screen, so nothing is settled and nothing is
 * going to be for a while. That is a fact about Titanic's boot, and a suite about
 * the PANEL should not be able to fail for it.
 *
 * `esc()` is one synthesized keypress, which is the in-page driver's whole job
 * and is harmless at any moment (it is what `skipMovie` presses); `note` and
 * `split` do nothing to the game and prove the report and the splits table are
 * being written. Between them they exercise parse, pointer, driver, report — the
 * panel's own machinery and nothing else's.
 */
const SHEET = ["# the workbench's own probe", "esc()", "note(the panel ran a sheet)", "split(probe)", ""].join(
  "\n",
);

/**
 * A word out of {@link SHEET} to look for in the editor's painted copy — taken
 * from the sheet rather than written out again, because a literal here goes
 * stale the moment the sheet changes and then reports the editor as broken.
 */
const MARKER = "probe";

const main = async (): Promise<void> => {
  const browser = await chromium.launch({ headless: !HEADED, slowMo: HEADED ? 200 : 0 });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1200 } });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(`console: ${m.text()}`));
  let bad = 0;
  const check = (ok: boolean, said: string): void => {
    if (!ok) bad++;
    console.log(`${ok ? "ok  " : "FAIL"} ${said}`);
  };

  const url = workbenchUrl();
  console.log(`opening ${url}`);
  await page.goto(url);

  // the panel at all: this id is what the page's own modules query by
  await page.waitForSelector("#srsheet", { timeout: 60_000 });
  console.log("     the panel is up");

  // the editor paints a second, coloured copy of the text under the textarea,
  // and it is the one visible sign that its listeners are attached
  await page.fill("#srsheet", SHEET);
  const painted = await page.evaluate((want) => {
    const pre = document.querySelector("#srpanel pre");
    return !!pre && (pre.textContent ?? "").includes(want);
  }, MARKER);
  check(painted, `the editor repainted the sheet it was given (looked for "${MARKER}")`);

  // Play means nothing until there is a game to drive.
  //
  // `null` for the middle argument, which is not decoration: `waitForFunction`
  // takes (fn, arg, options), so an options object passed second is handed to
  // the predicate as its ARGUMENT and the wait quietly keeps the 30 s default.
  // That is how this suite first "failed" — the run had not finished in 30 s
  // and the message said nothing about which timeout had run out.
  await page.waitForFunction(
    () => !!(window as unknown as { dbg?: { viewer?: unknown } }).dbg?.viewer,
    null,
    { timeout: 300_000 },
  );
  const room = await page.evaluate(
    () => (window as unknown as { dbg: { session: { currentSetFile: string } } }).dbg.session.currentSetFile,
  );
  check(!!room, `the game booted — ${room}`);

  // the framebuffer, which is where the aim sweep takes its bounds from
  // (engine/src/web/speedrun/aim.ts) and is NOT the canvas's size
  const screen = await page.evaluate(
    () =>
      (window as unknown as { dbg: { host: { screen: { width: number; height: number } } } }).dbg.host.screen,
  );
  check(screen.width > 0 && screen.height > 0, `dbg.host.screen answers — ${screen.width}x${screen.height}`);

  await page.click("#srrun");
  // A timeout here is not fatal on its own — what the panel SAYS is the finding,
  // and a run that never reported is diagnosed by reading it rather than by a
  // stack trace with no page state in it.
  await page
    .waitForFunction(
      () =>
        /finished|failed|stopped|could not/i.test(document.getElementById("srstatus")?.textContent ?? ""),
      null,
      { timeout: 180_000 },
    )
    .catch(() => console.log("     (the panel never reported a verdict — its last words follow)"));
  const status = ((await page.textContent("#srstatus")) ?? "").trim();
  const splits = ((await page.textContent("#srsplits")) ?? "").replace(/\s+/g, " ").trim();
  console.log(`     status: ${status.split("\n").slice(-2).join(" | ")}`);
  console.log(`     splits: ${splits.slice(0, 160)}`);
  check(/finished/i.test(status), "Play drove the sheet to FINISHED");
  check(/probe/i.test(splits), "and the sheet's split is in the splits table");


  // ---- the parity the two workbenches are held to -----------------------
  //
  // Not decoration: a workbench whose columns cannot be dragged is a workbench
  // whose reader cannot put the picture where they want it, and one that waits
  // to be started is one that asks for a gesture on every `reset()`. Both were
  // missing on Dust's first working page and neither shows up in a screenshot.
  //
  // At a WIDE viewport, because the row is what the grips live in: below the
  // break the columns stack and there is no edge between them to drag
  // (engine/src/web/speedrun/panel.css, `@container style(--row: 1)`).
  await page.setViewportSize({ width: 2000, height: 1200 });
  await page.waitForTimeout(400);
  const layout = await page.evaluate(() => {
    const row = document.getElementById("srlayout");
    const kids = row ? [...row.children].filter((c) => c.id).map((c) => c.id) : [];
    return {
      kids,
      inRow: row ? getComputedStyle(row).flexDirection : "?",
      grips: document.querySelectorAll(".sr-grip").length,
      handles: document.querySelectorAll('#srlayout [draggable="true"]').length,
    };
  });
  check(layout.inRow === "row", `the columns are a ROW on a wide desk (saw ${layout.inRow})`);
  check(layout.grips >= 2, `the edges between them can be dragged — ${layout.grips} grips`);
  check(layout.handles >= 2, `and the headings reorder them — ${layout.handles} handles`);
  check(
    layout.kids.length >= 3,
    `the panels are columns of the row, not children of the game — ${JSON.stringify(layout.kids)}`,
  );

  // ---- the help sheet is a POPUP, and starts closed ----------------------
  //
  // It is `#srlegend`, and its presentation is the panel's own
  // (engine/src/web/speedrun/panel.css) rather than a `.modal` class the page
  // might define — Dust's page styles `#saveModal` directly and has no such
  // class, so the legend rendered inline and permanently open until those rules
  // were written by id. Which is a thing no screenshot of a working page shows.
  const legendShut = await page.evaluate(
    () => getComputedStyle(document.getElementById("srlegend")!).display,
  );
  check(legendShut === "none", `the help sheet starts closed (display: ${legendShut})`);
  await page.click("#srhelp");
  await page.waitForTimeout(200);
  const legendOpen = await page.evaluate(() => {
    const el = document.getElementById("srlegend")!;
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return `${cs.display} ${cs.position} ${Math.round(r.width)}x${Math.round(r.height)}`;
  });
  check(
    legendOpen.startsWith("flex fixed") && !legendOpen.endsWith("0x0"),
    `and the help button opens it over the page (${legendOpen})`,
  );
  await page.click("#srlegendclose");

  // ---- the picture is a WHOLE multiple of the framebuffer ----------------
  //
  // 1x/2x/3x of 512, because the canvas is `pixelated` and a fraction of a game
  // pixel is not a pixel. The control is `#srscale` and both workbenches carry
  // it; a game whose page sized its own canvas instead would read back something
  // that is not a multiple of 512, which is the answer this is looking for.
  for (const [pick, want] of [["1", 512], ["3", 1536], ["2", 1024]] as const) {
    await page.click(`#srscale label:has(input[value="${pick}"])`);
    await page.waitForTimeout(200);
    const w = await page.evaluate(() =>
      Math.round(document.getElementById("screen")!.getBoundingClientRect().width),
    );
    check(w === want, `${pick}x draws the picture ${want}px wide (saw ${w})`);
  }

  // ---- and the saved-games dialog is still hidden ------------------------
  //
  // A `.modal` on this page is the game's own dialog. Moving the legend's
  // presentation to `#srlegend` took the `.modal` base out of Titanic's page
  // with it for one revision, and the dialog — same class, no `display: none`
  // — came up visible over the panel. Nothing else here would have noticed.
  // ---- the log is in the Details column, above the variables -------------
  //
  // Each game named its own before there was a column to put it in — Titanic's
  // `#scriptlog`, Dust's `#log` — so the check asks for whichever this page has
  // and holds both to the same shape: a block IN the column, not an overlay over
  // the picture, with something in it. Dust's is the overlay `b` lifts on its
  // game page and that must stay so; here the page declares `details-always` and
  // it simply stays put.
  const logSeen = await page.evaluate(() => {
    const el = document.getElementById("scriptlog") ?? document.getElementById("log");
    if (!el) return "no log on this page";
    const cs = getComputedStyle(el);
    return `#${el.id} ${cs.display}/${cs.position} inDetails=${!!el.closest("#details")} chars=${(el.textContent ?? "").length}`;
  });
  check(
    /block\/static inDetails=true chars=[1-9]/.test(logSeen),
    `the log is a block in the Details column, with lines in it — ${logSeen}`,
  );

  const dialog = await page.evaluate(() => {
    const m = document.getElementById("saveModal");
    return m ? getComputedStyle(m).display : "absent";
  });
  check(dialog === "none" || dialog === "absent", `the saved-games dialog is shut (${dialog})`);

  // the panel's remembered answers are namespaced to THIS game
  // (engine/src/web/speedrun/panel-keys.ts): every game on the deployed site
  // shares one origin, so a bare key would be one setting for all of them
  const foreign = await page.evaluate(() =>
    Object.keys(localStorage).filter((k) => k.includes("speedrun") && !k.startsWith("taoot:")),
  );
  check(foreign.length === 0, `every speedrun key is Titanic's (stray: ${JSON.stringify(foreign)})`);

  await browser.close();
  if (errors.length) {
    console.log(`\nPAGE ERRORS — the panel may be up and still broken:\n  ${errors.join("\n  ")}`);
    process.exit(1);
  }
  if (bad) {
    console.log(`\n${bad} check(s) failed`);
    process.exit(1);
  }
  console.log("\nall checks passed");
};

void main();
