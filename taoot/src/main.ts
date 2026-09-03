/**
 * The play page (play/index.html): everything the game needs from "a browser",
 * and nothing about the game itself. In file order — the deferred WebAudio sink,
 * the DOM handles, the {@link GameHost} and the page-flavoured session hooks
 * (dialogs, the rAF yield, the save browser), the boot + set picker, input, and
 * the requestAnimationFrame loop.
 *
 * Arriving here is already the decision to play: the welcome text and the Play
 * button are the front page (index.html), so this page has nothing to ask and
 * boots as soon as it knows which language to read.
 *
 * What it means to *run* the game — activating a set, prefetching, the cold
 * boot, resuming a save — is [`host.ts`](host.ts), which knows nothing about
 * the DOM and is therefore reachable from the tests; the file cache/fetch
 * logic is in files.ts.
 *
 * There is no dev harness here any more. The page used to carry a bar of
 * puzzle jumps, a row of story-state presets and a set dropdown, from when
 * every room had to be reachable without a route that could get there; the
 * game plays through now, so what they offered is the game itself, and the
 * editors and the browser suite cover what they were used for besides.
 */
import {
  DeferredAudioSink,
  WebAudioSink,
} from "@dreamfactory/engine/runtime/audio";
import {
  isMoveSpeed,
  isPictureMode,
  MOVE_SPEED_MS,
} from "@dreamfactory/engine/runtime/session";
import { GameHost } from "@dreamfactory/engine/web/host";
import { CursorSheet } from "@dreamfactory/engine/web/cursors";
import { TI_CURSORS } from "./cursor-art";
import { loadTemplates, saveTemplateFor, seedSaves } from "./save-seed";
import {
  browseForLoad,
  browseForSave,
} from "@dreamfactory/engine/web/save-browser";
import { TAOOT_SAVES, useSaveKind } from "@dreamfactory/engine/web/save-store";
import { readSaveFile } from "@dreamfactory/engine/df/savegame";
import { FileStore } from "./files";
import { loadClock, watchLoads } from "@dreamfactory/engine/web/load-clock";
import { InputLog, clickLabel, inputLabel, type Gate, type Hit } from "./input-log";
import { StateTrace, snapshotState } from "@dreamfactory/engine/runtime/trace";
import { seededRng } from "@dreamfactory/engine/runtime/rng";
import { LangChooser, chooserOrder, preselectedEdition } from "./lang-chooser";
import {
  GOG_URL,
  NIGHTDIVE_MOVIE,
  NightdiveIntro,
  Ownership,
  introPlaysFor,
} from "./nightdive";
import {
  DEFAULT_LANGUAGE,
  EDITION_STORAGE_KEY,
  LANG_STAGE,
  editionName,
} from "./languages";
import { installLanguageMenu } from "@dreamfactory/site/lang-menu";
import { VERSION, installVersion } from "@dreamfactory/site/version";
import {
  gamefileManifest,
  gamefileSizes,
  installEditionPicker,
  markEdition,
} from "./editions";
import { installI18n, t } from "@dreamfactory/site/locales";
import { installBugReport } from "@dreamfactory/site/bug-report";
import { LOG_LINES_KEPT, LogBuffer } from "./log-buffer";
import { stateDump } from "@dreamfactory/engine/web/debug-panel";
import { SPINE } from "./state-spine";
import { bindRememberedBox, installStateList } from "@dreamfactory/engine/web/state-list";
import { ESCAPE_KEY, focusOwnsKey } from "@dreamfactory/engine/web/keys";
import {
  GestureKey,
  PointerEventLike,
  TouchGestures,
  bindSwipeInvert,
} from "@dreamfactory/engine/web/touch";
import { siteUrl, sitePath } from "@dreamfactory/site/site";
import { TITANIC } from "@dreamfactory/site/games";
import {
  ALL_CHANNELS,
  DEFAULT_SCREEN_GAMMA,
  SCREEN_GAMMA_STEP,
  type GammaChannels,
  resetScreenGamma,
  screenGamma,
  setScreenGamma,
  stepScreenGamma,
} from "@dreamfactory/engine/web/screen-gamma";

// ---------------------------------------------------------------------------
// Audio: AudioContext must be created after a user gesture; the sink proxies
// until then
// ---------------------------------------------------------------------------

// The session plays into this from the first frame; the real WebAudio sink can
// only be built from a user gesture, and attaching it starts whatever loops the
// game began meanwhile (see DeferredAudioSink).
const audioSink = new DeferredAudioSink();
function ensureAudio(): void {
  if (audioSink.attached) return;
  try {
    audioSink.attach(new WebAudioSink());
  } catch {
    return; // no audio available in this browser
  }
  // covers the other case: a set that opened with no theme at all (startTheme
  // no-ops when one is registered — attach() has just restarted that one)
  host?.viewer?.startTheme();
}
window.addEventListener("pointerdown", ensureAudio, { once: true });
window.addEventListener("keydown", ensureAudio, { once: true });

// ---------------------------------------------------------------------------
// DOM handles + page state
// ---------------------------------------------------------------------------

/** what stands on the page until the framebuffer does — and stays if it never
 *  does, which is what "no game files served" looks like to a player */
const booting = document.getElementById("booting") as HTMLDivElement;
const stage = document.getElementById("stage") as HTMLDivElement;
const screen = document.getElementById("screen") as HTMLCanvasElement;
const minimap = document.getElementById("minimap") as HTMLCanvasElement;
const hud = document.getElementById("hud") as HTMLDivElement;
/**
 * The bar of settings under the screen, and everything in it.
 *
 * All optional, and that is not defensiveness — this module runs on TWO pages.
 * /play/ carries the bar; the speedrun workbench (/speedrun/, which loads this
 * same file to have a game at all) carries none of it, because fullscreen, a bug
 * button, the swipe options and the picture/brightness/low-memory rows are
 * questions about how the game should look to somebody playing it, and that page
 * is a stopwatch. So every one of these is asked for and may not be there, and
 * each use below says so rather than trusting the markup it happens to be in.
 */
const help = document.getElementById("help");
/** which copy of the game is being played, as buttons (site/src/lang-menu.ts).
 *  Absent on /speedrun/: a route is timed against one edition, English. */
const editionPicker = document.getElementById("editionPicker");
const fsBtn = document.getElementById("fsBtn") as HTMLButtonElement | null;
const bugBtn = document.getElementById("bugBtn") as HTMLButtonElement | null;
/** where the bug button says what became of the screenshot */
const bugNote = document.getElementById("bugNote");
/** which way a swipe reads — its own row, hidden unless the pointer is a finger */
const swipeOpts = document.getElementById("swipeOpts");
const swipeInvertTurnBox = document.getElementById(
  "swipeInvertTurn",
) as HTMLInputElement | null;
const swipeInvertWalkBox = document.getElementById(
  "swipeInvertWalk",
) as HTMLInputElement | null;
const pictureModeSel = document.getElementById(
  "pictureMode",
) as HTMLSelectElement | null;
const lowMemoryBox = document.getElementById(
  "lowMemory",
) as HTMLInputElement | null;
const brightnessSeg = document.getElementById("brightnessSeg");
const brightnessValue = document.getElementById("brightnessValue");
const movementSeg = document.getElementById("movementSeg");
const movementValue = document.getElementById("movementValue");
/** where you are and what the engine is doing: the X pane, off by default */
const details = document.getElementById("details") as HTMLDivElement;
const scriptlog = document.getElementById("scriptlog") as HTMLPreElement;
/** the state list inside the pane, and what asks for it (#22) */
const dbgStateOn = document.getElementById("dbgStateOn") as HTMLInputElement;
const dbgInputsOn = document.getElementById("dbgInputsOn") as HTMLInputElement;
const dbgState = document.getElementById("dbgState") as HTMLDivElement;
const dbgSpine = document.getElementById("dbgSpine") as HTMLDivElement;
const dbgRows = document.getElementById("dbgRows") as HTMLDivElement;
const dbgFilter = document.getElementById("dbgFilter") as HTMLInputElement;
const dbgAll = document.getElementById("dbgAll") as HTMLInputElement;
const dbgCopy = document.getElementById("dbgCopy") as HTMLButtonElement;
const dbgNote = document.getElementById("dbgNote") as HTMLSpanElement;
/** the preload bar under the boot text, and the megabytes beside it */
const preload = document.getElementById("preload") as HTMLDivElement;
const preloadFill = document.getElementById("preloadFill") as HTMLDivElement;
const preloadNum = document.getElementById("preloadNum") as HTMLDivElement;
/** the mark in the screen's corner that says the game is waiting on the network */
const netbusy = document.getElementById("netbusy") as HTMLDivElement;

const ctx = screen.getContext("2d")!;
const mapCtx = minimap.getContext("2d")!;

// Fullscreen the STAGE, not the canvas: the UA sizes a fullscreened element
// itself, so fullscreening #screen would hand away control of the letterbox and
// leave the minimap overlay behind. The 4:3 fit lives in index.html's
// `#stage:fullscreen` rules — the framebuffer is a fixed 512×384 either way
// (engine/src/web/screen.ts), so nothing in the renderer cares.
fsBtn?.addEventListener("click", () => {
  if (document.fullscreenElement) void document.exitFullscreen();
  else
    void stage
      .requestFullscreen()
      .catch((e) => log(`fullscreen: ${e.message}`));
});
document.addEventListener("fullscreenchange", () => {
  if (fsBtn)
    fsBtn.textContent = document.fullscreenElement
      ? "⛶ Exit fullscreen"
      : "⛶ Fullscreen";
});

/** every game file the page has seen, plus the dev-server manifest */
const files = new FileStore();

/**
 * Say when the game is waiting on the network, and only then.
 *
 * A fetch draws nothing: the frame loop presents frames, and while a room's
 * bytes are on the wire there is no new one, so the canvas holds whatever it
 * last had. Over a fast link that is a flicker nobody sees. Over a slow one a
 * changeset is seconds of the last frame standing still — a white flat, black,
 * a fade caught halfway — and the game reads as hung rather than as loading.
 *
 * The delay is the whole design. Every room change fetches, so a mark that
 * appeared the instant a fetch did would strobe on and off through ordinary
 * play on a local server and mean nothing. Waiting {@link BUSY_AFTER_MS} first
 * means it only ever appears when there is a wait to report.
 */
const BUSY_AFTER_MS = 400;

