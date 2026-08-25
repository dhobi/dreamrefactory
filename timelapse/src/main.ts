/**
 * Timelapse, in a browser.
 *
 * *Timelapse: Ancient Civilizations* (1996) is the third and last game to ship on
 * DreamFactory, and the one CyberFlix did not make — it is GTE Interactive Media's,
 * on CyberFlix's licensed engine. This page used to be the question of whether it
 * boots at all: a 640x480 surface, a log, and nothing else. The answer turned out
 * to be yes — the real {@link GameHost}, the real `GameSession`, the game's own
 * BOOTFILE, its films, its cursors and its four discs — so the page is now a
 * game, and the log is what it opens when something goes wrong rather than what
 * it IS.
 *
 * What that took, and what is worth knowing before reading downwards:
 *
 *   - the game's screen is 640x480 where the other two are 512x384, and the
 *     canvas is that DOUBLED — see {@link plate};
 *   - the boot moves 69.9 MB before the first frame, and the BOOTFILE names two
 *     thirds of that itself — the rest has to be named here, see {@link EXTRA};
 *   - `boot()` ends in `enterworld("I")`, which plays a 51-second film as a MODAL
 *     movie, which is why the player is asked to press a button first: a browser
 *     will not build an AudioContext without a gesture, and that film is the
 *     opening of the game.
 *
 * There is no `.SET` on any of the four discs, so there is no room layer at all:
 * every picture on this page is a stage flat, a film or a prop composited by
 * {@link ScreenDirector} with the room simply absent.
 */
import { RAMP_STEP_MS } from "@dreamfactory/engine/runtime/clock";
import { detectVersion } from "@dreamfactory/engine/df/version";
import { DeferredAudioSink, WebAudioSink } from "@dreamfactory/engine/runtime/audio";
import { GameHost } from "@dreamfactory/engine/web/host";
import { ESCAPE_KEY, SPACE_KEY, focusOwnsKey } from "@dreamfactory/engine/web/keys";
import { GestureKey, PointerEventLike, TouchGestures, bindSwipeInvert } from "@dreamfactory/engine/web/touch";
import { CursorSheet } from "@dreamfactory/engine/web/cursors";
import { compileScript } from "@dreamfactory/engine/df/script-asm";
import { installBugReport } from "@dreamfactory/site/bug-report";
import { TIMELAPSE } from "@dreamfactory/site/games";
import { VERSION } from "@dreamfactory/site/version";
import { TL_CURSORS } from "./cursor-art";
import { TimelapseFiles } from "./files";

/**
 * This game's screen, and it is NOT the engine's default.
 *
 * Every one of Timelapse's 155 stages says 640x480 in its own container-0 header
 * where Titanic and Dust say 512x384, so the host is told rather than left to
 * assume (engine/src/web/screen.ts). Getting this wrong is not subtle: the
 * framebuffer would be 512x384 and a fifth of every picture would be off the
 * right and bottom edges.
 */
const SCREEN = { width: 640, height: 480 };

const canvas = document.getElementById("screen") as HTMLCanvasElement;
const ctx = canvas.getContext("2d", { alpha: false })!;
/**
 * The picture is composed at 640x480 and blitted up, rather than the canvas
 * being 640 wide and stretched by CSS.
 *
 * 640 CSS pixels in a 1920px window is a postage stamp, and the alternative to
 * this is asking the browser to draw a 640-wide canvas at, say, 1100 — a
 * non-integer nearest-neighbour UPSCALE, where some source pixels come out two
 * device pixels wide and their neighbours one. On 1996 art that reads as a limp.
 *
 * So the engine draws its own 640x480 here, one `drawImage` doubles it into a
 * 1280x960 canvas (a nearest-neighbour blit in the compositor, with smoothing
 * off), and the PAGE only ever shrinks that — a downscale of an already-doubled
 * picture, which is soft at worst. Dust's page does the same thing for the same
 * reason at 512x384.
 */
const plate = document.createElement("canvas");
plate.width = SCREEN.width;
plate.height = SCREEN.height;
const plateCtx = plate.getContext("2d", { alpha: false })!;
ctx.imageSmoothingEnabled = false;

const logEl = document.getElementById("log") as HTMLPreElement;
const locEl = document.getElementById("loc") as HTMLElement;
const errEl = document.getElementById("err") as HTMLElement;
const stageEl = document.getElementById("stage") as HTMLElement;
const verEl = document.getElementById("ver");
if (verEl) verEl.textContent = `v${VERSION}`;

const esc = (s: string): string => s.replace(/[&<>]/g, (c) => `&${{ "&": "amp", "<": "lt", ">": "gt" }[c]};`);

/**
 * One line of the log, which on this game is still the deliverable.
 *
 * Two voices, and they are the two the page's stylesheet knows: `step` is
 * something the boot did, `warn` is something it had to complain about. The plain
 * lines are kept as strings as well, because a bug report carries the tail of
 * them (see installBugReport below) and because the newest one is the caption
 * under the loading gauge.
 */
const LOG_MAX = 600;
const logLines: string[] = [];
function say(line: string, kind: "" | "step" | "warn" = ""): void {
  logLines.push(line);
  if (logLines.length > LOG_MAX) logLines.splice(0, logLines.length - LOG_MAX);
  const tag = kind === "step" ? "b" : kind === "warn" ? "i" : "";
  logEl.insertAdjacentHTML("beforeend", tag ? `<${tag}>${esc(line)}</${tag}>\n` : `${esc(line)}\n`);
  // scrollTop forces layout, so only when there is something to scroll
  if (!logEl.hidden) logEl.scrollTop = logEl.scrollHeight;
}

