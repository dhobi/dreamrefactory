/**
 * cupboardknobs: an imported mesh, baked by `taoot/tools/bedsitglb.ts`. Do not edit —
 * re-run the tool. In the room's own frame: +x is the back, y is the length
 * about 0, z is up from the floor, stretched to the measured
 * 732 x 76 x 103 the whole piece is known to be.
 *
 * 140 triangles, 82 vertices, positions quantized to 16 bits over
 * {@link BOX}. Normals are not stored: `Builder.mesh` averages them from the
 * triangles, which is both smaller here and smoother there.
 */

/** the box the vertices occupy, in the piece's own frame — what a chart laid
 *  over this mesh measures itself against */
export const BOX = {
  lo: [-230.0, -397.0, 2340.6] as const,
  hi: [-154.0, 335.0, 2443.4] as const,
};

/** base64 of the packed vertices, then of the triangle indices */
const PACKED = "///hGQCA//+LGEydXsM+GhamXsP6GwCA//8MFWivXsOyFaC9//+5EGivXsMTEKC9//86DUydXsOHCxam///kCwCAXsPLCQCA//86DbNiXsOHC+lZ//+5EJdQXsMTEF9C//8MFZdQXsOyFV9C//+LGLNiXsM+GulZQ3kqIhvPQ3nFJQCAQ3m4GP//Q3kNDf//Q3mbAxvPQ3kAAACAQ3mbA+QwQ3kNDQAAQ3m4GAAAQ3kqIuQwKC80Hpm6KC/gIACAKC81F9DeKC+QDtDeKC+RB5m6KC/lBACAKC+RB2ZFKC+QDi8hKC81Fy8hKC80HmZFAADjEgCA//8b9ACA///F8kydXsN49BamXsM09gCA//9G72ivXsPs76C9///z6mivXsNN6qC9//9050ydXsPB5Ram//8e5gCAXsMF5ACA//9057NiXsPB5elZ///z6pdQXsNN6l9C//9G75dQXsPs719C///F8rNiXsN49OlZQ3lk/BvPQ3n//wCAQ3ny8v//Q3lH5///Q3nV3RvPQ3k62gCAQ3nV3eQwQ3lH5wAAQ3ny8gAAQ3lk/OQwKC9u+Jm6KC8a+wCAKC9v8dDeKC/K6NDeKC/L4Zm6KC8f3wCAKC/L4WZFKC/K6C8hKC9v8S8hKC9u+GZFAAAc7QCA";
const INDEX = "AAABAAIAAAACAAMAAQAEAAUAAQAFAAIABAAGAAcABAAHAAUABgAIAAkABgAJAAcACAAKAAsACAALAAkACgAMAA0ACgANAAsADAAOAA8ADAAPAA0ADgAQABEADgARAA8AEAASABMAEAATABEAEgAAAAMAEgADABMAAwACABQAAwAUABUAAgAFABYAAgAWABQABQAHABcABQAXABYABwAJABgABwAYABcACQALABkACQAZABgACwANABoACwAaABkADQAPABsADQAbABoADwARABwADwAcABsAEQATAB0AEQAdABwAEwADABUAEwAVAB0AFQAUAB4AFQAeAB8AFAAWACAAFAAgAB4AFgAXACEAFgAhACAAFwAYACIAFwAiACEAGAAZACMAGAAjACIAGQAaACQAGQAkACMAGgAbACUAGgAlACQAGwAcACYAGwAmACUAHAAdACcAHAAnACYAHQAVAB8AHQAfACcAHwAeACgAHgAgACgAIAAhACgAIQAiACgAIgAjACgAIwAkACgAJAAlACgAJQAmACgAJgAnACgAJwAfACgAKQAqACsAKQArACwAKgAtAC4AKgAuACsALQAvADAALQAwAC4ALwAxADIALwAyADAAMQAzADQAMQA0ADIAMwA1ADYAMwA2ADQANQA3ADgANQA4ADYANwA5ADoANwA6ADgAOQA7ADwAOQA8ADoAOwApACwAOwAsADwALAArAD0ALAA9AD4AKwAuAD8AKwA/AD0ALgAwAEAALgBAAD8AMAAyAEEAMABBAEAAMgA0AEIAMgBCAEEANAA2AEMANABDAEIANgA4AEQANgBEAEMAOAA6AEUAOABFAEQAOgA8AEYAOgBGAEUAPAAsAD4APAA+AEYAPgA9AEcAPgBHAEgAPQA/AEkAPQBJAEcAPwBAAEoAPwBKAEkAQABBAEsAQABLAEoAQQBCAEwAQQBMAEsAQgBDAE0AQgBNAEwAQwBEAE4AQwBOAE0ARABFAE8ARABPAE4ARQBGAFAARQBQAE8ARgA+AEgARgBIAFAASABHAFEARwBJAFEASQBKAFEASgBLAFEASwBMAFEATABNAFEATQBOAFEATgBPAFEATwBQAFEAUABIAFEA";

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
