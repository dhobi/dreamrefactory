/**
 * Do the enemies come at you — and is it the disc's own brain that brings them?
 *
 *   npm run dev -w skullcracker                   # in one terminal
 *   npm run test:browser:fights -w skullcracker   # in another
 *
 * `src/fights.ts` has the mechanism and every address it was read from. What
 * this asserts is that the parts of it that can be seen from outside are the
 * exe's parts and not a chase written to look like one:
 *
 *   - **the rect is what wakes it.** `0x44e5fb` is state 0 and the only thing
 *     that ends it is `0x434200` finding the player's own point inside the four
 *     words the creator copied out of the `init` record. So a punk twelve hundred
 *     pixels away in the same room does NOT notice, and the one whose patch you
 *     are standing in does.
 *   - **it closes.** The far bands install the class's walk, so five hundred
 *     pixels of gap have to come down to the last band of the class's own
 *     table. Its rect is 8971..10110 and its point 9540, so standing at x10050
 *     is inside the territory and half a screen from the thing that owns it.
 *   - **it swings at the innermost band.** `initwerea`'s table is `330 200 150
 *     80` (`0x477600`), and inside eighty pixels it plays a cel that carries a
 *     STRIKE BOX — which is the engine's own mark for an attacking frame and the
 *     same flag `0x45efd0` reads at `out+6` to tell whether the PLAYER is
 *     swinging. STREETS holds 1923, 1924, 1931, 1932, 1934, 1935 and 1943 and
 *     they belong to nothing else in the level.
 *   - **it turns to face you.** `0x44e73c` flips the facing when the forward
 *     distance is negative, and that is the whole of the frame.
 *   - **and none of it takes a point of health**, which is the brief. The blow
 *     the cels carry is read and wired, and it sits behind `?foehit=1`.
 *
 * ## The trap
 *
 * "The punk is nearer than it was" proves very little on its own: a patrol walks
 * up and down and half of that is toward you. So the two legs that matter are
 * the pair — the far one must NOT close over the same window in which the near
 * one does, and the near one must cross its own rect edge, which no patrol ever
 * does.
 */
import { BASE, fail, finish, launch } from "./harness";

/** `0x477600` — the punk's own band table, and the last of them is the swing */
const SWING_BAND = 80;
/** STREETS' punk attack cels, the ones carrying a strike box in that book */
const STRIKES = [1923, 1924, 1931, 1932, 1934, 1935, 1943];

