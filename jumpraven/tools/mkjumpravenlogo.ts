/**
 * Make `public/jumpraven-logo.png`, the page-sized title card, from the full-size
 * artwork at `jumpraven/assets/jumpraven-full.png`.
 *
 *   npm run mklogo -w jumpraven [-- <width>]
 *
 * The artwork is a flat RGB render on white, with no alpha channel, so it is
 * keyed as RedJack's is (redjack/tools/mkredjacklogo.ts says how): a flood
 * from the border through the near-white, colourless ground. The ground here
 * is one level, not a checkerboard, so the key's `holes` — patches holding
 * BOTH of a checkerboard's levels — find nothing; the one patch shut in, under
 * the J's band between the statue's crown and its spikes, is found as
 * {@link shutIn} finds it instead.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { decodePNG, encodePNG } from "../../tools/png";
import { resizeLogo } from "../../tools/logo-resize";
import { isGround, keyCheckerboard } from "../../redjack/tools/mkredjacklogo";

const SRC = fileURLToPath(new URL("../assets/jumpraven-full.png", import.meta.url));
const OUT = fileURLToPath(new URL("../public/jumpraven-logo.png", import.meta.url));

/** the page never draws the card wider than this (as RedJack's) */
const DEFAULT_WIDTH = 900;

/**
 * The ground a flood from the border does not reach: a patch of ground pixels,
 * not touching the border, of at least {@link SHUT_IN_SIZE} pixels and nearly
 * all pure white. The chrome's and the wings' highlights are near-white too,
 * but they are small and mostly a shade under white (under 85% at 250 or more,
 * where the one real patch is 93%).
 */
const SHUT_IN_SIZE = 1000;
const SHUT_IN_WHITE = 0.85;
function shutIn(rgba: Uint8Array, w: number, h: number): number[] {
  const seen = new Uint8Array(w * h);
  const ground = (p: number): boolean => isGround(rgba[p * 4], rgba[p * 4 + 1], rgba[p * 4 + 2]);
  const seeds: number[] = [];
  for (let p = 0; p < w * h; p++) {
    if (seen[p] || !ground(p)) continue;
    const patch = [p];
    seen[p] = 1;
    let white = 0;
    let border = false;
    for (let k = 0; k < patch.length; k++) {
      const q = patch[k];
      const x = q % w;
      if (x === 0 || x === w - 1 || q < w || q >= w * (h - 1)) border = true;
      if (Math.min(rgba[q * 4], rgba[q * 4 + 1], rgba[q * 4 + 2]) >= 250) white++;
      for (const r of [x > 0 ? q - 1 : -1, x < w - 1 ? q + 1 : -1, q - w, q + w]) {
        if (r >= 0 && r < w * h && !seen[r] && ground(r)) (seen[r] = 1), patch.push(r);
      }
    }
    if (!border && patch.length >= SHUT_IN_SIZE && white / patch.length >= SHUT_IN_WHITE) seeds.push(p);
  }
  return seeds;
}

/** the artwork with its white ground keyed out, all of it */
export function keyJumpRaven(rgba: Uint8Array, w: number, h: number): void {
  keyCheckerboard(rgba, w, h, { seeds: shutIn(rgba, w, h) });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const width = Number(process.argv[2] ?? DEFAULT_WIDTH);
  const src = decodePNG(new Uint8Array(readFileSync(SRC)));
  keyJumpRaven(src.rgba, src.width, src.height);
  const keyed = encodePNG(src.rgba, src.width, src.height, { compress: true });
  const img = resizeLogo(keyed, { width, trim: "alpha", trimThreshold: 8 });
  writeFileSync(OUT, encodePNG(img.rgba, img.width, img.height, { compress: true }));
  console.log(
    `source ${img.source.width}x${img.source.height} · artwork ${img.crop.width}x${img.crop.height}` +
      ` at ${img.crop.left},${img.crop.top} · wrote ${img.width}x${img.height}` +
      ` ${(readFileSync(OUT).length / 1024).toFixed(0)} KB`,
  );
}
