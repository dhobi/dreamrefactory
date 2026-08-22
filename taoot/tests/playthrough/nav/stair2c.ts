/**
 * The 2nd-class staircase, which is one flight of stairs pretending to be six.
 *
 * `STAIR2C.SET` is nine standpoints in a single line — the F-deck landing at the
 * bottom, the boat-deck landing at the top, and a flight of stairs between them —
 * and `savedeck` is the label that says which deck the middle currently IS. The
 * set's own road table (its eight transitions, viewIDs resolved to names) is the
 * whole geography:
 *
 *     Scene13/View29 <-> Scene10/View16     the F-deck landing
 *     Scene10/View15 <-> Scene11/View18     a flight
 *     Scene11/View20 <-> Scene12/View25
 *     Scene12/View22 <-> Scene41/View47     a flight
 *     Scene41/View49 <-> Scene42/View52
 *     Scene42/View51 <-> Scene43/View54     a flight
 *     Scene43/View56 <-> Scene44/View61
 *     Scene44/View58 <-> Scene45/View63     a flight
 *
 * Four of those standpoints are wired to `savedeck` by the set's keydown (c1),
 * and that is what turns a line into a loop:
 *
 *   * **Scene42/View51**, climbing, runs `savedeck = nextdeck("up")` (f->e->d->c
 *     ->b->a, then nothing) and puts you back at the BOTTOM (`currentscene
 *     ("scene10")`, `currentview("view15")`) one deck higher.
 *   * **Scene11/View18**, descending, runs `nextdeck("down")` (a->b->...->e) and
 *     puts you near the top (Scene43/View54) one deck lower.
 *   * **Scene45/View63** and **Scene10/View15** write "a" and "e" outright — the
 *     two ends are absolute.
 *
 * So the staircase is walked, not planned, and it is walked differently in each
 * direction. **Descending needs no help at all**: the planner's ordinary walk
 * presses up at each standpoint, View18 among them, and every accidental press
 * relabels the deck downward — which is exactly where the walk was going. That is
 * why `travel("turb")` reached the turbine room before any of this was understood.
 *
 * **Climbing has to be driven**, because the same accidents fight you: a plan that
 * walks back to View51 after a climb passes through View15, which writes "e", and
 * the route oscillates between two decks forever (measured: c -> d -> c -> d until
 * the gesture budget died). {@link climbStair2c} instead reads the scene it is
 * standing in and presses up at that scene's upward view, one step at a time —
 * the same shape as the smokestack (nav/smokestack.ts): a loop, not a search.
 *
 * ## It used to stop at C deck, and that was ours — FIXED
 *
 * The rung works by `passcode`: the keydown relabels the deck, cuts you to
 * Scene10/View15, and passes the key on so the engine's own default move walks you
 * up out of it. Two of the six rungs call a helper that ends in `exitcode` just
 * before that `passcode` — `setupshayhack()` when it has Shay and the Hacker to
 * place (`savedeck = "c"` with the baby unclaimed) and `setupcsea()` when it has the
 * Chief Engineer to place (`savedeck = "b"`). The rung passcoded correctly every
 * time, but our `eventConsumed` was set by ANY `exitcode` anywhere under the
 * dispatch, so the default walk was suppressed and you were left standing ON
 * View15 — where the only road onward writes `savedeck = "e"` and undoes two decks
 * of climbing. Measured: f -> e -> d -> c, then c -> e -> d -> c for ever.
 *
 * The rule was ours, not TI.EXE's, and the fix is one comparison: `exitcode` sets
 * the flag only for the event its own frame is a handler OF (engine/src/runtime/interp.ts).
 * The climb now runs f -> e -> d -> c -> b -> a, so **the turbine room is not a
 * one-way trip** and the endgame's checkpoint is not a dead end
 * (docs/taoot/verification.md, on `exitcode` and the staircase).
 *
 * What stops a climb now is the ship being inhabited: decks C and B are where those
 * two helpers PLACE Shay, the Hacker and the Chief Engineer, whose `hotdist()` a
 * passing walk trips. `travel()` is right to refuse to continue mid-sentence, so
 * `nav.travelThrough` answers first and walks on — with the plan still the
 * caller's, because which answer you give is the story.
 */
import type { Story } from "../story";

/** the view that walks UP out of each scene of the staircase */
export const STAIR2C_UP: Record<string, string> = {
  scene13: "view29", // the F-deck landing, onto the bottom of the stairs
  scene10: "view15", // ...and up the first flight (writes savedeck = "e")
  scene11: "view20",
  scene12: "view22",
  scene41: "view49",
  scene42: "view51", // the deck rung: nextdeck("up") and back to the bottom
  scene43: "view56",
  scene44: "view58",
};

/**
 * The view that walks DOWN out of each scene — the same road table read the other
 * way, since every one of those eight transitions is bidirectional.
 *
 * Going down needs no driving to REACH the bottom (see above: every accidental
 * press relabels the deck downward, which is where a descent was going anyway).
 * What it needs driving for is stopping on a PARTICULAR deck, and that is what
 * {@link descendStair2cTo} is for.
 */
