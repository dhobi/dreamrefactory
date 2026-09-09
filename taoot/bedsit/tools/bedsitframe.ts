/**
 * A picture supplied from outside, cut to its frame and hung on a bedsit wall.
 *
 *   npx tsx taoot/bedsit/tools/bedsitframe.ts <in> <picture id> [out dir]
 *       [--box x0,y0,x1,y1] [--inner x0,y0,x1,y1] [--flip] [--mono]
 *       [--into plate.jpg --window x0,y0,x1,y1]
 *
 * {@link file://./bedsitpics.ts} `draw` rebuilds the three big pictures from
 * their own bakes. This is the other way in: a picture that arrives whole —
 * found, photographed or generated — and has to be made to fit a rectangle that
 * was measured off the plaster years before it existed.
 *
 * Three things have to happen to it, and only the first is obvious.
 *
 * **The frame is part of the picture.** `photo` and `painting` carry a `frame`
 * in {@link PICTURES} and the room builds moulding round them in geometry; the
 * four in the armchair's corner do not. Their chart runs edge-to-edge of the
 * whole framed object, so whatever hangs there has to supply its own frame, and
 * the crop is to the frame's OUTER edge, not to the picture inside it. This
 * finds that edge by walking in from the border until the rows stop looking
 * like the wall behind them.
 *
 * **The aspect is not negotiable.** The rectangle is measured — three views
 * agree on it — so a picture that does not have that shape is cropped to it
 * about its centre rather than squashed into it.
 *
 * **The frame is usually the wrong wood.** `--inner` names the picture's own
 * edge inside the moulding, and everything between that and the crop is taken
 * down to near-black — grain and all, so it still reads as wood rather than as
 * a painted border. A supplied picture arrives in whatever frame its source had;
 * the room's frames were measured off the plaster and are dark.
 *
 * **Or it may be going into a frame that already exists.** `--into` takes a
 * plate already in `public/` and `--window` the rectangle inside its frame, and
 * the supplied picture is fitted to THAT rather than to the wall's rectangle.
 * Everything outside the window survives untouched, which is the point: the
 * three big pictures were drawn by `bedsitpics.ts`, frames and all, and a better
 * photograph of what one of them depicts should replace the depiction and not
 * the frame someone drew round it.
 *
 * **It may need mirroring.** `--flip` does it. A chart's `u` runs along the wall
 * in the room's own axis, and for the two walls whose normal points back down
 * that axis the texture arrives handed the other way — which is invisible on a
 * rug and obvious on a face.
 *
 * **It has to become ALBEDO.** A supplied picture is usually already lit: it has
 * a light source in it, and its darks are dark because someone put them there.
 * The room lights it AGAIN, so hung as it arrives it renders near-black. The
 * plates written here are toned the way the drawn ones are — as ink and paper
 * rather than as a dim photograph — and the room's lamp does the rest.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PICTURES } from "../src/bedsit-room";

/**
 * The one picture hung this way so far, and the numbers it wanted. The source is
 * {@link file://./bedsitframe-portrait.webp}, kept here for the same reason
 * `bedsitpics.ts` keeps its Churchill photograph: the plate in `public/` cannot
 * be rebuilt from itself.
 *
 *   npx tsx taoot/bedsit/tools/bedsitframe.ts \
 *     taoot/bedsit/tools/bedsitframe-portrait.webp portrait \
 *     --box 205,130,830,878 --inner 281,202,742,806 --flip --mono
 *
 * And the print on the fireplace wall, from
 * {@link file://./bedsitframe-print.jpg}:
 *
 *   npx tsx taoot/bedsit/tools/bedsitframe.ts \\
 *     taoot/bedsit/tools/bedsitframe-print.jpg print \\
 *     --box 147,208,994,783 --inner 161,222,980,769 --gamma 1.18 --floor 12
 *
 * That one is a painting with no moulding at all, and its own shape (1.27) is
 * not the wall's (1.47), so `--box` is a crop of the PICTURE at the measured
 * aspect and `--inner` takes fourteen pixels off each edge of it as the frame.
 * It carries no `--flip`, and that is not a guess: on the fireplace wall the
 * chart's `u0` edge lands on the LEFT of every frame that sees it, and on the
 * window wall it lands on the RIGHT. The two walls are handed oppositely, so
 * exactly one of these two pictures needs mirroring.
 *
 * And the family group beside it, from
 * {@link file://./bedsitframe-sketch.jpg}:
 *
 *   npx tsx taoot/bedsit/tools/bedsitframe.ts \\
 *     taoot/bedsit/tools/bedsitframe-sketch.jpg sketch \\
 *     --box 182,109,894,672 --inner 196,133,880,648 --gamma 1.18 --floor 12
 *
 * That one arrives in a good dark frame with a gilt fillet, and the crop still
 * cannot keep it: the photograph is 1.45 and the wall wants 1.264, so width has
 * to go. The box is therefore taken TALL — through the frame's top and bottom
 * bands, which costs nothing since they are darkened anyway — and pushed right,
 * so the infant at that edge stays whole. `--inner` sits inside the fillet
 * rather than outside it: four pixels of error there and a gold line survives
 * along the top of an otherwise black frame.
 *
 * `--mono` there because it arrived in colour and hangs a metre from a
 * monochrome family photograph: two prints on one wall want to be the same kind
 * of print, and a colour one beside a toned one reads as the mistake.
 *
 * And the officer behind the lamp, from
 * {@link file://./bedsitframe-hidden.jpg}:
 *
 *   npx tsx taoot/bedsit/tools/bedsitframe.ts \\
 *     taoot/bedsit/tools/bedsitframe-hidden.jpg hidden \\
 *     --box 200,199,562,592 --inner 208,207,554,584 --gamma 1.18 --floor 12
 *
 * The hardest crop of the four: a full-length portrait at 0.60 into a rectangle
 * that wants 0.921, so two fifths of its height goes. The box is anchored to the
 * TOP of the picture rather than centred — a centred crop cuts the face — and it
 * starts at the picture's own edge (200, 199), just inside a row of gilt beading
 * that runs along y 190..198 and would otherwise survive the darkening as a
 * bright rule.
 *
 * Its border is EIGHT pixels where the others take fourteen, and that is not a
 * whim: the band has to be the same width ON THE WALL, not in the file. These
 * three hang side by side, and their boxes are 848, 713 and 363 pixels wide for
 * rectangles of 640, 556 and 464 units — so fourteen pixels is 10.6 units on the
 * print, 10.9 on the family group and would be 17.9 here. Eight gives 10.2, and
 * the three frames read as one wall.
 *
 * The two big ones on the other walls were replaced later, and neither wanted a
 * frame from the tool. The painting over the mantel already had one, drawn by
 * `bedsitpics.ts` — and that board grains with `Math.random`, so re-running it
 * would not give the same frame back. It is kept as
 * {@link file://./bedsitframe-painting-frame.jpg} and written into:
 *
 *   npx tsx taoot/bedsit/tools/bedsitframe.ts \\
 *     taoot/bedsit/tools/bedsitframe-painting.jpg painting \\
 *     --into taoot/bedsit/tools/bedsitframe-painting-frame.jpg \\
 *     --window 57,57,1042,731 --gamma 1.18 --floor 12
 *
 * The poster has no frame at all — it is paper pinned to plaster, and its
 * measured rectangle is the PRINTED area, not the sheet. So the box is the ink's
 * own edge, found by looking for saturation rather than for a wall: the mount it
 * was photographed on and the paper margin round the design are both neutral,
 * and the design is not.
 *
 *   npx tsx taoot/bedsit/tools/bedsitframe.ts \\
 *     taoot/bedsit/tools/bedsitframe-poster.jpg poster --box 67,44,812,1134 \\
 *     --gamma 0.85 --floor 4 --white 225
 *
 * The poster is the one plate here toned DOWN rather than up, and the only one
 * whose gamma is under 1. Everything else on these walls is a photograph or a
 * print in a frame, in the dim half of the room; this is flat poster ink on
 * bright plaster beside a window, and at the lift the others want it read as
 * bleached — its yellow going white, which is the giveaway that a LIFT is what
 * is wrong. A lift raises a low channel by more of its own value than a high
 * one, so a saturated colour loses the gap between its channels. Gamma under 1
 * puts the gap back, and the white point at 225 takes the whole thing down
 * without touching it again.
 *
 * Neither takes `--flip`: the counter wall and the fireplace wall are handed the
 * same way, and only the window wall is not.
 *
 * All five of those carry `--gamma 1.18 --floor 12` and the portrait does not,
 * which is the one asymmetry here that is a JUDGEMENT and not a measurement.
 * The defaults were set on the portrait and the portrait still wears them; the
 * other five read as faded on the wall at that lift and were taken down. It is
 * not a coincidence that the odd one out is the monochrome one: `--mono`
 * flattens a picture to luminance and then tints it back, which costs contrast,
 * so it arrives at the toning already wanting more lift than a colour plate
 * that kept its own.
 *
 * `--box` is the moulding's outer edge and `--inner` the picture's own, both
 * read off the source and neither findable by the search below — the picture is
 * rendered on a textured wall, so there is no plain ground to walk in from. The
 * inner one was measured rather than eyeballed: a horizontal band through the
 * dark top of the picture is flat zero across the picture and jumps where the
 * bead starts, and sixteen pixels of error there leaves a gilt fillet down one
 * side of an otherwise black frame.
 */

