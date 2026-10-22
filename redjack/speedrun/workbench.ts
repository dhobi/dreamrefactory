import type { WorkbenchPage } from "../../speedrun/vite";

/**
 * RedJack's speedrun workbench: what is this game's about the page
 * speedrun/vite.ts makes out of the play page. Read by vite.config.ts.
 *
 * Timelapse's (timelapse/speedrun/workbench.ts) with this page's ids, which are
 * the same ones: RedJack's play page was laid out as Timelapse's is.
 */
export const WORKBENCH: WorkbenchPage = {
  play: "play/index.html",
  // the title card's curtain, the boot gauge and the picture all live in
  // #stage, as Dust's do
  game: ["stage"],
  // The title card (#brand) is the play page's welcome, and a workbench is
  // reloaded on every `reset()`; main.ts reads it as nullable, and `nobrand`
  // closes the band up after it. The strip under the picture and the footer are
  // questions for somebody playing — but #under is NOT all optional here, as it
  // is on Dust's: main.ts writes the location readout (#loc) on every move and
  // a failed boot's reason into #err. Those two are moved into the Details
  // column first (`intoDetails`, which runs before the drop), and the rest of
  // the strip goes; every other element of it main.ts reads as nullable.
  drop: ["brand", "under", "foot"],
  bodyClass: "nobrand",
  // boot without waiting for the Enter press (main.ts AUTOSTART): a press per
  // boot is a press per run
  meta: { autostart: "1" },
  // The Details column is the play page's (its log, its state list), opened
  // here; into it, under the heading, where you stand (the play page's own
  // readout, with the stage's exit table), then why a boot failed if it did
  intoDetails: ["loc", "err"],
  css: "/src/speedrun.css",
  entry: "/src/speedrun/page.ts",
  sheet: "tests/speedrun/run.sheet.txt",
  // the sheets contributed by pull request (speedrun/sheets/README.md)
  sheetsDir: "speedrun/sheets",
};
