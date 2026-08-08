/**
 * Stage Editor (stages.html) — the fifth of the browser editors over the DF
 * library, for the screens that are not rooms: load a .STG "stage" (upload,
 * drag-and-drop, or pick one from the dev server's gamefiles manifest) — the UI
 * band (MAIN.STG), the inventory (INVEN1/2.STG), the deck plan (MAP.STG), a
 * mini-game board (BLKJACK.STG) — take it apart into its flats, each flat's
 * full-screen art and its clickable regions, the scripts and the palette, edit
 * what is editable, and export the repacked file.
 *
 * Editable: every flat's name, every region's name and rectangle, and any flat's
 * art via PNG round-trip. Reading is the same code path the game uses
 * (readStgFile/readStgRegions/decodeFrame); writing is the patches in
 * src/df/stg.ts plus encodeFrame/writeContainerFile, so an untouched load
 * exports the file it read (see tests/auto/stg-editor.ts).
 */
import { FrameBuffer, decodeFrame, encodeFrame, indexedToRGBA, paletteToRGBA } from "../src/df/image";
import { installLanguageMenu } from "../src/lang-menu";
import { installVersion } from "../src/version";
import { chosenEdition, editionsIn, gamefileManifest, inChosenEdition, installEditionPicker } from "../src/editions";
import { siteUrl } from "../src/site";
import { t, formatNumber } from "../src/locales";
import { installI18n } from "../src/locales";
import { scriptToText, sniffScript } from "../src/df/script";
import { writeContainerFile } from "../src/df/container";
import {
  FLAT_NAME_FIELD,
  MAIN_SCRIPT_LOCATION,
  REGION_NAME_FIELD,
  StgFile,
  StgRegion,
  patchFlatName,
  patchRegionName,
  patchRegionRect,
  readStgFile,
  readStgRegions,
} from "../src/df/stg";
import { SCREEN_H, SCREEN_W } from "../src/screen";

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const landing = $("landing");
const editor = $("editor");
const statusEl = $("status");
const dirtyEl = $("dirty");

// --- editor state -----------------------------------------------------------

interface FlatImage {
  pixels: Uint8Array;
  width: number;
  height: number;
  /** byte offset of this container's Z layer, or -1 — kept so a PNG import can
   *  carry it over unchanged (flats do not normally have one) */
  zOffset: number;
}

let stg: StgFile | null = null;
let fileName = "stage.stg";
let palette: Uint8ClampedArray = new Uint8ClampedArray(1024);
/** decoded flat art by frame container location */
const imageCache = new Map<number, FlatImage>();
/** the selected flat's regions, parsed once and edited in place */
let regions: StgRegion[] = [];
/** human-readable notes of every edit, shown next to the export button */
const edits: string[] = [];
let flatIdx = 0;
/** the region row the pointer is on, highlighted in the overlay */
let hoveredRegion = -1;
let showRegions = true;

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

const flat = () => stg!.flats[flatIdx];

// --- loading ----------------------------------------------------------------

function loadStg(bytes: Uint8Array, name: string): void {
  let parsed: StgFile;
  try {
    parsed = readStgFile(bytes);
  } catch (e) {
    log(t("common.notReadable", { ext: ".stg", message: (e as Error).message }));
    return;
  }
  stg = parsed;
  fileName = name;
  palette = paletteToRGBA(parsed.paletteRaw, 256);
  imageCache.clear();
  edits.length = 0;
  dirtyEl.textContent = "";
  flatIdx = 0;
  hoveredRegion = -1;

  landing.style.display = "none";
  editor.style.display = "flex";
  $("fileName").textContent = name;
  log("");
  buildFlatSelect();
  refresh();
}

async function loadFromFile(f: File): Promise<void> {
  loadStg(new Uint8Array(await f.arrayBuffer()), f.name);
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

/** dev-server mode: offer every .stg in the gamefiles manifest */
async function initServerStages(): Promise<void> {
  // Only the chosen EDITION's copies: an install with six of them holds six
  // `bedsit1.set`, and listing all six lists the same room six times under
  // names that cannot be told apart. The edition row at the top of the page is
  // what chooses, and it is the same choice the game reads (src/editions.ts).
  const all = await gamefileManifest();
  if (!all.length) return; // production / no dev server: upload only
  const paths = inChosenEdition(all, chosenEdition(editionsIn(all)));
  const stages = paths.filter((p) => p.toLowerCase().endsWith(".stg")).sort();
  if (!stages.length) return;
  const wrap = $("serverStages");
  const note = document.createElement("div");
  note.className = "note";
  note.textContent = t("common.pickFromGamefiles");
  wrap.appendChild(note);
  const row = document.createElement("div");
  row.className = "row stages";
  for (const p of stages) {
    const b = document.createElement("button");
    b.className = "stage";
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
      loadStg(new Uint8Array(await r.arrayBuffer()), base);
    });
    row.appendChild(b);
  }
  wrap.appendChild(row);
}
void initServerStages();

