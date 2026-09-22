/**
 * The three ways to play, folded into one dropdown.
 *
 * Titanic ships the game three times over: the play page a reader is meant to
 * use, the developer-mode page (the debug build, with TI.EXE's menu bar and a
 * script console) and the speedrun workbench (a run sheet driven against the
 * clock). They are three ways INTO the same game rather than three destinations,
 * so the bar carries one "Play" that opens onto them instead of three links
 * competing with Minigames and Collection.
 *
 * ## It folds the markup rather than replacing it
 *
 * The same bargain {@link file://./games-menu.ts} makes, for the same reasons: the
 * links stay authored inline in every page's `<nav>`, and this MOVES them into a
 * dropdown inserted where the first one stood. A reader with no JavaScript sees
 * three links exactly as before, an English reader needs no catalogue fetch, and
 * `git diff` shows the hrefs in the markup where a reviewer expects them.
 *
 * Nothing here knows the pages' names or hrefs — it recognises them by the
 * `playway` class the markup gives them.
 *
 * ## The labels
 *
 * The summary is the page's own translated "Play": unlike the games menu and the
 * language picker, this runs AFTER `installI18n` on every page that calls it, so
 * the catalogue is there to ask. It reads the word off the first link rather than
 * fetching a key, which keeps the one translated string in the markup where
 * site/tests/locales.ts can hold it.
 *
 * The other two stay English. Both pages they open are English-only by
 * construction — the workbench pins `<meta name="edition" content="en">` and
 * developer mode is built on addresses read out of the English executable — and
 * a menu that translated the way in but not the page would promise something it
 * cannot keep.
 */

/** the class the markup puts on each way in */
const WAY = "playway";

/**
 * Fold the nav's play links into a dropdown, and say how many it took.
 *
 * Does nothing where there is no top bar and nothing where the bar carries fewer
 * than two of them — one way in is better as a link.
 */
export function installPlayMenu(): number {
  const nav = document.querySelector(".topnav");
  if (!nav) return 0;
  const links = [...nav.querySelectorAll<HTMLAnchorElement>(`a.${WAY}[href]`)];
  if (links.length < 2) return 0;

  const menu = document.createElement("details");
  menu.className = "navmenu playmenu";
  const summary = document.createElement("summary");
  // the first link's own text, which is the translated "Play" — see the note on
  // the labels above
  summary.textContent = links[0].textContent?.trim() || "Play";
  summary.title = "How to open the game";
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
  // ...and the first one is the ordinary way in, which is what it is called
  // once the menu above it already says "Play"
  links[0].textContent = "Normal";
  menu.appendChild(list);

  // a click anywhere else closes it, which <details> does not do by itself
  document.addEventListener("click", (e) => {
    if (menu.open && !menu.contains(e.target as Node)) menu.open = false;
  });
  return links.length;
}
