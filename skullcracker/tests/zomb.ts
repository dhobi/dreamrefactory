/**
 * `initzomb`, the zombie — the states of its think `0x420330` the machine
 * suites leave, against a stand-in context.
 *
 *   npx vitest run skullcracker/tests/zomb.ts
 *
 * `tests/machine/grave.ts` meets zombies in the graveyard; the statue, the
 * arms coming down into the sway, the claw's swipe on its third cel and the
 * sway that mostly just sways are taken here on purpose against the addresses
 * in `src/brains/zomb.ts`.
 *
 * No rip: the brain reads nothing off the disc.
 */
import { describe, expect, it } from "vitest";
import type { BrainCtx, Enemy } from "../src/brains/kit";
import { zomb, ZOMB } from "../src/brains/zomb";
import { FOES } from "../src/foes";
import { ctx, inState, is, on } from "./stand/brainctx";

const F = FOES.initzomb;
const at = (a: Parameters<typeof inState>[1], over: Partial<Enemy> = {}) => inState("initzomb", a, { nerve: 1, ...over });
const think = (e: Enemy, k: BrainCtx, run = 1_000) => zomb(e, F, run, k);

describe("the zombie's states", () => {
  it("stands as a statue until he is in its rect (0x4203a6)", () => {
    const e = at(ZOMB.wait, { fighting: false });
    think(e, ctx({}).k);
    expect(on(e)).toEqual(is(ZOMB.wait));
    e.fighting = true;
    think(e, ctx({}).k);
    expect(on(e)).toEqual(is(ZOMB.sway));
  });

  it("brings the arms down into the sway as the lower ends (0x420692)", () => {
    const e = at(ZOMB.lower, { clock: 1 });
    think(e, ctx({}).k, 4);
    expect(on(e)).toEqual(is(ZOMB.lower));
    e.clock = 4;
    think(e, ctx({}).k, 4);
    expect(on(e)).toEqual(is(ZOMB.sway));
  });

  it("says the swipe on the claw's third cel only, and holds its arms up as the claw ends (0x4207a9)", () => {
    const heard: string[] = [];
    const hold = ZOMB.claw.hold;
    for (let clock = 0; clock < 4 * hold; clock += 1) {
      const s = ctx({});
      think(at(ZOMB.claw, { clock }), s.k, 99);
      heard.push(...s.heard);
    }
    expect(heard).toEqual(["say 0x20"]);
    const back = at(ZOMB.backhand, { clock: 2 * hold });
    const b = ctx({});
    think(back, b.k, 99);
    expect(b.heard).toEqual([]);
    back.clock = 99;
    think(back, ctx({}).k, 99);
    expect(on(back)).toEqual(is(ZOMB.hold));
  });

  it("mostly keeps swaying inside the outer band — re-taking the sway only as it ends (0x42053f)", () => {
    const e = at(ZOMB.sway, { clock: 1, swing: true });
    think(e, ctx({ band: 1 }, [5, 7]).k, 8);
    expect([e.swing, ...on(e)]).toEqual([true, ...is(ZOMB.sway)]);
    e.clock = 8;
    think(e, ctx({ band: 1 }, [5, 72]).k, 8);
    expect([e.swing, ...on(e)]).toEqual([false, ...is(ZOMB.sway)]);
  });

  it("does nothing on a state 2 tag past the three, nor in a state past the table", () => {
    const odd = at(ZOMB.sway, { tag: 3 });
    expect(think(odd, ctx({}).k)).toBe(false);
    expect(odd.tag).toBe(3);
    const none = at(ZOMB.sway, { script: 6 });
    expect(think(none, ctx({}).k)).toBe(false);
  });
});
