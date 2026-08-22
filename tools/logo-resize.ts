/**
 * Trim a piece of artwork to what is actually drawn on it, and downsample it to
 * the width a page shows it at.
 *
 * Shared because two packages do this to a title card — Dust's, and the
 * project's own wordmark — and the interesting parts are the same both times. A
 * build step rather than a checked-in resize, so the small file is always
 * derivable from the big one and a page's asset is not a mystery.
 *
 * The originals live in a package's `assets/` and not its `public/`, because Vite
 * copies `public/` into the build wholesale: with a 1 MB source sitting next to
 * its 90 KB derivative, every deployment shipped both and nothing ever fetched
 * the big one.
 *
 * ## Why the filtering is what it is
 *
 * **A box filter over every source pixel**, not a nearest-neighbour pick. These
 * are 2000px-wide renders being shown at ~600–900: dropping half the pixels
 * leaves hairlines aliasing into dashes and the lettering's bevel crawling.
 * Averaging the whole source box for each destination pixel is the cheap correct
 * answer, and this is an offline step, so there is nothing to save by being
 * clever.
 *
 * **Averaged in PREMULTIPLIED alpha.** Artwork cut out against transparency
 * still carries a colour in its transparent pixels — usually white, from the
 * canvas it was drawn on. Averaging straight RGBA drags that white into every
 * edge pixel, which on a near-black page reads as a pale fringe all the way
 * round. Multiplying by alpha before averaging and dividing by the alpha total
 * after weights each pixel by how much of it there IS, so a transparent
 * neighbour contributes nothing but its hole. On fully opaque artwork this is
 * arithmetically the same as a plain average, so it costs nothing to always do.
 *
 * **Trimmed to the artwork first.** Empty margin is not free twice over: it is
 * pixels in the file, and it is a lie about the image's shape — a page that fits
 * the logo to a width has baked-in padding eating the part you can see.
 *
 * ## Two kinds of empty margin
 *
 * Which is why the trim has two modes. Art exported as a cut-out has a
 * TRANSPARENT margin, and trimming on alpha cannot cut into anything drawn. Art
 * exported as a flat render — the DreamREfactory wordmark is RGB with no alpha at
 * all — has a BLACK one, where alpha says every pixel is present and only
 * brightness distinguishes the margin from the picture. Trimming that on alpha
 * finds nothing to trim; trimming it on luminance finds the real edge.
 */
import { decodePNG } from "./png";

export interface ResizeOptions {
  /** the destination width in pixels; the height follows the artwork's ratio */
  width: number;
  /**
   * How to find the margin. `alpha` for a cut-out (the default, and the only
   * safe one there); `luma` for a flat render on black.
   */
  trim?: "alpha" | "luma";
  /**
   * How much a pixel has to have to count as drawn: alpha in `alpha` mode,
   * brightness in `luma` mode, 0–255. Default 0, meaning any pixel that is
   * present at all.
   *
   * Worth raising above 0 after `unblack`, and only then: a bloom's outermost
   * falloff becomes an alpha of 1 or 2 reaching the very edge of the canvas, so a
   * trim looking for "any alpha" finds the whole frame and cuts nothing. A
   * threshold of a few counts drops what no eye can see and lets the real edge be
   * found — while keeping the visible part of the glow, which IS the image.
   */
  trimThreshold?: number;
  /**
   * Read the image as light on black and give it a real alpha channel. See the
   * header. Applied before the trim, so `trim` should then be `alpha`.
   */
  unblack?: boolean;
  /**
   * For `unblack`: the brightness at and above which a pixel is fully opaque,
   * 1–255. Everything below ramps, which is the glow. Higher keeps more of the
   * bloom as translucency; lower makes more of the image solid.
   */
  unblackKnee?: number;
}

export interface ResizedLogo {
  rgba: Uint8Array;
  width: number;
  height: number;
  /** what the source was, for a tool that wants to report it */
  source: { width: number; height: number };
  /** the artwork's own box inside the source */
  crop: { left: number; top: number; width: number; height: number };
}

