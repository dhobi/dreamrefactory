/**
 * The sound-bank table readers on headers built here (engine/src/df/banks.ts):
 * a loop table too short to be one, a header whose table fields point past
 * the file or at a container too small for a table, a bank with no loop bed
 * refusing a new playback order, and a DreamFactory 0 bank header too short
 * to read.
 *
 *   npx vitest run engine/tests/bank-table-edges.ts
 */
import { expect, test } from "vitest";
import { ContainerBuilder, i32 } from "@dreamfactory/engine/df/build";
import { readContainerFile } from "@dreamfactory/engine/df/container";
import { patchLoopOrder, readBankTables, readBankV0, readLoopTable, readLoopTableV5 } from "@dreamfactory/engine/df/banks";
import { pstr } from "./helpers/save-fixtures";

test("a table too short to hold its own header reads as empty", () => {
  expect(readLoopTable(new Uint8Array(8))).toEqual({ order: [], records: [] });
  expect(readLoopTableV5(new Uint8Array(8), "bank")).toEqual({ order: [], records: [] });
  expect(readLoopTableV5(new Uint8Array(8), "film")).toEqual({ order: [], records: [] });
});

function bankFile(loopAt: number, oneShotAt: number): ReturnType<typeof readContainerFile> {
  const b = new ContainerBuilder();
  const { data } = b.reserve(64);
  i32(data, 28, loopAt);
  i32(data, 32, oneShotAt);
  pstr(data, 36, "deck");
  b.add(new Uint8Array(16)); // too small to be a loop table
  return readContainerFile(b.bytes());
}

test("table fields that point past the file, or at a container too small, give no tables", () => {
  const past = readBankTables(bankFile(40, 50));
  expect([past.trackName, past.loopTable, past.oneShotTable, past.singles, past.loopOrder]).toEqual(["deck", 0, 0, [], []]);
  const small = readBankTables(bankFile(1, 0));
  expect([small.loopTable, small.loopRecords]).toEqual([0, []]);
  // and with no loop bed there is no order to write
  expect(patchLoopOrder(bankFile(1, 0), [1, 2])).toEqual([]);
  // the name field's own padding is the room a rename has
  expect(past.trackNameLimit).toBe(27);
});

test("a DreamFactory 0 bank header shorter than its three counts is refused", () => {
  expect(() => readBankV0(new Uint8Array(4))).toThrow("v0 bank: a 4-byte header");
  const h = new Uint8Array(6 + 4);
  h.set([3, 0, 2, 0, 5, 0, 2, 0, 9, 0]);
  // five order entries claimed, room for two, and the second is not a piece
  expect(readBankV0(h)).toEqual({ sounds: 3, pieces: 2, order: [2] });
});
