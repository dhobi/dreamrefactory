/**
 * Puppet Editor (puppets.html) — a standalone dev tool over the DF library:
 * load a .PUP conversation puppet (upload, drag-and-drop, or pick one from
 * the dev server's gamefiles manifest), browse its parts — stances and their
 * 11 sprite layers, dialogue lines with voice audio and animLogic, scripts,
 * palette — edit what is editable (subtitle text, frame art via PNG
 * round-trip, stored frame offsets), and export the repacked file.
 *
 * Reading is the same code path the game uses (readPupFile/decodeShpFrame);
 * writing is writeContainerFile/encodeShpFrame from engine/src/df, so an untouched
 * load exports the same structure it read (see taoot/tests/auto/pup-editor.ts).
 */
import { indexedToRGBA, paletteToRGBA } from "@dreamfactory/engine/df/image";
import { installGamesMenu } from "@dreamfactory/site/games-menu";
import { installLanguageMenu } from "@dreamfactory/site/lang-menu";
import { installVersion } from "@dreamfactory/site/version";
import { byExtension, chosenSource, encodingOf, filesIn, installSourcePicker, listSources, screenOf } from "./sources";
import { detectVersion } from "@dreamfactory/engine/df/version";
import { siteUrl } from "@dreamfactory/site/site";
import { t, formatNumber } from "@dreamfactory/site/locales";
import { installI18n } from "@dreamfactory/site/locales";
import { DEFAULT_ENCODING, DfEncoding } from "@dreamfactory/engine/df/text";
import { decodeAudioContainer } from "@dreamfactory/engine/df/audio";
import { scriptToText, sniffScript } from "@dreamfactory/engine/df/script";
import { decodeShpFrame, encodeShpFrame, patchFrameAnchor, ShpFrame } from "@dreamfactory/engine/df/shp";
import { writeContainerFile } from "@dreamfactory/engine/df/container";
import {
  PUP_LAYERS,
  PupAnimFrame,
  PupFile,
  patchDialogueText,
  readAnimLogic,
  readPupFile,
} from "@dreamfactory/engine/df/pup";
import type { GameScreen } from "@dreamfactory/site/games";

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const landing = $("landing");
const editor = $("editor");
const statusEl = $("status");
const dirtyEl = $("dirty");

// --- editor state -----------------------------------------------------------

let pup: PupFile | null = null;
let fileName = "puppet.pup";
let palette: Uint8ClampedArray = new Uint8ClampedArray(1024);
/** decoded frames by container location (one pup open at a time) */
const frameCache = new Map<number, ShpFrame>();
/** human-readable notes of every edit, shown next to the export button */
const edits: string[] = [];
/** which stance the layer browser is showing (the stance select) */
let stanceIdx = 0;
let selected: { layer: number; idx: number; loc: number } | null = null;
/** the running "play line" animation, if any */
let playing: { stop: () => void } | null = null;

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

// --- loading ----------------------------------------------------------------

/**
 * The code page this page's subtitles are in. Resolved from the language picker
 * once, at start-up, because no puppet file says (engine/src/df/text.ts) — it decides
 * both what the dialogue list shows and what an edit writes back.
 */
/**
 * The screen a stance composites over — the game's, because a PUP records none.
 * See `screenOf`, and the note on the same field in `shp-editor.ts`.
 */
let screen: GameScreen = screenOf(null);

let encoding: DfEncoding = DEFAULT_ENCODING;
void (async () => {
  const source = chosenSource(await listSources());
  if (source) screen = screenOf(source);
  if (source) encoding = encodingOf(source);
})();

