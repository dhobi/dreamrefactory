/**
 * memoriescover: an imported mesh, baked by `taoot/bedsit/tools/bedsitglb.ts`. Do not edit —
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
  lo: [-329.3, 11.4, 3.1] as const,
  hi: [345.0, 245.8, 549.1] as const,
};

/** base64 of the packed vertices, then of the triangle indices */
const PACKED = "9AWd/sIL/AEp+1wL9AU9Ztb//AHJYnH////CmSkAB/yFmRgE//9iAT30B/zrBu7u9AWd/sIL9AU9Ztb//////+sL//+fZ///9AWJBcXuAAAAABT0B/zrBu7u//9iAT30AABgmAAA9AUkmPAD///CmSkAB/yFmRgE";
const INDEX = "AAABAAIAAQADAAIABAAFAAYABQAHAAYACAAJAAoACQALAAoADAANAA4ADgANAA8AEAARABIAEgARABMA";
/** and of the texture coordinates the file came with, over [0, 1] */
const TEXCOORD = "9AX///wB///0BQAA/AEAAP////8H/B78//8AAAf80QX0Bf//9AUAAP///////wAA9AXRBQAAAAAH/NEF//8AAAAA///0BR78/////wf8Hvw=";

export const POSITION = positions(PACKED, BOX);
export const INDICES = indices(INDEX);

/** the atlas coordinates, one pair a vertex — pass to `Builder.mesh` and it
 *  uses these instead of box-mapping the material it is drawn in */
export const UV = texels(TEXCOORD);
