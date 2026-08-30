import {
  LEAVING, answer, ask, clickActor, offerInTalk, openDoor, room, set, talkOut, walkTo,
  type Segment,
} from "../route";
import type { Pumped } from "../harness";

/**
 * Day 2, afternoon: the sugarcubes for Trotter, and the town History from Chin.
 *
 * Fifteen minutes of the original's play across four rooms, and the only figure
 * in it that can be checked arithmetically is the cash: `D2A_006` carries $800
 * and `D2A_007` carries $765, and $35 is what `HELP2.PUP/0032 booktwopm ()`
 * charges for the book in the afternoon. (The same book is $50 in the morning,
 * `twoam ()`, and free on the second night, `belcherbeat ()` — so the price
 * alone dates the purchase to this rung.)
 *
 *   1. **Trotter is drunk at the bar.** `SALLOWER.SET/0001 openset ()` puts him
 *      there for `day = 2 & clock = 2 & trotterphase = 3`, which is exactly the
 *      state `D2A_006` is in, and `sal.trotter1` is cell (2,2) — one cell north
 *      of the standpoint the save was taken at, well inside the 384 that
 *      `GANG.CST/0001 hotdist ()` allows in `sallower`. So he is clicked from
 *      where the save stands.
 *   2. `TROTTER.PUP/0076 day2pm ()` sends `trotterphase = 3` to `hesdrunk ()`,
 *      whose plaques are "Can't we talk." (101), "Would you mind if I talked to
 *      Ruby?" (102), the inventory's own handle (55555) and "So long, Nate."
 *      (103). The sugarcubes go through the 55555 plaque — `offerInTalk` — and
 *      `TROTTER.PUP/0007 gift ()` does the rest: at `clock = 2 & day = 2 &
 *      trotterphase = 3` it speaks two lines, walks him off to `sal.trotter2`
 *      and sets **`trotterphase = 5`**. Any other state gets a brush-off and
 *      leaves the phase where it was, so 5 is proof the right window was used.
 *   3. He never arrives. `GANG.CST/0670 endwalk ()` would put him down at
 *      `sal.trotter2` (824,112); `D2A_007` has him at (638,357), a third of the
 *      way there and invisible, which is `SALLOWER.SET/0001 closeset ()`'s
 *      `if actorset ("trotter") = "sallower" → putdownactor ()` catching him
 *      mid-stride. The route does not wait for him either.
 *   4. **`rubyphase 0 → 1` is a knock on a door upstairs.** Two things write it
 *      on day 2, and only one of them is available here: `SALUPPER.SET/0034
 *      openscene ()` sets it from the gossip you overhear at `clock = 3`, which
 *      is the evening, and `RUBY.PUP/0034 twopm ()` sets it from the
 *      conversation — reached only through that same file's `pointinruby`
 *      (138,2-327,263, north, cell (0,0)). Up is `SALLOWER.SET/0057`
 *      — cell (3,5) facing west, `salup.mov` — and with `trotterphase` already
 *      past 2 the knock falls through to `runpuppet ("ruby.pup")`.
 *   5. `RUBY.PUP/0034 twopm ()` is six plaque sets deep and every set has the
 *      same shape: one flattering reply (999) that goes on, and the rest — all
 *      numbered **102** — that go to `pity ()`, which is `rubyphase = 1` and the
 *      end of it. `LEAVING` prefers 102, so the driver takes the short way, and
 *      the save cannot say which the original took: the long way ends on 103,
 *      and that sets `rubyphase = 1` too.
 *   6. Out through `SALLOWER.SET/0052` (cell (3,0) facing east, `pointinrice`,
 *      door owner "salout"), which is `gototown ("east")` — and `gototown` goes
 *      back to `townscene`, still "Scene G8", the saloon's own cell.
 *   7. **The chime is a walk, not a switch.** `loopsound` is written only by
 *      `TOWN.SET/0137 dayfxs ()`, the scene loop on "scene g14": it picks
 *      whichever of four noises is nearest and under two cells away, and at cell
 *      (6,11) — the Curiosity Shop's door — that is `"chinchime"`. Standing at
 *      the door is what sets it; carrying it into `chin.set` is just nothing
 *      overwriting it.
 *   8. In through `TOWN.SET/0135` (cell (6,11) facing east, `pointinchin`,
 *      218,100-278,204). `lockchin ()` shuts on day 2 afternoon at `phase > 0`
 *      and `D2A_006` has `phase = 0`, so it opens; `gotointerior ("chin.set")`
 *      writes **`townscene = "Scene G12"`**, which is the whole reason the rung
 *      records that global at all.
 *   9. `CHIN.SET/0001 openset ()` calls `setupactor ("shop")` on Chin, and
 *      `GANG.CST/0111` seats him at `chin.help3` or `chin.help4` by a coin toss.
 *      Both are within the 512 `hotdist ()` allows here of cell (1,1), the
 *      standpoint `D2A_007` was saved at, so the route stands where the save
 *      stands and clicks from there. `stdactor` inside `setupactor` is also what
 *      writes **`theset = "chin"`** (`GANG.CST/0001`).
 *  10. `HELP2.PUP/0032 twopm ()` opens on one plaque, "What's for sale?" (201),
 *      and then branches on stock: `propowner ("history") = "none"` sends it to
 *      `booktwopm ()`, and **"Yes." (101)** buys — `addinven ("history")`,
 *      `playercash = playercash -35`, `helpphase = 1`. `addinven` is also where
 *      **`handitem` becomes "history"**: not a thing picked up, a thing handed
 *      over. "Thanks." (101) closes `byetwo (2)`.
 *
 * **`bouncer` is claimed as GONE, which is what the save says.** `D2A_006` has
 * it at 1 and `D2A_007` does not have it at all: it is Isao's idle bookkeeping
 * (`GANG.CST/0984 isaoidle ()` flips it every other pose), and his
 * `putdownactor ()` opens with `dumpglobal bouncer, dirgo`. Leaving the saloon
 * runs `closeset ()`, which puts him down, which erases it. Nothing about the
 * route aims at that; it falls out of walking through the door.
 *
 * **`FXCOUNT` 124 → 130 is claimed, and it is a fade rather than a counter.**
 * `CHIN.SET/0001 openset ()` zeroes it and starts `SOUNDFXS ()`, which adds 2 a
 * pass, sets `themevol ("helptheme", FXCOUNT)` and re-arms itself until
 * `FXCOUNT > 128` — so it climbs to exactly **130** and stops there, whatever
 * frame the save was taken on. 130 says the shop's theme had finished fading up,
 * which is another way of saying the original had been standing in the shop for
 * more than two seconds.
 *
 * **What is not claimed.** `idlecount` 3 → 1 is the puppet's own idle-slot
 * bookkeeping and `tumx2`/`tumy2` are where the tumbleweed happened to be
 * (`kickme`, a town prop loop); all three depend on the frame the save was taken
 * on rather than on anything a route can do, and this run ends with `idlecount`
 * at 3. `dirgo`, Isao's other dumped global, is absent from BOTH saves and so
 * says nothing either way.
 *
 * **One thing the original did that this does not.** `D2A_007`'s open-file table
 * carries `dust:inven:hist.flt` — the book, opened and read. That is the panel's
 * `info` button (`new.flt` avatar, 155,320-256,345) running
 * `INVEN.PRP/0149 infoyoself ()`, which closes the stage file and opens
 * `hist.flt` at flat 1. It moves no global and the harness checks no file table,
 * so it is left out; it is recorded here because it is the only evidence on the
 * disc that whoever played this actually read what they bought.
 *
 * **A deviation, and it is the harness's rather than the engine's.**
 * `GANG.CST/0670 mousedown` opens with `currentscene ("scene c3")` and
 * `currentview ("west")` — the game walks you round to face Trotter before he
 * speaks. `clickActor` runs the handler directly instead of through the
 * director, and `currentscene (name)` as a SETTER only does anything while a
 * gesture has the nav hooks armed (`SetViewer.armNavHooks`), so the camera stays
 * on Scene C4. The conversation is identical either way and the rung ends in a
 * different room, so nothing here rides on it.
 */
