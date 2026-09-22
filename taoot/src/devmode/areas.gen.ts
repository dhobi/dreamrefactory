/**
 * The deck map's jump areas and their rectangles — GENERATED, do not edit.
 *
 * Regenerate with `npx tsx taoot/tools/mapareas.ts`, which reads them out of
 * MAP.STG and explains the three kinds. What they are FOR is in
 * `taoot/src/devmode/map-overlay.ts`.
 *
 * The rectangles are in the game's own 512x384 screen space, Y-first in the file
 * and named here, and they are for DRAWING only — the engine's `hittest` still
 * decides what a click does.
 */

/** one red area on one deck plan */
export interface MapArea {
  /** which deck plan it is on, 1 = boat deck */
  page: number;
  /** that plan's deck, as the tabs name it */
  deck: string;
  /** the flat's own name, which is what `session.currentFlat` reports */
  flat: string;
  /** the region's name, as the artists left it */
  region: string;
  left: number;
  top: number;
  right: number;
  bottom: number;
  /** the set it jumps to */
  to: string;
  /**
   * `live` — any player. `debug` — behind `if not debugging`. `dead` — a bare
   * `exitcode` above the jump, so it does nothing in any build.
   */
  kind: "live" | "debug" | "dead";
}

export const MAP_AREAS: readonly MapArea[] = [
  { page: 1, deck: "Boat", flat: "Map 1", region: "Button22", left: 27, top: 118, right: 137, bottom: 132, to: "deckbd", kind: "debug" },
  { page: 1, deck: "Boat", flat: "Map 1", region: "Button23", left: 27, top: 190, right: 137, bottom: 204, to: "deckbd", kind: "debug" },
  { page: 1, deck: "Boat", flat: "Map 1", region: "Button24", left: 382, top: 126, right: 492, bottom: 140, to: "deckbd", kind: "debug" },
  { page: 1, deck: "Boat", flat: "Map 1", region: "Button25", left: 383, top: 185, right: 493, bottom: 199, to: "deckbd", kind: "debug" },
  { page: 1, deck: "Boat", flat: "Map 1", region: "Button26", left: 300, top: 174, right: 348, bottom: 196, to: "gym", kind: "debug" },
  { page: 1, deck: "Boat", flat: "Map 1", region: "Button27", left: 348, top: 130, right: 383, bottom: 192, to: "gstair1", kind: "live" },
  { page: 1, deck: "Boat", flat: "Map 1", region: "Button46", left: 24, top: 150, right: 50, bottom: 174, to: "stair2c", kind: "live" },
  { page: 2, deck: "A", flat: "Map 2", region: "Button22", left: 70, top: 115, right: 180, bottom: 129, to: "decka", kind: "debug" },
  { page: 2, deck: "A", flat: "Map 2", region: "Button28", left: 387, top: 117, right: 497, bottom: 131, to: "decka", kind: "debug" },
  { page: 2, deck: "A", flat: "Map 2", region: "Button29", left: 388, top: 191, right: 498, bottom: 205, to: "decka", kind: "debug" },
  { page: 2, deck: "A", flat: "Map 2", region: "Button30", left: 72, top: 191, right: 182, bottom: 205, to: "decka", kind: "debug" },
  { page: 2, deck: "A", flat: "Map 2", region: "Button31", left: 70, top: 149, right: 97, bottom: 170, to: "stair2c", kind: "live" },
  { page: 2, deck: "A", flat: "Map 2", region: "Button32", left: 153, top: 129, right: 190, bottom: 191, to: "stair1c1", kind: "live" },
  { page: 2, deck: "A", flat: "Map 2", region: "Button33", left: 250, top: 130, right: 299, bottom: 193, to: "lounge1c", kind: "dead" },
  { page: 2, deck: "A", flat: "Map 2", region: "Button34", left: 365, top: 134, right: 408, bottom: 187, to: "gstair2", kind: "live" },
  { page: 2, deck: "A", flat: "Map 2", region: "Button47", left: 97, top: 130, right: 152, bottom: 191, to: "smoke", kind: "debug" },
  { page: 3, deck: "B", flat: "Map 3", region: "Button22", left: 3, top: 112, right: 21, bottom: 208, to: "poop", kind: "debug" },
  { page: 3, deck: "B", flat: "Map 3", region: "Button35", left: 113, top: 129, right: 147, bottom: 188, to: "stair1c1", kind: "live" },
  { page: 3, deck: "B", flat: "Map 3", region: "Button36", left: 34, top: 184, right: 122, bottom: 206, to: "cafe", kind: "debug" },
  { page: 3, deck: "B", flat: "Map 3", region: "Button37", left: 25, top: 146, right: 46, bottom: 169, to: "stair2c", kind: "live" },
  { page: 3, deck: "B", flat: "Map 3", region: "Button38", left: 342, top: 132, right: 387, bottom: 187, to: "gstair3", kind: "live" },
  { page: 3, deck: "B", flat: "Map 3", region: "Button39", left: 493, top: 114, right: 507, bottom: 205, to: "fore", kind: "debug" },
  { page: 4, deck: "C", flat: "Map 4", region: "Button22", left: 27, top: 147, right: 52, bottom: 169, to: "stair2c", kind: "live" },
  { page: 4, deck: "C", flat: "Map 4", region: "Button40", left: 112, top: 132, right: 147, bottom: 188, to: "stair1c2", kind: "live" },
  { page: 4, deck: "C", flat: "Map 4", region: "Button41", left: 345, top: 132, right: 396, bottom: 189, to: "gstair3", kind: "live" },
  { page: 5, deck: "D", flat: "Map 5", region: "Button22", left: 25, top: 145, right: 50, bottom: 170, to: "stair2c", kind: "live" },
  { page: 5, deck: "D", flat: "Map 5", region: "Button42", left: 312, top: 111, right: 399, bottom: 207, to: "recept1c", kind: "live" },
  { page: 6, deck: "E", flat: "Map 6", region: "Button22", left: 26, top: 148, right: 50, bottom: 171, to: "stair2c", kind: "live" },
  { page: 6, deck: "E", flat: "Map 6", region: "Button43", left: 351, top: 146, right: 394, bottom: 177, to: "turkstrs", kind: "live" },
  { page: 7, deck: "F", flat: "Map 7", region: "Button22", left: 24, top: 148, right: 52, bottom: 169, to: "stair2c", kind: "live" },
  { page: 7, deck: "F", flat: "Map 7", region: "Button44", left: 347, top: 148, right: 373, bottom: 172, to: "turkstrs", kind: "live" },
  { page: 7, deck: "F", flat: "Map 7", region: "Button45", left: 482, top: 136, right: 508, bottom: 153, to: "hallf3c", kind: "debug" },
];
