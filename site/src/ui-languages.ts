/**
 * The UI-language axis: which of six languages the WORDS ON THE PAGE are in.
 *
 * ## Two axes, and which is which
 *
 * The site asks two separate questions and keeps them separate:
 *
 *  - **the UI language** — this file. The dropdown in the top bar
 *    ([lang-menu.ts](lang-menu.ts)), `?lang=`, {@link UI_LANG_STORAGE_KEY}. It is a
 *    fact about how much of the CHROME has been translated, which is a fact about
 *    `site/src/locales/` and about nothing else.
 *  - **the edition** — the CONTENT: which `gamefiles/` tree a game boots from,
 *    which files an editor lists, which pressing's box the collection turns. That
 *    is one game's business and lives in `taoot/src/editions.ts` over that game's
 *    own `languages.ts`, with `?edition=` and its own storage key.
 *
 * They used to be one setting with a fallback between them, which read as one
 * question with two answers. Then they were two settings in one file — this list
 * was derived from Titanic's `LANGUAGES`, whose entries carry a code page per
 * pressing and a label drawn into that game's chooser art. So the chrome's own
 * translations depended on one game's release history, and a shared package could
 * not use them without importing a game.
 *
 * That the two lists have the SAME six codes is a coincidence of authorship —
 * the chrome was translated into the languages the game shipped in — and not a
 * constraint. `site/tests/locales.ts` asserts they still coincide, so if one
 * moves the other is noticed rather than silently disagreed with.
 */

/** a language the chrome is written in: the code, and its endonym for the menu */
export interface UiLanguage {
  /** the subdirectory under `locales/`, and what `?lang=` accepts */
  code: string;
  /** the endonym, for DOM UI where a real font is available */
  name: string;
}

/**
 * The six, English first.
 *
 * This is a statement about `site/src/locales/`: one entry per catalogue that
 * exists, plus English, which is inline in the markup rather than a catalogue.
 */
export const UI_LANGUAGES: readonly UiLanguage[] = [
  { code: "en", name: "English" },
  { code: "de", name: "Deutsch" },
  { code: "fr", name: "Français" },
  { code: "ru", name: "Русский" },
  { code: "nl", name: "Nederlands" },
  { code: "ja", name: "日本語" },
];

/** the language the markup is authored in, and the fallback for every miss */
export const DEFAULT_UI_LANGUAGE = "en";

/**
 * Where the page remembers the reader's choice.
 *
 * The value stays `taoot.uilang` even though this axis is no longer Titanic's:
 * it is a key in real readers' `localStorage`, and renaming it would quietly
 * forget every choice anyone has made. The name is history, not meaning.
 */
export const UI_LANG_STORAGE_KEY = "taoot.uilang";

export const isUiLanguage = (code: string): boolean =>
  UI_LANGUAGES.some((l) => l.code === code.toLowerCase());

export const uiLanguageName = (code: string): string =>
  UI_LANGUAGES.find((l) => l.code === code.toLowerCase())?.name ?? code;
