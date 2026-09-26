/**
 * TH mode's layout maths (src/tylerhartman.ts): where the view goes on a
 * 16:9 display, and the band's slide.
 */
import { test, expect } from "vitest";
import { SLIDE_MS, slideRows, viewBox } from "../../src/tylerhartman";

test("a 16:9 display holds the 512x264 view with thin bars, and fills when stretched", () => {
  const v = viewBox(1920, 1080, false);
  expect(v.width).toBe(1920);
  expect(v.height).toBeCloseTo(990);
  expect(v.top).toBeCloseTo(45);
  expect(viewBox(1920, 1080, true)).toEqual({ left: 0, top: 0, width: 1920, height: 1080 });
  // a display narrower than the view's shape is bounded by its height
  const tall = viewBox(1000, 1000, false);
  expect(tall.width).toBe(1000);
  expect(tall.height).toBeCloseTo(515.625);
});

test("the band slides from the view's rows to the whole screen's, eased, and stops there", () => {
  expect(slideRows(264, 384, 0)).toBe(264);
  expect(slideRows(264, 384, 0.5)).toBe(324);
  expect(slideRows(264, 384, 1)).toBe(384);
  expect(slideRows(264, 384, 2)).toBe(384);
  expect(slideRows(384, 264, 1)).toBe(264);
  // slow at the ends, fast in the middle
  expect(slideRows(264, 384, 0.1) - 264).toBeLessThan(slideRows(264, 384, 0.55) - slideRows(264, 384, 0.45));
  expect(SLIDE_MS).toBeGreaterThan(0);
});
