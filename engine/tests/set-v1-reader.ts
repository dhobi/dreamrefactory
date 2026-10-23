/**
 * Dust's SET reader on rooms built here (engine/src/df/set-v1.ts): a header
 * that is not DF1's is refused; a container 0 too short for its palettes,
 * scene table or name reads with warnings rather than failing; and the
 * transition and star registers — counts that disagree with the register,
 * coordinate copies that disagree with each other, two moves claiming one
 * frame, the departure still after a full run, stars with and without a
 * secondary and a route.
 *
 *   npx vitest run engine/tests/set-v1-reader.ts
 *
 * No game files: dust/tests/sets.ts reads every room on the disc.
 */
import { expect, test } from "vitest";
import { ContainerBuilder, i16, i32 } from "@dreamfactory/engine/df/build";
import { readSetFileV1 } from "@dreamfactory/engine/df/set-v1";
import { pstr } from "./helpers/save-fixtures";

/** the header's size up to and including its set name, and the scene table that follows */
const HEADER = 0x1b80;

interface Room {
  c0Size?: number;
  version?: number;
  grid?: [number, number];
  scenes?: string[];
  transitions?: { from: [number, number, number]; to: [number, number, number]; first: number; skew?: boolean }[];
  transitionCount?: number;
  stars?: (b: Uint8Array) => void;
  starBytes?: number;
  frames?: (b: ContainerBuilder) => void;
  defaultCell?: [number, number, number];
  name?: string;
}

/** c0, the transition register (c1), the star register (c2), then whatever frames the room asks for */
function room(r: Room = {}): Uint8Array {
  const scenes = r.scenes ?? ["G1", "G2"];
  const b = new ContainerBuilder();
  const size = r.c0Size ?? HEADER + 4 + scenes.length * 32;
  const { data: c0 } = b.reserve(size);
  i32(c0, 0x02, r.version ?? 1);
  {
    i16(c0, 0x1e, 1);
    i16(c0, 0x22, 2);
    const [gw, gh] = r.grid ?? [scenes.length, 1];
    i16(c0, 0x26, gw);
    i16(c0, 0x28, gh);
    i16(c0, 0x2a, 4);
    i16(c0, 0x2c, 2);
    i16(c0, 0x1a, 62);
    const [dx, dz, df] = r.defaultCell ?? [1, 0, 1];
    i16(c0, 0x30, dx);
    i16(c0, 0x32, dz);
    i16(c0, 0x34, df);
    pstr(c0, 0x50 + 2048, "day");
    if (size >= HEADER) pstr(c0, 0x1b7c, r.name ?? "town");
    // the scene table ends the container: names at 16 into each 32-byte record
    if (size >= HEADER) scenes.forEach((n, i) => pstr(c0, size - 16 - 32 * (scenes.length - 1 - i), n));
  }
  const transitions = r.transitions ?? [];
  i32(c0, 0x08, r.transitionCount ?? transitions.length);
  const t = new Uint8Array(28 * transitions.length);
  transitions.forEach((x, i) => {
    const o = 28 * i;
    [...x.from, ...x.to].forEach((v, k) => {
      i16(t, o + 2 * k, v);
      i16(t, o + 12 + 2 * k, x.skew && k === 0 ? v + 1 : v);
    });
    i32(t, o + 24, x.first);
  });
  b.add(t);
  const stars = new Uint8Array(r.starBytes ?? 0x1c + 50 * 4);
  r.stars?.(stars);
  b.add(stars);
  r.frames?.(b);
  return b.bytes();
}

/** a frame container: a delta (too short to repaint) or a still (height, width, a row table) */
const delta = () => new Uint8Array(8).fill(1);
const still = () => {
  const d = new Uint8Array(4 + 2 + 8);
  i16(d, 0, 2);
  i16(d, 2, 4);
  return d;
};

test("a SET from another engine is refused", () => {
  expect(() => readSetFileV1(room({ version: 4 }))).toThrow("not a DreamFactory 1 SET (container 0 says version 4)");
});

test("a header that ends at its main script has no name and no scene table, and says so", () => {
  const set = readSetFileV1(room({ c0Size: 0x1b7c, grid: [0, 0], defaultCell: [3, 3, 1] }));
  expect(set.warnings).toEqual([
    "no scene table found in container 0",
    "no set name at 0x1b7c",
    "default standpoint (3,3) facing 1 is not one of this set's",
  ]);
  expect(set.cluts.map((c) => c.name)).toEqual(["day", "", ""]);
  expect(set.scenes).toEqual([]);
  expect(set.eyeHeight).toBe(62);
});