/** a picture's measured rectangle: two of the four walls run along x, two along y */
interface Rect { x0?: number; x1?: number; y0?: number; y1?: number; z0: number; z1: number }

const ARGS = process.argv.slice(2);
/**
 * `--box x0,y0,x1,y1` overrides the search for the frame's outer edge.
 *
 * The search below walks in from the border until a line stops looking like the
 * ground behind it, which is right for a picture photographed against paper —
 * it is how `bedsitrug.ts` finds the rug. It cannot work on a picture rendered
 * ON a wall: the plaster is textured, so every border line differs from every
 * other, and the search finds the whole image. When the ground is not plain,
 * read the frame's corners off the image and pass them.
 */
const four = (flag: string): number[] | null => {
  const at = ARGS.indexOf(flag);
  if (at < 0) return null;
  const n = (ARGS[at + 1] ?? "").split(",").map(Number);
  if (n.length !== 4 || n.some((v) => !Number.isFinite(v))) {
    console.error(`${flag} wants four numbers: x0,y0,x1,y1`);
    process.exit(2);
  }
  return n;
};
/** one number, or the default if the flag is absent */
const num = (flag: string, fallback: number): number => {
  const at = ARGS.indexOf(flag);
  if (at < 0) return fallback;
  const v = Number(ARGS[at + 1]);
  if (!Number.isFinite(v)) {
    console.error(`${flag} wants a number`);
    process.exit(2);
  }
  return v;
};
const BOX = four("--box");
/** the picture's own edge inside the moulding; everything outside it, inside the
 *  crop, is frame and gets taken down to near-black */
