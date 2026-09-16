/**
 * THE GUNS — the other pickup creator, and the player it turns you into.
 *
 *   npm run dev -w skullcracker                 # in one terminal
 *   npm run test:browser:guns -w skullcracker   # in another
 *
 * `0x45b160` takes the negative codes and you collect those by walking over
 * them. `0x45af60` takes the positive ones and nothing about it is the same:
 *
 *   - **it has a button.** `0x4298a1` calls the reach handler only while S is
 *     held, and `0x42f081` ducks instead when the probe comes back empty — so
 *     the same key does both, and which one depends on what is in front of you.
 *   - **it has a facing.** `0x42f017` shifts the player's own point 35 pixels the
 *     way they are looking and `0x45ae90` tests THAT against a band of `x ± 55`
 *     and a lift of 150. Standing on one is not enough.
 *   - **taking one changes the player.** `0x45eed0` sets `0x479438` and the
 *     pickup case installs the weapon's own script, whose kind sends the whole
 *     state machine somewhere else — `0x42cb80` rather than `0x429690`. The
 *     idle, the walk, the run, the jump and the duck are all different cels.
 *
 * And the chapter, not the level, is the unit: `0x4511f0` and its three siblings
 * run once each and name the weapon you are looking for. Which is why SEWER
 * places two `statflare` and no gun — you are meant to still have SERVICE's.
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
  const at = async (): Promise<number> => Number(/· x (-?\d+), y/.exec(await say())?.[1] ?? NaN);
  const cel = async (): Promise<number> => Number(/· cel (\d+)/.exec(await say())?.[1] ?? NaN);
  const held = async (): Promise<string> => /· (holding|no) (\w+) (\d+)\/(\d+)/.exec(await say())?.[0] ?? "";
  const rounds = async (): Promise<number> => Number(/· (?:holding|no) \w+ (\d+)\//.exec(await say())?.[1] ?? NaN);
  const armed = async (): Promise<boolean> => /· holding /.test(await say());
  const go = async (level: number, x?: number): Promise<void> => {
    await page.goto(`${BASE}/walk.html?level=${level}${x === undefined ? "" : `&x=${x}`}`);
    await hud.filter({ hasText: /room \d+ of \d+/ }).waitFor({ timeout: 30_000 });
    await page.waitForTimeout(700);
  };
  const take = async (): Promise<void> => {
    await page.keyboard.down("s");
    await page.waitForTimeout(900);
    await page.keyboard.up("s");
    await page.waitForTimeout(250);
  };
  /** every cel the player showed while those keys were held */
  const showed = async (ms: number, keys: string[]): Promise<number[]> => {
    for (const k of keys) await page.keyboard.down(k);
    const seen = new Set<number>();
    for (let i = 0; i < ms / 60; i++) {
      await page.waitForTimeout(60);
      seen.add(await cel());
    }
    for (const k of keys) await page.keyboard.up(k);
    await page.waitForTimeout(200);
    return [...seen].filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  };

  // 1. the chapter names the weapon before you have found anything. Four entry
  //    functions, four chapters, and the eight levels here are two of them.
  for (const [level, want] of [
    [1, "flamer"],
    [2, "flamer"],
    [3, "flamer"],
    [4, "flamer"],
    [5, "flaregun"],
    [6, "flaregun"],
    [7, "flaregun"],
    [8, "flaregun"],
  ] as const) {
    await go(level);
    const line = await held();
    if (!line.startsWith(`· no ${want} 0/`)) fail(`level ${level}'s chapter names ${want} and arms nothing; the panel says "${line}"`);
  }
  console.log(`ok    the four chapter inits name one weapon each, and none of them arms you`);

  // 2. SERVICE stands up four of them, and walking over one does nothing —
  //    there is no rect test in `0x45ae90` at all, only the band and the button
  await go(6, 600);
  if (!/· 4 guns · nearest statflare at x 687/.test(await say())) fail(`SERVICE's first room places four; the HUD says ${/· \d+ guns[^·]*/.exec(await say())?.[0]}`);
  await page.keyboard.down("ArrowRight");
  for (let i = 0; i < 40; i++) {
    await page.waitForTimeout(80);
    if ((await at()) > 760) break;
  }
  await page.keyboard.up("ArrowRight");
  await page.waitForTimeout(300);
  if ((await rounds()) !== 0) fail(`walking over a statflare should not take it; the panel says ${await held()}`);
  if (!/· 4 guns/.test(await say())) fail(`and all four should still be standing: ${/· \d+ guns[^·]*/.exec(await say())?.[0]}`);
  console.log(`ok    four stand in SERVICE's first room and walking straight over one takes nothing`);

  // 3. ...but S does, and the band is the creator's own `x ± 55` against a
  //    point 35 pixels ahead. x480 is 172 short of the near edge of the flare
  //    at x687 and nothing happens there; x614 is inside it and it goes.
  await go(6, 480);
  if (/IN REACH/.test(await say())) fail(`x480 is well outside the x632..742 band; the HUD says it is in reach`);
  await take();
  if ((await rounds()) !== 0) fail(`S with nothing in the band is the duck, not a take: ${await held()}`);
  await go(6, 614);
  if (!/IN REACH/.test(await say())) fail(`x614's probe lands at 649, inside the flare's own band; the HUD says it is not`);
  await take();
  if ((await rounds()) !== 4) fail(`0x43be30 gives four flares; the panel says ${await held()}`);
  if (await armed()) fail(`a statflare is ammunition — 0x4295fc's byte for code 8 is 6, the case that goes back to the fists`);
  if (/· \d+ guns · nearest statflare at x 687/.test(await say())) fail(`the one that was taken should be gone`);
  console.log(`ok    S facing one takes it: four flares, and still empty-handed`);

  // 4. the flare GUN is the thing that arms you — `0x4288d2` calls `0x45eed0`,
  //    which is the only place `0x479438` is ever set in play, and it comes with
  //    one round of its own
  await go(5, 8300);
  await take();
  if (!(await armed())) fail(`0x45eed0 arms you with the gun; the panel says ${await held()}`);
  if ((await rounds()) !== 1) fail(`and its own single round: ${await held()}`);
  if (!/holding flaregun 1\/16/.test(await say())) fail(`0x436cf4 gives the flare gun a magazine of 0x10: ${await held()}`);
  console.log(`ok    MALL's flare gun arms you, with one round against a maximum of 16`);

  // 5. and now you are a different player. `0x470a78` is a whole moveset and
  //    every state of it is in the 2700s — none of these cels exists in the
  //    unarmed scripts.
  const idle = await showed(600, []);
  if (idle.join() !== "2721") fail(`the armed idle is 0x470a78 tag 0, one cel 2721; saw ${idle.join(" ")}`);
  const walk = await showed(900, ["ArrowLeft"]);
  if (!walk.every((c) => c >= 2700 && c <= 2711)) fail(`the armed walk is tag 1, 2700..2711; saw ${walk.join(" ")}`);
  const run = await showed(900, ["ArrowLeft", "w"]);
  if (!run.every((c) => c >= 2760 && c <= 2771)) fail(`the armed run is tag 13, 2760..2771 at dx 180; saw ${run.join(" ")}`);
  const duck = await showed(600, ["s"]);
  if (duck.join() !== "2730") fail(`the armed duck is tag 4, one cel 2730; saw ${duck.join(" ")}`);
  const air = await showed(1200, ["j"]);
  if (!air.includes(2740) || !air.includes(2741)) fail(`the armed jump is tag 9, 2740 then 2741 carrying dy -420; saw ${air.join(" ")}`);
  console.log(`ok    and the armed player walks, runs, ducks and jumps in its own cels`);

  // 6. P fires, and it is P: none of the five armed state machines reads K at
  //    all. The round goes at the END of the wind-up (`0x42cd53`), and the shot
  //    pose is held while the thing is in the air.
  const fire = await showed(900, ["p"]);
  if (!fire.includes(2723)) fail(`the flare gun's shot pose is tag 3, cel 2723; saw ${fire.join(" ")}`);
  if ((await rounds()) !== 0) fail(`0x45ef00(1) takes one round a shot; the panel says ${await held()}`);
  await page.keyboard.press("p");
  await page.waitForTimeout(500);
  if (/\d+ flares/.test(await say())) fail(`0x436d43 refuses an empty magazine outright`);
  console.log(`ok    P spends the round and an empty one fires nothing`);

  // 7. what a flare does, which is 100 (`0x43ab2d`) through the same class
  //    handlers a fist goes through. A masked one is 40 and a knotted one 50,
  //    so one flare is one kill either way — and 220 + 80 is the pair.
  await go(5, 8300);
  await take();
  await page.keyboard.down("w");
  await page.keyboard.down("ArrowLeft");
  for (let i = 0; i < 200; i++) {
    await page.waitForTimeout(60);
    if ((await at()) <= 6740) break;
  }
  await page.keyboard.up("ArrowLeft");
  await page.keyboard.up("w");
  await page.waitForTimeout(250);
  await take(); // the flare at x6700: four more
  if ((await rounds()) !== 5) fail(`the gun's one and the flare's four: ${await held()}`);
  await page.keyboard.down("w");
  await page.keyboard.down("ArrowLeft");
  for (let i = 0; i < 200; i++) {
    await page.waitForTimeout(60);
    if ((await at()) <= 5990) break;
  }
  await page.keyboard.up("ArrowLeft");
  await page.keyboard.up("w");
  await page.waitForTimeout(250);
  for (let i = 0; i < 5; i++) {
    await page.keyboard.press("p");
    await page.waitForTimeout(800);
  }
  const points = Number(/(\d+) points/.exec(await say())?.[1] ?? 0);
  if (points < 220) fail(`a flare is 100 and a masked one is 40 — one shot, one kill; the score reads ${points}`);
  console.log(`ok    a flare is 100 and fells what it reaches, for ${points} points`);

  // 8. the flamer is the other chapter's, it holds 160, and it spends NOTHING:
  //    `0x44dae0` is the only one of the five fire functions with no call to
  //    `0x45ef00` in it at all. Its flame is a held stream whose blow is the
  //    code -9, which this port does not carry — see FLARE in src/guns.ts.
  await go(3, 6950);
  if (!/nearest statflamer at x 6980, y 1132 IN REACH/.test(await say())) fail(`WOODS' statflamer stands at 6980,1132: ${/· \d+ guns[^·]*/.exec(await say())?.[0]}`);
  await take();
  if (!/holding flamer 41\/160/.test(await say())) fail(`0x451520 gives 40 and 0x45eed0 one more, against 0x44da94's 0xa0: ${await held()}`);
  const fidle = await showed(600, []);
  if (fidle.join() !== "1215,1216,1217") fail(`the flamer's idle is 0x470f98 tag 0, three cels; saw ${fidle.join(" ")}`);
  const ffire = await showed(900, ["p"]);
  if (!ffire.includes(1240)) fail(`its fire pose is tag 2, cel 1240; saw ${ffire.join(" ")}`);
  if ((await rounds()) !== 41) fail(`0x44dae0 spends no rounds; the panel says ${await held()}`);
  console.log(`ok    WOODS' flamer holds 41 of 160, has its own cels, and spends nothing when it fires`);

  await browser.close();
  console.log("PASS  the guns are placed, reached for, carried between levels and fired");
};

void main().catch((e) => fail(String(e)));
