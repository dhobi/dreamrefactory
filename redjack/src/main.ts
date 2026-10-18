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
import { compileScript } from "@dreamfactory/engine/df/script-asm";
import { CursorSheet, ShownCursor } from "@dreamfactory/engine/web/cursors";
import { installFullscreen } from "@dreamfactory/engine/web/fullscreen";
import {
  GestureAudio,
  PageLog,
  busySpinner,
  screenPlate,
  showVersion,
  waitForStart,
} from "@dreamfactory/engine/web/page-shell";
import { installStretch } from "@dreamfactory/engine/web/stretch";
import { GameHost } from "@dreamfactory/engine/web/host";
import { SPACE_KEY, focusOwnsKey } from "@dreamfactory/engine/web/keys";
import { bindPointerInput } from "@dreamfactory/engine/web/shell-input";
import { installBugReport } from "@dreamfactory/chrome/bug-report";
import { REDJACK } from "@dreamfactory/chrome/games";
import { VERSION } from "@dreamfactory/chrome/version";
import { fmtSize } from "@dreamfactory/chrome/net-meter";
import { RedJackFiles } from "./files";
import { REDJACK_SAVES, keepDf5Disk, seedRedJackSaves } from "./saves";
import { browseForLoad, browseForSave, savesOpen } from "@dreamfactory/engine/web/save-browser";
import { useSaveKind } from "@dreamfactory/engine/web/save-store";
import { RJ_CURSORS } from "./cursor-art";
import { bindRoomTouch } from "./room-touch";
import { SWIPE_ARROWS, arrowUp, defaultSaveName, heldKeys, keyAction, whereLine } from "./input";
import { canvasCoordsFor } from "@dreamfactory/engine/web/screen";

const SCREEN = REDJACK.screen;

const canvas = document.getElementById("screen") as HTMLCanvasElement;
/**
 * The picture is composed at 640x480 and blitted up into a 1280x960 canvas, so
 * the page only ever SHRINKS it — see `screenPlate` (engine/src/web/page-shell.ts).
 */
const { ctx, plate, plateCtx } = screenPlate(canvas, SCREEN);

const logEl = document.getElementById("log") as HTMLPreElement;
const locEl = document.getElementById("loc") as HTMLElement;
const errEl = document.getElementById("err") as HTMLElement;
const stageEl = document.getElementById("stage") as HTMLElement;
showVersion(VERSION);

/** the title card, which closes the band up when it fails to load — see #brand in index.html */
const brandEl = document.getElementById("brand") as HTMLImageElement;
function dropBrand(): void {
  brandEl.hidden = true;
  document.body.classList.add("nobrand");
}
// a module runs after parsing, so the image may already have failed by now
if (brandEl.complete && brandEl.naturalWidth === 0) dropBrand();
else brandEl.addEventListener("error", dropBrand);

/* ------------------------------------------------------------------------- *
 * The log
 * ------------------------------------------------------------------------- */

/** one line of the log: `step` is something the boot did, `warn` a complaint */
const log = new PageLog(logEl, document.getElementById("logBtn"));
const { say, show: showLog, lines: logLines } = log;

/* ------------------------------------------------------------------------- *
 * The shared controls
 * ------------------------------------------------------------------------- */

/**
 * Audio waits for a gesture — the Enter button. Deferred rather than absent, so
 * whatever the boot starts before then is held and started when the sink comes.
 */
const { sink: audio, ensure: ensureAudio } = new GestureAudio(say);

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
const barEl = document.getElementById("barvalue") as HTMLProgressElement;
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
  barEl.value = pct;
  if (label) bootSayEl.textContent = label;
}

function beginPlaying(): void {
  document.body.classList.remove("booting");
  document.body.classList.add("playing");
}

/**
 * The pointer, by the name the game gives it: RedJack.exe's own `CURS.*`
 * cursors (./cursor-art.ts, read out by tools/dumpcursors.ts), drawn at the
 * scale the 640-wide screen is being shown at, as Timelapse's page does.
 * `none` is by name, and a name the build has no cursor for is the browser's
 * arrow.
 */
