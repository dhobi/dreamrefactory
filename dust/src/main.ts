/**
 * The Dust shell — *Dust: A Tale of the Wired West* (Cyberflix, 1995) rendered
 * by the Titanic port's own file layer.
 *
 * It began as an EXPERIMENT that shared `engine/src/df/` with the play page and
 * nothing else — no engine, no interpreter, no saves — answering one narrow
 * question by standing you in a room and letting you walk: how much of a
 * DreamFactory **1** disc can a DreamFactory **4** port read?
 *
 * The answer turned out to be most of it, and the page grew into the answer. It
 * now boots off the disc through the same {@link GameHost} Titanic uses, plays
 * the intro films through the engine's own `MoviePlayer`, and saves and loads
 * `.rtd` through the shared save browser. What is left of the experiment is
 * {@link browse}, the standalone set walker, which {@link start} keeps as the
 * FALLBACK for a boot that cannot produce a viewer — a failure should leave
 * something on screen that says so and still shows the disc.
 *
 * ## What it is actually doing
 *
 * Everything below the SET header is shared between the two engines, which is
 * the finding this page exists to demonstrate:
 *
 *   - `container.ts` opens the file unmodified. The envelope never changed.
 *   - `image.ts` decodes the frames unmodified. Neither did the codec, nor the
 *     512x264 viewport, nor the palette entry shape.
 *   - `set-v1.ts` is the one new reader, and only because a v1 set's MOVEMENT
 *     model is older: a grid of cells and one flat table of transitions, where a
 *     turn and a walk are the same kind of record. Titanic's turn rings and roads
 *     are what that table later became — and `set-v1-to-v4.ts` puts the older
 *     table back into that shape, so {@link play} drives a real `SetViewer` and
 *     nothing above it knows which engine wrote the room.
 *
 * The set scripts handle exactly `uparrow`, `leftarrow` and `rightarrow`, which
 * is all the original had, so there is no fourth control to want.
 *
 * ## Why the BROWSER decodes every frame up front
 *
 * This is about {@link browse} and not about the game, which pays for the same
 * problem the play page's way.
 *
 * DreamFactory frames are DELTA-coded: several row modes copy from "the previous
 * image", meaning whatever the target buffer already holds. So a frame is only
 * correct if the frames before it were decoded into the same buffer, in the order
 * the file lays them out. The engine pays for that with a ring cache and a
 * careful walk (`engine/src/web/ring-cache.ts`); the browser pays for it by
 * decoding the whole set once, in container order, and keeping every result. A
 * set is ~150 frames at 512x264, so that is ~20 MB of indexed pixels and about a
 * second — a price worth paying to make the rendering unarguable rather than
 * clever, and a price the game does not pay because it does not need to.
 */
import { readContainerFile } from "@dreamfactory/engine/df/container";
import {
  decodeFrame,
  FrameBuffer,
  paletteToRGBA,
  indexedToRGBA,
} from "@dreamfactory/engine/df/image";
import { detectVersion } from "@dreamfactory/engine/df/version";
import {
  readSetFileV1,
  type SetFileV1,
  type V1Standpoint,
  type V1Transition,
} from "@dreamfactory/engine/df/set-v1";
import {
  readStgFile,
  readStgRegions,
  type StgRegion,
} from "@dreamfactory/engine/df/stg";
import { GameHost } from "@dreamfactory/engine/web/host";
import { swipeKey } from "@dreamfactory/engine/web/keys";
import {
  browseForLoad,
  browseForSave,
  savesOpen,
} from "@dreamfactory/engine/web/save-browser";
import { useSaveKind } from "@dreamfactory/engine/web/save-store";
import {
  DUST_SAVES,
  dustTemplate,
  loadDustTemplate,
  seedDustSaves,
} from "./saves";
import { setScreenGamma } from "@dreamfactory/engine/web/screen-gamma";
import { DustFiles } from "./files";
import {
  DeferredAudioSink,
  WebAudioSink,
} from "@dreamfactory/engine/runtime/audio";
import { siteUrl } from "@dreamfactory/site/site";
import { VERSION } from "@dreamfactory/site/version";
import { installBugReport } from "@dreamfactory/site/bug-report";

/** the frame as the file stores it */
const VIEW_W = 512;
const VIEW_H = 264;
/**
 * The screen, at the size the play page uses — 1024x768.
 *
 * Which is exactly 2x a DreamFactory screen, and that is the reason for it
 * rather than a coincidence: the engine draws 512x384, of which the top 264 rows
 * are the view through the camera and the bottom 120 are the control panel. So
 * the view goes at the top at an integer 2x and the remaining 240 rows are the
 * panel's, left black until HOUSE.PRP is readable. Fitting the view to the whole
 * canvas instead would centre it, which is the one thing the original never does.
 */
const SCREEN_W = 1024;
const SCREEN_H = 768;
const SCALE = 2;
/** the engine's whole screen, which the control panel is drawn at */
const FLAT_W = 512;
const FLAT_H = 384;

/**
 * The stage the boot opens, and the flat inside it that is the frame around
 * everything.
 *
 * Not a guess and not configuration: Dust's BOOTFILE ends
 * `openstagefile("new.flt")`, and `readBootPlan` picks that name out of it
 * unmodified. `mainpanel` is the first flat in the file, which is the one the
 * stage shows on arrival — the same role `main.stg`'s `main 1` plays in Titanic.
 */
const BOOT_STAGE = "NEW.FLT";
const BOOT_FLAT = "mainpanel";
/**
 * How many animation frames a picture is held for.
 *
 * Counted in rAF ticks rather than milliseconds, and that is not a detail. The
 * original paces itself exactly this way: TI.EXE's frame throttle waits
 * `framerate(n)` ticks of 50/3 ms between pictures and ships with n = 3, which is
 * the 50 ms an engine step is. Three rAF ticks on a 60 Hz display is the same
 * 50 ms, arrived at by counting the display's own beat instead of asking the wall
 * what time it is — so a slow tab drops frames rather than tearing through them,
 * which is what the original did too.
 */
const HOLD_TICKS = 3;

/**
 * DreamFactory 1 sends its palette to the screen VERBATIM, and that is measured
 * rather than assumed.
 *
 * TI.EXE runs every palette entry through a per-channel power curve on the way to
 * `AnimatePalette` — `pow(c / 255, 0.65) * 255` — which lifts the dark half hard
 * (32 becomes 66, 64 becomes 104) and is the reason a faithful DreamFactory 4 port
 * looks brighter than a verbatim one (see engine/src/web/screen-gamma.ts). Applying it here
 * too made Dust's night town look like dusk.
 *
 * DF.EXE does not do it. The three constants that curve is built from are all in
 * TI.EXE — the exponent 0.65 appears four times, with 1/255 and 255.0 beside it —
 * and in Dust's own engine, in all three of the builds it ships (DF386, DF486,
 * DFPENT), the exponent and the 1/255 are absent entirely. So there is no curve to
 * port and 1.0 is not a preference: it is what the palette bytes on the disc mean.
 */
const DF1_SCREEN_GAMMA = 1;

/** one animation frame, from the browser's own beat */
const tick = (): Promise<void> =>
  new Promise((r) => requestAnimationFrame(() => r()));

/**
 * Dust can be HEARD, and that is a measurement rather than an ambition.
 *
 * This page ran on a `NullAudioSink` — every sound the game asked for was decoded
 * and dropped. Which is not a missing luxury: it is the game's only way of
 * answering some things at all. A locked door is the case. NITE.SET's jail is shut
 * on day 1 and its script says so out loud —
 *
 *     if currentview () = "west" & pointinjail (arg)
 *         if lockjail ()  voicesound ("knock2")
 *         else            sendtoprop ("door", setupprop ("jail"))
 *
 * — so the whole difference between "this door is locked" and "this door is
 * broken" was a sound going into a bin. Measured on that click: the sink is
 * handed 13312 samples at 22050 Hz, a real six-tenths of a second of knocking,
 * out of a bank the reader already opens without a warning (all 26 of them do).
 *
 * The deferral is the play page's, for the play page's reason: an AudioContext may
 * only be built from a user gesture, so the session plays into this from the first
 * frame and the real sink is attached on one — which also starts whatever loops
 * the game began meanwhile (see DeferredAudioSink).
 *
 * THE GESTURE IS THE START BUTTON, and only that. This used to be a pair of
 * `{ once: true }` listeners on the window, which took the first click the player
 * happened to make and was wrong twice over: whatever that click was FOR arrived
 * with the audio still cold, and the theme the boot had started came in late, over
 * a room the player was already walking around in. A page that needs a gesture
 * should ask for one. So the boot ends on a button (see waitForStart) and this is
 * called from it, after `play` has run — which is the ordering that matters,
 * because the theme can only be started through a viewer and `playing` is what
 * holds it. `startTheme` is a no-op if the boot's own `setupsound` already had its
 * say (viewer.ts), so calling it here cannot double up.
 */
