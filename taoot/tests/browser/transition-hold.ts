/**
 * Does anything paint the world while a transition is waiting for bytes? (#308)
 *
 *   npm run dev -w taoot
 *   npx tsx taoot/tests/browser/transition-hold.ts
 *
 * The headless suite can pin who owns the screen at the instant a load starts
 * (auto/regression.ts, "a stage swap does not un-black the screen while it
 * loads"), and that is the decision this is about — but it cannot see the
 * symptom, because a disk provider answers synchronously and no frame falls
 * inside the await. In a browser that await is a network fetch with the rAF loop
 * compositing throughout, which is where the reported flashes live:
 *
 *   - the boot, ESC'd through: the lit apartment between the menu film and the
 *     date caption, while `bedsit1.set` loads;
 *   - the map, opened for the first time: fade to black, the room you left
 *     painted over it again for as long as `map.stg` takes to arrive, then a
 *     snap back to black for `blacktoscreen` to ramp out of.
 *
 * So this measures COMPOSITES, not state. `ScreenDirector.paint` is the only
 * thing that puts pixels on the canvas, and `render` declines to call it while
 * the screen is held — so a sample per `render`, flagged with whether `paint`
 * actually ran, is the timeline of what the player saw. A composite whose owner
 * is `world` inside a transition window IS the flash; there is nothing to infer.
 *
 * Two things make the window real rather than raced. Playwright delays the
 * response for the file each leg is waiting on, which is what the reporter's
 * first-open latency does on a real connection and what a warm local dev server
 * never does. And each leg asserts its window was actually FOUND — endpoints
 * identified, frames inside it — because "no bad composite" is a negative, and a
 * negative passes trivially on a probe that observed nothing.
 */
import { writeFileSync } from "node:fs";
import { chromium, type Browser, type Page } from "playwright";
import { appUrl, clickIntroYes } from "./driver";

/** DUMP=<path>: every sample of both windows, for reading a run by hand */
const dump = (tag: string, rows: Sample[]): void => {
  const at = process.env.DUMP;
  if (!at) return;
  writeFileSync(`${at}.${tag}.txt`, rows.map((r) => `${r.n} paint=${r.painted?1:0} ${r.owner} lvl=${r.level} mov=${r.movie||"-"} set=${r.set||"-"} stg=${r.stage||"-"} vis=${r.setVisible?1:0}`).join("\n"));
};

/** how long the file each leg waits on is held back, in ms */
const STALL_MS = Number(process.env.STALL_MS ?? 1200);

/** one `ScreenDirector.render` call, as the probe records it */
interface Sample {
  /** rAF frame number within the run */
  n: number;
  /** did a composite actually happen, or was the screen held/unchanged? */
  painted: boolean;
  owner: "movie" | "puppet" | "faded" | "world" | "held";
  level: number;
  /** the playing clip, "" for none */
  movie: string;
  set: string;
  stage: string;
  /** is the room a layer of the picture at all (transtoflat hides it) */
  setVisible: boolean;
}

/**
 * How a gesture reaches the game: THROUGH `session.track`, which is what the
 * input path does with every dispatch it starts.
 *
 * Not a formality. `scriptBusy` counts tracked dispatches and nothing else, and
 * it is what tells `tickFade` a script is still talking — so an untracked
 * `transToFlat` looks, from the first await inside it, like a game sitting idle,
 * and every hold that waits for the script to fall quiet is lifted a frame after
 * it goes up. A probe driven that way measures its own shortcut.
 */
interface Driven {
  transToFlat: (n: string) => Promise<void>;
  track: <T>(p: Promise<T>, label?: string) => Promise<T>;
}

/**
 * The probe, as an init script.
 *
 * On the PROTOTYPE, for the reason repaint.ts gives: a `changeset` builds a new
 * viewer, and a probe bound to an instance goes quiet exactly when the game
 * moves. The director outlives both, but patching its class costs nothing extra
 * and cannot be wrong.
 *
 * `paint` is private to TypeScript and an ordinary method at runtime, which is
 * the whole reason this can be measured from outside at all.
 */
