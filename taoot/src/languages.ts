/**
 * The languages the port can run, and the names of the things that carry a
 * choice between them.
 *
 * The original shipped one language per install — `gamefiles/<code>/` is this
 * port's own convention, and the chooser (public/lang.stg, built by
 * taoot/tools/mklangstg.ts) is an addition on top of the shipped data, not recovered
 * behaviour. Everything that has to agree on a code — the generator that draws
 * the buttons, {@link FileStore} deciding which copy of `bedsit1.set` to fetch,
 * the Node-side index in taoot/tools/gamefiles.ts, the saved-game store — agrees here.
 *
 * `label` is what the chooser's art says, in the capitals-only pixel font the
 * generator draws with; `name` is the endonym for the page's own HTML, where a
 * real font is available. Where the two differ (Russian, Japanese) the art is the
 * weaker of the pair by design: it is meant to be replaced with a PNG through the
 * stage editor, which is where proper Cyrillic and CJK come from.
 */
import { DEFAULT_ENCODING, DfEncoding } from "@dreamfactory/engine/df/text";
import { TITANIC } from "@dreamfactory/site/games";
export interface GameLanguage {
  /** the directory under `gamefiles/`, and the region name inside lang.stg */
  code: string;
  /** the button text in the chooser's art (must be drawable — see tools/pixelart.ts) */
  label: string;
  /** the endonym, for DOM UI */
  name: string;
  /**
   * The character set this tree's text bytes are in. Nothing in the DF files
   * says — see engine/src/df/text.ts for what was searched and what the original did
   * instead — so the tree it came from is the only thing left to ask, and this
   * is where the answer lives. taoot/tests/auto/text.ts re-derives every entry from
   * the shipped puppet files, so a wrong one here fails rather than mojibakes.
   */
  encoding: DfEncoding;
}

/**
 * The chooser's button text, per language — the ONLY part of the table that is
 * this game's rather than the project's.
 *
 * It is a drawing instruction: capitals-only pixel art, painted into `lang.stg`
 * by taoot/tools/mklangstg.ts, in a font with no lower case and no Cyrillic or CJK.
 * Where it differs from the endonym (Russian, Japanese) the art is the weaker of
 * the pair by design — it is meant to be replaced with a PNG through the stage
 * editor, which is where proper Cyrillic and CJK come from.
 *
 * Everything else about an edition — that it exists, what it is called in DOM
 * chrome, which code page its bytes are in — is `TITANIC` in
 * `site/src/games.ts`, because the editors need the same answers and asking one
 * game for them pointed a dependency the wrong way.
 */
const CHOOSER_LABELS: Record<string, string> = {
  en: "ENGLISH",
  de: "DEUTSCH",
  fr: "FRANÇAIS",
  ru: "RUSSIAN",
  nl: "NEDERLANDS",
  ja: "JAPANESE",
};

/** the six the full game shipped in: the registry's entries, plus their art */
export const LANGUAGES: readonly GameLanguage[] = TITANIC.editions
  .filter((e) => e.code in CHOOSER_LABELS)
  .map((e) => ({
    code: e.code,
    label: CHOOSER_LABELS[e.code],
    name: e.name,
    encoding: e.encoding,
  }));

/**
 * What a tree with no language directories at all is treated as, and what the
 * tools default to so a route can never silently mix two languages' data.
 */
export const DEFAULT_LANGUAGE = "en";

/** the authored stage the chooser runs from — language-neutral, hence no prefix */
export const LANG_STAGE = "lang.stg";

/** the script global the chooser's buttons set; the host waits for it */
export const LANG_GLOBAL = "taootlang";

/**
 * The chooser stage's flats, by name — the menu, and the screen a chosen button
 * switches to while the boot resources load. Named here because both sides need
 * to agree: the generator writes `gotoflat("wait")` into the button scripts, and
 * the host puts the menu back if it has to refuse the choice.
 */
