/**
 * Dust's frame transitions (engine/src/df/mov-v1-effects.ts) at their edges:
 * the clamp on MSVC's `rand()`, a fade over an empty dirty rect, a dissolve
 * with no block size or a picture that its blocks do not tile, bands one
 * pixel each, a copy whose source runs off the picture, and the effect screen
 * before any frame and over a frame with no transition.
 *
 *   npx vitest run engine/tests/mov-v1-effects.ts
 */
import { expect, test } from "vitest";
import {
  BLACK_V1,
  EFFECT_V1,
  EffectScreenV1,
  FULL_V1,
  blitCopyV1,
  effectPlanV1,
  randV1,
  type MovEffectV1,
} from "@dreamfactory/engine/df/mov-v1-effects";

const R = (top: number, left: number, bottom: number, right: number) => ({ top, left, bottom, right });
const fx = (code: number, rect = R(0, 0, 4, 4), block = 0): MovEffectV1 => ({ code, rect, block });

test("rand() never answers past k: its 0x7fff is taken as 0x7ffe first", () => {
  // this seed's first state has 0x7fff in its high half, the one draw that would scale to k + 1
  const r = randV1(4028364353);
  expect(r(10)).toBe(10);
  const s = randV1();
  const draws = Array.from({ length: 1000 }, () => s(3));
  expect(new Set(draws)).toEqual(new Set([1, 2, 3]));
});

test("a fade over an empty dirty rect: no copies, the fade alone, the palette not set", () => {
  const empty = R(4, 4, 4, 8);
  expect(effectPlanV1(fx(EFFECT_V1.toBlack, empty), 5)).toEqual({ at: [], fade: "out", setsPalette: false, ticks: 5 });
  expect(effectPlanV1(fx(EFFECT_V1.fromBlack, empty), 5)).toEqual({ at: [], fade: "in", setsPalette: false, ticks: 5 });
  expect(effectPlanV1(fx(EFFECT_V1.wipeDown, empty), 5)).toEqual({ at: [], fade: null, setsPalette: true, ticks: 5 });
});

test("a dissolve: a zero block is one plain copy; blocks that overrun the picture make a whole extra row and column", () => {
  expect(effectPlanV1(fx(EFFECT_V1.dissolve, R(0, 0, 5, 5), 0), 3).at).toEqual([[{ src: R(0, 0, 5, 5), dst: R(0, 0, 5, 5) }]]);
  // 5 by 5 in blocks of 2: 3 by 3 cells, in groups of n + 1 = 3, one cell of each group a step
  const plan = effectPlanV1(fx(EFFECT_V1.dissolve, R(0, 0, 5, 5), 2), 2);
  expect(plan.at).toHaveLength(3);
  const cells = plan.at.slice(0, 2).flat();
  expect(cells).toHaveLength(6);
  // every cell a 2 by 2 block on the grid, none twice
  expect(cells.every((c) => c.dst.top % 2 === 0 && c.dst.left % 2 === 0 && c.dst.bottom - c.dst.top === 2)).toBe(true);
  expect(new Set(cells.map((c) => `${c.dst.top},${c.dst.left}`)).size).toBe(6);
  expect(plan.at[2]).toEqual([{ src: R(0, 0, 5, 5), dst: R(0, 0, 5, 5) }]);
});

test("a pick past the free slots lands on the last one", () => {
  // bands in 2 steps over 3 slots; a rand that always says 99 takes slot 2, then (still) slot 2
  const plan = effectPlanV1(fx(EFFECT_V1.bandsV, R(0, 0, 4, 6)), 2, () => 99);
  expect(plan.at.slice(0, 2)).toEqual([[{ src: R(0, 4, 4, 6), dst: R(0, 4, 4, 6) }], [{ src: R(0, 4, 4, 6), dst: R(0, 4, 4, 6) }]]);
});

test("bands as tall as their slots map one to one, with no division", () => {
  // 3 rows, n = 2: three bands of one row each, in rand's order
  const plan = effectPlanV1(fx(EFFECT_V1.bandsH, R(10, 0, 13, 4)), 2, () => 1);
  expect(plan.at.slice(0, 2).map((s) => s.map((c) => [c.dst.top, c.dst.bottom]))).toEqual([[[10, 11]], [[11, 12]]]);
});

test("a copy: its source clipped short stops the rows there; pixels drawn twice are counted once", () => {
  const W = 4;
  const H = 6;
  const picture = Uint8Array.from({ length: W * H }, (_, i) => i + 1);
  const screen = new Uint8Array(W * H);
  const drawn = new Uint8Array(W * H);
  // the source's last four rows, onto the top six: only two rows of source are there
  const n = blitCopyV1(screen, picture, W, H, { src: R(4, 0, 10, 4), dst: R(0, 0, 6, 4) }, drawn);
  expect(n).toBe(8);
  expect([...screen.subarray(0, 8)]).toEqual([...picture.subarray(16, 24)]);
  expect([...screen.subarray(8)]).toEqual(Array<number>(16).fill(0));
  expect(blitCopyV1(screen, picture, W, H, { src: R(0, 0, 3, 4), dst: R(0, 0, 3, 4) }, drawn)).toBe(4);
  expect(blitCopyV1(screen, picture, W, H, { src: R(9, 9, 10, 10), dst: R(0, 0, 1, 1) }, drawn)).toBe(0);
});

test("the effect screen: nothing entered is an empty picture; a frame with no transition is the plain blit", () => {
  const s = new EffectScreenV1();
  expect(s.busy(0)).toBe(false);
  expect(s.step(5)).toBe(0);
  expect(s.at(0)).toEqual({ pixels: new Uint8Array(0), level: FULL_V1, drawn: null });
  const a = new Uint8Array([1, 2, 3, 4]);
  s.enter(undefined, 3, a, 2, 2);
  expect(s.at(0)).toEqual({ pixels: a, level: FULL_V1, drawn: null });
  // a fade to black over it, then a plain frame: the black stays, the palette already set
  s.enter(fx(EFFECT_V1.toBlack, R(0, 0, 2, 2)), 3, a, 2, 2);
  expect(s.busy(1)).toBe(true);
  const b = new Uint8Array([5, 6, 7, 8]);
  s.enter(undefined, 3, b, 2, 2);
  expect(s.at(0)).toEqual({ pixels: b, level: { ...BLACK_V1, d: 2, s: 2 }, drawn: null });
  // a new segment sets its palette again
  s.startSegment();
  s.enter(undefined, 3, a, 2, 2);
  expect(s.at(0).level).toEqual(FULL_V1);
});
