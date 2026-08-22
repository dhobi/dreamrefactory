/**
 * Build `nightdive.mov` — an animated GIF turned into a DreamFactory movie, with
 * the ownership question after it.
 *
 *   npm run mknightdive -- heading-gif.gif        # writes public/nightdive.mov
 *   npm run mknightdive -- heading-gif.gif out/   # somewhere else
 *
 * Two halves, and they are the two halves a MOV can be (docs/engine/formats/mov.md):
 *
 *  - **Segment 0 is the film** — every GIF frame, scaled into the 512×384 screen
 *    and paced by the delay the GIF itself authored. A cutscene is the degenerate
 *    state machine: each frame steps to the next, and the last one exits.
 *  - **Segment 1 is the question** — one frame that parks with two click regions,
 *    YES and NO, each a goto into a frame the movie's own header nominates as an
 *    ACTION FRAME. That is how the answer leaves the movie: not through a hook
 *    the page reached in and installed, but through `actionframe(1)`/`(2)`, the
 *    same channel the purser's window uses to tell a script you knocked. See
 *    taoot/src/nightdive.ts, which reads it back.
 *
 * The film is somebody else's art, so this generator does NOT ship its input and
 * the file it writes is not in the repository (`.gitignore`) — the same line
 * `gamefiles/` sits on. What is committed is this program and the question, which
 * are ours. That is also why the GIF is an argument rather than a constant: point
 * it at another animation and you get another intro.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
// RELATIVE, not `@dreamfactory/engine/...` like everywhere else. This module is
// reached from vite.config.ts (the `nightdive-movie` plugin), and Vite loads its
// config by bundling it under NODE — where a bare specifier is left external and
// resolved by Node's ESM loader, which cannot follow the engine's extensionless
// `./build` imports and has no idea what a .ts file is. A relative import stays
// inside the config bundle, so Vite's own resolver handles the whole graph.
// The rule: anything vite.config.ts can reach imports the engine relatively.
import { buildMovBytes, MovBuildFrame, MovBuildSegment } from "../../engine/src/df/mov-build";
import { readMovFile } from "../../engine/src/df/mov";
import { SCREEN_H, SCREEN_W } from "@dreamfactory/engine/web/screen";
import { decodeGif, GifFrame, GifImage } from "../../tools/gif";
import { Canvas, drawTextCentered, fillRect, strokeRect } from "../../tools/pixelart";

/** the file the play page looks for, beside lang.stg */
const OUT_NAME = "nightdive.mov";

/** one engine tick, the unit a MOV's frame holds are counted in (60 a second) */
const TICKS_PER_SECOND = 60;

// ---------------------------------------------------------------------------
// Colour: a GIF frame is RGB, a MOV frame is one byte per pixel
// ---------------------------------------------------------------------------

/**
 * Index 0 renders black and 255 white no matter what the table says
 * (`paletteToRGBA` forces both, mirroring dfet), so both ends are spoken for and
 * the quantiser gets the 254 slots between them.
 */
const FIRST_SLOT = 1;
const LAST_SLOT = 254;

/**
 * The four slots at the top of the table that the film does not get, because the
 * question is drawn ON the film's last frame and both need to be the same picture.
 *
 * A segment carries its own palette, so the question could have had all 256 to
 * itself — but then its background could only have been a colour, not the logo
 * still under it. One table shared by both segments is what lets the question be
 * an overlay rather than a screen of its own.
 */
const UI_SLOTS = 4;

/** an RGB triple packed into one number, which is what a histogram keys on */
const pack = (r: number, g: number, b: number): number => (r << 16) | (g << 8) | b;

/**
 * Median cut: pick `want` colours that cover an image's colours evenly.
 *
 * Repeatedly take the box with the most pixels in it, and split it across its
 * widest colour channel at the point that halves its POPULATION — not its
 * extent, which would spend slots on a handful of outliers and leave a face with
 * three shades. Each surviving box becomes the average of what it holds, weighted
 * by how often each colour actually occurs.
 */
