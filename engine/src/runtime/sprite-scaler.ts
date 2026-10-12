/**
 * The world-sprite scaler DreamFactory 1 and 4 share: DF.EXE 0x415b30, TI.EXE
 * 0x412280 and Timelapse's tl.exe 0x43e9f0 are the same routine, constant for
 * constant (TI.EXE and tl.exe allow source rows up to 1024 wide, DF.EXE 512).
 *
 * It does not sample `floor(x / k)`. It draws a sprite at an integer destination
 * size, row by row, in three ways chosen by the ratio of the drawn height to the
 * source height (DF.EXE 0x415e17):
 *
 *  - more than twice as tall: source rows repeat, and every opaque run's two ends
 *    are carried as Bresenham EDGES toward the matching run up to 8 source rows
 *    further down (0x418d60; edges linked at 0x418f00, picked at 0x419190, made at
 *    0x4192e0, retired at 0x419380, stepped at 0x4193e0), so a magnified outline
 *    slopes instead of stepping;
 *  - taller, up to twice: source rows repeat (0x415f80);
 *  - otherwise: source rows are picked (0x419430).
 *
 * Across a row it works run by run: each opaque run of the source row maps to a
 * destination run through the integer column maps 0x415e90 builds, and its colours
 * are resampled into that destination run on their own (0x4165c0). Occlusion takes
 * part in the same walk: the drawable stretches of a destination row cut the runs,
 * and every piece is resampled separately. So the colours that land in a pixel
 * depend on where the silhouette and the scenery edges fall, which no per-pixel
 * sampler can reproduce.
 *
 * `flip` is the engines' mirror argument, and no DreamFactory 1 or 4 engine ever
 * passes one for a world sprite: every builder of a draw record writes 0 there
 * (DF.EXE 0x41ea5f actors, 0x4152cf props; TI.EXE 0x411493, 0x419013; tl.exe
 * 0x427e63, 0x42e013). It is kept because the point tests and fixtures use it.
 *
 * Verified against the executables themselves: engine/tests/sprite-scaler.ts
 * replays cases whose results were recorded by running each of the three routines
 * under an x86 emulator (tools/native-sprite/).
 *
 * The structure follows JamesK89's independent C port of DF.EXE
 * (github.com/JamesK89/dust, src/df_sprite.c).
 */

/** a decoded sprite frame: palette indexes, opacity, the stored hot spot */
export interface ScalerFrame {
  width: number;
  height: number;
  indexed: Uint8Array;
  opaque: Uint8Array;
  /** the stored hot spot, Y and X, in source pixels */
  posYraw: number;
  posXraw: number;
}

export interface ScalerTarget {
  /** the pixels the draw may touch: [top, left, bottom, right), bottom/right exclusive */
  clip: { top: number; left: number; bottom: number; right: number };
  /** may (x, y) be drawn? Absent = everything inside the clip. The engines' depth mask */
  drawable?: (x: number, y: number) => boolean;
  /** write palette index `c` at (x, y) */
  plot: (x: number, y: number, c: number) => void;
}

const EDGE_LOOKAHEAD = 8;
const EDGE_DISPLACEMENT = 7;
/**
 * The stride of the engines' row ring, which the inverse-coordinate bias below
 * is a multiple of: 512 in DF.EXE, 1024 in TI.EXE and tl.exe. A non-zero bias
 * pushes the source column past the end of any row narrower than the stride, so
 * that piece is not drawn either way: 1024 gives DF.EXE's results for every
 * sprite it can draw (none is wider than 512) and TI.EXE's for the rest.
 */
const ROW_STRIDE = 1024;

/** C's integer division: truncates toward zero, as `idiv` does */
const idiv = (a: number, b: number): number => Math.trunc(a / b);

/**
 * How big a world sprite is drawn: DF.EXE 0x41e864, TI.EXE 0x41129e. All integer,
 * truncating at each step, `ref` being the frame record's i16 @+42 and the size
 * the frame's own (the record's bounds at +18 equal it on every frame of the
 * three games). A size that comes to 0 is not drawn.
 */
