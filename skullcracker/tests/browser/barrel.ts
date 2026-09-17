/**
 * BARREL — level fourteen, and the level that moves under you.
 *
 *   npm run dev -w skullcracker                   # in one terminal
 *   npm run test:browser:barrel -w skullcracker   # in another
 *
 * Forty-two conveyors — twenty-six `initbeltleft` and sixteen `initbeltright` —
 * sharing one creator (`0x411500`) and one class (`0x4167c0`). Each is a 278x36
 * strip, and the think is one test and one number: is the player's own drawn box
 * inside the strip's band and are they on the ground, and if so write **0x14**
 * into `user+4`.
 *
 * They are laid end to end with a seven-pixel gap between one record's right and
 * the next one's left, which is why the test has to be the box and not the
 * point: on a point test you fall down the seam and the ride stops.
 *
 * Twelve TCops stand in it, and chapter four's own weapon — the blaster — has
 * ten `statblasterpack` refills here and nothing to fire them with, because the
 * gun itself is in VAT.
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
    await page.goto(`${BASE}/walk.html?level=14${q}`);
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

  // 1. three regions, twelve cops, and its own clock
  await go("");
  if (!/room \d+ of 3/.test(await say())) fail(`BARREL has three regions; the HUD says ${/room[^·]*/.exec(await say())?.[0]}`);
  if (!/kill 55% of 12/.test(await say())) fail(`twelve cops count and nothing else does; the census is ${/kill[^·)]*/.exec(await say())?.[0]}`);
  const clock = Number(/clock (\d+)/.exec(await say())?.[1] ?? 0);
  if (clock < 8100 || clock > 8200) fail(`BARREL's timer record carries 8200; the panel says ${clock}`);
  console.log(`ok    BARREL is three regions, twelve TCops, and ${clock} frames — the longest clock in the game`);

  // 2. forty-two of them stand in its middle region
  if (!/42 belts/.test(await say())) fail(`BARREL lays 26 + 16 conveyors; the HUD says ${/\d+ belts/.exec(await say())?.[0]}`);
  console.log(`ok    and forty-two conveyors, all in one region`);

  /**
   * ...and for the belts, a plain load: {@link go}'s settle waits for two reads
   * to agree, and on a conveyor they never do.
   */
  const drop = async (q: string): Promise<void> => {
    await page.goto(`${BASE}/walk.html?level=14${q}`);
    await hud.filter({ hasText: /room \d+ of \d+/ }).waitFor({ timeout: 30_000 });
    await page.waitForTimeout(400);
  };

  // 3. a right-hand belt carries you east — across the seams, which is the
  //    whole reason `0x416899` tests the box and not the point
  await drop("&x=5316&y=8140");
  const from = await at();
  await page.waitForTimeout(1600);
  const to = await at();
  if (to - from < 300) fail(`0x416965 writes twenty a frame; the player moved ${to - from} in 1.6s`);
  if (to < 5730) fail(`and it should carry across the seven-pixel gaps between records; stopped at x ${to}`);
  console.log(`ok    a right-hand belt carries you from x ${from} to x ${to} — over its own seams`);

  // 4. ...and a left-hand one carries you the other way
  await drop("&x=5380&y=7500");
  const lFrom = await at();
  await page.waitForTimeout(1200);
  const lTo = await at();
  if (lFrom - lTo < 300) fail(`an initbeltleft should carry west at the same twenty; the player moved ${lTo - lFrom}`);
  console.log(`ok    a left-hand one carries you the other way, x ${lFrom} to x ${lTo}`);

  // 5. the chair — four tags of `0x46dfd8` handed round, and nothing else in
  //    the class at all
  await go("");
  const chair = new Set<number>();
  for (let i = 0; i < 40; i++) {
    await page.waitForTimeout(80);
    const m = /chair \d+ cel (\d+)/.exec(await say());
    if (m) chair.add(Number(m[1]));
  }
  if (chair.size < 6) fail(`a chair rings nineteen records; it showed ${chair.size}`);
  if ([...chair].some((c) => c < 2200 || c > 2226)) fail(`0x46dfd8 is 2200..2226; saw ${[...chair].join(" ")}`);
  console.log(`ok    a chair rings through ${chair.size} of its own 2200..2226`);

  // 6. chapter four's weapon refills, and no gun in the level to use them
  if (!/no blaster 0\/160/.test(await say())) fail(`chapter four names the blaster and arms nothing; the panel says ${/· (holding|no) \w+ \d+\/\d+/.exec(await say())?.[0]}`);
  if (!/guns · nearest statblasterpack/.test(await say())) fail(`BARREL places ten statblasterpack and no statblaster`);
  console.log(`ok    and its ten blaster packs have no gun in the level to go in`);

  await finish(browser);
  console.log("PASS  BARREL's conveyors carry, its chairs turn, and its twelve cops stand");
};

await main();
