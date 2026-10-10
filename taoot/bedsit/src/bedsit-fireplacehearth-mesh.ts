/**
 * fireplacehearth: an imported mesh, baked by `taoot/bedsit/tools/bedsitglb.ts`. Do not edit —
 * re-run the tool. In the room's own frame: +x is the back, y is the length
 * about 0, z is up from the floor, stretched to the measured
 * 2950 x 966 x 196 the whole piece is known to be.
 *
 * 12 triangles, 8 vertices, positions quantized to 16 bits over
 * {@link BOX}. Normals are not stored: `Builder.mesh` averages them from the
 * triangles, which is both smaller here and smoother there.
 */

import { indices, positions } from "./bedsit-mesh-decode";

/** the box the vertices occupy, in the piece's own frame — what a chart laid
 *  over this mesh measures itself against */
export const BOX = {
  lo: [-516.0, -1475.0, 0.0] as const,
  hi: [450.0, 1475.0, 195.8] as const,
};

/** base64 of the packed vertices, then of the triangle indices */
const PACKED = "//8AAAAA/////wAAAAD//wAAAAAAAAAAAAAAAP//AAD///////////////8AAP//";
const INDEX = "AAABAAIAAAACAAMABAAFAAYABAAGAAcAAAAHAAYAAAAGAAEAAQAGAAUAAQAFAAIAAgAFAAQAAgAEAAMAAwAEAAcAAwAHAAAA";

export const POSITION = positions(PACKED, BOX);
export const INDICES = indices(INDEX);
