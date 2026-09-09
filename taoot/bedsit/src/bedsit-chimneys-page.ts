/**
 * The chimney picker: the photograph behind the bedsit's windows, and a way to
 * point at the flues in it.
 *
 * Served under the room itself, at `/bedsit/chimneys/`. It draws
 * `public/bedsit-street.jpg` and, over it, every plume in
 * {@link file://./bedsit-chimneys.ts} as the outline of the quad the page
 * actually builds — its lean, its spread and its height, so what is being
 * placed is what will be seen. A click adds a plume, a drag moves one, two
 * sliders size it, and the box at the foot of the window is the table again,
 * to paste back into the module.
 *
 * It exists because placing a plume by reading pixel coordinates off a
 * screenshot does not work: four rules were tried for finding these mouths
 * automatically and each one put a plume or two in the sky where no chimney
 * was. A person with the picture in front of them is the instrument.
 *
 * Edits live in `localStorage` under {@link SAVE}, so a reload keeps them and
 * nothing here writes to the repository — the paste is deliberate, and is the
 * only way a change reaches the room.
 */
import { siteUrl } from "@dreamfactory/site/site";
import { CHIMNEYS, Chimney, PLUME_RISE, WIND } from "./bedsit-chimneys";

const SAVE = "bedsit-chimneys";
const PHOTO = "bedsit/street.jpg";
/** what a new plume starts as: a terrace's pot, until it is told otherwise */
const FRESH = { w: 80, density: 0.5 };
/** a click that moved less than this is a click; more, and it was a drag */
const SLOP = 4;

const canvas = document.getElementById("view") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;
const table = document.getElementById("table") as HTMLTextAreaElement;
const editor = document.getElementById("edit") as HTMLElement;
const which = document.getElementById("which") as HTMLElement;
const where = document.getElementById("where") as HTMLElement;

const photo = new Image();
photo.src = siteUrl(PHOTO);

/** the working copy: what was saved last time, or the module's own list */
function load(): Chimney[] {
  try {
    const saved = localStorage.getItem(SAVE);
    if (saved) return JSON.parse(saved) as Chimney[];
  } catch { /* a private window, or something else's key: start from the module */ }
  return CHIMNEYS.map((c) => ({ ...c }));
}
let chimneys = load();
let picked = -1;

/** the view: which picture pixel is at the middle of the window, and how big it is */
const view = { x: 0, y: 0, zoom: 1 };
function fit(): void {
  view.zoom = Math.min(canvas.clientWidth / photo.naturalWidth, canvas.clientHeight / photo.naturalHeight);
  view.x = photo.naturalWidth / 2;
  view.y = photo.naturalHeight / 2;
}
const toScreen = (px: number, py: number): [number, number] => [
  canvas.clientWidth / 2 + (px - view.x) * view.zoom,
  canvas.clientHeight / 2 + (py - view.y) * view.zoom,
];
const toPhoto = (sx: number, sy: number): [number, number] => [
  view.x + (sx - canvas.clientWidth / 2) / view.zoom,
  view.y + (sy - canvas.clientHeight / 2) / view.zoom,
];

/**
 * The outline of one plume's quad, in picture pixels: the same rectangle
 * `lightSmoke` builds — half a lean downwind of the mouth, `w` across and `h`
 * up — with the spine the shader draws inside it sketched in.
 */
function outline(c: Chimney): { x0: number; x1: number; top: number; mid: number } {
  const half = c.w / 2;
  const mid = c.px + WIND * 0.5 * half;
  return { x0: mid - half, x1: mid + half, top: c.py - c.h, mid };
}

