/**
 * Does the renderer ever skip a frame it should have drawn?
 *
 *   npm run dev
 *   npx tsx tests/browser/repaint.ts            # boot, sit still, poke around
 *   REPAINT_CHECK=1 npm run test:browser:m0     # ride along with a real route
 *
 * `SetViewer.render` decides whether to composite by hashing what the picture
 * is drawn from ({@link SetViewer.buildSignature}). That hash is the one place
 * the optimisation can be WRONG rather than merely slow: an input it does not
 * read is an input that can change without the screen following, and the
 * symptom is a game that looks frozen with nothing in any log.
 *
 * So this does not reason about the hash — it checks it against the pixels.
 * On every frame the renderer declines to draw, the probe photographs the
 * canvas, forces the composite the renderer just skipped, photographs it
 * again, and compares. A difference is a frame the player should have seen and
 * did not. Running clean over a whole route is the evidence that a signature
 * covering ~30 fields of two runtimes, a puppet and a movie is complete.
 *
 * Note what this costs: with the probe installed EVERY frame composites (twice,
 * plus two `getImageData` reads), so a checked run is slower than an unchecked
 * one and says nothing at all about performance. It is a correctness harness
 * wearing the shape of a performance one.
 *
 * ## Reading a miss
 *
 * `moved` separates the two ways the pixels can disagree. The probe's own two
 * photographs are microseconds apart, and a few things the renderer draws are
 * genuinely time-based over that interval — a spoken line's lip-sync record,
 * the tick floor under a held answer row. So when a diff turns up the probe
 * re-hashes: if the signature ALSO moved between the two shots, the state
 * changed underneath the measurement and the next frame would have drawn it
 * anyway. A miss with `moved: false` is the real thing — same inputs, different
 * picture, which means an input the hash cannot see.
 */
import { chromium, type Page } from "playwright";
import { appUrl } from "./driver";

export interface RepaintMiss {
  /** rAF frame number within the checked run */
  frame: number;
  /** how many pixels the skipped composite would have changed */
  pixels: number;
  /** did the signature move between the probe's two photographs? see above */
  moved: boolean;
  /** enough of the engine's state to know which render path was in play */
  where: string;
}

export interface RepaintReport {
  frames: number;
  skipped: number;
  misses: RepaintMiss[];
}

/**
 * The probe, as an init script — it has to survive two things.
 *
 * A `changeset` builds a whole new SetViewer, so it patches the PROTOTYPE and
 * not the instance, or it would go quiet exactly when the game moved somewhere
 * new. And the playthrough harness RE-NAVIGATES between segments to load a
 * checkpoint, which wipes both the patch and its counters — the first version
 * of this was installed once after boot and reported "0 frames, 0 skipped"
 * over a five-segment run, i.e. it silently checked nothing. So it runs on
 * every document (`addInitScript`), waits for `dbg.viewer` to exist, and keeps
 * its tally in sessionStorage, which is what survives a same-tab navigation.
 */
const INSTALL = `(() => {
  const KEY = "__repaint_tally";
  let R;
  try { R = JSON.parse(sessionStorage.getItem(KEY)); } catch (e) { R = null; }
  if (!R) R = { frames: 0, skipped: 0, misses: [] };
  window.__repaint = R;
  const save = () => { try { sessionStorage.setItem(KEY, JSON.stringify(R)); } catch (e) {} };
  window.addEventListener("pagehide", save);
  window.addEventListener("beforeunload", save);

  const patch = () => {
  const v = window.dbg && window.dbg.viewer;
  if (!v) return false;
  const proto = Object.getPrototypeOf(v);
  if (proto.__repaintProbed) return true;
  proto.__repaintProbed = true;
  const origRender = proto.render;
  const origPaint = proto.paint;
  let painted = false;
  proto.paint = function (ctx) {
    painted = true;
    return origPaint.call(this, ctx);
  };
  proto.render = function (ctx) {
    R.frames++;
    painted = false;
    origRender.call(this, ctx);
    if (painted) return;
    R.skipped++;
    const w = ctx.canvas.width, h = ctx.canvas.height;
    const before = ctx.getImageData(0, 0, w, h).data;
    const sigBefore = this.buildSignature(ctx);
    const lo = sigBefore.lo, hi = sigBefore.hi;
    origPaint.call(this, ctx); // the frame the player did not get
    const after = ctx.getImageData(0, 0, w, h).data;
    let pixels = 0;
    for (let i = 0; i < before.length; i += 4) {
      if (before[i] !== after[i] || before[i + 1] !== after[i + 1] || before[i + 2] !== after[i + 2]) pixels++;
    }
    if (!pixels) return;
    const sigAfter = this.buildSignature(ctx);
    const s = this.session;
    R.misses.push({
      frame: R.frames,
      pixels,
      moved: sigAfter.lo !== lo || sigAfter.hi !== hi,
      where: [
        "set=" + (s.currentSetFile || "-"),
        "flat=" + (s.currentFlat || "-"),
        "setVisible=" + s.setVisible,
        "movie=" + (this.movies.playingFile || "-") + "@" + this.movies.framePos,
        "puppet=" + !!(s.puppet && s.puppet.visible),
        "fade=" + s.fade.level,
        "busy=" + s.scriptBusy,
      ].join(" "),
    });
    save(); // a miss must reach the report even if the page navigates next
  };
  return true;
  };
  const iv = setInterval(() => { if (patch()) clearInterval(iv); }, 50);
})()`;

