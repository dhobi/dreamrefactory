/**
 * `initkragg`, level eight's boss — its think `0x440ab0` in both forms, the
 * thrash and the death (`kraggReacts`), each state taken on purpose against a
 * stand-in context.
 *
 *   npx vitest run skullcracker/tests/kragg.ts
 *
 * `tests/machine/arcade.ts` fights it in its room, where the dice and the
 * player's position decide which states run. The maul's blow, the dive's grab
 * and carry, both volleys to their end, the roar on the ground turn and the
 * fall's landing are taken here with the dice and the player in the test's
 * hands, each against the address `src/brains/kragg.ts` read it from.
 *
 * No rip: the brain reads nothing off the disc.
 */
import { afterEach, describe, expect, it } from "vitest";
import { TICK_SCALE, type BrainCtx, type CastKit, type Enemy } from "../src/brains/kit";
import { kragg, KRAGG, KRAGG_SHOT_AIR, KRAGG_SHOT_GROUND, kraggReacts, seedKraggFall } from "../src/brains/kragg";
import { FOES } from "../src/foes";
import { ctx, inState, is, on } from "./stand/brainctx";

const F = FOES.initkragg;
const at = (a: Parameters<typeof inState>[1], over: Partial<Enemy> = {}) => inState("initkragg", a, over);
const think = (e: Enemy, k: BrainCtx, run = 1_000) => kragg(e, F, run, k);
/** full health on easy: `0x40e300(0x3e8)` with the stand-in's `scaled` as the identity */
const FULL = 0x3e8;

/** a context that names which shot was fired */
function shooter(track: Parameters<typeof ctx>[0], rolls: number[] = [], player = {}) {
  const s = ctx(track, rolls, player);
  s.k.cast = (_e: Enemy, kit: CastKit) =>
    void s.heard.push(new Map([[KRAGG_SHOT_AIR, "shot air"], [KRAGG_SHOT_GROUND, "shot ground"]]).get(kit) ?? "shot ?");
  return s;
}

afterEach(() => seedKraggFall());

describe("the prologue (0x440ab0)", () => {
  it("is weightless in the air, and in the fall's steered tag 0 only (0x441c6d, 0x4416e6)", () => {
    const fall = at(F.rallies!.fall, { clock: 0 });
    think(fall, ctx({}).k, 4);
    expect(fall.weightless).toBe(true);
    const landing = at(KRAGG.fallLand, { clock: 0 });
    think(landing, ctx({}).k, 4);
    expect(landing.weightless).toBe(false);
  });

  it("pins the ground form to the x the landing wrote, and leaves it where it is with none (0x440b31)", () => {
    const pinned = at(KRAGG.stand, { x: 500, home: 900, vx: 30 });
    think(pinned, ctx({ band: 0 }).k);
    expect([pinned.x, pinned.vx, pinned.floor, pinned.shove]).toEqual([900, 0, -15, 100]);
    const loose = at(KRAGG.stand, { x: 500, vx: 30 });
    think(loose, ctx({ band: 0 }).k);
    expect([loose.x, loose.vx]).toEqual([500, 0]);
  });

  it("answers nothing in a state the class has no case for", () => {
    const e = at(KRAGG.idle, { script: 4, tag: 0 });
    expect(think(e, ctx({}).k)).toBe(false);
    expect(e.script).toBe(4);
  });
});

