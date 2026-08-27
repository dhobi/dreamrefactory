/**
 * The 1996 demo, in a real browser — the edition with no room in it.
 *
 * Everything else this page runs opens a SET: the full game's boot activates
 * `bedsit1` before the logos roll, so `host.viewer` exists from the first second
 * and every input path could ask for one and be answered. The demo never opens
 * a set at all. Its BOOTFILE plays `open.mov` and then `demo.stg`, a menu that
 * is a stage flat with four portholes on it, and `host.viewer` is null for the
 * whole life of the page.
 *
 * So the page's three input gates — the keyboard's, the mouse's, the finger's —
 * and the row of controls under the canvas were all conditioned on something
 * this edition never produces, and the demo arrived with no keys, no clicks and
 * no bug button (#299). None of that is visible in the headless suite, because
 * the gates are the PAGE's and not the engine's: `taoot/tests/auto/regression.ts`
 * boots the demo to its menu and passes either way. It takes a browser.
 *
 * Run against a dev server:
 *
 *   npm run dev:taoot &
 *   npx tsx taoot/tests/browser/demo.ts          # APP_URL to point elsewhere
 *   HEADED=1 npx tsx taoot/tests/browser/demo.ts # ...and watch it
 */
import { chromium, Page } from "playwright";
import { clickIntroYes, playUrl } from "./driver";

const OUT = process.env.SHOT_DIR ?? "out";
const HEADED = !!process.env.HEADED;

/**
 * How long the menu may take to arrive after ESC.
 *
 * open.mov runs **31.4 s** across its four segments — timed in this browser, not
 * added up from the file, because the two differ and the wall clock is the thing
 * being measured here (its authored holds come to 27.6 s, and a frame that waits
 * out `punch.01` accounts for most of the rest; see df/mov-pace.ts). So anything
 * under this budget is the key having landed rather than the film having
 * finished, which is the only way to tell those two apart from outside. Well
 * under it and still loose for a loaded machine: the gap is 31.4 s against ~0.2.
 */
const FILM_BUDGET_MS = 10_000;

/** the demo is an edition of its own, not a language — see taoot/src/editions.ts */
const url = (): string => {
  const u = playUrl(process.env.APP_URL);
  u.searchParams.set("edition", "demo");
  return u.toString();
};

let failures = 0;
function check(what: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "  ok  " : " FAIL "} ${what}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

interface DemoState {
  viewer: boolean;
  stage: string;
  flat: string;
  movie: boolean;
  movieFile: string | null;
  buttons: string[];
}

const state = (page: Page): Promise<DemoState> =>
  page.evaluate(() => {
    const d = (window as unknown as { dbg: any }).dbg;
    const s = d.session;
    return {
      viewer: !!d.viewer,
      stage: s.stageName,
      flat: s.currentFlat,
      movie: !!d.host.director.moviePlaying,
      movieFile: d.host.director.movieFile ?? null,
      buttons: s.stageCtrl.flatButtonNames(s.currentFlat),
    };
  });

/** wait for a predicate over the page, returning whether it came true */
async function until(
  page: Page,
  what: string,
  fn: (s: DemoState) => boolean,
  timeout = 60_000,
): Promise<boolean> {
  const deadline = Date.now() + timeout;
  for (;;) {
    if (fn(await state(page))) return true;
    if (Date.now() > deadline) {
      console.log(`  (timed out waiting for ${what}: ${JSON.stringify(await state(page))})`);
      return false;
    }
    await page.waitForTimeout(200);
  }
}

/** canvas-pixel coordinates as page coordinates */
async function pagePoint(page: Page, x: number, y: number): Promise<{ px: number; py: number }> {
  return page.evaluate(
    ([cx, cy]: number[]) => {
      const c = document.getElementById("screen") as HTMLCanvasElement;
      const r = c.getBoundingClientRect();
      return {
        px: r.left + ((cx + 0.5) / c.width) * r.width,
        py: r.top + ((cy + 0.5) / c.height) * r.height,
      };
    },
    [x, y],
  );
}

/** click at canvas-pixel coordinates, through a real mouse event */
async function canvasClick(page: Page, x: number, y: number): Promise<void> {
  const pt = await pagePoint(page, x, y);
  await page.mouse.click(pt.px, pt.py);
}

/** ...and move there, which is a different event and a different code path */
async function canvasMove(page: Page, x: number, y: number): Promise<void> {
  const pt = await pagePoint(page, x, y);
  await page.mouse.move(pt.px, pt.py);
}

