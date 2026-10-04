/**
 * Sett Editor (setts.html) — RedJack's rooms, the DreamFactory 5 `.sett`.
 *
 * Load a room (upload, drag-and-drop, or pick one off the dev server's
 * gamefiles manifest) and see it three ways: the view from where you stand,
 * the room from above, and its records. Reading is `engine/src/df/sett.ts`,
 * the reader the game uses; its module comment and docs/engine/formats/sett.md
 * are where the format is written down.
 *
 * ## Standing and walking
 *
 * At a node the view is its sphere, drawn by the engine's own
 * {@link SphereImage} through a camera the page holds: drag to look round, the
 * wheel to zoom. Its exits are the films of the roads that touch it and end
 * somewhere else (`exitsOf`); walking one plays its frames at the game's pace,
 * RedJack's `framerate (2)` (see `walkFrameMs`), and stands at the far end
 * looking the way the film ended — as `MazeRuntime.walkStep` does.
 *
 * In a scene the view is a film frame: standing at a view shows the first
 * frame of the second film marked with it (`0x434550`), a turn runs round the
 * first film for "right" and the second for "left" until a frame marked with a
 * view (`0x434b00`), and "ahead" walks the view's road.
 *
 * What the room's scripts do as you arrive — the props they put up, the
 * actors, the camera they turn — is not run: this is the room, not the game.
 *
 * ## Roads that join nothing
 *
 * Not every `.sett` is a map. Disney's Villains' Revenge (1999, the same
 * engine) builds its Wonderland hedge maze, `v131.sett`, as a kit: five nodes,
 * five looks of a junction, all at one point, and 44 roads whose ends name no
 * node (both ids -1). Its shop (`v131.shop`) strings rails into paths with
 * `computepathval` and picks the node to show from the rail it arrived by
 * (`GetNextScene`), so which junction is where lives in the scripts, not here.
 * Those roads are listed under "roads joined to no place" and play on their
 * own; one ends on its last frame, since there is nowhere in the room to arrive.
 * Places that share a point share one mark on the map, and clicking it again
 * steps to the next of them.
 *
 * ## Editing
 *
 * A quad's name and shape, and a star's name and point, are written over the
 * bytes they came from (`engine/src/df/sett-patch.ts`), so the export is the
 * file you loaded with only those bytes changed. It is not repacked: the
 * container writer does not keep a v5 room's padding.
 */
import { readSettFile, exitsOf, type MazeFilm, type MazeNode, type MazeQuad, type MazeRoad, type MazeScene, type SettFile } from "@dreamfactory/engine/df/sett";
import { patchQuad, patchStar, SETT_NAME_MAX } from "@dreamfactory/engine/df/sett-patch";
import { FilmFrames, SphereImage } from "@dreamfactory/engine/runtime/maze-render";
import { inPolygon, projectQuad, walkFrameMs, type MazeCamera } from "@dreamfactory/engine/runtime/maze";
import { t } from "@dreamfactory/site/locales";
import { chosenSource, encodingOf, filesIn, listSources, type Source } from "./sources";
import { DEFAULT_ENCODING, type DfEncoding } from "@dreamfactory/engine/df/text";
import { appendScripts, installEditorPage, serverNote, serverRow, wireFileOpen } from "./editor-kit";

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const landing = $("landing");
const editor = $("editor");
const statusEl = $("status");
const view = $<HTMLCanvasElement>("view");
const viewCtx = view.getContext("2d")!;
const overlay = $<HTMLCanvasElement>("overlay");
const overCtx = overlay.getContext("2d")!;
const map = $<HTMLCanvasElement>("map");
const mapCtx = map.getContext("2d")!;

/** a film frame and a sphere view are both 640 × 480 in RedJack */
const W = 640;
const H = 480;
/** RedJack's BOOTFILE sets `framerate (2)`: a film frame every two ticks */
const FRAME_MS = walkFrameMs(2);
const DEG = Math.PI / 180;

/** the map's colours, the same ones the legend lists */
const C = {
  road: "#4f6b87",
  node: "#8fd0ff",
  scene: "#ffb45a",
  quad: "#30e0e0",
  star: "#e070ff",
  route: "#a050c0",
  you: "#30ff60",
  picked: "#ffe066",
};

// ---- state ------------------------------------------------------------------

let bytes = new Uint8Array(0);
let sett: SettFile | null = null;
/** the code page the chosen tree's text is in — what a script's player-facing strings decode with */
let encoding: DfEncoding = DEFAULT_ENCODING;
let fileName = "";
let edits = 0;

/** where you stand: a node's sphere, or a scene's view on one of its films */
let node: MazeNode | null = null;
let scene: MazeScene | null = null;
let sceneView = 0;
/** the film frame on screen: a scene's view, or a walk under way */
let shot: { film: MazeFilm; frame: number } | null = null;
let walking = false;
/** a road that joins no place was played: the view rests on its last frame */
let adrift = false;
/** the camera at a node, radians */
let heading = 0;
let pitch = 0;
let fov = 90 * DEG;

