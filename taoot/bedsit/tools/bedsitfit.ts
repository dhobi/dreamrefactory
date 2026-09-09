/**
 * Where `taoot/src/bedsit-room.ts`'s numbers come from.
 *
 *   npx tsx taoot/tools/bedsitfit.ts [path/to/bedsit1.set]
 *
 * A SET carries no geometry, but every frame carries a camera and a **Z image**
 * — a per-pixel depth in 24 levels over `zFarMax`, shipped so the runtime can
 * hide an actor behind the scenery in front of it. Take the twenty-four hi-res
 * standpoint frames of BEDSIT1, back-project each pixel through its own camera,
 * and the room falls out as three million points. This tool is the measuring
 * that turns those points into the handful of numbers the model is built from,
 * and it prints them so a reader can check the model against the file rather
 * than against a claim.
 *
 * It measures four things.
 *
 * **Which depth.** Radial from the eye, or planar along the view axis? The two
 * differ by 41% at the corner of the frame, so the walls decide it: each is fit
 * both ways and the one with the taller, narrower agreement peak wins. Radial
 * wins on all four, which is worth knowing because the runtime's own
 * `depthLevel()` quantizes the *planar* depth — an inconsistency in TI.EXE, not
 * in the art.
 *
 * **The four walls.** Level `L` says only that the surface is somewhere in
 * `[L, L+1) × zFarMax/24`, so no single ray measures a wall. A candidate plane
 * is scored by how many rays' intervals it satisfies, over a sweep; the peak is
 * the wall and the width at half height is the honest error bar.
 *
 * **The ceiling.** Upward rays only, the 95th percentile of z per slab of x —
 * once with the two dormer bands excluded (the cove) and once with only them
 * (the vaults).
 *
 * **The openings.** A ray that crosses a wall plane with a depth well past it
 * went *through*; one that stops within a level of it is wall. Mapping the ratio
 * over each of the four planes finds the two windows, and the fireplace opening
 * in the wall opposite them, and nothing else — which is also how we know the
 * door is shut in every frame the room ships.
 *
 * That map is not, however, where the model's window bounds come from, and the
 * last section says why: it is drawn on the wall plane, and the glass is 580
 * units behind the wall plane, so everything on it is foreshortened towards
 * whichever eye saw it. The **daylight** is measured instead, cast onto the
 * glass — a night interior with a city outside is the easiest segmentation
 * problem in the room, and every view then agrees.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readSetFile, RIGHTTURNS, LEFTTURNS, SetFile } from "@dreamfactory/engine/df/set";
import { RingCache } from "@dreamfactory/engine/web/ring-cache";
import { indexedToRGBA, paletteToRGBA } from "@dreamfactory/engine/df/image";

const HERE = dirname(fileURLToPath(import.meta.url));
const SET_PATH = process.argv[2] ?? join(HERE, "../../gamefiles/en/titanic1/data/bedsit1.set");
const set: SetFile = readSetFile(new Uint8Array(readFileSync(SET_PATH)));

const UPL = set.zFarMax / set.zLevelCount;
const W = set.viewPortWidth, H = set.viewPortHeight;
/** the projection TI.EXE uses, recovered in docs/engine/formats/set.md */
const F = Math.max(W, H) / 2, CX = W / 2, CY = H / 2;

/** one pixel of one standpoint frame: the eye, the unit ray, and the level */
interface Ray {
  cx: number; cy: number; cz: number;
  /** unit direction in world space */
  dx: number; dy: number; dz: number;
  /** planar depth per unit of ray, i.e. radial = planar × `n` */
  n: number;
  lv: number;
}

