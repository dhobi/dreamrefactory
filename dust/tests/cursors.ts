/**
 * Dust's mouse cursors, out of `DF.EXE`.
 *
 *   npx vitest run dust/tests/cursors.ts
 *
 * DreamFactory 1's set, and the reason it is worth its own file: the Dust shell
 * never asked for a cursor at all — no `hover` call anywhere — so all 285 of its
 * `cursor(...)` calls went nowhere, including the three `sight` crosshairs and
 * the direction arrows that are the only sign a doorway can be walked through.
 */
import { describe, expect, it } from "vitest";
import { CURSOR_H, CURSOR_W, CursorSheet, cursorPixels } from "@dreamfactory/engine/web/cursors";
import { DF_CURSORS } from "../src/cursor-art";

/** every name Dust's scripts pass `cursor(...)`, with how often */
const CALLED = { touch: 205, arrow: 40, watch: 34, sight: 3, gostrait: 1, goright: 1, goleft: 1 };

describe("Dust cursors", () => {
  it("has art for every name the game asks for", () => {
    const sheet = new CursorSheet(DF_CURSORS);
    for (const name of Object.keys(CALLED)) expect(sheet.has(name), name).toBe(true);
    // nine, and the two nothing asks for are `hand` and `fist` — v1's set has no
    // `godown`/`goup` at ALL, which is the other half of the same fact: no Dust
    // script asks for one either. The shipped set and the corpus agree.
    expect(Object.keys(DF_CURSORS).sort()).toEqual([
      "arrow", "fist", "goleft", "goright", "gostrait", "hand", "sight", "touch", "watch",
    ]);
    expect(sheet.has("godown")).toBe(false);
    expect(sheet.has("goup")).toBe(false);
  });

  it("renders three states, with every hotspot on the bitmap", () => {
    for (const [name, art] of Object.entries(DF_CURSORS)) {
      const { rgba, width, height } = cursorPixels(art);
      expect([width, height], name).toEqual([CURSOR_W, CURSOR_H]);
      for (let i = 0; i < rgba.length; i += 4) {
        const alpha = rgba[i + 3];
        expect(alpha === 0 || alpha === 255, `${name} alpha ${alpha}`).toBe(true);
      }
      expect(art.hx, name).toBeLessThan(CURSOR_W);
      expect(art.hy, name).toBeLessThan(CURSOR_H);
    }
  });

  it("draws the crosshair the three `sight` calls are for", () => {
    // 3 calls out of 285, and no keyword mapping would have been wrong exactly —
    // `crosshair` is the fallback — but this is the artwork, and it is a ringed
    // sight rather than a plain cross
    const { rgba, width } = cursorPixels(DF_CURSORS.sight);
    const at = (x: number, y: number) => rgba[(y * width + x) * 4 + 3] !== 0;
    const art = DF_CURSORS.sight;
    expect(at(art.hx, art.hy), "drawn at its own hotspot").toBe(true);
    // the four arms reach the edges of the drawing and the corners stay clear
    expect(at(art.hx, 8) || at(art.hx, 9)).toBe(true);
    expect(at(2, 2)).toBe(false);
  });
});
