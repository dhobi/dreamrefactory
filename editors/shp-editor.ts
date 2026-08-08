/**
 * Shop Editor (shops.html) — the fourth of the browser editors over the DF
 * library, for the format that holds everything drawn ON TOP of a room: load a
 * .SHP "shop" (upload, drag-and-drop, or pick one from the dev server's
 * gamefiles manifest), take it apart into what a shop is made of — prop groups,
 * each group's named states, each state's animation frames with their stored
 * draw offsets and degrees, the scripts and the palette — edit what is editable,
 * and export the repacked file.
 *
 * Editable: the shop's own name, every prop's name, every state identifier,
 * every frame's stored anchor offset and degree, and any frame's art via PNG
 * round-trip. Reading is the same code path the game uses (readShpFile/
 * decodeShpFrame); writing is the patches in src/df/shp.ts plus encodeShpFrame/
 * writeContainerFile, so an untouched load exports the file it read (see
 * tests/auto/shp-editor.ts).
 */
import { indexedToRGBA, paletteToRGBA } from "../src/df/image";
import { installLanguageMenu } from "../src/lang-menu";
import { chosenEdition, editionsIn, gamefileManifest, inChosenEdition, installEditionPicker } from "../src/editions";
import { siteUrl } from "../src/site";
import { t, formatNumber } from "../src/locales";
import { installI18n } from "../src/locales";
import { scriptToText, sniffScript } from "../src/df/script";
import { writeContainerFile } from "../src/df/container";
import {
  GROUP_NAME_FIELD,
  PropState,
  SHOP_REF_NAME_FIELD,
  STATE_ID_FIELD,
  ShpFile,
  ShpFrame,
  decodeShpFrame,
  encodeShpFrame,
  patchFrameAnchor,
  patchFrameDegree,
  patchGroupName,
  patchShopRefName,
  patchStateIdentifier,
  readShpFile,
} from "../src/df/shp";
import { SCREEN_W, SCREEN_H } from "../src/screen";

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const landing = $("landing");
const editor = $("editor");
const statusEl = $("status");
const dirtyEl = $("dirty");

/** the cadence props animate at — PropRuntime.tick's frameMs (src/viewer.ts) */
const FRAME_MS = 90;
/** where a prop draws before any propxy: the centre of the 512×384 screen */
const DEFAULT_ANCHOR_X = 256;
const DEFAULT_ANCHOR_Y = 192;
/** the set view fills the screen down to here; the UI band is below it */
const BAND_TOP = 264;

// --- editor state -----------------------------------------------------------

let shp: ShpFile | null = null;
let fileName = "props.shp";
let palette: Uint8ClampedArray = new Uint8ClampedArray(1024);
/** decoded frames by container location (one shop open at a time) */
const frameCache = new Map<number, ShpFrame>();
/** human-readable notes of every edit, shown next to the export button */
const edits: string[] = [];
let groupIdx = 0;
let stateIdx = 0;
let frameIdx = 0;
/** the anchor the preview draws at — propxy, simulated */
const anchor = { x: DEFAULT_ANCHOR_X, y: DEFAULT_ANCHOR_Y };
/** the running state animation, if any */
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

const group = () => shp!.groups[groupIdx];
const state = (): PropState | undefined => group()?.states[stateIdx];
const frameLoc = (): number | undefined => state()?.frames[frameIdx];

// --- loading ----------------------------------------------------------------

function loadShp(bytes: Uint8Array, name: string): void {
  stopPlayback();
  let parsed: ShpFile;
  try {
    parsed = readShpFile(bytes);
  } catch (e) {
    log(t("common.notReadable", { ext: ".shp", message: (e as Error).message }));
    return;
  }
  shp = parsed;
  fileName = name;
  palette = paletteToRGBA(parsed.paletteRaw, 256);
  frameCache.clear();
  edits.length = 0;
  dirtyEl.textContent = "";
  groupIdx = 0;
  stateIdx = 0;
  frameIdx = 0;
  anchor.x = DEFAULT_ANCHOR_X;
  anchor.y = DEFAULT_ANCHOR_Y;

  landing.style.display = "none";
  editor.style.display = "flex";
  $("fileName").textContent = name;
  log("");
  buildGroupSelect();
  refresh();
}

