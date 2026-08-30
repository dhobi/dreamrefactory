import { answer, clickActor, room, set, walkTo, type Segment } from "../route";

/**
 * Day 1, night: the ten dollars that buys the stairs.
 *
 * Thirty-eight seconds of play, and the save says what it bought:
 * `playercash 791 → 781`. Ten dollars is the price of exactly one thing in
 * Diamondback — `OONA.PUP/0052 moresex ()` is the only `playercash -10` in the
 * corpus — and what it buys is not the girl upstairs but the RIGHT to go up.
 * `SALLOWER.SET/0056` is a cell script whose entire body is a doorman: on day 1
 * after dark it swallows the `uparrow` that would carry you to the foot of the
 * stairs unless `oonaphase = 3`, and `oonaphase = 3` is what the ten dollars
 * sets. So the order of this rung is forced by the script rather than chosen —
 * pay first, climb second.
 *
 *   1. **Trotter, without moving.** `D1E_003` stands at SALLOWER Scene C3, cell
 *      (2, 2), and `sal.trotter1` (576, 648) is that same cell — `realdist` 64
 *      against a `hotdist ()` of 384. `GANG.CST/0670 mousedown` inside
 *      `sallower` does not call `walktopuppet ()` at all; it sets
 *      `currentscene ("scene c3")` and `currentview ("west")` itself and runs
 *      the puppet. That is the reason he is done FIRST: the click re-seats the
 *      camera where the rung already starts, so it costs no walking, and taken
 *      after Oona it would silently undo the walk to her.
 *
 *      `TROTTER.PUP/0068` is his day-1 file, `phase` is 2 so the `phase > 6` arm
 *      is closed, and `runyoself ()` is a plain switch on `trotterphase`. The
 *      save carries **4**, and `case 4` is two spoken lines (`trotter.18`,
 *      `trotter.19`) and `trotterphase = 5`. No plaques anywhere in it — so
 *      `clickActor`'s default test, "a conversation is open", can pass right
 *      through the whole exchange between two looks. The outcome asked for is
 *      the phase itself.
 *   2. **Oona, at the cell her star stands in.** `sallower.oona` is (964, 900),
 *      cell (3, 3); Scene C3's camera is 415 units away and `hotdist ()` in
 *      `sallower` is 384, so she cannot be clicked from where the rung starts.
 *      Her `GANG.CST/0851 mousedown` is the easy kind — `realdist (me) <
 *      hotdist ()` and nothing else, no `walktopuppet ()` and so no cell-delta
 *      gate — and she is seated (`setupactor ("bar")` ends `endwalk ()`, whose
 *      loop only alternates her pose between "stand" and "poof"), so `walkTo`
 *      onto her own cell is enough and `meet` would be answering a question
 *      about a wanderer that this one is not.
 *   3. **The first conversation, which is what makes the second one possible.**
 *      `OONA.PUP/0052 runyoself ()` with `oonaphase = 0` is `retort ()`, and its
 *      three plaques are numbered 102, 101, 101 — the two 101s ("Sorry to bother
 *      you ma'am." and "I'd like a drink.") both lead to `hostile ()`, where
 *      **101 sets `oonaphase = 2`** and `GANG.CST/0851 mousedown` then reads that
 *      2 and throws you into the street (`gototown ("east")`). **102** ("Oh,
 *      about $3 of good whiskey.") skips `hostile ()` entirely and goes to
 *      `startgood ()`, whose two replies both fall into `gameloop ()`. There the
 *      only line that matters is **105, "So long, Oona."** — the one exit of a
 *      `while true`, and the line that sets **`oonaphase = 1`**. The other four
 *      are flavour and set nothing, so the route takes the short way through.
 *   4. **The second conversation, which is the ten dollars.** Clicked again at
 *      `oonaphase = 1`, `runyoself ()` runs `setup ()` and then `subracksex ()`.
 *      `setup ()` is a three-line rotation on **`counter`**, and `D1E_003`
 *      carries `counter = 2`, whose arm speaks `oona.42` and leaves
 *      **`counter = 0`** — which is exactly what `D1E_004` records. That is the
 *      whole of the counter's movement across this rung, and it is the check
 *      that the second click really went through her day-1 file rather than
 *      through a brush-off.
 *
 *      `subracksex ()` offers **101, "I want to go upstairs."**, which speaks one
 *      of three random lines and then `moresex ()`. `moresex ()`'s **101**,
 *      "I'll settle up with you.", is the fork: below $10 it is a refusal with a
 *      one-in-ten chance of `oonaphase = 3` anyway, and at or above $10 it is
 *      `playercash = playercash -10` and `oonaphase = 3` with no dice rolled at
 *      all. The rung starts at 791, so the arithmetic is not a gamble. Back in
 *      `subracksex ()` the loop's own tail is `if oonaphase = 3 exitcode`, so the
 *      payment closes the conversation.
 *   5. **Up.** `SALLOWER.SET/0056` owns Scene D5, cell (3, 4), and is nothing but
 *      the guard: `if arg = "uparrow" & currentview () = "south" & clock > 1`,
 *      then `if day = 1 & oonaphase != 3` → run Oona's mousedown and `exitcode`,
 *      with a nasty consolation prize on the way (`if oonaphase = 1 → oonaphase
 *      = 4`, which is `block ()` and no longer `setup ()`). With `oonaphase = 3`
 *      it falls through to `passcode` and the set-level `keydown` walks. The
 *      stairs themselves are `SALLOWER.SET/0057`, Scene D6, cell (3, 5), facing
 *      west: an ungated `uparrow`, `salup.mov`, `gotointerior ("salupper.set")`.
 *   6. **And that climb is what puts `oonaphase` back to 1.**
 *      `gotointerior ()` is `gotospecial (setname, "", "")` (`NEW.FLT/0001`), so
 *      no scene is named and the set opens at its own first standpoint —
 *      SALUPPER **Scene A4**, cell (0, 3), which is the head of the stairs
 *      (`SALUPPER.SET/0037`'s `uparrow` facing east plays `saldn.mov` and drops
 *      you back at `sallower` "scene d6"). Its `openscene ()` is two lines:
 *      `if day = 1 → oonaphase = 1`. So the 3 that was paid for lasts exactly as
 *      long as the staircase, and `D1E_004`'s **1** is the landing writing over
 *      it — not the payment failing.
 *   7. **The standpoint.** `D1E_004` was taken at SALUPPER cell (0, 0) facing
 *      north — Scene A1, which is Ruby's door (`SALUPPER.SET/0034
 *      pointinruby`). Three cells north along the landing, and nothing is
 *      knocked on: `rubyphase` is 0 at both ends of the rung.
 *
 * **`bouncer` is not claimed, and the reason is not the `dumpglobal` one.** It
 * is the phase of a free-running loop: `GANG.CST/0984 isaoidle ()` re-arms
 * itself every two service passes and flips `bouncer` between 0 and 1 to bob
 * Isao at the piano, so its value at any instant counts the frames the saloon
 * floor has been on screen and nothing the player did. It is also the FIRST name
 * of `dumpglobal bouncer, dirgo` in that file's `putdownactor ()`, which
 * `SALLOWER.SET/0001 closeset ()` runs on the way upstairs — and the first name
 * is the one case the disputed table in `docs/engine/scripting-language.md` and
 * this port agree about, so the ambiguity that costs other rungs a claim does
 * not arise here. (`D1E_004` carries neither `bouncer` nor `dirgo`: two fewer
 * numeric globals than `D1E_003`, which is `DF.EXE` destroying both names of
 * that list rather than only the first.)
 *
 * `starcount 1 → 7` is the shooting star over the night town — `HOUSE.PRP/0002
 * movestar ()` steps it once per pass and restarts the arc past 6 — and
 * `idlecount 0 → 1` is `BOOTFILE/0001 idle ()`'s mod-4 tick. Neither is a
 * consequence of a route.
 */
