/**
 * The page's input rules (`src/input.ts`): which key is whose, where a pointer
 * lands on the game's screen, and which regions a finger is not given.
 *
 *   npx vitest run --project timelapse timelapse/tests/input.ts
 */
import { describe, expect, it } from "vitest";
import { parseHTML } from "linkedom";
import { ESCAPE_KEY } from "@dreamfactory/engine/web/keys";
import { isNavRegion, keyAction, screenPoint } from "../src/input";

const key = (k: string, more: Partial<{ metaKey: boolean; ctrlKey: boolean; target: EventTarget | null }> = {}) =>
  keyAction({ key: k, metaKey: false, ctrlKey: false, target: null, ...more });

describe("keys", () => {
  it("sends the arrows by the names the BOOTFILE's router answers to", () => {
    expect(key("ArrowUp")).toEqual({ key: "uparrow", special: false });
    expect(key("ArrowDown")).toEqual({ key: "downarrow", special: false });
    expect(key("ArrowLeft")).toEqual({ key: "leftarrow", special: false });
    expect(key("ArrowRight")).toEqual({ key: "rightarrow", special: false });
    expect(key("Z")).toEqual({ key: "z", special: false });
  });

  it("sends Escape as the movie player's special key", () => {
    expect(key("Escape")).toEqual({ key: ESCAPE_KEY, special: true });
  });

  it("keeps b for the log", () => {
    expect(key("b")).toEqual({ log: true });
  });

  it("leaves the browser's shortcuts and a focused control's keys alone", () => {
    expect(key("r", { ctrlKey: true })).toBeNull();
    expect(key("c", { metaKey: true })).toBeNull();
    const { document } = parseHTML("<html><body><button id=b></button><input id=t></body></html>");
    const button = document.getElementById("b") as unknown as EventTarget;
    const field = document.getElementById("t") as unknown as EventTarget;
    expect(key(" ", { target: button })).toBeNull();
    expect(key("a", { target: field })).toBeNull();
    // the arrows still walk while a button has focus
    expect(key("ArrowUp", { target: button })).toEqual({ key: "uparrow", special: false });
  });
});

describe("the pointer", () => {
  const SCREEN = { width: 640, height: 480 };

  it("lands on the game's 640x480, whatever size the picture is shown at", () => {
    const shown = { left: 100, top: 50, width: 1280, height: 960 };
    expect(screenPoint({ clientX: 100, clientY: 50 }, shown, SCREEN)).toEqual({ x: 0, y: 0 });
    expect(screenPoint({ clientX: 1380, clientY: 1010 }, shown, SCREEN)).toEqual({ x: 640, y: 480 });
    expect(screenPoint({ clientX: 420, clientY: 290 }, { left: 0, top: 50, width: 840, height: 630 }, SCREEN)).toEqual({ x: 320, y: 183 });
  });

  it("knows the four edge regions, by any case, and only as buttons", () => {
    expect(isNavRegion({ type: "button", name: "Right" })).toBe(true);
    expect(isNavRegion({ type: "button", name: "up" })).toBe(true);
    expect(isNavRegion({ type: "button", name: "hyperlink" })).toBe(false);
    expect(isNavRegion({ type: "prop", name: "left" })).toBe(false);
  });
});
