/**
 * `initpuke`, the spitter — the states of its think `0x417ed0` the machine
 * suites leave, against a stand-in context.
 *
 *   npx vitest run skullcracker/tests/puke.ts
 *
 * The spitter rolls 1..400 at the top of every frame (`0x417f37`), spent or
 * not, so every test's dice open with it. The idle before the player arrives,
 * the walk and the spit ending facing him, the walk-away from a downed player
 * on either side, and the stance holding on the frames that chose nothing are
 * taken here against the addresses in `src/brains/puke.ts`.
 *
 * No rip: the brain reads nothing off the disc.
 */
import { describe, expect, it } from "vitest";
import type { BrainCtx, Enemy } from "../src/brains/kit";
import { puke, PUKE, PUKE_GOB } from "../src/brains/puke";
import { FOES } from "../src/foes";
import { ctx, inState, is, on } from "./stand/brainctx";

const F = FOES.initpuke;
const at = (a: Parameters<typeof inState>[1], over: Partial<Enemy> = {}) => inState("initpuke", a, over);
const think = (e: Enemy, k: BrainCtx, run = 1_000) => puke(e, F, run, k);
/** `0x417f37`'s roll, at or past 40 and even */
const R = 100;

describe("the spitter's states", () => {
  it("idles until the player is in its rect (0x417f5b)", () => {
    const e = at(PUKE.idle, { fighting: false });
    think(e, ctx({}, [R]).k);
    expect(on(e)).toEqual(is(PUKE.idle));
    e.fighting = true;
    think(e, ctx({}, [R]).k);
    expect(on(e)).toEqual(is(PUKE.stance));
  });

  it("ends the walk facing him (0x417f8e)", () => {
    const e = at(PUKE.walk, { clock: 1 });
    think(e, ctx({ forward: -1 }, [R]).k, 6);
    expect([e.facing, ...on(e)]).toEqual([1, ...is(PUKE.walk)]);
    e.clock = 6;
    think(e, ctx({ forward: -1 }, [R]).k, 6);
    expect([e.facing, ...on(e)]).toEqual([-1, ...is(PUKE.stance)]);
  });

  it("follows him round through the spit and lets the gob go only as it ends, after the stance and the sound (0x4181be)", () => {
    const thrown: unknown[] = [];
    const s = ctx({ forward: -1 }, [R]);
    s.k.cast = (_e, kit) => void thrown.push(kit);
    const e = at(PUKE.spitLow, { clock: 1 });
    think(e, s.k, 6);
    expect([e.facing, thrown]).toEqual([-1, []]);
    const t = ctx({}, [R]);
    t.k.cast = (_e, kit) => void thrown.push(kit);
    e.clock = 6;
    think(e, t.k, 6);
    expect(t.heard.slice(1)).toEqual(["say 0x8"]);
    expect(thrown).toEqual([PUKE_GOB]);
    expect(on(e)).toEqual(is(PUKE.stance));
  });

  it("does nothing on a charge tag past the two, nor in a state past the table", () => {
    const odd = at(PUKE.charge, { tag: 2, clock: 9 });
    expect(think(odd, ctx({}, [R]).k, 9)).toBe(false);
    expect(odd.tag).toBe(2);
    const none = at(PUKE.stance, { script: 5 });
    expect(think(none, ctx({}, [R]).k)).toBe(false);
  });
});

describe("the stance, state 2 (0x417fba)", () => {
  it("walks AWAY from a downed player, saying the advance, whichever side he fell (0x417ff0)", () => {
    for (const [px, facing] of [[50, -1], [-50, 1]] as const) {
      const { k, heard } = ctx({}, [R], { down: true, x: px });
      const e = at(PUKE.stance);
      think(e, k);
      expect(heard.slice(1)).toEqual(["say 0xa"]);
      expect([e.facing, ...on(e)]).toEqual([facing, ...is(PUKE.walk)]);
    }
  });

  it("holds the stance on a frame that chose nothing, re-taking it only as it ends (0x4180fd)", () => {
    const e = at(PUKE.stance, { clock: 1, swing: true });
    think(e, ctx({ band: 1 }, [R]).k, 4);
    expect([e.swing, ...on(e)]).toEqual([true, ...is(PUKE.stance)]);
    e.clock = 4;
    think(e, ctx({ band: -1 }, [R]).k, 4);
    expect([e.swing, ...on(e)]).toEqual([false, ...is(PUKE.stance)]);
  });
});
