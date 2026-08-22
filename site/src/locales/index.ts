/**
 * Putting the pages into a language: which one, where the words come from, and
 * how they get onto the page.
 *
 * The eleven pages carry their English inline (see ./en.ts for why), so this
 * module's whole job is to *replace* that English when the reader wants one of
 * the other five. Nothing here runs for an English reader: {@link installI18n}
 * looks at the language, sees `en`, sets `<html lang>` and returns without
 * fetching anything or touching a node.
 *
 * ## Which language
 *
 * The page's language is its OWN axis, asked by the dropdown in the top bar
 * (site/src/lang-menu.ts) and by nothing else. What a page's CONTENT is read from — the
 * `gamefiles/` tree the game boots, the files an editor lists, the box the
 * collection turns — is the EDITION, `?edition=`, taoot/src/editions.ts. The two were
 * one setting once, with `?lang=` naming a tree and being consulted for the
 * chrome, which meant switching to the German data moved the whole site and a
 * reader with the English disc who reads German had to fight it.
 *
 * So the order is about the reader, and nothing in it is about their CD:
 *
 *   1. `?lang=` — what a link asks for, which is a request made *now* and so
 *      outranks a stored preference from some earlier visit
 *   2. `?uilang=` — the same request under the name the parameter had for a few
 *      weeks, kept because links carrying it are in the wild
 *   3. `taoot.uilang` — what was chosen last time
 *   4. `navigator.languages` — the browser's own preference
 *   5. English
 *
 * `taoot.lang` is NOT in that list, and the omission is the point: it is where the
 * EDITION was kept while the two axes were one, so counting it would pin the page
 * language of everyone who had ever picked a data language.
 *
 * The edition follows this answer where it can (`chosenEdition`), so a German
 * reader gets the German game without being asked twice — but only until they
 * pick an edition, and never the other way round. A page in German over English
 * data is a worse answer than both being German and a better one than ignoring
 * either the reader or what they actually have installed.
 *
 * ## What it costs
 *
 * A non-English page is translated after first paint: the entry module is
 * deferred, the catalogue arrives over a dynamic import, and the swap happens
 * when it lands. So there is a flash of English on a cold load in the other
 * five languages. It is the price of keeping the English inline, and the fix
 * when it becomes worth paying is to build the five other copies of each page
 * at build time rather than to move the English out of the markup.
 */
import {
  UI_LANGUAGES,
  DEFAULT_UI_LANGUAGE,
  UI_LANG_STORAGE_KEY,
  isUiLanguage,
} from "../ui-languages";
import en, { Catalogue, Key, Value } from "./en";

/**
 * The translations, by code — one module each, code-split by Vite so a page
 * downloads the language it is being read in and no other.
 *
 * Each `<code>/` holds one JSON file per namespace, which is the part a
 * translator or a TMS reads, plus an `index.ts` that assembles them and asserts
 * the result against {@link Catalogue}. Adding a language is one line here and
 * one directory; site/tests/locales.ts fails if either shows up alone.
 */
const CATALOGUES: Partial<Record<string, () => Promise<{ default: Catalogue }>>> = {
  de: () => import("./de"),
  fr: () => import("./fr"),
  ru: () => import("./ru"),
  nl: () => import("./nl"),
  ja: () => import("./ja"),
};

/** the codes that actually have words behind them, English included */
export const translatedLanguages = (): string[] => [DEFAULT_UI_LANGUAGE, ...Object.keys(CATALOGUES)];

/**
 * The language the *page* is in — see the order in the module comment. Only
 * ever one of {@link UI_LANGUAGES}; anything else falls through to English.
 */
export function uiLanguage(): string {
  const wanted: (string | null | undefined)[] = [];
  // the URL first, and outside the try: a browser that refuses storage must not
  // cost us the parameters that need no storage to read
  const query = new URLSearchParams(window.location.search);
  wanted.push(query.get("lang"));
  // `?uilang=` is what this parameter was called while `?lang=` still meant the
  // game's data, which was a matter of weeks — kept because links carrying it are
  // in the wild and it costs one line to keep honouring them
  wanted.push(query.get("uilang"));
  try {
    wanted.push(window.localStorage.getItem(UI_LANG_STORAGE_KEY));
  } catch {
    // a browser refusing storage is not a reason to fail to draw a page
  }
  // navigator.languages is "de-CH", "de", "en-US" — the region is not an axis
  // this port has, so only the primary subtag is asked about
  for (const tag of window.navigator.languages ?? []) wanted.push(tag.split("-")[0]);

  for (const code of wanted) {
    if (code && isUiLanguage(code) && translatedLanguages().includes(code.toLowerCase())) {
      return code.toLowerCase();
    }
  }
  return DEFAULT_UI_LANGUAGE;
}

/** what the page is currently showing; English until a catalogue is loaded */
let active: Catalogue = en;
/** and which language that is — what Intl is asked about */
let activeCode: string = DEFAULT_UI_LANGUAGE;

