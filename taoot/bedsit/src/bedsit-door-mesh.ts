/**
 * door: an imported mesh, baked by `taoot/bedsit/tools/bedsitglb.ts`. Do not edit —
 * re-run the tool. In the room's own frame: +x is the back, y is the length
 * about 0, z is up from the floor, at the file's own coordinates taken as metres at 1549.375 units to one.
 *
 * 12 triangles, 8 vertices, positions quantized to 16 bits over
 * {@link BOX}. Normals are not stored: `Builder.mesh` averages them from the
 * triangles, which is both smaller here and smoother there.
 */

import { indices, positions } from "./bedsit-mesh-decode";

/** the box the vertices occupy, in the piece's own frame — what a chart laid
 *  over this mesh measures itself against */
export const BOX = {
  lo: [80.0, -993.5, 0.0] as const,
  hi: [150.0, 993.5, 3300.0] as const,
};

/** base64 of the packed vertices, then of the triangle indices */
const PACKED = "AAAAAAAA//8AAAAA/////wAAAAD//wAAAAD///////////////8AAP//AAAAAP//";
const INDEX = "AAABAAIAAAACAAMABAAFAAYABAAGAAcAAAAHAAYAAAAGAAEAAQAGAAUAAQAFAAIAAgAFAAQAAgAEAAMAAwAEAAcAAwAHAAAA";

export const POSITION = positions(PACKED, BOX);
export const INDICES = indices(INDEX);
