/**
 * The deck map as a travel table.
 *
 * From cabin C73 onward Frank carries Smethells' deck map, and the game's own
 * answer to "get to the other end of the ship" is to open it and press a
 * stairwell. Eight deck plans, a couple of live red areas each.
 *
 * STAIRWELLS, and that is the honest shape of it. MAP.STG has 32 regions that
 * call `jumpbaby`, but 15 of them sit behind `if not debugging → exitcode` and do
 * nothing whatever in a shipped game — the gymnasium, the lounge, the smoking
 * room, the fore and poop decks are all developer shortcuts. What is left reaches
 * eight sets, every one a staircase or a stair landing. So a trip is a jump to
 * the right stairwell and a walk from there, which is what the map is for.
 *
 * (That guard cost an afternoon. Reading the jumpbaby without reading the `if`
 * above it, the harness pressed the gymnasium six times, got no answer, and I was
 * some way into diagnosing a dropped-click bug in the flat dispatch before
 * noticing the game was refusing on purpose. tools/mapjumps.ts now reads the
 * guard, and the gate test asserts none of the emitted areas carry it.)
 *
 * The rectangles and destinations are read out of MAP.STG by tools/mapjumps.ts,
 * not written down here; see mapjumps.gen.ts. What lives in this file is the
 * knowledge that isn't in the region table: which page a set is on is derivable,
 * but WHETHER the map may be used at all is a script, and that script is the
 * whole reason a route can't simply always jump.
 */
import { MAP_EXIT_REGION, MAP_JUMPS, MAP_PAGE_BUTTONS } from "./mapjumps.gen";
/** the script globals a guard is evaluated against — the shipgraph's own type,
 *  restated here so this module carries no dependency on the test tree */
type FlowState = Record<string, string | number | undefined>;

/** one red area on one deck plan */
export interface MapJump {
  /** the set it takes you to, lowercase */
  to: string;
  /** which deck plan it is on (1 = boat deck, 2 = A … 8 = G) */
  page: number;
  /** the deck letter the page stores in `savedeck` — right for the stair you land on */
  deck: string;
  /**
   * The flat click-region to press, by name.
   *
   * A name and not a coordinate on purpose: a flat region resolves through the
   * engine's own hittest as `{name, type: "button"}` (SetViewer's session
   * .hitTestAt), so aiming at it goes through the rule the rest of the harness
   * keeps — only ever click a point the engine agrees IS the thing (nav/aim.ts).
   * The names are the artists' own ("Button22"), unique within a plan.
   */
  region: string;
  /** the scene and view `changeset` is called with */
  arrive: [string, string];
}

/** a page-turn button — the same region name on every plan */
export interface MapPageButton {
  page: number;
  region: string;
}

export { MAP_EXIT_REGION, MAP_JUMPS, MAP_PAGE_BUTTONS };

/**
 * Which plan is on screen, from the flat's own name, or null if the map isn't up.
 *
 * The eight plans are eight flats named "Map 1".."Map 8", and `gotopage(n)` opens
 * flat n — so the name IS the page. Worth knowing because the tab of the page you
 * are already on cannot be clicked: `gotopage` parks the "buttons" highlight
 * sprite over it (`propdeg("buttons", arg - 1)`), and a sprite wins the hit test
 * against a flat region. That is the game telling you there is nowhere to turn to,
 * not a hotspot that has gone missing.
 */
export function currentPage(flat: string | null): number | null {
  const m = /^map (\d+)$/i.exec(flat ?? "");
  return m ? Number(m[1]) : null;
}

/**
 * Sets the map refuses to leave FROM, out of MAP.STG's own `mapdisabled()`.
 *
 * The list is not arbitrary and it is not about the map: these are the places
 * where being able to leave in one click would break a scene. The stack tops
 * (smstack1-3) are a climb, the boiler room and the cargo hold are where you are
 * being chased, and bind/bing/binl are the binoculars. Same call also refuses
 * while mission 4 is running — the ship is sinking and the plans no longer help.
 */
const MAP_DISABLED_IN = new Set([
  "smstack1", "smstack2", "smstack3", "boil", "cargo", "bind", "bing", "binl",
]);

/**
 * Can the map be opened here at all — MAP.STG's `mapdisabled()`, inverted.
 *
 * Both possessions matter and both are checked by the game, not by us:
 * `propowner("bag") != "frank"` or `propowner("watch") != "frank"` disables it,
 * which is why the map is dead until segment 2 has collected the pair off the bed
 * and the desk. `tour` overrides everything — the guided tour is nothing BUT map
 * jumps.
 */
export function mapUsable(setName: string, flow: FlowState, owns: (prop: string) => boolean): boolean {
  if (Number(flow.tour ?? 0)) return true;
  if (Number(flow.mission ?? 0) === 4) return false;
  if (!owns("bag") || !owns("watch")) return false;
  return !MAP_DISABLED_IN.has(setName.toLowerCase());
}

/**
 * The best red area for a destination, or null if the map doesn't offer one.
 *
 * A set can appear on more than one plan — `stair2c` is on all of them, since
 * every deck has that staircase — so prefer one that lands on the deck we are
 * already thinking about, then the lowest page, so the choice is deterministic.
 */
export function jumpTo(setName: string, preferDeck?: string): MapJump | null {
  const want = setName.toLowerCase();
  const candidates = MAP_JUMPS.filter((j) => j.to === want);
  if (!candidates.length) return null;
  const onDeck = preferDeck ? candidates.filter((j) => j.deck === preferDeck.toLowerCase()) : [];
  return (onDeck.length ? onDeck : candidates).reduce((a, b) => (a.page <= b.page ? a : b));
}

/** every set the map can reach, for a route that wants to know before it walks */
export function jumpableSets(): Set<string> {
  return new Set(MAP_JUMPS.map((j) => j.to));
}

/** where to click to turn to a plan */
export function pageButton(page: number): MapPageButton | null {
  return MAP_PAGE_BUTTONS.find((b) => b.page === page) ?? null;
}
