/**
 * Supplied cover art, trimmed to the cover and baked as a page asset.
 *
 *   npx tsx taoot/bedsit/tools/bedsitmags.ts <out dir> <name>[:l,t,r,b]=<file> [...]
 *
 * The optional `:l,t,r,b` is an INSET, in fractions of the trimmed artwork,
 * taken after the ground is trimmed away. It is for art that comes back with a
 * frame drawn around it: the desk's four standing photographs were asked for as
 * photographs and three of the four arrived already framed, in gilt or in
 * stained wood, with a drop shadow. None of that can be used. This room lights
 * its pictures with its own lamps and `plate()` builds the moulding as real
 * geometry that takes that light, so a painted frame would be a second frame
 * inside the first, lit from nowhere, and on two of the four it would be the
 * wrong shape as well — the game has those two in OVALS. So the inset cuts the
 * art back to the photograph, and the frame around it stays something the room
 * builds and lights.
 *
 * Each pair says which supplied file carries which magazine — `mag-peek=/tmp/
 * art/whatever.jpeg` — because the art arrives named by whatever made it, and
 * `Gemini_Generated_Image_8l8q....jpeg` beside a sibling with ` (1)` on it says
 * nothing about which cover is in which. Taking them in sort order was tried
 * and put PEEK on BRAVE NEW WORLD, silently and plausibly, which is exactly the
 * kind of mistake that survives a look at the room.
 *
 * The desk's magazines are photographic covers, and {@link file://./bedsitcards.ts}
 * cuts them out of the film that shows them flat — two hundred pixels across,
 * dithered into a 256-colour palette, and with the left margin of BRAVE NEW
 * WORLD lost off the edge of its own close-up. That is a reference, not a
 * texture. What goes on the desk is that reference enlarged and re-set
 * somewhere else and handed back, exactly as the wall pictures were in
 * {@link file://./bedsitpics.ts}.
 *
 * What comes back is a PRODUCT SHOT: the cover sitting on a flat grey ground
 * with a soft drop shadow under it, because that is what an image generator
 * makes when you ask it for a magazine. None of that ground belongs on a
 * magazine lying on a desk — the room's own lamp lights the thing, and a baked
 * shadow under it would be a second shadow crossing the first. So this trims
 * the art down to the cover's own four edges and bakes what is left.
 *
 * The trim finds the cover rather than being told where it is. The supplied
 * ground is FLAT — one colour, no grain — so the corner pixel is the ground's
 * colour exactly, and a column belongs to the cover as soon as it holds enough
 * pixels far enough off that colour. `EDGE` is what "far enough" means and is
 * set well above the drop shadow's darkest step: a shadow is the ground minus a
 * little, and a cover is a photograph. `RUN` is "enough", and is there because
 * a generator will happily put a speck of dust on the ground.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { chromium } from "playwright";

/** how far off the ground's own colour a pixel has to be to be cover, 0..255 */
const EDGE = 48;
/** how many such pixels a row or column needs before it counts as cover */
const RUN = 8;
/**
 * The baked asset's side — SQUARE, and a POWER OF TWO, which is not a
 * preference.
 *
 * The room is WebGL1, and there a texture that is not a power of two in both
 * directions cannot have mipmaps and cannot wrap. `upload` in
 * {@link file://../src/bedsit-page.ts} asks for both, on every material alike,
 * and the answer for a non-power-of-two texture is not an error: the texture is
 * incomplete and every sample of it comes back BLACK. A 659x900 cover would
 * have gone on the desk as a black rectangle. Every other picture in the room —
 * the album, the quarterly, the ship's atlas — is a square power of two, and
 * this is why.
 *
 * Squaring a portrait cover squashes it, and nothing is lost by that: the quad
 * pins the picture's four corners to its own, so the cover comes back out at
 * the magazine's aspect however it was stored. All the squash costs is where
 * the texels go, and 512 across a cover 300 units long is more of them than the
 * surface can show from anywhere a person stands.
 */
const SIDE = 512;

/**
 * The trim, as SOURCE rather than as a function.
 *
 * `tsx` compiles this file with esbuild's `keepNames` on, which wraps every
 * function it can see — including the ones inside a `page.evaluate` callback —
 * in a `__name` helper that exists in this process and not in the browser. A
 * callback written the ordinary way therefore throws `__name is not defined`
 * the moment it runs. Handing Playwright the text of the function instead puts
 * it beyond the compiler's reach, which is the whole trick.
 *
 * It is handed over as a COMPLETE EXPRESSION — the function and its argument
 * both — rather than as a string plus an `arg`, because Playwright evaluates a
 * string as an expression and has no argument to give it: passing one silently
 * yields `undefined` instead of an error.
 */
