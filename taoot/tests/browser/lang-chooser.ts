/**
 * The language chooser in a real browser: a real mouse click on a stage region,
 * and then the question that matters — does the game actually read that
 * language's data?
 *
 * Run against a live dev server (`npm run dev`), with at least two language
 * directories under `gamefiles/`:
 *
 *   npx tsx taoot/tests/browser/lang-chooser.ts          # picks the second language
 *   LANG_PICK=de npx tsx taoot/tests/browser/lang-chooser.ts   # picks a specific one
 *   HEADED=1 …                                     # watch it
 *
 * It skips (exit 0, with a reason) when the install has fewer than two
 * languages: the screen only appears when there is something to choose, and a
 * single-language tree is a legitimate setup, not a failure.
 *
 * What the headless suite cannot check, and this does: the page's own wiring —
 * that the chooser comes up before the boot does, that a click on the canvas
 * reaches the stage's compiled `mousedown` through main.ts's event handlers, and
 * that every `gamefiles/` request the boot then makes comes from the chosen tree.
 */
import { chromium } from "playwright";
import { LANGUAGES } from "../../src/languages";
import { playUrl } from "./driver";

// the play page, and deliberately WITHOUT the `?edition=` that appUrl() pins:
// this suite is here to watch the chooser run
const APP_URL = playUrl().toString();
const HEADED = !!process.env.HEADED;
const OUT = process.env.SHOT_DIR ?? "out";

/** every /gamefiles/ request the page makes, and which language tree it is in */
const langOf = (url: string): string | null => {
  const m = /\/gamefiles\/([a-z]{2})\//i.exec(url);
  return m ? m[1].toLowerCase() : null;
};

const main = async (): Promise<void> => {
  const browser = await chromium.launch({ headless: !HEADED, slowMo: HEADED ? 250 : 0 });
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  page.on("pageerror", (e) => console.log("[pageerror]", e.message));

  const requested: string[] = [];
  page.on("request", (r) => requested.push(r.url()));

  // a fresh player: no remembered language, and no ?lang= to skip the screen
  await page.goto(APP_URL);
  await page.evaluate(() => window.localStorage.removeItem("taoot.lang"));
  await page.goto(APP_URL);
  // `dbg` exists from the first line of the module, so it is not the signal
  // that the manifest has been read — ask too early and every install looks
  // like a single-language one. Wait for the page to have got somewhere: a
  // language registered, the chooser up, or a boot that never needed to ask.
  // (A timeout is not a failure here; it falls through to the skip below.)
  await page
    .waitForFunction(
      () => {
        const d = (window as any).dbg;
        return (
          (d?.host.files.availableEditions().length ?? 0) > 0 ||
          d?.session.stageName === "lang.stg" ||
          !!d?.viewer
        );
      },
      null,
      { timeout: 60_000 },
    )
    .catch(() => {});

  const available: string[] = await page.evaluate(
    () => (window as any).dbg.host.files.availableEditions(),
  );
  if (available.length < 2) {
    console.log(
      `skip: ${available.length} language directory/ies under gamefiles/ (${available.join(", ") || "none"}) — ` +
        "the chooser only runs when there is a choice",
    );
    await browser.close();
    return;
  }

  // the stage is up, and it is the authored one
  await page.waitForFunction(
    () => (window as any).dbg.session.stageName === "lang.stg",
    null,
    { timeout: 20_000 },
  );
  const flat = await page.evaluate(() => (window as any).dbg.session.currentFlat);
  console.log(`chooser up: lang.stg / ${flat}, languages available: ${available.join(" ")}`);
  if (flat !== "choose") throw new Error(`expected the "choose" flat, got ${flat}`);
  await page.locator("#screen").screenshot({ path: `${OUT}/lang-chooser.png` });

  // pick one that isn't the default, so a wrong resolution can't pass by accident
  const target =
    process.env.LANG_PICK?.toLowerCase() ??
    available.find((c) => c !== "en") ??
    available[1];
  const region = await page.evaluate(
    (code: string) =>
      (window as any).dbg.session
        .currentFlatRegions()
        .find((r: { name: string }) => r.name.toLowerCase() === code) ?? null,
    target,
  );
  if (!region) throw new Error(`no button for ${target} on the chooser flat`);

  // a real mouse click at the middle of the region, in canvas pixels
  const point = await page.evaluate(
    ([x, y]: number[]) => {
      const c = document.getElementById("screen") as HTMLCanvasElement;
      const r = c.getBoundingClientRect();
      return { x: r.left + ((x + 0.5) / c.width) * r.width, y: r.top + ((y + 0.5) / c.height) * r.height };
    },
    [Math.round((region.left + region.right) / 2), Math.round((region.top + region.bottom) / 2)],
  );
  await page.mouse.click(point.x, point.y);
  const name = LANGUAGES.find((l) => l.code === target)?.name ?? target;
  console.log(`clicked ${target} (${name}) at ${Math.round(point.x)},${Math.round(point.y)}`);

  // the page acted on the button's script: the file source now reads that tree.
  // (The script's global is not what we wait on — closing the chooser deletes it,
  // so it is a signal that exists only for the moment between the two.)
  await page.waitForFunction(
    (code: string) => (window as any).dbg.host.files.activeEdition() === code,
    target,
    { timeout: 60_000 },
  );

  // from the choice onwards, every game file must come from the chosen tree.
  // Closing the chooser cold boots the game by itself — nothing to click.
  const mark = requested.length;
  await page.waitForFunction(() => !!(window as any).dbg.viewer, null, { timeout: 180_000 });
  await page.waitForTimeout(4000);

  const after = requested.slice(mark).map(langOf).filter((l): l is string => !!l);
  const wrong = [...new Set(after.filter((l) => l !== target))];
  const mine = after.filter((l) => l === target).length;
  console.log(`${after.length} language-tree requests after the choice, ${mine} from ${target}`);
  if (wrong.length) {
    throw new Error(`requests from the wrong language tree after choosing ${target}: ${wrong.join(", ")}`);
  }
  if (!mine) throw new Error(`nothing was read from gamefiles/${target}/ after choosing it`);

  await page.locator("#screen").screenshot({ path: `${OUT}/lang-chooser-booted.png` });
  console.log(`ok: ${target} chosen in the browser, and the game read only gamefiles/${target}/`);
  await browser.close();
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
