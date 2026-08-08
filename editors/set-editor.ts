/**
 * Set Editor (sets.html) — the third of the browser editors over the DF
 * library, for the format the game spends most of its time in: load a .SET room
 * (upload, drag-and-drop, or pick one from the dev server's gamefiles
 * manifest), take it apart into what a set is made of — scenes (standpoints),
 * their views with hotspots and camera, the turn rings and roads that animate
 * moving between them, the actor marks, the deck-plan maps, the scripts and the
 * palette — edit what is editable, and export the repacked file.
 *
 * Editable: the set's name and default standpoint/facing, scene and view names,
 * road names, every hotspot's identifier and clickable rectangle, every actor
 * mark's name/rotation/position, and any frame's art via PNG round-trip.
 * Reading is the same code path the game uses (readSetFile/decodeFrame);
 * writing is the patches in src/df/set.ts plus encodeFrame/writeContainerFile,
 * so an untouched load exports the file it read (see tests/auto/set-editor.ts).
 */
import { decodeFrame, encodeFrame, FrameBuffer, indexedToRGBA, paletteToRGBA } from "../src/df/image";
import { installLanguageMenu } from "../src/lang-menu";
import { chosenEdition, editionsIn, gamefileManifest, inChosenEdition, installEditionPicker } from "../src/editions";
import { siteUrl } from "../src/site";
import { t, formatNumber } from "../src/locales";
import { installI18n } from "../src/locales";
import { scriptToText, sniffScript } from "../src/df/script";
import { writeContainerFile } from "../src/df/container";
import { FrameInfo, LEFTTURNS, RIGHTTURNS, SetFile, readSetFile, turnRing } from "../src/df/set";
import {
  OBJECT_ID_FIELD,
  SCENE_NAME_FIELD,
  SET_NAME_FIELD,
  TRANSITION_NAME_FIELD,
  VIEW_NAME_FIELD,
  patchActor,
  patchDefaultStart,
  patchObjectIdentifier,
  patchObjectRegion,
  patchSceneName,
  patchSetName,
  patchTransitionName,
  patchViewName,
} from "../src/df/set-patch";

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const landing = $("landing");
const editor = $("editor");
const statusEl = $("status");
const dirtyEl = $("dirty");

/** the turn/walk animation rate the game plays at (see src/viewer.ts) */
const FRAME_MS = 90;
/** decoded frames held at once; a ring of 512×264 frames is ~135 KB each */
const RING_BUDGET_BYTES = 64 * 1024 * 1024;

// --- editor state -----------------------------------------------------------

let set: SetFile | null = null;
let fileName = "room.set";
/** the 128 colours SET frames use, and the full 256 the maps do */
let palette: Uint8ClampedArray = new Uint8ClampedArray(1024);
let mapPalette: Uint8ClampedArray = new Uint8ClampedArray(1024);
/** human-readable notes of every edit, shown next to the export button */
const edits: string[] = [];
let sceneIdx = 0;
let viewIdx = 0;
/** the frame the preview shows and the PNG buttons act on; null = the
 *  standpoint frame of the selected view */
let selected: { loc: number; label: string; ring: FrameInfo[] } | null = null;
let showHotspots = true;
/** the running ring animation, if any */
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

const scene = () => set!.scenes[sceneIdx];
const view = () => scene()?.views[viewIdx];

// --- loading ----------------------------------------------------------------

function loadSet(bytes: Uint8Array, name: string): void {
  stopPlayback();
  let parsed: SetFile;
  try {
    parsed = readSetFile(bytes);
  } catch (e) {
    log(t("common.notReadable", { ext: ".set", message: (e as Error).message }));
    return;
  }
  set = parsed;
  fileName = name;
  palette = paletteToRGBA(parsed.paletteRaw, parsed.colorCount);
  mapPalette = paletteToRGBA(parsed.paletteRaw, 256);
  rings.clear();
  ringBytes = 0;
  edits.length = 0;
  dirtyEl.textContent = "";
  selected = null;
  // open where the game would: the set's own default standpoint and facing
  sceneIdx = Math.max(0, parsed.scenes.findIndex((s) => s.sceneName === parsed.defaultSceneName));
  viewIdx = Math.max(0, scene()?.views.findIndex((v) => v.viewName === parsed.defaultViewName) ?? 0);

  landing.style.display = "none";
  editor.style.display = "flex";
  $("fileName").textContent = name;
  log("");
  buildSceneSelect();
  refresh();
}

async function loadFromFile(f: File): Promise<void> {
  loadSet(new Uint8Array(await f.arrayBuffer()), f.name);
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

/** dev-server mode: offer every .set in the gamefiles manifest */
async function initServerSets(): Promise<void> {
  // Only the chosen EDITION's copies: an install with six of them holds six
  // `bedsit1.set`, and listing all six lists the same room six times under
  // names that cannot be told apart. The edition row at the top of the page is
  // what chooses, and it is the same choice the game reads (src/editions.ts).
  const all = await gamefileManifest();
  if (!all.length) return; // production / no dev server: upload only
  const paths = inChosenEdition(all, chosenEdition(editionsIn(all)));
  const sets = paths.filter((p) => p.toLowerCase().endsWith(".set")).sort();
  if (!sets.length) return;
  const wrap = $("serverSets");
  const note = document.createElement("div");
  note.className = "note";
  note.textContent = t("common.pickFromGamefiles");
  wrap.appendChild(note);
  const row = document.createElement("div");
  row.className = "row sets";
  for (const p of sets) {
    const b = document.createElement("button");
    b.className = "set";
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
      loadSet(new Uint8Array(await r.arrayBuffer()), base);
    });
    row.appendChild(b);
  }
  wrap.appendChild(row);
}
void initServerSets();

