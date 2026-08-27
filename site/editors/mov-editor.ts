/**
 * Movie Editor (movies.html) — the seventh browser editor, and the one that is
 * mostly an INSPECTOR: load a .MOV (upload, drag-and-drop, or pick one from the
 * dev server's gamefiles manifest) and read it as what it actually is — a state
 * machine of frames, each of which either takes an action or waits for a click
 * on one of its regions. Scrub the frames, follow the machine, click the regions
 * and watch where they go, hear the audio, and edit the logic.
 *
 * Editable: the frame names, each frame's action and its three names, each
 * region's action, names and rectangle, the two action-frame slots, and the
 * ESC-aborts flag. Frame ART is READ-ONLY (export as PNG, no import) — not an
 * omission: a movie's frames are delta-encoded in one chain, so replacing one
 * would smear every frame after it (see the note in engine/src/df/mov.ts and the test
 * that pins it). Reading is the same code path the game uses (readMovFile/
 * decodeFrame); writing is the patches in engine/src/df/mov.ts, so an untouched load
 * exports the file it read (see taoot/tests/auto/mov-editor.ts).
 */
import { FrameBuffer, decodeFrame, indexedToRGBA, paletteToRGBA } from "@dreamfactory/engine/df/image";
import { installGamesMenu } from "@dreamfactory/site/games-menu";
import { installLanguageMenu } from "@dreamfactory/site/lang-menu";
import { installVersion } from "@dreamfactory/site/version";
import { byExtension, chosenSource, filesIn, installSourcePicker, listSources, screenOf } from "./sources";
import { siteUrl } from "@dreamfactory/site/site";
import { t, formatNumber } from "@dreamfactory/site/locales";
import { installI18n } from "@dreamfactory/site/locales";
import { decodeAudioContainer } from "@dreamfactory/engine/df/audio";
import {
  NATIVE_FRAME_MS,
  TICK_MS,
  bedRuntimeMs,
  chooseFrameInterval,
  frameHoldMs,
  frameWaits,
  framesLoop,
  isBed,
  segmentInterval,
} from "@dreamfactory/engine/df/mov-pace";
import { segmentAudio, soundtrackFor } from "@dreamfactory/engine/df/mov-sound";
import { writeContainerFile } from "@dreamfactory/engine/df/container";
import { detectVersion } from "@dreamfactory/engine/df/version";
import { movFileFromV1, readMovFileV1 } from "@dreamfactory/engine/df/mov-v1";
import {
  MOV_ACTIONS,
  MOV_NAME_FIELD,
  MovClickRegion,
  MovFile,
  MovFrame,
  MovSegment,
  patchActionFrames,
  patchFrameLogic,
  patchFrameName,
  patchKeySkips,
  patchRegionLogic,
  patchRegionRect,
  readMovFile,
} from "@dreamfactory/engine/df/mov";
import type { GameScreen } from "@dreamfactory/site/games";

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const landing = $("landing");
const editor = $("editor");
const statusEl = $("status");
const dirtyEl = $("dirty");

/**
 * What this preview will play at, from the SHARED rule (engine/src/df/mov-pace.ts) rather
 * than a number of its own.
 *
 * It was `const FRAME_MS = 66` — the native rate, applied to every movie — while the
 * player paced a cutscene off its soundtrack. So the editor showed you a film the
 * game would not play, and for the two the game got wrong (the demo's trailer and
 * tour) it showed the RIGHT one and hid the bug.
 */
let frameMs = NATIVE_FRAME_MS;
/** a runaway guard for "follow the machine": a type-2 loop is legitimate (the
 *  curtains toggle forever), so the run is bounded rather than trusted */
const MAX_STEPS = 2000;

// --- editor state -----------------------------------------------------------

let mov: MovFile | null = null;
/**
 * The segment on screen — a film is a CHAIN of them (engine/src/df/mov.ts), each with
 * its own palette, frame table, audio and action-frame slots, and this page
 * shows one at a time. It used to show `MovFile`'s own fields, which are
 * segment 0's, so a 13-segment film read as its first fragment and there was
 * no way to reach the rest.
 */
let segIdx = 0;
const segment = (): MovSegment | null => mov?.segments[segIdx] ?? null;
let fileName = "movie.mov";

/**
 * A DreamFactory 1 container, read through the engine's own v1->v4 conversion.
 *
 * This page models a v4 film — a chain of segments with a patch layer that edits
 * v4 bytes in place. The conversion gives it something of that shape to SHOW,
 * which is what makes Dust's 258 movies browsable here at no cost: it is the same
 * line the movie player already uses to play them
 * (engine/src/web/movie-player.ts).
 *
 * What it cannot do is write one back. A converted file's structures are DERIVED,
 * so patching them as v4 and exporting would produce bytes that are neither
 * version. So a v1 container opens READ-ONLY: export refuses, and says why.
 * Making it editable means a v1 write path, which is parsing work rather than
 * plumbing.
 */
let readOnlyV1 = false;

// Hard-coded English, like every string this repo builds in TypeScript rather
// than in markup (site/src/locales/en.ts says why).
const V1_READ_ONLY =
  "DreamFactory 1 container: shown through the v1 conversion, read-only. Export needs a v1 write path.";
let palette: Uint8ClampedArray = new Uint8ClampedArray(1024);
/** human-readable notes of every edit, shown next to the export button */
const edits: string[] = [];
let frameIdx = 0;
/** the region row the pointer is on, highlighted in the overlay */
let hoveredRegion = -1;
let showRegions = true;
/** the running playback, if any */
let playing: { stop: () => void } | null = null;

/**
 * The decode cursor. Frames are delta-encoded in ONE chain for the whole movie,
 * so frame N only exists once 0..N have been decoded in order into the same
 * buffer. Going forward is cheap (decode the gap); going back means starting the
 * chain again, which is why this is a cursor and not a cache — a long cutscene's
 * every frame is a full 512×384 picture and they will not all fit.
 */
let fb = new FrameBuffer();
let cursor = -1;
let decoded: { width: number; height: number } | null = null;

function log(text: string): void {
  statusEl.textContent = text;
}

function markEdit(note: string): void {
  edits.push(note);
  dirtyEl.textContent = t("counts.unexportedEdits", { n: edits.length });
}

window.addEventListener("beforeunload", (e) => {
  if (edits.length) e.preventDefault();
});

const frame = (): MovFrame | undefined => segment()?.frames[frameIdx];

// --- loading ----------------------------------------------------------------

function loadMov(bytes: Uint8Array, name: string): void {
  stopPlayback();
  let parsed: MovFile;
  try {
    // the same line the movie player uses (engine/src/web/movie-player.ts)
    readOnlyV1 = detectVersion(bytes) === 1;
    parsed = readOnlyV1 ? movFileFromV1(readMovFileV1(bytes)) : readMovFile(bytes);
    // a button that refuses when pressed is worse than one that says so first
    ($("exportBtn") as HTMLButtonElement).disabled = readOnlyV1;
    if (readOnlyV1) $("dirty").textContent = V1_READ_ONLY;
  } catch (e) {
    log(t("common.notReadable", { ext: ".mov", message: (e as Error).message }));
    return;
  }
  mov = parsed;
  fileName = name;
  segIdx = 0;
  palette = paletteToRGBA(parsed.paletteRaw, 256);
  edits.length = 0;
  dirtyEl.textContent = "";
  frameIdx = 0;
  hoveredRegion = -1;
  fb = new FrameBuffer();
  cursor = -1;
  decoded = null;

  landing.style.display = "none";
  editor.style.display = "flex";
  $("fileName").textContent = name;
  log("");
  refresh();
}

