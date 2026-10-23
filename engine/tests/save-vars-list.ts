/**
 * The variable list and string pool both save formats share
 * (engine/src/df/save-vars.ts), on lists built here: where the grid is found
 * and where it is not, recycling dead records and growing the pool, and the
 * pool's allocator refusing what it has no room for.
 *
 *   npx vitest run engine/tests/save-vars-list.ts
 */
import { expect, test } from "vitest";
import {
  decodeVarSlots,
  decodeVars,
  ensureVarRoom,
  poolFind,
  poolIntern,
} from "@dreamfactory/engine/df/save-vars";
import { FILLER, VTABLE, get32, pstr, u32, varList } from "./helpers/save-fixtures";

test("a list with no header before it has no slot for its head's value", () => {
  const { globals } = varList(FILLER, 0);
  // drop the 32-byte header: the head node now starts at 0, and its value would be off the front
  const bare = globals.slice(32);
  const names = decodeVarSlots(bare).map((v) => v.name);
  expect(names).toEqual(FILLER.slice(1).map(([n]) => n));
});

test("a name whose node runs off the end, or whose vtable is not the list's, is not a record", () => {
  const { globals } = varList(FILLER, 0);
  // a ninth name in the last 20 bytes: no room for its own vtable
  const longer = new Uint8Array(globals.length + 20);
  longer.set(globals);
  pstr(longer, globals.length + 8, "late");
  expect(decodeVarSlots(longer).map((v) => v.name)).toEqual(FILLER.map(([n]) => n));
  // and a node in the middle whose vtable is someone else's breaks the pairing for the next name
  // (a ninth name, so the other eight still outvote it)
  const odd = varList([...FILLER, ["fi", 8]], 0).globals;
  u32(odd, 3 * 32 + 20, 0x12345678);
  expect(decodeVarSlots(odd).map((v) => v.name)).not.toContain("fd");
  expect(decodeVars(odd).find((v) => v.name === "fe")?.num).toBe(4);
});

test("dead records are recycled for short names only; a long one grows the list", () => {
  const { globals, pool } = varList(FILLER, 0);
  const g = { data: globals };
  ensureVarRoom(g, { data: pool }, ["fa", "fb", "fc", "fd", "fe", "ff", "fg", "averylongname1"], []);
  // fh was dead but the new name does not fit a short field: the list grew a node instead
  expect(g.data).toHaveLength(globals.length + 32);
  expect(decodeVarSlots(g.data).map((v) => v.name)).toContain("fh");
});

test("a pool header claiming more than the container holds is left alone", () => {
  const { globals, pool } = varList(FILLER, 0, 4);
  u32(globals, 12, pool.length + 50);
  const p = { data: pool };
  ensureVarRoom({ data: globals }, p, [], ["a much longer string than fits"]);
  expect(p.data).toBe(pool);
  expect(get32(globals, 12)).toBe(pool.length + 50);
});

test("the pool: a corrupt length stops the search, a full pool refuses a new string", () => {
  const pool = new Uint8Array([3, 0x61, 0x62, 0x63, 200, 0x61]);
  expect(poolFind(pool, "abc")).toBe(0);
  expect(poolFind(pool, "zz")).toBe(-1);

  const { globals, pool: small } = varList([...FILLER, ["s", "abc"]], 0, 2);
  const p = { data: small };
  expect(poolIntern(globals, p, "abc")).toBe(0);
  expect(poolIntern(globals, p, "x")).toBe(4);
  expect(poolIntern(globals, p, "toolong")).toBe(-1);
  expect(poolIntern(globals, p, "y".repeat(300))).toBe(-1);
  expect(VTABLE).toBe(0x00431e0f);
});
