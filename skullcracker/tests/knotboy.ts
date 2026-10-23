/**
 * `initknotboy`, the mall's keeper — its think `0x437b20` state by state
 * against a stand-in context.
 *
 *   npx vitest run skullcracker/tests/knotboy.ts
 *
 * `tests/machine/mall.ts` fights keepers in the mall, where the dice and the
 * player decide which branches run. The walk-away from a downed player, the
 * brace and its break, the walk's three exits, the leap nothing on the page
 * starts and the strike's step back are taken here on purpose, each against
 * the address in `src/brains/knotboy.ts` it was read from.
 *
 * No rip: the brain reads nothing off the disc.
 */
import { describe, expect, it } from "vitest";
import type { BrainCtx, Enemy } from "../src/brains/kit";
import { knotboy, KNOTBOY, knotboyDown } from "../src/brains/knotboy";
import { FOES } from "../src/foes";
import { ctx, inState, is, on } from "./stand/brainctx";

const F = FOES.initknotboy;
const at = (a: Parameters<typeof inState>[1], over: Partial<Enemy> = {}) => inState("initknotboy", a, over);
const think = (e: Enemy, k: BrainCtx, run = 1_000) => knotboy(e, F, run, k);

describe("the walk-away from a downed player (0x437bc3, 0x437bf6)", () => {
  it("turns away from him, whichever side he lies, and keeps a facing already away", () => {
    const e = at(KNOTBOY.stance, { facing: 1, x: 0, speed: 20 });
    expect(knotboyDown(e, ctx({}, [], { x: 50 }).k)).toBe(KNOTBOY.saunter);
    expect([e.facing, e.speed]).toEqual([-1, -20]);
    const w = at(KNOTBOY.stance, { facing: 1, x: 0, speed: 20 });
    knotboyDown(w, ctx({}, [], { x: -50 }).k);
    expect([w.facing, w.speed]).toEqual([1, 20]);
  });

  it("is installed over the stance, the walk and the lunge, and not over the statue, the leap or the walk-away", () => {
    for (const a of [KNOTBOY.stance, KNOTBOY.approach, KNOTBOY.lunge]) {
      const e = at(a);
      think(e, ctx({}, [], { down: true, x: 100 }).k);
      expect(on(e)).toEqual(is(KNOTBOY.saunter));
    }
    for (const a of [KNOTBOY.stand, KNOTBOY.flight]) {
      const e = at(a, { fighting: false, clock: 0 });
      think(e, ctx({}, [], { down: true }).k, 10);
      expect(on(e)).toEqual(is(a));
    }
  });

  it("walks away again from its first cel while he is down, and walks in the frame he is up (0x4380ad)", () => {
    const e = at(KNOTBOY.saunter, { clock: 2 });
    think(e, ctx({}, [], { down: true }).k, 12);
    expect(on(e)).toEqual(is(KNOTBOY.saunter));
    e.clock = 12;
    think(e, ctx({}, [], { down: true }).k, 12);
    expect([e.clock, ...on(e)]).toEqual([0, ...is(KNOTBOY.saunter)]);
    e.clock = 12;
    think(e, ctx({}).k, 12);
    expect(on(e)).toEqual(is(KNOTBOY.approach));
  });
});

describe("the statue (0x437c29)", () => {
  it("is nailed down until the player is in its rect, then walks in that frame (0x437c65)", () => {
    const e = at(KNOTBOY.stand, { fighting: false, vx: 4, vy: 4, speed: 4 });
    think(e, ctx({}).k);
    expect([e.vx, e.vy, e.speed, ...on(e)]).toEqual([0, 0, 0, ...is(KNOTBOY.stand)]);
    e.fighting = true;
    think(e, ctx({}).k);
    expect(on(e)).toEqual(is(KNOTBOY.approach));
  });
});

describe("the stance, state 2 (0x437c6a)", () => {
  it("turns to face him and gives ground inside 85 (0x437c72, 0x437cbd)", () => {
    const e = at(KNOTBOY.stance);
    think(e, ctx({ forward: -20, band: 3 }).k);
    expect([e.facing, ...on(e)]).toEqual([-1, ...is(KNOTBOY.giveGround)]);
  });

  it("walks in beyond 150, and at 85…150 braces only while he swings (0x437ce9)", () => {
    for (const band of [0, 1]) {
      const e = at(KNOTBOY.stance);
      think(e, ctx({ band }).k);
      expect(on(e)).toEqual(is(KNOTBOY.approach));
    }
    const still = at(KNOTBOY.guard);
    think(still, ctx({ band: 2 }).k);
    expect(on(still)).toEqual(is(KNOTBOY.guard));
    const brace = at(KNOTBOY.stance);
    think(brace, ctx({ band: 2 }, [], { swinging: true }).k);
    expect(on(brace)).toEqual(is(KNOTBOY.brace));
  });

  it("holds the brace until he swings again, then takes one of the two stance cels on a coin (0x437d01)", () => {
    const e = at(KNOTBOY.brace);
    think(e, ctx({}).k);
    expect(on(e)).toEqual(is(KNOTBOY.brace));
    for (const [coin, want] of [[1, KNOTBOY.stance], [2, KNOTBOY.guard]] as const) {
      const b = at(KNOTBOY.brace);
      think(b, ctx({}, [coin], { swinging: true }).k);
      expect(on(b)).toEqual(is(want));
    }
  });

  it("runs the retreat to its end and stands, and does nothing on a tag the table lacks (0x437d24)", () => {
    const e = at(KNOTBOY.giveGround, { clock: 1 });
    think(e, ctx({}).k, 6);
    expect(on(e)).toEqual(is(KNOTBOY.giveGround));
    e.clock = 6;
    think(e, ctx({}).k, 6);
    expect(on(e)).toEqual(is(KNOTBOY.stance));
    const odd = at(KNOTBOY.stance, { tag: 3 });
    expect(think(odd, ctx({}).k)).toBe(false);
    expect(odd.tag).toBe(3);
  });
});

