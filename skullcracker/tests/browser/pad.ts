/**
 * The on-screen pad: can a phone play this level?
 *
 *   npm run dev -w skullcracker                # in one terminal
 *   npm run test:browser:pad -w skullcracker   # in another
 *
 * The page used to answer a finger with four invisible regions — the left half
 * of the canvas held LEFT, the right half RIGHT, the top third UP-and-jump, the
 * bottom third DOWN — and three of the original's eight actions (PUNCH, KICK,
 * INV) could not be reached at all. A touchscreen could walk the whole game and
 * never hit anything, which is the one thing this game is. The pad replaces it:
 * four directions at the left of the picture, and INV, JUMP, PUNCH and KICK at
 * the right — all eight of the original's own actions.
 *
 * What this suite is for is that the pad is the ONLY control on a machine with
 * no keyboard, so every one of its eight keys has to be there and be the thing
 * a thumb lands on, and the old behaviour has to be provably gone rather than
 * merely unmentioned.
 *
 * ## How it presses
 *
 * `Input.dispatchTouchEvent` over CDP rather than `page.touchscreen.tap`, for
 * one reason: every key here is a HOLD. A direction walks for as long as a thumb
 * is on it, the run is UP held with a direction, and the headbutt is PUNCH and
 * KICK down at the same time — none of which a tap can express. The context is
 * a real phone profile, so these arrive as `pointerType: "touch"` on a page that
 * shows the pad because it is a mobile browser, not because a query string
 * asked for it.
 *
 * ## The traps this file was written around
 *
 *   - **A tap that lands on nothing proves nothing.** So every key is hit-tested
 *     with `elementFromPoint` before it is pressed: if the pad were behind the
 *     canvas, or off the bottom of it, the presses below would sail into the
 *     picture and the "no walking" assertions would all pass.
 *   - **A short press cannot tell the old page from the new one.** The old
 *     regions held their direction while the finger was down, so a TAP on the
 *     old left half moved the player a pixel or two either way. The A/B here
 *     holds the old region down for 800ms — on the old page that is ~96px of
 *     walking, and on this one it must be nothing at all.
 *   - **"the state changed" is not the assertion.** The keys pressed here are
 *     checked for the state they produce — walking, `headbutt` — out of the
 *     status line the page already writes. What every one of the eight
 *     produces is the machine suite's question (`tests/machine/controls.ts`),
 *     which holds the game's own flags; this file proves the thumb reaches them.
 */
import { devices } from "playwright";
import { BASE, fail, finish, launch } from "./harness";

/** STREETS, at the foot of its ladder: flat street, floor y1346 */
const START = 9700;

const browser = await launch({ headless: process.env.HEADED !== "1" });
const page = await browser.newPage({ ...devices["Pixel 5"] });
const problems: string[] = [];
page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));

// no `?pad=1`: the pad has to decide FOR ITSELF that this machine has fingers
await page.goto(`${BASE}/walk.html?level=1&x=${START}`);
const hud = page.locator("#hud");
await hud.filter({ hasText: /room \d+ of \d+/ }).waitFor({ timeout: 30_000 });

const say = async (): Promise<string> => (await hud.textContent()) ?? "";
const xNow = async (): Promise<number> => {
  const m = /x (-?\d+)/.exec(await say());
  return m ? Number(m[1]) : fail(`no x in the HUD: ${(await say()).slice(0, 120)}`);
};

// ---- 1 — the pad is there, unasked -----------------------------------------

if (await page.locator("#pad").isHidden()) {
  fail(`a phone profile got no pad — maxTouchPoints ${await page.evaluate(() => navigator.maxTouchPoints)}`);
}
const KEYS = ["up", "down", "left", "right", "inv", "jump", "punch", "kick"] as const;
for (const act of KEYS) {
  if ((await page.locator(`#pad button[data-act="${act}"]`).count()) !== 1) fail(`the pad has no ${act} key`);
}
console.log(`ok    the pad shows itself on a phone, with all ${KEYS.length} keys`);

