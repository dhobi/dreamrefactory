/**
 * The ship as a graph you can walk.
 *
 * Every way out of a room in this game has one shape: stand in a particular
 * view, have the door open, press up. The scripts say so 243 times over — a
 * `keydown` handler guarded by `currentview() = "viewNN" & arg = "uparrow" &
 * propvisible("door")` that ends in `gotospecial(set, scene, view)`. A handful
 * go by `mousedown` on a hotspot instead. That regularity is what makes routes
 * plannable instead of hand-coded: a route says "go to the gym" and the
 * navigator works out the seven rooms and the thirty gestures.
 *
 * The trips themselves are extracted from the scripts by taoot/tools/flowmap.ts into
 * shipgraph.gen.ts. This module is the part written by hand: the shape of a
 * trip, and the rules for whether one is available right now.
 */
import { SHIP_TRIPS } from "./shipgraph.gen";

export interface ShipTrip {
  /** set you leave (lowercase, no extension) */
  from: string;
  /** set you arrive in */
  to: string;
  /**
   * How the trip is taken: press up at a standpoint, click a hotspot, or — for
   * the hand-written {@link CLIMB_TRIPS} — just walk to the standpoint and let
   * the scene's own `openscene` carry you (`walkto`).
   */
  by: "keydown" | "mousedown" | "openscene" | "other" | "walkto";
  /** the view(s) the guard accepts you standing in */
  stand: string[];
  /** the scene(s) too, where the guard pins one — the grand staircase reuses
   *  view names across its decks, so the view alone is ambiguous there */
  standScene: string[];
  /** props the guard needs visible — doors, which must be opened first */
  needsVisible: string[];
  /**
   * Comparisons on flow globals the guard imposes — `savedeck = "b"`,
   * `mission < 4`. Extracted, not evaluated in general: a term the extractor
   * doesn't recognise sets {@link partial} instead of being quietly dropped.
   */
  needs: { var: string; op: string; value: string | number }[];
  /**
   * Flow globals taking this exit ESTABLISHES. Not bookkeeping: the grand
   * staircase's landings set `savedeck`, and `savedeck` is what decides which
   * deck the staircase doors then open onto. Plan with guards alone and the
   * ship looks disconnected above C deck.
   */
  sets: Record<string, string | number>;
  /** where you land in the target set: [scene, view] */
  arrive: [string, string];
  /**
   * True when a guard term wasn't recognised by the extractor. The navigator
   * refuses to plan through these — a guard we half-understand would send the
   * route somewhere the game never intended, and the failure would show up
   * rooms later as "the door didn't open".
   */
  partial: boolean;
  /** the original guard text, for when a route needs explaining */
  guard: string;
}

/**
 * Ways between rooms the extractor cannot see, read out of the scripts by hand.
 *
 * All four are the grand staircase going UP, and they are missing for the same
 * reason: climbing it is not a gesture. `GSTAIR3.SET` c452/c480 and
 * `GSTAIR2.SET` c449/c453 are **`openscene`** handlers — they fire when a scene
 * OPENS, so the "gesture" is simply walking into the top scene of a flight, and
 * arriving at its stair view teleports you. The extractor records the four it
 * finds in gstair2 as `openscene` edges (which {@link TAKEABLE} refuses, since a
 * route cannot press or click one), and misses gstair3's two entirely because
 * their destination is a `switch savedeck` rather than a literal.
 *
 * Nobody noticed while the deck map worked: `travel` jumped to the stairwell it
 * wanted and walked from there. Mission 4 turns the map off (`mapdisabled()`
 * returns true for the whole sinking) and the ship immediately looks
 * one-directional — c73 to the first-class lounge planned a fourteen-room walk
 * through five sets that are not on the sinking's disc at all.
 *
 * `by: "walkto"` rather than "openscene" on purpose: these four are read out and
 * measured, and the extractor's `openscene` guesses are not, so they stay
 * excluded. {@link Navigator.takeTrip} takes a walkto by walking to the
 * standpoint and judging the trip on where it ended up.
 *
 * The two gstair3 pairs are the same flight twice over, because gstair3 IS both
 * B and C deck — `savedeck` says which, and a climb from C lands you in the same
 * set with `savedeck = "b"`. Only that flight writes `savedeck`; the two that
 * change set leave it alone (so a walk into gstair2 still reads "b"), and
 * `sets` says so rather than tidying it up — a route that assumed otherwise
 * would plan a door on A deck that isn't there.
 */
