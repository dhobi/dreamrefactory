/**
 * The game window's two dialogs, run as LUNICUS.EXE's procedures ran them.
 *
 * The templates are LUNIRES.DLL's (src/dialogs.gen.ts); the box is the
 * engine's (engine/src/web/window-dialog.ts), on the picture's frame. Neither
 * procedure handles IDCANCEL, so Esc does nothing in either, as it did.
 */
import { openWindowDialog } from "@dreamfactory/engine/web/window-dialog";
import { EDIT_KEYS, HIGH_SCORE } from "./dialogs.gen";

const OK = 101;

/**
 * dlog2 (0x4189c1, its procedure 0x418a98): "You have a high score! Enter your
 * name:" — OK takes the field (an empty one is no name, 0x418af9), Cancel none.
 */
export function askHighScoreName(frame: HTMLElement, done: (name: string | null) => void): void {
  const NAME = 104;
  const CANCEL = 102;
  openWindowDialog(frame, HIGH_SCORE, {
    onCommand(id, d) {
      if (id !== OK && id !== CANCEL) return;
      const name = id === OK ? d.text(NAME) : "";
      d.close();
      done(name || null);
    },
  });
}

/** dlog3's seven fields, in the key table's action order (0x418b9f: 108 Forward … 114 Rockets) */
const FIELDS = [108, 109, 110, 111, 112, 113, 114];

/**
 * dlog3, Settings ▸ Keys (0x418b50, its procedure 0x418b72): each field the
 * key its action has (0x418d7d); OK hands the fields back to be bound
 * (0x418c29), Default puts the EXE's own keys in them and leaves the dialog up
 * (0x418d03), Cancel keeps the table as it was (0x418cc6).
 */
export function editKeys(frame: HTMLElement, fields: string[], defaults: string[], done: (fields: string[] | null) => void): void {
  const DEFAULT = 102;
  const CANCEL = 103;
  const dlg = openWindowDialog(frame, EDIT_KEYS, {
    onCommand(id, d) {
      if (id === DEFAULT) return FIELDS.forEach((f, i) => d.setText(f, defaults[i]));
      if (id !== OK && id !== CANCEL) return;
      const out = FIELDS.map((f) => d.text(f));
      d.close();
      done(id === OK ? out : null);
    },
  });
  FIELDS.forEach((f, i) => dlg.setText(f, fields[i]));
}
