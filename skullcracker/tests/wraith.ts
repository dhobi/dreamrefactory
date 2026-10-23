/**
 * `initwraith` — its think `0x424800`, its hit gate `0x424f80`, and its
 * flinch and death (`wraithReacts`), the named one and the lesser copies it
 * splits off, against a stand-in context.
 *
 *   npx vitest run skullcracker/tests/wraith.ts
 *
 * `tests/machine/grave.ts` fights it in the graveyard, where the dice decide
 * which bands and coins come up. Here each is taken on purpose: the cast's
 * held arm, the split refused past four, a lesser one's clawless hover, the
 * glide's three heights, and the named one's death taking every copy with it,
 * each checked against the address in `src/brains/wraith.ts`.
 *
 * The class keeps one word of its own in module state — how many times the
 * named one has fallen — so the tests that make a lesser one read it the way
 * the creator does, through a first think.
 *
 * No rip: the brain reads nothing off the disc.
 */
import { describe, expect, it } from "vitest";
import { TICK_SCALE, type BrainCtx, type Enemy } from "../src/brains/kit";
import { wraith, WRAITH, WRAITH_BEAM, wraithGate, wraithReacts } from "../src/brains/wraith";
import { FOES } from "../src/foes";
import { ctx, inState, is, on } from "./stand/brainctx";

const F = FOES.initwraith;
const at = (a: Parameters<typeof inState>[1], over: Partial<Enemy> = {}) =>
  inState("initwraith", a, { decisions: 1, ...over });
const think = (e: Enemy, k: BrainCtx, run = 1_000) => wraith(e, F, run, k);
const v = (n: number) => Math.round((n / TICK_SCALE) * 1000) / 1000;
/** a lesser wraith, born as the class's creator makes one while another lives */
function lesser(): Enemy {
  const e = inState("initwraith", WRAITH.hover, { decisions: undefined });
  const s = ctx({});
  s.k.count = () => 2;
  think(e, s.k);
  return e;
}

describe("birth (0x41ed12, 0x41ed47)", () => {
  it("is the named one when it is the only one, and a lesser one that materialises when it is not", () => {
    const named = inState("initwraith", WRAITH.statue, { decisions: undefined, fighting: false });
    const s = ctx({});
    s.k.count = () => 1;
    think(named, s.k);
    expect([named.decisions, ...on(named)]).toEqual([1, ...is(WRAITH.statue)]);
    const copy = lesser();
    expect([copy.decisions, ...on(copy)]).toEqual([0, ...is(WRAITH.fade)]);
  });
});

describe("the named one's states", () => {
  it("stands as a statue until the player is in its rect (0x42487f)", () => {
    const e = at(WRAITH.statue, { fighting: false });
    think(e, ctx({}).k);
    expect(on(e)).toEqual(is(WRAITH.statue));
    e.fighting = true;
    think(e, ctx({}).k);
    expect(on(e)).toEqual(is(WRAITH.hover));
  });

  it("hovers again as the held arm ends, after the bolt (0x424d77)", () => {
    const e = at(WRAITH.held, { clock: 1 });
    think(e, ctx({}).k, 6);
    expect(on(e)).toEqual(is(WRAITH.held));
    e.clock = 6;
    think(e, ctx({}).k, 6);
    expect(on(e)).toEqual(is(WRAITH.hover));
  });

  it("makes no copy once there are four, and hovers on (0x41ec88)", () => {
    const s = ctx({});
    s.k.count = () => 4;
    const e = at(WRAITH.split, { clock: 12 });
    think(e, s.k, 12);
    expect(s.heard).toEqual([]);
    expect(on(e)).toEqual(is(WRAITH.hover));
  });

  it("answers nothing on a state with no case", () => {
    const e = at(WRAITH.hover, { script: 9 });
    expect(think(e, ctx({}).k)).toBe(false);
  });
});

