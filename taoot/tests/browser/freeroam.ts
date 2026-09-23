/**
 * Free roam in a real browser: the mode the page boots into, and a door opened
 * by a real click.
 *
 * Run against a live dev server (`npm run dev -w taoot -- --host`):
 *
 *   npx tsx taoot/tests/browser/freeroam.ts
 *   APP_URL=http://localhost:5175/ npx tsx taoot/tests/browser/freeroam.ts
 *   HEADED=1 …                                  # watch it
 *
 * What only a browser can answer is the wiring, and on this page that is the
 * whole of it: that `<meta name="start-mode">` reaches `coldBoot`, that the
 * option survives `boot()` writing `tour` from the menu movie, and that
 * `advancetour` really is the branch that runs. Everything downstream of the
 * flag — which doorway a hotspot opens, whether a refusal is detected — is
 * driven headlessly in `taoot/tests/auto/freeroam.ts` against a live session,
 * which is faster and says more.
 *
 */
import { chromium, type Page } from "playwright";

const ROOT = process.env.APP_URL ?? "http://localhost:5175/";
const HEADED = !!process.env.HEADED;
const page_ = (p: string): string => new URL(p, ROOT).toString();
const say = (s: string): void =>
  console.log(`     ${new Date().toISOString().slice(11, 19)} ${s}`);

let failures = 0;
const check = (what: string, ok: boolean, detail = ""): void => {
  console.log(`${ok ? "ok   " : "FAIL "} ${what}${ok || !detail ? "" : `: ${detail}`}`);
  if (!ok) failures++;
};

const global_ = (page: Page, name: string): Promise<unknown> =>
  page.evaluate((n) => (window as any).dbg.session.interp.globals.get(n), name);

/** wait out whatever the click started, as the page's own watcher does */
async function settle(page: Page, rounds = 240): Promise<void> {
  for (let i = 0; i < rounds; i++) {
    if (!(await page.evaluate(() => (window as any).dbg.session.scriptBusy))) return;
    await page.waitForTimeout(500);
  }
}

/**
 * Boot the page and wait for the TOUR to have landed.
 *
 * Not for a viewer: `coldBoot` opens the landing room as a host for the logos
 * before `boot()` has read the menu at all, so a viewer exists within a second
 * of the page opening and proves nothing. The intended outcome is the tour's own
 * room with the tour's own flag up, and waiting for exactly that is what stops
 * this suite measuring the first day by mistake.
 */
async function tourLanded(page: Page): Promise<void> {
  await page.waitForFunction(() => !!(window as any).dbg?.session?.interp, null, { timeout: 90_000 });
  say("booting — the tour button is pressed and the films escaped");
  await page.waitForFunction(
    () =>
      (window as any).dbg.session.currentSetName === "c73" &&
      Number((window as any).dbg.session.interp.globals.get("tour")) === 1,
    null,
    { timeout: 600_000 },
  );
  await settle(page);
}

/** where a hotspot is on the page, from the view's own object record */
async function hotspotPoint(page: Page, name: string): Promise<{ x: number; y: number } | null> {
  return page.evaluate((want) => {
    const c = document.getElementById("screen") as HTMLCanvasElement;
    const box = c.getBoundingClientRect();
    const dbg = (window as any).dbg;
    const view = dbg.viewer.scene.views[dbg.viewer.viewIdx];
    const obj = view.objects.find((o: any) => o.identifier.toLowerCase() === want);
    if (!obj) return null;
    const x = (obj.startRegionX + obj.endRegionX) / 2;
    const y = (obj.startRegionY + obj.endRegionY) / 2;
    return { x: box.left + ((x + 0.5) / c.width) * box.width, y: box.top + ((y + 0.5) / c.height) * box.height };
  }, name);
}

/**
 * Tap a hotspot with a FINGER, which is a different path and the one that broke.
 *
 * A touch pointer goes through TouchGestures, which holds the press back for
 * TAP_HOLD_MS to tell a tap from a swipe — so the game's handler runs later than
 * the gesture that caused it. A page that judged the door on `pointerdown` was
 * ahead of it, opened the door itself, and then watched the game's own
 * `setupprop` restart the animation from shut. Playwright's mouse cannot
 * reproduce that; a real touch pointer can.
 */
