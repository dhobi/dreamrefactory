/**
 * DreamFactory's mouse cursors, in a browser.
 *
 * A script says `cursor("touch")` and the 1996 engine answers by loading the
 * `CURS.TOUCH` resource out of its own executable and calling `SetCursor` — 32x32,
 * monochrome, with a hotspot. The whole mechanism, and how the art was found, is
 * in `tools/dumpcursors.ts`; a game's extracted set is a table of
 * {@link CursorArt} (Timelapse's is `timelapse/src/cursor-art.ts`).
 *
 * This is the other half: two 1bpp planes into something `style.cursor` will take.
 *
 * ## Why a PNG and not a keyword
 *
 * The port used to map these names onto CSS keywords — `touch` to `pointer`,
 * `watch` to `wait` — which is the right first move and is still the fallback
 * here. But Timelapse navigates by CURSOR: 11,031 of its 13,200 `cursor(...)`
 * calls are the two arrows that say "you can step forward here" / "back up here",
 * and both of them were REDRAWN for this game (Titanic's `CURS.GOUP` is a plain
 * arrow, Timelapse's has a foot on it). No keyword carries that, and the ones
 * that point the right way — `n-resize`, `s-resize` — promise a drag. So the art
 * itself is the affordance, and it has to be the real art.
 *
 * ## Scale
 *
 * A cursor image in CSS is measured in CSS pixels, so a 32x32 one is 32 CSS
 * pixels wide however large the picture under it is being shown. That is wrong
 * for this: these were drawn against the game's own screen, and Titanic's page
 * shows a 512-wide picture at 1024 CSS pixels — where a 32x32 cursor is half the
 * size the artist drew.
 *
 * So {@link CursorSheet.css} takes the scale the picture is being shown at and
 * resamples the bitmap to `round(32 * scale)`, nearest neighbour, no
 * interpolation. Whole-number scales are exact pixel doubling; the ones in
 * between (a window at 1.4x, a stretched fullscreen at 3.75x) get an even mix of
 * one- and two-pixel rows, which is what a pixel-art cursor at a fractional zoom
 * has to be. It was integer-only, which sounds purer and means a picture at 1.4x
 * gets a cursor 30% too small and one at 3.75x gets 96 pixels where it wanted
 * 120. Capped at {@link CURSOR_MAX_PX} because a larger cursor image is ignored
 * outright by every browser.
 *
 * ## Three states, not four
 *
 * Windows monochrome cursors have a fourth: mask 1 with colour 1 inverts the
 * screen. Nothing in these builds uses it (`tools/dumpcursors.ts` refuses to
 * write a table that does), and CSS has no way to express it, so this renders
 * transparent, black and white and nothing else.
 */

/** one cursor, as `tools/dumpcursors.ts` writes it */
export interface CursorArt {
  /** hotspot, in cursor pixels */
  hx: number;
  hy: number;
  /** the CSS keyword for a browser that will not take the image */
  fallback: string;
  /** base64: the 32x32 colour plane then the 32x32 AND mask, top-down */
  bits: string;
}

/** what every one of these is, in both builds that have them */
export const CURSOR_W = 32;
export const CURSOR_H = 32;
const PLANE = (CURSOR_W >> 3) * CURSOR_H;

/** the biggest a cursor image may be before browsers ignore it outright */
export const CURSOR_MAX_PX = 128;

/** the pixel size for a picture shown at `scale`, within what a browser takes */
export const cursorSizeFor = (scale: number): number =>
  Math.max(CURSOR_W, Math.min(CURSOR_MAX_PX, Math.round(CURSOR_W * (scale > 0 ? scale : 1))));

const b64 = (s: string): Uint8Array => {
  const raw = atob(s);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
};

/**
 * The cursor as pixels, at `scale`.
 *
 * Pure, and separate from the CSS for one reason: this is the part with a right
 * answer — a hotspot, a plane order, a palette, an origin at the top — and it can
 * be checked without a browser in the room.
 */
