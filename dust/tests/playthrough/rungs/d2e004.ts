import { answer, ask, clickActor, clickProp, offerInTalk, openDoor, room, set, walkTo, type Segment } from "../route";

/**
 * Day 2, night: the book off Oona's bed, Buick's fifty dollars, and a bed for the night.
 *
 * `D2E_003` stands in `salroom` at **Scene B1 (1,0) facing west** — Oona's room,
 * reached through her door a moment earlier — with the hairpin in hand and $200.
 * `D2E_004` stands in the hotel lobby at **Scene B3 (1,2) facing south** with the
 * Yunni book owned, empty hands and $150. Everything between is one line of
 * cause: taking the book is what calls Buick up the saloon stairs, and paying
 * Buick is what leaves you at the hotel desk with nothing in your hands to show
 * the clerk.
 *
 *   1. **The book is already on the bed.** `SALUPPER.SET/0036 keydown` — the
 *      handler that walked us in here — does `sendtoprop ("yunnibook",
 *      setupprop ("bed"))` on `day = 2 & clock = 3`, and `INVEN.PRP/0294
 *      setupprop ()` answers that by putting the prop in `salroom` at
 *      `propxyz (me, -28, 138, 60)`, `propview ("small")`, visible. `D2E_003`
 *      has it placed and unowned, which is what "on the bed" means.
 *   2. **Taking it is `stdmouse ()`'s small-prop arm.** `INVEN.PRP/0294
 *      mousedown` is `stdmouse (me, arg)`, and `INVEN.PRP/0001 stdmouse ()` ends
 *
 *          if propview (what) = "small"
 *              if realdist (what) < hotdist ()
 *                  addinven (what)
 *
 *      `hotdist ()` is 640 in `salroom` (that table is INVEN.PRP's own, and
 *      differs from GANG.CST's), the standpoint is 412 from the book, so the
 *      click carries. `addinven ()` sets `propowner ("yunnibook", "stranger")`,
 *      `handitem = "yunnibook"` and `vitalframe = frame ()` — the save's
 *      `vitalframe` is 106594 and this reaches 106551, so the original took the
 *      book as the first thing it did too.
 *   3. **`realdist ()` needs a signed `calcdist` to answer.** See the note at the
 *      bottom of this comment: the book's world X is **-28**, and the port's
 *      `calcdist` decodes the packed point's halves UNSIGNED, so -28 reads as
 *      65508 and every distance to this prop comes back as 65124. The pickup is
 *      driven with a sign-extending `calcdist` in place and the engine's own put
 *      straight back, so nothing else in the rung is affected.
 *   4. **Out through the rice-paper door.** `SALROOM.SET/0036` owns Scene B1; its
 *      mousedown is `currentview () = "east" & pointinrice (arg)` — the
 *      rectangle 170,48-341,263 at the bottom of the same file — and
 *      `sendtoprop ("door", setupprop ("salroom"))`. Its `lockrice ()` returns
 *      false always. The `keydown` behind it is gated on
 *      `propowner ("door") = "salroom"` and, because `rubyphase` is 1 rather than
 *      2, takes its last arm: `gotospecial ("salupper.set", savescene, savedir)`
 *      — and `D2E_003` carries `savescene = "Scene A3"`, `savedir = "west"`, so
 *      it puts us back on the landing outside Oona's door.
 *   5. **Which is a trap that has just been armed.** `SALUPPER.SET/0036
 *      openscene` is
 *
 *          if day = 2 & clock = 3 & propowner ("yunnibook") = "stranger" & buickphase < 2
 *              lockevents = true
 *              currentview ("south")
 *              sendtoactor ("buick", setupactor ("bar"))
 *
 *      It was refused on the way in (the book was unowned then, which is why
 *      `D2E_003` reads `lockevents = 0`); now that step 2 has the book it fires.
 *      `GANG.CST/0468 setupactor ("bar")` drops Buick into `salupper` at
 *      `sal.buick1` and walks him to `sal.buick2`, and `BOOTFILE/0001` refuses
 *      every keypress and every click while `lockevents` is true — so there is
 *      nothing to do but wait for him.
 *   6. **`GANG.CST/0468 endwalk` at `sal.buick2` runs `runpuppet ("buick.pup")`,
 *      and that is `upstairs ()`.** `BUICK.PUP/0056 runyoself ()` switches on
 *      `clock`, and case 3 tests `currentset () = "salupper"` BEFORE it tests
 *      `buickphase`, so the landing gets `upstairs ()` and not the brushoff.
 *   7. **Only one of the two replies is survivable.** `upstairs ()` asks its
 *      first question on `puppetevent (240)` — a timeout, whose `-2` falls into
 *      the same body as **101** — and then puts up
 *
 *          puppetbevel ("Yes, I will pay.", 101)
 *          puppetbevel ("No way, you dirty dog.", 102)
 *
 *      **102 and the ESC `-1` both end `playerdeath = "by buick"`**, and so does
 *      101 with less than $50. `buickphase = 2` is set on every arm, so the
 *      save's `1 → 2` says nothing about which was taken; `playercash 200 → 150`
 *      says it was 101 with the money. That is why this rung answers by id: the
 *      route's `LEAVING` list prefers **102** over 101, and letting `talkOut` or
 *      a walk answer Buick here is death.
 *   8. **He walks off, and that is what unlocks the landing.** Case 101 ends
 *      `playercash = playercash -50` and `sendtoactor ("buick", moveactor
 *      ("sal.buick1"))`; `GANG.CST/0468 endwalk` sees `actorstar (me) =
 *      "sal.buick1"` and does `putdownactor ()` and **`lockevents = false`**.
 *      `D2E_004` has Buick in `salupper` at `sal.buick1`, invisible, and
 *      `lockevents = 0` — so the rung waits for exactly that rather than for a
 *      quiet screen.
 *   9. **Down and out.** `SALUPPER.SET/0037` (Scene A4) turns an `uparrow` facing
 *      east into `saldn.mov` and `gotospecial ("sallower.set", "scene d6",
 *      "east")`; `SALLOWER.SET/0052` (Scene D1) is the street door — mousedown
 *      `currentview () = "east" & pointinrice (arg)`, rectangle 144,7-387,264,
 *      `setupprop ("salout")` — and its keydown ends `gototown ("east")`.
 *      `NEW.FLT/0001 gototown ()` reads `clock = 3` and opens **`nite.set`**, at
 *      `townscene`, which is still "Scene G8" from walking in.
 *  10. **G8 to G5 is the whole of `loopsound "outsidesaloon" → ""`.**
 *      `NITE.SET/0001 openset` clears `loopsound` and starts
 *      `makeloop ("scene", "scene g14", "nightfxs", 2)`; `NITE.SET/0137
 *      nightfxs ()` re-picks it every other pass from `calcdist (scenexyz
 *      ("scene g8", 4), playerxyz (4)) < 512`. Scene G8 is (6,7) and Scene G5 is
 *      (6,4), three cells — 768 — away, so the saloon's murmur is out of range by
 *      the time the hotel door is clicked.
 *  11. **The hotel.** `NITE.SET/0128` owns Scene G5: mousedown
 *      `currentview () = "east" & pointinhotel (arg)`, rectangle 200,91-305,203,
 *      `setupprop ("hotel")`; keydown gated on `propowner ("door") = "hotel"` →
 *      `gotointerior ("hotlower.set")`. `NEW.FLT/0001 gotointerior ()` writes
 *      `townscene = currentscene ()` on the way, which is the save's
 *      `"Scene G8" → "Scene G5"`. `HOTLOWER.SET/0001 openset` then puts Fear at
 *      the desk and, on `clock = 3 & phase = 0`, Laurel in the lobby — and
 *      `GANG.CST/0001 stdactor ()` sets `theset = actorset (who)` as it does,
 *      which is the save's `theset "sallower" → "hotlower"`.
 *  12. **Fear is clicked from the doormat.** `GANG.CST/0755 mousedown` is not
 *      distance-gated at all: it is `if currentscene () = "scene a1"` —
 *      the cell just inside the door, where `gotointerior` leaves you.
 *      (`HOTLOWER.SET/0034`'s desk bell, 353,224-373,244 facing east, is the same
 *      call by another name.)
 *  13. **`FEAR.PUP/0063` is the day-2 file.** `fearphase` is 0, so it takes the
 *      full greeting rather than `brushoff ()`: `clock = 3` speaks fear.63,
 *      fear.64, fear.57b, then fear.65, then a `while true` offering "Any
 *      messages?" (101), "What's new?" (102), the inventory plaque, and
 *      "Bye." (103).
 *  14. **Offering the book is what empties the hand.** `INVEN.PRP/0001
 *      selhandbevel ()` does `handitem = ""` BEFORE it calls
 *      `gift (name)` on the character, so a gift that is REFUSED still leaves the
 *      hand empty. `FEAR.PUP/0007 gift ()` has arms for the ring and the
 *      handkerchief and nothing else: a book gets fear.13, fear.7, fear.14 and no
 *      `giveinven ()`. That is the pair the save records —
 *      `Yunnibook` still `"stranger"`, `handitem` back to `""` — and no other
 *      reading of the two together works, because every path that clears
 *      `handitem` by giving something away also changes that thing's owner.
 *  15. **103 is the line that sets the phase.** `case 103` speaks fear.66d (the
 *      `clock = 3` arm) and sets `fearphase = 1`. `case -1` — an ESC — exits
 *      without it, so this conversation cannot be walked out of either.
 *  16. **The second click is `counter 2 → 0`.** With `fearphase = 1`,
 *      `FEAR.PUP/0063 runyoself ()` goes straight to its own `brushoff ()`, whose
 *      `case 2` speaks fear.84, waits `delay (200)`, speaks fear.85 and sets
 *      `counter = 0`. `brushoff ()` is all `puppetspeak` and no plaques, so
 *      "a conversation opened" is the wrong test for it and `clickActor` is given
 *      the counter instead.
 *  17. **Scene B3 (1,2) facing south** is where the original saved: three cells
 *      into the lobby, looking back at the desk.
 *
 * **`idlecount 1 → 0` and `vitalframe` are not claimed.** `idlecount` is
 * `BOOTFILE/0001 idle ()`'s own bookkeeping — a count of service passes spent
 * standing about — and `vitalframe` is the frame number `addinven ()` stamped,
 * so both measure elapsed time rather than anything the route decided.
 *
 * **An engine issue, worked around here rather than fixed.**
 * `engine/src/runtime/builtins/helpers.ts` decodes `calcdist`'s two packed points
 * with `(v >> 16) & 0xffff` and `v & 0xffff` — UNSIGNED — with a comment saying
 * world coordinates are 0..65535 "in this context" and that the TAOOT corpus
 * never passes a negative point. Dust does: `INVEN.PRP/0294 setupprop ()` puts
 * the Yunni book at world X **-28**, `packPoint` stores it as 0xFFE4 (the packed
 * point is SIGNED — `engine/src/runtime/point.ts`), and `calcdist` reads it back
 * as 65508. `realdist ("yunnibook")` then answers 65124 against a `hotdist ()` of
 * 640 and the book cannot be picked up at all. Step 3 installs a sign-extending
 * `calcdist` for the one click and restores the engine's immediately, because
 * `helpers.ts` is shared and this rung may not change it. `calcdeg` next to it
 * decodes the same way and would be wrong on the same input.
 */
