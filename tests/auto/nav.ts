/**
 * The navigator's judgement, tested where the route cannot reach it.
 *
 * `Navigator.hunt` sweeps a room's standpoints clicking for a thing, and what it
 * ANSWERS is the interesting part: a click that lands is not a click that did
 * anything. `inven.shp`'s `stdmouse` gates every object lying in a room on
 * `realdist(what) < hotdist()`, so a click from across the room hits the object and
 * is then discarded — and `ok` to that sends the failure downstream, to whichever
 * later assertion notices the thing was never picked up (an hour of debugging the
 * first time, and five warnings in segments.ts).
 *
 * The playthrough cannot cover this, and that is the point of testing it here: the
 * route was tuned AROUND the bug, standpoint by standpoint, so a full green run
 * makes not one dud click. Proving the fix needs a room where the click is
 * guaranteed to do nothing, which is what the stub below is.
 *
 * The driver is a stub rather than the real one for the same reason: a dud is
 * defined by the game deciding to ignore a click, and the honest way to test the
 * navigator's response to that is to hand it one.
 */
import { test, expect } from "vitest";
import { Navigator, NavDriver } from "../playthrough/nav/navigator";
import { newHost } from "../harness";
import type { SetFile } from "../../src/df/set";

/**
 * A room with ONE standpoint and nowhere to go from it, so a sweep runs out of
 * places after a single click and `hunt` has to commit to a verdict.
 *
 * Taken from a real set rather than hand-built, because `planWithin` reads the
 * scene's turn rings and roads out of the file's own records and a fake would be a
 * second implementation of the thing under test. The rings and transitions are then
 * EMPTIED, which the slicing alone does not do: `turnRing` reads
 * `scene.turns[dir].frames` and will happily name a view that is no longer in the
 * list, so a set with one view and a live ring plans a turn to a standpoint that
 * does not exist — which is how the first version of this test span out to the
 * 60-gesture budget instead of reaching the verdict.
 */
async function oneStandpointSet(): Promise<SetFile> {
  const { session } = await newHost();
  await session.openSetFile("b59.set");
  const real = session.currentBinding!.set;
  return {
    ...real,
    transitions: [],
    scenes: [{ ...real.scenes[0], views: [real.scenes[0].views[0]], turns: [] }],
  } as unknown as SetFile;
}

/**
 * A driver that always lands the click, and whose world changes only if
 * `effect` says it should. Everything else answers the quiet, nothing-happening
 * state a dud leaves behind.
 */
function stubDriver(set: SetFile, effect: "dud" | "takes"): { d: NavDriver; clicks: () => number } {
  let clicks = 0;
  let owner = "";
  const d = {
    set: () => set,
    setName: () => "b59",
    at: () => ({ sceneIdx: 0, viewIdx: 0 }),
    flow: () => ({}),
    propVisible: () => false,
    propOwner: () => owner,
    propState: () => "",
    propDeg: () => 0,
    propValue: () => 0,
    actorSpot: () => null,
    inFlat: () => null,
    theme: () => "",
    conversing: () => false,
    conversingWith: () => "",
    awaitingChoice: () => false,
    choices: () => [],
    handItem: () => "",
    moviePlaying: () => false,
    movieWaiting: () => false,
    movieRegions: () => [],
    turn: async () => {},
    pressUp: async () => {},
    pressSpace: async () => {},
    clickHotspot: async () => true,
    clickThing: async () => {
      clicks++;
      // the whole difference between the two cases: a live click puts the object
      // in your pocket (`propowner` "frank"), a dud leaves the room exactly as it
      // was, which is what `stdmouse` does when you are out of reach
      if (effect === "takes") owner = "frank";
      return true;
    },
    // no pumping: the stub's world only changes inside clickThing, so a wait that
    // is going to be satisfied is satisfied already
    waitFor: async (until: () => boolean) => until(),
  } as unknown as NavDriver;
  return { d, clicks: () => clicks };
}

test("hunt: a click that lands but moves nothing is not a success", async () => {
  const set = await oneStandpointSet();
  const { d, clicks } = stubDriver(set, "dud");
  const res = await new Navigator(d).hunt("notebook");
  expect(res.ok, `hunt reported ${JSON.stringify(res)}`).toBe(false);
  // and it says WHY, in the game's own terms, rather than "gave up"
  expect(res.reason).toMatch(/nothing moved/);
  expect(res.reason).toMatch(/hotdist/);
  // it really did try the click — this is a judgement about the effect, not a
  // refusal to click (nav/reach.ts is emphatic that a snapshot must never refuse
  // a gesture, and the numbers there say why)
  expect(clicks()).toBeGreaterThan(0);
});

test("hunt: a click that moves something is a success", async () => {
  const set = await oneStandpointSet();
  const { d, clicks } = stubDriver(set, "takes");
  const res = await new Navigator(d).hunt("notebook");
  expect(res.ok, `hunt reported ${JSON.stringify(res)}`).toBe(true);
  expect(clicks()).toBe(1);
});
