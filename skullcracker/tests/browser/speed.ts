/**
 * Does the player move at the speed `SC.EXE` moves them at?
 *
 *   npm run dev -w skullcracker                  # in one terminal
 *   npm run test:browser:speed -w skullcracker   # in another
 *
 * Every number here is read out of the executable, and the chain is short enough
 * to state in full:
 *
 *   - the walk script `0x471920` carries `dx 95` on each of its twelve frames,
 *     and the run script `0x471988` carries `dx 180`;
 *   - `0x42f8b0`, the whole of the movement system, adds `dx / obj[+0xe]` to the
 *     position, and the player's `obj[+0xe]` is 12 — `mov word ptr [eax+0xe],
 *     0xc` at `0x42e412`, one of exactly two writes of twelve in the binary and
 *     never rewritten afterwards;
 *   - a frame is 1/15s: `0x4087c0` returns `timeGetTime() * 3 / 50`, units of
 *     1/60s, and `0x40e4f0` spins until four of them have passed since the last
 *     frame. `0x40dfd0`, which calls it, is called exactly once from each of the
 *     sixteen level frame functions.
 *
 * 95/12 x 15 = **120px a second walking**, 180/12 x 15 = **225 running**. Those
 * two numbers are what this asserts.
 *
 * ## Why the run has its own test
 *
 * Because it was missing, and its absence read as the walk being wrong. The
 * binding table at `0x46b210` maps W to action 1, and action 1's handler in the
 * table at `0x402d54` sets `[0x4ac3fe]` — which the walk state `0x429990` tests
 * before anything else, installing the run. This page had W bound to "up" and no
 * run at all, so it only ever walked, and a correctly-measured 120px/s felt slow
 * because the game's travelling speed is nearly twice that.
 *
 * The ratio matters more than either number: 180/95 is fixed by the two scripts
 * and cannot drift with anything this port invents, so it is asserted tightly
 * while the absolute speeds get room for the browser's scheduling.
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

  await page.goto(`${BASE}/walk.html?level=1`);
  const hud = page.locator("#hud");
  await hud.filter({ hasText: /room \d+ of \d+/ }).waitFor({ timeout: 20_000 });

  const say = async (): Promise<string> => (await hud.textContent()) ?? "";
  const coord = async (): Promise<number> => {
    const t = await say();
    const m = /x (-?\d+)/.exec(t);
    return m ? Number(m[1]) : fail(`no x in the HUD: ${t.slice(0, 120)}`);
  };
  /**
   * Hold keys and return the pixels covered per second of WALL clock.
   *
   * The elapsed time is measured rather than assumed: `waitForTimeout` is a
   * floor, not a promise, and dividing by the requested figure turns any
   * scheduling delay into a speed that reads low.
   */
  const rate = async (keys: string[], ms: number): Promise<number> => {
    const x0 = await coord();
    const t0 = Date.now();
    for (const k of keys) await page.keyboard.down(k);
    await page.waitForTimeout(ms);
    const x1 = await coord();
    const t1 = Date.now();
    for (const k of keys) await page.keyboard.up(k);
    await page.waitForTimeout(200);
    return (Math.abs(x1 - x0) * 1000) / (t1 - t0);
  };

  // STREETS' spawn is x1840 and the street runs thousands of pixels east of it,
  // with its one door past x5000 and its one ladder past x9600 — so there is
  // clear ground here for both legs, and neither key means anything else on it.
  const from = await coord();
  console.log(`ok    the street opens at x ${from}`);

  // 1. the walk: 95/12 x 15. The HUD is read WHILE the key is down — it reports
  //    what the player is doing, and by the time `rate` returns they have
  //    stopped doing it.
  await page.keyboard.down("ArrowRight");
  await page.waitForTimeout(300);
  if (!/walking 120px\/s/.test(await say())) fail(`the HUD does not report the walk`);
  await page.keyboard.up("ArrowRight");
  await page.waitForTimeout(200);

  const walk = await rate(["ArrowRight"], 1500);
  if (Math.abs(walk - 120) > 12) fail(`the walk is ${walk.toFixed(1)}px/s, wanted 120 (dx 95 / 12 x 15fps)`);
  console.log(`ok    walks at ${walk.toFixed(1)}px/s against the engine's 120`);

  // 2. the run: the same, with W held — and W is the whole point
  await page.keyboard.down("ArrowRight");
  await page.keyboard.down("w");
  await page.waitForTimeout(300);
  if (!/RUNNING/.test(await say())) fail(`holding W did not start the run: ${(await say()).slice(0, 160)}`);
  await page.keyboard.up("w");
  await page.keyboard.up("ArrowRight");
  await page.waitForTimeout(200);

  const run = await rate(["ArrowRight", "w"], 1500);
  if (Math.abs(run - 225) > 22) fail(`the run is ${run.toFixed(1)}px/s, wanted 225 (dx 180 / 12 x 15fps)`);
  console.log(`ok    runs at ${run.toFixed(1)}px/s against the engine's 225`);

  // 3. the ratio is the two scripts' own, and nothing this port does can move it
  const ratio = run / walk;
  if (Math.abs(ratio - 180 / 95) > 0.1) {
    fail(`run/walk is ${ratio.toFixed(3)}, but the scripts say 180/95 = ${(180 / 95).toFixed(3)}`);
  }
  console.log(`ok    run/walk is ${ratio.toFixed(3)}, the scripts' own 180/95 = ${(180 / 95).toFixed(3)}`);

  // 4. and W is still the ladder key: the run must NOT shadow the climb. The
  //    original reuses one flag for both — 0x429990 reads it as the run and
  //    0x42ae50 reads it as a rung — so holding it on a ladder has to climb.
  await page.goto(`${BASE}/walk.html?level=1&x=9700`);
  await hud.filter({ hasText: /room \d+ of \d+/ }).waitFor({ timeout: 20_000 });
  const foot = /y (-?\d+)/.exec(await say());
  const y0 = foot ? Number(foot[1]) : fail(`no y at the ladder's foot`);
  await page.keyboard.down("w");
  // read it WHILE the key is down: the HUD reports what the player is doing, and
  // letting go of W ends the climb and leaves them falling, which reads as "in
  // the air" and says nothing about whether they ever climbed
  await page.waitForTimeout(600);
  const t = await say();
  const y1 = Number(/y (-?\d+)/.exec(t)![1]);
  // and the RATE, which is the file's now: the ladder record's param is 35 pixels
  // and one rung is one four-frame tag of the climb script, so 35 x 15/4 = 131px a
  // second. Measured between two rungs rather than from the mount, which steps the
  // player up onto the ladder in one go.
  const span = 2400;
  await page.waitForTimeout(span);
  const y2 = Number(/y (-?\d+)/.exec(await say())![1]);
  await page.keyboard.up("w");
  if (!/climbing/.test(t)) fail(`W at the foot of the ladder did not climb: ${t.slice(0, 160)}`);
  if (y1 >= y0) fail(`W on the ladder went from y${y0} to y${y1} — it ran instead of climbing`);
  const climb = ((y1 - y2) / span) * 1000;
  if (Math.abs(climb - 131) > 25) fail(`the climb is ${climb.toFixed(1)}px/s, wanted 131 (35px a rung, 4 frames a rung)`);
  console.log(
    `ok    and on the ladder the same key still climbs, y ${y0} to y ${y2} at ${climb.toFixed(1)}px/s against 131`,
  );

  await browser.close();
  console.log(`PASS  the walk, the run and the ladder all move at the executable's rates`);
};

void main();
