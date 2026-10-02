/**
 * The port's day saves reaching a player's browser — `seedLunicusSaves` and
 * the file kind the shared dialog keeps (`src/saves.ts`).
 *
 *   npx vitest run lunicus/tests/save-seed.ts
 *
 * No save made by the original survives, so the port ships its own: one at the
 * start of each of days two to six, written by the machine route. What the page
 * promises about them, which until now only ever ran in a browser:
 *
 *   - **each is offered exactly once**: a second launch fetches none, a save
 *     the player deleted stays deleted, and one that could not be fetched (no
 *     URL, a 404, the network down) is not marked and is tried again next time;
 *   - **only a real `.LUN` goes in** — 26 bytes, a difficulty of 1 to 4, a level
 *     the game has, gauges 0 to 10000 — under "Day N" in a folder of its own;
 *   - **the shipped files are what they say**: dayN.lun opens on day N.
 *
 * The store is IndexedDB in the page and a Map here: `save-store` is replaced
 * by an in-memory twin of the three calls this module makes. The last test
 * reads `gamefiles/save/` and is skipped, not failed, without it.
 */
import { test, expect, beforeEach, vi } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { SaveEntry } from "@dreamfactory/engine/web/save-store";
import { readSaveV0, writeSaveV0, type SaveGameV0 } from "@dreamfactory/engine/df/savegame-v0";
import { dayOf } from "../src/game/data";

const store = vi.hoisted(() => ({
  saves: new Map<string, SaveEntry>(),
  meta: new Map<string, unknown>(),
}));

vi.mock("@dreamfactory/engine/web/save-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@dreamfactory/engine/web/save-store")>()),
  putSave: async (e: SaveEntry) => void store.saves.set(e.path, e),
  getMeta: async (k: string) => store.meta.get(k),
  setMeta: async (k: string, v: unknown) => void store.meta.set(k, v),
}));

const { LUNICUS_SAVES, seedLunicusSaves } = await import("../src/saves");

const SAVE_DIR = join(import.meta.dirname, "../gamefiles/save");

const game = (o: Partial<SaveGameV0> = {}): Uint8Array =>
  writeSaveV0({ difficulty: 2, level: 6, came: 1, elevator: 0, progress: 1, score: 0, enemies: 0, energy: 10000, shields: 0, bullets: 0, grenades: 0, rockets: 0, ...o });

/** what the stubbed server holds, by URL; anything else is a 404 */
let served: Record<string, Uint8Array | "down"> = {};
let fetched: string[] = [];
const urlOf = (p: string): string => `/lunicus/gamefiles/${p}`;

beforeEach(() => {
  store.saves.clear();
  store.meta.clear();
  served = {};
  fetched = [];
  vi.stubGlobal("fetch", async (url: string) => {
    fetched.push(url);
    const hit = served[url];
    if (hit === "down") throw new TypeError("Failed to fetch");
    if (!hit) return { ok: false } as Response;
    return { ok: true, arrayBuffer: async () => hit.slice().buffer } as unknown as Response;
  });
});

const serveAll = (): void => {
  for (let d = 2; d <= 6; d++) served[urlOf(`save/day${d}.lun`)] = game({ level: 4 * d - 2 });
};

test("the five day saves go in once, as Day 2 … Day 6 in their own folder", async () => {
  serveAll();
  expect(await seedLunicusSaves(urlOf)).toBe(5);
  const saves = [...store.saves.values()];
  expect(saves.map((s) => [s.path, s.folder, s.name, s.builtin])).toEqual(
    [2, 3, 4, 5, 6].map((d) => [`days/day${d}.lun`, "days", `Day ${d}`, true]),
  );
  expect(LUNICUS_SAVES.folders[saves[0].folder]).toMatch(/made by this port/);
  expect(store.meta.get("seededDays")).toEqual([2, 3, 4, 5, 6].map((d) => `days/day${d}.lun`));
});

test("a second launch fetches nothing, and a deleted save stays deleted", async () => {
  serveAll();
  await seedLunicusSaves(urlOf);
  store.saves.delete("days/day3.lun");
  fetched = [];
  expect(await seedLunicusSaves(urlOf)).toBe(0);
  expect(fetched).toEqual([]);
  expect(store.saves.has("days/day3.lun")).toBe(false);
});

test("a save that did not arrive is not marked, and comes in on the next launch", async () => {
  serveAll();
  delete served[urlOf("save/day4.lun")];
  served[urlOf("save/day5.lun")] = "down";
  expect(await seedLunicusSaves(urlOf)).toBe(3);
  expect(store.meta.get("seededDays")).toEqual(["days/day2.lun", "days/day3.lun", "days/day6.lun"]);
  serveAll();
  fetched = [];
  expect(await seedLunicusSaves(urlOf)).toBe(2);
  expect(fetched).toEqual([urlOf("save/day4.lun"), urlOf("save/day5.lun")]);
});

test("a file the page has no URL for is not asked for, and nothing is written when nothing came", async () => {
  serveAll();
  expect(await seedLunicusSaves(() => null)).toBe(0);
  expect(fetched).toEqual([]);
  expect(store.meta.has("seededDays")).toBe(false);
});

test("only a real .LUN goes in: a wrong size, a difficulty past Expert, a level the game has not, a gauge past full", async () => {
  serveAll();
  served[urlOf("save/day2.lun")] = new Uint8Array(1040);
  served[urlOf("save/day3.lun")] = game({ difficulty: 5 });
  served[urlOf("save/day4.lun")] = game({ level: 23 });
  served[urlOf("save/day5.lun")] = game({ energy: 10001 });
  expect(await seedLunicusSaves(urlOf)).toBe(1);
  expect([...store.saves.keys()]).toEqual(["days/day6.lun"]);
  expect(store.meta.get("seededDays")).toEqual(["days/day6.lun"]);
  expect(LUNICUS_SAVES.valid(game())).toBe(true);
});

test("the shipped dayN.lun is a valid save that opens on day N", () => {
  if (!existsSync(SAVE_DIR)) {
    console.warn(`no ${SAVE_DIR} — skipping (written by the machine route: SAVES=gamefiles/save npm test -w lunicus -- day6)`);
    return;
  }
  for (let d = 2; d <= 6; d++) {
    const bytes = new Uint8Array(readFileSync(join(SAVE_DIR, `day${d}.lun`)));
    expect(LUNICUS_SAVES.valid(bytes), `day${d}.lun`).toBe(true);
    const s = readSaveV0(bytes);
    expect(dayOf(s.level), `day${d}.lun's level ${s.level}`).toBe(d);
  }
});