function medianCut(histogram: Map<number, number>, want: number): number[] {
  interface Box {
    colors: number[];
    pixels: number;
  }
  const all = [...histogram.keys()];
  let boxes: Box[] = [{ colors: all, pixels: [...histogram.values()].reduce((a, b) => a + b, 0) }];

  while (boxes.length < want) {
    // the busiest box that can still be cut
    let target = -1;
    for (let i = 0; i < boxes.length; i++) {
      if (boxes[i].colors.length < 2) continue;
      if (target < 0 || boxes[i].pixels > boxes[target].pixels) target = i;
    }
    if (target < 0) break;

    const box = boxes[target];
    const lo = [255, 255, 255];
    const hi = [0, 0, 0];
    for (const c of box.colors) {
      const rgb = [(c >> 16) & 0xff, (c >> 8) & 0xff, c & 0xff];
      for (let ch = 0; ch < 3; ch++) {
        if (rgb[ch] < lo[ch]) lo[ch] = rgb[ch];
        if (rgb[ch] > hi[ch]) hi[ch] = rgb[ch];
      }
    }
    let channel = 0;
    for (let ch = 1; ch < 3; ch++) if (hi[ch] - lo[ch] > hi[channel] - lo[channel]) channel = ch;
    const shift = 16 - channel * 8;
    const sorted = [...box.colors].sort((a, b) => ((a >> shift) & 0xff) - ((b >> shift) & 0xff));

    // split where half the PIXELS are behind us
    let half = 0;
    let cut = 0;
    for (; cut < sorted.length - 1; cut++) {
      half += histogram.get(sorted[cut])!;
      if (half * 2 >= box.pixels) break;
    }
    const left = sorted.slice(0, cut + 1);
    const right = sorted.slice(cut + 1);
    const count = (cs: number[]): number => cs.reduce((a, c) => a + histogram.get(c)!, 0);
    boxes = boxes.filter((_, i) => i !== target);
    boxes.push({ colors: left, pixels: count(left) }, { colors: right, pixels: count(right) });
  }

  return boxes.map((box) => {
    let r = 0;
    let g = 0;
    let b = 0;
    let n = 0;
    for (const c of box.colors) {
      const w = histogram.get(c)!;
      r += ((c >> 16) & 0xff) * w;
      g += ((c >> 8) & 0xff) * w;
      b += (c & 0xff) * w;
      n += w;
    }
    return pack(Math.round(r / n), Math.round(g / n), Math.round(b / n));
  });
}

/** map an RGB colour to the nearest entry of a table, remembering the answer */
function nearestMapper(colors: number[], indexOf: number[]): (rgb: number) => number {
  const cache = new Map<number, number>();
  return (rgb: number): number => {
    const hit = cache.get(rgb);
    if (hit !== undefined) return hit;
    const r = (rgb >> 16) & 0xff;
    const g = (rgb >> 8) & 0xff;
    const b = rgb & 0xff;
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < colors.length; i++) {
      const dr = r - ((colors[i] >> 16) & 0xff);
      const dg = g - ((colors[i] >> 8) & 0xff);
      const db = b - (colors[i] & 0xff);
      const d = dr * dr + dg * dg + db * db;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    cache.set(rgb, indexOf[best]);
    return indexOf[best];
  };
}

// ---------------------------------------------------------------------------
// Geometry: a GIF is whatever size it is, a MOV frame is the screen
// ---------------------------------------------------------------------------

/**
 * Scale a frame to fit 512×384 and centre it, on black.
 *
 * Area-averaged rather than nearest-neighbour: 540×304 into 512 wide drops every
 * nineteenth column if you take the nearest source pixel, which on a title card
 * is a visibly ragged letter edge. Averaging invents colours the GIF's own table
 * does not hold, which is exactly why the palette is quantised from the SCALED
 * frames further down rather than lifted out of the file.
 *
 * The bars it leaves cost almost nothing: a row of one colour is a couple of
 * bytes of run in the frame codec, whatever its width.
 */