export function cursorPixels(art: CursorArt, scale = 1): { rgba: Uint8ClampedArray; width: number; height: number } {
  const planes = b64(art.bits);
  if (planes.length !== 2 * PLANE) throw new Error(`cursor art is ${planes.length} bytes, expected ${2 * PLANE}`);
  const size = cursorSizeFor(scale);
  const rgba = new Uint8ClampedArray(size * size * 4);
  const stride = CURSOR_W >> 3;
  // destination -> source, so a fractional scale lands on whole source pixels
  // rather than blending any two of them together
  for (let y = 0; y < size; y++) {
    const sy = Math.min(CURSOR_H - 1, Math.floor((y * CURSOR_H) / size));
    for (let x = 0; x < size; x++) {
      const sx = Math.min(CURSOR_W - 1, Math.floor((x * CURSOR_W) / size));
      const i = sy * stride + (sx >> 3);
      const bit = 7 - (sx & 7);
      // mask 1 leaves the screen alone; mask 0 paints the colour plane, whose
      // palette is black at index 0 and white at index 1 in every one of these
      if ((planes[PLANE + i] >> bit) & 1) continue;
      const p = (y * size + x) * 4;
      rgba[p] = rgba[p + 1] = rgba[p + 2] = (planes[i] >> bit) & 1 ? 255 : 0;
      rgba[p + 3] = 255;
    }
  }
  return { rgba, width: size, height: size };
}

/**
 * A `style.cursor` value for one of these, or the bare fallback keyword where
 * there is no canvas to make a PNG with.
 *
 * Memoised per name and scale, because this is called on every pointer move and
 * there are at most seventeen cursors times three scales of answer.
 */
export class CursorSheet {
  private readonly cache = new Map<string, string>();

  constructor(private readonly art: Record<string, CursorArt>) {}

  /** does this game have art for that name? */
  has(name: string): boolean {
    return name.toLowerCase() in this.art;
  }

  /**
   * `cursor(name)` as CSS, at the scale the picture is being shown at.
   *
   * An unknown name is `default` and not a thrown error: the name comes from a
   * game script, a cursor is cosmetic, and the shell that asks for one is in the
   * middle of a pointer move.
   */
  css(name: string, scale = 1): string {
    // Win32 resource lookup folds case and the scripts lean on it — Timelapse
    // spells two of these `HyperLink` and `None`. Keyed on the pixel SIZE rather
    // than the scale, so two window widths that want the same cursor share it.
    const key = `${name.toLowerCase()}@${cursorSizeFor(scale)}`;
    const hit = this.cache.get(key);
    if (hit !== undefined) return hit;
    const value = this.build(key);
    this.cache.set(key, value);
    return value;
  }

  private build(key: string): string {
    const [name, sizeText] = key.split("@");
    const size = Number(sizeText);
    /**
     * `none` first, and by NAME rather than by art.
     *
     * It is the answer {@link ScreenDirector.hover} gives while `hidecursor()` is
     * in force, so it arrives in games whose build carries no `CURS.NONE` at all
     * — Titanic's and Dust's do not, only Timelapse's — and a hidden pointer that
     * fell through to `default` would be the plain arrow. A keyword and not the
     * art even where the art exists: a fully transparent cursor image is one some
     * browsers replace with an arrow rather than hide.
     */
    if (name === "none") return "none";
    const art = this.art[name];
    if (!art) return "default";
    const k = size / CURSOR_W;
    const url = this.dataUrl(art, k);
    if (!url) return art.fallback;
    // the hotspot moves with the art, and rounds the same way the art was
    // resampled so it stays on the pixel it names
    return `url("${url}") ${Math.round(art.hx * k)} ${Math.round(art.hy * k)}, ${art.fallback}`;
  }

  /** the PNG, through a canvas — null in anything without a document */
  private dataUrl(art: CursorArt, scale: number): string | null {
    if (typeof document === "undefined") return null;
    try {
      const { rgba, width, height } = cursorPixels(art, scale);
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return null;
      // through `createImageData` rather than `new ImageData(rgba, …)`: the same
      // picture, and it does not care which flavour of buffer the pixels came in
      const img = ctx.createImageData(width, height);
      img.data.set(rgba);
      ctx.putImageData(img, 0, 0);
      return canvas.toDataURL("image/png");
    } catch {
      /* a canvas this browser will not give up (a tainted or blocked context) */
      return null;
    }
  }
}
