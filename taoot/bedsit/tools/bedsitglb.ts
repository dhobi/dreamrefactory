/**
 * Baking an imported mesh into the room.
 *
 *   npx tsx taoot/tools/bedsitglb.ts <in.glb> <name> <length> <depth> <height>
 *                                     [--detach <ranks> <name>]... [--drop <ranks>] [--flip]
 *                                     [--band <name> <z0> <z1>]... [--part <material> <name>]...
 *                                     [--turn <degrees>] [--up z]
 *                                     [--exact <units per metre>] [--simplify <triangles>]
 *   npx tsx taoot/tools/bedsitglb.ts <in.glb> x 1 1 1 --list
 *
 * The room's parts are built synchronously when the page's module loads, so an
 * imported mesh cannot be fetched: it has to be in the source. This reads a GLB
 * — positions and indices, `KHR_mesh_quantization` included, which is what
 * every generator's gltfpack output uses — turns it into the room's own frame,
 * and writes `taoot/src/bedsit-<name>-mesh.ts` with the vertices packed as
 * base64 for the page to unpack at load.
 *
 * The frame it turns them into is a piece of furniture's local one, the same
 * `settee` and `bed` are built in: `x` is depth with the BACK towards +x, `y`
 * is length about 0, `z` is height from the floor at 0. The three sizes are the
 * measured ones off the frames, and the mesh is stretched to fill them — a
 * generated model has a generated model's proportions, and ours are measured,
 * so ours win.
 *
 * The WHOLE SCENE is read, not the first mesh — every primitive under every
 * node, each vertex through that node's own transform, which is what brings an
 * assembled model in rather than whichever piece of it the exporter wrote
 * first. `--part` then splits by the file's own materials, and `--up z` says
 * that the model's vertical is not the one glTF promises.
 *
 * `--list` prints the islands and their sizes and stops, which is how you find
 * out what a generator actually put in the file. `--flip` turns a piece to face
 * the other way: which side is the back is guessed from where the tall geometry
 * leans, and a wireless — flat back, sloped front — is exactly the shape that
 * guess gets wrong. `--drop` throws one away — the
 * side table came back with a radio on it, and the room has a better radio of
 * its own; it takes a comma-separated list, because a generator seldom puts a
 * thing in one island. `--detach` splits connected islands off into a module of their own, named by
 * their rank in vertex count — 0 is the biggest. A generator hands back one file
 * whether or not it made one object: the armchair's mesh is the chair, the book
 * lying on its arm, and four feet, all in the same buffer. They are separate
 * islands, so which triangles are the book is not a guess, and detaching it is
 * what lets the book wear its own cover instead of the chair's moquette.
 *
 * Normals are not written. They are three floats a vertex for something the
 * page can work out in a millisecond from the triangles it already has, and
 * working them out there gets smooth ones, which a generated surface wants and
 * `quad`'s per-face normals cannot give it.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const listOnly = argv.includes("--list");
/**
 * `--exact <units per metre>`: take the file's own coordinates rather than
 * fitting them to a box.
 *
 * Everything else here arrives with a generator's arbitrary proportions and is
 * stretched into measurements taken off the frames. A simulation is the other
 * case entirely — it was set up in the room's own geometry, at metre scale, and
 * where its vertices ended up IS the answer. Fitting that to a bounding box
 * would throw away the one thing it knows.
 *
 * Blender writes Y-up, so glTF (x, y, z) is the room's (x, -z, y) times the
 * scale. That mapping keeps its handedness, and a draped sheet is an open
 * surface anyway, so the closed-volume winding test below is skipped.
 */
const exactAt = argv.indexOf("--exact");
const exact = exactAt < 0 ? 0 : +argv[exactAt + 1];
/** the guess below is a guess: `--flip` turns the piece to face the other way */
const flip = argv.includes("--flip");
/**
 * `--band <name> <z0> <z1>`, repeatable: the islands whose middle height falls
 * in that range go to a module of their own. One generated file is often one
 * piece of joinery and everything standing on it — the counter, the cupboard
 * over it and the crockery between them came back as a single buffer — and
 * height is what tells them apart, because the room already knows the height of
 * every one of them off the frames.
 */
const bands: { name: string; z0: number; z1: number }[] = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === "--band") bands.push({ name: argv[i + 1], z0: +argv[i + 2], z1: +argv[i + 3] });
}
/**
 * `--simplify <triangles>`: bring each module down to a triangle budget.
 *
 * A generated mesh is tessellated for a renderer that will never see this room:
 * the pillow arrived as 5,120 triangles for something 620 by 1,360 by 200 that
 * is never seen from closer than the other side of a bed, and that was more than
 * the bedstead, the counterpane, the mattress, the folded blanket and the rails
 * put together.
 */