describe("the air form", () => {
  it("turns, by the way it faces, when he is behind it (0x440db6)", () => {
    for (const facing of [1, -1]) {
      const e = at(KRAGG.idle, { facing });
      think(e, ctx({ forward: -50, band: -1 }).k);
      expect(on(e)).toEqual(is(KRAGG.turn[facing < 0 ? 1 : 0]));
    }
  });

  it("stops closing once the drift is gone, and idles (0x440f4a)", () => {
    const drifting = at(KRAGG.halt, { vx: 3 * TICK_SCALE });
    think(drifting, ctx({}).k);
    expect(on(drifting)).toEqual(is(KRAGG.halt));
    const still = at(KRAGG.halt, { vx: 0 });
    think(still, ctx({}).k);
    expect(on(still)).toEqual(is(KRAGG.idle));
  });

  it("halves its speed while the maul lands and goes back to homing as it ends (0x441043)", () => {
    const e = at(KRAGG.maul, { clock: 1, vx: 20 * TICK_SCALE });
    think(e, ctx({}).k, 5);
    expect(e.vx / TICK_SCALE).toBe(10);
    expect(on(e)).toEqual(is(KRAGG.maul));
    e.clock = 5;
    think(e, ctx({}).k, 5);
    expect(on(e)).toEqual(is(KRAGG.maulIn));
  });

  it("idles after the tag 2 nothing installs (0x44107e)", () => {
    const e = at(KRAGG.maulEnd, { clock: 1 });
    think(e, ctx({}).k, 5);
    expect(on(e)).toEqual(is(KRAGG.maulEnd));
    e.clock = 5;
    think(e, ctx({}).k, 5);
    expect(on(e)).toEqual(is(KRAGG.idle));
  });

  it("breaks the volley's wind-up off to turn, westward too (0x4410bf)", () => {
    for (const facing of [1, -1]) {
      const e = at(KRAGG.spit[0], { facing, clock: 1 });
      think(e, ctx({ forward: -20 }).k, 5);
      expect(on(e)).toEqual(is(KRAGG.turn[facing < 0 ? 1 : 0]));
    }
    // ...a later tag does not
    const later = at(KRAGG.spit[1], { clock: 1 });
    think(later, ctx({ forward: -20 }).k, 5);
    expect(on(later)).toEqual(is(KRAGG.spit[1]));
  });

  it("fires three air shots with the cry and decides on tag 3: dives under half, mauls at half or over (0x441128, 0x441185)", () => {
    const e = at(KRAGG.spit[0], { clock: 5 });
    const shots: string[] = [];
    for (let tag = 0; tag < 3; tag++) {
      const s = shooter({});
      e.clock = 5;
      think(e, s.k, 5);
      shots.push(...s.heard);
      expect(on(e)).toEqual(is(KRAGG.spit[tag + 1]));
    }
    expect(shots).toEqual(["say 0x15", "shot air", "say 0x15", "shot air", "say 0x15", "shot air"]);
    const weak = at(KRAGG.spit[3], { clock: 5, hp: FULL / 2 - 1 });
    think(weak, ctx({}).k, 5);
    expect(on(weak)).toEqual(is(KRAGG.dive));
    const strong = at(KRAGG.spit[3], { clock: 5, hp: FULL / 2 });
    think(strong, ctx({}).k, 5);
    expect(on(strong)).toEqual(is(KRAGG.maulIn));
  });

  it("abandons the dive when he gets behind it (0x441274)", () => {
    const e = at(KRAGG.dive, { clock: 1 });
    think(e, ctx({ forward: -10, band: 3 }).k, 5);
    expect(on(e)).toEqual(is(KRAGG.idle));
  });

  it("closes in at a quarter speed and grabs as the dive ends: tag 3 for the first character, 2 for the second (0x4412c5, 0x441306)", () => {
    const closing = at(KRAGG.dive, { clock: 1, vx: 40 * TICK_SCALE });
    think(closing, ctx({ band: 3, dy: 30 }).k, 5);
    expect(closing.vx / TICK_SCALE).toBe(10);
    expect(on(closing)).toEqual(is(KRAGG.dive));
    for (const character of [0, 1] as const) {
      const s = ctx({ band: 3, dy: -40 }, [], { character });
      const e = at(KRAGG.dive, { clock: 5, vy: 9 });
      think(e, s.k, 5);
      expect(s.heard).toEqual(["say 0x16"]);
      expect([...on(e), e.swing]).toEqual([...is(KRAGG.carry[character === 1 ? 0 : 1]), true]);
    }
  });

  it("keeps homing out of range, and pulls up as the dive ends (0x44134a)", () => {
    const e = at(KRAGG.dive, { clock: 1 });
    think(e, ctx({ band: 3, dy: 100 }).k, 5);
    expect(on(e)).toEqual(is(KRAGG.dive));
    e.clock = 5;
    think(e, ctx({ band: 2 }).k, 5);
    expect(on(e)).toEqual(is(KRAGG.divePull));
  });

  it("carries him: drains ten, holds him at its side, turns to face away from him, and throws him down at the end (0x4413a8)", () => {
    const s = ctx({}, [], { facing: -1, x: 77, anchor: 33 });
    const e = at(KRAGG.carry[1], { clock: 1, facing: -1, x: 100, y: 50, hp: 500 });
    think(e, s.k, 5);
    expect(s.heard).toEqual(["hide true", "drain 10", 'pin 50,50 {"vx":0,"vy":0}', "bleed -1"]);
    expect([e.facing, e.hp, e.floor]).toEqual([1, 510, -150]);
    const end = ctx({}, [], { facing: 1, x: 77, anchor: 33 });
    e.clock = 5;
    think(e, end.k, 5);
    expect(end.heard).toEqual([
      "hide true", "drain 10", 'pin 150,50 {"vx":0,"vy":0}', "bleed -1",
      'pin 77,33 {"vx":-10,"vy":0}', "hide false", "pose 2",
    ]);
    expect(e.facing).toBe(-1);
    expect(on(e)).toEqual(is(KRAGG.idle));
    // ...and dropped the other way when it ends facing east
    const east = at(KRAGG.carry[0], { clock: 5, facing: 1, x: 100, y: 50 });
    const drop = ctx({}, [], { facing: -1, x: 77, anchor: 33 });
    think(east, drop.k, 5);
    expect(drop.heard).toContain('pin 77,33 {"vx":10,"vy":0}');
  });
});

