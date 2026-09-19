/**
 * The high-score board, which is on the MENU and not on the death screen.
 *
 *   npm run dev -w skullcracker                   # in one terminal
 *   npm run test:browser:scores -w skullcracker   # in another
 *
 * `0x403340` is the state the seven kill vignettes belong to, and what it does
 * after the film is the ending: `0x40d4d0` fetches `[0x4a4f00]`, `0x40f650`
 * offers it to that difficulty's ten rows, and the shell goes back to the title.
 * `0x45de89` then draws the board over `menu.mov` while its frame index is
 * 0…0xa7 — the attract loop, which stops exactly where the six button stubs
 * begin at index 168.
 *
 * So this walks the whole chain: earn a score, spend three lives, answer the
 * dialog `0x46bf4d` names, and read the board off the title screen.
 *
 * The board is seeded first, because the interesting half of `0x40f650` is the
 * INSERT — `0x40f6b6` finds the first row whose score is under yours and
 * `0x40f6d6` shifts the rest down — and an empty board cannot show that.
 */
import { BASE, fail, finish, launch } from "./harness";

const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.on("pageerror", (e) => fail(`page threw: ${e.message}`));
page.on("dialog", (d) => void d.accept("ACE"));
const hud = page.locator("#hud");

const say = async (): Promise<string> => (await hud.textContent()) ?? "";
const loc = async (): Promise<string> => {
  try {
    return (await page.locator("#loc").textContent({ timeout: 2000 })) ?? "";
  } catch {
    return "";
  }
};

// 1. seed the medium board. Ten rows of `{ name, score, level }` is what
//    `0x4a4d80` holds; two of them filled is enough to make the shift visible.
const seeded = JSON.stringify({
  "1": Array.from({ length: 10 }, () => ({ name: "", score: 0, level: 0 })),
  "0": [
    { name: "BOSS", score: 9000, level: 9 },
    { name: "MID", score: 1000, level: 2 },
    ...Array.from({ length: 8 }, () => ({ name: "", score: 0, level: 0 })),
  ],
  "-1": Array.from({ length: 10 }, () => ({ name: "", score: 0, level: 0 })),
});
// ...and seeded AFTER the page is up rather than through an init script, which
// would run again on the navigation to the title and overwrite the row the game
// had just written. `died()` reads the board when it needs it, not at load.
await page.goto(`${BASE}/walk.html?level=1&x=1715&y=1071&damage=1`);
await hud.filter({ hasText: /room \d+ of \d+/ }).waitFor({ timeout: 30_000 });
await page.evaluate((raw) => localStorage.setItem("skullcracker.scores", raw), seeded);
await page.waitForTimeout(1500);
const points = Number(/(\d+) points/.exec(await say())?.[1] ?? -1);
if (points !== 2000) fail(`standing on that scoreup should pay 2000; the panel says ${points}`);
console.log(`ok    the level pays ${points}, which is what has to reach the board`);

/** three `harakari` — 500 a time out of 1200 — which is one life */
const spendALife = async (): Promise<void> => {
  for (let i = 0; i < 3; i++) {
    await page.waitForTimeout(900);
    for (const ch of "harakari") {
      await page.keyboard.press(ch);
      await page.waitForTimeout(40);
    }
    await page.waitForTimeout(500);
  }
  // the vignette, and then either the level again or the front door
  await page.waitForTimeout(1000);
};

// 3. three lives, and the third is the one that ends the game
const livesAt = async (): Promise<number> => Number(/· (\d+) (?:life|lives)/.exec(await say())?.[1] ?? NaN);
if ((await livesAt()) !== 3) fail(`a level starts with three lives; the panel says ${await livesAt()}`);
await spendALife();
await hud.filter({ hasText: /room \d+ of \d+/ }).waitFor({ timeout: 60_000 });
await page.waitForTimeout(800);
if ((await livesAt()) !== 2) fail(`the first death should cost a life; the panel says ${await livesAt()}`);
console.log(`ok    harakari three times is one life — ${await livesAt()} left`);

await spendALife();
await hud.filter({ hasText: /room \d+ of \d+/ }).waitFor({ timeout: 60_000 });
await page.waitForTimeout(800);
await spendALife();

// 4. ...and the last one hands the game to the front, which is `0x4033ee`
for (let i = 0; i < 120 && !/index\.html|\/$/.test(new URL(page.url()).pathname); i++) await page.waitForTimeout(500);
if (/walk\.html/.test(page.url())) fail(`the last life should hand the game back to the front; still at ${page.url()}`);
console.log(`ok    and the last of them ends the game at ${new URL(page.url()).pathname}`);

// 5. the title screen, and the board over its attract loop
await page.waitForFunction(() => !(document.getElementById("start") as HTMLButtonElement).disabled, null, {
  timeout: 180_000,
});
await page.click("#start");
for (let i = 0; i < 40 && !/menu\.mov/i.test(await loc()); i++) {
  await page.keyboard.press("Escape");
  await page.waitForTimeout(1200);
}
if (!/menu\.mov/i.test(await loc())) fail(`the sequence should reach the menu; #loc says "${await loc()}"`);
const board = await loc();
if (!/· board Med ·/.test(board)) fail(`0x46b20c is 0 here, so the lit label is Med; #loc says "${board}"`);
if (!/1 BOSS 9000 9/.test(board)) fail(`9000 keeps the top row; #loc says "${board}"`);
if (!/2 ACE 2000 1/.test(board)) fail(`2000 belongs between 9000 and 1000, on the level it ended in; "${board}"`);
if (!/3 MID 1000 2/.test(board)) fail(`0x40f6d6 shifts the rest down; #loc says "${board}"`);
console.log(`ok    the board took it — ${/· board .*/.exec(board)?.[0].slice(0, 90)}`);

console.log(`\nPASS  a finished game writes to the board, and the title screen is where it is read`);
await finish(browser);
