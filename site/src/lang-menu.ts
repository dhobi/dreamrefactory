/**
 * The language picker in the page's own top bar: the words on the page, and
 * nothing else.
 *
 * One of the site's two axes, and the simpler one. It sets the UI LANGUAGE — the
 * chrome, the labels, the prose — for every page, out of the six the site is
 * translated into ({@link uiLanguageOptions}), whatever a reader's install of the
 * game happens to carry. The other axis is the EDITION, which is what a page's
 * CONTENT is read from: taoot/src/editions.ts owns it, three page groups carry its
 * button row, and this control does not touch it.
 *
 * That separation is the point, and it is newer than the pages are. The two used
 * to be one setting: `?lang=` named a `gamefiles/` tree AND was consulted for the
 * page's language, so switching to the German data moved the whole site into
 * German, and a reader with the English disc who reads German had to fight it.
 * Now `?lang=` is the page and `?edition=` is the game — see the block comment in
 * taoot/src/languages.ts.
 *
 * Switching is a RELOAD, and a cheap one: the catalogue is fetched per language
 * (site/src/locales/index.ts), the pages carry their English inline, and a reload is
 * how a language reaches the strings the TypeScript built before `installI18n`
 * ran. It says so in `?lang=` as well as in storage so that the reloaded page
 * cannot disagree with itself, and so a link can carry it.
 *
 * The authored chooser (public/lang.stg, taoot/src/lang-chooser.ts) is NOT this
 * control's other half any more: it runs before any tree has been read and what
 * it asks is which EDITION to boot.
 */
import { UI_LANG_STORAGE_KEY } from "./ui-languages";
import { uiLanguage, uiLanguageOptions } from "@dreamfactory/site/locales";

/** remember the choice, put it in the URL, and start the page over */
function switchTo(code: string): void {
  try {
    window.localStorage.setItem(UI_LANG_STORAGE_KEY, code);
  } catch {
    /* then the query parameter is carrying it alone */
  }
  const url = new URL(window.location.href);
  url.searchParams.set("lang", code);
  window.location.href = url.toString();
}

/**
 * Put the picker in the top bar, and answer which language the page is in.
 *
 * Returns the code whether or not a control was drawn, so a caller can use it
 * unconditionally — nothing is drawn on a page with no top bar to draw it in.
 * Unlike the edition row, it is never hidden for want of choice: the site is
 * translated into six languages on every deployment, which is a fact about the
 * site rather than about the reader's install.
 */
export function installLanguageMenu(): string {
  const code = uiLanguage();
  const nav = document.querySelector(".topnav");
  if (!nav) return code;

  const options = uiLanguageOptions();
  const menu = document.createElement("details");
  menu.className = "langmenu";
  const summary = document.createElement("summary");
  // The globe and the name are separate nodes so a narrow screen can drop the
  // name and keep the affordance: six nav items plus "🌐 Nederlands" does not fit
  // one row on a phone, and a second row of chrome costs more than the word does.
  // Text nodes rather than innerHTML — the name is ours, but so is the habit.
  summary.append("🌐 ");
  const named = document.createElement("span");
  named.className = "langname";
  named.textContent = options.find((o) => o.code === code)?.name ?? code;
  summary.append(named);
  // Hard-coded English, like every string this repo builds in TypeScript rather
  // than in markup (site/src/locales/en.ts says why); unlike most of those it is
  // chrome on all eleven pages, so it is worth a catalogue key as soon as the
  // entries stop racing installI18n.
  summary.title = "Language — the words on this page";
  menu.appendChild(summary);

  const list = document.createElement("div");
  list.className = "langmenu-list";
  for (const o of options) {
    const item = document.createElement("button");
    item.type = "button";
    item.textContent = o.name;
    if (o.code === code) item.className = "here";
    item.addEventListener("click", () => switchTo(o.code));
    list.appendChild(item);
  }
  menu.appendChild(list);

  // a click anywhere else closes it, which <details> does not do by itself
  document.addEventListener("click", (e) => {
    if (menu.open && !menu.contains(e.target as Node)) menu.open = false;
  });
  nav.appendChild(menu);
  return code;
}
