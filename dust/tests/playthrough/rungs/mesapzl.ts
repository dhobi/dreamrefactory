import type { Pumped } from "../harness";
import { ask, offerTo, room, set, takeInHand, walkTo, type Segment } from "../route";

/**
 * Turn one of the sundial's three dials until it reads what the table wants.
 *
 * `SUNDIAL.PRP/0001 mousedown` is a POLLING loop, not a click:
 *
 *     orig = fixdeg256 (calcdeg (propxy (target, 3), arg) + 64)
 *     while stilldown ()
 *         newd = fixdeg256 (calcdeg (propxy (target, 3), arg) + 64)
 *         propdeg (target, limiter (orig, newd))
 *         forceupdate ()
 *         arg = mouse ()
 *         orig = newd
 *     endwhile
 *
 * so the dial does not follow the mouse — it steps ONE notch (`limiter ()`
 * clamps `delt` to ±1, and corrects the 15→0 wrap) every time the sixteenth of
 * the bearing from the dial to the pointer changes. Sixteen notches is a whole
 * turn. That makes a dial a press, a series of pointer moves, and a release,
 * and none of the three gestures already in `route.ts` is that: `p.fire` is
 * dispatched and gone, `hold ()` presses without travelling, `dragTo ()`
 * travels but only cares where it lets go.
 *
 * **Where the pointer goes is asked for, not guessed.** `calcvectx`/`calcvecty`
 * are the engine's own inverse of `calcdeg`, and `pointx`/`pointy` unpack the
 * origin the script itself will read — so notch *n* is a real point on a circle
 * about that origin, whatever the origin turns out to be. Which matters here,
 * because in this port it is not where the artwork is: `propxy (name, 3)` has
 * no case in `engine/runtime/builtins/props.ts` (the getter is `axis === 2 ?
 * anchorY : anchorX`), so the script's "centre of the dial" comes back as the
 * bare x, 256, which decodes as the point (0,256). Reading the origin rather
 * than assuming it is what makes this survive that being fixed.
 *
 * Addressed to `sundial.prp`'s main script with `target` set, because the three
 * dials are drawn concentrically at one screen position (`initprops ()` puts all
 * of them at 256,132) — a click picks whichever sprite is in front, and the
 * script picks by name. That is also how the viewer would reach it: a prop with
 * no script of its own falls through to its shop's main with `target` = the
 * prop (`screen-director.ts`), and these three have none — their groups'
 * `scriptContainerLocation`s hold artwork.
 */
async function turnDial(p: Pumped, name: string, want: number): Promise<void> {
  const deg = (): number => Number(ask(p, "propdeg", [name]));
  if (deg() === want) return;
  const main = p.session.shopMain("sundial.prp");
  if (!main) throw new Error(`sundial.prp is not open — cannot turn the ${name}`);
  const from = Number(ask(p, "propxy", [name, 3]));
  const at = { x: Number(ask(p, "pointx", [from])), y: Number(ask(p, "pointy", [from])) };
  /** a point one sixteenth further round than the last, far enough out that
   *  the rounding of a single unit cannot land it in the wrong sixteenth */
  const notch = (n: number): { x: number; y: number } => {
    const bearing = (((n * 16 + 8 - 64) % 256) + 256) % 256;
    return {
      x: at.x + Number(ask(p, "calcvectx", [bearing, 1000])),
      y: at.y + Number(ask(p, "calcvecty", [bearing, 1000])),
    };
  };
  let n = 0;
  const start = notch(n);
  p.session.setPointer(start.x, start.y);
  p.session.pointerDown = true;
  let released = false;
  void p.session.track(
    p.session.interp
      .runHandler(main, "mousedown", [Number(ask(p, "makepoint", [start.x, start.y]))], {
        me: name,
        target: name,
      })
      .then(() => {
        released = true;
      }),
  );
  try {
    // at most a full turn: sixteen notches gets to any of the sixteen readings
    for (let step = 0; deg() !== want && step < 16; step++) {
      const before = deg();
      const to = notch(++n);
      p.session.setPointer(to.x, to.y);
      await p.pump(() => deg() !== before, `the ${name} to step past ${before}`, 400);
    }
  } finally {
    p.session.pointerDown = false;
  }
  await p.pump(() => released, `the ${name} to be let go`);
  if (deg() !== want) throw new Error(`the ${name} would not reach ${want} — it reads ${deg()}`);
}

