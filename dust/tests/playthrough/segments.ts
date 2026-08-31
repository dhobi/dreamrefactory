/**
 * The route: what to do between one shipped save and the next.
 *
 * Each segment names the rung of [the golden thread](../../../docs/dust/thread.md)
 * it plays — `from` and `to` are real files in `gamefiles/save/`, written by
 * `DF.EXE` in 1995 — and the runner does the rest: load `from`, run `play`, and
 * check the game against `to`.
 *
 * **The saves say what changed, never how.** So every segment cites the script
 * it came from, and that citation is the only thing standing between a route and
 * a guess. The first is the worked example: its rung says
 *
 *     mwifephase 0→2   theset "hotlower"→"mayhall"   townscene "scene g5"→"scene j9"
 *
 * and none of that tells you that the Mayor's gate is locked on day 1, or that
 * the way in is a conversation.
 *
 * The moves they are written out of — `walkTo`, `openDoor`, `clickActor`,
 * `answer`, `talkOut` — are in [`route.ts`](./route.ts), with the reason each
 * one checks itself.
 */
import {
  LEAVING, answer, ask, clickActor, clickProp, clickThrough, converse,
  excuseUs, hold, offerInTalk, offerTo, openDoor, question, room, set, takeInHand,
  talkOut, walkTo, type Segment,
} from "./route";

export type { Segment } from "./route";
import { rung as d2a006 } from "./rungs/d2a006";
import { rung as d2a007 } from "./rungs/d2a007";
import { rung as d2aruby } from "./rungs/d2aruby";
import { rung as d2a008 } from "./rungs/d2a008";
import { rung as d2a009 } from "./rungs/d2a009";
import { rung as d2e001 } from "./rungs/d2e001";
import { rung as d2e002 } from "./rungs/d2e002";
import { rung as d2e003 } from "./rungs/d2e003";
import { rung as d2e004 } from "./rungs/d2e004";
import { rung as d3m001 } from "./rungs/d3m001";
import { rung as d3m002 } from "./rungs/d3m002";
import { rung as d3m003 } from "./rungs/d3m003";
import { rung as d3mclas } from "./rungs/d3mclas";
import { rung as d3m004 } from "./rungs/d3m004";
import { rung as d3m005 } from "./rungs/d3m005";
import { rung as d3a001 } from "./rungs/d3a001";
import { rung as d3a002 } from "./rungs/d3a002";
import { rung as d3a003 } from "./rungs/d3a003";
import { rung as d1e002 } from "./rungs/d1e002";
import { rung as d1e003 } from "./rungs/d1e003";
import { rung as d1e004 } from "./rungs/d1e004";
import { rung as d1e005 } from "./rungs/d1e005";
import { rung as d1e006 } from "./rungs/d1e006";
import { rung as d3a004 } from "./rungs/d3a004";
import { rung as d3e001 } from "./rungs/d3e001";
import { rung as d3e002 } from "./rungs/d3e002";
import { rung as d3e003 } from "./rungs/d3e003";
import { rung as d3e004 } from "./rungs/d3e004";
import { rung as d3e005 } from "./rungs/d3e005";
import { rung as d4m001 } from "./rungs/d4m001";
import { rung as d4m002 } from "./rungs/d4m002";
import { rung as d4e001 } from "./rungs/d4e001";
import { rung as d4mmiss } from "./rungs/d4mmiss";
import { rung as d4mines } from "./rungs/d4mines";
import { rung as opening } from "./rungs/opening";
import { rung as flutepzl } from "./rungs/flutepzl";
import { rung as dagrpzl } from "./rungs/dagrpzl";
import { rung as mskpzl } from "./rungs/mskpzl";
import { rung as mesapzl } from "./rungs/mesapzl";
import { rung as endpzl } from "./rungs/endpzl";
import { rung as bldstpz } from "./rungs/bldstpz";
import { rung as ending } from "./rungs/ending";

/**
 * Day 1, night: the Mayor's wife takes you home.
 *
 *   1. `D1E_006` is taken with her at (831,1665) — the player's own cell,
 *      walking at them. Clicking her runs `MWIFE.PUP runyoself()`, which with
 *      `actorset("mwife") = "town"` and `mwifephase = 0` falls into
 *      `firststreet()`.
 *   2. `firststreet()` offers three replies. **"I'm sorry." (101)** leads to
 *      `dinner()`; "I'm thirsty." (103) sets `mwifephase = 1` and is the
 *      brush-off, which strands the rung.
 *   3. `dinner()` offers two. **"Please." (101)** does the work:
 *      `townscene = "scene j9"`, `closesetfile()`, `opensetfile("mayhall.set")`.
 *      It is the ONLY way into the house that night — `NITE.SET/0177
 *      lockmayor()` returns true all day 1, and `debugging` is 0 in every
 *      shipped save, so the gate on Scene J9 simply does not open.
 *   4. Two presses to `MAYHALL` Scene C3 facing west, planned rather than typed.
 *   5. The study door: `mousedown` inside `pointinstudy` sets the door prop
 *      (`lockstudy()` is false on day 1 with `mariephase = 0`), then `uparrow`
 *      facing west runs `gotointerior("maystudy.set")`.
 *   6. `MAYSTUDY.SET openscene()` is what moves the global the rung is about:
 *      `if day = 1 & mwifephase < 2 → mwifephase = 2`.
 */
export const segment1: Segment = {
  from: "D1E_006",
  to: "D1E_007",
  what: "the Mayor's wife takes you home",
  claims: ["mwifephase", "townscene", "theset"],
  async play(p) {
    // 1. click her as she walks up — an actor is not a rectangle on the screen,
    // so this goes in the way SetViewer.clickActor does
    await clickActor(p, "mwife", "her conversation to open");

    // 2 & 3. the two replies that matter
    const first = await answer(p, 101, "I'm sorry.");
    await answer(p, 101, "Please.", first);
    await p.pump(
      () => (p.session.currentSetFile ?? "").toLowerCase().startsWith("mayhall"),
      "her to let us into the hall",
    );
    await p.pump(() => !p.session.puppet, "her to finish");

    // 4. across the hall to the study door
    const hall = set("MAYHALL");
    // 5. Scene C3 is the cell whose script owns the study door —
    // MAYHALL/0044 `pointinstudy`: x 142..368, y 77..263
    await openDoor(p, [142, 77, 368, 263], "study", "the study door", {
      set: hall, x: 2, z: 2, view: "west",
    });
  },
};

/**
 * Day 1, night: the postcards, and Marie at the gate.
 *
 *   1. `D1E_007` is taken mid-sentence, so the rung starts by letting her finish.
 *   2. The display case is `MAYSTUDY` Scene B3 facing east (`pointincase`), and
 *      clicking it does three things at once: plays `getcards.mov`, adds the
 *      **postcards**, and — on day 1 with `mwifephase < 3` — puts her in the
 *      study, sets `mwifephase = 3` and runs her puppet at you.
 *   3. Her `runyoself()` is a switch on `mwifephase` where each case speaks and
 *      sets the next, so the chain 3 → 10 is one conversation per step. You
 *      cannot leave before it: `MAYSTUDY lockhall()` holds the door shut while
 *      `mwifephase` is 2 or 3.
 *   4. Out through the hall door (Scene B2 facing east, `pointinhall`), then out
 *      of the house, then across the night town to Scene K11.
 *   5. Marie is at the gate. Her **101** sets `mariephase = 3`; 102 sets 4 and
 *      also bumps `mwifephase`, which is a different rung.
 */
/**
 * Day 1, night: dinner at the Mayor's, and Marie at the gate.

 * **The dinner is Marie's conversation, not the wife's.** That took four
 * attempts and a question from Daniel to see. `MWIFE.PUP runyoself()` opens with
 *
 *     if mariephase = 1
 *         puppetspeak ("mwife.14")
 *         exitcode
 *
 * so while the daughter's thread is open the mother only deflects, and pressing
 * for the next course forever leaves `mwifephase` at 4. Talk to Marie instead
 * and her own `runyoself()` sets `mariephase = 2` and `mwifephase = 4` and
 * starts the table talk.
 *
 * What drives the mother's chain from there is `momcomment()`, which is the
 * loveliest thing in this file: it fades the puppet out, swaps `marie.pup` for
 * `mwife.pup`, runs the wife's `runyoself()` — one case, one step — and swaps
 * back. The mother chiming in IS the mechanism. Six of them lie on the path that
 * answers 101 at every question, and 4 + 6 = 10, which is the number the rung
 * ends on. Nothing here counts them; the route answers 101 and the arithmetic
 * takes care of itself.
 *
 * `mariephase = 3` is `mrs3()`'s own 101, the last question of the evening.
 *
 * **NOT ON THE ROUTE — and what is left is the last few feet.** Ten attempts got
 * everything above working against the real engine: the display case, the
 * postcards in hand, her case 3 closing the study and opening `maydine`, both
 * women seated, `mwifephase 4`, `mariephase 1`. A probe run from the table
 * reached `mwifephase 10` and `mariephase 3` — the rung's own numbers — and was
 * shown out into the night town, so the evening IS drivable.
 *
 * What is not settled is how to drive it. Waiting alone does not finish it (the
 * tenth attempt timed out at the table); clicking Marie the way `clickActor`
 * does fails too, because her file opens and closes inside one settle and the
 * "is a puppet open?" test misses it. The probe that got through clicked and
 * then pumped in small steps, checking after each. So the fix is a conversation
 * driver that watches for a puppet ACROSS a wait rather than after one — which
 * is a harness change, and worth making once for all 54 rungs rather than here.
 */
