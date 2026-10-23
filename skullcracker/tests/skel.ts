/**
 * `initskel`, the graveyard's skeleton — its think `0x4234e0` against a
 * stand-in context, the grab and the throw above all.
 *
 *   npx vitest run skullcracker/tests/skel.ts
 *
 * `tests/machine/grave.ts` meets skeletons in the graveyard, where the dice
 * and the player decide which branches run. The walk's end at its bound, the
 * grab of the second character and the throw to the west, the bone's
 * follow-through, and the take's spring are taken here on purpose, each
 * against the address in `src/brains/skel.ts` it was read from.
 *
 * No rip: the brain reads nothing off the disc.
 */
import { describe, expect, it } from "vitest";
import type { BrainCtx, Enemy } from "../src/brains/kit";
import { skel, SKEL, skelReacts } from "../src/brains/skel";
import { FOES } from "../src/foes";
import { ctx, inState, is, on } from "./stand/brainctx";

const F = FOES.initskel;
const at = (a: Parameters<typeof inState>[1], over: Partial<Enemy> = {}) => inState("initskel", a, over);
const think = (e: Enemy, k: BrainCtx, run = 1_000) => skel(e, F, run, k);

describe("the statue and the walk (0x423546, 0x42357d)", () => {
  it("stands until the player is in its rect", () => {
    const e = at(SKEL.wait, { fighting: false });
    think(e, ctx({}).k);
    expect(on(e)).toEqual(is(SKEL.wait));
  });

  it("as the walk ends turns to face him and lunges at its bound, else walks on (0x4235b3)", () => {
    const s = ctx({ forward: -1 });
    s.k.atBound = () => true;
    const e = at(SKEL.walk, { clock: 6 });
    think(e, s.k, 6);
    // the turn is asked twice: at the top of the state and again at the end
    expect([e.facing, ...on(e), e.swing]).toEqual([1, ...is(SKEL.lunge), true]);
    const on2 = at(SKEL.walk, { clock: 6 });
    think(on2, ctx({}).k, 6);
    expect([on2.clock, ...on(on2)]).toEqual([6, ...is(SKEL.walk)]);
  });
});

describe("the reach, the grab and the throw (0x4236b1, 0x423756)", () => {
  it("grabs the second character on tag 1 (0x423701)", () => {
    const { k, heard } = ctx({ band: 3 }, [], { character: 1 });
    const e = at(SKEL.reach, { clock: 5 });
    think(e, k, 5);
    expect(heard).toEqual(["hide true"]);
    expect(on(e)).toEqual(is(SKEL.grabAlt));
  });

  it("holds him fifty-one in front of it facing west, and throws him a hundred west as the grab ends (0x4237d3)", () => {
    const { k, heard } = ctx({}, [], { x: 500, anchor: 200 });
    const e = at(SKEL.grab, { facing: -1, x: 100, y: 300, clock: 0 });
    think(e, k, 8);
    expect(heard).toEqual(['pin 49,262 {"facing":1}', "drain 5"]);
    const end = ctx({}, [], { x: 500, anchor: 200 });
    e.clock = 8;
    think(e, end.k, 8);
    expect(end.heard.slice(-3)).toEqual(["pin 400,170", "hide false", "pose 2"]);
    expect(on(e)).toEqual(is(SKEL.walk));
    // ...and facing east, east of it and thrown east
    const east = at(SKEL.grab, { facing: 1, x: 100, y: 300, clock: 8 });
    const s = ctx({}, [], { x: 500, anchor: 200 });
    think(east, s.k, 8);
    expect([s.heard[0], s.heard.at(-3)]).toEqual(['pin 151,262 {"facing":-1}', "pin 600,170"]);
  });
});

describe("the bone, state 4 (0x423822)", () => {
  it("waits out the wind-up, walks after the follow-through, and drops a third tag (0x4238bf, 0x423833)", () => {
    const wind = at(SKEL.wind, { clock: 1 });
    think(wind, ctx({}).k, 6);
    expect(on(wind)).toEqual(is(SKEL.wind));
    const sling = at(SKEL.sling, { clock: 6 });
    think(sling, ctx({}).k, 6);
    expect(on(sling)).toEqual(is(SKEL.walk));
    const odd = at(SKEL.wind, { tag: 2, clock: 6 });
    expect(think(odd, ctx({}).k, 6)).toBe(false);
    expect(odd.tag).toBe(2);
  });
});

describe("the take's end, state 7 (0x423965)", () => {
  it("springs away three times in five, else walks", () => {
    const end = { ...SKEL.walk, kind: 7 };
    const spring = at(end);
    think(spring, ctx({}, [3]).k);
    expect([...on(spring), spring.swing]).toEqual([...is(SKEL.leap), true]);
    const walk = at(end);
    think(walk, ctx({}, [4]).k);
    expect(on(walk)).toEqual(is(SKEL.walk));
  });

  it("answers nothing in the page's states 6 and 8", () => {
    for (const script of [6, 8]) {
      const e = at(SKEL.walk, { script });
      expect(think(e, ctx({}).k)).toBe(false);
    }
  });
});

describe("its reactions (skelReacts)", () => {
  it("groans only on the death's third cel (0x4239b5)", () => {
    const death = F.death!;
    const heard: string[] = [];
    for (let clock = 0; clock < 4 * death.hold; clock++) {
      const s = ctx({});
      skelReacts(at(death, { state: "dead", clock }), F, 99, s.k);
      heard.push(...s.heard);
    }
    expect(heard).toEqual(Array(death.hold).fill("say 0x15"));
  });
});
