import type { WorkbenchPage } from "../../speedrun/vite";

/**
 * Dust's speedrun workbench: what is this game's about the page
 * speedrun/vite.ts makes out of the play page. Read by vite.config.ts.
 */
export const WORKBENCH: WorkbenchPage = {
  play: "play/index.html",
  game: ["stage"],
  // The title card (#brand) is the play page's welcome, and a workbench is
  // reloaded on every `reset()`; main.ts reads it as nullable, and `nobrand`
  // closes the band up after it. The strip under the picture and the footer are
  // questions for somebody playing, and every element of them is optional in
  // main.ts.
  drop: ["brand", "under", "foot"],
  bodyClass: "nobrand",
  // boot without waiting for a Start press (main.ts AUTOSTART): a press per
  // boot is a press per run
  meta: { autostart: "1" },
  // the Details column is the play page's (its log, its state list), opened here
  css: "/src/speedrun.css",
  entry: "/src/speedrun/page.ts",
  sheet: "tests/speedrun/run.sheet.txt",
  // the sheets contributed by pull request, each checked by tests/speedrun/sheets.ts
  sheetsDir: "speedrun/sheets",
};