function loadPup(bytes: Uint8Array, name: string): void {
  stopPlayback();
  let parsed: PupFile;
  try {
    parsed = readPupFile(bytes, encoding);
  } catch (e) {
    // Say WHICH engine wrote it when the read fails.
    //
    // Dust's own puppets do NOT fail: this format did not change between
    // DreamFactory 1 and 4, so the reader above opens them directly, with no
    // conversion and nothing to add here (blood.pup: 438 containers, 167 dialogue lines).
    // SET and MOV did change and go through the engine's v1->v4 conversion
    // instead; see the note on `readOnlyV1` in the set and movie editors.
    //
    // So this branch is for a container that is neither — and there, "not
    // readable" alone reads as a corrupt file rather than an unimplemented
    // format. The version is one i32 at a known offset, so asking costs nothing.
    const why =
      detectVersion(bytes) === 1
        ? `DreamFactory 1 container — this port reads DreamFactory 4 puppets only`
        : (e as Error).message;
    log(t("common.notReadable", { ext: ".pup", message: why }));
    return;
  }
  pup = parsed;
  fileName = name;
  palette = paletteToRGBA(pup.paletteRaw, 256);
  frameCache.clear();
  edits.length = 0;
  dirtyEl.textContent = "";
  stanceIdx = 0;
  selected = null;

  landing.style.display = "none";
  editor.style.display = "flex";
  $("fileName").textContent = name;
  const frames = pup.stances.reduce(
    (n, s) => n + s.layers.reduce((m, l) => m + l.frames.length, 0),
    0,
  );
  $("fileStats").textContent =
    t("puppets.fileStats", {
      containers: pup.file.containers.length,
      lines: pup.dialogue.size,
      scripts: pup.scripts.length,
      stances: pup.stances.length,
      frames,
    });
  log("");

  buildStanceSelect();
  buildLineSelect();
  buildLayers();
  buildDialogue();
  buildScripts();
  buildPalette();
  renderPreview();
}

async function loadFromFile(file: File): Promise<void> {
  loadPup(new Uint8Array(await file.arrayBuffer()), file.name);
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

/** dev-server mode: offer every .pup in the gamefiles manifest */
async function initServerPups(): Promise<void> {
  // Only the chosen EDITION's copies: an install with six of them holds six
  // `bedsit1.set`, and listing all six lists the same room six times under
  // names that cannot be told apart. The edition row at the top of the page is
  // what chooses, and it is the same choice the game reads (taoot/src/editions.ts).
  const source = chosenSource(await listSources());
  if (!source) return; // production / no dev server: upload only
  const pups = filesIn(source, byExtension(".pup"));
  if (!pups.length) return;
  const wrap = $("serverPups");
  const note = document.createElement("div");
  note.className = "note";
  note.textContent = t("common.pickFromGamefiles");
  wrap.appendChild(note);
  const row = document.createElement("div");
  row.className = "row pups";
  for (const f of pups) {
    const b = document.createElement("button");
    b.className = "pup";
    b.textContent = f.base;
    b.title = `${source.game.short} · ${f.path}`;
    b.addEventListener("click", async () => {
      log(t("common.loading", { path: f.path }));
      const r = await fetch(f.url);
      if (!r.ok) {
        log(t("common.fetchFailed", { path: f.path, status: r.status }));
        return;
      }
      loadPup(new Uint8Array(await r.arrayBuffer()), f.base);
    });
    row.appendChild(b);
  }
  wrap.appendChild(row);
}
void initServerPups();

$("closeBtn").addEventListener("click", () => {
  if (edits.length && !confirm(t("counts.discardEdits", { n: edits.length }))) return;
  stopPlayback();
  pup = null;
  edits.length = 0;
  editor.style.display = "none";
  landing.style.display = "block";
});

// --- frames -----------------------------------------------------------------

function frameAt(loc: number): ShpFrame | null {
  if (!pup) return null;
  let f = frameCache.get(loc) ?? null;
  if (!f) {
    try {
      f = decodeShpFrame(pup.file.containers[loc].data);
    } catch {
      return null;
    }
    frameCache.set(loc, f);
  }
  return f;
}

/** paint a decoded frame into a canvas at 1:1, transparent where masked */
function frameToCanvas(f: ShpFrame, canvas: HTMLCanvasElement): void {
  canvas.width = Math.max(1, f.width);
  canvas.height = Math.max(1, f.height);
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!f.width || !f.height) return;
  const img = ctx.createImageData(f.width, f.height);
  indexedToRGBA(f.indexed, f.width, f.height, palette, img.data);
  for (let i = 0; i < f.width * f.height; i++) {
    if (!f.opaque[i]) img.data[i * 4 + 3] = 0;
  }
  ctx.putImageData(img, 0, 0);
}

// --- preview compositor -------------------------------------------------------

