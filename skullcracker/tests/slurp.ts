/**
 * `initslurp`, the lab's floater — the stance branches of its think
 * `0x4149e0` the machine suites leave, against a stand-in context.
 *
 *   npx vitest run skullcracker/tests/slurp.ts
 *
 * At 140…180 facing a man who is already down it neither hypnotises nor
 * bolts: it lets the stance play out (`0x414fc2`). Behind it, or beyond the
 * table, the stance plays out too (`0x415038`). Both are taken here against
 * the addresses in `src/brains/slurp.ts`.
 *
 * No rip: the brain reads nothing off the disc.
 */
import { describe, expect, it } from "vitest";
import type { BrainCtx, Enemy } from "../src/brains/kit";
import { slurp, SLURP } from "../src/brains/slurp";
import { FOES } from "../src/foes";
import { ctx, inState, is, on } from "./stand/brainctx";

const F = FOES.initslurp;
const at = (a: Parameters<typeof inState>[1], over: Partial<Enemy> = {}) => inState("initslurp", a, { hover: 1, ...over });
const think = (e: Enemy, k: BrainCtx, run = 1_000) => slurp(e, F, run, k);

describe("the stance, state 4 (0x414e22)", () => {
  it("at 140…180 facing a downed man lets the stance play out (0x414fc2)", () => {
    const e = at(SLURP.stance, { clock: 1, swing: true });
    const s = ctx({ band: 2 }, [], { down: true });
    think(e, s.k, 4);
    expect([s.heard, e.swing, ...on(e)]).toEqual([[], true, ...is(SLURP.stance)]);
    e.clock = 4;
    think(e, ctx({ band: 2 }, [], { down: true }).k, 4);
    expect([e.swing, ...on(e)]).toEqual([false, ...is(SLURP.stance)]);
  });

  it("behind it, or past the table, lets the stance play out too (0x415038)", () => {
    const e = at(SLURP.stance, { clock: 1, swing: true });
    think(e, ctx({ band: -1 }).k, 4);
    expect([e.swing, ...on(e)]).toEqual([true, ...is(SLURP.stance)]);
    e.clock = 4;
    think(e, ctx({ band: -1 }).k, 4);
    expect([e.swing, ...on(e)]).toEqual([false, ...is(SLURP.stance)]);
  });

  it("answers nothing in a state the table has no case for", () => {
    const e = at(SLURP.stance, { script: 9 });
    expect(think(e, ctx({}).k)).toBe(false);
  });
});
