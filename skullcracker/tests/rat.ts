/**
 * `initrat` — its think `0x44e010` against a stand-in context, and the floor
 * its death lies on (`ratReacts`).
 *
 *   npx vitest run skullcracker/tests/rat.ts
 *
 * The machine suites watch rats come out of their holes in the sewer, where
 * the dice decide which way each wait, look and lap goes. Here each is rolled
 * on purpose — the twitch in the hole, the look that sees nobody, the lap that
 * stops, the run home and the arrival — against the addresses
 * `src/brains/rat.ts` was read from.
 *
 * No rip: the brain reads nothing off the disc.
 */
import { describe, expect, it } from "vitest";
import type { BrainCtx, Enemy } from "../src/brains/kit";
import { rat, RAT, ratReacts } from "../src/brains/rat";
import { FOES } from "../src/foes";
import { ctx, inState, is, on } from "./stand/brainctx";

const F = FOES.initrat;
const at = (a: Parameters<typeof inState>[1], over: Partial<Enemy> = {}) => inState("initrat", a, over);
const think = (e: Enemy, k: BrainCtx, run = 1_000) => rat(e, F, run, k);

describe("in the hole, state 1 (0x44e044)", () => {
  it("counts its wait down without looking at the script, then twitches on a fresh 15…21 (0x44e058)", () => {
    const e = at(RAT.hide, { beat: 0 });
    think(e, ctx({}).k);
    expect([e.beat, ...on(e)]).toEqual([-1, ...is(RAT.hide)]);
    think(e, ctx({}, [3]).k);
    expect([e.beat, e.clock, ...on(e)]).toEqual([17, 0, ...is(RAT.twitch)]);
  });

  it("after a twitch goes back in on 1…2 and looks out on 3…4 (0x44e093)", () => {
    const wait = at(RAT.twitch, { clock: 1 });
    think(wait, ctx({}).k, 9);
    expect(on(wait)).toEqual(is(RAT.twitch));
    for (const [r, want] of [[2, RAT.hide], [3, RAT.look]] as const) {
      const e = at(RAT.twitch, { clock: 9 });
      think(e, ctx({}, [r]).k, 9);
      expect(on(e)).toEqual(is(want));
    }
  });

  it("looks, and goes back in unless the player is east of it, when it falls out of the hole (0x44e0e6, 0x44e0ff)", () => {
    const wait = at(RAT.look, { clock: 1 });
    think(wait, ctx({}).k, 6);
    expect(on(wait)).toEqual(is(RAT.look));
    const west = at(RAT.look, { clock: 6, x: 100 });
    think(west, ctx({}, [], { x: 100 }).k, 6);
    expect(on(west)).toEqual(is(RAT.hide));
    const east = at(RAT.look, { clock: 6, x: 100, weightless: true });
    think(east, ctx({}, [], { x: 101 }).k, 6);
    expect([east.weightless, ...on(east)]).toEqual([false, ...is(RAT.stir)]);
  });

  it("comes out, setting AI+4, and stands in the first pose as the last cel ends (0x44e137, 0x44e15d)", () => {
    const e = at(RAT.stir, { clock: 1 });
    think(e, ctx({}).k, 4);
    expect(on(e)).toEqual(is(RAT.stir));
    e.clock = 4;
    think(e, ctx({}).k, 4);
    expect([e.decisions, ...on(e)]).toEqual([1, ...is(RAT.emerge)]);
    e.clock = 1;
    think(e, ctx({}).k, 4);
    expect(on(e)).toEqual(is(RAT.emerge));
    e.clock = 4;
    think(e, ctx({}).k, 4);
    expect(on(e)).toEqual(is(RAT.pose[0]));
    const odd = at(RAT.hide, { tag: 5 });
    expect(think(odd, ctx({}).k)).toBe(false);
  });
});

describe("standing about, state 2 (0x44e17d)", () => {
  it("turns to face him, and takes another pose when the one it holds ends (0x44e1ca)", () => {
    const e = at(RAT.pose[0], { beat: 5, clock: 4 });
    think(e, ctx({ forward: -1, band: 0 }, [3]).k, 4);
    expect([e.facing, e.beat, ...on(e)]).toEqual([-1, 4, ...is(RAT.pose[2])]);
  });
});

describe("the run, state 3 (0x44e226)", () => {
  it("laps again three times in five, else stops in a pose (0x44e241)", () => {
    const going = at(RAT.run, { clock: 1 });
    think(going, ctx({}).k, 6);
    expect(on(going)).toEqual(is(RAT.run));
    const again = at(RAT.run, { clock: 6 });
    think(again, ctx({}, [3]).k, 6);
    expect(on(again)).toEqual(is(RAT.dash));
    const stop = at(RAT.dash, { clock: 6 });
    think(stop, ctx({}, [2, 2]).k, 6);
    expect(on(stop)).toEqual(is(RAT.pose[1]));
  });

  it("runs home facing its own point, bolting on until within forty, then is put back into the hole (0x44e294, 0x44e2c5)", () => {
    const e = at(RAT.bolt, { x: 300, home: 100, homeY: 77, clock: 1, vx: 9, vy: 3, decisions: 1 });
    think(e, ctx({}).k, 4);
    expect([e.facing, ...on(e)]).toEqual([-1, ...is(RAT.bolt)]);
    e.clock = 4;
    think(e, ctx({}).k, 4);
    expect([e.clock, ...on(e)]).toEqual([0, ...is(RAT.bolt)]);
    Object.assign(e, { x: 130, clock: 4 });
    think(e, ctx({}).k, 4);
    expect([e.x, e.y, e.vx, e.vy, e.decisions, e.weightless, ...on(e)]).toEqual([100, 77, 0, 0, 0, true, ...is(RAT.hide)]);
    // east of home it faces east, and with no y on record keeps its own
    const west = at(RAT.bolt, { x: 70, home: 100, y: 5, clock: 4 });
    think(west, ctx({}).k, 4);
    expect([west.facing, west.x, west.y]).toEqual([1, 100, 5]);
  });

  it("does nothing on a tag past the bolt, or a negative one (0x44e22a)", () => {
    for (const tag of [3, -1]) {
      const e = at(RAT.run, { tag, clock: 6 });
      expect(think(e, ctx({}).k, 6)).toBe(false);
      expect(e.tag).toBe(tag);
    }
  });
});

describe("the rest", () => {
  it("does nothing in state 5 or in the page's death (0x44e345)", () => {
    for (const script of [5, 6]) {
      const e = at(RAT.pose[0], { script });
      expect(think(e, ctx({}).k)).toBe(false);
    }
  });

  it("lies 150 down as it dies, and only then (0x44e33f)", () => {
    const dead = at(F.death!, { state: "dead" });
    ratReacts(dead, F, 0, ctx({}).k);
    const alive = at(RAT.pose[0]);
    ratReacts(alive, F, 0, ctx({}).k);
    expect([dead.floor, alive.floor]).toEqual([-150, undefined]);
  });
});
