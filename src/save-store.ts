/**
 * IndexedDB-backed "file system" for `.ti` saved games.
 *
 * The engine treats saves as opaque byte blobs identified by a path (see
 * `df/savegame.ts`); this module is the browser-side store that stands in for
 * TI.EXE's SAVE folder. It holds one record per save, keyed by a virtual path
 * (`<folder>/<name>.ti`, or just `<name>.ti` for user saves at the root), and is
 * seeded once from the shipped saves tree (`gamefiles/<lang>/save/`) (see `save-seed.ts`).
 *
 * A tiny second store (`meta`) records the one-time seed marker so deleting a
 * shipped save doesn't cause it to reappear on the next launch.
 */

const DB_NAME = "taoot-saves";
const DB_VERSION = 1;
const SAVES = "saves";
const META = "meta";

/** One saved game in the store. `path` is the primary key. */
export interface SaveEntry {
  /** virtual path / primary key, e.g. "1/03 - Found the Gymnasium.ti". */
  path: string;
  /** shipped sub-folder ("1" | "2" | "ENDGAME1" | "ENDGAME2"), or "" for user saves. */
  folder: string;
  /** display name — the file's basename without the `.ti` extension. */
  name: string;
  /** the raw `.ti` file bytes. */
  bytes: Uint8Array;
  /** true for saves seeded from the shipped save folder, false for user-made/uploaded ones. */
  builtin: boolean;
  /** creation/modification time (epoch ms), used to sort user saves newest-first. */
  mtime: number;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(SAVES)) db.createObjectStore(SAVES, { keyPath: "path" });
      if (!db.objectStoreNames.contains(META)) db.createObjectStore(META);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("indexedDB.open failed"));
  });
  return dbPromise;
}

/** Promisify a single-request transaction. */
function txRequest<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("indexedDB request failed"));
  });
}

/** All saves in the store (unsorted — callers group/sort for display). */
export async function listSaves(): Promise<SaveEntry[]> {
  const db = await openDB();
  const store = db.transaction(SAVES, "readonly").objectStore(SAVES);
  return txRequest(store.getAll() as IDBRequest<SaveEntry[]>);
}

/** One save by path, or undefined if absent. */
export async function getSave(path: string): Promise<SaveEntry | undefined> {
  const db = await openDB();
  const store = db.transaction(SAVES, "readonly").objectStore(SAVES);
  return txRequest(store.get(path) as IDBRequest<SaveEntry | undefined>);
}

/** Insert or replace a save. */
export async function putSave(entry: SaveEntry): Promise<void> {
  const db = await openDB();
  const store = db.transaction(SAVES, "readwrite").objectStore(SAVES);
  await txRequest(store.put(entry));
}

/** Remove a save by path. */
export async function deleteSave(path: string): Promise<void> {
  const db = await openDB();
  const store = db.transaction(SAVES, "readwrite").objectStore(SAVES);
  await txRequest(store.delete(path));
}


/** Read a meta flag (e.g. the seed marker). */
export async function getMeta<T>(key: string): Promise<T | undefined> {
  const db = await openDB();
  const store = db.transaction(META, "readonly").objectStore(META);
  return txRequest(store.get(key) as IDBRequest<T | undefined>);
}

/** Write a meta flag. */
export async function setMeta(key: string, value: unknown): Promise<void> {
  const db = await openDB();
  const store = db.transaction(META, "readwrite").objectStore(META);
  await txRequest(store.put(value, key));
}

/** Split a save file basename into its display name (drop a trailing `.ti`). */
export function displayName(basename: string): string {
  return basename.replace(/\.ti$/i, "");
}
