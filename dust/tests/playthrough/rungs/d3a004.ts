import { ask, clickActor, openDoor, room, set, talkOut, type Segment } from "../route";

/**
 * Day 3, afternoon: the Doc takes the mixture, and Nate Trotter's flute.
 *
 * `D3A_003` stands in the doctor's outer room at `docphase = 6` with the RX in
 * hand, and `D3A_004` stands in the room beyond it at `docphase = 9` with the
 * flute. Three steps of `DOC.PUP/0041 threepuzzle ()` separate them, and the
 * middle one is a locked door — which is what makes this rung longer than the
 * two clicks it looks like.
 *
 *   1. **The mixture.** `GANG.CST/0555 mousedown` runs `doc.pup` when the Doc is
 *      inside `hotdist ()`; he is seated at `doctor1.doc` (316, 108), which is
 *      the player's own cell. `threepuzzle ()`'s `case 6` speaks three lines,
 *      offers one plaque — "I'm sure it is.", **101** — and then
 *      `dumpinven ("RX")`, `putdownactor ()` and `docphase = 7`. That is the
 *      whole of the gift: the RX is not OFFERED, it is taken off you by the
 *      script, which is why the save reads `RX@stranger → RX@none` with no
 *      `offerobject` anywhere in `DOC.PUP`.
 *   2. **Out into the street, and straight back in.** `case 6` leaves the Doc
 *      invisible and the rice curtain shut: `DOCTOR1.SET/0036 lockrice ()`
 *      returns true on `docphase = 7` by name, and true again for as long as
 *      `actorset ("doc") = "doctor1"` with `docphase` neither 8 nor 10 —
 *      `putdownactor ()` hides him but does not move him out of the set. So at
 *      `docphase = 7` the curtain only knocks and the Doc cannot be clicked,
 *      and the ONLY thing that puts him back on his feet is
 *      `DOCTOR1.SET/0001 openset ()`, which re-seats him whenever the set file
 *      is opened at `day = 3` and `docphase <= 9`. Opening the set file means
 *      leaving it: out through `pointindoor` (204,67-321,263) facing east, which
 *      sets the `door` prop to "doc2" and whose `uparrow` is
 *      `gototown (currentview ())` — `town.set` and not `nite.set`, because
 *      `clock` is 2 — and back in at Scene G5 through `pointindoctor`
 *      (215,85-299,225). `townscene` is already "Scene G5", so `gotointerior ()`
 *      rewrites it with the value it already had and the round trip leaves no
 *      mark on it; it is claimed here for exactly that reason.
 *   3. **The second word.** With the Doc back, one more click reaches
 *      `threepuzzle ()`'s empty `case 7`, which falls into `case 8`: one line,
 *      `doc.43`, and `docphase = 8`. No plaques, so "a conversation is open" is
 *      not the outcome to wait for and `clickActor` is handed the phase.
 *   4. **Through the rice curtain.** At `docphase = 8` both arms of
 *      `lockrice ()` are false, so `pointinrice` (190,65-307,261) facing west
 *      sets the `door` prop to "doc1". The `uparrow` after it is the interesting
 *      one: `DOCTOR1.SET/0036 keydown` runs `runpuppet ("doc.pup")` INSTEAD of
 *      walking through, for every `docphase` except 8 and 10 — the same test
 *      the lock uses. At 8 it falls past that to
 *      `gotointerior ("doctor2.set")`.
 *   5. **Trotter.** `DOCTOR2.SET/0001 openset ()` is `if day = 3 & clock = 2 &
 *      docphase = 8` — it seats Trotter at `doctor2.trot` and forces
 *      `currentview ("south")`, which is the standpoint `D3A_004` was taken at.
 *      Nothing clicks him: `GANG.CST/0670 trotteridle ()` calls
 *      `hasattention (4)` while `day = 3 & clock = 2 & trotterphase = 0`, and
 *      `GANG.CST/0001 hasattention ()` fires `mousedown` at the actor itself
 *      once the player has stood inside `hotdist ()` for four seconds. So the
 *      rung waits for him rather than reaching for him. `TROTTER.PUP/0075
 *      threepm ()` then speaks five lines, `addinven ("flute")` — which is what
 *      makes `handitem` "flute" — sets `docphase = 9`, and offers "Thanks Nate."
 *      (**101**), whose arm ends in `putdownactor ()` and `trotterphase = 1`.
 *      Both are in the save, and the save has Trotter invisible at
 *      `doctor2.trot`, which is what `putdownactor ()` leaves behind.
 *
 * `theset` is claimed because it is not what its name suggests. It is written
 * only by `GANG.CST/0001 stdactor (who)` — `theset = actorset (who)` — so it
 * records the set of the last actor anybody stood up, not the room the player is
 * in. It reads "doctor2" at the far end because Trotter's
 * `setupactor ("inner")` was the last `stdactor` of the rung.
 *
 * **Not claimed, and this is the interesting part of the diff.** Seven phase
 * globals move 0 → 1 across this rung and only `trotterphase` belongs to it.
 * `deadphase`, `dellphase`, `fearphase`, `laurelphase`, `mariephase` and
 * `mwifephase` each have exactly one kind of source in the corpus — the closing
 * plaque of that character's own day-3 conversation, `DEAD.PUP/0005 threepm ()`
 * case 104, `MWIFE.PUP/0076 threepm ()` case 103, and so on. There is no script
 * that sets them together. What the rest of the save says is that the original
 * player spent step 2's enforced trip outside on a round of the town: Dell has
 * arrived at `jail.dell1` (`JAIL.SET/0001 openset ()`), Marie at `store.oona`
 * (`STORE.SET/0001 openset ()`, `day = 3 & clock = 2`), Laurel at
 * `hotlower.laurel` — three interiors whose set files were opened — and
 * `countsix` has been created and left at 2, which only
 * `MWIFE.PUP/0076 runyoself ()` does, and only survives its own
 * `dumpglobal countsix` if the conversation left through an `exitcode`, which
 * case 103 is. That is six errands and a locked door's worth of waiting, not a
 * script; reproducing it would be inventing a route rather than reading one, so
 * this rung does the puzzle and leaves the errands alone.
 *
 * Also not claimed: `attentionspan` and `vitalframe`, both frame stamps
 * (`hasattention ()` and `INVEN.PRP/0001 addinven ()` respectively), and
 * `tumx2`/`tumy2` — the tumbleweed's next crossing, re-rolled in
 * `HOUSE.PRP/0174 waithide ()`. Its `kickme` loop is in both saves' loop tables:
 * a prop loop is not stopped by a set change, so the weed goes on blowing across
 * the street while the player is indoors.
 */
