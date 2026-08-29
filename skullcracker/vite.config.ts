/**
 * Skull Cracker's one page, and it is an experiment rather than a game.
 *
 * *Skull Cracker* (1996) is CyberFlix's own, and until this branch it was one of
 * the two titles the docs deliberately did NOT claim for the engine — no source
 * consulted attributes it to DreamFactory. Its files answer for themselves: the
 * containers are DreamFactory containers, container 0 of every film says version
 * 4, and this port reads them with the same code that reads Titanic's. What is
 * new is which way round they are. The rip is a **Macintosh** one — the first
 * this project has seen — so every integer in it is big-endian, which is what
 * `engine/src/df/byte-order.ts` exists for.
 *
 * ## What this page can and cannot be
 *
 * The other three games are DreamFactory ADVENTURES: a BOOTFILE, a script, sets
 * or stages, and an interpreter that runs the lot. Skull Cracker is a side-
 * scrolling beat-'em-up whose logic lives in a PowerPC executable, and its rip
 * carries no BOOTFILE, no `.SET`, no `.STG` and no script container of any kind.
 * Its levels are `.sbk` sprite books — DreamFactory containers of SHP-codec cels
 * that `tools/dumpsbk.ts` reads completely, whose behaviour is native code — so
 * nothing in this repository can PLAY them, readable as they are.
 *
 * What IS DreamFactory in it, and completely so, is its FILM layer: 66 movies in
 * the format `engine/src/df/mov.ts` already reads, `menu.mov` among them — an
 * interactive one, with click regions, targets and a looping bed. So this page
 * boots the game's menu and runs the films it leads to, which is as far as the
 * engine can honestly take this title and is the whole of what it claims.
 *
 * Port 5178, which the front door's README reserved for "the next game to be
 * ported" so that nothing has to move.
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
  // relative, so the output runs from any directory a host puts it in
  base: "./",
  /** a multi-page site, not an app: see the note in dust/vite.config.ts */
  appType: "mpa",
  define: { __APP_VERSION__: JSON.stringify(VERSION) },
  plugins: [
    // No `include` list, and it is worth saying why not: this rip keeps its
    // installed half in `SKULL/Install Folder/`, which the walker's
    // NOT_GAME_DATA rule does NOT skip — that set holds the exact name
    // "install", and "install folder" is not it. All 117 files are listed by
    // the plain walk. (Timelapse needs a list because its tree really does say
    // `install/`.)
    gamefilesManifest({
      gamefiles: join(HERE, "gamefiles"),
      publicDir: join(HERE, "public"),
    }),
    // the top bar links out of this package, and in dev those paths belong to
    // other Vite roots: an honest 404 with the command to run beats a 200 with
    // the wrong page in it (tools/vite-siblings.ts)
    siblingSignposts([
      { path: "editors", command: "npm run dev", port: 5173, what: "The format editors" },
      { path: "docs", command: "npm run docs:dev", port: 5174, what: "The documentation" },
      { path: "taoot", command: "npm run dev -w taoot", port: 5175, what: "Titanic" },
      { path: "dust", command: "npm run dev -w dust", port: 5176, what: "Dust" },
      { path: "timelapse", command: "npm run dev -w timelapse", port: 5177, what: "Timelapse" },
    ]),
  ],
  server: {
    port: 5178,
    strictPort: true,
    // a CD rip is not a source tree; see the note in taoot/vite.config.ts
    watch: { ignored: ["**/gamefiles/**"] },
  },
  build: {
    outDir: resolve(HERE, "../dist/skullcracker"),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(HERE, "index.html"),
        // the walkable-level experiment — see walk.html's own header for what
        // it is and is not
        walk: resolve(HERE, "walk.html"),
      },
    },
  },
});
