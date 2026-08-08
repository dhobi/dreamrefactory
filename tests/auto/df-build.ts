/**
 * The shared write-path scaffolding (`src/df/build.ts`) — the contract the seven
 * per-format builders rest on, asserted directly rather than only through them.
 *
 * Every claim here is one the format builders depend on: that a container's index
 * is handed back as it is allocated (every cross-reference in these formats is an
 * index), that a reserved container's bytes stay writable after the fact (a header
 * is filled in once the things it points at exist), that a gap reads back as a
 * gap, and that the palette block puts the channel value where the reader looks
 * for it.
 */
import { test, expect } from "vitest";
import {
  ContainerBuilder,
  checkName,
  emptyScript,
  f64,
  i16,
  i32,
  paletteBlock,
  pstr,
  u16,
} from "../../src/df/build";
import { readContainerFile, writeContainerFile } from "../../src/df/container";
import { paletteToRGBA } from "../../src/df/image";
import { sniffScript } from "../../src/df/script";
import { BinaryReader } from "../../src/df/binary";

test("indices come back as containers are allocated, and survive a round trip", () => {
  const b = new ContainerBuilder();
  const { loc: header, data: c0 } = b.reserve(32);
  expect(header).toBe(0);
  const first = b.add(new Uint8Array([1, 2, 3]));
  const gap = b.gap();
  const last = b.add(new Uint8Array([9]));
  expect([first, gap, last]).toEqual([1, 2, 3]);
  expect(b.count).toBe(4);

  // a reserved container is still writable after later containers exist — which
  // is the whole point: a header names the things that follow it
  i32(c0, 0, last);
  i32(c0, 4, first);

  const back = readContainerFile(b.bytes());
  expect(back.containers.length).toBe(4);
  expect(back.containers[gap].gap).toBe(true);
  expect(back.containers[last].data).toEqual(new Uint8Array([9]));
  // the header's pointers still address what they were given
  const r = new BinaryReader(back.containers[0].data);
  expect([r.i32(), r.i32()]).toEqual([last, first]);
  // and writing what was read is the same file
  expect(writeContainerFile(back)).toEqual(b.bytes());
});

test("the field writers write what the readers read", () => {
  const d = new Uint8Array(32);
  i16(d, 0, -2);
  u16(d, 2, 0xbeef);
  i32(d, 4, -70000);
  // doubles are BIG-endian in these files, unlike everything else
  f64(d, 8, 1.75);
  const v = new DataView(d.buffer);
  expect(v.getInt16(0, true)).toBe(-2);
  expect(v.getUint16(2, true)).toBe(0xbeef);
  expect(v.getInt32(4, true)).toBe(-70000);
  expect(v.getFloat64(8, false)).toBe(1.75);

  // a pascal string with a field size clamps and zero-fills the rest; without
  // one it writes exactly its own length
  pstr(d, 16, "abcdef", 4);
  expect(new BinaryReader(d, 16).pstr(4)).toBe("abcd");
  expect(d[21]).toBe(0);
  const tight = new Uint8Array(4);
  pstr(tight, 0, "hi");
  expect([...tight]).toEqual([2, 0x68, 0x69, 0]);
});

test("the palette block puts the channel value in the high byte", () => {
  const rgb = new Uint8Array(256 * 3);
  rgb.set([10, 20, 30], 1 * 3);
  rgb.set([200, 100, 50], 7 * 3);
  const block = paletteBlock(rgb);
  expect(block.length).toBe(256 * 8);
  const rgba = paletteToRGBA(block, 256);
  expect([...rgba.slice(1 * 4, 1 * 4 + 3)]).toEqual([10, 20, 30]);
  expect([...rgba.slice(7 * 4, 7 * 4 + 3)]).toEqual([200, 100, 50]);
  // each entry also carries its own index, as the shipped tables do
  expect(new DataView(block.buffer).getInt16(7 * 8, true)).toBe(7);
  expect(() => paletteBlock(new Uint8Array(256 * 3 + 3))).toThrow(/more than 256/);
});

test("the empty script is a script, as far as the sniffer is concerned", () => {
  const tokens = sniffScript(emptyScript());
  expect(tokens).toEqual([{ kind: "break", indent: 0 }]);
});

test("a name that would not fit its field is refused", () => {
  expect(() => checkName("flat", "", 15)).toThrow(/needs a name/);
  expect(() => checkName("flat", "x".repeat(16), 15)).toThrow(/longer than the 15/);
  expect(() => checkName("flat", "x".repeat(15), 15)).not.toThrow();
});
