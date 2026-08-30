import {
  answer, ask, clickActor, dropOn, meet, set, takeInHand, talkOut, walkTo, type Segment,
} from "../route";

/**
 * The first four thousand frames: a cold boot to `D1E_001`.
 *
 * The one rung that does not start at a shipped save, because there is no save
 * before it — `D1E_001` is the earliest file CyberFlix took and the opening
 * happens in front of it. Until this rung existed the port had never been
 * checked against the original over that stretch at all.
 *
 * `newDustHost ()` has already run `coldBoot ()` when `play ()` is called, so
 * the starting point is the boot's own: `NEW.FLT/0001 advanceday ()`, `case 1`,
 * which sets `playercash = 5`, `bulletcount = 6`, `townscene = "scene g5"` and
 * `savescene = "scene c4"`, calls `initall ("town", "nite.set")` — at
 * `clock = 3` the town is `nite.set` — and leaves the player at **Scene G15**
 * (6,14) facing north. Every one of those four values is still what `D1E_001`
 * carries, so `playercash = 5` at the far end is the BOOT's five, not the safety
 * net: `HELP1.PUP/0033 runyoself ()` opens `if playercash <= 0 → playercash = 5`
 * and 5 is not <= 0, so that arm never runs on this route.
 *
 *   1. **Answer the conversation the boot leaves open.** Nobody clicked Leroy:
 *      `GANG.CST/0002 leroyidle ()` arms `hasattention (10)` while
 *      `actorstar (me) = "town.leroy1" & leroyphase = 0`, and `GANG.CST/0001
 *      hasattention ()` fires `sendtoactor (target, mousedown (0))` once the
 *      player has stood in front of him that long — the boot's
 *      `curattention = "leroy"` is that timer, already run down.
 *      `LEROY.PUP/0088 runyoself ()` on day 1 tests `actorxyz ("leroy", 1) >
 *      2432` first; `town.leroy1` is (1740,3536), so it falls through to
 *      `bysign ()`.
 *
 *      `bysign ()` is a `while true` around four plaques and only **104, "I best
 *      be movin' along."** leaves it — it speaks leroy.53–55 and sets
 *      `leroyphase = 1`. `case -1`, which is what ESC and therefore `excuseUs`
 *      reaches, exitcodes with `leroyphase` still 0, and `D1E_001` reads 1. So
 *      the rung's first gesture is an answer, not a walk-away.
 *
 *      It is also what sends him to the shooting range, which is where this rung
 *      ends. `GANG.CST/0001 walktopuppet ()` resumes when `runpuppet ()` returns
 *      and walks him back to `town.leroy1`; that arrival runs
 *      `GANG.CST/0002 endwalk ()`, which is `if actorstar (me) = "town.leroy1" &
 *      leroyphase = 1 → makeloop ("actor", me, "walkout", random (100) + 100)`,
 *      and `walkout ()` is `moveactor ("town.leroy2")`. `town.leroy2` is
 *      (2656,2720) — cell (10,10) — and that is exactly where `D1E_001`'s actor
 *      table has him standing. The rung never touches him again.
 *
 *   2. **North up the street to Scene G12** (6,11), the cell with Chin's door on
 *      the east and the jail on the west, and the last one before the dog.
 *
 *   3. **Walk into the dog.** `NITE.SET/0135 keydown ()` is the gate:
 *
 *          if arg = "uparrow" & currentview () = "north"
 *              if day = 1 & actorvisible ("dog") = true
 *                  sendtostage (spotmovie ("dog1.mov"))
 *                  sendtoactor ("help", setupactor ("dog"))
 *
 *      and it exitcodes, so the press growls and does not move you. The second
 *      line is the point: it is what puts the help character in the street, at
 *      `town.help` (1760,3034) — cell (6,11), the player's own. The press is
 *      therefore repeated until `actorvisible ("help")` says he is out, rather
 *      than counted: the handler is not itself a counter, but a press that
 *      arrives while the film is still on screen is not a press that reaches it.
 *
 *   4. **Ask him what to do, and keep asking.** `clickActor` runs
 *      `GANG.CST/0111 mousedown`, whose `realdist (me) < hotdist ()` is
 *      satisfied on his own cell and whose `walktopuppet ("help1.pup")` opens
 *      `if thex != 0 & they != 0 exitcode` over cell deltas that are both zero.
 *      `HELP1.PUP/0033 runyoself ()` — the "HELP DAY 1" container — has nothing
 *      true yet (`helpphase = 0`, the dog visible, the bone unowned and
 *      invisible), so it reaches `mainloop ()`.
 *
 *      **The bone is `thirdchance ()`, and only `thirdchance ()`.**
 *      `docs/dust/walkthrough.md` says that "Who you calling
 *      stupid?" is the only branch that runs
 *      `sendtoprop ("bone", setupprop ("street"))`; the script says the
 *      opposite. `mainloop ()`'s **101** is `help.33/help.3/help.34` and
 *      `helpphase = 2` — no bone. The bone is at the bottom of a three-deep
 *      ladder, and this is the whole of it:
 *
 *          mainloop ()      103 "What should I do?"          -> secondchance ()
 *          secondchance ()  102 "So I'll use my brain..."    -> thirdchance ()
 *          thirdchance ()   101 "What should I look for?"    -> the bone
 *
 *      so the rung answers 103, 102, 101 in that order. (The walkthrough's route
 *      is reachable too, just longer: 101 sets `helpphase = 2`, and a SECOND
 *      conversation then goes `mustappologize ()` 101 → `helpphase = 1` →
 *      `thirdchance ()`. Both end in the same place and neither is recorded in
 *      the save, so the rung takes the one the script does in a single
 *      exchange.) Each of `secondchance ()` and `thirdchance ()` offers its id
 *      twice on different words, which is why the replies are answered by id.
 *
 *      `INVEN.PRP/0002 setupprop ("street")` then puts the bone at
 *      `town.bone` — (1478,3752), cell (5,14) — with `propview = "small"`.
 *
 *   5. **Pick the bone up** from Scene G15 (6,14), where the boot started.
 *      `INVEN.PRP/0001 stdmouse ()` for a `"small"` prop is
 *      `if realdist (what) < hotdist () → addinven (what)`, and `hotdist ()`
 *      answers 512 here because `currentset ()` is `"town"` — the town's own
 *      name for both of its sets. From the centre of G15 (1664,3712) the bone is
 *      190 away.
 *
 *   6. **Give it to the dog** — back at Scene G12 facing north, which is where
 *      the dog stands one cell ahead at `town.dog` (1620,2748).
 *
 *      This is a PRESS-DRAG-RELEASE, and it has to go through the director
 *      rather than straight at the interpreter, which is what `route.ts`'s
 *      `dropOn ()` is for — the sibling of `dragTo ()`, which is the same
 *      gesture onto a FLAT and has to be dispatched the other way. `EXTRA.CST/0039 offerobject ("bone")` turns the camera itself:
 *
 *          currentview ("north") ; currentscene ("scene g12")
 *          sendtoshop ("inven", dumpinven (what))
 *          sendtostage (spotmovie ("dog2.mov"))
 *          currentscene ("right")
 *          while currentview () != "east" forceupdate () endwhile
 *
 *      and `currentscene`/`currentview` as SETTERS go through
 *      `session.onSceneJump` / `onNavigate`, which are no-ops unless a gesture
 *      has armed them (`ScreenDirector.press` → `RoomLayer.armRoomNav`). Reached
 *      any other way that `while` never ends. See `dropOn ()`'s own comment.
 *
 *   7. **...and the game plays the rest of it.** The same handler finishes with
 *      `sendtoactor ("help", setupactor ("dog"))`,
 *      `sendtoactor ("help", mousedown (0))` and `phase = 2`, so the help
 *      character walks back on by himself and `HELP1.PUP/0033 runyoself ()` —
 *      now `if actorvisible ("dog") = false` — runs `givesring ()`. Its two
 *      plaques both fall into `ringer ()` (`case -1` shares `case 102`'s body,
 *      so even a dismissal gives the ring), and `ringer ()` is
 *      `addinven ("ring")`, `putdownactor ()` for himself, and
 *      `sendtoactor ("jones", setupactor ("bar"))`. Then `helpphase = 3`.
 *      **102, "I already know how to play"** is the answer taken: 101 detours
 *      through `fromhell ()`, ten more spoken lines, and arrives at the same
 *      `ringer ()`. Nothing in `D1E_001` can tell the two apart.
 *
 *      `phase = 2` is set after all of that, because `sendtoactor` is awaited —
 *      which is why the rung's `phase` claim is the dog's, not the street's.
 *
 *   8. **The jug**, at `town.jug` (1730,3476) — cell (6,13), Scene G14, under
 *      Leroy's sign. Same `stdmouse ()` "small" branch as the bone.
 *
 *   9. **Jones, who is now at the bar.** `GANG.CST/0267 setupactor ("bar")` puts
 *      him at `town.jones1` (6,7) and immediately `moveactor ("town.jones2")`
 *      (6,9), so he is walking when this rung goes looking — `meet` asks the
 *      engine where he is, waits for him to stand, and walks onto his cell.
 *      `JONES.PUP/0067 outsidesaloon ()` is a `while true`, and **104, "Well,
 *      I'll see you around."** is both its only exit and the whole point of it:
 *
 *          if propowner ("cards") != "stranger"
 *              sendtoshop ("inven", addinven ("cards"))
 *          jonesphase = 1
 *
 *      Jug before Jones, because `addinven ()` sets `handitem` to whatever it
 *      just gave you and `D1E_001` holds the **cards**.
 *
 *  10. **East along the street to Scene K11** (10,10) facing south, which is
 *      where `D1E_001` is taken — standing over Leroy at the shooting range,
 *      about to start the game the next rung plays.
 *
 * **What is not claimed.**
 *
 * `counter` is 1 in `D1E_001` and this route never allocates it. It is the
 * shared brush-off counter — `LEROY.PUP/0088 brushoff ()`,
 * `JONES.PUP/0067 brushoff ()` and `HELP1.PUP/0007 gift ()` all walk the same
 * three-line switch — so the 1 says the original clicked somebody one more time
 * than it had to, after their phase had already reached 1. Which of the three,
 * and where, the save cannot say, and inventing a click to land on the number
 * would be fitting the route to the save rather than to the script. So it is
 * left out and said here instead. (It is still 1 at `D1E_002`, which
 * `rungs/d1e002.ts` uses as its own guard.)
 *
 * `attentionspan` is `frame ()` stamped by `GANG.CST/0001 hasattention ()` and
 * measures how long the original stood still, not what it did. `starcount`,
 * `stardx`, `stardy` and `stardz` belong to `HOUSE.PRP/0002 southstar ()` — the
 * night sky's shooting star, a prop loop that runs whatever the player does, and
 * whose `if y < 11 exitcode` means it does not even arm from the cell this rung
 * ends on. `idlecount` is the BOOTFILE's own idle tick. None of them is an
 * outcome of a route.
 *
 * **The count does not mean what it looks like.** `D1E_001` carries 92 globals
 * and the boot leaves 94, but no name is lost between them. Nine of the boot's —
 * `savestage1..3`, `saveflat1..3`, `jumpset`, `twocount`, `themevolume` — are
 * seeded by `GameSession.seedBootGlobals ()`, which carries TAOOT's boot names,
 * and `tour` is set by the host; Dust's own boot declares none of them and
 * `DF.EXE` never had them. Take those ten away and add the eight `D1E_001` has
 * that a fresh boot has not allocated yet — `counter`, `idlecount`,
 * `setproploc`, the four star globals, and a one-character junk name whose
 * record is a destroyed slot the save writer still walks (see the `dumpglobal`
 * note in `docs/engine/scripting-language.md`) — and 94 becomes 92 exactly.
 * Nothing here is the route's doing.
 */
