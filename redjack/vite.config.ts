/**
 * RedJack's pages: the home page, the game (play/) and the speedrun workbench
 * (speedrun/, made from the play page by speedrun/vite.ts). Built to
 * `dist/redjack`; the rest is every game's (tools/vite-game.ts).
 */
import { fileURLToPath } from "node:url";
import { gameConfig } from "../tools/vite-game";
import { speedrunPage } from "../speedrun/vite";
import { WORKBENCH } from "./speedrun/workbench";

/** this file's own directory, not the working directory */
const HERE = fileURLToPath(new URL(".", import.meta.url));

export default gameConfig({
  root: HERE,
  dir: "redjack",
  plugins: [...speedrunPage({ root: HERE, ...WORKBENCH })],
});
