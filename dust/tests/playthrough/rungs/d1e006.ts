import {
  answer, ask, clickActor, clickThrough, excuseUs, offerInTalk, openDoor, room,
  set, takeInHand, talkOut, walkTo, type Segment,
} from "../route";

/**
 * Day 1, night: Laurel in the lobby, the dollar behind the poster, and out.
 *
 * The first rung of the thread that anyone has written, and the one
 * [`segments.ts`](../segments.ts)'s `segment1` picks up from: it has to hand
 * over the night town with the Mayor's wife mid-stride towards the player,
 * `mwifephase` still 0, and the player standing on NITE Scene D7. Eighty
 * seconds of play, and eight globals.
 *
 * The saves fix the order of most of it. `HOTLOWER.SET/0048 keydown ()` — the
 * stairs — carries `if day = 1 & phase > 4 & phase < 8 → sendtoactor ("blood",
 * putdownactor ())`, and `Blood` goes visible → invisible across the rung, so
 * the stairs were climbed while `phase` was still 5. `HOTUPPER.SET/0045`'s
 * knock on Fear's door is gated on `day = 1 & phase = 5` outright. And `phase`
 * becomes 6 the moment the hotel is left. So everything upstairs happens before
 * the street, and the street is last.
 *
 *   1. **Laurel, in the lobby.** `D1E_005` stands at HOTLOWER Scene B3, cell
 *      (1, 2), and `HOTLOWER.SET/0001 openset ()` put her there for the evening
 *      (`if day = 1 ... if laurelphase < 2 & phase < 7 → setupactor ("hotel")`)
 *      — `hotlower.laurel` is (356, 696), the player's own cell. `LAUREL.PUP`'s
 *      day-1 file is `/0036`, and its `runyoself ()` opens with three replies of
 *      which only **101, "Okay. I'll leave."** sets `laurelgood = 1`; 102 sets 0
 *      and 103 sets -1.
 *   2. **The cigar.** 101 leads into `hardtoget ()`, a `while true` around its
 *      plaques with `sendtoshop ("inven", addhandbevel ())` among them — the
 *      **55555** offer plaque. `D1E_005` has `handitem = "cigar"` and
 *      `handflag = 1`, so the first press opens the inventory panel rather than
 *      gifting (`INVEN.PRP/0001 selhandbevel ()`), which is what `offerInTalk`
 *      is for. The gift itself is `LAUREL.PUP/0007 gift ()`'s `if what =
 *      "cigar"` arm: two lines and `giveinven ("cigar", "laurel")`, which is the
 *      save's `Cigar: stranger → laurel`.
 *
 *      `hardtoget ()`'s own **101** ("So he gave you your good looks?") sets
 *      `laurelgood = -1`, so the reply that was right at the first question is
 *      the wrong one at the second. This answers by id, never by position.
 *   3. **The knife.** `hardtoget ()`'s leaving line is **104, "I'm going..."**,
 *      which calls `bowiebyes ()`; its single reply **101, "Goodbye."** is where
 *      the rung's remaining two facts come from:
 *
 *          if laurelgood > 0
 *              ... sendtoshop ("inven", addinven ("bknife"))
 *          endif
 *          laurelphase = 1
 *
 *      So `BKnife: none → stranger` is not a pickup off a table — it is what
 *      being polite to her buys, and it is unreachable from 102 or 103.
 *   4. **The dollar behind the poster.** `playercash 772 → 776` is four dollars
 *      GAINED, and `HOTLOWER.SET/0044 mousedown ()` is the only `playercash =
 *      playercash + 4` in the corpus: Scene C3, cell (2, 2), facing south,
 *      `pointinpost` (119,188-293,253), `spotmovie ("dollar.mov")`, and then
 *
 *          if actionframe (1)
 *              playercash = playercash + 4
 *              propowner ("shootingstar", "got money")
 *          endif
 *
 *      — which is why `shootingstar` ends up owned by "got money" for a prop
 *      that is a shooting star in the night sky. The owner field is being used
 *      as a spent flag: `pointinpost` opens `if propowner ("shootingstar") !=
 *      "none" return false`, so the poster pays exactly once.
 *
 *      **The film has to be played, not merely started.** `dollar.mov` is five
 *      frames and two of them wait for a click, each offering a small box and
 *      the whole rest of the picture: frame 1's box is 179,123-317,185 → target
 *      2, frame 2's is 164,128-262,193 → target 3, and in both cases everything
 *      outside the box jumps to target 4 — the last frame, the hand withdrawing
 *      empty. The action frame is only on the path through both boxes. The point
 *      clicked below, 213,160, is inside both.
 *   5. **Upstairs.** Scene D3, cell (3, 2), facing north; `HOTLOWER.SET/0048
 *      keydown ()` answers a bare `uparrow` with `hotup.mov` and
 *      `gotointerior ("hotupper.set")`. `NEW.FLT/0001 gotointerior ()` is
 *      `gotospecial (setname, "", "")` — no scene and no facing — so the landing
 *      opens wherever the set file's own standpoint is, which is Scene D1,
 *      cell (3, 0), facing north.
 *   6. **Buick's door.** `HOTUPPER.SET/0042` is Scene C1, cell (2, 0), and both
 *      its `keydown ()` and its knock on the rice-paper door run `dobuick ()`
 *      under the same day-1 test — `if actorvalue ("buick") != phase &
 *      buickphase < 3`. `D1E_005` has `actorvalue ("buick") = 0` against
 *      `phase = 5`, so it is open. The knock is used rather than the keypress
 *      because a click is aimed and a keypress is whichever key the route
 *      happened to need next; the guard below covers the case where walking onto
 *      the cell has already set him off.
 *
 *      `dobuick ()` turns the camera west and runs `buick.pup`.
 *      `BUICK.PUP/0016 runyoself ()` — the day-1 file — is a switch on
 *      `buickphase` whose case 0 is `firstencounter ()` followed by
 *      `buickphase = 1`, which is the whole of the save's `buickphase 0 → 1`.
 *      `firstencounter ()` is a `while true` around "Huh?", "Where are you
 *      from?", "Do you live here?" and "You speak funny.", and its only exit is
 *      **104, "I should leave..."** — the others speak a line and come round
 *      again, or descend into `fromfrance ()` and `livehere ()`, which are the
 *      same shape.
 *   7. **Fear's door, and `fearphase`.** `HOTUPPER.SET/0045` is Scene C4, cell
 *      (2, 3); `pointinrice` (168,50-329,263) facing west, and `lockrice ()`
 *      returns false outright while `day = 1 & phase = 5`. The handler's first
 *      arm is
 *
 *          if fearphase < 3
 *              playone ("fear.44")  playone ("fear.45")  fearphase = 3
 *
 *      — two lines through a shut door, nobody visible, no conversation to
 *      answer. So the outcome asked for is `fearphase` itself and not a puppet.
 *   8. **Down, and out.** HOTUPPER Scene D1 facing south, `/0046 keydown ()`
 *      (`hotdn.mov`, `gotospecial ("hotlower.set", "scene d3", "south")`), then
 *      HOTLOWER Scene A1, cell (0, 0), facing west: `/0034`'s `pointindoor`
 *      (128,73-394,262) sets the `door` prop to "hotout" and the `uparrow` after
 *      it is `gototown (currentview ())`. `NEW.FLT/0001 gototown ()` at
 *      `clock = 3` is `gotospecial ("nite.set", townscene, dirname)` — **the
 *      evening town is `nite.set`, not `town.set`** — and `D1E_005` carries
 *      `townscene = "scene g5"`, so the street is entered at NITE Scene G5,
 *      cell (6, 4), facing west.
 *   9. **`phase = 6` is the street's, not the player's.** `NITE.SET/0128` is
 *      that cell, and its `openscene ()` opens `if day = 1 ... if phase = 5 →
 *      phase = 6`. Nothing is clicked for it; stepping out of the hotel is the
 *      whole of it. (The same handler's next arm is `if phase = 7 &
 *      currentview () = "west" → phase = 8` and the street fight, which is two
 *      rungs away and not reachable from 6.)
 *  10. **The cards back in hand.** `INVEN.PRP/0001 addinven ()` ends
 *      `handitem = newitem`, so the knife was in hand from step 3 onwards; the
 *      save says `handitem = "Cards"`, spelled the way the prop is spelled,
 *      which is what `stdmouse ()` writes when an inventory prop is clicked on
 *      the panel (`handitem = what`). `Cards` was already owned at `D1E_005`, so
 *      this is a pick-up in the panel and nothing else.
 *  11. **Across the town to Scene D7.** Cell (3, 6), facing west. `D1E_006` has
 *      the Mayor's wife at (831, 1665) — that same cell, mid-stride, on
 *      `walkonpath` — which is `segment1`'s opening premise, so this rung must
 *      arrive there without having talked to her. The walk therefore stops on a
 *      puppet rather than letting `walkTo` answer one: her `MWIFE.PUP/0073
 *      firststreet ()` has a **103** that sets `mwifephase = 1` and a **101**
 *      that leads into `dinner ()` and the Mayor's house, and `LEAVING` would
 *      reach for 101. `puppetevent (-1)`'s own `case -1` is a bare `exitcode`
 *      that touches nothing, so ESC is the only safe answer, and `excuseUs` is
 *      it. On the seeded run she has not arrived by the time the walk ends and
 *      the guard never fires; it is there because her not arriving is a fact
 *      about timing rather than about the scripts.
 *
 * **Not claimed: `idlecount` (3 → 1) and `starcount` (7 → 2).** Neither is a
 * consequence of a route. `idlecount` is `BOOTFILE/0001 idle ()`'s mod-4
 * counter, stepped once per idle pass forever. `starcount` is
 * `HOUSE.PRP/0002 movestar ()`'s, the shooting star crossing the night sky on a
 * prop loop — it counts to 6, hides the star and re-seeds itself from
 * `random ()`. Both say how many service passes the original spent, not what it
 * did.
 */
