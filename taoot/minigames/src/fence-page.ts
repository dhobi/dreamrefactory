/**
 * The fencing bout with Willie, on its own.
 *
 * `FENCE.STG`'s `openstage ()` initialises every global it will read, opens
 * `fence.shp` and `fence.trk`, places willie, the player, the buttonbar and the
 * two scores, lands on flat `fence 8`, starts the theme and calls "en guard" — so
 * opening the stage file is very nearly the whole launch.
 *
 * Very nearly, because of one global it does NOT set.
 *
 * ## `fencelevel`, which aboard is a sentence you say
 *
 * Haderlitz asks whether Colonel Zeitel was right about you, and the reply IS the
 * difficulty (`WILFENC1.PUP/0006`):
 *
 *     "Colonel Zeitel's confused me with someone else. I don't fence."  -> 25
 *     "Partially. I'm a mediocre fencer."                               -> 15
 *     "The Colonel is correct, I'm an excellent fencer."                ->  5
 *
 * Higher is EASIER, which reads backwards until you see what it gates: Willie's
 * openings are `random (100) < fencelevel + 15`, `+ 10`, `+ 5` and `- 0` across
 * the four guards (`FENCE.SHP/0093`), and his attack pace is `makeloop ("prop",
 * me, "willieattack", 12 + random (fencelevel))` — a bigger number is a slower,
 * sloppier opponent. `FENCE.STG` then rubber-bands it: your hit takes 4 off
 * (floor 5), his adds 4 (cap 25), so the bout tightens as you win.
 *
 * The stage never writes it, because aboard the conversation always has. Opened
 * cold it is 0 — below the game's own hardest setting, with `random (0)` for his
 * pace — which is not a difficulty anyone chose. So the page asks instead, in
 * Haderlitz's own three options, and 15 is the default for the same reason it is
 * the middle reply.
 */
import { bootMinigame, markOption } from "./minigame-boot";

/** the three the game offers, by the reply that picks each one */
const LEVELS: Record<string, number> = { novice: 25, mediocre: 15, excellent: 5 };

function fencelevel(): { level: number; name: string } {
  const asked = (new URLSearchParams(window.location.search).get("level") ?? "").toLowerCase();
  const name = asked in LEVELS ? asked : "mediocre";
  return { level: LEVELS[name], name };
}

const picked = fencelevel();
markOption(`?level=${picked.name}`);

void bootMinigame({
  stage: "fence.stg",
  title: `Fencing — ${picked.name}`,
  /**
   * Before the stage opens would be wrong and after is right: `openstage ()` does
   * not touch `fencelevel`, but it DOES start Willie's attack loop, and that loop
   * reads it. Seeding it here means the first pass of `willieattack` already has
   * the number the player chose.
   */
  start: (host) => {
    host.session.interp.globals.set("fencelevel", picked.level);
    /**
     * ...and `willphase`, which is where the bout's OWN loop is kept.
     *
     * `WILFENC1.PUP/0006 runyoself ("fence")` branches on it: 0 is the first
     * conversation (the one that asks how well you fence), 201 is "a bout has
     * just been fought" — it bumps `fencecount`, sets 202 and runs `postgame ()`
     * — and 202 is "he has already asked". `SQUASH.SET`'s own `fence ()` then
     * reads it back: `if willphase = 201` it opens the flat for another bout,
     * and anything else walks you out of the court.
     *
     * 201 is therefore what "you said yes and fenced" looks like, which is
     * exactly the state this page starts you in.
     */
    host.session.interp.globals.set("willphase", 201);
  },
  /**
   * The squash court's own loop, which is the whole of `SQUASH.SET fence ()`:
   *
   *     openpuppetfile ("wilfenc1.pup")
   *     sendtopuppet ("boot script", runyoself ("fence"))
   *     closepuppetfile ()
   *     if willphase = 201 -> transtoflat ("fence.stg")
   *
   * Willie says his piece about the bout just fought (`postgame ()` — winded,
   * and a ring if you have won twice), then asks "Yes, I'll fence." / "No, I've
   * got to go." Saying yes puts `willphase` back to 201, which aboard reopens the
   * flat and here reopens the stage. Saying no leaves it at 202, and with no ship
   * to be walked back into, the way out is the chooser.
   */
  onLeave: async (host) => {
    const s = host.session;
    if (!(await s.puppetCtrl.openPuppetFile("wilfenc1.pup"))) return "done";
    const boot = s.puppet?.scripts.get("boot script");
    if (boot) {
      // `fireHandler` passes no arguments and this handler is all argument —
      // `runyoself (msg)` does nothing at all unless msg is "fence".
      await s.interp.runHandler(boot, "runyoself", ["fence"], {
        me: "wilfenc1.pup",
        target: "",
      });
    }
    s.puppetCtrl.closePuppetFile();
    return s.interp.globals.get("willphase") === 201 ? "again" : "done";
  },
});