const INSTALL = `(() => {
  window.__holdProbe = { samples: [], frames: 0 };
  const R = window.__holdProbe;
  const patch = () => {
    const dir = window.dbg && window.dbg.host && window.dbg.host.director;
    if (!dir) return false;
    const proto = Object.getPrototypeOf(dir);
    if (proto.__holdProbed) return true;
    proto.__holdProbed = true;
    const origRender = proto.render, origPaint = proto.paint;
    let painted = false;
    proto.paint = function (ctx) { painted = true; return origPaint.call(this, ctx); };
    proto.render = function (ctx) {
      painted = false;
      origRender.call(this, ctx);
      const s = this.session;
      R.frames++;
      R.samples.push({
        n: R.frames,
        painted,
        owner: this.screenOwner(),
        level: s.fade.level,
        movie: this.movies.playingFile || "",
        set: s.currentSetFile || "",
        stage: s.stageName || "",
        setVisible: !!s.setVisible,
      });
      // a run is a few thousand frames; keep the tail bounded anyway
      if (R.samples.length > 60000) R.samples.splice(0, 20000);
    };
    return true;
  };
  const iv = setInterval(() => { if (patch()) clearInterval(iv); }, 25);
})()`;

/**
 * Which code is in the PAGE.
 *
 * Not a nicety. A dev server that has been up across an edit can serve the
 * browser a transform it will happily hand a curl a fresh copy of, and both
 * arms of a before/after then measure the same build — which is how this probe
 * first "proved" the bug was already fixed on master. So the arm is read out of
 * the loaded function itself, printed with the results, and it is the first line
 * to check when a run says something surprising.
 */
async function loadedArm(page: Page): Promise<string> {
  const src = await page.evaluate(() =>
    (window as unknown as { dbg: { session: { stageCtrl: { openStageFile: () => unknown } } } })
      .dbg.session.stageCtrl.openStageFile.toString(),
  );
  const before = /pendingReveal[\s\S]{0,200}ensureFile/.test(src);
  const holds = /blanked[\s\S]{0,200}pendingReveal = true/.test(src);
  const after = /ensureFile[\s\S]{0,600}fade\.level = 0/.test(src);
  return before ? "openStageFile clears the fade BEFORE the fetch" :
    holds ? "openStageFile holds a blanked screen and clears a ramp (#308 fixed)" :
    after ? "openStageFile clears the fade after the read (#308 half-fixed)" : "unrecognised";
}

const read = async (page: Page): Promise<Sample[]> =>
  page.evaluate(() => (window as unknown as { __holdProbe: { samples: Sample[] } }).__holdProbe.samples);

/** hold one file back, so the window a fetch opens is wide enough to see.
 *  A pattern rather than a name because the rip's own casing is what is served
 *  (`CARGO/CRATEP.MOV`) while the script asks for `cratep.mov`. */
async function stall(page: Page, file: string | RegExp): Promise<void> {
  await page.route(typeof file === "string" ? `**/${file}` : file, async (route) => {
    await new Promise((r) => setTimeout(r, STALL_MS));
    await route.continue();
  });
}

const fail: string[] = [];
const check = (name: string, ok: boolean, detail = ""): void => {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) fail.push(name);
};

/**
 * Every composite in `[from, to)` that put a LIT world on the canvas. Two things
 * make a composite harmless and both have to be excluded, or the probe reports
 * the fix as the bug: a composite while the screen belongs to a movie is the
 * movie's own frame, and one at a fade level of 1 is black however lit the thing
 * it drew was — `paint` applies the level, so that is a black rectangle over a
 * black screen.
 */
const flashes = (samples: Sample[], from: number, to: number): Sample[] =>
  samples.filter(
    (s) =>
      s.n >= from && s.n < to && s.painted && s.level < 1 &&
      (s.owner === "world" || s.owner === "puppet"),
  );

const where = (s: Sample): string =>
  `#${s.n} owner=${s.owner} level=${s.level} set=${s.set || "-"} stage=${s.stage || "-"} vis=${s.setVisible}`;

