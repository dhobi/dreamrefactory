/**
 * Skull Cracker's sprite books (engine/src/df/sbk.ts) built from nothing, for
 * what engine/tests/sbk.ts cannot reach on the disc's seventeen: a directory
 * naming one cel id twice, tables whose length is not their count times the
 * stride, a root, palette or table that is not there, a region whose length
 * word lies or that holds too few points, a name that is not printable, an
 * exit standing in no room, a room with no floor to arrive on — and the floor
 * rasteriser's backwards segment and degenerate polylines.
 *
 *   npx vitest run engine/tests/sbk-built.ts
 */
import { expect, test } from "vitest";
import { ContainerBuilder, i16, i32, pstr } from "@dreamfactory/engine/df/build";
import { arrivalIn, placementRate, rasteriseGround, readRooms, readSbkFile } from "@dreamfactory/engine/df/sbk";

interface EntitySpec {
  name: string;
  rect: [number, number, number, number];
  param?: number;
  region?: number;
  entity?: boolean;
  point?: [number, number];
}
const ENTITY = 48;
const BACKDROP = 342;

/** a 28-byte table header with its count, then `n` records of `stride` */
function table(n: number, stride: number, count = n): Uint8Array {
  const d = new Uint8Array(28 + n * stride);
  i32(d, 24, count);
  return d;
}
function entities(list: EntitySpec[], count?: number): Uint8Array {
  const d = table(list.length, ENTITY, count);
  list.forEach((e, i) => {
    const at = 28 + i * ENTITY;
    i16(d, at, e.param ?? 0);
    e.rect.forEach((v, k) => i16(d, at + 2 + 2 * k, v));
    i32(d, at + 10, e.region ?? 0);
    i16(d, at + 22, e.entity ? 1 : 0);
    i16(d, at + 24, e.point?.[0] ?? 0);
    i16(d, at + 26, e.point?.[1] ?? 0);
    pstr(d, at + 28, e.name);
  });
  return d;
}
/** a region: its length word, two corners, then the floor's (y, x) points */
function region(points: [number, number][], length?: number): Uint8Array {
  const d = new Uint8Array(2 + 4 * points.length);
  i16(d, 0, length ?? d.length);
  points.forEach(([y, x], k) => (i16(d, 2 + 4 * k, y), i16(d, 4 + 4 * k, x)));
  return d;
}

/**
 * c0 the directory, c1 the palette, c2 the root, c3 the entities, c4 the
 * backdrop, c5… `extra`; the root names c4 and c3 unless told otherwise
 */
function book(o: {
  cels?: [id: number, location: number][];
  palette?: Uint8Array;
  root?: Uint8Array;
  entities?: Uint8Array;
  backdrop?: Uint8Array;
  extra?: Uint8Array[];
}): Uint8Array {
  const cels = o.cels ?? [];
  const c0 = new Uint8Array(32 + cels.length * 48);
  i32(c0, 20, 1);
  i32(c0, 24, 2);
  i32(c0, 28, cels.length);
  cels.forEach(([id, loc], k) => (i16(c0, 32 + k * 48 + 28, id), i16(c0, 32 + k * 48 + 30, loc)));
  const root = new Uint8Array(38);
  i32(root, 30, 4);
  i32(root, 34, 3);
  const b = new ContainerBuilder();
  for (const c of [c0, o.palette ?? new Uint8Array(2056), o.root ?? root, o.entities ?? table(0, ENTITY), o.backdrop ?? table(0, BACKDROP), ...(o.extra ?? [])]) b.add(c);
  return b.bytes();
}

