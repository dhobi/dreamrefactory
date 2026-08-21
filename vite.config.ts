import { defineConfig, Plugin } from "vite";
import { createReadStream, existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, normalize, resolve } from "node:path";
import {
  DUST_MANIFEST_FILE,
  DUST_MANIFEST_URL,
  MANIFEST_FILE,
  MANIFEST_URL,
  buildManifest,
  dustManifest,
} from "./tools/manifest";
import { NIGHTDIVE_GIF, NIGHTDIVE_OUT, writeNightdiveMov } from "./tools/mknightdive";

/** the port's versions — package.json is the one place they are written; the
    pages read them back through `__APP_VERSION__` / `__DUST_VERSION__`
    (src/version.ts). Two numbers because Dust RELEASES separately: a `v*` tag
    ships the TAOOT site and a `dust-v*` tag ships the Dust page, each checked
    against its own field (deploy.yml). */
const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const VERSION = pkg.version as string;
const DUST_VERSION = (pkg.dustVersion as string) ?? "0.0.0";

/**
 * The two things a page needs from `gamefiles/` — a listing of what is there, and
 * the bytes themselves — and how each is answered in dev and in a static build.
 *
 * The LISTING is the manifest (tools/manifest.ts): served live here so a dev
 * server picks up a tree that changed without a rebuild, and written into `dist/`
 * at build time so a deployment needs no server at all. It used to be
 * `/api/gamefiles`, which made the site look like it wanted a backend when the
 * only dynamic thing about it was a directory walk.
 *
 * The BYTES are Vite's job in dev, except that its transform middleware 500s on
 * extension-less paths like `/gamefiles/en/titanic1/data/bootfile` (it tries to
 * load them as modules), so they are streamed below instead. A static host has no
 * transform step and every consumer reads `arrayBuffer()`, so nothing there needs
 * replacing — the files are uploaded at the paths the manifest names.
 *
 * gamefiles/ itself is NEVER bundled: it is a CD rip, it is gitignored, and a
 * static deployment carries it beside `dist/` rather than inside it.
 */

function gamefilesManifest(): Plugin {
  // dev runs the hook below too (a closing server is a closed bundle as far as
  // rollup is concerned), and a dev server has no business writing into dist/
  let building = false;
  return {
    name: "gamefiles-manifest",
    configResolved(config) {
      building = config.command === "build";
    },
    configureServer(server) {
      server.middlewares.use(MANIFEST_URL, (_req, res) => {
        res.setHeader("content-type", "application/json");
        res.setHeader("cache-control", "no-store"); // a tree can change under it
        res.end(JSON.stringify(buildManifest()));
      });
      // the Dust page's slice of the same walk (see tools/manifest.ts)
      server.middlewares.use(DUST_MANIFEST_URL, (_req, res) => {
        res.setHeader("content-type", "application/json");
        res.setHeader("cache-control", "no-store");
        res.end(JSON.stringify(dustManifest(buildManifest())));
      });

      const rootDir = resolve("gamefiles");
      server.middlewares.use("/gamefiles", (req, res, next) => {
        const rel = decodeURIComponent((req.url ?? "").split("?")[0]);
        const path = normalize(join(rootDir, rel));
        if (!path.startsWith(rootDir) || !existsSync(path) || statSync(path).isDirectory()) {
          next();
          return;
        }
        res.setHeader("content-type", "application/octet-stream");
        res.setHeader("content-length", statSync(path).size);
        createReadStream(path).pipe(res);
      });
    },
    /**
     * ...and the same walk as a file, so `npm run build` produces a site that
     * needs nothing but a file server. Written in `closeBundle` rather than as an
     * emitted asset because it describes the tree on THIS machine — a deployment
     * whose game data is uploaded separately regenerates it there with
     * `tools/mkmanifest.ts`, and that has to be able to overwrite this.
     */
    closeBundle() {
      if (!building) return;
      const manifest = buildManifest();
      const out = join("dist", MANIFEST_FILE);
      const json = JSON.stringify(manifest);
      writeFileSync(out, json);
      this.info?.(
        `${out}: ${Object.keys(manifest).length} files, ${(json.length / 1024).toFixed(0)} KB`,
      );
      const dust = dustManifest(manifest);
      writeFileSync(join("dist", DUST_MANIFEST_FILE), JSON.stringify(dust));
      this.info?.(`dist/${DUST_MANIFEST_FILE}: ${Object.keys(dust).length} files`);
    },
  };
}

/**
 * Compile `assets/nightdive.gif` into `public/nightdive.mov` — the English
 * boot's intro film — whenever the source is newer than what was compiled last.
 *
 * The GIF is the tracked source and the MOV is generated, so the MOV is
 * gitignored and nobody has to remember `npm run mknightdive`: a fresh clone
 * builds it on the first `npm run dev` or `npm run build`, and the file that
 * ships is the file the committed GIF produces.
 *
 * Into `public/` rather than emitted straight into `dist/`, for two reasons that
 * both have to hold: Vite serves `public/` in dev (so the play page can fetch the
 * film without a middleware of its own), and `tools/manifest.ts` scans `public/`
 * for authored DF files. The page resolves every file through that manifest, so a
 * film in `dist/` and absent from `gamefiles.json` is a film the boot cannot find.
 *
 * ~13 s from a 4.5 MB GIF, so it is mtime-gated rather than unconditional — an
 * incremental build pays nothing. Delete the MOV to force it.
 *
 * **In `configResolved`, not `buildStart`, and that is load-bearing.** Vite
 * indexes `public/` when it builds the dev server's middleware stack, which
 * happens after config resolution but BEFORE `buildStart` — so a film written
 * from `buildStart` exists on disk and still 404s into the SPA fallback for the
 * life of that server. On a fresh clone that is silent: the page fetches
 * `nightdive.mov`, gets `index.html`, fails to parse it as a MOV, and boots with
 * no intro at all. Measured, after writing it the wrong way round first.
 */
