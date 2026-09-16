/**
 * SERVICE — level six, and the first level with machinery you can switch on.
 *
 *   npm run dev -w skullcracker                    # in one terminal
 *   npm run test:browser:service -w skullcracker   # in another
 *
 * Every level before this one is a route with things standing in it. SERVICE is
 * a route with a system: six `switch` records, twenty-two `initgoop` records
 * paired to them by `param` 501…506, and a gang who walk to the levers in their
 * own territory and throw them ON — because goop is what heals them.
 *
 * What the file says, and what this checks:
 *
 *   - **two new classes.** `initknifeboy` (25 health, 240 points, plate 13104)
 *     and `inithardcore` (750, 350, 13105), both dormant on one cel until the
 *     player's point is inside their own record's rect.
 *   - **the lever is a two-position toggle.** `0x436820(pos, dir)`: dir 0 throws
 *     an off one on, dir 1 throws an on one off, and nothing else answers. The
 *     player asks for dir 0 by standing at it with no direction held
 *     (`0x42987c`) and dir 1 by holding S (`0x4298ab`).
 *   - **the broadcast.** `0x43c3d0`, at the END of each throw, flips the tag of
 *     every goop on the same `param`.
 *   - **the gang throw them.** `0x438200` finds the first unlit lever inside
 *     the thing's own rect; it walks over and one frame of the reach calls
 *     `0x436820(lever, 0)`. Running east across the level lights all six.
 *   - **one cel of nine can touch you.** Only 518, the gob, carries a strike box
 *     and a blow pair, so the rest of the goop is weather.
 */
import { chromium } from "playwright";

const BASE = process.env.BASE ?? "http://localhost:5178";

const fail = (why: string): never => {
  console.error(`FAIL  ${why}`);
  process.exit(1);
};

const near = (a: number, b: number, slack = 3): boolean => Math.abs(a - b) <= slack;

