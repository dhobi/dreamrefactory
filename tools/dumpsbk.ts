/**
 * Dump a Skull Cracker sprite book (`.SBK`) — its cels, its level plan and its
 * parallax backdrop — as text and PNGs.
 *
 *   npx tsx tools/dumpsbk.ts skullcracker/gamefiles/SKULL/DATA/GRAVE.SBK out/
 *
 * The format is `engine/src/df/sbk.ts`, and its module comment is where the four
 * structures are written down; this is the command line over it. For the same
 * thing in a browser, with the layers separable and the entities clickable, see
 * `site/editors/books.html`.
 *
 * What the level PNG is: every placement composited far-to-near at its stored
 * position, with the entity rects drawn on top. The layers only line up under
 * the camera `SC.EXE` owns, so this is the level unrolled rather than any one
 * screen of it — a true picture of the data and a false one of the game.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { basename, join } from "node:path";
import { ShpFrame, decodeShpFrame } from "@dreamfactory/engine/df/shp";
import { SbkFile, isSbkFile, nearestLayer, readSbkFile } from "@dreamfactory/engine/df/sbk";
import { paletteToRGBA } from "@dreamfactory/engine/df/image";
import { encodePNG } from "./png";

const [, , sbkPath, outDir = "out"] = process.argv;
const bytes = new Uint8Array(readFileSync(sbkPath));
if (!isSbkFile(bytes)) {
  // the DirectX SoundFont bank shares the extension and nothing else
  console.log(`${sbkPath} is not a DreamFactory container (a RIFF SoundFont, if it came off the disc)`);
  process.exit(1);
}
const sbk: SbkFile = readSbkFile(bytes);
const { cels, byId, entities, placements } = sbk;
const pal = sbk.paletteRaw ? paletteToRGBA(sbk.paletteRaw, 256) : null;

const name = basename(sbkPath).replace(/\.sbk$/i, "");
console.log(`${name}: ${sbk.file.containers.length} containers, ${cels.length} cels in the directory`);

// ---- the level plan, as text ----------------------------------------------

const kinds = new Map<string, number>();
for (const e of entities) kinds.set(e.name, (kinds.get(e.name) ?? 0) + 1);
console.log(`entities: ${entities.length}`);
for (const [k, n] of [...kinds].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(4)} x ${k}`);

const near = nearestLayer(sbk);
const layers = new Map<number, number>();
for (const p of placements) layers.set(p.parallax, (layers.get(p.parallax) ?? 0) + 1);
const unresolved = placements.filter((p) => !byId.has(p.id)).length;
console.log(`backdrop: ${placements.length} placements (${unresolved} unresolved), parallax layers:`);
for (const [f, n] of [...layers].sort((a, b) => a[0] - b[0])) {
  console.log(`  ${f.toFixed(5)}${f === near ? " (the plane most of it is on)" : ""} x ${n}`);
}

if (!pal) {
  console.log("no palette container — skipping PNGs");
  process.exit(0);
}
mkdirSync(outDir, { recursive: true });

const cache = new Map<number, ShpFrame>();
const cel = (loc: number): ShpFrame => {
  let f = cache.get(loc);
  if (!f) cache.set(loc, (f = decodeShpFrame(sbk.file.containers[loc].data)));
  return f;
};

// ---- a contact sheet of the cels -------------------------------------------

{
  const CW = 160;
  const CH = 160;
  const COLS = 8;
  const MAX = 64;
  const shown = cels.slice(0, MAX);
  const rows = Math.ceil(shown.length / COLS);
  const img = new Uint8ClampedArray(COLS * CW * rows * CH * 4);
  shown.forEach((e, n) => {
    const f = cel(e.location);
    const ox = (n % COLS) * CW;
    const oy = Math.floor(n / COLS) * CH;
    for (let y = 0; y < Math.min(f.height, CH); y++) {
      for (let x = 0; x < Math.min(f.width, CW); x++) {
        const s = y * f.width + x;
        if (!f.opaque[s]) continue;
        const t = ((oy + y) * COLS * CW + ox + x) * 4;
        const p = f.indexed[s] * 4;
        img[t] = pal[p];
        img[t + 1] = pal[p + 1];
        img[t + 2] = pal[p + 2];
        img[t + 3] = 255;
      }
    }
  });
  const sheet = join(outDir, `${name}-cels.png`);
  writeFileSync(sheet, encodePNG(img, COLS * CW, rows * CH));
  console.log(`wrote ${sheet} (${shown.length} of ${cels.length} cels)`);
}

// ---- the level, unrolled ----------------------------------------------------

/**
 * Render placements far-to-near onto one canvas, with the entity rects on top.
 * Positions are used as stored: the layers only line up under the executable's
 * camera, so this is the level unrolled, not any one screen of it.
 *
 * The canvas is trimmed to the 1st..99th percentile of placement positions
 * (LAB parks a far layer 30000 pixels off the play space); anything outside is
 * skipped and SAID to be skipped.
 */
