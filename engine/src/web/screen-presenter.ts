import { BLANK_SCREEN, DEFAULT_SCREEN, ScreenSize, blankScreen } from "./screen";
import { DrawSignature } from "@dreamfactory/engine/runtime/signature";
import { overlayFont } from "./fonts";

/**
 * Composite unconditionally at least this often, however still the game looks
 * to the viewer's signature — the insurance policy on the hash being
 * incomplete rather than wrong. ~1 s at 60 Hz; see {@link ScreenPresenter.shouldPaint}.
 */
const REPAINT_EVERY = 60;

/**
 * The presented screen — the ONE persistent surface everything composites into.
 *
 * Owned by the host and handed to each SetViewer, so it OUTLIVES the viewers:
 * a set change swaps the viewer but the screen is the same screen, which is
 * the lifetime the session's fade snapshot and captureFrame were each invented
 * to paper over while the framebuffer was rebuilt with the viewer. Mid-set-
 * change, {@link capture} still answers with the frame the player is looking at.
 *
 * The canvas backing store is a fixed size for the whole session. Previously
 * each render path resized it to its own source (a bare set view is 512×264, a
 * flat/movie/puppet 512×384), so the canvas element's height changed
 * underneath the CSS and the page reflowed every time a scene crossed that
 * boundary. A view is the top region of the screen, not a smaller screen — so
 * short sources are composited into the top and the remaining rows stay black.
 *
 * WHICH fixed size is the game's, not the engine's, and not its DreamFactory
 * version's either — see {@link ScreenSize}. Titanic (DF4) and Dust (DF1) are both
 * 512×384 and get it by default; Timelapse (DF4) is 640×480 and says so. Every
 * dimension below is read off this instance rather than off a module constant,
 * which is the whole of what made the difference.
 */
export class ScreenPresenter {
  readonly width: number;
  readonly height: number;
  /** one persistent width×height RGBA framebuffer, blitted by {@link blit} */
  // The buffer is spelled out because {@link blit} wraps it in an `ImageData`
  // zero-copy, and that overload takes only an `ArrayBuffer`-backed view — an
  // inferred `ArrayBufferLike` would silently fall back to the copying path.
  readonly frame: Uint8ClampedArray<ArrayBuffer>;
  /** the clear source at THIS size (see {@link blankScreen}) */
  private readonly blank: Uint8ClampedArray;

  constructor(size: ScreenSize = DEFAULT_SCREEN) {
    this.width = size.width;
    this.height = size.height;
    this.frame = new Uint8ClampedArray(size.width * size.height * 4);
    // the shared one where it fits, which is every DF4 game but Timelapse
    this.blank =
      size.width === DEFAULT_SCREEN.width && size.height === DEFAULT_SCREEN.height
        ? BLANK_SCREEN
        : blankScreen(size.width, size.height);
  }
  /** false until the first composite, so {@link capture} can't hand out a blank screen */
  frameValid = false;
  /** the ImageData wrapper used to present {@link frame}; shares its buffer when possible */
  private presented: ImageData | null = null;
  /** reusable decode target, grown on demand — a source is blitted into `frame`
   *  immediately after it is decoded, so one scratch serves all paths */
  private scratch = new Uint8ClampedArray(0);
  /** the "is this picture already on the canvas?" state — see {@link shouldPaint} */
  private lastSigLo = -1;
  private lastSigHi = -1;
  /** composites skipped since the last one, capped by {@link REPAINT_EVERY} */
  private skippedFrames = 0;

  /** a decode buffer of at least `n` bytes (see {@link scratch}) */
  scratchFor(n: number): Uint8ClampedArray {
    if (this.scratch.length < n) this.scratch = new Uint8ClampedArray(n);
    return this.scratch;
  }

  /** reset the framebuffer to opaque black */
  clearFrame(): void {
    this.frame.set(this.blank);
  }

  /** the composited frame the player is looking at, or null before the first
   *  composite — the screen half of the session's captureFrame hook */
  capture(): { rgba: Uint8ClampedArray; width: number; height: number } | null {
    if (!this.frameValid) return null;
    return { rgba: this.frame.slice(), width: this.width, height: this.height };
  }

  /**
   * Is the picture the signature describes already on the canvas? False —
   * paint it — when anything hashed differs, when nothing has been presented
   * yet, and unconditionally every {@link REPAINT_EVERY} frames (the net under
   * an incomplete hash; see the viewer's render docblock for the measurements).
   * Records the signature it answered for, so a false is a commitment to paint.
   */
  shouldPaint(sig: DrawSignature): boolean {
    if (
      this.frameValid &&
      this.presented !== null &&
      sig.lo === this.lastSigLo &&
      sig.hi === this.lastSigHi &&
      ++this.skippedFrames < REPAINT_EVERY
    ) {
      return false;
    }
    this.skippedFrames = 0;
    this.lastSigLo = sig.lo;
    this.lastSigHi = sig.hi;
    return true;
  }

