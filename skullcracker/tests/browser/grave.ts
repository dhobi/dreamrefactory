/**
 * GRAVE — level nine, and the first level of chapter three.
 *
 *   npm run dev -w skullcracker                  # in one terminal
 *   npm run test:browser:grave -w skullcracker   # in another
 *
 * One region, 6131 pixels of graveyard, and three things this port had none of:
 *
 *   - **the zombie** (`0x41eee0`), sixteen of them, and the biggest ordinary
 *     creature in the game so far: two hundred health against chapter two's 25 and
 *     40, a divisor of 10 against their 7, and 310 points each.
 *   - **the grave** (`0x41f0e0`), five of them, which is the only thing in the
 *     game that kills you without a blow. Shut, `0x4210bd` shoves you off it —
 *     but only while you are on your FEET; `0x4210a7` lets a jump through. Come
 *     within a hundred pixels of one and it opens, and from that frame it pulls.
 *   - **the hand** (`0x41f090`), four of them, and the record's `param` says
 *     which of two it is: 0 comes up under your own feet, 1 anywhere in its rect.
 *
 * And the level's own clock, which was in the books all along: a `timer` record,
 * whose `param` is the number. GRAVE's is 2100 against the full dial's 7200.
 */
import { chromium } from "playwright";

const BASE = process.env.BASE ?? "http://localhost:5178";

const fail = (why: string): never => {
  console.error(`FAIL  ${why}`);
  process.exit(1);
};