// ---- 2 — and each key is really the topmost thing at its own middle ---------
//
// Without this the presses below could all be landing on the canvas, and a
// suite that proved "the picture does not walk any more" would pass on a pad
// that was never hit once.
const centre = async (act: string): Promise<{ x: number; y: number }> => {
  const box = await page.locator(`#pad button[data-act="${act}"]`).boundingBox();
  if (!box) fail(`the ${act} key has no box — it is not laid out`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
};
for (const act of KEYS) {
  const at = await centre(act);
  const got = await page.evaluate(
    (p) => {
      const el = document.elementFromPoint(p.x, p.y) as HTMLElement | null;
      return el ? `${el.tagName}:${el.dataset.act ?? el.id}` : "nothing";
    },
    at,
  );
  if (got !== `BUTTON:${act}`) fail(`the point in the middle of the ${act} key belongs to ${got}`);
}
console.log(`ok    every key is the topmost element at its own middle`);

// ---- the finger ------------------------------------------------------------

const cdp = await page.context().newCDPSession(page);
/** put fingers down — one touch point per key named */
const down = async (...acts: string[]): Promise<void> => {
  const points = [];
  for (let i = 0; i < acts.length; i++) {
    const at = await centre(acts[i]);
    points.push({ x: at.x, y: at.y, id: i + 1 });
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: points });
};
/** ...and take them all off again */
const up = async (): Promise<void> => {
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
};
/**
 * Hold some keys and report what the page said while they were held.
 *
 * The status line is sampled THROUGHOUT rather than at the end: a punch is over
 * in under a second and a probe that reads once, afterwards, sees an idle man
 * and reports that nothing happened.
 */
const hold = async (acts: string[], ms: number): Promise<string[]> => {
  const seen: string[] = [];
  await down(...acts);
  const until = Date.now() + ms;
  while (Date.now() < until) {
    seen.push(await say());
    await page.waitForTimeout(40);
  }
  await up();
  return seen;
};
const saidWhile = (seen: string[], what: RegExp): boolean => seen.some((s) => what.test(s));

// ---- 3 — the old regions are gone ------------------------------------------
//
// The middle of the left half of the picture: LEFT, for as long as a finger was
// on it, on every build of this page until now. It is taken at 40% of the
// height, which is above the pad's own keys — asserted, not assumed, by the
// `elementFromPoint` below.
const canvas = (await page.locator("#screen").boundingBox())!;
const oldLeft = { x: canvas.x + canvas.width * 0.25, y: canvas.y + canvas.height * 0.4 };
const overThere = await page.evaluate(
  (p) => (document.elementFromPoint(p.x, p.y) as HTMLElement | null)?.id ?? "nothing",
  oldLeft,
);
if (overThere !== "screen") fail(`the old left region is covered by ${overThere}, so this proves nothing`);
const before = await xNow();
await cdp.send("Input.dispatchTouchEvent", {
  type: "touchStart",
  touchPoints: [{ x: oldLeft.x, y: oldLeft.y, id: 9 }],
});
await page.waitForTimeout(800);
await up();
const after = await xNow();
if (Math.abs(after - before) > 2) {
  fail(`800ms of finger on the picture walked the player ${before} → ${after}; the old regions are still live`);
}
console.log(`ok    a finger held on the picture walks nobody (x ${before} → ${after})`);

// ---- 4 — a key held is a direction held, and lifted is released -----------
//
// What each of the eight actions PRODUCES is the game's and is the machine
// suite's (`tests/machine/controls.ts`); what only the page can show is that a
// thumb on a key reaches the game's `held` flags, stays there while it is down,
// and lets go when it lifts.
const walkStart = await xNow();
const walkSaid = await hold(["right"], 800);
const walkEnd = await xNow();
if (walkEnd - walkStart < 60) fail(`RIGHT held for 800ms moved the player ${walkStart} → ${walkEnd}`);
if (!saidWhile(walkSaid, /walking \d+px\/s/)) fail(`RIGHT never put the page in its walk: ${walkSaid.at(-1)?.slice(0, 160)}`);
console.log(`ok    RIGHT walks east (x ${walkStart} → ${walkEnd})`);

// released is RELEASED: a key that stays held is the failure a pad on glass has
await page.waitForTimeout(400);
const stopped = await xNow();
await page.waitForTimeout(300);
if (Math.abs((await xNow()) - stopped) > 2) fail(`the player is still walking with no finger on the pad`);
console.log(`ok    lifting the finger stops the walk`);