const CLIMB_TRIPS: ShipTrip[] = [
  // C deck landing -> B deck landing, the same set with savedeck flipped
  { from: "gstair3", to: "gstair3", by: "walkto", stand: ["view68"], standScene: ["scene65"],
    needsVisible: [], needs: [{ var: "savedeck", op: "=", value: "c" }], sets: { savedeck: "b" },
    arrive: ["scene13", "view32"], partial: false,
    guard: 'GSTAIR3.SET c480 openscene: currentview() = "view68" & savedeck = "c"' },
  { from: "gstair3", to: "gstair3", by: "walkto", stand: ["view73"], standScene: ["scene64"],
    needsVisible: [], needs: [{ var: "savedeck", op: "=", value: "c" }], sets: { savedeck: "b" },
    arrive: ["scene17", "view49"], partial: false,
    guard: 'GSTAIR3.SET c452 openscene: currentview() = "view73" & savedeck = "c"' },
  // B deck landing -> A deck, which is a different set
  { from: "gstair3", to: "gstair2", by: "walkto", stand: ["view68"], standScene: ["scene65"],
    needsVisible: [], needs: [{ var: "savedeck", op: "=", value: "b" }], sets: {},
    arrive: ["scene13", "view32"], partial: false,
    guard: 'GSTAIR3.SET c480 openscene: currentview() = "view68" & savedeck = "b"' },
  { from: "gstair3", to: "gstair2", by: "walkto", stand: ["view73"], standScene: ["scene64"],
    needsVisible: [], needs: [{ var: "savedeck", op: "=", value: "b" }], sets: {},
    arrive: ["scene17", "view49"], partial: false,
    guard: 'GSTAIR3.SET c452 openscene: currentview() = "view73" & savedeck = "b"' },
  // A deck -> the boat deck. These two the extractor DID find, as openscene; they
  // are restated here as walkto so a route can take them, and the generated pair
  // is left where it is rather than edited (shipgraph.gen.ts is generated).
  { from: "gstair2", to: "gstair1", by: "walkto", stand: ["view73"], standScene: ["scene64"],
    needsVisible: [], needs: [], sets: {},
    arrive: ["scene15", "view27"], partial: false,
    guard: 'GSTAIR2.SET c449 openscene: currentview() = "view73"' },
  { from: "gstair2", to: "gstair1", by: "walkto", stand: ["view68"], standScene: ["scene65"],
    needsVisible: [], needs: [], sets: {},
    arrive: ["scene17", "view29"], partial: false,
    guard: 'GSTAIR2.SET c453 openscene: currentview() = "view68"' },
];

/**
 * The three passenger corridors are each ONE corridor pretending to be two, and
 * `hallside` is the label that says which side it currently IS — the same trick
 * `savedeck` plays on the 2nd-class staircase (nav/stair2c.ts), one deck at a
 * time instead of six.
 *
 * `HALLA.SET` c1, `HALLB.SET` c1 and `HALLC.SET` c1 each hold two rungs: press
 * up at one end and the keydown flips `hallside`, cuts you to the other end's
 * standpoint, and `passcode`s so the engine's own move walks you on. Nothing
 * about it changes the set, so the extractor — which reads `gotospecial` calls —
 * cannot see them at all, and the graph had A deck, B deck and C deck as three
 * corridors with no way of crossing to their own other half.
 *
 * A toggle needs two edges, because the search plans over a state and cannot
 * express "whatever it currently isn't".
 */
const HALLSIDE_TRIPS: ShipTrip[] = (
  [
    // set, the two rungs as [scene|"", view, where it cuts you to]
    ["halla", ["", "view12", "scene15", "view16"], ["", "view17", "scene10", "view11"]],
    ["hallb", ["scene52", "view59", "scene10", "view15"], ["scene10", "view16", "scene52", "view58"]],
    ["hallc", ["scene52", "view59", "scene10", "view15"], ["scene10", "view16", "scene52", "view58"]],
  ] as [string, string[], string[]][]
).flatMap(([set, ...rungs]) =>
  rungs.flatMap(([scene, view, toScene, toView]) =>
    (["star", "port"] as const).map((side) => ({
      from: set,
      to: set,
      by: "keydown" as const,
      stand: [view],
      standScene: scene ? [scene] : [],
      needsVisible: [],
      needs: [{ var: "hallside", op: "=", value: side }],
      sets: { hallside: side === "star" ? "port" : "star" },
      arrive: [toScene, toView] as [string, string],
      partial: false,
      guard: `${set.toUpperCase()}.SET c1 keydown: ${scene ? `${scene}/` : ""}${view} & uparrow, hallside = "${side}"`,
    })),
  ),
);

