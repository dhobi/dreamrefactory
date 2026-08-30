import { ask, clickThrough, dragTo, openDoor, room, set, takeInHand, walkTo, type Segment } from "../route";

/**
 * The yunni stone into the box, and down through the mission fountain.
 *
 * The rung the whole of Dust has been walking towards: `D4M_MISS` stands in the
 * padre's room at night with the obsidian blade in hand, and `D4MINES` stands
 * underground. Four things move — the Tstone changes owner to `box`, `handitem`
 * empties, `blackout` becomes -1, and six globals that did not exist come into
 * existence — and every one of them is a step of one short walk.
 *
 *  1. **The box wants the STONE, and takes it from the hand.** `PADRE.SET/0036`
 *     is Scene A3, the cell in front of the standpoint: `mousedown` is
 *     `if currentview () = "east" & pointinsign (arg) &
 *     propowner ("tstone") = "stranger" dobox ()`, and `dobox ()` closes the
 *     stage and opens `yunnibox.flt`. The gate is the STONE's owner, so the box
 *     is only openable while it is still unspent — which is also why the click
 *     has to happen before the gift and not after.
 *  2. **Facing east, not south.** `D4M_MISS` is Scene A2 facing south, and the
 *     set's only walk is `(0,1) south → (0,2) south` — so the standpoint is
 *     aimed at the box's cell and not at the box. `PADRE.SET` has six cells and
 *     two of them are reachable; the box is on the east wall of the second.
 *  3. **The stone goes into the hand from the PANEL.** `INVEN.PRP/0001
 *     stdmouse ()`: a click on an inventory prop whose view is "panel" or
 *     "hilite" puts the old hand item back to "panel", highlights the new one
 *     and sets `handitem`. That is the gesture, and it is available anywhere.
 *     The original did it INSIDE the box — see the note on the avatar below —
 *     and arrived at the same `handitem`.
 *  4. **The lid.** `yunnibox.flt` has three flats. Flat 0 is the shut box and
 *     its one live region, 138,62-387,185, plays `boxopen.mov` and
 *     `gotoflat ("flat 1")`; flat 1 is the open box. Both films are eight frames
 *     ending on an `action 1` exit, so they play themselves out.
 *  5. **The gift is a DRAG, because the box is not a cast member.**
 *     `YUNNIBOX.FLT/0008 offerobject (what)` is
 *     `if currentflat () = "flat 1" & what = "tstone"` →
 *     `giveinven ("tstone", "box")`, and the only thing that reaches it is
 *     `stdmouse ()`'s second branch: with the item drawn "large" it holds the
 *     mouse, follows it, and hit-tests the RELEASE against actors, then
 *     `pointinset`, then `pointinstage`. `openflat ()` is what draws it large —
 *     `propvisible (handitem, true); propview (handitem, "large");
 *     propxy (handitem, 316, 320)` — so the item in hand is on the box's own
 *     screen the moment the flat opens, and `dragTo ()` carries it into the box
 *     and lets go. `giveinven ()` then does the two things the save records in
 *     one line: `if handitem = newitem propvisible (handitem, false);
 *     handitem = ""`, and `propowner ("tstone", "box")`. **That** is why
 *     `handitem` ends empty: nothing is picked up afterwards because the thing
 *     that was in the hand is what was given.
 *  6. **Shut it.** The gift ends on `gotoflat ("mainbox")`, whose 103,3-391,208
 *     runs `boxfinal.mov` — the glow — and then `doexit ()`, which reopens
 *     `new.flt` and hands the set back.
 *  7. **Out the way we came in.** `PADRE.SET/0035`, Scene A2 facing east:
 *     `pointinrice` 193,81-303,264, the `door` prop set to "padreout", then
 *     `uparrow` → `gotospecial ("nitescho.set", "scene a2", "east")` on
 *     `clock = 3`. `lockrice ()` here is `return false` unconditionally.
 *  8. **Out of the schoolroom.** `NITESCHO.SET/0037` is Scene B2, the room's
 *     south wall: `pointinrice` 147,78-376,263, the `door` prop set to
 *     "schoolout", `uparrow` → `gotospecial ("nitecour.set", "scene c3",
 *     "south")`. The save's own `door` prop is the receipt for this being the
 *     last door opened — `HOUSE.PRP/0562 setupprop ()` gives "schoolout" the
 *     view "schooloutnite" at `clock = 3`, the set "school" and the position
 *     380,480,146, and `D4MINES` carries exactly those four fields.
 *  9. **The fountain, which the stone in the box has opened.**
 *     `NITECOUR.SET/0001 fountain ()`:
 *
 *         if day = 4 & clock = 3 & propowner ("tstone") = "box"
 *             playmovie ("openfoun.mov")
 *             closesetfile ()
 *             opensetfile ("hub.set")
 *
 *     and otherwise it is a little `spotmovie` of water. Four cells can reach
 *     it and the door in step 8 lands on one of them: Scene C3 facing south is
 *     `NITECOUR.SET/0046`'s `pointinpool`, 173,175-346,249. So the walk from
 *     the schoolroom to the passage is no walk at all — the door aims you at
 *     it. (`openfoun.mov` is 83 frames of fall-through ending on an `action 1`,
 *     so it needs no click.)
 * 10. **The dark at the bottom is a COUNTER, and it is spent one keypress at a
 *     time.** `opensetfile ()` fires `HUB.SET/0001 openset ()`, which is
 *     `blackout = 3 + random (3)` and `sendtoflat (currentflat (), noface ())`.
 *     `HUB.SET/0061` is Scene D7, the cell the set opens on (its default
 *     standpoint is (3,6) facing 1), and its `keydown` reads
 *
 *         if blackout > 0    blackout = blackout -1 ... exitcode
 *         if blackout = 0    currentview ("north") comefromblack () ... exitcode
 *
 *     — so while the counter is running every key is swallowed, and the press
 *     that finds it at zero fades the palette up and sets `blackout = -1`
 *     (`comefromblack ()`). That is the whole of the `blackout` claim: **-1 is
 *     not "dark", it is "the lights have finished coming up"**, and the walk
 *     into the hub cannot start until it reads -1. Seeded at 19950101 the
 *     counter opens at 4 and takes five presses. The loop below stops the
 *     instant it reads -1, because the sixth press would fall through to
 *     `if arg = "uparrow" & currentview () = "south" gotoblack ()` and, failing
 *     that, out to the set main's `currentscene ("strait")`.
 * 11. **The five globals that come into being.** `openset ()` declares
 *     `global nextroom, blackout`; `HUB.SET/0001 seeshaman ()` declares
 *     `global phase, minepuzzle, tbirdpuzzle, snakepuzzle, flutepuzzle` and is
 *     called from the same `keydown` on the press that ends the blackout. All
 *     six read 0 in `D4MINES`, which is the underground saying nothing has been
 *     done in it yet — no room named for the next exit, none of the four
 *     puzzles solved. `seeshaman ()` returns false for exactly that reason
 *     (`if flutepuzzle = "done" | ... return true`), so no shaman is set up.
 *
 * **The avatar, and a `currentstage ()` this port answers differently.**
 *
 * The original swapped the blade for the stone from INSIDE the box, and the
 * props say so twice over. `D4M_MISS` carries the Blade at 316,320 with the view
 * "large" and visible — which is not what a panel click leaves (that is
 * "hilite", in place) but is exactly `YUNNIBOX.FLT/0008 openflat ()`, so the
 * save is a player standing at the box holding the wrong stone. And `D4MINES`
 * carries the Blade back at **459,160**, view "panel", invisible — and the only
 * thing in the corpus that puts it there is `INVEN.PRP/0362 moveyoself ()`,
 * called only by `NEW.FLT/0008 showprop ()`, which is the avatar panel laying
 * its inventory out. So the panel was opened between the two saves.
 *
 * The way in is the little face at 460,325: `HOUSE.PRP/0073 mousedown` is
 * `if currentstage () = "yunnibox" sendtoflat (currentflat (), handleit ())`,
 * and `YUNNIBOX.FLT/0008 handleit ()` swaps the stage for `new.flt`, goes to
 * flat "avatar" and runs `sendtoshop ("inven", handleselect ())`.
 *
 * **In this port that branch cannot be taken.** A v1 `.FLT` has no name field,
 * so `currentstage ()` falls back to the FILE (`engine/src/df/stg.ts`,
 * `runtime/builtins/scene.ts`) and answers `"yunnibox.flt"`; measured, the click
 * lands on the prop — `hittest` at 460,325 answers `avatar`/`prop` — and the
 * handler runs and does nothing. The same handler compares four of its six
 * stages WITH the extension (`"fight.flt"`, `"flute.flt"`, `"tumble.flt"`,
 * `"sundial.flt"`) and two without (`"scorp"`, `"yunnibox"`), so no single
 * answer satisfies all six and the shipped file is inconsistent with itself —
 * but `D4MINES`'s Blade at 459,160 is evidence that the no-extension pair is the
 * one DF.EXE took.
 *
 * So step 3 takes the stone in the panel BEFORE the lid is opened. It is the
 * same code — `stdmouse ()`'s first branch is what the picker's press reaches —
 * and it leaves `handitem`, the Tstone's owner and every global identical. What
 * it does not reproduce is the Blade's screen position and visibility, which
 * `showprop ()`/`hideprop ()` would have set and which this route never opens.
 * Neither is checked by the suite; both are said here rather than left to be
 * discovered.
 *
 * **Not claimed**, and why.
 *
 *   - `cutdowns` (5 → gone) and `wincount` (3 → gone), and they are not a thing
 *     that happens here. Nothing on this route names either: the only scripts
 *     that dump them are `NITE.SET/0128 openkid ()` (`dumpglobal cutdowns`) and
 *     `KID.PUP/0051` (`dumpglobal badcount, wincount`), and both ran in the
 *     day-4 AFTERNOON, an hour of game time before `D4M_MISS` was written. What
 *     this rung does to them is take their storage: the globals container is a
 *     32-byte node array read by physical slot, and in `D4E_001` and `D4M_MISS`
 *     `cutdowns` sits at +3644 and `wincount` at +3676 with a stale second
 *     `wincount` node at +3708 and seven stale `roundnum` nodes after it — dead
 *     records the reader cannot tell from live ones. In `D4MINES` those six
 *     slots hold `nextroom`, `blackout`, `minepuzzle`, `tbirdpuzzle`,
 *     `snakepuzzle`, `flutepuzzle`, in that order, lowest address first. So the
 *     rung's "cutdowns 5→0, wincount 3→0" is six new globals being allocated
 *     over two old nodes, and a route can neither cause it nor be blamed for
 *     it. The port, whose loader reads the same physical slots, comes out of
 *     this rung still holding both at 5 and 3.
 *   - `idlecount` (2 → 0) is `BOOTFILE/0001 idle ()`'s mod-4 counter and says
 *     how many frames went by, not what was done in them.
 *   - The three loops' periods, and `shootingstar`'s position. `HOUSE.PRP/0002
 *     setupstar ()` is still turning over out in the town; `stardy` is -80 at
 *     both ends and happens to match.
 *   - `avatar`'s view ("nitefaces" → "yunni") and the `mainpanel` loop
 *     ("makeface" → "yunniface") are not claimed but are worth reading as
 *     corroboration: `NEW.FLT/0002 noface ()` swaps the panel's face for the
 *     yunni one when `day = 4 & clock = 3` and `currentset ()` is one of
 *     `hub, tbird, snake, flute, mine`, and `openset ()`'s own
 *     `sendtoflat (currentflat (), noface ())` is what runs it. The run reaches
 *     both.
 */
