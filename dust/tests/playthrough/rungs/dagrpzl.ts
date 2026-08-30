import { ask, dragTo, room, takeInHand, walkTo, type Segment } from "../route";
import { set as setFile } from "../route";
import type { Pumped } from "../harness";

/**
 * The flute room: the flute into the temple, five notes, and out through the
 * hub with the sundial set for the snake.
 *
 * `FLUTEPZL` stands on `flute.set` Scene B4 (1,3) facing north, which is that
 * set's own default standpoint (`FLUTE.SET`: `defaultCellX/Z = 1,3`,
 * `defaultFacing = 1`) — a player who has just dropped through the hub's west
 * arm and not yet touched anything. `DAGRPZL` stands on `snake.set` Scene B4
 * (1,3) facing north, which is likewise `SNAKE.SET`'s default. So the rung is
 * one puzzle, one sundial and one walk, and both ends are arrivals.
 *
 * **The tune is not in the save, and it is not five presses of guesswork
 * either.** `FLUTE.FLT/0001 evaluate ()` writes it out: `answerstr =
 * "1,2,3,4,5,"`, compared word for word against `flutestr`. So the phrase is
 * the five buttons in the order they are numbered. What the save carries —
 * `flutestr = "0,0,0,0,0,"`, `flutenum = 1` — is the RESET `mousedown` performs
 * on the far side of a completed phrase (`if flutenum > 5 … flutenum = 1;
 * flutestr = "0,0,0,0,0,"`), not the answer.
 *
 * The counting is exact, and it is the reason this is five presses and not six.
 * `FLUTE.SET/0041 mousedown` seeds `flutenum = 1` and `flutestr = "0,0,0,0,0,"`
 * on the way IN, and each press writes word `flutenum` and then increments; so
 * presses land on words 1..5, the fifth takes `flutenum` to 6, and `if flutenum
 * > 5` runs `evaluate ()`. `FLUTEPZL` carries no `flutenum` at all (the global
 * is absent — `SUNDIAL.FLT/0001 dumpyunniglobals ()` names it), which is what a
 * flute room nobody has opened yet looks like.
 *
 *  1. **The flute into the hand.** `INVEN.PRP/0001 stdmouse ()`: a click on an
 *     inventory prop whose view is "panel" sets `handitem` to it. `FLUTEPZL`
 *     has `handitem = ""` and `Flute@stranger`, and nothing can be offered to
 *     the temple that is not in hand.
 *  2. **The idol.** `FLUTE.SET/0041 mousedown` is Scene B4's, gated on
 *     `currentview () = "north"` and `pointinflute (arg)` —
 *     `pointx > 400 & pointy > 200 & pointx < 448 & pointy < 264` — and opens
 *     `flute.prp` + `flute.flt`, landing on Flat 0.
 *  3. **The gift, which is a DRAG and not a click.** `FLUTE.FLT/0001
 *     offerobject (what)` is
 *
 *         if what = "flute" & currentflat () = "flat 0" & pointy (mouse ()) < 264
 *             gotoflat ("flat 1")
 *             sendtoshop ("inven", giveinven ("flute", "temple"))
 *
 *     and the only thing that calls it is `INVEN.PRP/0001 stdmouse ()`'s
 *     `if pointy (arg) < 264 & pointinstage (arg) sendtoflat (currentflat (),
 *     offerobject (what))`, which reads the RELEASE point. Hence `dragTo` and a
 *     drop at 256,150. `Flute@stranger → Flute@temple` is the rung's one prop
 *     move, and it is checked here rather than claimed, because the suite
 *     checks globals.
 *  4. **Five notes.** Flat 1's five button regions, from `flatprops.ts`:
 *     but 1 423,116-439,131 · but 2 423,169-439,185 · but 3 423,89-438,104 ·
 *     but 4 422,142-438,157 · but 5 421,61-437,77. Each is a bare hotspot whose
 *     `mousedown` resolves on the stage main (`FLUTE.FLT/0001`), keyed on
 *     `target`. Pressed 1,2,3,4,5 the fifth press evaluates, `nextstep` reaches
 *     5, `flutepuzzle = "done"`, `flute.mov` plays and
 *     `sendtoset (gotohub ())` — `FLUTE.SET/0001` — closes the set and opens
 *     `hub.set` on ITS default standpoint, Scene D7 (3,6) facing north.
 *     `phase` stays 0: the `phase = 1` arm needs all four puzzles done.
 *  5. **The dark at the end of the arm.** `HUB.SET/0001 openset ()` sets
 *     `blackout = 3 + random (3)`, so the hub opens blind. Scene D7's script
 *     `HUB.SET/0061 keydown` spends it one press at a time
 *     (`if blackout > 0 blackout = blackout -1; stillblack ()`), and the press
 *     that finds it at 0 takes the `else` — `currentview ("north")`,
 *     `comefromblack ()` (which writes `blackout = -1`), and
 *     `if seeshaman () sendtoactor ("shaman", setupactor (…))`.
 *     `seeshaman ()` is true the moment any one puzzle is done, so it fires here
 *     and nowhere earlier — and `EXTRA.CST/0613 setupactor ()` opens
 *     `actorset (me, "hub")` and then `stdactor (me)`, whose first line
 *     (`GANG.CST/0001`) is `theset = actorset (who)`. That is the whole of the
 *     `theset "court" → "hub"` claim: it is the shaman being stood up, not the
 *     room being entered.
 *  6. **The sundial.** Four cells ring the centre and each shows the dial from
 *     its own side: `HUB.SET/0051` (Scene C4, facing east), `0057` (D3, south),
 *     `0059` (D5, north), `0065` (E4, west). D5 (3,4) is two cells up the arm
 *     from D7, so that is the one this uses. `pointinsundial (arg)` is
 *     `pointx > 142 & pointy > 142 & pointx < 372 & pointy < 190` with
 *     `phase < 3`, and `dosundial ()` opens `sundial.flt` + `sundial.prp`.
 *  7. **8 / 12 / 4.** `SUNDIAL.PRP/0001 initprops ()` puts all three dials at
 *     256,132 as concentric rings and gives each `propdeg` from its global;
 *     `SUNDIAL.FLT/0001 exitsundial ()` reads them back on the way out and
 *     `largedial = 8 & meddial = 12 & smalldial = 4 & snakepuzzle != "done"` is
 *     `nextroom = "snake"`. `FLUTEPZL` reads 0/0/8, the flute room's own
 *     combination, so all three have to move.
 *  8. **The exit** is `sundial.flt`'s only click region, 50,311-135,336
 *     (`doexit (arg)` → `exitsundial ()`), and `gotohub ()` there puts the room
 *     back without moving the standpoint.
 *  9. **Out through the west arm.** Scene A4 (0,3) is the snake door:
 *     `HUB.SET/0037 keydown` takes `uparrow` while `currentview () = "west"`
 *     into `gotoblack ()`, and the press that finds `blackout = 0` this time
 *     matches `nextroom = "snake"` and runs
 *     `sendtostage (gotointerior ("snake.set"))`. `blackout` lands on 0 rather
 *     than -1 because that branch never reaches `comefromblack ()` — and 0 is
 *     what `DAGRPZL` has.
 * 10. **The book.** `handitem = "Yunnibook"` is `stdmouse ()`'s panel branch
 *     again, and it has to come after the gift, because the gift is what empties
 *     the hand (`giveinven ()`: `if handitem = newitem … handitem = ""`). Taken
 *     last, in the snake room, so that nothing is being carried across
 *     `FLUTE.FLT/0002 openflat ()` and `SUNDIAL.FLT/0002 openflat ()`, both of
 *     which draw `handitem` large at 316,320 over their own puzzle.
 *
 * **Not claimed**, and why.
 *
 *   - `idlecount` (0 → 1), the rung's one bookkeeping global. It is
 *     `BOOTFILE/0001 idle ()`'s own counter — `idlecount = idlecount + 1`,
 *     zeroed every fourth pass — so what it records is which quarter of an idle
 *     cycle the save was written in, not anything that was done.
 *   - `blackout` and `nextroom`, which both end where they started (0 and 0) and
 *     so are not in the diff at all, even though the rung drives each of them
 *     through a whole cycle.
 *   - `Flute@temple`, checked in the body: the suite compares globals, and this
 *     is a prop owner.
 *
 * **Four things the port cannot do yet**, worked around here and reported
 * rather than fixed, because `route.ts`, `harness.ts` and `engine/` are shared
 * with four other rungs being written beside this one. All four are first
 * touched by the underground, which no rung has played before, and each is
 * marked at its call site below.
 */