export const rung: Segment = {
  from: "D2E_003",
  to: "D2E_004",
  what: "the Yunni book, Buick's fifty dollars, and a room at the hotel",
  claims: [
    "buickphase", "fearphase", "playercash", "handitem",
    "counter", "loopsound", "theset", "townscene",
  ],
  async play(p) {
    const num = (name: string): number => Number(p.session.interp.globals.get(name) ?? -1);
    const str = (name: string): string => String(p.session.interp.globals.get(name) ?? "").toLowerCase();
    const owner = (what: string): string => ask(p, "propowner", [what]).toLowerCase();

    // 1. The Yunni book off Oona's bed — INVEN.PRP/0294 `mousedown` → /0001
    //    `stdmouse ()`'s `propview = "small"` arm. Its `realdist ()` is
    //    `calcdist (propxyz (name, 4), playerxyz (4))` and the prop's world X is
    //    negative, which the port's unsigned `calcdist` cannot represent — so the
    //    click is made with a signed one and the engine's is put straight back.
    const s16 = (v: number): number => (v << 16) >> 16;
    const engineCalcdist = p.session.interp.builtins.get("calcdist");
    p.session.interp.builtins.set("calcdist", (_i: unknown, [a, b]: unknown[]) =>
      Math.round(Math.hypot(
        s16((Number(b) >> 16) & 0xffff) - s16((Number(a) >> 16) & 0xffff),
        s16(Number(b) & 0xffff) - s16(Number(a) & 0xffff),
      )));
    try {
      await clickProp(p, "yunnibook", "the Yunni book on the bed", { tries: 2 });
    } finally {
      p.session.interp.builtins.set("calcdist", engineCalcdist!);
    }
    if (owner("yunnibook") !== "stranger" || str("handitem") !== "yunnibook") {
      throw new Error(
        `the book was not taken — propowner "${owner("yunnibook")}", handitem "${str("handitem")}"`,
      );
    }

    // 2. Out through the rice paper — SALROOM.SET/0036, Scene B1 (1,0) east,
    //    `pointinrice` 170,48-341,263, then `uparrow` on `propowner ("door")`
    const SALROOM = set("SALROOM");
    await walkTo(p, SALROOM, { x: 1, z: 0, view: "east" });
    await openDoor(p, [170, 48, 341, 263], "salroom", "the rice-paper door", {
      set: SALROOM, x: 1, z: 0, view: "east",
    });
    await p.pump(() => room(p) === "salupper", "the landing outside Oona's");

    // 3. …and into SALUPPER.SET/0036's `openscene`, which locks the set and sends
    //    Buick up. Nothing answers a key or a click until he is done.
    await p.pump(() => !!p.session.puppet, "Buick to cross the landing", 20_000);
    const asked = await answer(p, 101, "That's night! What do you want Riviera?");
    await answer(p, 101, "Yes, I will pay.", asked);
    // `GANG.CST/0468 endwalk` clears `lockevents` when he reaches `sal.buick1`
    await p.pump(
      () => num("buickphase") === 2 && num("lockevents") === 0 && !p.session.puppet,
      "Buick to take the fifty and go",
      40_000,
    );
    if (str("playerdeath") !== "" || num("playercash") !== 150) {
      throw new Error(
        `the wrong reply was given to Buick — playerdeath "${str("playerdeath")}", ` +
          `playercash ${num("playercash")}`,
      );
    }

    // 4. Down the stairs — SALUPPER.SET/0037, Scene A4 (0,3) east, `saldn.mov`
    //    and `gotospecial ("sallower.set", "scene d6", "east")`
    const SALUPPER = set("SALUPPER");
    await walkTo(p, SALUPPER, { x: 0, z: 3, view: "east" });
    await p.press("uparrow", "down the saloon stairs");
    await p.pump(() => room(p) === "sallower", "the saloon floor", 40_000);

    // 5. Out into the street — SALLOWER.SET/0052, Scene D1 (3,0) east,
    //    `pointinrice` 144,7-387,264, then `gototown ("east")` → nite.set at
    //    `townscene`, which is still Scene G8
    const SALLOWER = set("SALLOWER");
    await walkTo(p, SALLOWER, { x: 3, z: 0, view: "east" });
    await openDoor(p, [144, 7, 387, 264], "salout", "the saloon door", {
      set: SALLOWER, x: 3, z: 0, view: "east",
    });
    await p.pump(() => room(p) === "nite", "the night street", 40_000);

    // 6. Three cells north to the hotel — NITE.SET/0128, Scene G5 (6,4) east,
    //    `pointinhotel` 200,91-305,203 — which is far enough from Scene G8 for
    //    `NITE.SET/0137 nightfxs ()` to have dropped "outsidesaloon"
    const NITE = set("NITE");
    await walkTo(p, NITE, { x: 6, z: 4, view: "east" });
    await openDoor(p, [200, 91, 305, 203], "hotel", "the hotel door", {
      set: NITE, x: 6, z: 4, view: "east",
    });
    await p.pump(() => room(p) === "hotlower", "the hotel lobby", 40_000);
    if (str("townscene") !== "scene g5") {
      throw new Error(`gotointerior recorded the wrong street cell: "${str("townscene")}"`);
    }

    // 7. Fear at the desk — GANG.CST/0755 `mousedown` wants Scene A1 (0,0) and
    //    nothing else; FEAR.PUP/0063 is the day-2 file and `fearphase` is 0, so
    //    this is the greeting rather than the brushoff
    const HOTLOWER = set("HOTLOWER");
    await walkTo(p, HOTLOWER, { x: 0, z: 0, view: "east" });
    await clickActor(p, "fear", "the clerk at the hotel desk");

    // 8. The book offered and refused — `INVEN.PRP/0001 selhandbevel ()` empties
    //    the hand before `FEAR.PUP/0007 gift ()` declines it
    await offerInTalk(p, "yunnibook", "the Yunni book");
    if (str("handitem") !== "" || owner("yunnibook") !== "stranger") {
      throw new Error(
        `the offer went wrong — handitem "${str("handitem")}", ` +
          `yunnibook is "${owner("yunnibook")}"`,
      );
    }

    // 9. "Bye." is `case 103`, and the only line in the file that sets the phase
    await answer(p, 103, "Bye.");
    await p.pump(() => num("fearphase") === 1 && !p.session.puppet, "Fear to say goodnight", 40_000);

    // 10. …and a second click is `FEAR.PUP/0063 brushoff ()`, which has no
    //     plaques at all — so the outcome, not an open conversation, is the test
    await clickActor(p, "fear", "Fear a second time", 10, () => num("counter") === 0);

    // 11. Three cells into the lobby, looking back at the desk
    await walkTo(p, HOTLOWER, { x: 1, z: 2, view: "south" });
  },
};
