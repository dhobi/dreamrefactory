/**
 * Painting the model in the game's own pixels.
 *
 * The shell in {@link file://./bedsit-room.ts} is in BEDSIT1's coordinates, and
 * every frame BEDSIT1 ships records the camera it was rendered from. So the
 * frames are not references to copy by hand — they are photographs of this exact
 * model, and the room can be textured by **projecting them back onto it**: for
 * each texel of each surface, find the views that can see that point, and take
 * their colour.
 *
 * ## The bit that makes it work
 *
 * The room is full of furniture and the model is empty, so a naive projection
 * paints the bed onto the wall behind the bed. The Z image is the answer to
 * that, and it is why this is worth doing here rather than anywhere else: a view
 * may colour a texel **only if its own depth at that pixel agrees with the
 * distance to the texel**. Where the bed stands in front of the wall, the frame's
 * depth is the bed's and the wall's texel is refused; some other view, from an
 * angle that clears the bed, supplies it instead. The furniture does not so much
 * get removed as never get a vote.
 *
 * The tolerance is one depth level and a bit (±700 of 629 units to a level),
 * which is the resolution the Z image has and no better. Anything flat against a
 * wall inside that — a poster, the map over the mantel, the panelling of the
 * cupboard doors — is *inside* the tolerance and comes through as part of the
 * wall. That is a limitation stated as a feature, and it is the right way round:
 * a poster on a wall is a wall's texture, and a bed is not.
 *
 * ## What is left over
 *
 * Everything the twenty-four standpoints and the walks never see the wall at —
 * behind the wardrobe, the floor under the bed, the last foot of floor under
 * every camera, because a SET frame is 512×264 out of a 512×384 screen and the
 * bottom of the picture is the part that is missing — comes out as a hole, and
 * is filled by growing the neighbours into it. A smear is honest there in a way
 * an invented floorboard would not be, and {@link Baked.covered} says how much of
 * each surface is real.
 */
import { LEFTTURNS, RIGHTTURNS, SetFile } from "@dreamfactory/engine/df/set";
import { indexedToRGBA, paletteToRGBA } from "@dreamfactory/engine/df/image";
import { RingCache } from "@dreamfactory/engine/web/ring-cache";
import { CHARTS, Chart, SurfaceId } from "./bedsit-room";

/** one frame, ready to be asked what colour a world point is */
interface Look {
  ex: number; ey: number; ez: number;
  /** the bearing, as its cosine and sine */
  c: number; s: number;
  rgba: Uint8Array;
  z: Uint8Array;
}

export interface Baked {
  id: SurfaceId;
  width: number;
  height: number;
  /** row 0 is the chart's `v0` edge — no flip on upload */
  rgba: Uint8Array;
  /** the share of texels a view actually saw; the rest are grown from these */
  covered: number;
  /** 1 where a view supplied the colour, 0 where it was grown — a swatch must
   *  be cut from the first kind, and {@link cut} says so if it is not */
  seen: Uint8Array;
}

/** how far a frame's depth may differ from the distance to a texel and still be
 *  looking at it — one quantization level, plus the half-level of slop that
 *  reading a level as its own middle leaves behind */
const DEPTH_TOLERANCE = 700;

/**
 * Every frame worth projecting: the twenty-four sharp standpoint views, and the
 * walking frames of the three roads.
 *
 * The roads earn their place by being the only pictures taken from anywhere
 * other than the three standpoints — they are what puts colour on the middle of
 * the floor, which no standpoint can see the near end of. The mid-TURN frames
 * are left out: they are the same eye at a different bearing, so they cover
 * nothing new and only cost time.
 */
export function looks(set: SetFile): Look[] {
  const cache = new RingCache(set);
  const pal = paletteToRGBA(set.paletteRaw, set.colorCount);
  const out: Look[] = [];
  const take = (frames: import("@dreamfactory/engine/df/set").FrameInfo[], standOnly: boolean): void => {
    const decoded = cache.ensure(frames);
    const seen = new Set<number>();
    for (const fi of frames) {
      if (standOnly && fi.motionInfo !== 2) continue;
      const key = fi.frameContainerLoc;
      if (seen.has(key)) continue;
      const cf = decoded.get(key);
      if (!cf?.z) continue;
      seen.add(key);
      const th = (2 * Math.PI * (fi.axisX8 & 0xff)) / 256;
      out.push({
        ex: fi.posX16, ey: fi.posZ16, ez: fi.posY16,
        c: Math.cos(th), s: Math.sin(th),
        rgba: new Uint8Array(indexedToRGBA(cf.pixels, cf.width, cf.height, pal).buffer),
        z: cf.z,
      });
    }
  };
  for (const scene of set.scenes) for (const d of [RIGHTTURNS, LEFTTURNS] as const) take(scene.turns[d].frames, true);
  for (const road of set.transitions) for (const reg of road.frameRegisters) take(reg.frames, false);
  return out;
}

