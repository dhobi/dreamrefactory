import { answer, ask, clickActor, meet, openDoor, room, set, walkTo, type Segment } from "../route";

/**
 * Day 3, night: Jackalope and Laurel made up, and the hand for the Thunderbird.
 *
 * `D3E_002` is saved at `SALLOWER` Scene C3 facing west, which is the cell
 * `GANG.CST/0446 mousedown` forces a player to when they click Flippo in the
 * bar. `D3E_003` is one cell away at Scene C2 facing east — the poker table's
 * own standpoint — with the Thunderbird in hand and `phase` at 2. In between:
 * out into the night town, the courting quarrel put right, back in, and one
 * hand of poker.
 *
 *   1. **Flippo, for where Jackalope is.** `FLIPPO.PUP/0033 threenite ()` puts
 *      up **"Where is Jackalope?" (109)** only while `jonesphase = 0 &
 *      laurelphase = 1`, which is exactly the state `D3E_002` is in, and
 *      `flippo.103` is the answer. Its leaving line, **"Goodbye Mr. Flippo."
 *      (103)**, is also `flippophase = 1`, so this one cannot be walked out of.
 *   2. **Out to the street** — `SALLOWER.SET/0052`, Scene D1, `pointinrice`
 *      144,7–387,264 facing east, `uparrow` → `gototown ("east")`. At
 *      `clock = 3` that is `nite.set` (`NEW.FLT/0001 gototown ()`), and it lands
 *      on `townscene`, which is Scene G8.
 *   3. **The chicken pen, facing west.** `NITE.SET/0089` is the scene named
 *      `chicken`, cell (3,10), and its `openscene ()` is the whole first half of
 *      the puzzle:
 *
 *          if day = 3 & clock = 3 & jonesphase = 0
 *              if actorstar ("jones") = "town.seek1" & phase = 0 & currentview () = "west"
 *                  ... voicesound ("jones.1") ... sendtoactor ("jones", mousedown (0))
 *
 *      So the route walks to cell (4,10) facing west and takes the last step
 *      with `uparrow`: a turn does not re-open a scene, and arriving already
 *      facing west is what lets the shout fire.
 *   4. **He hides among the chickens, and is found by standing on his cell.**
 *      `GANG.CST/0267 mousedown` answers `actorstar (me) = "town.seek1"` with
 *      `moveactor ("town.seek2")` — before any distance test, which is why his
 *      `setcursor` offers "touch" from anywhere. `town.seek2` is (360,2690),
 *      cell (1,10), and his `endwalk` there starts `chickenloop ()`:
 *
 *          if playerxyz (1) > 896 | currentset () != "town"   → back to seek1
 *          if currentscene () = "scene b11"                   → runpuppet ("jones.pup")
 *
 *      Scene B11 is that same cell (1,10). So the route walks west onto it —
 *      never east of x = 896, which would send him back — and the conversation
 *      opens by itself.
 *   5. **Jackalope.** `JONES.PUP/0074 runyoself ()` at `clock = 3` with
 *      `jonesphase = 0` is `threenite ()`: **101**, **102**, **201** in order,
 *      and the 201 arm ends `jonesphase = 1`. (Its 101 plaque is worded two ways
 *      — "Yes." while `laurelphase = 1`, "I haven't seen her yet tonight."
 *      otherwise — and both are 101.)
 *   6. **Laurel.** She wanders between `town.jones1` and `town.jones2` on
 *      `GANG.CST/0594 laurelidle ()`, so `meet` is what finds her.
 *      `LAUREL.PUP/0041 runyoself ()` at `clock = 3` only reaches `threenite ()`
 *      because `jonesphase` is now 1 — at `laurelphase = 1 & jonesphase = 0` it
 *      is two lines and nothing else, which is why step 5 has to come first.
 *      `threenite ()` then offers **"I've seen Jackalope. He says he's sorry."
 *      (111)**, which is `sorry ()`: **101**, **102**, **103**, **104**, and 104
 *      is `laurelphase = 2`.
 *   7. **Jackalope again, and `phase = 1`.** He is back at `town.seek1`, and his
 *      `mousedown` there still hides him rather than talking — so the route
 *      stands on Scene B11 FIRST and clicks him from it, which puts the player
 *      where `chickenloop ()` wants them when he arrives. `JONES.PUP/0074` now
 *      sees `jonesphase = 1 & laurelphase = 2` and runs `makeup ()`, whose one
 *      reply **101** does `putdownactor ()` on both of them, `actorowner
 *      ("jones", "friend")` and **`phase = 1`**. `D3E_003` has Jones invisible
 *      and owned by "friend" and Laurel invisible mid-stride, which is that.
 *   8. **Back into the saloon**, `NITE.SET/0131` Scene G8, `pointinsaloon`
 *      241,92–307,201 facing west. Its `keydown` is the only writer of
 *      `saloonphase`: `saloonphase = saloonphase + 1`, wrapping past 2 to 0. The
 *      save's 2 → 0 is that one step through the door, and it is the only
 *      evidence in the globals that the rung ever left the building.
 *   9. **The poker table.** `HOUSE.PRP/0165 mousedown` on the `gamblers` prop is
 *      `if realdist (me) < 500 → sendtoscene ("scene c2", runpoker ())`. Scene
 *      C2 is cell (2,1), the star `gamblers` is at (896,384) and the cell's
 *      centre is (640,384) — 256 away — and C2 facing east is where `D3E_003` is
 *      saved, so the route takes the standpoint before it clicks.
 *  10. `SALLOWER.SET/0047 runpoker ()` opens `salgames.flt`, and
 *      `SALGAMES.FLT/0001 playcardspoker ()` runs `MEZ.PUP/0007 bootpoker ()`.
 *      At `mezphase = 0` on day 3 night that is `mezday3 ()`'s long greeting and
 *      then `wanttoplay ()`: **"Yes." (101)**. `runpoker ()` then racks Zeb and
 *      Pete once and only once — `if zebpetephase = 0 … zebpetephase = 1` — and
 *      deals.
 *  11. **The hand is played by RAISING, and that is the mechanism rather than a
 *      flourish.** `MEZ.PUP/0057 mainbet ()`'s **"Match bet" (101)** sets
 *      `roundnum = 2`, `makebets ()` adds one more, and `bet1 ()`'s
 *      `while … roundnum < 3` ends before the other three ever bet a second
 *      time — so matching takes every hand to a showdown. **"Raise bet" (102)**
 *      into `raisebet ()`'s **"Add $5 to Raise" (103)** and **"Do Raise" (105)**
 *      leaves `roundnum` at 1, which buys a second round of `roundobets ()`, and
 *      that is the round the other three can fold in. Their thresholds are
 *      written down: `PETE.PUP/0076` folds a hand under 200 on `currentbet > 5`,
 *      under 300 on `> 10 + random (10)`, under 400 on `> 15 + random (10)`;
 *      `MEZ.PUP/0058`'s are 5, 10 and `20 + random (10)`. A raise of $40 is over
 *      all six. And Zeb cannot win this hand at all: `ZEB.PUP/0074 makebet ()`
 *      at `day = 3 & clock = 3 & phase = 1` bets the Thunderbird
 *      (`propowner ("tbird", "table")`) on his first bet and answers his second
 *      with `zebtotal = 0`.
 *  12. **The Thunderbird.** `MEZ.PUP/0058 winner ()` is reached from
 *      `SALGAMES.PRP/0694`'s second press, the one on `flat 1`
 *      (`winnertalk ()`), and its first two lines are the whole point of the
 *      night:
 *
 *          if winner = "player"
 *              if day = 3 & clock = 3 & phase = 1
 *                  sendtoshop ("inven", addinven ("tbird"))
 *                  phase = 2
 *
 *      `INVEN.PRP/0001 addinven ()` is what makes `handitem = "tbird"` and
 *      `propowner ("tbird") = "stranger"`: winning it puts it straight in the
 *      hand, so nothing here has to open the inventory panel.
 *  13. **Quit at the next ante.** `MEZ.PUP/0057 anteup ()`'s **"I quit." (102)**
 *      sets `quitpoker = 1` and, because `hasquitpoker` is still 0, runs
 *      `quittalk ()` → `postgameday3 ()`, which at `clock = 3` with `phase = 2`
 *      speaks `postgame3nite ()` and sets `hasquitpoker = 1`. `newgame ()` sees
 *      the non-zero `anteup ()` and calls `closecards ("poker")`, whose poker
 *      arm is `phase = 2`, `mezphase = 2`, and — only if the Thunderbird is not
 *      already the player's — `propowner ("tbird", "mez")`.
 *
 * **The poker's own numbers are not claimed, for two different reasons.** The
 * first is the deal: `winner "player"`, `betorder`, `has1pair 4`,
 * `hasnopair 14` and `playercash 150 → 168` all come out of
 * `SALGAMES.FLT/0002 makehands ()`, which is four calls to `makescore ()` and a
 * `random (15)` in each — the same argument `rungs/d2a006.ts` makes for the
 * blackjack shuffle at the other table, and `dust/tests/salgames.ts` already
 * runs the poker scripts themselves, so nothing here has to. `roundnum 3`,
 * `quitpoker 1`, `fourcount 1 → 3` and `fivecount 4 → 2` are the table's own
 * bookkeeping and land on the save's values in this run, but they are the hand's
 * and not the route's, so they are left with the rest of them.
 *
 * The second reason is `dumpglobal`, and this rung turned out to be the run
 * that settled the open question `docs/engine/scripting-language.md` used to
 * keep a table of. `closecards ("poker")` ends in `dumpsalgamesglobals ()`,
 * sixteen `dumpglobal` lines; the port destroys every name on them, and after
 * this run `winner`, `betorder`, `hasnopair`, `has1pair`, `has2pair`,
 * `playerhand`, `playerhandtemp`, `playerbet`, `playerphase` and `playercount`
 * are simply not in the table. `D3E_003` has all ten — which for a long time
 * read as the port destroying more than `DF.EXE` did, because `winner` and
 * `betorder` are the fourth and fifth names of one list while `hasnopair`
 * survived as its own list's FIRST name, and no reading of `dumpglobal`
 * allowed both.
 *
 * **All ten are dead records.** A dumped name keeps its 32-byte node until
 * something is allocated over it, so a save reports it exactly as if it were
 * live (`rungs/d4mines.ts` has the byte offsets). Four of these ten prove it
 * on the thread's own saves: `winner`, `betorder`, `playerhand` and
 * `playercount` sit unchanged from here to `MSKPZL` and then vanish at
 * `MESAPZL`, the first save after the mine allocates five new globals — a
 * disappearance forty thousand frames from the saloon that no script can
 * explain and no route can cause. `hasnopair` outlives the game only because
 * its slot is the deepest the teardown freed. So the port is right, `D3E_003`
 * is showing corpses, and none of the ten is claimed — not because the
 * question is open, but because what the save carries for them is which
 * record the allocator had not yet reached.
 * `usedcount`, `cardstring`, `playerdowncard`, `dealerdowncard` and `playerbj`
 * are `D2A_006`'s blackjack leftovers, and those are gone from `D3E_003` as
 * well as from the run.
 *
 * **And the Thunderbird is not claimed, which is worth spelling out because the
 * rung's own summary reads as if it should be.** `TAKE Tbird` and
 * `handitem "" → "tbird"` are not a pickup a route can perform: they are
 * `MEZ.PUP/0058 winner ()`'s `addinven ("tbird")`, and that line is reached only
 * on `winner = "player"`. There is exactly ONE hand in the whole game in which it
 * can be reached. `ZEB.PUP/0074 makebet ()` stakes the Thunderbird only while
 * `phase = 1`; all three of `MEZ.PUP/0058`, `ZEB.PUP/0074` and `PETE.PUP/0076`
 * carry the same two lines —
 *
 *     if day = 3 & clock = 3 & phase = 1
 *         phase = 2
 *
 * — so whoever takes that first pot ends the window, and `closecards ("poker")`
 * then hands the bird to Mez (`if propowner ("tbird") != "stranger" →
 * propowner ("tbird", "mez")`) to be given back after the bounty hunters
 * (`MEZ.PUP/0007 afterbounty ()`, at `mezphase = 3`). Folding does not save the
 * window and neither does quitting: both still run a `winner ()` or a
 * `closecards ()`. So the bird turns on one deal of `makescore ()`.
 *
 * Raising is how a player makes that deal likely to go their way rather than
 * merely hoping, and it is what the save's own arithmetic says the original did:
 * a pair of fours (`has1pair = 4`, `hasnopair = 14`) beating three opponents at a
 * showdown is not a thing that happens, and `playercash + 18` is the size of
 * three antes and three opening bets rather than a called pot. This rung plays it
 * that way. Under this port's seeded `random ()` it does not come off —
 * `makescore ()` deals Mez a full house, and no bet folds a hand of 400 or
 * better — so the run ends with the bird at "mez" where `D3E_003` has it at
 * "stranger", and `handitem` is left out of the claims for the same reason
 * `D2A_006` leaves out its winnings. Everything the rung does claim is a
 * consequence of sitting down and getting up again rather than of the cards.
 */
