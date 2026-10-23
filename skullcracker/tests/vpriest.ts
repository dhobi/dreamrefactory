/**
 * `initvpriest`, the bishop — the states of its think `0x425cc0` and its
 * vanish (`vpriestReacts`, `0x42615c`) the machine suites leave, against a
 * stand-in context.
 *
 *   npx vitest run skullcracker/tests/vpriest.ts
 *
 * `tests/machine/grave.ts` fights the bishop; the statue before the player
 * arrives, the float over a downed player from either side, the recoil and
 * settle ending, and the vanish holding while more than half its bats still
 * fly are taken here on purpose against the addresses in
 * `src/brains/vpriest.ts`.
 *
 * No rip: the brain reads nothing off the disc.
 */
import { describe, expect, it } from "vitest";
import type { BrainCtx, Enemy } from "../src/brains/kit";
import { vpriest, VPRIEST, vpriestReacts } from "../src/brains/vpriest";
import { FOES } from "../src/foes";
import { ctx, inState, is, on } from "./stand/brainctx";

const F = FOES.initvpriest;
const at = (a: Parameters<typeof inState>[1], over: Partial<Enemy> = {}) => inState("initvpriest", a, over);
const think = (e: Enemy, k: BrainCtx, run = 1_000) => vpriest(e, F, run, k);
/** `0x425f45`'s dodge wants him in front (`out+0 == 1`); side 0 skips its roll */
const NO_DODGE = { side: 0 };

describe("the statue and the float (0x425d2d, 0x425d7a)", () => {
  it("stays a statue until he is inside its rect, then wakes on the lead channel", () => {
    const e = at(VPRIEST.statue, { fighting: false });
    const quiet = ctx({});
    think(e, quiet.k);
    expect([quiet.heard, ...on(e)]).toEqual([[], ...is(VPRIEST.statue)]);
    e.fighting = true;
    const s = ctx({});
    think(e, s.k);
    expect(s.heard).toEqual(["say 0x1d lead"]);
    expect(on(e)).toEqual(is(VPRIEST.float));
  });

  it("over a downed player only turns from him and floats on, re-taking the float as it ends (0x425f07)", () => {
    for (const [px, facing] of [[50, -1], [-50, 1]] as const) {
      const e = at(VPRIEST.float, { clock: 1, swing: true });
      think(e, ctx({}, [], { down: true, x: px }).k, 9);
      expect([e.facing, e.swing]).toEqual([facing, true]);
      e.clock = 9;
      think(e, ctx({}, [], { down: true, x: px }).k, 9);
      expect([e.swing, ...on(e)]).toEqual([false, ...is(VPRIEST.float)]);
    }
  });
});

describe("the attacks, state 2 (0x425f32)", () => {
  it("floats again as the recoil and the settle end, and not before (0x425fe3, 0x4260a7)", () => {
    for (const a of [VPRIEST.recoil, VPRIEST.settle]) {
      const e = at(a, { clock: 1 });
      think(e, ctx(NO_DODGE).k, 5);
      expect(on(e)).toEqual(is(a));
      e.clock = 5;
      think(e, ctx(NO_DODGE).k, 5);
      expect(on(e)).toEqual(is(VPRIEST.float));
    }
  });

  it("answers nothing in a state the table has no case for", () => {
    const e = at(VPRIEST.float, { script: 3 });
    expect(think(e, ctx({}).k)).toBe(false);
  });
});

describe("the vanish (0x42615c, 0x4261f8)", () => {
  it("stays gone, held on its last frame, while more than half the bats it let go still fly", () => {
    const vanish = F.flinch![2];
    const s = ctx({});
    s.k.count = () => 7;
    const e = at(vanish, { state: "flinch", clock: 20, hatched: true, side: 12, x: 0 });
    vpriestReacts(e, F, 20, s.k);
    expect([e.clock, e.x]).toEqual([19, 0]);
  });

  it("does nothing on an animation that is none of its flinches", () => {
    const { k, heard } = ctx({});
    const e = at(VPRIEST.float, { state: "flinch", vx: 5, clock: 1 });
    vpriestReacts(e, F, 10, k);
    expect([e.vx, heard]).toEqual([5, []]);
  });
});