export const segment2: Segment = {
  from: "D1E_007",
  to: "D1E_008",
  what: "the postcards, and Marie at the gate",
  claims: ["mwifephase", "mariephase", "handitem"],
  async play(p) {
    await p.pump(() => !p.session.puppet, "the wife to finish her sentence");

    // 2. the display case — MAYSTUDY/0039 `pointincase`: x 84..436, y 2..263.
    // One click plays getcards.mov, adds the postcards, sets mwifephase = 3 and
    // runs her puppet at you.
    await walkTo(p, set("MAYSTUDY"), { x: 1, z: 2, view: "east" });
    await clickThrough(
      p,
      () => p.fire((84 + 436) / 2, (2 + 263) / 2),
      () => Number(p.session.interp.globals.get("mwifephase") ?? 0) >= 3,
      "the display case",
      { x: 341, y: 160 }, // inside the cards' own box on every frame that asks
    );
    await p.pump(() => !p.session.puppet, "the conversation the case starts");

    /*
     * 3. Dinner. She leads you to the table; the daughter is already there, and
     * it is the daughter who has to be spoken to (see the note above). Four
     * questions, 101 at each: "Enchanted." → "Tell me about her" → "Yes." →
     * "I'd rather go to the hotel."
     */
    /*
     * The case's own script ends `sendtocast ("gang", runpuppet ("mwife.pup"))`,
     * and with a frame source that runs by itself: her case 3 closes the study,
     * opens `maydine`, seats them both and sets `mwifephase = 4`,
     * `mariephase = 1`. Nothing to click — and clicking anyway is worse than
     * useless, because at `mariephase = 1` she only deflects.
     */
    await p.pump(
      () => (p.session.currentSetFile ?? "").toLowerCase().startsWith("maydine"),
      "her to lead us in to dinner",
    );
    await p.pump(() => !p.session.puppet, "the table to settle");
    /*
     * 4. Dinner. Marie's `runyoself()` sets `mariephase = 2` and `mwifephase = 4`
     * and starts the table talk; `momcomment()` — which fades the puppet out,
     * swaps `marie.pup` for `mwife.pup`, runs the mother's `runyoself()` one
     * case, and swaps back — is what walks her chain up. The mother chiming in IS
     * the mechanism, and the six on the 101 path take 4 to the 10 the rung ends
     * on while Marie's last question settles `mariephase = 3`.
     */
    await converse(
      p,
      "marie",
      101,
      () =>
        Number(p.session.interp.globals.get("mwifephase") ?? 0) >= 10 &&
        Number(p.session.interp.globals.get("mariephase") ?? 0) >= 3,
      "the evening",
    );

    /*
     * 5. Out. At `mwifephase = 10` she sends them both to their "goodbye" stars
     * and says goodnight, but nobody shows you the door — you leave the way you
     * came. The dining door is Scene D2 facing west (`pointinhall` 120..388,
     * 20..263) and `MAYDINE lockhall()` held it shut while `mwifephase` was 4,
     * which is why this comes after the evening and not during it.
     */
    await p.pump(() => !p.session.puppet, "the goodnights");
    await openDoor(p, [120, 20, 388, 263], "hall2", "the dining door", {
      set: set("MAYDINE"), x: 3, z: 1, view: "west",
    });
    await p.pump(
      () => (p.session.currentSetFile ?? "").toLowerCase().startsWith("mayhall"),
      "the hall",
    );

    // …and out of the house: MAYHALL Scene C4 facing south, `pointinfront`
    await openDoor(p, [165, 58, 356, 263], "front", "the front door", {
      set: set("MAYHALL"), x: 2, z: 3, view: "south",
    });
    await p.pump(
      () => (p.session.currentSetFile ?? "").toLowerCase().startsWith("nite"),
      "the night town",
    );

    // 5. across the night town to where the original stood when it saved
    await walkTo(p, set("NITE"), { x: 10, z: 10, view: "south" });
  },
};

/** the route, in the order the thread was played */
/** the route, in the order the thread was played */
/** the route, in the order the thread was played */
/**
 * Day 1, night: the hotel key, and the street outside it.
 *
 * Twenty seconds of the original's play, and it is all one cell and its inside.
 * `NITE` Scene G5 is the hotel's own doorstep, and it is also the scene whose
 * `openscene()` carries the day's clock forward:
 *
 *     if phase = 7 & currentview () = "west"
 *         phase = 8
 *
 * So the shape of the rung is: in at the door facing east, get what you came
 * for, and come back out facing west.
 *
 *   1. Scene G5 facing east, `pointinhotel` (200,91)-(305,203), through to
 *      `hotlower`.
 *   2. Fear is the clerk. His conversation hands over the **hrkey** and sets
 *      `phase = 7` — `FEAR.PUP/0062` does both in the same breath, along with
 *      putting Trotter and Jenix out in the street for later.
 *   3. Out again: the lobby's own Scene A1 facing west, `pointindoor`
 *      (128,73)-(394,262). The exit is `gototown (currentview ())` — it puts you
 *      back in the street facing the way you left — so leaving westward is what
 *      re-opens G5 facing west, and that is what turns 7 into 8. Leave facing any
 *      other way and the phase simply does not move.
 */
export const segment3: Segment = {
  from: "D1E_008",
  to: "D1E_008B",
  what: "the hotel key, and the street outside it",
  claims: ["phase", "handitem"],
  async play(p) {
    await p.pump(() => !p.session.puppet, "whatever was being said");

    // 1. in at the hotel door
    await openDoor(p, [200, 91, 305, 203], "hotel", "the hotel door", {
      set: set("NITE"), x: 6, z: 4, view: "east",
    });
    await p.pump(
      () => (p.session.currentSetFile ?? "").toLowerCase().startsWith("hotlower"),
      "the hotel lobby",
    );

    // 2. the clerk, the key, and the day's phase
    await converse(
      p,
      "fear",
      101,
      () => Number(p.session.interp.globals.get("phase") ?? 0) >= 7,
      "the clerk",
    );
    await p.pump(() => !p.session.puppet, "him to finish");

    // 3. out again, westward, which is what G5's openscene is waiting for
    await openDoor(p, [128, 73, 394, 262], "hotout", "the lobby door", {
      set: set("HOTLOWER"), x: 0, z: 0, view: "west",
    });
    await p.pump(
      () => (p.session.currentSetFile ?? "").toLowerCase().startsWith("nite"),
      "the street outside",
    );

    /*
     * 4. And down the street to where the original stood.
     *
     * G5's `openscene` turns you SOUTH itself — `currentview ("south")` is the
     * line after `phase = 8` — so arriving here facing south is the proof the
     * phase moved, not a stray turn. It also sets `lockevents` and puts Jones out
     * for the fight, which is the next rung's business.
     */
    await p.pump(() => !p.session.puppet, "the street to settle");
    await walkTo(p, set("NITE"), { x: 9, z: 10, view: "west" });
  },
};

/**
 * Day 1, night: the fight in the street, and the beggar afterwards.
 *
 *   1. `NITE` Scene D7's `openscene()` is the trigger, and it is fussy: day 1,
 *      `phase = 8`, arriving FACING SOUTH, and Jones visible. It then turns you
 *      through west to north itself, puts Jones away and stands Dell in front of
 *      you — so the fight is Dell's, whatever the street looked like a moment ago.
 *   2. The fight is `FIGHT.FLT` over `FIGHT.PRP`. A click throws a punch when the
 *      fists are back at `"rest"`, each lands `2 + random (5)` on Dell's 255, and
 *      `fightover` is set when his power goes below zero. So it is a click loop
 *      with the fists' own recovery between blows, and about sixty of them.
 *   3. Jenix is out begging — `FEAR.PUP` put him there when it handed over the
 *      key — and his own conversation is what the rung ends on.
 *
 * `playerpower` is NOT claimed. The original came out of this fight on 24 of 255
 * and every blow Dell throws rolls dice, so the number is a property of one
 * evening rather than of the route: claiming it would make the rung a coin toss.
 *
 * **And `fightover` is not claimed either, which is a finding rather than a
 * convenience.** `FIGHT.FLT`'s `quitfight ()` ends by calling
 * `dumpfightglobals ()`, whose whole body is
 *
 *     dumpglobal dellpower, playerpower, fightover
 *
 * and this port reads `dumpglobal` as DISCARD (engine/src/runtime/interp.ts,
 * where the reasoning is written up). So after the flat closes those three
 * globals do not exist here — and `D1E_009`, taken by `DF.EXE` in 1995 after the
 * same fight, **carries `fightover = 1` and `playerpower = 24`**. The original
 * still had them; we do not.
 *
 * That is exactly what a playthrough against the original's own saves is for,
 * and it is not resolved here: either `dumpglobal` discards less than we think,
 * or it discards later, or the fight's globals are re-created by something after
 * the flat closes. Whichever it is, the shipped save is the evidence.
 */
