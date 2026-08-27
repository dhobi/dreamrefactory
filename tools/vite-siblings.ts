/**
 * A signpost, for dev only: what to do when you click a link into another
 * package.
 *
 * The five sites share one deployed directory but have five Vite ROOTS, and that
 * is what makes `/src/main.ts` in a page mean the right file. The cost shows
 * up in the top bar: from Titanic's dev server, `../editors/` is a path this
 * server knows nothing about.
 *
 * ## Why not just proxy it
 *
 * Because it cannot work. In dev, Vite serves the HTML as authored, so a page
 * asks for `/src/main.ts`, `/taoot-mark.png` and `/gamefiles/…` — all
 * ROOT-absolute, all resolved against whatever origin the browser is on. Proxy
 * `/taoot/*` to Titanic's server and the page arrives, then asks the SITE's
 * server for `/src/main.ts` — a path that exists in every one of those packages
 * and means something different in each. The deployed tree has no such problem: `base:
 * "./"` makes every emitted URL relative to the page that names it.
 *
 * ## So: an honest 404 with directions
 *
 * `appType: "mpa"` already stops Vite answering an unknown path with this
 * package's `index.html`, which is what used to make a broken cross-site link
 * look like a working one — 200, with the wrong page in it. This turns the
 * resulting 404 into a sentence naming the command to run and the URL to open.
 */
import type { Plugin } from "vite";

export interface Sibling {
  /** the path prefix, without slashes: "taoot", "dust", "editors", "docs" */
  path: string;
  /** what to run */
  command: string;
  /** where it will then be */
  port: number;
  /** what it is, for the sentence */
  what: string;
}

export function siblingSignposts(siblings: readonly Sibling[]): Plugin {
  return {
    name: "sibling-signposts",
    // dev only: a build has no siblings to miss, and the deployed tree resolves
    // these paths for real
    apply: "serve",
    configureServer(server) {
      for (const s of siblings) {
        server.middlewares.use(`/${s.path}`, (req, res) => {
          const rest = (req.url ?? "/").replace(/^\/+/, "");
          const there = `http://localhost:${s.port}/${rest}`;
          res.statusCode = 404;
          res.setHeader("content-type", "text/html; charset=utf-8");
          res.end(
            `<!doctype html><meta charset="utf-8">` +
              `<title>${s.what} — another dev server</title>` +
              `<style>body{font:16px/1.6 system-ui,sans-serif;background:#0c0e12;color:#c7d2de;` +
              `margin:0;display:grid;place-items:center;min-height:100vh}` +
              `main{max-width:34rem;padding:2rem}code{font-family:ui-monospace,monospace;` +
              `background:#1b2029;padding:.15em .4em;border-radius:3px;color:#9cc9e8}` +
              `a{color:#7ab4dd}h1{font-size:1.15rem;margin:0 0 1rem}` +
              `p{color:#8b98a8}</style>` +
              `<main><h1>${s.what} is served by its own dev server</h1>` +
              `<p>The sites share one deployed directory but build from a root each, ` +
              `so a dev server serves only its own package. In the deployed tree this ` +
              `link resolves normally.</p>` +
              `<p>Run <code>${s.command}</code>, then open ` +
              `<a href="${there}">${there}</a></p></main>`,
          );
        });
      }
    },
  };
}
