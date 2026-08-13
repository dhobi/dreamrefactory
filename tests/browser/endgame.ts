/**
 * The ending, in a real browser, without the forty minutes in front of it.
 *
 *   npm run dev
 *   npm run watch:endgame         # a real window, real narration, ~3 min
 *   npm run test:browser:endgame  # headless, same route, voice waits skipped
 *
 * The route reaches this in segment 27 and only there, after a whole carried
 * game — so every look at the ending used to cost the whole run. `SEGMENTS=27`
 * (which loads out/checkpoints/m4anti.ti) works now — the load comes back
 * inside Zeitel's ambush and the gate answers it (TODO 7a, fixed) — but it
 * still plays the whole segment. So this deals the boat deck by hand,
 * the way BOOTFILE's `advanceday("startdisk2")` deals the sinking, sets
 * `clock = "endgame"` and calls `advanceday()` — which is the whole ending:
 * leave.mov, debris.mov, the narend.stg slideshow, prozac.mov, the credits, and
 * `quit()`.
 *
 * It reports what is on the screen and what is playing twice a second and
 * screenshots every change of movie or flat into out/endgame — because every
 * bug this was written for was a picture: the closing narration under a black
 * that nothing lifted, the boat deck we left still covering the top of the
 * screen, prozac.mov showing in the strip below it. The soundtrack half is in
 * the report rather than the pictures: `theme=` is what is playing, and the
 * sinking's `sink1.trk` has to be gone by the time leave.mov starts.
 *
 * What it is NOT is a golden comparison — that is segment 27's job in both
 * hosts. This is the eyes on the ending, and the assertions it does make are
 * the ones a picture cannot: that each movie plays once, in order, and that
 * quit() ends at the main menu.
 */
import { chromium, Page } from "playwright";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { appUrl, clickIntroYes } from "./driver";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "..", "..", "out", "endgame");
const HEADED = !!process.env.HEADED && process.env.HEADED !== "0";
/** skip the real voice waits (voicedone always true) so the tail is reachable */
const RUSH = process.env.RUSH !== "0";
const SEED = 19120415;
const MENU_GAME = { x: 266, y: 254 };
/** where the Gorse-Joneses find you — the standpoint the ending runs from */
const STAND = { set: "deckbd2", scene: "scene44", view: "view211", phase: 1 };

const SAMPLE = `(() => {
  const s = window.dbg.session, v = window.dbg.viewer;
  const sch = s.scheduler;
  return {
    set: String(s.currentSetName), setFile: String(s.currentSetFile || ""),
    setVisible: !!s.setVisible,
    stage: String(s.stageName), flat: String(s.currentFlat),
    theme: String(s.currentThemeName || ""),
    banks: s.audioLib.bankNames,
    soundLoops: [...(sch.soundLoops ? sch.soundLoops.keys() : [])],
    loops: sch.loops.map((l) => l.kind + "/" + l.name + ":" + l.handler),
    crickets: sch.crickets.map((c) => c.name),
    // the ones actually SOUNDING — a soundloop-flagged cricket loops forever, so
    // the table entry surviving is fine and a live handle after the set is gone
    // is the boat deck's crowd talking over the ending
    sounding: sch.crickets.filter((c) => c.handle && !c.handle.done).map((c) => c.name),
    movie: v ? (v.movieFile || "") : "(no viewer)",
    moviePos: v && v.movies ? v.movies.framePos : -1,
    // the boot menu parks here — sampled rather than waited on, so the restart's
    // own clips can be recorded on the way (see the quit() half of the verdict)
    awaitingInput: !!(v && v.awaitingInput),
    regions: v ? v.movieRegions.map((r) => ({ type: r.type, x0: r.x0, y0: r.y0, x1: r.x1, y1: r.y1 })) : [],
    fade: Number(s.fade.level.toFixed(2)), snap: !!s.fade.snapshot,
    reveal: !!s.fade.pendingReveal, busy: !!s.scriptBusy,
    // the scrapbook turns its pages with visualeffect(wipeleft, 30) — half a
    // second each, so a 500 ms sample catches one mid-turn (#12)
    wipe: s.wipe && s.wipe.dir ? s.wipe.dir + ":" + s.wipe.step + "/" + s.wipe.steps : "",
    g: {
      mission: s.interp.globals.get("mission"), phase: s.interp.globals.get("phase"),
      clock: s.interp.globals.get("clock"), lockevents: s.interp.globals.get("lockevents"),
      one: s.interp.globals.get("onehappens"), two: s.interp.globals.get("twohappens"),
      rev: s.interp.globals.get("revhappens"),
    },
  };
})()`;