export const segment4: Segment = {
  from: "D1E_008B",
  to: "D1E_009",
  what: "the fight in the street, and the beggar afterwards",
  claims: ["jenixphase"],
  async play(p) {
    await p.pump(() => !p.session.puppet, "the street to settle");

    // 1. into Scene D7 facing south, which is what starts it
    const over = (): boolean => Number(p.session.interp.globals.get("fightover") ?? 0) === 1;
    const started = (): boolean => Number(p.session.interp.globals.get("playerpower") ?? 0) > 0;
    /*
     * The scene turns you itself — through west to north — and stands Dell in
     * front of you, so "arrived facing south" is true for an instant and gone.
     * Stopping on the turn is stopping on the trigger having fired.
     */
    const squaredUp = (): boolean =>
      (p.session.currentSceneName() ?? "").toLowerCase() === "scene d7" &&
      (p.session.currentViewName() ?? "").toLowerCase() === "north";
    await walkTo(p, set("NITE"), { x: 3, z: 6, view: "south" }, () => squaredUp() || started());
    await p.pump(() => squaredUp() || started(), "Dell to be standing in front of us");

    /*
     * Dell starts it himself. His arrival handler in `GANG.CST` fires when he
     * reaches `town.dell2`: he says his piece through `dell1.pup` and only then
     * `sendtoscene ("scene d7", fight ())`. So there is nobody to click — there
     * is a man walking over — but there IS something to answer: his piece ends on
     * five plaques ("No, who?", "Butch Cassidy?", … "A big fat slob?") and the
     * handler is parked on `puppetevent` until one is chosen. Clicking past lines
     * never gets there.
     */
    await converse(p, null, 101, () => started() || over(), "Dell's opening");
    await p.pump(() => started() || over(), "the fight to start");

    // 2. throw punches until he is down
    for (let i = 0; i < 200 && !over(); i++) {
      p.fire(256, 190);
      await p.tick(25); // the fists' own `stop` loop is 8 ticks
    }
    if (!over()) throw new Error("Dell is still standing");
    /*
     * Winning is not the end of it. `delloses()` plays him going down, the flat
     * closes, the street comes back and only then are events unlocked — the
     * scene sets `lockevents` on the way in and something has to take it off
     * again. Walking before that is pressing keys at a locked world, which fails
     * silently and looks exactly like a route that cannot find its way.
     */
    await p.settle("the fight");
    // the stage FILE, not `currentstage()`: a Dust stage carries its own name and
    // it is not always the filename (`hotplate.flt` is called `"hotplat.flt"`),
    // and what these waits mean is "is that file still open" (#325)
    const onStage = (): string => p.session.stageName.toLowerCase();
    await p.pump(() => !onStage().startsWith("fight"), "the fight flat to close", 200_000);
    await p.settle("the street");

    /*
     * 3. The beggar. Jenix is on `town.extra2` — FEAR.PUP put him out there when
     * it handed over the hotel key — and clicking a character only reaches them
     * from inside `hotdist`, so the walk comes first and the conversation second.
     * The standpoint the original saved from is where he is.
     */
    await p.pump(() => !p.session.puppet, "the street again");
    /*
     * She stands on `town.extra2`, which is cell (8,10) — the far end of the
     * street from where this rung finishes. `realdist (me) < hotdist ()` gates
     * every click on a character, so you have to be beside her, not merely in
     * the same town. The original was: `D1E_008B` was taken at (9,10), one cell
     * away.
     */
    await walkTo(p, set("NITE"), { x: 9, z: 10, view: "west" });
    await converse(
      p,
      "jenix",
      101,
      () => Number(p.session.interp.globals.get("jenixphase") ?? 0) >= 1,
      "the beggar",
    );
    /*
     * `jenixphase = 1` is the first line of her `runyoself()`, so it is true
     * before she has finished asking — and she does ask: "Yes, here is the
     * money." (101) or one of two refusals (102). The rung is not over until she
     * is answered, and the original paid: `playercash` goes down by fifteen over
     * this stretch, which is her five three times.
     */
    await converse(p, null, 101, () => !p.session.puppet, "her question");
    await p.settle("the street");
    await walkTo(p, set("NITE"), { x: 9, z: 6, view: "east" });
  },
};

/**
 * Day 1 into day 2: up to the room, and sleep.
 *
 * A day boundary is a different kind of rung from every other one. Nothing is
 * collected and nobody is persuaded — what happens is that **every character's
 * thread goes back to nought**: `helpphase`, `jonesphase`, `mwifephase 10`,
 * `rubyphase 55`, `trotterphase 5`, all of them to 0, `phase` to 0, `clock` to
 * morning and `day` to 2. So the claim is the reset itself.
 *
 * Buick is on the landing and `D2M_001` is taken with `buick.pup` open, so
 * meeting him is part of the rung. He is also the reason `walkTo` can answer a
 * conversation: **he steps out when you MOVE, not when you arrive**, so a route
 * that waits for him first sees an empty screen, declares him finished, and
 * walks into a conversation that opens behind it — after which every keypress
 * goes to a puppet and the walk fails looking exactly like a broken map.
 *
 * The route is four doors and a bed:
 *   1. `NITE` Scene G5 facing east into the hotel, as segment 3 came out of it.
 *   2. `HOTLOWER` Scene D3 facing north — `hotup.mov` and the stairs. No door
 *      prop on this one; the press is the whole gesture.
 *   3. `HOTUPPER` Scene C4: the room door is clicked from the east and walked
 *      through facing west, which is a quirk worth knowing — the click and the
 *      step do not share a view.
 *   4. `HOTROOM` Scene A1 facing west, and the sign at the foot of the bed
 *      (`pointinsign`, 153,210-512,264) with `cansleep ()` true, which on day 1
 *      it always is. `sleep ()` plays `hotbed.mov` and `advanceday ()` is on the
 *      far side of its action frame.
 */
export const segment5: Segment = {
  from: "D1E_009",
  to: "D2M_001",
  what: "up to the room, and sleep",
  claims: ["day", "clock", "phase", "mwifephase", "rubyphase", "trotterphase"],
  async play(p) {
    await p.pump(() => !p.session.puppet, "the street to settle");

    // 1. in at the hotel door
    await openDoor(p, [200, 91, 305, 203], "hotel", "the hotel door", {
      set: set("NITE"), x: 6, z: 4, view: "east",
    });
    await p.pump(() => room(p).startsWith("hotlower"), "the lobby");

    // 2. the stairs: no door prop, just the press
    await walkTo(p, set("HOTLOWER"), { x: 3, z: 2, view: "north" });
    await p.press("uparrow", "up the stairs");
    await p.pump(() => room(p).startsWith("hotupper"), "the landing");
    /*
     * Buick is waiting on the landing — `D2M_001` is taken with `buick.pup`
     * open, so meeting him is part of the rung and not an interruption of it.
     * Nothing moves while he is talking: a conversation holds the keys, so a
     * route that walks first walks nowhere and blames the map.
     */
    // 104 is "I should leave..." — the only branch out of his `while true`
    // he steps out when you move, so the walk itself answers him (walkTo)

    /*
     * 3. The room door is `pointinrice` (168,50-329,263) on Scene C4 facing WEST
     * — not the `pointindoor` next to it, which is the hall — and `lockrice ()`
     * opens it only once the hotel key is the player's own, which is what
     * segment 3 went and got.
     */
    await openDoor(p, [168, 50, 329, 263], "playroom", "the room door", {
      set: set("HOTUPPER"), x: 2, z: 3, view: "west",
    });
    await p.pump(() => room(p).startsWith("hotroom"), "the room");

    // 4. the bed
    await walkTo(p, set("HOTROOM"), { x: 0, z: 0, view: "west" });
    await clickThrough(
      p,
      () => p.fire((153 + 512) / 2, (210 + 264) / 2),
      () => Number(p.session.interp.globals.get("day") ?? 0) >= 2,
      "the night",
      { x: 256, y: 190 },
    );
    await p.settle("the morning");
  },
};

/** the route, in the order the thread was played */
/**
 * Day 2, morning: down to breakfast, and the day's shopping.
 *
 * **Partly reproduced, and the claims say which part.** The morning runs: out of
 * the room, the landing wait, Laurel, breakfast eaten, and across town into the
 * courthouse, arriving where the original saved. What it does NOT do is the rest
 * of the day's shopping — the original spent $750 that morning and came away
 * with flowers off a grave, a pie out of a box and boots from Jenix (which is
 * why the rung ends with her conversation open). So `playercash` and those
 * items are deliberately not claimed: this rung asserts the spine it plays and
 * not the errands it skips.
 *
 *   1. Out of the room: Scene B1 facing east, `pointinrice` (176,62-339,263),
 *      the door prop "inside", and back to wherever you came in from.
 *   2. Down: Scene D1 facing south, `hotdn.mov`, and into the lobby at D3.
 *   3. Laurel is waiting in the lobby and `HOTLOWER/0040` will not let the day
 *      start without her — it runs her puppet and only afterwards sets
 *      `phase = 2` and calls `breakfast ()`, which is what puts the biscuits and
 *      the sugarcubes within reach (they come off `HOTPLATE.FLT`, the table).
 */
export const segment6: Segment = {
  from: "D2M_001",
  to: "D2M_002",
  what: "down to breakfast, and the day's shopping",
  claims: ["phase", "laurelphase"],
  async play(p) {
    await talkOut(p, LEAVING, "whoever is in the room");

    // 1. out of the room
    await openDoor(p, [176, 62, 339, 263], "inside", "the room door", {
      set: set("HOTROOM"), x: 1, z: 0, view: "east",
    });
    await p.pump(() => room(p).startsWith("hotupper"), "the landing");
    /*
     * Wait on the landing. Coming out of the room lands you on Scene C4 — the
     * `savescene` segment 5 wrote on the way in — and C4's `openscene` on a day-2
     * morning locks events and arms a scene loop. It is that loop's `trigger ()`
     * which sets `phase = 1` and sends Jones over to talk, and `phase = 1` is
     * what the breakfast table downstairs is waiting for. Walk off the cell first
     * and the morning never starts.
     */
    await p.pump(() => Number(p.session.interp.globals.get("phase") ?? 0) >= 1, "the morning to be armed");
    await talkOut(p, LEAVING, "Jones on the landing");

    // 2. down the stairs — a press, no door
    await walkTo(p, set("HOTUPPER"), { x: 3, z: 0, view: "south" });
    await p.press("uparrow", "down the stairs");
    await p.pump(() => room(p).startsWith("hotlower"), "the lobby");

    /*
     * 3. Breakfast. `breakready ()` is a click on the table — from the south or
     * from the west, and only while `phase = 1` — and `HOTLOWER/0040` will not
     * let the day start without Laurel: it runs her puppet first and only
     * afterwards sets `phase = 2` and calls `breakfast ()`.
     */
    // `pointinbreak1` facing south is 149,203-378,261 — a low strip, and the
    // middle of the picture is not in it
    await walkTo(p, set("HOTLOWER"), { x: 1, z: 2, view: "south" });
    for (let i = 0; i < 8 && Number(p.session.interp.globals.get("phase") ?? 0) < 2; i++) {
      p.fire((149 + 378) / 2, (203 + 261) / 2);
      await p.settle("the breakfast table");
      await talkOut(p, LEAVING, "Laurel over breakfast", 2);
    }
    await p.pump(() => Number(p.session.interp.globals.get("phase") ?? 0) >= 2, "the day to start");
    await talkOut(p, LEAVING, "the last of breakfast");

    /*
     * 4. Eat, and get up from the table.
     *
     * `breakfast ()` opens `HOTPLATE.FLT`, and a flat is not a room: the keys do
     * nothing while it is up, which is the same trap the fight flat sets. It is a
     * little sheaf of pictures clicked between — `gotoflat (3)`, `(4)`, `(5)` —
     * and only a click while you are on **flat 4** closes it. The biscuits and
     * the sugarcubes are on those same pictures, so clicking round the table is
     * both how you eat and how you leave.
     */
    // the stage FILE, not `currentstage()`: a Dust stage carries its own name and
    // it is not always the filename (`hotplate.flt` is called `"hotplat.flt"`),
    // and what these waits mean is "is that file still open" (#325)
    const onStage = (): string => p.session.stageName.toLowerCase();
    /*
     * Where to click is in the file, and `dust/tools/flatprops.ts` prints it:
     * every flat carries a click-logic container of named rectangles, each with
     * the script it runs. On this table they are
     *
     *   Flat 1   b 139,81-293,193  → gotoflat (4) + biscuits
     *            s 415,60-506,130  → gotoflat (3) + sugarcubes
     *   Flat 3   s 423,60-499,128  → gotoflat (5) + sugarcubes
     *   Flat 4   — no gotoflat region at all
     *
     * so the meal is: take what is in front of you, and when nothing is left to
     * take, click a bit of picture no region covers. That falls through to the
     * stage's own mousedown, which is the one that ends breakfast — and it only
     * ends it from flat 4, which is where taking the biscuits puts you.
     */
    const owner = (what: string): string =>
      String(
        (p.session.interp.builtins.get("propowner") as ((i: unknown, a: unknown[]) => unknown) | undefined)
          ?.(p.session.interp, [what]) ?? "",
      ).toLowerCase();
    const eaten = (what: string): boolean => owner(what) === "stranger";
    for (let i = 0; i < 24 && onStage().startsWith("hotplate"); i++) {
      if (!eaten("biscuits")) p.fire(216, 137);
      else if (!eaten("sugarcubes")) p.fire(461, 95);
      else p.fire(256, 350); // below every region: the stage hears it, and gets up
      await p.settle("the table");
    }

    if (process.env.DUST_TALK) console.log(`[seg6] stage after table: ${onStage()}`);
    /*
     * 5. Out into the town — it is `town.set` now, not `nite.set`; the two are
     * the same place and different files — and across to the courthouse. Scene
     * G4 facing north, `pointincourt` (160,22-338,214).
     */
    await openDoor(p, [128, 73, 394, 262], "hotout", "the lobby door", {
      set: set("HOTLOWER"), x: 0, z: 0, view: "west",
    });
    await p.pump(() => room(p).startsWith("town"), "the street");
    await talkOut(p, LEAVING, "anyone in the street", 2);
    await openDoor(p, [160, 22, 338, 214], "court", "the courthouse door", {
      set: set("TOWN"), x: 6, z: 3, view: "north",
    });
    await p.pump(() => room(p).startsWith("court"), "the courthouse");
    await talkOut(p, LEAVING, "anyone inside", 2);
    await walkTo(p, set("COURT"), { x: 1, z: 4, view: "south" });
  },
};