$("closeBtn").addEventListener("click", () => {
  if (edits.length && !confirm(t("counts.discardEdits", { n: edits.length }))) return;
  stopPlayback();
  set = null;
  edits.length = 0;
  rings.clear();
  ringBytes = 0;
  editor.style.display = "none";
  landing.style.display = "block";
});

// --- frames -----------------------------------------------------------------

interface CachedFrame {
  pixels: Uint8Array;
  width: number;
  height: number;
  /** byte offset of this container's Z layer, or -1 — kept so a PNG import can
   *  carry the depth image (which occludes actors) over unchanged */
  zOffset: number;
}

/**
 * Decoded rings, keyed by the FrameInfo array that identifies one (the same
 * array identity the parsed set holds, as in src/viewer.ts).
 *
 * Frames are DELTA-encoded — each is a patch on the buffer the previous one
 * left — so they cannot be decoded individually: the chain unit is the ring,
 * and a ring is self-contained (its first frame repaints every pixel). Rings
 * are decoded on demand and the oldest are dropped past the budget, since a
 * big set's every ring together runs to hundreds of megabytes.
 */
const rings = new Map<FrameInfo[], { frames: Map<number, CachedFrame>; bytes: number }>();
let ringBytes = 0;

function decodeRing(frames: FrameInfo[]): Map<number, CachedFrame> {
  const hit = rings.get(frames);
  if (hit) return hit.frames;
  const fb = new FrameBuffer();
  const decoded = new Map<number, CachedFrame>();
  let bytes = 0;
  for (const fi of frames) {
    if (!fi.frameContainerLoc) continue;
    const data = set!.file.containers[fi.frameContainerLoc]?.data;
    if (!data) continue;
    let d;
    try {
      d = decodeFrame(data, fb);
    } catch {
      continue; // a frame that doesn't decode: skip it, keep the ring usable
    }
    // a container referenced twice in one ring keeps its FIRST decode, but the
    // decoder still runs so the frames after it see the right buffer
    if (decoded.has(fi.frameContainerLoc)) continue;
    const n = d.width * d.height;
    decoded.set(fi.frameContainerLoc, {
      pixels: fb.pixels.slice(0, n),
      width: d.width,
      height: d.height,
      zOffset: d.zOffset,
    });
    bytes += n;
  }
  rings.set(frames, { frames: decoded, bytes });
  ringBytes += bytes;
  // insertion order is oldest-first; never evict the ring just asked for
  for (const [key, ring] of rings) {
    if (ringBytes <= RING_BUDGET_BYTES || rings.size < 2) break;
    if (key === frames) continue;
    ringBytes -= ring.bytes;
    rings.delete(key);
  }
  return decoded;
}

/** forget a ring's decode — after replacing the art of a frame inside it */
function invalidateFrame(loc: number): void {
  for (const [key, ring] of rings) {
    if (!ring.frames.has(loc)) continue;
    ringBytes -= ring.bytes;
    rings.delete(key);
  }
}

/** every ring of the set, with the label the UI calls it by */
function allRings(): { label: string; frames: FrameInfo[] }[] {
  const out: { label: string; frames: FrameInfo[] }[] = [];
  for (const s of set!.scenes) {
    out.push({ label: t("sets.turnRightLabel", { scene: s.sceneName }), frames: s.turns[RIGHTTURNS].frames });
    out.push({ label: t("sets.turnLeftLabel", { scene: s.sceneName }), frames: s.turns[LEFTTURNS].frames });
  }
  for (const road of set!.transitions) {
    out.push({ label: `road ${road.transitionName} →`, frames: road.frameRegisters[0].frames });
    out.push({ label: `road ${road.transitionName} ←`, frames: road.frameRegisters[1].frames });
  }
  return out;
}

/** the ring a frame container belongs to (needed to decode it at all) */
function ringOf(loc: number): { label: string; frames: FrameInfo[] } | null {
  return allRings().find((r) => r.frames.some((f) => f.frameContainerLoc === loc)) ?? null;
}

const standFrameInfo = (viewIndex = viewIdx): FrameInfo | null =>
  scene()?.turns[RIGHTTURNS].frames.find((f) => f.viewID === viewIndex && f.motionInfo > 0) ?? null;

