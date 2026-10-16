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
 * at the first square. So it is keyed by a flood from the border through the
 * near-white, colourless ground (tools/ground-key.ts says how). Then
 * tools/logo-resize.ts trims to alpha and box-filters, as for Dust's card.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { decodePNG, encodePNG } from "../../tools/png";
import { keyCheckerboard } from "../../tools/ground-key";
import { resizeLogo } from "../../tools/logo-resize";

const SRC = fileURLToPath(new URL("../assets/redjack-full.png", import.meta.url));
const OUT = fileURLToPath(new URL("../public/redjack-logo.png", import.meta.url));

/** the page never draws the card wider than this (as Dust's, see mkdustlogo.ts) */
const DEFAULT_WIDTH = 900;

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