export const rung: Segment = {
  from: null,
  to: "D1E_001",
  what: "a cold boot: the dog, the bone, the ring, and into town",
  claims: [
    "day", "clock", "phase", "handitem", "playercash", "theset", "townscene",
    "leroyphase", "helpphase", "jonesphase", "loopsound",
  ],
  async play(p) {
    const nite = set("NITE");
    const num = (n: string): number => Number(p.session.interp.globals.get(n) ?? 0);
    const str = (n: string): string => String(p.session.interp.globals.get(n) ?? "").toLowerCase();
    const visible = (who: string): boolean => ask(p, "actorvisible", [who]) === "1";

    /**
     * Where on this actor's sprite to aim, asked of the engine.
     *
     * `INVEN.PRP/0001 stdmouse ()` hit-tests the RELEASE point with
     * `pointinactor (thename, arg)`, so a drop has to land on drawn pixels — and
     * the dog is a small animal at the far end of a cell, about thirty pixels
     * across. This scans the room image with the same predicate the script will
     * use and returns the hit nearest the middle of them, so no coordinate here
     * is guessed — the same idea as `openDoor`'s own `aim`.
     */
    const aimAt = (who: string): { x: number; y: number } => {
      const point = (x: number, y: number): number => Number(ask(p, "makepoint", [x, y]));
      const on: { x: number; y: number }[] = [];
      for (let y = 2; y < 264; y += 4) {
        for (let x = 2; x < 512; x += 4) {
          if (ask(p, "pointinactor", [who, point(x, y)]) === "1") on.push({ x, y });
        }
      }
      if (!on.length) throw new Error(`${who} is not drawn anywhere on screen`);
      const mid = {
        x: on.reduce((a, q) => a + q.x, 0) / on.length,
        y: on.reduce((a, q) => a + q.y, 0) / on.length,
      };
      return on.reduce((best, q) =>
        (q.x - mid.x) ** 2 + (q.y - mid.y) ** 2 < (best.x - mid.x) ** 2 + (best.y - mid.y) ** 2 ? q : best);
    };

    // ---- 1. the conversation the boot leaves open --------------------------
    await talkOut(p, [104], "Leroy by the sign");
    if (num("leroyphase") !== 1) throw new Error(`leroyphase is ${num("leroyphase")} — 104 was not the reply`);

    // ---- 2-3. up the street until the dog stops us and Help comes out ------
    await walkTo(p, nite, { x: 6, z: 11, view: "north" });
    for (let i = 0; i < 4 && !visible("help"); i++) await p.press("uparrow", "up the street into the dog");
    await p.pump(() => visible("help"), "the help character to come out at the dog's growl");
    if (p.session.currentSceneName()?.toLowerCase() !== "scene g12") {
      throw new Error(`the dog did not block us — ${p.session.currentSceneName()}`);
    }

    // ---- 4. three questions down to the one that puts the bone in the street
    await clickActor(p, "help", "the help character outside Chin's");
    let asked = await answer(p, 103, "What should I do?");
    asked = await answer(p, 102, "So I'll use my brain. Now what?", asked);
    await answer(p, 101, "What should I look for?", asked);
    await p.pump(
      () => ask(p, "propvisible", ["bone"]) === "1" && ask(p, "propview", ["bone"]).toLowerCase() === "small",
      "the bone to be thrown into the street",
    );
    await p.settle("the help character");

    // ---- 5. down to the gate for it ----------------------------------------
    await walkTo(p, nite, { x: 6, z: 14, view: "north" });
    await takeInHand(p, "bone", "the Bone in the street");

    // ---- 6-7. back to the dog, and the film, the ring and Jones follow -----
    await walkTo(p, nite, { x: 6, z: 11, view: "north" });
    const given = await dropOn(p, "bone", aimAt("dog"), "the Bone");
    await p.pump(() => given() || !!p.session.puppet, "the dog to take the bone");
    await talkOut(p, [102], "the help character's parting gift");
    await p.pump(given, "the gift to finish");
    await p.settle("the street after the dog");
    if (num("phase") !== 2) throw new Error(`phase is ${num("phase")} — the dog never took the bone`);
    if (num("helpphase") !== 3) throw new Error(`helpphase is ${num("helpphase")}`);
    if (ask(p, "propowner", ["ring"]).toLowerCase() !== "stranger") throw new Error("no ring");

    // ---- 8. the jug under Leroy's sign -------------------------------------
    await walkTo(p, nite, { x: 6, z: 13, view: "north" });
    await takeInHand(p, "jug", "the Jug by Leroy's sign");

    // ---- 9. Jones, who is walking down from the saloon ---------------------
    await meet(
      p, nite, "jones", "Jones, come up from the bar",
      () => !!p.session.puppet || num("jonesphase") === 1,
    );
    if (num("jonesphase") !== 1) await talkOut(p, [104], "Jones outside the saloon");
    if (str("handitem") !== "cards") throw new Error(`handitem is "${str("handitem")}" — no cards`);

    // ---- 10. and over to the shooting range --------------------------------
    await walkTo(p, nite, { x: 10, z: 10, view: "south" });
  },
};