async function loadFromFile(f: File): Promise<void> {
  loadMov(new Uint8Array(await f.arrayBuffer()), f.name);
}

const fileInput = $<HTMLInputElement>("fileInput");
$("openBtn").addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", () => {
  if (fileInput.files?.[0]) void loadFromFile(fileInput.files[0]);
  fileInput.value = "";
});

document.body.addEventListener("dragover", (e) => {
  e.preventDefault();
  document.body.classList.add("dragover");
});
document.body.addEventListener("dragleave", () => document.body.classList.remove("dragover"));
document.body.addEventListener("drop", (e) => {
  e.preventDefault();
  document.body.classList.remove("dragover");
  const f = e.dataTransfer?.files?.[0];
  if (f) void loadFromFile(f);
});

/** dev-server mode: offer every .mov in the gamefiles manifest */
async function initServerMovies(): Promise<void> {
  // Only the chosen EDITION's copies: an install with six of them holds six
  // `bedsit1.set`, and listing all six lists the same room six times under
  // names that cannot be told apart. The edition row at the top of the page is
  // what chooses, and it is the same choice the game reads (taoot/src/editions.ts).
  const source = chosenSource(await listSources());
  if (source) screen = screenOf(source);
  if (!source) return; // production / no dev server: upload only
  const movies = filesIn(source, byExtension(".mov"));
  if (!movies.length) return;
  const wrap = $("serverMovies");
  const note = document.createElement("div");
  note.className = "note";
  note.textContent = t("common.pickFromGamefilesBig");
  wrap.appendChild(note);
  const row = document.createElement("div");
  row.className = "row movies";
  for (const f of movies) {
    const b = document.createElement("button");
    b.className = "movie";
    b.textContent = f.base;
    b.title = `${source.game.short} · ${f.path}`;
    b.addEventListener("click", async () => {
      log(t("common.loading", { path: f.path }));
      const r = await fetch(f.url);
      if (!r.ok) {
        log(t("common.fetchFailed", { path: f.path, status: r.status }));
        return;
      }
      loadMov(new Uint8Array(await r.arrayBuffer()), f.base);
    });
    row.appendChild(b);
  }
  wrap.appendChild(row);
}
void initServerMovies();

$("closeBtn").addEventListener("click", () => {
  if (edits.length && !confirm(t("counts.discardEdits", { n: edits.length }))) return;
  stopPlayback();
  mov = null;
  edits.length = 0;
  fb = new FrameBuffer();
  cursor = -1;
  editor.style.display = "none";
  landing.style.display = "block";
});

// --- the decode chain -------------------------------------------------------

/**
 * Bring the frame buffer up to `index`, decoding forward from where it is and
 * restarting the chain when asked to go back. Answers how many frames had to be
 * decoded, so the UI can say when a backwards jump was expensive.
 *
 * The chain is per SEGMENT — the player starts each one on a fresh buffer
 * (MoviePlayer.enterSegment) — so switching segments resets the cursor.
 */
function decodeUpTo(index: number): number {
  const seg = segment();
  if (!mov || !seg) return 0;
  if (index < cursor) {
    fb = new FrameBuffer();
    cursor = -1;
  }
  let count = 0;
  for (let i = cursor + 1; i <= index; i++) {
    const loc = seg.frames[i]?.locationFrame;
    const data = loc ? mov.file.containers[loc]?.data : undefined;
    if (data) {
      try {
        decoded = decodeFrame(data, fb);
        count++;
      } catch {
        // a frame that doesn't decode leaves the buffer as it was, which is what
        // the engine's own blit would show
      }
    }
    cursor = i;
  }
  return count;
}

/**
 * The game's own screen, for the one case a film does not say: a MOV segment
 * declares its size and a decoded frame has one, so this is only ever the
 * fallback — and a fallback of 512×384 is another game's guess. See `screenOf`.
 */
let screen: GameScreen = screenOf(null);

function paintFrame(): void {
  const canvas = $<HTMLCanvasElement>("preview");
  const w = decoded?.width || segment()?.width || screen.width;
  const h = decoded?.height || segment()?.height || screen.height;
  canvas.width = Math.max(1, w);
  canvas.height = Math.max(1, h);
  const ctx = canvas.getContext("2d")!;
  if (!fb.pixels.length) {
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    return;
  }
  const img = ctx.createImageData(w, h);
  indexedToRGBA(fb.pixels, w, h, palette, img.data);
  ctx.putImageData(img, 0, 0);
}

// --- preview ----------------------------------------------------------------

/** what a frame or region's action does, in words */
function actionText(type: number, event: string, target: string): string {
  const base = MOV_ACTIONS[type] ?? t("movies.unknownAction", { type });
  if ((type === 2 || type === 4) && target) return `${base} “${target}”`;
  if (type === 3 || type === 4) return event ? `${base} “${event}”` : base;
  return base;
}

function renderPreview(): void {
  const seg = segment();
  if (!mov || !seg) return;
  paintFrame();
  drawOverlay();
  const f = frame();
  const slider = $<HTMLInputElement>("frameSlider");
  slider.max = String(Math.max(0, seg.frames.length - 1));
  slider.value = String(frameIdx);
  $("frameLabel").textContent = `${frameIdx + 1} / ${seg.frames.length}`;
  const action = f?.regions.length
    ? t("movies.waitsForClick") + t("counts.clickableRegions", { n: f.regions.length })
    : f
      ? actionText(f.type, f.event, f.target)
      : "";
  $("previewInfo").innerHTML = f
    ? t("movies.previewHead", { i: frameIdx, name: f.name || t("movies.unnamed"), action }) +
      t("movies.previewArt", { loc: f.locationFrame }) +
      (decoded
        ? t("movies.previewDecoded", { w: decoded.width, h: decoded.height })
        : t("movies.previewNotDecoded")) +
      t("movies.previewPacked", {
        bytes: formatNumber(mov.file.containers[f.locationFrame]?.data.length ?? 0),
      }) +
      t("movies.previewDirty", { w: f.width, h: f.height }) +
      t("movies.previewLogic", { loc: f.locationClickRegion || t("movies.logicNone"), type: f.type }) +
      (f.sound ? t("movies.previewSound", { sound: f.sound }) : "") +
      (seg.actionFrame1 && seg.actionFrame1.toLowerCase() === f.name.toLowerCase()
        ? t("movies.previewActionFrame", { n: 1 })
        : "") +
      (seg.actionFrame2 && seg.actionFrame2.toLowerCase() === f.name.toLowerCase()
        ? t("movies.previewActionFrame", { n: 2 })
        : "")
    : t("movies.noFrames");
}

/** the frame's clickable regions, over the picture */
function drawOverlay(): void {
  const preview = $<HTMLCanvasElement>("preview");
  const canvas = $<HTMLCanvasElement>("overlay");
  canvas.width = preview.width;
  canvas.height = preview.height;
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const f = frame();
  if (!showRegions || !f) return;
  ctx.font = '9px "Courier New", monospace';
  ctx.textBaseline = "top";
  f.regions.forEach((r, i) => {
    ctx.strokeStyle = i === hoveredRegion ? "#e4f0fc" : "#60c0f0";
    ctx.lineWidth = 1;
    ctx.strokeRect(r.x0 + 0.5, r.y0 + 0.5, r.x1 - r.x0, r.y1 - r.y0);
    const label = `${i}: ${r.type}${r.target ? `→${r.target}` : ""}${r.event ? ` ⇒${r.event}` : ""}`;
    ctx.fillStyle = "rgba(0,6,15,0.78)";
    ctx.fillRect(r.x0 + 1, r.y0 + 1, ctx.measureText(label).width + 4, 11);
    ctx.fillStyle = i === hoveredRegion ? "#e4f0fc" : "#b4d8f0";
    ctx.fillText(label, r.x0 + 3, r.y0 + 2);
  });
}

