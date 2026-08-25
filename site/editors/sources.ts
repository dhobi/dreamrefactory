/**
 * What the editors are looking at: a corpus, not a game.
 *
 * These pages read and write DreamFactory containers, and a SET is a SET whoever
 * pressed it. What they used to be tied to was the way they FOUND one — the
 * EDITION axis, which is one game's list of `gamefiles/<code>/` trees, imported
 * straight out of `taoot/`. So opening the editors showed Titanic's top bar and
 * Titanic's six editions, on a page that is the project's own tooling and sits at
 * `/dreamrefactory/editors/`.
 *
 * A SOURCE is one rip of one game, in one edition: "Dust", "Titanic · English",
 * "Titanic · 日本語". Every game in the registry (`site/src/games.ts`) contributes
 * however many it actually has on disk, and a game with one disc contributes one.
 * The row at the top of each editor picks between them, which is the same control
 * it always was and no longer belongs to either game.
 *
 * ## Where the files come from
 *
 * Each game's build writes its own `gamefiles.json` at its own site root, so
 * there is one manifest per game and this fetches all of them — `taoot/…` and
 * `dust/…`, resolved from the editors' page through the PROJECT root, which is
 * what their `<meta name="site-root">` now names. That is the whole reason the
 * meta changed: it used to say `../taoot/`, which was these pages admitting they
 * could only see one game.
 *
 * A game whose manifest is missing or empty simply contributes nothing. That is
 * the normal case in a production build with no rip beside it, and it is why the
 * row hides itself below two sources rather than insisting on one.
 */
import { DfEncoding } from "@dreamfactory/engine/df/text";
import { uiLanguage } from "@dreamfactory/site/locales";
import { siteUrl } from "@dreamfactory/site/site";
import { GAMES, GameEditions, GameScreen, NEUTRAL, editionOfUrl } from "@dreamfactory/site/games";

/** one rip, in one edition, ready to list files from */
export interface Source {
  game: GameEditions;
  /** the edition code, or {@link NEUTRAL} for a game with no edition axis */
  edition: string;
  /** what the button says */
  label: string;
  /** stable identity, for remembering the choice and for `?source=` */
  id: string;
  /** every path this game's manifest carries, as it keys them */
  paths: string[];
}

/** one file inside a source */
export interface SourceFile {
  /** the path as the manifest keys it, within its game's tree */
  path: string;
  /** where to actually fetch it, resolved through the project root */
  url: string;
  /** the basename, lower-cased, for a button */
  base: string;
}

/** where the reader's choice of corpus is remembered */
const STORAGE_KEY = "dreamrefactory.editorSource";

const manifests = new Map<string, Promise<Record<string, number>>>();

/** one game's listing, fetched at most once per page */
function manifestOf(game: GameEditions): Promise<Record<string, number>> {
  const existing = manifests.get(game.dir);
  if (existing) return existing;
  const p = (async () => {
    try {
      const r = await fetch(siteUrl(`${game.dir}/gamefiles.json`));
      return r.ok ? ((await r.json()) as Record<string, number>) : {};
    } catch {
      return {};
    }
  })();
  manifests.set(game.dir, p);
  return p;
}

let cached: Promise<Source[]> | null = null;

/**
 * Every source there is, oldest game first and that game's editions in its own
 * order.
 *
 * A game with an edition axis contributes one entry per edition its manifest
 * actually holds — an install with two languages offers two, not six. A game
 * with no axis (Dust: one disc) contributes exactly one, labelled with just its
 * name, because "Dust · English" would imply there is another.
 */
export function listSources(): Promise<Source[]> {
  return (cached ??= (async () => {
    const out: Source[] = [];
    for (const game of GAMES) {
      const paths = Object.keys(await manifestOf(game));
      if (!paths.length) continue;
      const present = new Set(paths.map((p) => editionOfUrl(game, p)));
      const editions = game.editions.map((e) => e.code).filter((c) => present.has(c));
      if (editions.length < 2) {
        // one tree, or a flat dump with no edition level at all
        out.push({
          game,
          edition: editions[0] ?? NEUTRAL,
          label: game.short,
          id: game.dir,
          paths,
        });
        continue;
      }
      for (const code of editions) {
        out.push({
          game,
          edition: code,
          label: `${game.short} · ${game.editions.find((e) => e.code === code)?.name ?? code}`,
          id: `${game.dir}:${code}`,
          paths,
        });
      }
    }
    return out;
  })());
}

