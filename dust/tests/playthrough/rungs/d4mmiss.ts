import { answer, clickActor, openDoor, room, set, takeInHand, walkTo, type Segment } from "../route";

/**
 * Day 4, night: through the courthouse to the mission, Sonoma's last word, and
 * in to the padre with the blade in hand.
 *
 * The save is called `D4M_MISS` and it is not a morning save. `rtdthread`
 * reports it as the one save on the disc whose NAME disagrees with its own day
 * and clock, and the file itself reads `day = 4, clock = 3` — the same night
 * `D4E_001` was written in, 1700 frames earlier. Everything below is read off
 * the standpoint and the globals rather than off the name.
 *
 * Four globals of substance, and they are four steps of one walk.
 * `townscene` ends "Scene G4", the courthouse cell of the town; `theset` reads
 * "court"; the standpoint is `padre.set`; and `handitem` is "Blade".
 * `rungs/d3mclas.ts` works out the same courthouse→mission→school geometry for
 * day 3, and day 4's gates differ in exactly one place: at `clock = 3` every
 * door on the chain opens onto its NIGHT set, and one of them opens for the
 * first time in the game.
 *
 *  1. **The courthouse corner, at night.** `D4E_001` stands on NITE Scene G5,
 *     cell (6,4), facing south; the courthouse is one cell north.
 *     `NEW.FLT/0001 gototown ()` is why the town is `nite.set` at all —
 *     `if clock = 3 gotospecial ("nite.set", …)` — and `NITE.SET` carries the
 *     town's grid and its own scene scripts, so Scene G4 is still (6,3).
 *  2. **`lockcourt ()` is open, and only tonight.** `NITE.SET/0127`:
 *     `if day = 4 & clock = 3 return false` sits AHEAD of `if fighton = 1
 *     return true`, and `fighton` is 1 in `D4E_001` — the Kid's gang fight
 *     earlier in the day set it and nothing has cleared it. Any other night
 *     that flag would keep this door shut.
 *  3. **In, and the town's name is written down.** `pointincourt`
 *     160,22-338,214, the `door` prop set to "court", then `uparrow` →
 *     `gotointerior ("nitecour.set")`, because the same `keydown` branches on
 *     `clock = 3`. `gotointerior ()` (`NEW.FLT/0001`) is
 *     `if currentset () = "town" townscene = currentscene ()`, and `NITE.SET`'s
 *     set name IS "town" — which is the whole of the `townscene` claim, and why
 *     it arrives capitalised the way the set file spells the cell.
 *     `NITECOUR.SET` opens on its own default standpoint, Scene C5 (2,4)
 *     facing north.
 *  4. **Sonoma, whom the night courtyard sets up.** `NITECOUR.SET/0001
 *     openset ()` has three arms and the third is
 *     `if day = 4 & clock = 3 & sonomaphase = 0
 *     sendtoactor ("sonoma", setupactor ("mission"))`; `D4E_001` reads 4, 3
 *     and 0. That goes through `GANG.CST/1419 setupactor ()` → `stdactor (me)`
 *     → `theset = actorset (who)` = "court", which is the `theset` claim:
 *     `theset` names the last actor SET UP, not the room, and nothing is set up
 *     in the school or at the padre's afterwards. The same `stdactor ()` calls
 *     `actorspeed (who, stdspeed ("court"))` = 5, and Sonoma's saved speed
 *     drops from 32 in `D4E_001` to 5 in `D4M_MISS` — the call's own fingerprint
 *     in the save. (The 32 is `NITECOUR.SET/0001 closescene ()`, which speeds
 *     her up if she is still walking when a scene closes.)
 *  5. **Reaching her.** `GANG.CST/1419 mousedown` is `runpuppet ("sonoma.pup")`
 *     direct, with no `walktopuppet ()`, so it asks only for
 *     `realdist (me) < hotdist ()` — 512, since "court" is none of the four
 *     sets `GANG.CST/0001 hotdist ()` names. `setupactor ("mission")` puts her
 *     on `court.sonoma`, which `NITECOUR.SET` places at (640,640): the centre
 *     of Scene C3, cell (2,2), which is also the cell the schoolhouse door is
 *     opened from.
 *  6. **Her last word.** `SONOMA.PUP/0007 runyoself ()` forwards to the puppet
 *     named "day" @ `day`, and `SONOMA.PUP/0040` is short: `sonoma.35`,
 *     `sonoma.36`, one plaque — **101**, "What happens after that?" — and then
 *     `sonoma.37`, `sonoma.38`, `sendtoactor ("SONOMA", putdownactor ())` and
 *     `sonomaphase = 1`. Answered by id because `case -1` is a bare `exitcode`
 *     that leaves the phase at 0, and 101 is the only other arm. `counter` is
 *     untouched — 1 in both saves — because the `brushoff ()` that moves it is
 *     the arm taken when `sonomaphase` is ALREADY 1, and this rung is the visit
 *     that sets it. `putdownactor ()` also makes her invisible, which is what
 *     takes her back off the doorway before the next click.
 *  7. **The rice-paper door.** `NITECOUR.SET/0046`, Scene C3 facing north,
 *     `pointinrice` 148,45-355,263, the `door` prop set to "schoolin", `uparrow`
 *     → `gotointerior ("nitescho.set")` on `clock = 3`. `lockrice ()` is
 *     `if day < 3 return true`, so it is open. `NITESCHO.SET` opens on its
 *     default standpoint, Scene B2 (1,1) facing north.
 *  8. **The padre's door, which has never opened before.**
 *     `NITESCHO.SET/0035` is the schoolroom's west wall, Scene A2 (0,1):
 *     `pointindoor` 207,79-320,263, the `door` prop set to "padre", `uparrow`
 *     → `gotointerior ("padre.set")`. Its `lockpadre ()` is
 *     `if day < 4 return true` then `if clock < 3 return true` — day 4, night,
 *     and no other hour of the game satisfies both. That is the rung: it exists
 *     because this is the first moment the door answers.
 *  9. **Standing where the save stands.** `PADRE.SET` is six cells and two of
 *     them are reachable; its default standpoint is (0,1) facing **4**, west.
 *     `D4M_MISS` is (0,1) facing 2, south — one left turn off the arrival, and
 *     the direction of the set's only walk, `(0,1) south → (0,2) south`.
 *     `PADRE.SET/0036` is that next cell: `pointinsign` with
 *     `propowner ("tstone") = "stranger"` opens `dobox ()`, the yunni box.
 * 10. **The blade in hand.** `INVEN.PRP/0001 initprops ()` is
 *     `if day = 4 … if clock > 2 addinven ("blade")`, so the obsidian blade
 *     enters the inventory at nightfall on this one day; `D4E_001` is the first
 *     save carrying `Blade@stranger`, with `handitem` empty. Nothing changes
 *     hands in this rung — every prop's owner is identical in the two saves —
 *     so `handitem` is the panel gesture and nothing else: `stdmouse ()` sets
 *     `handitem = what` for a prop whose view is "panel" or "hilite", and the
 *     blade's view measures "panel" in `D4E_001`. It is one of the five
 *     `isyunni ()` items (`tstone`, `blade`, `mask`, `flute`, `tbird`), and the
 *     cell in front of the standpoint is the box that wants them — so the save
 *     is a player who has walked to the padre's and loaded their hand.
 *
 * **Not claimed**, and why.
 *
 *   - `stardy` (80 → -80), the rung's one bookkeeping global.
 *     `HOUSE.PRP/0002 setupstar ()` is the night town's shooting star, and it
 *     picks `southstar ()`, `eaststar ()` or `weststar ()` off `currentview ()`
 *     when its loop comes round. `eaststar ()` and `weststar ()` both write
 *     `stardy = -80` on day 2 and day 4; `southstar ()` writes 0. `D4E_001`'s
 *     80 is left over from an earlier night — `putdownprop ()`'s
 *     `dumpglobal stardx, stardy, stardz, starcount` only runs when the star is
 *     put down, and it has not been. So the -80 says a star happened to spawn
 *     east or west of us during the walk across the town, which is a fact about
 *     `random ()` and about how many frames the walk took, not about what was
 *     done.
 *   - The loop table and the pig. `D4M_MISS` has no `scene g14` loop because
 *     `NITE.SET/0001 closeset ()` stops it on the way out, and the periods on
 *     the two loops that survive are wherever their counters had got to. The
 *     pig has walked from Scene J7 to Scene I7 on `snortme`.
 */
