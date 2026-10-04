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
 * decodeShpFrame); writing is the patches in engine/src/df/shp.ts plus encodeShpFrame/
 * writeContainerFile, so an untouched load exports the file it read (see
 * taoot/tests/auto/shp-editor.ts).
 */
import { paletteToRGBA } from "@dreamfactory/engine/df/image";
import { byExtension, chosenSource, filesIn, listSources, screenOf, V5_READ_ONLY, isV5File } from "./sources";
import {
  appendScripts,
  artSizes,
  drawScreenBands,
  exportContainerFile,
  fillSwatches,
  installEditorPage,
  paintFrame,
  readImage,
  savePng,
  serverNote,
  serverRow,
  spriteFromImage,
  wireFileOpen,
  wirePngImport,
} from "./editor-kit";
import { t, formatNumber } from "@dreamfactory/site/locales";
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
} from "@dreamfactory/engine/df/shp";
import type { GameScreen } from "@dreamfactory/site/games";
import { DecodedAudio, decodeAudioContainer } from "@dreamfactory/engine/df/audio";
import { play as playSound, stopPlayback as stopSound } from "./playback";

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const landing = $("landing");
const editor = $("editor");
const statusEl = $("status");
const dirtyEl = $("dirty");

/** the cadence props animate at — PropRuntime.tick's frameMs, which the viewer
 *  has always passed as ENGINE_STEP_MS; this said 90 and was never the game's */
const FRAME_MS = 50;
/**
 * The screen this rip's props are authored against, and where its UI band starts.
 *
 * A SHP records neither — a prop is a bitmap and a stored offset, and the screen
 * it lands on is the GAME's (see `screenOf`). Titanic's and Dust's is 512×384
 * with the set view above y=264; Timelapse's is 640×480 with no band at all, and
 * drawing its compass on a 512×384 field put it 64,48 from where the game puts
 * it. The default holds until the source is known, which is one await away at
 * startup.
 */
let screen: GameScreen = screenOf(null);

/** where a prop draws before any propxy: the CENTRE of the screen */
const anchorHome = (): { x: number; y: number } => ({
  x: Math.floor(screen.width / 2),
  y: Math.floor(screen.height / 2),
});

// --- editor state -----------------------------------------------------------

let shp: ShpFile | null = null;
let fileName = "props.shp";
let palette: Uint8ClampedArray = new Uint8ClampedArray(1024);
/** decoded frames by container location (one shop open at a time) */
const frameCache = new Map<number, ShpFrame>();
/** decoded view sounds by container location (PropState.sound); null = undecodable */
const soundCache = new Map<number, DecodedAudio | null>();
/** human-readable notes of every edit, shown next to the export button */
const edits: string[] = [];
let groupIdx = 0;
let stateIdx = 0;
let frameIdx = 0;
/** the anchor the preview draws at — propxy, simulated */
const anchor = anchorHome();
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

/** a DreamFactory 5 file, open read-only (see `isV5File`) */
let readOnly = false;

function loadShp(bytes: Uint8Array, name: string): void {
  stopPlayback();
  stopSound();
  let parsed: ShpFile;
  try {
    parsed = readShpFile(bytes);
  } catch (e) {
    log(t("common.notReadable", { ext: ".shp", message: (e as Error).message }));
    return;
  }
  shp = parsed;
  fileName = name;
  // and the export button says which extension it will WRITE, which is the one
  // this file came in as: a v1 `.flt`/`.prp` round-trips as itself
  $("exportBtn").textContent = t("shops.export", { ext: /\.[a-z0-9]+$/i.exec(name)?.[0]?.toLowerCase() ?? "" });
  palette = paletteToRGBA(parsed.paletteRaw, 256);
  frameCache.clear();
  soundCache.clear();
  edits.length = 0;
  // a v5 file reads but cannot be written yet (sources.ts)
  readOnly = isV5File(bytes);
  dirtyEl.textContent = readOnly ? V5_READ_ONLY : "";
  // a button that refuses when pressed is worse than one that says so first
  ($("exportBtn") as HTMLButtonElement).disabled = readOnly;
  groupIdx = 0;
  stateIdx = 0;
  frameIdx = 0;
  // the anchor, and the two fields that SAY where it is: the markup's own 256,192
  // is this screen's centre only on two of the three games, and a field reading
  // 256 over a prop drawn at 320 is worse than no field at all
  const home = anchorHome();
  anchor.x = home.x;
  anchor.y = home.y;
  $<HTMLInputElement>("anchorX").value = String(anchor.x);
  $<HTMLInputElement>("anchorY").value = String(anchor.y);

  landing.style.display = "none";
  editor.style.display = "flex";
  $("fileName").textContent = name;
  log("");
  buildGroupSelect();
  refresh();
}

