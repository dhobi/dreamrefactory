/**
 * The gamefiles manifest: every file the pages may fetch, and what it weighs.
 *
 * ONE walk, used three ways — the dev server serves it live (vite.config.ts), a
 * production build writes it into `dist/`, and `tools/mkmanifest.ts` regenerates
 * it against a tree that was uploaded after the build. That matters because the
 * manifest is the ONLY thing the pages needed a server for: the file listing used
 * to be `/api/gamefiles`, a directory walk on request, and everything else they do
 * with `gamefiles/` is fetching bytes at a URL, which any static host does.
 *
 * ## The shape
 *
 * `{ "gamefiles/en/titanic1/data/bedsit1.set": 172032, … }` — a map, not a list,
 * because both things the pages want are in it: `Object.keys()` is the listing
 * (which editions exist, which files an editor may offer, where the shipped saves
 * are), and the values are what the play page's preload bar totals up before it
 * fetches a byte. 4,065 files come to 208 KB, 40 KB gzipped.
 *
 * Keys are paths as SERVED, without a leading slash — the game's own files keep
 * their `gamefiles/` prefix and this port's authored assets (`lang.stg`) do not,
 * because `public/` is served at the root. Every consumer turns a key into a URL
 * by prefixing "/", which is right either way.
 */
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Directory names under `gamefiles/` that are not game data: the Windows
 * installer and its bundled DirectX/vendor drivers, the press-kit JPEGs, and
 * `sneak/` — a separate sneak-preview demo that ships its OWN `bootfile`, which
 * would otherwise boot instead of the game.
 */
const NOT_GAME_DATA = new Set(["install", "support", "shots", "sneak"]);

/** DF files this port authored itself, which live in `public/` and ship in git */
const DF_EXT = /\.(stg|set|shp|pup|cst|trk|sfx|11k|mov)$/i;

export interface ManifestOptions {
  /** the game data tree; the key prefix is this path as written */
  gamefiles?: string;
  /** where the authored assets live — served at the root, so listed bare */
  publicDir?: string;
}

/** the manifest: served path -> bytes */
export function buildManifest(opts: ManifestOptions = {}): Record<string, number> {
  const gamefiles = opts.gamefiles ?? "gamefiles";
  const publicDir = opts.publicDir ?? "public";
  const out: Record<string, number> = {};

  const walk = (dir: string): void => {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return; // no such tree: an install with nothing in it is a valid state
    }
    for (const e of entries) {
      const p = join(dir, e);
      const st = statSync(p);
      if (st.isDirectory()) {
        if (NOT_GAME_DATA.has(e.toLowerCase())) continue;
        walk(p);
      } else {
        out[p.replace(/\\/g, "/")] = st.size;
      }
    }
  };
  walk(gamefiles);

  // ...and this port's own DreamFactory files, listed by the path they are SERVED
  // at (`lang.stg`, not `public/lang.stg`). Listing them is what puts them in the
  // editors' file pickers beside the game's own, which is the point of authoring a
  // real STG: /editors/stages.html can open, edit and re-export it.
  try {
    for (const e of readdirSync(publicDir).sort()) {
      const p = join(publicDir, e);
      if (DF_EXT.test(e) && statSync(p).isFile()) out[e] = statSync(p).size;
    }
  } catch {
    /* no public/ is not an error either */
  }
  return out;
}

/**
 * The DUST slice of the same walk — everything under `gamefiles/dust/` — as its
 * own file, so the Dust page downloads a listing of its one disc rather than
 * the combined index of every TAOOT edition beside it (~20 KB against ~230),
 * and the TAOOT manifest stops growing when the Dust tree changes. Written
 * wherever the full manifest is written (the build plugin, mkmanifest on the
 * host) and served live by the dev middleware, exactly like its parent.
 */
export function dustManifest(full: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(full)) {
    if (k.startsWith("gamefiles/dust/")) out[k] = v;
  }
  return out;
}

/** where the pages look for it, in dev and in a static deployment alike */
export const MANIFEST_URL = "/gamefiles.json";
export const MANIFEST_FILE = "gamefiles.json";
export const DUST_MANIFEST_URL = "/gamefiles-dust.json";
export const DUST_MANIFEST_FILE = "gamefiles-dust.json";
