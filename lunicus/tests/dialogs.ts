/**
 * The game window's two dialogs (`src/dialogs.ts`), answered as LUNICUS.EXE's
 * procedures answered them.
 *
 *   npx vitest run lunicus/tests/dialogs.ts
 *
 * The machine suite `tests/machine/scores.ts` hands the game ready answers;
 * this pins what turns a press of a button into one, which otherwise only runs
 * in a browser:
 *
 *   - **High Score** (dlog2, 0x418a98): OK takes the field, an empty field is
 *     no name (0x418af9), Cancel none.
 *   - **Edit Keys** (dlog3, 0x418b72): the seven fields filled in the key
 *     table's order (0x418b9f, 108 Forward … 114 Rockets); OK hands them back,
 *     Default refills them with the EXE's keys and leaves the box up
 *     (0x418d03), Cancel hands back nothing (0x418cc6).
 *   - Neither procedure handles IDCANCEL, so Esc (which the box sends as 2)
 *     does nothing and the box stays up.
 *
 * The box is the engine's DOM dialog (`engine/src/web/window-dialog.ts`),
 * replaced here by a twin with its text fields and its close.
 */
import { test, expect, beforeEach, vi } from "vitest";
import type { WindowDialogOptions, WindowDialogTemplate } from "@dreamfactory/engine/web/window-dialog";
import { EDIT_KEYS, HIGH_SCORE } from "../src/dialogs.gen";

/** the box that is up: its template, its fields, and whether it was closed */
const box = vi.hoisted(() => ({
  template: null as WindowDialogTemplate | null,
  opts: null as WindowDialogOptions | null,
  fields: new Map<number, string>(),
  closed: false,
}));

vi.mock("@dreamfactory/engine/web/window-dialog", () => ({
  IDCANCEL: 2,
  openWindowDialog: (_frame: unknown, t: WindowDialogTemplate, opts: WindowDialogOptions) => {
    box.template = t;
    box.opts = opts;
    return dialog;
  },
}));

const dialog = {
  el: null as unknown as HTMLElement,
  text: (id: number) => box.fields.get(id) ?? "",
  setText: (id: number, s: string) => void box.fields.set(id, s),
  checked: () => false,
  check: () => {},
  close: () => void (box.closed = true),
};
const press = (id: number): void => box.opts!.onCommand(id, dialog);

const { askHighScoreName, editKeys } = await import("../src/dialogs");

const FRAME = {} as HTMLElement;
const KEY_FIELDS = [108, 109, 110, 111, 112, 113, 114];

beforeEach(() => {
  box.template = null;
  box.opts = null;
  box.fields.clear();
  box.closed = false;
});

test("High Score: OK hands back the name typed in, and the box goes", () => {
  const got: (string | null)[] = [];
  askHighScoreName(FRAME, (n) => got.push(n));
  expect(box.template).toBe(HIGH_SCORE);
  box.fields.set(104, "Tester");
  press(101);
  expect(got).toEqual(["Tester"]);
  expect(box.closed).toBe(true);
});

test("High Score: OK on an empty field is no name, and Cancel none, even with one typed", () => {
  const got: (string | null)[] = [];
  askHighScoreName(FRAME, (n) => got.push(n));
  press(101);
  askHighScoreName(FRAME, (n) => got.push(n));
  box.fields.set(104, "Tester");
  press(102);
  expect(got).toEqual([null, null]);
});

test("High Score: Esc (IDCANCEL) and the static text do nothing; the box stays up", () => {
  const got: (string | null)[] = [];
  askHighScoreName(FRAME, (n) => got.push(n));
  press(2);
  press(103);
  expect(got).toEqual([]);
  expect(box.closed).toBe(false);
});

test("Edit Keys opens with the table's keys in the seven fields, Forward to Rockets", () => {
  editKeys(FRAME, ["I", "J", "L", "N", "B", "G", "R"], [..."WADHJKL"], () => {});
  expect(box.template).toBe(EDIT_KEYS);
  expect(KEY_FIELDS.map((f) => box.fields.get(f))).toEqual(["I", "J", "L", "N", "B", "G", "R"]);
  // the template's labels beside them are in the same order (dlog3's static text left of each)
  const labels = EDIT_KEYS.controls.filter((c) => c.kind === "static" && c.id === 65535).map((c) => c.text);
  expect(labels).toEqual(["Forward", "Left", "Right", "Navigate", "Bullets", "Grenades", "Rockets"]);
});

test("Edit Keys: Default puts the EXE's keys in and leaves the box up; OK hands the fields back", () => {
  const got: (string[] | null)[] = [];
  editKeys(FRAME, ["I", "J", "L", "N", "B", "G", "R"], [..."WADHJKL"], (f) => got.push(f));
  press(102);
  expect(got).toEqual([]);
  expect(box.closed).toBe(false);
  expect(KEY_FIELDS.map((f) => box.fields.get(f)).join("")).toBe("WADHJKL");
  box.fields.set(113, "X");
  press(101);
  expect(got).toEqual([["W", "A", "D", "H", "J", "X", "L"]]);
  expect(box.closed).toBe(true);
});

test("Edit Keys: Cancel hands back nothing, whatever was typed; Esc is not Cancel", () => {
  const got: (string[] | null)[] = [];
  editKeys(FRAME, [..."WADHJKL"], [..."WADHJKL"], (f) => got.push(f));
  box.fields.set(108, "Q");
  press(2);
  expect(box.closed).toBe(false);
  press(103);
  expect(got).toEqual([null]);
  expect(box.closed).toBe(true);
});
