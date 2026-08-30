import { clickActor, openDoor, room, set, talkOut, walkTo, LEAVING, type Segment } from "../route";

/**
 * Day 4, morning: down to the lobby, past the jail, in the saloon's back door.
 *
 * The rung is four conversations and three doors, and every one of the phases it
 * moves belongs to a script that counts its own visits. Two of them land on
 * **2** rather than 1, and the reason is the same in both cases: the day-4
 * containers are a `switch` on the phase with one arm per click, and the
 * original clicked twice.
 *
 *   1. **Down the hotel stairs.** `D4M_001` stands at HOTUPPER Scene C1 facing
 *      west, in front of Buick's door. The stairs are Scene D1 (`0046`), whose
 *      `keydown` is `currentview () = "south" & arg = "uparrow"` → `hotdn.mov`
 *      and `gotospecial ("hotlower.set", "scene d3", "south")`. No door prop is
 *      involved: the press is the whole gesture.
 *   2. **Fear at the desk, who is not clicked.** `HOTLOWER.SET/0001 openset ()`
 *      puts him there — `if day = 4 & clock = 1 & fearphase = 0 → sendtoactor
 *      ("fear", setupactor ("hotel"))` — and `HOTLOWER.SET/0034 openscene ()`,
 *      the lobby corner Scene A1, does the rest by itself:
 *
 *          if day = 4 & clock = 1 & fearphase = 0 & currentview () = "north"
 *              cursor ("watch")
 *              currentscene ("right")
 *              while currentview () != "east" forceupdate () endwhile
 *              delay (40)
 *              sendtoactor ("fear", mousedown (0))
 *
 *      So walking into that corner and facing north hands the turn to the world:
 *      it spins you east to the desk and runs `FEAR.PUP/0053`, which speaks nine
 *      lines, does `putdownactor ()` and sets `fearphase = 1`. The walk below is
 *      therefore written with a `stopWhen` on `fearphase`, because after the
 *      script's own turn we are facing east and not the north that was asked
 *      for, and arriving is the point. The bell on the same scene's east view
 *      (`pointinbell`, 353,224-373,244) is the same call by hand if it is ever
 *      needed; the openscene is what the original tripped.
 *   3. **Out into the street.** Scene A1 facing west, `pointindoor`
 *      (128,73-394,262), door prop "hotout", and the `uparrow` is `gototown
 *      (currentview ())` — which is `gotospecial ("town.set", townscene, "west")`
 *      with `townscene` still "scene g5", the hotel's own cell.
 *   4. **Dell in the jail.** `TOWN.SET/0135` is Scene G12: west is the jail,
 *      east is Chin's. `lockjail ()` bars day 1, the whole of day 2 before
 *      nightfall and day 5; day 4 morning falls through to `return false`, so
 *      the door opens on a click and `uparrow` runs `gotointerior ("jail.set")`
 *      — which is also what writes `townscene = "Scene G12"` on the way in.
 *      Inside, `JAIL.SET/0001 openset ()` stands Dell up because
 *      `actorowner ("dell") = "jail"`, and `GANG.CST/0895 mousedown ()` reaches
 *      him with `runpuppet ("dell2.pup")` (the `dell1` arm is for the Dell who
 *      is out in the town) as long as `realdist (me) < hotdist ()` — 384 in the
 *      jail. He stands at `jail.dell1`, 588,132, which is the cell grid's C1;
 *      B1's centre is 204 away from him and A1's is 460, so the click has to be
 *      taken from inside the cell block. `DELL2.PUP/0083` — "dell day 4" — is
 *      seven `puppetspeak`s and `dellphase = 1`, with no plaque anywhere in it,
 *      so what counts as having been heard is the phase and not a conversation.
 *   5. **Out again**, Scene A1 facing west, `pointindoor` (183,34-361,263),
 *      door prop "lock", `gototown ("east")` — back to Scene G12 facing east.
 *   6. **The saloon's back door.** Not the front one, though on day 4 the front
 *      one is open: `TOWN.SET/0131 locksaloon ()` bars `clock = 1` only when
 *      `day != 4`. The original went round the back anyway, and the save says so
 *      twice over — `handitem` is "hhkey" and `townscene` is "Scene G8", and
 *      both of those are written by `TOWN.SET/0088`, the back door on Scene D10:
 *      the `mousedown` is `sendtoshop ("inven", addinven ("hhkey"))` followed by
 *      `sendtoprop ("door", setupprop ("back"))`, and the `uparrow` is
 *      `townscene = "scene g8"` and `gotospecial ("sallower.set", "scene b4",
 *      "east")`. `lockback ()` opens it to whoever holds the key, and `HHKey` has
 *      been the player's since day 2.
 *
 *      Going round the back is also the only way in that is SAFE. `TOWN.SET/0131`
 *      is Scene G8, the front door's own cell, and its `openscene ()` ends
 *
 *          if day = 4 & clock = 1 & phase = 1
 *              sendtostage (advanceday ())
 *
 *      — so once step 7 has set `phase = 1`, stepping onto that cell is the end
 *      of the morning. The route never returns to the street after the saloon,
 *      and this rung is why.
 *   7. **Jones and Trotter, twice each.** `SALLOWER.SET/0001 openset ()` has a
 *      bare `if day = 4` arm that stands both of them up at `day4am`
 *      (`GANG.CST/0267` and `/0670`): `sal.jones9` at 580,580 and
 *      `sal.trotter9` at 590,714, which the `to` save records to the unit. Both
 *      cast entries take a short cut in this room —
 *
 *          if actorset (me) = "sallower"
 *              currentscene ("scene c3")
 *              currentview ("west")
 *              ... runpuppet ("jones.pup")
 *
 *      — so there is no `walktopuppet ()` here and none of its row-or-column
 *      gate; the only condition is `realdist (me) < hotdist ()`, 384 in the
 *      saloon, and the click MOVES the standpoint to Scene C3 facing west.
 *      That is why the walk below goes to C3 first: it is where the click puts
 *      you anyway, and from there both of them are under a hundred units off.
 *
 *      `TROTTER.PUP/0074` ("TROTTER DAY 4") is a `switch trotterphase` with an
 *      arm per click — 0 → 1, 1 → 2, 2 → 3 — so two clicks and no more; a third
 *      would overshoot the save. `JONES.PUP/0075` is the same shape and carries
 *      the rung's last global with it:
 *
 *          case 1
 *              puppetspeak ("jones.161") ... jonesphase = 2
 *              phase = 1
 *
 *      So `phase` becoming 1 is not a separate event at all — it is Jones's
 *      second line of the morning. Neither file opens a plaque, so both are
 *      driven by `clickActor` against the phase rather than against a
 *      conversation.
 *   8. **Scene C1 facing east**, which is where `D4M_002` was taken: one cell
 *      back from the swing doors, with the puppet file still open.
 *
 * **Not claimed.** `idlecount` is `BOOTFILE/0001 idle ()`'s mod-4 counter and
 * `tumx2`/`tumy2` are the tumbleweed blowing down the street on its own loop —
 * all three say when the save was written, not what was done. `theset` IS
 * claimed: it is `GANG.CST/0001 stdactor ()`'s scratch (`theset = actorset
 * (who)`), and it reads "sallower" at the far end because the last two actors
 * anybody stood up were Jones and Trotter in the saloon, which is exactly what
 * step 7 does.
 */
