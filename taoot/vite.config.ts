/**
 * Titanic's pages: the front page, the game, free roam (the same game with the
 * story turned off), the collection page, the minigames, and the two developer
 * pages the top bar carries as marks — the speedrun workbench and developer
 * mode.
 *
 * The Vite ROOT is this directory, which is what makes `/src/main.ts` in a page
 * mean `taoot/src/main.ts` and `gamefiles/` mean Titanic's rip and no other.
 * The output goes to `dist/taoot/`, which is the shape of the URL it is served
 * at (`…/dreamrefactory/taoot/`), and the deploy uploads that directory into it.
 */
import { existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";
import { gameConfig } from "../tools/vite-game";
import { WORKBENCH } from "./speedrun/workbench";
// RELATIVE, like everything a Vite config reaches: the config is bundled and run
// under Node, where a bare specifier is left external for a loader that can
// follow neither the engine's extensionless imports nor a .ts file at all.
import { NIGHTDIVE_GIF, NIGHTDIVE_OUT, writeNightdiveMov } from "./tools/mknightdive";

/** this file's own directory — not the working directory, which differs between
    `npm run build -w @dreamfactory/taoot` and `vite build --config` */
const HERE = fileURLToPath(new URL(".", import.meta.url));

/**
 * `nightdive.mov` from its GIF, when the GIF is the newer of the two.
 *
 * Restored verbatim — extracting the run-sheet plugin to `tools/` took this one
 * with it for a revision, which `tsc` caught as `Cannot find name
 * 'nightdiveMovie'` because the plugin list still asked for it.
 */
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

export default gameConfig({
  root: HERE,
  dir: "taoot",
  pages: {
    freeroam: "freeroam/index.html",
    devmode: "devmode/index.html",
    collection: "collection/index.html",
    captions: "captions/index.html",
    bedsit: "bedsit/index.html",
    chimneys: "bedsit/chimneys/index.html",
    minigames: "minigames/index.html",
    blackjack: "minigames/blackjack/index.html",
    fencing: "minigames/fence/index.html",
    fistfight: "minigames/fight/index.html",
  },
  plugins: [nightdiveMovie()],
  // the speedrun workbench, made from play/index.html by speedrun/vite.ts
  workbench: WORKBENCH,
  server: {
    /**
     * The hostnames this dev server will answer to, beyond the usual ones.
     *
     * Vite checks the `Host` header and answers anything it does not know with
     * "Blocked request" rather than the page — which is right, since a dev
     * server on 0.0.0.0 is otherwise reachable by any name that resolves here.
     * A tunnel arrives under a name it cannot know, so the name has to be said.
     *
     * `.trycloudflare.com` is the free quick tunnel — `cloudflared tunnel --url
     * http://localhost:5175` — and it is here for ONE reason: WebXR needs a
     * secure context, so `/bedsit/` in a headset cannot be served over plain
     * http from the LAN. The subdomain is random and different every run, which
     * is why this is the whole domain and not one host.
     */
    allowedHosts: [".trycloudflare.com"],
  },
});
