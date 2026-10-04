/**
 * Maze Viewer (mazes.html) — the ninth of the browser pages over the DF library,
 * and the second, after the sprite books, that only reads.
 *
 * Load one of Lunicus's mazes (upload, drag-and-drop, or pick one off the dev
 * server's gamefiles manifest) and look at it three ways: the grid, as a map;
 * the view from a pose in it; and the films that join one pose to the next.
 * Reading is `engine/src/df/maze-v0.ts`, the reader the game itself uses
 * (lunicus/src/game/maze.ts); its module comment is where the format is
 * written down.
 *
 * ## Walking
 *
 * A move is the game's own: a quarter turn left or right, or a step forward,
 * each the transition from the pose to the one the move asks for, and none
 * means a wall (0x403420). A step plays its film's frames 1 to 7 and a turn
 * 1 to 6, three ticks of 60 Hz apart, from the film's first frame (0x40d200).
 * At rest the view is the first frame of a film leaving the pose (0x4034fe).
 * What the game draws over the view — the crew, the enemies, the panel beside
 * it — is not in the maze, and is not here.
 *
 * ## The palette
 *
 * A maze carries none. The base, the city and every maze are drawn in
 * LUNIRES.DLL's CLUT128 (0x40a988), so the page fetches the DLL from the same
 * source as the maze, and an upload can bring it along by dropping it too.
 * Without it the view is drawn in a grey ramp, and says so.
 *
 * ## Why there is no export
 *
 * Nothing writes a v0 maze, and the other v0 files open read-only in their
 * editors for the same reason: an export with no round-trip test behind it
 * would be a promise the page cannot keep.
 */
import { readContainerFile } from "@dreamfactory/engine/df/container";
import { FrameBuffer, decodeFrame, indexedToRGBA } from "@dreamfactory/engine/df/image";
import { readClutV0 } from "@dreamfactory/engine/df/clut-v0";
import { cellV0, ownsFilmV0, readMazeV0, type MazeTransitionV0, type MazeV0, type PoseV0 } from "@dreamfactory/engine/df/maze-v0";
import { t } from "@dreamfactory/site/locales";
import { chosenSource, filesIn, listSources, type Source } from "./sources";
import { fetchBytes, installEditorPage, serverNote, wireFileOpen } from "./editor-kit";

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const landing = $("landing");
const editor = $("editor");
const statusEl = $("status");
const view = $<HTMLCanvasElement>("view");
const viewCtx = view.getContext("2d")!;
const map = $<HTMLCanvasElement>("map");
const mapCtx = map.getContext("2d")!;

/** 0 north, 1 south, 2 east, 3 west (lunicus/src/game/maze.ts) */
const FACING = ["north", "south", "east", "west"];
const TURN_LEFT = [3, 2, 0, 1];
const TURN_RIGHT = [2, 3, 1, 0];
const FORWARD_DX = [0, 0, 1, -1];
const FORWARD_DY = [-1, 1, 0, 0];
/** three ticks of 60 Hz a frame (0x40d200) */
const FRAME_MS = 50;

const LEFT = 1;
const RIGHT = 2;
const FORWARD = 3;
const MOVE_NAME = ["", "left", "right", "forward"];

/** the map's colours, the same ones the legend lists */
const CELL = "#34485c";
const CELL_HOVER = "#4f6b87";
const YOU = "#30ff60";
/** a wall's colour, from its byte: the commonest in a maze is grey, the rest a hue each */
let wallColor = new Map<number, string>();

/**
 * What the game makes of a wall's byte, place by place, as far as it has been
 * read out of LUNICUS.EXE (docs/engine/formats/dreamfactory-0.md): the base's
 * floors 0x401299 and 0x40103e, the combat levels 0x4017f2. A value not listed
 * is shown as a number only.
 */
function wallNames(name: string): Map<number, string> {
  const m = new Map<number, string>();
  const n = name.toLowerCase();
  if (n.endsWith("bas")) {
    for (const [b, what] of [[2, "an elevator"], [3, "a screen"], [5, "a desk"], [6, "a bed"], [9, n.includes("lower") ? "the control panel" : "the scope, the greenhouse or the power status"], [0xfe, "the transporter end"]] as const)
      m.set(b, what);
  } else if (n.endsWith("citymaze")) {
    for (let b = 1; b <= 14; b++) m.set(b, "a building's door");
    for (let b = 15; b <= 0xff; b++) m.set(b, "a door with no entrance");
  } else if (/buildmaz$|engin\dma$/.test(n)) {
    m.set(2, "a full cabinet").set(9, "an empty cabinet").set(3, "the elevator");
    if (n.includes("build")) for (const b of [4, 5, 6, 8]) m.set(b, "a sign");
  } else if (/hivemaze$|finalmaz$/.test(n)) {
    m.set(2, "a full cabinet").set(10, "an empty cabinet").set(3, "the elevator").set(4, "a film").set(6, "a film").set(9, "the switch that fills the cabinets").set(8, "the queen");
  }
  return m;
}
let names = new Map<number, string>();

