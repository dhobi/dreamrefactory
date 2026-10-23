/**
 * Free roam's door table (`src/freeroam/doors.ts`) where `freeroam.ts` does not
 * go: every comparison a door's guard can make, a hotspot found on the other
 * disc, and the presses it leaves alone.
 *
 *   npx vitest run taoot/tests/auto/freeroam-doors.ts
 *
 * The guards are the scripts' own `if` lines, read out of the rip into
 * doors.gen.ts, and a guard is compared the way the script's interpreter
 * compares — strings without case, an ordering only between numbers, and
 * anything that is not a number never ordered at all. A hotspot that is in the
 * table for one disc only is the same hotspot on the other, since the two discs
 * share every corridor. And a press free roam should leave alone is left alone
 * with the reason: not a door, no door on this side of the ship, nothing to step
 * through.
 */
import { expect, test } from "vitest";
import type { DoorCond } from "../../src/freeroam/doors.gen";
import { doorSpot, openIfRefused, satisfiable, stepIfRefused, type DoorSession } from "../../src/freeroam/doors";

const globals = (g: Record<string, unknown>) => ({ get: (n: string) => g[n] ?? 0 });
const holds = (c: DoorCond, g: Record<string, unknown>): boolean => satisfiable([[c]], globals(g));

test("an ordering holds between numbers, whichever side is written as text", () => {
  expect(holds({ var: "mission", op: "<=", value: 4 }, { mission: 4 })).toBe(true);
  expect(holds({ var: "mission", op: "<=", value: 4 }, { mission: 5 })).toBe(false);
  expect(holds({ var: "mission", op: ">", value: 3 }, { mission: 4 })).toBe(true);
  expect(holds({ var: "mission", op: ">", value: 4 }, { mission: 4 })).toBe(false);
  // a global holding "4" is the number 4 to an ordering
  expect(holds({ var: "mission", op: "<", value: 5 }, { mission: "4" })).toBe(true);
  expect(holds({ var: "mission", op: ">=", value: "4" }, { mission: 4 })).toBe(true);
});

test("an ordering against anything that is not a number does not hold, either way round", () => {
  expect(holds({ var: "hallside", op: "<", value: 4 }, { hallside: "port" })).toBe(false);
  expect(holds({ var: "hallside", op: ">=", value: 4 }, { hallside: "port" })).toBe(false);
  expect(holds({ var: "mission", op: ">", value: "port" }, { mission: 4 })).toBe(false);
});

test("text equals text without case, and a boolean only a boolean", () => {
  expect(holds({ var: "hallside", op: "=", value: "PORT" }, { hallside: "port" })).toBe(true);
  expect(holds({ var: "hallside", op: "!=", value: "Port" }, { hallside: "port" })).toBe(false);
  expect(holds({ var: "tour", op: "=", value: false }, { tour: false })).toBe(true);
  // an unset global is 0, which is not false
  expect(holds({ var: "tour", op: "=", value: false }, {})).toBe(false);
});

test("a hotspot in the table for one disc is the same hotspot on the other", () => {
  const two = doorSpot("a14", "scene2", "view21", "door", 2);
  expect(two?.disc).toBe(2);
  expect(doorSpot("a14", "scene2", "view21", "door", 1)).toBe(two);
  expect(doorSpot("a14", "scene2", "view21", "knock", 1)).toBeNull();
});

/** a session whose console must not be reached: the presses below are all left alone before it */
const session = (g: Record<string, unknown>): DoorSession =>
  ({
    interp: {
      globals: globals(g),
      get compile(): never {
        throw new Error("the console was reached");
      },
    },
  }) as unknown as DoorSession;

test("presses free roam leaves alone, and why", async () => {
  const at = { set: "halla", scene: "scene20", view: "view25", disc: 2 as const };
  expect(await openIfRefused(session({}), { ...at, paint: "window" })).toEqual({ skipped: "not-a-door" });
  // a door with doorways only on the starboard side, pressed from port
  expect(await openIfRefused(session({ hallside: "port" }), { ...at, paint: "door" })).toEqual({ skipped: "no-doorway" });
  // and a hotspot with no step behind it at all
  expect(await stepIfRefused(session({}), { ...at, scene: "scene99", paint: "door" })).toEqual({ skipped: "no-block" });
});