async function tap(page: Page, at: { x: number; y: number }): Promise<void> {
  const touch = await page.context().newCDPSession(page);
  const pt = [{ x: Math.round(at.x), y: Math.round(at.y), radiusX: 8, radiusY: 8, force: 1 }];
  await touch.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: pt });
  await page.waitForTimeout(60);
  await touch.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await touch.detach();
}

/**
 * How many times the door's own animation has been STARTED.
 *
 * The flicker is not visible in "is the door open" — both the bug and the fix
 * end with it open. What differs is how often `setupprop` ran: once when the
 * game and the page agree, twice when the page opened it and the game's own
 * handler then reset the prop and played it again. The prop's frame is the
 * readable trace of that, so the check watches the prop rather than the outcome.
 */
async function doorFrames(page: Page): Promise<number[]> {
  return page.evaluate(() => (window as any).__doorFrames ?? []);
}

/**
 * Record every frame the `door` prop is on, so a restart is visible.
 *
 * `setInterval` with an anonymous callback, and that is not a style choice: tsx
 * transpiles a NAMED function inside an `evaluate` callback with esbuild's
 * keep-names, which wraps it in a `__name()` helper that exists in Node and not
 * in the browser — so the page throws `__name is not defined` and the probe
 * looks like a broken page.
 */
async function watchDoor(page: Page): Promise<void> {
  await page.evaluate(() => {
    (window as any).__doorFrames = [];
    (window as any).__doorWatch = setInterval(() => {
      const prop = (window as any).dbg?.session?.propRuntime?.props?.get("door");
      const at = prop?.visible ? (prop.frame ?? prop.deg ?? 0) : -1;
      const seen = (window as any).__doorFrames as number[];
      if (seen[seen.length - 1] !== at) seen.push(at);
    }, 16);
  });
}

