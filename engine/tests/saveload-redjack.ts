/**
 * RedJack's save and load through a running session
 * (engine/src/runtime/saveload-v5.ts), on a cast and a shop built here: what a
 * snapshot writes for array globals and booleans, and what a load does with a
 * file whose handles name nothing, whose instanced characters and props have
 * no source left, and whose shading names a light group that does not exist.
 *
 *   npx vitest run engine/tests/saveload-redjack.ts
 *
 * No game files: the game's own round trips are redjack/tests/machine/saves.ts.
 */
import { expect, test } from "vitest";
import { writeContainerFile } from "@dreamfactory/engine/df/container";
import { buildCstFile } from "@dreamfactory/engine/df/cst-build";
import { buildShpBytes } from "@dreamfactory/engine/df/shp-build";
import type { ShpFrame } from "@dreamfactory/engine/df/shp";
import { readSaveV5, writeSaveV5 } from "@dreamfactory/engine/df/savegame-v5";
import { NullAudioSink } from "@dreamfactory/engine/runtime/audio";
import { GameSession } from "@dreamfactory/engine/runtime/session";
import { loadGameV5, snapshotSaveV5 } from "@dreamfactory/engine/runtime/saveload-v5";

const dot: ShpFrame = { width: 1, height: 1, posXraw: 0, posYraw: 0, indexed: new Uint8Array([1]), opaque: new Uint8Array([1]) };
const dirs = () => Array.from({ length: 8 }, () => dot);

const CAST = writeContainerFile(buildCstFile({
  palette: [0, 0, 0, 255, 255, 255],
  members: [
    { name: "nick", poses: [{ name: "stand", steps: [dirs()] }] },
    { name: "anne", poses: [{ name: "stand", steps: [dirs()] }] },
  ],
}).file);
const SHOP = buildShpBytes({
  palette: [0, 0, 0, 255, 255, 255],
  groups: [
    { name: "torch", states: [{ identifier: "lit", frames: [{ art: dot }, { art: dot }] }] },
    { name: "rope", states: [{ identifier: "coil", frames: [{ art: dot }] }] },
  ],
});

async function session() {
  const files: Record<string, Uint8Array> = { "crew.cast": CAST, "beach.shop": SHOP };
  const s = new GameSession((n) => files[n.toLowerCase()] ?? null, new NullAudioSink());
  s.isV5 = true;
  await s.openCastFile("crew.cast");
  await s.openShop("beach.shop");
  const logs: string[] = [];
  s.onLog = (l) => void logs.push(l);
  return { s, logs };
}

test("a snapshot keeps numbers and strings, array elements with their size, and leaves booleans out", async () => {
  const { s } = await session();
  s.interp.globals.set("day", 4);
  s.interp.globals.set("setloc", "rjbeach");
  s.interp.globals.set("flag", true);
  s.interp.globals.set(s.interp.elementKey("jrep", 3), 7);
  s.interp.globals.set(s.interp.elementKey("jrep", 1), 2);
  const save = readSaveV5(snapshotSaveV5(s)!);
  const g = (name: string) => save.globals.filter((x) => x.name.toLowerCase() === name);
  expect(g("day")).toEqual([{ name: "day", value: 4, arraySize: 0, index: 0 }]);
  expect(g("setloc")[0].value).toBe("rjbeach");
  expect(g("flag")).toEqual([]);
  expect(g("jrep").map((x) => [x.value, x.arraySize, x.index])).toEqual([[7, 4, 3], [2, 4, 1]]);
});

test("a load re-makes instanced characters and props from their sources, and drops those with none", async () => {
  const { s: from } = await session();
  from.actorRuntime.instance("anne", "anne2");
  from.propRuntime.instance("rope", "rope2", true);
  const save = readSaveV5(snapshotSaveV5(from)!);
  // a character and a prop whose member is in no reopened file
  save.actors.push({ ...save.actors[0], name: "ghost", member: 999 });
  save.props.push({ ...save.props[0], name: "phantom", member: 999 });
  // an empty pose, and a light group past the table's end
  save.actors[0] = { ...save.actors[0], pose: "", litby: 99 };
  // a prop shown in the world, and the save's own frame rate unset
  save.props[0] = { ...save.props[0], is3d: true, x: 11, y: 22, z: 33 };
  save.runt.framerate = 0;
  // a cast and a shop named by a handle the manifest does not have: opened by their own names
  save.casts[0].handle = 77;
  save.casts[0].name = "crew.cast";
  save.shops[0].handle = 78;
  save.shops[0].name = "beach.shop";
  const bytes = writeSaveV5(save);

  const { s, logs } = await session();
  s.frameRate = 5;
  expect(await loadGameV5(s, bytes)).toBe(true);
  expect(s.frameRate).toBe(5);
  expect(s.actorRuntime.get("anne2")).toBeTruthy();
  expect(s.propRuntime.get("rope2")).toBeTruthy();
  expect(logs).toContain('opengame: no cast member to make "ghost" from — dropped');
  expect(logs).toContain('opengame: no prop "phantom" in the reopened shops — dropped');
  const first = s.actorRuntime.get(save.actors[0].name)!;
  expect([first.poseName, first.litby]).toEqual(["stand", 0]);
  const p = s.propRuntime.get(save.props[0].name)!;
  expect([p.worldSpace, p.worldX, p.worldY, p.worldZ]).toEqual([true, 11, 22, 33]);
});

test("a save with a room and a stage open asks for them by name when their handles name nothing", async () => {
  const { s: from } = await session();
  const save = readSaveV5(snapshotSaveV5(from)!);
  save.runt = { ...save.runt, setOpen: true, setHandle: 0, setName: "rjfort", scene: "Scene3", view: "node", stageOpen: true, stageHandle: 0, stageName: "inv.stag" };
  const { s, logs } = await session();
  expect(await loadGameV5(s, writeSaveV5(save))).toBe(true);
  expect(logs[0]).toBe("opengame: rjfort at Scene3, stage inv.stag; 2 actors, 2 props");
  expect(logs).toContain('opensetfile("rjfort.sett", "Scene3", "")');
  // and a view that is not the node one is asked for as it is
  save.runt.view = "north";
  logs.length = 0;
  expect(await loadGameV5(s, writeSaveV5(save))).toBe(true);
  expect(logs).toContain('opensetfile("rjfort.sett", "Scene3", "north")');
});

test("a save with nothing open names no room", async () => {
  const { s: from } = await session();
  const save = readSaveV5(snapshotSaveV5(from)!);
  const { s, logs } = await session();
  expect(await loadGameV5(s, writeSaveV5(save))).toBe(true);
  expect(logs[0]).toBe("opengame: no room at ?; 2 actors, 2 props");
});
