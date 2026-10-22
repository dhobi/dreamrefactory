/**
 * The Details column's variables list, wired to the game under the workbench.
 *
 * Dust's, Timelapse's and RedJack's workbench pages each carried this block
 * whole, differing only in the game's name and its spine; it is the
 * workbench's now ({@link Workbench.details}). Titanic's is installed by its
 * play page (taoot/src/main.ts), which shows the same column outside the
 * workbench too.
 *
 * `window.dbg` and not an import, because the game is the play page's module
 * and this is a second one on the same page: that handle is what every play
 * page publishes for exactly this, and what every probe and console session
 * already reaches for. Polled rather than awaited — a boot takes minutes and
 * the column should be up and empty in the meantime, not absent.
 */
import { installStateList } from "@dreamfactory/engine/web/state-list";
import { snapshotState } from "@dreamfactory/engine/runtime/trace";
import type { GameHost } from "@dreamfactory/engine/web/host";
import type { SpineVar } from "@dreamfactory/engine/web/debug-panel";

const dbg = (): { host?: GameHost } => (window as unknown as { dbg?: { host?: GameHost } }).dbg ?? {};

export function installDetails(game: string, spine: readonly SpineVar[]): void {
  installStateList({
    state: () => {
      const host = dbg().host!;
      return snapshotState(host.session, host.viewer ?? null, "live");
    },
    spine,
    // this game's own namespace: every game on the deployed site shares an origin
    storageKey: `${game}.details.state`,
    // the pane IS the workbench's third column, so it opens on the list rather
    // than on nothing at all
    defaultOn: true,
    // there is no X here and nothing hides the column, but the poll still costs
    // a snapshot per tick — so it waits for a game to snapshot
    visible: () => !!dbg().host?.session,
  });
}
