/**
 * Does Skull Cracker start the way its own binary says it starts?
 *
 *   npm run dev -w skullcracker            # in one terminal
 *   npm run test:browser -w taoot -w skullcracker   # in another
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
 *   5. a click at the middle of the Begin button reaches the CHARACTER CHOOSER,
 *      the chooser answers, and the answer starts the game. This is the one that
 *      says "the game started" rather than "a picture appeared" — it goes
 *      through the film's region table, its action type and its frame index, all
 *      read big-endian, and then through `char.mov` into `walk.html`.
 *   6. Prefs opens its panel, its controls answer a click and a key, and the
 *      button at the bottom right is the way out of it. The panel's own
 *      arithmetic — which rect is which control, what a key box refuses, what
 *      the slider's x means — and a rebound key still bound in the level are
 *      the machine suite's (`tests/machine/controls.ts`); this is the page
 *      routing clicks and keys to it.
 *
 * Prefs is visited BEFORE Begin, on the one boot: the menu is where both are.
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
import { BASE, fail, finish, launch } from "./harness";

const URL_BASE = `${BASE}/`;
const HEADED = process.env.HEADED === "1";
/** where the Begin button is, in the game's own 512x384 screen */
const BEGIN = { x: 400, y: 93 };
/** and Prefs, two buttons down — `menu.mov`'s region at y 180..208 */
const PREFS = { x: 410, y: 194 };
/**
 * The chooser's two figures, and its accept button.
 *
 * `char.mov`'s regions are on "frame 20" onwards, where it loops: the left pair
 * chain `ltpan.mov` and the right pair `rtpan.mov` (34,65)-(226,231) against
 * (287,62)-(477,232). Each pan ends on a frame that WAITS for its one region at
 * (219,225)-(291,264), which is the only way out of it.
 */
const LEFT_FIGURE = { x: 110, y: 150 };
const RIGHT_FIGURE = { x: 400, y: 150 };
const ACCEPT = { x: 255, y: 244 };
/** the prefs panel's three difficulty boxes — `0x4791d8`, `0x4791e0`, `0x4791e8` */
const HARD = { x: 226, y: 233 };
const MEDIUM = { x: 178, y: 233 };
/**
 * ...and two more of the fourteen, every rect out of `.data` (see `src/prefs.ts`).
 *
 * `TOWARD_BOX` is `0x479190`, the key box for action 2 — the one `0x402be0`
 * swaps on the player's facing, which this page calls "right". `OK` is
 * `0x4791c8`, the only way out.
 */
const TOWARD_BOX = { x: 254, y: 155 };
const OK = { x: 412, y: 224 };

const browser = await launch({ headless: !HEADED });
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
  fail(
    `the boot never got to a pressable Start — #err said "${await page.textContent("#err")}"`,
  );
}
console.log(
  `boot: ${await page.textContent("#bootsay")} ${await page.textContent("#bootpct")}`,
);

await page.click("#start");
for (let i = 0; i < 40 && !/cyber/i.test((await page.textContent("#loc")) ?? ""); i++)
  await page.waitForTimeout(100);
// ...and a moment for its first frames to paint, which step 3 counts
await page.waitForTimeout(500);

// 2 — the sequence begins where the binary says it begins
const opening = (await page.textContent("#loc")) ?? "";
console.log(`opening: ${opening}`);
if (!/cyber/i.test(opening))
  fail(`Start did not begin the CyberFlix logo: "${opening}"`);

// 3 — the picture. Count lit pixels rather than trusting the absence of an error.
const lit = await page.evaluate(() => {
  const c = document.getElementById("screen") as HTMLCanvasElement;
  const d = c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data;
  let n = 0;
  for (let i = 0; i < d.length; i += 4)
    if (d[i] > 24 || d[i + 1] > 24 || d[i + 2] > 24) n++;
  return { n, of: d.length / 4 };
});
console.log(
  `canvas: ${lit.n} lit of ${lit.of} pixels (${((lit.n / lit.of) * 100).toFixed(1)}%)`,
);
if (lit.n < lit.of * 0.1)
  fail("the canvas is (near enough) black — the menu did not draw");

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
if (!/segment \d\/5/.test(intro))
  fail(`the intro is five segments; #loc says "${intro}"`);