/** the route, in the order the thread was played */
/**
 * Day 2, late morning: the store, and up to the saloon's landing.
 *
 * Four doors and a shopkeeper, and every door is the same shape: a click inside
 * a rectangle sets the `door` prop, and an `uparrow` from the right view walks
 * through it.
 *
 *   1. Out of the courthouse — Scene C5 facing south, `pointinrice`, "courtout".
 *   2. Into the store — TOWN Scene G10 facing east, `pointinstore`, "store".
 *   3. Bolivar keeps it. His conversation is what the rung is about
 *      (`bolivarphase` 0 → 2), and he counts your visits in `bolivarcount`.
 *   4. Out again — Scene D2 facing east, `pointindoor`, "shop" — and round to the
 *      saloon's BACK door on Scene D10, because the front one is shut all
 *      morning and the back one wants the HHkey.
 *   5. The stairs are Scene D6 facing west and need no door at all, just the
 *      press, and `salup.mov` plays you up to the landing.
 *
 * Two things move over this rung and are deliberately NOT claimed.
 *
 * `bolivarcount` is a dice roll. His `badnews ()` opens `if random (10) < 6`
 * before it counts anything, so whether the shopkeeper's grumbling advances is a
 * property of the RNG stream rather than of the play — the same reason segment 4
 * does not claim `playerpower`. The original happened to roll it up once.
 *
 * The slot machine is not on the route either: `slot2` and `slot3` move and
 * `playercash` goes down by three, which is the original feeding the machine
 * upstairs. Better left out than quietly asserted.
 */
export const segment7: Segment = {
  from: "D2M_002",
  to: "D2M_003",
  what: "the store, and up to the saloon's landing",
  claims: ["bolivarphase"],
  async play(p) {
    await talkOut(p, LEAVING, "whoever is in the courthouse", 2);

    // 1. out of the courthouse
    await openDoor(p, [147, 37, 377, 263], "courtout", "the courthouse door", {
      set: set("COURT"), x: 2, z: 4, view: "south",
    });
    await p.pump(() => room(p).startsWith("town"), "the street");

    // 2. into the store
    await talkOut(p, LEAVING, "anyone in the street", 2);
    await openDoor(p, [222, 96, 287, 211], "store", "the store door", {
      set: set("TOWN"), x: 6, z: 9, view: "east",
    });
    await p.pump(() => room(p).startsWith("store"), "the store");

    // 3. Bolivar
    await converse(
      p,
      "bolivar",
      101,
      () => Number(p.session.interp.globals.get("bolivarphase") ?? 0) >= 2,
      "the shopkeeper",
    );
    await talkOut(p, LEAVING, "the shopkeeper", 2);

    // 4. out, and along to the saloon
    await openDoor(p, [166, 66, 332, 264], "shop", "the store's own door", {
      set: set("STORE"), x: 3, z: 1, view: "east",
    });
    await p.pump(() => room(p).startsWith("town"), "the street again");
    await talkOut(p, LEAVING, "anyone in the street", 2);
    /*
     * The saloon's front door is shut all morning — `locksaloon ()` is
     * `clock = 1 & day != 4` — so this is the BACK door, on Scene D10 facing
     * east, and `lockback ()` opens it only to whoever is carrying the HHkey.
     * That is what the rung's `handitem` becoming "hhkey" is: not a thing picked
     * up, a key held. It also writes `townscene = "scene g8"` on the way through,
     * which is the value the rung ends on and the clue that this was the door.
     */
    await openDoor(p, [3, 83, 91, 234], "back", "the saloon's back door", {
      set: set("TOWN"), x: 3, z: 9, view: "east",
    });
    await p.pump(() => room(p).startsWith("sallower"), "the saloon");

    // 5. up the stairs — a press, no door
    await talkOut(p, LEAVING, "anyone in the saloon", 2);
    await walkTo(p, set("SALLOWER"), { x: 3, z: 5, view: "west" });
    await p.press("uparrow", "up to the landing");
    await p.pump(() => room(p).startsWith("salupper"), "the landing");
    await talkOut(p, LEAVING, "anyone upstairs", 2);
    await walkTo(p, set("SALUPPER"), { x: 0, z: 0, view: "north" });
  },
};

/**
 * Day 2, still morning: the mask off the Mayor's wall.
 *
 * `MAYDINE.SET/0001` hangs it there — `if day > 1 & propowner ("mask") !=
 * "stranger"` → `sendtoprop ("mask", setupprop ("wall"))` — so on any day after
 * the first it is on the dining-room wall waiting to be taken, and the save
 * agrees: at `D2M_003` the mask is owned by nobody with no position at all, and
 * at `D2M_004` it is the player's and anchored in `maydine`.
 *
 * **NOT ON THE ROUTE — and the missing step is now known.** A probe through it
 * ends with `propowner ("mask") = "stranger"` and `mwifelike = -3`: everything
 * the rung claims, achieved. What it cannot do is walk back into the hall,
 * because the Mayor is standing in the dining room and `MAYDINE/0044`'s keydown
 * checks for him BEFORE it checks the door — every `uparrow` west talks to him
 * and goes nowhere.
 *
 * **He is there because we took the mask.** The mask's own script
 * (`INVEN.PRP/0083`) opens
 *
 *     if propowner ("seed") != "birdcage" & propowner ("apple") != "birdcage"
 *         & propowner (me) = "wall"
 *
 * and that branch is a little scene: the parrot squawks, someone says "newguy",
 * a door opens and shuts, and `sendtoactor ("mayor", setupactor ("dining"))` —
 * the Mayor walks in on you stealing it. **Feed the parrot first and he never
 * comes**, because the branch is skipped entirely.
 *
 * Which is exactly what the rung records beside the mask: `Apple none→birdcage`.
 * The birdcage is an ACTOR, its `offerobject` takes a seed or an apple
 * (`EXTRA.CST/0198`), and the original bought the apple in the store — Bolivar
 * has a `store.apple` standpoint — on the way past. The saves agree from the
 * other end: in BOTH `D2M_003` and `D2M_004` the Mayor is unplaced and invisible.
 * He was never in the room, because they fed the bird.
 *
 * So the missing step is the apple: buy it at the store in segment 7, carry it,
 * and offer it to the birdcage before touching the wall. Sitting through the
 * Mayor is not an alternative — his day-2 conversation ends `addinven
 * ("badge")`, `townscene = "scene g12"`, `opensetfile ("jail.set")`, which is a
 * later rung (`D2E_001` is taken in the jail, holding the badge).
 *
 * Down from the landing, out of the saloon's front door (from the INSIDE it opens
 * — `salout` — the lock is only on the way in), across to the Mayor's, and the
 * wife thinks the less of you for it: `mwifelike` ends at −3, her `changelike ()`
 * floor.
 */
