import {
  LEAVING, answer, ask, clickActor, offerInTalk, openDoor, question, room, set,
  takeInHand, talkOut, walkTo, type Segment,
} from "../route";

/**
 * Day 2, afternoon: the Mayor's leave, the flowers on the grave, and back in.
 *
 *   1. `D2A_005` is saved standing outside the saloon at `TOWN` Scene G8 in the
 *      middle of the Mayor's conversation, and a v1 save does not carry an open
 *      puppet — so the rung starts by letting him open his mouth again.
 *      `GANG.CST/1097 mayoridle ()` re-arms `hasattention (6)` for as long as
 *      `mayorphase = 0`, so nothing has to click him; he comes back.
 *      `MAYOR.PUP/0073 twopm ()` then offers two: **"These shops seem out of a
 *      lot of items." (102)** falls into `shop ()`, and `shop ()` is a
 *      `while true` whose only exit is **"Time to go." (555)** — which is also
 *      `mayorphase = 1`. `segment13` and the rung before it walked out of this
 *      with ESC because neither was entitled to the 1; this one is.
 *   2. Jones is one cell away with `actorowner ("JONES") = "message"`.
 *      `JONES.PUP/0069 twopm ()` opens on a single plaque, **"What chores?"
 *      (101)**, and its loop leaves on **"So long." (104)**, which sets
 *      `jonesphase = 1`. (Its other branch — `day2items () >= 3 &
 *      playeraccount > 0` — is the short version for a player who has already
 *      been to the bank; `playeraccount` is 0 here, so this is the long one.)
 *   3. The flowers go in hand BEFORE the knock, not during it.
 *      `INVEN.PRP/0001 addhandbevel ()` only names an item while `handflag = 0`,
 *      and every `addinven ()` sets `handflag = 1`, so the first press of the
 *      offer plaque is the picker rather than the gift — the same shape
 *      `segment11` gives the jug and the pie.
 *   4. The saloon door is `TOWN.SET/0131 pointinsaloon` — 241,92–307,201, facing
 *      west from Scene G8 — and `uparrow` runs `gotointerior ("sallower.set")`,
 *      which is the only writer of **`townscene = "Scene G8"`**
 *      (`NEW.FLT/0001`). **Jones stands in front of it.** `GANG.CST`'s
 *      `walktopuppet` brings him to the player to talk and he walks back to
 *      `town.jones1` at (1624,1872), which is between the standpoint and the
 *      door; a click there is a click on Jones, and `realdist` is well inside
 *      `hotdist ()`, so it opens his file instead of the door. So the route
 *      waits for the doorway to be a doorway again — `hittest` at the middle of
 *      the rectangle answering the scene rather than an actor — which is what a
 *      player does when somebody is standing in the way.
 *   5. Up the stairs: `SALLOWER.SET/0057` is Scene D6, `uparrow` facing west,
 *      `salup.mov`, `gotointerior ("salupper.set")`.
 *   6. Ruby's door, `SALUPPER.SET/0034 pointinruby` (138,2–327,263) facing north
 *      from Scene A1. On day 2 at `clock = 2` with `trotterphase < 2` the knock
 *      does not fetch Ruby at all: it runs `trotter.pup`. `TROTTER.PUP/0076
 *      day2pm ()` at `trotterphase = 0` calls `inruby ()`, and **"Just looking
 *      around.." (101)** returns 0, which is `trotterphase = 1`. Only a
 *      dismissal returns 1 and leaves it at 0 — so `excuseUs` here would strand
 *      the rung.
 *   7. Sophie's door, `SALUPPER.SET/0035 pointindoor` (133,2–376,263) facing
 *      east from Scene A2. `SOPHIE.PUP/0007 gift ()` is what the flowers were
 *      picked up for: `giveinven ("flowers", "none")` and then, only at
 *      `day = 2 & clock = 2`, `setupprop ("grave")` — which is why `D2A_006` has
 *      them back out in the town, visible at `town.flower`, owned by nobody.
 *      Then `SOPHIE.PUP/0034 twopm ()`: **101** (either of its two) runs into
 *      `cobb ()`, and **"Okay, I'll go meet him." (101)** there is
 *      `sophiephase = 1` and `sendtoactor ("cobb", setupactor ("bar"))`. Cobb is
 *      in the bar in `D2A_006`, at `sal.cobb1`, and this is what put him there.
 *   8. The harmonica into the hand. `selhandbevel ()` ends `handitem = ""`, and
 *      the save has `handitem = "Harmonica"` with the prop in view `"large"` at
 *      316,320 — which is `NEW.FLT/0002 openflat ()` redrawing whatever is in
 *      hand when the main panel comes back. Nothing in the corpus wants a
 *      harmonica (`SOPHIE.PUP` would take one, and its owner is still
 *      "stranger"), so this is only the player choosing what to carry next.
 *   9. Down again (`SALUPPER.SET/0037`, Scene A4, `uparrow` facing east) and
 *      Oona, who stands at `sallower.oona`, cell (3,3). `OONA.PUP/0057
 *      twopm ()` leaves on **"So long, Oona." (104)** → `oonaphase = 1`, and 104
 *      is third in `LEAVING`, so `talkOut` reaches for it first.
 *  10. Out of the saloon (`SALLOWER.SET/0052`, Scene D1, `pointinrice`
 *      144,7–387,264, `gototown ("east")`) and straight back in. **The step into
 *      the street is the point.** `TOWN.SET/0131 openscene ()` is
 *
 *          if day = 2 & clock = 2 & trotterphase = 1
 *              trotterphase = 3
 *
 *      and `gototown` lands on `townscene`, which the way in just set to Scene
 *      G8 — so leaving is what makes it 3. `SALLOWER.SET/0001 openset ()` reads
 *      it on the way back: `if day = 2 & clock = 2 & trotterphase = 3 →
 *      sendtoactor ("trotter", setupactor ("bar"))`, and that is Trotter at
 *      `sal.trotter1` in `D2A_006`.
 *
 *      The flowers have to be gone by then. `SALLOWER.SET/0048 openscene ()` —
 *      Scene C3, which is on the way to where this ends — takes `trotterphase`
 *      to **4** if `propowner ("flowers") = "limbo2"`. Sophie's gift makes them
 *      "none", so the order above is what keeps the 3.
 *  11. And stop at `SALLOWER` Scene C4 facing west. That is not an idle spot:
 *      `HOUSE.PRP/0498 mousedown` on the blackjack table is `if realdist (me) <
 *      500`, the table's star is at (384,1152), and the centre of C4 is
 *      (640,896) — 362 away. `D2A_006` is saved sitting down to a hand.
 *
 * **The money is not claimed, and saying why is the point of not claiming it.**
 * `cardstring` in `D2A_006` is one particular 52-card shuffle, and
 * `SALGAMES.FLT/0008` deals off it by index (`findword (cardstring, " ",
 * usedcount)`); `playerdowncard` "ah", `dealerdowncard` "6d", `playerbj` 1 and
 * `usedcount` 5 are the first five cards of that shuffle, `playercash` 7 → 800
 * and `playeraccount` 0 → 22 and `tellervalue` 0 → 4 are what the player did
 * with the winnings, and `fivecount` 5 → 4 is `JAN.PUP/0047 mainbetbj ()`
 * walking its line counter on dealer wins. None of it follows from a route: it
 * follows from a deck this port does not shuffle the same way. So the rung
 * plays up to the moment the original sat down, and stops there.
 *
 * `saveitem`, `targethitcount`, `bottlehitcount` and `canhitcount` are not
 * claimed either, and they are not RESET in `D2A_006` — they are gone from its
 * global table altogether, which is the same `dumpglobal` puzzle `segment12`
 * wrote down at the shooting range. Nothing in this rung goes near the range.
 *
 * `bouncer` and `dirgo` ARE claimed, and they are only Isao's lean:
 * `GANG.CST/0984 isaoidle ()` is a two-tick loop that flips `bouncer` between
 * "stand" and "up" on every call and swings `dirgo` at the ends of a ±20° sweep
 * around 64°. `D2A_006` catches him at 82° facing up with both at 1, so landing
 * on them is landing on a phase, not on a state — which is why the segment ends
 * on a predicate that waits for the sweep to come round rather than on a count
 * of ticks. The `>= 56` guard is margin: the runner's own closing `settle`
 * advances the loop two more steps, and 56 is far enough from the 44° turn that
 * two steps cannot carry `dirgo` past it.
 *
 * `bouncer` needs a second guard, and the sweep's margin is no help with it.
 * Measured, the flip has a period of FOUR ticks — `1 1 0 0` — so where in the
 * pair the pump stops decides what the closing `settle` reads three ticks later:
 * stopping on the first `1` lands on `0`, stopping on the second lands back on
 * `1` (and on `1` again at four ticks, so it is robust to a settle of either
 * length). The predicate therefore waits for the second tick of the pair rather
 * than for the value, which is the difference between landing on a phase and
 * landing on a phase from a known side. Before #352 shortened every move by one
 * tick the pump happened to stop on the second anyway, which is exactly the kind
 * of luck a rung should not be built on.
 */
