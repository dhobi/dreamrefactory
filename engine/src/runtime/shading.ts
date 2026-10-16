import { brightPalette } from "./geometry";

/**
 * DreamFactory 5's shading records: what `propbrightness`, `propcontrast` and
 * `proplitby` (and their actor, stage, set, movie and puppet twins) set, read
 * out of RedJack.exe.
 *
 * A record is three brightnesses, each added to its channel and held to
 * -255..255 (0x40a7f0), and three contrasts. A contrast c is kept as
 * m = 128 - c, held to 0..256 (0x40a870), and m is a gamma: the level v becomes
 * 255 · (v / 255) ^ (m / (256 - m)) (the table 0x512c00 built at 0x46edec,
 * 1024 for m = 256), so c = 0 is the picture as painted and a positive c lifts it.
 *
 * Records hang in a tree (the slots at 0x508c00, 40 bytes each, the parent
 * first). A sprite's own record is a child of the screen's at creation (props
 * 0x427767, actors 0x40150e); the stage's, the set's, the movie's and the
 * puppet's are children of the screen's too (0x439b60). `proplitby (p, "stage")`
 * moves the sprite under the stage's record (0x42c160 -> 0x40a750 -> 0x46f150),
 * and a picture is drawn through its record composed with every one above it
 * (0x46f430 -> 0x46f230): the brightnesses add, held to -255..255 again, and the
 * gammas multiply, m = 256 · x / (x + 1) for x the product, truncated and held
 * to 0..256.
 *
 * The screen's record is the root of everything, so the port applies it once,
 * to the whole frame, as it is presented (`screenbrightness`,
 * ScreenPresenter.blit); what is composed here is a sprite's own record and the
 * group it is lit by.
 */
export type Rgb = [number, number, number];

/** a record as the scripts set it: brightness -255..255 and contrast -128..128 per channel */
export interface Shade {
  bright: Rgb;
  contrast: Rgb;
}

/**
 * `proplitby`'s names, by the index RedJack.exe keeps (0x40a500, compared
 * without regard to case); anything else is error 0xa. "default" does not move
 * the sprite (0x40a750 answers no record for it, and 0x42c16b skips the
 * re-parent), so a sprite lit by the stage and then by "default" stays lit by
 * the stage.
 */
export const LIT_BY = ["default", "screen", "stage", "set", "movie", "puppet"] as const;
export const LIT_SCREEN = 1;
export const LIT_STAGE = 2;
export const LIT_SET = 3;
export const LIT_MOVIE = 4;
export const LIT_PUPPET = 5;

export const plainShade = (): Shade => ({ bright: [0, 0, 0], contrast: [0, 0, 0] });

export function isPlain(s: Shade): boolean {
  return !s.bright[0] && !s.bright[1] && !s.bright[2] && !s.contrast[0] && !s.contrast[1] && !s.contrast[2];
}

/**
 * Where a sprite hangs in the tree when it is under NO record, not even the
 * screen's: what a load leaves a sprite whose `litby` is "default" (0x43e085:
 * 0x40a750 answers parent −1 for 0, and 0x46efe0 makes the rebuilt record a
 * root). Every other way a sprite is made puts it under the screen.
 */
export const LIT_NONE = 0;

/** the records of the four groups below the screen (0x4c78c8, 0x4c794c, 0x4c7854, 0x4c7a14) */
export class Lights {
  readonly stage = plainShade();
  readonly set = plainShade();
  readonly movie = plainShade();
  readonly puppet = plainShade();
  /**
   * The table the puppet is drawn through when it is not its own record. A load
   * reads the puppet's parameters back (+0x20c) but builds its table from the
   * SET's (0x43d571..0x43d58e), and so it stays until a `puppetbrightness` or
   * `puppetcontrast` rebuilds it from the puppet's own (0x40a9cb -> 0x46f0b0).
   * Null is "the puppet's own".
   */
  puppetTable: Shade | null = null;
  /** the screen's record, which the presenter applies; the session hands it in */
  screenOf: () => Shade = plainShade;

  /** a group's record by its {@link LIT_BY} index, as pictures are drawn through it; the screen's is the presenter's, so null */
  group(k: number): Shade | null {
    switch (k) {
      case LIT_STAGE: return this.stage;
      case LIT_SET: return this.set;
      case LIT_MOVIE: return this.movie;
      case LIT_PUPPET: return this.puppetTable ?? this.puppet;
    }
    return null;
  }

  /**
   * The palette a sprite is drawn through: its own record under the group it
   * hangs from ({@link shadedPalette}). A sprite under {@link LIT_NONE} is drawn
   * as if the screen's record were not over it, which the port — applying the
   * screen to the whole frame as it is presented — can only do by handing the
   * presenter levels its curve takes back to the sprite's own
   * ({@link unscreenPalette}).
   */
  spritePalette(pal: Uint8ClampedArray, own: Shade, k: number): Uint8ClampedArray {
    const lit = shadedPalette(pal, own, this.group(k));
    if (k !== LIT_NONE) return lit;
    const screen = this.screenOf();
    return isPlain(screen) ? lit : unscreenPalette(lit, screen);
  }

  /** every number a picture drawn through these records depends on */
  key(): string {
    const t = this.puppetTable;
    return [this.stage, this.set, this.movie, this.puppet].map((s) => `${s.bright}/${s.contrast}`).join(";") +
      (t ? `;${t.bright}/${t.contrast}` : "");
  }
}