const INNER = four("--inner");
const FLIP = ARGS.includes("--flip");
/** `--mono` takes the colour out and puts {@link MONO_TONE} back */
const MONO = ARGS.includes("--mono");
/** an existing plate to lay this picture into, keeping its frame */
const intoAt = ARGS.indexOf("--into");
const INTO = intoAt < 0 ? null : ARGS[intoAt + 1];
/** and the rectangle inside that plate's frame */
const WINDOW = four("--window");
if ((INTO === null) !== (WINDOW === null)) {
  console.error("--into and --window go together");
  process.exit(2);
}
const TAKES_VALUE = new Set(["--box", "--inner", "--into", "--window", "--gamma", "--floor", "--white"]);
const FLAGS = new Set(["--flip", "--mono"]);
const [IN, ID, OUT_ARG] = ARGS.filter(
  (a, i) => !TAKES_VALUE.has(a) && !TAKES_VALUE.has(ARGS[i - 1]) && !FLAGS.has(a));
// `proud` sits in PICTURES too and is a distance, not a rectangle
const RECT: Rect | undefined = ID === "proud" ? undefined : (PICTURES as unknown as Record<string, Rect>)[ID ?? ""];
if (!IN || !RECT) {
  console.error("usage: npx tsx taoot/bedsit/tools/bedsitframe.ts <in.png|jpg> <picture id> [out dir]");
  console.error(`  picture id is one of: ${Object.keys(PICTURES).filter((k) => k !== "proud").join(", ")}`);
  process.exit(2);
}
const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = OUT_ARG ?? join(HERE, "../../public/bedsit");
mkdirSync(OUT, { recursive: true });

/** the measured rectangle, in world units — the shape the plate has to be */
const wide = (RECT.x1 ?? RECT.y1!) - (RECT.x0 ?? RECT.y0!);
const tall = RECT.z1 - RECT.z0;
const ASPECT = wide / tall;
/** four times what the frames hold, as the drawn plates are */
const HEIGHT = 1024;

/** how far from the border's own colour a row has to be before it is the frame
 *  and not the wall behind it */