export const rung: Segment = {
  from: "D2A_005",
  to: "D2A_006",
  what: "the Mayor's leave, the flowers on the grave, and back to the saloon",
  claims: [
    "mayorphase", "jonesphase", "trotterphase", "sophiephase", "oonaphase",
    "bouncer", "dirgo", "handitem", "townscene", "theset",
  ],
  async play(p) {
    const town = set("TOWN");
    const sal = set("SALLOWER");
    const up = set("SALUPPER");
    const num = (n: string): number => Number(p.session.interp.globals.get(n) ?? 0);
    const point = (x: number, y: number): number => Number(ask(p, "makepoint", [x, y]));
    /** is the middle of the saloon door the door, or somebody standing in it? */
    const doorwayClear = (): boolean =>
      ask(p, "hittest", [point(274, 146)]).toLowerCase() ===
      (p.session.currentSceneName() ?? "").toLowerCase();
    const intoTheSaloon = async (what: string): Promise<void> => {
      await walkTo(p, town, { x: 6, z: 7, view: "west" });
      await p.pump(doorwayClear, "the saloon doorway to clear");
      await openDoor(p, [241, 92, 307, 201], "saloon", what, {
        set: town, x: 6, z: 7, view: "west",
      });
      await p.pump(() => room(p).startsWith("sallower"), what);
    };

    // ---- 1. the Mayor, who has to be finished rather than escaped -----------
    await p.pump(() => !!p.session.puppet, "the Mayor to start again");
    await answer(p, 102, "These shops seem out of a lot of items.");
    await answer(p, 555, "Time to go.");
    await p.pump(() => !p.session.puppet, "the Mayor to finish");
    if (num("mayorphase") !== 1) throw new Error(`mayorphase is ${num("mayorphase")}`);

    // ---- 2. Jones, with his message ----------------------------------------
    await clickActor(p, "jones", "Jones in the street");
    await answer(p, 101, "What chores?");
    await answer(p, 104, "So long.");
    await p.pump(() => !p.session.puppet, "Jones to finish");
    if (num("jonesphase") !== 1) throw new Error(`jonesphase is ${num("jonesphase")}`);

    // ---- 3 & 4. the flowers in hand, then in through the saloon door --------
    await takeInHand(p, "Flowers", "the flowers for Sophie");
    await intoTheSaloon("the saloon door");

    // ---- 5. up the stairs ---------------------------------------------------
    await walkTo(p, sal, { x: 3, z: 5, view: "west" });
    await p.press("uparrow", "up the saloon stairs");
    await p.pump(() => room(p).startsWith("salupper"), "the landing");

    // ---- 6. knock at Ruby's door and get Trotter ---------------------------
    await walkTo(p, up, { x: 0, z: 0, view: "north" });
    p.fire((138 + 327) / 2, (2 + 263) / 2);
    await p.settle("Ruby's door");
    await p.pump(() => !!p.session.puppet, "Trotter at Ruby's door");
    await answer(p, 101, "Just looking around..");
    await p.pump(() => !p.session.puppet, "Trotter to finish");
    if (num("trotterphase") !== 1) throw new Error(`trotterphase is ${num("trotterphase")}`);

    // ---- 7. Sophie: the flowers, and Cobb sent down to the bar --------------
    await walkTo(p, up, { x: 0, z: 1, view: "east" });
    p.fire((133 + 376) / 2, (2 + 263) / 2);
    await p.settle("Sophie's door");
    await p.pump(() => !!p.session.puppet, "Sophie");
    await p.pump(() => question(p) !== "", "Sophie to ask something");
    await offerInTalk(p, "Flowers", "the flowers for Sophie");
    if (ask(p, "propowner", ["flowers"]).toLowerCase() !== "none") {
      throw new Error(`the flowers are still ${ask(p, "propowner", ["flowers"])}'s`);
    }
    await answer(p, 101, "Where's my surprise?");
    await answer(p, 101, "Okay, I'll go meet him.");
    await p.pump(() => !p.session.puppet, "Sophie to finish");
    if (num("sophiephase") !== 1) throw new Error(`sophiephase is ${num("sophiephase")}`);
    if (ask(p, "actorstar", ["cobb"]).toLowerCase() !== "sal.cobb1") {
      throw new Error(`Cobb is at ${ask(p, "actorstar", ["cobb"])}, not down in the bar`);
    }

    // ---- 8. the harmonica is what the hand carries out of here --------------
    await takeInHand(p, "Harmonica", "the harmonica");

    // ---- 9. down again, and Oona -------------------------------------------
    await walkTo(p, up, { x: 0, z: 3, view: "east" });
    await p.press("uparrow", "down the saloon stairs");
    await p.pump(() => room(p).startsWith("sallower"), "the bar");
    await walkTo(p, sal, { x: 3, z: 3, view: "north" });
    await clickActor(p, "oona", "Oona at the bar");
    await talkOut(p, LEAVING, "Oona", 2);
    if (num("oonaphase") !== 1) throw new Error(`oonaphase is ${num("oonaphase")}`);

    // ---- 10. out to the street, which is what makes trotterphase 3 ----------
    await openDoor(p, [144, 7, 387, 264], "salout", "the saloon door out", {
      set: sal, x: 3, z: 0, view: "east",
    });
    await p.pump(() => room(p).startsWith("town"), "the street");
    if (num("trotterphase") !== 3) throw new Error(`trotterphase is ${num("trotterphase")}`);

    // ...and straight back in, which is what puts Trotter in the bar
    await intoTheSaloon("the saloon door again");
    if (ask(p, "actorstar", ["trotter"]).toLowerCase() !== "sal.trotter1") {
      throw new Error(`Trotter is at ${ask(p, "actorstar", ["trotter"])}, not in the bar`);
    }

    // ---- 11. and sit down to the blackjack table ---------------------------
    await walkTo(p, sal, { x: 2, z: 3, view: "west" });
    /*
     * Wait for Isao's lean to be where the save caught it. `isaoidle ()` runs
     * every other tick whatever the player does, so `bouncer` and `dirgo` are a
     * phase rather than an outcome; this is the one thing on the rung that has
     * to be waited for rather than done.
     */
    let wasUp = false;
    await p.pump(
      () => {
        // the SECOND tick of the pair, not the first — see the note above
        const up = num("bouncer") === 1;
        const second = up && wasUp;
        wasUp = up;
        return second && num("dirgo") === 1 && Number(ask(p, "actordeg", ["isao"])) >= 56;
      },
      "Isao's lean to come round to where the save caught it",
    );
  },
};
