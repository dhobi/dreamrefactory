/**
 * Lunicus's prototype page: the game machine (`src/game/`) driven at sixty ticks
 * a second, its screen drawn doubled, the mouse and keys handed in.
 *
 * Everything the game does is in the machine, so the page only
 *
 *   - serves the rip: the files the machine asks for, fetched in the
 *     background while it waits (`GameFiles.want`); the opening's and the lower
 *     floor's files are read before Enter, the upper floor's on the way up
 *   - runs the clock: a tick per 1/60 s of wall time, at most a few behind
 *   - draws the screen when its version moves, and plays its sounds
 *   - hands in input: a mouse-down or -up in the 512x384 screen's pixels, a key
 *     and whether it is held (the arrows walk while they are down)
 *
 * The title waits for File ▸ New, which LUNICUS.EXE's menu bar gave; here a
 * click on the title, or Enter, starts the game. The machine tests
 * (`tests/machine/`) drive the same machine with no page at all.
 */
import { installFullscreen } from "@dreamfactory/engine/web/fullscreen";
import { focusOwnsKey } from "@dreamfactory/engine/web/keys";
import { installBugReport } from "@dreamfactory/site/bug-report";
import { VERSION } from "@dreamfactory/site/version";
import { SCREEN_H, SCREEN_W, TICKS_PER_SECOND } from "./game/data";
import { Lunicus } from "./game/game";
import { Input, type Recording } from "./game/input";
import { browseForLoad, browseForSave, savesOpen } from "@dreamfactory/engine/web/save-browser";
import { windowDialogOpen } from "@dreamfactory/engine/web/window-dialog";
import { useSaveKind } from "@dreamfactory/engine/web/save-store";
import { LUNICUS_SAVES, seedLunicusSaves } from "./saves";
import { installMenu } from "./menu";
import { askHighScoreName, editKeys } from "./dialogs";

import type { GameFiles, Speaker } from "./game/machine";

const SCALE = 2;
const RIP = "gamefiles/LUNICUS/";
/** what the opening and day one's lower floor read, fetched before Enter */
const PRELOAD = [
  "lunicus/lunicus.fon", "lunicus/lunires.dll", "shared/panel.", "shared/moonsoun.",
  "day1/intro.mov", "day1/flip.mov", "shared/first.mov", "shared/lowerbas.",
  "shared/guard.", "shared/molotov.", "shared/sasha.",
];
/** a tab left in the background comes back to this many ticks of catching up, not minutes */
const MAX_CATCH_UP = 6;

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
  game: "Lunicus",
  canvas,
  shotName: "lunicus-bug.png",
  version: VERSION,
  where: () => locEl.textContent ?? "",
  edition: () => "Lunicus CD (gamefiles/LUNICUS/)",
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
/** Sound ▸ Sound Off … Level 7: the device's volume, which every channel goes through */
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
  loop(samples, rate) {
    ambience?.stop();
    ambience = null;
    if (!audio || !samples) return;
    const buf = audio.createBuffer(1, samples.length, rate);
    buf.getChannelData(0).set(samples);
    ambience = audio.createBufferSource();
    ambience.buffer = buf;
    ambience.loop = true;
    ambience.connect(out());
    ambience.start();
  },
  volume(level) {
    volume = level;
    if (master) master.gain.value = level;
  },
};
/** the ambience's channel: one source, looping */
let ambience: AudioBufferSourceNode | null = null;

/* ------------------------------------------------------------------------- *
 * The machine
 * ------------------------------------------------------------------------- */

/**
 * `?drive` hands the clock to whoever drives the page (tests/browser/playthrough.ts):
 * the page draws and listens as always but ticks only when told, and `?seed=`
 * pins the roll — a machine run's seed and gestures, replayed, are that run.
 */
const params = new URLSearchParams(location.search);
const DRIVE = params.has("drive");
/**
 * `?replay=/replays/playthrough.json&seed=…` plays a recorded machine run on
 * the page's own clock, at `pace` times game speed (`[` and `]` change it):
 * the same seed and the same gestures at the same ticks make the same run, so
 * this is the browser playthrough to watch — with the sound on.
 */