/** the film frame on screen has no picture of its own */
let blank = false;

let pickedQuad = -1;
let pickedStar = -1;

const spheres = new Map<number, SphereImage>();
let film: { container: number; frames: FilmFrames } | null = null;
const rgba = new Uint32Array(W * H);
const image = new ImageData(new Uint8ClampedArray(rgba.buffer), W, H);

function log(text: string): void {
  statusEl.textContent = text;
}

const deg = (r: number): string => `${(r / DEG).toFixed(1)}°`;
const placeName = (): string => node?.name ?? scene?.name ?? "";

function sphere(container: number): SphereImage {
  let s = spheres.get(container);
  if (!s) {
    s = new SphereImage(sett!.file, container);
    spheres.set(container, s);
    // a big room's spheres are tens of megabytes decoded: keep the last few
    if (spheres.size > 3) spheres.delete(spheres.keys().next().value!);
  }
  return s;
}

/** the camera the view is drawn through, as RedJack.exe's projector takes it */
function camera(): MazeCamera | null {
  const f = shot?.film.frames[shot.frame];
  if (f) return { x: f.x, y: f.y, z: f.z, heading: f.heading, pitch: f.pitch, roll: f.roll, fov: f.fov };
  if (!node) return null;
  return { x: node.x, y: node.y, z: node.z, heading, pitch, roll: 0, fov };
}

// ---- loading ----------------------------------------------------------------

function loadRoom(data: Uint8Array, name: string): void {
  // a copy: the patches write into it, and it is what the export hands back
  const copy = data.slice();
  let parsed: SettFile;
  try {
    parsed = readSettFile(copy);
  } catch (e) {
    log(t("common.notReadable", { ext: "sett", message: (e as Error).message }));
    return;
  }
  bytes = copy;
  sett = parsed;
  fileName = name;
  edits = 0;
  spheres.clear();
  film = null;
  pickedQuad = pickedStar = -1;
  landing.style.display = "none";
  editor.style.display = "flex";
  $("fileName").textContent = name;
  const titled = parsed.name ? parsed.name + " · " : "";
  $("fileStats").textContent =
    `${titled}${parsed.nodes.length} nodes · ${parsed.scenes.length} scenes · ${parsed.roads.length} roads · ` +
    `${parsed.quads.length} quads · ${parsed.stars.length} stars · ${parsed.routes.length} routes · ${parsed.file.containers.length} containers`;
  log("");
  markDirty();
  buildPlaces();
  buildFreeRoads();
  buildQuads();
  buildStars();
  buildScripts();
  buildLegend();
  heading = 0;
  pitch = 0;
  fov = 90 * DEG;
  goTo(parsed.first);
}

wireFileOpen(async (f) => loadRoom(new Uint8Array(await f.arrayBuffer()), f.name));

const isSettPath = (path: string): boolean => /\.sett$/i.test(path);

/** Dev-server mode: every room there is, by disc. Only RedJack has any. */
async function initServerRooms(): Promise<void> {
  const sources = await listSources();
  const chose = chosenSource(sources);
  if (!chose) return; // production / no dev server: upload only
  const has = (s: Source): boolean => filesIn(s, isSettPath).length > 0;
  const source = has(chose) ? chose : sources.find(has);
  if (!source) return;
  encoding = encodingOf(source);
  const rooms = filesIn(source, isSettPath).sort((a, b) => a.path.localeCompare(b.path));
  const wrap = $("serverRooms");
  serverNote(
    wrap,
    source === chose
      ? t("common.pickFromGamefiles")
      : `${t("common.pickFromGamefiles")} — ${source.game.short}, the only source here with rooms in it`,
  );
  const discs = new Map<string, typeof rooms>();
  for (const f of rooms) {
    const disc = f.path.split("/").find((p) => /disk\d/i.test(p)) ?? "";
    discs.set(disc, [...(discs.get(disc) ?? []), f]);
  }
  for (const [disc, files] of discs) {
    if (disc) {
      const d = document.createElement("div");
      d.className = "disc";
      d.textContent = disc;
      wrap.appendChild(d);
    }
    serverRow(wrap, {
      source,
      files,
      rowClass: "rooms",
      buttonClass: "room",
      label: (f) => f.base.replace(/\.sett$/i, ""),
      log,
      open: (data, f) => loadRoom(data, f.base),
    });
  }
}
const serverListed = initServerRooms();

$("closeBtn").addEventListener("click", () => {
  if (edits && !confirm("Close without exporting your edits?")) return;
  sett = null;
  bytes = new Uint8Array(0);
  spheres.clear();
  film = null;
  editor.style.display = "none";
  landing.style.display = "block";
  log("");
});

$("exportBtn").addEventListener("click", () => {
  if (!sett) return;
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/octet-stream" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  log(`${fileName}: exported, ${edits} edit${edits === 1 ? "" : "s"} written in place`);
});

