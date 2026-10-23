/**
 * `initwerec`, the city's thrower — its think `0x4523d0` and its death throw
 * (`werecReacts`, `0x45269b`) against a stand-in context.
 *
 *   npx vitest run skullcracker/tests/werec.ts
 *
 * `tests/machine/city.ts` watches werecs throw on their own row. The fan at a
 * player on the row below, its seven-step counter, the back-off into the bound
 * behind it, the mill while he is down and the walk home, and the death throw's
 * fan at itself are taken here on purpose, against the addresses
 * `src/brains/werec.ts` was read from.
 *
 * No rip: the brain reads nothing off the disc.
 */
import { describe, expect, it } from "vitest";
import type { Aim, BrainCtx, Enemy } from "../src/brains/kit";
import { werec, WEREC, werecReacts } from "../src/brains/werec";
import { FOES } from "../src/foes";
import { ctx, inState, is, on } from "./stand/brainctx";

const F = FOES.initwerec;
const at = (a: Parameters<typeof inState>[1], over: Partial<Enemy> = {}) => inState("initwerec", a, over);
const think = (e: Enemy, k: BrainCtx, run = 1_000) => werec(e, F, run, k);

/** a context that writes down every shot's aim */
function aimed(track: Parameters<typeof ctx>[0] = {}, rolls: number[] = [], player = {}) {
  const s = ctx(track, rolls, player);
  const shots: Aim[] = [];
  s.k.cast = (_e, _kit, aim) => void shots.push(aim!);
  return { ...s, shots };
}

describe("the short states", () => {
  it("hands the swipe back to the stance as it ends (0x45274f)", () => {
    const e = at(WEREC.swipe, { clock: 1 });
    think(e, ctx({}).k, 4);
    expect(on(e)).toEqual(is(WEREC.swipe));
    e.clock = 4;
    think(e, ctx({}).k, 4);
    expect(on(e)).toEqual(is(WEREC.stance));
  });

  it("mills again while he is down, and walks back onto its record's point the frame he is up (0x452790, 0x4527b5)", () => {
    const e = at(WEREC.mill, { clock: 1, x: 40, home: 400 });
    think(e, ctx({}, [], { down: true }).k, 6);
    expect([e.clock, ...on(e)]).toEqual([1, ...is(WEREC.mill)]);
    e.clock = 6;
    think(e, ctx({}, [], { down: true }).k, 6);
    expect([e.clock, ...on(e)]).toEqual([0, ...is(WEREC.mill)]);
    e.clock = 6;
    think(e, ctx({}).k, 6);
    expect([e.x, e.fighting, ...on(e)]).toEqual([400, false, ...is(WEREC.idle)]);
    // with no home on record it stays where it is
    const homeless = at(WEREC.mill, { clock: 6, x: 40 });
    think(homeless, ctx({}).k, 6);
    expect(homeless.x).toBe(40);
  });

  it("hands the follow-through back, and falls out of a fourth throw tag (0x452820, 0x4527de)", () => {
    const e = at(WEREC.release, { clock: 4 });
    think(e, ctx({}).k, 4);
    expect(on(e)).toEqual(is(WEREC.stance));
    const odd = at(WEREC.fan, { tag: 3, clock: 4 });
    expect(think(odd, ctx({}).k, 4)).toBe(false);
    expect(odd.tag).toBe(3);
  });

  it("fans flat at thirteen a step on a counter that steps 0…6 and wraps, and lobs on the wrap to zero (0x452851, 0x452875)", () => {
    const vx: number[] = [];
    const e = at(WEREC.fan, { side: 0, facing: 1 });
    for (let i = 0; i < 7; i++) {
      const s = aimed({}, [], { x: 400 });
      Object.assign(e, { anim: WEREC.fan, script: 6, tag: 2, clock: 4 });
      think(e, s.k, 4);
      expect(on(e)).toEqual(is(WEREC.release));
      vx.push(s.shots[0].vx);
      if (i < 6) expect(s.shots[0].rise).toBe(0);
      else expect(s.shots[0].rise).toBeGreaterThan(0);
    }
    expect(e.side).toBe(0);
    // the seventh is the aimed lob: isqrt(400 * 10) >> 1 = 31 both ways
    expect(vx).toEqual([13, 26, 39, 52, 65, 78, 31]);
  });

  it("answers nothing in a state with no case", () => {
    const e = at(WEREC.stance, { script: 3 });
    expect(think(e, ctx({}).k)).toBe(false);
  });
});

