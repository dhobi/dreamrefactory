/**
 * `initknifeboy`, the skater — its think `0x439ca0` state by state against a
 * stand-in context.
 *
 *   npx vitest run skullcracker/tests/knifeboy.ts
 *
 * The machine suites skate past knifeboys in the city, where the dice and the
 * player decide which branches run. The push-off away from a downed player,
 * the guard's pose shift, the coast's three exits, the jump nothing on the
 * page starts, and the lunge abandoned when he falls are taken here on
 * purpose, each against the address in `src/brains/knifeboy.ts` it was read
 * from.
 *
 * No rip: the brain reads nothing off the disc.
 */
import { describe, expect, it } from "vitest";
import { TICK_SCALE, type BrainCtx, type Enemy } from "../src/brains/kit";
import { knifeboy, KNIFEBOY, knifeboyDown } from "../src/brains/knifeboy";
import { FOES } from "../src/foes";
import { ctx, inState, is, on } from "./stand/brainctx";

const F = FOES.initknifeboy;
const at = (a: Parameters<typeof inState>[1], over: Partial<Enemy> = {}) => inState("initknifeboy", a, over);
const think = (e: Enemy, k: BrainCtx, run = 1_000) => knifeboy(e, F, run, k);

describe("the push-off away from a downed player (0x439d43, 0x439d7c)", () => {
  it("turns away from him whichever side he lies, and keeps a facing already away", () => {
    // he is east of it: away is west
    const east = at(KNIFEBOY.push, { facing: 1, x: 0, speed: 30 });
    expect(knifeboyDown(east, ctx({}, [], { x: 100 }).k)).toBe(KNIFEBOY.flee);
    expect([east.facing, east.speed]).toEqual([-1, -30]);
    const west = at(KNIFEBOY.push, { facing: 1, x: 0, speed: 30 });
    knifeboyDown(west, ctx({}, [], { x: -100 }).k);
    expect([west.facing, west.speed]).toEqual([1, 30]);
  });

  it("interrupts every state but the statue and the flee itself, and the interrupt is the flee", () => {
    for (const a of [KNIFEBOY.poise[0], KNIFEBOY.push, KNIFEBOY.lunge[0], KNIFEBOY.crouch]) {
      const e = at(a, { x: 0 });
      think(e, ctx({}, [], { down: true, x: 100 }).k);
      expect(on(e)).toEqual(is(KNIFEBOY.flee));
    }
    const statue = at(KNIFEBOY.statue, { fighting: false });
    think(statue, ctx({}, [], { down: true }).k);
    expect(on(statue)).toEqual(is(KNIFEBOY.statue));
    const fleeing = at(KNIFEBOY.flee, { clock: 1 });
    think(fleeing, ctx({}, [], { down: true }).k, 10);
    expect([fleeing.clock, ...on(fleeing)]).toEqual([1, ...is(KNIFEBOY.flee)]);
  });
});

describe("the statue (0x439da3)", () => {
  it("is held still until the player is in its rect, then pushes off", () => {
    const e = at(KNIFEBOY.statue, { fighting: false, vx: 5, speed: 9 });
    think(e, ctx({}).k);
    expect([e.vx, e.speed, ...on(e)]).toEqual([0, 0, ...is(KNIFEBOY.statue)]);
    e.fighting = true;
    think(e, ctx({}).k);
    expect(on(e)).toEqual(is(KNIFEBOY.push));
  });
});