export const rung: Segment = {
  from: "D1E_005",
  to: "D1E_006",
  what: "Laurel in the lobby, the dollar behind the poster, and out into the night",
  claims: [
    "laurelgood", "laurelphase", "buickphase", "fearphase", "phase",
    "playercash", "handitem",
  ],
  async play(p) {
    const hotlower = set("HOTLOWER");
    const hotupper = set("HOTUPPER");
    const nite = set("NITE");
    const num = (name: string): number => Number(p.session.interp.globals.get(name) ?? 0);
    const owner = (prop: string): string => ask(p, "propowner", [prop]).toLowerCase();
    const talking = (): boolean => !!p.session.puppet;

    // ---- 1-3. Laurel, the cigar, and the knife ------------------------------
    // she is standing on the player's own cell, so there is nothing to walk to:
    // both of `GANG.CST/0001`'s gates — `realdist (me) < hotdist ()` and
    // `walktopuppet ()`'s `if thex != 0 & they != 0 exitcode` — are open at zero
    await clickActor(p, "laurel", "Laurel's conversation to open");
    await answer(p, 101, "Okay. I'll leave.");
    if (num("laurelgood") !== 1) throw new Error(`laurelgood is ${num("laurelgood")} after her first question`);
    await p.pump(
      () => (p.session.puppet?.bevels ?? []).some((b) => b.id === 55555),
      "the offer plaque in hardtoget ()",
    );
    await offerInTalk(p, "cigar", "the cigar to Laurel");
    if (owner("Cigar") !== "laurel") throw new Error(`the cigar went to "${owner("Cigar")}"`);
    await answer(p, 104, "I'm going...");
    await answer(p, 101, "Goodbye.");
    await p.pump(() => !talking(), "Laurel to finish");
    if (owner("BKnife") !== "stranger") throw new Error(`the knife is "${owner("BKnife")}", not ours`);
    if (num("laurelphase") !== 1) throw new Error(`laurelphase is ${num("laurelphase")} after bowiebyes ()`);

    // ---- 4. the dollar behind the poster ------------------------------------
    await walkTo(p, hotlower, { x: 2, z: 2, view: "south" });
    await clickThrough(
      p,
      () => p.fire((119 + 293) / 2, (188 + 253) / 2),
      () => owner("shootingstar") === "got money",
      "the dollar behind the poster",
      { x: 213, y: 160 }, // inside the small box on BOTH of the film's two waits
    );
    if (num("playercash") !== 776) throw new Error(`playercash is ${num("playercash")}, not 776`);

    // ---- 5. upstairs --------------------------------------------------------
    await walkTo(p, hotlower, { x: 3, z: 2, view: "north" });
    await p.press("uparrow", "up to the landing");
    await p.pump(() => room(p).startsWith("hotupper"), "the landing");

    // ---- 6. Buick's door ----------------------------------------------------
    // stop on a puppet: walking onto his cell can set him off before the knock,
    // and `firstencounter ()` is answered by id below rather than by LEAVING
    await walkTo(p, hotupper, { x: 2, z: 0, view: "west" }, talking);
    if (!talking()) {
      p.fire((173 + 336) / 2, (50 + 264) / 2); // HOTUPPER/0042 pointinrice
      await p.settle("the knock on Buick's door");
    }
    await talkOut(p, [104], "Buick's first encounter");
    if (num("buickphase") !== 1) throw new Error(`buickphase is ${num("buickphase")} after him`);

    // ---- 7. Fear's door -----------------------------------------------------
    await walkTo(p, hotupper, { x: 2, z: 3, view: "west" });
    p.fire((168 + 329) / 2, (50 + 263) / 2); // HOTUPPER/0045 pointinrice
    await p.pump(() => num("fearphase") >= 3, "Fear to answer through the door");

    // ---- 8. down the stairs and out into the night --------------------------
    await walkTo(p, hotupper, { x: 3, z: 0, view: "south" });
    await p.press("uparrow", "down to the lobby");
    await p.pump(() => room(p).startsWith("hotlower"), "the lobby");
    await openDoor(p, [128, 73, 394, 262], "hotout", "the hotel door", {
      set: hotlower, x: 0, z: 0, view: "west",
    });
    await p.pump(() => room(p).startsWith("nite"), "the night town");

    // ---- 9. which is where phase becomes 6 ----------------------------------
    if (num("phase") !== 6) throw new Error(`phase is ${num("phase")} out on Scene G5`);

    // ---- 10. the cards back in hand -----------------------------------------
    await takeInHand(p, "Cards", "the cards back in hand");

    // ---- 11. across to Scene D7, without talking to the Mayor's wife --------
    await walkTo(p, nite, { x: 3, z: 6, view: "west" }, talking);
    if (talking()) {
      // ESC is puppetevent (-1), whose case -1 in firststreet () is a bare
      // exitcode — the only answer that leaves mwifephase at 0 for segment1
      await excuseUs(p, "whoever stopped us in the street");
      await walkTo(p, nite, { x: 3, z: 6, view: "west" }, talking);
    }
    if (num("mwifephase") !== 0) {
      throw new Error(`mwifephase is ${num("mwifephase")} — segment1 needs 0`);
    }
  },
};
