/**
 * The game window's dialogs, run as RAVEN.EXE's procedures ran them.
 *
 * The templates are RAVENRES.DLL's (src/dialogs.gen.ts); the box is the
 * engine's (engine/src/web/window-dialog.ts), on the picture's frame. Esc is
 * IDCANCEL (2), which none of these procedures handles, so it does nothing,
 * as it did.
 */
import { openWindowDialog } from "@dreamfactory/engine/web/window-dialog";
import { EDIT_KEYS, HIGH_SCORE, PAUSE, QUIT, SOUND } from "./dialogs.gen";

const OK = 101;

/** DLOG2 (0x4227c1): "You have a high score! Enter your name:" — OK the field (empty is none), Cancel none */
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

/** DLOG6 (0x422bda, its procedure 0x422bfd): OK true, Cancel false */
export function askQuit(frame: HTMLElement, done: (ok: boolean) => void): void {
  const CANCEL = 102;
  openWindowDialog(frame, QUIT, {
    onCommand(id, d) {
      if (id !== OK && id !== CANCEL) return;
      d.close();
      done(id === OK);
    },
  });
}

/** DLOG7 (0x422c76, its procedure 0x422c94): "Jump Raven paused...", until OK */
export function pause(frame: HTMLElement, done: () => void): void {
  openWindowDialog(frame, PAUSE, {
    onCommand(id, d) {
      if (id !== OK) return;
      d.close();
      done();
    },
  });
}

/**
 * DLOG8 (0x422ce1, its procedure 0x422cff): Level 1 … Level 7 are 104 … 110
 * (0x67 + the volume, so Sound Off checks none), Theme 111; OK hands back the
 * first level checked — the volume kept if none is — and Theme, Cancel null
 */
export function soundDialog(frame: HTMLElement, volume: number, theme: boolean, done: (a: { volume: number; theme: boolean } | null) => void): void {
  const LEVEL = 0x67;
  const THEME = 111;
  const CANCEL = 102;
  const dlg = openWindowDialog(frame, SOUND, {
    onCommand(id, d) {
      if (id !== OK && id !== CANCEL) return;
      const level = [1, 2, 3, 4, 5, 6, 7].find((v) => d.checked(LEVEL + v)) ?? volume;
      const answer = { volume: level, theme: d.checked(THEME) };
      d.close();
      done(id === OK ? answer : null);
    },
  });
  if (volume > 0) dlg.check(LEVEL + volume, true);
  dlg.check(THEME, theme);
}

/** DLOG3's six fields, in the key table's action order (0x422950: 108 Up … 113 Defense) */
const FIELDS = [108, 109, 110, 111, 112, 113];

/**
 * DLOG3, Settings ▸ Keys (0x422950): each field the key its action has; OK
 * hands the fields back to be bound, Default puts the EXE's own keys in them
 * and leaves the dialog up (0x422ae0), Cancel keeps the table as it was
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
