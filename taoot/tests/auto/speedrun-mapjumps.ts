/**
 * The deck plans' jump table as the speedrun reads it
 * (`src/speedrun/nav/mapjumps.ts`): when the map opens at all, which red area a
 * destination is jumped to by, and which page button turns to a plan.
 *
 *   npx vitest run taoot/tests/auto/speedrun-mapjumps.ts
 *
 * MAP.STG's `mapdisabled ()` is the authority, read the other way round: the
 * tour opens it anywhere, Mission 4 nowhere, and otherwise it needs Frank's bag
 * and watch and a room that is not one of the boiler-room and smokestack sets.
 * A set on several plans is jumped to on the plan of the deck asked for, else
 * on the lowest page — one answer, always the same.
 */
import { expect, test } from "vitest";
import { jumpTo, jumpableSets, mapUsable, pageButton } from "../../src/speedrun/nav/mapjumps";

const owns = (...props: string[]) => (p: string) => props.includes(p);

test("the map opens on the tour anywhere, never in Mission 4, and otherwise with the bag and the watch outside the stack", () => {
  expect(mapUsable("smstack2", { tour: 1 }, owns())).toBe(true);
  expect(mapUsable("gstair2", { mission: 4 }, owns("bag", "watch"))).toBe(false);
  expect(mapUsable("gstair2", { mission: 1 }, owns("bag"))).toBe(false);
  expect(mapUsable("gstair2", { mission: 1 }, owns("watch"))).toBe(false);
  expect(mapUsable("SMSTACK2", { mission: 1 }, owns("bag", "watch"))).toBe(false);
  expect(mapUsable("gstair2", {}, owns("bag", "watch"))).toBe(true);
});

test("a set on several plans is jumped to on the deck asked for, else on the lowest page", () => {
  const multi = [...jumpableSets()].find((s) => new Set([jumpTo(s, "a")?.page, jumpTo(s, "e")?.page, jumpTo(s)?.page]).size > 1);
  expect(multi).toBeDefined();
  const lowest = jumpTo(multi!)!;
  for (const deck of ["a", "b", "c", "d", "e", "f", "g"]) {
    const j = jumpTo(multi!, deck.toUpperCase())!;
    expect(j.to).toBe(multi);
    // the deck asked for when it has one, the lowest page when not
    if (j.deck === deck) continue;
    expect(j).toBe(lowest);
  }
  expect(jumpTo("nowhere")).toBeNull();
});

test("each of the eight plans has its page button, and a ninth has none", () => {
  for (let page = 1; page <= 8; page++) expect(pageButton(page)?.page).toBe(page);
  expect(pageButton(2)?.region).toBe("Button19");
  expect(pageButton(9)).toBeNull();
});
