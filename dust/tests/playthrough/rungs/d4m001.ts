import { LEAVING, clickThrough, openDoor, room, set, talkOut, walkTo, type Segment } from "../route";

/**
 * Day 3, night: sleep the third time, and out onto the landing.
 *
 * Fifteen seconds of play, and all but the last three steps of it is one call.
 * `HOTROOM.SET/0034 sleep ()` plays `hotbed.mov` and on its `actionframe (1)`
 * calls `NEW.FLT/0001 advanceday ()`; with `day = 3` and `clock = 3` that takes
 * the `clock = 3` arm — `day = 4`, `clock = 1` — sets `phase = 0`,
 * `savedir = "east"`, `savescene = "scene c4"`, `townscene = "scene g5"`, and
 * then falls into `case 4 / case 1`: `d3nd4m.mov`, and
 * `initall ("hotroom", "hotroom.set")` with `currentscene ("scene a1")` and
 * `currentview ("east")`. So the sleeper wakes where he lay, turned to face the
 * door.
 *
 * `initall ()` is where the rest of the diff comes from, and it is worth naming
 * which part of it each global belongs to, because they are three different
 * mechanisms:
 *
 *   - `mezphase`, `zebpetephase` and `hasquitpoker` are zeroed by `initall ()`
 *     itself, in its own body.
 *   - `bloodphase`, `buickphase`, `dellphase`, `fearphase`, `mariephase`,
 *     `oonaphase` and `trotterphase` are zeroed one cast entry at a time.
 *     `initall ()` calls `GANG.CST/0001 initactors ()`, which sends
 *     `initactor ()` to every actor the cast counts, and each entry's is the
 *     same two lines — `GANG.CST/0187` is `bloodphase = 0`, `0468`
 *     `buickphase = 0`, `0670` `trotterphase = 0`, and so on.
 *   - `bounty1`…`bounty5` are the same pass by a different route. The five
 *     bounty hunters share `EXTRA.CST/0287`, whose `initactor ()` is
 *     `actorvalue (me, 0)` and `variable (me, 0)` — and `variable (name, val)`
 *     with a name no block declared local writes a GLOBAL of that name
 *     (`runtime/builtins/helpers.ts`). `variable ("bounty1", 0)` IS
 *     `bounty1 = 0`. Their 4/4/2/2/2 is the day-3 night's street fight left in
 *     the walk and stat loops' own counters.
 *
 * `handitem` is `initall ()`'s last clause: the hotel key was in hand at
 * `D3E_005` and waking puts it back in the panel.
 *
 * This is `rungs/d3m001.ts` and `segments.ts`'s `segment5` played a third time,
 * but the gates are day 3's and only one of them is interesting:
 *
 *   1. **The bed.** HOTROOM Scene A1 facing west — which is exactly where
 *      `D3E_005` stands — and `pointinsign` (153,210-512,264). `cansleep ()`
 *      (`HOTROOM.SET/0034`) has no unconditional night arm this time: day 3's is
 *      `if day = 3 & clock = 3 & sendtostagefx (day3bedtime ())`, and
 *      `day3bedtime ()` (`NEW.FLT/0001`) is
 *      `propowner ("tbird") = "stranger" & propowner ("tstone") = "stranger" &
 *      phase > 3`. `D3E_005` carries both stones and `phase = 4`, so the click
 *      runs `sleep ()`. The rung's first half is over when `day` reads 4.
 *   2. **Out of the room.** Scene B1 facing east, `pointinrice`
 *      (176,62-339,263), door prop "inside" (`HOTROOM.SET/0036`). `lockrice ()`
 *      there returns false unconditionally — the room only ever locks from the
 *      landing side — and the `uparrow` runs
 *      `gotospecial ("hotupper.set", savescene, savedir)`, which is
 *      `advanceday ()`'s own "scene c4" / "east". Its two `setupactor
 *      ("hallway")` clauses are day 2's and day 3's; day 4 sends nobody.
 *   3. **Up the corridor to Scene C1.** Nothing is waiting: `HOTUPPER.SET/0001
 *      openset ()` only touches `buickphase` on a day-2 afternoon, and the
 *      `openscene` in `HOTUPPER.SET/0045` that arms the morning with
 *      `lockevents`/`trigger ()` has an arm for day 2 and an arm for day 3 and
 *      none for day 4 — which is why `phase` stays 0 across this rung where the
 *      earlier two mornings had it at 1 by now. C2 (`0043`, Laurel's door), C3
 *      (`0044`, the painting) and C1 (`0042`, Buick's) own no `openscene` at
 *      all, so the walk is a walk.
 *
 * `D4M_001` is taken at Scene C1 facing west, which is standing in front of
 * Buick's door. **The knock is not played**, because on day 4 it is not a knock:
 * `HOTUPPER.SET/0042 lockrice ()` has clauses for day 1, day 2 and day 3 night
 * and falls through to `return true` on day 4, so `mousedown` there is
 * `voicesound ("knock1")` and nothing else — no `dobuick ()`, no `buickphase`.
 * The save cannot tell a player who knocked from one who walked up and stopped,
 * and the world is the same either way, so this route walks up and stops.
 *
 * **Not claimed**, the four the save moved and the play does not argue for:
 *
 *   - `vitalframe` is `frame ()` taken inside `advanceday ()` — how many service
 *     passes since the program started, so it measures how long the run took to
 *     get here rather than what it did (176405→180830 in the saves).
 *   - `idlecount` is `BOOTFILE/0001 idle ()`'s mod-4 counter, so what it holds is
 *     which quarter of the idle cycle the save was written in.
 *   - `tumx2`/`tumy2` are the tumbleweed's position. It blows across the street
 *     on its own, and `initprops ()` restarts its loop — which is why `D4M_001`
 *     records a `tumbleweed`/`kickme` prop loop where `D3E_005` had the
 *     shooting star's.
 *
 * No prop moves across this rung. `INVEN.PRP/0001 initprops ()`'s `day = 4` arm
 * is `addinven ("tbird")` and `addinven ("tstone")`, and `D3E_005` already
 * carries both.
 */