/**
 * The stance a preview composites against: a line's own (PupDialogue.stance —
 * in a two-character puppet it says which face the animated mouth belongs to),
 * or the stance select when no line is picked.
 */
function stanceForLine(ident: string | null): number {
  const line = ident && pup ? pup.dialogue.get(ident) : undefined;
  return line?.stance ?? stanceIdx;
}

/** the neutral pose of a line: the first record of its animLogic */
function poseForLine(ident: string | null): PupAnimFrame | null {
  if (!pup) return null;
  const line = ident ? pup.dialogue.get(ident) : undefined;
  if (line) {
    const pose = readAnimLogic(pup, line.animLogicLocation)[0];
    if (pose) return pose;
  }
  // fallback: frame 0 of every populated layer at the view centre, matching
  // where the background plate sits (see engine/src/df/pup.ts)
  const stance = pup.stances[stanceIdx];
  return {
    layers: PUP_LAYERS.map((_, l) => ({
      frame: stance?.layers[l]?.frames.length ? 0 : -1,
      y: 132,
      x: 256,
    })),
  };
}

/**
 * Composite one animLogic record over a dark backdrop — the same layering
 * rule as the in-game PuppetView (record anchor minus the frame's stored
 * offset; a flat single-colour background layer is a key-colour matte and is
 * skipped so it doesn't paint over the whole screen).
 */
function composite(state: PupAnimFrame, ctx: CanvasRenderingContext2D, stanceOf = stanceIdx): void {
  if (!pup) return;
  const img = ctx.createImageData(screen.width, screen.height);
  const rgba = new Uint8ClampedArray(img.data.buffer);
  for (let i = 0; i < screen.width * screen.height; i++) {
    rgba[i * 4] = 18;
    rgba[i * 4 + 1] = 17;
    rgba[i * 4 + 2] = 20;
    rgba[i * 4 + 3] = 255;
  }
  const stance = pup.stances[stanceOf] ?? pup.stances[0];
  if (stance) {
    for (let l = 0; l < PUP_LAYERS.length; l++) {
      const st = state.layers[l];
      const layer = stance.layers[l];
      if (!st || st.frame < 0 || !layer?.frames.length) continue;
      const loc = layer.frames[Math.min(st.frame, layer.frames.length - 1)];
      const f = frameAt(loc);
      if (!f) continue;
      if (l === 0) {
        let flat = true;
        const first = f.indexed[0];
        for (let i = 1; i < f.width * f.height; i++) {
          if (f.opaque[i] && f.indexed[i] !== first) {
            flat = false;
            break;
          }
        }
        if (flat) continue;
      }
      const dx = st.x - f.posXraw;
      const dy = st.y - f.posYraw;
      for (let yy = 0; yy < f.height; yy++) {
        const ty = dy + yy;
        if (ty < 0 || ty >= screen.height) continue;
        for (let xx = 0; xx < f.width; xx++) {
          const tx = dx + xx;
          if (tx < 0 || tx >= screen.width) continue;
          const s = yy * f.width + xx;
          if (!f.opaque[s]) continue;
          const c = f.indexed[s] * 4;
          const d = (ty * screen.width + tx) * 4;
          rgba[d] = palette[c];
          rgba[d + 1] = palette[c + 1];
          rgba[d + 2] = palette[c + 2];
        }
      }
    }
  }
  ctx.putImageData(img, 0, 0);
}

function renderPreview(): void {
  if (!pup) return;
  const ctx = $<HTMLCanvasElement>("preview").getContext("2d")!;
  const ident = $<HTMLSelectElement>("lineSel").value || null;
  const pose = poseForLine(ident);
  if (pose) composite(pose, ctx, stanceForLine(ident));
  const line = ident ? pup.dialogue.get(ident) : undefined;
  $("previewInfo").textContent = line
    ? `${line.ident} — stance ${line.stance}, audio @${line.audioLocation}, ` +
      `animLogic @${line.animLogicLocation} ` +
      `(${readAnimLogic(pup, line.animLogicLocation).length} ticks)`
    : "";
}

// --- playback ----------------------------------------------------------------

let audioCtx: AudioContext | null = null;

