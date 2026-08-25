/**
 * The player's photographs, in IndexedDB.
 *
 * A photograph is the one thing this engine produces that the PLAYER made, and
 * the only one the original kept outside a saved game: `camera.fil` sits in the
 * install folder next to the BOOTFILE, and deleting it is how you empty the
 * album (`if not fileexists ("camera.fil") pictotal = 0`). So the album has to
 * outlive the page the way that file outlived the process, and `localStorage` is
 * the wrong shape for it — a 320x240 shot is 300 KB of RGBA, and a full 36
 * exposures is 10.5 MB against a quota measured in single-digit megabytes and
 * shared with everything else the shell keeps.
 *
 * What is stored is what {@link PhotoAlbum} holds: RGBA, one record per photo,
 * keyed by the id `docamera` rolled for it. Not `camera.fil`'s own column-major
 * indexed layout — see `engine/src/runtime/photos.ts` for that format and why
 * reproducing it here would only cost a needless quantisation.
 *
 * ## Everything here is allowed to fail
 *
 * A private window, a browser with site data blocked, a quota that is already
 * full, a schema from a future build: every one of those is a real thing a real
 * player will hit, and none of them may cost them the shot they just took.
 * {@link PhotoAlbum} keeps the picture in memory first and treats this store as
 * best-effort, so a failure here costs persistence and nothing else.
 */
import type { Photo, PhotoStore } from "../runtime/photos";

const DB_NAME = "dreamfactory-photos";
const DB_VERSION = 1;
const STORE = "photos";

/** the shape actually written — a plain object, so structured clone is happy */
interface PhotoRecord {
  id: number;
  width: number;
  height: number;
  /** RGBA, as a plain buffer: an ArrayBuffer clones and a clamped view does not
   *  need to be reconstructed on the way back */
  rgba: ArrayBuffer;
  /** when it was taken, so a future album can sort by it */
  taken: number;
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("indexedDB.open failed"));
    // A blocked upgrade means another tab of the same game holds the old
    // version. Rejecting is right: the album degrades to this session, which is
    // much better than hanging the shutter on a promise that never settles.
    req.onblocked = () => reject(new Error("another tab is holding the album open"));
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = tx.onerror = () => reject(tx.error ?? new Error("transaction failed"));
  });
}

/**
 * The store, or `null` where there is no IndexedDB to put it in — a headless
 * run, a worker without it, a browser that has switched it off. Callers hand the
 * result straight to {@link PhotoAlbum.store}, which treats null as "this
 * session only".
 */
export function indexedDbPhotoStore(): PhotoStore | null {
  // `typeof` rather than a truthiness test: in a headless build the identifier
  // is not declared at all, and touching it would throw rather than be falsy.
  if (typeof indexedDB === "undefined") return null;

  /** one connection, opened on first use and shared */
  let db: Promise<IDBDatabase> | null = null;
  const conn = (): Promise<IDBDatabase> => (db ??= open());

  return {
    async all(): Promise<Map<number, Photo>> {
      const database = await conn();
      const tx = database.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).getAll();
      const rows = await new Promise<PhotoRecord[]>((resolve, reject) => {
        req.onsuccess = () => resolve(req.result as PhotoRecord[]);
        req.onerror = () => reject(req.error ?? new Error("getAll failed"));
      });
      await done(tx);
      const out = new Map<number, Photo>();
      for (const row of rows) {
        // A record whose pixels do not match its own dimensions is a record from
        // a build that stored something else. Skipped rather than trusted: the
        // renderer blits by width and height and would read off the end.
        if (!row || row.rgba?.byteLength !== row.width * row.height * 4) continue;
        out.set(row.id, {
          rgba: new Uint8ClampedArray(row.rgba),
          width: row.width,
          height: row.height,
        });
      }
      return out;
    },

    async put(id: number, photo: Photo): Promise<void> {
      const database = await conn();
      const tx = database.transaction(STORE, "readwrite");
      // `.slice()` so the stored buffer is this photo's own: the album keeps its
      // copy live, and a view onto a larger buffer would clone the whole thing.
      const rec: PhotoRecord = {
        id,
        width: photo.width,
        height: photo.height,
        rgba: photo.rgba.slice().buffer,
        taken: Date.now(),
      };
      tx.objectStore(STORE).put(rec);
      await done(tx);
    },
  };
}