const REPLAY = params.get("replay");
let pace = Number(params.get("pace") ?? 1) || 1;
/* ------------------------------------------------------------------------- *
 * Saved games: the panel's save button writes through the shared dialog, and
 * the Load button is File ▸ Open (0x4184cc)
 * ------------------------------------------------------------------------- */

useSaveKind(LUNICUS_SAVES);
const saver = (bytes: Uint8Array, name: string, done: () => void): void => {
  browseForSave(bytes, name, { log: (l) => say(`  ${l}`) }).then(done, (e) => (complain(String(e)), done()));
};

/* ------------------------------------------------------------------------- *
 * LUNICUS.SCO — the key table and the high scores (game/sco.ts) — kept in the
 * browser, and the two dialogs that change it. A driven or replayed run plays a
 * machine run's gestures, so it has the defaults and asks nothing: a player's
 * own keys or a name dialog would part it from the run.
 * ------------------------------------------------------------------------- */

const SCO_KEY = "lunicus.sco";
const OWN_SCO = !DRIVE && !REPLAY;
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

const game = new Lunicus(files, {
  speaker,
  saver,
  seed: params.has("seed") ? Number(params.get("seed")) : Date.now() & 0xffff,
  log: say,
  ...(OWN_SCO && {
    sco: storedSco(),
    keepSco,
    keysDialog: (fields, defaults, done) => editKeys($("frame"), fields, defaults, done),
    askName: (done) => askHighScoreName($("frame"), done),
  }),
});
const m = game.m;
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

function status(): string {
  return (replay ? `replay ×${pace} · checkpoint ${replay.cp} of ${replay.rec.checkpoints.length} · ` : "") + where();
}

function where(): string {
  const b = game.base;
  if (game.phase === "not-ported" || game.phase === "over") return `${game.stopped} — reload the page for a new game`;
  if (game.phase === "title" && game.won && !m.film?.startsWith("intro")) return "the queen is dead, the game is won — the title again: click it for a new game";
  if (m.film) return `${m.where}`;
  const t = b?.talkState.talk ?? game.city?.talkState.talk;
  if (t) return `talking: ${t.file}${t.line ? ` · ${t.line}` : ""}`;
  if (b) return `${b.maze.name} · level ${game.progress.level} (day ${b.day}) · ${b.pose.x},${b.pose.y} facing ${"NSEW"[b.pose.dir]} · progress ${game.progress.day}`;
  const c = game.city;
  if (c?.world) {
    const w = c.world;
    return `${w.maze.name} · level ${game.progress.level} (day ${c.day}) · ${w.pose.x},${w.pose.y} facing ${"NSEW"[w.pose.dir]} · enemies ${game.hud.enemies} · ${c.wasp.wasp ? "" : "the node is out · "}ammo ${game.hud.bullets}/${game.hud.grenades}/${game.hud.rockets}`;
  }
  return m.where || game.phase;
}

let running = false;
let last = 0;
let owed = 0;
let lastStatus = "";
function frame(now: number): void {
  if (!running) return;
  owed = Math.min(owed + ((now - last) * TICKS_PER_SECOND * (replay ? pace : 1)) / 1000, MAX_CATCH_UP * (replay ? pace : 1));
  last = now;
  try {
    if (DRIVE || (REPLAY && !replay)) owed = 0;
    for (; owed >= 1; owed--) {
      if (replay) replayTick(replay);
      if (!game.tick()) break;
    }
  } catch (e) {
    complain(String(e));
    running = false;
  }
  draw();
  const s = status();
  if (s !== lastStatus) locEl.textContent = lastStatus = s;
  menu.sync();
  requestAnimationFrame(frame);
}

/* ------------------------------------------------------------------------- *
 * Input
 * ------------------------------------------------------------------------- */