function fitToScreen(frame: GifFrame, srcW: number, srcH: number): Float32Array {
  const scale = Math.min(SCREEN_W / srcW, SCREEN_H / srcH);
  const drawW = Math.max(1, Math.round(srcW * scale));
  const drawH = Math.max(1, Math.round(srcH * scale));
  const x0 = Math.round((SCREEN_W - drawW) / 2);
  const y0 = Math.round((SCREEN_H - drawH) / 2);
  const out = new Float32Array(SCREEN_W * SCREEN_H * 3);
  const stepX = srcW / drawW;
  const stepY = srcH / drawH;

  for (let y = 0; y < drawH; y++) {
    const sy0 = Math.floor(y * stepY);
    const sy1 = Math.max(sy0 + 1, Math.min(srcH, Math.floor((y + 1) * stepY)));
    for (let x = 0; x < drawW; x++) {
      const sx0 = Math.floor(x * stepX);
      const sx1 = Math.max(sx0 + 1, Math.min(srcW, Math.floor((x + 1) * stepX)));
      let r = 0;
      let g = 0;
      let b = 0;
      let n = 0;
      for (let sy = sy0; sy < sy1; sy++) {
        for (let sx = sx0; sx < sx1; sx++) {
          const s = (sy * srcW + sx) * 4;
          // a transparent GIF pixel is a black one here: there is nothing behind
          // the film to show through, and alpha has no place in a 256-colour frame
          const a = frame.rgba[s + 3] / 255;
          r += frame.rgba[s] * a;
          g += frame.rgba[s + 1] * a;
          b += frame.rgba[s + 2] * a;
          n++;
        }
      }
      const o = ((y0 + y) * SCREEN_W + x0 + x) * 3;
      out[o] = r / n;
      out[o + 1] = g / n;
      out[o + 2] = b / n;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Segment 0: the film
// ---------------------------------------------------------------------------

/**
 * A GIF as a self-paced cutscene.
 *
 * Every frame carries a type-6 STEP and the last a type-1 EXIT, which is not
 * decoration: the port reads "does this segment step anywhere?" as "is this film
 * on a clock at all" (`chooseFrameInterval` — a region-less segment that never
 * steps is a close-up waiting for a click, and would sit on frame 0 forever).
 * How FAST is then the authored holds and nothing else.
 *
 * Those holds go in as a floor plus exceptions: the GIF's most common delay
 * becomes the segment's frame rate (header +0x1c) and only the frames that
 * disagree with it pay for a hold of their own. An animation with one delay
 * throughout — most of them — comes out with the floor and no per-frame timing at
 * all, which is how the shipped films are authored too.
 */
function filmSegment(gif: GifImage): MovBuildSegment & { seconds: number; logoFrame: Uint8Array } {
  const scaled = gif.frames.map((f) => fitToScreen(f, gif.width, gif.height));

  // the palette, quantised from the SCALED frames (scaling invents colours)
  const histogram = new Map<number, number>();
  for (const f of scaled) {
    for (let i = 0; i < f.length; i += 3) {
      const key = pack(Math.round(f[i]), Math.round(f[i + 1]), Math.round(f[i + 2]));
      histogram.set(key, (histogram.get(key) ?? 0) + 1);
    }
  }
  // All 254 slots, because quantising harder does not buy anything — MEASURED,
  // and the opposite of what the frame codec suggests. A frame is stored as runs
  // (docs/engine/formats/image-codec.md), so the instinct is that fewer colours mean
  // longer runs and a smaller file; on this card it goes 5.62 MB at 250 colours
  // to 5.43 MB at FOUR. The cost is not the colour count but the source's dither,
  // which is a spatial pattern: neighbouring pixels alternate between two shades
  // whatever table you map them through, and a run cannot cover an alternation.
  // So take the picture, and spend the size on something that shows.
  const want = LAST_SLOT - FIRST_SLOT + 1 - UI_SLOTS;
  const colors = histogram.size <= want ? [...histogram.keys()] : medianCut(histogram, want);
  const palette = uiPalette();
  colors.forEach((c, i) => {
    const at = (FIRST_SLOT + i) * 3;
    palette[at] = (c >> 16) & 0xff;
    palette[at + 1] = (c >> 8) & 0xff;
    palette[at + 2] = c & 0xff;
  });
  const toIndex = nearestMapper(
    colors,
    colors.map((_, i) => FIRST_SLOT + i),
  );

  // pure black is the letterbox, and it has to land on slot 0 rather than on
  // whatever dark colour the quantiser happened to keep
  const BLACK = pack(0, 0, 0);

  const art = scaled.map((f) => {
    const px = new Uint8Array(SCREEN_W * SCREEN_H);
    for (let i = 0, p = 0; i < f.length; i += 3, p++) {
      const rgb = pack(Math.round(f[i]), Math.round(f[i + 1]), Math.round(f[i + 2]));
      px[p] = rgb === BLACK ? 0 : toIndex(rgb);
    }
    return px;
  });

  // the GIF's timing: centiseconds per frame, in engine ticks. A file that states
  // no delay at all means "as fast as you can", which no engine should take
  // literally — 10 cs is what browsers settle such a GIF at.
  const DEFAULT_CS = 10;
  const ticks = gif.frames.map((f) =>
    Math.max(1, Math.round(((f.delayCs || DEFAULT_CS) / 100) * TICKS_PER_SECOND)),
  );
  const tally = new Map<number, number>();
  for (const t of ticks) tally.set(t, (tally.get(t) ?? 0) + 1);
  const floor = [...tally].sort((a, b) => b[1] - a[1])[0][0];

  /**
   * The frame the question is asked over: the last one the logo is fully up in.
   *
   * Not `art.at(-1)`, which on this card is four frames into a fade to black —
   * the animation ends on nothing, and a question asked over nothing is the plain
   * screen this used to draw. "Fully up" is measured rather than typed in: the
   * last frame within 5% of the brightest, which on the Nightdive card is frame
   * 65 of 70 (it holds from 48 to 65, then fades over the last four).
   */
  const brightness = scaled.map((f) => {
    let sum = 0;
    for (let i = 0; i < f.length; i += 3) sum += f[i] * 0.2126 + f[i + 1] * 0.7152 + f[i + 2] * 0.0722;
    return sum / (f.length / 3);
  });
  const peak = Math.max(...brightness);
  const logoAt = brightness.reduce((best, v, i) => (v >= peak * 0.95 ? i : best), 0);

  const frames: MovBuildFrame[] = art.map((pixels, i) => ({
    name: `f${i}`,
    art: pixels,
    // 6 steps to the next frame; the last frame's 1 ends the segment, which is
    // what hands the screen to the question
    type: i === art.length - 1 ? 1 : 6,
    holdTicks: ticks[i] === floor ? 0 : ticks[i],
  }));

  return {
    palette,
    width: SCREEN_W,
    height: SCREEN_H,
    frames,
    minHoldTicks: floor,
    // ESC presses past the film, as it presses past every shipped movie — but
    // only as far as the question segment, which carries no skip flag of its own
    keySkips: true,
    seconds: ticks.reduce((a, t) => a + Math.max(t, floor), 0) / TICKS_PER_SECOND,
    logoFrame: art[logoAt],
  };
}

// ---------------------------------------------------------------------------
// Segment 1: the question
// ---------------------------------------------------------------------------

/**
 * The four colours the question is drawn in, in the four slots the film gave up
 * ({@link UI_SLOTS}) — the site's own, the ones the language chooser is drawn in.
 * Ice for anything you can click, frost for what is being asked.
 */
const C = {
  /** slot 0 renders black whatever the table says, which is what a shadow wants */
  shadow: 0,
  plate: 251,
  accent: 252,
  label: 253,
  title: 254,
} as const;

function uiPalette(): Uint8Array {
  const p = new Uint8Array(256 * 3);
  const set = (i: number, rgb: readonly number[]): void => {
    p[i * 3] = rgb[0];
    p[i * 3 + 1] = rgb[1];
    p[i * 3 + 2] = rgb[2];
  };
  set(C.plate, [0x00, 0x0d, 0x1f]); // abyss800
  set(C.accent, [0x60, 0xc0, 0xf0]); // ice400
  set(C.label, [0xcc, 0xe4, 0xfc]); // ice100
  set(C.title, [0xe4, 0xf0, 0xfc]); // frost
  set(255, [255, 255, 255]); // slot 255 says white itself rather than relying on the forcing
  return p;
}

/** a button: where it is drawn, and therefore where it is clickable */
interface Button {
  label: string;
  /** the frame a click jumps to — and, being an action frame, the answer */
  target: string;
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * The question sits low, under the picture rather than across it: the logo has
 * the middle of the frame and the last quarter is the dark water it fades into,
 * which is where there is room to ask something.
 */
const ASK_Y = 274;
const BUTTON = { w: 150, h: 44, gap: 40, top: 318 } as const;

function buttons(): Button[] {
  const totalW = BUTTON.w * 2 + BUTTON.gap;
  const left0 = Math.round((SCREEN_W - totalW) / 2);
  return [
    { label: "YES", target: "yes", left: left0, top: BUTTON.top, width: BUTTON.w, height: BUTTON.h },
    {
      label: "NO",
      target: "gog",
      left: left0 + BUTTON.w + BUTTON.gap,
      top: BUTTON.top,
      width: BUTTON.w,
      height: BUTTON.h,
    },
  ];
}

/**
 * Text with a black copy behind it, one pixel down and right.
 *
 * The background here is a picture, not a panel, so nothing can be assumed about
 * what is behind any given letter. A shadow is what makes light text legible over
 * an unknown field, and it is what the chooser's own title does over the globe.
 */
function drawLabel(c: Canvas, text: string, y: number, color: number, scale: number): void {
  drawTextCentered(c, text, SCREEN_W / 2 + scale, y + scale, C.shadow, scale);
  drawTextCentered(c, text, SCREEN_W / 2, y, color, scale);
}

/** the frame that waits: the question and the two plates, over the held logo */
function askArt(background: Uint8Array): Canvas {
  const c: Canvas = { pixels: background.slice(), width: SCREEN_W, height: SCREEN_H };
  drawLabel(c, "DO YOU OWN THE GAME?", ASK_Y, C.title, 3);
  for (const b of buttons()) {
    // opaque plates: a button drawn as an outline alone would have the film's
    // grain running through its label
    fillRect(c, b.left, b.top, b.width, b.height, C.plate);
    strokeRect(c, b.left, b.top, b.width, b.height, C.accent);
    drawTextCentered(c, b.label, b.left + b.width / 2, b.top + Math.round((b.height - 8 * 3) / 2), C.label, 3);
  }
  return c;
}

/** what each answer says on its way out, over the same held logo */
function answerArt(background: Uint8Array, line: string): Canvas {
  const c: Canvas = { pixels: background.slice(), width: SCREEN_W, height: SCREEN_H };
  drawLabel(c, line, ASK_Y, C.title, 3);
  return c;
}

/**
 * The question as a movie segment.
 *
 * Frame "ask" carries regions and therefore WAITS — a frame with a region table
 * is the format's modal pause, and the port parks on it until a click lands
 * inside one. Both regions are a type-2 goto, and both destinations are named in
 * the segment header's two action-frame slots, so entering one records
 * `actionframe(1)` or `(2)` for whoever asks afterwards. The answer frames hold
 * for a beat and then exit; this is the last segment, so their exit ends the
 * movie and unblocks the play.
 *
 * Every frame of it is the film's own last lit frame with something drawn on top,
 * which is why this takes the palette rather than making one: the question is an
 * overlay on the logo, and an overlay cannot re-colour what it sits on.
 */
function questionSegment(palette: Uint8Array, background: Uint8Array): MovBuildSegment {
  const HOLD = TICKS_PER_SECOND; // one second on the answer before the movie goes
  return {
    palette,
    width: SCREEN_W,
    height: SCREEN_H,
    minHoldTicks: 3,
    actionFrames: ["yes", "gog"],
    // No skip flag: the question has to be ANSWERED. ESC pressed over the film
    // lands here (MoviePlayer.escapeSkipsSegment) and then stops working, so the
    // only ways on are the two buttons — which is issue #171, where ESC took the
    // question with the film and booted the game unasked.
    keySkips: false,
    frames: [
      {
        name: "ask",
        art: askArt(background).pixels,
        regions: buttons().map((b) => ({
          type: 2,
          target: b.target,
          top: b.top,
          left: b.left,
          bottom: b.top + b.height,
          right: b.left + b.width,
        })),
      },
      {
        name: "yes",
        art: answerArt(background, "WELCOME ABOARD").pixels,
        type: 1,
        holdTicks: HOLD,
      },
      {
        name: "gog",
        art: answerArt(background, "OPENING GOG.COM").pixels,
        type: 1,
        holdTicks: HOLD,
      },
    ],
  };
}

// ---------------------------------------------------------------------------

/**
 * The whole movie: an animation, then the question over its last lit frame.
 *
 * Exported so the suite can build one from a GIF it makes up rather than from an
 * animation the repository does not ship (taoot/tests/auto/nightdive.ts).
 */
export function buildNightdiveMov(gif: GifImage): { bytes: Uint8Array; seconds: number } {
  const { seconds, logoFrame, ...film } = filmSegment(gif);
  return {
    bytes: buildMovBytes({
      ...film,
      segments: [questionSegment(film.palette as Uint8Array, logoFrame)],
    }),
    seconds,
  };
}

/**
 * The film's SOURCE, and where the build puts what it compiles it into.
 *
 * The GIF is NightDive's own heading animation, tracked because it is a source
 * this repository cannot re-derive; the MOV is generated and gitignored, the way
 * `dist/` is. `public/` because that is the directory Vite copies verbatim into
 * `dist/` **and** the one `tools/manifest.ts` scans for authored DF files — the
 * film has to be listed in `gamefiles.json` or the page cannot find it
 * ({@link FileStore.urlFor} resolves through the manifest, not by guessing a URL).
 */
// this package's own, resolved from the file: a build runs from taoot/ and an
// `npm run mknightdive` from the repository root
export const NIGHTDIVE_GIF = fileURLToPath(new URL("../assets/nightdive.gif", import.meta.url));
export const NIGHTDIVE_OUT = fileURLToPath(new URL(`../public/${OUT_NAME}`, import.meta.url));

/**
 * Compile the GIF into the film, and report it the way the CLI does.
 *
 * Shared with the Vite plugin that keeps `public/nightdive.mov` up to date (see
 * vite.config.ts), so a build and a hand-run produce the same bytes by
 * construction rather than by two programs agreeing.
 */
export function writeNightdiveMov(
  gifPath = NIGHTDIVE_GIF,
  out = NIGHTDIVE_OUT,
): { bytes: number; summary: string } {
  const { bytes, seconds } = buildNightdiveMov(decodeGif(new Uint8Array(readFileSync(gifPath))));
  writeFileSync(out, bytes);

  // read it back through the engine's own reader, which is the only check worth
  // printing: a file this program is happy with but readMovFile is not is a file
  // the game cannot play
  const mov = readMovFile(bytes);
  return {
    bytes: bytes.length,
    summary:
      `${out}: ${(bytes.length / 1024 / 1024).toFixed(2)} MB, ${mov.segments.length} segments\n` +
      `  film     ${basename(gifPath)} -> ${mov.frames.length} frames, ` +
      `${seconds.toFixed(1)} s at ${(TICKS_PER_SECOND / mov.minHoldTicks).toFixed(1)} fps\n` +
      `  question ${mov.segments[1].frames.length} frames, ` +
      `${mov.segments[1].frames[0].regions.length} regions, ` +
      `action frames "${mov.segments[1].actionFrame1}" / "${mov.segments[1].actionFrame2}"` +
      `, ESC ${mov.segments[1].keySkips ? "skips it" : "does NOT skip it"}`,
  };
}

function main(): void {
  const [gifArg, outArg] = process.argv.slice(2);
  const gifPath = gifArg ?? NIGHTDIVE_GIF;
  const out = outArg
    ? outArg.endsWith(".mov")
      ? outArg
      : (mkdirSync(outArg, { recursive: true }), join(outArg, OUT_NAME))
    : NIGHTDIVE_OUT;
  console.log(writeNightdiveMov(gifPath, out).summary);
}

// a build script when run, a module when imported — the suite wants the builder
// (same shape as taoot/tools/mklangstg.ts)
if (process.argv[1] && basename(process.argv[1]).startsWith("mknightdive")) main();
