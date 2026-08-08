/**
 * The routes — the game as a sequence of gestures.
 *
 * A segment is a function over a {@link Playthrough}: it presses keys, clicks
 * things and answers people, and asserts the story state it expects to reach.
 * It says nothing about golden traces or checkpoints — playthrough.ts wires
 * those around it, which is also what lets a segment be replayed by something
 * that is not a test (the browser suite, and eventually a demo).
 *
 * The route comes straight out of the scripts (docs/04-mission-flow.md), and
 * each segment's header records the reading it was written from. Where the
 * scripts and the route disagree, one of them is a bug — that is the point.
 */
import { expect } from "vitest";
import { Playthrough } from "./play";
import { COAL_LEVER, PATTY_COMBINATION, PATTY_DIALS, TURBINE_DIALS } from "./nav/dials";
import { WIRELESS_MAIN, WIRELESS_PANELS, switchToTransmit } from "./nav/wireless";
import { tripsFrom } from "./nav/shipgraph";
import { jumpTo } from "./nav/mapjumps";
import { pickEntry } from "./nav/smokestack";
import type { NavDriver } from "./nav/navigator";
import type { TalkPlan } from "./nav/converse";
import type { Story } from "./story";

/**
 * The OK button. Every BEDSIT1 object movie is a frame state machine with no
 * type-1 (exit) region — you leave by clicking the button the artists put in
 * the bottom-right corner, which walks the movie to a frame that runs off the
 * end. All seven put it over this point (bedmem 421,331-494,370; bedmant's is
 * the tightest at 430,339-484,362), and so does the boot menu's own OK.
 */
export const OK_BUTTON = { x: 460, y: 352 };

/** the boot menu's GAME region in playmode.mov (TOUR is the other one) */
export const MENU_GAME = { x: 266, y: 254 };

/** every scoring object in the London flat; all seven is 11 points */
export const BEDSIT_OBJECTS = ["memory", "obit", "paper", "cabinet", "cards", "poster", "mantle"];

/** read a script global as a number — every route asserts on these */
const num = (p: Playthrough, g: string): number => Number(p.session.interp.globals.get(g) ?? NaN);

/**
 * Segment 1 — cold boot (mission 0, phase 0) to mission 1, phase 0.
 *
 * A function rather than only a test, because it is also how the mission-1
 * checkpoint is produced: segment 2 starts from a savegame this wrote, and
 * rebuilding that means playing this again.
 */
export async function segment1(p: Playthrough): Promise<void> {
  const { host, session, v, nav, pump, settle, fire, beat, mark } = p;

  // -- 1-2. the cold boot ----------------------------------------------------
  let booted = false;
  const boot = session.track(host.coldBoot().then(() => (booted = true)));
  // ESC past the logos, the way anyone who has booted this twice does. rush
  // stops of its own accord at the menu: playmode.mov PARKS on its regions, and
  // a parked movie is a question, which rush never answers (Navigator.rush)
  const menu = await nav.rush(() => v()?.awaitingInput ?? false, "the boot menu", 80_000);
  expect(menu.ok, menu.reason).toBe(true);
  expect(v().moviePlaying, "playmode.mov is up and waiting on a click").toBe(true);
  expect(v().awaitingInput, "the menu waits for GAME or TOUR").toBe(true);
  await v().click(MENU_GAME.x, MENU_GAME.y);

  // -- 3. the London flat ----------------------------------------------------
  // NOT `currentSetName === "bedsit1"`: coldBoot opens the flat as a bare movie
  // host before the logos even play, so that is true from the first tick.
  await pump(() => booted && !session.fade.queue.length, "the London flat", 80_000);
  await boot;
  await beat("3. london flat");
  expect(num(p, "mission"), "the framing story is mission 0").toBe(0);
  expect(session.interp.globals.get("clock"), "advanceday armed the next day").toBe("bedsit");
  expect(session.currentThemeName, "the flat's radio is playing").toBe("bedrad1.trk");

  // -- 4. score the seven objects -------------------------------------------
  // Turn the ring and click what you see: the seven are spread over Scene2's
  // eight views, so no single standpoint has them all.
  const clicked = new Set<string>();
  for (let turn = 0; turn < 24 && clicked.size < BEDSIT_OBJECTS.length; turn++) {
    for (const o of v().scene.views[v().viewIdx].objects) {
      const id = (o.identifier ?? "").toLowerCase();
      if (!BEDSIT_OBJECTS.includes(id) || clicked.has(id)) continue;
      const at = {
        x: Math.floor((o.startRegionX + o.endRegionX) / 2),
        y: Math.floor((o.startRegionY + o.endRegionY) / 2),
      };
      // The close-up parks on a region frame; OK walks it to the end. Two rounds
      // for most, more for the ones that park twice (bedmem, bedcab).
      //
      // These are NOT rushed with ESC, and the reason is the whole scoring rule:
      // bedcards.mov pays +3 on each of its two action frames — six of the
      // eleven points that arm the bomb — and BEDSIT1 reads actionframe(1) only
      // after spotmovie returns. An ESC before those frames is a lower score.
      //
      // And OK is only pressed if OK is THERE — if a region of the parked movie
      // actually covers the point. `done()` alone is a race: the close-up can end
      // between the wait and the click, and then 460,352 is a point in the ROOM.
      // That is how a run silently lost a point — the stray click landed on
      // `cards`, setting xxcards with no close-up to score from, so the real
      // click later added nothing and the raid never armed at 10 of 11 points.
      const onOK = () =>
        v().movieRegions.some(
          (r) => OK_BUTTON.x >= r.x0 && OK_BUTTON.x <= r.x1 && OK_BUTTON.y >= r.y0 && OK_BUTTON.y <= r.y1,
        );
      // Every one of the seven is worth at least a point the FIRST time it is
      // clicked, and the scoring happens in the mousedown before the close-up even
      // plays — so a click that leaves bombpoints where it was is a click that did
      // not land, and clicking again is what a player does. Eleven points arm the
      // bomb and there are exactly eleven, so ONE missed click means waiting
      // forever for a raid that cannot come. (Seen in a browser, never here — but
      // the rule belongs in both twins, or the two routes are not the same route.)
      for (let attempt = 1; ; attempt++) {
        const before = num(p, "bombpoints");
        const done = fire(at.x, at.y);
        for (let ok = 0; ok < 12 && !done(); ok++) {
          await pump(() => done() || v().awaitingInput, `${id}'s close-up`);
          if (done() || !onOK()) break;
          fire(OK_BUTTON.x, OK_BUTTON.y);
        }
        await pump(done, `${id}'s close-up to close`);
        if (num(p, "bombpoints") !== before) break;
        expect(attempt, `${id} scored nothing at ${at.x},${at.y} — the raid needs all eleven`).toBeLessThan(3);
      }
      clicked.add(id);
      // The object that tips bombpoints past 10 ARMS the raid, and arms it with a
      // deliberately random fuse: bedsit1.set does `makeloop("scene", "scene1",
      // "bomb", random(100))` — 0 to 100 engine steps. So whether the raid has
      // already started when we look is not a property of the route, and a beat
      // taken right here catches the theme mid-flip in one host and not the
      // other. Wait for the raid this click caused, then record: the same state
      // in both hosts, and a truer description of the beat anyway.
      if (num(p, "bombpoints") < 0) {
        await pump(() => session.currentThemeName === "bedsit1.trk", `the raid ${id} sets off`);
      }
      await beat(`4. ${id} (${num(p, "bombpoints")} points)`);
    }
    if (clicked.size < BEDSIT_OBJECTS.length) {
      v().turn(0); // right, as ArrowRight does in main.ts
      await settle("the turn");
    }
  }
  expect([...clicked].sort(), "every scoring object was clicked once").toEqual([...BEDSIT_OBJECTS].sort());
  // > 10 trips the bomb, and mousedown zeroes the counter to -20000 as it does
  expect(num(p, "bombpoints"), "the seventh click armed the bomb").toBeLessThan(0);

  // -- 5-7. the engine takes over -------------------------------------------
  await pump(() => session.currentThemeName === "bedsit1.trk", "the bomb to fall");
  mark("5. the bomb falls");
  // gotowin turns you to the window and bombit() plays the blast; from here to
  // the ship nothing waits on the player at all, which is exactly the stretch
  // ESC is for — minutes of cutscene in a browser, and not one of them a question
  const crossing = await nav.rush(() => session.currentSetName === "c73", "the crossing to the Titanic", 200_000);
  expect(crossing.ok, crossing.reason).toBe(true);

  // -- 8. aboard -------------------------------------------------------------
  await beat("8. c73, mission 1");
  expect(num(p, "mission"), "the main game has begun").toBe(1);
  expect(num(p, "phase")).toBe(0);
  expect(v().scene.sceneName.toLowerCase()).toBe("scene51");
  expect(v().scene.views[v().viewIdx].viewName.toLowerCase()).toBe("view63");
  expect([num(p, "hrs"), num(p, "min")], "boarding at half past nine").toEqual([9, 30]);
  expect(session.fade.level, "faded all the way in").toBe(0);
}

/**
 * Segment 2 — mission 1 phase 0 to phase 1, resumed from segment 1's savegame.
 *
 * The route, from the scripts:
 *
 *   try the door   C73's door prop refuses to open at mission 1 phase 0 while
 *                  smethphase = 0 or you aren't carrying the bag and the watch,
 *                  and sends the steward instead (c73.set container 9)
 *   talk           SMETH1.PUP. Answer 101 to "could you use some help" — he
 *                  hands over the deck map and sets smethphase
 *   take your kit  the bag is on the bed, the watch on the desk; both are world
 *                  props you click where they lie
 *   go to the gym  GYM.SET's openset places Penny there, and ONLY at
 *                  mission 1 & phase 0
 *   talk           PENNY1.PUP: 102, 101, then 103 into the briefing, ending on
 *                  "Which cabin are you in?" — which is advancephase()
 */
export async function segment2(s: Story): Promise<void> {
  const { nav, d: driver, beat, owns } = s;

  await beat("m1.0 aboard");
  expect(s.num("mission")).toBe(1);
  expect(s.num("phase")).toBe(0);

  // -- the steward -----------------------------------------------------------
  const faced = await nav.faceStandpoint(["view55"]);
  expect(faced.ok, faced.reason).toBe(true);
  await driver.pressSpace(); // try the door; he answers it instead
  expect(driver.conversing(), "the steward stops you at the door").toBe(true);
  const talk = await nav.talk({ say: [102, 101], otherwise: "last", maxTurns: 60 });
  expect(talk.ok, talk.reason).toBe(true);
  await beat("m1.0 the steward");
  expect(s.num("smethphase"), "the briefing happened").toBeGreaterThan(0);
  expect(owns("map"), "accepting his help gets you the deck map").toBe(true);

  // -- your things -----------------------------------------------------------
  for (const thing of ["bag", "watch"]) {
    const got = await nav.hunt(thing);
    expect(got.ok, `${thing}: ${got.reason}`).toBe(true);
    await s.waitFor(() => owns(thing), `the ${thing} to be picked up`);
  }
  await beat("m1.0 bag and watch");

  // -- across the ship -------------------------------------------------------
  // By map, now that the bag and the watch are in hand — which is exactly what
  // unlocks it (MAP.STG's mapdisabled reads propowner on both). It lands at the
  // boat-deck stairwell, which is as close as the plans get to the gymnasium, and
  // walks the last two rooms.
  const walked = await nav.travel("gym");
  expect(walked.ok, walked.reason).toBe(true);
  await beat("m1.0 the gymnasium");

  // -- Penny -----------------------------------------------------------------
  const found = await nav.hunt("penny");
  expect(found.ok, found.reason).toBe(true);
  expect(driver.conversing(), "Penny is talking to you").toBe(true);
  const briefing = await nav.talk({ say: [102, 101, 103], otherwise: "last", maxTurns: 80 });
  expect(briefing.ok, briefing.reason).toBe(true);
  await beat("m1.1 briefed");
  expect(s.num("phase"), "the briefing advanced the phase").toBe(1);
}

/**
 * The coded telegram, as printed on the fourth message in the wireless room's
 * stack. The Enigma compares what you type to `goodmess`, which enigma.shp's
 * powerup() selects from `propdeg("zeitgram")` — 0 at mission 1. Kept here as a
 * route input rather than read back out of the global, so that a run where the
 * machine expects something else fails instead of agreeing with itself.
 */
const ZEITEL_TELEGRAM = "anhqsppaixwbfcxyam";

/** the combination the mission-1 telegram unlocks (enigma.stg dialset case 0) */
const ENIGMA_DIALS: Record<string, number> = { dial1: 8, dial2: 7, dial3: 5, dial4: 4 };

/**
 * Segment 3 — mission 1 phase 1 to phase 2: read Zeitel's telegram and decode it.
 *
 * The route, from the scripts:
 *
 *   the boat deck    the wireless door is guarded. DECKBD.SET c110 doesn't open
 *                    it at all while `actorowner("morrow") != "enterwireless"` —
 *                    it turns you to face him and he sends you away instead
 *   talk Morrow into MORROW1.PUP: "the sea appears calm" walks down through
 *   it               checkweather -> secrets -> politics -> survived, where "no
 *                    wonder moonless nights make you jumpy" sets morrowphase = 3,
 *                    and only THEN does wireless() offer bevel 999, which is the
 *                    permission. Seven answers, none of them optional
 *   the message      WIRELESS.SHP c110 plays msgout1.mov and adds the zeitgram
 *   stack            only `if actionframe(1)` — action frame 1 is "OUTFIX 1", the
 *                    fourth telegram, so you page there and close from THAT frame
 *   the trunk        c73.set's trunk hotspots answer `offerobject("trunkkey")`
 *                    and nothing else: it takes the key out of the bag and a drag
 *   the Enigma       trunk.stg c7 -> enigma.stg. Plug both wires and throw the
 *                    switch (powerup zeroes the dials), dial 8-7-5-4, type the
 *                    telegram, pull the decode lever. goodkey() then holds until
 *                    you press on the printout, and advances the phase
 */
export async function segment3(s: Story): Promise<void> {
  const { nav, d, beat, owns, deg } = s;

  await beat("m1.1 briefed, in the gym");
  expect(s.num("phase")).toBe(1);

  // -- the officer on the boat deck ------------------------------------------
  // Walk at the wireless room and you meet its guard: the door doesn't open, it
  // turns you to face Morrow and he sends you away. So the route asks to go
  // there, expects to be refused, and talks to the man who refused it — which is
  // the sequence the game is built around, not a workaround for it.
  const blocked = await nav.travel("wireless");
  expect(blocked.ok, "Morrow does not let you into the wireless room yet").toBe(false);
  expect(d.conversing(), `turned away with: ${blocked.reason}`).toBe(true);
  const persuade = await nav.talk({ say: [103, 101, 101, 103, 103, 102, 999], maxTurns: 140 });
  expect(persuade.ok, persuade.reason).toBe(true);
  await beat("m1.1 Morrow's permission");
  expect(s.num("morrowphase"), "he has confided in you").toBe(3);

  // -- the wireless room -----------------------------------------------------
  const inWireless = await nav.travel("wireless");
  expect(inWireless.ok, inWireless.reason).toBe(true);

  const apparatus = await nav.hunt("wireless");
  expect(apparatus.ok, apparatus.reason).toBe(true);
  expect(d.inFlat(), "the wireless close-up is up").toBe("wireless 1");

  const stack = await nav.hunt("messagestack2");
  expect(stack.ok, stack.reason).toBe(true);
  expect(d.movieWaiting(), "the stack is a movie you page through").toBe(true);
  // frames 0, 2, 4, 6 are the four telegrams; the fourth is action frame 1
  for (let page = 0; page < 3; page++) {
    const turned = await nav.clickMovie((r) => r.type === 2, `telegram ${page + 2}`);
    expect(turned.ok, turned.reason).toBe(true);
  }
  const closed = await nav.clickMovie((r) => r.type === 6, "closing the stack");
  expect(closed.ok, closed.reason).toBe(true);
  await beat("m1.1 Zeitel's telegram");
  expect(owns("zeitgram"), "reading the fourth telegram takes a copy").toBe(true);
  expect(deg("zeitgram"), "the mission-1 message").toBe(0);

  const outOfFlat = await nav.hunt("ok");
  expect(outOfFlat.ok, outOfFlat.reason).toBe(true);
  expect(d.inFlat()).toBeNull();

  // -- the trunk in the cabin ------------------------------------------------
  const home = await nav.travel("c73");
  expect(home.ok, home.reason).toBe(true);
  const atTrunk = await nav.faceStandpoint(["view60", "view62", "view66"]);
  expect(atTrunk.ok, atTrunk.reason).toBe(true);
  const opened = await nav.use("trunkkey", "trunk");
  expect(opened.ok, opened.reason).toBe(true);
  expect(d.inFlat(), "the trunk is open").toBe("Trunk 1");
  await beat("m1.1 the trunk");

  const enigma = await nav.hunt("enigma");
  expect(enigma.ok, enigma.reason).toBe(true);
  expect(d.inFlat(), "the machine is on screen").toBe("enigma 1");

  // -- power ----------------------------------------------------------------
  for (const wire of ["enigwirer", "enigwireg"]) {
    if (deg(wire) === 0) continue; // 0 is plugged in (enigma.shp wireson)
    const plugged = await nav.hunt(wire);
    expect(plugged.ok, `${wire}: ${plugged.reason}`).toBe(true);
  }
  const power = await nav.hunt("enigsw");
  expect(power.ok, power.reason).toBe(true);
  expect(deg("enigsw"), "the switch is on").toBe(1);
  // powerup() zeroes all four dials and picks the message it expects
  expect(s.str("goodmess"), "the machine expects this telegram").toBe(ZEITEL_TELEGRAM);

  // -- the combination ------------------------------------------------------
  for (const [dial, want] of Object.entries(ENIGMA_DIALS)) {
    // each click counts the dial down one, wrapping 0 -> 9
    for (let click = 0; click < 12 && deg(dial) !== want; click++) {
      const turned = await nav.hunt(dial);
      expect(turned.ok, `${dial}: ${turned.reason}`).toBe(true);
    }
    expect(deg(dial), `${dial} is set`).toBe(want);
  }
  await beat("m1.1 the machine is set");

  // -- typing ---------------------------------------------------------------
  for (const ch of ZEITEL_TELEGRAM) await d.typeKey(ch);
  // the first letter is the only one dialset() gates, so the dials drift after
  // it — that's the machine's own doing (keydown nudges a random dial)
  expect(s.str("dialmess"), "every letter registered").toBe(ZEITEL_TELEGRAM);

  // -- decode ---------------------------------------------------------------
  const lever = await d.startClick("enigdecode");
  expect(lever, "the decode lever is on screen").not.toBeNull();
  expect(await d.waitFor(() => d.propVisible("enigmess"), "the printout")).toBe(true);
  // goodkey() waits for a HELD press on the printout inside its own reset
  // rectangle (228..280 x 254..274 — enigma.stg pointinreset) before advancing
  expect(await d.holdUntil(254, 264, lever!, "reading the printout")).toBe(true);

  await beat("m1.2 decoded");
  expect(s.num("phase"), "the decode advanced the phase").toBe(2);
  expect(s.str("zeitclue"), "and told you what to chase").toBe("decoder");
}

/**
 * The turbine plant, and the six settings this route runs it at.
 *
 * TURBINE.STG is a real simulation, one `iterateone` every ten engine steps
 * (`changedone` re-arms itself) plus one per frame of any dial you are holding.
 * 100000 units of water circulate boiler -> turbine -> steamtank -> condensor ->
 * boiler through four flows, each a level times a control over 400:
 *
 *   boilpres = boiler * valve3 / 400      turbine   <- boiler
 *   valvpres = turbine * valve1 / 400     steamtank <- turbine
 *   seaspres = steamtank * valve2 / 400   condensor <- steamtank
 *   condpres = condensor * pump1 / 400    boiler    <- condensor
 *
 * and the output is a temperature difference, gated on there being flow at all:
 *
 *   boiltemp = (100 - |coal - 70|)  * (100 - |boiler/800 - 30| * 2) / 100
 *   condtemp = 100 - (100 - |pump2 - 60|) * (100 - |condensor/800 - 50| * 2) / 100
 *   electricity = (mean of the four pressures < 1000) ? 0 : boiltemp - condtemp
 *   electlag chases electricity by a tenth of the gap; the gauge is
 *   numtodeg(electlag, 100), and the OK button wants that above 13 — electlag 74
 *
 * So the plant wants coal 70, pump2 60, the boiler a third full and the
 * condensor half full, with enough circulation to clear the flow gate. Levels are
 * not settable: they are where the flows have carried the water. But for FIXED
 * controls this system has one equilibrium — levels in proportion to 1/control,
 * summing to the water there is — so the route does not have to steer it. It sets
 * six controls, and the plant converges on its own, from wherever the water
 * happens to be, in about 30 seconds.
 *
 * These six degs are that choice, picked by searching the reachable dial
 * positions (nav/dials.ts: the valves reach all twenty, the pumps only two
 * chains) for the widest margin over the gate. They settle the gauge at 17 of 19
 * against a threshold of 14, which is the margin worth having — every dial here
 * is one drag, and a drag that comes up a step short should not be the difference
 * between a puzzle solved and a puzzle failed.
 */
const TURBINE_SETTING: Record<string, number> = {
  slider: 7, // the coal lever: coal = degtonum(20 - 7) = 68, two off the ideal 70
  valve3: 7, // 36 — the boiler's outlet, which is what fixes the boiler's level
  valve1: 10, // 52
  valve2: 10, // 52
  pump1: 15, // 100 - 78 = 22 — the condensor's outlet, so the condensor's level
  pump2: 7, // 100 - 36 = 64, four off the ideal 60
};

/**
 * Where the plant settles at those settings, and why the route waits for it
 * rather than for the gauge to merely clear the gate.
 *
 * This is the equilibrium of the integer map above — reached from four different
 * random dial starts to the unit, and stationary once there. That makes it the
 * one moment in the whole flat at which a beat means the same thing in both
 * hosts: everywhere else the plant is mid-transient, and how far it has got
 * depends on how many frames the drags took, which a browser and a pumped clock
 * will never agree on. Waiting for the fixed point is what keeps these globals
 * out of the browser suite's mask list.
 *
 * The numbers being written down rather than read back is the same rule as
 * ZEITEL_TELEGRAM: a run where the plant settles somewhere else should fail,
 * not agree with itself.
 *
 * The four LEVELS get a tolerance and the rest do not, which is the same
 * distinction the note on the flows below draws. Stationarity is the flows being
 * equal; where the water is standing when they equalise is decided by how many
 * `iterateone` passes fitted around the six drags, and that is a count of frames.
 * A continuous playthrough reaches this flat having spent a slightly different
 * number of them than a run resumed from a checkpoint, and settles one unit away:
 * measured, turbine 17218 and condensor 40692 against the 17219/40691 below —
 * conserved between the two, since 17218 + 40692 is 17219 + 40691. That is the
 * same equilibrium, not another one. {@link PLANT_DRIFT} is wide enough to
 * absorb it and far too narrow for a plant that has settled somewhere else.
 */

/** how far a level may stand from {@link PLANT_STEADY} and still be it */
const PLANT_DRIFT = 16;

/**
 * The levels — compared within {@link PLANT_DRIFT}, not to the unit.
 *
 * Exported because the browser comparison has to drop exactly these four, for the
 * reason written out above: the equilibrium is the four FLOWS being equal, and a
 * one-unit slack in where the water is standing when they equalise is conserved
 * between the levels rather than being another equilibrium. The route tolerates
 * that here; a golden diff compares to the unit and cannot.
 */
export const PLANT_LEVELS = new Set(["boiler", "turbine", "steamtank", "condensor"]);

/**
 * The plant's DERIVED readings — the four flows and the two temperatures.
 *
 * Exported for the browser comparison for a different reason than the levels
 * above, and a stronger one: these are asserted TO THE UNIT, on both hosts, by
 * {@link waitForThePlant} against {@link PLANT_STEADY}, and again by segment 21,
 * which re-checks the same eleven numbers to prove the fixed point held. A golden
 * diff comparing them is therefore a second copy of an assertion the route
 * already makes — and unlike the route's, the copy also fires at beats taken
 * while the plant is still MOVING.
 *
 * `beat("m1.2 at the turbine controls")` is such a beat: it is sampled the moment
 * the turbine flat opens, before a dial is touched, and `TURBINE.STG changedone`
 * re-arms every ten engine steps to run one `iterateone()`, so every reading at
 * that instant is a count of frames. Measured on two runs of identical code, one
 * passed and the other came out `boilpres 10937` against a golden `12500`,
 * `valvpres 1562` against `0`, `boiltemp`/`condtemp` -24 against -32. The same
 * beat had previously diverged on `props.light` instead — one race wearing
 * whichever field the frame count happened to leave unsettled.
 */
