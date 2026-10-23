/**
 * `initmaskboy`, the mall's masked gang — its think `0x438760` and its
 * knockdown reaction (`maskboyReacts`), the states `tests/brains.ts` leaves,
 * against a stand-in context.
 *
 *   npx vitest run skullcracker/tests/maskboy.ts
 *
 * `tests/brains.ts` has the roller, the gloats, the brace and the give-ground;
 * here are the rest — the statue, the guard's bands, the coast and its three
 * exits, the leap nothing on the page starts, and the attack's wind-up and
 * strike — each against the address in `src/brains/maskboy.ts` it was read
 * from. Every frame opens on `0x438848`'s roll for the roller, so each test's
 * dice start with one that does not roll it.
 *
 * No rip: the brain reads nothing off the disc.
 */
import { describe, expect, it } from "vitest";
import type { BrainCtx, Enemy } from "../src/brains/kit";
import { maskboy, MASKBOY, maskboyReacts } from "../src/brains/maskboy";
import { FOES } from "../src/foes";
import { ctx, inState, is, on } from "./stand/brainctx";

const F = FOES.initmaskboy;
const at = (a: Parameters<typeof inState>[1], over: Partial<Enemy> = {}) => inState("initmaskboy", a, over);
const think = (e: Enemy, k: BrainCtx, run = 1_000) => maskboy(e, F, run, k);
/** `0x438848`'s roll, never under its own threshold */
const N = MASKBOY.roller.odds[0];
const roll = (...more: number[]) => [N, ...more];

describe("the knockdown's reaction (0x438805, 0x438841)", () => {
  it("puts the gloat on over a flinch the frame he is down, facing him, and takes the roller's roll", () => {
    const { k, heard } = ctx({ forward: -5 }, roll(), { down: true });
    const e = at(F.flinch![0], { state: "flinch", clock: 1 });
    expect(maskboyReacts(e, F, 10, k)).toBe(MASKBOY.gloat);
    expect(e.facing).toBe(-1);
    expect(heard).toEqual([`roll ${N}=${N}`]);
    // ...with him up there is nothing to put on
    const up = ctx({}, roll());
    expect(maskboyReacts(at(F.flinch![0], { state: "flinch" }), F, 10, up.k)).toBeUndefined();
  });
});

describe("the gloat, state 8 (0x438d39)", () => {
  it("plays its lap out before it rolls to trade gloats (0x438d6e)", () => {
    const { k, heard } = ctx({}, roll(), { down: true });
    const e = at(MASKBOY.gloat, { clock: 3 });
    think(e, k, 10);
    expect(heard).toEqual([`roll ${N}=${N}`]);
    expect([e.clock, ...on(e)]).toEqual([3, ...is(MASKBOY.gloat)]);
  });
});

describe("dormant (0x4388c5)", () => {
  it("is held still until he enters its rect, then runs", () => {
    const e = at(MASKBOY.dormant, { fighting: false, vx: 3, speed: 3 });
    think(e, ctx({}, roll()).k);
    expect([e.vx, e.speed, ...on(e)]).toEqual([0, 0, ...is(MASKBOY.dormant)]);
    e.fighting = true;
    think(e, ctx({}, roll()).k);
    expect(on(e)).toEqual(is(MASKBOY.run));
  });

  it("does nothing in states 3 and 4, nor in the page's 9 and 10 (0x438e80)", () => {
    for (const script of [3, 4, 9]) {
      const e = at(MASKBOY.run, { script });
      expect(think(e, ctx({}, roll()).k)).toBe(false);
      expect(e.script).toBe(script);
    }
  });
});

describe("the guard, state 2 (0x438906)", () => {
  it("runs at him from any of the three outer bands (0x43896d)", () => {
    for (const band of [0, 1, 2]) {
      const e = at(MASKBOY.guard[0]);
      think(e, ctx({ band }, roll()).k);
      expect(on(e)).toEqual(is(MASKBOY.run));
    }
  });

  it("drops to the first pose as the give-ground ends, and does nothing on tags 3 and 4 (0x4389cc)", () => {
    const e = at(MASKBOY.giveGround, { clock: 1 });
    think(e, ctx({}, roll()).k, 4);
    expect(on(e)).toEqual(is(MASKBOY.giveGround));
    const odd = at(MASKBOY.guard[0], { tag: 3 });
    expect(think(odd, ctx({}, roll()).k)).toBe(false);
    expect(odd.tag).toBe(3);
  });
});

