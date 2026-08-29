/**
 * CITY's opening, which was impassable — and the two rules that pass it.
 *
 *   npm run dev -w skullcracker                 # in one terminal
 *   npm run test:browser:city -w skullcracker   # in another
 *
 * Level two is a staircase of rooftops with no floor under it (`CITY`'s ground is
 * y7250 for everything east of x691, 2900 pixels below anything it draws), and
 * its first step is the one this page could not take. The file's own numbers:
 *
 *   - a `platform` at `y4041, x1757..1904` — the metal walkway;
 *   - a 103px gap west of it, from the `y4046` platform that ends at x1654;
 *   - a wooden water tank whose roof is a `platform` at `y3920, x1873..2324`;
 *   - and an `obstacle` at `y3852..4160, x1873..1933` — the tank's west wall.
 *
 * So the step up is 121 pixels with a wall in the middle of it, and both of the
 * rules it needs are things this page had wrong:
 *
 * 1. **an obstacle is a point test.** `0x430146` walks the obstacle array against
 *    the object's own point and pushes it out along the smallest of the four
 *    penetrations — so clearing the wall means lifting the ANCHOR past y3852, 101
 *    pixels. Tested as a box, as this page did, it meant lifting all 148 rows of
 *    the sprite past it: 189 pixels, which no jump in the game reaches.
 * 2. **the tuck's feet are 19 pixels higher than the standing pose's.** The
 *    engine's `y` is the cel's anchor and what lands is the cel's own collision
 *    box: standing cel 1's reaches 88 rows below the anchor, the airborne tuck's
 *    (cel 200) reaches 69. So a jump whose anchor rises 105 puts the feet at 3917
 *    against a roof at 3920 — three pixels of margin, and the whole level rests
 *    on them.
 *
 * And the planks, which are the other half of the level: twenty `initplank`
 * records, each sitting inside a `platform` record it OWNS (`0x42fb70`), sagging
 * through cels 1050..1053 under the player and giving way on the sixth crossing at
 * three times the player's gravity.
 *
 * The probe walks the route rather than teleporting onto it, because `?x=` drops
 * the player at the ground under that column and in CITY that is the void.
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

  await page.goto(`${BASE}/walk.html?level=2`);
  const hud = page.locator("#hud");
  await hud.filter({ hasText: /room \d+ of \d+/ }).waitFor({ timeout: 30_000 });
  await page.waitForTimeout(600);

  const at = async (): Promise<{ x: number; y: number }> => {
    const t = (await hud.textContent()) ?? "";
    const x = /x (-?\d+)/.exec(t);
    const y = /y (-?\d+)/.exec(t);
    if (!x || !y) fail(`no position in the HUD: ${t.slice(0, 120)}`);
    return { x: Number(x![1]), y: Number(y![1]) };
  };
  const near = (got: number, want: number, slack = 6): boolean => Math.abs(got - want) <= slack;
  /** hold a direction until the player is past `want`, or give up */
  const walkTo = async (want: number): Promise<void> => {
    await page.keyboard.down("ArrowRight");
    for (let i = 0; i < 400 && (await at()).x < want; i++) await page.waitForTimeout(50);
    await page.keyboard.up("ArrowRight");
  };
  /** a running jump east with the lift held, which is how the game is played */
  const jump = async (): Promise<void> => {
    await page.keyboard.down("ArrowRight");
    await page.keyboard.down("w");
    await page.keyboard.press("j");
    await page.waitForTimeout(400);
    await page.keyboard.up("w");
    await page.waitForTimeout(500);
    await page.keyboard.up("ArrowRight");
  };

  const say = async (): Promise<string> => (await hud.textContent()) ?? "";

  const spawn = await at();
  if (!near(spawn.x, 610, 40)) fail(`CITY should open at its own initplayer, x610; got x ${spawn.x}`);
  console.log(`ok    CITY opens on its ledge at x ${spawn.x}, y ${spawn.y}`);

  /**
   * 1. the first plank — twenty of CITY's records are `initplank` and its route
   *    crosses them. `0x4531d0` sags one under you (cels 1050..1053), counts the
   *    crossing when that animation ends, and on the SIXTH gives way: three times
   *    the player's gravity and the eight cels of it going.
   */
  const plankX = 1180;
  await walkTo(plankX);
  const board = await say();
  if (!/plank (wobble|intact) cel 105\d x1185/.test(board)) {
    fail(`the plank at x1085..1285 should sag underfoot; the HUD says ${/plank[^·]*/.exec(board)?.[0] ?? "nothing"}`);
  }
  console.log(`ok    the first plank sags underfoot: ${/plank[^·]*/.exec(board)?.[0].trim()}`);

  // stand on it and it goes: six crossings is the file's own count
  const stoodAt = (await at()).y;
  let fell = false;
  for (let i = 0; i < 40 && !fell; i++) {
    await page.waitForTimeout(120);
    fell = /plank fall/.test(await say());
  }
  if (!fell) fail(`standing on a plank should break it after ${6} crossings; it held`);
  await page.waitForTimeout(700);
  const dropped = await at();
  if (dropped.y <= stoodAt + 100) fail(`the plank broke but did not take the player with it: y ${dropped.y}`);
  console.log(`ok    six crossings and it gives way, dropping the player from y ${stoodAt} to ${dropped.y}`);

  // and back to the route, from the level's start
  await page.goto(`${BASE}/walk.html?level=2`);
  await hud.filter({ hasText: /room \d+ of \d+/ }).waitFor({ timeout: 30_000 });
  await page.waitForTimeout(600);

  // 2. east along the rooftops to the lip of the 103px gap
  await walkTo(1630);
  const lip = await at();
  if (!near(lip.y, 4046, 10)) fail(`the walk east should end on the y4046 platform; got y ${lip.y}`);
  console.log(`ok    walked east to the gap's lip at x ${lip.x}, y ${lip.y}`);

  // 3. across it, onto the walkway the file puts at y4041
  await jump();
  const walkway = await at();
  if (!near(walkway.y, 4041, 8)) fail(`the 103px gap should land on the y4041 walkway; got y ${walkway.y}`);
  if (walkway.x < 1760) fail(`the jump did not cross the gap: x ${walkway.x}`);
  console.log(`ok    jumped the gap onto the walkway at x ${walkway.x}, y ${walkway.y}`);

  /**
   * 4. the crows — twelve `initcrow` records, each asleep on its own rect until
   *    the player's point enters it (`0x451ba3`). The walkway is inside the rect
   *    of the one at x1663, so standing here is what wakes it: cels 1835..1838,
   *    then 1840..1853 taking off, then the flight, and it holds a height about a
   *    hundred pixels above the player's own point for as long as it is up.
   */
  const crows = async (): Promise<string> => /· \d+ crows?:[^·]*/.exec(await say())?.[0]?.trim() ?? "";
  if (!/12 crows/.test(await crows())) fail(`CITY places twelve crows; the HUD says ${await crows()}`);
  let woke = "";
  for (let i = 0; i < 60 && !woke; i++) {
    await page.waitForTimeout(150);
    const line = await crows();
    if (/(wake|rise|fly|strike)/.test(line)) woke = line;
  }
  if (!woke) fail(`standing on the walkway should wake the crow whose rect covers it; got ${await crows()}`);
  console.log(`ok    the walkway wakes a crow: ${woke}`);

  // and it flies at the player's height, which is the only motion it has
  let flying = "";
  for (let i = 0; i < 60 && !flying; i++) {
    await page.waitForTimeout(150);
    if (/(fly|strike) cel 1[78]\d\d/.test(await crows())) flying = await crows();
  }
  if (!flying) fail(`the crow should reach its flight cels (1800..1825); got ${await crows()}`);
  const height = Number(/at \d+,(\d+)/.exec(flying)?.[1] ?? "0");
  const eye = (await at()).y - 88;
  if (Math.abs(height - (eye - 100)) > 130) {
    fail(`a crow holds ~100px above the player's point (${eye - 100}); it is at ${height}`);
  }
  console.log(`ok    and holds its height: crow at y ${height} against the player's point ${eye}`);

  // 5. the wall stops a walk — the obstacle ejects west, as `0x430181` does
  await walkTo(2000);
  const stopped = await at();
  if (stopped.x > 1890) fail(`the tank's west wall should stop a walk at x1873; got x ${stopped.x}`);
  if (!near(stopped.y, 4041, 8)) fail(`still on the walkway, please: y ${stopped.y}`);
  console.log(`ok    and the wall stops the walk at x ${stopped.x}, the file's own x1873`);

  // 6. and the jump goes over it onto the tank's roof
  await jump();
  const roof = await at();
  if (!near(roof.y, 3920, 8)) fail(`the jump over the wall should land on the y3920 roof; got y ${roof.y}`);
  if (roof.x < 1940) fail(`landed short of the wall's east edge: x ${roof.x}`);
  console.log(`ok    over the wall onto the tank roof at x ${roof.x}, y ${roof.y}`);

  await browser.close();
  console.log("PASS  CITY's planks give way, its crows wake, and its first step is passable");
};

void main().catch((e) => fail(String(e)));
