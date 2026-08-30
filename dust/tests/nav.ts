/**
 * The v1 route planner, against the real sets.
 *
 *   npx vitest run dust/tests/nav.ts
 *
 * `nav.ts` is the half of a Dust playthrough that needs no browser: a v1 set is
 * a grid with a flat move table, so a route between two standpoints is a search
 * over the file rather than something authored by hand. That makes it checkable
 * in the fast suite, which is where the 55 rungs of
 * [the golden thread](../../docs/dust/thread.md) will get their routes from.
 *
 * Skipped, not failed, without the disc — the bargain every Dust suite makes.
 */
import { test, expect } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { readSetFileV1 } from "@dreamfactory/engine/df/set-v1";
import { compass, facingFor, mergeCompass, planRoute, rightRing, sceneAt } from "./playthrough/nav";

const DATA = fileURLToPath(new URL("../gamefiles/dustcd/DATA", import.meta.url));
const load = (name: string) => readSetFileV1(new Uint8Array(readFileSync(`${DATA}/${name}.SET`)));
const have = existsSync(DATA);

test("the compass is read off the set's own moves", () => {
  if (!have) return;
  const dirs = compass(load("NITE"));
  // whichever facing walks to z-1 is north; the set numbers them 1..4 and the
  // planner never assumes which is which
  expect.soft([...dirs.keys()].sort(), "every facing walks somewhere").toEqual([1, 2, 3, 4]);
  expect.soft(dirs.get(1), "facing 1").toEqual({ dx: 0, dz: -1 });
  expect.soft(dirs.get(2), "facing 2").toEqual({ dx: 0, dz: 1 });
  expect.soft(dirs.get(3), "facing 3").toEqual({ dx: 1, dz: 0 });
  expect.soft(dirs.get(4), "facing 4").toEqual({ dx: -1, dz: 0 });
  // and the turn ring that follows: north → east → south → west
  expect.soft([...rightRing(load("NITE"))].sort(), "clockwise").toEqual([[1, 3], [2, 4], [3, 2], [4, 1]]);
});

test("every set's facings agree with themselves", () => {
  if (!have) return;
  // `compass` throws when one facing walks two different ways, which would mean
  // the grid model is wrong for that set — so reading every set in DATA/ IS the
  // assertion, and the list is the directory rather than a list kept by hand
  const sets = readdirSync(DATA).filter((f) => /\.set$/i.test(f));
  expect(sets.length, "there are sets to read").toBeGreaterThan(0);
  for (const f of sets) {
    expect.soft(() => compass(readSetFileV1(new Uint8Array(readFileSync(`${DATA}/${f}`)))), f).not.toThrow();
  }
});

test("the facing numbers are the engine's, not each set's", () => {
  if (!have) return;
  /*
   * A small interior defines almost nothing — MAYHALL is four cells with one
   * authored walk, so on its own it can say which way is north and nothing else.
   * Merging every set answers all four, and `mergeCompass` throws if any set
   * contradicts another, which is the assertion: `4` means west everywhere, or
   * this test fails and the route planner has been believing a fiction.
   */
  const sets = readdirSync(DATA)
    .filter((f) => /\.set$/i.test(f))
    .map((f) => readSetFileV1(new Uint8Array(readFileSync(`${DATA}/${f}`))));
  const dirs = mergeCompass(sets);
  expect.soft([...dirs.keys()].sort(), "all four, and no fifth").toEqual([1, 2, 3, 4]);
  expect.soft(dirs.get(4), "facing 4 is west in every set that walks it").toEqual({ dx: -1, dz: 0 });
  // and the set that made this necessary really cannot answer on its own: the
  // hall runs north-south, so it walks two facings and knows nothing of west —
  // which is the direction its study door is on
  const hall = readSetFileV1(new Uint8Array(readFileSync(`${DATA}/MAYHALL.SET`)));
  expect.soft([...compass(hall).keys()].sort(), "MAYHALL walks two ways").toEqual([1, 2]);
  expect.soft(facingFor(compass(hall), "west"), "and cannot place west alone").toBeNull();
  expect.soft(facingFor(mergeCompass(sets), "west"), "the merge can").toBe(4);
});

test("a route across the night town is walkable and lands where it says", () => {
  if (!have) return;
  const set = load("NITE");
  // the first night's own geography: the street outside the hotel to the cell
  // the Mayor's gate is on (Scene J9), which is where the walkthrough's day 1
  // goes (docs/dust/walkthrough.md)
  const route = planRoute(set, { x: 3, z: 6, facing: 4 }, { x: 9, z: 8 });
  expect(route, "a route exists").not.toBeNull();
  expect.soft(sceneAt(set, 9, 8), "the goal cell").toBe("Scene J9");
  // walking it by hand has to end where the planner says
  let at = { x: 3, z: 6, facing: 4 };
  for (const [i, k] of route!.keys.entries()) {
    const step = set.transitions.find(
      (t) =>
        t.from.x === at.x && t.from.z === at.z && t.from.facing === at.facing &&
        t.to.x === route!.path[i].x && t.to.z === route!.path[i].z && t.to.facing === route!.path[i].facing,
    );
    expect.soft(step, `press ${i + 1} (${k}) is an authored move`).toBeTruthy();
    at = route!.path[i];
  }
  expect.soft([at.x, at.z], "arrives at the goal").toEqual([9, 8]);
});

test("the hall-to-study leg is two presses", () => {
  if (!have) return;
  const hall = load("MAYHALL");
  // MAYHALL opens at its own standpoint and the study door is west of Scene C3:
  // `if currentview () = "west" & arg = "uparrow" & propowner ("door") = "study"`
  const route = planRoute(
    hall,
    { x: hall.defaultCellX, z: hall.defaultCellZ, facing: hall.defaultFacing },
    { x: 2, z: 2, facing: 4 },
  );
  expect(route, "a route exists").not.toBeNull();
  expect.soft(route!.keys, "up, then turn to face the door").toEqual(["uparrow", "leftarrow"]);
});

test("a goal with no authored route says so rather than hanging", () => {
  if (!have) return;
  const study = load("MAYSTUDY");
  // a cell off the grid cannot be reached and the search has to end
  expect(planRoute(study, { x: 1, z: 1, facing: 4 }, { x: 99, z: 99 })).toBeNull();
});
