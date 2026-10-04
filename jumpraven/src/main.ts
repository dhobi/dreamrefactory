/**
 * Jump Raven's page: the game machine (`src/game/`) driven at sixty
 * ticks a second, its screen drawn doubled, the mouse and keys handed in.
 *
 * Everything the game does is in the machine, so the page only
 *
 *   - serves the rip: the files the machine asks for, fetched in the
 *     background while it waits (`GameFiles.want`); the opening's are read
 *     before Enter
 *   - runs the clock: a tick per 1/60 s of wall time, at most a few behind
 *   - draws the screen when its version moves, and plays its sounds
 *   - hands in input: a mouse-down or -up in the 512x384 screen's pixels, a key
 *   - puts up the menu bar (src/menu.ts) and the EXE's dialogs (src/dialogs.ts),
 *     and keeps RAVEN.SCO — the keys and the high scores — in the browser
 *   - keeps the saved games (`.RVN`) in the shared saved-games dialog
 *
 * The machine tests (`tests/machine/`) drive the same machine with no page.
 */
import "@dreamfactory/engine/web/window-bar.css";
import { openWindowDialog, windowDialogOpen } from "@dreamfactory/engine/web/window-dialog";
import { focusOwnsKey } from "@dreamfactory/engine/web/keys";
import { $, GESTURE_KEYS, V0Page } from "@dreamfactory/engine/web/v0-page";
import { installBugReport } from "@dreamfactory/site/bug-report";
import { VERSION } from "@dreamfactory/site/version";
import { dayOf, TICKS_PER_SECOND } from "./game/data";
import { JumpRaven } from "./game/game";
import { Input } from "./game/input";
import { askHighScoreName, askQuit, editKeys, pause, soundDialog } from "./dialogs";
import { installMenu } from "./menu";
import { TouchGestures } from "@dreamfactory/engine/web/touch";
import { VIEW } from "./game/flight";
import { inRect } from "./game/screens";
import { browseForLoad, savesOpen } from "@dreamfactory/engine/web/save-browser";
import { useSaveKind } from "@dreamfactory/engine/web/save-store";
import { JUMPRAVEN_SAVES } from "./saves";
import { Player } from "./player";

const RIP = "gamefiles/RAVEN/";
/** what the opening reads before its first briefing, fetched before Enter */
const PRELOAD = ["RAVEN/RAVEN.FON", "RAVEN/RAVEN.SCO", "SHARED/PUPPET", "DAY1/INTRO.MOV", "DAY1/INTRO2.MOV"];
/** a tab left in the background comes back to this many ticks of catching up, not minutes */
const MAX_CATCH_UP = 6;

/**
 * `?autoplay` (or `?autoplay=<seed>`): the page plays the game itself — the
 * machine tests' player (src/player.ts), a tick's worth of hands before each
 * tick, through the same door as the mouse and keys. `&speed=<n>` runs the
 * clock n times as fast (1 to 32). The player wins about one game in four;
 * the seed a machine test won with need not win here, where the files arrive
 * and the sounds end in their own time.
 */
const params = new URLSearchParams(location.search);
const AUTOPLAY = params.has("autoplay");
const AUTO_SEED = Number(params.get("autoplay")) || 0;
const SPEED = AUTOPLAY ? Math.min(32, Math.max(1, Number(params.get("speed")) || 1)) : 1;

/** the log, the disc, the sound and the screen: the shell Lunicus's page shares (engine/src/web/v0-page.ts) */
const page = new V0Page({ name: "Jump Raven", year: 1994, slug: "jumpraven", rip: RIP, version: VERSION });
const { canvas, locEl, complain, say, toggleLog, files, speaker, at } = page;
installBugReport($<HTMLButtonElement>("bugBtn"), page.bugReport);

/* ------------------------------------------------------------------------- *
 * The machine
 * ------------------------------------------------------------------------- */

/** the saved games: the HUD's SAVE writes through the shared dialog, File ▸ Open and Load read through it */
useSaveKind(JUMPRAVEN_SAVES);