const simplifyAt = argv.indexOf("--simplify");
const simplifyTo = simplifyAt < 0 ? 0 : +argv[simplifyAt + 1];
const dropAt = argv.indexOf("--drop");
const drop = dropAt < 0 ? [] : argv[dropAt + 1].split(",").map(Number);
const detaches: { ranks: number[]; name: string }[] = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === "--detach") detaches.push({ ranks: argv[i + 1].split(",").map(Number), name: argv[i + 2] });
}
/**
 * `--part <material> <name>`, repeatable: split by the file's OWN materials.
 *
 * `--detach` splits by connected island and `--band` by height, and neither can
 * say what a pocket watch's crystal is or which triangles in a matchbox are the
 * matches. A material can. A generator that gave a thing two surfaces gave it
 * two materials, and that grouping is authored rather than inferred — the
 * matchbox's eighteen matches are one material across eighteen instances of one
 * mesh, which no island test could gather and no height band could separate.
 *
 * It is also the split the ROOM needs, since a module is drawn in exactly one
 * material: a part that needs its own picture needs its own module either way.
 */
const useParts: { mat: number; name: string }[] = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === "--part") useParts.push({ mat: +argv[i + 1], name: argv[i + 2] });
}
/**
 * `--up z`: the model's own vertical is glTF +z, not +y.
 *
 * glTF is Y-up and everything below assumes it. A Sketchfab export need not be:
 * the FBX behind it was Z-up, and the root matrix that is supposed to turn it
 * sometimes turns it the other way, so the model arrives lying in the XY plane
 * with z for thickness. Nothing errors — the fitter stretches whatever it is
 * given into whatever box it is told — and the result is a pocket watch stood
 * on its edge, which is only visible once it is in the room.
 *
 * The giveaway is in the numbers `--list` prints. A watch is a disc: two of its
 * three spans are nearly equal and the third is a fraction of them. If the
 * SMALL one is not the one being called height, the file is not Y-up.
 */
const upAt = argv.indexOf("--up");
const upZ = upAt >= 0 && argv[upAt + 1] === "z";
const firstFlag = argv.findIndex((a) => a.startsWith("--"));
const [file, name, ...sizes] = (firstFlag < 0 ? argv : argv.slice(0, firstFlag));
if (!file || !name || sizes.length !== 3 || detaches.some((d) => d.ranks.some((r) => !Number.isFinite(r)) || !d.name)) {
  console.error("usage: npx tsx taoot/tools/bedsitglb.ts <in.glb> <name> <length> <depth> <height> [--detach <ranks> <name>]...");
  process.exit(2);
}
const [LEN, DEP, HT] = sizes.map(Number);

const b = new Uint8Array(readFileSync(file));
const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
if (String.fromCharCode(...b.slice(0, 4)) !== "glTF") throw new Error("not a GLB");

let off = 12, json: any = null, BIN = 0;
while (off < b.length) {
  const len = dv.getUint32(off, true), ty = dv.getUint32(off + 4, true);
  if (ty === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(b.subarray(off + 8, off + 8 + len)));
  else if (ty === 0x004e4942) BIN = off + 8;
  off += 8 + len;
}
const acc = (i: number) => json.accessors[i];
const view = (a: any) => json.bufferViews[a.bufferView];

/** an accessor's scalars, whatever width the file stores them at */
function read(a: any, comps: number): number[] {
  const v = view(a), base = BIN + (v.byteOffset ?? 0) + (a.byteOffset ?? 0);
  const width = a.componentType === 5125 ? 4 : a.componentType === 5123 ? 2 : a.componentType === 5121 ? 1 : 4;
  const stride = v.byteStride ?? width * comps;
  const out: number[] = [];
  for (let i = 0; i < a.count; i++) for (let c = 0; c < comps; c++) {
    const at = base + i * stride + c * width;
    out.push(a.componentType === 5126 ? dv.getFloat32(at, true)
      : a.componentType === 5125 ? dv.getUint32(at, true)
      : a.componentType === 5123 ? dv.getUint16(at, true) : dv.getUint8(at));
  }
  return out;
}

/**
 * The WORLD transform of every mesh node, walked from the scene's roots.
 *
 * This used to take the mesh node's own scale and offset and nothing else, which
 * is all gltfpack's quantization needs and all any file here had ever carried.
 * It is not all a Sketchfab export carries: those hang the model under a root
 * holding the Z-up-to-Y-up turn as a matrix, and ignoring it hands the fitter a
 * pillow lying on its side. The fit still succeeds — it stretches whatever it is
 * given into whatever box it is told — so nothing errors; the giveaway is in the
 * numbers it prints, 36 units per model unit one way against 226 the other.
 */
