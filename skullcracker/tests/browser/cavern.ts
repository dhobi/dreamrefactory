/**
 * CAVERN — level ten, and the widest level in the game: 3555 pixels across and
 * 2275 deep in one region alone.
 *
 *   npm run dev -w skullcracker                   # in one terminal
 *   npm run test:browser:cavern -w skullcracker   # in another
 *
 * Five new things stand in it:
 *
 *   - **the bat** (`0x41ead0`), whose divisor is **1** — the lowest in the game,
 *     and the only creature that divides its script's dx by nothing. It is also
 *     frail in the engine's own sense: `0x4232f0` has no subtraction in it at
 *     all, so one blow of any size fells one. And it does not count: `0x41ead0`
 *     never calls `0x42f870`, which is why ten of them leave the census at 19.
 *   - **Ghengis** (`0x41ea20`), two hundred health and four hundred points.
 *   - **the skeleton** (`0x41ed70`), two hundred health and **450** — the most
 *     any ordinary creature in the game is worth.
 *   - **the swinging blade** (`0x41ef90`), fifteen of them, whose whole think is
 *     three tags handed round in a ring: twenty-seven cels, one engine frame
 *     each, a blow of a hundred on every one.
 *   - **the rope bridge** (`0x41e9c0`), which you can cross and cannot stand on.
 */
import { BASE, fail, finish, launch } from "./harness";

const main = async (): Promise<void> => {
  const browser = await launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on("pageerror", (e) => fail(`page threw: ${e.message}`));
  const hud = page.locator("#hud");

  const say = async (): Promise<string> => (await hud.textContent()) ?? "";
  const at = async (): Promise<number> => Number(/· x (-?\d+), y/.exec(await say())?.[1] ?? NaN);
  const go = async (x?: number): Promise<void> => {
    await page.goto(`${BASE}/walk.html?level=10${x === undefined ? "" : `&x=${x}`}`);
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
  /** fight whatever is nearest until it is down, and answer what it paid */
  const fell = async (kind: string, tries: number): Promise<number> => {
    const before = Number(/(\d+) points/.exec(await say())?.[1] ?? 0);
    let lastX: number | null = null;
    let missed = 0;
    for (let i = 0; i < tries; i++) {
      await page.waitForTimeout(40);
      const m = new RegExp(`nearest ${kind} (-?\\d+)/(\\d+)hp (\\w+) at x (-?\\d+)`).exec(await say());
      // the HUD names whichever thing is nearest in x, and these patrol — so a
      // frame in which something else is nearer is not the fight ending
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

  // 1. five regions, and a census that leaves the bats out
  await go();
  if (!/room \d+ of 5/.test(await say())) fail(`CAVERN has five regions; the HUD says ${/room[^·]*/.exec(await say())?.[0]}`);
  const census = /kill 85% of (\d+)/.exec(await say());
  if (!census || Number(census[1]) !== 19) fail(`8 zombies, 5 Ghengis and 6 skeletons count and 10 bats do not — 19; the census is ${census?.[1]}`);
  console.log(`ok    CAVERN is five regions and a census of ${census![1]}, its ten bats uncounted`);

  // 2. ...and NO clock. `0x421ead` hands 32000 when the book has no `timer`
  //    record, and CAVERN has none.
  const clock = Number(/clock (\d+)/.exec(await say())?.[1] ?? 0);
  if (clock < 31000) fail(`CAVERN carries no timer record, so its clock is 32000; the panel says ${clock}`);
  console.log(`ok    and no timer record at all, so no limit: ${clock}`);

  // 3. a bat is frail — one blow of any size, and seventy points
  await go(2290);
  await page.waitForTimeout(600);
  if (!/nearest initbat 1\/1hp/.test(await say())) fail(`a bat has no health to subtract; the bar reads ${/initbat [^ ]*/.exec(await say())?.[0]}`);
  const batPay = await fell("initbat", 120);
  if (batPay !== 70) fail(`0x42333c pays 0x46 for a bat; the score reads ${batPay}`);
  console.log(`ok    a bat falls to one blow for ${batPay} points`);

  // 4. a skeleton: two hundred, and 450 — the most in the game
  await go(2990);
  await page.waitForTimeout(600);
  if (!/nearest initskel 200\/200hp/.test(await say())) fail(`0x41edc4 gives it 0x40e300(0xc8); the bar reads ${/initskel [^ ]*/.exec(await say())?.[0]}`);
  const skelPay = await fell("initskel", 400);
  if (skelPay !== 450) fail(`0x423b1b pays 0x1c2 for a skeleton; the score reads ${skelPay}`);
  console.log(`ok    a skeleton is two hundred health and ${skelPay} points`);

  // 5. Ghengis: two hundred and four hundred
  await go(5520);
  await page.waitForTimeout(600);
  if (!/nearest initghengis 200\/200hp/.test(await say())) fail(`0x41ea74 gives it 0x40e300(0xc8); the bar reads ${/initghengis [^ ]*/.exec(await say())?.[0]}`);
  const gPay = await fell("initghengis", 400);
  if (gPay !== 400) fail(`0x422bea pays 0x190 for Ghengis; the score reads ${gPay}`);
  console.log(`ok    Ghengis is two hundred health and ${gPay} points`);

  // 6. the blades. `0x4702c8`'s three tags are a ring of 27 cels and the think
  //    does nothing else; every one of them is 4040..4052.
  await go(6250);
  const seen = new Set<number>();
  for (let i = 0; i < 40; i++) {
    await page.waitForTimeout(60);
    const m = /axe cel (\d+) at x6271/.exec(await say());
    if (m) seen.add(Number(m[1]));
  }
  if (seen.size < 6) fail(`a blade rings 27 cels; it showed ${seen.size} of them`);
  if ([...seen].some((c) => c < 4040 || c > 4052)) fail(`0x4702c8 is 4040..4052; saw ${[...seen].join(" ")}`);
  console.log(`ok    a blade rings through ${seen.size} of its own 4040..4052 in two seconds`);

  // 7. the bridge. `0x4223f5` counts the frames you have been standing on one
  //    and five is all it gives you; after that it rocks, falls, and the
  //    `platform` record laid over it — CAVERN files one per bridge, rect for
  //    rect — goes with it.
  await page.goto(`${BASE}/walk.html?level=10&x=7600&y=1100`);
  await hud.filter({ hasText: /room \d+ of \d+/ }).waitFor({ timeout: 30_000 });
  await page.waitForTimeout(120);
  const states = new Set<string>();
  let lowest = 1100;
  for (let i = 0; i < 40; i++) {
    await page.waitForTimeout(80);
    const m = /bridge (\w+) cel (\d+) at x7690/.exec(await say());
    if (m) states.add(m[1]);
    const y = Number(/· x -?\d+, y (-?\d+)/.exec(await say())?.[1] ?? 0);
    if (y > lowest) lowest = y;
  }
  if (!states.has("gone")) fail(`a bridge stood on should end up gone; it showed ${[...states].join(" ")}`);
  if (lowest < 1300) fail(`and the platform should go with it — the player never fell, reaching only y ${lowest}`);
  console.log(`ok    standing on a bridge runs it through ${[...states].join(" -> ")}, and the floor goes with it`);

  await finish(browser);
  console.log("PASS  CAVERN's four creatures stand, its blades swing and its bridges give way");
};

await main();
