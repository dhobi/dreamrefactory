import type { Pumped } from "../harness";
import { ask, dragTo, room, type Segment } from "../route";

/**
 * The five wheels of the temple door, turned one press at a time.
 *
 * `TUMBLE.PRP/0001 mousedown` reads exactly one thing about where it was
 * clicked — `if pointy (arg) < 100` — and then steps the wheel `target` names
 * four notches, up or down, one notch per `delay (10)`. Twenty-four notches is a
 * whole turn (`fix24deg ()` wraps at 24), so a wheel has six reachable readings
 * and a press moves it by one of them. Nothing else about the point is looked
 * at, which is why the x below is the wheel's own and the y is simply either
 * side of the 100 the script splits on.
 *
 * Addressed to `tumble.prp`'s main script with `target` set, the way
 * `rungs/mesapzl.ts` turns the sundial: the five tumblers have no script of
 * their own, so a click on one falls through to its shop's main with `target` =
 * the prop (`screen-director.ts`).
 *
 * The wheels come up at 0 every time — `dotbird ()` opens `tumble.prp` fresh and
 * `initprops ()` sets only visibility and position — but this reads `propdeg`
 * and steps towards the target rather than counting presses from a zero it
 * assumes, so it would still arrive on a save that left them anywhere.
 */
async function turnTumbler(p: Pumped, name: string, want: number): Promise<void> {
  const deg = (): number => Number(ask(p, "propdeg", [name]));
  const main = p.session.shopMain("tumble.prp");
  if (!main) throw new Error(`tumble.prp is not open — cannot turn ${name}`);
  // six readings to a wheel, so six presses reach any of them from any of them
  for (let press = 0; press < 6 && deg() !== want; press++) {
    const before = deg();
    const up = (want - before + 24) % 24 > 12;
    const at = Number(ask(p, "makepoint", [Number(ask(p, "propxy", [name, 1])), up ? 60 : 140]));
    void p.session.track(
      p.session.interp.runHandler(main, "mousedown", [at], { me: name, target: name }),
    );
    await p.pump(() => deg() !== before, `${name} to step off ${before}`, 2_000);
    await p.settle(name);
  }
  if (deg() !== want) throw new Error(`${name} reads ${deg()} and not ${want}`);
}

