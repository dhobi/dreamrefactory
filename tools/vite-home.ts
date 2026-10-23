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
import { bmcLink, esc, headTags, topbar } from "./vite-shell";

export function homePageHtml(p: HomePage): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <meta name="robots" content="noindex, nofollow" />
    <!-- where the site's root is from THIS page: its own directory -->
    <meta name="site-root" content="./" />
    ${headTags(p)}
  </head>
  <body class="deep">
    ${topbar(p, "")}

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

      ${bmcLink}
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
