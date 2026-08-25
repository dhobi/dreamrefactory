/**
 * Timelapse's mouse cursors: the art out of `tl.exe`, and what a browser is given.
 *
 *   npx vitest run timelapse/tests/cursors.ts
 *
 * The claims are `tools/dumpcursors.ts`'s — that `cursor(name)` names a
 * `CURS.<NAME>` cursor resource in the engine build, that the seventeen in
 * Timelapse's are 32x32 monochrome with a hotspot, and that the two the game
 * shows most often are its own art. Two of them are checked here by RENDERING:
 * a flipped plane, a swapped palette or a mask read as colour all survive a
 * dimensions test and none of them survive a picture.
 */
import { describe, expect, it } from "vitest";
import { CURSOR_H, CURSOR_MAX_PX, CURSOR_W, CursorSheet, cursorPixels } from "@dreamfactory/engine/web/cursors";
import { TL_CURSORS } from "../src/cursor-art";

/** the cursor as characters: transparent, black ink, white body */
function picture(name: string, scale = 1): string[] {
  const { rgba, width, height } = cursorPixels(TL_CURSORS[name], scale);
  const rows: string[] = [];
  for (let y = 0; y < height; y++) {
    let line = "";
    for (let x = 0; x < width; x++) {
      const p = (y * width + x) * 4;
      line += rgba[p + 3] === 0 ? " " : rgba[p] ? "." : "#";
    }
    rows.push(line);
  }
  return rows;
}

/**
 * Every name the discs pass `cursor(...)`, with how often — counted across all
 * 156 stages' scripts. `HyperLink` and `None` are spelled that way there and
 * nowhere else, which is the whole reason the lookup folds case: Win32 resource
 * names do, so the 1996 engine never noticed.
 */
const CALLED = {
  godown: 6315, goup: 4716, touch: 1335, HyperLink: 342, hand: 239, fist: 81,
  goright: 52, goleft: 51, arrow: 43, watch: 24, None: 1, gorightback: 1, goleftback: 1,
};

