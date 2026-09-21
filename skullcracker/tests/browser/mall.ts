/**
 * MALL — level five, and the first level that is three rooms wide.
 *
 *   npm run dev -w skullcracker                 # in one terminal
 *   npm run test:browser:mall -w skullcracker   # in another
 *
 * Level five opens a chapter whose classes this port had none of, and it is laid
 * out unlike anything before it: **three regions side by side**, overlapping by
 * six pixels, with no `exitroom` between them. You walk out of one and into the
 * next, which is what `0x40b940(2, point)` does for every object on every frame —
 * the region you are in is whichever one contains your point. There is not a
 * single `platform` record in the level; the whole of it stands on those three
 * floors.
 *
 * What the file says, and what this checks:
 *
 *   - **the rooms hand over on the point.** Region one ends at x6729 and region
 *     two begins at x6723. A rule that keeps the whole sprite inside a room
 *     reserves half a body at each end, and half a body is wider than the
 *     overlap — which is why the run east used to stop dead at the seam.
 *   - **two walls and no more.** The floor stands up over fifty pixels in exactly
 *     two places, x5338 and x6875, and `0x42fef3` throws away a move that cannot
 *     climb it. Those two steps are the whole of level five's platforming.
 *   - **the goal is in the third region**, 11000 pixels east of the start.
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
  const room = async (): Promise<number> => Number(/room (\d+) of/.exec(await say())?.[1] ?? -1);
  const go = async (x?: number): Promise<void> => {
    await page.goto(`${BASE}/walk.html?level=5${x === undefined ? "" : `&x=${x}`}`);
    await hud.filter({ hasText: /room \d+ of \d+/ }).waitFor({ timeout: 30_000 });
    await page.waitForTimeout(700);
  };

  // 1. it opens where its own initplayer stands, in the first of three rooms
  await go();
  const spawn = await at();
  if (!near(spawn.x, 112, 20)) fail(`MALL should open at its own initplayer, x112; got x ${spawn.x}`);
  if ((await room()) !== 1) fail(`it should open in the first region; the HUD says ${await room()}`);
  if (!/room \d+ of 3/.test(await say())) fail(`MALL has three regions; the HUD says ${/room[^·]*/.exec(await say())?.[0]}`);
  console.log(`ok    MALL opens at x ${spawn.x}, y ${spawn.y}, in room 1 of 3`);

  // 2. the floor stands up at x5338, and a walk stops dead against it
  await go(5200);
  await page.keyboard.down("ArrowRight");
  for (let i = 0; i < 60; i++) {
    await page.waitForTimeout(100);
    if ((await at()).x > 5360) break;
  }
  await page.keyboard.up("ArrowRight");
  await page.waitForTimeout(400);
  const stopped = await at();
  if (stopped.x > 5350) fail(`the step at x5338 should stop a walk; walked on to x ${stopped.x}`);
  console.log(`ok    the floor stands up at x5338 and the walk stops at x ${stopped.x}`);

  // 3. ...and a jump clears it
  await page.keyboard.down("ArrowRight");
  await page.keyboard.down("w");
  await page.keyboard.press("j");
  await page.waitForTimeout(1400);
  await page.keyboard.up("ArrowRight");
  await page.keyboard.up("w");
  const over = await at();
  if (over.x < 5380) fail(`a jump should clear the step; still at x ${over.x}`);
  console.log(`ok    and a jump puts the player over it, x ${over.x}`);

  // 4. the seam. Region one's floor runs past its own right edge, so the walk
  //    carries on and the region under the point takes over.
  await go(6600);
  if ((await room()) !== 1) fail(`x6600 is in region one; the HUD says ${await room()}`);
  await page.keyboard.down("ArrowRight");
  let handed = 0;
  for (let i = 0; i < 60; i++) {
    await page.waitForTimeout(100);
    if ((await room()) === 2) {
      handed = (await at()).x;
      break;
    }
  }
  await page.keyboard.up("ArrowRight");
  if (!handed) fail(`walking east out of region one never reached region two`);
  if (handed > 6800) fail(`the hand-over should happen at the overlap around x6723; it happened at x ${handed}`);
  console.log(`ok    walking east hands region one over to region two at x ${handed}`);

  // 5. sixteen enemies in three kinds, and every one of them counts. MALL's
  //    share is 75%, and unlike level three there is no kind here that sits
  //    outside the census: all three call `0x42f870`.
  await go();
  const census = /kill 75% of (\d+)/.exec(await say());
  if (!census || Number(census[1]) !== 16) fail(`MALL places 9 + 4 + 3 enemies, all counting; the census is ${census?.[1]}`);
  if (!/quota 12 of 12/.test(await say())) fail(`75% of 16 is 12: ${/quota[^·]*/.exec(await say())?.[0]}`);
  console.log(`ok    its ${census![1]} enemies are all in the census, and the quota is 12`);

  // 6. they are statues until you come to them — every enemy in this chapter
  //    stands dormant on one cel until the player's point is inside its own
  //    record's rect (`0x4388dd`, `0x439365`, `0x437c41`).
  //
  //    The level's own start is the place to watch from: the player stands at
  //    x112 and the westmost enemy's territory begins at x236, so it is close
  //    enough to be the nearest and far enough to be asleep.
  await go();
  await page.waitForTimeout(2500);
  const still = new Set<number>();
  for (let i = 0; i < 20; i++) {
    await page.waitForTimeout(60);
    const m = /nearest initmaskboy [^·]*? cel (\d+)/.exec(await say());
    if (m) still.add(Number(m[1]));
  }
  if (still.size !== 1 || !still.has(1801)) fail(`a dormant one holds cel 1801 and nothing else; saw ${[...still].join(" ")}`);
  console.log(`ok    and they stand dormant on cel 1801 until the player arrives`);

  // 7. ...and one of them fought and felled, for what its handler pays
  await go(700);
  await page.waitForTimeout(700);
  let dead = false;
  for (let i = 0; i < 220 && !dead; i++) {
    await page.waitForTimeout(40);
    const m = /nearest initmaskboy (-?\d+)\/(\d+)hp (\w+) at x (-?\d+)/.exec(await say());
    if (!m) break;
    if (Number(m[2]) !== 40) fail(`0x4362d7 gives it 0x28 health; the bar reads ${m[2]}`);
    if (m[3] === "dead") {
      dead = true;
      break;
    }
    const d = Number(m[4]) - (await at()).x;
    if (Math.abs(d) < 80) {
      await page.keyboard.press("k");
      await page.waitForTimeout(190);
    } else {
      const key = d > 0 ? "ArrowRight" : "ArrowLeft";
      await page.keyboard.down(key);
      await page.waitForTimeout(80);
      await page.keyboard.up(key);
    }
  }
  if (!dead) fail(`never felled a masked one`);
  await page.waitForTimeout(700);
  const points = Number(/(\d+) points/.exec(await say())?.[1] ?? 0);
  if (points < 220) fail(`0x4390ac pays 0xdc for it; the score reads ${points}`);
  console.log(`ok    one falls for ${points} points`);

  // 8. the Coke machine: four cans' worth of punching and then it is empty. Its
  //    cels lose their body box at 8505, which is what stops it being hittable.
  await go(700);
  await page.waitForTimeout(700);
  const cans = new Set<number>();
  for (let i = 0; i < 80; i++) {
    await page.waitForTimeout(60);
    const m = /unplated initcoke [^·]*? cel (\d+)/.exec(await say());
    if (m) cans.add(Number(m[1]));
    if (i % 3 === 0) await page.keyboard.press("p");
  }
  if (!cans.has(8500)) fail(`a Coke machine stands on 8500; saw ${[...cans].join(" ")}`);
  if (![8501, 8502].every((c) => cans.has(c))) fail(`punching it should rock it on 8501/8502; saw ${[...cans].join(" ")}`);
  if (!cans.has(8505)) fail(`four cans in and it should be showing the emptied 8505; saw ${[...cans].join(" ")}`);
  console.log(`ok    a Coke machine rocks through ${cans.size} of its own cels and empties on 8505`);

  /**
   * 9. the ROLLER, which is the one hazard a creature in this game builds.
   *
   * `0x438848` sits in the keeper's preamble: two in sixty-eight an engine
   * frame, with the player inside 300 in x and the keeper WEST of him, sends
   * `0x43a790` to build one at the player's own y, six hundred pixels the far
   * side of him. x1200 is the place to stand for it — the masked one at x1146
   * is 54 west and well inside the 300 — and the three legs above have already
   * shown that the same spot with the keeper EAST of the player builds nothing.
   *
   * Then `0x43a99b` counts `AI+8` down from forty before `0x42f8b0` spends the
   * stored velocity, so it sits on cel 1970 for forty-one frames and only then
   * rolls. It is worth a hundred while it is quick and nothing when it is not
   * (`0x43a993` against `0x43aa34`).
   */
  await go(1200);
  const roll = /· \d+ roller, first cel (\d+) at x (-?\d+), y (-?\d+) wait (-?\d+) vx (-?\d+) blow (-?\d+)/;
  /**
   * ...and the budget is thirty seconds rather than ten, because the roll is
   * only taken while the keeper is IN position.
   *
   * Two in sixty-eight a frame would be near-certain inside ten seconds on its
   * own. The gate is not: this one is awake and fighting, so it walks in and
   * out of the 300 and back and forth across the player, and only the frames it
   * spends west of him and inside that band roll at all. Under the pooled
   * runner the browser also gets fewer frames to the wall-clock second. Ten
   * seconds flaked on both counts.
   */
  let born: RegExpExecArray | null = null;
  for (let i = 0; i < 750 && !born; i++) {
    await page.waitForTimeout(40);
    const m = roll.exec(await say());
    if (m && Number(m[4]) > 30) born = m;
  }
  if (!born) fail(`0x438848 should build a roller with the player at x1200; none came in thirty seconds`);
  const me = await at();
  if (!near(Number(born![2]), me.x + 0x258, 40))
    fail(`0x43889c builds it 600 east of the player; he is at x ${me.x} and it is at x ${born![2]}`);
  if (Number(born![1]) !== 1970) fail(`0x43a8e5 stands it on cel 1970; it showed ${born![1]}`);
  if (Number(born![5]) !== -0x1e0) fail(`0x43887d gives it vx -480; the line reads ${born![5]}`);
  if (Number(born![6]) !== 0) fail(`a roller that has not been launched is worth nothing; it read ${born![6]}`);
  console.log(`ok    a keeper west of you builds a roller at x ${born![2]}, 600 the far side, waiting on cel 1970`);

  // ...and it waits, and then it rolls — west, at a flat 480 over a divisor of 7
  const cels = new Set<number>();
  const xs: number[] = [];
  let armed = 0;
  for (let i = 0; i < 400; i++) {
    await page.waitForTimeout(40);
    const m = roll.exec(await say());
    if (!m || Number(m[4]) >= 0) continue;
    cels.add(Number(m[1]));
    armed = Math.max(armed, Number(m[6]));
    const x = Number(m[2]);
    if (xs[xs.length - 1] !== x) xs.push(x);
    if (xs.length > 6) break;
  }
  if (xs.length < 3) fail(`0x43a99b launches it after forty frames; it never moved (${xs.join(",")})`);
  if (xs[xs.length - 1] >= xs[0]) fail(`it rolls back WEST at the player; it went ${xs.join(" -> ")}`);
  /**
   * 480 over the divisor of 7 is 68 a frame, and nothing takes it away: the
   * drag `0x43a7c8` set is never spent, because `0x42fdba` skips the contact
   * arm while `obj+0xa` is zero and nothing ever gives a roller a weight.
   *
   * The step is asked as a MULTIPLE of 68 rather than 68 itself, because this
   * loop samples the HUD and does not drive the clock: a poll slower than the
   * engine's frame sees two or three frames' worth in one reading. What a
   * multiple still proves is the part that matters — the speed never decays,
   * which is the whole of the misreading this leg was written for.
   */
  const steps = xs.slice(1).map((x, i) => xs[i] - x);
  if (!steps.every((d) => d > 0 && d % 68 === 0))
    fail(`480 over 7 is 68 a frame and it does not decay; the steps were ${steps.join(",")}`);
  if (![...cels].every((c) => c === 1970 || c === 1971))
    fail(`0x4747e8 tag 0 is cels 1970 and 1971; saw ${[...cels].join(",")}`);
  if (armed !== 0x64) fail(`0x43a993 makes a moving one worth 0x64; the line read ${armed}`);
  console.log(`ok    ...and it waits its forty frames, then rolls west 68 a frame on ${[...cels].sort().join(",")}, worth ${armed}`);

  // 10. the whole level, end to end, on its own two jumps
  await go();
  await page.keyboard.down("ArrowRight");
  await page.keyboard.down("w");
  let arrived = false;
  let last = (await at()).x;
  let stuck = 0;
  let jumps = 0;
  for (let i = 0; i < 500 && !arrived; i++) {
    await page.waitForTimeout(100);
    const here = await at();
    if (/at the goal|level 5 complete|screen is coming down/.test(await say())) {
      arrived = true;
      break;
    }
    if (Math.abs(here.x - last) < 3) {
      stuck += 1;
      if (stuck === 4) {
        await page.keyboard.press("j");
        jumps += 1;
      }
      if (stuck > 30) break;
    } else stuck = 0;
    last = here.x;
  }
  await page.keyboard.up("ArrowRight");
  await page.keyboard.up("w");
  if (!arrived) fail(`never reached MALL's goal; stopped at x ${(await at()).x}, y ${(await at()).y}`);
  if (jumps > 4) fail(`the level's own walls are two; this took ${jumps} jumps`);
  if ((await room()) !== 3) fail(`the goal is in the third region; the HUD says ${await room()}`);
  const end = await at();
  console.log(`ok    ran all three rooms to the goal at x ${end.x}, y ${end.y}, on ${jumps} jumps`);

  await finish(browser);
  console.log("PASS  MALL's three regions hand over on foot, and its goal can be reached");
};

await main();