describe("the hover, state 1 (0x4248ba)", () => {
  it("faces the player's side while he is down and re-takes the hover as it ends (0x424c29)", () => {
    for (const [px, facing] of [[100, -1], [-100, 1]] as const) {
      const e = at(WRAITH.hover, { clock: 1, swing: true });
      expect(think(e, ctx({}, [], { down: true, x: px }).k, 10)).toBe(false);
      expect([e.facing, e.swing]).toEqual([facing, true]);
      e.clock = 10;
      think(e, ctx({}, [], { down: true, x: px }).k, 10);
      expect(e.swing).toBe(false);
    }
  });

  it("beyond 230 glides on ten along its facing, climbing to a man above and halving its drop beside one (0x42490f, 0x424932, 0x424949)", () => {
    const above = at(WRAITH.hover, { y: 100, vx: 0, vy: 0 });
    think(above, ctx({ band: 0 }, [], { y: 0 }).k);
    expect([v(above.vx), v(above.vy)]).toEqual([1, -2]);
    const level = at(WRAITH.hover, { y: 100, vy: 8 * TICK_SCALE, facing: -1 });
    think(level, ctx({ band: 1 }, [], { y: 105 }).k);
    expect([v(level.vx), v(level.vy)]).toEqual([-1, 4]);
  });

  it("at 130…230 levels itself, halving the climb once inside fifty of his row (0x424963)", () => {
    const e = at(WRAITH.hover, { y: 0, vy: 10 * TICK_SCALE, beat: 3 });
    think(e, ctx({ band: 2 }, [], { y: 20 }).k);
    expect(v(e.vy)).toBe(5);
    const below = at(WRAITH.hover, { y: 300, beat: 3 });
    think(below, ctx({ band: 2 }, [], { y: 0 }).k);
    expect(v(below.vy)).toBe(-20);
    const above = at(WRAITH.hover, { y: 0, beat: 3 });
    think(above, ctx({ band: 3 }, [7], { y: 300 }).k);
    expect(v(above.vy)).toBe(25);
  });

  it("at 130…230 leaves when he swings, and otherwise shudders seven times in 47 when its beat runs out (0x4249f0, 0x424a81)", () => {
    const swing = ctx({ band: 2 }, [], { swinging: true });
    const e = at(WRAITH.hover);
    think(e, swing.k);
    expect(swing.heard).toEqual(["say 0x27"]);
    expect(on(e)).toEqual(is(WRAITH.fade));
    const shudder = at(WRAITH.hover, { beat: -1 });
    think(shudder, ctx({ band: 2 }, [6]).k);
    expect([shudder.beat, ...on(shudder)]).toEqual([5, ...is(WRAITH.shudder)]);
    const calm = at(WRAITH.hover, { beat: -1, clock: 1 });
    think(calm, ctx({ band: 2 }, [7]).k, 10);
    expect([calm.beat, ...on(calm)]).toEqual([5, ...is(WRAITH.hover)]);
  });

  it("at 60…130 shudders or splits on a swing, and a lesser one never splits (0x424b05)", () => {
    const shudder = at(WRAITH.hover);
    think(shudder, ctx({ band: 3 }, [4], { swinging: true }).k);
    expect(on(shudder)).toEqual(is(WRAITH.shudder));
    const split = ctx({ band: 3 }, [5], { swinging: true });
    const e = at(WRAITH.hover);
    think(e, split.k);
    expect(split.heard).toEqual(["roll 10=5", "say 0x28"]);
    expect(on(e)).toEqual(is(WRAITH.split));
    // the tail re-takes the hover as it ends, which clears a swing flag left on it
    const copy = lesser();
    Object.assign(copy, { anim: WRAITH.hover, script: 1, tag: 0, clock: 10, swing: true });
    think(copy, ctx({ band: 3 }, [5], { swinging: true }).k, 10);
    expect([copy.state, copy.swing, ...on(copy)]).toEqual(["gait", false, ...is(WRAITH.hover)]);
  });

  it("at 60…130 casts six times in 47 when he does nothing, and a lesser one never casts (0x424ba1)", () => {
    const e = at(WRAITH.hover);
    think(e, ctx({ band: 3 }, [5]).k);
    expect(on(e)).toEqual(is(WRAITH.cast));
    const no = at(WRAITH.hover);
    think(no, ctx({ band: 3 }, [6]).k);
    expect(on(no)).toEqual(is(WRAITH.hover));
    const copy = lesser();
    Object.assign(copy, { anim: WRAITH.hover, script: 1, tag: 0, clock: 10, swing: true });
    think(copy, ctx({ band: 3 }).k, 10);
    expect([copy.state, copy.swing, ...on(copy)]).toEqual(["gait", false, ...is(WRAITH.hover)]);
  });

  it("inside 60 claws with 0x23 only within fifty of his row, and a lesser one has no claw (0x424bd1)", () => {
    const { k, heard } = ctx({ band: 4 }, [], { y: 10 });
    const e = at(WRAITH.hover, { y: 0 });
    think(e, k);
    expect(heard).toEqual(["say 0x23"]);
    expect(on(e)).toEqual(is(WRAITH.claw));
    const high = at(WRAITH.hover, { y: 0, clock: 10, swing: true });
    think(high, ctx({ band: 4 }, [], { y: 60 }).k, 10);
    expect([high.swing, ...on(high)]).toEqual([false, ...is(WRAITH.hover)]);
    const copy = lesser();
    Object.assign(copy, { anim: WRAITH.hover, script: 1, tag: 0, clock: 10, swing: true });
    think(copy, ctx({ band: 4 }).k, 10);
    expect([copy.state, copy.swing, ...on(copy)]).toEqual(["gait", false, ...is(WRAITH.hover)]);
  });

  it("on band -1 only turns and waits, the unsigned ja at 0x4248dc", () => {
    const e = at(WRAITH.hover, { clock: 1, swing: true });
    expect(think(e, ctx({ band: -1, forward: -5 }).k, 10)).toBe(false);
    expect([e.facing, e.swing, ...on(e)]).toEqual([-1, true, ...is(WRAITH.hover)]);
    e.clock = 10;
    think(e, ctx({ band: -1 }).k, 10);
    expect(e.swing).toBe(false);
  });
});

