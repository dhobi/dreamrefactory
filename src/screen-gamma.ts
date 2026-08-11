/**
 * The display gamma TI.EXE applies to every palette entry before it reaches the
 * screen — the reason a faithful port looks *brighter* than a verbatim one.
 *
 * TI.EXE builds its hardware palette with a per-channel power curve and hands the
 * result straight to `AnimatePalette` (0x419da8). The build is at 0x419c9c and is
 * the same three instructions per channel:
 *
 *     fmul qword ptr [0x45a038]     ; * 1/255      -> normalise
 *     fld  st(0)
 *     fld  qword ptr [0x45b6f0]     ; the channel's exponent (R; G at +8, B at +0x10)
 *     call 0x44eac2                 ; pow
 *     fmul qword ptr [0x45a040]     ; * 255        -> back to a palette byte
 *     mov  word ptr [edi + 0x4891c6], ax
 *
 * so `entry = pow(c / 255, gamma) * 255`, and the three exponents default to
 * **0.65**. That is less than 1, so the original's out-of-the-box picture is
 * BRIGHTER than the palette bytes on disc, markedly so in the dark half:
 *
 *     in   16   32   64   96  128  160  200  240
 *     out  42   66  104  135  163  188  218  245
 *
 * We had none of this — `paletteToRGBA` takes each channel's byte verbatim, i.e.
 * gamma 1.0 — which is why the port was reported as "very dark in general" (#115).
 * That was never a comfort setting we lacked; it was a rendering step missing.
 *
 * The player can move it: the WM_KEYDOWN handler (0x41acda) dispatches on the
 * virtual key through a jump table (0x41b118, byte index at 0x41b158, key =
 * VK - 0x1b) and F1..F9 land on ten arms that all call 0x41b210 — F1/F2 scale all
 * three exponents down/up (the brightness pair the manual names as Ctrl+F1/F2),
 * F3-F8 the individual channels, F9 resets. Each press multiplies or divides by
 * 1.05. The controls are not wired up here yet; this module is where they will
 * hang, which is why the step and the default are named rather than inlined.
 *
 * WHERE IT APPLIES, which is the part that is easy to get wrong: the gamma is the
 * LAST thing that happens to a colour. TI.EXE's builder writes PALETTEENTRYs
 * directly into `AnimatePalette`, so it is the only route to the hardware palette
 * and everything that tints a colour — `mixclut`'s blend toward black above all —
 * has already happened by the time it runs. So dim first, then gamma, and never
 * the other way round: on a half-dimmed entry of 200 the two orders give 109 and
 * 139, which is not a subtlety you can leave to chance.
 */

/** the exponent TI.EXE ships with, and what its F9 resets to */
export const DEFAULT_SCREEN_GAMMA = 0.65;
/** what one F1/F2 press is worth — 0x45a050 (up) is the reciprocal of 0x45a058 */
export const SCREEN_GAMMA_STEP = 1.05;

let gamma = DEFAULT_SCREEN_GAMMA;
/** 256-entry lookup for the current gamma, rebuilt only when it changes */
let ramp = buildRamp(gamma);

function buildRamp(g: number): Uint8Array {
  const out = new Uint8Array(256);
  for (let c = 0; c < 256; c++) out[c] = Math.round(255 * Math.pow(c / 255, g));
  return out;
}

export function screenGamma(): number {
  return gamma;
}

/**
 * Set the exponent. Clamped to a range either end of which is already unusable,
 * so a stored value from a future build cannot black the screen out: 1.0 is the
 * raw palette (what this fixed) and 0.3 is washed out.
 */
export function setScreenGamma(g: number): void {
  const next = Math.max(0.3, Math.min(1.6, Number.isFinite(g) ? g : DEFAULT_SCREEN_GAMMA));
  if (next === gamma) return;
  gamma = next;
  ramp = buildRamp(gamma);
}

/**
 * Apply the current gamma to an RGBA CLUT, returning a new table. Alpha is left
 * alone, and so are index 0 and index 255 in effect — the curve fixes 0 and 255 —
 * so `paletteToRGBA`'s forced black and white survive it.
 *
 * Call this on the colour that is about to be drawn, AFTER any `mixclut` dim (see
 * the note above). A palette is 256 entries, so this is 768 table lookups against
 * the ~200k pixels it then colorizes: a rounding error, and the reason it is done
 * per palette rather than per pixel.
 */
export function displayPalette(clut: Uint8ClampedArray): Uint8ClampedArray {
  const out = new Uint8ClampedArray(clut.length);
  for (let i = 0; i < clut.length; i += 4) {
    out[i] = ramp[clut[i]];
    out[i + 1] = ramp[clut[i + 1]];
    out[i + 2] = ramp[clut[i + 2]];
    out[i + 3] = clut[i + 3];
  }
  return out;
}

/** One channel through the curve — for the few places that read a colour out of a
 *  CLUT by hand rather than expanding the whole table (puppet subtitle ink). */
export function displayChannel(c: number): number {
  return ramp[Math.max(0, Math.min(255, c | 0))];
}
