/**
 * Verbs day 3's route needs beyond the shared ones (./actions.ts) — each a
 * move of tests/machine/days/day3.ts that no other day makes: the jail's
 * tray, where things are carried onto other things found on screen.
 */
import type { ActionTable } from "@dreamfactory/speedrun/action";
import { fail } from "../play/player";
import { carry, face, findOnScreen, rattle } from "../play/route";
import { move } from "./move";

export const DAY3_ACTIONS: ActionTable = {
  rattleon: move(
    { args: [2, 2], sig: "rattleOn(jmug, window)", help: "scrape a thing along the bars of that button of the tray's flat, then let go — the cup at the window calls Anne (jail.shop stdmove)" },
    (h, c) => rattle(h, c.step.args[0], findOnScreen(h, c.step.args[1], "button") ?? fail(`no ${c.step.args[1]} on the tray's flat`)),
  ),
  rake: move(
    { args: [2, 2], sig: "rake(spoon, rock 3)", help: "carry the spoon to where its bowl rakes that rock loose (jail.shop rake: the point 38 left of and 39 below the pointer)" },
    (h, c) => {
      const rock = findOnScreen(h, c.step.args[1], "prop") ?? fail(`${c.step.args[1]} is not in the wall`);
      return carry(h, c.step.args[0], { x: rock.x + 38, y: rock.y - 39 });
    },
  ),
  carryto: move(
    { args: [2, 2], sig: "carryTo(ikeys, lock)", help: "carry a prop in hand onto a quad of the room, turning to it first — the rock at the rifle, the keys to the lock" },
    async (h, c) => carry(h, c.step.args[0], await face(h, c.step.args[1], "quad"), "prop"),
  ),
};