const audioSink = new DeferredAudioSink();
function ensureAudio(): void {
  if (audioSink.attached) return;
  try {
    audioSink.attach(new WebAudioSink());
  } catch {
    return; // no audio available in this browser
  }
  playing?.viewer?.startTheme();
}

const canvas = document.getElementById("screen") as HTMLCanvasElement;
const ctx = canvas.getContext("2d", { alpha: false })!;
/**
 * The frame is composed at 512x264 and blitted up, rather than written straight
 * into the big canvas a pixel at a time.
 *
 * `putImageData` cannot scale, so the choice is either this or 786432 manual
 * stores per frame. One `drawImage` with smoothing off is a nearest-neighbour
 * blit in the compositor, which is both faster and the same picture.
 */
const plate = document.createElement("canvas");
plate.width = FLAT_W;
plate.height = FLAT_H;
const plateCtx = plate.getContext("2d", { alpha: false })!;
const errEl = document.getElementById("err") as HTMLElement;
const verEl = document.getElementById("ver");
/* Just the version. The `dust-` prefix was there when this sat in a status
   line under the picture with nothing around it to say which page it
   belonged to; in the top bar it is a hand's width from a mark and a title
   that both say Dust, and the tag it names (dust-v*, deploy.yml) is still
   readable off it. */
if (verEl) verEl.textContent = `v${VERSION}`;

/**
 * The two levers the port adds: a fullscreen picture, and a bug report that
 * arrives with the screen attached.
 *
 * Both are the play page's, and the reporter is now literally the same module —
 * it moved to `site/` when this page wanted it, because a game may not import
 * another game (site/tests/layering.ts) and nothing in it was ever Titanic's
 * except the name it gave the downloaded PNG.
 */
const fsBtn = document.getElementById("fsBtn") as HTMLButtonElement | null;
const bugBtn = document.getElementById("bugBtn") as HTMLButtonElement | null;
const bugNote = document.getElementById("bugNote");
const stageEl = document.getElementById("stage") as HTMLElement;

/** where the player is, for the issue body: the trace line, kept as it changes */
let currentRoom = "";

// The STAGE, not the canvas: fullscreening the canvas hands the letterbox to the
// UA, and the picture is a fixed 512x384 either way — see #stage:fullscreen.
fsBtn?.addEventListener("click", () => {
  if (document.fullscreenElement) void document.exitFullscreen();
  else
    void stageEl
      .requestFullscreen()
      .catch((e: Error) => say(`fullscreen: ${e.message}`));
});
document.addEventListener("fullscreenchange", () => {
  if (fsBtn)
    fsBtn.textContent = document.fullscreenElement
      ? "⛶ Exit fullscreen"
      : "⛶ Fullscreen";
});

/** how long the screenshot's fate stays on screen before it is taken down */
const BUG_NOTE_MS = 6000;
if (bugBtn) {
  installBugReport(bugBtn, {
    canvas,
    shotName: "dust-bug.png",
    version: VERSION,
    where: () => currentRoom,
    // one disc, one language: there is nothing to choose between, and saying so
    // is more use in an issue than leaving the field out
    edition: () => "Dust CD (gamefiles/dustcd/)",
    log: (n) => logLines.slice(-n),
    note: (how) => {
      if (!bugNote) return;
      bugNote.textContent =
        how === "clipboard"
          ? "screen copied — paste it into the issue"
          : "screen saved — attach dust-bug.png to the issue";
      window.setTimeout(() => (bugNote.textContent = ""), BUG_NOTE_MS);
    },
  });
}
const logEl = document.getElementById("log") as HTMLPreElement;

/**
 * The log, and it is now the page's ONLY prose surface.
 *
 * The strip used to carry a live readout — room, scene, view, how many of the cast
 * are standing here and how many are in shot, and the canvas's backing size
 * against its CSS size. Each of those was added for a question (the last one for
 * "the actors look too big", where a number both ends could compare beat an
 * impression), and each of them then sat there overwriting itself sixty times a
 * second. Written HERE instead they become a trace: one line per move, scrollable,
 * next to the boot that produced the room they describe.
 *
 * Which is why this is module-scope and no longer a closure inside `runBoot`. It
 * appends rather than rebuilding `textContent`, because unlike a boot a trace has
 * no end, and it keeps only the last {@link LOG_MAX} lines for the same reason.
 */
const LOG_MAX = 400;
const logLines: string[] = [];
function say(line: string): void {
  logLines.push(line);
  if (logLines.length > LOG_MAX) {
    logLines.splice(0, logLines.length - LOG_MAX);
    logEl.textContent = `${logLines.join("\n")}\n`;
  } else {
    logEl.append(`${line}\n`);
  }
  // scrollTop forces layout, so only when there is something to scroll
  if (!logEl.hidden) logEl.scrollTop = logEl.scrollHeight;
}
/** the title card, which rises rather than leaving — see #brand in dust/index.html */
const brandEl = document.getElementById("brand") as HTMLImageElement | null;
/** the fuse: the bar, the burnt length, the boot's newest word, the percentage */
const bootEl = document.getElementById("boot") as HTMLElement;
const startEl = document.getElementById("start") as HTMLButtonElement;
const fuseEl = document.getElementById("fuse") as HTMLElement;
const burnEl = document.getElementById("burn") as HTMLElement;
const bootSayEl = document.getElementById("bootsay") as HTMLElement;
const bootPctEl = document.getElementById("bootpct") as HTMLElement;

/**
 * The boot's progress, as a count of something rather than a guess at a duration.
 *
 * A loading bar has two honest ways to be built and one dishonest one. The
 * dishonest one is a timer: pick two seconds, animate to full, and be wrong on
 * every machine that is not the one it was tuned on. The honest ones are a count
 * of work units and a fraction of bytes, and this boot has a clean supply of the
 * first: **fetches**. Dust's boot makes fourteen of them, and eight are named up
 * front by its own BOOTFILE — `unilib.snd, gang.cst, extra.cst, house.prp,
 * inven.prp, intro.mov, intro2.mov, new.flt` — which the port reads out as a
 * {@link BootPlan} before it runs a line of script. So the denominator is
 * discovered from the disc rather than written down here.
 *
 * The split between the two halves is measured too. On this machine a cold load
 * is 2.4 s, of which `coldBoot` is 1.08 s and everything before it 1.3 s — and
 * that front half is dominated by one thing, the fallback browser decoding a
 * whole set (~150 frames, see `load`). Hence {@link HEAD}: the front half is
 * genuinely about half the wait, so it gets to move the bar rather than leaving
 * it parked at zero for a second and then racing.
 */
const HEAD = 0.46;
/**
 * Fetches the boot makes that the plan does not name — its BOOTFILE, the room it
 * settles into, and the room's own siblings. Measured (14 total against a plan of
 * 8, so 6), and only ever a FLOOR: `expect` below takes the larger of this and
 * what has actually arrived, so a disc that asks for more slows the bar down
 * instead of letting it reach 100% while work is still going on.
 */
const BOOT_TAIL = 6;

/** the four definite steps of the front half, and what to call each one */
const HEAD_STEPS: ReadonlyArray<readonly [number, string]> = [
  [0.02, "reading the disc index"],
  [0.1, "the control panel — new.flt"],
  [0.16, "a room, in case the boot fails"],
  [HEAD, "indexing the CD"],
];

/**
 * The network meter — one rolling window for the WHOLE loading page.
 *
 * Every byte the loader pulls down feeds this: the two fetches the head phase
 * makes itself (the panel and the fallback room) and every chunk the file store
 * streams afterwards. One window rather than one per phase, because a player
 * watching a bar does not care which of the page's code paths is doing the
 * fetching — they want to know whether anything is arriving and how fast.
 *
 * Sampled per CHUNK and read on a TIMER, and both halves of that matter. Measured
 * per completed file, on the arrival that completed it, the first thing the boot
 * fetches divides its whole size by a window that has barely opened: a 13 MB film
 * reported some tens of MB/s the instant it landed, and nothing at all for the
 * minute it spent arriving. On a slow connection that was the entire experience
 * of this loader — a frozen bar under a number that was never true.
 */
