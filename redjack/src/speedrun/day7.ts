/**
 * Verbs day 7's route needs beyond the shared ones (./actions.ts) — each a
 * move of tests/machine/days/day7.ts that no other day makes.
 */
import type { ActionTable } from "@dreamfactory/speedrun/action";
import { clickFilm, filmWaits } from "../play/route";
import { move } from "./move";

export const DAY7_ACTIONS: ActionTable = {
  /**
   * The end of the game (rjbeach.sett `theend ()`): Patch, RedJack (morph.move,
   * rjfade.move), each of the crew's last word (`finishtheend`) and
   * swimin.move, a film frame now and then waiting for a click — until the
   * next of the crew asks something, or the game is back at its menu
   * (control.stag).
   */
  ending: move(
    { args: [0, 0], sig: "ending()", help: "the end of the game: its films clicked on, until someone asks or the game is back at its menu" },
    async (h) => {
      const dir = h.host.director;
      const menu = (): boolean => h.session.stageName === "control.stag";
      for (;;) {
        await h.until(() => dir.awaitingChoice || filmWaits(h) || menu(), "the ending", 30_000);
        if (!filmWaits(h)) return;
        await clickFilm(h);
      }
    },
  ),
};