export const STAIR2C_DOWN: Record<string, string> = {
  scene45: "view63", // the boat-deck landing, onto the top of the stairs
  scene44: "view61",
  scene43: "view54",
  scene42: "view52",
  scene41: "view47",
  scene12: "view25",
  scene11: "view18", // the deck rung: nextdeck("down") and back up near the top
  scene10: "view16", // ...and out onto the F-deck landing
};

/** the top landing, where the two boat-deck doors are (View64 and View65) */
export const STAIR2C_TOP = "scene45";

/** the scene we are standing in, lowercase */
const sceneOf = (s: Story): string => {
  const at = s.d.at();
  return (s.d.set().scenes[at.sceneIdx]?.sceneName ?? "").toLowerCase();
};

/**
 * Climb to the boat-deck landing, one standpoint at a time.
 *
 * Each step is a turn and a press, never a walk, so nothing can be pressed by
 * accident. Progress is not monotonic in scenes — the rung at Scene42/View51
 * throws you back to the bottom one deck up — so the loop is bounded by the work
 * it can possibly need: six decks of four scenes, with slack.
 */
export async function climbStair2c(s: Story): Promise<{ ok: boolean; reason?: string }> {
  const { nav, d } = s;
  if (d.setName() !== "stair2c") return { ok: false, reason: `not in stair2c but in ${d.setName()}` };
  for (let step = 0; step < 40; step++) {
    const scene = sceneOf(s);
    if (scene === STAIR2C_TOP) {
      s.log?.(`at the top of the 2nd-class stairs (savedeck ${String(d.flow().savedeck)})`);
      return { ok: true };
    }
    const up = STAIR2C_UP[scene];
    if (!up) return { ok: false, reason: `no way up out of ${scene} of stair2c` };
    const faced = await nav.faceStandpoint([up], [scene]);
    if (!faced.ok) return { ok: false, reason: `${scene}: ${faced.reason}` };
    await d.pressUp();
    if (d.setName() !== "stair2c") {
      return { ok: false, reason: `pressing up at ${scene}/${up} left the staircase for ${d.setName()}` };
    }
    if (sceneOf(s) === scene) {
      return { ok: false, reason: `pressing up at ${scene}/${up} went nowhere` };
    }
  }
  return { ok: false, reason: `still on the stairs after 40 steps (savedeck ${String(d.flow().savedeck)})` };
}

/**
 * Walk down until `savedeck` says the wanted deck, and stop there.
 *
 * The mirror of {@link climbStair2c}, and it exists for one reason: the staircase
 * is INHABITED per deck, and which deck you are standing on decides who is
 * standing there with you. `STAIR2C.SET setuptrout()` places the Reverend at
 * `mission = 1 & phase >= 1 & savedeck = "e" & troutphase < 2`, and a route that
 * wants to deal with him has to be able to arrive on E deck deliberately instead
 * of passing through it at whatever speed the host happens to walk.
 *
 * Reads the deck back after every press rather than counting rungs, because the
 * rung is not the only thing that writes it — Scene10/View15 writes "e" outright
 * on the way past, which is exactly the accident the climb has to fight (see
 * above). Here it is harmless: the loop simply looks again.
 *
 * Stops on arrival, and does not care which scene that leaves us in — the rung
 * cuts you to Scene43/View54 one deck lower, so "on E deck" is a label and not a
 * place.
 */
export async function descendStair2cTo(s: Story, deck: string): Promise<{ ok: boolean; reason?: string }> {
  const { nav, d } = s;
  if (d.setName() !== "stair2c") return { ok: false, reason: `not in stair2c but in ${d.setName()}` };
  const want = deck.toLowerCase();
  for (let step = 0; step < 40; step++) {
    if (String(d.flow().savedeck ?? "").toLowerCase() === want) {
      s.log?.(`down to deck ${want} of the 2nd-class stairs`);
      return { ok: true };
    }
    const scene = sceneOf(s);
    const down = STAIR2C_DOWN[scene];
    if (!down) return { ok: false, reason: `no way down out of ${scene} of stair2c` };
    const faced = await nav.faceStandpoint([down], [scene]);
    if (!faced.ok) return { ok: false, reason: `${scene}: ${faced.reason}` };
    await d.pressUp();
    if (d.setName() !== "stair2c") {
      return { ok: false, reason: `pressing down at ${scene}/${down} left the staircase for ${d.setName()}` };
    }
    // A conversation is a legitimate outcome of a step down: the deck we just
    // reached may have put somebody within their own hotdist. The caller decides
    // what to say, so stop and let it.
    if (d.conversing()) {
      s.log?.(`someone spoke up on deck ${String(d.flow().savedeck)} of the stairs`);
      return { ok: true };
    }
  }
  return { ok: false, reason: `never reached deck ${want} (savedeck ${String(d.flow().savedeck)})` };
}