async function loadFromFile(f: File): Promise<void> {
  loadShp(new Uint8Array(await f.arrayBuffer()), f.name);
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

/** dev-server mode: offer every .shp in the gamefiles manifest */
async function initServerShops(): Promise<void> {
  // Only the chosen EDITION's copies: an install with six of them holds six
  // `bedsit1.set`, and listing all six lists the same room six times under
  // names that cannot be told apart. The edition row at the top of the page is
  // what chooses, and it is the same choice the game reads (src/editions.ts).
  const all = await gamefileManifest();
  if (!all.length) return; // production / no dev server: upload only
  const paths = inChosenEdition(all, chosenEdition(editionsIn(all)));
  const shops = paths.filter((p) => p.toLowerCase().endsWith(".shp")).sort();
  if (!shops.length) return;
  const wrap = $("serverShops");
  const note = document.createElement("div");
  note.className = "note";
  note.textContent = t("common.pickFromGamefiles");
  wrap.appendChild(note);
  const row = document.createElement("div");
  row.className = "row shops";
  for (const p of shops) {
    const b = document.createElement("button");
    b.className = "shop";
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
      loadShp(new Uint8Array(await r.arrayBuffer()), base);
    });
    row.appendChild(b);
  }
  wrap.appendChild(row);
}
void initServerShops();

$("closeBtn").addEventListener("click", () => {
  if (edits.length && !confirm(t("counts.discardEdits", { n: edits.length }))) return;
  stopPlayback();
  shp = null;
  edits.length = 0;
  frameCache.clear();
  editor.style.display = "none";
  landing.style.display = "block";
});

// --- frames -----------------------------------------------------------------

