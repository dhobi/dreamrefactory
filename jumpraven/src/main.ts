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
import { installFullscreen } from "@dreamfactory/engine/web/fullscreen";
import { openWindowDialog, windowDialogOpen } from "@dreamfactory/engine/web/window-dialog";
import { focusOwnsKey } from "@dreamfactory/engine/web/keys";
import { installBugReport } from "@dreamfactory/site/bug-report";
import { VERSION } from "@dreamfactory/site/version";
import { SCREEN_H, SCREEN_W, TICKS_PER_SECOND } from "./game/data";
import { JumpRaven } from "./game/game";
import { Input } from "./game/input";
import type { GameFiles, Speaker } from "./game/machine";
import { askHighScoreName, askQuit, editKeys, pause, soundDialog } from "./dialogs";
import { installMenu } from "./menu";
import { TouchGestures, type GestureKey } from "@dreamfactory/engine/web/touch";
import { VIEW } from "./game/flight";
import { inRect } from "./game/screens";
import { browseForLoad, browseForSave, savesOpen } from "@dreamfactory/engine/web/save-browser";
import { useSaveKind } from "@dreamfactory/engine/web/save-store";
import { JUMPRAVEN_SAVES } from "./saves";
import { Player } from "./player";

const SCALE = 2;
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

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>("screen");
const ctx = canvas.getContext("2d")!;
ctx.imageSmoothingEnabled = false;
const stageEl = $<HTMLDivElement>("stage");
const logEl = $<HTMLPreElement>("log");
const locEl = $<HTMLPreElement>("loc");
const errEl = $<HTMLSpanElement>("err");

$("ver").textContent = `v${VERSION}`;

const esc = (s: string): string => s.replace(/[&<>]/g, (c) => `&${{ "&": "amp", "<": "lt", ">": "gt" }[c]};`);

/* ------------------------------------------------------------------------- *
 * The log
 * ------------------------------------------------------------------------- */

const logLines: string[] = [];
const step = (line: string): void => {
  logLines.push(line);
  logEl.innerHTML += `<b>${esc(line)}</b>\n`;
};
const complain = (line: string): void => {
  logLines.push(line);
  logEl.innerHTML += `<i>${esc(line)}</i>\n`;
  errEl.textContent = line;
  logEl.hidden = false;
};
const say = (line: string): void => {
  logLines.push(line);
  logEl.innerHTML += `${esc(line)}\n`;
  logEl.scrollTop = logEl.scrollHeight;
};
const toggleLog = (): void => void (logEl.hidden = !logEl.hidden);
$("logBtn").addEventListener("click", toggleLog);

installFullscreen($<HTMLButtonElement>("fsBtn"), stageEl, { report: say, landscape: true });

const BUG_NOTE_MS = 6000;
const bugNote = $("bugNote");
installBugReport($<HTMLButtonElement>("bugBtn"), {
  game: "Jump Raven",
  canvas,
  shotName: "jumpraven-bug.png",
  version: VERSION,
  where: () => locEl.textContent ?? "",
  edition: () => "Jump Raven CD (gamefiles/RAVEN/)",
  log: (n) => logLines.slice(-n),
  note: (how) => {
    bugNote.textContent =
      how === "clipboard" ? "the screen is on the clipboard — paste it into the issue" : "the screen was downloaded — attach it to the issue";
    setTimeout(() => (bugNote.textContent = ""), BUG_NOTE_MS);
  },
});

/* ------------------------------------------------------------------------- *
 * The disc
 * ------------------------------------------------------------------------- */

const url = (path: string): string => new URL(path, document.baseURI).href;
let sizes: Record<string, number> = {};
const bytes = new Map<string, Uint8Array>();
const fetching = new Map<string, Promise<Uint8Array>>();

function fetchBytes(path: string, onProgress?: (got: number) => void): Promise<Uint8Array> {
  let p = fetching.get(path);
  if (!p) {
    p = (async () => {
      const res = await fetch(url(RIP + path));
      if (!res.ok || !res.body) throw new Error(`${path}: ${res.status}`);
      const reader = res.body.getReader();
      const parts: Uint8Array[] = [];
      let got = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        parts.push(value);
        got += value.length;
        onProgress?.(got);
      }
      const out = new Uint8Array(got);
      let at = 0;
      for (const part of parts) (out.set(part, at), (at += part.length));
      bytes.set(path, out);
      return out;
    })();
    p.catch((e) => complain(String(e)));
    fetching.set(path, p);
  }
  return p;
}

