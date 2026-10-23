/**
 * `initox` — the states of its think `0x43f2a0` that `tests/brains.ts` leaves,
 * the pit it can fall into, and its reactions (`oxReacts`), against a
 * stand-in context.
 *
 *   npx vitest run skullcracker/tests/ox.ts
 *
 * `tests/brains.ts` has the stand's bands and the idles; here are the patrol
 * turning at its rect's ends and its bound, the approach's footfall shake, the
 * fall into the pit and what it pays, and the flinch sounds by which flinch
 * it is, each against the address in `src/brains/ox.ts` it was read from.
 *
 * No rip: the brain reads nothing off the disc.
 */
import { describe, expect, it } from "vitest";
import { TICK_SCALE, type BrainCtx, type Enemy } from "../src/brains/kit";
import { ox, OX, OX_PIT, oxReacts } from "../src/brains/ox";
import { FOES } from "../src/foes";
import { ctx, inState, is, on } from "./stand/brainctx";

const F = FOES.initox;
const at = (a: Parameters<typeof inState>[1], over: Partial<Enemy> = {}) => inState("initox", a, { beat: undefined, ...over });
const think = (e: Enemy, k: BrainCtx, run = 1_000) => ox(e, F, run, k);
/** a player well outside its widened patch */
const AWAY = { x: 10_000 };

describe("the patrol, state 0 (0x43f3ac)", () => {
  it("turns at either end of its rect only when facing out of it (0x43f407)", () => {
    const east = at(OX.patrolA, { x: 600, facing: 1, clock: 1 });
    think(east, ctx({}, [], AWAY).k, 6);
    expect(east.facing).toBe(-1);
    const west = at(OX.patrolA, { x: -600, facing: -1, clock: 1 });
    think(west, ctx({}, [], AWAY).k, 6);
    expect(west.facing).toBe(1);
    const inward = at(OX.patrolA, { x: 600, facing: -1, clock: 1 });
    think(inward, ctx({}, [], AWAY).k, 6);
    expect(inward.facing).toBe(-1);
  });

  it("turns within sixty of the bound it faces (0x43f42d)", () => {
    const s = ctx({}, [], AWAY);
    s.k.atBound = () => true;
    const e = at(OX.patrolA, { clock: 1 });
    think(e, s.k, 6);
    expect(e.facing).toBe(-1);
  });

  it("stands for a player inside its patch, but not for one who is down (0x43f3b8, 0x43f3c5)", () => {
    const up = at(OX.patrolA, { clock: 1 });
    think(up, ctx({}).k, 6);
    expect(on(up)).toEqual(is(OX.stand));
    const down = at(OX.patrolA, { clock: 1 });
    think(down, ctx({}, [], { down: true }).k, 6);
    expect(on(down)).toEqual(is(OX.patrolA));
  });
});

describe("the approach and the attacks", () => {
  it("shakes the screen on the walk-in's footfalls, frames 6 and 11 (0x43f4ac, 0x43f4d1)", () => {
    const heard: string[] = [];
    for (let clock = 0; clock < 12; clock++) {
      const s = ctx({});
      think(at(OX.walkIn, { clock }), s.k, 12);
      heard.push(...s.heard);
    }
    expect(heard).toEqual(["say 0x2b", "shake 1", "say 0x2b", "shake 1"]);
    // the run past is tag 1, whose footfalls do not shake
    const past = ctx({});
    think(at(OX.runPast, { clock: 6 }), past.k, 12);
    expect(past.heard).toEqual([]);
  });

  it("hands an attack back to the stand only when it ends (0x43f789)", () => {
    const e = at(OX.attack[1], { clock: 1 });
    think(e, ctx({}).k, 6);
    expect(on(e)).toEqual(is(OX.attack[1]));
  });

  it("at 140…300 takes one of the three attacks on a 3, with its own voice (0x43f641)", () => {
    const { k, heard } = ctx({ band: 1 }, [3, 1]);
    const e = at(OX.stand, { beat: -1 });
    think(e, k);
    expect(heard).toEqual(["roll 3=3", "roll 3=1", "say 0x2f"]);
    expect(on(e)).toEqual(is(OX.attack[0]));
  });

  it("answers nothing in a state the table has no case for", () => {
    const e = at(OX.stand, { script: 6 });
    expect(think(e, ctx({}).k)).toBe(false);
  });
});

describe("the pit, state 7 (0x43f7c9)", () => {
  it("drops into it past a hundred of fall, crying 0x35 at the player on the lead channel, with 160 frames to count (0x43f348)", () => {
    const { k, heard } = ctx({}, [], { x: 33, y: 44 });
    const e = at(OX.stand, { vy: 60 * TICK_SCALE, fell: 50 });
    think(e, k);
    expect(heard).toEqual(["say 0x35 lead"]);
    expect([e.beat, ...on(e)]).toEqual([160, ...is(OX_PIT.drop)]);
    // the patrol does not
    const patrol = at(OX.patrolA, { vy: 60 * TICK_SCALE, fell: 50, clock: 1 });
    think(patrol, ctx({}, [], AWAY).k, 6);
    expect(on(patrol)).toEqual(is(OX.patrolA));
  });

  it("holds its cel while it falls and the count lasts, then lands; landing ends it at once (0x43f7e9)", () => {
    const e = at(OX_PIT.drop, { beat: 0, vy: 5 * TICK_SCALE, fell: 300 });
    think(e, ctx({}).k);
    expect(on(e)).toEqual(is(OX_PIT.drop));
    think(e, ctx({}).k);
    expect(on(e)).toEqual(is(OX_PIT.land));
    const landed = at(OX_PIT.drop, { beat: 40, vy: 0, fell: 300 });
    think(landed, ctx({}).k);
    expect(on(landed)).toEqual(is(OX_PIT.land));
  });

  it("says 0x3d on the lead channel, shakes on 3 and pays 320 as the landing ends (0x43f826, 0x43f85a)", () => {
    const e = at(OX_PIT.land, { clock: 1 });
    const early = ctx({});
    think(e, early.k, 3);
    expect(early.heard).toEqual([]);
    e.clock = 3;
    const { k, heard } = ctx({});
    think(e, k, 3);
    expect(heard).toEqual(["say 0x3d lead", "shake 3", "remove 320"]);
  });
});

describe("its reactions (oxReacts)", () => {
  it("goes over the edge out of a flinch too, and a corpse on another script does nothing (0x43fa3b)", () => {
    const { k, heard } = ctx({});
    const falling = at(F.flinch![0], { state: "flinch", vy: 120 * TICK_SCALE });
    expect(oxReacts(falling, F, 0, k)).toBe(OX_PIT.drop);
    expect(heard).toEqual(["say 0x35 lead"]);
    const other = at(OX.stand, { state: "dead", clock: 5 });
    oxReacts(other, F, 0, k);
    expect(other.floor).toBeUndefined();
  });

  it("says nothing past a flinch's second cel, nor for an animation that is not one of its flinches", () => {
    const { k, heard } = ctx({});
    oxReacts(at(F.flinch![1], { state: "flinch", clock: 3 * F.flinch![1].hold }), F, 0, k);
    oxReacts(at(OX.stand, { state: "flinch", clock: 1 }), F, 0, k);
    expect(heard).toEqual([]);
  });
});