// ---- state ------------------------------------------------------------------

let maze: MazeV0 | null = null;
let containers: Uint8Array[] = [];
let fileName = "";
let palette: Uint8ClampedArray | null = null;
let paletteFrom = "";
let pose: PoseV0 = { x: 0, y: 0, dir: 0 };
let playing = false;
let hover: { x: number; y: number } | null = null;
let cellPx = 16;
const fb = new FrameBuffer();

function log(text: string): void {
  statusEl.textContent = text;
}

const samePose = (a: PoseV0, b: PoseV0): boolean => a.x === b.x && a.y === b.y && a.dir === b.dir;
const say = (p: PoseV0): string => `${p.x},${p.y} ${FACING[p.dir]}`;
const hex = (b: number): string => b.toString(16).padStart(2, "0");
/** one of a cell's bytes, under the initial of the way it faces */
const facingByte = (b: number, d: number): string => FACING[d][0].toUpperCase() + " " + hex(b);
/** what a byte opens, if this maze names it, after a space or in brackets */
const spacedName = (b: number): string => (names.has(b) ? " " + names.get(b) : "");
const bracketedName = (b: number): string => (names.has(b) ? " (" + names.get(b) + ")" : "");

function moved(p: PoseV0, move: number): PoseV0 {
  if (move === LEFT) return { ...p, dir: TURN_LEFT[p.dir] };
  if (move === RIGHT) return { ...p, dir: TURN_RIGHT[p.dir] };
  return { x: p.x + FORWARD_DX[p.dir], y: p.y + FORWARD_DY[p.dir], dir: p.dir };
}

/** 0x403420: the transition a move takes, or null for a wall */
const transition = (from: PoseV0, to: PoseV0): MazeTransitionV0 | null =>
  maze!.transitions.find((t) => samePose(t.from, from) && samePose(t.to, to)) ?? null;

/** 0x4034fe: the view at rest, the first frame of a film leaving the pose */
const restFrame = (p: PoseV0): number => maze!.transitions.find((t) => samePose(t.from, p))?.firstFrame ?? -1;

/** a step's or a turn's frames after the first (0x40d200) */
const framesOf = (t: MazeTransitionV0): number => (t.film.from.dir === t.film.to.dir ? 7 : 6);

// ---- loading ----------------------------------------------------------------

function loadMaze(bytes: Uint8Array, name: string): void {
  let parsed: MazeV0;
  let file;
  try {
    file = readContainerFile(bytes);
    parsed = readMazeV0(file);
  } catch (e) {
    log(t("common.notReadable", { ext: "maze", message: (e as Error).message }));
    return;
  }
  maze = parsed;
  containers = file.containers.map((c) => c.data);
  fileName = name;
  names = wallNames(name);
  const start = parsed.transitions[0]?.from;
  if (!start) {
    log(`${name}: a maze with no transitions has nowhere to stand`);
    return;
  }
  pose = start;
  landing.style.display = "none";
  editor.style.display = "flex";
  $("fileName").textContent = name;
  const cells = Array.from({ length: parsed.width * parsed.height }, (_, i) => i).filter((i) => cellV0(parsed, i % parsed.width, Math.floor(i / parsed.width))).length;
  const poses = new Set(parsed.transitions.map((t) => say(t.from))).size;
  const films = parsed.transitions.filter(ownsFilmV0).length;
  $("fileStats").textContent =
    `${parsed.width}×${parsed.height} grid · ${cells} cells · ${poses} poses · ${parsed.transitions.length} transitions · ${films} films · ${containers.length} containers`;
  log(palette ? "" : "no LUNIRES.DLL yet: the view is drawn in a grey ramp — drop the DLL on the page for the game's colours");
  buildLegend();
  buildFilms();
  sizeMap();
  show();
}

