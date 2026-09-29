/**
 * The game window of a DreamFactory 0 game: 512x384 palette indices and the
 * palette they are shown in. LUNICUS.EXE and RAVEN.EXE both draw into a window
 * of this size; the machine draws here and nowhere else, a page turns it into
 * pixels, a test reads it or ignores it.
 */
import type { FrameV0 } from "../df/image-v0";
import type { BitmapFont } from "./font";

/** the window, 512x384 in both games */
export const SCREEN_W = 512;
export const SCREEN_H = 384;

/** {top, left, bottom, right}, the Macintosh way, bottom and right exclusive */
export type Rect = readonly [number, number, number, number];

export const FULL: Rect = [0, 0, SCREEN_H, SCREEN_W];

export class Screen {
  readonly pixels = new Uint8Array(SCREEN_W * SCREEN_H);
  /** 256 RGBA entries */
  palette: Uint8ClampedArray = new Uint8ClampedArray(256 * 4);
  /** bumped whenever the picture or the palette changes, so a page redraws only then */
  version = 0;

  setPalette(rgba: Uint8ClampedArray): void {
    this.palette = rgba;
    this.version++;
  }

  fill(r: Rect, index: number): void {
    const [t, l, b, rt] = clip(r, FULL);
    for (let y = t; y < b; y++) this.pixels.fill(index, y * SCREEN_W + l, y * SCREEN_W + rt);
    this.version++;
  }

  /**
   * The rect's pixels inverted: each index's bits flipped, which in a
   * Macintosh palette is the colour opposite — what XOR with the black pen
   * does on the 8-bit window.
   */
  invert(r: Rect): void {
    const [t, l, b, rt] = clip(r, FULL);
    for (let y = t; y < b; y++) for (let x = l; x < rt; x++) this.pixels[y * SCREEN_W + x] ^= 0xff;
    this.version++;
  }

  /**
   * A frame `pen` pixels thick just inside the rect, inverted: `_portframerect`
   * with a `pen`-square pen in XOR mode (RAVEN.EXE 0x427373, a button held down:
   * pen 3, mode 1). Drawn twice it is gone.
   */
  invertFrame(r: Rect, pen: number): void {
    const [t, l, b, rt] = r;
    if (b - t <= 2 * pen || rt - l <= 2 * pen) return this.invert(r);
    this.invert([t, l, t + pen, rt]);
    this.invert([b - pen, l, b, rt]);
    this.invert([t + pen, l, b - pen, l + pen]);
    this.invert([t + pen, rt - pen, b - pen, rt]);
  }

  /** a frame `pen` pixels thick just inside the rect, in one ink (`_portframerect` in copy mode) */
  frame(r: Rect, pen: number, index: number): void {
    const [t, l, b, rt] = r;
    this.fill([t, l, t + pen, rt], index);
    this.fill([b - pen, l, b, rt], index);
    this.fill([t, l, b, l + pen], index);
    this.fill([t, rt - pen, b, rt], index);
  }

  /** `w`-wide rows of indices, their top-left at (top, left) */
  put(src: Uint8Array, w: number, h: number, top: number, left: number): void {
    for (let y = 0; y < h; y++) {
      const sy = top + y;
      if (sy < 0 || sy >= SCREEN_H) continue;
      const from = Math.max(0, -left);
      const to = Math.min(w, SCREEN_W - left);
      if (to > from) this.pixels.set(src.subarray(y * w + from, y * w + to), sy * SCREEN_W + left + from);
    }
    this.version++;
  }

  /** a picture drawn at a point: its anchor lands there (LUNICUS.EXE 0x404ab8) */
  sprite(f: FrameV0, y: number, x: number, within: Rect = FULL): void {
    this.spriteAt(f, y - f.anchorY, x - f.anchorX, within);
  }

  /** a picture drawn at a point, left for right: its anchor measured from its right edge (0x404d2b) */
  spriteMirrored(f: FrameV0, y: number, x: number, within: Rect = FULL): void {
    const [ct, cl, cb, cr] = clip(within, FULL);
    const top = y - f.anchorY;
    const left = x - (f.width - f.anchorX);
    for (let r = 0; r < f.height; r++) {
      const sy = top + r;
      if (sy < ct || sy >= cb) continue;
      for (let c = 0; c < f.width; c++) {
        const sx = left + (f.width - 1 - c);
        if (sx < cl || sx >= cr) continue;
        const i = r * f.width + c;
        if (f.opaque[i]) this.pixels[sy * SCREEN_W + sx] = f.indexed[i];
      }
    }
    this.version++;
  }

  /** a picture with its top-left at (top, left), clear pixels left alone */
  spriteAt(f: FrameV0, top: number, left: number, within: Rect = FULL): void {
    const [ct, cl, cb, cr] = clip(within, FULL);
    for (let r = 0; r < f.height; r++) {
      const sy = top + r;
      if (sy < ct || sy >= cb) continue;
      for (let c = 0; c < f.width; c++) {
        const sx = left + c;
        if (sx < cl || sx >= cr) continue;
        const i = r * f.width + c;
        if (f.opaque[i]) this.pixels[sy * SCREEN_W + sx] = f.indexed[i];
      }
    }
    this.version++;
  }

  /** a picture stretched onto a rect, nearest pixel, clipped (the figures, 0x405213) */
  spriteScaled(f: FrameV0, dst: Rect, within: Rect): void {
    const [t, l, b, r] = dst;
    const w = r - l;
    const h = b - t;
    if (w <= 0 || h <= 0) return;
    const [ct, cl, cb, cr] = clip(within, FULL);
    for (let y = Math.max(t, ct); y < Math.min(b, cb); y++) {
      const sy = Math.floor(((y - t) * f.height) / h);
      for (let x = Math.max(l, cl); x < Math.min(r, cr); x++) {
        const i = sy * f.width + Math.floor(((x - l) * f.width) / w);
        if (f.opaque[i]) this.pixels[y * SCREEN_W + x] = f.indexed[i];
      }
    }
    this.version++;
  }

  /** a string with its baseline at y, in one ink; answers the pen's end */
  text(font: BitmapFont, x: number, baseline: number, s: string, ink: number, within: Rect = FULL): number {
    const [ct, cl, cb, cr] = clip(within, FULL);
    const top = baseline - font.ascent;
    for (const ch of s) {
      const g = font.glyphs.get(ch.charCodeAt(0));
      if (!g) continue;
      for (let r = 0; r < font.height; r++) {
        const sy = top + r;
        if (sy < ct || sy >= cb) continue;
        for (let c = 0; c < g.width; c++) {
          const sx = x + c;
          if (sx >= cl && sx < cr && g.rows[r][c]) this.pixels[sy * SCREEN_W + sx] = ink;
        }
      }
      x += g.width;
    }
    this.version++;
    return x;
  }

  /** the screen as RGBA, for a page or a screenshot */
  rgba(out = new Uint8ClampedArray(SCREEN_W * SCREEN_H * 4)): Uint8ClampedArray {
    const p = this.palette;
    for (let i = 0; i < this.pixels.length; i++) {
      const c = this.pixels[i] * 4;
      out[i * 4] = p[c];
      out[i * 4 + 1] = p[c + 1];
      out[i * 4 + 2] = p[c + 2];
      out[i * 4 + 3] = 255;
    }
    return out;
  }
}

export function clip(a: Rect, b: Rect): [number, number, number, number] {
  return [Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.min(a[2], b[2]), Math.min(a[3], b[3])];
}

export const inRect = (r: Rect, y: number, x: number): boolean => y >= r[0] && y < r[2] && x >= r[1] && x < r[3];