const main = async (): Promise<void> => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on("pageerror", (e) => fail(`page threw: ${e.message}`));
  const hud = page.locator("#hud");

  const say = async (): Promise<string> => (await hud.textContent()) ?? "";
  const at = async (): Promise<{ x: number; y: number }> => {
    const m = /x (-?\d+), y (-?\d+)/.exec(await say());
    if (!m) fail(`no position in the HUD`);
    return { x: Number(m![1]), y: Number(m![2]) };
  };
  const lever = async (param: number): Promise<string> =>
    new RegExp(`switch ${param} (\\w+)`).exec(await say())?.[1] ?? "?";
  const onNow = async (): Promise<number> => Number(/goop (\d+) of \d+ on/.exec(await say())?.[1] ?? -1);
  const go = async (x?: number, damage = false): Promise<void> => {
    await page.goto(`${BASE}/walk.html?level=6${x === undefined ? "" : `&x=${x}`}${damage ? "&damage=1" : ""}`);
    await hud.filter({ hasText: /room \d+ of \d+/ }).waitFor({ timeout: 30_000 });
    await page.waitForTimeout(700);
  };

  // 1. it opens where its own initplayer stands, in the one room it has
  await go();
  const spawn = await at();
  if (!near(spawn.x, 116, 20)) fail(`SERVICE should open at its own initplayer, x116; got x ${spawn.x}`);
  if (!/room 1 of 1/.test(await say())) fail(`SERVICE is one region: ${/room[^·]*/.exec(await say())?.[0]}`);
  console.log(`ok    SERVICE opens at x ${spawn.x}, y ${spawn.y}, in its one room`);

  // 2. fifteen enemies of five kinds, and every one of them is in the census
  const all = Number(/(\d+) spawned/.exec(await say())?.[1] ?? -1);
  if (all !== 15) fail(`SERVICE places 4 + 3 + 3 + 4 + 1 enemies; ${all} spawned`);
  const census = /kill 75% of (\d+)/.exec(await say());
  if (!census || Number(census[1]) !== 15) fail(`all fifteen call 0x42f870; the census is ${census?.[1]}`);
  if (!/quota 11 of 11/.test(await say())) fail(`75% of 15 is 11: ${/quota[^·]*/.exec(await say())?.[0]}`);
  console.log(`ok    its ${all} enemies are all in the census, and the quota is 11`);

  // 3. the one with the knife: 25 health, and a statue on 1841 outside its rect.
  //    Its territory is x565..1123, so x1200 is close enough to be the nearest
  //    plated thing and far enough to leave it asleep.
  await go(1200);
  await page.waitForTimeout(1500);
  const still = new Set<number>();
  for (let i = 0; i < 20; i++) {
    await page.waitForTimeout(60);
    const m = /nearest initknifeboy (\d+)\/(\d+)hp \w+ at x -?\d+, y -?\d+ cel (\d+)/.exec(await say());
    if (!m) fail(`the one with the knife should be the nearest plated thing at x1200`);
    if (Number(m![2]) !== 25) fail(`0x436419 gives it 0x19 health; the bar reads ${m![2]}`);
    still.add(Number(m![3]));
  }
  if (still.size !== 1 || !still.has(1841)) fail(`a dormant one holds 1841 and nothing else; saw ${[...still].join(" ")}`);
  console.log(`ok    the one with the knife stands on 1841 with 25 health until you arrive`);

  // 4. ...and the one at the end of the level: 750, dormant on 6070. Its rect
  //    runs x8418..9191, which is the last stretch and the goal with it.
  await go(8400);
  await page.waitForTimeout(1500);
  const boss = new Set<number>();
  for (let i = 0; i < 20; i++) {
    await page.waitForTimeout(60);
    const m = /nearest inithardcore (\d+)\/(\d+)hp \w+ at x -?\d+, y -?\d+ cel (\d+)/.exec(await say());
    if (!m) fail(`the one at the end should be the nearest plated thing at x8400`);
    if (Number(m![2]) !== 750) fail(`0x4364b4 gives it 0x2ee health; the bar reads ${m![2]}`);
    boss.add(Number(m![3]));
  }
  if (boss.size !== 1 || !boss.has(6070)) fail(`it holds 6070 and nothing else; saw ${[...boss].join(" ")}`);
  console.log(`ok    and the one at the end stands on 6070 with 750 health`);

  // 5. six levers, and every one of them starts off
  await go();
  const levers = (await say()).match(/switch \d+ \w+/g) ?? [];
  if (levers.length !== 6) fail(`SERVICE places six switches; the HUD lists ${levers.length}`);
  if (!levers.every((l) => l.endsWith("off"))) fail(`they are created on tag 3, which is off: ${levers.join(", ")}`);
  if ((await onNow()) !== 0) fail(`and nothing is dripping yet: ${/goop[^·]*/.exec(await say())?.[0]}`);
  console.log(`ok    its six levers all start off, and none of its 22 nests is running`);

  // 6. standing at one throws it ON — `0x42987c`, which asks with no direction
  //    held — and the broadcast at the end of the throw starts its own goop
  await go(400);
  for (let i = 0; i < 40 && (await lever(501)) !== "on"; i++) await page.waitForTimeout(80);
  if ((await lever(501)) !== "on") fail(`standing at a lever should throw it; it is ${await lever(501)}`);
  await page.waitForTimeout(400);
  if ((await onNow()) !== 2) fail(`501's two nests should now be running: ${/goop[^·]*/.exec(await say())?.[0]}`);
  let fell = 0;
  for (let i = 0; i < 40; i++) {
    await page.waitForTimeout(80);
    fell = Math.max(fell, Number(/goop \d+ of \d+ on, (\d+) falling/.exec(await say())?.[1] ?? 0));
  }
  if (fell === 0) fail(`a running nest drips 42 frames in 512; nothing fell in three seconds`);
  console.log(`ok    standing at 501 throws it on, and its two nests drip — ${fell} in the air at once`);

  // 7. ...and S throws it back. `0x4298ab` is the only ask that turns one off.
  await page.keyboard.down("ArrowDown");
  const seen = new Set<string>();
  let off = false;
  for (let i = 0; i < 30 && !off; i++) {
    await page.waitForTimeout(40);
    const now = await lever(501);
    seen.add(now);
    off = now === "off";
  }
  await page.keyboard.up("ArrowDown");
  if (!off) fail(`S should throw a lit lever back; it is ${await lever(501)}`);
  // five cels at one engine frame each: it is thrown, it does not snap
  if (!seen.has("turningOff")) fail(`and the throw should be seen, not snap: saw ${[...seen].join(" ")}`);
  if ((await onNow()) !== 0) fail(`and the broadcast should stop its goop: ${/goop[^·]*/.exec(await say())?.[0]}`);
  console.log(`ok    and S throws it back, which stops the two nests it broadcasts to`);

  // 8. the gang throw them. x700 is inside the territory of the two that keep
  //    501 and outside the lever's own rect, so nothing the player does can
  //    account for it going on.
  await go(700);
  if ((await lever(501)) !== "off") fail(`501 should still be off at x700`);
  let theirs = false;
  for (let i = 0; i < 80 && !theirs; i++) {
    await page.waitForTimeout(100);
    theirs = (await lever(501)) !== "off";
  }
  if (!theirs) fail(`a woken keeper should walk to its own lever and throw it; 501 is still off`);
  console.log(`ok    a woken keeper walks to 501 and throws it on by itself`);

  // 9. one with the knife fought and felled, for what its handler pays
  await go(1100);
  await page.waitForTimeout(700);
  let dead = false;
  // the ground stands up 93px at x808 and this one's territory straddles it, so
  // the height has to be part of the reach: a kick aimed over its head misses
  for (let i = 0; i < 300 && !dead; i++) {
    await page.waitForTimeout(40);
    const m = /nearest (\w+) (-?\d+)\/(\d+)hp (\w+) at x (-?\d+), y (-?\d+)/.exec(await say());
    if (!m) break;
    if (m[1] === "initknifeboy" && m[4] === "dead") {
      dead = true;
      break;
    }
    const me = await at();
    const d = Number(m[5]) - me.x;
    const dy = Number(m[6]) - me.y;
    if (Math.abs(d) < 80 && Math.abs(dy) < 60) {
      await page.keyboard.press("k");
      await page.waitForTimeout(190);
    } else {
      const key = d > 0 ? "ArrowRight" : "ArrowLeft";
      await page.keyboard.down(key);
      await page.waitForTimeout(80);
      await page.keyboard.up(key);
    }
  }
  if (!dead) fail(`never felled one with the knife`);
  await page.waitForTimeout(700);
  const points = Number(/(\d+) points/.exec(await say())?.[1] ?? 0);
  if (points < 240) fail(`0x43a711 pays 0xf0 for it; the score reads ${points}`);
  console.log(`ok    one with the knife falls for ${points} points`);

  // 10. the goop hits back, once the switch that lets anything hit back is on.
  //     Only cel 518 carries a strike box, so this is the gob and nothing else.
  await go(400, true);
  if (!/damage ON 1200\/1200hp/.test(await say())) fail(`?damage=1 should arm it full`);
  let low = 1200;
  for (let i = 0; i < 150; i++) {
    await page.waitForTimeout(80);
    const h = Number(/damage ON (\d+)\//.exec(await say())?.[1] ?? -1);
    if (h >= 0) low = Math.min(low, h);
    if (low < 1200) break;
  }
  if (low >= 1200) fail(`standing under a running nest should cost health; still ${low}`);
  console.log(`ok    with damage armed, its goop takes the player down to ${low}`);

  // 11. the whole level, end to end, on its own three steps — and every lever
  //     lit behind it, because every one of the six is somebody's
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
    if (/at the goal|level 6 complete|screen is coming down/.test(await say())) {
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
  if (!arrived) fail(`never reached SERVICE's goal; stopped at x ${(await at()).x}, y ${(await at()).y}`);
  if (jumps > 5) fail(`the level's own steps are three; this took ${jumps} jumps`);
  const lit = ((await say()).match(/switch \d+ (?:on|turningOn)/g) ?? []).length;
  if (lit < 5) fail(`running past every keeper should light nearly all six; ${lit} are lit`);
  const end = await at();
  console.log(`ok    ran the level to the goal at x ${end.x}, y ${end.y}, on ${jumps} jumps, ${lit} of 6 levers lit behind`);

  await browser.close();
  console.log("PASS  SERVICE's two new classes stand, its levers pour, and its goal can be reached");
};

void main().catch((e) => fail(String(e)));
