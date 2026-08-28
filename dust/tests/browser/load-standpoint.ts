/**
 * Where a load puts you, in a real browser, on a game that has just booted.
 *
 *   npm run dev:dust
 *   npx tsx dust/tests/browser/load-standpoint.ts
 *
 * A v1 standpoint is a grid CELL, and turning it into a scene means reading the
 * set's own grid — which means having the set's bytes. On the page the bytes of a
 * room the player has not been in yet are not there, and that is a state no
 * headless test can be in: a disk provider answers on the spot, so the "no scene
 * at cell" arm of the loader is unreachable there. Reported from play as loading
 * `D1E_002` on a fresh boot arriving in the right room at the wrong place — and
 * right if you had walked through the saloon first, which is the shape that says
 * "the file was in the store the second time".
 *
 * So this probe is the cold arm. It boots the page, loads the save as the FIRST
 * thing the game does, and reads back the standpoint the engine settled on. Then
 * it does it again in the same tab with the room already fetched, because the
 * warm case is the one that always worked and a probe that only measures the
 * broken arm cannot tell a fix from a coincidence.
 *
 * `dbg.loadSave` is what makes it possible at all: the panel's LOAD lever is
 * `opengame`, which blocks on a modal a probe would have to click through — and
 * getting to that modal means driving the menu, which is the very state that
 * hides the bug.
 */
import { chromium, type Browser, type Page } from "playwright";

/** Dust's own dev port — one per game in the order the engine shipped them
 *  (5175 Titanic, 5176 Dust, 5177 Timelapse); `APP_URL` overrides. */
const APP_URL = process.env.APP_URL ?? "http://localhost:5176/";
/** the saloon save the report named: sallower.set, cell (2,3) = Scene C4, west */
const SAVE = process.env.SAVE ?? "D1E_002";
const WANT_SCENE = (process.env.SCENE ?? "scene c4").toLowerCase();
const WANT_VIEW = (process.env.VIEW ?? "west").toLowerCase();

interface Where {
  set: string;
  scene: string;
  view: string;
  /** the loader's own account of what it did */
  said: string[];
}

const fail: string[] = [];
const check = (name: string, ok: boolean, detail = ""): void => {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) fail.push(name);
};

const where = async (page: Page): Promise<Where> =>
  page.evaluate(() => {
    const d = (window as unknown as {
      dbg: {
        session: { currentSetFile: string; currentSceneName: () => string; currentViewName: () => string };
        log: () => { lines: string[] };
      };
    }).dbg;
    return {
      set: d.session.currentSetFile ?? "",
      scene: (d.session.currentSceneName() ?? "").toLowerCase(),
      view: (d.session.currentViewName() ?? "").toLowerCase(),
      said: d.log().lines.filter((l) => l.startsWith("opengame:") || l.startsWith("opensetfile(")),
    };
  });

/** load a shipped save by name through the page's own loader */
const load = async (page: Page, name: string): Promise<boolean> =>
  page.evaluate(
    (n) => (window as unknown as { dbg: { loadSave: (s: string) => Promise<boolean> } }).dbg.loadSave(n),
    name,
  );

const main = async (): Promise<void> => {
  let browser: Browser | null = null;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    page.on("pageerror", (e) => console.log("[pageerror]", e.message));
    await page.goto(APP_URL);

    // the page boots itself behind a button; `dbg` appears with `play()`, which is
    // the frame loop starting — so waiting for it is waiting for a running game
    const start = page.locator("#start");
    await start.waitFor({ state: "visible", timeout: 120000 });
    await start.click();
    await page.waitForFunction(
      () => !!(window as unknown as { dbg?: { viewer?: unknown } }).dbg?.viewer,
      null,
      { timeout: 300000 },
    );
    const booted = await where(page);
    console.log(`  booted into: ${booted.set} ${booted.scene} · ${booted.view}`);
    check("the page publishes a live handle", !!booted.set, `dbg.session says "${booted.set}"`);

    // 1. THE COLD ARM: the saloon has never been opened, so its bytes are not in
    // the store and the saved cell has no grid to be read against.
    const coldFetched = await page.evaluate(
      () => (window as unknown as { dbg: { host: { files: { paths: string[]; has?: (n: string) => boolean } } } })
        .dbg.host.files.has?.("sallower.set") ?? null,
    );
    const cold = await (async () => {
      check(`${SAVE} loads on a freshly booted game`, await load(page, SAVE));
      await page.waitForTimeout(1500); // the room opens, the frame loop settles
      return where(page);
    })();
    console.log(`  after a cold load: ${cold.set} ${cold.scene} · ${cold.view}`);
    console.log(`  the loader said:\n    ${cold.said.slice(-6).join("\n    ")}`);
    check("cold: the saved room", cold.set.toLowerCase().startsWith("sallower"), `set=${cold.set}`);
    check(
      "cold: the SAVED standpoint, not the room's own",
      cold.scene === WANT_SCENE && cold.view === WANT_VIEW,
      `${cold.scene} · ${cold.view} (want ${WANT_SCENE} · ${WANT_VIEW})${
        coldFetched === false ? "; the set was not in the store" : ""
      }`,
    );
    check(
      "cold: and it never fell back to the room's own standpoint",
      !cold.said.some((l) => l.includes("has no scene at cell")),
      cold.said.filter((l) => l.includes("has no scene at cell")).join(" | "),
    );

    // 2. THE WARM ARM: the same load again, with the room's bytes now in hand.
    // This one always worked; it is here so a pass on the cold arm cannot be a
    // probe that stopped measuring.
    check(`${SAVE} loads a second time`, await load(page, SAVE));
    await page.waitForTimeout(1500);
    const warm = await where(page);
    console.log(`  after a warm load: ${warm.set} ${warm.scene} · ${warm.view}`);
    check(
      "warm: the same standpoint as the cold one",
      warm.scene === cold.scene && warm.view === cold.view,
      `${warm.scene} · ${warm.view}`,
    );
    check(
      "warm: which is the saved standpoint",
      warm.scene === WANT_SCENE && warm.view === WANT_VIEW,
      `${warm.scene} · ${warm.view}`,
    );
  } finally {
    await browser?.close();
  }
  console.log(fail.length ? `\n${fail.length} check(s) failed` : "\nall checks passed");
  if (fail.length) process.exitCode = 1;
};

void main();
