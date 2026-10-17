import type { WorkbenchPage } from "../../speedrun/vite";

/**
 * Titanic's speedrun workbench: what is this game's about the page
 * speedrun/vite.ts makes out of the play page. Read by vite.config.ts, and by
 * tests/auto/debug-panel.ts, which checks the page that comes out.
 */
export const WORKBENCH: WorkbenchPage = {
  play: "play/index.html",
  // the boot text with its preload bar, then the picture
  game: ["booting", "stage"],
  // The play page's row goes, and the settings strip inside it: fullscreen, a
  // bug button, the swipe options, the picture and brightness rows are questions
  // about how the game should feel to somebody playing it, and this page is
  // where a route is timed. main.ts finds none of them here and is written to
  // tolerate that. No edition picker either — see `edition` below.
  drop: ["playlayout", "editionPicker"],
  meta: {
    // No nightdive.mov: this page is reloaded to get a clean game far more often
    // than it is opened to play one (main.ts skipsIntro). The sheet's `intro()`
    // verb returns the moment there is no intro on screen.
    "skip-intro": "1",
    // English, always: a route is a sequence of clicks and bevels in ONE
    // edition's data (main.ts pinnedEdition)
    edition: "en",
  },
  css: "/src/speedrun.css",
  entry: "/src/speedrun/page.ts",
  sheet: "tests/speedrun/run.sheet.txt",
  // the sheets contributed by pull request, each checked by tests/speedrun/sheets.ts
  sheetsDir: "speedrun/sheets",
};
