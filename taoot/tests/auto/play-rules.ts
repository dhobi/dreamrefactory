/**
 * The play page's rules that need no page (`src/play-rules.ts`): a pointer on
 * the framebuffer, a key's name at the game, the gamma keys and the brightness
 * presets they share a value with, a stored picture mode, the save dialog's
 * name, and the two phrases the input log closes a line with.
 *
 *   npx vitest run --project taoot taoot/tests/auto/play-rules.ts
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_SCREEN_GAMMA, SCREEN_GAMMA_STEP } from "@dreamfactory/engine/web/screen-gamma";
import {
  BRIGHTNESS_PRESETS,
  DF_KEY,
  GAMMA_KEYS,
  canvasPoint,
  defaultSaveName,
  gammaFor,
  gateOf,
  isSpecialKey,
  overlayKey,
  pictureModeOf,
  presetOf,
  whereLine,
  type WhereNow,
} from "../../src/play-rules";

describe("the pointer", () => {
  it("lands on the 512x384 framebuffer, flooring, whatever size CSS shows it at", () => {
    const fb = { width: 512, height: 384 };
    expect(canvasPoint({ clientX: 0, clientY: 0 }, { left: 0, top: 0, width: 1024, height: 768 }, fb)).toEqual({ x: 0, y: 0 });
    expect(canvasPoint({ clientX: 1023, clientY: 767 }, { left: 0, top: 0, width: 1024, height: 768 }, fb)).toEqual({ x: 511, y: 383 });
    expect(canvasPoint({ clientX: 110, clientY: 60 }, { left: 100, top: 50, width: 256, height: 192 }, fb)).toEqual({ x: 20, y: 20 });
  });
});

describe("keys", () => {
  it("names only the four arrows and ESC, as TI.EXE does", () => {
    expect(Object.keys(DF_KEY).sort()).toEqual(["ArrowDown", "ArrowLeft", "ArrowRight", "ArrowUp", "Escape"]);
    expect(DF_KEY.Escape).toBe(".");
  });

  it("hands an overlay stage the DF name, a lower-case letter, or nothing", () => {
    expect(overlayKey("ArrowUp")).toBe("uparrow");
    expect(overlayKey("Escape")).toBe(".");
    expect(overlayKey("Z")).toBe("z");
    expect(overlayKey("Shift")).toBe("");
  });

  it("marks ESC and a Ctrl-held key special, and nothing else", () => {
    expect(isSpecialKey({ key: "Escape", ctrlKey: false })).toBe(true);
    expect(isSpecialKey({ key: "q", ctrlKey: true })).toBe(true);
    expect(isSpecialKey({ key: ".", ctrlKey: false })).toBe(false);
  });

  it("keeps F1-F8 as four channel pairs, F1 the brighter, and F9 the reset", () => {
    expect(GAMMA_KEYS.F1).toEqual({ up: false, ch: [true, true, true] });
    expect(GAMMA_KEYS.F2).toEqual({ up: true, ch: [true, true, true] });
    expect(GAMMA_KEYS.F5).toEqual({ up: false, ch: [false, true, false] });
    expect(GAMMA_KEYS.F9).toBe("reset");
    expect(GAMMA_KEYS.F10).toBeUndefined();
  });
});

describe("brightness", () => {
  it("counts its presets in F1 presses, six either side of the default", () => {
    expect(gammaFor(0)).toBe(DEFAULT_SCREEN_GAMMA);
    expect(gammaFor(BRIGHTNESS_PRESETS.brighter)).toBeCloseTo(DEFAULT_SCREEN_GAMMA / SCREEN_GAMMA_STEP ** 6, 12);
    expect(gammaFor(BRIGHTNESS_PRESETS.darker)).toBeLessThanOrEqual(1);
  });

  it("names the preset a gamma is, and none between two", () => {
    expect(presetOf(DEFAULT_SCREEN_GAMMA)).toBe("default");
    expect(presetOf(gammaFor(6))).toBe("brighter");
    expect(presetOf(gammaFor(-6))).toBe("darker");
    expect(presetOf(gammaFor(1))).toBe("");
  });
});

describe("what the page remembers", () => {
  it("reads a stored picture mode, the old sharp checkbox, or the original", () => {
    expect(pictureModeOf("soft", null)).toBe("soft");
    expect(pictureModeOf(null, "1")).toBe("sharp");
    // the dropdown's own answer outranks the checkbox it replaced
    expect(pictureModeOf("transition", "1")).toBe("transition");
    expect(pictureModeOf("blurry", null)).toBe("original");
    expect(pictureModeOf(null, null)).toBe("original");
  });

  it("offers the room and the minute as a save's name", () => {
    const at = new Date(2026, 0, 2, 3, 4);
    expect(defaultSaveName("b59.set", at)).toBe("b59.set - 2026-01-02 03-04");
    expect(defaultSaveName("", at)).toBe("game - 2026-01-02 03-04");
  });
});

describe("the input log's phrases", () => {
  const room: WhereNow = {
    intro: false,
    movie: null,
    flat: "none",
    viewShowing: true,
    set: "bedsit1",
    scene: "Scene3",
    view: "View20",
    stageOpen: false,
    stage: "none",
  };

  it("says where the game stands, the intro and a film first", () => {
    expect(whereLine({ ...room, intro: true, movie: "logo.mov" })).toBe("the Nightdive intro");
    expect(whereLine({ ...room, movie: "logo.mov" })).toBe("logo.mov");
    expect(whereLine(room)).toBe("bedsit1 — Scene3 / View20");
    expect(whereLine({ ...room, flat: "radio.1" })).toBe('bedsit1 — Scene3 / View20 · flat "radio.1"');
    expect(whereLine({ ...room, viewShowing: false, stageOpen: true, stage: "demo.stg" })).toBe("demo.stg");
    expect(whereLine({ ...room, viewShowing: false })).toBe("no room open");
  });

  it("files a gesture by KEY_SAFE's order: film and talk, then the camera, then the lock", () => {
    const v = { moviePlaying: false, conversing: false, inputLocked: false };
    expect(gateOf(null, false)).toBe("none");
    expect(gateOf({ ...v, moviePlaying: true, inputLocked: true }, true)).toBe("ready");
    expect(gateOf({ ...v, conversing: true }, true)).toBe("ready");
    expect(gateOf({ ...v, inputLocked: true }, true)).toBe("queued");
    expect(gateOf({ ...v, inputLocked: true }, false)).toBe("locked");
    expect(gateOf(v, false)).toBe("ready");
  });
});
