import { ESCAPE_KEY, focusOwnsKey } from "@dreamfactory/engine/web/keys";

/**
 * The four region names Timelapse navigates with.
 *
 * Not a guess and not a heuristic: measured across all 156 stages, `up`, `down`,
 * `left` and `right` are **27,179 of the 29,105** clickable regions on the discs
 * — 93.4%, over 7,967 flats — and the remainder are objects (`hyperlink`,
 * `lefteye`, `hive`, `button10`…). Each one's `mousedown` is a single
 * `sendtoboot(keydown("right"))` and its `setcursor` shows a `goright` arrow, so
 * the game's primary navigation is a click on the edge of the picture with the
 * cursor as the affordance.
 *
 * Which is exactly why they are suppressed on a TOUCHSCREEN. The cursor does not
 * exist there — nothing hovers — so the affordance that makes edge-clicking
 * legible is missing, while the edge of the picture is precisely where a thumb
 * rests. And they are `button` regions, so without this they would take a finger
 * IMMEDIATELY, which means a swipe begun anywhere near an edge navigated by click
 * instead of swiping at all.
 *
 * Nothing is lost by it: the four directions these cover are the four a swipe
 * sends, and both routes end in the same `getframeaction` table.
 */
export const NAV_REGIONS = new Set(["up", "down", "left", "right"]);

/** is what `hitTestAt` found one of the four edge regions? */
export const isNavRegion = (hit: { type: string; name: string }): boolean =>
  hit.type === "button" && NAV_REGIONS.has(hit.name.toLowerCase());

/** what a keystroke on the page is: the log's, the About box's, the game's, or nobody's */
export type KeyAction = { log: true } | { about: true } | { key: string; special: boolean };

const ARROW_KEYS: Record<string, string> = {
  ArrowUp: "uparrow",
  ArrowDown: "downarrow",
  ArrowLeft: "leftarrow",
  ArrowRight: "rightarrow",
};

export function keyAction(e: { key: string; metaKey: boolean; ctrlKey: boolean; target: EventTarget | null }): KeyAction | null {
  if (e.metaKey || e.ctrlKey) return null;
  /**
   * A key that belongs to whatever has focus is not the game's.
   *
   * The page listens on `window`, and it has buttons — and a focused button is
   * worked with SPACE, which is exactly the key one of them sends. Without
   * this, tabbing to it and pressing space would fire the control AND the game.
   * `focusOwnsKey` is the shared rule (engine/src/web/keys.ts): a text field
   * takes every key, a button takes Space and Enter, and the arrows still walk
   * while a control has focus.
   */
  if (focusOwnsKey(e.target, e.key)) return null;
  // Escape is `"."` with the special marker, which is what the movie player
  // tests for — `"esc"` is a name nothing in the engine answers to, so it
  // reached the script chain and skipped no film (see ESCAPE_KEY)
  if (e.key === "Escape") return { key: ESCAPE_KEY, special: true };
  /**
   * `b` is the log, and `x` the Details column it sits in (Titanic's key for
   * it), and neither goes on to the game.
   *
   * Safe to take, and checked rather than assumed: the BOOTFILE's key router
   * (container 1, `keydown`) answers to the arrows, `w`/`s`/`a`/`d`, `z`/`c`
   * and the space — `b` and `x` are not among them, so nothing is being intercepted
   * from the game here.
   */
  if (e.key === "b" || e.key === "x" || e.key === "X") return { log: true };
  /**
   * F12 is tl.exe's About box (engine/src/runtime/about-box.ts): the window
   * proc's F12 arm (0x4055db) calls 0x4060c0, and the key goes no further.
   */
  if (e.key === "F12") return { about: true };
  return { key: ARROW_KEYS[e.key] ?? e.key.toLowerCase(), special: false };
}
