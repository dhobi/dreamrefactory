import {
  answer, ask, clickActor, offerInTalk, question, set, walkTo, type Segment,
} from "../route";

/**
 * Day 1, night: a whiskey, the jug filled, and Nate Trotter met.
 *
 * `D1E_002` is the player at `SALLOWER` Scene C4 facing west with
 * `handitem = "cards"` and `jan.pup` still the last puppet loaded — up from a
 * hand of blackjack at the table on that cell. Twenty-six seconds later
 * `D1E_003` is one cell north at Scene C3 facing west, and that is not
 * somewhere anybody walks to: it is where `GANG.CST/0670 mousedown` PUTS you
 * when you click Trotter in the saloon —
 *
 *     if actorset (me) = "sallower"
 *         currentscene ("scene c3")
 *         currentview ("west")
 *         ...
 *         runpuppet ("trotter.pup")
 *
 * — which is also why the save's last puppet file is `trotter.pup`. The rung
 * ends on a click, not on a step.
 *
 *   1. **Gus is clickable from one cell.** `GANG.CST/0775 mousedown` is
 *      `if realdist (me) < hotdist ()` and then
 *      `if currentscene () != "scene c1" exitcode` — the bar, and nowhere else.
 *      And he does not stand still: his `endwalk` arms `gopour` at
 *      `sallower.gus1` (346,140) and `donepourin` at `sallower.gus2`
 *      (352,644), so he shuttles between the two. gus2 is 591 from the centre
 *      of Scene C1 and `hotdist ()` is 384 in `sallower` (`GANG.CST/0001`), so
 *      a click while he is down the counter does nothing at all. This waits for
 *      `realdist` to come back inside the gate — the script's own arithmetic,
 *      not a number of ticks.
 *   2. **The drink is what moves `gusphase`.** `GUS.PUP/0044 mainloop ()`
 *      offers **101** ("What are you serving?", "I'm mighty thirsty, Gus." —
 *      the wording is `random (3)`, the id is not), which falls into
 *      `buydrink ()`: a dollar off `playercash`, `haveadrink ()`, then four
 *      plaques. **101** there is the whiskey, and its arm is the only writer of
 *      `gusphase = 1` in the whole corpus:
 *
 *          if DAY = 1 & gusphase = 0
 *              ...
 *              gusphase = 1
 *
 *      102 is the milk; 103 is the Frothy Prairie Oyster Daiquiri, which is a
 *      different rung's business — see the note on `counter` below.
 *   3. **The jug.** `GUS.PUP/0007 gift ()` is the only writer of
 *      `juglevel = 5`: `if what = "jug"`, five off `playercash`, `juglevel = 5`.
 *      A gift is a PLAQUE — `INVEN.PRP/0001 addhandbevel ()` adds **55555**,
 *      and with `currentpuppet () = "gus"` it even reads "Would you please fill
 *      my jug?" — but `GANG.CST/0001 prepuppet ()` sets `handflag = 1` at the
 *      top of every conversation, so the first press is the inventory picker
 *      asking WHICH. `offerInTalk` works the picker.
 *
 *      That picker is also the whole of `handitem "cards" → ""`. Choosing the
 *      jug runs `INVEN.PRP/0001 stdmouse ()`, whose first act is
 *      `if handitem != "" propview (handitem, "panel")` — which is why
 *      `D1E_003` has the cards back at the panel's 75,141 and the jug drawn
 *      `"large"` at 316,320, where `NEW.FLT/0002 openflat ()` puts whatever is
 *      in hand when the main panel comes back. Then `selhandbevel ()` gifts it
 *      and sets `handitem = ""`, leaving the jug "large" and invisible, which
 *      is exactly the prop record the save carries.
 *   4. Out of Gus's file on **103** ("Bye, Gus.", "Goodbye.", "So long."),
 *      which is `goodbye ()` and an `exitcode`. It sets nothing.
 *   5. Trotter stands at `sal.trotter1` (576,648) — Scene C3 — put there by
 *      `SALLOWER.SET/0001 openset ()` under `day = 1 & trotterphase < 6 &
 *      phase < 7`. He is 524 from Scene C1 and 64 from Scene C3, so the route
 *      walks the two cells back down the room before clicking.
 *   6. **`trotterphase 0 → 4` is three conversations, not four.**
 *      `TROTTER.PUP/0068` (TROTTER DAY 1) is a switch whose arms speak and set
 *      the next — 0 → 1, 1 → 2 — but the third arm skips a number:
 *
 *          case 2
 *              puppetspeak ("trotter.16")
 *              puppetspeak ("trotter.17")
 *              if mightdie () = 1
 *                  exitcode
 *              endif
 *              trotterphase = 4
 *
 *      3 is reachable on day 1 only from `GUS.PUP/0044`'s daiquiri, and nothing
 *      here drinks one. The first two arms are pure `puppetspeak` and leave no
 *      question on screen, so those two clicks are checked against the phase
 *      rather than against "a conversation is open" — `clickActor`'s default
 *      test would call a click that worked a click that did nothing.
 *   7. **`mightdie ()` is named after what it does.** Its plaques are **101**
 *      ("Buy you a drink?") and **102** twice ("You have a bad attitude." and
 *      "Maybe you should be nicer to newcomers."), run through
 *      `puppetscramble ()`, and 102 is
 *
 *          playerdeath = "by trotter"
 *
 *      So `talkOut` must not come near this one: `LEAVING` prefers 102 to 101
 *      and would shoot the rung dead on a coin toss. 101 buys him a drink
 *      (`playercash` down one), falls into `greet ()` — one plaque, **101** —
 *      and then `mainloop ()`, which returns 0 on **104** ("Well, I gotta
 *      go."). That 0 is what carries back out of `mightdie ()` to
 *      `trotterphase = 4`.
 *
 * **The money and the deck are not claimed.** `playercash 400 → 791` is another
 * hand at the blackjack table on the very cell `D1E_002` is saved standing on:
 * `cardstring` is a fresh 52-card shuffle, `usedcount 7 → 5` and
 * `playerdowncard "6d" → "qh"` and `dealerdowncard "8h" → "js"` are the top of
 * it, and `threecount`, `fourcount` and `fivecount` are `JAN.PUP`'s line
 * counters walking. None of that follows from a route — it follows from a
 * shuffle this port does not reproduce — and `rungs/d2a006.ts` leaves the same
 * table for the same reason. The three purchases this rung really makes (one
 * whiskey, five for the jug, one for Trotter) leave `playercash` at 393; the
 * 398 between that and 791 is the hand.
 *
 * **`counter` IS claimed, because it is what rules the daiquiri out.**
 * `GUS.PUP/0044 haveadrink ()` steps it 0 → 1 → 2 → 0, once per drink bought,
 * and the save moves it 1 → 2: exactly one drink. Two drinks — a whiskey for
 * `gusphase` and a daiquiri for the `trotterphase = 3` that `GUS.PUP` can also
 * set — would have left it at 0. Filling the jug does not touch it (`gift ()`
 * returns before its own rotation), and no arm of `TROTTER.PUP/0068` touches it
 * either. So the one route that lands on all four of `gusphase`, `juglevel`,
 * `trotterphase` and `counter` at once is a single drink at the bar and three
 * clicks on Trotter, and that is the route below.
 *
 * `idlecount 3 → 0` and `starcount 7 → 1` are the shooting star's own loop
 * (`setupstar` handing over to `movestar` on the `shootingstar` prop) counting
 * while the player talks, and are not claimed.
 *
 * One thing this port does differently, and it does not change the rung.
 * `GUS.PUP/0044 hello ()` opens `if actorvalue ("GUS") = 0` — the three
 * lines Gus says to a stranger — and ends that arm in `exitcode`. Here a
 * routine's `exitcode` does not end its CALLER (`Interp.evalCall` takes
 * `runHandler(...).value` and drops the signal), so the first click on Gus
 * speaks the introduction and falls straight on into `mainloop ()`; under
 * `DF.EXE` it would presumably have taken a second click to reach the plaques.
 * Either way the plaques are what the route answers, and `clickActor` clicks
 * until they are there.
 */
