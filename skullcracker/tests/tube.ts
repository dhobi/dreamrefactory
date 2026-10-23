/**
 * `inittube`, the lab's test tube — the states of its think `0x4192c0` that
 * `tests/brains.ts` leaves, and its corpse (`tubeCorpse`), against a stand-in
 * context.
 *
 *   npx vitest run skullcracker/tests/tube.ts
 *
 * `tests/brains.ts` has the decider's bands, the flip's breath and the throw.
 * Here are the rest: stepping out of the tank, the walk and the run ending
 * facing him, the charge that ends behind him in an overhead, the writhe and
 * the attacks handing back, each against the address in `src/brains/tube.ts`
 * it was read from.
 *
 * No rip: the brain reads nothing off the disc.
 */
import { describe, expect, it } from "vitest";
import type { BrainCtx, Enemy } from "../src/brains/kit";
import { tube, TUBE, tubeCorpse } from "../src/brains/tube";
import { FOES } from "../src/foes";
import { ctx, inState, is, on } from "./stand/brainctx";

const F = FOES.inittube;
const at = (a: Parameters<typeof inState>[1], over: Partial<Enemy> = {}) => inState("inittube", a, over);
const think = (e: Enemy, k: BrainCtx, run = 1_000) => tube(e, F, run, k);

describe("in the tank, state 0 (0x41933a)", () => {
  it("waits for the player in its rect, then calls on the lead channel and steps down (0x419363)", () => {
    const e = at(TUBE.dormant, { fighting: false });
    const idle = ctx({});
    think(e, idle.k);
    expect([idle.heard, ...on(e)]).toEqual([[], ...is(TUBE.dormant)]);
    e.fighting = true;
    const { k, heard } = ctx({});
    think(e, k);
    expect(heard).toEqual(["say 0x20 lead"]);
    expect(on(e)).toEqual(is(TUBE.stand));
  });
});

describe("the walk and the run end facing him (0x4193c4, 0x419681)", () => {
  it("plays each out, then turns if he got behind it and stands", () => {
    for (const a of [TUBE.walk, TUBE.dash]) {
      const e = at(a, { clock: 1 });
      think(e, ctx({ forward: -10 }).k, 10);
      expect([e.facing, ...on(e)]).toEqual([1, ...is(a)]);
      e.clock = 10;
      think(e, ctx({ forward: -10 }).k, 10);
      expect([e.facing, ...on(e)]).toEqual([-1, ...is(TUBE.stand)]);
      const ahead = at(a, { clock: 10 });
      think(ahead, ctx({}).k, 10);
      expect(ahead.facing).toBe(1);
    }
  });
});

describe("the flip, state 2 (0x4193e5)", () => {
  it("tracks him through the flip, and falls out of a tag it has no case for (0x4193fe)", () => {
    const e = at(TUBE.flip, { tag: 2, clock: 9 });
    expect(think(e, ctx({ forward: -5 }).k, 9)).toBe(false);
    expect([e.facing, e.tag]).toEqual([-1, 2]);
  });
});

describe("the charge, state 4 (0x41964a)", () => {
  it("turns round unconditionally as it ends, says 0x1d and brings the overhead down (0x419655)", () => {
    const e = at(TUBE.charge, { clock: 2 });
    think(e, ctx({}).k, 8);
    expect(on(e)).toEqual(is(TUBE.charge));
    e.clock = 8;
    const { k, heard } = ctx({});
    think(e, k, 8);
    expect(heard).toEqual(["say 0x1d"]);
    expect([e.facing, ...on(e), e.swing]).toEqual([-1, ...is(TUBE.overhead), true]);
  });
});

describe("the writhe and the attacks, states 6 and 7 (0x4196ad, 0x4196cd)", () => {
  it("play out and hand back to the decider", () => {
    for (const a of [TUBE.writhe, TUBE.overhead, TUBE.swipe]) {
      const e = at(a, { clock: 1 });
      think(e, ctx({}).k, 6);
      expect(on(e)).toEqual(is(a));
      e.clock = 6;
      think(e, ctx({}).k, 6);
      expect(on(e)).toEqual(is(TUBE.stand));
    }
  });
});

describe("the throw's wait, and the rest", () => {
  it("waits for the rear-back to end before it throws", () => {
    const { k, heard } = ctx({});
    const e = at(TUBE.rear, { clock: 2 });
    think(e, k, 8);
    expect([heard, ...on(e)]).toEqual([[], ...is(TUBE.rear)]);
  });

  it("answers nothing in state 9, the page's flinch, or past the table", () => {
    for (const script of [9, 11]) {
      const e = at(TUBE.stand, { script });
      expect(think(e, ctx({}).k)).toBe(false);
      expect(e.script).toBe(script);
    }
  });

  it("lays the corpse twelve lower, and only the corpse (0x4197ec)", () => {
    const dead = at(TUBE.death, { state: "dead" });
    tubeCorpse(dead, F, 0, ctx({}).k);
    const alive = at(TUBE.stand);
    tubeCorpse(alive, F, 0, ctx({}).k);
    expect([dead.floor, alive.floor]).toEqual([-12, undefined]);
  });
});
