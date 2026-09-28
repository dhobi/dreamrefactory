/**
 * Every flat of Timelapse's stages, with the container of its script and the
 * regions it offers (each with its script's container) — the index that makes
 * a decompiled stage (`tools/dumpscripts.ts`) readable by frame:
 *
 *   npx tsx tools/flats.mts > ../out/timelapse/flats.txt     (from timelapse/)
 *
 * one line a flat: `i007.stg  i0090.051  script 24  regions right:25 left:26 …`
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { readStgFile, readStgRegions } from "@dreamfactory/engine/df/stg";

const RIP = resolve(import.meta.dirname, "../gamefiles");
const stages: string[] = [];
const walk = (dir: string): void => {
  for (const e of readdirSync(dir).sort()) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.stg$/i.test(e)) stages.push(p);
  }
};
walk(RIP);
for (const path of stages) {
  const stg = readStgFile(new Uint8Array(readFileSync(path)));
  const name = path.split("/").pop()!.toLowerCase();
  for (const f of stg.flats) {
    const data = stg.file.containers[f.locationClickLogic]?.data;
    const regs = data ? readStgRegions(data, stg.version) : [];
    console.log(`${name}  ${f.name}  script ${f.locationScript}  regions ${regs.map((r) => `${r.name}:${r.script}`).join(" ")}`);
  }
}
