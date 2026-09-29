/**
 * The game window's menu bar (engine/src/web/window-bar.ts).
 *
 *   npx vitest run engine/tests/window-bar.ts
 *
 * The bar goes inside the frame that holds the canvas, above the picture; a
 * label in the resource's own spelling (`&Open...\tCtrl+O`) gives its text, its
 * underlined letter and its hint; and while a menu is open the bar has the keys,
 * so the game under it hears none. The keys are listened for on `window`, which
 * a plain EventTarget stands in for here.
 */
import { beforeEach, expect, test } from "vitest";
import { parseHTML } from "linkedom";
import { attachWindowBar, parseAccelerator, parseMenuLabel, type WindowMenu } from "@dreamfactory/engine/web/window-bar";

const MENUS: WindowMenu[] = [
  {
    label: "&File",
    items: [
      { id: "201", label: "&New\tCtrl+N" },
      { id: "202", label: "&Open...\tCtrl+O" },
      { separator: true },
      { id: "204", label: "E&xit\tCtrl+Q" },
    ],
  },
  {
    label: "Se&ttings",
    items: [
      { id: "401", label: "&Beginner\tCtrl+B" },
      { id: "402", label: "&Intermediate\tCtrl+I", checked: true },
      { id: "406", label: "&Keys...\tCtrl+K", disabled: true },
    ],
  },
];

let win: EventTarget;
let doc: Document;
let frame: HTMLElement;
let ElEvent: typeof Event;

beforeEach(() => {
  const w = parseHTML(`<html><body><div id="frame"><canvas id="screen"></canvas></div></body></html>`);
  doc = w.document as unknown as Document;
  ElEvent = w.Event as unknown as typeof Event;
  frame = doc.getElementById("frame") as unknown as HTMLElement;
  win = new EventTarget();
  const g = globalThis as Record<string, unknown>;
  g.document = doc;
  g.addEventListener = win.addEventListener.bind(win);
  g.removeEventListener = win.removeEventListener.bind(win);
  g.ResizeObserver = class {
    observe(): void {}
    disconnect(): void {}
  };
});

const key = (type: "keydown" | "keyup", k: string, mods: Partial<Record<"altKey" | "ctrlKey" | "shiftKey", boolean>> = {}): Event => {
  const e = Object.assign(new Event(type, { cancelable: true }), { key: k, altKey: false, ctrlKey: false, shiftKey: false, metaKey: false, ...mods });
  win.dispatchEvent(e);
  return e;
};
const press = (el: Element, type: string): void => void el.dispatchEvent(new ElEvent(type, { bubbles: true, cancelable: true }));
const titles = (): HTMLElement[] => [...frame.querySelectorAll<HTMLElement>(".wbar-title")];
const item = (id: string): HTMLElement => frame.querySelector<HTMLElement>(`.wbar-item[data-id="${id}"]`)!;
const openDrop = (): HTMLElement | undefined => [...frame.querySelectorAll<HTMLElement>(".wbar-drop")].find((d) => !d.hidden);

test("a resource label gives its text, its underlined letter and its hint", () => {
  expect(parseMenuLabel("&Open...\tCtrl+O")).toEqual({ text: "Open...", key: "o", hint: "Ctrl+O" });
  expect(parseMenuLabel("Sound Of&f\tCtrl+0")).toEqual({ text: "Sound Off", key: "f", hint: "Ctrl+0" });
  expect(parseMenuLabel("About Lunicus...")).toEqual({ text: "About Lunicus...", key: null, hint: "" });
  expect(parseMenuLabel("Fish && &Chips")).toEqual({ text: "Fish & Chips", key: "c", hint: "" });
  expect(parseAccelerator("Ctrl+O")).toEqual({ key: "o", shift: false });
  expect(parseAccelerator("F1")).toBeNull();
});

test("the bar goes on the frame, above the canvas, and a click on an item selects it", () => {
  const picked: string[] = [];
  attachWindowBar(frame, MENUS, { onSelect: (id) => picked.push(id) });
  expect(frame.firstElementChild?.className).toBe("wbar");
  expect(frame.classList.contains("wbar-on")).toBe(true);
  expect(titles().map((t) => t.textContent)).toEqual(["File", "Settings"]);
  expect(titles()[1].querySelector("u")?.textContent).toBe("t");
  expect(openDrop()).toBeUndefined();

  press(titles()[0], "pointerdown");
  expect(openDrop()?.textContent).toContain("Open...");
  press(item("202"), "click");
  expect(picked).toEqual(["202"]);
  expect(openDrop()).toBeUndefined();
});