const stamp = () => new Date().toTimeString().slice(0, 8);
const log = (m: string) => console.log(`${stamp()} ${m}`);

const line = (s: any) =>
  `set=${s.set} vis=${s.setVisible ? 1 : 0} stage=${s.stage} flat=${s.flat} movie=${s.movie || "-"} ` +
  `fade=${s.fade}${s.snap ? "+snap" : ""}${s.reveal ? "+reveal" : ""} busy=${s.busy ? 1 : 0} ` +
  `${s.wipe ? `wipe=${s.wipe} ` : ""}` +
  `theme=${s.theme} loops=[${s.loops}] sndloops=[${s.soundLoops}] crickets=[${s.crickets}] ` +
  `sounding=[${s.sounding}] ` +
  `g=${JSON.stringify(s.g)}`;

/**
 * Get to the boot menu, pressing a real Escape past whatever is in the way.
 *
 * A bare `waitForFunction` for `awaitingInput` could not do it on a machine that
 * HAS the intro film — which, since the film became a tracked file, is every
 * machine including CI. It used to be gitignored, so CI booted straight to the
 * menu and only local runs sat through a 120 s timeout (#63).
 *
 * Three states to press past, which is why this is a poll rather than a wait:
 *
 * - the Nightdive intro. A MOV in its OWN MoviePlayer (src/nightdive.ts), so
 *   `dbg.viewer` is still null and no viewer predicate can see it. It also only
 *   appears once its 6 MB have been fetched, so a single check at t=0 finds
 *   nothing — that is the trap this walked into first. ESC presses past the
 *   FILM; since #171 the question that follows carries no skip flag, so it has
 *   to be clicked — YES, because NO navigates to gog.com.
 * - the boot's own clips, in the viewer, with no regions to wait on.
 * - nothing yet: a fetch in flight, so wait.
 */
async function reachMenu(page: Page, budgetMs = 240_000): Promise<boolean> {
  const at = (expr: string) =>
    page
      .evaluate(`(() => { const dbg = window.dbg; return !!(${expr}); })()`)
      .catch(() => false) as Promise<boolean>;
  const stop = Date.now() + budgetMs;
  let skipped = "";
  while (Date.now() < stop) {
    if (await at("dbg.viewer && dbg.viewer.awaitingInput")) return true;
    if (await at("dbg.intro")) {
      if (skipped !== "the intro") log(`    skipping ${(skipped = "the intro")}`);
      // the question, once the film is past: click YES rather than press at a
      // segment that no longer answers to the key (#171)
      if (await at("dbg.intro.regions().length > 0")) await clickIntroYes(page);
      else await page.keyboard.press("Escape");
    } else if (await at("dbg.viewer && dbg.viewer.moviePlaying && dbg.viewer.movieRegions.length === 0")) {
      const clip = String(await page.evaluate(() => (window as any).dbg.viewer?.movieFile ?? ""));
      if (clip && clip !== skipped) log(`    skipping ${(skipped = clip)}`);
      await page.keyboard.press("Escape");
    }
    await page.waitForTimeout(250);
  }
  return false;
}