export const rung: Segment = {
  from: "FLUTEPZL",
  to: "DAGRPZL",
  what: "the flute into the temple, the tune, and the sundial set for the snake",
  claims: [
    "flutepuzzle", "flutenum", "flutestr", "handitem",
    "largedial", "meddial", "smalldial", "theset",
  ],
  async play(p) {
    const hub = setFile("HUB");
    const g = (name: string): unknown => p.session.interp.globals.get(name);
    const num = (name: string): number => Number(g(name) ?? 0);
    const owner = (name: string): string => ask(p, "propowner", [name]).toLowerCase();
    const flat = (): string => ask(p, "currentflat").toLowerCase();

    /*
     * PORT GAP 1 — `currentsound ()` answers "" for an idle channel.
     *
     * `Scheduler.currentSound` returns the name of a live handle and the empty
     * string otherwise, and Dust's flute room asks the question the other way
     * round: `FLUTE.FLT/0001 mousedown` and `evaluate ()`, and
     * `FLUTE.PRP/0001 hidestep ()`, all open `while currentsound () != "none"
     * endwhile`. With "" for silence that is a loop with no exit, and the first
     * note press never returns — measured, the pump ran out at 40 000 steps.
     * They are the corpus's only three `!= "none"` tests, which is why nothing
     * has hit it before. Everything else compares against a NAME
     * (`SALGAMES.FLT`, `SNAKE.FLT`) and is unaffected either way.
     */
    const builtins = p.session.interp.builtins;
    const rawSound = builtins.get("currentsound")!;
    builtins.set("currentsound", async (interp, args, call, ctx) => {
      const playing = await rawSound(interp, args, call, ctx);
      return String(playing ?? "") === "" ? "none" : String(playing);
    });

    /*
     * PORT GAP 2 — `propxy (name, 3)` is not the packed POINT.
     *
     * The builtin reads axis 1 as x and everything else as y, so a script asking
     * for 3 gets the x coordinate as a bare number. Dust asks for 3 in three
     * places and every one of them wants a point:
     *
     *     orig = fixdeg256 (calcdeg (propxy (target, 3), arg) + 64)   SUNDIAL.PRP
     *     dist = calcdist (propxy (name, 3), propxy (target, 3))       SNAKE.PRP
     *
     * — a bearing from the prop to the cursor, and a distance between two props.
     * With 256 standing in for the sundial's centre, `calcdeg` measured from
     * (0,256) instead of (256,132): a full lap of the cursor round the dial
     * swept one sixteenth-sector, so the largest dial turned one step and then
     * stopped. Packed the way `propxyz (name, 4)` already is, it tracks.
     */
    const rawXY = builtins.get("propxy")!;
    builtins.set("propxy", (interp, args, call, ctx) => {
      if (args.length !== 2 || Number(args[1]) !== 3) return rawXY(interp, args, call, ctx);
      const x = Number(rawXY(interp, [args[0], 1], call, ctx)) & 0xffff;
      const y = Number(rawXY(interp, [args[0], 2], call, ctx)) & 0xffff;
      return (x << 16) | y;
    });

    // ---- 1. the flute into the hand ----------------------------------------
    await takeInHand(p, "Flute", "the flute the temple wants");

    // ---- 2. the idol on Scene B4's north wall -------------------------------
    /*
     * PORT GAP 3 — `sendtoshop ("flute", …)` reaches the PROP called Flute.
     *
     * `GameSession.findGlobalInstance` tries `propScriptFor` before `shopMains`,
     * and Dust has both an inventory prop named "Flute" and a shop file called
     * FLUTE.PRP. So `FLUTE.SET/0041`'s `sendtoshop ("flute", initprops ())` —
     * meant for `FLUTE.PRP/0001 initprops ()`, five `lowprop ("stepN")` calls —
     * resolved on the flute prop's script and chained up its parent to
     * `INVEN.PRP/0001 initprops ()`, which is the whole opening inventory:
     * measured, it ran `addinven ("tbird")`, `addinven ("tstone")` and
     * `addinven ("blade")`, so the flute left the player's hand before it could
     * be offered, `Tstone` was taken back out of the padre's box, and
     * `vitalframe` was restamped. `sendtoflat` above it in the same function
     * already prefers the addressee's own kind; `sendtoshop` does not.
     *
     * Taking the prop's script out of the table for the length of the gesture
     * makes the lookup fall through to `shopMains`, which is where the extension
     * -insensitive tail already finds "flute.prp". It goes back afterwards
     * because `dragTo` reaches the flute BY that entry.
     */
    const fluteProp = p.session.propScripts.get("flute")!;
    p.session.propScripts.delete("flute");
    try {
      p.fire(424, 232); // pointinflute: 400 < x < 448, 200 < y < 264
      await p.settle("the flute idol");
    } finally {
      p.session.propScripts.set("flute", fluteProp);
    }
    await p.pump(() => flat() === "flat 0", "the temple");

    // ---- 3. the flute onto the temple, press-carry-release -------------------
    for (let i = 0; i < 3 && owner("flute") !== "temple"; i++) {
      await dragTo(p, "Flute", { x: 256, y: 150 }, "the flute into the temple");
      await p.settle("the temple taking the flute");
    }
    if (owner("flute") !== "temple") {
      throw new Error(`the temple would not take the flute — it is "${owner("flute")}"`);
    }
    await p.pump(() => flat() === "flat 1", "the flute's five buttons");

    // ---- 4. "1,2,3,4,5," ----------------------------------------------------
    // …with the flute's prop script out of the way again, so that `evaluate ()`'s
    // `sendtoshop ("flute", showstep (…))` reaches FLUTE.PRP (see PORT GAP 3).
    p.session.propScripts.delete("flute");
    const notes: [number, number][] = [
      [431, 124], // but 1  423,116-439,131
      [431, 177], // but 2  423,169-439,185
      [431, 97],  // but 3  423,89-438,104
      [430, 150], // but 4  422,142-438,157
      [429, 69],  // but 5  421,61-437,77
    ];
    for (const [x, y] of notes) {
      p.fire(x, y);
      await p.settle("a note");
    }
    p.session.propScripts.set("flute", fluteProp);
    await p.pump(() => room(p).startsWith("hub"), "the hub, after flute.mov");
    if (String(g("flutepuzzle")).toLowerCase() !== "done") {
      throw new Error(`the phrase was not accepted — flutepuzzle is "${g("flutepuzzle")}"`);
    }

    /*
     * PORT GAP 4 — nothing puts the room back on the screen.
     *
     * `FLUTE.SET/0041` lowers `setvisible (false)` on the way into the puzzle,
     * and the way OUT of a solved one — `FLUTE.FLT/0001 evaluate ()` — never
     * raises it again; only `gotoflute ()`, the give-up path, carries a
     * `setvisible (true)`. In the original that cannot matter, so the flag must
     * come back with the stage: `evaluate ()` runs `closestagefile ()` and then
     * `sendtoset (gotohub ())`, which is `closesetfile () / opensetfile
     * ("hub.set")`, and one of those three is where 1995 raised it. The port
     * raises it only on load and on restart (`saveload-v1.ts`,
     * `prepareRestart`), so `session.viewShowing` stayed false in the hub — and
     * `ScreenDirector.keyDown` routes every key to the stage while no view is
     * showing. The hub took twelve arrow presses without moving or counting
     * down.
     */
    p.session.setVisible = true;

    // ---- 5. spend the dark, which is what stands the shaman up ---------------
    for (let i = 0; i < 12 && num("blackout") !== -1; i++) await p.press("leftarrow", "the dark");
    if (num("blackout") !== -1) throw new Error(`still in the dark — blackout is ${num("blackout")}`);
    if (p.session.currentSceneName()?.toLowerCase() !== "scene d7") {
      throw new Error(`the hub opened on ${p.session.currentSceneName()}, not Scene D7`);
    }
    if (String(g("theset")).toLowerCase() !== "hub") {
      throw new Error(`the shaman was not set up — theset is "${g("theset")}"`);
    }

    // ---- 6. two cells up the arm, to the face of the dial that reads north ---
    await walkTo(p, hub, { x: 3, z: 4, view: "north" });
    p.fire(257, 166); // pointinsundial: 142 < x < 372, 142 < y < 190
    await p.pump(() => ask(p, "currentstage").toLowerCase().startsWith("sundial"), "the sundial");

    // ---- 7. 8 / 12 / 4 ------------------------------------------------------
    await turnDial(p, "largedial", 8);
    await turnDial(p, "meddial", 12);
    await turnDial(p, "smalldial", 4);

    // ---- 8. out, which is where exitsundial () reads the three of them -------
    p.fire(93, 324); // the exit region, 50,311-135,336
    await p.pump(() => flat() === "mainpanel", "the hub back");
    await p.settle("the sundial closing");
    if (String(g("nextroom")).toLowerCase() !== "snake") {
      throw new Error(`the dials did not name the snake — nextroom is "${g("nextroom")}"`);
    }

    // ---- 9. down the west arm and into the dark again ------------------------
    await walkTo(p, hub, { x: 0, z: 3, view: "west" });
    await p.press("uparrow", "into the dark under the west arm");
    if (num("blackout") <= 0) throw new Error(`the west arm did not go dark — blackout is ${num("blackout")}`);
    for (let i = 0; i < 12 && !room(p).startsWith("snake"); i++) await p.press("leftarrow", "on through the dark");
    if (!room(p).startsWith("snake")) {
      throw new Error(`still in ${room(p)} — blackout ${num("blackout")}, nextroom "${g("nextroom")}"`);
    }

    // ---- 10. and the yunni book into the empty hand --------------------------
    await takeInHand(p, "Yunnibook", "the book about the Yunni");
  },
};