/** a frame read between its pixels: the four around `(sx, sy)`, weighted */
function bilinear(rgba: Uint8Array, w: number, h: number, sx: number, sy: number): [number, number, number] {
  const x = Math.min(w - 1.001, Math.max(0, sx - 0.5)), y = Math.min(h - 1.001, Math.max(0, sy - 0.5));
  const x0 = x | 0, y0 = y | 0, tx = x - x0, ty = y - y0;
  const out: [number, number, number] = [0, 0, 0];
  for (let c = 0; c < 3; c++) {
    const a = rgba[(y0 * w + x0) * 4 + c], b = rgba[(y0 * w + x0 + 1) * 4 + c];
    const d = rgba[((y0 + 1) * w + x0) * 4 + c], e = rgba[((y0 + 1) * w + x0 + 1) * 4 + c];
    out[c] = a + (b - a) * tx + (d - a) * ty + (a - b - d + e) * tx * ty;
  }
  return out;
}

/**
 * The street beyond what any window showed of it — invented, and said so.
 *
 * The frames see the houses opposite through two openings, so the backdrop has
 * one patch of real street — two lobes and a gap between — and nothing else;
 * growing the neighbours into the rest, as a wall gets, makes a smear that an
 * oblique look through a window lands on. A street does not smear, it goes on:
 * so outside the patch's bounding box the chart is the patch **mirrored**, in
 * both directions, as many times as it takes — a facade reflected is still a
 * facade, and the sky above one is sky. Inside the box, the gap and the ragged
 * edges are grown from their neighbours as usual, since there is a real texel
 * near enough to grow from. Then everything invented is put a little out of
 * focus, so where two copies meet they blend rather than cut — which is what a
 * window a few metres off shows of a street anyway. Real texels are left alone.
 */
function continueStreet(rgba: Uint8Array, seen: Uint8Array, w: number, h: number): void {
  let c0 = w, c1 = -1, r0 = h, r1 = -1;
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    if (!seen[j * w + i]) continue;
    if (i < c0) c0 = i; if (i > c1) c1 = i; if (j < r0) r0 = j; if (j > r1) r1 = j;
  }
  if (c1 < 0) return;
  // the box: grown on its own, so nothing outside it takes part
  const bw = c1 - c0 + 1, bh = r1 - r0 + 1;
  const box = new Uint8Array(bw * bh * 4), boxSeen = new Uint8Array(bw * bh);
  for (let j = 0; j < bh; j++) {
    box.set(rgba.subarray(((r0 + j) * w + c0) * 4, ((r0 + j) * w + c1 + 1) * 4), j * bw * 4);
    boxSeen.set(seen.subarray((r0 + j) * w + c0, (r0 + j) * w + c1 + 1), j * bw);
  }
  grow(box, boxSeen, bw, bh);
  // the rest: the box, reflected about its own edges
  const fold = (n: number, len: number): number => {
    const k = ((n % (2 * len)) + 2 * len) % (2 * len);
    return k < len ? k : 2 * len - 1 - k;
  };
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    if (seen[j * w + i]) continue;
    const src = (fold(j - r0, bh) * bw + fold(i - c0, bw)) * 4, k = (j * w + i) * 4;
    rgba[k] = box[src]; rgba[k + 1] = box[src + 1]; rgba[k + 2] = box[src + 2]; rgba[k + 3] = 255;
  }
  // and out of focus, where it is invented
  const soft = rgba.slice();
  const RX = 3, RY = 3;
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      if (seen[j * w + i]) continue;
      let r = 0, g = 0, b = 0, n = 0;
      for (let dy = -RY; dy <= RY; dy++) {
        const y = j + dy;
        if (y < 0 || y >= h) continue;
        for (let dx = -RX; dx <= RX; dx++) {
          const x = i + dx;
          if (x < 0 || x >= w) continue;
          const k = (y * w + x) * 4;
          r += soft[k]; g += soft[k + 1]; b += soft[k + 2]; n++;
        }
      }
      const k = (j * w + i) * 4;
      rgba[k] = r / n; rgba[k + 1] = g / n; rgba[k + 2] = b / n;
    }
  }
}