$("closeBtn").addEventListener("click", () => {
  if (edits.length && !confirm(t("counts.discardEdits", { n: edits.length }))) return;
  stg = null;
  edits.length = 0;
  imageCache.clear();
  editor.style.display = "none";
  landing.style.display = "block";
});

// --- flat art ---------------------------------------------------------------

/**
 * Decode a flat's image. Unlike a SET's turn ring, a flat is self-contained —
 * the engine decodes one into a fresh FrameBuffer (StageController.flatImage)
 * because nothing delta-codes against the flat before it — so each can be
 * decoded on its own.
 */
function imageAt(loc: number): FlatImage | null {
  if (!stg) return null;
  let img = imageCache.get(loc) ?? null;
  if (!img) {
    const data = stg.file.containers[loc]?.data;
    if (!data) return null;
    try {
      const fb = new FrameBuffer();
      const d = decodeFrame(data, fb);
      img = {
        pixels: fb.pixels.slice(0, d.width * d.height),
        width: d.width,
        height: d.height,
        zOffset: d.zOffset,
      };
    } catch {
      return null;
    }
    imageCache.set(loc, img);
  }
  return img;
}

function imageToCanvas(img: FlatImage, canvas: HTMLCanvasElement): void {
  canvas.width = Math.max(1, img.width);
  canvas.height = Math.max(1, img.height);
  const ctx = canvas.getContext("2d")!;
  if (!img.width || !img.height) return;
  const data = ctx.createImageData(img.width, img.height);
  indexedToRGBA(img.pixels, img.width, img.height, palette, data.data);
  ctx.putImageData(data, 0, 0);
}

// --- preview ----------------------------------------------------------------

function renderPreview(): void {
  if (!stg) return;
  const canvas = $<HTMLCanvasElement>("preview");
  const f = flat();
  const img = f ? imageAt(f.locationFrame) : null;
  if (img) imageToCanvas(img, canvas);
  else {
    canvas.width = SCREEN_W;
    canvas.height = SCREEN_H;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  $("previewInfo").innerHTML = f
    ? t("stages.previewFlat", { name: f.name, loc: f.locationFrame }) +
      (img
        ? t("stages.previewImage", {
            w: img.width,
            h: img.height,
            bytes: formatNumber(stg.file.containers[f.locationFrame]?.data.length ?? 0),
          }) +
          (img.zOffset >= 0 ? t("stages.previewZLayer") : "")
        : t("stages.previewNoImage")) +
      t("stages.previewScript", {
        script: f.locationScript,
        logic: f.locationClickLogic,
        cond: f.condition,
        w: f.width,
        h: f.height,
      }) +
      `<br>${t("counts.clickableRegions", { n: regions.length })}`
    : t("stages.noFlats");
  drawOverlay();
}

/** the flat's clickable regions, over the picture */
function drawOverlay(): void {
  const preview = $<HTMLCanvasElement>("preview");
  const canvas = $<HTMLCanvasElement>("overlay");
  canvas.width = preview.width;
  canvas.height = preview.height;
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!showRegions) return;
  ctx.font = '9px "Courier New", monospace';
  ctx.textBaseline = "top";
  regions.forEach((r, i) => {
    const w = r.right - r.left;
    const h = r.bottom - r.top;
    ctx.strokeStyle = i === hoveredRegion ? "#e4f0fc" : "#60c0f0";
    ctx.lineWidth = 1;
    ctx.strokeRect(r.left + 0.5, r.top + 0.5, w, h);
    const label = r.name || `#${i}`;
    ctx.fillStyle = "rgba(0,6,15,0.78)";
    ctx.fillRect(r.left + 1, r.top + 1, ctx.measureText(label).width + 4, 11);
    ctx.fillStyle = i === hoveredRegion ? "#e4f0fc" : "#b4d8f0";
    ctx.fillText(label, r.left + 3, r.top + 2);
  });
}

