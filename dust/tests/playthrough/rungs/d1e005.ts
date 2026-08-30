import {
  LEAVING, answer, ask, clickActor, offerInTalk, openDoor, room, set, talkOut,
  walkTo, type Segment,
} from "../route";

/**
 * Day 1, night: the ring for Ruby, the cigar from Blood, a room from Fear.
 *
 * Ninety seconds of the original's play and the busiest rung of the five, in
 * four rooms — the saloon's upstairs landing, its bar, the night street and the
 * hotel lobby. `phase 2 → 5` is three separate steps of the main story and each
 * one is a different script writing it; the nine dollars are the room.
 *
 *   1. **`D1E_004` stands at Ruby's door already.** The save's standpoint is
 *      `salupper` cell (0,0) facing north, and `SALUPPER.SET/0034` is that
 *      cell's script: facing north, a click inside `pointinruby`
 *      (138,2-327,263) knocks and — with none of `lockruby ()`'s day-3 and
 *      day-4 gates closed on a day-1 evening — runs `runpuppet ("ruby.pup")`.
 *      The knock IS the conversation; Ruby is never an actor on this landing.
 *   2. `RUBY.PUP/0033` ("RUBY DAY ONE") is a switch on `rubyphase` where the
 *      first two cases speak and then `exitcode`: 0 speaks and sets 1, 1 speaks
 *      and sets 2. So the third knock is the first one that reaches the plaques,
 *      and the route knocks three times.
 *   3. Six plaque sets follow, and every one has the same shape: one reply
 *      numbered **999** that goes on, and two or three numbered 102 that go to
 *      `dismiss ()` — which speaks four lines, sets `rubyphase = 55` and ends
 *      it. **55 is a sentinel, not a step.** `runyoself ()` opens `if rubyphase
 *      = 55 → brushoff ()`, so 55 means "Ruby is done with you for the day",
 *      and both ways through this file reach it. The save cannot tell them
 *      apart on `rubyphase` alone — but it can on the **HHKey**, which only the
 *      long way hands over, so the route answers 999 six times.
 *   4. The seventh set is a `while true` with the inventory's own handle on it
 *      (`sendtoshop ("inven", addhandbevel ())`, reply 55555), and it is where
 *      both remaining things happen. `offerInTalk` presses that plaque and works
 *      the picker; `RUBY.PUP/0007 gift ()` answers `what = "ring"` with three
 *      lines and `giveinven ("ring", "ruby")` — which is `Ring@stranger →
 *      Ring@ruby` in the save, and also why `handitem` is empty again
 *      afterwards (`INVEN.PRP/0001 giveinven ()` clears it when it is giving
 *      away the thing in hand). Then **999, "Goodbye, Miss."** — `if propowner
 *      ("hhkey") != "stranger" → addinven ("hhkey")`, six more lines, and
 *      `rubyphase = 55`. That key is the hotel's back door, and `segments.ts`'s
 *      `segment7` opens the saloon's with it two days later.
 *   5. **Sophie is the next door along**, `salupper` cell (0,1) facing east,
 *      `SALUPPER.SET/0035 pointindoor` (133,2-376,263) — the same knock,
 *      `runpuppet ("sophie.pup")`. `SOPHIE.PUP/0033`'s while-loop offers three
 *      questions and one exit, and the exit — **104, "Goodnight Miss."** — is
 *      the only line in the file that sets `sophiephase = 1`. Its last spoken
 *      line is conditional on `propowner ("HHkey") = "Stranger"`, which is the
 *      script's own reason to visit Ruby first.
 *   6. **Leaving the saloon is what makes `phase` 3.** Down at cell (0,3)
 *      facing east (`SALUPPER.SET/0037`, `saldn.mov`) into `sallower` "scene
 *      d6", across to cell (3,0) facing east, and out through
 *      `SALLOWER.SET/0052` — `pointinrice` (144,7-387,264), door owner
 *      "salout". Its `keydown` is the whole hinge of the rung: `if day = 1 &
 *      phase < 3 & playercash > 5 → phase = 3` and, in the same breath,
 *      `setupactor ("street")` on Blood and on the Mayor's wife. Blood is not
 *      in the street until you walk out of that door.
 *   7. **`clock = 3`, so the street is `nite.set`** (`NEW.FLT/0001 gototown ()`),
 *      and `gototown` returns to `townscene`, still "Scene G8" — the saloon's
 *      own cell. Blood is put at `town.blood1` and immediately walked to
 *      `town.blood2`, and `GANG.CST/0187 endwalk ()` sends him straight back
 *      again: (9,4) Scene J5 ↔ (9,6) Scene J7, for ever. So he is clicked with
 *      `settleFirst = false` — a wait for `iswalk` to clear is a wait that
 *      cannot end — from cell (9,5), which is his own column, because
 *      `GANG.CST/0001 walktopuppet ()` opens `if thex != 0 & they != 0
 *      exitcode` over cell deltas and a click off his row and column opens
 *      nothing at all.
 *   8. `BLOOD.PUP/0062 townstreet ()` offers two replies, and **102, "Thanks
 *      for the cigar."** does five things at once: `phase = 4`, `addinven
 *      ("cigar")` — which is where `handitem` becomes "cigar", `INVEN.PRP/0001
 *      addinven ()` sets it — `townscene = "scene g5"`, `closesetfile ()` and
 *      `opensetfile ("hotlower.set")`. The walk to the hotel is the script's,
 *      not the route's.
 *   9. It then falls straight into `bloodhotel ()` in the lobby, and
 *      **`bloodgood 0 → 1` is one compliment.** `bloodgood` moves only through
 *      `statuschange (arg)`, ±1 a time, so a save reading exactly 1 records
 *      exactly one flattering reply: **101, "Do you like the Cactus Bed?"**
 *      into `thehotel ()`, then its **102** — the reply whose text is drawn
 *      from three variants but whose number never changes — then **104,
 *      "Enough about the hotel."** back out, then **103, "I'm about ready to
 *      go."**. Answering by id is what makes that legible: `puppetscramble ()`
 *      shuffles the plaques and `thehotel ()` rewrites their text every pass.
 *  10. **Fear is rung for.** `HOTLOWER.SET/0034` is the lobby's cell (0,0), and
 *      facing east a click inside `pointinbell` (353,224-373,244) sounds the
 *      bell twice and does `sendtoactor ("fear", mousedown (arg))` — the desk
 *      clerk summoned the way the set summons him, and that cell's centre is
 *      about 282 units from `hotlower.fear` against the 384 `hotdist ()` allows
 *      in `hotlower`.
 *  11. `FEAR.PUP/0062 runyoself ()` switches on `phase`, and cases 0 to 3 all
 *      fall into `phase2 ()`, which only ever sets `fearphase = 1`. **`phase =
 *      4` is what opens the register**, so this could not have been done before
 *      Blood: `phase4 ()` with `fearphase` still 0 asks "Yes." / "No.", and
 *      **101** sets `fearphase = 2` and goes to `money ()` → `takeroom ()` →
 *      **101** → `if playercash < 9 … else playercash = playercash -9` →
 *      `whenready ()` → **101** → `sendtoactor ("fear", putdownactor ())` and
 *      **`phase = 5`**. That is the whole of `781 → 772`: three nights at three
 *      dollars, and the only subtraction on the route.
 *  12. `theset` is not a place the player went — `GANG.CST/0001 stdactor (who)`
 *      writes `theset = actorset (who)` every time an actor is set up, so
 *      "sallower" → "hotlower" is Fear, Laurel and Blood being placed in the
 *      lobby by `HOTLOWER.SET/0001 openset ()` and by `townstreet ()`'s closing
 *      `setupactor ("hotel")`.
 *
 * **`loopsound` is claimed, and it is a walk rather than a switch.**
 * `NITE.SET/0001 openset ()` zeroes it on the way into the street and
 * `NITE.SET/0137 nightfxs ()` — the scene loop on "scene g14" — rewrites it
 * every other pass with whichever noise is nearest and under two cells away. At
 * night there are only two: "outsidesaloon" at Scene G8 and "chinchime" at Scene
 * G12. Blood's column is 923 units from G8 and further from G12, so standing
 * where he paces is what leaves it **""**, and nothing in `hotlower` writes it
 * again.
 *
 * **`dirgo 0 → 1` is in the save and is deliberately not claimed.** It is one of
 * the two names of `GANG.CST/0984 putdownactor ()`'s `dumpglobal bouncer,
 * dirgo` — Isao's idle bookkeeping, the direction his little bow is swinging —
 * and leaving the saloon runs `SALLOWER.SET/0001 closeset ()`, which puts him
 * down, which runs the dump. Two separate things put it out of reach. This port
 * destroys the whole list where the corpus's four standing controls say the
 * original destroyed only the FIRST name; and this particular pair is not a
 * fifth control, because `isaoidle ()` writes `bouncer` on every pass and
 * `dirgo` only at the two ends of Isao's 40° sweep, so whether `dirgo` exists
 * at any moment is a fact about how long he had been on screen rather than
 * about what the teardown did (`docs/engine/scripting-language.md`). It is
 * absent from this run either way, and neither reason is the route's.
 *
 * **`idlecount 1 → 3` is not claimed either.** `BOOTFILE/0001 idle ()` counts
 * to four and wraps; it says which frame `DF.EXE` happened to be on when the
 * player hit save, and no route can aim at it.
 */
