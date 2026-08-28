/**
 * Open Dust in a real window, at any rung of the disc's own playthrough.
 *
 *   npm run dev:dust                 # in another terminal
 *   npm run watch:dust               # boot, and leave it open
 *   npm run watch:dust -- D2A_006    # …at that shipped save
 *   npm run watch:dust -- --list     # the saves in the order they were made
 *
 * Not a test — it asserts nothing and never exits on its own. It is the
 * companion to [the walkthrough](../../../docs/dust/walkthrough.md): every step
 * on that page names the save that ends it, and this is how you get to one
 * without playing the four hours in front of it.
 *
 * Titanic has `npm run watch:m2p0` and friends, which are its browser
 * playthrough run headed with a segment filter. Dust has no playthrough to run
 * yet, so this drives the one thing that does exist — the page, and
 * `dbg.loadSave`, which is the panel's LOAD lever minus the modal it blocks on.
 *
 * Two things it does deliberately:
 *
 *   - **It says what it is waiting for before it waits.** The Dust page takes
 *     about three minutes to reach `dbg.viewer`, and a script whose first line
 *     of output comes after that is indistinguishable from a hung one.
 *   - **It logs the standpoint as you walk.** Checking a walkthrough against the
 *     game means knowing which room and view you are actually in, and the window
 *     does not say. The terminal becomes the trace.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Page } from "playwright";
import { parseSaveV1 } from "@dreamfactory/engine/df/savegame-v1";

/** Dust's own dev port — 5175 Titanic, 5176 Dust, 5177 Timelapse */
const APP_URL = process.env.APP_URL ?? "http://localhost:5176/";
const SAVES = fileURLToPath(new URL("../../gamefiles/save", import.meta.url));
/** headed is the point of this script; `HEADLESS=1` is for smoke-testing it
 *  where there is no display, which is the only reason it can be turned off */
const HEADLESS = process.env.HEADLESS === "1";

const args = process.argv.slice(2).filter((a) => a !== "--");
const wantList = args.includes("--list");
const save = process.env.SAVE ?? args.find((a) => !a.startsWith("--")) ?? "";

/** the shipped saves in the order they were made — the thread's own order */
function ladder(): { name: string; frame: number; day: number }[] {
  if (!existsSync(SAVES)) return [];
  return readdirSync(SAVES)
    .filter((f) => /\.rtd$/i.test(f))
    .map((f) => {
      const s = parseSaveV1(new Uint8Array(readFileSync(join(SAVES, f))));
      return { name: f.replace(/\.rtd$/i, ""), frame: s.frame, day: s.numGlobals.get("day") ?? 0 };
    })
    .sort((a, b) => a.frame - b.frame);
}

if (wantList) {
  const rows = ladder();
  if (!rows.length) {
    console.error(`no saves in ${SAVES} — this needs the Dust rip`);
    process.exit(1);
  }
  for (const [i, r] of rows.entries()) {
    console.log(`${String(i + 1).padStart(3)}. ${r.name.padEnd(12)} day ${r.day}  frame ${r.frame}`);
  }
  console.log(`\n  npm run watch:dust -- ${rows[0].name}`);
  process.exit(0);
}

/** where the game thinks it is */
const where = (page: Page): Promise<string> =>
  page.evaluate(() => {
    const d = (window as unknown as {
      dbg: { session: { currentSetFile: string; currentSceneName: () => string; currentViewName: () => string } };
    }).dbg;
    return `${d.session.currentSetFile ?? "?"}  ${d.session.currentSceneName() ?? "?"} · ${d.session.currentViewName() ?? "?"}`;
  });

const main = async (): Promise<void> => {
  const known = ladder().map((r) => r.name.toLowerCase());
  if (save && known.length && !known.includes(save.toLowerCase().replace(/\.rtd$/, ""))) {
    console.error(`no shipped save called "${save}". Try --list.`);
    process.exit(1);
  }

  console.log(`opening ${APP_URL}${save ? ` at ${save}` : ""}`);
  const browser = await chromium.launch({ headless: HEADLESS });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on("pageerror", (e) => console.log("[pageerror]", e.message));
  await page.goto(APP_URL);

  const start = page.locator("#start");
  console.log("waiting for the start button…");
  await start.waitFor({ state: "visible", timeout: 120_000 });
  await start.click();
  // the page boots itself behind that button and `dbg` appears with the frame
  // loop, so this wait IS the boot — about three minutes, and worth saying so
  console.log("booting — this takes around three minutes, the window is live meanwhile");
  await page.waitForFunction(
    () => !!(window as unknown as { dbg?: { viewer?: unknown } }).dbg?.viewer,
    null,
    { timeout: 600_000 },
  );
  console.log(`booted into ${await where(page)}`);

  if (save) {
    const ok = await page.evaluate(
      (n) => (window as unknown as { dbg: { loadSave: (s: string) => Promise<boolean> } }).dbg.loadSave(n),
      save,
    );
    await page.waitForTimeout(1500); // the room opens and the frame loop settles
    console.log(ok ? `loaded ${save} — ${await where(page)}` : `${save} did not load`);
  }

  console.log(HEADLESS ? "\nheadless — nothing to look at; Ctrl-C to stop.\n" : "\nthe window is yours. Ctrl-C here, or close it, to stop.\n");

  // the standpoint as a running log: only on change, so walking prints a trail
  // and standing still prints nothing
  let last = "";
  const closed = new Promise<void>((resolve) => page.on("close", () => resolve()));
  for (;;) {
    const now = await where(page).catch(() => null);
    if (now === null) break; // the window went away
    if (now !== last) {
      last = now;
      console.log(`  ${now}`);
    }
    const done = await Promise.race([page.waitForTimeout(400).then(() => false), closed.then(() => true)]);
    if (done) break;
  }
  await browser.close().catch(() => {});
};

void main();