/** the log is a panel over the picture now, and this is the only way in or out */
function showLog(open: boolean): void {
  logEl.hidden = !open;
  if (open) logEl.scrollTop = logEl.scrollHeight;
}
document.getElementById("logBtn")?.addEventListener("click", () => showLog(logEl.hidden));

/**
 * Audio waits for a gesture, as every browser insists — and on this game the
 * gesture is the Enter button, because the first thing the boot does is play a
 * 51-second film with a score on it.
 *
 * Deferred rather than absent so the boot's `LoopSound`/`gototheme` calls are
 * HELD and started when the sink arrives, instead of being lost: a silent boot
 * would look like an audio bug when it is only an autoplay policy. Idempotent,
 * because the error paths reach it too.
 */
const audio = new DeferredAudioSink();
let audioReady = false;
function ensureAudio(): void {
  if (audioReady) return;
  audioReady = true;
  try {
    audio.attach(new WebAudioSink());
    say("audio attached", "step");
  } catch {
    /* no audio in this browser: not what this page is measuring */
  }
}

/**
 * The two levers this port adds, both of them the play page's: a fullscreen
 * picture, and a bug report that arrives with the screen attached.
 */
const fsBtn = document.getElementById("fsBtn") as HTMLButtonElement | null;
fsBtn?.addEventListener("click", () => {
  // the STAGE, not the canvas: fullscreening the canvas hands the letterbox to
  // the UA, and the picture is a fixed 4:3 either way — see #stage:fullscreen
  if (document.fullscreenElement) void document.exitFullscreen();
  else void stageEl.requestFullscreen().catch((e: Error) => say(`fullscreen: ${e.message}`, "warn"));
});
document.addEventListener("fullscreenchange", () => {
  if (fsBtn) fsBtn.textContent = document.fullscreenElement ? "⛶ Exit fullscreen" : "⛶ Fullscreen";
});

/** where the player is, for a bug report: the readout's own line, kept as it changes */
let currentWhere = "";
/** how long the screenshot's fate stays on screen before it is taken down */
const BUG_NOTE_MS = 6000;
const bugBtn = document.getElementById("bugBtn") as HTMLButtonElement | null;
const bugNote = document.getElementById("bugNote");
if (bugBtn) {
  installBugReport(bugBtn, {
    game: TIMELAPSE.short,
    canvas,
    shotName: "timelapse-bug.png",
    version: VERSION,
    where: () => currentWhere,
    // four discs, one language: there is nothing to choose between, and saying so
    // is more use in an issue than leaving the field out
    edition: () => "Timelapse 4CD (gamefiles/TLAPSE1-4/)",
    log: (n) => logLines.slice(-n),
    note: (how) => {
      if (!bugNote) return;
      bugNote.textContent =
        how === "clipboard"
          ? "screen copied — paste it into the issue"
          : "screen saved — attach timelapse-bug.png to the issue";
      window.setTimeout(() => (bugNote.textContent = ""), BUG_NOTE_MS);
    },
  });
}

/* ------------------------------------------------------------------------- *
 * The loading page
 * ------------------------------------------------------------------------- */

const brandEl = document.getElementById("brand") as HTMLImageElement | null;
const bootEl = document.getElementById("boot") as HTMLElement;
const startEl = document.getElementById("start") as HTMLButtonElement;
const conduitEl = document.getElementById("conduit") as HTMLElement;
const chargeEl = document.getElementById("charge") as HTMLElement;
const bootSayEl = document.getElementById("bootsay") as HTMLElement;
const bootPctEl = document.getElementById("bootpct") as HTMLElement;

/**
 * What the loader has to fetch that the boot's own plan does not name.
 *
 * The BOOTFILE names most of it. `readBootPlan` walks out of `boot()` and finds
 * seven: `p.shp`, the four world films (`e025.mov`, `a026.mov`, `m030.mov`,
 * `z021.mov`), `open.mov`, and `theme` — which is not a file at all but a
 * `gototheme` argument the reader cannot tell from a filename, and which the
 * store answers `null` for without anything asking twice. `coldBoot` waits on all
 * of them before it runs a line of script, so they are the plan's own prefetch and
 * this list does not repeat them.
 *
 * What the plan CANNOT name is world I. `boot()` ends in `enterworld("I")` and
 * every name inside that is built by concatenation — `openshopfile(curworldchar @
 * ".Shp")`, `curworldchar @ threezeronum(n) @ ".Stg"` — so no string literal in
 * the script says `i001.stg`, and nothing walking the script can find it. These
 * six are the six the boot log shows arriving after the plan's:
 *
 *   i.shp       2.5 MB   world I's props
 *   i.trk       1.6 MB   its music and effects
 *   i001.stg   25.1 MB   the first stage, and all 283 flats in it
 *   i001.trk    0.4 MB   that stage's own track bank
 *   i001.mov    0.2 MB   the film its first frame plays
 *   p.stg       0.1 MB   the panel stage — SPACE, the journal, the camera
 *
 * With the plan's seven that is 69.9 MB, and 52 of it is two files. Which is the
 * argument for taking the whole wait in FRONT of the button rather than behind
 * it: `open.mov` is what `enterworld` plays the moment the boot ends, so left to
 * arrive on demand it is a 27 MB stall exactly where the game's opening starts.
 */
const EXTRA = ["i.shp", "i.trk", "i001.stg", "i001.trk", "i001.mov", "p.stg"] as const;

/** where the bar stands once the disc index has arrived and before any of it has */
const INDEXED = 0.04;
/** and once the BOOTFILE has been read, which is where the list comes from */
const PLANNED = 0.07;
/** and where the prefetch leaves it: the last few per cent are the boot's own */
const FETCHED = 0.96;