function markDirty(): void {
  const noun = edits === 1 ? "edit" : "edits";
  $("dirty").textContent = edits ? `${edits} ${noun}` : "";
}

// ---- moving -----------------------------------------------------------------

function findPlace(name: string): { node?: MazeNode; scene?: MazeScene } {
  const n = name.toLowerCase();
  return {
    node: sett!.nodes.find((x) => x.name.toLowerCase() === n),
    scene: sett!.scenes.find((x) => x.name.toLowerCase() === n),
  };
}

/** stand at `i` of `sc`, on the second film's first frame marked with it (0x434550) */
function standAt(sc: MazeScene, i: number, at?: { film: MazeFilm; frame: number }): void {
  sceneView = i;
  const f = sc.films[1] ?? sc.films[0];
  const k = f ? f.frames.findIndex((x) => x.view === i) : -1;
  shot = at ?? (f && k >= 0 ? { film: f, frame: k } : null);
}

/** the view of `sc` nearest `h`, as a scene you walk into without a view's name picks */
function nearestView(sc: MazeScene, h: number): number {
  const turn = (x: number): number => Math.abs(((x - h + 3 * Math.PI) % (2 * Math.PI)) - Math.PI);
  let best = 0;
  sc.views.forEach((v, i) => {
    if (turn((v.heading * 2 * Math.PI) / (1 << 24)) < turn((sc.views[best].heading * 2 * Math.PI) / (1 << 24))) best = i;
  });
  return best;
}

function goTo(name: string, viewIndex?: number): void {
  const p = findPlace(name);
  if (!p.node && !p.scene) return;
  node = p.node ?? null;
  scene = p.node ? null : p.scene!;
  shot = null;
  adrift = false;
  if (scene) standAt(scene, viewIndex ?? nearestView(scene, heading));
  ($<HTMLSelectElement>("place")).value = name;
  buildExits();
  show();
}

/** play a film from `from`; a turn stops at the first frame marked with a view */
async function play(f: MazeFilm, from: number, turn: boolean): Promise<void> {
  if (walking || !f.frames.length) return;
  walking = true;
  adrift = false;
  const slow = (): number => ($<HTMLInputElement>("slow").checked ? 4 : 1);
  let i = from;
  shot = { film: f, frame: i };
  show();
  for (;;) {
    await new Promise((r) => setTimeout(r, FRAME_MS * slow()));
    if (!sett) return;
    if (turn) {
      i = (i + 1) % f.frames.length;
      shot = { film: f, frame: i };
      if (f.frames[i].view >= 0 && scene) {
        standAt(scene, f.frames[i].view, shot);
        break;
      }
    } else if (i + 1 < f.frames.length) {
      shot = { film: f, frame: ++i };
    } else break;
    show();
  }
  walking = false;
  if (!turn) arrive(f);
  else show();
}

/** the far end of a film: a node looking the way it ended, or a scene's nearest view */
function arrive(f: MazeFilm): void {
  const last = f.frames.at(-1)!;
  heading = last.heading;
  pitch = last.pitch;
  fov = last.fov || 90 * DEG;
  const to = sett!.nodes.find((n) => n.node === f.to);
  const toScene = f.toScene ? sett!.scenes.find((s) => s.scen === f.toScene) : undefined;
  if (to) goTo(to.name);
  else if (toScene) goTo(toScene.name);
  else if (isFree(f)) {
    // nowhere to arrive: stay on the last frame, and let any place be picked
    adrift = true;
    $<HTMLSelectElement>("place").value = "";
    show();
  } else {
    shot = null;
    show();
  }
}

function turnScene(dir: "left" | "right"): void {
  if (!scene || walking) return;
  const f = scene.films[dir === "right" ? 0 : 1];
  const k = f ? f.frames.findIndex((x) => x.view === sceneView) : -1;
  if (f && k >= 0) void play(f, k, true);
}

function ahead(): void {
  const road = scene?.views[sceneView]?.road;
  if (road?.frames.length && !walking) void play(road, 0, false);
}

$("leftBtn").addEventListener("click", () => turnScene("left"));
$("rightBtn").addEventListener("click", () => turnScene("right"));
$("aheadBtn").addEventListener("click", ahead);
$("place").addEventListener("change", (e) => goTo((e.target as HTMLSelectElement).value));
$("showQuads").addEventListener("change", () => drawOverlay());

document.addEventListener("keydown", (e) => {
  if (!sett || (e.target as HTMLElement).closest("input, select, textarea")) return;
  if (scene) {
    if (e.key === "ArrowLeft") turnScene("left");
    else if (e.key === "ArrowRight") turnScene("right");
    else if (e.key === "ArrowUp") ahead();
    else return;
  } else if (node) {
    if (e.key === "ArrowLeft") heading += 15 * DEG;
    else if (e.key === "ArrowRight") heading -= 15 * DEG;
    else return;
    show();
  } else return;
  e.preventDefault();
});

// ---- looking round a node ---------------------------------------------------

