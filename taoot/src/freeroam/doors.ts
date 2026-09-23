/**
 * Opening a door the story would keep shut.
 *
 * Every walk-through in the ship is the same two steps. You click the door,
 * whose hotspot script stands the shared `door` prop up in this doorway:
 *
 *     sendtoprop ("door", setupprop ("hallb-b59"))
 *
 * and then you press ↑, whose handler will only take the step if that worked:
 *
 *     if currentview () = "view40" & arg = "uparrow" & propvisible ("door")
 *         sendtostage (gotospecial ("b59", "scene14", "view19"))
 *
 * So a locked door is not a locked door. It is a hotspot whose script chose not
 * to call `setupprop`, and six of them make that choice on `tour` alone:
 * Sasha's cabin, Conk's, Charlotte's, the two C-deck cabins and the 1st Class
 * Lounge all answer a guided tour with `voicesound ("knock1")` and nothing else.
 *
 * This module is the answer to that, and it is deliberately the smallest one
 * that works: LET THE SCRIPT GO FIRST, and step in only where it refused.
 *
 * A door is opened only where walking through it goes somewhere — see
 * {@link openWays}. Free roam is about reaching rooms, and a door that swings
 * onto a wall is worse than one that stays shut.
 *
 * {@link openIfRefused} runs off the engine's own `onHotspotClick`, which fires
 * when a hotspot's `mousedown` chain has run to COMPLETION, and asks the game —
 * not a model of it — whether the door is open. If it is, nothing happens at
 * all: the knock, the speech, the character who answers and the door that closes
 * again are the game's, and they still run. If the door is shut, the doorway
 * this hotspot would have used is looked up in {@link DOOR_SPOTS} and stood up
 * with the script line the hotspot itself would have run.
 *
 * Nothing here patches shipped script, and nothing here moves the player: the ↑
 * that follows is the game's own, and it lands in the scene and view the game
 * chose.
 */
import { DOOR_SPOTS, type DoorCond, type DoorSpot, type Doorway, type Lead } from "./doors.gen";
import { run, type ConsoleSession } from "../devmode/console";

/** the hotspot names boot's SPACE key treats as a door, by prefix */
const DOORISH = /^(door|locked|knock)/i;

/**
 * The globals that say WHERE you are standing rather than how far you have got.
 *
 * Free roam violates story state on purpose — that is the whole of it: `mission
 * = -1`, nobody is where a mission left them, and a cabin whose occupant has not
 * been met yet opens anyway. These two are not story state and must be obeyed.
 *
 * `hallside` is the one that bites. Each passenger corridor is ONE set used for
 * both sides of the ship, mirrored, and `hallside` says which: B deck's
 * `Scene29/View40` is B-59's door to starboard and B-62's to port, and the
 * doorway behind it is `hallb-b59` either way. The game never lets that matter,
 * because the doorknob refuses unless `hallside = "star"`. A page that ignored
 * it opened B-62 and put the player in B-59 — the right room for the other side
 * of the ship, and the wrong one for the door they clicked.
 *
 * `savedeck` is the same idea vertically: one staircase set serves every deck,
 * and which landing you are on is a variable rather than a room.
 */
const PLACE = new Set(["hallside", "savedeck"]);

/** what this module needs of a session — the engine's, narrowed to be testable */
export interface DoorSession extends ConsoleSession {
  readonly interp: ConsoleSession["interp"] & {
    globals: { get(name: string): unknown };
  };
}

/** one hotspot press, as the engine's `onHotspotClick` reports it */
export interface HotspotClick {
  paint: string;
  set: string;
  scene: string;
  view: string;
}

/** is this hotspot one of the three the game treats as a door? */
export function isDoorHotspot(paint: string): boolean {
  return DOORISH.test(paint);
}

/**
 * The row for a hotspot on the mounted CD, or null.
 *
 * A row is `0` when both discs carry the hotspot and agree about it; otherwise
 * it is named for the disc it was read from. The mounted disc's row wins, then a
 * shared one — and then, only where a single row exists at all, that one,
 * because a hotspot that lives on one CD has nothing to be confused with. What
 * is never done is picking the OTHER disc's row when both have one and they
 * disagree: C-deck's cabin door grew a `burnsphase` test on the second disc, and
 * answering with the wrong act's conditions is how the wrong cabin opens.
 */
export function doorSpot(
  set: string,
  scene: string,
  view: string,
  paint: string,
  disc: 1 | 2,
): DoorSpot | null {
  const match = DOOR_SPOTS.filter(
    (s) =>
      s.set === set.toLowerCase() &&
      s.scene === scene.toLowerCase() &&
      s.view === view.toLowerCase() &&
      s.paint.toLowerCase() === paint.toLowerCase(),
  );
  return (
    match.find((s) => s.disc === disc) ??
    match.find((s) => s.disc === 0) ??
    (match.length === 1 ? match[0] : null)
  );
}

