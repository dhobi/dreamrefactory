import { answer, ask, clickActor, openDoor, room, set, walkTo, type Segment } from "../route";

/**
 * Day 3, morning: Laurel at the corner, Sonoma at the mission, and in at the
 * schoolhouse.
 *
 * Fifty seconds of play, and the shape of it is in the last three globals of the
 * diff. `townscene` ends "Scene G4", which is the COURTHOUSE cell of the town
 * (`TOWN.SET/0127`, cell (6,3)); `theset` reads "court"; and yet the standpoint
 * is `school.set`. The school is not reached off the street. It is reached
 * through the mission: `COURT.SET/0046` is the courtyard's middle cell, and its
 * `mousedown` is `sendtoprop ("door", setupprop ("schoolin"))` with its `keydown`
 * `gotointerior ("school.set")`. `lockrice ()` in the same file is
 * `if day < 3 return true`, so day 3 is the first morning that door opens at
 * all — which is why this rung sits where it does in the thread.
 *
 *  1. **The courthouse corner.** TOWN Scene G4, cell (6,3), facing north. The
 *     walk from Scene K11 is uninterrupted, and that is a fact about the hour
 *     rather than about luck: at `day = 3, clock = 1` no `*idle ()` in
 *     `GANG.CST` calls `hasattention ()`. Laurel's (`GANG.CST/0594`) is gated on
 *     `day = 3 & clock = 3`, Leroy's (`GANG.CST/0002`) on
 *     `actorstar (me) = "town.leroy1"` and `D3M_003` has him on `town.leroy2`.
 *  2. **Laurel, who has to be MET.** `GANG.CST/0594 setupactor ("day3am")` puts
 *     her on `town.mwife1` and `moveactor ("town.mwife2")`s her, and her
 *     `endwalk` sends her straight back the other way — so all morning she paces
 *     between (1596,904) and (852,2232), which is cell (6,3) and cell (3,8). The
 *     top of that path is the courthouse cell itself, and it is the only place
 *     she can be reached from the door. Her `mousedown` wants
 *     `realdist (me) < hotdist ()` — 384 in the town — and `walktopuppet ()`
 *     (`GANG.CST/0001`) opens nothing at all unless the CELL delta is zero in x
 *     or in z. So the route waits for both to be true and then clicks, instead
 *     of clicking on a schedule and hoping one lands.
 *  3. **Her day-3 morning.** `LAUREL.PUP/0041 runyoself ()` at `clock = 1` is
 *     `threeam ()`: five spoken lines and then three plaque pairs — 101 ("Why?"
 *     / "Are you angry?"), 102 ("What happened next?" / "Is Jackalope still
 *     alive?"), 111 ("Where's he now?" / "Do you think he's sorry?") — with
 *     `laurelphase = 1` written inside the 111 arm after `laurel.99`..`103`.
 *     Answered by id because there is no leaving line here: each of the three is
 *     the only way on, and every `case -1` is an `exitcode` that leaves the
 *     phase at 0.
 *  4. **Getting her out of the doorway.** In the town `walktopuppet ()` walks
 *     the character to `playerxyz ()` itself, and only on the far side of
 *     `runpuppet ()` do `actorstar (who, "resume")` and `moveactor (savestar)`
 *     send her back down the path. Until she has gone she is drawn over the
 *     courthouse and the door click hits HER. That was the whole of one failure:
 *     `openDoor` fired six times at 249,118 with `laurelphase` already 1, the
 *     `door` prop never became "court", and the distance between her and the
 *     player measured 0. Waiting for the conversation to close is not enough —
 *     that was measured too, and it fails the same way. Waiting for her to be
 *     out of `hotdist ()` and off our row and column is.
 *  5. **In at the courthouse.** `TOWN.SET/0127`: Scene G4 facing north,
 *     `pointincourt` 160,22-338,214, the `door` prop set to "court", and
 *     `uparrow` → `gotointerior ("court.set")` because `clock != 3`.
 *     `lockcourt ()` is open here — not day 5, and `fighton` is 0. The
 *     `gotointerior ()` is what writes `townscene = "Scene G4"`, and `COURT.SET`
 *     opens on its own default standpoint, Scene C5 facing north.
 *  6. **Sonoma, whom the courtyard sets up.** `COURT.SET/0001 openset ()`:
 *     `if day = 3 & clock = 1 & sonomaphase = 0 & phase > 2
 *     sendtoactor ("sonoma", setupactor ("mission"))`, and `D3M_003` reads 3, 1,
 *     0 and 3. That call goes through `GANG.CST/1419 setupactor ()` →
 *     `stdactor (me)` → `theset = actorset (who)` = "court", which is the whole
 *     of the `theset` claim: `theset` names the last actor SET UP and not the
 *     room, and nothing is set up in the school afterwards — `SCHOOL.SET/0001`
 *     has no `openset ()` at all. Sonoma's own `mousedown` is
 *     `runpuppet ("sonoma.pup")` direct, with no `walktopuppet ()`, so it asks
 *     only for `realdist (me) < hotdist ()` (512 outside the four named sets)
 *     and she stands on Scene C3's own centre, (640,640).
 *  7. **Her day-3 conversation.** `SONOMA.PUP/0007 runyoself ()` forwards to the
 *     "day3" puppet; `SONOMA.PUP/0039 threeam ()` opens with 111 ("Are you
 *     Sonoma?") and then a `while true` whose 103 arm ("Why do you stay?" / "Do
 *     you seek justice?") calls `stay ()`. `stay ()` is a straight line of
 *     single-answer plaques — 111, 102, 103, 104, 103 — and `sonomaphase = 1` is
 *     its last statement, after `sendtoactor ("SONOMA", putdownactor ())`. All
 *     five have a `case -1 exitcode`, so escaping any one of them leaves the
 *     phase at 0, and `LEAVING` would escape: its 102 is offered by the outer
 *     loop and leads into `teach ()`, never into `stay ()`.
 *  8. **The schoolhouse.** `COURT.SET/0046` again: Scene C3 facing north,
 *     `pointinrice` 148,45-355,263, the `door` prop set to "schoolin", `uparrow`
 *     → `gotointerior ("school.set")`. `SCHOOL.SET` opens on its default
 *     standpoint (1,1) facing north, which is Scene B2 — the save's own
 *     standpoint — so the rung ends on the arrival and nothing further is
 *     walked.
 *
 * **Not claimed**, and why.
 *
 *   - `saveitem` and `borrowgun`, which `D3M_CLAS` holds as numeric 0 and 0.
 *     Both belong to `LEROY.PUP/0088`'s `dumpglobal borrowgun, saveitem`, the
 *     last line of `aftertarget ()` — which the rung BEFORE this one ran, since
 *     `runyoself ()` reaches it on `leroyphase = 3` and then writes
 *     `leroyphase = 0`, and `D3M_003` reads 0. `D3M_003` is itself a control for
 *     the question left open in
 *     [the scripting language](../../../../docs/engine/scripting-language.md):
 *     after that `dumpglobal`, the save has NO `borrowgun` node and still has
 *     `saveitem = "sugarcubes"` — the first name of the list destroyed and the
 *     second left standing, which is what the five teardowns tabulated there
 *     say and not what this port does. `D3M_CLAS` then carries both as freshly
 *     made numeric zeroes, in adjacent nodes, in declaration order: a
 *     `global borrowgun, saveitem` that ran with neither of them present.
 *     Nothing on this route runs one — `runyoself ()` declares neither, and
 *     reaching `beforetarget ()` means clicking Leroy, who is on `town.leroy2`
 *     at the far corner of the town. So the port carries "sugarcubes" through to
 *     the end (measured), and a claim here would be failing about `dumpglobal`
 *     rather than about this rung.
 *   - `counter` (1 → 2) is the shared scratch counter every `brushoff ()` in the
 *     corpus advances. `SONOMA.PUP/0039 runyoself ()` routes to
 *     `SONOMA.PUP/0009 brushoff ()` once `sonomaphase = 1`, and its `case 1` is
 *     `puppetspeak ("sonoma.10")` and `counter = 2`. Reaching the save's 2 means
 *     one further click on Sonoma after she is finished and `putdownactor ()`
 *     has made her invisible. Measured 1.
 *   - `idlecount` (1 → 0) is `BOOTFILE/0001 idle ()`'s mod-4 counter — which
 *     quarter of the idle cycle the save happened to be written in.
 *   - `tumx2`/`tumy2` are where the tumbleweed is blowing to, in world units,
 *     picked out of `random ()` by `HOUSE.PRP/0174 waithide ()` and steered to
 *     by its `kickme ()` loop. Both saves carry that loop; the numbers say how
 *     many frames went by, not what was done in them.
 */
