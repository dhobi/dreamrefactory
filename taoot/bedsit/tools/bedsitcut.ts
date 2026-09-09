/**
 * The four pictures in the armchair's corner, cut out of BEDSIT1.SET.
 *
 *   npx tsx taoot/bedsit/tools/bedsitcut.ts <out dir> [texel]
 *
 * {@link file://./bedsitpics.ts} bakes the three big pictures the way the room
 * is textured — every view that can see a texel, averaged. That is right for a
 * wall and WRONG for a picture forty pixels wide: the views disagree about
 * where each brush stroke is by more than a stroke, so the mean of them is a
 * vertical corduroy with a composition somewhere behind it. What the corner
 * four want instead is ONE view, rectified: the frame that stood nearest and
 * squarest, resampled off the picture's own plane, and nothing else mixed in.
 *
 * So this ranks the named standpoints by how many pixels of each picture they
 * hold, and writes the best few, each on its own:
 *
 *   <id>-<Scene>-<View>.png       the rectification, one texel per texel, as it
 *                                 came off the frame — no correction at all
 *   <id>-<Scene>-<View>-read.png  the same, blown up eight times, with the room's
 *                                 light divided out and the levels pulled open
 *   <id>-wide-<Scene>-<View>.png  the picture plus 260 units of wall all round,
 *                                 which is how to check the crop is the picture
 *
 * The `-read` plates are the ones to look at and to search with. A picture in
 * this corner is lit by a standard lamp a metre from it, so its own left is two
 * stops down on its own right and no single stretch of the levels can show
 * both ends; estimating that gradient as the plate's own low frequencies and
 * dividing it out is what makes the subject legible. It is a manipulation, and
 * that is why the uncorrected plate is written beside it.
 *
 * What none of this can do is add resolution. The table this prints ends with
 * the widest any view ever saw each picture, and that is the whole of what the
 * disc holds: 50 pixels for the portrait, 44 for the print, 41 for the two-figure
 * photograph. Anything wider is interpolation, whoever does it.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { LEFTTURNS, RIGHTTURNS, readSetFile } from "@dreamfactory/engine/df/set";
import { indexedToRGBA, paletteToRGBA } from "@dreamfactory/engine/df/image";
import { RingCache } from "@dreamfactory/engine/web/ring-cache";
import { Chart, PICTURES, ROOM, V3 } from "../src/bedsit-room";

const [OUT, TEXEL_ARG, SET_ARG] = process.argv.slice(2);
if (!OUT) {
  console.error("usage: npx tsx taoot/bedsit/tools/bedsitcut.ts <out dir> [texel] [path/to/bedsit1.set]");
  process.exit(2);
}
const TEXEL = +(TEXEL_ARG ?? 4);
/** how much wall the `-wide` plates take around a picture */
const MARGIN = 260;
/** how many views to write per picture */
const KEEP = 3;
const HERE = dirname(fileURLToPath(import.meta.url));
mkdirSync(OUT, { recursive: true });
const set = readSetFile(new Uint8Array(readFileSync(SET_ARG ?? join(HERE, "../../gamefiles/en/titanic1/data/bedsit1.set"))));
const VW = set.viewPortWidth, VH = set.viewPortHeight, FOCAL = Math.max(VW, VH) / 2;

