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
import { paletteToRGBA } from "@dreamfactory/engine/df/image";
import { byExtension, chosenSource, encodingOf, filesIn, listSources, screenOf, V5_READ_ONLY, isV5File } from "./sources";
import {
  download,
  exportContainerFile,
  fillSwatches,
  installEditorPage,
  paintFrame,
  readImage,
  serverNote,
  serverRow,
  spriteFromImage,
  wireFileOpen,
  wirePngImport,
} from "./editor-kit";
import { detectVersion } from "@dreamfactory/engine/df/version";
import { t, formatNumber } from "@dreamfactory/site/locales";
import { DEFAULT_ENCODING, DfEncoding } from "@dreamfactory/engine/df/text";
import { decodeAudioContainer, decodeAudioV0 } from "@dreamfactory/engine/df/audio";
import { decodeFigureV0, decodeFrameV0 } from "@dreamfactory/engine/df/image-v0";
import { paletteV0 } from "@dreamfactory/engine/df/mov-v0";
import { pupFileFromV0 } from "@dreamfactory/engine/df/talk-v0";
import { scriptToText, sniffScript } from "@dreamfactory/engine/df/script";
import { decodeShpFrame, encodeShpFrame, patchFrameAnchor, ShpFrame } from "@dreamfactory/engine/df/shp";
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
async function chooseSource(): Promise<void> {
  const source = chosenSource(await listSources());
  if (source) screen = screenOf(source);
  if (source) encoding = encodingOf(source);
}
const sourceChosen = chooseSource();

/** a DreamFactory 5 file or a DreamFactory 0 talk file, open read-only */
let readOnly = false;

const V0_READ_ONLY =
  "DreamFactory 0 talk file (Lunicus): shown through the v0 reader, read-only. Nothing writes a v0 talk file.";

/**
 * `v0`: the file is a DreamFactory 0 talk file, which its bytes cannot say (see
 * `GameEditions.dreamFactory0`), so the caller does: one picked from Lunicus's
 * tree is one (`raife.1`, `sasha.3`).
 */
function loadPup(bytes: Uint8Array, name: string, v0 = false): void {
  stopPlayback();
  let parsed: PupFile;
  try {
    parsed = v0 ? pupFileFromV0(bytes) : readPupFile(bytes, encoding);
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
  // a v0 palette is the Macintosh way round, entry 0 white (mov-v0.ts)
  palette = pup.dfV0 ? paletteV0(pup.paletteRaw) : paletteToRGBA(pup.paletteRaw, 256);
  frameCache.clear();
  edits.length = 0;
  // a v5 file reads but cannot be written yet (sources.ts), and a v0 one never
  readOnly = v0 || isV5File(bytes);
  let status = "";
  if (v0) status = V0_READ_ONLY;
  else if (readOnly) status = V5_READ_ONLY;
  dirtyEl.textContent = status;
  // a button that refuses when pressed is worse than one that says so first
  ($("exportBtn") as HTMLButtonElement).disabled = readOnly;
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

wireFileOpen(async (f) => loadPup(new Uint8Array(await f.arrayBuffer()), f.name));

/** dev-server mode: offer every .pup in the gamefiles manifest */
async function initServerPups(): Promise<void> {
  // Only the chosen EDITION's copies: an install with six of them holds six
  // `bedsit1.set`, and listing all six lists the same room six times under
  // names that cannot be told apart. The edition row at the top of the page is
  // what chooses, and it is the same choice the game reads (taoot/src/editions.ts).
  const source = chosenSource(await listSources());
  if (!source) return; // production / no dev server: upload only
  const pups = filesIn(
    source,
    source.game.dreamFactory0
      ? // a v0 talk file is a character and a number, `raife.1` … `guard.7`
        (path) => /\/[a-z]+\.\d$/i.test(path)
      : byExtension(".pup", ".pupp"),
  );
  if (!pups.length) return;
  const wrap = $("serverPups");
  serverNote(wrap, t("common.pickFromGamefiles"));
  serverRow(wrap, {
    source,
    files: pups,
    rowClass: "pups",
    buttonClass: "pup",
    log,
    open: (bytes, f) => loadPup(bytes, f.base, source.game.dreamFactory0 === true),
  });
}
const serverListed = initServerPups();

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
      const data = pup.file.containers[loc].data;
      if (pup.dfV0) {
        // a v0 picture: the backdrop and the head in the frame codec, the rest
        // as figures (lunicus/src/game/talk.ts tries them in that order too);
        // its anchor is where a track's position puts it, as a sprite's offset is
        let v: ReturnType<typeof decodeFrameV0>;
        try {
          v = decodeFrameV0(data);
        } catch {
          v = decodeFigureV0(data);
        }
        f = { width: v.width, height: v.height, posYraw: v.anchorY, posXraw: v.anchorX, indexed: v.indexed, opaque: v.opaque };
      } else f = decodeShpFrame(data);
    } catch {
      return null;
    }
    frameCache.set(loc, f);
  }
  return f;
}

/** paint a decoded frame into a canvas at 1:1, transparent where masked */
const frameToCanvas = (f: ShpFrame, canvas: HTMLCanvasElement): void => paintFrame(f, canvas, palette);

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
      // a v5 sprite brings its own palette; a v4 one is drawn through the puppet's
      const pal = f.palette ?? palette;
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
          rgba[d] = pal[c];
          rgba[d + 1] = pal[c + 1];
          rgba[d + 2] = pal[c + 2];
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
    const data = pup.file.containers[line.audioLocation].data;
    const audio = pup.dfV0 ? decodeAudioV0(data) : decodeAudioContainer(data);
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
    // a v0 puppet's eight layers have no names of their own
    name.textContent = pup?.dfV0 ? `layer ${l}` : `${l} ${PUP_LAYERS[l]}`;
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
      if (f?.width && f.height) {
        frameToCanvas(f, c);
        const scale = Math.min(48 / f.height, 96 / f.width, 3);
        c.style.width = `${Math.max(1, Math.round(f.width * scale))}px`;
        c.style.height = `${Math.max(1, Math.round(f.height * scale))}px`;
      } else {
        c.width = c.height = 16;
        c.style.width = c.style.height = "16px";
      }
      if (selected?.layer === l && selected.idx === idx) c.classList.add("selected");
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

wirePngImport((file) => {
  if (selected) void importPng(file, selected.loc);
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
  const img = await readImage(file, log);
  if (!img) return;
  const frame = spriteFromImage(img, palette, old);
  const oldC = pup.file.containers[loc];
  pup.file.containers[loc] = { id: oldC.id, data: encodeShpFrame(frame) };
  frameCache.delete(loc);
  markEdit(t("puppets.artEdit", { loc, file: file.name }));
  log(t("puppets.artReplaced", { loc, file: file.name, w: img.width, h: img.height }));
  buildLayers();
  renderPreview();
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
  fillSwatches($("palette"), palette);
}

// --- export ---------------------------------------------------------------------

$("exportBtn").addEventListener("click", () => {
  if (!pup) return;
  if (readOnly) {
    log(V5_READ_ONLY);
    return;
  }
  // sanity: the export must read back as a puppet
  exportContainerFile(pup.file, (bytes) => readPupFile(bytes, encoding), fileName, edits, log);
});

void installEditorPage();
await Promise.all([sourceChosen, serverListed]);
