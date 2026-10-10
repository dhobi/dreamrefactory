/**
 * futilitycover: an imported mesh, baked by `taoot/bedsit/tools/bedsitglb.ts`. Do not edit —
 * re-run the tool. In the room's own frame: +x is the back, y is the length
 * about 0, z is up from the floor, stretched to the measured
 * 1 x 1 x 1 the whole piece is known to be.
 *
 * 10 triangles, 20 vertices, positions quantized to 16 bits over
 * {@link BOX}. Normals are not stored: `Builder.mesh` averages them from the
 * triangles, which is both smaller here and smoother there.
 *
 * Texture coordinates ARE stored: they are the file's own, and nothing here
 * could work them out again.
 */

import { indices, positions, texels } from "./bedsit-mesh-decode";

/** the box the vertices occupy, in the piece's own frame — what a chart laid
 *  over this mesh measures itself against */
export const BOX = {
  lo: [-150.0, -114.5, 4.1] as const,
  hi: [150.0, 120.0, 38.0] as const,
};

/** base64 of the packed vertices, then of the triangle indices */
const PACKED = "AAD0BZX8AAD8AQ30///0BZX8///8AQ30AAD//2oD4QMH/IgI/////2oDLvoH/IkIAAD0BZX8///0BZX8AAD/////////////Lvr0BR8F//8AAAAALvoH/IkI/////2oDAAAAAAAA4QP0BR8FAAD//2oD4QMH/IgI";
const INDEX = "AAABAAIAAQADAAIABAAFAAYABQAHAAYACAAJAAoACQALAAoADAANAA4ADgANAA8AEAARABIAEgARABMA";
/** and of the texture coordinates the file came with, over [0, 1] */
const TEXCOORD = "AAD0BQAA/AH///QF///8AQAA///hAwf8/////y76B/wAAPQF///0BQAA////////Lvr0Bf//AAAu+gf8/////wAAAADhA/QFAAD//+EDB/w=";

export const POSITION = positions(PACKED, BOX);
export const INDICES = indices(INDEX);

/** the atlas coordinates, one pair a vertex — pass to `Builder.mesh` and it
 *  uses these instead of box-mapping the material it is drawn in */
export const UV = texels(TEXCOORD);
