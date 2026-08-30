import {
  answer, ask, clickActor, clickProp, offerInTalk, openDoor, room, set, walkTo,
  type Segment,
} from "../route";

/**
 * Day 3, morning: the ring's four owners, the scorpion's drawer, and the town.
 *
 * Twelve minutes of the original's play, and the spine of it is one object
 * moving. `jonesringstory` was set two rungs back when Jones asked for a ring;
 * `Ring` starts this rung owned by **`ruby`** and ends it owned by **`jones`**,
 * and it does not go directly. Ruby hands it to Oona, Oona hands it to Isao,
 * Isao hands it back over a film, and only then can it be given away — four
 * conversations in three different rooms, each one gated on where the ring
 * actually is:
 *
 *     RUBY.PUP/0058  threeam ()   "I need my ring back."   -> giveinven ("ring", "oona")
 *     OONA.PUP/0095  threeam ()   "...I need it back."     -> giveinven ("ring", "isao")
 *     GANG.CST/0984  mousedown    keys.mov, actionframe(1) -> addinven ("ring")
 *     JONES.PUP/0007 gift ()      the 55555 plaque         -> giveinven ("ring", "jones")
 *
 * Each of those four files also opens by testing `propowner ("ring")` against
 * its own name and RESETTING that character's phase to 0 when it matches — so
 * the order is not a preference, it is the only order in which any of them
 * says anything at all.
 *
 *   1. **Ruby's door.** `D3M_004` stands at SALUPPER Scene A3, cell (0, 2),
 *      facing east — which is Oona's door, and `SALUPPER.SET/0036 lockdoor ()`
 *      returns true for everything except day 2 evening. The original had just
 *      knocked on a locked door. Ruby is one cell north: `SALUPPER.SET/0034`
 *      owns Scene A1, cell (0, 0), and its north view's `pointinruby` is
 *      138,2-327,263. `lockruby ()` shuts only on day 4, day 2 evening, and day
 *      3 evening past `phase = 2`; this is day 3 clock 1, so the knock leads to
 *      `sendtocast ("gang", runpuppet ("ruby.pup"))`.
 *
 *      `RUBY.PUP/0058 threeam ()` offers **101** twice — "Just wanted to say
 *      hello." and "Goodbye, Ruby." are both 101, both `getlost ()`, both
 *      `rubyphase = 1` with the ring still hers. The only reply that moves the
 *      ring is **102**, offered because `jonesringstory = 1 & propowner ("ring")
 *      = "RUBY"`, and its body forks on `rubygunstory`: at 1 (which `D2ARUBY`
 *      earned) it is `giveinven ("ring", "oona")` and then `getlost ()`, so the
 *      one answer buys both **`rubyphase = 1`** and the ring's first move.
 *   2. **Sophie's door.** `SALUPPER.SET/0035` owns Scene A2, cell (0, 1), east,
 *      `pointindoor` 133,2-376,263 — an unconditional `runpuppet
 *      ("sophie.pup")`. `SOPHIE.PUP/0082 threeam ()` has an 888 arm for the ring
 *      too, but only `if propowner ("ring") = "SOPHIE"`, and it never was; what
 *      is left is a `while true` whose 101 and 102 speak and come round again
 *      and whose single exit is **999, "Goodbye, Sophie."** — the line that sets
 *      **`sophiephase = 1`**. `LEAVING` knows nothing about 999, so this is
 *      answered by id.
 *   3. **Down and out.** `SALUPPER.SET/0037` is Scene A4, cell (0, 3): an
 *      `uparrow` facing east with no door guard, `saldn.mov`, then
 *      `gotospecial ("sallower.set", "scene d6", "east")`. On the way in,
 *      `SALLOWER.SET/0001 openset ()`'s `day = 3 & clock = 1` arm seats Isao at
 *      `sallower.isao` — he is the only one of the saloon cast the morning puts
 *      out. The street door is `SALLOWER.SET/0052`, Scene D1, cell (3, 0), east,
 *      `pointinrice` 144,7-387,264, door prop "salout", and its `uparrow` is
 *      `gototown ("east")` — which READS `townscene`, still "scene g8" from the
 *      back door the rung before, so the street is entered at Scene G8.
 *   4. **The store, because that is where Oona is this morning.** The saloon's
 *      day-3 morning `openset ()` does not seat her; `STORE.SET/0001 openset ()`
 *      does — `if day = 3 & clock = 1 → sendtoactor ("oona", setupactor
 *      ("store"))` — and `GANG.CST/0851 setupactor ()`'s "store" arm stands her
 *      at `store.oona` (724, 462), cell (2, 1). The door is `TOWN.SET/0133`,
 *      Scene G10, cell (6, 9), east, `pointinstore` 222,96-287,211, prop
 *      "store"; `lockstore ()` shuts a day-3 morning only below `phase = 2` and
 *      `D3M_004` carries `phase = 3`.
 *
 *      Her `mousedown` (`GANG.CST/0851`) is gated on `realdist (me) < hotdist ()`
 *      and nothing else — no `walktopuppet ()`, so no row-or-column rule — and
 *      standing in her own cell is well inside the 512 `hotdist ()` returns
 *      outside the town. `OONA.PUP/0095 threeam ()` offers **444** only while
 *      the ring is hers; it is `giveinven ("ring", "isao")`, and it does NOT end
 *      the conversation. **103**, "Have a good morning, Oona.", does, and that
 *      is the line that sets **`oonaphase = 1`**. Both are answered, in that
 *      order.
 *   5. **Back into the saloon by the back door**, because the front one is shut.
 *      `TOWN.SET/0131 locksaloon ()` is `if clock = 1 & day != 4 return true`.
 *      `TOWN.SET/0088` is the way in: Scene D10, cell (3, 9), east,
 *      `pointinback` 3,83-91,234, open while `propowner ("HHkey") = "stranger"`,
 *      and its `uparrow` writes `townscene = "scene g8"` and jumps to
 *      `sallower.set` "scene b4" east. The mousedown also does
 *      `addinven ("hhkey")` on the way past, which puts the key back in hand —
 *      harmless here, since the hand is written over twice more before the end.
 *   6. **Isao, and the tune.** `GANG.CST/0984 mousedown` is `realdist (me) <
 *      hotdist ()` (384 in the saloon), then `runpuppet ("isao.pup")`, then —
 *      only on `day = 3 & clock = 1` — `spotmovie ("keys.mov")` and
 *      `if actionframe (1) = true & propowner ("ring") = "isao" → addinven
 *      ("ring")`. `ISAO.PUP/0022 ring ()` is the one plaque in front of it:
 *      **101**, which reads "I need that ring." precisely because he has it.
 *
 *      Isao stands at `sallower.isao` (644, 1128), cell (2, 4) — and cell (2, 4)
 *      is not a standpoint the saloon walks to. Of the cells that are, Scene C4
 *      (2, 3) is 232 units from him, comfortably inside 384, which is why the
 *      route stands there and faces south.
 *
 *      `keys.mov` is a piano. Twenty-five frames, six of which wait for a click,
 *      each offering five keys along the bottom (0-146, 143-219, 220-298,
 *      299-377, 378-510, all about y 151-210) and the picture above them as a
 *      way out. Four of the five keys on any waiting frame jump BACKWARDS into
 *      the early loop; exactly one goes on, and the header's action frame is 23,
 *      reachable only from frame 22, reachable only from frame 21's fourth key.
 *      The tune is therefore forced — and it does not have to be transcribed,
 *      because on every waiting frame the key that goes on is the one whose
 *      `goto` names the highest frame. The loop below presses that one and
 *      stops when the ring arrives; a film that parked without a way forward
 *      would fail the pump rather than be clicked at blindly.
 *   7. **Jones, at the bone.** Out of the saloon the same way as step 3, then
 *      the street. `day3am` left Jones at `town.bone` (1478, 3752), cell
 *      (5, 14), and `GANG.CST/0267 jonesidle ()` wanders him between that and
 *      `town.leroy1` (6, 13) — so where he is is a question for the engine. His
 *      `mousedown` ends in `walktopuppet ("jones.pup")`, whose `if thex != 0 &
 *      they != 0 exitcode` refuses a click from a cell sharing neither his row
 *      nor his column, so the route stands in the cell he is standing in.
 *
 *      `JONES.PUP/0074 runyoself ()` with `jonesphase = 1` is `hasring ()`:
 *      three plaques that end the conversation and `addhandbevel ()`. The gift
 *      is the point, and `INVEN.PRP/0001 addinven ()` leaves `handflag = 1`, so
 *      the plaque reads "Would you like something...?" and the first press opens
 *      the picker — `offerInTalk` works it. `JONES.PUP/0007 gift ()`'s day-3
 *      "ring" arm is `giveinven ("ring", "jones")` followed by
 *      `sendtoactor ("jones", putdownactor ())`, which is why `D3M_005` records
 *      him standing invisible at `town.bone`.
 *   8. **The undertaker's corner is a standpoint, not a click.**
 *      `TOWN.SET/0040 openscene ()` is
 *
 *          if day = 3 & clock = 1 & phase > 1 & currentview () = "south" & trotterphase = 0
 *              ... rungossip ("trotside.snd") ... trotterphase = 1
 *
 *      so **`trotterphase = 1`** is earned by coming to face south on Scene A7,
 *      cell (0, 6), and nothing else. `openscene` is a per-VIEW event in this
 *      engine (`setscripts.ts viewSettled`), so the turn onto south fires it.
 *   9. **The courthouse, which is how you reach the school.** `TOWN.SET/0127`
 *      owns Scene G4, cell (6, 3), north; `pointincourt` 160,22-338,214, prop
 *      "court", `gotointerior ("court.set")`. That call is also the last write
 *      to **`townscene`** — `NEW.FLT/0001 gotointerior ()` stores
 *      `currentscene ()` whenever it is called from the town — which is why the
 *      save reads "Scene G4". Nothing in the town leads to `school.set`;
 *      `COURT.SET/0046`, Scene C3, cell (2, 2), north, `pointinrice`
 *      148,45-355,263, prop "schoolin", does, and its `lockrice ()` opens from
 *      day 3.
 *  10. **The drawer.** `SCHOOL.SET/0035`, Scene A2, cell (0, 1), north,
 *      `pointindesk` 191,187-381,262, guarded on the pages or the matchbox not
 *      yet being the player's — both true — and the click is `doscorp ()`, which
 *      swaps the stage for `scorp.flt`.
 *
 *      `SCORP.FLT/0001 trigger ()` lays the drawer out from the props' own
 *      state, and the arm that matters is
 *
 *          if propowner ("matchbox") = "scorpion"
 *              propvisible ("thematch", true)   propdeg ("thematch", 1)
 *              propdeg ("thepages", 0)
 *
 *      The scorpion is sitting on the matchbox, so it is NOT sitting on the
 *      pages, and `hitpage ()`'s `if propdeg ("thepages") = 1` — which is
 *      `playerdeath = "by scorpion"` — is closed. That is what the rung before
 *      bought by leaving the box in the desk: `TOWN.SET/0127 openscene ()` turns
 *      `propowner ("matchbox") = "desk"` into `"scorpion"` on the way past the
 *      courthouse, and `D3M_004` records the box already his.
 *
 *      The drawer has no click regions of its own (`flatprops.ts scorp.flt`
 *      finds only the exit at 52,310-136,336); the things in it are props, and
 *      `SCORP.PRP/0002` and `/0010` are the two mousedowns —
 *      `sendtostage (hitmatch ())` and `sendtostage (hitpage ())`.
 *      **Matchbox first, pages second**, because `addinven ()` ends
 *      `handitem = newitem` and the save's hand holds the **pages**.
 *      `hitmatch ()` also copies the scorpion onto the box —
 *      `if propdeg ("thematch") = 1 → propdeg ("matchbox", 1)` — and `D3M_005`
 *      records `Matchbox` at deg 1, which is the save saying which of the two
 *      the scorpion was on.
 *  11. **Out, by the doors that came in.** `SCHOOL.SET/0037`, Scene B2,
 *      cell (1, 1), south, `pointinrice` 147,78-376,263, prop "schoolout",
 *      whose `uparrow` is `gotospecial ("court.set", "scene c3", "south")`; then
 *      `COURT.SET/0048`, Scene C5, cell (2, 4), south, `pointinrice`
 *      147,37-377,263, prop "courtout", whose `uparrow` is
 *      `gototown (currentview ())` — `townscene` is "Scene G4" and the view is
 *      south, which is exactly the standpoint `D3M_005` was taken at.
 *
 * **Why the pages are taken last, and why that is the save's own reasoning.**
 * `NEW.FLT/0001 canadvance ()` for day 3 clock 1 is `propowner ("ring") =
 * "jones" & propowner ("pages") = "stranger"`, and `TOWN.SET/0001 openscene ()`
 * runs a countdown on it: the first town standpoint after it turns true sets
 * `scenecounter = 5 + random (10)`, every standpoint after that decrements, and
 * at zero — with no cast member within 300 units — it is `lockevents = true` and
 * `advanceday ()`. Taking the pages inside the school and stepping straight back
 * out to Scene G4 spends exactly ONE town standpoint on that fuse, which is why
 * `D3M_005` records `scenecounter` freshly armed at 10 rather than part-way
 * down. Handing Jones the ring first and then walking the length of the town to
 * the courthouse would have spent the whole countdown.
 *
 * **`theset` is claimed even though it does not change**, because it is a
 * record of the ORDER. `GANG.CST/0001 stdactor ()` ends `theset = actorset
 * (who)`, so the store writes "store" over it when Bolivar and Oona are seated
 * and the saloon writes "sallower" back when Isao is; the courthouse and the
 * school seat nobody (`COURT.SET/0001 openset ()` wants `sonomaphase = 0` and
 * this save has 1). A route that visited the store after the saloon would end
 * this rung reading "store".
 *
 * **`dirgo` (0 → 1) is not claimed, and this run ends with no `dirgo` at all.**
 * It is Isao's idle pendulum: `GANG.CST/0984 isaoidle ()` swings `actordeg`
 * twenty degrees either side of 64 and flips `dirgo` at each turn, so its value
 * counts service passes spent on the saloon floor rather than anything a route
 * did. It is also destroyed on the way out — `putdownactor ()` opens
 * `dumpglobal bouncer, dirgo` and `SALLOWER.SET/0001 closeset ()` puts Isao down
 * — twice over here, since this rung enters and leaves the saloon twice.
 * `D3M_005` is another vote for the reading in
 * `docs/engine/scripting-language.md`'s table that `dumpglobal` destroys only
 * the FIRST name of its list: the save carries `dirgo = 1` and no `bouncer` at
 * all, which is what "destroy `bouncer`, leave `dirgo`" produces and what
 * "destroy both" cannot.
 *
 * **`scenecounter` (0 → 10) and `counter` (2 → 0) are not claimed either.** The
 * first is `5 + random (10)`, a seeded draw here and a different one there. The
 * second is a scratch counter eight boot scripts share — `JONES.PUP/0007`,
 * `JENIX.PUP/0007`, `GUS.PUP/0007`, `HELP1.PUP/0007` and the rest all step it
 * three-ways in the `gift ()` arm that fires when a character has nothing to say
 * about what they were handed, and `CHECKERS.PRP/0001` uses it as game state.
 * Bolivar is left mid-walk in the store by `D3M_005`, so a game of checkers is
 * as good a candidate as a shrugged-off gift, and neither save says which.
 * Reproducing the number would mean picking one at random.
 *
 * `vitalframe`, `idlecount`, `FXCOUNT`, `tumx2` and `tumy2` are frame stamps and
 * the tumbleweed's drift — consequences of how long the original took, not of
 * where it went.
 */
