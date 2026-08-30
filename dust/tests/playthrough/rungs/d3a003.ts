import { ask, clickActor, openDoor, room, set, walkTo, type Segment } from "../route";

/**
 * Day 3, afternoon: Watson in the street, and the eight bottles.
 *
 * The rung is one puzzle with an errand in front of it. The bottles are a prop
 * in the apothecary — `HOUSE.PRP/0678 setupprop ("apoth")`, placed by
 * `APOTH.SET/0001 openset ()` whenever `day = 3 & clock = 2` — but its
 * `mousedown` opens nothing until `puzzletime ()` is true, and `puzzletime ()`
 * is `day = 3 & clock = 2 & (docphase = 3 | docphase = 4)`. `D3A_002` reads
 * `docphase = 2`, so the shelf is dead when the rung starts and the first move
 * is to go and make it live.
 *
 * `docphase = 3` has exactly one source in the corpus: `WATSON.PUP/0084
 * onstreet ()`, the day-3 afternoon arm of Watson's `runyoself ()`. Its first
 * branch is `if docphase = 2` — five spoken lines, Watson sent off to
 * `town.leroy1`, and `docphase = 3`. That is the errand, and it is why the rung
 * leaves the apothecary before it can use it.
 *
 *   1. **Out of the apothecary.** APOTH is a three-cell corridor: the set's
 *      transition table has standpoints only on row `z = 1`, so Scene A2, B2, C2
 *      are the whole of it. `APOTH.SET/0041` owns C2 — `pointindoor`
 *      (163,33-336,263) facing east sets the `door` prop to "pharm", and the
 *      `uparrow` after it runs `gototown ("west")`, which
 *      (`NEW.FLT/0001`) re-enters `town.set` at whatever `townscene` holds.
 *      `D3A_002` holds "Scene G9", the cell in front of the apothecary.
 *   2. **Watson, in the street.** G9 stands the player at (1664, 2176); Watson
 *      is placed at `town.marie1` — (1736, 1980) in `D3A_002` — 209 units away
 *      against `GANG.CST/0001 hotdist ()`, which is 384 in the town. Watson's
 *      own `mousedown` (`GANG.CST/1267`) runs `watson.pup` directly rather than
 *      through `walktopuppet ()`, so being inside `hotdist ()` is the whole
 *      gate: no row-or-column rule applies to him. `onstreet ()` at
 *      `docphase = 2` is five `puppetspeak` lines and no plaques, so "a
 *      conversation is open" is the wrong success test and `clickActor` is
 *      handed the phase instead.
 *   3. **Back in.** `TOWN.SET/0132` owns G9: `pointinapoth` (218,94-286,205)
 *      facing east, `lockapoth ()` false at day 3 / clock 2, and the `uparrow`
 *      runs `gotointerior ("apoth.set")` — which writes `townscene =
 *      currentscene ()` on the way through, pinning it back to "scene g9".
 *   4. **The shelf.** `setupprop ("apoth")` puts the bottles at (128, 214, 75)
 *      and the prop's `mousedown` wants `realdist (me) < 500`. Scene A2 is at
 *      (128, 384), 170 away, and it is also the one standpoint the shelf is
 *      DRAWN from head-on — a scan of `hittest ()` finds it there facing north
 *      and nowhere else except the far edge of B2 facing west. Where the sprite
 *      is is asked of the engine rather than read off the art, the same way
 *      `segment12` finds the gun. The click runs `dodrugs ()`, which resets
 *      `bottles` to "0,0,0,0,0,0,0,0," and opens `drug.flt` over the set.
 *   5. **Five bottles.** The flat's click regions are ordinary dispatched
 *      hotspots — no `button ()` poll anywhere in `DRUG.FLT`, so these are fired
 *      clicks and not `hold ()`s. Each one is `drugmovie (name, posit)`, which
 *      reads word `posit` of `bottles`, adds one (capped at 9), plays a film and
 *      lands on "flat 1"; both flats carry the same twelve regions, so the
 *      coordinates keep working after the first. `drugok ()` compares against
 *      "1,1,0,0,1,0,1,1,", so the five to take are 1 cactus, 2 rose, 5 shroom,
 *      7 armwort, 8 pinto — once each, because a second click makes that word a
 *      "2" and the only way back is `drugretry ()`. Each click waits on its own
 *      word reading "1", which is what makes "once each" a check rather than an
 *      intention. Rectangles are `flatprops.ts drug.flt`.
 *   6. **Accept.** The "accept" region, 53,311-167,336. `drugok ()` re-degs the
 *      RX, re-adds it to the inventory, and — because `bottles` matches — sets
 *      `docphase = 6` before closing the stage file and putting `new.flt` back.
 *      6 and not 7: `DOC.PUP/0041 threepuzzle ()`'s `case 6` is the scene where
 *      the Doc takes the mixture, and this rung stops on his doorstep.
 *   7. **Up the street and in at the doctor's.** `TOWN.SET/0128` owns G5:
 *      `pointindoctor` (215,85-299,225) facing west, then
 *      `gotointerior ("doctor1.set")` — which writes `townscene = "scene g5"`,
 *      the second string in the diff. `DOCTOR1.SET/0001 openset ()` seats the
 *      Doc in the outer room (`day = 3` and not `docphase > 9`), and the set
 *      opens at Scene B1 facing west, which is the standpoint `D3A_003` was
 *      taken at. Nothing clicks the rice curtain: `DOCTOR1.SET/0036 lockrice ()`
 *      returns true while the Doc is in "doctor1" and `docphase` is neither 8
 *      nor 10, and `GANG.CST/0555 docidle ()` only calls `hasattention` at
 *      `docphase = 0`, so he neither opens nor interrupts.
 *
 * `loopsound` is claimed because it is the standpoint said another way.
 * `TOWN.SET/0137 dayfxs ()` runs on `scene g14` every two ticks and picks the
 * nearest of four sources within `256 * 2` units. From G9 the saloon at Scene G8
 * is one cell off, 256, which is why the rung STARTS on "outsidesaloon" even
 * though `openset ()` had cleared it a moment before. From G5 the saloon is
 * three cells (768), Chin's at G12 seven, the anvil at J5 three and the saw at
 * B7 more than five — nothing is in range, `fxsound` stays "" and `loopsound`
 * follows it. Walking up the street is the whole of it.
 *
 * **Not claimed**: `tumx2` and `tumy2`, the two bookkeeping numbers left in the
 * diff. They are the far end of the tumbleweed's next crossing, re-rolled inside
 * `HOUSE.PRP/0174 waithide ()` out of four `random ()` draws every time the prop
 * goes out of sight. What they record is where a weed happened to be blowing,
 * not anything the afternoon did.
 */
