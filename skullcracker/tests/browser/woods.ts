/**
 * WOODS — level three, and the first one whose population is its own.
 *
 *   npm run dev -w skullcracker                  # in one terminal
 *   npm run test:browser:woods -w skullcracker   # in another
 *
 * Level three is one room ten thousand pixels wide with no plank, no lift and no
 * ladder in it. What it has instead is twenty enemies of five kinds and a floor
 * that stands up in front of you twice, and both of those were reasons this port
 * could not play it.
 *
 * What the file says, and what this checks:
 *
 *   - **a creator places its object at the record's POINT.** The level's spawner
 *     `0x4503a0` hands every creator the point as one dword and the rect's two
 *     corners as two more, and each creator's first move is
 *     `mov dword [obj+6], eax` with the point (`0x450f90` for the dog,
 *     `0x450a7b` for the punk). The rect is the patrol territory and nothing
 *     else. Standing them on its bottom edge — which is what this page did — put
 *     every foe in WOODS inside the terrain, and they fell through the world.
 *   - **five kinds, and only four of them count.** The dog's creator never calls
 *     `0x42f870`, the census, and its class never calls `0x40d1c0`, the bar. Six
 *     dogs are worth 200 apiece and nothing to the quota.
 *   - **the husk hatches.** `0x454690`, in the first tag of the fourth kind's
 *     death, calls `0x450a50` — the punk's own creator — at the dying thing's
 *     own position. So killing one leaves the population where it was, which is
 *     why it pays no award of its own.
 *   - **a rise over fifty pixels is a wall.** `0x42fedc` adds 0x32 to the floor
 *     under the body's new position and `0x42fef3` throws the move away if that
 *     is still above it. WOODS' ground has exactly two such steps, at x8746 and
 *     x8890, and clearing them is how the level is crossed.
 */
import { fail, finish, launch } from "./harness";

