/**
 * Do the level's own rooms hold, and how is a door taken?
 *
 *   npm run dev:skullcracker                  # in one terminal
 *   npm run test:browser:skullcracker:rooms   # in another
 *
 * The rooms and the door between them are read off STREETS.SBK — the street is
 * `newroom` param 3, the basement below it `newroom` param 1, and the `exitroom`
 * at x4522…4767 in the street carries param 1. `engine/tests/sbk.ts` asserts
 * that binding across all sixteen books; what it cannot assert is what happens
 * when a player reaches one, because that lives in the page.
 *
 * ## What went wrong twice, and is asserted here
 *
 * Two builds triggered a door by TOUCHING it. Plain contact bounced the player
 * between the two rooms for as long as an arrow was held. Contact plus the
 * direction the door's stored point implies stopped the bouncing and trapped the
 * player in the basement instead — and that one shipped for an afternoon before
 * someone walked right from the spawn and could not get back out.
 *
 * The file says why neither can be right. STREETS' street door stands between
 * the spawn at x1840 and the goal at x7731, so walking right always enters it;
 * and the arrival point beside it is x4775, **eight pixels** past its right edge,
 * against a player about a hundred pixels wide. You come out of every door still
 * standing in it. So the first assertion here is the negative one: walking
 * through a door does nothing at all.
 */
import { chromium } from "playwright";

const BASE = process.env.BASE ?? "http://localhost:5178";
/** short of the street door at x4522 */
const START = 4300;

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

  const text = async (): Promise<string> => (await hud.textContent()) ?? "";
  const room = async (): Promise<string> => {
    const m = /room \d+ of \d+ \(([^)]+)\)/.exec(await text());
    return m ? m[1] : fail(`no room in the HUD`);
  };
  const coord = async (which: "x" | "y"): Promise<number> => {
    const m = new RegExp(`${which} (-?\\d+)`).exec(await text());
    return m ? Number(m[1]) : fail(`no ${which} in the HUD`);
  };
  /** hold a key until x passes `to`, or give up */
  const walkTo = async (key: string, to: number, west: boolean): Promise<void> => {
    await page.keyboard.down(key);
    for (let i = 0; i < 120; i++) {
      const x = await coord("x");
      if (west ? x <= to : x >= to) break;
      await page.waitForTimeout(60);
    }
    await page.keyboard.up(key);
  };
  const tapUp = async (): Promise<void> => {
    await page.keyboard.down("ArrowUp");
    await page.waitForTimeout(90);
    await page.keyboard.up("ArrowUp");
    await page.waitForTimeout(250);
  };

  if ((await room()) !== "newroom/p3") fail(`expected to start in the street, got ${await room()}`);
  console.log(`ok    starts in the street at x ${await coord("x")}`);

  // 1. walking through the door must do NOTHING — this is the trap regression
  await walkTo("ArrowRight", 5100, false);
  if ((await room()) !== "newroom/p3") fail(`walking through the door teleported to ${await room()}`);
  if ((await coord("x")) < 5000) fail(`the walk east stopped at x ${await coord("x")}, short of the door's far side`);
  console.log(`ok    walked straight through the door to x ${await coord("x")}, still in the street`);

  // 2. and the HUD says what would work, when the player is in the doorway
  await walkTo("ArrowLeft", 4650, true);
  if (!/press ↑ for the door/.test(await text())) fail(`standing in the doorway, the HUD does not offer it`);
  console.log(`ok    standing in the doorway at x ${await coord("x")}, the HUD offers it`);

  // 3. pressing up takes it, and lands the player on the basement's own floor
  await tapUp();
  if ((await room()) !== "newroom/p1") fail(`pressing up gave ${await room()}, wanted the basement`);
  const [bx, by] = [await coord("x"), await coord("y")];
  // the basement's door back states x4395, and the floor under it is y2785 —
  // exact, because the arrival takes its x from the file and its y from the
  // floor. An arrival that is merely "somewhere in the basement" would mean the
  // keypress that opened the door also jumped, which is what it used to do.
  if (bx !== 4395) fail(`arrived at x ${bx}, not beside the door back at 4395`);
  if (by !== 2785) fail(`arrived at y ${by}, not standing on the basement floor at 2785`);
  console.log(`ok    pressing up went to the basement, x ${bx}, y ${by}`);

  // 4. and holding up does not immediately bounce back out again
  await page.keyboard.down("ArrowUp");
  await page.waitForTimeout(1200);
  await page.keyboard.up("ArrowUp");
  if ((await room()) !== "newroom/p1") fail(`holding up bounced back to ${await room()}`);
  console.log(`ok    holding up does not bounce back out`);

  // 5. the way back, which is the door in the basement
  await walkTo("ArrowRight", 4600, false);
  await tapUp();
  if ((await room()) !== "newroom/p3") fail(`the door back gave ${await room()}, wanted the street`);
  const upY = await coord("y");
  // x4775 is the street door's own point, y1363 the pavement under it
  if ((await coord("x")) !== 4775) fail(`came back to x ${await coord("x")}, not the door's point 4775`);
  if (upY !== 1363) fail(`came back at y ${upY}, not standing on the pavement at 1363`);
  console.log(`ok    and back into the street at x ${await coord("x")}, y ${upY}`);

  await browser.close();
  console.log("PASS  STREETS' two rooms, and a door you have to mean");
};

void main().catch((e) => fail(String(e)));