/**
 * Leg 1 — the boot the reporter ESC'd through.
 *
 * `boot()` ends the menu film and then loads the cast, four shops and `main.stg`
 * before `advanceday` reaches `datebed.mov`, with no screen statement in
 * between: the film's last frame owns the screen for all of it
 * (ScreenDirector.screenOwner's "held").
 *
 * This leg is THROTTLED and not stalled. Nothing in that window is a fetch on a
 * warm page — the host preloads every file the boot names before the logos
 * (`GameHost.coldBoot`, over `BootPlan.resources`, which is where `gang.cst`,
 * the shops, `main.stg` and `bedsit1.set` all come from) — so the window is
 * parse, decode and script work, and what widens it is a slower machine rather
 * than a slower connection. That is also the reporter's own case: the log they
 * quoted is the boot doing exactly these opens, from files their browser already
 * had. At 1x it is four frames; the flash is four frames of lit apartment, and
 * the assertion below does not care how many there are.
 */
async function bootLeg(page: Page): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  await page.goto(appUrl());
  await page.waitForFunction(() => !!(window as unknown as { dbg?: { host?: unknown } }).dbg?.host, null, {
    timeout: 30000,
  });
  // the ownership question blocks the boot and carries no skip flag
  await page.waitForFunction(
    () => !!(window as unknown as { dbg: { intro: null | { regions: () => unknown[] } } }).dbg.intro?.regions().length,
    null,
    { timeout: 30000 },
  );
  await clickIntroYes(page);
  console.log(`  the page is running: ${await loadedArm(page)}`);

  // ...and then spam ESC, which is the report's own gesture: it skips the logos
  // and the menu film, which makes the load window the whole of what is on
  // screen instead of something a film is covering.
  //
  // The pressing STOPS when the menu film is gone, and that is not fussiness:
  // an ESC that arrives a moment later skips `datebed.mov` too — at frame 0,
  // before any render has sampled it — and the window this leg is about loses
  // the endpoint that closes it. The report's own log ends on the caption
  // playing, so that is where the gesture ends.
  const spam = Date.now() + 180000;
  while (Date.now() < spam) {
    await page.keyboard.press("Escape");
    await page.waitForTimeout(120);
    const gone = await page.evaluate(() => {
      const all = (window as unknown as { __holdProbe: { samples: Sample[] } }).__holdProbe.samples ?? [];
      const seen = all.some((s) => s.movie === "playmode.mov");
      return seen && all[all.length - 1]?.movie !== "playmode.mov";
    });
    if (gone) break;
  }
  // and then just watch: the loads, and the caption the day advance reaches
  await page
    .waitForFunction(
      () =>
        ((window as unknown as { __holdProbe: { samples: Sample[] } }).__holdProbe.samples ?? []).some(
          (s) => s.movie === "datebed.mov",
        ),
      null,
      { timeout: 60000 },
    )
    .catch(() => undefined);
  const samples = await read(page);
  const menu = samples.filter((s) => s.movie === "playmode.mov");
  const caption = samples.find((s) => s.movie === "datebed.mov");
  // the probe's own footing first: without both endpoints there is no window,
  // and "no flash in it" would be a pass over nothing
  check("boot: the probe saw the menu film and the date caption",
    !!menu.length && !!caption, `menu=${menu.length} frame(s) caption=${caption?.n ?? "-"}`);
  if (!menu.length || !caption) {
    // a leg that never got there measured nothing, and the run has to say where
    // it stopped rather than reporting the negative as a pass
    const tail = await page.evaluate(() =>
      (window as unknown as { dbg: { log: () => { lines: string[] } } }).dbg.log().lines.slice(-25),
    );
    console.log("   engine log tail:\n     " + tail.join("\n     "));
    console.log("   last sample: " + (samples.length ? where(samples[samples.length - 1]) : "none"));
    return;
  }
  const from = menu[menu.length - 1].n + 1;
  const inside = samples.filter((s) => s.n >= from && s.n < caption.n);
  check("boot: the load between the film and the caption spans frames",
    inside.length >= 3, `${inside.length} frame(s), ${inside.filter((s) => s.painted).length} composited`);
  dump("boot", samples.filter((s) => s.n >= menu[0].n - 5 && s.n <= caption.n + 30));
  const bad = flashes(samples, from, caption.n);
  check("boot: nothing paints the apartment before the date caption",
    !bad.length,
    bad.length ? `${bad.length} composite(s): ${bad.slice(0, 4).map(where).join(" | ")}` : `${inside.length} frames clean`);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
}

