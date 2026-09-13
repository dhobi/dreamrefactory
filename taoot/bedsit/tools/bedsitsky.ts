/**
 * The street photograph: its painted smoke taken out, and its chimneys found.
 *
 *   npx tsx taoot/tools/bedsitsky.ts [out.jpg]
 *
 * The picture the bedsit's windows look out on (`bedsit-street-original.jpg`,
 * beside this file) has plumes painted into its sky, off the tall stacks on the
 * left, blown leftwards. The page now smokes the chimneys itself — see
 * `lightSmoke` in {@link file://../src/bedsit-page.ts} — and a live plume over
 * a painted one is two winds over one city. So this writes two things:
 *
 * - `taoot/public/bedsit-street.jpg`, the picture with a clean sky;
 * - on stdout, the CHIMNEYS table for bedsit-page.ts, since a plume that does
 *   not stand on its own chimney is worse than no plume at all, and the mouths
 *   are not something to read off a screenshot by eye.
 *
 * **Clearing the sky.** Inside the rectangles below, every pixel that is sky —
 * everything above the chimneys named below, whose tops were read off the
 * picture — is dropped and made again. What is solved for is not the pixel but
 * its difference from the sky's own tone in that row: each such difference
 * becomes the mean of its four neighbours, iterated, held at the rectangle's
 * edges by the sky around them and left free along the rooflines under them,
 * and the row's tone goes back on at the end. Solved that way the mend keeps
 * the haze that brightens every row towards the roofs, and being harmonic it
 * meets its boundary exactly, so there is no seam to find. The picture's own
 * grain, high-passed off a clean band of sky higher up, goes over the top.
 *
 * **Finding the chimneys.** On the MENDED picture, since a painted plume is
 * darker than the sky and stands over a chimney, and reads as a chimney a
 * hundred pixels tall. For each column, the topmost run of four pixels clearly
 * darker than the sky's own tone is the top of whatever stands there; a wide
 * percentile of those tops is the roofline behind it. A column standing well
 * clear of its roofline is a chimney, runs of such columns are one chimney, and
 * chimneys within a few pixels of each other are one cluster of pots and get
 * ONE plume between them. What is too wide or too tall to be a flue is a tower
 * — the dome, the clock, the red brick tower — and is cut. Inside the mended
 * rectangles the named chimneys are used instead: they are exact.
 *
 * `DEBUG=1` paints the mask instead of mending: magenta for what will be made
 * again, green for the sky it may read, and everything else untouched.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = process.argv[2] ?? join(HERE, "../../public/bedsit/street.jpg");
const img = readFileSync(join(HERE, "bedsit-street-original.jpg")).toString("base64");

/**
 * Where the painted smoke is. Generous, because a harmonic fill leaves no edge
 * to find: what these say is "this rectangle of sky is to be made again".
 */
const SKIES = [
  { x0: 0, y0: 140, x1: 350, y1: 352, dy: -110 },
  { x0: 300, y0: 170, x1: 645, y1: 372, dy: -130 },
];
/**
 * And what stands in that sky and must survive it: every chimney whose top is
 * inside a rectangle above, as `[x0, x1, top]` — the columns it occupies, and
 * the row its cap is on. Tight to the silhouette: a column too many and the
 * bright halo a JPEG puts beside a hard edge is kept along with the flue, and
 * stands there on the mended sky as a pale stripe. Nothing in these two rectangles is anything else; the
 * roofs they sit on are all below.
 *
 * Read off the picture rather than found by a rule. Four rules were tried —
 * darkness, sharpness, runs that reach the roofs, runs joined across the gaps
 * — and each one that took out the plumes also took out a chimney, or kept a
 * ragged piece of plume standing on a mouth, because a plume's flank IS a hard
 * vertical edge in the places where these ones happen to fall. Fourteen
 * numbers are better than a rule that is wrong twice.
 */