// ---- 5 — two fingers are two keys ------------------------------------------
//
// the original's P+K, and the reason PUNCH and KICK are two keys a thumb apart
// rather than one "attack": the headbutt is only reachable with two touch
// points down at once
const butted = await hold(["punch", "kick"], 700);
if (!saidWhile(butted, /· headbutt\b/)) fail(`PUNCH and KICK together are not the headbutt: ${butted.at(-1)?.slice(0, 200)}`);
console.log(`ok    PUNCH and KICK together are the headbutt`);

// ---- 8 — the pad gets out of the way of a film -----------------------------
//
// The pause panel is three buttons painted on the canvas, and two of them are
// under the pad's own corners. A pad that stayed up would answer "quit" with a
// punch.
await page.keyboard.press("Control+q");
await hud.filter({ hasText: /resume · save · quit/ }).waitFor({ timeout: 15_000 });
if (await page.locator("#pad").isVisible()) fail(`the pad is still over the pause panel's own buttons`);
console.log(`ok    the pad stands down for a film`);
await page.keyboard.press("Escape");
await page.locator("#pad").waitFor({ state: "visible", timeout: 5_000 }).catch(() => fail(`the pad never came back after the panel closed`));
console.log(`ok    ...and comes back when the panel does`);

// ---- 8b — turned on its side, the picture is the window --------------------

// a phone in landscape is ~390px tall: the page's upright layout would give it
// a picture taller than the window, or a postage stamp under the bench. The
// mobile landscape rules give it the whole window at 4:3, and the pad on it.
{
  const upright = page.viewportSize() ?? fail(`the phone page has no viewport`);
  await page.setViewportSize({ width: upright.height, height: upright.width });
  await page.waitForTimeout(300);
  const [vw, vh] = [upright.height, upright.width];
  const pic = (await page.locator("#screen").boundingBox()) ?? fail(`no canvas in landscape`);
  if (pic.y < -1 || pic.y + pic.height > vh + 1 || pic.x < -1 || pic.x + pic.width > vw + 1)
    fail(`landscape: the picture ${Math.round(pic.width)}x${Math.round(pic.height)} at ${Math.round(pic.x)},${Math.round(pic.y)} is off a ${vw}x${vh} window`);
  if (Math.abs(pic.height - vh) > 2) fail(`landscape: the picture should be the window's height, ${Math.round(pic.height)} of ${vh}`);
  for (const act of ["left", "kick"]) {
    const key = (await page.locator(`#pad button[data-act="${act}"]`).boundingBox()) ?? fail(`no ${act} key in landscape`);
    if (key.x < pic.x - 1 || key.x + key.width > pic.x + pic.width + 1 || key.y + key.height > pic.y + pic.height + 1)
      fail(`landscape: ${act} is off the picture`);
  }
  await page.setViewportSize(upright);
  await page.waitForTimeout(300);
  console.log(`ok    in landscape the picture is the window, ${Math.round(pic.width)}x${Math.round(pic.height)} of ${vw}x${vh}, and the pad is on it`);
}

// ---- 9 — a machine with a mouse keeps a clean picture ----------------------

const desk = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await desk.goto(`${BASE}/walk.html?level=1`);
await desk.locator("#hud").filter({ hasText: /room \d+ of \d+/ }).waitFor({ timeout: 30_000 });
if (await desk.locator("#pad").isVisible()) fail(`a mouse-only window drew the pad over the picture`);
// a touchscreen laptop has fingers AND a keyboard: fingers alone are not a phone
const laptop = await browser.newPage({ viewport: { width: 1280, height: 900 }, hasTouch: true });
await laptop.goto(`${BASE}/walk.html?level=1`);
await laptop.locator("#hud").filter({ hasText: /room \d+ of \d+/ }).waitFor({ timeout: 30_000 });
const points = await laptop.evaluate(() => navigator.maxTouchPoints);
if (points < 1) fail(`the touch laptop profile reports no touch points, so it proves nothing`);
if (await laptop.locator("#pad").isVisible()) fail(`a desktop browser with a touchscreen drew the pad`);
await laptop.close();
await desk.goto(`${BASE}/walk.html?level=1&pad=1`);
await desk.locator("#hud").filter({ hasText: /room \d+ of \d+/ }).waitFor({ timeout: 30_000 });
if (await desk.locator("#pad").isHidden()) fail(`?pad=1 did not show the pad on a desktop`);
console.log(`ok    no pad off a mobile browser, touchscreen or not, and ?pad=1 for a look at one`);