const mul = (a: number[], b: number[]): number[] => {
  const o = new Array(16).fill(0);
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
};
function local(n: any): number[] {
  if (n.matrix) return n.matrix;
  const [x, y, z, w] = n.rotation ?? [0, 0, 0, 1], sc = n.scale ?? [1, 1, 1], tr = n.translation ?? [0, 0, 0];
  const m = [1 - 2*(y*y + z*z), 2*(x*y + z*w), 2*(x*z - y*w), 0,
             2*(x*y - z*w), 1 - 2*(x*x + z*z), 2*(y*z + x*w), 0,
             2*(x*z + y*w), 2*(y*z - x*w), 1 - 2*(x*x + y*y), 0, 0, 0, 0, 1];
  for (let c = 0; c < 3; c++) for (let r = 0; r < 3; r++) m[c * 4 + r] *= sc[c];
  m[12] = tr[0]; m[13] = tr[1]; m[14] = tr[2];
  return m;
}
const IDENT = [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1];

/** `--turn <degrees>`: spin the model about its own vertical before it is
 *  fitted, for when its long axis runs across the box it has to fill */
const turnAt = argv.indexOf("--turn");
const turn = turnAt < 0 ? 0 : (+argv[turnAt + 1] * Math.PI) / 180;
const tc = Math.cos(turn), ts = Math.sin(turn);

/**
 * EVERY primitive in the scene, each under its own node's transform.
 *
 * This read `json.meshes[0].primitives[0]` and stopped, which is one mesh of
 * however many the file holds — right for a generator that welds its output
 * into a single buffer, and silently wrong for anything assembled. A matchbox
 * came in as twenty meshes: the box, its tray, and one match INSTANCED eighteen
 * times, every instance carrying its position in its node's matrix and nothing
 * in the mesh to tell them apart. Taking the first gave the box alone, and no
 * error, because a box is a perfectly good mesh.
 *
 * So the whole scene is walked and the primitives concatenated, each vertex
 * through the matrix of the node it hangs under — which is what makes eighteen
 * copies of one mesh land in eighteen places. `matOf` keeps the file's own
 * material for each triangle, since that is the one grouping an assembled model
 * comes with; see `--part`.
 */
const g: number[] = [];
const index: number[] = [];
const matOf: number[] = [];
let uvRaw: number[] | null = null;
let uvMissing = 0;
(function walk(ids: number[], m: number[]): void {
  for (const id of ids) {
    const n = json.nodes[id], here = mul(m, local(n));
    if (n.mesh !== undefined) {
      for (const prim of json.meshes[n.mesh].primitives) {
        const raw = read(acc(prim.attributes.POSITION), 3);
        const tri = read(acc(prim.indices), 1);
        const base = g.length / 3;
        for (let i = 0; i < raw.length; i += 3) {
          const x = raw[i], y = raw[i + 1], z = raw[i + 2];
          let wx = here[0]*x + here[4]*y + here[8]*z + here[12];
          let wy = here[1]*x + here[5]*y + here[9]*z + here[13];
          let wz = here[2]*x + here[6]*y + here[10]*z + here[14];
          // the model's own vertical, before anything below assumes it is y
          if (upZ) { const t = wy; wy = wz; wz = -t; }
          g.push(wx * tc + wz * ts, wy, -wx * ts + wz * tc);
        }
        for (const t of tri) index.push(base + t);
        for (let i = 0; i < tri.length; i += 3) matOf.push(prim.material ?? 0);
        const uvs = prim.attributes.TEXCOORD_0 !== undefined ? read(acc(prim.attributes.TEXCOORD_0), 2) : null;
        if (uvs) {
          // a primitive with none among primitives with some would shift every
          // coordinate after it, so the gap is filled rather than skipped
          if (!uvRaw) uvRaw = new Array(base * 2).fill(0);
          if (uvRaw.length < base * 2) uvRaw.push(...new Array(base * 2 - uvRaw.length).fill(0));
          uvRaw.push(...uvs);
        } else uvMissing += raw.length / 3;
      }
    }
    if (n.children) walk(n.children, here);
  }
})(json.scenes?.[json.scene ?? 0]?.nodes ?? json.nodes.map((_: any, i: number) => i), IDENT);
if (uvRaw) {
  if ((uvRaw as number[]).length < g.length / 3 * 2) (uvRaw as number[]).push(...new Array(g.length / 3 * 2 - (uvRaw as number[]).length).fill(0));
  console.log(`  the file carries texture coordinates: ${((uvRaw as number[]).length / 2).toLocaleString()} of them`
    + (uvMissing ? `  (${uvMissing.toLocaleString()} vertices had none and were given 0,0)` : ""));
}
if (upZ) console.log("  the model's vertical is glTF +z, turned to +y before fitting");
const prims = json.meshes.reduce((n: number, m: any) => n + m.primitives.length, 0);
if (prims > 1) {
  const byMat = new Map<number, number>();
  for (const m of matOf) byMat.set(m, (byMat.get(m) ?? 0) + 1);
  console.log(`  ${prims} primitives gathered from the whole scene, by material: `
    + [...byMat].sort((a, b) => a[0] - b[0])
        .map(([m, t]) => `${m} (${json.materials?.[m]?.name ?? "unnamed"}) ${t.toLocaleString()} tri`).join(", "));
}

