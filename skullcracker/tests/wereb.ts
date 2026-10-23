/**
 * `initwereb`, the city's brawler — its think `0x44f3d0` and its burn
 * (`werebReacts`, `0x44f735`) against a stand-in context.
 *
 *   npx vitest run skullcracker/tests/wereb.ts
 *
 * The machine suites fight werebs in the city, where the dice and the player
 * decide which branches run. The walks running out of room, the windup's two
 * swings, the mill and the walk home, the burn eating its health and the
 * death it ends in, and the stance's bands at their bounds are taken here on
 * purpose, each against the address in `src/brains/wereb.ts` it was read from.
 *
 * No rip: the brain reads nothing off the disc.
 */
import { describe, expect, it } from "vitest";
import type { BrainCtx, Enemy } from "../src/brains/kit";
import { wereb, WEREB, werebReacts } from "../src/brains/wereb";
import { FOES } from "../src/foes";
import { ctx, inState, is, on } from "./stand/brainctx";

const F = FOES.initwereb;
const at = (a: Parameters<typeof inState>[1], over: Partial<Enemy> = {}) => inState("initwereb", a, over);
const think = (e: Enemy, k: BrainCtx, run = 1_000) => wereb(e, F, run, k);
/** a context with the bound ahead and the bound behind answered by the test */
function bounds(front: boolean, rear: boolean, track: Parameters<typeof ctx>[0] = {}, rolls: number[] = []) {
  const s = ctx(track, rolls);
  s.k.atBound = () => front;
  s.k.atRear = () => rear;
  return s;
}

describe("the walks, state 2 (0x44f606)", () => {
  it("stands when a forward walk runs into the bound ahead, or the backward one into the bound behind (0x44f61f, 0x44f651)", () => {
    const fwd = at(WEREB.walkIn, { clock: 1 });
    think(fwd, bounds(true, false).k, 6);
    expect(on(fwd)).toEqual(is(WEREB.stance));
    const back = at(WEREB.away, { clock: 1 });
    think(back, bounds(true, false).k, 6);
    expect(on(back)).toEqual(is(WEREB.away));
    think(back, bounds(false, true).k, 6);
    expect(on(back)).toEqual(is(WEREB.stance));
    const ends = at(WEREB.shuffle, { clock: 6 });
    think(ends, ctx({}).k, 6);
    expect(on(ends)).toEqual(is(WEREB.stance));
  });

  it("drops a tag past the table's four (0x44f60a)", () => {
    const e = at(WEREB.walkIn, { tag: 4, clock: 6 });
    expect(think(e, ctx({}).k, 6)).toBe(false);
    expect(e.tag).toBe(4);
  });
});

describe("the attacks, state 3 (0x44f67e)", () => {
  it("waits for each script to end, and hands the two swings back to the stance (0x44f6a8)", () => {
    const e = at(WEREB.swingB, { clock: 1 });
    think(e, ctx({}).k, 6);
    expect(on(e)).toEqual(is(WEREB.swingB));
    e.clock = 6;
    think(e, ctx({}).k, 6);
    expect(on(e)).toEqual(is(WEREB.stance));
  });

  it("ends the windup in the first swing with 0x19 on 1…3 and the second with 0x1a on 4…7 (0x44f6dc)", () => {
    for (const [r, want, said] of [[3, WEREB.swingA, "say 0x19"], [4, WEREB.swingB, "say 0x1a"]] as const) {
      const { k, heard } = ctx({}, [r]);
      const e = at(WEREB.ready, { clock: 6 });
      think(e, k, 6);
      expect(heard).toEqual([`roll 7=${r}`, said]);
      expect([...on(e), e.swing]).toEqual([...is(want), true]);
    }
  });

  it("drops a negative tag at once and does nothing as a tag past the windup ends (0x44f688)", () => {
    for (const tag of [-1, 3]) {
      const e = at(WEREB.ready, { tag, clock: 6 });
      expect(think(e, ctx({}).k, 6)).toBe(false);
      expect(e.tag).toBe(tag);
    }
  });
});