$("regionBtn").addEventListener("click", () => {
  showRegions = !showRegions;
  $("regionBtn").classList.toggle("on", showRegions);
  drawOverlay();
});
$("regionBtn").classList.add("on");

/** clicking the picture does what the movie would do with that click */
$<HTMLCanvasElement>("overlay").addEventListener("click", (e) => {
  const f = frame();
  if (!f) return;
  const canvas = $<HTMLCanvasElement>("overlay");
  const rect = canvas.getBoundingClientRect();
  const x = Math.round(((e.clientX - rect.left) / rect.width) * canvas.width);
  const y = Math.round(((e.clientY - rect.top) / rect.height) * canvas.height);
  // front-to-back is not a thing here: the engine takes the FIRST region whose
  // rectangle contains the point (MoviePlayer.regionAt)
  const idx = f.regions.findIndex((r) => x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1);
  if (idx < 0) {
    log(t("movies.clickOutside", { x, y }));
    return;
  }
  const r = f.regions[idx];
  log(
    `region ${idx} at (${x},${y}): ${actionText(r.type, r.event, r.target)}` +
      (r.sound ? ` · plays “${r.sound}”` : ""),
  );
  // A film parked on a waiting frame is waiting for exactly this: take the click
  // and play ON, which is how faucet.mov's tap and camelsee.mov's gallop are
  // meant to be watched. Only when no film is running does the click become a
  // single step of the machine walk.
  if (film) {
    filmClick(r);
    return;
  }
  stopPlayback();
  act(r.type, r.target, r.event, `region ${idx}`);
});

// --- following the machine --------------------------------------------------

/**
 * Do what an action code does, as far as one file can: the moves inside this
 * movie really move, and the ones that leave it (exit, chain to another movie,
 * pop the return stack) are reported, since there is no sequence here to leave.
 */
function act(type: number, target: string, event: string, who: string): void {
  const seg = segment();
  if (!mov || !seg) return;
  switch (type) {
    case 1:
      log(t("movies.type1", { who }));
      break;
    case 2:
    case 4: {
      const idx = seg.frames.findIndex((f) => f.name.toLowerCase() === target.toLowerCase());
      if (type === 4) {
        log(
          t("movies.type4", { who, target, event }),
        );
      }
      if (idx < 0) {
        if (type === 2) log(t("movies.type2NotFrame", { who, target }));
        return;
      }
      goToFrame(idx);
      break;
    }
    case 3:
      log(t("movies.type3", { who, event }));
      break;
    case 5:
      log(t("movies.type5", { who }));
      break;
    case 6:
      if (frameIdx + 1 < seg.frames.length) goToFrame(frameIdx + 1);
      else log(t("movies.type6Last", { who }));
      break;
    case 7:
      if (frameIdx > 0) goToFrame(frameIdx - 1);
      else log(t("movies.type7First", { who }));
      break;
    default:
      log(t("movies.typeUnknown", { who, type }));
  }
}

function goToFrame(idx: number): void {
  const seg = segment();
  if (!mov || !seg) return;
  frameIdx = Math.max(0, Math.min(seg.frames.length - 1, idx));
  hoveredRegion = -1;
  const cost = decodeUpTo(frameIdx);
  if (cost > 60) {
    log(t("movies.decodedCost", { n: cost }));
  }
  buildFrameList();
  buildFrameLogic();
  buildRegions();
  renderPreview();
}

$<HTMLInputElement>("frameSlider").addEventListener("input", () => {
  stopPlayback();
  goToFrame(Number($<HTMLInputElement>("frameSlider").value));
});
$("prevBtn").addEventListener("click", () => {
  stopPlayback();
  goToFrame(frameIdx - 1);
});
$("nextBtn").addEventListener("click", () => {
  stopPlayback();
  goToFrame(frameIdx + 1);
});

function stopPlayback(): void {
  playing?.stop();
  playing = null;
  $("playBtn").textContent = t("movies.followMachine");
  // the two are alternatives, not layers: a film running under a machine walk
  // would fight it for the frame on screen and for the decode cursor
  if (film) stopFilm();
}

/**
 * Play the movie the way its own logic says: a frame with regions WAITS (so
 * playback stops there and says so), and a frame without them takes its action —
 * which is usually type 6, advance, and is what makes a plain cutscene linear.
 */
$("playBtn").addEventListener("click", () => {
  if (playing) {
    stopPlayback();
    return;
  }
  if (!segment()?.frames.length) return;
  let steps = 0;
  let last = performance.now();
  let raf = 0;
  $("playBtn").textContent = "◼ Stop";
  const step = (now: number): void => {
    // the frame's OWN authored hold, so the preview runs at the speed the game
    // will (engine/src/df/mov-pace.ts frameHoldMs); frameMs is the fallback for a movie
    // that is pure click-through
    const seg = segment();
    if (now - last >= (seg ? frameHoldMs(seg, frameIdx) : frameMs)) {
      last = now;
      const f = frame();
      if (!f) {
        stopPlayback();
        return;
      }
      if (f.regions.length) {
        log(
          t("movies.frameWaits", { i: frameIdx, name: f.name }) +
            t("counts.clickableRegions", { n: f.regions.length }) +
            t("movies.frameWaitsTail"),
        );
        stopPlayback();
        return;
      }
      if (f.type !== 6 && f.type !== 7) {
        act(f.type, f.target, f.event, `frame ${frameIdx} “${f.name}”`);
        stopPlayback();
        return;
      }
      if (f.type === 6 && frameIdx + 1 >= seg!.frames.length) {
        log(t("movies.lastAdvances"));
        stopPlayback();
        return;
      }
      act(f.type, f.target, f.event, `frame ${frameIdx}`);
      if (++steps >= MAX_STEPS) {
        log(t("movies.stoppedAfter", { n: MAX_STEPS }));
        stopPlayback();
        return;
      }
    }
    raf = requestAnimationFrame(step);
  };
  raf = requestAnimationFrame(step);
  playing = { stop: () => cancelAnimationFrame(raf) };
});

// --- playing the whole film -------------------------------------------------

/**
 * The other button, and a different thing entirely.
 *
 * "Follow the machine" above walks the LOGIC of the segment you are looking at:
 * it steps frame by frame, stops at the first frame that waits for a click, stops
 * again at any action that would leave the file, and plays no sound. That is what
 * you want when the question is "where does this frame go".
 *
 * This plays the FILM — the whole file, from segment 1 frame 0, the way the game
 * plays it: every segment in order, each on its own palette and its own decode
 * chain, paced by the frames' authored holds, with the segment's bed under it and
 * the frames' entry sounds fired as they are entered. The rules come from the
 * engine ({@link file://../../engine/src/df/mov-pace.ts} for the pacing,
 * {@link file://../../engine/src/df/mov-sound.ts} for the soundtrack, both shared
 * with {@link file://../../engine/src/web/movie-player.ts}) rather than from a
 * second reading of them kept here, which is the only reason a preview is worth
 * trusting: a 13-segment film used to show you its first fragment in silence.
 *
 * Three things it does not do, each because this page has one file open and no
 * game around it:
 *
 *   - a chain to ANOTHER file (action types 3, 4 and 5) is reported and ends the
 *     run — following it would swap the file under your unexported edits;
 *   - a frame that genuinely waits for a click ends the run and says which frame
 *     and how many regions — the picture is still there to click, and clicking it
 *     does what the game would do (see the overlay handler above);
 *   - `actionframe(1)`/`(2)` are shown on the frame panel, not reported here:
 *     there is no script to hang a consequence off.
 */
