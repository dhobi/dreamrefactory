/**
 * The six variables the game's own debug readout names, in its order.
 *
 * Not a list this port chose. TI.EXE has such a readout — it is a SCRIPT, on the
 * HELP button of the save panel (house.shp, prop "help") — and shift-clicking it
 * in the original answers `Mission=1, Phase=4, Letter=0, Necklace=0`, with `Maze`
 * and `Level` added in the three smokestack sets. So these are the ones the
 * game's own author reached for when he wanted to know where a player was, which
 * is a better answer than picking six ourselves.
 *
 * ## Why its own module
 *
 * Because it is a fact about THIS game that a test has to be able to read. The
 * pane that shows it is the engine's (`engine/src/web/state-list.ts`) and takes
 * the spine as a parameter, since Dust's workbench passes its own two; the
 * obvious home for Titanic's answer is then `main.ts`, which is the page and
 * touches `document`, so `taoot/tests/auto/debug-panel.ts` — which checks each
 * of the six IS a global this game declares, against a recorded golden — could
 * not import it. That check is worth more than the file it costs.
 */
import type { SpineVar } from "@dreamfactory/engine/web/debug-panel";

/** what the game's own dialog calls them, so the two readouts can be compared */
export const SPINE: readonly SpineVar[] = [
  { name: "mission", label: "Mission" },
  { name: "phase", label: "Phase" },
  { name: "letterphase", label: "Letter" },
  { name: "neckphase", label: "Necklace" },
  { name: "mazenumber", label: "Maze" },
  { name: "stacklevel", label: "Level" },
];
