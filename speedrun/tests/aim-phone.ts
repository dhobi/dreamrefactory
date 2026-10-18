/**
 * An aim still lands on its thing on a canvas drawn smaller than 1:1 — a phone.
 *
 *   npx vitest run speedrun/tests/aim-phone.ts
 *
 * Measured on phone Chrome and Safari: `click(watch)` in c73 left the pocket
 * watch on the table, and the deck map then refused `mapJump(gstair1)`
 * ("Jumping to red areas disabled"). The sweep met each thing at its top-left
 * pixel; at about 375 px across some framebuffer pixels have no client pixel of
 * their own, and a click aimed at one floors to the pixel beside it, outside
 * (aim.ts, `sweep`).
 */
import { test, expect } from "vitest";
import { aimAtThing, type Aim } from "@dreamfactory/speedrun/aim";
import { clientPointFor } from "@dreamfactory/speedrun/driver";

const SCREEN = { width: 640, height: 480 };

/** a canvas `width` px across, its top-left on fractional client pixels as a phone lays it out */
const rectFor = (width: number) => ({ left: 7.796875, top: 120.40625, width, height: (width * 3) / 4 });

/** the page's own conversion of a client point back to a screen pixel (taoot/src/play-rules.ts canvasPoint) */
const back = (c: { x: number; y: number }, r: ReturnType<typeof rectFor>) => ({
  x: Math.floor(((c.x - r.left) / r.width) * SCREEN.width),
  y: Math.floor(((c.y - r.top) / r.height) * SCREEN.height),
});

/** an Aim over named rectangles, sending its clicks through a canvas `width` px across */
function screenOf(
  things: { name: string; type: string; x0: number; y0: number; x1: number; y1: number }[],
  width: number,
  inFlat: boolean,
): Aim {
  const r = rectFor(width);
  return {
    ...SCREEN,
    inFlat,
    hitTest: (x, y) => {
      const t = things.find((b) => x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1);
      return t ? { name: t.name, type: t.type } : { name: "", type: "scene" };
    },
    propUnder: () => null,
    where: inFlat ? (n) => things.filter((b) => b.name.toLowerCase() === n) : undefined,
    boxes: (n) => things.filter((b) => b.name.toLowerCase() === n),
    hotspot: () => null,
    reach: (x, y) => back(clientPointFor(x, y, r, SCREEN), r),
  };
}

const WIDTHS = [320, 360, 374.390625, 390, 412, 640, 1280];

test("a click aimed at the gstair1 stairwell reaches it on a phone", () => {
  // the boat deck page's two stairwells side by side (MAP.STG "Map 1")
  const map = [
    { name: "Button26", type: "button", x0: 300, y0: 174, x1: 348, y1: 196 },
    { name: "Button27", type: "button", x0: 348, y0: 130, x1: 383, y1: 192 },
  ];
  for (const width of WIDTHS) {
    const a = screenOf(map, width, true);
    const at = aimAtThing(a, "button27")!;
    const to = back(clientPointFor(at.x, at.y, rectFor(width), SCREEN), rectFor(width));
    expect(a.hitTest(to.x, to.y).name, `${width} px across`).toBe("Button27");
  }
});

test("a click aimed at the c73 pocket watch, 6x3 on the table, reaches it on a phone", () => {
  const room = [{ name: "watch", type: "prop", x0: 300, y0: 278, x1: 305, y1: 280 }];
  for (const width of WIDTHS) {
    const a = screenOf(room, width, false);
    const at = aimAtThing(a, "watch")!;
    const to = back(clientPointFor(at.x, at.y, rectFor(width), SCREEN), rectFor(width));
    expect(a.hitTest(to.x, to.y).name, `${width} px across`).toBe("watch");
  }
});
