/**
 * Skull Cracker's pages: the home page, the game (play/), and the walkable-level
 * experiment (walk.html — see its own header for what it is and is not). Built
 * to `dist/skullcracker`; the rest is every game's (tools/vite-game.ts).
 */
import { fileURLToPath } from "node:url";
import { gameConfig } from "../tools/vite-game";

/** this file's own directory, not the working directory */
const HERE = fileURLToPath(new URL(".", import.meta.url));

export default gameConfig({
  root: HERE,
  dir: "skullcracker",
  pages: { walk: "walk.html" },
});
