import {
  ask,
  clickThrough,
  LEAVING,
  converse,
  offerInTalk,
  talkOut,
  hold,
  openDoor,
  room,
  set,
  takeInHand,
  walkTo,
  type Segment,
} from "../route";

/**
 * Day 2, afternoon: the flowers off the grave, and the gun on Ruby's wall.
 *
 * The save names its own script. `Flowers` goes from no owner at all to
 * **`limbo2`**, and `giveinven ("flowers", "limbo2")` appears exactly once in
 * the corpus — `RUBY.PUP/0007 gift ()`, in the `clock = 2` arm — three lines
 * above which is `rubyphase = 2`. So `rubyphase 1 → 2` and the flowers are one
 * act, and `rubygunstory 0 → 1` is what that act unlocks.
 *
 *   1. **Out of the laundry.** `CHIN.SET/0035` owns cell (0,1) and its west view:
 *      `pointinrice` 100,2-408,263 sets the door prop to "rice", and the
 *      `uparrow` behind it is `gototown (currentview ())`. `gototown` returns to
 *      whatever `townscene` says, and `NEW.FLT/0001 gotointerior ()` wrote that
 *      as "Scene G12" on the way IN — so the street is re-entered at the
 *      Curiosity Shop's own cell, facing west.
 *   2. **The flowers are the key to the conversation, not just the gift.**
 *      `RUBY.PUP/0034 runyoself ()` opens with
 *
 *          if propowner ("flowers") = "stranger" & rubyphase = 1
 *              rubyphase = 0
 *          endif
 *          if rubyphase = 1
 *              sendtopuppet ("day1", brushoff ())
 *              exitcode
 *          endif
 *
 *      and `D2A_007` stands at `rubyphase = 1`. Knocking empty-handed gets a
 *      brush-off with no plaques at all — no `addhandbevel ()`, no way to 2.
 *      Carrying the flowers is what re-opens `twopm ()`.
 *   3. **Where they are.** `INVEN.PRP/0001 initprops ()` does
 *      `sendtoprop ("flowers", setupprop ("grave"))` for every day 2, and
 *      `INVEN.PRP/0157 setupprop ()` plants them in the town at star
 *      `town.flower` (608,918) with `propview "small"`. The small branch of
 *      `stdmouse ()` is `if realdist (what) < hotdist () → addinven (what)`, and
 *      INVEN's own `hotdist ()` — not `GANG.CST`'s — is **512** in the town.
 *      The graveyard itself is not walkable: no sequence of authored moves
 *      reaches cell (2,3), (1,3), (2,2) or (1,2) at any facing. The nearest one
 *      the street does reach is **Scene C5**, cell (2,4), where `town.cem2`
 *      stands — centre (640,1152), 236 units from the flowers, comfortably
 *      inside 512. That is the standpoint a player has to use, so it is this
 *      one.
 *   4. **The saloon.** `TOWN.SET/0131` cell (6,7) west, `pointinsaloon`
 *      241,92-307,201, door owner "saloon", then `gotointerior ("sallower.set")`
 *      — which is also what writes **`townscene = "Scene G8"`**, since
 *      `gotointerior` stores `currentscene ()` whenever it is called from the
 *      town. `locksaloon ()` only shuts at `clock = 1`, day 5, day 1 late, or a
 *      running fight; none of those hold.
 *   5. **`loopsound` is a walk, not a switch.** `TOWN.SET/0137 dayfxs ()`, the
 *      scene loop on "scene g14", picks whichever of four noises is nearest and
 *      under two cells away and stores its name; at Scene G8 that is
 *      **`"outsidesaloon"`**. Nothing outside the town writes `loopsound`, so
 *      standing at the saloon door is the whole of it and the value is simply
 *      carried inside.
 *   6. **Up.** `SALLOWER.SET/0057` cell (3,5) west — an `uparrow` with no door
 *      guard at all, `salup.mov`, then `gotointerior ("salupper.set")`. Walking
 *      the saloon floor is also what writes **`theset = "sallower"`**:
 *      `SALLOWER.SET/0001 openset ()` seats Gus, Oona and Isao at `clock > 1`,
 *      and `GANG.CST/0001 stdactor ()` sets `theset = actorset (who)` for each.
 *      Neither `salupper` nor `salroom` sets an actor up on this afternoon, so
 *      the last write stands to the end of the rung.
 *   7. **Ruby's door.** `SALUPPER.SET/0034` cell (0,0) north, `pointinruby`
 *      138,2-327,263. `lockruby ()` shuts it at `day = 2 & clock = 3`; this is
 *      clock 2, so it opens. Both of the earlier branches inside the mousedown
 *      are refused — `day = 2 & rubyphase = 2` is not true yet, and
 *      `day = 2 & clock = 2 & trotterphase < 2` fails because `D2A_007` already
 *      carries `trotterphase = 5` from the sugarcubes the rung before. What is
 *      left is `runpuppet ("ruby.pup")`.
 *   8. **Answer 999, never 102.** `twopm ()` is four plaque sets and every set
 *      has the same shape: one reply that goes on (**999**) and the rest all
 *      numbered **102**, which is `pity ()` — two lines and `rubyphase = 1`, the
 *      end of the afternoon. `LEAVING` prefers 102, so this rung cannot use it;
 *      `converse` answering 999 by id is what walks the chain down to the
 *      while-true loop that carries `addhandbevel ()`.
 *   9. **The gift takes two presses**, and the second one is the gift.
 *      `prepuppet ()` leaves `handflag = 1` on every puppet it opens, so the
 *      plaque reads "Would you like something...?" and `INVEN.PRP/0001
 *      selhandbevel ()` takes the branch that opens the picker instead of
 *      calling `gift ()`. Picking the flowers out of the panel clears the flag
 *      and renames the plaque; pressing it again is `gift (handitem)`.
 *      `route.ts`'s `offerInTalk` is that, and this rung is one of the two that
 *      taught it its third case: Ruby's `gift ()` speaks three lines, sets
 *      `rubyphase = 2`, and `twopm ()` sees the 2 and exits — so the gift ENDS
 *      the conversation, and a wait for "the panel opened, or the question
 *      changed" waits for something that never comes.
 *  10. **Through the door.** After the puppet returns, `SALUPPER.SET/0034`'s
 *      mousedown hits `if day = 2 & (clock = 1 | clock = 2) & rubyphase = 2 →
 *      exitcode`, which is BEFORE its `sendtoprop ("door", initprop ())` — so
 *      the door is deliberately left standing open. Its keydown then writes
 *      **`savescene = currentscene ()` = "Scene A1"** and `savedir = "south"`,
 *      which is the pair the room on the other side reads.
 *  11. **The gun.** `SALROOM.SET/0036`'s `pointingun` is guarded on
 *      `day = 2 & rubyphase = 2 & savescene = "scene a1" & currentview () =
 *      "south"` — all four of which this rung has just arranged. `gotointerior`
 *      passes no view, so the room opens facing **west** and has to be turned;
 *      south is also the facing `D2ARUBY` was taken at. `clock = 1` would give
 *      `nogun.mov`, and so would a gun already owned; here `propowner ("gun")`
 *      is "none", so `salgun.mov` plays and `if actionframe (1)` decides whether
 *      `addinven ("gun")` and `rubygunstory = 1` happen.
 *  12. **Where the film is clicked matters.** `salgun.mov` is 51 frames with an
 *      action frame at 17 and it stops twice. Frame 1 offers 66,0-431,264 (go
 *      on) and the whole screen (→ 49, which is the exit); frame 15 offers
 *      132,142-310,238 — that is the gun, and it jumps to 17 — plus
 *      288,102-407,180 (→ 15, stay put) and the whole screen again (→ 33, walk
 *      away without it). The centre of `pointingun`, 292,219, is inside the
 *      going-on box on both frames and outside the other two, so one point
 *      serves as the gesture and as the clicks.
 *
 * **`dirgo 1 → 0` is not claimed.** It is Isao's idle phase: `GANG.CST/0984
 * isaoidle ()` swings `actordeg` twenty degrees each way and flips `dirgo` at
 * the turn, so its value is a count of service passes spent on the saloon floor
 * rather than anything the rung did. It is also destroyed on the way upstairs —
 * `putdownactor ()` begins `dumpglobal bouncer, dirgo`, and
 * `SALLOWER.SET/0001 closeset ()` puts Isao down — so this run ends with no
 * `dirgo` at all, where `D2ARUBY` records 0. (The shipped saves are odd about
 * that pair: 29 of the 56 carry `dirgo`, only 6 carry `bouncer`, and no save
 * carries `bouncer` without `dirgo`. Reported, not chased.)
 *
 * `savedir` is not claimed either: it reads "south" at both ends, so the rung
 * cannot tell whether the write happened.
 */