describe("standing, state 2 (0x439de4)", () => {
  it("turns first when he is behind, and backs off inside 85 (0x439dec, 0x439e37)", () => {
    const e = at(KNIFEBOY.poise[0]);
    think(e, ctx({ forward: -30, band: 3 }).k);
    expect([e.facing, ...on(e)]).toEqual([-1, ...is(KNIFEBOY.backOff)]);
  });

  it("outside its three bands does nothing, unless he swings, and then guards (0x439e63)", () => {
    for (const band of [-1, 4]) {
      const e = at(KNIFEBOY.poise[1]);
      think(e, ctx({ band }).k);
      expect(on(e)).toEqual(is(KNIFEBOY.poise[1]));
      think(e, ctx({ band }, [], { swinging: true }).k);
      expect(on(e)).toEqual(is(KNIFEBOY.guard));
    }
  });

  it("winds up on a 1; on a 2 pushes off at a man facing it and winds up at a back (0x439e7b)", () => {
    const one = at(KNIFEBOY.poise[0]);
    think(one, ctx({ band: 1 }, [1]).k);
    expect([...on(one), one.swing]).toEqual([...is(KNIFEBOY.windUp), true]);
    const facing = at(KNIFEBOY.poise[0]);
    think(facing, ctx({ band: 1 }, [2], { facing: -1 }).k);
    expect(on(facing)).toEqual(is(KNIFEBOY.push));
    const back = at(KNIFEBOY.poise[0]);
    think(back, ctx({ band: 2 }, [2], { facing: 1 }).k);
    expect(on(back)).toEqual(is(KNIFEBOY.windUp));
  });

  it("holds the guard until he swings again, then shifts pose on a coin (0x439ea9)", () => {
    const e = at(KNIFEBOY.guard);
    think(e, ctx({}).k);
    expect(on(e)).toEqual(is(KNIFEBOY.guard));
    for (const coin of [1, 2]) {
      const g = at(KNIFEBOY.guard);
      think(g, ctx({}, [coin], { swinging: true }).k);
      expect(on(g)).toEqual(is(KNIFEBOY.poise[coin - 1]));
    }
  });

  it("ends the back-off in the first pose, and does nothing on the tags 0x474570 lacks (0x439ecc)", () => {
    const e = at(KNIFEBOY.backOff, { clock: 1 });
    think(e, ctx({}).k, 4);
    expect(on(e)).toEqual(is(KNIFEBOY.backOff));
    e.clock = 4;
    think(e, ctx({}).k, 4);
    expect(on(e)).toEqual(is(KNIFEBOY.poise[0]));
    const odd = at(KNIFEBOY.guard, { tag: 3 });
    expect(think(odd, ctx({}).k)).toBe(false);
    expect(odd.tag).toBe(3);
  });
});

describe("the skate, state 4 (0x439ee3)", () => {
  const coast = (over: Partial<Enemy> = {}) => at(KNIFEBOY.coast[0], { speed: 30, ...over });

  it("pushes off again when it slides back or slows under twenty (0x439f2a)", () => {
    for (const speed of [-5, 10]) {
      const e = coast({ speed });
      think(e, ctx({ band: 1 }).k);
      expect(on(e)).toEqual(is(KNIFEBOY.push));
    }
  });

  it("brakes with him behind, coasts on outside 150…400, and lunges inside it on a coin", () => {
    const behind = coast();
    think(behind, ctx({ forward: -1, band: 1 }).k);
    expect(on(behind)).toEqual(is(KNIFEBOY.brake));
    const far = coast();
    think(far, ctx({ band: 0 }).k);
    expect(on(far)).toEqual(is(KNIFEBOY.coast[0]));
    for (const coin of [1, 2]) {
      const e = coast();
      think(e, ctx({ band: 1 }, [coin]).k);
      expect([...on(e), e.swing]).toEqual([...is(KNIFEBOY.lunge[coin - 1]), true]);
    }
  });

  it("ends the push-off in a coast at 150…400 and in a lunge anywhere else (0x439f92)", () => {
    const mid = at(KNIFEBOY.push, { clock: 6 });
    think(mid, ctx({ band: 1 }, [2]).k, 6);
    expect(on(mid)).toEqual(is(KNIFEBOY.coast[1]));
    const close = at(KNIFEBOY.push, { clock: 6 });
    think(close, ctx({ band: 3 }, [1]).k, 6);
    expect(on(close)).toEqual(is(KNIFEBOY.lunge[0]));
    const going = at(KNIFEBOY.push, { clock: 2 });
    think(going, ctx({ band: 3 }).k, 6);
    expect(on(going)).toEqual(is(KNIFEBOY.push));
  });

  it("re-brakes from its first cel while it is still moving on, and stands in the first pose once stopped (0x43a019, 0x43a028)", () => {
    const moving = at(KNIFEBOY.brake, { speed: 20, clock: 1 });
    think(moving, ctx({}).k, 1);
    expect([moving.clock, ...on(moving)]).toEqual([0, ...is(KNIFEBOY.brake)]);
    const mid = at(KNIFEBOY.brake, { speed: 20, clock: 0 });
    think(mid, ctx({}).k, 1);
    expect(on(mid)).toEqual(is(KNIFEBOY.brake));
    const stopped = at(KNIFEBOY.brake, { speed: 0, vx: 0, vy: 0 });
    think(stopped, ctx({ forward: -5 }).k, 1);
    expect([stopped.facing, ...on(stopped)]).toEqual([-1, ...is(KNIFEBOY.poise[0])]);
    const back = at(KNIFEBOY.brake, { speed: -3, vy: 2 });
    think(back, ctx({}).k, 1);
    expect([back.facing, ...on(back)]).toEqual([1, ...is(KNIFEBOY.poise[0])]);
  });

  it("does nothing on tags 2 and 3, which 0x474648 does not have", () => {
    const e = at(KNIFEBOY.push, { tag: 2 });
    expect(think(e, ctx({}).k)).toBe(false);
    expect(e.tag).toBe(2);
  });
});

