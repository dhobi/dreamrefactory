/**
 * A game's home page, written from its facts (tools/home-pages.ts) — the one
 * template Dust's, Timelapse's, RedJack's, Lunicus's, Jump Raven's and Skull
 * Cracker's home pages come from, where each used to be its own copy of the
 * same page.
 *
 * The page's file, `index.html`, is a stub: Vite needs one to serve and to
 * build, and this replaces its whole text before Vite reads it, so the scripts
 * and images it names are resolved and rewritten exactly as a hand-written
 * page's are. Its look is chrome/src/home.css and its script chrome/src/home.ts.
 */
import type { Plugin } from "vite";
import type { HomePage } from "./home-pages";

const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");

export function homePageHtml(p: HomePage): string {
  const ways = [
    `<a href="./play/" class="playway">Play</a>`,
    ...(p.speedrun
      ? [`<a href="./speedrun/" class="playway" title="Speedrun workbench — drive the game from a run sheet against the clock">Speedrunner</a>`]
      : []),
    ...(p.links ?? []).map((l) => `<a href="${esc(l.href)}"${l.title ? ` title="${esc(l.title)}"` : ""}>${esc(l.text)}</a>`),
  ];
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <meta name="robots" content="noindex, nofollow" />
    <!-- where the site's root is from THIS page: its own directory -->
    <meta name="site-root" content="./" />
    <title>${esc(p.heading ?? `${p.name}: ${p.subtitle}`)}</title>
    <link rel="icon" type="image/svg+xml" href="/${p.dir}-mark.svg" />
    <!-- the same install tags as the play page; site/tests/app-icons.ts holds them to their source -->
    <link rel="manifest" href="/app.webmanifest" />
    <link rel="apple-touch-icon" href="/${p.dir}-apple-touch-180.png" />
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-status-bar-style" content="black" />
    <meta name="apple-mobile-web-app-title" content="${esc(p.name)}" />
    <meta name="theme-color" content="${p.themeColor}" />
    <link rel="stylesheet" href="/src/theme.css" />
  </head>
  <body class="deep">
    <header class="topbar">
      <a
        class="brand"
        href="./"
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
        <a href="../" title="dreamREfactory — the engine, and the other games">dreamREfactory</a>
        <a href="../docs/">Docs</a>
        <a href="https://github.com/dhobi/dreamrefactory">Source</a>
      </nav>
    </header>

    <div id="home">
      <!-- decorative: the <h1> below is the page's name for itself -->
      <img class="hero-mark" src="/${p.dir}-logo.png" alt="" width="${p.logo.width}" height="${p.logo.height}" />
      <h1>${esc(p.heading ?? p.subtitle)}</h1>
      <div class="intro">
        <b>RE</b> is for reverse-engineered. This is not an emulation: it is a
        version of CyberFlix's DreamFactory engine implemented in JavaScript
        (TypeScript), playing ${esc(p.playing)}. ${esc(p.status)}, but it is
        younger than the original engine by some years.<br />Play around, try
        the <a href="../editors/">editors</a> and report bugs straight to us on
        <a href="https://github.com/dhobi/dreamrefactory/issues/new">GitHub</a>.
      </div>

      <div class="playrow">
        <a class="play" href="./play/"><span class="glyph">▶</span><span>Play</span></a>
        <div class="note">Get straight to it!</div>
      </div>

      <p class="credits">Built with the support of Claude Opus and Claude Fable.</p>

      <a class="bmc" href="https://buymeacoffee.com/danielhobi" rel="noopener"
        ><img src="/bmc-mark.svg" alt="" width="35" height="50" /><span>Buy me a coffee</span></a
      >
    </div>

    <script type="module">
      import "@dreamfactory/chrome/home";
    </script>
  </body>
</html>
`;
}

/** the plugin: `index.html` at the game's root becomes its home page */
export function homePage(p: HomePage): Plugin {
  return {
    name: "game-home-page",
    transformIndexHtml: {
      order: "pre",
      handler: (html, ctx) => (ctx.path === "/index.html" ? homePageHtml(p) : html),
    },
  };
}
