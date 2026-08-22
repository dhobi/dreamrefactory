/**
 * The game's screen contract.
 *
 * TAOOT renders into a single fixed framebuffer: **512×384** (4:3). Everything
 * in the data is authored against it — STG flats are "512×384 full-screen
 * images", MOV frames decode to a full 512×384 image, PUP stances composite
 * over the whole screen, and screen props default to anchor (256,192), the
 * centre of it. `mouse()` reports positions in this space too.
 *
 * The one size that is NOT a screen size is the **SET view**: a room view is
 * the set's viewPortWidth×viewPortHeight (typically 512×264) and occupies the
 * TOP REGION of the screen, with the STG UI band below it. It is a sub-rect of
 * the screen, not a smaller screen — so the renderer always presents 512×384
 * and composites the view into the top, rather than resizing the canvas to
 * whatever the current source happens to be (which made the page reflow every
 * time a scene switched between a flat and a bare view).
 */

/** the full game screen — set view on top, menu band below */
export const SCREEN_W = 512;
export const SCREEN_H = 384;

/** bytes in one full screen of RGBA */
export const SCREEN_BYTES = SCREEN_W * SCREEN_H * 4;

/**
 * An opaque-black screen, used as the clear source: `frame.set(BLANK_SCREEN)`
 * is a single memcpy and, unlike `fill(0)`, leaves alpha at 255 (a
 * zero-alpha framebuffer would present as transparent, not black). Built by
 * writing bytes rather than a 32-bit pattern so it doesn't depend on the
 * platform's endianness.
 */
export const BLANK_SCREEN: Uint8ClampedArray = (() => {
  const a = new Uint8ClampedArray(SCREEN_BYTES);
  for (let i = 3; i < a.length; i += 4) a[i] = 255;
  return a;
})();
