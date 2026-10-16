/**
 * DreamFactory 5's `launchroad` and the frame loop's road mode it starts
 * (RedJack.exe 0x441af0 → 0x439620, played by 0x432b00), on a real RedJack
 * room's road; and true-3D pictures — props' and actors' cards — posed as
 * 0x456540's matrix poses them.
 *
 *   npx vitest run engine/tests/df5-road.ts
 *
 * The road half reads `redjack/gamefiles` and skips loudly without it.
 */
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test, expect } from "vitest";
import { MazeFilm, SettFile, TURN, readSettFile } from "@dreamfactory/engine/df/sett";
import type { ShpFrame } from "@dreamfactory/engine/df/shp";
import { MazeRuntime, ROAD_NO_END, degMask } from "@dreamfactory/engine/runtime/maze";
import { GameSession } from "@dreamfactory/engine/runtime/session";
import { NullAudioSink } from "@dreamfactory/engine/runtime/audio";
import { ActorInstance } from "@dreamfactory/engine/runtime/actors";
import { CardPose, cardOf } from "@dreamfactory/engine/runtime/props";
import type { WorldCamera } from "@dreamfactory/engine/runtime/geometry";
import type { Value } from "@dreamfactory/engine/runtime/interp";

const LOCK1 = fileURLToPath(new URL("../../redjack/gamefiles/RJDisk2/data/lock1.sett", import.meta.url));
const missing = !existsSync(LOCK1);
if (missing) console.warn(`no ${LOCK1} — skipping the road checks`);

/** a v5 session standing at lock1's Node11, every `sendtoscene` it makes written down */
async function lock1() {
  const session = new GameSession(() => null, new NullAudioSink());
  session.isV5 = true;
  const call = (name: string, ...args: Value[]) => session.interp.builtins.get(name)!(session.interp, args, {} as never, {} as never);
  const fails = (name: string, ...args: Value[]) => expect(async () => call(name, ...args)).rejects;
  await fails("launchroad", "Road22", 1, 4).toMatchObject({ code: 0x28 });
  const sett = readSettFile(new Uint8Array(readFileSync(LOCK1)));
  const m = new MazeRuntime(sett, session);
  session.maze = m;
  await m.enterNode("Node11");
  const sent: { pass: number; to: string; handler: string; frame: number }[] = [];
  let pass = 0;
  session.sendEvent = async (cmd: string, to: string, handler: string) => {
    sent.push({ pass, to: `${cmd} ${to}`, handler, frame: m.walk?.frame ?? -1 });
    return 0;
  };
  const step = async () => {
    pass++;
    await m.walkStep();
  };
  return { session, sett, m, call, fails, sent, step, passes: () => pass };
}

const angles = (m: MazeRuntime) => [m.heading, m.pitch, m.fov];
const anglesOf = (f: MazeFilm, i: number) => [degMask(f.frames[i].headDeg), degMask(f.frames[i].pitchDeg), f.frames[i].fovDeg];

test.skipIf(missing)("launchroad checks its arguments, and picks the road record's +20 film forward, +24 back", async () => {
  const { sett, m, call, fails } = await lock1();
  const road = sett.roads.find((r) => r.name === "Road22")!;
  const [fwd, back] = road.ends;
  expect(fwd && back && fwd !== back).toBe(true);
  expect(road.films).toEqual([fwd, back]);
  await fails("launchroad", "Road99", 1, 4).toMatchObject({ code: 0xa });
  await fails("launchroad", "Road22", "yes", 4).toMatchObject({ code: 0xe });
  await fails("launchroad", "Road22", 1, 0).toMatchObject({ code: 0xa });
  expect(m.walk).toBeNull();
  const walk = () => m.walk;
  await call("launchroad", "Road22", 0, 4);
  expect(walk()?.film).toBe(back);
  // n is held to 4..64 (0x439625)
  m.walk = null;
  await call("launchroad", "Road22", 1, 1);
  expect([walk()?.film, walk()?.road?.n]).toEqual([fwd, 4]);
  m.walk = null;
  await call("launchroad", "Road22", 1, 500);
  expect(walk()?.road?.n).toBe(64);
});

