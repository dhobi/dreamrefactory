/**
 * Whether a key belongs to whatever has focus, rather than to the game.
 *
 * The play page binds letters: **M** the map, **O** the hotspots, **X** the pane —
 * and every other single character goes to the script chain, because TI.EXE names
 * only four keys and hands the rest to scripts as literal characters (the wireless
 * telegraph key is typed). The page listens on `window`, so until this existed it
 * heard those keys wherever they were typed.
 *
 * Which made the state list's filter box unusable for its most obvious query:
 * typing `mission` toggled the minimap on the M, the hotspot overlay on the O, and
 * sent all seven letters into the running game besides.
 *
 * The save browser had already met this and answered it for itself, with
 * `stopPropagation` on the modal (engine/src/web/save-browser.ts, and its comment says why) —
 * so that box was never broken. This is the same fix made general, which is worth
 * it for a second reason: SPACE is the game's door-opener and was `preventDefault`ed
 * on the way past, so a focused button could not be pressed with it. Measured
 * before and after over the Report button, Space then Enter: **1 activation, then
 * 2**. Enter always worked; Space had never once pressed a button on this page.
 *
 * The rule is the ordinary one for a page with keyboard shortcuts: a control that
 * uses a key gets it, and the game gets the rest. A text field uses all of them; a
 * checkbox uses only Space; a button uses Space and Enter — so the arrows still
 * walk while a checkbox has focus, which matters, because clicking one is how it
 * gets focus in the first place.
 *
 * A `<select>` is the one control that takes the arrows, because that is how a
 * dropdown is worked without a mouse, and the play page has one (the picture
 * setting, #75). Nothing here can soften that without breaking the keyboard for
 * the control itself, so the page hands focus back instead: `bindPictureMode`
 * blurs the dropdown when the answer changes.
 */

/**
 * The two keys whose NAME is not what a page would guess, spelled once.
 *
 * `escape` is `"."` with the special marker — TI.EXE's 0x1fa0 — and it is what
 * `MoviePlayer.key` tests for, so a shell that invents `"esc"` gets a key that
 * reaches the script chain and skips nothing. Measured: Timelapse's `open.mov` is
 * 51 seconds played MODALLY inside `coldBoot()`, and with the wrong name there was
 * no way past it at all.
 *
 * `space` is a literal space because that is what the scripts compare against —
 * `if arg = " "` — and it is load-bearing in two of the three games. *Titanic*
 * opens doors with it: its BOOTFILE's `keydown` scans the current view's hotspots
 * and fires `mousedown` on a painting named `door`, `locked` or `knock`.
 * *Timelapse* opens its whole interface with it: `interfacekey(" ")` toggles
 * `begininterface(1)`, which is `P.Stg` — the journal, the camera and the saved
 * games. A phone has neither key, so a page that wants them has to offer them.
 */
export const ESCAPE_KEY = ".";
export const SPACE_KEY = " ";

/** input types that take TEXT, as opposed to the ones that are a control */
const TEXT_INPUT = new Set([
  "",
  "text",
  "search",
  "password",
  "email",
  "number",
  "tel",
  "url",
  "date",
  "time",
  "month",
  "week",
  "datetime-local",
]);

export function focusOwnsKey(target: EventTarget | null, key: string): boolean {
  const el = target as (Element & { isContentEditable?: boolean }) | null;
  if (!el || typeof el.tagName !== "string") return false;
  if (el.isContentEditable) return true;
  switch (el.tagName) {
    case "TEXTAREA":
    case "SELECT":
      return true;
    case "BUTTON":
      // Space and Enter are how a button is pressed without a mouse — and Space
      // was the one the game took (see above).
      return key === " " || key === "Enter";
    case "INPUT": {
      const type = ((el as HTMLInputElement).type ?? "").toLowerCase();
      if (type === "checkbox" || type === "radio") return key === " ";
      if (type === "button" || type === "submit" || type === "reset") {
        return key === " " || key === "Enter";
      }
      return TEXT_INPUT.has(type);
    }
    default:
      return false;
  }
}

/**
 * Which arrow a swipe means — the gesture half of the same question, and pure so
 * the rule can be tested without a phone.
 *
 * Three of the four are the arrow keys' own reading of the two axes: leftwards
 * turns left, rightwards turns right, away from you walks on. Each axis can be
 * flipped on its own, because neither direction is self-evident (a turn has the
 * panorama reading — the finger pushes the world, not the camera — and walking has
 * the same argument in reverse), so both are checkboxes.
 *
 * The FOURTH used to be nothing at all, on the reasoning that `ArrowDown` is not a
 * navigation key in the original either: it goes to the script chain like any other
 * key, and almost nothing reads it. Almost. The exceptions are
 * `SMSTACK2`/`SMSTACK3` views 43, 50, 54 and 56 — the false smokestack's ladder
 * platforms, whose scene `keydown` is the only way down a level. The way OUT of the
 * smokestack is at level 1, so a player with no `downarrow` could climb the maze
 * and not leave it: a soft-lock rather than a missing convenience (#100).
 *
 * So down is bound, and bound to the plain key event rather than to a navigation
 * press — exactly what the keyboard sends, so the ladder answers and everywhere
 * else it is ignored. Inverting the walk axis swaps the pair, which is what
 * inverting an axis should do and what it could not do while one end was unbound.
 *
 * A diagonal decides nothing: the winning axis has to beat the other by
 * {@link SWIPE_AXIS_RATIO}, or the gesture means no key at all.
 */
export const SWIPE_AXIS_RATIO = 1.3;

export type ArrowKey = "uparrow" | "downarrow" | "leftarrow" | "rightarrow";

export function swipeKey(
  dx: number,
  dy: number,
  invert: { turn: boolean; walk: boolean } = { turn: false, walk: false },
): ArrowKey | null {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (invert.turn) dx = -dx;
  if (invert.walk) dy = -dy;
  if (ay > ax * SWIPE_AXIS_RATIO) return dy < 0 ? "uparrow" : "downarrow";
  if (ax > ay * SWIPE_AXIS_RATIO) return dx < 0 ? "leftarrow" : "rightarrow";
  return null;
}
