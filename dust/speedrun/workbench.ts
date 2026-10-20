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
  /**
   * The play page has no Details column, so the workbench brings one: the boot
   * log, and the state list (engine/src/web/state-list.ts, wired in
   * src/speedrun/page.ts) — a DreamFactory game's plot lives entirely in script
   * globals, so a snapshot of them IS the game state.
   */
  details: `<div id="details">
  <h2>Details</h2>
  <div id="dbgBar">
    <label title="Every script global, and the two this game's own suites reach for"><input type="checkbox" id="dbgStateOn" /> <span>state</span></label>
  </div>
  <div id="dbgState" hidden>
    <div id="dbgSpine"></div>
    <div id="dbgTools">
      <input aria-label="filter" id="dbgFilter" type="search" placeholder="filter" title="One or more terms, | or , apart: day|clock — matched against a variable's name or a row's type (prop, actor)" />
      <label title="Every global, not just the ones that have just moved"><input type="checkbox" id="dbgAll" /> <span>all</span></label>
    </div>
    <div id="dbgRows"></div>
  </div>
</div>`,
  // the boot's own account of itself, above the variables: the log says what
  // just happened and the list says where that left the game
  intoDetails: ["log"],
  css: "/src/speedrun.css",
  entry: "/src/speedrun/page.ts",
  sheet: "tests/speedrun/run.sheet.txt",
  // the sheets contributed by pull request, each checked by tests/speedrun/sheets.ts
  sheetsDir: "speedrun/sheets",
};