/** the sundial's three dials share a centre — 256,132, `SUNDIAL.PRP/0001
 *  initprops ()` — and are told apart by radius, not by rectangle */
const CENTRE = { x: 256, y: 132 };

/**
 * Which radius is this dial's ring, asked of the engine rather than measured.
 *
 * The same move `openDoor`'s `aim ()` makes: the three dials are concentric and
 * drawn one inside the next, so nothing in the file says where one ends. But
 * `hittest` answers per PIXEL (`PropRuntime.propAt` tests `frame.opaque`), so
 * walking out along one radius and asking who is there names all three bands —
 * measured here as small 12..54, medium 58..112, large 120..170 — and the
 * middle of the band is a point that stays on the ring all the way round.
 */
function ringRadius(p: Pumped, name: string): number {
  const band: number[] = [];
  for (let r = 4; r < 240; r += 2) {
    const hit = ask(p, "hittest", [Number(ask(p, "makepoint", [CENTRE.x + r, CENTRE.y]))]);
    if (ask(p, "result") === "prop" && hit.toLowerCase() === name) band.push(r);
  }
  if (!band.length) throw new Error(`nothing on the sundial answers to "${name}"`);
  return band[Math.floor(band.length / 2)];
}

/**
 * Turn one dial to one of its sixteen positions — a press, an ARC, and a
 * release.
 *
 * `SUNDIAL.PRP/0001 mousedown` is a polling drag and it steps by ONE:
 *
 *     orig = fixdeg256 (calcdeg (propxy (target, 3), arg) + 64)
 *     while stilldown ()
 *         newd = fixdeg256 (calcdeg (propxy (target, 3), arg) + 64)
 *         propdeg (target, limiter (orig, newd))
 *         forceupdate ()
 *         arg = mouse ()
 *
 * `limiter ()` reduces any change to ±1 (`if delt > 8 | delt < -8 delt = orig
 * -newd`, then `if delt < 0 delt = -1 else delt = 1`), so the dial follows the
 * cursor a sixteenth at a time and one lap of the cursor is one lap of the dial.
 * Sixteen positions on a cycle means a consistent direction reaches any of them
 * in at most sixteen sectors, so this only ever goes one way round and the
 * PREDICATE is `propdeg`, not a count of moves.
 *
 * It is none of the three gestures `route.ts` has. `p.fire` is a dispatched
 * click with the release already in it, so `while stilldown ()` makes no passes;
 * `hold ()` presses without dispatching, which is right for a script already
 * sitting in `if button ()` and wrong for one that has to be STARTED by a
 * mousedown; `dragTo ()` dispatches and then moves once. This is the browser's
 * own three-part gesture (`dust/src/main.ts`: pointerdown sets
 * `session.pointerDown` and calls `viewer.press`, pointermove is
 * `session.setPointer`, pointerup clears the flag and calls `viewer.release`) —
 * with the press left un-awaited, because it does not return until the drag
 * loop it starts has ended, and the ticks that carry the cursor round are what
 * end it.
 *
 * Sixty-fourths of a turn rather than sixteenths: a pointer step the size of a
 * whole sector can land either side of a boundary, and a quarter of one cannot
 * skip a sector however the ring happens to be phased.
 */