describe("travel, state 5 (0x438b00)", () => {
  it("runs again out of a coast that slid back or slowed under twenty (0x438b47)", () => {
    for (const speed of [-1, 19]) {
      const e = at(MASKBOY.carry[0], { speed });
      think(e, ctx({ band: 1 }, roll()).k);
      expect(on(e)).toEqual(is(MASKBOY.run));
    }
  });

  it("backs off from a man behind it, coasts on outside 150…400 and winds up inside it (0x438b7d, 0x438b8c)", () => {
    const behind = at(MASKBOY.carry[1], { speed: 30 });
    think(behind, ctx({ forward: -2, band: 1 }, roll()).k);
    expect(on(behind)).toEqual(is(MASKBOY.backOff));
    const far = at(MASKBOY.carry[1], { speed: 30 });
    think(far, ctx({ band: 0 }, roll()).k);
    expect(on(far)).toEqual(is(MASKBOY.carry[1]));
    for (const coin of [1, 2]) {
      const e = at(MASKBOY.carry[0], { speed: 30 });
      think(e, ctx({ band: 1 }, roll(coin)).k);
      expect([...on(e), e.swing]).toEqual([...is(MASKBOY.windUp[coin - 1]), true]);
    }
  });

  it("ends the run in a coast at 150…400 and in a wind-up anywhere else (0x438bd9)", () => {
    const going = at(MASKBOY.run, { clock: 1 });
    think(going, ctx({ band: 1 }, roll()).k, 6);
    expect(on(going)).toEqual(is(MASKBOY.run));
    const mid = at(MASKBOY.run, { clock: 6 });
    think(mid, ctx({ band: 1 }, roll(2)).k, 6);
    expect(on(mid)).toEqual(is(MASKBOY.carry[1]));
    const close = at(MASKBOY.run, { clock: 6 });
    think(close, ctx({ band: 3 }, roll(1)).k, 6);
    expect(on(close)).toEqual(is(MASKBOY.windUp[0]));
  });

  it("re-takes the give-ground from its first cel while it slides on, and guards facing him once stopped (0x438c2b, 0x438c3d)", () => {
    const sliding = at(MASKBOY.backOff, { speed: 9, clock: 1 });
    think(sliding, ctx({}, roll()).k, 1);
    expect([sliding.clock, ...on(sliding)]).toEqual([0, ...is(MASKBOY.backOff)]);
    const mid = at(MASKBOY.backOff, { speed: 9 });
    think(mid, ctx({}, roll()).k, 1);
    expect(on(mid)).toEqual(is(MASKBOY.backOff));
    const stopped = at(MASKBOY.backOff, { speed: 0 });
    think(stopped, ctx({ forward: -1 }, roll()).k, 1);
    expect([stopped.facing, ...on(stopped)]).toEqual([-1, ...is(MASKBOY.guard[0])]);
    const back = at(MASKBOY.backOff, { speed: -4 });
    think(back, ctx({}, roll()).k, 1);
    expect([back.facing, ...on(back)]).toEqual([1, ...is(MASKBOY.guard[0])]);
  });

  it("does nothing on tags 2 and 3", () => {
    const e = at(MASKBOY.run, { tag: 2 });
    expect(think(e, ctx({}, roll()).k)).toBe(false);
  });
});

describe("the leap, state 6 (0x438c55)", () => {
  it("chains take-off, flight and landing into the give-ground (0x438c6c, 0x438c83, 0x438c9a)", () => {
    const e = at(MASKBOY.spring, { clock: 1 });
    think(e, ctx({}, roll()).k, 4);
    expect(on(e)).toEqual(is(MASKBOY.spring));
    for (const want of [MASKBOY.flight, MASKBOY.landing, MASKBOY.backOff]) {
      e.clock = 4;
      think(e, ctx({}, roll()).k, 4);
      expect(on(e)).toEqual(is(want));
    }
    const odd = at(MASKBOY.spring, { tag: 3, clock: 4 });
    expect(think(odd, ctx({}, roll()).k, 4)).toBe(false);
    expect(odd.tag).toBe(3);
  });
});

describe("the attack, state 7 (0x438cac)", () => {
  it("holds the wind-up while it travels at ten or more toward him (0x438cd1)", () => {
    const e = at(MASKBOY.windUp[0], { speed: 12 });
    think(e, ctx({}, roll()).k);
    expect(on(e)).toEqual(is(MASKBOY.windUp[0]));
  });

  it("strikes with mall.snd 5 once slow or with him behind, the tag plus two (0x438cf2, 0x438d09)", () => {
    for (const [tag, track] of [[0, {}], [1, { forward: -3 }]] as const) {
      const { k, heard } = ctx(track, roll());
      const e = at(MASKBOY.windUp[tag], { speed: tag === 0 ? 3 : 40 });
      think(e, k);
      expect(heard.slice(1)).toEqual(["say 0x5"]);
      expect([...on(e), e.swing]).toEqual([...is(MASKBOY.strike[tag]), true]);
    }
  });

  it("gives ground as the strike ends, and does nothing on a tag past the four (0x438d27)", () => {
    const e = at(MASKBOY.strike[1], { clock: 1 });
    think(e, ctx({}, roll()).k, 2);
    expect(on(e)).toEqual(is(MASKBOY.strike[1]));
    e.clock = 2;
    think(e, ctx({}, roll()).k, 2);
    expect(on(e)).toEqual(is(MASKBOY.backOff));
    const odd = at(MASKBOY.windUp[0], { tag: 4 });
    expect(think(odd, ctx({}, roll()).k)).toBe(false);
  });
});
