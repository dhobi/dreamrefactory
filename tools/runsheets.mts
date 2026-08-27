// one labeled contact strip per cel-ID run in PLAYER.SBK (runs of >=3 cels)
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { readSbkFile } from "@dreamfactory/engine/df/sbk";
import { decodeShpFrame } from "@dreamfactory/engine/df/shp";
import { paletteToRGBA } from "@dreamfactory/engine/df/image";
import { encodePNG } from "./png";
const sbk = readSbkFile(new Uint8Array(readFileSync("skullcracker/gamefiles/SKULL/DATA/PLAYER.SBK")));
const pal = paletteToRGBA(sbk.paletteRaw!, 256);
const out = process.argv[2];
mkdirSync(out, { recursive: true });
const ids = [...sbk.byId.keys()].sort((a, b) => a - b);
const runs: number[][] = [];
for (const id of ids) {
  const last = runs[runs.length - 1];
  if (last && id === last[last.length - 1] + 1) last.push(id);
  else runs.push([id]);
}
let made = 0;
for (const run of runs) {
  if (run.length < 3) continue;
  const CW = 120, CH = 150;
  const shown = run.slice(0, 12);
  const img = new Uint8ClampedArray(shown.length * CW * CH * 4);
  shown.forEach((id, n) => {
    const f = decodeShpFrame(sbk.file.containers[sbk.byId.get(id)!].data);
    const k = Math.min(CW / f.width, CH / f.height, 1);
    for (let y = 0; y < f.height; y++) for (let x = 0; x < f.width; x++) {
      const s = y * f.width + x;
      if (!f.opaque[s]) continue;
      const tx = n * CW + Math.floor(x * k), ty = Math.floor(y * k);
      const t = (ty * shown.length * CW + tx) * 4, p = f.indexed[s] * 4;
      img[t] = pal[p]; img[t+1] = pal[p+1]; img[t+2] = pal[p+2]; img[t+3] = 255;
    }
  });
  writeFileSync(`${out}/run_${String(run[0]).padStart(5, "0")}_${run[run.length-1]}_n${run.length}.png`, encodePNG(img, shown.length * CW, CH));
  made++;
}
console.log(`${made} run sheets in ${out}`);
