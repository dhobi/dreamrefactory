/**
 * Timelapse's one page.
 *
 * *Timelapse: Ancient Civilizations* (1996) is the third title to ship on this
 * engine and the only one of the three not made by CyberFlix — GTE Interactive
 * Media's game on CyberFlix's engine. This package existed to check the web's
 * claim that it is DreamFactory 4 like Titanic rather than 1 like Dust. It is: the tags in
 * container 0 say so and the port boots the discs. So the page is no longer a
 * file report with a canvas on it — it is the game, with its own build, its own
 * dev server, its own palette (`src/theme.css`) and its own title card.
 *
 * Its own build is also what a `timelapse-v*` release would mean: the output is
 * `dist/timelapse/`, uploaded into `…/dreamrefactory/timelapse/`, and a release of
 * either other game cannot carry a byte of it.
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
    gamefilesManifest({
      gamefiles: join(HERE, "gamefiles"),
      publicDir: join(HERE, "public"),
      /**
       * Half this game is in the installer's tree, which the walker skips by
       * name for a good reason (Titanic's `install/` ships a rival `bootfile`).
       * `TLAPSE1/install/data/` is the exception and it is named rather than the
       * rule being relaxed: the BOOTFILE, six shops, five track banks, the panel
       * stage and the camera — without which the listing is films and stages
       * with nothing to boot from, and the loading bar cannot weigh four of the
       * thirteen files it fetches.
       */
      include: ["TLAPSE1/install/data"],
    }),
    // the top bar links out of this package, and in dev those paths belong to
    // other Vite roots: an honest 404 with the command to run beats a 200 with
    // the wrong page in it (tools/vite-siblings.ts)
    siblingSignposts([
      { path: "editors", command: "npm run dev", port: 5173, what: "The format editors" },
      { path: "docs", command: "npm run docs:dev", port: 5174, what: "The documentation" },
      { path: "taoot", command: "npm run dev -w taoot", port: 5175, what: "Titanic" },
      { path: "dust", command: "npm run dev -w dust", port: 5176, what: "Dust" },
      { path: "skullcracker", command: "npm run dev -w skullcracker", port: 5178, what: "Skull Cracker" },
    ]),
  ],
  server: {
    port: 5177,
    strictPort: true,
    // a four-CD rip is not a source tree; see the note in taoot/vite.config.ts
    watch: { ignored: ["**/gamefiles/**"] },
  },
  build: {
    outDir: resolve(HERE, "../dist/timelapse"),
    emptyOutDir: true,
  },
});