interface Film {
  raf: number;
  /** the clock the CUE table is counted from: the segment's own start */
  segStart: number;
  /** when the frame on screen was entered — the hold is measured from here */
  lastTick: number;
  /** ms a frame, from the shared rule; 0 means nothing here self-advances */
  interval: number;
  /** cue indices already fired, so each fires once a segment (as in the player) */
  cuesFired: Set<number>;
  /** the segment's bed, stopped when the film ends or the next bed replaces it */
  bed: Voice | null;
  /** event sounds still in the air — what a waitsForVoice frame waits on */
  voices: Voice[];
  /** a spoken line that names the frame to jump to when it is done */
  soundJump: { frame: number; voice: Voice } | null;
  /** frames shown and when we started, for the closing line */
  shown: number;
  started: number;
  /**
   * Parked on a frame that waits for a click — the film is still running, and
   * still ticking: a cue or a finished line can lift it out of the wait, which
   * is why the poll for those sits outside the pacing gate (as it does in the
   * player, and for the same reason — the original polls both from its modal
   * wait loop).
   */
  waiting: boolean;
}

/**
 * The sound a click just fired, while its action is being taken.
 *
 * The frame a click advances into may carry the SAME sound the click itself
 * fired (ABE.MOV: the region on frame 17 and frame 18 both name sound 2). One
 * authored moment, one playback.
 */
let filmClickSound = "";

let film: Film | null = null;

function stopFilm(): void {
  if (!film) return;
  cancelAnimationFrame(film.raf);
  film.bed?.stop();
  for (const v of film.voices) v.stop();
  film = null;
  $("filmBtn").textContent = t("movies.playFilm");
  // the panels went untouched while it ran (a 1225-frame cutscene cannot rebuild
  // six tables a frame), so bring them to wherever it stopped
  refresh();
}

/**
 * Where the film is, on the controls that already say where you are: the label,
 * the scrub slider and — for a film that has more than one — the segment picker.
 *
 * Written rather than left behind, because a running film that leaves the slider
 * at frame 0 is a page telling you two different things at once. Assigning
 * `value` fires no `input` event, so the slider's own handler (which stops
 * playback) cannot be triggered by this.
 */
function filmLabel(): void {
  const m = mov!;
  const seg = segment()!;
  $("frameLabel").textContent =
    (m.segments.length > 1 ? `${segIdx + 1}/${m.segments.length} · ` : "") +
    `${frameIdx + 1} / ${seg.frames.length}`;
  const slider = $<HTMLInputElement>("frameSlider");
  slider.max = String(Math.max(0, seg.frames.length - 1));
  slider.value = String(frameIdx);
  const sel = $<HTMLSelectElement>("segmentSel");
  if (sel.value !== String(segIdx)) sel.value = String(segIdx);
}

/** play a named event sound, and arm the jump its name may carry */
function filmSound(name: string): void {
  const seg = segment();
  if (!film || !mov || !seg) return;
  if (name === filmClickSound) return;
  const loc = seg.sounds.get(name.toLowerCase());
  if (loc === undefined) return;
  let voice: Voice | null = null;
  try {
    const audio = decodeAudioContainer(mov.file.containers[loc].data);
    voice = playPcm(audio.samples, audio.sampleRate);
  } catch {
    // a sound this build cannot decode is silence, not a stopped film
  }
  if (!voice) return;
  film.voices = film.voices.filter((v) => !v.done);
  film.voices.push(voice);
  const follows = seg.soundFollows.get(name.toLowerCase());
  const target = follows ? frameIndexOf(follows) : -1;
  film.soundJump = target < 0 ? null : { frame: target, voice };
}

/** a frame by name, the way every stored target is resolved: case-insensitively */
function frameIndexOf(name: string): number {
  const seg = segment();
  if (!seg || !name) return -1;
  return seg.frames.findIndex((f) => f.name.toLowerCase() === name.toLowerCase());
}

/** show a frame while the film runs: the picture and the readout, nothing else */
function filmEnter(idx: number, now: number): void {
  const seg = segment();
  if (!film || !seg) return;
  frameIdx = Math.max(0, Math.min(seg.frames.length - 1, idx));
  hoveredRegion = -1;
  decodeUpTo(frameIdx);
  paintFrame();
  drawOverlay();
  filmLabel();
  film.shown++;
  film.lastTick = now;
  const sound = seg.frames[frameIdx].sound;
  if (sound) filmSound(sound);
}

/**
 * Start a segment: its palette, a fresh decode chain, its own pacing and its own
 * bed. A segment that brings no audio of its own KEEPS the bed already playing —
 * the rule the player takes from TI.EXE's segment reload, and the reason tour.mov's
 * eighteen slides sit under one narration.
 */
function enterFilmSegment(idx: number, now: number, startFrame = 0): void {
  const m = mov;
  if (!film || !m) return;
  segIdx = Math.max(0, Math.min(m.segments.length - 1, idx));
  const seg = m.segments[segIdx];
  fb = new FrameBuffer();
  cursor = -1;
  decoded = null;
  palette = paletteToRGBA(seg.paletteRaw, 256);
  film.segStart = now;
  film.cuesFired.clear();
  film.soundJump = null;

  let audio: ReturnType<typeof segmentAudio> = null;
  try {
    audio = segmentAudio(seg);
  } catch {
    // an undecodable chunk leaves the film silent and playing, which is what the
    // page does everywhere else it meets one
  }
  film.interval = segmentInterval(seg, seg.frames.length, audio?.audioSec ?? 0, segIdx);
  if (audio) {
    film.bed?.stop();
    // the same bed the GAME will play, inherited segments included — an editor
    // that previews a shorter one previews a film the game does not play
    const bed = soundtrackFor(seg, audio, film.interval, seg.frames.length, bedRuntimeMs(m, segIdx));
    film.bed = playPcm(bed.samples, bed.sampleRate, bed.loop);
  }
  log(
    t("movies.filmSegment", {
      n: segIdx + 1,
      total: m.segments.length,
      frames: t("counts.frames", { n: seg.frames.length }),
      picture: (
        seg.frames.reduce((a, _, i) => a + frameHoldMs(seg, i), 0) / 1000
      ).toFixed(1),
      bed: audio ? t("movies.filmBed", { secs: audio.audioSec.toFixed(1) }) : "",
    }),
  );
  // the chain is per segment and delta-encoded from its own frame 0, so starting
  // in the middle means replaying it to there — which decodeUpTo does, and which
  // is what the player does too when it resumes a segment at a frame
  filmEnter(startFrame, now);
}

/** the segment's exit: the next one, or the end of the film */
function endFilmSegment(now: number): void {
  const m = mov;
  if (!film || !m) return;
  if (segIdx + 1 < m.segments.length) enterFilmSegment(segIdx + 1, now, 0);
  else endFilm();
}

function endFilm(): void {
  if (!film) return;
  const secs = (performance.now() - film.started) / 1000;
  const shown = film.shown;
  stopFilm();
  log(t("movies.filmEnd", { frames: t("counts.frames", { n: shown }), secs: secs.toFixed(1) }));
}

