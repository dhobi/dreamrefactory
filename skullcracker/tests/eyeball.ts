/**
 * `initeyeball` — its think `0x43dde0` state by state, the hover `0x43de45`
 * that runs ahead of it, and its death (`eyeballReacts`), each taken on
 * purpose against a stand-in context.
 *
 *   npx vitest run skullcracker/tests/eyeball.ts
 *
 * The machine suites meet eyeballs in the tower, where the dice and the
 * player's state decide which branches run. The swoop on a juddering player
 * with its carry and struggle for both characters, the ladder hunt's three
 * phases and the death's pop are rolled here on purpose, each checked against
 * the address in `src/brains/eyeball.ts` it was read from.
 *
 * No rip: the brain reads nothing off the disc.
 */
import { describe, expect, it } from "vitest";
import { TICK_SCALE, type BrainCtx, type Enemy } from "../src/brains/kit";
import { eyeball, EYEBALL, eyeballReacts } from "../src/brains/eyeball";
import { FOES } from "../src/foes";
import { ctx, inState, is, on } from "./stand/brainctx";

const F = FOES.initeyeball;
const at = (a: Parameters<typeof inState>[1], over: Partial<Enemy> = {}) => inState("initeyeball", a, over);
const think = (e: Enemy, k: BrainCtx, run = 1_000) => eyeball(e, F, run, k);
/** what it did, less the hum `0x43df25` says every frame */
const acts = (heard: string[]) => heard.filter((h) => h !== `say 0x${EYEBALL.hum.toString(16)}`);
const v = (n: number) => n / TICK_SCALE;

describe("the hover ahead of the state (0x43de45)", () => {
  it("halves a sideways drift past fifty a frame (0x43def0)", () => {
    const e = at(EYEBALL.drift, { vx: 80 * TICK_SCALE, clock: 1 });
    think(e, ctx({}).k, 5);
    expect(v(e.vx)).toBe(40);
    const slow = at(EYEBALL.drift, { vx: 30 * TICK_SCALE, clock: 1 });
    think(slow, ctx({}).k, 5);
    expect(v(slow.vx)).toBe(30);
  });
});

describe("the short states", () => {
  it("climbs back up at five once the hit's tail ends, and waits for it before (0x43dff5, 0x43e002)", () => {
    const tail = { ...EYEBALL.hover, kind: 3, tag: 0 };
    const e = at(tail, { clock: 1 });
    think(e, ctx({}).k, 5);
    expect(on(e)).toEqual([3, 0]);
    e.clock = 5;
    think(e, ctx({}).k, 5);
    expect([v(e.vy), ...on(e)]).toEqual([-5, ...is(EYEBALL.hover)]);
  });

  it("answers nothing in a state it has no case for", () => {
    const e = at(EYEBALL.hover, { script: 9 });
    expect(think(e, ctx({}).k)).toBe(false);
    expect(e.script).toBe(9);
  });
});

describe("the hover's decisions, state 4 (0x43e00c)", () => {
  it("goes back to hanging about while he is off his feet (0x43e016)", () => {
    const e = at(EYEBALL.hover);
    think(e, ctx({}, [], { down: true }).k);
    expect(on(e)).toEqual(is(EYEBALL.idle));
  });

  it("turns on its current mirror flag: tag 0 facing east, tag 1 facing west (0x43e055)", () => {
    for (const facing of [1, -1]) {
      const e = at(EYEBALL.hover, { facing });
      think(e, ctx({ forward: -10 }).k);
      expect(on(e)).toEqual(is(facing > 0 ? EYEBALL.turnEast : EYEBALL.turnWest));
    }
  });

  it("at 180…260 halves its drift and, on a 1, will not spit at a helpless man (0x43e0d0)", () => {
    const { k, heard } = ctx({ band: 1 }, [1], { facing: -1, helpless: true });
    const e = at(EYEBALL.hover, { vx: 20 * TICK_SCALE, clock: 1 });
    think(e, k, 5);
    expect(v(e.vx)).toBe(10);
    expect(acts(heard)).toEqual(["roll 2=1"]);
    expect(on(e)).toEqual(is(EYEBALL.hover));
  });

  it("closes on a 2 at 180…260 and on a 1 inside 140, and otherwise hangs (0x43e0ac)", () => {
    const mid = at(EYEBALL.hover);
    think(mid, ctx({ band: 1 }, [2], { facing: -1 }).k);
    expect(on(mid)).toEqual(is(EYEBALL.drift));
    const close = at(EYEBALL.hover);
    think(close, ctx({ band: 3 }, [1]).k);
    expect(on(close)).toEqual(is(EYEBALL.drift));
    const hang = at(EYEBALL.hover, { clock: 5 });
    think(hang, ctx({ band: 3 }, [2]).k, 5);
    expect(on(hang)).toEqual(is(EYEBALL.hover));
  });

  it("does nothing at 140…180 or on a band past the table but re-take the hover as it ends (0x43e08d, 0x43e11b)", () => {
    for (const band of [2, 7]) {
      const e = at(EYEBALL.hover, { clock: 1 });
      think(e, ctx({ band }).k, 5);
      expect([e.clock, ...on(e)]).toEqual([1, ...is(EYEBALL.hover)]);
    }
  });
});

