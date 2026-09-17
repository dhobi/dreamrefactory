/**
 * LAB — level fifteen.
 *
 *   npm run dev -w skullcracker                # in one terminal
 *   npm run test:browser:lab -w skullcracker   # in another
 *
 * Forty-five records and three new classes, and `lab.snd` names all three:
 *
 *   - **Puke Boy** (`initpuke`), `#0061 Pukeboy d[ies]` — four hundred health,
 *     440 points, and a run whose eight records carry 186, 93, 186, 93, 279, 93,
 *     279, 93. Nothing else in the game alternates its stride.
 *   - **the arm** (`initarm`), `#2013 arm hit` — ten of them, and no health at
 *     all: `0x418b40` sprays, sounds, pays 113 and subtracts nothing. One blow,
 *     whatever the blow. It does not count towards the census.
 *   - **the test tube** (`inittube`), `#0201 test tube` — one in the game, with
 *     twelve hundred health, the player's own number, and no award.
 */
import { fail, finish, launch } from "./harness";

const BASE = process.env.BASE ?? "http://localhost:5178";

const main = async (): Promise<void> => {
  const browser = await launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on("pageerror", (e) => fail(`page threw: ${e.message}`));
  const hud = page.locator("#hud");

  const say = async (): Promise<string> => (await hud.textContent()) ?? "";
  const at = async (): Promise<number> => Number(/· x (-?\d+), y/.exec(await say())?.[1] ?? NaN);
  const go = async (q: string): Promise<void> => {
    await page.goto(`${BASE}/walk.html?level=15${q}`);
    await hud.filter({ hasText: /room \d+ of \d+/ }).waitFor({ timeout: 30_000 });
    await page.waitForTimeout(400);
    let last = "";
    for (let i = 0; i < 25; i++) {
      const now = /· x (-?\d+), y (-?\d+)/.exec(await say())?.[0] ?? "";
      if (now && now === last) return;
      last = now;
      await page.waitForTimeout(120);
    }
  };
  const fight = async (kind: string, tries: number): Promise<number> => {
    const before = Number(/(\d+) points/.exec(await say())?.[1] ?? 0);
    let lastX: number | null = null;
    let missed = 0;
    for (let i = 0; i < tries; i++) {
      await page.waitForTimeout(40);
      const m = new RegExp(`nearest ${kind} (-?\\d+)/(\\d+)hp (\\w+) at x (-?\\d+)`).exec(await say());
      if (!m) {
        if (++missed > 40 || lastX === null) break;
      } else {
        missed = 0;
        if (m[3] === "dead") break;
        lastX = Number(m[4]);
      }
      const d = lastX! - (await at());
      if (Math.abs(d) < 90) {
        await page.keyboard.press("k");
        await page.waitForTimeout(190);
      } else {
        const key = d > 0 ? "ArrowRight" : "ArrowLeft";
        await page.keyboard.down(key);
        await page.waitForTimeout(80);
        await page.keyboard.up(key);
      }
    }
    await page.waitForTimeout(600);
    return Number(/(\d+) points/.exec(await say())?.[1] ?? 0) - before;
  };

  // 1. three regions — two of them named `lab1` and `lab2` — and a census of
  //    seven: six Puke Boys and one test tube. The ten arms do not count.
  await go("");
  if (!/room \d+ of 3/.test(await say())) fail(`LAB has three regions; the HUD says ${/room[^·]*/.exec(await say())?.[0]}`);
  if (!/kill 55% of 7/.test(await say())) fail(`six pukes and one tube count and ten arms do not; the census is ${/kill[^·)]*/.exec(await say())?.[0]}`);
  const clock = Number(/clock (\d+)/.exec(await say())?.[1] ?? 0);
  if (clock < 2400 || clock > 2500) fail(`LAB's timer record carries 2500; the panel says ${clock}`);
  console.log(`ok    LAB is three regions, a census of seven, and ${clock} frames`);

  // 2. Puke Boy — four hundred health, 440 points
  await go("&x=560");
  if (!/nearest initpuke 400\/400hp/.test(await say())) fail(`0x411753 gives it 0x40e300(0x190); the bar reads ${/initpuke [^ ]*/.exec(await say())?.[0]}`);
  const pukePay = await fight("initpuke", 500);
  if (pukePay !== 440) fail(`0x418335 pays 0x1b8 for a Puke Boy; the score reads ${pukePay}`);
  console.log(`ok    a Puke Boy is four hundred health and ${pukePay} points`);

  // 3. an arm — frail, and 113 for it
  await go("");
  let armSeen = false;
  for (let i = 0; i < 30; i++) {
    await page.waitForTimeout(100);
    if (/nearest initarm 1\/1hp/.test(await say())) {
      armSeen = true;
      break;
    }
    await page.keyboard.down("ArrowRight");
    await page.waitForTimeout(100);
    await page.keyboard.up("ArrowRight");
  }
  if (!armSeen) fail(`LAB places ten arms, each with no health to subtract; the HUD never named one`);
  const armPay = await fight("initarm", 200);
  if (armPay !== 113) fail(`0x418bc3 pays 0x71 for an arm; the score reads ${armPay}`);
  console.log(`ok    an arm falls to one blow of any size, for ${armPay} points`);

  // 4. the test tube — the player's own twelve hundred, and nothing for it
  await go("&x=8150");
  const tube = /nearest inittube (-?\d+)\/(\d+)hp/.exec(await say());
  if (!tube) fail(`LAB's one test tube stands at x8204; the HUD names ${/nearest [^·]*/.exec(await say())?.[0]}`);
  if (tube![2] !== "1200") fail(`0x411be4 gives it 0x40e300(0x4b0); the bar reads ${tube![0]}`);
  console.log(`ok    the test tube carries the player's own twelve hundred health`);

  await finish(browser);
  console.log("PASS  LAB's Puke Boys, its ten arms and its one test tube are all where the records put them");
};

await main();