/** what the preview is showing: the selected frame, else the standpoint frame */
function currentFrame(): { loc: number; label: string; ring: FrameInfo[] } | null {
  if (selected) return selected;
  const fi = standFrameInfo();
  if (!fi?.frameContainerLoc) return null;
  return {
    loc: fi.frameContainerLoc,
    label: `${scene().sceneName}/${view()?.viewName ?? viewIdx} standpoint`,
    ring: scene().turns[RIGHTTURNS].frames,
  };
}

function frameAt(loc: number, ring: FrameInfo[]): CachedFrame | null {
  return decodeRing(ring).get(loc) ?? null;
}

/** paint an indexed frame into a canvas at 1:1 */
function frameToCanvas(f: CachedFrame, canvas: HTMLCanvasElement, pal = palette): void {
  canvas.width = Math.max(1, f.width);
  canvas.height = Math.max(1, f.height);
  const ctx = canvas.getContext("2d")!;
  if (!f.width || !f.height) return;
  const img = ctx.createImageData(f.width, f.height);
  indexedToRGBA(f.pixels, f.width, f.height, pal, img.data);
  ctx.putImageData(img, 0, 0);
}

// --- preview ----------------------------------------------------------------

function renderPreview(): void {
  if (!set) return;
  const canvas = $<HTMLCanvasElement>("preview");
  const cur = currentFrame();
  const f = cur ? frameAt(cur.loc, cur.ring) : null;
  if (f) frameToCanvas(f, canvas);
  else {
    canvas.width = set.viewPortWidth || 512;
    canvas.height = set.viewPortHeight || 264;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  const v = view();
  const fi = standFrameInfo();
  $("previewInfo").innerHTML = cur
    ? t("sets.previewContainer", { label: cur.label, loc: cur.loc }) +
      (f
        ? t("sets.previewSize", { w: f.width, h: f.height, z: f.zOffset >= 0 ? t("sets.zWith") : t("sets.zNo") })
        : t("sets.previewUndecodable")) +
      t("sets.previewPacked", { bytes: formatNumber(set.file.containers[cur.loc]?.data.length ?? 0) }) +
      (v
        ? t("sets.previewView", {
            id: v.viewID,
            name: v.viewName,
            deg: ((v.rotation * 180) / Math.PI).toFixed(1),
            r8: v.rotation8,
            h: v.cameraHeight.toFixed(3),
          }) +
          (fi
            ? t("sets.previewCamera", { x: fi.posX16, z: fi.posZ16, y: fi.posY16, axis: fi.axisX8 & 0xff })
            : "")
        : "")
    : t("sets.noStandpointFrame");
  drawOverlay();
}

/** the hotspot rectangles of the selected view, over the picture */
function drawOverlay(): void {
  const preview = $<HTMLCanvasElement>("preview");
  const canvas = $<HTMLCanvasElement>("overlay");
  canvas.width = preview.width;
  canvas.height = preview.height;
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const v = view();
  // the rectangles belong to the standpoint, so they only mean anything there
  if (!showHotspots || !v || selected) return;
  ctx.font = '9px "Courier New", monospace';
  ctx.textBaseline = "top";
  v.objects.forEach((o, i) => {
    const w = o.endRegionX - o.startRegionX;
    const h = o.endRegionY - o.startRegionY;
    ctx.strokeStyle = i === selectedObject ? "#e4f0fc" : "#60c0f0";
    ctx.lineWidth = 1;
    ctx.strokeRect(o.startRegionX + 0.5, o.startRegionY + 0.5, w, h);
    const label = o.identifier || `#${i}`;
    ctx.fillStyle = "rgba(0,6,15,0.78)";
    ctx.fillRect(o.startRegionX + 1, o.startRegionY + 1, ctx.measureText(label).width + 4, 11);
    ctx.fillStyle = i === selectedObject ? "#e4f0fc" : "#b4d8f0";
    ctx.fillText(label, o.startRegionX + 3, o.startRegionY + 2);
  });
}

/** the hotspot row the pointer is on, highlighted in the overlay */
let selectedObject = -1;

$("hotspotBtn").addEventListener("click", () => {
  showHotspots = !showHotspots;
  $("hotspotBtn").classList.toggle("on", showHotspots);
  drawOverlay();
});
$("hotspotBtn").classList.add("on");

// --- ring playback ----------------------------------------------------------

function stopPlayback(): void {
  playing?.stop();
  playing = null;
  $("playRing").textContent = t("sets.playTurn");
}

/**
 * Animate a list of frames in the preview at the game's rate, then run `done`.
 * The frames are the ring's own order, which is how the engine plays a turn or
 * a walk — one ring, decoded together.
 */
function playFrames(frames: FrameInfo[], ring: FrameInfo[], done: () => void): void {
  const canvas = $<HTMLCanvasElement>("preview");
  const images = decodeRing(ring);
  const shots = frames
    .map((fi) => images.get(fi.frameContainerLoc))
    .filter((f): f is CachedFrame => f !== undefined);
  if (!shots.length) {
    log(t("sets.noneDecode"));
    done();
    return;
  }
  drawOverlay();
  const start = performance.now();
  let raf = 0;
  let shown = -1;
  const step = (): void => {
    const i = Math.floor((performance.now() - start) / FRAME_MS);
    if (i >= shots.length) {
      stopPlayback();
      done();
      return;
    }
    if (i !== shown) {
      frameToCanvas(shots[i], canvas);
      shown = i;
    }
    raf = requestAnimationFrame(step);
  };
  raf = requestAnimationFrame(step);
  playing = { stop: () => cancelAnimationFrame(raf) };
}

$("playRing").addEventListener("click", () => {
  if (playing) {
    stopPlayback();
    renderPreview();
    return;
  }
  if (!set) return;
  const turn = turnRing(scene(), viewIdx, RIGHTTURNS);
  if (!turn) {
    log(t("sets.notInRightRing", { i: viewIdx }));
    return;
  }
  selected = null;
  $("playRing").textContent = t("sets.stopTurn");
  log(
    t("sets.turningRight", { n: turn.frames.length, name: scene().views[turn.target]?.viewName ?? turn.target }),
  );
  playFrames(turn.frames, scene().turns[RIGHTTURNS].frames, () => {
    // land on the standpoint the turn ends at, the way the game does
    viewIdx = turn.target;
    selectView(viewIdx);
  });
});

// --- lazy thumbnails --------------------------------------------------------

/**
 * Decoding and drawing every ring of a set up front is wasted work — the boat
 * deck has dozens. Thumbnails fill themselves in when they scroll into view.
 */
let observer: IntersectionObserver | null = null;
const pending = new Map<Element, () => void>();

function whenVisible(el: Element, fill: () => void): void {
  observer ??= new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      pending.get(e.target)?.();
      pending.delete(e.target);
      observer!.unobserve(e.target);
    }
  });
  pending.set(el, fill);
  observer.observe(el);
}