/**
 * One of the seven action codes, applied to the running film. A frame's own
 * action and a region's are the same seven codes and take the same path, exactly
 * as they do in the player.
 */
function filmAction(
  type: number,
  target: string,
  event: string,
  who: string,
  now: number,
): void {
  const seg = segment();
  if (!film || !seg) return;
  switch (type) {
    case 2:
    case 4: {
      const idx = frameIndexOf(target);
      if (type === 4) {
        // the return stack only exists across files, and there is one file here
        log(t("movies.type4", { who, target, event }));
        stopFilm();
        return;
      }
      if (idx < 0) {
        log(t("movies.type2NotFrame", { who, target }));
        stopFilm();
        return;
      }
      filmEnter(idx, now);
      return;
    }
    case 3:
      log(t("movies.type3", { who, event }));
      stopFilm();
      return;
    case 5:
      log(t("movies.type5", { who }));
      stopFilm();
      return;
    case 6:
      // stepping past the last frame is the segment's exit, exactly as the
      // player treats it (TI.EXE calls it an error and says so)
      if (frameIdx + 1 < seg.frames.length) filmEnter(frameIdx + 1, now);
      else endFilmSegment(now);
      return;
    case 7:
      if (frameIdx > 0) filmEnter(frameIdx - 1, now);
      return;
    default:
      // 1 = exit: the SEGMENT's, and the film's only if this is the last of them
      endFilmSegment(now);
  }
}

/** the click a parked film was waiting for: its sound, then its action */
function filmClick(r: MovClickRegion): void {
  const seg = segment();
  if (!film || !seg) return;
  if (r.sound) filmSound(r.sound);
  film.waiting = false;
  const now = performance.now();
  film.lastTick = now;
  filmClickSound = r.sound;
  filmAction(r.type, r.target, r.event, `region on frame ${frameIdx}`, now);
  filmClickSound = "";
}

function filmStep(now: number): void {
  const seg = segment();
  if (!film || !seg) return;

  // Cues first, and outside the pacing gate: a timed jump fires out of any wait
  // (the original polls it from both wait loops). Empty for every shipped film
  // but the demo's tour.mov.
  for (let c = 0; c < seg.cues.length; c++) {
    const cue = seg.cues[c];
    if (film.cuesFired.has(c) || now - film.segStart < cue.tick * TICK_MS) continue;
    film.cuesFired.add(c);
    const idx = frameIndexOf(cue.target);
    log(t("movies.filmCue", { tick: cue.tick, target: cue.target }));
    if (idx >= 0) filmEnter(idx, now);
  }

  // a spoken line that names a follow-on frame comes due the same way
  if (film.soundJump?.voice.done) {
    const { frame: to } = film.soundJump;
    film.soundJump = null;
    filmEnter(to, now);
  }

  if (frameWaits(seg, frameIdx)) {
    // The film has not ended: this is what an interactive movie DOES, and the
    // bed under it goes on playing (soundtrackFor loops one for exactly this
    // case). Say so once, then keep ticking so a cue can still lift it out.
    if (!film.waiting) {
      const f = seg.frames[frameIdx];
      film.waiting = true;
      log(
        t("movies.frameWaits", { i: frameIdx, name: f.name }) +
          t("counts.clickableRegions", { n: f.regions.length }) +
          t("movies.frameWaitsTail"),
      );
    }
    film.raf = requestAnimationFrame(filmStep);
    return;
  }
  film.waiting = false;
  if (!film.interval) {
    // no step action, no soundtrack, no regions: in game this is a close-up held
    // until the player clicks it away, and there is nothing here to run
    log(t("movies.filmNoPacing"));
    stopFilm();
    return;
  }

  if (now - film.lastTick >= frameHoldMs(seg, frameIdx)) {
    const f = seg.frames[frameIdx];
    // ...and a frame may be authored to wait for the spoken line as well (flags
    // bit 0): what it waits on is the movie's own event sounds, never the bed —
    // a looping bed is never done, and waiting on it would hang the film
    if (f.waitsForVoice && film.voices.some((v) => !v.done)) {
      film.raf = requestAnimationFrame(filmStep);
      return;
    }
    film.lastTick = now;
    filmAction(f.type, f.target, f.event, `frame ${frameIdx}${f.name ? ` “${f.name}”` : ""}`, now);
  }
  if (film) film.raf = requestAnimationFrame(filmStep);
}

$("filmBtn").addEventListener("click", () => {
  if (film) {
    stopFilm();
    return;
  }
  const m = mov;
  if (!m || !m.segments.length) return;
  stopPlayback();
  // the click is the gesture a browser wants before it will make a sound; a
  // context built on page load starts suspended and the film would play mute
  audioCtx ??= new AudioContext();
  void audioCtx.resume();
  const now = performance.now();
  film = {
    raf: 0,
    segStart: now,
    lastTick: now,
    interval: 0,
    cuesFired: new Set(),
    bed: null,
    voices: [],
    soundJump: null,
    shown: 0,
    started: now,
    waiting: false,
  };
  $("filmBtn").textContent = "◼ Stop";
  // From the frame you are looking at, not from the top: scrub to the moment you
  // want to watch and press play. The one exception is the very end of the file —
  // there is nothing after the last frame of the last segment to continue INTO,
  // so pressing play there starts the film again.
  const atEnd =
    segIdx === m.segments.length - 1 && frameIdx >= m.segments[segIdx].frames.length - 1;
  const from = atEnd ? 0 : segIdx;
  const fromFrame = atEnd ? 0 : frameIdx;
  log(fromFrame || from ? t("movies.filmResume") : t("movies.filmStart"));
  enterFilmSegment(from, now, fromFrame);
  if (film) film.raf = requestAnimationFrame(filmStep);
});

// --- rendering --------------------------------------------------------------

function refresh(): void {
  if (!mov) return;
  buildFileBar();
  buildSegmentPicker();
  buildMovieFields();
  buildFrameList();
  buildFrameLogic();
  buildRegions();
  buildAudio();
  buildPalette();
  decodeUpTo(frameIdx);
  renderPreview();
}

/**
 * Show a different segment: its own palette, frames and audio, from its own
 * frame 0. The decode chain restarts because each segment's frames are
 * delta-encoded against a fresh buffer, exactly as the player treats them.
 */
function goToSegment(idx: number): void {
  if (!mov) return;
  stopPlayback();
  segIdx = Math.max(0, Math.min(mov.segments.length - 1, idx));
  frameIdx = 0;
  hoveredRegion = -1;
  fb = new FrameBuffer();
  cursor = -1;
  decoded = null;
  palette = paletteToRGBA(segment()!.paletteRaw, 256);
  refresh();
}

/** the segment chain, as a picker — hidden when there is only one */
function buildSegmentPicker(): void {
  const m = mov!;
  const wrap = $("segmentPick");
  const sel = $<HTMLSelectElement>("segmentSel");
  wrap.hidden = m.segments.length < 2;
  sel.replaceChildren();
  m.segments.forEach((s, i) => {
    const o = document.createElement("option");
    o.value = String(i);
    // the container index is how a segment is identified in the format, and
    // what the frame/audio locations below are relative to
    o.textContent = t("movies.segmentOption", {
      n: i + 1,
      total: m.segments.length,
      frames: s.frames.length,
      loc: s.bias,
    });
    sel.appendChild(o);
  });
  sel.value = String(segIdx);
  sel.onchange = () => goToSegment(Number(sel.value));
}