function scan(): Ray[] {
  const cache = new RingCache(set);
  const rays: Ray[] = [];
  for (const scene of set.scenes) {
    for (const dir of [RIGHTTURNS, LEFTTURNS] as const) {
      const frames = scene.turns[dir].frames;
      const decoded = cache.ensure(frames);
      const seen = new Set<number>();
      for (const fi of frames) {
        // motionInfo 2 is the hi-res standpoint — the sharp frame a settled view
        // shows, and the only one worth scanning; its low-res twin is the same
        // picture and the mid-turn frames repeat the same walls at an angle
        if (fi.motionInfo !== 2 || seen.has(fi.axisX8 & 0xff)) continue;
        const cf = decoded.get(fi.frameContainerLoc);
        if (!cf?.z) continue;
        seen.add(fi.axisX8 & 0xff);
        const th = (2 * Math.PI * (fi.axisX8 & 0xff)) / 256;
        const c = Math.cos(th), s = Math.sin(th);
        for (let py = 0; py < H; py++) {
          for (let px = 0; px < W; px++) {
            const lv = cf.z[py * W + px];
            // 0 is "no depth here" and the top level is the far clip: sky
            if (lv <= 0 || lv >= set.zLevelCount) continue;
            const l = (px + 0.5 - CX) / F, u = -(py + 0.5 - CY) / F;
            const n = Math.hypot(1, l, u);
            rays.push({
              cx: fi.posX16, cy: fi.posZ16, cz: fi.posY16,
              dx: (c - l * s) / n, dy: (s + l * c) / n, dz: u / n, n, lv,
            });
          }
        }
      }
    }
  }
  return rays;
}

console.log(`${set.setName}: ${set.scenes.length} scenes, viewport ${W}×${H}, ` +
  `Z ${set.zLevelCount} levels over ${set.zFarMax} (${UPL.toFixed(1)} units/level)`);
const rays = scan();
console.log(`${rays.length.toLocaleString("en")} depth samples from 24 hi-res standpoint frames\n`);

// ---------------------------------------------------------------------------
// 1. the walls, and what the depth measures
// ---------------------------------------------------------------------------

interface WallSpec { axis: "x" | "y"; sign: -1 | 1; lo: number; hi: number; other: [number, number] }
const WALLS: Record<string, WallSpec> = {
  "x-  window wall": { axis: "x", sign: -1, lo: 2400, hi: 4400, other: [3400, 12000] },
  "x+  counter wall": { axis: "x", sign: 1, lo: 10400, hi: 12400, other: [3400, 12000] },
  "y-  fireplace wall": { axis: "y", sign: -1, lo: 2000, hi: 4000, other: [3400, 11500] },
  "y+  door wall": { axis: "y", sign: 1, lo: 11400, hi: 13400, other: [3400, 11500] },
};
/** rays whose depth interval contains the plane, with the hit inside the room */
function agree(w: WallSpec, v: number, radial: boolean): number {
  let n = 0;
  for (const r of rays) {
    const d = w.axis === "x" ? r.dx : r.dy, c0 = w.axis === "x" ? r.cx : r.cy;
    if (d * w.sign <= 0.05) continue;
    const t = (v - c0) / d;
    if (t <= 0) continue;
    if (Math.floor((radial ? t : t / r.n) / UPL) !== r.lv) continue;
    const z = r.cz + r.dz * t;
    if (z < 1400 || z > 2400) continue; // a band of wall clear of furniture and cove
    const o = w.axis === "x" ? r.cy + r.dy * t : r.cx + r.dx * t;
    if (o < w.other[0] || o > w.other[1]) continue;
    n++;
  }
  return n;
}
function sweep(w: WallSpec, radial: boolean): { at: number; peak: number; width: number } {
  let peak = -1, at = 0;
  const seen: [number, number][] = [];
  for (let v = w.lo; v <= w.hi; v += 25) {
    const n = agree(w, v, radial);
    seen.push([v, n]);
    if (n > peak) { peak = n; at = v; }
  }
  const half = seen.filter(([, n]) => n >= peak / 2).map(([v]) => v);
  return { at, peak, width: half[half.length - 1] - half[0] };
}

