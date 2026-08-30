import { answer, ask, clickActor, openDoor, room, set, walkTo, type Segment } from "../route";

/**
 * Day 3, afternoon: the Mayor in the street, the Doc's prescription, and in at
 * the apothecary.
 *
 * Fifty-four seconds of play, and the whole of it is one errand up the west side
 * of Main Street. `D3A_001` stands at TOWN Scene G11, cell (6,10); the doctor's
 * door is Scene G5, cell (6,4) (`TOWN.SET/0128`), and the apothecary's is
 * Scene G9, cell (6,8) (`TOWN.SET/0132`) — so the walk passes the second on its
 * way to the first and comes back to it.
 *
 * **`theset` is the Doc.** It ends "doctor1" while the standpoint is
 * `apoth.set`, because `GANG.CST/0001 stdactor (who)` opens `theset =
 * actorset (who)` and so `theset` names the last actor SET UP rather than the
 * room. That call is `DOCTOR1.SET/0001 openset ()` —
 * `sendtoactor ("doc", setupactor ("outer"))` — reaching `GANG.CST/0555`'s
 * "outer" arm, `actorset (me, "doctor1")` and `stdactor (me)`. The save agrees
 * twice over: the `Doc` record moves from `doctor2`/`doctor2.doc` to
 * `doctor1`/`doctor1.doc`, and it is invisible at the far end because leaving
 * the room ran `closeset ()`'s `putdownactor ()`.
 *
 * And nothing sets an actor up after him. `TOWN.SET/0001 openset ()` places no
 * actors at all, and `APOTH.SET/0001 openset ()` would — its last line is
 * `sendtoactor ("watson", setupactor ("store"))` — except that
 * `if day = 3 & clock > 1 passcode` stands in front of it, and a `passcode` ends
 * the handler and forwards the event on
 * ([the scripting language](../../../../docs/engine/scripting-language.md)).
 * The save is the control: the one line ABOVE that guard ran (`bottles` is set
 * up, `set = "drugs"`, visible) and the one below it did not (`Watson` is still
 * on `town.marie1` in both saves).
 *
 *  1. **Up to the doctor's door.** TOWN Scene G5, cell (6,4), facing west.
 *     `TOWN.SET/0128 lockdoctor ()` is open here: not day 5, `clock` is 2 rather
 *     than 3, the `day = 3 & clock = 1 & phase < 2` arm wants the morning, not
 *     day 4, and `fighton` is 0.
 *  2. **The Mayor, who has to be caught in passing.** `mayorphase = 1` has one
 *     writer reachable this afternoon: `MAYOR.PUP/0074 threepm ()`, the last
 *     statement of its 103 arm. Getting there means CLICKING him — his
 *     `mayoridle ()` (`GANG.CST/1097`) arms `hasattention (6)` only under
 *     `if day = 2 & clock = 2 & mayorphase = 0`, so on day 3 he never comes over
 *     by himself the way he does on the day-2 afternoon.
 *
 *     `initactors ()` set him up `day3PM` — `town.blood1` and a
 *     `moveactor ("town.blood2")` — and his `endwalk` bounces him straight back,
 *     so he is walking every frame of the afternoon and never stands still. The
 *     two stars are (2436,1132) and (2482,1670), both in column 9, but
 *     `walkonpath` takes the legs between them the long way round the block:
 *     measured, he runs (9,3) → (9,6) → (7,6) → (6,6) → (6,4) → (6,3) → (8,3)
 *     and round again, which is up and down the same stretch of Main Street the
 *     doctor's door is on. `D3A_002` corroborates it — it catches him at
 *     (2216,872), cell (8,3), nowhere near the straight line between his stars.
 *     So the rung stands at the door and waits for him to come past.
 *
 *     `clickActor` is not what does the clicking, because its first act is to
 *     wait out `iswalk (who)` — forty rounds of sixty ticks — and this is a man
 *     who never stops. What the click actually needs is the two gates his
 *     `mousedown` puts in the way: `realdist (me) < hotdist ()`, which is 384 in
 *     the town, and `GANG.CST/0001 walktopuppet ()`'s `if thex != 0 & they != 0
 *     exitcode` over the CELL deltas. `walktopuppet ()` handles the walking
 *     itself — `if iswalk (who) ... stopwalk (who)` — so being caught mid-stride
 *     is not the problem; being off both his row and his column is.
 *
 *     `threepm ()` is three plaque sets, each of whose replies all carry one id:
 *     **101** ("Who? Me?" / "As safe as can be expected." / "Don't worry about a
 *     thing."), **102** ("What precautions are those?" / "When will the Kid be
 *     here?" / "What should I do?"), **103** ("Why is that so important to you?"
 *     / "I guess you didn't see 'Dances With Wolves.'" / "What do you get out of
 *     all this?"). Only the third writes the phase. Its `puppetevent (240)` has
 *     a `case -2` that falls into `case 103`, so waiting it out would do as
 *     well; the first two are `puppetevent (-1)` with `case -1 exitcode`, so
 *     escaping either leaves `mayorphase` at 0.
 *  3. **Letting him off the doorstep.** In the town `walktopuppet ()` walks him
 *     to `playerxyz ()` itself, and only after `runpuppet ()` do
 *     `actorstar (who, savestar)` and `moveactor (savestar)` send him away.
 *     Until he has gone he is standing on the doctor's threshold, and
 *     `SetViewer.roomHitTest` answers `actor` before it answers the scene — the
 *     same trap `d3mclas` hits with Laurel at the courthouse. So the rung waits
 *     for him to be out of `hotdist ()` and off our row and column before it
 *     fires at the door.
 *  4. **In at the doctor's.** `TOWN.SET/0128`: `pointindoctor` 215,85-299,225,
 *     the `door` prop set to "doctor", `uparrow` →
 *     `gotointerior ("doctor1.set")`. That call writes `townscene = "Scene G5"`
 *     (`NEW.FLT/0001`), which is where it already stood. `DOCTOR1.SET` opens on
 *     its own default standpoint, Scene B1, cell (1,0), facing west — which is
 *     both the cell `doctor1.doc` (316,108) stands in and the cell whose east
 *     door leads back out.
 *  5. **The Doc.** His `mousedown` (`GANG.CST/0555`) is `runpuppet ("doc.pup")`
 *     behind nothing but `realdist (me) < hotdist ()` — 512 outside the four
 *     named sets, and the arrival standpoint is 71 units from him. There is no
 *     other way on: `DOCTOR1.SET/0036 lockrice ()` shuts the inner door for
 *     exactly this state (`day = 3 & clock = 2 & actorset ("doc") = "doctor1" &
 *     docphase != 8 & docphase != 10`), and even the `keydown` behind it runs
 *     `doc.pup` rather than going through.
 *
 *     `DOC.PUP/0041 runyoself ()` at `clock = 2` is `threepuzzle ()`, which
 *     switches on `docphase`; at 0 it speaks two lines and falls into
 *     `threepm ()`. **That is why the save reads 2 and not 1** — 1 is
 *     `threeam ()`'s "Bye, Doc." on a day-3 MORNING, a different clock and a
 *     different handler. `threepm ()` is three single-answer plaque sets,
 *     **101** ("What's wrong?" / "Is Trotter making that music?" / "Can you help
 *     him?"), **102** ("Where?"), **103** ("What do I need?"), and the 103 arm
 *     ends `sendtoshop ("inven", addinven ("RX"))` and `docphase = 2`. All three
 *     are `puppetevent (-1)` with `case -1 exitcode`, so `LEAVING` and ESC both
 *     walk out of the errand this rung is for.
 *
 *     `addinven ()` (`INVEN.PRP/0001`) is the whole of the `TAKE`: `handitem =
 *     newitem`, `propview (handitem, "large")`, `propxy (handitem, 316, 320)`,
 *     `propowner (newitem, "stranger")` and, because the panel is up,
 *     `propvisible (handitem, true)` — which is the `RX` record in `D3A_002`
 *     field for field.
 *
 *     The click is guarded rather than unconditional because the Doc can start
 *     this himself: `docidle ()` calls `hasattention (5)` while `docphase = 0`
 *     and we are inside `hotdist ()`, so a slower arrival finds him already
 *     talking. Measured, the arrival standpoint is the one the set opens on, so
 *     no walk happens and no five seconds pass, and the click is what runs.
 *  6. **Out, and down to the apothecary.** `DOCTOR1.SET/0036` facing east:
 *     `pointindoor` 204,67-321,263, the `door` prop "doc2", `uparrow` →
 *     `gototown (currentview ())`, which is `gotospecial ("town.set",
 *     townscene, "east")` — so the street is re-entered at Scene G5 facing east.
 *     Then TOWN Scene G9, cell (6,8), facing east; `TOWN.SET/0132
 *     pointinapoth` 218,94-286,205, the `door` prop "apoth", `uparrow` →
 *     `gotointerior ("apoth.set")`, which writes **`townscene = "Scene G9"`**.
 *     `APOTH.SET` opens on Scene C2, cell (2,1), facing west — the save's own
 *     standpoint, so the rung ends on the arrival.
 *  7. **`loopsound` is a fact about which cell the town was left from.**
 *     `TOWN.SET/0137 dayfxs ()` is a scene loop on Scene G14 that runs every two
 *     frames and picks the nearest ambience within 512 units: "outsidesaloon" at
 *     Scene G8, "chinchime" at Scene G12, "anvil" at Scene J5, "saw" at
 *     Scene B7. `D3A_001` was taken at Scene G11, 256 units from G12 — hence
 *     "chinchime". Scene G9 is 256 from G8 and 768 from G12, so the last pass
 *     before `gotointerior ()` leaves it on **"outsidesaloon"**, and
 *     `TOWN.SET/0001 closeset ()` stops the loop; `D3A_002` carries no
 *     `scene g14` loop at all, which is why the value freezes there.
 *     (`openset ()` zeroes `loopsound` on the way back IN, so re-entering the
 *     street after the doctor's costs nothing.)
 *
 * **Not claimed**, and why.
 *
 *   - `attentionspan` (105177 → 163470) is `frame ()`, stamped by
 *     `GANG.CST/0001 hasattention ()`. The only handler that calls it anywhere
 *     on this rung is the Doc's `docidle ()` — the Mayor's is gated on day 2,
 *     Leroy's wants `actorstar (me) = "town.leroy1"` and he is on `town.leroy2`,
 *     Laurel's and Marie's want the evening, Trotter's is armed for this hour
 *     but he is in `sallower` and invisible. So the number is a clock reading
 *     taken while standing in the doctor's front room, not a decision. (It is
 *     the same counter the thread is sorted by: `D3A_002` was written at frame
 *     163786, 316 frames after the stamp.)
 *   - `idlecount` (1 → 0) is `BOOTFILE/0001 idle ()`'s mod-4 counter, and
 *     `tumx2`/`tumy2` (419,2744 → 2433,2683) are where the tumbleweed is blowing
 *     to. Both saves carry the `kickme ()` loop; the numbers say how many frames
 *     went by rather than what was done in them.
 */