function loadPalette(bytes: Uint8Array, name: string): boolean {
  try {
    palette = readClutV0(bytes, "CLUT128");
  } catch (e) {
    log(`${name}: no CLUT128 in it (${(e as Error).message})`);
    return false;
  }
  paletteFrom = name;
  if (maze) {
    log("");
    show();
  }
  return true;
}

async function loadFromFile(f: File): Promise<void> {
  const bytes = new Uint8Array(await f.arrayBuffer());
  if (/\.dll$/i.test(f.name)) {
    if (loadPalette(bytes, f.name) && !maze) log(`${f.name}: the palette is in; now the maze`);
  } else loadMaze(bytes, f.name);
}

wireFileOpen(loadFromFile, (dropped) => {
  // a maze and its DLL can come in one drop: the palette first, so the view opens in it
  const files = [...(dropped ?? [])].sort((a, b) => Number(/\.dll$/i.test(b.name)) - Number(/\.dll$/i.test(a.name)));
  void (async () => {
    for (const f of files) await loadFromFile(f);
  })();
});

/** the mazes' names in the rip: `citymaze.`, `buildmaz.`, `engin1ma.`, `upperbas.` */
const isMaze = (path: string): boolean => /\/[a-z0-9]*(maze|maz|ma|bas)\.$/i.test(path);

/**
 * Dev-server mode: offer every maze there is. Only Lunicus has any, so like the
 * sprite books this falls through to the source that has them.
 */
async function initServerMazes(): Promise<void> {
  const sources = await listSources();
  const chose = chosenSource(sources);
  if (!chose) return; // production / no dev server: upload only
  const has = (s: Source): boolean => s.game.dreamFactory0 === true && filesIn(s, isMaze).length > 0;
  const source = has(chose) ? chose : sources.find(has);
  if (!source) return;
  const mazes = filesIn(source, isMaze).sort((a, b) => a.path.localeCompare(b.path));
  const dll = filesIn(source, (p) => /lunires\.dll$/i.test(p))[0];
  const wrap = $("serverMazes");
  serverNote(
    wrap,
    source === chose
      ? t("common.pickFromGamefiles")
      : `${t("common.pickFromGamefiles")} — ${source.game.short}, the only source here with mazes in it`,
  );
  const row = document.createElement("div");
  row.className = "row mazes";
  for (const f of mazes) {
    const b = document.createElement("button");
    b.className = "maze";
    // two days' `citymaze.` are two files: the folder is part of the name
    b.textContent = f.path.split("/").slice(-2).join("/").replace(/\.$/, "");
    b.title = `${source.game.short} · ${f.path}`;
    b.addEventListener("click", async () => {
      if (!palette && dll) {
        const bytes = await fetchBytes(dll.url, dll.path, log);
        if (bytes) loadPalette(bytes, dll.base);
      }
      log(t("common.loading", { path: f.path }));
      const bytes = await fetchBytes(f.url, f.path, log);
      if (bytes) loadMaze(bytes, b.textContent!);
    });
    row.appendChild(b);
  }
  wrap.appendChild(row);
}
const serverListed = initServerMazes();

$("closeBtn").addEventListener("click", () => {
  maze = null;
  containers = [];
  editor.style.display = "none";
  landing.style.display = "block";
  log("");
});

// ---- the view ---------------------------------------------------------------

const GREY = Uint8ClampedArray.from({ length: 1024 }, (_, i) => (i % 4 === 3 ? 255 : i >> 2));

/** decode a container over the one before it (a film is a delta chain) and draw it */
function drawFrame(container: number): void {
  const data = containers[container];
  if (!data) return;
  const d = decodeFrame(data, fb, undefined, "v0");
  view.width = d.width;
  view.height = d.height;
  const img = viewCtx.createImageData(d.width, d.height);
  indexedToRGBA(fb.pixels, d.width, d.height, palette ?? GREY, img.data);
  viewCtx.putImageData(img, 0, 0);
}

