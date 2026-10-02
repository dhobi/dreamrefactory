/**
 * The DreamFactory 0 game window's drawing (engine/src/v0/screen.ts).
 *
 *   npx vitest run engine/tests/v0-screen.ts
 *
 * Lunicus's and Jump Raven's machine suites run with `draws` off: they play the
 * games for what the games DO, and decoding every picture would only slow them.
 * So the window's primitives are checked here, on a picture small enough to
 * write out: where its anchor lands, which way round a mirrored one is, that a
 * clear pixel is left alone, how a stretched one samples, and that nothing is
 * drawn outside the rect it is clipped to or off the window.
 */
import { expect, test } from "vitest";
import type { FrameV0 } from "@dreamfactory/engine/df/image-v0";
import { SCREEN_H, SCREEN_W, Screen } from "@dreamfactory/engine/v0/screen";

/**
 * 3 wide, 2 high, anchored at its middle column's foot:
 *
 *     1 2 .
 *     4 5 6      (. is clear)
 */
const PIC: FrameV0 = {
  width: 3,
  height: 2,
  anchorY: 1,
  anchorX: 1,
  indexed: new Uint8Array([1, 2, 9, 4, 5, 6]),
  opaque: new Uint8Array([1, 1, 0, 1, 1, 1]),
};

/** the window's rows `top`..`top + h`, columns `left`..`left + w` */
const rows = (s: Screen, top: number, left: number, h: number, w: number): number[][] =>
  Array.from({ length: h }, (_, y) => [...s.pixels.subarray((top + y) * SCREEN_W + left, (top + y) * SCREEN_W + left + w)]);

test("a picture's anchor lands on the point, and a clear pixel keeps what was there", () => {
  const s = new Screen();
  s.fill([0, 0, 4, 5], 7);
  s.sprite(PIC, 2, 2);
  expect(rows(s, 0, 0, 4, 5)).toEqual([
    [7, 7, 7, 7, 7],
    [7, 1, 2, 7, 7],
    [7, 4, 5, 6, 7],
    [7, 7, 7, 7, 7],
  ]);
});

test("mirrored, its anchor is measured from its right edge, and it reads right to left", () => {
  const s = new Screen();
  s.spriteMirrored(PIC, 2, 2);
  // its left edge is (width − anchor) left of the point, so it spans columns 0..2
  expect(rows(s, 1, 0, 2, 5)).toEqual([
    [0, 2, 1, 0, 0],
    [6, 5, 4, 0, 0],
  ]);
});

test("both are clipped to the rect they are given, and to the window", () => {
  const s = new Screen();
  s.sprite(PIC, 2, 2, [0, 0, 2, 2]);
  expect(rows(s, 0, 0, 3, 4)).toEqual([
    [0, 0, 0, 0],
    [0, 1, 0, 0],
    [0, 0, 0, 0],
  ]);
  s.spriteMirrored(PIC, 2, 2, [2, 0, 3, 2]);
  expect(rows(s, 2, 0, 1, 4)).toEqual([[6, 5, 0, 0]]);

  // half off the top-left corner and half off the bottom-right: no throw, no wrap
  const t = new Screen();
  t.sprite(PIC, 0, 0);
  t.spriteMirrored(PIC, SCREEN_H, SCREEN_W);
  expect(rows(t, 0, 0, 1, 2)).toEqual([[5, 6]]);
  expect(t.pixels[(SCREEN_H - 1) * SCREEN_W + SCREEN_W - 1]).toBe(2);
  // two of the first, one of the second
  expect(t.pixels.filter((p) => p).length).toBe(3);
});

test("stretched onto a rect, each pixel samples its nearest, and a clear one stays clear", () => {
  const s = new Screen();
  s.fill([0, 0, 4, 6], 7);
  s.spriteScaled(PIC, [0, 0, 4, 6], [0, 0, 4, 5]);
  expect(rows(s, 0, 0, 4, 6)).toEqual([
    [1, 1, 2, 2, 7, 7],
    [1, 1, 2, 2, 7, 7],
    [4, 4, 5, 5, 6, 7],
    [4, 4, 5, 5, 6, 7],
  ]);
  // an empty rect draws nothing
  const before = s.version;
  s.spriteScaled(PIC, [0, 0, 0, 6], [0, 0, 4, 6]);
  expect(s.version).toBe(before);
});

test("a frame is drawn in one ink just inside the rect, and an inverted one undoes itself", () => {
  const s = new Screen();
  s.frame([0, 0, 4, 4], 1, 3);
  expect(rows(s, 0, 0, 4, 4)).toEqual([
    [3, 3, 3, 3],
    [3, 0, 0, 3],
    [3, 0, 0, 3],
    [3, 3, 3, 3],
  ]);
  const was = [...s.pixels];
  s.invertFrame([0, 0, 4, 4], 1);
  expect(rows(s, 0, 0, 2, 4)[0]).toEqual([0xfc, 0xfc, 0xfc, 0xfc]);
  expect(rows(s, 1, 1, 1, 2)[0]).toEqual([0, 0]);
  s.invertFrame([0, 0, 4, 4], 1);
  expect([...s.pixels]).toEqual(was);

  // a pen too thick for the rect inverts all of it
  s.invertFrame([0, 0, 2, 2], 1);
  expect(rows(s, 0, 0, 2, 2)).toEqual([
    [0xfc, 0xfc],
    [0xfc, 0xff],
  ]);
});

test("as RGBA, each pixel is its palette entry, opaque", () => {
  const s = new Screen();
  const pal = new Uint8ClampedArray(256 * 4);
  pal.set([10, 20, 30, 0], 5 * 4);
  s.setPalette(pal);
  s.pixels[1] = 5;
  const out = s.rgba();
  expect([...out.subarray(0, 8)]).toEqual([0, 0, 0, 255, 10, 20, 30, 255]);
  expect(out.length).toBe(SCREEN_W * SCREEN_H * 4);
});