/** the engine keeps `false` as 0 and `true` as 1, so a condition's literal has
 *  to be read the same way before it is compared */
function asValue(v: string | number | boolean): string | number {
  if (v === true) return 1;
  if (v === false) return 0;
  return v;
}

function holds(c: DoorCond, globals: { get(name: string): unknown }): boolean {
  const live = globals.get(c.var);
  const want = asValue(c.value);
  // a string global and a string literal compare case-insensitively, as the
  // script's own `=` does
  const same =
    typeof live === "string" && typeof want === "string"
      ? live.toLowerCase() === want.toLowerCase()
      : live === want;
  switch (c.op) {
    case "=":
      return same;
    case "!=":
      return !same;
    default: {
      // an ordering test is about numbers; anything else cannot be compared and
      // is reported as not holding rather than guessed at
      const a = typeof live === "number" ? live : Number(live);
      const b = typeof want === "number" ? want : Number(want);
      if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
      return c.op === "<" ? a < b : c.op === "<=" ? a <= b : c.op === ">" ? a > b : a >= b;
    }
  }
}

/**
 * Can this set of alternatives hold right now?
 *
 * One arm holding entirely is enough, and no arms at all means unconditional.
 * Used for LEADS, where the answer has to be yes or no rather than a ranking:
 * a walk-through whose guard cannot hold is not a way through, and a door in
 * front of one is a door onto nothing.
 */
export function satisfiable(
  when: readonly (readonly DoorCond[])[],
  globals: { get(name: string): unknown },
): boolean {
  return when.length === 0 || when.some((arm) => arm.every((c) => holds(c, globals)));
}

/** the rooms this hotspot's ↑ can actually reach in the state standing now */
export function openWays(
  spot: DoorSpot,
  globals: { get(name: string): unknown },
): Lead[] {
  return spot.leads.filter((l) => satisfiable(l.when, globals));
}

/**
 * The room behind this door that the ↑ will not take you to.
 *
 * There is one in the whole ship, and it is the 1st Class Lounge. Its step is
 * real and reaches `lounge1c`, but the corridor refuses it above the door:
 *
 *     if currentview () = "view12" & arg = "uparrow" & (tour | mission < 4)
 *         exitcode
 *     endif
 *
 * Nothing a page can set makes that false during a tour — `mission = 4` still
 * leaves `tour` true — so free roam takes the step itself, with the
 * `gotospecial` the script below the guard would have run.
 *
 * Which of a door's blocked leads is the right one is decided the same way a
 * doorway is: the conditions minus the one that is deliberately being
 * violated. The lounge is entered at `scene10/view16` off one staircase and
 * `scene14/view37` off the other, by `savedeck`, and taking the wrong one would
 * stand you in the wrong half of the room.
 */
export function blockedWay(
  spot: DoorSpot,
  globals: { get(name: string): unknown },
): Lead | null {
  if (openWays(spot, globals).length) return null; // the game will take it itself
  let best: Lead | null = null;
  let bestScore = -Infinity;
  for (const lead of spot.leads) {
    const arm = (conds: readonly DoorCond[]): number =>
      conds.reduce((n, c) => n + (holds(c, globals) ? 1 : -1), 0);
    const score = lead.when.length ? Math.max(...lead.when.map(arm)) : 0;
    if (score > bestScore) {
      bestScore = score;
      best = lead;
    }
  }
  return best;
}

/** the line the script below the guard would have run */
export function stepLine(lead: Lead): string {
  return (
    `sendtostage (gotospecial (${JSON.stringify(lead.to)}, ` +
    `${JSON.stringify(lead.scene)}, ${JSON.stringify(lead.view)}))`
  );
}

/**
 * Take a step the room refuses, when the door in front of it is standing open.
 *
 * The door being open is the condition, and it is not decoration: it is what
 * makes this the player's own doorway rather than a jump. You click the door, it
 * opens, you press ↑ — the same three things as everywhere else on the ship —
 * and the only difference is who runs the last one.
 */
export async function stepIfRefused(
  session: DoorSession,
  where: HotspotClick & { disc: 1 | 2 },
): Promise<{ stepped?: string; skipped?: "shut" | "no-block" }> {
  const spot = doorSpot(where.set, where.scene, where.view, where.paint, where.disc);
  if (!spot) return { skipped: "no-block" };
  const lead = blockedWay(spot, session.interp.globals);
  if (!lead) return { skipped: "no-block" };
  if (!(await doorIsOpen(session))) return { skipped: "shut" };
  await run(session, stepLine(lead));
  return { stepped: lead.to };
}

/**
 * Which of a hotspot's doorways to stand up.
 *
 * Eight hotspots offer more than one, and which is right is a condition the
 * script tests: C-78's door is the lit or the dark one by `whitelight`, the
 * C-deck cabin door is C-59 or C-78 by `hallside`, the purser's stairwell picks
 * by `savedeck`. Each candidate is scored by how many of its conditions hold
 * against how many are violated, best arm wins, and the highest-scoring doorway
 * is taken.
 *
 * Scoring rather than filtering, because in free roam the story state is
 * deliberately wrong: `advancetour` leaves `mission = -1`, so a doorway whose
 * only arm is `mission = 4` passes NO filter and would leave a one-doorway
 * hotspot with nothing to open. A score still ranks it first when it is the only
 * candidate, which is the answer that matches what a player just asked for.
 */
