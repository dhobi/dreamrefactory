/**
 * `initcop`, the TCop — its think `0x413fd0` state by state, against a
 * stand-in context, and the frame it is taken away (`0x4146ab`).
 *
 *   npx vitest run skullcracker/tests/cop.ts
 *
 * The machine suites meet cops on the city levels, where the dice pick which
 * of its states run; the gunner's chase, the doughnut's heal at a full bar and
 * the jab out of a swing at its own bound are rolled here on purpose, and each
 * check names the address in `src/brains/cop.ts` it was read from.
 *
 * No rip: the brain reads nothing off the disc.
 */
import { describe, expect, it } from "vitest";
import type { BrainCtx, Enemy } from "../src/brains/kit";
import { cop, COP, COP_SLUG, copReacts } from "../src/brains/cop";
import { FOES } from "../src/foes";
import { ctx, inState, is, on } from "./stand/brainctx";

const F = FOES.initcop;
const at = (a: Parameters<typeof inState>[1], over: Partial<Enemy> = {}) => inState("initcop", a, over);
const think = (e: Enemy, k: BrainCtx, run = 1_000) => cop(e, F, run, k);
/** a context with the walk bounds answered by the test */
const bound = (front: boolean, rear: boolean, track: Parameters<typeof ctx>[0] = {}, rolls: number[] = [], player = {}) => {
  const s = ctx(track, rolls, player);
  s.k.atBound = () => front;
  s.k.atRear = () => rear;
  return s;
};

describe("the patrol and the slug gun (0x41405c, 0x41424f)", () => {
  it("stands its one cel until the player is inside its rect, then takes the stance", () => {
    const e = at(COP.stand, { fighting: false });
    think(e, ctx({}).k);
    expect(on(e)).toEqual(is(COP.stand));
    e.fighting = true;
    think(e, ctx({}).k);
    expect(on(e)).toEqual(is(COP.stance));
  });

  it("raises, fires the slug with its sound as the fire cel ends, lowers and stands (0x4142ac)", () => {
    const shots: unknown[] = [];
    const { k, heard } = ctx({});
    k.cast = (_e, kit) => void shots.push(kit);
    const e = at(COP.raise, { clock: 5 });
    think(e, k, 5);
    expect([...on(e), e.swing]).toEqual([...is(COP.fire), true]);
    e.clock = 2;
    think(e, k, 2);
    expect(heard).toEqual(["say 0xc"]);
    expect(shots).toEqual([COP_SLUG]);
    expect(on(e)).toEqual(is(COP.lower));
    e.clock = 3;
    think(e, k, 3);
    expect(on(e)).toEqual(is(COP.stance));
  });

  it("waits out each of the three scripts, and does nothing on a fourth tag", () => {
    for (const a of [COP.raise, COP.fire, COP.lower]) {
      const e = at(a, { clock: 1 });
      think(e, ctx({}).k, 5);
      expect(on(e)).toEqual(is(a));
    }
    const odd = at(COP.raise, { tag: 3 });
    expect(think(odd, ctx({}).k)).toBe(false);
    expect([odd.script, odd.tag]).toEqual([2, 3]);
  });
});

describe("the swings, state 3 (0x4142c9)", () => {
  it("jabs or hooks the moment it is at its bound mid-wind-up, on a coin (0x4142ca)", () => {
    for (const [coin, want] of [[1, COP.jab], [2, COP.hook]] as const) {
      const { k } = bound(true, false, {}, [coin]);
      const e = at(COP.wind, { clock: 1 });
      think(e, k, 5);
      expect([...on(e), e.swing]).toEqual([...is(want), true]);
    }
    // the jab and the hook themselves (tags 3 and 4) are not interrupted
    const jab = at(COP.jab, { clock: 1 });
    think(jab, bound(true, false).k, 5);
    expect(on(jab)).toEqual(is(COP.jab));
  });

  it("winds into the swing, and every other swing hands back to the stance (0x4142fe)", () => {
    const e = at(COP.wind, { clock: 5 });
    think(e, ctx({}).k, 5);
    expect(on(e)).toEqual(is(COP.swing));
    for (const a of [COP.swing, COP.charge, COP.jab, COP.hook]) {
      const f = at(a, { clock: 5 });
      think(f, ctx({}).k, 5);
      expect(on(f)).toEqual(is(COP.stance));
    }
  });
});