/**
 * The repository's own run sheet, published beside the workbench page.
 *
 * `speedrun/index.html` offers a "Copy the full run" button that starts you from
 * the route in `tests/speedrun/run.sheet.txt` rather than from an empty
 * textarea — and it only draws that button if the fetch succeeds, so on a built
 * site it silently was not there. Two reasons, and both had to be fixed:
 * `tests/` is source and nothing copied the file into `dist/`, and the fetch
 * named it from the HOST's root, which is only the site's root in dev.
 *
 * So it is served here in dev and emitted at build, at ONE path either way —
 * `speedrun/run.sheet.txt`, next to the page that reads it — which the page then
 * resolves through `siteUrl` like everything else it fetches (src/site.ts).
 *
 * The file stays in `tests/` because that is where it is run from
 * (`npm run speedrun`) and where every reference to it points. It is one file
 * copied at build time rather than a module the page imports, which keeps the
 * page out of the test tree; the alternative — moving it under `src/` and
 * inlining it with `?raw` — buys a compile-time guarantee that it exists and
 * costs every path that names it today.
 */
const SHEET_SRC = "tests/speedrun/run.sheet.txt";
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
     * Emitted rather than written, so it lands under `dist/` wherever the build
     * puts things and shows up in the build log with everything else. `fileName`
     * and not `name`, because this one must NOT be content-hashed: the page asks
     * for it by the path above.
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

export default defineConfig(({ mode }) => ({
  /**
   * Every URL the build emits is relative to the page that names it, so `dist/`
   * runs from a subdirectory of some other host as readily as from a domain root.
   * Vite does that rewriting for what it can see — the module scripts, the
   * stylesheets and the `public/` images the HTML names, all still written "/…"
   * in source BECAUSE that is what it rewrites — and it works out the number of
   * `../` per page, which is why the eleven entries can sit at two depths.
   *
   * The two kinds it never sees are handled by hand: `<a href>` between pages is
   * written relative in the HTML, and URLs built in TypeScript go through
   * `siteUrl` (src/site.ts), which resolves them against the site root rather
   * than the host's.
   */
  base: "./",
  // substituted into the source text, so the version travels in the bundle and
  // no page has to fetch anything to know it
  define: {
    __APP_VERSION__: JSON.stringify(VERSION),
    __DUST_VERSION__: JSON.stringify(DUST_VERSION),
  },
  plugins: [nightdiveMovie(), gamefilesManifest(), runSheet()],
  server: {
    watch: {
      // gamefiles/ is a CD rip — ~7,800 files that the middleware above streams
      // as raw bytes. Vite never transforms them and a change to one could not
      // hot-reload anything, but chokidar still spends an inotify handle per
      // file: a quarter of a default `fs.inotify.max_user_watches` (28556 here)
      // on data that cannot move. Two dev servers at once therefore ENOSPC'd
      // outright, which is how this was found.
      ignored: ["**/gamefiles/**"],
    },
  },
  build: {
    rollupOptions: {
      // eleven pages: the front page (index.html), the game itself (play/), the
      // collection page (the physical release's box/CD artwork and the offline
      // DBGL downloads), the editors' landing page, and the seven editors. The
      // editors live in their own tree — they import the file-format layer
      // (src/df/) and src/screen.ts, never the engine, so they build as pages
      // that happen to share a data library.
      /**
       * `--mode dust` builds the ONE page a `dust-v*` release ships, so a Dust
       * deploy carries zero bytes of the TAOOT pages (deploy.yml). Everything
       * else is the full site.
       */
      input: mode === "dust" ? { dust: resolve("dust.html") } : {
        main: resolve("index.html"),
        play: resolve("play/index.html"),
        // The speedrun workbench: the play page plus a sheet to drive it with.
        // Unlisted — nothing links to it and it carries `noindex` — but built,
        // because a tool that only exists on a dev server is a tool nobody uses.
        speedrun: resolve("speedrun/index.html"),
        // The Dust shell — an experiment, and deliberately not part of the game.
        // *Dust: A Tale of the Wired West* (1995) is DreamFactory 1 where Titanic
        // is 4, and this page exists to find out how much of the port reads it.
        // Its own entry rather than a mode of play/: it shares src/df/ and nothing
        // else, has no menu, no editions, no saves, and should not inherit the
        // play page's chrome or its assumptions.
        dust: resolve("dust.html"),
        collection: resolve("collection/index.html"),
        editors: resolve("editors/index.html"),
        puppets: resolve("editors/puppets.html"),
        tracks: resolve("editors/tracks.html"),
        sets: resolve("editors/sets.html"),
        shops: resolve("editors/shops.html"),
        stages: resolve("editors/stages.html"),
        casts: resolve("editors/casts.html"),
        movies: resolve("editors/movies.html"),
      },
    },
  },
}));