export const rung: Segment = {
  from: "D3A_003",
  to: "D3A_004",
  what: "the Doc takes the mixture, and Trotter's flute",
  claims: ["docphase", "trotterphase", "handitem", "theset", "townscene"],
  async play(p) {
    const doctor1 = set("DOCTOR1");
    const town = set("TOWN");
    const num = (n: string): number => Number(p.session.interp.globals.get(n) ?? 0);

    // 1. the Doc takes the RX — `case 6`, one plaque, then `docphase = 7`
    await clickActor(p, "doc", "the Doc, with the mixture", 20, () => !!p.session.puppet);
    await talkOut(p, [101], "the Doc taking the mixture");
    if (num("docphase") !== 7) throw new Error(`docphase is ${num("docphase")}, not 7`);

    /*
     * 2. out and back in. Not a detour: `lockrice ()` is true at `docphase = 7`
     * and the Doc is invisible, so there is nothing in this room to click and
     * nothing to open. `openset ()` is the only thing that stands him up again,
     * and it runs when the set file is opened.
     */
    await openDoor(p, [204, 67, 321, 263], "doc2", "the doctor's door out", {
      set: doctor1, x: 1, z: 0, view: "east",
    });
    await p.pump(() => room(p).startsWith("town"), "the street");
    await openDoor(p, [215, 85, 299, 225], "doctor", "the doctor's door", {
      set: town, x: 6, z: 4, view: "west",
    });
    await p.pump(() => room(p).startsWith("doctor1"), "the doctor's again");
    await p.pump(() => ask(p, "actorvisible", ["doc"]) === "1", "openset () to re-seat the Doc");

    // 3. `case 7` falls into `case 8` — one spoken line and no plaque, so the
    //    phase is the only thing that can say the click landed
    await clickActor(p, "doc", "the Doc, a second time", 20, () => num("docphase") === 8);

    // 4. now the curtain opens, and the `uparrow` walks through instead of
    //    running `doc.pup` again
    await openDoor(p, [190, 65, 307, 261], "doc1", "the rice curtain", {
      set: doctor1, x: 1, z: 0, view: "west",
    });
    await p.pump(() => room(p).startsWith("doctor2"), "the back room");

    /*
     * 5. and wait for Trotter. `hasattention (4)` is a four-second timer on
     * standing near him, not a click: reaching for him with `clickActor` would
     * be a gesture the original never made, and the `until` here is the pair of
     * globals `threepm ()` writes on its way out.
     */
    await talkOut(p, [101], "Trotter and the flute");
    if (num("docphase") !== 9 || num("trotterphase") !== 1) {
      throw new Error(`docphase ${num("docphase")}, trotterphase ${num("trotterphase")}`);
    }
  },
};
