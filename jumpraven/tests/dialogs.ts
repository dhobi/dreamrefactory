/**
 * RAVEN.EXE's dialogs on the page (src/dialogs.ts): what each procedure hands
 * back for its buttons.
 *
 *   npx vitest run jumpraven/tests/dialogs.ts
 *
 * The machine suites stand in for these with callbacks (JumpRavenOptions), so
 * the procedures themselves — which button is OK, which Cancel, what an empty
 * name is, which radio button is the volume, what Default puts in the keys'
 * fields — are pinned here, on RAVENRES.DLL's own templates (src/dialogs.gen.ts)
 * in a linkedom document:
 *
 *   - DLOG2: OK with a name is the name; OK with none, or Cancel, is null
 *   - DLOG6: OK true, Cancel false
 *   - DLOG7: only OK closes it
 *   - DLOG8: it opens on the volume and Theme; OK hands back the level checked
 *     — the volume as it was when none is (Sound Off) — Cancel null
 *   - DLOG3: the six fields in the key table's order; Default fills them with
 *     the EXE's keys and stays up; OK hands the fields back, Cancel null
 *   - Esc is IDCANCEL (2), which no procedure handles: the box stays up
 */
import { beforeEach, expect, test } from "vitest";
import { parseHTML } from "linkedom";
import { windowDialogOpen } from "@dreamfactory/engine/web/window-dialog";
import { askHighScoreName, askQuit, editKeys, pause, soundDialog } from "../src/dialogs";

let frame: HTMLElement;
let win: ReturnType<typeof parseHTML>;
beforeEach(() => {
  win = parseHTML(`<html><body><div id="frame"><canvas></canvas></div></body></html>`);
  const g = globalThis as Record<string, unknown>;
  g.document = win.document;
  g.HTMLInputElement = win.HTMLInputElement;
  g.HTMLButtonElement = win.HTMLButtonElement;
  // linkedom's field has no selection to make
  win.HTMLInputElement.prototype.select = () => {};
  frame = win.document.getElementById("frame") as unknown as HTMLElement;
});

const control = (id: number): HTMLInputElement => frame.querySelector<HTMLInputElement>(`[data-id="${id}"]`)!;
/** a radio button's or check box's own input, inside the label the template's id is on */
const mark = (id: number): HTMLInputElement => control(id).querySelector("input")!;
const press = (id: number): void => void control(id).dispatchEvent(new win.Event("click", { bubbles: true }));
const type = (id: number, text: string): void => void (control(id).value = text);
const escape = (id: number): void =>
  void control(id).dispatchEvent(Object.assign(new win.Event("keydown", { bubbles: true, cancelable: true }), { key: "Escape" }));
const caption = (): string | null | undefined => frame.querySelector(".wdlg-caption")?.textContent;

test("the high score's OK hands back the name typed; OK on an empty field and Cancel are no name", () => {
  const got: (string | null)[] = [];
  askHighScoreName(frame, (name) => got.push(name));
  expect(caption()).toBe("High Score");
  expect(frame.textContent).toContain("You have a high score! Enter your name:");
  type(104, "Raven");
  press(101);
  expect(windowDialogOpen()).toBe(false);

  askHighScoreName(frame, (name) => got.push(name));
  press(101);
  askHighScoreName(frame, (name) => got.push(name));
  type(104, "Ignored");
  press(102);
  expect(got).toEqual(["Raven", null, null]);
});

test("Quit's OK is true and its Cancel false; Esc leaves the question up", () => {
  const got: boolean[] = [];
  askQuit(frame, (ok) => got.push(ok));
  expect(caption()).toBe("Quit");
  escape(101);
  expect(windowDialogOpen()).toBe(true);
  expect(got).toEqual([]);
  press(102);
  askQuit(frame, (ok) => got.push(ok));
  press(101);
  expect(got).toEqual([false, true]);
  expect(windowDialogOpen()).toBe(false);
});

test("Pause waits for its OK and nothing else", () => {
  let done = 0;
  pause(frame, () => done++);
  expect(frame.textContent).toContain("Jump Raven paused...");
  escape(101);
  press(102); // its text, not a button
  expect(done).toBe(0);
  expect(windowDialogOpen()).toBe(true);
  press(101);
  expect(done).toBe(1);
  expect(windowDialogOpen()).toBe(false);
});

test("Sound opens on the volume's level and Theme, and OK hands back what is checked", () => {
  const got: ({ volume: number; theme: boolean } | null)[] = [];
  soundDialog(frame, 3, true, (a) => got.push(a));
  // Level n is 0x67 + n
  expect(mark(0x67 + 3).checked).toBe(true);
  expect(mark(111).checked).toBe(true);
  mark(0x67 + 3).checked = false;
  mark(0x67 + 6).checked = true;
  mark(111).checked = false;
  press(101);
  expect(got).toEqual([{ volume: 6, theme: false }]);
});

test("Sound Off checks no level: OK keeps the volume off, and Cancel hands back nothing", () => {
  const got: ({ volume: number; theme: boolean } | null)[] = [];
  soundDialog(frame, 0, false, (a) => got.push(a));
  expect([1, 2, 3, 4, 5, 6, 7].some((v) => mark(0x67 + v).checked)).toBe(false);
  expect(mark(111).checked).toBe(false);
  press(101);
  soundDialog(frame, 5, false, (a) => got.push(a));
  press(102);
  expect(got).toEqual([{ volume: 0, theme: false }, null]);
});

test("Edit Keys shows the six fields; Default puts the EXE's keys in them and stays up; OK binds them", () => {
  const fields = ["I", "K", "J", "L", "F", "X"];
  const defaults = ["W", "S", "A", "D", "T", " "];
  const got: (string[] | null)[] = [];
  editKeys(frame, fields, defaults, (a) => got.push(a));
  expect(caption()).toBe("Edit Keys");
  // Up, Down, Left, Right, Hover/Fly, Defense: 108 … 113
  expect([108, 109, 110, 111, 112, 113].map((id) => control(id).value)).toEqual(fields);
  press(102);
  expect(windowDialogOpen()).toBe(true);
  expect([108, 109, 110, 111, 112, 113].map((id) => control(id).value)).toEqual(defaults);
  type(112, "G");
  press(101);
  expect(got).toEqual([["W", "S", "A", "D", "G", " "]]);
  expect(windowDialogOpen()).toBe(false);
});

test("Edit Keys' Cancel keeps the table as it was", () => {
  const got: (string[] | null)[] = [];
  editKeys(frame, ["W", "S", "A", "D", "T", " "], ["W", "S", "A", "D", "T", " "], (a) => got.push(a));
  type(108, "Q");
  press(103);
  expect(got).toEqual([null]);
});
