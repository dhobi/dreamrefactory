/**
 * DreamFactory 5's room-side commands (engine/src/runtime/builtins/df5.ts)
 * called with arguments left off, as RedJack.exe reads a missing one — as 0
 * or as no name: `calcpoint ()` is the room's origin on the screen, the actor
 * accessors with no name find no actor and answer 0, and `stageorigin` with
 * no x puts the stage at x 0.
 *
 *   npx vitest run engine/tests/df5-builtins-edges.ts
 *
 * Needs no game data.
 */
import { expect, test } from "vitest";
import type { SettFile } from "@dreamfactory/engine/df/sett";
import { ActorInstance } from "@dreamfactory/engine/runtime/actors";
import { NullAudioSink } from "@dreamfactory/engine/runtime/audio";
import type { Value } from "@dreamfactory/engine/runtime/interp";
import { MazeRuntime } from "@dreamfactory/engine/runtime/maze";
import { packPoint } from "@dreamfactory/engine/runtime/point";
import { GameSession } from "@dreamfactory/engine/runtime/session";

function harness() {
  const session = new GameSession(() => null, new NullAudioSink());
  session.isV5 = true;
  const call = (name: string, ...args: Value[]) =>
    session.interp.builtins.get(name)!(session.interp, args, {} as never, undefined as never);
  return { session, call };
}

test("calcpoint with no point is the room's origin: the screen's centre from five units behind it", async () => {
  const { session, call } = harness();
  const sett: SettFile = {
    file: { containers: [] } as never, name: "test", mainScript: 0,
    nodes: [{ name: "Scene1", id: 1, node: 1, sphere: 0, script: 0, x: -500000, y: 0, z: 0 }],
    scenes: [], roads: [], quads: [], stars: [], routes: [], first: "Scene1", far: 1350000,
  };
  const maze = new MazeRuntime(sett, { instanceFrom: () => null, clock: { now: 0 }, currentSetName: "test", frameRate: 2 } as never);
  maze.node = sett.nodes[0];
  session.maze = maze;
  expect(await call("calcpoint")).toBe(packPoint(320, 240));
  // and a point behind the camera is (32000, 32000)
  expect(await call("calcpoint", -1000000)).toBe(packPoint(32000, 32000));
});

test("the actor accessors with no name find no actor", async () => {
  const { session, call } = harness();
  const a = new ActorInstance({ name: "nick", poses: [] } as never, { name: "x.cast", members: [] } as never);
  Object.assign(a, { name: "nick", true3d: true });
  (session.actorRuntime as unknown as { actors: Map<string, ActorInstance> }).actors.set("nick", a);
  expect(await call("actoristrue3d", "nick")).toBe(1);
  expect(await call("actororder")).toBe(0);
  expect(await call("actoristrue3d")).toBe(0);
  expect(await call("actorbrightness")).toBe(0);
});

test("stageorigin with no x puts the stage's left edge at 0", async () => {
  const { session, call } = harness();
  session.stageName = "fight";
  session.stageOrigin = { x: 9, y: 9 };
  await call("stageorigin", undefined as never, 4);
  expect(session.stageOrigin).toEqual({ x: 0, y: 4 });
});
