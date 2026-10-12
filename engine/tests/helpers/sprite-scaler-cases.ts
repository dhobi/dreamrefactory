/**
 * The cases engine/tests/sprite-scaler.ts replays, made from a seed so the
 * fixture holds only the engines' answers: tools/native-sprite/ records those by
 * running DF.EXE's, TI.EXE's and tl.exe's own scaler under an emulator.
 *
 * Change nothing here without re-recording: the fixture's `sprites` digest
 * catches a generator that no longer makes the cases it was recorded against.
 */

/** xorshift32: small, and the same in any language */
function rng(seed: number): (n: number) => number {
  let s = seed >>> 0 || 1;
  return (n: number): number => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s % n;
  };
}

export interface ScalerCase {
  /** a sprite record as the engines read it: h, w, posY, posX, then the run rows */
  sprite: Uint8Array;
  ax: number;
  ay: number;
  dw: number;
  dh: number;
  flip: boolean;
  canvasW: number;
  canvasH: number;
  clip: { top: number; left: number; bottom: number; right: number };
  /** the depth mask (row offsets, then count and (length, value) pairs), or none */
  mask: Uint8Array | null;
  level: number;
}

/** a blob: per row up to three opaque runs whose ends drift, so edges have somewhere to go */
function makeSprite(r: (n: number) => number, w: number, h: number): Uint8Array {
  const out: number[] = [];
  const short = (v: number) => out.push(v & 0xff, (v >> 8) & 0xff);
  short(h);
  short(w);
  short(r(h + 1) - (r(4) === 0 ? r(h) : 0)); // posY, now and then above the top
  short(r(w + 1) - (r(4) === 0 ? r(w) : 0));
  const runs = 1 + r(3);
  const ends: [number, number][] = [];
  for (let i = 0; i < runs; i++) {
    const a = r(w);
    ends.push([a, Math.min(w - 1, a + r(Math.max(1, w >> 1)))]);
  }
  let above = new Uint8Array(w);
  for (let y = 0; y < h; y++) {
    // drift every run's ends by -2..2, and sometimes drop or restart one
    for (const e of ends) {
      e[0] = Math.max(0, Math.min(w - 1, e[0] + r(5) - 2));
      e[1] = Math.max(e[0], Math.min(w - 1, e[1] + r(5) - 2));
      if (r(16) === 0) e[0] = e[1] = r(w);
    }
    const opaque = new Uint8Array(w);
    for (const [a, b] of ends) if (r(12)) opaque.fill(1, a, b + 1);
    const body: number[] = [];
    for (let x = 0; x < w; ) {
      let n = 1;
      while (x + n < w && opaque[x + n] === opaque[x] && n < 63) n++;
      if (!opaque[x]) body.push((n << 2) | 1);
      else {
        // 0 = the row above's colours: only under an opaque row above, the one way
        // 21,938 sprites on the Dust, Titanic and Timelapse discs ever use it
        const under = above.subarray(x, x + n).every((v) => v === 1);
        const mode = under ? r(4) : 2 + r(2);
        if (mode === 1) body.push((n << 2) | 3, ...Array.from({ length: n }, () => 1 + r(250)));
        else if (mode === 0) body.push((n << 2) | 0);
        else if (mode === 2) body.push((n << 2) | 2, 1 + r(250));
        else body.push((n << 2) | 3, ...Array.from({ length: n }, () => 1 + r(250)));
      }
      x += n;
    }
    short(body.length);
    out.push(...body);
    above = opaque;
  }
  return Uint8Array.from(out);
}

function makeMask(r: (n: number) => number, cw: number, ch: number): Uint8Array {
  const rows: number[][] = [];
  for (let y = 0; y < ch; y++) {
    const pairs: number[] = [];
    for (let x = 0; x < cw; ) {
      const n = Math.min(cw - x, 1 + r(r(3) ? 40 : 200));
      pairs.push(n, r(256));
      x += n;
    }
    rows.push([pairs.length / 2, ...pairs]);
  }
  const out: number[] = [];
  let at = ch * 2;
  for (const row of rows) {
    out.push(at & 0xff, at >> 8);
    at += row.length;
  }
  for (const row of rows) out.push(...row);
  return Uint8Array.from(out);
}

const SCALES = [0.2, 0.33, 0.5, 0.75, 0.9, 1, 1.1, 1.5, 1.9, 2, 2.1, 2.5, 3, 4, 6];

export function scalerCases(seed: number, count: number): ScalerCase[] {
  const r = rng(seed);
  const cases: ScalerCase[] = [];
  for (let i = 0; i < count; i++) {
    const big = r(10) === 0;
    const w = 1 + r(big ? 160 : 40);
    const h = 1 + r(big ? 120 : 40);
    const sprite = makeSprite(r, w, h);
    const sx = SCALES[r(SCALES.length)];
    const sy = r(3) ? sx : SCALES[r(SCALES.length)];
    const dw = Math.max(1, Math.round(w * sx));
    let dh = Math.max(1, Math.round(h * sy));
    // shrunk across and stretched down reads a column-map slot the engines never
    // write (see sprite-scaler.ts columnMaps); a world sprite is never drawn so
    if (dw < w && dh > h) dh = h;
    const canvasW = 320;
    const canvasH = 240;
    // usually wholly on the canvas, sometimes hanging off an edge
    const ax = r(4) ? 40 + r(canvasW - 80) : r(canvasW + 200) - 100;
    const ay = r(4) ? 40 + r(canvasH - 80) : r(canvasH + 200) - 100;
    let clip = { top: 0, left: 0, bottom: canvasH, right: canvasW };
    if (r(3) === 0) {
      const top = r(canvasH >> 1);
      const left = r(canvasW >> 1);
      clip = { top, left, bottom: top + 1 + r(canvasH - top), right: left + 1 + r(canvasW - left) };
    }
    const mask = r(3) === 0 ? makeMask(r, canvasW, canvasH) : null;
    cases.push({ sprite, ax, ay, dw, dh, flip: r(2) === 1, canvasW, canvasH, clip, mask, level: r(256) });
  }
  return cases;
}

/**
 * Points to ask the engines' point tests about, for case `c`: 24 around the box
 * it is drawn into (`scaled`) and 24 around its 1:1 box (`plain`), each reaching
 * two pixels past every side so the box edges are asked about too.
 */
export function hitPoints(
  c: ScalerCase,
  seed: number,
): { scaled: [number, number][]; plain: [number, number][] } {
  const r = rng(seed);
  const v = new DataView(c.sprite.buffer, c.sprite.byteOffset, c.sprite.byteLength);
  const h = v.getInt16(0, true);
  const w = v.getInt16(2, true);
  const posY = v.getInt16(4, true);
  const posX = v.getInt16(6, true);
  const anchorX = c.flip ? w - posX : posX;
  const around = (left: number, top: number, bw: number, bh: number): [number, number][] =>
    Array.from({ length: 24 }, () => [left - 2 + r(bw + 4), top - 2 + r(bh + 4)]);
  const left = c.ax - Math.trunc((anchorX * c.dw) / w);
  const top = c.ay - Math.trunc((posY * c.dh) / h);
  return {
    scaled: around(left, top, c.dw, c.dh),
    plain: around(c.ax - anchorX, c.ay - posY, w, h),
  };
}
