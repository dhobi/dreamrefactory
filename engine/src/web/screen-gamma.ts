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
/** what one keypress is worth — 0x45a050 (up) is the reciprocal of 0x45a058 */
export const SCREEN_GAMMA_STEP = 1.05;
/** the clamp either end of which is already unusable: 1.0 is the raw palette (what
 *  #115 fixed) and 0.3 is washed out. Keeps a stored or fat-fingered value sane. */
const MIN_GAMMA = 0.3;
const MAX_GAMMA = 1.6;

/** which channels a change applies to — the three flags TI.EXE's 0x41b210 takes */
export type GammaChannels = readonly [red: boolean, green: boolean, blue: boolean];
/** all three together: the F1/F2 pair, and what a brightness control moves */
export const ALL_CHANNELS: GammaChannels = [true, true, true];

const gammas: [number, number, number] = [
  DEFAULT_SCREEN_GAMMA, DEFAULT_SCREEN_GAMMA, DEFAULT_SCREEN_GAMMA,
];
const ramps: [Uint8Array, Uint8Array, Uint8Array] = [
  buildRamp(gammas[0]), buildRamp(gammas[1]), buildRamp(gammas[2]),
];
/**
 * Bumped on every change, and the ONLY thing cache holders have to watch.
 *
 * Every consumer of a palette caches it — the set and prop palettes, the stage
 * flat memo, the puppet's composited stance, each movie segment — and all of them
 * hold POST-gamma bytes, so a live change has to reach all four or the picture
 * changes in one place and not the others. A generation counter rather than a
 * subscription because instances come and go (a viewer per set, a puppet view per
 * conversation) and a listener list would need unsubscribing correctly at every
 * teardown to avoid holding them alive; comparing an integer cannot leak.
 */
let generation = 0;

function buildRamp(g: number): Uint8Array {
  const out = new Uint8Array(256);
  for (let c = 0; c < 256; c++) out[c] = Math.round(255 * Math.pow(c / 255, g));
  return out;
}

/** the three exponents, R/G/B — TI.EXE's 0x45b6f0 / +8 / +0x10 */
export function screenGammas(): readonly [number, number, number] {
  return gammas;
}

/** the brightness a single control shows: the three channels averaged, which is
 *  the value itself whenever they have only ever been moved together */
export function screenGamma(): number {
  return (gammas[0] + gammas[1] + gammas[2]) / 3;
}

/** watch this to know a cached palette is stale ({@link generation}) */
export function screenGammaGeneration(): number {
  return generation;
}

/** Set the named channels to `g`. Silent no-op when nothing would change, so a
 *  slider dragged within one rounding step does not invalidate every cache. */
export function setScreenGamma(g: number, channels: GammaChannels = ALL_CHANNELS): void {
  const next = Math.max(MIN_GAMMA, Math.min(MAX_GAMMA, Number.isFinite(g) ? g : DEFAULT_SCREEN_GAMMA));
  let moved = false;
  for (let i = 0; i < 3; i++) {
    if (!channels[i] || gammas[i] === next) continue;
    gammas[i] = next;
    ramps[i] = buildRamp(next);
    moved = true;
  }
  if (moved) generation++;
}

/**
 * One keypress: multiply the named channels by 1.05, or divide by it.
 *
 * The direction is TI.EXE's first argument to 0x41b210 and the three flags are its
 * other three, so F1 is `step(false, ALL_CHANNELS)` and F4 is `step(true, [true,
 * false, false])` — the arms read as the disassembly does.
 */
export function stepScreenGamma(up: boolean, channels: GammaChannels = ALL_CHANNELS): void {
  let moved = false;
  for (let i = 0; i < 3; i++) {
    if (!channels[i]) continue;
    const raw = up ? gammas[i] * SCREEN_GAMMA_STEP : gammas[i] / SCREEN_GAMMA_STEP;
    const next = Math.max(MIN_GAMMA, Math.min(MAX_GAMMA, raw));
    if (next === gammas[i]) continue;
    gammas[i] = next;
    ramps[i] = buildRamp(next);
    moved = true;
  }
  if (moved) generation++;
}

/** F9: all three back to what the original ships with */
export function resetScreenGamma(): void {
  setScreenGamma(DEFAULT_SCREEN_GAMMA, ALL_CHANNELS);
}

/**
 * Apply the current gamma to an RGBA CLUT, returning a new table. Alpha is left
 * alone, and 0 and 255 are fixed points of the curve, so `paletteToRGBA`'s forced
 * black and white survive it.
 *
 * Call this on the colour that is about to be drawn, AFTER any `mixclut` dim (see
 * the note at the top). A palette is 256 entries, so this is 768 table lookups
 * against the ~200k pixels it then colorizes: the reason it is done per palette
 * rather than per pixel.
 */
export function displayPalette(clut: Uint8ClampedArray): Uint8ClampedArray {
  const out = new Uint8ClampedArray(clut.length);
  const [r, g, b] = ramps;
  for (let i = 0; i < clut.length; i += 4) {
    out[i] = r[clut[i]];
    out[i + 1] = g[clut[i + 1]];
    out[i + 2] = b[clut[i + 2]];
    out[i + 3] = clut[i + 3];
  }
  return out;
}

/** One channel through its own curve — for the few places that read a colour out
 *  of a CLUT by hand rather than expanding the whole table (puppet subtitle ink).
 *  `ch` is 0/1/2 for R/G/B. */
export function displayChannel(c: number, ch: 0 | 1 | 2): number {
  return ramps[ch][Math.max(0, Math.min(255, c | 0))];
}
