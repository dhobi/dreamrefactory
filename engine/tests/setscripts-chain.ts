/**
 * A set's scripts bound to a session (engine/src/runtime/setscripts.ts): what
 * `fire` answers, the lifecycle chains and how a script error (the script's
 * own) or a host failure (any other throw) ends them or not, closing a set
 * DreamFactory 1's way round and when a handler leaves the set mid-close, a
 * hotspot's or a key's chain with no scene, a painting that is not there, and
 * finding a script by its owner's name.
 *
 *   npx vitest run engine/tests/setscripts-chain.ts
 *
 * No game: the room is built (df/set-build.ts) and its scripts compiled. Each
 * handler leaves a mark by asking for a set (`opensetfile`), which reaches the
 * host's `onSetChange`: that is what the tests read, and what fails ("gone")
 * or moves to another set ("away") when they want it to.
 */
import { expect, test } from "vitest";
import { writeContainerFile } from "@dreamfactory/engine/df/container";
import { compileScript } from "@dreamfactory/engine/df/script-asm";
import { readSetFile, type SetFile } from "@dreamfactory/engine/df/set";
import { STANDPOINT, buildSetFile, type SetBuildScene } from "@dreamfactory/engine/df/set-build";
import { NullAudioSink } from "@dreamfactory/engine/runtime/audio";
import { GameSession } from "@dreamfactory/engine/runtime/session";
import { SetScripts } from "@dreamfactory/engine/runtime/setscripts";

/** handler name → its body lines */
type Handlers = Record<string, string[]>;
const script = (h: Handlers): Uint8Array =>
  compileScript(Object.entries(h).map(([name, body]) => [`code ${name} ()`, "\tlocal x", ...body.map((l) => `\t${l}`), "endcode"].join("\n")).join("\n") + "\n");
/** a mark the host sees */
const mark = (tag: string): string => `opensetfile ("${tag}")`;
/** a script error: a statement-only command asked for its value (error 1) */
const SCRIPT_ERROR = "x = puppetclear ()";
/** a failure that is not the script's: the host's set change throws */
const HOST_ERROR = mark("gone");

const art = { pixels: new Uint8Array(8).fill(1) };
const scene = (name: string, script?: Uint8Array, hotspotScript?: Uint8Array): SetBuildScene => ({
  name,
  position: [0, 0, 0],
  mapPoint: [0, 0, 0],
  views: [
    {
      name: "north",
      rotation: 0,
      rot8: 0,
      id: name === "hall" ? 0 : 1,
      hotspots: [{ id: "door", top: 0, left: 0, bottom: 1, right: 1, script: hotspotScript }],
    },
  ],
  right: { destinationScene: 0, frames: [{ art, motion: STANDPOINT, viewID: 0, deg: 0 }] },
  left: { destinationScene: 0, frames: [{ art, motion: STANDPOINT, viewID: 0, deg: 0 }] },
  script,
});

function room(main: Handlers, hall: Handlers = {}, door: Handlers = {}): SetFile {
  const { file } = buildSetFile({
    palette: [0, 0, 0],
    name: "Room",
    viewWidth: 4,
    viewHeight: 2,
    scenes: [scene("hall", script(hall), script(door)), scene("yard")],
    actors: [{ name: "anne", rotation8: 0, position: [0, 0, 0] }],
    main: script(main),
  });
  return readSetFile(writeContainerFile(file));
}

/** a session with `set` bound; `boot` handlers become its one boot script */
function bind(set: SetFile, boot?: Handlers, v1 = false) {
  const s = new GameSession(() => null, new NullAudioSink());
  const log: string[] = [];
  const marks: string[] = [];
  s.onLog = () => {};
  if (v1) s.dfVersion = 1;
  if (boot) s.bootScripts = [s.instanceFrom(script(boot), "boot")!];
  const away = room({});
  const bound: SetScripts[] = [];
  s.onSetChange = (file) => {
    const name = file.replace(/\.set$/, "");
    marks.push(name);
    if (name === "gone") throw new Error("the disc is gone");
    if (name === "away") bound.push(new SetScripts(away, s));
  };
  const b = new SetScripts(set, s);
  b.onLog = (l) => log.push(l);
  return { s, b, log, marks, bound };
}