export const segment8: Segment = {
  from: "D2M_003",
  to: "D2M_004",
  what: "the mask off the Mayor's wall",
  claims: ["mwifelike", "townscene"],
  async play(p) {
    await talkOut(p, LEAVING, "anyone upstairs", 2);

    // 1. down: Scene A4 facing east, and `saldn.mov`
    await walkTo(p, set("SALUPPER"), { x: 0, z: 3, view: "east" });
    await p.press("uparrow", "down the stairs");
    await p.pump(() => room(p).startsWith("sallower"), "the saloon floor");

    // 2. out through the front — from inside it is just a door
    await talkOut(p, LEAVING, "anyone in the saloon", 2);
    await openDoor(p, [144, 7, 387, 264], "salout", "the saloon's front door", {
      set: set("SALLOWER"), x: 3, z: 0, view: "east",
    });
    await p.pump(() => room(p).startsWith("town"), "the street");

    // 3. to the Mayor's — the same gate segment 2 came out of, by day
    await talkOut(p, LEAVING, "anyone in the street", 2);
    /*
     * The gate is not a door this morning, it is a person. `lockmayor ()` on day
     * 2 at `clock = 1` with `phase > 1` returns `actorvisible ("mwife")`, and the
     * locked branch of the mousedown does not knock — it does `sendtoactor
     * ("mwife", mousedown (0))`, which is to say the Mayor's wife is standing at
     * her gate and clicking it talks to her. That conversation is where the
     * rung's `mwifelike` goes to −3, the floor her own `changelike ()` clamps to.
     */
    await walkTo(p, set("TOWN"), { x: 9, z: 8, view: "east" });
    for (let i = 0; i < 8 && !room(p).startsWith("mayhall"); i++) {
      p.fire((174 + 335) / 2, (82 + 228) / 2);
      await p.settle("the Mayor's gate");
      /*
       * Be rude to her, deliberately. Her day-2 `twoam ()` is a `while true`
       * whose plaques are 301 (flatter, `changelike (1)`), 201 (insult,
       * `changelike (-1)`) and 103 ("Goodbye, Mrs. Macintosh.", the way out).
       * The rung ends on `mwifelike = -3`, the floor `changelike ()` clamps to,
       * so the original insulted her three times and left. Preferring 301 — as
       * the general `LEAVING` list does, on the theory that a high number is a
       * door — flatters her instead, and the loop never ends.
       */
      const like = (): number => Number(p.session.interp.globals.get("mwifelike") ?? 0);
      await talkOut(p, like() > -3 ? [201, 103] : [103], "the Mayor's wife at her gate", 2);
      const owner = String(
        (p.session.interp.builtins.get("propowner") as ((i: unknown, a: unknown[]) => unknown) | undefined)
          ?.(p.session.interp, ["door"]) ?? "",
      ).toLowerCase();
      if (owner === "mayor") await p.press("uparrow", "in at the gate");
    }
    await p.pump(() => room(p).startsWith("mayhall"), "the hall");

    // 4. through to the dining room, and the mask off the wall
    await talkOut(p, LEAVING, "whoever meets us", 2);
    // the dining door is on Scene C3 facing east — the same cell as the study
    // door one view over, which is a trap this route has already fallen into once
    await openDoor(p, [121, 19, 391, 262], "dine", "the dining-room door", {
      set: set("MAYHALL"), x: 2, z: 2, view: "east",
    });
    await p.pump(() => room(p).startsWith("maydine"), "the dining room");

    /*
     * Feed the parrot BEFORE touching the wall.
     *
     * `MAYDINE`'s openset lays the room out: on any day after the first the mask
     * goes on the wall and, if nobody owns it, the apple goes on the TABLE. Take
     * the apple, give it to the birdcage — an actor, whose `offerobject` takes a
     * seed or an apple — and the mask's own `if propowner ("apple") != "birdcage"`
     * branch is skipped, so the Mayor never walks in and the west door stays a
     * door. Do it the other way round and he is in the room for good: openset
     * puts the apple back to "none" every time you re-enter, so there is no
     * second chance in the same visit.
     */
    await clickProp(p, "apple", "the apple on the table");
    await offerTo(p, "birdcage", "apple", "the parrot");
    await clickProp(p, "mask", "the mask on the wall");

    // 5. back to the hall, where the original saved
    /*
     * Leave at once, and do NOT talk to the Mayor.
     *
     * `MAYDINE/0044`'s keydown checks for him before it checks the door — `if
     * actorset ("MAYOR") = "maydine" & actorvisible ("MAYOR") → runpuppet
     * ("mayor.pup"); exitcode` — so while he is in the room every `uparrow`
     * talks to him instead of leaving. And his day-2 conversation is not a thing
     * to sit through: its one branch ends `sendtoactor ("MAYOR",
     * putdownactor ())`, `addinven ("badge")`, `townscene = "scene g12"`,
     * `opensetfile ("jail.set")` — it pins the badge on you and moves you to the
     * jail, which is a later rung's business (`D2E_001` is taken there). This
     * rung ends in the hall with `townscene` still "Scene J9", so the original
     * took the mask and went straight back out.
     */
    await openDoor(p, [120, 20, 388, 263], "hall2", "the dining door", {
      set: set("MAYDINE"), x: 3, z: 1, view: "west",
    });
    await p.pump(() => room(p).startsWith("mayhall"), "the hall again");
    // whoever followed us out holds the keys until they are answered
    await talkOut(p, LEAVING, "whoever followed us out", 2);
    await walkTo(p, set("MAYHALL"), { x: 2, z: 2, view: "north" });
  },
};

/**
 * Day 2, into the afternoon: the clock turns by walking.
 *
 * This rung looks like the day boundary of segment 5 — `phase` to 0, every
 * character's thread to 0, `townscene` back to "scene g5" — because it IS the
 * same routine. `advanceday ()` bumps the CLOCK when the clock is under 3 and
 * only rolls the day over when it is not, so morning becoming afternoon and
 * night becoming morning are one piece of code.
 *
 * `canadvance ()` on a day-2 morning is `day2items () > 1`, and `day2items`
 * counts the gun, the boots and the bullets — the three the disc's own release
 * notes tell you to get. `D2M_004` has the boots and nothing else, so one more
 * of them is the gate on the entire afternoon: the rung's `TAKE Bullets` is not
 * shopping, it is the key to the clock.
 *
 * They are at the stagecoach depot and the price is the postcards. Handing them
 * over goes cast `offerobject` → `giftpuppet ("dead.pup")` → `gift ()` →
 * `giveinven`, which is what `offerTo` reaches. Then `abe.mov` has to be watched
 * properly: it is interactive with two small boxes — (215,200)-(233,220) on
 * frame 1 and (102,164)-(163,212) on frame 15 — and the whole rest of the
 * picture jumps to an exit with no deal, so the generic nudge at the middle of
 * the screen refuses the trade every time. Ask ONCE and then answer the film:
 * asking again mid-reel is itself a click on the picture, and on frame 15 the
 * picture is the refusal.
 *
 * This rung is also what found the action-frame base
 * (`engine/src/df/mov-v1.ts`): `addinven ("bullets")` is gated on
 * `actionframe (1)`, and under the reading the port used, `abe.mov`'s action
 * frame was one the play could not reach.
 *
 * What is different is how you get there. Nobody sleeps at midday: `TOWN`'s own
 * `openscene` counts down a `scenecounter` that starts at `5 + random (10)`, and
 * when it reaches zero — with nobody standing too near — it arms a scene loop
 * whose `triggerx ()` calls `advanceday ()`. **The afternoon arrives because you
 * walked about**, and how far you walk before it does is a dice roll, which is
 * why this route does laps and watches the clock rather than counting steps.
 */
export const segment9: Segment = {
  from: "D2M_004",
  to: "D2A_001",
  what: "the clock turns by walking",
  claims: ["clock", "phase", "dayrobber"],
  async play(p) {
    await talkOut(p, LEAVING, "anyone in the hall", 2);

    // out of the Mayor's house — Scene C4 facing south, `pointinfront`
    await openDoor(p, [165, 58, 356, 263], "front", "the front door", {
      set: set("MAYHALL"), x: 2, z: 3, view: "south",
    });
    await p.pump(() => room(p).startsWith("town"), "the street");

    /*
     * The bullets first, because the morning cannot end without them.
     * `canadvance ()` on a day-2 morning is `day2items () > 1`, and `day2items`
     * counts the gun, the boots and the bullets — the three the release notes
     * tell you to get. `D2M_004` has the boots and nothing else, so one more is
     * the gate on the whole afternoon.
     *
     * They are at the stagecoach depot, and the price is the postcards: clicking
     * Abe plays `abe.mov` and on its action frame does `addinven ("bullets")`
     * AND `giveinven ("postcards", "limbo")`, which is the rung's own pair of
     * lines. He will not trade until he has been spoken to, though —
     * `if propowner ("postcards") != "dead"` runs `dead.pup` first.
     */
    await talkOut(p, LEAVING, "anyone in the street", 2);
    await openDoor(p, [220, 98, 285, 209], "stage", "the depot door", {
      set: set("TOWN"), x: 6, z: 7, view: "east",
    });
    await p.pump(() => room(p).startsWith("stage"), "the depot");
    const got = (what: string): boolean =>
      String(
        (p.session.interp.builtins.get("propowner") as ((i: unknown, a: unknown[]) => unknown) | undefined)
          ?.(p.session.interp, [what]) ?? "",
      ).toLowerCase() === "stranger";
    /*
     * Hand the postcards over before asking for anything. The click is gated on
     * `propowner ("postcards") != "dead"` — while that holds it only runs
     * `dead.pup` and exits — so the postcards have to be HIS before the trade is
     * on the table, which is an `offerobject`, not a click.
     */
    /*
     * And then the film has to be watched properly. `abe.mov` is interactive and
     * offers two small boxes — (215,200)-(233,220) on frame 1 and
     * (102,164)-(163,212) on frame 15 — with the WHOLE REST of the picture
     * jumping to frame 49, which is an `action 1` exit and no deal. So the
     * generic nudge at the middle of the screen refuses the trade every time,
     * exactly as it did on `getcards.mov`. Click the boxes, in order.
     */
    await walkTo(p, set("STAGE"), { x: 0, z: 0, view: "east" });
    await offerTo(p, "dead", "postcards", "the postcards");
    await talkOut(p, LEAVING, "Abe", 2);
    /*
     * Ask ONCE and then answer the film. Asking again mid-reel is a click on the
     * picture, and on frame 15 the picture is the refusal — which is how a loop
     * that "retries" talked him out of it three times running.
     */
    for (let attempt = 0; attempt < 4 && !got("bullets"); attempt++) {
      p.fire((81 + 194) / 2, (27 + 143) / 2); // ask him
      await p.settle("Abe at the depot");
      for (const [x, y] of [[224, 210], [132, 188]] as [number, number][]) {
        p.fire(x, y);
        await p.settle("the deal");
      }
      // the reel runs on after the last box, and `addinven` is on its far side
      for (let i = 0; i < 40 && !got("bullets"); i++) await p.tick(60);
    }
    if (!got("bullets")) throw new Error("Abe would not part with the bullets");

    // back out — Scene A2 facing west, `pointinrice`, "car"
    await openDoor(p, [176, 63, 336, 261], "car", "the depot door out", {
      set: set("STAGE"), x: 0, z: 1, view: "west",
    });
    await p.pump(() => room(p).startsWith("town"), "the street again");

    /*
     * And now walk. Up and down the one street the town has, turning at each
     * end, until the counter runs out and the afternoon arrives. The pair of
     * cells is arbitrary — any two the graph connects would do — and `toonear
     * (300)` means the trigger will not fire with somebody at your elbow, so
     * covering ground beats pacing on the spot.
     */
    const clock = (): number => Number(p.session.interp.globals.get("clock") ?? 0);
    const ends: [number, number][] = [[6, 3], [6, 12], [6, 5], [4, 11]];
    for (let lap = 0; lap < 12 && clock() < 2; lap++) {
      const [x, z] = ends[lap % ends.length];
      await walkTo(p, set("TOWN"), { x, z, view: "south" }, () => clock() >= 2);
      await excuseUs(p, "anyone who stops us");
    }
    if (clock() < 2) throw new Error("the morning never ended");

    // the afternoon opens where `advanceday ()` puts you; walk to where the
    // original stood when it saved
    await excuseUs(p, "anyone about");
    await walkTo(p, set("TOWN"), { x: 4, z: 11, view: "west" });
  },
};

