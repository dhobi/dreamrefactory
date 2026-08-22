/**
 * Find prop states that are SEVERAL animations sharing one state — a variant
 * per stored degree — as opposed to one animation whose frames each depict a
 * different angle.
 *
 * house.shp's map is the case that prompted this: its `close` state holds
 * degrees [0,0,0,0,0,1,1,1,1,1,1,0], six frames for normal play and six for the
 * guided tour, and the engine animated straight through both. A directional
 * prop's animated state looks nothing like that — one frame per degree — so the
 * two are told apart by the shape of the degree list, not by name.
 *
 *   npx tsx tools/scandeg.mts [gamefiles/en]
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { readShpFile } from "@dreamfactory/engine/df/shp";

const root = process.argv[2] ?? "gamefiles/en";

function* walk(dir: string): Generator<string> {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (/\.shp$/i.test(e)) yield p;
  }
}

interface Hit {
  file: string;
  prop: string;
  state: string;
  frames: number;
  groups: string;
  animated: boolean;
}
const split: Hit[] = [];
let files = 0, states = 0, directional = 0, single = 0;

for (const path of walk(root)) {
  let shp;
  try {
    shp = readShpFile(new Uint8Array(readFileSync(path)));
  } catch {
    continue;
  }
  files++;
  for (const g of shp.groups) {
    for (const s of g.states) {
      states++;
      const degs = s.degrees;
      if (!degs || degs.length !== s.frames.length || s.frames.length < 3) continue;
      const counts = new Map<number, number>();
      for (const d of degs) counts.set(d, (counts.get(d) ?? 0) + 1);
      if (counts.size < 2) { single++; continue; }
      const sizes = [...counts.values()];
      if (sizes.every((n) => n === 1)) { directional++; continue; }
      // several frames share a degree: the state holds one animation per degree
      if (!sizes.every((n) => n === sizes[0])) {
        console.log(`  RAGGED ${path} "${g.name}".${s.identifier} ${s.frames.length}f [${degs.join(",")}]`);
        continue;
      }
      split.push({
        file: path.replace(root + "/", ""),
        prop: g.name,
        state: s.identifier,
        frames: s.frames.length,
        groups: [...counts.entries()].map(([d, n]) => `deg${d}x${n}`).join(" "),
        animated: !!s.animated,
      });
    }
  }
}

console.log(`scanned ${files} SHP files, ${states} states`);
console.log(`  ${directional} directional (one frame per degree) — left alone`);
console.log(`  ${single} single-degree animations — left alone`);
console.log(`\n${split.length} state(s) holding one animation PER DEGREE:`);
for (const h of split) {
  console.log(`  ${h.file}  "${h.prop}".${h.state}  ${h.frames} frames  ${h.groups}${h.animated ? "" : "  (not flagged animated)"}`);
}
