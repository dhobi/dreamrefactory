import { excuseUs, openDoor, room, set, walkTo, type Segment } from "../route";

/**
 * Day 3, into the night: out of the doctor's, and the afternoon runs out.
 *
 * Twenty seconds, and nearly the whole diff is one call — `NEW.FLT/0001
 * advanceday ()`. `day = 3, clock = 2` takes the "under 3" arm
 * (`clock = clock + 1`), zeroes `phase`, writes `townscene = "scene g5"`, plays
 * `d3ad3n.mov` and re-seats the world with `initall ("town", "nite.set")`.
 * Everything else in the diff comes out of `initall ()`: it clears `handitem`
 * (`if handitem != "" … handitem = ""`, which is Nate Trotter's flute), and it
 * calls `GANG.CST/0001 initactors ()`, whose per-actor `initactor ()` zeroes the
 * nine phases this rung claims — `GANG.CST/0555`'s is `docphase = 0`,
 * `GANG.CST/1086`'s `deadphase = 0`, `GANG.CST/0594`'s `laurelphase = 0`, and
 * every cast entry has the same shape.
 *
 * This is `d3a001`'s mechanism one clock-tick later, and the differences are
 * what the rung is made of.
 *
 *   1. **It starts indoors.** `D3A_004` is the standpoint `DOCTOR2.SET/0001
 *      openset ()` forces — Trotter in the inner room, `currentview ("south")` —
 *      and the counter that turns the day is `TOWN.SET`'s. So the first move is
 *      the way out: `DOCTOR2.SET/0034`'s `pointindoor` (205,68-319,262) facing
 *      east sets the `door` prop to "doc4", and its `uparrow` is
 *      `gotospecial ("doctor1.set", "scene b1", "east")`. Then
 *      `DOCTOR1.SET/0036`'s `pointindoor` (204,67-321,263), `door` = "doc2", and
 *      `gototown (currentview ())`. Neither door is shut: both `lockdoor ()`s
 *      test `docphase = 8` (or nothing at all) and `docphase` is 9, which is what
 *      `TROTTER.PUP/0075` left when it handed over the flute. Trotter himself
 *      lets us go — `GANG.CST/0670 trotteridle ()` only calls `hasattention (4)`
 *      while `trotterphase = 0`, and the flute set it to 1.
 *
 *      `gototown ()` reads the clock: `if clock = 3` it opens `nite.set`,
 *      otherwise `town.set`. It is still 2 here, so the street we come out into
 *      is the afternoon's, at `townscene` — "Scene G5", the cell
 *      `gotointerior ()` recorded when the player went in.
 *   2. **Nothing has to be fetched.** `TOWN.SET/0001 openscene ()` counts down
 *      only while `canadvance ()` is true, and `canadvance ()` for
 *      `day = 3, clock = 2` is `propowner ("mask") = "stranger" & propowner
 *      ("yunnibook") = "stranger" & propowner ("flute") = "stranger"`. All three
 *      read "stranger" in `D3A_004` — the flute arrived on the rung before this
 *      one — so the gate is open from the first step and there is no errand in
 *      this rung at all. (Each day-and-clock asks a different question: the
 *      morning's was the ring and the pages, day 2's was `day2items () > 1`.)
 *   3. **So the only thing to do is walk.** `openscene ()` decrements
 *      `scenecounter` once per scene entered and, at zero, arms
 *      `makeloop ("scene", currentscene (), "triggerx", 30)`; `triggerx ()`
 *      silences `loopsound` and calls `advanceday ()`. `D3A_004` has
 *      `scenecounter = 0`, and a load fires no `openscene`, so the first cell
 *      entered takes the `else` arm and seeds it `5 + random (10)` — the count
 *      is made up on the spot and the route walks the street and watches the
 *      clock rather than counting steps. `toonear (300)` skips the arming while
 *      a cast member is close, which is another reason to cover ground.
 *
 *      Two details of the count are worth having written down, because they are
 *      what makes "walk until the clock moves" the honest shape here rather than
 *      a shrug. The counter ticks on every `openscene`, and `openscene` is fired
 *      by a TURN as well as a step — measured: `leftarrow` on Scene G13 walks
 *      it 3, 2, 1, 0 without moving the player at all. But twelve of the town's
 *      cells own an `openscene` that ends without `passcode`, so the event is
 *      consumed before the set main's counter ever sees it, and standing on one
 *      of them is free. Five are on this street: `TOWN.SET/0127` (Scene G4),
 *      `/0128` (G5), `/0131` (G8), `/0135` (G12) and `/0137` (G14) — the last is
 *      the `dayfxs`/`nightfxs` container, and a full circle there leaves the
 *      counter untouched. Which cell the count runs out on is therefore a
 *      function of the seed and of which doorways the walk happens to pass, and
 *      not something a route can name in advance.
 *   4. **Where it stops, and why it does not linger.** `initall ()` re-seats the
 *      standpoint only when the set is a different one — `if currentset () =
 *      newname / thescene = currentscene ()` — and `nite.set`'s set name is
 *      "town", the same as `town.set`'s, so the night opens on the cell the
 *      afternoon ended on. `D3E_001` is NITE Scene G9 (cell 6,8) facing south,
 *      and the save says the original's counter ran out exactly there: its own
 *      frame is 167526 and `vitalframe`, which is `frame ()` taken inside
 *      `advanceday ()`, is 167461 — sixty-five frames, most of them
 *      `premovie ()`'s and `postmovie ()`'s fades, which is not a walk.
 *
 *      This route cannot ask for that cell (see 3), so it walks to it after the
 *      turn instead — the same shape `d3a001` uses. What it must not do is stand
 *      there. Scene G9 is one cell south of Laurel, whom `initactors ()`'s
 *      `day = 3 & clock = 3` arm has just put at `town.jones1` (1624,1872), and
 *      `GANG.CST/0594 laurelidle ()` calls `hasattention (5)` for as long as
 *      `laurelphase = 0`. Measured from the finished standpoint: `curattention`
 *      becomes "laurel" after about 180 service passes and her puppet opens
 *      about 240 after that. `LAUREL.PUP/0053 runyoself ()`'s `case 3` runs
 *      `twonite ()` and then `putdownactor ()` and **`phase = 1`** whatever the
 *      conversation did — ESC included, since `puppetevent (-1)` only exits
 *      `twonite ()`. So `phase = 0` in `D3E_001` is not decoration: it says the
 *      original saved before Laurel crossed the street, and it is why this rung
 *      ends on the first tick that gives it what it came for rather than on a
 *      settle. The save's own `attentionspan` — 167497, thirty-six frames after
 *      `advanceday ()` and twenty-nine before the save — is the same fuse
 *      burning.
 *   5. **`loopsound`.** `NITE.SET/0137 nightfxs ()` runs on Scene G14 every two
 *      ticks and picks the nearest source within `256 * 2`: the saloon at Scene
 *      G8, and Chin's at Scene G12. From G9 the saloon is one cell away (256)
 *      and Chin's is three (768, out of range), so `fxsound` — and then
 *      `loopsound` — is "outsidesaloon". `openset ()` had just cleared it to ""
 *      as `nite.set` opened, so it is the standpoint that puts it back, and
 *      waiting for it is also the check that the night is really laid out.
 *
 * `scenecounter` is claimed as 0 rather than left as bookkeeping: `openset ()`
 * sets it to 0 as `nite.set` opens, and the night never re-seeds it, because
 * `canadvance ()` for `day = 3, clock = 3` is a bare `return false` and
 * `openscene ()` falls past the counter into the robber clause — which wants
 * `clock < 3`. `phase` and `townscene` are claimed for the reasons above.
 * `theset` is claimed too, on `d3a004`'s reading of it: it is written only by
 * `GANG.CST/0001 stdactor (who)` — `theset = actorset (who)` — so it names the
 * set of the last actor anybody stood up, and after `initactors ()` that is
 * Jones or Laurel in "town".
 *
 * **Not claimed**, of what is left in the diff.
 *
 *   - `vitalframe` and `attentionspan` are frame stamps, taken by
 *     `advanceday ()` and `hasattention ()`: how long the run took to get here,
 *     not what it did. `idlecount` is `BOOTFILE/0001 idle ()`'s own counter,
 *     which cycles 0-3 forever.
 *   - `tumx2`/`tumy2` are where the tumbleweed will blow in from next, rolled
 *     with `random ()` in `HOUSE.PRP/0174 waithide ()`.
 */