function draw(): void {
  const dpr = Math.min(2, devicePixelRatio || 1);
  const w = Math.round(canvas.clientWidth * dpr), h = Math.round(canvas.clientHeight * dpr);
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);
  ctx.imageSmoothingEnabled = view.zoom < 2;

  const [ox, oy] = toScreen(0, 0);
  ctx.drawImage(photo, ox, oy, photo.naturalWidth * view.zoom, photo.naturalHeight * view.zoom);

  chimneys.forEach((c, i) => {
    const box = outline(c);
    const [x0, y0] = toScreen(box.x0, box.top);
    const [x1, y1] = toScreen(box.x1, c.py);
    const on = i === picked;
    // the quad the page will build, and the spine of the plume inside it
    ctx.lineWidth = on ? 2 : 1;
    ctx.strokeStyle = on ? "#d9a94c" : `rgba(217, 169, 76, ${0.22 + 0.5 * c.density})`;
    ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
    ctx.beginPath();
    const [mx, my] = toScreen(c.px, c.py);
    const [tx, ty] = toScreen(box.mid + WIND * (c.w / 2) * 0.5, box.top);
    ctx.moveTo(mx, my);
    ctx.quadraticCurveTo(mx, my - (my - ty) * 0.6, tx, ty);
    ctx.stroke();
    // the mouth itself, which is the thing being placed
    ctx.fillStyle = on ? "#d9a94c" : "#7fd3e8";
    ctx.beginPath();
    ctx.arc(mx, my, on ? 5 : 3.5, 0, 2 * Math.PI);
    ctx.fill();
  });
  requestAnimationFrame(draw);
}

/** which plume's mouth is under a point on the screen, or -1 */
function hit(sx: number, sy: number): number {
  for (let i = chimneys.length - 1; i >= 0; i--) {
    const [mx, my] = toScreen(chimneys[i].px, chimneys[i].py);
    if (Math.hypot(mx - sx, my - sy) <= 9) return i;
  }
  return -1;
}

/** one row of the module's own table */
const row = (c: Chimney): string =>
  `  { px: ${Math.round(c.px)}, py: ${Math.round(c.py)}, w: ${Math.round(c.w)}, h: ${Math.round(c.h)}, density: ${+c.density.toFixed(2)} },`;

/** the table, as the module wants it, and the working copy put away */
function publish(): void {
  chimneys.sort((a, b) => a.px - b.px);
  table.value = chimneys.map(row).join("\n");
  try { localStorage.setItem(SAVE, JSON.stringify(chimneys)); } catch { /* nothing to be done about it */ }
  show();
}

/** publish, and keep hold of the one that is selected: the sort moves it */
function republish(held: Chimney | undefined): void {
  publish();
  picked = held ? chimneys.indexOf(held) : -1;
  show();
}

/** the editor, on whatever is selected */
function show(): void {
  const c = chimneys[picked];
  editor.classList.toggle("none", !c);
  which.textContent = c ? `the one at ${Math.round(c.px)}, ${Math.round(c.py)}` : "nothing selected";
  const set = (id: string, value: number, text: string): void => {
    (document.getElementById(id) as HTMLInputElement).value = String(value);
    (document.getElementById(`${id}-out`) as HTMLElement).textContent = text;
  };
  set("w", c ? c.w : 80, c ? String(Math.round(c.w)) : "—");
  set("d", c ? c.density : 0.5, c ? c.density.toFixed(2) : "—");
  set("rise", c ? c.h / c.w : PLUME_RISE, c ? (c.h / c.w).toFixed(2) : "—");
}

// --- the mouse ---------------------------------------------------------------
let drag: { sx: number; sy: number; moved: number; on: number; px: number; py: number; vx: number; vy: number } | null = null;

canvas.addEventListener("pointerdown", (e) => {
  canvas.setPointerCapture(e.pointerId);
  const on = hit(e.clientX, e.clientY);
  if (on >= 0) { picked = on; show(); }
  drag = {
    sx: e.clientX, sy: e.clientY, moved: 0, on,
    px: on >= 0 ? chimneys[on].px : 0, py: on >= 0 ? chimneys[on].py : 0,
    vx: view.x, vy: view.y,
  };
});

canvas.addEventListener("pointermove", (e) => {
  const [px, py] = toPhoto(e.clientX, e.clientY);
  where.textContent = `${Math.round(px)}, ${Math.round(py)}`;
  if (!drag) { canvas.style.cursor = hit(e.clientX, e.clientY) >= 0 ? "grab" : "crosshair"; return; }
  const dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
  drag.moved = Math.max(drag.moved, Math.hypot(dx, dy));
  if (drag.on >= 0) {
    chimneys[drag.on].px = drag.px + dx / view.zoom;
    chimneys[drag.on].py = drag.py + dy / view.zoom;
  } else {
    view.x = drag.vx - dx / view.zoom;
    view.y = drag.vy - dy / view.zoom;
  }
});

