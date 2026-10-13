/**
 * Aiming at a thing too small for the sweep grid.
 *
 *   npx vitest run engine/tests/aim-small.ts
 *
 * The engines size a far world sprite by truncating (sprite-scaler.ts), so
 * Titanic's pocket watch on the c73 table is drawn 6x3 and the 4-pixel grid can
 * step right over it. The aim then sweeps every pixel of the thing's own box.
 */
import { expect, test } from "vitest";
import { AIM_STEP, aimAtThing, type Aim } from "@dreamfactory/engine/web/speedrun/aim";

/** a screen with one thing on it: `watch`, a row of pixels at y = 172 */
const screen = (boxes?: Aim["boxes"]): Aim & { asked: number } => {
  const a = {
    asked: 0,
    width: 512,
    height: 264,
    inFlat: false,
    hitTest: (x: number, y: number) => {
      a.asked++;
      return y === 172 && x >= 110 && x <= 115 ? { name: "watch", type: "prop" } : { name: "", type: "scene" };
    },
    propUnder: () => null,
    hotspot: () => null,
    boxes,
  };
  return a;
};

test("the grid alone steps over a one-row sprite", () => {
  // 172 is not on the grid: it starts at 2 and steps by AIM_STEP
  expect((172 - 2) % AIM_STEP).not.toBe(0);
  expect(aimAtThing(screen(), "watch")).toBeNull();
});

test("its own box finds it, at a pixel the hit test agrees is it", () => {
  const a = screen((n) => (n === "watch" ? [{ x0: 110, y0: 170, x1: 115, y1: 172 }] : []));
  expect(aimAtThing(a, "watch")).toEqual({ x: 110, y: 172 });
});

test("a thing that is not there costs the grid and nothing more", () => {
  const a = screen(() => []);
  expect(aimAtThing(a, "ghost")).toBeNull();
  const grid = Math.ceil((512 - 2) / AIM_STEP) * Math.ceil((264 - 2) / AIM_STEP);
  expect(a.asked).toBe(grid);
});