describe("the jump, state 5 (0x43a038)", () => {
  it("gathers, arcs, lands and brakes, one script at a time (0x43a08d, 0x43a0a4, 0x43a0bb)", () => {
    const e = at(KNIFEBOY.crouch, { clock: 1 });
    think(e, ctx({}).k, 4);
    expect(on(e)).toEqual(is(KNIFEBOY.crouch));
    for (const want of [KNIFEBOY.arc, KNIFEBOY.land, KNIFEBOY.brake]) {
      e.clock = 4;
      think(e, ctx({}).k, 4);
      expect(on(e)).toEqual(is(want));
    }
    const odd = at(KNIFEBOY.crouch, { tag: 3, clock: 4 });
    expect(think(odd, ctx({}).k, 4)).toBe(false);
    expect(odd.tag).toBe(3);
  });
});

describe("the knife, state 7 (0x43a1df)", () => {
  it("holds the lunge while it coasts in at ten or more, and commits with 0x10 into the follow-through (0x43a204, 0x43a229)", () => {
    const coasting = at(KNIFEBOY.lunge[1], { speed: 15 });
    think(coasting, ctx({}).k);
    expect(on(coasting)).toEqual(is(KNIFEBOY.lunge[1]));
    const { k, heard } = ctx({});
    const e = at(KNIFEBOY.lunge[1], { speed: 5 });
    think(e, k);
    expect(heard).toEqual(["say 0x10"]);
    expect(on(e)).toEqual(is(KNIFEBOY.follow[1]));
  });

  it("brakes as the follow-through and the recovery end (0x43a25a, 0x43a2d1)", () => {
    for (const a of [KNIFEBOY.follow[0], KNIFEBOY.recover]) {
      const e = at(a, { clock: 1 });
      think(e, ctx({}).k, 4);
      expect(on(e)).toEqual(is(a));
      e.clock = 4;
      think(e, ctx({}).k, 4);
      expect(on(e)).toEqual(is(KNIFEBOY.brake));
    }
    const odd = at(KNIFEBOY.lunge[0], { tag: 6 });
    expect(think(odd, ctx({}).k)).toBe(false);
  });

  it("waits out the wind-up before it throws", () => {
    const { k, heard } = ctx({});
    const e = at(KNIFEBOY.windUp, { clock: 2 });
    think(e, k, 12);
    expect(heard).toEqual([]);
    expect(on(e)).toEqual(is(KNIFEBOY.windUp));
  });
});

describe("while he is down, state 8 (0x43a2e3)", () => {
  it("skates away again from its first cel while he stays down, and pushes off the frame he is up (0x43a2fc)", () => {
    const e = at(KNIFEBOY.flee, { clock: 12 });
    think(e, ctx({}, [], { down: true }).k, 12);
    expect([e.clock, ...on(e)]).toEqual([0, ...is(KNIFEBOY.flee)]);
    e.clock = 12;
    think(e, ctx({}).k, 12);
    expect(on(e)).toEqual(is(KNIFEBOY.push));
  });

  it("answers nothing in state 3, which has no script", () => {
    const e = at(KNIFEBOY.push, { script: 3, tag: 0, vx: 2 * TICK_SCALE });
    expect(think(e, ctx({}).k)).toBe(false);
    expect(e.script).toBe(3);
  });
});