describe("the ground form", () => {
  it("rises into the ground stand, and the swings hand back to it (0x4417a8, 0x4419d9)", () => {
    for (const a of [KRAGG.rise, KRAGG.jab, KRAGG.swing]) {
      const e = at(a, { clock: 1 });
      think(e, ctx({}).k, 5);
      expect(on(e)).toEqual(is(a));
      e.clock = 5;
      think(e, ctx({}).k, 5);
      expect(on(e)).toEqual(is(KRAGG.stand));
    }
  });

  it("turns from the stand westward too (0x4417cd)", () => {
    const e = at(KRAGG.stand, { facing: -1 });
    think(e, ctx({ forward: -5 }).k);
    expect(on(e)).toEqual(is(KRAGG.groundTurn[1]));
  });

  it("roars three in ten on tag 1's third cel of the turn, on the lead channel, and flips as it ends (0x44189e, 0x4418b6)", () => {
    const a = KRAGG.groundTurn[1];
    const roar = ctx({}, [0x1d, 2]);
    const e = at(a, { clock: 2 * a.hold });
    think(e, roar.k, 100);
    expect(roar.heard).toEqual(["roll 100=29", "roll 2=2", "say 0x1d lead"]);
    const quiet = ctx({}, [0x1e]);
    think(at(a, { clock: 2 * a.hold }), quiet.k, 100);
    expect(quiet.heard).toEqual(["roll 100=30"]);
    // ...no roll on any other cel, nor on tag 0
    const other = ctx({});
    think(at(a, { clock: 0 }), other.k, 100);
    think(at(KRAGG.groundTurn[0], { clock: 2 * KRAGG.groundTurn[0].hold }), other.k, 100);
    expect(other.heard).toEqual([]);
    const ends = at(a, { clock: 12 });
    think(ends, ctx({}).k, 12);
    expect([ends.facing, ...on(ends)]).toEqual([-1, ...is(KRAGG.stand)]);
  });

  it("fires the ground volley with the cry and ends it in the swing; the wind-up alone turns (0x4418f0, 0x441957, 0x4419c4)", () => {
    for (const facing of [1, -1]) {
      const e = at(KRAGG.lob[0], { facing, clock: 1 });
      think(e, ctx({ forward: -20 }).k, 5);
      expect(on(e)).toEqual(is(KRAGG.groundTurn[facing < 0 ? 1 : 0]));
    }
    const e = at(KRAGG.lob[0], { clock: 1 });
    think(e, ctx({}).k, 5);
    expect(on(e)).toEqual(is(KRAGG.lob[0]));
    const shots: string[] = [];
    for (let tag = 0; tag < 3; tag++) {
      const s = shooter({});
      e.clock = 5;
      think(e, s.k, 5);
      shots.push(...s.heard);
      expect(on(e)).toEqual(is(KRAGG.lob[tag + 1]));
    }
    expect(shots).toEqual(["say 0x15", "shot ground", "say 0x15", "shot ground", "say 0x15", "shot ground"]);
    e.clock = 5;
    think(e, ctx({}).k, 5);
    expect([...on(e), e.swing]).toEqual([...is(KRAGG.swing), true]);
  });
});

