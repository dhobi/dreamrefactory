/**
 * The SET builder with everything optional left out, and the three things it
 * refuses (engine/src/df/set-build.ts): a room of one scene and one bare view
 * reads back with no roads, no actors, no maps and the defaults the builder
 * fills in; an actor with no secondary star, or a route of one point, writes
 * no route; and a set with no scenes, a picture too small for the view, or a
 * ring pointing at a scene that does not exist is an error.
 *
 *   npx vitest run engine/tests/set-build-defaults.ts
 *
 * taoot/tests/auto/set-editor.ts builds the full room, every option given.
 */
import { expect, test } from "vitest";
import { writeContainerFile } from "@dreamfactory/engine/df/container";
import { emptyScript } from "@dreamfactory/engine/df/build";
import { STANDPOINT, buildSetFile, type SetBuildOptions, type SetBuildScene } from "@dreamfactory/engine/df/set-build";
import { readSetFile } from "@dreamfactory/engine/df/set";

const W = 4;
const H = 2;
const art = { pixels: new Uint8Array(W * H).fill(1) };

const scene = (name: string, views: SetBuildScene["views"]): SetBuildScene => ({
  name,
  position: [100, 200, 0],
  mapPoint: [1, 2, 0],
  views,
  right: { destinationScene: 0, frames: [{ art, motion: STANDPOINT, viewID: 0, deg: 0 }] },
  left: { destinationScene: 0, frames: [{ art, motion: STANDPOINT, viewID: 0, deg: 0 }] },
});

const base = (extra: Partial<SetBuildOptions> = {}): SetBuildOptions => ({
  palette: new Uint8Array([0, 0, 0, 255, 255, 255]),
  name: "room",
  viewWidth: W,
  viewHeight: H,
  scenes: [scene("hall", [{ name: "north", rotation: 0, rot8: 0, id: 0 }])],
  // every room on a disc has a star register, and the reader expects one
  actors: [{ name: "anne", rotation8: 0, position: [1, 2, 3] }],
  ...extra,
});

const read = (opts: SetBuildOptions) => readSetFile(writeContainerFile(buildSetFile(opts).file));

test("a room with nothing optional reads back with the builder's defaults", () => {
  const set = read(base());
  expect(set.setName).toBe("room");
  expect([set.defaultSceneName, set.defaultViewName]).toEqual(["hall", "north"]);
  expect([set.transitionRegister, set.mapLight, set.mapDark]).toEqual([0, 0, 0]);
  expect(set.actors.map((a) => a.identifier)).toEqual(["anne"]);
  expect([set.zLevelCount, set.zFarMax]).toEqual([32, 4096]);
  expect(set.scenes.map((s) => s.sceneName)).toEqual(["hall"]);
  expect(set.scenes[0].views.map((v) => [v.viewName, v.objects.length])).toEqual([["north", 0]]);
});

test("a first scene with no views names no default view", () => {
  const set = read(base({ scenes: [scene("void", [])] }));
  expect([set.defaultSceneName, set.defaultViewName]).toEqual(["void", ""]);
});

test("an actor without a secondary star, or with a route of one point, has no route", () => {
  const { file } = buildSetFile(base({
    actors: [
      { name: "anne", rotation8: 0, position: [1, 2, 3] },
      { name: "jack", rotation8: 64, position: [4, 5, 6], secondary: { name: "jack2", rotation8: 0, position: [7, 8, 9] }, path: [[4, 5, 6]] },
      { name: "kate", rotation8: 0, position: [0, 0, 0], secondary: { name: "kate2", rotation8: 0, position: [3, 4, 0] } },
    ],
  }));
  const set = readSetFile(writeContainerFile(file));
  expect(set.actorRegister).toBeGreaterThan(0);
  // only the register and the frames: no route container was added for any of the three
  const routeless = buildSetFile(base()).file;
  expect(file.containers).toHaveLength(routeless.containers.length);
});

test("a room with no stars at all has no star register", () => {
  const c0 = buildSetFile(base({ actors: undefined })).file.containers[0].data;
  expect(new DataView(c0.buffer, c0.byteOffset).getInt32(0x58, true)).toBe(0);
});

test("what the builder refuses", () => {
  expect(() => buildSetFile(base({ scenes: [] }))).toThrow("set: a set needs at least one scene");
  const small = { pixels: new Uint8Array(3) };
  const bad = scene("hall", []);
  bad.right = { destinationScene: 0, frames: [{ art: small, motion: STANDPOINT, viewID: 0, deg: 0 }] };
  expect(() => buildSetFile(base({ scenes: [bad] }))).toThrow("set: a picture is 3 bytes, needs 8");
  const lost = scene("hall", []);
  lost.left = { destinationScene: 4, frames: [] };
  expect(() => buildSetFile(base({ scenes: [lost] }))).toThrow("set: a register points at scene 4, which does not exist");
});

test("a road with no waypoints and a scene with its own script", () => {
  const own = emptyScript();
  const hall = { ...scene("hall", [{ name: "north", rotation: 0, rot8: 0, id: 0 }]), script: own };
  const ring = { destinationScene: 0, frames: [{ art, motion: STANDPOINT, viewID: 0, deg: 0 }] };
  const set = read(base({
    scenes: [hall],
    roads: [{ name: "stairs", fromViewID: 0, toViewID: 0, from: [0, 0, 0], to: [10, 0, 0], forward: ring, back: ring }],
  }));
  expect(set.transitions.map((t) => [t.transitionName, t.waypoints.length])).toEqual([["stairs", 0]]);
  expect(set.scenes[0].locationScript).not.toBe(set.mainScript);
});
