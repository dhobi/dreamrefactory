/**
 * MAZE — level thirteen, and the first level of chapter four.
 *
 *   npm run dev -w skullcracker                 # in one terminal
 *   npm run test:browser:maze -w skullcracker   # in another
 *
 * Seven regions and none of them wider than 2696 pixels: the level is a ring of
 * corridors rather than a run, and four of its seven region records are named
 * `newroom1`…`newroom4` rather than `newroom`.
 *
 *   - **the TCop** (`initcop`), which `lab.snd` names outright: `#0084 TCop
 *     Dies`, `#0085 TCop eats`, three `TCop punc[h]`es. 250 health and **550
 *     points**, the most any creature outside a boss is worth.
 *   - **the slurp** (`initslurp`), twenty of them, sixty health, worth nothing,
 *     and one cel: `0x46d268`, `0x46d278` and `0x46d458` are three scripts of
 *     three kinds and every record in all three is 2550.
 *   - **the cage door and the switch**, which is SERVICE's lever told again —
 *     and thrown by the same hand: `0x414664` is inside the COP's think, so
 *     level thirteen's doors are opened by its guards.
 *   - **the alarms and the fans**, which keep their own counters and answer to
 *     nothing in the level at all.
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
  const at = async (): Promise<number> => Number(/· x (-?\d+), y/.exec(await say())?.[1] ?? NaN);
  const go = async (q: string): Promise<void> => {
    await page.goto(`${BASE}/walk.html?level=13${q}`);
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

  // 1. seven regions, a census of twenty-seven, and its own clock
  await go("");
  if (!/room \d+ of 7/.test(await say())) fail(`MAZE has seven regions; the HUD says ${/room[^·]*/.exec(await say())?.[0]}`);
  if (!/kill 35% of 27/.test(await say())) fail(`seven cops and twenty slurps count; the census is ${/kill[^·)]*/.exec(await say())?.[0]}`);
  const clock = Number(/clock (\d+)/.exec(await say())?.[1] ?? 0);
  if (clock < 3100 || clock > 3200) fail(`MAZE's timer record carries 3200; the panel says ${clock}`);
  console.log(`ok    MAZE is seven regions, a census of 27, and ${clock} frames on its own clock`);

  // 2. the TCop — 250 health and 550 points
  await go("&x=3400&y=7300");
  if (!/nearest initcop 250\/250hp/.test(await say())) fail(`0x4116b5 gives it 0x40e300(0xfa); the bar reads ${/initcop [^ ]*/.exec(await say())?.[0]}`);
  const copPay = await fight("initcop", 400);
  if (copPay !== 550) fail(`0x41490d pays 0x226 for a TCop; the score reads ${copPay}`);
  console.log(`ok    a TCop is 250 health and ${copPay} points — the most outside a boss`);

  // 3. the slurp — sixty health, one cel, and nothing for it
  await go("&x=2100&y=7600");
  if (!/nearest initslurp 60\/60hp/.test(await say())) fail(`0x411a74 gives it 0x40e300(0x3c); the bar reads ${/initslurp [^ ]*/.exec(await say())?.[0]}`);
  const cels = new Set<number>();
  for (let i = 0; i < 12; i++) {
    await page.waitForTimeout(60);
    const m = /nearest initslurp [^·]*? cel (\d+)/.exec(await say());
    if (m) cels.add(Number(m[1]));
  }
  if (cels.size !== 1 || !cels.has(2550)) fail(`a slurp is one cel whatever it is doing; saw ${[...cels].join(" ")}`);
  const slurpPay = await fight("initslurp", 200);
  if (slurpPay !== 0) fail(`0x415100 has no 0x40d450 in it; the score moved by ${slurpPay}`);
  console.log(`ok    a slurp is sixty health, one cel 2550, and pays nothing`);

  // 4. the cage doors: a shut one is an OBSTACLE, which is `0x411460` appending
  //    its own rect to the same table the level's `obstacle` records fill
  await go("&x=2100&y=7600");
  if (!/cage 4 shut cel 2010 at x1160/.test(await say())) fail(`the cage at x1160 opens shut on 2010`);
  if (!/cage 4 open cel 0 at x1859/.test(await say())) fail(`a record with a NEGATIVE param opens open, and draws nothing`);
  await page.keyboard.down("ArrowLeft");
  for (let i = 0; i < 40; i++) await page.waitForTimeout(80);
  await page.keyboard.up("ArrowLeft");
  await page.waitForTimeout(300);
  const stopped = await at();
  // the cage at x2061 is shut and its rect runs 2008..2115, so a walk west out
  // of x2115 does not start: 0x411460 has already made it wall
  if (stopped < 2000) fail(`the shut cage at x2061 should stop a walk west; got to x ${stopped}`);
  console.log(`ok    the shut cage at x2061 holds a walk at x ${stopped}, and the open one draws nothing`);

  // 5. ...and a COP opens one. `0x414664` is inside the cop's own think: within
  //    ten pixels of a switch it calls `0x412550`, which hands tag 3 to tag 0.
  await go("&x=3400&y=7300");
  const seen = new Set<string>();
  for (let i = 0; i < 50; i++) {
    await page.waitForTimeout(150);
    const m = /cage 1 (\w+) /.exec(await say());
    if (m) seen.add(m[1]);
    const w = /switch 1 (\w+)/.exec(await say());
    if (w) seen.add(`sw:${w[1]}`);
    if (seen.has("open")) break;
  }
  if (!seen.has("sw:on")) fail(`a cop should throw the switch at x3521; it showed ${[...seen].join(" ")}`);
  if (!seen.has("open")) fail(`and the cage at x3382 should open; it showed ${[...seen].join(" ")}`);
  console.log(`ok    a cop walks to the switch and throws it, and the cage opens: ${[...seen].join(" -> ")}`);

  // 6. the fans, which nothing in the level starts: 15 frames still, 60 turning
  await go("&x=3400&y=7300");
  const fans = new Set<string>();
  const fanCels = new Set<number>();
  for (let i = 0; i < 45; i++) {
    await page.waitForTimeout(100);
    const m = /fan h (\w+) cel (\d+)/.exec(await say());
    if (m) {
      fans.add(m[1]);
      fanCels.add(Number(m[2]));
    }
  }
  if (!fans.has("on") || !fans.has("off")) fail(`a fan is off for fifteen frames and on for sixty; it showed ${[...fans].join(" ")}`);
  if ([...fanCels].some((c) => c < 10020 || c > 10024)) fail(`0x46d478 is 10020..10024; saw ${[...fanCels].join(" ")}`);
  console.log(`ok    a fan turns itself on and off through ${[...fans].join(", ")} on its own counter`);

  await browser.close();
  console.log("PASS  MAZE's cops work its levers, its cages are wall, and its fans keep their own time");
};

void main().catch((e) => fail(String(e)));
