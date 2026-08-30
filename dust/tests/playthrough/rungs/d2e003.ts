import { answer, ask, openDoor, room, set, walkTo, type Segment } from "../route";

/**
 * Day 2, night, upstairs at the saloon: Sophie's hairpin, and in through Oona's door.
 *
 * `D2E_002` is taken standing at **Scene A2 (0,1) facing east** — which is
 * Sophie's door, `SALUPPER.SET/0035` — with the harmonica in hand and
 * `oona.pup` as the last file the cast opened. `D2E_003` is taken one landing
 * later, inside `salroom` at (1,0) facing west, holding a hairpin.
 *
 * **Which door was walked through is written down.** Two cells of this landing
 * have a `keydown` that leads into `salroom`, and they disagree about what to
 * record: `SALUPPER.SET/0034` (Ruby's door, Scene A1) writes
 * `savedir = "south"`, and `SALUPPER.SET/0036` (Oona's door, Scene A3) writes
 * `savedir = "west"`. Both write `savescene = currentscene ()`. `D2E_003` reads
 * `savescene = "Scene A3"` and `savedir = "west"`, so the way in was **Oona's
 * door**, and the way in could not have been Ruby's: `lockruby ()` returns true
 * for `day = 2 & clock = 3`, so at this hour her door only knocks.
 *
 *   1. **Knock on Sophie.** `SALUPPER.SET/0035` owns Scene A2, and its whole
 *      mousedown is `currentview () = "east" & pointindoor (arg)` — the
 *      rectangle 133,2-376,263 written out at the bottom of the same file. Its
 *      `lockdoor ()` shuts only on day 3 night and day 4, so tonight it opens:
 *      knock, `setupprop ("door", "sophie")`, `runpuppet ("sophie.pup")`. The
 *      save already stands on that cell facing that way, so this is the first
 *      thing there is to do.
 *   2. **`twonite ()` hands out one reply at a time.** `SOPHIE.PUP/0034` is the
 *      day-2 file; `runyoself ()` switches on `clock` and 3 is `twonite ()`.
 *      Its `while true` is unlike the others in the corpus: a local `track`
 *      counts rounds and the `switch track` posts exactly ONE plaque per pass —
 *      101, then 102, then 103, then 104 — incrementing whether or not the
 *      reply is used. So the conversation is a fixed sequence, and there is no
 *      `addhandbevel ()` in it at all: the harmonica cannot be offered here.
 *   3. **103 is the hairpin.** `case 103` speaks `sophie.65` and `sophie.66` and
 *      then `sendtoshop ("inven", addinven ("hairpin"))`. `INVEN.PRP/0001
 *      addinven ()` ends with `handitem = newitem` and
 *      `propowner (newitem, "stranger")` — which is both halves of what the save
 *      records, `Hairpin` going from no owner to `stranger` and `handitem` from
 *      "Harmonica" to "hairpin", lower-cased exactly as the call spells it.
 *   4. **104 is the only line that sets the phase.** `case 104` speaks
 *      `sophie.67`, sets `sophiephase = 1` and exits. `case -1` — the ESC that
 *      `excuseUs` presses — exits without it, so this rung cannot walk out of
 *      the conversation; and after 103 the `track` is 4, which no `case`
 *      matches, so the pass after the hairpin posts no plaque at all unless 104
 *      is taken on the round it is offered. Answering by id, in order, is the
 *      only way through.
 *   5. **`rubyphase 0 → 1` is not a conversation.** `RUBY.PUP/0034` is the day-2
 *      file and its `runyoself ()` switch is `case 3: error ()` — Ruby has no
 *      night, which is why `SALUPPER.SET/0034 lockruby ()` shuts her door at
 *      `day = 2 & clock = 3`. What moves her phase is that cell's `openscene`:
 *
 *          if day = 2 & clock = 3 & rubyphase = 0 & currentview () = "north"
 *              sendtoflat (currentflat (), listen ())
 *              sendtocast ("gang", rungossip ("trotruby.snd"))
 *              sendtoflat (currentflat (), noface ())
 *              rubyphase = 1
 *
 *      Standing at Scene A1 and facing north is the whole of it: you put your
 *      ear to her door, hear Trotter inside, and that is the phase. `openscene`
 *      is a per-view event in this port (`runtime/setscripts.ts`), so turning to
 *      north on that cell fires it.
 *   6. **In through Oona's.** `SALUPPER.SET/0036` owns Scene A3; its mousedown
 *      is `currentview () = "east" & pointindoor (arg)`, rectangle
 *      133,2-357,263, and `sendtoprop ("door", setupprop ("oona"))`. Its
 *      `lockdoor ()` is inverted from the others — it returns **false** only for
 *      `day = 2 & clock = 3` and true otherwise, so this one night is the only
 *      time the door opens at all. The `keydown` behind it is gated on
 *      `propowner ("door") = "oona"`, and it is what writes
 *      `savescene = currentscene ()` = "Scene A3", `savedir = "west"`, then
 *      `gotointerior ("salroom.set")`.
 *   7. **Nothing else happens on the way in.** The same cell's `openscene` would
 *      lock the set and call Buick to the bar, but it needs
 *      `propowner ("yunnibook") = "stranger"` and `D2E_002` has the Yunni book
 *      unowned, so it is refused — which matches `lockevents` reading 0 at both
 *      ends. The `keydown`'s own `if day = 2 & clock = 3` does
 *      `sendtoprop ("yunnibook", setupprop ("bed"))`, planting the book in the
 *      room for later; the save records it as a prop location, not a global.
 *
 * **`idlecount 2 → 1` is not claimed.** It is the cast's idle bookkeeping —
 * `GANG.CST`'s idlers count service passes between their turns — so its value at
 * a save is a count of real time spent standing about, not of anything the route
 * did.
 *
 * **`counter` is not claimed either**, because it does not move: it is
 * `SOPHIE.PUP/0033 brushoff ()`'s round-robin, and `brushoff ()` is only reached
 * when `sophiephase = 1` on the way IN. Starting at 0, this rung never calls it.
 */