/**
 * Arm the probe for the whole session. Call BEFORE the first `goto` — it is an
 * init script, so it only covers navigations that happen after it is added.
 */
export async function installRepaintProbe(page: Page): Promise<void> {
  await page.addInitScript(INSTALL);
}

export async function readRepaintProbe(page: Page): Promise<RepaintReport> {
  return (await page.evaluate(
    `(window.__repaint ? { frames: window.__repaint.frames, skipped: window.__repaint.skipped, misses: window.__repaint.misses } : { frames: 0, skipped: 0, misses: [] })`,
  )) as RepaintReport;
}

/**
 * Report a probe's findings the way the browser suite reports everything else:
 * a line per real miss, and a count. Returns the number of FAILURES, so a
 * caller can fold it into its own verdict — `moved` misses are printed but not
 * counted, since they are the measurement moving, not the renderer.
 */
export function reportRepaint(r: RepaintReport, label = "repaint"): number {
  const real = r.misses.filter((m) => !m.moved);
  const raced = r.misses.length - real.length;
  console.log(
    `${label}: ${r.frames} frames, ${r.skipped} skipped (${((r.skipped / Math.max(1, r.frames)) * 100).toFixed(0)}%), ` +
      `${real.length} stale` + (raced ? `, ${raced} raced the probe` : ""),
  );
  for (const m of real.slice(0, 20)) {
    console.error(`  STALE frame ${m.frame}: ${m.pixels} px would have changed — ${m.where}`);
  }
  if (real.length > 20) console.error(`  … and ${real.length - 20} more`);
  return real.length;
}

/**
 * Standalone: boot, sit still, then do the things that move the screen without
 * a route to drive them — turn, look around, toggle the hotspot overlay, open
 * the map. Enough to catch a signature that has forgotten the camera or the
 * view; the real coverage (movies, conversations, walks, fades, the inventory)
 * comes from `REPAINT_CHECK=1` over a playthrough segment.
 */
async function main(): Promise<void> {
  const browser = await chromium.launch({ headless: !process.env.HEADED });
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await installRepaintProbe(page);
  await page.goto(appUrl());
  await page.waitForFunction("window.dbg && window.dbg.viewer", null, { timeout: 120_000 });
  await page
    .waitForFunction("window.dbg.viewer && window.dbg.viewer.quiescent", null, { timeout: 180_000 })
    .catch(() => console.log("(never went quiescent — checking anyway)"));

  const settle = () => page.waitForTimeout(1200);
  await page.waitForTimeout(3000); // the still screen, which is the whole point
  for (const key of ["ArrowRight", "ArrowRight", "ArrowLeft", "ArrowUp", "o", "m", "m", "o"]) {
    await page.keyboard.press(key);
    await settle();
  }
  await page.mouse.move(200, 200);
  await settle();

  const failures = reportRepaint(await readRepaintProbe(page));
  if (errors.length) console.error("page errors:\n  " + errors.join("\n  "));
  await browser.close();
  process.exit(failures || errors.length ? 1 : 0);
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop()!)) void main();
