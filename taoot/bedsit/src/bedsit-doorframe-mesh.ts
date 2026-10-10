/**
 * doorframe: an imported mesh, baked by `taoot/bedsit/tools/bedsitglb.ts`. Do not edit —
 * re-run the tool. In the room's own frame: +x is the back, y is the length
 * about 0, z is up from the floor, at the file's own coordinates taken as metres at 1549.375 units to one.
 *
 * 36 triangles, 24 vertices, positions quantized to 16 bits over
 * {@link BOX}. Normals are not stored: `Builder.mesh` averages them from the
 * triangles, which is both smaller here and smoother there.
 */

import { indices, positions } from "./bedsit-mesh-decode";

/** the box the vertices occupy, in the piece's own frame — what a chart laid
 *  over this mesh measures itself against */
export const BOX = {
  lo: [-35.0, -1143.5, 0.0] as const,
  hi: [80.0, 1143.5, 3450.0] as const,
};

/** base64 of the packed vertices, then of the triangle indices */
const PACKED = "AADKEAAAAAAAAAAAAAAAAP//AADKEN70///KEN70//8AAP////8AAAAA///KEAAAAAA17wAAAAD//wAAAAD/////AAA17970//817970/////////////wAA//817wAAAADKEN70AAAAAP//AAD/////AAA17970//817970//////////8AAP/////KEN70";
const INDEX = "AAABAAIAAAACAAMABAAFAAYABAAGAAcAAAABAAYAAAAGAAcAAQACAAUAAQAFAAYAAgADAAQAAgAEAAUAAwAAAAcAAwAHAAQACAAJAAoACAAKAAsADAANAA4ADAAOAA8ACAAJAA4ACAAOAA8ACQAKAA0ACQANAA4ACgALAAwACgAMAA0ACwAIAA8ACwAPAAwAEAARABIAEAASABMAFAAVABYAFAAWABcAEAARABYAEAAWABcAEQASABUAEQAVABYAEgATABQAEgAUABUAEwAQABcAEwAXABQA";

export const POSITION = positions(PACKED, BOX);
export const INDICES = indices(INDEX);