export const LANG_FLAT = { choose: "choose", wait: "wait" } as const;

/**
 * ## Two axes, and which is which
 *
 * The site asks two separate questions and keeps them separate:
 *
 *  - **the UI language** — the words on the page. The dropdown in the top bar
 *    (site/src/lang-menu.ts), `?lang=`, {@link UI_LANG_STORAGE_KEY}. One of the six
 *    {@link LANGUAGES}, whatever an install happens to carry.
 *  - **the edition** — the CONTENT: which `gamefiles/` tree the game boots from,
 *    which files an editor lists, which pressing's box the collection turns. The
 *    button row those three page groups carry (taoot/src/editions.ts), `?edition=`,
 *    {@link EDITION_STORAGE_KEY}. One of the six languages' trees or one of
 *    {@link EXTRA_EDITIONS} — a cut of the game that is not a translation of it.
 *
 * They used to be one setting with a fallback between them, which read as one
 * question with two answers: switching the data language moved the chrome, and
 * `?lang=` meant different things to different modules. Now `?lang=` is the page
 * and `?edition=` is the game, and neither writes the other's storage key.
 *
 * The edition still DEFAULTS to the reader's UI language where that tree exists,
 * which is what keeps two controls from reading as two chores — see
 * `chosenEdition` in taoot/src/editions.ts.
 */
/** where the page remembers which edition's content it is showing */
export const EDITION_STORAGE_KEY = TITANIC.storageKey;

/**
 * The key the EDITION was kept under while it was called a language, still read
 * (once, as a fallback) so that a reader who chose the German data before the two
 * axes were split keeps the German data after.
 *
 * It is deliberately not the UI language's key, which is what it would have been
 * if `?lang=`'s new meaning had taken the matching storage name: everyone who had
 * ever picked a data language would have had their PAGE language pinned to it, and
 * a German-reading browser on the English disc would have gone quietly English.
 */
export const LEGACY_EDITION_KEY = TITANIC.legacyKey!;

/**
 * Editions that are not one of the six {@link LANGUAGES}: a different cut of the
 * game rather than a translation of it.
 *
 * `demo` is the 1996 demo, under `gamefiles/demo/`. It is deliberately NOT an
 * entry in {@link LANGUAGES} — it would claim a place in the authored chooser's
 * art, an endonym it has no use for, and a code page it does not need (English
 * data, so {@link encodingOf}'s default is already right for it).
 */
export const EXTRA_EDITIONS: readonly { code: string; name: string }[] = TITANIC.editions
  .filter((e) => !(e.code in CHOOSER_LABELS))
  .map((e) => ({ code: e.code, name: e.name }));

/** every edition code, languages first — the order a picker lists them in */
export const editionCodes = (): string[] => [
  ...LANGUAGES.map((l) => l.code),
  ...EXTRA_EDITIONS.map((e) => e.code),
];

/** what an edition is called in the page's own chrome: its endonym, or its name */
export function editionName(code: string): string {
  const lower = code.toLowerCase();
  return (
    language(lower)?.name ?? EXTRA_EDITIONS.find((e) => e.code === lower)?.name ?? code
  );
}

export const isEditionCode = (code: string): boolean =>
  isLanguageCode(code) || EXTRA_EDITIONS.some((e) => e.code === code.toLowerCase());

export function language(code: string): GameLanguage | undefined {
  return LANGUAGES.find((l) => l.code === code.toLowerCase());
}

/**
 * How to read text bytes out of a tree. Unknown codes — including {@link
 * NEUTRAL}, which is what a flat single-language dump reports — get {@link
 * DEFAULT_ENCODING}, the same Mac OS Roman four of the six shipped trees use.
 */
export function encodingOf(code: string): DfEncoding {
  return language(code)?.encoding ?? DEFAULT_ENCODING;
}

export const isLanguageCode = (code: string): boolean => !!language(code);
