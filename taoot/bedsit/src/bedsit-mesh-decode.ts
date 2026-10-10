/**
 * Unpacking for the baked meshes (`bedsit-*-mesh.ts`, written by
 * `taoot/bedsit/tools/bedsitglb.ts`). The tool emits the packed data and these
 * calls; the decoding lives here once rather than in every module it writes.
 */

/** base64 of little-endian 16-bit values, as the tool packs them */
function bytes(s: string): Uint16Array {
  const bin = atob(s), n = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) n[i] = bin.charCodeAt(i);
  return new Uint16Array(n.buffer);
}

/** the positions, each 16-bit value spread back over its axis of `box` */
export function positions(s: string, box: { lo: readonly number[]; hi: readonly number[] }): Float32Array {
  const packed = bytes(s);
  const out = new Float32Array(packed.length);
  for (let i = 0; i < packed.length; i += 3) {
    for (let c = 0; c < 3; c++) out[i + c] = box.lo[c] + (packed[i + c] / 65535) * (box.hi[c] - box.lo[c]);
  }
  return out;
}

/** the triangle indices, as they were packed */
export const indices = bytes;

/** texture coordinates, packed over [0, 1] */
export function texels(s: string): Float32Array {
  const texel = bytes(s);
  const out = new Float32Array(texel.length);
  for (let i = 0; i < texel.length; i++) out[i] = texel[i] / 65535;
  return out;
}
