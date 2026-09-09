/**
 * Two things `bedobit.mov` holds that the room wants, cut out of it.
 *
 *   npx tsx taoot/tools/bedsitobit.ts [frame]
 *
 * `bedobit.mov` is the close-up the game plays when Frank picks the book off the
 * armchair, and at 512×384 it is six times the resolution any SET frame gives
 * either subject. Two of its nine frames hold the book square to the camera.
 *
 * **The cover.** "The Wreck Of The Titan Or / Futility / Morgan Robertson" —
 * Morgan Robertson's 1898 novella about an unsinkable liner meeting an iceberg,
 * fourteen years early, which is why it is in this room at all. It lies at an
 * angle, so it is rectified through the homography that takes its four corners
 * to a rectangle.
 *
 * **The moquette.** The chair's own cloth fills the left of the same frame, lit
 * and in focus. The room's tile for it came from an 80×40 patch of
 * `Scene2/View12`; this is a patch several times that off the same cloth. It is
 * de-lit the way `frameSwatch` de-lits a swatch — the low frequencies are the
 * lamp, the high ones are the weave, and only the weave is kept, laid on the
 * measured tone — so it drops into the material pipeline as an albedo like the
 * others.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readMovFile } from "@dreamfactory/engine/df/mov";
import { decodeFrame, FrameBuffer, indexedToRGBA, paletteToRGBA } from "@dreamfactory/engine/df/image";
import { encodePNG } from "../../../tools/png";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "../../public/bedsit");
const FRAME = +(process.argv[2] ?? 4);

/** the cover's four corners in the frame, read off it by eye, clockwise from
 *  the top left. The top edge runs behind the cutting tucked into the book. */
const CORNERS = [[180, 68], [334, 106], [352, 352], [107, 363]] as const;

/**
 * The residual tilt, in degrees, and why it is not zero.
 *
 * The corners above are the cover's four corners as far as the eye can read
 * them, and they rectify the cover — but not its PRINTING. Measured off the
 * result by principal axis, the title line came out at +1.21 degrees and the
 * author's line at +2.38, and two lines that disagree are not a rotation, they
 * are a skew: the quad is a little out of true, and by different amounts top and
 * bottom. So each edge is turned about its own middle by the tilt measured
 * nearest it, which brings the title from +1.21 to -0.28.
 *
 * The author's line does not go all the way to zero, and no corner can take it
 * there: it sits at the very bottom of the cover, where a leather board bends
 * away from the camera, and a homography rectifies a PLANE. Pushed hard enough
 * to level it, the quad reaches past the cover's own edge and starts rectifying
 * the chair. So it is halved, from +2.38 to +0.79, and the rest is curvature.
 *
 * Re-measure after changing anything here — these are the OUTPUT's angles, not
 * the input's.
 */
const TILT = { top: -1.10, bottom: -3.00 };

/** the corners with that turn applied, clockwise from the top left */
const COVER = (() => {
  const c = CORNERS.map((p) => [p[0], p[1]] as [number, number]);
  const turn = (a: number, b: number, deg: number): void => {
    const dx = c[b][0] - c[a][0], dy = c[b][1] - c[a][1], len = Math.hypot(dx, dy);
    const px = -dy / len, py = dx / len, k = (len / 2) * (deg * Math.PI) / 180;
    c[a][0] += k * px; c[a][1] += k * py;
    c[b][0] -= k * px; c[b][1] -= k * py;
  };
  turn(0, 1, TILT.top);
  turn(3, 2, TILT.bottom);
  return c;
})();
/** how many pixels of cover the rectified image is, and its aspect */
const COVER_W = 320, COVER_H = 400;

/** a patch of the chair's cloth: left of the book, clear of the fold */
const CLOTH = { x0: 6, y0: 150, x1: 96, y1: 292 };
/** the tone and contrast `MATERIALS.moquette` is measured at, kept in step with it */
const TONE = [0.44, 0.40, 0.20] as const, KEEP = 1.4, TILE = 128;