// ---- 10 — and the front door gets one too -----------------------------------
//
// The level runner has two pages: this bench, and `index.html`, which hands it
// the canvas when the chooser starts the game. The pad is BUILT by the runner
// rather than written into `walk.html` exactly so that the players who came
// through the front door get it — and a pad that read its markup out of the
// bench's page would not merely be missing there, it would throw on the way in
// and the level would never start at all. So this takes the whole route: boot,
// skip the films, Begin, a figure, accept, and see what the phone is holding.
const BEGIN = { x: 400, y: 93 };
const RIGHT_FIGURE = { x: 400, y: 150 };
const ACCEPT = { x: 255, y: 244 };
const front = await browser.newPage({ ...devices["Pixel 5"] });
const frontThrew: string[] = [];
front.on("pageerror", (e) => frontThrew.push(e.message));
await front.goto(`${BASE}/index.html`);
const start = front.locator("#start");
await start.waitFor({ timeout: 60_000 });
for (let i = 0; i < 400 && (await start.isDisabled()); i++) await front.waitForTimeout(200);
await start.click();
/** the front end's own account of which film is up — hidden on the page, read here */
const loc = async (): Promise<string> => (await front.locator("#loc").textContent().catch(() => "")) ?? "";
const at = async (p: { x: number; y: number }): Promise<void> => {
  const box = (await front.locator("#screen").boundingBox())!;
  await front.mouse.click(box.x + (p.x / 512) * box.width, box.y + (p.y / 384) * box.height);
};
for (let i = 0; i < 150 && !/menu\.mov/i.test(await loc()); i++) {
  await front.keyboard.press("Escape");
  await front.waitForTimeout(400);
}
if (!/menu\.mov/i.test(await loc())) fail(`the front door never reached its menu: "${await loc()}"`);
await at(BEGIN);
// the chooser's regions are only on "frame 20" onward, where it loops
for (let i = 0; i < 200; i++) {
  const m = /frame (\d+)\/63/.exec(await loc());
  if (m && Number(m[1]) >= 21) break;
  await front.waitForTimeout(200);
}
await at(RIGHT_FIGURE);
for (let i = 0; i < 300 && !/frame 58\/59/.test(await loc()); i++) await front.waitForTimeout(200);
await at(ACCEPT);
const level = front.locator("#hud");
let playing = false;
for (let i = 0; i < 480 && !playing; i++) {
  playing = /room \d+ of \d+/.test((await level.textContent().catch(() => "")) ?? "");
  if (!playing) await front.waitForTimeout(250);
}
if (!playing) fail(`the chooser never started the level on the front page: ${frontThrew.join(" · ") || "#hud stayed empty"}`);
if (await front.locator("#pad").isHidden()) fail(`the level plays on the front page with no pad on it`);
const frontKey = await front.locator('#pad button[data-act="right"]').boundingBox();
if (!frontKey) fail(`the front page's pad has no right key laid out`);
// it is inset by that page's own moulding, so it lands on the PICTURE
const pic = (await front.locator("#screen").boundingBox())!;
if (frontKey.x + frontKey.width > pic.x + pic.width + 1 || frontKey.y + frontKey.height > pic.y + pic.height + 1) {
  fail(`the front page's pad hangs off the picture: key at ${JSON.stringify(frontKey)} against ${JSON.stringify(pic)}`);
}
if (frontThrew.length) fail(`the front page threw on the way in: ${frontThrew.join(" · ")}`);
console.log(`ok    the front door's own level is played with the same pad`);

if (problems.length) fail(`the page threw: ${problems.join(" · ")}`);
console.log(`PASS  the pad plays the level`);
await finish(browser);