const frameEl = $("frame");
const game = new JumpRaven(files, {
  speaker,
  seed: AUTO_SEED || Date.now() & 0xffff,
  log: say,
  sco: page.storedSco(),
  // an autoplay's scores are the player's, not yours: the table is not kept, and it signs its own
  keepSco: AUTOPLAY ? undefined : page.keepSco,
  askName: AUTOPLAY ? (done) => done("Autoplay") : (done) => askHighScoreName(frameEl, done),
  askQuit: (done) => askQuit(frameEl, done),
  pause: (done) => pause(frameEl, done),
  soundDialog: (v, theme, done) => soundDialog(frameEl, v, theme, done),
  keysDialog: (fields, defaults, done) => editKeys(frameEl, fields, defaults, done),
  saver: page.saver,
});
const m = game.m;
const input = new Input(game);
const player = AUTOPLAY ? Object.assign(new Player(game, input), { playsOnce: true }) : null;
function where(): string {
  if (game.phase === "not-ported" || game.phase === "quit") return `${game.stopped}`;
  const t = game.talkState.talk;
  if (t) return t.line ? `briefing: ${t.file} · ${t.line}` : `briefing: ${t.file}`;
  if (m.film) return m.where;
  const f = game.flight;
  if (f) {
    const r = game.records;
    const k = r.tally.kills;
    return `flying, day ${dayOf(game.level)} · ${f.fly ? "FLY" : "HOVER"} (T switches) · ${f.pose.x},${f.pose.y} facing ${"NSEW"[f.pose.dir]} · kills: ${k.jeep} jeeps, ${k.tank} tanks, ${k.bike} bikes, ${k.copter} copters · cash ${r.score} · lives ${r.lives}`;
  }
  if (game.mart) {
    const sel = game.mart.selected;
    const cash = `the Mart · cash ${game.records.score}`;
    return sel ? `${cash} · selected tier ${sel.tier + 1} of kind ${sel.kind}` : cash;
  }
  if (game.phase === "scores") return "the high scores screen — PLAY starts a game";
  return m.where || game.phase;
}

/**
 * File ▸ Open (0x4222fb(2)) and the Load button: the saved-games dialog, then
 * the file's game — on the high scores screen, where the EXE's bar was, or
 * before Enter, as a save the EXE was started with (0x422489)
 */
const openSaved = (): void =>
  void (async () => {
    if (!game.canOpen) return say("File ▸ Open: only on the high scores screen, where the game's menu bar is");
    const bytes = await browseForLoad({ log: (l) => say(`  ${l}`) });
    if (!bytes || !game.canOpen) return;
    game.openGame(bytes);
    await enter();
  })().catch((e) => complain(String(e)));
/** the autoplay's button: a fresh page that plays itself, or back to the one you play */
const autoBtn = $("autoBtn");
if (AUTOPLAY) autoBtn.textContent = "⏹ Stop autoplay";
autoBtn.addEventListener("click", () => {
  const u = new URL(location.href);
  if (AUTOPLAY) ["autoplay", "speed"].forEach((k) => u.searchParams.delete(k));
  else (u.searchParams.set("autoplay", ""), u.searchParams.set("speed", "4"));
  location.href = u.href;
});
const loadBtn = $("loadBtn") as HTMLButtonElement;
loadBtn.addEventListener("click", openSaved);

/** the game window's menu bar, on the frame over the picture (src/menu.ts) */
const menu = installMenu(frameEl, game, input, {
  open: openSaved,
  // 0x422431: MessageBox(“Available Memory: %d”) — what the browser will say of its heap, if anything
  memory: () => {
    const mem = (performance as { memory?: { jsHeapSizeLimit: number; usedJSHeapSize: number } }).memory;
    const text = mem ? `Available Memory: ${mem.jsHeapSizeLimit - mem.usedJSHeapSize}` : "Available Memory: the browser does not say";
    openWindowDialog(frameEl, { title: "Memory", w: 137, h: 50, controls: [
      { id: 103, kind: "static", text, x: 5, y: 8, w: 127, h: 20, center: true },
      { id: 101, kind: "button", text: "OK", x: 45, y: 32, w: 46, h: 11, default: true },
    ] }, { onCommand: (id, d) => id === 101 && d.close() });
  },
  // File ▸ Exit closed the window (0x4222fb(4)); a page leaves for the front door
  exit: () => (location.href = new URL("../", location.href).href),
  live: () => running && !windowDialogOpen() && !savesOpen(),
});