async function shot(page: Page, name: string, s: any): Promise<void> {
  log(`--- ${name}: ${line(s)}`);
  log(`    banks=[${s.banks}]`);
  const canvas = await page.$("#screen");
  if (canvas) await canvas.screenshot({ path: join(OUT, `${name}.png`) });
}

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ headless: !HEADED });
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  const lines: string[] = [];
  page.on("console", (m) => {
    const t = m.text();
    lines.push(t);
    if (!/^(prop|actor|walk|turn|hit)/i.test(t)) log(`  page: ${t}`);
  });
  page.on("pageerror", (e) => log(`  PAGE ERROR: ${e.message}`));

  await page.goto(appUrl());
  await page.waitForFunction(() => !!(window as any).dbg, null, { timeout: 30_000 });
  await page.evaluate((seed) => {
    const dbg = (window as any).dbg;
    dbg.session.seedRandom(seed);
    // the engine's own log goes to a DOM pane; forward it so the probe sees it
    const prev = dbg.session.onLog;
    dbg.session.onLog = (l: string) => {
      console.log(`engine: ${l}`);
      prev(l);
    };
  }, SEED);
  log("booting…");
  if (!(await reachMenu(page))) throw new Error("the boot never reached the menu");
  const c = await page.$("#screen");
  const box = (await c!.boundingBox())!;
  await page.mouse.click(
    box.x + ((MENU_GAME.x + 0.5) / 512) * box.width,
    box.y + ((MENU_GAME.y + 0.5) / 384) * box.height,
  );
  await page.waitForFunction("!window.dbg.session.scriptBusy", null, { timeout: 180_000 });
  log("boot handed over");

  // -- deal the sinking, on the boat deck, as advanceday("startdisk2") does ---
  log(`dealing ${STAND.set} at mission 4 phase ${STAND.phase}…`);
  await page.evaluate(async (stand) => {
    const dbg = (window as any).dbg;
    const s = dbg.session;
    const g = s.interp.globals;
    g.set("tour", 0);
    g.set("debugging", 0);
    g.set("mission", 4);
    g.set("phase", stand.phase);
    g.set("pennyphase", 1); // setupsinksound only PLAYS the theme past this
    g.set("handitem", "");
    g.set("sinkflag", 0);
    g.set("playerdeath", "");
    g.set("neckphase", -1);
    g.set("letterphase", -1);
    for (const n of ["savestage1", "savestage2", "savestage3"]) g.set(n, "");
    s.audio.halt("theme");
    s.currentThemeName = "none";
    await dbg.host.loadServerSet(`${stand.set}.set`);
    await s.runGlobal("resetpupvars"); // zeroes pennyphase, so set it AFTER
    await s.runGlobal("initall", [stand.set, stand.scene, stand.view]);
    g.set("pennyphase", 1); // setupsinksound only PLAYS the sink theme past this
    g.set("hrs", 13);
    g.set("min", 20);
    g.set("sec", 0);
    await s.ensureFile(`sink${stand.phase}.trk`);
    await s.runGlobal("setupsinksound");
    g.set("sinkflag", 1);
    await s.runGlobal("calctime");
    // the four ownerships the ending is scored on, as segment 27 arrives
    for (const n of ["painting", "notebook", "rubaiyat", "realneck"]) {
      const p = s.propRuntime.get(n);
      if (p) p.owner = "frank";
    }
  }, STAND);
  await shot(page, "00-boatdeck", await page.evaluate(SAMPLE));
  await page.waitForTimeout(3000);
  await shot(page, "00b-settled", await page.evaluate(SAMPLE));

  if (RUSH) {
    await page.evaluate(() => {
      (window as any).dbg.session.audio.isDone = () => true; // voicewait() at once
    });
    log("RUSH: voice waits are instant");
  }

  // -- the endgame ----------------------------------------------------------
  log('advanceday() with clock = "endgame"');
  await page.evaluate(() => {
    const s = (window as any).dbg.session;
    s.interp.globals.set("clock", "endgame");
    void s.track(s.runGlobal("advanceday"));
  });

  const seen = new Set<string>();
  /** every clip in the order it started, so a second run of one shows up */
  const played: string[] = [];
  const flats = new Set<string>();
  /** ambience still sounding after the boat deck was closed — see the verdict */
  const strays = new Set<string>();
  /** page-turn reveals seen mid-flight — the scrapbook's flips (#12) */
  const wipes = new Set<string>();
  let wipeShot = false;
  const deadline = Date.now() + 12 * 60_000;
  let n = 1;
  let last = "";
  let quiet = 0;
  let navigated = false;
  while (Date.now() < deadline) {
    let s: any;
    try {
      s = await page.evaluate(SAMPLE);
    } catch {
      // quit() used to reload the page and this was how the test knew it had
      // worked. It restarts in place now, so a navigation here is the OLD
      // behaviour coming back — and it takes the run with it (the full
      // playthrough reported "Execution context was destroyed" and then read the
      // theme off a dead page).
      log("    the page NAVIGATED — quit() is supposed to restart in place");
      navigated = true;
      break;
    }
    // every sample, not only the ones that change the picture: the ambience is
    // the one thing here that is wrong CONTINUOUSLY rather than at a moment
    if (s.set === "none") for (const c of s.sounding ?? []) strays.add(String(c));
    const key = `${s.movie}|${s.flat}|${s.stage}|${s.busy}`;
    if (key !== last) {
      last = key;
      const movie = String(s.movie || "");
      const tag = movie
        ? `${String(n++).padStart(2, "0")}-movie-${movie.replace(/\W+/g, "_")}`
        : s.stage === "narend.stg"
          ? `${String(n++).padStart(2, "0")}-flat-${String(s.flat).replace(/\W+/g, "_")}`
          : `${String(n++).padStart(2, "0")}-${s.stage.replace(/\W+/g, "_")}-${String(s.flat).replace(/\W+/g, "_")}`;
      if (movie) {
        seen.add(movie);
        if (played[played.length - 1] !== movie) played.push(movie);
      }
      if (s.stage === "narend.stg") flats.add(String(s.flat));
      if (s.wipe) {
        wipes.add(String(s.wipe).split(":")[0]);
        // grab the seam itself the first time, so the reveal is verified by eye
        // and not only by its counter (#12)
        if (!wipeShot) {
          wipeShot = true;
          const c = await page.$("#screen");
          if (c) await c.screenshot({ path: join(OUT, `wipe-${String(s.wipe).replace(/\W+/g, "_")}.png`) });
        }
      }
      if (n < 40) await shot(page, tag, s);
      else log(`--- ${tag}: ${line(s)}`);
    } else {
      log(`    ${line(s)}`);
    }
    // the credits are fourteen pages that wait for a click — turn them, so the
    // boot's `playmovie("credits.mov"); quit()` gets to its second half
    if (s.movie === "credits.mov" && s.moviePos >= 0) {
      const r = s.regions?.[0];
      if (s.regions?.length === 1 && r?.type === 6) {
        await page.mouse.click(
          box.x + ((Math.floor((r.x0 + r.x1) / 2) + 0.5) / 512) * box.width,
          box.y + ((Math.floor((r.y0 + r.y1) / 2) + 0.5) / 384) * box.height,
        );
        log(`    turned a credits page (frame ${s.moviePos})`);
      }
    }
    if (!s.busy && seen.size) quiet++;
    else quiet = 0;
    if (quiet > 6) break;
    await page.waitForTimeout(500);
  }
  if (!navigated) {
    // The restart: logos, then the Play / Guided Tour menu — the main menu, in the
    // SAME page, so `dbg` is the one we have been sampling all along.
    //
    // KEEP RECORDING while we wait for it. The loop above stops on `quiet > 6`,
    // seven not-busy samples, and that comes due during logo.mov — so the clip
    // the verdict asks for, playmode.mov, started after `played` had stopped
    // growing. The run then failed with "quit() never came back to the boot
    // menu" two lines under its own report that the menu was up and the final
    // snapshot reading movie=playmode.mov (#63).
    const back = await (async (): Promise<boolean> => {
      const stop = Date.now() + 180_000;
      while (Date.now() < stop) {
        const s: any = await page.evaluate(SAMPLE).catch(() => null);
        if (!s) return false;
        const movie = String(s.movie || "");
        if (movie && played[played.length - 1] !== movie) {
          played.push(movie);
          seen.add(movie);
          log(`    after quit(): ${movie}`);
        }
        if (s.awaitingInput) return true;
        await page.waitForTimeout(250);
      }
      return false;
    })();
    log(`after quit(): ${back ? "the boot menu is up again" : "it restarted but no menu came"}`);
    const canvas = await page.$("#screen");
    if (canvas) await canvas.screenshot({ path: join(OUT, "98-main-menu.png") });
  }
  await shot(page, "99-after", await page.evaluate(SAMPLE).catch(() => ({ g: {} })));
  log(`clips played, in order: ${played.join(" -> ")}`);
  log(`narend flats: ${[...flats].join(", ")}`);
  log(`page-turn wipes seen: ${[...wipes].join(", ") || "(none)"}`);
  log(`engine complaints: ${lines.filter((l) => /no theme|not available|error/i.test(l)).length}`);

  // -- the verdict ----------------------------------------------------------
  // The order IS the assertion. Each of these plays exactly once and in this
  // sequence, and the way the ending was broken was a repeat: `opennarend` fired
  // twice, so the slideshow and prozac.mov ran once invisibly under the boot's
  // black before running again for real.
  const WANT = ["leave.mov", "debris.mov", "prozac.mov", "credits.mov"];
  const fails: string[] = [];
  // The ENDING is the clips up to and including the credits. What follows them is
  // the restart's own front door (logo.mov, then playmode.mov) — quit() returns to
  // the main menu in place now instead of reloading the page, so those clips are
  // recorded in this same run and are asserted separately below rather than
  // muddying the "each of these exactly once, in this order" check.
  const creditsAt = played.indexOf("credits.mov");
  const ending = creditsAt < 0 ? played : played.slice(0, creditsAt + 1);
  if (ending.join(",") !== WANT.join(",")) {
    fails.push(`clips: ${ending.join(" -> ") || "(none)"}\n    wanted: ${WANT.join(" -> ")}`);
  }
  // The good ending reads 21 papers out: worldwar1's 4, worldwar2's 6,
  // rushrev's 5 and futures' 6 (NAREND.STG, and segments.ts segment 27). Only
  // countable at real speed — this samples twice a second and each paper is
  // held for as long as its narration, so RUSH skips most of them past us. Not
  // a weaker check than it looks: what the pictures are FOR is the fade, and one
  // flat proves as much about that as twenty.
  const wantFlats = RUSH ? 1 : 21;
  if (flats.size < wantFlats) fails.push(`narend showed ${flats.size} flat(s), wanted ${wantFlats}`);
  // The soundtrack half, and the report this was reopened for: "debris.mov still
  // had the sinking soundtrack in the background... there is still people talking
  // from the Titanic sinking". Two separate things and both are here — the theme
  // is `theme=` in the log (halted by putdownsinksound now that closetrackfile
  // stops the music it unloads), and the talking is the boat deck's five `party`
  // crowd loops, which are soundloop-flagged crickets. Once the set is closed
  // NOTHING positional may still be sounding: a cricket is placed in a set's
  // world, and that world is gone.
  if (strays.size) fails.push(`ambience still sounding with no set: ${[...strays].join(", ")}`);
  // ...and quit() must have come back to the front door, in place. The boot's own
  // two clips are the proof it really re-ran rather than merely stopping: the
  // logos, then the Play / Guided Tour menu.
  if (navigated) fails.push("quit() reloaded the page instead of restarting in place");
  else {
    const after = played.slice(creditsAt + 1);
    if (!after.includes("playmode.mov")) {
      fails.push(
        `quit() never came back to the boot menu — after the credits: ${after.join(" -> ") || "(nothing)"}`,
      );
    }
  }
  if (fails.length) {
    console.error(`\nFAILED (${fails.length})\n  - ${fails.join("\n  - ")}`);
  } else {
    log("PASSED — the ending plays once, in order, and quit() ends at the main menu");
  }
  if (HEADED) await page.waitForTimeout(600_000);
  await browser.close();
  process.exit(fails.length ? 1 : 0);
}

void main().catch((e) => {
  console.error(e);
  process.exit(1);
});
