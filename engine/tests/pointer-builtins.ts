/**
 * The pointer and point commands (engine/src/runtime/builtins/pointer.ts):
 * packed points, the hit test and the drop tests, drawstring's text layer,
 * stringwidth, and DreamFactory 5's box test for pointinprop.
 *
 *   npx vitest run engine/tests/pointer-builtins.ts
 *
 * Needs no game data.
 */
import { expect, test } from "vitest";
import { ActorInstance } from "@dreamfactory/engine/runtime/actors";
import { NullAudioSink } from "@dreamfactory/engine/runtime/audio";
import type { Value } from "@dreamfactory/engine/runtime/interp";
import { packPoint } from "@dreamfactory/engine/runtime/point";
import { PropInstance } from "@dreamfactory/engine/runtime/props";
import { GameSession } from "@dreamfactory/engine/runtime/session";

function harness(v5 = false) {
  const session = new GameSession(() => null, new NullAudioSink());
  session.isV5 = v5;
  const call = (name: string, ...args: Value[]) =>
    session.interp.builtins.get(name)!(session.interp, args, {} as never, undefined as never);
  return { session, call };
}

test("points pack two signed halves; a missing half is 0", async () => {
  const { call } = harness();
  expect(await call("makepoint")).toBe(0);
  expect(await call("makepoint", -3, 7)).toBe(packPoint(-3, 7));
  expect(await call("pointx", packPoint(-3, 7))).toBe(-3);
  expect(await call("pointy", packPoint(-3, 7))).toBe(7);
  expect(await call("pointx")).toBe(0);
  expect(await call("pointy")).toBe(0);
  expect(await call("mousedown")).toBe(0);
  expect(await call("mousedown", 77)).toBe(77);
});

test("hittest stashes the kind for result(); pointinactor before v5 reads the same test", async () => {
  const { session, call } = harness();
  const asked: [number, number][] = [];
  session.hitTestAt = (x, y) => {
    asked.push([x, y]);
    return x === 5 ? { name: "Dog", type: "actor" } : { name: "door", type: "scene" };
  };
  expect(await call("hittest", packPoint(1, 2))).toBe("door");
  expect(await call("result")).toBe("scene");
  expect(await call("hittest")).toBe("door");
  expect(asked.at(-1)).toEqual([0, 0]);
  expect(await call("pointinactor", "dog", packPoint(5, 0))).toBe(1);
  expect(await call("pointinactor", "cat", packPoint(5, 0))).toBe(0);
  expect(await call("pointinactor", "door", packPoint(1, 0))).toBe(0);
  expect(await call("pointinactor")).toBe(0);
});

test("pointinset and pointinstage ask the host's tests", async () => {
  const { session, call } = harness();
  session.pointInSet = (x, y) => x === 3 && y === 4;
  session.pointInStage = (x) => x > 100;
  expect(await call("pointinset", packPoint(3, 4))).toBe(1);
  expect(await call("pointinset")).toBe(0);
  expect(await call("pointinstage", packPoint(101, 0))).toBe(1);
  expect(await call("pointinstage")).toBe(0);
});

test("pointinactor in v5 asks the actor alone, and no actor is 0", async () => {
  const { session, call } = harness(true);
  expect(await call("pointinactor", "nick", 0)).toBe(0);
  expect(await call("pointinactor")).toBe(0);
  const a = new ActorInstance({ name: "nick", poses: [] } as never, { name: "nick.cast", members: [] } as never);
  (session.actorRuntime as unknown as { actors: Map<string, ActorInstance> }).actors.set("nick", a);
  const asked: unknown[] = [];
  session.actorRuntime.covers = (who, x, y, cam) => {
    asked.push([who.member.name, x, y, cam]);
    return x === 9;
  };
  expect(await call("pointinactor", "NICK", packPoint(9, 1))).toBe(1);
  expect(await call("pointinactor", "nick", packPoint(8, 1))).toBe(0);
  // no room open: no camera
  expect(asked[0]).toEqual(["nick", 9, 1, null]);
});

test("drawstring keeps one line per place and size; stringwidth measures it", async () => {
  const { session, call } = harness();
  await call("drawstring", "one", packPoint(10, 20), 5, 14);
  await call("drawstring", "two", packPoint(10, 20), 6, 14);
  await call("drawstring");
  expect(session.textOverlay).toEqual([
    { text: "two", x: 10, y: 20, color: 6, size: 14 },
    { text: "", x: 0, y: 0, color: 0, size: 12 },
  ]);
  expect(await call("stringwidth", "abcde")).toBe(Math.ceil(5 * 12 * 0.6));
  expect(await call("stringwidth")).toBe(0);
  session.measureText = (t, size) => t.length * size + 0.4;
  expect(await call("stringwidth", "ab", 0, 10)).toBe(20);
});

test("pointinbutton with no region is 0", async () => {
  const { call } = harness();
  expect(await call("pointinbutton")).toBe(0);
  expect(await call("pointinbutton", "flat", "ok", packPoint(1, 1))).toBe(0);
});

test("pointinprop in v5 tests the drawn frame's box", async () => {
  const { session, call } = harness(true);
  expect(await call("pointinprop", "crank", 0)).toBe(0);
  const frames: number[] = [];
  const shop = { frame: (loc: number) => (frames.push(loc), { posXraw: 5, posYraw: 5, width: 10, height: 10 }) };
  const p = new PropInstance({ name: "crank", states: [{ identifier: "a", frames: [] }] } as never, shop as never);
  session.propRuntime.props.set("crank", p);
  // a view with no pictures is never hit
  expect(await call("pointinprop", "crank", packPoint(256, 192))).toBe(0);
  const q = new PropInstance({ name: "lever", states: [{ identifier: "a", frames: [100, 101] }] } as never, shop as never);
  session.propRuntime.props.set("lever", q);
  q.frameIdx = 7;
  q.anchorX = 50;
  q.anchorY = 60;
  expect(await call("pointinprop", "lever", packPoint(45, 55))).toBe(1);
  expect(await call("pointinprop", "lever", packPoint(55, 55))).toBe(0);
  expect(await call("pointinprop", "lever", packPoint(45, 65))).toBe(0);
  expect(await call("pointinprop", "lever")).toBe(0);
  // the last picture, the frame index held to the view
  expect(frames).toEqual([101, 101, 101, 101]);
});

test("pointinprop before v5 asks the prop runtime's own test", async () => {
  const { session, call } = harness();
  const p = new PropInstance({ name: "glyph", states: [{ identifier: "a", frames: [1] }] } as never, {} as never);
  session.propRuntime.props.set("glyph", p);
  session.propRuntime.covers = (_p, x) => x === 2;
  expect(await call("pointinprop", "glyph", packPoint(2, 0))).toBe(1);
  expect(await call("pointinprop", "glyph")).toBe(0);
});