export function resizeLogo(png: Uint8Array, opts: ResizeOptions): ResizedLogo {
  const src = decodePNG(png);
  if (opts.unblack) blackToAlpha(src.rgba, opts.unblackKnee ?? 48);
  const mode = opts.trim ?? "alpha";
  const threshold = opts.trimThreshold ?? 0;

  const drawn = (i: number): boolean => {
    if (mode === "alpha") return src.rgba[i + 3] > threshold;
    // Rec. 601 luma is close enough for "is anything here", and cheaper than
    // being principled about it
    if (src.rgba[i + 3] === 0) return false;
    const l = 0.299 * src.rgba[i] + 0.587 * src.rgba[i + 1] + 0.114 * src.rgba[i + 2];
    return l > threshold;
  };

  let left = src.width, right = -1, top = src.height, bottom = -1;
  for (let y = 0; y < src.height; y++) {
    for (let x = 0; x < src.width; x++) {
      if (!drawn((y * src.width + x) * 4)) continue;
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
    }
  }
  if (right < left || bottom < top) throw new Error("the image is entirely empty margin");

  const cropW = right - left + 1;
  const cropH = bottom - top + 1;
  const width = opts.width;
  const height = Math.max(1, Math.round((cropH * width) / cropW));
  const out = new Uint8Array(width * height * 4);

  for (let y = 0; y < height; y++) {
    const y0 = top + Math.floor((y * cropH) / height);
    const y1 = Math.max(y0 + 1, top + Math.floor(((y + 1) * cropH) / height));
    for (let x = 0; x < width; x++) {
      const x0 = left + Math.floor((x * cropW) / width);
      const x1 = Math.max(x0 + 1, left + Math.floor(((x + 1) * cropW) / width));
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let sy = y0; sy < y1; sy++) {
        for (let sx = x0; sx < x1; sx++) {
          const i = (sy * src.width + sx) * 4;
          const al = src.rgba[i + 3];
          r += src.rgba[i] * al;
          g += src.rgba[i + 1] * al;
          b += src.rgba[i + 2] * al;
          a += al;
          n++;
        }
      }
      const d = (y * width + x) * 4;
      out[d] = a ? Math.round(r / a) : 0;
      out[d + 1] = a ? Math.round(g / a) : 0;
      out[d + 2] = a ? Math.round(b / a) : 0;
      out[d + 3] = Math.round(a / n);
    }
  }

  return {
    rgba: out,
    width,
    height,
    source: { width: src.width, height: src.height },
    crop: { left, top, width: cropW, height: cropH },
  };
}

/**
 * In place: alpha from brightness, colour un-premultiplied below the knee.
 *
 * Anything already carrying alpha is left alone — a cut-out that happens to be
 * passed through here should not have its transparency recomputed from how dark
 * its pixels are.
 */
function blackToAlpha(rgba: Uint8Array, knee: number): void {
  for (let i = 0; i < rgba.length; i += 4) {
    if (rgba[i + 3] !== 255) continue;
    const r = rgba[i], g = rgba[i + 1], b = rgba[i + 2];
    const light = Math.max(r, g, b);
    if (light >= knee) {
      rgba[i + 3] = 255;
      continue;
    }
    if (light === 0) {
      rgba[i + 3] = 0;
      // a fully transparent pixel's colour is never sampled, but leaving it
      // black keeps the premultiplied average below honest about it
      continue;
    }
    const a = Math.round((light * 255) / knee);
    rgba[i + 3] = a;
    // divide out the alpha just assigned, so compositing puts the original
    // value back: (c * 255 / a) * (a / 255) = c
    const un = 255 / a;
    rgba[i] = Math.min(255, Math.round(r * un));
    rgba[i + 1] = Math.min(255, Math.round(g * un));
    rgba[i + 2] = Math.min(255, Math.round(b * un));
  }
}