test.skipIf(missing)("a launched road shows frame k-1 at pass k, sends endroad n frames from the end, and stands you back where you were", async () => {
  const { sett, m, call, sent, step } = await lock1();
  const film = sett.roads.find((r) => r.name === "Road22")!.ends[0]!;
  const count = film.frames.length;
  expect(count).toBe(14);
  const before = { node: m.node, camera: m.camera(), angles: angles(m) };
  await call("launchroad", "Road22", 1, 4);
  // nothing is up yet, but the view is moving (0x4356d0) and no quad answers a click
  expect(m.view).toBe("moving");
  expect(m.camera()).toEqual(before.camera);
  expect(m.walk?.road).toEqual({ index: 0, n: 4, end: ROAD_NO_END, next: film });
  expect(m.quadAt(320, 240, 640, 480)).toBeNull();

  const shown: number[] = [];
  for (let k = 1; m.walk && k < 100; k++) {
    await step();
    if (!m.walk) break;
    shown.push(m.walk.frame);
    // the camera is the frame's own (0x435490)
    const f = film.frames[m.walk.frame];
    expect(m.camera()).toMatchObject({ x: f.x, y: f.y, z: f.z, heading: f.heading });
  }
  // passes 1..12 put up frames 0..11; pass 13 puts up frame 12 and arrives. The last frame never shows
  expect(shown).toEqual([...Array(count - 2).keys()]);
  // `sendtoscene (currentscene (), endroad ())` in the pass whose new index is count − n: pass 10, frame 9
  expect(sent).toEqual([{ pass: count - 4, to: "sendtoscene Node11", handler: "endroad", frame: count - 5 }]);
  // standing at the node the road never left, looking the way its next-to-last frame did
  expect([m.walk, m.node, m.sceneName, m.view]).toEqual([null, before.node, "Node11", "node"]);
  expect(angles(m)).toEqual(anglesOf(film, count - 2));
  expect(m.camera()).toMatchObject({ x: before.node!.x, y: before.node!.y, z: before.node!.z });
});

test.skipIf(missing)("a second launchroad queues its film: the first plays n more frames, then the second from its frame 0", async () => {
  const { sett, m, call, sent, step } = await lock1();
  const [fwd, back] = sett.roads.find((r) => r.name === "Road22")!.ends as [MazeFilm, MazeFilm];
  await call("launchroad", "Road22", 1, 64);
  const seen: [MazeFilm, number][] = [];
  const run = async (passes: number) => {
    for (let k = 0; k < passes && m.walk; k++) {
      await step();
      // the frame on screen, by the camera it gave (a switch has already put up the queued film)
      const cam = m.camera()!;
      const f = [fwd, back].find((x) => x.frames.some((fr) => fr.x === cam.x && fr.y === cam.y && fr.heading === cam.heading))!;
      if (m.walk) seen.push([f, f.frames.findIndex((fr) => fr.x === cam.x && fr.y === cam.y && fr.heading === cam.heading)]);
    }
  };
  await run(3);
  // 0x439646: n and the film, and the window's end the index plus n
  await call("launchroad", "Road22", 0, 4);
  expect(m.walk?.road).toMatchObject({ index: 3, n: 4, end: 7, next: back });
  await run(100);
  const names = seen.map(([f, i]) => `${f === fwd ? "f" : "b"}${i}`);
  // forward 0..5 (the pass reaching index end − 1 = 6 still shows forward's frame 5), then back 0..12
  expect(names).toEqual([
    ...[0, 1, 2, 3, 4, 5].map((i) => `f${i}`),
    ...[...Array(back.frames.length - 2).keys()].map((i) => `b${i}`),
  ]);
  // the forward film's endroad (index 14 − 64) never comes; the back one's does, at its index count − 4
  expect(sent.map((s) => [s.handler, s.frame])).toEqual([["endroad", back.frames.length - 5]]);
  expect([m.walk, m.sceneName]).toEqual([null, "Node11"]);
});