$("regionBtn").addEventListener("click", () => {
  showRegions = !showRegions;
  $("regionBtn").classList.toggle("on", showRegions);
  drawOverlay();
});
$("regionBtn").classList.add("on");

// --- rendering --------------------------------------------------------------

function refresh(): void {
  if (!stg) return;
  const f = flat();
  regions = f ? readStgRegions(stg.file.containers[f.locationClickLogic]?.data ?? new Uint8Array(0)) : [];
  buildFileBar();
  buildFlatFields();
  buildRegions();
  buildScripts();
  buildPalette();
  renderPreview();
}

function buildFileBar(): void {
  const s = stg!;
  const withArt = s.flats.filter((f) => f.locationFrame).length;
  $("fileStats").textContent =
    `${t("counts.containers", { n: s.file.containers.length })} · ` +
    `${t("counts.flats", { n: s.flats.length })} ` +
    t("counts.withArt", { n: withArt });
}

function buildFlatSelect(): void {
  const sel = $<HTMLSelectElement>("flatSel");
  sel.replaceChildren();
  stg!.flats.forEach((f, i) => {
    const o = document.createElement("option");
    o.value = String(i);
    o.textContent = `${i} ${f.name || "(unnamed)"}`;
    sel.appendChild(o);
  });
  sel.value = String(flatIdx);
  sel.onchange = () => {
    flatIdx = Number(sel.value);
    hoveredRegion = -1;
    refresh();
  };
}

function buildFlatFields(): void {
  const f = flat();
  const name = $<HTMLInputElement>("flatName");
  name.value = f?.name ?? "";
  name.maxLength = FLAT_NAME_FIELD;
  name.title =
    t("stages.flatNameTitle", { max: FLAT_NAME_FIELD });
  name.onchange = () => {
    if (!f || name.value === f.name) return;
    const stored = patchFlatName(stg!, flatIdx, name.value);
    name.value = stored;
    name.classList.add("edited");
    markEdit(t("stages.flatNameEdit", { i: flatIdx, name: stored }));
    log(
      t("stages.flatRenamed", { i: flatIdx, name: stored }),
    );
    buildFlatSelect();
    renderPreview();
  };
  $("stageInfo").innerHTML =
    t("stages.stageInfo", { loc: MAIN_SCRIPT_LOCATION, w: SCREEN_W, h: SCREEN_H });
}

function buildRegions(): void {
  const wrap = $("regions");
  wrap.replaceChildren();
  const f = flat();
  $("regionsInfo").textContent = f
    ? t("stages.regionsIn", { n: regions.length, name: f.name }) +
      (f.locationClickLogic ? t("stages.regionsLogic", { loc: f.locationClickLogic }) : "") +
      t("stages.regionsRects")
    : "";
  if (!regions.length) {
    const empty = document.createElement("span");
    empty.className = "dim";
    empty.textContent = f?.locationClickLogic
      ? t("stages.noRegionsInLogic")
      : t("stages.noClickLogic");
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

    const name = document.createElement("input");
    name.type = "text";
    name.className = "ident";
    name.value = r.name;
    name.maxLength = REGION_NAME_FIELD;
    name.title = t("stages.regionNameTitle", { max: REGION_NAME_FIELD });
    name.onchange = () => {
      if (!f || name.value === r.name) return;
      const stored = patchRegionName(stg!, f, r, name.value);
      name.value = stored;
      name.classList.add("edited");
      markEdit(`region ${i} name → ${stored}`);
      buildScripts();
      drawOverlay();
    };
    row.appendChild(name);

    const meta = document.createElement("span");
    meta.className = "meta grow";
    const showSize = (): void => {
      meta.textContent =
        `${Math.max(0, r.right - r.left)}×${Math.max(0, r.bottom - r.top)}px · script @${r.script}`;
    };
    showSize();

    const fields: Record<string, HTMLInputElement> = {};
    for (const [key, label, value] of [
      ["left", "x", r.left],
      ["top", "y", r.top],
      ["right", "→x", r.right],
      ["bottom", "→y", r.bottom],
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
        if (!f) return;
        patchRegionRect(stg!, f, r, {
          top: Number(fields.top.value) || 0,
          left: Number(fields.left.value) || 0,
          bottom: Number(fields.bottom.value) || 0,
          right: Number(fields.right.value) || 0,
        });
        input.classList.add("edited");
        markEdit(`region ${r.name || i} → ${r.left},${r.top}–${r.right},${r.bottom}`);
        showSize();
        drawOverlay();
      };
      wrapper.appendChild(input);
      row.appendChild(wrapper);
    }

    row.appendChild(meta);

    wrap.appendChild(row);
  });
}