/** the bar only ever goes forwards, whatever order the answers arrive in */
let charged = 0;
let shownPct = -1;
function progress(f: number, label?: string): void {
  charged = Math.max(charged, Math.min(1, f));
  const pct = Math.round(charged * 100);
  if (pct !== shownPct) {
    shownPct = pct;
    chargeEl.style.width = `${pct}%`;
    bootPctEl.textContent = `${pct}%`;
    conduitEl.setAttribute("aria-valuenow", String(pct));
  }
  // the caption is one line and the newest one wins: what a player watches is
  // the loader naming what it is opening
  if (label) {
    idleCaption = label;
    bootSayEl.textContent = label;
    rateShown = false;
  }
}

/**
 * The network meter: one rolling window for the whole loading page.
 *
 * Sampled per CHUNK and read on a TIMER, and both halves matter. Measured per
 * completed file instead, `open.mov` reports nothing for as long as it takes to
 * arrive and then one enormous figure at the moment it lands — and on a slow
 * connection that silence is the entire experience of this loader.
 *
 * Dust's page has the same meter over its own 95 MB. Two copies rather than one
 * shared module, for now, because they differ in what they can promise: Dust
 * counts FETCHES against a plan of eight, and this counts BYTES, because two of
 * its thirteen files are three quarters of the download. The day a third page
 * wants one, it moves to `site/`.
 */
const WINDOW_MS = 3000;
/** the least window worth dividing by; under it there is no number to give */
const SETTLE_MS = 900;
const TICK_MS = 250;
const netSamples: { t: number; bytes: number }[] = [];
let netTotal = 0;
let meterTimer = 0;
/** what is still to come, once the list is known */
let bytesLeft: (() => number) | null = null;
/** the last thing the LOADER said, to fall back to when the wire goes quiet */
let idleCaption = "";
/** is the caption currently a rate, and therefore mine to replace? */
let rateShown = false;

function netChunk(bytes: number): void {
  netSamples.push({ t: performance.now(), bytes });
  netTotal += bytes;
}

/**
 * Show the rate while bytes are arriving and get out of the way when they are
 * not: a rate that survives the transfer it measured is the misleading thing,
 * and the name of the file being opened is better than a stale number.
 */
function meterTick(): void {
  const now = performance.now();
  while (netSamples.length && now - netSamples[0].t > WINDOW_MS) netSamples.shift();
  const span = netSamples.length ? now - netSamples[0].t : 0;
  const got = netSamples.reduce((a, x) => a + x.bytes, 0);
  const rate = span >= SETTLE_MS ? got / (span / 1000) : 0;
  if (rate) {
    const left = bytesLeft?.() ?? 0;
    // "12 of 70 MB" rather than "12 MB so far", once there is a total to be a
    // fraction of — and the total is what has come down plus what is still owed,
    // so it GROWS if the game asks for something this list did not name, which is
    // the honest direction for it to move
    const scale = left ? `${fmtSize(netTotal)} of ${fmtSize(netTotal + left)}` : `${fmtSize(netTotal)} so far`;
    const eta = left ? fmtLeft(left / rate) : "";
    bootSayEl.textContent = `${fmtRate(rate)} · ${scale}${eta ? ` · ${eta}` : ""}`;
    rateShown = true;
  } else if (rateShown) {
    bootSayEl.textContent = idleCaption;
    rateShown = false;
  }
}

/** "1.4 MB/s" or "830 KB/s" — whichever reads as a number rather than as noise */
const fmtRate = (bps: number): string =>
  bps >= 1024 * 1024 ? `${(bps / (1024 * 1024)).toFixed(1)} MB/s` : `${Math.max(1, Math.round(bps / 1024))} KB/s`;

/** "13.1 MB" or "412 KB" — how much has actually come down the wire */
const fmtSize = (bytes: number): string =>
  bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

/**
 * "~4 min left", "~35 s left", or nothing at all when the answer is "any moment"
 * or too wild to print.
 *
 * Rounded coarsely on purpose — to five seconds under a minute and a half, to
 * whole minutes above. The rate it divides is a three-second average, so the raw
 * figure jitters between ticks, and a countdown that flickers reads as broken
 * even when every value it shows is true.
 */
function fmtLeft(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 3) return "";
  if (seconds > 3 * 3600) return ""; // not an estimate, a symptom
  if (seconds < 90) return `~${Math.min(85, Math.max(5, Math.round(seconds / 5) * 5))} s left`;
  return `~${Math.round(seconds / 60)} min left`;
}

/** a real pause, for the one place that wants to be SEEN rather than be quick */
const hold = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * The disc is read; wait to be told to go.
 *
 * Held open for {@link CHARGED} first, because the fill's own `width` transition
 * is 380ms and swapping it out the instant the number says 100 means the bar
 * never visibly arrives — the whole point of counting real bytes was to earn that
 * end, so it gets to be watched reaching it.
 *
 * Then the gauge crossfades to the button in the same slot and the button takes
 * focus, so this is a keyboard gesture as much as a pointer one: Enter and Space
 * are what a focused button already does, and an AudioContext accepts either.
 */
const CHARGED = 520;
async function waitForStart(): Promise<void> {
  await hold(CHARGED);
  bootEl.classList.add("ready");
  startEl.focus();
  await new Promise<void>((resolve) => startEl.addEventListener("click", () => resolve(), { once: true }));
}

