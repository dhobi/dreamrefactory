/**
 * A hit test's depth, a pixel at a time, is the depth sphere's render to the
 * bit.
 *
 *   npm test -w redjack -- depth
 *
 * A hit test at a node reads one or two distances of the view, and rendering
 * all of it for that cost a frame's worth of work every time the camera moved
 * (maze-view.ts `hitOcclusion`). So it asks `SphereImage.rendered` for just
 * those pixels — which must agree with `render` exactly, or a click that hit a
 * sprite in one would miss it in the other. `at` (setdepth's) does not: it
 * keeps its rays in doubles where `render` keeps Float32s, and the two part on
 * a tile's edge. Every pixel of a few views of a few rooms' nodes, through
 * cameras that pitch and roll.
 */
import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { readSettFile } from "@dreamfactory/engine/df/sett";
import { SphereImage, type SphereLook } from "@dreamfactory/engine/runtime/maze-render";
import { haveRip, indexDiscs } from "./harness";

const W = 640;
const H = 480;
const LOOKS: SphereLook[] = [
  { heading: 0.3, pitch: 0, fov: 1.2 },
  { heading: 4.1, pitch: 0.21, fov: 0.9, roll: 0.05 },
  { heading: 2.2, pitch: -0.3, fov: 1.5 },
];

/** the pixels of one view where the two part, the first five at most */
function parted(s: SphereImage, look: SphereLook, where: string): string[] {
  const z = new Uint32Array(W * H);
  s.render(z, W, H, look);
  const out: string[] = [];
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W && out.length < 5; x++) if (s.rendered(x, y, W, H, look) !== z[y * W + x]) out.push(`${where} (${x},${y})`);
  return out;
}

test.skipIf(!haveRip())("a depth pixel worked out alone is the render's pixel", () => {
  const index = indexDiscs();
  const rooms = ["hub.sett", "ptroyal.sett", "rjbeach.sett"];
  let views = 0;
  const found: string[] = [];
  for (const room of rooms) {
    const path = [...(index.get(room)?.values() ?? [])][0];
    expect(path, `${room} on a disc`).toBeTruthy();
    const sett = readSettFile(new Uint8Array(readFileSync(path!)));
    for (const node of sett.nodes.filter((n) => n.sphere > 0).slice(0, 2)) {
      const s = new SphereImage(sett.file, node.sphere, true);
      for (const look of LOOKS) {
        found.push(...parted(s, look, `${room} ${node.name}`));
        views++;
      }
    }
  }
  expect(views, "views compared").toBeGreaterThan(0);
  expect(found).toEqual([]);
});