console.log("the four planes — a sweep of candidate walls, scored by how many rays' depth");
console.log("intervals they satisfy. `width` is the sweep's width at half its peak.\n");
console.log("                        radial from the eye        planar along the axis");
for (const [name, w] of Object.entries(WALLS)) {
  const rad = sweep(w, true), pla = sweep(w, false);
  console.log(`  ${name.padEnd(20)}  ${String(rad.at).padStart(6)} ±${String(rad.width / 2).padStart(4)}` +
    ` (${String(rad.peak).padStart(7)})    ${String(pla.at).padStart(6)} ±${String(pla.width / 2).padStart(4)} (${String(pla.peak).padStart(7)})`);
}
console.log("\n  radial wins every wall: taller peak, narrower plateau. The model uses it.\n");

// ---------------------------------------------------------------------------
// 2. the ceiling
// ---------------------------------------------------------------------------

const X0 = 3000, X1 = 11600, Y0 = 2600, Y1 = 12600;
const DORMERS: [number, number][] = [[5270, 6560], [9240, 10610]];
const inDormer = (y: number): boolean => DORMERS.some(([a, b]) => y > a && y < b);

function ceilingProfile(label: string, want: (y: number) => boolean, to: number): void {
  console.log(label);
  for (let x = X0; x < to; x += 200) {
    const zs: number[] = [];
    for (const r of rays) {
      if (r.dz < 0.03) continue; // looking up
      const t = (r.lv + 0.5) * UPL;
      const px = r.cx + r.dx * t, py = r.cy + r.dy * t;
      if (px < x || px >= x + 200 || py <= Y0 || py >= Y1 || px <= X0 || px >= X1) continue;
      if (!want(py)) continue;
      zs.push(r.cz + r.dz * t);
    }
    if (zs.length < 60) { console.log(`   x ${String(x).padStart(5)}   (only ${zs.length} samples)`); continue; }
    zs.sort((a, b) => a - b);
    console.log(`   x ${String(x).padStart(5)}   z ${zs[Math.floor(zs.length * 0.95)].toFixed(0).padStart(5)}   (${zs.length} samples)`);
  }
  console.log();
}
ceilingProfile("the cove — 95th percentile of z per slab of x, off the dormers:", (y) => !inDormer(y), 5600);
ceilingProfile("the dormer vaults — the same, over the two windows only:", inDormer, 5600);
console.log("the flat ceiling, for comparison:");
{
  const zs: number[] = [];
  for (const r of rays) {
    if (r.dz < 0.03) continue;
    const t = (r.lv + 0.5) * UPL;
    const px = r.cx + r.dx * t, py = r.cy + r.dy * t;
    if (px < 6000 || px > 10400 || py <= 3400 || py >= 11800) continue;
    zs.push(r.cz + r.dz * t);
  }
  zs.sort((a, b) => a - b);
  console.log(`   x 6000..10400   z ${zs[Math.floor(zs.length * 0.95)].toFixed(0)}   (${zs.length} samples)\n`);
}

// ---------------------------------------------------------------------------
// 3. the openings
// ---------------------------------------------------------------------------

