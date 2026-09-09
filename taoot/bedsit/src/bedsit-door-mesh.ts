/**
 * door: an imported mesh, baked by `taoot/tools/bedsitglb.ts`. Do not edit —
 * re-run the tool. In the room's own frame: +x is the back, y is the length
 * about 0, z is up from the floor, at the file's own coordinates taken as metres at 1549.375 units to one.
 *
 * 12 triangles, 8 vertices, positions quantized to 16 bits over
 * {@link BOX}. Normals are not stored: `Builder.mesh` averages them from the
 * triangles, which is both smaller here and smoother there.
 */

/** the box the vertices occupy, in the piece's own frame — what a chart laid
 *  over this mesh measures itself against */
export const BOX = {
  lo: [80.0, -993.5, 0.0] as const,
  hi: [150.0, 993.5, 3300.0] as const,
};

/** base64 of the packed vertices, then of the triangle indices */
const PACKED = "AAAAAAAA//8AAAAA/////wAAAAD//wAAAAD///////////////8AAP//AAAAAP//";
const INDEX = "AAABAAIAAAACAAMABAAFAAYABAAGAAcAAAAHAAYAAAAGAAEAAQAGAAUAAQAFAAIAAgAFAAQAAgAEAAMAAwAEAAcAAwAHAAAA";

function bytes(s: string): Uint16Array {
  const bin = atob(s), n = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) n[i] = bin.charCodeAt(i);
  return new Uint16Array(n.buffer);
}

const packed = bytes(PACKED);
export const POSITION = new Float32Array(packed.length);
for (let i = 0; i < packed.length; i += 3) {
  for (let c = 0; c < 3; c++) POSITION[i + c] = BOX.lo[c] + (packed[i + c] / 65535) * (BOX.hi[c] - BOX.lo[c]);
}
export const INDICES = bytes(INDEX);
