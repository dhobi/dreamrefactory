/**
 * RedJack's saved games on the page (`src/saves.ts`): which files the shared
 * save dialog takes as RedJack's, and the seven port-made day saves put into its
 * list once.
 *
 *   npx vitest run --project redjack redjack/tests/saves.ts
 *
 * The store itself is IndexedDB (engine/src/web/save-store.ts), which node has
 * not got, so it is stood in for by a map; what is pinned is this game's side of
 * it. The seeding runs on every page load, so "once" is the claim that matters:
 * a day the player deleted must not come back, and a day the server could not
 * give this time must be tried again next time. The bytes are a real v5 save,
 * written by the engine's own writer — the one check the store makes of a file
 * is that it is one.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { TABLE, writeSaveV5 } from "@dreamfactory/engine/df/savegame-v5";

const store = vi.hoisted(() => ({
  saves: new Map<string, { path: string; folder: string; name: string; bytes: Uint8Array; builtin: boolean }>(),
  meta: new Map<string, unknown>(),
}));

vi.mock("@dreamfactory/engine/web/save-store", () => ({
  getMeta: async (key: string) => store.meta.get(key),
  setMeta: async (key: string, value: unknown) => void store.meta.set(key, value),
  putSave: async (entry: { path: string; folder: string; name: string; bytes: Uint8Array; builtin: boolean }) =>
    void store.saves.set(entry.path, entry),
}));

const { REDJACK_SAVES, seedRedJackSaves } = await import("../src/saves");

/** the seven saves `tools/mksaves.mts` writes; a rip, so absent on CI */
const SHIPPED = fileURLToPath(new URL("../gamefiles/save", import.meta.url));

const slots = (t: { slots: number; stride: number }): Uint8Array => new Uint8Array(t.slots * t.stride);

/** the smallest save the engine writes: a room open and nothing in it */
const SAVE = writeSaveV5({
  version: "2",
  disc: "RJDisk1",
  paths: ["C:\\RedJack\\", "", "", "", "", "", "", "", ""],
  files: [],
  themeTrack: 0,
  soundTrack: 0,
  soundContainer: 0,
  runt: {
    frame: 1, framerate: 3, setOpen: true, setVisible: true, setHandle: 1, setName: "liznite", scene: "Scene1", view: "node",
    deg: 0, pitch: 0, roll: 0, fov: 4_194_304, stageOpen: false, stageHandle: 0, stageName: "", flat: 0,
  },
  actors: [],
  casts: [],
  props: [],
  shops: [],
  tracks: [],
  globals: [{ name: "day", value: 1, arraySize: 0, index: 0 }],
  loops: slots(TABLE.loops),
  crickets: slots(TABLE.crickets),
  walks: slots(TABLE.walks),
  routes: [],
  copies: slots(TABLE.copies),
});

/** a fresh response carrying the save (a body is read once) */
const saveResponse = (): Response => new Response(new Uint8Array(SAVE));

/** the page's file index: `dayN.save` → its URL, for the days it has */
const urlsFor = (days: number[]) => (name: string): string | null => {
  const day = Number(/^day(\d)\.save$/.exec(name)?.[1]);
  return days.includes(day) ? `https://example.test/gamefiles/save/${name}` : null;
};

let served: (url: string) => Response;
let fetched: string[];

beforeEach(() => {
  store.saves.clear();
  store.meta.clear();
  fetched = [];
  served = () => saveResponse();
  vi.stubGlobal("fetch", async (url: string) => {
    fetched.push(url);
    return served(url);
  });
  return () => vi.unstubAllGlobals();
});

describe("RedJack's kind of save", () => {
  it("takes a v5 save and refuses anything else", () => {
    expect(REDJACK_SAVES.valid(SAVE)).toBe(true);
    expect(REDJACK_SAVES.valid(new Uint8Array(64))).toBe(false);
    expect(REDJACK_SAVES.valid(new TextEncoder().encode("not a save at all"))).toBe(false);
  });

  // the day saves are written by tools/mksaves.mts, not shipped in the rip: a
  // rip with an empty save/ folder (the CI runner's) has nothing to check
  const DAYS = [1, 2, 3, 4, 5, 6, 7].map((day) => `${SHIPPED}/day${day}.save`);
  it.skipIf(!DAYS.every((f) => existsSync(f)))("takes every day save the port ships (needs tools/mksaves.mts's output)", () => {
    // what tools/mksaves.mts wrote: if the store refused one, the dialog would
    // silently list six days
    for (const f of DAYS) expect(REDJACK_SAVES.valid(new Uint8Array(readFileSync(f))), f).toBe(true);
  });

  it("keeps the player's saves apart from the port's, and lists the player's first", () => {
    expect(REDJACK_SAVES.ext).toBe(".save");
    expect(REDJACK_SAVES.order).toEqual(["", "days"]);
    expect(Object.keys(REDJACK_SAVES.folders).sort()).toEqual(["", "days"]);
    expect(REDJACK_SAVES.folders.days).toMatch(/made by this port/);
  });
});

describe("seeding the seven days", () => {
  it("puts each day the server has into the port's folder, named for the day", async () => {
    expect(await seedRedJackSaves(urlsFor([1, 2, 3, 4, 5, 6, 7]))).toBe(7);
    expect([...store.saves.keys()]).toEqual([1, 2, 3, 4, 5, 6, 7].map((d) => `days/day${d}.save`));
    const day3 = store.saves.get("days/day3.save")!;
    expect(day3).toMatchObject({ folder: "days", name: "Day 3", builtin: true });
    expect(day3.bytes).toEqual(SAVE);
    expect(store.meta.get("seededDays")).toHaveLength(7);
  });

  it("does it once: a day already seeded is not fetched or stored again", async () => {
    await seedRedJackSaves(urlsFor([1, 2]));
    // the player deletes Day 1; the next page load must not bring it back
    store.saves.delete("days/day1.save");
    fetched = [];
    expect(await seedRedJackSaves(urlsFor([1, 2]))).toBe(0);
    expect(fetched).toEqual([]);
    expect(store.saves.has("days/day1.save")).toBe(false);
  });

  it("skips a day the index does not have, and seeds it once a later rip does", async () => {
    expect(await seedRedJackSaves(urlsFor([1, 3]))).toBe(2);
    expect([...store.saves.keys()]).toEqual(["days/day1.save", "days/day3.save"]);
    expect(await seedRedJackSaves(urlsFor([1, 2, 3]))).toBe(1);
    expect(store.saves.has("days/day2.save")).toBe(true);
    expect(store.meta.get("seededDays")).toEqual(["days/day1.save", "days/day3.save", "days/day2.save"]);
  });

  it("does not list a day that did not arrive, did not parse or threw, and tries it again next time", async () => {
    served = (url) => {
      if (url.endsWith("day1.save")) return new Response(null, { status: 404 });
      if (url.endsWith("day2.save")) return new Response(new Uint8Array(32));
      if (url.endsWith("day3.save")) throw new TypeError("network down");
      return saveResponse();
    };
    expect(await seedRedJackSaves(urlsFor([1, 2, 3, 4]))).toBe(1);
    expect([...store.saves.keys()]).toEqual(["days/day4.save"]);
    served = () => saveResponse();
    expect(await seedRedJackSaves(urlsFor([1, 2, 3, 4]))).toBe(3);
    expect(store.saves.size).toBe(4);
  });

  it("writes nothing to the store's notes when nothing was seeded", async () => {
    expect(await seedRedJackSaves(urlsFor([]))).toBe(0);
    expect(store.meta.has("seededDays")).toBe(false);
  });
});