/** the texels a view could not supply, grown out of the ones it could */
function grow(rgba: Uint8Array, seen: Uint8Array, w: number, h: number): void {
  const NEIGHBOURS = [-1, 1, -w, w, -w - 1, -w + 1, w - 1, w + 1];
  let front = seen.slice();
  for (let pass = 0; pass < 400; pass++) {
    let filled = 0;
    const next = front.slice();
    for (let i = 0; i < w * h; i++) {
      if (front[i]) continue;
      let r = 0, g = 0, b = 0, n = 0;
      const x = i % w;
      for (const d of NEIGHBOURS) {
        const j = i + d;
        if (j < 0 || j >= w * h || !front[j]) continue;
        // do not wrap round the edge of the chart
        if (Math.abs((j % w) - x) > 1) continue;
        r += rgba[j * 4]; g += rgba[j * 4 + 1]; b += rgba[j * 4 + 2]; n++;
      }
      if (!n) continue;
      rgba[i * 4] = r / n; rgba[i * 4 + 1] = g / n; rgba[i * 4 + 2] = b / n; rgba[i * 4 + 3] = 255;
      next[i] = 1;
      filled++;
    }
    front = next;
    if (!filled) break;
  }
}

/**
 * One surface's texture.
 *
 * A texel's colour is the weighted mean of every view that can see it, weighted
 * by how square-on the view is (cubed — a wall photographed at 10° carries almost
 * no information about it) and by how near, so a wall is painted mostly by
 * whoever stood in front of it.
 */
export function bakeChart(chart: Chart, looksIn: readonly Look[], texel: number, viewW: number, viewH: number, unitsPerLevel: number): Baked {
  const f = Math.max(viewW, viewH) / 2, cx = viewW / 2, cy = viewH / 2;
  const w = Math.max(1, Math.round((chart.u1 - chart.u0) / texel));
  const h = Math.max(1, Math.round((chart.v1 - chart.v0) / texel));
  const rgba = new Uint8Array(w * h * 4);
  const seen = new Uint8Array(w * h);
  let covered = 0;

  for (let j = 0; j < h; j++) {
    const v = chart.v0 + ((j + 0.5) * (chart.v1 - chart.v0)) / h;
    for (let i = 0; i < w; i++) {
      const u = chart.u0 + ((i + 0.5) * (chart.u1 - chart.u0)) / w;
      const [px, py, pz] = chart.at(u, v);
      const [nx, ny, nz] = chart.normalAt(u, v);
      let ar = 0, ag = 0, ab = 0, aw = 0, best = 0;
      for (const L of looksIn) {
        const dx = px - L.ex, dy = py - L.ey, dz = pz - L.ez;
        const depth = dx * L.c + dy * L.s;
        if (depth <= 200) continue;
        const sx = cx + ((dy * L.c - dx * L.s) * f) / depth;
        if (sx < 0 || sx >= viewW) continue;
        const sy = cy - (dz * f) / depth;
        if (sy < 0 || sy >= viewH) continue;
        const r = Math.hypot(dx, dy, dz);
        // face-on-ness: the surface's normal points into the room, the ray away
        // from the eye, so a view looking straight at it scores 1
        const facing = -(dx * nx + dy * ny + dz * nz) / r;
        if (facing <= 0.12) continue;
        const k = (sy | 0) * viewW + (sx | 0);
        const lv = L.z[k];
        if (lv <= 0) continue;                       // no depth recorded here
        const measured = (lv + 0.5) * unitsPerLevel;
        if (chart.through !== undefined) {
          // what is seen through a hole: the ray must have crossed the glass
          // plane between the eye and the texel, and the view's depth must be
          // well beyond that crossing — it was looking at the street, not at the
          // wall or the reveal either side of the pane
          const f = (chart.through - L.ex) / (px - L.ex);
          if (f <= 0 || f >= 1 || measured < r * f + DEPTH_TOLERANCE) continue;
          // The glazing bars are at the glass, and a bar thinner than a pixel
          // takes the depth of the street behind it, so the depth test lets them
          // through and they would be cast onto the houses opposite as a grid.
          // They are also the only dark thing in a daylit window; refuse those.
          if (L.rgba[k * 4] + L.rgba[k * 4 + 1] + L.rgba[k * 4 + 2] < 90) continue;
        } else if (Math.abs(measured - r) > DEPTH_TOLERANCE) continue; // a surface must be what this view was looking at
        const weight = (facing * facing * facing) / (1 + (r / 5000) ** 2);
        if (chart.sharp) {
          if (weight <= best) continue;
          best = weight;
          if (chart.smooth) {
            const [sr, sg, sb] = bilinear(L.rgba, viewW, viewH, sx, sy);
            ar = sr; ag = sg; ab = sb;
          } else {
            ar = L.rgba[k * 4]; ag = L.rgba[k * 4 + 1]; ab = L.rgba[k * 4 + 2];
          }
          aw = 1;
          continue;
        }
        ar += L.rgba[k * 4] * weight; ag += L.rgba[k * 4 + 1] * weight; ab += L.rgba[k * 4 + 2] * weight;
        aw += weight;
      }
      const t = j * w + i;
      if (aw > 0) {
        rgba[t * 4] = ar / aw; rgba[t * 4 + 1] = ag / aw; rgba[t * 4 + 2] = ab / aw; rgba[t * 4 + 3] = 255;
        seen[t] = 1;
        covered++;
      }
    }
  }
  if (chart.through !== undefined) continueStreet(rgba, seen, w, h);
  else grow(rgba, seen, w, h);
  return { id: chart.id, width: w, height: h, rgba, seen, covered: covered / (w * h) };
}