/**
 * A pointer event in the screen's pixels. Pointer events and not mouse events:
 * a mouse event's position is rounded to whole CSS pixels, and with the canvas
 * at a fractional place on the page (it is centred) and a screen pixel under
 * two CSS pixels wide, that rounding can land a click in the pixel next door.
 * A pointer event carries the position as it is.
 *
 * One over the canvas is on the screen by definition, so it is held inside it
 * (a click on the canvas's very edge is still on its edge pixel); a release let
 * go off the canvas keeps where it really was.
 */
const at = (e: PointerEvent): { x: number; y: number } => {
  const r = canvas.getBoundingClientRect();
  const x = Math.floor(((e.clientX - r.left) / r.width) * SCREEN_W);
  const y = Math.floor(((e.clientY - r.top) / r.height) * SCREEN_H);
  if (e.target !== canvas) return { x, y };
  return { x: Math.min(SCREEN_W - 1, Math.max(0, x)), y: Math.min(SCREEN_H - 1, Math.max(0, y)) };
};
/** the one door the page's hands and the machine tests' share (game/input.ts) */
const input = new Input(game);
canvas.addEventListener("pointerdown", (e) => {
  if (!running || REPLAY) return;
  const p = at(e);
  input.down(p.x, p.y);
});
canvas.addEventListener("pointermove", (e) => {
  if (REPLAY) return;
  const p = at(e);
  input.move(p.x, p.y);
});
addEventListener("pointerup", (e) => {
  if (!running || REPLAY) return;
  const p = at(e);
  input.up(p.x, p.y);
});
document.addEventListener("keydown", (e) => {
  if (focusOwnsKey(e.target, e.key)) return;
  // the saved-games dialog is modal, as the EXE's was: the game gets no key while it is up
  if (savesOpen() || windowDialogOpen()) return;
  if (e.key === "b") return toggleLog();
  if (!running) return;
  if (REPLAY) {
    // the recording plays the game; the viewer only sets the pace
    if (e.key === "]") pace = Math.min(64, pace * 2);
    if (e.key === "[") pace = Math.max(0.25, pace / 2);
    return;
  }
  if (e.repeat) return (input.takes(e.key) && e.preventDefault(), undefined); // a held arrow is the machine's to repeat
  if (input.keyDown(e.key)) e.preventDefault();
});
document.addEventListener("keyup", (e) => void (REPLAY || input.keyUp(e.key)));

/* ------------------------------------------------------------------------- *
 * A replay
 * ------------------------------------------------------------------------- */

interface Replay {
  rec: Recording;
  /** the next gesture and the next checkpoint */
  g: number;
  cp: number;
}
let replay: Replay | null = null;

async function loadReplay(path: string): Promise<void> {
  const res = await fetch(url(path));
  if (!res.ok) throw new Error(`${path}: ${res.status} — ${await res.text()}`);
  const rec = (await res.json()) as Recording;
  if (rec.seed !== m.seed) throw new Error(`the recording was played on seed ${rec.seed}: open the page with &seed=${rec.seed}`);
  say(`replay: ${rec.gestures.length} gestures over ${rec.ticks} ticks; fetching ${rec.files.length} files…`);
  await Promise.all(rec.files.map((p) => fetchBytes(p)));
  replay = { rec, g: 0, cp: 0 };
  say("replay: playing — [ and ] halve and double the pace");
}

/** before a tick: its checkpoint compared, then its gestures, in the order they were kept */
function replayTick(r: Replay): void {
  const { rec } = r;
  for (; r.cp < rec.checkpoints.length && rec.checkpoints[r.cp].t <= m.ticks; r.cp++) {
    const cp = rec.checkpoints[r.cp];
    const same = cp.phase === game.phase && cp.level === game.progress.level && cp.progress === game.progress.day && cp.score === game.hud.score && cp.won === game.won;
    if (same) say(`✓ ${cp.what}`);
    else complain(`the replay parted from the run at tick ${cp.t} (${cp.what})`);
  }
  for (; r.g < rec.gestures.length && rec.gestures[r.g].t <= m.ticks; r.g++) {
    const g = rec.gestures[r.g];
    if ("key" in g) {
      if (g.g === "keydown") input.keyDown(g.key);
      else input.keyUp(g.key);
    } else if (g.g === "menu") input.menu(g.id);
    else if (g.g === "down") input.down(g.x, g.y);
    else if (g.g === "up") input.up(g.x, g.y);
    else input.move(g.x, g.y);
  }
}