function renderLevel(): void {
  const placed = placements
    .filter((p) => byId.has(p.id))
    .sort((a, b) => b.parallax - a.parallax);
  if (!placed.length) {
    console.log("no placements — not a level (the player's book, most likely)");
    return;
  }
  const pct = (xs: number[], q: number): number => xs.sort((a, b) => a - b)[Math.floor((xs.length - 1) * q)];
  const xs = placed.map((p) => p.x);
  const ys = placed.map((p) => p.y);
  const MARGIN = 700; // roomier than the widest shipped cel
  const lo = { x: pct(xs, 0.01) - MARGIN, y: pct(ys, 0.01) - MARGIN };
  const hi = { x: pct(xs, 0.99) + MARGIN, y: pct(ys, 0.99) + MARGIN };

  let x0 = 1e9;
  let y0 = 1e9;
  let x1 = -1e9;
  let y1 = -1e9;
  let skipped = 0;
  const inRange: { f: ShpFrame; x: number; y: number }[] = [];
  for (const p of placed) {
    const f = cel(byId.get(p.id)!);
    const x = p.x + f.posXraw;
    const y = p.y + f.posYraw;
    if (x < lo.x || y < lo.y || x + f.width > hi.x || y + f.height > hi.y) {
      skipped++;
      continue;
    }
    inRange.push({ f, x, y });
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x + f.width);
    y1 = Math.max(y1, y + f.height);
  }
  for (const e of entities) {
    x0 = Math.min(x0, e.left);
    y0 = Math.min(y0, e.top);
    x1 = Math.max(x1, e.right);
    y1 = Math.max(y1, e.bottom);
  }
  const W = x1 - x0;
  const H = y1 - y0;
  const img = new Uint8ClampedArray(W * H * 4);
  for (const { f, x, y } of inRange) {
    const ox = x - x0;
    const oy = y - y0;
    for (let ry = 0; ry < f.height; ry++) {
      for (let rx = 0; rx < f.width; rx++) {
        const s = ry * f.width + rx;
        if (!f.opaque[s]) continue;
        const t = ((oy + ry) * W + ox + rx) * 4;
        const p = f.indexed[s] * 4;
        img[t] = pal![p];
        img[t + 1] = pal![p + 1];
        img[t + 2] = pal![p + 2];
        img[t + 3] = 255;
      }
    }
  }

  // point-sample down to a viewable size, THEN draw the rects so they stay 1px
  const S = Math.max(1, Math.ceil(Math.max(W, H) / 2000));
  const sw = Math.floor(W / S);
  const sh = Math.floor(H / S);
  const small = new Uint8ClampedArray(sw * sh * 4);
  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < sw; x++) {
      const s = (y * S * W + x * S) * 4;
      const t = (y * sw + x) * 4;
      for (let k = 0; k < 4; k++) small[t + k] = img[s + k];
    }
  }
  const COLORS: Record<string, number[]> = {
    platform: [0, 255, 0],
    ladder: [255, 255, 0],
    obstacle: [255, 0, 255],
    goal: [255, 0, 0],
  };
  for (const e of entities) {
    const c =
      COLORS[e.name] ??
      (e.name.startsWith("init") ? [0, 160, 255] : e.name.startsWith("stat") ? [255, 128, 0] : [160, 160, 160]);
    const px = (x: number, y: number): void => {
      if (x < 0 || y < 0 || x >= sw || y >= sh) return;
      const t = (y * sw + x) * 4;
      small[t] = c[0];
      small[t + 1] = c[1];
      small[t + 2] = c[2];
      small[t + 3] = 255;
    };
    const l = Math.round((e.left - x0) / S);
    const r = Math.round((e.right - x0) / S);
    const t = Math.round((e.top - y0) / S);
    const b = Math.round((e.bottom - y0) / S);
    for (let x = l; x <= r; x++) {
      px(x, t);
      px(x, b);
    }
    for (let y = t; y <= b; y++) {
      px(l, y);
      px(r, y);
    }
  }
  const out = join(outDir, `${name}-level.png`);
  writeFileSync(out, encodePNG(small, sw, sh));
  console.log(
    `wrote ${out} (${sw}x${sh}, 1:${S}${skipped ? `, ${skipped} placement(s) outside the trimmed canvas skipped` : ""})`,
  );
}

renderLevel();
