/**
 * `initdog` — the states of its think `0x454be0` the machine suites leave,
 * against a stand-in context.
 *
 *   npx vitest run skullcracker/tests/dog.ts
 *
 * The lunge at a back turned at 320…410, the bristle ending in the snap, the
 * charge jammed against a wall while its velocity word is the walk's, and the
 * stance tags the table lacks are taken here against the addresses in
 * `src/brains/dog.ts`.
 *
 * No rip: the brain reads nothing off the disc.
 */
import { describe, expect, it } from "vitest";
import type { BrainCtx, Enemy } from "../src/brains/kit";
import { dog, DOG } from "../src/brains/dog";
import { FOES } from "../src/foes";
import { ctx, inState, is, on } from "./stand/brainctx";

const F = FOES.initdog;
const at = (a: Parameters<typeof inState>[1], over: Partial<Enemy> = {}) => inState("initdog", a, { nerve: 1, ...over });
const think = (e: Enemy, k: BrainCtx, run = 1_000) => dog(e, F, run, k);

describe("the dog", () => {
  it("at 320…410 lunges with a growl at a man facing its way (0x454cea)", () => {
    const { k, heard } = ctx({ band: 3 }, [], { facing: 1 });
    const e = at(DOG.stand, { decisions: 0 });
    think(e, k);
    expect(heard).toEqual([`say 0x${DOG.growl.toString(16)}`]);
    expect([e.decisions, ...on(e), e.swing]).toEqual([1, ...is(DOG.lunge), true]);
  });

  it("ends a bristle in the snap on a roll of 1 or 2 and a tails (0x454e45)", () => {
    const e = at(DOG.bristle, { clock: 4 });
    // he is far enough across that the dead turn-and-bay at 0x454d1e is not asked
    think(e, ctx({ band: 3 }, [2, 2], { x: 1_000 }).k, 4);
    expect(on(e)).toEqual(is(DOG.snap));
  });

  it("reads its charge's direction off the walk when the shove left no velocity, and turns when it points backwards (0x454f53, 0x454f7d)", () => {
    const back = at(DOG.charge, { vx: 0, speed: -5, facing: 1, clock: 3 });
    think(back, ctx({}).k, 18);
    expect([back.facing, back.clock, ...on(back)]).toEqual([-1, 0, ...is(DOG.charge)]);
    const on2 = at(DOG.charge, { vx: 0, speed: 5, facing: 1, clock: 3 });
    think(on2, ctx({}).k, 18);
    expect([on2.facing, on2.clock]).toEqual([1, 3]);
    // a velocity word that is set is read before the walk
    const shoved = at(DOG.charge, { vx: -2, speed: 5, facing: 1, clock: 3 });
    think(shoved, ctx({}).k, 18);
    expect(shoved.facing).toBe(-1);
  });

  it("does nothing on a stance tag the table lacks, nor in a state past it", () => {
    const odd = at(DOG.stand, { tag: 3 });
    expect(think(odd, ctx({ band: 3 }, [], { x: 1_000 }).k)).toBe(false);
    expect(odd.tag).toBe(3);
    const none = at(DOG.stand, { script: 7 });
    expect(think(none, ctx({}).k)).toBe(false);
  });
});