let drag: { x: number; y: number; moved: boolean } | null = null;
let fineTimer = 0;

/** a pointer position in the view's own pixels */
const inView = (e: MouseEvent): [number, number] => {
  const r = view.getBoundingClientRect();
  return [((e.clientX - r.left) * W) / r.width, ((e.clientY - r.top) * H) / r.height];
};

view.addEventListener("pointerdown", (e) => {
  const [x, y] = inView(e);
  drag = { x, y, moved: false };
  view.setPointerCapture(e.pointerId);
});
view.addEventListener("pointermove", (e) => {
  if (!drag) return;
  const [x, y] = inView(e);
  const dx = x - drag.x;
  const dy = y - drag.y;
  if (!drag.moved && Math.hypot(dx, dy) < 3) return;
  drag.moved = true;
  if (!node || shot || walking) return;
  view.classList.add("dragging");
  // grab the picture: what is under the pointer stays under it
  const perPx = fov / W;
  heading += dx * perPx;
  pitch = Math.max(-89 * DEG, Math.min(89 * DEG, pitch + dy * perPx));
  drag.x = x;
  drag.y = y;
  show(true);
});
view.addEventListener("pointerup", (e) => {
  view.classList.remove("dragging");
  const d = drag;
  drag = null;
  if (d && !d.moved) clickView(...inView(e));
  else show();
});
view.addEventListener(
  "wheel",
  (e) => {
    if (!node || shot) return;
    e.preventDefault();
    fov = Math.max(10 * DEG, Math.min(150 * DEG, fov * Math.pow(1.1, Math.sign(e.deltaY))));
    show(true);
  },
  { passive: false },
);

/** a click on the view picks the topmost quad under it, as `quadAt` finds one */
function clickView(x: number, y: number): void {
  const cam = camera();
  if (!cam || !sett || walking) return;
  for (let i = sett.quads.length - 1; i >= 0; i--) {
    const poly = projectQuad(sett.quads[i], cam, W, H);
    if (poly && inPolygon(poly, x, y)) {
      pickQuad(i, true);
      return;
    }
  }
}

// ---- drawing ----------------------------------------------------------------

/** draw the view; `coarse` while it moves, the full picture a moment after */
function show(coarse = false): void {
  if (!sett) return;
  const s = shot;
  blank = false;
  if (s) {
    if (film?.container !== s.film.container) {
      film = { container: s.film.container, frames: new FilmFrames(sett.file, s.film.frames.map((f) => f.picture)) };
    }
    // a frame with no picture (darts' first scene has only those) is black
    blank = !film.frames.render(s.frame, rgba, W, H);
    if (blank) rgba.fill(0xff000000);
  } else if (node) {
    sphere(node.sphere).render(rgba, W, H, heading, pitch, fov, coarse);
    clearTimeout(fineTimer);
    if (coarse) fineTimer = window.setTimeout(() => show(), 150);
  } else rgba.fill(0xff000000);
  viewCtx.putImageData(image, 0, 0);
  drawOverlay();
  showInfo();
  drawMap();
  $("sceneMoves").style.display = scene ? "flex" : "none";
  $("howTo").style.display = node ? "" : "none";
}

function drawOverlay(): void {
  overCtx.clearRect(0, 0, W, H);
  const cam = camera();
  if (!cam || !sett || walking || !$<HTMLInputElement>("showQuads").checked) return;
  overCtx.font = "12px ui-monospace, monospace";
  sett.quads.forEach((q, i) => {
    const poly = projectQuad(q, cam, W, H);
    if (!poly) return;
    const c = i === pickedQuad ? C.picked : C.quad;
    overCtx.strokeStyle = c;
    overCtx.lineWidth = i === pickedQuad ? 2 : 1;
    overCtx.beginPath();
    poly.forEach(([x, y], k) => (k ? overCtx.lineTo(x, y) : overCtx.moveTo(x, y)));
    overCtx.closePath();
    overCtx.stroke();
    overCtx.fillStyle = c;
    overCtx.fillText(q.name, poly[0][0] + 4, poly[0][1] + 13);
  });
}

function showInfo(): void {
  const cam = camera();
  const lines: string[] = [];
  if (walking && shot) lines.push(`on film @${shot.film.container}, frame ${shot.frame + 1} of ${shot.film.frames.length}`);
  else if (adrift && shot) lines.push(`the end of ${roadOf(shot.film)} (film @${shot.film.container}): it arrives at no place`);
  else if (node) lines.push(`node ${node.name} (id ${node.id}) · NODE @${node.node} · SPHR @${node.sphere}`);
  else if (scene) {
    const v = scene.views[sceneView];
    lines.push(`scene ${scene.name} · SCEN @${scene.scen}`);
    const ahead = v?.road ? ` · road ahead @${v.road.container}` : "";
    if (v) lines.push(`view ${v.name} (id ${v.id}), ${sceneView + 1} of ${scene.views.length}${ahead}`);
  }
  if (blank) lines.push("this film frame has no picture in the room: it is drawn black");
  if (cam) {
    lines.push(`heading ${deg(cam.heading)} · pitch ${deg(cam.pitch)} · fov ${deg(cam.fov)}`, `at ${cam.x}, ${cam.y}, ${cam.z}`);
  }
  $("previewInfo").textContent = lines.join("\n");
  $("previewInfo").style.whiteSpace = "pre-line";
}

