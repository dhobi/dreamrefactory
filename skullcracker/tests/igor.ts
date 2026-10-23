/**
 * `initigor` — its think `0x425230` against a stand-in context, the fall
 * death above all, which only a long drop reaches.
 *
 *   npx vitest run skullcracker/tests/igor.ts
 *
 * The machine suites meet igors in the belfry, where they rarely fall far
 * enough to die of it and the dice decide the rest. Here the fall is added up
 * frame by frame through `obj+0x32`, the stun counted out and the smash booked,
 * and the stance's bands, the walk's bound and the throw are each taken on
 * purpose, against the address in `src/brains/igor.ts` it was read from.
 *
 * No rip: the brain reads nothing off the disc.
 */
import { describe, expect, it } from "vitest";
import { TICK_SCALE, type BrainCtx, type Enemy } from "../src/brains/kit";
import { igor, IGOR, IGOR_THROW } from "../src/brains/igor";
import { FOES } from "../src/foes";
import { ctx, inState, is, on } from "./stand/brainctx";

const F = FOES.initigor;
const at = (a: Parameters<typeof inState>[1], over: Partial<Enemy> = {}) => inState("initigor", a, over);
const think = (e: Enemy, k: BrainCtx, run = 1_000) => igor(e, F, run, k);

describe("the fall death (0x425296, 0x42545e)", () => {
  it("adds each frame's descent to obj+0x32 and zeroes it on any frame not coming down", () => {
    const e = at(IGOR.stance, { vy: 50 * TICK_SCALE });
    think(e, ctx({ band: -1 }).k);
    think(e, ctx({ band: -1 }).k);
    expect(e.fell).toBeCloseTo(100);
    e.vy = 0;
    think(e, ctx({ band: -1 }).k);
    expect(e.fell).toBe(0);
  });

  it("past 200 stuns it on the lead channel with a hundred frames to count, in any state but the statue and the fall itself (0x4252ad, 0x4252cb)", () => {
    const { k, heard } = ctx({ band: 0 });
    const e = at(IGOR.approach, { vy: 10 * TICK_SCALE, fell: 195 });
    think(e, k);
    expect(heard).toEqual(["say 0xa lead"]);
    expect([e.beat, ...on(e)]).toEqual([100, ...is(IGOR.stunned)]);
    // the statue, falling as far, stays a statue
    const statue = at(IGOR.wait, { vy: 10 * TICK_SCALE, fell: 195, fighting: false });
    think(statue, ctx({}).k);
    expect(on(statue)).toEqual(is(IGOR.wait));
  });

  it("holds the stun while the count lasts and it still falls, then smashes (0x425480)", () => {
    const e = at(IGOR.stunned, { beat: 1, vy: 5 * TICK_SCALE, fell: 300 });
    think(e, ctx({}).k);
    expect([e.beat, ...on(e)]).toEqual([0, ...is(IGOR.stunned)]);
    think(e, ctx({}).k);
    expect(on(e)).toEqual(is(IGOR.stunned));
    think(e, ctx({}).k);
    expect(on(e)).toEqual(is(IGOR.smashed));
    // ...and landing ends it at once, the count notwithstanding
    const landed = at(IGOR.stunned, { beat: 50, vy: 0 });
    think(landed, ctx({}).k);
    expect(on(landed)).toEqual(is(IGOR.smashed));
  });

  it("says 0x36 on the lead channel, jolts the screen and books 350 as the smash ends (0x4254b8, 0x4254d8)", () => {
    const e = at(IGOR.smashed, { clock: 1 });
    const early = ctx({});
    think(e, early.k, 6);
    expect(early.heard).toEqual([]);
    e.clock = 6;
    const { k, heard } = ctx({});
    think(e, k, 6);
    expect(heard).toEqual(["say 0x36 lead", "shake 1", "remove 350"]);
  });
});

describe("the statue and the stance (0x4252f7, 0x425327)", () => {
  it("stands until the player is inside its rect", () => {
    const e = at(IGOR.wait, { fighting: false });
    think(e, ctx({}).k);
    expect(on(e)).toEqual(is(IGOR.wait));
  });

  it("turns, then takes the band: walk, throw, jeer, back off, swipe, or nothing behind (0x425348…0x4253bb)", () => {
    const pick = (band: number, rolls: number[] = []) => {
      const s = ctx({ band, forward: -1 }, rolls);
      const e = at(IGOR.stance);
      think(e, s.k);
      expect(e.facing).toBe(-1);
      return { got: on(e), heard: s.heard };
    };
    expect(pick(0).got).toEqual(is(IGOR.approach));
    expect(pick(1).got).toEqual(is(IGOR.hurl));
    const jeer = pick(2, [2, 1]);
    expect(jeer.heard).toEqual(["roll 2=2", "say 0x7", "roll 2=1"]);
    expect(jeer.got).toEqual(is(IGOR.jeer[0]));
    expect(pick(3).got).toEqual(is(IGOR.retreat));
    expect(pick(4).got).toEqual(is(IGOR.swipe));
    expect(pick(-1).got).toEqual(is(IGOR.stance));
  });
});

describe("the walk, the retreat and the throw", () => {
  it("backs off at its own bound and stands as the walk ends (0x4253ce)", () => {
    const s = ctx({});
    s.k.atBound = () => true;
    const e = at(IGOR.approach, { clock: 1 });
    think(e, s.k, 8);
    expect(on(e)).toEqual(is(IGOR.retreat));
    const f = at(IGOR.approach, { clock: 8 });
    think(f, ctx({}).k, 8);
    expect(on(f)).toEqual(is(IGOR.stance));
  });

  it("repeats the retreat while he is inside 300, and stands once he is past it (0x42540a)", () => {
    const e = at(IGOR.retreat, { clock: 6 });
    think(e, ctx({ band: 2 }).k, 6);
    expect(on(e)).toEqual(is(IGOR.retreat));
    think(e, ctx({ band: 1 }).k, 6);
    expect(on(e)).toEqual(is(IGOR.stance));
  });

  it("hands the jeer and the swipe back to the stance as they end (0x425441, 0x4254f9)", () => {
    for (const a of [IGOR.jeer[1], IGOR.swipe]) {
      const e = at(a, { clock: 1 });
      think(e, ctx({}).k, 4);
      expect(on(e)).toEqual(is(a));
      e.clock = 4;
      think(e, ctx({}).k, 4);
      expect(on(e)).toEqual(is(IGOR.stance));
    }
  });

  it("cries belfry 9 and lets the thing go as the wind-up ends, then stands (0x42553f, 0x42558d, 0x4255a6)", () => {
    const thrown: unknown[] = [];
    const s = ctx({});
    s.k.cast = (_e, kit) => void thrown.push(kit);
    const e = at(IGOR.hurl, { clock: 1 });
    think(e, s.k, 6);
    expect(thrown).toEqual([]);
    e.clock = 6;
    think(e, s.k, 6);
    expect(s.heard).toEqual(["say 0x9"]);
    expect(thrown).toEqual([IGOR_THROW]);
    expect(on(e)).toEqual(is(IGOR.recover));
    e.clock = 6;
    think(e, s.k, 6);
    expect(on(e)).toEqual(is(IGOR.stance));
  });

  it("answers nothing in a state the table has no case for", () => {
    const e = at(IGOR.stance, { script: 8 });
    expect(think(e, ctx({}).k)).toBe(false);
  });
});
