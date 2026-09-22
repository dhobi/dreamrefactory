/**
 * Extract every clickable jump area on the deck map, and emit it as TypeScript.
 *
 *   npx tsx taoot/tools/mapareas.ts
 *
 * This is the deck map's 32 red areas with their RECTANGLES, for the overlay
 * developer mode draws over the plans (taoot/src/devmode/map-overlay.ts). It is a
 * near neighbour of `taoot/tools/mapjumps.ts` and deliberately not the same
 * table: that one emits the 17 a PLAYER can use, because a route may only walk
 * what a player can walk, and it drops the rest on purpose. This one wants all
 * 32 — the point of the overlay is to show where the other 15 are.
 *
 * ## The three kinds
 *
 * Every area's script is the same three or four lines, and the differences are
 * the whole story:
 *
 *   live   jumpbaby (...)                       — any player, cursor("touch")
 *   debug  if not debugging → exitcode          — developer mode only
 *   dead   ... exitcode ... jumpbaby (...)      — a bare exitcode above the jump
 *
 * There is exactly one `dead` — the 1st Class Lounge on A deck — and it is not
 * the flag that stops it. The `exitcode` takes no condition, so the `jumpbaby`
 * after it has never run, in any build.
 *
 * `dead` describes the BUTTON and not the room, which is worth saying because
 * the short version reads as "the lounge was cut". It was not: `lounge1c.set`
 * has seven scenes, `LOUNGE1C.SET` c1 stands Zeitel and Trask up in it, and
 * LNGHALL's own door walks you in (`gotospecial ("lounge1c", "scene10",
 * "view16")`, or Scene14/View37 from the other staircase). You can go there. You
 * cannot get there from the map. That is asserted rather than trusted: see
 * `taoot/tests/auto/devmode.ts`.
 *
 * ## Why the rectangles are safe to draw from
 *
 * The overlay is a picture, not a hit test — it never decides what a click does,
 * so nothing here can send a press to the wrong place. The engine's own
 * `hittest` still resolves every click, exactly as it does on the play page.
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gamefiles, gamefilesRoot } from "./gamefiles";
import { readStgFile, readStgRegions } from "@dreamfactory/engine/df/stg";
import { sniffScript, scriptToText } from "@dreamfactory/engine/df/script";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "..", "src", "devmode", "areas.gen.ts");

/** plan 1 is the boat deck, then A..G — the same order the page tabs are in */
const DECKS = ["Boat", "A", "B", "C", "D", "E", "F", "G"];

const index = gamefiles(gamefilesRoot());
const bytes = index.provider("map.stg");
if (!bytes) throw new Error("no map.stg in the gamefiles tree");
const stg = readStgFile(bytes);

interface Area {
  page: number;
  deck: string;
  flat: string;
  region: string;
  left: number;
  top: number;
  right: number;
  bottom: number;
  to: string;
  kind: "live" | "debug" | "dead";
}

const areas: Area[] = [];
for (let p = 0; p < stg.flats.length; p++) {
  const flat = stg.flats[p];
  for (const r of readStgRegions(stg.file.containers[flat.locationClickLogic].data)) {
    const toks = sniffScript(stg.file.containers[r.script].data);
    if (!toks) continue;
    const text = scriptToText(toks).replace(/\s+/g, " ");
    const jump = /jumpbaby \("([^"]+)"/.exec(text);
    if (!jump) continue;
    // a bare `exitcode` between the guard and the jump — the line that kills the
    // lounge, and the reason this is read rather than assumed
    const dead = /endif exitcode jumpbaby/.test(text);
    const guarded = /if not debugging/.test(text);
    areas.push({
      page: p + 1,
      deck: DECKS[p] ?? String(p + 1),
      flat: flat.name,
      region: r.name,
      left: r.left,
      top: r.top,
      right: r.right,
      bottom: r.bottom,
      to: jump[1],
      kind: dead ? "dead" : guarded ? "debug" : "live",
    });
  }
}
areas.sort((a, b) => a.page - b.page || a.region.localeCompare(b.region));

const count = (k: Area["kind"]): number => areas.filter((a) => a.kind === k).length;
const rows = areas
  .map(
    (a) =>
      `  { page: ${a.page}, deck: ${JSON.stringify(a.deck)}, flat: ${JSON.stringify(a.flat)}, ` +
      `region: ${JSON.stringify(a.region)}, left: ${a.left}, top: ${a.top}, right: ${a.right}, ` +
      `bottom: ${a.bottom}, to: ${JSON.stringify(a.to)}, kind: ${JSON.stringify(a.kind)} },`,
  )
  .join("\n");

writeFileSync(
  OUT,
  `/**
 * The deck map's jump areas and their rectangles — GENERATED, do not edit.
 *
 * Regenerate with \`npx tsx taoot/tools/mapareas.ts\`, which reads them out of
 * MAP.STG and explains the three kinds. What they are FOR is in
 * \`taoot/src/devmode/map-overlay.ts\`.
 *
 * The rectangles are in the game's own 512x384 screen space, Y-first in the file
 * and named here, and they are for DRAWING only — the engine's \`hittest\` still
 * decides what a click does.
 */

/** one red area on one deck plan */
export interface MapArea {
  /** which deck plan it is on, 1 = boat deck */
  page: number;
  /** that plan's deck, as the tabs name it */
  deck: string;
  /** the flat's own name, which is what \`session.currentFlat\` reports */
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
   * \`live\` — any player. \`debug\` — behind \`if not debugging\`. \`dead\` — a bare
   * \`exitcode\` above the jump, so it does nothing in any build.
   */
  kind: "live" | "debug" | "dead";
}

export const MAP_AREAS: readonly MapArea[] = [
${rows}
];
`,
);
console.log(
  `${OUT}: ${areas.length} areas — ${count("live")} live, ${count("debug")} debug, ${count("dead")} dead`,
);
