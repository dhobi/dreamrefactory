/**
 * The project's own web presence: the front door at `/dreamrefactory/` and the
 * eight editor pages under it.
 *
 * Output is `dist/site/`, uploaded to the root of `…/dreamrefactory/` — so the two
 * games' directories sit inside what this build produces without being part of
 * it. That works because the deploy only ever adds and overwrites: three builds
 * write into one tree and none of them can delete another's.
 *
 * ## The editors browse every rip there is
 *
 * They belong to no game: `site/` imports none, and `site/editors/sources.ts`
 * asks the registry which games exist and fetches each one's manifest. A SOURCE
 * is one game in one edition — "Dust", "Titanic · English", "Timelapse" — and the
 * row at the top of each editor picks between them.
 *
 * What that costs this config is mounting ALL THREE rips for the dev server,
 * below, because in dev each package is a separate origin and a page cannot reach
 * another's files. None of the mounts emits a manifest: those belong to the
 * games' own builds.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";
import { defineConfig } from "vite";
import { gamefilesManifest } from "../tools/vite-gamefiles";
import { siblingSignposts } from "../tools/vite-siblings";

/** this file's own directory, not the working directory */
const HERE = fileURLToPath(new URL(".", import.meta.url));

const VERSION = JSON.parse(readFileSync(join(HERE, "package.json"), "utf8")).version as string;

export default defineConfig({
  root: HERE,
  publicDir: join(HERE, "public"),
  base: "./",
  /**
   * A multi-page site, not a single-page app. Without this, Vite answers every
   * unknown path with this package's `index.html` — so a link into another
   * package (`../editors/`, `../docs/`) came back 200 with the wrong page in it,
   * and a broken cross-site link looked like a working one.
   */
  appType: "mpa",
  define: { __APP_VERSION__: JSON.stringify(VERSION) },
  plugins: [
    // ALL THREE games' trees, each mounted where the editors resolve it to, and
    // none of them emitted: a manifest belongs to whoever owns the tree, and each
    // game's own build writes its own. The editors list every source there is
    // (site/editors/sources.ts), so a dev server for the front door has to serve
    // every rip the editors can offer.
    gamefilesManifest({
      gamefiles: resolve(HERE, "../taoot/gamefiles"),
      publicDir: resolve(HERE, "../taoot/public"),
      mount: "/taoot",
      emit: false,
    }),
    gamefilesManifest({
      gamefiles: resolve(HERE, "../dust/gamefiles"),
      publicDir: resolve(HERE, "../dust/public"),
      mount: "/dust",
      emit: false,
    }),
    gamefilesManifest({
      gamefiles: resolve(HERE, "../skullcracker/gamefiles"),
      publicDir: resolve(HERE, "../skullcracker/public"),
      mount: "/skullcracker",
      emit: false,
    }),
    gamefilesManifest({
      gamefiles: resolve(HERE, "../timelapse/gamefiles"),
      publicDir: resolve(HERE, "../timelapse/public"),
      mount: "/timelapse",
      emit: false,
      // the same one exception that game's own build makes: half of it lives in
      // the installer's tree, and without this the editors would be offered its
      // films and stages with one shop file and no track banks
      include: ["TLAPSE1/install/data"],
    }),
    siblingSignposts([
      { path: "docs", command: "npm run docs:dev", port: 5174, what: "The documentation" },
      { path: "taoot", command: "npm run dev -w taoot", port: 5175, what: "Titanic" },
      { path: "dust", command: "npm run dev -w dust", port: 5176, what: "Dust" },
      { path: "timelapse", command: "npm run dev -w timelapse", port: 5177, what: "Timelapse" },
      { path: "skullcracker", command: "npm run dev -w skullcracker", port: 5178, what: "Skull Cracker" },
    ]),
  ],
  server: {
    // The default `npm run dev`, on the port a browser is already pointed at:
    // this is the project's front door, and the two games are rooms behind it.
    port: 5173,
    strictPort: true,
    // a CD rip is not a source tree; see the note in taoot/vite.config.ts
    watch: { ignored: ["**/gamefiles/**"] },
  },
  build: {
    outDir: resolve(HERE, "../dist/site"),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        // the front door
        main: join(HERE, "index.html"),
        // the editors: a landing page and the eight format pages. They import
        // the file-format layer (engine/src/df/) and engine/src/web/screen.ts,
        // never the runtime, so they build as pages that happen to share a data
        // library with a game.
        editors: join(HERE, "editors/index.html"),
        puppets: join(HERE, "editors/puppets.html"),
        tracks: join(HERE, "editors/tracks.html"),
        sets: join(HERE, "editors/sets.html"),
        shops: join(HERE, "editors/shops.html"),
        stages: join(HERE, "editors/stages.html"),
        casts: join(HERE, "editors/casts.html"),
        movies: join(HERE, "editors/movies.html"),
        books: join(HERE, "editors/books.html"),
      },
    },
  },
});