// ---- the places and their exits --------------------------------------------

function buildPlaces(): void {
  const sel = $<HTMLSelectElement>("place");
  sel.replaceChildren();
  for (const [label, list] of [["nodes", sett!.nodes], ["scenes", sett!.scenes]] as const) {
    if (!list.length) continue;
    const g = document.createElement("optgroup");
    g.label = label;
    for (const p of list) g.appendChild(new Option(p.name, p.name));
    sel.appendChild(g);
  }
}

/** a film's far end, by name */
function endOf(f: MazeFilm): string {
  const to = sett!.nodes.find((n) => n.node === f.to);
  if (to) return to.name;
  const sc = f.toScene ? sett!.scenes.find((s) => s.scen === f.toScene) : undefined;
  return sc?.name ?? "nowhere";
}

const roadOf = (f: MazeFilm): string => sett!.roads.find((r) => r.films.includes(f))?.name ?? "";

/** a film that arrives at no node and no scene of this room */
const isFree = (f: MazeFilm): boolean => endOf(f) === "nowhere";

/**
 * A road no node's exits can reach: neither end names a node, and no film of it
 * arrives anywhere. RedJack has none; Villains' Revenge's Wonderland is made of
 * them (see the module comment).
 */
const isFreeRoad = (r: MazeRoad): boolean =>
  r.films.length > 0 && r.films.every(isFree) && !sett!.nodes.some((n) => n.id === r.a || n.id === r.b);

function buildFreeRoads(): void {
  const wrap = $("freeRoads");
  wrap.replaceChildren();
  const free = sett!.roads.filter(isFreeRoad);
  wrap.style.display = free.length ? "" : "none";
  if (!free.length) return;
  const sum = document.createElement("summary");
  sum.textContent = `roads joined to no place (${free.length})`;
  wrap.appendChild(sum);
  for (const r of free) {
    const line = document.createElement("div");
    line.className = "freeRoad";
    const name = document.createElement("span");
    name.textContent = r.name;
    line.appendChild(name);
    r.films.forEach((f, i) => {
      const b = document.createElement("button");
      b.textContent = i ? "◀" : "▶";
      b.title = `${r.name}, ${i ? "back" : "there"} · film @${f.container} · ${f.frames.length} frames`;
      b.addEventListener("click", () => void play(f, 0, false));
      line.appendChild(b);
    });
    wrap.appendChild(line);
  }
}

function buildExits(): void {
  const wrap = $("exits");
  wrap.replaceChildren();
  if (!node) return;
  const exits = exitsOf(sett!, node);
  const head = document.createElement("div");
  head.className = "muted";
  if (exits.length) head.textContent = "exits, as the scripts number them:";
  else if (sett!.roads.some(isFreeRoad)) head.textContent = "no exits: this room's roads join no place (below)";
  else head.textContent = "no exits";
  wrap.appendChild(head);
  exits.forEach((f, i) => {
    const b = document.createElement("button");
    b.textContent = `${i + 1} → ${endOf(f)}`;
    b.title = `${roadOf(f)} · film @${f.container} · ${f.frames.length} frames`;
    b.addEventListener("click", () => void play(f, 0, false));
    wrap.appendChild(b);
  });
}

// ---- the map ----------------------------------------------------------------

/**
 * The room from above. The world's x runs right and its y up; a node's height
 * (its z) is not drawn. A quad and the camera are in other axes: a quad's point
 * is the camera's taken as (−y, −z, x) (see `MazeRuntime.quadOutline`), so it
 * sits at (z, −x) here, and the camera looks along (cos heading, sin heading).
 */
const quadAt = (q: MazeQuad): [number, number] => [q.z, -q.x];

let mapView = { x0: 0, y0: 0, scale: 1 };
const toMap = (x: number, y: number): [number, number] => [
  (x - mapView.x0) * mapView.scale + 20,
  map.height - 20 - (y - mapView.y0) * mapView.scale,
];

function fitMap(): void {
  const s = sett!;
  const xs: number[] = [];
  const ys: number[] = [];
  const add = (x: number, y: number): void => {
    xs.push(x);
    ys.push(y);
  };
  for (const n of s.nodes) add(n.x, n.y);
  for (const sc of s.scenes) add(sc.x, sc.y);
  for (const r of s.roads) for (const f of r.films) for (const fr of f.frames) add(fr.x, fr.y);
  for (const q of s.quads) add(...quadAt(q));
  for (const st of s.stars) add(st.x, st.y);
  if (!xs.length) add(0, 0);
  const x0 = Math.min(...xs);
  const y0 = Math.min(...ys);
  const width = Math.min(900, Math.max(360, (map.parentElement?.clientWidth ?? 640) - 4));
  map.width = width;
  map.height = Math.round(width * 0.7);
  const scale = Math.min((map.width - 40) / Math.max(Math.max(...xs) - x0, 1), (map.height - 40) / Math.max(Math.max(...ys) - y0, 1));
  mapView = { x0, y0, scale };
}

