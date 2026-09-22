/**
 * The board in the room, in a real browser.
 *
 * Run against a live dev server (`npm run dev -w taoot`):
 *
 *   npm run test:browser:board -w taoot
 *   HEADED=1 …                              # watch it
 *
 * It needs no rip: `/bedsit/` with no `gamefiles/` is plaster and three lamps,
 * and the board is painted rather than measured, so it is the same board.
 *
 * ## Why this suite exists
 *
 * `bedsit/src/bedsit-panel.ts` is the second view of the room's settings — the
 * one a headset can reach — and almost nothing about it can be checked without
 * a driver. It is a canvas painted into a texture, a quad in world space, and a
 * ray against a plane, and the three of them only agree on a real GPU. The
 * geometry of the RAY is checked without one, in `tests/auto/bedsit-xr.ts`,
 * because that is arithmetic. What is here is everything that is not:
 *
 * - that the board draws at all, which a wrong UV or a wrong winding fails;
 * - that the room is EXACTLY as it was after the board comes down, which is
 *   the whole of the state-borrowing question — the panel takes the room's
 *   program, its attribute arrays and its blend state, and a frame drawn after
 *   a bad restore looks fine until the next one does not;
 * - that a press on the board reaches the desk panel, and a drag of the desk
 *   panel reaches the board. Those two are the claim the store was extracted
 *   to make, and they are the only two that matter to somebody using it.
 *
 * ## Pixels, compared for being the SAME
 *
 * Screenshots are compared as bytes, and the comparison that carries the weight
 * is equality rather than difference: two PNGs of identical pixels are
 * identical files, so "the room came back exactly" is one `equals`. It holds
 * only while nothing in the room moves on its own, which is why the smoke is
 * turned off first — it is the one thing on this page that animates.
 */
import { chromium } from "playwright";

const HEADED = !!process.env.HEADED && process.env.HEADED !== "0";

const bedsitUrl = (): string => {
  const url = new URL(process.env.APP_URL ?? "http://localhost:5175/");
  url.pathname = url.pathname.replace(/(play\/?)?$/, "") + "bedsit/";
  return url.toString();
};

/**
 * The hooks the page puts on `window` for a console — or a suite — to drive it.
 *
 * Declared inside each `evaluate` rather than shared, because what crosses into
 * the page is the FUNCTION's source and nothing of this module: a type is erased
 * and a helper of ours would simply not be there.
 */
type Hooks = {
  ready: boolean; board: boolean; smoke: boolean; pitch: number; aimedRow: number;
  where: { x: number; y: number; z: number; yaw: number };
  stand(x: number, y: number, z: number, deg: number): void;
  hand(from: [number, number, number], dir: [number, number, number], pressed: boolean): boolean;
};
type WithHooks = { bedsit: Hooks };

