/**
 * PLAYGR — level four, and the first one that is a fight rather than a route.
 *
 *   npm run dev -w skullcracker                   # in one terminal
 *   npm run test:browser:playgr -w skullcracker   # in another
 *
 * Seventeen records, and that is the whole level: one room, one platform, two
 * `obstacle` walls holding its ends, seven dogs, three pickups and **one**
 * `initwbooly` standing in a territory that runs from x3762 to the edge of the
 * goal rect. Its kill share is the one that stores zero — `0x450156`, which is
 * "everything" — so the goal does not open until the census is empty, and the
 * census is the boss alone: the dog's creator never calls `0x42f870`, so the
 * seven of them are worth points and nothing else.
 *
 * What the file says, and what this checks:
 *
 *   - **the boss counts and the dogs do not.** `0x451080` calls `0x42f870(obj, 1)`
 *     in the boss's creator; nothing in the dog's does.
 *   - **eight hundred health**, from `push 0x320; call 0x40e300` at `0x4510ae`,
 *     which is more than three times the biggest thing in level three.
 *   - **the goal is shut until it is dead**, which is what a 100% share means.
 */
import { BASE, fail, finish, launch } from "./harness";

const near = (a: number, b: number, slack = 3): boolean => Math.abs(a - b) <= slack;

