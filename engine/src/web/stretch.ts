/**
 * Fullscreen, stretched: the 4:3 picture pulled out to the whole display.
 *
 * Every one of these games draws into a fixed 4:3 framebuffer (512x384, or
 * Timelapse's 640x480 — see ./screen.ts), and fullscreen letterboxes it: the
 * largest 4:3 that fits, on black. That is the original's picture and stays the
 * default. This is the other answer, asked for by players on a 16:9 or 16:10
 * display who would rather have every pixel of the screen than the right shape.
 *
 * ## What it is, and what it is not
 *
 * It is a CSS stretch and nothing else. The framebuffer does not change size, so
 * no script, set, hotspot or film sees a different screen, and the pointer maps
 * back to it as before: every shell converts a click with the canvas's width and
 * height SEPARATELY (`(clientX - left) / width * screenW`, and the same for y),
 * which a non-uniform stretch does not disturb. The one thing that did assume a
 * uniform scale is the cursor, which {@link CursorSheet.css} now takes per axis.
 *
 * ## Why only fullscreen
 *
 * In the page, the picture sits among text and controls that are laid out for
 * its shape; a stretched porthole there reads as broken, not as wide. Fullscreen
 * is where the display's own shape is the only other thing on screen, so that is
 * the only state the class changes anything in. The pages' letterbox rules key
 * off `#stage.fs.stretch`, and the class is on the stage whether or not the
 * stage is filling the screen — so the answer is simply there the next time it
 * does, by either of ./fullscreen.ts's two routes.
 *
 * ## Why a checkbox under the picture
 *
 * The control sits beside the Fullscreen button, which is where the question
 * comes up. It cannot be reached from inside fullscreen — nothing under the
 * picture can — and that is fine for a setting a player picks once for their
 * display; it is remembered per game, like the swipe boxes in ./touch.ts.
 */

/** the class the stage wears while the player has asked for the stretch */
export const STRETCH_CLASS = "stretch";

/**
 * Bind the checkbox to the stage, remembering the answer.
 *
 * `box` may be null — the speedrun pages share a shell with a play page and do
 * not all carry the control — and the remembered answer still applies there.
 */
export function installStretch(
  box: HTMLInputElement | null,
  stage: HTMLElement,
  /** localStorage key, e.g. `"taoot.picture.stretch"` — one per game */
  storageKey: string,
): void {
  let stored: string | null = null;
  try {
    stored = localStorage.getItem(storageKey);
  } catch {
    /* storage can be denied; the picture then starts letterboxed every launch */
  }
  const apply = (on: boolean): void => {
    stage.classList.toggle(STRETCH_CLASS, on);
  };
  apply(stored === "1");
  if (!box) return;
  box.checked = stored === "1";
  box.addEventListener("change", () => {
    apply(box.checked);
    try {
      localStorage.setItem(storageKey, box.checked ? "1" : "0");
    } catch {
      /* not remembering is survivable — the setting still holds for this tab */
    }
  });
}
