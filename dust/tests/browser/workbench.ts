/**
 * Dust's speedrun workbench in a real browser: does the page assemble, and does
 * Play run a sheet?
 *
 * Run against a live dev server (`npm run dev -w dust`):
 *
 *   npx tsx dust/tests/browser/workbench.ts
 *   HEADED=1 …                                   # watch it
 *
 * The same suite Titanic has (taoot/tests/browser/workbench.ts) and for the same
 * reason: the panel is eight modules the PAGE loads by name, every one of them
 * finds its elements with `getElementById`, and none of that is visible to `tsc`
 * or to any headless suite. What it checks here in particular is the claim the
 * whole refactor rests on — that a sheet written against the ENGINE's verbs runs
 * on this disc with no Dust verbs existing at all
 * (`dust/src/speedrun/actions.ts`).
 *
 * ## Why it waits so long for the game
 *
 * Because Dust's boot really does take minutes over a dev server: fourteen
 * fetches, two of them intro films worth 13 MB. The wait is on `dbg.viewer`,
 * which is the first moment there is anything to drive, and the progress lines
 * before it are there so a killed run leaves a trace of how far it got.
 */
import { chromium } from "playwright";

const APP = process.env.APP_URL ?? "http://localhost:5176/";
const HEADED = !!process.env.HEADED && process.env.HEADED !== "0";

/** the smallest sheet that goes all the way round the loop, and touches nothing */
const SHEET = ["# the workbench's own probe", "esc()", "note(the panel ran a sheet)", "split(probe)", ""].join(
  "\n",
);
/** a word out of it, so the editor check cannot go stale when the sheet changes */
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

  console.log(`opening ${APP}speedrun/`);
  await page.goto(`${APP}speedrun/`);

  await page.waitForSelector("#srsheet", { timeout: 60_000 });
  console.log("     the panel is up");

  await page.fill("#srsheet", SHEET);
  const painted = await page.evaluate((want) => {
    const pre = document.querySelector("#srpanel pre");
    return !!pre && (pre.textContent ?? "").includes(want);
  }, MARKER);
  check(painted, `the editor repainted the sheet it was given (looked for "${MARKER}")`);

  // Dust's own stage is here, with the ids main.ts queries — a missing one
  // throws in that module and leaves this page half-built
  const stage = await page.evaluate(() =>
    ["stage", "screen", "start", "boot", "fuse", "burn", "log", "netbusy"].filter(
      (id) => !document.getElementById(id),
    ),
  );
  check(stage.length === 0, `the game's own elements are all here (missing: ${JSON.stringify(stage)})`);

  // NOT pressed: this page declares `<meta name="autostart">` and the boot runs
  // without being asked (dust/src/main.ts). The game page asks for the click
  // because an AudioContext wants a gesture; a workbench is reloaded on every
  // `reset()`, so it would be asking once per run. If that ever regresses this
  // wait is what fails, which is the right place for it to.
  console.log("     waiting for the boot — Dust's is minutes, not seconds, and nothing pressed Start");
  await page.waitForFunction(
    () => !!(window as unknown as { dbg?: { viewer?: unknown } }).dbg?.viewer,
    null,
    { timeout: 600_000 },
  );
  const where = await page.evaluate(
    () => (window as unknown as { dbg: { session: { currentSetFile: string } } }).dbg.session.currentSetFile,
  );
  check(!!where, `the game booted — ${where}`);

  // the framebuffer the aim sweep takes its bounds from: Dust presents 512x384
  // through a 1024x768 canvas, and it is the FRAMEBUFFER a hit test is asked in
  const screen = await page.evaluate(
    () =>
      (window as unknown as { dbg: { host: { screen: { width: number; height: number } } } }).dbg.host.screen,
  );
  check(screen.width > 0, `dbg.host.screen answers — ${screen.width}x${screen.height}`);

  await page.click("#srrun");
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

  // ---- and the Details column has the variables in it --------------------
  //
  // The list is the engine's (web/state-list.ts) and this game passes it two
  // named variables of its own — `day` and `clock`, the two its own suites
  // reach for. A spine row proves the whole chain: a snapshot of the running
  // session, through the view, into the DOM.
  const state = await page.evaluate(() => ({
    spine: [...document.querySelectorAll("#dbgSpine > *")].map((e) => e.textContent?.trim()),
    rows: document.querySelectorAll("#dbgRows > *").length,
    hidden: document.getElementById("dbgState")?.hidden,
  }));
  check(state.hidden === false, `the variables list is open on a workbench (hidden=${state.hidden})`);
  check(state.rows > 0, `and has rows in it — ${state.rows}`);
  check(
    state.spine.some((r) => /^Day\b/.test(r ?? "")),
    `with this game's own named variables above them — ${JSON.stringify(state.spine)}`,
  );

  // …under DUST's key space and nobody else's, which is the whole reason the
  // namespace exists (engine/src/web/speedrun/panel-keys.ts)
  const foreign = await page.evaluate(() =>
    Object.keys(localStorage).filter((k) => k.includes("speedrun") && !k.startsWith("dust:")),
  );
  check(foreign.length === 0, `every speedrun key is Dust's (stray: ${JSON.stringify(foreign)})`);

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