async function turnDial(p: Pumped, name: string, to: number): Promise<void> {
  const deg = (): number => Number(ask(p, "propdeg", [name]));
  if (deg() === to) return;
  const radius = ringRadius(p, name);
  const at = (step: number): { x: number; y: number } => ({
    x: Math.round(CENTRE.x + radius * Math.cos((step * 2 * Math.PI) / 64)),
    y: Math.round(CENTRE.y + radius * Math.sin((step * 2 * Math.PI) / 64)),
  });
  const first = at(0);
  p.session.setPointer(first.x, first.y);
  p.session.pointerDown = true;
  void p.session.track(p.v().press(first.x, first.y));
  try {
    // a full circle is 64 steps and sixteen positions; 192 is three laps, which
    // is a bound on a loop that reaches every position inside one
    for (let step = 1; step <= 192 && deg() !== to; step++) {
      const point = at(step);
      p.session.setPointer(point.x, point.y);
      await p.tick(3); // one pass of the drag loop is one frame (`stilldown ()`)
    }
  } finally {
    p.session.pointerDown = false;
    p.v().release(p.session.pointerX, p.session.pointerY);
  }
  await p.settle(`the ${name}`);
  if (deg() !== to) throw new Error(`${name} would not reach ${to} — it reads ${deg()}`);
}
