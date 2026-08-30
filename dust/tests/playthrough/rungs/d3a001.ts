import { excuseUs, room, set, walkTo, type Segment } from "../route";

/**
 * Day 3, into the afternoon: the morning turns by walking.
 *
 * Fourteen seconds of play, and almost the whole diff between the two saves is
 * one call — `NEW.FLT/0001 advanceday ()`. With `day = 3` and `clock = 1` it
 * takes the "under 3" arm (`clock = clock + 1`), zeroes `phase`, writes
 * `townscene = "scene g5"`, and then plays `d3md3a.mov` and re-seats the world
 * with `initall ("town", "town.set")`. `initall ()` is where everything else in
 * the diff comes from: it clears `handitem` (`if handitem != "" …
 * handitem = ""`), it clears `rubyphase` and `sophiephase` itself, and it calls
 * `GANG.CST/0001 initactors ()`, whose per-actor `initactor ()` zeroes each of
 * the other twelve (`GANG.CST/0267`'s is `jonesphase = 0`, `GANG.CST/1097`'s is
 * `mayorphase = 0`, and every cast entry has the same shape). `initall ()` also
 * re-seats the standpoint only when the set is a different one — `if currentset
 * () = newname / thescene = currentscene ()` — and here it is the same town, so
 * the afternoon opens exactly where the morning ended.
 *
 * This is `segment9`'s mechanism played again a day later, and the gates are
 * day 3's, not day 2's:
 *
 *   1. **Nothing has to be fetched first.** `TOWN.SET/0001 openscene ()` only
 *      counts down while `canadvance ()` is true, and `canadvance ()`
 *      (`NEW.FLT/0001`) for `day = 3, clock = 1` is
 *      `propowner ("ring") = "jones" & propowner ("pages") = "stranger"`. On the
 *      rung before this one both were false; `D3M_005` records `Ring:jones` and
 *      `Pages:stranger`, so the gate is already open when the rung starts and
 *      there is no errand in it. (Day 2's gate was `day2items () > 1` and day
 *      3's afternoon gate wants the mask, the Yunni book and the flute — a
 *      different question each time, which is why this rung reads the day-3
 *      arm rather than reusing segment 9's.)
 *   2. **So the only thing to do is walk.** `openscene ()` decrements
 *      `scenecounter` once per scene entered and, at zero, arms
 *      `makeloop ("scene", currentscene (), "triggerx", 30)`; `triggerx ()`
 *      silences `loopsound` and calls `advanceday ()`. `D3M_005` has
 *      `scenecounter = 10`, so ten cells of street are what the morning has
 *      left — but the counter is re-seeded `5 + random (10)` whenever it is
 *      already at zero, so the route walks laps and watches the clock instead
 *      of counting steps. The turn at each end matters: the arming is skipped
 *      while `toonear (300)` is true, so covering ground beats pacing.
 *   3. **The laps are quiet, and the walk afterwards is not.** Eleven of the
 *      thirteen `hasattention` calls in `GANG.CST` are gated on a day and a
 *      clock, and not one of those names day 3's morning: Jones's is day 1 and
 *      day 2 (`GANG.CST/0267`), the Mayor's day 2 at noon (`GANG.CST/1097`),
 *      Marie's day 2 at night (`GANG.CST/1343`), Trotter's day 3 at *noon*
 *      (`GANG.CST/0670`), Laurel's day 3 at *night* (`GANG.CST/0594`). The two
 *      that are not day-gated are Doc's (`GANG.CST/0555`, `docphase = 0`), who
 *      is not in the street at all, and Leroy's (`GANG.CST/0002`, `actorstar
 *      (me) = "town.leroy1" & leroyphase = 0`), who is — `initactors ()` puts
 *      him on the shooting range for the day-3 morning, and `town.leroy1` is
 *      1740,3536, inside `hotdist ()`'s 384 of the southern end of these laps.
 *      He never actually stopped the walk in seven measured runs and
 *      `leroyphase` was 0 at the end of every one, but the laps carry
 *      `excuseUs` between them because he could.
 *
 *      After the clock turns the street is busy on purpose:
 *      `initactors ()`'s `day = 3 & clock = 2` arm places the Mayor, his wife,
 *      Jones and Watson, and `initactor ()` has just put every phase back to 0,
 *      which is the state each of those `hasattention` calls wants. So the walk
 *      to the saved standpoint answers nobody — `stopWhen` hands each
 *      conversation back before `walkTo` can reply to it, and `excuseUs`
 *      presses ESC (`puppetevent (-1)`) instead. Answering would be worse than
 *      slow: the Mayor's day-3 exit line is also `mayorphase = 1`, and this
 *      rung claims that phase is 0.
 *   4. **Where it stops.** `D3A_001` is taken at TOWN Scene G11 (cell 6,10)
 *      facing north, one cell north of Chin's at Scene G12, and that is what
 *      `loopsound` is about. `TOWN.SET/0137 dayfxs ()` runs on `scene g14`
 *      every two ticks and picks the nearest of four sources within
 *      `256 * 2` units; from G11 the distance to G12 is one cell, 256, and
 *      nothing else is closer, so `fxsound` — and then `loopsound` — is
 *      "chinchime". `openset ()` had just cleared it to "" as the set reopened,
 *      so it is the standpoint that puts it back.
 *
 * `scenecounter` is claimed as 0 rather than left as bookkeeping, because it is
 * the mechanism's own state and the zero is argued: `closeset ()` sets it to 0
 * on the way out, and the afternoon does not re-seed it, since `canadvance ()`
 * for `day = 3, clock = 2` wants `propowner ("flute") = "stranger"` and the
 * flute is nobody's in either save — so `openscene ()` now falls past the
 * counter into the robber clause.
 *
 * **Not claimed**, of what is left in the diff.
 *
 *   - `theset` is a scratch global `GANG.CST/0001 stdactor ()` overwrites with
 *     `actorset (who)` on every actor it seats, so what it ends on is whichever
 *     cast entry the loop touched last — the same argument `d3m001` makes.
 *   - `playerdowncard` and `dealerdowncard` read "" in `D3M_005` and "town" in
 *     `D3A_001`, and no script assigns them outside the blackjack table
 *     (`SALGAMES.FLT/0008`), which nothing here goes near. They are the third
 *     and fourth names of `SALGAMES.FLT/0001`'s
 *     `dumpglobal playercount, playerstand, playerdowncard, playerbj` and
 *     `dumpglobal dealertotal, dealercount, dealerstand, dealerdowncard,
 *     dealerbj`. A `dumpglobal` list destroys every name on it
 *     (`docs/engine/scripting-language.md`), so both were dead long before this
 *     afternoon, and what the save shows is a slot that later writing reused —
 *     the value they land on is "town", which is what `theset` was written
 *     with a moment earlier. A claim on them would be a claim about which dead
 *     record the allocator happened to land on, not about the afternoon.
 *   - `vitalframe` is `frame ()`, taken inside `advanceday ()`: how long the run
 *     took to get here, not what it did.
 */