test("fire answers a handler's value; a pass, a missing handler, an error or no script answers nothing", async () => {
  const { b, log } = bind(room({ ask: ["return (6)"], pass: ["passcode"], bad: [SCRIPT_ERROR] }));
  expect(await b.fire(b.main, "ask", [])).toBe(6);
  expect(await b.fire(b.main, "pass", [])).toBeNull();
  expect(await b.fire(b.main, "nothing", [])).toBeNull();
  expect(await b.fire(null, "ask", [])).toBeNull();
  expect(await b.fire(b.main, "bad", [])).toBeNull();
  expect(log).toEqual([expect.stringMatching(/^script error in Room\.bad: /)]);
});

test("a set with no name of its own is called by its file's", () => {
  const s = new GameSession(() => null, new NullAudioSink());
  s.currentSetFile = "nite";
  const b = new SetScripts({ ...room({}), setName: "" }, s);
  expect(s.currentBinding).toBe(b);
  expect(s.currentSetName).toBe("nite");
});

test("the lifecycle: a script error ends the chain and says so; a host failure is logged and the chain goes on", async () => {
  const boot = { openset: [mark("boot")], openscene: [mark("boot")] };
  const failed = bind(room({ openset: [SCRIPT_ERROR] }), boot);
  expect(await failed.b.openSet()).toBe(false);
  expect(failed.marks).toEqual([]);
  const host = bind(room({ openset: [HOST_ERROR] }), boot);
  expect(await host.b.openSet()).toBe(true);
  expect(host.marks).toEqual(["gone", "boot"]);
  expect(host.log).toEqual(["script error in Room.openset: the disc is gone"]);
});

test("DreamFactory 1 closes the set before its scene, and not the scene once closeset has left the set", async () => {
  const close = { closescene: [mark("hall")] };
  const v1 = bind(room({ closeset: [mark("main")] }, close), undefined, true);
  await v1.b.openScene(0);
  await v1.b.closeSet();
  expect(v1.marks).toEqual(["main", "hall"]);
  // no scene open: only the set
  v1.marks.length = 0;
  await v1.b.closeSet();
  expect(v1.marks).toEqual(["main"]);
  const left = bind(room({ closeset: [mark("away")] }, close), undefined, true);
  await left.b.openScene(0);
  await left.b.closeSet();
  expect(left.marks).toEqual(["away"]);
  expect(left.s.currentBinding).toBe(left.bound[0]);
});

test("the others close the scene first, and not the set once closescene has left it", async () => {
  const left = bind(room({ closeset: [mark("main")] }, { closescene: [mark("away")] }));
  await left.b.openScene(0);
  await left.b.closeSet();
  expect(left.marks).toEqual(["away"]);
  expect(left.s.currentBinding).toBe(left.bound[0]);
});

test("a jump's lifecycle: boot's closescene, then openscene from the scene on; errors in either", async () => {
  const set = room({ openscene: [mark("main")] }, { openscene: [mark("hall"), "passcode"] });
  const ok = bind(set, { closescene: [HOST_ERROR] });
  await ok.b.viewChanged(0);
  expect(ok.marks).toEqual(["gone", "hall", "main"]);
  expect(ok.log).toEqual(["script error in boot.closescene: the disc is gone"]);
  // no scene given: from the set main on
  ok.marks.length = 0;
  await ok.b.viewSettled();
  expect(ok.marks).toEqual(["main"]);
  const stopped = bind(set, { closescene: [SCRIPT_ERROR] });
  await stopped.b.viewChanged(0);
  expect(stopped.marks).toEqual([]);
  // the arrival alone, with the scene's openscene failing each way
  const scriptFail = bind(room({ openscene: [mark("main")] }, { openscene: [SCRIPT_ERROR] }));
  await scriptFail.b.viewSettled(0);
  expect(scriptFail.marks).toEqual([]);
  const hostFail = bind(room({ openscene: [mark("main")] }, { openscene: [HOST_ERROR] }));
  await hostFail.b.viewSettled(0);
  expect(hostFail.marks).toEqual(["gone", "main"]);
  expect(hostFail.log).toEqual(["script error in hall.openscene (view change): the disc is gone"]);
});

