/**
 * The two dialog procedures both DreamFactory 0 games (Lunicus, Jump Raven)
 * run the same way, over their own templates: the high-score name and the
 * Settings ▸ Keys box. The games' wrappers say where each sits in its EXE
 * (lunicus/src/dialogs.ts, jumpraven/src/dialogs.ts); the box is
 * {@link openWindowDialog}'s.
 *
 * A module of its own rather than more of window-dialog.ts, so a test that
 * stands a twin in for the box (lunicus/tests/dialogs.ts) still catches these.
 */
import { openWindowDialog, type WindowDialogTemplate } from "./window-dialog";

/** OK, in both games' templates (LUNIRES.DLL's and RAVENRES.DLL's) */
const OK = 101;

/** "You have a high score! Enter your name:" — OK takes the field (104; an empty one is no name), Cancel (102) none */
export function askName(frame: HTMLElement, t: WindowDialogTemplate, done: (name: string | null) => void): void {
  const NAME = 104;
  const CANCEL = 102;
  openWindowDialog(frame, t, {
    onCommand(id, d) {
      if (id !== OK && id !== CANCEL) return;
      const name = id === OK ? d.text(NAME) : "";
      d.close();
      done(name || null);
    },
  });
}

/**
 * Settings ▸ Keys over the key fields `ids`, in the key table's action order:
 * each field the key its action has; OK (101) hands the fields back to be
 * bound, Default (102) puts the EXE's own keys in them and leaves the dialog
 * up, Cancel (103) keeps the table as it was. The two games differ only in how
 * many fields there are and which.
 */
export function editKeyFields(
  frame: HTMLElement,
  t: WindowDialogTemplate,
  ids: readonly number[],
  fields: string[],
  defaults: string[],
  done: (fields: string[] | null) => void,
): void {
  const DEFAULT = 102;
  const CANCEL = 103;
  const dlg = openWindowDialog(frame, t, {
    onCommand(id, d) {
      if (id === DEFAULT) return ids.forEach((f, i) => d.setText(f, defaults[i]));
      if (id !== OK && id !== CANCEL) return;
      const out = ids.map((f) => d.text(f));
      d.close();
      done(id === OK ? out : null);
    },
  });
  ids.forEach((f, i) => dlg.setText(f, fields[i]));
}