const BASE = process.env.BASE ?? "http://localhost:5178";

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
  const foe = async (): Promise<{ kind: string; hp: number; state: string; x: number; y: number } | null> => {
    const m = /nearest (\w+) (\d+)\/(\d+)hp (\w+) at x (-?\d+), y (-?\d+)/.exec(await say());
    return m ? { kind: m[1], hp: Number(m[2]), state: m[4], x: Number(m[5]), y: Number(m[6]) } : null;
  };
  const spawned = async (): Promise<number> => Number(/(\d+) spawned/.exec(await say())?.[1] ?? -1);
  /** `?x=` alone drops the player on the region's own floor, which WOODS has all the way across */
  const go = async (x?: number): Promise<void> => {
    await page.goto(`${BASE}/walk.html?level=3${x === undefined ? "" : `&x=${x}`}`);
    await hud.filter({ hasText: /room \d+ of \d+/ }).waitFor({ timeout: 30_000 });
    await page.waitForTimeout(700);
  };

  // 1. it opens where its own initplayer stands
  await go();
  const spawn = await at();
  if (!near(spawn.x, 826, 20)) fail(`WOODS should open at its own initplayer, x826; got x ${spawn.x}`);
  console.log(`ok    WOODS opens on its path at x ${spawn.x}, y ${spawn.y}`);

  // 2. the whole population is there, and the quota is only what enrols
  const all = await spawned();
  if (all !== 20) fail(`WOODS places 20 enemies this page has cels for; ${all} spawned`);
  const quota = /kill 55% of (\d+)/.exec(await say());
  if (!quota || Number(quota[1]) !== 14) {
    fail(`the census should be the 14 that call 0x42f870, not the six dogs too; got ${quota?.[1]}`);
  }
  console.log(`ok    all ${all} of its enemies stand up, and ${quota![1]} of them are the quota's`);

  // 3. and they stand on the ground rather than inside it. The room's own floor
  //    ends at y1590; a foe placed on its rect's bottom edge falls past that for
  //    ever, which is what the point fixes.
  await go(10400);
  for (let i = 0; i < 30; i++) {
    await page.waitForTimeout(400);
    const f = await foe();
    if (f && f.y > 1700) fail(`a ${f.kind} fell out of the level: y ${f.y}`);
  }
  const standing = await foe();
  console.log(`ok    and stay on their feet — ${standing?.kind} still at y ${standing?.y} after 12s`);

  // 4. the husk hatches a punk out of itself
  await go(2200);
  const before = await spawned();
  let killed = false;
  for (let i = 0; i < 400 && !killed; i++) {
    await page.waitForTimeout(40);
    const f = await foe();
    if (!f || f.kind !== "initwered") continue;
    if (f.state === "dead") {
      killed = true;
      break;
    }
    if (Math.abs(f.x - (await at()).x) < 70) {
      await page.keyboard.press("p");
      await page.waitForTimeout(220);
    }
  }
  if (!killed) fail(`never landed three blows on a husk`);
  await page.waitForTimeout(500);
  const after = await spawned();
  if (after !== before + 1) fail(`killing a husk should leave a punk standing: ${before} spawned, then ${after}`);
  const kid = await foe();
  if (!kid || kid.kind !== "initwerea") fail(`what climbs out is the punk 0x450a50 makes; got ${kid?.kind}`);
  console.log(`ok    three blows fell a husk and a ${kid!.kind} climbs out of it — ${before} spawned, then ${after}`);

  // 5. the dog: ten health, its own ten-cel gait, 200 points and no effect at all
  //    on the quota, because it is in nobody's census
  await go(3300);
  const before2 = /quota (\d+) of/.exec(await say())?.[1];
  const seen = new Set<number>();
  let down = false;
  for (let i = 0; i < 250 && !down; i++) {
    await page.waitForTimeout(40);
    const m = /unplated initdog (-?\d+)\/(\d+)hp (\w+) at x (-?\d+), y (-?\d+) cel (\d+)/.exec(await say());
    if (!m) break;
    seen.add(Number(m[6]));
    if (m[3] === "dead") {
      down = true;
      break;
    }
    if (Math.abs(Number(m[4]) - (await at()).x) < 70) {
      await page.keyboard.press("p");
      await page.waitForTimeout(220);
    }
  }
  const points = Number(/(\d+) points/.exec(await say())?.[1] ?? 0);
  if (points !== 200) fail(`a dog pays 0x40d450(0xc8); the score reads ${points}`);
  if (seen.size < 8) fail(`its gait is ten cels, 4800..4809; saw ${[...seen].join(" ")}`);
  const after2 = /quota (\d+) of/.exec(await say())?.[1];
  if (after2 !== before2) fail(`a dog is in no census and should not move the quota: ${before2} -> ${after2}`);
  console.log(`ok    a dog falls for 200 points, shows ${seen.size} of its own cels, and the quota stays at ${after2}`);

  // 6. the floor stands up at x8746, and the walk stops dead against it
  await go(8600);
  await page.keyboard.down("ArrowRight");
  for (let i = 0; i < 60; i++) {
    await page.waitForTimeout(100);
    if ((await at()).x > 8760) break;
  }
  await page.keyboard.up("ArrowRight");
  await page.waitForTimeout(400);
  const stopped = await at();
  if (stopped.x > 8770) fail(`the 70px step at x8746 should stop a walk; walked on to x ${stopped.x}`);
  console.log(`ok    the ground stands up at x8746 and the walk stops at x ${stopped.x}`);

  // 7. ...and a jump clears it, which is the whole of how level three is crossed
  await page.keyboard.down("ArrowRight");
  await page.keyboard.down("w");
  await page.keyboard.press("j");
  await page.waitForTimeout(1200);
  const over = await at();
  if (over.x < 8790) fail(`a jump should clear the step; still at x ${over.x}`);
  if (over.y > 1100) fail(`it should land on the higher ground, y~1060; got y ${over.y}`);
  console.log(`ok    and a jump puts the player over it, x ${over.x}, y ${over.y}`);

  // 8. the three presses: up and watching until the player's point is inside the
  //    record's own rect, and then the whole stroke
  await go(7000);
  if (/press \w+ cel/.test(await say())) fail(`a press should be idle until someone stands under it`);
  await page.keyboard.down("ArrowRight");
  const cels = new Set<number>();
  const states = new Set<string>();
  // every cel of the stroke is held ONE engine frame — the script's ticksPerFrame
  // is 1 — so a poll slower than 67ms walks straight past the two that matter
  for (let i = 0; i < 200; i++) {
    await page.waitForTimeout(20);
    const m = /press (\w+) cel (\d+)/.exec(await say());
    if (m) {
      states.add(m[1]);
      cels.add(Number(m[2]));
    }
  }
  await page.keyboard.up("ArrowRight");
  if (!states.has("slam") || !states.has("lift")) {
    fail(`a press should run its stroke and come back up; saw ${[...states].join(" ")}`);
  }
  // 4382 and 4383 are the only two cels of the stroke that carry a strike box
  if (!cels.has(4382) || !cels.has(4383)) fail(`the head should come down through 4382 and 4383; saw ${[...cels].join(" ")}`);
  console.log(`ok    walking under a press works it — ${[...states].join(" and ")}, ${cels.size} of its own cels`);

  // 9. the goal, from the level's own start, on the level's own ground
  await go();
  await page.keyboard.down("ArrowRight");
  await page.keyboard.down("w");
  let arrived = false;
  let last = (await at()).x;
  let stuck = 0;
  for (let i = 0; i < 500 && !arrived; i++) {
    await page.waitForTimeout(100);
    const here = await at();
    if (/at the goal|level 3 complete/.test(await say())) {
      arrived = true;
      break;
    }
    if (Math.abs(here.x - last) < 3) {
      stuck += 1;
      // the two steps are jumped, and nothing else on the route needs one
      if (stuck === 4) await page.keyboard.press("j");
      if (stuck > 30) break;
    } else stuck = 0;
    last = here.x;
  }
  await page.keyboard.up("ArrowRight");
  await page.keyboard.up("w");
  if (!arrived) fail(`never reached WOODS' goal; stopped at x ${(await at()).x}, y ${(await at()).y}`);
  const end = await at();
  if (!near(end.x, 11020, 120)) fail(`the goal rect is x11036..11153; arrived at x ${end.x}`);
  console.log(`ok    ran the level end to end and reached the goal at x ${end.x}, y ${end.y}`);

  await finish(browser);
  console.log("PASS  WOODS is populated by its own records and can be crossed to its goal");
};

await main();
