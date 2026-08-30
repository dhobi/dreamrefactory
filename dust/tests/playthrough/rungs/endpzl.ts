import type { Pumped } from "../harness";
import { ask, dragTo, room, set, takeInHand, walkTo, type Segment } from "../route";

/**
 * Day 4, night, underground: the Thunder Bird into the temple, and back to the
 * hub with the four puzzles done.
 *
 * The last of the four rooms, and the shortest diff in the underground: between
 * `MESAPZL` and `ENDPZL` exactly four globals move and nothing else does at all.
 * `tbirdpuzzle "" → "done"` and `handitem "" → "Yunnibook"`, `blackout 0 → -1`,
 * and `phase 0 → 1` — which is the one worth chasing, because `phase` is what
 * `SUNDIAL.FLT exitsundial ()` reads before it will open the 12/4/12 arm to the
 * ending. `TUMBLE.FLT/0001 gototbird ()` is where it is set:
 *
 *     tbirdpuzzle = "done"
 *     if phase = 0
 *         if flutepuzzle = "done" & snakepuzzle = "done" &
 *            tbirdpuzzle = "done" & minepuzzle = "done"
 *             phase = 1
 *
 * so `phase = 1` is not a thing the thunderbird does, it is the count of the
 * other three coming out right — and this rung is the one that can make it,
 * because the mine, the snake and the flute are already "done" in `MESAPZL`.
 *
 * The dials are left alone: `largedial`/`meddial`/`smalldial` read 12/4/8 at
 * both ends. The way back from a solved room is `TBIRD.SET/0001 gotohub ()`,
 * a plain `closesetfile ()` / `opensetfile ("hub.set")`, and the only thing
 * that ever re-randomises the three is `HUB.SET/0001 gotoblack ()`.
 *
 *  1. **The Thunder Bird into the hand, in the hub's own panel.** `MESAPZL` has
 *     an empty hand, and the temple is fed by DROPPING something on it, which
 *     `INVEN.PRP/0001 stdmouse ()` will only do for `propview (what) = "large" &
 *     what = handitem`. So the panel first: `new.flt`'s mainpanel region `self`
 *     at 395,268-507,379 is `NEW.FLT/0019 mousedown` → `setvisible (false)`,
 *     `gotoflat (3)`, the avatar panel, where a click on a carried prop is
 *     `stdmouse ()`'s `propview = "panel"` arm and sets `handitem`. Out again
 *     through OK at 266,321-367,345, `NEW.FLT/0023` → `gotoflat (1)`,
 *     `setvisible (true)`.
 *  2. **The podium.** `TBIRD.SET` is a 3x4 grid and only two of its cells own a
 *     script: Scene B4 (1,3), which is where `MESAPZL` stands, and Scene B2
 *     (1,1), whose `/0039 mousedown` is `if currentview () = "north" &
 *     pointinpodium (arg) → dotbird ()` with `pointinpodium` the rectangle
 *     213,108-309,186. `dotbird ()` pauses every loop, hides the set —
 *     `setvisible (false)`, and remember it — and swaps the stage for
 *     `tumble.flt` at flat `tumble0` with `tumble.prp` behind it.
 *  3. **The gift is a drag, not a click.** `TUMBLE.FLT/0001 offerobject (what)`
 *     is `if what = "tbird" & currentflat () = "tumble0" & pointy (mouse ()) <
 *     264`, and the only thing that sends a flat an `offerobject` is
 *     `INVEN.PRP/0001 stdmouse ()`'s release: it hit-tests the point the button
 *     came up on against the actors, then `pointinset (arg)`, then
 *     `pointy (arg) < 264 & pointinstage (arg)`. 264 is the set's own viewport
 *     height, so the drop is the middle of the world band, 256,132 — and the
 *     set being hidden is what makes `pointinset ()` answer false and lets the
 *     stage have it. `TUMBLE.FLT/0002 openflat ()` has already put the hand
 *     item at 316,320 in view "large", which is where `dragTo ()` picks it up
 *     from. What the drop buys: `giveinven ("tbird", "temple")` — which empties
 *     the hand, because `giveinven ()` clears `handitem` when what is given
 *     away is what was in it — then `tumopen.mov`, `gotoflat ("tumble2")` and
 *     `sendtoshop ("tumble", initprops ())`, which is the five tumblers.
 *  4. **The tumblers.** `TUMBLE.PRP/0001` is the whole puzzle. `initprops ()`
 *     shows `tumbler1..5` at 115,93 / 186,92 / 256,93 / 326,95 / 395,95 and
 *     `solved ()` compares each one's `propdeg` against `nametodeg ()`:
 *     **8, 8, 4, 20, 12**. A click is four notches, not one —
 *
 *         for count = 1 to 4
 *             if pointy (arg) < 100
 *                 propdeg (target, fix24deg (propdeg (target) -1))
 *             else
 *                 propdeg (target, fix24deg (propdeg (target) + 1))
 *
 *     — so WHERE on the tumbler is the direction and the ring is 24 wide, six
 *     clicks round. All five come up 0, every target is a multiple of four, and
 *     the shorter way round is one to five clicks each. The two points are
 *     asked for rather than measured: the sprite is hit-tested down the column
 *     the script itself put the prop on (`propxy (name, 1)`), and the highest
 *     and lowest points of it that are still the tumbler are the two ends of
 *     the click. The tumblers have no script of their own — a fired click
 *     reaches `tumble.prp`'s main with `target` set to the one that was hit,
 *     which is the director's prop chain (`web/screen-director.ts`) and the
 *     same route `rungs/mesapzl.ts` takes to the sundial.
 *  5. **Done.** `tumble2` has two click regions (`flatprops.ts`) and both run
 *     the same thing: `quit` at 216,177-291,261 is `/0011 mousedown` →
 *     `gototbird ()`, `exit` at 51,312-136,335 is `/0012` → `doexit ()` →
 *     `gototbird ()`. With `solved ()` true that writes `tbirdpuzzle` and
 *     `phase`, plays `tumtran.mov`, puts `new.flt` back, un-pauses the loops
 *     and `sendtoset (gotohub ())` — `TBIRD.SET`'s own, which closes the room
 *     and opens `hub.set`. `HUB.SET/0001 openset ()` sets
 *     `blackout = 3 + random (3)`, and the hub's default standpoint is Scene D7
 *     (3,6) facing north, so the arrival is on the thunderbird arm's own end
 *     with the count already running.
 *  6. **The panel again, and this is why the Yunni book is in hand.** Nothing
 *     on the solved path undoes step 2's `setvisible (false)` — `wrong ()` has
 *     a `setvisible (true)` and `gototbird ()`'s winning arm does not — so the
 *     hub comes up with the set hidden, and a hidden set eats every key:
 *     `BOOTFILE/0001 keydown` is `if currentset () != "none" & setvisible () =
 *     true → sendtoscene (currentscene (), keydown (arg))`, else the flat, and
 *     `new.flt`'s mainpanel has no `keydown`. Presses do nothing at all. What
 *     puts the world back is the panel: `NEW.FLT/0023`, the avatar panel's OK,
 *     ends `setvisible (true)`. So the trip through the panel is not optional
 *     here, and `handitem = "Yunnibook"` in `ENDPZL` is its fingerprint — the
 *     save records what the player happened to pick up while they were in
 *     there getting their eyes back.
 *  7. **Then the dark, counted.** With the set showing again, `HUB.SET/0061`
 *     (Scene D7) answers: `if blackout > 0 → blackout - 1, stillblack ()`, and
 *     the press that finds 0 takes the other arm — `nextroom` is 0, having been
 *     cleared when the thunderbird room opened, so it is `currentview
 *     ("north")`, `comefromblack ()`, which is what writes `blackout = -1`, and
 *     `seeshaman ()`, true now (`phase` is 1, not > 1, and four puzzles are
 *     "done") so the shaman is stood up in a season.
 *  8. **Two north and one west.** `ENDPZL` is Scene C5 (2,4) facing north, a
 *     corner of the eight-cell ring round the sundial rather than the arm end
 *     the hub opened on. Nothing is there — Scene C5's `scriptLocation` is 52
 *     and `HUB.SET` has no container 52, so it falls through to the set main.
 *     It is where the player stopped walking.
 *
 * **Not claimed.** There is nothing else to claim: `MESAPZL` and `ENDPZL` are
 * identical global for global apart from the four above, `nextroom` and
 * `blackout`'s neighbours included, and no name is gained or lost — only
 * `tbirdpuzzle` moves slot, from the numeric 0 it was never assigned to the
 * string the puzzle writes.
 */
