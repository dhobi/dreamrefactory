/**
 * The blow CODES — a negative `obj+0x1a`, which is a message and not damage.
 *
 *   npm run dev -w skullcracker                  # in one terminal
 *   npm run test:browser:codes -w skullcracker   # in another
 *
 * `0x448c72` reads the sign before anything else and jumps through the table at
 * `0x4492b8`, so there are exactly eight of them and the dispatch is dense. This
 * walks the three the levels can actually deliver:
 *
 *   - **-3, the grab.** GRAVE's hand under your feet. The hold is the fist: of
 *     the hand's eleven cels only 1556 and 1562 carry a strike box, and
 *     `0x42857d` re-reads that box every frame and plants you at its centre.
 *   - **-7**, the same class out of its rect rather than under you, which is a
 *     knockdown and not a hold.
 *   - **-4**, TOWER's surge.
 *
 * See `src/codes.ts` for the census of who sends what and for the two codes
 * nothing sends.
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
  const hud = page.locator("#hud");

  // `textContent` strips the panel's own <b>, so every pattern below reads the
  // plain text — a half-optional tag in one of them cost an hour
  const say = async (): Promise<string> => (await hud.textContent()) ?? "";
  const at = async (): Promise<number> => Number(/· x (-?\d+),/.exec(await say())?.[1] ?? NaN);
  const go = async (level: number, x?: number, y?: number): Promise<void> => {
    await page.keyboard.up("ArrowRight").catch(() => {});
    await page.goto(
      `${BASE}/walk.html?level=${level}${x === undefined ? "" : `&x=${x}`}${y === undefined ? "" : `&y=${y}`}`,
    );
    await hud.filter({ hasText: /room \d+ of \d+/ }).waitFor({ timeout: 30_000 });
    await page.waitForTimeout(400);
    // ...and wait for the spawn to settle, which on a cold load is not a pause
    let last = "";
    for (let i = 0; i < 25; i++) {
      const now = /· x (-?\d+), y (-?\d+)/.exec(await say())?.[0] ?? "";
      if (now && now === last) return;
      last = now;
      await page.waitForTimeout(120);
    }
  };
  /** hold a key and watch the HUD until a pattern shows up, or give up */
  const until = async (re: RegExp, ms = 9000, key?: string): Promise<string | null> => {
    if (key) await page.keyboard.down(key);
    for (let i = 0; i < ms / 100; i++) {
      const m = re.exec(await say());
      if (m) {
        if (key) await page.keyboard.up(key);
        return m[0];
      }
      await page.waitForTimeout(100);
    }
    if (key) await page.keyboard.up(key);
    return null;
  };

  // 1. the hand under your feet carries -3, and only its CLOSED cel has a grip
  await go(9, 640);
  const grabbed = await until(/· code -3 grabbed|· HELD, gravity x0/, 12_000, "ArrowRight");
  if (!grabbed) fail(`GRAVE's hand at x794 sends -3 and nothing took hold: ${/· nearest hand[^·]*/.exec(await say())?.[0]}`);
  const t1 = await say();
  if (!/· HELD, gravity x0/.test(t1)) fail(`0x448ef4 sets the player's gravity to 0 for a grab; the HUD says ${/gravity[^·]*/.exec(t1)?.[0] ?? "nothing"}`);
  const handCel = /nearest hand underfoot \w+ cel (\d+)/.exec(t1)?.[1];
  if (handCel !== "1556") fail(`only 1556 carries a grip; it is holding on cel ${handCel}`);
  console.log(`ok    the hand's -3 takes hold, on the one cel of eleven that has a strike box`);

  // 2. ...and it is pinned to the grip rather than to where it was standing
  const held = await at();
  const handAt = Number(/nearest hand underfoot \w+ cel \d+ at x (\d+)/.exec(t1)?.[1] ?? NaN);
  if (!Number.isFinite(held) || Math.abs(held - handAt) > 40)
    fail(`the grip is the centre of the fist's box; the player is at ${held} and the hand at ${handAt}`);
  console.log(`ok    and plants the player at the centre of that box — x ${held} against the hand's ${handAt}`);

  // 3. the fist opens and that, and only that, is what lets go — `0x4285b8`
  const free = await until(/· nearest hand underfoot (sinking|down|up)/, 9000);
  if (!free) fail(`the hand never opened again`);
  await page.waitForTimeout(400);
  const t3 = await say();
  if (/· HELD/.test(t3)) fail(`the grip went and the hold did not: ${/· HELD[^·]*/.exec(t3)?.[0]}`);
  await page.keyboard.down("ArrowRight");
  await page.waitForTimeout(1500);
  await page.keyboard.up("ArrowRight");
  if (Math.abs((await at()) - held) < 20) fail(`released and still pinned at x ${await at()}`);
  console.log(`ok    the fist opening is what lets go, and the player walks out of it`);

  // 4. the SAME class out of its rect carries -7, which is a knockdown
  // ...and it comes up at a RANDOM x across its own rect (`0x420d4b`), so this
  // stands in the middle of one and waits for a roll that lands on the player
  await go(9, 4500);
  const seven = await until(/· code -7 downBack/, 30_000);
  if (!seven) fail(`GRAVE's param-1 hands send -7 (0x420e3b); never saw one land`);
  if (/· HELD/.test(await say())) fail(`-7 is 0x448d24 — a knockdown, and it takes hold of nothing`);
  console.log(`ok    the hand that comes up anywhere sends -7 instead, and holds nothing`);

  // 5. TOWER's surge, and -4 is the one reaction with two animations in it
  await go(12, 17967, 15100);
  const four = await until(/· code -4 shocked/, 9000);
  if (!four) fail(`TOWER's initsurge carries -4 (0x426a90); the HUD says ${/· code[^·]*/.exec(await say())?.[0] ?? "nothing"}`);
  console.log(`ok    and the surge's -4 shocks you, out of 0x476758 tag 3`);

  // 6. none of it is damage, and the switch has nothing to do with it
  const t6 = await say();
  if (!/damage off/.test(t6)) fail(`this ran with the damage switch on; the point is that it does not matter`);
  const hp = /(\d+)\/(\d+)hp/.exec(t6);
  if (hp && hp[1] !== hp[2]) fail(`a code took health: ${hp[0]}`);
  console.log(`ok    with damage off throughout — a code is a message, and no row of the table spends health`);

  // 7. ...and BARREL's claw, which is the same -3 out of a different class.
  //    `0x41734a` sends it diving off the tracker's band table (180, 140, 100),
  //    the dive is an ordinary hundred, and the CLAMP that follows a connected
  //    dive is what carries the code — `0x417485`.
  await go(14, 8200);
  const dived = await until(/· claw dive/, 9000);
  if (!dived) fail(`the claw reaches at 140px; it never dived: ${/claw \w+[^·]*/.exec(await say())?.[0] ?? "no claw"}`);
  // the clamp is ten frames and the grab inside it shorter still, so this waits
  // for the HOLD rather than for the pose and reads them in the same sample
  let t7 = "";
  for (let i = 0; i < 140; i++) {
    t7 = await say();
    if (/· HELD/.test(t7) && /claw clamp/.test(t7)) break;
    t7 = "";
    await page.waitForTimeout(60);
  }
  if (!t7) fail(`a dive that connects clamps (0x417448) and the clamp takes hold; never saw both`);
  if (!/claw clamp cel 24(56|59)/.test(t7))
    fail(`only 2456..2459 carry a grip; it is holding on ${/claw \w+ cel \d+/.exec(t7)?.[0]}`);
  console.log(`ok    and BARREL's claw dives, clamps on its own 2456..2459 and holds you with the same -3`);

  console.log(`\nPASS  the blow codes are carried: -3 holds you by the art, -7 floors you, -4 shocks you`);
  await browser.close();
};

void main();