/**
 * Leg 2 — the map, opened for the first time.
 *
 * Driven through the game's own `transtoflat` (GameSession.transToFlat), which
 * is ~200 lines of BOOTFILE script and not an engine command: `screentoblack`,
 * `closestagefile`, `openstagefile("map.stg")`, `visualeffect(plain, 0)`,
 * `blacktoscreen`. So the fade, the swap and the reveal are the game's, in the
 * game's order, and only the click that would have started it is skipped.
 */
async function mapLeg(page: Page): Promise<void> {
  await page.waitForFunction(
    () => !!(window as unknown as { dbg: { session: { quiescent?: boolean } } }).dbg.session,
    null,
    { timeout: 30000 },
  );
  // let the boot settle: the caption plays, advanceday fades the flat in
  await page.waitForFunction(
    () => {
      const s = (window as unknown as { dbg: { session: { scriptBusy: number }; host: { director: { movieFile: string | null } } } }).dbg;
      return !s.session.scriptBusy && !s.host.director.movieFile;
    },
    null,
    { timeout: 60000 },
  );
  const mark = await page.evaluate(
    () => (window as unknown as { __holdProbe: { frames: number } }).__holdProbe.frames,
  );
  await stall(page, "map.stg");
  await page.evaluate(() => {
    const s = (window as unknown as { dbg: { session: Driven } }).dbg.session;
    void s.track(s.transToFlat("map.stg"), "probe-map");
  });
  await page.waitForFunction(
    () => (window as unknown as { dbg: { session: { stageName: string } } }).dbg.session.stageName === "map.stg",
    null,
    { timeout: 60000 },
  );
  await page.waitForTimeout(1500); // the blacktoscreen ramp, and the map's first flat
  const samples = await read(page);

  // The window: from the frame the fade-out reaches black, to the frame the map
  // stage is open. Both endpoints come out of the samples rather than being
  // assumed, and the assertion below is void without them.
  const black = samples.find((s) => s.n > mark && s.level === 1);
  const open = samples.find((s) => s.n > mark && s.stage === "map.stg");
  check("map: the probe saw the fade to black and the stage arrive",
    !!black && !!open && black.n < open.n,
    `black=${black?.n ?? "-"} open=${open?.n ?? "-"}`);
  if (!black || !open || black.n >= open.n) return;
  const inside = samples.filter((s) => s.n >= black.n && s.n < open.n);
  check("map: the stage's download is frames wide",
    inside.length >= 10, `${inside.length} frame(s), ${inside.filter((s) => s.painted).length} composited`);
  dump("map", samples.filter((s) => s.n >= mark && s.n <= open.n + 60));
  const bad = flashes(samples, black.n, open.n);
  check("map: nothing paints the room behind the map's own black",
    !bad.length,
    bad.length ? `${bad.length} composite(s): ${bad.slice(0, 4).map(where).join(" | ")}` : `${inside.length} frames clean`);
  // and the intended outcome, so a clean run cannot be a run that never opened
  // a map: the overlay is up, the room is not a layer of it any more
  check("map: the map stage is what ended up on screen",
    open.stage === "map.stg" && !open.setVisible, `stage=${open.stage} vis=${open.setVisible}`);
}

/**
 * Leg 3 — the painting crate (#308, reopened).
 *
 * The same window as the map's, on the far side of the swap instead of inside
 * it. `binl.set`'s crate is `transtoflat("cargo.stg")`, and the boot's own
 * `transtoflat` ends that arm on a FILM rather than a fade:
 *
 *     screentoblack ("current", 10)   blackscreen ()
 *     closestagefile ()               openstagefile ("cargo.stg")
 *     sendtostage (opencargo ())      setvisible (false)
 *     playmovie ("cratep.mov")        visualeffect (plain, 0)
 *
 * There is no `blacktoscreen` in it: what reveals the crate is the clip. So
 * everything between `openstagefile` returning and the clip's first frame has to
 * stay the black `blackscreen()` put up — and `cratep.mov` is 648 KB, which is a
 * fetch, which is frames. Reported from play as the painting appearing in the
 * open crate before the animation that opens it, "a few frames" cold and one
 * frame warm.
 *
 * Driven through the game's own `transtoflat` for the reason the map leg gives;
 * `propowner("painting")` is `"none"` at boot, which is the arm that plays
 * `cratep.mov` rather than `cratenop.mov`.
 */