export const rung: Segment = {
  from: "D3M_004",
  to: "D3M_005",
  what: "the ring from Ruby to Jones by way of Oona and Isao, and the scorpion's drawer",
  claims: ["rubyphase", "sophiephase", "oonaphase", "trotterphase", "handitem", "townscene", "theset"],
  async play(p) {
    const salupper = set("SALUPPER");
    const sallower = set("SALLOWER");
    const town = set("TOWN");
    const store = set("STORE");
    const court = set("COURT");
    const school = set("SCHOOL");
    const num = (name: string): number => Number(p.session.interp.globals.get(name) ?? 0);
    const held = (): string => String(p.session.interp.globals.get("handitem") ?? "").toLowerCase();
    const owner = (what: string): string => ask(p, "propowner", [what]).toLowerCase();
    const talking = (): boolean => !!p.session.puppet;
    const walking = (who: string): boolean => Number(ask(p, "iswalk", [who])) === 1;
    /** the cell somebody is standing in, in the 256-unit grid their set is */
    const cellOf = (who: string): { x: number; z: number } => ({
      x: Math.floor(Number(ask(p, "actorxyz", [who, 1])) / 256),
      z: Math.floor(Number(ask(p, "actorxyz", [who, 2])) / 256),
    });
    /**
     * Stand in the cell somebody is standing in, and click them there.
     *
     * `walktopuppet ()` refuses a click from a cell that shares neither the
     * character's row nor their column, and Jones spends the morning walking
     * between two stars — so where he is is asked of the engine, and re-asked
     * after the walk in case he moved while it was happening.
     */
    const goToMeet = async (who: string, why: string): Promise<void> => {
      for (let round = 0; round < 8 && !talking(); round++) {
        await p.pump(() => !walking(who) || talking(), `${who} to stand still`);
        if (talking()) return;
        const at = cellOf(who);
        if (!town.scenes.some((s) => s.x === at.x && s.z === at.z)) {
          // between standpoints for a moment; ask the engine again
          await p.tick(60);
          continue;
        }
        await walkTo(p, town, { x: at.x, z: at.z, view: "north" }, talking);
        if (talking()) return;
        const now = cellOf(who);
        if (now.x === at.x && now.z === at.z) {
          await clickActor(p, who, why, 8);
          return;
        }
      }
      if (!talking()) throw new Error(`could not get to ${who} — ${why}`);
    };
    /** knock on a door whose mousedown IS the conversation, and wait for it */
    const knock = async (rect: [number, number, number, number], what: string): Promise<void> => {
      const [x0, y0, x1, y1] = rect;
      p.fire((x0 + x1) / 2, (y0 + y1) / 2);
      await p.pump(() => talking(), `${what} to answer`);
    };

    // ---- 1. Ruby, one cell north of where the save stands -------------------
    await walkTo(p, salupper, { x: 0, z: 0, view: "north" });
    await knock([138, 2, 327, 263], "Ruby's door");
    await answer(p, 102, "I need my ring back.");
    await p.pump(() => !talking(), "Ruby to finish");
    if (num("rubyphase") !== 1) throw new Error(`rubyphase is ${num("rubyphase")}`);
    if (owner("ring") !== "oona") throw new Error(`the ring went to "${owner("ring")}", not Oona`);

    // ---- 2. Sophie, next door ----------------------------------------------
    await walkTo(p, salupper, { x: 0, z: 1, view: "east" });
    await knock([133, 2, 376, 263], "Sophie's door");
    await answer(p, 999, "Goodbye, Sophie.");
    await p.pump(() => !talking(), "Sophie to finish");
    if (num("sophiephase") !== 1) throw new Error(`sophiephase is ${num("sophiephase")}`);

    // ---- 3. down the saloon stairs and out into the street ------------------
    await walkTo(p, salupper, { x: 0, z: 3, view: "east" });
    await p.press("uparrow", "down the saloon stairs");
    await p.pump(() => room(p) === "sallower", "the saloon floor");
    await walkTo(p, sallower, { x: 3, z: 0, view: "east" });
    await openDoor(p, [144, 7, 387, 264], "salout", "the saloon's street door", {
      set: sallower, x: 3, z: 0, view: "east",
    });
    await p.pump(() => room(p) === "town", "the street");

    // ---- 4. the store, and Oona ---------------------------------------------
    await walkTo(p, town, { x: 6, z: 9, view: "east" });
    await openDoor(p, [222, 96, 287, 211], "store", "the store door", {
      set: town, x: 6, z: 9, view: "east",
    });
    await p.pump(() => room(p) === "store", "the store");
    await walkTo(p, store, { x: 2, z: 1, view: "north" });
    await clickActor(p, "oona", "Oona behind the counter");
    const oonaAsked = await answer(p, 444, "I need that ring back.");
    if (owner("ring") !== "isao") throw new Error(`the ring went to "${owner("ring")}", not Isao`);
    await answer(p, 103, "Have a good morning, Oona.", oonaAsked);
    await p.pump(() => !talking(), "Oona to finish");
    if (num("oonaphase") !== 1) throw new Error(`oonaphase is ${num("oonaphase")}`);

    // ---- 5. out again, and in at the saloon's back door ---------------------
    await walkTo(p, store, { x: 3, z: 1, view: "east" });
    await openDoor(p, [166, 66, 332, 264], "shop", "the store's street door", {
      set: store, x: 3, z: 1, view: "east",
    });
    await p.pump(() => room(p) === "town", "the street again");
    await walkTo(p, town, { x: 3, z: 9, view: "east" });
    await openDoor(p, [3, 83, 91, 234], "back", "the saloon's back door", {
      set: town, x: 3, z: 9, view: "east",
    });
    await p.pump(() => room(p) === "sallower", "the saloon floor again");

    // ---- 6. Isao, and the six notes of keys.mov -----------------------------
    await walkTo(p, sallower, { x: 2, z: 3, view: "south" });
    await clickActor(p, "isao", "Isao at the piano");
    await answer(p, 101, "I need that ring.");
    const haveRing = (): boolean => owner("ring") === "stranger";
    for (let note = 0; note < 12 && !haveRing(); note++) {
      await p.pump(
        () => haveRing() || p.v().movieRegions.length > 0,
        "the tune to want a key",
      );
      if (haveRing()) break;
      /*
       * The key that goes ON is the one whose goto names the highest frame.
       * Every waiting frame of `keys.mov` offers the same five keys, four of
       * which jump back into frames 2-12 and one of which advances; the picture
       * above them is a type-1 exit with no target at all, so it never wins a
       * numeric comparison. Reading the film rather than transcribing the tune
       * is what keeps this from being six magic coordinates.
       */
      let best = p.v().movieRegions[0]!;
      let bestTarget = -1;
      for (const region of p.v().movieRegions) {
        const target = Number(region.target);
        if (Number.isFinite(target) && target > bestTarget) {
          bestTarget = target;
          best = region;
        }
      }
      if (bestTarget < 0) throw new Error(`keys.mov parked with no way on: ${p.v().movieRegions.length} regions`);
      p.fire((best.x0 + best.x1) / 2, (best.y0 + best.y1) / 2);
      await p.tick(20);
    }
    if (!haveRing()) throw new Error(`the tune did not end with the ring — propowner is "${owner("ring")}"`);

    // ---- 7. out of the saloon, and the ring to Jones ------------------------
    await walkTo(p, sallower, { x: 3, z: 0, view: "east" });
    await openDoor(p, [144, 7, 387, 264], "salout", "the saloon's street door", {
      set: sallower, x: 3, z: 0, view: "east",
    });
    await p.pump(() => room(p) === "town", "the street");
    await goToMeet("jones", "Jones down by the bone");
    await offerInTalk(p, "ring", "the ring for Jones");
    await p.pump(() => !talking(), "Jones to finish");
    if (owner("ring") !== "jones") throw new Error(`the ring is still "${owner("ring")}"`);

    // ---- 8. the undertaker's corner, faced south ----------------------------
    await walkTo(p, town, { x: 0, z: 6, view: "south" });
    if (num("trotterphase") !== 1) throw new Error(`trotterphase is ${num("trotterphase")} at Scene A7`);

    // ---- 9. the courthouse, and the school behind it ------------------------
    await walkTo(p, town, { x: 6, z: 3, view: "north" });
    await openDoor(p, [160, 22, 338, 214], "court", "the courthouse door", {
      set: town, x: 6, z: 3, view: "north",
    });
    await p.pump(() => room(p) === "court", "the courtyard");
    await walkTo(p, court, { x: 2, z: 2, view: "north" });
    await openDoor(p, [148, 45, 355, 263], "schoolin", "the mission school's door", {
      set: court, x: 2, z: 2, view: "north",
    });
    await p.pump(() => room(p) === "school", "the school");

    // ---- 10. the drawer: the matchbox, then the pages -----------------------
    await walkTo(p, school, { x: 0, z: 1, view: "north" });
    const flat = (): string => ask(p, "currentflat").toLowerCase();
    p.fire((191 + 381) / 2, (187 + 262) / 2);
    await p.pump(() => flat() === "mainscorp", "the drawer to slide open");
    if (ask(p, "propdeg", ["thepages"]) !== "0") {
      // trigger () puts the scorpion on the matchbox and only then clears the
      // pages; a 1 here is `playerdeath = "by scorpion"` waiting to happen
      throw new Error(`the scorpion is on the pages (thepages deg ${ask(p, "propdeg", ["thepages"])})`);
    }
    /** click a thing in the drawer until the shop says it is ours */
    const outOfTheDrawer = async (prop: string, item: string): Promise<void> => {
      for (let i = 0; i < 4 && owner(item) !== "stranger"; i++) {
        await clickProp(p, prop, `the ${item} in the drawer`, { tries: 1 });
      }
      if (owner(item) !== "stranger") throw new Error(`the ${item} is still "${owner(item)}"`);
    };
    await outOfTheDrawer("thematch", "matchbox");
    if (ask(p, "propdeg", ["matchbox"]) !== "1") {
      throw new Error(`the matchbox came out at deg ${ask(p, "propdeg", ["matchbox"])} — the scorpion was elsewhere`);
    }
    await outOfTheDrawer("thepages", "pages");
    if (held() !== "pages") throw new Error(`the hand holds "${held()}" out of the drawer`);
    // the flat's own exit region — `SCORP.FLT/0001 doexit ()`, which is hitdesk ()
    p.fire((52 + 136) / 2, (310 + 336) / 2);
    await p.pump(() => ask(p, "currentstage").toLowerCase().startsWith("new"), "the desk to shut");

    // ---- 11. back out through the school and the courthouse -----------------
    await walkTo(p, school, { x: 1, z: 1, view: "south" });
    await openDoor(p, [147, 78, 376, 263], "schoolout", "the school's own door", {
      set: school, x: 1, z: 1, view: "south",
    });
    await p.pump(() => room(p) === "court", "the courtyard again");
    await walkTo(p, court, { x: 2, z: 4, view: "south" });
    await openDoor(p, [147, 37, 377, 263], "courtout", "the courthouse's street door", {
      set: court, x: 2, z: 4, view: "south",
    });
    await p.pump(() => room(p) === "town", "the street, at the courthouse");
  },
};