export const rung: Segment = {
  from: "D3E_002",
  to: "D3E_003",
  what: "Jackalope and Laurel made up, and the one hand for the Thunderbird",
  claims: [
    "flippophase", "jonesphase", "laurelphase", "phase", "saloonphase",
    "mezphase", "zebpetephase", "hasquitpoker", "theset",
  ],
  async play(p) {
    const sal = set("SALLOWER");
    const nite = set("NITE");
    const num = (name: string): number => Number(p.session.interp.globals.get(name) ?? 0);
    const str = (name: string): string => String(p.session.interp.globals.get(name) ?? "").toLowerCase();
    const star = (who: string): string => ask(p, "actorstar", [who]).toLowerCase();

    // ---- 1. Flippo, for where Jackalope is ---------------------------------
    await clickActor(p, "flippo", "Flippo at the bar");
    await answer(p, 109, "Where is Jackalope?");
    await answer(p, 103, "Goodbye Mr. Flippo.");
    await p.pump(() => !p.session.puppet, "Flippo to finish");
    if (num("flippophase") !== 1) throw new Error(`flippophase is ${num("flippophase")}`);

    // ---- 2. out into the night town ----------------------------------------
    await openDoor(p, [144, 7, 387, 264], "salout", "the saloon door out", {
      set: sal, x: 3, z: 0, view: "east",
    });
    await p.pump(() => room(p) === "nite", "the night street");

    /*
     * ---- 3. the chicken pen, entered facing west -------------------------
     *
     * `openscene ()` runs when the SCENE changes, and a turn does not change
     * it — so the last step onto (3,10) has to be a walk that is already
     * heading west, not a walk followed by a turn.
     */
    await walkTo(p, nite, { x: 4, z: 10, view: "west" });
    await p.press("uparrow", "west into the chicken pen");
    if ((p.session.currentSceneName() ?? "").toLowerCase() !== "chicken") {
      throw new Error(`the pen is ${p.session.currentSceneName()}, not "chicken"`);
    }
    await p.settle("Jackalope's shout");

    // ---- 4 & 5. he hides in the chickens, and is found on his own cell ------
    await p.pump(() => star("jones") === "town.seek2", "Jackalope to hide in the chickens");
    await walkTo(p, nite, { x: 1, z: 10, view: "west" }, () => !!p.session.puppet);
    await p.pump(() => !!p.session.puppet, "Jackalope to pop out of the chickens");
    await answer(p, 101, "Yes.");
    await answer(p, 102, "You try talking to Laurel?");
    await answer(p, 201, "What'll you do now?");
    await p.pump(() => !p.session.puppet, "Jackalope to finish");
    if (num("jonesphase") !== 1) throw new Error(`jonesphase is ${num("jonesphase")}`);

    // ---- 6. Laurel, wherever she has wandered to ---------------------------
    await meet(p, nite, "laurel", "Laurel in the street");
    await answer(p, 111, "I've seen Jackalope. He says he's sorry.");
    await answer(p, 101, "Yes, he did.");
    await answer(p, 102, "Honest.");
    await answer(p, 103, "I could ask him for you.");
    await answer(p, 104, "I sure will Laurel.");
    await p.pump(() => !p.session.puppet, "Laurel to finish");
    if (num("laurelphase") !== 2) throw new Error(`laurelphase is ${num("laurelphase")}`);

    /*
     * ---- 7. back to Jackalope, standing where chickenloop () wants us -----
     *
     * The cell comes before the click: `mousedown` at `town.seek1` hides him
     * again rather than talking, and `chickenloop ()` sends him straight back
     * if the player is east of x = 896 when he gets there.
     */
    await walkTo(p, nite, { x: 1, z: 10, view: "west" }, () => !!p.session.puppet);
    await p.pump(() => ask(p, "iswalk", ["jones"]) !== "1", "Jackalope to stand still");
    await clickActor(
      p, "jones", "Jackalope in the chicken pen", 20,
      () => star("jones") !== "town.seek1", false,
    );
    await p.pump(() => !!p.session.puppet, "Jackalope to pop out again");
    await answer(p, 101, "I spoke with Laurel. Everything's okay.");
    await p.pump(() => !p.session.puppet, "Jackalope to finish");
    if (num("phase") !== 1) throw new Error(`phase is ${num("phase")}`);
    if (ask(p, "actorowner", ["jones"]).toLowerCase() !== "friend") {
      throw new Error(`Jackalope is still owned by "${ask(p, "actorowner", ["jones"])}"`);
    }

    // ---- 8. back into the saloon, which is what steps saloonphase ----------
    await walkTo(p, nite, { x: 6, z: 7, view: "west" });
    await openDoor(p, [241, 92, 307, 201], "saloon", "the saloon door", {
      set: nite, x: 6, z: 7, view: "west",
    });
    await p.pump(() => room(p) === "sallower", "the bar");
    if (num("saloonphase") !== 0) throw new Error(`saloonphase is ${num("saloonphase")}`);

    // ---- 9. the poker table's own standpoint -------------------------------
    await walkTo(p, sal, { x: 2, z: 1, view: "east" });
    const gamblers = p.session.propScripts.get("gamblers");
    if (!gamblers) throw new Error("no prop script for the gamblers — is house.prp open?");
    void p.session.track(
      p.session.interp.runHandler(gamblers, "mousedown", ["gamblers"], {
        me: "gamblers", target: "gamblers",
      }),
    );

    /*
     * ---- 10-13. the hand ---------------------------------------------------
     *
     * The table is driven the way a player drives it: the plaque that is up,
     * and the `continue` button when none is. Which menu is on screen is read
     * off the reply IDS, because the numbers overlap and the words do not:
     * only `raisebet ()` offers **105**, only `mainbet ()` offers **103** and
     * **104** without it, and `anteup ()` and `wanttoplay ()` are the two-reply
     * ones.
     *
     * `continue` is `SALGAMES.PRP/0694`, and it is a POLLING button —
     * `while stilldown () … if pointinprop (me, mouse ())` — so it takes a
     * press and a release with the pointer parked on it, not a fired click,
     * which is dispatched and gone. `newgame ()` draws it at 200,325.
     */
    const bevels = (): { id: number; text: string }[] => p.session.puppet?.bevels ?? [];
    const at = (id: number): number => bevels().findIndex((b) => b.id === id);
    const choose = async (id: number): Promise<void> => {
      p.session.puppetCtrl.puppetChoose(at(id));
      await p.tick(20);
    };
    const pressContinue = async (): Promise<void> => {
      // looked up per press: `salgames.prp` is opened by `runpoker ()` and shut
      // again by `closecards ()`, so the button only exists while a game is on
      const cont = p.session.propScripts.get("continue");
      if (!cont) throw new Error("no prop script for the continue button — is salgames.prp open?");
      const point = Number(ask(p, "makepoint", [200, 325]));
      p.session.setPointer(200, 325);
      p.session.pointerDown = true;
      try {
        void p.session.track(
          p.session.interp.runHandler(cont, "mousedown", [point], { me: "continue", target: "continue" }),
        );
        await p.tick(20);
      } finally {
        p.session.pointerDown = false;
      }
      await p.settle("the continue button");
    };

    /*
     * One hand, then up from the table.
     *
     * `MEZ.PUP/0007`'s own header says what `phase` means here — "phase = 2
     * after playing a hand | leaving poker table on phase = 1" — so `phase` is
     * the counter: while it is still 1 the hand has not been played, and the
     * two-reply menu is `wanttoplay ()`'s "Yes." and then `anteup ()`'s
     * "Add $1."; once one of the three `winner ()` handlers has made it 2, the
     * next ante is where the player gets up.
     *
     * And the raise goes in on the FIRST betting round only. The fold is bought
     * in `bet1 ()`'s second pass of `roundobets ()`, and anyone still at the
     * table after that pass is holding 400 or better and does not fold at any
     * price (`MEZ.PUP/0058`, `PETE.PUP/0076`: every band from 400 up answers a
     * bet with `seebet ()` and has no `dofold ()` arm at all). `playerphase` is
     * which round it is — `SALGAMES.FLT/0002`'s header numbers them, bet1phase
     * = 1 and bet2phase = 3 — so round two is matched rather than raised.
     */
    let adds = 0;
    for (let step = 0; step < 400 && (num("phase") !== 2 || num("quitpoker") !== 1); step++) {
      if (at(105) >= 0) {
        // raisebet (): eight $5 steps is $40, over every fold threshold below 400
        if (adds < 8 && at(103) >= 0) {
          adds++;
          await choose(103); // "Add $5 to Raise"
        } else {
          await choose(105); // "Do Raise"
        }
        continue;
      }
      if (at(103) >= 0 && at(104) >= 0) {
        adds = 0;
        await choose(num("playerphase") === 1 ? 102 : 101); // "Raise bet" / "Match bet"
        continue;
      }
      if (bevels().length === 2 && at(101) >= 0 && at(102) >= 0) {
        await choose(num("phase") === 1 ? 101 : 102); // "Yes." / "Add $1." — then "I quit."
        continue;
      }
      if (bevels().length) {
        throw new Error(`nothing to answer in: ${bevels().map((b) => `${b.id}:${b.text}`).join("|")}`);
      }
      if (ask(p, "propvisible", ["continue"]) === "1") {
        await pressContinue();
        continue;
      }
      await p.tick(20);
    }
    if (num("phase") !== 2) throw new Error(`the hand was never played — phase is ${num("phase")}`);

    // ---- and out of the game, back to the table's own standpoint -----------
    await p.pump(() => room(p) === "sallower", "the bar again");
    await p.settle("the poker table");
    if (num("phase") !== 2 || num("mezphase") !== 2) {
      throw new Error(`phase is ${num("phase")} and mezphase is ${num("mezphase")}`);
    }
    if (num("hasquitpoker") !== 1) throw new Error(`hasquitpoker is ${num("hasquitpoker")}`);
    /*
     * The Thunderbird is REPORTED and not asserted — see the note above the
     * segment. `closecards ("poker")` has already put it wherever the deal put
     * it, and there is no second hand in which that can be changed.
     */
    if (process.env.DUST_TALK) {
      console.log(
        `[d3e003] the hand at phase = 1 went to "${str("winner")}"; ` +
          `the Thunderbird is "${ask(p, "propowner", ["tbird"])}" and handitem is "${str("handitem")}"`,
      );
    }
    await walkTo(p, sal, { x: 2, z: 1, view: "east" });
  },
};
