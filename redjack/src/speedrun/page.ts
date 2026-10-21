/**
 * RedJack's speedrun workbench — this page's entry point.
 *
 * Timelapse's (timelapse/src/speedrun/page.ts) with this game's name, its spine
 * and its verbs (./actions.ts): the workbench is the speedrun workspace's, and
 * the page under it is the play page (`play/index.html`, rearranged by
 * speedrun/vite.ts from redjack/speedrun/workbench.ts).
 */
import { startWorkbench } from "@dreamfactory/speedrun/workbench";
import { installStateList } from "@dreamfactory/engine/web/state-list";
import { siteUrl } from "@dreamfactory/chrome/site";
import { snapshotState } from "@dreamfactory/engine/runtime/trace";
import type { GameHost } from "@dreamfactory/engine/web/host";
import type { SpineVar } from "@dreamfactory/engine/web/debug-panel";
import { ACTIONS } from "./actions";

/**
 * Which day it is — the BOOTFILE's `day`, which `advanceday ()` moves on and
 * every day's scripts branch on. Where you stand (the room, the node) is the
 * play page's own readout above it.
 */
const SPINE: readonly SpineVar[] = [{ name: "day", label: "Day" }];

/** `window.dbg`, which main.ts publishes for exactly this — see Dust's page */
const dbg = (): { host?: GameHost } => (window as unknown as { dbg?: { host?: GameHost } }).dbg ?? {};

installStateList({
  state: () => {
    const host = dbg().host!;
    return snapshotState(host.session, host.viewer ?? null, "live");
  },
  spine: SPINE,
  // this game's own namespace: every game on the deployed site shares an origin
  storageKey: "redjack.details.state",
  defaultOn: true,
  visible: () => !!dbg().host?.session,
});

startWorkbench({
  // its own key space: a RedJack checkpoint must never be offered to another
  // game's workbench on the same origin (dust/src/speedrun/page.ts)
  game: "redjack",
  actions: ACTIONS,
  /** the route (tests/speedrun/run.sheet.txt), published beside this page by speedrun/vite.ts */
  fixtureSheet: siteUrl("speedrun/run.sheet.txt"),
  /** the contributed sheets (redjack/speedrun/sheets/), resolved the same way */
  contributedSheets: siteUrl("speedrun/sheets.json"),
});
