/**
 * RedJack, in a browser.
 *
 * *RedJack: Revenge of the Brethren* (1998) is CyberFlix's last game and the only
 * one on DreamFactory 5. This page is the real {@link GameHost} and the real
 * `GameSession`, pointed at the three discs, with the shared controls around it —
 * fullscreen, the bug report, the log, the keys, and the touch gestures.
 *
 * DreamFactory 5 is the v4 engine grown a real camera, and what it changed is
 * read where it is used: the rooms — nodes you look round from, films between
 * them — in engine/src/df/sett.ts and engine/src/runtime/maze.ts, drawn by
 * engine/src/web/maze-view.ts; the pictures in engine/src/df/image-v5.ts; the new
 * script ids in engine/src/df/opcodes.ts (`DF5_OPCODES`), and the commands behind
 * them in engine/src/runtime/builtins/maze.ts and df5.ts. RedJack.exe is where each
 * was settled — `redjack/tools/rjdis.mts` disassembles it.
 *
 * What is this page's own is the input: the arrows by v5's key names, the space
 * bar held as well as pressed, and a finger in a room ({@link bindRoomTouch}) —
 * drag to look round, flick to walk, two fingers to zoom.
 *
 * The screen is 640x480: the BOOTFILE's container 0 says so, and its
 * `billsdoublebuffer` asks the machine for nothing else.
 */
import { detectVersion } from "@dreamfactory/engine/df/version";
import { DeferredAudioSink, WebAudioSink } from "@dreamfactory/engine/runtime/audio";
import { compileScript } from "@dreamfactory/engine/df/script-asm";
import { CursorSheet } from "@dreamfactory/engine/web/cursors";
import { installFullscreen } from "@dreamfactory/engine/web/fullscreen";
import { installStretch } from "@dreamfactory/engine/web/stretch";
import { GameHost } from "@dreamfactory/engine/web/host";
import { SPACE_KEY, focusOwnsKey } from "@dreamfactory/engine/web/keys";
import { GestureKey, PointerEventLike, TouchGestures, bindSwipeInvert } from "@dreamfactory/engine/web/touch";
import { installBugReport } from "@dreamfactory/site/bug-report";
import { REDJACK } from "@dreamfactory/site/games";
import { VERSION } from "@dreamfactory/site/version";
import { RedJackFiles } from "./files";
import { REDJACK_SAVES, seedRedJackSaves } from "./saves";
import { browseForLoad, browseForSave, savesOpen } from "@dreamfactory/engine/web/save-browser";
import { useSaveKind } from "@dreamfactory/engine/web/save-store";
import { RJ_CURSORS } from "./cursor-art";
import { bindRoomTouch } from "./room-touch";
import { SWIPE_ARROWS, arrowUp, defaultSaveName, keyAction, screenPoint, whereLine } from "./input";

const SCREEN = REDJACK.screen;

const canvas = document.getElementById("screen") as HTMLCanvasElement;
const ctx = canvas.getContext("2d", { alpha: false })!;
/**
 * The picture is composed at 640x480 and blitted up into a 1280x960 canvas, so
 * the page only ever SHRINKS it — see the same plate in timelapse/src/main.ts.
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

/* ------------------------------------------------------------------------- *
 * The log
 * ------------------------------------------------------------------------- */

const LOG_MAX = 600;
const logLines: string[] = [];
/** one line of the log: `step` is something the boot did, `warn` a complaint */
function say(line: string, kind: "" | "step" | "warn" = ""): void {
  logLines.push(line);
  if (logLines.length > LOG_MAX) logLines.splice(0, logLines.length - LOG_MAX);
  const tag = kind === "step" ? "b" : kind === "warn" ? "i" : "";
  logEl.insertAdjacentHTML("beforeend", tag ? `<${tag}>${esc(line)}</${tag}>\n` : `${esc(line)}\n`);
  if (!logEl.hidden) logEl.scrollTop = logEl.scrollHeight;
}

