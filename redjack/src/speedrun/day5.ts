/**
 * Verbs day 5's route needs beyond the shared ones (./actions.ts) — each a
 * move of tests/machine/days/day5.ts that no other day makes.
 */
import type { ActionTable } from "@dreamfactory/speedrun/action";
import { mixTheDrink, takeTheLift } from "../play/bbisland";
import { move } from "./move";

export const DAY5_ACTIONS: ActionTable = {
  lift: move(
    { args: [1, 1], sig: "lift(bb2)", help: "Blackbeard's lift, its stage open: the handle pulled through its slot to that floor (bb1 the dock, bb2 the lounge), and off there" },
    (h, c) => takeTheLift(h, c.step.args[0].toLowerCase()),
  ),
  mixdrink: move(
    { args: [0, 0], sig: "mixDrink()", help: "behind Blackbeard's bar: the bottles, the sulphur and the coal into the mug, two pulls of ale, and the mug into the chest" },
    (h) => mixTheDrink(h),
  ),
};
