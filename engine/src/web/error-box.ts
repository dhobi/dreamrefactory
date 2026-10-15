import { engineFaultBoxText, scriptErrorBoxText, type EngineFault } from "../runtime/script-errors";
import { aboutBoxText, wordWrapText, type AboutBoxFacts } from "../runtime/about-box";

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
    // wrapped as the box wraps it (TI.EXE 0x4211a0, tl.exe 0x40b930: 0x41a000 /
    // 0x4047a0 before the MessageBox)
    const text = wordWrapText(scriptErrorBoxText(code, language()));
    if (nobodyToAsk()) {
      log(`script error box (not shown here): ${text.replace(/\n/g, " ")} — answered "Yes" (${detail})`);
      return true;
    }
    return window.confirm(text);
  };
}

/**
 * TI.EXE's F12 About box (runtime/about-box.ts), as an alert: the original's
 * MessageBox has an OK button only. The text is wrapped the way the exe wraps it
 * (0x41a000). Logged instead wherever nobody is there to read it (see above).
 */
export function aboutBox(log: (line: string) => void): (facts: AboutBoxFacts) => void {
  return (facts) => {
    const text = wordWrapText(aboutBoxText(facts));
    if (nobodyToAsk() || typeof window.alert !== "function") {
      log(`About box (not shown here): ${text.replace(/\n+/g, " ")}`);
      return;
    }
    window.alert(text);
  };
}

/**
 * The hook for `GameSession.onFault`: the box Windows put over a program a CPU
 * fault ended (runtime/script-errors.ts engineFaultBoxText), as an alert; the
 * session then quits. `exe` names the program, "TI.EXE" or "TL.EXE". Logged
 * instead wherever nobody is there to read it (see above).
 */
export function faultBox(log: (line: string) => void, exe: string): (fault: EngineFault) => void {
  return (fault) => {
    const text = engineFaultBoxText(fault, exe);
    if (nobodyToAsk() || typeof window.alert !== "function") {
      log(`fault box (not shown here): ${text.replace(/\n+/g, " ")}`);
      return;
    }
    window.alert(text);
  };
}