export const rung: Segment = {
  from: "D2E_002",
  to: "D2E_003",
  what: "Sophie's hairpin, the gossip at Ruby's door, and in through Oona's",
  claims: ["sophiephase", "rubyphase", "handitem", "savescene", "savedir"],
  async play(p) {
    const SALUPPER = set("SALUPPER");
    const held = (): string => String(p.session.interp.globals.get("handitem") ?? "").toLowerCase();
    const num = (name: string): number => Number(p.session.interp.globals.get(name) ?? -1);
    const str = (name: string): string => String(p.session.interp.globals.get(name) ?? "").toLowerCase();

    // 1. Sophie's door — SALUPPER.SET/0035, Scene A2 (0,1) east, `pointindoor`
    await walkTo(p, SALUPPER, { x: 0, z: 1, view: "east" });
    p.fire((133 + 376) / 2, (2 + 263) / 2);
    await p.pump(() => !!p.session.puppet, "Sophie to answer the knock");

    // 2. twonite ()'s four plaques, in the order its `track` posts them
    let asked = await answer(p, 101, "Now why would I do that?");
    asked = await answer(p, 102, "How could you have known Cobb wanted to kill me?", asked);
    asked = await answer(p, 103, "Maybe I have a surprise for YOU, this time.", asked);
    await p.pump(() => held() === "hairpin", "the hairpin in hand");
    await answer(p, 104, "Goodnight, Sophie.", asked);
    await p.pump(() => !p.session.puppet && num("sophiephase") === 1, "Sophie to say goodnight");
    if (ask(p, "propowner", ["hairpin"]).toLowerCase() !== "stranger") {
      throw new Error(`the hairpin was not taken — propowner is "${ask(p, "propowner", ["hairpin"])}"`);
    }

    // 3. an ear at Ruby's door — SALUPPER.SET/0034's openscene, Scene A1 (0,0) north
    await walkTo(p, SALUPPER, { x: 0, z: 0, view: "north" });
    await p.pump(() => num("rubyphase") === 1, "the gossip through Ruby's door");

    // 4. Oona's door — SALUPPER.SET/0036, Scene A3 (0,2) east, `pointindoor`
    await walkTo(p, SALUPPER, { x: 0, z: 2, view: "east" });
    await openDoor(p, [133, 2, 357, 263], "oona", "Oona's door", {
      set: SALUPPER,
      x: 0,
      z: 2,
      view: "east",
    });
    await p.pump(() => room(p) === "salroom", "Oona's room");
    if (str("savescene") !== "scene a3" || str("savedir") !== "west") {
      throw new Error(
        `the wrong door was recorded — savescene "${str("savescene")}", savedir "${str("savedir")}"`,
      );
    }
  },
};
