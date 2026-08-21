/**
 * Make `public/dust-logo.png` — the page-sized title card — from the full-size
 * artwork at `assets/dust-full.png`.
 *
 *   npm run mkdustlogo [-- <width>]
 *
 * A build step rather than a checked-in resize, so the small file is always
 * derivable from the big one and the page's asset is not a mystery.
 *
 * The original lives in `assets/` and not in `public/`, because Vite copies
 * `public/` into the build wholesale: with the 2.8 MB source sitting next to the
 * 0.5 MB derivative, every deployment shipped both and nothing ever fetched the
 * big one. `assets/` is where this repo already keeps art a tool reads rather
 * than a page loads (nightdive.gif).
 *
 * ## Why the filtering is what it is
 *
 * **A box filter over every source pixel**, not a nearest-neighbour pick. The
 * logo is a 2000px-wide render being shown at ~900: dropping 55% of the pixels
 * leaves the hairlines in the windmill and the saloon's clapboards aliasing into
 * dashes, and the lettering's bevel crawling. Averaging the whole source box for
 * each destination pixel is the cheap correct answer and this is an offline step,
 * so there is nothing to save by being clever.
 *
 * **Averaged in PREMULTIPLIED alpha.** The artwork is cut out against
 * transparency, and every transparent pixel still carries a colour — usually
 * white, from the canvas it was drawn on. Averaging straight RGBA drags that
 * white into every edge pixel, which on this page's near-black background reads
 * as a pale fringe all the way round the skull and the lettering. Multiplying by
 * alpha before averaging and dividing after weights each pixel by how much of it
 * there IS, so a transparent neighbour contributes nothing but its transparency.
 *
 * **Trimmed to the artwork first.** Empty margin is not free twice over: it is
 * pixels in the file, and it is a lie about the image's shape — the page centres
 * the logo and fits it to a height, so baked-in padding shifts it off centre and
 * shrinks the part you can see. The trim is on alpha alone, so it cannot cut into
 * anything that is drawn.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { decodePNG, encodePNG } from "./png";

const SRC = "assets/dust-full.png";
const OUT = "public/dust-logo.png";
/**
 * The page never draws it wider than 900 CSS px (`max-width: min(900px, 100%)`),
 * so 900 source pixels is 1:1 there. Twice that for hidpi would be sharper and
 * costs four times the file — 2 MB for a decoration on a page whose whole point
 * is the 512x264 picture underneath it, which is not a trade worth making.
 */
const DEFAULT_WIDTH = 900;

const width = Number(process.argv[2] ?? DEFAULT_WIDTH);
const src = decodePNG(new Uint8Array(readFileSync(SRC)));

// the artwork's own bounding box: the first and last row and column holding any
// pixel that is not fully transparent
let left = src.width, right = -1, top = src.height, bottom = -1;
for (let y = 0; y < src.height; y++) {
  for (let x = 0; x < src.width; x++) {
    if (!src.rgba[(y * src.width + x) * 4 + 3]) continue;
    if (x < left) left = x;
    if (x > right) right = x;
    if (y < top) top = y;
    if (y > bottom) bottom = y;
  }
}
if (right < left || bottom < top) throw new Error(`${SRC} is fully transparent`);
const cropW = right - left + 1, cropH = bottom - top + 1;

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
    // divide the premultiplied sums by the ALPHA total, not the pixel count:
    // that is what makes a transparent neighbour contribute nothing but its hole
    out[d] = a ? Math.round(r / a) : 0;
    out[d + 1] = a ? Math.round(g / a) : 0;
    out[d + 2] = a ? Math.round(b / a) : 0;
    out[d + 3] = Math.round(a / n);
  }
}

writeFileSync(OUT, encodePNG(out, width, height, { compress: true }));
const before = readFileSync(SRC).length, after = readFileSync(OUT).length;
console.log(`${SRC} ${src.width}x${src.height} ${(before / 1024).toFixed(0)} KB` +
  ` · artwork ${cropW}x${cropH} at ${left},${top}`);
console.log(`${OUT} ${width}x${height} ${(after / 1024).toFixed(0)} KB` +
  ` (${((after / before) * 100).toFixed(0)}% of the original)`);
