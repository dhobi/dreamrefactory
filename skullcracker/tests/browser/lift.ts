/**
 * CITY's elevators — the five that are the only way into the top of level two.
 *
 *   npm run dev -w skullcracker                 # in one terminal
 *   npm run test:browser:lift -w skullcracker   # in another
 *
 * Level two has no `ladder` record, its goal sits at y1802, and the walk east
 * along the rooftops tops out around y3590. Before `initelevator` was read out of
 * `SC.EXE`, 45 of CITY's 73 platforms were reachable and the goal was not one of
 * them; with the five cars every platform in the book is on the route.
 *
 * What the file says, and what this checks:
 *
 *   - **a car owns its landing.** `0x450dc0` calls `0x42fb70`, the plank's "claim
 *     the platform containing my point", and it lands five times out of five once
 *     the point is taken at the SHAFT'S BOTTOM rather than at the record's stored
 *     point (which is the shaft's middle and is inside nothing). The five it
 *     claims — #53, #54, #55, #79, #103 — are the only platforms in CITY between
 *     120 and 135 pixels wide, one per lift.
 *   - **four pixels an engine frame.** `mov word ptr [esp+8], 0x28` at `0x45351f`
 *     over the class's own divisor of ten (`obj+0xe = 0xa`), which is not the
 *     player's twelve.
 *   - **the rider comes with it**, because the car moves the platform record and
 *     the walk's own "follow the floor" allows more climb per tick than the car
 *     makes.
 *
 *   - **it runs on its own.** `obj+0x46`, which every state waits on, is written
 *     only by the animation stepper and means "my script ended" — so a car
 *     leaves when its eighteen idle frames run out, rider or no rider.
 */
import { BASE, fail, finish, launch } from "./harness";

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
  /** put the player at an exact spot — CITY's ground is the void, so ?x= alone is a death */
  const go = async (x: number, y: number): Promise<void> => {
    await page.goto(`${BASE}/walk.html?level=2&x=${x}&y=${y}`);
    await hud.filter({ hasText: /room \d+ of \d+/ }).waitFor({ timeout: 30_000 });
    await page.waitForTimeout(600);
  };

  // 1. the level places five, and every one of them found a landing to own
  await go(7164, 3979);
  const decks = [...(await say()).matchAll(/lift (idle|starting|up|down) car (\d+) winch (\d+) deck y(-?\d+) of (-?\d+)\.\.(-?\d+)/g)];
  if (decks.length !== 5) fail(`CITY places five initelevator records; the HUD shows ${decks.length}`);
  console.log(`ok    CITY's five cars are on their landings: ${decks.map((d) => `y${d[4]}`).join(", ")}`);

  // the cage is 1150 — `obj+0 = 0x47e` — and the WINCH above it is the one with
  // the script. Drawing the winch as the car put a motor where the lift should be
  for (const d of decks) {
    if (Number(d[2]) !== 1150) fail(`a car should draw cel 1150 (obj+0 = 0x47e); got ${d[2]}`);
    const w = Number(d[3]);
    if (w < 1160 || w > 1163) fail(`a winch should draw from 0x477db0's 1160..1163; got ${w}`);
  }
  console.log(`ok    each is the cage 1150 with a winch from 0x477db0's 1160..1163 above it`);

  // 2. the car departs on its own — tag 0 is eighteen frames, then it goes —
  //    and a rider on the landing goes up with it
  // a few pixels of slack: the car starts the moment the player is on it, so by
  // the time the HUD is read it has already taken a tick or two off the landing
  const boarded = await at();
  if (Math.abs(boarded.y - 3979) > 12) fail(`should be on platform #103 at y3979; got y ${boarded.y}`);
  await page.waitForTimeout(2500);
  const risen = await at();
  if (risen.y >= boarded.y - 40) fail(`the car should have carried the player up; y went ${boarded.y} to ${risen.y}`);
  if (risen.x !== boarded.x) fail(`a ride is vertical; x went ${boarded.x} to ${risen.x}`);
  console.log(`ok    the car departs of itself and the rider goes with it: y ${boarded.y} to ${risen.y}`);

  // 3. four pixels an engine frame, which is sixty a second
  const a = await at();
  await page.waitForTimeout(2000);
  const b = await at();
  const rate = ((a.y - b.y) / 2000) * 1000;
  if (Math.abs(rate - 60) > 12) fail(`the car should climb 60px a second (0x28 over a divisor of 10); measured ${rate.toFixed(0)}`);
  console.log(`ok    and it climbs at ${rate.toFixed(0)}px a second, the file's 0x28 over its divisor of 10`);

  // 4. it stops 200px SHY of the head of its shaft — `add ecx, 0xc8` at 0x453606,
  // which is the winch's room and not travel. Running to the top of the rect
  // instead overshoots every lift in the level by exactly that much.
  // #102's travel is 756px at 60 a second, so this is a 13s ride
  for (let i = 0; i < 100 && (await at()).y > 3230; i++) await page.waitForTimeout(250);
  await page.waitForTimeout(400); // let the last pixels of travel land before reading
  const top = await at();
  if (Math.abs(top.y - 3223) > 8) fail(`elevator #102 should stop at y3223 (top 3038 + 200, less the deck's 15); it stopped at ${top.y}`);
  // and it does NOT wait for anyone: tag 0 is eighteen frames of 1160 — 1.2s —
  // and then `0x453490` sends it back the way it came, rider or no rider
  await page.waitForTimeout(500);
  const pausing = await at();
  if (pausing.y !== top.y) fail(`the car should pause at the head for its idle tag; it moved from ${top.y} to ${pausing.y} within 0.5s`);
  await page.waitForTimeout(1400);
  const returning = await at();
  if (returning.y <= top.y + 20) fail(`after its 18-frame pause the car should head back down on its own; it is still at ${returning.y}`);
  console.log(`ok    it stops 200px shy of the shaft's head at y ${top.y}, pauses its 18 frames, and returns on its own (y ${returning.y})`);

  // 5. the one that matters: #78 carries you to the goal's own platform
  await go(8613, 2548);
  let off = false;
  for (let i = 0; i < 90; i++) {
    await page.waitForTimeout(200);
    const me = await at();
    if (!off && me.y <= 2060) {
      await page.keyboard.down("ArrowRight");
      off = true;
    }
    if (off && me.x > 8700) break;
  }
  await page.keyboard.up("ArrowRight");
  await page.waitForTimeout(700);
  const goal = await at();
  if (!(goal.y >= 2016 && goal.y <= 2032 && goal.x > 8676)) {
    fail(`riding #78 should put the player on platform #108 (y2024, east of x8676); got x ${goal.x}, y ${goal.y}`);
  }
  console.log(`ok    and #78 delivers the player onto the goal's platform at x ${goal.x}, y ${goal.y}`);

  await finish(browser);
  console.log("PASS  CITY's five lifts carry their riders, and the top of level two can be entered");
};

await main();
