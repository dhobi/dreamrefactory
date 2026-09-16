/**
 * ARCADE — level eight, and the end of chapter two.
 *
 *   npm run dev -w skullcracker                   # in one terminal
 *   npm run test:browser:arcade -w skullcracker   # in another
 *
 * Fourteen records, which makes it the smallest level in the game: one room
 * 1845 pixels wide with a flat floor, one boss, seven sprinkler positions, two
 * pickups, a `probe` and a `goal` — and the goal is **thirty pixels from where
 * you start**, because level eight is not a route at all. Chapter two's fourth
 * share is the one stored as zero, so nothing opens until the room is empty, and
 * the room is one thing with a thousand health.
 *
 * What the file says, and what this checks:
 *
 *   - **`initkragg` is a global, not a class.** `0x441bd0` makes the object once
 *     and keeps it at `0x4a6ff8`; `0x436180`, the "creator" the level's spawner
 *     calls, only moves the thing that already exists onto the record's point.
 *   - **a thousand health, a divisor of fifty, and no gravity** — so it hangs
 *     where its record put it, out of reach of anything but a jump.
 *   - **it pays nothing.** There is no `0x40d450` anywhere in its code: the
 *     chapter's last boss is worth the stage and not a point.
 *   - **`0x2d` sorts its takes**: under 45 one of three single cels, 45 or over
 *     the six-cel one.
 *   - **a sprinkler record is not an object** — `0x440800` files each one's point
 *     into a seven-entry table by its own `param`, and nothing stands there
 *     until the boss does.
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
  const boss = async (): Promise<{ hp: number; max: number; state: string; x: number; y: number; cel: number } | null> => {
    const m = /nearest initkragg (-?\d+)\/(\d+)hp (\w+) at x (-?\d+), y (-?\d+) cel (\d+)/.exec(await say());
    return m ? { hp: Number(m[1]), max: Number(m[2]), state: m[3], x: Number(m[4]), y: Number(m[5]), cel: Number(m[6]) } : null;
  };
  const go = async (x?: number): Promise<void> => {
    await page.goto(`${BASE}/walk.html?level=8${x === undefined ? "" : `&x=${x}`}`);
    await hud.filter({ hasText: /room \d+ of \d+/ }).waitFor({ timeout: 30_000 });
    await page.waitForTimeout(700);
  };

  // 1. one room, one enemy, and a quota of everything
  await go();
  if (!/room 1 of 1/.test(await say())) fail(`ARCADE is one region: ${/room[^·]*/.exec(await say())?.[0]}`);
  const all = Number(/(\d+) spawned/.exec(await say())?.[1] ?? -1);
  if (all !== 1) fail(`ARCADE places one enemy and one only; ${all} spawned`);
  if (!/kill 100% of 1/.test(await say())) fail(`its share is the one stored as zero: ${/quota[^·]*/.exec(await say())?.[0]}`);
  console.log(`ok    ARCADE is one room with one thing in it, and the quota is all of it`);

  // 2. ...with a thousand health, on its own idle cel, hanging where its record
  //    put it — `0x42f850(obj, 0)`, so nothing brings it down
  const first = await boss();
  if (!first) fail(`the boss should be the nearest plated thing`);
  if (first!.max !== 1000) fail(`0x441c33 gives it 0x3e8; the bar reads ${first!.max}`);
  if (first!.cel !== 7040) fail(`0x473840 is one cel, 7040; it is showing ${first!.cel}`);
  const wasY = first!.y;
  await page.waitForTimeout(3000);
  if ((await boss())!.y !== wasY) fail(`it has no gravity and should hold its height; y ${wasY} -> ${(await boss())!.y}`);
  console.log(`ok    it hangs at y ${wasY} with ${first!.max} health, on cel ${first!.cel}`);

  // 3. seven sprinkler positions, filed by their own param
  if (!/7 sprinklers/.test(await say())) fail(`ARCADE places seven: ${/\d+ sprinklers/.exec(await say())?.[0]}`);
  console.log(`ok    and its seven sprinkler positions are read off the records`);

  // 4. the goal is shut while it lives — and the player starts standing in it
  const spawn = await at();
  if (spawn.x > 300) fail(`ARCADE starts at its own initplayer, x125; got x ${spawn.x}`);
  if (!/still to kill/.test(await say())) fail(`the goal should be counting what is left`);
  if (/the television is in|level 8 complete/.test(await say())) fail(`the goal opened with the boss alive`);
  console.log(`ok    the player starts at x ${spawn.x}, inside the goal, and it is shut`);

  // 5. it is out of reach on the ground and not in the air. Its body box bottoms
  //    out 115 pixels over the floor, so the fight is a jumping one.
  await go(1300);
  await page.waitForTimeout(500);
  let grounded = 0;
  for (let i = 0; i < 25; i++) {
    await page.waitForTimeout(80);
    await page.keyboard.press("k");
    grounded = (await boss())!.hp;
  }
  if (grounded !== 1000) fail(`a kick from the floor cannot reach it; it lost ${1000 - grounded}`);
  console.log(`ok    twenty-five kicks from the floor take nothing off it`);

  // 6. ...and a jumping one fells it, on its own cels
  const cels = new Set<number>();
  let dead = false;
  for (let i = 0; i < 90 && !dead; i++) {
    const b = await boss();
    if (!b) break;
    cels.add(b.cel);
    if (b.state === "dead") {
      dead = true;
      break;
    }
    const d = b.x - (await at()).x;
    if (Math.abs(d) < 110) {
      await page.keyboard.press("j");
      await page.waitForTimeout(260);
      await page.keyboard.press("k");
      await page.waitForTimeout(500);
    } else {
      const key = d > 0 ? "ArrowRight" : "ArrowLeft";
      await page.keyboard.down(key);
      await page.waitForTimeout(90);
      await page.keyboard.up(key);
    }
  }
  if (!dead) fail(`never felled the boss; it has ${(await boss())?.hp} left`);
  // 7033..7036 is `0x473b60` tag 0, and 7090..7095 the take a big blow earns
  if (![7033, 7034, 7035, 7036].some((c) => cels.has(c))) {
    fail(`it should die on 0x473b60's own cels; saw ${[...cels].sort().join(" ")}`);
  }
  if (!/quota 0 of 1/.test(await say())) fail(`the census should be clear: ${/quota[^·]*/.exec(await say())?.[0]}`);
  console.log(`ok    a jumping attack fells it — ${cels.size} of its own cels, and the quota is clear`);

  // 7. ...and it pays nothing at all, which no other boss in the game does
  await page.waitForTimeout(1500);
  const points = Number(/(\d+) points/.exec(await say())?.[1] ?? -1);
  if (points !== 0) fail(`there is no 0x40d450 in its code; the score reads ${points}`);
  console.log(`ok    and pays ${points} points, because nothing in its code awards any`);

  // 8. only then does the craft come, and the goal is where you began
  for (let i = 0; i < 60; i++) {
    await page.waitForTimeout(200);
    if (/the television is in|the screen is coming down|level 8 complete|at the goal/.test(await say())) break;
  }
  if (!/the television is in|the screen is coming down|level 8 complete|at the goal/.test(await say())) {
    fail(`the craft should arrive once the room is empty: ${(await say()).slice(0, 200)}`);
  }
  console.log(`ok    and the craft comes down for it`);

  await browser.close();
  console.log("PASS  ARCADE is one room, one boss out of reach, and a goal that waits for it");
};

void main().catch((e) => fail(String(e)));
