/**
 * Dust's pages: the home page, the game (play/), the collection and the speedrun
 * workbench (speedrun/, made from the play page by speedrun/vite.ts). Built to
 * `dist/dust`; the rest is every game's (tools/vite-game.ts).
 */
import { fileURLToPath } from "node:url";
import { gameConfig } from "../tools/vite-game";
import { WORKBENCH } from "./speedrun/workbench";

/** this file's own directory, not the working directory */
const HERE = fileURLToPath(new URL(".", import.meta.url));

export default gameConfig({
  root: HERE,
  dir: "dust",
  // The collection page: how to run the 1995 DOS game instead of this port of
  // it. Its download sits beside the rip on the host and is not in this repository.
  pages: { collection: "collection/index.html" },
  workbench: WORKBENCH,
});
