/**
 * watchglass: an imported mesh, baked by `taoot/tools/bedsitglb.ts`. Do not edit —
 * re-run the tool. In the room's own frame: +x is the back, y is the length
 * about 0, z is up from the floor, stretched to the measured
 * 164 x 159 x 84 the whole piece is known to be.
 *
 * 70 triangles, 44 vertices, positions quantized to 16 bits over
 * {@link BOX}. Normals are not stored: `Builder.mesh` averages them from the
 * triangles, which is both smaller here and smoother there.
 *
 * Texture coordinates ARE stored: they are the file's own, and nothing here
 * could work them out again.
 */

/** the box the vertices occupy, in the piece's own frame — what a chart laid
 *  over this mesh measures itself against */
export const BOX = {
  lo: [-74.2, -76.7, 58.6] as const,
  hi: [35.3, 32.5, 64.3] as const,
};

/** base64 of the packed vertices, then of the triangle indices */
const PACKED = "QfYETwAA//8AgAAAvusAgL2OiuM7qb2OwI4pynjV3r4CqnjVL8wvzL2OiuPEVr2OKco/cXjVQfb7sAAAgtqC2gAA/VXevnjV/3++672OO6mK472O+7BB9gAA1jXAjnnV0DMvzL2OxFaK472O/3///wAABE9B9gAAIUH9VXnVQRQAgL2OdRw7qb2OfSWC2gAAvgn7sAAAAAAAgAAAP3HWNXjV0DPQM72OdRzEVr2OvgkETwAAAqohQXjV/39BFL2OxFZ1HL2OfSV9JQAABE++CQAA/38AAAAAL8zQM72OO6l1HL2O+7C+CQAAgtp9JQAAK4b4YP//+GDUecr/1HkHn///B58rhsr/";
const INDEX = "AAABAAIAAwACAAEABAAFAAYABwACAAgABQADAAYAAwAJAAoACwAEAAwADQAGAAoABAANAAwADAANAA4ADwALABAAEQAMABIACwARABAAEAARABMAFAAPABUAFgAQABcADwAWABUAFgAYABkAGgAUABsAHAAVABkAFAAcABsAGwAcAB0AHgAaAB8AIAAbACEAGgAgAB8AIAAiACMACAAeACQAJQAfACMAHgAlACQAJQAmACcAJAAnAAAABQAIAAIAGgAoACkACwAqAAQAHgAIACsAFAApAA8AHgAoABoABAAqACsACwAPACkABQArAAgAKAArACoAAAACAAcAAwABAAkABAAGAA0AAwAKAAYACwAMABEADQAKAA4ADAAOABIADwAQABYAEQASABMAEAATABcAFAAVABwAFgAXABgAFgAZABUAGgAbACAAHAAZAB0AGwAdACEAHgAfACUAIAAhACIAIAAjAB8ACAAkAAcAJQAjACYAJQAnACQAJAAAAAcABQACAAMAGgApABQAHgArACgABAArAAUACwApACoAKAAqACkA";
/** and of the texture coordinates the file came with, over [0, 1] */
const TEXCOORD = "yvvzQx31ujPc7uY3iuSPLbDFcDTE2XM0Ctf0J3P0Z0X056lCtehSJ3/YmSB6t6FC7LqILW7I8yf1xpggd7e2VvuqXEWWsNw3v7ZNJ1iqszOoxetkkLB6Yfqq+FOgo+dDn6NxVVSqpmW82e1kY8hqceO6z2u6tg1y8ee9Vn/k1mv+1mtx7sbFeHfYxnis6BFyb/QDVNXugmES9axlyvt5VXXXclTzx29U9sfsRHnX70Q=";

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

/** the atlas coordinates, one pair a vertex — pass to `Builder.mesh` and it
 *  uses these instead of box-mapping the material it is drawn in */
const texel = bytes(TEXCOORD);
export const UV = new Float32Array(texel.length);
for (let i = 0; i < texel.length; i++) UV[i] = texel[i] / 65535;
