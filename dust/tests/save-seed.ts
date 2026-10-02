/**
 * The shipped saves reaching a player's browser, and the base a first save is
 * patched into — `seedDustSaves` and `loadDustTemplate` (`src/saves.ts`).
 *
 *   npx vitest run dust/tests/save-seed.ts
 *
 * `saves.ts` beside this pins the FILES; this pins what the page does with
 * them, which until now only ever ran in a browser. Two promises, and each was
 * broken once in the play page's twin before anybody noticed:
 *
 *   - **a shipped save is offered exactly once.** New files arrive on the next
 *     launch, a file the player deleted stays deleted, and a launch that could
 *     not fetch one records nothing and tries again. The old one-boolean marker
 *     is migrated, not ignored, or an upgrade would re-offer every save.
 *   - **the template is the EARLIEST save, by the frame counter** — never the
 *     alphabetically first, which in the disc's collection is a day-4 save
 *     taken underground.
 *
 * The store is IndexedDB in the page and a Map here: `save-store` is replaced by
 * an in-memory twin with the same five calls, which is the whole of what this
 * module asks of it. The frame ordering needs the rip's saves and is skipped,
 * not failed, without them; everything else builds its own bytes.
 */
import { test, expect, beforeEach, vi } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { SaveEntry } from "@dreamfactory/engine/web/save-store";
import { parseSaveV1 } from "@dreamfactory/engine/df/savegame-v1";

/** the store, in memory — what `getMeta`/`setMeta`/`listSaves`/`putSave` see */
const store = vi.hoisted(() => ({
  saves: new Map<string, SaveEntry>(),
  meta: new Map<string, unknown>(),
}));

vi.mock("@dreamfactory/engine/web/save-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@dreamfactory/engine/web/save-store")>()),
  listSaves: async () => [...store.saves.values()],
  putSave: async (e: SaveEntry) => void store.saves.set(e.path, e),
  getMeta: async (k: string) => store.meta.get(k),
  setMeta: async (k: string, v: unknown) => void store.meta.set(k, v),
}));

const { DUST_SAVES, seedDustSaves, loadDustTemplate, dustTemplate } = await import("../src/saves");

const SAVE_DIR = fileURLToPath(new URL("../gamefiles/save", import.meta.url));

/**
 * The smallest file the import gate accepts: a save container's header and an
 * empty position table. Built here rather than read off the disc, because what
 * seeding decides is WHICH files to fetch, not what is inside them.
 */
function container(tag: number): Uint8Array {
  const b = new Uint8Array(1536);
  const dv = new DataView(b.buffer);
  dv.setInt32(0, 0x00010000, true);
  b.set([..."ODTRTRFD"].map((ch) => ch.charCodeAt(0)), 32);
  b[1535] = tag; // so two of them can be told apart
  return b;
}

/** what the stubbed server holds, by URL suffix; anything else is a 404 */
let served: Record<string, Uint8Array> = {};
let fetched: string[] = [];

beforeEach(() => {
  store.saves.clear();
  store.meta.clear();
  served = {};
  fetched = [];
  vi.stubGlobal("fetch", async (url: string) => {
    fetched.push(url);
    const hit = Object.entries(served).find(([k]) => url.endsWith(k));
    if (!hit) return { ok: false } as Response;
    return { ok: true, arrayBuffer: async () => hit[1].slice().buffer } as unknown as Response;
  });
});

const MANIFEST = [
  "gamefiles/dustcd/DATA/town.set",
  "gamefiles/save/D1E_002.RTD",
  "gamefiles/save/D1E_001.RTD",
];

test("the gate takes a save container and refuses anything else", () => {
  expect(DUST_SAVES.valid(container(0))).toBe(true);
  expect(() => DUST_SAVES.valid(new Uint8Array(1536))).toThrow(/not a save file/);
});

test("a first launch stores every shipped save under the disc's folder, and remembers each", async () => {
  served = { "D1E_001.RTD": container(1), "D1E_002.RTD": container(2) };
  expect(await seedDustSaves(MANIFEST)).toBe(2);

  const e = store.saves.get("disc/D1E_001.RTD")!;
  expect(e).toMatchObject({ folder: "disc", name: "D1E_001", builtin: true });
  expect(e.bytes[1535]).toBe(1);
  expect(new Set(store.meta.get("seededPaths") as string[])).toEqual(
    new Set(["disc/D1E_001.RTD", "disc/D1E_002.RTD"]),
  );
  // the old boolean too, so an older build reading this store still sees it
  expect(store.meta.get("seeded")).toBe(true);
});

