/**
 * Titanic's mouse cursors, out of `ti.exe`.
 *
 *   npx vitest run taoot/tests/auto/cursors.ts
 *
 * The mechanism is `tools/dumpcursors.ts`'s and the rendering is checked once, in
 * `timelapse/tests/cursors.ts`. What is Titanic's own — and what this file is for
 * — is that the ELEVEN cursors its build carries cover every name its scripts
 * ever ask for, and that the two the player sees most are the ones this game
 * drew rather than the ones the next game redrew.
 */
import { describe, expect, it } from "vitest";
import { CURSOR_H, CURSOR_W, CursorSheet, cursorPixels } from "@dreamfactory/engine/web/cursors";
import { TI_CURSORS } from "../../src/cursor-art";

/**
 * Every name the corpus passes `cursor(...)`, with how often — the whole of it,
 * counted across every script in the tree. It is a SHORT list, and that is the
 * point: five names, and the shell used to map exactly these five onto CSS
 * keywords.
 */
const CALLED = { touch: 809, arrow: 75, hand: 36, watch: 18, fist: 2 };

describe("Titanic cursors", () => {
  it("has art for every name the game asks for, and six more", () => {
    const sheet = new CursorSheet(TI_CURSORS);
    for (const name of Object.keys(CALLED)) expect(sheet.has(name), name).toBe(true);
    // eleven, so the six nothing calls are here too: the build's set, not a list
    // of what this game happens to use. Three of them (`goleft`, `goright`,
    // `gostrait`) have no CSS keyword that means what they mean, which is half of
    // why the art is worth carrying.
    expect(Object.keys(TI_CURSORS).sort()).toEqual([
      "arrow", "fist", "godown", "goleft", "goright", "gostrait", "goup", "hand", "sight", "touch", "watch",
    ]);
  });

  it("carries ti.exe's own godown, not the one Timelapse redrew", () => {
    // Timelapse's build shares eleven of these byte for byte and redraws two.
    // Titanic's `godown` is a plain arrow on a stem — no fletching, no plinth —
    // and the shape is the assertion, because it is what a swapped table would
    // change and nothing else would notice.
    const rows: string[] = [];
    const { rgba, width, height } = cursorPixels(TI_CURSORS.godown);
    for (let y = 0; y < height; y++) {
      let line = "";
      for (let x = 0; x < width; x++) {
        const p = (y * width + x) * 4;
        line += rgba[p + 3] === 0 ? " " : rgba[p] ? "." : "#";
      }
      if (line.trim()) rows.push(line);
    }
    expect(rows[0]).toBe("            #######             ");
    expect(rows.at(-1)).toBe("               #                ");
    expect([TI_CURSORS.godown.hx, TI_CURSORS.godown.hy]).toEqual([15, 15]);
  });

  it("renders three states, with every hotspot on the bitmap", () => {
    for (const [name, art] of Object.entries(TI_CURSORS)) {
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

  it("hides the pointer for a name its own build does not carry", () => {
    // `hidecursor()` makes the hover chain answer `none`, and only Timelapse's
    // build has a `CURS.NONE` to draw. Answering `default` here would put the
    // arrow back over a game that had taken the pointer away on purpose.
    const sheet = new CursorSheet(TI_CURSORS);
    expect(sheet.has("none")).toBe(false);
    expect(sheet.css("none")).toBe("none");
  });
});
