/**
 * Small rules from `SC.EXE` that the playthroughs leave half-taken, each in
 * its own module: the cheat accumulator's ring (`0x403ed0`), the high-score
 * table's insert and its stored rows (`0x40f210`), a crow set alight while it
 * already falls, and the lift's winch cel.
 *
 *   npx vitest run skullcracker/tests/pieces.ts
 *
 * No rip.
 */
import { afterEach, describe, expect, it } from "vitest";
import { CHEAT_RING, CheatTyper } from "../src/cheats";
import { emptyBoards, loadBoards, offerScore } from "../src/scores";
import { burnCrow, ELEVATOR, elevatorCel, type Crow, type Elevator } from "../src/props";

afterEach(() => {
  delete (globalThis as { localStorage?: unknown }).localStorage;
});

describe("the cheat accumulator (0x403ed0)", () => {
  it("empties itself at nineteen letters, so a word typed straight after a long run of others still counts", () => {
    const t = new CheatTyper();
    let at = 0;
    for (let i = 0; i < CHEAT_RING; i++) expect(t.press("q", (at += 10))).toBeNull();
    expect([t.press("z", (at += 10)), t.press("i", (at += 10))]).toEqual([null, null]);
    expect(t.press("p", at + 10)?.word).toBe("zip");
  });
});

describe("the high-score tables (0x40f210)", () => {
  it("inserts a score with an empty name when none is given", () => {
    const boards = emptyBoards();
    expect(offerScore(boards, 0, 500, 3, () => null)).toBe(0);
    expect(boards["0"][0]).toEqual({ name: "", score: 500, level: 3 });
  });

  it("reads a stored row with no name as an empty one", () => {
    const map = new Map([["skullcracker.scores", JSON.stringify({ "0": [{ score: 70, level: 2 }] })]]);
    (globalThis as { localStorage?: unknown }).localStorage = { getItem: (k: string) => map.get(k) ?? null };
    expect(loadBoards()["0"][0]).toEqual({ name: "", score: 70, level: 2 });
  });
});

describe("a crow set alight (burnCrow)", () => {
  it("starts the fall from its first cel, but leaves a crow already falling where it is in it", () => {
    const crow = { state: "fly", clock: 9, tag: 2 } as unknown as Crow;
    burnCrow(crow);
    expect([crow.state, crow.clock, crow.tag]).toEqual(["fall", 0, 0]);
    crow.clock = 5;
    crow.tag = 1;
    burnCrow(crow);
    expect([crow.clock, crow.tag]).toEqual([5, 1]);
  });
});

describe("the lift's winch (elevatorCel)", () => {
  const lift = (state: Elevator["state"], dir: 1 | -1, clock: number) => ({ state, dir, clock }) as Elevator;
  it("winds up on tag 3 going up and tag 1 going down, each holding its last cel (0x477db0)", () => {
    const end = 99 * ELEVATOR.starting.hold;
    expect(elevatorCel(lift("starting", -1, end))).toBe(ELEVATOR.startingUp.cels.at(-1));
    expect(elevatorCel(lift("starting", 1, end))).toBe(ELEVATOR.starting.cels.at(-1));
  });

  it("cycles the travelling cels", () => {
    const h = ELEVATOR.down.hold;
    expect([0, 1, 2, 3].map((i) => elevatorCel(lift("down", 1, i * h)))).toEqual([...ELEVATOR.down.cels, ELEVATOR.down.cels[0]]);
  });
});