export function worldSpriteSize(
  scale: number,
  ref: number,
  f: { width: number; height: number },
  depth: number,
): { dw: number; dh: number } {
  const s = idiv(Math.trunc(scale) * ref, 1000);
  return { dw: idiv(s * f.width, depth), dh: idiv(s * f.height, depth) };
}

/** where a frame drawn at (ax, ay) and dw x dh lands: the engines' 0x415bcf.. */
export function scaledOrigin(
  f: ScalerFrame,
  ax: number,
  ay: number,
  dw: number,
  dh: number,
  flip: boolean,
): { left: number; top: number } {
  const anchorX = flip ? f.width - f.posXraw : f.posXraw;
  return { left: ax - idiv(anchorX * dw, f.width), top: ay - idiv(f.posYraw * dh, f.height) };
}

/** the column maps (0x415e90): source column -> first destination column, and back */
function columnMaps(source: number, dest: number): { forward: Int32Array; reverse: Int32Array } {
  const forward = new Int32Array(source + 1);
  const reverse = new Int32Array(dest + 1);
  let s = 0;
  let d = 0;
  if (source <= dest) {
    let error = -dest;
    for (;;) {
      if (error > 0) {
        s++;
        error -= 2 * dest;
        forward[s] = d + 1;
      }
      reverse[++d] = s;
      if (d === dest) break;
      error += 2 * source;
    }
    forward[source] = dest;
  } else {
    let error = -source;
    for (;;) {
      if (error > 0) {
        d++;
        error -= 2 * source;
        reverse[d] = s + 1;
      }
      if (++s === source) break;
      error += 2 * dest;
      forward[s] = d;
    }
    reverse[dest] = source;
    // DF.EXE's shrinking branch (0x415f04) never writes forward[source], and its
    // map is a global buffer, so the slot holds whatever an earlier draw left.
    // Only a sprite shrunk across and stretched down reads it, which a world
    // sprite (one scale for both axes) never is. Give it the growing branch's value.
    forward[source] = dest;
  }
  return { forward, reverse };
}

/** resample `count` colours from `src[at..]` into `output` destination pixels (0x4165c0's inner step) */
function resample(src: Uint8Array, at: number, count: number, output: number, put: (i: number, c: number) => void): void {
  if (count === output) {
    for (let i = 0; i < count; i++) put(i, src[at + i]);
    return;
  }
  if (output < count) {
    const q = idiv(count, output);
    let pos = idiv(q, 2);
    let error = (q + 1) * output - count;
    for (let i = 0; i < output; i++) {
      if (error < 0) {
        put(i, src[at + pos + 1]);
        pos += q + 1;
        error += 2 * ((q + 1) * output - count);
      } else {
        put(i, src[at + pos]);
        pos += q;
        error += 2 * (q * output - count);
      }
    }
  } else {
    const q = idiv(output, count);
    let error = 2 * (q * count - output);
    let o = 0;
    for (let i = 0; i < count; i++) {
      let repeat = q;
      if (output % count && error < 0) {
        repeat++;
        error += 2 * ((q + 1) * count - output);
      } else error += 2 * (q * count - output);
      for (let j = 0; j < repeat; j++) put(o++, src[at + i]);
    }
  }
}

interface MappedSpan {
  first: number;
  last: number;
  /** destination column of the left end, or -(edge + 1) for an edge's current column */
  left: number;
  right: number;
}

interface Edge {
  current: number;
  start: number;
  end: number;
  error: number;
  twiceDelta: number;
  twiceDuration: number;
  lifetime: number;
}

const zeroEdge = (): Edge => ({ current: 0, start: 0, end: 0, error: 0, twiceDelta: 0, twiceDuration: 0, lifetime: 0 });

class Edges {
  /** zero-filled up front: a run end of -1 (a shrunk row's last column) reads edge 0 */
  items: Edge[];
  count = 0;