/** an aperture map of one wall: `#` where rays pass through, `.` where they stop */
function apertures(name: string, w: WallSpec, v: number, a0: number, a1: number): void {
  const SC = 40, Z0 = 400, Z1 = 4600;
  const nw = Math.ceil((a1 - a0) / SC), nh = Math.ceil((Z1 - Z0) / SC);
  const thru = new Int32Array(nw * nh), stop = new Int32Array(nw * nh);
  for (const r of rays) {
    const d = w.axis === "x" ? r.dx : r.dy, c0 = w.axis === "x" ? r.cx : r.cy;
    if (d * w.sign <= 0.08) continue;
    const t = (v - c0) / d;
    if (t <= 300) continue;
    const a = w.axis === "x" ? r.cy + r.dy * t : r.cx + r.dx * t;
    const z = r.cz + r.dz * t;
    if (a < a0 || a >= a1 || z < Z0 || z >= Z1) continue;
    const k = Math.floor((z - Z0) / SC) * nw + Math.floor((a - a0) / SC);
    const rad = (r.lv + 0.5) * UPL;
    if (rad > t + 700) thru[k]++;
    else if (Math.abs(rad - t) <= 700) stop[k]++;
  }
  // the openings, as runs of "mostly through" per row
  const found: { a0: number; a1: number; z: number }[] = [];
  for (let iz = nh - 1; iz >= 0; iz--) {
    let run = -1;
    for (let ia = 0; ia <= nw; ia++) {
      const k = iz * nw + ia;
      const open = ia < nw && thru[k] >= 2 && thru[k] > stop[k];
      if (open && run < 0) run = ia;
      if (!open && run >= 0) {
        if (ia - run >= 3) found.push({ a0: a0 + run * SC, a1: a0 + ia * SC, z: Z0 + iz * SC });
        run = -1;
      }
    }
  }
  if (!found.length) { console.log(`   ${name}: solid — no ray gets through it`); return; }
  const lo = Math.min(...found.map((f) => f.a0)), hi = Math.max(...found.map((f) => f.a1));
  console.log(`   ${name}: openings between ${lo} and ${hi}, z ${Math.min(...found.map((f) => f.z))}..${Math.max(...found.map((f) => f.z))}`);
  // group into windows by a gap wider than one cell
  const cols = new Map<number, [number, number]>();
  for (const f of found) for (let a = f.a0; a < f.a1; a += SC) {
    const e = cols.get(a) ?? [Infinity, -Infinity];
    cols.set(a, [Math.min(e[0], f.z), Math.max(e[1], f.z + SC)]);
  }
  const keys = [...cols.keys()].sort((p, q) => p - q);
  let start = keys[0], prev = keys[0];
  const emit = (): void => {
    const zs = keys.filter((k) => k >= start && k <= prev).map((k) => cols.get(k)!);
    console.log(`      ${start}..${prev + SC}  (${prev + SC - start} wide)   sill ${Math.min(...zs.map((z) => z[0]))}   head ${Math.max(...zs.map((z) => z[1]))}`);
  };
  for (const k of keys.slice(1)) {
    if (k - prev > SC * 4) { emit(); start = k; }
    prev = k;
  }
  emit();
}
console.log("the openings — where rays cross a wall plane instead of stopping on it:");
apertures("x- window wall", WALLS["x-  window wall"], 3000, 4400, 11400);
apertures("x+ counter wall", WALLS["x+  counter wall"], 11600, 2600, 12600);
apertures("y- fireplace wall", WALLS["y-  fireplace wall"], 2600, 3000, 11600);
apertures("y+ door wall", WALLS["y+  door wall"], 12600, 3000, 11600);

// ---------------------------------------------------------------------------
// 3b. the windows, from the daylight, cast onto the glass
// ---------------------------------------------------------------------------

/** the plane the glass sits in: the wall, less the reveal the frames measure */
const GLASS = 2420;