/**
 * The title card rises, by FLIP.
 *
 * Measure where it is, switch the state, measure where it landed, then play the
 * difference back as a transform. Which is not ceremony: the two states size the
 * image by DIFFERENT properties — centred by `max-height: 46vh`, risen by
 * `height: 100%` of a `clamp()`ed band — and a transition between two sizing
 * modes has nothing to interpolate. A transform does, and it is the one property
 * that animates without touching layout, which matters here because the game's
 * first film starts in the same frame this does.
 *
 * The gauge is PINNED before the switch and faded after it: it is a flex child of
 * the band the card is rising into, so the class change removes it from the
 * layout it is standing in, and freezing it at the rect it already occupies lets
 * it fade out where the player last saw it instead of jumping to the top with the
 * logo.
 */
let risen = false;
function raiseTitle(): void {
  if (risen) return; // the failure paths reach here too; the move happens once
  risen = true;
  const bar = bootEl.getBoundingClientRect();
  if (bar.width) {
    bootEl.style.position = "fixed";
    bootEl.style.left = `${bar.left}px`;
    bootEl.style.top = `${bar.top}px`;
    bootEl.style.width = `${bar.width}px`;
  }
  const first = brandEl?.getBoundingClientRect();
  document.body.classList.remove("booting");
  document.body.classList.add("playing");
  const last = brandEl?.getBoundingClientRect();
  if (brandEl && first?.width && last?.width) {
    const k = first.width / last.width;
    const dx = first.left + first.width / 2 - (last.left + last.width / 2);
    const dy = first.top + first.height / 2 - (last.top + last.height / 2);
    brandEl.style.transition = "none";
    brandEl.style.transform = `translate(${dx}px, ${dy}px) scale(${k})`;
    // two frames: one for the browser to accept the start pose, one to leave it
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        brandEl.style.transition = "transform 980ms cubic-bezier(.28,.74,.22,1)";
        brandEl.style.transform = "";
      }),
    );
  }
  // the gauge goes out: down, dim and blurred, under the rising card
  bootEl.style.opacity = "0";
  bootEl.style.translate = "0 18px";
  bootEl.style.filter = "blur(3px)";
  bootEl.addEventListener("transitionend", () => bootEl.remove(), { once: true });
}

/** the spinner in the corner of the picture, once a wait is long enough to be one */
const BUSY_AFTER_MS = 400;
function watchNetwork(files: TimelapseFiles): void {
  const netbusy = document.getElementById("netbusy") as HTMLDivElement;
  let timer = 0;
  files.onBusyChange = (inFlight) => {
    if (inFlight > 0) {
      if (timer || !netbusy.hidden) return;
      timer = window.setTimeout(() => {
        timer = 0;
        netbusy.hidden = false;
      }, BUSY_AFTER_MS);
      return;
    }
    if (timer) clearTimeout(timer);
    timer = 0;
    netbusy.hidden = true;
  };
}

/* ------------------------------------------------------------------------- *
 * The boot
 * ------------------------------------------------------------------------- */