test("a disabled item does nothing; a checked one shows its mark; both change", () => {
  const picked: string[] = [];
  const bar = attachWindowBar(frame, MENUS, { onSelect: (id) => picked.push(id) });
  press(titles()[1], "pointerdown");
  press(item("406"), "click");
  expect(picked).toEqual([]);
  expect(item("402").querySelector(".wbar-check")?.textContent).toBe("✓");

  bar.enable("406", true);
  bar.check("402", false);
  bar.check("401", true);
  expect(item("402").querySelector(".wbar-check")?.textContent).toBe("");
  expect(item("401").getAttribute("aria-checked")).toBe("true");
  press(item("406"), "click");
  expect(picked).toEqual(["406"]);
});

test("Alt+letter opens a menu, the arrows walk it over the disabled items, Enter picks", () => {
  const picked: string[] = [];
  const bar = attachWindowBar(frame, MENUS, { onSelect: (id) => picked.push(id) });
  const e = key("keydown", "t", { altKey: true });
  expect(e.defaultPrevented).toBe(true);
  expect(bar.active).toBe(true);
  expect(openDrop()?.textContent).toContain("Beginner");
  key("keydown", "ArrowDown");
  key("keydown", "ArrowDown"); // Keys... is disabled: back round to Beginner
  expect(item("401").classList.contains("hot")).toBe(true);
  key("keydown", "ArrowLeft"); // to File, its first item
  expect(item("201").classList.contains("hot")).toBe(true);
  key("keydown", "Enter");
  expect(picked).toEqual(["201"]);
  expect(bar.active).toBe(false);
});

test("Alt alone is menu mode; a letter then opens that menu; Esc backs out a level at a time", () => {
  const bar = attachWindowBar(frame, MENUS, { onSelect: () => {} });
  key("keydown", "Alt");
  key("keyup", "Alt");
  expect(bar.active).toBe(true);
  expect(titles()[0].classList.contains("hot")).toBe(true);
  key("keydown", "t");
  expect(openDrop()?.textContent).toContain("Beginner");
  key("keydown", "Escape");
  expect(openDrop()).toBeUndefined();
  expect(bar.active).toBe(true);
  key("keydown", "Escape");
  expect(bar.active).toBe(false);
});

test("with a menu open the game hears no key; with none open it hears them all", () => {
  const heard: string[] = [];
  const bar = attachWindowBar(frame, MENUS, { onSelect: () => {} });
  // registered after the bar, as a game's listener is: capture order stands in for window-before-document
  win.addEventListener("keydown", (e) => heard.push((e as KeyboardEvent).key), true);
  key("keydown", "ArrowUp");
  press(titles()[0], "pointerdown");
  key("keydown", "ArrowUp");
  key("keydown", "Escape");
  key("keydown", "Escape");
  key("keydown", "ArrowUp");
  expect(bar.active).toBe(false);
  expect(heard).toEqual(["ArrowUp", "ArrowUp"]);
});

test("accelerators are keys only when asked for, and not on a disabled item", () => {
  const picked: string[] = [];
  attachWindowBar(frame, MENUS, { onSelect: (id) => picked.push(id), accelerators: true });
  expect(key("keydown", "o", { ctrlKey: true }).defaultPrevented).toBe(true);
  key("keydown", "k", { ctrlKey: true });
  key("keydown", "o");
  expect(picked).toEqual(["202"]);
});

test("a hidden bar draws nothing and opens no menu, but its accelerators still work", () => {
  const picked: string[] = [];
  const bar = attachWindowBar(frame, MENUS, { onSelect: (id) => picked.push(id), hidden: true, accelerators: true });
  expect(bar.el.hidden).toBe(true);
  expect(frame.classList.contains("wbar-on")).toBe(false);
  expect(key("keydown", "f", { altKey: true }).defaultPrevented).toBe(false);
  key("keydown", "Alt");
  key("keyup", "Alt");
  expect(bar.active).toBe(false);
  key("keydown", "b", { ctrlKey: true });
  expect(picked).toEqual(["401"]);
  bar.destroy();
});

test("no keys while the page says so; destroy takes the bar away", () => {
  let modal = true;
  const bar = attachWindowBar(frame, MENUS, { onSelect: () => {}, hidden: true, keys: () => !modal });
  modal = false;
  bar.show();
  modal = true;
  expect(key("keydown", "f", { altKey: true }).defaultPrevented).toBe(false);
  modal = false;
  expect(key("keydown", "f", { altKey: true }).defaultPrevented).toBe(true);
  bar.destroy();
  expect(frame.querySelector(".wbar")).toBeNull();
  expect(key("keydown", "f", { altKey: true }).defaultPrevented).toBe(false);
});
