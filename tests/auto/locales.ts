/**
 * The page text (src/locales/), and the contract that makes it safe to keep
 * English in two places at once.
 *
 * The eleven pages carry their English inline so that an English reader needs no
 * JavaScript and `git diff` still shows the sentence that changed; src/locales/en.ts
 * carries the same English so that a translator has a list to work from and the
 * five translations have a shape to be checked against. Two copies of a string
 * is normally a bug waiting to happen, and the only thing that makes it not one
 * is this file: **the catalogue must say exactly what the markup says**, or the
 * suite fails. Change a sentence on a page and forget the catalogue, and the
 * other five languages would otherwise go quietly stale — that is the failure
 * this exists to make loud.
 *
 * The rest is the ordinary hygiene a resource file needs: no key referenced by
 * a page that the catalogue lacks, no key in the catalogue that no page uses,
 * nothing empty, no markup smuggled into a value that gets written to
 * `textContent`, and — for the values that ARE written as HTML — a tag
 * allowlist, so that a translation cannot turn a sentence into a script tag.
 */
import { test, expect } from "vitest";
import { readFileSync } from "node:fs";
import { readdirSync } from "node:fs";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseHTML } from "linkedom";
import en, { Value } from "../../src/locales/en";
import { applyTranslations, t } from "../../src/locales";
import { LANGUAGES, DEFAULT_LANGUAGE } from "../../src/languages";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));

/** every page that carries the top bar — the eleven Vite builds (vite.config.ts) */
const PAGES = [
  "index.html",
  "play/index.html",
  "collection/index.html",
  "editors/index.html",
  "editors/puppets.html",
  "editors/casts.html",
  "editors/sets.html",
  "editors/shops.html",
  "editors/stages.html",
  "editors/movies.html",
  "editors/tracks.html",
];

/**
 * The tags a translated sentence may contain. Everything on this list is
 * typography or a link — nothing that can run, load or lay out. `innerHTML` is
 * how these values reach the page (src/locales/index.ts), so this list is the
 * whole of what stops a locale file from being an injection point.
 */
const ALLOWED_TAGS = new Set(["b", "i", "em", "strong", "code", "span", "a", "br"]);

/** whitespace is layout, not content: prettier reflows the markup at will */
const collapse = (s: string): string => s.replace(/\s+/g, " ").trim();

/**
 * Both sides of every HTML comparison go through the same parse-and-serialise,
 * so that entity spelling and attribute quoting — `&nbsp;` against U+00A0,
 * single quotes against double — cancel out instead of failing the test.
 */
function normHtml(html: string): string {
  const { document } = parseHTML(`<div>${html}</div>`);
  return collapse(document.querySelector("div")!.innerHTML);
}

/** `{ site: { navPlay: "Play" } }` → `{ "site.navPlay": "Play" }` */
function flatten(cat: typeof en): Map<string, Value> {
  const out = new Map<string, Value>();
  for (const [ns, group] of Object.entries(cat)) {
    for (const [name, value] of Object.entries(group as Record<string, Value>)) {
      out.set(`${ns}.${name}`, value);
    }
  }
  return out;
}

const CATALOGUE = flatten(en);

/** the plain-string entries — everything the markup assertions apply to */
const STRINGS = new Map([...CATALOGUE].filter((e): e is [string, string] => typeof e[1] === "string"));

/**
 * The keys the TypeScript asks for by name.
 *
 * The markup is no longer the only consumer: the editors build strings too, and
 * `t("common.loading", …)` is as real a use as a `data-i18n` attribute. Scanned
 * rather than imported because the modules touch `document` at load.
 */
