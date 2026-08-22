/**
 * Dust's one page.
 *
 * *Dust: A Tale of the Wired West* (1995) is DreamFactory 1 where Titanic is 4,
 * and this page exists to find out how much of the port reads it. Its own build
 * rather than a mode of Titanic's: it shares the engine and nothing else — no
 * menu, no editions, no language chooser — and should not inherit the play
 * page's chrome or its assumptions.
 *
 * Its own build is also what a `dust-v*` release means: the output is
 * `dist/dust/`, uploaded into `…/dreamrefactory/dust/`, and a Titanic release
 * cannot carry a byte of it.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";
import { defineConfig } from "vite";
import { gamefilesManifest } from "../tools/vite-gamefiles";
import { siblingSignposts } from "../tools/vite-siblings";

/** this file's own directory, not the working directory */
const HERE = fileURLToPath(new URL(".", import.meta.url));

/** Dust's version — its own number, because it releases on its own tag */
const VERSION = JSON.parse(readFileSync(join(HERE, "package.json"), "utf8"))
  .version as string;

export default defineConfig({
  root: HERE,
  publicDir: join(HERE, "public"),
  // relative, so the output runs from any directory a host puts it in
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
    gamefilesManifest({
      gamefiles: join(HERE, "gamefiles"),
      publicDir: join(HERE, "public"),
    }),
    siblingSignposts([
      {
        path: "editors",
        command: "npm run dev",
        port: 5173,
        what: "The format editors",
      },
      {
        path: "docs",
        command: "npm run docs:dev",
        port: 5176,
        what: "The documentation",
      },
      {
        path: "taoot",
        command: "npm run dev:taoot",
        port: 5174,
        what: "Titanic",
      },
    ]),
  ],
  server: {
    port: 5175,
    strictPort: true,
    // a CD rip is not a source tree; see the note in taoot/vite.config.ts
    watch: { ignored: ["**/gamefiles/**"] },
  },
  build: {
    outDir: resolve(HERE, "../dist/dust"),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        dust: join(HERE, "index.html"),
        // The collection page: how to run the 1995 DOS game instead of this
        // port of it. Its download sits beside the rip on the host and is
        // not in this repository.
        collection: join(HERE, "collection/index.html"),
      },
    },
  },
});