export const rung: Segment = {
  from: "D3M_003",
  to: "D3M_CLAS",
  what: "Laurel at the corner, Sonoma at the mission, and in at the schoolhouse",
  claims: ["laurelphase", "sonomaphase", "theset", "townscene"],
  async play(p) {
    const town = set("TOWN");
    const court = set("COURT");
    const num = (name: string): number => Number(p.session.interp.globals.get(name) ?? 0);

    /**
     * Is Laurel clickable from where we stand?
     *
     * The two gates her `mousedown` puts in the way, asked of the world rather
     * than assumed: `realdist (me) < hotdist ()`, which is 384 in the town, and
     * `walktopuppet ()`'s `if thex != 0 & they != 0 exitcode`, where those are
     * the CELL deltas. Near is not enough and aligned is not enough.
     */
    const cell = (v: number): number => Math.floor(v / 256);
    const reach = (): boolean => {
      const px = Number(ask(p, "playerxyz", [1]));
      const pz = Number(ask(p, "playerxyz", [2]));
      const lx = Number(ask(p, "actorxyz", ["laurel", 1]));
      const lz = Number(ask(p, "actorxyz", ["laurel", 2]));
      return Math.hypot(px - lx, pz - lz) < 384 && (cell(px) === cell(lx) || cell(pz) === cell(lz));
    };

    // ---- 1-3. the corner, and Laurel at the top of her path ----------------
    await walkTo(p, town, { x: 6, z: 3, view: "north" });
    await p.pump(reach, "Laurel to pace back up to the courthouse corner");
    await clickActor(p, "laurel", "Laurel at the courthouse corner");
    let q = await answer(p, 101, "Why?");
    q = await answer(p, 102, "What happened next?", q);
    q = await answer(p, 111, "Where's he now?", q);
    await p.pump(() => num("laurelphase") === 1, "Laurel to finish her story");

    // ---- 4-5. let her go, and then the courthouse door ---------------------
    await p.pump(() => !reach(), "Laurel to walk back off the doorstep");
    await openDoor(p, [160, 22, 338, 214], "court", "the courthouse door", {
      set: town, x: 6, z: 3, view: "north",
    });
    await p.pump(() => room(p).startsWith("court"), "the mission courtyard");

    // ---- 6-7. Sonoma, to the end of `stay ()` ------------------------------
    await walkTo(p, court, { x: 2, z: 2, view: "north" }, () => !!p.session.puppet);
    if (!p.session.puppet) await clickActor(p, "sonoma", "Sonoma in the courtyard");
    let s = await answer(p, 111, "Are you Sonoma?");
    s = await answer(p, 103, "Do you seek justice?", s);
    s = await answer(p, 111, "What do you mean?", s);
    s = await answer(p, 102, "Can I help?", s);
    s = await answer(p, 103, "What's that?", s);
    s = await answer(p, 104, "You're talking about the Devil's Breath Mine?", s);
    s = await answer(p, 103, "How will I know what these items look like?", s);
    await p.pump(() => num("sonomaphase") === 1, "Sonoma to give us the mission");

    // ---- 8. through the rice-paper door, into the schoolroom ---------------
    await openDoor(p, [148, 45, 355, 263], "schoolin", "the schoolhouse door", {
      set: court, x: 2, z: 2, view: "north",
    });
    await p.pump(() => room(p).startsWith("school"), "the schoolroom");
  },
};
