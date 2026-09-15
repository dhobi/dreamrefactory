/**
 * The fist fight with Vlad, on its own.
 *
 * The third of Titanic's diversions that is a game rather than a puzzle, and the
 * one that needs least said to it: `FIGHT.STG`'s `openstage ()` opens
 * `fight.shp` and `fight.trk`, plays its theme and calls `openfight ()`, which
 * seeds every global the bout uses —
 *
 *     oldside = "left"
 *     vladpower = 512
 *     playerpower = 512
 *     fightover = false
 *
 * — places the fists, the kick, the two power bars and the buttonbar, and starts
 * Vlad's own idle loop. So opening the stage file is the whole launch, as it is
 * for fencing and unlike blackjack.
 *
 * ## Why the outcome is watched rather than read
 *
 * `endfight ()` plays the knockout — an uppercut and `propview ("vlad", "die")`
 * if you won, Vlad's own uppercut and a 120-step fade if you lost — and then
 * ends:
 *
 *     dumpglobal playerpower, firstpunch, secondpunch, thirdpunch
 *     dumpglobal vladpower, fightover, oldside
 *
 * `dumpglobal` DISCARDS the named globals; it is a teardown statement, not a
 * declaration. So by the time the stage is down and this page notices, the two
 * numbers that say who won are gone. The game's own record of it is
 * `actorowner ("vlad", "wonfight" | "lostfight")`, and that is an accessor over
 * an ACTOR — of which this page has none, there being no cast without a ship.
 *
 * So the powers are sampled while the fight is running and the last pair seen is
 * what the verdict is read from. Sampling is cheap (two map reads), and the
 * alternative — modelling a cast so one string can be written to it — is a ship
 * built to hold a note.
 *
 * ## And it ends for good
 *
 * Neither ending has an "again?" in it: Buick and Haderlitz each ask, because
 * aboard you may sit down again, but the fight with Vlad happens once — winning
 * takes him out of the cast and losing knocks you out. So there is no rematch
 * conversation to borrow, and the page says who won and goes back to the door.
 */
import { bootMinigame } from "./minigame-boot";
import { t } from "@dreamfactory/site/locales";

/** the last powers seen while the bout was live — see the note above */
let lastVlad = 0;
let lastPlayer = 0;

void bootMinigame({
  stage: "fight.stg",
  title: "minigames.fight",
  start: (host) => {
    const g = host.session.interp.globals;
    lastVlad = 0;
    lastPlayer = 0;
    /*
     * Both numbers or neither: they are dumped together at the end of the bout,
     * and a sample that caught one after the other had gone would read as a
     * knockout that never happened.
     */
    const watch = window.setInterval(() => {
      const v = g.get("vladpower");
      const p = g.get("playerpower");
      if (typeof v !== "number" || typeof p !== "number") {
        if (lastVlad || lastPlayer) window.clearInterval(watch);
        return;
      }
      lastVlad = v;
      lastPlayer = p;
    }, 100);
  },
  onLeave: () => {
    /*
     * `endfight ()` is entered when one of them reaches zero, so the loser is
     * whichever is lower — the same comparison the script makes (`if vladpower <
     * playerpower` is the player's win).
     */
    const won = lastVlad < lastPlayer;
    const drawn = lastVlad === lastPlayer;
    /*
     * Each key on its own `t("…")` rather than one call over a ternary: that is
     * the shape `site/tests/locales.ts` scans for when it checks that every
     * string in the catalogue is actually reachable, and a key it cannot see is
     * a key it reports as dead.
     */
    window.alert(
      drawn
        ? t("minigames.fightDrawn")
        : won
          ? t("minigames.fightWon")
          : t("minigames.fightLost"),
    );
    return "done";
  },
});
