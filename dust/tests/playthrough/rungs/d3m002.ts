import {
  answer, ask, clickActor, LEAVING, openDoor, room, set, talkOut, walkTo,
  type Segment,
} from "../route";

/**
 * Day 3, morning: out of the room, down to breakfast, and into the street.
 *
 * The longest rung on the thread — 26743 frames, twenty-two minutes — and almost
 * all of that is the original wandering. What it MOVED is a spine of seven
 * globals, and the order of them is forced: `phase` steps 0 → 1 on the landing
 * and 1 → 2 at the table, and the table itself zeroes `buickphase` and
 * `fearphase` on its way past, so the 1s the save carries for those two are both
 * earned AFTER breakfast and cannot be earned before it.
 *
 *   1. **Out of the room.** `D3M_001` stands at HOTROOM Scene A1; the door is
 *      Scene B1, cell (1, 0), facing east — `HOTROOM.SET/0036 pointinrice`
 *      (176,62-339,263), the `door` prop "inside". Its `keydown` has an arm for
 *      exactly this morning: `if day = 3 & phase = 0 & clock = 1 → sendtoactor
 *      ("buick", setupactor ("hallway"))`, which is `GANG.CST/0468`'s
 *      `hotupper.jones1`. Then `gotospecial ("hotupper.set", savescene, savedir)`
 *      — and `D3M_001` carries `savescene = "scene c4"`, `savedir = "east"`, so
 *      the landing is entered at Scene C4, cell (2, 3).
 *   2. **The landing wait, which is where `phase` becomes 1.**
 *      `HOTUPPER.SET/0045 openscene ()` has a day-3 twin of day 2's clause —
 *      `if day = 3 & clock = 1 & phase = 0` → `lockevents = true`,
 *      `currentview ("north")`, and a scene loop on `trigger ()`. `trigger ()`
 *      sets **`phase = 1`**, clears `lockevents`, and because the day is 3 takes
 *      the `else` arm: `runpuppet ("buick.pup")`, then
 *      `moveactor ("hotupper.jones2")`. Walking off the cell first and the
 *      morning never starts, so the route stands still until `phase` reads 1.
 *
 *      Buick's file at this moment is `BUICK.PUP/0053 runyoself ()`, clock 1,
 *      and its first test is `actorstar ("BUICK") = "hotupper.jones1"` — which is
 *      where `setupactor ("hallway")` just put him, and `trigger ()` runs the
 *      puppet BEFORE it moves him. So this is `wakeup ()`: five spoken lines, no
 *      plaques, and **`buickphase` untouched**. That is why the reply list here
 *      is empty rather than `LEAVING` — a plaque appearing would mean some other
 *      arm of the file ran.
 *   3. **Down the stairs.** HOTUPPER Scene D1, cell (3, 0), facing south;
 *      `HOTUPPER.SET/0046 keydown` answers a bare `uparrow` with `hotdn.mov` and
 *      `gotospecial ("hotlower.set", "scene d3", "south")`. That cell's own
 *      `openscene ()` is Buick's chaperone: while `day = 3 & clock = 1 &
 *      phase = 1` and he is still in `hotupper` west of x = 896 it turns the
 *      camera to west, waits out his walk, and turns back to south. `walkTo`
 *      re-plans from the standpoint the engine reports, so being spun round
 *      mid-arrival is survivable; pressing blindly is not.
 *   4. **The table, twice.** `HOTLOWER.SET/0040 breakready ()` is a click on the
 *      breakfast table while `phase = 1 & clock = 1`, from the south
 *      (`pointinbreak1`, 149,203-378,261) or the west. Its `day = 3` arm reads
 *
 *          if buickphase = 0
 *              sendtocast ("gang", runpuppet ("buick.pup"))
 *              exitcode
 *          endif
 *          ... setupactor ("daychores"/"day3AM"/"day2PM") ...
 *          buickphase = 0   fearphase = 0   phase = 2   breakfast ()
 *
 *      so the FIRST click is Buick over breakfast and the second is the meal.
 *      Buick is in the lobby by then (`HOTLOWER.SET/0001 openset ()` does
 *      `sendtoactor ("buick", setupactor ("hotel"))` while `phase = 1 &
 *      clock = 1`), so `BUICK.PUP/0053` takes its `breakfast ()` arm: four
 *      plaques all carrying **201**, asked with `puppetevent (240)` whose `-2`
 *      timeout falls into 201's own body, ending `buickphase = 1`. The rung
 *      checks that 1 before clicking again, because the second click is what
 *      destroys it.
 *
 *      (`breakfast ()` also offers the hairpin — `if propowner ("hairpin") !=
 *      "stranger"` — and `D3M_001` already records it as "stranger", so that
 *      branch is closed and `handitem` is not disturbed here.)
 *
 *      The second click is the one that starts the day: it scatters the cast
 *      (`GANG.CST/0267`'s `day3am` puts Jones at `town.bone`, `/0343`'s
 *      `day3AM` puts the Mayor's wife at `town.jones1`, `/0594`'s walks Laurel
 *      across the town, Marie goes to `day2PM`), sets **`phase = 2`**, and calls
 *      `breakfast ()` — which closes the set's stage and opens `HOTPLATE.FLT`.
 *   5. **The meal, and `handitem`.** A flat is not a room: the arrow keys do
 *      nothing and everything is a click. `dust/tools/flatprops.ts hotplate.flt`
 *      prints the regions, and `gotoflat (n)` is 1-based over the file's five
 *      flats, so the tool's Flat 1 is the script's flat 2:
 *
 *          Flat 1 (start)  b 139,81-293,193 → gotoflat (4) + biscuits
 *                          s 415,60-506,130 → gotoflat (3) + sugarcubes
 *          Flat 3          s 423,60-499,128 → gotoflat (5) + sugarcubes
 *          Flat 4          — no gotoflat region at all
 *
 *      and `HOTPLATE.FLT/0001 mousedown` gets up from the table only while
 *      `currentflat () = "flat 4"`, which is the fifth flat — both things taken.
 *      Biscuits first and sugarcubes second, because `INVEN.PRP/0001 addinven ()`
 *      ends `handitem = newitem` and the save's `handitem` is **"sugarcubes"**.
 *      The same call is the `TAKE`: `propowner (newitem, "stranger")` is what
 *      moves the cubes off `TROTTER`, and it is a pickup off a table rather than
 *      anything given. (`Biscuits` was already owned; what its record shows is
 *      `propview` going "panel" → "large", which is the other half of the same
 *      handler.)
 *   6. **Fear at the desk.** `GANG.CST/0755 mousedown` is gated on nothing but
 *      `currentscene () = "scene a1"` — no `hotdist ()`, no `walktopuppet` — so
 *      the lobby's corner cell (0, 0) is where he is spoken to.
 *      `FEAR.PUP/0052 runyoself ()` at `clock = 1` splits on `phase`: below 2 it
 *      is two lines and `fearphase = 1` and nothing else, at 2 or above it is the
 *      long arm that ends in a `while true` around three plaques. The save was
 *      taken with `phase = 2`, and the table had just zeroed `fearphase`, so this
 *      is the long arm, and its leaving line is **103, "Bye."** — the only one of
 *      the three that sets `fearphase = 1`. It is answered by id: `LEAVING`
 *      prefers 102 and 101 first, and the file's own `case -1` arm is the
 *      misspelled `exitode`, so walking out with ESC is not an option here
 *      either.
 *   7. **Buick again, in the lobby.** The table left him at `hotlower.day`
 *      (84, 80) — cell (0, 0), the same corner — with `buickphase = 0`, so
 *      `BUICK.PUP/0053` now takes `afterbreak ()`. That handler opens
 *      `if fearphase != 0 → buickphase = 1, exitcode`, so with Fear already
 *      spoken to it is six lines and a phase and NO plaques. `clickActor`'s
 *      default test is "a conversation is open", which a `puppetspeak` run can
 *      pass through between two looks, so the outcome asked for is
 *      `buickphase = 1` itself.
 *   8. **Out into the street.** `HOTLOWER.SET/0034` Scene A1 facing west,
 *      `pointindoor` (128,73-394,262), the `door` prop "hotout", and the
 *      `uparrow` after it is `gototown (currentview ())`. `NEW.FLT/0001
 *      gototown ()` at `clock = 1` is `gotospecial ("town.set", townscene,
 *      dirname)` — it READS `townscene` and never writes it — so the street is
 *      entered at Scene G5, cell (6, 4), and `townscene` is still "scene g5" at
 *      the far end of the rung. Nothing on this morning calls `gotointerior ()`
 *      from the town, which is the only thing that would change it.
 *
 *      **The rectangle this rung clicks is half of that one, and Buick is the
 *      reason.** He is standing at `hotlower.day` (84, 80), 44 units in front of
 *      the camera, and a sprite that close covers the middle of the doorway;
 *      `SetViewer.roomHitTest` names him for every point from x = 200 to
 *      x = 340, and an actor consumes a click before the scene script sees it.
 *      The west half of `pointindoor` is the same door with him out of the way.
 *      This is not the port disagreeing with `DF.EXE` — the shipped script puts
 *      him there and the shipped rectangle is that wide — it is a click that
 *      has to be aimed rather than centred, the way a player aims it.
 *   9. **Jones, at the bone.** `day3am` is `town.bone` (1478, 3752), cell
 *      (5, 14), and `jonesidle ()` wanders him between that and `town.leroy1`
 *      (6, 13) — so where he is is a question for the engine, and the route asks
 *      it (`actorxyz`) and walks to the cell he is standing in. His cell and not
 *      merely near it: `GANG.CST/0001 walktopuppet ()` opens `if thex != 0 &
 *      they != 0 exitcode`, so a click from a cell sharing neither his row nor
 *      his column opens nothing at all.
 *
 *      `JONES.PUP/0074 runyoself ()` at `clock = 1` with `jonesphase = 0` is
 *      `threeam ()`: **101** ("Why so glum?"), **102** ("What's bothering
 *      you?"), and then `bigstep ()`, a `while true` that offers **104**
 *      ("Marriage is a big step.") on its first pass and only afterwards offers
 *      **105** ("I'll try to find you a ring.") — which is the single line that
 *      sets **`jonesringstory = 1`** and **`jonesphase = 1`**. Its neighbours are
 *      106 and **103**, and 103 is a leaving line that sets neither, so `LEAVING`
 *      would walk this conversation straight past the only thing it is for.
 *  10. **The Mayor's wife, and where the rung stops.** `day3AM` is `town.jones1`
 *      (1624, 1872), cell (6, 7), and `mwifeidle ()` wanders her to `town.jones2`
 *      and back. `MWIFE.PUP/0076 runyoself ()` at `clock = 1` with
 *      `mwifephase = 0` is `threeam ()`: four forced questions — **101**, **111**,
 *      **112**, and **103** — each asked with `puppetevent (240)`, and only the
 *      last one's body ends `mwifephase = 1`.
 *
 *      `D3M_002` was taken with `mwife.pup` still open, standing at TOWN Scene
 *      G7, cell (6, 6), facing north — one cell north of her star, which is
 *      inside `hotdist ()` (384 in the town; the two centres are 212 apart) and
 *      on her column. This suite checks the standpoint after `play ()` returns,
 *      and a route cannot walk with a puppet up, so the conversation is finished
 *      and the last move is onto that cell.
 *
 * **`scenecounter` is 0 at both ends, and that is a fact about the day rather
 * than about the route.** `TOWN.SET/0001 openscene ()` arms its wandering
 * countdown only inside `if sendtostagefx (canadvance ())`, and `NEW.FLT`'s
 * `canadvance ()` for `day = 3, clock = 1` is `propowner ("ring") = "jones" &
 * propowner ("pages") = "stranger"`. The ring belongs to Ruby and the pages to
 * nobody, so the counter never starts and no amount of walking about would
 * advance the day. The same `openscene ()`'s robber needs `playeraccount <= 0`
 * and the account holds 587.
 *
 * **`counter` (0 → 1) is not claimed.** Its only writers reachable on a day-3
 * morning are `gift ()` fall-through switches — `JONES.PUP/0007`'s and
 * `JENIX.PUP/0007`'s — each of which speaks a line and steps the counter when
 * offered something the character has nothing to say about. Jones is at the bone
 * and Jenix is out at the cemetery (`initactors ()`'s `day3cem`), both were
 * within reach of the original's twenty-two minutes, and nothing in either save
 * says which of them was handed what. Reproducing the number would mean picking
 * one at random, which is a different claim from the one the save supports.
 *
 * `idlecount` is `BOOTFILE/0001 idle ()`'s mod-4 counter and `tumx2`/`tumy2` are
 * the tumbleweed's drift; neither is a consequence of a route. `attentionspan`
 * and `curattention` are unchanged across the rung, which is the arithmetic
 * agreeing with the scripts: no idle handler in the morning cast arms
 * `hasattention` — Jones's wants day 1 or day 2, Marie's day 2 evening, Laurel's
 * day 3 evening, and the Mayor's wife's never does — so nobody starts a
 * conversation here that was not clicked for.
 */
