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
import { DeferredAudioSink, WebAudioSink } from "./engine/audio";
import { isMoveSpeed, isPictureMode, MOVE_SPEED_MS } from "./engine/session";
import { GameHost } from "./host";
import { loadTemplates, saveTemplateFor, seedSaves } from "./save-seed";
import { browseForLoad, browseForSave } from "./save-browser";
import { TAOOT_SAVES, useSaveKind } from "./save-store";
import { readSaveFile } from "./df/savegame";
import { FileStore } from "./files";
import { StateTrace, snapshotState } from "./engine/trace";
import { seededRng } from "./engine/rng";
import { LangChooser, chooserOrder, preselectedEdition } from "./lang-chooser";
import { GOG_URL, NIGHTDIVE_MOVIE, NightdiveIntro, Ownership, introPlaysFor } from "./nightdive";
import { DEFAULT_LANGUAGE, EDITION_STORAGE_KEY, LANG_STAGE, editionName } from "./languages";
import { installLanguageMenu } from "./lang-menu";
import { VERSION, installVersion } from "./version";
import { gamefileManifest, gamefileSizes, installEditionPicker, markEdition } from "./editions";
import { installI18n, t } from "./locales";
import { installBugReport } from "./bug-report";
import { LOG_LINES_KEPT, LogBuffer } from "./log-buffer";
import { ChangeWatch, RowView, stateDump, stateView } from "./debug-panel";
import { focusOwnsKey, swipeKey } from "./keys";
import { siteUrl, sitePath } from "./site";
import {
  ALL_CHANNELS,
  DEFAULT_SCREEN_GAMMA,
  SCREEN_GAMMA_STEP,
  type GammaChannels,
  resetScreenGamma,
  screenGamma,
  setScreenGamma,
  stepScreenGamma,
} from "./screen-gamma";

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
/** which copy of the game is being played, as buttons (src/lang-menu.ts).
 *  Absent on /speedrun/: a route is timed against one edition, English. */
const editionPicker = document.getElementById("editionPicker");
const fsBtn = document.getElementById("fsBtn") as HTMLButtonElement | null;
const bugBtn = document.getElementById("bugBtn") as HTMLButtonElement | null;
/** where the bug button says what became of the screenshot */
const bugNote = document.getElementById("bugNote");
/** which way a swipe reads — its own row, hidden unless the pointer is a finger */
const swipeOpts = document.getElementById("swipeOpts");
const swipeInvertTurnBox = document.getElementById("swipeInvertTurn") as HTMLInputElement | null;
const swipeInvertWalkBox = document.getElementById("swipeInvertWalk") as HTMLInputElement | null;
const pictureModeSel = document.getElementById("pictureMode") as HTMLSelectElement | null;
const lowMemoryBox = document.getElementById("lowMemory") as HTMLInputElement | null;
const brightnessSeg = document.getElementById("brightnessSeg");
const brightnessValue = document.getElementById("brightnessValue");
const movementSeg = document.getElementById("movementSeg");
const movementValue = document.getElementById("movementValue");
/** where you are and what the engine is doing: the X pane, off by default */
const details = document.getElementById("details") as HTMLDivElement;
const scriptlog = document.getElementById("scriptlog") as HTMLPreElement;
/** the state list inside the pane, and what asks for it (#22) */
const dbgStateOn = document.getElementById("dbgStateOn") as HTMLInputElement;
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
// (src/screen.ts), so nothing in the renderer cares.
fsBtn?.addEventListener("click", () => {
  if (document.fullscreenElement) void document.exitFullscreen();
  else void stage.requestFullscreen().catch((e) => log(`fullscreen: ${e.message}`));
});
document.addEventListener("fullscreenchange", () => {
  if (fsBtn) fsBtn.textContent = document.fullscreenElement ? "⛶ Exit fullscreen" : "⛶ Fullscreen";
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
files.onBusyChange = (inFlight) => {
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
};

/**
 * The Report bug button (src/bug-report.ts): a GitHub issue with the room, the
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
    canvas: screen,
    where: () => hud.textContent ?? "",
    edition: () => `${editionName(editionCode)} (gamefiles/${editionCode}/)`,
    log: (n) => logLines.tail(n),
    // said in the reader's language, and only here: the issue itself is English,
    // because it is read by whoever fixes it
    note: (how) => {
      if (!bugNote) return;
      bugNote.textContent =
        how === "clipboard" ? t("play.bugShotClipboard") : t("play.bugShotFile");
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
  const atTail = scriptlog.scrollHeight - scriptlog.scrollTop - scriptlog.clientHeight < 4;
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
 *  who wants it open gets it open on the next launch too. */
function toggleDetails(): void {
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

/** did the player leave the pane open last time? */
function detailsWanted(): boolean {
  try {
    return window.localStorage.getItem(DETAILS_OPEN_KEY) === "1";
  } catch {
    return false;
  }
}

// DreamFactory cursor names -> CSS cursors. The list is CLOSED, because the
// corpus is: every `cursor(...)` call in every script in the tree names one of
// five — touch (809), arrow (75), hand (36), watch (18), fist (2). `take`,
// `turn`, `look` and `talk` used to be here and are emitted by nothing; they
// were ours, from when the port decided cursors itself instead of asking.
const CURSOR_CSS: Record<string, string> = {
  touch: "pointer",
  // a script asking for the plain arrow, and 75 places do. Unmapped it fell to
  // the `?? "pointer"` default below, so "explicitly not clickable" drew a hand —
  // the notebook lying on the smokestack platform is the worked example.
  arrow: "default",
  hand: "grab",
  fist: "grabbing",
  // boot1's idle() sets this while `lockevents` freezes the world — the air
  // raid, the turbine trigger. Without the mapping a frozen game showed the
  // same hand as a live one over things that would not answer.
  watch: "wait",
};

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
    if (help) help.style.display = "block";
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
    changeWatch.reset();
  },
  mapChanged: () => refreshMap(),
});
const session = host.session;