/** one channel's levels through the screen's record, as ScreenPresenter.blit presents them */
function screenCurve(contrast: number, add: number): Uint8ClampedArray {
  const e = exponent(gammaOf(contrast));
  const lut = new Uint8ClampedArray(256);
  for (let v = 0; v < 256; v++) lut[v] = Math.round(255 * Math.pow(v / 255, e)) + add;
  return lut;
}

const unscreened = new WeakMap<Uint8ClampedArray, Map<string, Uint8ClampedArray>>();

/**
 * A palette the presenter's screen curve takes back as near to `pal` as it can:
 * each level replaced by the one whose screen-lit level is closest. Exact where
 * the curve reaches the level; where it cannot (a brightened screen has no level
 * below its brightness), the nearest it has. The port's approximation of a
 * sprite under no record (see {@link LIT_NONE}).
 */
export function unscreenPalette(pal: Uint8ClampedArray, screen: Shade): Uint8ClampedArray {
  let byKey = unscreened.get(pal);
  if (!byKey) {
    byKey = new Map();
    unscreened.set(pal, byKey);
  }
  const key = `${screen.bright},${screen.contrast}`;
  let out = byKey.get(key);
  if (!out) {
    const inverse = [0, 1, 2].map((k) => {
      const lut = screenCurve(screen.contrast[k], screen.bright[k]);
      const inv = new Uint8ClampedArray(256);
      for (let t = 0; t < 256; t++) {
        let best = 0;
        for (let x = 1; x < 256; x++) if (Math.abs(lut[x] - t) < Math.abs(lut[best] - t)) best = x;
        inv[t] = best;
      }
      return inv;
    });
    out = new Uint8ClampedArray(pal.length);
    for (let i = 0; i < pal.length; i += 4) {
      out[i] = inverse[0][pal[i]];
      out[i + 1] = inverse[1][pal[i + 1]];
      out[i + 2] = inverse[2][pal[i + 2]];
      out[i + 3] = pal[i + 3];
    }
    byKey.set(key, out);
  }
  return out;
}

/** a contrast as the gamma 0x40a870 keeps */
export const gammaOf = (c: number): number => Math.max(0, Math.min(256, 128 - c));
/** ...and back, as the value forms answer it (0x42c3a5: 128 - m) */
export const contrastOf = (m: number): number => 128 - m;

/** the exponent the table at 0x512c00 holds for m */
const exponent = (m: number): number => (m >= 256 ? 1024 : m / (256 - m));

/** two gammas composed (0x46f2a7..0x46f2ea) */
export function composeGamma(a: number, b: number): number {
  if (a === 128) return b;
  if (b === 128) return a;
  const x = exponent(a) * exponent(b);
  return Math.max(0, Math.min(256, Math.trunc(256 * (1 - 1 / (x + 1)))));
}

/** the record a sprite is drawn through: its own and its group's, composed */
export function composeShade(own: Shade, parent: Shade | null): { bright: Rgb; gamma: Rgb } {
  const level = (v: number): number => Math.max(-255, Math.min(255, v));
  const bright: Rgb = [0, 1, 2].map((k) => level(own.bright[k] + (parent?.bright[k] ?? 0))) as Rgb;
  const gamma: Rgb = [0, 1, 2].map((k) => composeGamma(gammaOf(own.contrast[k]), gammaOf(parent?.contrast[k] ?? 0))) as Rgb;
  return { bright, gamma };
}

const shaded = new WeakMap<Uint8ClampedArray, Map<string, Uint8ClampedArray>>();

/**
 * A palette through a sprite's own record and its group's. With no contrast and
 * a plain group it is {@link brightPalette} — which is the palette itself for a
 * sprite nobody lit, and so every game before DreamFactory 5.
 */
export function shadedPalette(
  pal: Uint8ClampedArray,
  own: Shade,
  parent: Shade | null = null,
): Uint8ClampedArray {
  const c = own.contrast;
  if (!c[0] && !c[1] && !c[2] && (!parent || isPlain(parent))) return brightPalette(pal, own.bright);
  const { bright, gamma } = composeShade(own, parent);
  return gammaPalette(pal, bright, gamma);
}

/** a palette through one composed record: each level by its channel's gamma, then the brightness added */
export function gammaPalette(pal: Uint8ClampedArray, bright: readonly number[], gamma: readonly number[]): Uint8ClampedArray {
  if (gamma.every((m) => m === 128)) return brightPalette(pal, bright as Rgb);
  let byKey = shaded.get(pal);
  if (!byKey) {
    byKey = new Map();
    shaded.set(pal, byKey);
  }
  const key = `${bright},${gamma}`;
  let out = byKey.get(key);
  if (!out) {
    const luts = [0, 1, 2].map((k) => {
      const e = exponent(gamma[k]);
      const lut = new Uint8ClampedArray(256);
      for (let v = 0; v < 256; v++) lut[v] = Math.round(255 * Math.pow(v / 255, e)) + bright[k];
      return lut;
    });
    out = new Uint8ClampedArray(pal.length);
    for (let i = 0; i < pal.length; i += 4) {
      out[i] = luts[0][pal[i]];
      out[i + 1] = luts[1][pal[i + 1]];
      out[i + 2] = luts[2][pal[i + 2]];
      out[i + 3] = pal[i + 3];
    }
    byKey.set(key, out);
  }
  return out;
}

/** a group's record over a picture that has no record of its own (the stage's flat, a movie's frame, a puppet) */
export function groupPalette(pal: Uint8ClampedArray, group: Shade): Uint8ClampedArray {
  if (isPlain(group)) return pal;
  return gammaPalette(pal, group.bright, group.contrast.map(gammaOf));
}