export const rung: Segment = {
  from: "D3E_005",
  to: "D4M_001",
  what: "sleep the third time, and out onto the landing",
  claims: [
    "day", "clock", "phase", "handitem", "savescene", "savedir", "townscene",
    "bloodphase", "buickphase", "dellphase", "fearphase", "mariephase",
    "oonaphase", "trotterphase", "mezphase", "zebpetephase", "hasquitpoker",
    "bounty1", "bounty2", "bounty3", "bounty4", "bounty5",
  ],
  async play(p) {
    await p.pump(() => !p.session.puppet, "the room to settle");

    // 1. the bed — `pointinsign` on Scene A1 facing west, where D3E_005 stands
    await walkTo(p, set("HOTROOM"), { x: 0, z: 0, view: "west" });
    await clickThrough(
      p,
      () => p.fire((153 + 512) / 2, (210 + 264) / 2),
      () => Number(p.session.interp.globals.get("day") ?? 0) >= 4,
      "the night",
      { x: 256, y: 190 },
    );
    await p.settle("the morning");
    await talkOut(p, LEAVING, "anyone in the room", 2);

    // 2. out of the room: Scene B1 facing east, the door prop "inside", and out
    //    to `savescene`/`savedir` — "scene c4" facing east
    await openDoor(p, [176, 62, 339, 263], "inside", "the room door", {
      set: set("HOTROOM"), x: 1, z: 0, view: "east",
    });
    await p.pump(() => room(p).startsWith("hotupper"), "the landing");

    // 3. up the corridor to Buick's door — Scene C1 facing west
    await walkTo(p, set("HOTUPPER"), { x: 2, z: 0, view: "west" });
  },
};
