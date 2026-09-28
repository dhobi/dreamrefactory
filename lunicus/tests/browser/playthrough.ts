/**
 * The whole game in a real browser: the machine route's run, replayed on the
 * page through real mouse and keyboard events, tick for tick.
 *
 *   npm run dev -w lunicus                                  (port 5180)
 *   npm run test:browser -w lunicus                         headless, asserts, exits
 *   HEADED=1 PACE=4 npm run test:browser -w lunicus         a window, at four times game speed
 *   REC=out/lunicus/playthrough.json …                      replay a recording instead of playing one first
 *
 * ## Why a replay cannot wander
 *
 * The machine is deterministic: its roll is seeded, and nothing else in it is
 * left to chance. So the run is played first by the machine route
 * (`tests/machine/days/`, headless, as `npm test` plays it) with every gesture
 * kept, and the page — opened with `?drive&seed=` — is given the same seed and
 * handed the same gestures at the same ticks. The page's clock is the driver's
 * (it ticks only when told), every file the run read is fetched before the
 * first tick, and a gesture goes in as a genuine Playwright mouse or keyboard
 * event on the canvas, through the page's own listeners and `game/input.ts` —
 * the door the machine route's gestures went through too. The two runs are then
 * the same run, and the route's checkpoints (one for each `ok`) say so as the
 * replay passes them; the first that differs names the tick where they parted.
 *
 * What the replay adds over the headless run: the page's event wiring and
 * canvas mapping, its file fetching, every picture decoded and drawn, and a
 * screenshot at each day to look at (out/lunicus/playthrough/).
 */
import { chromium } from "playwright";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { SCREEN_H, SCREEN_W } from "../../src/game/data";
import type { Gesture } from "../../src/game/input";
import { headless, type Checkpoint, type Recording } from "../machine/harness";
import { playDay1 } from "../machine/days/day1";
import { playCityDay } from "../machine/days/city-day";
import { playDay5 } from "../machine/days/day5";
import { playDay6 } from "../machine/days/day6";

const OUT = resolve(import.meta.dirname, "../../../out/lunicus/playthrough");
const APP = process.env.APP_URL ?? "http://localhost:5180/";
const HEADED = !!process.env.HEADED;
/** watch it at this many times game speed (60 ticks a second); unset, as fast as it goes */
const PACE = Number(process.env.PACE ?? 0);

interface DriveState {
  t: number;
  phase: string;
  level: number;
  progress: number;
  score: number;
  won: boolean;
  stopped: string;
  screen: { x: number; y: number; width: number; height: number };
}

const t0 = Date.now();
const secs = (): string => `${((Date.now() - t0) / 1000).toFixed(1)}s`;
const fail = (why: string): never => {
  console.log(`FAIL  ${why}`);
  process.exit(1);
};

/* ------------------------------------------------------------------------- *
 * The run to replay
 * ------------------------------------------------------------------------- */

function record(): Recording {
  if (process.env.REC) return JSON.parse(readFileSync(process.env.REC, "utf8")) as Recording;
  console.log("… playing the machine route to record it");
  const log = console.log;
  console.log = () => {};
  try {
    const h = headless();
    playDay1(h);
    for (const day of [2, 3, 4]) playCityDay(h, day);
    playDay5(h);
    playDay6(h);
    return h.recording();
  } finally {
    console.log = log;
  }
}

const rec = record();
if (!rec.checkpoints.at(-1)?.won) fail("the recorded run does not end won");
console.log(`ok    recorded: seed ${rec.seed}, ${rec.gestures.length} gestures, ${rec.checkpoints.length} checkpoints, ${rec.ticks} ticks (${secs()})`);
mkdirSync(OUT, { recursive: true });
writeFileSync(resolve(OUT, "recording.json"), JSON.stringify(rec));

/* ------------------------------------------------------------------------- *
 * The page
 * ------------------------------------------------------------------------- */

const browser = await chromium.launch({ headless: !HEADED });
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
page.on("pageerror", (e) => fail(`the page threw: ${e.message}`));
const url = new URL(APP);
url.searchParams.set("drive", "");
url.searchParams.set("seed", String(rec.seed));
await page.goto(url.href);
await page.waitForSelector("#boot.ready", { timeout: 120_000 });
await page.click("#start");
await page.waitForFunction(() => (window as unknown as { lunicusDrive?: { running(): boolean } }).lunicusDrive?.running());
await page.evaluate((files) => (window as unknown as { lunicusDrive: { preload(p: string[]): Promise<void> } }).lunicusDrive.preload(files), rec.files);
console.log(`ok    the page is up in drive mode, ${rec.files.length} files fetched (${secs()})`);

