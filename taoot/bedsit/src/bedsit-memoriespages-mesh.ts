/**
 * memoriespages: an imported mesh, baked by `taoot/bedsit/tools/bedsitglb.ts`. Do not edit —
 * re-run the tool. In the room's own frame: +x is the back, y is the length
 * about 0, z is up from the floor, stretched to the measured
 * 1 x 1 x 1 the whole piece is known to be.
 *
 * 14 triangles, 20 vertices, positions quantized to 16 bits over
 * {@link BOX}. Normals are not stored: `Builder.mesh` averages them from the
 * triangles, which is both smaller here and smoother there.
 */

import { indices, positions } from "./bedsit-mesh-decode";

/** the box the vertices occupy, in the piece's own frame — what a chart laid
 *  over this mesh measures itself against */
export const BOX = {
  lo: [-329.3, 16.5, 11.4] as const,
  hi: [334.5, 231.0, 533.9] as const,
};

/** base64 of the packed vertices, then of the triangle indices */
const PACKED = "CAQvRiz9CATKLpn6CARVXtT/CARlFwb4DAYAAHP1BoMWX+r///+CAZ71///XX///AABW5rkHCAR9/mEKAADxziYFAACNt5MCDAYooAAA/////4wKBoPpoBUA//+qoSsA///XX/////+CAZ71/////4wK//+qoSsA";
const INDEX = "AAABAAIAAQADAAIAAwAEAAIAAgAEAAUABAAGAAUABQAGAAcACAAJAAoACgAJAAsACwAJAAwACQANAAwADAANAA4ADQAPAA4AEAARABIAEQATABIA";

export const POSITION = positions(PACKED, BOX);
export const INDICES = indices(INDEX);
