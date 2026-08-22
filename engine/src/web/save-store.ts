/**
 * IndexedDB-backed "file system" for saved games — Titanic's `.ti` and Dust's
 * `.rtd`, one database each (see {@link SaveKind}).
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

const DB_VERSION = 1;
const SAVES = "saves";
const META = "meta";

/**
 * Which game's saves this page keeps, and what its files are called.
 *
 * Two games share this store now — Titanic writes `.ti`, Dust writes `.rtd` —
 * and they get a DATABASE EACH rather than a shared one with a `game` column.
 * The column would have been less code and the wrong shape: every read would
 * have to remember to filter (a forgotten `where` puts a Dust save in Titanic's
 * Load dialog, where picking it can only fail), the existing `taoot-saves`
 * database would need a migration to backfill the new field, and the two games
 * have no query that spans them. Separate databases make the isolation
 * structural — Titanic's store is not just unfiltered but unreachable from the
 * Dust page — and leave every save already in a player's browser exactly where
 * it is.
 *
 * A page declares its kind once, at boot, before the first store call
 * ({@link useSaveKind}); the default is Titanic's, so the play page says
 * nothing and is unaffected.
 */
export interface SaveKind {
  /** IndexedDB database name — one per game, see above */
  db: string;
  /** the game's save extension, lowercase and with the dot */
  ext: string;
  /** the game, for UI copy that has to name it ("Titanic", "Dust") */
  game: string;
  /** folder group → heading, for the browser's grouped list */
  folders: Record<string, string>;
  /** the order those groups are shown in; unknown folders sort after */
  order: string[];
  /**
   * Does this look like one of OUR save files? Throws or returns false if not.
   *
   * Injected rather than imported, because the two games' parsers are separate
   * modules and this store is neither's: the play page hands in the `.ti`
   * reader, the Dust page the `.rtd` one. It guards the IMPORT button, so its
   * only job is to keep a file that cannot be loaded out of the list.
   */
  valid: (bytes: Uint8Array) => boolean;
}

/** Titanic's saves — the default, so the play page declares nothing. */
export const TAOOT_SAVES: SaveKind = {
  db: "taoot-saves",
  ext: ".ti",
  game: "Titanic",
  folders: {
    "": "My Saves",
    "1": "Disk 1",
    "2": "Disk 2",
    ENDGAME1: "Endgame (Disk 1)",
    ENDGAME2: "Endgame (Disk 2)",
  },
  order: ["", "1", "2", "ENDGAME1", "ENDGAME2"],
  valid: () => true,
};

let kind: SaveKind = TAOOT_SAVES;

/**
 * Declare which game's saves this page keeps. Call once at boot, before any
 * other call here: it drops the cached connection, so calling it later would
 * strand whatever was already read from the other database.
 */
export function useSaveKind(k: SaveKind): void {
  if (k.db === kind.db && k.ext === kind.ext) {
    kind = k;
    return;
  }
  kind = k;
  dbPromise = null;
}

/** The kind this page declared (Titanic's until told otherwise). */
export function saveKind(): SaveKind {
  return kind;
}

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
    const req = indexedDB.open(kind.db, DB_VERSION);
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

/** Split a save file basename into its display name (drop the extension). */
export function displayName(basename: string): string {
  const ext = kind.ext.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return basename.replace(new RegExp(`${ext}$`, "i"), "");
}