const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
for (let i = 0; i < g.length; i += 3) for (let c = 0; c < 3; c++) {
  if (g[i + c] < lo[c]) lo[c] = g[i + c];
  if (g[i + c] > hi[c]) hi[c] = g[i + c];
}
const span = hi.map((h, i) => h - lo[i]);

// glTF is Y-up and generators put the long axis on x: width -> our length (y),
// height -> our height (z), depth -> our depth (x). Which way round the depth
// goes is read from the model itself: the back is the side the tall geometry
// leans to, so the half of the depth whose mean height is greater is the back.
let front = 0, frontN = 0, backHalf = 0, backN = 0;
const midZ = (lo[2] + hi[2]) / 2;
for (let i = 0; i < g.length; i += 3) {
  const up = (g[i + 1] - lo[1]) / span[1];
  if (g[i + 2] < midZ) { front += up; frontN++; } else { backHalf += up; backN++; }
}
const backIsPlusZ = (backHalf / backN > front / frontN) !== flip;
console.log(`  the back is towards glTF ${backIsPlusZ ? "+" : "-"}z${flip ? " (flipped)" : ""}  (mean height ${(backHalf / backN).toFixed(3)} vs ${(front / frontN).toFixed(3)})`);

const kx = DEP / span[2], ky = LEN / span[0], kz = HT / span[1];
console.log(`  ${(index.length / 3).toLocaleString()} triangles, ${(g.length / 3).toLocaleString()} vertices`);
console.log(`  stretched by  length ${ky.toFixed(0)}  depth ${kx.toFixed(0)}  height ${kz.toFixed(0)} units per model unit`);

/** the room's own frame: +x is the back, y is the length about 0, z is up from the floor */
const world = new Float32Array(g.length);
for (let i = 0; i < g.length; i += 3) {
  if (exact) {
    world[i] = g[i] * exact;
    world[i + 1] = -g[i + 2] * exact;
    world[i + 2] = g[i + 1] * exact;
    continue;
  }
  const dep = (g[i + 2] - (lo[2] + hi[2]) / 2) * (backIsPlusZ ? 1 : -1);
  world[i] = dep * kx;
  world[i + 1] = (g[i] - (lo[0] + hi[0]) / 2) * ky;
  world[i + 2] = (g[i + 1] - lo[1]) * kz;
}
if (exact) console.log(`  taken at ${exact} units to the metre, not fitted`);

// Turning the mesh into our frame swaps a pair of axes, which reverses the
// handedness and so the winding: what wound counter-clockwise seen from
// outside now winds clockwise, and every normal `Builder.mesh` averages would
// point into the sofa. The signed volume says whether that has happened —
// it is positive for outward-wound closed geometry — and reversing each
// triangle puts it right, whatever mapping got us here.
let volume = 0;
for (let i = 0; i < index.length; i += 3) {
  const [a, b2, c] = [index[i] * 3, index[i + 1] * 3, index[i + 2] * 3];
  volume += (world[a] * (world[b2 + 1] * world[c + 2] - world[b2 + 2] * world[c + 1])
    - world[a + 1] * (world[b2] * world[c + 2] - world[b2 + 2] * world[c])
    + world[a + 2] * (world[b2] * world[c + 1] - world[b2 + 1] * world[c])) / 6;
}
if (volume < 0 && !exact) {
  for (let i = 0; i < index.length; i += 3) [index[i + 1], index[i + 2]] = [index[i + 2], index[i + 1]];
  console.log(`  winding reversed: the turn into our frame flipped it (volume was ${volume.toFixed(1)})`);
} else console.log(exact ? "  winding kept (open surface, no volume test)" : `  winding kept (volume ${volume.toFixed(1)})`);

/**
 * The connected islands, by shared vertex. A generator's single buffer often
 * holds several objects that never touch, and the union-find says which
 * triangles belong to which without anybody guessing at bounding boxes.
 */