/** the route, in the order the thread was played */
/**
 * Day 2, afternoon: making it up to the Mayor's wife.
 *
 *   1. She is in the street, not at home. `GANG.CST/0001` sets the afternoon's
 *      cast up with `sendtoactor ("mwife", setupactor ("day2PM"))`, and her own
 *      `setupactor` puts her on `town.jones5` — and then `mwifeidle ()` PACES
 *      her, rolling `random (100) < 6` every 21 ticks to swap `town.jones5` for
 *      `town.jones6` and back. The two stars are 832 units apart and
 *      `hotdist ()` in town is 384 (`GANG.CST/0001`), so there is no standpoint
 *      within reach of both: the route has to ask where she IS.
 *   2. Clicking her runs `MWIFE.PUP` day 2 `runyoself ()`, which at `clock = 2`
 *      with `mwifephase = 0` falls into `twopm ()` — the plaque loop that this
 *      whole rung is.
 *   3. `changelike` clamps at ±3, so `mwifelike` going -3 → 3 (the mask off her
 *      wall in `D2M_003 → D2M_004` is what put it at -3) is six presses of +1.
 *      **And the save says WHICH six.** The first pass offers 101, "No, it's
 *      just that you look so young in this light" — worth +1 and nothing else.
 *      Every pass offers 301, a compliment, worth +1 *and* a call to
 *      `sayflatter ()`, which advances `counter` mod 3 — except the pass that
 *      finds `mwifelike > 1`, which takes the monologue branch instead and
 *      leaves `counter` alone.
 *
 *      So six 301s call `sayflatter ()` five times, and `counter` runs 2 → 1 →
 *      … → 1; 101 and five 301s call it four times, and `counter` lands on 0.
 *      `saybye ()` then reads it: from 0 it speaks and writes 1, from 1 it
 *      speaks and writes 2. `D2A_002` records **`counter` 1** — so the original
 *      pressed 101 once and 301 five times, and that is the sequence below.
 *      It is the one global on this rung that is a fingerprint rather than a
 *      result, which is why it is claimed.
 *   4. "Good day." is 555, and with `mwifelike > 0` it goes through `charm ()`
 *      — three more plaques, all of them the only reply offered — before
 *      `saybye ()` and `mwifephase = 1`.
 *   5. Then walk to where the original was standing when it saved. `D2A_002` is
 *      Scene D11 facing north, which is `town.jones6` at arm's length: the
 *      standpoint she was clicked from, if the pacing had her at that end.
 */
export const segment10: Segment = {
  from: "D2A_001",
  to: "D2A_002",
  what: "six kind words to the Mayor's wife",
  claims: ["mwifephase", "mwifelike", "counter"],
  async play(p) {
    const town = set("TOWN");
    const like = (): number => Number(p.session.interp.globals.get("mwifelike") ?? 0);
    const phase = (): number => Number(p.session.interp.globals.get("mwifephase") ?? 0);

    /*
     * Where she is, by name. `actorstar` reports a SENTINEL mid-walk ("defer"
     * for a straight line, "walkonpath" for an authored route) and only names
     * the destination once she lands, so a walk is asked `walkdest` instead —
     * which is right for a route as well as for a reader, because walking to
     * where she is heading is walking to where she will be.
     */
    const whereIs = (): string => {
      const call = (name: string): string =>
        String((p.session.interp.builtins.get(name) as
          ((i: unknown, a: unknown[]) => unknown) | undefined)?.(p.session.interp, ["mwife"]) ?? "");
      const walking = Number((p.session.interp.builtins.get("iswalk") as
        ((i: unknown, a: unknown[]) => unknown) | undefined)?.(p.session.interp, ["mwife"]) ?? 0) === 1;
      return (walking ? call("walkdest") : call("actorstar")).toLowerCase();
    };
    /** the standpoint beside each end of her beat — both inside `hotdist ()` */
    const BESIDE: Record<string, { x: number; z: number; view: string }> = {
      "town.jones5": { x: 4, z: 6, view: "north" },
      "town.jones6": { x: 3, z: 10, view: "north" },
    };

    // walk to whichever end she is at, and click; if she set off while we
    // walked, the next round follows her rather than clicking a wall
    for (let round = 0; round < 6 && !p.session.puppet; round++) {
      const star = whereIs();
      await walkTo(p, town, BESIDE[star] ?? BESIDE["town.jones6"], () => !!p.session.puppet);
      if (p.session.puppet) break;
      if (whereIs() !== star) continue;
      try {
        await clickActor(p, "mwife", "the Mayor's wife in the street", 8);
      } catch {
        // she moved, or she is still crossing: ask again where she is
      }
    }
    if (!p.session.puppet) throw new Error("the Mayor's wife would not stop in the street");

    /*
     * The plaque loop, answered by the ID the script gave each reply.
     *
     * An ANSWERED list stays framed until `puppetclear ()`, so "are there
     * bevels?" is not "is there a question?" — every pass waits for the
     * signature to CHANGE. And 201 is never pressed: it is the insult, and
     * `mwifelike` below -2 ends the conversation with her walking away.
     */
    let usedFirst = false;
    let asked = "";
    for (let round = 0; round < 30 && phase() === 0; round++) {
      await p.pump(
        () => !p.session.puppet || phase() !== 0 || (question(p) !== "" && question(p) !== asked),
        `a question after ${asked || "she says hello"}`,
      );
      if (!p.session.puppet || phase() !== 0) break;
      asked = question(p);
      const bevels = p.session.puppet?.bevels ?? [];
      const at = (id: number): number => bevels.findIndex((b) => b.id === id);
      let i = -1;
      if (like() >= 3 && at(555) >= 0) i = at(555); // "Good day."
      else if (!usedFirst && at(101) >= 0) i = ((usedFirst = true), at(101));
      else if (at(301) >= 0) i = at(301); // a compliment
      // charm()'s three plaques offer one reply each; 201 is the insult and
      // 55555 is the inventory's own handle, and neither is ever an answer
      else i = bevels.findIndex((b) => b.id !== 201 && b.id !== 55555);
      if (i < 0) throw new Error(`nothing to say to: ${asked}`);
      p.session.puppetCtrl.puppetChoose(i);
      await p.settle(`the reply ${bevels[i].id}`);
    }
    await talkOut(p, LEAVING, "the Mayor's wife", 2);
    if (like() !== 3) throw new Error(`she is not won over — mwifelike ${like()}`);

    // and back to the standpoint the save was taken from
    await walkTo(p, town, { x: 3, z: 10, view: "north" });
  },
};

/**
 * Day 2, afternoon: the jug for Flippo, the pie for the undertaker.
 *
 *   1. **A gift is a plaque, not a gesture.** `INVEN.PRP/0001 addhandbevel ()`
 *      puts "Would you like this jug?" into whatever conversation is open, as
 *      reply **55555**, and `selhandbevel ()` answers it by calling
 *      `gift (handitem)` on that character's boot script. So the route is: pick
 *      the thing up in the panel first (`stdmouse` sets `handitem` from a click
 *      on a prop whose view is "panel"), then go and talk.
 *   2. The newspaper office is TOWN Scene D8 facing west
 *      (`TOWN.SET/0086 pointinpaper`, 213,98-282,211), and `PAPER.SET/0038
 *      openscene ()` starts the conversation FOR you — `currentview () = "south"
 *      & flippophase = 0` sends Flippo his own `mousedown`.
 *   3. `FLIPPO.PUP/0007 gift ()` wants a jug with something in it: `juglevel < 3`
 *      gets two lines and nothing else, and 5 gets `flippogood = 3`,
 *      `juglevel = 0` and `chat ()` — the rung's `juglevel` 5 → 0. `chat ()`
 *      leaves on **700**, and the day-2 loop leaves on **103**, which is what
 *      sets `flippophase = 1`.
 *   4. The undertaker's is TOWN Scene A7 facing south (`TOWN.SET/0040
 *      pointinundertak`), and `UNDERTAK.SET/0036 openscene ()` does the same
 *      favour at `currentview () = "north" & sidephase = 0` — which is exactly
 *      the standpoint `D2A_003` was saved at.
 *   5. `SIDE.PUP/0007 gift ()` is where the **boots** come from: three plaques
 *      after the pie, then `addinven ("boots")` — and `addinven` sets
 *      `handitem`, which is the whole of this rung's `handitem` becoming
 *      "boots". Not a thing picked up: a thing handed over.
 *   6. "Goodbye" (102) sets `sidephase = 1` and the rung is done.
 */
