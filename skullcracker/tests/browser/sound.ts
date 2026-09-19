/**
 * Does the page make the game's own noise?
 *
 *   npm run dev -w skullcracker                  # in one terminal
 *   npm run test:browser:sound -w skullcracker   # in another
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
 * The last of it is the FILMS, whose sounds are not the level's at all: they live
 * in the film's own chunk table and are named by the frame that starts a segment.
 *
 * Chromium is started with `--autoplay-policy=no-user-gesture-required` because a
 * probe has no user to gesture. The page does not depend on that — it resumes its
 * context on the first key, which is what `wakeAudio` has always done for the
 * films — but without the flag a headless run would test nothing and pass.
 */
import { BASE, fail, finish, launch } from "./harness";

interface Source {
  dur: number;
  rate: number;
}

const main = async (): Promise<void> => {
  const browser = await launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
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

  /**
   * 6. the FILMS' own one-shots, which are where nearly all of this game's
   *    speech and most of its atmosphere live.
   *
   *    Only `menu.mov` and the sixteen chapter briefings carry a loop-table bed.
   *    Everything else — Boggs' spoken orders, the seven kill vignettes, the four
   *    time-out ones — is a one-shot NAMED BY A FRAME, and the page's player used
   *    to fire a one-shot only from a clicked region. All of it ran silent.
   *
   *    Every one of those films is the same four-part shape: a console powering
   *    down (`soundout 2` 2.97s, `soundout 3` 0.74s), the little monitor coming on
   *    (`sound 1` 0.98s), the vignette itself, and the monitor snapping off
   *    (`Mon. OFF` 0.46s). Four fixed durations, whichever of the seven is rolled.
   *
   *    The vignette segment is also where the film's PACE is checked, because the
   *    two facts are the same fact: its frames are authored at the film's own
   *    3 ticks (50ms) and the sound over it is exactly as long as the picture —
   *    `kill1.mov`'s 186 frames against 9.29s, `boggs01.mov`'s four speech
   *    segments to within 0.03s each. Paced at `mov-pace.ts`'s 66ms native floor
   *    instead, the picture runs a third longer than the line spoken over it.
   */
  await page.goto(`${BASE}/walk.html?level=2&x=650`);
  await hud.filter({ hasText: /room \d+ of \d+/ }).waitFor({ timeout: 30_000 });
  await page.keyboard.press("Shift");
  await page.waitForTimeout(400);
  mark = await count();
  // CITY has no floor east of its ledge; walking off it is the one death this
  // page can stage without turning the damage switch on
  await page.keyboard.down("ArrowRight");
  let frames = 0;
  let began = 0;
  let stopped = 0;
  for (let i = 0; i < 1200; i++) {
    const m = /kill\d\.mov · segment 3\/4 · frame \d+\/(\d+)/.exec((await hud.textContent()) ?? "");
    if (m) {
      if (!began) began = Date.now();
      frames = Number(m[1]);
      stopped = Date.now();
    } else if (began) break;
    await page.waitForTimeout(30);
  }
  await page.keyboard.up("ArrowRight");
  if (!began) fail(`walking off CITY's ledge should play a kill film; the HUD never showed one`);
  const film = round(await since(mark));
  for (const [dur, what] of [[2.97, "soundout 2"], [0.74, "soundout 3"], [0.98, "sound 1"], [0.46, "Mon. OFF"]] as const) {
    if (!film.includes(dur)) fail(`the kill film should play its own "${what}" (${dur}s); heard ${film.join(" ") || "silence"}`);
  }
  console.log(`ok    the kill film plays its four frame-entry one-shots: ${film.join(" ")}`);
  const ran = (stopped - began) / 1000;
  const authored = frames * 0.05;
  if (ran > authored * 1.2) {
    fail(`the vignette is ${frames} frames at the film's own 50ms — ${authored.toFixed(2)}s; it took ${ran.toFixed(2)}s`);
  }
  console.log(`ok    ...and its ${frames} frames run in ${ran.toFixed(2)}s, the ${authored.toFixed(2)}s its author gave them`);

  await finish(browser);
  console.log("PASS  the level's theme is its own arrangement, and the handlers' and films' one-shots are the disc's");
};

await main();