describe("Timelapse cursors", () => {
  it("has art for every name the game asks for", () => {
    const sheet = new CursorSheet(TL_CURSORS);
    for (const name of Object.keys(CALLED)) expect(sheet.has(name), name).toBe(true);
    // and nothing else is claimed: the two dropped duplicates were `CURS131`
    // and `CURS2002`, which nothing names
    expect(Object.keys(TL_CURSORS).length).toBe(15);
    expect(sheet.has("goforward")).toBe(false);
  });

  it("decodes CURS.ARROW to the arrow, with the hotspot on its tip", () => {
    // the one that is checkable by eye against any screenshot of the 1996 game:
    // a hollow arrow, white with a black outline, its tail notched
    expect(picture("arrow")).toEqual([
      "                                ",
      "                                ",
      "                                ",
      "                                ",
      "  #                             ",
      "  ##                            ",
      "  #.#                           ",
      "  #..#                          ",
      "  #...#                         ",
      "  #....#                        ",
      "  #.....#                       ",
      "  #......#                      ",
      "  #.......#                     ",
      "  #........#                    ",
      "  #.........#                   ",
      "  #..........#                  ",
      "  #...........#                 ",
      "  #............#                ",
      "  #.......#######               ",
      "  #...#...#                     ",
      "  #..# #...#                    ",
      "  #.#  #...#                    ",
      "  ##    #...#                   ",
      "  #     #...#                   ",
      "         #...#                  ",
      "         #...#                  ",
      "          #...#                 ",
      "          #...#                 ",
      "           ###                  ",
      "                                ",
      "                                ",
      "                                ",
    ]);
    // 2,4 is that tip — the pixel the pointer actually points with, and the
    // reason the rows above it may not be trimmed away
    const art = TL_CURSORS.arrow;
    expect([art.hx, art.hy]).toEqual([2, 4]);
    expect(picture("arrow")[art.hy][art.hx]).toBe("#");
  });

  it("draws Timelapse's own goup, not the plain arrow Titanic uses", () => {
    // the foot. `CURS.GOUP` is byte-identical across the two builds for eleven of
    // the thirteen cursors they share, and this is one of the two it is not:
    // Titanic's is a bare arrow with a stem, this one stands on a plinth. It is
    // 4,716 of this game's 13,200 cursor calls, so it is worth pinning.
    const rows = picture("goup").filter((r) => r.trim());
    expect(rows[0].trim()).toBe("##"); // the point
    expect(rows.at(-1)).toBe("          ############          "); // the base
    expect(rows.at(-2)).toBe("          #..........#          ");
    expect(rows.at(-3)).toBe("          ############          ");
  });

  it("renders three states and nothing else", () => {
    // Windows' fourth — mask 1 over colour 1, "invert the screen here" — has no
    // CSS equivalent, and `tools/dumpcursors.ts` refuses to write a table that
    // uses it. This is the other end of that guarantee.
    for (const [name, art] of Object.entries(TL_CURSORS)) {
      const { rgba, width, height } = cursorPixels(art);
      expect([width, height], name).toEqual([CURSOR_W, CURSOR_H]);
      for (let i = 0; i < rgba.length; i += 4) {
        const alpha = rgba[i + 3];
        expect(alpha === 0 || alpha === 255, `${name} alpha ${alpha}`).toBe(true);
        if (alpha) expect(rgba[i] === 0 || rgba[i] === 255, `${name} grey ${rgba[i]}`).toBe(true);
        expect([rgba[i + 1], rgba[i + 2]], name).toEqual([rgba[i], rgba[i]]);
      }
      expect(art.hx, name).toBeLessThan(CURSOR_W);
      expect(art.hy, name).toBeLessThan(CURSOR_H);
    }
  });

  it("blows a cursor up by whole pixels", () => {
    // the browser would scale an undersized cursor image itself, and blur it.
    // 2x here is exact nearest neighbour, which is what keeps a 1996 pixel a pixel
    const one = picture("touch");
    const two = picture("touch", 2);
    expect(two.length).toBe(2 * CURSOR_H);
    expect(two[0].length).toBe(2 * CURSOR_W);
    for (let y = 0; y < CURSOR_H; y++) {
      for (let x = 0; x < CURSOR_W; x++) {
        const c = one[y][x];
        expect(two[2 * y][2 * x] + two[2 * y][2 * x + 1] + two[2 * y + 1][2 * x] + two[2 * y + 1][2 * x + 1])
          .toBe(c + c + c + c);
      }
    }
    expect(cursorPixels(TL_CURSORS.touch, 3).width).toBe(3 * CURSOR_W);
  });

  it("sizes a cursor to a picture shown at a fraction, not to the integer below it", () => {
    // Titanic shows a 512-wide picture at 1024 CSS pixels, which is a clean 2x.
    // A window narrower than that is not: at 1.4x an integer-only cursor stays
    // 32 px and is 30% too small against the art it sits on, and a stretched
    // fullscreen at 3.75x wanted 120 and got 96. So the bitmap is resampled to
    // the size the picture asks for — nearest neighbour, no blending, so a
    // fractional zoom is an even mix of one- and two-pixel rows.
    expect(cursorPixels(TL_CURSORS.arrow, 1.4).width).toBe(45); // round(32 * 1.4)
    expect(cursorPixels(TL_CURSORS.arrow, 3.75).width).toBe(120);
    // ...and never past what a browser will take: a larger cursor image is
    // ignored outright rather than clamped by the browser
    expect(cursorPixels(TL_CURSORS.arrow, 8).width).toBe(CURSOR_MAX_PX);
    // three states still, and only three, whatever the size
    const { rgba } = cursorPixels(TL_CURSORS.arrow, 1.4);
    for (let i = 0; i < rgba.length; i += 4) {
      expect(rgba[i + 3] === 0 || rgba[i + 3] === 255).toBe(true);
    }
  });

  it("answers the fallback keyword where there is no canvas to draw a PNG on", () => {
    // this suite is `environment: "node"`, which is the same position a worker or
    // a blocked canvas context puts the shell in: a cursor is cosmetic, so the
    // keyword has to carry it alone
    const sheet = new CursorSheet(TL_CURSORS);
    expect(sheet.css("touch")).toBe("pointer");
    expect(sheet.css("arrow")).toBe("default");
    expect(sheet.css("watch")).toBe("wait");
    expect(sheet.css("fist")).toBe("grabbing");
    // no `s-resize`/`n-resize` for the navigation arrows, however well they point:
    // a resize cursor promises a drag and these are single clicks
    expect(sheet.css("godown")).toBe("pointer");
    expect(sheet.css("goup")).toBe("pointer");
    // ...and a name no build has is the arrow rather than a thrown error
    expect(sheet.css("nosuchcursor")).toBe("default");
  });

  it("folds case, because the discs do not", () => {
    const sheet = new CursorSheet(TL_CURSORS);
    expect(sheet.css("HyperLink")).toBe(sheet.css("hyperlink"));
    // `None` is `CURS.NONE`, and it is blank: 1024 transparent pixels. Which is
    // why it is the one that answers a keyword even in a browser — a fully
    // transparent cursor image is one some browsers quietly replace with an arrow
    expect(sheet.css("None")).toBe("none");
    const { rgba } = cursorPixels(TL_CURSORS.none);
    expect(rgba.every((v) => v === 0)).toBe(true);
  });
});