const WINDOW_MS = 3000;
/** the least window worth dividing by; under it there is no number to give */
const SETTLE_MS = 900;
const TICK_MS = 250;
const netSamples: { t: number; bytes: number }[] = [];
let netTotal = 0;
let meterTimer = 0;
/** the last thing the LOADER said, to fall back to when the wire goes quiet */
let idleCaption = "";
/** is the caption currently a rate, and therefore mine to replace? */
let rateShown = false;

/** every chunk of every fetch the loading page makes */
function netChunk(bytes: number): void {
  netSamples.push({ t: performance.now(), bytes });
  netTotal += bytes;
}

/**
 * Show the rate while bytes are arriving, and get out of the way when they are
 * not: a rate that survives the transfer it measured is the misleading thing,
 * and what the page has to say between fetches (which room it is opening, what
 * the boot just loaded) is better than a stale number.
 */
function meterTick(): void {
  const now = performance.now();
  while (netSamples.length && now - netSamples[0].t > WINDOW_MS) netSamples.shift();
  const span = netSamples.length ? now - netSamples[0].t : 0;
  const got = netSamples.reduce((a, x) => a + x.bytes, 0);
  const rate = span >= SETTLE_MS ? got / (span / 1000) : 0;
  if (rate) {
    bootSayEl.textContent = `${fmtRate(rate)} · ${fmtSize(netTotal)} so far`;
    rateShown = true;
  } else if (rateShown) {
    bootSayEl.textContent = idleCaption;
    rateShown = false;
  }
}

function startMeter(): void {
  if (!meterTimer) meterTimer = window.setInterval(meterTick, TICK_MS);
}
function stopMeter(): void {
  if (meterTimer) clearInterval(meterTimer);
  meterTimer = 0;
}

/**
 * A fetch whose bytes drive the bar between two marks, for the two files the
 * head phase pulls before the file store exists. `Content-Length` is what makes
 * the fraction possible; without one (a chunked or compressed response) the
 * bytes still feed the meter and the bar simply waits for the mark.
 */
async function fetchWatched(url: string, from: number, to: number): Promise<Response> {
  const res = await fetch(url);
  if (!res.ok || !res.body) return res;
  const total = Number(res.headers.get("content-length") ?? 0);
  let got = 0;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const reader = res.body!.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        got += value.byteLength;
        netChunk(value.byteLength);
        if (total > 0) progress(from + (to - from) * Math.min(1, got / total));
        controller.enqueue(value);
      }
      controller.close();
    },
  });
  return new Response(stream, { headers: res.headers, status: res.status });
}

/** "1.4 MB/s" or "830 KB/s" — whichever reads as a number rather than as noise */
function fmtRate(bytesPerSecond: number): string {
  return bytesPerSecond >= 1024 * 1024
    ? `${(bytesPerSecond / (1024 * 1024)).toFixed(1)} MB/s`
    : `${Math.max(1, Math.round(bytesPerSecond / 1024))} KB/s`;
}

/** "13.1 MB" or "412 KB" — how much has actually come down the wire */
function fmtSize(bytes: number): string {
  return bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** the bar only ever goes forwards, whatever order the answers arrive in */
let burnt = 0;
let shownPct = -1;
function progress(f: number, label?: string): void {
  burnt = Math.max(burnt, Math.min(1, f));
  const pct = Math.round(burnt * 100);
  if (pct !== shownPct) {
    shownPct = pct;
    burnEl.style.width = `${pct}%`;
    bootPctEl.textContent = `${pct}%`;
    fuseEl.setAttribute("aria-valuenow", String(pct));
  }
  // the caption is one line and the newest one wins: what a player watches for
  // two seconds is the engine naming what it just opened
  if (label) {
    idleCaption = label;
    bootSayEl.textContent = label;
    rateShown = false;
  }
}

/**
 * The title card rises, by FLIP.
 *
 * Measure where it is, switch the state, measure where it landed, then play the
 * difference back as a transform from the old rect to the new one. Which is not
 * ceremony: the two states size the image by DIFFERENT properties — centred by
 * `max-height: 46vh`, risen by `height: 100%` of a `clamp()`ed band — and a
 * transition between two sizing modes has nothing to interpolate. A transform
 * does, and it is the one property that animates without touching layout, which
 * matters here because the game's frame loop starts in the same frame this does.
 *
 * The fuse is PINNED before the switch and faded after it. It is a flex child of
 * the band the card is rising into, so the class change removes it from the
 * layout it is standing in; freezing it at the rect it already occupies lets it
 * fade out where the player last saw it instead of jumping to the top with the
 * logo.
 */
/** a real pause, for the one place that wants to be SEEN rather than be quick */
const hold = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

/**
 * The boot is done; wait to be told to go.
 *
 * Held open for {@link BURN_OUT} first, because the fuse's own `width` transition
 * is 380ms and swapping it out the instant the number says 100 means the bar never
 * visibly arrives — the whole point of counting fetches was to earn that end, so
 * it gets to be watched reaching it.
 *
 * Then the gauge crossfades to the button in the same slot (a fixed-height #boot,
 * see the styles) and the button takes focus, so this is a keyboard gesture as
 * much as a pointer one — Enter and Space are what a focused button already does,
 * and the AudioContext accepts either.
 */
const BURN_OUT = 520;
async function waitForStart(): Promise<void> {
  await hold(BURN_OUT);
  bootEl.classList.add("ready");
  startEl.focus();
  await new Promise<void>((resolve) =>
    startEl.addEventListener("click", () => resolve(), { once: true }),
  );
}

let risen = false;
function raiseTitle(): void {
  if (risen) return; // the failure paths can both reach here; the move happens once
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
        brandEl.style.transition =
          "transform 980ms cubic-bezier(.28,.74,.22,1)";
        brandEl.style.transform = "";
      }),
    );
  }
  // the fuse burns out: down, dim, and blurred, under the rising card
  bootEl.style.opacity = "0";
  bootEl.style.translate = "0 18px";
  bootEl.style.filter = "blur(3px)";
  bootEl.addEventListener("transitionend", () => bootEl.remove(), {
    once: true,
  });
}

/** the sets on the disc, in the order the CD lists them — resolved through
 *  siteUrl like every URL a page builds, so the page runs from any directory */
const SET_DIR = siteUrl("gamefiles/dustcd/DATA/");

/** the control panel: a full-screen flat, and the buttons drawn on it */
interface Panel {
  pixels: Uint8Array;
  rgba: Uint8ClampedArray;
  regions: StgRegion[];
}

/**
 * The panel, fetched once and kept across set changes — which is what the
 * engine does with it too. `openstagefile` happens in `boot()`, before any room
 * is opened, and the stage outlives every `opensetfile` after it.
 */
let panel: Panel | null = null;

interface Loaded {
  name: string;
  set: SetFileV1;
  /** indexed pixels per frame container, decoded in file order */
  frames: Map<number, Uint8Array>;
  /** which palette is in force */
  clut: number;
}

let live: Loaded | null = null;
let at: V1Standpoint | null = null;
let animating = false;

const key = (s: V1Standpoint): string => `${s.x},${s.z},${s.facing}`;

/**
 * The rotational order of the facing IDs, read out of the file rather than
 * assumed.
 *
 * The IDs are not in compass order — APOTH turns 1 -> 3 -> 2 -> 4 -> 1 one way
 * round and the reverse the other — so "which way is right" cannot come from
 * comparing numbers. Every cell carries both cycles as eight turn records, so
 * the answer is simply the two turns leaving the standpoint we are on, taken in
 * the order the register stores them: the register groups one whole cycle before
 * the other, which makes the first the consistent sense across the set.
 */
function turnsFrom(set: SetFileV1, s: V1Standpoint): V1Transition[] {
  return set.transitions.filter(
    (t) => t.kind === "turn" && key(t.from) === key(s),
  );
}
function walkFrom(set: SetFileV1, s: V1Standpoint): V1Transition | undefined {
  return set.transitions.find(
    (t) => t.kind === "walk" && key(t.from) === key(s),
  );
}

/**
 * The picture of standing at a standpoint.
 *
 * The HI-RES still first — the big frame at the tail of a slot, which every
 * standpoint on the disc has exactly one of (see `set-v1.ts`). That is what the
 * original shows you while you are stopped; the move's own frames are the low-res
 * ones it flicks through on the way. Preferring it is not just fidelity, it is
 * also visibly sharper.
 *
 * Falling back to a move's last frame covers the standpoint whose still failed to
 * decode. Its arrival frame is the same view at lower detail, which is a better
 * answer than a black screen.
 */
