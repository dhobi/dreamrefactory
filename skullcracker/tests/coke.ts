/**
 * `initcoke`, the Coke machine — its think `0x43b5d0` and its hit gate
 * `0x43b630`, against a stand-in context.
 *
 *   npx vitest run skullcracker/tests/coke.ts
 *
 * The machine suites shake cans out of these on the city levels; what is
 * pinned here is the machine on its own: standing there thinks nothing, a
 * rock puts it back on its record's point and ends in the idle, and the gate
 * takes only the player's own non-burning blows on a machine that is not
 * already rocking. Each check names its address in `src/brains/coke.ts`.
 *
 * No rip: the brain reads nothing off the disc.
 */
import { describe, expect, it } from "vitest";
import type { Enemy, Hitter } from "../src/brains/kit";
import { coke, COKE, cokeGate } from "../src/brains/coke";
import { FOES } from "../src/foes";
import { ctx, inState, is, on } from "./stand/brainctx";

const F = FOES.initcoke;
const at = (a: Parameters<typeof inState>[1], over: Partial<Enemy> = {}) => inState("initcoke", a, over);

describe("the think (0x43b5d0)", () => {
  it("does nothing at all in kind 0, idle, empty or burst (0x43b5e6)", () => {
    for (const a of [COKE.idle, COKE.empty, COKE.burst]) {
      const e = at(a, { clock: 99, x: 5 });
      expect(coke(e, F, 1, ctx({}).k)).toBe(false);
      expect([e.x, ...on(e)]).toEqual([5, ...is(a)]);
    }
  });

  it("undoes the shove while it rocks — velocity zeroed, back on its point — and idles as the rock ends (0x43b5f1, 0x43b605)", () => {
    const e = at(COKE.rock, { clock: 1, x: 130, home: 100, vx: 4, vy: 2 });
    coke(e, F, 6, ctx({}).k);
    expect([e.x, e.vx, e.vy, ...on(e)]).toEqual([100, 0, 0, ...is(COKE.rock)]);
    e.clock = 6;
    coke(e, F, 6, ctx({}).k);
    expect(on(e)).toEqual(is(COKE.idle));
    // with no home recorded it stays where the shove left it
    const loose = at(COKE.shake, { clock: 1, x: 130 });
    coke(loose, F, 6, ctx({}).k);
    expect(loose.x).toBe(130);
  });
});

describe("the hit gate (0x43b630)", () => {
  const by = (player: boolean) => ({ kind: null, kit: null, player }) as unknown as Hitter;
  it("takes the player's own blow on a standing machine (0x43b660)", () => {
    const blow = { damage: 20, code: 100, by: by(true) };
    expect(cokeGate(at(COKE.idle), F, blow)).toBe(blow);
  });

  it("turns away anyone else's blow, a burning one, and any blow while it rocks (0x43b655, 0x43b66c)", () => {
    expect(cokeGate(at(COKE.idle), F, { damage: 20, code: 100, by: by(false) })).toBeNull();
    expect(cokeGate(at(COKE.idle), F, { damage: 0, code: -9, by: by(true) })).toBeNull();
    expect(cokeGate(at(COKE.rock, { state: "flinch" }), F, { damage: 20, code: 100, by: by(true) })).toBeNull();
  });
});
