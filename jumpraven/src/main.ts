/**
 * Jump Raven's prototype page: the game machine (`src/game/`) driven at sixty
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
 *
 * The machine tests (`tests/machine/`) drive the same machine with no page.
 */
import { installFullscreen } from "@dreamfactory/engine/web/fullscreen";
import { focusOwnsKey } from "@dreamfactory/engine/web/keys";
import { installBugReport } from "@dreamfactory/site/bug-report";
import { VERSION } from "@dreamfactory/site/version";
import { SCREEN_H, SCREEN_W, TICKS_PER_SECOND } from "./game/data";
import { JumpRaven } from "./game/game";
import { Input } from "./game/input";
import type { GameFiles, Speaker } from "./game/machine";

const SCALE = 2;
const RIP = "gamefiles/RAVEN/";
/** what the opening reads before its first briefing, fetched before Enter */
const PRELOAD = ["RAVEN/RAVEN.FON", "RAVEN/RAVEN.SCO", "SHARED/PUPPET", "DAY1/INTRO.MOV", "DAY1/INTRO2.MOV"];
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
const playing = new Set<AudioBufferSourceNode>();
const speaker: Speaker = {
  play(samples, rate) {
    if (!audio) return;
    const buf = audio.createBuffer(1, samples.length, rate);
    buf.getChannelData(0).set(samples);
    const src = audio.createBufferSource();
    src.buffer = buf;
    src.connect(audio.destination);
    src.onended = () => playing.delete(src);
    playing.add(src);
    src.start();
  },
  stop() {
    for (const s of playing) s.stop();
    playing.clear();
  },
};

/* ------------------------------------------------------------------------- *
 * The machine
 * ------------------------------------------------------------------------- */

const game = new JumpRaven(files, { speaker, seed: Date.now() & 0xffff, log: say });
const m = game.m;
const input = new Input(game);
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
  if (f) return `flying, day ${game.level === 3 ? 1 : game.level === 5 ? 2 : 3} · ${f.fly ? "FLY" : "HOVER"} (T switches) · ${f.pose.x},${f.pose.y} facing ${"NSEW"[f.pose.dir]} — no enemies yet: the flying is ported as far as the city`;
  if (game.mart) return `the Mart · cash ${game.records.score}${game.mart.selected ? ` · selected tier ${game.mart.selected.tier + 1} of kind ${game.mart.selected.kind}` : ""}`;
  if (game.phase === "scores") return "the high scores screen — PLAY starts a game";
  return m.where || game.phase;
}

let running = false;
let last = 0;
let owed = 0;
let lastStatus = "";
function frame(now: number): void {
  if (!running) return;
  owed = Math.min(owed + ((now - last) * TICKS_PER_SECOND) / 1000, MAX_CATCH_UP);
  last = now;
  try {
    for (; owed >= 1; owed--) if (!game.tick()) break;
  } catch (e) {
    complain(String(e));
    running = false;
  }
  draw();
  const s = where();
  if (s !== lastStatus) locEl.textContent = lastStatus = s;
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
canvas.addEventListener("pointerdown", (e) => {
  if (!running) return;
  const p = at(e);
  input.down(p.x, p.y);
});
addEventListener("pointermove", (e) => {
  const p = at(e);
  input.move(p.x, p.y);
});
addEventListener("pointerup", (e) => {
  if (!running) return;
  const p = at(e);
  input.up(p.x, p.y);
});
document.addEventListener("keydown", (e) => {
  if (focusOwnsKey(e.target, e.key)) return;
  if (e.key === "b") return toggleLog();
  if (!running || e.repeat) return;
  if (input.keyDown(e.key)) e.preventDefault();
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
  document.body.classList.add("playing");
  if (running) return;
  running = true;
  last = performance.now();
  requestAnimationFrame(frame);
}

$("start").addEventListener("click", () => void enter().catch((e) => complain(String(e))));
void boot().catch((e) => complain(String(e)));