export const rung: Segment = {
  from: "D3M_005",
  to: "D3A_001",
  what: "the morning turns by walking",
  claims: [
    "clock", "phase", "handitem", "townscene", "loopsound", "scenecounter",
    "buickphase", "dellphase", "fearphase", "helpphase", "jonesphase",
    "laurelphase", "mariephase", "mayorphase", "mwifephase", "oonaphase",
    "rubyphase", "sonomaphase", "sophiephase", "trotterphase",
  ],
  async play(p) {
    const town = set("TOWN");
    const clock = (): number => Number(p.session.interp.globals.get("clock") ?? 0);
    const held = (): string => String(p.session.interp.globals.get("handitem") ?? "");
    const noise = (): string => String(p.session.interp.globals.get("loopsound") ?? "");

    /*
     * 2. Up and down the one street the town has, until the counter runs out.
     * The pair of ends is arbitrary — any two the graph connects would do — and
     * the walk is what `openscene ()` counts, so laps are the whole move.
     */
    const ends: [number, number, string][] = [
      [6, 12, "south"], [6, 3, "north"], [4, 11, "south"], [6, 5, "north"],
    ];
    for (let lap = 0; lap < 12 && clock() < 2; lap++) {
      const [x, z, view] = ends[lap % ends.length];
      await walkTo(p, town, { x, z, view }, () => clock() >= 2);
      await excuseUs(p, "anyone who stops us");
    }
    if (clock() < 2) throw new Error("the morning never ended");

    /*
     * `clock` moves in the first lines of `advanceday ()` and the film is three
     * lines further down, so the lap loop leaves while `d3md3a.mov` is still
     * running. `initall ()` — and its `handitem = ""` — is on the far side of
     * it, which makes an empty hand the signal that the afternoon has actually
     * been laid out and the town is walkable again.
     */
    await p.pump(
      () => held() === "" && room(p) === "town",
      "d3md3a.mov, and the afternoon laid out",
    );
    await p.settle("the afternoon");

    /*
     * 3-4. To Scene G11 facing north, ESC-ing past the day-3 afternoon cast
     * rather than answering it. `stopWhen` hands every conversation back here
     * before `walkTo` can reply to it, because the replies that end these
     * conversations are also the ones that set the phases this rung claims.
     */
    const there = (): boolean =>
      p.session.currentSceneName()?.toLowerCase() === "scene g11" &&
      p.session.currentViewName()?.toLowerCase() === "north";
    for (let go = 0; go < 8 && !there(); go++) {
      await excuseUs(p, "whoever comes over in the new afternoon");
      await walkTo(p, town, { x: 6, z: 10, view: "north" }, () => there() || !!p.session.puppet);
    }
    await excuseUs(p, "whoever came over last");
    if (!there()) await walkTo(p, town, { x: 6, z: 10, view: "north" });

    // and `dayfxs ()` runs every other tick — give it one to hear Chin's
    await p.pump(() => noise().toLowerCase() === "chinchime", "the chimes outside Chin's");
  },
};
