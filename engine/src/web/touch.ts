/**
 * A finger on the glass — swipe to walk and turn, tap to click, double-tap for
 * escape, hold to drag.
 *
 * A phone has no arrow keys, and these games are navigated with arrow keys. The
 * whole difficulty is that a finger going down is AMBIGUOUS: it begins a tap (a
 * game click) and a swipe (a key press) at the same time, and which one it turns
 * out to be is only knowable later. So the mousedown is held back until the
 * gesture declares itself — it travels far enough ({@link SWIPE_MIN_PX}, and then
 * no click is ever sent), it lifts first (a tap), or it stays put past
 * {@link TAP_HOLD_MS} (a press, handed over while the finger is still down).
 *
 * ## Why this is a module and not a third copy
 *
 * It was a copy, twice: `taoot/src/main.ts` and `dust/src/main.ts` each carry the
 * same two hundred lines, and only the pure direction rule ({@link swipeKey}, in
 * `keys.ts`) was ever shared. Timelapse would have been the third, and three
 * copies of a state machine is where the copies start to disagree — the two that
 * exist already do, in ways nobody chose: Dust clears `shiftDown` on a tap and
 * Titanic does not, one listens for `pointermove` on the canvas and the other on
 * the window.
 *
 * What is genuinely per-game is the DISPATCH, and that is what {@link TouchHooks}
 * is for. Titanic's three movement arrows go through `pressNav` past a possible
 * overlay stage; Dust and Timelapse route every key through `keyDown`, because
 * their boot scripts do their own arrow mapping. The recogniser above that does
 * not care which.
 *
 * The shells still own their own listeners, because where a listener SITS is a
 * fact about their pages (`pointerup` on the window so a drag that ends off-canvas
 * still ends), and because a shell has non-touch pointers to handle either way.
 * This owns the state machine and nothing else.
 *
 * ## What the page owes it
 *
 * `touch-action: none` on the canvas, or the browser claims a vertical drag for
 * scrolling and the walk-forward swipe never arrives. Scoped to the canvas, so
 * the page still scrolls.
 */
import { ESCAPE_KEY, swipeKey } from "./keys";

/** CSS px a finger must travel before the gesture counts as a swipe */
export const SWIPE_MIN_PX = 48;

/** a finger still on the glass this long is holding a control, not swiping */
export const TAP_HOLD_MS = 220;

/**
 * Two taps in the same place this close together are the phone's ESCAPE — the key
 * a cutscene is skipped with. Only the SECOND tap is swallowed: the first has
 * already gone out as a click, because holding every tap back to see whether
 * another follows would put 300 ms of lag on every press in the game.
 */
export const DOUBLE_TAP_MS = 320;
export const DOUBLE_TAP_PX = 48;

/** the four axis-aligned arrows a swipe can mean, plus the escape a double-tap is */
export type GestureKey = "uparrow" | "downarrow" | "leftarrow" | "rightarrow" | typeof ESCAPE_KEY;

/**
 * The parts that belong to a game rather than to the gesture.
 *
 * Every one of them may be called while the game is not running — a finger can
 * land on the canvas before the boot finishes — so each is allowed to answer
 * "nothing to do": `coords` returns null and the gesture is dropped before it
 * starts.
 */
export interface TouchHooks {
  /**
   * Framebuffer coordinates for a pointer event, or null when there is no game
   * to give them to. This is the shell's own CSS-px-to-screen-px scaling, which
   * differs per page — Dust blits its 512×384 screen into a 1024×768 canvas, so
   * its divisor is the SCREEN and not the canvas.
   */
  coords(e: PointerEventLike): { x: number; y: number } | null;
  /**
   * True where a finger is holding a CONTROL rather than the world.
   *
   * A finger that goes down on a control is never a swipe: a drag has to move at
   * once, and waiting out {@link TAP_HOLD_MS} to disambiguate would rule an
   * inventory drag (`INVEN.PRP`'s `stdmouse`, a `while stilldown()` loop) a swipe
   * and walk the camera instead of carrying the item. Room and flat surfaces keep
   * the wait, because swiping the world is how a phone walks.
   *
   * Normally `session.hitTestAt(x, y).type` being `"prop"` or `"button"`.
   */
  ownedByGame(x: number, y: number): boolean;
  /**
   * Deliver a mousedown at (x, y). The hook owns setting `session.pointerDown`
   * first — held-button poll loops (`while stilldown()`) read it — and owns
   * tracking the promise; this class never awaits it, because a press may not
   * resolve until a close-up it opened is dismissed and the matching mouseup
   * belongs to the tap rather than to whatever the tap started.
   */
  press(x: number, y: number): void;
  /** deliver the matching mouseup, and clear `session.pointerDown` */
  release(x: number, y: number): void;
  /** a key the gesture means, on the same route the keyboard uses */
  sendKey(key: GestureKey, special: boolean): void;
  /**
   * How the player has asked the two swipe axes to read, called at RELEASE so a
   * setting changed mid-gesture still applies to it. Neither direction is
   * self-evident — a turn has the panorama reading, where the finger pushes the
   * world rather than the camera — which is why both are a question and not a
   * constant.
   */
  invert?(): { turn: boolean; walk: boolean };
}