function resetObserver(): void {
  observer?.disconnect();
  observer = null;
  pending.clear();
}

// --- rendering --------------------------------------------------------------

function refresh(): void {
  if (!set) return;
  resetObserver();
  buildFileBar();
  buildSetFields();
  buildViews();
  buildObjects();
  buildFrames();
  buildRoads();
  buildActors();
  buildMaps();
  buildScripts();
  buildPalette();
  renderPreview();
}

/** re-render everything the selected view feeds, without rebuilding the file */
function selectView(idx: number): void {
  viewIdx = idx;
  selected = null;
  selectedObject = -1;
  buildViews();
  buildObjects();
  buildFrames();
  renderPreview();
}

function buildFileBar(): void {
  const s = set!;
  const views = s.scenes.reduce((n, sc) => n + sc.views.length, 0);
  const hotspots = s.scenes.reduce(
    (n, sc) => n + sc.views.reduce((m, v) => m + v.objects.length, 0),
    0,
  );
  $("fileStats").textContent =
    t("counts.containers", { n: s.file.containers.length }) + " · " +
    t("counts.scenes", { n: s.scenes.length }) + " · " +
    t("counts.views", { n: views }) + " · " +
    t("counts.hotspots", { n: hotspots }) + " · " +
    t("counts.roads", { n: s.transitions.length }) + " · " +
    t("counts.actorMarks", { n: s.actors.length });
}

function buildSceneSelect(): void {
  const sel = $<HTMLSelectElement>("sceneSel");
  sel.replaceChildren();
  set!.scenes.forEach((s, i) => {
    const o = document.createElement("option");
    o.value = String(i);
    o.textContent = `${i} ${s.sceneName} (${s.views.length} views)`;
    sel.appendChild(o);
  });
  sel.value = String(sceneIdx);
  sel.onchange = () => {
    stopPlayback();
    sceneIdx = Number(sel.value);
    viewIdx = 0;
    selected = null;
    selectedObject = -1;
    refresh();
  };
}

function buildSetFields(): void {
  const s = set!;
  const name = $<HTMLInputElement>("setName");
  name.value = s.setName;
  name.maxLength = SET_NAME_FIELD;
  name.title = t("sets.setNameTitle", { max: SET_NAME_FIELD });
  name.onchange = () => {
    if (name.value === s.setName) return;
    const stored = patchSetName(s, name.value);
    name.value = stored;
    name.classList.add("edited");
    markEdit(t("sets.setNameEdit", { name: stored }));
    log(t("sets.setNameNow", { name: stored }));
  };

  // the default standpoint and facing: pick from what the set actually has, so
  // the stored names can only be ones the engine will find
  const sceneSel = $<HTMLSelectElement>("defaultScene");
  const viewSel = $<HTMLSelectElement>("defaultView");
  sceneSel.replaceChildren();
  for (const sc of s.scenes) {
    const o = document.createElement("option");
    o.value = sc.sceneName;
    o.textContent = sc.sceneName;
    sceneSel.appendChild(o);
  }
  sceneSel.value = s.defaultSceneName;
  const fillViews = (): void => {
    const target = s.scenes.find((sc) => sc.sceneName === sceneSel.value);
    viewSel.replaceChildren();
    for (const v of target?.views ?? []) {
      const o = document.createElement("option");
      o.value = v.viewName;
      o.textContent = `${v.viewName} (#${v.viewID})`;
      viewSel.appendChild(o);
    }
    viewSel.value = s.defaultViewName;
    if (!viewSel.value && viewSel.options.length) viewSel.selectedIndex = 0;
  };
  fillViews();
  const apply = (): void => {
    const stored = patchDefaultStart(s, sceneSel.value, viewSel.value);
    markEdit(t("sets.defaultStartEdit", { scene: stored.scene, view: stored.view }));
    log(t("sets.defaultStartNow", { scene: stored.scene, view: stored.view }));
  };
  sceneSel.onchange = () => {
    fillViews();
    apply();
  };
  viewSel.onchange = apply;

  const scriptNote = s.mainScript ? t("sets.mainScriptAt", { loc: s.mainScript }) : t("sets.noMainScript");
  $("setInfo").innerHTML =
    t("sets.setInfo", {
      vw: s.viewPortWidth,
      vh: s.viewPortHeight,
      script: scriptNote,
      scenes: s.mainSceneRegister,
      roads: s.transitionRegister,
      actors: s.actorRegister,
      sx: s.setDimensionsX,
      sy: s.setDimensionsY,
      mw: s.mapWidth,
      mh: s.mapHeight,
      light: s.mapLight,
      dark: s.mapDark,
      levels: s.zLevelCount,
      far: s.zFarMax,
      per: (s.zFarMax / Math.max(1, s.zLevelCount)).toFixed(1),
    });
}

