/**
 * RedJack's one page.
 *
 * *RedJack: Revenge of the Brethren* (1998) is the last game CyberFlix made on
 * its engine, and the only one on DreamFactory 5 — its installer registers the
 * `.boot` extension as "DreamFactory 5.0", and every file on its three discs says
 * 5 in container 0. The page is a prototype: the real {@link GameHost} is pointed
 * at the discs and the boot log says how far a v4 engine gets on v5 data.
 *
 * Port 5179, the next one in the order the engine shipped its games (README).
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
    // Nothing to `include`: unlike Timelapse's, this installer tree is not where
    // the game lives. `RJDisk1/RedJack/` holds the BOOTFILE and the shared shops,
    // and it is called `RedJack`, not `install` — the `Install/` beside it really
    // is only the installer.
    gamefilesManifest({
      gamefiles: join(HERE, "gamefiles"),
      publicDir: join(HERE, "public"),
    }),
    // the top bar links out of this package, and in dev those paths belong to
    // other Vite roots (tools/vite-siblings.ts)
    siblingSignposts([
      { path: "editors", command: "npm run dev", port: 5173, what: "The format editors" },
      { path: "docs", command: "npm run docs:dev", port: 5174, what: "The documentation" },
      { path: "taoot", command: "npm run dev -w taoot", port: 5175, what: "Titanic" },
      { path: "dust", command: "npm run dev -w dust", port: 5176, what: "Dust" },
      { path: "timelapse", command: "npm run dev -w timelapse", port: 5177, what: "Timelapse" },
      { path: "skullcracker", command: "npm run dev -w skullcracker", port: 5178, what: "Skull Cracker" },
    ]),
  ],
  server: {
    port: 5179,
    strictPort: true,
    // three CDs are not a source tree; see the note in taoot/vite.config.ts
    watch: { ignored: ["**/gamefiles/**"] },
  },
  build: {
    outDir: resolve(HERE, "../dist/redjack"),
    emptyOutDir: true,
  },
});
