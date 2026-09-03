/**
 * Dust's speedrun workbench — this page's entry point.
 *
 * The workbench is the engine's (`engine/src/web/speedrun/workbench.ts`) and so
 * is every verb it can run today (`./speedrun/actions.ts` says why there are no
 * Dust ones yet), which is what makes this file four lines of substance.
 *
 * ## What this game does not tell it
 *
 * No `warmup` and no `fixtureSheet`, and both absences are the truth rather than
 * a stub:
 *
 *   - **No Warm button.** Titanic's warms one edition of six out of a 1.2 GB
 *     tree because a route re-run fifty times is otherwise timed against the
 *     download. Dust is one volume and a boot touches fourteen files of it, so
 *     there is nothing to choose and little to prefetch; when a route exists and
 *     the download is what it is fighting, the list goes here.
 *   - **No sheet to copy.** There is no Dust route yet. The panel notices and
 *     offers no "copy the full run" button, which is the correct thing for it to
 *     do — the alternative is a button that fetches a 404.
 */
import { startWorkbench } from "@dreamfactory/engine/web/speedrun/workbench";
import { installStateList } from "@dreamfactory/engine/web/state-list";
import { snapshotState } from "@dreamfactory/engine/runtime/trace";
import type { GameHost } from "@dreamfactory/engine/web/host";
import type { SpineVar } from "@dreamfactory/engine/web/debug-panel";
import { ACTIONS } from "./speedrun/actions";

/**
 * The two variables worth naming before the rest.
 *
 * Titanic's six come from a readout the original game itself carries; Dust has
 * no such dialog to read the answer off, so these are the two its own suites
 * reach for when they need to put the game in a known state — `day`, which
 * decides which targets the shooting range sets out (dust/tests/targets.ts: day
 * 2 and 3 add the pig and the chicken), and `clock`, which the house's props
 * read (dust/tests/props.ts).
 *
 * A short list on purpose. A spine is what a reader wants before anything else,
 * and a guess at that is worse than the full table underneath it — which is
 * always there. When a Dust route exists, what it waits on is what belongs here.
 */
const SPINE: readonly SpineVar[] = [
  { name: "day", label: "Day" },
  { name: "clock", label: "Clock" },
];

/**
 * The Details column, wired to the running game.
 *
 * `window.dbg` and not an import, because the game is `main.ts`'s and this is a
 * second module on the same page: that handle is what the page publishes for
 * exactly this (its own header says so), and it is what every probe and console
 * session already reaches for. Polled rather than awaited — the boot takes
 * minutes and the column should be up and empty in the meantime, not absent.
 */
const dbg = (): { host?: GameHost } => (window as unknown as { dbg?: { host?: GameHost } }).dbg ?? {};

installStateList({
  state: () => {
    const host = dbg().host!;
    return snapshotState(host.session, host.viewer ?? null, "live");
  },
  spine: SPINE,
  // this game's own namespace: every game on the deployed site shares an origin
  storageKey: "dust.details.state",
  // the pane IS this page's third column, so it opens on the list rather than
  // on nothing at all
  defaultOn: true,
  // there is no X here and nothing hides the column, but the poll still costs a
  // snapshot per tick — so it waits for a game to snapshot
  visible: () => !!dbg().host?.session,
});

startWorkbench({
  // Its own key space, and this is the whole reason the namespace exists: the
  // deployed site serves every game from one origin, so `dust:speedrun:save:…`
  // is what keeps a Dust checkpoint out of Titanic's workbench — where the
  // engine would happily load it and then find itself in a room this disc
  // does not have.
  game: "dust",
  actions: ACTIONS,
});
