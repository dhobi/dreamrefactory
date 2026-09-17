/**
 * The BLASTER — chapter four's gun, and the only weapon in the game that is
 * aimed at one creature.
 *
 *   npm run dev -w skullcracker                    # in one terminal
 *   npm run test:browser:blaster -w skullcracker   # in another
 *
 * Its bolt carries the CODE -1 rather than a number (`0x413bf9`, through the
 * variant map at `0x413c48`), and a strength below 1 is not a blow: every
 * ordinary handler in the game throws it away at `0x4199b9`. Boggs' handler is
 * the one that translates it — `0x41bc71` rewrites -1 as a hundred — so the gun
 * in the last room of the game does a full blow to exactly one thing and
 * nothing at all to everything else.
 *
 * And a bolt alone still cannot kill it, for the game's own reason: the two
 * flags at `0x46e080` and `0x46e084` SHIP as 1 and are cleared only by emptying
 * the two breakable halves of the MACHINERY (`0x41b611`, `0x41b75d`), so until
 * that is done the thirty a frame puts every hundred straight back. What this
 * suite measures is that one bolt lands and that the healing undoes it; the
 * machine, and the kill it buys, are `tests/browser/vat.ts`.
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
  const num = async (re: RegExp): Promise<number> => Number(re.exec(await say())?.[1] ?? NaN);

  const go = async (level: number, x: number): Promise<void> => {
    await page.goto(`${BASE}/walk.html?level=${level}&x=${x}`);
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
  /** S in front of the gun, which is the whole of the take — `0x4298a1` */
  const arm = async (): Promise<void> => {
    await page.keyboard.down("ArrowDown");
    await page.waitForTimeout(900);
    await page.keyboard.up("ArrowDown");
    await page.waitForTimeout(600);
  };

  // 1. VAT is where the one statblaster is, and taking it arms you
  await go(16, 5760);
  if (!/· no blaster 0\/160/.test(await say())) fail(`VAT should open with the blaster named and empty: ${/· (no|holding)[^·]*/.exec(await say())?.[0]}`);
  await arm();
  const full = await num(/boggs \w+ cel \d+ at x\d+, y\d+, (\d+)\/4000hp/);
  if (full !== 4000) fail(`Boggs opens on 0x40e300(0xfa0); the HUD says ${full}`);
  const rounds = await num(/holding blaster (\d+)\/160/);
  if (!(rounds > 0)) fail(`taking the statblaster gives 0x28 rounds; the panel says ${/· (no|holding)[^·]*/.exec(await say())?.[0]}`);
  console.log(`ok    VAT's one statblaster is taken with S and loads ${rounds} of 160`);

  // 2. P spends one and puts a bolt in the air — `0x412b5b`
  // `0x42cd53` waits for the wind-up TAG to end before it calls the weapon's
  // own fire function, so the round is not spent on the frame P goes down
  await page.keyboard.press("p");
  await page.waitForTimeout(500);
  const after = await num(/holding blaster (\d+)\/160/);
  if (after !== rounds - 1) fail(`a shot spends one round; went ${rounds} -> ${after}`);
  console.log(`ok    and P spends one of them`);

  // 3. ...which lands a hundred on Boggs, because -1 is translated there
  let lowest = 4000;
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press("p");
    await page.waitForTimeout(140);
    const hp = await num(/boggs \w+ cel \d+ at x\d+, y\d+, (\d+)\/4000hp/);
    if (Number.isFinite(hp)) lowest = Math.min(lowest, hp);
  }
  if (lowest >= 4000) fail(`the bolt should take 100 off Boggs (0x41bc71); it never dropped below ${lowest}`);
  console.log(`ok    and a bolt lands on Boggs — 4000 down to ${lowest} at its lowest`);

  // 4. ...and the thirty a frame puts it straight back, which is the fight
  await page.waitForTimeout(1200);
  const healed = await num(/boggs \w+ cel \d+ at x\d+, y\d+, (\d+)\/4000hp/);
  if (healed !== 4000) fail(`0x41be7c heals 30 a frame to the 4000 cap; it sat at ${healed}`);
  console.log(`ok    ...and 0x41be7c puts every point of it back, because both flags ship set — the machine is what stops it`);

  // 5. the same bolt does NOTHING to an ordinary creature. `[` walks back
  //    through chapter four, which keeps the weapon (`0x4511f0` runs per
  //    CHAPTER), so this is the gun taken in VAT fired at one of MAZE's cops
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press("[");
    await page.waitForTimeout(1500);
  }
  if (!/level 13 · maze/.test(await say())) fail(`three [ from VAT is MAZE; the HUD says ${/level \d+ · \w+/.exec(await say())?.[0]}`);
  if (!/holding blaster/.test(await say())) fail(`the weapon is the chapter's, not the level's; MAZE says ${/· (no|holding)[^·]*/.exec(await say())?.[0]}`);
  const before = /nearest initcop (\d+)\/(\d+)hp/.exec(await say());
  if (!before) fail(`no cop in MAZE's first room to shoot at`);
  for (let i = 0; i < 25; i++) {
    await page.keyboard.press("p");
    await page.waitForTimeout(140);
  }
  const now = /nearest initcop (\d+)\/(\d+)hp/.exec(await say());
  if (now && Number(now[1]) < Number(before![1]))
    fail(`a strength below 1 is not a blow (0x4199b9); the cop went ${before![1]} -> ${now[1]}`);
  console.log(`ok    and twenty-five bolts take nothing off a cop — ${before![1]}/${before![2]}hp still`);

  console.log(`\nPASS  the blaster fires, its bolt is a code, and only Boggs reads it`);
  await browser.close();
};

void main();