export const rung: Segment = {
  from: "D4M_MISS",
  to: "D4MINES",
  what: "the yunni stone into the box, and down through the mission fountain",
  claims: ["handitem", "blackout", "nextroom", "minepuzzle", "snakepuzzle", "tbirdpuzzle", "flutepuzzle"],
  async play(p) {
    const padre = set("PADRE");
    const school = set("NITESCHO");
    const court = set("NITECOUR");
    const num = (name: string): number => Number(p.session.interp.globals.get(name) ?? 0);
    const owner = (name: string): string => ask(p, "propowner", [name]).toLowerCase();
    const flat = (): string => ask(p, "currentflat").toLowerCase();
    const stage = (): string => ask(p, "currentstage").toLowerCase();

    // ---- 3. the stone out of the panel and into the hand -------------------
    await takeInHand(p, "Tstone", "the yunni stone the box is cut for");

    // ---- 1-2. one cell on, and round to the wall the box is set in ---------
    await walkTo(p, padre, { x: 0, z: 2, view: "east" });

    // ---- 1. the box, which only opens while the stone is still ours --------
    const sign = { x: (187 + 315) / 2, y: (151 + 224) / 2 };
    await clickThrough(p, () => p.fire(sign.x, sign.y), () => stage().startsWith("yunnibox"), "the yunni box", sign);

    // ---- 4. the lid --------------------------------------------------------
    const lid = { x: (138 + 387) / 2, y: (62 + 185) / 2 };
    await clickThrough(p, () => p.fire(lid.x, lid.y), () => flat() === "flat 1", "the box lid", lid);

    // ---- 5. the stone in, which is a carry and a release and not a click ---
    for (let i = 0; i < 4 && owner("tstone") !== "box"; i++) {
      await dragTo(p, "Tstone", { x: 247, y: 150 }, "the yunni stone into the box");
      await p.settle("the box taking the stone");
    }
    if (owner("tstone") !== "box") {
      throw new Error(`the box would not take the stone — its owner is "${owner("tstone")}"`);
    }

    // ---- 6. shut it, and take the padre's room back ------------------------
    const glow = { x: (103 + 391) / 2, y: (3 + 208) / 2 };
    await clickThrough(p, () => p.fire(glow.x, glow.y), () => !stage().startsWith("yunnibox"), "the box lid shut", glow);
    await p.pump(() => room(p).startsWith("padre"), "the padre's room");

    // ---- 7. out the way we came in ----------------------------------------
    await openDoor(p, [193, 81, 303, 264], "padreout", "the padre's door from the inside", {
      set: padre, x: 0, z: 1, view: "east",
    });
    await p.pump(() => room(p).startsWith("nitescho"), "the schoolroom at night");

    // ---- 8. and out of the schoolroom into the courtyard -------------------
    await openDoor(p, [147, 78, 376, 263], "schoolout", "the schoolroom's rice-paper door", {
      set: school, x: 1, z: 1, view: "south",
    });
    await p.pump(() => room(p).startsWith("nitecour"), "the mission courtyard at night");

    // ---- 9. the fountain the stone in the box has opened -------------------
    await walkTo(p, court, { x: 2, z: 2, view: "south" });
    const pool = { x: (173 + 346) / 2, y: (175 + 249) / 2 };
    await clickThrough(p, () => p.fire(pool.x, pool.y), () => room(p).startsWith("hub"), "the fountain", pool);

    // ---- 10. the blackout, spent one press at a time -----------------------
    for (let i = 0; i < 12 && num("blackout") !== -1; i++) {
      await p.press("leftarrow", "the dark under the mission");
    }
    if (num("blackout") !== -1) throw new Error(`the lights never came up — blackout is ${num("blackout")}`);
    if (p.session.currentSceneName()?.toLowerCase() !== "scene d7") {
      throw new Error(`the hub opened on ${p.session.currentSceneName()}, not Scene D7`);
    }
  },
};