const main = async (): Promise<void> => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on("pageerror", (e) => fail(`page threw: ${e.message}`));
  const hud = page.locator("#hud");

  const say = async (): Promise<string> => (await hud.textContent()) ?? "";
  const at = async (): Promise<{ x: number; y: number }> => {
    const m = /· x (-?\d+), y (-?\d+)/.exec(await say());
    if (!m) fail(`no position in the HUD`);
    return { x: Number(m![1]), y: Number(m![2]) };
  };
  const go = async (x?: number): Promise<void> => {
    await page.goto(`${BASE}/walk.html?level=9${x === undefined ? "" : `&x=${x}`}`);
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

  // 1. it opens at its own initplayer, one region, and sixteen of one creature
  await go();
  if (!/room 1 of 1/.test(await say())) fail(`GRAVE is one region; the HUD says ${/room[^·]*/.exec(await say())?.[0]}`);
  const census = /kill 90% of (\d+)/.exec(await say());
  if (!census || Number(census[1]) !== 16) fail(`GRAVE places sixteen zombies; the census is ${census?.[1]}`);
  if (!/quota 14 of 14/.test(await say())) fail(`90% of 16 is 14: ${/quota[^·]*/.exec(await say())?.[0]}`);
  console.log(`ok    GRAVE is one region of sixteen zombies, and chapter three wants 90% of them`);

  // 2. the level's OWN clock. `0x421e94` hands `0x40d340` the timer record's
  //    param and nothing else; GRAVE's is 2100, not the full dial's 7200.
  const clock = Number(/clock (\d+)/.exec(await say())?.[1] ?? 0);
  if (clock < 2000 || clock > 2100) fail(`GRAVE's timer record carries 2100; the panel says ${clock}`);
  console.log(`ok    and its own timer record gives it ${clock} frames, not the full dial`);

  // 3. a zombie stands on the creator's one cel until the player's point is in
  //    its rect (`0x4203b3`), and it is a hundred health
  await go();
  await page.waitForTimeout(1500);
  const still = new Set<number>();
  for (let i = 0; i < 16; i++) {
    await page.waitForTimeout(60);
    const m = /nearest initzomb [^·]*? cel (\d+)/.exec(await say());
    if (m) still.add(Number(m[1]));
  }
  if (still.size !== 1 || !still.has(1800)) fail(`a dormant zombie holds 1800 and nothing else; saw ${[...still].join(" ")}`);
  if (!/initzomb 200\/200hp/.test(await say())) fail(`0x41ef34 gives it 0x40e300(0xc8); the bar reads ${/initzomb [^ ]*/.exec(await say())?.[0]}`);
  console.log(`ok    they stand dormant on cel 1800, two hundred health each`);

  // 4. ...and one felled, for what `0x420abf` pays
  await go(1050);
  await page.waitForTimeout(700);
  let dead = false;
  let lastX: number | null = null;
  let missed = 0;
  for (let i = 0; i < 300 && !dead; i++) {
    await page.waitForTimeout(40);
    const m = /nearest initzomb (-?\d+)\/(\d+)hp (\w+) at x (-?\d+)/.exec(await say());
    // the HUD names whichever thing is nearest in x, and sixteen zombies patrol
    // past each other: a frame in which another is nearer is not the fight ending
    if (!m) {
      if (++missed > 40 || lastX === null) break;
    } else {
      missed = 0;
      if (m[3] === "dead") {
        dead = true;
        break;
      }
      lastX = Number(m[4]);
    }
    const d = lastX! - (await at()).x;
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
  if (!dead) fail(`never felled a zombie`);
  await page.waitForTimeout(700);
  const points = Number(/(\d+) points/.exec(await say())?.[1] ?? 0);
  if (points !== 310) fail(`0x420abf pays 0x136 for one; the score reads ${points}`);
  console.log(`ok    one falls for ${points} points`);

  // 5. a grave is SHUT until the player's x comes within a hundred of its own,
  //    and `0x42115a` is the whole of that test
  await go(1380);
  if (!/grave shut cel 3310 at x1532/.test(await say())) fail(`the grave at x1532 opens shut on 3310`);
  if (Math.abs((await at()).x - 1532) >= 100) {
    // ...and 1380 is 152 away, so it is still shut. Step to 1460 and it is not.
  } else fail(`x1380 is 152 from the grave; the test is a hundred`);
  await go(1460);
  await page.waitForTimeout(400);
  if (!/grave (opening|open) cel 33\d+ at x1532/.test(await say()))
    fail(`inside a hundred it should be opening; the HUD says ${/grave[^·]*/.exec(await say())?.[0]}`);
  console.log(`ok    it is shut at 152 pixels and opening at 72 — 0x42115a's hundred`);

  // 6. ...and then it takes you. The ground beside a grave is already 98 below
  //    its point and `0x42121b`'s test is 86, so standing there when one opens
  //    is the whole of it: there is no health in the class at all.
  await go(1380);
  await page.keyboard.down("ArrowRight");
  let took = false;
  for (let i = 0; i < 40; i++) {
    await page.waitForTimeout(100);
    if (!/3 lives/.test(await say())) {
      took = true;
      break;
    }
  }
  await page.keyboard.up("ArrowRight");
  if (!took) fail(`walking into a grave should cost a life; the panel still says ${/\d lives/.exec(await say())?.[0]}`);
  console.log(`ok    and walking at one costs a life, with no blow anywhere in it`);

  // 7. the jump is the answer, and `0x4210a7` is why: off the ground, the shove
  //    does not apply
  await go(1380);
  await page.keyboard.down("w");
  await page.keyboard.down("ArrowRight");
  for (let i = 0; i < 60; i++) {
    await page.waitForTimeout(100);
    const here = await at();
    if (here.x > 1360 && here.x < 1460) await page.keyboard.press("j");
    if (!/3 lives/.test(await say()) || here.x > 1700) break;
  }
  await page.keyboard.up("ArrowRight");
  await page.keyboard.up("w");
  await page.waitForTimeout(400);
  const over = await at();
  if (!/3 lives/.test(await say())) fail(`a jump should clear a grave; it still took a life`);
  if (over.x < 1650) fail(`a jump should clear the grave at x1532; stopped at x ${over.x}`);
  if (!/grave open cel 3319 at x1532/.test(await say())) fail(`and it should be standing open behind you`);
  console.log(`ok    a jump clears it, and leaves it open at x ${over.x}`);

  // 8. the hands. The one at x794 is a param 0 — it comes up under your own
  //    feet, wherever those are, and holds for `0x4704b8`'s thirty frames.
  await go(760);
  await page.waitForTimeout(600);
  const hand = /hand (up|held|sinking) underfoot cel (\d+) at x(\d+)/.exec(await say());
  if (!hand) fail(`the hand at x794 should be up; the HUD says ${/hand[^·]*/.exec(await say())?.[0]}`);
  if (Number(hand![3]) < 740 || Number(hand![3]) > 790) fail(`a param-0 hand takes the player's own x; it came up at x${hand![3]}`);
  if (![1550, 1551, 1552, 1553, 1554, 1555, 1556].includes(Number(hand![2])))
    fail(`0x470400 tag 0 is 1550..1556; it is showing ${hand![2]}`);
  console.log(`ok    a hand comes up under the player's own feet, on cel ${hand![2]}`);

  await browser.close();
  console.log("PASS  GRAVE's zombies stand, its graves open and take, and its hands come up");
};

void main().catch((e) => fail(String(e)));