canvas.addEventListener("pointerup", (e) => {
  if (!drag) return;
  // a click on nothing puts a new plume there; a click on one only selects it
  if (drag.moved < SLOP && drag.on < 0) {
    const [px, py] = toPhoto(e.clientX, e.clientY);
    chimneys.push({ px, py, w: FRESH.w, h: Math.round(FRESH.w * PLUME_RISE), density: FRESH.density });
    picked = chimneys.length - 1;
  }
  const held = chimneys[picked];
  drag = null;
  republish(held);
});

canvas.addEventListener("wheel", (e) => {
  e.preventDefault();
  const [ax, ay] = toPhoto(e.clientX, e.clientY);
  view.zoom = Math.max(0.15, Math.min(12, view.zoom * Math.exp(-e.deltaY * 0.0016)));
  // keep the picture pixel under the cursor under the cursor
  const [bx, by] = toPhoto(e.clientX, e.clientY);
  view.x += ax - bx;
  view.y += ay - by;
}, { passive: false });

/** the arrow keys, in picture pixels */
const NUDGE: Readonly<Record<string, readonly [number, number]>> = {
  ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1],
};

addEventListener("keydown", (e) => {
  if (e.key === "f" || e.key === "F") fit();
  if ((e.key === "Backspace" || e.key === "Delete") && picked >= 0) {
    chimneys.splice(picked, 1);
    picked = -1;
    publish();
  }
  const step = NUDGE[e.key];
  if (step && picked >= 0) {
    // A mouth lands where the mouse let go of it, which is a fraction of a
    // pixel; the table rounds that, so the arrows round it FIRST and then step
    // by whole pixels. Otherwise a nudge of one moves the written number by two
    // as often as not, and a chimney cannot be walked onto its flue.
    e.preventDefault();
    const held = chimneys[picked];
    const far = e.shiftKey ? 10 : 1;
    held.px = Math.round(held.px) + step[0] * far;
    held.py = Math.round(held.py) + step[1] * far;
    republish(held);
  }
});

// --- the sliders -------------------------------------------------------------
const slide = (id: string, apply: (c: Chimney, v: number) => void, text: (v: number) => string): void => {
  const input = document.getElementById(id) as HTMLInputElement;
  input.addEventListener("input", () => {
    const c = chimneys[picked];
    if (!c) return;
    apply(c, +input.value);
    (document.getElementById(`${id}-out`) as HTMLElement).textContent = text(+input.value);
    try { localStorage.setItem(SAVE, JSON.stringify(chimneys)); } catch { /* as above */ }
    // not `publish`, which sorts: a slider must not move the row under the hand
    table.value = chimneys.map(row).join("\n");
  });
};
// width keeps the plume's proportions; rise changes them
slide("w", (c, v) => { const rise = c.h / c.w; c.w = v; c.h = Math.round(v * rise); }, (v) => String(Math.round(v)));
slide("d", (c, v) => { c.density = v; }, (v) => v.toFixed(2));
slide("rise", (c, v) => { c.h = Math.round(c.w * v); }, (v) => v.toFixed(2));

(document.getElementById("drop") as HTMLButtonElement).addEventListener("click", () => {
  if (picked < 0) return;
  chimneys.splice(picked, 1);
  picked = -1;
  publish();
});
(document.getElementById("copy") as HTMLButtonElement).addEventListener("click", async () => {
  const button = document.getElementById("copy") as HTMLButtonElement;
  try { await navigator.clipboard.writeText(table.value); button.textContent = "copied"; }
  catch { table.select(); button.textContent = "select and copy"; }
  // and it says so until the next thing you do, rather than for a second and a
  // half: a page that reads the wall clock to relabel a button is a page that
  // reads the wall clock, and this repository counts those
  addEventListener("pointerdown", () => { button.textContent = "copy"; }, { once: true });
});
(document.getElementById("revert") as HTMLButtonElement).addEventListener("click", () => {
  chimneys = CHIMNEYS.map((c) => ({ ...c }));
  picked = -1;
  publish();
});

// Not a top-level await: the build targets browsers that have none, and this
// page is built like every other — a tool that only exists on a dev server is
// a tool nobody uses.
void photo.decode().then(() => {
  fit();
  publish();
  draw();
});
