import type { WorkbenchPage } from "../../speedrun/vite";

/**
 * Timelapse's speedrun workbench: what is this game's about the page
 * speedrun/vite.ts makes out of the play page. Read by vite.config.ts.
 *
 * Dust's (dust/speedrun/workbench.ts) with this page's ids, and the one real
 * difference is where the play page keeps its readouts.
 */
export const WORKBENCH: WorkbenchPage = {
  play: "play/index.html",
  // the title card's curtain, the boot gauge, the picture and the log all live
  // in #stage, as Dust's do
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
  /**
   * The play page has no Details column, so the workbench brings one: the
   * location, the boot log, and the state list (engine/src/web/state-list.ts,
   * wired in src/speedrun/page.ts) — the plot lives entirely in script globals,
   * so a snapshot of them IS the game state.
   */
  details: `<div id="details">
  <h2>Details</h2>
  <div id="dbgBar">
    <label title="Every script global, and the few that say where you are"><input type="checkbox" id="dbgStateOn" /> <span>state</span></label>
  </div>
  <div id="dbgState" hidden>
    <div id="dbgSpine"></div>
    <div id="dbgTools">
      <input aria-label="filter" id="dbgFilter" type="search" placeholder="filter" title="One or more terms, | or , apart: cur|gcamera — matched against a variable's name or a row's type (prop, actor)" />
      <label title="Every global, not just the ones that have just moved"><input type="checkbox" id="dbgAll" /> <span>all</span></label>
    </div>
    <div id="dbgRows"></div>
  </div>
</div>`,
  // where you stand first (the play page's own readout, with the stage's exit
  // table), then why a boot failed if it did, then the boot's account of itself
  intoDetails: ["loc", "err", "log"],
  css: "/src/speedrun.css",
  entry: "/src/speedrun/page.ts",
  sheet: "tests/speedrun/run.sheet.txt",
  // the sheets contributed by pull request (speedrun/sheets/README.md)
  sheetsDir: "speedrun/sheets",
};