export const segment11: Segment = {
  from: "D2A_002",
  to: "D2A_003",
  what: "the jug for Flippo, the pie for the undertaker",
  claims: ["flippophase", "juglevel", "sidephase", "handitem", "townscene", "theset"],
  async play(p) {
    const town = set("TOWN");
    const num = (n: string): number => Number(p.session.interp.globals.get(n) ?? 0);

    await talkOut(p, LEAVING, "the Mayor's wife", 2);

    // 1. the jug, in hand — a gift has to be held before it can be offered
    await takeInHand(p, "jug", "the jug");

    // 2. in at the newspaper office
    await walkTo(p, town, { x: 3, z: 7, view: "west" });
    await openDoor(p, [213, 98, 282, 211], "paper", "the newspaper office door", {
      set: town, x: 3, z: 7, view: "west",
    });
    await p.pump(() => room(p).startsWith("paper"), "the newspaper office");

    /*
     * `openscene ()` only runs when the SCENE opens, and the entry lands on
     * Scene B2 facing whichever way the set's default is — so if it did not
     * fire, turn south and knock on him directly. Either way what follows is
     * `FLIPPO.PUP` day 2 `twopm ()`, because `day2items ()` is 2 here (the gun
     * is still Bolivar's) and the `chinese ()` branch wants 3.
     */
    if (!p.session.puppet) {
      await walkTo(p, set("PAPER"), { x: 1, z: 1, view: "south" }, () => !!p.session.puppet);
      if (!p.session.puppet) await clickActor(p, "flippo", "Flippo at the press");
    }
    await offerInTalk(p, "jug", "the jug");
    await answer(p, 700, "that's enough talk");
    await answer(p, 103, "Goodbye.");
    await talkOut(p, LEAVING, "Flippo", 2);
    if (num("juglevel") !== 0) throw new Error(`he did not drink it — juglevel ${num("juglevel")}`);

    // 3. out again — Scene B2 facing east, `pointinrice`, "flipout"
    await openDoor(p, [138, 47, 365, 264], "flipout", "the newspaper office door out", {
      set: set("PAPER"), x: 1, z: 1, view: "east",
    });
    await p.pump(() => room(p).startsWith("town"), "the street again");
    await talkOut(p, LEAVING, "anyone in the street", 2);

    // 4. the pie, in hand, and up the street to the undertaker's
    await takeInHand(p, "pie", "the pie");
    await walkTo(p, town, { x: 0, z: 6, view: "south" });
    await openDoor(p, [206, 74, 298, 221], "undertak", "the undertaker's door", {
      set: town, x: 0, z: 6, view: "south",
    });
    await p.pump(() => room(p).startsWith("undertak"), "the undertaker's");

    // 5. Scene A2 facing north is where he says hello by himself
    if (!p.session.puppet) {
      await walkTo(p, set("UNDERTAK"), { x: 0, z: 1, view: "north" }, () => !!p.session.puppet);
      if (!p.session.puppet) await clickActor(p, "side", "Sidewinder at his bench");
    }
    await offerInTalk(p, "pie", "the pie");
    await answer(p, 101, "Guess so. What can you give me?");
    await answer(p, 101, "And so manly, too.");
    await answer(p, 102, "Thanks.");
    await answer(p, 102, "Goodbye");
    await talkOut(p, LEAVING, "Sidewinder", 2);

    // and stand where the save was taken
    await walkTo(p, set("UNDERTAK"), { x: 0, z: 1, view: "north" });
  },
};

/** where `TARGET.CST/0001 initactors ()` puts each standing target, in screen
 *  pixels — `actorxy` on a 2D actor IS its position, so these are click points */
const STANDING: [string, number, number][] = [
  ["bottle1targ", 157, 133], ["bottle2targ", 236, 133], ["bottle3targ", 326, 133],
  ["can1targ", 189, 142], ["can2targ", 287, 140], ["can3targ", 361, 142],
];
/** and the seven pop-up targets, of which exactly one is ever up */
const POPUP: [string, number, number][] = [
  ["target1", 146, 182], ["target2", 186, 196], ["target3", 224, 186], ["target4", 259, 178],
  ["target5", 293, 180], ["target6", 329, 181], ["target7", 371, 187],
];

/**
 * Day 2, afternoon: Leroy's shooting range.
 *
 * The longest rung so far — nine minutes — and the only one that is a game
 * rather than a conversation. What makes it playable at all is that
 * `TARGET.CST/0001 initactors ()` writes every target's SCREEN position down:
 * `actorxy ("can1targ", 189, 142)`. Nothing has to be aimed at; it has to be
 * clicked.
 *
 *   1. Leroy stands at `town.leroy2` — cell (10,10), Scene K11, which is where
 *      `GANG.CST/0002 mousedown` puts you (`currentscene ("scene k11")`) and
 *      where `D2A_004` was saved. One click does the whole opening:
 *      `beforetarget ()` asks to lend you a gun, **"Yes." (101)** takes it
 *      (`saveitem = handitem` — the boots — and `addinven ("gun")`), and the
 *      same handler then sets `bulletcount = 6` and walks you in.
 *   2. `BOOTFILE/0001 mousedown` is what makes a click a SHOT: `handitem = "gun"
 *      & pointinset & currentflat () = "mainpanel"`, and the point not on the
 *      gun itself. Which is also how you reload — a click that IS on the gun
 *      falls through to the prop, and `HOUSE.PRP/0270` opens the cylinder,
 *      takes one bullet per click inside it (x < 248 & y < 255) and shuts on a
 *      click outside.
 *   3. **The save says exactly how it went.** `bulletcount` 6 → 1 with one
 *      reload is 11 shots; `targethitcount` 4 + `canhitcount` 3 +
 *      `bottlehitcount` 3 is 10 hits; and `TARGET.FLT/0005` scores
 *      `10 * 100 / 11 = 90` — not `> 90`, so not "great", and `> 75` with more
 *      than 10 shots, so **"good"**. Six standing targets, four pop-ups, one
 *      shot at nothing.
 *   4. `aftertarget ()` pays for "good" with the harmonica, and because
 *      `handitem` is then "harmonica" it does NOT give the boots back — which
 *      is why `saveitem` is still "boots" in the save.
 *
 * **The four hit counts and `saveitem` are not claimed, and that is a finding,
 * not an omission.** `TARGET.FLT/0005 dumptargetglobals ()` is
 *
 *     dumpglobal hitactor, towerhitcount, birdkillcount
 *     dumpglobal targetshotcount, targethitcount, bottlehitcount, canhitcount, dummyhitcount
 *
 * and this port discards every name on both lines, so by the time the segment
 * is checked they are gone. `D2A_004` carries four of them — `targethitcount` 4,
 * `bottlehitcount` 3, `canhitcount` 3, `dummyhitcount` 0 — and not
 * `targetshotcount`. `TARGET.CST/0001 opencast ()` creates all five together and
 * zeroes them, so neither "all discarded" nor "none discarded" can produce that
 * shape; the shipped engine kept four of the five. The same pattern holds at
 * `LEROY.PUP/0088` (`saveitem` survives, `borrowgun` does not — three saves) and
 * `FIGHT.FLT/0002` (`playerpower` and `fightover` survive `D1E_009`,
 * `dellpower` does not), and TAOOT's `map.stg` closes with
 * `dumpglobal savenorth, saveeast, savewest` while 109 shipped saves carry
 * `saveeast` 78 times and `savewest` 85 and `savenorth` never.
 *
 * "Only the first name is discarded" fits all four — and is refused by a fifth:
 * `bedsit1.set closeset ()` dumps fourteen names across two lines and every one
 * of them is gone from 107 of the 109, present in the 2 saved before the
 * prologue ended. So the rule is not that either, and no reading yet accounts
 * for both. Left as it is, and written down here, rather than changed on
 * evidence that contradicts itself.
 */
