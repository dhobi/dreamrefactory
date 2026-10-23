/**
 * DreamFactory 5's SETT reader on rooms laid out here (engine/src/df/sett.ts):
 * the two chunks a room cannot do without; MAPR records that point at the
 * wrong kind of chunk, or at nothing; tables that claim more records than
 * their chunk holds; a film frame too short for its view word; a star pair
 * whose route is not a DRIV; and a sphere chunk cut short.
 *
 *   npx vitest run engine/tests/sett-reader.ts
 *
 * engine/tests/df5-room.ts reads every shipped room.
 */
import { expect, test } from "vitest";
import { ContainerBuilder, i16, i32 } from "@dreamfactory/engine/df/build";
import { isSett, readSettFile, readSphere } from "@dreamfactory/engine/df/sett";
import { pstr } from "./helpers/save-fixtures";

function chunk(tag: string, size: number): Uint8Array {
  const d = new Uint8Array(size);
  [...tag].reverse().forEach((c, i) => (d[4 + i] = c.charCodeAt(0)));
  return d;
}

/** MAPR record `i`: kind at +2, x y z, the chunk it names at +16, two more refs at +20/+24, name at +32 */
function mapRecord(mapr: Uint8Array, i: number, kind: number, ref: number, name: string, refs: [number, number] = [0, 0]): void {
  const r = 0x2c + i * 64;
  i16(mapr, r + 2, kind);
  i32(mapr, r + 4, 10 * (i + 1));
  i32(mapr, r + 16, ref);
  i32(mapr, r + 20, refs[0]);
  i32(mapr, r + 24, refs[1]);
  pstr(mapr, r + 32, name);
}

function room(): Uint8Array {
  const b = new ContainerBuilder();
  const maze = b.reserve(0x120).data;
  [..."MAZE"].reverse().forEach((c, i) => (maze[4 + i] = c.charCodeAt(0)));
  pstr(maze, 0x74, "fort");
  i32(maze, 0x68, 1);
  // MAPR: four scenes, two nodes, two roads (counted at 0x10/0x14/0x18), with room for seven
  const mapr = chunk("MAPR", 0x2c + 7 * 64);
  i32(mapr, 0x10, 4);
  i32(mapr, 0x14, 2);
  i32(mapr, 0x18, 2);
  b.add(mapr); // 1
  const scen = chunk("SCEN", 0x4c + 0x38 + 0x10);
  i32(scen, 0x48, 2); // two views, room for one
  i32(scen, 0x4c + 0x20, 7);
  pstr(scen, 0x4c + 0x28, "north");
  b.add(scen); // 2
  const node = chunk("NODE", 0x40);
  i32(node, 0x30, 42);
  b.add(node); // 3
  const road = chunk("ROAD", 0x10);
  b.add(road); // 4
  // a film of three frames: the first whole, the second without its view word, the third cut off
  const cmov = chunk("CMOV", 0x2c + 112 + 100);
  i32(cmov, 0x1c, 3);
  i32(cmov, 0x14, 9);
  i32(cmov, 0x2c + 88, 5);
  i32(cmov, 0x2c + 100, 3);
  i32(cmov, 0x2c + 112 + 88, 6);
  b.add(cmov); // 5
  // stars: a pair whose route is a DRIV, a pair whose route is not, one past the chunk's end
  const mark = chunk("MARK", 0x20 + 2 * 0x42);
  i32(mark, 0x18, 3);
  pstr(mark, 0x20 + 0x12, "a1");
  i32(mark, 0x20 + 0x22, 7);
  pstr(mark, 0x20 + 0x32, "b1");
  pstr(mark, 0x20 + 0x42 + 0x12, "a2");
  i32(mark, 0x20 + 0x42 + 0x22, 2);
  pstr(mark, 0x20 + 0x42 + 0x32, "b2");
  b.add(mark); // 6
  const driv = chunk("DRIV", 0x34 + 16 + 8);
  i32(driv, 0x20, 2); // two points, room for one
  i32(driv, 0x34, 11);
  b.add(driv); // 7
  const bli3 = chunk("BLI3", 0x20 + 0x50);
  i32(bli3, 0x18, 2); // two quads, room for one
  pstr(bli3, 0x20 + 0x1c, "door");
  new DataView(bli3.buffer).setFloat64(0x20 + 0x38, 0.5, true); // a DF5 double is little-endian
  b.add(bli3); // 8
  const sphr = chunk("SPHR", 0x28 + 56 + 10);
  i32(sphr, 0x24, 2); // two patches, room for one
  i32(sphr, 0x28 + 32, 12);
  b.add(sphr); // 9

  mapRecord(mapr, 0, 1, 2, "Scene1", [5, 0]);
  mapRecord(mapr, 1, 1, 3, "notscene"); // names a NODE
  mapRecord(mapr, 2, 2, 3, "Node1");
  mapRecord(mapr, 3, 2, 2, "notnode"); // names a SCEN
  mapRecord(mapr, 4, 0, 4, "Road1", [5, 99]);
  mapRecord(mapr, 5, 0, 77, "noroad"); // names nothing at all
  mapRecord(mapr, 6, 9, 2, "odd"); // a kind no reader knows
  // and an eighth is counted but past the chunk
  return b.bytes();
}

test("a room reads its scenes, nodes and roads, skipping records that name the wrong chunk", () => {
  const s = readSettFile(room());
  expect(s.name).toBe("fort");
  expect(s.scenes.map((x) => [x.name, x.views.map((v) => [v.name, v.id])])).toEqual([["Scene1", [["north", 7]]]]);
  expect(s.nodes.map((n) => [n.name, n.id])).toEqual([["Node1", 42]]);
  expect(s.roads.map((r) => [r.name, r.films.length, r.ends[1]])).toEqual([["Road1", 1, null]]);
  expect(s.first).toBe("Scene1");
  const film = s.scenes[0].films[0];
  expect([film.to, film.frames.map((f) => [f.picture, f.view])]).toEqual([9, [[5, 3], [6, -1]]]);
});

test("quads, stars and routes stop at their chunk's end; a route that is not a DRIV is no route", () => {
  const s = readSettFile(room());
  expect(s.quads.map((q) => [q.name, q.heading])).toEqual([["door", 0.5]]);
  expect(s.stars.map((x) => x.name)).toEqual(["a1", "b1", "a2", "b2"]);
  expect(s.routes).toEqual([{ a: "a1", b: "b1", points: [{ x: 11, y: 0, z: 0, fromPrev: 0 }] }]);
});

test("spheres: none in a chunk that is not one, and a patch past the chunk's end is not read", () => {
  const s = readSettFile(room());
  expect(readSphere(s.file, 8)).toEqual([]);
  expect(readSphere(s.file, 40)).toEqual([]);
  expect(readSphere(s.file, 9).map((p) => p.picture)).toEqual([12]);
});

test("a room needs its MAZE and its MAPR", () => {
  const noMaze = new ContainerBuilder();
  noMaze.add(chunk("MAPR", 0x40));
  expect(() => readSettFile(noMaze.bytes())).toThrow("not a DreamFactory 5 room: no MAZE");
  const noMapr = new ContainerBuilder();
  const maze = noMapr.reserve(0x120).data;
  [..."MAZE"].reverse().forEach((c, i) => (maze[4 + i] = c.charCodeAt(0)));
  pstr(maze, 0x74, "fort");
  i32(maze, 0x68, 5);
  expect(() => readSettFile(noMapr.bytes())).toThrow("fort: no MAPR");
  expect(isSett(new Uint8Array(100))).toBe(false);
  expect(isSett(room())).toBe(false); // a PC container's own version byte is not 5
});