// dialog builtins -> native browser dialogs; quit reloads to the boot screen
session.onNoteDialog = (message) => {
  window.alert(message);
};
session.onQuestionDialog = (message) => window.confirm(message);
session.onTextDialog = (prompt, initial) => window.prompt(prompt, initial) ?? "";
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
session.nextFrame = () => new Promise<void>((res) => requestAnimationFrame(() => res()));
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
// (src/save-store.ts).
useSaveKind({
  ...TAOOT_SAVES,
  valid: (bytes) => {
    readSaveFile(bytes);
    return true;
  },
});
// savegame builtin: the native Save As dialog becomes the in-app save browser,
// which stores the produced .ti bytes into the IndexedDB save "file system"
// (src/save-store.ts) under a player-chosen name.
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

// debug handle for the console and browser-automation tests (tests/browser/menu-movie.ts,
// tests/browser/playthrough.ts). snapshotState/seededRng are handed out rather
// than reimplemented page-side so a browser trace and a headless one are
// produced by the same code and can be compared byte for byte.
//
// `intro` is here for the same reason `viewer` is: it is what is on screen, and
// automation cannot drive what it cannot see. There is no viewer until the boot
// activates a set, so during the intro EVERY viewer-shaped predicate is
// undefined — which is exactly how the browser gate came to sit through its
// whole 300 s budget "waiting for the boot menu" at a film that was waiting for
// it (tests/browser/playthrough.ts, escapeIntro).
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
// tree (src/lang-chooser.ts explains why it is a stage and not a dialog)
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
// The intro: nightdive.mov, and the question it ends on (src/nightdive.ts)
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
const skipsIntro = (): boolean => !!document.querySelector('meta[name="skip-intro"]');

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
const mutesTheme = (): boolean => !!document.querySelector('meta[name="mute-theme"]');

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
  document.querySelector('meta[name="edition"]')?.getAttribute("content")?.toLowerCase() ?? null;

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
  };
  // ESC and the volume digits, both through the movie's own key filter — the
  // marker is what that filter insists on for the abort, and the header flag is
  // what decides (MoviePlayer.key). The digits are here and not only in the
  // in-game listener below because the logos and the menu ARE movies, played by
  // this intro rather than by a viewer (there is none until a set opens), and the
  // credits over a title screen are exactly where a player reaches for the volume.
  const onKey = (e: KeyboardEvent): void => {
    ensureAudio();
    if (e.key === "Escape") intro.key(".", true);
    else if (e.key.length === 1 && e.key >= "0" && e.key <= "9" && !e.ctrlKey && !e.metaKey && !e.altKey) {
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
  if (pinned && installed.includes(pinned)) return { code: pinned, asked: false };
  if (pinned) log(`this page asks for the ${pinned} edition, which is not installed`);

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
  const picked = askable.length > 1 ? await runLangChooser(askable) : askable[0];
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
  const intro: Promise<Ownership> = introPlaysFor(code) && !skipsIntro()
    ? runNightdiveIntro()
    : Promise.resolve("unanswered");
  const loading = host.preload({ sizeOf, onProgress: asked ? undefined : showPreload });
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
  // it: the same row the editors and the collection carry (src/editions.ts).
  if (editionPicker) void installEditionPicker(editionPicker);
  await initServerBrowser();
}
void boot();

// ---------------------------------------------------------------------------
// Input: pointer + keyboard, routed into the engine
// ---------------------------------------------------------------------------

/** map a mouse event to view-pixel coordinates on the canvas */
function canvasCoords(e: MouseEvent): { x: number; y: number } {
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
  const viewer = host.viewer;
  if (!viewer) return;
  const { x, y } = canvasCoords(e);
  session.setPointer(x, y);
  // a finger is ambiguous until it moves — see beginTouch
  if (e.pointerType === "touch") {
    beginTouch(e, x, y);
    return;
  }
  session.pointerDown = true;
  // What the press CARRIED, for `shiftkey()` (engine/builtins/scene.ts). Taken
  // here rather than tracked as live keyboard state because that is how the
  // original asks: house.shp's HELP button reads it inside its own mousedown, so
  // the question is what was held when the click happened.
  session.shiftDown = e.shiftKey;
  void session.track(viewer.press(x, y), `press ${x},${y}`);
});

