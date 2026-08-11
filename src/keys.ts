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
 * `stopPropagation` on the modal (src/save-browser.ts, and its comment says why) —
 * so that box was never broken. This is the same fix made general, which is worth
 * it for a second reason: SPACE is the game's door-opener and was `preventDefault`ed
 * on the way past, so a focused button could not be pressed with it. Measured
 * before and after over the Report button, Space then Enter: **1 activation, then
 * 2**. Enter always worked; Space had never once pressed a button on this page.
 *
 * The rule is the ordinary one for a page with keyboard shortcuts: a control that
 * uses a key gets it, and the game gets the rest. A text field uses all of them; a
 * checkbox uses only Space; a button uses Space and Enter, and nothing else on the
 * page uses any — so the arrows still walk while a checkbox has focus, which
 * matters, because clicking one is how it gets focus in the first place.
 */

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
