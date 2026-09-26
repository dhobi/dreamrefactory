/**
 * TH (Tyler Hartman) mode: the menu band tucked away on a wide display.
 *
 * Named for Tyler Hartman's fullscreen builds of Titanic
 * (https://github.com/TylerHartman/Titanic-Adventure-Out-Of-Time-Fullscreen),
 * whose "Immersive" build shows the 512×264 world view alone during
 * exploration and toggles the band with a right click. This is the same idea
 * for the pages here, and for the two games that share Titanic's screen:
 * Titanic and Dust both draw a 512×384 framebuffer whose top 512×264 is the
 * room (the set's viewport, ./screen.ts) and whose 120 rows under it are the
 * stage's menu band.
 *
 * The view alone is 1.94:1, which a 16:9 display (1.78:1) holds with a thin bar
 * above and below, where the full 4:3 would need a third of its height pulled
 * to fill it. So the mode and ./stretch.ts's "stretch to fill" exclude each
 * other ({@link excludeEachOther}): ticking one unticks the other.
 *
 * With the box ticked the band is hidden, in fullscreen and in the page (a
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
 * Titanic's bedsit desk papers, a menu, a film reaching into the band's rows:
 * {@link ScreenDirector.picture}), is squeezed into the box the same way. It
 * is pulled out of 4:3 further than the view, and that is the answer: the box
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
 * Layout only, like ./stretch.ts: the framebuffer, the scripts and the
 * hotspots see the same 512×384. The canvas's box is the view's shape
 * (fullscreen: the {@link viewBox}; the page: its own width, 512:264), holding
 * the whole screen, and showing `rows` of it is two properties: `scaleY(384 /
 * rows)` from the top, and a `clip-path` cutting the rows below `rows` off. A
 * transform moves the box `getBoundingClientRect` reports with it, so a shell
 * that maps a point per axis against that box (every one here does) and sizes
 * its cursor the same way finds the pixel under it as it always has, and
 * clipped rows take no clicks.
 *
 * The clip would cut the canvas's own rim too (Titanic's brass hairline and
 * glow, Dust's moulding lip), so in the page the rim is handed to an overlay
 * the canvas's size, laid over it and transparent to the pointer, and the
 * canvas keeps its border's width with none of its colour.
 */

/** the menu band's first row: the set viewport is the rows above it */
export const VIEW_H = 264;

/** how long the band takes to slide in or out */
export const SLIDE_MS = 250;

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

/**
 * The rows on show `t` of the way through a slide from `from` to `to`, eased
 * in and out.
 */
export function slideRows(from: number, to: number, t: number): number {
  const k = Math.min(1, Math.max(0, t));
  return from + (to - from) * (k * k * (3 - 2 * k));
}

/**
 * TH and the stretch are two answers to the same display, so ticking one
 * unticks the other; each box's own change handler stores the answer. Both
 * remembered from before they excluded each other, TH keeps it.
 */
export function excludeEachOther(th: HTMLInputElement | null, stretch: HTMLInputElement | null): void {
  if (!th || !stretch) return;
  const untick = (off: HTMLInputElement): void => {
    off.checked = false;
    off.dispatchEvent(new Event("change"));
  };
  th.addEventListener("change", () => {
    if (th.checked && stretch.checked) untick(stretch);
  });
  stretch.addEventListener("change", () => {
    if (stretch.checked && th.checked) untick(th);
  });
  if (th.checked && stretch.checked) untick(stretch);
}

/** a pointer event, as much of one as the two-finger tap reads */
interface FingerEvent {
  pointerId: number;
  pointerType: string;
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
  /** the page layout wants measuring again: the canvas or the window changed size */
  private dirty = true;
  /** the canvas's rim, carried over it in the page (see the class doc) */
  private readonly rim: HTMLDivElement;
  /** the fingers on the glass, for the two-finger tap */
  private readonly fingers = new Set<number>();
  /** the fingers of a two-finger tap, whose lift is TH's and not a gesture's */
  private readonly tapFingers = new Set<number>();
  private readonly screenH: number;

