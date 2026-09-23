/**
 * The ways to play, folded into one dropdown.
 *
 * Titanic ships the game several times over: the play page a reader is meant to
 * use, the free-roam page (the disc's own guided tour, with every door
 * answering), the developer-mode page (the debug build, with TI.EXE's menu bar
 * and a script console) and the speedrun workbench (a run sheet driven against
 * the clock). They are ways INTO the same game rather than separate
 * destinations, so the bar carries one "Play" that opens onto them instead of
 * four links competing with Minigames and Collection.
 *
 * ## It folds the markup rather than replacing it
 *
 * The same bargain {@link file://./games-menu.ts} makes, for the same reasons: the
 * links stay authored inline in every page's `<nav>`, and this MOVES them into a
 * dropdown inserted where the first one stood. A reader with no JavaScript sees
 * three links exactly as before, an English reader needs no catalogue fetch, and
 * `git diff` shows the hrefs in the markup where a reviewer expects them.
 *
 * Nothing here knows the pages' names or hrefs, or how many there are — it
 * recognises them by the `playway` class the markup gives them, and a page added
 * to a nav appears here without this file changing.
 *
 * ## The labels
 *
 * The summary is the translated "Play", from the catalogue. This waits for the
 * catalogue itself rather than assuming the page fetched it first — see
 * {@link installPlayMenu} — because three pages did not, and the bar read
 * "Play · Обычный · Свободный режим" until they were made to.
 *
 * "Original" is translated too, through the catalogue rather than the markup,
 * because it REPLACES what the markup says: the first link carries the
 * translated "Play" and the summary above has just taken that word. So does
 * "Free roam", which is marked in the markup like any other nav word — the tour
 * is in every edition's BOOTFILE and that page plays whichever tree the reader
 * chose.
 *
 * Developer and Speedrunner stay English, and that is a decision rather than a
 * gap: both open pages that are English by construction — the workbench pins
 * `<meta name="edition" content="en">` and developer mode is built on addresses
 * read out of the English executable — and a menu that translated the way in but
 * not the page would promise something it cannot keep.
 */

import { installI18n, t } from "./locales";

/** the class the markup puts on each way in */
const WAY = "playway";

/**
 * Fold the nav's play links into a dropdown, and say how many it took.
 *
 * Does nothing where there is no top bar and nothing where the bar carries fewer
 * than two of them — one way in is better as a link.
 */
export async function installPlayMenu(): Promise<number> {
  // The words before the menu that is made of them. Awaited here rather than
  // left to the caller: three pages called this with `void installI18n()` on
  // the line above and built a Russian bar with an English "Play" in it. The
  // install is memoised, so this joins the one already in flight.
  await installI18n();
  const nav = document.querySelector(".topnav");
  if (!nav) return 0;
  const links = [...nav.querySelectorAll<HTMLAnchorElement>(`a.${WAY}[href]`)];
  if (links.length < 2) return 0;

  const menu = document.createElement("details");
  menu.className = "navmenu playmenu";
  const summary = document.createElement("summary");
  // From the catalogue rather than from the first link's text. Same word, and
  // one less thing to be true: the link carries `data-i18n="site.navPlay"` on
  // nine of the ten pages that have this bar, and reading it meant the summary
  // was only as translated as the markup happened to be — English on the tenth,
  // and English everywhere if this ran before the catalogue landed.
  summary.textContent = t("site.navPlay");
  summary.title = t("site.navPlayMenuTitle");
  menu.appendChild(summary);

  const list = document.createElement("div");
  list.className = "navmenu-list";
  // the menu goes where the first link stood, then the links move into it
  links[0].before(menu);
  /*
   * Which way in is being used, worked out from the URL rather than taken from
   * the markup.
   *
   * The pages author `class="here"` on the link to themselves, and for Play that
   * was written when Play was the only way in — the speedrun page marks
   * `../play/` as `here`, which was harmless in a row of links and is wrong in a
   * menu, where it would light up "Normal" while you are reading the workbench.
   * So the menu asks the address bar, the way the games menu does.
   */
  const here = window.location.pathname.replace(/\/[^/]*$/, "/");
  for (const a of links) {
    const target = a.getAttribute("href")?.replace(/^.*?([^/]+)\/$/, "$1") ?? "";
    const mine = !!target && here.endsWith(`/${target}/`);
    a.classList.toggle("here", mine);
    // ...and the summary says "you are inside this menu", which is what a folded
    // current page means
    if (mine) menu.classList.add("here");
    list.appendChild(a);
  }
  // ...and the first one is the game as it shipped, which is what it is called
  // once the menu above it already says "Play" — the other three are all this
  // one with something added. Through the catalogue rather
  // than the markup, because this word REPLACES what the markup says: the link
  // carries the translated "Play", which the summary above has just taken.
  //
  // The attribute goes with it. `applyTranslations` rewrites every `data-i18n`
  // node from the catalogue, and a link that kept the key would be turned back
  // into "Play" by any later pass over the document.
  links[0].removeAttribute("data-i18n");
  links[0].textContent = t("site.navOriginal");
  menu.appendChild(list);

  // a click anywhere else closes it, which <details> does not do by itself
  document.addEventListener("click", (e) => {
    if (menu.open && !menu.contains(e.target as Node)) menu.open = false;
  });
  return links.length;
}
