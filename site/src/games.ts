/**
 * Which games this project hosts, and what it takes to READ one's data.
 *
 * The landing page already carries this knowledge in markup — four doors, two of
 * them games. This is the same knowledge in a form a module can use, and it
 * exists because the format editors need it: they open a room, a film or a
 * puppet out of a rip, and to do that they have to know which trees that rip
 * offers, what to call them, and which code page the text in each one is in.
 *
 * ## Why it is here rather than in the game
 *
 * It was in the game, and that made `site/` depend on `taoot/` — a shared
 * package importing one of its own consumers, which is the one edge the
 * restructuring set out to avoid. The knowledge is not about PLAYING Titanic; it
 * is about reading a directory of 1996 files. Everything that is about playing
 * it — the boot plan, the chooser stage, the script global the chooser sets,
 * the pixel-art labels drawn into that stage — stayed in `taoot/`, which reads
 * its editions FROM here.
 *
 * ## The code pages are recovered, not chosen
 *
 * No DF file records an encoding (`engine/src/df/text.ts` says what was searched
 * and what the original did instead), so the tree it came from is the only thing
 * left to ask, and this is where the answer lives. It is not a guess:
 * `taoot/tests/auto/text.ts` re-derives every entry from the shipped puppet files
 * and fails on a wrong one rather than letting it mojibake.
 */
import { DEFAULT_ENCODING, DfEncoding } from "@dreamfactory/engine/df/text";

/** one tree a game's data comes in */
export interface Edition {
  /** the directory under `gamefiles/`, and what `?edition=` accepts */
  code: string;
  /** what to call it in the chrome: an endonym, or a name for a cut of the game */
  name: string;
  /** the character set this tree's text bytes are in */
  encoding: DfEncoding;
}

/** everything the edition axis needs to know about one game */
export interface GameEditions {
  /** for messages and for the editors' own label */
  title: string;
  /** a short name for a button, where the full title is too long */
  short: string;
  /**
   * This game's directory under the site root — where its build is deployed and
   * where its rip sits beside it. What lets a page belonging to no game resolve
   * `taoot/gamefiles.json` and `dust/gamefiles.json` from one place.
   */
  dir: string;
  /** every edition, in the order a picker lists them */
  editions: readonly Edition[];
  /** where the reader's choice is remembered */
  storageKey: string;
  /** a key still read ONCE as a fallback, from before the two axes split */
  legacyKey?: string;
  /** the edition to fall back to when nothing else answers */
  fallback: string;
}

/**
 * *Titanic: Adventure Out of Time* — six translations and one cut that is not a
 * translation.
 *
 * Stated outright rather than derived from `site/src/ui-languages.ts`, even though the
 * six codes and endonyms are the same strings. The game shipped in six languages
 * in 1996; the chrome is written in six because somebody translated it. Deriving
 * one from the other would turn a coincidence into a constraint and make the
 * game's pressings a consequence of who did the translating — so both are said
 * once, and `taoot/tests/auto/ui-languages.ts` asserts they still agree.
 */
export const TITANIC: GameEditions = {
  title: "Titanic: Adventure Out of Time",
  short: "Titanic",
  dir: "taoot",
  editions: [
    { code: "en", name: "English", encoding: "macintosh" },
    { code: "de", name: "Deutsch", encoding: "macintosh" },
    { code: "fr", name: "Français", encoding: "macintosh" },
    { code: "ru", name: "Русский", encoding: "windows-1251" },
    { code: "nl", name: "Nederlands", encoding: "macintosh" },
    { code: "ja", name: "日本語", encoding: "shift_jis" },
    /**
     * The 1996 demo, under `gamefiles/demo/`: a different cut of the game rather
     * than a translation of one. Deliberately not one of the six — it would
     * claim a place in the authored chooser's art, an endonym it has no use for,
     * and a code page it does not need (English data, so the default is already
     * right for it).
     */
    { code: "demo", name: "Demo", encoding: DEFAULT_ENCODING },
  ],
  // Both literals are keys in real readers' `localStorage` and keep their
  // spelling wherever the table lives: renaming one would quietly forget a
  // choice somebody made. `taoot.lang` is read once as a fallback, from when the
  // edition was called a language and the two axes were one setting.
  storageKey: "taoot.edition",
  legacyKey: "taoot.lang",
  fallback: "en",
};

/**
 * *Dust: A Tale of the Wired West* — one disc, one language, so no axis at all.
 *
 * Listed anyway, because "this game has nothing to choose between" is an answer
 * the picker already knows how to give: it hides itself below two editions. When
 * the editors are handed a game to browse rather than defaulting to one, this is
 * the second thing in the list.
 */
export const DUST: GameEditions = {
  title: "Dust: A Tale of the Wired West",
  short: "Dust",
  dir: "dust",
  editions: [{ code: "dustcd", name: "English", encoding: DEFAULT_ENCODING }],
  storageKey: "dust.edition",
  fallback: "dustcd",
};

/** the code every edition-less path is treated as belonging to — see `editionOfUrl` */
export const NEUTRAL = "";

/**
 * Which edition a served path belongs to, or {@link NEUTRAL}.
 *
 * Anything unrecognised is edition-NEUTRAL and reachable whatever edition is
 * active: a flat dump with no `gamefiles/<code>/` level at all, and this port's
 * own authored assets — `lang.stg` above all, since the chooser has to load
 * before there is an edition to load it from.
 */
export function editionOfUrl(game: GameEditions, url: string): string {
  const m = /(?:^|\/)gamefiles\/([^/]+)\//i.exec(url);
  const code = m?.[1].toLowerCase();
  return code && game.editions.some((e) => e.code === code) ? code : NEUTRAL;
}

/**
 * Every game this project hosts, in the order a list shows them.
 *
 * Oldest engine first, which is also oldest game first — the order the
 * documentation introduces them in, and the order that makes "DreamFactory 1,
 * then 4" read as a progression rather than an arbitrary pair.
 */
export const GAMES: readonly GameEditions[] = [DUST, TITANIC];