export const rung: Segment = {
  from: "D2A_007",
  to: "D2ARUBY",
  what: "the flowers from the cemetery, and the gun in Ruby's room",
  claims: ["rubyphase", "rubygunstory", "handitem", "savescene", "townscene", "theset", "loopsound"],
  async play(p) {
    const CHIN = set("CHIN");
    const TOWN = set("TOWN");
    const SALLOWER = set("SALLOWER");
    const SALUPPER = set("SALUPPER");

    // 1. out of the laundry — CHIN.SET/0035, cell (0,1) west
    await walkTo(p, CHIN, { x: 0, z: 1, view: "west" });
    await openDoor(p, [100, 2, 408, 263], "rice", "the laundry's street door", {
      set: CHIN,
      x: 0,
      z: 1,
      view: "west",
    });
    await p.pump(() => room(p) === "town", "the street outside the laundry");

    // 2. the flowers, from the nearest cell the street reaches (see 3. above)
    await walkTo(p, TOWN, { x: 2, z: 4, view: "north" });
    await takeInHand(p, "Flowers", "the flowers off the grave");

    // 3. the saloon — TOWN.SET/0131, cell (6,7) west
    await walkTo(p, TOWN, { x: 6, z: 7, view: "west" });
    await openDoor(p, [241, 92, 307, 201], "saloon", "the saloon door", {
      set: TOWN,
      x: 6,
      z: 7,
      view: "west",
    });
    await p.pump(() => room(p) === "sallower", "the saloon floor");

    // 4. up — SALLOWER.SET/0057, cell (3,5) west, an ungated uparrow
    await walkTo(p, SALLOWER, { x: 3, z: 5, view: "west" });
    await p.press("uparrow", "up the saloon stairs");
    await p.pump(() => room(p) === "salupper", "the landing");

    // 5. knock — SALUPPER.SET/0034, cell (0,0) north, `pointinruby`
    await walkTo(p, SALUPPER, { x: 0, z: 0, view: "north" });
    p.fire((138 + 327) / 2, (2 + 263) / 2);
    await converse(
      p,
      null,
      999,
      () => (p.session.puppet?.bevels ?? []).some((b) => b.id === 55555),
      "Ruby's afternoon",
    );

    // 6. the flowers, through the 55555 plaque and the picker behind it
    await offerInTalk(p, "flowers", "the flowers for Ruby");
    await talkOut(p, LEAVING, "Ruby", 2);
    await p.pump(() => !p.session.puppet, "Ruby to stand aside");
    if (ask(p, "propowner", ["flowers"]).toLowerCase() !== "limbo2") {
      throw new Error(`the flowers did not reach Ruby — propowner is "${ask(p, "propowner", ["flowers"])}"`);
    }

    // 7. in — the door prop is left owned by "ruby" precisely because rubyphase is 2
    if (ask(p, "propowner", ["door"]).toLowerCase() !== "ruby") {
      throw new Error(`Ruby's door did not stay open — propowner is "${ask(p, "propowner", ["door"])}"`);
    }
    await p.press("uparrow", "into Ruby's room");
    await p.pump(() => room(p) === "salroom", "Ruby's room");

    // 8. the gun — SALROOM.SET/0036, cell (1,0), turned SOUTH for the guard
    await walkTo(p, set("SALROOM"), { x: 1, z: 0, view: "south" });
    await clickThrough(
      p,
      () => p.fire((199 + 385) / 2, (175 + 264) / 2),
      () => Number(p.session.interp.globals.get("rubygunstory") ?? 0) === 1,
      "the gun on Ruby's wall",
      { x: (199 + 385) / 2, y: (175 + 264) / 2 }, // inside salgun.mov's going-on box too
    );
    if (ask(p, "propowner", ["gun"]).toLowerCase() !== "stranger") {
      throw new Error(`the gun was not taken — propowner is "${ask(p, "propowner", ["gun"])}"`);
    }
  },
};