function drawMap(): void {
  if (!sett) return;
  if (map.dataset.room !== fileName) {
    map.dataset.room = fileName;
    fitMap();
  }
  const s = sett;
  const g = mapCtx;
  g.clearRect(0, 0, map.width, map.height);
  g.lineWidth = 1;
  // the roads, as the camera walks them
  g.strokeStyle = C.road;
  for (const r of s.roads) {
    const f = r.films[0];
    if (!f?.frames.length) continue;
    g.beginPath();
    f.frames.forEach((fr, i) => (i ? g.lineTo(...toMap(fr.x, fr.y)) : g.moveTo(...toMap(fr.x, fr.y))));
    g.stroke();
  }
  // the scenes' roads ahead
  for (const sc of s.scenes) {
    for (const v of sc.views) {
      if (!v.road?.frames.length) continue;
      g.beginPath();
      v.road.frames.forEach((fr, i) => (i ? g.lineTo(...toMap(fr.x, fr.y)) : g.moveTo(...toMap(fr.x, fr.y))));
      g.stroke();
    }
  }
  // the routes between stars
  g.strokeStyle = C.route;
  g.setLineDash([4, 3]);
  for (const r of s.routes) {
    g.beginPath();
    r.points.forEach((p, i) => (i ? g.lineTo(...toMap(p.x, p.y)) : g.moveTo(...toMap(p.x, p.y))));
    g.stroke();
  }
  g.setLineDash([]);
  // the quads, edge on: their width along the way they face
  s.quads.forEach((q, i) => {
    const [cx, cy] = quadAt(q);
    const ux = -Math.sin(q.heading) * (q.w / 2);
    const uy = -Math.cos(q.heading) * (q.w / 2);
    g.strokeStyle = i === pickedQuad ? C.picked : C.quad;
    g.lineWidth = i === pickedQuad ? 3 : 2;
    g.beginPath();
    g.moveTo(...toMap(cx - ux, cy - uy));
    g.lineTo(...toMap(cx + ux, cy + uy));
    g.stroke();
  });
  g.lineWidth = 1;
  // the stars
  s.stars.forEach((st, i) => {
    const [x, y] = toMap(st.x, st.y);
    g.strokeStyle = i === pickedStar ? C.picked : C.star;
    g.beginPath();
    g.moveTo(x - 4, y);
    g.lineTo(x + 4, y);
    g.moveTo(x, y - 4);
    g.lineTo(x, y + 4);
    g.stroke();
  });
  // the film on screen, when it is a road that joins no place
  if (shot && (walking || adrift) && isFree(shot.film)) {
    g.strokeStyle = C.picked;
    g.lineWidth = 2;
    g.beginPath();
    shot.film.frames.forEach((fr, i) => (i ? g.lineTo(...toMap(fr.x, fr.y)) : g.moveTo(...toMap(fr.x, fr.y))));
    g.stroke();
    g.lineWidth = 1;
  }
  // the places, named: those at one point share a mark and a label
  g.font = "11px ui-monospace, monospace";
  for (const st of placeStacks()) {
    const [x, y] = st.at;
    g.fillStyle = st.places[0].kind === "node" ? C.node : C.scene;
    if (st.places[0].kind === "node") {
      g.beginPath();
      g.arc(x, y, 4, 0, Math.PI * 2);
      g.fill();
    } else g.fillRect(x - 4, y - 4, 8, 8);
    g.fillText(st.places.map((p) => p.name).join(" · "), x + 6, y - 5);
  }
  // you, and the way you look
  const cam = camera();
  if (cam) {
    const [x, y] = toMap(cam.x, cam.y);
    g.fillStyle = "rgba(48,255,96,0.18)";
    g.beginPath();
    g.moveTo(x, y);
    const r = 48;
    for (const a of [cam.heading - cam.fov / 2, cam.heading + cam.fov / 2]) g.lineTo(x + Math.cos(a) * r, y - Math.sin(a) * r);
    g.closePath();
    g.fill();
    g.strokeStyle = C.you;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + Math.cos(cam.heading) * r, y - Math.sin(cam.heading) * r);
    g.stroke();
    g.fillStyle = C.you;
    g.beginPath();
    g.arc(x, y, 3, 0, Math.PI * 2);
    g.fill();
  }
  $("mapStats").textContent = `${s.nodes.length + s.scenes.length} places · ${s.roads.length} roads`;
}