test("a level read whole: rooms and their floors, an exit in one, an exit in none, a name that is not text", () => {
  const sbk = readSbkFile(
    book({
      cels: [
        [7, 9],
        [7, 10],
        [8, 11],
      ],
      entities: entities([
        { name: "hall", rect: [0, 0, 100, 100], param: 1, region: 5 },
        { name: "cellar", rect: [200, 0, 300, 100], param: 2, region: 6 },
        { name: "short", rect: [400, 0, 500, 100], param: 3, region: 7 },
        { name: "exitroom", rect: [40, 90, 60, 100], param: 2, entity: true, point: [50, 120] },
        { name: "exitroom", rect: [40, 0, 60, 10], param: 1, entity: true, point: [50, 5] },
        { name: "exitroom", rect: [900, 900, 910, 910], param: 1, entity: true },
        { name: "bad\x01", rect: [0, 0, 1, 1], entity: true },
      ]),
      extra: [
        region([
          [0, 0],
          [100, 100],
          [80, 0],
          [80, 100],
        ]),
        region(
          [
            [0, 0],
            [9, 9],
            [5, 5],
          ],
          99,
        ),
        region([
          [0, 0],
          [9, 9],
        ]),
      ],
    }),
  );
  // the first location a cel id is listed at is the one it answers to
  expect([...sbk.byId]).toEqual([
    [7, 9],
    [8, 11],
  ]);
  expect(sbk.paletteRaw).toHaveLength(2048);
  // the lying region and the two-point one are not regions
  expect([...sbk.regions.keys()]).toEqual([5]);
  expect(sbk.entities.map((e) => e.name)).toEqual(["hall", "cellar", "short", "exitroom", "exitroom", "exitroom", ""]);
  const [hall, cellar] = readRooms(sbk);
  expect(hall.ground?.ys).toHaveLength(101);
  expect(cellar.ground).toBeNull();
  // the exit to the cellar has its point past the hall's right; the second's is inside its own rect; the third stands in no room
  expect(hall.exits.map((x) => [x.to, x.side])).toEqual([
    [2, 1],
    [1, 0],
  ]);
  expect(arrivalIn(cellar, hall)).toBeNull();
  // back into the hall from the cellar: at the door that leads there
  expect(arrivalIn(hall, { ...cellar, param: 2 })).toEqual({ y: 50, x: 120 });
});

test("tables that do not come to their count times their stride are not read; nor what is not there", () => {
  const room = { name: "hall", rect: [0, 0, 1, 1] as [number, number, number, number] };
  expect(readSbkFile(book({ entities: entities([room], 2) })).entities).toEqual([]);
  expect(readSbkFile(book({ entities: entities([room], -1) })).entities).toEqual([]);
  expect(readSbkFile(book({ backdrop: table(1, BACKDROP, 3) })).placements).toEqual([]);
  expect(readSbkFile(book({ backdrop: table(1, BACKDROP, -1) })).placements).toEqual([]);
  // a root of the wrong size: no tables at all
  const noRoot = readSbkFile(book({ root: new Uint8Array(30) }));
  expect([noRoot.entityLocation, noRoot.backdropLocation]).toEqual([-1, -1]);
  // a root naming containers the book does not have
  const lost = new Uint8Array(38);
  i32(lost, 30, 40);
  i32(lost, 34, 41);
  const away = readSbkFile(book({ root: lost, entities: entities([room]) }));
  expect([away.entityLocation, away.backdropLocation, away.entities.length]).toEqual([41, 40, 0]);
  // a palette container of the wrong size is no palette
  expect(readSbkFile(book({ palette: new Uint8Array(100) })).paletteRaw).toBeNull();
});

test("a placement's rate: plane 2 and 3 by their first flag bit set, the rest 1", () => {
  const p = (plane: number, flags: number) => placementRate({ plane, flags } as never);
  expect([p(2, 1), p(2, 2), p(2, 4), p(2, 0)]).toEqual([5000 / 6000, 5300 / 6000, 5600 / 6000, 1]);
  expect([p(3, 6), p(0, 1)]).toEqual([6700 / 6000, 1]);
});

test("the floor: a segment that starts before the first point is clipped; fewer than two points, or no width, is none", () => {
  const ground = (pts: [number, number][]) =>
    rasteriseGround({ location: 1, min: { y: 0, x: 0 }, max: { y: 0, x: 0 }, ground: pts.map(([y, x]) => ({ y, x })) });
  // 5 → 3 goes backwards and draws nothing; 3 → 6 is drawn from the first point's column on
  expect(
    ground([
      [0, 5],
      [10, 3],
      [20, 6],
    ]),
  ).toEqual({ x0: 5, ys: Int16Array.from([17, 20]) });
  expect(ground([[0, 5]])).toBeNull();
  expect(
    ground([
      [0, 5],
      [9, 5],
    ]),
  ).toBeNull();
});