async function main(): Promise<void> {
  const browser = await chromium.launch({ headless: !HEADED });
  const page = await browser.newPage({ viewport: { width: 900, height: 620 } });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`page: ${e.message}`));
  page.on("console", (m) => m.type() === "error" && errors.push(`console: ${m.text()}`));

  let bad = 0;
  const check = (ok: boolean, said: string): void => {
    if (!ok) bad++;
    console.log(`${ok ? "ok  " : "FAIL"} ${said}`);
  };

  const url = bedsitUrl();
  console.log(`opening ${url}`);
  await page.goto(url);

  await page.waitForFunction(
    () => document.querySelector("#splash")?.getAttribute("data-state") === "ready",
    null,
    { timeout: 300_000 },
  );
  await page.click("#load");
  await page.keyboard.press("Escape");            // past the intro
  await page.waitForFunction(
    () => (window as unknown as { bedsit?: { ready?: boolean } }).bedsit?.ready === true,
    null,
    { timeout: 300_000 },
  );

  /**
   * Somewhere with room in front, and a still room.
   *
   * The smoke is the one thing here that moves without being asked, and every
   * "the picture is exactly the same" below would be false sixty times a second
   * with it on. Turning it off is not hiding anything: it is drawn outside the
   * glass, behind the visitor from here.
   */
  await page.evaluate(() => {
    const b = (window as unknown as WithHooks).bedsit;
    b.smoke = false;
    b.stand(7000, 7000, 2479, 64);
  });
  await page.waitForTimeout(500);

  const shot = (): Promise<Buffer> => page.screenshot();
  const boardUp = (): Promise<boolean> =>
    page.evaluate(() => (window as unknown as WithHooks).bedsit.board);
  const aimedRow = (): Promise<number> =>
    page.evaluate(() => (window as unknown as WithHooks).bedsit.aimedRow);
  /** the middle of the screen is the pointer, so aiming is pitching the head */
  const pitchTo = async (pitch: number): Promise<void> => {
    await page.evaluate((p) => { (window as unknown as WithHooks).bedsit.pitch = p; }, pitch);
    await page.waitForTimeout(60);
  };
  /**
   * The pitch that puts the gaze on a given row — FOUND, not written down.
   *
   * It used to be a number in a comment, worked out from the board's own
   * measurements, and it was wrong twice in one afternoon: once when a row was
   * added and once when a second one was, because a row's angle depends on how
   * many rows there are. A suite that searches for the row cannot go stale that
   * way, and it fails loudly if the row cannot be found at all.
   *
   * The sweep runs top to bottom because the rows do, and the board is about
   * ±0.35 rad tall from an arm's length away.
   */
  const aimAtRow = async (row: number): Promise<number> => {
    for (let p = 0.40; p > -0.40; p -= 0.01) {
      await pitchTo(p);
      if (await aimedRow() === row) return p;
    }
    throw new Error(`no pitch put the gaze on row ${row}`);
  };
  const press = async (): Promise<void> => {
    await page.evaluate(() => {
      document.getElementById("gl")!.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    });
    await page.waitForTimeout(150);
  };
  const release = async (): Promise<void> => {
    await page.evaluate(() => dispatchEvent(new PointerEvent("pointerup", { bubbles: true })));
    await page.waitForTimeout(150);
  };
  const pendant = (): Promise<string> =>
    page.$eval('input[data-light="0"]', (i) => (i as HTMLInputElement).value);
  /**
   * The value a press was meant to produce, waited for rather than slept at.
   *
   * A press crosses two frames — the one that aims and the one that draws the
   * row again — and a fixed wait for that is too short on a busy machine and
   * wasted on an idle one. Five seconds to arrive, then whatever is actually
   * there, so a real failure still names the wrong number rather than "timeout".
   */
  const pendantBecomes = async (want: string): Promise<string> => {
    await page.waitForFunction(
      (w) => (document.querySelector('input[data-light="0"]') as HTMLInputElement).value === w,
      want,
      { timeout: 5_000 },
    ).catch(() => { /* say what it really is, below */ });
    return pendant();
  };

  // --- it is not there until it is asked for --------------------------------

  check(!(await boardUp()), "no board until it is asked for");
  const without = await shot();

  await page.keyboard.press("o");
  await page.waitForTimeout(300);
  check(await boardUp(), "O puts the board up");
  const withIt = await shot();
  check(!withIt.equals(without), "and it is drawn: the picture is not the one without it");

  // --- and the room is exactly as it was when it comes down -----------------

  await page.keyboard.press("o");
  await page.waitForTimeout(300);
  check(!(await boardUp()), "O takes it down again");
  /**
   * The one that would catch a bad restore.
   *
   * The board borrows the room's program, every one of its attribute arrays,
   * the texture on unit 0, the blend state and the depth test. Giving any of
   * them back wrong leaves a room that is subtly not the room — and the next
   * frame after that is where it shows, which is why this is compared against
   * a picture taken before the board had ever been drawn.
   */
  check((await shot()).equals(without), "and the room is EXACTLY the room it was before it went up");

  // --- a press on the board reaches the desk panel --------------------------

  await page.keyboard.press("o");
  await page.waitForTimeout(300);
  check((await pendant()) === "0", "the pendant is where the markup left it");

  /**
   * The top row, which is the pendant.
   *
   * The board hangs 1.15 m ahead and is 0.62 m wide at 512 × 632 pixels, so the
   * middle of its first row is `atan(TALL × (0.5 − 84/632) / 1.15 m)` above the
   * eye — about 13.7°. It is written out rather than imported because the panel
   * keeps its own measurements to itself, and a suite that read them would pass
   * whatever they were changed to: this number is the independent check that
   * the board is the size it says it is.
   */
  await aimAtRow(0);                     // the first row is the pendant
  await press();
  const held = await pendantBecomes("0.7");
  check(held === "0.7", `pressing the middle of its track sets the pendant (${held})`);
  await release();
  check((await pendant()) === held, "and letting go leaves it where it was put");

  // --- and a drag of the desk panel reaches the board -----------------------

  const before = await shot();
  await page.$eval('input[data-light="0"]', (i) => {
    const input = i as HTMLInputElement;
    input.value = "2.5";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.waitForTimeout(300);
  /**
   * The board is repainted by the store, not by the press.
   *
   * The picture differs for two reasons at once — the board's own row, and the
   * room brightening behind a ground that is 93% opaque — so this says only
   * that the change arrived. What it is NOT is a claim that the row was
   * repainted in isolation, which no screenshot of a translucent board can make.
   */
  check(!(await shot()).equals(before), "a slider moved on the desk panel reaches the board");

  // and the store is one store: the value the desk set is the value the board
  // will now be pressed against
  await aimAtRow(0);
  await press();
  const after = await pendantBecomes("0.7");
  await release();
  check(after === "0.7", `pressing the same spot gives the same value again (${after})`);

  // --- and the way a hand points at it, which is the headset's whole path ----

  /**
   * A controller's ray, without a controller.
   *
   * `bedsit.hand` is the same door the session uses — `Room.point` — so what is
   * checked here is the path a visitor in a headset actually takes: a ray from
   * somewhere that is NOT the eye, a row found under it, and a trigger taken.
   * None of it can be reached from a keyboard, and all of it shipped once
   * already with no pointer drawn on it because it had only ever been read.
   *
   * `aimedRow` is where the beam and the dot are drawn from, so a wrong row
   * here is a pointer in the wrong place there.
   */
  const handAt = async (
    above: number, press: boolean, side = 0,
  ): Promise<{ on: boolean; row: number }> =>
    page.evaluate(([up, down, across]) => {
      const b = (window as unknown as WithHooks).bedsit;
      const w = b.where;
      const U = 2479 / 1.6;
      const f = [Math.cos(w.yaw), Math.sin(w.yaw)];
      const r = [-Math.sin(w.yaw), Math.cos(w.yaw)];
      // a hand a quarter of a metre to the right and a third of a metre down,
      // which is about where one is when it is pointing at something
      const from: [number, number, number] = [
        w.x + r[0] * 0.25 * U, w.z - 0.35 * U, w.y + r[1] * 0.25 * U,
      ];
      const to = [
        w.x + f[0] * 1.15 * U + r[0] * (across as number),
        w.z + (up as number),
        w.y + f[1] * 1.15 * U + r[1] * (across as number),
      ];
      const dir: [number, number, number] = [to[0] - from[0], to[1] - from[1], to[2] - from[2]];
      const on = b.hand(from, dir, !!down);
      return { on, row: b.aimedRow };
    }, [above, press, side] as [number, boolean, number]);

  /** the height, above the eye, at which a hand's ray lands on a given row —
   *  searched for the same reason the pitch above is, and in the same spirit */
  const handHeightFor = async (row: number): Promise<number> => {
    for (let h = 700; h > -700; h -= 10) {
      if ((await handAt(h, false)).row === row) return h;
    }
    throw new Error(`no height put a hand's ray on row ${row}`);
  };

  // the board is still up from the section above — pressing O here would take
  // it down, and every ray below would then correctly hit nothing
  check(await boardUp(), "the board is still up for the hand to point at");
  const topH = await handHeightFor(0);
  const top = await handAt(topH, false);
  check(top.on && top.row === 0, `a hand's ray finds the first row (on=${top.on} row=${top.row})`);

  const lowH = await handHeightFor(7);
  const low = await handAt(lowH, false);
  check(low.on && low.row === 7 && lowH < topH,
    `and a lower ray finds a lower row (row=${low.row} at ${lowH} against ${topH})`);

  const off = await handAt(4000, false);
  check(!off.on && off.row === -2, `a ray past the top of it hits nothing (row=${off.row})`);

  /**
   * And the trigger, through the same door the session pulls it through.
   *
   * The pendant is moved somewhere else first, because it is already at 0.70
   * from the press above — and a check that cannot fail is not a check. The
   * ray is sent once without the trigger and once with it, which is the edge
   * the session detects rather than the level.
   */
  await page.$eval('input[data-light="0"]', (i) => {
    const input = i as HTMLInputElement;
    input.value = "1.5";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  check((await pendant()) === "1.5", "the pendant is moved off the value a hand would set");
  await handAt(topH, false);
  await handAt(topH, true);
  const byHand = await pendantBecomes("0.7");
  check(byHand === "0.7", `a hand's trigger sets the row it is on (${byHand})`);

  /**
   * A choice row, and the desk panel following it.
   *
   * The vignette is the one setting on this board that does nothing whatever on
   * a flat screen — there is no glide to be made ill by — so the only thing
   * that can be checked here is that the two views agree about it, which is
   * exactly the claim the store exists to make.
   *
   * Pressed to the LEFT of the cells, over the label, which the board takes as
   * "the next one" — see `press` in the panel. −250 units is about a quarter of
   * the board's width, which is left of the first cell wherever the cells are.
   */
  const vignetteRow = await handHeightFor(9);
  check((await page.$eval("#vignette", (i) => (i as HTMLSelectElement).value)) === "big",
    "the vignette starts where the markup left it");
  await handAt(vignetteRow, false, -250);
  await handAt(vignetteRow, true, -250);
  await page.waitForTimeout(200);
  const vig = await page.$eval("#vignette", (i) => (i as HTMLSelectElement).value);
  check(vig === "middle", `a choice pressed on the board moves the desk panel's select (${vig})`);

  await page.evaluate(() => { (window as unknown as WithHooks).bedsit.board = false; });
  check(!(await boardUp()), "and it can be put away through the hook a phone uses");

  check(errors.length === 0, `nothing threw (${errors.length ? errors.join("; ") : "clean"})`);

  await browser.close();
  console.log(bad === 0 ? "\nall checks passed" : `\n${bad} check(s) failed`);
  process.exit(bad === 0 ? 0 : 1);
}

void main();
