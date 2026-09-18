/**
 * Does the interface panel show what `SC.EXE`'s panel shows?
 *
 *   npm run dev -w skullcracker              # in one terminal
 *   npm run test:browser:hud -w skullcracker # in another
 *
 * The panel is `skullcracker/src/hud.ts`, and its module comment carries the
 * addresses every coordinate came out of. What can be asserted from outside is
 * not the coordinates — those are the disassembly's word — but that the thing is
 * WIRED: that the bands are painted, that the level is confined to the window
 * between them, that Ctrl+P puts it back the way the original's help screen says
 * it does, that a held key lights its own light, and that hitting something
 * drains the bar it claimed and pays for it in the score.
 *
 * Everything here reads PIXELS off the canvas, because that is the only thing
 * the page promises. A count of green in a rectangle is a crude instrument and
 * a deliberate one: it survives a repaint, a repalette and a rewrite of the
 * drawing order, and it fails the moment a region stops being drawn.
 */
import { type Page } from "playwright";
import { BASE, fail, finish, launch } from "./harness";

/** how many pixels in a rectangle pass a channel test, off the live canvas */
const count = (
  page: Page,
  box: [number, number, number, number],
  kind: "green" | "red" | "lit",
): Promise<number> =>
  page.evaluate(
    ([x0, y0, x1, y1, kind]) => {
      const c = document.getElementById("screen") as HTMLCanvasElement;
      const d = c.getContext("2d")!.getImageData(x0, y0, x1 - x0, y1 - y0).data;
      let n = 0;
      for (let i = 0; i < d.length; i += 4) {
        const [r, g, b] = [d[i], d[i + 1], d[i + 2]];
        if (kind === "green" && g > 140 && r < 130 && b < 130) n++;
        if (kind === "red" && r > 140 && g < 90 && b < 110) n++;
        if (kind === "lit" && r + g + b > 150) n++;
      }
      return n;
    },
    [box[0], box[1], box[2], box[3], kind] as const,
  );