export const PLANT_GAUGES = new Set([
  "boilpres", "valvpres", "seaspres", "condpres", "boiltemp", "condtemp",
]);

const PLANT_STEADY: Record<string, number> = {
  boiler: 24867,
  turbine: 17219,
  steamtank: 17223,
  condensor: 40691,
  boiltemp: 96,
  condtemp: 4,
  electricity: 92,
  electlag: 92,
  // The four FLOWS, and they are here because the levels alone are not the fixed
  // point. `iterateone` computes the flows from the levels and only then moves
  // them, so the iteration that lands `boiler` on 24867 published boilpres from
  // the 24866 it came from — 2237 — and it takes one more iteration to say 2238.
  // The old wait ended on that stale value, which left the beat after it decided
  // by whether another iteration happened to fit before it: the browser suite
  // diverged here on boilpres 2238 against a golden 2237, and nothing else.
  //
  // Being stationary is exactly all four being EQUAL — each level's inflow is
  // another's outflow, so a level stops moving when they match — which is why one
  // number does for all of them, and why nothing in the plant can move again once
  // this holds. That is what makes the beats after it host-independent, so this is
  // a fifth masked family avoided rather than added.
  boilpres: 2238,
  valvpres: 2238,
  seaspres: 2238,
  condpres: 2238,
};

/** the gauges that are not where {@link PLANT_STEADY} says, as a sentence — "" when settled */
const plantOffBy = (s: Story): string =>
  Object.entries(PLANT_STEADY)
    .filter(([g, v]) => (PLANT_LEVELS.has(g) ? Math.abs(s.num(g) - v) > PLANT_DRIFT : s.num(g) !== v))
    .map(([g, v]) => `${g}=${s.num(g)} want ${v}`)
    .join(", ");

/**
 * Wait for the plant, and say which gauges are wrong if it never gets there.
 *
 * A plant that settles somewhere else and a plant that never settles look
 * identical from outside the wait, and they are not the same bug.
 */
async function waitForThePlant(s: Story): Promise<void> {
  s.log?.("waiting for the plant to come up to full output");
  try {
    await s.waitFor(() => plantOffBy(s) === "", "the plant to settle at full output");
  } catch (e) {
    throw new Error(`the plant never settled — ${plantOffBy(s)}`, { cause: e });
  }
}

/**
 * Segment 4 — mission 1 phase 2 to phase 3: make the ship's turbines produce
 * electricity, and be thanked for it.
 *
 * The route, from the scripts:
 *
 *   the control room  CSEA1.PUP is the only way on. `runyoself` at mission 1
 *                     phase 2 branches on `actorowner("csea")`, which starts at
 *                     "none": helpme1() offers "perhaps I can solve that problem
 *                     for you", willihelp() offers "I'll help you", and that
 *                     second answer is what sets the owner to "helpme"
 *   and the same click gang.cst's csea mousedown is where the puzzle lives, and it
 *                     runs `walktopuppet` BEFORE testing the owner — so the click
 *                     that held that conversation goes on to read the "helpme" the
 *                     conversation just set, transtoflat("turbine.stg"), and set
 *                     the owner to "helping". One gesture, not two
 *   the plant         six controls, all of them dragged (nav/dials.ts), then wait
 *                     for the plant to come up to its fixed point
 *   the OK button     TURBINE.STG c5. `trackbut("oklit")` on the corner plaque,
 *                     and `propdeg("electrical") > 13` is the whole examination:
 *                     pass and the owner becomes "thanks1", fail and the flat
 *                     simply closes and he asks you to try again
 *   his thanks        the same handler arms CONTROL.SET's `trigger`, which clicks
 *                     the engineer FOR you — so the closing conversation starts
 *                     by itself, and its "thanks1" branch is advancephase()
 */
/**
 * Get the Reverend Trout off the 2nd-class staircase, permanently, on purpose.
 *
 * **The bug this exists for.** `STAIR2C.SET setuptrout()` places him at
 * `mission = 1 & phase >= 1 & savedeck = "e" & troutphase < 2`, and it is called
 * from the set's `openset` AND from both deck rungs — so he appears the moment a
 * descent relabels the staircase E deck. `GANG.CST` c859 `troutidle` then re-arms
 * every 20 ticks and calls `hasattention(4)` while `actorvalue("trout") <= 0`, and
 * `hotdist()` in `stair2c` is 3000 against standpoints measured at 1154-2854:
 * there is nowhere in that room to stand out of his reach. Four seconds on E deck
 * and he stops you.
 *
 * Which is a browser problem and not a game problem, and that is the whole trouble
 * with leaving it to chance. A pumped host walks those decks in fewer frames than
 * his timer wants; a browser spends real seconds. So the interception is
 * intermittent, it only ever happens in the host the goldens are not recorded in,
 * and when it happens mid-`travel` the planner is right to refuse to walk on
 * mid-sentence — the segment dies, and the next one reloads the page. Watched
 * happening, twice.
 *
 * **Talking to him is a permanent fix, and it is his own script that says so.**
 * `TROUT1.PUP` c6 dispatches mission 1 in `stair2c` to `prayercard()`, and every
 * way out of that conversation ends in `donate2()`, which sets `troutphase = 2` and
 * `sendtoactor("trout", putdownactor())`. `troutphase < 2` is the placement guard,
 * so once this has been held he is never on that staircase again — which covers the
 * two later mission-1 descents (segments 5 and 6) as well as this one.
 *
 * **Done deliberately, in BOTH hosts**, which is the point. The alternative — let
 * whoever gets stopped answer him — leaves the two hosts disagreeing about
 * `troutphase` and `troutmoney` for the rest of the run, and masking story state to
 * hide a race is the thing this suite does not do (segment 13 holds Max's and
 * Smethells' conversations on purpose for exactly this reason). Here it costs one
 * map jump and a walk down two rungs, and it buys a staircase nobody is standing on.
 *
 * `otherwise: "last"` walks the conversation: his introduction, then 102 "Do you
 * need anything else?" — which also declines the prayer card, since we have no use
 * for it — then 102 "Yes, I know. Goodnight.", and `donate2()`'s 102 "let's discuss
 * it later", which is the polite way to promise money and not hand any over.
 */
async function clearTrout(s: Story): Promise<void> {
  const { nav, d } = s;
  if (Number(d.flow().troutphase ?? 0) >= 2) return; // already seen to
  // Ask the map for the E-DECK plan, rather than landing on the boat deck and
  // walking down to it. The staircase has a red area on all seven plans and which
  // one you press IS the deck the middle of the stair becomes (§4, `bc08812`) — so
  // `savedeck` can be set by one map click instead of twenty gestures. Measured in
  // the browser gate: the descent was 20 turn/up pairs and 19.7 s of the 25.2 s
  // this whole errand cost, for a label the map hands over for free.
  //
  // `savedeck = "e"` is exactly what `setuptrout()` reads, so arriving this way is
  // also what PLACES him — the same trip, one gesture.
  const stairs = await nav.jump("stair2c", jumpTo("stair2c", "e") ?? undefined);
  expect(stairs.ok, stairs.reason).toBe(true);
  expect(String(d.flow().savedeck ?? ""), "the E-deck plan is what puts him on the stair").toBe("e");
  // He may well have opened the conversation himself on the way — `accost` counts
  // that as having reached him, which is what it is
  const him = await nav.accost("trout");
  expect(him.ok, him.reason).toBe(true);
  const said = await nav.talk({ otherwise: "last", maxTurns: 60 });
  expect(said.ok, said.reason).toBe(true);
  // `troutphase` IS the observable, and it is the right one: `donate2()` sets it in
  // the same breath as `putdownactor()`, and it is the term `setuptrout()`'s guard
  // reads. Whether the sprite has finished going below is not the fact that matters.
  expect(s.num("troutphase"), "donate2() — and setuptrout() will not place him again").toBe(2);
  s.log?.("the Reverend has left the staircase for good");
}

export async function segment4(s: Story): Promise<void> {
  const { nav, d, beat } = s;

  await beat("m1.2 decoded, in the cabin");
  expect(s.num("mission")).toBe(1);
  expect(s.num("phase")).toBe(2);

  // -- the Reverend, off the staircase for good ------------------------------
  await clearTrout(s);

  // -- the chief engineer ----------------------------------------------------
  const engineRoom = await travelPast(s, "control");
  expect(engineRoom.ok, engineRoom.reason).toBe(true);
  expect(s.actorOwner("csea"), "he has not been asked anything yet").toBe("none");

  const met = await nav.hunt("csea");
  expect(met.ok, met.reason).toBe(true);
  expect(d.conversing(), "the engineer is talking to you").toBe(true);
  // 102 gets him to the point, 103 takes the job. 101 ("I'm on official
  // business") is a line, not a branch — helpme1 loops straight back to the
  // same two plaques with it removed
  const offered = await nav.talk({ say: [102, 103], maxTurns: 60 });
  expect(offered.ok, offered.reason).toBe(true);

  // -- the turbine room ------------------------------------------------------
  // Accepting the job and being shown the plant are ONE gesture, and the order
  // inside gang.cst's mousedown is why: it runs `walktopuppet` first and only
  // then tests the owner — which the conversation it just held has meanwhile set
  // to "helpme". So the click that started the conversation goes on to open the
  // flat as soon as it ends, and there is nothing to click a second time.
  await s.waitFor(() => d.inFlat() === "Turbine 1", "the turbine room to open");
  expect(s.actorOwner("csea"), "he has handed the plant over to you").toBe("helping");
  await beat("m1.2 at the turbine controls");

  // -- the six settings ------------------------------------------------------
  // Order does not matter and deliberately isn't chosen: the water sloshes about
  // while the dials are being set, and the equilibrium it lands on afterwards is
  // the same wherever it happens to be when the last one is done.
  for (const [name, want] of Object.entries(TURBINE_SETTING)) {
    const dial = name === COAL_LEVER.prop ? COAL_LEVER : TURBINE_DIALS[name];
    const set = await nav.setDial(dial, want);
    expect(set.ok, `${name}: ${set.reason}`).toBe(true);
    expect(s.deg(name), `${name} points at ${want}`).toBe(want);
    // and the plant is RUNNING on it, which is a different fact — see the note on
    // DrivenControl. A dial that points right while its global still reads
    // initvalue()'s 50 settles the plant somewhere else entirely, and the only
    // symptom is the wait below never ending.
    // every turbine control drives one; a combination lock's dials drive nothing
    const driven = dial.global;
    if (driven) expect(s.num(driven), `the plant is running ${driven} at the dial`).toBe(dial.value(want));
  }

  // -- and then it settles ---------------------------------------------------
  // Nothing to do but watch the gauges: `changedone` iterates the plant every ten
  // engine steps whether anyone is holding a dial or not.
  //
  // And NO beat between the last dial and the fixed point, deliberately. The
  // water is mid-transient the whole way, and how far it has got depends on how
  // many frames the six drags took — a browser and a pumped clock will never
  // agree on that, so a beat here diverged on eleven globals while meaning
  // nothing (it was: boiler 24916 against 23541, and so on down the plant). The
  // settled beat records the six control globals just as well, because nothing
  // but a dial ever changes them.
  await waitForThePlant(s);
  await beat("m1.2 the plant is steady");
  expect(s.deg("electrical"), "the output gauge clears the OK button's > 13").toBeGreaterThan(13);

  // -- the OK button ---------------------------------------------------------
  // Named for what it is on the flat rather than for the "oklit" prop its script
  // lights: `trackbut` shows that one only while the button is held.
  const ok = await nav.hunt("exit");
  expect(ok.ok, ok.reason).toBe(true);
  await s.waitFor(() => !d.inFlat(), "the turbine room to close");
  expect(s.actorOwner("csea"), "the plant passed its examination").toBe("thanks1");

  // -- his thanks ------------------------------------------------------------
  // Not our gesture: the OK handler arms a scene loop that clicks him for us
  // (CONTROL.SET's trigger), so the conversation opens on its own.
  await s.waitFor(() => d.conversing(), "the engineer to come and thank you");
  const thanked = await nav.talk({ maxTurns: 20 });
  expect(thanked.ok, thanked.reason).toBe(true);
  await beat("m1.3 thanked");
  expect(s.num("phase"), "his thanks advanced the phase").toBe(3);
}

/**
 * Segment 5 — mission 1 phase 3 to phase 4: hide the Rubaiyat where the stoker
 * cannot trade it away, then buy him off with his brother's supper.
 *
 * The route, from the scripts:
 *
 *   who has it     INVEN.SHP `initprops` deals mission 1's world out, and two of
 *                  its lines are this whole phase: `giveinven("rubaiyat",
 *                  "coal4")` and `coalchute = "coal4"`. The manuscript Frank is
 *                  on the ship to find starts down a coal chute, and
 *                  `propowner("rubaiyat") = coalchute` is how the engine asks
 *                  whether anybody has been to fetch it.
 *   two traps      BOIL.SET `openset` trades the book to Vlad the moment you
 *                  arrive at boil3 carrying the package while it is still at
 *                  `coalchute` — that advances the phase but strands mission 1,
 *                  because Penny's phase-4 debrief wants it in Frank's hand. And
 *                  VLAD1.PUP opens with `playerdeath = "by vlad"` if you talk to
 *                  him while carrying it.
 *   the way out    Hide it in a DIFFERENT bunker. INVEN1.STG c6: with
 *                  `handitem = "rubaiyat"`, the inventory's OK over the bunker
 *                  flat runs `dobook()`, and dropping the book anywhere but the
 *                  bag does `giveinven("rubaiyat", "coalN")` for the bunker you
 *                  are standing in. Now it is neither at `coalchute` nor in his
 *                  reach, so neither trap can fire.
 *   getting near   gang.cst c3's mousedown is `if realdist(me) < hotdist()`, and
 *                  `hotdist()` (gang.cst c1) answers 1600 for "boil". From the
 *                  arrival standpoint he is 4039 away, so the click lands on him
 *                  and does nothing at all. Scene40/View45 is 715.
 *   his price      meet() 101 -> listen() 102 -> favor() 101 -> friend() 101 is
 *                  the chain that sets `actorowner("vlad") = "help"`, which is
 *                  what his package branch requires; then 101 hands it over and
 *                  `giveinven("vladfood", "vlad")`.
 *   pressing twice  the bunker flat's OK is a `trackbut` and the flat refuses
 *                  input while a script is still running — after the hide,
 *                  `dobook()` leaves `boilbag`'s close loop going
 *                  (`makeloop("prop", "boilbag", "close", 6)`). Headless that
 *                  loop is over before the next gesture; in a browser it is not,
 *                  so the press landed on the button and the room was not
 *                  listening. `closeBunker` presses until it takes, which is what
 *                  a player does. (My first diagnosis of this was `target` not
 *                  reaching a handler called as a function — wrong; interp.ts
 *                  passes `frame.ctx` straight through.)
 *   the beat       INVEN.SHP `addinven`: picking the book back up with
 *                  `propowner("vladfood") = "vlad"` is the `advancephase()` —
 *                  phase 4 WITH the Rubaiyat in hand, which is the state mission
 *                  1 can actually be finished from.
 */
export async function segment5(s: Story): Promise<void> {
  const { nav, d, beat } = s;

  await beat("m1.3 thanked, in the control room");
  expect(s.num("mission")).toBe(1);
  expect(s.num("phase")).toBe(3);
  expect(d.propOwner("rubaiyat"), "nobody has been down the chute").toBe(
    String(d.flow().coalchute ?? "coal4"),
  );

  /** down to boiler 3: the ladder alternates ends, so take the graph's own trips */
  const toBoiler3 = async (): Promise<void> => {
    const there = await travelPast(s, "boil");
    expect(there.ok, there.reason).toBe(true);
    for (const level of ["boil2", "boil3"]) {
      if (String(d.flow().savedeck) === level) continue;
      const climb = tripsFrom("boil", d.flow()).find((t) => t.to === "boil" && t.sets.savedeck === level);
      expect(climb, `the graph knows the way up to ${level}`).toBeTruthy();
      const took = await nav.takeTrip(climb!);
      expect(took.ok, took.reason).toBe(true);
    }
    expect(String(d.flow().savedeck), "at boiler 3").toBe("boil3");
  };

  /** open a bunker's flat, standing where its own hotspot is */
  const openBunker = async (scene: string, view: string, coal: string): Promise<void> => {
    const faced = await nav.faceStandpoint([view], [scene]);
    expect(faced.ok, faced.reason).toBe(true);
    expect(await d.clickHotspot(coal), `${coal}'s bunker opens`).toBe(true);
    expect(d.inFlat(), "the bunker flat is up").toBe("boil 1");
  };

  /**
   * And out again — the flat's OK is a BUTTON, not a scene hotspot.
   *
   * Pressed until it takes, because a press can legitimately land on nothing: the
   * flat refuses input while a script is still running, and after the hide
   * `dobook()` leaves `boilbag`'s close loop going (`makeloop("prop", "boilbag",
   * "close", 6)`). A player presses again; so does this. It is not a retry around
   * a flaky gesture — the click is dispatched, the room simply is not listening
   * yet, and `clickThing` answers "it landed on the button" either way.
   */
  const closeBunker = async (): Promise<void> => {
    for (let press = 1; press <= 4 && d.inFlat(); press++) {
      const clicked = await d.clickThing("ok");
      expect(clicked, "the bunker flat's OK is there to press").toBe(true);
      if (d.inFlat()) s.log?.(`bunker OK press ${press} landed while the room was busy`);
    }
    expect(d.inFlat(), "back in the room").toBe(null);
  };

  // -- the stoker, close enough to be heard -----------------------------------
  await toBoiler3();
  const near = await nav.faceStandpoint(["view45"], ["scene40"]);
  expect(near.ok, near.reason).toBe(true);
  expect(await d.clickThing("vlad"), "clicked the stoker").toBe(true);
  await s.waitFor(() => d.conversing(), "Vlad to turn round");
  const asked = await nav.talk({ say: [101, 102, 101, 101], maxTurns: 40 });
  expect(asked.ok, asked.reason).toBe(true);
  expect(s.actorOwner("vlad"), "he will take a favour now").toBe("help");

  // -- the book, out of coal4 and into coal2 ---------------------------------
  await openBunker("scene13", "view21", "coal4");
  expect(await d.clickThing("boildoor"), "the bunker door opens").toBe(true);
  expect(await d.clickThing("boilrubaiyat"), "and the book is behind it").toBe(true);
  expect(d.handItem(), "the Rubaiyat is in Frank's hand").toBe("rubaiyat");
  await closeBunker();

  await openBunker("scene11", "view29", "coal2");
  expect(await d.clickThing("boilbag"), "the inventory opens over the flat").toBe(true);
  expect(d.inFlat(), "...as an overlay").toBe("inven 1");
  // Its OK runs `dobook()`, which parks in `while not button()` waiting for the
  // NEXT press — so this click is fired, not settled, and the press that follows
  // is the drop. A click would only move the cursor; dobook polls button().
  expect(await d.startClick("ok"), "the inventory's OK").not.toBe(null);
  const dropped = await d.holdUntil(150, 150, () => d.propOwner("rubaiyat") !== "frank", "the book to land");
  expect(dropped, "the book left Frank's hand").toBe(true);
  expect(d.propOwner("rubaiyat"), "hidden in the second bunker").toBe("coal2");
  expect(d.handItem(), "and his hands are empty for Vlad").toBe("");
  await closeBunker();
  await beat("m1.3 the book is hidden in another bunker");

  // -- A deck, port side: Sasha and the package -----------------------------
  const hall = await travelPast(s, "halla");
  expect(hall.ok, hall.reason).toBe(true);
  expect(String(d.flow().hallside), "the port side, where a-16 is").toBe("port");
  const door = await nav.faceStandpoint(["view57"], ["scene51"]);
  expect(door.ok, door.reason).toBe(true);
  expect(await d.clickHotspot("door"), "knocked on a-16").toBe(true);
  await s.waitFor(() => d.conversing(), "Sasha to come to the door");
  const sasha = await nav.talk({ say: [101, 102, 101, 102, 103], maxTurns: 60 });
  expect(sasha.ok, sasha.reason).toBe(true);
  expect(d.handItem(), "his brother's supper is in Frank's hand").toBe("vladfood");
  await beat("m1.3 the package for Vlad");

  // -- back down, and the exchange on OUR terms -----------------------------
  await toBoiler3();
  expect(d.propOwner("rubaiyat"), "openset had nothing to trade").toBe("coal2");
  const again = await nav.faceStandpoint(["view45"], ["scene40"]);
  expect(again.ok, again.reason).toBe(true);
  expect(await d.clickThing("vlad"), "clicked the stoker again").toBe(true);
  await s.waitFor(() => d.conversing(), "Vlad to turn round again");
  const handover = await nav.talk({ say: [101], otherwise: "last", maxTurns: 40 });
  expect(handover.ok, handover.reason).toBe(true);
  expect(d.propOwner("vladfood"), "he has his supper").toBe("vlad");

  // -- and now the book is worth picking up ---------------------------------
  await openBunker("scene11", "view29", "coal2");
  expect(await d.clickThing("boildoor"), "the second bunker's door opens").toBe(true);
  expect(await d.clickThing("boilrubaiyat"), "the book is where we left it").toBe(true);
  expect(d.handItem(), "the Rubaiyat is Frank's").toBe("rubaiyat");
  await beat("m1.4 the Rubaiyat in hand");
  expect(s.num("phase"), "picking it up with Vlad fed advanced the phase").toBe(4);

  // -- and up out of the stokehold -------------------------------------------
  // Not tidiness: the segment ENDS here because the checkpoint is taken from it,
  // and a savegame cannot carry `savedeck`. Patching a string global only works
  // when that exact string is already in the base save's pool (df/savegame.ts
  // poolFind), and "boil3" is not — so a save taken down here reloads with
  // savedeck 0, and the boiler room's own per-level exits disappear. Walk out
  // while the live run still knows which level it is on.
  await closeBunker();
  for (const level of ["boil2", "boil1"]) {
    const down = tripsFrom("boil", d.flow()).find((t) => t.to === "boil" && t.sets.savedeck === level);
    expect(down, `the graph knows the way down to ${level}`).toBeTruthy();
    const took = await nav.takeTrip(down!);
    expect(took.ok, took.reason).toBe(true);
  }
  const out = await travelPast(s, "engine");
  expect(out.ok, out.reason).toBe(true);
  expect(d.propOwner("rubaiyat"), "and it comes with us").toBe("frank");
}

/**
 * Where the flats in this sub-plot put their OK, and why the number is the LIT
 * prop's rect and not the dark one's.
 *
 * `trackbut(name, 256, 192)` hit-tests the pointer against the rect of the prop it
 * is NAMED with, anchored at the flat's centre: `(256 - posXraw, 192 - posYraw)`
 * sized `width × height`. In the fusebox that name is `fuseoklit`, which is
 * invisible — 57×25 at 428,338 — while the plaque a player can SEE is
 * `fuseokdark`, 76×42 at 419,330, overhanging it on every side. Aim at the dark
 * one's middle and the press samples outside the button: `trackbut` answers 0,
 * silently, and the flat just stays open. `pattyexit` and the inventory's
 * `invenctl` sit on the same geometry, which is why one point serves all three.
 */
const TRACKBUT_OK = { x: 456, y: 350 };

/**
 * The necklace sub-plot — Georgia's paste copy for the real thing in Vlad's cabin.
 *
 * Worth the forty-odd gestures because of one line in `narend.stg`: `worldwar1()`
 * sets `onehappens = false` only when the Rubaiyat AND the necklace are both out of
 * Vlad's hands, and that is one of the three flags between us and the credits. It
 * has to happen HERE, in missions 1-3 — `advanceday()` sets `neckphase = -1` on the
 * way into mission 4 — and both its gates (`progress(1,1)`, `progress(1,4)`) are
 * open from phase 4 on and stay open, so this window is the earliest that works.
 *
 * `neckphase` runs 0 → 1 → 2 → 5 → 6 → 7 → 8 → 9; there is no 3 or 4.
 *
 *   0→1  `deckbd`  Georgia, `GA1.PUP deck()` — 101, 104, 104, 105, and she hands
 *                  over her own necklace (`addinven("fakeneck")`). 103 instead of
 *                  101 exits with nothing, so the answers are not a preference.
 *   1→2  `decka`   Georgia again, `sasha()` — 101.
 *   2→5  `b70`     Georgia, `b70()` → `catchup()` — 102, 101, 101, 101.
 *   5→6  `smoke`   Charles, `CHARL1.PUP smoke(false)` — 100, 101, 102, then 999.
 *   6→7  A deck    the fusebox at `view61` on the port side: fuse 14 OFF and OK.
 *                  Cutting the power runs `setupactor("sasha", "halla")`, which is
 *                  what draws him out of his cabin.
 *   7→8  ditto     fuse 14 back ON and OK, so the bag can be seen into.
 *   8    `a14`     the doll: the combination, then take the real and leave the fake.
 *   8→9  `a14`     the door — `kickout()`, and Sasha judges what he finds.
 *
 * Getting the last step wrong is FATAL, and it is the whole reason this is an
 * EXCHANGE rather than a theft. `a14.Set` c54:
 *
 *     if propowner ("realneck") != "vlad"
 *         if propowner ("fakeneck") = "vlad"  → takeneck ("swap")   one line, you live
 *         else                                 → takeneck ("steal")  playerdeath
 *
 * and `SASHA1.PUP` "steal" takes both necklaces back before killing you.
 */
