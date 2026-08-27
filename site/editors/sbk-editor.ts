/**
 * Sprite Book Viewer (books.html) — the eighth of the browser pages over the DF
 * library, and the only one that cannot write.
 *
 * Load a `.sbk` (upload, drag-and-drop, or pick one off the dev server's
 * gamefiles manifest), take it apart into what a sprite book is made of — the
 * cel directory, the level's named plan, the parallax backdrop — and look at it.
 * Reading is `engine/src/df/sbk.ts` and `decodeShpFrame`, the same code
 * `tools/dumpsbk.ts` uses; the module comment over there is where the four
 * structures are written down.
 *
 * ## Why there is no export
 *
 * The other seven editors round-trip: read with the game's reader, write with
 * the format's own patches, and prove an untouched load exports the file it read.
 * Nothing writes a sprite book, because nothing reads one but this — so an export
 * button here would be a promise with no test behind it. When something needs to
 * write one, `sbk.ts` is where the patches go and this page grows a button.
 *
 * ## The one number on this page that is not in the file
 *
 * A backdrop placement stores a world position and a parallax factor, and the
 * factor is a RATE — how fast that layer moves against the camera. What it does
 * not store is where the camera starts, because that belonged to `SC.EXE`. So:
 *
 * - with **parallax scroll off**, every layer sits at its stored position and the
 *   picture is exactly what the file says. Pan, and the layers slide together.
 * - with it **on**, a layer moves at `camera / factor`, which is what a
 *   side-scroller does and what makes these read as places. At the camera's
 *   origin the two views are identical, so the approximation costs nothing until
 *   you move — and the origin is chosen from the file rather than invented: it is
 *   the level's own `initplayer` rect, the one entity that says where the game
 *   starts. {@link cameraHome}.
 *
 * Labelled as approximate on the page, because a viewer that quietly invents a
 * camera is worse than one that says it did.
 *
 * ## Drawing
 *
 * Placements are drawn in the ENGINE's paint order — `placementZ`, the plane
 * order SC.EXE composites in, so plane 2 (the lamp-post and cables) lands in
 * FRONT — and only when they intersect the view, which is what makes an
 * 11200×3265 level pannable without compositing the whole thing. A mirrored cel
 * reflects about its stored anchor, not its centre, matching the rect builder.
 * The ground and entity annotations draw last, on top, so they are never hidden
 * behind a foreground plane. Each cel is decoded once and reused.
 */
import { paletteToRGBA } from "@dreamfactory/engine/df/image";
import { ShpFrame, decodeShpFrame } from "@dreamfactory/engine/df/shp";
import {
  SbkEntity,
  SbkFile,
  SbkPlacement,
  SbkRoom,
  isMidpoint,
  isSbkFile,
  levelNumber,
  nearestLayer,
  placementRate,
  placementZ,
  readRooms,
  readSbkFile,
} from "@dreamfactory/engine/df/sbk";
import { installGamesMenu } from "@dreamfactory/site/games-menu";
import { installLanguageMenu } from "@dreamfactory/site/lang-menu";
import { installVersion } from "@dreamfactory/site/version";
import { installI18n, t } from "@dreamfactory/site/locales";
import { byExtension, chosenSource, filesIn, installSourcePicker, listSources } from "./sources";

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const landing = $("landing");
const editor = $("editor");
const statusEl = $("status");
const stage = $("stage");
const canvas = $<HTMLCanvasElement>("level");
const ctx = canvas.getContext("2d")!;

/**
 * How an entity kind is drawn. Names not on this list are grouped by prefix —
 * `init*` is a spawn and `stat*` is a pickup, which between them are most of a
 * level — and anything else is grey, so a name this port has never seen still
 * appears rather than being silently dropped.
 */
