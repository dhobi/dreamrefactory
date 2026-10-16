/**
 * Make `public/jumpraven-logo.png`, the page-sized title card, from the full-size
 * artwork at `jumpraven/assets/jumpraven-full.png`.
 *
 *   npm run mklogo -w jumpraven [-- <width>]
 *
 * The artwork is a flat RGB render on white, with no alpha channel, so it is
 * keyed as RedJack's is: a flood from the border through the near-white,
 * colourless ground (tools/ground-key.ts). The ground here is one level, not a
 * checkerboard, so the key's `holes` find nothing; the one patch shut in, under
 * the J's band between the statue's crown and its spikes, is found by
 * `keyWhiteGround`'s search for white patches the border cannot reach.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { decodePNG, encodePNG } from "../../tools/png";
import { keyWhiteGround } from "../../tools/ground-key";
import { resizeLogo } from "../../tools/logo-resize";

const SRC = fileURLToPath(new URL("../assets/jumpraven-full.png", import.meta.url));
const OUT = fileURLToPath(new URL("../public/jumpraven-logo.png", import.meta.url));

/** the page never draws the card wider than this (as RedJack's) */
const DEFAULT_WIDTH = 900;

if (import.meta.url === `file://${process.argv[1]}`) {
  const width = Number(process.argv[2] ?? DEFAULT_WIDTH);
  const src = decodePNG(new Uint8Array(readFileSync(SRC)));
  keyWhiteGround(src.rgba, src.width, src.height);
  const keyed = encodePNG(src.rgba, src.width, src.height, { compress: true });
  const img = resizeLogo(keyed, { width, trim: "alpha", trimThreshold: 8 });
  writeFileSync(OUT, encodePNG(img.rgba, img.width, img.height, { compress: true }));
  console.log(
    `source ${img.source.width}x${img.source.height} · artwork ${img.crop.width}x${img.crop.height}` +
      ` at ${img.crop.left},${img.crop.top} · wrote ${img.width}x${img.height}` +
      ` ${(readFileSync(OUT).length / 1024).toFixed(0)} KB`,
  );
}
