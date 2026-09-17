/**
 * The things you walk over — `stat*`, in every level and until now in none.
 *
 *   npm run dev -w skullcracker                    # in one terminal
 *   npm run test:browser:pickups -w skullcracker   # in another
 *
 * A hundred and forty records across the sixteen levels, all placed by one
 * creator, all drawn from `PLAYER.SBK` rather than the level's book, and all
 * collected by walking into them. No button, no facing, no range band.
 *
 * What the file says, and what this checks:
 *
 *   - **one creator, nine codes.** Each chapter's init hands `0x45b160` a
 *     negative for each name, and `0x45b19a` dispatches on `code + 9`.
 *   - **`statscoreup` is one name and three pickups**, told apart by the
 *     RECORD's own `param` at `0x451420`: −6, −5 and −4, worth 2000, 5000 and
 *     10000.
 *   - **the reach is the record's rect**, which is what `0x45b2ca` hands
 *     `0x434140` — not the art, which is only what is drawn.
 *   - **the effects are `0x42827a`'s table**: four hundred health, one life,
 *     the three scores, and eight hundred and fifty back on the clock.
 */
import { fail, finish, launch } from "./harness";

const BASE = process.env.BASE ?? "http://localhost:5178";

const main = async (): Promise<void> => {
  const browser = await launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on("pageerror", (e) => fail(`page threw: ${e.message}`));
  const hud = page.locator("#hud");

  const say = async (): Promise<string> => (await hud.textContent()) ?? "";
  const count = async (): Promise<number> => Number(/(\d+) pickups/.exec(await say())?.[1] ?? 0);
  const lives = async (): Promise<number> => Number(/(\d+) (?:life|lives)/.exec(await say())?.[1] ?? -1);
  const score = async (): Promise<number> => Number(/(\d+) points/.exec(await say())?.[1] ?? -1);
  /** stand exactly where a record is, which is what walking into it comes to */
  const stand = async (level: number, x: number, y: number, damage = false): Promise<void> => {
    await page.goto(`${BASE}/walk.html?level=${level}&x=${x}&y=${y}${damage ? "&damage=1" : ""}`);
    await hud.filter({ hasText: /room \d+ of \d+/ }).waitFor({ timeout: 30_000 });
    await page.waitForTimeout(600);
  };

  // 1. they are placed, and they are placed from the records
  await stand(1, 1900, 1223);
  const first = await count();
  if (first !== 6) fail(`STREETS' first room holds six of them; the HUD lists ${first}`);
  if (!/nearest \w+ -\d/.test(await say())) fail(`each should carry the code its chapter hands the creator`);
  console.log(`ok    STREETS' first room places ${first} of them, each with its own code`);

  // 2. ...and they are OUT OF REACH from the street. The first room's four sit
  //    at roof height, two hundred pixels over the top of a jump.
  await page.keyboard.down("w");
  for (let i = 0; i < 20; i++) {
    await page.waitForTimeout(150);
    await page.keyboard.press("j");
  }
  await page.keyboard.up("w");
  if ((await count()) !== first) fail(`jumping in the street should reach none of them; ${first} -> ${await count()}`);
  console.log(`ok    and twenty jumps from the street reach none of them — they are on the roofs`);

  /**
   * 3. the SECOND test — `0x40e680`, which is the art rather than the rect.
   *
   * `0x45b2ca` intersects the two rects and only then calls it, and it walks
   * that intersection looking for a row where both cels have an opaque span
   * (`0x4320c0`). STREETS' statlife is 100 wide and its record runs 3629..3729,
   * so standing at 3600 or 3760 overlaps the rect by a pixel or two and touches
   * none of the art — and the pickup has to survive that.
   */
  for (const x of [3600, 3760]) {
    await stand(1, x, 985);
    const both = /pickup rect (\w+) pixels (\w+)/.exec(await say());
    if (!both) fail(`no pickup test readout at x ${x}: ${(await say()).slice(0, 140)}`);
    if (both![1] !== "yes") fail(`x ${x} should graze the statlife's rect; it says rect ${both![1]}`);
    if (both![2] !== "no") fail(`...and touch none of its art; it says pixels ${both![2]}`);
    if ((await lives()) !== 3) fail(`a rect graze must not take it; the panel shows ${await lives()} lives`);
  }
  console.log(`ok    a rect that grazes by a pixel takes nothing — 0x40e680 is the art, not the box`);

  // 3. `statlife`: one life, and walking into it is the whole of it
  await stand(1, 3679, 985);
  if ((await lives()) !== 4) fail(`0x428421 adds one life; the panel shows ${await lives()}`);
  if ((await count()) !== first - 1) fail(`and the one taken should be gone; ${first} -> ${await count()}`);
  console.log(`ok    standing in a statlife takes it and the panel shows ${await lives()} lives`);

  // 4. `stathealth`: four hundred, and it cannot go over what you started with
  await stand(1, 6918, 945, true);
  const health = /damage ON (\d+)\/(\d+)hp/.exec(await say());
  if (!health) fail(`?damage=1 should arm the bar: ${(await say()).slice(0, 140)}`);
  if (health![1] !== health![2]) fail(`a full one cannot be topped up past its own max; ${health![1]}/${health![2]}`);
  console.log(`ok    a stathealth on a full bar leaves it at ${health![1]}/${health![2]} — 0x402b20 clamps`);

  // 5. `statscoreup` is three pickups wearing one name, and the param says which
  await stand(1, 1715, 1071);
  const two = await score();
  if (two !== 2000) fail(`param 0 is -6, and 0x428392 pays 0x7d0; the score reads ${two}`);
  await stand(1, 4885, 2597);
  const five = await score();
  if (five !== 5000) fail(`param 1 is -5, and 0x4283bd pays 0x1388; the score reads ${five}`);
  await stand(1, 5916, 2430);
  const ten = await score();
  if (ten !== 10000) fail(`param 2 is -4, and 0x4283e8 pays 0x2710; the score reads ${ten}`);
  console.log(`ok    its three scoreups pay ${two}, ${five} and ${ten}, by their records' own params`);

  // 6. `stattimer`: eight hundred and fifty engine frames back
  await stand(1, 1900, 1223);
  const before = Number(/clock (\d+)/.exec(await say())?.[1] ?? -1);
  await stand(1, 7187, 931);
  const after = Number(/clock (\d+)/.exec(await say())?.[1] ?? -1);
  if (before < 0 || after < 0) fail(`the HUD should carry the clock: ${(await say()).slice(0, 160)}`);
  if (after - before < 800) fail(`0x42834f gives back 850 frames; the clock went ${before} -> ${after}`);
  console.log(`ok    a stattimer puts ${after - before} frames back on the clock`);

  // 7. and they are in every level, not only the first
  for (const [level, want] of [[3, 10], [5, 2], [6, 5]] as const) {
    await page.goto(`${BASE}/walk.html?level=${level}`);
    await hud.filter({ hasText: /room \d+ of \d+/ }).waitFor({ timeout: 30_000 });
    await page.waitForTimeout(600);
    if ((await count()) !== want) fail(`level ${level}'s first room places ${want}; the HUD lists ${await count()}`);
  }
  console.log(`ok    and every level's own records place their own, off one table`);

  await finish(browser);
  console.log("PASS  the stat pickups are placed, drawn from the shared book, and taken by walking into them");
};

await main();