const CODE_KEYS = new Set<string>();
for (const dir of ["src", "editors"]) {
  const walk = (d: string): void => {
    for (const e of readdirSync(join(ROOT, d), { withFileTypes: true })) {
      if (e.isDirectory()) walk(`${d}/${e.name}`);
      else if (e.name.endsWith(".ts")) {
        // `tr(` as well as `t(`: track-editor.ts binds `t` to its parsed tables
        // and imports the translator under another name
        const src = readFileSync(join(ROOT, d, e.name), "utf8");
        for (const [, k] of src.matchAll(/\b(?:t|tr)\("([\w.]+)"/g)) {
          CODE_KEYS.add(k);
        }
      }
    }
  };
  walk(dir);
}

/** one marked node on one page: which key, how it is written, what it holds */
interface Marked {
  page: string;
  key: string;
  /** "text" → textContent, "html" → innerHTML, otherwise the attribute name */
  as: string;
  found: string;
}

/** every `data-i18n*` node on every page, with what the markup actually says */
function markedNodes(): Marked[] {
  const out: Marked[] = [];
  for (const page of PAGES) {
    const { document } = parseHTML(readFileSync(join(ROOT, page), "utf8"));
    for (const el of document.querySelectorAll("[data-i18n]")) {
      out.push({ page, key: el.getAttribute("data-i18n")!, as: "text", found: collapse(el.textContent ?? "") });
    }
    for (const el of document.querySelectorAll("[data-i18n-html]")) {
      out.push({ page, key: el.getAttribute("data-i18n-html")!, as: "html", found: normHtml(el.innerHTML) });
    }
    for (const el of document.querySelectorAll("[data-i18n-attr]")) {
      for (const pair of el.getAttribute("data-i18n-attr")!.split(",")) {
        const [attr, key] = pair.split(":").map((s) => s.trim());
        out.push({ page, key, as: attr, found: collapse(el.getAttribute(attr) ?? "") });
      }
    }
  }
  return out;
}

const MARKED = markedNodes();

// --- the two copies of English agree ----------------------------------------

test("the pages are marked up at all", () => {
  // a regex-driven markup pass that silently matched nothing would make every
  // other assertion here vacuously true
  expect(MARKED.length).toBeGreaterThan(100);
  for (const page of PAGES) {
    expect(MARKED.filter((m) => m.page === page).length, page).toBeGreaterThan(4);
  }
});

test("every key a page asks for exists in the catalogue", () => {
  const missing = MARKED.filter((m) => !CATALOGUE.has(m.key)).map((m) => `${m.page}: ${m.key}`);
  expect(missing).toEqual([]);
});

test("every key the TypeScript asks for exists in the catalogue", () => {
  expect([...CODE_KEYS].filter((k) => !CATALOGUE.has(k)).sort()).toEqual([]);
});

test("every key in the catalogue is used by a page", () => {
  // A string nothing shows is a string a translator is paid to translate for
  // nothing — and, more often, the residue of copy that was deleted from a page
  // and left here. When the TypeScript strings are extracted this test grows a
  // second source to scan; until then the markup is the whole of the usage.
  const used = new Set([...MARKED.map((m) => m.key), ...CODE_KEYS]);
  expect([...CATALOGUE.keys()].filter((k) => !used.has(k))).toEqual([]);
});

test("the catalogue says exactly what the markup says", () => {
  // The reason two copies of the English are allowed to exist.
  const drifted: string[] = [];
  for (const m of MARKED) {
    const want = STRINGS.get(m.key);
    if (want === undefined) continue; // reported by the test above
    const expected = m.as === "html" ? normHtml(want) : collapse(want);
    if (expected !== m.found) {
      drifted.push(`${m.page} [${m.key}]\n  markup:    ${m.found}\n  catalogue: ${expected}`);
    }
  }
  expect(drifted.join("\n\n")).toBe("");
});

// --- the values are the kind of thing they are used as ----------------------

test("no value is empty", () => {
  const blank = [...CATALOGUE]
    .filter(([, v]) => (typeof v === "string" ? !v.trim() : Object.values(v).some((f) => !f.trim())))
    .map(([k]) => k);
  expect(blank).toEqual([]);
});

test("values written to textContent carry no markup", () => {
  // `<b>` in one of these does not render, it shows up as four characters on
  // the page — so the mistake is worth catching here rather than in a screenshot
  const textKeys = new Set(MARKED.filter((m) => m.as !== "html").map((m) => m.key));
  const withTags = [...STRINGS]
    .filter(([k, v]) => textKeys.has(k) && /<[a-z/]/i.test(v))
    .map(([k]) => k);
  expect(withTags).toEqual([]);
});

test("values written as HTML use only the allowed tags", () => {
  const htmlKeys = new Set(MARKED.filter((m) => m.as === "html").map((m) => m.key));
  const offences: string[] = [];
  for (const [key, value] of STRINGS) {
    if (!htmlKeys.has(key)) continue;
    for (const [, tag] of value.matchAll(/<\/?([a-z0-9]+)/gi)) {
      if (!ALLOWED_TAGS.has(tag.toLowerCase())) offences.push(`${key}: <${tag}>`);
    }
    if (/\son[a-z]+\s*=/i.test(value)) offences.push(`${key}: inline event handler`);
    if (/javascript:/i.test(value)) offences.push(`${key}: javascript: URL`);
  }
  expect(offences).toEqual([]);
});

test("links inside a value point where the English one did", () => {
  // A translator retypes a sentence; the href comes along for the ride and is
  // the one part of it nobody proofreads. Every language's link set has to be
  // the English link set — this is the assertion the translations will be held
  // to, and with only English present it is checking that the catalogue's links
  // match the markup's.
  const hrefs = (s: string): string[] =>
    [...s.matchAll(/href="([^"]*)"/g)].map((m) => m[1]).sort();
  for (const m of MARKED.filter((x) => x.as === "html")) {
    const want = STRINGS.get(m.key);
    if (want === undefined) continue;
    expect(hrefs(want), m.key).toEqual(hrefs(m.found));
  }
});

// --- counted strings --------------------------------------------------------

/** the keys English counts with — the ones whose value is a set of forms */
const PLURAL_KEYS = [...CATALOGUE].filter(([, v]) => typeof v !== "string").map(([k]) => k);

test("a counted key is counted in every language, and only where English counts", () => {
  for (const [code, words] of TRANSLATIONS) {
    for (const [key, english] of CATALOGUE) {
      const mine = words.get(key);
      expect(typeof mine, `${code}: ${key} — shape must match English`).toBe(typeof english);
    }
  }
});

test("every language supplies the plural forms it can actually select", () => {
  // Not "exactly the CLDR set": French lists `many`, but only reaches it at a
  // million, and nothing in this port counts that high. The bar is the forms a
  // real count can land on — plus `other`, which t() falls back to.
  for (const [code, words] of [["en", CATALOGUE] as const, ...TRANSLATIONS]) {
    const rules = new Intl.PluralRules(code);
    const reachable = new Set<string>(["other"]);
    for (let n = 0; n <= 1000; n++) reachable.add(rules.select(n));
    const allowed = new Set<string>(rules.resolvedOptions().pluralCategories);

    for (const key of PLURAL_KEYS) {
      const forms = words.get(key) as unknown as Record<string, string> | undefined;
      expect(forms, `${code}: ${key}`).toBeTruthy();
      const given = new Set(Object.keys(forms!));
      for (const need of reachable) {
        expect(given.has(need), `${code}: ${key} is missing "${need}"`).toBe(true);
      }
      for (const got of given) {
        expect(allowed.has(got), `${code}: ${key} has "${got}", which ${code} never selects`).toBe(true);
      }
      // A form with no placeholder at all reads as a bare noun at runtime. Not
      // specifically `{n}`: a counted string may use the count only to SELECT
      // and print something else — movies.slotsStillName picks singular or
      // plural from how many actionframe slots there are, then prints the slot
      // list rather than the number.
      for (const [cat, text] of Object.entries(forms!)) {
        expect(/\{\w+\}/.test(text), `${code}: ${key}.${cat} has no placeholder`).toBe(true);
      }
    }
  }
});

test("Russian inflects its counted nouns", () => {
  // The whole reason plurals exist here: 1, 2 and 5 take different endings, and
  // three identical forms mean the categories were filled in without being read.
  // Not "all three differ" — after a preposition the genitive collapses `few`
  // into `many` (из 2 шагов, из 5 шагов), which is correct Russian.
  const ru = TRANSLATIONS.find(([c]) => c === "ru")?.[1];
  expect(ru, "no Russian translation").toBeTruthy();
  const rules = new Intl.PluralRules("ru");
  for (const key of PLURAL_KEYS) {
    // only where English itself inflects: "{n} with art" is the same phrase at
    // any count, and Russian has no more reason to change it than English does
    const eng = CATALOGUE.get(key) as unknown as Record<string, string>;
    if (eng.one === eng.other) continue;
    const forms = ru!.get(key) as unknown as Record<string, string>;
    const seen = new Set([1, 2, 5].map((n) => forms[rules.select(n)]));
    expect(seen.size, `${key}: 1/2/5 are all the same in Russian`).toBeGreaterThan(1);
  }
});

test("t() fills placeholders and picks a form", () => {
  // The runtime itself, on the English catalogue — which is the one `t` holds
  // before a translation loads, and the path every English reader takes.
  expect(t("common.loading", { path: "b59.set" })).toBe("loading b59.set…");
  expect(t("common.fetchFailed", { path: "x", status: 404 })).toBe("failed to fetch x (404)");

  // the count decides the form, and lands in the sentence
  expect(t("counts.flats", { n: 1 })).toBe("1 flat");
  expect(t("counts.flats", { n: 0 })).toBe("0 flats");
  expect(t("counts.flats", { n: 7 })).toBe("7 flats");

  // a placeholder nobody supplied stays visible rather than becoming "undefined"
  expect(t("common.notReadable", { ext: ".stg" })).toBe("not a readable .stg: {message}");
  // and a plain string with no params is returned untouched
  expect(t("common.exportedUnmodified")).toBe(", unmodified)");
});

// --- the walker that puts them on the page ----------------------------------

test("applyTranslations writes all three kinds of marked node", () => {
  // The one piece of the runtime the assertions above cannot reach: the three
  // `data-i18n*` forms are read through `dataset`, whose camel-casing is easy
  // to get wrong in a way that fails silently — a walker that matched nothing
  // would leave every page in English and look exactly like success.
  const { document } = parseHTML(`<html><body>
    <h1 data-i18n="home.h1">placeholder</h1>
    <p data-i18n-html="home.intro">placeholder</p>
    <button data-i18n-attr="title:play.fullscreenTitle" title="placeholder">x</button>
    <input data-i18n-attr="placeholder:play.savesNamePlaceholder" placeholder="x" />
  </body></html>`);

  applyTranslations(document as unknown as ParentNode);

  expect(document.querySelector("h1")!.textContent).toBe(en.home.h1);
  // the value went in as markup, not as text: the <b> is an element afterwards
  expect(document.querySelector("p b")!.textContent).toBe("RE");
  expect(document.querySelector("button")!.getAttribute("title")).toBe(en.play.fullscreenTitle);
  expect(document.querySelector("input")!.getAttribute("placeholder")).toBe(
    en.play.savesNamePlaceholder,
  );
});

// --- the translations, when they arrive -------------------------------------

const LOCALES = join(ROOT, "src/locales");

/** the `src/locales/<code>/` directories, which is what a translation IS */
const translationDirs = (): string[] =>
  readdirSync(LOCALES, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();

/** one language's words, flattened the same way {@link flatten} does English */
function translation(code: string): Map<string, Value> {
  const out = new Map<string, Value>();
  for (const ns of Object.keys(en)) {
    const path = join(LOCALES, code, `${ns}.json`);
    if (!existsSync(path)) continue;
    const group = JSON.parse(readFileSync(path, "utf8")) as Record<string, Value>;
    for (const [name, value] of Object.entries(group)) out.set(`${ns}.${name}`, value);
  }
  return out;
}

const TRANSLATIONS = translationDirs().map((code) => [code, translation(code)] as const);

test("a language directory and its registration arrive together", () => {
  // Half an added language — the JSON on disk but no entry in CATALOGUES, or an
  // entry pointing at nothing — is a page that silently stays English. Both
  // sides are read off disk here so that neither can be added alone.
  const onDisk = translationDirs();

  const source = readFileSync(join(LOCALES, "index.ts"), "utf8");
  const block = source.slice(source.indexOf("const CATALOGUES"), source.indexOf("/** the codes that"));
  const registered = [...block.matchAll(/^\s*(\w+): \(\) => import\("\.\/(\w+)"\)/gm)].map((m) => {
    expect(m[1], "the key and the directory it imports must agree").toBe(m[2]);
    return m[1];
  });

  expect(registered.sort()).toEqual(onDisk);
  for (const code of onDisk) {
    expect(LANGUAGES.map((l) => l.code), `${code} is not one of the six`).toContain(code);
    expect(code, "English is the source, not a translation").not.toBe(DEFAULT_LANGUAGE);
    expect(existsSync(join(LOCALES, code, "index.ts")), `${code}/index.ts`).toBe(true);
    // one JSON per namespace: the unit a translator is handed, and the unit the
    // per-language index.ts imports
    for (const ns of Object.keys(en)) {
      expect(existsSync(join(LOCALES, code, `${ns}.json`)), `${code}/${ns}.json`).toBe(true);
    }
  }
});

test("all five shipped languages are present", () => {
  // LANGUAGES is the six the GAME data comes in; the pages are expected to
  // reach all of them. If that ever stops being the goal, change this line
  // deliberately rather than letting a language quietly go missing.
  expect(translationDirs()).toEqual(
    LANGUAGES.map((l) => l.code).filter((c) => c !== DEFAULT_LANGUAGE).sort(),
  );
});

test("every translation has exactly the English keys", () => {
  for (const [code, words] of TRANSLATIONS) {
    const missing = [...CATALOGUE.keys()].filter((k) => !words.has(k));
    const extra = [...words.keys()].filter((k) => !CATALOGUE.has(k));
    expect(missing, `${code}: missing`).toEqual([]);
    expect(extra, `${code}: no longer in English`).toEqual([]);
  }
});

test("no translated value is empty", () => {
  for (const [code, words] of TRANSLATIONS) {
    const blank = [...words]
      .filter(([, v]) => (typeof v === "string" ? !v.trim() : Object.values(v).some((f) => !f.trim())))
      .map(([k]) => k);
    expect(blank, code).toEqual([]);
  }
});

test("translated values written to textContent carry no markup", () => {
  const textKeys = new Set(MARKED.filter((m) => m.as !== "html").map((m) => m.key));
  for (const [code, words] of TRANSLATIONS) {
    const withTags = [...words]
      .filter(([k, v]) => textKeys.has(k) && typeof v === "string" && /<[a-z/]/i.test(v))
      .map(([k]) => k);
    expect(withTags, code).toEqual([]);
  }
});

test("translated HTML values use only the allowed tags", () => {
  // The locale files are the one place a sentence becomes markup, so they are
  // the one place a translation round-trip could smuggle something in.
  const htmlKeys = new Set(MARKED.filter((m) => m.as === "html").map((m) => m.key));
  for (const [code, words] of TRANSLATIONS) {
    const offences: string[] = [];
    for (const [key, value] of words) {
      if (!htmlKeys.has(key) || typeof value !== "string") continue;
      for (const [, tag] of value.matchAll(/<\/?([a-z0-9]+)/gi)) {
        if (!ALLOWED_TAGS.has(tag.toLowerCase())) offences.push(`${key}: <${tag}>`);
      }
      if (/\son[a-z]+\s*=/i.test(value)) offences.push(`${key}: inline event handler`);
      if (/javascript:/i.test(value)) offences.push(`${key}: javascript: URL`);
    }
    expect(offences, code).toEqual([]);
  }
});

test("a translated link still points where the English one did", () => {
  // The href rides along inside the sentence, which makes it the one part of a
  // translation nobody proofreads.
  const hrefs = (s: string): string[] => [...s.matchAll(/href="([^"]*)"/g)].map((m) => m[1]).sort();
  for (const [code, words] of TRANSLATIONS) {
    for (const [key, english] of STRINGS) {
      if (!hrefs(english).length) continue;
      const mine = words.get(key);
      expect(hrefs(typeof mine === "string" ? mine : ""), `${code}: ${key}`).toEqual(hrefs(english));
    }
  }
});

test("a translation is not a copy of the English", () => {
  // Catches the placeholder file: English duplicated into a language directory
  // to make the shape tests pass, and then never translated. Product names and
  // a few loanwords legitimately match, so the bar is loose on purpose.
  for (const [code, words] of TRANSLATIONS) {
    const same = [...words].filter(([k, v]) => STRINGS.get(k) === v).length;
    expect(same / words.size, `${code} is ${Math.round((100 * same) / words.size)}% English`).toBeLessThan(0.2);
  }
});

// --- an element the code hides with `hidden` must actually be hidden ---------
// `hidden` only works through the UA sheet's `[hidden] { display: none }`, and
// ANY author `display` rule outranks it. So an element that main.ts toggles with
// `.hidden` and that also carries its own `display` needs a paired
// `[hidden] { display: none }` or the toggle is silently inert.
//
// `#netbusy` is the one that got away: the network spinner is `display: flex`,
// `netbusy.hidden = true` never took it off the screen, and it turned for the
// whole session over every room in the game (#55). The show/hide logic was
// right — only its `false` case had ever been visible. Two other elements were
// already carrying the paired rule with a comment saying exactly this
// (`.editionPicker` in src/theme.css, `#help .bar` here), which is a good sign
// this wants a test rather than a third comment.
test("elements toggled with .hidden survive their own display rule", () => {
  const html = readFileSync(join(ROOT, "play/index.html"), "utf8");
  const style = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join("\n");
  const main = readFileSync(join(ROOT, "src/main.ts"), "utf8");

  // every id main.ts sets `.hidden` on
  const toggled = new Set<string>();
  for (const m of main.matchAll(/(\w+)\.hidden\s*=/g)) toggled.add(m[1]);
  // …resolved back to the element id it was queried by
  const idOf = new Map<string, string>();
  for (const m of main.matchAll(/const\s+(\w+)\s*=\s*document\.getElementById\(\s*"([^"]+)"/g)) {
    idOf.set(m[1], m[2]);
  }

  const offenders: string[] = [];
  for (const name of toggled) {
    const id = idOf.get(name);
    if (!id) continue;
    // does the page give this id a display of its own?
    const rule = new RegExp(`#${id}\\s*\\{([^}]*)\\}`).exec(style);
    const display = rule && /display\s*:\s*([\w-]+)/.exec(rule[1])?.[1];
    if (!display || display === "none" || display === "block" || display === "inline") continue;
    const paired = new RegExp(`#${id}\\[hidden\\]\\s*\\{[^}]*display\\s*:\\s*none`).test(style);
    if (!paired) offenders.push(`#${id} is display:${display} with no #${id}[hidden] rule`);
  }
  expect(offenders, offenders.join("; ")).toEqual([]);
});
