/**
 * MAZE — level thirteen, and the first level of chapter four.
 *
 *   npm run dev -w skullcracker                 # in one terminal
 *   npm run test:browser:maze -w skullcracker   # in another
 *
 * Seven regions and none of them wider than 2696 pixels: the level is a ring of
 * corridors rather than a run, and four of its seven region records are named
 * `newroom1`…`newroom4` rather than `newroom`.
 *
 *   - **the TCop** (`initcop`), which `lab.snd` names outright: `#0084 TCop
 *     Dies`, `#0085 TCop eats`, three `TCop punc[h]`es. 250 health and **550
 *     points**, the most any creature outside a boss is worth.
 *   - **the slurp** (`initslurp`), twenty of them, sixty health, worth nothing,
 *     and one cel: `0x46d268`, `0x46d278` and `0x46d458` are three scripts of
 *     three kinds and every record in all three is 2550.
 *   - **the cage door and the switch**, which is SERVICE's lever told again —
 *     and thrown by the same hand: `0x414664` is inside the COP's think, so
 *     level thirteen's doors are opened by its guards.
 *   - **the alarms and the fans**, which keep their own counters and answer to
 *     nothing in the level at all.
 */
import { BASE, fail, finish, launch } from "./harness";

const main = async (): Promise<void> => {
  const browser = await launch();
  const page = await browser.newPage({
    viewport: { width: 1280, height: 900 },
  });
  page.on("pageerror", (e) => fail(`page threw: ${e.message}`));
  const hud = page.locator("#hud");

  const say = async (): Promise<string> => (await hud.textContent()) ?? "";
  const at = async (): Promise<number> =>
    Number(/· x (-?\d+), y/.exec(await say())?.[1] ?? NaN);
  const go = async (q: string): Promise<void> => {
    await page.goto(`${BASE}/walk.html?level=13${q}`);
    await hud
      .filter({ hasText: /room \d+ of \d+/ })
      .waitFor({ timeout: 30_000 });
    await page.waitForTimeout(400);
    let last = "";
    for (let i = 0; i < 25; i++) {
      const now = /· x (-?\d+), y (-?\d+)/.exec(await say())?.[0] ?? "";
      if (now && now === last) return;
      last = now;
      await page.waitForTimeout(120);
    }
  };
  const fight = async (kind: string, tries: number): Promise<number> => {
    const before = Number(/(\d+) points/.exec(await say())?.[1] ?? 0);
    let lastX: number | null = null;
    let missed = 0;
    for (let i = 0; i < tries; i++) {
      await page.waitForTimeout(40);
      const m = new RegExp(
        `nearest ${kind} (-?\\d+)/(\\d+)hp (\\w+) at x (-?\\d+)`,
      ).exec(await say());
      if (!m) {
        if (++missed > 40 || lastX === null) break;
      } else {
        missed = 0;
        if (m[3] === "dead") break;
        lastX = Number(m[4]);
      }
      const d = lastX! - (await at());
      if (Math.abs(d) < 90) {
        await page.keyboard.press("k");
        await page.waitForTimeout(190);
      } else {
        const key = d > 0 ? "ArrowRight" : "ArrowLeft";
        await page.keyboard.down(key);
        await page.waitForTimeout(80);
        await page.keyboard.up(key);
      }
    }
    await page.waitForTimeout(600);
    return Number(/(\d+) points/.exec(await say())?.[1] ?? 0) - before;
  };

  // 1. seven regions, a census of twenty-seven, and its own clock
  await go("");
  if (!/room \d+ of 7/.test(await say()))
    fail(
      `MAZE has seven regions; the HUD says ${/room[^·]*/.exec(await say())?.[0]}`,
    );
  if (!/kill 35% of 27/.test(await say()))
    fail(
      `seven cops and twenty slurps count; the census is ${/kill[^·)]*/.exec(await say())?.[0]}`,
    );
  const clock = Number(/clock (\d+)/.exec(await say())?.[1] ?? 0);
  if (clock < 3100 || clock > 3200)
    fail(`MAZE's timer record carries 3200; the panel says ${clock}`);
  console.log(
    `ok    MAZE is seven regions, a census of 27, and ${clock} frames on its own clock`,
  );

  // 2. the TCop — 250 health and 550 points
  await go("&x=3400&y=7300");
  if (!/nearest initcop 250\/250hp/.test(await say()))
    fail(
      `0x4116b5 gives it 0x40e300(0xfa); the bar reads ${/initcop [^ ]*/.exec(await say())?.[0]}`,
    );
  const copPay = await fight("initcop", 400);
  if (copPay !== 550)
    fail(`0x41490d pays 0x226 for a TCop; the score reads ${copPay}`);
  console.log(
    `ok    a TCop is 250 health and ${copPay} points — the most outside a boss`,
  );

  // 3. the slurp — sixty health, and a repertoire of its own
  await go("&x=2100&y=7600");
  if (!/nearest initslurp 60\/60hp/.test(await say()))
    fail(
      `0x411a74 gives it 0x40e300(0x3c); the bar reads ${/initslurp [^ ]*/.exec(await say())?.[0]}`,
    );
  const cels = new Set<number>();
  for (let i = 0; i < 12; i++) {
    await page.waitForTimeout(60);
    const m = /nearest initslurp [^·]*? cel (\d+)/.exec(await say());
    if (m) cels.add(Number(m[1]));
  }
  /**
   * ...and it is NOT one cel. This used to assert that a slurp never changes
   * what it shows, which was a description of the port rather than of the disc:
   * `0x414ae0` is an eight-state machine and `foes.ts` had `gait` pointing at
   * `0x46d268`, the one dormant cel, so every script it installed was thrown
   * away. Its own cels are 2500–2704 — `0x46d288` the drift in, `0x46d2c0` the
   * walk and the two climbs, `0x46d370` the bolt, `0x46d3d8` the hypnosis — and
   * 2550 is only the stance it comes back to.
   */
  // which of its own cels a sample catches is `0x414e22`'s business — 2550 is
  // the stance it rests on, 2650s the bolt, 2500s the hypnosis, 2551..2553 the
  // drift — so this asks that it is RUNNING the machine, not which frame it is on
  if (cels.size < 2)
    fail(
      `a slurp should run its own machine, not hold one cel; saw only ${[...cels].join(" ")}`,
    );
  if (![...cels].some((c) => c >= 2500 && c <= 2704))
    fail(`its cels are 2500..2704; saw ${[...cels].join(" ")}`);
  const slurpPay = await fight("initslurp", 200);
  if (slurpPay !== 0)
    fail(`0x415100 has no 0x40d450 in it; the score moved by ${slurpPay}`);
  console.log(`ok    a slurp is sixty health, one cel 2550, and pays nothing`);

  // 4. the cage doors: a shut one is an OBSTACLE, which is `0x411460` appending
  //    its own rect to the same table the level's `obstacle` records fill
  await go("&x=2100&y=7600");
  if (!/cage 4 shut cel 2010 at x1160/.test(await say()))
    fail(`the cage at x1160 opens shut on 2010`);
  if (!/cage 4 open cel 0 at x1859/.test(await say()))
    fail(`a record with a NEGATIVE param opens open, and draws nothing`);
  await page.keyboard.down("ArrowLeft");
  for (let i = 0; i < 40; i++) await page.waitForTimeout(80);
  await page.keyboard.up("ArrowLeft");
  await page.waitForTimeout(300);
  const stopped = await at();
  // the cage at x2061 is shut and its rect runs 2008..2115, so a walk west out
  // of x2115 does not start: 0x411460 has already made it wall
  if (stopped < 2000)
    fail(`the shut cage at x2061 should stop a walk west; got to x ${stopped}`);
  console.log(
    `ok    the shut cage at x2061 holds a walk at x ${stopped}, and the open one draws nothing`,
  );

  // 5. ...and a COP opens one. `0x414664` is inside the cop's own think: within
  //    ten pixels of a switch it calls `0x412550`, which hands tag 3 to tag 0.
  await go("&x=3400&y=7300");
  const seen = new Set<string>();
  for (let i = 0; i < 50; i++) {
    await page.waitForTimeout(150);
    const m = /cage 1 (\w+) /.exec(await say());
    if (m) seen.add(m[1]);
    const w = /switch 1 (\w+)/.exec(await say());
    if (w) seen.add(`sw:${w[1]}`);
    if (seen.has("open")) break;
  }
  if (!seen.has("sw:on"))
    fail(
      `a cop should throw the switch at x3521; it showed ${[...seen].join(" ")}`,
    );
  if (!seen.has("open"))
    fail(`and the cage at x3382 should open; it showed ${[...seen].join(" ")}`);
  console.log(
    `ok    a cop walks to the switch and throws it, and the cage opens: ${[...seen].join(" -> ")}`,
  );

  // 6. the fans, which nothing in the level starts: 15 frames still, 60 turning
  await go("&x=3400&y=7300");
  const fans = new Set<string>();
  const fanCels = new Set<number>();
  for (let i = 0; i < 45; i++) {
    await page.waitForTimeout(100);
    const m = /fan h (\w+) cel (\d+)/.exec(await say());
    if (m) {
      fans.add(m[1]);
      fanCels.add(Number(m[2]));
    }
  }
  if (!fans.has("on") || !fans.has("off"))
    fail(
      `a fan is off for fifteen frames and on for sixty; it showed ${[...fans].join(" ")}`,
    );
  if ([...fanCels].some((c) => c < 10020 || c > 10024))
    fail(`0x46d478 is 10020..10024; saw ${[...fanCels].join(" ")}`);
  console.log(
    `ok    a fan turns itself on and off through ${[...fans].join(", ")} on its own counter`,
  );

  // 7. the big guns — `0x4115b0` makes two objects of one record and `0x4135b0`
  //    runs them through eight script kinds. Standing inside the rect takes it
  //    the whole way round; the bolt it fires is the BLASTER's, out of the same
  //    `0x412a70` the armed player calls, and it goes towards you.
  await go("&x=1850&y=7100");
  const states: string[] = [];
  const gunCels = new Set<number>();
  let bolt = "";
  for (let i = 0; i < 170; i++) {
    await page.waitForTimeout(60);
    const t = await say();
    const m = /biggun (\w+)\/(\d) y(-?\d+) cel (\d+)/.exec(t);
    if (m) {
      if (states[states.length - 1] !== m[1]) states.push(m[1]);
      if (Number(m[4])) gunCels.add(Number(m[4]));
    }
    if (!bolt)
      bolt =
        /· \d+ bolts?, nearest at x -?\d+, y -?\d+ vx (-?\d+)/.exec(t)?.[1] ??
        "";
  }
  for (const want of ["arm", "drop", "unfold", "fire", "blink"]) {
    if (!states.includes(want))
      fail(
        `0x413930's kinds should run in order; it did ${states.join(" -> ")}`,
      );
  }
  if ([...gunCels].some((c) => c < 10080 || c > 10101)) {
    fail(
      `the turret's cels are 0x46c350..0x46c3e0's 10080..10101; saw ${[...gunCels].sort().join(" ")}`,
    );
  }
  if (!bolt)
    fail(
      `0x41374c fires 0x412a70; no bolt appeared in ten seconds under the gun`,
    );
  if (Number(bolt) >= 0)
    fail(
      `the gun stands at x2167 and the probe at x1850, so its bolt goes LEFT; vx ${bolt}`,
    );
  console.log(
    `ok    a big gun drops, unfolds and fires the blaster's own bolt at you: ${states.slice(0, 6).join(" -> ")}, vx ${bolt}`,
  );

  // ...and walking out of the rect folds it away wherever it had got to —
  //    every interruptible kind tests the rect first (`0x413692`, `0x4136e3`,
  //    `0x4137b4`) and installs `0x46c428` the moment the answer is no
  await go("&x=1600&y=7100");
  let home = "";
  for (let i = 0; i < 90 && home !== "wait"; i++) {
    await page.waitForTimeout(60);
    home = /biggun (\w+)\//.exec(await say())?.[1] ?? "";
  }
  if (home !== "wait")
    fail(`x1600 is outside the rect 1775..2610; the gun stayed on ${home}`);
  console.log(
    `ok    ...and it folds back up and waits when you are not under it`,
  );

  /**
   * ...and its four LADDERS carry you between its regions, both ways.
   *
   * MAZE is the level that proved a ladder is not a region's to hold. This page
   * filed every record into the region its CENTRE falls in, and all four of
   * MAZE's ladders centre in NO region at all — the first misses room 0's bottom
   * edge by one pixel — so the level had no ladders whatever.
   *
   * The engine files nothing: `0x40b940` is its only entity query and it is a
   * linear scan of the whole table, kind 2 asking whether a rect holds a point
   * (`0x434200`), with no reference to a region anywhere in it. So the ladders
   * are kept whole on the level.
   *
   * Each row is the record's own `pointX`, a y at the ladder's HEAD, and the
   * two legs the rect is worth. The head rather than the foot because two of
   * the four END in `newroom1`, which has no rasterised ground at all: a player
   * put down there falls out of the world, so those two are climbed down into
   * rather than up out of.
   */
  for (const [x, head, down, up] of [
    [1615, 7126, 1200, 1200],
    [2401, 8021, 400, 420],
    [3678, 7114, 800, 800],
    [5295, 7354, 600, 600],
  ] as const) {
    await go(`&x=${x}&y=${head}`);
    // where it actually put us: `go` drops the player onto the room's own floor,
    // which is not the y asked for
    const from = Number(/· x -?\d+, y (-?\d+)/.exec(await say())?.[1] ?? NaN);
    await page.keyboard.down("s");
    await page.waitForTimeout(11_000);
    await page.keyboard.up("s");
    await page.waitForTimeout(300);
    const foot = Number(/· x -?\d+, y (-?\d+)/.exec(await say())?.[1] ?? NaN);
    const low = /room (\d+) of/.exec(await say())?.[1] ?? "";
    await page.keyboard.down("w");
    await page.waitForTimeout(13_000);
    await page.keyboard.up("w");
    await page.waitForTimeout(300);
    const top = Number(/· x -?\d+, y (-?\d+)/.exec(await say())?.[1] ?? NaN);
    const high = /room (\d+) of/.exec(await say())?.[1] ?? "";
    if (foot - from < down)
      fail(
        `the ladder at x${x} should take you ${down}px down; it went ${from} to ${foot}`,
      );
    if (foot - top < up)
      fail(
        `the ladder at x${x} should lift you ${up}px; it went ${foot} to ${top}`,
      );
    if (low === high)
      fail(
        `the ladder at x${x} reaches out of room ${low}; the page never left it`,
      );
    console.log(
      `ok    the ladder at x${x} runs ${foot - top}px, room ${low} to room ${high}`,
    );
  }

  await finish(browser);
  console.log(
    "PASS  MAZE's cops work its levers, its cages are wall, its fans keep their own time, its big guns fire and its ladders climb",
  );
};

await main();