// release anywhere ends a drag (the pointer may leave the canvas mid-drag).
// It also ANSWERS a conversation: a bevel is tracked while held and only
// counts if the button comes up inside the row it went down on. The position
// is the last one pointermove saw, which is live throughout a drag and is
// still right when the release happens off-canvas (where it lands on no row,
// so the answer is correctly discarded).
window.addEventListener("pointerup", (e) => {
  if (touch && e.pointerId === touch.id) {
    endTouch(e);
    return;
  }
  session.pointerDown = false;
  // `shiftDown` is deliberately NOT cleared here. A press dispatch is async — it
  // can be waiting on a movie or a walk when the button comes up — and the script
  // that reads `shiftkey()` may not have run yet. It says what the last press
  // carried until the next press says otherwise, which is the question scripts
  // actually ask.
  host.viewer?.release(session.pointerX, session.pointerY);
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
 */
/** CSS px a finger must travel before the gesture counts as a swipe */
const SWIPE_MIN_PX = 48;
/** a finger still on the glass this long is holding a control, not swiping */
const TAP_HOLD_MS = 220;
/**
 * Two taps in the same place this close together are the phone's ESCAPE — the key
 * a cutscene is skipped with, which a phone has no way to press. Forwarded exactly
 * as the key is (`keyDown(".", true)`), so a live movie aborts and anything else
 * ignores it.
 *
 * Only the SECOND tap is swallowed. The first has already been sent as a click,
 * because holding every tap back to see whether another follows would put 300 ms
 * of lag on every press in the game — and during a clip, which is what this is
 * for, a tap that reaches no region does nothing anyway.
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
 * A finger that goes down on a CONTROL is never a swipe.
 *
 * The ambiguity the hold timer resolves is between a swipe (navigate) and a
 * press (play), and it resolves it by WAITING — which is fine for a tap and
 * wrong for a drag, because a drag moves immediately. The game's drags are
 * `while stilldown()` loops that read `mouse()`, and the inventory's is the
 * one that matters: TAOOT's INVEN.SHP `stdmouse` carries a held item with
 * `propxy(handitem, pointx(arg), pointy(arg))` and drops it on whatever
 * `hittest` finds when the button comes up — that is how the trunk key is
 * used. Travel 48 px inside 220 ms, which any real drag does, and the gesture
 * was ruled a swipe, no mousedown was ever delivered, and the camera walked
 * instead.
 *
 * So ask what is under the finger before deciding. A PROP or a stage BUTTON is
 * a control — the press goes through at once, with no hold and no swipe. Room
 * surfaces (a scene, a hotspot, an actor, the flat behind the band) keep the
 * old behaviour, because swiping the ROOM is how a phone walks and those are
 * what a navigating swipe starts on.
 */
function touchOwnedByGame(x: number, y: number): boolean {
  const kind = session.hitTestAt(x, y).type;
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
    // a control takes the press now; everything else waits to see what the
    // gesture becomes (see holdTouch / the pointermove swipe test)
    holdTimer: control ? 0 : window.setTimeout(() => holdTouch(), TAP_HOLD_MS),
  };
  touch = g;
  if (control) holdTouch();
}

/** the finger stayed put: it is a press after all, so hand the mousedown over */
function holdTouch(): void {
  const g = touch;
  const v = host.viewer;
  if (!g || g.pressed || g.swiped || !v) return;
  g.pressed = true;
  session.pointerDown = true;
  void session.track(v.press(g.x, g.y));
}

screen.addEventListener("pointermove", (e) => {
  const g = touch;
  if (!g || e.pointerId !== g.id) return;
  const { x, y } = canvasCoords(e);
  session.setPointer(x, y);
  if (g.pressed || g.swiped) return; // already committed either way
  if (Math.hypot(e.clientX - g.clientX, e.clientY - g.clientY) < SWIPE_MIN_PX) return;
  // committed to a swipe; the DIRECTION is read at release, off the whole
  // journey, so a wobbly first few pixels don't get to choose it
  g.swiped = true;
  clearTimeout(g.holdTimer);
});

function endTouch(e: PointerEvent): void {
  const g = touch;
  if (!g) return;
  clearTimeout(g.holdTimer);
  touch = null;
  const v = host.viewer;
  if (!v) return;
  if (g.pressed) {
    // it was a hold: end it the way any other release does
    session.pointerDown = false;
    v.release(session.pointerX, session.pointerY);
    return;
  }
  if (g.swiped) {
    swipeArrow(e.clientX - g.clientX, e.clientY - g.clientY);
    return;
  }
  // a second tap in the same place, promptly: that is ESC, not a click
  const now = performance.now();
  if (
    now - lastTapAt < DOUBLE_TAP_MS &&
    Math.hypot(e.clientX - lastTapX, e.clientY - lastTapY) < DOUBLE_TAP_PX
  ) {
    lastTapAt = 0;
    void session.track(v.keyDown(".", true));
    return;
  }
  lastTapAt = now;
  lastTapX = e.clientX;
  lastTapY = e.clientY;
  // a tap: down and up at the point the finger landed, not where it lifted.
  // Not awaited between the two — press() may not resolve until a close-up it
  // opened is dismissed, and the mouseup belongs to the tap, not to the movie.
  session.pointerDown = true;
  void session.track(v.press(g.x, g.y));
  session.pointerDown = false;
  v.release(g.x, g.y);
}

/** a gesture the browser took away (a system edge-swipe): forget it, act on nothing */
window.addEventListener("pointercancel", (e) => {
  if (!touch || e.pointerId !== touch.id) return;
  clearTimeout(touch.holdTimer);
  if (touch.pressed) {
    session.pointerDown = false;
    host.viewer?.release(session.pointerX, session.pointerY);
  }
  touch = null;
});

/**
 * Send the arrow a swipe means. Which arrow that is — and why each axis can be
 * inverted — is {@link swipeKey}; this is only the dispatch, and the two halves
 * differ: three of the four are navigation presses that the scripts may intercept,
 * and DOWN is a plain key event, exactly as `ArrowDown` is on a keyboard.
 */
function swipeArrow(dx: number, dy: number): void {
  const key = swipeKey(dx, dy, swipeInvert);
  const v = host.viewer;
  if (!key || !v) return;
  if (key === "downarrow") {
    void session.track(v.keyDown("downarrow"));
    return;
  }
  pressArrow(key);
}

/** how the player has asked the two swipe axes to read */
const swipeInvert = { turn: false, walk: false };

/** where the two answers outlive the tab */
const SWIPE_INVERT_TURN_KEY = "taoot.swipe.invertturn";
const SWIPE_INVERT_WALK_KEY = "taoot.swipe.invertwalk";

/**
 * The two checkboxes in the bar under the screen, and their memory.
 *
 * Shown only where a swipe is possible at all: a mouse has the arrow keys and
 * never reaches {@link swipeArrow}, so on a desktop the question is noise in a
 * bar that is otherwise one hint and one button. `maxTouchPoints` as well as the
 * media query because a laptop with a touchscreen reports a FINE pointer while
 * still delivering `pointerType === "touch"` — the gesture is live there, so the
 * setting has to be reachable.
 */
function installSwipeOptions(): void {
  const touchable = navigator.maxTouchPoints > 0 || window.matchMedia("(pointer: coarse)").matches;
  if (!touchable) return;
  if (!swipeOpts || !swipeInvertTurnBox || !swipeInvertWalkBox) return;
  swipeOpts.hidden = false;
  bindSwipeOption(swipeInvertTurnBox, SWIPE_INVERT_TURN_KEY, (on) => (swipeInvert.turn = on));
  bindSwipeOption(swipeInvertWalkBox, SWIPE_INVERT_WALK_KEY, (on) => (swipeInvert.walk = on));
}

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
  if (lowMemoryBox) bindSwipeOption(lowMemoryBox, LOW_MEMORY_KEY, (on) => (session.lowMemory = on));
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
    if (stored === null && window.localStorage.getItem(SHARP_LANDING_KEY) === "1") stored = "sharp";
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
  const radios = [...brightnessSeg.querySelectorAll<HTMLInputElement>('input[type="radio"]')];
  const gammaFor = (steps: number): number => DEFAULT_SCREEN_GAMMA / Math.pow(SCREEN_GAMMA_STEP, steps);
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
  if (stored && stored in BRIGHTNESS_PRESETS) setScreenGamma(gammaFor(BRIGHTNESS_PRESETS[stored]));
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
 * afterwards: a radio owns only Space (src/keys.ts), and the arrows stay the
 * game's while one has focus — which matters here more than anywhere, because
 * the arrows are the very thing this setting is about.
 */
function installMovement(): void {
  if (!movementSeg) return;
  const radios = [...movementSeg.querySelectorAll<HTMLInputElement>('input[type="radio"]')];
  const show = (): void => {
    for (const r of radios) r.checked = r.value === session.moveSpeed;
    if (movementValue) movementValue.textContent = `${MOVE_SPEED_MS[session.moveSpeed]} ms`;
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

function bindSwipeOption(box: HTMLInputElement, key: string, apply: (on: boolean) => void): void {
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
 * the game services itself every 50 ms (engine/clock.ts), so redrawing it in step
 * with the engine would be four times the work for a list nobody can read that
 * fast. It follows the fade and the room within a quarter second, which is the
 * speed of the question being asked of it.
 */
const REFRESH_MS = 250;

/** where the state box's answer outlives the tab */
const DEBUG_STATE_KEY = "taoot.details.state";

/** which globals moved lately, so the list can light them for a moment */
const changeWatch = new ChangeWatch();

/**
 * The two lists, each keeping its element in step by touching only what differs.
 *
 * Rebuilt lists were the first version and the wrong one: the panel polls (the
 * engine has no "a global changed" event), so `replaceChildren` threw away and
 * re-made every row four times a second whether or not the game had done anything.
 * See {@link RowView} — an update over a quiet game now writes nothing.
 */
const spineView = new RowView(dbgSpine, { row: "span", name: "span", value: "span" }, "");
const rowsView = new RowView(dbgRows);

function installDebugPanel(): void {
  const asked = new URLSearchParams(window.location.search).get("debug") === "1";
  if (asked) {
    details.hidden = false;
    try {
      window.localStorage.setItem(DETAILS_OPEN_KEY, "1");
      window.localStorage.setItem(DEBUG_STATE_KEY, "1");
    } catch {
      /* the link still works for this tab */
    }
  }
  bindSwipeOption(dbgStateOn, DEBUG_STATE_KEY, (on) => {
    dbgState.hidden = !on;
    if (on) refreshState();
  });
  for (const el of [dbgFilter, dbgAll]) el.addEventListener("input", () => refreshState());
  dbgCopy.addEventListener("click", () => void copyDetails());
  window.setInterval(() => {
    // Only while it can be read: the snapshot walks the globals, the props and the
    // actors, and doing that four times a second behind a shut pane is work for
    // no one.
    if (details.hidden || dbgState.hidden) return;
    refreshState();
  }, REFRESH_MS);
}

/** the snapshot the panel and the clipboard both read — the goldens' own */
function liveState(): StateTrace {
  return snapshotState(session, host.viewer ?? null, "live");
}

function refreshState(): void {
  const trace = liveState();
  const changed = changeWatch.update(trace.globals, performance.now());
  const view = stateView(trace, {
    filter: dbgFilter.value,
    all: dbgAll.checked,
    changed,
  });
  // `#hud` is left alone: the viewer owns it (it names the hotspot count too, and
  // a bug report's title is read off it). The strip here says what the hud cannot
  // — the six the game names, the theme, and the fade while there is one.
  spineView.apply([...view.spine, ...view.head]);
  // Said as a count rather than as a sentence: it is the answer to "is anything
  // happening", and 156 variables sitting still IS the answer.
  const rows = view.rest.length
    ? view.rest
    : [{ name: view.hidden ? `${view.hidden} unchanged` : "—", value: "", changed: false, quiet: true }];
  rowsView.apply(rows);
}

/**
 * The whole state and the whole log, on the clipboard.
 *
 * This is what #22 is really asking for: the Report bug button can carry eight
 * lines and no state at all, because the issue travels as a URL under a 4000-byte
 * ceiling and one snapshot is 3234 bytes of state before the log it comes with. So
 * the dump is an attachment,
 * and it is shaped like a golden trace (src/debug-panel.ts stateDump) so that a
 * reporter's paste can be diffed against a recorded playthrough.
 */
async function copyDetails(): Promise<void> {
  const text = stateDump(liveState(), logLines.lines, [
    `taoot-web ${VERSION}`,
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

installSwipeOptions();
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
  if (!session.viewShowing && session.stageCtrl.keydownTarget()) {
    void session.track(v.keyDown(name, false));
    return;
  }
  void session.track(v.pressNav(name));
}

screen.addEventListener("mousemove", (e) => {
  const v = host.viewer;
  if (!v) return;
  const { x, y } = canvasCoords(e);
  // while dragging, just track the pointer — don't run hover's setcursor
  // scripts concurrently with the suspended drag handler
  if (session.pointerDown) {
    session.setPointer(x, y);
    return;
  }
  void v.hover(x, y).then((name) => {
    screen.style.cursor = name ? (CURSOR_CSS[name] ?? "pointer") : "default";
  });
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
const isSpecialKey = (e: KeyboardEvent): boolean => e.key === "Escape" || e.ctrlKey;

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
const GAMMA_KEYS: Record<string, { up: boolean; ch: GammaChannels } | "reset"> = {
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

window.addEventListener("keydown", (e) => {
  // The gamma keys go FIRST — before the viewer guard below, not after it, which is
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
  // X goes first for the same reason the gamma keys do, and it is a stronger case
  // than theirs: the pane REMEMBERS being open (taoot.details.open), so a reader
  // who left it up gets it back on the loading screen — and behind the viewer
  // guard below, the key that put it there could not take it down again. A pane on
  // screen that its own advertised key does nothing to is worse than no pane. It
  // also has to outrank the overlay branch: a stage that owns every key would
  // otherwise swallow X for as long as the deck map or the intro question is up.
  if (!focusOwnsKey(e.target, e.key) && (e.key === "x" || e.key === "X")) {
    toggleDetails();
    return;
  }
  const v = host.viewer;
  if (!v) return;
  // Typed into something on the page, not at the game (src/keys.ts). This listens
  // on `window`, and the page's own keys are LETTERS — so without this, filtering
  // the state list for "mission" toggled the minimap on the M and the hotspot
  // overlay on the O, and sent all seven letters to the script chain besides.
  if (focusOwnsKey(e.target, e.key)) return;
  // a full-screen overlay stage (the deck map) consumes all keys itself
  if (!session.viewShowing && session.stageCtrl.keydownTarget()) {
    const df = DF_KEY[e.key] ?? (e.key.length === 1 ? e.key.toLowerCase() : "");
    if (df) {
      void session.track(v.keyDown(df, isSpecialKey(e)));
      e.preventDefault();
    }
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
      void session.track(v.keyDown("downarrow"));
      break;
    case " ":
      // SPACE is the door opener (not a general click): BOOTFILE keydown scans
      // the current view's hotspots and fires mousedown only on a painting named
      // "door", "locked" or "knock" — open/close a door, rattle a locked one, or
      // knock. Route it through the script chain like the arrows.
      void session.track(v.keyDown(" "));
      break;
    case "Escape":
      // Forwarded, not acted on: a live movie takes it and aborts (the game's
      // own way past a cutscene), and with no movie up it reaches the script
      // chain as "." and is ignored — which is what the original does too.
      // TI.EXE's other abort key, Ctrl+Q, is left unbound: the movie filter
      // knows it, but it is a browser-level shortcut here.
      void session.track(v.keyDown(".", true));
      break;
    case "m":
    case "M":
      v.showMap = !v.showMap;
      refreshMap();
      break;
    case "o":
    case "O":
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
      void session.track(v.keyDown(ch));
      break;
    }
  }
  e.preventDefault();
});

// ---------------------------------------------------------------------------
// The frame loop
// ---------------------------------------------------------------------------

function loop(now: number): void {
  const viewer = host.viewer;
  if (viewer) {
    viewer.tick(now);
    viewer.render(ctx);
  }
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