/**
 * Which source a page is showing: `?source=`, then what was picked last, then a
 * default worth defending.
 *
 * The list is ordered oldest engine first, so `available[0]` is Dust — which
 * would make the smallest corpus the default for everyone, and quietly change
 * what the editors open for anyone who had been using them. The old edition row
 * defaulted to the reader's own UI language where that tree existed, and the
 * reason it did is worth keeping: two controls should not read as two chores.
 *
 * So: an edition matching the language the page is being READ in, then the
 * FULLEST rip on the disk, then whatever there is. A German reader gets Titanic's
 * German tree; a reader whose language no game shipped in gets the corpus with
 * the most in it rather than the one that happens to sort first.
 */
export function chosenSource(available: Source[]): Source | null {
  if (!available.length) return null;
  const find = (id: string | null | undefined): Source | undefined =>
    id ? available.find((s) => s.id === id) : undefined;
  const query = new URLSearchParams(window.location.search).get("source");
  let remembered: string | null = null;
  try {
    remembered = window.localStorage.getItem(STORAGE_KEY);
  } catch {
    /* storage can be denied; the query parameter still works */
  }
  const ui = uiLanguage();
  const inUiLanguage = available.find((s) => s.edition === ui);
  const fullest = [...available].sort((a, b) => b.paths.length - a.paths.length)[0];
  return find(query) ?? find(remembered) ?? inUiLanguage ?? fullest;
}

/**
 * The files in one source, filtered.
 *
 * Only that edition's copies plus the edition-NEUTRAL ones: an install with six
 * languages holds six `bedsit1.set`, and listing all six lists the same room six
 * times under names that cannot be told apart. Neutral is not a leftover — a flat
 * dump has no edition level at all and lands entirely in it, and this port's own
 * authored files (`lang.stg`) live there by design.
 */
export function filesIn(source: Source, keep: (path: string) => boolean): SourceFile[] {
  const out: SourceFile[] = [];
  for (const path of source.paths) {
    const e = editionOfUrl(source.game, path);
    if (e !== source.edition && e !== NEUTRAL) continue;
    if (!keep(path)) continue;
    out.push({
      path,
      url: siteUrl(`${source.game.dir}/${path}`),
      base: (path.split("/").pop() ?? path).toLowerCase(),
    });
  }
  return out.sort((a, b) => a.base.localeCompare(b.base));
}

/**
 * The code page a source's text bytes are in.
 *
 * No DF file records one (`engine/src/df/text.ts`), so the tree it came from is
 * the only thing left to ask — and a source IS a tree, which is why this needs no
 * game module to answer it. The puppet editor decodes subtitles with it.
 */
export function encodingOf(source: Source): DfEncoding {
  const found = source.game.editions.find((e) => e.code === source.edition);
  return found?.encoding ?? source.game.editions[0].encoding;
}

/**
 * The screen a source's game renders into.
 *
 * Same shape as {@link encodingOf} and for the same reason: it is a fact about
 * the TREE, so a source answers it and no editor has to import a game. What it
 * is for is the four formats that do not record it — a SHP, a CST, a PUP and a
 * MOV are all authored against the screen and none of them says how big it is,
 * so an editor drawing a prop at its default anchor, or a stance over the
 * screen, would otherwise be drawing Titanic's geometry around another game's
 * art (measured: Timelapse's `p.shp` compass came out at 256,192 on a 512×384
 * field, where the game puts it at 320,240 on a 640×480 one).
 *
 * An STG says, so `stg-editor` uses the file's own answer instead
 * (`StgFile.screen`), which beats a registry entry that happens to agree.
 */
export function screenOf(source: Source | null | undefined): GameScreen {
  return source?.game.screen ?? { width: 512, height: 384, band: 264 };
}

/** files with one of these extensions, which is what every editor wants */
export const byExtension =
  (...ext: string[]) =>
  (path: string): boolean => {
    const lower = path.toLowerCase();
    return ext.some((e) => lower.endsWith(e));
  };

/**
 * Build the source row into `mount`, and answer which source is being shown.
 *
 * Hidden outright below two sources: a picker with a single answer is furniture,
 * and that is also the production build, where there is no manifest to read and
 * the editors are upload-only.
 *
 * A click reloads, as the edition row always did — an editor has a file open from
 * the corpus being left, and re-deriving the page around it is more ways to be
 * wrong than starting over.
 */
export async function installSourcePicker(mount: HTMLElement): Promise<Source | null> {
  const sources = await listSources();
  const current = chosenSource(sources);
  mount.hidden = sources.length < 2;
  if (!current || mount.hidden) return current;
  for (const s of sources) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.dataset.source = s.id;
    btn.textContent = s.label;
    btn.classList.toggle("here", s.id === current.id);
    btn.addEventListener("click", () => {
      try {
        window.localStorage.setItem(STORAGE_KEY, s.id);
      } catch {
        /* then the query parameter carries it alone */
      }
      const url = new URL(window.location.href);
      url.searchParams.set("source", s.id);
      window.location.href = url.toString();
    });
    mount.appendChild(btn);
  }
  return current;
}