async function main(): Promise<void> {
  say(`Timelapse RE ${VERSION} — the 1996 discs on this port`, "step");

  const files = await TimelapseFiles.open();
  if (!files.size) {
    say("the manifest indexed nothing: is timelapse/gamefiles/ there?", "warn");
    progress(1, "no disc");
    showLog(true);
    return;
  }
  progress(INDEXED, `indexed ${files.size} names across four discs`);
  say(`indexed ${files.size} names across the rip`);
  files.onChunk = (_name, bytes) => netChunk(bytes);
  watchNetwork(files);
  meterTimer = window.setInterval(meterTick, TICK_MS);

  const host = new GameHost(
    files,
    audio,
    {
      log: (l) => say(`  ${l}`),
      hud: (t) => t && say(`  hud: ${t}`),
    },
    { screen: SCREEN },
  );
  /**
   * A real frame source before the boot runs, so `playmovie` is modal and the
   * game's own poll loops (`while stilldown()`, `forceupdate()`) advance — the
   * difference between a boot that completed and a game that runs.
   */
  host.session.nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));
  host.session.hasRealFrames = true;

  /**
   * The plan first, because it is where most of the list comes from — and reading
   * it is itself the BOOTFILE's own fetch, 98 KB.
   *
   * Which is also how the page finds out whether there is a rip at all. `files.size`
   * cannot answer that: the store names the fourteen installed files itself, since
   * the manifest does not list them, so an empty manifest still indexes fourteen
   * names and every count looks healthy. The BOOTFILE is the honest test — nothing
   * runs without it — and asking for it here is free, because `bootPlan` reads the
   * same 98 KB out of the cache on the next line.
   */
  progress(PLANNED, "reading the BOOTFILE");
  if (!(await files.load("bootfile"))) {
    say("no BOOTFILE: is the rip under timelapse/gamefiles/?", "warn");
    errEl.textContent = "no game data — press b for the log";
    progress(1, "no disc");
    showLog(true);
    return;
  }
  const plan = await host.bootPlan();
  const named = plan.resources.filter((n) => files.serverUrl(n));
  const notFiles = plan.resources.filter((n) => !files.serverUrl(n));
  say(
    `boot plan: ${named.length} resources (${named.join(", ")})` +
      (notFiles.length ? ` + ${notFiles.length} name(s) that are not files: ${notFiles.join(", ")}` : "") +
      `, ${plan.casts.length} casts, first room ` +
      `${plan.landingSet ?? "(none named — enterworld builds every name it opens)"}`,
    "step",
  );

  /**
   * The prefetch, weighed in bytes rather than in files.
   *
   * A count of fetches would put `p.stg` (118 KB) and `open.mov` (27 MB) a
   * thirteenth of the bar apart, which is a bar that races and then stops for a
   * minute. The manifest sizes every one of the thirteen — including the four in
   * the installer's tree, which it lists because this game's build tells the
   * walker to — so the denominator is exact. The total is printed anyway: it is
   * what the page believes it is about to move, and the log is where a wrong
   * belief shows up.
   */
  const prefetch = [...named, ...EXTRA];
  const unsized = prefetch.filter((n) => !files.sizeOf(n));
  say(
    `prefetching ${prefetch.length} files, ${fmtSize(prefetch.reduce((a, n) => a + files.sizeOf(n), 0))} by the ` +
      `manifest` +
      // Normally none: the manifest lists the installed tree because this game's
      // build tells the walker to (`include` in timelapse/vite.config.ts). Said
      // when it happens because it is the difference between a bar that means
      // something and one that guesses — and a manifest regenerated by hand
      // without that list is exactly how it would happen.
      (unsized.length ? ` — which does not size ${unsized.length} of them (${unsized.join(", ")})` : ""),
    "step",
  );
  bytesLeft = () => files.bytesLeft(prefetch);
  let arrived = 0;
  const missing: string[] = [];
  await Promise.all(
    prefetch.map(async (name) => {
      progress(charged, `opening ${name}`);
      const bytes = await files.load(name, (n) => {
        arrived += n;
        // The denominator GROWS rather than being fixed at the manifest's total,
        // and it stays that way now that the manifest sizes all thirteen: what
        // has landed plus what is still owed can only RISE, so a name nothing
        // could weigh — a manifest built without the installed tree, or a file
        // the game asks for that this list did not name — slows the bar down
        // instead of letting it arrive while bytes are still coming. It lands
        // exactly on the truth when the last remainder reaches zero.
        progress(PLANNED + (FETCHED - PLANNED) * (arrived / Math.max(1, arrived + files.bytesLeft(prefetch))));
      });
      if (!bytes) missing.push(name);
    }),
  );
  if (missing.length) {
    // said in the controls as well as in the log: a boot that is about to fail
    // for want of a file should not look like one that is about to work
    say(`${missing.length} of the prefetch is not on the discs: ${missing.join(", ")}`, "warn");
    errEl.textContent = `${missing.length} file(s) missing — press b for the log`;
  }
  bytesLeft = null;
  clearInterval(meterTimer);
  meterTimer = 0;

  /**
   * The version claim, asked of the files rather than of the web — and this page
   * was originally built to ask it.
   *
   * Container 0 carries the tag at the same offset in every format and both
   * engines (engine/src/df/version.ts), so this is the whole test: one number per
   * file, and a 1 anywhere would mean the port has to branch the way it does for
   * Dust. Read out of the cache now that the prefetch has been, so it costs one
   * extra fetch rather than six.
   */
  progress(0.97, "reading version tags");
  say("version tags:", "step");
  for (const name of ["bootfile", "i001.stg", "i.shp", "i.trk", "i001.mov", "p.stg"]) {
    const bytes = await files.load(name);
    if (!bytes) {
      say(`  ${name}: NOT IN THE INDEX`, "warn");
      continue;
    }
    say(`  ${name}: DreamFactory ${detectVersion(bytes) || "?"} (${fmtSize(bytes.byteLength)})`);
  }

  /** the engine's own frame loop, on the engine's own screen, blitted up */
  const loop = (now: number): void => {
    host.director.tick(now);
    host.director.render(plateCtx);
    ctx.drawImage(plate, 0, 0, canvas.width, canvas.height);
    void showLocation(host);
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);

  const s = host.session;
  /**
   * Slow the turn down, for looking at it.
   *
   * `?slowturn=8` in the URL, or `__tl.slowTurns(8)` from the console: it
   * multiplies the ramp's step interval and touches nothing else, so every offset
   * and every source column is exactly what it is at full speed — a turn is over
   * in about a third of a second, which is too quick to describe.
   */
  const slowTurns = (factor: number): number => {
    s.wipe.stepMs = RAMP_STEP_MS * Math.max(1, factor);
    say(`turns slowed ${Math.max(1, factor)}x (${s.wipe.stepMs.toFixed(1)} ms a step)`, "step");
    return s.wipe.stepMs;
  };
  const asked = Number(new URLSearchParams(location.search).get("slowturn") ?? 0);
  if (asked > 1) slowTurns(asked);

  /**
   * A handle on the running game, for the console.
   *
   * This page is meant to be REPORTED FROM: someone plays it in a browser and
   * says what went wrong, and the answer gets checked in a headless probe. When
   * the two disagree the probe is usually the one that is wrong — it builds its
   * state by jumping where a player builds it by playing — and without a way to
   * reach the same state HERE there is nothing to compare. So:
   *
   *     tl.jump(5, 90, 873)          // the cave with the lantern
   *     tl.eval('return (gGasKnob)') // any expression, in the game's own language
   *     tl.session.hitTestAt(316, 308)
   *
   * Debug only, and deliberately not on the two shipped games' pages.
   */
  (window as unknown as { __tl: unknown }).__tl = { host, session: s, files, slowTurns };
  (window as Window & { tl?: unknown }).tl = {
    host,
    session: s,
    director: host.director,
    /** `gotostage`, the boot library's own, so the arrival is the game's */
    jump: (stage: number, region: number, frame: number) =>
      s.sendEvent("sendtoboot", "", "gotostage", [stage, region, frame], "console"),
    /** one line of script, compiled and run — `tl.eval('return (pictotal)')` */
    eval: async (src: string) => {
      const inst = s.instanceFrom(compileScript(`code consoleeval ()\n\t${src}\nendcode\n`), "consoleeval");
      return inst ? (await s.interp.runHandler(inst, "consoleeval", [], { me: "consoleeval", target: "" })).value : null;
    },
  };

  /**
   * The input, BEFORE the boot rather than after it.
   *
   * `coldBoot()` does not return until the game hands control back, and on this
   * game that is not quick: `boot()` ends in `enterworld("I")`, which plays
   * `open.mov` as a MODAL film. Bound after it, nothing could be clicked or
   * skipped for the first minute of the page's life and the only way past the
   * opening was to wait it out.
   */
  bindInput(host, s);
  // ...and the director asks for a cursor of its own accord when the screen's
  // owner changes, which no pointer move would report (ScreenDirector.onCursor)
  host.director.onCursor = showCursor;
  if (COARSE) {
    say("touch: swipe to walk and turn · tap objects · double-tap to skip a film · SPACE opens the panel", "step");
  } else {
    // and where there IS a pointer, what it will be drawn with — see showCursor
    say(`mouse: ${Object.keys(TL_CURSORS).length} of the game's own cursors, out of tl.exe`, "step");
  }

  progress(1, "ready");
  await waitForStart();
  ensureAudio();
  raiseTitle();

  say("coldBoot()…", "step");
  const started = performance.now();
  try {
    await host.coldBoot();
    say(`boot returned after ${Math.round(performance.now() - started)} ms`, "step");
  } catch (e) {
    say(`!! coldBoot threw: ${(e as Error).message}`, "warn");
    errEl.textContent = `boot failed: ${(e as Error).message} — press b for the log`;
  }

  say(
    `stage ${s.stageName} · flat ${s.currentFlat} · ` +
      `${s.propRuntime.shops.size} shop(s) · ${s.actorRuntime.actors.size} actor(s) · ` +
      `screen owned by "${host.director.screenOwner()}"`,
    "step",
  );
  say(`fetched ${files.loads.length} file(s): ${files.loads.join(", ") || "(none)"}`);
  const absent = [...new Set(files.misses)].filter((m) => !files.serverUrl(m));
  say(
    absent.length
      ? `asked for ${absent.length} name(s) the rip does not have: ${absent.join(", ")}`
      : "every name the boot asked for is on the discs",
    absent.length ? "warn" : "step",
  );
}