export function pickDoorway(
  spot: DoorSpot,
  globals: { get(name: string): unknown },
): Doorway | null {
  let best: Doorway | null = null;
  let bestScore = -Infinity;
  for (const d of spot.doorways) {
    // ...but never a doorway belonging to the other side of the ship. An arm
    // whose PLACE conditions do not hold is describing a different doorway, and
    // opening it would put the player in a room that is not behind this door.
    const place = d.when.filter((arm) =>
      arm.every((c) => !PLACE.has(c.var) || holds(c, globals)),
    );
    if (d.when.length && !place.length) continue;
    // an arm scores +1 per condition that holds and -1 per condition that does
    // not; a doorway scores its best arm, and an unconditional one scores 0
    const arm = (conds: readonly DoorCond[]): number =>
      conds.reduce((s, c) => s + (holds(c, globals) ? 1 : -1), 0);
    const score = place.length ? Math.max(...place.map(arm)) : 0;
    if (score > bestScore) {
      bestScore = score;
      best = d;
    }
  }
  return best;
}

/** the line the hotspot's own script would have run */
export function openLine(id: string): string {
  return `sendtoprop ("door", setupprop (${JSON.stringify(id)}))`;
}

/** ask the GAME whether the door is standing open, rather than modelling it */
export async function doorIsOpen(session: DoorSession): Promise<boolean> {
  const res = await run(session, `return (propvisible ("door"))`);
  return res.ok && !!res.value;
}

/** what {@link openIfRefused} did, for the page to report */
export interface DoorOutcome {
  /** the doorway that was stood up, when this module did it */
  opened?: string;
  /** the room it opened onto, for the page to name */
  to?: string;
  /** why nothing was done */
  skipped?: "already-open" | "no-doorway" | "not-a-door" | "leads-nowhere";
}

/**
 * One press on one door hotspot, judged once the game has had its turn.
 *
 * There is no waiting here and nothing is timed, because there is nothing left
 * to wait for: the engine calls `onHotspotClick` from the bottom of the dispatch
 * chain, after every handler in it has been awaited. A refusal — `voicesound
 * ("knock1")` then `exitcode` — is finished. So is a door that really opens and
 * everything that goes with it: the knock, the line of speech, the puppet, and
 * the `initprop` that shuts the door again in your face.
 *
 * `where` is the press's own room, scene and view rather than the ones standing
 * now, because a handler may have moved the player: A-14's `kickout` walks you
 * back into the corridor before it returns. The doorway to stand up belongs to
 * the wall that was knocked on.
 */
export async function openIfRefused(
  session: DoorSession,
  where: HotspotClick & { disc: 1 | 2 },
): Promise<DoorOutcome> {
  if (!isDoorHotspot(where.paint)) return { skipped: "not-a-door" };
  const spot = doorSpot(where.set, where.scene, where.view, where.paint, where.disc);
  if (!spot) return { skipped: "no-doorway" };
  /*
   * A door is worth opening only if walking through it goes somewhere, and that
   * is asked FIRST — before the door is even looked at — because the answer is
   * no in two different ways and neither is a state this page should paper over.
   *
   * D-19 on D deck is the first: `clarisdoor` opens so that Claris can stand in
   * it, the corridor's `uparrow` handlers are at two other views entirely, and
   * there is no room behind that number in the game. Penny's on F deck and
   * Shay's below are the same. Opening one shows a doorway and a wall.
   *
   * The second is a door with no doorway on this side: every doorway's
   * `hallside`/`savedeck` condition fails, so {@link pickDoorway} answers null
   * (B-62 from the port side is one).
   *
   * The 1st Class Lounge is not one of them, though it looks like one: its step
   * exists and reaches `lounge1c`, and what refuses it is the corridor's own
   * guard above the door. That is a door with a room behind it, so it opens —
   * and {@link stepIfRefused} takes the step when the ↑ arrives.
   */
  // `leads: []` is a door with no room on the other side at all — D-19 and its
  // two sisters — and that one stays shut. A door whose leads exist but are all
  // refused is a different thing and still a door: it opens, and the step behind
  // it is taken by {@link stepIfRefused} when the ↑ comes.
  if (!spot.leads.length) return { skipped: "leads-nowhere" };
  // ...and this side of the ship has to have a door here at all
  const way = pickDoorway(spot, session.interp.globals);
  if (!way) return { skipped: "no-doorway" };
  if (await doorIsOpen(session)) return { skipped: "already-open" };
  await run(session, openLine(way.id));
  return { opened: way.id, to: openWays(spot, session.interp.globals)[0]?.to };
}