function buildFileBar(): void {
  const m = mov!;
  const seg = segment()!;
  const regions = seg.frames.reduce((n, f) => n + f.regions.length, 0);
  const waiting = seg.frames.filter((f) => f.regions.length).length;
  $("fileStats").textContent =
    t("counts.containers", { n: m.file.containers.length }) + " · " +
    (m.segments.length > 1
      ? t("movies.fileStatsSegments", {
          n: m.segments.length,
          frames: m.segments.reduce((n, s) => n + s.frames.length, 0),
        }) + " · "
      : "") +
    t("counts.frames", { n: seg.frames.length }) + " " +
    t("movies.fileStatsTail", { waiting, regions, w: seg.width, h: seg.height });
}

function buildMovieFields(): void {
  const m = mov!;
  const seg = segment()!;
  // the action-frame slots name frames, so offer the names the segment has
  const fill = (sel: HTMLSelectElement, value: string): void => {
    sel.replaceChildren();
    const none = document.createElement("option");
    none.value = "";
    none.textContent = "(none)";
    sel.appendChild(none);
    const names = new Set<string>();
    for (const f of seg.frames) {
      if (!f.name || names.has(f.name)) continue;
      names.add(f.name);
      const o = document.createElement("option");
      o.value = f.name;
      o.textContent = f.name;
      sel.appendChild(o);
    }
    // a slot naming a frame that no longer exists still has to be shown
    if (value && !names.has(value)) {
      const o = document.createElement("option");
      o.value = value;
      o.textContent = t("movies.noSuchFrame", { value });
      sel.appendChild(o);
    }
    sel.value = value;
  };
  const a1 = $<HTMLSelectElement>("actionFrame1");
  const a2 = $<HTMLSelectElement>("actionFrame2");
  fill(a1, seg.actionFrame1);
  fill(a2, seg.actionFrame2);
  const apply = (): void => {
    const stored = patchActionFrames(seg, a1.value, a2.value);
    markEdit(t("movies.actionFramesEdit", { a1: stored.actionFrame1 || "-", a2: stored.actionFrame2 || "-" }));
    log(
      t("movies.actionFramesNow", {
        a1: stored.actionFrame1 || t("movies.none"),
        a2: stored.actionFrame2 || t("movies.none"),
      }),
    );
    renderPreview();
  };
  a1.onchange = apply;
  a2.onchange = apply;

  const esc = $<HTMLInputElement>("keySkips");
  esc.checked = seg.keySkips;
  esc.onchange = () => {
    patchKeySkips(seg, esc.checked);
    markEdit(t("movies.escEdit", { value: String(seg.keySkips) }));
    log(
      seg.keySkips
        ? t("movies.escOn")
        : t("movies.escOff"),
    );
  };

  const bed = seg.audioLoops;
  $("movieInfo").innerHTML =
    t("movies.movieInfo", { flags: seg.flags.toString(16), w: seg.width, h: seg.height }) +
    t("counts.chunks", { n: seg.audioChunks.length }) +
    t("movies.audioIn") +
    (bed ? t("movies.audioInTheLoop") : t("movies.audioOneShot")) +
    ", " +
    t("counts.namedSounds", { n: seg.sounds.size }) +
    (bed ? "" : t("movies.audioEventNote")) +
    // a segment with no bed of its own INHERITS the one still playing under it
    (!bed && segIdx > 0 && m.segments[segIdx - 1].audioLoops
      ? t("movies.audioInherited")
      : "") +
    pacingNote(seg);
}

/**
 * What the PLAYER will do with this file — the pacing, in the same words the rule
 * is written in, so that the preview and the game can be seen to agree.
 *
 * Also sets {@link frameMs}, so pressing play here plays what the game plays.
 */
function pacingNote(m: MovSegment): string {
  const hasRegions = m.frames.some((f) => f.regions.length > 0);
  // the same "unique chunks" length the player paces on: a loop table's order
  // usually ends in a repeated tail, and a repeat is not more content
  const seen = new Set<number>();
  let audioSec = 0;
  if (m.audioChunks.length && (!hasRegions || m.audioLoops)) {
    for (const loc of m.audioChunks) {
      if (seen.has(loc)) continue;
      seen.add(loc);
      try {
        const a = decodeAudioContainer(m.file.containers[loc].data);
        audioSec += a.samples.length / a.sampleRate;
      } catch {
        /* a chunk this build cannot decode simply does not count towards the pace */
      }
    }
  }
  const cutsceneAudio = hasRegions ? 0 : audioSec;
  frameMs = chooseFrameInterval(m, m.frames.length, cutsceneAudio, hasRegions);
  if (!frameMs) return t("movies.pacingClicks");
  // the film's OWN runtime, from its authored per-frame holds
  let picture = 0;
  for (let i = 0; i < m.frames.length; i++) picture += frameHoldMs(m, i) / 1000;
  const floorMs = frameHoldMs(m, 0);
  const note = t("movies.pacing", { ms: Math.round(floorMs), fps: (1000 / floorMs).toFixed(1) });
  const why = cutsceneAudio > 0
    ? isBed(cutsceneAudio, m.frames.length)
      ? t("movies.pacingBed", { secs: cutsceneAudio.toFixed(1), picture: picture.toFixed(1) })
      : t("movies.pacingByAudio", { secs: cutsceneAudio.toFixed(1) })
    : "";
  return note + why + (framesLoop(m) ? t("movies.pacingLoops") : "");
}

/**
 * The movie as a state machine: every frame with its action, the frames it can
 * reach, and whether it waits. This is the view the format doc describes and
 * nothing in the port had — reading a MOV frame by frame is how the parked
 * puppet clips the playthrough kept hanging on were finally understood.
 */
function buildFrameList(): void {
  const wrap = $("frames");
  wrap.replaceChildren();
  const m = segment()!;
  const onlyWaits = $<HTMLInputElement>("onlyWaits").checked;
  const filter = $<HTMLInputElement>("frameFilter").value.trim().toLowerCase();
  $("framesInfo").textContent =
    t("movies.framesInfo", { n: m.frames.length });

  let shown = 0;
  m.frames.forEach((f, i) => {
    if (onlyWaits && !f.regions.length) return;
    if (filter && !f.name.toLowerCase().includes(filter)) return;
    if (++shown > 400 && i !== frameIdx) return; // a 4000-frame cutscene is a list nobody reads
    const row = document.createElement("div");
    row.className = "framerow" + (i === frameIdx ? " selected" : "");

    const pick = document.createElement("button");
    pick.className = "mini";
    pick.textContent = i === frameIdx ? "●" : "○";
    pick.title = t("movies.showThisFrame");
    pick.onclick = () => {
      stopPlayback();
      goToFrame(i);
    };
    row.appendChild(pick);

    const lead = document.createElement("span");
    lead.className = "lead";
    lead.textContent = String(i);
    row.appendChild(lead);

    const name = document.createElement("span");
    name.className = "fname";
    name.textContent = f.name || "—";
    row.appendChild(name);

    const badge = document.createElement("span");
    const waits = f.regions.length > 0;
    badge.className = "badge " + (waits ? "anim" : "sel");
    badge.textContent = waits ? `waits (${f.regions.length})` : `type ${f.type}`;
    badge.title = waits
      ? t("movies.stopsHere")
      : actionText(f.type, f.event, f.target);
    row.appendChild(badge);

    const meta = document.createElement("span");
    meta.className = "meta grow";
    const edges = new Set<string>();
    if (!waits && f.target) edges.add(`→${f.target}`);
    if (!waits && f.event) edges.add(`⇒${f.event}`);
    for (const r of f.regions) {
      if (r.target) edges.add(`→${r.target}`);
      if (r.event) edges.add(`⇒${r.event}`);
      if (r.type === 1 || r.type === 3) edges.add("exit");
    }
    meta.textContent =
      [...edges].join(" ") +
      (f.sound ? ` · ♪${f.sound}` : "") +
      (m.actionFrame1.toLowerCase() === f.name.toLowerCase() && f.name ? " · actionframe(1)" : "") +
      (m.actionFrame2.toLowerCase() === f.name.toLowerCase() && f.name ? " · actionframe(2)" : "");
    row.appendChild(meta);

    wrap.appendChild(row);
  });
  if (!shown) {
    const empty = document.createElement("span");
    empty.className = "dim";
    empty.textContent = t("movies.noFrameMatches");
    wrap.appendChild(empty);
  } else if (shown > 400) {
    const note = document.createElement("div");
    note.className = "dim";
    note.textContent = t("movies.showingFirst", { n: shown });
    wrap.appendChild(note);
  }
}