/** the room's nodes and scenes, gathered by the map point they fall on */
function placeStacks(): { at: [number, number]; places: { kind: "node" | "scene"; name: string }[] }[] {
  const out = new Map<string, { at: [number, number]; places: { kind: "node" | "scene"; name: string }[] }>();
  const add = (kind: "node" | "scene", name: string, x: number, y: number): void => {
    const at = toMap(x, y);
    const key = `${Math.round(at[0])},${Math.round(at[1])}`;
    const st = out.get(key) ?? { at, places: [] };
    st.places.push({ kind, name });
    out.set(key, st);
  };
  for (const n of sett!.nodes) add("node", n.name, n.x, n.y);
  for (const sc of sett!.scenes) add("scene", sc.name, sc.x, sc.y);
  return [...out.values()];
}

function buildLegend(): void {
  const wrap = $("legend");
  wrap.replaceChildren();
  for (const [c, what] of [
    [C.node, "a node"],
    [C.scene, "a scene"],
    [C.road, "a road, as its film walks it"],
    [C.quad, "a quad, edge on"],
    [C.star, "a star"],
    [C.route, "a route"],
    [C.you, "you, and what you see"],
  ]) {
    const s = document.createElement("span");
    const i = document.createElement("i");
    i.style.background = c;
    s.append(i, what);
    wrap.appendChild(s);
  }
}

/** what is under a map point: a place first, then a quad or a star */
function mapHit(e: MouseEvent): { kind: "place" | "quad" | "star"; i: number; name: string; say: string } | null {
  if (!sett) return null;
  const r = map.getBoundingClientRect();
  const x = ((e.clientX - r.left) * map.width) / r.width;
  const y = ((e.clientY - r.top) * map.height) / r.height;
  const near = (p: [number, number]): number => Math.hypot(p[0] - x, p[1] - y);
  type Hit = { kind: "place" | "quad" | "star"; i: number; name: string; say: string; d: number };
  const found: { best: Hit | null } = { best: null };
  const offer = (kind: Hit["kind"], i: number, name: string, d: number, reach: number, say = name): void => {
    if (d <= reach && (!found.best || d < found.best.d)) found.best = { kind, i, name, say, d };
  };
  placeStacks().forEach((st, i) => {
    // a stack answers with the place after the one you stand at, so clicking
    // it again steps through them
    const names = st.places.map((p) => p.name);
    const k = names.indexOf(placeName());
    const name = names[adrift ? 0 : (k + 1) % names.length];
    offer("place", i, name, near(st.at), 9, names.length > 1 ? `${name} (of ${names.join(" · ")})` : name);
  });
  if (found.best) return found.best;
  sett.quads.forEach((q, i) => offer("quad", i, q.name, near(toMap(...quadAt(q))), 8));
  sett.stars.forEach((s, i) => offer("star", i, s.name, near(toMap(s.x, s.y)), 8));
  return found.best;
}

map.addEventListener("mousemove", (e) => {
  const h = mapHit(e);
  let say = "";
  if (h) say = h.kind === "place" ? h.say : `${h.kind} ${h.say}`;
  $("mapSay").textContent = say;
});
map.addEventListener("click", (e) => {
  const h = mapHit(e);
  if (!h || walking) return;
  if (h.kind === "place") goTo(h.name);
  else if (h.kind === "quad") pickQuad(h.i, true);
  else pickStar(h.i, true);
});

// ---- the quads and the stars -------------------------------------------------

function numberInput(value: number, cls = ""): HTMLInputElement {
  const input = document.createElement("input");
  input.type = "number";
  input.value = String(value);
  if (cls) input.className = cls;
  return input;
}

function nameInput(value: string): HTMLInputElement {
  const input = document.createElement("input");
  input.type = "text";
  input.className = "name";
  input.maxLength = SETT_NAME_MAX;
  input.value = value;
  return input;
}

function row(table: HTMLTableSectionElement, cells: (Node | string)[]): HTMLTableRowElement {
  const tr = document.createElement("tr");
  for (const c of cells) {
    const td = document.createElement("td");
    td.append(c);
    tr.appendChild(td);
  }
  table.appendChild(tr);
  return tr;
}

function edited(what: string): void {
  edits++;
  markDirty();
  log(`${what} — written in place; ⬇ Export .sett to keep it`);
}