function stillAt(l: Loaded, s: V1Standpoint): Uint8Array | null {
  for (const t of l.set.transitions) {
    if (key(t.from) !== key(s) || t.departureStill < 0) continue;
    const px = l.frames.get(t.departureStill);
    if (px) return px;
  }
  for (const t of l.set.transitions) {
    if (key(t.to) !== key(s) || !t.frames.length) continue;
    const px = l.frames.get(t.frames[t.frames.length - 1]);
    if (px) return px;
  }
  return null;
}

const rgbaOf = (l: Loaded): Uint8ClampedArray =>
  paletteToRGBA(l.set.cluts[l.clut]?.raw ?? l.set.paletteRaw, 256);

/**
 * Compose the screen the way the engine does: the stage's flat underneath, the
 * room's view over its top 264 rows.
 *
 * Two palettes in one picture, which an 8-bit engine could not do — the original
 * `clut()`s between them and the panel is authored to survive whichever room's
 * palette is loaded. A port drawing in truecolour has no such constraint, so each
 * half is colourised through its own file's palette and comes out as its author
 * meant it rather than as the hardware forced it.
 */
function paint(px: Uint8Array): void {
  if (!live) return;
  if (panel) {
    const flat = plateCtx.createImageData(FLAT_W, FLAT_H);
    indexedToRGBA(panel.pixels, FLAT_W, FLAT_H, panel.rgba, flat.data);
    plateCtx.putImageData(flat, 0, 0);
  } else {
    plateCtx.fillStyle = "#000";
    plateCtx.fillRect(0, 0, FLAT_W, FLAT_H);
  }
  const view = plateCtx.createImageData(VIEW_W, VIEW_H);
  indexedToRGBA(px, VIEW_W, VIEW_H, rgbaOf(live), view.data);
  plateCtx.putImageData(view, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(plate, 0, 0, FLAT_W * SCALE, FLAT_H * SCALE);
}

function clearScreen(): void {
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, SCREEN_W, SCREEN_H);
}

/**
 * Open the boot stage and decode its opening flat.
 *
 * The same two readers the play page uses — `readStgFile` now reads both engines,
 * because a v1 `.FLT` is a v4 `.STG` with a shorter header and a 28-byte flat
 * record instead of 46. Nothing here knows which it got.
 */
async function loadPanel(span?: { from: number; to: number }): Promise<void> {
  const res = span
    ? await fetchWatched(SET_DIR + BOOT_STAGE, span.from, span.to)
    : await fetch(SET_DIR + BOOT_STAGE);
  if (!res.ok) return;
  const stg = readStgFile(new Uint8Array(await res.arrayBuffer()));
  const flat =
    stg.flats.find((f) => f.name.toLowerCase() === BOOT_FLAT) ?? stg.flats[0];
  if (!flat?.locationFrame) return;
  const art = stg.file.containers[flat.locationFrame];
  if (!art || art.gap) return;
  const fb = new FrameBuffer();
  const d = decodeFrame(art.data, fb);
  if (d.width !== FLAT_W || d.height !== FLAT_H) return;
  panel = {
    pixels: fb.pixels.slice(0, FLAT_W * FLAT_H),
    rgba: paletteToRGBA(stg.paletteRaw, 256),
    regions: flat.locationClickLogic
      ? readStgRegions(
          stg.file.containers[flat.locationClickLogic]?.data ??
            new Uint8Array(),
          stg.version,
        )
      : [],
  };
}

function show(): void {
  if (!live || !at) return;
  const px = stillAt(live, at);
  if (px) paint(px);
  const walk = walkFrom(live.set, at);
  say(
    `${live.set.setName || live.name} cell (${at.x},${at.z}) facing ${at.facing}` +
      ` · ${walk ? "walkable" : "wall ahead"}`,
  );
}

/** play a transition's frames, then stand at its far end */
async function move(t: V1Transition): Promise<void> {
  if (!live || animating) return;
  animating = true;
  canvas.classList.add("busy");
  try {
    for (const fr of t.frames) {
      const px = live.frames.get(fr);
      if (px) paint(px);
      for (let held = 0; held < HOLD_TICKS; held++) await tick();
    }
    at = t.to;
    show();
  } finally {
    animating = false;
    canvas.classList.remove("busy");
  }
}

async function load(name: string, span?: { from: number; to: number }): Promise<void> {
  errEl.textContent = "";
  // `span` is the boot's call, where this room is a multi-megabyte fetch the
  // player is waiting on; the browse controls call it without one, where the bar
  // is not on screen to move
  const res = span
    ? await fetchWatched(SET_DIR + name, span.from, span.to)
    : await fetch(SET_DIR + name);
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  const version = detectVersion(bytes);
  if (version !== 1)
    throw new Error(`${name} reports DreamFactory version ${version}, not 1`);
  const set = readSetFileV1(bytes);

  // decode every frame in FILE order, into one buffer, keeping each result —
  // see the note at the top of this file on why the order is not optional
  const file = readContainerFile(bytes);
  const fb = new FrameBuffer();
  const frames = new Map<number, Uint8Array>();
  for (let i = 0; i < file.containers.length; i++) {
    const c = file.containers[i];
    if (c.gap || c.data.length < 8) continue;
    try {
      const d = decodeFrame(c.data, fb);
      if (d.width === VIEW_W && d.height === VIEW_H) {
        frames.set(i, fb.pixels.slice(0, VIEW_W * VIEW_H));
      }
    } catch {
      /* not a frame — scripts, registers and the header all live here too */
    }
  }

  clearScreen();
  live = { name, set, frames, clut: 0 };
  at = set.transitions[0]?.from ?? { x: 0, z: 0, facing: 1 };
  const cells = new Set(set.transitions.map((t) => `${t.from.x},${t.from.z}`))
    .size;
  const stills = new Set(
    set.transitions
      .filter((t) => t.departureStill >= 0)
      .map((t) => key(t.from)),
  ).size;
  say(
    `${name}: v1 · ${set.gridWidth}x${set.gridHeight} grid, ${cells} standpoints · ` +
      `${set.transitions.length} moves · ${frames.size} frames · ${stills} stills · ${set.actors.length} cast · ` +
      `clut ${live.clut + 1}/${set.cluts.length}` +
      (panel
        ? ` · panel ${BOOT_FLAT} (${panel.regions.length} buttons)`
        : " · no panel") +
      (set.warnings.length ? ` · ${set.warnings.length} warnings` : ""),
  );
  show();
}

addEventListener("keydown", (e) => {
  // the browser's own controls, only while the GAME is not the one on screen
  if (playing) return;
  if (!live || !at || animating) return;
  if (e.target instanceof HTMLSelectElement) return;
  const turns = turnsFrom(live.set, at);
  if (e.key === "ArrowRight" && turns[0]) void move(turns[0]);
  else if (e.key === "ArrowLeft" && turns[1]) void move(turns[1]);
  else if (e.key === "ArrowUp") {
    const w = walkFrom(live.set, at);
    if (w) void move(w);
  } else if (e.key === "c" || e.key === "C") {
    live.clut = (live.clut + 1) % Math.max(1, live.set.cluts.length);
    say(`clut ${live.clut + 1}/${live.set.cluts.length}`);
    show();
    return;
  } else return;
  e.preventDefault();
});

/**
 * Open the panel and a first room, so a boot that fails still leaves something
 * on screen.
 *
 * This was a set BROWSER, with a `<select>` of every room on the disc: it was the
 * whole page before the game booted, and a jump-anywhere control after. The game
 * boots now, and a control that drops the camera into a room the story has not
 * reached is a debug tool sitting in the one strip this page has — so the picker
 * is gone and what it was built around stays, because that is the part the page
 * still needs: the panel first (exactly as `boot()` does it, openstagefile before
 * any room) and then a room, drawn straight out of its own move table with no
 * engine involved.
 *
 * The list comes from the gamefiles manifest the dev server and the build both
 * publish, so this page needs no directory listing of its own.
 */