  constructor(capacity: number) {
    this.items = Array.from({ length: capacity }, zeroEdge);
  }

  value(v: number): number {
    return v >= 0 ? v : this.items[-v - 1].current;
  }

  /** 0x4192e0 */
  make(start: number, end: number, duration: number, lifetime: number): number {
    start = this.value(start);
    let index = 0;
    while (index < this.count && this.items[index].lifetime) index++;
    if (index === this.count) this.count++;
    const twiceDelta = 2 * Math.abs(end - start);
    this.items[index] = {
      current: start,
      start,
      end,
      error: twiceDelta - duration,
      twiceDelta,
      twiceDuration: 2 * duration,
      lifetime,
    };
    return -index - 1;
  }

  /** 0x419380 */
  expire(): void {
    for (let i = 0; i < this.count; i++) if (this.items[i].lifetime) this.items[i].lifetime--;
    while (this.count && !this.items[this.count - 1].lifetime) this.count--;
  }

  /** 0x4193e0 */
  advance(): void {
    for (let i = 0; i < this.count; i++) {
      const e = this.items[i];
      if (!e.lifetime) continue;
      while (e.error >= 0) {
        e.current += e.start < e.end ? 1 : -1;
        e.error -= e.twiceDuration;
      }
      e.error += e.twiceDelta;
    }
  }
}

interface SourceRow {
  spans: MappedSpan[];
  repeat: number;
}

/** 0x419190: -1 = an exact match, keep looking ahead; 1 = a candidate; 0 = none */
function edgeCandidate(
  row: SourceRow,
  span: MappedSpan,
  left: boolean,
  limit: number,
  forward: Int32Array,
  out: { index: number; endpoint: number },
): number {
  let best = EDGE_LOOKAHEAD;
  for (let i = 0; i < row.spans.length; i++) {
    const future = row.spans[i];
    if (future.first > span.last || span.first > future.last) continue;
    let difference = left ? span.first - future.first : span.last - future.last;
    difference = Math.max(-limit, Math.min(limit, difference));
    const source = (left ? span.first : span.last) - difference;
    if (Math.abs(difference) < best) {
      out.index = i;
      out.endpoint = left ? forward[source] : forward[source + 1] - 1;
      best = Math.abs(difference);
      if (!best) return -1;
    }
  }
  return best < EDGE_LOOKAHEAD ? 1 : 0;
}

/** 0x418f00: link the runs of source row `current` to the rows below it */
function connectEdges(rows: SourceRow[], current: number, sourceEnd: number, forward: Int32Array, edges: Edges): void {
  edges.expire();
  const row = rows[current];
  const out = { index: 0, endpoint: 0 };
  for (let i = 0; i < row.spans.length; i++) {
    const span = row.spans[i];
    // the run ends to repoint at the edge once it exists: this row's, then any
    // exact matches further down
    const leftRefs: [MappedSpan, "left"][] = [[span, "left"]];
    const rightRefs: [MappedSpan, "right"][] = [[span, "right"]];
    let leftDone = false;
    let rightDone = false;
    let duration = row.repeat;
    let lifetime = 1;
    for (let future = current + 1; future < Math.min(sourceEnd, current + EDGE_LOOKAHEAD); future++) {
      if (leftDone && rightDone) break;
      if (!leftDone) {
        const limit = i === 0 ? EDGE_DISPLACEMENT : span.first - row.spans[i - 1].last;
        const status = edgeCandidate(rows[future], span, true, limit, forward, out);
        if (status < 0) leftRefs.push([rows[future].spans[out.index], "left"]);
        else {
          if (status > 0) {
            const ref = edges.make(span.left, out.endpoint, duration, lifetime);
            for (const [s, k] of leftRefs) s[k] = ref;
          }
          leftDone = true;
        }
      }
      if (!rightDone) {
        const limit = i === row.spans.length - 1 ? EDGE_DISPLACEMENT : row.spans[i + 1].first - span.last;
        const status = edgeCandidate(rows[future], span, false, limit, forward, out);
        if (status < 0) rightRefs.push([rows[future].spans[out.index], "right"]);
        else {
          if (status > 0) {
            const ref = edges.make(span.right, out.endpoint, duration, lifetime);
            for (const [s, k] of rightRefs) s[k] = ref;
          }
          rightDone = true;
        }
      }
      duration += rows[future].repeat;
      lifetime++;
    }
  }
}

