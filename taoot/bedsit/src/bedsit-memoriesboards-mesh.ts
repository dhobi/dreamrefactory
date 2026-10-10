/**
 * memoriesboards: an imported mesh, baked by `taoot/bedsit/tools/bedsitglb.ts`. Do not edit —
 * re-run the tool. In the room's own frame: +x is the back, y is the length
 * about 0, z is up from the floor, stretched to the measured
 * 1 x 1 x 1 the whole piece is known to be.
 *
 * 60 triangles, 96 vertices, positions quantized to 16 bits over
 * {@link BOX}. Normals are not stored: `Builder.mesh` averages them from the
 * triangles, which is both smaller here and smoother there.
 */

import { indices, positions } from "./bedsit-mesh-decode";

/** the box the vertices occupy, in the piece's own frame — what a chart laid
 *  over this mesh measures itself against */
export const BOX = {
  lo: [-345.0, 0.0, 0.0] as const,
  hi: [345.0, 245.8, 549.1] as const,
};

/** base64 of the packed vertices, then of the triangle indices */
const PACKED = "0QXcCyX08AGZIcH20QUtnWwB8AHqsgcEAACuNkj5AAD/x48G8AG93SoJ8AFsTOP70QXS8rEL0QWBYWr+0QXcCyX0owsjEd7u8AGZIcH2sgmQJVHxAACuNkj5sgn8OcTz8AFsTOP7sgloTjf2sgl9Y7740QWBYWr+0QUtnWwB8AHqsgcEowvznFYF0QVfsckHAAD/x48G0QXMxTwK8AG93SoJ0QU42q8MsglN7zYP0QXS8rEL0QXS8rELwgdi+7gM4IN788YLowuu/h0N/////0YN//8j9NoL0QXcCyX0wgedBEfz4IOEDDn0kw0AALny//9RAeLy//8tDU700QWBYWr+///SYpP+wgcRanH/owtdbdf///+ubv//0QUtnWwB//9+npUBwgfulY4Akw1RkQAA//+ikigAHvzOZOb4///SYpP+4IMmZNL4sgl9Y7740QWBYWr+//8j9NoLHvye8F8P4IN788YL0QXS8rELsglN7zYP0QXS8rEL0QWBYWr+wgdi+7gMwgcRanH////SYpP+//8j9NoL//+ubv///////0YNkw1RkQAAkw0AALnywgfulY4AwgedBEfz0QUtnWwBwgfulY4A0QXcCyX0wgedBEfz//8tDU70//9RAeLy//9+npUB//+ikigA///SYpP+HvzOZOb4//8j9NoLHvye8F8Pkw1RkQAA//+ikigAkw0AALny//9RAeLy0QXcCyX04IOEDDn0//8tDU70owvznFYF4IOcnWoFHvxEnn8F";
const INDEX = "AAABAAIAAgABAAMAAQAEAAMAAwAEAAUABQAEAAYABAAHAAYABgAHAAgABwAJAAgACgALAAwACwANAAwADAANAA4ADQAPAA4ADgAPABAADwARABAAEQASABAAEAASABMAFAAVABYAFgAVABcAFQAYABcAFwAYABkAGAAaABkAGQAaABsAGwAaABwAGgAdABwAHgAfACAAHwAhACAAIQAiACAAIAAiACMAJAAlACYAJQAnACYAJwAoACYAJgAoACkAKgArACwALAArAC0AKwAuAC0ALwAwADEAMQAwADIAMAAzADIANAA1ADYANgA1ADcANQA4ADcAOQA6ADsAOwA6ADwAOgA9ADwAPgA/AEAAPwBBAEAAQgBDAEQAQwBFAEQARgBHAEgARwBJAEgASgBLAEwASwBNAEwATgBPAFAATwBRAFAAUgBTAFQAUwBVAFQAVgBXAFgAVwBZAFgAWgBbAFwAXQBeAF8A";

export const POSITION = positions(PACKED, BOX);
export const INDICES = indices(INDEX);
