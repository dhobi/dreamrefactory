/**
 * Extract the deck map's jump table from MAP.STG and emit it as TypeScript.
 *
 *   npx tsx tools/mapjumps.ts
 *
 * Smethells hands you a deck map in cabin C73, and from then on the game has
 * fast travel: eight deck plans, each with a handful of red areas that put you
 * somewhere on that deck in one click. A route that walks instead spends dozens
 * of gestures on trips the game itself lets you skip.
 *
 * Nothing here is invented. Every flat's click-logic container lists its regions
 * with their rectangles and the script container each one runs (src/df/stg.ts),
 * and those scripts are three lines long:
 *
 *   code mousedown (arg)              # map.stg container 64, deck C
 *     ...
 *     jumpbaby ("stair1c2", "scene112", "view116")
 *   endcode
 *
 * with each page's own `jumpbaby` forwarding to `jumppapa(set, scene, view,
 * deck)` — the deck letter being the page's, which is how `savedeck` ends up
 * right for the staircase you arrive at. So this reads the rectangles and the
 * arguments out of the game file and writes them down. Regenerate after touching
 * the STG decoder; the emitted file says so too.
 *
 * The page buttons come out of the same table (they run `gotopage(n)`), which is
 * how a route turns to the deck it wants: the map's own keydown would also do it
 * (t, a..g), but clicking the button a player can see is the gesture a player
 * makes.
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gamefiles, gamefilesRoot } from "./gamefiles";
import { readStgFile, readStgRegions } from "../src/df/stg";
import { sniffScript, scriptToText } from "../src/df/script";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "..", "tests", "playthrough", "nav", "mapjumps.gen.ts");

const index = gamefiles(gamefilesRoot());
const bytes = index.provider("map.stg");
if (!bytes) throw new Error("no map.stg in the gamefiles tree");
const stg = readStgFile(bytes);

/** a region's script as flat text, so the calls in it can be read off */
const scriptOf = (container: number): string => {
  const c = stg.file.containers[container];
  if (!c) return "";
  const toks = sniffScript(c.data);
  return toks ? scriptToText(toks).replace(/\s+/g, " ") : "";
};

interface Jump {
  to: string;
  page: number;
  deck: string;
  region: string;
  scene: string;
  view: string;
}

const jumps: Jump[] = [];
const pageButtons = new Map<number, string>();
const deckOf = new Map<number, string>();
const exits = new Set<string>();
const debugOnly: string[] = [];

for (const [i, flat] of stg.flats.entries()) {
  const page = i + 1; // gotoflat(n) is 1-based, and so is gotopage
  // each page defines its own jumpbaby, whose only job is to add the deck letter
  const deck = /jumppapa \(theset, thescene, theview, "([^"]*)"\)/.exec(scriptOf(flat.locationScript))?.[1];
  if (!deck) throw new Error(`map page ${page} ("${flat.name}") has no jumpbaby wrapper`);
  deckOf.set(page, deck);
  for (const r of readStgRegions(stg.file.containers[flat.locationClickLogic].data)) {
    const text = scriptOf(r.script);
    const jump = /jumpbaby \("([^"]*)", "([^"]*)", "([^"]*)"\)/.exec(text);
    if (jump) {
      // Half of the red areas are the developers' own shortcuts, not the
      // player's: `if not debugging → exitcode` sits between the mousedown and
      // the jumpbaby, so in a shipped game pressing them does NOTHING. Reading
      // the jumpbaby without reading its guard is how the harness ended up
      // pressing the gymnasium six times and concluding the click was being
      // dropped — the game was refusing, exactly as it refuses a player.
      //
      // What is left is the shape the map actually has: stairwells. A deck plan
      // takes you to the staircase on that deck, and you walk from there.
      if (/if not debugging/.test(text)) {
        debugOnly.push(`${jump[1]} (plan ${page})`);
        continue;
      }
      jumps.push({ to: jump[1].toLowerCase(), page, deck, region: r.name, scene: jump[2], view: jump[3] });
      continue;
    }
    const goto = /gotopage \((\d+)\)/.exec(text);
    // the eight page buttons are the same region, by name, on every plan
    if (goto && !pageButtons.has(Number(goto[1]))) pageButtons.set(Number(goto[1]), r.name);
    // the one region that closes the map without travelling anywhere
    if (/exitmap \(\)/.test(text)) exits.add(r.name);
  }
}

jumps.sort((a, b) => a.to.localeCompare(b.to) || a.page - b.page);
const pages = [...pageButtons.entries()].sort((a, b) => a[0] - b[0]);
if (pages.length !== stg.flats.length) {
  throw new Error(`found ${pages.length} page buttons for ${stg.flats.length} pages`);
}
if (exits.size !== 1) throw new Error(`expected one exitmap region, found ${[...exits].join(", ") || "none"}`);

// every page, not only the ones with red areas — deck G's plan has none at all
const decks = [...deckOf.entries()].sort((a, b) => a[0] - b[0]).map(([p, d]) => `${p}=${d}`).join(" ");
const emitted = `/* GENERATED by tools/mapjumps.ts — do not edit.
 * ${jumps.length} usable red areas over ${stg.flats.length} deck plans, reaching ${new Set(jumps.map((j) => j.to)).size} sets.
 * ${debugOnly.length} more are gated on \`debugging\` and do nothing in a shipped game — left out.
 * Regenerate: npx tsx tools/mapjumps.ts
 */
import type { MapJump, MapPageButton } from "./mapjumps";

/** the deck each page is, as its own jumpbaby passes it to jumppapa: ${decks} */
export const MAP_JUMPS: MapJump[] = [
${jumps
  .map(
    (j) =>
      `  { to: ${JSON.stringify(j.to)}, page: ${j.page}, deck: ${JSON.stringify(j.deck)}, ` +
      `region: ${JSON.stringify(j.region)}, arrive: [${JSON.stringify(j.scene)}, ${JSON.stringify(j.view)}] },`,
  )
  .join("\n")}
];

/** the page buttons, in page order — the same region name on every plan */
export const MAP_PAGE_BUTTONS: MapPageButton[] = [
${pages.map(([page, region]) => `  { page: ${page}, region: ${JSON.stringify(region)} },`).join("\n")}
];

/** the region that runs exitmap() — closes the map having gone nowhere */
export const MAP_EXIT_REGION = ${JSON.stringify([...exits][0])};
`;

writeFileSync(OUT, emitted);
console.log(`map pages:   ${stg.flats.length} (${decks})`);
console.log(`red areas:   ${jumps.length} usable, reaching ${new Set(jumps.map((j) => j.to)).size} sets`);
console.log(`debug-only:  ${debugOnly.length} (dead in a shipped game): ${debugOnly.join(", ")}`);
for (const [page, region] of pages) {
  const on = jumps.filter((j) => j.page === page);
  console.log(`  page ${page} (button "${region}"): ${on.map((j) => j.to).join(", ") || "(nothing)"}`);
}
console.log(`\nwrote ${OUT}`);