// --- PNG ---------------------------------------------------------------------
function png(w: number, h: number, rgba: Uint8Array): Buffer {
  const raw = Buffer.alloc(h * (w * 4 + 1));
  for (let y = 0; y < h; y++) Buffer.from(rgba.buffer, y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1);
  const table = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (b: Buffer): number => {
    let c = 0xffffffff;
    for (const byte of b) c = table[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer): Buffer => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}

// --- the frames, by the name the game gives them ------------------------------
interface Standpoint {
  name: string;
  ex: number; ey: number; ez: number;
  /** the bearing, as its cosine and sine */
  c: number; s: number;
  rgba: Uint8Array;
}

/** every named standpoint, one frame each, decoded */
function standpoints(): Standpoint[] {
  const cache = new RingCache(set);
  const pal = paletteToRGBA(set.paletteRaw, set.colorCount);
  const out: Standpoint[] = [];
  for (const scene of set.scenes) {
    for (const view of scene.views) {
      for (const d of [RIGHTTURNS, LEFTTURNS] as const) {
        const frames = scene.turns[d].frames;
        const decoded = cache.ensure(frames);
        const fi = frames.find((f) => f.motionInfo === 2 && (f.axisX8 & 0xff) === (view.rotation8 & 0xff));
        const cf = fi && decoded.get(fi.frameContainerLoc);
        if (!fi || !cf) continue;
        const th = (2 * Math.PI * (fi.axisX8 & 0xff)) / 256;
        out.push({
          name: `${scene.sceneName}/${view.viewName}`,
          ex: fi.posX16, ey: fi.posZ16, ez: fi.posY16,
          c: Math.cos(th), s: Math.sin(th),
          rgba: new Uint8Array(indexedToRGBA(cf.pixels, cf.width, cf.height, pal).buffer),
        });
        break;
      }
    }
  }
  return out;
}

// --- the four, each as a chart on its own wall --------------------------------
interface Corner { id: string; wall: "x0" | "y0"; u0: number; u1: number; v0: number; v1: number; note?: string }

const CORNER: Corner[] = [
  { id: "portrait", wall: "x0", u0: PICTURES.portrait.y0, u1: PICTURES.portrait.y1, v0: PICTURES.portrait.z0, v1: PICTURES.portrait.z1 },
  { id: "sketch", wall: "y0", u0: PICTURES.sketch.x0, u1: PICTURES.sketch.x1, v0: PICTURES.sketch.z0, v1: PICTURES.sketch.z1 },
  { id: "print", wall: "y0", u0: PICTURES.print.x0, u1: PICTURES.print.x1, v0: PICTURES.print.z0, v1: PICTURES.print.z1 },
  { id: "hidden", wall: "y0", u0: PICTURES.hidden.x0, u1: PICTURES.hidden.x1, v0: PICTURES.hidden.z0, v1: PICTURES.hidden.z1,
    note: "the standard lamp's shade is between every camera and this one — what comes out is the shade" },
];

function chartOf(c: Corner, margin = 0): Chart {
  const u0 = c.u0 - margin, u1 = c.u1 + margin, v0 = c.v0 - margin, v1 = c.v1 + margin;
  return c.wall === "x0"
    ? { id: c.id as never, sharp: true, smooth: true, u0, u1, v0, v1,
        at: (u, v): V3 => [ROOM.x0 + PICTURES.proud, u, v], normalAt: (): V3 => [1, 0, 0], uvOf: (p) => [p[1], p[2]] }
    : { id: c.id as never, sharp: true, smooth: true, u0, u1, v0, v1,
        at: (u, v): V3 => [u, ROOM.y0 + PICTURES.proud, v], normalAt: (): V3 => [0, 1, 0], uvOf: (p) => [p[0], p[2]] };
}

/** where a world point lands in a frame, and how far off it is */
function project(L: Standpoint, p: V3): { sx: number; sy: number; depth: number } {
  const dx = p[0] - L.ex, dy = p[1] - L.ey, dz = p[2] - L.ez;
  const depth = dx * L.c + dy * L.s;
  return { sx: VW / 2 + ((dy * L.c - dx * L.s) * FOCAL) / depth, sy: VH / 2 - (dz * FOCAL) / depth, depth };
}

/** a frame read between its pixels */
function bilinear(rgba: Uint8Array, sx: number, sy: number): [number, number, number] {
  const x = Math.min(VW - 1.001, Math.max(0, sx - 0.5)), y = Math.min(VH - 1.001, Math.max(0, sy - 0.5));
  const x0 = x | 0, y0 = y | 0, tx = x - x0, ty = y - y0;
  const out: [number, number, number] = [0, 0, 0];
  for (let c = 0; c < 3; c++) {
    const a = rgba[(y0 * VW + x0) * 4 + c], b = rgba[(y0 * VW + x0 + 1) * 4 + c];
    const d = rgba[((y0 + 1) * VW + x0) * 4 + c], e = rgba[((y0 + 1) * VW + x0 + 1) * 4 + c];
    out[c] = a + (b - a) * tx + (d - a) * ty + (a - b - d + e) * tx * ty;
  }
  return out;
}

interface Plate { width: number; height: number; rgba: Uint8Array }

/** one standpoint, resampled onto one chart — no depth test and no other view,
 *  because a picture is flat on its wall and the whole point is one frame's own
 *  pixels, undisturbed */
function rectify(chart: Chart, L: Standpoint, texel: number): Plate {
  const width = Math.max(1, Math.round((chart.u1 - chart.u0) / texel));
  const height = Math.max(1, Math.round((chart.v1 - chart.v0) / texel));
  const rgba = new Uint8Array(width * height * 4);
  for (let j = 0; j < height; j++) {
    const v = chart.v0 + ((j + 0.5) * (chart.v1 - chart.v0)) / height;
    for (let i = 0; i < width; i++) {
      const u = chart.u0 + ((i + 0.5) * (chart.u1 - chart.u0)) / width;
      const { sx, sy, depth } = project(L, chart.at(u, v));
      const k = (j * width + i) * 4;
      rgba[k + 3] = 255;
      if (depth <= 200 || sx < 0 || sx >= VW || sy < 0 || sy >= VH) continue;
      const [r, g, b] = bilinear(L.rgba, sx, sy);
      rgba[k] = r; rgba[k + 1] = g; rgba[k + 2] = b;
    }
  }
  return { width, height, rgba };
}

// --- reading a dim plate ------------------------------------------------------
/** a box blur run three times, which is a gaussian near enough */
function blur(src: Float32Array, w: number, h: number, r: number): Float32Array {
  let a = src.slice(), b = new Float32Array(w * h);
  for (let pass = 0; pass < 3; pass++) {
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let s = 0;
      for (let d = -r; d <= r; d++) s += a[y * w + Math.min(w - 1, Math.max(0, x + d))];
      b[y * w + x] = s / (2 * r + 1);
    }
    [a, b] = [b, a];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let s = 0;
      for (let d = -r; d <= r; d++) s += a[Math.min(h - 1, Math.max(0, y + d)) * w + x];
      b[y * w + x] = s / (2 * r + 1);
    }
    [a, b] = [b, a];
  }
  return a;
}

