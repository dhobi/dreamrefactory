/**
 * Does Skull Cracker start the way its own binary says it starts?
 *
 *   npm run dev:skullcracker            # in one terminal
 *   npm run test:browser:skullcracker   # in another
 *
 * This is the branch's whole claim, checked against a real browser rather than
 * against the readers that feed it. The readers are checked separately and
 * headlessly (`engine/tests/byte-order.ts`); what only a browser can answer is
 * whether the page draws what they decoded and whether the film's own click
 * regions are where the pointer thinks they are.
 *
 * ## What it asserts, and why each one earns its place
 *
 *   1. the boot reaches "ready" and the Start button becomes pressable —
 *      i.e. the manifest indexed a rip and the opening film came down;
 *   2. Start begins the CYBERFLIX LOGO, not the menu. The start sequence is a
 *      string table in the game's executable (`cyber.Mov`, `imain.Mov`,
 *      `Menu.Mov` — see BOOT_SEQUENCE in src/main.ts), and this is the check
 *      that the page follows it rather than jumping to the end of it;
 *   3. the canvas is not blank. A page whose byte order is wrong does not
 *      throw: it decodes a palette of 256 near-blacks and paints a black
 *      rectangle, so "no error" is not evidence and the PIXELS are;
 *   4. escape carries the sequence on — logo, intro, menu — which is what all
 *      three films' ESC-skips header bit meant in 1996, and which also proves
 *      the five-segment intro was reached and started;
 *   5. a click at the middle of the Begin button reaches chapter one's
 *      briefing. This is the one that says "the game started" rather than "a
 *      picture appeared" — it goes through the film's region table, its action
 *      type and its frame index, all read big-endian.
 *
 * ## Two traps this file is deliberately shaped around
 *
 * Clicks are converted through the canvas's own bounding box, because the
 * element is CSS-scaled — its backing store is 1024x768 and the film's regions
 * are in the game's 512x384 coordinates, so a click computed in either of those
 * two spaces lands somewhere else entirely.
 *
 * And the assertion after the click is on `#loc`, the page's own account of
 * which frame it is on, rather than on the picture changing. Frames 1..8 of this
 * film are near-identical animation cels; comparing screenshots would pass on
 * the wrong frame and fail on the right one.
 */
import { chromium } from "playwright";

const URL_BASE = process.env.URL ?? "http://localhost:5178/";
const HEADED = process.env.HEADED === "1";
/** where the Begin button is, in the game's own 512x384 screen */
const BEGIN = { x: 400, y: 93 };

const fail = (why: string): never => {
  console.error(`FAIL: ${why}`);
  process.exit(1);
};

const browser = await chromium.launch({ headless: !HEADED });
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
const problems: string[] = [];
page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));

await page.goto(URL_BASE, { waitUntil: "domcontentloaded" });

// 1 — the boot
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

await page.click("#start");
await page.waitForTimeout(2000);

// 2 — the sequence begins where the binary says it begins
const opening = (await page.textContent("#loc")) ?? "";
console.log(`opening: ${opening}`);
if (!/cyber/i.test(opening)) fail(`Start did not begin the CyberFlix logo: "${opening}"`);

// 3 — the picture. Count lit pixels rather than trusting the absence of an error.
const lit = await page.evaluate(() => {
  const c = document.getElementById("screen") as HTMLCanvasElement;
  const d = c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data;
  let n = 0;
  for (let i = 0; i < d.length; i += 4) if (d[i] > 24 || d[i + 1] > 24 || d[i + 2] > 24) n++;
  return { n, of: d.length / 4 };
});
console.log(`canvas: ${lit.n} lit of ${lit.of} pixels (${((lit.n / lit.of) * 100).toFixed(1)}%)`);
if (lit.n < lit.of * 0.1) fail("the canvas is (near enough) black — the menu did not draw");

// 4 — escape through the sequence: logo -> intro -> menu.
//
// Waits long enough after each press for the next film to be fetched and its
// whole segment decoded (the intro is 10 MB and arrives behind the logo).
async function escapeTo(what: RegExp, tries = 12): Promise<string> {
  for (let i = 0; i < tries; i++) {
    await page.keyboard.press("Escape");
    for (let waited = 0; waited < 20; waited++) {
      await page.waitForTimeout(1000);
      const at = (await page.textContent("#loc")) ?? "";
      if (what.test(at)) return at;
    }
  }
  return "";
}

const intro = await escapeTo(/imain/i, 1);
console.log(`after esc: ${intro}`);
if (!intro) fail("escape out of the logo did not reach the intro");
if (!/segment \d\/5/.test(intro)) fail(`the intro is five segments; #loc says "${intro}"`);

const before = await escapeTo(/menu\.mov/i, 1);
console.log(`after esc: ${before}`);
if (!before) fail("escape out of the intro did not reach the menu");
if (!/frame 1\//.test(before)) fail(`not on the menu's first frame: "${before}"`);

// 5 — the click that starts the game.
//
// "different from before" is NOT the assertion, and the first version of this
// file made it: the click really did reach the region, the menu really did end
// on "frame 2" as it should, and nothing picked that up — so the page went
// blank, `#loc` went empty, "after !== before" held, and the test reported PASS
// on a broken page. What Begin means is that chapter one's briefing plays, so
// that is what is asserted.
const box = (await page.locator("#screen").boundingBox())!;
await page.mouse.click(
  box.x + (BEGIN.x / 512) * box.width,
  box.y + (BEGIN.y / 384) * box.height,
);
await page.waitForTimeout(6000);
const after = (await page.textContent("#loc")) ?? "";
console.log(`after clicking Begin: ${after}`);
if (!after.trim()) fail("nothing is playing after Begin — the page went blank");
if (!/chp01/i.test(after)) fail(`Begin did not reach chapter one's briefing: "${after}"`);

const err = (await page.textContent("#err")) ?? "";
if (err.trim()) problems.push(`#err: ${err}`);
if (problems.length) fail(problems.join(" | "));

console.log("PASS — the sequence runs logo → intro → menu, and Begin is live");
await browser.close();
