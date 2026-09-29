/**
 * Make `public/lunicus-logo.png`, the page-sized title card, from the full-size
 * artwork at `lunicus/assets/lunicus-full.png`.
 *
 *   npm run mklogo -w lunicus [-- <width>]
 *
 * The artwork has its own alpha: the card round it, and the glow that fades
 * into it, are transparent, so nothing is keyed. (The first artwork was a flat
 * render with a transparency checkerboard painted into it, keyed out as
 * RedJack's is; this one replaced it.)
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { encodePNG } from "../../tools/png";
import { resizeLogo } from "../../tools/logo-resize";

const SRC = fileURLToPath(new URL("../assets/lunicus-full.png", import.meta.url));
const OUT = fileURLToPath(new URL("../public/lunicus-logo.png", import.meta.url));

/** the page never draws the card wider than this (as RedJack's) */
const DEFAULT_WIDTH = 900;

if (import.meta.url === `file://${process.argv[1]}`) {
  const width = Number(process.argv[2] ?? DEFAULT_WIDTH);
  const img = resizeLogo(new Uint8Array(readFileSync(SRC)), { width, trim: "alpha", trimThreshold: 8 });
  writeFileSync(OUT, encodePNG(img.rgba, img.width, img.height, { compress: true }));
  console.log(
    `source ${img.source.width}x${img.source.height} · artwork ${img.crop.width}x${img.crop.height}` +
      ` at ${img.crop.left},${img.crop.top} · wrote ${img.width}x${img.height}` +
      ` ${(readFileSync(OUT).length / 1024).toFixed(0)} KB`,
  );
}
