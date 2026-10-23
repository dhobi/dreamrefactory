/**
 * `initarm`, the lab's hand — the states of its think `0x4187a0` the machine
 * suites leave, against a stand-in context.
 *
 *   npx vitest run skullcracker/tests/arm.ts
 *
 * The arm rolls 1..400 at the top of every frame, so every test's dice open
 * with it. The stance holding at 160…180 when the roll gives no reason, the
 * low lunge at a crouching player, the grab of the second character, the
 * release to the west and the crawl ending in a turn are taken here against
 * the addresses in `src/brains/arm.ts`.
 *
 * No rip: the brain reads nothing off the disc.
 */
import { describe, expect, it } from "vitest";
import type { BrainCtx, Enemy } from "../src/brains/kit";
import { arm, ARM } from "../src/brains/arm";
import { FOES } from "../src/foes";
import { ctx, inState, is, on } from "./stand/brainctx";

const F = FOES.initarm;
const at = (a: Parameters<typeof inState>[1], over: Partial<Enemy> = {}) => inState("initarm", a, { param: 1, ...over });
const think = (e: Enemy, k: BrainCtx, run = 1_000) => arm(e, F, run, k);
/** `0x41879e`'s roll, at or past the 40 that gives the 160…180 band no reason */
const R = 100;

describe("the stance, state 2 (0x418890)", () => {
  it("at 160…180 with no reason holds the stance, re-taking it only as it ends (0x4188e4)", () => {
    const e = at(ARM.stance, { clock: 1, swing: true });
    think(e, ctx({ band: 1 }, [R]).k, 4);
    expect([e.swing, ...on(e)]).toEqual([true, ...is(ARM.stance)]);
    e.clock = 4;
    think(e, ctx({ band: 1 }, [R]).k, 4);
    expect([e.swing, ...on(e)]).toEqual([false, ...is(ARM.stance)]);
  });

  it("lunges low at his own anchor when he crouches, and at his chest when he stands (0x4188f6, 0x41890a)", () => {
    const low = at(ARM.stance);
    think(low, ctx({ band: 2 }, [R], { x: 30, anchor: 200, crouching: true }).k);
    expect([low.mark, ...on(low), low.swing]).toEqual([{ x: 30, y: 200 }, ...is(ARM.lungeLow), true]);
    const high = at(ARM.stance);
    think(high, ctx({ band: 2 }, [R], { x: 30, anchor: 200 }).k);
    expect([high.mark, ...on(high)]).toEqual([{ x: 30, y: 130 }, ...is(ARM.lunge)]);
  });
});

describe("the grab and the hold (0x418992, 0x418a6c)", () => {
  it("takes the second character in its own hold with its own muffled cry (0x4189ee, 0x418a01)", () => {
    const { k, heard } = ctx({}, [R], { character: 1, x: 10, anchor: 20 });
    const e = at(ARM.lunge, { connected: true, mark: { x: 0, y: 0 }, x: 0, y: 0 });
    think(e, k);
    expect(heard.slice(1)).toEqual([`say 0x${ARM.muffledB.toString(16)}`, "hide true"]);
    expect([e.x, e.y, ...on(e)]).toEqual([10, 20, ...is(ARM.holdB)]);
  });

  it("shoves itself fifty back against its facing as the hold ends, west as well as east (0x418a98)", () => {
    for (const [facing, x] of [[1, 50], [-1, 150]] as const) {
      const e = at(ARM.hold, { facing, x: 100, clock: 6 });
      const s = ctx({}, [R]);
      think(e, s.k, 6);
      expect([e.x, ...on(e)]).toEqual([x, ...is(ARM.stance)]);
      expect(s.heard.slice(-1)).toEqual(["hide false"]);
    }
  });
});

describe("the crawl, state 7 (0x418acd)", () => {
  it("turns as it ends with him behind, and stands with him in front", () => {
    const behind = at(ARM.crawl, { clock: 6 });
    think(behind, ctx({ forward: -1 }, [R]).k, 6);
    expect(on(behind)).toEqual(is(ARM.turn));
    const ahead = at(ARM.crawl, { clock: 6 });
    think(ahead, ctx({}, [R]).k, 6);
    expect(on(ahead)).toEqual(is(ARM.stance));
    const going = at(ARM.crawl, { clock: 1 });
    think(going, ctx({}, [R]).k, 6);
    expect(on(going)).toEqual(is(ARM.crawl));
  });

  it("answers nothing in state 3, which has no script, nor in the page's death", () => {
    for (const script of [3, 8]) {
      const e = at(ARM.stance, { script });
      expect(think(e, ctx({}, [R]).k)).toBe(false);
    }
  });
});
