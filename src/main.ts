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
import { GameHost } from "./host";
import { loadTemplates, saveTemplateFor, seedSaves } from "./save-seed";
import { browseForLoad, browseForSave } from "./save-browser";
import { FileStore } from "./files";
import { snapshotState } from "./engine/trace";
import { seededRng } from "./engine/rng";
import { LangChooser, chooserOrder, preselectedEdition } from "./lang-chooser";
import { GOG_URL, NIGHTDIVE_MOVIE, NightdiveIntro, Ownership, introPlaysFor } from "./nightdive";
import { DEFAULT_LANGUAGE, EDITION_STORAGE_KEY, LANG_STAGE, editionName } from "./languages";
import { installLanguageMenu } from "./lang-menu";
import { gamefileManifest, gamefileSizes, installEditionPicker, markEdition } from "./editions";
import { installI18n, t } from "./locales";
import { installBugReport } from "./bug-report";
import { siteUrl, sitePath } from "./site";

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
const help = document.getElementById("help") as HTMLDivElement;
/** which copy of the game is being played, as buttons (src/lang-menu.ts) */
const editionPicker = document.getElementById("editionPicker") as HTMLDivElement;
const fsBtn = document.getElementById("fsBtn") as HTMLButtonElement;
const bugBtn = document.getElementById("bugBtn") as HTMLButtonElement;
/** where the bug button says what became of the screenshot */
const bugNote = document.getElementById("bugNote") as HTMLSpanElement;
/** which way a swipe reads — its own row, hidden unless the pointer is a finger */
const swipeOpts = document.getElementById("swipeOpts") as HTMLDivElement;
const swipeInvertTurnBox = document.getElementById("swipeInvertTurn") as HTMLInputElement;
const swipeInvertWalkBox = document.getElementById("swipeInvertWalk") as HTMLInputElement;
/** where you are and what the engine is doing: the X pane, off by default */
const details = document.getElementById("details") as HTMLDivElement;
const scriptlog = document.getElementById("scriptlog") as HTMLPreElement;
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
fsBtn.addEventListener("click", () => {
  if (document.fullscreenElement) void document.exitFullscreen();
  else void stage.requestFullscreen().catch((e) => log(`fullscreen: ${e.message}`));
});
document.addEventListener("fullscreenchange", () => {
  fsBtn.textContent = document.fullscreenElement ? "⛶ Exit fullscreen" : "⛶ Fullscreen";
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
 * The log is read back off the pane rather than kept in a second array: what the
 * player can open with X and what a report carries are then the same lines, and
 * `showStage` clearing the pane is also what keeps the boot's chatter out of a
 * report about the game.
 */
/** how long the word about the screenshot stands before the bar is a bar again */
const BUG_NOTE_MS = 15_000;

/** which copy of the game is running — settled by initServerBrowser, for reports */
let editionCode = DEFAULT_LANGUAGE;

installBugReport(bugBtn, {
  canvas: screen,
  where: () => hud.textContent ?? "",
  edition: () => `${editionName(editionCode)} (gamefiles/${editionCode}/)`,
  log: (n) =>
    (scriptlog.textContent ?? "")
      .split("\n")
      .filter((l) => l.trim())
      .slice(-n),
  // said in the reader's language, and only here: the issue itself is English,
  // because it is read by whoever fixes it
  note: (how) => {
    bugNote.textContent =
      how === "clipboard" ? t("play.bugShotClipboard") : t("play.bugShotFile");
    window.setTimeout(() => (bugNote.textContent = ""), BUG_NOTE_MS);
  },
});

/**
 * A line into the pane behind X.
 *
 * While the game is up the pane stays shut: `disc 2 mounted` and `left b59:
 * freed 3.2 MB` are the engine talking to itself, and the player did not ask.
 * BEFORE the stage comes up it opens on the first line, because a boot that
 * never finishes has nothing else to say for itself — the rest of the page at
 * that moment is the word "Starting". {@link GameHost} showStage shuts it again.
 */
function log(line: string): void {
  scriptlog.style.display = "block";
  if (stage.style.display === "none") details.hidden = false;
  scriptlog.textContent += line + "\n";
  scriptlog.scrollTop = scriptlog.scrollHeight;
}

/** X: the scene readout and the log, both or neither */
function toggleDetails(): void {
  details.hidden = !details.hidden;
  if (!details.hidden) scriptlog.scrollTop = scriptlog.scrollHeight;
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
    help.style.display = "block";
    // the boot's own chatter has been read by whoever wanted it; the game gets
    // a clean pane, shut until X asks for it
    scriptlog.textContent = "";
    scriptlog.style.display = "none";
    details.hidden = true;
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

// debug handle for the console and browser-automation tests (tests/browser/menu-movie.ts,
// tests/browser/playthrough.ts). snapshotState/seededRng are handed out rather
// than reimplemented page-side so a browser trace and a headless one are
// produced by the same code and can be compared byte for byte.
Object.defineProperty(window, "dbg", {
  get: () => ({ viewer: host.viewer, session, host, snapshotState, seededRng }),
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
async function runNightdiveIntro(): Promise<Ownership> {
  const intro = new NightdiveIntro(session);
  intro.onLog = log;
  // no film served, no intro — a deployment that never ran the generator boots
  // exactly as it did before, with the boot text and its bar still up
  if (!(await intro.open(files))) return "unanswered";
  booting.style.display = "none";
  stage.style.display = "block";

  const onPointer = (e: PointerEvent): void => {
    ensureAudio(); // the first click is also the audio-unlock gesture
    const { x, y } = canvasCoords(e);
    intro.click(x, y);
  };
  // ESC only, and through the movie's own key filter — the marker is what that
  // filter insists on, and the header flag is what decides (MoviePlayer.key)
  const onKey = (e: KeyboardEvent): void => {
    ensureAudio();
    if (e.key === "Escape") intro.key(".", true);
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
  markEdition(editionPicker, code);
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
  const intro: Promise<Ownership> = introPlaysFor(code)
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
  // Which copy of the game is being played — above the stage, never hidden with
  // it: the same row the editors and the collection carry (src/editions.ts).
  void installEditionPicker(editionPicker);
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
/** how far the swipe's axis must beat the other one — a diagonal decides nothing */
const SWIPE_AXIS_RATIO = 1.3;
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
 * Where a swipe points is where you go: leftwards turns left, rightwards turns
 * right, away from you walks on down the corridor. That is the arrow keys' own
 * reading of the two axes, and it is the one the player gets without asking.
 *
 * Both axes can be flipped, and each on its own, because neither direction is
 * self-evident. A turn has a second reading with as much of a claim: the finger
 * takes hold of the scene and pushes it, so a swipe LEFT shoves the view
 * leftwards and brings what was on the right into frame — the panorama
 * convention (Street View, every photo viewer). Which of the two feels right
 * depends on whether the thumb thinks it is moving the camera or the world, and
 * that is a matter of the hand, not of the game. So it is a checkbox
 * ({@link installSwipeOptions}), and so is walking, for the same reason.
 *
 * Only three directions are bound either way. Down stays unbound, which is the
 * keyboard's own asymmetry — ArrowDown is a plain `keyDown("downarrow")`, not a
 * nav press — so inverting the walk axis moves forward onto a downward swipe and
 * leaves upward doing nothing, rather than swapping two bindings.
 */
function swipeArrow(dx: number, dy: number): void {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (swipeInvert.turn) dx = -dx;
  if (swipeInvert.walk) dy = -dy;
  if (ay > ax * SWIPE_AXIS_RATIO) {
    if (dy < 0) pressArrow("uparrow");
    return;
  }
  if (ax > ay * SWIPE_AXIS_RATIO) pressArrow(dx < 0 ? "leftarrow" : "rightarrow");
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
  swipeOpts.hidden = false;
  bindSwipeOption(swipeInvertTurnBox, SWIPE_INVERT_TURN_KEY, (on) => (swipeInvert.turn = on));
  bindSwipeOption(swipeInvertWalkBox, SWIPE_INVERT_WALK_KEY, (on) => (swipeInvert.walk = on));
}

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

installSwipeOptions();

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

window.addEventListener("keydown", (e) => {
  const v = host.viewer;
  if (!v) return;
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
    case "x":
    case "X":
      toggleDetails();
      break;
    default:
      return;
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