describe("the walks, state 4 (0x414329)", () => {
  it("turns at its bound ahead into a walk in", () => {
    const e = at(COP.walkOut, { clock: 1 });
    think(e, bound(true, false).k, 5);
    expect([e.facing, ...on(e)]).toEqual([-1, ...is(COP.walkIn)]);
  });

  it("charges out of the walk out once backed into the bound behind it, and only out of that walk", () => {
    const e = at(COP.walkOut, { clock: 1 });
    think(e, bound(false, true).k, 5);
    expect([...on(e), e.swing]).toEqual([...is(COP.charge), true]);
    const walkIn = at(COP.walkIn, { clock: 1 });
    think(walkIn, bound(false, true).k, 5);
    expect(on(walkIn)).toEqual(is(COP.walkIn));
  });

  it("at the walk's end faces him, and swings or charges at a back turned, else stands (0x414383)", () => {
    for (const [coin, want] of [[1, COP.swing], [2, COP.charge]] as const) {
      const { k } = ctx({ forward: -30 }, [coin], { facing: -1 });
      const e = at(COP.walkIn, { clock: 5 });
      think(e, k, 5);
      expect(e.facing).toBe(-1);
      expect(on(e)).toEqual(is(want));
    }
    const facing = at(COP.walkIn, { clock: 5 });
    think(facing, ctx({}, [], { facing: -1 }).k, 5);
    expect(on(facing)).toEqual(is(COP.stance));
  });
});

describe("the doughnut, the gloats and the flinch's tail (0x4143ab, 0x4143fe, 0x41440e)", () => {
  it("heals forty as the doughnut ends, but never past the full 250 (0x4143c6)", () => {
    const low = at(COP.eat, { clock: 5, hp: 100 });
    think(low, ctx({}).k, 5);
    expect([low.hp, ...on(low)]).toEqual([140, ...is(COP.stance)]);
    const near = at(COP.eat, { clock: 5, hp: 230 });
    think(near, ctx({}).k, 5);
    expect(near.hp).toBe(250);
    const eating = at(COP.eat, { clock: 2, hp: 100 });
    think(eating, ctx({}).k, 5);
    expect(eating.hp).toBe(100);
  });

  it("stands when either gloat ends", () => {
    for (const a of [COP.gloat, COP.gloatLong]) {
      const e = at(a, { clock: 2 });
      think(e, ctx({}).k, 4);
      expect(on(e)).toEqual(is(a));
      e.clock = 4;
      think(e, ctx({}).k, 4);
      expect(on(e)).toEqual(is(COP.stance));
    }
  });

  it("after the flinch winds up one time in three, else walks out", () => {
    const e = at({ ...COP.stance, kind: 8, tag: 0 });
    think(e, ctx({}, [1]).k);
    expect(on(e)).toEqual(is(COP.wind));
    const f = at({ ...COP.stance, kind: 8, tag: 0 });
    think(f, ctx({}, [3]).k);
    expect(on(f)).toEqual(is(COP.walkOut));
  });
});

describe("the gunner, state 9 (0x414456)", () => {
  it("runs in, turning at its bound ahead, and picks the next of its three on a roll as the run ends (0x41446a)", () => {
    const e = at(COP.runIn, { clock: 2 });
    think(e, bound(true, false).k, 5);
    expect([e.facing, ...on(e)]).toEqual([-1, ...is(COP.runIn)]);
    e.clock = 5;
    think(e, ctx({}, [3]).k, 5);
    expect([e.clock, ...on(e)]).toEqual([0, ...is(COP.spray)]);
  });

  it("runs out until backed into its rear bound, then comes forward (0x41449e)", () => {
    const e = at(COP.runOut, { clock: 2 });
    think(e, ctx({}).k, 5);
    expect(on(e)).toEqual(is(COP.runOut));
    think(e, bound(false, true).k, 5);
    expect(on(e)).toEqual(is(COP.runIn));
    const ends = at(COP.runOut, { clock: 5 });
    think(ends, ctx({}, [2]).k, 5);
    expect(on(ends)).toEqual(is(COP.runOut));
  });

  it("drops the spray for a walk in once he is 512 off or 200 above (0x4144da)", () => {
    for (const [player, dy] of [[{ x: 600 }, 0], [{}, 250]] as const) {
      const e = at(COP.spray, { clock: 1 });
      think(e, ctx({ dy }, [], player).k, 5);
      expect(on(e)).toEqual(is(COP.walkIn));
    }
  });

  it("sprays again one time in four as a spray ends, else stands (0x41453b)", () => {
    const again = at(COP.spray, { clock: 5 });
    think(again, ctx({}, [1]).k, 5);
    expect([again.clock, ...on(again)]).toEqual([0, ...is(COP.spray)]);
    const stop = at(COP.spray, { clock: 5 });
    think(stop, ctx({}, [4]).k, 5);
    expect(on(stop)).toEqual(is(COP.stance));
    const mid = at(COP.spray, { clock: 2 });
    think(mid, ctx({}).k, 5);
    expect(on(mid)).toEqual(is(COP.spray));
  });

  it("falls out of a fourth tag, and out of a state the think has no case for", () => {
    const odd = at(COP.runIn, { tag: 5 });
    expect(think(odd, ctx({}).k)).toBe(false);
    expect([odd.script, odd.tag]).toEqual([9, 5]);
    const none = at(COP.stance, { script: 12 });
    expect(think(none, ctx({}).k)).toBe(false);
  });
});

