/**
 * The pointer on a game page whose session is up for the page's whole life:
 * what *Timelapse*'s and *RedJack*'s `src/main.ts` each wrote line for line.
 *
 * A mouse press is a click; a finger goes through {@link TouchGestures}, which
 * holds its click back until the finger says whether it is a tap, a hold or a
 * swipe; a move keeps the session's pointer live and asks what is under it; and
 * the release and the cancel are heard on the WINDOW, because a drag that ends
 * off the canvas still has to end.
 *
 * What stays in each page is what differs, passed as {@link PointerInputOptions}.
 * Titanic's and Dust's pages are not on this: their pointer waits for a session
 * that comes and goes, notes its input for the speedrun log, hands the right
 * button to TH and the screen to the saved-games dialog — more hooks than lines.
 */
import { clickLabel, inputLabel, type Hit, type InputLog } from "./input-log";
import type { GameHost } from "./host";
import { type GestureKey, type PointerEventLike, TouchGestures, bindSwipeInvert } from "./touch";

/**
 * A pointer layer IN FRONT of the recogniser: each call answers whether it took
 * the event, and the recogniser only hears what it did not take. RedJack's
 * rooms are one (its src/room-touch.ts).
 */
export interface PointerLayer {
  down(e: PointerEvent): boolean;
  /** told of every finger that went down, whoever took it */
  afterDown(e: PointerEvent): void;
  move(e: PointerEvent): boolean;
  up(e: PointerEvent): boolean;
  cancel(e: PointerEvent): boolean;
  /** true where a finger's press is the layer's and not the game's */
  swallowsPress?(x: number, y: number): boolean;
}

/** what a page's pointer does that the other page's does not */
export interface PointerInputOptions {
  /** the page's framebuffer coordinates for a pointer event */
  coords(e: { clientX: number; clientY: number }): { x: number; y: number };
  /** localStorage prefix for the swipe-axis boxes ({@link bindSwipeInvert}) — one per game */
  swipeKey: string;
  /** a mouse press at (x, y): the click, and whatever the page does after it — answered when it is done */
  click(x: number, y: number, e: PointerEvent): unknown;
  /** the cursor the thing under a resting mouse asks for, when the page draws one */
  showCursor?(name: string): void;
  /** true where a finger is free to swipe although the game owns the spot */
  freeForSwipe?(x: number, y: number): boolean;
  /** true where a finger's press is not to reach the game at all */
  swallowsPress?(x: number, y: number): boolean;
  /** the key a gesture sends, when the game names it otherwise */
  gestureKey?(key: GestureKey): string;
  /** a layer in front of the recogniser, built once the recogniser exists */
  front?(touch: TouchGestures): PointerLayer;
  /** the input log every key, click and press goes through (input-log.ts), when the page keeps one */
  inputs?: InputLog;
}

/** what a page keeps of its bound pointer */
export interface PointerInput {
  /** a key a gesture or a keystroke means, on the one route both take */
  sendKey(key: string, special?: boolean): void;
  /** the last finger press handed to the game, answered */
  lastPress(): Promise<unknown>;
}

export function bindPointerInput(host: GameHost, canvas: HTMLCanvasElement, o: PointerInputOptions): PointerInput {
  const s = host.session;
  const sendKey = (key: string, special = false): void => {
    // a gesture is never a held key: the boot's `keyrepeat` sets `isrepeat` and
    // its scripts read it, so a stale true from a leant-on arrow must not make
    // this look like a repeat. The engine's own false: `false` before
    // DreamFactory 5, 0 in it.
    s.interp.globals.set("isrepeat", s.interp.bool(false));
    note(inputLabel(key), () => host.director.keyDown(key, special));
  };
  /** a gesture, through the page's input log when it keeps one */
  const note = (what: string, dispatch: () => unknown, hit?: () => Hit | null): void => {
    if (o.inputs) o.inputs.note(what, dispatch, hit);
    else void dispatch();
  };
  const hitAt = (x: number, y: number) => (): Hit => s.hitTestAt(x, y);

  // which way the two swipe axes read, remembered for this game alone
  const swipeInvert = bindSwipeInvert(o.swipeKey);

  let pressed: Promise<unknown> = Promise.resolve();
  const touch = new TouchGestures({
    coords: (e: PointerEventLike) => o.coords(e),
    // props and buttons take their press at once so a drag works; the picture
    // keeps the wait, because swiping the picture is how a phone walks
    ownedByGame: (x, y) => {
      if (o.freeForSwipe?.(x, y)) return false;
      const kind = s.hitTestAt(x, y).type;
      return kind === "prop" || kind === "button";
    },
    press: (x, y) => {
      if (o.swallowsPress?.(x, y) || front?.swallowsPress?.(x, y)) return;
      note(clickLabel(x, y), () => (pressed = s.track(host.director.buttonDown(x, y), `press ${x},${y}`)), hitAt(x, y));
    },
    release: (x, y) => {
      if (!s.pointerDown) return; // the press was swallowed: nothing to let go of
      host.director.buttonUp(x, y);
    },
    sendKey: (key: GestureKey, special: boolean) => sendKey(o.gestureKey?.(key) ?? key, special),
    // read at RELEASE, so a box ticked mid-gesture applies to that gesture
    invert: () => swipeInvert,
  });
  const front = o.front?.(touch);

  canvas.addEventListener("pointerdown", (e) => {
    const { x, y } = o.coords(e);
    s.setPointer(x, y);
    // a finger is ambiguous until it moves or stays put — see TouchGestures
    if (e.pointerType === "touch") {
      if (!front?.down(e)) touch.down(e);
      front?.afterDown(e);
      return;
    }
    note(clickLabel(x, y), () => o.click(x, y, e), hitAt(x, y));
  });

  // on the window, not the canvas: a drag that ends off-canvas still has to end
  addEventListener("pointermove", (e) => {
    const { x, y } = o.coords(e);
    s.setPointer(x, y);
    if (front?.move(e)) return;
    if (touch.owns(e)) {
      touch.move(e);
      return;
    }
    if (e.pointerType === "touch") return;
    // the cursor the thing under the pointer asks for, through the same chain
    const hover = host.director.hover(x, y);
    if (o.showCursor) void hover.then(o.showCursor);
  });

  addEventListener("pointerup", (e) => {
    if (front?.up(e)) return;
    if (touch.up(e)) return;
    if (!s.pointerDown) return;
    const { x, y } = o.coords(e);
    host.director.buttonUp(x, y);
  });

  /** a gesture the browser took away (a system edge-swipe) */
  addEventListener("pointercancel", (e) => {
    if (!front?.cancel(e)) touch.cancel(e);
  });

  return { sendKey, lastPress: () => pressed };
}