function stopPlayback(): void {
  playing?.stop();
  playing = null;
  $("playBtn").textContent = t("puppets.playLine");
}

$("playBtn").addEventListener("click", () => {
  if (playing) {
    stopPlayback();
    renderPreview();
    return;
  }
  if (!pup) return;
  const ident = $<HTMLSelectElement>("lineSel").value;
  const line = pup.dialogue.get(ident);
  if (!line) return;
  const frames = readAnimLogic(pup, line.animLogicLocation);
  const ctx = $<HTMLCanvasElement>("preview").getContext("2d")!;

  let source: AudioBufferSourceNode | null = null;
  try {
    const audio = decodeAudioContainer(pup.file.containers[line.audioLocation].data);
    audioCtx ??= new AudioContext();
    const buf = audioCtx.createBuffer(1, audio.samples.length, audio.sampleRate);
    buf.getChannelData(0).set(audio.samples);
    source = audioCtx.createBufferSource();
    source.buffer = buf;
    source.connect(audioCtx.destination);
    source.start();
  } catch {
    source = null; // no/undecodable audio: play the animation silently
  }

  // ~30 records/s, like the in-game playback; hold the last record when done
  const start = performance.now();
  let raf = 0;
  const step = (): void => {
    const idx = Math.min(Math.floor((performance.now() - start) / 33.4), frames.length - 1);
    if (frames[idx]) composite(frames[idx], ctx, line.stance);
    if (idx < frames.length - 1) raf = requestAnimationFrame(step);
    else if (!source) stopPlayback();
  };
  if (frames.length) raf = requestAnimationFrame(step);
  if (source) source.addEventListener("ended", () => stopPlayback());
  playing = {
    stop: () => {
      cancelAnimationFrame(raf);
      try {
        source?.stop();
      } catch {
        /* already ended */
      }
    },
  };
  $("playBtn").textContent = "◼ Stop";
});

// --- stance browser ------------------------------------------------------------

function buildStanceSelect(): void {
  const sel = $<HTMLSelectElement>("stanceSel");
  sel.innerHTML = "";
  pup!.stances.forEach((s, i) => {
    const o = document.createElement("option");
    o.value = String(i);
    const n = s.layers.reduce((m, l) => m + l.frames.length, 0);
    o.textContent = `${i} (${n} frames)`;
    sel.appendChild(o);
  });
  sel.onchange = () => {
    stanceIdx = Number(sel.value);
    selected = null;
    buildLayers();
    renderPreview();
  };
}

function buildLineSelect(): void {
  const sel = $<HTMLSelectElement>("lineSel");
  sel.innerHTML = "";
  for (const [key, line] of pup!.dialogue) {
    const o = document.createElement("option");
    o.value = key;
    const t = line.text.length > 36 ? line.text.slice(0, 35) + "…" : line.text;
    o.textContent = `${line.ident} — ${t}`;
    sel.appendChild(o);
  }
  sel.onchange = () => {
    stopPlayback();
    renderPreview();
  };
}

function buildLayers(): void {
  const wrap = $("layers");
  wrap.innerHTML = "";
  $("framePanel").style.display = "none";
  const stance = pup!.stances[stanceIdx];
  $("stanceInfo").textContent = stance ? `stance ${stanceIdx}, container @${stance.location}` : "no stances";
  if (!stance) return;
  stance.layers.forEach((layer, l) => {
    const row = document.createElement("div");
    row.className = "layerrow";
    const name = document.createElement("span");
    name.className = "lname";
    name.textContent = `${l} ${PUP_LAYERS[l]}`;
    row.appendChild(name);
    const thumbs = document.createElement("div");
    thumbs.className = "thumbs";
    if (!layer.frames.length) {
      const dash = document.createElement("span");
      dash.textContent = "—";
      dash.style.color = "#4f7a9c";
      thumbs.appendChild(dash);
    }
    layer.frames.forEach((loc, idx) => {
      const f = frameAt(loc);
      const c = document.createElement("canvas");
      c.className = "thumb";
      c.title = `frame ${idx} @${loc}` + (f ? ` — ${f.width}×${f.height}` : " — undecodable");
      if (f && f.width && f.height) {
        frameToCanvas(f, c);
        const scale = Math.min(48 / f.height, 96 / f.width, 3);
        c.style.width = `${Math.max(1, Math.round(f.width * scale))}px`;
        c.style.height = `${Math.max(1, Math.round(f.height * scale))}px`;
      } else {
        c.width = c.height = 16;
        c.style.width = c.style.height = "16px";
      }
      if (selected && selected.layer === l && selected.idx === idx) c.classList.add("selected");
      c.addEventListener("click", () => {
        selected = { layer: l, idx, loc };
        buildLayers();
        showFramePanel();
      });
      thumbs.appendChild(c);
    });
    row.appendChild(thumbs);
    wrap.appendChild(row);
  });
  if (selected) showFramePanel();
}