export const rung: Segment = {
  from: "D3M_001",
  to: "D3M_002",
  what: "out of the room, down to breakfast, and the morning's rounds",
  claims: [
    "phase", "buickphase", "fearphase", "jonesphase", "jonesringstory",
    "mwifephase", "handitem", "townscene",
  ],
  async play(p) {
    const hotroom = set("HOTROOM");
    const hotupper = set("HOTUPPER");
    const hotlower = set("HOTLOWER");
    const town = set("TOWN");
    const num = (name: string): number => Number(p.session.interp.globals.get(name) ?? 0);
    const held = (): string => String(p.session.interp.globals.get("handitem") ?? "").toLowerCase();
    const talking = (): boolean => !!p.session.puppet;
    const walking = (who: string): boolean => Number(ask(p, "iswalk", [who])) === 1;
    const onStage = (): string => ask(p, "currentstage").toLowerCase();
    /** the cell somebody is standing in, in the 256-unit grid their set is */
    const cellOf = (who: string): { x: number; z: number } => ({
      x: Math.floor(Number(ask(p, "actorxyz", [who, 1])) / 256),
      z: Math.floor(Number(ask(p, "actorxyz", [who, 2])) / 256),
    });
    /**
     * Stand in the cell somebody is standing in, and click them there.
     *
     * `walktopuppet ()` refuses a click from a cell that shares neither the
     * character's row nor their column, and `hotdist ()` is 384 in the town —
     * a cell and a half — so "near enough" is not a fact about cells. Both of
     * this morning's street conversations are with wanderers, so where they are
     * is asked of the engine and re-asked after the walk.
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

    // ---- 1. out of the room, at Scene B1 facing east ------------------------
    await openDoor(p, [176, 62, 339, 263], "inside", "the room door", {
      set: hotroom, x: 1, z: 0, view: "east",
    });
    await p.pump(() => room(p).startsWith("hotupper"), "the landing");
    if (p.session.currentSceneName()?.toLowerCase() !== "scene c4") {
      throw new Error(`the room door came out at ${p.session.currentSceneName()}`);
    }

    // ---- 2. stand still on C4 until the morning arms itself -----------------
    await p.pump(() => num("phase") >= 1, "the morning to be armed");
    // `wakeup ()` has no plaques at all — five lines and no phase. The empty
    // list is not a shrug: a plaque here would mean a different arm of the file.
    await talkOut(p, [], "Buick's wake-up on the landing", 2);
    if (num("phase") !== 1) throw new Error(`phase is ${num("phase")} after the landing`);
    if (num("buickphase") !== 0) {
      throw new Error(`buickphase is ${num("buickphase")} — wakeup () should not set it`);
    }

    // ---- 3. down the stairs -------------------------------------------------
    await walkTo(p, hotupper, { x: 3, z: 0, view: "south" });
    await p.press("uparrow", "down the stairs");
    await p.pump(() => room(p).startsWith("hotlower"), "the lobby");

    // ---- 4. the table, twice ------------------------------------------------
    await walkTo(p, hotlower, { x: 1, z: 2, view: "south" }, undefined, 4, LEAVING);
    // `pointinbreak1` facing south is 149,203-378,261 — a low strip, and the
    // middle of the picture is not in it
    const table = (): void => void p.fire((149 + 378) / 2, (203 + 261) / 2);
    for (let i = 0; i < 6 && num("buickphase") !== 1; i++) {
      if (!talking()) {
        table();
        await p.settle("the breakfast table, for Buick");
      }
      if (talking()) await talkOut(p, [201], "Buick over breakfast", 2);
    }
    if (num("buickphase") !== 1) {
      throw new Error(`Buick's breakfast left buickphase at ${num("buickphase")}`);
    }
    for (let i = 0; i < 6 && num("phase") < 2; i++) {
      if (!talking()) {
        table();
        await p.settle("the breakfast table");
      }
      if (talking()) await talkOut(p, LEAVING, "anything left at the table", 2);
    }
    if (num("phase") !== 2) throw new Error(`the day started at phase ${num("phase")}`);

    // ---- 5. the meal: biscuits, then sugarcubes, then get up ----------------
    for (let i = 0; i < 24 && onStage().startsWith("hotplate"); i++) {
      if (held() !== "biscuits" && held() !== "sugarcubes") p.fire(216, 137);
      else if (held() !== "sugarcubes") p.fire(461, 94);
      else p.fire(256, 350); // below every region: the stage hears it, and gets up
      await p.settle("the table");
    }
    await p.pump(() => !onStage().startsWith("hotplate"), "up from the table");
    if (held() !== "sugarcubes") throw new Error(`the hand carries "${held()}" out of breakfast`);
    if (ask(p, "propowner", ["sugarcubes"]).toLowerCase() !== "stranger") {
      throw new Error(`the sugarcubes still belong to ${ask(p, "propowner", ["sugarcubes"])}`);
    }

    // ---- 6. Fear, from the corner cell his mousedown insists on -------------
    await walkTo(p, hotlower, { x: 0, z: 0, view: "east" }, undefined, 4, LEAVING);
    await clickActor(p, "fear", "Fear at the desk");
    await answer(p, 103, "Bye.");
    await p.pump(() => !talking(), "Fear to finish");
    if (num("fearphase") !== 1) throw new Error(`fearphase is ${num("fearphase")}`);

    // ---- 7. Buick, in the same corner --------------------------------------
    await clickActor(
      p, "buick", "Buick after breakfast", 20,
      () => num("buickphase") === 1,
    );
    await p.pump(() => !talking(), "Buick to finish");

    // ---- 8. out into the street, which `townscene` says is Scene G5 ---------
    /*
     * The rectangle handed over is the WEST HALF of `pointindoor`
     * (128,73-394,262), and the reason is Buick.
     *
     * `setupactor ("daychores")` stands him at `hotlower.day` (84, 80) — 44
     * units in front of Scene A1's camera — and `walktopuppet ()` walks him
     * back there after step 7. At that range his sprite fills the middle of the
     * door: `SetViewer.roomHitTest` answers "actor: buick" for every point
     * between x = 200 and x = 340 down the whole height of the doorway, and
     * `clickActor` consumes a click on an actor before the scene script is ever
     * asked. So the centre of the authored rectangle — where `openDoor` clicks
     * — is not the door at all, and six tries at it are six brush-offs.
     *
     * The half below is the same door; it is the part of it he is not standing
     * in front of. He is waited out first because `moveactor` leaves him
     * walking, and where a sprite falls is a question about where he has got to.
     */
    await p.pump(() => !walking("buick"), "Buick to stand still by the door");
    await openDoor(p, [128, 73, 192, 207], "hotout", "the lobby door", {
      set: hotlower, x: 0, z: 0, view: "west",
    });
    await p.pump(() => room(p).startsWith("town"), "the street");
    if (p.session.currentSceneName()?.toLowerCase() !== "scene g5") {
      throw new Error(`the lobby door came out at ${p.session.currentSceneName()}`);
    }

    // ---- 9. Jones, and the ring he is sent looking for ----------------------
    await goToMeet("jones", "Jones down by the bone");
    let asked = await answer(p, 101, "Why so glum?");
    asked = await answer(p, 102, "What's bothering you?", asked);
    asked = await answer(p, 104, "Marriage is a big step.", asked);
    await answer(p, 105, "I'll try to find you a ring.", asked);
    await p.pump(() => !talking(), "Jones to finish");
    if (num("jonesphase") !== 1) throw new Error(`jonesphase is ${num("jonesphase")}`);
    if (num("jonesringstory") !== 1) throw new Error(`jonesringstory is ${num("jonesringstory")}`);

    // ---- 10. the Mayor's wife, and the standpoint the save was taken at -----
    await goToMeet("mwife", "the Mayor's wife in the street");
    asked = await answer(p, 101, "What happened?");
    asked = await answer(p, 111, "Probably not.", asked);
    asked = await answer(p, 112, "I can't imagine.", asked);
    await answer(p, 103, "You're strong. You'll survive. Anything else?", asked);
    await p.pump(() => !talking(), "the Mayor's wife to finish");
    if (num("mwifephase") !== 1) throw new Error(`mwifephase is ${num("mwifephase")}`);

    await walkTo(p, town, { x: 6, z: 6, view: "north" });
  },
};
