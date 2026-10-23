/**
 * DreamFactory 5's sprite sounds, sound lengths, puppet lines and colour
 * probes, as RedJack.exe answers them (engine/src/runtime/builtins/df5-look.ts):
 * actorsound and propsound start a clocked animation with their sound,
 * soundticks divides as the exe does, the puppet's lines are read by index, and
 * setcolor / setdepth / stagecolor answer 0 off the picture.
 *
 *   npx vitest run engine/tests/df5-look-sounds.ts
 *
 * Needs no game data.
 */
import { expect, test, vi } from "vitest";
import { encodeAudioContainer } from "@dreamfactory/engine/df/audio";
import { SettFile } from "@dreamfactory/engine/df/sett";
import { ActorInstance } from "@dreamfactory/engine/runtime/actors";
import { NullAudioSink } from "@dreamfactory/engine/runtime/audio";
import type { Value } from "@dreamfactory/engine/runtime/interp";
import { MazeRuntime } from "@dreamfactory/engine/runtime/maze";
import { DEPTH_FAR } from "@dreamfactory/engine/runtime/maze-render";
import { packPoint } from "@dreamfactory/engine/runtime/point";
import { PropInstance } from "@dreamfactory/engine/runtime/props";
import { GameSession } from "@dreamfactory/engine/runtime/session";

function harness() {
  const audio = new NullAudioSink();
  const session = new GameSession(() => null, audio);
  session.isV5 = true;
  const call = (name: string, ...args: Value[]) =>
    session.interp.builtins.get(name)!(session.interp, args, {} as never, undefined as never);
  const fails = (name: string, ...args: Value[]) => expect(async () => call(name, ...args)).rejects;
  return { session, audio, call, fails };
}

const sound = encodeAudioContainer({ sampleRate: 11025, samples: new Float32Array(100).fill(0.1) });

test("litby to the group it has is nothing; actorroll reads back", async () => {
  const { session, call } = harness();
  const p = new PropInstance({} as never, {} as never);
  session.propRuntime.props.set("lamp", p);
  await call("proplitby", "lamp", "stage");
  p.lightGroup = 9;
  await call("proplitby", "lamp", "STAGE");
  expect(p.lightGroup).toBe(9);
  const a = new ActorInstance({ name: "nick", poses: [] } as never, { name: "nick.cast", members: [] } as never);
  (session.actorRuntime as unknown as { actors: Map<string, ActorInstance> }).actors.set("nick", a);
  await call("actorroll", "nick", 0x1000005);
  expect(await call("actorroll", "nick")).toBe(5);
});

test("actorsound plays its pose's sound and starts a clocked pose with it", async () => {
  const { session, audio, call } = harness();
  const cst = { file: { containers: [{ data: new Uint8Array(0) }, { data: sound }] } };
  const pose = { name: "talk", sound: 1, frameTicks: 6, play: [0], steps: [[]] };
  const a = new ActorInstance({ name: "nick", poses: [pose, { name: "lost", sound: 7 }] } as never,
    { name: "nick.cast", members: [], cst } as never);
  a.name = "nick";
  (session.actorRuntime as unknown as { actors: Map<string, ActorInstance> }).actors.set("nick", a);
  a.poseName = "talk";
  a.step = 3;
  session.clock.now = 1000;
  await call("actorsound", "nick", 255, 128);
  expect(audio.calls).toHaveLength(1);
  expect(audio.calls[0]).toMatchObject({ channel: "sound", volume: 1 });
  expect([a.poseStarted, a.step, a.poseTicks]).toEqual([true, 0, 60]);
  // again: the first stops, and a started pose keeps its clock
  a.step = 2;
  await call("actorsound", "nick", 0, 0);
  expect(audio.calls[0].stopped).toBe(true);
  expect(audio.calls[1].volume).toBe(0);
  expect(a.step).toBe(2);
  // a sound the cast has not: the last one stops and nothing plays
  a.poseName = "lost";
  await call("actorsound", "nick", 300, 0);
  expect(audio.calls[1].stopped).toBe(true);
  expect(audio.calls).toHaveLength(2);
});

test("propsound plays its view's sound and stamps an animating prop's first pass", async () => {
  const { session, audio, call, fails } = harness();
  const shop = { shp: { file: { containers: [{ data: new Uint8Array(0) }, { data: sound }] } } };
  const p = new PropInstance({ name: "door", states: [{ identifier: "open", sound: 1, frameTicks: 4, frames: [1] }, { identifier: "shut", frames: [1] }] } as never, shop as never);
  p.name = "door";
  session.propRuntime.props.set("door", p);
  p.animating = true;
  p.frameIdx = 3;
  session.clock.now = 500;
  await call("propsound", "door", 128, 255);
  expect(audio.calls).toHaveLength(1);
  expect([p.lastTick, p.frameIdx, p.passTicks]).toEqual([-1, 0, 30]);
  p.frameIdx = 2;
  await call("propsound", "door", 128, 255);
  expect(p.frameIdx).toBe(2);
  p.stateName = "shut";
  await fails("propsound", "door", 1, 1).toMatchObject({ code: 0xa });
  // a prop not animating starts nothing
  p.stateName = "";
  p.animating = false;
  p.lastTick = 0;
  await call("propsound", "door", 1, 1);
  expect(p.lastTick).toBe(0);
});

