/**
 * deskpulls: an imported mesh, baked by `taoot/bedsit/tools/bedsitglb.ts`. Do not edit —
 * re-run the tool. In the room's own frame: +x is the back, y is the length
 * about 0, z is up from the floor, stretched to the measured
 * 2580 x 1110 x 1400 the whole piece is known to be.
 *
 * 60 triangles, 40 vertices, positions quantized to 16 bits over
 * {@link BOX}. Normals are not stored: `Builder.mesh` averages them from the
 * triangles, which is both smaller here and smoother there.
 */

import { indices, positions } from "./bedsit-mesh-decode";

/** the box the vertices occupy, in the piece's own frame — what a chart laid
 *  over this mesh measures itself against */
export const BOX = {
  lo: [-555.0, -929.0, 693.9] as const,
  hi: [-302.6, 969.3, 1299.9] as const,
};

/** base64 of the packed vertices, then of the triangle indices */
const PACKED = "IM9Xdvfq//+uiPfq//9XdvfqIM+uiPfqIM9Xdv////+uiP//IM+uiP////9Xdv//AAAAAAAALhpWEgAALhoAAAAAAABWEgAAAAAAAAgVLhpWEggVAABWEggVLhoAAAgVAAAAADCwLhpWEjCwLhoAADCwAABWEjCwAAAAADjFLhpWEjjFAABWEjjFLhoAADjFAACp7QAALhr//wAALhqp7QAAAAD//wAAAACp7QgVLhr//wgVAAD//wgVLhqp7QgVAACp7TCwLhr//zCwLhqp7TCwAAD//zCwAACp7TjFLhr//zjFAAD//zjFLhqp7TjF";
const INDEX = "AAABAAIAAAADAAEABAAFAAYABAAHAAUAAAAGAAMAAAAEAAYAAwAFAAEAAwAGAAUAAQAHAAIAAQAFAAcAAgAEAAAAAgAHAAQACAAJAAoACAALAAkADAANAA4ADAAPAA0ACAAOAAsACAAMAA4ACwANAAkACwAOAA0ACQAPAAoACQANAA8ACgAMAAgACgAPAAwAEAARABIAEAATABEAFAAVABYAFAAXABUAEAAWABMAEAAUABYAEwAVABEAEwAWABUAEQAXABIAEQAVABcAEgAUABAAEgAXABQAGAAZABoAGAAbABkAHAAdAB4AHAAfAB0AGAAeABsAGAAcAB4AGwAdABkAGwAeAB0AGQAfABoAGQAdAB8AGgAcABgAGgAfABwAIAAhACIAIAAjACEAJAAlACYAJAAnACUAIAAmACMAIAAkACYAIwAlACEAIwAmACUAIQAnACIAIQAlACcAIgAkACAAIgAnACQA";

export const POSITION = positions(PACKED, BOX);
export const INDICES = indices(INDEX);