const WALL_TOLERANCE = 26;
/** and how much of a row has to differ before the row counts */
const ROW_SHARE = 0.12;
/** a hair inside the found edge, so no wall survives in the corners */
const INSET = 0.004;
/**
 * How much the shadows come up on the way to albedo, and how far off black the
 * darkest ink is allowed to sit. Both are overridable per picture — `--gamma`
 * and `--floor` — because there is no one right pair. A supplied picture is
 * lit already, the room lights it again, and how much lift it wants before the
 * lamp reaches it depends on how it was lit in the first place: a monochrome
 * print scanned flat wants more than a photograph taken at sunset.
 *
 * They are the two halves of "faded", and they fail differently. The gamma is
 * a midtone lift, so too much of it washes the middle of the picture out while
 * leaving the ends alone; the floor is a grey the blacks cannot go below, so
 * too much of it puts a haze over everything and no amount of gamma takes it
 * off again. Lower both together to take a plate down.
 */
const GAMMA = num("--gamma", 1.42);
const FLOOR = num("--floor", 26);
/**
 * `--white`: what the top of the opened range becomes, 255 by default.
 *
 * This is the third half of "faded", and it is the one that shows up as a
 * COLOUR fault rather than a brightness one. The levels stretch takes the
 * picture's brightest 0.3% to the top and the gamma then lifts everything
 * under it — but a lift raises a LOW channel by more of its own value than a
 * high one, so a saturated colour loses the gap between its channels and walks
 * toward white. The poster's yellow went that way: not merely bright, but pale,
 * because its blue channel was lifted hardest of the three.
 *
 * Bringing the white point down scales all three channels together, so the gap
 * survives. On the poster at gamma 0.85 over a floor of 4, a yellow that read
 * 246/157 in red and blue reads 216/112 — darker, and half again as saturated.
 */
const WHITE = num("--white", 255);
/** the frame, once it has been found: the band it is squeezed into, and how far
 *  its colour is pulled towards its own grey. Dark wood, not a black border —
 *  the grain has to survive or it reads as a drawn rectangle, but the band has
 *  to be narrow or a bright bead on the inner edge survives as a gilt fillet. */
const FRAME_FLOOR = 4;
const FRAME_SPAN = 20;
const FRAME_DESATURATE = 0.55;
/**
 * What a monochrome print on these walls is toned like, as each channel's share
 * of luminance. Measured off the family photograph in `sketch.jpg`, which
 * arrived as a warm-toned print and is what the other one has to sit beside:
 * a neutral grey next to it reads as the odd one out, not as the honest one.
 */
const MONO_TONE = [1.0641, 0.9855, 0.9066] as const;

const { chromium } = await import("playwright");
const browser = await chromium.launch();
const page = await browser.newPage();
page.on("pageerror", (e) => console.error("page:", e.message));
const src = readFileSync(IN).toString("base64");
const ext = /\.png$/i.test(IN) ? "png" : /\.webp$/i.test(IN) ? "webp" : "jpeg";
const into = INTO ? readFileSync(INTO).toString("base64") : "";
const intoExt = INTO && /\.png$/i.test(INTO) ? "png" : "jpeg";