export const segment12: Segment = {
  from: "D2A_003",
  to: "D2A_004",
  what: "the shooting range, and the harmonica",
  claims: ["score", "bulletcount", "handitem", "townscene"],
  async play(p) {
    const town = set("TOWN");
    const num = (n: string): number => Number(p.session.interp.globals.get(n) ?? 0);
    const shots = (): number => num("targetshotcount");
    const point = (x: number, y: number): number => Number(ask(p, "makepoint", [x, y]));
    const onGun = (x: number, y: number): boolean =>
      Number(ask(p, "pointinprop", ["gunhand", point(x, y)])) === 1;

    // ---- out of the undertaker's and across town to the range --------------
    await talkOut(p, LEAVING, "Sidewinder", 2);
    await openDoor(p, [99, 0, 477, 262], "underout", "the undertaker's door out", {
      set: set("UNDERTAK"), x: 0, z: 1, view: "west",
    });
    await p.pump(() => room(p).startsWith("town"), "the street again");
    await talkOut(p, LEAVING, "anyone in the street", 2);
    await walkTo(p, town, { x: 10, z: 10, view: "south" });

    // ---- "Yes." is the whole of getting in ---------------------------------
    await clickActor(p, "leroy", "Leroy at the range");
    await answer(p, 101, "Yes.");
    await p.pump(() => room(p).startsWith("target"), "the shooting range");
    await p.settle("the range");

    /*
     * The gun is a PROP, and where it is drawn is the engine's business — so
     * ask it rather than reading a number off the art. `pointinprop` is the
     * same predicate the boot script uses to decide whether a click is a shot
     * or a reload, which makes this the same question, asked once.
     */
    const onGunWhere = (want: (x: number, y: number) => boolean): [number, number] => {
      for (let y = 2; y < 384; y += 2) {
        for (let x = 2; x < 512; x += 2) {
          if (!want(x, y)) continue;
          if (ask(p, "hittest", [point(x, y)]).toLowerCase() === "gunhand") return [x, y];
        }
      }
      throw new Error("the gun is not where the engine says it is");
    };
    const reload = async (): Promise<void> => {
      /*
       * Let the gun come down first. `HOUSE.PRP/0270 mousedown` answers only
       * from "idle" or "reload", and a shot leaves it in `recoil` → `smoke` →
       * `relax`, a chain of loops that walks the barrel back down over a couple
       * of seconds. Clicking into that is clicking nothing.
       */
      await p.pump(
        () => String(ask(p, "propview", ["gunhand"])).toLowerCase() === "idle",
        "the gun to come down",
      );
      // a click ON the gun opens the cylinder…
      const [ox, oy] = onGunWhere(() => true);
      p.fire(ox, oy);
      await p.settle("the cylinder");
      if (String(ask(p, "propview", ["gunhand"])).toLowerCase() !== "reload") {
        throw new Error(`the cylinder did not open — gunhand is "${ask(p, "propview", ["gunhand"])}"`);
      }
      // …one click per bullet inside it (`clickinchamber`: x < 248 & y < 255)…
      const [cx, cy] = onGunWhere((x, y) => x < 248 && y < 255);
      for (let i = 0; i < 12 && num("bulletcount") < 6; i++) {
        p.fire(cx, cy);
        await p.settle("a bullet");
      }
      if (num("bulletcount") !== 6) throw new Error(`only ${num("bulletcount")} in the gun`);
      // …and a click on the gun but outside it shuts the cylinder again
      const [sx, sy] = onGunWhere((x, y) => x >= 248 || y >= 255);
      p.fire(sx, sy);
      await p.settle("the cylinder shut");
    };
    const fireAt = async (x: number, y: number, what: string): Promise<void> => {
      if (num("bulletcount") === 0) await reload();
      const before = shots();
      p.fire(x, y);
      await p.settle(`a shot at ${what}`);
      if (shots() === before) throw new Error(`the gun did not fire at ${what}`);
    };

    // ---- six that stand still ----------------------------------------------
    for (const [name, x, y] of STANDING) {
      const was = num(name.startsWith("can") ? "canhitcount" : "bottlehitcount");
      for (let i = 0; i < 3 && num(name.startsWith("can") ? "canhitcount" : "bottlehitcount") === was; i++) {
        await fireAt(x, y, name);
      }
    }
    if (num("canhitcount") !== 3 || num("bottlehitcount") !== 3)
      throw new Error(`cans ${num("canhitcount")}, bottles ${num("bottlehitcount")}`);

    /*
     * Reload BEFORE going after the moving ones, not when the gun runs dry.
     * A reload is eight clicks and the ticks that go with them, and a pop-up
     * target is only "idle" for five to fifteen — so reloading between choosing
     * a target and shooting at it is shooting at where one just was.
     */
    await reload();

    /*
     * …and four that do not. `TARGET.CST/0002` counts a hit only while the pose
     * is "idle" — `raise` takes 5 ticks to get there and `lower` comes 5 to 15
     * after — and its `stop ()` errors out loud if two are ever up at once. So
     * this waits for the one that is up to be ready, and shoots that one.
     */
    for (let round = 0; round < 600 && num("targethitcount") < 4; round++) {
      const up = POPUP.find(([name]) =>
        Number(ask(p, "actorvisible", [name])) === 1 &&
        String(ask(p, "actorpose", [name])).toLowerCase() === "idle");
      if (!up) { await p.tick(2); continue; }
      const [name, x, y] = up;
      const was = num("targethitcount");
      await fireAt(x, y, name);
      if (num("targethitcount") === was) await p.tick(2);
    }
    if (num("targethitcount") !== 4) throw new Error(`targets ${num("targethitcount")}`);

    // one shot at nothing, which is what makes eleven shots and ten hits
    while (shots() < 11) await fireAt(478, 20, "the sky");
    if (shots() !== 11) throw new Error(`${shots()} shots, not 11`);

    // ---- the OK that scores it — target.flt's `exit`, 256,292-340,315 -------
    p.fire(298, 304);
    await p.settle("the score");
    await p.pump(() => room(p).startsWith("town"), "the street again");

    // ---- and back to Leroy for the harmonica -------------------------------
    await clickActor(p, "leroy", "Leroy again");
    await talkOut(p, LEAVING, "Leroy", 2);
    await walkTo(p, town, { x: 10, z: 10, view: "south" });
  },
};

/**
 * Day 2, afternoon: the apple back out of the birdcage.
 *
 *   1. The Mayor's gate is shut, and Marie is standing at it. `TOWN.SET/0177
 *      lockmayor ()` on day 2 at `clock = 2` returns `actorvisible ("marie")`,
 *      and the locked branch does `sendtoactor ("marie", mousedown (0))` — so
 *      clicking the gate is talking to her.
 *   2. **"Will you let me in your house?" (103)** opens `quiz ()`, three
 *      questions of three answers where two are wrong (`111`) and one is right
 *      (`222`): her favourite colour, what her father calls her, her horse. Get
 *      one right and she says so and `putdownactor`s herself off the gate,
 *      which is what unlocks it. Get two wrong and `mariephase = 1` and she is
 *      done with you for the day — and `D2A_005` still has `mariephase = 0`,
 *      so the original got it first time.
 *   3. The apple is in the birdcage, and taking it out is not a gesture at all:
 *      `MAYDINE.SET/0001 openset ()` is `if propowner ("apple") = "birdcage" →
 *      propowner ("apple", "none")` and then, two lines later, `if day > 1 &
 *      propowner ("apple") = "none" → setupprop ("apple", "table")`. **Walking
 *      back into the room puts it back on the table.** Pick it up from there.
 *   4. Then the courthouse, which is the whole reason this rung ends where it
 *      does: `townscene` is only written by `gotointerior ()` and only from the
 *      town, so `"Scene G4"` says the last door the original went through was
 *      the one on cell (6,3).
 *   5. And out to Scene G8, outside the saloon, where the Mayor is pacing.
 *      `GANG.CST/1097 mayoridle ()` arms `hasattention (6)` while
 *      `mayorphase = 0`, so standing there long enough is what starts the
 *      conversation `D2A_005` was saved in the middle of. Nothing clicks him:
 *      he comes.
 *
 * `savescene` and `savedir` are not claimed. They go "scene c4"/"east" →
 * "Scene B1"/"south", and the only writer of that pair is `MAYUPPER.SET/0038`'s
 * keydown into `mayroom.set` — so the original also went upstairs and looked in
 * on the Mayor's bedroom, which changes nothing else in the save and is not on
 * the way to anything.
 */
export const segment13: Segment = {
  from: "D2A_004",
  to: "D2A_005",
  what: "the apple back out of the birdcage",
  claims: ["handitem", "townscene", "loopsound", "mariephase"],
  async play(p) {
    const town = set("TOWN");
    const owner = (name: string): string =>
      ask(p, "propowner", [name]).toLowerCase();

    await talkOut(p, LEAVING, "Leroy", 2);

    // ---- past Marie, who is the lock ---------------------------------------
    await walkTo(p, town, { x: 9, z: 8, view: "east" });
    for (let go = 0; go < 4 && !room(p).startsWith("mayhall"); go++) {
      p.fire((174 + 335) / 2, (82 + 228) / 2);
      await p.settle("the Mayor's gate");
      if (p.session.puppet) {
        await answer(p, 101, "whichever of her three openings is offered");
        await answer(p, 103, "Will you let me in your house?");
        await answer(p, 222, "the right answer to her quiz");
        await talkOut(p, LEAVING, "Marie at the gate", 2);
      }
      p.fire((174 + 335) / 2, (82 + 228) / 2);
      await p.settle("the Mayor's gate again");
      if (owner("door") === "mayor") await p.press("uparrow", "in at the gate");
    }
    await p.pump(() => room(p).startsWith("mayhall"), "the hall");

    // ---- the dining room, where the apple is back on the table -------------
    await talkOut(p, LEAVING, "whoever meets us", 2);
    await openDoor(p, [121, 19, 391, 262], "dine", "the dining-room door", {
      set: set("MAYHALL"), x: 2, z: 2, view: "east",
    });
    await p.pump(() => room(p).startsWith("maydine"), "the dining room");
    await clickProp(p, "apple", "the apple, back on the table");
    if (owner("apple") !== "stranger") throw new Error(`the apple is ${owner("apple")}'s`);

    // ---- out of the house: the dining door, then the front door ------------
    await openDoor(p, [120, 20, 388, 263], "hall2", "the dining door", {
      set: set("MAYDINE"), x: 3, z: 1, view: "west",
    });
    await p.pump(() => room(p).startsWith("mayhall"), "the hall again");
    await talkOut(p, LEAVING, "whoever followed us out", 2);
    // MAYHALL/0045 — Scene C4 facing south, `pointinfront`, and `gototown`
    await openDoor(p, [165, 58, 356, 263], "front", "the Mayor's front door", {
      set: set("MAYHALL"), x: 2, z: 3, view: "south",
    });
    await p.pump(() => room(p).startsWith("town"), "the street");

    // ---- the courthouse, in and straight out -------------------------------
    await excuseUs(p, "anyone in the street");
    await openDoor(p, [160, 22, 338, 214], "court", "the courthouse door", {
      set: town, x: 6, z: 3, view: "north",
    });
    await p.pump(() => room(p).startsWith("court"), "the courthouse");
    // COURT/0048 — Scene C5 facing south, `pointinrice`, "courtout"
    await openDoor(p, [147, 37, 377, 263], "courtout", "the courthouse door out", {
      set: set("COURT"), x: 2, z: 4, view: "south",
    });
    await p.pump(() => room(p).startsWith("town"), "the street again");

    // ---- and stand outside the saloon until the Mayor comes over -----------
    await walkTo(p, town, { x: 6, z: 7, view: "south" });
    await p.pump(() => !!p.session.puppet, "the Mayor to come over", 20_000);
    await walkTo(p, town, { x: 6, z: 7, view: "south" });
  },
};

/** the route, in the order the thread was played */
export const SEGMENTS: Segment[] = [
  opening,
  segment1, segment2, segment3, segment4, segment5, segment6, segment7,
  segment8, segment9, segment10, segment11, segment12, segment13,
  // ...and from here on, one rung per file — see rungs/README.md
  d2a006, d2a007, d2aruby, d2a008, d2a009, d2e001, d2e002, d2e003,
  d2e004, d3m001, d3m002, d3m003, d3mclas,
  d3m004, d3m005, d3a001, d3a002, d3a003,
  // ...and the five the route skipped at the very start
  d1e002, d1e003, d1e004, d1e005, d1e006,
  d3a004, d3e001, d3e002, d3e003, d3e004,
  d3e005, d4m001, d4m002, d4e001, d4mmiss,
  d4mines, flutepzl, dagrpzl, mskpzl, mesapzl,
  endpzl, bldstpz, ending,
].filter((s): s is Segment => s !== null);
