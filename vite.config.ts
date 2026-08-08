import { defineConfig, Plugin } from "vite";
import { createReadStream, existsSync, statSync, writeFileSync } from "node:fs";
import { join, normalize, resolve } from "node:path";
import { MANIFEST_FILE, MANIFEST_URL, buildManifest } from "./tools/manifest";

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
    },
  };
}

export default defineConfig({
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
  plugins: [gamefilesManifest()],
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
      input: {
        main: resolve("index.html"),
        play: resolve("play/index.html"),
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
});