/**
 * Draw `f` with its hot spot at (ax, ay), `dw` x `dh` pixels, mirrored when
 * `flip`, the way the DF1/DF4 engines do (see the module doc).
 */
export function drawScaledSprite(
  f: ScalerFrame,
  ax: number,
  ay: number,
  dw: number,
  dh: number,
  flip: boolean,
  target: ScalerTarget,
): void {
  const w = f.width;
  const h = f.height;
  if (dw <= 0 || dh <= 0 || w < 1 || h < 1) return;
  const { top: ct, left: cl, bottom: cb, right: cr } = target.clip;
  const { left, top } = scaledOrigin(f, ax, ay, dw, dh, flip);
  if (top >= cb || left >= cr || top + dh <= ct || left + dw <= cl) return;

  // clip rows: the engines skip source rows in proportion (0x415c8e..)
  let first = 0;
  let sourceHeight = h;
  let destHeight = dh;
  let screenY = top;
  if (top < ct) {
    first = idiv((ct - top) * h, dh);
    sourceHeight -= first;
    destHeight -= ct - top;
    screenY = ct;
  }
  if (top + dh > cb) {
    const excess = top + dh - cb;
    destHeight -= excess;
    sourceHeight -= idiv(excess * h, dh);
  }
  if (sourceHeight <= 0 || destHeight <= 0) return;
  const clipLeft = Math.max(0, cl - left);
  const clipRight = Math.min(dw, cr - left);

  const { forward, reverse } = columnMaps(w, dw);
  const large = sourceHeight < idiv(destHeight, 2);
  const rows: SourceRow[] = new Array(h);
  const selected = new Int32Array(destHeight);
  let used = 0;
  if (large) {
    let err = -destHeight;
    for (let sy = first; sy < first + sourceHeight; sy++) {
      let repeat = 0;
      do {
        repeat++;
        err += sourceHeight;
      } while (err < 0);
      rows[sy] = { spans: [], repeat };
      err -= destHeight;
      for (let j = 0; j < repeat && used < destHeight; j++) selected[used++] = sy;
    }
  } else if (sourceHeight >= destHeight) {
    let err = 2 * destHeight - sourceHeight;
    let sy = first;
    while (used < destHeight) {
      while (err < 0) {
        sy++;
        err += 2 * destHeight;
      }
      selected[used++] = sy++;
      err -= 2 * (sourceHeight - destHeight);
    }
  } else {
    let err = 3 * sourceHeight - 2 * destHeight;
    let sy = first;
    while (used < destHeight) {
      let repeat = 1;
      while (err < 0) {
        repeat++;
        err += 2 * sourceHeight;
      }
      for (let j = 0; j < repeat && used < destHeight; j++) selected[used++] = sy;
      sy++;
      err -= 2 * (destHeight - sourceHeight);
    }
  }

  // each source row's opaque runs, mapped to destination columns
  const enlarged = large || sourceHeight < destHeight;
  for (let sy = first; sy < first + sourceHeight; sy++) {
    const spans: MappedSpan[] = [];
    const base = sy * w;
    for (let x = 0; x < w; ) {
      if (!f.opaque[base + (flip ? w - 1 - x : x)]) {
        x++;
        continue;
      }
      const a = x++;
      while (x < w && f.opaque[base + (flip ? w - 1 - x : x)]) x++;
      const b = x - 1;
      spans.push({ first: a, last: b, left: forward[a], right: enlarged ? forward[b + 1] - 1 : forward[b] });
    }
    rows[sy] = { spans, repeat: rows[sy]?.repeat ?? 0 };
  }

  const edges = new Edges(w * EDGE_LOOKAHEAD * 2);
  const colors = new Uint8Array(w);
  const allowed: number[] = [];
  let lastSource = -1;
  for (let row = 0; row < destHeight; row++) {
    const sy = selected[row];
    const y = screenY + row;
    if (large && sy !== lastSource) {
      connectEdges(rows, sy, first + sourceHeight, forward, edges);
      lastSource = sy;
    }
    const base = sy * w;
    for (let x = 0; x < w; x++) colors[x] = f.indexed[base + (flip ? w - 1 - x : x)];
    // the drawable stretches of this destination row, sprite-relative
    allowed.length = 0;
    for (let x = clipLeft; x < clipRight; ) {
      if (target.drawable && !target.drawable(left + x, y)) {
        x++;
        continue;
      }
      const a = x++;
      while (x < clipRight && (!target.drawable || target.drawable(left + x, y))) x++;
      allowed.push(a, x - 1);
    }
    const spans = rows[sy].spans;
    let si = 0;
    let mi = 0;
    let bias = 0;
    while (si < spans.length && mi < allowed.length) {
      const span = spans[si];
      const d0 = edges.value(span.left);
      const d1 = edges.value(span.right);
      const a0 = allowed[mi];
      const a1 = allowed[mi + 1];
      const lo = Math.max(span.first, reverse[a0] + bias);
      const hi = Math.min(span.last, (dw < w ? reverse[a1 + 1] - 1 : reverse[a1]) + bias);
      const dlo = Math.max(d0, a0);
      const dhi = Math.min(d1, a1);
      if (lo <= hi && dlo <= dhi) {
        resample(colors, lo, hi - lo + 1, dhi - dlo + 1, (i, c) => target.plot(left + dlo + i, y, c));
      }
      if (a1 <= d1) {
        mi += 2;
        // the engines' inverse-coordinate bias when both lists advance together
        bias = large && a1 === d1 ? ((sy - first) % EDGE_LOOKAHEAD) * ROW_STRIDE : 0;
      }
      if (d1 <= a1) si++;
    }
    if (large) edges.advance();
  }
}