export const rung: Segment = {
  from: "MESAPZL",
  to: "ENDPZL",
  what: "the Thunder Bird into the temple, and back to the hub with all four done",
  claims: ["tbirdpuzzle", "phase", "handitem", "blackout"],
  async play(p: Pumped) {
    const tbird = set("TBIRD");
    const hub = set("HUB");
    const flat = (): string => ask(p, "currentflat").toLowerCase();
    const held = (): string => String(p.session.interp.globals.get("handitem") ?? "").toLowerCase();
    const num = (name: string): number => Number(p.session.interp.globals.get(name));
    const deg = (name: string): number => Number(ask(p, "propdeg", [name]));

    /**
     * The avatar panel, opened and shut.
     *
     * Both ends of it matter: `NEW.FLT/0019` takes the set off the screen on
     * the way in and `/0023` puts it back on the way out, which is step 6's
     * whole point.
     */
    const inThePanel = async (item: string, why: string): Promise<void> => {
      p.fire((395 + 507) / 2, (268 + 379) / 2); // mainpanel's `self` region
      await p.pump(() => flat() === "avatar", `the avatar panel for ${why}`);
      await takeInHand(p, item, why);
      p.fire((266 + 367) / 2, (321 + 345) / 2); // the panel's OK
      await p.pump(() => flat() !== "avatar", "the panel to close");
      await p.settle("the panel");
      if (ask(p, "setvisible") !== "1") throw new Error("the panel left the set hidden");
    };

    // ---- 1. the Thunder Bird into the hand ---------------------------------
    await inThePanel("tbird", "the Thunder Bird, to have something to give the temple");

    // ---- 2. the podium, in the only other cell that owns a script ----------
    await walkTo(p, tbird, { x: 1, z: 1, view: "north" }); // Scene B2, TBIRD.SET/0039
    p.fire((213 + 309) / 2, (108 + 186) / 2); // pointinpodium
    await p.pump(() => flat() === "tumble0", "dotbird () to open the temple");
    await p.settle("the temple");

    // ---- 3. drop it in — 264 is the viewport, so this is the world band ----
    await dragTo(p, "tbird", { x: 256, y: 132 }, "the Thunder Bird into the temple");
    await p.pump(
      () => ask(p, "propowner", ["tbird"]).toLowerCase() === "temple",
      "the temple to take the Thunder Bird",
    );
    if (held() !== "") throw new Error(`the hand still holds "${held()}" after giving it away`);
    // tumopen.mov, then initprops () — a movie is long, and modal
    await p.pump(() => flat() === "tumble2", "tumopen.mov and the tumblers", 200_000);
    await p.settle("the tumblers");

    // ---- 4. the five tumblers, to TUMBLE.PRP/0001 nametodeg () -------------
    /** the highest and lowest points of a tumbler's sprite, down the column
     *  the script's own `propxy ()` put it on — 100 is the script's divide */
    const grip = (name: string): { up: number; down: number } => {
      const x = Number(ask(p, "propxy", [name, 1]));
      const ys: number[] = [];
      for (let y = 0; y < 384; y++) {
        const under = p.v().propUnder(x, y);
        if (under && (under.name || under.group.name).toLowerCase() === name) ys.push(y);
      }
      const up = ys.find((y) => y < 100);
      const down = [...ys].reverse().find((y) => y >= 100);
      if (up === undefined || down === undefined) {
        throw new Error(`${name} has no click both above and below 100 at x=${x}`);
      }
      return { up, down };
    };
    const want: Record<string, number> = {
      tumbler1: 8, tumbler2: 8, tumbler3: 4, tumbler4: 20, tumbler5: 12,
    };
    for (const [name, target] of Object.entries(want)) {
      const at = grip(name);
      const x = Number(ask(p, "propxy", [name, 1]));
      // six clicks is the whole ring: 24 notches, four to a click
      for (let click = 0; click < 6 && deg(name) !== target; click++) {
        const was = deg(name);
        const forward = (((target - was) % 24) + 24) % 24 <= 12;
        const then = (((forward ? was + 4 : was - 4) % 24) + 24) % 24;
        p.fire(x, forward ? at.down : at.up);
        await p.pump(() => deg(name) === then, `${name} to turn from ${was} to ${then}`);
        await p.settle(name);
      }
      if (deg(name) !== target) throw new Error(`${name} stopped on ${deg(name)}, not ${target}`);
    }

    // ---- 5. and done — `quit`, TUMBLE.FLT/0011 -> gototbird () -------------
    p.fire((216 + 291) / 2, (177 + 261) / 2);
    await p.pump(
      () => String(p.session.interp.globals.get("tbirdpuzzle") ?? "").toLowerCase() === "done",
      "gototbird () to find the tumblers solved",
    );
    if (num("phase") !== 1) {
      throw new Error(`four puzzles are done and phase is ${num("phase")}, not 1`);
    }
    await p.pump(() => room(p) === "hub", "tumtran.mov and the way back to the hub", 400_000);
    await p.settle("the hub");

    // ---- 6. the panel is what puts the set back on the screen --------------
    await inThePanel("yunnibook", "the Yunni book, while the panel is open anyway");

    // ---- 7. the dark the hub arrived in, counted down ----------------------
    for (let i = 0; i < 30 && num("blackout") !== -1; i++) {
      await p.press("uparrow", "feeling for the hub");
    }
    if (num("blackout") !== -1) {
      throw new Error(`the dark never ended — blackout is ${num("blackout")}`);
    }

    // ---- 8. and where the player stopped walking ---------------------------
    await walkTo(p, hub, { x: 2, z: 4, view: "north" }); // Scene C5
  },
};
