/**
 * Can Skull Cracker be played with a finger?
 *
 *   npm run dev:skullcracker                  # in one terminal
 *   npm run test:browser:skullcracker:touch   # in another
 *
 * `menu.ts` drives this page with a mouse and a keyboard. A phone has neither,
 * and until the shared recogniser was wired in it had no way past the opening
 * film at all — skipping was `Escape` and nothing else. So this is the same
 * journey as `menu.ts`, taken entirely by touch, and it exists because the two
 * routes are genuinely different code: the mouse clicks on `pointerdown`, while
 * a finger goes through `TouchGestures` and is ambiguous until it lifts.
 *
 * ## What it asserts
 *
 *   1. a DOUBLE-TAP skips a film. This is the gesture that had no keyboard-free
 *      equivalent, and it is asserted by where it ARRIVES (the intro, then the
 *      menu) rather than by the picture changing;
 *   2. a single tap on a playing film does NOT skip it. The double-tap is only
 *      meaningful if one tap is not enough — without this, a recogniser that
 *      fired ESCAPE on every tap would pass step 1;
 *   3. a tap on the menu's Begin button reaches chapter one's briefing, the same
 *      outcome `menu.ts` clicks for. This is the tap-as-click path, and on a
 *      region it is taken at `pointerdown` (`ownedByGame`), which is a different
 *      branch of the recogniser from the taps in step 1.
 *
 * ## The traps
 *
 * The context must be built with `hasTouch`, or `page.touchscreen` dispatches
 * events the page sees as a mouse and every assertion here tests the mouse path
 * twice over. `pointerType` is checked once, at the start, so that a Playwright
 * or Chromium change that silently turns these into mouse events fails LOUDLY
 * rather than passing on the wrong code.
 *
 * Taps are converted through the canvas's own bounding box for the reason
 * `menu.ts` gives: the element is CSS-scaled, and its backing store (1024x768)
 * is not the film's coordinate space (512x384) either.
 *
 * And the two taps of a double-tap have to land inside DOUBLE_TAP_MS (320 ms) of
 * each other and within DOUBLE_TAP_PX (48) of the same spot. `touchscreen.tap`
 * is fast, but the two calls are separate round trips to the browser, so a
 * failure here reads as "the double-tap did nothing" and is worth suspecting
 * before the page is.
 */
import { chromium, devices } from "playwright";

const URL_BASE = process.env.URL ?? "http://localhost:5178/";
const HEADED = process.env.HEADED === "1";
/** where the Begin button is, in the game's own 512x384 screen */
const BEGIN = { x: 400, y: 93 };
/** somewhere with no click region on it — the middle of the picture */
const NOWHERE = { x: 256, y: 300 };

const fail = (why: string): never => {
  console.error(`FAIL: ${why}`);
  process.exit(1);
};

const browser = await chromium.launch({ headless: !HEADED });
// a real phone profile, so `hasTouch` and a coarse pointer both hold — the page
// picks its hint line off `(pointer: coarse)` and the recogniser off pointerType
const page = await browser.newPage({ ...devices["Pixel 5"] });
const problems: string[] = [];
page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));

await page.goto(URL_BASE, { waitUntil: "domcontentloaded" });

// ---- the boot, and then proof that these really are touch events ------------

try {
  await page.waitForFunction(
    () => !(document.getElementById("start") as HTMLButtonElement).disabled,
    null,
    { timeout: 120_000 },
  );
} catch {
  fail(`the boot never got to a pressable Start — #err said "${await page.textContent("#err")}"`);
}
console.log(`boot: ${await page.textContent("#bootsay")} ${await page.textContent("#bootpct")}`);

// the whole file is worthless if these arrive as mouse events, so ask the page
await page.evaluate(() => {
  (window as unknown as { __seen: string[] }).__seen = [];
  document.getElementById("screen")!.addEventListener("pointerdown", (e) => {
    (window as unknown as { __seen: string[] }).__seen.push((e as PointerEvent).pointerType);
  });
});

await page.tap("#start");
await page.waitForTimeout(2000);

const opening = (await page.textContent("#loc")) ?? "";
console.log(`opening: ${opening}`);
if (!/cyber/i.test(opening)) fail(`Start did not begin the CyberFlix logo: "${opening}"`);

const box = (await page.locator("#screen").boundingBox())!;
/** tap a point in the game's 512x384 space */
const tap = async (at: { x: number; y: number }): Promise<void> => {
  await page.touchscreen.tap(box.x + (at.x / 512) * box.width, box.y + (at.y / 384) * box.height);
};