wireFileOpen(async (f) => loadShp(new Uint8Array(await f.arrayBuffer()), f.name));

/** dev-server mode: offer every .shp in the gamefiles manifest */
async function initServerShops(): Promise<void> {
  // Only the chosen EDITION's copies: an install with six of them holds six
  // `bedsit1.set`, and listing all six lists the same room six times under
  // names that cannot be told apart. The edition row at the top of the page is
  // what chooses, and it is the same choice the game reads (taoot/src/editions.ts).
  const source = chosenSource(await listSources());
  if (!source) return; // production / no dev server: upload only
  // before any of this rip's props are drawn — see the note on `screen`
  screen = screenOf(source);
  // `.prp` as well: it is the same format under DreamFactory 1's name for it, and
  // the reader takes both (`readShpFile` accepts version 1 and 4 through one
  // layout — the PRP header did not move). Dust ships 14 of them and they were
  // invisible here, which is a third of its props.
  const shops = filesIn(source, byExtension(".shp", ".prp", ".shop"));
  if (!shops.length) return;
  const wrap = $("serverShops");
  serverNote(wrap, t("common.pickFromGamefiles"));
  serverRow(wrap, {
    source,
    files: shops,
    rowClass: "shops",
    buttonClass: "shop",
    log,
    open: (bytes, f) => loadShp(bytes, f.base),
  });
}
const serverListed = initServerShops();

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

/** a view's sound, decoded once — the same chunk reader the track editor uses */
function soundAt(loc: number): DecodedAudio | null {
  if (!shp) return null;
  if (!soundCache.has(loc)) {
    let a: DecodedAudio | null = null;
    try {
      a = decodeAudioContainer(shp.file.containers[loc].data);
    } catch {
      /* stays null: listed, not playable */
    }
    soundCache.set(loc, a);
  }
  return soundCache.get(loc) ?? null;
}

/** paint a decoded frame into a canvas at 1:1, transparent where masked */
const frameToCanvas = (f: ShpFrame, canvas: HTMLCanvasElement): void => paintFrame(f, canvas, palette);

// --- preview ----------------------------------------------------------------

/**
 * Draw one frame where the engine would put it: at `anchor - storedOffset` on the
 * game's own screen (see the placement rule in docs/engine/formats/shp.md), over a
 * backdrop that marks the room view / UI band split and the anchor itself. The
 * anchor is what `propxy` moves, so the two inputs beside the canvas are that
 * command, simulated.
 *
 * The band line is drawn only where the game HAS one: a game with no sets has no
 * room view to end, so the line would be a boundary of Titanic's rather than of
 * the rip on screen.
 */
