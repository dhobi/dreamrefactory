/**
 * TH (TylerHartman): Titanic on a 16:9 display with the menu band tucked away.
 *
 * The framebuffer is 512×384, but the room is only its top 512×264 (the set's
 * viewport, engine/src/web/screen.ts); the 120 rows under it are the stage's
 * menu band. The view alone is 1.94:1, which a 16:9 display (1.78:1) holds with
 * a thin bar above and below, where the full 4:3 would need a third of its
 * height pulled to fill it. So the box and "stretch to fill" exclude each
 * other (main.ts): ticking one unticks the other.
 *
 * So with the box ticked the band is hidden, in fullscreen and in the page (a
 * phone is rarely in fullscreen), and only the view fills the box. The whole
 * screen, view and band, is squeezed into that same box when the band is
 * wanted, so the band never covers any of the view:
 *
 *   - **a conversation's answers**, which the band holds (the director is
 *     `awaitingChoice`), and
 *   - **a right click**, or on a phone a two-finger tap, which shows it or
 *     hides it again: the inventory, the menu buttons and anything else the
 *     band holds are one click away. Not a long press: a phone reports a
 *     finger held down as one, and that is half of every swipe to walk. Not
 *     the one-finger double tap either, which is ESC and skips a film.
 *
 * A picture of the whole screen, with no room view in it (a close-up such as
 * the bedsit desk's papers, a menu, a film reaching into the band's rows:
 * ScreenDirector.picture), is squeezed into the box the same way. It is
 * pulled out of 4:3 further than the view, and that is the answer: the box
 * does not jump about between a room, its band and its close-ups.
 *
 * ## Sliding, not jumping
 *
 * The band slides in and out: over {@link SLIDE_MS} the box goes from the
 * view's 264 rows to all 384 and back, each frame the top `rows` of the
 * screen pulled to the box's height, so the room squeezes up as the band
 * rises under it. A change of PICTURE (a close-up opening, a film, back to
 * the room) is not a slide: the picture itself has changed, and it takes the
 * box at once.
 *
 * ## How, and what it leaves alone
 *
 * Layout only, like ./stretch.ts in the engine: the framebuffer, the scripts
 * and the hotspots see the same 512×384. The canvas's box is the view's
 * shape (fullscreen: the {@link viewBox}; the page: its own width, 512:264),
 * holding the whole screen, and showing `rows` of it is two properties:
 * `scaleY(384 / rows)` from the top, and a `clip-path` cutting the rows below
 * `rows` off. A transform moves the box `getBoundingClientRect` reports with
 * it, so main.ts's `canvasCoords` and the cursor's scale map a point to the
 * pixel under it as they always have, and clipped rows take no clicks.
 *
 * The page's brass rim moves to the stage while the mode is on, which the
 * canvas's own clip would cut, and the stage is the canvas's size: its column
 * centres it and shrinks to fit.
 */

/** the menu band's first row: the set viewport is the rows above it */
export const VIEW_H = 264;

/** how long the band takes to slide in or out */
export const SLIDE_MS = 250;

/**
 * The rows on show `t` of the way through a slide from `from` to `to`, eased
 * in and out.
 */
export function slideRows(from: number, to: number, t: number): number {
  const k = Math.min(1, Math.max(0, t));
  return from + (to - from) * (k * k * (3 - 2 * k));
}

/** the view box, in CSS pixels of the fullscreen stage */
export interface ThBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Where the view goes on a display of `w`×`h`: the whole display when
 * stretched, else the largest 512×264 that fits, centred.
 */
export function viewBox(w: number, h: number, stretch: boolean, screenW = 512): ThBox {
  if (stretch) return { left: 0, top: 0, width: w, height: h };
  const width = Math.min(w, (h * screenW) / VIEW_H);
  const height = (width * VIEW_H) / screenW;
  return { left: (w - width) / 2, top: (h - height) / 2, width, height };
}

export class TylerHartman {
  /** the player's right click: the band shown until the next one */
  private pinned = false;
  private active = false;
  /** the stage is fullscreen (./stretch.ts's `.fs`); else the page */
  private fs = false;
  /** the rows on show now, 264 (the view) to 384 (the whole screen) */
  private rows = VIEW_H;
  /** the slide under way: from, to, and when it started */
  private slide: { from: number; to: number; at: number } | null = null;
  /** the picture was the view last frame, so a change of target is a slide */
  private wasView = true;
  private layoutKey = "";
  private shownRows = 0;
  /** the rim, taken off the canvas and put on the stage in the page */
  private rim: { border: string; borderRadius: string; boxShadow: string } | null = null;

