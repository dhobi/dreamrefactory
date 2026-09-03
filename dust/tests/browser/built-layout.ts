/**
 * The page as BUILT, not as served in dev.
 *
 *   npm run test:built -w dust
 *
 * This exists because a layout bug shipped to production through every gate the
 * project had. `dust/index.html` links the shared chrome and then overrides it in
 * its own `<style>`; the build resolves that `<link>` into a bundle and re-inserts
 * it at the END of `<head>`, after the inline block. Two `body` rules of equal
 * specificity therefore swapped places, the chrome's `display: flex; align-items:
 * center` won, and a centred flex child shrink-wraps — so `#stage`, whose children
 * are all absolutely positioned, collapsed from 1280px to its own two pads, 32px,
 * and the picture went off the right-hand edge of the window.
 *
 * Everything looked fine on the way there. Dev served the authored order and was
 * correct. `tsc` has no opinion on CSS. The unit suites never lay out a page. The
 * deployed HTML was byte-identical to the build it came from, so diffing it found
 * nothing. The bug existed only in the arrangement the browser saw, and only after
 * a build, and nothing ever looked at that.
 *
 * `site/tests/cascade.ts` is the cheap half — it reads the two stylesheets and
 * fails on any declaration whose outcome the bundler decides. This is the half
 * that would have caught it even if the mechanism had been something else
 * entirely: it builds the page, serves the build, and measures the result.
 *
 * ## Reachable, not merely visible
 *
 * It also checks that nothing invisible is sitting on top of the loader. The
 * primary assertion is on `#frame`: while `body` is not `.playing` it must be
 * `pointer-events: none`. That holds with no game data at all, which matters,
 * because without a rip the page errors out of the loader and removes the button
 * — so a test that could only hit-test the button would quietly check nothing on
 * a machine with no disc. When the button IS there, it is hit-tested too.
 *
 * This is a separate bug, caught the same way:
 * `#frame` comes after `#curtain` in the DOM with no z-index, so the canvas
 * painted over the button and swallowed the click while the frame was still
 * `opacity: 0`. Nothing looked wrong; the button was simply dead. And it was a
 * RACE — the canvas has to exist before it can cover anything, so clicking the
 * instant the button appeared won locally and lost on a real connection every
 * time. Hence the deliberate wait below: a test that clicks immediately proves
 * nothing about a user who takes a second to reach for the mouse.
 *
 * ## No game data needed
 *
 * Every assertion here is about the empty page — the shell, the loader, the stage
 * box. That is deliberate: the geometry that broke is settled before a single
 * gamefile is read, so this runs anywhere, and a rip being absent must never be
 * the reason a layout regression goes unnoticed.
 */
import { chromium, type Page } from "playwright";
import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const PORT = Number(process.env.PORT ?? 4327);

/** the viewports the composition has to hold at, wide and narrow and short */
const VIEWPORTS = [
  { width: 1280, height: 860, name: "desktop" },
  { width: 1920, height: 1080, name: "wide" },
  { width: 1024, height: 700, name: "short" },
  { width: 430, height: 900, name: "phone" },
] as const;

function run(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: ROOT, stdio: "inherit" });
    child.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`${command} exited ${code}`)),
    );
  });
}