/** every chart, one at a time, yielding to the page between them so a splash can
 *  say what it is doing — the whole bake is a few seconds of arithmetic */
export async function bake(
  set: SetFile,
  texel = 18,
  onProgress?: (id: SurfaceId, done: number, of: number) => void,
  only?: (id: SurfaceId) => boolean,
): Promise<Baked[]> {
  const seenBy = looks(set);
  const upl = set.zFarMax / set.zLevelCount;
  const out: Baked[] = [];
  const charts = only ? CHARTS.filter((c) => only(c.id)) : CHARTS;
  for (const [i, chart] of charts.entries()) {
    onProgress?.(chart.id, i, charts.length);
    await new Promise((r) => setTimeout(r, 0));
    out.push(bakeChart(chart, seenBy, texel, set.viewPortWidth, set.viewPortHeight, upl));
  }
  return out;
}

/** a square, power-of-two tile of one material, cut out of a baked chart */
export interface Swatch {
  size: number;
  rgba: Uint8Array;
  /** the share of the patch a view actually supplied — a swatch cut out of grown
   *  texels is a smear tiled over a room, so this wants to be near 1 */
  seen: number;
  /** the world rectangle it was cut from, so a surface can tile it to scale */
  world: { w: number; h: number };
}

/**
 * A tile of a material cut straight out of one frame — the sofa's moquette,
 * the blanket, a door's stain — where the frame shows a clean patch of it.
 *
 * The furniture has no charts and gets none: its textures are tiles box-mapped
 * over it (see Builder.material), so a swatch is all a material needs. The
 * patch is box-averaged square, de-lit like the wall swatches so it repeats
 * without a lattice of lamp-shine, and mirrored on upload so it has no seam.
 */