function drawScreen(f: ShpFrame | null): void {
  const canvas = $<HTMLCanvasElement>("preview");
  canvas.width = screen.width;
  canvas.height = screen.height;
  const ctx = canvas.getContext("2d")!;
  drawScreenBands(ctx, screen);

  if (f?.width && f.height) {
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
  if (!st) {
    $("previewInfo").innerHTML = t("shops.noStates");
    return;
  }
  let info =
    t("shops.previewHead", {
      name: group().name || t("shops.unnamedProp"),
      state: st.identifier,
      i: frameIdx + 1,
      n: st.frames.length,
    }) + (loc === undefined ? "" : t("shops.previewContainer", { loc }));
  if (f) {
    info +=
      t("shops.previewSize", {
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
      });
  } else {
    info += t("shops.previewNotFrame");
  }
  $("previewInfo").innerHTML = info;
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
  const home = anchorHome();
  anchor.x = home.x;
  anchor.y = home.y;
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
    if (still) {
      kind.textContent = "still";
      kind.title = t("shops.onePose");
    } else if (st.animated) {
      kind.textContent = "animation";
      kind.title = t("shops.playsInOrder");
    } else {
      kind.textContent = "selector";
      kind.title = t("shops.degPicksOne");
    }
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

    // a DreamFactory 5 view may name a sound (Villains Revenge's shops do);
    // when the game plays it is not known, so here it only plays on request
    if (st.sound !== undefined) {
      const audio = soundAt(st.sound);
      const secs = audio ? audio.samples.length / Math.max(1, audio.sampleRate) : 0;
      meta.textContent += t("shops.soundMeta", {
        loc: st.sound,
        rate: audio?.sampleRate ?? 0,
        secs: secs.toFixed(2),
      });
      const listen = document.createElement("button");
      listen.className = "mini";
      listen.textContent = "♪";
      listen.title = t("shops.playSound");
      listen.disabled = !audio;
      listen.onclick = () => {
        if (audio) playSound(audio, listen);
      };
      row.appendChild(listen);
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
  if (!st) {
    $("framesInfo").textContent = "";
    return;
  }
  $("framesInfo").textContent =
    t("shops.framesHeadState", { state: st.identifier }) +
    t("counts.frames", { n: st.frames.length }) +
    (st.animated ? t("shops.inPlayOrder") : t("shops.degVariants"));
  st.frames.forEach((loc, i) => {
    const f = frameAt(loc);
    const cell = document.createElement("div");
    cell.className = "framecell" + (i === frameIdx ? " selected" : "");
    const c = document.createElement("canvas");
    c.className = "thumb";
    if (f?.width && f.height) {
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
  appendScripts(wrap, entries, s.file.containers);
}

function buildPalette(): void {
  fillSwatches($("palette"), palette);
  $("paletteInfo").textContent =
    t("shops.paletteInfo");
}

// --- PNG round trip ---------------------------------------------------------

const baseName = (): string => fileName.replace(/\.shp$/i, "").toLowerCase();

$("pngExportBtn").addEventListener("click", () => {
  const loc = frameLoc();
  const f = loc === undefined ? null : frameAt(loc);
  if (!f) return;
  const c = document.createElement("canvas");
  frameToCanvas(f, c);
  savePng(c, `${baseName()}.${group().name || groupIdx}.${state()!.identifier}.f${frameIdx}.png`);
});

wirePngImport((file) => {
  const loc = frameLoc();
  if (loc !== undefined) void importPng(file, loc);
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
  const img = await readImage(file, log);
  if (!img) return;
  const frame = spriteFromImage(img, palette, old);
  const container = shp.file.containers[loc];
  const data = encodeShpFrame(frame);
  shp.file.containers[loc] = { id: container.id, data };
  frameCache.delete(loc);
  markEdit(t("shops.artEdit", { loc, file: file.name }));
  log(
    t("shops.artReplaced", {
      loc,
      ...artSizes(file, img, data, container.data),
    }) +
      (old && (old.width !== img.width || old.height !== img.height)
        ? t("shops.artSizeWarn", { w: old.width, h: old.height })
        : ""),
  );
  buildFrames();
  renderPreview();
}

// --- export -----------------------------------------------------------------

$("exportBtn").addEventListener("click", () => {
  if (!shp) return;
  if (readOnly) {
    log(V5_READ_ONLY);
    return;
  }
  // sanity: the export must read back as a shop
  exportContainerFile(shp.file, readShpFile, fileName, edits, log);
});

void installEditorPage();
await serverListed;