describe("the stance, state 1 (0x414095)", () => {
  it("gloats over a downed player, turning on a roll under five (0x4140af)", () => {
    const turn = at(COP.stance);
    think(turn, ctx({}, [4], { down: true }).k);
    expect([turn.facing, ...on(turn)]).toEqual([-1, ...is(COP.gloat)]);
    const stay = at(COP.stance);
    think(stay, ctx({}, [5], { down: true }).k);
    expect(stay.facing).toBe(1);
  });

  it("beyond 350 walks in seven times in eight; the eighth raises the gun, or runs out with one (0x414122)", () => {
    const walk = at(COP.stance);
    think(walk, ctx({ band: 0 }, [2]).k);
    expect(on(walk)).toEqual(is(COP.walkIn));
    const plain = at(COP.stance);
    think(plain, ctx({ band: 0 }, [1]).k);
    expect(on(plain)).toEqual(is(COP.raise));
    const gunner = at(COP.stance, { param: 1 });
    think(gunner, ctx({ band: 0, forward: -10 }, [1]).k);
    expect([gunner.facing, ...on(gunner)]).toEqual([-1, ...is(COP.runOut)]);
  });

  it("at 180…350 counts its beat down, then munches or shoots on a fresh 9…21 (0x414157)", () => {
    const wait = at(COP.stance, { beat: 0, clock: 3 });
    think(wait, ctx({ band: 1 }).k, 3);
    expect([wait.beat, wait.clock, ...on(wait)]).toEqual([-1, 0, ...is(COP.stance)]);
    const munch = at(COP.stance, { beat: -1 });
    const m = ctx({ band: 1 }, [5]);
    think(munch, m.k);
    expect(m.heard).toEqual(["roll 13=5", "say 0xe"]);
    expect([munch.beat, ...on(munch)]).toEqual([13, ...is(COP.eat)]);
    const shoot = at(COP.stance, { beat: -1, param: 2 });
    think(shoot, ctx({ band: 1 }, [6]).k);
    expect([shoot.beat, ...on(shoot)]).toEqual([14, ...is(COP.runOut)]);
    const raise = at(COP.stance, { beat: -1 });
    think(raise, ctx({ band: 1 }, [6]).k);
    expect(on(raise)).toEqual(is(COP.raise));
  });

  it("at 70…180 walks in on a back turned and, with the beat lapsed or a swing, swings or charges (0x4141be, 0x414207)", () => {
    const back = at(COP.stance, { beat: 5 });
    think(back, ctx({ band: 2 }, [], { facing: 1 }).k);
    expect([back.beat, ...on(back)]).toEqual([4, ...is(COP.walkIn)]);
    const waiting = at(COP.stance, { beat: 5, clock: 1 });
    think(waiting, ctx({ band: 2 }).k, 5);
    expect(on(waiting)).toEqual(is(COP.stance));
    const lapsed = at(COP.stance, { beat: 5, clock: 5 });
    think(lapsed, ctx({ band: 2 }).k, 5);
    expect([lapsed.clock, ...on(lapsed)]).toEqual([0, ...is(COP.stance)]);
    for (const [coin, want] of [[1, COP.swing], [2, COP.charge]] as const) {
      const e = at(COP.stance, { beat: 5 });
      think(e, ctx({ band: 2 }, [1, coin], { swinging: true }).k);
      expect([e.beat, ...on(e), e.swing]).toEqual([4, ...is(want), true]);
    }
  });

  it("backs off inside 70, and on band -1 only rewinds the stance as it ends (0x41422f, 0x41423f)", () => {
    const close = at(COP.stance);
    think(close, ctx({ band: 3 }).k);
    expect(on(close)).toEqual(is(COP.walkOut));
    const behind = at(COP.stance, { clock: 1 });
    think(behind, ctx({ band: -1 }).k, 5);
    expect([behind.clock, ...on(behind)]).toEqual([1, ...is(COP.stance)]);
  });
});

describe("taken away (0x4146ab, 0x4146d2)", () => {
  it("says 0xd and sprays 120 of goo the frame its death ends, and only then", () => {
    const death = F.death!;
    const quiet = ctx({});
    copReacts(at(death, { state: "dead", clock: 1 }), F, 5, quiet.k);
    copReacts(at(COP.stance, { clock: 9 }), F, 5, quiet.k);
    expect(quiet.heard).toEqual([]);
    const gone = ctx({});
    copReacts(at(death, { state: "dead", clock: 5 }), F, 5, gone.k);
    expect(gone.heard).toEqual(["say 0xd", "spray 120"]);
  });
});