export const rung: Segment = {
  from: "D2A_006",
  to: "D2A_007",
  what: "the sugarcubes for Trotter, the town History from Chin",
  claims: [
    "trotterphase", "rubyphase", "helpphase", "playercash", "handitem",
    "townscene", "theset", "loopsound", "bouncer", "FXCOUNT",
  ],
  async play(p) {
    const sal = set("SALLOWER");
    const up = set("SALUPPER");
    const town = set("TOWN");
    const chin = set("CHIN");
    const num = (n: string): number => Number(p.session.interp.globals.get(n) ?? 0);
    const owner = (n: string): string => ask(p, "propowner", [n]).toLowerCase();

    // ---- 1. Trotter, drunk at the bar, one cell from where the save stands ---
    await walkTo(p, sal, { x: 2, z: 3, view: "west" });
    await clickActor(p, "trotter", "Trotter at the bar");
    await p.pump(() => (p.session.puppet?.bevels ?? []).length > 0, "Trotter to say something");
    await offerInTalk(p, "sugarcubes", "the sugarcubes for Trotter");
    if (owner("sugarcubes") !== "trotter") {
      throw new Error(`he did not take them \u2014 the sugarcubes are ${owner("sugarcubes")}s`);
    }
    await talkOut(p, LEAVING, "Trotter", 2);
    if (num("trotterphase") !== 5) throw new Error(`trotterphase ${num("trotterphase")}, not 5`);

    // ---- 2. upstairs, and a knock on Ruby's door ----------------------------
    await walkTo(p, sal, { x: 3, z: 5, view: "west" });
    await p.press("uparrow", "up the saloon stairs");
    await p.pump(() => room(p).startsWith("salupper"), "the saloon landing");
    await walkTo(p, up, { x: 0, z: 0, view: "north" });
    // SALUPPER/0034 `pointinruby`, 138,2-327,263 — the knock IS the conversation
    p.fire((138 + 327) / 2, (2 + 263) / 2);
    await p.settle("the knock on Ruby's door");
    await talkOut(p, LEAVING, "Ruby through the door", 2);
    if (num("rubyphase") !== 1) throw new Error(`rubyphase ${num("rubyphase")}, not 1`);

    // ---- 3. down, and out into the street -----------------------------------
    await walkTo(p, up, { x: 0, z: 3, view: "east" });
    await p.press("uparrow", "down the saloon stairs");
    await p.pump(() => room(p).startsWith("sallower"), "the bar again");
    await openDoor(p, [144, 7, 387, 264], "salout", "the saloon door", {
      set: sal, x: 3, z: 0, view: "east",
    });
    await p.pump(() => room(p).startsWith("town"), "the street");

    // ---- 4. down the street to the Curiosity Shop ---------------------------
    await walkTo(p, town, { x: 6, z: 11, view: "east" });
    // standing here is what makes `loopsound` the chime — TOWN/0137 dayfxs ()
    await p.pump(
      () => String(p.session.interp.globals.get("loopsound") ?? "") === "chinchime",
      "the shop's wind-chime to be the nearest noise",
    );
    await openDoor(p, [218, 100, 278, 204], "chin", "the Curiosity Shop door", {
      set: town, x: 6, z: 11, view: "east",
    });
    await p.pump(() => room(p).startsWith("chin"), "the Curiosity Shop");

    // ---- 5. thirty-five dollars for the town History ------------------------
    await walkTo(p, chin, { x: 1, z: 1, view: "east" });
    await clickActor(p, "help", "Chin behind his counter");
    await answer(p, 201, "What's for sale?");
    await answer(p, 101, "Yes.");
    await answer(p, 101, "Thanks.");
    await talkOut(p, LEAVING, "Chin", 2);
    if (owner("history") !== "stranger") throw new Error(`the History is ${owner("history")}'s`);
    if (num("playercash") !== 765) throw new Error(`$${num("playercash")}, not $765`);

    // and back to the standpoint the save was taken from
    await walkTo(p, chin, { x: 1, z: 1, view: "east" });
  },
};