async function browse(): Promise<void> {
  progress(...HEAD_STEPS[0]);
  const res = await fetch(siteUrl("gamefiles.json"));
  const manifest: Record<string, number> = res.ok ? await res.json() : {};
  const sets = Object.keys(manifest)
    .filter((p) => /^gamefiles\/dustcd\/DATA\/.+\.SET$/i.test(p))
    .map((p) => p.split("/").pop()!)
    .sort();
  if (!sets.length) {
    errEl.textContent = "no Dust sets found under gamefiles/dustcd/DATA/";
    return;
  }
  // the panel first, exactly as boot() does it: openstagefile before any room
  progress(...HEAD_STEPS[1]);
  await loadPanel({ from: HEAD_STEPS[1][0], to: HEAD_STEPS[2][0] }).catch(() => {
    /* the shell still works without it */
  });
  progress(...HEAD_STEPS[2]);
  // the room is the big one — a couple of megabytes, and then ~150 frames to
  // decode. Its bytes carry the bar from here to just short of the head's end,
  // leaving the last of the span for the decode that follows them.
  await load(sets.includes("APOTH.SET") ? "APOTH.SET" : sets[0], {
    from: HEAD_STEPS[2][0],
    to: HEAD - 0.06,
  });
}

/**
 * Run Dust's own BOOTFILE in the port's interpreter.
 *
 * Not a simulation of a boot and not a script of my own: `GameHost.coldBoot`, the
 * same call the play page makes, over a {@link DustFiles} instead of a
 * `FileStore`. It takes the no-landing-room path — the one the Titanic demo takes
 * — because `readBootPlan` finds no first room in Dust's boot, which is correct:
 * its `advanceday` lives in `new.flt` and is reached from the stage, not from
 * here.
 *
 * THE BOOT RUNS AFTER START, WITH THE FRAME LOOP LIVE — because the boot is the
 * opening of the game: BOOTFILE plays `intro.mov` and `intro2.mov` (chaining
 * `intro3.mov`) before it opens its menu stage. This page used to run the boot
 * headless behind the title card, where `playmovie` starts a film and moves on
 * (no frame source, nothing modal), and the report that ended that was exact:
 * "we start straight in the town — in the original there is a game dust mov
 * followed by a cyberflix mov first". `coldBoot` gives the films their surface
 * (DustFiles.serverSetNames — town.set as the movie host, under the boot's own
 * blackscreen) and `play(host)` before it is what makes `playmovie` block.
 *
 * The log still measures what it always did: which files the boot opened, which
 * it asked for and did not get, and where the globals ended up. `day = 1`,
 * `clock = 2`, `phase = 1` is Dust's boot having run to its last line.
 */
async function runBoot(): Promise<void> {
  // The boot's lines go to the log AND to the fuse's caption. The boot's own
  // words are better than any I could write there, because they name what
  // actually opened: `cast loaded: gang.cst (26 characters)` is the port doing
  // the thing this page exists to demonstrate. The log stays closed while it
  // scrolls past (`b` opens it) — a wall of text and a title card were fighting
  // for the same middle of the same page, and only one of them is the picture.
  const bootSay = (l: string) => {
    say(l);
    progress(burnt, l.trim());
  };
  progress(...HEAD_STEPS[3]);
  // the build the reader is looking at, first thing in its own account —
  // Dust versions separately from the TAOOT site (dust-v* tags, deploy.yml)
  bootSay(`Dust RE v${VERSION}`);
  const files = await DustFiles.open();
  bootSay(`indexed ${files.size} names off the Dust CD`);
  /**
   * Say when the game is waiting on the network, and only then — the play
   * page's corner spinner, delay and all (taoot/src/main.ts has the full argument).
   * Every room change fetches, so a mark that appeared the instant a fetch did
   * would strobe through ordinary play and mean nothing; waiting first means it
   * only ever appears when there is a wait to report. Invisible before Start by
   * construction: it lives inside #frame, which the page fades in with play.
   */
  const netbusy = document.getElementById("netbusy") as HTMLDivElement;
  const BUSY_AFTER_MS = 400;
  let busyTimer = 0;
  files.onBusyChange = (inFlight) => {
    if (inFlight > 0) {
      if (busyTimer || !netbusy.hidden) return;
      busyTimer = window.setTimeout(() => {
        busyTimer = 0;
        netbusy.hidden = false;
      }, BUSY_AFTER_MS);
      return;
    }
    if (busyTimer) {
      clearTimeout(busyTimer);
      busyTimer = 0;
    }
    netbusy.hidden = true;
  };
  /**
   * From here the bar is a FETCH COUNT — see HEAD/BOOT_TAIL above.
   *
   * `expect` is re-derived on every arrival rather than fixed once, and takes the
   * larger of the plan's own reckoning and one more than has landed. So the bar
   * cannot reach the end while the boot is still asking for things, and it cannot
   * go backwards when a disc asks for more than this one does.
   */
  let expect = BOOT_TAIL;
  /**
   * The caption under the bar is the TRANSFER RATE, not the filename — the names
   * scrolled by too fast to read once the intro films (13 MB) joined the
   * prefetch, and a rate is what a person staring at a loading bar actually
   * wants to know.
   *
   * Both halves of that — the number and the bar — are driven by CHUNKS on a
   * TIMER, and they have to be. Measured per completed file, on the arrival that
   * completed it, the first thing the boot fetches divides its whole size by a
   * window that has barely opened: a 13 MB film reported some tens of MB/s the
   * instant it landed, and nothing at all for the minute it spent arriving. On a
   * slow connection that is the entire experience of the loader — a frozen bar
   * under a number that was never true.
   *
   * So: a three-second rolling window of chunk samples, read by a ticker four
   * times a second, and no number at all until the window is wide enough to mean
   * something. When nothing is arriving the caption falls back to the total
   * downloaded, which is a fact that cannot go stale — rather than holding up the
   * last rate, which is the misleading thing.
   */
  files.onChunk = (_name, bytes) => netChunk(bytes);
  files.onFileLoaded = () => {
    expect = Math.max(expect, files.loads.length + 1);
    barFromFetches();
  };
  /**
   * The bar, from here on, is a FETCH COUNT plus the fraction of the fetches
   * still in flight — the count is the unit the boot's work is really in, and
   * the fraction is what fills the minute between one arrival and the next when
   * one of them is a 13 MB film (DustFiles.partialProgress).
   */
  const barFromFetches = (): void => {
    const done = files.loads.length + files.partialProgress();
    progress(HEAD + (1 - HEAD) * (done / expect));
  };
  const barTimer = window.setInterval(barFromFetches, TICK_MS);
  const host = new GameHost(files, audioSink, {
    log: bootSay,
    hud: (t) => t && bootSay(`  ${t}`),
  });
  /**
   * Give the session a real frame source before the boot runs.
   *
   * Without it `hasRealFrames` is false, `playmovie` starts a film and returns,
   * and any script poll loop (`while stilldown()`, `forceupdate()`) has nothing
   * advancing it. With it, the boot's intro plays modally and the game's own
   * loops work — which is the difference between a boot that completed and a game
   * that runs.
   */
  host.session.nextFrame = () =>
    new Promise<void>((res) => requestAnimationFrame(() => res()));
  /**
   * Save and load: the levers are Dust's own.
   *
   * `NEW.FLT`'s menu has SAVE and LOAD buttons which run the `savegame` /
   * `opengame` builtins — the same opcodes Titanic's CTL.STG uses, with Dust's
   * own version string ("Dust 0.3") — and those builtins block on these two
   * hooks (engine/src/runtime/builtins/savegame.ts). The original popped the Windows
   * Save As / Open dialogs there; a browser has neither, so both open the
   * in-app modal instead, over the IndexedDB store that stands in for the DOS
   * SAVE directory.
   *
   * Wired before the boot runs rather than after, because the boot is a script
   * and a script may save: BOOTFILE's own quit path offers to.
   */
  // This is a DreamFactory 1 game, and saves are the one place the engine has to
  // know: a save is a dump of the engine's own tables, and those are v1's here
  // (engine/src/runtime/session.ts).
  host.session.dfVersion = 1;
  host.session.onSaveGame = async (bytes) => {
    await browseForSave(bytes as Uint8Array, defaultSaveName(host), {
      log: say,
    });
  };
  host.session.onLoadGame = () => browseForLoad({ log: say });
  /**
   * The base a fresh game's first save is patched into.
   *
   * A save is a dump of the engine's live object graph and cannot be built from
   * nothing, so writing one means patching a real file (docs/engine/formats/savegame.md).
   * Once a game has been loaded from a file, `session.lastSave` supersedes this;
   * before that, one of the disc's own saves is the lender.
   */
  host.session.saveTemplate = () => dustTemplate();
  // The five saves that ship beside the disc, imported once into the store.
  // Off the critical path: it is a handful of 47 KB fetches, nothing the boot
  // waits for, and a failure only means the browser lists nothing this launch.
  void seedDustSaves(files.paths)
    .then(async (n) => {
      if (n) say(`seeded ${n} saved game${n === 1 ? "" : "s"} from the disc`);
      await loadDustTemplate();
    })
    .catch(() => {});
  const plan = await host.bootPlan();
  // the disc's own answer to "how much is there to do": eight names, read out of
  // Dust's BOOTFILE before a line of it runs
  expect = Math.max(expect, plan.resources.length + BOOT_TAIL);
  bootSay(`boot plan: ${plan.resources.join(", ") || "(none)"}`);
  bootSay(
    `  casts: ${plan.casts.join(", ") || "(none)"}  first room: ${plan.landingSet ?? "(none named)"}`,
  );
  /**
   * Everything the boot will play or open, fetched WHILE THE BAR IS UP — the
   * intro films alone are 13 MB, and the alternative is a black canvas
   * downloading them after the player already pressed Start. `intro3.mov` is
   * fetched too: no plan names it (INTRO2.MOV chains to it from its last
   * frame — df/mov-v1.ts), so left out it becomes a mid-intro stall exactly
   * where the story hands over.
   */
  await Promise.all(
    [...plan.resources, "town.set", "intro3.mov"].map((f) => files.load(f)),
  );
  clearInterval(barTimer);
  stopMeter();
  progress(1, "ready");
  files.onChunk = null;
  files.onFileLoaded = null; // the game loads for itself from here
  /**
   * START comes BEFORE the boot, not after it, because the boot IS the show:
   * BOOTFILE plays `intro.mov` and `intro2.mov` (which chains `intro3.mov`)
   * before it opens the menu stage, and for as long as the boot ran headless
   * behind this card the port skipped the whole opening — "we start straight
   * in the town". The click is also what browsers want before audio, so the
   * films play scored. `play(host)` first: it starts the frame loop and sets
   * `hasRealFrames`, which is what makes `playmovie` modal (the intro plays to
   * its end instead of being started and abandoned) and gives the movie player
   * something that renders it.
   */
  await waitForStart();
  /**
   * The canvas is NOT blank here: the fallback browser painted its preview room
   * onto it during the load, behind the title card — harmless when the game's
   * first frame was the town, but the game now opens on the intro films, and
   * raising the card revealed that preview for the second or two before
   * intro.mov's first frame ("there is one SET already rendered / visible
   * first"). The original starts black; so does this.
   */
  clearScreen();
  raiseTitle();
  play(host);
  ensureAudio();
  const started = performance.now();
  try {
    await host.coldBoot();
  } catch (e) {
    bootSay(`!! coldBoot threw: ${(e as Error).message}`);
  }
  const s = host.session;
  const g = (n: string) => s.interp.globals.get(n);
  bootSay(`boot returned after ${Math.round(performance.now() - started)} ms`);
  bootSay(
    `globals: day=${g("day")} clock=${g("clock")} phase=${g("phase")} handitem=${JSON.stringify(g("handitem"))}`,
  );
  bootSay(
    `keys: north=${JSON.stringify(g("keynorth"))} east=${JSON.stringify(g("keyeast"))} west=${JSON.stringify(g("keywest"))}`,
  );
  bootSay(
    `stage: ${s.stageName || "(none)"} · flat: ${s.currentFlat}` +
      ` · ${s.stageCtrl.stageFile?.flats.length ?? 0} flats` +
      ` · ${s.stageCtrl.currentFlatRegions().length} buttons on it`,
  );
  bootSay(
    `shops open: ${[...s.propRuntime.shops.keys()].join(", ") || "(none)"}`,
  );
  bootSay(
    `casts open: ${[...s.actorRuntime.casts.keys()].join(", ") || "(none)"}` +
      ` · ${s.actorRuntime.actors.size} actors`,
  );
  const missed = [...new Set(files.misses)].filter((m) => !files.has(m));
  bootSay(`asked for and never got: ${missed.join(", ") || "(nothing)"}`);
  bootSay(
    `room: ${s.currentSetFile || "(none)"} · viewer ${host.viewer ? "up" : "DOWN"}`,
  );
  if (host.viewer) {
    bootSay(
      "playing — arrows or W/A/D to move, space for a door, b for this log",
    );
  } else {
    // no viewer: what is on screen is black, so the log opens — at this point
    // the log IS the result.
    logEl.hidden = false;
  }
}