function islands(): number[][] {
  const n = world.length / 3, up = new Int32Array(n).map((_, i) => i);
  const find = (a: number): number => { while (up[a] !== a) a = up[a] = up[up[a]]; return a; };
  for (let i = 0; i < index.length; i += 3) {
    const [a, b2, c] = [index[i], index[i + 1], index[i + 2]].map(find);
    up[b2] = a; up[c] = a;
  }
  const by = new Map<number, number[]>();
  for (let i = 0; i < index.length; i += 3) {
    const r = find(index[i]);
    (by.get(r) ?? by.set(r, []).get(r)!).push(i);
  }
  return [...by.values()].sort((a, b) => b.length - a.length);
}

/**
 * Fewer triangles for the same shape, by quadric-error edge collapse.
 *
 * Every plane a vertex sits on is written as the 4x4 matrix that gives the
 * squared distance from any point to that plane; a vertex's own quadric is the
 * sum of its faces', weighted by area, and the cost of collapsing an edge is
 * what that sum says about the point the two ends would be moved to. Cheap
 * edges are the ones inside a flat patch, and they go first. It is Garland and
 * Heckbert's method, which is the one every mesh tool uses, and the reason to
 * use it here rather than a grid subsample is that a generated surface has no
 * grid to subsample.
 *
 * The mesh is WELDED first, on position, and it has to be: a generator hands
 * back a shell in strips — the pillow came as eighty-nine islands whose seams
 * meet exactly — and an edge whose two sides are different vertices cannot be
 * collapsed at all. Welded, that pillow is a closed surface of 2,562 points and
 * 5,120 faces with no boundary and nothing non-manifold, which is the case this
 * works best on. Nothing is lost by welding, because no normals or texture
 * coordinates are stored to be split by a seam.
 *
 * Two collapses are refused. One that would turn a face inside out — the sign of
 * a normal before and after — because that is how a simplifier puts a spike
 * through a surface. And one across an edge whose ends already share more than
 * the two neighbours the faces either side of it give them, which is the link
 * condition, and is how a closed surface stays closed.
 */
