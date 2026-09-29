/**
 * Jump Raven's one page.
 *
 * *Jump Raven* (1994) is on the engine generation this port calls DreamFactory
 * 0, the same as Lunicus (docs/engine/formats/dreamfactory-0.md). Built to
 * `dist/jumpraven`.
 *
 * Port 5181, the next one after Lunicus's 5180.
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
  appType: "mpa",
  define: { __APP_VERSION__: JSON.stringify(VERSION) },
  plugins: [
    gamefilesManifest({ gamefiles: join(HERE, "gamefiles"), publicDir: join(HERE, "public") }),
    // the top bar links out of this package, and in dev those paths belong to
    // other Vite roots (tools/vite-siblings.ts)
    siblingSignposts([
      { path: "editors", command: "npm run dev", port: 5173, what: "The format editors" },
      { path: "docs", command: "npm run docs:dev", port: 5174, what: "The documentation" },
      { path: "taoot", command: "npm run dev -w taoot", port: 5175, what: "Titanic" },
      { path: "dust", command: "npm run dev -w dust", port: 5176, what: "Dust" },
      { path: "timelapse", command: "npm run dev -w timelapse", port: 5177, what: "Timelapse" },
      { path: "skullcracker", command: "npm run dev -w skullcracker", port: 5178, what: "Skull Cracker" },
      { path: "redjack", command: "npm run dev -w redjack", port: 5179, what: "RedJack" },
      { path: "lunicus", command: "npm run dev -w lunicus", port: 5180, what: "Lunicus" },
    ]),
  ],
  server: {
    port: 5181,
    strictPort: true,
    // a CD rip is not a source tree; see the note in taoot/vite.config.ts
    watch: { ignored: ["**/gamefiles/**"] },
  },
  build: {
    outDir: resolve(HERE, "../dist/jumpraven"),
    emptyOutDir: true,
  },
});