console.log("\nthe windows — runs of daylight per view, cast onto the glass plane at x = " + GLASS + ".");
console.log("Each window reads as two lights either side of its mullion. A run is kept only");
console.log("if it reaches above z 3800, which no lamp in the room does and both windows do.\n");
{
  const cache = new RingCache(set);
  for (const scene of set.scenes) {
    for (const dir of [RIGHTTURNS, LEFTTURNS] as const) {
      const frames = scene.turns[dir].frames;
      const decoded = cache.ensure(frames);
      const seen = new Set<number>();
      for (const fi of frames) {
        if (fi.motionInfo !== 2 || seen.has(fi.axisX8 & 0xff)) continue;
        const cf = decoded.get(fi.frameContainerLoc);
        if (!cf) continue;
        const deg = fi.axisX8 & 0xff;
        seen.add(deg);
        const th = (2 * Math.PI * deg) / 256, c = Math.cos(th), s2 = Math.sin(th);
        if (c > -0.55) continue; // only views with the window wall in front of them
        const rgba = indexedToRGBA(cf.pixels, cf.width, cf.height, paletteToRGBA(set.paletteRaw, set.colorCount));
        const lumAt = (px: number, py: number): number => {
          const i = (py * W + px) * 4;
          return 0.3 * rgba[i] + 0.6 * rgba[i + 1] + 0.1 * rgba[i + 2];
        };
        const hit = (px: number, py: number): [number, number] => {
          const l = (px + 0.5 - CX) / F, u = -(py + 0.5 - CY) / F;
          const t = (GLASS - fi.posX16) / (c - l * s2);
          return [fi.posZ16 + (s2 + l * c) * t, fi.posY16 + u * t];
        };
        const runs: string[] = [];
        let st = -1;
        for (let px = 0; px <= W; px++) {
          let bright = 0;
          if (px < W) for (let py = 20; py < 200; py++) if (lumAt(px, py) > 96) bright++;
          const on = px < W && bright >= 10;
          if (on && st < 0) st = px;
          if (!on && st >= 0) {
            if (px - st >= 6) {
              let top = H, bot = -1;
              for (let q = st; q < px; q++) for (let py = 10; py < H - 24; py++) {
                if (lumAt(q, py) <= 96) continue;
                if (py < top) top = py;
                if (py > bot) bot = py;
              }
              const [ya] = hit(st, 0), [yb] = hit(px, 0);
              const [, zLo] = hit((st + px) / 2, bot), [, zHi] = hit((st + px) / 2, top);
              // the room's own lamps are bright too, and none of them is 2.4 m up
              if (zHi > 3800) {
                runs.push(`y ${Math.min(ya, yb).toFixed(0)}..${Math.max(ya, yb).toFixed(0)}` +
                  ` (${Math.abs(yb - ya).toFixed(0)} wide)   z ${zLo.toFixed(0)}..${zHi.toFixed(0)}`);
              }
            }
            st = -1;
          }
        }
        const inside = runs.filter((r) => !r.includes("-")); // a negative y is off the room
        if (inside.length) console.log(`   ${scene.sceneName} deg8 ${String(deg).padStart(3)}:  ${inside.join("\n                       ")}`);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// 4. the door, from its own hotspot
// ---------------------------------------------------------------------------

console.log("\nthe door — its hotspot rectangle, cast onto the y+ wall:");
for (const scene of set.scenes) {
  for (const v of scene.views) {
    const o = v.objects.find((ob) => ob.identifier === "door");
    if (!o) continue;
    const th = (2 * Math.PI * (v.rotation8 & 0xff)) / 256, c = Math.cos(th), s = Math.sin(th);
    const cast = (px: number, py: number): [number, number] => {
      const l = (px + 0.5 - CX) / F, u = -(py + 0.5 - CY) / F;
      const dx = c - l * s, dy = s + l * c;              // planar-depth form
      const t = (12600 - scene.zAxisMap) / dy;
      return [scene.xAxisMap + dx * t, 2479 + u * t];
    };
    const [xa] = cast(Math.min(o.startRegionX, o.endRegionX), 0);
    const [xb] = cast(Math.max(o.startRegionX, o.endRegionX), 0);
    const [, zTop] = cast((o.startRegionX + o.endRegionX) / 2, Math.min(o.startRegionY, o.endRegionY));
    console.log(`   ${scene.sceneName}/${v.viewName}: x ${Math.min(xa, xb).toFixed(0)}..${Math.max(xa, xb).toFixed(0)}` +
      ` (${Math.abs(xb - xa).toFixed(0)} wide)   head z ${zTop.toFixed(0)}`);
  }
}