export const rung: Segment = {
  from: "D4E_001",
  to: "D4M_MISS",
  what: "the courthouse at night, Sonoma's last word, and in to the padre",
  claims: ["sonomaphase", "theset", "townscene", "handitem"],
  async play(p) {
    const nite = set("NITE");
    const court = set("NITECOUR");
    const school = set("NITESCHO");
    const padre = set("PADRE");
    const num = (name: string): number => Number(p.session.interp.globals.get(name) ?? 0);

    // ---- 1-3. one cell north, and in at the courthouse ---------------------
    await walkTo(p, nite, { x: 6, z: 3, view: "north" });
    await openDoor(p, [160, 22, 338, 214], "court", "the courthouse door at night", {
      set: nite, x: 6, z: 3, view: "north",
    });
    await p.pump(() => room(p).startsWith("nitecour"), "the mission courtyard at night");
    if (String(p.session.interp.globals.get("townscene") ?? "").toLowerCase() !== "scene g4") {
      throw new Error(`townscene is "${p.session.interp.globals.get("townscene")}", not Scene G4`);
    }

    // ---- 4-6. Sonoma, on the schoolhouse door's own cell -------------------
    await walkTo(p, court, { x: 2, z: 2, view: "north" }, () => !!p.session.puppet);
    if (!p.session.puppet) await clickActor(p, "sonoma", "Sonoma in the night courtyard");
    await answer(p, 101, "What happens after that?");
    await p.pump(() => num("sonomaphase") === 1, "Sonoma to finish");

    // ---- 7. through the rice-paper door into the schoolroom ----------------
    await openDoor(p, [148, 45, 355, 263], "schoolin", "the schoolhouse door", {
      set: court, x: 2, z: 2, view: "north",
    });
    await p.pump(() => room(p).startsWith("nitescho"), "the schoolroom at night");

    // ---- 8. and through the padre's, which only day 4 at clock 3 opens -----
    await openDoor(p, [207, 79, 320, 263], "padre", "the padre's door", {
      set: school, x: 0, z: 1, view: "west",
    });
    await p.pump(() => room(p).startsWith("padre"), "the padre's room");

    // ---- 9. turn to face the cell with the yunni box in it ------------------
    await walkTo(p, padre, { x: 0, z: 1, view: "south" });

    // ---- 10. the blade out of the panel and into the hand -------------------
    await takeInHand(p, "Blade", "the obsidian blade for the box");
  },
};
