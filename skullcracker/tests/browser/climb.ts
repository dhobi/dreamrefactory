/**
 * Can level one be finished?
 *
 *   npm run dev:skullcracker                  # in one terminal
 *   npm run test:browser:skullcracker:climb   # in another
 *
 * Gravity is the port's invention and the ONLY one left — every animation script
 * in `SC.EXE` has been enumerated for vertical motion and the player's one
 * record is the launch, `dy -420`, with nothing anywhere that brings them down.
 * The launch, the lift, the climb and both ground speeds are the executable's.
 * WHAT they act on is entirely the disc's, and that is what this asserts. Every
 * number below is a literal out of `STREETS.SBK`:
 *
 *   - W is the RUN and the ladder and the jump's lift, all one flag
 *     (`[0x4ac3fe]`), while J is the jump: different keys in the original, from
 *     the binding table at 0x46b210 joined to the handlers at 0x402d54;
 *   - the street floor under x9700 is y1346;
 *   - `ladder` is the rect (732, 9632, 1223, 9779) with `param 35`, so the climb
 *     is fourteen rungs of 35px and tops out with the ANCHOR at 732, which puts
 *     the feet at 828 — the rect is in anchor space and a climb cel's anchor is at
 *     the hands, 96px above its own boots (see LADDER in src/walk.ts);
 *   - `platform` (854, 9272, 901, 9700) is the roof beside the ladder's top,
 *     (980, 8768, 1016, 9273) the next one west, (895, 8251, 929, 8699) the one
 *     across the gap, and (1033, 7752, 1080, 8183) the last;
 *   - `goal` is (794, 7731, 1035, 7874), and the y1033 roof ends inside it.
 *
 * So the test walks STREETS' own route from the foot of its ladder to its goal
 * and checks the player's y against those numbers at every step. Nothing in the
 * port arranged that route: the ladder reaches the first roof, the roofs step
 * west, and the last one ends in the goal rect, all of it out of the file.
 *
 * The one place it is a game rather than a walk is the gap between the y980 roof
 * and the y895 one — 69px across and 85px UP, which has to be jumped from the
 * edge. That is why the probe polls for x rather than sleeping: 30px of early
 * take-off turns a 69px crossing into a 98px one and the apex arrives too late.
 *
 * ## The route needs the run
 *
 * Two legs of it, and this is the test earning its keep. The launch reaches 77px
 * against the gap's 85, so W has to be held for the lift; and off the far roof's
 * west edge it is 68px of air to the next, which at the walk is 34 ticks and a
 * 289px fall that misses the roof completely. At the run it is 18 ticks and 81px.
 * The level is laid out for 225px/s, not 120.
 *
 * ## Why the waits are long
 *
 * The engine runs at 15fps and walks the player 8px a frame — 120px a second —
 * and this page now does the same, so crossing a roof takes seconds. Every leg
 * that can poll for a position does; the ones that cannot are timed against
 * 120px/s with room to spare.
 *
 * ## The trap
 *
 * Height alone proves nothing: a page with no gravity at all would report the
 * spawn height forever and "the player is at y1346" would pass. So the first
 * two steps are the A/B — standing still must NOT change y (gravity does not
 * push a standing player through the floor), and a jump MUST, in the same
 * window, with no other input.
 */
import { chromium } from "playwright";

const BASE = process.env.BASE ?? "http://localhost:5178";
/** the foot of STREETS' one ladder */
const START = 9700;

const fail = (why: string): never => {
  console.error(`FAIL  ${why}`);
  process.exit(1);
};