let running = false;
let last = 0;
let owed = 0;
let lastStatus = "";
function frame(now: number): void {
  if (!running) return;
  owed = Math.min(owed + ((now - last) * TICKS_PER_SECOND * SPEED) / 1000, MAX_CATCH_UP * SPEED);
  last = now;
  try {
    for (; owed >= 1; owed--) {
      if (player && !windowDialogOpen() && !savesOpen()) player.step();
      if (!game.tick()) break;
    }
  } catch (e) {
    complain(String(e));
    running = false;
  }
  page.draw(m.screen);
  menu.sync();
  loadBtn.disabled = !game.canOpen;
  const s = where();
  const speed = SPEED > 1 ? ` ×${SPEED}` : "";
  const shown = player ? `autoplay${speed}, seed ${AUTO_SEED || "random"} · ${s}` : s;
  if (shown !== lastStatus) locEl.textContent = lastStatus = shown;
  requestAnimationFrame(frame);
}

/* ------------------------------------------------------------------------- *
 * Input
 * ------------------------------------------------------------------------- */

/**
 * A finger (engine/src/web/touch.ts): a double tap is Esc — on a phone the
 * only way to skip a film, whose taps go to its hotspots — and a swipe an
 * arrow, which flies. In a flight the panels take a press at once; the view
 * waits to see whether the finger swipes, and a tap there fires on lift, a
 * hold fires and aims as a held mouse does.
 */
const touch = new TouchGestures({
  coords: (e) => (running && !windowDialogOpen() && !savesOpen() ? at(e as PointerEvent) : null),
  ownedByGame: (x, y) => game.phase === "flying" && !m.film && !inRect(VIEW, x, y),
  press: (x, y) => input.down(x, y),
  release: (x, y) => input.up(x, y),
  sendKey: (key) => {
    const k = GESTURE_KEYS[key];
    input.keyDown(k);
    input.keyUp(k);
  },
});
canvas.addEventListener("pointerdown", (e) => {
  if (!running || windowDialogOpen() || savesOpen() || player) return;
  if (e.pointerType === "touch") return void touch.down(e);
  const p = at(e);
  input.down(p.x, p.y);
});
addEventListener("pointermove", (e) => {
  const p = at(e);
  input.move(p.x, p.y);
  touch.move(e);
});
addEventListener("pointerup", (e) => {
  if (touch.up(e) || !running) return;
  const p = at(e);
  input.up(p.x, p.y);
});
addEventListener("pointercancel", (e) => touch.cancel(e));
document.addEventListener("keydown", (e) => {
  if (focusOwnsKey(e.target, e.key) || windowDialogOpen() || savesOpen()) return;
  const ctrl = e.ctrlKey || e.metaKey;
  if (e.key === "b" && !ctrl) return toggleLog();
  if (!running || e.repeat || player) return;
  if (input.keyDown(e.key, ctrl)) e.preventDefault();
});
document.addEventListener("keyup", (e) => input.keyUp(e.key));

/* ------------------------------------------------------------------------- *
 * The boot
 * ------------------------------------------------------------------------- */

async function enter(): Promise<void> {
  await page.startSound();
  // a theme asked for before there was sound to play it on (a saved game
  // opened before Enter starts in a flight)
  if (m.ambiencePlaying && !page.looping) m.playAmbience();
  document.body.classList.add("playing");
  if (running) return;
  running = true;
  last = performance.now();
  requestAnimationFrame(frame);
}

$("start").addEventListener("click", () => void enter().catch((e) => complain(String(e))));
try {
  await page.boot({ preload: PRELOAD, ready: "ready — Enter plays the intro; Esc skips a film or ends a briefing" });
} catch (e) {
  complain(String(e));
}