export async function necklace(s: Story): Promise<void> {
  const { nav, d } = s;
  const phase = () => s.num("neckphase");
  /**
   * Wait for a conversation's CONSEQUENCE, rather than reading it off the last click.
   *
   * Every step of this sub-plot advances `neckphase` from inside the puppet script,
   * after the last plaque is answered — `GA1.PUP b70()` falls through into
   * `catchup()`, which speaks its own lines first. So the number is not set at the
   * moment `talk` returns, it is set some frames later, and how many frames is a
   * property of the host: headless settles the whole script before answering, a
   * browser's mirror is only as fresh as the last poll. Asserting it directly passed
   * headless and failed in a browser at exactly one of the four steps, which is the
   * signature of a route reading a value too early rather than of the hosts
   * disagreeing about anything.
   */
  const reaches = async (to: number, what: string): Promise<void> => {
    await s.waitFor(() => phase() === to, `${what} (neckphase ${to})`);
    expect(phase(), what).toBe(to);
  };

  // -- 0 -> 1: Georgia on the boat deck -------------------------------------
  // Named standpoint, not `accost`: `deckbd` has 27 scenes and accost gives up at
  // MAX_GESTURES_PER_ROOM = 60, so its sweep never reaches her end of the deck.
  // She is aimable from seven standpoints and answers from this one. (And
  // `actorOwner("ga")` reads "none" while she is standing right there — owner is
  // not presence.)
  const deck = await nav.travel("deckbd");
  expect(deck.ok, deck.reason).toBe(true);
  const hers = await nav.faceStandpoint(["view252"], ["scene45"]);
  expect(hers.ok, hers.reason).toBe(true);
  expect(await d.clickThing("ga"), "Georgia is on the boat deck").toBe(true);
  await s.waitFor(() => d.conversing(), "Georgia to answer");
  const boatDeck = await nav.talk({ say: [101, 104, 104, 105], maxTurns: 60 });
  expect(boatDeck.ok, boatDeck.reason).toBe(true);
  await reaches(1, "she has asked us to look at Vlad's necklace");
  expect(d.propOwner("fakeneck"), "and given us hers to swap in").toBe("frank");

  // -- 1 -> 2 -> 5: Georgia twice more --------------------------------------
  // Stand where she ANSWERS from before sweeping for her. `accost` clicks from
  // standpoint after standpoint and its sweep is the fallback, not the plan: from
  // the standpoint `travel` happens to leave you at, both of these rooms cost two
  // dud clicks first — and a dud is 1.6 s of browser time even now that the wait
  // stops as soon as she has held still (Navigator.answers).
  //
  // Which standpoint that is, measured rather than guessed. Probing every
  // `<name> to answer` wait in a full run for the distance to her and whether it
  // moves gives both the duds and the answer:
  //
  //   decka   duds at 618 units, never moved; ANSWERED from Scene349/View373 (747)
  //   b70     duds at Scene14/View22 x2 (13125)
  //           ANSWERED at Scene15/View23 (6969, and CLOSING while it waited)
  //
  // Note the answers come from FURTHER away than `hotdist()` (500 on A deck) — the
  // distance is not the gate, which is why this names a standpoint and does not
  // compute one (nav/reach.ts). And b70 is why the click keeps its wait: she walks
  // over. Same shape as the boat-deck beat above, which has always been written
  // this way because accost's sweep cannot cross 27 scenes.
  //
  // **A deck keeps the sweep, and that is measured too.** Naming Scene349/View373
  // there fails: `faceStandpoint` walks greedily and re-plans one gesture at a time,
  // and on the A-deck promenade it spent all sixty gestures of its budget and ended
  // six scenes away — `gave up reaching view373 in decka (at scene10/view1)`. What
  // gets there is exactly what `accost` has that `faceStandpoint` lacks: it marks
  // the standpoints it has tried. Two dud clicks is the price of that, and it is
  // 3.2 s.
  for (const [room, stand, scene, say, to] of [
    ["decka", "", "", [101], 2],
    ["b70", "view23", "scene15", [102, 101, 101, 101], 5],
  ] as const) {
    const there = await nav.travel(room);
    expect(there.ok, there.reason).toBe(true);
    if (stand) {
      const spot = await nav.faceStandpoint([stand], [scene]);
      expect(spot.ok, `${room}: ${spot.reason}`).toBe(true);
    }
    const her = await nav.accost("ga");
    expect(her.ok, her.reason).toBe(true);
    const said = await nav.talk({ say: [...say], maxTurns: 60 });
    expect(said.ok, said.reason).toBe(true);
    await reaches(to, `Georgia in ${room}`);
  }

  // -- 5 -> 6: Charles in the smoking room ----------------------------------
  // The same, and the same measurement: three dud clicks from Scene10/View66 and
  // /View71 at 8614 units, then he answers from Scene11/View68 at 5116 — against a
  // `hotdist()` of 3500 in here, so again the answer comes from outside the reach
  // this side computes.
  const smoke = await nav.travel("smoke");
  expect(smoke.ok, smoke.reason).toBe(true);
  const his = await nav.faceStandpoint(["view68"], ["scene11"]);
  expect(his.ok, his.reason).toBe(true);
  const charles = await nav.accost("charl");
  expect(charles.ok, charles.reason).toBe(true);
  // 999 is the leave bevel; the three before it are what tells him what we want
  const told = await nav.talk({ say: [100, 101, 102, 999], maxTurns: 60 });
  expect(told.ok, told.reason).toBe(true);
  await reaches(6, "Charles has agreed to keep Sasha busy");

  // -- 6 -> 7 -> 8: the fusebox --------------------------------------------
  const hall = await travelPast(s, "halla");
  expect(hall.ok, hall.reason).toBe(true);
  const box = await nav.faceStandpoint(["view61"]);
  expect(box.ok, box.reason).toBe(true);
  expect(s.str("hallside"), "FUSE.SHP's door gate wants the port side").toBe("port");

  /**
   * Open the fusebox, which takes more than one click for two separate reasons.
   *
   * `halla.set` c1 routes a click on the `fuse` hotspot to the seaman while he is
   * visible, and `openset` puts him there at `neckphase = 6 & progress(1, 4)`. He
   * wants no answer — `ASEA1.PUP` "fuse" speaks four lines and then
   * `sendtoactor("asea", putdownactor())` — but that dispatch takes frames to
   * land, and until it does he is still standing in front of the hotspot, where an
   * actor outranks a hotspot in the hit order. So the second click cannot even be
   * AIMED, and `clickHotspot` answers false rather than doing nothing visible.
   * Hence the wait between tries.
   *
   * Then the box itself: `fusedoor` closed is 255×384 at x 91..346, over all four
   * switch regions, so the door takes the first click in there and the switches are
   * only reachable once it is open.
   */
  const openFusebox = async (): Promise<void> => {
    for (let attempt = 1; attempt <= 4 && !d.inFlat(); attempt++) {
      if (await d.clickHotspot("fuse")) {
        if (d.conversing()) {
          const seaman = await nav.talk({ otherwise: "last", maxTurns: 20 });
          expect(seaman.ok, seaman.reason).toBe(true);
        }
      }
      if (d.inFlat()) break;
      // let the queued putdownactor land before aiming again
      let waited = 0;
      await d.waitFor(() => ++waited > 30, "the seaman to walk away from the fusebox", 4000);
    }
    expect(d.inFlat(), "the fusebox is open").toBe("fuse 1");
    if (d.propState("fusedoor") !== "open") {
      expect(await d.clickThing("fusedoor"), "the fusebox door").toBe(true);
    }
    expect(d.propState("fusedoor"), "and it stays open to work in").toBe("open");
  };

  for (const [state, to] of [["off", 7], ["light", 8]] as const) {
    await openFusebox();
    expect(await d.clickThing("fuse14"), `fuse 14 to ${state}`).toBe(true);
    // the switch runs an animation loop into its resting frame; the OK reads the
    // fusebox string, not the sprite, but a route that clicks OK mid-throw is
    // racing the loop that writes it
    await s.waitFor(() => d.propState("fuse14") === state, `fuse 14 to settle ${state}`);
    await d.clickAt(TRACKBUT_OK.x, TRACKBUT_OK.y);
    await s.waitFor(() => phase() === to, `neckphase ${to}`);
    expect(d.inFlat(), "the OK closed the fusebox").toBe(null);
  }

  // -- 8: the doll ----------------------------------------------------------
  const cabin = await nav.travel("a14");
  expect(cabin.ok, cabin.reason).toBe(true);
  const display = await nav.faceStandpoint(["view11"], ["scene1"]);
  expect(display.ok, display.reason).toBe(true);
  expect(await d.clickHotspot("patty"), "the matryoshka on its stand").toBe(true);
  expect(d.inFlat(), "patty.stg opens on its wide flat").toBe("patty 1");

  // PATTY.STG's three flats and their regions, all read out of the click-logic
  // containers: "patty 1" carries `dial` (55..159, 235..329) into the combination
  // close-up, `doll1` (72..169, 106..237) which TESTS the combination, and
  // `pattyexit`; "patty 2" is the four rings; "patty 3" is the opened bag.
  await d.clickAt(107, 282);
  expect(d.inFlat(), "the dial region opens the combination").toBe("patty 2");

  // `lockdoll()` scatters all four rings on first open, so every one has to be
  // turned even if it happens to read right — and the combination is the game's
  // own debug cheat, PATTY.STG `solvedoll()`.
  for (const [i, want] of PATTY_COMBINATION.entries()) {
    const ring = PATTY_DIALS[`dial${i + 1}`];
    const set = await nav.setDial(ring, want);
    expect(set.ok, set.reason).toBe(true);
    expect(d.propDeg(ring.prop), `${ring.prop} on ${want}`).toBe(want);
  }

  await d.clickAt(TRACKBUT_OK.x, TRACKBUT_OK.y);
  expect(d.inFlat(), "back out to the doll").toBe("patty 1");
  // and NOW the doll1 region has something to say: it makes the doll appear
  await d.clickAt(120, 170);
  expect(d.propVisible("doll"), "the combination was right").toBe(true);
  expect(d.propDeg("doll"), "standing closed").toBe(0);

  // PATTY.SHP c3 turns the doll on clicks to its left half (`x < 175`) and opens
  // it on the third. The sprite is 276×258 at (40..316, 97..355) and the two
  // regions above sit ON its left half — `doll1` down to y 237, `dial` to y 329 —
  // so the only clear left-half strip is below them. Click the doll's middle and
  // the region answers instead: `doll1` re-runs the combination test and puts the
  // doll back to `propdeg 0`, which looks exactly like a click that did nothing.
  for (const want of [1, 2]) {
    await d.clickAt(120, 345);
    expect(d.propDeg("doll"), "the doll turns").toBe(want);
  }
  await d.clickAt(120, 345);
  expect(d.inFlat(), "and opens").toBe("patty 3");
  expect(d.propVisible("pattyreal"), "Vlad's necklace is in it").toBe(true);

  // -- the exchange ---------------------------------------------------------
  // c123: `addinven("realneck")`, and the flag we came for is cleared right here
  expect(await d.clickThing("pattyreal"), "take the real one").toBe(true);
  expect(d.propOwner("realneck"), "OURS — worldwar1's second condition").toBe("frank");

  // c129: the bag at "idleclosed" opens the inventory OVER the flat
  expect(await d.clickThing("pattybag"), "open the bag").toBe(true);
  expect(d.inFlat(), "the inventory covers patty.stg").toBe("inven 1");

  // Not `nav.takeInHand`: closing the bag with OK is part of that gesture, and
  // here the OK is what STARTS the drag. And this click matters for a reason
  // that is easy to miss — `addinven("realneck")` above also put the REAL one in
  // hand, and `inven1.stg`'s OK reads `handitem` to choose which necklace
  // `doneck()` gives you. Skip this and the route drags the real one back in.
  expect(await d.clickThing("fakeneck"), "Georgia's copy out of the bag").toBe(true);
  expect(d.handItem(), "in hand, so the OK hands us this one").toBe("fakeneck");

  // The OK cannot be awaited: `transfromflat()` lands back on "patty 3" and
  // `doneck("fake")` takes hold of the necklace there, in a `while not button()`
  // loop that only ends on the next press. So fire it, wait for the necklace to
  // stick to the cursor, and make that press somewhere off the bag —
  // `pattybag` is 354..424, 295..382, and dropping ON it just puts the necklace
  // away again.
  expect(await d.startClick("ok"), "the inventory's OK").toBeTruthy();
  await s.waitFor(
    () => d.propVisible("pattyfake") && d.propState("pattyfake") === "drag",
    "the fake to come out on the cursor",
  );
  const left = await d.holdUntil(
    150, 150,
    () => d.propOwner("fakeneck") === "vlad",
    "the fake left in the doll",
  );
  expect(left, "the fake is Vlad's now").toBe(true);
  expect(d.propOwner("realneck"), "and the real one is still ours").toBe("frank");

  // -- 8 -> 9: out, and Sasha comes back ------------------------------------
  // The OK that started the drag is not finished when the drag is: it goes on to
  // `sendtoprop("pattybag", close())`, six frames of animation ending in
  // `flushevents()`. That call DISCARDS whatever is queued, which is the right
  // thing for the loop that just read its own press and is exactly what eats the
  // next one if the route clicks into it. So wait for the bag to be shut.
  await s.waitFor(() => d.propState("pattybag") === "idleclosed", "the bag to close on the swap");

  // c15 puts the doll back together on the way out of "patty 3", c6 leaves the
  // stage from "patty 1" — the same button on both. Clicked with a retry, because
  // a `trackbut` press that lands in someone else's `flushevents()` is simply gone
  // and there is nothing to read afterwards that says so; a player clicks again.
  for (const flat of ["patty 1", null]) {
    for (let press = 1; press <= 3 && d.inFlat() !== flat; press++) {
      await d.clickAt(TRACKBUT_OK.x, TRACKBUT_OK.y);
      await d.waitFor(() => d.inFlat() === flat, `the ${flat ?? "stage"} to come up`, 4000);
    }
    expect(d.inFlat(), "out of the doll").toBe(flat);
  }

  // a14 is two scenes on one road with one object each: the doll in
  // Scene1/View11, the door in Scene2/View21. At neckphase 8 the door runs
  // `kickout()` instead of letting us out quietly.
  const door = await nav.faceStandpoint(["view21"], ["scene2"]);
  expect(door.ok, door.reason).toBe(true);
  expect(await d.clickHotspot("door"), "the cabin door").toBe(true);
  if (d.conversing()) {
    const sasha = await nav.talk({ otherwise: "last", maxTurns: 40 });
    expect(sasha.ok, sasha.reason).toBe(true);
  }
  await reaches(9, "Sasha threw us out, which is the good outcome");

  // `neckphase = 9` is set by SASHA1.PUP's "kickout" lines, which is the MIDDLE of
  // c54: `kickout()` goes on to change the set to halla and then run
  // `takeneck("swap")` — a SECOND puppet, in which Sasha lets himself back into
  // his cabin, finds the necklaces swapped and grumbles about it. So the phase
  // arriving is not the scene ending, and a beat taken in between reads
  // `lockevents = 1`, which is the one field a browser diverged on here.
  //
  // Waiting for `lockevents` to go false does NOT fix that, and it was tried:
  // `takeneck` is what SETS it, so at the moment the phase lands it is already
  // false and the wait passes straight through. What ends the scene is the second
  // conversation, so wait for that and answer it, the way a player does.
  await d.waitFor(() => d.conversing(), "Sasha to come back and look at the doll", 20_000);
  if (d.conversing()) {
    const grumble = await nav.talk({ otherwise: "last", maxTurns: 20 });
    expect(grumble.ok, grumble.reason).toBe(true);
  }
  await s.waitFor(() => !s.num("lockevents"), "the swap scene to let go");
  expect(s.str("playerdeath"), "he found the swap, not a theft").toBe("");
  expect(d.propOwner("realneck"), "and did not take it back").toBe("frank");
  expect(d.setName(), "kickout puts us in the A deck hall").toBe("halla");
}

/**
 * Segment 6 — mission 1 phase 4 to mission 2: report to Penny Pringle.
 *
 * The route, from the scripts:
 *
 *   her door      HALLF2C.SET c514, the "knock" of Scene59/View76 — the F-deck
 *                 hall the 2nd class staircase lets out into. It runs
 *                 `penny1.pup` for any mission < 4 past phase 0, no knocking
 *                 about: `sendtoactor("penny", runpuppet(...))` straight away.
 *   the gate      PENNY1.PUP `m1p4()` opens with `if propowner("rubaiyat") !=
 *                 "frank" & propowner("photo1") != "frank"`, and that branch is a
 *                 dead end — two plaques, "I haven't found the Rubaiyat" and
 *                 "I'll do better next time", `joneshint = 1`, no advance. This
 *                 is why segment 5 has to come out of the boiler room holding the
 *                 book; the version that let Vlad have it could reach phase 4 and
 *                 never leave it.
 *   the debrief   past the gate it is a three-flag loop, and 109 only appears once
 *                 all three are set: 103 is the decoded telegram (`zeitclue =
 *                 "decoder"`, which segment 3's Enigma work set — the other branch
 *                 offers 104 for the Turkish bath's mirror), 105 is Vlad and Sasha
 *                 and plays `sasha.mov` on the way, and 101 is "Here is the
 *                 Rubaiyat" — offered instead of "I haven't found it" precisely
 *                 because we have it. Then 109 ("What do I do now?") gives her the
 *                 photo, calls `advancephase()`, and BOOTFILE case 4 rolls the
 *                 mission over: `resetpupvars()`, `mission = 2`, `phase = 0`.
 *
 * The necklace sub-plot rides along in front of the debrief — see {@link necklace}
 * for why it has to be somewhere in missions 1-3 and why this is the first window
 * that works. Nothing in it touches what Penny asks about, and Sasha's kickout
 * leaves us on A deck, so the trip to F deck below starts from a different place
 * than it used to and is otherwise unchanged.
 */
export async function segment6(s: Story): Promise<void> {
  const { nav, d, beat } = s;

  await beat("m1.4 with the Rubaiyat, in the engine room");
  expect(s.num("mission")).toBe(1);
  expect(s.num("phase")).toBe(4);
  // `propowner`, not `handItem`: the gate below reads the owner, and a savegame
  // round trip keeps possession but comes back with an empty hand (the checkpoint
  // this resumes from has `handitem = ""` where the live run had "rubaiyat").
  expect(d.propOwner("rubaiyat"), "the whole point of the last segment").toBe("frank");

  // -- the necklace, while mission 1 phase 4 is still open -------------------
  await necklace(s);
  await beat("m1.4 the necklace is ours");

  // -- F deck, her cabin ----------------------------------------------------
  const hall = await travelPast(s, "hallf2c");
  expect(hall.ok, hall.reason).toBe(true);
  const door = await nav.faceStandpoint(["view76"], ["scene59"]);
  expect(door.ok, door.reason).toBe(true);
  expect(await d.clickHotspot("knock"), "knocked on her door").toBe(true);

  // -- the debrief ----------------------------------------------------------
  await s.waitFor(() => d.conversing(), "Penny to answer");
  expect(String(d.flow().zeitclue), "the telegram, not the bath mirror").toBe("decoder");
  // 103 drops straight into `zeitelgram()`, a sub-conversation with its own two
  // plaques (101 where the book was, 102 what Zeitel is trading it for) and a
  // `puppetscramble()` that shuffles their order — which is why a route names
  // bevel IDS and not positions. 102 is the one that ends it.
  const debrief = await nav.talk({ say: [103, 101, 102, 105, 101, 109], maxTurns: 80 });
  expect(debrief.ok, debrief.reason).toBe(true);
  expect(d.propOwner("photo1"), "she keeps the photograph").toBe("penny");

  await beat("m2.0 mission 1 signed off");
  expect(s.num("mission"), "her thanks rolled the mission over").toBe(2);
  expect(s.num("phase"), "and reset the phase").toBe(0);
}

/**
 * Segment 7 — mission 2 phase 0: Mr. Thayer's telegram, collected and sent.
 *
 * Phase 0 is a chain, and the Purser is the whole of it: his dispatcher
 * (PURS1.PUP c6) offers a different bevel 102 for each value of
 * `actorowner("purs")`, and the phase only ends once that ladder has been walked
 * to "left2" and the car keys are in hand — none -> sendgram -> sentgram ->
 * left1 -> none2 -> findcuff -> foundcuff -> left2. This segment takes the first
 * rung and stops at the wireless room's door, for the reason at the foot of it.
 *
 *   his office     is a KEYDOWN, not a hotspot. GSTAIR3.SET c234 fires at `view36`
 *                  with the door open and `savedeck = "c"` — and gstair3 arrives
 *                  on B deck, so its own stairs flip the deck first (the same
 *                  Scene13/View33 walk the regression suite pins).
 *   getting him    `dopuppet()` plays mainc.mov and only opens the puppet if the
 *                  clip ends on an action frame. It PARKS instead, and one of its
 *                  regions is a type-2 named "openit" — his window. Clicking that
 *                  runs the clip on to the frame that opens `purs1.pup`, which is
 *                  why this uses `clickMovie` and not `rush`: a parked movie is a
 *                  question, and rush is right to refuse it.
 *   the errand     bevel 102 at "none" is "What about Mr. Thayer?" -> `thayer()`,
 *                  where 101 ("Could I help?") hands over `thayergram` and sets
 *                  the owner to "sendgram".
 *   leaving         ESC, and only ESC — see the comment at the gesture.
 *   Morrow          his permission SURVIVES the mission rollover, and the earlier
 *                   reading of this route — that he heads you off twice and has to
 *                   be persuaded again — was an artefact of the port not saving
 *                   actor owners. A checkpoint taken at the end of segment 6 came
 *                   back with every actorowner at its default, so he had forgotten
 *                   letting you in. Now that they are saved (src/df/savegame.ts
 *                   SavedActor) he remembers: `resetpupvars()` on the rollover
 *                   zeroes the puppet's GLOBALS (morrowphase goes to 0) and leaves
 *                   `actorowner("morrow") = "enterwireless"` alone, which is what
 *                   DECKBD.SET c110 actually reads. The retry below is kept
 *                   because an interception is still possible and answering it is
 *                   the same gesture either way.
 *   the key         WIRELESS.STG c29 `tx()` promotes "sendgram" to "sentgram" on
 *                   ANY morse key, so one tap at the apparatus sends it.
 *
 * This used to be one segment rather than two, because `actorowner` did not
 * survive a savegame and a checkpoint taken here brought the Purser back at
 * "none" with his errand forgotten. It is split at m2gram now that the actor
 * container is written (docs/formats/savegame.md), and segment 8's first
 * assertion is his rung — so the playthrough is the regression test for it.
 */
