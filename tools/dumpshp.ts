/**
 * Dump a SHP file's prop structure and a few decoded frames as PNGs.
 *
 *   npx tsx tools/dumpshp.ts gamefiles/LOCAL/TURK.SHP out/
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { readShpFile, decodeShpFrame } from "../src/df/shp";
import { paletteToRGBA } from "../src/df/image";
import { encodePNG } from "./png";

const [, , shpPath, outDir = "out"] = process.argv;
const shp = readShpFile(new Uint8Array(readFileSync(shpPath)));
mkdirSync(outDir, { recursive: true });

console.log(`refName: ${shp.refName}, mainScript @${shp.mainScriptLocation}`);
console.log(`groups: ${shp.groups.length}`);
const pal = paletteToRGBA(shp.paletteRaw, 256);

let dumped = 0;
for (const g of shp.groups) {
  console.log(`  prop "${g.name}" script@${g.scriptContainerLocation}:`);
  for (const s of g.states) {
    console.log(`    state "${s.identifier}": ${s.frames.length} frame(s)`);
    if (dumped < 12 && s.frames.length) {
      const f = decodeShpFrame(shp.file.containers[s.frames[0]]);
      const rgba = new Uint8ClampedArray(f.width * f.height * 4);
      for (let i = 0; i < f.width * f.height; i++) {
        if (!f.opaque[i]) continue;
        const p = f.indexed[i] * 4;
        rgba[i * 4] = pal[p];
        rgba[i * 4 + 1] = pal[p + 1];
        rgba[i * 4 + 2] = pal[p + 2];
        rgba[i * 4 + 3] = 255;
      }
      writeFileSync(
        join(outDir, `${g.name}_${s.identifier}.png`.replace(/[^\w.-]/g, "_")),
        encodePNG(rgba, f.width, f.height),
      );
      console.log(`      -> ${f.width}x${f.height} posRaw(y=${f.posYraw}, x=${f.posXraw})`);
      dumped++;
    }
  }
}
console.log(`dumped ${dumped} first-frames to ${outDir}/`);