// As a STRING and not a function, like `bedsitrug.ts`: tsx compiles this file
// with esbuild's `keepNames`, which wraps every named function in a `__name`
// helper that does not exist in the page, and a passed function arrives there
// referring to it.
// As a STRING and not a function, like `bedsitrug.ts`: tsx compiles this file
// with esbuild's `keepNames`, which wraps every named function in a `__name`
// helper that does not exist in the page, and a passed function arrives there
// referring to it.
const out = JSON.parse(await page.evaluate(`(async () => {
  const img = new Image();
  img.src = "data:image/${ext};base64,${src}";
  await img.decode();
  const W = img.naturalWidth, H = img.naturalHeight;
  const cv = document.createElement("canvas");
  cv.width = W; cv.height = H;
  const cx = cv.getContext("2d", { willReadFrequently: true });
  cx.drawImage(img, 0, 0);
  const px = cx.getImageData(0, 0, W, H).data;
  const at = (x, y) => { const k = (y * W + x) * 4; return [px[k], px[k + 1], px[k + 2]]; };

  // --- where the picture is in the source -------------------------------------
  const edge = [[], [], []];
  for (let x = 0; x < W; x += 2) for (const y of [0, 1, H - 2, H - 1]) {
    const c = at(x, y);
    for (let i = 0; i < 3; i++) edge[i].push(c[i]);
  }
  const wall = edge.map((a) => a.sort((p, q) => p - q)[a.length >> 1]);
  const differs = (c) => Math.abs(c[0] - wall[0]) + Math.abs(c[1] - wall[1]) + Math.abs(c[2] - wall[2]) > ${WALL_TOLERANCE};
  const colHit = (x) => { let n = 0; for (let y = 0; y < H; y += 2) if (differs(at(x, y))) n++; return n > (H / 2) * ${ROW_SHARE}; };
  const rowHit = (y) => { let n = 0; for (let x = 0; x < W; x += 2) if (differs(at(x, y))) n++; return n > (W / 2) * ${ROW_SHARE}; };
  const given = ${BOX ? JSON.stringify(BOX) : "null"};
  let x0 = 0, x1 = W - 1, y0 = 0, y1 = H - 1;
  if (given) { [x0, y0, x1, y1] = given; }
  else {
    while (x0 < x1 && !colHit(x0)) x0++;
    while (x1 > x0 && !colHit(x1)) x1--;
    while (y0 < y1 && !rowHit(y0)) y0++;
    while (y1 > y0 && !rowHit(y1)) y1--;
  }
  const found = { x0, y0, w: x1 - x0 + 1, h: y1 - y0 + 1, given: !!given };

  // --- the destination: a plate of our own, or a window in one that exists -----
  const win = ${WINDOW ? JSON.stringify(WINDOW) : "null"};
  let dst, dc, dw, dh, wx, wy, ww, wh;
  if (win) {
    const plate = new Image();
    plate.src = "data:image/${intoExt};base64,${into}";
    await plate.decode();
    dw = plate.naturalWidth; dh = plate.naturalHeight;
    dst = document.createElement("canvas"); dst.width = dw; dst.height = dh;
    dc = dst.getContext("2d", { willReadFrequently: true });
    dc.drawImage(plate, 0, 0);
    wx = win[0]; wy = win[1]; ww = win[2] - win[0] + 1; wh = win[3] - win[1] + 1;
  } else {
    dw = Math.round(${HEIGHT} * ${ASPECT}); dh = ${HEIGHT};
    dst = document.createElement("canvas"); dst.width = dw; dst.height = dh;
    dc = dst.getContext("2d", { willReadFrequently: true });
    wx = 0; wy = 0; ww = dw; wh = dh;
  }
  // the shape to fill is the window's, which is the wall rectangle's when we
  // built the plate ourselves
  const aspect = ww / wh;

  // in a touch, then to that shape about the centre
  const ix = found.w * ${INSET}, iy = found.h * ${INSET};
  let cw = found.w - 2 * ix, ch = found.h - 2 * iy;
  let ox = found.x0 + ix, oy = found.y0 + iy;
  if (cw / ch > aspect) { const k = ch * aspect; ox += (cw - k) / 2; cw = k; }
  else { const k = cw / aspect; oy += (ch - k) / 2; ch = k; }

  dc.imageSmoothingQuality = "high";
  const flip = ${FLIP ? "true" : "false"};
  if (flip && win) {
    // mirror the PICTURE inside the window; the frame round it must not move
    dc.save();
    dc.translate(wx + ww, wy); dc.scale(-1, 1);
    dc.drawImage(img, ox, oy, cw, ch, 0, 0, ww, wh);
    dc.restore();
  } else {
    dc.drawImage(img, ox, oy, cw, ch, wx, wy, ww, wh);
  }

  // --- and to albedo, over the picture only -----------------------------------
  const id = dc.getImageData(wx, wy, ww, wh);
  const d = id.data;
  if (${MONO ? "true" : "false"}) {
    for (let i = 0; i < d.length; i += 4) {
      const y = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      d[i] = d[i + 1] = d[i + 2] = y;
    }
  }
  const hist = new Uint32Array(256);
  for (let i = 0; i < d.length; i += 4) for (let c = 0; c < 3; c++) hist[d[i + c]]++;
  const n = ww * wh * 3;
  let lo = 0, hi = 255, acc = 0;
  for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= n * 0.003) { lo = v; break; } }
  acc = 0;
  for (let v = 255; v >= 0; v--) { acc += hist[v]; if (acc >= n * 0.003) { hi = v; break; } }
  for (let i = 0; i < d.length; i += 4) for (let c = 0; c < 3; c++) {
    const t = Math.max(0, Math.min(1, (d[i + c] - lo) / Math.max(1, hi - lo)));
    d[i + c] = Math.round(${FLOOR} + (${WHITE} - ${FLOOR}) * Math.pow(t, 1 / ${GAMMA}));
  }
  if (${MONO ? "true" : "false"}) {
    const tone = ${JSON.stringify(MONO_TONE)};
    for (let i = 0; i < d.length; i += 4) {
      for (let c = 0; c < 3; c++) d[i + c] = Math.min(255, Math.round(d[i + c] * tone[c]));
    }
  }

  // the moulding, taken down to dark wood — only when this plate's frame is the
  // source's own. A window in an existing plate already has one.
  const inner = ${INNER ? JSON.stringify(INNER) : "null"};
  if (inner && !win) {
    const sx = ww / cw, sy = wh / ch;
    const ax = (inner[0] - ox) * sx, ay = (inner[1] - oy) * sy;
    const bx = (inner[2] - ox) * sx, by = (inner[3] - oy) * sy;
    for (let y = 0; y < wh; y++) for (let x = 0; x < ww; x++) {
      if (x >= ax && x <= bx && y >= ay && y <= by) continue;
      const k = (y * ww + x) * 4;
      const grey = 0.299 * d[k] + 0.587 * d[k + 1] + 0.114 * d[k + 2];
      for (let c = 0; c < 3; c++) {
        const v = d[k + c] + (grey - d[k + c]) * ${FRAME_DESATURATE};
        d[k + c] = Math.round(${FRAME_FLOOR} + (v / 255) * ${FRAME_SPAN});
      }
    }
  }
  dc.putImageData(id, wx, wy);

  // and the mirror, last, so every box above stayed in the source's handedness.
  // Already done inside the window above when there is one.
  let out = dst;
  if (flip && !win) {
    out = document.createElement("canvas");
    out.width = dw; out.height = dh;
    const oc = out.getContext("2d");
    oc.translate(dw, 0); oc.scale(-1, 1);
    oc.drawImage(dst, 0, 0);
  }
  return JSON.stringify({
    jpeg: out.toDataURL("image/jpeg", 0.92).split(",")[1],
    src: { W, H }, found,
    crop: { ox: Math.round(ox), oy: Math.round(oy), cw: Math.round(cw), ch: Math.round(ch) },
    plate: { dw, dh }, window: { wx, wy, ww, wh }, levels: [lo, hi],
  });
})()`)) as {
  jpeg: string;
  src: { W: number; H: number };
  found: { x0: number; y0: number; w: number; h: number; given: boolean };
  crop: { ox: number; oy: number; cw: number; ch: number };
  plate: { dw: number; dh: number };
  window: { wx: number; wy: number; ww: number; wh: number };
  levels: [number, number];
};
await browser.close();

