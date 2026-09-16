/**
 * TOWER — level twelve, the end of chapter three, and the only level in the
 * game that is climbed rather than crossed.
 *
 *   npm run dev -w skullcracker                  # in one terminal
 *   npm run test:browser:tower -w skullcracker   # in another
 *
 * Its five regions stack: the player comes in at (18020, 16285) and the goal is
 * at (17602, 15120), 1165 pixels straight up, with the boss standing on it.
 *
 *   - **the floor** (`initfloor`), five of them, and it is level nine's grave
 *     told the other way round: no health, no blow, and `0x402fa0` at the end.
 *     Four frames whole, three creaking, six caving, and then it is not there.
 *   - **the bishop** (`initvpriest` in the records; `belfry.snd` calls it
 *     `0060 bishopchar[ge]`, `0064 bishopthro[w]`, `0067 bishop die`). Twelve
 *     hundred health, the same number the player has, and no award at all.
 *   - **the surge** (`initsurge`), two tall thin columns down the tower wall,
 *     and the only hazard in the game that GIVES you something: `0x426b21` is a
 *     call to `0x45ef30`, the ammunition adder.
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
    return { x: Number(m?.[1] ?? NaN), y: Number(m?.[2] ?? NaN) };
  };
  const go = async (q: string): Promise<void> => {
    await page.goto(`${BASE}/walk.html?level=12${q}`);
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

  // 1. five regions stacked, a census of eight, a share of nothing and no clock
  await go("");
  if (!/room \d+ of 5/.test(await say())) fail(`TOWER has five regions; the HUD says ${/room[^·]*/.exec(await say())?.[0]}`);
  if (!/kill 0% of 8/.test(await say())) fail(`3 Ghengis, 4 skeletons and one bishop count and its 8 bats do not; the census is ${/kill[^·)]*/.exec(await say())?.[0]}`);
  const clock = Number(/clock (\d+)/.exec(await say())?.[1] ?? 0);
  if (clock < 31000) fail(`TOWER carries no timer record, so no limit; the panel says ${clock}`);
  console.log(`ok    TOWER is five stacked regions, a census of eight, no kills wanted and no clock`);

  // 2. the floor at x17515. `0x426f80` starts it on the player's own point
  //    inside its rect, and then it is four frames, three, and six.
  await go("&x=17800");
  if (!/floor whole cel 9010 at x17515/.test(await say())) fail(`the floor at x17515 opens whole on 9010`);
  await page.keyboard.down("ArrowLeft");
  const states = new Set<string>();
  let fell = 0;
  const from = (await at()).y;
  for (let i = 0; i < 30; i++) {
    await page.waitForTimeout(120);
    const m = /floor (\w+) cel (\d+) at x17515/.exec(await say());
    if (m) states.add(m[1]);
    const y = (await at()).y;
    if (y - from > fell) fell = y - from;
  }
  await page.keyboard.up("ArrowLeft");
  for (const want of ["creaking", "caving", "gone"]) if (!states.has(want)) fail(`a floor goes whole -> creaking -> caving -> gone; it showed ${[...states].join(" ")}`);
  if (fell < 100) fail(`and it should drop whoever is on it; the player fell ${fell}`);
  console.log(`ok    walking onto one runs it ${[...states].join(" -> ")} and drops you ${fell} pixels`);

  // 3. the bishop, on the goal, with the player's own twelve hundred health
  await go("&x=17600&y=15300");
  if (!/nearest initvpriest 1200\/1200hp/.test(await say())) fail(`0x41ebc4 gives it 0x40e300(0x4b0); the bar reads ${/initvpriest [^ ]*/.exec(await say())?.[0]}`);
  if (!/at the goal/.test(await say())) fail(`the bishop stands ON the goal; the HUD says ${/television[^·]*|at the goal/.exec(await say())?.[0]}`);
  const before = Number(/(\d+) points/.exec(await say())?.[1] ?? 0);
  let low = 1200;
  let lastX: number | null = null;
  let missed = 0;
  for (let i = 0; i < 300; i++) {
    await page.waitForTimeout(40);
    const m = /nearest initvpriest (-?\d+)\/(\d+)hp (\w+) at x (-?\d+)/.exec(await say());
    // a bat wanders in and takes the "nearest" line for a while; that is not the
    // fight ending
    if (!m) {
      if (++missed > 60 || lastX === null) break;
    } else {
      missed = 0;
      low = Math.min(low, Number(m[1]));
      if (m[3] === "dead") break;
      lastX = Number(m[4]);
    }
    const d = lastX! - (await at()).x;
    if (Math.abs(d) < 90) {
      // it floats, the way level eight's boss does: a standing kick passes
      // under a body box that runs from 109 above its anchor to 31 below
      await page.keyboard.press("j");
      await page.waitForTimeout(160);
      await page.keyboard.press("k");
      await page.waitForTimeout(260);
    } else {
      const key = d > 0 ? "ArrowRight" : "ArrowLeft";
      await page.keyboard.down(key);
      await page.waitForTimeout(80);
      await page.keyboard.up(key);
    }
  }
  if (low >= 1200) fail(`the bishop should be taking damage; it never dropped below ${low}`);
  const paid = Number(/(\d+) points/.exec(await say())?.[1] ?? 0) - before;
  if (paid !== 0) fail(`0x4264f0 pays nothing at all; the score moved by ${paid}`);
  console.log(`ok    the bishop is 1200 health, stands on the goal, and pays nothing — down to ${low}`);

  // 4. the two surges, arcing down the tower wall on their own six cels
  await go("&x=17900&y=15300");
  const arcs = new Set<number>();
  for (let i = 0; i < 24; i++) {
    await page.waitForTimeout(60);
    const m = /surge cel (\d+) at x17967/.exec(await say());
    if (m) arcs.add(Number(m[1]));
  }
  if (arcs.size < 4) fail(`0x46f648 is six cels at one frame each; the surge showed ${arcs.size}`);
  if ([...arcs].some((c) => c < 9060 || c > 9065)) fail(`its cels are 9060..9065; saw ${[...arcs].join(" ")}`);
  console.log(`ok    and its two surges arc through ${arcs.size} of 9060..9065`);

  await browser.close();
  console.log("PASS  TOWER's floors give way, its bishop stands on the goal and its surges arc");
};

void main().catch((e) => fail(String(e)));