const before = await escapeTo(/menu\.mov/i, 1);
console.log(`after esc: ${before}`);
if (!before) fail("escape out of the intro did not reach the menu");
if (!/frame 1\//.test(before))
  fail(`not on the menu's first frame: "${before}"`);

// ...and the high-score board is ON it, in PIXELS.
//
// `0x45de89` draws the board over `menu.mov` for every frame index 0..0xa7, at
// `0x45de90`'s point {y 0x6b, x 0x2c}, and the menu's own art leaves it an empty
// green panel to go in. It was absent for a different reason than it looked:
// `paint` is handed to `new Film(...)` and fires while the module's `film` is
// still the previous one, so the board declined to draw — and `menu.mov`'s frame
// 1 is a type-2 frame targeting ITSELF, so no second blit ever came to draw it
// on. `#loc` reported the board the whole time, which is why this reads the
// canvas instead of the status line.
const boardInk = (): Promise<number> =>
  page.evaluate(() => {
    const c = document.getElementById("screen") as HTMLCanvasElement;
    const s = c.width / 512;
    const d = c
      .getContext("2d")!
      .getImageData(40 * s, 80 * s, 215 * s, 165 * s).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4)
      if (d[i + 1] > 140 && d[i] < 130 && d[i + 2] < 130) n++;
    return n;
  });
let onMenu = 0;
for (let i = 0; i < 20 && onMenu < 400; i++) {
  onMenu = await boardInk();
  if (onMenu < 400) await page.waitForTimeout(200);
}
if (onMenu < 400)
  fail(
    `the board belongs on the attract screen (0x45de89); ${onMenu} green pixels in its panel`,
  );
console.log(
  `ok    and the high-score board is on the menu — ${onMenu} green pixels of it`,
);

const at = async (p: { x: number; y: number }): Promise<void> => {
  const box = (await page.locator("#screen").boundingBox())!;
  await page.mouse.click(
    box.x + (p.x / 512) * box.width,
    box.y + (p.y / 384) * box.height,
  );
};
const loc = async (): Promise<string> => {
  try {
    return (await page.locator("#loc").textContent({ timeout: 2000 })) ?? "";
  } catch {
    return ""; // the page navigated away, which is itself an answer
  }
};
const until = async (what: RegExp, ms = 40_000): Promise<boolean> => {
  for (let i = 0; i < ms / 200; i++) {
    if (what.test(await loc()) || what.test(page.url())) return true;
    await page.waitForTimeout(200);
  }
  return false;
};

// 6 — Prefs. Its panel has no regions at all: 0x45db40 draws the fourteen
//     controls and 0x45d700 takes the clicks. Difficulty is +1 easy, 0 medium,
//     -1 hard (0x448ac2's health).
//
//     The film that opens it is `prefs.mov` — frames 1..30 of one sixty-frame
//     move, with `prefs2.mov` as 31..60. `0x4030ac` calls the modal and only
//     `0x4030b1` plays prefs2, so a film after the modal can only be the panel
//     leaving.
await at(PREFS);
if (!(await until(/prefs panel/)))
  fail(`Prefs should open its panel; #loc says "${await loc()}"`);
if (!/difficulty 0/.test(await loc()))
  fail(`the panel should open on the middle difficulty: "${await loc()}"`);
await at(HARD);
if (!(await until(/difficulty -1/, 3_000)))
  fail(`0x4791e8's box stores -1 (0x45d7ae); the panel says "${await loc()}"`);
await at(MEDIUM);
if (!(await until(/difficulty 0/, 3_000)))
  fail(`0x4791e0's box stores 0 (0x45d79b); the panel says "${await loc()}"`);
// ...and a key box binds the next character typed (`0x45d72f`, `0x45d810`)
if (!/toward D/.test(await loc()))
  fail(`action 2 ships bound to D (0x46b210); the panel says "${await loc()}"`);
await at(TOWARD_BOX);
await page.waitForTimeout(100);
await page.keyboard.press("z");
if (!(await until(/toward Z/, 3_000)))
  fail(`0x45d810 should have bound Z to action 2; the panel says "${await loc()}"`);
console.log(`ok    the preferences panel answers a click and a key`);

// ...and control 8, the one rect whose handler returns zero and so ends
// `0x45d5a0`'s loop. It is the only way out of the panel the original has.
await at(OK);
if (!(await until(/menu\.mov/i, 20_000)))
  fail(`0x4791c8 is the way out (0x45d73f); #loc says "${await loc()}"`);
console.log(`ok    and the button at the bottom right is the one way out of it`);

// 5 — the click that starts the game.
//
// "different from before" is NOT the assertion, and the first version of this
// file made it: the click really did reach the region, the menu really did end
// on "frame 2" as it should, and nothing picked that up — so the page went
// blank, `#loc` went empty, "after !== before" held, and the test reported PASS
// on a broken page.
//
// What Begin MEANS is the correction. It does not begin: `menu.mov`'s "frame 2"
// is frame index 168, and `0x45df7c` — the 168th slot of the jump table at
// `0x45e1ac` — sets `[0x46b208] = -1`, which `0x40312c` plays as `char.mov`. The
// game asks which of its two players you are before it starts.
await at(BEGIN);
if (!(await until(/char\.mov/i)))
  fail(`Begin should reach the chooser (0x45df7c); #loc says "${await loc()}"`);
console.log(`after clicking Begin: ${await loc()}`);