function showLog(open: boolean): void {
  logEl.hidden = !open;
  if (open) logEl.scrollTop = logEl.scrollHeight;
}
document.getElementById("logBtn")?.addEventListener("click", () => showLog(logEl.hidden));

/* ------------------------------------------------------------------------- *
 * The shared controls
 * ------------------------------------------------------------------------- */

/**
 * Audio waits for a gesture — the Enter button. Deferred rather than absent, so
 * whatever the boot starts before then is held and started when the sink comes.
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
    /* no audio in this browser */
  }
}

// the STAGE, not the canvas: see #stage.fs in src/theme.css
installFullscreen(document.getElementById("fsBtn") as HTMLButtonElement | null, stageEl, { report: say, landscape: true });
// and whether that picture keeps its 4:3 there (engine/src/web/stretch.ts)
installStretch(document.getElementById("stretchBox") as HTMLInputElement | null, stageEl, "redjack.picture.stretch");

/** where the player is, for a bug report: the readout's own line */
let currentWhere = "";
const BUG_NOTE_MS = 6000;
const bugBtn = document.getElementById("bugBtn") as HTMLButtonElement | null;
const bugNote = document.getElementById("bugNote");
if (bugBtn) {
  installBugReport(bugBtn, {
    game: REDJACK.short,
    canvas,
    shotName: "redjack-bug.png",
    version: VERSION,
    where: () => currentWhere,
    edition: () => "RedJack 3CD (gamefiles/RJDisk1-3/)",
    log: (n) => logLines.slice(-n),
    note: (how) => {
      if (!bugNote) return;
      bugNote.textContent =
        how === "clipboard"
          ? "screen copied — paste it into the issue"
          : "screen saved — attach redjack-bug.png to the issue";
      window.setTimeout(() => (bugNote.textContent = ""), BUG_NOTE_MS);
    },
  });
}

/* ------------------------------------------------------------------------- *
 * The loading bar
 * ------------------------------------------------------------------------- */

const bootEl = document.getElementById("boot") as HTMLElement;
const startEl = document.getElementById("start") as HTMLButtonElement;
const barEl = document.getElementById("bar") as HTMLElement;
const chargeEl = document.getElementById("charge") as HTMLElement;
const bootSayEl = document.getElementById("bootsay") as HTMLElement;
const bootPctEl = document.getElementById("bootpct") as HTMLElement;

/** where the bar stands once the index has arrived, and once the BOOTFILE has */
const INDEXED = 0.04;
const PLANNED = 0.08;
/** and where the prefetch leaves it: the last few per cent are the boot's own */
const FETCHED = 0.96;

/** the bar only ever goes forwards */
let charged = 0;
function progress(f: number, label?: string): void {
  charged = Math.max(charged, Math.min(1, f));
  const pct = Math.round(charged * 100);
  chargeEl.style.width = `${pct}%`;
  bootPctEl.textContent = `${pct}%`;
  barEl.setAttribute("aria-valuenow", String(pct));
  if (label) bootSayEl.textContent = label;
}

/** "13.1 MB" or "412 KB" */
const fmtSize = (bytes: number): string =>
  bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

/** the disc is read; wait to be told to go (a keyboard gesture as much as a click) */
async function waitForStart(): Promise<void> {
  bootEl.classList.add("ready");
  startEl.focus();
  await new Promise<void>((resolve) => startEl.addEventListener("click", () => resolve(), { once: true }));
}

function beginPlaying(): void {
  document.body.classList.remove("booting");
  document.body.classList.add("playing");
  // the frame is `display: none` under the curtain, so a cursor sized while
  // booting was sized for a 0x0 picture; size it again now there is one
  showCursor(cursorShown, true);
}

