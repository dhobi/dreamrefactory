/**
 * The game's own save/load menu, for the verbs that save and load on the
 * clock as a player does: `menuSave`/`menuLoad` and `blackjack` (#523).
 */
import type { GameMenu } from "@dreamfactory/engine/web/speedrun/action";

/** the control panel: the life preserver opens it, CTL.STG's levers save and load */
export const PANEL: GameMenu = {
  open: "life",
  save: "save",
  load: "open",
  close: "ok",
  shown: `/^ctl/i.test(String(window.dbg.session.stageName || ""))`,
};