function buildViews(): void {
  const wrap = $("views");
  wrap.replaceChildren();
  const sc = scene();
  const sceneName = $<HTMLInputElement>("sceneName");
  sceneName.value = sc?.sceneName ?? "";
  sceneName.maxLength = SCENE_NAME_FIELD;
  sceneName.title = t("sets.sceneNameTitle", { max: SCENE_NAME_FIELD });
  sceneName.onchange = () => {
    if (!sc || sceneName.value === sc.sceneName) return;
    const stored = patchSceneName(set!, sceneIdx, sceneName.value);
    sceneName.value = stored;
    sceneName.classList.add("edited");
    markEdit(`scene ${sceneIdx} name → ${stored}`);
    buildSceneSelect();
    buildSetFields();
  };
  if (!sc) return;

  sc.views.forEach((v, i) => {
    const row = document.createElement("div");
    row.className = "viewrow" + (i === viewIdx ? " selected" : "");

    const pick = document.createElement("button");
    pick.className = "mini";
    pick.textContent = i === viewIdx ? "●" : "○";
    pick.title = t("sets.showThisView");
    pick.onclick = () => {
      stopPlayback();
      selectView(i);
    };
    row.appendChild(pick);

    const name = document.createElement("input");
    name.type = "text";
    name.className = "ident";
    name.value = v.viewName;
    name.maxLength = VIEW_NAME_FIELD;
    name.title = t("sets.viewNameTitle", { max: VIEW_NAME_FIELD });
    name.onchange = () => {
      if (name.value === v.viewName) return;
      const stored = patchViewName(set!, sceneIdx, i, name.value);
      name.value = stored;
      name.classList.add("edited");
      markEdit(`view ${sceneIdx}/${i} name → ${stored}`);
      buildSetFields();
      renderPreview();
    };
    row.appendChild(name);

    const meta = document.createElement("span");
    meta.className = "meta grow";
    const fi = standFrameInfo(i);
    meta.textContent =
      t("sets.viewMeta", {
        id: v.viewID,
        deg: ((v.rotation * 180) / Math.PI).toFixed(0),
        r8: v.rotation8,
        h: v.cameraHeight.toFixed(2),
      }) +
      t("counts.hotspots", { n: v.objects.length }) +
      (v.locationObjects ? ` @${v.locationObjects}` : "") +
      (fi
        ? t("sets.viewFrameAt", { loc: fi.frameContainerLoc, motion: fi.motionInfo })
        : t("sets.viewNoFrame"));
    row.appendChild(meta);

    wrap.appendChild(row);
  });
}

