/**
 * DreamFactory 5's room commands (engine/src/runtime/builtins/maze.ts) and the
 * room they act on (engine/src/runtime/maze.ts): the camera, the exits and
 * their walks, scenes and their views, the quads' events, sysparam, and the
 * v4 commands a v5 room answers in its own units — against a room built here.
 *
 *   npx vitest run engine/tests/maze-builtins.ts
 *
 * Needs no game data.
 */
import { expect, test } from "vitest";
import { compileScript } from "@dreamfactory/engine/df/script-asm";
import { MazeFilm, MazeFilmFrame, SettFile, TURN } from "@dreamfactory/engine/df/sett";
import { NullAudioSink } from "@dreamfactory/engine/runtime/audio";
import type { Value } from "@dreamfactory/engine/runtime/interp";
import { MazeRuntime, simpleToDeg } from "@dreamfactory/engine/runtime/maze";
import { packPoint } from "@dreamfactory/engine/runtime/point";
import { GameSession } from "@dreamfactory/engine/runtime/session";

const frame = (headDeg: number, over: Partial<MazeFilmFrame> = {}): MazeFilmFrame => ({
  picture: 0, x: 1, y: 2, z: 3, heading: 0, pitch: 0, roll: 0, fov: 1,
  headDeg, pitchDeg: 5, rollDeg: 0, fovDeg: 7, view: -1, ...over,
});
const film = (container: number, to: number, frames: MazeFilmFrame[], toScene = 0): MazeFilm =>
  ({ container, to, toScene, frames });

/** a room of two nodes joined by a road, a scene of two views, and a quad; scripts log what they hear */
function room() {
  const log: string[] = [];
  const script = (name: string, extra = "") => compileScript(`code openscene ()
\tlogit ("${name} open")
endcode

code closescene ()
\tlogit ("${name} close")
endcode
${extra}`);
  const containers = [
    { data: new Uint8Array(0) },
    { data: script("main", `
code click ()
\tlogit ("main click")
endcode
`) },
    { data: script("n1") },
    { data: script("n2") },
    { data: script("hall") },
    { data: compileScript(`code click ()
\tlogit ("door click")
\tpasscode
endcode

code poke ()
\tlogit ("door poke")
endcode
`) },
  ];
  const ahead = film(20, 0, [frame(simpleToDeg(90)), frame(simpleToDeg(91))]);
  const sett: SettFile = {
    file: { containers } as never,
    name: "test",
    mainScript: 1,
    nodes: [
      { name: "Node1", id: 1, node: 11, sphere: 0, script: 2, x: 10, y: 20, z: 30 },
      { name: "Node2", id: 2, node: 12, sphere: 0, script: 3, x: 40, y: 50, z: 60 },
      { name: "Lonely", id: 3, node: 13, sphere: 0, script: 0, x: 0, y: 0, z: 0 },
    ],
    scenes: [{
      name: "Hall", scen: 30, script: 4, x: 7, y: 8, z: 9,
      films: [film(31, 0, [frame(0, { view: 0 }), frame(simpleToDeg(180), { view: 1 })])],
      views: [
        { name: "North", id: 1, road: ahead, heading: 0 },
        { name: "South", id: 2, road: null, heading: simpleToDeg(180) },
      ],
    }, { name: "Bare", scen: 32, script: 0, x: 0, y: 0, z: 0, films: [], views: [] }],
    roads: [{
      name: "r", a: 1, b: 2, road: 40,
      films: [
        film(41, 12, [frame(simpleToDeg(45)), frame(simpleToDeg(46))]),
        film(42, 11, [frame(simpleToDeg(225))]),
        film(43, 12, []),
      ],
      ends: [null, null],
    }],
    quads: [{ name: "Door", script: 5, x: 0, y: 0, z: 500000, heading: 0, pitch: 0, w: 200000, h: 200000 } as never],
    stars: [],
    routes: [],
    first: "Node1",
    far: 1350000,
  };
  const session = new GameSession(() => null, new NullAudioSink());
  session.isV5 = true;
  session.interp.register("logit", (_i, [s]) => void log.push(String(s)));
  const m = new MazeRuntime(sett, session);
  session.maze = m;
  const call = (name: string, ...args: Value[]) =>
    session.interp.builtins.get(name)!(session.interp, args, {} as never, undefined as never);
  return { session, m, log, call };
}

