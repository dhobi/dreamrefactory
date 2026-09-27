/**
 * Make `public/redjack-logo.png`, the page-sized title card, from the full-size
 * artwork at `redjack/assets/redjack-full.png`.
 *
 *   npm run mklogo -w redjack [-- <width>]
 *
 * The artwork arrived as a flat RGB render with a transparency CHECKERBOARD
 * painted into it — white (254) and light grey (237) squares, twenty pixels a
 * side — and no alpha channel at all. Neither of the other keys fits:
 * tools/keylogo.ts reads coverage off a black ground, and a luma trim would stop
 * at the first square. So the ground is found the way an eye finds it: a flood
 * from the border through pixels that are near-white and colourless
 * ({@link isGround}), which the parchment, the wood and the red letters never
 * are. The torn parchment edge is light, but it is TAN, and the fill stops at
 * the first pixel with any warmth in it.
 *
 * The edge the flood stops at is a blend of parchment and square, so the pixels
 * touching the ground get an alpha from how far they have left the ground's
 * brightness, and their colour has the ground taken back out of it — otherwise
 * the cut-out wears a pale rim on the page's dark. Then tools/logo-resize.ts
 * trims to alpha and box-filters, as for Dust's card.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { decodePNG, encodePNG } from "../../tools/png";
import { resizeLogo } from "../../tools/logo-resize";

const SRC = fileURLToPath(new URL("../assets/redjack-full.png", import.meta.url));
const OUT = fileURLToPath(new URL("../public/redjack-logo.png", import.meta.url));

/** the page never draws the card wider than this (as Dust's, see mkdustlogo.ts) */
const DEFAULT_WIDTH = 900;

/** the checkerboard's two squares average to this */
const GROUND = 246;

/** colourless and near-white: a square of the checkerboard, or a blend of two */
const isGround = (r: number, g: number, b: number): boolean =>
  Math.max(r, g, b) - Math.min(r, g, b) <= 8 && Math.min(r, g, b) >= 224;

export function keyCheckerboard(rgba: Uint8Array, w: number, h: number): void {
  const ground = new Uint8Array(w * h);
  const stack: number[] = [];
  const push = (p: number): void => {
    if (ground[p]) return;
    const i = p * 4;
    if (!isGround(rgba[i], rgba[i + 1], rgba[i + 2])) return;
    ground[p] = 1;
    stack.push(p);
  };
  for (let x = 0; x < w; x++) (push(x), push((h - 1) * w + x));
  for (let y = 0; y < h; y++) (push(y * w), push(y * w + w - 1));
  while (stack.length) {
    const p = stack.pop()!;
    const x = p % w;
    if (x > 0) push(p - 1);
    if (x < w - 1) push(p + 1);
    if (p >= w) push(p - w);
    if (p < w * (h - 1)) push(p + w);
  }
  for (let p = 0; p < w * h; p++) {
    const i = p * 4;
    if (ground[p]) {
      rgba[i + 3] = 0;
      continue;
    }
    // the rim: a pixel with ground beside it is part square
    const x = p % w;
    const rim =
      (x > 0 && ground[p - 1]) || (x < w - 1 && ground[p + 1]) ||
      (p >= w && ground[p - w]) || (p < w * (h - 1) && ground[p + w]);
    if (!rim) continue;
    const lo = Math.min(rgba[i], rgba[i + 1], rgba[i + 2]);
    // the parchment's blue channel sits near 120; a pixel that far from the
    // ground is all artwork, one at the ground's own level is none
    const a = Math.max(0, Math.min(1, (GROUND - lo) / 110));
    if (a < 1 / 255) {
      rgba[i + 3] = 0;
      continue;
    }
    for (let k = 0; k < 3; k++) {
      rgba[i + k] = Math.max(0, Math.min(255, Math.round((rgba[i + k] - (1 - a) * GROUND) / a)));
    }
    rgba[i + 3] = Math.round(a * 255);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const width = Number(process.argv[2] ?? DEFAULT_WIDTH);
  const src = decodePNG(new Uint8Array(readFileSync(SRC)));
  keyCheckerboard(src.rgba, src.width, src.height);
  const keyed = encodePNG(src.rgba, src.width, src.height, { compress: true });
  const img = resizeLogo(keyed, { width, trim: "alpha", trimThreshold: 8 });
  writeFileSync(OUT, encodePNG(img.rgba, img.width, img.height, { compress: true }));
  console.log(
    `source ${img.source.width}x${img.source.height} · artwork ${img.crop.width}x${img.crop.height}` +
      ` at ${img.crop.left},${img.crop.top} · wrote ${img.width}x${img.height}` +
      ` ${(readFileSync(OUT).length / 1024).toFixed(0)} KB`,
  );
}