/**
 * Day 4, night, underground: the Mask to the skeleton in the mine, and the
 * dials left set for the thunderbird.
 *
 * Two trips out of the hub in one rung, and the saves say so without saying it.
 * `MSKPZL` is standing at the sundial with the dials on the SNAKE (8/12/4) and
 * `minepuzzle` empty; `MESAPZL` is standing in `tbird.set` with `minepuzzle`
 * "done", the Mask owned by `skeleton`, and the dials on the THUNDERBIRD
 * (12/4/8). `SUNDIAL.FLT/0001 exitsundial ()` reads the three dials on the way
 * out and picks the room from them, so a rung that ends in one room having
 * finished the puzzle of another is a rung that dialled the mine, went, gave the
 * Mask away, came back, and dialled the thunderbird before leaving again.
 *
 * The hub is a ring of eight cells round a sundial that is not walkable, with
 * four arms off it. Each arm ENDS at a cell whose script is a `keydown`, and
 * each of those four is one room: `HUB.SET/0037` Scene A4 is the snake (west),
 * `/0055` Scene D1 the mine (north), `/0061` Scene D7 the thunderbird (south),
 * `/0079` Scene G4 the flute (east). The sundial itself is clicked from the four
 * INNER cells looking in — `/0059` Scene D5 is the one facing north, and it is
 * where `MSKPZL` was taken.
 *
 *  1. **The Mask into the hand, before anything else.** `MINE.CST/0002
 *     initxyz ()` opens `if handitem = "mask"  actorvalue (me, 1)`, and that
 *     runs from the mine's `openset ()` — so what is in the hand when the mine
 *     opens decides whether there is a puzzle there at all. `MSKPZL` has the
 *     Yunni book in hand, so the swap happens first, in the hub:
 *     `new.flt`'s mainpanel has three click regions (`flatprops.ts`) and `self`
 *     at 395,268-507,379 is `gotoflat (3)`, the avatar panel. Its `openflat ()`
 *     runs `showprop ()` over `indextoday4 ()`, and that is what sets each
 *     carried prop's view to "panel" — the view `INVEN.PRP/0001 stdmouse ()`
 *     wants before a click on it can become `handitem`. Then OK, at
 *     266,321-367,345, is `NEW.FLT/0023 mousedown` → `gotoflat (1)`.
 *  2. **The mine, dialled.** `HUB.SET/0059 pointinsundial` is 142,142-372,190
 *     and its `mousedown` is gated on `currentview () = "north"` and
 *     `phase < 3`; `phase` is 0. `dosundial ()` swaps `new.flt` for
 *     `sundial.flt` and opens `sundial.prp`. The mine's combination is
 *     large 4, medium 8, small 12 — `exitsundial ()`'s first arm, and skipped
 *     entirely if `minepuzzle` were already "done".
 *  3. **Out.** `sundial.flt` has exactly one click region, `exit` at
 *     50,311-135,336 (`flatprops.ts`), running `/0005 mousedown` → `doexit ()` →
 *     `exitsundial ()`: `nextroom = "mine"`, and `gotohub ()` puts `new.flt`
 *     back without moving the player, who is still at Scene D5.
 *  4. **Into the dark.** `HUB.SET/0055` is Scene D1, the north arm's end:
 *     `uparrow` facing north runs `gotoblack ()`, which fades the set out and
 *     sets `blackout = 3 + random (3)`. Every keypress after that decrements it
 *     — the player is walking blind — and the press that finds it already 0 is
 *     the one that reads `nextroom` and does `gotointerior ("mine.set")`. Which
 *     arm you went dark on is which room you get: the same press at Scene D7
 *     with `nextroom = "mine"` would just bring the hub back.
 *  5. **The maze.** The mine is a five-cell cross — Scene A3..E3 across, Scene
 *     C1..C5 down — and it wraps. `MINE.SET/0001 keydown` catches `uparrow` at
 *     each of the four ends and calls `changeall (row, col)`: west off A3 is
 *     `(0, 4)`, east off E3 `(0, -4)`, north off C1 `(4, 0)`, south off C5
 *     `(-4, 0)`. With the Mask in hand `changeall ()` moves `standx`/`standy` by
 *     that many cells and puts the skeleton there, so those two globals are the
 *     skeleton's position in the window you can see, and every wrap slides it a
 *     quarter of the way round. `initxyz ()` starts it at
 *     `640 ± ((8 + random (8)) * 4) * 256` on each axis — nine to sixteen wraps
 *     away in x and again in y, which is where this rung's seven minutes went.
 *     The Mask is the compass the player has: `MINE.SET/0001 openscene ()`
 *     counts scene changes and every seventh turns its eyes towards the
 *     skeleton (`calcmaskdir ()`). A route does not need the eyes — it can read
 *     `standx`/`standy` — but it walks the same wraps, one arm end at a time,
 *     until both read 640, which is Scene C3, the middle.
 *  6. **The gift.** `MINE.CST/0002 offerobject (what)` is
 *     `if what = "mask" & actordist (me) <= 320 & standx = 640 & standy = 640 &
 *     actorvalue (me) = 1` — the skeleton has to be in the middle AND you have
 *     to be standing with it. Then `minepuzzle = "done"`, `skeleton.mov`,
 *     `giveinven ("mask", "skeleton")` — which is where `handitem` empties, as
 *     `INVEN.PRP/0001 giveinven ()` clears the hand when what is given away is
 *     what was in it — and `sendtoset (gotohub ())`.
 *  7. **Back in the dark.** `gotohub ()` reopens `hub.set` at its own default
 *     standpoint, Scene D7, and `openset ()` sets `blackout` again, so you
 *     arrive blind and press your way out. `nextroom` is 0 by now (the mine's
 *     own arrival cleared it), so the press that finds `blackout = 0` takes the
 *     other branch: `currentview ("north")`, `comefromblack ()` — which is what
 *     sets `blackout = -1` — and `seeshaman ()`, true now that a puzzle is done,
 *     stands the shaman up in one of the seasons.
 *  8. **The thunderbird, dialled.** Two steps north to Scene D5 and the same
 *     sundial, this time 12/4/8. `gotoblack ()` re-randomises the dials only
 *     `if nextroom = "hub"`, so setting them for a room means they survive.
 *  9. **And out.** `HUB.SET/0061` is Scene D7: `uparrow` facing south goes
 *     dark, the counter runs down, and the press that finds 0 does
 *     `gossipone ("s.3")` and `gotointerior ("tbird.set")`. `tbird.set`'s own
 *     default standpoint is cell (1,3) facing north, which is exactly where
 *     `MESAPZL` was taken — there is nothing to do on the other side.
 * 10. **`blackout = 0`** is the fingerprint of that last press rather than
 *     anything the thunderbird room did: the transition happens on the press
 *     that finds the counter already at zero, and nothing in `tbird.set` touches
 *     it again.
 *
 * **Not claimed**, and why.
 *
 *   - **`maskcount` (0 → 1).** It is `MINE.SET/0001 openscene ()`'s counter,
 *     `maskcount + 1` per scene change and back to 0 on the seventh, and what it
 *     ends on is the number of standpoints the player passed through in the mine
 *     modulo seven. That number is set by `initxyz ()`'s two `random (8)` draws
 *     — how far away the skeleton was thrown — so it says how long the walk was,
 *     not what was done on it. It happens to come out 1 under this suite's seed;
 *     claiming it would be claiming the coincidence.
 *   - **`betorder`, `winner`, `playercount` and `playerhand`**, all four of
 *     which the save loses between `MSKPZL` and `MESAPZL` — and not one of them
 *     is a thing that happens here. They are the poker table's, dumped by
 *     `SALGAMES.FLT`'s `dumpsalgamesglobals ()` on day 3 in the saloon, forty
 *     thousand frames before this rung starts. What this rung does to them is
 *     take their storage, exactly as `rungs/d4mines.ts` describes for
 *     `cutdowns` and `wincount`: the globals container is a node array the
 *     reader walks by physical slot, a dumped name stays legible in its slot
 *     until something is allocated over it, and the mine allocates five
 *     (`maskcount`, `standx`, `standy`, `walkx`, `walky`) over four corpses.
 *     So `MSKPZL` carries `betorder = "mez zeb pete "` as a dead record, the
 *     port loads it as a live global because the loader cannot tell the two
 *     apart, and nothing underground touches it again. Claiming it would be
 *     claiming which day-3 corpse the mine happened to land on.
 *   - `idlecount` (0 → 2) is `BOOTFILE/0001 idle ()`'s mod-4 counter, and
 *     `walkx`/`walky` are `MINE.CST/0002 makemove ()`'s last target for a
 *     skeleton that is WALKING — which the one carrying this puzzle is not. Both
 *     are bookkeeping the save happens to have caught mid-stride. (The port
 *     leaves 2,2 in `walkx`/`walky` where the save has 0,0: after the gift the
 *     hand is empty, `walkloop ()`'s `if handitem != "mask"` downgrades the
 *     skeleton back to a wanderer and `initxyz ()` gives it a first move, and
 *     whether that beats `closecastfile ("mine")` is a matter of a frame.)
 *   - `phase` stays 0 at both ends. `offerobject ()` would raise it to 1 with
 *     all four puzzles done, and the thunderbird's is not.
 *
 * **An engine note, and it does not change the outcome.** `MINE.SET/0001`'s
 * wraps end `changeall (…)` then `currentscene ("scene e3")`, a bare teleport
 * with no `currentview ()` after it. In this port `currentscene (name)` only
 * BUFFERS the jump — `viewer.ts`'s `sceneJump` stores it in `pendingJumpScene`
 * and `viewJump` is what executes it — so the teleport never fires and the
 * player stays on the arm end instead of being put out at the far one.
 * `changeall ()` still runs, so `standx`/`standy` still move a quarter turn per
 * press and the puzzle still ends in the same place; what changes is that the
 * walk back along the arm is a walk of nought. The route is written as the walk
 * anyway — `walkTo` to the arm end, then the press — so it plays the same on an
 * engine that teleports, where the `walkTo` has work to do.
 */
