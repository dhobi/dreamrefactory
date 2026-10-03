/**
 * Dust's input rules (`src/input.ts`): which key is whose, where a pointer
 * lands on the engine's screen, and the name the save dialog offers.
 *
 *   npx vitest run --project dust dust/tests/input.ts
 */
import { describe, expect, it } from "vitest";
import { parseHTML } from "linkedom";
import { defaultSaveName, keyAction, screenPoint } from "../src/input";

const down = (key: string, more: Partial<{ ctrlKey: boolean; metaKey: boolean; altKey: boolean; repeat: boolean; target: EventTarget | null }> = {}) =>
  keyAction({ key, ctrlKey: false, metaKey: false, altKey: false, repeat: false, target: null, ...more });

describe("keys", () => {
  it("sends the arrows by the names the boot maps, and the letters as they are", () => {
    expect(down("ArrowUp")).toEqual({ key: "uparrow", escape: false, repeat: false });
    expect(down("ArrowDown")).toEqual({ key: "downarrow", escape: false, repeat: false });
    expect(down("ArrowLeft")).toEqual({ key: "leftarrow", escape: false, repeat: false });
    expect(down("ArrowRight")).toEqual({ key: "rightarrow", escape: false, repeat: false });
    // W, A and D have to ARRIVE: the boot's own keydown maps them
    expect(down("W")).toEqual({ key: "w", escape: false, repeat: false });
    expect(down(" ")).toEqual({ key: " ", escape: false, repeat: false });
  });

  it("sends Escape as the movie player's '.', and says when a key is held", () => {
    expect(down("Escape")).toEqual({ key: ".", escape: true, repeat: false });
    expect(down("ArrowUp", { repeat: true })).toEqual({ key: "uparrow", escape: false, repeat: true });
  });

  it("keeps b for the log, either case", () => {
    expect(down("b")).toEqual({ log: true });
    expect(down("B")).toEqual({ log: true });
  });

  it("leaves shortcuts, named keys and a text field's keys alone", () => {
    expect(down("r", { ctrlKey: true })).toBeNull();
    expect(down("r", { metaKey: true })).toBeNull();
    expect(down("r", { altKey: true })).toBeNull();
    expect(down("Shift")).toBeNull();
    const { document } = parseHTML("<html><body><textarea id=t></textarea></body></html>");
    expect(down("w", { target: document.getElementById("t") as unknown as EventTarget })).toBeNull();
  });
});

describe("the page's figures", () => {
  it("floors a pointer onto the engine's 512x384", () => {
    const SCREEN = { width: 512, height: 384 };
    const shown = { left: 0, top: 0, width: 1024, height: 768 };
    expect(screenPoint({ clientX: 1023, clientY: 767 }, shown, SCREEN)).toEqual({ x: 511, y: 383 });
    expect(screenPoint({ clientX: 3, clientY: 3 }, shown, SCREEN)).toEqual({ x: 1, y: 1 });
  });

  it("offers the room, without its extension, and the minute", () => {
    const at = new Date(2026, 9, 3, 21, 7);
    expect(defaultSaveName("TOWN.SET", at)).toBe("TOWN - 2026-10-03 21-07");
    expect(defaultSaveName("", at)).toBe("dust - 2026-10-03 21-07");
    expect(defaultSaveName(undefined, at)).toBe("dust - 2026-10-03 21-07");
  });
});