describe("the walk, state 4 (0x437d3b)", () => {
  it("on a poise cel turns a facing that disagrees with its slide and walks again (0x437d82)", () => {
    const e = at(KNOTBOY.poise, { speed: -30 });
    think(e, ctx({ band: 1 }).k);
    expect([e.facing, e.speed, ...on(e)]).toEqual([-1, 30, ...is(KNOTBOY.approach)]);
  });

  it("walks again below twenty, steps back from a man behind, and lunges only at 150…400 (0x437db2, 0x437dc3, 0x437dca)", () => {
    const slow = at(KNOTBOY.poiseAlt, { speed: 10 });
    think(slow, ctx({ band: 1 }).k);
    expect(on(slow)).toEqual(is(KNOTBOY.approach));
    const behind = at(KNOTBOY.poise, { speed: 30 });
    think(behind, ctx({ forward: -5, band: 1 }).k);
    expect(on(behind)).toEqual(is(KNOTBOY.back));
    const far = at(KNOTBOY.poise, { speed: 30 });
    think(far, ctx({ band: 0 }).k);
    expect(on(far)).toEqual(is(KNOTBOY.poise));
    for (const [coin, want] of [[1, KNOTBOY.lunge], [2, KNOTBOY.lungeAlt]] as const) {
      const e = at(KNOTBOY.poise, { speed: 30 });
      think(e, ctx({ band: 1 }, [coin]).k);
      expect([...on(e), e.swing]).toEqual([...is(want), true]);
    }
  });

  it("re-takes the step back from its first cel while it still slides on, and stands when it stops (0x437e46, 0x437e74)", () => {
    const sliding = at(KNOTBOY.back, { speed: 15, clock: 1 });
    think(sliding, ctx({}).k, 1);
    expect([sliding.clock, ...on(sliding)]).toEqual([0, ...is(KNOTBOY.back)]);
    const mid = at(KNOTBOY.back, { speed: 15, clock: 0 });
    think(mid, ctx({}).k, 1);
    expect(on(mid)).toEqual(is(KNOTBOY.back));
    const stopped = at(KNOTBOY.back, { speed: 0 });
    think(stopped, ctx({ forward: -3 }).k, 1);
    expect([stopped.facing, ...on(stopped)]).toEqual([-1, ...is(KNOTBOY.stance)]);
  });

  it("does nothing on the tags 0x473fb0 lacks", () => {
    const e = at(KNOTBOY.approach, { tag: 2 });
    expect(think(e, ctx({}).k)).toBe(false);
  });
});

describe("the leap, state 5 (0x437e93)", () => {
  it("runs launch, flight and landing in a row into the step back", () => {
    const e = at(KNOTBOY.launch, { clock: 1 });
    think(e, ctx({}).k, 4);
    expect(on(e)).toEqual(is(KNOTBOY.launch));
    for (const want of [KNOTBOY.flight, KNOTBOY.landing, KNOTBOY.back]) {
      e.clock = 4;
      think(e, ctx({}).k, 4);
      expect(on(e)).toEqual(is(want));
    }
    const odd = at(KNOTBOY.launch, { tag: 3, clock: 4 });
    expect(think(odd, ctx({}).k, 4)).toBe(false);
    expect(odd.tag).toBe(3);
  });
});

describe("the lunge and the strike, state 7 (0x438007)", () => {
  it("steps back as the strike ends, and does nothing on a tag past the four (0x438082)", () => {
    const e = at(KNOTBOY.strikeAlt, { clock: 1 });
    think(e, ctx({}).k, 2);
    expect(on(e)).toEqual(is(KNOTBOY.strikeAlt));
    e.clock = 2;
    think(e, ctx({}).k, 2);
    expect(on(e)).toEqual(is(KNOTBOY.back));
    const odd = at(KNOTBOY.lunge, { tag: 5 });
    expect(think(odd, ctx({}).k)).toBe(false);
  });

  it("answers nothing on a state with no case", () => {
    const e = at(KNOTBOY.stance, { script: 6, tag: 0 });
    expect(think(e, ctx({}).k)).toBe(false);
    expect(e.script).toBe(6);
  });
});