const mov = readMovFile(new Uint8Array(readFileSync(
  process.env.MOV_PATH ?? join(HERE, "../../gamefiles/en/titanic1/movies/bedobit.mov"),
)));
const pal = paletteToRGBA(mov.paletteRaw, 256);
const fb = new FrameBuffer();
let W = 0, H = 0, px: Uint8ClampedArray = new Uint8ClampedArray(0);
for (let i = 0; i <= FRAME; i++) {
  const d = decodeFrame(mov.file.containers[mov.frames[i].locationFrame].data, fb, mov.file.order);
  if (i === FRAME) { W = d.width; H = d.height; px = indexedToRGBA(fb.pixels.slice(0, W * H), W, H, pal); }
}
console.log(`bedobit frame ${FRAME}: ${W}x${H}`);
const at = (x: number, y: number, c: number): number => px[((y | 0) * W + (x | 0)) * 4 + c];

/** bilinear, so a rectified cover is not a staircase */
function sample(x: number, y: number, c: number): number {
  const x0 = Math.max(0, Math.min(W - 1, Math.floor(x))), y0 = Math.max(0, Math.min(H - 1, Math.floor(y)));
  const x1 = Math.min(W - 1, x0 + 1), y1 = Math.min(H - 1, y0 + 1), fx = x - x0, fy = y - y0;
  const a = at(x0, y0, c) * (1 - fx) + at(x1, y0, c) * fx;
  const b = at(x0, y1, c) * (1 - fx) + at(x1, y1, c) * fx;
  return a * (1 - fy) + b * fy;
}

/**
 * The homography taking the unit square's corners to four image points, solved
 * as the eight-unknown system it is. A bilinear blend of the corners would do
 * for a flat-on photograph; this book is close to the lens and leans away from
 * it, and only a projective map gets its lettering straight.
 */
function homography(p: readonly (readonly [number, number] | readonly number[])[]): number[] {
  const sq = [[0, 0], [1, 0], [1, 1], [0, 1]];
  const A: number[][] = [], b: number[] = [];
  for (let i = 0; i < 4; i++) {
    const [u, v] = sq[i], [x, y] = p[i];
    A.push([u, v, 1, 0, 0, 0, -u * x, -v * x]); b.push(x);
    A.push([0, 0, 0, u, v, 1, -u * y, -v * y]); b.push(y);
  }
  for (let col = 0; col < 8; col++) {
    let piv = col;
    for (let r = col + 1; r < 8; r++) if (Math.abs(A[r][col]) > Math.abs(A[piv][col])) piv = r;
    [A[col], A[piv]] = [A[piv], A[col]]; [b[col], b[piv]] = [b[piv], b[col]];
    for (let r = 0; r < 8; r++) {
      if (r === col || !A[r][col]) continue;
      const f = A[r][col] / A[col][col];
      for (let k = col; k < 8; k++) A[r][k] -= f * A[col][k];
      b[r] -= f * b[col];
    }
  }
  const h = b.map((v, i) => v / A[i][i]);
  return [...h, 1];
}

const h = homography(COVER);
const cover = new Uint8Array(COVER_W * COVER_H * 4);
for (let j = 0; j < COVER_H; j++) for (let i = 0; i < COVER_W; i++) {
  const u = (i + 0.5) / COVER_W, v = (j + 0.5) / COVER_H;
  const w = h[6] * u + h[7] * v + h[8];
  const x = (h[0] * u + h[1] * v + h[2]) / w, y = (h[3] * u + h[4] * v + h[5]) / w;
  const d = (j * COVER_W + i) * 4;
  for (let c = 0; c < 3; c++) cover[d + c] = Math.round(sample(x, y, c));
  cover[d + 3] = 255;
}
/**
 * Levelling the printing, which the rectification cannot finish.
 *
 * A homography rectifies a PLANE, and this cover is a leather board that bends.
 * Turning the quad harder to level the author's line drags it off the cover's own
 * edge; leaving it alone leaves the line sloping. So the type is levelled
 * separately from the leather: each line is lifted off its background, the hole
 * it leaves is filled with the leather around it, and it is laid back down
 * turned by the angle it was measured at.
 *
 * The fill barely matters — a line 130 wide turned by a degree moves its ends by
 * a pixel — but it is what stops a crescent of old type showing at each end.
 */
