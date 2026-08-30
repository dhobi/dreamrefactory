import { ask, clickActor, openDoor, room, set, walkTo, type Segment } from "../route";
import type { Pumped } from "../harness";

/**
 * Day 2, afternoon: $565 into the bank, and Flippo's news out of Diamondback.
 *
 * A minute of the disc's own play, and most of it is arithmetic. `D2A_008`
 * carries $765 in the pocket and $22 in the bank; `D2A_009` carries $200 and
 * $587. Both add to $787, so nothing was earned or spent in between: one visit
 * to the bank moved **$565** across, and `TELLER.PUP/0068` says exactly how a
 * deposit is made.
 *
 * **`counter` is what says how many times each plaque was pressed.** It is the
 * game's shared "which line of patter next" counter, 0 → 1 → 2 → 0, and both
 * ends of this rung read 0 — `D2A_008`'s 0 is `COBB.PUP`'s doing, and the rung
 * before this one claims it. So whatever bumped it here did so a multiple of
 * three times, and exactly three things can:
 *
 *   - **the teller's greeting.** `playeraccount` is 22, so `smarm` is 0, and
 *     `runyoself ()`'s `switch smarm` stacks an empty `case 0` on `case 1` —
 *     one bump of `counter` before a word about money is said.
 *   - **`depbig ()`**, which "Make deposit." runs once per press, because
 *     `playeraccount` is over its 20 from the first dollar in.
 *   - **`MWIFE.PUP/0073 brushoff ()`**, which is the whole of what the Mayor's
 *     wife has to say on a day-2 afternoon once `mwifephase` is 1.
 *
 * and she has to be in it, because `countsix` is in `D2A_009` and `MWIFE.PUP`
 * is the only file in the game that mentions the name. So the count is
 * 1 (greeting) + N (deposits) + 1 (her) ≡ 0, and **N = 1**: one press of "Make
 * deposit.", not two and not three.
 *
 *   1. **Out of the saloon.** `SALLOWER.SET/0052` owns cell (3,0), `pointinrice`
 *      144,7-387,264 facing east, door owner "salout", and its `uparrow` is
 *      `gototown ("east")`. `gototown` (`NEW.FLT/0001`) re-enters at
 *      `townscene`, still "Scene G8" — the saloon's own cell, (6,7).
 *   2. **`bouncer` is destroyed on the way out, and that is claimed.**
 *      `SALLOWER.SET/0001 closeset ()` puts Isao down at `clock > 1`, and
 *      `putdownactor ()` opens `dumpglobal bouncer, dirgo`. `D2A_009` has no
 *      `bouncer` at all. It keeps `dirgo` — this port destroys every name of a
 *      `dumpglobal` where five shipped teardowns say the original destroyed only
 *      the first (`docs/engine/scripting-language.md`) — so `dirgo` is a name a
 *      route cannot be right about either way, and is left out.
 *   3. **The bank.** `TOWN.SET/0129` owns cell (6,5), `Scene G6`: `pointinbank`
 *      200,81-306,232 facing west, door owner "bank", `uparrow` →
 *      `gotointerior ("bank.set")`. `lockbank ()` on a day-2 afternoon falls
 *      through every arm to `return false`.
 *   4. **The teller is a wall, not an actor.** `BANK.SET/0045` owns cell (3,2),
 *      `Scene D3`, and its `mousedown` inside `pointinteller` 176,57-319,213
 *      facing west is `runpuppet ("teller.pup")`. `tellervalue = tellervalue + 1`
 *      is the first thing `runyoself ()` does, which is why `tellervalue` 4 → 5
 *      is one visit and not a count of anything else. (The other way to reach
 *      him — the sign on `Scene D1` — sets `tellerphase = 999` first, and that
 *      arm speaks and exits without ever offering a deposit. `tellerphase` is 0
 *      at both ends, so the sign was not touched.)
 *   5. **The deposit.** "I want to deposit money." (**101**) opens `dodeposit ()`
 *      and its five plaques: $1 (101), $5 (**109**), $10 (102), $20 (**103**),
 *      "Make deposit." (104). `actdep (amount)` moves the money on the spot —
 *      `playercash = playercash -amount`, `playeraccount = playeraccount +
 *      amount` — so "Make deposit." is only the receipt, and only the bump of
 *      `counter`. $565 in the fewest presses is **28 × $20 + 1 × $5**; the saves
 *      fix the total and the number of receipts, not the denominations, and any
 *      other spread of the same $565 leaves every claimed global identical.
 *   6. **"Bye." (105)** closes him. It speaks and exits without touching
 *      `counter`, which the sums above depend on.
 *   7. **The Mayor's wife**, in the street, is one line and no plaques.
 *      `MWIFE.PUP/0074 twopm ()` opens
 *
 *          if mwifephase = 1
 *              if sendtostagefx (day2items ()) >= 3 & random (3) = 1
 *                  puppetspeak ("mwife.123")
 *                  exitcode
 *              endif
 *              sendtopuppet ("day1", brushoff ())
 *
 *      and `mwifephase` is 1 in both saves. So there is nothing to answer: she
 *      is clicked, she says her line, and `brushoff ()`'s `switch counter` takes
 *      the 2 the bank left to **0**. The one-in-three arm above says the line
 *      and bumps nothing, so the click is repeated until `counter` is 0 — which
 *      is also the check that the right branch ran.
 *   8. **She has to be stood up first, and that is this port's doing.**
 *      `D2A_008`'s walk table has five slots whose deltas are the same handful
 *      of numbers over and over — Mwife, Jones and the Mayor all carry
 *      `d = (-1939409168, …, -1939408904)` — and a `progress` far past their own
 *      `dist` (hers is 1941203674 of 30702). They are finished slots left in
 *      place, which `savegame-v1.ts` says outright is what four of five shipped
 *      tables hold; the save's own ACTOR records put all three on real stars
 *      (she is at (904,2488), `town.jones6`). This port resumes them anyway.
 *      Because the progress is past the distance the walk ends on the first
 *      service pass, but it ends AT THE RECORD'S DESTINATION: measured, the
 *      first `settle` after the load puts her at **(-32483,-31698)**, thirty-two
 *      thousand units off the map, and `endwalk ()` then starts `mwifeidle ()`
 *      strolling her all the way back — a walk long enough that she is still
 *      four cells outside the town a thousand frames later, and never once
 *      inside the 384 `GANG.CST/0001 hotdist ()` allows. So the segment stands
 *      her on the star the save's actor record has her on, before the first
 *      tick. After that she behaves: `mwifeidle ()` walks her between
 *      `town.jones5` and `town.jones6` as it should. Nothing else in the rung
 *      depends on it — Jones and the Mayor carry the same junk and are both
 *      re-placed by `chinese ()` a few minutes later.
 *   9. **The newspaper office.** `TOWN.SET/0086` owns cell (3,7), `Scene D8`:
 *      `pointinpaper` 213,98-282,211 facing west, door owner "paper".
 *      `gotointerior` writes **`townscene = "Scene D8"`**, and that is the whole
 *      reason the rung records it — `townscene` only moves on the way INTO a
 *      building, so it names the last door the original went through.
 *  10. **Flippo, and one reply.** `PAPER.SET/0038 openscene ()` only knocks on
 *      him at `flippophase = 0` and it is 1, so he is clicked: he stands at
 *      `paper.flippo` (388,696), 312 from cell (1,1) where the entry lands, and
 *      `hotdist ()` is 512 outside the four sets it names. `FLIPPO.PUP/0076
 *      runyoself ()` opens
 *
 *          if clock = 2 & sendtostagefx (day2items ()) >= 3
 *              chinese ()
 *
 *      and `day2items ()` (`NEW.FLT/0001`) counts the gun, the boots and the
 *      bullets, all three of them the stranger's in both saves. **"In
 *      Diamondback?" (101)** is the only plaque, and it is the rung's three
 *      phase globals at once: `flippophase = 2`, then `jonescomment ()` — which
 *      sets **`jonesphase = 999`** and plays Jones's one line through an
 *      `openpuppetfile ("jones.pup")` and back — then `setupactor ("shack")` for
 *      Dell, Cobb and Jones, `putdownactor ()` for the wife, the Mayor, Marie
 *      and Quist, and **`phase = 1`**. `D2A_009` has all seven of those actors
 *      moved exactly so, which is the strongest evidence in the save that this
 *      one reply is the whole event.
 *  11. **`theset = "town"` is written from inside `paper.set`.**
 *      `GANG.CST/0001 stdactor (who)` is `theset = actorset (who)` — the
 *      ACTOR's set, not the room — and the last of `chinese ()`'s three
 *      `setupactor ("shack")` calls is Jones's, at `town.well`.
 *  12. Out through `PAPER.SET/0038` (cell (1,1) facing east, `pointinrice`
 *      138,47-365,264, owner "flipout") and down the street to cell (7,10),
 *      `Scene H11`, facing west — where the save was taken.
 *  13. **`loopsound = ""` is a consequence of `phase = 1`, not a switch.**
 *      `TOWN.SET/0137 dayfxs ()` picks the nearest of four noises under two
 *      cells away. From (7,10) the saloon at `Scene G8` is 809 away and the
 *      anvil and the saw further, and the wind-chime at `Scene G12` — 362 away,
 *      easily near enough — is behind `if phase = 0 | clock != 2 | day != 2`.
 *      With `phase` now 1 on a day-2 afternoon nothing qualifies, `fxsound` is
 *      "" and the loop writes it through.
 *  14. **Todd** stands at `town.extra2` (2228,2636), 312 from the standpoint and
 *      inside the town's 384. `todd.pup` is the open file in `D2A_009`, and
 *      `TODD.PUP/0048` is pure patter — `puppetspeak` and nothing else — so
 *      clicking him moves no global. He is clicked anyway because he is the only
 *      check available on the standpoint ITSELF, which nothing else in the rung
 *      tests: `GANG.CST/0544 mousedown` puts both `runpuppet ("todd.pup")` and
 *      `actorvalue (me, actorvalue (me) + 1)` inside
 *      `if realdist (me) < hotdist ()`, so the count going up is proof the click
 *      reached him and therefore proof of where the route is standing.
 *
 * **`countsix` is not claimed, and the reason is a finding about `exitcode`.**
 * `MWIFE.PUP/0074 runyoself ()` is
 *
 *     global countsix
 *     countsix = random (6) -1
 *     switch clock … twopm () …
 *     dumpglobal countsix
 *
 * and every exit from `twopm ()` is an `exitcode`. `D2A_009` carries `countsix`
 * = 4, so in the shipped engine that `exitcode` ended the HANDLER and the
 * `dumpglobal` on the last line never ran. In this port `exitcode` ends only the
 * routine it is written in — `Interp.invoke` turns the signal into a plain
 * return for the caller — so `runyoself ()` runs on to the `dumpglobal` and the
 * name is destroyed. Measured: `countsix` appears when she is clicked and is
 * gone twenty-five frames later, with `counter` bumped in between. 4 is also one
 * of the six faces of `random (6) -1`, so it would not have been claimable
 * anyway; the reason it is worth writing down is the other one.
 *
 * **Also not claimed.** `dirgo`, for the `dumpglobal` reading above;
 * `attentionspan` 71577 → 100099 and `idlecount` 2 → 1, which are the engine's
 * own frame bookkeeping; and `tumx2`/`tumy2`, the tumbleweed's position under
 * the `kickme` loop's `random`.
 */
