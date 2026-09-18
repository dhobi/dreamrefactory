/**
 * The switch that lets things hit back — off unless you ask for it.
 *
 *   npm run dev -w skullcracker                   # in one terminal
 *   npm run test:browser:damage -w skullcracker   # in another
 *
 * Everything under test here is `SC.EXE`'s, and none of it runs by default. The
 * reason is the other eight suites: with damage on, walking east through WOODS
 * means three hydraulic presses, and a route test becomes a fight. So it ships
 * ready and dark behind `?damage=1` and Shift+H.
 *
 * What the file says, and what this checks:
 *
 *   - **twelve hundred at the middle difficulty.** `0x448ac2`:
 *     `trunc(difficulty * 600.0) + 0x4b0`, so 1800 / 1200 / 600.
 *   - **the damage IS the blow.** `0x4490d5` takes `0x42f910` of the hitter —
 *     the root of its cel's own blow pair — and `0x449209` spends exactly that.
 *     A hydraulic press carries `(dx 64, dy 5)` on cels 4382 and 4383, which is
 *     64, and 64 is over the one threshold there is.
 *   - **`cmp di, 0x3c`** at `0x449115`: sixty or less staggers, more knocks down.
 *   - **the reaction cels have no body box**, which is the whole of this engine's
 *     invulnerability — `0x4303b3` skips a victim whose current cel has none.
 *   - **the life is spent when the dying animation ends**, not when the health
 *     runs out (`0x443dea`).
 */
import { BASE, fail, finish, launch } from "./harness";

const main = async (): Promise<void> => {
  const browser = await launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on("pageerror", (e) => fail(`page threw: ${e.message}`));
  const hud = page.locator("#hud");

  const say = async (): Promise<string> => (await hud.textContent()) ?? "";
  const hp = async (): Promise<number> => Number(/damage ON (\d+)\/\d+hp/.exec(await say())?.[1] ?? -1);
  const cel = async (): Promise<number> => Number(/· cel (\d+)/.exec(await say())?.[1] ?? -1);
  const go = async (level: number, x: number, damage: boolean): Promise<void> => {
    await page.goto(`${BASE}/walk.html?level=${level}&x=${x}${damage ? "&damage=1" : ""}`);
    await hud.filter({ hasText: /room \d+ of \d+/ }).waitFor({ timeout: 30_000 });
    await page.waitForTimeout(700);
  };

  // 1. off by default, and it stays off standing in the worst place in the level
  await go(3, 7171, false);
  if (!/damage off/.test(await say())) fail(`the switch should start off: ${(await say()).slice(0, 150)}`);
  await page.waitForTimeout(5000);
  if (!/damage off/.test(await say())) fail(`it should still be off after five seconds under a press`);
  console.log(`ok    the switch starts off, and a press cannot touch the player`);

  // 2. Shift+H turns it on, at the engine's own figure. The shift is this page's:
  //    plain `h` is the first letter of `harakari`, and `0x403c1b` feeds every
  //    lowercase letter to the cheat accumulator before anything else looks at it
  await page.keyboard.press("Shift+H");
  await page.waitForTimeout(300);
  const max = /damage ON \d+\/(\d+)hp/.exec(await say())?.[1];
  if (max !== "1200") fail(`0x448ac2 gives 1200 at the middle difficulty; the panel says ${max}`);
  console.log(`ok    Shift+H turns it on and the player has ${max} health`);

  // 3. ...and so does the query, which is what the other suites would use
  await go(3, 7100, true);
  if (!/damage ON 1200\/1200hp/.test(await say())) fail(`?damage=1 should arm it full: ${(await say()).slice(0, 150)}`);
  console.log(`ok    and ?damage=1 arms it the same way`);

  // 4. the press lands for exactly the 64 its cels carry, and knocks the player
  //    down rather than staggering him, because 64 is over the threshold
  await page.keyboard.down("ArrowRight");
  const seen = new Set<number>();
  let after = 1200;
  for (let i = 0; i < 120; i++) {
    await page.waitForTimeout(60);
    const h = await hp();
    if (h >= 0) after = Math.min(after, h);
    seen.add(await cel());
  }
  await page.keyboard.up("ArrowRight");
  if (after >= 1200) fail(`walking under three presses should cost health; still ${after}`);
  if ((1200 - after) % 64 !== 0) fail(`a press costs 64 a time; the player lost ${1200 - after}`);
  // 940..949 is `0x4722a8` tag 2, the knockdown taken from behind — CHARACTER
  // 0's, which is the player this page runs. It read 5940..5944 before, which is
  // character 1's `0x476890`; see `src/codes.ts` for the two of them.
  if (![900, 901, 902, 903, 940, 943, 944, 946, 947, 948, 949].some((c) => seen.has(c))) {
    fail(`64 is over 0x3c, so it should knock down, not stagger; saw ${[...seen].filter((c) => c < 1000).join(" ")}`);
  }
  console.log(`ok    a press takes ${1200 - after} in 64s and knocks the player down`);

  // 5. run out of it and a life goes. Standing under a press is about twenty
  //    strokes, and the death film is what says the life was spent.
  await go(3, 7171, true);
  let died = false;
  for (let i = 0; i < 260 && !died; i++) {
    await page.waitForTimeout(250);
    if (/segment \d+\/\d+|press ESC to skip/.test(await say())) died = true;
  }
  if (!died) fail(`standing under a press should eventually kill the player`);
  console.log(`ok    and running out of it spends a life and plays its film`);

  await finish(browser);
  console.log("PASS  the damage switch is off by default, and the engine's own numbers when it is not");
};

await main();
