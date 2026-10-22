/**
 * Timelapse's pages: the home page, the game (play/) and the speedrun workbench
 * (speedrun/, made from the play page by speedrun/vite.ts). Built to
 * `dist/timelapse`; the rest is every game's (tools/vite-game.ts).
 */
import { fileURLToPath } from "node:url";
import { gameConfig } from "../tools/vite-game";
import { speedrunPage } from "../speedrun/vite";
import { WORKBENCH } from "./speedrun/workbench";

/** this file's own directory, not the working directory */
const HERE = fileURLToPath(new URL(".", import.meta.url));

export default gameConfig({
  root: HERE,
  dir: "timelapse",
  plugins: [...speedrunPage({ root: HERE, ...WORKBENCH })],
  gamefiles: {
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
  },
});
