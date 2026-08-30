import { answer, ask, clickActor, openDoor, room, set, walkTo, type Segment } from "../route";

/**
 * Day 3, morning: the matchbox into the schoolmaster's desk, and round the back
 * of the saloon.
 *
 * Six minutes of play and four globals, three of which are travel. The one that
 * is not is the prop line the thread prints as **GIVE Matchbox (to scorpion)**,
 * and it is not a gift to anybody: `scorpion` is an OWNER string, and the thing
 * that takes the matchbox is the desk in the corner of the schoolroom.
 *
 * `SCHOOL.SET/0035` — the script of Scene A2, the cell the desk is in — has a
 * `mousedown` inside `pointindesk` (191,187-381,262, and `false` when
 * `clock = 3`) that calls `doscorp ()`: `openshopfile ("scorp.prp")`,
 * `openstagefile ("scorp.flt")`, and the set fades out under it. That flat is
 * the drawer. `SCORP.FLT/0001 trigger ()` runs the drawer open across the file's
 * ten flats and lays out what is inside it:
 *
 *     if propowner ("pages") != "stranger"   thepages visible, propdeg 1
 *     if propowner ("matchbox") = "desk"     thematch visible, propdeg 0
 *     if propowner ("matchbox") = "scorpion" thematch visible, propdeg 1
 *                                            thepages propdeg 0
 *
 * `propdeg ("thepages") = 1` is the scorpion sitting ON the torn pages, and
 * `SCORP.FLT/0001 hitpage ()` reads it: reach for them with the scorpion there
 * and it is `playerdeath = "by scorpion"` and the death flat. The matchbox is
 * how the scorpion is moved off them, and it takes two visits to the drawer with
 * a walk out into the street between them: leave the box open in the drawer, go,
 * and come back to find the scorpion in it. This rung is the first visit and the
 * walk.
 *
 *  1. **The desk.** SCHOOL Scene A2, cell (0,1), facing north — one step west of
 *     the standpoint `D3M_CLAS` was written at. The `mousedown` is also gated on
 *     `propowner ("pages") != "stranger" | propowner ("matchbox") != "stranger"`,
 *     and `pages` is "none" in the save, so the drawer opens.
 *  2. **The matchbox in.** `SCORP.FLT/0029 openflat ()` draws whatever is in
 *     hand as a `"large"` prop at 316,320, and `INVEN.PRP/0001 stdmouse ()` is
 *     what a player does with it: press it, `while stilldown ()` drag it, and on
 *     release hit-test where it was let go — an actor gets `offerobject`, then
 *     `pointinset (arg)`, then `pointy (arg) < 264 & pointinstage (arg)` sends
 *     `offerobject` to the flat. So this is a press-drag-release and not a
 *     click: the release point is what carries the meaning, and the set is
 *     invisible here (`doscorp ()` calls `setvisible (false)`) so the flat is
 *     what catches it. `SCORP.FLT/0001 offerobject (what)` is
 *     `if what = "matchbox" & propdeg (what) = 0` — the save has the box at
 *     `propdeg 0` — and it ends `giveinven ("matchbox", "desk")`, which also
 *     empties `handitem`.
 *  3. **Shutting the drawer.** `mainscorp` has exactly one click region,
 *     `exit` at 52,310-136,336 (`flatprops.ts`), running `SCORP.FLT/0041
 *     mousedown` → `doexit ()` → `hitdesk ()`: the drawer runs shut, `scorp.flt`
 *     closes, `new.flt` reopens and `setvisible (true)` gives the schoolroom
 *     back.
 *  4. **Out of the school.** `SCHOOL.SET/0037`, Scene B2 facing south:
 *     `pointinrice` 147,78-376,263, the `door` prop set to "schoolout", and
 *     `uparrow` → `gotospecial ("court.set", "scene c3", "south")` because
 *     `clock != 3`. `lockrice ()` there returns false unconditionally.
 *  5. **Out of the mission.** `COURT.SET/0048`, Scene C5 facing south:
 *     `pointinrice` 147,37-377,263, "courtout", `uparrow` →
 *     `gototown (currentview ())`, which is `NEW.FLT/0001` doing
 *     `gotospecial ("town.set", townscene, "south")`. `townscene` is still
 *     "Scene G4" — `TOWN.SET/0127`'s `gotointerior ()` wrote it on the way in
 *     during the rung before this one — so the street we come back out onto is
 *     the courthouse corner.
 *  6. **Which is where the scorpion finds the box.** `TOWN.SET/0127 openscene ()`
 *     is four lines long and all of them are this:
 *
 *         if propowner ("matchbox") = "desk"
 *             sendtoshop ("inven", giveinven ("matchbox", "scorpion"))
 *
 *     Nothing in the school does it. The transfer is written into the
 *     COURTHOUSE cell's arrival, so it happens the moment you step back into the
 *     street, and the only other place in the corpus that carries the same two
 *     lines is `NITE.SET/0127`, the same cell after dark. That is the rung's one
 *     real move, and the route checks it by name rather than trusting the walk.
 *  7. **The back of the saloon.** TOWN Scene D10, cell (3,9), facing east.
 *     `TOWN.SET/0088`: `pointinback` 3,83-91,234, `lockback ()` false because
 *     `propowner ("HHkey") = "stranger"` and `fighton = 0`. Its `mousedown` does
 *     `sendtoshop ("inven", addinven ("hhkey"))` BEFORE it sets the door prop —
 *     that is the whole of the `handitem` claim, the saloon key coming up in the
 *     hand to be used, and it is why the rung ends holding a key rather than the
 *     matchbox it started with. The front door is not an option:
 *     `TOWN.SET/0131 locksaloon ()` is `if clock = 1 & day != 4 return true`,
 *     so on a day-3 morning the swing doors are shut and the back way is the
 *     only way in.
 *  8. **`townscene`.** The same script's `keydown` writes it literally —
 *     `townscene = "scene g8"` — before `gotospecial ("sallower.set", "scene
 *     b4", "east")`. Scene G8 is cell (6,7), the front of the saloon: the game
 *     is arranging for the player to come back out of the FRONT door later. The
 *     lower case is the giveaway that this is a hand-written string and not
 *     `gotointerior ()`'s copy of a scene name, and it is what the save records.
 *  9. **`theset`.** `SALLOWER.SET/0001 openset ()` has
 *     `if day = 3 & clock = 1  sendtoactor ("isao", setupactor ("bar"))`, and
 *     that is the last `setupactor` anything runs on this route.
 *     `GANG.CST/0001 stdactor ()` opens `theset = actorset (who)`, so `theset`
 *     becomes "sallower" on arrival — it names the set of the last actor set up,
 *     which here happens also to be the room. `SALUPPER.SET/0001 openset ()`
 *     sets nothing up at `clock = 1`, so it survives the stairs.
 * 10. **Isao at the piano.** `sallower.isao` is (644,1128), cell (2,4), and that
 *     cell is `build`, so the nearest standpoint is Scene C4 at (640,896) — 232
 *     away, inside the 384 `GANG.CST/0001 hotdist ()` gives `sallower`.
 *     `GANG.CST/0984 mousedown` has no `walktopuppet ()` in it, so distance is
 *     the whole gate. `ISAO.PUP/0007` forwards to `0022 runyoself ()`, whose
 *     `if day = 3 & clock = 1` arm is `ring ()`: one plaque, 101, and because
 *     `propowner ("ring")` is "ruby" rather than "isao" it reads "Practicing a
 *     new song?" and answers `puppetspeak ("newsong")`.
 * 11. **The song.** Back in the cast script the handler goes on to
 *     `sendtostage (spotmovie ("keys.mov"))`, and `keys.mov` is a puzzle, not a
 *     cutscene: 25 frames, every odd one parked on six regions — five keys along
 *     the bottom and one type-1 EXIT covering the picture above them — and no
 *     frame falls through. The wrong key plays its note and drops you back into
 *     the free-play frames; the right one steps you along. The tune is in the
 *     file's own targets, and it is the five keys **right, far-left, far-left,
 *     middle, left-middle, right-middle**, which walk frames 13 → 15 → 17 → 19
 *     → 21 → 23 and out through the action-1 frame 24. So the route reads the
 *     regions the movie is parked on and clicks the one whose target is the next
 *     frame of the tune, restarting from the first note if it ever finds itself
 *     back among the free-play frames. `actionframe1` is frame 23, which is
 *     reachable only that way — and `actionframe (1)` is what
 *     `GANG.CST/0984` tests before running `isao.pup` a second time.
 * 12. **The second word.** That second run is `isaophase = 999`, whose arm at
 *     the top of `ISAO.PUP/0022 runyoself ()` is `puppetspeak ("happy2")` and
 *     then `isaophase = 0` again — which is why the phase is 0 at both ends of
 *     this rung and cannot be claimed either way. The line is spoken with no
 *     plaques under it, so it is walked out of with ESC rather than with a click
 *     in the middle of the screen: `nudge ()`'s click would go through
 *     `BOOTFILE/0001 mousedown` → `hittest`, and Isao is what is under it.
 * 13. **Upstairs.** `SALLOWER.SET/0057` is Scene D6, and its whole script is
 *     `if arg = "uparrow" & currentview () = "west"`: `playmovie ("salup.mov")`
 *     — thirty frames, no regions, it plays itself out — then
 *     `gotointerior ("salupper.set")`, which lands on that set's own default
 *     standpoint, cell (0,3). One step to Scene A3, cell (0,2), facing east:
 *     Oona's door, which `SALUPPER.SET/0036 lockdoor ()` keeps shut on any day
 *     but the second night. That is where `D3M_004` was written.
 *
 * **Not claimed**, and why.
 *
 *   - **`dirgo`, which the save creates and this port does not keep.**
 *     `GANG.CST/0984 isaoidle ()` declares `global bouncer, dirgo` and rocks
 *     Isao back and forth over the keys with them; `setupactor ("bar")` calls
 *     it, so both globals come into existence the moment the saloon opens. Isao's
 *     `putdownactor ()` — which `SALLOWER.SET/0001 closeset ()` runs on the way
 *     upstairs — is `dumpglobal bouncer, dirgo`. `D3M_004` has NO `bouncer` node
 *     and a `dirgo` of 0, so `DF.EXE` destroyed the first name of that list and
 *     left the second standing. That is a seventh case for the table in
 *     [the scripting language](../../../../docs/engine/scripting-language.md),
 *     and it agrees with the six already there; this port destroys the whole
 *     list, so `dirgo` is gone here and a claim would be failing about
 *     `dumpglobal` rather than about this rung.
 *   - `handitem` **is** claimed, but not the emptying of it in step 2: between
 *     `giveinven ("matchbox", "desk")` and `addinven ("hhkey")` the hand is "",
 *     and the save only sees the far end of that.
 *   - `idlecount` (0 → 2) is `BOOTFILE/0001 idle ()`'s mod-4 counter, and
 *     `tumy2` (2730 → 1660) is where `HOUSE.PRP/0174` last sent the tumbleweed.
 *     Both say how many frames went by, not what was done in them.
 *   - `counter` is 2 at both ends. It would have moved had anything been offered
 *     to Isao — `ISAO.PUP/0007 gift ()` cycles it 0→1→2→0 — and nothing was.
 */
