/**
 * tellurianpages: an imported mesh, baked by `taoot/bedsit/tools/bedsitglb.ts`. Do not edit —
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
  lo: [-145.5, -203.6, 5.6] as const,
  hi: [143.2, 200.5, 39.6] as const,
};

/** base64 of the packed vertices, then of the triangle indices */
const PACKED = "9/v//3a79/v///l89/v///f79/v//30+8/n//wAA+Xz///v9AAD//wgEAAD///////8AAHa79/sAAPf7//8AAPl8//8AAH0+8/kAAAAAAAAAAP//+XwAAAQCAAAAAAgEAAD/////AAD//wgEAAAAAP//AAAAAAgE";
const INDEX = "AAABAAIAAQADAAIAAwAEAAIAAgAEAAUABAAGAAUABQAGAAcACAAJAAoACgAJAAsACwAJAAwACQANAAwADAANAA4ADQAPAA4AEAARABIAEQATABIA";

export const POSITION = positions(PACKED, BOX);
export const INDICES = indices(INDEX);