function buildScripts(): void {
  const wrap = $("scripts");
  wrap.replaceChildren();
  const s = stg!;
  const f = flat();
  const entries: { label: string; loc: number }[] = [
    { label: t("stages.mainScriptLabel"), loc: MAIN_SCRIPT_LOCATION },
  ];
  for (const other of s.flats) {
    if (other.locationScript) {
      entries.push({ label: t("stages.flatScriptLabel", { name: other.name }), loc: other.locationScript });
    }
  }
  for (const r of regions) {
    if (r.script) {
      entries.push({ label: `region “${r.name}” (${f?.name ?? flatIdx})`, loc: r.script });
    }
  }
  for (const e of entries) {
    const det = document.createElement("details");
    det.className = "script";
    const sum = document.createElement("summary");
    sum.textContent = `${e.label} (container @${e.loc})`;
    det.appendChild(sum);
    const pre = document.createElement("pre");
    // decompiling is only worth it when opened — a mini-game stage carries dozens
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
    t("stages.paletteInfo");
  for (let i = 0; i < 256; i++) {
    const d = document.createElement("div");
    d.style.background = `rgb(${palette[i * 4]},${palette[i * 4 + 1]},${palette[i * 4 + 2]})`;
    d.title = `${i}: rgb(${palette[i * 4]},${palette[i * 4 + 1]},${palette[i * 4 + 2]})`;
    wrap.appendChild(d);
  }
}

// --- PNG round trip ---------------------------------------------------------

const baseName = (): string => fileName.replace(/\.stg$/i, "").toLowerCase();

$("pngExportBtn").addEventListener("click", () => {
  const f = flat();
  const img = f ? imageAt(f.locationFrame) : null;
  if (!img) return;
  const c = document.createElement("canvas");
  imageToCanvas(img, c);
  c.toBlob((blob) => {
    if (blob) download(blob, `${baseName()}.${f.name || flatIdx}.png`);
  }, "image/png");
});

const pngInput = $<HTMLInputElement>("pngInput");
$("pngImportBtn").addEventListener("click", () => pngInput.click());
pngInput.addEventListener("change", () => {
  const file = pngInput.files?.[0];
  pngInput.value = "";
  if (file) void importPng(file);
});

/**
 * Replace a flat's art with an image file: pixels are matched to the stage's
 * palette (nearest RGB over all 256 entries — a flat, unlike a room view, uses
 * the whole table) and re-encoded self-contained, which is what the codec needs
 * anyway since nothing delta-codes against a flat.
 */
async function importPng(file: File): Promise<void> {
  const f = flat();
  if (!stg || !f) return;
  const old = imageAt(f.locationFrame);
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

  const pixels = new Uint8Array(bmp.width * bmp.height);
  for (let i = 0; i < pixels.length; i++) {
    pixels[i] = nearestPaletteIndex(img.data[i * 4], img.data[i * 4 + 1], img.data[i * 4 + 2]);
  }

  const container = stg.file.containers[f.locationFrame];
  const sameSize = old && old.width === bmp.width && old.height === bmp.height;
  const zBlock = sameSize && old.zOffset >= 0 ? container.data.subarray(old.zOffset) : undefined;
  const data = encodeFrame(pixels, bmp.width, bmp.height, zBlock);
  stg.file.containers[f.locationFrame] = { id: container.id, data };
  imageCache.delete(f.locationFrame);
  markEdit(t("stages.artEdit", { loc: f.locationFrame, file: file.name }));
  log(
    t("stages.artReplaced", {
      name: f.name,
      file: file.name,
      w: bmp.width,
      h: bmp.height,
      kb: (data.length / 1024).toFixed(1),
      was: (container.data.length / 1024).toFixed(1),
    }) +
      (old && !sameSize
        ? t("stages.artSizeWarn", { w: old.width, h: old.height, sw: SCREEN_W, sh: SCREEN_H })
        : ""),
  );
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
  if (!stg) return;
  const bytes = writeContainerFile(stg.file);
  try {
    readStgFile(bytes); // sanity: the export must read back as a stage
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