function buildObjects(): void {
  const wrap = $("objects");
  wrap.replaceChildren();
  const v = view();
  const objects = v?.objects ?? [];
  $("objInfo").textContent = v
    ? t("sets.objInfo", { n: objects.length, name: v.viewName }) +
      (v.locationObjects ? t("sets.objContainer", { loc: v.locationObjects }) : "") +
      t("sets.objRects")
    : "";
  if (!objects.length) {
    const empty = document.createElement("span");
    empty.className = "dim";
    empty.textContent = t("sets.noHotspots");
    wrap.appendChild(empty);
    return;
  }

  objects.forEach((o, i) => {
    const row = document.createElement("div");
    row.className = "objrow";
    row.onpointerenter = () => {
      selectedObject = i;
      drawOverlay();
    };
    row.onpointerleave = () => {
      selectedObject = -1;
      drawOverlay();
    };

    const lead = document.createElement("span");
    lead.className = "lead";
    lead.textContent = String(i);
    row.appendChild(lead);

    const id = document.createElement("input");
    id.type = "text";
    id.className = "ident";
    id.value = o.identifier;
    id.maxLength = OBJECT_ID_FIELD;
    id.title = t("sets.objIdTitle", { max: OBJECT_ID_FIELD });
    id.onchange = () => {
      if (id.value === o.identifier) return;
      const stored = patchObjectIdentifier(set!, sceneIdx, viewIdx, i, id.value);
      id.value = stored;
      id.classList.add("edited");
      markEdit(`hotspot ${sceneIdx}/${viewIdx}/${i} → ${stored}`);
      buildScripts();
      drawOverlay();
    };
    row.appendChild(id);

    const fields: Record<string, HTMLInputElement> = {};
    for (const [key, label, value] of [
      ["startX", "x", o.startRegionX],
      ["startY", "y", o.startRegionY],
      ["endX", "→x", o.endRegionX],
      ["endY", "→y", o.endRegionY],
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
        const region = {
          startX: Number(fields.startX.value) || 0,
          startY: Number(fields.startY.value) || 0,
          endX: Number(fields.endX.value) || 0,
          endY: Number(fields.endY.value) || 0,
        };
        patchObjectRegion(set!, sceneIdx, viewIdx, i, region);
        input.classList.add("edited");
        markEdit(
          `hotspot ${o.identifier || i} → ${region.startX},${region.startY}–${region.endX},${region.endY}`,
        );
        drawOverlay();
      };
      wrapper.appendChild(input);
      row.appendChild(wrapper);
    }

    const meta = document.createElement("span");
    meta.className = "meta grow";
    meta.textContent =
      `${Math.max(0, o.endRegionX - o.startRegionX)}×${Math.max(0, o.endRegionY - o.startRegionY)}px · ` +
      `rot ${o.rotation8}/256 · script @${o.locationScript}`;
    row.appendChild(meta);

    wrap.appendChild(row);
  });
}

function buildFrames(): void {
  const wrap = $("frames");
  wrap.replaceChildren();
  const sc = scene();
  if (!sc) return;
  const rows: { label: string; hint: string; frames: FrameInfo[] }[] = [
    {
      label: t("sets.turnRight"),
      hint: t("sets.turnRightHint"),
      frames: sc.turns[RIGHTTURNS].frames,
    },
    {
      label: t("sets.turnLeft"),
      hint: t("sets.turnLeftHint"),
      frames: sc.turns[LEFTTURNS].frames,
    },
  ];
  $("framesInfo").textContent =
    t("sets.framesInfo", { scene: sc.sceneName, right: rows[0].frames.length, left: rows[1].frames.length });

  for (const ring of rows) {
    const head = document.createElement("div");
    head.className = "ringhead";
    const title = document.createElement("span");
    title.textContent = `${ring.label} — ${ring.frames.length} frames`;
    title.title = ring.hint;
    head.appendChild(title);
    const play = document.createElement("button");
    play.className = "mini";
    play.textContent = t("sets.playRing");
    play.title = t("sets.playRingHint");
    play.onclick = () => {
      if (playing) {
        stopPlayback();
        renderPreview();
        return;
      }
      selected = null;
      playFrames(ring.frames, ring.frames, () => renderPreview());
    };
    head.appendChild(play);
    wrap.appendChild(head);
    wrap.appendChild(thumbStrip(ring.frames, ring.label));
  }
}

/** a row of frame thumbnails, decoded when it scrolls into view */
function thumbStrip(frames: FrameInfo[], label: string): HTMLElement {
  const strip = document.createElement("div");
  strip.className = "thumbs";
  if (!frames.length) {
    const empty = document.createElement("span");
    empty.className = "dim";
    empty.textContent = "no frames";
    strip.appendChild(empty);
    return strip;
  }
  frames.forEach((fi, i) => {
    const c = document.createElement("canvas");
    c.className = "thumb";
    c.width = 96;
    c.height = 50;
    if (fi.motionInfo > 0) c.classList.add("stand");
    if (selected?.loc === fi.frameContainerLoc) c.classList.add("selected");
    const stand = fi.motionInfo > 0 ? ` — standpoint of view ${fi.viewID}` : "";
    c.title = `${label} frame ${i} @${fi.frameContainerLoc} (motion ${fi.motionInfo})${stand}`;
    c.onclick = () => {
      stopPlayback();
      selected = { loc: fi.frameContainerLoc, label: `${label} frame ${i}`, ring: frames };
      buildFrames();
      renderPreview();
    };
    whenVisible(c, () => {
      const f = frameAt(fi.frameContainerLoc, frames);
      if (!f) return;
      const big = document.createElement("canvas");
      frameToCanvas(f, big);
      const ctx = c.getContext("2d")!;
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(big, 0, 0, c.width, c.height);
    });
    strip.appendChild(c);
  });
  return strip;
}