/**
 * The string behind a key, with `{name}` placeholders filled in and — when the
 * catalogue holds a set of forms rather than one string — the right form picked
 * for `params.n`.
 *
 * Falls back to English one key at a time rather than one language at a time, so
 * a translation that is merely incomplete still shows everything it does have.
 *
 * ## Plurals
 *
 * The editors count things, and until now they said so in English grammar:
 * `${n} flat${n === 1 ? "" : "s"}`, forty-five times over. That rule is a fact
 * about English and it is wrong nearly everywhere else — Russian needs four
 * forms and picks between them on the last two digits, Japanese has one and
 * inflects nothing. So a counted string is not a string here, it is an object of
 * CLDR categories, and {@link Intl.PluralRules} — which ships in the browser and
 * knows all six languages' rules — says which one to read:
 *
 *     flats: { one: "{n} flat", other: "{n} flats" }        // en
 *     flats: { one: "{n} флэт", few: "{n} флэта", many: "{n} флэтов", other: … }  // ru
 *
 * A language only writes the categories it has. English supplies two, Japanese
 * one, Russian four; the test asserts each language carries exactly the set
 * `Intl.PluralRules` says that language uses, so neither a missing `few` nor a
 * pointless one survives.
 *
 * Numbers are interpolated as they arrive, NOT run through `Intl.NumberFormat`.
 * Most of them are container offsets, pixel sizes and frame indices, and
 * `@1234` becoming `@1.234` in German would be a lie about the file. Where
 * grouping IS wanted the caller asks for it: see {@link formatNumber}.
 */
export function t(key: Key, params?: Record<string, string | number>): string {
  const [ns, name] = key.split(".") as [keyof Catalogue, string];
  const group = active[ns] as Record<string, Value> | undefined;
  const value = group?.[name] ?? (en[ns] as Record<string, Value>)[name];
  if (value === undefined) return key;

  let text: string;
  if (typeof value === "string") {
    text = value;
  } else {
    // a set of forms: which one depends on the count and the language
    const n = Number(params?.n ?? 0);
    const category = new Intl.PluralRules(activeCode).select(n);
    text = value[category] ?? value.other;
  }

  return params
    ? text.replace(/\{(\w+)\}/g, (whole, k: string) => (k in params ? String(params[k]) : whole))
    : text;
}

/**
 * A number with the active language's grouping — 1234 as "1,234" or "1.234" or
 * "1 234". For the handful of readouts that are quantities a reader compares
 * (file sizes, byte counts) rather than addresses they look up.
 */
export const formatNumber = (n: number): string => new Intl.NumberFormat(activeCode).format(n);

/**
 * Swap every marked node under `root` into the active language.
 *
 * Three attributes, because there are three places a string can go:
 *   `data-i18n="home.h1"`               → textContent
 *   `data-i18n-html="home.intro"`       → innerHTML, for a sentence with a
 *                                         `<code>` or a link inside it
 *   `data-i18n-attr="title:play.fsTitle, placeholder:play.savesName"`
 *                                       → attributes, comma-separated pairs
 *
 * Read with `getAttribute` rather than `dataset`, which would be the idiomatic
 * choice and is not the safe one: `data-i18n` maps to `dataset.i18n` only if
 * the implementation gets the digits right, and the one the tests parse the
 * pages with does not. An attribute name is the same string everywhere.
 */
export function applyTranslations(root: ParentNode = document): void {
  for (const el of root.querySelectorAll<HTMLElement>("[data-i18n]")) {
    el.textContent = t(el.getAttribute("data-i18n") as Key);
  }
  for (const el of root.querySelectorAll<HTMLElement>("[data-i18n-html]")) {
    el.innerHTML = t(el.getAttribute("data-i18n-html") as Key);
  }
  for (const el of root.querySelectorAll<HTMLElement>("[data-i18n-attr]")) {
    for (const pair of el.getAttribute("data-i18n-attr")!.split(",")) {
      const [attr, key] = pair.split(":").map((s) => s.trim());
      if (attr && key) el.setAttribute(attr, t(key as Key));
    }
  }
}

/**
 * Put the page into the reader's language: the one call a page entry makes.
 *
 * Always sets `<html lang>` — CSS `:lang()`, hyphenation, the font fallback a
 * Japanese page needs and a screen reader's choice of voice all hang off it,
 * and all four are wrong on a translated page that still claims `lang="en"`.
 *
 * Never throws. A catalogue that fails to load leaves the page in the English
 * it was already showing, which is a worse page than intended and a much better
 * one than a blank.
 */
export async function installI18n(): Promise<void> {
  const code = uiLanguage();
  document.documentElement.lang = code;
  if (code === DEFAULT_UI_LANGUAGE) return;

  try {
    const load = CATALOGUES[code];
    if (!load) return;
    active = (await load()).default;
    // only now, and never before: `activeCode` is what Intl is asked which
    // plural form to read, so it has to name the language the words are
    // actually in. A catalogue that failed to load leaves both English.
    activeCode = code;
  } catch {
    return;
  }
  applyTranslations();
}

/** the six, for a picker: code and endonym, only where there are words to show */
export const uiLanguageOptions = (): { code: string; name: string }[] =>
  UI_LANGUAGES.filter((l) => translatedLanguages().includes(l.code)).map((l) => ({
    code: l.code,
    name: l.name,
  }));