/**
 * Which side of the ship a door is on — the guard that is NOT in the handler the
 * extractor reads.
 *
 * Every one of these rooms is reached the same way: `keydown` at a view, with
 * `propvisible("door")`. But the door is only made visible by its own
 * `mousedown`, and THAT is where the side lives:
 *
 *     HALLC.SET c146   if hallside = "star" → setupprop("hallc-c73")
 *                      if hallside = "port" → voicesound("knock1")
 *
 * So the keydown looks unconditional, the extractor records `needs: []`, and a
 * route planned through the wrong half of the corridor walks up to a door that
 * will never open. That is a real failure and not a theoretical one: choosing
 * `gstair3` over `stair1c2` for a three-cost tie into C deck reported "door would
 * not open in hallc" — the plan was right about the rooms and wrong about the
 * side, which is exactly the mistake this table exists to stop.
 *
 * SIDE ONLY, deliberately. Several of these doors are story-gated as well
 * (`hallb -> b59` wants `letterphase` 2-4, `hallb -> b70` wants `neckphase` 2 or
 * 5, `halla -> a14` reads mission and phase), and those are conditions a route
 * KNOWS it is satisfying — it is knocking because the story sent it. The side is
 * different: it is a fact about the ship, true at every phase, and invisible to
 * whoever wrote the route.
 */
const SIDED_DOORS: { from: string; to: string; stand: string; side: "port" | "star" }[] = [
  { from: "halla", to: "gstair2", stand: "view25", side: "star" }, // c320: port is doorlocked
  { from: "halla", to: "gstair2", stand: "view96", side: "port" }, // c623: star is doorlocked
  { from: "halla", to: "a14", stand: "view57", side: "port" }, //     c483: Sasha's door
  { from: "hallb", to: "b59", stand: "view40", side: "star" }, //     c235: Conkling's
  { from: "hallb", to: "b70", stand: "view48", side: "port" }, //     c333: the Gorse-Joneses'
  { from: "hallc", to: "c73", stand: "view34", side: "star" }, //     c146: our own cabin
];

/** the generated trips with {@link SIDED_DOORS}' guard put back on */
const sided = (trip: ShipTrip): ShipTrip => {
  const door = SIDED_DOORS.find(
    (d) => d.from === trip.from && d.to === trip.to && trip.stand.includes(d.stand),
  );
  if (!door || trip.needs.some((n) => n.var === "hallside")) return trip;
  return { ...trip, needs: [...trip.needs, { var: "hallside", op: "=", value: door.side }] };
};

export const SHIP_TRIPS_ALL: ShipTrip[] = [
  ...SHIP_TRIPS.map(sided),
  ...CLIMB_TRIPS,
  ...HALLSIDE_TRIPS,
];

export { SHIP_TRIPS };

/**
 * The sets that exist while the ship is sinking — every SET file on disc 1.
 *
 * Not a rule about doors: mission 4 runs `setpath(1)` (BOOTFILE `advanceday`,
 * `clock = "startdisk2"`), and the sinking's disc carries 23 sets against disc
 * 2's 52. `decka`, `recept1c`, `poop`, `scot1-3`, `a14`, `b59`, `b70`, `c78`,
 * the boiler room, the cargo hold, the squash court and the smokestack are not
 * on it AT ALL, so a route planned through one asks for a file the game cannot
 * open.
 *
 * The scripts say the same thing from the other side, which is the corroboration
 * that this list is the right shape rather than a coincidence of packaging:
 * `GSTAIR2.SET` c148/c241 and `STAIR1C1.SET` c178/c382 answer the A-deck
 * promenade doors with `voicesound("doorlocked")` at `mission = 4`, and
 * `GSTAIR3.SET` c1 sends an officer (`asea2.pup`, "xxxrecept1c") instead of
 * opening the reception. The ship shuts exactly the doors that lead off the disc.
 */