async function crateLeg(page: Page): Promise<void> {
  // Back out of the map leg first: the crate is reached from the room, and
  // `transtoflat`'s departure switch is keyed on the stage being left. AWAITED,
  // unlike the drive below — a `void` here let the two script runs overlap, with
  // `transfromflat`'s reveal ramp still in the queue when `transtoflat` pushed
  // its fade-out, which is a probe artefact and not anything a player can do.
  await page.evaluate(async () => {
    const s = (window as unknown as { dbg: { session: { transFromFlat: () => Promise<void> } } }).dbg.session;
    await s.transFromFlat();
  });
  await page.waitForFunction(
    () => {
      const s = (window as unknown as { dbg: { session: { scriptBusy: number }; host: { director: { movieFile: string | null } } } }).dbg;
      return !s.session.scriptBusy && !s.host.director.movieFile;
    },
    null,
    { timeout: 60000 },
  );
  const mark = await page.evaluate(
    () => (window as unknown as { __holdProbe: { frames: number } }).__holdProbe.frames,
  );
  await stall(page, /[cC][rR][aA][tT][eE][pP]\.[mM][oO][vV]/);
  await page.evaluate(() => {
    const s = (window as unknown as { dbg: { session: Driven } }).dbg.session;
    void s.track(s.transToFlat("cargo.stg"), "probe-crate");
  });
  await page
    .waitForFunction(
      () =>
        ((window as unknown as { __holdProbe: { samples: Sample[] } }).__holdProbe.samples ?? []).some(
          (s) => s.movie === "cratep.mov",
        ),
      null,
      { timeout: 60000 },
    )
    .catch(() => undefined);
  const samples = await read(page);

  // the window: the script's own black, to the clip that is the reveal
  const black = samples.find((s) => s.n > mark && s.level === 1);
  const clip = samples.find((s) => s.n > mark && s.movie === "cratep.mov");
  check("crate: the probe saw the fade to black and the clip start",
    !!black && !!clip && black.n < clip.n,
    `black=${black?.n ?? "-"} clip=${clip?.n ?? "-"}`);
  if (!black || !clip || black.n >= clip.n) {
    dump("crate", samples.filter((s) => s.n >= mark));
    const tail = await page.evaluate(() =>
      (window as unknown as { dbg: { log: () => { lines: string[] } } }).dbg.log().lines.slice(-25),
    );
    console.log("   engine log tail:\n     " + tail.join("\n     "));
    return;
  }
  const inside = samples.filter((s) => s.n >= black.n && s.n < clip.n);
  check("crate: the stage and the clip together are frames wide",
    inside.length >= 10, `${inside.length} frame(s), ${inside.filter((s) => s.painted).length} composited`);
  dump("crate", samples.filter((s) => s.n >= mark && s.n <= clip.n + 60));
  const bad = flashes(samples, black.n, clip.n);
  check("crate: nothing paints the open crate before the clip that opens it",
    !bad.length,
    bad.length ? `${bad.length} composite(s): ${bad.slice(0, 4).map(where).join(" | ")}` : `${inside.length} frames clean`);
  // and the intended outcome, so a clean run cannot be a run that never got there
  check("crate: the cargo stage is what the clip played over",
    clip.stage === "cargo.stg" && !clip.setVisible, `stage=${clip.stage} vis=${clip.setVisible}`);
}

const main = async (): Promise<void> => {
  let browser: Browser | null = null;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    page.on("pageerror", (e) => console.log("[pageerror]", e.message));
    await page.addInitScript(INSTALL);
    await bootLeg(page);
    await mapLeg(page);
    await crateLeg(page);
  } finally {
    await browser?.close();
  }
  console.log(fail.length ? `\n${fail.length} check(s) failed` : "\nall checks passed");
  if (fail.length) process.exitCode = 1;
};

void main();