test.skipIf(missing)("currentscene drops a launched road, and an endroad that leaves the room ends the pass there", async () => {
  const { m, call, step, session } = await lock1();
  await call("launchroad", "Road22", 1, 4);
  await step();
  await call("currentscene", "Node11");
  expect([m.walk, m.view]).toEqual([null, "node"]);
  // an endroad handler that closes the room: the pass goes no further (0x432d85)
  await call("launchroad", "Road22", 1, 4);
  session.sendEvent = async () => {
    session.maze = null;
    return 0;
  };
  for (let k = 0; k < 10; k++) await step();
  expect(m.walk?.frame).toBe(9);
  expect(m.walk?.road?.index).toBe(10);
});

// ---- true-3D pictures --------------------------------------------------------

/** a room with one node at the origin, looking along heading 0 (+x) */
function camera(): WorldCamera {
  const sett: SettFile = {
    file: { containers: [] } as never,
    name: "test", mainScript: 0,
    nodes: [{ name: "Scene1", id: 1, node: 1, sphere: 0, script: 0, x: 0, y: 0, z: 0 }],
    scenes: [], roads: [], quads: [], stars: [], routes: [], first: "Scene1", far: 1350000,
  };
  const m = new MazeRuntime(sett, { instanceFrom: () => null, clock: { now: 0 } } as never);
  m.node = sett.nodes[0];
  const v5 = m.spriteCamera(640, 480)!;
  return { x: 0, y: 0, z: 0, deg: 0, f: 0, cx: 320, cy: 240, clipW: 640, clipH: 480, v5 };
}

const frame: ShpFrame = {
  width: 40, height: 60, posXraw: 20, posYraw: 60,
  indexed: new Uint8Array(40 * 60).fill(1), opaque: new Uint8Array(40 * 60).fill(1),
};
const pose = (over: Partial<CardPose>): CardPose => ({
  worldX: 500000, worldY: 0, worldZ: 0, deg: 0, pitch: 0, roll: 0, facer: false, flip: 0, scale: 1000000, ...over,
});
/** where the frame's pixel (u, v) lands on the screen */
const at = (p: CardPose, u: number, v: number) => {
  const cam = camera();
  const c = cardOf(frame, p, cam, cam.v5!);
  return cam.v5!.project(c.o[0] + c.r[0] * u + c.d[0] * v, c.o[1] + c.r[1] * u + c.d[1] * v, c.o[2] + c.r[2] * u + c.d[2] * v)!;
};

test("a true-3D picture at heading H is square to a camera looking along H, as 0x456540's matrix has it", () => {
  // heading 0, seen by the camera looking along heading 0: right runs right, down runs down
  const p = pose({});
  expect(at(p, 40, 0).x).toBeGreaterThan(at(p, 0, 0).x);
  expect(at(p, 0, 60).y).toBeGreaterThan(at(p, 0, 0).y);
  // the hot spot (20, 60) is the point it stands on
  expect(at(p, 20, 60)).toMatchObject({ x: 320, y: 240 });
  // turned half round, it is seen from behind: mirrored
  expect(at(pose({ deg: TURN / 2 }), 40, 0).x).toBeLessThan(at(pose({ deg: TURN / 2 }), 0, 0).x);
  // a facer takes the bearing from the camera to it, so wherever it stands it reads the right way round
  for (const [x, y] of [[500000, 300000], [400000, -350000]]) {
    const f = pose({ worldX: x, worldY: y, deg: TURN / 2, facer: true });
    expect(at(f, 40, 0).x).toBeGreaterThan(at(f, 0, 0).x);
    const cam = camera();
    const c = cardOf(frame, f, cam, cam.v5!);
    expect(Math.abs(c.n[0] * y - c.n[1] * x)).toBeLessThan(1e-6 * Math.hypot(x, y)); // normal along the line of sight
  }
  // propflip / actorflip bit 1 turns it half round, bit 2 the pitch (0x42cc3b, 0x42cc5c)
  expect(at(pose({ flip: 1 }), 40, 0).x).toBeLessThan(at(pose({ flip: 1 }), 0, 0).x);
  expect(at(pose({ flip: 2 }), 0, 60).y).toBeLessThan(at(pose({ flip: 2 }), 0, 0).y);
});

