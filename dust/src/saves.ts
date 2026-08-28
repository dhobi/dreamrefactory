/**
 * Dust's saved games: the store's Dust dimension, and the seeding of the saves
 * that ship beside the disc.
 *
 * Dust writes `.rtd` where Titanic writes `.ti`, and the two are the SAME
 * container skeleton — a 1024-byte header with `fourCC 0x00010000` and the
 * signature `ODTRTRFD` at 32, a 128-entry position table, container 0 at 1536
 * and every later one aligned to 64. `df/savegame.ts`'s `readSaveFile` and
 * `writeSaveFile` therefore take Dust's files unchanged, and round-trip every
 * shipped one byte-identically; only the records INSIDE the containers are the
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
import { parseSaveV1 } from "@dreamfactory/engine/df/savegame-v1";
import { SaveEntry, SaveKind, getMeta, listSaves, putSave, setMeta } from "@dreamfactory/engine/web/save-store";
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

/** meta key: which shipped saves have been imported, by store path */
const SEEDED_PATHS = "seededPaths";

/**
 * Which shipped saves this browser has already been offered.
 *
 * Seeding used to be gated on one boolean — *have we ever seeded?* — which was
 * right while the shipped set was fixed and wrong as soon as it was not. Adding
 * a save to `gamefiles/save/` after a first launch left it invisible forever,
 * with no symptom except that it never appeared, and the only cure was deleting
 * the database by hand.
 *
 * A set of paths answers the question the boolean was standing in for. A save is
 * offered exactly once: new files arrive on the next launch, and a file the
 * player deleted stays deleted, because its path is in the set whether or not it
 * is in the store.
 *
 * **Migrating from the boolean**, once: the paths already in the store are taken
 * as the ones already offered. A player who had deleted a shipped save before
 * this upgrade gets that one back a single time — a one-launch cost, and the
 * alternative is marking files as offered that never were.
 */
async function seededPaths(): Promise<Set<string>> {
  const stored = await getMeta<string[]>(SEEDED_PATHS);
  if (stored) return new Set(stored);
  if (await getMeta<boolean>(SEEDED)) {
    return new Set((await listSaves()).filter((s) => s.builtin).map((s) => s.path));
  }
  return new Set();
}

/**
 * Import any shipped save this browser has not been offered before. Best-effort:
 * a page that cannot reach them records nothing and tries again next launch,
 * which is why the marker only grows by what actually landed. Returns how many
 * were stored.
 *
 * A player who deletes one does NOT get it back on the next boot. It is a file
 * system, and a deleted file stays deleted.
 */
export async function seedDustSaves(manifestPaths: string[]): Promise<number> {
  const sources = shippedDustSaves(manifestPaths);
  if (!sources.length) return 0;
  const seen = await seededPaths();
  const fresh = sources.filter((s) => !seen.has(s.rel));
  if (!fresh.length) return 0;
  let stored = 0;
  for (const { rel, url, name } of fresh) {
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
      seen.add(rel);
      stored++;
    } catch {
      /* skip this one — a save that will not parse is not one we can load */
    }
  }
  if (stored) {
    await setMeta(SEEDED_PATHS, [...seen]);
    await setMeta(SEEDED, true); // an older build reading this store still sees it
  }
  return stored;
}

/** the base save a fresh playthrough's first save is patched into */
let template: Uint8Array | null = null;

/**
 * Cache a base save for {@link dustTemplate}: the EARLIEST shipped save there is.
 *
 * A save cannot be built from nothing — it is a dump of the engine's live C++
 * object graph, pointers and all — so writing one means patching a real file
 * (see `docs/engine/formats/savegame.md`). Once a game has been loaded from a file that
 * file is the base; before that, there has to be a lender, and the beginning of
 * the game is the honest choice: the fields a patch does not understand then
 * carry the beginning's values rather than some other run's.
 *
 * Which file that is has to be **derived, not named**. It used to be
 * `START.RTD`, which was right while the shipped set was one player's opening
 * saves and wrong the moment the directory held the disc's own collection
 * instead — the fallback was alphabetical, and alphabetically first in that
 * collection is a day-4 save taken underground. `frame` is the service-pass
 * counter, so the lowest one is the earliest moment anybody saved.
 *
 * Best-effort throughout: a save that will not parse is skipped rather than
 * thrown, and any base at all beats none, because a base with the wrong
 * untouched fields still saves a game and no base does not.
 */
export async function loadDustTemplate(): Promise<void> {
  const shipped = (await listSaves()).filter((s) => s.builtin);
  let best: { bytes: Uint8Array; frame: number } | null = null;
  for (const entry of shipped) {
    try {
      const frame = parseSaveV1(entry.bytes).frame;
      if (!best || frame < best.frame) best = { bytes: entry.bytes, frame };
    } catch {
      /* not a save this reader understands — it cannot lend fields either */
    }
  }
  template =
    best?.bytes ??
    [...shipped].sort((a, b) => a.name.localeCompare(b.name))[0]?.bytes ??
    null;
}

/** the cached base save, or null if none was found (saving then reports so) */
export function dustTemplate(): Uint8Array | null {
  return template;
}