/**
 * The game, once it is booted: the same two lines the play page's frame loop is.
 *
 * `host.viewer` is a real {@link SetViewer} over a real {@link SetFile} — Dust's
 * set having been translated into that shape rather than read into one of its own
 * (engine/src/df/set-v1-to-v4.ts) — so there is nothing here that knows which engine
 * wrote the room. The rings, the hi-res settle, the prop and actor layers, the
 * transition modes: all of it is the port's, unchanged.
 */
let playing: GameHost | null = null;

function play(host: GameHost): void {
  playing = host;
  /**
   * A handle on the running game, for the console and for Playwright.
   *
   * The play page publishes `window.dbg` for the same reason (taoot/src/main.ts) and
   * this page had nothing, which made every question about the live state —
   * which props are visible, which actors the room thinks it has — unanswerable
   * from outside. An experiment whose state cannot be read is an experiment that
   * can only be judged by screenshots.
   */
  (window as unknown as { dust: unknown }).dust = {
    host,
    session: host.session,
    get viewer() {
      return host.viewer;
    },
  };
  logEl.hidden = true;
  const s = host.session;
  let shownRoom = "";
  let shownSize = "";
  let roomAsked = -Infinity;
  let sizeAsked = -Infinity;
  /**
   * From here on there IS a frame source, so say so.
   *
   * The boot deliberately runs without one (see runBoot) — nothing is driving
   * `viewer.tick` yet, so a modal `playmovie` would park the boot on its own
   * intro. The loop below drives it, which changes three answers at once and all
   * three matter:
   *
   *   - `playmovie` becomes MODAL, as it is in DF.EXE. INVEN.PRP's close-ups are
   *     written for that and only that: `screentoblack` · `blackscreen` ·
   *     `playmovie` · `clut("black")` · `blacktoscreen("set")`. Non-blocking, the
   *     fade back to the room runs while the film is still on screen.
   *   - `forceupdate` stops self-advancing the clock 50 ms a call. The rAF loop
   *     already advances it by REAL time, so doing both ran the sim clock at ~4x
   *     and left every later `delay` waiting for real time to catch up.
   *   - poll loops are spared the interpreter's runaway guard, which is what they
   *     are: `while stilldown()` waits on a hand, not on arithmetic.
   */
  s.hasRealFrames = true;
  say(
    `v1 · ${s.propRuntime.shops.size} shops · ${s.actorRuntime.actors.size} actors · ` +
      `stage ${s.stageName}`,
  );
  const loop = (now: number): void => {
    const v = host.viewer;
    if (v) {
      v.tick(now);
      v.render(ctx);
    }
    /*
     * The trace: where you are, and who else is here.
     *
     * The cast is placed by scripts running off the stage rather than by the set
     * (see ActorRuntime.settleStars), so "how many are standing here, and how many
     * can I see from where I am" is the one number that says whether that whole
     * chain worked — and it is not something a screenshot answers when the answer
     * is none.
     *
     * LOGGED ONLY WHEN IT CHANGES, and asked four times a second rather than
     * sixty. Standing still, the answer is the same every frame, and the scan
     * behind it walks all 54 actors and tests each against the camera — next to a
     * game loop that already has a whole screen to composite. Nothing this
     * describes can change faster than a walk, so 250ms cannot miss a move.
     */
    // ...but not while a film owns the screen: the boot's movie HOST is a real
    // room (town.set, pinned black under the intros — DustFiles.serverSetNames),
    // and the trace announcing "town — Scene G15" during the logos read as the
    // set flashing in when nothing but the movie was ever visible.
    if (now - roomAsked > 250 && !v?.moviePlaying) {
      roomAsked = now;
      const here = [...s.actorRuntime.actors.values()].filter(
        (a) => a.visible && a.setName === s.actorRuntime.currentSet,
      );
      const cam = s.activeCamera();
      const shown = cam
        ? here.filter((a) => s.actorRuntime.onScreen(a, cam)).length
        : 0;
      const room =
        `${s.currentSetFile || "?"} ${s.currentSceneName()} · ${s.currentViewName()}` +
        ` · ${here.length} here, ${shown} in view`;
      if (room !== shownRoom) {
        shownRoom = room;
        currentRoom = room;
        say(room);
      }
    }
    // The canvas's real size on the page, because the engine REWRITES its backing
    // store every frame (ScreenPresenter.blit pins it to the engine's own 512x384)
    // and only CSS decides how big that is drawn. Kept because it is what turned
    // "it looks too big" into a number both ends could compare.
    //
    // getBoundingClientRect FORCES LAYOUT, so it is asked once a second rather
    // than once a frame: it is a diagnostic about the window, and the window is
    // not what is moving.
    if (now - sizeAsked > 1000) {
      sizeAsked = now;
      const r = canvas.getBoundingClientRect();
      const size = `canvas ${canvas.width}x${canvas.height} drawn at ${Math.round(r.width)}x${Math.round(r.height)}`;
      if (size !== shownSize) {
        shownSize = size;
        say(size);
      }
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

/**
 * Keys, routed exactly as the play page routes them.
 *
 * Which matters most for the letters: Dust's boot maps `keynorth`/`keywest`/
 * `keyeast` — W, A and D — onto the arrow names itself, in its own keydown
 * handler, and then forwards to the scene. So the letters have to ARRIVE for the
 * game's own bindings to work, and dropping anything unrecognised here would
 * silently disable half of Dust's controls.
 */
addEventListener("keydown", (e) => {
  if (e.target instanceof HTMLSelectElement) return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  // a saved-games dialog is a modal: while it is up the game hears nothing, or
  // an arrow pressed while picking a save walks you down the street behind it
  if (savesOpen()) return;
  if (e.key === "b" || e.key === "B") {
    e.preventDefault();
    logEl.hidden = !logEl.hidden;
    return;
  }
  const host = playing;
  const v = host?.viewer;
  if (!host || !v) return;
  const arrow: Record<string, string> = {
    ArrowUp: "uparrow",
    ArrowDown: "downarrow",
    ArrowLeft: "leftarrow",
    ArrowRight: "rightarrow",
  };
  const name =
    arrow[e.key] ?? (e.key === " " ? " " : e.key === "Escape" ? "." : null);
  const ch = name ?? (e.key.length === 1 ? e.key.toLowerCase() : "");
  if (!ch) return;
  /**
   * Was this key HELD, rather than pressed?
   *
   * `isrepeat` is the engine's answer to that and 26 of Dust's scripts read it,
   * always the same way — as the guard on a thing that must happen once however
   * long the arrow is leant on:
   *
   *     if arg = "uparrow" & currentview () = "north" & propowner ("door") = "court"
   *         if isrepeat
   *             exitcode
   *         endif
   *         sendtostage (gotointerior ("court.set"))
   *
   * Nothing in the port ever set it, so it was always false and every one of those
   * guards was dead: a held arrow walked you through a door twice, and re-fired
   * whatever the standpoint does on arrival. The browser already knows the answer
   * (`KeyboardEvent.repeat`) and this is the only place that has it.
   *
   * Dust-only, and not because it would be wrong on the play page: no TAOOT script
   * mentions `isrepeat` at all, in any of the six editions.
   */
  host.session.interp.globals.set("isrepeat", e.repeat ? 1 : 0);
  void host.session.track(v.keyDown(ch, e.key === "Escape"));
  e.preventDefault();
});

/**
 * Which saves this page keeps: Dust's, in their own database.
 *
 * Said once, at module scope, before any store call — the store caches its
 * connection on first use, so declaring the kind late would read Titanic's
 * database and then quietly switch (engine/src/web/save-store.ts).
 */
useSaveKind(DUST_SAVES);

/** the pointer, in the canvas's own 512x384 coordinates */
function canvasCoords(e: PointerEvent | MouseEvent): { x: number; y: number } {
  const r = canvas.getBoundingClientRect();
  return {
    x: Math.floor(((e.clientX - r.left) / r.width) * FLAT_W),
    y: Math.floor(((e.clientY - r.top) / r.height) * FLAT_H),
  };
}

/**
 * Press, move, release — three listeners and not one, because Dust asks the
 * button a question a whole click cannot answer.
 *
 * This page used to call `viewer.click()`, which is a press with the release
 * already in it and `pointerDown` never set. That is enough for anything that
 * happens ON the press, which is why walking and doors and conversations all
 * worked — and it silently disables everything the game does by POLLING, because
 * `stilldown()` and `button()` read `session.pointerDown` and it was never true.
 *
 * Dust polls in two places a player lives in. Carrying an object is the first
 * (INVEN.PRP `stdmouse`): the held item is dragged out of the panel and dropped
 * on whoever should have it —
 *
 *     propdist (handitem, -30000)
 *     while stilldown ()
 *         propxy (handitem, pointx (arg), pointy (arg))
 *         forceupdate ()
 *         arg = mouse ()
 *     endwhile
 *     propdist (handitem, dist)
 *     propxy (handitem, 316, 320)
 *     for count = 1 to countactors ()
 *         if pointinactor (indextoactor (count), arg)
 *             sendtoactor (thename, offerobject (what))
 *
 * With the button never down that loop makes no passes, so `arg` is still the
 * press — which is the bone in the panel, where no actor and no room is — and
 * the item goes straight back to 316,320 having been offered to nobody.
 *
 * That was the SECOND gate on the same gesture. The first was that the click
 * never reached the prop at all (see BOOT_UI_SHOPS in engine/src/runtime/session.ts); this is
 * what stops it once it does.
 *
 * The second is the whole "would you like this?" screen (`handleselect`), a modal
 * pump that is nothing but `if button ()` around a `hittest` — with the button
 * stuck up it spins for ever and no click in it exists.
 *
 * `mouse()` needs the move for the same reason: a drag is a question about where
 * the pointer is NOW, and without pointermove it only ever answers where the
 * gesture started.
 */
canvas.addEventListener("pointerdown", (e) => {
  const host = playing;
  const v = host?.viewer;
  if (!host || !v) return;
  if (savesOpen()) return; // the dialog owns the screen (see the keydown above)
  const { x, y } = canvasCoords(e);
  host.session.setPointer(x, y);
  // a finger is ambiguous until it moves — see beginTouch
  if (e.pointerType === "touch") {
    beginTouch(e, x, y);
    return;
  }
  host.session.pointerDown = true;
  // what the press CARRIED: Dust reads `shiftkey()` inside its own mousedown
  // (HOUSE.PRP's HELP button, INVEN.PRP's debug `hotdist`), so the question is
  // what was held when the click happened, not what is held now.
  host.session.shiftDown = e.shiftKey;
  void host.session.track(v.press(x, y), `press ${x},${y}`);
});

// on the window, not the canvas: a drag that ends off-canvas still has to end.
addEventListener("pointermove", (e) => {
  const host = playing;
  if (!host?.viewer) return;
  const { x, y } = canvasCoords(e);
  host.session.setPointer(x, y);
  const g = touch;
  if (!g || e.pointerId !== g.id) return;
  if (g.pressed || g.swiped) return; // already committed either way
  if (Math.hypot(e.clientX - g.clientX, e.clientY - g.clientY) < SWIPE_MIN_PX)
    return;
  // committed to a swipe; the DIRECTION is read at release, off the whole
  // journey, so a wobbly first few pixels don't get to choose it
  g.swiped = true;
  clearTimeout(g.holdTimer);
});

addEventListener("pointerup", (e) => {
  if (touch && e.pointerId === touch.id) {
    endTouch(e);
    return;
  }
  const host = playing;
  if (!host?.viewer) return;
  host.session.pointerDown = false;
  host.viewer?.release(host.session.pointerX, host.session.pointerY);
});

// ---------------------------------------------------------------------------
// Touch: swipe to walk and turn, double-tap for ESCAPE
// ---------------------------------------------------------------------------

/**
 * The play page's gesture, on Dust's key route.
 *
 * A phone has no arrow keys, so a swipe across the canvas presses the arrow it
 * points at — up walks, left and right turn, down is down. The ambiguity is the
 * same as on the play page: a finger going down begins both a tap (a game click)
 * and a swipe (a key), so the mousedown is held back until the gesture declares
 * itself — travels far enough (a swipe, and NO click), lifts first (a tap), or
 * stays put past TAP_HOLD_MS (a press, handed over while the finger is still on
 * the glass, because Dust's inventory drag and its `handleselect` screen poll
 * `stilldown()`/`button()` and need the button genuinely down).
 *
 * The one difference from the play page is the dispatch: TAOOT's three movement
 * arrows go through pressNav past a possible overlay stage, but Dust routes ALL
 * keys through `keyDown` (see the keydown handler above — its boot script does
 * its own arrow mapping), so a swipe sends exactly what the keyboard would.
 */
/** CSS px a finger must travel before the gesture counts as a swipe */
const SWIPE_MIN_PX = 48;
/** a finger still on the glass this long is holding a control, not swiping */
const TAP_HOLD_MS = 220;
/**
 * Two taps in the same place this close together are the phone's ESCAPE — the
 * key a cutscene is skipped with. Only the SECOND tap is swallowed: the first
 * has already been sent as a click, because holding every tap back to see
 * whether another follows would put 300 ms of lag on every press in the game.
 */
const DOUBLE_TAP_MS = 320;
const DOUBLE_TAP_PX = 48;
let lastTapAt = 0;
let lastTapX = 0;
let lastTapY = 0;

interface TouchGesture {
  id: number;
  /** where the finger went down: CSS px (for the swipe) and canvas px (for the tap) */
  clientX: number;
  clientY: number;
  x: number;
  y: number;
  /** the game has been given its mousedown (a hold, being dragged) */
  pressed: boolean;
  /** ruled a swipe — no click will be sent */
  swiped: boolean;
  holdTimer: number;
}
let touch: TouchGesture | null = null;

/**
 * A finger that goes down on a CONTROL is never a swipe: a drag moves
 * immediately, and waiting TAP_HOLD_MS to disambiguate would rule Dust's
 * inventory drag (INVEN.PRP `stdmouse`, a `while stilldown()` loop) a swipe and
 * walk the camera instead of carrying the item. A prop or a stage button takes
 * the press at once; room surfaces keep the wait, because swiping the ROOM is
 * how a phone walks.
 */
function touchOwnedByGame(x: number, y: number): boolean {
  const kind = playing?.session.hitTestAt(x, y).type;
  return kind === "prop" || kind === "button";
}

function beginTouch(e: PointerEvent, x: number, y: number): void {
  if (touch) clearTimeout(touch.holdTimer);
  const control = touchOwnedByGame(x, y);
  const g: TouchGesture = {
    id: e.pointerId,
    clientX: e.clientX,
    clientY: e.clientY,
    x,
    y,
    pressed: false,
    swiped: false,
    holdTimer: control ? 0 : window.setTimeout(() => holdTouch(), TAP_HOLD_MS),
  };
  touch = g;
  if (control) holdTouch();
}

/** the finger stayed put: it is a press after all, so hand the mousedown over */
function holdTouch(): void {
  const g = touch;
  const host = playing;
  const v = host?.viewer;
  if (!g || g.pressed || g.swiped || !host || !v) return;
  g.pressed = true;
  host.session.pointerDown = true;
  host.session.shiftDown = false;
  void host.session.track(v.press(g.x, g.y), `press ${g.x},${g.y}`);
}

function endTouch(e: PointerEvent): void {
  const g = touch;
  if (!g) return;
  clearTimeout(g.holdTimer);
  touch = null;
  const host = playing;
  const v = host?.viewer;
  if (!host || !v) return;
  if (g.pressed) {
    // it was a hold: end it the way any other release does
    host.session.pointerDown = false;
    v.release(host.session.pointerX, host.session.pointerY);
    return;
  }
  if (g.swiped) {
    const key = swipeKey(
      e.clientX - g.clientX,
      e.clientY - g.clientY,
      swipeInvert,
    );
    if (key) sendGestureKey(key);
    return;
  }
  // a second tap in the same place, promptly: that is ESC, not a click
  const now = performance.now();
  if (
    now - lastTapAt < DOUBLE_TAP_MS &&
    Math.hypot(e.clientX - lastTapX, e.clientY - lastTapY) < DOUBLE_TAP_PX
  ) {
    lastTapAt = 0;
    sendGestureKey(".", true);
    return;
  }
  lastTapAt = now;
  lastTapX = e.clientX;
  lastTapY = e.clientY;
  // a tap: down and up at the point the finger landed, not where it lifted.
  // Not awaited between the two — press() may not resolve until a close-up it
  // opened is dismissed, and the mouseup belongs to the tap, not to the movie.
  host.session.pointerDown = true;
  host.session.shiftDown = false;
  void host.session.track(v.press(g.x, g.y), `press ${g.x},${g.y}`);
  host.session.pointerDown = false;
  v.release(g.x, g.y);
}

/** a gesture the browser took away (a system edge-swipe): forget it, act on nothing */
addEventListener("pointercancel", (e) => {
  const g = touch;
  if (!g || e.pointerId !== g.id) return;
  clearTimeout(g.holdTimer);
  touch = null;
  const host = playing;
  if (g.pressed && host?.viewer) {
    host.session.pointerDown = false;
    host.viewer.release(host.session.pointerX, host.session.pointerY);
  }
});

/** how the player has asked the two swipe axes to read */
const swipeInvert = { turn: false, walk: false };

/**
 * The two boxes in the strip, and their memory.
 *
 * Their own storage keys and not the play page's: this is a different game on a
 * different page, and a player who inverted Titanic's turn has said nothing
 * about Dust's.
 *
 * Shown only where a swipe is possible at all — a mouse has the arrow keys and
 * never reaches a gesture, so on a desktop the question is noise in a strip that
 * is otherwise one hint. `maxTouchPoints` as well as the media query, because a
 * laptop with a touchscreen reports a FINE pointer while still delivering
 * `pointerType === "touch"`: the gesture is live there, so the setting has to be
 * reachable.
 */
const SWIPE_INVERT_TURN_KEY = "dust.swipe.invertturn";
const SWIPE_INVERT_WALK_KEY = "dust.swipe.invertwalk";

function installSwipeOptions(): void {
  const touchable =
    navigator.maxTouchPoints > 0 ||
    window.matchMedia("(pointer: coarse)").matches;
  if (!touchable) return;
  const opts = document.getElementById("swipeOpts");
  const turnBox = document.getElementById(
    "swipeInvertTurn",
  ) as HTMLInputElement | null;
  const walkBox = document.getElementById(
    "swipeInvertWalk",
  ) as HTMLInputElement | null;
  if (!opts || !turnBox || !walkBox) return;
  opts.hidden = false;
  bindSwipeOption(
    turnBox,
    SWIPE_INVERT_TURN_KEY,
    (on) => (swipeInvert.turn = on),
  );
  bindSwipeOption(
    walkBox,
    SWIPE_INVERT_WALK_KEY,
    (on) => (swipeInvert.walk = on),
  );
}

/** a checkbox that remembers, and applies what it remembered before any gesture */
function bindSwipeOption(
  box: HTMLInputElement,
  key: string,
  apply: (on: boolean) => void,
): void {
  let stored: string | null = null;
  try {
    stored = window.localStorage.getItem(key);
  } catch {
    /* storage can be denied; the box then starts unchecked every launch */
  }
  box.checked = stored === "1";
  apply(box.checked);
  box.addEventListener("change", () => {
    apply(box.checked);
    try {
      window.localStorage.setItem(key, box.checked ? "1" : "0");
    } catch {
      /* not remembering is survivable — the setting still holds for this tab */
    }
  });
}

installSwipeOptions();

/** a key a gesture means, on the same route the keyboard uses */
function sendGestureKey(ch: string, isEsc = false): void {
  const host = playing;
  const v = host?.viewer;
  if (!host || !v) return;
  // a gesture is never a held key: don't let a stale 1 from a leant-on arrow
  // make an `isrepeat` door guard swallow the swipe
  host.session.interp.globals.set("isrepeat", 0);
  void host.session.track(v.keyDown(ch, isEsc));
}

/**
 * The name the save dialog offers: where you are, and when.
 *
 * The room rather than the day or the clock, because that is what a player
 * recognises a save by in a list of them — and the disc's own five are named the
 * same way by hand (START, DOG, GOTBONE).
 */
function defaultSaveName(host: GameHost): string {
  const room = host.session.currentSetFile?.replace(/\.set$/i, "") || "dust";
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${room} - ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}-${pad(d.getMinutes())}`;
}

/**
 * Boot the game. If it cannot produce a viewer, show the set browser instead.
 *
 * In that order and not the other way round, because the browser decodes every
 * frame of a set up front (~20 MB and about a second) and the game does not need
 * it. The fallback is the honest half of this: a boot that fails should leave
 * something on screen that says so and still shows the disc.
 */
async function start(): Promise<void> {
  setScreenGamma(DF1_SCREEN_GAMMA);
  startMeter();
  await browse();
  await runBoot();
}

start().catch((e) => {
  errEl.textContent = String(e);
  // a boot that threw has an account of itself and no picture: raise the card so
  // the log has the page, and stop the fuse where it stopped rather than leaving
  // it burning at whatever fraction it had reached
  progress(burnt, String(e));
  raiseTitle();
  logEl.hidden = false;
});
