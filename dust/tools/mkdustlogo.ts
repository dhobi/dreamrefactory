/**
 * Make `public/dust-logo.png` — the page-sized title card — from the full-size
 * artwork at `dust/assets/dust-full.png`.
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
 * The trimming and the filtering are tools/logo-resize.ts, shared with the
 * project's own wordmark — a box filter over every source pixel, averaged in
 * premultiplied alpha, after a trim to what is actually drawn. That module says
 * why each of those is what it is. This artwork is a CUT-OUT, so the trim goes on
 * alpha, where it cannot cut into anything drawn.
 *
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { encodePNG } from "../../tools/png";
import { resizeLogo } from "../../tools/logo-resize";

// resolved from this file rather than the working directory: a tool is run from
// the repository root and a build from the package
const SRC = fileURLToPath(new URL("../assets/dust-full.png", import.meta.url));
const OUT = fileURLToPath(new URL("../public/dust-logo.png", import.meta.url));

/**
 * The page never draws it wider than 900 CSS px (`max-width: min(900px, 100%)`),
 * so 900 source pixels is 1:1 there. Twice that for hidpi would be sharper and
 * costs four times the file — 2 MB for a decoration on a page whose whole point
 * is the 512x264 picture underneath it, which is not a trade worth making.
 */
const DEFAULT_WIDTH = 900;

const width = Number(process.argv[2] ?? DEFAULT_WIDTH);
const img = resizeLogo(new Uint8Array(readFileSync(SRC)), { width, trim: "alpha" });
writeFileSync(OUT, encodePNG(img.rgba, img.width, img.height, { compress: true }));

const before = readFileSync(SRC).length;
const after = readFileSync(OUT).length;
console.log(
  `source ${img.source.width}x${img.source.height} ${(before / 1024).toFixed(0)} KB` +
    ` · artwork ${img.crop.width}x${img.crop.height} at ${img.crop.left},${img.crop.top}`,
);
console.log(
  `wrote  ${img.width}x${img.height} ${(after / 1024).toFixed(0)} KB` +
    ` (${((after / before) * 100).toFixed(0)}% of the original)`,
);