/**
 * Where you are, and which way you are looking.
 *
 * Timelapse ships no `.SET` on any of its four discs, so there is no scene and
 * view to read the way there is in Titanic — but that does not mean the position
 * is unknowable. The BOOTFILE keeps it in globals and builds every flat name out
 * of them: `framename` is `curworldchar @ frametype @ region @ "." @ frame`, so
 * `i0001.330` is world I, an ordinary view (`0`), region 001, frame 330. The
 * FRAME is both the standpoint and the facing — turning left changes it exactly
 * as walking does — which is why there is no separate bearing to report.
 *
 * The game agrees, and says so itself: its `showloc()` is
 *
 *     message ("stage " @ curstagename @ ", region " @ numtostring (curregionnum)
 *              @ ", frame " @ numtostring (curframenum))
 *
 * fired after every move when `debugging` is on. This is that, plus the exits,
 * and without turning `debugging` on — which the game also reads for its
 * developer clicks (`optionkey() & shiftkey()` opens prop scripts and a testing
 * dialog) and would change how the game plays.
 */
const EXITS = ["forward", "back", "left", "right", "back-left", "back-right"] as const;
const ARROWS = ["↑", "↓", "←", "→", "↙", "↘"] as const;

/**
 * One slot of a `getframeaction` string, in words.
 *
 * The table is six space-separated words, one per direction, and the verbs are
 * the ones `transitionaction` switches on: `J` jumps to a frame, `TL`/`TR` turn
 * to one, `G` crosses to another region, `S` to another stage. `X` is the game
 * saying NO — a direction it does not offer from here, which is worth showing as
 * such rather than as a blank, because a refused key is the commonest thing to
 * mistake for a broken one.
 */
function exitText(word: string): string {
  if (!word || word === "X") return "—";
  const [verb, ...rest] = word.split(".");
  const where = rest.join(".");
  if (verb === "J") return `→${where}`;
  if (verb === "TL") return `↺${where}`;
  if (verb === "TR") return `↻${where}`;
  if (verb === "G") return `region ${rest[0]}, frame ${rest[1] ?? "?"}`;
  if (verb === "S") return `stage ${where}`;
  return word;
}

let lastLoc = "";

/**
 * Refresh the readout, but only when the position actually changed — it is
 * called from the frame loop, and asking the stage for its exit table is a script
 * dispatch rather than a field read.
 */
async function showLocation(host: GameHost): Promise<void> {
  const s = host.session;
  const g = (n: string): string => String(s.interp.globals.get(n) ?? "");
  const frame = g("curframenum");
  const key = `${s.stageName}|${s.currentFlat}|${frame}`;
  if (key === lastLoc || s.scriptBusy) return;
  lastLoc = key;
  /**
   * The same line a bug report carries, so an issue says where it was opened —
   * and the FLAT leads it.
   *
   * A bug report's title is the first segment of this (site/src/bug-report.ts),
   * and led by the world it read "Bug in world I" on every report this game will
   * ever produce. The flat name is the one identifier that is unique and compact:
   * `i0001.100.6` is world I, region 001, frame 100, variant 6 — which is both
   * what a triager would grep the discs for and what `tl.jump()` takes.
   */
  currentWhere =
    `flat ${s.currentFlat} · world ${g("curworldchar") || "?"} · ` +
    `stage ${g("curstagename") || s.stageName} · region ${g("curregionnum")} · frame ${frame}`;
  const where =
    `<b>world ${g("curworldchar") || "?"}</b>  stage ${g("curstagename") || s.stageName}  ` +
    `region ${g("curregionnum")}  <b>frame ${frame}</b>  <i>${esc(s.currentFlat)}</i>`;
  locEl.innerHTML = where;
  if (s.stageName === "none") return;
  // the stage's own table of where each direction leads
  const action = String(
    (await s.sendEvent("sendtostagefx", s.stageName, "getframeaction", [Number(frame)], s.stageName)) ?? "",
  );
  if (lastLoc !== key) return; // moved again while we asked
  const words = action.trim().split(/\s+/);
  const exits = EXITS.map((name, i) => `${ARROWS[i]} ${esc(exitText(words[i]))}`).join("   ");
  locEl.innerHTML = `${where}\n<i>${exits}</i>`;
}