test("soundticks: the byte count over the block align, times 60 over the rate", async () => {
  const { session, call, fails } = harness();
  const chunk = (align: number, rate: number, bytes: number) => {
    const d = new Uint8Array(0x28);
    const v = new DataView(d.buffer);
    v.setInt16(0x1a, align, true);
    v.setInt32(0x1c, rate, true);
    v.setInt32(0x24, bytes, true);
    return d;
  };
  const chunks: Record<string, Uint8Array> = {
    boom: chunk(2, 22050, 44100),
    odd: chunk(4, 11025, 1001),
    noalign: chunk(0, 11025, 100),
    norate: chunk(2, 0, 100),
    short: new Uint8Array(0x20),
  };
  vi.spyOn(session.audioLib, "soundChunk").mockImplementation((n: string) => chunks[n] ?? null);
  expect(await call("soundticks", "boom")).toBe(60);
  expect(await call("soundticks", "odd")).toBe(Math.trunc((250 * 60) / 11025));
  expect(await call("soundticks", "noalign")).toBe(0);
  expect(await call("soundticks", "norate")).toBe(0);
  await fails("soundticks", "short").toMatchObject({ code: 0xa });
  expect(await call("soundexists", "boom")).toBe(1);
});

test("the puppet's lines: counted, and each read by index from the map or its bytes", async () => {
  const { session, call, fails } = harness();
  const c0 = new Uint8Array(0x70 + 2 * 312);
  new DataView(c0.buffer).setInt16(0x6e, 2, true);
  const put = (at: number, s: string) => {
    c0[at] = s.length;
    for (let k = 0; k < s.length; k++) c0[at + 1 + k] = s.charCodeAt(k);
  };
  put(0x70 + 312 + 0x118, "line2");
  put(0x70 + 312 + 0x18, "Second.");
  const dialogue = new Map([["line1", { ident: "line1", text: "First.", record: 0x70 }]]);
  (session.puppetCtrl as unknown as { puppet: unknown }).puppet = { pup: { file: { containers: [{ data: c0 }] }, dialogue } } as never;
  expect(await call("countpuppetsounds")).toBe(2);
  expect(await call("indextopuppetsoundname", 1)).toBe("line1");
  expect(await call("indextopuppetsubtitle", 1)).toBe("First.");
  expect(await call("indextopuppetsoundname", 2)).toBe("line2");
  expect(await call("indextopuppetsubtitle", 2)).toBe("Second.");
  await fails("indextopuppetsubtitle", 3).toMatchObject({ code: 0xa });
  await fails("indextopuppetsoundname", 0).toMatchObject({ code: 0xa });
  // a container 0 too short to hold the count has no lines
  (session.puppetCtrl as unknown as { puppet: unknown }).puppet = { pup: { file: { containers: [{ data: new Uint8Array(0x20) }] }, dialogue: new Map() } } as never;
  expect(await call("countpuppetsounds")).toBe(0);
});

test("setcolor and setdepth: 0 off the room's view; a sphere with no patches is black and far", async () => {
  const { session, call } = harness();
  const sett: SettFile = {
    file: { containers: [] } as never, name: "r", mainScript: 0,
    nodes: [{ name: "n", id: 1, node: 1, sphere: 3, script: 0, x: 0, y: 0, z: 0 }],
    scenes: [], roads: [], quads: [], stars: [], routes: [], first: "n", far: 1,
  };
  const m = new MazeRuntime(sett, session);
  session.maze = m;
  // open, but standing nowhere: no camera
  expect(await call("setcolor", packPoint(5, 5))).toBe(0);
  expect(await call("setcolor", packPoint(-1, 5))).toBe(0);
  expect(await call("setdepth", packPoint(5, 700))).toBe(0);
  expect(await call("setcolor", packPoint(640, 5))).toBe(0);
  expect(await call("setcolor", packPoint(5, -2))).toBe(0);
  m.node = sett.nodes[0];
  expect(await call("setcolor", packPoint(5, 5))).toBe(0);
  expect(await call("setcolor", packPoint(6, 5))).toBe(0);
  expect(await call("setdepth", packPoint(5, 5))).toBe(DEPTH_FAR);
  // another room's file: the cache starts again
  const other = new MazeRuntime({ ...sett, file: { containers: [] } as never }, session);
  other.node = sett.nodes[0];
  session.maze = other;
  expect(await call("setdepth", packPoint(5, 5))).toBe(DEPTH_FAR);
  // on film: a picture the room has not is 0, colour or depth
  const frame = { picture: 9, x: 0, y: 0, z: 0, heading: 0, pitch: 0, roll: 0, fov: 1, headDeg: 0, pitchDeg: 0, rollDeg: 0, fovDeg: 0, view: -1 };
  const film = { container: 4, to: 0, toScene: 0, frames: [frame] };
  other.walk = { film, frame: 0 };
  expect(await call("setcolor", packPoint(5, 5))).toBe(0);
  expect(await call("setcolor", packPoint(5, 6))).toBe(0);
  expect(await call("setdepth", packPoint(5, 5))).toBe(0);
  other.walk = null;
  other.shot = { film: { ...film, container: 5 }, frame: 0 };
  expect(await call("setcolor", packPoint(5, 5))).toBe(0);
});

test("stagecolor reads the open flat's palette at a point less the stage's origin", async () => {
  const { session, call } = harness();
  const palette = new Uint8ClampedArray(8);
  palette.set([0x11, 0x22, 0x33, 255], 4);
  const pixels = new Uint8Array([0, 1, 1, 0]);
  session.stageCtrl.flatImage = () => ({ pixels, width: 2, height: 2, palette });
  expect(await call("stagecolor", packPoint(1, 0))).toBe(0x112233);
  expect(await call("stagecolor", packPoint(0, 0))).toBe(0);
  session.stageOrigin = { x: 10, y: 10 };
  expect(await call("stagecolor", packPoint(10, 11))).toBe(0x112233);
  for (const [x, y] of [[9, 10], [10, 9], [12, 10], [10, 12]]) expect(await call("stagecolor", packPoint(x, y))).toBe(0);
});
