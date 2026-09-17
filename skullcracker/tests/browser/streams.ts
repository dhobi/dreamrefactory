/**
 * The three HELD weapons — the flamer, the soaker and the scepter.
 *
 *   npm run dev -w skullcracker                     # in one terminal
 *   npm run test:browser:streams -w skullcracker    # in another
 *
 * They are one shape with three sets of numbers: the fire function adds an
 * object to a list the player owns, `0x421700` plants it at the player's own
 * point plus a filed `(dx, dy)` every frame, and two negative variants stop it —
 * `-2` for the shutting-off animation and `-1` for being hit.
 *
 * And they do not all hit with the same thing. The soaker's water and the
 * scepter's beam carry a hundred (`0x4217ba`, `0x424630`); the FLAME carries the
 * code -9 (`0x453b9b`), which nothing in these sixteen levels reads.
 */
import { BASE, fail, finish, launch } from "./harness";

const main = async (): Promise<void> => {
  const browser = await launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on("pageerror", (e) => fail(`page threw: ${e.message}`));
  const hud = page.locator("#hud");
  const say = async (): Promise<string> => (await hud.textContent()) ?? "";
  const num = async (re: RegExp): Promise<number> => Number(re.exec(await say())?.[1] ?? NaN);

  /** open a level, wait for the spawn to settle, then take what is underfoot */
  const armAt = async (level: number, x: number): Promise<void> => {
    await page.goto(`${BASE}/walk.html?level=${level}&x=${x}`);
    await hud.filter({ hasText: /room \d+ of \d+/ }).waitFor({ timeout: 30_000 });
    await page.waitForTimeout(400);
    let last = "";
    for (let i = 0; i < 25; i++) {
      const now = /· x (-?\d+), y (-?\d+)/.exec(await say())?.[0] ?? "";
      if (now && now === last) break;
      last = now;
      await page.waitForTimeout(120);
    }
    await page.keyboard.down("ArrowDown");
    await page.waitForTimeout(900);
    await page.keyboard.up("ArrowDown");
    await page.waitForTimeout(500);
  };

  // 1. GRAVE's soaker opens, loops and drains — one round an engine frame
  await armAt(9, 2058);
  if (!/holding soaker/.test(await say())) fail(`GRAVE's statsoaker should arm you: ${/· (no|holding)[^·]*/.exec(await say())?.[0]}`);
  const full = await num(/holding soaker (\d+)\/160/);
  const quotaWas = await num(/quota (\d+) of \d+/);
  // ...facing WEST, because the spout is filed 170 ahead of the player and its
  // own cel reaches another 200 past that: a stream has a dead zone in front of
  // it, and GRAVE's zombies are all to the west of the gun
  await page.keyboard.down("ArrowLeft");
  await page.waitForTimeout(1100);
  await page.keyboard.up("ArrowLeft");
  await page.waitForTimeout(200);
  await page.keyboard.down("p");
  await page.waitForTimeout(260);
  const opening = /stream (start|loop) cel (\d+)/.exec(await say());
  if (!opening) fail(`holding P should open a stream; the HUD says ${/· stream[^·]*/.exec(await say())?.[0] ?? "nothing"}`);
  if (!/98\d\d/.test(opening![2])) fail(`the soaker's own 9800..9807, not ${opening![2]}`);
  console.log(`ok    GRAVE's soaker opens on its own ${opening![2]}`);

  await page.waitForTimeout(700);
  if (!/stream loop/.test(await say())) fail(`the start animation ending installs tag 1 (0x4217a5); still ${/stream \w+/.exec(await say())?.[0]}`);
  const left = await num(/holding soaker (\d+)\/160/);
  if (!(left < full - 4)) fail(`0x45ef00(1) takes a round an engine frame; went ${full} -> ${left}`);
  console.log(`ok    ...loops on its tag 1, and drains ${full} to ${left} while it is held`);

  // 2. ...and it KILLS, at the magnitude of its own cel's pair
  await page.waitForTimeout(2500);
  const quotaNow = await num(/quota (\d+) of \d+/);
  await page.keyboard.up("p");
  if (!(quotaNow < quotaWas)) fail(`the water carries a hundred (0x4217ba) and should fell a zombie; quota stayed ${quotaWas}`);
  console.log(`ok    and it fells them — the quota went ${quotaWas} to ${quotaNow}`);

  // 3. an empty gauge shuts it off, and letting go does too
  await page.waitForTimeout(900);
  if (/· stream/.test(await say())) fail(`releasing P sends -2 and the stream should be gone: ${/· stream[^·]*/.exec(await say())?.[0]}`);
  console.log(`ok    ...and -2 puts it away when the button comes up`);

  // 4. the FLAME is a code. WOODS' statflamer is the one on the ground.
  await armAt(3, 6980);
  if (!/holding flamer/.test(await say())) fail(`WOODS' statflamer at x6980 should arm you: ${/· (no|holding)[^·]*/.exec(await say())?.[0]}`);
  const before = await num(/quota (\d+) of \d+/);
  // ...and read it before the gauge runs dry: forty-one rounds at one an engine
  // frame is under three seconds of flame
  await page.keyboard.down("p");
  await page.waitForTimeout(1400);
  const blow = /stream \w+ cel \d+ at x -?\d+, y -?\d+ blow (-?\d+)/.exec(await say());
  if (!blow) fail(`the flamer should be pouring; the HUD says ${/· stream[^·]*/.exec(await say())?.[0] ?? "nothing"}`);
  if (blow![1] !== "-9") fail(`0x453b9b gives the flame -9; the HUD says ${blow![1]}`);
  await page.waitForTimeout(1400);
  const after = await num(/quota (\d+) of \d+/);
  await page.keyboard.up("p");
  if (after !== before) fail(`a strength below 1 is not a blow; the quota went ${before} -> ${after}`);
  console.log(`ok    WOODS' flamer pours -9, and a full gauge of it kills nothing (${before} of the quota still)`);

  // 5. the scepter arms with the one round 0x45eed0 gives and spends forty
  await armAt(11, 13690);
  if (!/holding scepter 1\/160/.test(await say()))
    fail(`statscepter files no rounds (0x421b88), so 0x45eed0's single one is all of it: ${/· (no|holding)[^·]*/.exec(await say())?.[0]}`);
  await page.keyboard.down("p");
  await page.waitForTimeout(700);
  await page.keyboard.up("p");
  if (!/holding scepter 0\/160/.test(await say()))
    fail(`0x41f77f spends forty a shot, floored at zero: ${/· (no|holding)[^·]*/.exec(await say())?.[0]}`);
  console.log(`ok    and RAVECAVE's scepter fires its one round, spends forty for it, and is empty`);

  console.log(`\nPASS  all three held weapons pour, drain and stop, and only two of them hurt anything`);
  await finish(browser);
};

await main();