await tap(NOWHERE);
const kinds = await page.evaluate(() => (window as unknown as { __seen: string[] }).__seen);
console.log(`pointerType seen by the canvas: ${JSON.stringify(kinds)}`);
if (!kinds.includes("touch")) {
  fail(`the canvas saw ${JSON.stringify(kinds)} — these are not touch events, so nothing below tests touch`);
}

// ---- 2 — one tap is not a skip ---------------------------------------------
//
// asserted BEFORE the double-tap, because the tap above has already happened:
// if a single tap skipped, the logo would be gone by now.
await page.waitForTimeout(500);
const afterOneTap = (await page.textContent("#loc")) ?? "";
console.log(`after one tap: ${afterOneTap}`);
if (!/cyber/i.test(afterOneTap)) {
  fail(`a single tap skipped the logo — it reached "${afterOneTap}", so double-tap means nothing`);
}

// ---- 1 — the double-tap carries the sequence on ------------------------------

/** two taps in the same place, promptly: the phone's Escape */
const doubleTap = async (at: { x: number; y: number }): Promise<void> => {
  await tap(at);
  await tap(at);
};

/**
 * How long a skip is allowed to take, and — the load-bearing half — how long the
 * film is watched WITHOUT a gesture first.
 *
 * These films end on their own and chain onwards: that is the boot sequence
 * working. So "the intro is playing now" is not evidence that a double-tap did
 * anything, and the first version of this file made exactly that mistake — it
 * polled for the intro over 20 seconds a try, `cyber.Mov` (318 frames at about
 * ten a second) played itself out inside that window, and the test passed with
 * the touch branch of `pointerdown` compiled out entirely. It was measuring the
 * boot sequence.
 *
 * So every skip below is an A/B against the same clock: watch for this long and
 * require the film to STAY, then double-tap and require it to go. A skip is
 * immediate and a playthrough is tens of seconds, so the window separates them
 * with room to spare — and if either half stops holding, this fails rather than
 * quietly measuring the wrong thing again.
 */
const SKIP_MS = 3000;

async function loc(): Promise<string> {
  return (await page.textContent("#loc")) ?? "";
}

/** poll until `what` shows up, or the budget runs out */
async function settle(what: RegExp, budgetMs: number): Promise<string> {
  for (let waited = 0; waited < budgetMs; waited += 200) {
    await page.waitForTimeout(200);
    const at = await loc();
    if (what.test(at)) return at;
  }
  return "";
}

/**
 * Prove a double-tap is what moved the film on: the control arm first, then the
 * gesture, both over {@link SKIP_MS}.
 */
async function skipTo(what: RegExp, staying: RegExp): Promise<string> {
  const drifted = await settle(what, SKIP_MS);
  if (drifted) {
    fail(
      `the film reached ${what} in ${SKIP_MS}ms with NO gesture ("${drifted}") — ` +
        `this window cannot tell a skip from a playthrough, so nothing here would test touch`,
    );
  }
  const held = await loc();
  if (!staying.test(held)) fail(`expected to still be on ${staying} before the double-tap, not "${held}"`);
  await doubleTap(NOWHERE);
  return await settle(what, SKIP_MS);
}

const intro = await skipTo(/imain/i, /cyber/i);
console.log(`after double-tap: ${intro}`);
if (!intro) fail(`a double-tap on the logo did not reach the intro within ${SKIP_MS}ms — the phone cannot skip`);
if (!/segment \d\/5/.test(intro)) fail(`the intro is five segments; #loc says "${intro}"`);

const menu = await skipTo(/menu\.mov/i, /imain/i);
console.log(`after double-tap: ${menu}`);
if (!menu) fail(`a double-tap on the intro did not reach the menu within ${SKIP_MS}ms`);
if (!/frame 1\//.test(menu)) fail(`not on the menu's first frame: "${menu}"`);

// ---- 3 — a tap on a region is a click ---------------------------------------
//
// A region presses at `pointerdown` rather than waiting to see whether the
// finger lifts (`ownedByGame`), so this is a different branch from every tap
// above. And it is asserted on the OUTCOME — chapter one's briefing — because a
// tap that reached the region and was then dropped leaves the page blank and
// "something changed" would still hold. See menu.ts, which learned that first.
await tap(BEGIN);
await page.waitForTimeout(6000);
const after = (await page.textContent("#loc")) ?? "";
console.log(`after tapping Begin: ${after}`);
if (!after.trim()) fail("nothing is playing after Begin — the page went blank");
if (!/chp01/i.test(after)) fail(`tapping Begin did not reach chapter one's briefing: "${after}"`);

const err = (await page.textContent("#err")) ?? "";
if (err.trim()) problems.push(`#err: ${err}`);
if (problems.length) fail(problems.join(" | "));

console.log("PASS — a finger skips films and works the menu");
await browser.close();