export const rung: Segment = {
  from: "D3A_002",
  to: "D3A_003",
  what: "Watson in the street, and the eight bottles",
  claims: ["bottles", "docphase", "loopsound", "townscene"],
  async play(p) {
    const apoth = set("APOTH");
    const town = set("TOWN");
    const num = (n: string): number => Number(p.session.interp.globals.get(n) ?? 0);
    const bottles = (): string => String(p.session.interp.globals.get("bottles") ?? "");
    /** word `n` of `bottles`, the way `findword (bottles, ",", n)` reads it */
    const word = (n: number): string => bottles().split(",")[n - 1] ?? "";

    // 1. out of the apothecary — `pointindoor` on Scene C2 facing east
    await openDoor(p, [163, 33, 336, 263], "pharm", "the apothecary door out", {
      set: apoth, x: 2, z: 1, view: "east",
    });
    await p.pump(() => room(p).startsWith("town"), "the street");

    // 2. Watson — no plaques in `onstreet ()`, so the phase is the outcome
    await clickActor(p, "watson", "Watson in the street", 20, () => num("docphase") >= 3);
    if (num("docphase") !== 3) throw new Error(`docphase is ${num("docphase")}, not 3`);

    // 3. back in at G9 — `pointinapoth`, and `gotointerior` re-pins `townscene`
    await openDoor(p, [218, 94, 286, 205], "apoth", "the apothecary door", {
      set: town, x: 6, z: 8, view: "east",
    });
    await p.pump(() => room(p).startsWith("apoth"), "the apothecary");

    /*
     * 4. the shelf, clicked where the engine draws it. `hittest ()` is the same
     * question the boot script asks of every click, so a point it answers
     * "bottles" to is a point that reaches `HOUSE.PRP/0678 mousedown` — which is
     * not something a coordinate copied off a screenshot can promise.
     */
    await walkTo(p, apoth, { x: 0, z: 1, view: "north" });
    const point = (x: number, y: number): number => Number(ask(p, "makepoint", [x, y]));
    let onShelf: [number, number] | null = null;
    for (let y = 4; y < 384 && !onShelf; y += 4) {
      for (let x = 4; x < 512; x += 4) {
        if (ask(p, "hittest", [point(x, y)]).toLowerCase() !== "bottles") continue;
        onShelf = [x, y];
        break;
      }
    }
    if (!onShelf) throw new Error("the bottles are not drawn from Scene A2 facing north");
    p.fire(onShelf[0], onShelf[1]);
    await p.pump(() => bottles() === "0,0,0,0,0,0,0,0,", "dodrugs () to open the flat");
    await p.settle("the dispensary");

    /*
     * 5. one click per bottle, and the wait is on that bottle's own word.
     * `drugmovie ()` fades out, plays its film and fades back in, so the fire
     * cannot be awaited; and it ADDS one rather than setting one, so a click
     * that is repeated because the first looked slow is a click that spoils the
     * mixture.
     */
    const TAKE: [number, number, number, string][] = [
      [1, 19, 75, "cactus"],
      [2, 93, 70, "rose"],
      [5, 297, 69, "shroom"],
      [7, 427, 70, "armwort"],
      [8, 498, 68, "pinto"],
    ];
    for (const [posit, x, y, name] of TAKE) {
      p.fire(x, y);
      await p.pump(() => word(posit) === "1", `the ${name} to go in`);
      await p.settle(`the ${name}`);
    }
    if (bottles() !== "1,1,0,0,1,0,1,1,") throw new Error(`the mixture is "${bottles()}"`);

    // 6. accept — `drugok ()` reads the mixture and writes the phase
    p.fire((53 + 167) / 2, (311 + 336) / 2);
    await p.pump(() => num("docphase") === 6, "drugok () to take the mixture");
    await p.pump(() => room(p).startsWith("apoth"), "the apothecary again");
    await p.settle("the prescription");

    // 7. out, up the street to G5, and in at the doctor's
    await openDoor(p, [163, 33, 336, 263], "pharm", "the apothecary door out", {
      set: apoth, x: 2, z: 1, view: "east",
    });
    await p.pump(() => room(p).startsWith("town"), "the street again");
    await walkTo(p, town, { x: 6, z: 4, view: "west" });
    await openDoor(p, [215, 85, 299, 225], "doctor", "the doctor's door", {
      set: town, x: 6, z: 4, view: "west",
    });
    await p.pump(() => room(p).startsWith("doctor1"), "the doctor's");
    await walkTo(p, set("DOCTOR1"), { x: 1, z: 0, view: "west" });
  },
};
