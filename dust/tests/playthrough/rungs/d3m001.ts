import { LEAVING, clickThrough, openDoor, room, set, talkOut, walkTo, type Segment } from "../route";

/**
 * Day 2, night: up to the room, and sleep — the second time.
 *
 * Fourteen seconds of play, and almost the whole of the diff between the two
 * saves is one call. `HOTROOM.SET/0034 sleep ()` plays `hotbed.mov` and, on its
 * `actionframe (1)`, calls `NEW.FLT/0001 advanceday ()`; with `day = 2` and
 * `clock = 3` that takes the `else` arm — `day = 3`, `clock = 1` — resets
 * `phase`, writes `savedir = "east"`, `savescene = "scene c4"`,
 * `townscene = "scene g5"`, and then plays `d2nd3m.mov` and re-seats the world
 * with `initall ("hotroom", "hotroom.set")`, `currentscene ("scene a1")`,
 * `currentview ("east")`. `initall ()` is where the character phases go to zero:
 * it clears `rubyphase` and `sophiephase` itself and calls
 * `GANG.CST/0001 initactors ()`, whose per-actor `initactor ()` zeroes each of
 * the rest (`GANG.CST/0594`'s is `laurelphase = 0`, and every cast entry has the
 * same two lines). `initall ()` also calls `INVEN.PRP/0001 initprops ()`, whose
 * `day = 3` arm opens with `giveinven ("pie", "limbo")` — which is the one prop
 * that moves across this rung.
 *
 * This is the day-1 bedtime (`segment5`) played again with day 2's gates, and
 * every one of them is open by the time the rung starts:
 *
 *   1. **Out of the lobby corner.** `D2E_004` stands at HOTLOWER Scene B3 with
 *      Laurel and Fear both placed by `HOTLOWER.SET/0001 openset ()` — day 2
 *      puts Fear in the lobby unconditionally and Laurel too while
 *      `clock = 3 & phase = 0`. Neither of them stops anybody: `laurelidle ()`
 *      (`GANG.CST/0594`) only calls `hasattention (5)` when `day = 3 & clock = 3`,
 *      and `fearidle ()` (`GANG.CST/0755`) never calls it at all. So this walks,
 *      and `walkTo` carries `LEAVING` only in case it is wrong about that.
 *   2. **Up the stairs.** Scene D3 facing north. There is no door prop here —
 *      `HOTLOWER.SET/0048 keydown` answers a bare `uparrow` from that one view
 *      with `hotup.mov` and `gotointerior ("hotupper.set")`.
 *   3. **The room door.** Scene C4 facing west, `pointinrice` (168,50-329,263) —
 *      not the `pointindoor` beside it, which is Blood's room and which
 *      `lockdoor ()` keeps shut on any night but day 3's. `lockrice ()`
 *      (`HOTUPPER.SET/0045`) is past its day-1 clauses here and asks only
 *      `propowner ("hrkey") = "stranger"`, which `D2E_004` already records; the
 *      click sets the `door` prop to "playroom" and the `uparrow` after it walks
 *      through, writing `savescene`/`savedir` on the way — both of which
 *      `advanceday ()` overwrites a moment later.
 *   4. **The bed.** HOTROOM Scene A1 facing west, `pointinsign`
 *      (153,210-512,264). `cansleep ()` has an arm for exactly this night —
 *      `if day = 2 & clock = 3 return true` — so the click runs `sleep ()`, and
 *      the rung is over when `day` reads 3.
 *
 * **Not claimed**, of the three remaining globals in the diff.
 *
 *   - `vitalframe` is `frame ()`, taken inside `advanceday ()` — a count of
 *     frames drawn since the program started, so it measures how long the run
 *     took to get here and not what it did. Measured 115491 against the save's
 *     109108.
 *   - `idlecount` is `BOOTFILE/0001 idle ()`'s mod-4 counter, the one that
 *     decides which pass of the idle loop re-hit-tests the cursor. What it holds
 *     is which quarter of that cycle the save was written in.
 *   - `theset` is a scratch global `GANG.CST/0001 initactor ()` overwrites with
 *     `actorset (who)` on every pass, so what it ends on is whichever cast entry
 *     the loop touched last. It does in fact reach "town" here — it was checked
 *     — but a passing claim on it would read as a fact about the world, and it
 *     is not one.
 *
 * The prop move (`Pie` side → limbo) is real and is argued for above; this suite
 * checks globals.
 */
export const rung: Segment = {
  from: "D2E_004",
  to: "D3M_001",
  what: "up to the room, and sleep again",
  claims: [
    "day", "clock", "phase", "savescene", "savedir", "townscene",
    "buickphase", "dellphase", "fearphase", "helpphase", "jonesphase",
    "mariephase", "oonaphase", "rubyphase", "sonomaphase", "sophiephase",
  ],
  async play(p) {
    await p.pump(() => !p.session.puppet, "the lobby to settle");

    // 1-2. across the lobby and up: Scene D3 facing north, and a bare uparrow
    await walkTo(p, set("HOTLOWER"), { x: 3, z: 2, view: "north" }, undefined, 4, LEAVING);
    await p.press("uparrow", "up the stairs");
    await p.pump(() => room(p).startsWith("hotupper"), "the landing");
    await talkOut(p, LEAVING, "anyone on the landing", 2);

    // 3. the room door — `pointinrice`, and the prop it sets is "playroom"
    await openDoor(p, [168, 50, 329, 263], "playroom", "the room door", {
      set: set("HOTUPPER"), x: 2, z: 3, view: "west",
    });
    await p.pump(() => room(p).startsWith("hotroom"), "the room");

    // 4. the bed — `pointinsign` on Scene A1 facing west
    await walkTo(p, set("HOTROOM"), { x: 0, z: 0, view: "west" });
    await clickThrough(
      p,
      () => p.fire((153 + 512) / 2, (210 + 264) / 2),
      () => Number(p.session.interp.globals.get("day") ?? 0) >= 3,
      "the night",
      { x: 256, y: 190 },
    );
    await p.settle("the morning");
  },
};