function buildRoads(): void {
  const wrap = $("roads");
  wrap.replaceChildren();
  const roads = set!.transitions;
  $("roadsInfo").textContent =
    t("counts.roads", { n: roads.length }) + t("sets.roadsInfoTail");
  if (!roads.length) {
    const empty = document.createElement("span");
    empty.className = "dim";
    empty.textContent = t("sets.noRoads");
    wrap.appendChild(empty);
    return;
  }
  roads.forEach((road, i) => {
    const row = document.createElement("div");
    row.className = "roadrow";

    const lead = document.createElement("span");
    lead.className = "lead";
    lead.textContent = String(i);
    row.appendChild(lead);

    const name = document.createElement("input");
    name.type = "text";
    name.className = "ident";
    name.value = road.transitionName;
    name.maxLength = TRANSITION_NAME_FIELD;
    name.title = t("sets.roadNameTitle", { max: TRANSITION_NAME_FIELD });
    name.onchange = () => {
      if (name.value === road.transitionName) return;
      const stored = patchTransitionName(set!, i, name.value);
      name.value = stored;
      name.classList.add("edited");
      markEdit(`road ${i} name → ${stored}`);
      renderPreview();
    };
    row.appendChild(name);

    const meta = document.createElement("span");
    meta.className = "meta grow";
    meta.textContent =
      `view #${road.viewIDstart} → #${road.viewIDend} · ` +
      `${road.frameRegisters[0].frames.length}/${road.frameRegisters[1].frames.length} frames · ` +
      t("counts.waypoints", { n: road.waypoints.length }) + ` · info @${road.locationTransitionInfo}`;
    row.appendChild(meta);

    for (const [dir, arrow] of [
      [0, "▶ →"],
      [1, "▶ ←"],
    ] as const) {
      const b = document.createElement("button");
      b.className = "mini";
      b.textContent = arrow;
      b.title = dir === 0 ? t("sets.walkForward") : t("sets.walkBack");
      b.onclick = () => {
        if (playing) {
          stopPlayback();
          renderPreview();
          return;
        }
        const frames = road.frameRegisters[dir].frames;
        selected = null;
        log(`walking "${road.transitionName}" ${dir === 0 ? "→" : "←"}: ${frames.length} frames`);
        playFrames(frames, frames, () => renderPreview());
      };
      row.appendChild(b);
    }

    wrap.appendChild(row);
  });
}

function buildActors(): void {
  const wrap = $("actors");
  wrap.replaceChildren();
  const actors = set!.actors;
  $("actorsInfo").textContent =
    t("counts.actorMarks", { n: actors.length }) +
    ` @${set!.actorRegister}` +
    t("sets.actorsInfoTail");
  if (!actors.length) {
    const empty = document.createElement("span");
    empty.className = "dim";
    empty.textContent = t("sets.noActorMarks");
    wrap.appendChild(empty);
    return;
  }
  actors.forEach((a, i) => {
    const row = document.createElement("div");
    row.className = "actorrow";

    const lead = document.createElement("span");
    lead.className = "lead";
    lead.textContent = String(i);
    row.appendChild(lead);

    const id = document.createElement("input");
    id.type = "text";
    id.className = "ident";
    id.value = a.identifier;
    id.maxLength = a.idLimit;
    id.title = t("sets.starNameTitle", { max: a.idLimit });
    id.onchange = () => {
      if (id.value === a.identifier) return;
      patchActor(set!, i, { identifier: id.value });
      id.value = a.identifier;
      id.classList.add("edited");
      markEdit(`actor ${i} → ${a.identifier}`);
      buildScripts();
    };
    row.appendChild(id);

    const fields: Record<string, HTMLInputElement> = {};
    for (const [key, label, value] of [
      ["positionX", "x", a.positionX],
      ["positionZ", "z", a.positionZ],
      ["positionY", "y", a.positionY],
      ["rotation8", "rot", a.rotation8],
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
        patchActor(set!, i, {
          positionX: Number(fields.positionX.value) || 0,
          positionZ: Number(fields.positionZ.value) || 0,
          positionY: Number(fields.positionY.value) || 0,
          rotation8: Number(fields.rotation8.value) || 0,
        });
        input.classList.add("edited");
        markEdit(
          `actor ${a.identifier || i} → ${a.positionX},${a.positionZ},${a.positionY} rot ${a.rotation8}`,
        );
      };
      wrapper.appendChild(input);
      row.appendChild(wrapper);
    }

    const meta = document.createElement("span");
    meta.className = "meta grow";
    meta.textContent = `record @${a.record}`;
    row.appendChild(meta);

    wrap.appendChild(row);
  });
}

function buildMaps(): void {
  const wrap = $("maps");
  wrap.replaceChildren();
  for (const [name, loc] of [
    ["lit", set!.mapLight],
    ["dark", set!.mapDark],
  ] as const) {
    const fig = document.createElement("figure");
    const canvas = document.createElement("canvas");
    const caption = document.createElement("figcaption");
    const data = set!.file.containers[loc]?.data;
    let decoded: { width: number; height: number } | null = null;
    if (data) {
      const fb = new FrameBuffer();
      try {
        const d = decodeFrame(data, fb);
        decoded = d;
        frameToCanvas(
          { pixels: fb.pixels, width: d.width, height: d.height, zOffset: d.zOffset },
          canvas,
          mapPalette,
        );
      } catch {
        decoded = null;
      }
    }
    const label = document.createElement("span");
    label.textContent = decoded
      ? t("sets.deckPlan", { name, loc, w: decoded.width, h: decoded.height })
      : t("sets.deckPlanUndecodable", { name, loc });
    caption.appendChild(label);
    if (decoded) {
      const dl = document.createElement("button");
      dl.className = "mini";
      dl.textContent = "⬇ PNG";
      dl.onclick = () =>
        canvas.toBlob((b) => {
          if (b) download(b, `${baseName()}.map-${name}.png`);
        }, "image/png");
      caption.appendChild(dl);
    }
    fig.appendChild(canvas);
    fig.appendChild(caption);
    wrap.appendChild(fig);
  }
}