/**
 * The fields of a `PointerEvent` this recogniser reads.
 *
 * Named rather than taking `PointerEvent` so the state machine can be tested
 * without a DOM — which matters, because the two copies this replaces had no
 * tests at all and the speedrun driver deliberately steers around the touch path
 * (`pointerType: "mouse"`) rather than exercise it.
 */
export interface PointerEventLike {
  pointerId: number;
  clientX: number;
  clientY: number;
}

/** a gesture in flight */
interface Gesture {
  id: number;
  /** where the finger went down: CSS px for the swipe... */
  clientX: number;
  clientY: number;
  /** ...and framebuffer px for the tap, which lands where it STARTED */
  x: number;
  y: number;
  /** the game has been given its mousedown (a hold, being dragged) */
  pressed: boolean;
  /** ruled a swipe — no click will be sent */
  swiped: boolean;
  holdTimer: ReturnType<typeof setTimeout> | null;
}

/**
 * The recogniser. One finger at a time — a second `pointerdown` replaces the
 * first, because none of these games has a two-finger gesture and tracking one
 * `pointerId` is what makes "which finger lifted?" answerable.
 */
export class TouchGestures {
  private g: Gesture | null = null;
  /**
   * The previous tap, for the double-tap test — CSS px and a timestamp.
   *
   * `-Infinity` and not `0`, because 0 is a TIME as well as a sentinel: the
   * escape branch below clears this to mean "no previous tap", and a clock that
   * reads 0 makes `now - lastTapAt < DOUBLE_TAP_MS` true for a FIRST tap. In a
   * page `performance.now()` is never exactly 0 by the time a finger arrives, but
   * a tap inside the first 320 ms of the document's life hit it, and sent the
   * ESCAPE a cutscene is skipped with instead of a click. Found by the first
   * tests this recogniser has ever had (engine/tests/touch.ts), which drive an
   * injected clock from 0 — which is to say: found because the clock is
   * injectable, which is why it is.
   */
  private lastTapAt = -Infinity;
  private lastTapX = 0;
  private lastTapY = 0;

  constructor(
    private readonly hooks: TouchHooks,
    /** injectable so a test can drive the clock; `performance.now` in a page */
    private readonly now: () => number = () => performance.now(),
  ) {}

  /** is a gesture in flight, and is this event the finger that owns it? */
  owns(e: PointerEventLike): boolean {
    return this.g !== null && e.pointerId === this.g.id;
  }

  /**
   * A touch pointer went down. Returns false when there was no game to hand it
   * to, so the caller can decide what a click before the boot means.
   */
  down(e: PointerEventLike): boolean {
    const at = this.hooks.coords(e);
    if (!at) return false;
    if (this.g?.holdTimer) clearTimeout(this.g.holdTimer);
    const control = this.hooks.ownedByGame(at.x, at.y);
    this.g = {
      id: e.pointerId,
      clientX: e.clientX,
      clientY: e.clientY,
      x: at.x,
      y: at.y,
      pressed: false,
      swiped: false,
      holdTimer: control ? null : setTimeout(() => this.hold(), TAP_HOLD_MS),
    };
    // a control takes its press at once: see TouchHooks.ownedByGame
    if (control) this.hold();
    return true;
  }

  /**
   * The finger moved. Commits to a swipe once it has travelled far enough — but
   * the DIRECTION is read at release, off the whole journey, so a wobbly first
   * few pixels do not get to choose it.
   */
  move(e: PointerEventLike): void {
    const g = this.g;
    if (!g || e.pointerId !== g.id) return;
    if (g.pressed || g.swiped) return; // already committed either way
    if (Math.hypot(e.clientX - g.clientX, e.clientY - g.clientY) < SWIPE_MIN_PX) return;
    g.swiped = true;
    if (g.holdTimer) clearTimeout(g.holdTimer);
    g.holdTimer = null;
  }

