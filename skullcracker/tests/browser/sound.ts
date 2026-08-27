/**
 * Does the page make the game's own noise?
 *
 *   npm run dev:skullcracker                  # in one terminal
 *   npm run test:browser:skullcracker:sound   # in another
 *
 * Sound is the one thing on this page that a screenshot cannot show and a pixel
 * count cannot count, so this probe counts SOURCES: it wraps
 * `AudioBufferSourceNode.prototype.start` before the page loads and records every
 * buffer the page hands to the clock, with its duration and its sample rate. That
 * turns "is there music" into arithmetic, because the durations are the disc's own
 * and they are distinctive.
 *
 * `THEME01`, the theme STREETS opens (`0x44dc1e`), is eleven bars and a 62-step
 * play order that begins `1 1 5 5 5 3 4 …`. Bars 1 and 2 are 1.63s and bar 5 is
 * **6.55s**, so the first four things a silent page plays are 1.63, 1.63, 6.55,
 * 6.55 — an order no other reading of the bank produces. The effects are equally
 * unmistakable: a footfall out of `skulz.snd` is 0.19s or 0.23s, and they
 * alternate because the engine fires them off the walk cycle's frame number
 * (`0x429b3d` plays sound 0 on frame 1, `0x429b5c` sound 1 on frame 6).
 *
 * Chromium is started with `--autoplay-policy=no-user-gesture-required` because a
 * probe has no user to gesture. The page does not depend on that — it resumes its
 * context on the first key, which is what `wakeAudio` has always done for the
 * films — but without the flag a headless run would test nothing and pass.
 */
import { chromium } from "playwright";

const BASE = process.env.BASE ?? "http://localhost:5178";

const fail = (why: string): never => {
  console.error(`FAIL  ${why}`);
  process.exit(1);
};

interface Source {
  dur: number;
  rate: number;
}

const main = async (): Promise<void> => {
  const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on("pageerror", (e) => fail(`page threw: ${e.message}`));

  await page.addInitScript(() => {
    const started: Source[] = [];
    (window as unknown as { __snd: Source[] }).__snd = started;
    const start = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (this: AudioBufferSourceNode, when?: number) {
      started.push({ dur: this.buffer?.duration ?? 0, rate: this.buffer?.sampleRate ?? 0 });
      return start.call(this, when as number);
    };
  });

  const sources = (): Promise<Source[]> =>
    page.evaluate(() => (window as unknown as { __snd: Source[] }).__snd);
  const since = async (n: number): Promise<Source[]> => (await sources()).slice(n);
  const count = async (): Promise<number> => (await sources()).length;
  const round = (s: Source[]): number[] => s.map((q) => Number(q.dur.toFixed(2)));

  await page.goto(`${BASE}/walk.html?level=1&x=9500`);
  const hud = page.locator("#hud");
  await hud.filter({ hasText: /room \d+ of \d+/ }).waitFor({ timeout: 30_000 });
  // the gesture the page waits for, and nothing else: no movement, no attack
  await page.keyboard.press("Shift");
  await page.waitForTimeout(2500);

  // 1. the theme, in the order the bank's own table gives
  const bars = round(await sources()).filter((d) => d > 1);
  if (bars.length < 2) fail(`no theme playing: ${round(await sources()).join(" ") || "silence"}`);
  if (bars[0] !== 1.63 || bars[1] !== 1.63) {
    fail(`THEME01 opens on two 1.63s bars (its order starts 1 1); got ${bars.slice(0, 4).join(" ")}`);
  }
  console.log(`ok    the level's theme is playing its own arrangement: ${bars.slice(0, 4).join(" ")}`);

  // 2. every buffer is at one of the two rates the disc mixes
  for (const s of await sources()) {
    if (s.rate !== 22050 && s.rate !== 11025) fail(`a buffer came out at ${s.rate}Hz`);
  }
  console.log(`ok    and every buffer is 22k or 11k, the disc's own rates`);

  // 3. footfalls: two sounds, alternating, off the walk cycle's frames
  let mark = await count();
  await page.keyboard.down("ArrowLeft");
  await page.waitForTimeout(2600);
  await page.keyboard.up("ArrowLeft");
  const walked = round(await since(mark)).filter((d) => d < 1);
  if (walked.length < 4) fail(`walking made ${walked.length} short sounds, wanted at least 4 footfalls`);
  const feet = walked.filter((d) => d === 0.19 || d === 0.23);
  if (feet.length < 4) fail(`the footfalls should be the two 0.19/0.23 steps; got ${walked.join(" ")}`);
  if (!feet.some((d) => d === 0.19) || !feet.some((d) => d === 0.23)) {
    fail(`both steps should sound, one per foot; got ${feet.join(" ")}`);
  }
  console.log(`ok    walking alternates the two footfalls: ${feet.slice(0, 6).join(" ")}`);

  // 4. a kick makes a swing whether or not it lands
  mark = await count();
  await page.keyboard.press("k");
  await page.waitForTimeout(700);
  if (!(await since(mark)).length) fail(`a kick made no sound at all`);
  console.log(`ok    a kick swings audibly`);

  /**
   * 5. the hydrant, which is the one sound with an unarguable name.
   *
   *    `0x44fb94` plays index 4 of the chapter's bank on the frame the water is
   *    created, and index 4 of `woods.snd` is the record called "0040 hydrant".
   *    Its buffer is 1.07s — longer than a footfall and shorter than a bar — so
   *    three kicks at the hydrant have to produce one, and the HUD says when the
   *    water actually appeared.
   */
  await page.goto(`${BASE}/walk.html?level=1&x=8560`);
  await hud.filter({ hasText: /room \d+ of \d+/ }).waitFor({ timeout: 30_000 });
  await page.keyboard.press("Shift");
  await page.waitForTimeout(600);
  await page.keyboard.down("ArrowRight");
  await page.waitForTimeout(300);
  await page.keyboard.up("ArrowRight");
  mark = await count();
  let burst = false;
  for (let i = 0; i < 4 && !burst; i++) {
    await page.keyboard.press("k");
    for (let j = 0; j < 8 && !burst; j++) {
      await page.waitForTimeout(60);
      burst = /· water cel 98\d\d/.test((await hud.textContent()) ?? "");
    }
    await page.waitForTimeout(200);
  }
  if (!burst) fail(`the hydrant never burst, so its sound cannot be checked`);
  const hit = round(await since(mark));
  if (!hit.includes(1.07)) fail(`the burst should play woods.snd's 1.07s "0040 hydrant"; got ${hit.join(" ")}`);
  console.log(`ok    the hydrant bursts on its own sound: ${hit.join(" ")}`);

  await browser.close();
  console.log("PASS  the level's theme is its own arrangement, and the handlers' one-shots are the disc's");
};

void main().catch((e) => fail(String(e)));