const main = async (): Promise<void> => {
  const browser = await launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on("pageerror", (e) => fail(`page threw: ${e.message}`));

  await page.goto(`${BASE}/walk.html?level=1`);
  const hud = page.locator("#hud");
  await hud.filter({ hasText: /room \d+ of \d+/ }).waitFor({ timeout: 30_000 });
  await page.waitForTimeout(400);

  // 1. both bands are there. The upper one carries the two health bars, so red
  //    on the left and green on the right is the bar pair being drawn at all.
  const red = await count(page, [0, 8, 200, 22], "red");
  const green = await count(page, [300, 8, 512, 22], "green");
  if (red < 300) fail(`the player's bar is ${red} red pixels — cel 11500 is not being drawn`);
  if (green < 300) fail(`the enemy's bar is ${green} green pixels — cel 11501 is not being drawn`);
  console.log(`ok    the bars are drawn: ${red} red left, ${green} green right`);

  // the lower band's own furniture: the four green labels and the kill quota's
  // two numerals, each in the rect SC.EXE clips them to
  const labels = await count(page, [110, 290, 200, 370], "green");
  const quota = await count(page, [452, 326, 512, 384], "green");
  if (labels < 200) fail(`the lower band is not drawn — ${labels} green pixels where JUMP/KICK/PUNCH/INV. are`);
  if (quota < 20) fail(`the kill quota's digits are missing — ${quota} green pixels in 326,452-384,512`);
  console.log(`ok    the lower band and its quota are drawn (${labels}, ${quota} green)`);

  // 2. the level is confined to the window, and Ctrl+P gives it the screen back.
  //    The pad's corner is band pixels now and level pixels after the toggle, so
  //    the two readings simply have to differ.
  const padBefore = await count(page, [20, 290, 100, 370], "lit");
  await page.keyboard.press("Control+p");
  await page.waitForTimeout(200);
  const padAfter = await count(page, [20, 290, 100, 370], "lit");
  if (padBefore === padAfter) fail(`Ctrl+P changed nothing at the pad — the panel is not a mode`);
  const barAfter = await count(page, [0, 8, 200, 22], "red");
  if (barAfter >= red) fail(`the health bar survived Ctrl+P (${barAfter} red) — full screen still draws the panel`);
  console.log(`ok    Ctrl+P is a mode: the pad reads ${padBefore} lit with the panel and ${padAfter} without`);
  await page.keyboard.press("Control+p");
  await page.waitForTimeout(200);

  // 3. a held key lights its own light — the pad's arrow and the label both
  const idle = {
    arrow: await count(page, [82, 316, 102, 340], "lit"),
    kick: await count(page, [118, 306, 190, 322], "lit"),
  };
  await page.keyboard.down("ArrowRight");
  await page.keyboard.down("k");
  await page.waitForTimeout(200);
  const down = {
    arrow: await count(page, [82, 316, 102, 340], "lit"),
    kick: await count(page, [118, 306, 190, 322], "lit"),
  };
  await page.keyboard.up("k");
  await page.keyboard.up("ArrowRight");
  if (down.arrow === idle.arrow) fail(`holding right did not light the pad's right arrow (${idle.arrow} both ways)`);
  if (down.kick === idle.kick) fail(`holding K did not light the KICK label (${idle.kick} both ways)`);
  console.log(`ok    the buttons light: arrow ${idle.arrow}→${down.arrow}, KICK ${idle.kick}→${down.kick}`);

  // 4. a landed blow drains the bar its owner claimed, and pays for the kill.
  //    Walking east through STREETS with the fist out meets the first punk at
  //    x2197, and a punch is cel 602's own 47 against its 250 — so it takes six
  //    of them, and the bar must read part full somewhere along the way.
  const scoreAt = (): Promise<number> => count(page, [220, 22, 290, 35], "green");
  const scoreBefore = await scoreAt();
  let leanest = green;
  for (let i = 0; i < 40; i++) {
    await page.keyboard.down("ArrowRight");
    await page.waitForTimeout(200);
    await page.keyboard.up("ArrowRight");
    // three swings per step: the strike box is the fist's own two dozen pixels
    // (SbkCel.strike), not the whole cel, so a blow has to be aimed
    for (let k = 0; k < 3; k++) {
      await page.keyboard.press("p");
      await page.waitForTimeout(220);
    }
    leanest = Math.min(leanest, await count(page, [300, 8, 512, 22], "green"));
    if ((await scoreAt()) > scoreBefore) break;
  }
  if (leanest >= green) fail(`the enemy's bar never drained (${leanest} green at its leanest, ${green} full)`);
  console.log(`ok    a blow drains the bar: ${green} green full, ${leanest} at its leanest`);

  const scoreAfter = await scoreAt();
  if (scoreAfter <= scoreBefore) {
    fail(`the score never moved — ${scoreBefore} green pixels in the plate before, ${scoreAfter} after`);
  }
  console.log(`ok    and a kill pays: the score plate went from ${scoreBefore} to ${scoreAfter} green pixels`);

  // 5. the letters beside the eight buttons are TYPESET out of the key map, not
  //    painted into the band. `0x40cf00` finishes by calling `0x40e870(action)`
  //    for actions 1..8 and writing each name at its own point in `0x46bd58`,
  //    centred in a box fifteen wide — so what the band says is whatever the
  //    preferences panel last bound, and a panel with nothing bound says nothing.
  //
  //    The ink is `0x409a00`'s 0xe1, which is the same bright green the band's
  //    own JUMP/KICK/PUNCH/INV. are, so the count is taken in a box tight around
  //    one label and the empty reading below is what proves it is the label.
  const LABELS: Record<string, [number, number, number, number]> = {
    up: [56, 322, 76, 338],
    right: [70, 337, 90, 353],
    down: [56, 352, 76, 368],
    left: [39, 337, 59, 353],
    punch: [196, 344, 216, 360],
    kick: [196, 324, 216, 340],
    inv: [172, 364, 192, 380],
    jump: [172, 305, 192, 321],
  };
  const labelInk = async (): Promise<Record<string, number>> => {
    const out: Record<string, number> = {};
    for (const [name, box] of Object.entries(LABELS)) out[name] = await count(page, box, "green");
    return out;
  };
  const reload = async (): Promise<void> => {
    await page.goto(`${BASE}/walk.html?level=1`);
    await hud.filter({ hasText: /room \d+ of \d+/ }).waitFor({ timeout: 30_000 });
    await page.waitForTimeout(600);
  };
  const bind = async (keys: string[]): Promise<void> => {
    await page.evaluate((k) => {
      const raw = JSON.parse(localStorage.getItem("skullcracker.prefs") ?? "{}");
      raw.keys = k;
      localStorage.setItem("skullcracker.prefs", JSON.stringify(raw));
    }, keys);
    await reload();
  };
  await reload();
  const shipped = await labelInk();
  for (const [name, n] of Object.entries(shipped)) {
    if (n < 10) fail(`the ${name} button should carry its key's name; ${n} green pixels at 0x46bd58's point`);
  }
  console.log(`ok    the eight buttons are labelled: ${Object.entries(shipped).map(([k, v]) => `${k} ${v}`).join(", ")}`);

  // ...and with nothing bound there is nothing to say. `0x40e870` names no
  // character it cannot name, and six of the eight boxes hold no band green at
  // all, so those six have to read exactly zero.
  await bind(["", "", "", "", "", "", "", ""]);
  const bare = await labelInk();
  const speaking = Object.entries(bare).filter(([, n]) => n > 0).map(([k]) => k);
  if (speaking.length > 2) fail(`an unbound panel should say nothing; ${speaking.join(", ")} still have ink`);
  console.log(`ok    ...and an unbound panel says nothing: ${Object.values(bare).join(" ")}`);

  // ...and a rebinding changes what it says, which is the whole point of it
  await bind(["M", "N", "O", "Q", "R", "T", "U", "V"]);
  const rebound = await labelInk();
  if (Object.keys(LABELS).every((k) => rebound[k] === shipped[k])) {
    fail(`rebinding all eight changed no label — the band is painted, not typeset`);
  }
  console.log(`ok    and rebinding changes it: ${Object.values(rebound).join(" ")}`);
  // ...and put the shipped table back, so nothing downstream inherits this
  await page.evaluate(() => localStorage.removeItem("skullcracker.prefs"));

  await finish(browser);
  console.log(`PASS  the panel is the disc's art, wired to the page's own state`);
};

await main();
