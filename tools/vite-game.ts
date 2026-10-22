/**
 * A game's Vite config: what every game's `vite.config.ts` said line for line,
 * once.
 *
 * Each game is a package of its own with its own dev server, and each page it
 * builds sits under `dist/<game>/`. What differs is passed in: the port, the
 * pages besides the home page and the play page, the game's own plugins (the
 * speedrun workbench, Titanic's intro film, Lunicus's replays), and the odd
 * server or worker setting. The rest — the base, the version define, the
 * game-file manifest, the signposts to the sibling servers — is the same for
 * all of them and lives here.
 */
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { defineConfig, type PluginOption, type UserConfig } from "vite";
import { gamefilesManifest } from "./vite-gamefiles";
import { siblingSignposts, siblingsBut, SIBLINGS } from "./vite-siblings";
import { HOME_PAGES } from "./home-pages";
import { homePage } from "./vite-home";

export interface GameConfigOptions {
  /** the game's directory, its package's own (`import.meta` of its vite.config.ts) */
  root: string;
  /** the folder name, which is also its path on the site and in `dist/` */
  dir: string;
  /** its pages besides `index.html` (the home page) and `play/index.html`: name → path from `root` */
  pages?: Record<string, string>;
  /** the game's own plugins, run before the shared ones */
  plugins?: PluginOption[];
  /** the game-file subtrees to list beyond the default (tools/vite-gamefiles.ts `include`) */
  gamefiles?: { include?: string[] };
  /** anything else for `server` (Titanic's tunnel host) */
  server?: UserConfig["server"];
  /** a worker's format, where a page builds one (Titanic's Calculate) */
  worker?: UserConfig["worker"];
}

export function gameConfig(o: GameConfigOptions): UserConfig {
  const version = JSON.parse(readFileSync(join(o.root, "package.json"), "utf8")).version as string;
  const port = SIBLINGS.find((s) => s.path === o.dir)?.port;
  if (!port) throw new Error(`tools/vite-siblings.ts has no port for ${o.dir}`);
  const pages: Record<string, string> = { [o.dir]: "index.html", play: "play/index.html", ...o.pages };
  // the home page, from the one template, for every game that has its facts (Titanic's is its own)
  const home = HOME_PAGES.find((h) => h.dir === o.dir);
  return defineConfig({
    root: o.root,
    publicDir: join(o.root, "public"),
    /*
     * Every URL the build emits is relative to the page that names it, so the
     * output runs from a subdirectory of some other host as readily as from a
     * domain root. Vite does that rewriting for what it can see — the module
     * scripts, the stylesheets and the `public/` images the HTML names, all
     * written "/…" in source BECAUSE that is what it rewrites — and works out
     * the number of `../` per page. `<a href>` between pages is written
     * relative in the HTML, and URLs built in TypeScript go through `siteUrl`
     * (chrome/src/site.ts), which resolves them against the game's root.
     */
    base: "./",
    /*
     * A multi-page site, not a single-page app. Without this, Vite answers every
     * unknown path with the package's `index.html` — so a link into another
     * package (`../editors/`, `../docs/`) came back 200 with the wrong page in
     * it, and a broken cross-site link looked like a working one.
     */
    appType: "mpa",
    // substituted into the source text, so the version travels in the bundle and
    // no page has to fetch anything to know it
    define: { __APP_VERSION__: JSON.stringify(version) },
    ...(o.worker ? { worker: o.worker } : {}),
    plugins: [
      ...(home ? [homePage(home)] : []),
      ...(o.plugins ?? []),
      gamefilesManifest({ gamefiles: join(o.root, "gamefiles"), publicDir: join(o.root, "public"), include: o.gamefiles?.include }),
      siblingSignposts(siblingsBut(o.dir)),
    ],
    server: {
      port,
      strictPort: true,
      /*
       * gamefiles/ is a CD rip — Titanic's is ~7,800 files the middleware streams
       * as raw bytes. Vite never transforms them, but chokidar still spends an
       * inotify handle per file: two dev servers at once ENOSPC'd outright,
       * which is how this was found.
       */
      watch: { ignored: ["**/gamefiles/**"] },
      ...o.server,
    },
    build: {
      target: "es2022",
      outDir: resolve(o.root, `../dist/${o.dir}`),
      emptyOutDir: true,
      rollupOptions: {
        input: Object.fromEntries(Object.entries(pages).map(([name, path]) => [name, join(o.root, path)])),
      },
    },
  });
}
