/**
 * desklampcap: an imported mesh, baked by `taoot/tools/bedsitglb.ts`. Do not edit —
 * re-run the tool. In the room's own frame: +x is the back, y is the length
 * about 0, z is up from the floor, stretched to the measured
 * 810 x 810 x 818 the whole piece is known to be.
 *
 * 72 triangles, 49 vertices, positions quantized to 16 bits over
 * {@link BOX}. Normals are not stored: `Builder.mesh` averages them from the
 * triangles, which is both smaller here and smoother there.
 */

/** the box the vertices occupy, in the piece's own frame — what a chart laid
 *  over this mesh measures itself against */
export const BOX = {
  lo: [-59.2, -59.2, 802.2] as const,
  hi: [59.2, 59.2, 818.0] as const,
};

/** base64 of the packed vertices, then of the triangle indices */
const PACKED = "AID//wAARJ+v9ODaIKGi+wAAAIDN+ODaZrye6ODa/7/Z7gAAa9Vr1eDagtqC2gAAnuhmvODa2e7/vwAAr/REn+DaovsgoQAAzfgAgODa//8AgAAAr/S7YODaovvfXgAAnuiZQ+Da2e4AQAAAa9WUKuDagtp9JQAAZrxhF+Da/78mEQAARJ9QC+DaIKFdBAAAAIAyB+DaAIAAAAAAu2BQC+Da315dBAAAmUNhF+DaAEAmEQAAlCqUKuDafSV9JQAAYReZQ+DaJhEAQAAAUAu7YODaXQTfXgAAMgf/f+DaAAD/fwAAUAtEn+DaXQQgoQAAYRdmvODaJhH/vwAAlCpr1eDafSWC2gAAmUOe6ODaAEDZ7gAAu2Cv9ODa316i+wAAAIAAgP//";
const INDEX = "AAABAAIAAAADAAEAAgAEAAUAAgABAAQABQAGAAcABQAEAAYABwAIAAkABwAGAAgACQAKAAsACQAIAAoACwAMAA0ACwAKAAwADQAOAA8ADQAMAA4ADwAQABEADwAOABAAEQASABMAEQAQABIAEwAUABUAEwASABQAFQAWABcAFQAUABYAFwAYABkAFwAWABgAGQAaABsAGQAYABoAGwAcAB0AGwAaABwAHQAeAB8AHQAcAB4AHwAgACEAHwAeACAAIQAiACMAIQAgACIAIwAkACUAIwAiACQAJQAmACcAJQAkACYAJwAoACkAJwAmACgAKQAqACsAKQAoACoAKwAsAC0AKwAqACwALQAuAC8ALQAsAC4ALwADAAAALwAuAAMAAwAwAAEAAQAwAAQABAAwAAYABgAwAAgACAAwAAoACgAwAAwADAAwAA4ADgAwABAAEAAwABIAEgAwABQAFAAwABYAFgAwABgAGAAwABoAGgAwABwAHAAwAB4AHgAwACAAIAAwACIAIgAwACQAJAAwACYAJgAwACgAKAAwACoAKgAwACwALAAwAC4ALgAwAAMA";

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
