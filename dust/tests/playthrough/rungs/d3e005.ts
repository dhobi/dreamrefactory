import { answer, ask, clickActor, clickThrough, meet, openDoor, room, set, talkOut, walkTo, type Segment } from "../route";

/**
 * Day 3, night: the saloon, the jail, the church bell, and Buick's dollar.
 *
 * `D3E_004` is saved in the hotel room and `D3E_005` is saved in the hotel room,
 * facing the same way, so everything in between is a round trip — and the thing
 * that makes it a circuit rather than a list of errands is one function.
 * `NEW.FLT/0001` is
 *
 *     code day3bedtime ()
 *         if propowner ("tbird") = "stranger" & propowner ("tstone") = "stranger" & phase > 3
 *             return true
 *
 * Both of those props have been the player's since the poker table and the bank
 * safe, so on this rung `day3bedtime ()` is exactly `phase > 3`. Three of the
 * things this rung is made of are gated on it — Buick's door, Blood's door and
 * the bed — and `phase` becomes 4 in exactly one place in the corpus at day 3
 * night: `SALLOWER.SET/0001 openset ()`. So the saloon has to come before the
 * hotel. The jail and the bell are free to be anywhere in between.
 *
 *  1. **Out of the room.** `HOTROOM.SET/0036` is Scene B1 facing east,
 *     `pointinrice` 176,62–339,263, door prop "inside", `keydown` →
 *     `gotospecial ("hotupper.set", savescene, savedir)`, which `D3E_004` holds
 *     at **Scene C4** and **"east"**. That is Blood's door and its `openscene ()`
 *     is step 12's — it does nothing on the way out because `phase` is 3. The
 *     same is true of Buick's door at Scene C1 (`HOTUPPER.SET/0042 keydown`),
 *     which the landing corridor has to be walked through twice.
 *  2. **Down, and out.** `HOTUPPER.SET/0046` is Scene D1 facing south: `uparrow`
 *     → `hotdn.mov` → `gotospecial ("hotlower.set", "scene d3", "south")`. Then
 *     `HOTLOWER.SET/0034`, Scene A1 facing west, `pointindoor` 128,73–394,262,
 *     door prop "hotout", `uparrow` → `gototown (currentview ())`. At `clock = 3`
 *     that is `nite.set` (`NEW.FLT/0001 gototown ()`), landing on `townscene`,
 *     which `D3E_004` holds at Scene G5.
 *  3. **The saloon, which is where `phase` turns over.** `NITE.SET/0131` is
 *     Scene G8, `pointinsaloon` 241,92–307,201 facing west, door prop "saloon",
 *     and `locksaloon ()` is false because `fighton` is 0 — Trotter called the
 *     fight off at the end of the last rung. Its `keydown` is the only writer of
 *     `saloonphase` in the corpus, `saloonphase = saloonphase + 1` wrapping past
 *     2 to 0, so the save's **0 → 1** is this one step through this one door and
 *     is the only evidence in the globals that the evening left the hotel at all.
 *
 *     `SALLOWER.SET/0001 openset ()` is the rest of it:
 *
 *         if day = 3 & clock = 3
 *             if phase = 3
 *                 phase = 4
 *                 sendtoactor ("trotter", putdownactor ())
 *                 sendtoactor ("horse1", putdownactor ())
 *                 ... bounty1 .. bounty4 ...
 *                 sendtoactor ("oona", setupactor ("gus"))
 *
 *     That is `phase 3 → 4`. It is also the save's Trotter and horse1 going
 *     invisible with their loops stopped: `D3E_004`'s `loops` carries
 *     `trotteridle` and horse1's `head`, and `D3E_005`'s carries neither.
 *  4. **Oona.** `GANG.CST/0851 mousedown` is `realdist (me) < hotdist ()` and
 *     nothing else — no `walktopuppet` — so walking onto her cell is the whole
 *     of getting to her. `OONA.PUP/0095` at `clock = 3` is `threenite ()`, a
 *     `while true` around its plaques: **101**, **104** (offered because
 *     `oonakidstory` is 1), and **"Bye, Oona." (103)**, which is the only arm
 *     that sets `oonaphase = 1` and exits. Its **102** is not offered at all —
 *     that plaque wants `phase < 2`, and step 3 has just made `phase` 4.
 *  5. **Out again.** `SALLOWER.SET/0052` is Scene D1 facing east, `pointinrice`
 *     144,7–387,264, door prop "salout", `uparrow` → `gototown ("east")` — back
 *     onto Scene G8, because `gotointerior ()` wrote `townscene` on the way in.
 *  6. **The jail.** `NITE.SET/0135` is Scene G12, `pointinjail` 122,77–218,230
 *     facing west, door prop "jail"; `lockjail ()` is false on day 3 with
 *     `fighton = 0`. `JAIL.SET/0001 openset ()` is
 *     `if actorowner ("dell") = "jail" → sendtoactor ("dell", setupactor
 *     ("jail"))`, and `D3E_004` has Dell owned by "jail" and set to "jail": he
 *     has been locked up since day 2, which is why this errand is a door and not
 *     a search.
 *  7. **Dell.** `GANG.CST/0895 mousedown` off the town is `runpuppet
 *     ("dell2.pup")` — again no walk — and `DELL2.PUP/0081` at `clock = 3` is
 *     five `puppetspeak` lines and `dellphase = 1`. There is not one plaque in
 *     it, so nothing about it can be watched by asking whether a conversation is
 *     open: `clickActor` is given the phase as its `until`. Out by
 *     `JAIL.SET/0034`, Scene A1 facing west, `pointindoor` 183,34–361,263, door
 *     prop "lock", `uparrow` → `gototown ("east")`.
 *  8. **The bell, which is the only thing that puts Marie anywhere tonight.**
 *     `GANG.CST/0001 initactors ()` sets up nobody but Jackalope and Laurel at
 *     `day = 3 & clock = 3`, and the gunfight's `initactor ()` sweep had put
 *     Marie down. The one line in the corpus that brings her back is
 *     `NITE.SET/0097`, Scene E4, `pointinsign` 167,3–432,107 facing north:
 *
 *         sendtostage (spotmovie ("nitebell.mov"))
 *         if day = 3 & clock = 3 & mariephase = 0 & fighton = 0
 *             sendtoactor ("marie", setupactor ("cem"))
 *
 *     **`nitebell.mov` is a puzzle film rather than a cutscene**, of the
 *     `getcards.mov` kind: 65 frames, no frame that falls through, and four
 *     regions on the one it waits at. Three are the bell rope — 81,0–227,186,
 *     228,0–376,194 and 369,1–464,148, targets 3, 23 and 44, one sound each —
 *     and the fourth is the whole picture, 0,1–510,264, target **65**, which is
 *     the last frame. Left alone it waits forever, and the `setupactor ()` after
 *     it never runs; a click below the rope boxes takes the exit. (Measured off
 *     `p.v().movieRegions`, the same way `rungs/d3m004.ts` reads `keys.mov`.)
 *  9. **Marie at the graves.** `setupactor ("cem")` (`GANG.CST/1343`) puts her at
 *     `town.cem1`, (334,910) — cell (1,3), a built cell nobody can stand in. Her
 *     `mousedown` there is
 *
 *         if actorstar (me) = "town.cem1"
 *             if mariephase = 0
 *                 moveactor ("town.cem2")
 *
 *     which is *before* any distance test, the same shape as Jackalope's in
 *     `rungs/d3e002.ts`; and her `endwalk` at `town.cem2` is the real gate:
 *     `if currentscene () = "scene c5" → runpuppet ("marie.pup")`. `town.cem2` is
 *     (590,1156), which is cell (2,4), which is Scene C5 — and Scene C5's only
 *     walkable neighbour is Scene D5, so there is exactly one way to be standing
 *     where she is walking to. The route takes that standpoint and clicks her
 *     from it.
 *
 *     `MARIE.PUP/0060` at `clock = 3` is `threenite ()`: **101**, then **111**
 *     ("Perhaps." and "No." are both 111), into `treasure ()`. **`treasure ()`
 *     ends on a fork and one arm of it is death** — **109**, "Yes, let's join
 *     forces.", is `playerdeath = "by marie"`; **111**, "No, I know your plans.",
 *     is `mariephase = 1`. Neither number is in `LEAVING`, so a `talkOut` here
 *     would find nothing it wanted, ESC out on `case -1`, and leave `mariephase`
 *     at 0. This one is answered by id, every time.
 * 10. **Back to the hotel.** `NITE.SET/0128` is Scene G5, `pointinhotel`
 *     200,91–305,203 facing east, door prop "hotel", `uparrow` →
 *     `gotointerior ("hotlower.set")` — and that call rewrites
 *     `townscene = currentscene ()`. The saloon set it to Scene G8 and the jail
 *     to Scene G12 on the way round, so the save's **"Scene G5"** is a statement
 *     about which interior was entered last, which is why it is claimed.
 *     `HOTLOWER.SET/0001 openset ()` at `day = 3` sets Fear up at the desk, and
 *     `stdactor ()` (`GANG.CST/0001`) opens `theset = actorset (who)` — so
 *     **`theset`** comes back to "hotlower" after having been "sallower", "jail"
 *     and "town" over the course of the circuit.
 * 11. **Buick, and the dollar.** `HOTUPPER.SET/0042` is Scene C1, and both of its
 *     ways in carry the same guard:
 *     `if day = 3 & clock = 3 & buickphase < 2 & sendtostagefx (day3bedtime ())`
 *     → `dobuick ()`, on `keydown` for any key pressed while standing there and
 *     on `mousedown` inside `pointinrice` 173,50–336,264 facing west. (Its other
 *     day-3 arm, `buickphase = 0 & propowner ("tstone") != "stranger"`, cannot
 *     fire: the Tstone came out of the bank safe last rung.) `dobuick ()` turns
 *     the player west, opens the door prop and runs `buick.pup` — the file
 *     `D3E_005` is saved with open.
 *
 *     `BUICK.PUP/0053` at `clock = 3` skips `bankhint ()` for the same reason
 *     the keydown's second arm is dead, and runs `threenite ()`: three worded
 *     plaques all numbered **101**, then **"Tell me what?" (103)**, then the pair
 *     the dollar is in —
 *
 *         puppetbevel ("Perhaps a few days in jail...", 103)
 *         if playercash < 1
 *             puppetbevel ("I don't have a dollar...", 103)
 *         else
 *             puppetbevel ("All right, here's a dollar...", 104)
 *             playercash = playercash -1
 *         endif
 *
 *     **The dollar is spent when the plaque is built, not when it is chosen.**
 *     `playercash = playercash - 1` sits inside the `else`, above the
 *     `puppetevent` that asks — so the save's `playercash 168 → 167` is a
 *     consequence of being offered the choice, and 103 reaches `buickphase = 2`
 *     by a longer road ("That's ears...", **104**) having already paid. The route
 *     answers 104.
 *
 *     Both of those plaque lists offer a 103, which is why the replies here go
 *     through `answer`'s `answered` argument: an answered list stays framed until
 *     the script clears it, so "there is a 103 on screen" is not "there is a new
 *     question on screen".
 * 12. **Blood's door, overheard.** `HOTUPPER.SET/0045` is Scene C4:
 *
 *         if day = 3 & clock = 3
 *             if sendtostagefx (day3bedtime ()) & currentview () = "east" & bloodphase = 0
 *                 sendtoflat (currentflat (), listen ())
 *                 sendtocast ("gang", rungossip ("mayorbld.snd"))
 *                 sendtoflat (currentflat (), noface ())
 *                 bloodphase = 1
 *
 *     This is the standpoint the rung STARTED from, and it did nothing then
 *     because `phase` was 3; the saloon is what armed it. `openscene ()` fires on
 *     a turn as well as a step, so the route walks to Scene C4 and turns east.
 *     `rungossip ()` (`GANG.CST/0001`) opens the track file and plays every sound
 *     in it in order, which is why **`mayorbld.snd` is one of the six files open
 *     in `D3E_005`** and why the order of the save's file list — hotlower.set,
 *     hotupper.set, buick.pup, mayorbld.snd, hotroom.set — is the order of steps
 *     10 to 13.
 * 13. **Bed.** Same scene, facing west: `pointinrice` 168,50–329,263,
 *     `lockrice ()` false because `propowner ("hrkey") = "stranger"`, and the
 *     `mousedown` does `addinven ("hrkey")` before it sets the door prop — the
 *     key comes back up into the hand, which is the save's **`handitem`**. The
 *     `keydown` writes `savescene`/`savedir` and `gotointerior ("hotroom.set")`.
 *     `HOTROOM.SET/0034`'s `cansleep ()` is now true and `sleep ()` is the next
 *     rung's business.
 *
 * **Not claimed**, and why.
 *
 *   - **Where Oona ends up — which is what the save says about how many times
 *     the original was in that saloon.** `setupactor ("gus")` puts her at
 *     `sal.trotter1`, (576,648), `actordeg 0`; `setupactor ("bar")`, which the
 *     same `openset ()` gives her on EVERY entry at `clock > 1`, puts her at
 *     `sallower.oona`, (964,900), `actordeg 128`. `D3E_005` records (964,900) and
 *     128, so the last `openset ()` the original ran in that room found `phase`
 *     already 4 — it went in more than once, and only one of those entries was
 *     through the front door, because `saloonphase` counts front doors and reads
 *     1. Of the two doors that do not count, the back door (`NITE.SET/0088`) can
 *     be ruled out: it runs `addinven ("hhkey")`, and `D3E_005`'s HHKey is still
 *     `propview "panel"` at 80,103 rather than "large" at 316,320. That leaves
 *     the stairs to `salupper` (`SALLOWER.SET/0057` Scene D6 facing west, back
 *     down by `SALUPPER.SET/0037`), which are ungated on day 3 night and leave no
 *     other trace at all. Nothing on this route or in these claims turns on it,
 *     so the rung goes in once and Oona ends at "gus".
 *   - **`counter` (0 → 1).** `rtdthread.ts` files it as bookkeeping and it is:
 *     a scratch counter, and three of the brush-offs this circuit can walk into
 *     cycle it — `DELL2.PUP/0074 brushoff ()`, `FEAR.PUP`'s and
 *     `BLOOD.PUP/0062`'s. Somebody said hello to the original twice; nobody did
 *     here.
 *   - **`dirgo`** (absent → 0), which is a fresh data point for the `dumpglobal`
 *     question `docs/engine/scripting-language.md` keeps a table of.
 *     `GANG.CST/0984` is Isao, and his `putdownactor ()` opens
 *     `dumpglobal bouncer, dirgo`; `SALLOWER.SET/0001 closeset ()` calls it on
 *     the way out of the bar. `D3E_004` has neither name; `D3E_005` has
 *     `dirgo = 0` and no `bouncer`. That is the shipped engine destroying the
 *     FIRST name of the list and leaving the second declared — the reading eight
 *     other teardowns support. This port destroys both, so after this run neither
 *     name is in the table, and the difference is not the route's.
 *
 * And one number that is not a claim but reads as a check on step 9: `D3E_005`
 * has Marie at (619,1152) on `walkonpath`, and this run leaves her at
 * (584,1152). `town.cem2` is (590,1156), and `endwalk` there runs the puppet and
 * then `moveactor ("town.cem1")` — so both runs closed the town a few frames
 * into the same walk away from the same spot.
 */