describe("the mill and the burn (0x44f795, 0x44f74c)", () => {
  it("mills again while he is down and walks back home as a patrol the frame he is up (0x44f7c3)", () => {
    const e = at(WEREB.mill, { clock: 1, x: 10, home: 200 });
    think(e, ctx({}, [], { down: true }).k, 6);
    expect(on(e)).toEqual(is(WEREB.mill));
    e.clock = 6;
    think(e, ctx({}, [], { down: true }).k, 6);
    expect([e.clock, ...on(e)]).toEqual([0, ...is(WEREB.mill)]);
    e.clock = 6;
    think(e, ctx({}).k, 6);
    expect([e.x, e.fighting, ...on(e)]).toEqual([200, false, ...is(WEREB.patrol)]);
    const homeless = at(WEREB.mill, { clock: 6, x: 10 });
    think(homeless, ctx({}).k, 6);
    expect(homeless.x).toBe(10);
  });

  it("burns ten a frame with a growl, then stands with health left or dies into a 200-frame corpse (0x44f735, 0x44f757, 0x44f776)", () => {
    const burn = F.burns!.anim!;
    const { k, heard } = ctx({});
    const e = at(burn, { state: "flinch", hp: 25 });
    werebReacts(e, F, 0, k);
    expect([e.hp, heard]).toEqual([15, ["say 0x23"]]);
    const left = at({ ...WEREB.stance, kind: 4 }, { hp: 15 });
    think(left, ctx({}).k);
    expect(on(left)).toEqual(is(WEREB.stance));
    const gone = at({ ...WEREB.stance, kind: 4 }, { hp: 0, clock: 3, swing: true });
    think(gone, ctx({}).k);
    expect([gone.state, gone.anim, gone.clock, gone.swing, gone.linger]).toEqual(["dead", F.death, 0, false, 200]);
    // a class with no death to put on leaves it where it is
    const bare = at({ ...WEREB.stance, kind: 4 }, { hp: 0 });
    wereb(bare, { ...F, death: undefined }, 1_000, ctx({}).k);
    expect(bare.state).toBe("gait");
  });

  it("lies 27 into the ground dead, and an ordinary flinch costs nothing (0x44f85d)", () => {
    const { k, heard } = ctx({});
    const dead = at(F.death!, { state: "dead" });
    werebReacts(dead, F, 0, k);
    const flinch = at(F.flinch![0], { state: "flinch", hp: 50 });
    werebReacts(flinch, F, 0, k);
    expect([dead.floor, flinch.hp, heard]).toEqual([-27, 50, []]);
  });

  it("answers nothing in a state the table has no case for", () => {
    const e = at(WEREB.stance, { script: 6 });
    expect(think(e, ctx({}).k)).toBe(false);
  });
});

describe("the stance, state 1 (0x44f48b)", () => {
  it("turns its back on a downed player and mills (0x44f4a5)", () => {
    const e = at(WEREB.stance);
    think(e, ctx({}, [], { down: true }).k);
    expect([e.facing, ...on(e)]).toEqual([-1, ...is(WEREB.mill)]);
  });

  it("walks in at 250…350 unless at its bound (0x44f529)", () => {
    const e = at(WEREB.stance);
    think(e, ctx({ band: 1 }).k);
    expect(on(e)).toEqual(is(WEREB.walkIn));
    const stuck = at(WEREB.stance);
    think(stuck, bounds(true, false, { band: 1 }).k);
    expect(on(stuck)).toEqual(is(WEREB.stance));
  });

  it("at 200…250 shuffles on a lapsed beat reseeded 1…50, unless at its bound (0x44f554)", () => {
    const e = at(WEREB.stance, { beat: -1 });
    think(e, ctx({ band: 2 }, [9]).k);
    expect([e.beat, ...on(e)]).toEqual([9, ...is(WEREB.shuffle)]);
    const stuck = at(WEREB.stance, { beat: -1 });
    think(stuck, bounds(true, false, { band: 2 }, [9]).k);
    expect(on(stuck)).toEqual(is(WEREB.stance));
    const counting = at(WEREB.stance, { beat: 3 });
    think(counting, ctx({ band: 2 }).k);
    expect([counting.beat, ...on(counting)]).toEqual([2, ...is(WEREB.stance)]);
  });

  it("inside 160 backs away, or lunges past him once its back is at the bound (0x44f5ba, 0x44f5db)", () => {
    const away = at(WEREB.stance);
    think(away, ctx({ band: 4 }).k);
    expect([away.shove, ...on(away)]).toEqual([0, ...is(WEREB.away)]);
    const pinned = at(WEREB.stance);
    think(pinned, bounds(false, true, { band: 4 }).k);
    expect(on(pinned)).toEqual(is(WEREB.lunge));
  });
});