describe("the fall, state 10 (0x441615)", () => {
  it("is steered toward its home while tag 0 plays, and does nothing on tag 1", () => {
    const e = at(F.rallies!.fall, { clock: 1, x: 0, home: 300 });
    think(e, ctx({ dy: 0 }).k, 4);
    expect(e.vx).toBeGreaterThan(0);
    const landing = at(KRAGG.fallLand, { clock: 9 });
    expect(think(landing, ctx({}).k, 4)).toBe(false);
    expect(on(landing)).toEqual(is(KRAGG.fallLand));
  });

  it("with no home to steer for holds its x, thuds at each lap's end and lands after the fifth (0x441668)", () => {
    seedKraggFall(0);
    const e = at(F.rallies!.fall, { clock: 4, x: 50 });
    const first = ctx({});
    think(e, first.k, 4);
    expect(first.heard).toEqual(["say 0x14"]);
    expect([e.clock, ...on(e)]).toEqual([0, ...is(F.rallies!.fall)]);
    e.clock = 4;
    think(e, ctx({}).k, 4);
    expect([...on(e), e.swing]).toEqual([...is(KRAGG.fallLand), true]);
  });
});

describe("the thrash and the death (kraggReacts)", () => {
  it("lets the roaches out from 20 behind and 25 up, either way it faces (0x441a42, 0x441a65)", () => {
    for (const [facing, x] of [[1, 80], [-1, 120]] as const) {
      const s = ctx({});
      const e = at(F.death!, { state: "dead", facing, x: 100, y: 200, clock: 8 * F.death!.hold });
      kraggReacts(e, F, 0, s.k);
      expect(s.heard).toEqual(["say 0x1b lead", `spill 15 at ${x},175`]);
      expect([e.floor, e.threw]).toEqual([-25, true]);
    }
  });

  it("is dragged toward 120 below the nearest sprinkler while it thrashes, held to ±40, and raises one after five cels (0x44154c, 0x4415a9)", () => {
    const thrash = F.burns!.anim!;
    const s = ctx({});
    s.k.sprinkler = () => ({ x: 60, y: -100 });
    const e = at(thrash, { x: 0, y: 0, vx: 0, vy: 0, clock: 0 });
    kraggReacts(e, F, 0, s.k);
    // `0x42f8b0` through the divisor of fifty, rounded away from zero: 60 and 20 are 2 and 1
    expect([e.vx / TICK_SCALE, e.vy / TICK_SCALE]).toEqual([2, 1]);
    expect(s.heard).toEqual([]);
    // with no sprinkler on the level only the cap runs, and the raise is the clock's
    const none = ctx({});
    const f = at(thrash, { vx: 60 * TICK_SCALE, clock: 5 * thrash.hold });
    kraggReacts(f, F, 0, none.k);
    expect(f.vx / TICK_SCALE).toBe(40);
    expect(none.heard).toEqual(["raise"]);
  });
});