export const rung: Segment = {
  from: "D4M_001",
  to: "D4M_002",
  what: "down to the lobby, past the jail, in the saloon's back door",
  claims: [
    "day", "clock", "phase", "handitem", "townscene", "theset",
    "fearphase", "dellphase", "jonesphase", "trotterphase",
  ],
  async play(p) {
    const num = (name: string): number => Number(p.session.interp.globals.get(name) ?? 0);
    await p.pump(() => !p.session.puppet, "the landing to settle");

    // 1. down the stairs — HOTUPPER Scene D1 facing south, and `hotdn.mov`
    await walkTo(p, set("HOTUPPER"), { x: 3, z: 0, view: "south" });
    await p.press("uparrow", "down the hotel stairs");
    await p.pump(() => room(p).startsWith("hotlower"), "the lobby");

    // 2. the lobby corner, where the world turns us to the desk itself
    await walkTo(
      p,
      set("HOTLOWER"),
      { x: 0, z: 0, view: "north" },
      () => num("fearphase") >= 1,
    );
    if (num("fearphase") < 1) {
      // the openscene did not catch us; the desk bell is the same call by hand
      await clickActor(p, "fear", "the clerk at the desk", 8, () => num("fearphase") >= 1);
    }
    await p.pump(() => num("fearphase") >= 1, "Fear to finish");
    await talkOut(p, LEAVING, "the clerk", 2);

    // 3. out of the hotel — `gototown ()` puts us back on Scene G5
    await openDoor(p, [128, 73, 394, 262], "hotout", "the hotel door", {
      set: set("HOTLOWER"), x: 0, z: 0, view: "west",
    });
    await p.pump(() => room(p).startsWith("town"), "the street");

    // 4. the jail — Scene G12 facing west, and Dell in the cell block
    await talkOut(p, LEAVING, "anyone in the street", 2);
    await openDoor(p, [122, 77, 218, 230], "jail", "the jail door", {
      set: set("TOWN"), x: 6, z: 11, view: "west",
    });
    await p.pump(() => room(p).startsWith("jail"), "the jail");
    await walkTo(p, set("JAIL"), { x: 1, z: 0, view: "east" });
    await clickActor(p, "dell", "Dell behind the bars", 12, () => num("dellphase") >= 1);
    await p.pump(() => num("dellphase") >= 1, "Dell to finish");
    await talkOut(p, LEAVING, "Dell", 2);

    // 5. out of the jail — Scene A1 facing west, back to Scene G12 facing east
    await openDoor(p, [183, 34, 361, 263], "lock", "the jail's own door", {
      set: set("JAIL"), x: 0, z: 0, view: "west",
    });
    await p.pump(() => room(p).startsWith("town"), "the street again");

    // 6. the saloon's back door — Scene D10 facing east; the click is the key
    await talkOut(p, LEAVING, "anyone in the street", 2);
    await openDoor(p, [3, 83, 91, 234], "back", "the saloon's back door", {
      set: set("TOWN"), x: 3, z: 9, view: "east",
    });
    await p.pump(() => room(p).startsWith("sallower"), "the saloon");

    // 7. Trotter twice, Jones twice — and Jones's second line is `phase = 1`
    await walkTo(p, set("SALLOWER"), { x: 2, z: 2, view: "west" });
    await clickActor(p, "trotter", "Trotter, first", 12, () => num("trotterphase") >= 1);
    await clickActor(p, "trotter", "Trotter, again", 12, () => num("trotterphase") >= 2);
    await clickActor(p, "jones", "Jones, first", 12, () => num("jonesphase") >= 1);
    await clickActor(p, "jones", "Jones, again", 12, () => num("jonesphase") >= 2);
    await p.pump(() => num("phase") >= 1, "Jones to set the phase");

    // 8. and back to Scene C1, a cell short of the swing doors
    await walkTo(p, set("SALLOWER"), { x: 2, z: 0, view: "east" });
  },
};