const files: GameFiles = {
  has: (p) => RIP + p in sizes,
  get: (p) => bytes.get(p) ?? null,
  want: (p) => {
    if (!fetching.has(p)) say(`reading ${p} (${(sizes[RIP + p] / 1e6).toFixed(1)} MB)…`);
    void fetchBytes(p);
  },
};

/* ------------------------------------------------------------------------- *
 * Sound
 * ------------------------------------------------------------------------- */

let audio: AudioContext | null = null;
/** Sound ▸ Sound Off … Level 7: the device's volume, which every sound goes through */
let master: GainNode | null = null;
let volume = 1;
const out = (): AudioNode => {
  if (!master) {
    master = audio!.createGain();
    master.gain.value = volume;
    master.connect(audio!.destination);
  }
  return master;
};
const playing = new Set<AudioBufferSourceNode>();
/** the theme's channel: one source, looping */
let theme: AudioBufferSourceNode | null = null;
const speaker: Speaker = {
  play(samples, rate) {
    if (!audio) return;
    const buf = audio.createBuffer(1, samples.length, rate);
    buf.getChannelData(0).set(samples);
    const src = audio.createBufferSource();
    src.buffer = buf;
    src.connect(out());
    src.onended = () => playing.delete(src);
    playing.add(src);
    src.start();
  },
  stop() {
    for (const s of playing) s.stop();
    playing.clear();
  },
  // channel 3: the band's theme tune in a flight, round and round
  loop(samples, rate) {
    theme?.stop();
    theme = null;
    if (!audio || !samples) return;
    const buf = audio.createBuffer(1, samples.length, rate);
    buf.getChannelData(0).set(samples);
    theme = audio.createBufferSource();
    theme.buffer = buf;
    theme.loop = true;
    theme.connect(out());
    theme.start();
  },
  volume(level) {
    volume = level;
    if (master) master.gain.value = level;
  },
};

/* ------------------------------------------------------------------------- *
 * The machine
 * ------------------------------------------------------------------------- */

const SCO_KEY = "jumpraven.sco";
function storedSco(): Uint8Array | undefined {
  try {
    const b64 = localStorage.getItem(SCO_KEY);
    return b64 ? Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)) : undefined;
  } catch {
    return undefined;
  }
}
function keepSco(bytes: Uint8Array): void {
  try {
    localStorage.setItem(SCO_KEY, btoa(String.fromCharCode(...bytes)));
  } catch (e) {
    complain(`the high scores and keys could not be kept: ${String(e)}`);
  }
}

/** the saved games: the HUD's SAVE writes through the shared dialog, File ▸ Open and Load read through it */
useSaveKind(JUMPRAVEN_SAVES);
const saver = (bytes: Uint8Array, name: string, done: () => void): void => {
  browseForSave(bytes, name, { log: (l) => say(`  ${l}`) }).then(done, (e) => (complain(String(e)), done()));
};

const frameEl = $("frame");
const game = new JumpRaven(files, {
  speaker,
  seed: AUTO_SEED || Date.now() & 0xffff,
  log: say,
  sco: storedSco(),
  // an autoplay's scores are the player's, not yours: the table is not kept, and it signs its own
  keepSco: AUTOPLAY ? undefined : keepSco,
  askName: AUTOPLAY ? (done) => done("Autoplay") : (done) => askHighScoreName(frameEl, done),
  askQuit: (done) => askQuit(frameEl, done),
  pause: (done) => pause(frameEl, done),
  soundDialog: (v, theme, done) => soundDialog(frameEl, v, theme, done),
  keysDialog: (fields, defaults, done) => editKeys(frameEl, fields, defaults, done),
  saver,
});
const m = game.m;
const input = new Input(game);
const player = AUTOPLAY ? Object.assign(new Player(game, input), { playsOnce: true }) : null;
const image = ctx.createImageData(SCREEN_W, SCREEN_H);
const off = new OffscreenCanvas(SCREEN_W, SCREEN_H);
const offCtx = off.getContext("2d")!;
let drawn = -1;

function draw(): void {
  if (m.screen.version === drawn) return;
  drawn = m.screen.version;
  m.screen.rgba(image.data);
  offCtx.putImageData(image, 0, 0);
  ctx.drawImage(off, 0, 0, SCREEN_W * SCALE, SCREEN_H * SCALE);
}