let busyTimer = 0;
files.onWire(({ inFlight }) => {
  if (inFlight > 0) {
    // already shown, or already counting towards being shown
    if (busyTimer || !netbusy.hidden) return;
    busyTimer = window.setTimeout(() => {
      busyTimer = 0;
      netbusy.hidden = false;
    }, BUSY_AFTER_MS);
    return;
  }
  // the last one landed: stop counting if it never showed, take it down if it did
  if (busyTimer) {
    clearTimeout(busyTimer);
    busyTimer = 0;
  }
  netbusy.hidden = true;
});

/**
 * The load remover, subscribed to the same wire as the mark above (#251).
 *
 * A second watcher rather than a line inside the first, because the two want
 * different things from the same events and neither is the other's business: the
 * mark waits {@link BUSY_AFTER_MS} before it admits to a wait and does not care
 * WHAT was fetched, while the clock needs each fetch by name — since #369 it
 * stops only for the ones that went to the network, and a cache hit is a read
 * the original did off its CD as well.
 *
 * The subscription itself is the engine's (`watchLoads`), which is where the
 * "only what the game WAITED for" rule now lives: Dust's page needs the same
 * rule and a second hand-written copy of it would be a second set of times
 * nobody could compare with these.
 *
 * Wired here because this is where the store is made. Nothing on the play page
 * reads the total; the workbench does (taoot/src/speedrun-page.ts), and so does
 * the Playwright runner, through the handle below.
 */
watchLoads(files);

/**
 * The Report bug button (site/src/bug-report.ts): a GitHub issue with the room, the
 * edition, the browser and the tail of the log already in it, and the screen on
 * the clipboard to paste — GitHub takes no image over a URL.
 *
 * The tail comes off {@link logLines}, so what the player can open with X and
 * what a report carries are the same lines by construction.
 */
/** how long the word about the screenshot stands before the bar is a bar again */
const BUG_NOTE_MS = 15_000;

/** which copy of the game is running — settled by initServerBrowser, for reports */
let editionCode = DEFAULT_LANGUAGE;

// no button on /speedrun/, and nothing to report from a stopwatch
if (bugBtn) {
  installBugReport(bugBtn, {
    game: TITANIC.short,
    canvas: screen,
    shotName: "taoot-bug.png",
    version: VERSION,
    where: () => hud.textContent ?? "",
    edition: () => `${editionName(editionCode)} (gamefiles/${editionCode}/)`,
    log: (n) => logLines.tail(n),
    // said in the reader's language, and only here: the issue itself is English,
    // because it is read by whoever fixes it
    note: (how) => {
      if (!bugNote) return;
      bugNote.textContent =
        how === "clipboard"
          ? t("play.bugShotClipboard")
          : t("play.bugShotFile");
      window.setTimeout(() => (bugNote.textContent = ""), BUG_NOTE_MS);
    },
  });
}

/** the pane's contents — the pane renders these, and a bug report is their tail */
const logLines = new LogBuffer(LOG_LINES_KEPT);

/**
 * Whether the lines in the pane belong to a BOOT rather than to a game.
 *
 * Raised by the two things that start a game from nothing — the page's own cold
 * boot and `quit()`'s return to the main menu — and spent by the first
 * {@link showStage} that follows, which is the moment the boot becomes a game.
 * Everything else that shows the stage (every room the player walks into, a
 * loaded save) leaves the pane alone.
 */
let bootChatter = true;

/**
 * A line into the pane behind X.
 *
 * While the game is up the pane stays shut: `disc 2 mounted` and `left b59:
 * freed 3.2 MB` are the engine talking to itself, and the player did not ask.
 * BEFORE the stage comes up it opens on the first line, because a boot that
 * never finishes has nothing else to say for itself — the rest of the page at
 * that moment is the word "Starting". {@link showStage} shuts it again on the
 * boot, and only on the boot.
 */
function log(line: string): void {
  // Asked BEFORE the line lands, or the answer is always "no": the new line has
  // already made the pane taller than the scroll position accounts for. Reading
  // something further up is a question of its own, and yanking the pane back
  // down answers a different one. 4px, because a zoomed page makes these
  // fractional.
  const atTail =
    scriptlog.scrollHeight - scriptlog.scrollTop - scriptlog.clientHeight < 4;
  const write = logLines.push(line);
  scriptlog.style.display = "block";
  if (stage.style.display === "none") details.hidden = false;
  if (write.repaint) scriptlog.textContent = logLines.text();
  else scriptlog.textContent += line + "\n";
  if (atTail) scriptlog.scrollTop = scriptlog.scrollHeight;
}

/** empty the pane — the boot's own chatter, kept out of the game that follows */
function clearLog(): void {
  logLines.clear();
  scriptlog.textContent = "";
  scriptlog.style.display = "none";
}

/** X: the scene readout and the log, both or neither. Remembered, so a player
 *  who wants it open gets it open on the next launch too — and inert where the
 *  pane is the page (see {@link DETAILS_ALWAYS}), because there is nothing to
 *  toggle it to. */
function toggleDetails(): void {
  if (DETAILS_ALWAYS) return;
  details.hidden = !details.hidden;
  try {
    window.localStorage.setItem(DETAILS_OPEN_KEY, details.hidden ? "0" : "1");
  } catch {
    /* not remembering is survivable — the pane still holds for this tab */
  }
  if (!details.hidden) scriptlog.scrollTop = scriptlog.scrollHeight;
}

/** where the pane's open/shut answer outlives the tab */
const DETAILS_OPEN_KEY = "taoot.details.open";

/** did the player leave the pane open last time? — and yes, always, on a page
 *  the pane belongs to ({@link DETAILS_ALWAYS}): this is what the boot reads to
 *  decide whether to shut it, and the workbench's boot must not */