test("a roll turns the picture's right toward its up: a quarter stands it on its right side", () => {
  const p = pose({ roll: TURN / 4 });
  const o = at(p, 20, 60);
  expect(o).toMatchObject({ x: 320, y: 240 });
  // right (u) now runs up the screen, and down (v) runs right
  const r = at(p, 40, 60);
  const d = at(p, 20, 0);
  expect(r.y).toBeLessThan(o.y);
  expect(Math.abs(r.x - o.x)).toBeLessThanOrEqual(1);
  expect(d.x).toBeLessThan(o.x);
  // an eighth: up and to the right
  const e = pose({ roll: TURN / 8 });
  expect(at(e, 40, 60).x).toBeGreaterThan(at(e, 20, 60).x);
  expect(at(e, 40, 60).y).toBeLessThan(at(e, 20, 60).y);
});

test("a true-3D actor is drawn as a prop's card, and only a true-3D one", () => {
  const session = new GameSession(() => null, new NullAudioSink());
  session.isV5 = true;
  const rt = session.actorRuntime;
  const a = new ActorInstance({ name: "nick", poses: [] } as never, { name: "nick.cast", members: [] } as never);
  Object.assign(a, { name: "nick", visible: true, worldSpace: true, worldX: 500000, worldY: 0, worldZ: 0, scale: 1000000 });
  (rt as unknown as { actors: Map<string, ActorInstance> }).actors.set("nick", a);
  (rt as unknown as { frameFor: () => ShpFrame }).frameFor = () => frame;
  const cam = camera();
  const draw = () => {
    const rgba = new Uint8ClampedArray(640 * 480 * 4);
    rt.composite(rgba, 640, 480, new Uint8ClampedArray(256 * 4).fill(255), cam);
    const lit: number[] = [];
    for (let i = 0; i < 640 * 480; i++) if (rgba[i * 4] || rgba[i * 4 + 1] || rgba[i * 4 + 2]) lit.push(i);
    return lit;
  };
  expect(rt.card(a, cam)).toBeNull();
  const sprite = draw();
  expect(sprite.length).toBeGreaterThan(0);
  a.true3d = true;
  const card = rt.card(a, cam)!;
  expect(card).not.toBeNull();
  // a facer square in front of the camera at the sprite's own size: the same pixels, give or take its edges
  const flat = draw();
  const same = flat.filter((i) => sprite.includes(i)).length;
  expect(same / sprite.length).toBeGreaterThan(0.9);
  expect(rt.covers(a, 320, 230, cam)).toBe(true);
  expect(rt.actorAt(320, 230, cam)).toBe(a);
  // not a facer, turned a quarter: edge-on to the camera, so next to nothing is drawn or hit
  Object.assign(a, { facer: false, deg: TURN / 4 });
  expect(draw().length).toBeLessThan(sprite.length / 10);
  // pitched a quarter it lies flat, below the eye: seen edge-on too
  Object.assign(a, { deg: 0, pitch: TURN / 4 });
  expect(draw().length).toBeLessThan(sprite.length / 10);
  // and a camera that cannot see true 3D (any other engine) draws the sprite whatever the flag
  expect(rt.card(a, { ...cam, v5: undefined })).toBeNull();
});
