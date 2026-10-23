/**
 * `initwered`, the CHOPPER — the states of its think `0x454410` and its
 * wreck (`weredReacts`) the machine suites leave, against a stand-in context.
 *
 *   npx vitest run skullcracker/tests/wered.ts
 *
 * The speed cap in both directions, the turn when it has bounced off what it
 * walked into, the walk tags past the two, and the wreck only on its own
 * death are taken here against the addresses in `src/brains/wered.ts`.
 *
 * No rip: the brain reads nothing off the disc.
 */
import { describe, expect, it } from "vitest";
import { TICK_SCALE, type BrainCtx, type Enemy } from "../src/brains/kit";
import { wered, WERED, weredReacts } from "../src/brains/wered";
import { FOES } from "../src/foes";
import { ctx, inState, is, on } from "./stand/brainctx";

const F = FOES.initwered;
const at = (a: Parameters<typeof inState>[1], over: Partial<Enemy> = {}) => inState("initwered", a, over);
const think = (e: Enemy, k: BrainCtx, run = 1_000) => wered(e, F, run, k);

describe("the CHOPPER", () => {
  it("is held to thirty a frame either way, whatever its state (0x454473)", () => {
    const east = at(WERED.idle, { fighting: false, vx: 50 * TICK_SCALE });
    think(east, ctx({}).k);
    const west = at(WERED.idle, { fighting: false, vx: -50 * TICK_SCALE });
    think(west, ctx({}).k);
    expect([east.vx / TICK_SCALE, west.vx / TICK_SCALE]).toEqual([30, -30]);
  });

  it("turns round once it has bounced backwards off what it walked into (0x4544d8)", () => {
    const e = at(WERED.walk, { facing: 1, vx: -3 * TICK_SCALE });
    think(e, ctx({}).k);
    expect(on(e)).toEqual(is(WERED.turn));
    const west = at(WERED.lurch, { facing: -1, vx: 3 * TICK_SCALE });
    think(west, ctx({}).k);
    expect(on(west)).toEqual(is(WERED.turn));
  });

  it("drops out on a walk tag that is neither 0 nor 1 (0x454521), and on a state past the table", () => {
    const e = at(WERED.walk, { tag: 2 });
    expect(think(e, ctx({}).k)).toBe(false);
    expect(e.tag).toBe(2);
    const none = at(WERED.walk, { script: 9 });
    expect(think(none, ctx({}).k)).toBe(false);
  });

  it("does nothing alive, or dead on another script", () => {
    const { k, heard } = ctx({});
    weredReacts(at(WERED.walk, { clock: 99 }), F, 0, k);
    weredReacts(at(WERED.walk, { state: "dead", clock: 99 }), F, 0, k);
    expect(heard).toEqual([]);
  });
});
