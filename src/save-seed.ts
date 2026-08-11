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
import { globalsCapacity } from "./df/savegame";
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
    // ...and the template ranking was about those files, not these
    await setMeta(TEMPLATE_PICK, undefined);
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

/**
 * Which shipped save of a disk family to lend: the one that can carry the most
 * globals ({@link globalsCapacity}), not the first one listed.
 *
 * A `.ti` holds the variable list that existed when it was taken, and a patch can
 * only write a global the base has a record for or can make one for — so an early
 * save is a poor template and the first file in `save/1` is the earliest there is.
 * Measured against the 163 globals the shipped corpus knows between them, that
 * pick could hold 99 and dropped 64, including the whole turbine puzzle, the
 * smokestack maze number and level, and the darkroom's plates (#85). Ranking by
 * capacity takes disk 1 to 44 dropped and disk 2 to 24 — the rest is blackjack and
 * fistfight scratch, which a load re-initialises anyway.
 *
 * Still per disk family, and still preferring the matching one: the `disk` field
 * (container 0 @256) is NOT one of the fields a patch overwrites, and a save has
 * to be loadable by the original engine, which reads it to know which CD to ask
 * for.
 */
export function bestTemplate(saves: SaveEntry[], folders: string[]): SaveEntry | null {
  let best: SaveEntry | null = null;
  let bestRoom = -1;
  for (const s of saves) {
    if (!s.builtin || !folders.includes(s.folder)) continue;
    const { records, free } = globalsCapacity(s.bytes);
    const room = records + free;
    if (room > bestRoom) {
      bestRoom = room;
      best = s;
    }
  }
  return best;
}

/** where the ranking's answer is remembered, so it is paid for once ever */
const TEMPLATE_PICK = "template.pick";

/**
 * Cache one disk-1 and one disk-2 structural template from the seeded saves.
 *
 * The ranking reads 5 MB of `.ti` and decodes ~110 variable lists — 170 ms,
 * measured — and this runs on every launch, off the critical path but on the same
 * thread the game is booting on. So the ANSWER is stored (two entry paths) and the
 * work is done once, on the launch that seeds the saves in the first place, where
 * 170 ms sits behind 109 HTTP fetches and is nobody's problem.
 */
export async function loadTemplates(): Promise<void> {
  const saves = await listSaves();
  const stored = await getMeta<{ d1?: string; d2?: string }>(TEMPLATE_PICK);
  const byPath = (p: string | undefined) =>
    p ? (saves.find((s) => s.builtin && s.path === p) ?? null) : null;
  let d1 = byPath(stored?.d1);
  let d2 = byPath(stored?.d2);
  if (!d1 || !d2) {
    d1 ??= bestTemplate(saves, ["1", "ENDGAME1"]);
    d2 ??= bestTemplate(saves, ["2", "ENDGAME2"]);
    if (d1 || d2) await setMeta(TEMPLATE_PICK, { d1: d1?.path, d2: d2?.path });
  }
  tpl1 = d1?.bytes ?? null;
  tpl2 = d2?.bytes ?? null;
}

/**
 * A structural template for a fresh save, preferring the given disk ("1" | "2").
 * Returns null until {@link loadTemplates} has populated the cache (saving that
 * early is rare — the control panel is deep into a playthrough).
 */
export function saveTemplateFor(prefer: "1" | "2"): Uint8Array | null {
  return prefer === "2" ? (tpl2 ?? tpl1) : (tpl1 ?? tpl2);
}
