/**
 * A DreamFactory 5 film's loop table keeps its last record.
 *
 *   npx vitest run engine/tests/df5-loop-table.ts
 *
 * A film's records are 34 bytes from 0x226, where RedJack.exe's move.c reads
 * them (banks.ts has the addresses). `readLoopTableV5` used to start them at
 * 0x228, which reads every field but puts the last record 2 bytes past the end
 * of a table that ends exactly — so it was dropped, and every order entry
 * naming it went with it: `arrive.move`'s order `1,2,2,…` (the music, then
 * `silence` held) lost `silence`, and the film's music started again from the
 * top under its last second and a half. Reported in #379 as long films' audio
 * skipping back to the first chunk.
 */
import { existsSync, readFileSync } from "node:fs";
import { test, expect } from "vitest";
import { readLoopTableV5 } from "@dreamfactory/engine/df/banks";
import { bedOrder, readMovFileV5 } from "@dreamfactory/engine/df/mov-v5";

/** a film loop table of `names`, laid out as move.c reads it, `short` bytes cut off its end */
function filmTable(names: string[], order: number[], short: number): Uint8Array {
  const FIRST = 0x226, SIZE = 34;
  const d = new Uint8Array(FIRST + names.length * SIZE - short);
  const v = new DataView(d.buffer);
  v.setInt16(0x1c, order.length, true);
  order.forEach((o, i) => v.setInt16(0x1e + i * 2, o, true));
  v.setInt16(0x222, names.length, true);
  names.forEach((name, i) => {
    const at = FIRST + i * SIZE;
    v.setInt32(at + 12, 4 + i, true);
    d[at + 18] = name.length;
    for (let k = 0; k < name.length; k++) d[at + 19 + k] = name.charCodeAt(k);
  });
  return d;
}

test("a table that ends exactly at its last record keeps it", () => {
  const t = readLoopTableV5(filmTable(["bbcartmusic", "silence"], [1, 2, 2], 0), "film");
  expect(t.records.map((r) => [r.identifier, r.containerLoc])).toEqual([["bbcartmusic", 4], ["silence", 5]]);
  expect(t.order).toEqual([1, 2, 2]);
});

test("a record the table does not hold in full is dropped", () => {
  const t = readLoopTableV5(filmTable(["music", "silence"], [1, 2], 2), "film");
  expect(t.records.map((r) => r.identifier)).toEqual(["music"]);
});

const ARRIVE = "redjack/gamefiles/RJDisk2/movies/arrive.move";

test.skipIf(!existsSync(ARRIVE))("arrive.move holds silence after its music instead of starting it again", () => {
  const seg = readMovFileV5(new Uint8Array(readFileSync(ARRIVE))).segments[0];
  const [music, ...rest] = seg.audioChunks;
  expect(rest.length).toBe(8);
  expect(rest.every((c) => c !== music)).toBe(true);
});

// Villains' Revenge's long films stream their track: records named by disc
// offset, the order listing only the first 48 (#460)
test("a streamed track plays every record, not just the order's first 48", () => {
  const names = Array.from({ length: 60 }, (_, i) => `disk ${i * 8192}`);
  const first48 = Array.from({ length: 48 }, (_, i) => i + 1);
  expect(bedOrder(first48, names)).toEqual(names.map((_, i) => i + 1));
});

test("a bed of named records keeps its order", () => {
  // dream2.move: one record in the order, six more for its one-shots
  const names = ["1gloop", "2gloopbreath", "3gloopspook", "4", "5", "6", "7"];
  expect(bedOrder([1], names)).toEqual([1]);
  expect(bedOrder([1, 2, 2, 2], ["music", "silence"])).toEqual([1, 2, 2, 2]);
});