/**
 * Framebuffer coordinates for a pointer event.
 *
 * Against {@link SCREEN}, not against `canvas.width`: the canvas is the doubled
 * plate, and the engine's coordinates are the 640x480 the game thinks in.
 */
function canvasCoords(e: { clientX: number; clientY: number }): { x: number; y: number } {
  const r = canvas.getBoundingClientRect();
  return {
    x: Math.round(((e.clientX - r.left) / r.width) * SCREEN.width),
    y: Math.round(((e.clientY - r.top) / r.height) * SCREEN.height),
  };
}

/**
 * The pointer, drawn the way Timelapse drew it.
 *
 * This game navigates BY CURSOR. 11,031 of the 13,200 `cursor(...)` calls on the
 * discs are `godown` and `goup` — "you can back up from here", "you can step
 * forward here" — over regions that look like nothing at all, so in the game
 * itself the cursor is the only thing that says a picture has an exit. And both
 * of those two were redrawn for this game: the same names in Titanic's build are
 * plain arrows (`tools/dumpcursors.ts` has the comparison).
 */
const cursors = new CursorSheet(TL_CURSORS);

/** the name last answered, so a window resize can redraw it at the new size */
let cursorShown = "";

/**
 * Show what the thing under the pointer asked for.
 *
 * An empty answer is the ARROW and not the browser's default: `CURS.ARROW` is the
 * window class's cursor in `tl.exe`, which is what the player sees everywhere no
 * script has claimed the pointer — so it is this game's arrow that belongs over
 * its own picture, not the host operating system's.
 *
 * Scaled against {@link SCREEN} rather than against the canvas, for the reason
 * {@link canvasCoords} is: these were drawn for a 640-wide screen, and what they
 * have to match is how big that screen is being SHOWN. The canvas is twice the
 * game's own width, so dividing by it would ask for a cursor half the size the
 * artist drew.
 */
function showCursor(name: string): void {
  cursorShown = name;
  const rect = canvas.getBoundingClientRect();
  canvas.style.cursor = cursors.css(name || "arrow", rect.width / SCREEN.width);
}
addEventListener("resize", () => showCursor(cursorShown));

/**
 * The four region names Timelapse navigates with.
 *
 * Not a guess and not a heuristic: measured across all 156 stages, `up`, `down`,
 * `left` and `right` are **27,179 of the 29,105** clickable regions on the discs
 * — 93.4%, over 7,967 flats — and the remainder are objects (`hyperlink`,
 * `lefteye`, `hive`, `button10`…). Each one's `mousedown` is a single
 * `sendtoboot(keydown("right"))` and its `setcursor` shows a `goright` arrow, so
 * the game's primary navigation is a click on the edge of the picture with the
 * cursor as the affordance.
 *
 * Which is exactly why they are suppressed on a TOUCHSCREEN. The cursor does not
 * exist there — nothing hovers — so the affordance that makes edge-clicking
 * legible is missing, while the edge of the picture is precisely where a thumb
 * rests. And they are `button` regions, so without this they would take a finger
 * IMMEDIATELY, which means a swipe begun anywhere near an edge navigated by click
 * instead of swiping at all.
 *
 * Nothing is lost by it: the four directions these cover are the four a swipe
 * sends, and both routes end in the same `getframeaction` table.
 */
const NAV_REGIONS = new Set(["up", "down", "left", "right"]);

/**
 * Is this a machine that navigates by finger?
 *
 * `maxTouchPoints` OR the media query, the test the other two shells use: a laptop
 * with a touchscreen reports a FINE pointer while still delivering
 * `pointerType === "touch"`, so the gesture is live there and the edge regions
 * would be stolen there too.
 */
const COARSE = navigator.maxTouchPoints > 0 || matchMedia("(pointer: coarse)").matches;