const file = join(OUT, `${ID}.jpg`);
const bytes = Buffer.from(out.jpeg, "base64");
writeFileSync(file, bytes);
console.log(`${IN}  ${out.src.W}×${out.src.H}`);
console.log(`  frame ${out.found.given ? "given" : "found"} at ${out.found.x0},${out.found.y0} ${out.found.w}×${out.found.h}`);
const shape = out.window.ww / out.window.wh;
console.log(`  cropped to    ${out.crop.ox},${out.crop.oy} ${out.crop.cw}×${out.crop.ch}  (aspect ${shape.toFixed(3)}, measured ${wide}×${tall} units = ${ASPECT.toFixed(3)})`);
if (INTO) console.log(`  laid into     ${INTO} at ${out.window.wx},${out.window.wy} ${out.window.ww}×${out.window.wh}, frame untouched`);
console.log(`  levels ${out.levels[0]}..${out.levels[1]} opened, toned to albedo at gamma ${GAMMA} over ${FLOOR}..${WHITE}`);
if (INNER) console.log(`  moulding outside ${INNER.join(",")} taken to ${FRAME_FLOOR}..${FRAME_FLOOR + FRAME_SPAN}`);
if (FLIP) console.log("  mirrored horizontally");
if (MONO) console.log(`  greyed, then toned ${MONO_TONE.join(" / ")} of luminance`);
console.log(`  → ${file}  ${out.plate.dw}×${out.plate.dh}, ${Math.round(bytes.length / 1024)} KB`);