export const rung: Segment = {
  from: "D3A_001",
  to: "D3A_002",
  what: "the Mayor in the street, the Doc's prescription, and in at the apothecary",
  claims: ["mayorphase", "docphase", "handitem", "theset", "townscene", "loopsound"],
  async play(p) {
    const town = set("TOWN");
    const doctor1 = set("DOCTOR1");
    const num = (name: string): number => Number(p.session.interp.globals.get(name) ?? 0);
    const held = (): string => String(p.session.interp.globals.get("handitem") ?? "").toLowerCase();
    const talking = (): boolean => !!p.session.puppet;

    /**
     * Are the two gates on a click at somebody open from where we stand?
     *
     * `realdist (me) < hotdist ()`, which `GANG.CST/0001 hotdist ()` makes 384
     * in the town, and `walktopuppet ()`'s `if thex != 0 & they != 0 exitcode`
     * over the CELL deltas. Near is not enough and aligned is not enough.
     */
    const cell = (v: number): number => Math.floor(v / 256);
    const reach = (who: string): boolean => {
      const px = Number(ask(p, "playerxyz", [1]));
      const pz = Number(ask(p, "playerxyz", [2]));
      const ax = Number(ask(p, "actorxyz", [who, 1]));
      const az = Number(ask(p, "actorxyz", [who, 2]));
      return Math.hypot(px - ax, pz - az) < 384 && (cell(px) === cell(ax) || cell(pz) === cell(az));
    };

    // ---- 1-2. the doctor's doorstep, and the Mayor on his round -------------
    await walkTo(p, town, { x: 6, z: 4, view: "west" });
    const mayor = p.session.castScripts.get("mayor");
    if (!mayor) throw new Error('no cast script for "mayor" — is gang.cst open?');
    for (let i = 0; i < 40 && !talking(); i++) {
      await p.pump(() => reach("mayor") || talking(), "the Mayor to come back up Main Street");
      if (talking()) break;
      // not `clickActor`: it waits out `iswalk (who)` first, and his `endwalk`
      // turns him round the moment he arrives, so he is never not walking
      void p.session.track(
        p.session.interp.runHandler(mayor, "mousedown", ["mayor"], { me: "mayor", target: "mayor" }),
      );
      await p.settle("clicking the Mayor");
    }
    if (!talking()) throw new Error("the Mayor never answered — he never came within reach");
    let q = await answer(p, 101, "Who? Me?");
    q = await answer(p, 102, "What precautions are those?", q);
    await answer(p, 103, "What do you get out of all this?", q);
    await p.pump(() => num("mayorphase") === 1, "the Mayor to finish his warning");
    await p.pump(() => !talking(), "the Mayor to stop talking");

    // ---- 3-4. let him go, then the doctor's door ---------------------------
    await p.pump(() => !reach("mayor"), "the Mayor to walk off the doctor's threshold");
    await openDoor(p, [215, 85, 299, 225], "doctor", "the doctor's door", {
      set: town, x: 6, z: 4, view: "west",
    });
    await p.pump(() => room(p).startsWith("doctor1"), "the doctor's front room");
    if (String(p.session.interp.globals.get("theset") ?? "").toLowerCase() !== "doctor1") {
      throw new Error(`theset is "${p.session.interp.globals.get("theset")}" — openset () did not set the Doc up`);
    }

    // ---- 5. the Doc, and the prescription ----------------------------------
    // the set opens on Scene B1 facing west, which is his own cell; the walk is
    // a no-op there and a correction if it ever is not
    await walkTo(p, doctor1, { x: 1, z: 0, view: "west" }, talking);
    if (!talking()) await clickActor(p, "doc", "the Doc in his front room");
    let d = await answer(p, 101, "What's wrong?");
    d = await answer(p, 102, "Where?", d);
    await answer(p, 103, "What do I need?", d);
    await p.pump(() => num("docphase") === 2, "the Doc to write the prescription");
    await p.pump(() => !talking(), "the Doc to stop talking");
    if (held() !== "rx") throw new Error(`the hand carries "${held()}" out of the doctor's`);
    if (ask(p, "propowner", ["RX"]).toLowerCase() !== "stranger") {
      throw new Error(`the RX belongs to ${ask(p, "propowner", ["RX"])}`);
    }

    // ---- 6. out to the street, and down to the apothecary ------------------
    await openDoor(p, [204, 67, 321, 263], "doc2", "the doctor's door out", {
      set: doctor1, x: 1, z: 0, view: "east",
    });
    await p.pump(() => room(p).startsWith("town"), "the street again");
    if (p.session.currentSceneName()?.toLowerCase() !== "scene g5") {
      throw new Error(`the doctor's door came out at ${p.session.currentSceneName()}`);
    }
    await walkTo(p, town, { x: 6, z: 8, view: "east" });
    await openDoor(p, [218, 94, 286, 205], "apoth", "the apothecary's door", {
      set: town, x: 6, z: 8, view: "east",
    });
    await p.pump(() => room(p).startsWith("apoth"), "the apothecary");
  },
};