export async function segment7(s: Story): Promise<void> {
  const { nav, d, beat } = s;

  await beat("m2.0 mission 2 begins");
  expect(s.num("mission")).toBe(2);
  expect(s.num("phase")).toBe(0);
  expect(s.actorOwner("purs"), "his ladder starts at the bottom").toBe("none");

  // -- the Purser's office ---------------------------------------------------
  const there = await nav.travel("gstair3");
  expect(there.ok, there.reason).toBe(true);
  for (let flip = 0; flip < 4 && String(d.flow().savedeck) !== "c"; flip++) {
    const stairs = await nav.faceStandpoint(["view33"], ["scene13"]);
    expect(stairs.ok, stairs.reason).toBe(true);
    await d.pressSpace();
    await d.pressUp();
  }
  expect(String(d.flow().savedeck), "his floor").toBe("c");

  const at = await nav.faceStandpoint(["view36"]);
  expect(at.ok, at.reason).toBe(true);
  await d.pressSpace();
  expect(d.propVisible("door"), "the office door is open").toBe(true);
  await d.pressUp();
  const window = await nav.clickMovie((r) => r.target === "openit");
  expect(window.ok, window.reason).toBe(true);
  await s.waitFor(() => d.conversing(), "the Purser to look up");

  // -- the errand ------------------------------------------------------------
  const errand = await nav.talk({ say: [102, 101], otherwise: "last", maxTurns: 40 });
  expect(errand.ok, errand.reason).toBe(true);
  expect(d.propOwner("thayergram"), "he handed over the message").toBe("frank");
  expect(s.actorOwner("purs"), "and expects it sent").toBe("sendgram");

  // -- out of the office -----------------------------------------------------
  // ESC, and only ESC. `dopuppet()` RECURSES: conversation over, it plays
  // mainc.mov again and parks again, and it only stops when `actorowner("purs")`
  // reaches "left1" or "left2" — several rungs away. None of the parked regions
  // gets you out either: type-6 and "endit" both end the clip ON an action frame,
  // so the puppet just opens again (measured — eight rounds of click, "Good
  // night", click, "Good night"). Aborting is different, and the reason is in
  // docs/formats/mov.md: an abort does NOT run the frame's action, which is
  // exactly what dopuppet() tests. Without this the segment ends with a movie
  // still parked and the viewer busy, and every gesture after it is refused.
  await d.skipMovie();
  await s.waitFor(() => !d.moviePlaying() && !d.conversing(), "the office to let go");
  expect(d.inFlat(), "out of his office").toBe(null);
  await beat("m2.0 Thayer's telegram to send");

  // -- across the boat deck, past Morrow -------------------------------------
  // He remembers mission 1 — see the header. Should he head you off anyway, the
  // answer is segment 3's persuasion plaque for plaque, and an interception with
  // no plaques at all makes `talk` report "ended before saying …", which is not a
  // failure.
  expect(s.actorOwner("morrow"), "his permission survived the rollover").toBe("enterwireless");
  let toWireless = await nav.travel("wireless");
  for (let tries = 0; tries < 3 && !toWireless.ok; tries++) {
    if (d.conversing()) {
      await nav.talk({ say: [103, 101, 101, 103, 103, 102, 999], otherwise: "last", maxTurns: 140 });
    }
    toWireless = await nav.travel("wireless");
  }
  expect(toWireless.ok, toWireless.reason).toBe(true);
  await beat("m2.0 into the wireless room");

  // -- NEXT: switching the apparatus to transmit -----------------------------
  // Stops here. Sending is NOT one tap after all: WIRELESS.STG c29's keydown
  // exits unless `propowner("tapperdown") = "tx"`, which only `setuptx()` sets,
  // and `openflat()` only calls that when the set is powered AND switched to
  // transmit — `propowner("senderhandle") = "on"`, `tunerknob` = "on" and
  // `breakerhandle` = "tx". Segment 3 only ever used this room in RECEIVE, so
  // those three are the next thing to work out, and they are prop gestures in the
  // flat rather than anything the ship graph knows about.
  const apparatus = await nav.hunt("wireless");
  expect(apparatus.ok, apparatus.reason).toBe(true);
  expect(d.inFlat(), "the apparatus close-up is up").toBe(WIRELESS_MAIN);
  await beat("m2.0 at the wireless, ready to transmit");
}

/**
 * Segment 8 — sending Mr. Thayer's telegram, which means working the wireless
 * set for the first time.
 *
 * Starts from a checkpoint like every other segment. It could not, until actor
 * owners were saved (they are in the format on their own grid — src/df/savegame.ts
 * SavedActor): a checkpoint taken here used to come back with the Purser at
 * "none", no memory of the errand, and this segment's first assertion failing.
 *
 * A save records the room, not the close-up that was open over it — so a resumed
 * run is standing in the wireless room and opens the apparatus again, which is
 * what a player reloading here would do. Entering the room re-runs
 * `WIRELESS.SHP openshop`, which is why the set is found powered down whichever
 * way the segment is reached.
 *
 * What it took to find, all of it now in nav/wireless.ts: the morse key is dead
 * unless `propowner("tapperdown") = "tx"`, only `setuptx()` sets that, and
 * `openflat()` calls it only if the set is ALREADY powered, switched to send and
 * tuned when the operating flat opens. So this is four gestures in a fixed order
 * and not one — and the tuning is the long one, because `openshop()` parks the
 * needle at 200 and the transmit band is 34..40 in steps of two.
 *
 * The send itself is the cheapest thing in the segment. `tx()` promotes the
 * Purser from "sendgram" to "sentgram" on the FIRST morse key that maps to a
 * letter, before it has spelled anything: the routine that watches for the word
 * "thayer" (`checkmess`) is never called from anywhere in the corpus — grep it —
 * so tapping the message out is flavour, not mechanism.
 */
export async function segment8(s: Story): Promise<void> {
  const { nav, d, beat } = s;

  await beat("m2.0 in the wireless room, telegram in hand");
  expect(s.num("mission")).toBe(2);
  expect(s.num("phase")).toBe(0);
  expect(s.actorOwner("purs"), "he is waiting on the telegram").toBe("sendgram");
  expect(d.propOwner("thayergram"), "which we are carrying").toBe("frank");
  expect(s.actorOwner("morrow"), "and Morrow's permission held").toBe("enterwireless");

  // -- the apparatus ---------------------------------------------------------
  const apparatus = await nav.hunt("wireless");
  expect(apparatus.ok, apparatus.reason).toBe(true);
  expect(d.inFlat(), "the apparatus close-up is up").toBe(WIRELESS_MAIN);

  // -- switch the set to transmit --------------------------------------------
  // Segment 3 read the message stack off this flat without touching a control;
  // none of the three had ever been moved, so the set is powered down, in neither
  // mode, and parked at the top of the dial.
  expect(d.propOwner("senderhandle"), "no power").toBe("off");
  expect(d.propOwner("breakerhandle"), "neither send nor receive").toBe("off");
  expect(d.propValue("tunerneedle"), "where openshop() parks the needle").toBe(200);

  const transmit = await switchToTransmit(d);
  expect(transmit.ok, transmit.reason).toBe(true);
  expect(d.inFlat(), "at the morse key").toBe(WIRELESS_PANELS.tapper);
  expect(d.propOwner("tapperdown"), "setuptx() ran").toBe("tx");
  await beat("m2.0 the wireless set switched to transmit");

  // -- send it ---------------------------------------------------------------
  // One key is the whole gesture (see the header). The readout is the proof it
  // was HEARD rather than swallowed: `tx()` only reaches `drawtext` after the
  // key maps to a letter and a morse string, and drawtext advances messagebox by
  // the width of what it drew.
  const column = d.propValue("messagebox");
  await d.typeKey("t");
  expect(d.propValue("messagebox"), "the letter went out on the air").toBeGreaterThan(column);
  expect(s.actorOwner("purs"), "and the errand is done").toBe("sentgram");
  await beat("m2.0 Thayer's telegram sent");

  // -- out of the wireless room ----------------------------------------------
  // Two OKs: the operating flat's own (WIRELESS.STG c32, which also puts the gram
  // away) and then the desk's, which is the one that closes the stage.
  expect(await d.clickThing("ok"), "off the morse key").toBe(true);
  expect(d.inFlat(), "back at the desk").toBe(WIRELESS_MAIN);
  expect(await d.clickThing("ok"), "and out of the apparatus").toBe(true);
  expect(d.inFlat(), "back in the room").toBe(null);
}


/**
 * Segment 9 — reporting the telegram sent, and reading the passenger manifest.
 *
 * Two rungs of the Purser's ladder in one visit, because the second happens
 * whether you ask for it or not: `dopuppet()` hands straight on to
 * `domanifest()` as soon as the conversation leaves him at "left1", so the
 * manifest is up before you have moved.
 *
 *   the office     the same walk as segment 7 — gstair3 arrives on B deck, its own
 *                  stairs flip `savedeck` to "c", then view36, space, up. And the
 *                  same parked `mainc.mov` with its "openit" region.
 *   the report     bevel 102 is "I sent Mr. Thayer's telegram." -> `sentgram()`,
 *                  whose two plaques are BOTH id 101 — either one sets "left1",
 *                  takes the gram back (`dumpinven`) and sends him out. No ESC
 *                  needed this time: `dopuppet()` only recurses while he is still
 *                  in the room, and "left1" is one of the two rungs that stop it.
 *   the manifest   `maino1.mov` is a parked frame with five regions, and the one
 *                  targeting "blackframe" is a type-4 push that chains into
 *                  **`man.mov`** — the manifest itself, a 43-frame book. Odd frames
 *                  are pages; each carries an OK plaque bottom-right (which pops
 *                  the return stack) and a page-forward region on the right, so it
 *                  is read by clicking "frame3" then "frame5".
 *   the rung       `man.mov` declares action frame 2 = "frame5", so PAGING THAT FAR
 *                  is what tells `domanifest()` you read it — and only then does
 *                  `actionframe(2)` promote him to "none2". The other route in is
 *                  `actorowner("bsea") = "keyhint"`, which is the hold steward
 *                  telling you about the car keys; this route does not need it.
 *                  Neither `maino1.mov` nor `maino2.mov` declares an action frame
 *                  of its own — both borrow `man.mov`'s through the chain, which is
 *                  worth knowing because `docarkeys()` wants action frame 1 and
 *                  nothing in that chain of FRAMES has one — its parked regions
 *                  are what carry it (docs/formats/mov.md, and segment 11).
 */
export async function segment9(s: Story): Promise<void> {
  const { nav, d, beat } = s;

  await beat("m2.0 the telegram sent");
  expect(s.num("mission")).toBe(2);
  expect(s.num("phase")).toBe(0);
  expect(s.actorOwner("purs"), "he is waiting to hear it went").toBe("sentgram");

  // -- back to his office ----------------------------------------------------
  const there = await nav.travel("gstair3");
  expect(there.ok, there.reason).toBe(true);
  for (let flip = 0; flip < 4 && String(d.flow().savedeck) !== "c"; flip++) {
    const stairs = await nav.faceStandpoint(["view33"], ["scene13"]);
    expect(stairs.ok, stairs.reason).toBe(true);
    await d.pressSpace();
    await d.pressUp();
  }
  expect(String(d.flow().savedeck), "his floor").toBe("c");
  const at = await nav.faceStandpoint(["view36"]);
  expect(at.ok, at.reason).toBe(true);
  await d.pressSpace();
  expect(d.propVisible("door"), "the office door is open").toBe(true);
  await d.pressUp();
  const window = await nav.clickMovie((r) => r.target === "openit");
  expect(window.ok, window.reason).toBe(true);
  await s.waitFor(() => d.conversing(), "the Purser to look up");

  // -- "I sent Mr. Thayer's telegram." ---------------------------------------
  // 102 opens `sentgram()`, which offers two plaques that share the id 101; talk
  // answers the first it finds and either sets the rung.
  const told = await nav.talk({ say: [102, 101], otherwise: "last", maxTurns: 60 });
  expect(told.ok, told.reason).toBe(true);
  expect(s.actorOwner("purs"), "he goes off to tell the Thayers").toBe("left1");
  expect(d.propOwner("thayergram"), "and takes the message back").not.toBe("frank");

  // -- the manifest ----------------------------------------------------------
  // Not our gesture: the same handler plays it the moment he leaves.
  expect(await d.waitFor(() => d.movieWaiting(), "the manifest to come up", 20_000)).toBe(true);
  const opened = await nav.clickMovie((r) => r.target === "blackframe", "opening the manifest");
  expect(opened.ok, opened.reason).toBe(true);
  // page by page, named for the page each click turns TO — the third is the one
  // the movie declares as its action frame, and reaching it is the whole point
  for (const page of ["frame3", "frame5"]) {
    const turned = await nav.clickMovie((r) => r.target === page, `paging to ${page}`);
    expect(turned.ok, turned.reason).toBe(true);
  }
  // the OK plaque bottom-right: a type-2 hop to the frame that POPS back to
  // maino1.mov, which parks again on its own first frame
  const shut = await nav.clickMovie((r) => r.target === "frame6", "closing the manifest");
  expect(shut.ok, shut.reason).toBe(true);
  const down = await nav.clickMovie((r) => r.target === "WIN 3", "putting it down");
  expect(down.ok, down.reason).toBe(true);
  await s.waitFor(() => !d.moviePlaying() && !d.conversing(), "the office to let go");

  await beat("m2.0 the manifest read");
  // the promotion happens AFTER the whole chain closes: domanifest() only tests
  // actionframe(2) once `playmovie` has returned
  expect(s.actorOwner("purs"), "reading it moved him on").toBe("none2");
  expect(d.inFlat(), "out of his office").toBe(null);
}

/**
 * Walk into the Purser's office and get him to look up.
 *
 * Every rung of his ladder is another visit, and the way in is the same each time:
 * gstair3 arrives on B deck, so its own stairs flip `savedeck` to "c" first, then
 * view36, space for the door, up for the KEYDOWN that runs `dopurser()` — and then
 * `mainc.mov`, which PARKS, and whose type-2 region named "openit" is his window.
 * Segments 7 and 9 each wrote this out; the third copy is where it becomes a
 * function.
 */
async function enterPursersOffice(s: Story): Promise<{ ok: boolean; reason?: string }> {
  const { nav, d } = s;
  const there = await nav.travel("gstair3");
  if (!there.ok) return there;
  for (let flip = 0; flip < 4 && String(d.flow().savedeck) !== "c"; flip++) {
    const stairs = await nav.faceStandpoint(["view33"], ["scene13"]);
    if (!stairs.ok) return stairs;
    await d.pressSpace();
    await d.pressUp();
  }
  if (String(d.flow().savedeck) !== "c") {
    return { ok: false, reason: `savedeck is "${d.flow().savedeck}", not "c"` };
  }
  const at = await nav.faceStandpoint(["view36"]);
  if (!at.ok) return at;
  // Press until the door answers, rather than once and hope. `Viewer.keyDown`
  // drops NEW input outright while `inputLocked` — `busy || scriptBusy` — and a
  // carried game can arrive here still settling the walk that got it to view36,
  // where a game resumed from a checkpoint arrived quiescent by construction.
  // The press itself is idempotent: gstair3.set c238's mousedown is
  // `sendtoprop("door", setupprop("gs3-purs"))` at savedeck "c", with no toggle.
  let opened = false;
  for (let i = 0; i < 4 && !opened; i++) {
    await d.pressSpace();
    opened = await d.waitFor(() => d.propVisible("door"), "the office door to open", 4000);
  }
  if (!opened) {
    const where = d.at();
    return {
      ok: false,
      reason: `the office door did not open (${d.setName()} scene${where.sceneIdx}/view${where.viewIdx}, ` +
        `savedeck "${d.flow().savedeck}", flat ${d.inFlat() ?? "none"})`,
    };
  }
  await d.pressUp();
  const window = await nav.clickMovie((r) => r.target === "openit");
  if (!window.ok) return window;
  await s.waitFor(() => d.conversing(), "the Purser to look up");
  return d.conversing() ? { ok: true } : { ok: false, reason: "he never looked up" };
}

/**
 * Segment 10 — taking the cufflink errand, and finding the cufflink.
 *
 *   the errand     bevel 102 at "none2" is "I need to get into the cargo room."
 *                  (it becomes "Could I borrow some car keys?" once the hold
 *                  steward has dropped his hint, which this route does not need)
 *                  -> `getlink()`, whose own 102 "Can I find the cufflink for you?"
 *                  sets "findcuff" and ends the conversation.
 *   leaving        ESC again. "findcuff" is not one of the two rungs that stop
 *                  `dopuppet()` recursing, so the office replays `mainc.mov` and
 *                  parks on it exactly as in segment 7.
 *   where it is    RECEPT1C, the C-deck reception. Its c5 fires for any object whose
 *                  name contains "cufflink" — Scene11 has three chairs and View25
 *                  faces all three — setting `cuffchair` to the one clicked and
 *                  opening `cuff.stg` on the matching flat. `CUFF.SHP openshop`
 *                  shows the link only for **`cufflink1`**, so the other two chairs
 *                  are wrong by construction rather than by luck.
 *   picking it up  `cuffcuff`'s mousedown is a three-step zoom — "small" -> "med"
 *                  -> "big" — and only the click after that calls `addcuff()`. So
 *                  the gesture is three clicks on the same prop, and
 *                  `INVEN.SHP addinven` is what promotes him to "foundcuff". (The
 *                  flat's OK finishes the job for a link left mid-zoom, which is a
 *                  courtesy this route does not lean on.)
 */
export async function segment10(s: Story): Promise<void> {
  const { nav, d, beat } = s;

  await beat("m2.0 the manifest read, outside the office");
  expect(s.num("mission")).toBe(2);
  expect(s.num("phase")).toBe(0);
  expect(s.actorOwner("purs"), "where the manifest left him").toBe("none2");

  // -- the errand ------------------------------------------------------------
  const office = await enterPursersOffice(s);
  expect(office.ok, office.reason).toBe(true);
  const errand = await nav.talk({ say: [102, 102], otherwise: "last", maxTurns: 60 });
  expect(errand.ok, errand.reason).toBe(true);
  expect(s.actorOwner("purs"), "he has asked us to find it").toBe("findcuff");

  // ESC, as in segment 7 — this rung does not stop dopuppet() recursing
  await d.skipMovie();
  await s.waitFor(() => !d.moviePlaying() && !d.conversing(), "the office to let go");
  expect(d.inFlat(), "out of his office").toBe(null);
  await beat("m2.0 the cufflink errand");

  // -- the reception ---------------------------------------------------------
  const reception = await nav.travel("recept1c");
  expect(reception.ok, reception.reason).toBe(true);

  // -- Max first, and that IS the fix ----------------------------------------
  // This is the first time mission 2 walks into recept1c, and `RECEPT1C.SET
  // openset` puts Max there for the whole of it. His idle (gang.cst c350,
  // `maxidle`) is:
  //
  //     if realdist (me) < hotdist ()
  //         if actorvalue (me) <= 0
  //             hasattention (4)      <- walks over and starts talking
  //         endif
  //         clearattention ()         <- once you HAVE talked to him, never again
  //
  // so his claim on you is discharged by one conversation, whatever is said:
  // `dopuppet` ends `actorvalue (target, actorvalue (target) + 1)` (gang.cst c1)
  // for every actor that is not the cast itself. Until that happens the hunt
  // below is racing a four-second timer, and losing it is not a near miss — his
  // puppet holds the dispatch, a visible puppet makes SetViewer.busy true, so
  // every gesture is swallowed and the navigator paces on the spot until its
  // budget runs out. Measured: `gave up hunting for cufflink1 in recept1c`, in a
  // full browser run, which then fell back to loading and cost 46 of the run's 50
  // divergences downstream. Headless does not lose it — but it is the same race
  // and only the pacing differs, which is the sort of thing that stops being true.
  //
  // Nothing is skipped by choosing the moment: `hasattention` accosts by sending
  // Max his own `mousedown(0)`, which is the same `walktopuppet` a click gives
  // him. His phase-0 branch is MAX1.PUP's `sawmacy()` — he says he has seen Macy,
  // sets `maxphase = 2`, and offers three replies that only change what he says
  // next. No item moves and no phase or mission advances. `maxphase = 2` also
  // closes the `maxphase < 2` branch that has him accost you on deckbd, so this
  // settles that one too. Segment 13 holds the same conversation for the same
  // reason one phase later, which is where the pattern comes from.
  const max = await nav.accost("max");
  expect(max.ok, max.reason).toBe(true);
  const sawMacy = await nav.talk({ otherwise: "last", maxTurns: 80 });
  expect(sawMacy.ok, sawMacy.reason).toBe(true);
  expect(s.num("maxphase"), "he has told us about Macy").toBe(2);
  expect(d.conversing(), "and stopped talking").toBe(false);
  await beat("m2.0 Max in the reception");

  // Back to the standpoint the chairs are on before hunting. `walktopuppet` walks
  // Frank to whoever he is talking to, so the conversation above leaves him
  // somewhere the arrival never put him — and the sweep started from there walked
  // out of the room (`left recept1c while hunting for cufflink1`) instead of
  // finding a chair. View25 is where Scene11's three chairs are all in shot, which
  // is the standpoint this segment took the cufflink from before and the one
  // segment 12 comes back to.
  const chairs = await nav.faceStandpoint(["view25"]);
  expect(chairs.ok, chairs.reason).toBe(true);

  const chair = await nav.hunt("cufflink1");
  expect(chair.ok, chair.reason).toBe(true);
  expect(String(d.flow().cuffchair), "the chair we chose").toBe("cufflink1");
  expect(d.inFlat(), "its close-up").toBe("cuff 1");
  expect(d.propVisible("cuffcuff"), "and the cufflink is under it").toBe(true);

  // -- three clicks ----------------------------------------------------------
  for (const step of ["med", "big", "taken"]) {
    expect(await d.clickThing("cuffcuff"), `clicking through to ${step}`).toBe(true);
  }
  expect(d.propOwner("cufflink"), "Straus's cufflink").toBe("frank");
  expect(s.actorOwner("purs"), "and addinven told the Purser").toBe("foundcuff");

  // The segment stops here, in the close-up, deliberately — and that is now a
  // choice rather than a workaround. It used to be the one cross-host divergence
  // nobody could close: this flat's OK closes headless and would not in a browser.
  // The button was innocent. `RECEPT1C.SET openset` places Max in this room for
  // the whole of mission 2, `hasattention(4)` sends his own mousedown after four
  // seconds of proximity without asking what you are doing, and the OK was being
  // pressed into an engine held by his conversation. `actordist` answers the 32000
  // not-present sentinel through a stage flat now (docs/verification.md), so the
  // close-up stops the clock instead of running it down, and the OK closes on the
  // first press in both hosts. Leaving it up costs nothing — a savegame records
  // the room and not the close-up over it — so it stays as written, which is one
  // fewer golden to re-record.
  await beat("m2.0 the cufflink found");
}

/**
 * Segment 11 — the cufflink handed over, and the car keys off the office wall.
 *
 * This is the segment that settled whether the car keys can be had at all, and it
 * settled it the other way (docs/formats/mov.md, "a chain can start at a region").
 * The reading was that they are unobtainable: `docarkeys()`
 * gives them on `actionframe(1)`, and neither `maino2.mov` nor the `man.mov` it
 * chains to from its "blackframe" declares an action frame 1. Both halves of that
 * are true and the conclusion was still wrong, because a movie's FRAMES are not the
 * only thing that chains — its parked REGIONS do too:
 *
 *   `maino2.mov` frame 0 is the Purser's desk, and it parks with two type-4
 *   regions that share the target "win 1". One chains to `purspost.mov` (the post
 *   rack) and the other to **`key.mov`** — which declares action frame 1 = "keys 3".
 *
 * So the keys are a gesture, not a gift, and `key.mov` is built as a pair of
 * choices: its frame 0 parks on the keys with a plaque and a type-2 region to
 * "KEYS 3". The plaque steps to frame 1, which is a type-5 POP — look and leave,
 * back to the desk with nothing. "KEYS 3" is the action frame itself, and its
 * plaque steps to frame 3, a type-1 EXIT that ends the whole chain (mov.md: 1
 * exits, 5 pops) — take them and you are out of the office. Three clicks: the
 * keys on the wall, the keys in the close-up, the plaque. Then `docarkeys()` reads
 * `actionframe(1)`, and it is true.
 *
 * The lesson worth keeping: `actionframe()` is set by whatever movie the chain is
 * IN when it passes the frame, and the chain can be entered by a region. Reading
 * only the frame table of the movie a script names is not reading the chain.
 *
 *   the handover  bevel 102 at "foundcuff" — he takes the cufflink
 *                 (`giveinven("cufflink", "purser")`), sets "left2" and leaves,
 *                 which is the second of the two rungs that stop `dopuppet()`
 *                 recursing. No ESC needed.
 *   the keys      `dopuppet()` hands to `docarkeys()`, which refuses if the keys
 *                 are already owned and otherwise plays the desk.
 */