const main = async (): Promise<void> => {
  /**
   * A deployment need not carry the demo — it is a separate rip, and the CI
   * runner is told which editions it has rather than required to have them all
   * (`.github/workflows/tests.yml` prints "editions present"). An absent one is
   * a SKIP and not a failure, and it is asked for by the file the boot cannot
   * start without, so the answer is about this edition and not about the server.
   */
  // `../` off the play page, so this is the GAME's root and not the host's — the
  // deployed tree is a subdirectory (`/dreamrefactory/taoot/`) and an origin-
  // relative path would ask the wrong place and skip on every real deployment
  const boot = new URL("../gamefiles/demo/data/bootfile", playUrl(process.env.APP_URL));
  const there = await fetch(boot, { method: "HEAD" })
    .then((r) => r.ok)
    .catch(() => false);
  if (!there) {
    console.log(`skipped: no demo rip served at ${boot}`);
    return;
  }

  const browser = await chromium.launch({ headless: !HEADED });
  const page = await browser.newPage({ viewport: { width: 1400, height: 1100 } });
  page.on("pageerror", (e) => console.log("[pageerror]", e.message));
  await page.goto(url());
  await page.waitForFunction(() => !!(window as unknown as { dbg: any }).dbg?.host, null, {
    timeout: 30_000,
  });

  // The ownership question blocks the boot and carries no skip flag, so it is
  // answered rather than escaped (see clickIntroYes). It is not on every
  // deployment, so its absence is not a failure.
  const asked = await page
    .waitForFunction(() => !!(window as unknown as { dbg: any }).dbg.intro, null, { timeout: 20_000 })
    .then(() => true)
    .catch(() => false);
  if (asked) await clickIntroYes(page);

  // ---- the film, and ESC -------------------------------------------------
  // Prove the probe is looking at a film before claiming a key ended one — a
  // check that asserts "the movie stopped" passes on a page where it never
  // started.
  check("open.mov is playing", await until(page, "the opening film", (s) => s.movie));
  const before = await state(page);
  check(
    "and this edition has no room behind it, which is the whole of the bug",
    !before.viewer,
    `viewer=${before.viewer} stage=${before.stage}`,
  );

  // Against the CLOCK, because "the film stopped" is not evidence: open.mov ends
  // by itself, and a probe that waits for it to has measured nothing. It is four
  // segments and 31.4 s of film, so a menu that arrives inside FILM_BUDGET_MS did
  // not get there by the film running out. With the key dropped it takes the full
  // 31.4 s; with the key delivered, ESC clears the next-segment pointer and the
  // whole chain ends at once.
  const pressedAt = Date.now();
  await page.keyboard.press("Escape");
  const menu = await until(
    page,
    "the demo's menu stage",
    (s) => s.stage === "demo.stg" && s.flat !== "none",
    FILM_BUDGET_MS,
  );
  const took = Date.now() - pressedAt;
  const atMenu = await state(page);
  check(
    `ESC cuts the opening films short (${(took / 1000).toFixed(1)} s, and they run 31.4 s)`,
    menu,
    `stage=${atMenu.stage} flat=${atMenu.flat}`,
  );
  check(
    "with the four portholes demo.stg draws",
    atMenu.buttons.length === 4,
    `buttons=${atMenu.buttons.join(",")}`,
  );
  check("and still with no viewer, so nothing below is a room's doing", !atMenu.viewer);

  // ---- the chrome under the canvas ---------------------------------------
  const bug = await page.$("#bugBtn");
  check("the bug button is on the page", !!bug);
  check("...and visible", !!bug && (await bug.isVisible()));

  // ---- a click on the menu -----------------------------------------------
  // The LEFT porthole, `trailer`, and not the middle one: both prove the click
  // arrived, but the middle one is `dodemo` and starts the whole demo (main.stg,
  // a room, a viewer), which would make every claim below it ambiguous. The
  // trailer's mousedown opens the porthole on its own view and runs `domovie`,
  // so the outcome is one named film and then the menu again.
  //
  // Asserting the FILM, not that something moved: a click that reaches the canvas
  // and does nothing would satisfy a difference test on a page still broken.
  const target = await page.evaluate(() => {
    const s = (window as unknown as { dbg: any }).dbg.session;
    const r = s.stageCtrl
      .currentFlatRegions()
      .find((x: { name: string }) => x.name.toLowerCase() === "trailer");
    return r ? { x: Math.round((r.left + r.right) / 2), y: Math.round((r.top + r.bottom) / 2) } : null;
  });
  check("the trailer porthole has a region to click", !!target, JSON.stringify(target));
  if (target) {
    // The cursor first, and through the PAGE's own mousemove rather than by
    // calling the director — the wiring is what is on trial, so a probe that
    // reaches past it proves nothing. The region's setcursor answers "touch", and
    // `showCursor` puts that on the canvas as a CSS cursor.
    await canvasMove(page, target.x, target.y);
    await page.waitForTimeout(400);
    const cursor = await page.evaluate(
      () => (document.getElementById("screen") as HTMLCanvasElement).style.cursor,
    );
    check(
      "hovering it dresses the pointer as the touch cursor",
      /url\(/.test(cursor),
      `cursor=${JSON.stringify(cursor.slice(0, 40))}`,
    );

    await canvasClick(page, target.x, target.y);
    const played = await until(
      page,
      "the trailer to start",
      (s) => (s.movieFile ?? "").toLowerCase() === "trailer.mov",
      30_000,
    );
    const after = await state(page);
    check(
      "clicking it runs the flat's own mousedown, and the trailer plays",
      played,
      `movie=${after.movieFile} stage=${after.stage}`,
    );
    // ...and the film it started is skippable by the same key, from the same
    // no-room screen — the two halves of the report, met in one gesture
    if (played) {
      await page.keyboard.press("Escape");
      check(
        "and ESC gets back out of it",
        await until(page, "the trailer to end", (s) => !s.movie, 20_000),
      );
    }
  }

  const c = await page.$("#screen");
  if (c) await c.screenshot({ path: `${OUT}/demo-menu.png` });
  console.log(`\n${failures ? `${failures} check(s) FAILED` : "all checks passed"}`);
  await browser.close();
  process.exit(failures ? 1 : 0);
};

void main();
