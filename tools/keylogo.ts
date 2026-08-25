/**
 * A title card, out of artwork rendered on black.
 *
 *   npx tsx tools/keylogo.ts timelapse/assets/timelapse-full.png \
 *     timelapse/public/timelapse-logo.png --width 1200
 *
 * The two full-size logos in this repository are 1990s box renders: the subject
 * on a field of pure black, no alpha channel, two to three thousand pixels wide.
 * A web page wants the opposite of all three — a few hundred pixels, and a
 * TRANSPARENT ground, because the card is shown twice at two different sizes over
 * two different materials (centred on the page's own dark while the game boots,
 * then resting on the picture frame's lit rail afterwards) and a black rectangle
 * is only invisible over one of them.
 *
 * ## The key: coverage from the brightest channel, and no unpremultiplying
 *
 * Art composited over black carries its own coverage — an edge pixel at 40% is
 * simply 40% of the colour. So `max(r, g, b)` ramping across {@link KEY_LO} to
 * {@link KEY_HI} is the alpha, and the colour is left EXACTLY as the artist
 * rendered it.
 *
 * Reconstructing the unmultiplied colour is the textbook move here and it is
 * wrong for this input: dividing by that alpha cannot tell a dark COLOUR from a
 * thin one, and both logos are full of genuinely dark interior pixels (the shadow
 * inside Timelapse's letters is #090b24). Every one of them would be brightened
 * as though it were an edge. Leaving the colour alone instead costs a fringe of
 * at most KEY_HI/255 — a 7% darkening on a one-pixel line — which is the error
 * you cannot see, in place of one you can.
 *
 * The window is narrow on purpose. Wide enough and the whole picture goes
 * translucent; the range here only ever catches what is within a few levels of
 * the black it was rendered on.
 *
 * ## Then crop, then box-filter
 *
 * Cropping first is what makes the width argument mean something: the input's
 * black margin is not part of the picture, so scaling before the crop would spend
 * the budget on it. The downscale averages every source pixel that lands in a
 * destination pixel — a box filter, in PREMULTIPLIED space, which is the one
 * detail that matters: averaging straight colour with its alpha lets a
 * transparent pixel's colour vote, and a black transparent ground would darken
 * every edge in the picture on the way down.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { decodePNG, encodePNG } from "./png";

/** below this the ground is ground; above it the picture is the picture */
const KEY_LO = 4;
const KEY_HI = 18;

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const at = args.indexOf(name);
  return at < 0 ? undefined : args[at + 1];
};
const [inPath, outPath] = args.filter((a) => !a.startsWith("--") && args[args.indexOf(a) - 1]?.startsWith("--") !== true);
const width = Number(flag("--width") ?? 0);
if (!inPath || !outPath) throw new Error("usage: keylogo.ts <in.png> <out.png> [--width N]");

const src = decodePNG(readFileSync(inPath));
console.log(`${inPath}: ${src.width}x${src.height}`);

/** alpha for one pixel: how much of the ink is here */
const coverage = (r: number, g: number, b: number): number => {
  const m = Math.max(r, g, b);
  if (m <= KEY_LO) return 0;
  if (m >= KEY_HI) return 255;
  return Math.round((255 * (m - KEY_LO)) / (KEY_HI - KEY_LO));
};

/** premultiplied RGBA of the source, keyed */
const keyed = new Float64Array(src.width * src.height * 4);
let ink = 0;
let x0 = src.width;
let y0 = src.height;
let x1 = -1;
let y1 = -1;
for (let y = 0; y < src.height; y++) {
  for (let x = 0; x < src.width; x++) {
    const i = (y * src.width + x) * 4;
    const a = coverage(src.rgba[i], src.rgba[i + 1], src.rgba[i + 2]);
    if (!a) continue;
    ink++;
    if (x < x0) x0 = x;
    if (y < y0) y0 = y;
    if (x > x1) x1 = x;
    if (y > y1) y1 = y;
    // premultiplied: the colour is already coverage x colour, which is what the
    // artist's own composite over black means — see the header
    keyed[i] = src.rgba[i] * (a / 255);
    keyed[i + 1] = src.rgba[i + 1] * (a / 255);
    keyed[i + 2] = src.rgba[i + 2] * (a / 255);
    keyed[i + 3] = a;
  }
}
if (x1 < 0) throw new Error("every pixel keyed out: is this artwork on black?");
const cw = x1 - x0 + 1;
const ch = y1 - y0 + 1;
console.log(`ink ${ink} px (${((100 * ink) / (src.width * src.height)).toFixed(1)}%), bbox ${cw}x${ch} at ${x0},${y0}`);

const outW = width && width < cw ? width : cw;
const outH = Math.max(1, Math.round((ch * outW) / cw));
const scale = cw / outW;
const out = new Uint8ClampedArray(outW * outH * 4);
let semi = 0;
let clear = 0;
for (let y = 0; y < outH; y++) {
  // the source rows this destination row averages, at least one
  const sy0 = y0 + Math.floor(y * scale);
  const sy1 = Math.max(sy0 + 1, y0 + Math.floor((y + 1) * scale));
  for (let x = 0; x < outW; x++) {
    const sx0 = x0 + Math.floor(x * scale);
    const sx1 = Math.max(sx0 + 1, x0 + Math.floor((x + 1) * scale));
    let r = 0;
    let g = 0;
    let b = 0;
    let a = 0;
    let n = 0;
    for (let sy = sy0; sy < sy1; sy++) {
      for (let sx = sx0; sx < sx1; sx++) {
        const i = (sy * src.width + sx) * 4;
        r += keyed[i];
        g += keyed[i + 1];
        b += keyed[i + 2];
        a += keyed[i + 3];
        n++;
      }
    }
    const p = (y * outW + x) * 4;
    const alpha = a / n;
    out[p + 3] = Math.round(alpha);
    // back to straight colour for the file, which is what a PNG stores
    if (alpha > 0) {
      out[p] = Math.round((r / n) * (255 / alpha));
      out[p + 1] = Math.round((g / n) * (255 / alpha));
      out[p + 2] = Math.round((b / n) * (255 / alpha));
    }
    if (out[p + 3] === 0) clear++;
    else if (out[p + 3] < 255) semi++;
  }
}
const png = encodePNG(out, outW, outH);
writeFileSync(outPath, png);
console.log(
  `${outPath}: ${outW}x${outH}, ${(png.byteLength / 1024).toFixed(0)} KB — ` +
    `${clear} transparent, ${semi} partial, ${outW * outH - clear - semi} opaque`,
);