export const rung: Segment = {
  from: "D1E_004",
  to: "D1E_005",
  what: "the ring for Ruby, the cigar from Blood, a room from Fear",
  claims: [
    "rubyphase", "sophiephase", "bloodgood", "fearphase",
    "phase", "playercash", "handitem", "townscene", "theset", "loopsound",
  ],
  async play(p) {
    const up = set("SALUPPER");
    const sal = set("SALLOWER");
    const town = set("NITE");
    const hot = set("HOTLOWER");
    const num = (n: string): number => Number(p.session.interp.globals.get(n) ?? 0);
    const str = (n: string): string => String(p.session.interp.globals.get(n) ?? "").toLowerCase();
    const owner = (n: string): string => ask(p, "propowner", [n]).toLowerCase();

    // ---- 1. Ruby's door — SALUPPER/0034 `pointinruby`, north, and the save
    // already stands on that cell, so the walk is a check rather than a move
    const knock = async (what: string): Promise<void> => {
      p.fire((138 + 327) / 2, (2 + 263) / 2);
      await p.settle(what);
    };
    await walkTo(p, up, { x: 0, z: 0, view: "north" });
    // 2. the first two knocks only speak: `rubyphase` 0 → 1 → 2, `exitcode` each
    for (const want of [1, 2]) {
      await knock("the knock on Ruby's door");
      await talkOut(p, LEAVING, "Ruby through the door", 2);
      if (num("rubyphase") !== want) throw new Error(`rubyphase ${num("rubyphase")}, not ${want}`);
    }
    // 3. the third reaches the plaques — six sets, and 999 is the way on
    await knock("the third knock on Ruby's door");
    let asked = "";
    for (let i = 0; i < 6; i++) asked = await answer(p, 999, `Ruby, plaque set ${i + 1}`, asked);

    // 4. the last set carries the inventory's own handle: the ring, then the key
    await p.pump(
      () => (p.session.puppet?.bevels ?? []).some((b) => b.id === 55555),
      "Ruby's last plaques, with the offer among them",
    );
    await offerInTalk(p, "Ring", "the ring for Ruby");
    if (owner("ring") !== "ruby") throw new Error(`the ring is ${owner("ring")}'s`);
    await p.pump(
      () => (p.session.puppet?.bevels ?? []).some((b) => b.id === 999),
      "Ruby's last plaques again",
    );
    await answer(p, 999, "Goodbye, Miss.");
    await talkOut(p, LEAVING, "Ruby", 2);
    if (owner("hhkey") !== "stranger") throw new Error(`the saloon key is ${owner("hhkey")}'s`);
    if (num("rubyphase") !== 55) throw new Error(`rubyphase ${num("rubyphase")}, not 55`);

    // ---- 5. Sophie, the next door along — SALUPPER/0035 `pointindoor`, east --
    await walkTo(p, up, { x: 0, z: 1, view: "east" });
    p.fire((133 + 376) / 2, (2 + 263) / 2);
    await p.settle("the knock on Sophie's door");
    // by id, not by `LEAVING`: 104 is the one line in the file that sets the phase
    await answer(p, 104, "Goodnight Miss.");
    await talkOut(p, LEAVING, "Sophie", 2);
    if (num("sophiephase") !== 1) throw new Error(`sophiephase ${num("sophiephase")}, not 1`);

    // ---- 6. down the stairs, and out of the saloon — SALLOWER/0052 ---------
    await walkTo(p, up, { x: 0, z: 3, view: "east" });
    await p.press("uparrow", "down the saloon stairs");
    await p.pump(() => room(p).startsWith("sallower"), "the bar");
    await openDoor(p, [144, 7, 387, 264], "salout", "the saloon door", {
      set: sal, x: 3, z: 0, view: "east",
    });
    await p.pump(() => room(p).startsWith("nite"), "the night street");
    // the door's own `keydown` — and Blood is in the street because of it
    if (num("phase") !== 3) throw new Error(`phase ${num("phase")}, not 3`);

    // ---- 7. Blood, pacing town.blood1 (9,4) and town.blood2 (9,6) for ever --
    // onto his COLUMN, because `walktopuppet ()` opens nothing from a cell that
    // shares neither his row nor his column; and out of the way of anyone who
    // starts talking on the road, since a walk's own replies must not answer
    // the Mayor's wife
    await walkTo(p, town, { x: 9, z: 5, view: "north" }, () => !!p.session.puppet);
    await clickActor(p, "blood", "Blood in the street", 40, () => !!p.session.puppet, false);
    // 8. one reply that is the cigar, the phase, the room and the walk to it
    await answer(p, 102, "Thanks for the cigar.");
    await p.pump(() => room(p).startsWith("hotlower"), "the hotel lobby");

    // ---- 9. `bloodhotel ()`, and the one compliment that is `bloodgood = 1` --
    asked = await answer(p, 101, "Do you like the Cactus Bed?");
    asked = await answer(p, 102, "the flattering reply — statuschange (1)", asked);
    asked = await answer(p, 104, "Enough about the hotel.", asked);
    asked = await answer(p, 103, "I'm about ready to go.", asked);
    await talkOut(p, LEAVING, "Blood", 2);
    if (num("bloodgood") !== 1) throw new Error(`bloodgood ${num("bloodgood")}, not 1`);
    if (num("phase") !== 4) throw new Error(`phase ${num("phase")}, not 4`);

    // ---- 10. the desk bell — HOTLOWER/0034 `pointinbell`, east -------------
    await walkTo(p, hot, { x: 0, z: 0, view: "east" });
    p.fire((353 + 373) / 2, (224 + 244) / 2);
    await p.settle("the desk bell");
    // 11. `phase4 ()` → `money ()` → `takeroom ()` → `whenready ()`, all on 101
    asked = await answer(p, 101, "Yes.");
    asked = await answer(p, 101, "Three nights in advance?", asked);
    asked = await answer(p, 101, "I'll take the room for three nights.", asked);
    asked = await answer(p, 101, "I'm ready to check in now.", asked);
    await talkOut(p, LEAVING, "Fear", 2);
    if (num("phase") !== 5) throw new Error(`phase ${num("phase")}, not 5`);
    if (num("playercash") !== 772) throw new Error(`$${num("playercash")}, not $772`);
    if (num("fearphase") !== 2) throw new Error(`fearphase ${num("fearphase")}, not 2`);
    if (str("handitem") !== "cigar") throw new Error(`handitem "${str("handitem")}", not "cigar"`);

    // ---- 12. and the standpoint the save was taken from --------------------
    await walkTo(p, hot, { x: 1, z: 2, view: "south" });
  },
};
