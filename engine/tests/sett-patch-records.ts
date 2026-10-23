/**
 * The room editor's two in-place patches to a DreamFactory 5 SETT
 * (engine/src/df/sett-patch.ts), on containers laid out here: a quad and a
 * star are found by their running index across every BLI3 / MARK chunk, a
 * star's secondary counts as the next star, a field the patch leaves out is
 * not touched, a record past its chunk's end is not one, and a name with a
 * character no byte can hold is written with a `?`.
 *
 *   npx vitest run engine/tests/sett-patch-records.ts
 *
 * engine/tests/df5-room.ts patches every shipped room, with every field given.
 */
import { expect, test } from "vitest";
import type { DFContainerFile } from "@dreamfactory/engine/df/container";
import { patchQuad, patchStar } from "@dreamfactory/engine/df/sett-patch";
import { get32, i32, pstr } from "./helpers/save-fixtures";

/** a chunk: its four-letter tag stored backwards at +4, the record count at +0x18, records from +0x20 */
function chunk(tag: string, count: number, stride: number, room = count): Uint8Array {
  const d = new Uint8Array(0x20 + room * stride);
  [...tag].reverse().forEach((c, i) => (d[4 + i] = c.charCodeAt(0)));
  i32(d, 0x18, count);
  return d;
}

const file = (...data: Uint8Array[]): DFContainerFile =>
  ({ containers: data.map((d, id) => ({ id, data: d })) }) as unknown as DFContainerFile;

const name = (d: Uint8Array, at: number): string => String.fromCharCode(...d.subarray(at + 1, at + 1 + d[at]));

test("quads are counted across chunks; a record past its chunk's end is not one", () => {
  const a = chunk("BLI3", 1, 0x50);
  // claims two quads, has room for one
  const b = chunk("BLI3", 2, 0x50, 1);
  i32(b, 0x20 + 0x30, 99);
  const f = file(new Uint8Array(4), a, chunk("MARK", 0, 0x42), b);
  expect(patchQuad(f, 1, { y: 12.4 })).toBe(true);
  expect(get32(b, 0x20 + 0x30)).toBe(12);
  expect(patchQuad(f, 2, { y: 0 })).toBe(false);
});

test("a quad patch writes only the fields it carries", () => {
  const a = chunk("BLI3", 1, 0x50);
  pstr(a, 0x20 + 0x1c, "door");
  i32(a, 0x20 + 0x2c, 5);
  i32(a, 0x20 + 0x48, 64);
  const f = file(a);
  expect(patchQuad(f, 0, { h: 30 })).toBe(true);
  expect([name(a, 0x20 + 0x1c), get32(a, 0x20 + 0x2c), get32(a, 0x20 + 0x48), get32(a, 0x20 + 0x4c)]).toEqual(["door", 5, 64, 30]);
  expect(patchQuad(f, 0, { name: "porte→" })).toBe(true);
  expect(name(a, 0x20 + 0x1c)).toBe("porte?");
});

test("a star's secondary is the next star; a patch writes only what it carries", () => {
  const m = chunk("MARK", 3, 0x42, 2);
  pstr(m, 0x20 + 6 + 12, "gate");
  i32(m, 0x20 + 0x22, 1); // the first record has a secondary
  pstr(m, 0x20 + 0x26 + 12, "gate2");
  const f = file(m);
  expect(patchStar(f, 1, { x: 7 })).toBe(true);
  expect([get32(m, 0x20 + 0x26), name(m, 0x20 + 0x26 + 12)]).toEqual([7, "gate2"]);
  expect(patchStar(f, 0, { name: "door", z: -3 })).toBe(true);
  expect([name(m, 0x20 + 6 + 12), get32(m, 0x20 + 6 + 8) | 0]).toEqual(["door", -3]);
  // the second record has no secondary, so it is star 2; the third runs past the chunk
  expect(patchStar(f, 2, { y: 4 })).toBe(true);
  expect(get32(m, 0x20 + 0x42 + 6 + 4)).toBe(4);
  expect(patchStar(f, 3, { y: 4 })).toBe(false);
});