function simplify(posIn: readonly number[], triIn: readonly number[], target: number):
  { pos: number[]; tri: number[] } {
  // -- welded on position, and degenerate faces dropped with the seams --------
  const seen = new Map<string, number>();
  const pos: number[] = [], at: number[] = [];
  for (let i = 0; i < posIn.length; i += 3) {
    const k = `${posIn[i].toFixed(4)},${posIn[i + 1].toFixed(4)},${posIn[i + 2].toFixed(4)}`;
    let n = seen.get(k);
    if (n === undefined) { n = pos.length / 3; seen.set(k, n); pos.push(posIn[i], posIn[i + 1], posIn[i + 2]); }
    at.push(n);
  }
  const tri: number[] = [];
  for (let t = 0; t < triIn.length; t += 3) {
    const a = at[triIn[t]], b = at[triIn[t + 1]], c = at[triIn[t + 2]];
    if (a !== b && b !== c && c !== a) tri.push(a, b, c);
  }

  const nv = pos.length / 3;
  const Q = new Float64Array(nv * 10);
  const dead = new Uint8Array(tri.length / 3);
  const gone = new Uint8Array(nv);
  const stamp = new Int32Array(nv);
  const faces: number[][] = Array.from({ length: nv }, () => []);

  /** the plane of a face as (n, d) with a unit normal, and twice its area */
  const plane = (f: number): [number, number, number, number, number] | null => {
    const a = tri[f * 3] * 3, b = tri[f * 3 + 1] * 3, c = tri[f * 3 + 2] * 3;
    const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
    const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz);
    if (len < 1e-12) return null;
    nx /= len; ny /= len; nz /= len;
    return [nx, ny, nz, -(nx * pos[a] + ny * pos[a + 1] + nz * pos[a + 2]), len];
  };
  for (let f = 0; f < tri.length / 3; f++) {
    for (let k = 0; k < 3; k++) faces[tri[f * 3 + k]].push(f);
    const p = plane(f);
    if (!p) { dead[f] = 1; continue; }
    const [a, b, c, d, w] = p;
    for (let k = 0; k < 3; k++) {
      const o = tri[f * 3 + k] * 10;
      Q[o] += a * a * w; Q[o + 1] += a * b * w; Q[o + 2] += a * c * w; Q[o + 3] += a * d * w;
      Q[o + 4] += b * b * w; Q[o + 5] += b * c * w; Q[o + 6] += b * d * w;
      Q[o + 7] += c * c * w; Q[o + 8] += c * d * w; Q[o + 9] += d * d * w;
    }
  }
  const q = new Float64Array(10);
  const errAt = (x: number, y: number, z: number): number =>
    q[0] * x * x + 2 * q[1] * x * y + 2 * q[2] * x * z + 2 * q[3] * x
    + q[4] * y * y + 2 * q[5] * y * z + 2 * q[6] * y
    + q[7] * z * z + 2 * q[8] * z + q[9];

  type Move = { cost: number; u: number; v: number; x: number; y: number; z: number; su: number; sv: number };
  const heap: Move[] = [];
  const up = (i: number): void => {
    while (i > 0) {
      const p2 = (i - 1) >> 1;
      if (heap[p2].cost <= heap[i].cost) break;
      [heap[p2], heap[i]] = [heap[i], heap[p2]]; i = p2;
    }
  };
  const down = (i: number): void => {
    for (;;) {
      const l = i * 2 + 1, r = l + 1;
      let m = i;
      if (l < heap.length && heap[l].cost < heap[m].cost) m = l;
      if (r < heap.length && heap[r].cost < heap[m].cost) m = r;
      if (m === i) break;
      [heap[m], heap[i]] = [heap[i], heap[m]]; i = m;
    }
  };
  const push = (u: number, v: number): void => {
    for (let k = 0; k < 10; k++) q[k] = Q[u * 10 + k] + Q[v * 10 + k];
    const ux = pos[u * 3], uy = pos[u * 3 + 1], uz = pos[u * 3 + 2];
    const vx = pos[v * 3], vy = pos[v * 3 + 1], vz = pos[v * 3 + 2];
    let best = errAt(ux, uy, uz), bx = ux, by = uy, bz = uz;
    for (const [x, y, z] of [[vx, vy, vz], [(ux + vx) / 2, (uy + vy) / 2, (uz + vz) / 2]]) {
      const e = errAt(x, y, z);
      if (e < best) { best = e; bx = x; by = y; bz = z; }
    }
    heap.push({ cost: Math.max(0, best), u, v, x: bx, y: by, z: bz, su: stamp[u], sv: stamp[v] });
    up(heap.length - 1);
  };
  const around = (v: number): number[] => {
    const out = new Set<number>();
    for (const f of faces[v]) {
      if (dead[f]) continue;
      for (let k = 0; k < 3; k++) if (tri[f * 3 + k] !== v) out.add(tri[f * 3 + k]);
    }
    return [...out];
  };
  for (let v = 0; v < nv; v++) for (const w of around(v)) if (w > v) push(v, w);

  let live = 0;
  for (let f = 0; f < dead.length; f++) if (!dead[f]) live++;
  while (live > target && heap.length) {
    const m = heap[0];
    heap[0] = heap[heap.length - 1]; heap.pop(); if (heap.length) down(0);
    const { u, v, x, y, z } = m;
    if (gone[u] || gone[v] || stamp[u] !== m.su || stamp[v] !== m.sv) continue;

    // the link condition: exactly the two vertices opposite the shared edge
    const nu = new Set(around(u)), shared: number[] = [];
    for (const w of around(v)) if (nu.has(w)) shared.push(w);
    const both = faces[v].filter((f) => !dead[f] && (tri[f * 3] === u || tri[f * 3 + 1] === u || tri[f * 3 + 2] === u));
    if (both.length !== 2 || shared.length !== 2) continue;

    // and no face may turn inside out on the way
    let flips = false;
    for (const w of [u, v]) {
      for (const f of faces[w]) {
        if (dead[f] || both.includes(f)) continue;
        const before = plane(f);
        if (!before) continue;
        const p: number[] = [];
        for (let k = 0; k < 3; k++) {
          const t = tri[f * 3 + k];
          p.push(...(t === u || t === v ? [x, y, z] : [pos[t * 3], pos[t * 3 + 1], pos[t * 3 + 2]]));
        }
        const ax = p[3] - p[0], ay = p[4] - p[1], az = p[5] - p[2];
        const bx = p[6] - p[0], by = p[7] - p[1], bz = p[8] - p[2];
        const cx = ay * bz - az * by, cy = az * bx - ax * bz, cz = ax * by - ay * bx;
        const len = Math.hypot(cx, cy, cz);
        if (len < 1e-12 || (cx * before[0] + cy * before[1] + cz * before[2]) / len < 0.1) { flips = true; break; }
      }
      if (flips) break;
    }
    if (flips) continue;

    // collapse: v moves onto u, which moves to the point the quadric chose
    pos[u * 3] = x; pos[u * 3 + 1] = y; pos[u * 3 + 2] = z;
    for (let k = 0; k < 10; k++) Q[u * 10 + k] += Q[v * 10 + k];
    for (const f of both) { dead[f] = 1; live--; }
    for (const f of faces[v]) {
      if (dead[f]) continue;
      for (let k = 0; k < 3; k++) if (tri[f * 3 + k] === v) tri[f * 3 + k] = u;
      faces[u].push(f);
    }
    gone[v] = 1; stamp[u]++; stamp[v]++;
    faces[u] = faces[u].filter((f) => !dead[f]);
    for (const w of around(u)) { stamp[w]++; }
    for (const w of around(u)) push(u, w);
  }

  // renumbered onto what is left
  const keep = new Map<number, number>();
  const outPos: number[] = [], outTri: number[] = [];
  for (let f = 0; f < dead.length; f++) {
    if (dead[f]) continue;
    for (let k = 0; k < 3; k++) {
      const t = tri[f * 3 + k];
      let n = keep.get(t);
      if (n === undefined) { n = outPos.length / 3; keep.set(t, n); outPos.push(pos[t * 3], pos[t * 3 + 1], pos[t * 3 + 2]); }
      outTri.push(n);
    }
  }
  return { pos: outPos, tri: outTri };
}