describe("the swoop, state 5 (0x43e13d)", () => {
  it("climbs toward a point 100 above him, drifting his way, and dives once it is there (0x43e151)", () => {
    const climbing = at(EYEBALL.climb, { x: 50, y: 0 });
    think(climbing, ctx({}, [], { x: 0, anchor: 300 }).k);
    expect([v(climbing.vx), v(climbing.vy), ...on(climbing)]).toEqual([-5, -27, ...is(EYEBALL.dive)]);
    const arrived = at(EYEBALL.climb, { x: 0, y: 195 });
    think(arrived, ctx({}, [], { x: 10, anchor: 300 }).k);
    expect([v(arrived.vx), ...on(arrived)]).toEqual([5, ...is(EYEBALL.climb)]);
  });

  it("gives up the dive if he goes down (0x43e1af)", () => {
    const e = at(EYEBALL.dive);
    think(e, ctx({}, [], { down: true }).k);
    expect(on(e)).toEqual(is(EYEBALL.hover));
  });

  it("latches the second character on tag 4, and abandons a dive that has run twenty-one frames (0x43e222, 0x43e240)", () => {
    const { k, heard } = ctx({}, [], { character: 1, anchor: 100 });
    const e = at(EYEBALL.dive, { y: 0, x: 0 });
    think(e, k);
    expect(acts(heard)).toEqual(["say 0x37"]);
    expect(on(e)).toEqual(is(EYEBALL.carryB));
    const stale = at(EYEBALL.dive, { y: -400, clock: 21 });
    think(stale, ctx({}, [], { anchor: 100 }).k);
    expect(on(stale)).toEqual(is(EYEBALL.hover));
    const going = at(EYEBALL.dive, { y: -400, clock: 3 });
    think(going, ctx({}, [], { anchor: 100 }).k);
    expect(on(going)).toEqual(is(EYEBALL.dive));
  });

  it("carries the second character off with 0x4d, turning away from his facing, and shakes him on tag 5 (0x43e3af)", () => {
    const { k, heard } = ctx({}, [], { facing: 1 });
    const e = at(EYEBALL.carryB, { x: 10, y: 20, clock: 1 });
    think(e, k, 4);
    expect(acts(heard)).toEqual(["pose -1", "hide true", "say 0x4d", 'pin 10,140 {"vy":-10}']);
    expect(e.facing).toBe(-1);
    e.clock = 4;
    think(e, ctx({}, [], { facing: 1 }).k, 4);
    expect([e.beat, ...on(e)]).toEqual([0, ...is(EYEBALL.shakeB)]);
    // the first character's carry, facing away already, keeps its facing
    const a = at(EYEBALL.carryA, { clock: 4 });
    const s = ctx({}, [], { facing: -1 });
    think(a, s.k, 4);
    expect(acts(s.heard)).toContain("say 0x4c");
    expect([a.facing, ...on(a)]).toEqual([1, ...is(EYEBALL.shakeA)]);
  });

  it("counts every frame he turns its way in the shake, and drops him on the fifth (0x43e32d, 0x43e371)", () => {
    const e = at(EYEBALL.shakeA, { beat: 0, facing: 1 });
    for (let turns = 1; turns <= 4; turns++) {
      // he turns to face its way each frame; it turns from him
      think(e, ctx({}, [], { facing: e.facing }).k);
      expect([e.beat, ...on(e)]).toEqual([turns, ...is(EYEBALL.shakeA)]);
    }
    const s = ctx({}, [], { facing: e.facing, x: 7, anchor: 8 });
    think(e, s.k);
    expect(acts(s.heard).slice(-3)).toEqual(["pose 2", 'pin 7,8 {"fell":0}', "hide false"]);
    expect(on(e)).toEqual(is(EYEBALL.drift));
    // a frame he does not turn is not counted
    const still = at(EYEBALL.shakeB, { beat: 2, facing: 1 });
    think(still, ctx({}, [], { facing: -1 }).k);
    expect([still.beat, still.facing]).toEqual([2, 1]);
  });

  it("falls out of a tag past the table's six", () => {
    const e = at(EYEBALL.climb, { tag: 6 });
    expect(think(e, ctx({}).k)).toBe(false);
    expect(e.tag).toBe(6);
  });
});

