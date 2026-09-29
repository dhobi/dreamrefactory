/**
 * LUNICUS.EXE's dialogs — GENERATED, do not edit.
 *
 * Regenerate with `npx tsx lunicus/tools/dialogs.ts`: the RT_DIALOG resources
 * DLOG2 and DLOG3 of gamefiles/LUNICUS/lunicus/lunires.dll, in dialog units of the
 * system font (no DS_SETFONT). Each id is the control's Win32 id; what the
 * buttons do is src/dialogs.ts.
 */
import type { WindowDialogTemplate } from "@dreamfactory/engine/web/window-dialog";

/** DLOG2, "High Score" */
export const HIGH_SCORE: WindowDialogTemplate = {
  title: "High Score",
  w: 137,
  h: 76,
  controls: [
    { id: 104, kind: "edit", text: "", x: 6, y: 31, w: 119, h: 13 },
    { id: 101, kind: "button", text: "OK", x: 21, y: 58, w: 46, h: 11, default: true },
    { id: 102, kind: "button", text: "Cancel", x: 72, y: 58, w: 46, h: 11 },
    { id: 103, kind: "static", text: "You have a high score! Enter your name:", x: 5, y: 5, w: 127, h: 22 },
  ],
};

/** DLOG3, "Edit Keys" */
export const EDIT_KEYS: WindowDialogTemplate = {
  title: "Edit Keys",
  w: 168,
  h: 129,
  controls: [
    { id: 65535, kind: "static", text: "Forward", x: 9, y: 10, w: 28, h: 10 },
    { id: 108, kind: "edit", text: "", x: 44, y: 9, w: 28, h: 12 },
    { id: 109, kind: "edit", text: "", x: 44, y: 24, w: 28, h: 12 },
    { id: 65535, kind: "static", text: "Left", x: 9, y: 25, w: 28, h: 10 },
    { id: 110, kind: "edit", text: "", x: 44, y: 39, w: 28, h: 12 },
    { id: 65535, kind: "static", text: "Right", x: 9, y: 40, w: 28, h: 10 },
    { id: 101, kind: "button", text: "OK", x: 9, y: 75, w: 38, h: 10, default: true },
    { id: 102, kind: "button", text: "Default", x: 64, y: 75, w: 38, h: 10 },
    { id: 103, kind: "button", text: "Cancel", x: 117, y: 75, w: 38, h: 10 },
    { id: 121, kind: "static", text: "Cursor keys always go forward, left, or right.  Shift toggles temporarily between the current weapon and navigation mode.  Space bar fires a rocket.", x: 8, y: 88, w: 150, h: 36 },
    { id: 65535, kind: "static", text: "Navigate", x: 90, y: 9, w: 32, h: 10 },
    { id: 111, kind: "edit", text: "", x: 125, y: 8, w: 28, h: 12 },
    { id: 112, kind: "edit", text: "", x: 125, y: 23, w: 28, h: 12 },
    { id: 65535, kind: "static", text: "Bullets", x: 90, y: 24, w: 32, h: 10 },
    { id: 113, kind: "edit", text: "", x: 125, y: 38, w: 28, h: 12 },
    { id: 65535, kind: "static", text: "Grenades", x: 90, y: 39, w: 32, h: 10 },
    { id: 114, kind: "edit", text: "", x: 125, y: 53, w: 28, h: 12 },
    { id: 65535, kind: "static", text: "Rockets", x: 90, y: 54, w: 32, h: 10 },
  ],
};