test("the scene table: the last record's script runs off the end, a name that is not one ends the table", () => {
  const set = readSetFileV1(room({
    transitions: [{ from: [1, 0, 1], to: [1, 0, 2], first: 3 }],
    frames: (b) => b.add(delta()),
  }));
  expect(set.scenes.map((s) => [s.name, s.scriptLocation])).toEqual([["G1", 0], ["G2", 0]]);
  expect(set.cluts.map((c) => c.name)).toEqual(["day", "", ""]);
  expect(set.setName).toBe("town");
  // a grid of one names only the last record; the table then reads on until a name is not one
  const one = readSetFileV1(room({ grid: [1, 1], scenes: ["\u0001", "G2"] }));
  expect(one.scenes.map((s) => s.name)).toEqual(["G2"]);
  // a table that does not end the container is found further back, and ends at the first non-name
  const early = readSetFileV1(room({ grid: [2, 1], scenes: ["G1", "G2", "\u0001"] }));
  expect(early.scenes.map((s) => [s.name, s.scriptLocation])).toEqual([["G1", 0], ["G2", 0]]);
  // and a grid bigger than the container holds has no table at all
  expect(readSetFileV1(room({ grid: [1000, 1] })).warnings).toContain("no scene table found in container 0");
});

test("transitions: a full run gets its departure still; a short one, or one two moves share, is warned about", () => {
  const set = readSetFileV1(room({
    transitions: [
      { from: [1, 0, 1], to: [1, 0, 2], first: 3 },
      { from: [1, 0, 1], to: [2, 0, 1], first: 9 },
      { from: [2, 0, 1], to: [1, 0, 1], first: 9, skew: true },
    ],
    transitionCount: 4,
    frames: (b) => {
      for (let k = 0; k < 5; k++) b.add(delta()); // c3..c7
      b.add(still()); // c8, the still after the run
      b.add(delta()); // c9
      b.gap(); // c10
    },
  }));
  expect(set.transitions.map((t) => [t.kind, t.frames, t.departureStill])).toEqual([
    ["turn", [3, 4, 5, 6, 7], 8],
    ["walk", [9], -1],
    ["walk", [9], -1],
  ]);
  expect(set.warnings).toEqual([
    "header says 4 transitions, register holds 3",
    "transition 2: the two coordinate copies disagree",
    "transitions 1 and 2 both claim frame c9",
  ]);
});

test("a missing transition register, and a full run whose sixth container cannot repaint the frame", () => {
  const set = readSetFileV1(room({
    transitions: [{ from: [1, 0, 1], to: [1, 0, 2], first: 3 }],
    frames: (b) => {
      for (let k = 0; k < 5; k++) b.add(delta());
      b.add(delta()); // a leftover delta where the still would be
    },
  }));
  expect(set.transitions[0].departureStill).toBe(-1);
  const bytes = room();
  // point the transition register past the file
  const gone = readSetFileV1(patchC0(bytes, 0x1e, 40));
  expect(gone.warnings).toContain("transition register c40 is missing");
  expect(gone.transitions).toEqual([]);
});

/** rewrite one i16 of container 0 in a built file */
function patchC0(bytes: Uint8Array, off: number, v: number): Uint8Array {
  const out = bytes.slice();
  const dv = new DataView(out.buffer);
  const c0 = dv.getUint32(1024, true) + 8;
  dv.setInt16(c0 + off, v, true);
  return out;
}

test("stars: a pair with a route, a secondary with no position, a nameless record ends the register", () => {
  const set = readSetFileV1(room({
    stars: (d) => {
      i32(d, 0x18, 4);
      const o0 = 0x1c;
      i16(d, o0 + 2, 100);
      pstr(d, o0 + 8, "anne");
      i16(d, o0 + 24, 7);
      i16(d, o0 + 26 + 2, 300);
      pstr(d, o0 + 26 + 8, "anne2");
      const o1 = 0x1c + 50;
      pstr(d, o1 + 8, "jack");
      pstr(d, o1 + 26 + 8, "jack2");
      // star 2: a placed secondary, but no route between them
      const o2 = 0x1c + 100;
      pstr(d, o2 + 8, "kate");
      i16(d, o2 + 26 + 4, 50);
      pstr(d, o2 + 26 + 8, "kate2");
      // star 3 has no name
    },
  }));
  expect(set.actors.map((a) => [a.identifier, a.positionX])).toEqual([
    ["anne", 100], ["anne2", 300], ["jack", 0], ["kate", 0], ["kate2", 0],
  ]);
  expect(set.starPaths).toEqual([{ a: "anne", b: "anne2", container: 7 }]);
  expect(set.warnings).toContain(`star 3: no name at 0x${(0x1c + 150 + 8).toString(16)}`);
});

test("stars: an implausible count, and a record that runs past the register", () => {
  const silly = readSetFileV1(room({ stars: (d) => i32(d, 0x18, 300) }));
  expect(silly.warnings).toContain("star register: implausible count 300");
  const short = readSetFileV1(room({
    starBytes: 0x1c + 50 + 10,
    stars: (d) => {
      i32(d, 0x18, 2);
      pstr(d, 0x1c + 8, "anne");
    },
  }));
  expect(short.actors.map((a) => a.identifier)).toEqual(["anne"]);
  expect(short.warnings).toContain("star 1: record runs past the register");
  // and no star register at all
  const none = readSetFileV1(patchC0(room(), 0x22, 50));
  expect(none.actors).toEqual([]);
});
