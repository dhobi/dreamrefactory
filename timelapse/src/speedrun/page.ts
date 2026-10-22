/**
 * Timelapse's speedrun workbench — this page's entry point.
 *
 * Dust's (dust/src/speedrun/page.ts) with this game's name, its spine and its
 * verbs (./actions.ts): the workbench is the speedrun workspace's, and the page
 * under it is the play page (`index.html`, rearranged
 * by speedrun/vite.ts from timelapse/speedrun/workbench.ts).
 *
 * No `warmup` and no Calculate, for the reasons Dust gives none: the boot's own
 * prefetch already takes the 70 MB a run starts with in front of the first
 * frame, and a headless worker is wanted once there is a route long enough to
 * want one.
 */
import { startWorkbench } from "@dreamfactory/speedrun/workbench";
import { siteUrl } from "@dreamfactory/chrome/site";
import type { SpineVar } from "@dreamfactory/engine/web/debug-panel";
import { ACTIONS } from "./actions";

/**
 * Where you are, as the BOOTFILE keeps it: the world letter, the stage and the
 * frame — the three globals the play page's location readout and the machine
 * harness's `where()` both read (timelapse/tests/machine/harness.ts). There is
 * no room to name, so a place here is these.
 */
const SPINE: readonly SpineVar[] = [
  { name: "curworldchar", label: "World" },
  { name: "curstagenum", label: "Stage" },
  { name: "curframenum", label: "Frame" },
];

startWorkbench({
  // its own key space: a Timelapse checkpoint must never be offered to another
  // game's workbench on the same origin (dust/src/speedrun/page.ts)
  game: "timelapse",
  actions: ACTIONS,
  details: { spine: SPINE },
  /** the route (tests/speedrun/run.sheet.txt), published beside this page by speedrun/vite.ts */
  fixtureSheet: siteUrl("speedrun/run.sheet.txt"),
  /** the contributed sheets (timelapse/speedrun/sheets/), resolved the same way */
  contributedSheets: siteUrl("speedrun/sheets.json"),
});