  constructor(
    private readonly stage: HTMLElement,
    private readonly screen: HTMLCanvasElement,
    box: HTMLInputElement | null,
    storageKey: string,
  ) {
    let stored: string | null = null;
    try {
      stored = localStorage.getItem(storageKey);
    } catch {
      /* storage can be denied; the box then starts unticked every launch */
    }
    this.enabled = stored === "1";
    if (!box) return;
    box.checked = this.enabled;
    box.addEventListener("change", () => {
      this.enabled = box.checked;
      try {
        localStorage.setItem(storageKey, box.checked ? "1" : "0");
      } catch {
        /* not remembering is survivable: it still holds for this tab */
      }
    });
  }

  /** the box is ticked */
  enabled: boolean;

  /**
   * The picture's scale changed without its box changing size (a slide ended,
   * or the layout came or went), which no ResizeObserver sees: the cursor,
   * sized to the picture, is drawn again.
   */
  onRescale?: () => void;

  /** the mode is on the screen right now */
  get on(): boolean {
    return this.active;
  }

  /** what the layout is doing, for a trace in the console (`dbg.th.state`) */
  get state(): string {
    return `${this.active ? "on" : "off"} ${this.fs ? "fs" : "page"} rows=${Math.round(this.rows)}${this.pinned ? " pinned" : ""}`;
  }

  /** a right click or a two-finger tap, with the mode on: the band shown, or hidden again */
  toggle(): void {
    this.pinned = !this.pinned;
  }

  /**
   * Once a frame, after the picture is drawn: whether the mode applies and
   * the layout. `view` is whether the picture is the room's view over the
   * band, `answering` whether the band holds answers asked for.
   */
  frame(view: boolean, answering: boolean, now: number): void {
    const active = this.enabled;
    if (active !== this.active) {
      this.active = active;
      if (!active) this.pinned = false;
    }
    this.fs = this.stage.classList.contains("fs");
    const target = !view || this.pinned || answering ? this.screen.height : VIEW_H;
    if (!view || !this.wasView || !active) {
      // a new picture takes the box at once
      this.slide = null;
      this.rows = target;
    } else if ((this.slide?.to ?? this.rows) !== target) {
      this.slide = { from: this.rows, to: target, at: now };
    }
    this.wasView = view;
    if (this.slide) {
      this.rows = slideRows(this.slide.from, this.slide.to, (now - this.slide.at) / SLIDE_MS);
      if (this.rows === this.slide.to) this.slide = null;
    }
    if (!active) {
      if (this.layoutKey) this.unlay();
      return;
    }
    let key = "page";
    if (this.fs) {
      const w = this.stage.clientWidth;
      const h = this.stage.clientHeight;
      const stretch = this.stage.classList.contains("stretch");
      key = `fs${w}x${h}${stretch ? "s" : ""}`;
      if (key !== this.layoutKey) this.layFullscreen(viewBox(w, h, stretch, this.screen.width), key);
    } else if (key !== this.layoutKey) this.layPage(key);
    if (this.rows !== this.shownRows) this.showRows();
  }

  /** the top `rows` of the screen, pulled to the box's height */
  private showRows(): void {
    this.shownRows = this.rows;
    const all = this.screen.height;
    const whole = this.rows >= all;
    this.screen.style.transform = whole ? "" : `scaleY(${all / this.rows})`;
    this.screen.style.clipPath = whole ? "" : `inset(0 0 ${((all - this.rows) / all) * 100}% 0)`;
    if (!this.slide) this.onRescale?.();
  }

  private layFullscreen(v: ThBox, key: string): void {
    this.clear();
    this.layoutKey = key;
    Object.assign(this.screen.style, {
      position: "absolute",
      left: `${v.left}px`,
      top: `${v.top}px`,
      width: `${v.width}px`,
      height: `${v.height}px`,
      transformOrigin: "top",
    });
  }

  private layPage(key: string): void {
    this.clear();
    this.layoutKey = key;
    const cs = getComputedStyle(this.screen);
    this.rim = { border: cs.border, borderRadius: cs.borderRadius, boxShadow: cs.boxShadow };
    Object.assign(this.stage.style, this.rim);
    Object.assign(this.screen.style, {
      aspectRatio: `${this.screen.width} / ${VIEW_H}`,
      objectFit: "fill",
      transformOrigin: "top",
      border: "none",
      borderRadius: "0",
      boxShadow: "none",
    });
  }

  private clear(): void {
    const props = [
      "position", "left", "top", "width", "height", "clipPath", "transform", "transformOrigin",
      "aspectRatio", "objectFit", "border", "borderRadius", "boxShadow",
    ] as const;
    for (const p of props) this.screen.style[p] = "";
    if (this.rim) {
      for (const p of ["border", "borderRadius", "boxShadow"] as const) this.stage.style[p] = "";
      this.rim = null;
    }
    this.shownRows = 0;
  }

  private unlay(): void {
    this.layoutKey = "";
    this.clear();
    this.onRescale?.();
  }
}