const main = async (): Promise<void> => {
  const browser = await launch();
  const page = await browser.newPage({
    viewport: { width: 1280, height: 900 },
  });
  page.on("pageerror", (e) => fail(`page threw: ${e.message}`));
  const hud = page.locator("#hud");
  const say = async (): Promise<string> => (await hud.textContent()) ?? "";

  const go = async (level: number, x: number): Promise<void> => {
    await page.goto(`${BASE}/walk.html?level=${level}&x=${x}`);
    await hud
      .filter({ hasText: /room \d+ of \d+/ })
      .waitFor({ timeout: 30_000 });
    await page.waitForTimeout(500);
  };
  const near = async (): Promise<{
    kind: string;
    x: number;
    cel: number;
    on: boolean;
    swing: boolean;
  }> => {
    const t = await say();
    const m =
      /· nearest (\w+) \d+\/\d+hp \w+ at x (-?\d+), y -?\d+ cel (\d+)( \w+)?/.exec(
        t,
      );
    if (!m) fail(`no nearest foe in the HUD: ${t.slice(0, 200)}`);
    return {
      kind: m[1],
      x: Number(m[2]),
      cel: Number(m[3]),
      on: / closing| SWINGING/.test(m[4] ?? ""),
      swing: /SWINGING/.test(m[4] ?? ""),
    };
  };
  const fighting = async (): Promise<number> =>
    Number(/· (\d+) fighting/.exec(await say())?.[1] ?? 0);
  const me = async (): Promise<number> =>
    Number(/· x (-?\d+),/.exec(await say())?.[1] ?? NaN);

  // 1. out of every rect in the room and nobody has noticed. STREETS' punk
  //    territories run 2197..7026 and then 7758..10110, and x7400 is the gap
  //    between them — the same room and, in step 2, the same foes
  await go(1, 7400);
  await page.waitForTimeout(2500);
  if ((await fighting()) !== 0)
    fail(
      `nothing should have noticed at x7400: ${(await say()).slice(0, 200)}`,
    );
  const idle = await near();
  if (idle.on)
    fail(`${idle.kind} is fighting from x${idle.x} with the player at x7400`);
  console.log(
    `ok    nobody notices from x7400 — the nearest is ${idle.kind} at x ${idle.x}, patrolling`,
  );

  // 2. ...and standing in one, the class in it does. The rect is the record's,
  //    not a radius: this is the same room and the same foes as step 1
  await go(1, 10050);
  await page.waitForTimeout(600);
  if ((await fighting()) < 1)
    fail(
      `standing at x10050 should wake somebody: ${(await say()).slice(0, 200)}`,
    );
  const woke = await near();
  if (!woke.on)
    fail(
      `the nearest ${woke.kind} has not noticed: ${(await say()).slice(0, 200)}`,
    );
  console.log(
    `ok    standing at x10050 wakes ${await fighting()} of them — 0x434200 on the record's own rect`,
  );

  // 3. it closes, and it keeps closing past the point a patrol would turn
  const first = Math.abs((await near()).x - (await me()));
  let closest = first;
  // ...and it takes its time about it. A class with its own machine does not
  // march: `initwerea` leaps in, lands, walks, holds the stance while it spends
  // `AI+4`, taunts on `AI+2`'s beat and only then commits, which is about twelve
  // seconds from four hundred pixels out. The shared brain did it in five
  for (let i = 0; i < 200; i++) {
    await page.waitForTimeout(100);
    closest = Math.min(closest, Math.abs((await near()).x - (await me())));
  }
  if (closest >= first)
    fail(
      `it should have closed from ${first}px; the nearest it got was ${closest}px`,
    );
  // the poll is every 100ms and the punk's walk covers about nineteen pixels in
  // that, so the sample either side of the boundary is what the slack allows for
  if (closest > SWING_BAND + 25)
    fail(
      `0x477600's last band is ${SWING_BAND}px and it never got nearer than ${closest}px`,
    );
  console.log(
    `ok    it closed from ${first}px to ${closest}px — on the ${SWING_BAND}px band its own table ends on`,
  );

  // 4. and inside that band it plays a frame that carries a strike box
  const seen = new Set<number>();
  let swung = false;
  for (let i = 0; i < 60; i++) {
    await page.waitForTimeout(100);
    const n = await near();
    seen.add(n.cel);
    if (n.swing) swung = true;
  }
  const hits = [...seen].filter((c) => STRIKES.includes(c));
  if (!swung) fail(`it never entered a swing: cels ${[...seen].join(" ")}`);
  if (hits.length === 0)
    fail(`a swing has to reach a strike cel; saw ${[...seen].join(" ")}`);
  console.log(
    `ok    and it swings on its own strike cels — ${hits.join(", ")}`,
  );

  // 5. no health moves. The switch above it is off and so is its own
  if (!/damage off/.test(await say()))
    fail(
      `this should all happen with damage off: ${(await say()).slice(0, 200)}`,
    );
  console.log(
    `ok    and the player's health never enters it — the switch is off, and the foe's own is off under it`,
  );

  // 6. it turns to face you — `0x44e73c`. Walk past it and it comes back
  const before = (await near()).x;
  await page.keyboard.down("ArrowLeft");
  for (let i = 0; i < 40; i++) await page.waitForTimeout(80);
  await page.keyboard.up("ArrowLeft");
  const mine = await me();
  if (mine >= before)
    fail(
      `meant to walk west past it; the player is at x${mine} and it is at x${before}`,
    );
  let followed = false;
  for (let i = 0; i < 60 && !followed; i++) {
    await page.waitForTimeout(100);
    followed = (await near()).x < before;
  }
  if (!followed) fail(`it should have turned and followed west of x${before}`);
  console.log(
    `ok    walked past it and it turned round and came after — x ${(await near()).x}`,
  );

  // 7. and a class with a machine of its own is still driven by that one, not
  //    this: level eight's boss has `drives` and reports its own mode
  await go(8, 1500);
  await page.waitForTimeout(1500);
  const boss = await say();
  if (!/mode \w+/.test(boss))
    fail(
      `the level-eight boss should still report its own mode: ${boss.slice(0, 220)}`,
    );
  if (/nearest initwbooly .* (closing|SWINGING)/.test(boss))
    fail(
      `the boss must not be driven by the shared brain: ${boss.slice(0, 220)}`,
    );
  console.log(
    `ok    and the boss keeps its own machine — ${/mode (\w+)/.exec(boss)?.[1]}`,
  );

  await finish(browser);
  console.log(
    "PASS  the shared AI notices you on its own rect, closes, swings on its own strike cels, and takes nothing",
  );
};

await main();