const BLOCKS = [
  { name: "the title", y0: 60, y1: 108 },
  { name: "Futility", y0: 108, y1: 182 },
  { name: "the author", y0: 322, y1: 392 },
] as const;

const lumOf = (a: Uint8Array, i: number): number =>
  0.299 * a[i * 4] + 0.587 * a[i * 4 + 1] + 0.114 * a[i * 4 + 2];

/** the leather under the type: a low percentile of each block of the cover,
 *  smoothed between blocks, so gilt never counts towards it */
const GX = 16, GY = 20, CELL = 20;
const grid = new Float32Array(GX * GY * 3);
for (let gy = 0; gy < GY; gy++) for (let gx = 0; gx < GX; gx++) {
  for (let c = 0; c < 3; c++) {
    const vals: number[] = [];
    for (let j = 0; j < CELL; j++) for (let i = 0; i < CELL; i++) {
      const x = gx * CELL + i, y = gy * CELL + j;
      if (x < COVER_W && y < COVER_H) vals.push(cover[(y * COVER_W + x) * 4 + c]);
    }
    vals.sort((a, b) => a - b);
    grid[(gy * GX + gx) * 3 + c] = vals[Math.floor(vals.length * 0.3)];
  }
}
function leather(x: number, y: number, c: number): number {
  const fx = Math.min(GX - 1.001, Math.max(0, x / CELL - 0.5));
  const fy = Math.min(GY - 1.001, Math.max(0, y / CELL - 0.5));
  const gx = Math.floor(fx), gy = Math.floor(fy), tx = fx - gx, ty = fy - gy;
  const g = (i: number, j: number) => grid[(j * GX + i) * 3 + c];
  return (g(gx, gy) * (1 - tx) + g(gx + 1, gy) * tx) * (1 - ty)
       + (g(gx, gy + 1) * (1 - tx) + g(gx + 1, gy + 1) * tx) * ty;
}

/** how much of a pixel is gilt rather than leather */
const alpha = new Float32Array(COVER_W * COVER_H);
for (let y = 0; y < COVER_H; y++) for (let x = 0; x < COVER_W; x++) {
  const i = y * COVER_W + x;
  const base = 0.299 * leather(x, y, 0) + 0.587 * leather(x, y, 1) + 0.114 * leather(x, y, 2);
  // 14 over the leather, not 5: at 5 the leather's own grain counts as type,
  // and dividing by an alpha that small to unmix it turns every speck of grain
  // into a coloured star
  alpha[i] = Math.max(0, Math.min(1, (lumOf(cover, i) - base - 14) / 30));
}

/**
 * Each line's own slope, and which of them can be believed.
 *
 * A single line of small type is a very long thin thing, so its principal axis
 * IS its baseline — the title and the author's line come out elongated 400:1 and
 * 300:1, and their angles are solid. `Futility` is a big italic script, elongated
 * 7:1, and its axis is the shape of the word rather than the line it sits on. So
 * only the two thin lines are measured, and the residual between them is taken
 * as what it is — a skew, linear in height — which gives the script its angle
 * without asking it.
 */
