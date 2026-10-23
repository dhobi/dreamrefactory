/**
 * RedJack's three service tables — loops, crickets, walks — written from a
 * running session's scheduler and read back into another
 * (engine/src/runtime/saveload-v5-tables.ts): what each table keeps, what has
 * no place in it, and what a load leaves out.
 *
 *   npx vitest run engine/tests/saveload-v5-tables.ts
 *
 * No game files: a cast built here gives the walks someone to walk.
 */
import { expect, test } from "vitest";
import { writeContainerFile } from "@dreamfactory/engine/df/container";
import { buildCstFile } from "@dreamfactory/engine/df/cst-build";
import type { ShpFrame } from "@dreamfactory/engine/df/shp";
import { TABLE } from "@dreamfactory/engine/df/savegame-v5";
import { NullAudioSink } from "@dreamfactory/engine/runtime/audio";
import { GameSession } from "@dreamfactory/engine/runtime/session";
import {
  decodeCrickets,
  decodeLoops,
  decodeWalks,
  encodeCrickets,
  encodeLoops,
  encodeWalks,
} from "@dreamfactory/engine/runtime/saveload-v5-tables";
import { i32, pstr, u16 } from "./helpers/save-fixtures";

const dot: ShpFrame = { width: 1, height: 1, posXraw: 0, posYraw: 0, indexed: new Uint8Array([1]), opaque: new Uint8Array([1]) };
const dirs = () => Array.from({ length: 8 }, () => dot);
const NAMES = Array.from({ length: 17 }, (_, k) => `m${k}`);
const CAST = writeContainerFile(buildCstFile({
  palette: [0, 0, 0, 255, 255, 255],
  members: NAMES.map((name) => ({ name, poses: [{ name: "stand", steps: [dirs()] }] })),
}).file);

async function session() {
  const s = new GameSession((n) => (n === "crew.cst" ? CAST : null), new NullAudioSink());
  await s.openCastFile("crew.cst");
  // only what the tables say, from here on
  const logs: string[] = [];
  s.onLog = (l) => void logs.push(l);
  return { s, logs };
}

const loop = (kind: string, name: string, extra: object = {}) => ({ kind, name, handler: "tick", count: 5, period: 5, paused: false, ...extra });

test("loops: a kind the table cannot hold is left out; timed and paused ones round-trip", async () => {
  const { s, logs } = await session();
  s.scheduler.loops.push(
    loop("actor", "m0", { paused: true }),
    loop("road", "m1"),
    loop("prop", "lamp", { deadline: 0 }),
    loop("scene", "s1", { paused: true, pauseDepth: 3, count: 0 }),
  );
  const bytes = encodeLoops(s);
  expect(logs).toEqual(["savegame: a road loop on m1 has no place in a RedJack save — left out"]);

  const { s: t } = await session();
  // and junk the decoder must skip: a live slot whose kind is no kind
  const at = 5 * TABLE.loops.stride;
  u16(bytes, at, 1);
  u16(bytes, at + 4, 9);
  decodeLoops(t, bytes);
  expect(t.scheduler.loops.map((l) => [l.kind, l.name, l.paused, l.pauseDepth ?? 0, l.count])).toEqual([
    ["actor", "m0", true, 1, 5],
    ["prop", "lamp", false, 0, 1],
    ["scene", "s1", true, 3, 1],
  ]);
});

test("loops: past the table's slots, the rest are left out", async () => {
  const { s, logs } = await session();
  for (let k = 0; k <= TABLE.loops.slots; k++) s.scheduler.loops.push(loop("flat", `f${k}`));
  encodeLoops(s);
  expect(logs).toEqual([`savegame: a flat loop on f${TABLE.loops.slots} has no place in a RedJack save — left out`]);
});

test("crickets: an unmeasured one writes zeros, a paused one with no depth writes one", async () => {
  const { s } = await session();
  const cricket = { name: "gull", x: 1, y: 2, radius: 3, base: 4, jitter: 5, count: 6, paused: true, setName: "beach", handle: null, armed: true };
  s.scheduler.crickets.table.push(
    cricket as never,
    { ...cricket, name: "crab", paused: false, armed: false, measured: { camX: 7, camY: 8, dist: 9, bearing: 10 } } as never,
  );
  const bytes = encodeCrickets(s);
  const { s: t } = await session();
  decodeCrickets(t, bytes);
  expect(t.scheduler.crickets.table.map((c) => [c.name, c.setName, c.paused, c.pauseDepth, c.armed])).toEqual([
    ["gull", "beach", true, 1, true],
    ["crab", "beach", false, undefined, false],
  ]);
  expect(t.scheduler.crickets.table[0].measured).toEqual({ camX: 0, camY: 0, dist: 0, bearing: 0 });
  expect(t.scheduler.crickets.table[1].measured).toEqual({ camX: 7, camY: 8, dist: 9, bearing: 10 });
});

test("walks: every mode round-trips; a walker not in the cast is not written, nor past the table's end", async () => {
  const { s } = await session();
  const W = s.scheduler.walks;
  const rec = (extra: object) => ({ sx: 100, sy: 200, sz: 0, dx: 30, dy: 40, dz: 0, dist: 50, progress: 10.4, paused: false, ...extra });
  W.set("ghost", rec({}));
  W.set("m0", rec({ turnOnly: true, turnTo: 64, paused: true }));
  W.set("m1", rec({ path: [{ x: 0, y: 0, z: 0, cum: 0 }, { x: 30, y: 40, z: 0, cum: 50 }], paused: true, pauseDepth: 2 }));
  W.set("m2", rec({ arriveStar: "custom" }));
  W.set("m3", rec({ arriveStar: "dock" }));
  for (let k = 4; k < 17; k++) W.set(`m${k}`, rec({}));
  const { table, routes } = encodeWalks(s, () => 0);
  expect(routes).toHaveLength(1);

  const { s: t, logs } = await session();
  // a walker the reopened cast does not have
  const at = 15 * TABLE.walks.stride;
  pstr(table, at + 0x40, "stranger");
  // and a route that names a container the file does not carry
  i32(table, 4 * TABLE.walks.stride + 0x24, 9);
  decodeWalks(t, table, routes, () => "");
  expect(logs).toEqual(["opengame: stranger was saved walking and is not in the reopened casts — left standing"]);
  const back = (n: string) => t.scheduler.walks.get(n)!;
  expect([back("m0").turnOnly, back("m0").turnTo, back("m0").paused, back("m0").pauseDepth]).toEqual([true, 64, true, 1]);
  expect([back("m1").path?.length, back("m1").path?.at(-1)?.cum, back("m1").pauseDepth]).toEqual([2, 50, 2]);
  expect([back("m2").arriveStar, back("m3").arriveStar, back("m4").arriveStar]).toEqual(["custom", "dock", undefined]);
  expect([back("m3").dx, back("m3").progress]).toEqual([30, 10]);
  expect(t.scheduler.walks.has("ghost")).toBe(false);
  expect(t.scheduler.walks.has("m15")).toBe(false);
});
