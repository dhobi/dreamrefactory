/**
 * The parts every game's pages share, written from its facts
 * (tools/home-pages.ts): the head's title and install tags, the top bar, and
 * the footer. The home page is made of them (tools/vite-home.ts), and a play
 * page asks for them by leaving the slot empty:
 *
 *     <!-- shell:head -->               the title, icons, manifest, theme, and
 *                                       the page's own sheet, src/play.css
 *     <header class="topbar"></header>  the brand, the version, the ways in
 *     <footer id="foot"></footer>       the ask
 *
 * Each used to be written out in every page, the same lines with the game's
 * name in them. A play page sits one folder under the game's root, so its links
 * climb one more `../` (`up`). The speedrun workbench, made from the play page,
 * is filled first and moved second (speedrun/vite.ts `prepare`), so what it
 * rearranges is the whole page.
 */
import type { Plugin } from "vite";
import type { HomePage } from "./home-pages";

export const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");

/** the page's title, as the home page and the play page both state it */
export const pageTitle = (p: HomePage): string => p.heading ?? `${p.name}: ${p.subtitle}`;

/** the title, the icons and the install tags — site/tests/app-icons.ts holds them to their source */
export function headTags(p: HomePage): string {
  return `<title>${esc(pageTitle(p))}</title>
    <link rel="icon" type="image/svg+xml" href="/${p.dir}-mark.svg" />
    <link rel="manifest" href="/app.webmanifest" />
    <link rel="apple-touch-icon" href="/${p.dir}-apple-touch-180.png" />
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-status-bar-style" content="black" />
    <meta name="apple-mobile-web-app-title" content="${esc(p.name)}" />
    <meta name="theme-color" content="${p.themeColor}" />
    <link rel="stylesheet" href="/src/theme.css" />`;
}

/** the top bar: the brand, the version main.ts fills, and the ways in — `up` is "" on the home page, "../" one folder down */
export function topbar(p: HomePage, up: string): string {
  const ways = [
    `<a href="${up}./play/" class="playway">Play</a>`,
    ...(p.speedrun
      ? [`<a href="${up}./speedrun/" class="playway" title="Speedrun workbench — drive the game from a run sheet against the clock">Speedrunner</a>`]
      : []),
    ...(p.links ?? []).map((l) => {
      const title = l.title ? ` title="${esc(l.title)}"` : "";
      return `<a href="${up}${esc(l.href)}"${title}>${esc(l.text)}</a>`;
    }),
  ].map((a) => a.replace(`href=".././`, `href="../`));
  return `<header class="topbar">
      <a
        class="brand"
        href="${up || "./"}"
        title="RE — reverse-engineered: a best-effort re-implementation of the DreamFactory engine, not the original ${p.year} release"
      >
        <img class="brand-mark" src="/${p.dir}-mark.svg" alt="" width="30" height="30" />
        <span class="brand-text">
          <b>${esc(p.name)}</b>
          <span>${esc(p.subtitle)}</span>
        </span>
      </a>
      <span class="version" id="ver"></span>
      <nav class="topnav">
        ${ways.join("\n        ")}
        <a href="${up}../" title="dreamREfactory — the engine, and the other games">dreamREfactory</a>
        <a href="${up}../docs/">Docs</a>
        <a href="https://github.com/dhobi/dreamrefactory">Source</a>
      </nav>
    </header>`;
}

/** the ask, in Buy Me a Coffee's own wording */
export const bmcLink = `<a class="bmc" href="https://buymeacoffee.com/danielhobi" rel="noopener"
        ><img src="/bmc-mark.svg" alt="" width="35" height="50" /><span>Buy me a coffee</span></a
      >`;

/** the page with its own <title> line taken out, if it has one */
function withoutTitle(html: string): string {
  const at = html.indexOf("<title>");
  if (at < 0) return html;
  const end = html.indexOf("</title>", at) + "</title>".length;
  const from = html.lastIndexOf("\n", at) + 1;
  const line = html.slice(from, at).trim() === "" && html[end] === "\n";
  return line ? html.slice(0, from) + html.slice(end + 1) : html.slice(0, at) + html.slice(end);
}

/** a page with its empty slots filled; one with none is returned as it was */
export function expandShell(html: string, p: HomePage, up = "../"): string {
  // The page's own <title> is there so the file is a page as it stands; the slot
  // writes the one from the facts, so a stale one cannot ship. Only while the
  // slot is still there: a page filled once (the workbench is, then served
  // through the same plugin) keeps the title it was given.
  const own = html.includes("<!-- shell:head -->") ? withoutTitle(html) : html;
  return own
    .replace("<!-- shell:head -->", `${headTags(p)}\n    <link rel="stylesheet" href="/src/play.css" />`)
    .replace(`<header class="topbar"></header>`, topbar(p, up))
    .replace(`<footer id="foot"></footer>`, `<footer id="foot">\n      ${bmcLink}\n    </footer>`);
}

/** the plugin: every page of the game but the home page (vite-home.ts) gets its slots filled */
export function shellParts(p: HomePage): Plugin {
  return {
    name: "game-shell-parts",
    transformIndexHtml: {
      order: "pre",
      handler: (html, ctx) => (ctx.path === "/index.html" ? html : expandShell(html, p)),
    },
  };
}
