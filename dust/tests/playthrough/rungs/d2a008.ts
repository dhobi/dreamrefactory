import { answer, ask, clickActor, openDoor, room, set, walkTo, type Segment } from "../route";

/**
 * Day 2, afternoon: out of Ruby's room with the gun, down to Cobb Belcher.
 *
 * Twenty seconds of play, and half of it is done TO the player. `D2ARUBY` is
 * taken in `salroom` at cell (1,0) facing south, one frame after `salgun.mov`
 * put the gun in the stranger's hands; `D2A_008` is taken on the saloon floor
 * at `sallower` (2,1) facing east with `cobb.pup` the open puppet file. Between
 * them four globals move: `cobbphase 0 → 1`, `rubyphase 2 → 1`, and
 * `bouncer`/`dirgo`, which are not the rung's doing (see the bottom).
 *
 * **`rubyphase 2 → 1` is Ruby's, not the player's.** The only gesture in it is
 * the door. `SALROOM.SET/0036 keydown ()` is
 *
 *     if currentview () = "east" & arg = "uparrow" & propowner ("door") = "salroom"
 *         if isrepeat
 *             exitcode
 *         endif
 *         if rubyphase = 2 & savescene = "scene a1" & day = 2
 *             puppetgrab (false)
 *             puppetbase ("ruby.46")
 *             sendtocast ("gang", runpuppet ("ruby.pup"))
 *
 * and `D2ARUBY` carries exactly that triple — `rubyphase = 2`,
 * `savescene = "Scene A1"` (written by `SALUPPER.SET/0034`'s own keydown on the
 * way in), `day = 2`. So walking out of the room runs Ruby's file instead of
 * the ordinary `gotospecial`, and `RUBY.PUP/0034 runyoself ()`, in its
 * `clock = 2` arm, does the rest:
 *
 *     if rubyphase = 2
 *         puppetspeak ("ruby.46")
 *         puppetspeak ("ruby.49")
 *         rubyphase = 1
 *         closesetfile ()
 *         opensetfile ("salupper.set")
 *         currentscene (savescene)
 *         currentview (savedir)
 *         exitcode
 *
 * Two lines, `rubyphase = 1`, and the room change performed by the puppet
 * script itself. There are no plaques and nothing to answer: `puppetgrab
 * (false)` is set before the call. The player presses up and is spoken to.
 * That is the whole of `rubyphase 2 → 1`, and it is why the segment claims the
 * value without ever opening a conversation with Ruby.
 *
 *   1. **Turn east and knock.** `SALROOM.SET/0036`'s `pointinrice` is
 *      170,48-341,263 and its mousedown is guarded on `currentview () = "east"`;
 *      `lockrice ()` `return false` unconditionally, so it always opens.
 *      `salroom` is four cells and the save stands in `Scene B1`, from which
 *      south → east is one `leftarrow`.
 *   2. **Up, and be talked at.** The press lands in the branch quoted above and
 *      the set is changed from inside `ruby.pup` — so the wait is for
 *      `salupper` to be the room, and the check that the right branch ran is
 *      `rubyphase = 1`. `savedir` is "south", so the landing is entered at
 *      `Scene A1` facing south, which is where `SALUPPER.SET/0034` wrote it.
 *   3. **Down the stairs.** `SALUPPER.SET/0037` owns cell (0,3), `Scene A4`, and
 *      its keydown is an ungated `uparrow` at `currentview () = "east"`:
 *      `playmovie ("saldn.mov")` then
 *      `gotospecial ("sallower.set", "scene d6", "east")`. The destination is
 *      written into the call, so the saloon floor is always entered at (3,5)
 *      facing east.
 *   4. **Cobb has to be walked to.** `GANG.CST/0419 mousedown ()` — Cobb's — is
 *      gated on `realdist (me) < hotdist ()`, and `GANG.CST/0001 hotdist ()`
 *      answers **384** in `sallower`. Cobb stands at his star `sal.cobb1`,
 *      (352,848) in `SALLOWER.SET`, and both saves record him there unmoved:
 *      unlike most of the cast his mousedown does not call `walktopuppet ()`,
 *      so he never comes to meet you. From the save's own standpoint, cell
 *      (2,1) = (640,384), he is 546 away and cannot be clicked at all. The
 *      nearest cell the set's walk table reaches is `Scene C4` (2,3), centre
 *      (640,896), **292** away — inside 384. So the conversation is had at C4
 *      and the standpoint the save records is where the player walked
 *      afterwards, which is consistent with `cobb.pup` being the *open file*
 *      rather than an open conversation: `D2ARUBY` likewise records `ruby.pup`
 *      open with no conversation running.
 *
 *      (`sallower` is a 4×6 grid but only a corridor of it is walkable —
 *      D6-D5-D4-D3, C4-C3-C2-C1-D1 and the spur to B4. `Scene B5`, whose
 *      keydown starts blackjack, has no walk transition into it at all, so no
 *      planned route can stumble into the card game.)
 *   5. **Answer 111, then 101, then 102.** `COBB.PUP/0076 twopm ()` sets
 *      `cobbphase = 1` on its first line and then asks three times: one plaque
 *      "You Cobb Belcher?" (**111**) on a `puppetevent (-1)`, then two pairs on
 *      `puppetevent (240)` — "Could be." / "You're right." numbered **101**
 *      both, and the same pair again numbered **102** both. The ids are what
 *      the branches switch on, so the replies are given by id.
 *   6. **The gun is what saves the player.** The 102 arm ends
 *
 *          if propowner ("gun") = "stranger"
 *              puppetspeak ("cobb.23") … counter = 0
 *          else
 *              counter = 2
 *              brushoff ()
 *          endif
 *
 *      and `brushoff ()` at `counter = 2` is `playerdeath = "by cobb"`. The
 *      rung before this one took the gun off Ruby's wall, so the good arm runs;
 *      `counter = 0` and `playerdeath = ""` in `D2A_008` are what say so, and
 *      both are claimed for that reason.
 *   7. **Then walk to where the save was taken** — `Scene C2` (2,1) facing
 *      east, two cells north of Cobb along the same corridor.
 *
 * **`bouncer` and `dirgo` are not claimed.** They are Isao's idle bookkeeping:
 * `GANG.CST/0984 isaoidle ()` re-arms itself every two service passes, flips
 * `bouncer` between 0 and 1 on every single pass to alternate his pose, and
 * swings `actordeg` ±20° flipping `dirgo` only at the ends of the swing. Their
 * values are the phase of a free-running loop at the instant `DF.EXE` wrote the
 * file, not anything the route did — a save taken one pass later reads the
 * other way round. `putdownactor ()` opens with `dumpglobal bouncer, dirgo`,
 * which is why `bouncer` is absent from `D2ARUBY` altogether (Isao was put down
 * by `SALLOWER.SET/0001 closeset ()` on the way upstairs) and back at 1 here:
 * `openset ()` seats him again at `clock > 1` and `isaoidle ()` recreates both.
 * Under this port's reading of `dumpglobal` — which destroys every name in the
 * list, where five shipped teardowns suggest the original destroyed only the
 * first (`docs/engine/scripting-language.md`) — `dirgo` would have been
 * destroyed too, and `D2ARUBY` records it as 0. Either way the value at the far
 * end is a coin flip, so it is left alone.
 *
 * `tumx2`/`tumy2` are the tumbleweed's position, moved by the `kickme` loop on
 * a `random`; not claimed for the same reason.
 */