export async function segment11(s: Story): Promise<void> {
  const { nav, d, beat } = s;

  await beat("m2.0 the cufflink in hand");
  expect(s.num("mission")).toBe(2);
  expect(s.num("phase")).toBe(0);
  expect(s.actorOwner("purs"), "he is waiting for his cufflink").toBe("foundcuff");
  expect(d.propOwner("cufflink"), "which we have").toBe("frank");
  expect(d.propOwner("carkeys"), "and no keys yet").toBe("none");

  // -- the handover ----------------------------------------------------------
  const office = await enterPursersOffice(s);
  expect(office.ok, office.reason).toBe(true);
  const handover = await nav.talk({ say: [102], otherwise: "last", maxTurns: 60 });
  expect(handover.ok, handover.reason).toBe(true);
  expect(d.propOwner("cufflink"), "he pockets it").toBe("purser");
  expect(s.actorOwner("purs"), "and goes off happy").toBe("left2");

  // -- the desk --------------------------------------------------------------
  // docarkeys() plays it the moment he leaves, and it PARKS.
  expect(await d.waitFor(() => d.movieWaiting(), "his desk to come up", 20_000)).toBe(true);
  // the region that chains to key.mov — NOT the one beside it that shares its
  // target and chains to the post rack (see the header)
  const keys = await nav.clickMovie((r) => r.event === "key.mov", "the keys on the wall");
  expect(keys.ok, keys.reason).toBe(true);
  // in the close-up, the type-2 region to "KEYS 3" is the action frame itself
  const taken = await nav.clickMovie((r) => r.target?.toLowerCase() === "keys 3", "taking them");
  expect(taken.ok, taken.reason).toBe(true);
  // its plaque walks on to the type-1 exit, which pops back to the desk
  // its plaque is the only region left, and it walks on to KEY.MOV's type-1
  // exit — which ends the whole CHAIN rather than popping back to the desk
  // (docs/formats/mov.md: 1 exits, 5 pops). So this is the last click, and
  // `docarkeys()` reads actionframe(1) the moment it lands.
  const done = await nav.clickMovie((r) => r.type === 6, "pocketing them");
  expect(done.ok, done.reason).toBe(true);
  await s.waitFor(() => !d.moviePlaying() && !d.conversing(), "the office to let go");

  await beat("m2.0 the car keys");
  expect(d.propOwner("carkeys"), "the keys are ours — 2a was a misreading").toBe("frank");
  expect(d.inFlat(), "out of his office").toBe(null);
}

/**
 * Segment 12 — the cargo hold, the car, and the end of mission 2 phase 0.
 *
 * The painting is not lying in the hold. It is in a crate by the car, the car is
 * dark, and the hold is three rooms:
 *
 *   the door       is not a door while the steward is standing at it. `carghall`
 *                  c60's mousedown forwards the click to `bsea` whenever he is
 *                  visible, and `openset` keeps him there until `bseaphase = 1`.
 *                  So the gesture is: click the door, talk to the man in the way.
 *   the way in     BSEA1.PUP's carghall branch has no plaques at all. With
 *                  `propowner("carkeys") = "frank"` and `bseaphase = 0` it speaks
 *                  five lines, sets `bseaphase = 1` and walks you in ITSELF —
 *                  screentoblack, a door sound, `hallside = "port"`, then
 *                  `changeset("cargo", "scene78", "view100")` — finishing the
 *                  conversation on the other side. Without the keys the same click
 *                  gets `getlost()` and his key hint instead.
 *   to the car     `CARGO.SET` c174: up at **view106** with the door open. Not
 *                  view16, which is the other way to the same place and is guarded
 *                  on `hallside` — and the steward just set `hallside = "port"`,
 *                  which is the branch that sends you to `bing` instead.
 *   dark or lit    the car is TWO sets, and c121 hands you to `bind` while
 *                  `carlights` is false and `binl` once it is true. Clicking the car
 *                  is what changes it, and each set plays the movie for the state it
 *                  is IN: `bind` plays `lightoff.mov`, which parks on the dark
 *                  headlight with a big region over the lamp (type 6, advance) and a
 *                  plaque beside it. Advancing runs the lamp's animation to a frame
 *                  named **"lightson"** — which is that movie's action frame 1 — so
 *                  the lamp is the switch and the plaque is the way out that changes
 *                  nothing. `bind` c56 then reads `actionframe(1)` into `carlights`
 *                  and `changeset`es to whichever set matches. (`binl` plays
 *                  `lightson.mov`, the mirror image: its plaque holds the action
 *                  frame and its big region chains BACK to lightoff.mov.)
 *   the crate      `binl` c58, and only with the lights on: it opens `cargo.stg`,
 *                  the flat the painting actually lives on, and takes the car keys
 *                  off you on the way (`giveinven("carkeys", "xxxfrank")`).
 *   the painting   `CARGO.SHP` c3: one click, `addinven("painting")` and
 *                  `advancephase()`. That is the phase boundary.
 *
 * One inherited deadline, worth knowing and not worth fearing: c58 gives the
 * painting to the Hackers instead — `propowner("painting", "hack")`, and advances
 * the phase anyway — when `frame() - paintframe > 10000`. `paintframe` is READ
 * there and assigned nowhere in the corpus, so its value is whatever the savegame
 * carries (339 here, from the template's lineage), and `frame()` counts displayed
 * frames from the start of the session. A resumed segment therefore begins with
 * `frame()` near zero and the difference NEGATIVE, so both hosts take the same
 * branch deterministically. A real player deep into a long session would not, and
 * BSEA1.PUP's phase-1 branch has lines for both outcomes — so "the Hackers got it"
 * is a supported story state, not a bug. This route tests the other one.
 */
export async function segment12(s: Story): Promise<void> {
  const { nav, d, beat } = s;

  await beat("m2.0 the car keys in hand");
  expect(s.num("mission")).toBe(2);
  expect(s.num("phase")).toBe(0);
  expect(d.propOwner("carkeys"), "which is what the steward wants to see").toBe("frank");
  expect(s.num("bseaphase"), "and he has not let anyone through yet").toBe(0);

  // -- the steward in the doorway --------------------------------------------
  const hall = await nav.travel("carghall");
  expect(hall.ok, hall.reason).toBe(true);
  const atDoor = await nav.faceStandpoint(["view20"], ["scene21"]);
  expect(atDoor.ok, atDoor.reason).toBe(true);
  expect(await d.clickHotspot("door"), "the door hotspot, which is really him").toBe(true);
  await s.waitFor(() => d.conversing(), "the steward to turn round");

  // no plaques: he talks, then takes you through the door himself
  const shown = await nav.talk({ maxTurns: 40 });
  expect(shown.ok, shown.reason).toBe(true);
  await s.waitFor(() => d.setName() === "cargo", "to be let into the hold");
  expect(s.num("bseaphase"), "he has done his part").toBe(1);
  await beat("m2.0 in the cargo hold");

  // -- across the hold -------------------------------------------------------
  // The hold has two ends and `hallside` says which one you are at, because the
  // SAME door at view16 leads to `bing` from the port end and to the car from the
  // starboard end (CARGO.SET c121). The steward's teleport set "port", so the
  // route has to walk the length of the hold first: c1's keydown at **view18**
  // flips `hallside` and puts you down at the far end (scene6/view25). Nothing
  // else in the room changes it, and no other entrance to the hold sets "star"
  // except the boiler-room door — which itself needs "star" to be usable.
  expect(String(d.flow().hallside), "the steward let us in at the port end").toBe("port");
  const across = await nav.faceStandpoint(["view18"], ["scene5"]);
  expect(across.ok, across.reason).toBe(true);
  await d.pressUp();
  expect(String(d.flow().hallside), "walking the hold puts us at the other end").toBe("star");

  // -- down to the car -------------------------------------------------------
  const toCar = await nav.faceStandpoint(["view16"], ["scene5"]);
  expect(toCar.ok, toCar.reason).toBe(true);
  await d.pressSpace();
  expect(d.propVisible("door"), "the door at the starboard end is open").toBe(true);
  await d.pressUp();
  await s.waitFor(() => d.setName() === "bind", "the dark end of the hold");
  expect(Number(d.flow().carlights) || 0, "the car is dark").toBe(0);

  // -- the headlight ---------------------------------------------------------
  const atCar = await nav.faceStandpoint(["view16"], ["scene11"]);
  expect(atCar.ok, atCar.reason).toBe(true);
  expect(await d.clickThing("car"), "the car").toBe(true);
  expect(await d.waitFor(() => d.movieWaiting(), "the headlight to come up", 20_000)).toBe(true);
  // Two clicks, and the roles of the two regions SWAP between them. At "HEAD 1"
  // the big region over the lamp advances (into the lamp's animation) and the
  // plaque exits dark; the movie then parks again at "HEAD 16" with the lamp lit,
  // where the PLAQUE advances — to the frame named "lightson", which is the action
  // frame — and the big region goes back to dark. Either way it is the type-6
  // region on the frame, which is the one that advances.
  const flicked = await nav.clickMovie((r) => r.type === 6, "the lamp");
  expect(flicked.ok, flicked.reason).toBe(true);
  expect(await d.waitFor(() => d.movieWaiting(), "the lamp to come up lit", 20_000)).toBe(true);
  const lit = await nav.clickMovie((r) => r.type === 6, "leaving them on");
  expect(lit.ok, lit.reason).toBe(true);
  await s.waitFor(() => d.setName() === "binl", "the lit end of the hold");
  expect(Number(d.flow().carlights), "the lights are on").toBeTruthy();
  await beat("m2.0 the car's lights on");

  // -- the crate -------------------------------------------------------------
  const atCrate = await nav.faceStandpoint(["view17"], ["scene11"]);
  expect(atCrate.ok, atCrate.reason).toBe(true);
  expect(await d.clickThing("crate"), "the crate beside it").toBe(true);
  await s.waitFor(() => d.inFlat() !== null, "the crate to open");
  expect(d.inFlat(), "the crate's close-up").toBe("cargo 1");
  expect(d.propOwner("carkeys"), "opening it took the keys back").not.toBe("frank");

  // -- the painting ----------------------------------------------------------
  const painting = await nav.hunt("cargopainting");
  expect(painting.ok, painting.reason).toBe(true);
  expect(d.propOwner("painting"), "the thing mission 2 is about").toBe("frank");
  expect(s.num("phase"), "and that is the phase boundary").toBe(1);
  expect(s.num("mission"), "still mission 2").toBe(2);

  expect(await d.clickThing("ok"), "out of the crate").toBe(true);
  await beat("m2.1 the painting recovered");
}

/**
 * NEXT: segment 13 — mission 2 phase 1. Who wants the painting now: the Purser's
 * bevel 103 ("I need an item back from your safe.") appears once
 * `propowner("painting") = "purser"`, so the phase looks like checking it in with
 * him — `getstuff()` is the branch that hands things back. BSEA1.PUP also has a
 * phase-1 branch in `cargo` with lines for both outcomes of the crate (see the
 * deadline note above), which is the other thread to read.
 */

/**
 * Travel, answering anyone who stops you on the way.
 *
 * `nav.travel` deliberately will not answer a conversation — which reply you give
 * is the story, so the navigator refuses to pick one (see its docblock). But a walk
 * across the ship can be interrupted by whoever happens to be standing there, and
 * once a puppet is visible the viewer is busy and EVERY later gesture is refused:
 * the planner then re-plans from the same standpoint until its budget runs out and
 * reports "gave up reaching …", which is what it did in the reception on the way to
 * the squash court — in a browser only, because who stops you and when depends on
 * random draws and on how many frames have gone by.
 *
 * So: travel, and if a conversation opens, close it politely and travel again.
 * Segment 7 does this by hand for Morrow at the wireless door; this is the same
 * gesture with nothing specific to Morrow in it.
 */
/**
 * What to ask Smethells: the German gentleman, the fencing, the way to the
 * squash court. All three, because his loop does not end until every one is
 * asked — and 888 ("Thank you") is the plaque that ends him, which is why this
 * must not be left to a generic answer.
 */
const SMETH_DIRECTIONS: TalkPlan = { say: [101, 102, 103], otherwise: "last", maxTurns: 80 };

/**
 * Travel, answering whoever stops us on the way.
 *
 * `answer` defaults to "say the last plaque", which for most interruptions is
 * the polite way out. It is a parameter because sometimes the person who stops
 * you is the person the route came to talk to, and then the generic answer
 * SPENDS the conversation: Smethells on the C-deck landing calls
 * `hasattention(2)` and walks up to you mid-approach, and "Thank you" ends him
 * before his three questions are asked. Hand that leg the real plan instead.
 */
async function travelPast(
  s: Story,
  dest: string,
  answer: TalkPlan = { otherwise: "last", maxTurns: 60 },
): Promise<{ ok: boolean; reason?: string }> {
  const { nav, d } = s;
  let arrived = await nav.travel(dest);
  for (let tries = 0; tries < 4 && !arrived.ok; tries++) {
    if (!d.conversing()) break;
    s.log?.(`someone stopped us on the way to ${dest}`);
    await nav.talk(answer);
    arrived = await nav.travel(dest);
  }
  return arrived;
}

/**
 * Where to click during a fencing point, and why those two columns.
 *
 * One click does two jobs, which is the whole trick to this minigame:
 *
 *   the ATTACK  `FENCE.STG mousedown` hands the point to `playerattack`, which
 *               reads a quadrant out of it — x against 256, y against 193 — and
 *               `compareattdef` scores if that quadrant is not one of the four
 *               Willie is guarding.
 *   the BLOCK   `playeridle` re-reads `mouse()` every tick and sets `playerblock`
 *               from the X ALONE: 346 and over is "right", under 136 is "left",
 *               and the whole middle is "none". Willie's attack lands unless
 *               `willieside = playerblock`, so the cursor has to be parked at one
 *               extreme or the other at the moment he lunges — and after a click
 *               the cursor is exactly where it clicked.
 *
 * So the route clicks in the column that guards the side Willie has chosen. The Y
 * is high (upper quadrant) for a second reason: `willieidle` calls
 * `pickdef(mouse())` every five ticks and fills its four defence slots from where
 * the cursor IS — the OPPOSITE quadrant first, at `fencelevel + 15`, down to the
 * cursor's own quadrant last at `fencelevel`. Attacking the quadrant you are
 * already hovering is therefore attacking the one he guards least: 5% at
 * fencelevel 5, against 20% for the far corner.
 */
const FENCE_COLUMN = { left: 100, right: 380, y: 100 };

/**
 * Segment 13 — mission 2 phase 1: the squash court, and the first fencing bout.
 *
 * Phase 1 is a minigame, and the first one in the port to be driven by anything.
 *
 *   the way in    Smethells stands on the C-deck landing at this phase
 *                 (`GSTAIR3.SET openset`, `savedeck = "c"`) and asks for your
 *                 attention himself — gang.cst c837 calls `hasattention(2)` while
 *                 `smethphase = 0`. His `fence()` holds three questions and does
 *                 not finish until all THREE have been asked (`while f1 = 0 |
 *                 f2 = 0 | f3 = 0`), and only then does it do the two things that
 *                 matter: `propowner("ring", "willie")` and `smethphase = 1`.
 *   the court     SQHALL.SET c258 is a keydown at view42 with the door open, and
 *                 it only takes the fencing branch when `mission = 2 & phase = 1 &
 *                 smethphase > 0` — otherwise you walk into an empty court. That
 *                 branch changesets to `squash` and calls `fence()`, which opens
 *                 Haderlitz's puppet with the message it insists on ("fence" —
 *                 WILFENC1's `runyoself` errors on anything else).
 *   the handicap  his three opening bevels SET THE DIFFICULTY, and the cheeky one
 *                 is the easy one: 101 "I don't fence" is `fencelevel = 25`, 102
 *                 "a mediocre fencer" is 15, and 103 "I'm an excellent fencer" is
 *                 **5** — the weakest Willie the game offers. Then `startplay()`'s
 *                 102, "My foil, please.", sets `willphase = 201`, which is what
 *                 SQUASH.SET's `fence()` reads to open `fence.stg`.
 *   the bout      15 flats are the piste (8 is the middle), five points wins it
 *                 (`propdeg` 0..4), and every attack that fails to score pushes
 *                 Willie back a flat while every attack of his that misses pushes
 *                 him forward. `notdefended` refuses the first TWO attacks of every
 *                 point outright (`attacktot < 3`), so a point always costs at
 *                 least three lunges.
 *   5-0 or bust   The route wins without conceding, and that is not showing off:
 *                 `pointgoesto` moves `fencelevel` by four on every point, so a
 *                 point conceded leaves the two hosts running different
 *                 difficulties for the rest of the bout, and the trace would
 *                 diverge on every random draw after it. A clean win ends with
 *                 `fencelevel` clamped at 5 in both, and `closestage` DUMPS the
 *                 five volatile globals (`willieblock`, `willieside`,
 *                 `playerblock`, `fighting`, `attacktot`) on the way out — so the
 *                 state that survives a 5-0 is identical in both hosts. That is
 *                 this segment's equivalent of segment 4 waiting for the plant's
 *                 fixed point.
 */
export async function segment13(s: Story): Promise<void> {
  const { nav, d, beat } = s;

  await beat("m2.1 the painting recovered, and a ring to find");
  expect(s.num("mission")).toBe(2);
  expect(s.num("phase")).toBe(1);
  expect(s.num("smethphase"), "Smethells has not spoken to us yet").toBe(0);

  // -- Smethells on the C-deck landing ---------------------------------------
  // Out of the hold FIRST, and not for tidiness: `binl`, `cargo` and `bing` are in
  // MAP_DISABLED_IN — MAP.STG will not open down here — so a travel straight to
  // gstair3 plans the walk on foot instead, the length of the ship (boil, engine,
  // Scotland Road, stair2c, deckbd, decka, gstair2). That walk is where the browser
  // and the headless host disagree: one of its legs never progresses in a browser
  // (the map is asked once, in the room that refuses it — still open).
  // `carghall` is the first room out where the map works, and from there
  // the jump is three clicks.
  const outOfHold = await travelPast(s, "carghall");
  expect(outOfHold.ok, outOfHold.reason).toBe(true);
  // The three questions travel WITH us, because he may reach us before we reach
  // him — see SMETH_DIRECTIONS and travelPast.
  const landing = await travelPast(s, "gstair3", SMETH_DIRECTIONS);
  expect(landing.ok, landing.reason).toBe(true);
  for (let flip = 0; flip < 4 && String(d.flow().savedeck) !== "c"; flip++) {
    const stairs = await nav.faceStandpoint(["view33"], ["scene13"]);
    expect(stairs.ok, stairs.reason).toBe(true);
    await d.pressSpace();
    await d.pressUp();
  }
  expect(String(d.flow().savedeck), "his deck").toBe("c");
  // view34, and it has to be that one. `hunt` walks the landing clicking him and
  // answers "ok" from anywhere the click LANDS — but gang.cst c837 gates his
  // mousedown on `realdist(me) < hotdist()`, and hotdist for gstair3 is 2300, so
  // from every other standpoint on the landing the click does nothing and says
  // nothing (the same trap Vlad set in segment 5). Measured by
  // trying all sixteen: view52's click lands and is ignored; view34's is the one he
  // answers.
  //
  // But he is MEANT to approach you here — c837 calls `hasattention(2)` — and
  // since frame() became clock-paced (60/framerate Hz off the clock rather than
  // one per host callback) that fires while we are still walking in. It used to
  // take three times as long headless, so the route always got to him first and
  // this read as "hasattention is not implemented". It is; he just has to be
  // given two seconds — `smethidle` re-arms every 20 steps and calls
  // `hasattention(2)` while `realdist(me) < hotdist()`, dropping the claim
  // (`clearattention`) on any firing from outside it.
  //
  // Whether he gets those two seconds depends on how the walk in interleaves with
  // his once-a-second idle, and that is NOT the same on a pumped clock as in real
  // time: headless he reaches us, in a browser he does not. So the route stands at
  // view34 either way and only goes looking for him if he never came — the beat
  // records the standpoint, and "where you were standing when he finished" must be
  // the route's decision rather than a race's.
  const at34 = await nav.faceStandpoint(["view34"]);
  expect(at34.ok, at34.reason).toBe(true);
  if (s.num("smethphase") === 0) {
    expect(await d.clickThing("smeth"), "close enough for him to notice").toBe(true);
    expect(d.conversing(), "Smethells has looked up").toBe(true);
    // all three questions, because his loop does not end until every one is asked
    const directions = await nav.talk(SMETH_DIRECTIONS);
    expect(directions.ok, directions.reason).toBe(true);
  }
  expect(s.num("smethphase"), "he has told us about the court").toBe(1);
  expect(d.propOwner("ring"), "and who has the ring").toBe("willie");
  await beat("m2.1 sent to the squash court");

  // -- Max, deliberately -----------------------------------------------------
  // RECEPT1C.SET's openset places him for ALL of mission 2, and every route to the
  // squash hall walks through that room (halld has no other neighbour) — so in a
  // browser he stops you mid-walk and headless he does not, and his conversation
  // moves `maxphase` and `threecount`. Rather than mask story state, hold the
  // conversation on purpose in BOTH hosts. Safe to advance: nothing outside his own
  // two puppets and one cast idle (gang.cst c350, `maxphase < 2`) reads it, and
  // MAX1.PUP's own header calls it a memory of how you spoke to him in mission 1 —
  // "3 if call him a cardsharp". At this phase his branch is `aboutgirl()`.
  const reception = await travelPast(s, "recept1c");
  expect(reception.ok, reception.reason).toBe(true);
  // `accost` rather than `hunt`, because after segment 10 he no longer stops us:
  // that conversation set `actorvalue("max")`, so `maxidle` takes its
  // `clearattention()` branch from then on and the browser stopped opening this
  // for us. Both judge a click by its effect now, but only `accost` knows that the
  // effect worth waiting for is a person ANSWERING — it watches whether he is
  // walking over (`mousedown` is gated on `realdist < hotdist`, 3000 here) instead
  // of accepting the first thing in the room that moved.
  const max = await nav.accost("max");
  expect(max.ok, max.reason).toBe(true);
  expect(d.conversing(), "Max is talking to us again").toBe(true);
  const aboutGirl = await nav.talk({ otherwise: "last", maxTurns: 80 });
  expect(aboutGirl.ok, aboutGirl.reason).toBe(true);
  await beat("m2.1 Max in the reception");

  // -- the court -------------------------------------------------------------
  const hall = await travelPast(s, "sqhall");
  expect(hall.ok, hall.reason).toBe(true);
  const atCourt = await nav.faceStandpoint(["view42"]);
  expect(atCourt.ok, atCourt.reason).toBe(true);
  await d.pressSpace();
  expect(d.propVisible("door"), "the court's door is open").toBe(true);
  await d.pressUp();
  await s.waitFor(() => d.conversing(), "Haderlitz to look up");

  // 103 is the boast, and the boast is the easiest fencer the game offers;
  // then "My foil, please." is what starts a match
  const foil = await nav.talk({ say: [103, 102], otherwise: "last", maxTurns: 60 });
  expect(foil.ok, foil.reason).toBe(true);
  expect(s.num("fencelevel"), "the weakest Willie there is").toBe(5);
  await s.waitFor(() => d.inFlat() !== null, "the piste to open");
  expect(d.inFlat(), "on the piste, in the middle").toBe("fence 8");
  await beat("m2.1 on the piste");

  // -- the bout --------------------------------------------------------------
  expect(await d.clickThing("startfence"), "en garde").toBe(true);
  expect(Number(d.flow().fighting) || String(d.flow().fighting) === "true", "fighting").toBeTruthy();

  let conceded = false;
  let lunges = 0;
  for (; lunges < 300 && d.inFlat() !== null; lunges++) {
    if (d.propVisible("williescore")) {
      conceded = true;
      break;
    }
    // guard the side he has chosen, and lunge from that same column
    const side = String(d.flow().willieside) === "left" ? "left" : "right";
    await d.clickAt(FENCE_COLUMN[side], FENCE_COLUMN.y);
    // between points the piste walks back to the middle and the start plaque
    // comes back up; the bout is not over until the flat closes
    if (d.inFlat() !== null && d.propVisible("startfence")) {
      await d.clickThing("startfence");
    }
  }
  expect(conceded, "he never scored — see the header on why 5-0 matters").toBe(false);
  expect(lunges, "a bout is a few dozen lunges, not three hundred").toBeLessThan(300);

  // Take the SHORTER branch at the junction, and finish the conversation before
  // the beat. `postgame()` speaks, rotates its lines with `dothreecount()`, and
  // ends on `playagain()` — whose 101 is another bout and whose 102 is "No, I've
  // got to go". One win is enough: Smethells hands the ring over at `fencewins < 2`
  // (segment 14), so a second bout would be work for nothing. Answering also fixes
  // a cross-host divergence rather than papering over one — a beat taken with the
  // puppet still talking caught `threecount` mid-rotation, 2 in a browser against 3
  // headless, because how far a conversation has got depends on how many frames
  // have gone by.
  const done = await nav.talk({ say: [102], otherwise: "last", maxTurns: 80 });
  expect(done.ok, done.reason).toBe(true);
  await s.waitFor(() => !d.conversing(), "Haderlitz to let us go");

  await beat("m2.1 the first bout won");
  expect(s.num("fencewins"), "one to us").toBe(1);
  expect(s.num("fencecount"), "and one bout played").toBe(1);
  expect(s.actorOwner("willie"), "he lost it").toBe("won");
}