export const rung: Segment = {
  from: "MSKPZL",
  to: "MESAPZL",
  what: "the Mask to the skeleton in the mine, and the dials left set for the thunderbird",
  claims: ["minepuzzle", "handitem", "blackout", "largedial", "meddial", "smalldial"],
  async play(p: Pumped) {
    const hub = set("HUB");
    const mine = set("MINE");
    const num = (name: string): number => Number(p.session.interp.globals.get(name));
    const str = (name: string): string =>
      String(p.session.interp.globals.get(name) ?? "").toLowerCase();
    const flat = (): string => ask(p, "currentflat").toLowerCase();

    /** the sundial, set and left — clicked from Scene D5 facing north */
    const dialFor = async (large: number, med: number, small: number, why: string): Promise<void> => {
      await walkTo(p, hub, { x: 3, z: 4, view: "north" });
      p.fire((142 + 372) / 2, (142 + 190) / 2);
      await p.pump(() => flat() !== "mainpanel", `the sundial to open for ${why}`);
      await p.settle("the sundial");
      await turnDial(p, "largedial", large);
      await turnDial(p, "meddial", med);
      await turnDial(p, "smalldial", small);
      p.fire((50 + 135) / 2, (311 + 336) / 2);
      await p.pump(() => str("nextroom") === why, `exitsundial () to choose the ${why}`);
      await p.settle("the hub");
    };

    /**
     * Go dark at an arm's end and press until the dark ends.
     *
     * The count is `blackout` and the world's, not a guess at one: `gotoblack ()`
     * sets it, every keypress in the dark takes one off, and the press that
     * finds it at 0 is the press that arrives somewhere.
     */
    const pressThroughTheDark = async (until: () => boolean, what: string): Promise<void> => {
      for (let i = 0; i < 30 && !until(); i++) await p.press("uparrow", `feeling for ${what}`);
      if (!until()) throw new Error(`the dark never ended — ${what}`);
    };

    // ---- 1. the Mask into the hand, out of the avatar panel -----------------
    p.fire((395 + 507) / 2, (268 + 379) / 2);
    await p.pump(() => flat() === "avatar", "the avatar panel");
    await takeInHand(p, "Mask", "the Mask, for the skeleton to be findable at all");
    p.fire((266 + 367) / 2, (321 + 345) / 2);
    await p.pump(() => flat() !== "avatar", "the panel to close");
    await p.settle("the panel");

    // ---- 2-3. the dials on the mine, and out of the sundial -----------------
    await dialFor(4, 8, 12, "mine");

    // ---- 4. north arm, into the black, and through it -----------------------
    await walkTo(p, hub, { x: 3, z: 0, view: "north" });
    await p.press("uparrow", "into the dark at the north arm");
    await pressThroughTheDark(() => room(p) === "mine", "the mine");
    await p.pump(
      () => p.session.interp.globals.get("standx") !== undefined,
      "MINE.CST/0002 initxyz () to throw the skeleton",
    );
    if (ask(p, "actorvalue", ["skeleton"]) !== "1") {
      throw new Error("the skeleton is a wanderer, not the puzzle — the Mask was not in hand");
    }

    // ---- 5. the maze: wrap an arm at a time until the skeleton is in the middle
    const ends: Record<string, { x: number; z: number; view: string }> = {
      // scene a3 west: changeall (0, 4)     scene e3 east: changeall (0, -4)
      xup: { x: 0, z: 2, view: "west" },
      xdown: { x: 4, z: 2, view: "east" },
      // scene c1 north: changeall (4, 0)    scene c5 south: changeall (-4, 0)
      yup: { x: 2, z: 0, view: "north" },
      ydown: { x: 2, z: 4, view: "south" },
    };
    const home = (): boolean => num("standx") === 640 && num("standy") === 640;
    // sixteen wraps is the furthest `initxyz ()` can throw it on either axis
    for (let wrap = 0; wrap < 40 && !home(); wrap++) {
      const which =
        num("standy") > 640 ? "ydown"
        : num("standy") < 640 ? "yup"
        : num("standx") > 640 ? "xdown"
        : "xup";
      await walkTo(p, mine, ends[which]);
      await p.press("uparrow", `wrapping the mine ${which}`);
    }
    if (!home()) {
      throw new Error(`the skeleton is still at ${num("standx")},${num("standy")} and not 640,640`);
    }

    // ---- 6. stand with it and hand the Mask over ----------------------------
    const cell = { x: (num("standx") - 128) / 256, z: (num("standy") - 128) / 256 };
    const near = (): boolean => Number(ask(p, "actordist", ["skeleton"])) <= 320;
    for (const view of ["north", "east", "south", "west"]) {
      await walkTo(p, mine, { ...cell, view });
      if (near()) break;
    }
    if (!near()) {
      throw new Error(`the skeleton is not in reach at ${p.session.currentSceneName()}`);
    }
    await offerTo(p, "skeleton", "mask", "the Mask to the skeleton");
    await p.pump(() => str("minepuzzle") === "done", "MINE.CST/0002 offerobject () to take the Mask");
    await p.pump(() => room(p) === "hub", "skeleton.mov and the way back to the hub");
    if (ask(p, "propowner", ["mask"]).toLowerCase() !== "skeleton") {
      throw new Error(`the Mask is still ${ask(p, "propowner", ["mask"])}'s`);
    }

    // ---- 7. out of the dark the hub puts you back in -----------------------
    await pressThroughTheDark(() => num("blackout") === -1, "the hub to come back");

    // ---- 8-9. the dials on the thunderbird, and the south arm --------------
    await dialFor(12, 4, 8, "tbird");
    await walkTo(p, hub, { x: 3, z: 6, view: "south" });
    await p.press("uparrow", "into the dark at the south arm");
    await pressThroughTheDark(() => room(p) === "tbird", "the thunderbird");
  },
};