test("a save the player deleted stays deleted, and a new one still arrives", async () => {
  served = { "D1E_001.RTD": container(1), "D1E_002.RTD": container(2) };
  await seedDustSaves(MANIFEST);
  store.saves.delete("disc/D1E_001.RTD");
  fetched = [];

  // the next launch, with a third save added to the disc's folder since
  served["D2A_001.RTD"] = container(3);
  expect(await seedDustSaves([...MANIFEST, "gamefiles/save/D2A_001.RTD"])).toBe(1);
  expect(store.saves.has("disc/D1E_001.RTD")).toBe(false);
  expect(store.saves.has("disc/D2A_001.RTD")).toBe(true);
  // and only the new one was fetched — the offered ones are not asked for again
  expect(fetched).toHaveLength(1);
});

test("a save that would not come down, or is not a save, is tried again next launch", async () => {
  served = { "D1E_002.RTD": new Uint8Array(1536) }; // not a container; D1E_001 is a 404
  expect(await seedDustSaves(MANIFEST)).toBe(0);
  expect(store.saves.size).toBe(0);
  // nothing landed, so nothing is marked — the marker only grows by what did
  expect(store.meta.has("seededPaths")).toBe(false);

  served = { "D1E_001.RTD": container(1), "D1E_002.RTD": container(2) };
  expect(await seedDustSaves(MANIFEST)).toBe(2);
});

test("a store from before the per-path marker keeps its deletions through the upgrade", async () => {
  // what the boolean-era build left: the marker, and the one save the player kept
  store.meta.set("seeded", true);
  store.saves.set("disc/D1E_002.RTD", {
    path: "disc/D1E_002.RTD", folder: "disc", name: "D1E_002",
    bytes: container(2), builtin: true, mtime: 0,
  });
  // a save of the player's own is not evidence of what was offered
  store.saves.set("mine.rtd", {
    path: "mine.rtd", folder: "", name: "mine", bytes: container(9), builtin: false, mtime: 0,
  });
  served = { "D1E_001.RTD": container(1), "D1E_002.RTD": container(2) };

  // D1E_002 is taken as offered; D1E_001 — deleted before the upgrade — comes
  // back the one time the migration's own note says it will
  expect(await seedDustSaves(MANIFEST)).toBe(1);
  expect(fetched.map((u) => u.split("/").pop())).toEqual(["D1E_001.RTD"]);
});

test("a manifest with no saves in it fetches nothing", async () => {
  expect(await seedDustSaves(["gamefiles/dustcd/DATA/town.set"])).toBe(0);
  expect(fetched).toEqual([]);
});

test("with no shipped save at all, there is no template, and saving can say so", async () => {
  store.saves.set("mine.rtd", {
    path: "mine.rtd", folder: "", name: "mine", bytes: container(9), builtin: false, mtime: 0,
  });
  await loadDustTemplate();
  // a player's own save is not a lender: its untouched fields are some other run's
  expect(dustTemplate()).toBeNull();
});

test("shipped saves this reader cannot parse still lend a base, the alphabetically first", async () => {
  for (const [name, tag] of [["ZZZ", 1], ["AAA", 2]] as const) {
    store.saves.set(`disc/${name}.RTD`, {
      path: `disc/${name}.RTD`, folder: "disc", name, bytes: container(tag), builtin: true, mtime: 0,
    });
  }
  await loadDustTemplate();
  // any base beats none — a base with the wrong untouched fields still saves
  expect(dustTemplate()?.[1535]).toBe(2);
});

test("the template is the earliest shipped save by the frame counter, not by name", async () => {
  const files = existsSync(SAVE_DIR) ? readdirSync(SAVE_DIR).filter((f) => /\.rtd$/i.test(f)) : [];
  if (!files.length) {
    console.warn(`no ${SAVE_DIR} — skipping (needs the Dust rip)`);
    return;
  }
  let earliest = { bytes: new Uint8Array(), name: "", frame: Infinity };
  for (const f of files) {
    const bytes = new Uint8Array(readFileSync(join(SAVE_DIR, f)));
    const name = f.replace(/\.rtd$/i, "");
    store.saves.set(`disc/${f}`, { path: `disc/${f}`, folder: "disc", name, bytes, builtin: true, mtime: 0 });
    const frame = parseSaveV1(bytes).frame;
    if (frame < earliest.frame) earliest = { bytes, name, frame };
  }
  const alphabetical = [...files].sort()[0].replace(/\.rtd$/i, "");
  // the claim is only worth making where the two answers differ
  expect(earliest.name).not.toBe(alphabetical);

  await loadDustTemplate();
  expect(dustTemplate()).toBe(earliest.bytes);
});
