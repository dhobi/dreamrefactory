/**
 * Dust's grid of cells and facings, re-expressed as the scenes, views, turn
 * rings and roads the v4 runtime walks (engine/src/df/set-v1-to-v4.ts), on a
 * room described here: a cell with all four facings and one with only two, a
 * walk that changes facing, a walk to a standpoint no view has, turns with and
 * without their fifth frame, and a default standpoint that is or is not one of
 * the room's.
 *
 *   npx vitest run engine/tests/set-v1-to-v4.ts
 *
 * No game files: dust/tests/sets.ts converts every room on the disc.
 */
import { expect, test } from "vitest";
import type { SetFileV1, V1Transition } from "@dreamfactory/engine/df/set-v1";
import { setFileFromV1 } from "@dreamfactory/engine/df/set-v1-to-v4";
import { LEFTTURNS, RIGHTTURNS } from "@dreamfactory/engine/df/set";

const sp = (x: number, z: number, facing: number) => ({ x, z, facing });
const move = (from: [number, number, number], to: [number, number, number], frames: number[], still = -1): V1Transition => ({
  from: sp(...from), to: sp(...to), kind: from[0] === to[0] && from[1] === to[1] ? "turn" : "walk",
  firstFrame: frames[0] ?? 0, frames, departureStill: still, record: 0,
});

function room(transitions: V1Transition[], extra: Partial<SetFileV1> = {}): SetFileV1 {
  return {
    file: { header: { fourCC: 0, fileSize: 0, containerCount: 0, type: 0, gapWhere: 0 }, containers: [], headerRaw: new Uint8Array(0) } as never,
    version: 1,
    setName: "town",
    cluts: [],
    paletteRaw: new Uint8Array(2048),
    gridWidth: 3,
    gridHeight: 1,
    viewPortWidth: 4,
    viewPortHeight: 2,
    eyeHeight: 62,
    cameraSetback: 64,
    hiResStills: 1,
    defaultCellX: 0,
    defaultCellZ: 0,
    defaultFacing: 3,
    transitionRegister: 1,
    actorRegister: 2,
    mainScript: 0,
    scenes: [
      { name: "G1", x: 0, z: 0, scriptLocation: 0, build: true, record: 0 },
      { name: "G2", x: 1, z: 0, scriptLocation: 0, build: true, record: 0 },
      { name: "G3", x: 2, z: 0, scriptLocation: 0, build: false, record: 0 },
    ],
    actors: [{ identifier: "anne", rotation8: 0, positionX: 1, positionZ: 2, positionY: 3, record: 0 }],
    starPaths: [],
    transitions,
    warnings: [],
    ...extra,
  };
}

/** cell (0,0) turning all the way round, the right-turn cycle 3 → 2 → 4 → 1 (east, south, west, north) */
const ROUND: V1Transition[] = [
  move([0, 0, 3], [0, 0, 2], [10, 11, 12, 13, 14], 15),
  move([0, 0, 2], [0, 0, 4], [20, 21, 22, 23]), // no fifth frame
  move([0, 0, 4], [0, 0, 1], [30, 31, 32, 33, 34], 35),
  // north turns only to south, so the ring's north → east step has no motion of its own
  move([0, 0, 1], [0, 0, 2], [70]),
];

test("a cell with four facings gets four compass views; one with two gets none", () => {
  const set = setFileFromV1(room([
    ...ROUND,
    move([1, 0, 3], [1, 0, 2], [40, 41]),
    move([1, 0, 2], [1, 0, 3], [42]),
  ]));
  expect(set.scenes[0].views.map((v) => [v.viewName, v.rotation8, v.viewID])).toEqual([
    ["east", 0, 0], ["south", 64, 1], ["west", 128, 2], ["north", 192, 3],
  ]);
  expect(set.scenes[1].views).toEqual([]);
  expect(set.scenes[1].turns.map((r) => r.frames.length)).toEqual([0, 0]);
  expect([set.defaultSceneName, set.defaultViewName]).toEqual(["G1", "east"]);
  expect([set.mapWidth, set.setDimensionsX, set.noHiResStills, set.colorCount]).toEqual([3, 768, false, 256]);
  expect(set.actors[0]).toMatchObject({ identifier: "anne", idLimit: 15 });
});

test("the right ring plays each turn's motion then its fifth frame; the left ring arrives on the stills", () => {
  const set = setFileFromV1(room(ROUND));
  const right = set.scenes[0].turns[RIGHTTURNS].frames;
  // east→south: four motion frames, then its own fifth; south→west: four, and with no fifth the
  // arrival is the last frame any move into west ended on; west→north: four and a fifth;
  // north→east: no such turn and no move ever ends facing east, so only an empty arrival
  expect(right.map((f) => f.frameContainerLoc)).toEqual([10, 11, 12, 13, 14, 20, 21, 22, 23, 23, 30, 31, 32, 33, 34, 0]);
  const left = set.scenes[0].turns[LEFTTURNS].frames;
  // the other way round, east → north → west → south → east, each arrival on the hi-res still a move
  // DEPARTED that standpoint with: none from north, 35 from west, none from south, 15 from east
  expect(left.filter((f) => f.motionInfo !== 0).map((f) => f.frameContainerLoc)).toEqual([0, 35, 0, 15]);
});