const cursor = new ShownCursor(canvas, new CursorSheet(RJ_CURSORS), SCREEN);
const showCursor = cursor.show;

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
  files.onBusyChange = busySpinner(document.getElementById("netbusy") as HTMLDivElement);

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
  // the discs as folders for the file commands, and what the scripts wrote to
  // the hard disk on an earlier visit
  host.session.df5Disk.setTree(files.tree);
  await keepDf5Disk(host.session.df5Disk);
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
    if (host.session.cursorHidden) showCursor("none");
    else showCursor(host.session.puppet?.visible ? "arrow" : host.session.cursorName);
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
  await waitForStart(bootEl, startEl);
  ensureAudio();
  beginPlaying();

  if (!(await log.coldBoot(host, errEl))) showLog(true);
  log.bootSummary(host, files, `set ${s.currentSetName || "none"} · `);
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

const canvasCoords = canvasCoordsFor(canvas, SCREEN);

function bindInput(host: GameHost, s: GameHost["session"]): void {
  const input = bindPointerInput(host, canvas, {
    coords: canvasCoords,
    swipeKey: "redjack.swipe",
    // `sysparam (7)`: a room's mousedown zooms while the right button is held
    click: (x, y, e) => void host.director.buttonDown(x, y, { button: e.button === 2 ? 2 : 1 }).then(() => say(`click ${x},${y}`)),
    gestureKey: (key) => SWIPE_ARROWS[key] ?? key,
    // a finger in a room: look round, flick, zoom (src/room-touch.ts)
    front: (touch) => bindRoomTouch({ host, touch, coords: canvasCoords, screen: SCREEN }),
  });
  const { sendKey } = input;
  // the right button is the game's, not the browser's menu
  canvas.addEventListener("contextmenu", (e) => e.preventDefault());

  /**
   * Where the pointer is once nothing points. RedJack.exe asks Windows where
   * the cursor is each time a script reads it (`mouse ()`, 0x419600 ->
   * GetCursorPos and ScreenToClient, 0x489fdf, 0x48a005), so a mouse taken off
   * the window reads outside it, and the BOOTFILE's `scrollmargin` answers
   * false there (`pointx (arg) < 0`). A finger that has lifted is that pointer:
   * left where it lifted, a tap near an edge kept the view scrolling for ever.
   * The original had no touch; this is the port's answer for it. A mouse that
   * leaves the page is the same case, and is told the same — inside the page
   * the window's own `pointermove` keeps reporting it, off the canvas as on it.
   */
  const fingers = new Set<number>();
  const offWindow = (): void => s.setPointer(-1, -1);
  canvas.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "touch") fingers.add(e.pointerId);
  });
  // ...once the tap it made has been answered: its `mousedown` reads the
  // pointer where the finger was, as a click's reads where the mouse is
  const fingerLifted = (e: PointerEvent): void => {
    if (e.pointerType !== "touch" || !fingers.delete(e.pointerId)) return;
    const { pointerX: x, pointerY: y } = s;
    const gone = (): void => {
      const still = s.pointerX === x && s.pointerY === y;
      if (!fingers.size && !s.pointerDown && still) offWindow();
    };
    void input.lastPress().then(gone, gone);
  };
  document.addEventListener("pointerout", (e) => {
    if (e.pointerType === "mouse" && !e.relatedTarget && !s.pointerDown) offWindow();
  });

  // after the binder's own release and cancel, which were bound first
  addEventListener("pointerup", fingerLifted);
  addEventListener("pointercancel", fingerLifted);

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
    for (const vk of heldKeys(e.code)) s.keysDown.delete(vk);
    // the arrows come up too: the fight lessons lean on the key held, and stop on its release
    const arrow = arrowUp(e);
    if (arrow) void host.director.keyUp(arrow);
  });
  addEventListener("blur", () => {
    s.spaceDown = false;
    s.keysDown.clear();
  });

  addEventListener("keydown", (e) => {
    // `key (name)` asks whether a key is held, wherever the focus is, as
    // GetAsyncKeyState does
    for (const vk of heldKeys(e.code)) s.keysDown.add(vk);
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
  log.fail(e, errEl);
  beginPlaying();
});
