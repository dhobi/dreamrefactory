/**
 * A game window's dialog box (engine/src/web/window-dialog.ts).
 *
 *   npx vitest run engine/tests/window-dialog.ts
 *
 * A template's controls go where it put them, in dialog units scaled by the
 * frame; a button is a command to the procedure, which closes the box itself;
 * Enter is the default button and Esc IDCANCEL; and while it is up the page is
 * told a dialog is open.
 */
import { beforeEach, expect, test } from "vitest";
import { parseHTML } from "linkedom";
import { IDCANCEL, openWindowDialog, windowDialogOpen, type WindowDialogTemplate } from "@dreamfactory/engine/web/window-dialog";

const NAME: WindowDialogTemplate = {
  title: "High Score",
  w: 137,
  h: 76,
  controls: [
    { id: 104, kind: "edit", text: "", x: 6, y: 31, w: 119, h: 13 },
    { id: 101, kind: "button", text: "OK", x: 21, y: 58, w: 46, h: 11, default: true },
    { id: 102, kind: "button", text: "Cancel", x: 72, y: 58, w: 46, h: 11 },
    { id: 103, kind: "static", text: "Enter your name:", x: 5, y: 5, w: 127, h: 22 },
  ],
};

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
const control = (id: number): HTMLElement => frame.querySelector<HTMLElement>(`[data-id="${id}"]`)!;
const key = (el: Element, k: string): void => void el.dispatchEvent(Object.assign(new win.Event("keydown", { bubbles: true, cancelable: true }), { key: k }));

test("the controls go where the template put them, in dialog units", () => {
  const dlg = openWindowDialog(frame, NAME, { onCommand: () => {} });
  expect(frame.querySelector(".wdlg-caption")?.textContent).toBe("High Score");
  expect(control(101).tagName).toBe("BUTTON");
  expect(control(104).tagName).toBe("INPUT");
  expect(control(103).textContent).toBe("Enter your name:");
  expect(control(104).style.left).toBe("calc(var(--wbar-s, 1) * 12px)");
  expect(control(101).style.width).toBe("calc(var(--wbar-s, 1) * 92px)");
  dlg.close();
});

test("a button is a command; the procedure closes the box; the page knows it is up till then", () => {
  const got: number[] = [];
  const dlg = openWindowDialog(frame, NAME, {
    onCommand: (id, d) => {
      got.push(id);
      if (id === 101) d.close();
    },
  });
  expect(windowDialogOpen()).toBe(true);
  dlg.setText(104, "Tester");
  control(102).dispatchEvent(new win.Event("click", { bubbles: true }));
  expect(got).toEqual([102]);
  expect(frame.querySelector(".wdlg")).not.toBeNull();
  expect(dlg.text(104)).toBe("Tester");
  control(101).dispatchEvent(new win.Event("click", { bubbles: true }));
  expect(got).toEqual([102, 101]);
  expect(frame.querySelector(".wdlg")).toBeNull();
  expect(windowDialogOpen()).toBe(false);
});

test("Enter in a field is the default button; Esc is IDCANCEL", () => {
  const got: number[] = [];
  const dlg = openWindowDialog(frame, NAME, { onCommand: (id) => got.push(id) });
  key(control(104), "Enter");
  key(control(104), "Escape");
  expect(got).toEqual([101, IDCANCEL]);
  dlg.close();
});