function frameAt(loc: number): ShpFrame | null {
  if (!shp) return null;
  let f = frameCache.get(loc) ?? null;
  if (!f) {
    try {
      f = decodeShpFrame(shp.file.containers[loc].data);
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

// --- preview ----------------------------------------------------------------

/**
 * Draw one frame where the engine would put it: at `anchor - storedOffset` on
 * the 512×384 screen (see the placement rule in docs/formats/shp.md), over a
 * backdrop that marks the room view / UI band split and the anchor itself. The
 * anchor is what `propxy` moves, so the two inputs beside the canvas are that
 * command, simulated.
 */
function drawScreen(f: ShpFrame | null): void {
  const canvas = $<HTMLCanvasElement>("preview");
  canvas.width = SCREEN_W;
  canvas.height = SCREEN_H;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#00060f";
  ctx.fillRect(0, 0, SCREEN_W, BAND_TOP);
  ctx.fillStyle = "#000d1f";
  ctx.fillRect(0, BAND_TOP, SCREEN_W, SCREEN_H - BAND_TOP);
  ctx.strokeStyle = "#0a2d52";
  ctx.beginPath();
  ctx.moveTo(0, BAND_TOP + 0.5);
  ctx.lineTo(SCREEN_W, BAND_TOP + 0.5);
  ctx.stroke();

  if (f && f.width && f.height) {
    const dx = anchor.x - f.posXraw;
    const dy = anchor.y - f.posYraw;
    const off = document.createElement("canvas");
    frameToCanvas(f, off);
    ctx.drawImage(off, dx, dy);
    ctx.strokeStyle = "rgba(176,138,62,0.75)";
    ctx.strokeRect(dx - 0.5, dy - 0.5, f.width + 1, f.height + 1);
  }

  // the anchor cross: where propxy puts the prop
  ctx.strokeStyle = "rgba(242,232,205,0.5)";
  ctx.beginPath();
  ctx.moveTo(anchor.x - 6, anchor.y + 0.5);
  ctx.lineTo(anchor.x + 6, anchor.y + 0.5);
  ctx.moveTo(anchor.x + 0.5, anchor.y - 6);
  ctx.lineTo(anchor.x + 0.5, anchor.y + 6);
  ctx.stroke();
}

function renderPreview(): void {
  if (!shp) return;
  const st = state();
  const loc = frameLoc();
  const f = loc === undefined ? null : frameAt(loc);
  drawScreen(f);
  const packed = loc === undefined ? 0 : (shp.file.containers[loc]?.data.length ?? 0);
  $("previewInfo").innerHTML = st
    ? t("shops.previewHead", {
        name: group().name || t("shops.unnamedProp"),
        state: st.identifier,
        i: frameIdx + 1,
        n: st.frames.length,
      }) +
      (loc === undefined ? "" : t("shops.previewContainer", { loc })) +
      (f
        ? t("shops.previewSize", {
            w: f.width,
            h: f.height,
            y: f.posYraw,
            x: f.posXraw,
            dx: anchor.x - f.posXraw,
            dy: anchor.y - f.posYraw,
          }) +
          t("shops.previewPacked", {
            bytes: formatNumber(packed),
            deg: st.degrees[frameIdx] ?? 0,
            ref: st.refScales[frameIdx] ?? 0,
          })
        : t("shops.previewNotFrame"))
    : t("shops.noStates");
}

for (const [id, key] of [
  ["anchorX", "x"],
  ["anchorY", "y"],
] as const) {
  $<HTMLInputElement>(id).addEventListener("change", () => {
    anchor[key] = Number($<HTMLInputElement>(id).value) || 0;
    renderPreview();
  });
}
$("anchorReset").addEventListener("click", () => {
  anchor.x = DEFAULT_ANCHOR_X;
  anchor.y = DEFAULT_ANCHOR_Y;
  $<HTMLInputElement>("anchorX").value = String(anchor.x);
  $<HTMLInputElement>("anchorY").value = String(anchor.y);
  renderPreview();
});

// --- playback ---------------------------------------------------------------

function stopPlayback(): void {
  playing?.stop();
  playing = null;
  $("playBtn").textContent = t("shops.playState");
}

/**
 * Play the selected state's frames the way a prop does: in the state's stored
 * play order, at the viewer's cadence, ONCE — a prop animation holds its last
 * frame (a door opens and stays open); looping is scripted with makeloop.
 */
$("playBtn").addEventListener("click", () => {
  if (playing) {
    stopPlayback();
    renderPreview();
    return;
  }
  const st = state();
  if (!st || st.frames.length < 2) {
    log(t("shops.singleFrame"));
    return;
  }
  if (!st.animated) {
    log(
      t("shops.degSelector", { state: st.identifier }),
    );
  }
  const start = performance.now();
  let raf = 0;
  $("playBtn").textContent = "◼ Stop";
  const step = (): void => {
    const i = Math.min(Math.floor((performance.now() - start) / FRAME_MS), st.frames.length - 1);
    frameIdx = i;
    drawScreen(frameAt(st.frames[i]));
    if (i < st.frames.length - 1) raf = requestAnimationFrame(step);
    else {
      stopPlayback();
      buildFrames();
      renderPreview();
    }
  };
  raf = requestAnimationFrame(step);
  playing = { stop: () => cancelAnimationFrame(raf) };
});

// --- rendering --------------------------------------------------------------

function refresh(): void {
  if (!shp) return;
  buildFileBar();
  buildShopFields();
  buildStates();
  buildFrames();
  buildScripts();
  buildPalette();
  renderPreview();
}

function selectState(idx: number): void {
  stopPlayback();
  stateIdx = idx;
  frameIdx = 0;
  buildStates();
  buildFrames();
  renderPreview();
}

function buildFileBar(): void {
  const s = shp!;
  const states = s.groups.reduce((n, g) => n + g.states.length, 0);
  const frames = s.groups.reduce(
    (n, g) => n + g.states.reduce((m, st) => m + st.frames.length, 0),
    0,
  );
  $("fileStats").textContent =
    t("counts.containers", { n: s.file.containers.length }) + " · " + t("counts.props", { n: s.groups.length }) + " · " +
    t("shops.fileStatsTail", { states, frames });
}

function buildShopFields(): void {
  const s = shp!;
  const name = $<HTMLInputElement>("shopName");
  name.value = s.refName;
  name.maxLength = SHOP_REF_NAME_FIELD;
  name.title =
    t("shops.shopNameTitle", { max: SHOP_REF_NAME_FIELD });
  name.onchange = () => {
    if (name.value === s.refName) return;
    const stored = patchShopRefName(s, name.value);
    name.value = stored;
    name.classList.add("edited");
    markEdit(t("shops.shopNameEdit", { name: stored }));
    log(t("shops.shopNameNow", { name: stored }));
  };
  $("shopInfo").innerHTML =
    t("shops.shopInfo", { loc: s.mainScriptLocation });
}

function buildGroupSelect(): void {
  const sel = $<HTMLSelectElement>("groupSel");
  sel.replaceChildren();
  shp!.groups.forEach((g, i) => {
    const o = document.createElement("option");
    o.value = String(i);
    o.textContent = `${i} ${g.name || "(unnamed)"} (${g.states.length} states)`;
    sel.appendChild(o);
  });
  sel.value = String(groupIdx);
  sel.onchange = () => {
    stopPlayback();
    groupIdx = Number(sel.value);
    stateIdx = 0;
    frameIdx = 0;
    refresh();
  };
}

function buildStates(): void {
  const wrap = $("states");
  wrap.replaceChildren();
  const g = group();
  const nameInput = $<HTMLInputElement>("groupName");
  nameInput.value = g?.name ?? "";
  nameInput.maxLength = GROUP_NAME_FIELD;
  nameInput.title = t("shops.propNameTitle", { max: GROUP_NAME_FIELD });
  nameInput.onchange = () => {
    if (!g || nameInput.value === g.name) return;
    const stored = patchGroupName(shp!, groupIdx, nameInput.value);
    nameInput.value = stored;
    nameInput.classList.add("edited");
    markEdit(`prop ${groupIdx} name → ${stored}`);
    buildGroupSelect();
    renderPreview();
  };
  if (!g) return;

  $("statesInfo").textContent =
    t("counts.states", { n: g.states.length }) + t("casts.posesOf", { name: g.name }) + " · " +
    t("shops.statesInfoTail", { script: g.scriptContainerLocation, group: g.location });

  const filter = $<HTMLInputElement>("stateFilter").value.trim().toLowerCase();
  let shown = 0;
  g.states.forEach((st, i) => {
    if (filter && !st.identifier.toLowerCase().includes(filter)) return;
    shown++;
    const row = document.createElement("div");
    row.className = "staterow" + (i === stateIdx ? " selected" : "");

    const pick = document.createElement("button");
    pick.className = "mini";
    pick.textContent = i === stateIdx ? "●" : "○";
    pick.title = t("shops.showThisState");
    pick.onclick = () => selectState(i);
    row.appendChild(pick);

    const id = document.createElement("input");
    id.type = "text";
    id.className = "ident";
    id.value = st.identifier;
    id.maxLength = STATE_ID_FIELD;
    id.title = t("shops.stateIdTitle", { max: STATE_ID_FIELD });
    id.onchange = () => {
      if (id.value === st.identifier) return;
      const stored = patchStateIdentifier(shp!, groupIdx, i, id.value);
      id.value = stored;
      id.classList.add("edited");
      markEdit(`state ${groupIdx}/${i} → ${stored}`);
      renderPreview();
    };
    row.appendChild(id);

    // one frame is a still pose ("idleclosed"); several either play in order or
    // are deg-indexed variants only one of which is ever shown
    const still = st.frames.length < 2;
    const kind = document.createElement("span");
    kind.className = "badge " + (st.animated ? "anim" : "sel");
    kind.textContent = still ? "still" : st.animated ? "animation" : "selector";
    kind.title = still
      ? t("shops.onePose")
      : st.animated
        ? t("shops.playsInOrder")
        : t("shops.degPicksOne");
    row.appendChild(kind);

    const meta = document.createElement("span");
    meta.className = "meta grow";
    const degs = st.degrees.slice(0, 6).join(",") + (st.degrees.length > 6 ? ",…" : "");
    meta.textContent =
      t("counts.frames", { n: st.frames.length }) + t("shops.degList", { degs, loc: st.location });
    row.appendChild(meta);

    if (st.frames.length > 1) {
      const play = document.createElement("button");
      play.className = "mini";
      play.textContent = "▶";
      play.title = t("shops.playThisState");
      play.onclick = () => {
        selectState(i);
        $("playBtn").click();
      };
      row.appendChild(play);
    }

    wrap.appendChild(row);
  });
  if (!shown) {
    const empty = document.createElement("span");
    empty.className = "dim";
    empty.textContent = filter ? t("shops.noStateMatches", { filter }) : t("shops.noStates");
    wrap.appendChild(empty);
  }
}

$<HTMLInputElement>("stateFilter").addEventListener("input", () => buildStates());

function buildFrames(): void {
  const wrap = $("frames");
  wrap.replaceChildren();
  const st = state();
  $("framesInfo").textContent = st
    ? t("shops.framesHeadState", { state: st.identifier }) +
      t("counts.frames", { n: st.frames.length }) +
      (st.animated ? t("shops.inPlayOrder") : t("shops.degVariants"))
    : "";
  if (!st) return;
  st.frames.forEach((loc, i) => {
    const f = frameAt(loc);
    const cell = document.createElement("div");
    cell.className = "framecell" + (i === frameIdx ? " selected" : "");
    const c = document.createElement("canvas");
    c.className = "thumb";
    if (f && f.width && f.height) {
      frameToCanvas(f, c);
      const scale = Math.min(72 / f.width, 72 / f.height, 3);
      c.style.width = `${Math.max(1, Math.round(f.width * scale))}px`;
      c.style.height = `${Math.max(1, Math.round(f.height * scale))}px`;
    } else {
      c.width = c.height = 16;
      c.style.width = c.style.height = "16px";
    }
    const label = document.createElement("span");
    label.className = "flabel";
    label.textContent = `${i} · deg ${st.degrees[i] ?? 0}`;
    cell.title = `frame ${i} @${loc}` + (f ? ` — ${f.width}×${f.height}` : " — undecodable");
    cell.onclick = () => {
      stopPlayback();
      frameIdx = i;
      buildFrames();
      renderPreview();
    };
    cell.appendChild(c);
    cell.appendChild(label);
    wrap.appendChild(cell);
  });
  buildFramePanel();
}

function buildFramePanel(): void {
  const st = state();
  const loc = frameLoc();
  const f = loc === undefined ? null : frameAt(loc);
  const panel = $("framePanel");
  panel.style.display = st ? "flex" : "none";
  if (!st || loc === undefined) return;

  const posY = $<HTMLInputElement>("posY");
  const posX = $<HTMLInputElement>("posX");
  posY.value = String(f?.posYraw ?? 0);
  posX.value = String(f?.posXraw ?? 0);
  const applyOffset = (): void => {
    if (!f) return;
    const y = Number(posY.value) || 0;
    const x = Number(posX.value) || 0;
    if (y === f.posYraw && x === f.posXraw) return;
    if (!patchFrameAnchor(shp!.file, loc, y, x)) return;
    frameCache.delete(loc);
    markEdit(t("shops.offsetEdit", { loc, y, x }));
    log(
      t("shops.offsetMoved", { loc, x, y }),
    );
    buildFrames();
    renderPreview();
  };
  posY.onchange = applyOffset;
  posX.onchange = applyOffset;

  const deg = $<HTMLInputElement>("frameDeg");
  deg.value = String(st.degrees[frameIdx] ?? 0);
  deg.onchange = () => {
    const value = Number(deg.value) || 0;
    if (value === st.degrees[frameIdx]) return;
    if (!patchFrameDegree(shp!, groupIdx, stateIdx, frameIdx, value)) return;
    deg.value = String(st.degrees[frameIdx]);
    deg.classList.add("edited");
    markEdit(`deg ${st.identifier}/${frameIdx} → ${st.degrees[frameIdx]}`);
    buildStates();
    buildFrames();
    renderPreview();
  };
}

function buildScripts(): void {
  const wrap = $("scripts");
  wrap.replaceChildren();
  const s = shp!;
  const entries: { label: string; loc: number }[] = [
    { label: t("shops.mainScriptLabel"), loc: s.mainScriptLocation },
  ];
  for (const g of s.groups) {
    if (g.scriptContainerLocation) {
      entries.push({ label: `prop “${g.name}”`, loc: g.scriptContainerLocation });
    }
  }
  for (const e of entries) {
    const det = document.createElement("details");
    det.className = "script";
    const sum = document.createElement("summary");
    sum.textContent = `${e.label} (container @${e.loc})`;
    det.appendChild(sum);
    const pre = document.createElement("pre");
    // decompiling is only worth it when opened — a shop carries dozens
    let filled = false;
    det.ontoggle = () => {
      if (filled || !det.open) return;
      filled = true;
      const tokens = sniffScript(s.file.containers[e.loc]?.data ?? new Uint8Array(0));
      pre.textContent = tokens ? scriptToText(tokens) : t("common.notAScript");
    };
    det.appendChild(pre);
    wrap.appendChild(det);
  }
}

function buildPalette(): void {
  const wrap = $("palette");
  wrap.replaceChildren();
  $("paletteInfo").textContent =
    t("shops.paletteInfo");
  for (let i = 0; i < 256; i++) {
    const d = document.createElement("div");
    d.style.background = `rgb(${palette[i * 4]},${palette[i * 4 + 1]},${palette[i * 4 + 2]})`;
    d.title = `${i}: rgb(${palette[i * 4]},${palette[i * 4 + 1]},${palette[i * 4 + 2]})`;
    wrap.appendChild(d);
  }
}

// --- PNG round trip ---------------------------------------------------------

const baseName = (): string => fileName.replace(/\.shp$/i, "").toLowerCase();

$("pngExportBtn").addEventListener("click", () => {
  const loc = frameLoc();
  const f = loc === undefined ? null : frameAt(loc);
  if (!f) return;
  const c = document.createElement("canvas");
  frameToCanvas(f, c);
  c.toBlob((blob) => {
    if (!blob) return;
    download(blob, `${baseName()}.${group().name || groupIdx}.${state()!.identifier}.f${frameIdx}.png`);
  }, "image/png");
});

const pngInput = $<HTMLInputElement>("pngInput");
$("pngImportBtn").addEventListener("click", () => pngInput.click());
pngInput.addEventListener("change", () => {
  const file = pngInput.files?.[0];
  pngInput.value = "";
  const loc = frameLoc();
  if (file && loc !== undefined) void importPng(file, loc);
});

/**
 * Replace a frame's art with an image file: pixels are matched to the shop's
 * palette (nearest RGB), alpha < 128 becomes transparent — the mask is what
 * makes a prop a cut-out and what its clicks are hit-tested against — and the
 * container's stored offset is kept so the art stays anchored where it was.
 */
async function importPng(file: File, loc: number): Promise<void> {
  if (!shp) return;
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
  const container = shp.file.containers[loc];
  const data = encodeShpFrame(frame);
  shp.file.containers[loc] = { id: container.id, data };
  frameCache.delete(loc);
  markEdit(t("shops.artEdit", { loc, file: file.name }));
  log(
    t("shops.artReplaced", {
      loc,
      file: file.name,
      w: bmp.width,
      h: bmp.height,
      kb: (data.length / 1024).toFixed(1),
      was: (container.data.length / 1024).toFixed(1),
    }) +
      (old && (old.width !== bmp.width || old.height !== bmp.height)
        ? t("shops.artSizeWarn", { w: old.width, h: old.height })
        : ""),
  );
  buildFrames();
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

// --- export -----------------------------------------------------------------

function download(blob: Blob, name: string): void {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}

$("exportBtn").addEventListener("click", () => {
  if (!shp) return;
  const bytes = writeContainerFile(shp.file);
  try {
    readShpFile(bytes); // sanity: the export must read back as a shop
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
// Which edition's files the landing screen lists, and which copy of a basename an
// edit is written back into: the same row the play page and the collection carry
// (src/editions.ts). A click reloads, and this page's beforeunload guard is what
// stands between that and unexported edits.
void installEditionPicker(document.getElementById("editionPicker") as HTMLElement);