const TRIM = `async ({ data, mime, EDGE, RUN, SIDE, inset }) => {
  const img = new Image();
  img.src = "data:" + mime + ";base64," + data;
  await img.decode();
  const W = img.naturalWidth, H = img.naturalHeight;
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const g = c.getContext("2d");
  g.drawImage(img, 0, 0);
  const px = g.getImageData(0, 0, W, H).data;
  // the ground's colour, from a corner it is guaranteed to own
  const g0 = px[0], g1 = px[1], g2 = px[2];
  const off = (x, y) => {
    const o = (y * W + x) * 4;
    return Math.max(Math.abs(px[o] - g0), Math.abs(px[o + 1] - g1), Math.abs(px[o + 2] - g2)) > EDGE;
  };
  const colHit = (x) => { let n = 0; for (let y = 0; y < H; y++) if (off(x, y) && ++n >= RUN) return true; return false; };
  const rowHit = (y) => { let n = 0; for (let x = 0; x < W; x++) if (off(x, y) && ++n >= RUN) return true; return false; };
  let x0 = 0, x1 = W - 1, y0 = 0, y1 = H - 1;
  while (x0 < x1 && !colHit(x0)) x0++;
  while (x1 > x0 && !colHit(x1)) x1--;
  while (y0 < y1 && !rowHit(y0)) y0++;
  while (y1 > y0 && !rowHit(y1)) y1--;
  let cw = x1 - x0 + 1, ch = y1 - y0 + 1;
  // the inset, in fractions of what the trim left
  const ix = x0 + inset[0] * cw, iy = y0 + inset[1] * ch;
  const iw = (inset[2] - inset[0]) * cw, ih = (inset[3] - inset[1]) * ch;
  x0 = Math.round(ix); y0 = Math.round(iy); cw = Math.round(iw); ch = Math.round(ih);
  const o = document.createElement("canvas");
  o.width = SIDE; o.height = SIDE;
  const og = o.getContext("2d");
  og.imageSmoothingQuality = "high";
  og.drawImage(c, x0, y0, cw, ch, 0, 0, SIDE, SIDE);
  return { jpeg: o.toDataURL("image/jpeg", 0.9).split(",")[1], W, H, x0, y0, cw, ch, w: o.width, h: o.height, ground: [g0, g1, g2] };
}`;

const ARGS = process.argv.slice(2);
const OUT = ARGS[0];
const PAIRS = ARGS.slice(1).map((a) => {
  const at = a.indexOf("=");
  if (at < 0) return null;
  const [name, spec] = a.slice(0, at).split(":");
  const inset = spec ? spec.split(",").map(Number) : [0, 0, 1, 1];
  if (inset.length !== 4 || inset.some((n) => !Number.isFinite(n))) return null;
  return { name, inset, file: a.slice(at + 1) };
});
if (!OUT || !PAIRS.length || PAIRS.some((p) => !p)) {
  console.error("usage: npx tsx taoot/bedsit/tools/bedsitmags.ts <out dir> <name>=<file> [...]");
  process.exit(2);
}

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage();

for (const { name, inset, file } of PAIRS as { name: string; inset: number[]; file: string }[]) {
  const data = readFileSync(file).toString("base64");
  const mime = /\.png$/i.test(file) ? "image/png" : "image/jpeg";
  const call = `(${TRIM})(${JSON.stringify({ data, mime, EDGE, RUN, SIDE, inset })})`;
  const out = (await page.evaluate(call)) as {
    jpeg: string; W: number; H: number; x0: number; y0: number;
    cw: number; ch: number; w: number; h: number; ground: number[];
  };
  const dest = join(OUT, `${name}.jpg`);
  const bytes = Buffer.from(out.jpeg, "base64");
  writeFileSync(dest, bytes);
  console.log(
    `${name.padEnd(21)} ${basename(file)}\n` +
    `  ${out.W}x${out.H} on ground rgb ${out.ground.join(",")}` +
    ` -> art at ${out.x0},${out.y0} ${out.cw}x${out.ch}` +
    ` -> ${out.w}x${out.h}  ${Math.round(bytes.length / 1024)} KB`,
  );
}

await browser.close();