/** the room's light taken off a picture: the plate's own low frequencies are
 *  the lamp's falloff across it, and dividing them out leaves what the picture
 *  would look like lit flat */
function flatten(p: Plate): void {
  const lum = new Float32Array(p.width * p.height);
  for (let i = 0; i < lum.length; i++) {
    lum[i] = Math.max(1, 0.299 * p.rgba[i * 4] + 0.587 * p.rgba[i * 4 + 1] + 0.114 * p.rgba[i * 4 + 2]);
  }
  const field = blur(lum, p.width, p.height, Math.max(3, Math.round(Math.max(p.width, p.height) / 5)));
  let mean = 0;
  for (const v of field) mean += v;
  mean /= field.length;
  for (let i = 0; i < lum.length; i++) {
    const k = mean / field[i];
    for (let c = 0; c < 3; c++) p.rgba[i * 4 + c] = Math.min(255, Math.round(p.rgba[i * 4 + c] * k));
  }
}

/** the half-percent points of a plate's channels, taken together */
function levels(p: Plate): [number, number] {
  const hist = new Uint32Array(256);
  for (let i = 0; i < p.rgba.length; i += 4) for (let c = 0; c < 3; c++) hist[p.rgba[i + c]]++;
  const n = p.width * p.height * 3;
  let lo = 0, hi = 255, acc = 0;
  for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= n * 0.005) { lo = v; break; } }
  acc = 0;
  for (let v = 255; v >= 0; v--) { acc += hist[v]; if (acc >= n * 0.005) { hi = v; break; } }
  return [lo, Math.max(lo + 1, hi)];
}

/** upright — row 0 of a chart is its BOTTOM — blown up, levels optional */
function upright(p: Plate, k: number, span: [number, number] | null): { w: number; h: number; px: Uint8Array } {
  const w = p.width * k, h = p.height * k, px = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const sx = (x / k) | 0, sy = p.height - 1 - ((y / k) | 0);
    const s = (sy * p.width + sx) * 4, d = (y * w + x) * 4;
    for (let c = 0; c < 3; c++) {
      const value = p.rgba[s + c];
      px[d + c] = span ? Math.max(0, Math.min(255, Math.round(((value - span[0]) * 255) / (span[1] - span[0])))) : value;
    }
    px[d + 3] = 255;
  }
  return { w, h, px };
}

