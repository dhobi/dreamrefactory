/**
 * futilitypages: an imported mesh, baked by `taoot/bedsit/tools/bedsitglb.ts`. Do not edit —
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
  lo: [-145.5, -114.5, 4.7] as const,
  hi: [143.2, 116.4, 33.5] as const,
};

/** base64 of the packed vertices, then of the triangle indices */
const PACKED = "//8IBHa7//8IBPl8//8IBPf7//8IBH0+//8MBgAA//8Gg/v9/////wgE////////AAAAAHa7AAAIBPf7AAAAAPl8AAAAAH0+AAAMBgAAAAD/////AAAGgwQCAAD//wgE/////////////wgEAAD/////AAD//wgE";
const INDEX = "AAABAAIAAQADAAIAAwAEAAIAAgAEAAUABAAGAAUABQAGAAcACAAJAAoACgAJAAsACwAJAAwACQANAAwADAANAA4ADQAPAA4AEAARABIAEQATABIA";

export const POSITION = positions(PACKED, BOX);
export const INDICES = indices(INDEX);
