/**
 * Make Titanic's two page images — the title card and the identity mark — from
 * the artwork in `taoot/assets/`.
 *
 *   npm run mklogo -w site -w taoot
 *
 * A build step rather than checked-in resizes, so each small file is always
 * derivable from the big one and no asset on the page is a mystery. Same shape
 * as dust/tools/mkdustlogo.ts, and the trimming and filtering are the shared
 * tools/logo-resize.ts — a box filter over every source pixel, averaged in
 * premultiplied alpha, after a trim to what is actually drawn. That module says
 * why each of those is what it is. Both sources here are CUT-OUTS, so the trim
 * goes on alpha, where it cannot cut into anything drawn.
 *
 * The originals live in `assets/` and not `public/`, because Vite copies
 * `public/` into the build wholesale: with a 2.4 MB source sitting next to its
 * 170 KB derivative, every deployment ships both and nothing ever fetches the
 * big one.
 *
 * ## Why the mark is cut from the globe and not from the title card
 *
 * The mark is the porthole, and the title card has one — but it does not have a
 * WHOLE one. In `taoot-full.png` the T of TITANIC is drawn over the porthole's
 * right edge, so any crop tight enough to be a mark carries a slice of the
 * letter with it, and one loose enough to miss the letter is no longer a
 * porthole. `globe.png` is the same porthole with nothing in front of it, which
 * makes it the honest source for the small version even though it is not the
 * logo.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { type DecodedPNG, decodePNG, encodePNG } from "../../tools/png";
import { resizeLogo } from "../../tools/logo-resize";

// resolved from this file rather than the working directory: a tool is run from
// the repository root and a build from the package
const at = (p: string): string => fileURLToPath(new URL(p, import.meta.url));

/**
 * The page draws the title card no wider than 32rem (512 CSS px, see
 * `#home .hero-mark` in taoot/index.html), so 512 source pixels is 1:1 there.
 * Twice that for hidpi would be sharper and costs four times the file — most of
 * this image is a photographed iceberg and brushed metal, which is the
 * expensive kind of pixel to keep four of.
 */
const CARD_WIDTH = 512;

/**
 * The mark is drawn at 30px in the top bar and used as the favicon, where the
 * browser picks its own size. 128 is 4x the larger of those on an image small
 * enough that the oversample costs nothing.
 */
const MARK_WIDTH = 128;

/**
 * How much alpha a pixel needs to count as drawn, when trimming the title card.
 *
 * Above 0, unlike the other cut-outs this repo trims, because `taoot-full.png`
 * carries a nearly-invisible fringe out to the canvas edge: at a threshold of 0
 * the trim finds 2070x755 and cuts almost nothing, and the 30 rows of empty it
 * leaves at top and bottom are 4% of the height — baked-in padding that eats
 * the part you can see, in a page that fits the image to a width. From 8 upward
 * the answer stops moving (2052x725 at 8, 16, 24 and 48 alike), which is the
 * artwork's real edge found rather than a number picked.
 */
const CARD_TRIM = 8;

// ---------------------------------------------------------------------------
// the title card
// ---------------------------------------------------------------------------

const card = resizeLogo(new Uint8Array(readFileSync(at("../assets/taoot-full.png"))), {
  width: CARD_WIDTH,
  trim: "alpha",
  trimThreshold: CARD_TRIM,
});
writeFileSync(
  at("../public/taoot-logo.png"),
  encodePNG(card.rgba, card.width, card.height, { compress: true }),
);

// ---------------------------------------------------------------------------
// the mark
// ---------------------------------------------------------------------------

/**
 * Where the porthole is in `globe.png`, measured rather than typed.
 *
 * The brass is the only warm thing in a blue-white picture, so "gold, and
 * opaque" isolates the ring from the globe it is set into and from the soft
 * shadow underneath. From that mask:
 *
 * - the RADIUS and the vertical centre come from a column through the middle.
 *   Nothing sticks out of the ring vertically, so its topmost and bottommost
 *   brass are the circle's own top and bottom.
 * - the horizontal centre is the MEDIAN of the rows' midpoints, not the mask's
 *   bounding box. The hinge on the left and the latch on the right each reach a
 *   few pixels past the ring, on opposite sides and by different amounts, so a
 *   bounding box puts the centre 3px off while the rows away from those
 *   fittings agree on where it really is.
 *
 * Reading it out of the file this way means a redrawn globe moves the crop with
 * it instead of silently cropping the wrong disc.
 */