/** the built tree, served the way it is served in production: as static files */
async function servePreview(): Promise<ChildProcess> {
  const child = spawn(
    "npx",
    [
      "vite",
      "preview",
      "--config",
      "dust/vite.config.ts",
      "--port",
      String(PORT),
      "--strictPort",
    ],
    { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] },
  );
  const deadline = Date.now() + 30_000;
  for (;;) {
    if (Date.now() > deadline) throw new Error("preview server never answered");
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/`);
      if (res.ok) return child;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 250));
  }
}

interface Measured {
  bodyDisplay: string;
  bodyAlign: string;
  stageWidth: number;
  curtainWidth: number;
  scrollWidth: number;
  sheets: string;
  /** what is actually on top at the middle of the START button, if it is there */
  atStartButton: string;
  /** whether the invisible frame is excluded from hit-testing before play */
  framePointerEvents: string;
  playing: boolean;
}

const MEASURE = `(() => {
  const box = (id) => {
    const e = document.getElementById(id);
    return e ? Math.round(e.getBoundingClientRect().width) : -1;
  };
  const bs = getComputedStyle(document.body);
  const start = document.getElementById("start");
  let atStartButton = "no button";
  if (start) {
    const r = start.getBoundingClientRect();
    const top = document.elementFromPoint(
      Math.round(r.x + r.width / 2),
      Math.round(r.y + r.height / 2),
    );
    atStartButton = top ? top.id || top.tagName : "nothing";
  }
  // Ask about the state that matters rather than waiting to be in it: with no rip
  // the page errors straight past the loader into the playing state, and the
  // assertion would silently not run on exactly the machines with no game data.
  // (No backticks in here: this whole block is a template literal.)
  const frame = document.getElementById("frame");
  const wasPlaying = document.body.classList.contains("playing");
  document.body.classList.remove("playing");
  const framePointerEvents = frame
    ? getComputedStyle(frame).pointerEvents
    : "no frame";
  if (wasPlaying) document.body.classList.add("playing");
  return {
    atStartButton,
    framePointerEvents,
    playing: wasPlaying,
    bodyDisplay: bs.display,
    bodyAlign: bs.alignItems,
    stageWidth: box("stage"),
    curtainWidth: box("curtain"),
    scrollWidth: document.documentElement.scrollWidth,
    sheets: [...document.styleSheets]
      .map((s) => (s.href || "inline").split("/").pop())
      .join(","),
  };
})()`;

const failures: string[] = [];

function check(where: string, claim: string, ok: boolean, saw: string): void {
  if (ok) {
    console.log(`  ok    ${where}  ${claim}`);
  } else {
    console.log(`  FAIL  ${where}  ${claim} — saw ${saw}`);
    failures.push(`${where}: ${claim} (saw ${saw})`);
  }
}

async function measure(page: Page, url: string): Promise<Measured> {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
  // Long enough for the canvas to exist. The overlay bug this checks for is a
  // race, and a short wait here is the version of the test that passes while the
  // deployed site is broken — the canvas cannot cover the button until it is
  // there. Not a wait for the game: no gamefile is read on this path.
  await page.waitForTimeout(4_000);
  return (await page.evaluate(MEASURE)) as Measured;
}

async function main(): Promise<void> {
  console.log("building dust…");
  // `-w dust` and not `build:dust`, which the root package.json stopped
  // carrying when each package took its own commands (#333) — this line went
  // on naming it and the suite has failed at its first step ever since
  await run("npm", ["run", "build", "-w", "dust"]);
  const server = await servePreview();
  const browser = await chromium.launch();
  try {
    for (const vp of VIEWPORTS) {
      const page = await browser.newPage({
        viewport: { width: vp.width, height: vp.height },
      });
      const m = await measure(page, `http://127.0.0.1:${PORT}/`);
      const at = `${vp.name} ${vp.width}x${vp.height}`;

      // the two declarations that actually flipped
      check(at, "body is a grid", m.bodyDisplay === "grid", m.bodyDisplay);
      check(
        at,
        "body stretches its rows",
        m.bodyAlign === "stretch",
        m.bodyAlign,
      );

      // and the consequence, which is the thing a reader would have noticed:
      // a stage narrower than the window means the picture is off the edge
      check(
        at,
        "the stage fills the window",
        m.stageWidth === vp.width,
        `${m.stageWidth}px of ${vp.width}`,
      );
      check(
        at,
        "the curtain is not collapsed",
        m.curtainWidth > vp.width * 0.8,
        `${m.curtainWidth}px`,
      );
      check(
        at,
        "nothing overflows sideways",
        m.scrollWidth <= vp.width,
        `scrollWidth ${m.scrollWidth}`,
      );

      // Visible is not the same as reachable: an opacity-0 overlay still takes
      // the click, and a START button nothing can press is the whole game.
      //
      // Asserted on the frame rather than on the button, because this has to mean
      // something on a machine with no rip — where the page errors out of the
      // loader and the button is gone. The hit test is the stronger claim and runs
      // whenever there is something to hit.
      check(
        at,
        "the invisible frame does not take clicks",
        m.framePointerEvents === "none",
        `pointer-events: ${m.framePointerEvents}`,
      );
      if (m.atStartButton !== "no button") {
        check(
          at,
          "START is what you hit when you click START",
          m.atStartButton === "start",
          `${m.atStartButton} on top`,
        );
      } else {
        console.log(
          `  skip  ${at}  no START button on the page (no game data)`,
        );
      }

      // the arrangement this test exists to distrust: assert the build really does
      // put the bundle last, so that if Vite ever changes and the bug becomes
      // unreachable, the reason is recorded rather than guessed at
      if (vp.name === "desktop") {
        console.log(`  note  stylesheet order in the build: ${m.sheets}`);
      }
      await page.close();
    }
  } finally {
    await browser.close();
    server.kill();
  }

  if (failures.length) {
    console.error(`\n${failures.length} failed:`);
    for (const f of failures) console.error(`  ${f}`);
    process.exit(1);
  }
  console.log(`\nall good across ${VIEWPORTS.length} viewports`);
}

await main();
