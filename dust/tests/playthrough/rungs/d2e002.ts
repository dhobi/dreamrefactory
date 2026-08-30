import {
  answer, ask, clickActor, openDoor, room, set, takeInHand, talkOut, walkTo,
  type Segment,
} from "../route";

/**
 * Day 2, evening: the new sheriff's rounds.
 *
 * `D2E_001` is the badge, taken standing in the jail at `JAIL` Scene A1 facing
 * east with Dell locked up; `D2E_002` is four minutes later, upstairs in the
 * saloon. In between, eight phases go from 0 to 1 and every one of them is one
 * person spoken to and left by the reply their script sets the phase on. At
 * `clock = 3` the town is `nite.set`, not `town.set` — `NEW.FLT/0001
 * gototown ()` is `if clock = 3 → gotospecial ("nite.set", townscene, dirname)`
 * — so every rectangle and every scene script below is `NITE.SET`'s.
 *
 *   1. **Dell, in the cell.** `GANG.CST/0895 mousedown` sends a jailed Dell to
 *      `dell2.pup`, and `DELL2.PUP/0074 runyoself ()` at `clock = 3` with
 *      `dellphase = 0` is `jailbird ()`: three lines, then three plaques that
 *      all carry the same id, **101**. Only 101 sets `dellphase = 1`; the
 *      `case -1` arm an ESC would reach speaks nothing and leaves the 0. He
 *      wanders between `jail.dell1` (588, 132) and `jail.dell2` (640, 408), and
 *      `hotdist ()` is 384 in `jail`: from Scene A1, where the save starts, he
 *      is 460 away and a click is silent. The jail's walkable floor is only the
 *      four cells (0,0)–(1,1) — Scenes C1 and C2 have no move into them at all
 *      — and of those, Scene B2, cell (1, 1), is the one inside 384 of BOTH his
 *      stars (324 and 257), so it is where the click is made from.
 *   2. **Out through the jail door.** `JAIL.SET/0034` is Scene A1: facing west,
 *      `pointindoor` 183,34–361,263, `propowner ("door") = "lock"`, and
 *      `uparrow` is `gototown ("east")` — which lands on `townscene`, and
 *      `D2E_001` carries `townscene = "scene g12"`. So the street is entered at
 *      `NITE` Scene G12, cell (6, 11), facing east.
 *   3. **Help is standing there.** `town.help` is (1760, 3034), inside G12,
 *      131 units from its centre — and `NITE.SET/0135 keydown` facing east is
 *      `if actorset ("help") = "town" & actorvisible ("help") = true →
 *      runpuppet ("help1.pup")` before it will consider the door behind him.
 *      `HELP1.PUP/0032 runyoself ()` at `clock = 3` is `belcherbeat ()`, which
 *      has no plaques at all: five lines, `sendtoactor ("HELP",
 *      putdownactor ())`, `helpphase = 1`. (`GANG.CST/0111 helpidle ()` arms
 *      `hasattention (5)` while `day = 2 & clock = 3 & helpphase = 0`, so he may
 *      also open his own mouth first; either way it is the same file.)
 *   4. **Then into Chin's, because that is where the save leaves him.**
 *      `D2E_002` has Help at `chin.help4` in set `chin`, invisible, and the only
 *      writer of that is `CHIN.SET/0001 openset ()` — `sendtoactor ("help",
 *      setupactor ("shop"))` — with `closeset ()`'s `putdownactor ()` for the
 *      invisible. `NITE.SET/0135 lockchin ()` is false at `day = 2, clock = 3`,
 *      so `pointinchin` 218,100–278,204 facing east opens the door, and the
 *      `uparrow` that was Help's a moment ago is now
 *      `gotointerior ("chin.set")`. Out again by `CHIN.SET/0035` — Scene A2
 *      facing west, `pointinrice` 100,2–408,263, owner "rice",
 *      `gototown ("west")`. `FXCOUNT` 130 → 70 is the same visit seen from the
 *      other side: `openset ()` zeroes it and `SOUNDFXS ()` walks it up by two
 *      every other frame while the theme fades in.
 *   5. **Marie.** `GANG.CST/0001 initactors ()` put her at `setupactor
 *      ("newsherif")` when the evening began and `GANG.CST/1343 marieidle ()`
 *      wanders her between `town.jones1`, `town.jones2` and `town.marie1` — so
 *      where she is is a question for the engine, not for this file, and the
 *      route asks it (`actorxyz`) and walks to the cell she is standing in.
 *      Her cell and not merely near it: `GANG.CST/0001 walktopuppet ()` opens
 *      with `if thex != 0 & they != 0 exitcode`, so a click from a cell that
 *      shares neither row nor column with her does nothing whatever.
 *      `MARIE.PUP/0054 twonite ()` then asks two forced questions — **102, "No,
 *      I'm sheriff."** and **101, "Are you angry?"** — and drops into a
 *      `while true` whose leaving line is **202, "Good night, Marie."**, which
 *      is `sendtoactor ("marie", putdownactor ())` and `mariephase = 1`.
 *   6. **Buick.** `initactors ()` gave him `setupactor ("loose")`, which is
 *      `town.blood1` (2436, 1132) in cell (9, 4); `GANG.CST/0468 buickidle ()`
 *      walks him to `town.blood2` and back and never calls `hasattention`, so he
 *      has to be clicked. `BUICK.PUP/0056 runyoself ()` at `clock = 3` outside
 *      `salupper` is `twonite ()`, and **102, "I should get moving."** is the
 *      one arm that sets `buickphase = 1`; it falls into `luck ()`, one more
 *      question, and ends. The other night arm of that file is `upstairs ()`,
 *      which is `buickphase = 2` and, without fifty dollars, `playerdeath =
 *      "by buick"` — it is reached by meeting him in `salupper`, and `D2E_002`
 *      has him out in the street at 1, so the rung does not go near it.
 *   7. **Sonoma, at the mission.** `NITE.SET/0127` is Scene G4, cell (6, 3):
 *      facing north, `pointincourt` 160,22–338,214, and `uparrow` at
 *      `clock = 3` is `gotointerior ("nitecour.set")`. `NITECOUR.SET/0001
 *      openset ()` has `if day = 2 & clock = 3 & sonomaphase = 0 → sendtoactor
 *      ("sonoma", setupactor ("mission"))`, which is `court.sonoma` (640, 640),
 *      cell (2, 2) — and its `openscene ()` exits before `ghostloop ()` on this
 *      evening, so she stays put instead of drifting between the ghost stars.
 *      `SONOMA.PUP/0009 twonite ()` is four lines and one plaque, **101, "Who
 *      are you?"**, and it is asked with `puppetevent (240)`: the `case -2`
 *      timeout arm speaks nothing and leaves `sonomaphase` at 0, so this is a
 *      question that has to be answered rather than waited out. Out again by
 *      `NITECOUR.SET/0048` — Scene C5 facing south, `pointinrice`
 *      147,37–377,263, owner "courtout", `gototown ("south")`.
 *   8. **The saloon, and it is entered exactly once.** `NITE.SET/0131 keydown`
 *      facing west with `propowner ("door") = "saloon"` is the ONLY writer of
 *      `saloonphase`: `saloonphase = saloonphase + 1`, rolling over above 2. So
 *      **0 → 1 is one trip through that door**, and the rung must not go back
 *      out and in. The same press is `gotointerior ("sallower.set")`, and
 *      `NEW.FLT/0001 gotointerior ()` writes `townscene` only while
 *      `currentset () = "town"` — which `NITE.SET` is, its `setName` really
 *      being "town" — so **`townscene = "Scene G8"`** is this door and no other.
 *      The door is `NITE.SET/0131 pointinsaloon`, 241,92–307,201, from Scene G8,
 *      cell (6, 7).
 *
 *      Standing at G8 to open it is also what leaves `loopsound =
 *      "outsidesaloon"`. `NITE.SET/0137 nightfxs ()` picks the nearest of a
 *      handful of sources every other frame, `scene g8` is "outsidesaloon", and
 *      it forces the choice — `mindist = -hotsound` — as soon as the door prop
 *      is up and showing "saloon". `NITE.SET/0001 openset ()` clears
 *      `loopsound` on every entry to the street and `closeset ()` does not, so
 *      what survives into the save is whatever the last town standpoint heard.
 *   9. **Jones and Oona, in the bar.** `SALLOWER.SET/0001 openset ()` has
 *      `if day = 2 & clock = 3 → sendtoactor ("jones", setupactor ("saloon"))`,
 *      which is `GANG.CST/0267`'s `sal.trotter1` (576, 648) — cell (2, 2),
 *      Scene C3 — and that is Jones in `D2E_002`, visible, in `sallower`. His
 *      `mousedown` there does not walk him to you: it moves YOU, `currentscene
 *      ("scene c3")` and `currentview ("west")`, and then runs the file.
 *      `JONES.PUP/0069 twonite ()` leaves on **103, "Goodbye"** →
 *      `jonesphase = 1`. Oona stands at `sallower.oona` (964, 900), cell (3, 3);
 *      `OONA.PUP/0057 twonite ()` leaves on **203, "Time to go."** →
 *      `oonaphase = 1`. Neither leaving line is one `LEAVING` reaches first, so
 *      both are answered by id.
 *  10. **Up the stairs and stop at Sophie's door.** `SALLOWER.SET/0057` is
 *      Scene D6, cell (3, 5), `uparrow` facing west, `salup.mov`,
 *      `gotointerior ("salupper.set")`. `D2E_002` is saved at `salupper` cell
 *      (0, 1) — Scene A2 — facing east, which is `SALUPPER.SET/0035`, the door
 *      that knocks for Sophie. It was not knocked: the save's open puppet file
 *      is `oona.pup`, the last one the evening opened, and `sophiephase` is
 *      still 0. So the route walks there and stops.
 *  11. **The harmonica.** `handitem` is "" at `D2E_001` — `NEW.FLT/0001
 *      advanceday ()`'s `initall ()` cleared it at the turn of the clock — and
 *      "Harmonica" at `D2E_002`. `INVEN.PRP/0001 stdmouse ()` is the whole of
 *      it: a click on a carried prop makes it what the hand is holding. It goes
 *      in last because `selhandbevel ()` ends `handitem = ""`, and every
 *      conversation on this rung offers that plaque.
 *
 * `theset = "sallower"` is not a place the player is, it is the last actor the
 * cast library set up: `GANG.CST/0001 stdactor (who)` is `theset = actorset
 * (who)`, and `SALLOWER.SET/0001 openset ()`'s last `sendtoactor` on this
 * evening is Jones. Nothing in `salupper`'s `openset ()` touches an actor, so
 * walking upstairs leaves it where the bar put it.
 *
 * **`countsix` is not claimed, and the reason is a script and not the port.**
 * It is 4 in `D2E_001` and gone from `D2E_002`'s table altogether, and the only
 * two `dumpglobal countsix` lines in the corpus are in `MWIFE.PUP/0074` and
 * `/0076` — the Mayor's wife's day-2 and day-3 files. Her day-2 `runyoself ()`
 * sets `countsix = random (6) - 1` on the way in and dumps it on the way out,
 * and its `clock = 3` arm is a bare `error ()`. But she is not in the world on
 * this evening: `GANG.CST/0001 initactors ()` places nobody as `mwife` at
 * `day = 2, clock = 3`, and both saves have her invisible at `town.jones5`
 * exactly where the afternoon left her. Nothing a route can do reaches that
 * `dumpglobal`, so the rung neither claims the global nor pretends to explain
 * how the original lost it. (The list is one name long, so how much of a list
 * `dumpglobal` takes does not bear on it; it is a conversation that appears not
 * to have happened.)
 *
 * **`dirgo` is not claimed either, and the reason is Isao's idle rather than
 * his teardown.** `GANG.CST/0984 putdownactor ()` — his — is
 * `dumpglobal bouncer, dirgo`, and `SALLOWER.SET/0001 closeset ()` puts him
 * down the moment the route goes upstairs; `D2E_002` carries `dirgo = 1` and no
 * `bouncer` at all. That pairing once looked like evidence that a `dumpglobal`
 * list loses only its first name, and it is exactly the row
 * `docs/engine/scripting-language.md` withdraws: `isaoidle ()` assigns
 * `bouncer` on every pass and `dirgo` only at the ends of a 40° sweep, so which
 * of the two exists at any instant says how long Isao has been on screen, not
 * what the teardown took. The port destroys the whole list — which is what
 * `DF.EXE` does — and reaches the same standpoint with `dirgo` gone. Either
 * way it is one frame of an idle, not anything the route did.
 *
 * `counter`, `idlecount`, `attentionspan`, `FXCOUNT` and `stardy` are the
 * evening's bookkeeping — a brush-off counter, an idle stamp, an attention
 * stamp, a fade counter and the shooting star's drift — and none of them is a
 * consequence of a route.
 */