const b64 = (a: Uint16Array) => Buffer.from(a.buffer, a.byteOffset, a.byteLength).toString("base64");

/**
 * One module: the given triangles, their vertices renumbered to just the ones
 * they use, and the positions packed as 16-bit over the box they occupy — which
 * is a hundredth of a millimetre at this size, and half the bytes of floats.
 */
function emit(who: string, tris: readonly number[]): void {
  const map = new Map<number, number>();
  let idxOut: number[] = [], pos: number[] = [];
  let uv: number[] | null = uvRaw ? [] : null;
  for (const t of tris) for (let k = 0; k < 3; k++) {
    const v = index[t + k];
    let n = map.get(v);
    if (n === undefined) {
      n = map.size; map.set(v, n);
      pos.push(world[v * 3], world[v * 3 + 1], world[v * 3 + 2]);
      if (uv) uv.push(uvRaw![v * 2], uvRaw![v * 2 + 1]);
    }
    idxOut.push(n);
  }
  if (simplifyTo && idxOut.length / 3 > simplifyTo) {
    const was = idxOut.length / 3, wasV = pos.length / 3;
    const cut = simplify(pos, idxOut, simplifyTo);
    pos = cut.pos; idxOut = cut.tri;
    // `simplify` welds on position and renumbers, which no texture coordinate
    // survives: a weld across a UV seam joins two corners of the atlas that are
    // nowhere near each other, and the triangles between them stretch across
    // whatever is in between. Decimate a textured mesh in the tool that owns
    // the UVs — Blender's collapse interpolates them — and bake the result.
    if (uv) { uv = null; console.log("  texture coordinates DROPPED: --simplify cannot carry them"); }
    console.log(`  ${who}: ${was.toLocaleString()} triangles (${wasV.toLocaleString()} vertices) `
      + `simplified to ${(idxOut.length / 3).toLocaleString()} (${(pos.length / 3).toLocaleString()})`);
  }
  if (map.size > 65536) throw new Error("more vertices than a Uint16 index can carry");
  const box = { lo: [Infinity, Infinity, Infinity], hi: [-Infinity, -Infinity, -Infinity] };
  for (let i = 0; i < pos.length; i += 3) for (let c = 0; c < 3; c++) {
    if (pos[i + c] < box.lo[c]) box.lo[c] = pos[i + c];
    if (pos[i + c] > box.hi[c]) box.hi[c] = pos[i + c];
  }
  const q = new Uint16Array(pos.length);
  for (let i = 0; i < pos.length; i += 3) for (let c = 0; c < 3; c++) {
    const k = (pos[i + c] - box.lo[c]) / (box.hi[c] - box.lo[c] || 1);
    q[i + c] = Math.max(0, Math.min(65535, Math.round(k * 65535)));
  }
  // UVs pack the same way as positions, over [0, 1] rather than over a box:
  // one part in 65,535 is a thousandth of a texel on a 1024 atlas
  const quv = uv ? new Uint16Array(uv.length) : null;
  if (uv && quv) for (let i = 0; i < uv.length; i++) quv[i] = Math.max(0, Math.min(65535, Math.round(uv[i] * 65535)));
  const idx = Uint16Array.from(idxOut);
  const out = join(HERE, `../src/bedsit-${who}-mesh.ts`);
  writeFileSync(out, `/**
 * ${who}: an imported mesh, baked by \`taoot/tools/bedsitglb.ts\`. Do not edit —
 * re-run the tool. In the room's own frame: +x is the back, y is the length
 * about 0, z is up from the floor, ${exact
    ? `at the file's own coordinates taken as metres at ${exact} units to one.`
    : `stretched to the measured\n * ${LEN} x ${DEP} x ${HT} the whole piece is known to be.`}
 *
 * ${(idx.length / 3).toLocaleString()} triangles, ${(q.length / 3).toLocaleString()} vertices, positions quantized to 16 bits over
 * {@link BOX}. Normals are not stored: \`Builder.mesh\` averages them from the
 * triangles, which is both smaller here and smoother there.${quv ? "\n *\n * Texture coordinates ARE stored: they are the file's own, and nothing here\n * could work them out again." : ""}
 */

/** the box the vertices occupy, in the piece's own frame — what a chart laid
 *  over this mesh measures itself against */
export const BOX = {
  lo: [${box.lo.map((v) => v.toFixed(1)).join(", ")}] as const,
  hi: [${box.hi.map((v) => v.toFixed(1)).join(", ")}] as const,
};

/** base64 of the packed vertices, then of the triangle indices */
const PACKED = "${b64(q)}";
const INDEX = "${b64(idx)}";${quv ? `
/** and of the texture coordinates the file came with, over [0, 1] */
const TEXCOORD = "${b64(quv)}";` : ""}

function bytes(s: string): Uint16Array {
  const bin = atob(s), n = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) n[i] = bin.charCodeAt(i);
  return new Uint16Array(n.buffer);
}

const packed = bytes(PACKED);
export const POSITION = new Float32Array(packed.length);
for (let i = 0; i < packed.length; i += 3) {
  for (let c = 0; c < 3; c++) POSITION[i + c] = BOX.lo[c] + (packed[i + c] / 65535) * (BOX.hi[c] - BOX.lo[c]);
}
export const INDICES = bytes(INDEX);
${quv ? `
/** the atlas coordinates, one pair a vertex — pass to \`Builder.mesh\` and it
 *  uses these instead of box-mapping the material it is drawn in */
const texel = bytes(TEXCOORD);
export const UV = new Float32Array(texel.length);
for (let i = 0; i < texel.length; i++) UV[i] = texel[i] / 65535;
` : ""}`);
  console.log(`  ${out}  ${(idx.length / 3).toLocaleString()} triangles, ${((b64(q).length + b64(idx).length) / 1024).toFixed(1)} KiB of base64`);
}

