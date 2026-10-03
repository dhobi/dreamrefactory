/**
 * RedJack's input rules (`src/input.ts`): which key is whose, the arrows' own
 * releases, where a pointer lands on the game's screen, the readout's line and
 * the name the save dialog offers.
 *
 *   npx vitest run --project redjack redjack/tests/input.ts
 */
import { describe, expect, it } from "vitest";
import { parseHTML } from "linkedom";
import { ESCAPE_KEY } from "@dreamfactory/engine/web/keys";
import { arrowUp, defaultSaveName, keyAction, screenPoint, whereLine } from "../src/input";

const down = (key: string, more: Partial<{ metaKey: boolean; ctrlKey: boolean; altKey: boolean; target: EventTarget | null }> = {}) =>
  keyAction({ key, metaKey: false, ctrlKey: false, altKey: false, target: null, ...more });

const { document } = parseHTML("<html><body><button id=b></button><input id=t></body></html>");
const button = document.getElementById("b") as unknown as EventTarget;
const field = document.getElementById("t") as unknown as EventTarget;

describe("keys", () => {
  it("sends the arrows by v5's short names, for the router to remap", () => {
    expect(down("ArrowUp")).toEqual({ key: "up", special: false });
    expect(down("ArrowDown")).toEqual({ key: "down", special: false });
    expect(down("ArrowLeft")).toEqual({ key: "left", special: false });
    expect(down("ArrowRight")).toEqual({ key: "right", special: false });
    expect(down("F1")).toEqual({ key: "f1", special: false });
  });

  it("sends Escape as the film player's special key, and keeps b for the log", () => {
    expect(down("Escape")).toEqual({ key: ESCAPE_KEY, special: true });
    expect(down("b")).toEqual({ log: true });
  });

  it("leaves the browser's shortcuts and a focused control's keys alone", () => {
    expect(down("r", { ctrlKey: true })).toBeNull();
    expect(down("c", { metaKey: true })).toBeNull();
    expect(down("ArrowLeft", { altKey: true })).toBeNull();
    expect(down(" ", { target: button })).toBeNull();
    expect(down("a", { target: field })).toBeNull();
    expect(down("ArrowUp", { target: button })).toEqual({ key: "up", special: false });
  });

  it("lets the arrows come up, and nothing else", () => {
    expect(arrowUp({ key: "ArrowRight", target: null })).toBe("right");
    expect(arrowUp({ key: " ", target: null })).toBeNull();
    expect(arrowUp({ key: "ArrowRight", target: field })).toBeNull();
  });
});

describe("the page's figures", () => {
  it("lands a pointer on the game's 640x480, whatever size the picture is shown at", () => {
    const SCREEN = { width: 640, height: 480 };
    expect(screenPoint({ clientX: 640, clientY: 480 }, { left: 0, top: 0, width: 1280, height: 960 }, SCREEN)).toEqual({ x: 320, y: 240 });
    expect(screenPoint({ clientX: 110, clientY: 60 }, { left: 100, top: 50, width: 320, height: 240 }, SCREEN)).toEqual({ x: 20, y: 20 });
  });

  it("says the room where there is one, and the stage where there is not", () => {
    const s = { currentSetName: "hub", currentSceneName: () => "scene12", currentViewName: () => "node", stageName: "x", currentFlat: "y" };
    expect(whereLine(s)).toBe("set hub · scene scene12 · view node");
    expect(whereLine({ ...s, currentSetName: "" })).toBe("stage x · flat y");
  });

  it("offers the room and the minute as a save's name", () => {
    const at = new Date(2026, 9, 3, 9, 5);
    expect(defaultSaveName("hub.sett", at)).toBe("hub.sett - 2026-10-03 09-05");
    expect(defaultSaveName("", at)).toBe("redjack - 2026-10-03 09-05");
  });
});