  /** {@link blitTop} at an offset — where a movie segment's header places its
   *  picture on the screen (0,0 for everything but the letterboxed films) */
  blitAt(src: Uint8ClampedArray, w: number, h: number, x: number, y: number): void {
    if (!x && !y) {
      this.blitTop(src, w, h);
      return;
    }
    const rows = Math.min(h, this.height - y);
    const cols = Math.min(w, this.width - x);
    for (let row = 0; row < rows; row++) {
      const s = row * w * 4;
      this.frame.set(src.subarray(s, s + cols * 4), ((row + y) * this.width + x) * 4);
    }
  }

  /**
   * Blit an RGBA source into the TOP-LEFT of the framebuffer, clipped to the
   * screen. Sources shorter than the screen (a 512×264 set view) therefore
   * land in the top region and leave whatever is below them intact — which is
   * how the engine composes the screen: view on top, UI band underneath.
   */
  blitTop(src: Uint8ClampedArray, w: number, h: number): void {
    const rows = Math.min(h, this.height);
    const cols = Math.min(w, this.width);
    // A source already screen-wide — the stage flat, the set view, a movie
    // image, i.e. nearly every blit there is — has its rows contiguous with the
    // framebuffer's, so the whole thing is one copy instead of 384 (~2x).
    if (w === this.width) {
      this.frame.set(src.subarray(0, rows * this.width * 4), 0);
      return;
    }
    for (let y = 0; y < rows; y++) {
      const s = y * w * 4;
      this.frame.set(src.subarray(s, s + cols * 4), y * this.width * 4);
    }
  }

  /**
   * Present the framebuffer. The canvas backing store is pinned to the screen
   * size once and never touched again, so the element's intrinsic size — and
   * hence the page layout — is constant for the whole session.
   */
  blit(ctx: CanvasRenderingContext2D): void {
    const canvas = ctx.canvas;
    if (canvas.width !== this.width || canvas.height !== this.height) {
      canvas.width = this.width;
      canvas.height = this.height;
      this.presented = null; // a resize drops the old backing store
    }
    let img = this.presented;
    if (!img) {
      // Wrapping `frame` makes putImageData zero-copy; if the one-arg ImageData
      // constructor isn't available, fall back to a per-present copy.
      try {
        img = new ImageData(this.frame, this.width, this.height);
      } catch {
        img = ctx.createImageData(this.width, this.height);
      }
      this.presented = img;
    }
    if (img.data !== this.frame) img.data.set(this.frame);
    ctx.putImageData(img, 0, 0);
  }

  /** paint the persistent drawstring() text layer over the composited frame */
  drawTextOverlay(
    ctx: CanvasRenderingContext2D,
    overlay: readonly { text: string; x: number; y: number; color: number; size: number }[],
  ): void {
    if (!overlay.length) return;
    ctx.save();
    ctx.textBaseline = "alphabetic"; // drawstring's y is the text baseline (QuickDraw heritage)
    for (const e of overlay) {
      ctx.font = overlayFont(e.size);
      // color 0 = black (TAOOT: the wireless readout / CTL keys); other indices fall
      // back to a bright ink until we need a real palette lookup here
      ctx.fillStyle = e.color === 0 ? "#000" : "#e8e8e8";
      ctx.fillText(e.text, e.x, e.y);
    }
    ctx.restore();
  }

  /** black overlay for screentoblack/blacktoscreen transitions */
  applyFade(ctx: CanvasRenderingContext2D, level: number): void {
    if (level <= 0) return;
    ctx.save();
    ctx.fillStyle = `rgba(0,0,0,${Math.min(1, level).toFixed(3)})`;
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    ctx.restore();
  }

  /**
   * {@link applyFade} everywhere but `keep` — the rectangle a movie is painting.
   *
   * A clip carries its own palette, so in TI.EXE it is bright while the rest of
   * the screen, drawn in the ramped one, is not; here that means the overlay
   * goes round it in up to four bands. A `keep` that covers the canvas fades
   * nothing, and one entirely off it fades everything.
   */
  applyFadeExcept(
    ctx: CanvasRenderingContext2D,
    level: number,
    keep: { x: number; y: number; w: number; h: number },
  ): void {
    if (level <= 0) return;
    const W = ctx.canvas.width;
    const H = ctx.canvas.height;
    const x0 = Math.max(0, Math.min(W, keep.x));
    const y0 = Math.max(0, Math.min(H, keep.y));
    const x1 = Math.max(0, Math.min(W, keep.x + keep.w));
    const y1 = Math.max(0, Math.min(H, keep.y + keep.h));
    ctx.save();
    ctx.fillStyle = `rgba(0,0,0,${Math.min(1, level).toFixed(3)})`;
    if (x1 <= x0 || y1 <= y0) {
      ctx.fillRect(0, 0, W, H); // the clip is off screen: nothing to spare
    } else {
      if (y0 > 0) ctx.fillRect(0, 0, W, y0);
      if (y1 < H) ctx.fillRect(0, y1, W, H - y1);
      if (x0 > 0) ctx.fillRect(0, y0, x0, y1 - y0);
      if (x1 < W) ctx.fillRect(x1, y0, W - x1, y1 - y0);
    }
    ctx.restore();
  }
}