function bindInput(host: GameHost, s: GameHost["session"]): void {
  /** a key a gesture or a keystroke means, on one route */
  const sendKey = (key: string, special = false): void => {
    // a gesture is never a held key: the boot's `keyrepeat` sets `isrepeat` and
    // its flat scripts read it, so a stale 1 from a leant-on arrow must not make
    // this look like a repeat
    s.interp.globals.set("isrepeat", 0);
    void host.director.keyDown(key, special);
  };

  /**
   * A navigation hotspot, on a machine that has no cursor to reveal it — the
   * edge regions a finger must not be given. See {@link NAV_REGIONS}.
   */
  const navHotspot = (x: number, y: number): boolean => {
    if (!COARSE) return false;
    const hit = s.hitTestAt(x, y);
    return hit.type === "button" && NAV_REGIONS.has(hit.name.toLowerCase());
  };

  /**
   * Which way the two swipe axes read, remembered per game.
   *
   * Its own storage prefix and not the other two shells': a player who inverted
   * Titanic's turn has said nothing about this one's.
   */
  const swipeInvert = bindSwipeInvert({
    storageKey: "timelapse.swipe",
    turnBox: document.getElementById("swipeInvertTurn") as HTMLInputElement | null,
    walkBox: document.getElementById("swipeInvertWalk") as HTMLInputElement | null,
    reveal: document.getElementById("swipeOpts"),
  });

  const touch = new TouchGestures({
    coords: (e: PointerEventLike) => canvasCoords(e),
    // props and flat regions take their press at once so a drag works; the
    // picture itself keeps the wait, because swiping the picture is how a phone
    // walks. `hitTestAt` answers this with no room, which is the whole reason
    // the recogniser ports to a SET-less game unchanged.
    //
    // ...except the navigation regions, which on touch are not controls at all:
    // owning the finger there is what stopped a swipe from the edge being a swipe.
    ownedByGame: (x, y) => {
      if (navHotspot(x, y)) return false;
      const kind = s.hitTestAt(x, y).type;
      return kind === "prop" || kind === "button";
    },
    press: (x, y) => {
      // and a TAP on one is not a click either: on a phone the edge of the
      // picture is where a thumb rests, and walking on a resting thumb is worse
      // than not walking. Swipe is the whole navigation there.
      if (navHotspot(x, y)) return;
      s.pointerDown = true;
      void s.track(host.director.press(x, y), `press ${x},${y}`);
    },
    release: (x, y) => {
      if (!s.pointerDown) return; // the press was suppressed: nothing to let go of
      s.pointerDown = false;
      host.director.release(x, y);
    },
    sendKey: (key: GestureKey, special: boolean) => sendKey(key, special),
    // read at RELEASE, so a box ticked mid-gesture applies to that gesture
    invert: () => swipeInvert,
  });

  canvas.addEventListener("pointerdown", (e) => {
    const { x, y } = canvasCoords(e);
    s.setPointer(x, y);
    // a finger is ambiguous until it moves or stays put — see TouchGestures
    if (e.pointerType === "touch") {
      touch.down(e);
      return;
    }
    s.pointerDown = true;
    // and ask again once the click has been dealt with: a click that walks or
    // turns changes what is under a pointer that has not moved, and a mouse at
    // rest gets no move event to notice it with
    void host.director
      .press(x, y)
      .then(() => say(`click ${x},${y} · flat ${s.currentFlat}`))
      .then(() => host.director.hover(x, y))
      .then(showCursor);
  });

  // on the window, not the canvas: a drag that ends off-canvas still has to end
  addEventListener("pointermove", (e) => {
    const { x, y } = canvasCoords(e);
    s.setPointer(x, y);
    if (touch.owns(e)) {
      touch.move(e);
      return;
    }
    // the cursor the thing under the pointer asks for, through the same chain
    if (e.pointerType !== "touch") void host.director.hover(x, y).then(showCursor);
  });

  addEventListener("pointerup", (e) => {
    if (touch.up(e)) return;
    if (!s.pointerDown) return;
    s.pointerDown = false;
    const { x, y } = canvasCoords(e);
    host.director.release(x, y);
  });

  /** a gesture the browser took away (a system edge-swipe) */
  addEventListener("pointercancel", (e) => touch.cancel(e));

  /**
   * The SPACE button — the one game KEY this page draws, and the only way to the
   * interface panel on a machine with no keyboard.
   *
   * SPACE is Timelapse's interface key: `interfacekey(" ")` toggles
   * `begininterface(1)`, which is `P.Stg` — the journal, the camera and the saved
   * games. A phone has no space bar, so without this the panel is unreachable.
   *
   * A button and not a gesture, deliberately. Every tap-shaped gesture left is on
   * the PICTURE, where a tap the recogniser rules wrongly opens whatever was
   * underneath it — and the panel is not somewhere to arrive by accident, nor to
   * fail to reach because two fingers landed 30 ms apart. `click` rather than
   * `pointerdown` for the same reason: it fires where a button fires, and it can
   * be reached with the keyboard.
   */
  document.getElementById("spacekey")?.addEventListener("click", () => sendKey(SPACE_KEY));

  addEventListener("keydown", (e) => {
    if (e.metaKey || e.ctrlKey) return;
    /**
     * A key that belongs to whatever has focus is not the game's.
     *
     * This listens on `window`, and the page has buttons — and a focused button
     * is worked with SPACE, which is exactly the key one of them sends. Without
     * this, tabbing to it and pressing space would fire the control AND the game,
     * and the `preventDefault` below would stop it being pressed by keyboard at
     * all. `focusOwnsKey` is the shared rule (engine/src/web/keys.ts): a text
     * field takes every key, a button takes Space and Enter, and the arrows still
     * walk while a control has focus.
     */
    if (focusOwnsKey(e.target, e.key)) return;
    // Escape is `"."` with the special marker, which is what the movie player
    // tests for — `"esc"` is a name nothing in the engine answers to, so it
    // reached the script chain and skipped no film (see ESCAPE_KEY)
    if (e.key === "Escape") {
      e.preventDefault();
      sendKey(ESCAPE_KEY, true);
      return;
    }
    /**
     * `b` is the log, and it does NOT go on to the game.
     *
     * Safe to take, and checked rather than assumed: the BOOTFILE's key router
     * (container 1, `keydown`) answers to the arrows, `w`/`s`/`a`/`d`, `z`/`c`
     * and the space — `b` is not one of them, so nothing is being intercepted
     * from the game here.
     */
    if (e.key === "b") {
      e.preventDefault();
      showLog(logEl.hidden);
      return;
    }
    const key =
      { ArrowUp: "uparrow", ArrowDown: "downarrow", ArrowLeft: "leftarrow", ArrowRight: "rightarrow" }[
        e.key
      ] ?? e.key.toLowerCase();
    e.preventDefault();
    sendKey(key);
  });
}

void main().catch((e) => {
  say(`!! ${(e as Error).stack ?? e}`, "warn");
  errEl.textContent = `${(e as Error).message ?? e} — press b for the log`;
  // whatever went wrong, the page must not be left as a title card over a bar
  // that never finished: the log IS the result on this game
  showLog(true);
  raiseTitle();
});