/** the pose at rest: its view, its readout, the map */
function show(): void {
  if (!maze) return;
  const rest = restFrame(pose);
  if (rest >= 0) drawFrame(rest);
  const cell = cellV0(maze, pose.x, pose.y);
  const lines: string[] = [
    `<b>${say(pose)}</b>`,
    cell ? `the cell's bytes: ${cell.map(facingByte).join(" · ")}` : "no cell here",
  ];
  const ahead = cell?.[pose.dir] ?? 0;
  lines.push(
    ahead
      ? `the byte it faces: <b>${hex(ahead)}</b>${bracketedName(ahead)} — a wall, and what a click on the view acts on`
      : "the byte it faces: 00 — open: a step forward, and a click on the view walks",
    `at rest: container @${rest}`,
  );
  for (const move of [LEFT, FORWARD, RIGHT]) {
    const tr = transition(pose, moved(pose, move));
    const button = $<HTMLButtonElement>(`${MOVE_NAME[move]}Btn`);
    button.disabled = !tr || playing;
    if (!tr) {
      lines.push(`${MOVE_NAME[move]}: a wall`);
      continue;
    }
    const whose = ownsFilmV0(tr) ? "its own film" : `the film of ${say(tr.film.from)} → ${say(tr.film.to)}`;
    lines.push(`${MOVE_NAME[move]}: to ${say(tr.to)} · ${whose}, @${tr.firstFrame}, ${framesOf(tr)} frames after the first`);
  }
  lines.push(palette ? `drawn in ${paletteFrom}'s CLUT128` : "drawn in a grey ramp: no LUNIRES.DLL");
  $("previewInfo").innerHTML = lines.join("<br>");
  drawMap();
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** play a transition's film the way the game does, and stand where it ends */
async function play(tr: MazeTransitionV0): Promise<void> {
  if (playing) return;
  playing = true;
  show();
  const ms = $<HTMLInputElement>("slow").checked ? FRAME_MS * 4 : FRAME_MS;
  // the chain starts at the film's first frame, the view already on screen at rest
  drawFrame(tr.firstFrame);
  for (let k = 1; k <= framesOf(tr); k++) {
    await sleep(ms);
    if (!maze) {
      playing = false;
      return;
    }
    drawFrame(tr.firstFrame + k);
  }
  await sleep(ms);
  playing = false;
  pose = tr.to;
  show();
}

function move(kind: number): void {
  if (!maze || playing) return;
  const tr = transition(pose, moved(pose, kind));
  if (tr) void play(tr);
}

$("leftBtn").addEventListener("click", () => move(LEFT));
$("forwardBtn").addEventListener("click", () => move(FORWARD));
$("rightBtn").addEventListener("click", () => move(RIGHT));
document.addEventListener("keydown", (e) => {
  if (!maze || e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
  const kind = { ArrowLeft: LEFT, ArrowRight: RIGHT, ArrowUp: FORWARD }[e.key];
  if (!kind) return;
  e.preventDefault();
  move(kind);
});

// ---- the map ----------------------------------------------------------------

function sizeMap(): void {
  const m = maze!;
  cellPx = Math.max(10, Math.min(24, Math.floor(512 / Math.max(m.width, m.height))));
  map.width = m.width * cellPx;
  map.height = m.height * cellPx;
  $("mapStats").textContent = `north up · x across, y down · ${cellPx} px a cell`;
}

function drawMap(): void {
  const m = maze;
  if (!m) return;
  const s = cellPx;
  mapCtx.clearRect(0, 0, map.width, map.height);
  for (let x = 0; x < m.width; x++) {
    for (let y = 0; y < m.height; y++) {
      const c = cellV0(m, x, y);
      if (!c) continue;
      const px = x * s;
      const py = y * s;
      mapCtx.fillStyle = hover?.x === x && hover.y === y ? CELL_HOVER : CELL;
      mapCtx.fillRect(px + 1, py + 1, s - 2, s - 2);
      // a facing byte that is not 0 is the wall on that side (dir 0 the top edge),
      // in its value's colour
      const w = Math.max(2, Math.floor(s / 6));
      const wall = (b: number, x0: number, y0: number, ww: number, hh: number): void => {
        if (!b) return;
        mapCtx.fillStyle = wallColor.get(b)!;
        mapCtx.fillRect(x0, y0, ww, hh);
      };
      wall(c[0], px + 1, py + 1, s - 2, w);
      wall(c[1], px + 1, py + s - 1 - w, s - 2, w);
      wall(c[2], px + s - 1 - w, py + 1, w, s - 2);
      wall(c[3], px + 1, py + 1, w, s - 2);
    }
  }
  // where the view stands, an arrow the way it faces
  const cx = pose.x * s + s / 2;
  const cy = pose.y * s + s / 2;
  const [dx, dy] = [FORWARD_DX[pose.dir], FORWARD_DY[pose.dir]];
  const r = s * 0.36;
  mapCtx.fillStyle = YOU;
  mapCtx.beginPath();
  mapCtx.moveTo(cx + dx * r, cy + dy * r);
  mapCtx.lineTo(cx - dx * r * 0.7 - dy * r * 0.8, cy - dy * r * 0.7 + dx * r * 0.8);
  mapCtx.lineTo(cx - dx * r * 0.7 + dy * r * 0.8, cy - dy * r * 0.7 - dx * r * 0.8);
  mapCtx.closePath();
  mapCtx.fill();
}

function cellAt(e: MouseEvent): { x: number; y: number } {
  const b = map.getBoundingClientRect();
  return {
    x: Math.floor(((e.clientX - b.left) * map.width) / b.width / cellPx),
    y: Math.floor(((e.clientY - b.top) * map.height) / b.height / cellPx),
  };
}

map.addEventListener("mousemove", (e) => {
  if (!maze) return;
  const at = cellAt(e);
  if (hover?.x === at.x && hover.y === at.y) return;
  hover = at;
  const c = cellV0(maze, at.x, at.y);
  const facings = [0, 1, 2, 3].filter((dir) => restFrame({ ...at, dir }) >= 0).map((d) => FACING[d]);
  if (c) {
    const bytes = c.map((b, d) => facingByte(b, d) + bracketedName(b)).join(" ");
    const views = facings.length ? `views ${facings.join(", ")}` : "no view";
    $("mapSay").textContent = `${at.x},${at.y} · bytes ${bytes} · ${views}`;
  } else {
    $("mapSay").textContent = `${at.x},${at.y} · no cell`;
  }
  drawMap();
});
map.addEventListener("mouseleave", () => {
  hover = null;
  $("mapSay").textContent = "";
  drawMap();
});
/** a click stands the view in that cell, facing the same way where it can */
map.addEventListener("click", (e) => {
  if (!maze || playing) return;
  const at = cellAt(e);
  const dirs = [pose.dir, 0, 1, 2, 3];
  const dir = dirs.find((d) => restFrame({ ...at, dir: d }) >= 0);
  if (dir === undefined) return;
  pose = { ...at, dir };
  show();
});

/** the walls' bytes in this maze, commonest first, each given its colour */
function buildLegend(): void {
  const m = maze!;
  const count = new Map<number, number>();
  for (let x = 0; x < m.width; x++)
    for (let y = 0; y < m.height; y++) for (const b of cellV0(m, x, y) ?? []) if (b) count.set(b, (count.get(b) ?? 0) + 1);
  const values = [...count].sort((a, b) => b[1] - a[1] || a[0] - b[0]);
  wallColor = new Map(values.map(([b], k) => [b, k === 0 ? "#8a96a3" : `hsl(${Math.round((k * 360) / values.length + 20) % 360} 85% 58%)`]));
  $("legend").innerHTML = [
    `<span><i style="background:${CELL}"></i>a cell</span>`,
    `<span><i style="background:${YOU}"></i>the view, the way it faces</span>`,
    `<span class="muted">walls, by the byte they face (0 is open):</span>`,
    ...values.map(([b, n]) => `<span><i style="background:${wallColor.get(b)}"></i>${hex(b)}${spacedName(b)} ×${n}</span>`),
  ].join("");
}

// ---- the films --------------------------------------------------------------

function buildFilms(): void {
  const m = maze!;
  const owners = m.transitions.filter(ownsFilmV0).sort((a, b) => a.firstFrame - b.firstFrame);
  const borrowed = new Map<number, number>();
  for (const t of m.transitions) if (!ownsFilmV0(t)) borrowed.set(t.firstFrame, (borrowed.get(t.firstFrame) ?? 0) + 1);
  $("filmStats").textContent = `${owners.length} films for ${m.transitions.length} transitions — a film is shared where two places look the same`;
  const list = $("films");
  list.textContent = "";
  for (const tr of owners) {
    const b = document.createElement("button");
    const kind = tr.from.dir === tr.to.dir ? "step" : "turn";
    const more = borrowed.get(tr.firstFrame) ?? 0;
    const by = more ? ` · played by ${more} more` : "";
    b.innerHTML = `@${tr.firstFrame} · ${tr.frames} frames · ${kind} <span class="where">${say(tr.from)} → ${say(tr.to)}${by}</span>`;
    b.title = "stand where it starts and play it";
    b.addEventListener("click", () => {
      if (playing) return;
      pose = tr.from;
      show();
      void play(tr);
    });
    list.appendChild(b);
  }
}

void installEditorPage();
await serverListed;