const KEEPS: readonly (readonly [number, number, number])[] = [
  [171, 190, 287],   // the works, its two tall stacks
  [202, 221, 264],
  [275, 290, 299],
  [324, 336, 315],
  [387, 398, 329],
  [417, 441, 320],
  [469, 499, 342],
  [529, 545, 349],
  [548, 574, 344],
  [588, 600, 338],
  [610, 625, 336],
];
const { chromium } = await import("playwright");
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1774, height: 887 } });
page.on("console", (m) => console.error("page:", m.text()));
await page.setContent("<canvas id=c width=1774 height=887></canvas>");
/** what the page hands back: the mended picture, and the chimneys in it */
type Stack = { x0: number; x1: number; top: number; rise: number };
const out = (await page.evaluate(`(async () => {
  const im = new Image(); im.src = "data:image/jpeg;base64,${img}"; await im.decode();
  const W = 1774, H = 887, SKY = 660;
  const c = document.getElementById("c").getContext("2d");
  c.drawImage(im, 0, 0);
  const d = c.getImageData(0, 0, W, H);
  const o = d.data;
  const L = new Float32Array(W * SKY);
  for (let i = 0; i < W * SKY; i++) L[i] = 0.299 * o[i*4] + 0.587 * o[i*4+1] + 0.114 * o[i*4+2];

  // -- the sky's own tone, row by row ---------------------------------------
  // A high percentile over a wide window: what the sky is doing there, with the
  // dark buildings and anything narrower than the window left out of it. Taken
  // every eighth column and interpolated between, since a sky does not change
  // faster than that, and per channel, because it will be SUBTRACTED before
  // the mending and added back after: the mending is then of the difference
  // from the sky's own tone, and so it keeps the haze that brightens every row
  // towards the roofs instead of flattening the lot.
  const R = 150, STEP = 8;
  const bgc = [0, 1, 2].map(() => new Float32Array(W * SKY));
  for (let y = 0; y < SKY; y++) {
    for (let ch = 0; ch < 3; ch++) {
      const marks = [];
      for (let x = 0; x < W + STEP; x += STEP) {
        const at = Math.min(x, W - 1);
        const a = Math.max(0, at - R), b = Math.min(W, at + R + 1), v = [];
        for (let xx = a; xx < b; xx += 3) v.push(o[(y * W + xx) * 4 + ch]);
        v.sort((p, q) => p - q);
        marks.push(v[Math.floor(v.length * 0.72)]);
      }
      for (let x = 0; x < W; x++) {
        const i = x / STEP, k = Math.floor(i), f = i - k;
        bgc[ch][y * W + x] = marks[k] * (1 - f) + marks[Math.min(k + 1, marks.length - 1)] * f;
      }
    }
  }
  const bg = new Float32Array(W * SKY);
  for (let i = 0; i < W * SKY; i++) bg[i] = 0.299 * bgc[0][i] + 0.587 * bgc[1][i] + 0.114 * bgc[2][i];

  // -- what stands in that sky --------------------------------------------
  // the chimneys named above, and nothing else: everything else in these two
  // rectangles is either sky or the smoke that is being taken out of it
  const keeps = ${JSON.stringify(KEEPS)};
  const roof = new Int32Array(W).fill(SKY);
  for (const [kx0, kx1, top] of keeps) {
    // the columns given are a hint: the flue is the DARK ones among them, a
    // dozen rows under its cap. The rest is the bright halo a JPEG leaves
    // beside a hard edge, and kept, that halo stands on the mended sky as a
    // pale stripe the width of the mistake.
    const row = top + 12;
    for (let x = kx0; x <= kx1; x++) if (L[row * W + x] - bg[row * W + x] < -35) roof[x] = Math.min(roof[x], top);
  }

  // -- the sky, made again ---------------------------------------------------
  const skies = ${JSON.stringify(SKIES)};
  const debug = ${process.env.DEBUG === "1"};
  const fill = new Uint8Array(W * SKY);       // what is being made again
  const isSky = new Uint8Array(W * SKY);      // and what may be read as sky
  // a chimney and everything under it is never touched; the rectangles' own
  // bottom edges keep the fill off the roofs
  for (let y = 0; y < SKY; y++) for (let x = 0; x < W; x++) if (y < roof[x] - 2) isSky[y * W + x] = 1;
  for (const s of skies) for (let y = s.y0; y < Math.min(s.y1, SKY); y++) for (let x = s.x0; x < s.x1; x++) if (isSky[y * W + x]) fill[y * W + x] = 1;
  if (debug) {
    for (let y = 0; y < SKY; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (fill[i]) { o[i*4] = 255; o[i*4+2] = 255; o[i*4+1] *= 0.4; }
      else if (isSky[i]) { o[i*4+1] = Math.min(255, o[i*4+1] + 40); }
    }
    c.putImageData(d, 0, 0);
    return { stacks: [], jpeg: c.canvas.toDataURL("image/jpeg", 0.92).split(",")[1] };
  }
  // three channels, solved together; Gauss-Seidel, sweeping both ways, so a
  // wide patch fills from its edges in a reasonable number of passes
  const buf = [0, 1, 2].map((ch) => { const a = new Float32Array(W * SKY); for (let i = 0; i < W * SKY; i++) a[i] = o[i * 4 + ch] - bgc[ch][i]; return a; });
  for (let pass = 0; pass < 900; pass++) {
    const back = pass % 2 === 1;
    for (let yi = 0; yi < SKY; yi++) {
      const y = back ? SKY - 1 - yi : yi;
      for (let xi = 0; xi < W; xi++) {
        const x = back ? W - 1 - xi : xi;
        const i = y * W + x;
        if (!fill[i]) continue;
        let n = 0;
        const sum = [0, 0, 0];
        // a neighbour that is not sky — a roof, a stack — is no boundary at
        // all: the fill simply does not lean on it
        if (y > 0 && isSky[i - W]) { n++; for (let ch = 0; ch < 3; ch++) sum[ch] += buf[ch][i - W]; }
        if (y < SKY - 1 && isSky[i + W]) { n++; for (let ch = 0; ch < 3; ch++) sum[ch] += buf[ch][i + W]; }
        if (x > 0 && isSky[i - 1]) { n++; for (let ch = 0; ch < 3; ch++) sum[ch] += buf[ch][i - 1]; }
        if (x < W - 1 && isSky[i + 1]) { n++; for (let ch = 0; ch < 3; ch++) sum[ch] += buf[ch][i + 1]; }
        if (!n) continue;
        for (let ch = 0; ch < 3; ch++) buf[ch][i] = sum[ch] / n;
      }
    }
  }
  // the grain: the picture against a blur of itself, taken from clean sky above
  const b = document.createElement("canvas"); b.width = W; b.height = H;
  const bx = b.getContext("2d"); bx.filter = "blur(5px)"; bx.drawImage(im, 0, 0);
  const bl = bx.getImageData(0, 0, W, H).data;
  for (const s of skies) for (let y = s.y0; y < Math.min(s.y1, SKY); y++) for (let x = s.x0; x < s.x1; x++) {
    const i = y * W + x;
    if (!fill[i]) continue;
    const g = ((y + s.dy) * W + x) * 4;
    for (let ch = 0; ch < 3; ch++) {
      const grain = Math.max(-7, Math.min(7, (o[g + ch] - bl[g + ch]) * 0.8));
      o[i * 4 + ch] = Math.max(0, Math.min(255, buf[ch][i] + bgc[ch][i] + grain));
    }
  }
  c.putImageData(d, 0, 0);

  // -- the chimneys, off the CLEAN picture ------------------------------------
  // off the clean one, or a painted plume — which is darker than the sky, and
  // stands over a chimney — is itself read as a chimney a hundred pixels tall
  for (let i = 0; i < W * SKY; i++) L[i] = 0.299 * o[i*4] + 0.587 * o[i*4+1] + 0.114 * o[i*4+2];
  // the topmost run of four rows clearly darker than the sky's own tone in
  // those rows is the top of whatever stands in that column
  const flue = new Int32Array(W).fill(SKY);
  for (let x = 0; x < W; x++) for (let y = 2; y < SKY - 6; y++) {
    let dark = true;
    for (let k = 0; k < 4; k++) if (L[(y + k) * W + x] - bg[(y + k) * W + x] > -26) { dark = false; break; }
    if (dark) { flue[x] = y; break; }
  }
  const line = new Int32Array(W);
  for (let x = 0; x < W; x++) {
    const v = [];
    for (let xx = Math.max(0, x - 70); xx < Math.min(W, x + 71); xx++) v.push(flue[xx]);
    v.sort((p, q) => p - q);
    line[x] = v[Math.floor(v.length * 0.72)];
  }
  const runs = [];
  let run = null;
  for (let x = 0; x < W; x++) {
    const rise = line[x] - flue[x];
    if (rise > 7 && flue[x] < SKY - 20) {
      if (!run) run = { x0: x, x1: x, top: flue[x], rise };
      else { run.x1 = x; run.top = Math.min(run.top, flue[x]); run.rise = Math.max(run.rise, rise); }
    } else { if (run && run.x1 - run.x0 >= 1) runs.push(run); run = null; }
  }
  if (run) runs.push(run);
  // a tower is not a chimney: nothing this wide is a flue, and nothing this
  // tall either — the clock, the dome and the brick tower all stand clear of
  // their roofs by more than any flue in this city does
  const flues = runs.filter((r) => r.x1 - r.x0 <= 44 && r.rise <= 140);
  // and a terrace's pots are one chimney, not five
  const stacks = [];
  for (const f of flues) {
    const last = stacks[stacks.length - 1];
    if (last && f.x0 - last.x1 < 14 && f.x1 - last.x0 < 62) { last.x1 = f.x1; last.top = Math.min(last.top, f.top); last.rise = Math.max(last.rise, f.rise); }
    else stacks.push({ ...f });
  }

  // The chimneys in the two mended rectangles are the ones named by hand at
  // the top of this file, which are exact; the detector's business is the rest
  // of the picture, where nothing was mended and it has a clean sky to read.
  const mended = Math.max(...skies.map((s) => s.x1));
  const named = keeps.map(([kx0, kx1, top]) => ({ x0: kx0, x1: kx1, top, rise: line[Math.round((kx0 + kx1) / 2)] - top }));
  const all = [...named, ...stacks.filter((s) => s.x0 > mended)].sort((a, b) => a.x0 - b.x0);
  return { stacks: all, jpeg: c.canvas.toDataURL("image/jpeg", 0.92).split(",")[1] };
})()`)) as { stacks: Stack[]; jpeg: string };
await browser.close();

const bytes = Buffer.from(out.jpeg, "base64");
writeFileSync(OUT, bytes);
console.error(`${OUT}  ${Math.round(bytes.length / 1024)} KB`);

/** a plume for each: as wide as the stack is, near enough, and as strong as it
 *  stands proud — a works chimney is a hundred pixels of flue, a terrace's pots
 *  a dozen */
const rows = out.stacks.map((s) => {
  const width = s.x1 - s.x0 + 1;
  const w = Math.round(Math.max(44, Math.min(132, width * 3.0 + 30)));
  return {
    px: Math.round((s.x0 + s.x1) / 2), py: s.top,
    w, h: Math.round(w * 1.35),
    density: +Math.min(0.9, 0.34 + s.rise / 320).toFixed(2),
  };
});
console.log(`  // ${rows.length} of them, left to right, from bedsitsky.ts`);
for (const r of rows) console.log(`  { px: ${r.px}, py: ${r.py}, w: ${r.w}, h: ${r.h}, density: ${r.density} },`);
