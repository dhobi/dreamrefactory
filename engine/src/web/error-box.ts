import { scriptErrorBoxText } from "../runtime/script-errors";

/**
 * The script error box of TI.EXE and tl.exe, in a browser: `window.confirm`,
 * worded as the original's (runtime/script-errors.ts). OK is the original's
 * "Yes" — go on — and Cancel its "No", which quits the way `quit()` does
 * (GameSession.onScriptErrorBox).
 *
 * Never asked where nobody is there to answer: a speedrun (the workbench marks
 * its page, {@link markUnattended}), a page driven by automation
 * (`navigator.webdriver`, which is every browser suite), or anywhere without a
 * `window` (a worker's calculation, node). Those answer "Yes", the answer that
 * cannot end a run, and log it — a speedrun stays deterministic and a suite
 * never sits on a modal dialog.
 */

let unattended = false;

/** this page plays without a person at the controls — the speedrun workbench */
export function markUnattended(): void {
  unattended = true;
}

function nobodyToAsk(): boolean {
  if (unattended) return true;
  if (typeof window === "undefined" || typeof window.confirm !== "function") return true;
  return typeof navigator !== "undefined" && navigator.webdriver === true;
}

/**
 * The hook for `GameSession.onScriptErrorBox`. `language` is the edition's —
 * the French tree's TI.EXE translates the box, the other six do not.
 */
export function scriptErrorBox(
  log: (line: string) => void,
  language: () => string = () => "en",
): (code: number, detail: string) => boolean {
  return (code, detail) => {
    const text = scriptErrorBoxText(code, language());
    if (nobodyToAsk()) {
      log(`script error box (not shown here): ${text} — answered "Yes" (${detail})`);
      return true;
    }
    return window.confirm(text);
  };
}