for (const id of ["frameFilter", "onlyWaits"]) {
  $(id).addEventListener("input", () => buildFrameList());
  $(id).addEventListener("change", () => buildFrameList());
}

/** an action-code picker, since 1..7 is the whole vocabulary */
function typeSelect(value: number, onPick: (v: number) => void): HTMLSelectElement {
  const sel = document.createElement("select");
  for (const [code, text] of Object.entries(MOV_ACTIONS)) {
    const o = document.createElement("option");
    o.value = code;
    o.textContent = `${code} — ${text}`;
    sel.appendChild(o);
  }
  if (!MOV_ACTIONS[value]) {
    const o = document.createElement("option");
    o.value = String(value);
    o.textContent = t("movies.notACode", { value });
    sel.appendChild(o);
  }
  sel.value = String(value);
  sel.onchange = () => onPick(Number(sel.value));
  return sel;
}

function buildFrameLogic(): void {
  const wrap = $("frameLogic");
  wrap.replaceChildren();
  const f = frame();
  if (!f) return;

  const nameLabel = document.createElement("label");
  nameLabel.textContent = "name ";
  const name = document.createElement("input");
  name.type = "text";
  name.className = "ident";
  name.value = f.name;
  name.maxLength = MOV_NAME_FIELD;
  name.title = t("movies.frameNameTitle", { max: MOV_NAME_FIELD });
  name.onchange = () => {
    if (name.value === f.name) return;
    const was = f.name;
    const seg = segment()!;
    const stored = patchFrameName(seg, frameIdx, name.value);
    name.value = stored;
    name.classList.add("edited");
    markEdit(`frame ${frameIdx} name → ${stored}`);
    // a target — and an action-frame slot — is a stored STRING, so a rename
    // breaks every reference to the old name rather than following it. Only
    // within this SEGMENT: a jump names a frame of the segment it is in, and
    // the slots are the segment's own.
    const refs = seg.frames.filter(
      (o) =>
        o.target.toLowerCase() === was.toLowerCase() ||
        o.regions.some((r) => r.target.toLowerCase() === was.toLowerCase()),
    ).length;
    const slots = [1, 2].filter(
      (n) =>
        was &&
        (n === 1 ? seg.actionFrame1 : seg.actionFrame2).toLowerCase() === was.toLowerCase(),
    );
    const broken = [
      refs ? t("counts.frames", { n: refs }) + t("movies.stillTargetTail", { was }) : "",
      slots.length ? t("movies.slotsStillName", { n: slots.length, slots: slots.join(") and actionframe(") }) : "",
    ].filter(Boolean);
    log(
      t("movies.frameRenamed", { i: frameIdx, name: stored }) +
        (broken.length
          ? t("movies.frameRenamedBroken", { broken: broken.join(t("movies.brokenJoin")) })
          : ""),
    );
    buildMovieFields();
    buildFrameList();
    renderPreview();
  };
  nameLabel.appendChild(name);
  wrap.appendChild(nameLabel);

  if (!f.locationClickRegion) {
    const note = document.createElement("span");
    note.className = "dim";
    note.textContent =
      t("movies.noLogicContainer");
    wrap.appendChild(note);
    return;
  }

  const typeLabel = document.createElement("label");
  typeLabel.textContent = t("movies.actionLabel");
  typeLabel.title = f.regions.length
    ? t("movies.actionUnusedTitle")
    : t("movies.actionTitle");
  typeLabel.appendChild(
    typeSelect(f.type, (type) => {
      if (!patchFrameLogic(segment()!, frameIdx, { type })) return;
      markEdit(`frame ${frameIdx} type → ${type}`);
      buildFrameList();
      renderPreview();
    }),
  );
  wrap.appendChild(typeLabel);
  if (f.regions.length) {
    const shadow = document.createElement("span");
    shadow.className = "dim";
    shadow.textContent = t("movies.unusedWithRegions");
    wrap.appendChild(shadow);
  }

  for (const [key, label, hint] of [
    ["sound", t("movies.soundLabel"), t("movies.soundHint")],
    ["event", t("movies.eventLabel"), t("movies.eventHint")],
    ["target", t("movies.targetLabel"), t("movies.targetHint")],
  ] as const) {
    const wrapper = document.createElement("label");
    wrapper.textContent = `${label} `;
    const input = document.createElement("input");
    input.type = "text";
    input.className = "ident";
    input.value = f[key];
    input.maxLength = MOV_NAME_FIELD;
    input.title = `${hint} (max ${MOV_NAME_FIELD} characters)`;
    input.onchange = () => {
      if (input.value === f[key]) return;
      if (!patchFrameLogic(segment()!, frameIdx, { [key]: input.value })) return;
      input.value = f[key];
      input.classList.add("edited");
      markEdit(`frame ${frameIdx} ${key} → ${f[key]}`);
      buildFrameList();
      renderPreview();
    };
    wrapper.appendChild(input);
    wrap.appendChild(wrapper);
  }
}