// --- and the run --------------------------------------------------------------
const views = standpoints();
console.log(`${views.length} standpoints, viewport ${VW}×${VH}, ${TEXEL} units a texel\n`);

for (const corner of CORNER) {
  const chart = chartOf(corner);
  const normal = chart.normalAt(0, 0);
  const corners: V3[] = [
    chart.at(corner.u0, corner.v0), chart.at(corner.u1, corner.v0),
    chart.at(corner.u1, corner.v1), chart.at(corner.u0, corner.v1),
  ];
  /** how many pixels of this picture each standpoint holds, and how square-on */
  const ranked = views.map((L) => {
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, facing = 0, ok = true;
    for (const p of corners) {
      const { sx, sy, depth } = project(L, p);
      if (depth <= 200) { ok = false; break; }
      const r = Math.hypot(p[0] - L.ex, p[1] - L.ey, p[2] - L.ez);
      facing = -((p[0] - L.ex) * normal[0] + (p[1] - L.ey) * normal[1] + (p[2] - L.ez) * normal[2]) / r;
      x0 = Math.min(x0, sx); x1 = Math.max(x1, sx); y0 = Math.min(y0, sy); y1 = Math.max(y1, sy);
    }
    const clipped = x0 < 0 || x1 > VW || y0 < 0 || y1 > VH;
    return { L, w: x1 - x0, h: y1 - y0, facing, ok: ok && facing > 0.12 && !clipped };
  }).filter((r) => r.ok).sort((a, b) => b.w * b.h - a.w * a.h);

  console.log(`${corner.id}  ${corner.u1 - corner.u0}×${corner.v1 - corner.v0} units on ${corner.wall === "x0" ? "the window wall" : "the fireplace wall"}`);
  if (corner.note) console.log(`  NOTE: ${corner.note}`);
  if (!ranked.length) { console.log("  no standpoint holds it whole\n"); continue; }
  for (const r of ranked.slice(0, KEEP + 2)) {
    console.log(`  ${r.L.name.padEnd(14)} ${Math.round(r.w)}×${Math.round(r.h)} px  ${r.facing.toFixed(2)} square-on`);
  }

  for (const [n, r] of ranked.slice(0, KEEP).entries()) {
    const tag = r.L.name.replace("/", "-");
    // as it came off the frame, nothing done to it
    const raw = rectify(chart, r.L, TEXEL);
    const asIs = upright(raw, 1, null);
    writeFileSync(join(OUT, `${corner.id}-${tag}.png`), png(asIs.w, asIs.h, asIs.px));
    // and at the resolution this view actually held it, which is the ceiling:
    // one texel per frame pixel, so the plate has exactly as many pixels as the
    // disc has and no interpolation is hiding inside it
    const native = rectify(chart, r.L, (corner.u1 - corner.u0) / r.w);
    flatten(native);
    const shown = upright(native, 1, levels(native));
    writeFileSync(join(OUT, `${corner.id}-${tag}-native.png`), png(shown.w, shown.h, shown.px));
    // and the one to look at
    flatten(raw);
    const span = levels(raw);
    const read = upright(raw, 8, span);
    writeFileSync(join(OUT, `${corner.id}-${tag}-read.png`), png(read.w, read.h, read.px));
    // the wall around it, once, so the crop can be checked against the plaster
    if (n === 0) {
      const wide = rectify(chartOf(corner, MARGIN), r.L, TEXEL);
      flatten(wide);
      const w = upright(wide, 4, levels(wide));
      writeFileSync(join(OUT, `${corner.id}-wide-${tag}.png`), png(w.w, w.h, w.px));
    }
  }
  console.log(`  → ${corner.id}-*.png  ${Math.round((corner.u1 - corner.u0) / TEXEL)}×${Math.round((corner.v1 - corner.v0) / TEXEL)} texels\n`);
}