const SINKING_WORLD = new Set([
  "bedsit1", "c59", "c73", "cafe", "deckbd2", "gstair1", "gstair2", "gstair3",
  "gym", "halla", "hallb", "hallc", "hallf2c", "lnghall", "lounge1c", "smoke",
  "stair1c1", "stair1c2", "stair2c", "turb", "vestport", "veststbd", "wireless",
]);

/** the globals a trip's guard can depend on, read off the live session */
export type FlowState = Record<string, string | number | undefined>;

/**
 * The ways out of a room the navigator can actually take.
 *
 * The graph records every transition it found, and two of the kinds are not
 * gestures a player makes: `openscene` fires when a scene opens (the set walks you
 * itself) and `other` is a transition some script performs for its own reasons. 19
 * of the 271 edges are one or the other, and {@link Navigator.takeTrip} can only
 * press up or click a door — so planning through one produces a route that cannot
 * be walked, and the failure lands mid-journey as "don't know how to take a
 * \"other\" trip" rather than at the plan.
 *
 * recept1c is where this first bit: its only DIRECT edges to gstair3 are two
 * `other` and two `openscene`, so a plan through them stranded a segment in the
 * reception with the cufflink in its pocket — while a perfectly good walk out
 * through halld or turkstrs went unconsidered. Filtering here rather than at the
 * call sites is what makes the search find that walk instead.
 */
const TAKEABLE = new Set(["keydown", "mousedown", "walkto"]);

/** Does this trip's guard hold, given the current flow globals? */
export function tripAvailable(trip: ShipTrip, state: FlowState): boolean {
  if (trip.partial) return false;
  if (!TAKEABLE.has(trip.by)) return false;
  // While the ship is sinking the ship is smaller — see SINKING_WORLD
  if (Number(state.mission ?? 0) === 4 && !SINKING_WORLD.has(trip.to)) return false;
  return trip.needs.every((n) => {
    const have = state[n.var];
    // Numeric comparison when both sides are numbers; string equality otherwise.
    // An absent global reads as 0/"" the way the interpreter's does.
    if (typeof n.value === "number") {
      const lhs = typeof have === "number" ? have : Number(have ?? 0);
      switch (n.op) {
        case "=": return lhs === n.value;
        case "!=": return lhs !== n.value;
        case "<": return lhs < n.value;
        case "<=": return lhs <= n.value;
        case ">": return lhs > n.value;
        case ">=": return lhs >= n.value;
      }
    }
    const lhs = String(have ?? "");
    return n.op === "!=" ? lhs !== String(n.value) : lhs === String(n.value);
  });
}

/** Every trip out of `set` that is available now. */
export function tripsFrom(set: string, state: FlowState): ShipTrip[] {
  const from = set.toLowerCase();
  return SHIP_TRIPS_ALL.filter((t) => t.from === from && tripAvailable(t, state));
}

/** the flow vars a trip can read or write — the search state, beyond the room */
const TRACKED = ["hallside", "savedeck"] as const;

/**
 * Shortest room-by-room route from one set to another, or null if there isn't
 * one under the current flow state.
 *
 * Breadth-first over (room, flow state) rather than over rooms alone, because
 * some exits establish the state a later exit is guarded on — climbing to the
 * B landing is what makes the B-deck door openable. Searching rooms only would
 * report the gym unreachable from a C-deck cabin, which is what it did before
 * `sets` was extracted.
 *
 * Not over standpoints, though: within a room the navigator finds its own way
 * to the standpoint (setpath.ts), because where a walk leaves you facing is
 * decided at arrival and can't be known here.
 */
export function routeTo(from: string, to: string, state: FlowState): ShipTrip[] | null {
  const start = from.toLowerCase();
  const goal = to.toLowerCase();
  if (start === goal) return [];
  const key = (set: string, s: FlowState) => set + "|" + TRACKED.map((v) => s[v] ?? "").join(",");
  const seen = new Set([key(start, state)]);
  const queue: { set: string; state: FlowState; path: ShipTrip[] }[] = [{ set: start, state, path: [] }];
  while (queue.length) {
    const cur = queue.shift()!;
    for (const trip of tripsFrom(cur.set, cur.state)) {
      const next = [...cur.path, trip];
      if (trip.to === goal) return next;
      const after = { ...cur.state, ...trip.sets };
      const k = key(trip.to, after);
      if (seen.has(k)) continue;
      seen.add(k);
      queue.push({ set: trip.to, state: after, path: next });
    }
  }
  return null;
}
