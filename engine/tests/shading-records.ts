/**
 * DreamFactory 5's lighting records (engine/src/runtime/shading.ts): which
 * group a sprite hangs from, gammas composed at their limits, and the palettes
 * built once per record and handed back the same after.
 *
 *   npx vitest run engine/tests/shading-records.ts
 *
 * Needs no game data.
 */
import { expect, test } from "vitest";
import {
  LIT_MOVIE, LIT_NONE, LIT_PUPPET, LIT_SCREEN, LIT_SET, LIT_STAGE, Lights,
  composeGamma, composeShade, gammaOf, gammaPalette, plainShade, unscreenPalette,
} from "@dreamfactory/engine/runtime/shading";

const palette = () => {
  const p = new Uint8ClampedArray(8);
  p.set([10, 100, 200, 255, 0, 255, 128, 255]);
  return p;
};

test("each group's record, the puppet's own table over its record, and none for the screen", () => {
  const L = new Lights();
  expect(L.group(LIT_STAGE)).toBe(L.stage);
  expect(L.group(LIT_SET)).toBe(L.set);
  expect(L.group(LIT_MOVIE)).toBe(L.movie);
  expect(L.group(LIT_PUPPET)).toBe(L.puppet);
  const table = plainShade();
  L.puppetTable = table;
  expect(L.group(LIT_PUPPET)).toBe(table);
  expect(L.group(LIT_SCREEN)).toBeNull();
  expect(L.group(LIT_NONE)).toBeNull();
  expect(L.key().split(";")).toHaveLength(5);
});

test("gammas at their limits: 128 is no change either side, 256 the steepest", () => {
  expect(gammaOf(-500)).toBe(256);
  expect(gammaOf(500)).toBe(0);
  expect(composeGamma(128, 40)).toBe(40);
  expect(composeGamma(40, 128)).toBe(40);
  // the table's top entry is 1024: composed with itself, the curve is all but flat at the top
  expect(composeGamma(256, 256)).toBe(255);
  // no group: the sprite's own record alone
  expect(composeShade({ bright: [300, -300, 5], contrast: [0, 0, 0] }, null)).toEqual({
    bright: [255, -255, 5], gamma: [128, 128, 128],
  });
});

test("a palette through a record is built once and handed back the same", () => {
  const pal = palette();
  // all gammas 128: only the brightness
  expect(Array.from(gammaPalette(pal, [5, 0, 0], [128, 128, 128]).slice(0, 4))).toEqual([15, 100, 200, 255]);
  const a = gammaPalette(pal, [0, 0, 0], [64, 128, 200]);
  expect(gammaPalette(pal, [0, 0, 0], [64, 128, 200])).toBe(a);
  const b = gammaPalette(pal, [0, 0, 0], [200, 128, 64]);
  expect(b).not.toBe(a);
  // the alpha is kept, and an unchanged channel is unchanged
  expect([a[1], a[3]]).toEqual([100, 255]);
  // the screen's curve taken back: cached by record, a new record a new palette
  const screen = { bright: [0, 0, 0] as [number, number, number], contrast: [20, 0, -20] as [number, number, number] };
  const u = unscreenPalette(pal, screen);
  expect(unscreenPalette(pal, screen)).toBe(u);
  expect(unscreenPalette(pal, { ...screen, bright: [10, 0, 0] })).not.toBe(u);
  expect(u[1]).toBe(100); // the green channel's curve is plain
});

test("a sprite under no record is drawn through the screen's curve taken back", () => {
  const L = new Lights();
  const pal = palette();
  const own = plainShade();
  // a plain screen: the palette as lit
  expect(L.spritePalette(pal, own, LIT_NONE)).toBe(pal);
  L.screenOf = () => ({ bright: [0, 0, 0], contrast: [30, 30, 30] });
  const out = L.spritePalette(pal, own, LIT_NONE);
  expect(out).not.toBe(pal);
  expect(out[0]).not.toBe(pal[0]);
  // under a group, the screen is not taken back
  expect(L.spritePalette(pal, own, LIT_STAGE)).toBe(pal);
});
