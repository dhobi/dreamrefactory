/**
 * Every prop group of Timelapse's shops, with the container of its script —
 * the index that makes a decompiled shop (`tools/dumpscripts.ts`) readable by
 * name:
 *
 *   npx tsx tools/props.mts > ../out/timelapse/props.txt     (from timelapse/)
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { readShpFile } from "@dreamfactory/engine/df/shp";

const RIP = resolve(import.meta.dirname, "../gamefiles");
const shops: string[] = [];
const walk = (dir: string): void => {
  for (const e of readdirSync(dir).sort()) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.shp$/i.test(e)) shops.push(p);
  }
};
walk(RIP);
for (const path of shops) {
  const shp = readShpFile(new Uint8Array(readFileSync(path)));
  const name = path.split("/").pop()!.toLowerCase();
  for (const g of shp.groups) console.log(`${name}  ${g.name}  ${JSON.stringify(Object.fromEntries(Object.entries(g).filter(([k, v]) => typeof v === "number")))}`);
}
