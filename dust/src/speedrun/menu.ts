/**
 * The game's own save/load menu, for the verbs that save and load on the
 * clock as a player does: `menuSave`/`menuLoad` and `blackjack` (#523).
 */
import type { GameMenu } from "@dreamfactory/engine/web/speedrun/action";

/** the panel behind the horn: NEW.FLT's "score" flat, with Save, Open and OK */
export const PANEL: GameMenu = {
  open: "horn",
  save: "save",
  load: "open",
  close: "OK",
  shown: `String(window.dbg.session.currentFlat ?? "") === "score"`,
};
