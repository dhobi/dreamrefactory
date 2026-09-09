/**
 * The four materials that were still being cut out of the rip at page load,
 * cut once here instead.
 *
 *   npx tsx taoot/bedsit/tools/bedsitmats.ts [out dir] [path/to/bedsit1.set]
 *
 * Everything else in this room had already stopped needing BEDSIT1.SET — nine
 * of thirteen materials and every picture on the walls arrive as drawn or
 * supplied files — and these four were the whole of what a four-megabyte
 * download was still buying: `stain`, `wood`, `cloth` and `curtain`, each a
 * patch of one frame, box-averaged down to 64 squared.
 *
 * It calls the PAGE'S OWN {@link frameSwatch}, with the page's own `MATERIALS`
 * entry, so what lands in `public/bedsit` is the same 16 kB of pixels the page
 * was computing for itself every visit. Nothing about the room's appearance is
 * meant to change; if it does, this tool and not the room is what is wrong.
 *
 * ONE OF THE FOUR IS NOT AN ALBEDO. A swatch with a `tone` is de-lit on the way
 * out and can be lit again like any drawn file; `wood` has no tone, so it is the
 * frame's own pixels with the room's own lamp still on them, and the page has
 * always given it a different exposure for that reason (`fromFrames`). The
 * MATERIALS entry carries that flag over, so the file is lit the way the swatch
 * was. See `materialFiles` in bedsit-page.ts.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readSetFile } from "@dreamfactory/engine/df/set";
import { encodePNG } from "../../../tools/png";
import { frameSwatch } from "../src/bedsit-skin";
import { MATERIALS } from "../src/bedsit-furniture";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = process.argv[2] ?? join(HERE, "../../public/bedsit");
const SET = process.argv[3] ?? join(HERE, "../../gamefiles/en/titanic1/data/bedsit1.set");

const set = readSetFile(new Uint8Array(readFileSync(SET)));
let wrote = 0;
for (const [name, spec] of Object.entries(MATERIALS)) {
  // the ones that already have a file are already off the rip
  if (spec.file || spec.scene === undefined) continue;
  const sw = frameSwatch(set, spec as Parameters<typeof frameSwatch>[1]);
  // a swatch that found no frame is filled flat grey and is worth refusing
  // rather than writing: a grey tile is exactly what a missing one looks like
  const flat = sw.rgba.every((v, i) => i % 4 === 3 || v === 128);
  if (flat) {
    console.error(`  ${name}: no frame matched ${spec.scene} deg ${spec.deg} — NOT written`);
    continue;
  }
  const file = join(OUT, `mat-${name}.png`);
  writeFileSync(file, encodePNG(sw.rgba, sw.size, sw.size, { compress: true }));
  console.log(`  ${name}: ${sw.size}x${sw.size}${spec.tone ? " toned" : " FROM FRAMES (needs fromFrames: true)"}  ->  ${file}`);
  wrote++;
}
console.log(`${wrote} swatch${wrote === 1 ? "" : "es"} written`);