/**
 * Day 4, night, the thunderbird room: give the temple the stone, set its lock
 * to the reading that is wrong for the door and right for Blood, and end the
 * game.
 *
 * `BLDSTPZ` is standing on the podium's own cell facing it, `phase = 5`, the
 * Tbird stone in hand and Blood behind you with a gun (`GANG.CST/0187
 * setupactor ("tbird")` — `actorpose (me, "gun")`). `ENDING` is standing in the
 * morning street of a day that did not exist before, holding a chest. Forty-five
 * seconds of frames separate them, and everything in the diff is done by two
 * scripts.
 *
 *  1. **The podium.** `TBIRD.SET/0039` is Scene B2, the cell the save is
 *     standing on. Its `mousedown` is gated on `currentview () = "north"` and
 *     `pointinpodium (arg)`, which is 213,108-309,186 at the bottom of the same
 *     file, and it runs `dotbird ()`: the set is paused and hidden, the stage
 *     becomes `tumble.flt` at flat `tumble0`, and `tumble.prp` opens. The save
 *     is already standing there facing north, so there is no walk in this rung
 *     at all.
 *  2. **The stone into the slot.** `TUMBLE.FLT/0001 offerobject (what)` is
 *     `if what = "tbird" & currentflat () = "tumble0" & pointy (mouse ()) < 264`
 *     — so this is the drag-and-drop gesture, not a click, and `dragTo ()` is
 *     it: `INVEN.PRP/0001 stdmouse ()` runs the held prop's `mousedown` while
 *     the button is down, follows the pointer, and hit-tests the RELEASE, whose
 *     last branch is `sendtoflat (currentflat (), offerobject (what))`. The
 *     handler gives the stone to `temple`, plays `tumopen.mov` and leaves the
 *     stage at `tumble2` with five wheels on it.
 *  3. **The wrong combination, on purpose.** `TUMBLE.PRP/0001` carries two
 *     readings of the same five wheels. `solved ()` is 8, 8, 4, 20, 12 — the
 *     temple's door, and what this player already opened on day 4 to take the
 *     Tstone. `killblood ()` is 8, 8, 0, 20, 16 — the same lock two notches
 *     apart on wheels three and five. `gototbird ()` tests `killblood ()`
 *     first and only when `phase = 5`, and at `phase = 5` the day-4 answer is
 *     fatal: `solved ()` falls into `deathx ()`, which sets `phase = 6` and
 *     sends Blood a `mousedown`. The last puzzle of Dust is the one you have
 *     already solved, asked again with the other answer wanted.
 *  4. **Out.** `flatprops.ts` reports two regions on `tumble2`: `quit` at
 *     216,177-291,261, whose script is `/0011 mousedown` → `gototbird ()`
 *     direct, and `exit` at 51,312-136,335 → `/0012` → `doexit ()` →
 *     `gototbird ()`. They do the same thing; `quit` is the one `/0008
 *     setcursor` lights a cursor for, so it is the one a player finds.
 *  5. **The ending.** `gototbird ()`'s `phase = 5 & killblood ()` arm is the
 *     whole of it: Blood is put down (`putdownactor ()` — which is why `ENDING`
 *     has him invisible in `tbird` still), `wrong ()` hands the stone back and
 *     restores `new.flt` over the set, `bloodies.mov` plays, `addinven
 *     ("chest")` puts the chest in your hand, and after `delay (300)` the
 *     underground is torn down and `advanceday ()` is sent to the stage.
 *  6. **Day five.** `NEW.FLT/0001 advanceday ()` does the rest with no help:
 *     `phase = 0`, `clock` was 3 so `day = day + 1` and `clock = 1`,
 *     `townscene = "scene g5"`, `savescene = "scene c4"`, `savedir = "east"`,
 *     and then the `case 5` arm — `d4nd5m.mov`, `initall ("town", "town.set")`,
 *     `currentscene ("scene g4")`, `currentview ("south")`, and `addinven
 *     ("chest")` a second time, because `initall ()` empties the hand on its way
 *     through. Cell (6,3) of `TOWN.SET` is Scene G4, which is where `ENDING` was
 *     taken. There is nothing to play on the other side.
 *
 * **The teardown, and which script performs it.** Nine names the save carries at
 * `BLDSTPZ` are gone at `ENDING`, and not one of them is a route step — they are
 * `TUMBLE.FLT/0001 gototbird ()`'s five `dumpglobal` lines, run in the same
 * breath as the chest:
 *
 *     dumpglobal flutestr, flutenum
 *     dumpglobal minex, miney, bonex, boney
 *     dumpglobal nextroom, blackout, maskcount
 *     dumpglobal largedial, meddial, smalldial
 *     dumpglobal flutepuzzle, minepuzzle, tbirdpuzzle, snakepuzzle
 *
 * That is the underground's whole state — the dials, the four puzzles' `done`
 * strings, the blackout counter, the flute's tune — destroyed on the way out of
 * a room the player can never re-enter. `advanceday ()` does not touch any of
 * it; it is not a day change, it is `tumble.flt` closing the door behind it. The
 * same five lines appear twice more: inlined again in `deathx ()`, and as
 * `SUNDIAL.FLT/0001 dumpyunniglobals ()`, which is a named helper **nothing in
 * the corpus calls** — the version that was factored out and never wired up.
 * Four of the sixteen names, `minex, miney, bonex, boney`, are assigned by no
 * script anywhere: they are the mine's coordinates under the names they had
 * before `MINE.CST` settled on `standx`/`standy`/`walkx`/`walky`, and dumping
 * them has been a no-op since.
 *
 * **Not claimed**, and why.
 *
 *   - **`smalldial` (12), `snakepuzzle` ("done") and `maskcount` (1)**, which
 *     `ENDING` still carries. They are on the very lines above, so the port
 *     destroys them with the rest and the run ends with all twelve gone.
 *     Claiming them would be claiming three records in a save that are not
 *     evidence of anything: the globals container is a 32-byte node array the
 *     reader walks by physical slot, a destroyed name keeps its node until
 *     something is allocated over it, and `ENDING` reads nine of the twelve
 *     slots as nodes whose names no longer resolve to themselves and three as
 *     nodes that still do (`docs/engine/scripting-language.md`, and
 *     `rungs/d4mines.ts` and `rungs/mesapzl.ts` for the two rungs that found the
 *     mechanism). Which three survive is a fact about reclaim order, not about
 *     what `dumpglobal` took. The nine that ARE claimed are claimed for the
 *     opposite reason: a run that never reached `gototbird ()`'s kill arm would
 *     still be holding `blackout = -1` and `largedial = 12`, so their absence is
 *     a real assertion that the teardown ran.
 *   - **`playerhandtemp`**, which is `""` at `BLDSTPZ` and reads as nothing at
 *     `ENDING`. It is the poker table's — `SALGAMES.FLT/0001` dumps it with
 *     `playercount, playerhand, playerbet, …` — and it died on day 3 at the
 *     poker table, some fifty thousand frames before this rung (`D3E_003` is at
 *     170,249 and `BLDSTPZ` at 223,762). Nothing here touches it.
 *   - **`vitalframe`**, which `advanceday ()` sets to `frame ()`. It records
 *     when, not what.
 *   - **`savescene` and `savedir`**, written by `advanceday ()` and written with
 *     the values they already had.
 *
 * The last rung of the golden thread. `START` to `ENDING`, day 1 to day 5, and
 * every rung of it checked against a file `DF.EXE` wrote in 1995.
 */