function slopeOf(y0: number, y1: number): { th: number; y: number; x: number; long: number } {
  let w = 0, mx = 0, my = 0;
  for (let y = y0; y < y1; y++) for (let x = 0; x < COVER_W; x++) {
    const a = alpha[y * COVER_W + x];
    if (a > 0) { w += a; mx += x * a; my += y * a; }
  }
  mx /= w; my /= w;
  let sxx = 0, syy = 0, sxy = 0;
  for (let y = y0; y < y1; y++) for (let x = 0; x < COVER_W; x++) {
    const a = alpha[y * COVER_W + x];
    if (a <= 0) continue;
    sxx += (x - mx) ** 2 * a; syy += (y - my) ** 2 * a; sxy += (x - mx) * (y - my) * a;
  }
  sxx /= w; syy /= w; sxy /= w;
  const half = Math.hypot((sxx - syy) / 2, sxy), mid = (sxx + syy) / 2;
  return { th: 0.5 * Math.atan2(2 * sxy, sxx - syy), y: my, x: mx, long: (mid + half) / Math.max(1e-9, mid - half) };
}
const A = slopeOf(BLOCKS[0].y0, BLOCKS[0].y1), C = slopeOf(BLOCKS[2].y0, BLOCKS[2].y1);
console.log(`  ${BLOCKS[0].name}: ${(A.th * 180 / Math.PI).toFixed(2)}deg at y ${A.y.toFixed(0)} (${A.long.toFixed(0)}:1)`);
console.log(`  ${BLOCKS[2].name}: ${(C.th * 180 / Math.PI).toFixed(2)}deg at y ${C.y.toFixed(0)} (${C.long.toFixed(0)}:1)`);
const slopeAt = (y: number): number => A.th + ((y - A.y) / (C.y - A.y)) * (C.th - A.th);

/**
 * The type on its own, unmixed from the leather it sits on.
 *
 * A pixel of the cover is already `leather * (1 - a) + type * a`. Laying THAT
 * back down over leather with the same `a` composites it twice and halves the
 * gilt every time — the author's line came back rubbed out for exactly this
 * reason. So the type's own colour is recovered first, and it is the type that
 * moves.
 */
const typeRGB = new Float32Array(COVER_W * COVER_H * 3);
for (let y = 0; y < COVER_H; y++) for (let x = 0; x < COVER_W; x++) {
  const i = y * COVER_W + x, a = alpha[i];
  if (a <= 0.25) continue;                    // below this the unmix is dividing noise
  for (let c = 0; c < 3; c++) {
    typeRGB[i * 3 + c] = Math.max(0, Math.min(255, (cover[i * 4 + c] - leather(x, y, c) * (1 - a)) / a));
  }
}

const levelled = cover.slice();
// First the type comes off, and only the type: the leather beside it is the
// leather the frame recorded and there is no reason to touch it.
//
// It comes off HARDER than it goes back on, though. Erasing a stroke in
// proportion to its own alpha leaves every antialiased edge half there, and the
// copy laid back two pixels along then doubles it — the author's line came back
// with a ghost of itself. So the erase takes the strongest alpha in a one-pixel
// neighbourhood and doubles it, which clears the edges; the paste uses the true
// alpha, so the type itself is unchanged.
const typed = (y: number): boolean => BLOCKS.some((b) => y >= b.y0 && y < b.y1);
for (let y = 0; y < COVER_H; y++) for (let x = 0; x < COVER_W; x++) {
  if (!typed(y)) continue;                    // there is no type outside the three lines
  let a = 0;
  for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
    const px = x + i, py = y + j;
    if (px >= 0 && px < COVER_W && py >= 0 && py < COVER_H) a = Math.max(a, alpha[py * COVER_W + px]);
  }
  a = Math.min(1, a * 2);
  if (a <= 0) continue;
  const i = y * COVER_W + x;
  for (let c = 0; c < 3; c++) levelled[i * 4 + c] = Math.round(cover[i * 4 + c] * (1 - a) + leather(x, y, c) * a);
}
// and then it goes back down, turned flat
for (const blk of BLOCKS) {
  const m = slopeOf(blk.y0, blk.y1), th = slopeAt(m.y);
  const cs = Math.cos(th), sn = Math.sin(th);
  // Bilinear, not nearest. The author's line is two pixels of faint gilt, and
  // resampling it by nearest neighbour drops strokes outright — it came back
  // half there and looking rubbed out.
  for (let y = blk.y0; y < blk.y1; y++) for (let x = 0; x < COVER_W; x++) {
    const dx = x - m.x, dy = y - m.y;
    const sx = m.x + dx * cs - dy * sn, sy = m.y + dx * sn + dy * cs;
    if (sx < 0 || sx > COVER_W - 1.001 || sy < blk.y0 || sy > blk.y1 - 1.001) continue;
    const x0 = Math.floor(sx), y0 = Math.floor(sy), fx = sx - x0, fy = sy - y0;
    const wt = [(1 - fx) * (1 - fy), fx * (1 - fy), (1 - fx) * fy, fx * fy];
    const at = [y0 * COVER_W + x0, y0 * COVER_W + x0 + 1, (y0 + 1) * COVER_W + x0, (y0 + 1) * COVER_W + x0 + 1];
    let a = 0;
    for (let k = 0; k < 4; k++) a += alpha[at[k]] * wt[k];
    if (a <= 0.05) continue;
    const o = (y * COVER_W + x) * 4;
    for (let c = 0; c < 3; c++) {
      let v = 0;
      for (let k = 0; k < 4; k++) v += typeRGB[at[k] * 3 + c] * alpha[at[k]] * wt[k];
      levelled[o + c] = Math.round(levelled[o + c] * (1 - a) + (v / a));
    }
  }
  console.log(`  ${blk.name}: laid back ${(-th * 180 / Math.PI).toFixed(2)} degrees`);
}
cover.set(levelled);

