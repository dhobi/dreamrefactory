/**
 * Lunicus's pages: the home page and the game (play/). *Lunicus* (1994) is the
 * oldest game in the repository, on the engine generation this port calls
 * DreamFactory 0 (docs/engine/formats/dreamfactory-0.md). Built to
 * `dist/lunicus`; the rest is every game's (tools/vite-game.ts).
 */
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import type { Plugin } from "vite";
import { gameConfig } from "../tools/vite-game";

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

export default gameConfig({
  root: HERE,
  dir: "lunicus",
  plugins: [replays()],
});
