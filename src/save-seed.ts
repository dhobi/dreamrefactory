/**
 * One-time seeding of the IndexedDB save store (see `save-store.ts`) from the
 * shipped saves tree (`gamefiles/<lang>/save/`), plus the structural templates used to write a
 * save for a game that was never loaded from a file.
 *
 * Seeding reuses the exact mechanism the SET browser uses: the `gamefiles.json`
 * manifest (fetched once by `main.ts`'s `initServerBrowser`) is passed in, the
 * `SAVE/*.ti` entries are picked out, and each is fetched through the same
 * `/gamefiles` raw-bytes route the SET siblings load from. Nothing is bundled
 * into a production build — if the manifest isn't served (no dev server, or a
 * deploy without the files) the store is simply left empty and the seed marker
 * is NOT set, so a later launch with the files available can still seed.
 */

import { SaveEntry, deleteSave, displayName, getMeta, listSaves, putSave, setMeta } from "./save-store";
import { NEUTRAL, editionOfUrl } from "./files";
import { siteUrl } from "./site";

const SEEDED = "seeded";
/** which language's shipped saves are in the store — see {@link seedSaves} */
const SEEDED_LANG = "seeded.lang";

/** Encode a slash-separated path for use in a URL, preserving the separators. */
function encodePath(p: string): string {
  return p.split("/").map(encodeURIComponent).join("/");
}

/** Turn a SAVE-relative path into a store entry's folder + display name. */
function splitRel(rel: string): { folder: string; name: string } {
  const slash = rel.lastIndexOf("/");
  const folder = slash >= 0 ? rel.slice(0, slash) : "";
  const base = slash >= 0 ? rel.slice(slash + 1) : rel;
  return { folder, name: displayName(base) };
}

/**
 * The shipped saves inside the `gamefiles.json` manifest, and each one's path
 * relative to its save folder (`"1/01 - ….ti"` — the store's entry key).
 *
 * The save folder sits beside the disc volumes, so it is nested an unknown depth
 * under gamefiles/ (`gamefiles/en/save/1/…`), not directly beneath it — matching
 * `gamefiles/save/` outright silently seeded nothing and left the save browser
 * empty. Allow any intermediate segments, and stay case-insensitive: the folder
 * is `save` in a per-CD layout and `SAVE` in an older flat dump.
 */
const SHIPPED_SAVE = /(?:^|\/)gamefiles\/(?:[^/]+\/)*save\/(.+\.ti)$/i;

/**
 * The shipped saves in a `gamefiles.json` manifest listing, as
 * `{ rel, url }` — pure, so it is unit-testable without IndexedDB (the layout
 * change that broke the pattern above was invisible to the suite otherwise).
 *
 * `lang` narrows it to one language tree, because the shipped saves are
 * localised too: six installs mean six `save/1/01 - ….ti`, and they differ. A
 * path outside any language directory (a flat single-language dump) always
 * qualifies — it is the only tree there is.
 */
export function shippedSaves(
  manifestPaths: string[],
  lang = NEUTRAL,
): { rel: string; url: string }[] {
  return manifestPaths
    .map((p) => ({ p, m: SHIPPED_SAVE.exec(p) }))
    .filter((x): x is { p: string; m: RegExpExecArray } => !!x.m)
    .filter(({ p }) => {
      const pathEdition = editionOfUrl(p);
      return pathEdition === NEUTRAL || lang === NEUTRAL || pathEdition === lang;
    })
    .map(({ p, m }) => ({ rel: m[1], url: siteUrl(encodePath(p)) }));
}

/**
 * Seed the store from the shipped saves listed in the `gamefiles.json` manifest,
 * if it has never been seeded. `manifestPaths` is that listing (e.g.
 * `["gamefiles/en/save/1/01 - ….ti", …]`) — the same array the SET browser walks.
 * Best-effort and safe to call on every launch: the seed marker makes it a no-op
 * after the first successful run, and an empty/absent manifest leaves the marker
 * unset so it can retry later. Individual file failures are skipped.
 *
 * The store holds ONE language's shipped saves at a time. They are the same eight
 * files in every tree, at the same relative paths, so seeding a second language
 * over the first would silently mix the two — a German `1/01` sitting under an
 * English name. Switching language therefore replaces them, and the marker
 * records which language is in there (a store seeded before the language axis
 * existed has no such marker, and is replaced once).
 */
export async function seedSaves(manifestPaths: string[], lang = NEUTRAL): Promise<void> {
  const seeded = await getMeta<boolean>(SEEDED);
  const seededLang = await getMeta<string>(SEEDED_LANG);
  if (seeded && seededLang === lang) return;
  const sources = shippedSaves(manifestPaths, lang);
  if (!sources.length) return; // nothing to seed — don't mark seeded

  // another language's shipped saves are in the store: replace, don't merge
  if (seeded) {
    for (const entry of await listSaves()) {
      if (entry.builtin) await deleteSave(entry.path);
    }
  }

  let stored = 0;
  for (const { rel, url } of sources) {
    try {
      const r = await fetch(url);
      if (!r.ok) continue;
      const bytes = new Uint8Array(await r.arrayBuffer());
      const { folder, name } = splitRel(rel);
      const entry: SaveEntry = { path: rel, folder, name, bytes, builtin: true, mtime: Date.now() };
      await putSave(entry);
      stored++;
    } catch {
      /* skip this one */
    }
  }
  if (stored) {
    await setMeta(SEEDED, true);
    await setMeta(SEEDED_LANG, lang);
  }
}

// --- structural templates for fresh-playthrough saves -----------------------
// A save is written by patching a real `.ti` skeleton (see docs/formats/savegame.md);
// a game that was never loaded from a file has no such base, so we lend it a
// shipped save. The engine only requires the title "Titanic 1.0" (every shipped
// save has it) and overwrites all loader-read fields, so an exact disk match is
// not essential — we still prefer the matching disk to minimise the untouched
// location/clock carry-over.

let tpl1: Uint8Array | null = null;
let tpl2: Uint8Array | null = null;

/** Cache one disk-1 and one disk-2 structural template from the seeded saves. */
export async function loadTemplates(): Promise<void> {
  const saves = await listSaves();
  const pick = (...folders: string[]): Uint8Array | null => {
    for (const f of folders) {
      const hit = saves.find((s) => s.builtin && s.folder === f);
      if (hit) return hit.bytes;
    }
    return null;
  };
  tpl1 = pick("1", "ENDGAME1");
  tpl2 = pick("2", "ENDGAME2");
}

/**
 * A structural template for a fresh save, preferring the given disk ("1" | "2").
 * Returns null until {@link loadTemplates} has populated the cache (saving that
 * early is rare — the control panel is deep into a playthrough).
 */
export function saveTemplateFor(prefer: "1" | "2"): Uint8Array | null {
  return prefer === "2" ? (tpl2 ?? tpl1) : (tpl1 ?? tpl2);
}
