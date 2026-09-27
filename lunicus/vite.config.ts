/**
 * Lunicus's prototype page, laid out as RedJack's first one was.
 *
 * *Lunicus* (1994) is the oldest game in the repository, on the engine
 * generation this port calls DreamFactory 0 (docs/engine/formats/dreamfactory-0.md).
 * In the project's own palette (no Lunicus design yet), and unbuilt on purpose: there is no `build` script, so the root's
 * `build --workspaces --if-present` passes it by.
 *
 * Port 5180, the next one after RedJack's 5179.
 */
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { defineConfig, type Plugin } from "vite";
import { gamefilesManifest } from "../tools/vite-gamefiles";

/** this file's own directory, not the working directory */
const HERE = fileURLToPath(new URL(".", import.meta.url));

/**
 * `/replays/playthrough.json`: the recording the browser playthrough last made
 * (out/lunicus/playthrough/recording.json), for `?replay=` to play on the page
 * itself — the dev server only; nothing in out/ is ever published.
 */
function replays(): Plugin {
  const file = join(HERE, "../out/lunicus/playthrough/recording.json");
  return {
    name: "lunicus-replays",
    configureServer(server) {
      server.middlewares.use("/replays/playthrough.json", (_req, res) => {
        if (!existsSync(file)) return void ((res.statusCode = 404), res.end("no recording yet: run npm run test:browser -w lunicus"));
        res.setHeader("content-type", "application/json");
        res.end(readFileSync(file));
      });
    },
  };
}

const VERSION = JSON.parse(readFileSync(join(HERE, "package.json"), "utf8")).version as string;

export default defineConfig({
  root: HERE,
  publicDir: join(HERE, "public"),
  base: "./",
  appType: "mpa",
  define: { __APP_VERSION__: JSON.stringify(VERSION) },
  plugins: [replays(), gamefilesManifest({ gamefiles: join(HERE, "gamefiles"), publicDir: join(HERE, "public") })],
  server: {
    port: 5180,
    strictPort: true,
    // a CD rip is not a source tree; see the note in taoot/vite.config.ts
    watch: { ignored: ["**/gamefiles/**"] },
  },
});