describe("the ladder hunt, state 6 (0x43e503)", () => {
  const rung = { x: 300, y: 100, top: -200, bottom: 400 };

  it("drifts on in phase 1 on a level with no ladder, and keeps one it finds (0x43e542, 0x43e550)", () => {
    const none = at(EYEBALL.hunt, { side: 1 });
    think(none, ctx({}).k);
    expect(none.side).toBe(1);
    const s = ctx({});
    s.k.ladderNear = () => rung;
    const found = at(EYEBALL.hunt, { side: 1 });
    think(found, s.k);
    expect([found.side, found.ladder]).toEqual([2, rung]);
  });

  it("does nothing in a phase past the three but re-take its tag as the script ends (0x43e696)", () => {
    const e = at(EYEBALL.climbDown, { side: 0, clock: 4 });
    think(e, ctx({}).k, 4);
    expect([e.side, ...on(e)]).toEqual([0, ...is(EYEBALL.climbDown)]);
    const hunt = at(EYEBALL.hunt, { side: 7, clock: 4 });
    think(hunt, ctx({}).k, 4);
    expect(on(hunt)).toEqual(is(EYEBALL.hunt));
  });

  it("halves a climb faster than ten a frame (0x43e696)", () => {
    const e = at(EYEBALL.hunt, { side: 0, vy: 0, y: 0, clock: 1 });
    think(e, ctx({}, [], { anchor: 500 }).k, 4);
    // the hover sends it down at seven, which is inside the cap
    expect(v(e.vy)).toBe(7);
    const fast = at(EYEBALL.hunt, { side: 0, vy: 30 * TICK_SCALE, y: 0, clock: 1 });
    think(fast, ctx({}, [], { anchor: 0 }).k, 4);
    // the spring takes two off (30 is past its five, so it pushes up) and the cap halves the 28
    expect(v(fast.vy)).toBe(14);
  });

  it("in phase 3 climbs down while above both his mark and the ladder's bottom, and up when below (0x43e5e3)", () => {
    const e = at(EYEBALL.climbUp, { side: 3, ladder: rung, y: 0, clock: 3 });
    // he is 400 below: aim 300 is below it, so down — keeping the frame
    think(e, ctx({}, [], { anchor: 400, climbing: true }).k, 12);
    expect([e.clock, ...on(e)]).toEqual([3, ...is(EYEBALL.climbDown)]);
    const up = at(EYEBALL.climbDown, { side: 3, ladder: rung, y: 300 });
    think(up, ctx({}, [], { anchor: 0, climbing: true }).k, 12);
    expect(on(up)).toEqual(is(EYEBALL.climbUp));
    // between the two it keeps the tag it has
    const keep = at(EYEBALL.climbUp, { side: 3, ladder: rung, y: 200 });
    think(keep, ctx({}, [], { anchor: 300, climbing: true }).k, 12);
    expect(on(keep)).toEqual(is(EYEBALL.climbUp));
  });
});

describe("the death (0x43e716)", () => {
  it("halves its speed through tag 0, then bursts once with 0x3b and four gibs (0x43e72c, 0x43e750, 0x43e768)", () => {
    const death = F.death!;
    const e = at(death, { state: "dead", clock: 5, vx: 40 * TICK_SCALE, hp: 0 });
    const early = ctx({});
    eyeballReacts(e, F, 0, early.k);
    expect(v(e.vx)).toBe(20);
    expect(early.heard).toEqual([]);
    e.clock = 12;
    const pop = ctx({});
    eyeballReacts(e, F, 0, pop.k);
    expect(pop.heard).toEqual(["say 0x3b lead", "spray 50", "spray 50", "spray 50", "spray 50"]);
    e.clock = 13;
    const after = ctx({});
    eyeballReacts(e, F, 0, after.k);
    expect([v(e.vx), after.heard]).toEqual([10, []]);
  });

  it("is only dragged by the hover while it dies on any other script", () => {
    const s = ctx({});
    const e = at(EYEBALL.hover, { state: "dead", clock: 30 });
    eyeballReacts(e, F, 0, s.k);
    expect(s.heard).toEqual([]);
  });
});