export const rung: Segment = {
  from: "D1E_003",
  to: "D1E_004",
  what: "ten dollars for Oona, and the stairs she was standing in front of",
  claims: ["oonaphase", "trotterphase", "playercash", "counter"],
  async play(p) {
    const SALLOWER = set("SALLOWER");
    const SALUPPER = set("SALUPPER");
    const num = (name: string): number => Number(p.session.interp.globals.get(name) ?? 0);
    const talking = (): boolean => !!p.session.puppet;

    // ---- 1. Trotter, from the cell the rung already stands in ---------------
    // his day-1 `case 4` is two `puppetspeak`s and a phase — no plaques at all,
    // so "a conversation is open" is not a test that can see it happen
    await clickActor(p, "trotter", "Trotter at the bar", 20, () => num("trotterphase") === 5);
    await p.pump(() => !talking(), "Trotter to finish");
    if (num("trotterphase") !== 5) throw new Error(`trotterphase is ${num("trotterphase")}`);

    // ---- 2 & 3. Oona, and the reply that is not `hostile ()` -----------------
    await walkTo(p, SALLOWER, { x: 3, z: 3, view: "north" }, talking);
    await clickActor(p, "oona", "Oona at the bar");
    // 102 skips `hostile ()`, whose 101 is `oonaphase = 2` and being shown the
    // door; the two other plaques here are BOTH numbered 101 and both lead there
    let asked = await answer(p, 102, "Oh, about $3 of good whiskey.");
    asked = await answer(p, 101, "There a game I can get in on?", asked);
    // the one exit of `gameloop ()`'s while-true, and the line that sets the 1
    await answer(p, 105, "So long, Oona.", asked);
    await p.pump(() => !talking(), "Oona to finish");
    if (num("oonaphase") !== 1) throw new Error(`oonaphase is ${num("oonaphase")} after the first talk`);

    // ---- 4. the ten dollars -------------------------------------------------
    await clickActor(p, "oona", "Oona again, for the stairs");
    // `setup ()` ran on the way in and took `counter` 2 → 0; the rest is
    // `subracksex ()` → `moresex ()`
    asked = await answer(p, 101, "I want to go upstairs.");
    await answer(p, 101, "I'll settle up with you.", asked);
    await p.pump(() => !talking(), "Oona to take the money");
    if (num("oonaphase") !== 3) throw new Error(`oonaphase is ${num("oonaphase")} — she was not paid`);
    if (num("playercash") !== 781) throw new Error(`playercash is ${num("playercash")}`);
    if (num("counter") !== 0) throw new Error(`counter is ${num("counter")} — setup () did not run`);

    // ---- 5. past the doorman on Scene D5, and up ----------------------------
    await walkTo(p, SALLOWER, { x: 3, z: 5, view: "west" });
    await p.press("uparrow", "up the saloon stairs");
    await p.pump(() => room(p) === "salupper", "the landing");
    // the head of the stairs, whose `openscene ()` is the day-1 `oonaphase = 1`
    if (p.session.currentSceneName()?.toLowerCase() !== "scene a4") {
      throw new Error(`the stairs came out at ${p.session.currentSceneName()}`);
    }
    if (num("oonaphase") !== 1) throw new Error(`the landing left oonaphase at ${num("oonaphase")}`);

    // ---- 7. along to Ruby's door, where the save was taken ------------------
    await walkTo(p, SALUPPER, { x: 0, z: 0, view: "north" });
  },
};