writeFileSync(join(OUT, "futility.png"), encodePNG(cover, COVER_W, COVER_H, { compress: true }));
console.log(`  futility.png  ${COVER_W}x${COVER_H}`);

/** a box blur, the low frequencies that are the lamp and not the cloth */
function blurred(src: Float64Array, size: number, r: number): Float64Array {
  const out = new Float64Array(src.length);
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) for (let c = 0; c < 3; c++) {
    let sum = 0, n = 0;
    for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
      const y = Math.min(size - 1, Math.max(0, j + dj)), x = Math.min(size - 1, Math.max(0, i + di));
      sum += src[(y * size + x) * 3 + c]; n++;
    }
    out[(j * size + i) * 3 + c] = sum / n;
  }
  return out;
}

const lin = new Float64Array(TILE * TILE * 3);
for (let j = 0; j < TILE; j++) for (let i = 0; i < TILE; i++) {
  const x = CLOTH.x0 + ((CLOTH.x1 - CLOTH.x0) * (i + 0.5)) / TILE;
  const y = CLOTH.y0 + ((CLOTH.y1 - CLOTH.y0) * (j + 0.5)) / TILE;
  for (let c = 0; c < 3; c++) lin[(j * TILE + i) * 3 + c] = sample(x, y, c);
}
const low = blurred(lin, TILE, Math.max(2, TILE >> 4));
const mean = [0, 0, 0];
for (let i = 0; i < TILE * TILE; i++) for (let c = 0; c < 3; c++) mean[c] += lin[i * 3 + c];
const tile = new Uint8Array(TILE * TILE * 4);
for (let i = 0; i < TILE * TILE; i++) {
  for (let c = 0; c < 3; c++) {
    const detail = (lin[i * 3 + c] - low[i * 3 + c]) / Math.max(1, mean[c] / (TILE * TILE));
    const swing = Math.min(0.3, Math.max(-0.3, detail * KEEP));
    tile[i * 4 + c] = Math.min(255, (1 + swing) * TONE[c] * 255);
  }
  tile[i * 4 + 3] = 255;
}
writeFileSync(join(OUT, "moquette.png"), encodePNG(tile, TILE, TILE, { compress: true }));
console.log(`  moquette.png  ${TILE}x${TILE}  from ${CLOTH.x1 - CLOTH.x0}x${CLOTH.y1 - CLOTH.y0} of the frame`);
