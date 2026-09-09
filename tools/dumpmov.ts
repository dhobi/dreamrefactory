/**
 * A MOV's frames as PNGs, or as one contact sheet.
 *
 *   npx tsx tools/dumpmov.ts <file.mov> <out dir> [every] [--sheet]
 *
 * MOV files are the game's cutscenes and item close-ups, and a close-up is
 * often the ONLY good look at a thing the rooms show at forty pixels: the
 * bedsit's desk props, for one, are legible in `movies/bedpaper.mov` and
 * nowhere else. See {@link file://../engine/src/df/mov.ts} for the format.
 *
 * `every` writes one frame in N (default 1). `--sheet` writes a single
 * contact sheet instead, six frames to a row, so a film can be read at a
 * glance before any one frame of it is worth pulling out.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { readMovFile } from "@dreamfactory/engine/df/mov";
import { FrameBuffer, decodeFrame, indexedToRGBA, paletteToRGBA } from "@dreamfactory/engine/df/image";
import { encodePNG } from "./png";

const [FILE, OUT, EVERY_ARG, ...FLAGS] = process.argv.slice(2);
if (!FILE || !OUT) {
  console.error("usage: npx tsx tools/dumpmov.ts <file.mov> <out dir> [every] [--sheet]");
  process.exit(2);
}
const EVERY = Math.max(1, +(EVERY_ARG ?? 1) || 1);
const SHEET = FLAGS.includes("--sheet") || EVERY_ARG === "--sheet";
const stem = basename(FILE).replace(/\.mov$/i, "");

const mov = readMovFile(new Uint8Array(readFileSync(FILE)));
mkdirSync(OUT, { recursive: true });

/** one segment's frames, decoded in order — they are deltas and cannot be
 *  decoded any other way */
function pictures(segIdx: number): { rgba: Uint8ClampedArray; w: number; h: number; name: string }[] {
  const seg = mov.segments[segIdx];
  const palette = paletteToRGBA(seg.paletteRaw, 256, mov.file.order);
  const fb = new FrameBuffer();
  const out: { rgba: Uint8ClampedArray; w: number; h: number; name: string }[] = [];
  let shown: Uint8Array | null = null;
  for (const f of seg.frames) {
    const d = decodeFrame(mov.file.containers[f.locationFrame].data, fb, mov.file.order);
    const pixels = fb.pixels.slice(0, d.width * d.height);
    // a v1 film's frames are composited over the one before, its 0 and 0xff
    // pixels keyed out; the game's own blit does this and so must anything
    // that wants to see what the game showed
    if (seg.dfV1 && shown) for (let i = 0; i < pixels.length; i++) if (pixels[i] === 0 || pixels[i] === 0xff) pixels[i] = shown[i];
    if (seg.dfV1) shown = pixels;
    out.push({ rgba: indexedToRGBA(pixels, d.width, d.height, palette), w: d.width, h: d.height, name: f.name });
  }
  return out;
}

for (const [i, seg] of mov.segments.entries()) {
  const shots = pictures(i);
  const tag = mov.segments.length > 1 ? `-s${i}` : "";
  console.log(`${stem}${tag}: ${shots.length} frames, ${seg.width}×${seg.height}${seg.dfV1 ? ", v1" : ""}`);
  if (!shots.length) continue;
  if (SHEET) {
    const kept = shots.filter((_, k) => k % EVERY === 0);
    const cols = Math.min(6, kept.length), rows = Math.ceil(kept.length / cols);
    const w = Math.max(...kept.map((s) => s.w)), h = Math.max(...kept.map((s) => s.h));
    const W = cols * w, H = rows * h, sheet = new Uint8ClampedArray(W * H * 4);
    kept.forEach((s, k) => {
      const ox = (k % cols) * w, oy = Math.floor(k / cols) * h;
      for (let y = 0; y < s.h; y++) {
        const from = y * s.w * 4, to = ((oy + y) * W + ox) * 4;
        sheet.set(s.rgba.subarray(from, from + s.w * 4), to);
      }
    });
    const file = join(OUT, `${stem}${tag}.png`);
    writeFileSync(file, encodePNG(sheet, W, H, { compress: true }));
    console.log(`  ${file}  ${cols}×${rows} of ${w}×${h}`);
  } else {
    for (const [k, s] of shots.entries()) {
      if (k % EVERY) continue;
      const file = join(OUT, `${stem}${tag}-${String(k).padStart(3, "0")}.png`);
      writeFileSync(file, encodePNG(s.rgba, s.w, s.h, { compress: true }));
    }
    console.log(`  ${Math.ceil(shots.length / EVERY)} written to ${OUT}`);
  }
}