function porthole(png: DecodedPNG): { cx: number; cy: number; r: number } {
  const brass = (x: number, y: number): boolean => {
    const i = (y * png.width + x) * 4;
    const [r, g, b, a] = [png.rgba[i], png.rgba[i + 1], png.rgba[i + 2], png.rgba[i + 3]];
    return a >= 200 && r > 130 && r - b > 60 && g > b;
  };

  const midpoints: number[] = [];
  for (let y = 0; y < png.height; y++) {
    let left = -1;
    let right = -1;
    for (let x = 0; x < png.width; x++) {
      if (!brass(x, y)) continue;
      if (left < 0) left = x;
      right = x;
    }
    // a row of two or three stray warm pixels is a highlight on the globe, not
    // a chord of the ring; the ring's shortest real chord is far wider
    if (left >= 0 && right - left > 16) midpoints.push((left + right) / 2);
  }
  if (midpoints.length === 0) throw new Error("no brass in the globe: is this the right image?");
  midpoints.sort((a, b) => a - b);
  const cx = Math.round(midpoints[midpoints.length >> 1]);

  let top = -1;
  let bottom = -1;
  for (let y = 0; y < png.height; y++) {
    if (!brass(cx, y)) continue;
    if (top < 0) top = y;
    bottom = y;
  }
  return { cx, cy: (top + bottom) / 2, r: (bottom - top) / 2 };
}

/**
 * The porthole cut out as a disc, as a PNG.
 *
 * A circular mask and not a square crop, because the square's corners are the
 * globe the porthole is set into: at this size that is a blue rind around a
 * brass ring, which reads as a halo rather than as artwork. Cutting on the
 * ring's own outer edge shaves a few pixels off the hinge and the latch — the
 * only two things that reach past it — and what is left is a round mark that is
 * round all the way, which is what a 30px identity mark and a favicon each want.
 *
 * The edge is feathered across one pixel rather than stepped, so the disc has an
 * antialiased rim before it is downsampled and not a staircase that the box
 * filter then averages into a fuzzy one.
 *
 * Handed back as an encoded PNG so the downsample can be the shared
 * `resizeLogo` — a round trip through the encoder that costs nothing in an
 * offline tool and keeps one filter in the repository instead of two.
 */
function discPNG(png: DecodedPNG, at: { cx: number; cy: number; r: number }): Uint8Array {
  const size = Math.ceil(2 * at.r) + 2;
  const ox = at.cx - size / 2;
  const oy = at.cy - size / 2;
  const rgba = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const sx = Math.round(ox + x);
      const sy = Math.round(oy + y);
      if (sx < 0 || sy < 0 || sx >= png.width || sy >= png.height) continue;
      const d = Math.hypot(ox + x + 0.5 - at.cx, oy + y + 0.5 - at.cy);
      // 1 well inside the ring, 0 outside it, a linear ramp across the pixel
      // straddling the edge
      const k = Math.min(1, Math.max(0, at.r - 0.5 - d + 0.5));
      if (k === 0) continue;
      const s = (sy * png.width + sx) * 4;
      const t = (y * size + x) * 4;
      rgba[t] = png.rgba[s];
      rgba[t + 1] = png.rgba[s + 1];
      rgba[t + 2] = png.rgba[s + 2];
      rgba[t + 3] = Math.round(png.rgba[s + 3] * k);
    }
  }
  return encodePNG(rgba, size, size, { compress: true });
}

const globe = decodePNG(new Uint8Array(readFileSync(at("../assets/globe.png"))));
const disc = porthole(globe);
const mark = resizeLogo(discPNG(globe, disc), { width: MARK_WIDTH, trim: "alpha" });
writeFileSync(
  at("../public/taoot-mark.png"),
  encodePNG(mark.rgba, mark.width, mark.height, { compress: true }),
);

// ---------------------------------------------------------------------------

const kb = (p: string): string => `${(readFileSync(p).length / 1024).toFixed(0)} KB`;
console.log(
  `title card: ${card.source.width}x${card.source.height} ${kb(at("../assets/taoot-full.png"))}` +
    ` · artwork ${card.crop.width}x${card.crop.height} at ${card.crop.left},${card.crop.top}` +
    ` -> ${card.width}x${card.height} ${kb(at("../public/taoot-logo.png"))}`,
);
console.log(
  `mark: porthole r=${disc.r} at ${disc.cx},${disc.cy} in ${globe.width}x${globe.height}` +
    ` -> ${mark.width}x${mark.height} ${kb(at("../public/taoot-mark.png"))}`,
);