/** the spinner in the corner of the picture, once a wait is long enough to be one */
const BUSY_AFTER_MS = 400;
function watchNetwork(files: RedJackFiles): void {
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

/**
 * The pointer, by the name the game gives it: RedJack.exe's own `CURS.*`
 * cursors (./cursor-art.ts, read out by tools/dumpcursors.ts), drawn at the
 * scale the 640-wide screen is being shown at, as Timelapse's page does.
 * `none` is by name, and a name the build has no cursor for is the browser's
 * arrow.
 */
const cursors = new CursorSheet(RJ_CURSORS);
let cursorShown = "";
function showCursor(name: string, force = false): void {
  if (name === cursorShown && !force) return;
  cursorShown = name;
  const rect = canvas.getBoundingClientRect();
  canvas.style.cursor = cursors.css(name || "arrow", rect.width / SCREEN.width, rect.height / SCREEN.height);
}
addEventListener("resize", () => showCursor(cursorShown, true));

/* ------------------------------------------------------------------------- *
 * The boot
 * ------------------------------------------------------------------------- */

async function main(): Promise<void> {
  say(`RedJack RE ${VERSION} — the 1998 discs on this port (prototype)`, "step");

  const files = await RedJackFiles.open();
  if (!files.size) {
    say("the manifest indexed nothing: is redjack/gamefiles/ there?", "warn");
    errEl.textContent = "no game data — press b for the log";
    progress(1, "no disc");
    showLog(true);
    return;
  }
  progress(INDEXED, `indexed ${files.size} names across three discs`);
  say(`indexed ${files.size} names across the rip`);
  watchNetwork(files);

  const host = new GameHost(
    files,
    audio,
    {
      log: (l) => say(`  ${l}`),
      hud: (t) => t && say(`  hud: ${t}`),
    },
    { screen: SCREEN },
  );
  // a real frame source before the boot runs, so a modal film and the game's own
  // poll loops advance (see timelapse/src/main.ts)
  host.session.nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));
  host.session.hasRealFrames = true;

  // Saved games: the control panel's SAVE and LOAD run `savegame ("2")` and
  // `opengame ("2")`, which block on these hooks, and the shared dialog answers
  // them (engine/src/web/save-browser.ts). Wired before the boot, since the
  // boot is a script and a script may save.
  useSaveKind(REDJACK_SAVES);
  host.session.onSaveGame = async (bytes) => {
    await browseForSave(bytes as Uint8Array, defaultSaveName(host.session.currentSetFile, new Date()), { log: (l) => say(`  ${l}`) });
  };
  host.session.onLoadGame = () => browseForLoad({ log: (l) => say(`  ${l}`) });
  void seedRedJackSaves((name) => files.serverUrl(name)).then((n) => {
    if (n) say(`listed ${n} of the port's day saves in the saved games`);
  });

  progress(PLANNED, "reading the BOOTFILE");
  const boot = await files.load("bootfile");
  if (!boot) {
    say("no BOOTFILE: is RJDisk1/RedJack/bootfile.boot under redjack/gamefiles/?", "warn");
    errEl.textContent = "no game data — press b for the log";
    progress(1, "no disc");
    showLog(true);
    return;
  }
  say(`BOOTFILE: DreamFactory ${detectVersion(boot) || "?"} (${fmtSize(boot.byteLength)})`, "step");

  const plan = await host.bootPlan();
  const named = plan.resources.filter((n) => files.serverUrl(n));
  const notFiles = plan.resources.filter((n) => !files.serverUrl(n));
  say(
    `boot plan: ${named.length} resource(s) (${named.join(", ") || "none"})` +
      (notFiles.length ? ` + ${notFiles.length} name(s) not on the discs: ${notFiles.join(", ")}` : "") +
      `, ${plan.casts.length} cast(s), first room ${plan.landingSet ?? "(none named)"}`,
    "step",
  );

  // the plan's files, weighed in bytes; the first room too, since the boot's
  // day machine goes there next
  const prefetch = [...new Set([...named, ...(plan.landingSet && files.serverUrl(plan.landingSet) ? [plan.landingSet] : [])])];
  const total = prefetch.reduce((a, n) => a + files.sizeOf(n), 0);
  say(`prefetching ${prefetch.length} file(s), ${fmtSize(total)}`, "step");
  let arrived = 0;
  await Promise.all(
    prefetch.map(async (name) => {
      progress(charged, `opening ${name}`);
      await files.load(name, (n) => {
        arrived += n;
        progress(PLANNED + (FETCHED - PLANNED) * (arrived / Math.max(1, arrived + files.bytesLeft(prefetch))));
      });
    }),
  );
  say("version tags:", "step");
  for (const name of prefetch) {
    const bytes = await files.load(name);
    say(bytes ? `  ${name}: DreamFactory ${detectVersion(bytes) || "?"} (${fmtSize(bytes.byteLength)})` : `  ${name}: missing`);
  }

  /** the engine's own frame loop, on the engine's own screen, blitted up */
  const loop = (now: number): void => {
    host.director.tick(now);
    host.director.render(plateCtx);
    ctx.drawImage(plate, 0, 0, canvas.width, canvas.height);
    showLocation(host);
    // a conversation keeps the arrow however a script inside it changes the
    // cursor: RedJack.exe's puppet code sets `CURS.ARROW` as it runs (#446)
    showCursor(host.session.cursorHidden ? "none" : host.session.puppet?.visible ? "arrow" : host.session.cursorName);
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);

  const s = host.session;
  /**
   * A handle on the running game, for the console — `rj.eval('return (currentset())')`.
   * This page is a prototype and meant to be poked at.
   */
  (window as Window & { rj?: unknown }).rj = {
    host,
    session: s,
    files,
    director: host.director,
    /** one line of script, compiled and run */
    eval: async (src: string) => {
      const inst = s.instanceFrom(compileScript(`code consoleeval ()\n\t${src}\nendcode\n`), "consoleeval");
      return inst ? (await s.interp.runHandler(inst, "consoleeval", [], { me: "consoleeval", target: "" })).value : null;
    },
  };

  // the input BEFORE the boot, so a modal film at the start can be skipped
  bindInput(host, s);

  progress(1, "ready");
  await waitForStart();
  ensureAudio();
  beginPlaying();

  say("coldBoot()…", "step");
  const started = performance.now();
  try {
    await host.coldBoot();
    say(`boot returned after ${Math.round(performance.now() - started)} ms`, "step");
  } catch (e) {
    say(`!! coldBoot threw: ${(e as Error).message}`, "warn");
    errEl.textContent = `boot failed: ${(e as Error).message} — press b for the log`;
    showLog(true);
  }

  say(
    `set ${s.currentSetName || "none"} · stage ${s.stageName} · flat ${s.currentFlat} · ` +
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

/** the readout under the picture, refreshed only when it changes */
let lastLoc = "";
function showLocation(host: GameHost): void {
  const where = whereLine(host.session);
  if (where === lastLoc) return;
  lastLoc = where;
  currentWhere = where;
  locEl.textContent = where;
}

/* ------------------------------------------------------------------------- *
 * Input
 * ------------------------------------------------------------------------- */

function canvasCoords(e: { clientX: number; clientY: number }): { x: number; y: number } {
  return screenPoint(e, canvas.getBoundingClientRect(), SCREEN);
}


function bindInput(host: GameHost, s: GameHost["session"]): void {
  const sendKey = (key: string, special = false): void => {
    s.interp.globals.set("isrepeat", 0);
    void host.director.keyDown(key, special);
  };

  // which way the two swipe axes read, remembered for this game alone
  const swipeInvert = bindSwipeInvert({
    storageKey: "redjack.swipe",
    turnBox: document.getElementById("swipeInvertTurn") as HTMLInputElement | null,
    walkBox: document.getElementById("swipeInvertWalk") as HTMLInputElement | null,
    reveal: document.getElementById("swipeOpts"),
  });

  const touch = new TouchGestures({
    coords: (e: PointerEventLike) => canvasCoords(e),
    ownedByGame: (x, y) => {
      const kind = s.hitTestAt(x, y).type;
      return kind === "prop" || kind === "button";
    },
    press: (x, y) => {
      if (room.swallowsPress(x, y)) return;
      s.pointerDown = true;
      s.pointerButton = 1;
      void s.track(host.director.press(x, y), `press ${x},${y}`);
    },
    release: (x, y) => {
      if (!s.pointerDown) return;
      s.pointerDown = false;
      host.director.release(x, y);
    },
    sendKey: (key: GestureKey, special: boolean) => sendKey(SWIPE_ARROWS[key] ?? key, special),
    invert: () => swipeInvert,
  });

  // a finger in a room: look round, flick, zoom (src/room-touch.ts)
  const room = bindRoomTouch({ host, touch, coords: canvasCoords, screen: SCREEN });

  canvas.addEventListener("pointerdown", (e) => {
    const { x, y } = canvasCoords(e);
    s.setPointer(x, y);
    if (e.pointerType === "touch") {
      if (!room.down(e)) touch.down(e);
      room.afterDown(e);
      return;
    }
    s.pointerDown = true;
    // `sysparam (7)`: a room's mousedown zooms while the right button is held
    s.pointerButton = e.button === 2 ? 2 : 1;
    void host.director.press(x, y).then(() => say(`click ${x},${y}`));
  });
  // the right button is the game's, not the browser's menu
  canvas.addEventListener("contextmenu", (e) => e.preventDefault());

  // on the window, not the canvas: a drag that ends off-canvas still has to end
  addEventListener("pointermove", (e) => {
    const { x, y } = canvasCoords(e);
    s.setPointer(x, y);
    if (room.move(e)) return;
    if (touch.owns(e)) {
      touch.move(e);
      return;
    }
    if (e.pointerType !== "touch") void host.director.hover(x, y);
  });

  addEventListener("pointerup", (e) => {
    if (room.up(e)) return;
    if (touch.up(e)) return;
    if (!s.pointerDown) return;
    s.pointerDown = false;
    const { x, y } = canvasCoords(e);
    host.director.release(x, y);
  });

  addEventListener("pointercancel", (e) => {
    if (!room.cancel(e)) touch.cancel(e);
  });

  // SPACE, for a machine with no space bar: RedJack's control panel. It is held
  // a moment too, for the scripts that ask whether it is down rather than
  // waiting to hear it — a chest plays its opening `while not spacebar ()`
  let spaceUp = 0;
  document.getElementById("spacekey")?.addEventListener("click", () => {
    s.spaceDown = true;
    clearTimeout(spaceUp);
    spaceUp = window.setTimeout(() => (s.spaceDown = false), 300);
    sendKey(SPACE_KEY);
  });

  // `spacebar ()` is the key as it is now, so it is kept here as it goes down and up
  addEventListener("keyup", (e) => {
    if (e.key === " ") s.spaceDown = false;
    // the arrows come up too: the fight lessons lean on the key held, and stop on its release
    const arrow = arrowUp(e);
    if (arrow) void host.director.keyUp(arrow);
  });
  addEventListener("blur", () => (s.spaceDown = false));

  addEventListener("keydown", (e) => {
    // the saved-games dialog holds the keys while it is up, as the original's did
    if (savesOpen()) return;
    if (e.key === " " && !focusOwnsKey(e.target, e.key)) s.spaceDown = true;
    // which key is whose: src/input.ts
    const act = keyAction(e);
    if (!act) return;
    e.preventDefault();
    if ("log" in act) showLog(logEl.hidden);
    else sendKey(act.key, act.special);
  });
}

void main().catch((e) => {
  say(`!! ${(e as Error).stack ?? e}`, "warn");
  errEl.textContent = `${(e as Error).message ?? e} — press b for the log`;
  showLog(true);
  beginPlaying();
});
