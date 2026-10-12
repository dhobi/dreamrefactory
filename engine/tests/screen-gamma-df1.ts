/**
 * Dust's display gamma: DF.EXE's curve, truncated the way DF.EXE stores it.
 *
 *   npx vitest run engine/tests/screen-gamma-df1.ts
 *
 * DF.EXE builds its tables at 0x422060 as `pow(i / 255.0, 0.75) * 255.0` through
 * `_ftol`, which truncates. TI.EXE's ramp rounds, and must keep rounding: the
 * choice is per game, made once at boot.
 */
import { afterEach, expect, test } from "vitest";
import {
  displayChannel,
  displayPalette,
  screenGammaGeneration,
  setScreenGamma,
  setScreenGammaRounding,
} from "@dreamfactory/engine/web/screen-gamma";

/** DF.EXE's table, straight from the formula at 0x422060 */
const dfTable = Array.from({ length: 256 }, (_, i) => Math.trunc(255 * Math.pow(i / 255, 0.75)));

afterEach(() => {
  setScreenGammaRounding("round");
  setScreenGamma(0.65);
});

test("Dust's ramp is DF.EXE's table, byte for byte", () => {
  setScreenGammaRounding("trunc");
  setScreenGamma(0.75);
  for (let c = 0; c < 256; c++) {
    for (const ch of [0, 1, 2] as const) expect(displayChannel(c, ch), `channel ${ch}, ${c}`).toBe(dfTable[c]);
  }
});

test("rounding stays the default, and is not DF.EXE's table", () => {
  setScreenGamma(0.75);
  const rounded = Array.from({ length: 256 }, (_, c) => displayChannel(c, 0));
  expect(rounded).toEqual(dfTable.map((_, c) => Math.round(255 * Math.pow(c / 255, 0.75))));
  // the two disagree on about half the levels, which is why the choice matters
  expect(rounded.filter((v, c) => v !== dfTable[c]).length).toBeGreaterThan(100);
});

test("changing the rounding rebuilds the ramps and tells the caches, once", () => {
  setScreenGamma(0.75);
  const before = screenGammaGeneration();
  // a level the two disagree on
  const c = dfTable.findIndex((v, i) => v !== Math.round(255 * Math.pow(i / 255, 0.75)));
  const rounded = displayChannel(c, 1);
  setScreenGammaRounding("trunc");
  expect(screenGammaGeneration()).toBe(before + 1);
  expect(displayChannel(c, 1)).toBe(dfTable[c]);
  expect(displayChannel(c, 1)).not.toBe(rounded);
  // asking for what is already set changes nothing, so no cache is invalidated
  setScreenGammaRounding("trunc");
  expect(screenGammaGeneration()).toBe(before + 1);
});

test("the reserved black and white survive the truncating curve", () => {
  setScreenGammaRounding("trunc");
  setScreenGamma(0.75);
  const clut = new Uint8ClampedArray(256 * 4);
  clut.set([0, 0, 0, 255], 0);
  clut.set([255, 255, 255, 255], 255 * 4);
  const out = displayPalette(clut);
  expect([...out.subarray(0, 4)]).toEqual([0, 0, 0, 255]);
  expect([...out.subarray(255 * 4)]).toEqual([255, 255, 255, 255]);
});