function buildQuads(): void {
  // the header row is in setts.html; only the body is rebuilt
  const head = $<HTMLTableElement>("quads").tHead!;
  const table = $<HTMLTableElement>("quads").tBodies[0];
  table.replaceChildren();
  const s = sett!;
  $("quadStats").textContent = `${s.quads.length}`;
  if (!s.quads.length) {
    head.hidden = true;
    row(table, ["this room has no quads"]);
    return;
  }
  head.hidden = false;
  s.quads.forEach((q, i) => {
    const name = nameInput(q.name);
    const x = numberInput(q.x);
    const y = numberInput(q.y);
    const z = numberInput(q.z);
    const hd = numberInput(+(q.heading / DEG).toFixed(2), "angle");
    const pt = numberInput(+(q.pitch / DEG).toFixed(2), "angle");
    const w = numberInput(q.w);
    const h = numberInput(q.h);
    hd.step = pt.step = "any";
    const tr = row(table, [name, x, y, z, hd, pt, w, h, q.script ? `@${q.script}` : "none"]);
    tr.dataset.i = String(i);
    tr.addEventListener("focusin", () => pickQuad(i, false));
    const commit = (): void => {
      const next: Partial<MazeQuad> = {
        name: name.value.slice(0, SETT_NAME_MAX),
        x: +x.value,
        y: +y.value,
        z: +z.value,
        heading: +hd.value * DEG,
        pitch: +pt.value * DEG,
        w: +w.value,
        h: +h.value,
      };
      // an angle shown in degrees is written back only when it was changed:
      // the rounding would otherwise touch every double it passes through
      if (Math.abs(+hd.value - +(q.heading / DEG).toFixed(2)) < 1e-9) delete next.heading;
      if (Math.abs(+pt.value - +(q.pitch / DEG).toFixed(2)) < 1e-9) delete next.pitch;
      const changed = (Object.keys(next) as (keyof MazeQuad)[]).filter((k) => next[k] !== q[k]);
      if (!changed.length || changed.some((k) => typeof next[k] === "number" && !Number.isFinite(next[k] as number))) return;
      const only = Object.fromEntries(changed.map((k) => [k, next[k]])) as Partial<MazeQuad>;
      if (!patchQuad(s.file, i, only)) return;
      Object.assign(q, only);
      edited(`quad ${q.name}: ${changed.join(", ")}`);
      show();
    };
    for (const el of [name, x, y, z, hd, pt, w, h]) el.addEventListener("change", commit);
  });
}

function buildStars(): void {
  // the header row is in setts.html; only the body is rebuilt
  const head = $<HTMLTableElement>("stars").tHead!;
  const table = $<HTMLTableElement>("stars").tBodies[0];
  table.replaceChildren();
  const s = sett!;
  $("starStats").textContent = `${s.stars.length} · ${s.routes.length} routes`;
  if (!s.stars.length) {
    head.hidden = true;
    row(table, ["this room has no stars"]);
    return;
  }
  head.hidden = false;
  s.stars.forEach((st, i) => {
    const name = nameInput(st.name);
    const x = numberInput(st.x);
    const y = numberInput(st.y);
    const z = numberInput(st.z);
    const route = s.routes.find((r) => r.a === st.name || r.b === st.name);
    const tr = row(table, [
      name, x, y, z,
      route ? `${route.a} ↔ ${route.b}, ${route.points.length} points` : "",
    ]);
    tr.dataset.i = String(i);
    tr.addEventListener("focusin", () => pickStar(i, false));
    const commit = (): void => {
      const next = { name: name.value.slice(0, SETT_NAME_MAX), x: +x.value, y: +y.value, z: +z.value };
      const changed = (Object.keys(next) as (keyof typeof next)[]).filter((k) => next[k] !== st[k]);
      if (!changed.length || [next.x, next.y, next.z].some((v) => !Number.isFinite(v))) return;
      const only = Object.fromEntries(changed.map((k) => [k, next[k]]));
      if (!patchStar(s.file, i, only)) return;
      Object.assign(st, only);
      edited(`star ${st.name}: ${changed.join(", ")}`);
      drawMap();
    };
    for (const el of [name, x, y, z]) el.addEventListener("change", commit);
  });
}

function pick(tableId: string, i: number, scroll: boolean): void {
  for (const tr of $(tableId).querySelectorAll("tr")) tr.classList.toggle("picked", tr.dataset.i === String(i));
  if (scroll) $(tableId).querySelector(`tr[data-i="${i}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

function pickQuad(i: number, scroll: boolean): void {
  pickedQuad = i;
  pick("quads", i, scroll);
  const q = sett!.quads[i];
  log(`quad ${q.name}` + (q.script ? `, its script @${q.script}` : ""));
  drawOverlay();
  drawMap();
}

function pickStar(i: number, scroll: boolean): void {
  pickedStar = i;
  pick("stars", i, scroll);
  drawMap();
}

// ---- scripts ----------------------------------------------------------------

function buildScripts(): void {
  const wrap = $("scripts");
  wrap.replaceChildren();
  const s = sett!;
  const entries: { label: string; loc: number }[] = [];
  const seen = new Set<number>();
  const add = (label: string, loc: number): void => {
    if (loc > 0 && !seen.has(loc)) {
      seen.add(loc);
      entries.push({ label, loc });
    }
  };
  add("the room's main script", s.mainScript);
  for (const n of s.nodes) add(`node ${n.name}`, n.script);
  for (const sc of s.scenes) add(`scene ${sc.name}`, sc.script);
  for (const q of s.quads) add(`quad ${q.name}`, q.script);
  if (!entries.length) {
    wrap.textContent = "no scripts";
    return;
  }
  appendScripts(wrap, entries, s.file.containers, encoding);
}

void installEditorPage();
await serverListed;