function where(): string {
  if (game.phase === "not-ported" || game.phase === "quit") return `${game.stopped}`;
  const t = game.talkState.talk;
  if (t) return `briefing: ${t.file}${t.line ? ` · ${t.line}` : ""}`;
  if (m.film) return m.where;
  const f = game.flight;
  if (f) {
    const r = game.records;
    const k = r.tally.kills;
    return `flying, day ${game.level === 3 ? 1 : game.level === 5 ? 2 : 3} · ${f.fly ? "FLY" : "HOVER"} (T switches) · ${f.pose.x},${f.pose.y} facing ${"NSEW"[f.pose.dir]} · kills: ${k.jeep} jeeps, ${k.tank} tanks, ${k.bike} bikes, ${k.copter} copters · cash ${r.score} · lives ${r.lives}`;
  }
  if (game.mart) return `the Mart · cash ${game.records.score}${game.mart.selected ? ` · selected tier ${game.mart.selected.tier + 1} of kind ${game.mart.selected.kind}` : ""}`;
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
  draw();
  menu.sync();
  loadBtn.disabled = !game.canOpen;
  const s = where();
  const shown = player ? `autoplay${SPEED > 1 ? ` ×${SPEED}` : ""}, seed ${AUTO_SEED || "random"} · ${s}` : s;
  if (shown !== lastStatus) locEl.textContent = lastStatus = shown;
  requestAnimationFrame(frame);
}

/* ------------------------------------------------------------------------- *
 * Input
 * ------------------------------------------------------------------------- */

/**
 * A pointer event in the screen's pixels. Pointer events and not mouse events:
 * a mouse event's position is rounded to whole CSS pixels, and with the canvas
 * at a fractional place on the page that rounding can land a click in the pixel
 * next door (Lunicus's page says more).
 */
const at = (e: PointerEvent): { x: number; y: number } => {
  const r = canvas.getBoundingClientRect();
  const x = Math.floor(((e.clientX - r.left) / r.width) * SCREEN_W);
  const y = Math.floor(((e.clientY - r.top) / r.height) * SCREEN_H);
  if (e.target !== canvas) return { x, y };
  return { x: Math.min(SCREEN_W - 1, Math.max(0, x)), y: Math.min(SCREEN_H - 1, Math.max(0, y)) };
};
/** a gesture's key, as `KeyboardEvent.key` names it */
const GESTURE_KEYS: Record<GestureKey, string> = { uparrow: "ArrowUp", downarrow: "ArrowDown", leftarrow: "ArrowLeft", rightarrow: "ArrowRight", ".": "Escape" };
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

const charge = $("charge");
const bar = $("bar");
const bootsay = $("bootsay");
const bootpct = $("bootpct");

function gauge(fraction: number, what: string): void {
  const pct = Math.round(fraction * 100);
  charge.style.width = `${pct}%`;
  bar.setAttribute("aria-valuenow", String(pct));
  bootpct.textContent = `${pct}%`;
  bootsay.textContent = what;
}

async function boot(): Promise<void> {
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  step("Jump Raven (1994) — DreamFactory 0");
  const res = await fetch(url("gamefiles.json"));
  if (!res.ok) throw new Error(`no gamefiles.json (${res.status}) — is jumpraven/gamefiles/ there?`);
  const manifest = (await res.json()) as Record<string, number>;
  sizes = Object.fromEntries(Object.entries(manifest).filter(([k]) => k.startsWith(RIP)));
  const missing = PRELOAD.filter((p) => !(RIP + p in sizes));
  if (missing.length) throw new Error(`not in the rip: ${missing.join(", ")}`);
  const total = PRELOAD.reduce((n, p) => n + sizes[RIP + p], 0);
  const got = new Map<string, number>();
  await Promise.all(
    PRELOAD.map((p) =>
      fetchBytes(p, (n) => {
        got.set(p, n);
        gauge([...got.values()].reduce((a, b) => a + b, 0) / total, `reading ${p}…`);
      }),
    ),
  );
  gauge(1, "ready");
  $("boot").classList.add("ready");
  document.body.classList.remove("booting");
  step("ready — Enter plays the intro; Esc skips a film or ends a briefing");
}

async function enter(): Promise<void> {
  audio ??= new AudioContext();
  await audio.resume();
  // a theme asked for before there was sound to play it on (a saved game
  // opened before Enter starts in a flight)
  if (m.ambiencePlaying && !theme) m.playAmbience();
  document.body.classList.add("playing");
  if (running) return;
  running = true;
  last = performance.now();
  requestAnimationFrame(frame);
}

$("start").addEventListener("click", () => void enter().catch((e) => complain(String(e))));
void boot().catch((e) => complain(String(e)));