export const rung: Segment = {
  from: "D2E_001",
  to: "D2E_002",
  what: "the new sheriff's evening rounds, from the jail to Sophie's door",
  claims: [
    "dellphase", "helpphase", "mariephase", "buickphase", "sonomaphase",
    "saloonphase", "jonesphase", "oonaphase",
    "handitem", "loopsound", "theset", "townscene",
  ],
  async play(p) {
    const jail = set("JAIL");
    const town = set("NITE");
    const chin = set("CHIN");
    const court = set("NITECOUR");
    const sal = set("SALLOWER");
    const up = set("SALUPPER");
    const num = (name: string): number => Number(p.session.interp.globals.get(name) ?? 0);
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
     * Two reasons it is their CELL and not simply somewhere near.
     * `GANG.CST/0001 walktopuppet ()` — which is how both of the street's
     * conversations are opened — begins `thex = (playerxyz (1) / 256) -
     * (actorxyz (who, 1) / 256)`, the same for `they`, and `if thex != 0 &
     * they != 0 exitcode`: a click from a cell that shares neither row nor
     * column with them opens nothing and says nothing. And `hotdist ()` is 384
     * in the town, which is a cell and a half, so "near" is not a fact about
     * cells at all.
     *
     * The walk stops the moment a puppet appears, because it might not be ours
     * to drive: `marieidle ()` arms `hasattention (5)` and
     * `GANG.CST/0001 hasattention ()` fires `sendtoactor (target, mousedown
     * (0))` when the span runs out. `walkTo`'s own interruption handling
     * answers with `LEAVING`, and neither Marie's leaving line (202) nor
     * Buick's (102, before `luck ()`) is one `LEAVING` prefers — so a
     * conversation swallowed by the walker is a phase lost. Handing it straight
     * back to the caller is what keeps the answering in one place.
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

    // ---- 1. Dell, in his cell -----------------------------------------------
    await walkTo(p, jail, { x: 1, z: 1, view: "east" });
    await clickActor(p, "dell", "Dell in the jail");
    await answer(p, 101, "It's a free country.");
    await p.pump(() => !talking(), "Dell to finish");
    if (num("dellphase") !== 1) throw new Error(`dellphase is ${num("dellphase")}`);

    // ---- 2. out into the night town, at Scene G12 ---------------------------
    await walkTo(p, jail, { x: 0, z: 0, view: "west" });
    await openDoor(p, [183, 34, 361, 263], "lock", "the jail door", {
      set: jail, x: 0, z: 0, view: "west",
    });
    await p.pump(() => room(p).startsWith("nite"), "the street");
    if (p.session.currentSceneName()?.toLowerCase() !== "scene g12") {
      throw new Error(`the jail door came out at ${p.session.currentSceneName()}`);
    }

    // ---- 3. Help, on the doorstep ------------------------------------------
    await walkTo(p, town, { x: 6, z: 11, view: "east" }, talking);
    if (!talking()) await p.press("uparrow", "into Chin's, which is Help first");
    // no replies to prefer, because `belcherbeat ()` asks nothing — it is five
    // lines and a phase. The empty list is not a shrug: if a plaque DID appear
    // it would mean some other arm of `help1.pup` ran, and `talkOut` walks out
    // of a question it has no answer for rather than picking one blind.
    await talkOut(p, [], "Help's Belcher story", 2);
    if (num("helpphase") !== 1) throw new Error(`helpphase is ${num("helpphase")}`);

    // ---- 4. ...and into Chin's, which is where the save leaves him ----------
    await walkTo(p, town, { x: 6, z: 11, view: "east" });
    await openDoor(p, [218, 100, 278, 204], "chin", "Chin's door", {
      set: town, x: 6, z: 11, view: "east",
    });
    await p.pump(() => room(p).startsWith("chin"), "Chin's store");
    if (ask(p, "actorset", ["help"]).toLowerCase() !== "chin") {
      throw new Error(`Help is in ${ask(p, "actorset", ["help"])}, not the store`);
    }
    await openDoor(p, [100, 2, 408, 263], "rice", "Chin's door out", {
      set: chin, x: 0, z: 1, view: "west",
    });
    await p.pump(() => room(p).startsWith("nite"), "the street again");

    // ---- 5. Marie ----------------------------------------------------------
    await goToMeet("marie", "Marie in the street");
    await answer(p, 102, "No, I'm sheriff.");
    await answer(p, 101, "Are you angry?");
    await answer(p, 202, "Good night, Marie.");
    await p.pump(() => !talking(), "Marie to finish");
    if (num("mariephase") !== 1) throw new Error(`mariephase is ${num("mariephase")}`);

    // ---- 6. Buick ----------------------------------------------------------
    await goToMeet("buick", "Buick loose in the street");
    await answer(p, 102, "I should get moving.");
    if (num("buickphase") !== 1) throw new Error(`buickphase is ${num("buickphase")}`);
    await talkOut(p, [102, 101], "Buick's parting question", 2);

    // ---- 7. Sonoma, at the mission -----------------------------------------
    await openDoor(p, [160, 22, 338, 214], "court", "the mission gate", {
      set: town, x: 6, z: 3, view: "north",
    });
    await p.pump(() => room(p).startsWith("nitecour"), "the mission courtyard");
    await walkTo(p, court, { x: 2, z: 2, view: "north" }, talking);
    if (!talking()) await clickActor(p, "sonoma", "Sonoma in the courtyard");
    await answer(p, 101, "Who are you?");
    await p.pump(() => !talking(), "Sonoma to finish");
    if (num("sonomaphase") !== 1) throw new Error(`sonomaphase is ${num("sonomaphase")}`);
    await openDoor(p, [147, 37, 377, 263], "courtout", "the mission gate out", {
      set: court, x: 2, z: 4, view: "south",
    });
    await p.pump(() => room(p).startsWith("nite") && !room(p).startsWith("nitecour"), "the street");

    // ---- 8. the saloon door, once ------------------------------------------
    await openDoor(p, [241, 92, 307, 201], "saloon", "the saloon door", {
      set: town, x: 6, z: 7, view: "west",
    });
    await p.pump(() => room(p).startsWith("sallower"), "the bar");
    if (num("saloonphase") !== 1) throw new Error(`saloonphase is ${num("saloonphase")}`);
    if (String(p.session.interp.globals.get("townscene") ?? "").toLowerCase() !== "scene g8") {
      throw new Error(`townscene is "${p.session.interp.globals.get("townscene")}"`);
    }

    // ---- 9. Jones and Oona --------------------------------------------------
    await walkTo(p, sal, { x: 2, z: 2, view: "west" }, talking);
    if (!talking()) await clickActor(p, "jones", "Jones in the saloon");
    await answer(p, 103, "Goodbye");
    await p.pump(() => !talking(), "Jones to finish");
    if (num("jonesphase") !== 1) throw new Error(`jonesphase is ${num("jonesphase")}`);

    await walkTo(p, sal, { x: 3, z: 3, view: "north" }, talking);
    if (!talking()) await clickActor(p, "oona", "Oona at the bar");
    await answer(p, 203, "Time to go.");
    await p.pump(() => !talking(), "Oona to finish");
    if (num("oonaphase") !== 1) throw new Error(`oonaphase is ${num("oonaphase")}`);

    // ---- 10. up the stairs, and stop at Sophie's door -----------------------
    await walkTo(p, sal, { x: 3, z: 5, view: "west" });
    await p.press("uparrow", "up the saloon stairs");
    await p.pump(() => room(p).startsWith("salupper"), "the landing");
    await walkTo(p, up, { x: 0, z: 1, view: "east" });

    // ---- 11. the harmonica is what the hand carries out of here -------------
    await takeInHand(p, "Harmonica", "the harmonica");
  },
};
