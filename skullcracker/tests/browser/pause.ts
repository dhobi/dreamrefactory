/**
 * The PAUSE PANEL, and the saved game it writes.
 *
 *   npm run dev -w skullcracker                  # in one terminal
 *   npm run test:browser:pause -w skullcracker   # in another
 *
 * `0x403c7b` is the only caller of `0x404280`, and every number below is either
 * in `SC.EXE` or in the four films themselves:
 *
 *   - which film is `[0x4abdfe] - 3` through the jump table at `0x4042af`, so
 *     the four chapters get `pauseA`..`pauseD` and this asserts all four;
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
 * ## What the save is
 *
 * Twenty-two bytes, no header and no checksum — see `src/savegame.ts`. The probe
 * takes `showSaveFilePicker` away before the page loads, because headless
 * Chromium rejects it with `AbortError`, which is exactly what a reader
 * CANCELLING looks like; the page then falls back to a download, writing the
 * same blob, and the bytes are what this checks.
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

  /** open a level and put the panel up, waiting for its LOOP to start */
  const open = async (level: number, how: "Escape" | "ctrlq" | "ctrldot"): Promise<string> => {
    await page.goto(`${BASE}/walk.html?level=${level}`);
    await hud.filter({ hasText: /room \d+ of \d+/ }).waitFor({ timeout: 30_000 });
    await page.waitForTimeout(400);
    if (how === "Escape") await page.keyboard.press("Escape");
    else await page.keyboard.press(how === "ctrlq" ? "Control+q" : "Control+.");
    // frames 1 and 2 are the panel arriving and carry no regions at all
    for (let i = 0; i < 150; i++) {
      await page.waitForTimeout(100);
      if (/pause/i.test(await say()) && (await frameNow()) >= 6) return say();
    }
    return say();
  };
  const tap = async (x: number, y: number): Promise<void> => {
    const box = (await page.locator("#screen").boundingBox())!;
    await page.mouse.click(box.x + (x / 512) * box.width, box.y + (y / 384) * box.height);
  };

  // ---- one film a chapter, and each of them loops -------------------------
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
    const at = await frameNow();
    const total = Number(/frame \d+\/(\d+)/.exec(up)?.[1] ?? 0);
    // ...and it must still be running well after its own last frame is due
    await page.waitForTimeout(6000);
    const later = await frameNow();
    if (!/pause/i.test(await say())) fail(`${want} ran out; its last logic frame is a type-2 jump back to "X 3"`);
    if (later === at) fail(`${want} is not advancing — it stopped on frame ${at} of ${total}`);
    console.log(`ok    chapter ${Math.floor((level - 1) / 4) + 1} raises ${want}, ${total} frames, looping (${at} -> ${later})`);
  }

  // ---- and the disc's own two keys reach it -------------------------------
  for (const how of ["ctrlq", "ctrldot"] as const) {
    const up = await open(2, how);
    if (!/pause/i.test(up)) fail(`${how === "ctrlq" ? "Ctrl+Q" : "Ctrl+."} is 0x403ea4's own; the panel did not open`);
  }
  console.log(`ok    ...and Ctrl+Q and Ctrl+. open it, which is what 0x403ea4 binds`);

  // ---- the top button is Continue ----------------------------------------
  await open(2, "Escape");
  await tap(BUTTONS.x, BUTTONS.continue);
  await page.waitForTimeout(1200);
  if (/pause/i.test(await say())) fail(`the top button is named by neither actionframe: the film ends and the level resumes`);
  if (!/level 2 · city/.test(await say())) fail(`Continue should put the level back: ${(await say()).slice(0, 60)}`);
  console.log(`ok    the top button resumes — no actionframe, so 0x404303 finds the state unchanged`);

  // ---- the middle button is Save, and these are the bytes -----------------
  await open(2, "Escape");
  const download = page.waitForEvent("download", { timeout: 20_000 }).catch(() => null);
  await tap(BUTTONS.x, BUTTONS.save);
  const got = await download;
  await page.waitForTimeout(1200);
  if (!got) fail(`the middle button is actionframe 1, which 0x45e1e0 takes to GetSaveFileNameA; nothing was written`);
  const bytes = new Uint8Array(readFileSync((await got.path())!));
  if (bytes.length !== SKL.bytes) fail(`0x45e30f writes ${SKL.bytes} bytes in one call; this file is ${bytes.length}`);
  const save = readSkl(bytes);
  if (!save) fail(`the file this page just wrote does not read back`);
  // CITY is the second level, which is chapter one's stage 3 and nothing else
  if (save.scene !== 3 || save.stage !== 3 || save.level !== 1) {
    fail(`CITY is scene 3 stage 3 by 0x44da38's own table; the file says scene ${save.scene} stage ${save.stage}`);
  }
  // ...and the rest is what the level was actually holding
  const line = await say();
  const points = Number(/· (\d+) points/.exec(line)?.[1] ?? -1);
  const lives = Number(/· (\d+) (?:life|lives)/.exec(line)?.[1] ?? -1);
  if (save.score !== points) fail(`the score is [0x4a4f00] at +8; the panel says ${points} and the file says ${save.score}`);
  if (save.lives !== lives) fail(`the lives are [0x4a4d64] at +0xc; the panel says ${lives} and the file says ${save.lives}`);
  // chapter one's entry function names the flamer and gives it nothing
  if (save.weapon !== 0xa) fail(`0x44dac0 makes chapter one's weapon 0xa; the file says ${save.weapon}`);
  console.log(
    `ok    the middle button writes ${bytes.length} bytes — scene ${save.scene}, stage ${save.stage} (city), ` +
      `${save.score} points, ${save.lives} lives, weapon ${save.weapon}`,
  );

  // ---- the bottom button is Exit -----------------------------------------
  await open(2, "Escape");
  await tap(BUTTONS.x, BUTTONS.exit);
  for (let i = 0; i < 60 && !page.url().includes("index.html"); i++) await page.waitForTimeout(200);
  if (!page.url().includes("index.html")) {
    fail(`the bottom button is actionframe 2, which 0x45e1e0 takes to [0x46b208] = 5 and 0x404303 out of the level`);
  }
  console.log(`ok    the bottom button leaves the level, which is 0x404303's only exit`);

  // ---- and Open reads one back -------------------------------------------
  // a file of this page's own making rather than a fixture, so the writer and
  // the reader are held to the same twenty-two bytes
  const made = writeSkl({ level: 9, score: 24680, lives: 2, weapon: 0xc, rounds: 17 });
  const path = join(mkdtempSync(join(tmpdir(), "skl-")), "probe.skl");
  writeFileSync(path, made);

  const menu = await context.newPage();
  menu.on("pageerror", (e) => fail(`the menu threw: ${e.message}`));
  const logEl = menu.locator("#log");
  await menu.goto(`${BASE}/index.html`);
  const start = menu.locator("#start");
  await start.waitFor({ timeout: 40_000 });
  for (let i = 0; i < 200 && (await start.isDisabled()); i++) await menu.waitForTimeout(200);
  await start.click();
  await menu.locator("#screen").waitFor({ state: "visible", timeout: 40_000 });
  // cyber and imain run for minutes; ESC is what their own header bit permits
  for (let i = 0; i < 200; i++) {
    if (/menu\.mov: \d+ segment/i.test((await logEl.textContent()) ?? "")) break;
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
    await menu.waitForTimeout(200);
    told = /open: [^\n]*/.exec((await logEl.textContent()) ?? "")?.[0] ?? "";
  }
  // level 9 of sixteen, counted from zero, is chapter three's second: scene 5,
  // stage 3, which 0x41f5fc's own table calls CAVERN
  if (!/cavern \(scene 5, stage 3\)/.test(told)) fail(`the menu read "${told}"`);
  if (!/24680 points/.test(told) || !/2 lives/.test(told)) fail(`the menu read "${told}"`);
  // ...and a loaded game goes through the chooser, because 0x45e071 sets the
  // same -1 Begin does and the file carries no character
  let sawChooser = false;
  for (let i = 0; i < 100 && !sawChooser; i++) {
    await menu.waitForTimeout(200);
    sawChooser = /char\.mov: \d+ segment/i.test((await logEl.textContent()) ?? "");
  }
  if (!sawChooser) fail(`0x45e071 sets [0x46b208] to -1, the value Begin sets, so a load runs the chooser too`);
  console.log(`ok    the menu's Open reads one back — ${told.replace("open: ", "")}, and asks which Skull Cracker`);

  await finish(browser);
  console.log("PASS  the pause panel is the disc's own three buttons, and Save and Open agree on twenty-two bytes");
};

await main();