/**
 * Segment 14 — Willy's ring, and the end of mission 2 phase 1.
 *
 * The short way at the junction. Haderlitz hands the ring over himself only at
 * `fencewins = 2` (`postgame()` -> `givering()`), so beating him again is a whole
 * bout of work more than this: SMETH1.PUP's phase-1 branch, with
 * `propowner("ring") = "willie"`, `fencecount >= 1` and **`fencewins < 2`**, speaks
 * four lines and then does `addinven("ring")` and `advancephase()`. Nothing is
 * skipped by taking it — the ring is the phase's object either way.
 *
 * And he comes to meet you, which is what makes it short: `RECEPT1C.SET openset`
 * places him on the `m2p1-recept1c` mark as soon as `fencecount >= 1`, and the
 * reception is the room every route out of the squash court passes through anyway.
 */
export async function segment14(s: Story): Promise<void> {
  const { nav, d, beat } = s;

  await beat("m2.1 a bout won, the ring still his");
  expect(s.num("mission")).toBe(2);
  expect(s.num("phase")).toBe(1);
  expect(d.propOwner("ring"), "Haderlitz still has it").toBe("willie");
  expect(s.num("fencecount"), "one bout played").toBe(1);
  expect(s.num("fencewins"), "and won — but one win, not two").toBe(1);

  // -- Smethells, who has come to the reception ------------------------------
  const toReception = await travelPast(s, "recept1c");
  expect(toReception.ok, toReception.reason).toBe(true);
  // view25 — the same standpoint segment 10 takes the cufflink from, and close
  // enough for his mousedown (hotdist in the reception is 3000). Measured by trying
  // seventeen of them; `hunt` cannot answer this on its own, because a click that
  // lands outside hotdist is still a click that landed.
  const atSmeth = await nav.faceStandpoint(["view25"], ["scene11"]);
  expect(atSmeth.ok, atSmeth.reason).toBe(true);
  expect(await d.clickThing("smeth"), "close enough for him to notice").toBe(true);
  expect(d.conversing(), "Smethells has turned round").toBe(true);

  // no choices to make — he talks, hands it over, and the phase turns
  const handover = await nav.talk({ otherwise: "last", maxTurns: 80 });
  expect(handover.ok, handover.reason).toBe(true);
  expect(d.propOwner("ring"), "Willy's ring").toBe("frank");

  await beat("m2.2 Willy's ring");
  expect(s.num("phase"), "and that is the phase boundary").toBe(2);
  expect(s.num("mission"), "still mission 2").toBe(2);
}

/**
 * Segment 15 — Willy's ring to Clariss Limehouse, and the end of mission 2 phase 2.
 *
 * The phase is a door. `HALLD.SET` c486 is the `knock` hotspot on D deck outside her
 * cabin, and what knocking does depends entirely on where the story is: at phase 2
 * it runs `claris1.pup` with the message **"ring"**, at phase 3 with "m2p3", and
 * before `progress(2, 2)` with "talk". Her puppet dispatches on that message and on
 * nothing else, so the door IS the phase gate — there is nobody to find first.
 *
 * `ring()` is a nested chain rather than a menu: one plaque at a time (the ring,
 * then the notebook, then what became of Willy), each the only choice on offer, and
 * the last screen is the decision — "I better keep it" against **"Yes, here it
 * is."**, which does `giveinven("ring", "claris")` and `advancephase()`.
 */
export async function segment15(s: Story): Promise<void> {
  const { nav, d, beat } = s;

  await beat("m2.2 Willy's ring in hand");
  expect(s.num("mission")).toBe(2);
  expect(s.num("phase")).toBe(2);
  expect(d.propOwner("ring"), "hers to identify").toBe("frank");

  // -- her door on D deck ----------------------------------------------------
  const dDeck = await travelPast(s, "halld");
  expect(dDeck.ok, dDeck.reason).toBe(true);
  const atDoor = await nav.faceStandpoint(["view79"], ["scene69"]);
  expect(atDoor.ok, atDoor.reason).toBe(true);
  expect(await d.clickHotspot("knock"), "knocked").toBe(true);
  await s.waitFor(() => d.conversing(), "Clariss to open the door");

  // one plaque at a time until the last screen, where 102 is handing it over
  const identified = await nav.talk({ say: [101, 101, 101, 102], otherwise: "last", maxTurns: 120 });
  expect(identified.ok, identified.reason).toBe(true);
  expect(d.propOwner("ring"), "she keeps it").toBe("claris");

  await beat("m2.3 the ring identified");
  expect(s.num("phase"), "and that is the phase boundary").toBe(3);
  expect(s.num("mission"), "still mission 2").toBe(2);
}

/**
 * Segment 16 — Penny's debrief, and the end of mission 2.
 *
 * Her door on F deck, the same knock segment 6 made to finish mission 1.
 * `PENNY1.PUP`'s dispatcher sends mission 2 phase 3 to `m2p3()`, which opens with a
 * guard worth knowing — if the painting is the PURSER's it plays a two-line
 * apology instead — and then offers four plaques in a loop.
 *
 * The shortest of them is the one that ends the mission: **600, "What do I do
 * now?"**, which speaks, does `addinven("gaspen")` and `advancephase()`. It has no
 * prerequisites at all — the other three (202 the painting, 102/101 Haderlitz and
 * Zeitel, 500 the notebook) set local flags and play their movies, and nothing
 * outside the conversation reads them. So this asks the one question, and the
 * mission turns over.
 */
export async function segment16(s: Story): Promise<void> {
  const { nav, d, beat } = s;

  await beat("m2.3 the ring identified, Penny to report to");
  expect(s.num("mission")).toBe(2);
  expect(s.num("phase")).toBe(3);
  expect(d.propOwner("painting"), "hers to hear about — and NOT the Purser's").toBe("frank");

  // -- her cabin -------------------------------------------------------------
  const fDeck = await travelPast(s, "hallf2c");
  expect(fDeck.ok, fDeck.reason).toBe(true);
  const atDoor = await nav.faceStandpoint(["view76"], ["scene59"]);
  expect(atDoor.ok, atDoor.reason).toBe(true);
  expect(await d.clickHotspot("knock"), "knocked on her door").toBe(true);
  await s.waitFor(() => d.conversing(), "Penny to answer");

  // 600 is the whole segment: it is the only plaque that advances anything
  const debrief = await nav.talk({ say: [600], otherwise: "last", maxTurns: 120 });
  expect(debrief.ok, debrief.reason).toBe(true);
  expect(d.propOwner("gaspen"), "she gives you the pen").toBe("frank");

  await beat("m3.0 mission 2 signed off");
  expect(s.num("mission"), "her orders rolled the mission over").toBe(3);
  expect(s.num("phase"), "and reset the phase").toBe(0);
}

/**
 * Segment 17 — mission 3 begins: Willy's body, and the Rubaiyat clue.
 *
 * `EBATH.SET openset` places him at `mission = 3` and nothing else does — the
 * Turkish bath is where he ends up, on the `bathtable` the same script sets up. His
 * cast script (gang.cst) answers a click differently once `actorpose = "dead"`: no
 * conversation, just `transtoflat("rubclue.stg")` — and only while
 * `propowner("rubiclue") = "none"`, so the body is a one-time thing.
 *
 * The clue itself is `RUBCLUE.SHP` c3, a two-step zoom like the cufflink: "small"
 * to "big", and the click after that is `addinven("rubiclue")`. Its flat reuses the
 * cufflink's flat name ("cuff 1"), which is a naming coincidence in the data and not
 * a mistake here.
 *
 * Penny's mission-3 phase-0 branch reads exactly this — `propowner("rubiclue") =
 * "none"` gets "go and find it" — so the clue is the phase's first object.
 */
export async function segment17(s: Story): Promise<void> {
  const { nav, d, beat } = s;

  await beat("m3.0 mission 3 begins");
  expect(s.num("mission")).toBe(3);
  expect(s.num("phase")).toBe(0);
  expect(d.propOwner("rubiclue"), "nobody has the clue yet").toBe("none");
  expect(d.propOwner("gaspen"), "Penny's pen, from her debrief").toBe("frank");

  // -- the Turkish bath ------------------------------------------------------
  const bath = await travelPast(s, "ebath");
  expect(bath.ok, bath.reason).toBe(true);
  // hunt is enough here: hotdist in ebath is 3300, and he is the only thing in the
  // room worth clicking. `hunt` now judges its own click by what moved rather than
  // by where it landed, so the reason it reports is the
  // truth; the FLAT is still asserted below, because what this segment wants is not
  // "a click did something" but "the close-up on the body is up".
  const body = await nav.hunt("willie");
  expect(body.ok, body.reason).toBe(true);
  await s.waitFor(() => d.inFlat() !== null, "the close-up on the body");
  expect(d.inFlat(), "rubclue.stg's only flat").toBe("cuff 1");

  // -- the clue --------------------------------------------------------------
  // small -> big -> taken, the cufflink's gesture again
  for (const step of ["big", "taken"]) {
    expect(await d.clickThing("rubclueclue"), `clicking through to ${step}`).toBe(true);
  }
  expect(d.propOwner("rubiclue"), "the Rubaiyat clue").toBe("frank");

  await beat("m3.0 the Rubaiyat clue");
  expect(s.num("mission"), "still mission 3").toBe(3);
  expect(s.num("phase"), "no boundary here — the clue is the first of several").toBe(0);
}

/**
 * Segment 18 — the Hacker on Scotland Road trades the clue for the phrase.
 *
 * The rope is the gesture. `SCOT3.SET` c110 is `hitrope` at Scene13/View25, and its
 * mousedown plays `scotrope.mov` for anyone — but with `mission = 3`, the clue in
 * hand, `hackphase = 0` and no Hacker on screen it goes on to fetch him: it does
 * `setupactor("hack", "scot3")`, turns the camera round to view22 ITSELF (a
 * `while currentview() != "view22"` loop pressing right), waits, and sends him a
 * mousedown. So the conversation opens without our clicking him, and the route must
 * not try to — there is nobody there until the rope has been hit.
 *
 * His `rubiclue()` is the trade: two plaques to ask, then "Please." is what does
 * `hackphase = 1`, `giveinven("rubiclue", "xxxfrank")` — he keeps the clue — and
 * `addinven("hackclue")`, the phrase. The last screen offers the phrase again (103)
 * or the door (104); 104 is the shorter way out and asks for nothing.
 */
export async function segment18(s: Story): Promise<void> {
  const { nav, d, beat } = s;

  await beat("m3.0 the clue in hand");
  expect(s.num("mission")).toBe(3);
  expect(s.num("phase")).toBe(0);
  expect(d.propOwner("rubiclue"), "his price").toBe("frank");
  expect(s.num("hackphase"), "and he has not been found yet").toBe(0);

  // -- the rope --------------------------------------------------------------
  const road = await travelPast(s, "scot3");
  expect(road.ok, road.reason).toBe(true);
  const atRope = await nav.faceStandpoint(["view25"], ["scene13"]);
  expect(atRope.ok, atRope.reason).toBe(true);
  expect(await d.clickHotspot("hitrope"), "hit the rope").toBe(true);
  // `scotrope.mov` PARKS on a single region, and `spotmovie` does not return until
  // it is dismissed — so the Hacker code after it never runs until we click the rope
  // shot away. A parked movie is a question (nav.rush refuses one for this reason),
  // and this one's only answer is its type-6 step.
  // ESC rather than its region, and for a driver reason worth knowing: clicking the
  // region SETTLES, and both drivers count a conversation as settled only while it
  // is not awaiting a choice — so a gesture whose consequence is a puppet asking a
  // question pumps until the budget dies. This clip's consequence is exactly that.
  // An abort ends it without running the frame's action (docs/formats/mov.md), which
  // is all we need: `spotmovie` returns and c110 goes on to fetch him.
  expect(await d.skipMovie(), "let the rope shot go").toBe(true);
  // then he is fetched, walked to and clicked by the script itself: c110 turns the
  // camera to view22 in its own loop and sends him a mousedown
  await s.waitFor(() => d.conversing(), "the Hacker to come over");

  // -- the trade -------------------------------------------------------------
  // ask, ask, "Please." — and then 104, the door, rather than 103's repeat
  const trade = await nav.talk({ say: [101, 101, 104], otherwise: "last", maxTurns: 120 });
  expect(trade.ok, trade.reason).toBe(true);
  expect(s.num("hackphase"), "he has helped").toBe(1);
  expect(d.propOwner("rubiclue"), "and kept the clue").not.toBe("frank");
  expect(d.propOwner("hackclue"), "the phrase, which is what we came for").toBe("frank");

  await beat("m3.0 the Hacker's phrase");
  expect(s.num("phase"), "still phase 0 — Max and the cigarettes end it").toBe(0);
}

/**
 * Segment 19 — the Old Reds, on the table Willy and Zeitel sat at.
 *
 * `CAFE.SET openset` puts `willzeittable` in the cafe, and its house.shp script
 * (c211) opens `cigs.stg` for any mission under 4 — the table is always examinable,
 * and what is ON it is the gate: `CIGS.SHP openshop` shows the packet only at
 * `mission = 3 & phase = 0` with `propowner("hackclue") = "frank"` and the cigarettes
 * unowned. So the Hacker's phrase is what makes them visible, which is why segment 18
 * comes first.
 *
 * Taking them is the cufflink's gesture a third time — "small" to "big", and the click
 * after that is `addinven("oldreds")`.
 *
 * Ends in the close-up, like segment 10: that flat's OK is another `trackbut` on an
 * invisible prop — aim at the LIT rect, docs/reference/route.md — and a save
 * records the room rather than the
 * close-up over it, so segment 20 resumes in the cafe either way.
 */
export async function segment19(s: Story): Promise<void> {
  const { nav, d, beat } = s;

  await beat("m3.0 the phrase in hand");
  expect(s.num("mission")).toBe(3);
  expect(s.num("phase")).toBe(0);
  expect(d.propOwner("hackclue"), "what makes the packet visible").toBe("frank");
  expect(d.propOwner("oldreds"), "and nobody has them yet").toBe("none");

  // -- the cafe --------------------------------------------------------------
  const cafe = await travelPast(s, "cafe");
  expect(cafe.ok, cafe.reason).toBe(true);
  const table = await nav.hunt("willzeittable");
  expect(table.ok, table.reason).toBe(true);
  await s.waitFor(() => d.inFlat() !== null, "the table's close-up");
  expect(d.propVisible("cigscigs"), "the packet is on it").toBe(true);

  // -- the packet ------------------------------------------------------------
  for (const step of ["big", "taken"]) {
    expect(await d.clickThing("cigscigs"), `clicking through to ${step}`).toBe(true);
  }
  expect(d.propOwner("oldreds"), "Willy's Old Reds").toBe("frank");

  await beat("m3.0 the Old Reds");
  expect(s.num("phase"), "still phase 0 — Max ends it").toBe(0);
}

/**
 * Segment 20 — the cigarettes to Max, and the end of mission 3 phase 0.
 *
 * He is in the smoking room for mission 3 (`MAX1.PUP` case 3 answers only there),
 * and his branch is a single question: without the Old Reds he asks for them, with
 * them he takes them — `giveinven("oldreds", "max")` — and calls `advancephase()`.
 */
export async function segment20(s: Story): Promise<void> {
  const { nav, d, beat } = s;

  await beat("m3.0 the Old Reds in hand");
  expect(s.num("mission")).toBe(3);
  expect(s.num("phase")).toBe(0);
  expect(d.propOwner("oldreds"), "his price").toBe("frank");

  // -- the smoking room ------------------------------------------------------
  const smoke = await travelPast(s, "smoke");
  expect(smoke.ok, smoke.reason).toBe(true);
  const found = await nav.hunt("max");
  expect(found.ok, found.reason).toBe(true);
  await s.waitFor(() => d.conversing(), "Max to look up");

  const handover = await nav.talk({ otherwise: "last", maxTurns: 120 });
  expect(handover.ok, handover.reason).toBe(true);
  expect(d.propOwner("oldreds"), "he takes them").toBe("max");

  await beat("m3.1 the Old Reds delivered");
  expect(s.num("phase"), "and that is the phase boundary").toBe(1);
  expect(s.num("mission"), "still mission 3").toBe(3);
}

/**
 * Segment 21 — the Chief Engineer's second favour, which is what unlocks the
 * engine room for the fight.
 *
 * Found the hard way: `travel("engine")` reported "door would not open in
 * control", and the door is right to refuse. `CONTROL.SET` c169 is the doorway's
 * mousedown, and it opens the door only `if cseahappy()` — which at
 * `mission = 3 & phase = 1` means `actorowner("csea") = "thanks2"` and nothing
 * else. (`mission = 1 & phase >= 3` covers mission 1 and `progress(3, 2)` covers
 * everything after this phase, so this one phase is the only time the door is
 * shut.) Otherwise the click does `sendtoactor("csea", mousedown(0))`: trying the
 * handle fetches the engineer instead of opening it.
 *
 * And what he wants is the turbine plant a second time. CSEA1.PUP's mission-3
 * phase-1 branch reads the "thanks1" segment 4 earned and calls `helpme2()`,
 * whose 101 — "My pleasure. I can fix it." — sets `actorowner("csea") = "helpme"`;
 * gang.cst c146 then behaves exactly as it did in segment 4, because its guard was
 * written for both visits: `(mission = 1 & phase = 2) | (mission = 3 & phase = 1)`
 * with the owner at "helpme" opens `turbine.stg` on the same click. TURBINE.STG c5
 * grades it the same way too — `propdeg("electrical") > 13` — and the mission-3
 * branch of that same line is the `actorowner("csea", "thanks2")` the door wants.
 *
 * **The plant is still where segment 4 left it**, which is what makes this cheap:
 * PLANT_STEADY is a fixed point, so the six dials have not moved and the output
 * gauge still clears the gate. So there are no dials to drag here — the segment
 * asserts the plant is stationary at the same eleven numbers and presses OK.
 */
export async function segment21(s: Story): Promise<void> {
  const { nav, d, beat } = s;

  await beat("m3.1 the engine room shut");
  expect(s.num("mission")).toBe(3);
  expect(s.num("phase")).toBe(1);
  expect(s.actorOwner("csea"), "thanked once, for mission 1's plant").toBe("thanks1");

  // -- the control room ------------------------------------------------------
  const control = await travelPast(s, "control");
  expect(control.ok, control.reason).toBe(true);

  const met = await nav.hunt("csea");
  expect(met.ok, met.reason).toBe(true);
  await s.waitFor(() => d.conversing(), "the engineer to look up");
  // 101 takes the job; 102 refuses it and 103 is the manual (a movie, and a
  // detour) — helpme2 loops back to the same plaques with 103 removed
  const asked = await nav.talk({ say: [101], maxTurns: 60 });
  expect(asked.ok, asked.reason).toBe(true);

  // -- the plant, on the same gesture ----------------------------------------
  // Segment 4's one-gesture note applies unchanged: the click that held the
  // conversation goes on to read the "helpme" it just set and opens the flat.
  await s.waitFor(() => d.inFlat() === "Turbine 1", "the turbine room to open");
  expect(s.actorOwner("csea"), "the plant is ours again").toBe("helping");
  // -- the six settings, again -----------------------------------------------
  // And they really do have to be set again, which is a fact about the SAVE
  // rather than about the plant: the twelve plant globals have no record in the
  // shipped template `snapshotSave` patches, and there are only three free node
  // slots to make records in (docs/formats/savegame.md), so a checkpoint cannot carry
  // them. Resuming lands on `initvalue()`'s dials with the water where the engine
  // starts it, so the flat opens on a dead plant and the first run of this
  // segment failed at the OK button with the owner still "helping".
  //
  // Segment 4's loop verbatim, and it is idempotent: a session that reached here
  // without a checkpoint has the dials already pointing at these numbers, sets
  // them to the same values, and waits on a fixed point it is already at.
  for (const [name, want] of Object.entries(TURBINE_SETTING)) {
    const dial = name === COAL_LEVER.prop ? COAL_LEVER : TURBINE_DIALS[name];
    const set = await nav.setDial(dial, want);
    expect(set.ok, `${name}: ${set.reason}`).toBe(true);
    expect(s.deg(name), `${name} points at ${want}`).toBe(want);
    // every turbine control drives one; a combination lock's dials drive nothing
    const driven = dial.global;
    if (driven) expect(s.num(driven), `the plant is running ${driven} at the dial`).toBe(dial.value(want));
  }

  await waitForThePlant(s);
  expect(s.deg("electrical"), "the output gauge clears the OK button's > 13").toBeGreaterThan(13);
  await beat("m3.1 the plant is steady again");

  // -- the OK button ---------------------------------------------------------
  const ok = await nav.hunt("exit");
  expect(ok.ok, ok.reason).toBe(true);
  await s.waitFor(() => !d.inFlat(), "the turbine room to close");
  expect(s.actorOwner("csea"), "and this time the thanks are thanks2").toBe("thanks2");

  // -- his thanks ------------------------------------------------------------
  // Again not our gesture: the OK handler arms CONTROL.SET's `trigger`, which
  // clicks him for us.
  await s.waitFor(() => d.conversing(), "the engineer to come and thank you");
  const thanked = await nav.talk({ otherwise: "last", maxTurns: 40 });
  expect(thanked.ok, thanked.reason).toBe(true);
  await s.waitFor(() => !d.conversing(), "him to go back to work");

  await beat("m3.1 the second favour done");
  expect(s.num("phase"), "no boundary — the fight is the phase").toBe(1);
}

/**
 * Where to click to throw each blow, and why these three in this order.
 *
 * The fight is a light gun, like the fencing: `FIGHT.STG`'s stage mousedown
 * forwards the click to the `fists` prop, and `fists`' `playerpunch(x, y, side)`
 * reads the blow OUT of the point. There is no button bar to press (the
 * `buttonbar` and `coverbar` props are the frame around the two health bars):
 *
 *     x < 156          a cross, thrown with the FAR hand — clicking his left
 *                      throws your right — unless y >= 270, which is a kick
 *     x > 356          the same on the other side
 *     156..356, y<160  a jab at his head, on the side of 256 you clicked
 *     156..356, y<270  an uppercut, ditto
 *     anything lower   a kick
 *
 * **The combo is the player's**, and it is the reason this segment can be written
 * at all: right cross, left cross, uppercut, repeat. `fists`' `punch()` keeps the
 * last three blows in `firstpunch`/`secondpunch`/`thirdpunch` and hands the turn
 * BACK to Vlad — `sendtoprop("vlad", fightnow())` — for four repetitions it
 * refuses: three jabs, four crosses, a cross straight after a kick, and a cross or
 * an uppercut on the same side twice running (`onetwo = 1`). Cycling three
 * different blows on alternating sides trips none of them, so he never gets a
 * counter, and `playerpower` should still be its opening 512 when he goes down.
 *
 * The damage is arithmetic, not a draw — `vladdamage` reads the combo rather than
 * `random()`: -2 for the cross that follows the uppercut, -6 for the second cross
 * (`secondpunch = "cross"` with the side alternating), -6 for the uppercut. 14 a
 * cycle out of 512, so about 110 clicks. Only VLAD's blows roll dice
 * (`random(5) + 2` up to `+ 16`), which is the other reason to keep him from
 * throwing any: it makes the whole fight deterministic.
 */
/** `vladpower` below this and his idle handler ends the fight (FIGHT.SHP c3) */
const FIGHT_DOWN = -50;

const FIGHT_COMBO = [
  { x: 100, y: 200, blow: "a right cross" },
  { x: 412, y: 200, blow: "a left cross" },
  { x: 256, y: 210, blow: "an uppercut to the chest" },
];

/** the combo step that breaks a run of crosses (FIGHT.SHP c76 `punch`) */
const FIGHT_UPPERCUT = 2;

/** 14 damage a cycle out of 512 is ~110 blows; past this it is not a fight */
const FIGHT_MAX_BLOWS = 240;

/**
 * Segment 22 — the fight with Vlad, and the end of mission 3 phase 1.
 *
 * **The room starts the fight itself**, which is the part worth knowing: two of
 * ENGINE.SET's scenes have an `openscene` that acts at `mission = 3 & phase = 1`,
 * and they are a pair.
 *
 *   Scene108 (c550)  `sendtoactor("vlad", setupactor("fight"))` — this is what PUTS
 *                    him in the room, on the `vlad1` star. Until this scene has
 *                    opened he is nowhere: the set's `closeset` does
 *                    `putdownactor()`, and so does pressing up at Scene108/View112.
 *   Scene110 (c438)  `sendtoactor("vlad", mousedown(0))` — it clicks him for you.
 *                    His `mousedown` (gang.cst c960) still checks
 *                    `realdist(me) < hotdist()`, which is 2600 in `engine`, and
 *                    then `walktofight()`: `lockevents = true` and
 *                    `moveactorstar("vlad2")`. His `endwalk` sees the vlad2 star
 *                    and calls `runfight()` — `vlad1.pup`, then
 *                    `transtoflat("fight.stg")`, then `advancephase()`.
 *
 * So the route walks Scene108 and then Scene110, in that order, and throws no
 * gesture at Vlad at all. Scene110 is also the smokestack door (the set's own
 * `keydown` takes View120 up into `smstack1`), and `smstack1 -> engine` arrives at
 * Scene110/View119 — so a player coming DOWN the stack triggers this on arrival
 * without having placed him, and nothing happens. Worth remembering for phase 2,
 * which goes up that stack.
 *
 * **Winning is not optional.** `runfight` calls `advancephase()` whichever way the
 * fight goes and there is no `playerdeath` in it, so losing is survivable — but
 * `FIGHT.STG endfight` writes the verdict to `actorowner("vlad")` (`"lostfight"`
 * when `vladpower < playerpower`, which is your win; `"wonfight"` when it is his),
 * and Scene108 and Scene110 both re-place him at phase 2 only `if actorowner("vlad")
 * = "lostfight"`. The short way at this junction is the winning one.
 */
