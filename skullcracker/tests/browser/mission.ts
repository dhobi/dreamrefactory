/**
 * A level ends the way `SC.EXE` ends one: the quota, then the goal, then a film.
 *
 *   npm run dev -w skullcracker                    # in one terminal
 *   npm run test:browser:mission -w skullcracker   # in another
 *
 * `skullcracker/src/mission.ts` is where the numbers and their addresses are.
 * What this asserts is the shape of the rule rather than the numbers themselves:
 *
 *   - the quota is a SHARE of the level's own population, and until it is met the
 *     goal rect does nothing at all, because the thing you walk to is not there;
 *   - a level whose share is already satisfied gets its goal OBJECT — the flying
 *     television of `0x410170` — and walking to that plays the next mission's
 *     briefing film and loads the next level;
 *   - a level's order is the corrected one: level 3 is `woods`, not `sewer`;
 *   - when the mission clock runs out, one of the four TIME films plays and the
 *     level starts again;
 *   - and falling out of the world — which CITY, whose ground is 2919px below its
 *     own room rect, is the reason to have at all — costs a life, plays one of
 *     the seven KILL films, and puts the player back at the level's spawn.
 *
 * `?clock=` exists for the last of those: the dial is eight minutes long and a
 * test cannot wait for it.
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
  const say = async (): Promise<string> => ((await hud.textContent()) ?? "").replace(/ · every pixel.*/, "");
  const load = async (query: string): Promise<string> => {
    await page.goto(`${BASE}/walk.html?${query}`);
    await hud.filter({ hasText: /room \d+ of \d+/ }).waitFor({ timeout: 30_000 });
    await page.waitForTimeout(300);
    return say();
  };
  /** wait for the HUD to satisfy a test, or say what it said instead */
  const until = async (what: RegExp, tries = 40, ms = 400): Promise<string> => {
    for (let i = 0; i < tries; i++) {
      const t = await say();
      if (what.test(t)) return t;
      await page.waitForTimeout(ms);
    }
    return fail(`waited for ${what} and the HUD said: ${(await say()).slice(0, 160)}`);
  };

  // 1. STREETS: 11 things that enrol in its census, and 75% of them wanted dead.
  //    Eleven and not twenty: `0x42f870(obj, 1)` is what enrols a thing, and of
  //    this chapter's classes only the four were-punks call it — the nine rats,
  //    the two mailboxes and the hydrant are not part of anyone's quota.
  const one = await load("level=1");
  const quota = /quota (\d+) of (\d+) \(kill (\d+)% of (\d+)\)/.exec(one);
  if (!quota) fail(`level 1 reports no quota: ${one.slice(0, 160)}`);
  const [, left, want, share, census] = quota!;
  if (share !== "75") fail(`STREETS asks for ${share}% — src/mission.ts reads 0.75 at 0x46a188`);
  if (Number(want) !== Math.round((Number(census) * 75) / 100)) {
    fail(`${want} wanted of a census of ${census} is not 75% of it`);
  }
  if (left !== want) fail(`nothing has been killed yet and the quota already reads ${left} of ${want}`);
  if (Number(census) !== 11) {
    fail(`STREETS' census is ${census}; the eight werea and three wereb records are the eleven that enrol`);
  }
  if (!new RegExp(`goal \\d+px \\w+, y \\d+ — ${left} still to kill`).test(one)) {
    fail(`STREETS' goal should still be nothing but a rect with ${left} to kill: ${one.slice(0, 200)}`);
  }
  console.log(`ok    STREETS wants ${want} of ${census} dead (75%), and nothing stands at its goal yet`);

  // 2. the corrected order: the third level is the woods
  const three = await load("level=3");
  if (!/level 3 · woods/.test(three)) fail(`level 3 is "${three.slice(0, 40)}" — LEVEL_ORDER has woods third`);
  console.log(`ok    level 3 is the woods (the theme numbers said sewer; 0x436b51 says otherwise)`);

  // 3. ARCADE: none of the classes this page draws stand in it, so its share is
  //    already met and its goal is open. Walking out of the rect and back in is
  //    the touch — and it must be out and back, since standing where the goal
  //    will be is not touching a thing that is not there yet.
  await load("level=8");
  // its spawn point falls inside its own goal rect, so the craft arrives over the
  // player's head and waits for them to walk out and back
  const eight = await until(/at the goal — the television is overhead/, 20, 300);
  console.log(`ok    ARCADE has nothing this page can kill, so its television flies in at once`);
  if (/screen is coming down/.test(eight)) fail(`ARCADE's goal opened without the player walking to it`);

  await page.keyboard.down("ArrowLeft");
  await page.waitForTimeout(2600);
  await page.keyboard.up("ArrowLeft");
  await page.keyboard.down("ArrowRight");
  const film = await until(/segment \d+\/\d+/);
  await page.keyboard.up("ArrowRight");
  if (!/chp09\.mov/.test(film)) fail(`the goal played "${film.slice(0, 60)}" — the next mission's film is chp09.mov`);
  console.log(`ok    touching it plays the next briefing: ${film.split(" ·")[0]}`);

  for (let i = 0; i < 12 && /segment/.test(await say()); i++) {
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
  }
  const nine = await until(/room \d+ of \d+/);
  if (!/level 9 · grave/.test(nine)) fail(`after ARCADE the page is at "${nine.slice(0, 40)}" — level 9 is grave`);
  console.log(`ok    and the level after it is the ninth, grave`);

  // 4. the clock: 40 frames of an 8-minute dial, then one of the four films
  await load("level=1&clock=40");
  const out = await until(/segment \d+\/\d+/);
  if (!/time[1-4]\.mov/.test(out)) fail(`the clock ran out and played "${out.slice(0, 60)}" — TIME1..4 are the four`);
  console.log(`ok    the clock runs out into ${out.split(" ·")[0]}, one of the four 0x434540(4) picks from`);
  for (let i = 0; i < 12 && /segment/.test(await say()); i++) {
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
  }
  const again = await until(/room \d+ of \d+/);
  if (!/level 1 · streets/.test(again)) fail(`after the TIME film the page is at "${again.slice(0, 40)}"`);
  console.log(`ok    and the level starts again`);

  // 5. CITY has no floor — its ground is 2919 below its own room rect, which is
  //    the fall. Running east off the ledge used to land the player on it and
  //    let them walk in the void; now it is a death, a life, and the level again.
  const two = await load("level=2");
  if (!/3 lives/.test(two)) fail(`CITY starts with something other than three lives: ${two.slice(0, 160)}`);
  await page.keyboard.down("w");
  await page.keyboard.down("ArrowRight");
  const death = await until(/segment \d+\/\d+/, 30, 400);
  await page.keyboard.up("ArrowRight");
  await page.keyboard.up("w");
  if (!/kill[1-7]\.mov/.test(death)) fail(`falling out of CITY played "${death.slice(0, 60)}" — KILL1..7 are the seven`);
  console.log(`ok    running off CITY's ledge is fatal: ${death.split(" ·")[0]}`);
  for (let i = 0; i < 12 && /segment/.test(await say()); i++) {
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
  }
  const back = await until(/room \d+ of \d+/);
  if (!/level 2 · city/.test(back)) fail(`after the fall the page is at "${back.slice(0, 40)}"`);
  if (!/2 lives/.test(back)) fail(`the fall cost no life: ${back.slice(0, 200)}`);
  if (!/y 3925/.test(back)) fail(`the respawn is not CITY's own spawn point: ${back.slice(0, 200)}`);
  console.log(`ok    and it costs a life and puts them back where the level starts`);

  await browser.close();
  console.log(`PASS  the quota gates the goal, the goal ends the level, the clock and the void end it too`);
};

void main();
