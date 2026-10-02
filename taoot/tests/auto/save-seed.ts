/**
 * Seeding the save browser from the shipped saves, and lending a fresh game a
 * shipped save to write over (`taoot/src/save-seed.ts`).
 *
 * The store holds ONE language's shipped saves at a time. The eight files are at
 * the same relative paths in every tree, so seeding German over English would
 * leave a German `1/01` under an English name — a switch has to REPLACE the
 * builtin saves, keep the player's own, and forget the template ranking that was
 * about the old files. And the seed marker is the retry logic: it is written
 * only when something was actually stored, so a launch without the files served
 * leaves the next launch free to try again.
 *
 * The template ranking reads 5 MB of `.ti` and costs ~170 ms, so its ANSWER is
 * stored and a later launch must use it without ranking again.
 *
 * IndexedDB is not in node, so the save store is replaced by an in-memory one
 * with the same five calls; `globalsCapacity` is replaced by one that reads a
 * save's capacity off its first byte and counts how often it is asked, which is
 * what the "paid for once" claim is about. The ranking itself, over real saves,
 * is savegame.ts's.
 */
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { SaveEntry } from "@dreamfactory/engine/web/save-store";

const saves = new Map<string, SaveEntry>();
const meta = new Map<string, unknown>();
let rankings = 0;

vi.mock("@dreamfactory/engine/web/save-store", async (actual) => ({
  ...(await actual<typeof import("@dreamfactory/engine/web/save-store")>()),
  listSaves: async () => [...saves.values()],
  putSave: async (e: SaveEntry) => void saves.set(e.path, e),
  deleteSave: async (p: string) => void saves.delete(p),
  getMeta: async (k: string) => meta.get(k),
  setMeta: async (k: string, v: unknown) => void meta.set(k, v),
}));

vi.mock("@dreamfactory/engine/df/savegame", async (actual) => ({
  ...(await actual<typeof import("@dreamfactory/engine/df/savegame")>()),
  globalsCapacity: (bytes: Uint8Array) => {
    rankings++;
    return { records: bytes[0], free: 0 };
  },
}));

const { loadTemplates, saveTemplateFor, seedSaves } = await import("../../src/save-seed");

/** a manifest with both languages' shipped saves, as gamefiles.json lists them */
const MANIFEST = [
  "gamefiles/en/save/1/01 - The Bedsit.ti",
  "gamefiles/en/save/2/05 - The Lifeboat.ti",
  "gamefiles/de/save/1/01 - Das Zimmer.ti",
  "gamefiles/de/TITANIC1/data/bedsit1.set",
];

/** what each fetched URL was, by the first byte the fake server put in it */
let fetched: string[] = [];
let offline = false;

beforeEach(() => {
  saves.clear();
  meta.clear();
  rankings = 0;
  fetched = [];
  offline = false;
  vi.stubGlobal("fetch", async (url: string) => {
    fetched.push(decodeURIComponent(url));
    if (offline) return { ok: false, status: 404 } as Response;
    if (url.includes("Lifeboat")) throw new Error("connection reset");
    return { ok: true, arrayBuffer: async () => new Uint8Array([fetched.length]).buffer } as unknown as Response;
  });
});
afterEach(() => vi.unstubAllGlobals());

const builtins = () =>
  [...saves.values()]
    .filter((s) => s.builtin)
    .map((s) => `${s.folder}|${s.name}`)
    .sort();

test("seeding stores each shipped save under its folder and display name, and marks the store", async () => {
  await seedSaves(MANIFEST, "en");
  // the Lifeboat fetch failed and is skipped; the rest still went in
  expect(builtins()).toEqual(["1|01 - The Bedsit"]);
  expect(saves.get("1/01 - The Bedsit.ti")!.builtin).toBe(true);
  expect(meta.get("seeded")).toBe(true);
  expect(meta.get("seeded.lang")).toBe("en");
});

test("a seeded store is not seeded again for the same language", async () => {
  await seedSaves(MANIFEST, "en");
  const before = fetched.length;
  await seedSaves(MANIFEST, "en");
  expect(fetched.length).toBe(before);
});

test("nothing stored means no marker, so a later launch can still seed", async () => {
  offline = true;
  await seedSaves(MANIFEST, "en");
  expect(saves.size).toBe(0);
  expect(meta.has("seeded")).toBe(false);
  // an install with no saves at all is not a fetch either
  fetched = [];
  await seedSaves(["gamefiles/en/TITANIC1/data/bedsit1.set"], "en");
  expect(fetched).toEqual([]);
  expect(meta.has("seeded")).toBe(false);
});

test("switching language replaces the shipped saves, keeps the player's, and forgets the template pick", async () => {
  await seedSaves(MANIFEST, "en");
  saves.set("mine.ti", { path: "mine.ti", folder: "", name: "mine", bytes: new Uint8Array([9]), builtin: false, mtime: 1 });
  meta.set("template.pick", { d1: "1/01 - The Bedsit.ti" });
  await seedSaves(MANIFEST, "de");
  expect(builtins()).toEqual(["1|01 - Das Zimmer"]);
  expect(saves.has("mine.ti")).toBe(true);
  expect(meta.get("template.pick")).toBeUndefined();
  expect(meta.get("seeded.lang")).toBe("de");
});

/** a builtin save of a disc folder, whose capacity is its first byte */
function shipped(folder: string, name: string, capacity: number): SaveEntry {
  const path = `${folder}/${name}.ti`;
  return { path, folder, name, bytes: new Uint8Array([capacity]), builtin: true, mtime: 0 };
}

test("the templates are ranked once and the answer is stored", async () => {
  for (const s of [shipped("1", "early", 10), shipped("1", "late", 40), shipped("ENDGAME2", "end", 30)]) {
    saves.set(s.path, s);
  }
  await loadTemplates();
  expect(rankings).toBe(3);
  expect(meta.get("template.pick")).toEqual({ d1: "1/late.ti", d2: "ENDGAME2/end.ti" });
  expect(saveTemplateFor("1")![0]).toBe(40);
  expect(saveTemplateFor("2")![0]).toBe(30);

  // the next launch reads the stored answer and ranks nothing
  rankings = 0;
  await loadTemplates();
  expect(rankings).toBe(0);
  expect(saveTemplateFor("1")![0]).toBe(40);
});

test("a stored pick whose save has gone is ranked again", async () => {
  saves.set("1/a.ti", shipped("1", "a", 5));
  saves.set("2/b.ti", shipped("2", "b", 7));
  meta.set("template.pick", { d1: "1/deleted.ti", d2: "2/b.ti" });
  await loadTemplates();
  expect(meta.get("template.pick")).toEqual({ d1: "1/a.ti", d2: "2/b.ti" });
  // only disc 1 needed ranking
  expect(rankings).toBe(1);
});

test("a template for the other disc is lent when the wanted one is missing", async () => {
  saves.set("1/a.ti", shipped("1", "a", 5));
  await loadTemplates();
  expect(saveTemplateFor("2")![0]).toBe(5);
  expect(saveTemplateFor("1")![0]).toBe(5);
  // and with no shipped saves at all there is nothing to lend, and nothing stored
  saves.clear();
  meta.clear();
  await loadTemplates();
  expect(saveTemplateFor("1")).toBeNull();
  expect(meta.has("template.pick")).toBe(false);
});