const main = async (): Promise<void> => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on("pageerror", (e) => fail(`page threw: ${e.message}`));

  await page.goto(`${BASE}/walk.html?level=1&x=${START}`);
  const hud = page.locator("#hud");
  await hud.filter({ hasText: /room \d+ of \d+/ }).waitFor({ timeout: 20_000 });

  const coord = async (which: "x" | "y"): Promise<number> => {
    const t = (await hud.textContent()) ?? "";
    const m = new RegExp(`${which} (-?\\d+)`).exec(t);
    return m ? Number(m[1]) : fail(`no ${which} in the HUD: ${t.slice(0, 120)}`);
  };
  /**
   * Wait out a jump: first for the player to LEAVE the ground, then to land.
   *
   * Both halves are needed. A jump is edge-triggered and lands on the next tick,
   * so a probe that only waits for "in the air" to go away sees it already gone
   * and returns before the player has left at all — which is how this file once
   * read a height mid-flight and called it a landing.
   */
  const settle = async (): Promise<void> => {
    for (let i = 0; i < 40; i++) {
      if (/in the air/.test((await hud.textContent()) ?? "")) break;
      await page.waitForTimeout(60);
    }
    for (let i = 0; i < 200; i++) {
      if (!/in the air/.test((await hud.textContent()) ?? "")) return;
      await page.waitForTimeout(60);
    }
  };
  const hold = async (keys: string[], ms: number): Promise<void> => {
    for (const k of keys) await page.keyboard.down(k);
    await page.waitForTimeout(ms);
    for (const k of keys) await page.keyboard.up(k);
  };
  const near = (got: number, want: number, slack = 4): boolean => Math.abs(got - want) <= slack;

  // the level's own cast: 21 of STREETS' init* records in the street room are
  // kinds this page has cels for, and they come out of the book, not a list here
  const spawned = /· (\d+) spawned/.exec((await hud.textContent()) ?? "");
  const mob = spawned ? Number(spawned[1]) : fail(`the HUD reports nothing spawned in STREETS`);
  if (mob !== 21) fail(`STREETS' street should spawn 21, got ${mob}`);
  console.log(`ok    the street spawns ${mob} of the level's own things`);

  const floor = await coord("y");
  if (!near(floor, 1346)) fail(`the street under x${START} should be y1346, got ${floor}`);
  console.log(`ok    standing on the street at y ${floor}`);

  // 1. gravity does not push a standing player anywhere
  await page.waitForTimeout(1200);
  if ((await coord("y")) !== floor) fail(`standing still moved the player to y ${await coord("y")}`);
  console.log(`ok    and stays there with no input`);

  // 2. the same window, jumping — must leave the ground and come back to it
  await page.keyboard.down("j");
  await page.waitForTimeout(150);
  const apex = await coord("y");
  await page.keyboard.up("j");
  if (apex >= floor) fail(`a jump did not leave the floor: y ${apex}`);
  await settle();
  if (!near(await coord("y"), floor)) fail(`after a jump, landed at y ${await coord("y")} not ${floor}`);
  console.log(`ok    a jump reaches y ${apex} and falls back to the street`);

  // 3. the ladder lifts the player off the street to its own top rung, and puts
  // them where the record says: x is `pointX` exactly, not the middle of the
  // trigger rect
  await hold(["ArrowUp"], 9000);
  const top = await coord("y");
  if (!near(top, 828)) fail(`the ladder's top rung leaves the feet at y828; the climb reached ${top}`);
  const railX = await coord("x");
  if (!near(railX, 9714)) fail(`a ladder puts the player at its own pointX 9714; got x ${railX}`);
  console.log(`ok    climbed the ladder to its top rung, y ${top} at x ${railX}`);

  // 4. stepping off west lands on the roof the file puts there
  await hold(["ArrowLeft"], 1600);
  await page.waitForTimeout(600);
  const roof = await coord("y");
  if (!near(roof, 854)) fail(`stepping off should land on the y854 roof; got y ${roof}`);
  console.log(`ok    stepped off onto the roof at y ${roof}, x ${await coord("x")}`);

  // 5. and on west to the next platform, one the file puts 126px lower
  await page.keyboard.down("ArrowLeft");
  for (let i = 0; i < 200 && (await coord("x")) > 9100; i++) await page.waitForTimeout(60);
  await page.keyboard.up("ArrowLeft");
  await page.waitForTimeout(600);
  const next = await coord("y");
  if (!near(next, 980)) fail(`the next roof west is y980; got y ${next}`);
  console.log(`ok    and on west to y ${next}, x ${await coord("x")}`);

  /**
   * 6. the gap — and this is the leg that needs the game's own mechanic.
   *
   * 85px up, and the launch alone reaches 77: `dy -420` over the player's
   * divisor of 12 is 35px in one frame, and gravity — the one number `SC.EXE`
   * genuinely does not contain — is set from the engine's own vertical rate
   * rather than from whatever clears this gap. So W has to be HELD, which is
   * what `0x429f00` spends `0x4723f0` on: 10.4px a frame of extra lift while the
   * key is down, twice, and 77 + 21 clears 85.
   *
   * Holding W is also the run, which is the same key and no accident — a running
   * jump is how you cross this, and the jump script's tag 3 is the running
   * launch with `dx 95` where the standing one has `dx 0`.
   */
  // Approach at the WALK, and only then hold W. The edge has to be found to
  // within a few pixels — 30px of early take-off turns the file's 69px crossing
  // into 98px and the apex arrives too late — and a poll every 60ms sees 7px of
  // walking but 13px of running, which is how this leg first came out flaky:
  // one slow poll and the run had already carried the player off the roof.
  await page.keyboard.down("ArrowLeft");
  for (let i = 0; i < 300 && (await coord("x")) > 8775; i++) await page.waitForTimeout(60);
  const edge = await coord("x");
  if (edge > 8800) fail(`never reached the roof's west edge; stopped at x ${edge}`);
  const still = await coord("y");
  if (!near(still, 980, 8)) fail(`walked off the roof before jumping: x ${edge}, y ${still}`);
  await page.keyboard.down("w");
  await page.keyboard.down("j");
  await page.waitForTimeout(90);
  await page.keyboard.up("j");
  await settle();
  // and W STAYS down for the rest of the route. Off the y895 roof's west edge
  // it is 68px of air to the y1033 one, and at the walk that is 34 ticks — long
  // enough under this gravity to fall 289px and miss the roof entirely. At the
  // run it is 18 ticks and an 81px drop, and the roof is where it should be.
  // The run is the speed this level is laid out for.
  const across = await coord("y");
  if (!near(across, 895, 6)) fail(`the jump across the gap should land on y895; got y ${across}, x ${await coord("x")} (took off from x ${edge}, y ${still})`);
  console.log(`ok    jumped the gap from x ${edge} onto y ${across}`);

  // 7. and on west, down the last roofs, into the goal rect.
  //
  //    Standing in it is arrival and not victory: since the quota went in, the
  //    goal is shut until the mission's share of STREETS is dead (src/mission.ts),
  //    and this test is about the ROUTE — that the disc's own platforms lead from
  //    the ladder to the rect. "at the goal" is what the page says on arrival
  //    with kills outstanding, which is exactly this walk.
  let arrived = false;
  for (let i = 0; i < 120; i++) {
    await page.waitForTimeout(200);
    if (/at the goal|level 1 complete/.test((await hud.textContent()) ?? "")) {
      arrived = true;
      break;
    }
  }
  await page.keyboard.up("ArrowLeft");
  if (!arrived) fail(`never reached the goal; stopped at x ${await coord("x")}, y ${await coord("y")}`);
  const gy = await coord("y");
  if (!near(gy, 1033, 4)) fail(`the goal is entered from the y1033 roof; standing at y ${gy}`);
  console.log(`ok    reached the goal at x ${await coord("x")}, y ${gy} — the route through STREETS holds`);

  await browser.close();
  console.log("PASS  STREETS' goal can be walked to, and the way through is the level's own");
};

void main().catch((e) => fail(String(e)));