const main = async (): Promise<void> => {
  const browser = await chromium.launch({ headless: !HEADED, slowMo: HEADED ? 200 : 0 });
  const page = await browser.newPage({ viewport: { width: 1400, height: 1300 } });
  page.on("pageerror", (e) => console.log("[pageerror]", e.message));

  say("opening /freeroam/");
  await page.goto(page_("freeroam/?edition=en"));
  await tourLanded(page);
  say("the tour has landed");

  // --- the mode the page asked for ---------------------------------------
  check("the page boots into the tour, not the first day", Number(await global_(page, "tour")) === 1);
  check(
    "`advancetour` ran: the story is emptied",
    Number(await global_(page, "mission")) === -1 && Number(await global_(page, "phase")) === -1,
    `mission=${await global_(page, "mission")} phase=${await global_(page, "phase")}`,
  );
  const room = await page.evaluate(() => (window as any).dbg.session.currentSetName);
  check("...and it put us down where the tour starts", room === "c73", String(room));
  const cd = await page.evaluate(() => (window as any).dbg.session.mountedCd);
  check("...on the disc `setpath (2)` mounts", /2$/.test(String(cd)), String(cd));

  // the map is the tour's, handed over rather than found
  const mapUp = await page.evaluate(
    () => !!(window as any).dbg.session.propRuntime.props.get("map")?.visible,
  );
  check("the interface carries the map", mapUp);

  // --- the pane that is no part of this page ------------------------------
  const hiddenAtRest = await page.evaluate(() => (document.getElementById("details") as HTMLElement).hidden);
  await page.keyboard.press("x");
  await page.waitForTimeout(300);
  const hiddenAfterX = await page.evaluate(() => (document.getElementById("details") as HTMLElement).hidden);
  check("the Details column is not on this page", hiddenAtRest && hiddenAfterX);

  // --- a door the game refuses, opened by a real click --------------------
  say("to Conk's door");
  await page.evaluate(() => {
    (window as any).dbg.session.interp.globals.set("hallside", "star");
    return (window as any).dbg.session.runGlobal("changeset", ["hallb", "scene29", "view40"]);
  });
  await settle(page);
  const at = await page.evaluate(() => ({
    set: (window as any).dbg.session.currentSetName,
    view: (window as any).dbg.session.currentViewName(),
    pick: (window as any).roam?.pick()?.id,
  }));
  check("standing at B-59's door", at.set === "hallb" && at.view === "view40", JSON.stringify(at));
  check("and the page knows which doorway that is", at.pick === "hallb-b59", String(at.pick));

  const doorShut = await page.evaluate(
    () => !(window as any).dbg.session.propRuntime.props.get("door")?.visible,
  );
  check("the door is shut to begin with", doorShut);

  const point = await hotspotPoint(page, "door");
  check("the door hotspot is where the view says it is", !!point);
  await watchDoor(page);
  // a FINGER, not a mouse: the deferred press is what made the door flicker
  await tap(page, point!);
  await settle(page);
  await page.waitForTimeout(1500);
  const doorOpen = await page.evaluate(
    () => !!(window as any).dbg.session.propRuntime.props.get("door")?.visible,
  );
  check("a tap the game answers with a knock leaves the door open anyway", doorOpen);
  const note = (await page.textContent("#roamnote")) ?? "";
  check("...and the page says which doorway it stood up", note.includes("hallb-b59"), note);

  // the flicker itself: shut -> open, and never back to shut in between
  const frames = await doorFrames(page);
  const shutAgain = frames.indexOf(-1, frames.findIndex((f) => f >= 0));
  check(
    "...and it opens once, without the game's own press restarting it",
    shutAgain === -1,
    `door frames: ${JSON.stringify(frames)}`,
  );

  // ...and a door with no room behind it is left alone. D-19 on D deck has a
  // doorway (Claris stands in it) and no step, so opening it would show a wall.
  say("to D-19");
  await page.evaluate(() =>
    (window as any).dbg.session.runGlobal("changeset", ["halld", "scene69", "view79"]),
  );
  await settle(page);
  const before = await page.evaluate(
    () => !!(window as any).dbg.session.propRuntime.props.get("door")?.visible,
  );
  const d19 = await hotspotPoint(page, "knock");
  if (d19) await tap(page, d19);
  await settle(page);
  await page.waitForTimeout(1500);
  const after = await page.evaluate(
    () => !!(window as any).dbg.session.propRuntime.props.get("door")?.visible,
  );
  check("a door with no room behind it stays shut", !!d19 && !before && !after);
  check(
    "...and the page says so rather than opening it",
    ((await page.textContent("#roamnote")) ?? "").includes("no way through"),
    (await page.textContent("#roamnote")) ?? "",
  );

  // ...and the 1st Class Lounge, which needs both halves: the door opens like
  // any other, and then the step is taken for a ↑ the corridor eats.
  say("to the lounge");
  await page.evaluate(() => {
    (window as any).dbg.session.interp.globals.set("savedeck", "gstair2");
    return (window as any).dbg.session.runGlobal("changeset", ["lnghall", "scene10", "view12"]);
  });
  await settle(page);
  const lounge = await hotspotPoint(page, "door");
  if (lounge) await tap(page, lounge);
  await settle(page);
  await page.waitForTimeout(1500);
  check(
    "the lounge door opens — there IS a room behind it",
    await page.evaluate(() => !!(window as any).dbg.session.propRuntime.props.get("door")?.visible),
  );
  await page.keyboard.press("ArrowUp");
  await settle(page);
  await page.waitForTimeout(2000);
  const inLounge = await page.evaluate(() => (window as any).dbg.session.currentSetName);
  check("...and the step a tour refuses is taken", inLounge === "lounge1c", String(inLounge));

  // back to B-59 for the last one: the game's own ↑ walks you in
  say("back to B-59");
  await page.evaluate(() => {
    (window as any).dbg.session.interp.globals.set("hallside", "star");
    return (window as any).dbg.session.runGlobal("changeset", ["hallb", "scene29", "view40"]);
  });
  await settle(page);
  const back = await hotspotPoint(page, "door");
  if (back) await tap(page, back);
  await settle(page);
  await page.waitForTimeout(1500);
  await page.keyboard.press("ArrowUp");
  await settle(page);
  await page.waitForTimeout(1500);
  const inside = await page.evaluate(() => (window as any).dbg.session.currentSetName);
  check("↑ walks into B-59, by the game's own handler", inside === "b59", String(inside));

  await browser.close();
  console.log(failures ? `\nFAIL  ${failures} check(s)` : "\nall checks passed");
  process.exitCode = failures ? 1 : 0;
};

main().catch((e) => {
  console.log("the suite itself failed:", e);
  process.exitCode = 1;
});
