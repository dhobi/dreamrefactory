import {
  LEAVING, answer, ask, clickActor, openDoor, room, set, talkOut, walkTo, type Segment,
} from "../route";

/**
 * Where `TARGET.CST/0001 initactors ()` puts the six standing targets, in
 * screen pixels — `actorxy` on a 2D actor IS its position, so these are click
 * points. Same six on day 3 as on day 2: `initactors ()` places them
 * unconditionally and only adds `pigtarg` and `gilatarg` behind the `if day`
 * arms at the bottom.
 */
const STANDING: [string, number, number][] = [
  ["bottle1targ", 157, 133], ["bottle2targ", 236, 133], ["bottle3targ", 326, 133],
  ["can1targ", 189, 142], ["can2targ", 287, 140], ["can3targ", 361, 142],
];
/** and the seven pop-up targets, of which `TARGET.CST/0002 stop ()` guarantees
 *  exactly one is ever up */
const POPUP: [string, number, number][] = [
  ["target1", 146, 182], ["target2", 186, 196], ["target3", 224, 186], ["target4", 259, 178],
  ["target5", 293, 180], ["target6", 329, 181], ["target7", 371, 187],
];

/**
 * Day 3, morning: the range again, and then the jail and Chin's.
 *
 * The same shooting gallery `segment12` plays on day 2 — the geometry, the
 * reload and the pop-ups are all worked out there and are not re-argued here —
 * but the numbers are different, day 3's `aftertarget ()` pays differently, and
 * the afternoon in between is three conversations that each set one phase.
 *
 *   1. **The Mayor's wife, still talking.** `D3M_002` is saved inside
 *      `mwife.pup`, and `mwifephase` is already 1, so `MWIFE.PUP/0076`'s
 *      `clock = 1` arm is `sendtopuppet ("day1", brushoff ())` — nothing this
 *      rung wants. `talkOut` leaves it.
 *   2. **Marie, at the Mayor's gate.** She stands on `town.mwife3`, which is
 *      cell (9,8) — Scene J9, the gate cell. `TOWN.SET/0177 lockmayor ()` on
 *      `day = 3 & clock = 1 & phase > 1` returns `actorvisible ("marie")`, and
 *      the locked branch of that cell's `mousedown` is
 *      `sendtoactor ("marie", mousedown (0))`. So the gate IS Marie: clicking
 *      it opens `MARIE.PUP/0060 threeam ()`. Its **104, "Goodbye, Marie."** is
 *      the line that writes `mariephase = 1`; **101** is the quiz and **111**
 *      is the ring, and neither is wanted — `propowner ("ring")` is "ruby"
 *      here, so 111 is not even offered.
 *   3. **Leroy, and "Yes." (101).** He is on `town.leroy2`, cell (10,10), Scene
 *      K11. One click does the whole opening exactly as on day 2:
 *      `LEROY.PUP/0088 runyoself ()` falls through to `beforetarget ()` while
 *      `leroyphase` is 0, 101 takes the gun — and because `propowner ("gun")`
 *      is already "stranger" it takes the `borrowgun = false` arm, which is why
 *      the gun is still the player's in `D3M_003`. `saveitem = handitem` stows
 *      the sugarcubes. Then `GANG.CST/0002 mousedown` sets `bulletcount = 6`,
 *      `currentscene ("scene k11")` and `gotointerior ("target.set")`.
 *   4. **Nine shots, nine hits — and that is why the score goes DOWN.**
 *      `bulletcount` ends at 3 and the gun holds 6, so the number of shots is
 *      `3 + 6 * reloads`: 3, 9, 15. Three cannot produce nine hits, so it is
 *      nine shots with one reload (or fifteen with two and six misses; nine is
 *      the reading taken, being the one the hit counts account for exactly).
 *      `TARGET.FLT/0005` then scores `9 * 100 / 9 = 100` — and "great" wants
 *      `targetshotcount > 15` and "good" wants `> 10`, so a perfect nine falls
 *      through both to `accuracy > 50` and is **"fair"**. Six standing targets
 *      on one cylinder, reload, three pop-ups on the next.
 *   5. **The matchbox.** `aftertarget ()`'s `case 3` arm pays "fair" with
 *      `addinven ("matchbox")` when `propowner ("matchbox") = "none"`, which it
 *      is. `addinven` puts it in hand, and the last lines of `aftertarget ()`
 *      are `if handitem != "harmonica" & handitem != "matchbox" & saveitem != ""
 *      → addinven (saveitem)` — so holding the matchbox is what keeps the
 *      sugarcubes out of the player's hand and `saveitem` reading "sugarcubes"
 *      in the save.
 *   6. **The jail, from Scene G12 facing west.** `TOWN.SET/0135` is one cell
 *      script with two doors — `pointinjail` (122,77-218,230) to the west and
 *      `pointinchin` (218,100-278,204) to the east — and `lockjail ()` on day 3
 *      returns false. The cell is (6,11), which is what puts `"Scene G12"` in
 *      `townscene`: `NEW.FLT/0001 gotointerior ()` writes
 *      `townscene = currentscene ()` on the way out of the town, so the last
 *      town door taken decides it, and the range's own `currentscene
 *      ("scene k11")` means the range cannot be the last one.
 *   7. **The Mayor first, then Dell — that order is a gate.** `JAIL.SET/0001
 *      openset ()` places the Mayor (`day = 3 & clock = 1 & mayorphase = 0`) at
 *      `jail.mayor1`, cell (1,1). `MAYOR.PUP/0074 jail ()` offers one plaque per
 *      round off a `track` counter — 101, 102, 105, 103 in that order — and
 *      **103, "Bye."** is the one that writes `mayorphase = 1` AND `phase = 3`
 *      and walks him to `jail.mayor2`. Then `DELL2.PUP/0081`, whose `clock = 1`
 *      arm is `if mayorphase = 0 → speak and exit` with `dellphase` untouched:
 *      Dell only reaches `dellphase = 1` for somebody who has already been
 *      given his orders. His half is `puppetspeak` with no plaques, so the
 *      click is checked against `dellphase`, not against "a conversation
 *      opened".
 *   8. **Chin's, and Help.** The jail's own way out (`JAIL.SET/0034`, Scene A1
 *      facing west, `pointindoor`, door prop "lock") is `gototown ("east")`,
 *      which lands back on Scene G12 already facing Chin's door.
 *      `CHIN.SET/0001 openset ()` does `setupactor ("shop")` for Help, which is
 *      where `theset` ends up "chin" — `GANG.CST/0001 stdactor ()` writes
 *      `theset = actorset (who)` as a side effect, so it holds whichever cast
 *      entry was set up last, and Chin's is the last set entered. Help lands on
 *      `chin.help3` or `chin.help4`, either side of column 2; cell (1,1) is
 *      within `hotdist ()` (512 outside the four named sets) of both, and his
 *      `GANG.CST/0111 mousedown` is `runpuppet`, not `walktopuppet`, so there
 *      is no row-or-column to share. `HELP2.PUP/0026 threeam ()` exits on
 *      **103, "Goodbye."**, which is `helpphase = 1`.
 *   9. And back to Leroy's cell, facing south, which is where `D3M_003` was
 *      taken.
 *
 * **Not claimed.**
 *
 *   - `targethitcount`, `canhitcount`, `bottlehitcount`, `dummyhitcount` and
 *     `saveitem`. **This port** destroys them, at `TARGET.FLT/0005
 *     dumptargetglobals ()` and at the `dumpglobal borrowgun, saveitem` that
 *     closes `aftertarget ()`; the shipped engine did not. `D3M_003` is itself
 *     the evidence — it runs both teardowns and comes out of them carrying the
 *     four hit counts and `saveitem = "sugarcubes"`, having lost only
 *     `targetshotcount` and `borrowgun`, the FIRST name of each list.
 *     `segment12` writes up why that rule is still open.
 *   - `cardstring`, `playerdowncard`, `dealerdowncard` and `dirgo`. The only
 *     writers of the first three are `SALGAMES.FLT`'s blackjack table and its
 *     `dumpsalgamesglobals ()`, and the only writer of `dirgo` is
 *     `GANG.CST/0984 isaoidle ()` — Isao's lean in the saloon — dumped by his
 *     `putdownactor ()`. So the original also walked through the saloon on this
 *     rung and this route does not; nothing else in the diff records that it
 *     did, and there is no reason to add a detour whose only effect is to
 *     delete four globals.
 *   - `FXCOUNT`, `idlecount`, `tumx2`, `tumy2`. `FXCOUNT` is `CHIN.SET/0001
 *     SOUNDFXS ()`'s theme fade-in counter, so it measures how long the save was
 *     taken after walking into Chin's; `idlecount` is `BOOTFILE/0001 idle ()`'s
 *     mod-4 counter; the two `tum` numbers are the tumbleweed's position.
 */
