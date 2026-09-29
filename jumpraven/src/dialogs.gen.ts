/**
 * RAVEN.EXE's dialogs — GENERATED, do not edit.
 *
 * Regenerate with `npx tsx jumpraven/tools/dialogs.ts`: the RT_DIALOG resources
 * DLOG2, DLOG3, DLOG6, DLOG7, DLOG8 of gamefiles/RAVEN/RAVEN/RAVENRES.DLL, in dialog units of the
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
  w: 166,
  h: 117,
  controls: [
    { id: 115, kind: "static", text: "Up", x: 9, y: 10, w: 28, h: 10 },
    { id: 108, kind: "edit", text: "Text", x: 44, y: 9, w: 28, h: 12 },
    { id: 109, kind: "edit", text: "Text", x: 44, y: 24, w: 28, h: 12 },
    { id: 116, kind: "static", text: "Down", x: 9, y: 25, w: 28, h: 10 },
    { id: 110, kind: "edit", text: "Text", x: 44, y: 39, w: 28, h: 12 },
    { id: 117, kind: "static", text: "Left", x: 9, y: 40, w: 28, h: 10 },
    { id: 111, kind: "edit", text: "Text", x: 44, y: 54, w: 28, h: 12 },
    { id: 118, kind: "static", text: "Right", x: 9, y: 55, w: 28, h: 10 },
    { id: 119, kind: "static", text: "Hover/Fly", x: 82, y: 10, w: 38, h: 10 },
    { id: 112, kind: "edit", text: "Text", x: 124, y: 9, w: 28, h: 12 },
    { id: 113, kind: "edit", text: "Text", x: 124, y: 24, w: 28, h: 12 },
    { id: 120, kind: "static", text: "Defense", x: 82, y: 25, w: 38, h: 10 },
    { id: 101, kind: "button", text: "OK", x: 9, y: 75, w: 38, h: 10, default: true },
    { id: 102, kind: "button", text: "Default", x: 64, y: 75, w: 38, h: 10 },
    { id: 103, kind: "button", text: "Cancel", x: 117, y: 75, w: 38, h: 10 },
    { id: 121, kind: "static", text: "Cursor keys always go up, down, left, or right.  Shift key toggles temporarily between hover and fly.", x: 8, y: 88, w: 150, h: 28 },
  ],
};

/** DLOG6, "Quit" */
export const QUIT: WindowDialogTemplate = {
  title: "Quit",
  w: 138,
  h: 57,
  controls: [
    { id: 103, kind: "static", text: "Are you sure that you want to quit and go to the high scores screen?", x: 5, y: 6, w: 126, h: 33 },
    { id: 101, kind: "button", text: "OK", x: 25, y: 39, w: 39, h: 11, default: true },
    { id: 102, kind: "button", text: "Cancel", x: 73, y: 39, w: 39, h: 11 },
  ],
};

/** DLOG7, "Pause" */
export const PAUSE: WindowDialogTemplate = {
  title: "Pause",
  w: 148,
  h: 55,
  controls: [
    { id: 102, kind: "static", text: "Jump Raven paused...", x: 8, y: 13, w: 136, h: 19, center: true },
    { id: 101, kind: "button", text: "OK", x: 54, y: 38, w: 39, h: 11, default: true },
  ],
};

/** DLOG8, "Sound" */
export const SOUND: WindowDialogTemplate = {
  title: "Sound",
  w: 128,
  h: 129,
  controls: [
    { id: 104, kind: "radio", text: "Level 1", x: 5, y: 16, w: 48, h: 13 },
    { id: 105, kind: "radio", text: "Level 2", x: 5, y: 28, w: 48, h: 13 },
    { id: 106, kind: "radio", text: "Level 3", x: 5, y: 40, w: 48, h: 13 },
    { id: 107, kind: "radio", text: "Level 4", x: 5, y: 52, w: 48, h: 13 },
    { id: 108, kind: "radio", text: "Level 5", x: 5, y: 63, w: 48, h: 13 },
    { id: 109, kind: "radio", text: "Level 6", x: 5, y: 75, w: 48, h: 13 },
    { id: 110, kind: "radio", text: "Level 7", x: 5, y: 87, w: 48, h: 13 },
    { id: 111, kind: "check", text: "Theme", x: 67, y: 16, w: 57, h: 14 },
    { id: 101, kind: "button", text: "OK", x: 17, y: 108, w: 46, h: 11, default: true },
    { id: 102, kind: "button", text: "Cancel", x: 68, y: 108, w: 46, h: 11 },
    { id: 103, kind: "static", text: "Sound volume:", x: 3, y: 4, w: 121, h: 12 },
  ],
};
