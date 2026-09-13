/**
 * The rug on the bedsit's floor, out of a photograph of one.
 *
 *   npx tsx taoot/tools/bedsitrug.ts [out.jpg]
 *
 * `bedsit-rug-original.avif` is a shop's photograph of a rug — a distressed
 * blue-and-rust Persian, laid flat and shot square on a white ground. Three
 * things have to happen to it before it can be a floor.
 *
 * **The white has to go.** It is a product shot, so the rug sits in a field of
 * paper with a soft shadow under it. The crop is found rather than typed: the
 * rows and columns that hold anything darker or more coloured than the paper
 * are the rug, and the box round them is the picture.
 *
 * **It has to be turned and cut to the room's rug.** The photograph is portrait
 * and 1 : 1.27; `RUG` in `bedsit-paint.ts` is 4,650 across by 4,300 along, which
 * is 1.08 : 1. Turned a quarter and cut down the middle to that ratio it keeps
 * five sixths of the weave and none of it is stretched — which matters, because
 * a stretched pile reads as a stretched rug from any standing height. The
 * fringes at the two short ends go with the cut, and they were never visible:
 * the near end of this rug is under the armchair and the far end under the
 * desk.
 *
 * **It has to become an albedo.** A shop photographs a rug under a big soft
 * light to sell it, so the picture is a good deal brighter and cleaner than the
 * cloth: the room's own lamps are then asked to light something that is already
 * lit, and it comes out as a rug with a light inside it. `TONE` takes it back
 * down to a reflectance, measured the way the other cloths in the room were —
 * against the frames' own floor, which reads 0.30 of the boards around it.
 *
 * The decode is a browser's, like `bedsitsky.ts` — there is no image library in
 * this repo and a JPEG decoder is not worth writing twice.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = process.argv[2] ?? join(HERE, "../../public/bedsit/rug.jpg");
/** the shop's own file, in whatever it came down as — the decode is a browser's,
 *  so AVIF is as readable here as JPEG and neither needs converting first */
const SRC = ["bedsit-rug-original.avif", "bedsit-rug-original.jpg"]
  .map((f) => join(HERE, f)).find((f) => existsSync(f));
if (!SRC) throw new Error("no bedsit-rug-original.avif or .jpg beside this tool");
const MIME = SRC.endsWith(".avif") ? "image/avif" : "image/jpeg";
const img = readFileSync(SRC).toString("base64");

/** the room's rug, from `RUG` in `bedsit-paint.ts`: across by along */
const ASPECT = 4650 / 4300;
/** the width the texture is written at; the height follows the aspect */
const WIDE = 1024;
/** how far inside the found box to cut, as a share of each side */
const INSET = 0.02;
/**
 * What the photograph has to be multiplied by to be a reflectance.
 *
 * The shop's light is not the room's. Measured off the picture: its rug means
 * 0.42 of white, and a worn wool rug on a boarded floor in the frames means
 * about 0.30 of the boards beside it, which are themselves 0.36. So the cloth
 * wants to come down by about a quarter, and its highlights — the paper's
 * bounce along the top edge — by more than that, which is what the second
 * number does: a gentle shoulder that holds the darks and pulls the brights.
 */
const TONE = { gain: 0.78, shoulder: 0.72 };

const { chromium } = await import("playwright");
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 1200 } });
page.on("console", (m) => console.error("page:", m.text()));
await page.setContent("<canvas id=c width=1200 height=1200></canvas>");

