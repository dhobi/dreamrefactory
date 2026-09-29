/**
 * Jump Raven's prototype page: the disc read, and the intro played on it.
 *
 * Nothing of the game itself is ported yet — RAVEN.EXE has not been
 * disassembled — so the page is the structure every game page has (the gauge,
 * Enter, the picture doubled, fullscreen, the bug report, the boot log and the
 * status line) around the one thing the files alone can do: play a film. Enter
 * plays `intro.move`, which chains to `intro2.move`, and then the page says how
 * far the port goes.
 */
import { installFullscreen } from "@dreamfactory/engine/web/fullscreen";
import { focusOwnsKey } from "@dreamfactory/engine/web/keys";
import { installBugReport } from "@dreamfactory/site/bug-report";
import { VERSION } from "@dreamfactory/site/version";
import { playFilm, type Co, type FilmHost } from "./film";

const SCREEN_W = 512;
const SCREEN_H = 384;
const SCALE = 2;
const TICKS_PER_SECOND = 60;
/** a tab left in the background comes back to this many ticks of catching up, not minutes */
const MAX_CATCH_UP = 6;
const RIP = "gamefiles/RAVEN/";
/** where RAVEN.EXE looks for a film it names (its `day1\` and `shared\`) */
const FILM_DIRS = ["DAY1/", "SHARED/"];
/** the opening, fetched before Enter */
const PRELOAD = ["DAY1/INTRO.MOV", "DAY1/INTRO2.MOV"];
const FIRST_FILM = "intro.move";

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

/** a film's file from the name the game calls it by: `intro2.move` → DAY1/INTRO2.MOV */
function filmPath(name: string): string | null {
  const file = name.replace(/\.move$/i, ".mov").toUpperCase();
  for (const dir of FILM_DIRS) if (RIP + dir + file in sizes) return dir + file;
  return null;
}

/* ------------------------------------------------------------------------- *
 * Sound
 * ------------------------------------------------------------------------- */

let audio: AudioContext | null = null;
const playing = new Set<AudioBufferSourceNode>();

/* ------------------------------------------------------------------------- *
 * The screen and the clock
 * ------------------------------------------------------------------------- */

const image = ctx.createImageData(SCREEN_W, SCREEN_H);
const off = new OffscreenCanvas(SCREEN_W, SCREEN_H);
const offCtx = off.getContext("2d")!;
let skip = false;

const host: FilmHost = {
  film(name) {
    const path = filmPath(name);
    if (!path) throw new Error(`no film ${name} in ${FILM_DIRS.join(" or ")}`);
    const got = bytes.get(path);
    if (!got && !fetching.has(path)) {
      say(`reading ${path} (${(sizes[RIP + path] / 1e6).toFixed(1)} MB)…`);
      void fetchBytes(path);
    }
    return got ?? null;
  },
  show(pixels, width, height, top, left, palette) {
    const px = image.data;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const c = pixels[y * width + x] * 4;
        const o = ((top + y) * SCREEN_W + left + x) * 4;
        px[o] = palette[c];
        px[o + 1] = palette[c + 1];
        px[o + 2] = palette[c + 2];
        px[o + 3] = 255;
      }
    }
    offCtx.putImageData(image, 0, 0);
    ctx.drawImage(off, 0, 0, SCREEN_W * SCALE, SCREEN_H * SCALE);
  },
  play({ samples, sampleRate }) {
    if (!audio) return;
    const buf = audio.createBuffer(1, samples.length, sampleRate);
    buf.getChannelData(0).set(samples);
    const src = audio.createBufferSource();
    src.buffer = buf;
    src.connect(audio.destination);
    src.onended = () => playing.delete(src);
    playing.add(src);
    src.start();
  },
  stopSound() {
    for (const s of playing) s.stop();
    playing.clear();
  },
  soundBusy: () => playing.size > 0,
  skipped() {
    const was = skip;
    skip = false;
    return was;
  },
  log: say,
  where: (line) => void (locEl.textContent = line),
};

function* opening(): Co {
  yield* playFilm(host, FIRST_FILM);
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  locEl.textContent = "the intro is as far as the port goes — the game itself is not ported yet";
  step("the end of the intro: RAVEN.EXE is not ported yet");
}

let co: Co | null = null;
let last = 0;
let owed = 0;
function frame(now: number): void {
  if (!co) return;
  owed = Math.min(owed + ((now - last) * TICKS_PER_SECOND) / 1000, MAX_CATCH_UP);
  last = now;
  try {
    for (; owed >= 1 && co; owed--) if (co.next().done) co = null;
  } catch (e) {
    complain(String(e));
    co = null;
  }
  if (co) requestAnimationFrame(frame);
}

/* ------------------------------------------------------------------------- *
 * Input
 * ------------------------------------------------------------------------- */

canvas.addEventListener("pointerdown", () => void (co && (skip = true)));
document.addEventListener("keydown", (e) => {
  if (focusOwnsKey(e.target, e.key)) return;
  if (e.key === "b") return toggleLog();
  if (e.key === "Escape" && co) (skip = true), e.preventDefault();
});

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
  step("ready — Enter plays the intro");
}

async function enter(): Promise<void> {
  audio ??= new AudioContext();
  await audio.resume();
  document.body.classList.add("playing");
  if (co) return;
  co = opening();
  last = performance.now();
  requestAnimationFrame(frame);
}

$("start").addEventListener("click", () => void enter().catch((e) => complain(String(e))));
void boot().catch((e) => complain(String(e)));
