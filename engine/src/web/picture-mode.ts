/**
 * The picture-mode dropdown under a game's canvas: how a move lands on a
 * standpoint ({@link GameSession.pictureMode}).
 *
 * Shared by Titanic's play pages and Dust's page. Each game draws its
 * standpoints twice, low-res and hi-res, and its original lands some or all of
 * its moves on the low-res one for a moment; `original` is that, and the other
 * three make every landing the same.
 *
 * The dropdown is BLURRED on change. A `<select>` owns the arrow keys while it
 * has focus (`focusOwnsKey`), and picking a mode is done with a pointer, so
 * leaving focus behind would leave the player unable to turn until they clicked
 * the screen again.
 */
import { isPictureMode, type GameSession, type PictureMode } from "../runtime/session";

/**
 * The picture mode a stored answer means: the dropdown's own key, or Titanic's
 * older checkbox's `"1"` for "always sharp", which a player who ticked it keeps
 * — or the original.
 */
export function pictureModeOf(stored: string | null, legacySharp: string | null): PictureMode {
  const value = stored === null && legacySharp === "1" ? "sharp" : stored;
  return isPictureMode(value) ? value : "original";
}

/**
 * Bind the dropdown to the session, remembering the answer under `storageKey`
 * (`legacySharpKey` is the older checkbox's, read when nothing newer is stored).
 *
 * A page without the control — a speedrun page — keeps the original and does
 * not read the stored answer: in DreamFactory 1 the picture a move starts from
 * decides how many passes it lasts (SetViewer.dfMoveFrames), so a player's
 * setting must not reach a timed run.
 */
export function installPictureMode(
  sel: HTMLSelectElement | null,
  session: GameSession,
  storageKey: string,
  legacySharpKey?: string,
): void {
  if (!sel) return;
  let mode = pictureModeOf(null, null);
  try {
    mode = pictureModeOf(
      window.localStorage.getItem(storageKey),
      legacySharpKey ? window.localStorage.getItem(legacySharpKey) : null,
    );
  } catch {
    /* storage can be denied; the game then starts on the original every launch */
  }
  session.pictureMode = mode;
  for (const o of Array.from(sel.querySelectorAll("option"))) o.selected = o.value === mode;
  sel.addEventListener("change", () => {
    const picked = sel.value;
    if (!isPictureMode(picked)) return;
    session.pictureMode = picked;
    sel.blur(); // give the arrow keys back to the game (see above)
    try {
      window.localStorage.setItem(storageKey, picked);
    } catch {
      /* not remembering is survivable — the setting still holds for this tab */
    }
  });
}