function detailsWanted(): boolean {
  if (DETAILS_ALWAYS) return true;
  try {
    return window.localStorage.getItem(DETAILS_OPEN_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * The pointer, drawn with Titanic's own art.
 *
 * `cursor("touch")` names a `CURS.*` cursor resource inside the engine's own
 * executable — `tools/dumpcursors.ts` has the mechanism — and `ti.exe` carries
 * eleven of them, byte-identical across the demo and every shipped edition. This
 * page used to map the names onto CSS keywords instead, which is the right first
 * move and loses two things: the art is the 1996 artwork, and three of the eleven
 * (`goleft`, `goright`, `gostrait`) have no keyword that means what they mean.
 *
 * The corpus is CLOSED and small: every `cursor(...)` call in every script names
 * one of five — touch (809), arrow (75), hand (36), watch (18), fist (2). `take`,
 * `turn`, `look` and `talk` used to be mapped here and are emitted by nothing;
 * they were ours, from when the port decided cursors itself instead of asking.
 * The other six in the file are the engine's own, kept because the table is the
 * BUILD's rather than a list of what this game happens to use.
 *
 * Each name still carries a keyword for a browser that will not take the image
 * (see {@link CursorSheet}) — the same five mappings this comment used to be, plus
 * `crosshair` for `sight` and `none` for a pointer `hidecursor()` has taken away.
 */
const cursors = new CursorSheet(TI_CURSORS);

/** the name last answered, so a change of size can redraw it at the new one */
let cursorShown = "";

/**
 * Show what the thing under the pointer asked for.
 *
 * An empty answer is the game's ARROW rather than the browser's default:
 * `CURS.ARROW` is the window class's cursor in `ti.exe`, which is what the player
 * saw everywhere no script had claimed the pointer.
 */
function showCursor(name: string): void {
  cursorShown = name;
  const rect = screen.getBoundingClientRect();
  // the scale the PICTURE is shown at: the canvas is the framebuffer (512x384)
  // and CSS stretches it, so a cursor at 1x would be half the size the artist
  // drew it at against a doubled picture
  screen.style.cursor = cursors.css(name || "arrow", rect.width / screen.width);
}
/**
 * Redrawn whenever the PICTURE changes size, which a window resize is only one
 * way to do: the workbench lets the reader pick a whole-number scale for the
 * screen (taoot/src/speedrun-widths.ts) and that fires no resize event at all, so
 * the art stayed at the old scale until the window happened to move. Watching
 * the canvas catches both, and asks nothing of whatever changed it.
 */
new ResizeObserver(() => showCursor(cursorShown)).observe(screen);

/**
 * The bar the player watches while the game is fetched (GameHost.preload).
 *
 * Bytes, not files, and no words: megabytes and a rule are the same kind of thing
 * as the offsets an editor prints, so there is nothing here for the catalogue to
 * translate — the sentence above it is the translated part. A total of 0 means
 * nothing could be weighed (no manifest, no Content-Length), and then a bar would
 * be a fiction, so it stays down.
 */
function showPreload(loaded: number, total: number): void {
  if (!total) return;
  preload.hidden = false;
  preloadFill.style.width = `${Math.round((loaded / total) * 100)}%`;
  const mb = (n: number): string => (n / (1024 * 1024)).toFixed(1);
  preloadNum.textContent = `${mb(loaded)} / ${mb(total)} MB`;
}

function hidePreload(): void {
  preload.hidden = true;
}

// ---------------------------------------------------------------------------
// The host, and the session hooks that are genuinely the page's business
// ---------------------------------------------------------------------------

const host = new GameHost(files, audioSink, {
  log,
  hud: (text) => (hud.textContent = text),
  showStage: () => {
    booting.style.display = "none";
    stage.style.display = "block";
    // The pane is reset by the BOOT, not by arriving somewhere. showStage runs on
    // every set activation (GameHost.activateSet), so clearing here threw the log
    // away and shut the pane the player had opened at every changeset — 28 rooms
    // and at least 40 set changes over a full playthrough, which is #22's
    // "resets on every set change" exactly. `bootChatter` is raised by the two
    // entry points that really do start a game over (below), and this is the
    // moment it is spent: the boot's own lines have been read by whoever wanted
    // them, and the game gets a clean pane.
    if (!bootChatter) return;
    bootChatter = false;
    clearLog();
    details.hidden = !detailsWanted();
    stateList.reset();
  },
  mapChanged: () => refreshMap(),
});

/**
 * ...and let the DIRECTOR ask for a cursor too, for the changes a mouse move
 * cannot report: the hourglass while `lockevents` freezes the world — a character
 * walking up to you — arrived only when the player happened to move the pointer,
 * where the original's idle loop set it the moment the lock went up. See
 * ScreenDirector.onCursor.
 */
host.director.onCursor = showCursor;
const session = host.session;

// dialog builtins -> native browser dialogs; quit reloads to the boot screen
session.onNoteDialog = (message) => {
  window.alert(message);
};
session.onQuestionDialog = (message) => window.confirm(message);
session.onTextDialog = (prompt, initial) =>
  window.prompt(prompt, initial) ?? "";
// quit(): the game is over — the original leaves for the desktop, and what a
// page can offer instead is the thing it left FOR, its own front door. So go
// back to the boot: the logos, then the Play / Guided Tour menu, with a session
// as fresh as a relaunch.
//
// It used to be a page reload, because quit() is called from inside a script (the
// endgame's `playmovie("credits.mov"); quit()`): at that moment the interpreter is
// still unwinding the dispatch that played the credits, and a boot re-entered
// underneath it would be building sets and resetting globals while the old game
// was still talking. Navigation was the one teardown that could not half-happen.
//
// A reload is a poor front door, though — it throws the page away to get back to
// something the page can perfectly well show, and it takes the run with it: the
// browser suite's segment 27 reports "Execution context was destroyed, most likely
// because of a navigation" and then reads the theme as "none" off a dead page.
//
// So do it in place, and answer the unwinding problem directly instead of routing
// around it. Two halves, and neither is a timing guess:
//
//  - return NOW and continue on the next rendered frame. `nextFrame` is the
//    engine's own yield — the same primitive script poll loops use, pointed at rAF
//    below — so the credits dispatch returns and the frame it was drawn on
//    finishes before any teardown starts. (A `setTimeout(0)` would do it by
//    accident; viewer.ts's turn pacing already records what asking a question
//    about game time on a wall clock costs.)
//  - then `prepareRestart` awaits `settle()`, which is the actual guarantee:
//    nothing is torn down until the dispatch that asked for it has unwound.
//
// Untracked, or that settle would be waiting on itself.
session.onQuit = () => {
  log("quit() — back to the main menu");
  // a relaunch, so the next stage that comes up gets a clean pane
  bootChatter = true;
  void session
    .nextFrame()
    .then(() => host.restart())
    .catch((e) => log(`restart failed: ${(e as Error).message}`));
};
// Script poll loops (forceupdate/stilldown) yield through this so a real frame
// renders and pending pointer events are delivered between iterations.
// hasRealFrames also relaxes the interpreter's while-loop runaway guard for
// such loops — only valid here, where each iteration really waits on a frame.
session.hasRealFrames = true;
session.nextFrame = () =>
  new Promise<void>((res) => requestAnimationFrame(() => res()));
// default name offered in the save browser: the current set + a timestamp.
function defaultSaveName(): string {
  const set = session.currentSetFile || "game";
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}-${pad(d.getMinutes())}`;
  return `${set} - ${stamp}`;
}
// Which game's saves this page keeps: Titanic's, in the `taoot-saves` database,
// with the `.ti` reader as the import gate. The kind carries the validator
// rather than the store importing it, so the Dust page can hand in its own
// (engine/src/web/save-store.ts).
useSaveKind({
  ...TAOOT_SAVES,
  valid: (bytes) => {
    readSaveFile(bytes);
    return true;
  },
});
// savegame builtin: the native Save As dialog becomes the in-app save browser,
// which stores the produced .ti bytes into the IndexedDB save "file system"
// (engine/src/web/save-store.ts) under a player-chosen name.
session.onSaveGame = async (bytes) => {
  await browseForSave(bytes as Uint8Array, defaultSaveName(), { log });
};
// opengame builtin: the native Open dialog becomes the in-app load browser,
// which lists the saves in IndexedDB (seeded from the shipped save folder) and resolves
// with the chosen .ti's bytes, or null if the player closed without picking one.
session.onLoadGame = () => browseForLoad({ log });
// savegame builtin base: a fresh playthrough (never loaded from a file) has no
// skeleton to patch, so lend it a shipped save matching the current disk. Once a
// game has been loaded, session.lastSave supersedes this (see snapshotSave).
session.saveTemplate = () => {
  const mission = session.interp.globals.get("mission");
  const prefer = typeof mission === "number" && mission >= 4 ? "2" : "1";
  return saveTemplateFor(prefer);
};

/**
 * The intro while it is on screen, and null the rest of the time — see
 * {@link runNightdiveIntro} and the `intro` field of the debug handle below.
 */
let liveIntro: NightdiveIntro | null = null;

// debug handle for the console and browser-automation tests (taoot/tests/browser/menu-movie.ts,
// taoot/tests/browser/playthrough.ts). snapshotState/seededRng are handed out rather
// than reimplemented page-side so a browser trace and a headless one are
// produced by the same code and can be compared byte for byte.
//
// `intro` is here for the same reason `viewer` is: it is what is on screen, and
// automation cannot drive what it cannot see. There is no viewer until the boot
// activates a set, so during the intro EVERY viewer-shaped predicate is
// undefined — which is exactly how the browser gate came to sit through its
// whole 300 s budget "waiting for the boot menu" at a film that was waiting for
// it (taoot/tests/browser/playthrough.ts, escapeIntro).
//
// `log` is here so a reader can follow the pane without scraping it: the lines as
// an array, plus how many have rolled off the top, which is what the browser
// gate's ENGINELOG needs to know where it got to.
Object.defineProperty(window, "dbg", {
  get: () => ({
    viewer: host.viewer,
    intro: liveIntro,
    session,
    host,
    snapshotState,
    seededRng,
    log: () => ({ lines: logLines.lines, dropped: logLines.dropped }),
    /**
     * The load remover's reading (#251) — cumulative network ms, and whether the
     * wire is busy right now.
     *
     * A function rather than a number, because it is sampled by a speedrun
     * driver at the top and bottom of every action and has to be the reading AT
     * THAT MOMENT, not whatever it was when this handle was built.
     *
     * It is here because a driver may be in another process: the Playwright
     * runner measures a page it can only reach by evaluating an expression in it
     * (taoot/tests/speedrun/driver.ts), and this is the expression. The in-page
     * one imports `loadClock` and never comes through here.
     */
    loading: () => ({ ms: loadClock.ms, waiting: loadClock.waiting }),
  }),
});

function refreshMap(): void {
  const viewer = host.viewer;
  if (viewer && viewer.showMap) {
    viewer.renderMap(mapCtx);
    minimap.style.display = "block";
  } else {
    minimap.style.display = "none";
  }
}

// ---------------------------------------------------------------------------
// The boot (dev-server mode)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// The language chooser: lang.stg, run before anything is read from a language
// tree (taoot/src/lang-chooser.ts explains why it is a stage and not a dialog)
// ---------------------------------------------------------------------------

/**
 * Run the chooser stage and wait for a button. The page's part is only what a
 * room would normally provide — a canvas to draw on and events to deliver — while
 * the stage's own compiled scripts decide what a click means.
 */
async function runLangChooser(available: string[]): Promise<string | null> {
  const chooser = new LangChooser(session, available);
  if (!(await chooser.open())) {
    log(`language chooser: ${LANG_STAGE} not available`);
    return null;
  }
  // the chooser owns the screen: show the canvas, take the boot text down
  booting.style.display = "none";
  stage.style.display = "block";

  let drawing = true;
  const draw = (): void => {
    chooser.render(ctx);
    if (drawing) requestAnimationFrame(draw);
  };
  requestAnimationFrame(draw);

  return new Promise<string | null>((resolve) => {
    const onPointer = (e: PointerEvent): void => {
      ensureAudio(); // the first click is also the audio-unlock gesture
      const { x, y } = canvasCoords(e);
      void chooser.click(x, y).then(settle);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key.length !== 1) return;
      ensureAudio();
      void chooser.key(e.key.toLowerCase()).then(settle);
    };
    function settle(): void {
      const picked = chooser.chosen();
      if (!picked) return;
      screen.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("keydown", onKey);
      // one last frame (the button's script switched to the "wait" flat), then
      // give the stage back — the boot opens main.stg into a clean session
      chooser.render(ctx);
      drawing = false;
      void chooser.close().then(() => resolve(picked));
    }
    screen.addEventListener("pointerdown", onPointer);
    window.addEventListener("keydown", onKey);
  });
}

// ---------------------------------------------------------------------------
// The intro: nightdive.mov, and the question it ends on (taoot/src/nightdive.ts)
// ---------------------------------------------------------------------------

/**
 * Play the intro film and ask whether the player owns the game, before the boot.
 *
 * The same shape as the chooser above, and for the same reason: the page provides
 * what a room normally would — a canvas and events — while the authored file
 * decides what is on screen and what a click means. Nothing here knows there are
 * two buttons; it asks the movie afterwards which of its action frames was
 * entered ({@link NightdiveIntro.answer}).
 *
 * The answer comes back rather than being acted on here: what "no" means is that
 * this page is not where the player is going, which is the caller's business and
 * not the film's.
 */
/**
 * Does this page want the film at all?
 *
 * The play page does; the speedrun workbench does not, and says so with
 * `<meta name="skip-intro">`. The reason is what that page is for: the film is
 * seven seconds and a question in front of every reboot, and tuning a route
 * means rebooting constantly — the workbench is reloaded to get a clean game
 * far more often than it is opened to play one.
 *
 * A page-level fact and not a URL parameter, deliberately, because it is a
 * property of the page rather than of a visit: `/speedrun/` should behave the
 * same however it was reached. The declaration is in the markup for the same
 * reason `site-root` is — you can see it by looking at the page.
 *
 * Skipping leaves the ownership question `unanswered`, which is not a new state
 * to handle: it is already how every non-English edition and every deployment
 * with no film served boots. See {@link Ownership}.
 */
const skipsIntro = (): boolean =>
  !!document.querySelector('meta[name="skip-intro"]');

/**
 * Does this page want the music off?
 *
 * `<meta name="mute-theme">`, and NO PAGE CURRENTLY SAYS IT. The speedrun
 * workbench did — the same twenty seconds of a room play a hundred times over
 * while a route is tuned, and at that repetition a theme stops being
 * atmosphere — and it was taken back out, because a run is read by its sound as
 * much as by its picture and the music is part of knowing where you are.
 *
 * Kept because it is one line to say again (in `speedrun/index.html`'s head)
 * and because the question it answers is a real one for any page that runs the
 * game on a loop. It only ever touched the THEME mix: SFX and voice were left
 * alone, since `skipLines` and `wait(talking)` are about those.
 *
 * A page-level fact and not a control, for the same reason as the film above:
 * it would be a property of what a page is for, not of a visit. The CTL panel's
 * theme lever is the per-session answer either way.
 */
const mutesTheme = (): boolean =>
  !!document.querySelector('meta[name="mute-theme"]');

/**
 * Is the Details pane part of this page rather than something to ask for?
 *
 * `<meta name="details-always">`, and the speedrun workbench says it. The pane
 * is the log and the state list — on the play page that is a debugging aid a
 * player can call up with X and dismiss again, and on the workbench it is half
 * of what the page IS: a route is read off the log, and the sheet being tuned is
 * tuned against what the state list says. A column that has to be summoned
 * every time is a column that is in the way of the thing it belongs to.
 *
 * What it changes is three answers, all of them about the pane and none of them
 * about the game: the pane starts open, X does not shut it, and the `state` box
 * defaults to on ({@link installDebugPanel}). Everything else about the pane —
 * the checkbox still checkable, the filter, the copy button — is the same on
 * both pages, because the pane is the same pane.
 *
 * A page-level fact and not a URL parameter, for the reason {@link skipsIntro}
 * gives: `/speedrun/` should behave the same however it was reached, and you can
 * see the declaration by looking at the page. The markup on that page also drops
 * the `hidden` attribute, so the column is up from the first paint rather than
 * from whenever the boot gets round to it — this flag is what stops anything
 * putting it back.
 */
const DETAILS_ALWAYS = !!document.querySelector('meta[name="details-always"]');

/**
 * Which copy of the game this PAGE plays, if it is not a question.
 *
 * `<meta name="edition" content="en">`, and the speedrun workbench is the page
 * that says it. A route is a sequence of standpoints, clicks and dialogue
 * bevels in one edition's data; timing it against another tree is not a slower
 * run of the same route, it is a different route that happens to parse. So the
 * workbench does not offer the picker and does not open the game's own language
 * chooser — it plays English and says so in the markup.
 *
 * A page-level fact, like the film and the music above, and it outranks all
 * three of the ordinary answers (`?edition=`, the remembered choice, the
 * chooser) rather than joining them: "always" is the whole point, and a stored
 * preference from some visit to /play/ leaking in here would move a route's
 * data out from under it. An edition the install does not have is ignored, so a
 * tree that was never ripped cannot leave the page with nothing to boot.
 */
const pinnedEdition = (): string | null =>
  document
    .querySelector('meta[name="edition"]')
    ?.getAttribute("content")
    ?.toLowerCase() ?? null;

async function runNightdiveIntro(): Promise<Ownership> {
  const intro = new NightdiveIntro(session);
  intro.onLog = log;
  // no film served, no intro — a deployment that never ran the generator boots
  // exactly as it did before, with the boot text and its bar still up
  if (!(await intro.open(files))) return "unanswered";
  liveIntro = intro;
  booting.style.display = "none";
  stage.style.display = "block";

  const onPointer = (e: PointerEvent): void => {
    ensureAudio(); // the first click is also the audio-unlock gesture
    const { x, y } = canvasCoords(e);
    intro.click(x, y);
    // The intro's regions are its own — the ownership question's two buttons —
    // so its clicks are named from `regions()` rather than from the engine's hit
    // test, which has no room to test against yet (#178).
    const on = intro.regions().find((r) => x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1);
    inputs.noteAnswered(
      clickLabel(x, y),
      "the Nightdive intro",
      on ? `region "${on.target}"` : "on nothing",
    );
  };
  // ESC and the volume digits, both through the movie's own key filter — the
  // marker is what that filter insists on for the abort, and the header flag is
  // what decides (MoviePlayer.key). The digits are here and not only in the
  // in-game listener below because the logos and the menu ARE movies, played by
  // this intro rather than by a viewer (there is none until a set opens), and the
  // credits over a title screen are exactly where a player reaches for the volume.
  const onKey = (e: KeyboardEvent): void => {
    ensureAudio();
    if (e.key === "Escape") {
      const took = intro.key(".", true);
      // #171 is exactly this line: an ESC that skipped what it should not have,
      // and no way to see from the log that a key had been pressed at all
      inputs.noteAnswered(
        inputLabel("."),
        "the Nightdive intro",
        took ? "skipped the film" : "IGNORED — the film carries no skip flag",
      );
    }
    else if (
      e.key.length === 1 &&
      e.key >= "0" &&
      e.key <= "9" &&
      !e.ctrlKey &&
      !e.metaKey &&
      !e.altKey
    ) {
      if (!focusOwnsKey(e.target, e.key)) intro.key(e.key, false);
    }
  };
  screen.addEventListener("pointerdown", onPointer);
  window.addEventListener("keydown", onKey);

  // its own frame loop: the page's (bottom of this file) draws a viewer, and
  // there is no viewer until the boot activates a set
  let drawing = true;
  const draw = (now: number): void => {
    intro.tick(now);
    intro.render(ctx);
    if (drawing) requestAnimationFrame(draw);
  };
  requestAnimationFrame(draw);

  await intro.done;
  drawing = false;
  liveIntro = null;
  screen.removeEventListener("pointerdown", onPointer);
  window.removeEventListener("keydown", onKey);
  const answer = intro.answer();
  log(`intro: ${answer}`);
  intro.close();
  return answer;
}

/**
 * Which EDITION to boot: an explicit `?edition=`, what was picked last time, or
 * the authored chooser. A tree with no edition directories at all is a flat
 * single-edition dump — there is nothing to choose, and every lookup falls
 * through to the neutral bucket anyway.
 *
 * The chooser can only offer what its art has buttons for, which is the six
 * languages ({@link chooserOrder}); an edition outside that — the demo — is
 * reachable from the page's own edition row, and by `?edition=`, both of which
 * settle the question before this is asked.
 */
async function resolveEdition(): Promise<{ code: string; asked: boolean }> {
  const installed = files.availableEditions();
  if (!installed.length) return { code: DEFAULT_LANGUAGE, asked: false };

  // a page that names its edition is not asking — see pinnedEdition
  const pinned = pinnedEdition();
  if (pinned && installed.includes(pinned))
    return { code: pinned, asked: false };
  if (pinned)
    log(`this page asks for the ${pinned} edition, which is not installed`);

  let remembered: string | null = null;
  try {
    remembered = window.localStorage.getItem(EDITION_STORAGE_KEY);
  } catch {
    /* storage can be denied; the chooser then runs every launch */
  }
  const query = new URLSearchParams(window.location.search).get("edition");
  const pre = preselectedEdition({ query, remembered, available: installed });
  if (pre) return { code: pre, asked: false };

  const askable = chooserOrder(installed);
  const picked =
    askable.length > 1 ? await runLangChooser(askable) : askable[0];
  if (!picked) return { code: installed[0], asked: false };
  try {
    window.localStorage.setItem(EDITION_STORAGE_KEY, picked);
  } catch {
    /* not remembering is survivable */
  }
  return { code: picked, asked: askable.length > 1 };
}

/** register every hosted file, settle an edition, preload it, and boot */
async function initServerBrowser(): Promise<void> {
  // The manifest is a file (tools/manifest.ts), so this is the same fetch on a dev
  // server and on a static host; where there is none, there is nothing to play and
  // the boot text stays up. It now reads as a wait rather than an explanation —
  // "loading the game's files, looking in gamefiles/" — so a reader with no tree
  // is left watching a load that never finishes. What would fix it is a second
  // string this branch swaps in, not a longer one that every reader waits behind.
  const paths = await gamefileManifest();
  if (!paths.length) return;
  for (const p of paths) {
    files.registerServerFile(p.split("/").pop()!, siteUrl(p));
  }
  // the authored chooser stage ships in public/, outside gamefiles/ and outside
  // any edition — it has to load before an edition exists to load it from
  files.registerServerFile(LANG_STAGE, siteUrl(LANG_STAGE));
  // and so does the intro film, for the same reason: it plays before the boot,
  // and it is the same film whichever tree is installed under it
  files.registerServerFile(NIGHTDIVE_MOVIE, siteUrl(NIGHTDIVE_MOVIE));

  // Nothing may be read from an edition tree before this: the boot library, the
  // shipped saves and every room exist once per edition, and picking one is
  // what decides which copy a basename resolves to (FileStore.setEdition).
  const { code, asked } = await resolveEdition();
  files.setEdition(code);
  // and the row says what actually booted, which is not always what the picker
  // guessed: it is drawn before this resolves, and its guess for a reader who has
  // never chosen is their UI language, while the game's own door is the chooser.
  if (editionPicker) markEdition(editionPicker, code);
  editionCode = code; // and a bug report says which copy it was about
  log(`edition: ${editionName(code)} (gamefiles/${code}/)`);

  // Which volumes this game's discs are, read from its own setpath and applied
  // before anything disc-sensitive is fetched. It has to be here and not earlier:
  // the names are in the BOOTFILE, and reading the BOOTFILE is itself a lookup —
  // see FileStore.setVolumes. After setEdition, because the plan must come from
  // the tree that is about to boot.
  const { volumes } = await host.bootPlan();
  files.setVolumes(volumes);
  if (volumes.length) log(`volumes: ${volumes.join(", ")}`);

  // seed the IndexedDB save "file system" from the shipped save-folder entries
  // in this same manifest, then cache the fresh-playthrough save templates.
  void seedSaves(paths, code)
    .then(() => loadTemplates())
    .catch(() => {});
  // Nothing to boot without game data — the boot text stays up, which is the
  // whole of the production build's story (and see the manifest fetch above for
  // what that text no longer tells the reader).
  if (!files.serverSetNames().length) return;

  /**
   * Straight into the game.
   *
   * This page used to offer a row of entry points — cold boot, load a save, six
   * curated story states, one set per room — and every one of them except the
   * first was a shortcut for working ON the game rather than playing it. What
   * was in front of the game was a question nobody visiting it wanted to
   * answer, in front of the answer. The shortcuts outlived it for a while in a
   * dev bar below the canvas; they are gone too now, because the game plays
   * through to the credits, and a save through the in-game menu or a room
   * through the editors is the way back to any of it.
   *
   * The one thing worth asking a visitor — whether they came to play at all —
   * is asked by the front page's Play button, one navigation ago, so by the
   * time this file runs there is nothing left to decide.
   *
   * Audio survives the loss of the click. It was `ensureAudio()` on each of
   * those buttons that unlocked the AudioContext, but the window already arms
   * the same call on the first pointerdown or keydown anywhere on the page
   * (see the top of this file), and `attach()` restarts the theme that is
   * already playing — so the boot runs silently for as long as the player has
   * not touched anything, and then it does not.
   */
  // Everything the boot would otherwise wait for, in front of the game rather
  // than inside it. If the chooser ran, ITS "loading" flat is what the player is
  // looking at and the page must not flash over it, so the bar stays down and the
  // wait is the same wait; otherwise the boot text grows a bar under it.
  const sizes = await gamefileSizes();
  const sizeOf = (name: string): number => {
    const url = files.serverUrl(name);
    return url ? (sizes[decodeURIComponent(sitePath(url))] ?? 0) : 0;
  };
  // The intro owns the screen while the game's files come in behind it — seven
  // seconds of film is seven seconds of preload nobody waits through, and the
  // question at the end of it is answered while the last of the tree lands. The
  // bar is not suppressed for it the way it is for the chooser: the bar lives
  // inside #booting, which the intro takes down only once it has a picture, so a
  // deployment with no film served still shows the bytes arriving.
  const intro: Promise<Ownership> =
    introPlaysFor(code) && !skipsIntro()
      ? runNightdiveIntro()
      : Promise.resolve("unanswered");
  const loading = host.preload({
    sizeOf,
    onProgress: asked ? undefined : showPreload,
  });
  // "No" leaves. Not a new tab — a navigation, and the film has already said so
  // on its own last frame ("OPENING GOG.COM") while this was still waiting on it.
  // Nothing after this line runs: the preload still in flight goes with the page,
  // and booting a game behind a document that is leaving is work for no one.
  if ((await intro) === "wants") {
    window.location.assign(GOG_URL);
    return;
  }
  await loading;
  hidePreload();
  booting.style.display = "none";
  stage.style.display = "";
  /**
   * The row under the canvas — fullscreen, the bug button, the swipe boxes, the
   * key list — goes up with the CANVAS, and it used to go up with a ROOM.
   *
   * It was raised inside the host's `showStage`, which fires on set activation,
   * so an edition that activates no set never got it. That is the 1996 demo, all
   * of whose screens are films and a menu stage: reported, in passing and
   * correctly, as "the demo page doesn't have a bug report button. Not sure if
   * that's intentional" (#299). It was not.
   *
   * Here rather than there because none of these controls is about a room, and
   * because this is the one line every edition passes through — the language
   * chooser and the Nightdive question both reveal the canvas earlier and both
   * come back to here before a game starts. `showStage` keeps the pane reset
   * that really is per-boot; this is chrome, and it is the page's.
   */
  if (help) help.style.display = "block";
  ensureAudio(); // a no-op until a gesture has happened, and free to call early
  // before the boot, because the boot is where the mix is set and where the
  // first room's setupsound starts playing into it
  if (mutesTheme()) host.themeMix = 0;
  await session.track(host.coldBoot(), "coldBoot");
}

/**
 * The boot, in the order a player experiences it:
 *
 *  1. the page's own language, AWAITED — a reader of one of the other five saw
 *     the English markup, then the manifest fetch, then the swap; the words that
 *     say "starting" have to be in their language before they are worth reading.
 *  2. the edition (a link, a memory, or the authored chooser), then everything
 *     the game needs, with a bar over the bytes as they land.
 *  3. only then the game itself.
 *
 * The two controls in the chrome go up between 1 and 2, so they are already in
 * the reader's language and already answerable while the files come in.
 */
async function boot(): Promise<void> {
  await installI18n();
  // the boot text is hidden until here (play/index.html): a reader of one of the
  // other five languages should not be shown the English it is about to replace
  document.body.classList.add("spoken");
  installLanguageMenu();
  installVersion();
  // Which copy of the game is being played — above the stage, never hidden with
  // it: the same row the editors and the collection carry (taoot/src/editions.ts).
  if (editionPicker) void installEditionPicker(editionPicker);
  await initServerBrowser();
}
void boot();

// ---------------------------------------------------------------------------
// Input: pointer + keyboard, routed into the engine
// ---------------------------------------------------------------------------

/**
 * The input log (#178): what the player pressed, what it hit, and what it did,
 * in the same stream as what the game said about it.
 *
 * Wired here because this is where inputs enter — every gesture in this file
 * goes through one of `pressArrow`, `keyToGame`, `director.press` or the intro's
 * own two listeners, and the recorder wraps exactly those. A key the PAGE keeps
 * (M, O, X, the gamma keys, a letter typed into the filter box) never reaches
 * them and is therefore never logged, which is the right answer and one nobody
 * has to maintain: what is logged is what the game was given.
 *
 * The three questions the recorder asks are answered below rather than inside
 * it, so the wording can be tested without an engine (taoot/src/input-log.ts).
 */
const SESSION_START = performance.now();

/** where the game is standing, in one phrase — the tail of every logged line */
function whereNow(): string {
  // the intro is not a room and has none behind it, and it is the one screen
  // where "what did ESC do" is the whole question (#171)
  if (liveIntro) return "the Nightdive intro";
  // a film is what is on screen while it plays, whatever is open behind it
  if (host.director.moviePlaying && host.director.movieFile) return host.director.movieFile;
  const flat = session.currentFlat !== "none" ? ` · flat "${session.currentFlat}"` : "";
  if (session.viewShowing) {
    // The scene and view as the SET spells them, which is how the state list
    // above and every golden name them (`snapshotState`) — `currentSceneName()`
    // is the caseless script-facing name and would have this readout saying
    // `scene3 / view20` two inches under a pane saying `Scene3 / View20`.
    const v = host.viewer;
    const scene = v?.scene?.sceneName ?? session.currentSceneName();
    const view = v?.scene?.views[v.viewIdx]?.viewName ?? session.currentViewName();
    return `${session.currentSetName} — ${scene} / ${view}${flat}`;
  }
  // a stage with no room behind it: the demo's menu, the deck map, the Enigma
  if (session.stageOpen) return `${session.stageName}${flat}`;
  return "no room open";
}

/**
 * What will happen to a gesture arriving right now — the same question
 * {@link KEY_SAFE} asks the page in a speedrun, asked in TypeScript.
 *
 * `movingCamera` is a press FILED (`SetViewer.keyDown` posts it coalescing) and
 * `inputLocked` without it is a press GONE, and the difference between those two
 * is exactly the fade gap that eats gestures. A log that did not tell them apart
 * would be no help at all with the reports it exists for.
 */
function gateNow(): Gate {
  const v = host.viewer;
  if (!v) return "none";
  // `movingCamera` off the DIRECTOR, which is where it lives: the viewer
  // forwards `inputLocked` and not this one, so `v.movingCamera` is undefined
  // (which is also why the speedrun's KEY_SAFE reads it and gets nothing — its
  // `!inputLocked` clause is the stricter test and carries that gate anyway).
  // The order is KEY_SAFE's, and the order is the whole of it: a film TAKES a
  // key (that is how a cutscene is skipped) and a conversation takes one, so
  // either of those outranks the camera. Measured the other way round first —
  // every gesture through the boot's logos came out "queued behind a camera
  // move", including the Space that skipped one.
  if (v.moviePlaying || v.conversing) return "ready";
  if (host.director.movingCamera) return "queued";
  return v.inputLocked ? "locked" : "ready";
}

const inputs = new InputLog({
  now: () => performance.now() - SESSION_START,
  say: log,
  where: whereNow,
  gate: gateNow,
  after: (ms, fn) => {
    const t = window.setTimeout(fn, ms);
    return () => window.clearTimeout(t);
  },
});

/** what the engine's hit test says is under a point, for a click's own line */
const hitAt = (x: number, y: number): (() => Hit | null) => () => session.hitTestAt(x, y);

/**
 * A gesture aimed at the GAME, logged unless the intro owns the screen.
 *
 * While the Nightdive intro is up there are two listeners for every press and
 * every click — the intro's own (it plays on its own MoviePlayer, with its own
 * frame loop) and the game's, which still forwards to the director as it always
 * did. Both used to log, so every ESC at the ownership question produced a pair
 * of lines: `IGNORED — the film carries no skip flag`, which is the answer, and
 * `— nothing changed` from the director, which reads like a second press.
 *
 * The intro's line wins because it is the one with an answer in it (#171), so
 * the game's side goes quiet rather than the dispatch changing: what is sent to
 * the director while a film plays is exactly what was sent before.
 */
function noteGame(
  what: string,
  dispatch: () => Promise<unknown> | unknown,
  hit?: () => Hit | null,
): void {
  if (liveIntro) {
    void dispatch();
    return;
  }
  inputs.note(what, dispatch, hit);
}

/** map a mouse event to view-pixel coordinates on the canvas */
function canvasCoords(e: { clientX: number; clientY: number }): {
  x: number;
  y: number;
} {
  const rect = screen.getBoundingClientRect();
  return {
    x: Math.floor(((e.clientX - rect.left) / rect.width) * screen.width),
    y: Math.floor(((e.clientY - rect.top) / rect.height) * screen.height),
  };
}

// Press/move/release so held-button drag loops work (`while stilldown()` in
// the wireless knobs). pointerdown routes the mousedown (which may enter a
// drag loop); pointermove keeps mouse() live; pointerup ends the loop.
screen.addEventListener("pointerdown", (e) => {
  const { x, y } = canvasCoords(e);
  session.setPointer(x, y);
  /**
   * A finger is ambiguous until it moves — see TouchGestures — and it may begin
   * with NO VIEWER, because what a double-tap means is a KEY and a key does not
   * need a room to land in.
   *
   * On THIS page that is a consistency fix rather than a visible one, and the
   * difference was measured rather than assumed: the boot opens a set before
   * logo.mov and playmode.mov, so a viewer exists while they play and the old
   * test let those gestures through. Dust is where the same line broke a skip —
   * its films play on the ScreenDirector with no room at all. The one Titanic
   * film that really does run with no viewer is the Nightdive intro's, and that
   * one is not the director's either; see the escape branch in `sendKey`.
   */
  if (e.pointerType === "touch") {
    touch.down(e);
    return;
  }
  /**
   * ...and a MOUSE press goes to the DIRECTOR, for the reason the keys do (see
   * {@link keyToGame}). This asked for `host.viewer` and returned when there was
   * none — "a click is a click on a room, and there is none yet" — which is true
   * of a film and false of a MENU. The 1996 demo's menu is a stage flat with four
   * portholes and no room anywhere behind it, so every click on it was dropped
   * here: "when the main menu (demo.stg) loads, nothing can be clicked on" (#299).
   *
   * `SetViewer.press` is one line that delegates to `ScreenDirector.press`, which
   * already expects to run without a room — it arms the room's nav hooks through
   * `this.room?.` and says so — so this is the same call reaching the same place,
   * minus a guard that was asking about the wrong thing.
   */
  session.pointerDown = true;
  // What the press CARRIED, for `shiftkey()` (engine/src/runtime/builtins/scene.ts). Taken
  // here rather than tracked as live keyboard state because that is how the
  // original asks: house.shp's HELP button reads it inside its own mousedown, so
  // the question is what was held when the click happened.
  session.shiftDown = e.shiftKey;
  noteGame(
    clickLabel(x, y),
    () => session.track(host.director.press(x, y), `press ${x},${y}`),
    hitAt(x, y),
  );
});

// release anywhere ends a drag (the pointer may leave the canvas mid-drag).
// It also ANSWERS a conversation: a bevel is tracked while held and only
// counts if the button comes up inside the row it went down on. The position
// is the last one pointermove saw, which is live throughout a drag and is
// still right when the release happens off-canvas (where it lands on no row,
// so the answer is correctly discarded).
window.addEventListener("pointerup", (e) => {
  if (touch.up(e)) return;
  session.pointerDown = false;
  // `shiftDown` is deliberately NOT cleared here. A press dispatch is async — it
  // can be waiting on a movie or a walk when the button comes up — and the script
  // that reads `shiftkey()` may not have run yet. It says what the last press
  // carried until the next press says otherwise, which is the question scripts
  // actually ask.
  host.director.release(session.pointerX, session.pointerY);
});

// ---------------------------------------------------------------------------
// Touch: swipe to walk and turn
// ---------------------------------------------------------------------------

/**
 * A phone has no arrow keys, and the three the game needs — walk on, turn left,
 * turn right — are how you get anywhere. So a swipe across the canvas presses
 * the arrow it points at. `touch-action: none` on `#screen` (play/index.html) is
 * what makes the gesture ours: the browser would otherwise claim a vertical drag
 * for scrolling and the walk-forward swipe would never arrive. It is scoped to
 * the canvas, so the page around it still scrolls normally.
 *
 * The catch is that a finger going down is ambiguous in a way a mouse press is
 * not: the same contact begins both a tap (a game click) and a swipe (a nav
 * press). A mouse gets its mousedown immediately; a finger's is held back until
 * the gesture has declared itself, and only three things can happen:
 *
 *  - it travels far enough to be a swipe → the nav press, and NO click, because
 *    a swipe that started over a hotspot must not also poke it;
 *  - it lifts before then → a tap, which presses and releases where it landed;
 *  - it stays down without travelling → a press, handed over after TAP_HOLD_MS
 *    so the drag loops still work. The wireless knobs and the bag's drags run
 *    inside `while stilldown()`, which needs the mousedown while the finger is
 *    still on the glass.
 *
 * The two distances and the two durations that decide all three — how far is a
 * swipe, how long is a hold, and the double-tap's window — live with the
 * recogniser now (SWIPE_MIN_PX, TAP_HOLD_MS and the pair below, in
 * engine/src/web/touch.ts) rather than as four constants per page.
 *
 * Two taps in the same place this close together are the phone's ESCAPE — the key
 * a cutscene is skipped with, which a phone has no way to press. Forwarded exactly
 * as the key is (`keyDown(".", true)`), so a live movie aborts and anything else
 * ignores it.
 *
 * Only the SECOND tap is swallowed. The first has already been sent as a click,
 * because holding every tap back to see whether another follows would put 300 ms
 * of lag on every press in the game — and during a clip, which is what this is
 * for, a tap that reaches no region does nothing anyway.
 *
 * The recogniser is SHARED (engine/src/web/touch.ts); only the dispatch below is
 * Titanic's.
 *
 * It was two hundred lines of state machine here and the same two hundred in
 * Dust's page, and the copies had already drifted in ways nobody chose — this
 * one never cleared `shiftDown` on a tap, Dust's did; this one listened for
 * `pointermove` on the canvas, Dust's on the window. Timelapse was written
 * against the shared module from the start and was immune to the bug that
 * prompted this migration: a film plays with no room open, and a copy that asked
 * for `host.viewer` before letting a gesture start could not skip one by finger
 * while the keyboard could. That bug BIT on Dust's page, whose films play on the
 * director with no set open; here it was latent, because the boot opens a set
 * before the logos roll. What was NOT latent here is the intro film, which the
 * escape branch below now reaches.
 */
const touch = new TouchGestures({
  coords: (e: PointerEventLike) => canvasCoords(e),
  /**
   * What is under the finger decides whether it may become a swipe.
   *
   * A PROP or a stage BUTTON is a control: the press goes through at once, with
   * no hold and no swipe, because a drag has to move immediately and waiting out
   * TAP_HOLD_MS to disambiguate ruled the inventory drag a swipe and walked the
   * camera instead. Room surfaces — a scene, a hotspot, an actor, the flat behind
   * the band — keep the wait, because swiping the ROOM is how a phone walks and
   * those are what a navigating swipe starts on.
   */
  ownedByGame: (x, y) => {
    const kind = session.hitTestAt(x, y).type;
    return kind === "prop" || kind === "button";
  },
  // The finger's half of the same thing the mouse handler above does, and it had
  // the same guard: a tap on the demo's menu was dropped for want of a room.
  press: (x, y) => {
    session.pointerDown = true;
    noteGame(clickLabel(x, y), () => session.track(host.director.press(x, y)), hitAt(x, y));
  },
  release: (x, y) => {
    session.pointerDown = false;
    host.director.release(x, y);
  },
  /**
   * The two halves of a gesture that is a KEY, and they differ: three of the
   * four arrows are navigation presses the scripts may intercept, DOWN is a
   * plain key event exactly as `ArrowDown` is on a keyboard, and the ESC a
   * double-tap means goes to the DIRECTOR — which is where a movie takes its
   * keys, with or without a room behind it.
   */
  sendKey: (key: GestureKey, special: boolean) => {
    // `key === ESCAPE_KEY` as well as `special`, so the three-arrow narrowing
    // below is the compiler's rather than a promise this function makes
    if (special || key === ESCAPE_KEY) {
      /**
       * The Nightdive intro first, when one is up.
       *
       * It is not the director's film: `runNightdiveIntro` plays it on its own
       * MoviePlayer, with its own frame loop and its own key listener, because
       * there is no viewer until the boot opens a set. So an escape sent to the
       * director while it runs reaches nothing, and the logo film was skippable
       * by ESC and not by finger — the same asymmetry this migration was
       * prompted by, in the one place relaxing the viewer test did not reach.
       * Measured, not reasoned: a double-tap left the film running where the key
       * cut it, and this is the line that closes it.
       *
       * `intro.key` is exactly what the keyboard calls, so the movie's own skip
       * flag still decides — which is what keeps the ownership QUESTION
       * unskippable (it carries no such flag, #171).
       */
      if (liveIntro) {
        // the answer is the return value and nothing else moves — see
        // InputLog.noteAnswered, and #171, which is this line's whole subject
        const took = liveIntro.key(ESCAPE_KEY, true);
        inputs.noteAnswered(
          inputLabel(ESCAPE_KEY),
          whereNow(),
          took ? "skipped the film" : "IGNORED — the film carries no skip flag",
        );
        return;
      }
      noteGame(inputLabel(ESCAPE_KEY), () =>
        session.track(host.director.keyDown(ESCAPE_KEY, true)),
      );
      return;
    }
    if (key === "downarrow") {
      const v = host.viewer;
      if (v) noteGame(inputLabel("downarrow"), () => session.track(v.keyDown("downarrow")));
      return;
    }
    pressArrow(key);
  },
  // read at RELEASE, so a box ticked mid-gesture applies to that gesture
  invert: () => swipeInvert,
});

screen.addEventListener("pointermove", (e) => {
  if (!touch.owns(e)) return;
  const { x, y } = canvasCoords(e);
  session.setPointer(x, y);
  touch.move(e);
});

/** a gesture the browser took away (a system edge-swipe): forget it, act on nothing */
window.addEventListener("pointercancel", (e) => touch.cancel(e));

/**
 * How the player has asked the two swipe axes to read, and where the answers
 * outlive the tab.
 *
 * The same two storage keys this page has always written: `bindSwipeInvert`
 * appends `.invertturn`/`.invertwalk` to the prefix, so nobody's setting is lost
 * to the move into the shared module. It owns the "is a finger even possible
 * here" test as well, which is what decides whether the row is shown — a mouse
 * has the arrow keys and never reaches a gesture, so on a desktop the question is
 * noise in a bar that is otherwise one hint and one button.
 */
const swipeInvert = bindSwipeInvert({
  storageKey: "taoot.swipe",
  turnBox: swipeInvertTurnBox,
  walkBox: swipeInvertWalkBox,
  reveal: swipeOpts,
});

/**
 * The picture setting under the screen, and its memory.
 *
 * Asked of everyone, unlike the swipe boxes: the original's landings are not
 * uniform — a right turn lands on the low-res standpoint for a moment before the
 * settled view redraws sharp, a left turn and a walk land sharp already (#68) —
 * and #75 asks for the three even readings of that as well. `original` is first
 * and is the default, so the setting costs nothing to anyone who never opens
 * this bar.
 *
 * The dropdown is BLURRED on change. A `<select>` owns the arrow keys while it
 * has focus (`focusOwnsKey`), and picking a mode is done with a pointer, so
 * leaving focus behind would leave the player unable to turn until they clicked
 * the screen again. The old checkbox never had the problem — it owned only Space.
 */
function installPictureOptions(): void {
  bindPictureMode();
  installBrightness();
  installMovement();
  // Its own row and its own question: this one is the GAME's setting, not the
  // page's — the box only changes what `heapsize()` answers, and TAOOT's own
  // scripts decide what that is worth (GameSession.lowMemory).
  if (lowMemoryBox)
    bindRememberedBox(
      lowMemoryBox,
      LOW_MEMORY_KEY,
      (on) => (session.lowMemory = on),
    );
}

/** where the picture answers outlive the tab */
const PICTURE_MODE_KEY = "taoot.picture.landing";
/** what the setting was called while it was a checkbox: `"1"` meant "always
 *  sharp", and a player who ticked it keeps that answer */
const SHARP_LANDING_KEY = "taoot.picture.sharplanding";
const BRIGHTNESS_KEY = "taoot.picture.brightness";
/** and where the movement row's answer does (#222) — its own namespace and
 *  not the picture one, because what it changes is the moving and not the look */
const MOVEMENT_KEY = "taoot.move.speed";
/** and where the low-memory row's one answer does */
const LOW_MEMORY_KEY = "taoot.sound.lowmemory";

function bindPictureMode(): void {
  if (!pictureModeSel) return;
  let stored: string | null = null;
  try {
    stored = window.localStorage.getItem(PICTURE_MODE_KEY);
    if (
      stored === null &&
      window.localStorage.getItem(SHARP_LANDING_KEY) === "1"
    )
      stored = "sharp";
  } catch {
    /* storage can be denied; the game then starts on the original every launch */
  }
  const mode = isPictureMode(stored) ? stored : "original";
  session.pictureMode = mode;
  pictureModeSel.value = mode;
  pictureModeSel.addEventListener("change", () => {
    const picked = pictureModeSel.value;
    if (!isPictureMode(picked)) return;
    session.pictureMode = picked;
    pictureModeSel.blur(); // give the arrow keys back to the game (see above)
    try {
      window.localStorage.setItem(PICTURE_MODE_KEY, picked);
    } catch {
      /* not remembering is survivable — the setting still holds for this tab */
    }
  });
}

/**
 * The brightness presets — the touch half of the original's F1/F2.
 *
 * Three of them, not a slider. This shipped as a slider first and a slider is the
 * wrong control for a thumb: the value it sets is an exponent nobody can reason
 * about, and hitting a 9rem groove on a phone is a drag gesture where a tap would
 * do. Three named choices are one tap each, and the keys stay there for anyone who
 * wants finer control.
 *
 * The offsets are counted in KEYPRESSES — six of the original's own 1.05 steps
 * either side of the default — so the presets and F1/F2 are the same setting rather
 * than two, and pressing the keys lands on a preset every sixth time. Neither end
 * goes past 1.0, i.e. neither is darker than the palette bytes on disc: the darkest
 * thing this offers is still a lift, which is what the original's default is.
 */
const BRIGHTNESS_PRESETS: Record<string, number> = {
  darker: -6,
  default: 0,
  brighter: 6,
};

function installBrightness(): void {
  if (!brightnessSeg) return;
  const radios = [
    ...brightnessSeg.querySelectorAll<HTMLInputElement>('input[type="radio"]'),
  ];
  const gammaFor = (steps: number): number =>
    DEFAULT_SCREEN_GAMMA / Math.pow(SCREEN_GAMMA_STEP, steps);
  /** the preset the live gamma IS, or "" when the keys have put it between two */
  const presetNow = (): string => {
    const g = screenGamma();
    for (const [name, steps] of Object.entries(BRIGHTNESS_PRESETS)) {
      if (Math.abs(g - gammaFor(steps)) < 1e-6) return name;
    }
    return "";
  };
  const show = (): void => {
    const now = presetNow();
    for (const r of radios) r.checked = r.value === now;
    if (brightnessValue) brightnessValue.textContent = screenGamma().toFixed(2);
  };
  let stored: string | null = null;
  try {
    stored = window.localStorage.getItem(BRIGHTNESS_KEY);
  } catch {
    /* storage can be denied; the presets then start at the default every launch */
  }
  if (stored && stored in BRIGHTNESS_PRESETS)
    setScreenGamma(gammaFor(BRIGHTNESS_PRESETS[stored]));
  show();
  for (const r of radios) {
    r.addEventListener("change", () => {
      if (!r.checked) return;
      setScreenGamma(gammaFor(BRIGHTNESS_PRESETS[r.value] ?? 0));
      show();
      try {
        window.localStorage.setItem(BRIGHTNESS_KEY, r.value);
      } catch {
        /* not remembering is survivable — the setting still holds for this tab */
      }
    });
  }
  // the keys move the same value, so the presets have to follow them — and show
  // nothing selected when a press has landed between two
  onScreenGammaShown = show;
}

/**
 * The movement speed — how long a frame of the player's OWN turn or walk is
 * held (#222).
 *
 * Four segments and no slider, for the reason {@link installBrightness} gives
 * and for one more: the values are not a continuum. `original` is the rate
 * measured out of TI.EXE (#205) and there is no reading of "a bit off it" that
 * anyone wants; what the request asked for was a slower walk, a faster one, or
 * none at all. `instant` is the last of those, and it is the original's own
 * `framerate(0)` — "don't wait".
 *
 * The readout beside them is the number itself, like the brightness row's
 * gamma, so the choice is never mystery meat: a player can see that "fast" is
 * 25 ms a frame and that "instant" holds no frame at all. It carries no words,
 * so it needs no translation.
 *
 * Radios rather than the picture row's `<select>`, so nothing has to be blurred
 * afterwards: a radio owns only Space (engine/src/web/keys.ts), and the arrows stay the
 * game's while one has focus — which matters here more than anywhere, because
 * the arrows are the very thing this setting is about.
 */
function installMovement(): void {
  if (!movementSeg) return;
  const radios = [
    ...movementSeg.querySelectorAll<HTMLInputElement>('input[type="radio"]'),
  ];
  const show = (): void => {
    for (const r of radios) r.checked = r.value === session.moveSpeed;
    if (movementValue)
      movementValue.textContent = `${MOVE_SPEED_MS[session.moveSpeed]} ms`;
  };
  let stored: string | null = null;
  try {
    stored = window.localStorage.getItem(MOVEMENT_KEY);
  } catch {
    /* storage can be denied; the game then starts on the original every launch */
  }
  if (isMoveSpeed(stored)) session.moveSpeed = stored;
  show();
  for (const r of radios) {
    r.addEventListener("change", () => {
      if (!r.checked || !isMoveSpeed(r.value)) return;
      session.moveSpeed = r.value;
      show();
      try {
        window.localStorage.setItem(MOVEMENT_KEY, r.value);
      } catch {
        /* not remembering is survivable — the setting still holds for this tab */
      }
    });
  }
}

/** set by {@link installBrightness} so the F-keys can refresh the presets */
let onScreenGammaShown: (() => void) | null = null;


/**
 * The state list in the pane (#22), and what turns it on.
 *
 * Off by default and remembered, like the other three boxes: 161 variable names
 * are an answer to a question a player did not ask, and the reader who did ask
 * gets it back on the next launch. `?debug=1` in the URL is the same answer in a
 * link — one thing to bookmark, for someone whose reason for opening the page at
 * all is to find out what the game is doing.
 *
 * REFRESH_MS is 250 rather than a frame: the panel is a hundred rows of DOM and
 * the game services itself every 50 ms (engine/src/runtime/clock.ts), so redrawing it in step
 * with the engine would be four times the work for a list nobody can read that
 * fast. It follows the fade and the room within a quarter second, which is the
 * speed of the question being asked of it.
 */
const REFRESH_MS = 250;


/** where the state box's answer outlives the tab */
const DEBUG_STATE_KEY = "taoot.details.state";

/** …and the input log's (#178) */
const DEBUG_INPUTS_KEY = "taoot.details.inputs";

/**
 * The variables list — the pane's second half, and the engine's
 * (engine/src/web/state-list.ts).
 *
 * It owns the checkbox, the filter, the `all` box, the two lists and the poll,
 * because every one of those is a question about a session and every session is
 * the same shape. What this page keeps is what is ITS: the spine above, the log
 * above that, the Copy-details button, and the X that opens the column.
 */
const stateList = installStateList({
  state: liveState,
  spine: SPINE,
  storageKey: DEBUG_STATE_KEY,
  // On where the pane is the page and off where it is a player's aid — the same
  // rule the column itself follows (DETAILS_ALWAYS). A workbench whose debug
  // column opened on the log alone would answer half the question it is there for.
  defaultOn: DETAILS_ALWAYS,
  visible: () => !details.hidden,
});

function installDebugPanel(): void {
  const asked =
    new URLSearchParams(window.location.search).get("debug") === "1";
  if (asked) {
    details.hidden = false;
    try {
      window.localStorage.setItem(DETAILS_OPEN_KEY, "1");
      window.localStorage.setItem(DEBUG_STATE_KEY, "1");
      // The input log too, because `?debug=1` is the link somebody is SENT when
      // a report needs more than it carried, and what that report was missing
      // is most often which gesture caused the thing (#178).
      window.localStorage.setItem(DEBUG_INPUTS_KEY, "1");
    } catch {
      /* the link still works for this tab */
    }
  }
  // The input log (#178): on the workbench a run IS a sequence of gestures, and
  // on the play page a player who has not asked should not have their log
  // doubled in length. This game's own, because this game's log is.
  bindRememberedBox(dbgInputsOn, DEBUG_INPUTS_KEY, (on) => (inputs.on = on), DETAILS_ALWAYS);
  dbgCopy.addEventListener("click", () => void copyDetails());
}

/** the snapshot the panel and the clipboard both read — the goldens' own */
function liveState(): StateTrace {
  return snapshotState(session, host.viewer ?? null, "live");
}


/**
 * The whole state and the whole log, on the clipboard.
 *
 * This is what #22 is really asking for: the Report bug button can carry eight
 * lines and no state at all, because the issue travels as a URL under a 4000-byte
 * ceiling and one snapshot is 3234 bytes of state before the log it comes with. So
 * the dump is an attachment,
 * and it is shaped like a golden trace (taoot/src/debug-panel.ts stateDump) so that a
 * reporter's paste can be diffed against a recorded playthrough.
 */
async function copyDetails(): Promise<void> {
  const text = stateDump(liveState(), logLines.lines, [
    `taoot ${VERSION}`,
    `edition: ${editionName(editionCode)} (gamefiles/${editionCode}/)`,
    `browser: ${navigator.userAgent}`,
  ]);
  let said = t("play.debugCopied");
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // A browser that will not take the clipboard still gets to hand the file over
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "taoot-details.txt";
    a.click();
    URL.revokeObjectURL(url);
    said = t("play.debugSaved");
  }
  dbgNote.textContent = said;
  window.setTimeout(() => (dbgNote.textContent = ""), BUG_NOTE_MS);
}

installPictureOptions();
installDebugPanel();

/**
 * The arrow keys' own route, shared with the swipe handler: a full-screen overlay
 * stage (the deck map) consumes arrows itself, and only past that do the three
 * movement arrows go through the script chain via pressNav.
 */
function pressArrow(name: "uparrow" | "leftarrow" | "rightarrow"): void {
  const v = host.viewer;
  if (!v) return;
  // One label for both routes, because the PLAYER did one thing: which of the
  // two a press takes is the page's business (an overlay stage takes its own
  // keys), and the log is a record of gestures rather than of routing.
  const what = inputLabel(name);
  if (!session.viewShowing && session.stageCtrl.keydownTarget()) {
    noteGame(what, () => session.track(v.keyDown(name, false)));
    return;
  }
  noteGame(what, () => session.track(v.pressNav(name)));
}

screen.addEventListener("mousemove", (e) => {
  const { x, y } = canvasCoords(e);
  // while dragging, just track the pointer — don't run hover's setcursor
  // scripts concurrently with the suspended drag handler
  if (session.pointerDown) {
    session.setPointer(x, y);
    return;
  }
  // The director's, not a viewer's, and for the third time on this page: what is
  // under the pointer is a question about the SCREEN. `ScreenDirector.hover`
  // answers for a stage button and a flat with no room open at all, which is the
  // whole of what the demo's menu is — without it its portholes never took the
  // `cursor("touch")` their own setcursor handlers ask for.
  void host.director.hover(x, y).then(showCursor);
});

/**
 * Browser key -> the name the engine sees, the window proc's whole job.
 *
 * TI.EXE names only these four (they are the only key-name strings in the
 * binary); every other key reaches a script as its literal character. ESC is
 * one of those: its window-proc case (0x41ad68) hands it on as `.` with the
 * special-key marker set. Nothing in the scripts tests for it — deciding what
 * `.` means belongs to whoever is modal, and while a movie plays that is the
 * movie (see MoviePlayer.key).
 */
const DF_KEY: Record<string, string> = {
  ArrowLeft: "leftarrow",
  ArrowRight: "rightarrow",
  ArrowUp: "uparrow",
  ArrowDown: "downarrow",
  Escape: ".",
};

/**
 * TI.EXE's 0x1fa0 marker: the key is ESC, or was held with Ctrl. The movie key
 * filter requires it, so a plain "." typed at a movie is not an abort.
 */
const isSpecialKey = (e: KeyboardEvent): boolean =>
  e.key === "Escape" || e.ctrlKey;

/**
 * The original's display-gamma keys, by virtual key — TI.EXE's WM_KEYDOWN jump
 * table at 0x41b118 (byte index 0x41b158, key = VK - 0x1b), whose F1-F9 arms all
 * call 0x41b210 with a direction and one flag per colour channel.
 *
 * F1 BRIGHTENS and F2 darkens, which is the right way round even though it reads
 * backwards: the value is an exponent, F1 divides it by 1.05, and a smaller
 * exponent lifts a colour. The manual names the pair as Ctrl+F1/Ctrl+F2 — the code
 * dispatches on the virtual key alone, with no Ctrl test on these arms, so Ctrl
 * makes no difference and both work.
 */
const GAMMA_KEYS: Record<string, { up: boolean; ch: GammaChannels } | "reset"> =
  {
    F1: { up: false, ch: ALL_CHANNELS },
    F2: { up: true, ch: ALL_CHANNELS },
    F3: { up: false, ch: [true, false, false] },
    F4: { up: true, ch: [true, false, false] },
    F5: { up: false, ch: [false, true, false] },
    F6: { up: true, ch: [false, true, false] },
    F7: { up: false, ch: [false, false, true] },
    F8: { up: true, ch: [false, false, true] },
    F9: "reset",
  };

/**
 * Hand a key to the GAME — the director, which is where a key lands anyway.
 *
 * `SetViewer.keyDown` is one line that delegates here, so nothing about this is
 * new behaviour; what is new is that it also works when there is no room to
 * view. That mattered for one edition and not the others, which is why it took a
 * bug report to find: the 1996 demo (`?edition=demo`) opens NO SET EVER. Its
 * BOOTFILE plays `open.mov` and then opens `demo.stg`, a menu that is a stage
 * flat with four portholes on it — no room behind it at any point — so
 * `host.viewer` is null for the whole life of the page, and a `if (!v) return`
 * at the top of the key handler dropped every key the demo could be sent.
 * Reported as "cannot use ESC to cancel the introductions and jump to menu"
 * (#299): ESC is exactly the key that reaches a playing movie and aborts it, and
 * it was being thrown away one line before it could.
 *
 * The full game hides this because the port loads `bedsit1` before running
 * `boot()`, so a viewer happens to exist while the films that want ESC are
 * playing. The ORIGINAL has no room open there either — its BOOTFILE opens the
 * bedsit from `advanceday()`, which runs after `logo.mov` and `playmode.mov` —
 * so a key that needs a room was never the original's rule, only ours. Dust's
 * page reached the same conclusion from the other end ("A KEY needs the game,
 * not a viewer", dust/src/main.ts); this is that fix, on the page it had not
 * reached yet.
 */
function keyToGame(name: string, special = false): void {
  noteGame(inputLabel(name), () => session.track(host.director.keyDown(name, special)));
}

window.addEventListener("keydown", (e) => {
  // The gamma keys go FIRST — before everything below, which is
  // where they were until a browser check found F1 dead on the loading screen. In
  // TI.EXE these arms sit in the window proc ahead of everything, so they work over
  // a playing movie, under a full-screen overlay stage, and while the game is still
  // coming up; the only thing that outranks them is the page's own focus, because
  // typing in a field has to stay typing.
  const gamma = GAMMA_KEYS[e.key];
  if (gamma && !focusOwnsKey(e.target, e.key)) {
    if (gamma === "reset") resetScreenGamma();
    else stepScreenGamma(gamma.up, gamma.ch);
    onScreenGammaShown?.();
    // F1 is the browser's help key and F3 its find; the game had them first
    e.preventDefault();
    return;
  }
  const isDetailsKey =
    !focusOwnsKey(e.target, e.key) && (e.key === "x" || e.key === "X");
  // X used to outrank a VIEWER guard here, on the argument that the pane REMEMBERS
  // being open (taoot.details.open), so a reader who left it up gets it back on the
  // loading screen — and behind the guard, the key that put it there could not take
  // it down again. The guard is gone (see keyToGame) and the argument is not: X is
  // still answered before anything asks whether there is a game to send a key to.
  const v = host.viewer;
  // Typed into something on the page, not at the game (engine/src/web/keys.ts). This listens
  // on `window`, and the page's own keys are LETTERS — so without this, filtering
  // the state list for "mission" toggled the minimap on the M and the hotspot
  // overlay on the O, and sent all seven letters to the script chain besides.
  if (focusOwnsKey(e.target, e.key)) return;
  // a full-screen overlay stage (the deck map) consumes all keys itself — and it
  // does NOT yield X, which is the one place the pane key has to give way. The
  // Enigma is such a stage and its keydown TYPES: ZEITEL's telegram spells
  // `anhqsppaixwbfcxyam`, so a pane toggle up here ate both of its X's and the
  // machine could never be made to decode — mission 1 with no way past it. The
  // deck map and the intro question lose the pane key while they are up, which is
  // a shortcut deferred rather than a screen made useless (#265, and #257 which
  // put X above this branch).
  if (!session.viewShowing && session.stageCtrl.keydownTarget()) {
    const df = DF_KEY[e.key] ?? (e.key.length === 1 ? e.key.toLowerCase() : "");
    if (df) {
      keyToGame(df, isSpecialKey(e));
      e.preventDefault();
    }
    return;
  }
  if (isDetailsKey) {
    toggleDetails();
    return;
  }
  switch (e.key) {
    // All three movement arrows go through the script chain first — scripts
    // intercept walking (doors leading to other sets) AND turning (the 2nd class
    // staircase turns 90° per press across its 8-view landings). See pressNav.
    case "ArrowRight":
      pressArrow("rightarrow");
      break;
    case "ArrowLeft":
      pressArrow("leftarrow");
      break;
    case "ArrowUp":
      pressArrow("uparrow");
      break;
    case "ArrowDown":
      keyToGame("downarrow");
      break;
    case " ":
      // SPACE is the door opener (not a general click): BOOTFILE keydown scans
      // the current view's hotspots and fires mousedown only on a painting named
      // "door", "locked" or "knock" — open/close a door, rattle a locked one, or
      // knock. Route it through the script chain like the arrows.
      keyToGame(" ");
      break;
    case "Escape":
      // Forwarded, not acted on: a live movie takes it and aborts (the game's
      // own way past a cutscene), and with no movie up it reaches the script
      // chain as "." and is ignored — which is what the original does too.
      // TI.EXE's other abort key, Ctrl+Q, is left unbound: the movie filter
      // knows it, but it is a browser-level shortcut here.
      keyToGame(".", true);
      break;
    // The only two arms that really do need a room: they toggle the ROOM's own
    // overlays, and an edition with no room (the demo) has neither to show.
    case "m":
    case "M":
      if (!v) return;
      v.showMap = !v.showMap;
      refreshMap();
      break;
    case "o":
    case "O":
      if (!v) return;
      v.showHotspots = !v.showHotspots;
      break;
    default: {
      // Everything else goes to the game, because that is what the original does:
      // TI.EXE's window proc translates every printable key through its VK table
      // and hands it to the boot's keydown, which maps the player's movement
      // bindings (`keynorth`/`keywest`/`keyeast` — A/W/D by default, rebindable
      // from the control panel) and passes the rest to the scene. Dropping them
      // here is why those bindings did nothing at all (#14); a letter no script
      // wants is ignored by the scripts, which is not the same as never arriving.
      // A letter pressed while a move is on screen is QUEUED, like an arrow — the
      // gate is inside `keyDown`, above the mapping, where the original keeps it
      // (#207). It was in the arrow-only path, so W/A/D were dropped mid-move.
      //
      // Modified presses stay the browser's — Ctrl+R has to reload, and the
      // original's own Ctrl marker only ever mattered to its movie key filter.
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const ch = e.key.length === 1 ? e.key.toLowerCase() : "";
      if (!ch) return;
      keyToGame(ch);
      break;
    }
  }
  e.preventDefault();
});

// ---------------------------------------------------------------------------
// The frame loop
// ---------------------------------------------------------------------------

/**
 * The screen, not the room.
 *
 * This used to be `if (host.viewer) { tick; render }` — so on any frame with no
 * room open there was no fade ramping, no movie advancing, no delay clock moving
 * and nothing drawn. The demo's boot is exactly that frame: it plays its logos
 * and opens a menu stage before it has a room, and the port had to open one it
 * did not want just to have something to run this loop on
 * (`GameHost.coldBoot`, now without that workaround).
 */
function loop(now: number): void {
  host.director.tick(now);
  host.director.render(ctx);
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
