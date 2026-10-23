/**
 * `initbat` — its think `0x422ef0` and its corpse (`batReacts`) against a
 * stand-in context: hanging, letting go, and the corpse that falls through.
 *
 *   npx vitest run skullcracker/tests/bat.ts
 *
 * The machine suites fly bats in the belfry and the priest's summons; the
 * hang before the player arrives, the ceiling it is held under, the drop on a
 * gravity of 1/1 when the roll has not been taken, and the corpse's landing
 * are pinned here against the addresses `src/brains/bat.ts` was read from.
 *
 * No rip: the brain reads nothing off the disc.
 */
import { describe, expect, it } from "vitest";
import { TICK_SCALE, type BrainCtx, type Enemy } from "../src/brains/kit";
import { bat, BAT, batReacts } from "../src/brains/bat";
import { FOES } from "../src/foes";
import { ctx, inState, is, on } from "./stand/brainctx";

const F = FOES.initbat;
const at = (a: Parameters<typeof inState>[1], over: Partial<Enemy> = {}) => inState("initbat", a, over);
const think = (e: Enemy, k: BrainCtx, run = 1_000) => bat(e, F, run, k);
const v = (n: number) => Math.round((n / TICK_SCALE) * 1000) / 1000;

describe("hanging, state 1 (0x422f43)", () => {
  it("re-hangs its one cel from the start each time it ends while the player stays out of its rect (0x422f7d)", () => {
    const e = at(BAT.hang, { fighting: false, clock: 0.5 });
    think(e, ctx({}).k, 1);
    expect([e.clock, ...on(e)]).toEqual([0.5, ...is(BAT.hang)]);
    e.clock = 1;
    think(e, ctx({}).k, 1);
    expect([e.clock, ...on(e)]).toEqual([0, ...is(BAT.hang)]);
  });

  it("stirs the frame he enters its rect, and an unset script is the same state (0x41eb51)", () => {
    const e = at(BAT.hang, { fighting: true });
    think(e, ctx({}).k);
    expect(on(e)).toEqual(is(BAT.stir));
    const fresh = at(BAT.orphan, { fighting: true, script: undefined });
    think(fresh, ctx({}).k);
    expect(on(fresh)).toEqual(is(BAT.stir));
  });

  it("is held under its record's top, the ceiling the engine's roof gives it", () => {
    const e = at(BAT.hang, { fighting: false, y: -600, top: -500 });
    think(e, ctx({}).k);
    expect(e.y).toBe(-500);
  });
});

describe("coming off the ceiling, state 2 (0x422f96)", () => {
  it("falls at the whole of the engine's ten when no gravity divisor was rolled, and levels as the drop ends", () => {
    const e = at(BAT.drop, { nerve: 0, vy: 0, clock: 0 });
    think(e, ctx({}).k, 3);
    expect(v(e.vy)).toBe(10);
  });

  it("halves its fall on each whole frame of the level-out and not between them (0x42303f)", () => {
    const e = at(BAT.level, { vy: 8 * TICK_SCALE, clock: 0.25 });
    think(e, ctx({}).k, 3);
    expect(v(e.vy)).toBe(8);
    e.clock = 1;
    think(e, ctx({}).k, 3);
    expect(v(e.vy)).toBe(4);
  });
});

describe("the rest", () => {
  it("answers nothing in the page's death state", () => {
    const e = at(BAT.cruise, { script: 4 });
    expect(think(e, ctx({}).k)).toBe(false);
  });

  it("lets its corpse fall 150 through the floor and lie once it has landed, a frame after it started (0x4232a9, 0x4232b2)", () => {
    const e = at(F.death!, { state: "dead", vy: 0, linger: 50 });
    batReacts(e, F, 0, ctx({}).k);
    expect([e.floor, e.threw, e.linger]).toEqual([-150, true, 50]);
    e.vy = 4;
    batReacts(e, F, 0, ctx({}).k);
    expect(e.linger).toBe(50);
    e.vy = 0;
    batReacts(e, F, 0, ctx({}).k);
    expect(e.linger).toBe(0);
    // alive, or dead on another script, nothing
    const alive = at(BAT.cruise, { linger: 7 });
    batReacts(alive, F, 0, ctx({}).k);
    const other = at(BAT.cruise, { state: "dead", linger: 7 });
    batReacts(other, F, 0, ctx({}).k);
    expect([alive.floor, other.floor, other.linger]).toEqual([undefined, undefined, 7]);
  });
});