describe("the hit gate (0x424f80)", () => {
  const blow = (over = {}) => ({ damage: 40, code: 100, by: { kind: null, kit: null, mass: 1, vx: 0, vy: 0, recoil: () => {} }, ...over });

  it("turns any negative code away (0x424fd1)", () => {
    expect(wraithGate(at(WRAITH.hover), F, blow({ code: -2 }))).toBeNull();
  });

  it("lets a blow through on the named one, and dissolves a lesser one at any blow, quietly (0x42503d)", () => {
    const b = blow();
    expect(wraithGate(at(WRAITH.hover), F, b)).toBe(b);
    const copy = lesser();
    expect(wraithGate(copy, F, b)).toEqual({ ...b, still: true, quiet: true, spare: true });
    expect([copy.hp, copy.state, copy.anim]).toEqual([0, "dead", F.death]);
  });
});

describe("the flinch and the death (wraithReacts)", () => {
  it("halves both speeds every frame of a flinch (0x424ded)", () => {
    const e = at(F.flinch![0], { state: "flinch", vx: 10 * TICK_SCALE, vy: -7 * TICK_SCALE });
    wraithReacts(e, F, 0, ctx({}).k);
    expect([v(e.vx), v(e.vy)]).toEqual([5, -3]);
  });

  it("does nothing alive or once its death is handled", () => {
    const s = ctx({});
    wraithReacts(at(WRAITH.hover), F, 0, s.k);
    wraithReacts(at(F.death!, { state: "dead", hatched: true, clock: 1 }), F, 0, s.k);
    expect(s.heard).toEqual([]);
  });

  it("flashes and shakes on its odd frames as the named one dies, and takes every lesser one with it at the end (0x424e6d, 0x424ed5)", () => {
    const death = F.death!;
    const odd = ctx({});
    const e = at(death, { state: "dead", clock: death.hold });
    wraithReacts(e, F, 10_000, odd.k);
    expect(odd.heard).toEqual(["flash 225", "shake 3"]);
    const copy = lesser();
    const other = lesser();
    const end = ctx({});
    end.k.every = () => [e, copy, other];
    e.clock = 2 * death.hold;
    wraithReacts(e, F, 2 * death.hold, end.k);
    expect(e.hatched).toBe(true);
    expect([copy.state, other.state, e.hp]).toEqual(["dead", "dead", 100]);
    // ...and a stand-in with no class walk takes nobody
    const alone = at(death, { state: "dead", clock: 2 * death.hold });
    wraithReacts(alone, F, 2 * death.hold, ctx({}).k);
    expect(alone.hatched).toBe(true);
  });

  it("cries 0x21 once as a lesser one goes (0x425058)", () => {
    const copy = lesser();
    wraithGate(copy, F, { damage: 1, code: 100, by: { kind: null, kit: null } as never });
    const s = ctx({});
    wraithReacts(copy, F, 0, s.k);
    wraithReacts(copy, F, 0, s.k);
    expect(s.heard).toEqual(["say 0x21"]);
  });

  it("dissolves a lesser one on its own next think once the named one has fallen to its beam (0x424ff7, 0x424f30)", () => {
    const copy = lesser();
    Object.assign(copy, { anim: WRAITH.hover, script: 1, tag: 0 });
    expect(wraithGate(at(WRAITH.hover), F, { damage: 1, code: 100, by: { kind: null, kit: WRAITH_BEAM } as never })).toBeNull();
    const s = ctx({});
    think(copy, s.k);
    expect(s.heard).toEqual(["say 0x21"]);
    expect([copy.state, copy.hatched]).toEqual(["dead", true]);
  });
});
