/**
 * RAVECAVE — level eleven, and the level that asks for no kills at all.
 *
 *   npm run dev -w skullcracker                     # in one terminal
 *   npm run test:browser:ravecave -w skullcracker   # in another
 *
 * Chapter three's third stage stores the whole census as its allowance
 * (`0x4218ca`), so the goal is open from the first frame and everything in the
 * level is optional. What is in it that is new:
 *
 *   - **Igor** (`0x41ee40`), three of them and all three here. Two hundred
 *     health, 350 points, and a retreat script — `0x46fea0`, five records whose
 *     every dx is NEGATIVE, the walk run backwards.
 *   - **the wraith** (`0x41ec80`), of which the game has exactly one. Seven
 *     hundred health, and worth **nothing**: `0x424f80` has no `0x40d450` in it
 *     anywhere, which no other class in the game can say.
 *   - **the scepter** (`statscepter`), the fourth chapter weapon, whose pickup
 *     arms you with `0x45eed0(0x10)` — weapon 16, not 17.
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
  const go = async (x?: number): Promise<void> => {
    await page.goto(`${BASE}/walk.html?level=11${x === undefined ? "" : `&x=${x}`}`);
    await hud.filter({ hasText: /room \d+ of \d+/ }).waitFor({ timeout: 30_000 });
    // ...and then wait for the player to stop falling. A flat pause is not
    // enough on a cold load, and a probe that reads the position mid-fall reads
    // a y that no rect in the file contains.
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

  // 1. four regions, a census of four, and a share of nothing
  await go();
  if (!/room \d+ of 4/.test(await say())) fail(`RAVECAVE has four regions; the HUD says ${/room[^·]*/.exec(await say())?.[0]}`);
  if (!/kill 0% of 4/.test(await say())) fail(`three Igors and one wraith count and its 27 bats do not; the census is ${/kill[^·)]*/.exec(await say())?.[0]}`);
  if (!/quota 0 of 0/.test(await say())) fail(`a share of nothing leaves the whole census standing: ${/quota[^·]*/.exec(await say())?.[0]}`);
  console.log(`ok    RAVECAVE is four regions, a census of four, and a level that asks for no kills`);

  // 2. its own clock — 2500, out of the timer record at x7914
  const clock = Number(/clock (\d+)/.exec(await say())?.[1] ?? 0);
  if (clock < 2400 || clock > 2500) fail(`RAVECAVE's timer record carries 2500; the panel says ${clock}`);
  console.log(`ok    and its timer record gives it ${clock} frames`);

  // 3. Igor: two hundred health, 350 points
  await go(9080);
  await page.waitForTimeout(600);
  if (!/nearest initigor 200\/200hp/.test(await say())) fail(`0x41ee8e gives it 0x40e300(0xc8); the bar reads ${/initigor [^ ]*/.exec(await say())?.[0]}`);
  const igorPay = await fight("initigor", 400);
  if (igorPay !== 350) fail(`0x4257c5 pays 0x15e for an Igor; the score reads ${igorPay}`);
  console.log(`ok    an Igor is two hundred health and ${igorPay} points`);

  // 4. the wraith — seven hundred, and nothing for it
  await go(13000);
  await page.waitForTimeout(600);
  if (!/nearest initwraith 700\/700hp/.test(await say())) fail(`0x41ece3 gives it 0x40e300(0x2bc); the bar reads ${/initwraith [^ ]*/.exec(await say())?.[0]}`);
  const wraithPay = await fight("initwraith", 900);
  if (!/initwraith .*dead|initwraith -/.test(await say())) fail(`never felled the wraith; the bar reads ${/initwraith [^ ]*/.exec(await say())?.[0]}`);
  if (wraithPay !== 0) fail(`0x424f80 pays nothing at all; the score moved by ${wraithPay}`);
  console.log(`ok    the wraith is seven hundred health and pays nothing — the only class in the game that does`);

  // 5. the scepter, which arms you with weapon SIXTEEN and not seventeen:
  //    `0x428950`'s case pushes 0x10 outright rather than the code it was given
  await go(13600);
  if (!/statscepter at x 13690, y 9840 IN REACH/.test(await say())) fail(`the scepter should be in reach from x13600`);
  await page.keyboard.down("s");
  await page.waitForTimeout(900);
  await page.keyboard.up("s");
  await page.waitForTimeout(300);
  if (!/holding scepter 1\/160/.test(await say())) fail(`0x45eed0(0x10) arms you with one round of 160; the panel says ${/· (holding|no) \w+ \d+\/\d+/.exec(await say())?.[0]}`);
  const idle = new Set<number>();
  for (let i = 0; i < 10; i++) {
    await page.waitForTimeout(60);
    idle.add(Number(/· cel (\d+)/.exec(await say())?.[1] ?? 0));
  }
  if (!idle.has(3300)) fail(`the scepter's own idle is 0x470c40 tag 8, cel 3300; saw ${[...idle].join(" ")}`);
  console.log(`ok    and the scepter arms you as weapon 16, on its own moveset`);

  /**
   * ...and the wraith has a MACHINE, which this page fought without.
   *
   * `0x424800` reads the same tracker the claw does and bands it against
   * `0x46f8f8` — 700, 230, 130, 60. Inside sixty it does nothing but hang there
   * (`0x424c07`); between sixty and 230 it picks a move; over 230 it closes.
   */
  await go(12900);
  const modes = new Set<string>();
  const cels = new Set<number>();
  let beam = false;
  for (let i = 0; i < 150; i++) {
    const t = await say();
    const w = /nearest initwraith [^·]*/.exec(t)?.[0] ?? "";
    const m = /mode (\w+)/.exec(w)?.[1];
    if (m) modes.add(m);
    const c = /cel (\d+)/.exec(w)?.[1];
    if (c) cels.add(Number(c));
    if (/· stream \w+ cel 32\d\d/.test(t)) beam = true;
    await page.waitForTimeout(120);
  }
  // which move it picks is `0x434540`'s business and the band decides which
  // four are on offer, so this asks for the shape rather than for named moves:
  // several distinct states, the close, and the cast that proves the beam
  if (modes.size < 3) fail(`it should work through its own states; it only did ${[...modes].join(" ")}`);
  if (!modes.has("close")) fail(`over 230 it closes; it never did — ${[...modes].join(" ")}`);
  if (!modes.has("cast")) fail(`it should cast; it only did ${[...modes].join(" ")}`);
  if (!beam) fail(`0x424d77 calls the scepter's own fire function; no beam ever came out`);
  console.log(`ok    and it works its own bands — ${[...modes].sort().join(" ")} — and casts the scepter's beam`);

  /**
   * ...and inside sixty it only HOVERS, and it takes hold of nothing.
   *
   * `0x424c54` writes -3 into its strength and that reads like the grab, but
   * `0x4248a9` is the function's only exit and writes a hundred back before it
   * returns. Both -3 writes are dead in the shipped binary. Built the other way
   * round first, and two hundred and sixty kicks took nothing off it.
   */
  await go(13000);
  let hovered = "";
  for (let i = 0; i < 60; i++) {
    const t = await say();
    if (/· HELD|· code -3/.test(t)) fail(`the wraith's -3 is overwritten by 0x4248ad; it should hold nothing`);
    if (/mode hover/.test(t)) hovered = t;
    await page.waitForTimeout(120);
  }
  if (!hovered) fail(`inside sixty it should hover and nothing else (0x424c07)`);
  console.log(`ok    ...and inside sixty it only hovers, and takes hold of nothing — 0x4248ad writes 100 back`);

  await finish(browser);
  console.log("PASS  RAVECAVE's Igors, its one wraith and its scepter are all where the records put them");
};

await main();
