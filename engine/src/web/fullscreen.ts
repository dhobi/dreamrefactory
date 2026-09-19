/**
 * The Fullscreen button, on a phone as well as on a desktop.
 *
 * Every page in the project had its own copy of the same twelve lines:
 * `stage.requestFullscreen().catch(log)`, a `fullscreenchange` listener, and a
 * label that flips. All four copies were broken the same way, and the way is
 * worth writing down because it is not the failure it looks like.
 *
 * ## Why the button was dead on an iPhone and not even noisy about it
 *
 * iPhone Safari does not implement `Element.requestFullscreen` — the iPad does,
 * the iPhone never has; a `<video>` may go fullscreen there and nothing else
 * may. So on that one browser `stage.requestFullscreen` is `undefined`, and
 * `stage.requestFullscreen()` is a **synchronous TypeError on the call**, not a
 * rejected promise. The `.catch()` hung off the end of it therefore never ran:
 * the shells' log lines were unreachable, the error went to the console
 * uncaught, and the button read as simply inert. A promise `.catch` cannot
 * catch a method that is not there, which is why this detects the capability up
 * front instead of finding out afterwards.
 *
 * ## The two routes, and why only one of them styles anything
 *
 * - **Real.** `requestFullscreen` exists and the document is allowed it, so the
 *   UA puts the stage in the top layer and hides its own chrome.
 * - **Faux.** It does not, so the page does the only part it can: pin the stage
 *   over the viewport ({@link FS_CLASS} with `position: fixed; inset: 0`) and
 *   letterbox inside it. The browser's own toolbars stay — nothing on the web
 *   can take those away from an iPhone — but the picture gets every pixel
 *   underneath them, which is the whole of what the button was ever for.
 *
 * What matters is that the two routes share ONE stylesheet path. The pages used
 * to letterbox off `#stage:fullscreen`, and the obvious move was to widen each
 * selector to `#stage:fullscreen, #stage.fs`. That is the trap: a selector list
 * is dropped ENTIRELY by any engine that cannot parse one member of it, so the
 * pseudo would have taken the class down with it on exactly the browsers this
 * exists for. So the pseudo is gone from the sheets altogether. {@link FS_CLASS}
 * is the only thing that letterboxes, this module puts it on by both routes, and
 * `:fullscreen` is left to the UA to mean whatever it means.
 *
 * ## The way out
 *
 * Real fullscreen has Escape and the UA says so. Faux fullscreen has neither —
 * and it is the phone case, where there is no Escape key to have. The button
 * that turned it on is under the picture, which the picture is now covering. So
 * this hangs a small ✕ in the corner of the stage, shown only while the page is
 * doing the filling ({@link FAUX_CLASS} on the body; the chip and the scroll
 * lock are styled in `site/src/chrome.css`). Without it a phone player is shut
 * in — which is worse than a button that does nothing.
 *
 * It is `position: fixed`, so it is out of flow on every page that takes it: the
 * play page letterboxes with a one-cell grid and an in-flow child would have
 * been auto-placed into a second row.
 */

/**
 * The class the stage wears while it is filling the screen — by EITHER route.
 *
 * The pages' letterbox rules key off this and off nothing else; see the note
 * above on why they no longer name `:fullscreen`.
 */
export const FS_CLASS = "fs";

/**
 * The class the body wears while the PAGE is doing the filling rather than the
 * UA. It locks the scroll behind the overlay and reveals the ✕; real fullscreen
 * needs neither, because the document underneath is not on screen at all.
 */
export const FAUX_CLASS = "fs-faux";

/** what the button says while the stage is filling the screen */
export const EXIT_LABEL = "⛶ Exit fullscreen";

export interface FullscreenOptions {
  /**
   * What the button says while it is on. Defaults to {@link EXIT_LABEL}.
   *
   * The label it says while it is OFF is never passed: it is read off the button
   * itself the moment the stage goes up and put back when it comes down, so a
   * translated page keeps its translation without this module owning a string
   * table. (Only the play page translates the label at all — the exit wording is
   * English on every page today, as it was before this module existed.)
   */
  exitLabel?: string;
  /** where to say that the real API refused and the page took over */
  report?: (message: string) => void;
}

/**
 * Wire a Fullscreen button to a stage.
 *
 * `btn` may be null — the speedrun pages share a shell with a play page and do
 * not all carry the control.
 */
export function installFullscreen(
  btn: HTMLElement | null,
  stage: HTMLElement,
  opts: FullscreenOptions = {},
): void {
  const exitLabel = opts.exitLabel ?? EXIT_LABEL;

  /**
   * Whether the real API is worth trying. Both halves are needed: the method is
   * missing on an iPhone, and `fullscreenEnabled` is false in an iframe that was
   * not granted the feature — where the method exists and always rejects.
   */
  const real =
    typeof stage.requestFullscreen === "function" && document.fullscreenEnabled !== false;

  /** whether the PAGE is the one filling the screen right now */
  let faux = false;
  /** what the button said before it was turned on, to be given back after */
  let enterLabel = "";

  const paint = (): void => {
    const on = faux || document.fullscreenElement === stage;
    stage.classList.toggle(FS_CLASS, on);
    document.body.classList.toggle(FAUX_CLASS, faux);
    if (!btn) return;
    if (on) {
      // guarded, so a second paint while already on does not save the exit
      // label as the thing to go back to
      if (btn.textContent !== exitLabel) enterLabel = btn.textContent ?? "";
      btn.textContent = exitLabel;
    } else if (enterLabel) {
      btn.textContent = enterLabel;
    }
  };

  const enterFaux = (): void => {
    faux = true;
    paint();
  };

  const enter = (): void => {
    if (!real) {
      enterFaux();
      return;
    }
    // A rejection here is not the end of the road: the picture can still fill
    // the page, so it does, and the reason goes to the log rather than to a
    // player who asked for a bigger picture and got nothing.
    stage.requestFullscreen().catch((e: Error) => {
      opts.report?.(`fullscreen: ${e.message} — filling the page instead`);
      enterFaux();
    });
  };

  const leave = (): void => {
    if (document.fullscreenElement === stage) void document.exitFullscreen();
    else if (faux) {
      faux = false;
      paint();
    }
  };

  btn?.addEventListener("click", () => {
    if (faux || document.fullscreenElement === stage) leave();
    else enter();
  });

  // The way out of faux fullscreen — see the note at the top. Built here rather
  // than in four pages' markup because it is this module's problem: it exists
  // for the state this module can enter, and `display: none` keeps it out of
  // every other one.
  const chip = document.createElement("button");
  chip.type = "button";
  chip.className = "fsexit";
  chip.textContent = "✕";
  chip.title = exitLabel;
  chip.setAttribute("aria-label", exitLabel);
  chip.addEventListener("click", leave);
  stage.append(chip);

  // The UA's own exits — Escape, the browser's control, a swipe — come through
  // here and nowhere else, which is why the label is painted rather than flipped.
  document.addEventListener("fullscreenchange", paint);
}
