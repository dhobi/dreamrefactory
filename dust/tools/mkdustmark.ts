/**
 * Make `dust/public/dust-mark.png` — the small mark for Dust's top bar and its
 * favicon — out of the title card's own skull.
 *
 *   npm run mkdustmark [-- <width>]
 *
 * The title card is 2048px of wide lettering with a desert behind it: at 30px in
 * a bar it is an orange smear, and as a favicon it is nothing at all. Titanic's
 * mark is its globe alone for the same reason, and the project's is its wireframe
 * globe alone.
 *
 * The skull in the cowboy hat is the one element that reads at that size — it is
 * the highest-contrast thing in the artwork and it is unmistakably this game. It
 * lives in the left fifth, so the crop asks for that FRACTION rather than a pixel
 * rectangle and lets the alpha trim tighten onto the skull itself
 * (tools/logo-resize.ts). No measuring, and it survives the artwork being
 * re-exported at another size.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { encodePNG } from "../../tools/png";
import { resizeLogo } from "../../tools/logo-resize";

const SRC = fileURLToPath(new URL("../assets/dust-full.png", import.meta.url));
const OUT = fileURLToPath(new URL("../public/dust-mark.png", import.meta.url));

/** 128 for a 30px bar and a 32px tab: enough for hidpi in both, and tiny either way */
const DEFAULT_WIDTH = 128;

const width = Number(process.argv[2] ?? DEFAULT_WIDTH);
const img = resizeLogo(new Uint8Array(readFileSync(SRC)), {
  width,
  trim: "alpha",
  /*
   * The hat and skull, and not the bandana tail below them or the "D" beside
   * them. A fifth of the width caught the letter's edge and a star; the bandana
   * made it twice as tall as wide, which letterboxes to nothing in a favicon.
   * This is the head: wide enough for the brim, deep enough for the horns.
   */
  crop: { left: 0.005, top: 0.02, width: 0.181, height: 0.74 },
});
writeFileSync(OUT, encodePNG(img.rgba, img.width, img.height, { compress: true }));
console.log(
  `dust mark: ${img.crop.width}x${img.crop.height} of ${img.source.width}x${img.source.height}` +
    ` -> ${img.width}x${img.height} ${(readFileSync(OUT).length / 1024).toFixed(0)} KB`,
);