export const rung: Segment = {
  from: "D3A_004",
  to: "D3E_001",
  what: "out of the doctor's, and the afternoon runs out",
  claims: [
    "clock", "phase", "handitem", "townscene", "theset", "loopsound",
    "scenecounter", "deadphase", "dellphase", "docphase", "fearphase",
    "laurelphase", "mariephase", "mayorphase", "mwifephase", "trotterphase",
  ],
  async play(p) {
    const clock = (): number => Number(p.session.interp.globals.get("clock") ?? 0);
    const held = (): string => String(p.session.interp.globals.get("handitem") ?? "");
    const noise = (): string => String(p.session.interp.globals.get("loopsound") ?? "");

    /*
     * 1. Out through both of the doctor's doors. The `uparrow` behind each is
     * gated on the `door` prop, so `openDoor` is what says the click landed;
     * `gototown ()` picks the set off the clock, and at 2 that is `town.set`.
     */
    await openDoor(p, [205, 68, 319, 262], "doc4", "the doctor's inner door", {
      set: set("DOCTOR2"), x: 0, z: 0, view: "east",
    });
    await openDoor(p, [204, 67, 321, 263], "doc2", "the doctor's door out", {
      set: set("DOCTOR1"), x: 1, z: 0, view: "east",
    });
    await p.pump(() => room(p) === "town", "the street outside the doctor's");

    /*
     * 3. Up and down the one street the town has, until the count runs out. The
     * pair of ends is arbitrary — the walk is what `openscene ()` counts, so
     * laps are the whole move — but they are all in column 6, because the town's
     * graph does not join every cell to every other and a `walkTo` that cannot
     * plan a route throws. `stopWhen` leaves the moment the clock moves.
     */
    const town = set("TOWN");
    const ends: [number, number, string][] = [
      [6, 12, "south"], [6, 3, "north"], [6, 11, "south"], [6, 4, "north"],
    ];
    for (let lap = 0; lap < 12 && clock() < 3; lap++) {
      const [x, z, view] = ends[lap % ends.length];
      await walkTo(p, town, { x, z, view }, () => clock() >= 3);
      await excuseUs(p, "anyone who stops us");
    }
    if (clock() < 3) throw new Error("the afternoon never ended");

    /*
     * `clock` moves in the first lines of `advanceday ()` and the film is three
     * lines further down, so the lap loop leaves while `d3ad3n.mov` is still
     * running. `initall ()` — and its `handitem = ""` — is on the far side of
     * it, which makes an empty hand, in the night town, the signal that the
     * world has actually been laid out again.
     */
    await p.pump(() => held() === "" && room(p) === "nite", "d3ad3n.mov, and the night laid out");
    await p.settle("the night");

    /*
     * 4. To Scene G9 facing south, ESC-ing past anyone who comes over rather
     * than answering. Laurel's night conversation cannot be answered safely at
     * all — every way out of `LAUREL.PUP/0053 runyoself ()`'s `case 3` ends in
     * `phase = 1` — so the point of `excuseUs` here is to spend as few passes
     * near her as possible, and of the loop to keep re-planning from wherever
     * an interruption left us.
     */
    const nite = set("NITE");
    const there = (): boolean =>
      p.session.currentSceneName()?.toLowerCase() === "scene g9" &&
      p.session.currentViewName()?.toLowerCase() === "south";
    for (let go = 0; go < 8 && !there(); go++) {
      await excuseUs(p, "whoever comes over in the new night");
      await walkTo(p, nite, { x: 6, z: 8, view: "south" }, () => there() || !!p.session.puppet);
    }
    await excuseUs(p, "whoever came over last");
    if (!there()) await walkTo(p, nite, { x: 6, z: 8, view: "south" });

    // and `nightfxs ()` runs every other tick — one is enough to hear the saloon
    await p.pump(() => noise().toLowerCase() === "outsidesaloon", "the saloon next door");
  },
};