  /**
   * The finger lifted — the one place all four outcomes are decided. Returns
   * false when the event belongs to no gesture of ours, which is the caller's
   * signal to run its ordinary mouse release instead.
   */
  up(e: PointerEventLike): boolean {
    const g = this.g;
    if (!g || e.pointerId !== g.id) return false;
    if (g.holdTimer) clearTimeout(g.holdTimer);
    this.g = null;

    if (g.pressed) {
      // it was a hold: end it the way any other release does, at the point the
      // finger reached rather than the one it started from
      const at = this.hooks.coords(e);
      this.hooks.release(at?.x ?? g.x, at?.y ?? g.y);
      return true;
    }
    if (g.swiped) {
      const key = swipeKey(
        e.clientX - g.clientX,
        e.clientY - g.clientY,
        this.hooks.invert?.() ?? { turn: false, walk: false },
      );
      // a diagonal decides nothing (swipeKey), and nothing is sent — deliberately
      // not the nearest axis, because a gesture that could be either should not
      // be guessed at
      if (key) this.hooks.sendKey(key, false);
      return true;
    }
    // a second tap in the same place, promptly: that is ESC, not a click
    const t = this.now();
    if (
      t - this.lastTapAt < DOUBLE_TAP_MS &&
      Math.hypot(e.clientX - this.lastTapX, e.clientY - this.lastTapY) < DOUBLE_TAP_PX
    ) {
      // so a third tap is a fresh first, not another escape
      this.lastTapAt = -Infinity;
      this.hooks.sendKey(ESCAPE_KEY, true);
      return true;
    }
    this.lastTapAt = t;
    this.lastTapX = e.clientX;
    this.lastTapY = e.clientY;
    // a tap: down and up at the point the finger LANDED, not where it lifted
    this.hooks.press(g.x, g.y);
    this.hooks.release(g.x, g.y);
    return true;
  }

  /**
   * A gesture the browser took away — a system edge-swipe, usually. Forget it and
   * act on nothing, except that a press already handed over has to be let go of
   * or the game is left with the button down for ever.
   */
  cancel(e: PointerEventLike): void {
    const g = this.g;
    if (!g || e.pointerId !== g.id) return;
    if (g.holdTimer) clearTimeout(g.holdTimer);
    this.g = null;
    if (g.pressed) this.hooks.release(g.x, g.y);
  }

  /** the finger stayed put: it is a press after all, so hand the mousedown over */
  private hold(): void {
    const g = this.g;
    if (!g || g.pressed || g.swiped) return;
    g.holdTimer = null;
    g.pressed = true;
    this.hooks.press(g.x, g.y);
  }
}

/**
 * How the player has asked the two swipe axes to read, and where that is
 * remembered.
 *
 * Neither direction is self-evident, which is why both are a question rather than
 * a constant. The default is the arrow keys' own reading — the swipe points where
 * you go — but a turn has the PANORAMA reading too, where the finger pushes the
 * world rather than the camera, and walking has the same argument in reverse. So
 * each axis is a checkbox and each is remembered.
 *
 * The persistence is here rather than in each shell because it was already
 * written twice, character for character, in `taoot/src/main.ts` and
 * `dust/src/main.ts`. What legitimately differs is only the storage NAMESPACE: a
 * player who inverted Titanic's turn has said nothing about Timelapse's, so each
 * game passes its own prefix and they do not read each other's answer.
 */
export interface SwipeInvert {
  turn: boolean;
  walk: boolean;
}

/**
 * Bind two checkboxes to a live {@link SwipeInvert}, remembering each.
 *
 * Returns the object the recogniser should read through `TouchHooks.invert` —
 * live, so a box ticked mid-gesture applies to that gesture, and safe to call on
 * a page where the elements are absent (a shell that offers no options still gets
 * a working default).
 *
 * `reveal` is shown only where a swipe is possible at all: on a desktop the
 * question is noise, because a mouse has the arrow keys and never reaches a
 * gesture. `maxTouchPoints` as WELL as the media query, because a laptop with a
 * touchscreen reports a FINE pointer while still delivering `pointerType ===
 * "touch"` — the gesture is live there, so the setting has to be reachable.
 */
export function bindSwipeInvert(opts: {
  /** localStorage prefix, e.g. `"timelapse.swipe"` — one namespace per game */
  storageKey: string;
  turnBox: HTMLInputElement | null;
  walkBox: HTMLInputElement | null;
  /** the container to unhide when a finger is possible */
  reveal?: HTMLElement | null;
}): SwipeInvert {
  const invert: SwipeInvert = { turn: false, walk: false };
  const touchable = navigator.maxTouchPoints > 0 || matchMedia("(pointer: coarse)").matches;
  if (!touchable) return invert;
  if (opts.reveal) opts.reveal.hidden = false;

  const bind = (box: HTMLInputElement | null, key: string, apply: (on: boolean) => void): void => {
    if (!box) return;
    let stored: string | null = null;
    try {
      stored = localStorage.getItem(key);
    } catch {
      /* storage can be denied; the box then starts unchecked every launch */
    }
    box.checked = stored === "1";
    apply(box.checked);
    box.addEventListener("change", () => {
      apply(box.checked);
      try {
        localStorage.setItem(key, box.checked ? "1" : "0");
      } catch {
        /* not remembering is survivable — the setting still holds for this tab */
      }
    });
  };
  bind(opts.turnBox, `${opts.storageKey}.invertturn`, (on) => (invert.turn = on));
  bind(opts.walkBox, `${opts.storageKey}.invertwalk`, (on) => (invert.walk = on));
  return invert;
}