function buildScripts(): void {
  const wrap = $("scripts");
  wrap.replaceChildren();
  const s = set!;
  const sc = scene();
  const entries: { label: string; loc: number }[] = [];
  if (s.mainScript) entries.push({ label: t("sets.mainScriptLabel"), loc: s.mainScript });
  for (const other of s.scenes) {
    if (other.locationScript) {
      entries.push({ label: `scene “${other.sceneName}”`, loc: other.locationScript });
    }
  }
  for (const v of sc?.views ?? []) {
    for (const o of v.objects) {
      if (o.locationScript) {
        entries.push({ label: `hotspot “${o.identifier}” (${sc.sceneName}/${v.viewName})`, loc: o.locationScript });
      }
    }
  }
  if (!entries.length) {
    const empty = document.createElement("span");
    empty.className = "dim";
    empty.textContent = t("sets.noScripts");
    wrap.appendChild(empty);
    return;
  }
  for (const e of entries) {
    const det = document.createElement("details");
    det.className = "script";
    const sum = document.createElement("summary");
    sum.textContent = `${e.label} (container @${e.loc})`;
    det.appendChild(sum);
    const pre = document.createElement("pre");
    // decompiling is only worth it when opened — a set carries dozens
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
    t("sets.paletteInfo", { n: set!.colorCount });
  for (let i = 0; i < 256; i++) {
    const d = document.createElement("div");
    d.style.background = `rgb(${mapPalette[i * 4]},${mapPalette[i * 4 + 1]},${mapPalette[i * 4 + 2]})`;
    d.title = `${i}: rgb(${mapPalette[i * 4]},${mapPalette[i * 4 + 1]},${mapPalette[i * 4 + 2]})` +
      (i < set!.colorCount ? t("sets.usedByViewFrames") : "");
    if (i === set!.colorCount - 1) d.className = "split";
    wrap.appendChild(d);
  }
}

// --- PNG round trip ---------------------------------------------------------

const baseName = (): string => fileName.replace(/\.set$/i, "").toLowerCase();

$("pngExportBtn").addEventListener("click", () => {
  const cur = currentFrame();
  const f = cur ? frameAt(cur.loc, cur.ring) : null;
  if (!f) return;
  const c = document.createElement("canvas");
  frameToCanvas(f, c);
  c.toBlob((blob) => {
    if (blob) download(blob, `${baseName()}.frame${cur!.loc}.png`);
  }, "image/png");
});

const pngInput = $<HTMLInputElement>("pngInput");
$("pngImportBtn").addEventListener("click", () => pngInput.click());
pngInput.addEventListener("change", () => {
  const file = pngInput.files?.[0];
  pngInput.value = "";
  const cur = currentFrame();
  if (file && cur) void importPng(file, cur);
});

/**
 * Replace a frame's art with an image file: pixels are matched to the set's
 * view palette (nearest RGB over the first {@link SetFile.colorCount} entries),
 * and the frame is re-encoded self-contained, so the rest of its delta chain
 * still decodes. The Z layer — the depth image that hides actors behind
 * scenery — is carried over when the replacement is the same size, and dropped
 * when it isn't, since its runs are laid out against those dimensions.
 */
async function importPng(
  file: File,
  cur: { loc: number; label: string; ring: FrameInfo[] },
): Promise<void> {
  if (!set) return;
  const old = frameAt(cur.loc, cur.ring);
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

  const sameSize = old && old.width === bmp.width && old.height === bmp.height;
  const container = set.file.containers[cur.loc];
  const zBlock =
    sameSize && old.zOffset >= 0 ? container.data.subarray(old.zOffset) : undefined;
  const data = encodeFrame(pixels, bmp.width, bmp.height, zBlock);
  set.file.containers[cur.loc] = { id: container.id, data };
  invalidateFrame(cur.loc);
  markEdit(t("sets.artEdit", { loc: cur.loc, file: file.name }));
  log(
    t("sets.artReplaced", {
      loc: cur.loc,
      file: file.name,
      w: bmp.width,
      h: bmp.height,
      kb: (data.length / 1024).toFixed(1),
      was: (container.data.length / 1024).toFixed(1),
    }) +
      (old && !sameSize ? t("sets.artSizeWarn", { w: old.width, h: old.height }) : ""),
  );
  buildFrames();
  renderPreview();
}

function nearestPaletteIndex(r: number, g: number, b: number): number {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < set!.colorCount; i++) {
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
  if (!set) return;
  const bytes = writeContainerFile(set.file);
  try {
    readSetFile(bytes); // sanity: the export must read back as a set
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