describe("the stance, state 1 (0x452491)", () => {
  it("turns its back on a downed player and mills, flipping twice when he is behind (0x4524ad)", () => {
    const e = at(WEREC.stance);
    think(e, ctx({}, [], { down: true }).k);
    expect([e.facing, ...on(e)]).toEqual([-1, ...is(WEREC.mill)]);
    const behind = at(WEREC.stance);
    think(behind, ctx({ forward: -1 }, [], { down: true }).k);
    expect(behind.facing).toBe(1);
  });

  it("charges beyond 550 and walks in at 450…550, unless at its bound; swipes inside 80 (0x4524ed, 0x45251a, 0x4525da)", () => {
    const run = at(WEREC.stance);
    think(run, ctx({ band: 0 }).k);
    expect(on(run)).toEqual(is(WEREC.charge));
    const close = at(WEREC.stance);
    think(close, ctx({ band: 4 }).k);
    expect([...on(close), close.swing]).toEqual([...is(WEREC.swipe), true]);
    const e = at(WEREC.stance);
    think(e, ctx({ band: 1 }).k);
    expect(on(e)).toEqual(is(WEREC.walk));
    const s = ctx({ band: 1 });
    s.k.atBound = () => true;
    const stuck = at(WEREC.stance);
    think(stuck, s.k);
    expect(on(stuck)).toEqual(is(WEREC.stance));
  });

  it("backs off at 80…220 by charging the other way, unless its back is already at its bound (0x4525a7, 0x4525b9)", () => {
    const e = at(WEREC.stance);
    think(e, ctx({ band: 3 }).k);
    expect([e.facing, e.shove, ...on(e)]).toEqual([-1, 0, ...is(WEREC.charge)]);
    const s = ctx({ band: 3 });
    // only the bound behind it is near: `0x456590` against its back
    s.k.atBound = (q) => q.facing < 0;
    const pinned = at(WEREC.stance);
    think(pinned, s.k);
    expect([pinned.facing, ...on(pinned)]).toEqual([1, ...is(WEREC.charge)]);
  });

  it("on another row throws nothing at a thousand below, nor behind or beyond the first band (0x45261c, 0x45262c)", () => {
    const deep = ctx({ dy: 1000, band: 2 }, [1]);
    const e = at(WEREC.stance, { beat: -1 });
    think(e, deep.k);
    expect(deep.heard).toEqual(["roll 25=1"]);
    expect([e.beat, ...on(e)]).toEqual([25, ...is(WEREC.stance)]);
    const far = ctx({ dy: 100, band: 0 }, [1]);
    const f = at(WEREC.stance, { beat: -1 });
    think(f, far.k);
    expect(on(f)).toEqual(is(WEREC.stance));
    const fan = ctx({ dy: 100, band: 2 }, [1]);
    const g = at(WEREC.stance, { beat: -1 });
    think(g, fan.k);
    expect(fan.heard).toEqual(["roll 25=1", "say 0x1c"]);
    expect(on(g)).toEqual(is(WEREC.fan));
  });
});

describe("the death throw (0x45269b)", () => {
  it("lies twelve into the ground dead, and throws only out of its burn", () => {
    const { k, heard } = ctx({});
    const e = at(F.death!, { state: "dead" });
    werecReacts(e, F, 0, k);
    expect([e.floor, heard]).toEqual([-12, []]);
  });

  it("fans one shot at itself a frame from a jittered point, stepping the counter and turning each time (0x4526bd, 0x4526e0)", () => {
    const burn = F.burns!.anim!;
    const e = at(burn, { side: 6, facing: 1, x: 100, y: 50 });
    const s = aimed({}, [10, 40]);
    werecReacts(e, F, 0, s.k);
    expect(s.shots).toEqual([{ vx: 0, rise: 0 }]);
    expect([e.side, e.facing, e.x, e.y]).toEqual([0, -1, 100, 50]);
    const t = aimed({}, [1, 1]);
    werecReacts(e, F, 0, t.k);
    expect(t.shots).toEqual([{ vx: -13, rise: 0 }]);
    expect([e.side, e.facing]).toEqual([1, 1]);
  });
});