/**
 * Where the canvas is, as the page last said (`DriveState.screen`). Not
 * measured once: the frame settles in over its first second, and the menu bar
 * above the picture pushes it down on the title and gives it back in a game —
 * a click aimed by a stale box lands that far off, which is how a replay once
 * died in day three's city.
 */
let box = (await page.locator("#screen").boundingBox())!;
const at = (x: number, y: number): [number, number] => [box.x + ((x + 0.5) * box.width) / SCREEN_W, box.y + ((y + 0.5) * box.height) / SCREEN_H];
const KEYS: Record<string, string> = { " ": "Space" };

const to = async (t: number): Promise<DriveState> => {
  const s = await page.evaluate((t) => (window as unknown as { lunicusDrive: { to(t: number): DriveState } }).lunicusDrive.to(t), t);
  box = s.screen;
  return s;
};
/** two animation frames: the canvas shows what the machine has drawn */
const painted = (): Promise<void> => page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));

let mouse: [number, number] | null = null;
async function perform(g: Gesture): Promise<void> {
  if ("key" in g) return g.g === "keydown" ? page.keyboard.down(KEYS[g.key] ?? g.key) : page.keyboard.up(KEYS[g.key] ?? g.key);
  if (g.g === "menu") {
    // the bar's menu, then its item, as a hand does it (src/menu.ts)
    const item = page.locator(`.wbar-item[data-id="${g.id}"]`);
    await item.locator("xpath=ancestor::div[contains(@class,'wbar-menu')]").locator(".wbar-title").dispatchEvent("pointerdown");
    await item.click();
    mouse = null;
    return;
  }
  const p = at(g.x, g.y);
  if (!mouse || mouse[0] !== p[0] || mouse[1] !== p[1]) await page.mouse.move(p[0], p[1]);
  mouse = p;
  if (g.g === "down") await page.mouse.down();
  if (g.g === "up") await page.mouse.up();
}

function same(cp: Checkpoint, s: DriveState): boolean {
  return cp.phase === s.phase && cp.level === s.level && cp.progress === s.progress && cp.score === s.score && cp.won === s.won;
}

/** a screenshot where a day turns: its checkpoints' names say so */
const SHOTS = /slept|the hive:|the engine rooms are clear|the queen|down to the|the node is gone/;

/* ------------------------------------------------------------------------- *
 * The replay
 * ------------------------------------------------------------------------- */

let g = 0;
let shots = 0;
/** where the page's clock stands, and when the pacing started */
let clock = 0;
const started = Date.now();
/** the page's clock to `t`: at once, or at PACE times game speed in steps a frame long, so a window shows it move */
const until = async (t: number): Promise<DriveState> => {
  if (!PACE) return to(t);
  let s = await to(clock);
  while (clock < t) {
    clock = Math.min(t, clock + 3 * PACE);
    s = await to(clock);
    const wait = started + (clock * 1000) / 60 / PACE - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  }
  return s;
};
for (const cp of rec.checkpoints) {
  // every gesture before the checkpoint's tick, each at its own tick
  for (; g < rec.gestures.length && rec.gestures[g].t <= cp.t; g++) {
    const ge = rec.gestures[g];
    await until(ge.t);
    await perform(ge);
  }
  const s = await until(cp.t);
  if (!same(cp, s)) {
    await painted();
    await page.locator("#screen").screenshot({ path: resolve(OUT, "diverged.png") });
    fail(`the replay parted from the run by tick ${cp.t} (${cp.what}): the run had ${JSON.stringify({ phase: cp.phase, level: cp.level, progress: cp.progress, score: cp.score })}, the page ${JSON.stringify(s)}`);
  }
  console.log(`ok    t=${cp.t} ${cp.what} (${secs()})`);
  if (SHOTS.test(cp.what)) {
    await painted();
    await page.locator("#screen").screenshot({ path: resolve(OUT, `${String(++shots).padStart(2, "0")}.png`) });
  }
}
const end = await to(rec.ticks);
await painted();
await page.locator("#screen").screenshot({ path: resolve(OUT, "end.png") });
// won, the game goes back to its title (level 0, 0x416ec8) and waits for File ▸ New
const back = await to(rec.ticks + 60 * 60);
const log = (await page.locator("#log").textContent()) ?? "";
if (!end.won || back.phase !== "title" || !/the game is won/.test(log)) fail(`the page did not end won at its title: ${JSON.stringify(back)}`);
await painted();
await page.locator("#screen").screenshot({ path: resolve(OUT, "title.png") });
console.log(`ok    won, and the title again a minute later (${back.phase}, level ${back.level})`);
console.log(`PASS  the whole game in the browser: ${rec.gestures.length} gestures over ${rec.ticks} ticks in ${secs()}; screenshots in ${OUT}`);
await browser.close();
