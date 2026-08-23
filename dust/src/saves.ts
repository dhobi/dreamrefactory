/**
 * Dust's saved games: the store's Dust dimension, and the one-time seeding of
 * the five saves that ship beside the disc.
 *
 * Dust writes `.rtd` where Titanic writes `.ti`, and the two are the SAME
 * container skeleton — a 1024-byte header with `fourCC 0x00010000` and the
 * signature `ODTRTRFD` at 32, a 128-entry position table, container 0 at 1536
 * and every later one aligned to 64. `df/savegame.ts`'s `readSaveFile` and
 * `writeSaveFile` therefore take Dust's files unchanged, and round-trip all five
 * shipped ones byte-identically; only the records INSIDE the containers are the
 * v1 engine's own. So this module needs no framing code, and the import gate is
 * the shared reader.
 *
 * The saves live at `gamefiles/save/*.RTD` and are listed in this page's own
 * manifest (`gamefiles.json`, at its own site root), so seeding is the same
 * trick the play page uses: fetch what the manifest already told us is there. They are real
 * saves from the original DOS game, which matters for more than convenience —
 * a save is a serialized heap that cannot be written from nothing, so one of
 * them is also the base a fresh playthrough's first save is patched into
 * (see {@link dustTemplate}).
 */

import { readSaveFile } from "@dreamfactory/engine/df/savegame";
import { SaveEntry, SaveKind, getMeta, getSave, listSaves, putSave, setMeta } from "@dreamfactory/engine/web/save-store";
import { siteUrl } from "@dreamfactory/site/site";

/** Dust's saves: its own IndexedDB database, its own extension. */
export const DUST_SAVES: SaveKind = {
  db: "dust-saves",
  ext: ".rtd",
  game: "Dust",
  folders: {
    "": "My Saves",
    disc: "From the disc",
  },
  order: ["", "disc"],
  valid: (bytes) => {
    // the shared framing reader: throws on anything that is not a save
    // container, which is exactly what this gate is for
    readSaveFile(bytes);
    return true;
  },
};

/** the folder the shipped saves are grouped under in the browser */
const DISC = "disc";

/**
 * The shipped saves in a manifest listing, as `{ rel, url, name }`.
 *
 * Pure, so it can be tested without IndexedDB or a network — the play page's
 * equivalent regressed once precisely because the pattern was only ever
 * exercised through the browser (see `save-seed.ts`).
 *
 * Narrow and case-insensitive on purpose: `gamefiles/save/` is the one
 * place these live (the disc itself is `gamefiles/dustcd/`, and a `.RTD`
 * found in there would be the game's, not the player's), and the files came off
 * a DOS installation, so their names are upper case.
 */
export function shippedDustSaves(manifestPaths: string[]): { rel: string; url: string; name: string }[] {
  const found: { rel: string; url: string; name: string }[] = [];
  for (const path of manifestPaths) {
    const m = /(?:^|\/)gamefiles\/save\/([^/]+\.rtd)$/i.exec(path);
    if (!m) continue;
    const base = m[1];
    found.push({
      rel: `${DISC}/${base}`,
      url: siteUrl(path),
      name: base.replace(/\.rtd$/i, ""),
    });
  }
  return found.sort((a, b) => a.name.localeCompare(b.name));
}

/** meta key: the shipped saves have been imported once */
const SEEDED = "seeded";

/**
 * Import the shipped saves into the store, once ever. Best-effort and
 * idempotent: a page that cannot reach them leaves the marker unset and tries
 * again next launch, which is why the marker is only written when something
 * actually landed. Returns how many were stored.
 *
 * A player who deletes one does NOT get it back on the next boot — that is the
 * marker's whole point. It is a file system, and a deleted file stays deleted.
 */
export async function seedDustSaves(manifestPaths: string[]): Promise<number> {
  if (await getMeta<boolean>(SEEDED)) return 0;
  const sources = shippedDustSaves(manifestPaths);
  if (!sources.length) return 0;
  let stored = 0;
  for (const { rel, url, name } of sources) {
    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      const bytes = new Uint8Array(await res.arrayBuffer());
      DUST_SAVES.valid(bytes); // a file that is not a save is not worth storing
      const entry: SaveEntry = {
        path: rel,
        folder: DISC,
        name,
        bytes,
        builtin: true,
        mtime: Date.now(),
      };
      await putSave(entry);
      stored++;
    } catch {
      /* skip this one — a save that will not parse is not one we can load */
    }
  }
  if (stored) await setMeta(SEEDED, true);
  return stored;
}

/** the base save a fresh playthrough's first save is patched into */
let template: Uint8Array | null = null;

/**
 * Cache a base save for {@link dustTemplate}, preferring the disc's own START.
 *
 * A save cannot be built from nothing — it is a dump of the engine's live C++
 * object graph, pointers and all — so writing one means patching a real file
 * (see `docs/engine/formats/savegame.md`). Once a game has been loaded from a file that
 * file is the base; before that, there has to be a lender, and START.RTD is the
 * honest choice: it is the beginning of the game, so the fields a patch does not
 * understand carry the beginning's values rather than some other run's.
 *
 * Falls back to whatever shipped save is present, because a base with the wrong
 * untouched fields still saves a game, and no base at all does not.
 */
export async function loadDustTemplate(): Promise<void> {
  const start = await getSave(`${DISC}/START.RTD`);
  if (start) {
    template = start.bytes;
    return;
  }
  const shipped = (await listSaves()).filter((s) => s.builtin).sort((a, b) => a.name.localeCompare(b.name));
  template = shipped[0]?.bytes ?? null;
}

/** the cached base save, or null if none was found (saving then reports so) */
export function dustTemplate(): Uint8Array | null {
  return template;
}