export const rung: Segment = {
  from: "D3M_002",
  to: "D3M_003",
  what: "nine shots at Leroy's, then the jail and Chin's",
  claims: [
    "score", "bulletcount", "handitem", "phase",
    "mariephase", "mayorphase", "dellphase", "helpphase",
    "townscene", "theset", "leroyphase",
  ],
  async play(p) {
    const town = set("TOWN");
    const num = (n: string): number => Number(p.session.interp.globals.get(n) ?? 0);
    const str = (n: string): string => String(p.session.interp.globals.get(n) ?? "").toLowerCase();
    const shots = (): number => num("targetshotcount");
    const point = (x: number, y: number): number => Number(ask(p, "makepoint", [x, y]));

    // ---- 1. out of the conversation the save was taken in -------------------
    await talkOut(p, LEAVING, "the Mayor's wife", 2);

    // ---- 2. Marie at the gate: the gate click IS her ------------------------
    await walkTo(p, town, { x: 9, z: 8, view: "east" }, () => !!p.session.puppet);
    for (let go = 0; go < 6 && num("mariephase") === 0; go++) {
      if (!p.session.puppet) {
        p.fire((174 + 335) / 2, (82 + 228) / 2);
        await p.settle("the Mayor's gate");
      }
      if (!p.session.puppet) continue;
      await answer(p, 104, "Goodbye, Marie.");
      await talkOut(p, LEAVING, "Marie at the gate", 2);
    }
    if (num("mariephase") !== 1) throw new Error(`mariephase is ${num("mariephase")}`);

    // ---- 3. Leroy, and "Yes." ----------------------------------------------
    await walkTo(p, town, { x: 10, z: 10, view: "south" });
    await clickActor(p, "leroy", "Leroy at the range");
    await answer(p, 101, "Yes.");
    await p.pump(() => room(p).startsWith("target"), "the shooting range");
    await p.settle("the range");
    if (num("bulletcount") !== 6) throw new Error(`the gun holds ${num("bulletcount")}`);

    /*
     * The gun is a PROP and where it is drawn is the engine's business, so ask
     * it rather than reading a number off the art — `pointinprop` is the same
     * predicate `BOOTFILE/0001 mousedown` uses to tell a shot from a reload.
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
      // let the gun come down: `HOUSE.PRP/0270 mousedown` answers only from
      // "idle" or "reload", and a shot leaves it in recoil → smoke → relax
      await p.pump(
        () => String(ask(p, "propview", ["gunhand"])).toLowerCase() === "idle",
        "the gun to come down",
      );
      const [ox, oy] = onGunWhere(() => true);
      p.fire(ox, oy);
      await p.settle("the cylinder");
      if (String(ask(p, "propview", ["gunhand"])).toLowerCase() !== "reload") {
        throw new Error(`the cylinder did not open — gunhand is "${ask(p, "propview", ["gunhand"])}"`);
      }
      const [cx, cy] = onGunWhere((x, y) => x < 248 && y < 255); // `clickinchamber`
      for (let i = 0; i < 12 && num("bulletcount") < 6; i++) {
        p.fire(cx, cy);
        await p.settle("a bullet");
      }
      if (num("bulletcount") !== 6) throw new Error(`only ${num("bulletcount")} in the gun`);
      const [sx, sy] = onGunWhere((x, y) => x >= 248 || y >= 255);
      p.fire(sx, sy);
      await p.settle("the cylinder shut");
    };
    const fireAt = async (x: number, y: number, what: string): Promise<void> => {
      const before = shots();
      p.fire(x, y);
      await p.settle(`a shot at ${what}`);
      if (shots() === before) throw new Error(`the gun did not fire at ${what}`);
    };

    // ---- 4a. six that stand still, one cylinder -----------------------------
    for (const [name, x, y] of STANDING) {
      const which = name.startsWith("can") ? "canhitcount" : "bottlehitcount";
      const was = num(which);
      await fireAt(x, y, name);
      if (num(which) === was) throw new Error(`${name} was missed, and there is no bullet to spare`);
    }
    if (num("bulletcount") !== 0) throw new Error(`${num("bulletcount")} left after six`);

    await reload();

    /*
     * 4b. …and three that do not. `TARGET.CST/0002` counts a hit only while
     * the pose is "idle" — `raise` takes 5 ticks to get there and `lower` comes
     * 5 to 15 after — so this waits for the moment one becomes ready and shoots
     * THAT tick, which is the whole of the remaining idle window. A miss here
     * is fatal rather than retried: the cylinder is the budget.
     */
    const visible = (n: string): boolean => Number(ask(p, "actorvisible", [n])) === 1;
    const ready = (n: string): boolean =>
      visible(n) && String(ask(p, "actorpose", [n])).toLowerCase() === "idle";
    while (num("targethitcount") < 3) {
      await p.pump(() => POPUP.some(([n]) => ready(n)), "a pop-up target to come up");
      const up = POPUP.find(([n]) => ready(n))!;
      const was = num("targethitcount");
      await fireAt(up[1], up[2], up[0]);
      if (num("targethitcount") === was) throw new Error(`${up[0]} was missed, and there is no bullet to spare`);
    }
    if (shots() !== 9) throw new Error(`${shots()} shots, not 9`);
    if (num("bulletcount") !== 3) throw new Error(`${num("bulletcount")} left, not 3`);

    // ---- 4c. the OK that scores it — target.flt's `exitclick`, at 297,304 ---
    p.fire(298, 304);
    await p.settle("the score");
    await p.pump(() => room(p).startsWith("town"), "the street again");
    if (str("score") !== "fair") throw new Error(`the score is "${str("score")}"`);

    // ---- 5. back to Leroy for the matchbox ---------------------------------
    await clickActor(p, "leroy", "Leroy again", 40, () => !!p.session.puppet || str("handitem") === "matchbox");
    await talkOut(p, LEAVING, "Leroy", 2);
    if (str("handitem") !== "matchbox") throw new Error(`holding "${str("handitem")}"`);

    // ---- 6. down to Scene G12 and in at the jail ---------------------------
    await walkTo(p, town, { x: 6, z: 11, view: "west" });
    await openDoor(p, [122, 77, 218, 230], "jail", "the jail door", {
      set: town, x: 6, z: 11, view: "west",
    });
    await p.pump(() => room(p).startsWith("jail"), "the jail");

    // ---- 7. the Mayor's four plaques, then Dell ----------------------------
    const jail = set("JAIL");
    await walkTo(p, jail, { x: 1, z: 1, view: "south" }, () => !!p.session.puppet);
    await clickActor(p, "mayor", "the Mayor in the jail");
    let asked = await answer(p, 101, "I guess so.");
    asked = await answer(p, 102, "Why am I taking orders from you?", asked);
    asked = await answer(p, 105, "Anything else?", asked);
    await answer(p, 103, "Bye.", asked);
    await talkOut(p, LEAVING, "the Mayor", 2);
    if (num("mayorphase") !== 1 || num("phase") !== 3) {
      throw new Error(`mayorphase ${num("mayorphase")}, phase ${num("phase")}`);
    }

    await walkTo(p, jail, { x: 1, z: 1, view: "south" }, () => !!p.session.puppet);
    await clickActor(p, "dell", "Dell in his cell", 40,
      () => !!p.session.puppet || num("dellphase") === 1);
    await talkOut(p, LEAVING, "Dell", 2);
    if (num("dellphase") !== 1) throw new Error(`dellphase is ${num("dellphase")}`);

    // ---- 8. out of the jail, straight in at Chin's -------------------------
    await openDoor(p, [183, 34, 361, 263], "lock", "the jail door out", {
      set: jail, x: 0, z: 0, view: "west",
    });
    await p.pump(() => room(p).startsWith("town"), "Scene G12 again");
    await openDoor(p, [218, 100, 278, 204], "chin", "Chin's door", {
      set: town, x: 6, z: 11, view: "east",
    });
    await p.pump(() => room(p).startsWith("chin"), "Chin's");

    const chin = set("CHIN");
    await walkTo(p, chin, { x: 1, z: 1, view: "east" }, () => !!p.session.puppet);
    await clickActor(p, "help", "Help behind the counter", 40,
      () => !!p.session.puppet || num("helpphase") === 1);
    await answer(p, 103, "Goodbye.");
    await talkOut(p, LEAVING, "Help", 2);
    if (num("helpphase") !== 1) throw new Error(`helpphase is ${num("helpphase")}`);

    // ---- 9. out, and back up the street to Leroy ---------------------------
    await openDoor(p, [100, 2, 408, 263], "rice", "Chin's door out", {
      set: chin, x: 0, z: 1, view: "west",
    });
    await p.pump(() => room(p).startsWith("town"), "the street");
    await walkTo(p, town, { x: 10, z: 10, view: "south" });
  },
};