export const rung: Segment = {
  from: "BLDSTPZ",
  to: "ENDING",
  what: "the temple's lock set to kill Blood, and the game ends",
  claims: [
    // what `advanceday ()` and `initall ()` write
    "day", "clock", "phase", "handitem", "theset", "townscene", "sonomaphase",
    // and what `gototbird ()` destroys on the way past
    "blackout", "nextroom", "largedial", "meddial", "flutenum", "flutestr",
    "flutepuzzle", "minepuzzle", "tbirdpuzzle",
  ],
  async play(p: Pumped) {
    const flat = (): string => ask(p, "currentflat").toLowerCase();
    const owner = (name: string): string => ask(p, "propowner", [name]).toLowerCase();

    // ---- 1. the podium, from the cell the save is already standing on -------
    if (p.session.currentSceneName()?.toLowerCase() !== "scene b2") {
      throw new Error(`the save is not on the podium's cell — ${p.session.currentSceneName()}`);
    }
    p.fire((213 + 309) / 2, (108 + 186) / 2);
    await p.pump(() => flat() === "tumble0", "dotbird () to open the temple front");
    await p.settle("the temple front");

    // ---- 2. the Tbird stone into the slot ----------------------------------
    // above 264, which is what both `stdmouse ()` and `offerobject ()` test
    await dragTo(p, "tbird", { x: 256, y: 150 }, "the Tbird stone into the temple");
    // tumopen.mov is modal, so this is a film's worth of pumping
    await p.pump(() => flat() === "tumble2", "the tumblers to come up", 60_000);
    await p.settle("the tumblers");
    if (owner("tbird") !== "temple") {
      throw new Error(`the temple did not take the stone — it is ${owner("tbird")}'s`);
    }

    // ---- 3. `killblood ()`'s reading: 8, 8, 0, 20, 16 -----------------------
    await turnTumbler(p, "tumbler1", 8);
    await turnTumbler(p, "tumbler2", 8);
    await turnTumbler(p, "tumbler3", 0);
    await turnTumbler(p, "tumbler4", 20);
    await turnTumbler(p, "tumbler5", 16);

    // ---- 4-6. quit, and let the ending run ---------------------------------
    p.fire((216 + 291) / 2, (177 + 261) / 2);
    /*
     * Two films and a 300-frame hold stand between the press and the street —
     * `bloodies.mov`, `delay (300)`, then `advanceday ()`'s own `d4nd5m.mov` —
     * so the budget here is a film's and not a walk's. The predicate is the
     * arrival, not the day: `day = 5` is set at the TOP of `advanceday ()`,
     * before the movie and before `initall ()` has opened anything.
     */
    await p.pump(() => room(p) === "town", "the morning of day five", 200_000);
    await p.settle("the ending");
    if (owner("chest") !== "stranger") {
      throw new Error(`the chest is not in hand — it is ${owner("chest")}'s`);
    }
  },
};
