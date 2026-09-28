/**
 * Make `public/lunicus-logo.png`, the page-sized title card, from the full-size
 * artwork at `lunicus/assets/lunicus-full.png`.
 *
 *   npm run mklogo -w lunicus [-- <width>]
 *
 * The artwork came as RedJack's did: a flat RGB render with a transparency
 * checkerboard painted into it and no alpha channel, so it is keyed the same
 * way (redjack/tools/mkredjacklogo.ts says how). One thing is new here: the
 * wordmark's letters close the checkerboard in — inside the L, the C and the U —
 * where a flood from the border never gets, so the key is asked to find those
 * patches as well (`holes`).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { decodePNG, encodePNG } from "../../tools/png";
import { resizeLogo } from "../../tools/logo-resize";
import { keyCheckerboard } from "../../redjack/tools/mkredjacklogo";

const SRC = fileURLToPath(new URL("../assets/lunicus-full.png", import.meta.url));
const OUT = fileURLToPath(new URL("../public/lunicus-logo.png", import.meta.url));

/** the page never draws the card wider than this (as RedJack's) */
const DEFAULT_WIDTH = 900;

/** the artwork with its checkerboard keyed out, all of it */
export function keyLunicus(rgba: Uint8Array, w: number, h: number): void {
  keyCheckerboard(rgba, w, h, { holes: true });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const width = Number(process.argv[2] ?? DEFAULT_WIDTH);
  const src = decodePNG(new Uint8Array(readFileSync(SRC)));
  keyLunicus(src.rgba, src.width, src.height);
  const keyed = encodePNG(src.rgba, src.width, src.height, { compress: true });
  const img = resizeLogo(keyed, { width, trim: "alpha", trimThreshold: 8 });
  writeFileSync(OUT, encodePNG(img.rgba, img.width, img.height, { compress: true }));
  console.log(
    `source ${img.source.width}x${img.source.height} · artwork ${img.crop.width}x${img.crop.height}` +
      ` at ${img.crop.left},${img.crop.top} · wrote ${img.width}x${img.height}` +
      ` ${(readFileSync(OUT).length / 1024).toFixed(0)} KB`,
  );
}