export const rung: Segment = {
  from: "D2ARUBY",
  to: "D2A_008",
  what: "out of Ruby's room and down to Cobb Belcher",
  claims: ["rubyphase", "cobbphase", "counter", "playerdeath"],
  async play(p) {
    const SALROOM = set("SALROOM");
    const SALUPPER = set("SALUPPER");
    const SALLOWER = set("SALLOWER");

    // 1. the door out of Ruby's room — SALROOM.SET/0036, `pointinrice`, east
    await openDoor(p, [170, 48, 341, 263], "salroom", "the door out of Ruby's room", {
      set: SALROOM,
      x: 1,
      z: 0,
      view: "east",
    });

    // 2. …which is Ruby seeing us out: ruby.pup speaks and changes the set itself
    await p.pump(() => room(p) === "salupper", "the landing, by way of Ruby's goodbye");
    if (Number(p.session.interp.globals.get("rubyphase") ?? -1) !== 1) {
      throw new Error(
        `Ruby did not see us out — rubyphase is "${p.session.interp.globals.get("rubyphase")}"`,
      );
    }
    if (p.session.currentSceneName()?.toLowerCase() !== "scene a1") {
      throw new Error(`ruby.pup put us at ${p.session.currentSceneName()}, not Scene A1`);
    }

    // 3. down — SALUPPER.SET/0037, cell (0,3) east, saldn.mov into sallower D6
    await walkTo(p, SALUPPER, { x: 0, z: 3, view: "east" });
    await p.press("uparrow", "down the saloon stairs");
    await p.pump(() => room(p) === "sallower", "the saloon floor");

    // 4. within Cobb's 384 — Scene C4, the nearest walkable cell to sal.cobb1
    await walkTo(p, SALLOWER, { x: 2, z: 3, view: "west" });
    await clickActor(p, "cobb", "Cobb Belcher at the bar");

    // 5. COBB.PUP/0076 twopm (): one plaque, then two pairs
    const q1 = await answer(p, 111, "You Cobb Belcher?");
    const q2 = await answer(p, 101, "Could be.", q1);
    await answer(p, 102, "Could be.", q2);
    await p.pump(() => !p.session.puppet, "Cobb to finish");
    if (Number(p.session.interp.globals.get("cobbphase") ?? -1) !== 1) {
      throw new Error(`Cobb was never spoken to — cobbphase is "${p.session.interp.globals.get("cobbphase")}"`);
    }
    if (ask(p, "propowner", ["gun"]).toLowerCase() !== "stranger") {
      throw new Error(`the gun is not in hand — propowner is "${ask(p, "propowner", ["gun"])}"`);
    }

    // 6. and out to where the save was taken
    await walkTo(p, SALLOWER, { x: 2, z: 1, view: "east" });
  },
};