export function frameSwatch(set: SetFile, spec: { scene: string; deg: number; x0: number; y0: number; x1: number; y1: number; keep: number; tone?: readonly number[] }, size = 64): Swatch {
  const cache = new RingCache(set);
  const pal = paletteToRGBA(set.paletteRaw, set.colorCount);
  let rgba: Uint8Array | null = null, w = 0;
  for (const scene of set.scenes) {
    if (scene.sceneName !== spec.scene) continue;
    for (const d of [RIGHTTURNS, LEFTTURNS] as const) {
      const frames = scene.turns[d].frames;
      const fi = frames.find((f) => f.motionInfo === 2 && (f.axisX8 & 0xff) === spec.deg);
      if (!fi) continue;
      const cf = cache.ensure(frames).get(fi.frameContainerLoc);
      if (!cf) continue;
      rgba = new Uint8Array(indexedToRGBA(cf.pixels, cf.width, cf.height, pal).buffer);
      w = cf.width;
      break;
    }
    if (rgba) break;
  }
  const out = new Uint8Array(size * size * 4);
  if (!rgba) { out.fill(128); return { size, rgba: out, seen: 0, world: { w: 1, h: 1 } }; }
  for (let j = 0; j < size; j++) {
    const ya = spec.y0 + ((spec.y1 - spec.y0) * j) / size, yb = spec.y0 + ((spec.y1 - spec.y0) * (j + 1)) / size;
    for (let i = 0; i < size; i++) {
      const xa = spec.x0 + ((spec.x1 - spec.x0) * i) / size, xb = spec.x0 + ((spec.x1 - spec.x0) * (i + 1)) / size;
      let r = 0, g = 0, b = 0, n = 0;
      for (let y = Math.floor(ya); y < Math.max(Math.floor(ya) + 1, yb); y++) {
        for (let x = Math.floor(xa); x < Math.max(Math.floor(xa) + 1, xb); x++) {
          const k = (y * w + x) * 4;
          r += rgba[k]; g += rgba[k + 1]; b += rgba[k + 2]; n++;
        }
      }
      const t = (j * size + i) * 4;
      out[t] = r / n; out[t + 1] = g / n; out[t + 2] = b / n; out[t + 3] = 255;
    }
  }
  // a patch smaller than the tile has been blown up pixel by pixel, and the
  // game's palette dither with it; one pass of a 3×3 mean takes the blocks off
  if (spec.x1 - spec.x0 < size || spec.y1 - spec.y0 < size) {
    const src = out.slice();
    for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
      for (let c = 0; c < 3; c++) {
        let sum = 0;
        for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
          const y = Math.min(size - 1, Math.max(0, j + dj)), x = Math.min(size - 1, Math.max(0, i + di));
          sum += src[(y * size + x) * 4 + c];
        }
        out[(j * size + i) * 4 + c] = sum / 9;
      }
    }
  }
  if (spec.tone) {
    // A toned tile keeps only the WEAVE of the patch: what is left after a blur
    // a few texels wide is taken away. A cushion is lit in a dome the size of
    // the patch, and no wider blur can tell that dome from the cloth; the weave
    // is the one thing at a scale the dome is not. It goes on the tone at the
    // patch's own contrast, held to a band a real cloth stays inside. The frames
    // are a night interior: their pixels carry the weave, not the daylight colour.
    const n = size * size, low = blurred(out, size, Math.max(2, size >> 4));
    const mean = [0, 0, 0];
    for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) mean[c] += out[i * 4 + c];
    for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) {
      const detail = (out[i * 4 + c] - low[i * 3 + c]) / Math.max(1, mean[c] / n);
      const swing = Math.min(0.3, Math.max(-0.3, detail * spec.keep));
      out[i * 4 + c] = Math.min(255, (1 + swing) * spec.tone[c] * 255);
    }
  } else {
    // An untoned tile is the frames' own pixels: a plane fitted and divided out
    // (a blur cannot see a slope that runs off the tile), then de-lit as the
    // wall swatches are.
    unslope(out, size);
    delight(out, size, spec.keep);
  }
  return { size, rgba: out, seen: 1, world: { w: 1, h: 1 } };
}

/** three reflecting box passes over a tile: the low frequencies, per channel */
function blurred(rgba: Uint8Array, size: number, radius: number): Float32Array {
  const n = size * size, blur = new Float32Array(n * 3);
  for (let c = 0; c < 3; c++) for (let i = 0; i < n; i++) blur[i * 3 + c] = rgba[i * 4 + c];
  const reflect = (q: number): number => { const p = 2 * size; q = ((q % p) + p) % p; return q < size ? q : p - 1 - q; };
  for (let pass = 0; pass < 3; pass++) {
    for (const horizontal of [true, false]) {
      const out = new Float32Array(n * 3);
      for (let a = 0; a < size; a++) for (let b = 0; b < size; b++) {
        let r = 0, g = 0, bl = 0, k = 0;
        for (let d = -radius; d <= radius; d++) {
          const q = reflect(b + d), i = horizontal ? a * size + q : q * size + a;
          r += blur[i * 3]; g += blur[i * 3 + 1]; bl += blur[i * 3 + 2]; k++;
        }
        const i = horizontal ? a * size + b : b * size + a;
        out[i * 3] = r / k; out[i * 3 + 1] = g / k; out[i * 3 + 2] = bl / k;
      }
      blur.set(out);
    }
  }
  return blur;
}

