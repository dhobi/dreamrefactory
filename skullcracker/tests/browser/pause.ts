/**
 * The PAUSE PANEL, and the file dialogs either side of a saved game.
 *
 *   npm run dev -w skullcracker                  # in one terminal
 *   npm run test:browser:pause -w skullcracker   # in another
 *
 * A smoke check of what only the page can show. What the twenty-two bytes ARE,
 * and that a file read back stands the game up holding what it says, is the
 * machine suite's (`tests/machine/savegame.ts`); this is the panel and the two
 * dialogs.
 *
 * `0x403c7b` is the only caller of `0x404280`:
 *
 *   - which film is `[0x4abdfe] - 3` through the jump table at `0x4042af`, so
 *     the four chapters get `pauseA`..`pauseD`;
 *   - each one LOOPS — its last logic frame is a type-2 jump back to "X 3" —
 *     which is what makes it a panel rather than something to sit through;
 *   - the three buttons are the film's own regions, and which is which is in the
 *     segment header rather than the picture: `actionFrame1` names the middle
 *     one and `actionFrame2` the bottom, and the top is named by neither. So
 *     `0x449fbb`/`0x449fd6` fire `0x45e1e0(1)` and `(2)`, and that handler —
 *     while the shell state is the 4 `0x404280` set — takes 2 to `[0x46b208] = 5`
 *     and anything else to `GetSaveFileNameA`. Continue, Save, Exit.
 *
 * ## The forty-two pixels
 *
 * The regions are in the SEGMENT's coordinates and the pause films are the only
 * films in the game that have regions and are not full-screen: 512x232 at origin
 * (0, 42), inside the interface's own window. Every rect below is the film's
 * plus that 42, and the test would pass on the unshifted numbers only if the
 * buttons did nothing — which is what they did.
 *
 * ## The save dialog
 *
 * The probe takes `showSaveFilePicker` away before the page loads, because
 * headless Chromium rejects it with `AbortError`, which is exactly what a reader
 * CANCELLING looks like; the page then falls back to a download, writing the
 * same blob.
 */
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BASE, fail, finish, launch } from "./harness";
import { readSkl, writeSkl, SKL } from "../../src/savegame";

/** the three regions of `pauseA`, plus the segment's own origin of 42 */
const BUTTONS = { continue: 161, save: 196, exit: 227, x: 400 };

