/**
 * A 5×8 pixel font and the handful of drawing primitives an authored flat needs.
 *
 * Flat art is an indexed 512×384 image (one byte per pixel into the stage's own
 * palette), so "drawing" is writing bytes — no canvas, no font stack, nothing to
 * install. That keeps the generator (tools/mklangstg.ts) reproducible: the same
 * source produces the same bytes on any machine.
 *
 * The font is deliberately small: capitals, digits, a little punctuation and the
 * one accented capital the language list needs (Ç). Rendered at 2× or 3× it
 * reads like the period UI it sits next to, and anything more expressive belongs
 * in a PNG imported through the stage editor (docs/editors/stages.md) rather than
 * in more glyph data here.
 */

export const GLYPH_W = 5;
export const GLYPH_H = 8;

/**
 * One glyph per key, `#` on and `.` off, top row first. Rows 7-8 exist for the
 * things that hang below the baseline — a comma's tail, Ç's cedilla — so most
 * glyphs use six rows and leave the rest blank.
 */
const FONT: Record<string, string[]> = {
  " ": [".....", ".....", ".....", ".....", ".....", ".....", ".....", "....."],
  A: [".###.", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"],
  B: ["####.", "#...#", "#...#", "####.", "#...#", "#...#", "####."],
  C: [".###.", "#...#", "#....", "#....", "#....", "#...#", ".###."],
  D: ["####.", "#...#", "#...#", "#...#", "#...#", "#...#", "####."],
  E: ["#####", "#....", "#....", "####.", "#....", "#....", "#####"],
  F: ["#####", "#....", "#....", "####.", "#....", "#....", "#...."],
  G: [".###.", "#...#", "#....", "#.###", "#...#", "#...#", ".###."],
  H: ["#...#", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"],
  I: ["#####", "..#..", "..#..", "..#..", "..#..", "..#..", "#####"],
  J: ["..###", "...#.", "...#.", "...#.", "...#.", "#..#.", ".##.."],
  K: ["#...#", "#..#.", "#.#..", "##...", "#.#..", "#..#.", "#...#"],
  L: ["#....", "#....", "#....", "#....", "#....", "#....", "#####"],
  M: ["#...#", "##.##", "#.#.#", "#.#.#", "#...#", "#...#", "#...#"],
  N: ["#...#", "##..#", "#.#.#", "#..##", "#...#", "#...#", "#...#"],
  O: [".###.", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
  P: ["####.", "#...#", "#...#", "####.", "#....", "#....", "#...."],
  Q: [".###.", "#...#", "#...#", "#...#", "#.#.#", "#..#.", ".##.#"],
  R: ["####.", "#...#", "#...#", "####.", "#.#..", "#..#.", "#...#"],
  S: [".####", "#....", "#....", ".###.", "....#", "....#", "####."],
  T: ["#####", "..#..", "..#..", "..#..", "..#..", "..#..", "..#.."],
  U: ["#...#", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
  V: ["#...#", "#...#", "#...#", "#...#", "#...#", ".#.#.", "..#.."],
  W: ["#...#", "#...#", "#...#", "#.#.#", "#.#.#", "##.##", "#...#"],
  X: ["#...#", "#...#", ".#.#.", "..#..", ".#.#.", "#...#", "#...#"],
  Y: ["#...#", "#...#", ".#.#.", "..#..", "..#..", "..#..", "..#.."],
  Z: ["#####", "....#", "...#.", "..#..", ".#...", "#....", "#####"],
  // the cedilla hangs into the eighth row
  Ç: [".###.", "#...#", "#....", "#....", "#....", "#...#", ".###.", "..##."],
  "0": [".###.", "#...#", "#..##", "#.#.#", "##..#", "#...#", ".###."],
  "1": ["..#..", ".##..", "..#..", "..#..", "..#..", "..#..", ".###."],
  "2": [".###.", "#...#", "....#", "...#.", "..#..", ".#...", "#####"],
  "3": ["####.", "....#", "....#", ".###.", "....#", "....#", "####."],
  "4": ["...#.", "..##.", ".#.#.", "#..#.", "#####", "...#.", "...#."],
  "5": ["#####", "#....", "####.", "....#", "....#", "#...#", ".###."],
  "6": [".###.", "#...#", "#....", "####.", "#...#", "#...#", ".###."],
  "7": ["#####", "....#", "...#.", "..#..", ".#...", ".#...", ".#..."],
  "8": [".###.", "#...#", "#...#", ".###.", "#...#", "#...#", ".###."],
  "9": [".###.", "#...#", "#...#", ".####", "....#", "#...#", ".###."],
  ".": [".....", ".....", ".....", ".....", ".....", ".....", "..#.."],
  ",": [".....", ".....", ".....", ".....", ".....", "..#..", "..#..", ".#..."],
  "-": [".....", ".....", ".....", ".###.", ".....", ".....", "....."],
  ":": [".....", ".....", "..#..", ".....", ".....", "..#..", "....."],
  "?": [".###.", "#...#", "....#", "...#.", "..#..", ".....", "..#.."],
  "/": ["....#", "....#", "...#.", "..#..", ".#...", "#....", "#...."],
};

/** an indexed image being drawn into: one byte per pixel, palette indexes */
export interface Canvas {
  pixels: Uint8Array;
  width: number;
  height: number;
}

export function canvas(width: number, height: number, fill = 0): Canvas {
  const pixels = new Uint8Array(width * height);
  if (fill) pixels.fill(fill);
  return { pixels, width, height };
}

/** clipped rectangle fill — the only shape the chooser needs */
export function fillRect(
  c: Canvas,
  x: number,
  y: number,
  w: number,
  h: number,
  color: number,
): void {
  const x0 = Math.max(0, Math.round(x));
  const y0 = Math.max(0, Math.round(y));
  const x1 = Math.min(c.width, Math.round(x + w));
  const y1 = Math.min(c.height, Math.round(y + h));
  for (let yy = y0; yy < y1; yy++) c.pixels.fill(color, yy * c.width + x0, yy * c.width + x1);
}

/** a one-pixel outline, drawn inside the given rectangle */
export function strokeRect(
  c: Canvas,
  x: number,
  y: number,
  w: number,
  h: number,
  color: number,
): void {
  fillRect(c, x, y, w, 1, color);
  fillRect(c, x, y + h - 1, w, 1, color);
  fillRect(c, x, y, 1, h, color);
  fillRect(c, x + w - 1, y, 1, h, color);
}

/**
 * A vertical ramp: row `y` of the band takes the palette index `from + t*(to -
 * from)`, so the caller's palette must hold that range as a contiguous ramp.
 */
export function verticalRamp(
  c: Canvas,
  y: number,
  h: number,
  from: number,
  to: number,
): void {
  for (let i = 0; i < h; i++) {
    const t = h === 1 ? 0 : i / (h - 1);
    fillRect(c, 0, y + i, c.width, 1, Math.round(from + (to - from) * t));
  }
}

/** width in pixels of `text` at `scale`, including inter-character tracking */
export function textWidth(text: string, scale = 1, tracking = 1): number {
  if (!text.length) return 0;
  return text.length * (GLYPH_W + tracking) * scale - tracking * scale;
}

/**
 * Draw text with its top-left at (x, y). Unknown characters throw rather than
 * render blank: a label with a character the font lacks is a mistake to fix at
 * build time, not a hole to discover on screen.
 */
export function drawText(
  c: Canvas,
  text: string,
  x: number,
  y: number,
  color: number,
  scale = 1,
  tracking = 1,
): void {
  let penX = Math.round(x);
  for (const ch of text) {
    const glyph = FONT[ch];
    if (!glyph) throw new Error(`pixelart: no glyph for ${JSON.stringify(ch)} (in ${JSON.stringify(text)})`);
    glyph.forEach((row, gy) => {
      for (let gx = 0; gx < row.length; gx++) {
        if (row[gx] === "#") fillRect(c, penX + gx * scale, y + gy * scale, scale, scale, color);
      }
    });
    penX += (GLYPH_W + tracking) * scale;
  }
}

/** {@link drawText}, centred on `cx` */
export function drawTextCentered(
  c: Canvas,
  text: string,
  cx: number,
  y: number,
  color: number,
  scale = 1,
  tracking = 1,
): void {
  drawText(c, text, cx - textWidth(text, scale, tracking) / 2, y, color, scale, tracking);
}

/** every character the font can draw — for a caller that wants to check a label */
export const FONT_CHARS: string = Object.keys(FONT).join("");