test("walks: roads between standpoints with views; none onto a cell without them", () => {
  const set = setFileFromV1(room([
    ...ROUND,
    ...ROUND.map((t) => move([1, 0, t.from.facing], [1, 0, t.to.facing], t.frames)),
    // east from G1 to G2, three frames, then one frame back
    move([0, 0, 3], [1, 0, 3], [50, 51, 52]),
    move([1, 0, 4], [0, 0, 4], [53]),
    // a walk that turns as it goes, and one onto G3, which has no views
    move([0, 0, 2], [1, 0, 1], [54]),
    move([1, 0, 3], [2, 0, 3], [55]),
  ]));
  // the walk that turns as it goes is still a road; it just says nothing about headings
  expect(set.transitions.map((t) => t.transitionName)).toEqual(["0,0,3->1,0,3", "1,0,4->0,0,4", "0,0,2->1,0,1"]);
  const [east, back] = set.transitions;
  expect(east.frameRegisters[0].frames.map((f) => [f.frameContainerLoc, f.posX])).toEqual([
    [50, 128], [51, 256], [52, 384],
  ]);
  expect(east.frameRegisters[0].destination).toBe(2);
  // a one-frame walk is all arrival
  expect(back.frameRegisters[0].frames.map((f) => [f.frameContainerLoc, f.posX, f.motionInfo])).toEqual([[53, 128, 1]]);
});

test("a default standpoint that is not one of the room's opens on the first room with views", () => {
  const set = setFileFromV1(room(ROUND, { defaultCellX: 2, defaultFacing: 9 }));
  expect([set.defaultSceneName, set.defaultViewName]).toEqual(["G1", "east"]);
  // and with no views anywhere, the first scene by name and no view
  const bare = setFileFromV1(room([]));
  expect([bare.defaultSceneName, bare.defaultViewName]).toEqual(["G1", ""]);
  const empty = setFileFromV1(room([], { scenes: [] }));
  expect([empty.defaultSceneName, empty.defaultViewName]).toEqual(["", ""]);
});

test("four facings whose headings are not four quarters are not a compass", () => {
  // a walk says facing 2 looks east, as facing 3 does by default
  const set = setFileFromV1(room([...ROUND, move([0, 0, 2], [1, 0, 2], [60])]));
  expect(set.scenes[0].views).toEqual([]);
  expect(set.transitions).toEqual([]);
});

test("a compass turned by an eighth names its views by facing, and a frameless move leaves no still", () => {
  // every facing's walk runs diagonally, so the four headings are 32, 96, 160, 224
  const diag: V1Transition[] = [
    move([1, 1, 3], [2, 2, 3], [1]),
    move([1, 1, 2], [0, 2, 2], [2]),
    move([1, 1, 4], [0, 0, 4], [3]),
    move([1, 1, 1], [2, 0, 1], [4]),
    move([1, 1, 3], [1, 1, 2], []),
    move([1, 1, 2], [1, 1, 4], [5]),
    move([1, 1, 4], [1, 1, 1], [6]),
    move([1, 1, 1], [1, 1, 3], [7]),
  ];
  const set = setFileFromV1(room(diag, {
    scenes: [{ name: "C", x: 1, z: 1, scriptLocation: 0, build: true, record: 0 }],
    defaultCellX: 1, defaultCellZ: 1, defaultFacing: 3,
  }));
  const views = set.scenes[0].views;
  expect(views.map((v) => v.rotation8 % 64)).toEqual([32, 32, 32, 32]);
  expect(views.every((v) => /^view[1-4]$/.test(v.viewName))).toBe(true);
  // the default facing's view has no compass name to be found by, so the room opens on its first
  expect(set.defaultViewName).toBe(views[0].viewName);
  // nothing ever ends facing south having moved, so the frameless turn into it left no arrival frame
  const intoSouth = set.scenes[0].turns[RIGHTTURNS].frames.filter((f) => f.motionInfo === 1);
  expect(intoSouth.map((f) => f.frameContainerLoc)).toContain(0);
});

test("a default facing the room never uses opens on the room's first view", () => {
  const set = setFileFromV1(room(ROUND, { defaultFacing: 9 }));
  expect([set.defaultSceneName, set.defaultViewName]).toEqual(["G1", "east"]);
});