const KIND_COLORS: Record<string, string> = {
  platform: "#20e020",
  obstacle: "#e040e0",
  ladder: "#e8e020",
  goal: "#ff3030",
  door: "#ff9020",
  switch: "#ff9020",
};
/** the walkable floor a region stores — see SbkRegion */
const GROUND = "#ff40a0";
/** a room's own rect, and the dashed variant for the four rooms with no floor */
const ROOM = "#40e0d0";
const ROOM_NO_FLOOR = "#708080";
/** an `exitroom`: the door, its stored point, and the way through */
const DOOR = "#ffd040";
const SPAWN = "#30a8ff";
const PICKUP = "#ff9020";
const OTHER = "#a0a0a0";

function colorOf(name: string): string {
  return (
    KIND_COLORS[name] ??
    (name.startsWith("init") ? SPAWN : name.startsWith("stat") ? PICKUP : OTHER)
  );
}

/** the legend's rows, in the order it lists them */
const LEGEND: readonly [string, string][] = [
  ["platform", KIND_COLORS.platform],
  ["obstacle", KIND_COLORS.obstacle],
  ["ladder", KIND_COLORS.ladder],
  ["goal", KIND_COLORS.goal],
  ["door / switch", KIND_COLORS.door],
  ["init* (spawns)", SPAWN],
  ["stat* (pickups)", PICKUP],
  ["everything else", OTHER],
];

// ---- state ------------------------------------------------------------------

let book: SbkFile | null = null;
let rooms: SbkRoom[] = [];
/** cel container location -> the decoded cel, drawn once and kept */
const celCanvas = new Map<number, HTMLCanvasElement>();
const celFrame = new Map<number, ShpFrame>();
/** this book's palette as RGBA, or null */
let rgba: Uint8ClampedArray | null = null;
/** placements in engine paint order (plane z), with their cel resolved */
let drawList: (SbkPlacement & { location: number })[] = [];
/** which parallax factors are shown */
const hidden = new Set<number>();
/** the camera, in world coordinates, at the middle of the view */
let camX = 0;
let camY = 0;
/**
 * The default zoom shows the world at the GAME's magnification: one 512-px game
 * screen across the canvas, the way the play pages present it. Zooming out to
 * survey a whole level is a wheel or a pinch away, not the default view.
 */
const GAME_SCALE = canvas.width / 512;
let scale = GAME_SCALE;
let selectedCel = -1;

const log = (s: string): void => {
  statusEl.textContent = s;
};

// ---- loading ----------------------------------------------------------------

function loadBook(bytes: Uint8Array, name: string): void {
  if (!isSbkFile(bytes)) {
    // `.sbk` is also a RIFF SoundFont's extension, and the DirectX drivers on
    // Skull Cracker's own Windows disc ship one. Say which it is.
    log(`${name} is not a DreamFactory container — a RIFF SoundFont bank, if it came off the disc`);
    return;
  }
  let sbk: SbkFile;
  try {
    sbk = readSbkFile(bytes);
  } catch (e) {
    log(`${name}: ${(e as Error).message}`);
    return;
  }
  book = sbk;
  rooms = readRooms(sbk);
  celCanvas.clear();
  celFrame.clear();
  hidden.clear();
  selectedCel = -1;
  rgba = sbk.paletteRaw ? paletteToRGBA(sbk.paletteRaw, 256) : null;

  // in the engine's paint order (plane z), not by parallax rate — so the
  // lamp-post and cables (plane 2) land in front, the way the game draws them.
  // Stable within a plane, which is the order the records themselves give.
  drawList = sbk.placements
    .map((p, i) => ({ ...p, location: sbk.byId.get(p.id) ?? -1, seq: i }))
    .filter((p) => p.location >= 0)
    .sort((a, b) => placementZ(a) - placementZ(b) || a.seq - b.seq);

  // `style.display`, not `hidden`: editor.css declares `#editor { display: none }`
  // and an id rule beats the UA's `[hidden]`, so the attribute alone leaves both
  // panes invisible. This is the convention the other seven pages use.
  landing.style.display = "none";
  editor.style.display = "flex";
  $("fileName").textContent = name;
  $("fileStats").textContent =
    `${sbk.file.containers.length} containers · ${sbk.cels.length} cels · ` +
    `${sbk.entities.length} entities · ${sbk.placements.length} placements · ${sbk.file.order}`;
  const unresolved = sbk.placements.length - drawList.length;
  log(
    unresolved
      ? `${unresolved} placement(s) name a cel the directory does not — those are not drawn`
      : sbk.placements.length
        ? `every placement resolves to a cel`
        : `no level in this book — the player's own book has cels and no place to put them`,
  );

  buildLayers();
  buildLegend();
  buildPlan();
  buildCels();
  cameraHome();
}

