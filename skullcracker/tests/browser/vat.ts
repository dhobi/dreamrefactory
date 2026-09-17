/**
 * VAT — level sixteen, the last of them, and the only level whose census is
 * nothing at all.
 *
 *   npm run dev -w skullcracker                # in one terminal
 *   npm run test:browser:vat -w skullcracker   # in another
 *
 * Its forty-one records are seven showers, two balls, a set of teeth, chapter
 * four's own gun — the `statblaster`, which is placed in this level and in no
 * other — and BOGGS, which is four objects: `initboggsbody`, `initboggshead`,
 * `initbgclawarm` and `initbgmachinery`, the last of which stands up eight more.
 *
 * Two numbers make it the last thing in the game:
 *
 * ```
 *   41be84  0x40e300(0xfa0)                 ; four thousand health
 *   41be68  cmp [0x46e080] / [0x46e084]     ; while EITHER flag is set...
 *   41be7c  add word ptr [0x4a50e8], 0x1e   ; ...thirty a frame back
 * ```
 *
 * Four thousand is three times TOWER's bishop and more than three times the
 * player. What is here is the body on its idle; the rest of the machine, and the
 * −1 that would let you hurt it, are not.
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

  const say = async (): Promise<string> => (await hud.textContent()) ?? "";
  const go = async (q: string): Promise<void> => {
    await page.goto(`${BASE}/walk.html?level=16${q}`);
    await hud.filter({ hasText: /room \d+ of \d+/ }).waitFor({ timeout: 30_000 });
    await page.waitForTimeout(400);
    let last = "";
    for (let i = 0; i < 25; i++) {
      const now = /· x (-?\d+), y (-?\d+)/.exec(await say())?.[0] ?? "";
      if (now && now === last) return;
      last = now;
      await page.waitForTimeout(120);
    }
  };

  // 1. two regions, nothing that counts, and no clock
  await go("");
  if (!/room \d+ of 2/.test(await say())) fail(`VAT has two regions; the HUD says ${/room[^·]*/.exec(await say())?.[0]}`);
  if (!/of 0\)/.test(await say())) fail(`nothing in VAT counts towards a census; the HUD says ${/kill[^·)]*/.exec(await say())?.[0]}`);
  const clock = Number(/clock (\d+)/.exec(await say())?.[1] ?? 0);
  if (clock < 31000) fail(`VAT carries no timer record, so no limit; the panel says ${clock}`);
  console.log(`ok    VAT is two regions, a census of nothing, and no clock`);

  // 2. its furniture, all of it one cel apiece
  if (!/shower cel 4060/.test(await say())) fail(`0x46cc68 tag 0 is one record, 4060; the HUD says ${/shower[^·]*/.exec(await say())?.[0]}`);
  if (!/ball cel 4310/.test(await say())) fail(`0x41a73d files 0x10d6`);
  if (!/teeth cel 3516/.test(await say())) fail(`0x418c9d files 0xdbc`);
  console.log(`ok    and its showers, balls and teeth stand on their own single cels`);

  // 3. BOGGS, in the other region, with four thousand health
  await go("&x=6100");
  if (!/room 1 of 2 \(chamber2/.test(await say())) fail(`Boggs stands in the region named chamber2; the HUD says ${/room[^·]*/.exec(await say())?.[0]}`);
  if (!/boggs cel 59\d\d at x6321, y2094, 4000\/4000hp, \+30 a frame/.test(await say()))
    fail(`0x41be84 gives it 0x40e300(0xfa0); the HUD says ${/boggs[^·]*/.exec(await say())?.[0]}`);
  const cels = new Set<number>();
  for (let i = 0; i < 24; i++) {
    await page.waitForTimeout(80);
    const m = /boggs cel (\d+)/.exec(await say());
    if (m) cels.add(Number(m[1]));
  }
  if (cels.size < 3) fail(`0x46e6b0 is 5988, 5987, 5986, 5987 at three frames each; it showed ${cels.size}`);
  if ([...cels].some((c) => c < 5986 || c > 5988)) fail(`its idle is 5986..5988; saw ${[...cels].join(" ")}`);
  console.log(`ok    Boggs stands in chamber2 on ${cels.size} of its own 5986..5988, at four thousand health`);

  // 4. and chapter four's gun, which is in this level and in no other. Every
  //    other level of the chapter places `statblasterpack` and nothing to put
  //    them in; `0x416440` is what arms you, and it is here.
  await go("&x=5760");
  if (!/nearest statblaster at x 5815/.test(await say())) fail(`the game's one statblaster stands at x5815; the HUD says ${/· \d+ guns[^·]*/.exec(await say())?.[0]}`);
  if (!/IN REACH/.test(await say())) fail(`and it should be in reach from x5760`);
  await page.keyboard.down("s");
  await page.waitForTimeout(900);
  await page.keyboard.up("s");
  await page.waitForTimeout(300);
  if (!/holding blaster 41\/160/.test(await say()))
    fail(`0x416440 gives 40 and 0x45eed0 one more, against 0x412a24's 0xa0; the panel says ${/· (holding|no) \w+ \d+\/\d+/.exec(await say())?.[0]}`);
  console.log(`ok    and the game's one statblaster is here, and it arms you with 41 of 160`);

  /**
   * ...and the END. `0x41293d` is the last scene of chapter four's runner: with
   * the outer state still 6 it plays `credits.mov` and drops the chapter loop,
   * which hands the game back to its title menu.
   *
   * `credits.mov` is also the menu's own option 6 (`0x4030f7`), so the file
   * being in the rip was never evidence of an ending by itself — `0x41293d` is.
   */
  await go("&x=5760");
  await page.keyboard.down("ArrowRight");
  let reel = "";
  for (let i = 0; i < 120; i++) {
    const t = await say();
    if (/press ESC to skip/.test(t)) { reel = t; break; }
    await page.waitForTimeout(150);
  }
  await page.keyboard.up("ArrowRight");
  if (!reel) fail(`walking into VAT's goal should end the game; nothing played`);
  if (!/^credits\.mov/.test(reel)) fail(`the sixteenth level ends on credits.mov; it played ${reel.slice(0, 40)}`);
  console.log(`ok    and walking into its goal ends the game — ${/credits\.mov[^—]*/.exec(reel)?.[0].trim()}`);

  // ...and then the front again, which is where 0x4032a2 sends it
  await page.keyboard.press("Escape");
  await hud.filter({ hasText: /room \d+ of \d+/ }).waitFor({ timeout: 30_000 });
  await page.waitForTimeout(600);
  if (!/level 1 · streets/.test(await say()))
    fail(`the credits hand the game back to the front; the HUD says ${/level \d+ · \w+/.exec(await say())?.[0]}`);
  console.log(`ok    ...and hands you back to the front, which is where 0x4032a2 sends it`);

  await browser.close();
  console.log("PASS  VAT stands, its furniture is placed, and Boggs is on the screen");
};

void main().catch((e) => fail(String(e)));
