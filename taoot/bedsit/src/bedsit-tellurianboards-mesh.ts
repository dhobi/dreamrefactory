/**
 * tellurianboards: an imported mesh, baked by `taoot/tools/bedsitglb.ts`. Do not edit —
 * re-run the tool. In the room's own frame: +x is the back, y is the length
 * about 0, z is up from the floor, stretched to the measured
 * 1 x 1 x 1 the whole piece is known to be.
 *
 * 60 triangles, 96 vertices, positions quantized to 16 bits over
 * {@link BOX}. Normals are not stored: `Builder.mesh` averages them from the
 * triangles, which is both smaller here and smoother there.
 */

/** the box the vertices occupy, in the piece's own frame — what a chart laid
 *  over this mesh measures itself against */
export const BOX = {
  lo: [-150.0, -210.0, 0.0] as const,
  hi: [150.0, 210.0, 45.0] as const,
};

/** base64 of the packed vertices, then of the triangle indices */
const PACKED = "Lvr//24bD/7//7dNLvoAAG4bD/4AALdN/////3l+//8AAHl+D/4AAMKwD/7//8KwLvoAAIXhLvr//4XhLvr//24bXPQu+gAgD/7//7dNTfYu+j1P/////3l+TfYu+nl+D/7//8KwTfYu+ratTfYu+nneLvr//4XhLvoAAG4bD/4AALdNXPThAwAgLvrhAz1P//8AAHl+LvrhA3l+D/4AAMKwLvrhA7atTfbhA3neLvoAAIXhLvoAAIXhPfgAAFT1H3wAAAvjXPQAAPP8AAAAAP//AAAAAJHkLvr//24bPfj//6sKH3z///QcbPL//wAAAAD//wwDAAD//3oeLvr//4XhAAD//5HkPfj//1T1XPT///P8AAD/////LvoAAG4bAAAAAHoePfgAAKsKbPIAAAAAAAAAAAwD4QMu+oXhAAD//5HkH3wu+v/fTfYu+nneLvr//4XhAAAAAJHk4QPhA4XhH3wAAAvjLvoAAIXhTfbhA3neLvoAAIXhLvr//4XhPfgAAFT1Pfj//1T1AAD//5HkAAAAAJHkAAD/////AAAAAP//bPIAAAAAbPL//wAAPfgAAKsKPfj//6sKLvoAAG4bPfgAAKsKLvr//24bPfj//6sKAAD//3oeAAD//wwDAAAAAHoeAAAAAAwDAAD//5Hk4QMu+oXhAAAAAJHk4QPhA4XhbPIAAAAAAAAAAAwDbPL//wAAAAD//wwDLvr//24bH3z///QcAAD//3oeXPThAwAgH3zhA4Yh4QPhAwwj";
const INDEX = "AAABAAIAAgABAAMAAQAEAAMAAwAEAAUABQAEAAYABAAHAAYABgAHAAgABwAJAAgACgALAAwACwANAAwADAANAA4ADQAPAA4ADgAPABAADwARABAAEQASABAAEAASABMAFAAVABYAFgAVABcAFQAYABcAFwAYABkAGAAaABkAGQAaABsAGwAaABwAGgAdABwAHgAfACAAHwAhACAAIQAiACAAIAAiACMAJAAlACYAJQAnACYAJwAoACYAJgAoACkAKgArACwALAArAC0AKwAuAC0ALwAwADEAMQAwADIAMAAzADIANAA1ADYANgA1ADcANQA4ADcAOQA6ADsAOwA6ADwAOgA9ADwAPgA/AEAAPwBBAEAAQgBDAEQAQwBFAEQARgBHAEgARwBJAEgASgBLAEwASwBNAEwATgBPAFAATwBRAFAAUgBTAFQAUwBVAFQAVgBXAFgAVwBZAFgAWgBbAFwAXQBeAF8A";

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