const out = (await page.evaluate(`(async () => {
  const im = new Image(); im.src = "data:${MIME};base64,${img}"; await im.decode();
  const W = im.naturalWidth, H = im.naturalHeight;
  const c = document.getElementById("c").getContext("2d");
  c.drawImage(im, 0, 0);
  const o = c.getImageData(0, 0, W, H).data;

  // -- where the rug is -----------------------------------------------------
  // The paper is bright and grey; the rug is neither. A pixel counts as rug if
  // it is dark enough OR coloured enough, and a row or column counts if a
  // fortieth of it does — which ignores the shadow's fringe and the odd speck.
  const isRug = (i) => {
    const r = o[i], g = o[i+1], b = o[i+2];
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    return mx < 216 || mx - mn > 26;
  };
  const rows = new Int32Array(H), cols = new Int32Array(W);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (isRug((y * W + x) * 4)) { rows[y]++; cols[x]++; }
  }
  const span = (n, a, need) => {
    let lo = 0, hi = n - 1;
    while (lo < n && a[lo] < need) lo++;
    while (hi > lo && a[hi] < need) hi--;
    return [lo, hi];
  };
  // A sixth, not a fortieth: a row that is nine tenths paper and one tenth the
  // rug's own soft shadow is not the rug, and taking it leaves a pale rule down
  // the edge of the floor. The inset after it is for the last pixel or two the
  // JPEG smears out of the boundary, which no threshold can separate.
  let [y0, y1] = span(H, rows, W / 6), [x0, x1] = span(W, cols, H / 6);
  const inset = (a, b) => {
    const k = Math.round((b - a + 1) * ${INSET});
    return [a + k, b - k];
  };
  [x0, x1] = inset(x0, x1); [y0, y1] = inset(y0, y1);
  const cw = x1 - x0 + 1, ch = y1 - y0 + 1;

  // -- turned a quarter, and cut to the room's rug --------------------------
  // The turn is a quarter clockwise: the photograph's long side becomes the
  // room rug's long side, which runs across the room. After it, the crop is
  // (ch x cw); the room wants ASPECT, so the longer of the two is trimmed
  // evenly at both ends.
  const A = ${ASPECT};
  let tw = ch, th = cw;                       // the turned crop
  let sw = tw, sh = th;
  if (tw / th > A) sw = Math.round(th * A); else sh = Math.round(tw / A);
  const ox = Math.round((tw - sw) / 2), oy = Math.round((th - sh) / 2);

  const OW = ${WIDE}, OH = Math.round(${WIDE} / A);
  const d = c.createImageData(OW, OH);
  const q = d.data;
  for (let y = 0; y < OH; y++) for (let x = 0; x < OW; x++) {
    // back through the crop, the turn and into the photograph, bilinear
    const u = ox + (x + 0.5) * sw / OW, v = oy + (y + 0.5) * sh / OH;
    const px = x0 + v, py = y0 + (ch - u);    // the quarter turn, undone
    const fx = Math.max(0, Math.min(cw - 1.001, px - x0)) + x0;
    const fy = Math.max(0, Math.min(ch - 1.001, py - y0)) + y0;
    const ix = Math.floor(fx), iy = Math.floor(fy), ax = fx - ix, ay = fy - iy;
    const at = (X, Y, k) => o[((Y * W) + X) * 4 + k];
    for (let k = 0; k < 3; k++) {
      const t = at(ix, iy, k) * (1-ax) * (1-ay) + at(ix+1, iy, k) * ax * (1-ay)
              + at(ix, iy+1, k) * (1-ax) * ay + at(ix+1, iy+1, k) * ax * ay;
      // to a reflectance: a gain, and a shoulder that holds the darks
      const n = t / 255;
      const s = n <= 0 ? 0 : Math.pow(n, 1 / ${TONE.shoulder});
      q[(y * OW + x) * 4 + k] = Math.round(255 * Math.max(0, Math.min(1, s * ${TONE.gain})));
    }
    q[(y * OW + x) * 4 + 3] = 255;
  }
  const cv = document.createElement("canvas");
  cv.width = OW; cv.height = OH;
  cv.getContext("2d").putImageData(d, 0, 0);
  return { crop: [x0, y0, x1, y1], size: [OW, OH],
           jpg: cv.toDataURL("image/jpeg", 0.92).split(",")[1] };
})()`)) as { crop: number[]; size: number[]; jpg: string };

await browser.close();
writeFileSync(OUT, Buffer.from(out.jpg, "base64"));
console.log(`  rug found at x ${out.crop[0]}..${out.crop[2]}  y ${out.crop[1]}..${out.crop[3]}`);
console.log(`  ${OUT}  ${out.size[0]}x${out.size[1]}`);