test("with no room open every room command answers 0", async () => {
  const session = new GameSession(() => null, new NullAudioSink());
  session.isV5 = true;
  const call = (name: string, ...args: Value[]) =>
    session.interp.builtins.get(name)!(session.interp, args, {} as never, undefined as never);
  for (const cmd of ["camerapitch", "camerafov", "countexits", "indextoexit", "nearexit", "nodescroll", "pointinquad", "roadahead"]) {
    expect(await call(cmd)).toBe(0);
  }
  expect(await call("launchexit", "x", 1)).toBeUndefined();
  expect(await call("nodequality", 0, 8)).toBe(0);
  expect(await call("quadscript")).toBe(0);
  // cameraxyz and scenexyz fall back to the v4 commands, which have no set
  expect(await call("cameraxyz", 1)).toBe(0);
  expect(await call("scenexyz", "x", 1)).toBe(0);
});

test("the angle helpers take a missing argument as 0", async () => {
  const { call } = room();
  expect(await call("simpletodeg")).toBe(0);
  expect(await call("degtosimple")).toBe(0);
  expect(await call("degmask")).toBe(0);
  expect(await call("degmask", -1)).toBe(TURN - 1);
  expect(await call("degdiff")).toBe(0);
  expect(await call("calcturn")).toBe(0);
  expect(await call("simpletodeg", 90)).toBe(TURN / 4);
});

test("the camera at a node: pitch, fov, scroll, and where it is", async () => {
  const { m, call } = room();
  expect(await call("cameraxyz", 1)).toBe(0); // nowhere yet: the v4 command
  await m.enterNode("");
  expect(m.sceneName).toBe("Node1");
  await call("camerapitch", 100);
  expect(await call("camerapitch")).toBe(100);
  await call("camerafov", simpleToDeg(60));
  expect(await call("camerafov")).toBe(simpleToDeg(60));
  // a step of 0 (or none) never moves
  expect(await call("nodescroll")).toBe(0);
  expect(await call("nodescroll", 0, 0, m.fov, 10)).toBe(1);
  expect(await call("camerapitch")).toBe(90);
  expect(await call("cameraxyz")).toBe(10);
  expect(await call("playerxyz", 2)).toBe(20);
  expect(await call("cameraxyz", 3)).toBe(30);
  expect(await call("cameraxyz", 4)).toBe(packPoint(10, 20));
  expect(await call("cameraxyz", 5)).toBe(0);
  expect(await call("scenexyz", "node2", 2)).toBe(50);
  expect(await call("scenexyz", "hall")).toBe(7);
  expect(await call("scenexyz", "nowhere", 1)).toBe(0);
  expect(await call("scenexyz")).toBe(0);
});

test("exits: count, the view each starts on, the nearest, and a walk along one", async () => {
  const { m, log, call } = room();
  await m.enterNode("node1");
  expect(await call("countexits", "node1")).toBe(1);
  expect(await call("countexits")).toBe(0);
  expect(await call("indextoexit", "node1", 1, 1)).toBe(simpleToDeg(45));
  expect(await call("indextoexit", "node1", 1, 2)).toBe(5);
  expect(await call("indextoexit", "node1", 1, 3)).toBe(7);
  expect(await call("indextoexit", "node1", 1)).toBe(simpleToDeg(45));
  // exit 0, or one the node has not: the camera as it stands
  m.setHeading(123);
  m.setPitch(4);
  expect(await call("indextoexit", "node1", 0, 1)).toBe(123);
  expect(await call("indextoexit", "node1", 0, 2)).toBe(4);
  expect(await call("indextoexit", "node1", 0, 3)).toBe(m.fov);
  expect(await call("indextoexit")).toBe(123);
  expect(await call("nearexit", "node1", simpleToDeg(50))).toBe(1);
  expect(await call("nearexit", "lonely", 0)).toBe(0);
  expect(await call("nearexit")).toBe(0);

  await call("launchexit", "node1", 2);
  expect(m.walk).toBeNull();
  await call("launchexit");
  expect(m.walk).toBeNull();
  await call("launchexit", "node1", 1);
  expect(log).toEqual(["n1 open", "n1 close"]);
  expect(m.view).toBe("moving");
  expect(m.walkFrame()?.headDeg).toBe(simpleToDeg(45));
  // a second launch while walking does nothing
  await call("launchexit", "node1", 1);
  expect(m.walk?.frame).toBe(0);
});

