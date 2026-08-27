/**
 * Titanic's four pages: the front page, the game, the collection page and the
 * unlisted speedrun workbench.
 *
 * The Vite ROOT is this directory, which is what makes `/src/main.ts` in a page
 * mean `taoot/src/main.ts` and `gamefiles/` mean Titanic's rip and no other.
 * The output goes to `dist/taoot/`, which is the shape of the URL it is served
 * at (`…/dreamrefactory/taoot/`), and the deploy uploads that directory into it.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";
import { Plugin, defineConfig } from "vite";
import { gamefilesManifest } from "../tools/vite-gamefiles";
import { siblingSignposts } from "../tools/vite-siblings";
// RELATIVE, like everything a Vite config reaches: the config is bundled and run
// under Node, where a bare specifier is left external for a loader that can
// follow neither the engine's extensionless imports nor a .ts file at all.
import { NIGHTDIVE_GIF, NIGHTDIVE_OUT, writeNightdiveMov } from "./tools/mknightdive";

/** this file's own directory — not the working directory, which differs between
    `npm run build -w @dreamfactory/taoot` and `vite build --config` */
const HERE = fileURLToPath(new URL(".", import.meta.url));

/** the port's version, from the package that holds this game and nothing else */
const VERSION = JSON.parse(readFileSync(join(HERE, "package.json"), "utf8")).version as string;

/**
 * The speedrun workbench's route, served in dev and emitted into the build.
 *
 * The sheet is a test fixture (`tests/speedrun/run.sheet.txt`) — the route the
 * headless runner drives — and the page offers a "Copy the full run" button that
 * starts you from it rather than from an empty sheet. It stays in `tests/`
 * because that is where it is run from, and is copied out at build time rather
 * than moved, which would cost every path that names it.
 */
const SHEET_SRC = join(HERE, "tests/speedrun/run.sheet.txt");
const SHEET_URL = "/speedrun/run.sheet.txt";

function runSheet(): Plugin {
  return {
    name: "run-sheet",
    configureServer(server) {
      server.middlewares.use(SHEET_URL, (_req, res, next) => {
        if (!existsSync(SHEET_SRC)) return next();
        res.setHeader("content-type", "text/plain; charset=utf-8");
        // it is edited constantly; a cached copy is worse than a fetch
        res.setHeader("cache-control", "no-store");
        res.end(readFileSync(SHEET_SRC));
      });
    },
    /**
     * Emitted rather than written, so it lands under the build output wherever
     * that is and shows up in the build log with everything else. `fileName` and
     * not `name`, because this one must NOT be content-hashed: the page asks for
     * it by the path above.
     */
    generateBundle() {
      if (!existsSync(SHEET_SRC)) return; // no sheet, no button — a valid build
      this.emitFile({
        type: "asset",
        fileName: "speedrun/run.sheet.txt",
        source: readFileSync(SHEET_SRC, "utf8"),
      });
    },
  };
}

function nightdiveMovie(): Plugin {
  return {
    name: "nightdive-movie",
    configResolved(config) {
      if (!existsSync(NIGHTDIVE_GIF)) return; // no source, no intro — a valid build
      const source = statSync(NIGHTDIVE_GIF).mtimeMs;
      const built = existsSync(NIGHTDIVE_OUT) ? statSync(NIGHTDIVE_OUT).mtimeMs : -1;
      if (built >= source) return;
      config.logger.info(`nightdive.mov is older than its GIF — compiling`);
      config.logger.info(writeNightdiveMov().summary);
    },
  };
}

export default defineConfig({
  root: HERE,
  publicDir: join(HERE, "public"),
  /**
   * Every URL the build emits is relative to the page that names it, so the
   * output runs from a subdirectory of some other host as readily as from a
   * domain root. Vite does that rewriting for what it can see — the module
   * scripts, the stylesheets and the `public/` images the HTML names, all still
   * written "/…" in source BECAUSE that is what it rewrites — and it works out
   * the number of `../` per page, which is why the four entries sit at two
   * depths.
   *
   * The two kinds it never sees are handled by hand: `<a href>` between pages is
   * written relative in the HTML, and URLs built in TypeScript go through
   * `siteUrl` (site/src/site.ts), which resolves them against this game's root
   * rather than the host's.
   */
  base: "./",
  /**
   * A multi-page site, not a single-page app. Without this, Vite answers every
   * unknown path with this package's `index.html` — so a link into another
   * package (`../editors/`, `../docs/`) came back 200 with the wrong page in it,
   * and a broken cross-site link looked like a working one.
   */
  appType: "mpa",
  // substituted into the source text, so the version travels in the bundle and
  // no page has to fetch anything to know it
  define: { __APP_VERSION__: JSON.stringify(VERSION) },
  plugins: [
    nightdiveMovie(),
    gamefilesManifest({ gamefiles: join(HERE, "gamefiles"), publicDir: join(HERE, "public") }),
    runSheet(),
    siblingSignposts([
      { path: "editors", command: "npm run dev", port: 5173, what: "The format editors" },
      { path: "docs", command: "npm run docs:dev", port: 5174, what: "The documentation" },
      { path: "dust", command: "npm run dev:dust", port: 5176, what: "Dust" },
      { path: "timelapse", command: "npm run dev:timelapse", port: 5177, what: "Timelapse" },
      { path: "skullcracker", command: "npm run dev:skullcracker", port: 5178, what: "Skull Cracker" },
    ]),
  ],
  server: {
    port: 5175,
    strictPort: true,
    watch: {
      // gamefiles/ is a CD rip — ~7,800 files that the middleware streams as raw
      // bytes. Vite never transforms them and a change to one could not
      // hot-reload anything, but chokidar still spends an inotify handle per
      // file: a quarter of a default `fs.inotify.max_user_watches` (28556 here)
      // on data that cannot move. Two dev servers at once therefore ENOSPC'd
      // outright, which is how this was found.
      ignored: ["**/gamefiles/**"],
    },
  },
  build: {
    outDir: resolve(HERE, "../dist/taoot"),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: join(HERE, "index.html"),
        play: join(HERE, "play/index.html"),
        // The speedrun workbench: the play page plus a sheet to drive it with.
        // Unlisted — nothing links to it and it carries `noindex` — but built,
        // because a tool that only exists on a dev server is a tool nobody uses.
        speedrun: join(HERE, "speedrun/index.html"),
        // The collection page: the physical release's box and CD artwork, and
        // the offline DBGL downloads that sit beside the rip on the host.
        collection: join(HERE, "collection/index.html"),
      },
    },
  },
});