export const rung: Segment = {
  from: "D2A_008",
  to: "D2A_009",
  what: "$565 into the bank, and Flippo's news out of Diamondback",
  claims: [
    "playercash", "playeraccount", "tellervalue", "counter",
    "flippophase", "jonesphase", "phase", "theset", "townscene",
    "loopsound", "bouncer",
  ],
  async play(p: Pumped) {
    const sal = set("SALLOWER");
    const town = set("TOWN");
    const bank = set("BANK");
    const paper = set("PAPER");
    const num = (n: string): number => Number(p.session.interp.globals.get(n) ?? 0);
    const str = (n: string): string => String(p.session.interp.globals.get(n) ?? "");
    const at = (id: number): number => (p.session.puppet?.bevels ?? []).findIndex((b) => b.id === id);

    /**
     * Press a plaque by the id its PUP script gave it, and wait on the world.
     *
     * `answer ()` waits for the QUESTION to change, which the teller's does on
     * every press because his plaques quote `playercash` back at you — so it
     * would pass on a press that did nothing. What a press MEANS here is what it
     * does to the money, so each one waits on the arithmetic instead. That also
     * separates two plaque lists that share their numbers: `104` is "Make
     * deposit." in `dodeposit ()` and "What's new?" in `runyoself ()`, and the
     * wait after the press is for the other list's own id to appear.
     */
    const plaque = async (id: number, label: string, done: () => boolean): Promise<void> => {
      await p.pump(() => at(id) >= 0, `the plaque "${label}"`);
      p.session.puppetCtrl.puppetChoose(at(id));
      await p.pump(done, `"${label}" to take`);
    };

    /*
     * ---- 0. finish the walk the save says is already over --------------------
     *
     * `D2A_008` carries her walk slot with `progress` 1941203674 of a `dist` of
     * 30702 and deltas that are the same numbers Jones's and the Mayor's slots
     * carry — a finished slot left in place. Her actor record has her standing on
     * `town.jones6`, (904,2488). This port resumes the slot as if it were live
     * and she leaves the map; see the note above. Done before the first tick, so
     * she never sets off at all.
     */
    ask(p, "stopwalk", ["mwife"]);
    ask(p, "actorstar", ["mwife", "town.jones6"]);

    // ---- 1. out of the saloon, which is also the end of `bouncer` -----------
    await openDoor(p, [144, 7, 387, 264], "salout", "the saloon door", {
      set: sal, x: 3, z: 0, view: "east",
    });
    await p.pump(() => room(p).startsWith("town"), "the street");
    if (p.session.interp.globals.has("bouncer")) {
      throw new Error("Isao was never put down — `bouncer` survived the saloon door");
    }

    // ---- 2. in at the bank — TOWN.SET/0129, cell (6,5) facing west ----------
    await walkTo(p, town, { x: 6, z: 5, view: "west" });
    await openDoor(p, [200, 81, 306, 232], "bank", "the bank door", {
      set: town, x: 6, z: 5, view: "west",
    });
    await p.pump(() => room(p).startsWith("bank"), "the bank");

    // ---- 3. the teller's window — BANK.SET/0045, cell (3,2) facing west -----
    await walkTo(p, bank, { x: 3, z: 2, view: "west" });
    p.fire((176 + 319) / 2, (57 + 213) / 2);
    await p.settle("the teller's window");
    await p.pump(() => num("tellervalue") === 5, "the teller to count us in");

    // ---- 4. $565, in the fewest presses the plaques allow -------------------
    // 109 ("Add $5") exists only inside `dodeposit ()`, so it is what says the
    // deposit panel is really open and not the greeting still being answered
    await plaque(101, "I want to deposit money.", () => at(109) >= 0);
    for (let i = 0; i < 28; i++) {
      const before = num("playercash");
      await plaque(103, "Add $20 to deposit.", () => num("playercash") === before - 20);
    }
    await plaque(109, "Add $5 to deposit.", () => num("playercash") === 200);
    if (num("playeraccount") !== 587) throw new Error(`the account is $${num("playeraccount")}, not $587`);
    // …and the receipt, which is the press that moves `counter` (`depbig ()`).
    // 105 ("Bye.") is `runyoself ()`'s own id, so its arrival IS the return
    await plaque(104, "Make deposit.", () => at(105) >= 0);
    await plaque(105, "Bye.", () => !p.session.puppet);
    if (num("counter") !== 2) throw new Error(`counter ${num("counter")} after the bank, not 2`);

    // ---- 5. out again — BANK.SET/0044, cell (3,1) facing east --------------
    await openDoor(p, [177, 30, 339, 263], "dollar", "the bank door out", {
      set: bank, x: 3, z: 1, view: "east",
    });
    await p.pump(() => room(p).startsWith("town"), "the street again");

    // ---- 6. the Mayor's wife, who has one line and no plaques --------------
    /*
     * She will not stand still, so this asks the engine where she is.
     * `mwifeidle ()` gives her a 6-in-100 chance per pass of strolling between
     * `town.jones5` (1116,1656), cell (4,6), and `town.jones6` (904,2488), cell
     * (3,9) — and `GANG.CST/0001 walktopuppet` refuses outright unless the
     * player and the actor share a cell in x or in y (`if thex != 0 & they != 0
     * exitcode`), so a fixed standpoint answers her half the time and silently
     * does nothing the other half.
     *
     * Not `clickActor` either: that one asks "is a puppet open?" after the
     * click, and her whole exchange — one `puppetspeak` inside `brushoff ()` —
     * opens and closes inside the settle, so it would click her for ever and
     * then call her silent. `counter` is the outcome to wait on, and it is also
     * what tells the brush-off apart from the one-in-three arm above it, which
     * speaks a line and bumps nothing.
     */
    const HER: Record<string, { x: number; z: number }> = {
      "town.jones5": { x: 4, z: 6 },
      "town.jones6": { x: 3, z: 9 },
    };
    const hers = p.session.castScripts.get("mwife");
    if (!hers) throw new Error("no cast script for the Mayor's wife — is gang.cst open?");
    for (let go = 0; go < 10 && num("counter") !== 0; go++) {
      await p.pump(() => Number(ask(p, "iswalk", ["mwife"])) === 0, "the Mayor's wife to stand still");
      const star = ask(p, "actorstar", ["mwife"]).toLowerCase();
      const stand = HER[star];
      if (!stand) throw new Error(`the Mayor's wife is on "${star}", which is neither of her two stars`);
      await walkTo(p, town, { ...stand, view: "east" });
      // she may have strolled off while we crossed the street; ask again
      if (ask(p, "actorstar", ["mwife"]).toLowerCase() !== star) continue;
      void p.session.track(
        p.session.interp.runHandler(hers, "mousedown", ["mwife"], { me: "mwife", target: "mwife" }),
      );
      await p.settle("the Mayor's wife");
      await p.tick(60);
    }
    if (num("counter") !== 0) throw new Error(`counter ${num("counter")} after her brush-off, not 0`);

    // ---- 7. in at the newspaper office — TOWN.SET/0086, cell (3,7) west ----
    await walkTo(p, town, { x: 3, z: 7, view: "west" });
    await openDoor(p, [213, 98, 282, 211], "paper", "the newspaper office door", {
      set: town, x: 3, z: 7, view: "west",
    });
    await p.pump(() => room(p).startsWith("paper"), "the newspaper office");
    if (str("townscene").toLowerCase() !== "scene d8") {
      throw new Error(`townscene is "${str("townscene")}", not "Scene D8"`);
    }

    // ---- 8. "In Diamondback?" — one reply, and the town changes ------------
    await walkTo(p, paper, { x: 1, z: 1, view: "south" }, () => !!p.session.puppet);
    if (!p.session.puppet) await clickActor(p, "flippo", "Flippo at the press");
    await plaque(101, "In Diamondback?", () => num("phase") === 1);
    if (num("flippophase") !== 2) throw new Error(`flippophase ${num("flippophase")}, not 2`);
    if (num("jonesphase") !== 999) throw new Error(`jonesphase ${num("jonesphase")}, not 999`);
    if (str("theset").toLowerCase() !== "town") throw new Error(`theset "${str("theset")}", not "town"`);

    // ---- 9. out, and down the street to where the save was taken ----------
    await openDoor(p, [138, 47, 365, 264], "flipout", "the newspaper office door out", {
      set: paper, x: 1, z: 1, view: "east",
    });
    await p.pump(() => room(p).startsWith("town"), "the street once more");
    await walkTo(p, town, { x: 7, z: 10, view: "west" });
    // TOWN.SET/0137 dayfxs (): the chime is switched off by `phase`, the saloon
    // by the distance, and nothing else is in earshot of Scene H11
    await p.pump(() => str("loopsound") === "", "the street to fall quiet");

    /*
     * ---- 10. Todd, which is the one check on the standpoint itself ----------
     *
     * `TODD.PUP/0048` is `puppetspeak` and nothing else, so his file opens and
     * closes inside one settle and `clickActor`'s "is a puppet open?" never
     * catches it. What his `mousedown` leaves behind is `actorvalue (me,
     * actorvalue (me) + 1)`, and that line is INSIDE the
     * `if realdist (me) < hotdist ()` — so the count going up is the proof the
     * click reached him, which is the proof the route is standing where the save
     * stands.
     */
    const heard = Number(ask(p, "actorvalue", ["todd"]));
    const his = p.session.castScripts.get("todd");
    if (!his) throw new Error("no cast script for Todd — is gang.cst open?");
    void p.session.track(
      p.session.interp.runHandler(his, "mousedown", ["todd"], { me: "todd", target: "todd" }),
    );
    await p.pump(
      () => Number(ask(p, "actorvalue", ["todd"])) === heard + 1,
      "Todd to sing us a verse",
    );
  },
};