export async function segment22(s: Story): Promise<void> {
  const { nav, d, beat } = s;

  await beat("m3.1 the fight ahead");
  expect(s.num("mission")).toBe(3);
  expect(s.num("phase")).toBe(1);
  expect(d.propOwner("oldreds"), "Max has his cigarettes").toBe("max");

  // -- the engine room -------------------------------------------------------
  const engine = await travelPast(s, "engine");
  expect(engine.ok, engine.reason).toBe(true);

  // Scene108 first, or there is nobody in the room to fight
  const placed = await nav.faceStandpoint(["view111", "view112", "view113", "view114"], ["scene108"]);
  expect(placed.ok, placed.reason).toBe(true);

  // and Scene110 second, which throws the punch that starts it
  const squared = await nav.faceStandpoint(["view119", "view120", "view121", "view122"], ["scene110"]);
  expect(squared.ok, squared.reason).toBe(true);

  // -- he walks over, says his piece, and the ring opens ---------------------
  const started = await d.waitFor(() => d.conversing() || d.inFlat() !== null, "Vlad to square up", 120_000);
  expect(started, "the room never started the fight — is he inside hotdist() of 2600?").toBe(true);
  if (d.conversing()) {
    const words = await nav.talk({ otherwise: "last", maxTurns: 80 });
    expect(words.ok, words.reason).toBe(true);
  }
  const ring = await d.waitFor(() => d.inFlat() !== null, "fight.stg to open", 120_000);
  expect(ring, "the puppet finished but no flat opened").toBe(true);
  s.log?.(`the ring is the "${d.inFlat()}" flat`);

  // -- the fight -------------------------------------------------------------
  // 512 hit points at 14 a cycle is about 110 blows.
  //
  // The blow to throw is decided from the GAME's punch history, not from a count
  // of our own clicks, because the two come apart. `vladdamage` is the only
  // writer of firstpunch/secondpunch/thirdpunch and it runs at the END of
  // `punch()`, so a blow Vlad counters never enters the history at all; a click
  // that does not land writes nothing either. Count clicks and the combo drifts
  // out of phase with what the game thinks you threw — and a dropped uppercut
  // leaves crosses running, which is the one rule this combo can still trip.
  //
  // Only that one. `playerpunch` hands `punch()` the side "right" for x < 156 and
  // "left" for x > 356, and for the uppercut a local it never assigns — a third
  // value distinct from both. So these three blows always alternate `side`,
  // `onetwo` is always 2, and the two same-side rules can never fire; nor can the
  // jab or after-a-kick ones, which this combo never sets up. Four crosses is the
  // whole exposure, and throwing the uppercut instead closes it.
  let blows = 0;
  let step = 0;
  for (; blows < FIGHT_MAX_BLOWS && d.inFlat() !== null && s.num("vladpower") >= FIGHT_DOWN; blows++) {
    const crossesRunning =
      s.str("firstpunch") === "cross" &&
      s.str("secondpunch") === "cross" &&
      s.str("thirdpunch") === "cross";
    if (crossesRunning) step = FIGHT_UPPERCUT;
    const { x, y } = FIGHT_COMBO[step % FIGHT_COMBO.length];
    await d.clickAt(x, y);
    step = crossesRunning ? 0 : step + 1;
  }
  expect(blows, "a fight is a hundred-odd blows, not a stalemate").toBeLessThan(FIGHT_MAX_BLOWS);
  // Winning is the assertion; a spotless win is not. Vlad's blows are the only
  // dice in the fight (`random(5) + 2` up to `+ 16`), so which stream position
  // the route arrives on decides whether he lands one before the guard above
  // settles the combo — pinning `playerpower` to its opening 512 made the run
  // depend on that. The floor still fails a real degradation: at 16 a blow it
  // takes four clean hits to cross it, and the combo should allow none.
  const power = s.num("playerpower");
  s.log?.(`${blows} blows, vladpower ${s.num("vladpower")}, playerpower ${power}`);
  expect(power, "he got a whole exchange in — see FIGHT_COMBO").toBeGreaterThan(512 - 4 * 16);

  // And now STOP, because the fight cannot end while you are still punching.
  // Measured, and it cost a run of 400 blows that took `vladpower` to -520 with
  // the flat still open: the whole end-of-fight test lives in Vlad's OWN idle
  // handler (`if vladpower < -50` -> `propview("vladlight", "on")` and
  // `sendtoflat(currentflat(), endfight())`), his idle only runs when the loop
  // `vladdamage` arms comes round — `makeloop("prop", "vlad", "idle", halfit(n))`,
  // between 2 and 40 ticks — and every click starts by CANCELLING it
  // (`stoploop("prop", "vlad")` in the fists mousedown, so that a blow interrupts
  // whatever he was about to do). A player clicks slowly enough that the loop
  // fires between blows. A driver clicking as fast as it can pump never lets it,
  // and starves its own win condition.
  //
  // Worth remembering as a shape rather than as this bug: a minigame's ending can
  // be in a timer the player's own gestures postpone.
  const down = await d.waitFor(() => d.inFlat() === null, "Vlad to go down", 120_000);
  expect(down, "he is beaten but the flat never closed").toBe(true);

  await s.waitFor(() => s.num("phase") === 2, "runfight to advance the phase");

  await beat("m3.2 Vlad on the floor");
  expect(s.actorOwner("vlad"), "HIS loss, hence lostfight").toBe("lostfight");
  expect(s.num("phase"), "and that is the phase boundary").toBe(2);
  expect(s.num("mission"), "still mission 3").toBe(3);
}

/** the one standpoint the notebook is both clickable AND close enough to take */
const NOTEBOOK_VIEW = "view55";

/** the current scene's own name, lowercase — the smokestack is planned in these */
const sceneNow = (d: NavDriver): string => {
  const at = d.at();
  return (d.set().scenes[at.sceneIdx]?.sceneName ?? "").toLowerCase();
};

/**
 * Segment 23 — up the false smokestack: mission 3 phase 2.
 *
 * The maze is read out in [nav/smokestack.ts](tests/playthrough/nav/smokestack.ts)
 * and solved there; this is the walk. Three things about it are worth having here.
 *
 * **The door is the fight's own scene.** ENGINE.SET c1's keydown at View120 — in
 * Scene110, where segment 22's fight was triggered — draws
 * `mazenumber = random(4)`, plays `stackin.mov` and changes set to `smstack1`. So
 * which of the four mazes you climb is decided at the door, on a die roll, and the
 * route has to read it rather than assume it.
 *
 * **`smstack1` is where the choice is.** Its four ways up land in the four scenes
 * of `smstack2` that have no ladder, and one (maze, entry) pair out of sixteen is a
 * dead end — maze 4 into scene39 has both its gaps shut on the first floor.
 * `pickEntry` tries all four and takes one that solves, which is why this segment
 * does not need a retry or a way back down.
 *
 * **The climb is nine ladders with a ring walk between them**, 18 moves for most
 * mazes, and every move is the same gesture: stand in a view, press up. A walk that
 * is blocked does nothing at all (the scene script `exitcode`s), so each move
 * asserts the scene it landed in — a plan that has drifted says so at the move that
 * drifted rather than by wandering.
 *
 * At the top, `inven.shp` c88 is the notebook, and it refuses the click from
 * anywhere but View53 or View55 of `smstack3`. Taking it runs `smokestack()`:
 * `advancephase()`, `setupactor("zeit", "smstack3")`, a turn towards him and then
 * `runpuppet("zeit1.pup", "notebook")` — so Zeitel arrives and speaks by himself.
 * Handing the notebook OVER is a separate act and belongs to phase 3.
 *
 * **Only one of those two views can actually pick it up**, which cost a run and is
 * `hunt`'s false-success failure mode with numbers on it. `stdmouse` takes a
 * "small" prop only
 * `if realdist(what) < hotdist()`, and `hotdist()` is 4100 in `smstack3`; the
 * `notebook` star is at (5469, 7261) and the two scenes' cameras
 * (`xAxisMap`/`zAxisMap`, which are the standpoint's world x and z) are Scene38 at
 * (3646, 3653) and Scene39 at (3646, 10170) — **4042 and 3433 away**. So View53 is
 * inside the gate by 58 units of 4100 and lost anyway, while View55 is inside it by
 * 667 and wins. The click still ran the rest of the handler either way: the phase
 * advanced, Zeitel walked over and started talking, and the notebook stayed on the
 * platform with nobody able to reach it because the conversation blocks the walk.
 * That 1.4% margin is presumably as tight in the original; if a later route needs
 * View53, our `propxyz` for a starred prop is the thing to check first.
 */
export async function segment23(s: Story): Promise<void> {
  const { nav, d, beat } = s;

  await beat("m3.2 the notebook to find");
  expect(s.num("mission")).toBe(3);
  expect(s.num("phase")).toBe(2);
  expect(s.actorOwner("vlad"), "beaten in segment 22").toBe("lostfight");

  // -- the stack door --------------------------------------------------------
  const engine = await travelPast(s, "engine");
  expect(engine.ok, engine.reason).toBe(true);
  const door = await nav.faceStandpoint(["view120"], ["scene110"]);
  expect(door.ok, door.reason).toBe(true);
  await d.pressUp();
  const inside = await d.waitFor(() => d.setName() === "smstack1", "the bottom of the stack", 120_000);
  expect(inside, "pressing up at View120 did not take us into the stack").toBe(true);

  // -- which maze, and which way up ------------------------------------------
  const maze = s.num("mazenumber");
  expect(maze, "mazenumber is a random(4) draw at the door").toBeGreaterThanOrEqual(1);
  expect(maze).toBeLessThanOrEqual(4);
  const chosen = pickEntry(maze);
  expect(chosen, `maze ${maze} has no way up from any of the four entries`).not.toBeNull();
  const { entry, plan } = chosen!;
  s.log?.(`maze ${maze}: up at ${entry.stand} into ${entry.scene}, then ${plan.length} moves`);

  const foot = await nav.faceStandpoint([entry.stand]);
  expect(foot.ok, foot.reason).toBe(true);
  await d.pressUp();
  const first = await d.waitFor(() => d.setName() === "smstack2", "the first floor", 120_000);
  expect(first, "the way up out of smstack1 did nothing").toBe(true);
  expect(sceneNow(d), "where that way up lands").toBe(entry.scene);
  expect(s.num("stacklevel"), "the climb starts at level 2").toBe(2);
  await beat("m3.2 at the foot of the stack");

  // -- the climb -------------------------------------------------------------
  for (const move of plan) {
    const faced = await nav.faceStandpoint([move.view], [move.from]);
    expect(faced.ok, `${move.kind} out of ${move.from}: ${faced.reason}`).toBe(true);
    await d.pressUp();
    if (move.to === "smstack3") {
      const top = await d.waitFor(() => d.setName() === "smstack3", "the top of the stack", 120_000);
      expect(top, "the last ladder did not reach the top").toBe(true);
      break;
    }
    const moved = await d.waitFor(
      () => d.setName() === "smstack2" && sceneNow(d) === move.to && s.num("stacklevel") === move.level,
      `the ${move.kind} from ${move.from} to ${move.to} at level ${move.level}`,
      120_000,
    );
    expect(moved, `${move.kind} from ${move.from} (${move.view}) never reached ${move.to}`).toBe(true);
  }
  expect(d.setName(), "the top of the false stack").toBe("smstack3");
  await beat("m3.2 at the top of the stack");

  // The notebook is one gesture away, and segment 24 makes it: picking it up runs
  // `smokestack()` — `advancephase()`, Zeitel fetched and his puppet opened — and
  // that conversation runs straight on into `notebook()`, a `while true` whose only
  // exit hands the notebook over and advances the phase AGAIN, into mission 4. So
  // phase 3 is one continuous scene with no quiet moment in it, and this segment
  // stops at the last one: at the top, with the notebook still on the platform.
  expect(s.num("phase"), "no boundary — taking the notebook is the boundary").toBe(2);
  expect(d.propOwner("notebook"), "still lying there").toBe("none");
}

/**
 * Segment 24 — the notebook to Zeitel: mission 3 phase 3, and mission 4.
 *
 * One continuous scene, which is why it is its own segment. The
 * pick-up is `inven.shp` c88's mousedown and it only works from **View55** of
 * `smstack3`: the `notebook` star is 3433 from that standpoint and 4042 from
 * View53, against the `hotdist()` of 4100 that `stdmouse`'s
 * `if realdist(what) < hotdist()` compares — so View53 loses by 58 units while
 * still running the rest of the handler, and leaves the notebook unreachable.
 *
 * Taking it runs `smokestack()`: `advancephase()`, `setupactor("zeit",
 * "smstack3")`, a turn towards him, and `runpuppet("zeit1.pup", "notebook")`. Then
 * the conversation goes all the way: two questions, `spotmovie("berg.mov")` — the
 * iceberg — and `notebook()`, whose "Here, take the notebook" does
 * `giveinven("notebook", "zeit")`, `putdownactor()` and a second `advancephase()`,
 * which rolls mission 3 over into mission 4.
 *
 * **Answer 101 and never "the last plaque".** `notebook()` calls
 * `sendtoshop("inven.shp", addhandbevel())`, which adds a THIRD plaque with the id
 * **55555** — "I have something for you..." — that opens the inventory so the
 * player can choose what to offer. It is the last one on the stack, so an
 * `otherwise: "last"` answer takes it: the bag comes up, the puppet sits waiting
 * underneath, and both drivers then report `conversing()` false with
 * `inFlat() = "inven 1"`, so the next beat cannot settle. 101 is the plaque that
 * hands the notebook over directly.
 */
export async function segment24(s: Story): Promise<void> {
  const { nav, d, beat } = s;

  await beat("m3.2 at the top of the stack");
  expect(s.num("mission")).toBe(3);
  expect(s.num("phase")).toBe(2);
  expect(d.setName(), "where segment 23 left us").toBe("smstack3");
  expect(d.propOwner("notebook"), "still on the platform").toBe("none");

  // -- the notebook ----------------------------------------------------------
  const near = await nav.faceStandpoint([NOTEBOOK_VIEW]);
  expect(near.ok, near.reason).toBe(true);
  expect(await d.clickThing("notebook"), "the notebook off the platform").toBe(true);
  await s.waitFor(() => d.propOwner("notebook") === "frank", "the notebook to go in the bag");
  expect(s.num("phase"), "taking it advances the phase").toBe(3);
  await beat("m3.3 the notebook in hand");

  // -- Zeitel ----------------------------------------------------------------
  // He comes over and speaks on his own; `smokestack()` runs his puppet.
  await s.waitFor(() => d.conversing() || d.moviePlaying(), "Zeitel to come over");
  const talked = await nav.talk({ say: [101, 101, 101, 101, 101], otherwise: "first", maxTurns: 120 });
  expect(talked.ok, talked.reason).toBe(true);
  await s.waitFor(() => d.propOwner("notebook") === "zeit", "him to take it");

  // Wait for the mission to have actually TURNED OVER before the beat, not just
  // for the phase number: `advancephase()` into mission 4 changes set to c73 and
  // deals mission 4's world through `inven.shp initprops` (the antidote, the baby,
  // the boat pass). The browser run diverged here on exactly that — set "none"
  // mid-load against a golden "c73", and three props not yet dealt — because how
  // far a transition has got when a beat is taken depends on frames drawn. Waiting
  // for the far side of it is the fix; nothing here is masked.
  await s.waitFor(
    () => d.setName() === "c73" && d.propOwner("antidote") === "zeit",
    "mission 4 to open in Frank's cabin",
  );

  await beat("m4.0 the notebook handed over");
  expect(s.num("mission"), "and that rolls the mission over").toBe(4);
  expect(s.num("phase"), "at its first phase").toBe(0);
}

/**
 * Segment 25 — the endgame opens: Penny at the cabin door.
 *
 * Mission 4 is not another errand ladder, and reading it out is most of what
 * this segment is for. Three structural facts, all from the scripts:
 *
 * **Mission 4's `phase` is a countdown, not a chain of gestures.** `advanceday()`
 * for `clock = "startdisk2"` sets the clock to 13:0X and `sinkflag = true`, and
 * BOOTFILE's `calctime()` — one call per main-loop pass, twenty to the game
 * second — then calls `advancephase()` on EVERY tick while that flag is set.
 * Mission 4's arm of `advancephase` is a timetable against the clock: 13:15 is
 * phase 1, 13:30 phase 2, 13:45 phase 3, 13:55 phase 4, 14:00 phase 5, and 14:05
 * is `playerdeath = "by sinking"`. Each step plays `sinkN.mov` and re-opens the
 * set one deck further under water. So nothing a route does advances the phase,
 * and there are six of them, which is what the six `sink0..5.trk` themes are.
 *
 * **Which is why this segment is short.** `serviceGameClock` runs on both hosts
 * now — it used to be gated on `hasRealFrames`, which froze the sinking in the
 * host that writes the goldens and made every mission-4 golden the trace of a
 * ship that isn't sinking. Ungated, the two agree to the minute, because
 * `canadvance()` pins hrs/min at each threshold until `sinkmovie()` has played
 * (docs/04-mission-flow.md). What still differs is how many real seconds a host
 * spends between beats, so a mission-4 segment has a wall-clock budget it can
 * genuinely run out of, and they are kept short.
 *
 * **Penny is knocking on the door.** `c73.set openset` arms
 * `makeloop("scene", "scene49", "pennyknock", 100)` at `mission = 4 &
 * pennyphase = 0`, and the door's own mousedown (c9) answers it by running
 * `penny2.pup` instead of opening: `sendtoactor("penny", runpuppet("penny2.pup",
 * ""))`, then `playnewtheme("sink" @ phase @ ".trk")`. Her `afterberg()` is a
 * monologue with no plaques in it — she takes back what the Purser was holding,
 * plays `lenin.mov`, tells you to move, and sets `pennyphase = 1`. There is
 * nothing to answer and nothing to get wrong.
 *
 * The "2" puppet files are the other half of this. Every character has a `1`
 * (before the sinking) and a `2` (during it) — a two-CD split, not a story one —
 * and container 5 of each is the "Boot Script" that forwards to container 6,
 * named "before" in the mission 1-3 files and **"after"** in the mission-4 ones.
 * `penny2.pup` c5 is the first "after" any route has run.
 */
export async function segment25(s: Story): Promise<void> {
  const { nav, d, beat } = s;

  await beat("m4.0 the endgame opens");
  expect(s.num("mission"), "the ship is sinking").toBe(4);
  expect(s.num("phase"), "and phase 0 is 13:00 to 13:15").toBe(0);
  expect(d.setName(), "mission 4 deals you back into Frank's cabin").toBe("c73");
  expect(s.num("pennyphase"), "she has not been in yet").toBe(0);
  expect(s.num("sinkflag"), "the flag that turns calctime into a countdown").toBe(1);
  // `initprops` dealt the endgame's three objects to the three people who hold
  // them, and every errand in mission 4 is one of these moving:
  expect(d.propOwner("antidote"), "Zeitel has poisoned Georgia").toBe("zeit");
  expect(d.propOwner("baby"), "Beatrix has Shay's child").toBe("bx");
  expect(d.propOwner("boatpass"), "Buick is playing cards for it").toBe("buick");

  // -- the knock -------------------------------------------------------------
  // Same standpoint as segment 2's steward, and the same gesture: space is the
  // boot script's "the door in front of me". The door does not open — the
  // mission-4 branch of c73.set c9 runs her puppet and puts the door back.
  const atDoor = await nav.faceStandpoint(["view55"], ["scene49"]);
  expect(atDoor.ok, atDoor.reason).toBe(true);
  await d.pressSpace();
  await s.waitFor(() => d.conversing() || d.moviePlaying(), "Penny at the door");

  // No plaques anywhere in `afterberg()`, so nothing is planned: the route only
  // has to click past the lines and the one movie in the middle of them.
  const recap = await nav.talk({ otherwise: "first", maxTurns: 40 });
  expect(recap.ok, recap.reason).toBe(true);
  await s.waitFor(() => s.num("pennyphase") === 1, "her briefing to finish");

  await beat("m4.0 Penny's been in");
  expect(s.num("pennyphase"), "afterberg() ends by setting this").toBe(1);
  expect(s.num("phase"), "and it does NOT advance the phase — the clock does").toBe(0);

  // -- and then Zeitel's cabin, for the notebook ----------------------------
  await bomb(s);
  await beat("m4.0 the notebook back, and the bomb defused");
}

/** where each of `bomb.stg`'s nine switch positions is, from its click-logic table */
const BOMB_AT = {
  "1B": { x: 140, y: 239 }, // switch1 -> 0
  "1C": { x: 186, y: 257 }, // switch1 -> 1
  "3B": { x: 281, y: 129 }, // switch2 -> 2   (yes, 3B drives switch TWO)
  "2A": { x: 398, y: 279 }, // switch3 -> 2   (and 2A drives switch THREE)
  OK: { x: 465, y: 352 },
};

/**
 * Zeitel's cabin, the bomb, and the notebook — the errand `revhappens` wants.
 *
 * The notebook has been his since segment 24, and it had to be: handing it over is
 * the only exit from mission 3. So this is a recovery, and the game charges for it.
 * Walk into C-59 in mission 4 and `c59.set` c105's `openscene` shuts the trap —
 * `bombphase = 1`, `setupactor("zeit", "c59")`, the camera turned onto him. His
 * `zeit2.pup c59()` puts the notebook DOWN in the room where you can see it, offers
 * three bevels that are all 104 so the answer cannot matter, locks the door and
 * leaves you with the bomb. The door answers `doorlocked` until it is defused.
 *
 * **Winning is three numbers, and the stage's own debug cheat `solvebomb()` names
 * them**: `unibomdoor = 0`, `propdeg("key") = 5`, `unibompower = -1`. `hitok()`
 * tests exactly those, in that order, and `boomer()`s on the first.
 *
 * `changedone()` re-reads all three switches after EVERY change, so the board has to
 * be safe at every intermediate step, and six of the nine positions are fatal:
 *
 *     switch3  0 door shut · 1 BOOM · 2 solenoid up
 *     switch2  0 BOOM if the solenoid is up · 1 BOOM · 2 power on, timer starts
 *     switch1  0 BOOM if the key is not out · 1 arms the striker · 2 BOOM
 *
 * The order below is the puzzle. `unibompower = -1` has exactly one source —
 * `hammershake()`, which `unibomnoise` calls at `unibomcount >= 58` **and
 * `unibomflag = 0`**; with the flag up it calls `singleding()` instead, which is
 * `boomer()`. And `unibomflag` is 1 precisely while `switch1 = 1` (cleared at the top
 * of every `changedone`). So the timer must run out with `switch1 = 0` — which
 * requires the key still out — and the key can only be turned afterwards, with
 * `switch1` put back. Turning the solenoid up before the power is on is the other
 * way to lose: `switch2 = 0` with the solenoid up is `boomer()`.
 */
