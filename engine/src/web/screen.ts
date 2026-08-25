/**
 * A game's screen contract — how big the framebuffer is, and what a source that
 * is smaller than it means.
 *
 * A DreamFactory game renders into a single fixed framebuffer, and everything in
 * its data is authored against that one size: STG flats are full-screen images,
 * MOV frames decode to a full screen, PUP stances composite over the whole
 * screen, screen props default to anchoring at its centre, and `mouse()` reports
 * positions in that space.
 *
 * The one size that is NOT a screen size is the **SET view**: a room view is the
 * set's viewPortWidth×viewPortHeight (Titanic: 512×264) and occupies the TOP
 * REGION of the screen, with the STG UI band below it. It is a sub-rect of the
 * screen, not a smaller screen — so the renderer always presents the whole
 * screen and composites the view into the top, rather than resizing the canvas to
 * whatever the current source happens to be (which made the page reflow every
 * time a scene switched between a flat and a bare view).
 *
 * ## Why the numbers below are a DEFAULT and not the contract
 *
 * They were the contract, as `SCREEN_W`/`SCREEN_H`, and 512×384 is Titanic's
 * screen — which Dust shares, so for two games the distinction never came up and
 * one game's geometry sat in the package whose rule is that it knows about no
 * particular game. *Timelapse* (1996) says **640×480** in the header of every one
 * of its 155 stages, so a hardcoded 512×384 cropped a fifth of it off the edge.
 *
 * And it is a per-TITLE fact, not a per-version one, which is worth saying because
 * the version is the tempting explanation and it is wrong. Measured off the three
 * rips' own headers:
 *
 *   | rip       | engine | stage screen | set viewport |
 *   |-----------|--------|--------------|--------------|
 *   | Titanic   | DF4    | 512×384      | 512×264      |
 *   | Dust      | **DF1**| **512×384**  | 512×264      |
 *   | Timelapse | DF4    | **640×480**  | (no sets)    |
 *
 * So 512×384 spans both engines and 640×480 is DF4 as well: nothing about the
 * format decides it, and the only honest place for it is the game.
 *
 * The size therefore belongs to the {@link ScreenPresenter} that owns the
 * framebuffer, and a game shell says which it wants when it builds its host. These
 * stay as the default because two of the three want them, and because a caller
 * with no opinion should not have to have one.
 *
 * The data does say, incidentally — an STG header carries the screen size at
 * 0x28 and a SET carries its viewport — so this could one day be read rather than
 * declared. It is declared because the framebuffer has to exist before the first
 * file is parsed, and a shell knowing its own game's screen size is honest.
 */

/** what two of the three games use — set view on top, menu band below */
export const SCREEN_W = 512;
export const SCREEN_H = 384;

/** bytes in one full screen of RGBA at the default size */
export const SCREEN_BYTES = SCREEN_W * SCREEN_H * 4;

/** how big a screen is: what a {@link ScreenPresenter} is built with */
export interface ScreenSize {
  width: number;
  height: number;
}

/** the default, as a {@link ScreenSize} */
export const DEFAULT_SCREEN: ScreenSize = { width: SCREEN_W, height: SCREEN_H };

/**
 * An opaque-black screen of `w`×`h`, used as a clear source: `frame.set(blank)`
 * is a single memcpy and, unlike `fill(0)`, leaves alpha at 255 (a zero-alpha
 * framebuffer would present as transparent, not black). Built by writing bytes
 * rather than a 32-bit pattern so it doesn't depend on the platform's endianness.
 */
export function blankScreen(w: number, h: number): Uint8ClampedArray {
  const a = new Uint8ClampedArray(w * h * 4);
  for (let i = 3; i < a.length; i += 4) a[i] = 255;
  return a;
}

/**
 * The default-size blank screen, kept because it is asked for on every clear of
 * the common case and there is no reason to rebuild 786 KB per presenter.
 */
export const BLANK_SCREEN: Uint8ClampedArray = blankScreen(SCREEN_W, SCREEN_H);