/**
 * Is (x, y) a point of the sprite, as the engines' point tests answer it?
 *
 * They do not ask the drawn pixels. They map the point back to a source pixel and
 * walk that row's runs, subtracting each run's length until what is left is
 * `<= 0` (DF.EXE 0x415a80, TI.EXE 0x4121d0, tl.exe 0x43e940). The `<=` makes a
 * run's end inclusive, so a column past 0 answers for the column before it.
 */
function sourcePoint(f: ScalerFrame, sx: number, sy: number): boolean {
  return !!f.opaque[sy * f.width + (sx > 0 ? sx - 1 : 0)];
}

/**
 * The unscaled point test (DF.EXE 0x415960, TI.EXE 0x4120b0, tl.exe 0x43e820): the
 * sprite's box at `left, top`, the frame's own size. Mirroring moves the box (the
 * caller's anchor) and never the sample.
 */
export function spriteCovers(f: ScalerFrame, left: number, top: number, x: number, y: number): boolean {
  if (x < left || y < top || x >= left + f.width || y >= top + f.height) return false;
  return sourcePoint(f, x - left, y - top);
}

/**
 * The scaled point test (DF.EXE 0x419500, TI.EXE 0x413540, tl.exe 0x43fc90), for
 * the box {@link drawScaledSprite} draws into ({@link scaledOrigin}: `left, top`,
 * `dw x dh`): the point mapped back by `w / dw` and `h / dh` truncated. A mirror
 * moves only the box, never the sample.
 */
export function scaledBoxCovers(
  f: ScalerFrame,
  left: number,
  top: number,
  dw: number,
  dh: number,
  x: number,
  y: number,
): boolean {
  if (dw <= 0 || dh <= 0 || x < left || y < top || x >= left + dw || y >= top + dh) return false;
  return sourcePoint(f, idiv((x - left) * f.width, dw), idiv((y - top) * f.height, dh));
}