export async function bomb(s: Story): Promise<void> {
  const { nav, d } = s;

  const cabin = await nav.travel("c59");
  expect(cabin.ok, cabin.reason).toBe(true);

  // The ambush is SCENE 12's openscene and `travel` lands in Scene10, so it does not
  // fire on arrival — walking in is what springs it.
  const inside = await nav.faceStandpoint(["view29"], ["scene12"]);
  expect(inside.ok, inside.reason).toBe(true);
  await s.waitFor(() => s.num("bombphase") === 1, "Zeitel to shut the door");

  // openscene then ends with `sendtoactor("zeit", mousedown(0))` — it clicks him FOR
  // you — and that call does not fire. Measured: the identical dispatch run by hand a
  // few frames later does, so it is not the dispatch; something openscene needs is
  // not ready yet, most likely the `realdist(me) < hotdist()` gate its cast mousedown
  // opens with, with the camera still arriving. Clicking him is the same scene by the
  // same handler, and is what a player would do anyway if the game forgot to.
  if (!d.conversing()) {
    expect(await d.clickThing("zeit"), "Zeitel, waiting with the gun").toBe(true);
  }
  const ambush = await nav.talk({ otherwise: "last", maxTurns: 30 });
  expect(ambush.ok, ambush.reason).toBe(true);
  expect(d.propVisible("notebook"), "he puts the notebook down where you can see it").toBe(true);

  // -- the bomb -------------------------------------------------------------
  if (!(await d.clickHotspot("bomb"))) {
    const found = await nav.hunt("bomb");
    expect(found.ok, found.reason).toBe(true);
  }
  expect(d.inFlat(), "bomb.stg is open").toBe("Bomb 1");
  expect(s.num("bombphase"), "and c107 has counted it").toBe(2);

  /**
   * Throw a switch and check it took.
   *
   * `boomer()` either hands you the key and leaves the flat, or closes and re-opens
   * the stage — which puts `switch1` back to 1 and zeroes the count. Either way the
   * switch is not where it was put, so that is the test. There is nothing else to
   * read: an explosion is two movies and a silent reset.
   */
  const throwSwitch = async (region: keyof typeof BOMB_AT, prop: string, want: number) => {
    await d.clickAt(BOMB_AT[region].x, BOMB_AT[region].y);
    expect(d.inFlat(), `${region} went off — the flat closed`).toBe("Bomb 1");
    expect(d.propDeg(prop), `${region} put ${prop} on ${want}`).toBe(want);
  };

  await throwSwitch("1B", "switch1", 0); // safe: the key is still out
  await throwSwitch("3B", "switch2", 2); // power on, and the timer starts
  await throwSwitch("2A", "switch3", 2); // solenoid up — fatal BEFORE the power
  expect(s.num("unibomdoor"), "switch3 off zero is what opens the casing").toBe(0);

  // 58 turns of an 11-step loop, the dial hand sweeping 0..57, then the hammer
  // shakes against a striker nothing has armed
  await s.waitFor(() => s.num("unibompower") === -1, "the bomb to ring itself out");
  expect(s.num("unibomcount"), "the timer ran to the end").toBeGreaterThanOrEqual(58);

  await throwSwitch("1C", "switch1", 1); // now the key may move
  for (const want of [4, 5]) {
    expect(await d.clickThing("key"), "the key").toBe(true);
    expect(d.propDeg("key"), "the key turns").toBe(want);
  }

  await d.clickAt(BOMB_AT.OK.x, BOMB_AT.OK.y);
  expect(d.inFlat(), "hitok closed it, which only a defused bomb does").toBe(null);
  expect(d.propOwner("bombkey"), "and handed the key over").toBe("frank");

  // -- the notebook, off the floor ------------------------------------------
  if (!(await d.clickThing("notebook"))) {
    const got = await nav.hunt("notebook");
    expect(got.ok, got.reason).toBe(true);
  }
  expect(d.propOwner("notebook"), "OURS — rushrev's only condition").toBe("frank");

  const out = await nav.travel("hallc");
  expect(out.ok, out.reason).toBe(true);
  expect(s.str("playerdeath"), "and we walked out of it").toBe("");
}

/**
 * Segment 26 — up to the first-class lounge: a shawl, and a woman left to die.
 *
 * The endgame's first errand is a trade offered under duress, and **this route
 * refuses it.** Zeitel has poisoned Lady Georgia and will hand over the antidote
 * for the painting — `zeit2.pup`'s `poison()` → `savegeorgia()` → `givepaint()`,
 * which does `giveinven("painting", "zeit")` and `addinven("antidote")` in the same
 * breath. The route used to take that deal and buy the painting back with a boat
 * pass off Buick's blackjack table, and the trouble with that is not the morality:
 * `shuffle()` is 52 draws off the seeded stream, so which hand the table deals is a
 * property of every step the run took to get there. Correcting six door guards in
 * the ship graph turned a winning hand into two busts (docs/reference/route.md), and with
 * the pass went the painting, `twohappens`, and the good ending.
 *
 * The two ways to keep `twohappens = false` are therefore: **win a hand of
 * blackjack, or never let go of the painting.** Only one of them is the route's to
 * decide. So this segment hears Zeitel out and tells him he is bluffing, which is
 * the one plaque in the whole conversation that does not lead into `givepaint()`,
 * and Lady Georgia dies of the poison. It is the ugliest thing in the route and the
 * only place it chooses a death; the plaque is commented where it is said, with what
 * the game gives in return.
 *
 * **Clariss Limehouse is in the doorway and cannot be walked past.**
 * `LNGHALL.SET` c5's keydown at view12 is the way into the lounge, and at
 * `mission = 4 & clarisphase = 0` it runs `doclaris()` instead of the trip: her
 * puppet opens, she is somewhere else entirely ("ACT -- She continues in a dream
 * like state"), and she gives you a **shawl** before setting `clarisphase = 1`.
 * The press is consumed, so the way in takes two — one for her, one for the door.
 * Her `clarisdream()` needs BOTH of its questions answered before it lets go
 * (`while f1 = 0 | f2 = 0`), so the route says 101 and then 102.
 *
 * The shawl is a souvenir now, and the route takes it because it cannot refuse it:
 * `clarisdream()` ends on `sendtoshop("inven.shp", addinven("shawl"))` and only then
 * sets `clarisphase = 1`, so owning it is the cheapest proof her puppet ran to the
 * end — which is all the `waitFor` below is asking.
 *
 * It used to be the point of the trip. `vlad2.pup`'s `tradevlad()` takes it in
 * exchange for any one thing Vlad is holding, and one of those is the real necklace
 * — which is one of the four ownerships the closing narration reads (narend.stg
 * `worldwar1()`). That was retired segment 28, and the necklace sub-plot in mission 1
 * phase 4 ({@link necklace}) makes `propowner("realneck")` "frank" from the first
 * hour instead, so there is nothing left to trade for.
 *
 * **Two minutes a conversation, and that is the clock.** `gang.cst`'s
 * `prepuppet()` does `min = min + 2` at `mission = 4`, and `doclaris()` and the
 * blackjack table each do their own. So in mission 4 talking to people is what
 * spends the fifteen minutes to the next sinking — the countdown is driven by the
 * player, not only by the wall clock, and seven conversations is a phase.
 */
export async function segment26(s: Story): Promise<void> {
  const { nav, d, beat } = s;

  await beat("m4.0 Penny's been in");
  expect(s.num("mission")).toBe(4);
  expect(s.num("phase")).toBe(0);
  expect(s.num("pennyphase"), "she has been and gone").toBe(1);
  expect(d.propOwner("painting"), "still ours, out of the cargo hold").toBe("frank");

  // -- up two flights of the grand staircase ---------------------------------
  // No deck map in mission 4, so this is walked: hallc -> gstair3 (C) -> gstair3
  // (B) -> gstair2 (A) -> lnghall, and the two middle hops are the climbs the
  // navigator only learned this session (shipgraph's CLIMB_TRIPS).
  const hall = await travelPast(s, "lnghall");
  expect(hall.ok, hall.reason).toBe(true);
  await beat("m4.0 the lounge hall");

  // -- Clariss, in the doorway -----------------------------------------------
  const doorway = await nav.faceStandpoint(["view12"]);
  expect(doorway.ok, doorway.reason).toBe(true);
  await d.pressSpace(); // the lounge door
  expect(d.propVisible("door"), "the lounge door is open").toBe(true);
  await d.pressUp(); // doclaris() eats it
  await s.waitFor(() => d.conversing() || d.moviePlaying(), "Clariss in the doorway");
  const dream = await nav.talk({ say: [101, 102], otherwise: "first", maxTurns: 40 });
  expect(dream.ok, dream.reason).toBe(true);
  await s.waitFor(() => s.owns("shawl"), "her shawl");
  await beat("m4.0 the shawl");
  expect(s.num("clarisphase"), "and now the door is a door again").toBe(1);
  expect(d.setName(), "the press went to her, not the doorway").toBe("lnghall");

  // -- Zeitel ----------------------------------------------------------------
  // `LOUNGE1C.SET openset` puts him there for `phase < 2` and while he has not
  // taken the boat pass — and he is 7782 units from the standpoint the door leaves
  // you at, against a lounge `hotdist()` of 3500. So the click has to be walked
  // for, which is what `accost` is: a hunt judged on whether he answered rather
  // than on whether the click landed on him.
  const lounge = await travelPast(s, "lounge1c");
  expect(lounge.ok, lounge.reason).toBe(true);
  const found = await nav.accost("zeit");
  expect(found.ok, found.reason).toBe(true);

  // 101 "Yes." — hear the deal out; 101 "Whose life?"; 102 "What sort of poison
  // is it?" (101 there is an empty case that falls through to the same body, so
  // 102 is the one that cannot be misread); then **102 "No. You're bluffing."**
  //
  // That last plaque is the whole of this segment now, and it is the difference
  // between finishing the game and winning it. `savegeorgia()`'s 101 is the only
  // door to `givepaint()`, and `givepaint()` is a `while f2 < 2` loop with no good
  // way out: 101 hands the painting over for the bottle, and refusing it twice runs
  // `playerdeath = "by zeitel"` AND `giveinven("painting", "zeit")` in the same
  // branch. Once you are inside it the painting is his either way. 102 never enters
  // it — it says `actorowner("zeit", "nohelpga")` and returns, and the painting is
  // never mentioned.
  //
  // The cost is Georgia, and it is worth being plain about it: `addinven("antidote")`
  // appears exactly once in the whole corpus, inside `givepaint()`, so there is no
  // other bottle to fetch and no other thing to swap for it. Refusing is choosing to
  // let her die.
  //
  // What that buys is the ending. `NAREND.STG` scores the twentieth century on four
  // ownerships and nothing else — `rubaiyat`/`realneck` with Vlad, `painting` not
  // ours, `notebook` not ours — and Georgia is in none of them; `dorescues()` reads
  // `propowner("antidote") = "ga"` and promotes her, which changes no flag the
  // closing narration looks at. So keeping the painting settles `twohappens` here,
  // in one plaque, where the alternative was to give it away and buy it back with a
  // boat pass off Buick's blackjack table — a hand whose deal is 52 draws off the
  // seeded stream and therefore not the route's to count on
  // (docs/reference/route.md).
  const deal = await nav.talk({ say: [101, 101, 102, 102], otherwise: "first", maxTurns: 60 });
  expect(deal.ok, deal.reason).toBe(true);
  await s.waitFor(() => s.actorOwner("zeit") === "nohelpga", "him to take the refusal");

  await beat("m4.0 the painting kept, Georgia refused");
  expect(d.propOwner("painting"), "never his — this is `twohappens` settled").toBe("frank");
  expect(d.propOwner("antidote"), "and the bottle stays in his pocket").not.toBe("frank");
  expect(s.str("playerdeath"), "refusing to HELP is not refusing HIM — nobody is shot").toBe("");
  expect(s.num("zeitelphase"), "savegeorgia() sets this on its way past").toBe(1);
}

/**
 * Answer the question the m4anti checkpoint loads INTO (TODO 7a).
 *
 * The save records the view segment 26 ends on, and `LOUNGE1C.SET` c320's
 * `openscene` ambushes exactly that view — so the load's own `changeset` re-runs
 * the ambush, Zeitel walks up mid-load, and `savegeorgia()` re-offers the deal:
 * `nohelpga` is not final, he asks again every time while Georgia is dying. The
 * load dispatch is suspended inside `puppetevent(-1)` until somebody answers, so
 * answering belongs to RESUMING, not to segment 27 — a carried game never sees
 * this conversation and the segment stays carried-shaped.
 *
 * The answer is the refusal segment 26 chose, for the stakes it spells out
 * above: 101 is the only door to `givepaint()` and the painting is `twohappens`.
 * 102 speaks one line, re-sets `actorowner("zeit", "nohelpga")` — the value the
 * save carries anyway — and lets the load run its tail.
 */
export async function refuseZeitelAgain(s: Story): Promise<void> {
  const said = await s.nav.talk({ say: [102], maxTurns: 20 });
  if (!said.ok) throw new Error(`Zeitel's load-time ambush went unanswered: ${said.reason}`);
}

/**
 * Where the Gorse-Joneses find you, and the way off the ship.
 *
 * `DECKBD2.SET` c1012's keydown: press up at View211 or View212 of Scene44 with
 * `phase < 3`, `jonesphase = 0` and `frame() - jonesframe > 2000`, and the set
 * runs `jones2.pup` — they accost you in lifejackets, unruffled — then answering
 * "Yes, I'll get on the boat" sets `clock = "endgame"` and the SAME handler calls
 * `advanceday()`, which is the end of the game.
 *
 * The frame gate is the interesting half. `jonesframe` is assigned nowhere else in
 * the corpus, so it is 0 unless a save carries one, and `frame()` counts displayed
 * frames from the start of the session — which means a resumed segment has to spend
 * 2000 of them before they will speak. That is a real wait rather than a state, and
 * the only place in the route where the answer to "why did nothing happen?" is
 * "not yet".
 */
const JONES_STAND = { views: ["view211", "view212"], scene: "scene44" };

/**
 * Segment 27 — the boat deck, the Gorse-Joneses, and the end of the game.
 *
 * `advanceday()` for `clock = "endgame"` is the whole ending: `leave.mov`,
 * `debris.mov`, then `narend.stg` — the closing narration — and that stage reads
 * FOUR ownerships and nothing else to decide which history the twentieth century
 * gets:
 *
 *   `worldwar1()`   the Rubaiyat or the real necklace left with Vlad -> the war
 *                   happens anyway (`onehappens`)
 *   `worldwar2()`   the painting not ours -> `twohappens`
 *   `rushrev()`     the notebook not ours -> `revhappens`
 *   `futures()`     all three false is "7,50,51,51b,52,53,54,proz", the one arm
 *                   that sets `mission = "good"` and plays the credits
 *
 * So the ending is scored on the bag, and the route now arrives with all four of
 * those ownerships ours — which is the whole of `futures()`'s first arm and the only
 * one that sets `mission = "good"`:
 *
 *   the Rubaiyat   ours since the coal bunker, mission 1 phase 3
 *   the necklace   ours since mission 1 phase 4 — the necklace sub-plot
 *                  ({@link necklace}), which is what let the turbine-room trade
 *                  that used to be a segment of its own be dropped altogether
 *   the painting   ours because segment 26 refuses Zeitel's deal. Lady Georgia dies
 *                  of the poison for it; the alternative is to hand the painting
 *                  over and win it back at Buick's blackjack table, and what that
 *                  table deals is 52 draws off the seeded stream rather than
 *                  anything the route decides (docs/reference/route.md)
 *   the notebook   recovered rather than kept — handing it to Zeitel is the only
 *                  exit from mission 3, so it comes back out of the bomb in c59
 *
 * The segment still reads the verdict off the game rather than asserting it in
 * advance: `mission` is not assigned until the closing narration has read the last
 * paper out, and what it says is what the run earned.
 */
export async function segment27(s: Story): Promise<void> {
  const { nav, d, beat } = s;

  // The ship is going down on WALL time from here on: `advancephase()` hangs off
  // calctime, so which sinking phase a beat is sampled in is a race between the
  // route and the ship rather than anything the route decides. Measured across
  // three browser runs of an older version of this route: phase 1 / 0 / 1, against
  // headless 0 — the same two beats disagreeing with themselves and with the other
  // host. masks.ts deliberately keeps `phase` asserted ("everything the sinking
  // runs on stays asserted, so game time genuinely running slow still fails a
  // golden"), so the answer is not to stop comparing it.
  //
  // This USED to wait for `phase >= 1` to make that moment definite, and the wait
  // was the single most expensive line in the run: **231 s of a 1854 s browser
  // gate**, one game minute (13:14 → 13:15) at the ~4:1 the browser's calctime runs
  // against the wall. It is gone, and both halves of why are measurements rather
  // than principle:
  //
  //   1. It was buying the WRONG definite moment. A beat taken the instant `phase`
  //      flips is a beat taken inside the phase advance: `playnewtheme("sink" @
  //      phase @ ".trk")` lands in the tail of that script, and a pumped host
  //      finishes the tail before it can be asked while a browser does not. That is
  //      what the last gate reported — `theme: browser "none" vs golden
  //      "sink1.trk"` at this very beat, the run's only divergence. Sampling AWAY
  //      from a phase advance removes the race instead of racing it.
  //   2. The browser is BEHIND the boundary here, not past it. It needed those
  //      231 s to cross 13:15, so at the handover both hosts are at 13:14 and
  //      phase 0 — which is a legal ending too: `DECKBD2.SET` c1012's keydown gate
  //      only wants `phase < 3`, and `frame() - jonesframe > 2000` is already true
  //      in a carried game.
  //
  // What remains is a bounded risk rather than a certainty: a run whose clock
  // straddles 13:15 during the handover records phase 1 here and phase 0 there.
  // If that ever shows up it is two beats' worth of a scoped allowance, and 231 s
  // is not the price to pay for avoiding it (TODO §4a, §7b).
  await beat("m4.0 the painting kept, Georgia refused");
  expect(s.num("mission")).toBe(4);
  expect(d.propOwner("rubaiyat"), "ours since the coal bunker — one of the four").toBe("frank");
  // both halves of worldwar1(), so `onehappens` will come out false
  expect(d.propOwner("realneck"), "and the necklace since mission 1 phase 4").toBe("frank");

  // -- up to the boat deck ---------------------------------------------------
  // From A deck this is the grand staircase and travel walks it: gstair2 ->
  // gstair1 by the climb the extractor could not see, then the vestibule.
  const deck = await travelPast(s, "deckbd2");
  expect(deck.ok, deck.reason).toBe(true);
  await beat("m4.0 the boat deck");

  // -- the Gorse-Joneses -----------------------------------------------------
  // Pressing up at the rail is a poll, not a gesture: until 2000 displayed frames
  // have gone by they are not there at all and the press is an ordinary walk along
  // the boat deck. And the boat deck is crowded — `hotdist()` is **500** here, the
  // tightest reach in the game, but a walk still passes close enough to be stopped
  // by Morrow or a steward — so each try starts by answering whoever is talking.
  //
  // Which conversation it IS has to be read off the plaques, because the flag that
  // says so (`jonesphase`) is only set at the END of their scene.
  // Nothing brings them sooner — but nothing has to be waited out on its own
  // either, and two waits used to sit here doing exactly that: ninety seconds of
  // a predicate that cannot hold, for the frame gate, and then a second wait for
  // phase 1 that the wait at the top of this segment has already made true
  // (nothing between them can lower `phase`). Both were dead time in front of a
  // loop that IS the wait: each try presses up, and a press that lands before
  // the gate opens is an ordinary walk along the boat deck which spends ~200
  // frames of the 2000 the gate wants. A carried game arrives with `frame()` in
  // the tens of thousands and takes the boat on the first try; a resumed one
  // walks the deck until they turn up (measured once at frame 2194, with
  // `jonesframe` written at 2195).
  let spoke = false;
  for (let tries = 0; tries < 14 && !spoke; tries++) {
    if (d.conversing()) await nav.talk({ otherwise: "last", maxTurns: 60 });
    const rail = await nav.faceStandpoint(JONES_STAND.views, [JONES_STAND.scene]);
    if (!rail.ok) continue;
    await d.pressUp();
    if (!(await d.waitFor(() => d.conversing(), "someone at the rail", 8000))) continue;
    // Whoever it is, 101 is the answer we want from THEM ("Yes, I'll get on the
    // boat") and a harmless one from anybody else; `jonesphase` is how we know
    // which it was, and it is only set once their scene is over.
    const said = await nav.talk({ say: [101], otherwise: "last", maxTurns: 120 });
    expect(said.ok, said.reason).toBe(true);
    spoke = s.num("jonesphase") === 1;
  }
  expect(spoke, "nobody offered us a place in a lifeboat at the rail").toBe(true);

  // The same handler that runs their puppet reads `clock` straight afterwards and
  // calls `advanceday()`, so answering "Yes, I'll get on the boat" plays the whole
  // ending inside this one gesture: leave.mov, debris.mov, the narend.stg
  // slideshow, and playmore.mov.
  // narend.stg reads the closing papers out one flat at a time and every one of
  // them is gated on its own `voicewait()` — `while voicedone() = false:
  // sendtoboot(idle())` — and `mission` is not assigned until the last has been
  // read. Headless that whole loop is a handful of pumped ticks; in a browser it
  // is minutes of real voice audio, and settling is not the same as waiting for
  // it: the beat was landing with `scriptBusy` still true and reading mission = 4.
  // So wait for the assignment itself, which is the game's own last word.
  const read = await d.waitFor(
    () => ["bad", "good"].includes(s.str("mission")),
    "the closing narration to finish reading the papers out",
    300_000,
  );
  expect(read, `narration unfinished — mission is still ${s.str("mission")}`).toBe(true);
  // `mission` is assigned one line BEFORE narend plays the last movie, and that
  // movie is the game's final image (boom.mov here — the worst of the seven).
  // Sampling between the two catches narend still open: `lockevents` up and
  // `savestage1` still "main.stg", because closestage() has not run yet.
  // narend's own closestage() puts `lockevents` back down (NAREND.STG 0001:20),
  // which is the game saying the credits stage has finished unwinding.
  //
  // That is NOT "after the final movie", and asking for `!moviePlaying()` here
  // deadlocked on purpose-built ground. BOOTFILE 0002's `clock = "endgame"` block
  // reads, in order:
  //
  //     transtoflat ("narend.stg")     opennarend, prozac.mov, ...
  //     transfromflat ()               <- closestage: lockevents = false
  //     playmovie ("credits.mov")      <- and this one PARKS, on 14 pages
  //     quit ()
  //
  // so from the instant `lockevents` drops there is never again a moment with no
  // movie on screen: credits.mov is up and waiting for the player to turn it, and
  // the pages are only turned by the loop BELOW this wait. The two halves of the
  // condition were satisfiable only inside one synchronous script run, and the
  // 150 ms browser poll never landed there — measured, this wait spent its full
  // 180 s timeout on every browser run and then passed anyway on the next line.
  //
  // What the beat actually needs is "narend is closed and nothing is mid-frame",
  // and a movie parked on its regions IS the game standing still — `movieWaiting`
  // is the distinction, so accept it.
  await d.waitFor(
    () => s.num("lockevents") === 0 && (!d.moviePlaying() || d.movieWaiting()),
    "the credits stage to unwind (narend closestage)",
    180_000,
  );

  await beat("the end of the game");
  expect(s.str("clock"), "the ending ran").toBe("endgame");
  // narend.stg's opennarend() assigns the STRING "good" or "bad" over `mission`
  // when it has finished reading the papers out — the same global the missions
  // counted in, which is the game's own last word on how it went.
  expect(s.str("mission"), "THE CREDITS — narend.stg's own last word on the run").toBe("good");
  // The three flags are the scoring, one per artifact, and all three are down:
  expect(s.num("onehappens"), "the Rubaiyat and the real necklace are ours").toBe(0);
  expect(s.num("twohappens"), "and the painting, which was never let go of").toBe(0);
  expect(s.num("revhappens"), "and the notebook, out of Zeitel's cabin").toBe(0);
  // `futures()` has seven arms and six of them are a war of some kind. All-false is
  // "7,50,51,51b,52,53,54,proz" — the only one that sets `mission = "good"` and
  // plays the credits, and the only one this route was ever aiming at.

  // -- and the credits, which are TURNED, not watched -------------------------
  // `credits.mov` looks like a cutscene and is not: measured, fourteen of its
  // fifteen frames carry exactly ONE region — the whole screen, (0,0)-(512,384),
  // type 6 (step), with a click sound — and the fifteenth carries none and
  // exits. So it is fourteen pages of names that wait for the player, and a
  // harness that ESCs past cutscenes ends the game one gesture short of its
  // last line: `advanceday()` runs `playmovie("credits.mov")` and then `quit()`,
  // which is the game asking the host to put the main menu back. Turning the
  // pages is what lets that line run at all.
  for (let page = 0; page < 20; page++) {
    // The credits' own signature: parked on ONE region, and that region steps.
    // Worth testing rather than counting to fourteen, because `quit()` may have
    // put the boot menu back by the time the last page is turned — and THAT
    // clip is parked too, on two regions (Play and the Guided Tour). Turning
    // one more page there would start a second game.
    const regions = d.movieRegions();
    if (!d.movieWaiting() || regions.length !== 1 || regions[0].type !== 6) break;
    const turn = await nav.clickMovie((r) => r.type === 6, `credits page ${page + 1}`);
    if (!turn.ok) break;
  }
  // No beat after this one: `quit()` is the last thing the game does and what it
  // does is host-defined — the page goes back to the boot, so there is nothing
  // left to sample and nothing a golden could hold.
}
