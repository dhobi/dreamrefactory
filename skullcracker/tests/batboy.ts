/**
 * `initbatboy`, the mall's batter — the states of its think `0x439240` that
 * `tests/brains.ts` leaves, and the gang's corpse (`gangCorpse`), against a
 * stand-in context.
 *
 *   npx vitest run skullcracker/tests/batboy.ts
 *
 * `tests/brains.ts` has the gloats, the read, the cover and the leap's chain;
 * here are the dormant stand, the poises' four exits, the run's end, the step
 * back's slide, and the tags each table lacks, each against the address in
 * `src/brains/batboy.ts` it was read from.
 *
 * No rip: the brain reads nothing off the disc.
 */
import { describe, expect, it } from "vitest";
import type { BrainCtx, Enemy } from "../src/brains/kit";
import { batboy, BATBOY, gangCorpse } from "../src/brains/batboy";
import { FOES } from "../src/foes";
import { ctx, inState, is, on } from "./stand/brainctx";

const F = FOES.initbatboy;
const at = (a: Parameters<typeof inState>[1], over: Partial<Enemy> = {}) => inState("initbatboy", a, over);
const think = (e: Enemy, k: BrainCtx, run = 1_000) => batboy(e, F, run, k);

describe("dormant, state 1 (0x439347)", () => {
  it("is held still until he is in its rect, then runs (0x4398ee)", () => {
    const e = at(BATBOY.dormant, { fighting: false, vx: 5, speed: 5 });
    think(e, ctx({}).k);
    expect([e.vx, e.speed, ...on(e)]).toEqual([0, 0, ...is(BATBOY.dormant)]);
    e.fighting = true;
    think(e, ctx({}).k);
    expect(on(e)).toEqual(is(BATBOY.run));
  });
});

describe("the read, state 2 (0x439388)", () => {
  it("decides once the back-off ends, and does nothing on a tag the table lacks (0x43944e)", () => {
    const e = at(BATBOY.away, { clock: 1 });
    think(e, ctx({}).k, 4);
    expect(on(e)).toEqual(is(BATBOY.away));
    e.clock = 4;
    think(e, ctx({}).k, 4);
    expect(on(e)).toEqual(is(BATBOY.read));
    const odd = at(BATBOY.read, { tag: 3 });
    expect(think(odd, ctx({}).k)).toBe(false);
    expect(odd.tag).toBe(3);
  });
});

describe("the run and the poises, state 4 (0x439465)", () => {
  it("runs again from a poise sliding back or under coasting speed (0x4394ac)", () => {
    for (const speed of [-2, 1]) {
      const e = at(BATBOY.poise, { speed });
      think(e, ctx({ band: 1 }).k);
      expect(on(e)).toEqual(is(BATBOY.run));
    }
  });

  it("from a coasting poise gives ground to a man behind, waits outside 150…400 and swings inside it (0x4394e2, 0x4394f1)", () => {
    const behind = at(BATBOY.poise2, { speed: 30 });
    think(behind, ctx({ forward: -1, band: 1 }).k);
    expect(on(behind)).toEqual(is(BATBOY.back));
    const far = at(BATBOY.poise2, { speed: 30 });
    think(far, ctx({ band: 0 }).k);
    expect(on(far)).toEqual(is(BATBOY.poise2));
    for (const [coin, want] of [[1, BATBOY.swingLo], [2, BATBOY.swingHi]] as const) {
      const e = at(BATBOY.poise, { speed: 30 });
      think(e, ctx({ band: 1 }, [coin]).k);
      expect([...on(e), e.swing]).toEqual([...is(want), true]);
    }
  });

  it("ends the run on a poise at 150…400 and a swing anywhere else (0x439514)", () => {
    const going = at(BATBOY.run, { clock: 1 });
    think(going, ctx({ band: 1 }).k, 6);
    expect(on(going)).toEqual(is(BATBOY.run));
    for (const [coin, want] of [[1, BATBOY.poise], [2, BATBOY.poise2]] as const) {
      const e = at(BATBOY.run, { clock: 6 });
      think(e, ctx({ band: 1 }, [coin]).k, 6);
      expect(on(e)).toEqual(is(want));
    }
    const close = at(BATBOY.run, { clock: 6 });
    think(close, ctx({ band: 3 }, [2]).k, 6);
    expect(on(close)).toEqual(is(BATBOY.swingHi));
  });

  it("re-takes the step back while it slides on, and reads facing him once stopped (0x43956d)", () => {
    const sliding = at(BATBOY.back, { speed: 8, clock: 1 });
    think(sliding, ctx({}).k, 1);
    expect([sliding.clock, ...on(sliding)]).toEqual([0, ...is(BATBOY.back)]);
    const mid = at(BATBOY.back, { speed: 8 });
    think(mid, ctx({}).k, 1);
    expect(on(mid)).toEqual(is(BATBOY.back));
    const stopped = at(BATBOY.back, { speed: 0 });
    think(stopped, ctx({ forward: -1 }).k, 1);
    expect([stopped.facing, ...on(stopped)]).toEqual([-1, ...is(BATBOY.read)]);
  });

  it("does nothing on the tags 0x474438 lacks", () => {
    const e = at(BATBOY.run, { tag: 2 });
    expect(think(e, ctx({}).k)).toBe(false);
  });
});