function buildRegions(): void {
  const wrap = $("regions");
  wrap.replaceChildren();
  const f = frame();
  const regions = f?.regions ?? [];
  $("regionsInfo").textContent = f
    ? t("movies.regionsOnFrame", { i: frameIdx, n: regions.length }) +
      (f.locationClickRegion ? t("movies.regionsLogic", { loc: f.locationClickRegion }) : "") +
      t("movies.regionsRects")
    : "";
  if (!regions.length) {
    const empty = document.createElement("span");
    empty.className = "dim";
    empty.textContent =
      t("movies.noRegions");
    wrap.appendChild(empty);
    return;
  }

  regions.forEach((r, i) => {
    const row = document.createElement("div");
    row.className = "regionrow";
    row.onpointerenter = () => {
      hoveredRegion = i;
      drawOverlay();
    };
    row.onpointerleave = () => {
      hoveredRegion = -1;
      drawOverlay();
    };

    const lead = document.createElement("span");
    lead.className = "lead";
    lead.textContent = String(i);
    row.appendChild(lead);

    row.appendChild(
      typeSelect(r.type, (type) => {
        if (!patchRegionLogic(segment()!, f!, r, { type })) return;
        markEdit(`region ${frameIdx}/${i} type → ${type}`);
        buildFrameList();
        drawOverlay();
      }),
    );

    const fields: Record<string, HTMLInputElement> = {};
    for (const [key, label, value] of [
      ["left", "x", r.x0],
      ["top", "y", r.y0],
      ["right", "→x", r.x1],
      ["bottom", "→y", r.y1],
    ] as const) {
      const wrapper = document.createElement("label");
      wrapper.className = "meta";
      wrapper.textContent = label + " ";
      const input = document.createElement("input");
      input.type = "number";
      input.className = "num";
      input.step = "1";
      input.value = String(value);
      fields[key] = input;
      input.onchange = () => {
        patchRegionRect(segment()!, f!, r, {
          top: Number(fields.top.value) || 0,
          left: Number(fields.left.value) || 0,
          bottom: Number(fields.bottom.value) || 0,
          right: Number(fields.right.value) || 0,
        });
        input.classList.add("edited");
        markEdit(`region ${frameIdx}/${i} → ${r.x0},${r.y0}–${r.x1},${r.y1}`);
        drawOverlay();
      };
      wrapper.appendChild(input);
      row.appendChild(wrapper);
    }

    for (const [key, label] of [
      ["sound", "♪"],
      ["event", "⇒"],
      ["target", "→"],
    ] as const) {
      const wrapper = document.createElement("label");
      wrapper.className = "meta";
      wrapper.textContent = label + " ";
      const input = document.createElement("input");
      input.type = "text";
      input.className = "ident short";
      input.value = r[key];
      input.maxLength = MOV_NAME_FIELD;
      input.title =
        key === "sound"
          ? t("movies.soundOnClickHint")
          : key === "event"
            ? t("movies.eventHint")
            : t("movies.targetHint");
      input.onchange = () => {
        if (input.value === r[key]) return;
        if (!patchRegionLogic(segment()!, f!, r, { [key]: input.value })) return;
        input.value = r[key];
        input.classList.add("edited");
        markEdit(`region ${frameIdx}/${i} ${key} → ${r[key]}`);
        buildFrameList();
        drawOverlay();
      };
      wrapper.appendChild(input);
      row.appendChild(wrapper);
    }

    const go = document.createElement("button");
    go.className = "mini";
    go.textContent = "▶ take it";
    go.title = t("movies.doWhatClickDoes");
    go.onclick = () => {
      stopPlayback();
      log(`region ${i}: ${actionText(r.type, r.event, r.target)}`);
      act(r.type, r.target, r.event, `region ${i}`);
    };
    row.appendChild(go);

    wrap.appendChild(row);
  });
}

// --- audio ------------------------------------------------------------------

let audioCtx: AudioContext | null = null;

/**
 * A sound that is playing, and the one question the film loop asks of it: is it
 * over? A frame may be authored to hold until the VOICE channel is idle
 * (MovFrame.waitsForVoice), and a spoken line may name the frame to jump to when
 * it finishes (MovSegment.soundFollows) — neither can be honoured by a preview
 * that starts a buffer and forgets it.
 */
interface Voice {
  done: boolean;
  stop(): void;
}

/** hand PCM to the browser and keep hold of the handle */
function playPcm(samples: Float32Array, rate: number, loop = false): Voice | null {
  if (!samples.length) return null;
  audioCtx ??= new AudioContext();
  const ctx = audioCtx;
  const buf = ctx.createBuffer(1, samples.length, rate);
  buf.getChannelData(0).set(samples);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.loop = loop;
  src.connect(ctx.destination);
  const voice: Voice = {
    done: false,
    stop: () => {
      voice.done = true;
      try {
        src.stop();
      } catch {
        /* already stopped, or never started */
      }
    },
  };
  src.onended = () => {
    voice.done = true;
  };
  src.start();
  return voice;
}

function playChunk(loc: number, label: string): void {
  if (!mov) return;
  try {
    const audio = decodeAudioContainer(mov.file.containers[loc].data);
    playPcm(audio.samples, audio.sampleRate);
    log(
      `${label}: ${(audio.samples.length / audio.sampleRate).toFixed(2)} s at ` +
        `${audio.sampleRate} Hz`,
    );
  } catch (e) {
    log(t("movies.notAudio", { label, message: (e as Error).message }));
  }
}

function buildAudio(): void {
  const wrap = $("audio");
  wrap.replaceChildren();
  const m = segment()!;
  $("audioInfo").textContent = m.audioLoops
    ? t("movies.audioLoopTable")
    : t("movies.audioOneShotBlock");
  const byLoc = new Map<number, string>();
  for (const [name, loc] of m.sounds) byLoc.set(loc, name);
  const rows: { label: string; loc: number }[] = m.audioChunks.map((loc, i) => ({
    label: byLoc.get(loc) ?? `chunk ${i}`,
    loc,
  }));
  for (const [name, loc] of m.sounds) {
    if (!m.audioChunks.includes(loc)) rows.push({ label: name, loc });
  }
  if (!rows.length) {
    const empty = document.createElement("span");
    empty.className = "dim";
    empty.textContent = t("movies.noAudio");
    wrap.appendChild(empty);
    return;
  }
  rows.forEach(({ label, loc }) => {
    const row = document.createElement("div");
    row.className = "audiorow";
    const play = document.createElement("button");
    play.className = "mini";
    play.textContent = "▶";
    play.onclick = () => playChunk(loc, label);
    row.appendChild(play);
    const text = document.createElement("span");
    text.className = "meta grow";
    text.textContent =
      `${label} — container @${loc}, ` +
      `${(m.file.containers[loc]?.data.length ?? 0).toLocaleString()} bytes`;
    row.appendChild(text);
    wrap.appendChild(row);
  });
}

function buildPalette(): void {
  const wrap = $("palette");
  wrap.replaceChildren();
  $("paletteInfo").textContent = t("movies.paletteInfo");
  for (let i = 0; i < 256; i++) {
    const d = document.createElement("div");
    d.style.background = `rgb(${palette[i * 4]},${palette[i * 4 + 1]},${palette[i * 4 + 2]})`;
    d.title = `${i}: rgb(${palette[i * 4]},${palette[i * 4 + 1]},${palette[i * 4 + 2]})`;
    wrap.appendChild(d);
  }
}

// --- PNG export (one way only) ----------------------------------------------

const baseName = (): string => fileName.replace(/\.mov$/i, "").toLowerCase();

$("pngExportBtn").addEventListener("click", () => {
  const f = frame();
  if (!f) return;
  const src = $<HTMLCanvasElement>("preview");
  src.toBlob((blob) => {
    if (blob) download(blob, `${baseName()}.f${frameIdx}${f.name ? `.${f.name}` : ""}.png`);
  }, "image/png");
});

// --- export -----------------------------------------------------------------

function download(blob: Blob, name: string): void {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}

$("exportBtn").addEventListener("click", () => {
  if (!mov) return;
  if (readOnlyV1) {
    log(V1_READ_ONLY);
    return;
  }
  const bytes = writeContainerFile(mov.file);
  try {
    readMovFile(bytes); // sanity: the export must read back as a movie
  } catch (e) {
    log(t("common.exportFailed", { message: (e as Error).message }));
    return;
  }
  download(new Blob([bytes.buffer as ArrayBuffer], { type: "application/octet-stream" }), fileName);
  log(
    t("common.exported", { file: fileName, bytes: formatNumber(bytes.length) }) +
      (edits.length
        ? t("common.exportedWithEdits", { n: edits.length, edits: edits.join(", ") })
        : t("common.exportedUnmodified")),
  );
});

void installI18n();
installGamesMenu();
void installLanguageMenu();
installVersion();
// Which edition's files the landing screen lists, and which copy of a basename an
// edit is written back into: the same row the play page and the collection carry
// (taoot/src/editions.ts). A click reloads, and this page's beforeunload guard is what
// stands between that and unexported edits.
void installSourcePicker(document.getElementById("editionPicker") as HTMLElement);