/** divide each channel of a tile by the best-fit plane through it, so a light
 *  that fell across the patch from one side is gone before anything else */
function unslope(rgba: Uint8Array, size: number): void {
  const n = size * size, cx = (size - 1) / 2;
  let sxx = 0;
  for (let i = 0; i < size; i++) sxx += (i - cx) * (i - cx);
  sxx *= size; // Σ over the whole tile of (x - cx)²; the same for y
  for (let c = 0; c < 3; c++) {
    let sum = 0, sx = 0, sy = 0;
    for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
      const v = rgba[(j * size + i) * 4 + c];
      sum += v; sx += v * (i - cx); sy += v * (j - cx);
    }
    const mean = sum / n, a = sx / sxx, b = sy / sxx;
    for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
      const fit = Math.max(1, mean + a * (i - cx) + b * (j - cx));
      const k = (j * size + i) * 4 + c;
      rgba[k] = Math.min(255, (rgba[k] * mean) / fit);
    }
  }
}

/**
 * Take the lighting out of a swatch and leave the material.
 *
 * A patch of wall in a rendered frame is not a material sample: it is a material
 * under a lamp, and it is brighter at one end than the other. Tiled, that
 * gradient repeats, and mirrored it repeats as a lattice of light and dark
 * diamonds that reads as a pattern on the wall — which is exactly what the eye
 * picks out and exactly what is not there.
 *
 * So divide the patch by a heavily blurred copy of itself and multiply the mean
 * back in: everything that varies slowly across the swatch (the lamp) goes, and
 * everything that varies quickly (the plaster) stays. What is left tiles without
 * a seam and takes this model's own three lights instead of carrying somebody
 * else's.
 */
function delight(rgba: Uint8Array, size: number, keep: number, radius = Math.max(2, size >> 3)): void {
  const n = size * size;
  const blur = new Float32Array(n * 3);
  for (let c = 0; c < 3; c++) for (let i = 0; i < n; i++) blur[i * 3 + c] = rgba[i * 4 + c];
  // three box passes ≈ a Gaussian wide enough to hold only the lamp
  // The blur reads past the tile's edges by REFLECTING, because that is how the
  // tile is drawn: MIRRORED_REPEAT puts each edge texel's own reflection beside
  // it. A blur that clamped instead would see the edge as flat, leave the lamp
  // in there, and the lamp would meet itself across every seam as a dark
  // diamond or a bright cross.
  const reflect = (q: number): number => { const p = 2 * size; q = ((q % p) + p) % p; return q < size ? q : p - 1 - q; };
  const pass = (horizontal: boolean): void => {
    const out = new Float32Array(n * 3);
    for (let a = 0; a < size; a++) {
      for (let b = 0; b < size; b++) {
        let r = 0, g = 0, bl = 0, k = 0;
        for (let d = -radius; d <= radius; d++) {
          const q = reflect(b + d);
          const i = horizontal ? a * size + q : q * size + b;
          r += blur[i * 3]; g += blur[i * 3 + 1]; bl += blur[i * 3 + 2]; k++;
        }
        const i = horizontal ? a * size + b : b * size + a;
        out[i * 3] = r / k; out[i * 3 + 1] = g / k; out[i * 3 + 2] = bl / k;
      }
    }
    blur.set(out);
  };
  for (let i = 0; i < 3; i++) { pass(true); pass(false); }
  const mean = [0, 0, 0];
  for (let c = 0; c < 3; c++) {
    for (let i = 0; i < n; i++) mean[c] += blur[i * 3 + c];
    mean[c] /= n;
  }
  // What is left after the lamp goes is grain and blotch, and which is which
  // depends on the material — see SWATCHES.keep.
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < 3; c++) {
      const lamp = Math.max(1, blur[i * 3 + c]);
      const flat = (rgba[i * 4 + c] * mean[c]) / lamp;
      rgba[i * 4 + c] = Math.min(255, Math.round(mean[c] + (flat - mean[c]) * keep));
    }
  }
}