describe("the bat and the leap, states 5 and 7", () => {
  it("swings low out of the low wind-up once planted, with 0x0d (0x439617)", () => {
    const { k, heard } = ctx({});
    const e = at(BATBOY.swingLo, { speed: 0 });
    think(e, k);
    expect(heard).toEqual(["say 0xd"]);
    expect(on(e)).toEqual(is(BATBOY.strikeLo));
    const odd = at(BATBOY.swingLo, { tag: 4 });
    expect(think(odd, ctx({}).k)).toBe(false);
  });

  it("waits the leap's scripts out, and drops a fourth tag", () => {
    const e = at(BATBOY.crouch, { clock: 1 });
    think(e, ctx({}).k, 4);
    expect(on(e)).toEqual(is(BATBOY.crouch));
    const odd = at(BATBOY.crouch, { tag: 3, clock: 4 });
    expect(think(odd, ctx({}).k, 4)).toBe(false);
    expect(odd.tag).toBe(3);
  });
});

describe("the gloat, state 8 (0x4397bb)", () => {
  it("plays either gloat's lap out before it rolls, and ignores a tag past the two", () => {
    for (const a of [BATBOY.gloat, BATBOY.gloat2]) {
      const { k, heard } = ctx({}, [], { down: true });
      const e = at(a, { clock: 0 });
      think(e, k, 3);
      expect([heard, ...on(e)]).toEqual([[], ...is(a)]);
    }
    const odd = at(BATBOY.gloat, { tag: 2, clock: 5 });
    expect(think(odd, ctx({}, [], { down: true }).k, 3)).toBe(false);
    expect(odd.tag).toBe(2);
  });

  it("answers nothing in state 3 or past the table", () => {
    for (const script of [3, 10]) {
      const e = at(BATBOY.read, { script });
      expect(think(e, ctx({}).k)).toBe(false);
    }
  });
});

describe("the gang's corpse (gangCorpse)", () => {
  it("holds a flinch on its last frame while it is still in the air, lays the dead 20 down, and leaves the living be", () => {
    const flying = at(F.flinch![0], { state: "flinch", clock: 5, vy: 3 });
    gangCorpse(flying, F, 5, ctx({}).k);
    expect(flying.clock).toBe(4);
    const landed = at(F.flinch![0], { state: "flinch", clock: 5, vy: 0 });
    gangCorpse(landed, F, 5, ctx({}).k);
    expect(landed.clock).toBe(5);
    const dead = at(F.death!, { state: "dead", vx: 7, vy: 0 });
    gangCorpse(dead, F, 5, ctx({}).k);
    expect([dead.floor, dead.vx]).toEqual([-20, 0]);
    const alive = at(BATBOY.run, { vx: 7 });
    gangCorpse(alive, F, 5, ctx({}).k);
    expect([alive.floor, alive.vx]).toEqual([undefined, 7]);
  });
});
