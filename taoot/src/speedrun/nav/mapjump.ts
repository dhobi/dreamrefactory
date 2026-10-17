/**
 * The shape of the deck plans' red areas and page buttons: what
 * taoot/tools/mapjumps.ts writes into mapjumps.gen.ts and mapjumps.ts reads.
 * Their own file so the generated table and its reader do not import each other.
 */

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
   * keeps — only ever click a point the engine agrees IS the thing (speedrun/src/aim.ts).
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