async function loadFromFile(f: File): Promise<void> {
  loadBook(new Uint8Array(await f.arrayBuffer()), f.name);
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

/**
 * Dev-server mode: offer every `.sbk` there is.
 *
 * The other seven pages list the CHOSEN source and stop, because every game has
 * shops and movies and tracks. Exactly one has sprite books — so a reader
 * arriving with Dust or Titanic remembered from another editor would be shown an
 * empty landing page and no reason for it. This falls through to whichever source
 * actually has books, and says which one it settled on.
 */
async function initServerBooks(): Promise<void> {
  const sources = await listSources();
  let source = chosenSource(sources);
  if (!source) return; // production / no dev server: upload only
  let books = filesIn(source, byExtension(".sbk"));
  const chose = source;
  if (!books.length) {
    const elsewhere = sources.find((s) => filesIn(s, byExtension(".sbk")).length > 0);
    if (!elsewhere) return;
    source = elsewhere;
    books = filesIn(elsewhere, byExtension(".sbk"));
  }
  const wrap = $("serverBooks");
  const note = document.createElement("div");
  note.className = "note";
  note.textContent =
    source === chose
      ? t("common.pickFromGamefiles")
      : `${t("common.pickFromGamefiles")} — ${source.game.short}, the only source here with sprite books in it`;
  wrap.appendChild(note);
  const row = document.createElement("div");
  row.className = "row books";
  // in the order the game plays them, not the order the directory sorts them —
  // see LEVEL_ORDER, which is recovered from SC.EXE and not from the discs
  books.sort((a, b) => (levelNumber(a.base) || 99) - (levelNumber(b.base) || 99));
  for (const f of books) {
    const n = levelNumber(f.base);
    const b = document.createElement("button");
    b.className = "book";
    b.textContent = n ? `${n}. ${f.base}` : f.base;
    b.title = `${source.game.short} · ${f.path}${n ? ` · level ${n} of 16` : " · the player, not a level"}`;
    b.addEventListener("click", async () => {
      log(t("common.loading", { path: f.path }));
      const r = await fetch(f.url);
      if (!r.ok) {
        log(t("common.fetchFailed", { path: f.path, status: r.status }));
        return;
      }
      loadBook(new Uint8Array(await r.arrayBuffer()), f.base);
    });
    row.appendChild(b);
  }
  wrap.appendChild(row);
}
void initServerBooks();

$("closeBtn").addEventListener("click", () => {
  book = null;
  rooms = [];
  drawList = [];
  editor.style.display = "none";
  landing.style.display = "block";
  log("");
});

// ---- cels -------------------------------------------------------------------

/** decode one cel and keep it as a canvas, transparent where the codec says */
function celAt(location: number): HTMLCanvasElement | null {
  const had = celCanvas.get(location);
  if (had) return had;
  const container = book?.file.containers[location];
  if (!container || !rgba) return null;
  let frame: ShpFrame;
  try {
    frame = decodeShpFrame(container.data);
  } catch {
    return null;
  }
  const c = document.createElement("canvas");
  c.width = frame.width;
  c.height = frame.height;
  const cc = c.getContext("2d")!;
  const img = cc.createImageData(frame.width, frame.height);
  for (let i = 0; i < frame.width * frame.height; i++) {
    if (!frame.opaque[i]) continue; // alpha stays 0
    const p = frame.indexed[i] * 4;
    img.data[i * 4] = rgba[p];
    img.data[i * 4 + 1] = rgba[p + 1];
    img.data[i * 4 + 2] = rgba[p + 2];
    img.data[i * 4 + 3] = 255;
  }
  cc.putImageData(img, 0, 0);
  celFrame.set(location, frame);
  celCanvas.set(location, c);
  return c;
}

function buildCels(): void {
  const wrap = $("cels");
  wrap.textContent = "";
  if (!book) return;
  $("celStats").textContent = `${book.cels.length} in the directory`;
  const THUMB = 48;
  for (const cel of book.cels) {
    const b = document.createElement("button");
    b.type = "button";
    b.setAttribute("aria-pressed", "false");
    b.title = `id ${cel.id} · ${cel.width}×${cel.height} · anchor ${cel.posX},${cel.posY} · container ${cel.location}`;
    const c = document.createElement("canvas");
    c.width = THUMB;
    c.height = THUMB;
    const art = celAt(cel.location);
    if (art) {
      const cc = c.getContext("2d")!;
      cc.imageSmoothingEnabled = false;
      const k = Math.min(THUMB / art.width, THUMB / art.height, 1);
      const w = Math.max(1, Math.round(art.width * k));
      const h = Math.max(1, Math.round(art.height * k));
      cc.drawImage(art, (THUMB - w) >> 1, (THUMB - h) >> 1, w, h);
    }
    b.appendChild(c);
    b.addEventListener("click", () => showCel(cel.location, b));
    wrap.appendChild(b);
  }
  if (book.cels.length) showCel(book.cels[0].location, wrap.firstElementChild as HTMLElement);
}

function showCel(location: number, button: HTMLElement | null): void {
  for (const b of $("cels").querySelectorAll('button[aria-pressed="true"]')) {
    b.setAttribute("aria-pressed", "false");
  }
  button?.setAttribute("aria-pressed", "true");
  selectedCel = location;
  const view = $<HTMLCanvasElement>("celView");
  const vc = view.getContext("2d")!;
  vc.clearRect(0, 0, view.width, view.height);
  const art = celAt(location);
  const cel = book?.cels.find((c) => c.location === location);
  if (!art || !cel) return;
  vc.imageSmoothingEnabled = false;
  const k = Math.min(view.width / art.width, view.height / art.height);
  const w = Math.round(art.width * k);
  const h = Math.round(art.height * k);
  vc.drawImage(art, (view.width - w) >> 1, (view.height - h) >> 1, w, h);
  const placed = drawList.filter((p) => p.location === location).length;
  $("celInfo").textContent =
    `id ${cel.id} · ${cel.width}×${cel.height} · anchor ${cel.posX},${cel.posY} · ` +
    `container ${cel.location} · shown at ×${k.toFixed(2)} · ` +
    (placed ? `placed ${placed} time(s) in this level` : "not placed in this level");
}

// ---- the layer toggles ------------------------------------------------------

function buildLayers(): void {
  const wrap = $("layers");
  wrap.textContent = "";
  if (!book || !drawList.length) return;
  const tally = new Map<number, number>();
  for (const p of drawList) tally.set(p.parallax, (tally.get(p.parallax) ?? 0) + 1);
  const near = nearestLayer(book);
  const label = document.createElement("span");
  label.className = "n";
  label.textContent = `${tally.size} parallax layer(s), far to near:`;
  wrap.appendChild(label);
  for (const [factor, n] of [...tally].sort((a, b) => b[0] - a[0])) {
    const l = document.createElement("label");
    const box = document.createElement("input");
    box.type = "checkbox";
    box.checked = true;
    box.addEventListener("change", () => {
      if (box.checked) hidden.delete(factor);
      else hidden.add(factor);
      draw();
    });
    l.appendChild(box);
    const text = document.createElement("span");
    // five decimals, not three: a level can store two layers whose factors
    // differ only in the low bits of the 16.16 field, and rounding merges them
    text.textContent = `${factor.toFixed(5)}${factor === near ? "*" : ""}`;
    l.appendChild(text);
    const count = document.createElement("span");
    count.className = "n";
    count.textContent = `×${n}`;
    l.appendChild(count);
    l.title =
      factor === near
        ? "the plane most of this level's art is on"
        : `${(factor / near).toFixed(2)}× as far as the main plane`;
    wrap.appendChild(l);
  }
}

function buildLegend(): void {
  const wrap = $("legend");
  wrap.textContent = "";
  if (!book?.entities.length) return;
  if (book.regions.size) {
    const s = document.createElement("span");
    s.className = "key";
    s.style.color = GROUND;
    s.appendChild(document.createElement("i"));
    const label = document.createElement("span");
    label.style.color = "var(--text-mute)";
    label.textContent = "the ground (a region's floor)";
    s.appendChild(label);
    wrap.appendChild(s);
  }
  for (const [text, color] of [
    ["a room", ROOM],
    ["a room with no floor", ROOM_NO_FLOOR],
    ["a door, and where it puts you", DOOR],
  ] as [string, string][]) {
    if (!rooms.length) break;
    if (color === ROOM_NO_FLOOR && rooms.every((r) => r.ground)) continue;
    if (color === DOOR && rooms.every((r) => !r.exits.length)) continue;
    const s = document.createElement("span");
    s.className = "key";
    s.style.color = color;
    s.appendChild(document.createElement("i"));
    const label = document.createElement("span");
    label.style.color = "var(--text-mute)";
    label.textContent = text;
    s.appendChild(label);
    wrap.appendChild(s);
  }
  const present = new Set(book.entities.map((e) => colorOf(e.name)));
  for (const [name, color] of LEGEND) {
    if (!present.has(color)) continue;
    const s = document.createElement("span");
    s.className = "key";
    s.style.color = color;
    const swatch = document.createElement("i");
    s.appendChild(swatch);
    const label = document.createElement("span");
    label.style.color = "var(--text-mute)";
    label.textContent = name;
    s.appendChild(label);
    wrap.appendChild(s);
  }
}

// ---- the plan ---------------------------------------------------------------

function buildPlan(): void {
  const wrap = $("plan");
  wrap.textContent = "";
  if (!book) return;
  const kinds = new Map<string, number>();
  for (const e of book.entities) kinds.set(e.name, (kinds.get(e.name) ?? 0) + 1);
  const nEnt = book.entities.filter((e) => e.isEntity).length;
  const ground = [...book.regions.values()].reduce((n, r) => n + r.ground.length, 0);
  const doors = rooms.reduce((n, r) => n + r.exits.length, 0);
  $("planStats").textContent = book.entities.length
    ? `${nEnt} objects · ${rooms.length} rooms, ${rooms.filter((r) => r.ground).length} with a floor ` +
      `(${ground} points)${doors ? ` · ${doors} door${doors > 1 ? "s" : ""} between them` : ""}`
    : "nothing placed";
  // grouped by kind, commonest first, and every one is a link into the view
  const order = [...kinds].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  for (const [kind] of order) {
    for (const e of book.entities.filter((x) => x.name === kind)) {
      const b = document.createElement("button");
      b.type = "button";
      const k = document.createElement("span");
      k.className = "kind";
      k.style.color = colorOf(e.name);
      k.textContent = e.name || "(unnamed)";
      b.appendChild(k);
      const w = document.createElement("span");
      w.className = "where";
      const point = isMidpoint(e)
        ? ""
        : ` → ${e.pointX},${e.pointY}`; // a destination rather than a centre
      w.textContent = `${e.left},${e.top}–${e.right},${e.bottom}${point}`;
      b.appendChild(w);
      b.title = [
        e.isEntity ? "an object SC.EXE registers by this name" : "a named region — this name is the designer's, not the engine's",
        e.regionLocation ? `shape in container ${e.regionLocation}` : "",
        e.param ? `parameter ${e.param}` : "",
        e.flags === 15 ? "" : `flags ${e.flags} (a bit cleared — see SbkEntity.flags)`,
        isMidpoint(e) ? "point is the rect's midpoint" : "point is NOT the midpoint: a destination",
      ]
        .filter(Boolean)
        .join(" · ");
      if (!e.isEntity) k.style.fontStyle = "italic";
      b.addEventListener("click", () => {
        camX = (e.left + e.right) / 2;
        camY = (e.top + e.bottom) / 2;
        draw();
      });
      wrap.appendChild(b);
    }
  }
}

// ---- the camera and the drawing --------------------------------------------

/**
 * Put the camera where the level starts.
 *
 * `initplayer` is one entity per level and it is the game's own answer to "where
 * does this begin" — so the view opens there rather than at a corner of a
 * bounding box, and the parallax approximation is anchored at the one point the
 * file justifies. A book with no `initplayer` (the player's own) falls back to
 * the middle of whatever is placed.
 */
function cameraHome(): void {
  const start = book?.entities.find((e) => e.name === "initplayer");
  if (start) {
    camX = (start.left + start.right) / 2;
    camY = (start.top + start.bottom) / 2;
  } else if (drawList.length) {
    const xs = drawList.map((p) => p.x);
    const ys = drawList.map((p) => p.y);
    camX = (Math.min(...xs) + Math.max(...xs)) / 2;
    camY = (Math.min(...ys) + Math.max(...ys)) / 2;
  } else {
    camX = 0;
    camY = 0;
  }
  scale = GAME_SCALE;
  draw();
}
$("toStart").addEventListener("click", cameraHome);

$<HTMLInputElement>("parallax").addEventListener("change", draw);
$<HTMLInputElement>("showEntities").addEventListener("change", draw);
$<HTMLInputElement>("showGround").addEventListener("change", draw);
$<HTMLInputElement>("showRooms").addEventListener("change", draw);

// ---- zoom: continuous, about the point under the cursor or between fingers --

/** clamp and apply a zoom about a canvas-space point, keeping it fixed on screen */
function zoomAt(px: number, py: number, factor: number): void {
  const next = Math.min(8, Math.max(0.03, scale * factor));
  if (next === scale) return;
  // the world point under (px, py) — rate-1 mapping, which is what pan uses too
  const wx = camX + (px - canvas.width / 2) / scale;
  const wy = camY + (py - canvas.height / 2) / scale;
  scale = next;
  camX = wx - (px - canvas.width / 2) / scale;
  camY = wy - (py - canvas.height / 2) / scale;
  draw();
}

/** client (CSS px) to canvas backing-store coordinates */
function canvasPoint(clientX: number, clientY: number): { x: number; y: number } {
  const r = canvas.getBoundingClientRect();
  return { x: ((clientX - r.left) * canvas.width) / r.width, y: ((clientY - r.top) * canvas.height) / r.height };
}

stage.addEventListener(
  "wheel",
  (e) => {
    e.preventDefault();
    const at = canvasPoint(e.clientX, e.clientY);
    zoomAt(at.x, at.y, Math.exp(-e.deltaY * 0.0015));
  },
  { passive: false },
);

/**
 * Pan with one pointer, pinch with two. The stage's `touch-action: none` is what
 * lets a two-finger gesture reach us instead of zooming the page.
 */
const pointers = new Map<number, { x: number; y: number }>();
/** the previous frame's pinch, distance and midpoint, while two pointers are down */
let pinch: { dist: number; midX: number; midY: number } | null = null;

canvas.addEventListener("pointerdown", (e) => {
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  canvas.setPointerCapture(e.pointerId);
  stage.classList.add("dragging");
  pinch = null;
});
canvas.addEventListener("pointermove", (e) => {
  const p = pointers.get(e.pointerId);
  if (!p) return;
  if (pointers.size === 2) {
    p.x = e.clientX;
    p.y = e.clientY;
    const [a, b] = [...pointers.values()];
    const dist = Math.hypot(a.x - b.x, a.y - b.y);
    const midX = (a.x + b.x) / 2;
    const midY = (a.y + b.y) / 2;
    if (pinch && pinch.dist > 0) {
      // pan by the midpoint's travel, zoom by the spread's ratio
      const k = canvas.width / canvas.getBoundingClientRect().width / scale;
      camX -= (midX - pinch.midX) * k;
      camY -= (midY - pinch.midY) * k;
      const at = canvasPoint(midX, midY);
      zoomAt(at.x, at.y, dist / pinch.dist);
    }
    pinch = { dist, midX, midY };
    return;
  }
  pinch = null;
  const k = canvas.width / canvas.getBoundingClientRect().width / scale;
  camX -= (e.clientX - p.x) * k;
  camY -= (e.clientY - p.y) * k;
  p.x = e.clientX;
  p.y = e.clientY;
  draw();
});
const endDrag = (e: PointerEvent): void => {
  pointers.delete(e.pointerId);
  pinch = null;
  if (!pointers.size) stage.classList.remove("dragging");
};
canvas.addEventListener("pointerup", endDrag);
canvas.addEventListener("pointercancel", endDrag);

/**
 * Where a layer's world origin lands on screen.
 *
 * With parallax off this is the plain camera transform and every layer shares it.
 * With it on, a layer at factor `f` moves at `1/f` of the camera — the standard
 * side-scroller rule, with the camera measured from {@link cameraHome}'s anchor
 * so that the anchor itself is where the two agree.
 */
function originFor(factor: number, anchorX: number, anchorY: number): { ox: number; oy: number } {
  // the ENGINE's model (SC.EXE 0x40c31a): horizontal only, about the camera —
  // `factor` here is already the rate placementRate computed, 1 for the overlay
  const on = $<HTMLInputElement>("parallax").checked;
  const rate = on ? factor : 1;
  return {
    ox: canvas.width / 2 - (anchorX + (camX - anchorX) * rate) * scale,
    oy: canvas.height / 2 - camY * scale + 0 * anchorY,
  };
}

function draw(): void {
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  if (!book) return;

  const start = book.entities.find((e) => e.name === "initplayer");
  const anchorX = start ? (start.left + start.right) / 2 : camX;
  const anchorY = start ? (start.top + start.bottom) / 2 : camY;

  let drawn = 0;
  const drawPlacement = (p: (typeof drawList)[number]): void => {
    if (hidden.has(p.parallax)) return;
    const art = celAt(p.location);
    const frame = celFrame.get(p.location);
    if (!art || !frame) return;
    const { ox, oy } = originFor(placementRate(p), anchorX, anchorY);
    // the ANCHOR's screen position; a mirrored cel reflects about it, not about
    // the cel's centre (SC.EXE's rect builder, 0x4026d0) — which is what put the
    // lamp's off-centre glow sprite in the wrong place before
    const sx = ox + p.x * scale;
    const y = oy + (p.y - frame.posYraw) * scale;
    const w = art.width * scale;
    const h = art.height * scale;
    const left = p.mirror ? sx - (art.width - frame.posXraw) * scale : sx - frame.posXraw * scale;
    if (left + w < 0 || y + h < 0 || left > canvas.width || y > canvas.height) return;
    if (p.mirror) {
      ctx.save();
      ctx.scale(-1, 1);
      ctx.drawImage(art, -(left + w), y, w, h);
      ctx.restore();
    } else {
      ctx.drawImage(art, left, y, w, h);
    }
    drawn++;
  };
  // all placements in the engine's paint order (drawList is z-sorted), so the
  // scene composites as the game draws it — plane 2 in front. The ground and
  // entity overlays then go ON TOP, because they are the viewer's annotations
  // and should never hide behind a foreground plane.
  for (const p of drawList) drawPlacement(p);

  // the ground, under everything else the overlay draws: a region's floor is the
  // one thing here that says where the player could actually walk
  if ($<HTMLInputElement>("showGround").checked && book.regions.size) {
    const { ox, oy } = originFor(1, anchorX, anchorY);
    ctx.strokeStyle = GROUND;
    ctx.lineWidth = 2;
    for (const r of book.regions.values()) {
      if (r.ground.length < 2) continue;
      ctx.beginPath();
      r.ground.forEach((p, i) => {
        const x = ox + p.x * scale;
        const y = oy + p.y * scale;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
    }
    ctx.lineWidth = 1;
  }

  // the rooms: the level's own division of itself, and the doors between them.
  // Drawn over the ground because a room's rect and its floor are two different
  // statements about the same room and the pair is worth seeing together — CITY's
  // room is 3000px tall and its floor is a 400px ledge and then a fall.
  if ($<HTMLInputElement>("showRooms").checked && rooms.length) {
    const { ox, oy } = originFor(1, anchorX, anchorY);
    ctx.lineWidth = 1;
    for (const r of rooms) {
      const x = ox + r.left * scale;
      const y = oy + r.top * scale;
      const w = (r.right - r.left) * scale;
      const h = (r.bottom - r.top) * scale;
      ctx.strokeStyle = r.ground ? ROOM : ROOM_NO_FLOOR;
      ctx.setLineDash(r.ground ? [] : [4, 3]);
      ctx.strokeRect(Math.round(x) + 0.5, Math.round(y) + 0.5, Math.max(1, w), Math.max(1, h));
      ctx.setLineDash([]);
      if (w > 60 && h > 16) {
        ctx.fillStyle = r.ground ? ROOM : ROOM_NO_FLOOR;
        ctx.font = "10px ui-monospace, monospace";
        ctx.fillText(`${r.name} p${r.param}${r.ground ? "" : " · no floor"}`, x + 3, y + 11);
      }
      // each door, with the side its stored point is on — where the player comes
      // out of the door back, and why the shipped pairs are opposed
      for (const e of r.exits) {
        const ex = ox + e.left * scale;
        const ey = oy + e.top * scale;
        const ew = (e.right - e.left) * scale;
        const eh = (e.bottom - e.top) * scale;
        ctx.strokeStyle = DOOR;
        ctx.strokeRect(Math.round(ex) + 0.5, Math.round(ey) + 0.5, Math.max(1, ew), Math.max(1, eh));
        ctx.fillStyle = DOOR;
        // the stored point, which is both the arrival spot and the side
        ctx.fillRect(Math.round(ox + e.pointX * scale) - 1, Math.round(oy + e.pointY * scale) - 1, 3, 3);
        if (ew > 20) {
          ctx.font = "10px ui-monospace, monospace";
          const arrow = e.side < 0 ? "←" : e.side > 0 ? "→" : "·";
          ctx.fillText(`${arrow} p${e.to}`, ex + 2, ey + eh - 3);
        }
      }
    }
  }

  if ($<HTMLInputElement>("showEntities").checked) {
    // the entities are on the play plane, so they take the near layer's transform
    const { ox, oy } = originFor(1, anchorX, anchorY);
    ctx.lineWidth = 1;
    for (const e of book.entities) {
      const x = ox + e.left * scale;
      const y = oy + e.top * scale;
      const w = (e.right - e.left) * scale;
      const h = (e.bottom - e.top) * scale;
      if (x + w < 0 || y + h < 0 || x > canvas.width || y > canvas.height) continue;
      ctx.strokeStyle = colorOf(e.name);
      ctx.strokeRect(Math.round(x) + 0.5, Math.round(y) + 0.5, Math.max(1, w), Math.max(1, h));
      if (!isMidpoint(e)) {
        // the destination the record stores instead of a centre — worth seeing
        ctx.fillStyle = colorOf(e.name);
        ctx.fillRect(Math.round(ox + e.pointX * scale) - 1, Math.round(oy + e.pointY * scale) - 1, 3, 3);
      }
    }
  }

  $("zoomsay").textContent = `${Math.round((scale / GAME_SCALE) * 100)}%`;
  $("camsay").textContent =
    `camera ${Math.round(camX)},${Math.round(camY)} · ${drawn} of ${drawList.length} placements in view`;
}

void installI18n();
installGamesMenu();
void installLanguageMenu();
installVersion();
void installSourcePicker($("editionPicker"));
