/**
 * The fencing bout with Willie, on its own.
 *
 * The one of the two that needs nothing said to it. `FENCE.STG`'s `openstage ()`
 * initialises every global it will read, opens `fence.shp` and `fence.trk`,
 * places willie, the player, the buttonbar and the two scores, lands on flat
 * `fence 8`, starts the theme and calls "en guard" — so opening the stage file IS
 * starting the game, and this file is a name and a call.
 *
 * In the ship it is reached from the squash court, `SQUASH.SET/0001`'s
 * `transtoflat ("fence.stg")`, and left through `transfromflat ()` and a
 * `sendtoset (fence ())` carrying the result back. Neither end exists here.
 */
import { bootMinigame } from "./minigame-boot";

void bootMinigame({
  stage: "fence.stg",
  title: "Fencing — Willie has the right of the piste",
});
