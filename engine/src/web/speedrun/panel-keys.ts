/**
 * Where the workbench's remembered preferences live — one key space per game.
 *
 * `localStorage` is per ORIGIN and the deployed site serves every game off one,
 * so a bare `speedrun:columns` would be one setting shared by every workbench
 * on the host. Column order and column widths are answers about a PARTICULAR
 * page's panels: two games' workbenches can carry different panes (Dust's has no
 * X pane, because the engine's state pane is Titanic's markup), so one game's
 * stored order is not a sentence the other can read.
 *
 * The same shape as the checkpoint keys next door (page-driver.ts,
 * {@link SaveKeys}) and for the same reason, kept as a separate object because
 * the two have different lifetimes: a checkpoint is a saved game and a column
 * order is a preference, and a page that cleared one has no business clearing
 * the other.
 *
 * The game's own word for itself is the namespace, and Titanic's is `taoot`, so
 * its keys are the ones already in a reader's browser, byte for byte.
 */
export interface PanelKeys {
  /** the key this game's `what` is remembered at */
  key(what: string): string;
}

/** {@link PanelKeys} for the game that calls itself `game` — `panelKeys("taoot")` */
export function panelKeys(game: string): PanelKeys {
  return { key: (what) => `${game}:speedrun:${what}` };
}
