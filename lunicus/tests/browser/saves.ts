/**
 * Saved games on the real page: the Load button (File ▸ Open) and the panel's
 * save button, through the shared dialog (engine/src/web/save-browser.ts) and
 * the browser's own store, in drive mode so the clock is the test's.
 *
 *   npm run dev -w lunicus                                  (port 5180)
 *   npx tsx tests/browser/saves.ts                          (from lunicus/)
 *
 * A new game from the title; the port's day saves listed, and Day 4 opened
 * onto its lower floor; the save button on it, a name typed, the file kept;
 * and that file opened again, into the same game.
 */
import { chromium, type Page } from "playwright";
import { SCREEN_H, SCREEN_W } from "../../src/game/data";

const APP = process.env.APP_URL ?? "http://localhost:5180/";
interface DriveState {
  t: number;
  phase: string;
  level: number;
  progress: number;
  score: number;
}
const fail = (why: string): never => {
  console.log(`FAIL  ${why}`);
  process.exit(1);
};
const ok = (what: string): void => console.log(`ok    ${what}`);

const browser = await chromium.launch();
const page: Page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
page.on("pageerror", (e) => fail(`the page threw: ${e.message}`));
page.on("dialog", (d) => void d.accept());
await page.goto(`${APP}?drive&seed=1994`);
await page.waitForSelector("#boot.ready", { timeout: 120_000 });
await page.click("#start");
await page.waitForFunction(() => (window as unknown as { lunicusDrive?: { running(): boolean } }).lunicusDrive?.running());

const state = (): Promise<DriveState> => page.evaluate(() => (window as unknown as { lunicusDrive: { state(): DriveState } }).lunicusDrive.state());
const to = (t: number): Promise<DriveState> => page.evaluate((t) => (window as unknown as { lunicusDrive: { to(t: number): DriveState } }).lunicusDrive.to(t), t);
/** tick in steps a frame's worth apart until `done`, letting the page's own promises (fetches, the dialog) run between */
async function until(done: (s: DriveState) => boolean, what: string, max = 20_000): Promise<DriveState> {
  let s = await state();
  for (const end = s.t + max; s.t < end; ) {
    if (done(s)) return s;
    s = await to(s.t + 30);
    await page.waitForTimeout(5);
  }
  return done(s) ? s : fail(`no ${what} by tick ${s.t}: ${JSON.stringify(s)}`);
}
const box = (await page.locator("#screen").boundingBox())!;
const click = (x: number, y: number): Promise<void> => page.mouse.click(box.x + ((x + 0.5) * box.width) / SCREEN_W, box.y + ((y + 0.5) * box.height) / SCREEN_H);

// a new game: the title, and a click on it
await until((s) => s.phase === "title" && s.t > 3200, "title");
await click(192, 132);
await until((s) => s.phase === "base", "new game's first floor");
ok("a new game from the title");

// File ▸ Open: the port's day saves are listed
await page.click("#loadBtn");
await page.waitForSelector("#saveModal .save-row");
const names = await page.locator("#saveModal .save-name").allTextContents();
for (const d of [2, 3, 4, 5, 6]) if (!names.includes(`Day ${d}`)) fail(`the saved games list no "Day ${d}": ${names.join(", ")}`);
ok(`the saved games: ${names.join(", ")}`);
await page.locator("#saveModal .save-name", { hasText: "Day 4" }).click();
const day4 = await until((s) => s.phase === "base" && s.level === 14, "day four's lower floor");
ok(`Day 4 opened: level ${day4.level}, progress ${day4.progress}`);

// the save button (the panel's floppy): the dialog, a name, Save
await click(64 + 32, 0x147 + 20);
// the game takes the press on its next ticks, and the dialog comes up
await to((await state()).t + 10);
await page.waitForSelector("#saveModal #saveNameInput", { state: "visible" });
await page.fill("#saveModal #saveNameInput", "probe");
await page.click("#saveModal #saveConfirmBtn");
await page.waitForSelector("#saveModal #saveNameInput", { state: "hidden" });
await to((await state()).t + 60);
ok("the save button: the dialog, \"probe\", saved");

// and the file is the game: open it again
await page.click("#loadBtn");
await page.locator("#saveModal .save-name", { hasText: "probe" }).click();
const again = await until((s) => s.phase === "base" && s.t > day4.t + 200 && s.level === 14, "the probe save opened");
if (again.progress !== day4.progress || again.score !== day4.score) fail(`the probe save opened into ${JSON.stringify(again)}, not day four's ${JSON.stringify(day4)}`);
ok(`"probe" opened: level ${again.level}, progress ${again.progress}, score ${again.score}`);
console.log("PASS  saved games on the page");
await browser.close();
