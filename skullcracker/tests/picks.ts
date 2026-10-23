/**
 * The hit handlers' picks in `src/foes.ts` — which reaction a blow is
 * answered with, by class — for the classes whose rules the machine suites
 * leave half-taken: the eyeball's flinch by the angle it is showing, the ox's
 * coin for the slide, the Coke machine's three bands, `initwerec`'s height
 * test, the skeleton's blow in the back and the TCop's one switch run.
 *
 *   npx vitest run skullcracker/tests/picks.ts
 *
 * Each pick is called the way the page calls it — the blow and the struck
 * thing's state — and the answer is checked against the address its comment
 * in `src/foes.ts` reads it from.
 *
 * No rip: the picks read nothing off the disc.
 */
import { describe, expect, it } from "vitest";
import type { Blow, FoeState } from "../src/brains/foe";
import { EYEBALL } from "../src/brains/eyeball";
import { FOES } from "../src/foes";
import { roll, seedRandom } from "../src/random";

const blow = (over: Partial<Blow> = {}): Blow => ({ damage: 10, hits: 1, dy: 0, facingAway: false, ...over });
/** the pick on the struck thing's own state, which some picks write back to */
const pick = (kind: string, b: Blow, e: Partial<FoeState> & Record<string, unknown>) =>
  FOES[kind].pick!(b, Object.assign(e, { max: e.max ?? 100 }) as FoeState);

describe("initeyeball (0x43e9d4)", () => {
  it("shuts the eye from the angle of the cel it is showing: looping, or held at the end of a swing", () => {
    // the drift's cels, looped: its second cel is 6207, the second angle
    expect(pick("initeyeball", blow(), { anim: EYEBALL.hover, clock: 0 })).toBe(
      [6206, 6207, 6208].indexOf(EYEBALL.hover.cels[0]),
    );
    const swing = { cels: [6206, 6208], hold: 2, from: "test" };
    expect(pick("initeyeball", blow(), { anim: swing, clock: 99, swing: true })).toBe(2);
    expect(pick("initeyeball", blow(), { anim: swing, clock: 0, swing: true })).toBe(0);
  });

  it("answers -1 — no reaction — with no animation to read", () => {
    expect(pick("initeyeball", blow(), {})).toBe(-1);
  });
});

describe("initox (0x43fa80)", () => {
  it("answers a 1 on 0x434540(3) with the slide, and anything else with one of the three attacks", () => {
    seedRandom();
    const seen = new Set<number>();
    for (let i = 0; i < 200; i++) seen.add(pick("initox", blow(), {}));
    expect([...seen].sort()).toEqual([0, 1, 2, 3]);
  });
});

describe("initcoke (0x43b6ab)", () => {
  it("bursts at 75 or more, rocks lightly under 30, and shows the empty machine on a middle blow once the fourth can is gone", () => {
    expect(pick("initcoke", blow({ damage: 75 }), {})).toBe(3);
    expect(pick("initcoke", blow({ damage: 29 }), {})).toBe(0);
    expect(pick("initcoke", blow({ damage: 50 }), { shaken: 3 })).toBe(1);
    expect(pick("initcoke", blow({ damage: 50 }), { shaken: 4 })).toBe(2);
  });
});

describe("initwerec (0x452a87)", () => {
  it("takes a blow from over fifty below on tag 0, a 30…50 one from in front on tag 2, and the rest on tag 1", () => {
    expect(pick("initwerec", blow({ dy: 51 }), {})).toBe(0);
    expect(pick("initwerec", blow({ dy: 40 }), {})).toBe(2);
    expect(pick("initwerec", blow({ dy: 40, facingAway: true }), {})).toBe(1);
    expect(pick("initwerec", blow({ dy: 10 }), {})).toBe(1);
  });
});

describe("initskel (0x423a30)", () => {
  it("knocks down at 0x3c, takes a blow from the front on tag 0, and one in the back on 1 or 2 at twenty more off (0x423b9a)", () => {
    expect(pick("initskel", blow({ damage: 0x3c }), { hp: 100 })).toBe(3);
    // facing east, the contact east of its point is in front
    const front = { hp: 100, facing: 1 };
    expect(pick("initskel", blow({ contactX: 120, pointX: 100 }), front)).toBe(0);
    expect(front.hp).toBe(100);
    // facing west, the contact east of its point is behind
    const back = { hp: 100, facing: -1 };
    expect([1, 2]).toContain(pick("initskel", blow({ contactX: 120, pointX: 100 }), back));
    expect(back.hp).toBe(80);
    // facing east, west of its point is behind too; no health word, nothing taken
    const bare: Record<string, unknown> = { facing: 1 };
    expect([1, 2]).toContain(pick("initskel", blow({ contactX: 80, pointX: 100 }), bare));
    expect(bare.hp).toBeUndefined();
    // `0x434540(2)` picks the tag, so both come up
    seedRandom();
    const tags = new Set<number>();
    for (let i = 0; i < 40; i++) tags.add(pick("initskel", blow({ contactX: 80, pointX: 100 }), { facing: 1 }));
    expect([...tags].sort()).toEqual([1, 2]);
  });
});

describe("initcop (0x414933)", () => {
  it("answers the first blow that leaves it under half with the switch run, once, and the flinch ever after (0x414971)", () => {
    const e: Record<string, unknown> = { hp: 40, max: 100 };
    expect(pick("initcop", blow(), e)).toBe(1);
    expect(e.switchRun).toBe(1);
    expect(pick("initcop", blow(), e)).toBe(0);
    expect(pick("initcop", blow(), { hp: 60, max: 100 })).toBe(0);
  });
});

describe("the dice (0x434540)", () => {
  it("answer 0 for a count of nothing, and 1…n otherwise", () => {
    seedRandom();
    expect([roll(0), roll(-3)]).toEqual([0, 0]);
    for (let i = 0; i < 50; i++) expect(roll(3)).toBeGreaterThanOrEqual(1);
  });
});