function showFramePanel(): void {
  const panel = $("framePanel");
  if (!selected) {
    panel.style.display = "none";
    return;
  }
  const f = frameAt(selected.loc);
  panel.style.display = "flex";
  const big = $<HTMLCanvasElement>("frameBig");
  if (f) {
    frameToCanvas(f, big);
    const scale = Math.max(1, Math.min(4, Math.floor(160 / Math.max(f.height, 1))));
    big.style.width = `${f.width * scale}px`;
    big.style.height = `${f.height * scale}px`;
    $("frameInfo").innerHTML =
      t("puppets.frameInfo", {
        layer: PUP_LAYERS[selected.layer],
        i: selected.idx,
        loc: selected.loc,
        w: f.width,
        h: f.height,
        bytes: formatNumber(pup!.file.containers[selected.loc].data.length),
      });
    $<HTMLInputElement>("posX").value = String(f.posXraw);
    $<HTMLInputElement>("posY").value = String(f.posYraw);
  } else {
    $("frameInfo").textContent = t("puppets.frameNotDecodable", { loc: selected.loc });
  }
}

/** patch the two stored-offset shorts of a frame container (copy-on-write) */
function patchFrameOffset(loc: number, y: number, x: number): void {
  if (!patchFrameAnchor(pup!.file, loc, y, x)) return;
  frameCache.delete(loc);
  markEdit(`offset @${loc} → ${y},${x}`);
  renderPreview();
  showFramePanel();
}

for (const id of ["posX", "posY"]) {
  $<HTMLInputElement>(id).addEventListener("change", () => {
    if (!selected) return;
    const f = frameAt(selected.loc);
    if (!f) return;
    const y = Number($<HTMLInputElement>("posY").value) || 0;
    const x = Number($<HTMLInputElement>("posX").value) || 0;
    if (y === f.posYraw && x === f.posXraw) return;
    patchFrameOffset(selected.loc, y, x);
  });
}

// --- PNG round trip -----------------------------------------------------------

$("pngExportBtn").addEventListener("click", () => {
  if (!selected) return;
  const f = frameAt(selected.loc);
  if (!f) return;
  const c = document.createElement("canvas");
  frameToCanvas(f, c);
  c.toBlob((blob) => {
    if (!blob) return;
    const base = fileName.replace(/\.pup$/i, "").toLowerCase();
    download(blob, `${base}.s${stanceIdx}.${PUP_LAYERS[selected!.layer]}.f${selected!.idx}.png`);
  }, "image/png");
});

const pngInput = $<HTMLInputElement>("pngInput");
$("pngImportBtn").addEventListener("click", () => pngInput.click());
pngInput.addEventListener("change", () => {
  const file = pngInput.files?.[0];
  pngInput.value = "";
  if (file && selected) void importPng(file, selected.loc);
});

/**
 * Replace a frame's art with an image file: pixels are matched to the
 * puppet's palette (nearest RGB), alpha < 128 becomes transparent, and the
 * container's stored offset is kept so the art stays anchored. Every stance
 * state that references this container shows the new art.
 */
