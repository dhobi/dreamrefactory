/**
 * Verbs day 6's route needs beyond the shared ones (./actions.ts) — each a
 * move of tests/machine/days/day6.ts that no other day makes.
 */
import type { ActionTable } from "@dreamfactory/speedrun/action";
import { goTo, pathTo } from "../play/route";
import { move } from "./move";

export const DAY6_ACTIONS: ActionTable = {
  /**
   * Cartagena's dock: Anne mourns Rockfish as Nick walks on (dock.sett
   * openscene, anne2.pupp rockdead), a talk that asks nothing — so the walk
   * goes a node at a time and lets it play out wherever it opens.
   */
  gotopast: move(
    { args: [1, 1], sig: "gotoPast(Node13)", help: "walk to a node a node at a time, letting a talk that asks nothing play out on the way" },
    async (h, c) => {
      for (const n of pathTo(h, c.step.args[0])) {
        await goTo(h, n);
        if (h.owner() === "puppet") await h.settle(`the talk at ${n}`);
      }
    },
  ),
};