const main = async (): Promise<void> => {
  const browser = await launch();
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
  await context.addInitScript(() => {
    delete (window as unknown as Record<string, unknown>).showSaveFilePicker;
  });
  const page = await context.newPage();
  page.on("pageerror", (e) => fail(`page threw: ${e.message}`));
  const hud = page.locator("#hud");
  const say = async (): Promise<string> => (await hud.textContent()) ?? "";
  const frameNow = async (): Promise<number> => Number(/frame (\d+)\//.exec(await say())?.[1] ?? 0);

  /** open a level and put the panel up, waiting for its buttons to arrive */
  const open = async (level: number, how: "Escape" | "Control+q"): Promise<string> => {
    await page.goto(`${BASE}/walk.html?level=${level}`);
    await hud.filter({ hasText: /room \d+ of \d+/ }).waitFor({ timeout: 30_000 });
    await page.keyboard.press(how);
    // frames 1 and 2 are the panel arriving and carry no regions at all
    for (let i = 0; i < 150; i++) {
      if (/pause/i.test(await say()) && (await frameNow()) >= 6) break;
      await page.waitForTimeout(100);
    }
    return say();
  };
  const tap = async (x: number, y: number): Promise<void> => {
    const box = (await page.locator("#screen").boundingBox())!;
    await page.mouse.click(box.x + (x / 512) * box.width, box.y + (y / 384) * box.height);
  };

  // ---- one film a chapter ---------------------------------------------------
  for (const [level, want] of [
    [2, "pausea.mov"],
    [6, "pauseb.mov"],
    [11, "pausec.mov"],
    [14, "paused.mov"],
  ] as const) {
    const up = await open(level, "Escape");
    if (!up.toLowerCase().startsWith(want)) {
      fail(`level ${level} is chapter ${Math.floor((level - 1) / 4) + 1}; 0x4042af wants ${want}, got ${up.slice(0, 40)}`);
    }
  }
  console.log(`ok    each chapter raises its own panel, pauseA..pauseD`);

  // ---- ...and it LOOPS: seen going back to an earlier frame, still up -------
  {
    const up = await open(2, "Control+q");
    if (!/pause/i.test(up)) fail(`Ctrl+Q is 0x403ea4's own; the panel did not open`);
    const total = Number(/frame \d+\/(\d+)/.exec(up)?.[1] ?? 0);
    let last = await frameNow();
    let wrapped = false;
    for (let i = 0; i < 150 && !wrapped; i++) {
      await page.waitForTimeout(100);
      const f = await frameNow();
      if (!/pause/i.test(await say())) fail(`pausea.mov ran out; its last logic frame is a type-2 jump back to "X 3"`);
      wrapped = f < last;
      last = f;
    }
    if (!wrapped) fail(`pausea.mov never went back round — it sat at frame ${last} of ${total}`);
    console.log(`ok    Ctrl+Q opens it, and it loops (${total} frames, back round to ${last})`);
  }

  // ---- the top button is Continue ----------------------------------------
  await tap(BUTTONS.x, BUTTONS.continue);
  await hud.filter({ hasText: /room \d+ of \d+/ }).waitFor({ timeout: 10_000 });
  if (!/level 2 · city/.test(await say())) fail(`Continue should put the level back: ${(await say()).slice(0, 60)}`);
  console.log(`ok    the top button resumes — no actionframe, so 0x404303 finds the state unchanged`);

  // ---- the middle button is Save, and it writes a file -------------------
  await open(2, "Escape");
  const download = page.waitForEvent("download", { timeout: 20_000 }).catch(() => null);
  await tap(BUTTONS.x, BUTTONS.save);
  const got = await download;
  if (!got) fail(`the middle button is actionframe 1, which 0x45e1e0 takes to GetSaveFileNameA; nothing was written`);
  const bytes = new Uint8Array(readFileSync((await got.path())!));
  const save = readSkl(bytes);
  if (bytes.length !== SKL.bytes || !save) fail(`0x45e30f writes ${SKL.bytes} bytes in one call; this file is ${bytes.length}`);
  if (save.scene !== 3 || save.stage !== 3) fail(`the file should name CITY, scene 3 stage 3; it says scene ${save.scene} stage ${save.stage}`);
  console.log(`ok    the middle button writes ${bytes.length} bytes, naming scene ${save.scene} stage ${save.stage}`);

  // ---- the bottom button is Exit -----------------------------------------
  await open(2, "Escape");
  await tap(BUTTONS.x, BUTTONS.exit);
  for (let i = 0; i < 60 && !page.url().includes("index.html"); i++) await page.waitForTimeout(200);
  if (!page.url().includes("index.html")) {
    fail(`the bottom button is actionframe 2, which 0x45e1e0 takes to [0x46b208] = 5 and 0x404303 out of the level`);
  }
  console.log(`ok    the bottom button leaves the level, which is 0x404303's only exit`);

  // ---- and the menu's Open takes a file ----------------------------------
  const path = join(mkdtempSync(join(tmpdir(), "skl-")), "probe.skl");
  writeFileSync(path, writeSkl({ level: 9, score: 24680, lives: 2, weapon: 0xc, rounds: 17 }));

  const menu = await context.newPage();
  menu.on("pageerror", (e) => fail(`the menu threw: ${e.message}`));
  const logEl = menu.locator("#log");
  const logged = async (): Promise<string> => (await logEl.textContent()) ?? "";
  await menu.goto(`${BASE}/index.html`);
  const start = menu.locator("#start");
  await start.waitFor({ timeout: 40_000 });
  for (let i = 0; i < 200 && (await start.isDisabled()); i++) await menu.waitForTimeout(200);
  await start.click();
  await menu.locator("#screen").waitFor({ state: "visible", timeout: 40_000 });
  // cyber and imain run for minutes; ESC is what their own header bit permits
  for (let i = 0; i < 200 && !/menu\.mov: \d+ segment/i.test(await logged()); i++) {
    await menu.keyboard.press("Escape");
    await menu.waitForTimeout(400);
  }
  const mbox = (await menu.locator("#screen").boundingBox())!;
  const chooser = menu.waitForEvent("filechooser", { timeout: 20_000 }).catch(() => null);
  // "frame 3", Open, is (114,327)-(143,492) — menu.mov is full screen, origin 0
  await menu.mouse.click(mbox.x + (400 / 512) * mbox.width, mbox.y + (128 / 384) * mbox.height);
  const fc = await chooser;
  if (!fc) fail(`the menu's "frame 3" is 0x45df8d, which opens a file dialog; none appeared`);
  await fc.setFiles(path);
  let told = "";
  for (let i = 0; i < 100 && !told; i++) {
    await menu.waitForTimeout(100);
    told = /open: [^\n]*/.exec(await logged())?.[0] ?? "";
  }
  if (!/cavern \(scene 5, stage 3\)/.test(told) || !/24680 points/.test(told)) fail(`the menu read "${told}"`);
  // ...and a loaded game goes through the chooser, because 0x45e071 sets the
  // same -1 Begin does and the file carries no character
  let sawChooser = false;
  for (let i = 0; i < 100 && !sawChooser; i++) {
    await menu.waitForTimeout(100);
    sawChooser = /char\.mov: \d+ segment/i.test(await logged());
  }
  if (!sawChooser) fail(`0x45e071 sets [0x46b208] to -1, the value Begin sets, so a load runs the chooser too`);
  console.log(`ok    the menu's Open takes the file — ${told.replace("open: ", "")} — and asks which Skull Cracker`);

  await finish(browser);
  console.log("PASS  the pause panel is the disc's own three buttons, and the dialogs either side of a save work");
};

await main();