test("a click: errors in the hotspot's script, a scene that is not there, a painting that is not there", async () => {
  const clicks: { scene: string; view: string; consumed: boolean }[] = [];
  const watch = (s: GameSession) => (s.onHotspotClick = (c) => void clicks.push({ scene: c.scene, view: c.view, consumed: c.consumed }));
  const scriptFail = bind(room({ mousedown: [mark("main")] }, {}, { mousedown: [SCRIPT_ERROR] }));
  watch(scriptFail.s);
  expect(await scriptFail.b.mouseDown(0, 0, 0, "door")).toBe(true);
  expect(scriptFail.marks).toEqual([]);
  const hostFail = bind(room({ mousedown: [mark("main"), "passcode"] }, {}, { mousedown: [HOST_ERROR] }));
  watch(hostFail.s);
  expect(await hostFail.b.mouseDown(0, 0, 0, "door")).toBe(false);
  expect(hostFail.marks).toEqual(["gone", "main"]);
  // a click in no scene of the set: the main hears it, the hook gets no names
  expect(await hostFail.b.mouseDown(7, 0, 0, "door")).toBe(false);
  expect(clicks).toEqual([
    { scene: "hall", view: "north", consumed: true },
    { scene: "hall", view: "north", consumed: false },
    { scene: "", view: "", consumed: false },
  ]);
  for (const [scene, view, paint] of [
    ["cellar", "north", "door"],
    ["hall", "south", "door"],
    ["hall", "north", "window"],
  ]) {
    expect(await hostFail.b.paintingEvent(scene, view, paint, "mousedown", [])).toBe(false);
  }
});

test("a key with no boot router goes to the scene and the set; errors in it, and a scene with no script", async () => {
  const keys: { scene: string; consumed: boolean }[] = [];
  const set = (hall: Handlers) => room({ keydown: [mark("main"), "exitcode"] }, hall);
  const plain = bind(set({ keydown: [mark("hall")] }));
  plain.s.onSetKey = (k) => void keys.push({ scene: k.scene, consumed: k.consumed });
  expect(await plain.b.keyDown(0, "left")).toBe(true);
  expect(plain.marks).toEqual(["hall", "main"]);
  // the yard has no script, and scene 7 is no scene: the set main alone
  expect(await plain.b.keyDown(1, "left")).toBe(true);
  expect(await plain.b.keyDown(7, "left")).toBe(true);
  const scriptFail = bind(set({ keydown: [SCRIPT_ERROR] }));
  scriptFail.s.onSetKey = (k) => void keys.push({ scene: k.scene, consumed: k.consumed });
  expect(await scriptFail.b.keyDown(0, "left")).toBe(true);
  expect(scriptFail.marks).toEqual([]);
  const hostFail = bind(set({ keydown: [HOST_ERROR] }));
  expect(await hostFail.b.keyDown(0, "left")).toBe(true);
  expect(hostFail.marks).toEqual(["gone", "main"]);
  expect(keys).toEqual([
    { scene: "hall", consumed: true },
    { scene: "yard", consumed: true },
    { scene: "", consumed: true },
    { scene: "hall", consumed: true },
  ]);
});

test("a script is found by its owner's name: the set, a scene, a hotspot", () => {
  const { b } = bind(room({ a: ["return (1)"] }, { a: ["return (1)"] }, { a: ["return (1)"] }));
  expect(b.findInstance("ROOM")).toBe(b.main);
  expect(b.findInstance("Hall")?.name).toBe("hall");
  expect(b.findInstance("door")).toBe(b.objectScript(0, 0, 0));
  expect(b.findInstance("nobody")).toBeNull();
});