export const rung: Segment = {
  from: "D3M_CLAS",
  to: "D3M_004",
  what: "the matchbox into the schoolmaster's desk, and round the back of the saloon",
  claims: ["handitem", "theset", "townscene"],
  async play(p) {
    const school = set("SCHOOL");
    const court = set("COURT");
    const town = set("TOWN");
    const sallower = set("SALLOWER");
    const salupper = set("SALUPPER");
    const owner = (name: string): string => ask(p, "propowner", [name]).toLowerCase();
    const flat = (): string => ask(p, "currentflat").toLowerCase();
    const global = (name: string): string =>
      String(p.session.interp.globals.get(name) ?? "").toLowerCase();

    // ---- 1. the desk in the corner of the schoolroom -----------------------
    await walkTo(p, school, { x: 0, z: 1, view: "north" });
    p.fire((191 + 381) / 2, (187 + 262) / 2);
    await p.pump(() => flat() === "mainscorp", "the desk drawer to run open");

    // ---- 2. the matchbox into the drawer, dragged and dropped --------------
    /*
     * `stdmouse ()`'s drag is a POLLING loop — `while stilldown () ... arg =
     * mouse ()` — so this is a press and a release and not a `fire`, which is
     * dispatched and gone. The pointer is put where the box is to LAND before
     * the press, because the point the loop reads on its last pass is the point
     * the release is hit-tested at; the press itself only has to reach the
     * prop's own `mousedown`, which is reached by name.
     */
    const matchbox = p.session.propScripts.get("matchbox");
    if (!matchbox) throw new Error("no prop script for the matchbox — is inven.prp open?");
    const inTheDrawer = Number(ask(p, "makepoint", [256, 132]));
    for (let i = 0; i < 4 && owner("matchbox") !== "desk"; i++) {
      p.session.setPointer(256, 132);
      p.session.pointerDown = true;
      try {
        void p.session.track(
          p.session.interp.runHandler(matchbox, "mousedown", [inTheDrawer], {
            me: "matchbox",
            target: "matchbox",
          }),
        );
        await p.tick(20);
      } finally {
        p.session.pointerDown = false;
      }
      await p.settle("the matchbox into the drawer");
    }
    if (owner("matchbox") !== "desk") {
      throw new Error(`the drawer would not take the matchbox — it is "${owner("matchbox")}"`);
    }

    // ---- 3. shut the drawer and get the schoolroom back --------------------
    p.fire((52 + 136) / 2, (310 + 336) / 2);
    await p.pump(() => flat() !== "mainscorp", "the drawer to run shut");
    await p.settle("the schoolroom");

    // ---- 4-5. out through the school, out through the mission --------------
    await openDoor(p, [147, 78, 376, 263], "schoolout", "the schoolroom's rice-paper door", {
      set: school, x: 1, z: 1, view: "south",
    });
    await p.pump(() => room(p).startsWith("court"), "the mission courtyard");
    await openDoor(p, [147, 37, 377, 263], "courtout", "the mission gate", {
      set: court, x: 2, z: 4, view: "south",
    });
    await p.pump(() => room(p).startsWith("town"), "the street outside the courthouse");

    // ---- 6. TOWN.SET/0127 openscene (): the scorpion goes for the box ------
    await p.pump(() => owner("matchbox") === "scorpion", "the scorpion to take the matchbox");

    // ---- 7-8. down to the back door, and in ---------------------------------
    await openDoor(p, [3, 83, 91, 234], "back", "the saloon's back door", {
      set: town, x: 3, z: 9, view: "east",
    });
    await p.pump(() => room(p).startsWith("sallower"), "the back of the saloon");
    await p.pump(() => global("handitem") === "hhkey", "the saloon key in hand");
    await p.pump(() => global("theset") === "sallower", "Isao to be set up at the piano");

    // ---- 10-11. Isao, and the song he is practising ------------------------
    await walkTo(p, sallower, { x: 2, z: 3, view: "south" });
    await clickActor(p, "isao", "Isao at the piano");
    await answer(p, 101, "Practicing a new song?");

    /*
     * The tune, as the movie's own hotspots spell it.
     *
     * Every parked frame offers the same five keys; what changes is where each
     * one goes. `song` is the chain of frames that leads to the action frame, by
     * the names `mov-v1` gives them (1-based), and the right key at each step is
     * whichever region targets the next name. A wrong key drops back among the
     * free-play frames, where the first note is on offer again — so a step that
     * cannot find what it wants starts the tune over rather than guessing.
     */
    const song = ["13", "15", "17", "19", "21", "23"];
    await p.pump(() => p.v().movieRegions.length > 0, "keys.mov to ask for the first note");
    for (let note = 0; note < song.length; ) {
      const regions = p.v().movieRegions;
      if (!regions.length) {
        await p.tick(10);
        continue;
      }
      let key = regions.find((r) => r.target === song[note]);
      if (!key) {
        note = 0;
        key = regions.find((r) => r.target === song[0]);
      }
      if (!key) throw new Error(`keys.mov is parked with no way on: ${regions.map((r) => r.target).join(",")}`);
      p.fire((key.x0 + key.x1) / 2, (key.y0 + key.y1) / 2);
      note++;
      await p.tick(20);
    }
    await p.pump(() => !p.v().moviePlaying, "keys.mov to play out");

    // ---- 12. "happy2", walked out of with ESC and not with a click ---------
    for (let i = 0; i < 300 && (p.session.puppet || !p.v().quiescent); i++) {
      if (p.session.puppet) void p.session.track(p.v().keyDown(".", true));
      await p.tick(10);
    }
    if (p.session.puppet) throw new Error("Isao never stopped talking");

    // ---- 13. up the stairs, and along the landing to Oona's door -----------
    await walkTo(p, sallower, { x: 3, z: 5, view: "west" });
    await p.press("uparrow", "up the saloon stairs");
    await p.pump(() => room(p).startsWith("salupper"), "the saloon landing");
    await walkTo(p, salupper, { x: 0, z: 2, view: "east" });
  },
};