const main = async (): Promise<void> => {
  const browser = await launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on("pageerror", (e) => fail(`page threw: ${e.message}`));
  const hud = page.locator("#hud");

  const say = async (): Promise<string> => (await hud.textContent()) ?? "";
  const at = async (): Promise<{ x: number; y: number }> => {
    const m = /x (-?\d+), y (-?\d+)/.exec(await say());
    if (!m) fail(`no position in the HUD`);
    return { x: Number(m![1]), y: Number(m![2]) };
  };
  const plated = async (): Promise<{ kind: string; hp: number; max: number; state: string; x: number } | null> => {
    const m = /nearest (\w+) (-?\d+)\/(\d+)hp (\w+) at x (-?\d+)/.exec(await say());
    return m ? { kind: m[1], hp: Number(m[2]), max: Number(m[3]), state: m[4], x: Number(m[5]) } : null;
  };
  const go = async (x?: number): Promise<void> => {
    await page.goto(`${BASE}/walk.html?level=4${x === undefined ? "" : `&x=${x}`}`);
    await hud.filter({ hasText: /room \d+ of \d+/ }).waitFor({ timeout: 30_000 });
    await page.waitForTimeout(700);
  };

  // 1. it opens where its own initplayer stands, on flat ground
  await go();
  const spawn = await at();
  if (!near(spawn.x, 1680, 20)) fail(`PLAYGR should open at its own initplayer, x1680; got x ${spawn.x}`);
  console.log(`ok    PLAYGR opens at x ${spawn.x}, y ${spawn.y}`);

  // 2. eight enemies stand up — seven dogs and the one that counts
  const all = Number(/(\d+) spawned/.exec(await say())?.[1] ?? -1);
  if (all !== 8) fail(`PLAYGR places seven dogs and one boss; ${all} spawned`);
  const census = /kill 100% of (\d+)/.exec(await say());
  if (!census || Number(census[1]) !== 1) {
    fail(`only the boss calls 0x42f870, so the census is 1; got ${census?.[1]}`);
  }
  console.log(`ok    ${all} enemies stand up and exactly ${census![1]} of them is the quota`);

  // 3. it is a statue until you come to it. Well clear of its rect it holds cel
  //    3040 and does nothing at all — `0x4559e8` tests the player's own point
  //    against the record's rect and nothing else wakes it.
  await go(3400);
  await page.waitForTimeout(2000);
  const still = new Set<number>();
  for (let i = 0; i < 20; i++) {
    await page.waitForTimeout(60);
    const m = /nearest initwbooly (-?\d+)\/(\d+)hp \w+ at x (-?\d+), y (-?\d+) cel (\d+)/.exec(await say());
    if (!m) fail(`the boss should be the nearest plated thing in PLAYGR`);
    if (Number(m![2]) !== 800) fail(`0x4510ae gives it 0x320 health; the bar reads ${m![2]}`);
    still.add(Number(m![5]));
  }
  if (still.size !== 1 || !still.has(3040)) fail(`a sleeping boss is cel 3040 and nothing else; saw ${[...still].join(" ")}`);
  console.log(`ok    it stands as cel 3040 with 800 health while the player is outside its rect`);

  // 4. walk into the rect and it stirs, climbs out of the ground and comes on
  await page.keyboard.down("ArrowRight");
  const woke = new Set<number>();
  for (let i = 0; i < 140; i++) {
    await page.waitForTimeout(40);
    const m = /nearest initwbooly [^·]*? cel (\d+)/.exec(await say());
    if (m) woke.add(Number(m[1]));
    if ((await at()).x > 3950) break;
  }
  await page.keyboard.up("ArrowRight");
  for (let i = 0; i < 50; i++) {
    await page.waitForTimeout(50);
    const m = /nearest initwbooly [^·]*? cel (\d+)/.exec(await say());
    if (m) woke.add(Number(m[1]));
  }
  // 3041 is the stir, 3122..3124 the climb out, 3000+ the fight
  if (!woke.has(3041)) fail(`it should stir on 3041 before anything else; saw ${[...woke].join(" ")}`);
  if (![3122, 3123, 3124].some((c) => woke.has(c))) fail(`it should climb out through 3122..3124; saw ${[...woke].join(" ")}`);
  if (![...woke].some((c) => c >= 3000 && c <= 3068)) fail(`and then fight; saw ${[...woke].join(" ")}`);
  console.log(`ok    walking into its rect wakes it — ${woke.size} cels from the statue to the fight`);

  // 5. the goal is shut while it lives. Its share is the one that stores zero
  //    (0x450156), so the craft does not come until the census is empty.
  await go(4500);
  await page.waitForTimeout(800);
  if (/the television is in|the screen is coming down|level 4 complete/.test(await say())) {
    fail(`the goal opened with the boss still alive`);
  }
  if (!/still to kill/.test(await say())) fail(`the HUD should be counting the one that is left`);
  console.log(`ok    and the goal stays shut while it lives`);

  // 6. eight hundred health, and what killing it is worth
  await go(4100);
  await page.waitForTimeout(800);
  const seen = new Set<number>();
  let dead = false;
  for (let i = 0; i < 900 && !dead; i++) {
    await page.waitForTimeout(30);
    const m = /nearest initwbooly (-?\d+)\/\d+hp (\w+) at x (-?\d+), y (-?\d+) cel (\d+)/.exec(await say());
    if (!m) break;
    seen.add(Number(m[5]));
    if (m[2] === "dead") {
      dead = true;
      break;
    }
    const d = Number(m[3]) - (await at()).x;
    if (Math.abs(d) < 90) {
      await page.keyboard.press("k");
      await page.waitForTimeout(180);
    } else {
      const key = d > 0 ? "ArrowRight" : "ArrowLeft";
      await page.keyboard.down(key);
      await page.waitForTimeout(90);
      await page.keyboard.up(key);
    }
  }
  if (!dead) fail(`never got the boss down`);
  await page.waitForTimeout(2500);
  const points = Number(/(\d+) points/.exec(await say())?.[1] ?? 0);
  if (points < 2500) fail(`0x456420 pays 0x9c4 for it; the score reads ${points}`);
  const last = /nearest initwbooly [^·]*? cel (\d+)/.exec(await say());
  if (!last || Number(last[1]) !== 3140) fail(`it burns on 3140 and stays there; showing ${last?.[1]}`);
  if (!/quota 0 of 1/.test(await say())) fail(`the census should be clear: ${/quota[^·]*/.exec(await say())?.[0]}`);
  console.log(`ok    it falls for ${points} points and burns on cel ${last![1]}, and the quota is clear`);

  // 7. ...and only then does the television come down
  for (let i = 0; i < 60; i++) {
    await page.waitForTimeout(200);
    if (/the screen is coming down|level 4 complete|at the goal/.test(await say())) break;
  }
  if (!/the screen is coming down|level 4 complete|at the goal|the television is in/.test(await say())) {
    fail(`the craft should arrive once the boss is dead: ${(await say()).slice(0, 200)}`);
  }
  console.log(`ok    and the television comes down for it`);

  await finish(browser);
  console.log("PASS  PLAYGR is its seven dogs, its one boss, and a goal that waits for it");
};

await main();
