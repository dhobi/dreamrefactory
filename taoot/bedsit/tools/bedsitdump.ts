/**
 * Take a piece of the built room back out to Blender, split into its parts.
 *
 *   npx tsx taoot/tools/bedsitdump.ts <out-dir>
 *
 * The counterpane came IN this way — modelled elsewhere, baked, imported — but
 * everything else on the bed is drawn by `bed()` out of lathes, tubes and boxes,
 * and there is no file of it anywhere to open. So it is read back out of the
 * builder instead: `furnish()` is run, the triangles standing in the bed's
 * corner of the room are kept, and they are grouped BY THEIR PAINT — which does
 * the splitting for nothing, because a bedstead is brass, a mattress is
 * mattress-coloured and a pillow is pillow-coloured, and no two of them share.
 *
 * Two things come out: a `.json` of the lot in the room's own coordinates, for
 * pushing straight into a Blender session, and a `.glb` per part in the piece's
 * own frame — the frame `bedsitglb.ts --exact 1549.4` expects — so that whatever
 * comes back can be baked without anything having to be lined up again.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { BED, FURNITURE_PAINT as P, furnish } from "../src/bedsit-furniture";

const U = 1549.4;
const OUT = process.argv[2];
if (!OUT) { console.error("usage: npx tsx taoot/tools/bedsitdump.ts <out-dir>"); process.exit(2); }
mkdirSync(OUT, { recursive: true });

/** the bed's corner, with room for the counterpane hanging off the near side */
const BOX = { x0: 3300, x1: 7000, y0: 10300, y1: 12600, z0: -50, z1: 2000 };
/** where the piece's own frame has its origin */
const CX = (BED.x0 + BED.x1) / 2, CY = (BED.y0 + BED.y1) / 2;

const PARTS: [string, readonly number[]][] = [
  ["bedstead", P.bedBrass], ["siderails", P.iron], ["mattress", P.mattress],
  ["counterpane", P.blanket], ["pillow", P.pillow], ["folded", P.green],
];
const key = (c: readonly number[]): string => c.map((v) => v.toFixed(3)).join(",");
const named = new Map(PARTS.map(([n, c]) => [key(c), n]));

const groups: Record<string, { v: number[]; i: number[] }> = {};
let stray = 0;
for (const part of furnish()) {
  const { position: p, colour, count } = part.mesh;
  for (let t = 0; t < count; t += 3) {
    // the builder holds GL space, which is the room's (x, z, y)
    const tri = [0, 1, 2].map((k) => [p[(t + k) * 3], p[(t + k) * 3 + 2], p[(t + k) * 3 + 1]]);
    const mid = [0, 1, 2].map((n) => (tri[0][n] + tri[1][n] + tri[2][n]) / 3);
    if (mid[0] < BOX.x0 || mid[0] > BOX.x1 || mid[1] < BOX.y0 || mid[1] > BOX.y1
      || mid[2] < BOX.z0 || mid[2] > BOX.z1) continue;
    const name = named.get(key([colour[t * 3], colour[t * 3 + 1], colour[t * 3 + 2]]));
    if (!name) { stray++; continue; }
    const g = groups[name] ??= { v: [], i: [] };
    const base = g.v.length / 3;
    for (const v of tri) g.v.push(v[0], v[1], v[2]);
    g.i.push(base, base + 1, base + 2);
  }
}

/** a one-mesh GLB in the piece's frame, which is what `--exact` reads */
function glb(g: { v: number[]; i: number[] }): Buffer {
  const gv = new Float32Array(g.v.length);
  for (let k = 0; k < g.v.length; k += 3) {
    const lx = g.v[k] - CX, ly = g.v[k + 1] - CY, lz = g.v[k + 2];
    gv[k] = lx / U; gv[k + 1] = lz / U; gv[k + 2] = -ly / U;   // glTF is Y-up
  }
  const iv = Uint32Array.from(g.i);
  const bin = Buffer.concat([Buffer.from(gv.buffer), Buffer.from(iv.buffer)]);
  // by loop, not by spread: the counterpane alone is tens of thousands of
  // vertices and `Math.min(...that)` is either a RangeError or a very long wait
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let k = 0; k < gv.length; k += 3) for (let c = 0; c < 3; c++) {
    if (gv[k + c] < lo[c]) lo[c] = gv[k + c];
    if (gv[k + c] > hi[c]) hi[c] = gv[k + c];
  }
  const json = {
    asset: { version: "2.0" }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
    accessors: [
      { bufferView: 0, componentType: 5126, count: gv.length / 3, type: "VEC3",
        min: lo, max: hi },
      { bufferView: 1, componentType: 5125, count: iv.length, type: "SCALAR" }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: gv.byteLength },
                  { buffer: 0, byteOffset: gv.byteLength, byteLength: iv.byteLength }],
    buffers: [{ byteLength: bin.length }],
  };
  const pad = (n: number) => (4 - (n % 4)) % 4;
  const js = Buffer.from(JSON.stringify(json));
  const jsP = Buffer.concat([js, Buffer.alloc(pad(js.length), 0x20)]);
  const bnP = Buffer.concat([bin, Buffer.alloc(pad(bin.length))]);
  const head = Buffer.alloc(12);
  head.write("glTF", 0, "ascii"); head.writeUInt32LE(2, 4);
  head.writeUInt32LE(12 + 8 + jsP.length + 8 + bnP.length, 8);
  const ch = (len: number, ty: number) => { const b = Buffer.alloc(8); b.writeUInt32LE(len, 0); b.writeUInt32LE(ty, 4); return b; };
  return Buffer.concat([head, ch(jsP.length, 0x4e4f534a), jsP, ch(bnP.length, 0x004e4942), bnP]);
}

for (const [name] of PARTS) {
  const g = groups[name];
  if (!g) { console.log(`${name.padEnd(12)} nothing`); continue; }
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let k = 0; k < g.v.length; k += 3) for (let c = 0; c < 3; c++) {
    if (g.v[k + c] < lo[c]) lo[c] = g.v[k + c];
    if (g.v[k + c] > hi[c]) hi[c] = g.v[k + c];
  }
  writeFileSync(join(OUT, `bed-${name}.glb`), glb(g));
  console.log(`${name.padEnd(12)} ${String(g.i.length / 3).padStart(5)} tri  `
    + `x ${lo[0].toFixed(0)}..${hi[0].toFixed(0)}  y ${lo[1].toFixed(0)}..${hi[1].toFixed(0)}  z ${lo[2].toFixed(0)}..${hi[2].toFixed(0)}`);
}
writeFileSync(join(OUT, "bed.json"), JSON.stringify(groups));
console.log(`origin ${CX}, ${CY} — ${stray} triangles in the box belong to something else`);
