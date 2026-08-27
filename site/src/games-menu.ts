/**
 * The games in the top bar, folded into one dropdown.
 *
 * The front page and the nine editor pages list every game the port plays, which
 * was four links in a row of six and is now a menu — the same `<details>` the
 * language picker beside it is ({@link file://./lang-menu.ts}), sharing its
 * `navmenu` styling and differing only in what it holds.
 *
 * ## It folds the markup rather than replacing it
 *
 * The links stay authored inline in every page's `<nav>`, and this MOVES them into
 * the dropdown it inserts where the first one stood. Nothing here knows the games'
 * names or their hrefs — it recognises them by their directory against the
 * registry ({@link GAMES}) and then carries the author's own anchors across, with
 * whatever `data-i18n` and text they had.
 *
 * That is deliberate, and it is the same bargain the rest of the chrome makes: a
 * reader with no JavaScript sees the four links exactly as before, an English
 * reader needs no catalogue fetch, and `git diff` still shows the row of games in
 * the markup where a reviewer expects to find it. A menu built from `GAMES` in
 * TypeScript would have been shorter and would have taken the links away from the
 * one reader who cannot get them back.
 *
 * ## The marks
 *
 * Each line carries the game's own favicon, which is where the icon comes from:
 * `site/public/mark-*` are copies of each game's `<dir>/public/<dir>-mark.*`, held
 * to the originals byte-for-byte by site/tests/front-doors.ts. The copies exist
 * because these pages are served by the SITE build, and on the dev server a
 * game's own public directory is behind its own port — see
 * {@link GameEditions.mark}.
 *
 * The `src` goes through {@link siteUrl}, which is the whole reason that module
 * exists: Vite rebases every URL it can SEE, and it cannot see one assembled in
 * TypeScript at runtime. `/mark-taoot.png` is a path off the HOST's root, and this
 * site is published in a subdirectory — so the marks 404'd on the live site while
 * being correct in dev and in every local build. `<meta name="site-root">` is what
 * each page uses to say how deep it is.
 *
 * ## The label
 *
 * Hard-coded English, like the sibling picker's, and for the same reason its own
 * comment gives: this is chrome built in TypeScript rather than in markup, so it
 * runs before `installI18n` has a catalogue, and site/tests/locales.ts holds the
 * markup and the catalogue to each other rather than holding this. It is worth a
 * key as soon as that race is settled.
 */
import { GAMES } from "./games";
import { siteUrl } from "./site";

/** is this href one of the registry's game directories */
function gameDir(href: string | null): string | null {
  const m = /(?:^|\/)([a-z0-9]+)\/$/.exec(href ?? "");
  return m && GAMES.some((g) => g.dir === m[1]) ? m[1] : null;
}

/**
 * Fold the nav's game links into a "Games" dropdown, and say how many it took.
 *
 * Does nothing where there is no top bar, and nothing where the bar carries fewer
 * than two of them — a game's own page links to its siblings' pages not at all,
 * and a single link is better as a link.
 */
export function installGamesMenu(): number {
  const nav = document.querySelector(".topnav");
  if (!nav) return 0;
  const links = [...nav.querySelectorAll<HTMLAnchorElement>("a[href]")].filter((a) =>
    gameDir(a.getAttribute("href")),
  );
  if (links.length < 2) return 0;

  const menu = document.createElement("details");
  menu.className = "navmenu gamemenu";
  const summary = document.createElement("summary");
  // the icon and the word as separate nodes, the way the language picker has
  // them, so a narrow screen could drop one and keep the other
  summary.append("🎮 ");
  const named = document.createElement("span");
  named.className = "gamename";
  named.textContent = "Games";
  summary.append(named);
  summary.title = "The games this port plays";
  menu.appendChild(summary);

  const list = document.createElement("div");
  list.className = "navmenu-list";
  // insert the menu where the first game link was, then carry the links into it
  links[0].before(menu);
  const here = window.location.pathname.replace(/\/[^/]*$/, "/");
  for (const a of links) {
    const dir = gameDir(a.getAttribute("href"));
    // the page being read, marked the way the nav marks the current page
    if (dir && here.endsWith(`/${dir}/`)) a.classList.add("here");
    // and the game's own mark in front of its name — the same little icon its
    // page uses as a favicon, from the site's own copy ({@link GameEditions.mark})
    const mark = GAMES.find((g) => g.dir === dir)?.mark;
    if (mark) {
      const icon = document.createElement("img");
      // through `siteUrl`, and see {@link file://./site.ts} for why a bare "/" is
      // wrong: this URL is built at RUNTIME, so Vite never rebases it, and the
      // deployment is a SUBDIRECTORY — `/mark-taoot.png` asked
      // danielhobi.ch for a file that lives under /dreamrefactory/, and all four
      // marks 404'd on the live site while working in every local build
      icon.src = siteUrl(mark);
      icon.alt = "";
      icon.width = 16;
      icon.height = 16;
      // a missing file leaves the name alone rather than a broken frame
      icon.addEventListener("error", () => icon.remove());
      a.prepend(icon);
    }
    list.appendChild(a);
  }
  menu.appendChild(list);

  // a click anywhere else closes it, which <details> does not do by itself
  document.addEventListener("click", (e) => {
    if (menu.open && !menu.contains(e.target as Node)) menu.open = false;
  });
  return links.length;
}