async function importPng(file: File, loc: number): Promise<void> {
  if (!pup) return;
  const old = frameAt(loc);
  let bmp: ImageBitmap;
  try {
    bmp = await createImageBitmap(file);
  } catch {
    log(t("common.notAnImage", { file: file.name }));
    return;
  }
  const c = document.createElement("canvas");
  c.width = bmp.width;
  c.height = bmp.height;
  const ctx = c.getContext("2d")!;
  ctx.drawImage(bmp, 0, 0);
  const img = ctx.getImageData(0, 0, bmp.width, bmp.height);

  const indexed = new Uint8Array(bmp.width * bmp.height);
  const opaque = new Uint8Array(bmp.width * bmp.height);
  for (let i = 0; i < indexed.length; i++) {
    if (img.data[i * 4 + 3] < 128) continue;
    opaque[i] = 1;
    indexed[i] = nearestPaletteIndex(img.data[i * 4], img.data[i * 4 + 1], img.data[i * 4 + 2]);
  }
  const frame: ShpFrame = {
    width: bmp.width,
    height: bmp.height,
    posYraw: old?.posYraw ?? 0,
    posXraw: old?.posXraw ?? 0,
    indexed,
    opaque,
  };
  const oldC = pup.file.containers[loc];
  pup.file.containers[loc] = { id: oldC.id, data: encodeShpFrame(frame) };
  frameCache.delete(loc);
  markEdit(t("puppets.artEdit", { loc, file: file.name }));
  log(t("puppets.artReplaced", { loc, file: file.name, w: bmp.width, h: bmp.height }));
  buildLayers();
  renderPreview();
}

function nearestPaletteIndex(r: number, g: number, b: number): number {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < 256; i++) {
    const dr = palette[i * 4] - r;
    const dg = palette[i * 4 + 1] - g;
    const db = palette[i * 4 + 2] - b;
    const d = dr * dr + dg * dg + db * db;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

// --- dialogue ------------------------------------------------------------------

function buildDialogue(): void {
  const wrap = $("dialogue");
  wrap.innerHTML = "";
  $("dlgInfo").textContent = t("puppets.dlgInfo", { n: pup!.dialogue.size });
  for (const [key, line] of pup!.dialogue) {
    const row = document.createElement("div");
    row.className = "dlgrow";
    const ident = document.createElement("span");
    ident.className = "ident";
    ident.textContent = line.ident;
    row.appendChild(ident);
    const input = document.createElement("input");
    input.type = "text";
    input.maxLength = 255;
    input.value = line.text;
    input.addEventListener("change", () => {
      if (input.value === line.text) return;
      patchDialogueText(pup!, key, input.value);
      input.classList.add("edited");
      markEdit(`text ${line.ident}`);
      buildLineSelect();
    });
    row.appendChild(input);
    const play = document.createElement("button");
    play.textContent = "▶";
    play.title = t("puppets.playThisLine");
    play.addEventListener("click", () => {
      stopPlayback();
      $<HTMLSelectElement>("lineSel").value = key;
      renderPreview();
      $("playBtn").click();
    });
    row.appendChild(play);
    wrap.appendChild(row);
  }
}

// --- scripts -------------------------------------------------------------------

function buildScripts(): void {
  const wrap = $("scripts");
  wrap.innerHTML = "";
  for (const s of pup!.scripts) {
    const det = document.createElement("details");
    det.className = "script";
    const sum = document.createElement("summary");
    sum.textContent = `${s.name} (container @${s.location})`;
    det.appendChild(sum);
    const pre = document.createElement("pre");
    const tokens = sniffScript(pup!.file.containers[s.location]?.data ?? new Uint8Array(0));
    pre.textContent = tokens ? scriptToText(tokens) : t("common.notAScript");
    det.appendChild(pre);
    wrap.appendChild(det);
  }
}

// --- palette --------------------------------------------------------------------

function buildPalette(): void {
  const wrap = $("palette");
  wrap.innerHTML = "";
  for (let i = 0; i < 256; i++) {
    const d = document.createElement("div");
    d.style.background = `rgb(${palette[i * 4]},${palette[i * 4 + 1]},${palette[i * 4 + 2]})`;
    d.title = `${i}: rgb(${palette[i * 4]},${palette[i * 4 + 1]},${palette[i * 4 + 2]})`;
    wrap.appendChild(d);
  }
}

// --- export ---------------------------------------------------------------------

function download(blob: Blob, name: string): void {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}

$("exportBtn").addEventListener("click", () => {
  if (!pup) return;
  const bytes = writeContainerFile(pup.file);
  try {
    readPupFile(bytes, encoding); // sanity: the export must read back as a puppet
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