const parts = islands();
for (const [i, one] of parts.entries()) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const t of one) for (let k = 0; k < 3; k++) for (let c = 0; c < 3; c++) {
    const v = world[index[t + k] * 3 + c];
    if (v < lo[c]) lo[c] = v; if (v > hi[c]) hi[c] = v;
  }
  const box = (c: number) => `${lo[c].toFixed(0)}..${hi[c].toFixed(0)}`;
  console.log(`  island ${String(i).padStart(2)}: ${String(one.length).padStart(5)} tri  x ${box(0).padStart(11)}  y ${box(1).padStart(13)}  z ${box(2).padStart(11)}`);
}
if (listOnly) process.exit(0);
if (useParts.length) {
  // by the file's own materials, which is the one grouping an assembled model
  // arrives with — and the one the room needs, a module being drawn in exactly
  // one material
  for (const part of useParts) {
    const mine: number[] = [];
    for (let t = 0; t < matOf.length; t++) if (matOf[t] === part.mat) mine.push(t * 3);
    if (!mine.length) { console.log(`  ${part.name}: no triangle wears material ${part.mat}`); continue; }
    console.log(`  ${part.name}: material ${part.mat}, ${mine.length.toLocaleString()} triangles`);
    emit(part.name, mine);
  }
  process.exit(0);
}
const kept = parts.filter((_, i) => !drop.includes(i));
if (drop.length) console.log(`  islands ${drop.join(", ")} dropped — ${parts.length - kept.length} of ${parts.length}`);
if (bands.length) {
  for (const band of bands) {
    const mine = kept.filter((one) => {
      let lo = Infinity, hi = -Infinity;
      for (const t of one) for (let k = 0; k < 3; k++) {
        const z = world[index[t + k] * 3 + 2];
        if (z < lo) lo = z; if (z > hi) hi = z;
      }
      const mid = (lo + hi) / 2;
      return mid >= band.z0 && mid < band.z1;
    });
    if (!mine.length) { console.log(`  ${band.name}: no island between z ${band.z0} and ${band.z1}`); continue; }
    console.log(`  ${band.name}: ${mine.length} island(s) between z ${band.z0} and ${band.z1}`);
    emit(band.name, mine.flat());
  }
} else if (detaches.length) {
  const taken: number[][] = [];
  for (const d of detaches) {
    const mine = d.ranks.map((r) => {
      if (!parts[r]) throw new Error(`no island of rank ${r}`);
      return parts[r];
    });
    taken.push(...mine);
    emit(d.name, mine.flat());
  }
  const rest = kept.filter((p) => !taken.includes(p)).flat();
  if (rest.length) emit(name, rest);
  else console.log(`  ${name}: nothing left over`);
} else emit(name, kept.flat());