/** the driver's handle, in drive mode only */
interface Drive {
  /** Enter has been pressed: the page takes input */
  running(): boolean;
  /** fetch these before the first tick, so no tick waits on the network */
  preload(paths: string[]): Promise<void>;
  /** tick until the machine's clock reads `t`; answers the state there */
  to(t: number): DriveState;
  state(): DriveState;
}
interface DriveState {
  t: number;
  phase: string;
  level: number;
  progress: number;
  score: number;
  won: boolean;
  stopped: string;
  /** where the canvas is on the page now, which the menu bar and the frame's
   *  arrival move: what a driver aims its mouse by */
  screen: { x: number; y: number; width: number; height: number };
}
if (DRIVE) {
  const state = (): DriveState => ({
    t: m.ticks,
    phase: game.phase,
    level: game.progress.level,
    progress: game.progress.day,
    score: game.hud.score,
    won: game.won,
    stopped: game.stopped,
    screen: (({ x, y, width, height }) => ({ x, y, width, height }))(canvas.getBoundingClientRect()),
  });
  const drive: Drive = {
    running: () => running,
    preload: async (paths) => void (await Promise.all(paths.map((p) => fetchBytes(p)))),
    to: (t) => {
      while (m.ticks < t) if (!game.tick()) break;
      // the bar as the machine now has it, not as the last animation frame left
      // it: it moves the canvas, and the driver aims by where the canvas is
      menu.sync();
      return state();
    },
    state,
  };
  (window as unknown as { lunicusDrive: Drive }).lunicusDrive = drive;
}
addEventListener("blur", () => m.keysHeld.clear());

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
  step("Lunicus (1994) — DreamFactory 0");
  const res = await fetch(url("gamefiles.json"));
  if (!res.ok) throw new Error(`no gamefiles.json (${res.status}) — is lunicus/gamefiles/ there?`);
  const manifest = (await res.json()) as Record<string, number>;
  sizes = Object.fromEntries(Object.entries(manifest).filter(([k]) => k.startsWith(RIP)));
  // the port's day saves (gamefiles/save/), into the saved games once
  void seedLunicusSaves((path) => (`gamefiles/${path}` in manifest ? url(`gamefiles/${path}`) : null)).then((n) => {
    if (n) say(`listed ${n} of the port's day saves in the saved games`);
  });
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
  step("ready — Enter plays the intro; click the title to start a new game");
}

async function enter(): Promise<void> {
  audio ??= new AudioContext();
  await audio.resume();
  if (REPLAY && !replay && !running) await loadReplay(REPLAY);
  // an ambience asked for before there was sound to play it on
  if (m.ambiencePlaying && !ambience) m.playAmbience();
  document.body.classList.add("playing");
  if (running) return;
  running = true;
  last = performance.now();
  requestAnimationFrame(frame);
}

$("start").addEventListener("click", () => void enter().catch((e) => complain(String(e))));
/** File ▸ Open (0x4184cc): the saved-games dialog, then the file's game */
const openSaved = (): void =>
  void (async () => {
    // a replay plays a recorded game: no other game goes in
    if (REPLAY) return;
    const bytes = await browseForLoad({ log: (l) => say(`  ${l}`) });
    if (!bytes) return;
    if (!running) await enter();
    game.openGame(bytes);
  })().catch((e) => complain(String(e)));
$("loadBtn").addEventListener("click", openSaved);
/** the game window's menu bar, on the frame over the picture (src/menu.ts) */
const menu = installMenu($("frame"), game, input, { open: openSaved, live: () => running && !REPLAY && !savesOpen() && !windowDialogOpen() });
void boot().catch((e) => complain(String(e)));
