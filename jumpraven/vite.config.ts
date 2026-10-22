/**
 * Jump Raven's pages: the home page and the game (play/). *Jump Raven* (1994) is
 * on the engine generation this port calls DreamFactory 0, the same as Lunicus
 * (docs/engine/formats/dreamfactory-0.md). Built to `dist/jumpraven`; the rest
 * is every game's (tools/vite-game.ts).
 */
import { fileURLToPath } from "node:url";
import { gameConfig } from "../tools/vite-game";

/** this file's own directory, not the working directory */
const HERE = fileURLToPath(new URL(".", import.meta.url));

export default gameConfig({
  root: HERE,
  dir: "jumpraven",
});
