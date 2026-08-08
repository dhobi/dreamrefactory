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
 * would smear every frame after it (see the note in src/df/mov.ts and the test
 * that pins it). Reading is the same code path the game uses (readMovFile/
 * decodeFrame); writing is the patches in src/df/mov.ts, so an untouched load
 * exports the file it read (see tests/auto/mov-editor.ts).
 */
import { FrameBuffer, decodeFrame, indexedToRGBA, paletteToRGBA } from "../src/df/image";
import { installLanguageMenu } from "../src/lang-menu";
import { installVersion } from "../src/version";
import { chosenEdition, editionsIn, gamefileManifest, inChosenEdition, installEditionPicker } from "../src/editions";
import { siteUrl } from "../src/site";
import { t, formatNumber } from "../src/locales";
import { installI18n } from "../src/locales";
import { decodeAudioContainer } from "../src/df/audio";
import { NATIVE_FRAME_MS, chooseFrameInterval, frameHoldMs, framesLoop, isBed } from "../src/df/mov-pace";
import { writeContainerFile } from "../src/df/container";
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
} from "../src/df/mov";
import { SCREEN_H, SCREEN_W } from "../src/screen";

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const landing = $("landing");
const editor = $("editor");
const statusEl = $("status");
const dirtyEl = $("dirty");

/**
 * What this preview will play at, from the SHARED rule (src/df/mov-pace.ts) rather
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
 * The segment on screen — a film is a CHAIN of them (src/df/mov.ts), each with
 * its own palette, frame table, audio and action-frame slots, and this page
 * shows one at a time. It used to show `MovFile`'s own fields, which are
 * segment 0's, so a 13-segment film read as its first fragment and there was
 * no way to reach the rest.
 */
let segIdx = 0;
const segment = (): MovSegment | null => mov?.segments[segIdx] ?? null;
let fileName = "movie.mov";
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
    parsed = readMovFile(bytes);
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
  // what chooses, and it is the same choice the game reads (src/editions.ts).
  const all = await gamefileManifest();
  if (!all.length) return; // production / no dev server: upload only
  const paths = inChosenEdition(all, chosenEdition(editionsIn(all)));
  const movies = paths.filter((p) => p.toLowerCase().endsWith(".mov")).sort();
  if (!movies.length) return;
  const wrap = $("serverMovies");
  const note = document.createElement("div");
  note.className = "note";
  note.textContent = t("common.pickFromGamefilesBig");
  wrap.appendChild(note);
  const row = document.createElement("div");
  row.className = "row movies";
  for (const p of movies) {
    const b = document.createElement("button");
    b.className = "movie";
    const base = p.split("/").pop()!;
    b.textContent = base.toLowerCase();
    b.title = p;
    b.addEventListener("click", async () => {
      log(t("common.loading", { path: p }));
      const r = await fetch(siteUrl(p));
      if (!r.ok) {
        log(t("common.fetchFailed", { path: p, status: r.status }));
        return;
      }
      loadMov(new Uint8Array(await r.arrayBuffer()), base);
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

function paintFrame(): void {
  const canvas = $<HTMLCanvasElement>("preview");
  const w = decoded?.width || segment()?.width || SCREEN_W;
  const h = decoded?.height || segment()?.height || SCREEN_H;
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
  stopPlayback();
  const r = f.regions[idx];
  log(
    `region ${idx} at (${x},${y}): ${actionText(r.type, r.event, r.target)}` +
      (r.sound ? ` · plays “${r.sound}”` : ""),
  );
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
    // will (src/df/mov-pace.ts frameHoldMs); frameMs is the fallback for a movie
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

function playChunk(loc: number, label: string): void {
  if (!mov) return;
  try {
    const audio = decodeAudioContainer(mov.file.containers[loc].data);
    audioCtx ??= new AudioContext();
    const buf = audioCtx.createBuffer(1, audio.samples.length, audio.sampleRate);
    buf.getChannelData(0).set(audio.samples);
    const src = audioCtx.createBufferSource();
    src.buffer = buf;
    src.connect(audioCtx.destination);
    src.start();
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
void installLanguageMenu();
installVersion();
// Which edition's files the landing screen lists, and which copy of a basename an
// edit is written back into: the same row the play page and the collection carry
// (src/editions.ts). A click reloads, and this page's beforeunload guard is what
// stands between that and unexported edits.
void installEditionPicker(document.getElementById("editionPicker") as HTMLElement);