  constructor(
    private readonly stage: HTMLElement,
    private readonly screen: HTMLCanvasElement,
    box: HTMLInputElement | null,
    /** localStorage key, e.g. `"taoot.picture.th"`: one per game */
    storageKey: string,
    private readonly opts: {
      /** the framebuffer's size, which a canvas's backing store need not be yet */
      screenW?: number;
      screenH?: number;
      /** the page layout went on (true) or off: a shell whose page sizes itself from a 4:3 picture follows */
      onPage?: (on: boolean) => void;
    } = {},
  ) {
    this.screenH = opts.screenH ?? 384;
    this.rim = document.createElement("div");
    this.rim.className = "thrim";
    Object.assign(this.rim.style, { display: "none", position: "absolute", pointerEvents: "none", boxSizing: "border-box" });
    screen.after(this.rim);
    new ResizeObserver(() => (this.dirty = true)).observe(screen);
    addEventListener("resize", () => (this.dirty = true));

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
   * A finger down. With the mode on, the second one makes a two-finger tap:
   * the band toggles, `cancel` drops each finger's own gesture (so the tap is
   * no click and no walk), and true says the event is taken.
   */
  touchDown(e: FingerEvent, cancel: (pointerId: number) => void): boolean {
    if (e.pointerType !== "touch") return false;
    this.fingers.add(e.pointerId);
    if (!this.active || this.fingers.size !== 2) return false;
    for (const id of this.fingers) {
      this.tapFingers.add(id);
      cancel(id);
    }
    this.toggle();
    return true;
  }

  /** a finger up or taken away: true when it was a two-finger tap's, which lifts on nothing */
  touchUp(e: { pointerId: number }): boolean {
    this.fingers.delete(e.pointerId);
    return this.tapFingers.delete(e.pointerId);
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
    const target = !view || this.pinned || answering ? this.screenH : VIEW_H;
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
    if (this.fs) {
      const w = this.stage.clientWidth;
      const h = this.stage.clientHeight;
      const stretch = this.stage.classList.contains("stretch");
      const key = `fs${w}x${h}${stretch ? "s" : ""}`;
      if (key !== this.layoutKey) this.layFullscreen(viewBox(w, h, stretch, this.opts.screenW ?? 512), key);
    } else if (this.layoutKey !== "page") this.layPage();
    else if (this.dirty) this.placeRim();
    if (this.rows !== this.shownRows) this.showRows();
  }

  /** the top `rows` of the screen, pulled to the box's height */
  private showRows(): void {
    this.shownRows = this.rows;
    const all = this.screenH;
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

  private layPage(): void {
    this.clear();
    this.layoutKey = "page";
    const cs = getComputedStyle(this.screen);
    Object.assign(this.rim.style, {
      display: "block",
      border: cs.border,
      borderRadius: cs.borderRadius,
      boxShadow: cs.boxShadow,
    });
    Object.assign(this.screen.style, {
      aspectRatio: `${this.opts.screenW ?? 512} / ${VIEW_H}`,
      objectFit: "fill",
      transformOrigin: "top",
      borderColor: "transparent",
      boxShadow: "none",
    });
    this.opts.onPage?.(true);
    this.placeRim();
  }

  /** the rim over the canvas's layout box, which no transform moves */
  private placeRim(): void {
    this.dirty = false;
    const c = this.screen;
    Object.assign(this.rim.style, {
      left: `${c.offsetLeft}px`,
      top: `${c.offsetTop}px`,
      width: `${c.offsetWidth}px`,
      height: `${c.offsetHeight}px`,
    });
  }

  private clear(): void {
    const props = [
      "position", "left", "top", "width", "height", "clipPath", "transform", "transformOrigin",
      "aspectRatio", "objectFit", "borderColor", "boxShadow",
    ] as const;
    for (const p of props) this.screen.style[p] = "";
    if (this.layoutKey === "page") this.opts.onPage?.(false);
    this.rim.style.display = "none";
    this.shownRows = 0;
  }

  private unlay(): void {
    this.clear();
    this.layoutKey = "";
    this.onRescale?.();
  }
}