test("a scene: its views, the road ahead, and leaving for another place", async () => {
  const { m, log, call } = room();
  await m.enterNode("Hall", "south");
  expect(m.view).toBe("south");
  expect(m.heading).toBe(simpleToDeg(180));
  expect(await call("roadahead", "hall", "NORTH")).toBe(20);
  expect(await call("roadahead", "hall", "south")).toBe(0);
  expect(await call("roadahead")).toBe(0);
  // a view nobody names: the nearest the camera's heading
  m.heading = simpleToDeg(10);
  await m.enterNode("hall", "west");
  expect(m.view).toBe("north");
  // the camera on film: the frame's own place
  expect(await call("cameraxyz", 1)).toBe(1);
  // the same scene again is nothing; an unknown one is logged
  await m.setScene("HALL");
  const lines: string[] = [];
  m.onLog = (l) => lines.push(l);
  await m.setScene("attic");
  expect(lines).toEqual(['test: no node or scene "attic"']);
  expect(await m.enterNode("attic")).toBe(false);
  await m.setScene("node2");
  expect(log.slice(-2)).toEqual(["hall close", "n2 open"]);
  expect(m.sceneName).toBe("Node2");
  await m.closeSet();
  expect(log.at(-1)).toBe("n2 close");
});

test("pointinquad and quad events along the chain", async () => {
  const { m, log, call } = room();
  await m.enterNode("node1");
  m.setHeading(0);
  m.setPitch(0);
  m.setFov(TURN / 4);
  expect(await call("pointinquad", "door", packPoint(320, 240))).toBe(1);
  expect(await call("pointinquad", "DOOR", packPoint(0, 0))).toBe(0);
  expect(await call("pointinquad", "window", packPoint(320, 240))).toBe(0);
  expect(await call("pointinquad")).toBe(0);
  // the quad passes its click on to the node (which has none) and the set
  expect(await m.quadEvent("door", "click", [])).toBe(true);
  expect(log.slice(-2)).toEqual(["door click", "main click"]);
  expect(await m.quadEvent("door", "poke", [])).toBe(true);
  expect(await m.quadEvent("door", "nothing", [])).toBe(false);
  // another room open: this one's scripts hear nothing
  const other = new MazeRuntime({ ...m.sett, mainScript: 0, nodes: [], scenes: [], quads: [] }, m.session);
  m.session.maze = other;
  expect(await m.quadEvent("door", "click", [])).toBe(false);
});

test("nodequality keeps a new detail and says so; sysparam answers the button and the depth", async () => {
  const { session, m, call } = room();
  let changes = 0;
  m.onChange = () => void changes++;
  await call("nodequality", 0, 8);
  expect([m.detail, changes]).toEqual([8, 1]);
  await call("nodequality", 0, 8);
  await call("nodequality");
  expect(changes).toBe(1);
  session.pointerButton = 2;
  expect(await call("sysparam", 7)).toBe(2);
  expect(await call("sysparam", 10)).toBe(32);
  expect(await call("sysparam")).toBe(0);
  // v5's sysparam id is v4's propspeed
  expect(await call("propspeed", 10)).toBe(32);
  expect(await call("propspeed")).toBe(0);
});

test("a bare scene stands nowhere on film; a turn the scene has no film for does nothing", async () => {
  const { m, log } = room();
  // closing a room before standing anywhere runs only the set's closeset
  await m.closeSet();
  expect(log).toEqual([]);
  await m.enterNode("hall", "north");
  // only a clockwise film: "left" hears closescene and goes nowhere
  await m.move("left");
  expect(log.at(-1)).toBe("hall close");
  expect(m.walk).toBeNull();
  await m.move("right");
  expect(m.walk?.turn).toBe(true);
  // a launched road ends where the camera stands next
  m.walk = null;
  m.launchRoad(m.sett.roads[0].films[0], 8);
  const walking = (): MazeRuntime["walk"] => m.walk;
  expect(walking()?.road).toBeDefined();
  expect(m.walkFrame()).toBeNull();
  await m.enterNode("bare");
  expect([m.walk, m.shot, m.view]).toEqual([null, null, ""]);
  expect(m.camera()).toBeNull();
  // a walk on a frame past its film shows nothing
  m.walk = { film: m.sett.roads[0].films[0], frame: 9 };
  expect(m.walkFrame()).toBeNull();
});