// ...and the chooser's regions are only on "frame 20" onward, where it loops
for (let i = 0; i < 300; i++) {
  const m = /frame (\d+)\/63/.exec(await loc());
  if (m && Number(m[1]) >= 21) break;
  await page.waitForTimeout(200);
}
await at(RIGHT_FIGURE);
if (!(await until(/rtpan\.mov/i)))
  fail(`the right figure chains rtpan.mov; #loc says "${await loc()}"`);
console.log(`after clicking the right figure: ${await loc()}`);

// ...and the panel it slides in is EMPTY in the film. What fills it is the
// executable's: `0x45e14c` waits for frame 0x2a and calls `0x45e520` for
// character 1 (`0x45e390` for character 0), seven lines sixteen apart from the
// point its caller hands in, plus a name plate offset from where they ended.
// The green in that half of the screen is the whole of the assertion — see
// DOSSIERS in `src/prefs.ts`.
if (!(await until(/frame 4[2-9]\/59/)))
  fail(`rtpan.mov should reach its own frame 42`);
// ...and the canvas is one frame behind what `#loc` reports, so this polls for
// the ink rather than reading once
const inPanel = async (): Promise<number> =>
  page.evaluate(() => {
    const c = document.getElementById("screen") as HTMLCanvasElement;
    // character 1's seven lines start at x40,y87 in the game's own 512x384
    const s = c.width / 512;
    const d = c
      .getContext("2d")!
      .getImageData(30 * s, 75 * s, 240 * s, 120 * s).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4)
      if (d[i + 1] > 140 && d[i] < 130 && d[i + 2] < 130) n++;
    return n;
  });
let dossier = 0;
for (let i = 0; i < 25 && dossier < 200; i++) {
  dossier = await inPanel();
  if (dossier < 200) await page.waitForTimeout(200);
}
if (dossier < 200)
  fail(
    `the pan's panel should carry the dossier 0x45e520 writes; ${dossier} green pixels in it`,
  );
console.log(
  `ok    and the panel it slides in carries the dossier — ${dossier} green pixels of it`,
);

if (!(await until(/frame 58\/59/)))
  fail(`rtpan.mov should end waiting on its accept button`);
// ...and the menu page's own error line is read HERE, while the menu page is
// still the one drawing: accepting the chooser hands the canvas to the level.
{
  const err = (await page.textContent("#err")) ?? "";
  if (err.trim()) problems.push(`#err: ${err}`);
}

await at(ACCEPT);
/**
 * ...and the game starts HERE, on this page.
 *
 * This used to wait for the string `walk.html` to appear in the front end's own
 * status line, because accepting the chooser navigated there. It does not any
 * more: `begin` puts the chooser's two answers in the query string with
 * `replaceState`, stops this page's frame loop, hands the canvas over and
 * imports the level runner. So what proves the chooser started the game is the
 * level's own HUD, and the front end's status line goes quiet because the front
 * end is no longer drawing anything.
 */
{
  const level = page.locator("#hud");
  let started = false;
  for (let i = 0; i < 120 && !started; i++) {
    started = /room \d+ of \d+/.test(
      (await level.textContent().catch(() => "")) ?? "",
    );
    if (!started) await page.waitForTimeout(500);
  }
  if (!started)
    fail(
      `accepting the chooser should start the game in this page; #hud says "${(await level.textContent().catch(() => "")) ?? ""}"`,
    );
}
const url = page.url();
console.log(`after accepting: ${url.replace(/^.*?(?=\/walk)/, "")}`);
if (!/char=1/.test(url)) {
  fail(
    `rtpan.mov names its frame 1 as actionframe TWO, which is character 1 (0x45e374); the url says ${url}`,
  );
}
// ...and the page it reached is wearing that player.
//
// Read, not WAITED FOR: the level's status line is the bench's, and on this page
// it is created hidden (`handOver` in src/main.ts — a paragraph of coordinates
// under the picture of a game somebody is playing is the bench leaking onto the
// front door). `waitFor` wants it visible and would sit out its ninety seconds;
// `textContent` reads an element that is merely attached, which is all this has
// ever needed — and the loop above has already established that the level ran.
const hud = page.locator("#hud");
const wearing = (await hud.textContent()) ?? "";
if (!/· char 1/.test(wearing))
  fail(
    `walk.html should be playing character 1; the panel says ${/· char \d/.exec(wearing)?.[0]}`,
  );
const cels = /· cel (\d+)/.exec(wearing)?.[1];
if (!cels || Number(cels) < 5000)
  fail(`character 1 wears the 5xxx cels; it is standing on ${cels}`);
console.log(`ok    and walk.html is playing character 1, on cel ${cels}`);

if (problems.length) fail(problems.join(" | "));

console.log(
  "PASS — logo → intro → menu, Prefs answers, Begin asks which player, and the answer starts the game",
);
await finish(browser);