export const rung: Segment = {
  from: "D3E_004",
  to: "D3E_005",
  what: "the saloon, the jail, the church bell and Buick's dollar",
  claims: [
    "phase", "saloonphase", "oonaphase", "dellphase", "mariephase",
    "buickphase", "bloodphase", "playercash", "theset", "townscene", "handitem",
  ],
  async play(p) {
    const hotroom = set("HOTROOM");
    const hotupper = set("HOTUPPER");
    const hotlower = set("HOTLOWER");
    const nite = set("NITE");
    const sallower = set("SALLOWER");
    const jail = set("JAIL");
    const num = (name: string): number => Number(p.session.interp.globals.get(name) ?? 0);
    const star = (who: string): string => ask(p, "actorstar", [who]).toLowerCase();

    // ---- 1. out of the room -----------------------------------------------
    await walkTo(p, hotroom, { x: 1, z: 0, view: "east" });
    await openDoor(p, [176, 62, 339, 263], "inside", "the room door", {
      set: hotroom, x: 1, z: 0, view: "east",
    });
    await p.pump(() => room(p) === "hotupper", "the hotel landing");

    // ---- 2. down the landing, down the stairs, out of the hotel -------------
    await walkTo(p, hotupper, { x: 3, z: 0, view: "south" });
    await p.press("uparrow", "down the hotel stairs");
    await p.pump(() => room(p) === "hotlower", "the hotel lobby");
    await openDoor(p, [128, 73, 394, 262], "hotout", "the hotel's front door", {
      set: hotlower, x: 0, z: 0, view: "west",
    });
    await p.pump(() => room(p) === "nite", "the night street");

    /*
     * ---- 3. the saloon, which is what turns the evening over --------------
     *
     * The step through this door is both halves of it: the `keydown` that
     * counts `saloonphase`, and the `openset ()` on the far side that reads
     * `phase = 3` and makes it 4. Everything gated on `day3bedtime ()` — Buick,
     * Blood, the bed — is downstream of this one press.
     */
    await openDoor(p, [241, 92, 307, 201], "saloon", "the saloon door", {
      set: nite, x: 6, z: 7, view: "west",
    });
    await p.pump(() => room(p) === "sallower", "the bar");
    await p.pump(() => num("phase") === 4, "the saloon's openset to turn the evening over");
    if (num("saloonphase") !== 1) throw new Error(`saloonphase is ${num("saloonphase")}`);

    // ---- 4. Oona ------------------------------------------------------------
    await meet(p, sallower, "oona", "Oona on the saloon floor");
    await talkOut(p, [103], "Oona on the saloon floor");
    if (num("oonaphase") !== 1) throw new Error(`oonaphase is ${num("oonaphase")}`);

    // ---- 5. out again -------------------------------------------------------
    await openDoor(p, [144, 7, 387, 264], "salout", "the saloon's front door", {
      set: sallower, x: 3, z: 0, view: "east",
    });
    await p.pump(() => room(p) === "nite", "the street outside the saloon");

    // ---- 6-7. the jail, and Dell -------------------------------------------
    await openDoor(p, [122, 77, 218, 230], "jail", "the jail door", {
      set: nite, x: 6, z: 11, view: "west",
    });
    await p.pump(() => room(p) === "jail", "the jail");
    /*
     * Dell's cell, Scene C1, is a built cell; Scene B1 is the walkable one next
     * to it and `realdist` from its centre to `jail.dell1` is about 204, inside
     * the 384 `hotdist ()` answers in the jail (`GANG.CST/0001`).
     */
    await walkTo(p, jail, { x: 1, z: 0, view: "east" });
    await clickActor(p, "dell", "Dell in his cell", 20, () => num("dellphase") === 1);
    await p.pump(() => num("dellphase") === 1 && !p.session.puppet, "Dell to finish");
    await openDoor(p, [183, 34, 361, 263], "lock", "the jail's door out", {
      set: jail, x: 0, z: 0, view: "west",
    });
    await p.pump(() => room(p) === "nite", "the street outside the jail");

    /*
     * ---- 8. the bell ------------------------------------------------------
     *
     * `nitebell.mov` waits at a frame with four regions, and only one of them
     * is an exit: target 65, the whole picture, 0,1–510,264. The three rope
     * boxes above it all stop at y = 194, so 256,230 is inside the exit and
     * inside nothing else. Nothing after the film runs until it ends, and the
     * `setupactor ("cem")` that brings Marie out is after the film.
     */
    await walkTo(p, nite, { x: 4, z: 3, view: "north" });
    await clickThrough(
      p,
      () => p.fire((167 + 432) / 2, (3 + 107) / 2), // pointinsign, the bell
      () => star("marie") === "town.cem1",
      "the church bell",
      { x: 256, y: 230 },
    );

    /*
     * ---- 9. Marie at the graves -------------------------------------------
     *
     * Scene C5 first and the click second: her `endwalk` at `town.cem2` only
     * runs the puppet `if currentscene () = "scene c5"`, and cell (2,4) is that
     * scene. The click itself is answered from any distance — `mousedown`'s
     * `town.cem1` arm is above the `realdist` test — so what it is waited on is
     * her leaving the star, not a conversation opening.
     */
    await walkTo(p, nite, { x: 2, z: 4, view: "west" }, () => !!p.session.puppet);
    await clickActor(
      p, "marie", "Marie at the cemetery gate", 20,
      () => star("marie") !== "town.cem1" || !!p.session.puppet, false,
    );
    await p.pump(() => !!p.session.puppet, "Marie to reach the graves");
    // by id, all three: `treasure ()`'s other reply, 109, is `playerdeath`
    let said = await answer(p, 101, "Why did you need to see me?");
    said = await answer(p, 111, "Perhaps.", said);
    await answer(p, 111, "No, I know your plans.", said);
    await p.pump(() => num("mariephase") === 1 && !p.session.puppet, "Marie to finish");

    // ---- 10. back to the hotel ---------------------------------------------
    await openDoor(p, [200, 91, 305, 203], "hotel", "the hotel door", {
      set: nite, x: 6, z: 4, view: "east",
    });
    await p.pump(() => room(p) === "hotlower", "the hotel lobby");
    await p.pump(
      () => String(p.session.interp.globals.get("theset") ?? "").toLowerCase() === "hotlower",
      "Fear to be set up at the desk",
    );
    await walkTo(p, hotlower, { x: 3, z: 2, view: "north" });
    await p.press("uparrow", "up the hotel stairs");
    await p.pump(() => room(p) === "hotupper", "the hotel landing");

    /*
     * ---- 11. Buick's door, and the dollar ---------------------------------
     *
     * The guard is the same on `keydown` and on `mousedown`, so the last press
     * of the walk onto Scene C1 may already have been the one that answered it.
     * If it was not, the door is knocked on instead: `pointinrice` facing west,
     * which is the way `dobuick ()` turns the player anyway.
     */
    await walkTo(p, hotupper, { x: 2, z: 0, view: "west" }, () => !!p.session.puppet);
    if (!p.session.puppet) p.fire((173 + 336) / 2, (50 + 264) / 2);
    await p.pump(() => !!p.session.puppet, "Buick to open his door");
    let asked = await answer(p, 101, "Shut up, Riviera.");
    asked = await answer(p, 103, "Tell me what?", asked);
    await answer(p, 104, "All right, here's a dollar...", asked);
    await p.pump(() => num("buickphase") === 2, "Buick to take the dollar");
    await p.pump(() => !p.session.puppet, "Buick to finish");
    if (num("playercash") !== 167) throw new Error(`playercash is ${num("playercash")}`);

    /*
     * ---- 12. Blood's door ---------------------------------------------------
     *
     * `openscene ()` fires on a turn as well as a step, which is what makes
     * this reachable: Scene C4 is entered from Scene C3 heading south, and the
     * arm that starts the gossip wants `currentview () = "east"`.
     */
    await walkTo(p, hotupper, { x: 2, z: 3, view: "east" });
    await p.pump(() => num("bloodphase") === 1, "the conversation through Blood's door");
    await p.settle("the gossip");

    // ---- 13. bed -------------------------------------------------------------
    await openDoor(p, [168, 50, 329, 263], "playroom", "the door of the player's room", {
      set: hotupper, x: 2, z: 3, view: "west",
    });
    await p.pump(() => room(p) === "hotroom", "the player's room");
    await p.pump(
      () => String(p.session.interp.globals.get("handitem") ?? "").toLowerCase() === "hrkey",
      "the room key back in hand",
    );
    await walkTo(p, hotroom, { x: 0, z: 0, view: "west" });
  },
};