export const rung: Segment = {
  from: "D1E_002",
  to: "D1E_003",
  what: "a whiskey, the jug filled, and Nate Trotter met",
  claims: ["gusphase", "juglevel", "trotterphase", "handitem", "counter", "theset"],
  async play(p) {
    const sal = set("SALLOWER");
    const num = (n: string): number => Number(p.session.interp.globals.get(n) ?? 0);
    const held = (): string => String(p.session.interp.globals.get("handitem") ?? "");
    /** `GANG.CST/0001 realdist (actorname)` — the gate every cast `mousedown` opens with */
    const realdist = (who: string): number =>
      Math.hypot(
        Number(ask(p, "actorxyz", [who, 1])) - Number(ask(p, "playerxyz", [1])),
        Number(ask(p, "actorxyz", [who, 2])) - Number(ask(p, "playerxyz", [2])),
      );

    // ---- 1 & 2. the bar, and the drink that sets gusphase -------------------
    // the facing is not part of the gate — `GANG.CST` is reached by name and
    // asks only for the CELL and the distance — so this is simply the shortest
    // way to be standing in Scene C1
    await walkTo(p, sal, { x: 2, z: 0, view: "north" });
    await p.pump(() => realdist("gus") < 384, "Gus to come back up the bar");
    await clickActor(p, "gus", "Gus behind the bar");
    const asked = await answer(p, 101, "I'm mighty thirsty, Gus.");
    await answer(p, 101, "Whiskey...", asked);
    await p.pump(() => !!question(p) && question(p) !== asked, "Gus's plaques again");
    if (num("gusphase") !== 1) throw new Error(`gusphase is ${num("gusphase")}`);

    // ---- 3. the jug over the bar -------------------------------------------
    await offerInTalk(p, "jug", "the jug for Gus to fill");
    if (num("juglevel") !== 5) throw new Error(`juglevel is ${num("juglevel")}`);
    if (held() !== "") throw new Error(`the hand still holds "${held()}"`);

    // ---- 4. and out --------------------------------------------------------
    await answer(p, 103, "Bye, Gus.");
    await p.pump(() => !p.session.puppet, "Gus to finish");

    // ---- 5, 6 & 7. Trotter, three times ------------------------------------
    await walkTo(p, sal, { x: 2, z: 2, view: "west" });
    if (realdist("trotter") >= 384) {
      throw new Error(`Trotter is ${Math.round(realdist("trotter"))} away, outside hotdist ()`);
    }
    await clickActor(p, "trotter", "Trotter, first time", 40, () => num("trotterphase") >= 1);
    await clickActor(p, "trotter", "Trotter, second time", 40, () => num("trotterphase") >= 2);
    await clickActor(
      p, "trotter", "Trotter, third time", 40,
      () => !!question(p) || num("trotterphase") === 4,
    );
    // by id, and never by `LEAVING`: 102 here is `playerdeath = "by trotter"`
    const drink = await answer(p, 101, "Buy you a drink?");
    const name = await answer(p, 101, "Well, who are you?", drink);
    await answer(p, 104, "Well, I gotta go.", name);
    await p.pump(() => !p.session.puppet, "Trotter to finish");
    if (num("trotterphase") !== 4) throw new Error(`trotterphase is ${num("trotterphase")}`);
  },
};
