/**
 * futilityboards: an imported mesh, baked by `taoot/bedsit/tools/bedsitglb.ts`. Do not edit —
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
  lo: [-150.0, -120.0, 0.0] as const,
  hi: [150.0, 120.0, 38.0] as const,
};

/** base64 of the packed vertices, then of the triangle indices */
const PACKED = "///RBW4b///wAbdNAADRBW4bAADwAbdN//8AAHl+AAAAAHl+AADwAcKw///wAcKwAADRBYXh///RBYXh///RBW4bLvqjCwAg///wAbdNLvqyCT1P//8AAHl+LvqyCXl+///wAcKwLvqyCbatLvqyCXne///RBYXhAADRBW4bAADwAbdN4QOjCwAg4QPRBT1PAAAAAHl+4QPRBXl+AADwAcKw4QPRBbat4QOyCXneAADRBYXhAADRBYXhAADCB1T1AADggwvjAACjC/P8AAD/////AAD//5Hk///RBW4b///CB6sK///gg/Qc//+TDQAA/////wwD/////3oe///RBYXh/////5Hk///CB1T1//+jC/P8////////AADRBW4bAAD//3oeAADCB6sKAACTDQAAAAD//wwDLvoe/IXh/////5HkLvrgg//fLvqyCXne///RBYXhAAD//5Hk4QMe/IXhAADggwvjAADRBYXh4QOyCXneAADRBYXh///RBYXhAADCB1T1///CB1T1/////5HkAAD//5Hk////////AAD/////AACTDQAA//+TDQAAAADCB6sK///CB6sKAADRBW4bAADCB6sK///RBW4b///CB6sK/////3oe/////wwDAAD//3oeAAD//wwD/////5HkLvoe/IXhAAD//5Hk4QMe/IXhAACTDQAAAAD//wwD//+TDQAA/////wwD///RBW4b///gg/Qc/////3oe4QOjCwAg4QPgg4Yh4QMe/Awj";
const INDEX = "AAABAAIAAgABAAMAAQAEAAMAAwAEAAUABQAEAAYABAAHAAYABgAHAAgABwAJAAgACgALAAwACwANAAwADAANAA4ADQAPAA4ADgAPABAADwARABAAEQASABAAEAASABMAFAAVABYAFgAVABcAFQAYABcAFwAYABkAGAAaABkAGQAaABsAGwAaABwAGgAdABwAHgAfACAAHwAhACAAIQAiACAAIAAiACMAJAAlACYAJQAnACYAJwAoACYAJgAoACkAKgArACwALAArAC0AKwAuAC0ALwAwADEAMQAwADIAMAAzADIANAA1ADYANgA1ADcANQA4ADcAOQA6ADsAOwA6ADwAOgA9ADwAPgA/AEAAPwBBAEAAQgBDAEQAQwBFAEQARgBHAEgARwBJAEgASgBLAEwASwBNAEwATgBPAFAATwBRAFAAUgBTAFQAUwBVAFQAVgBXAFgAVwBZAFgAWgBbAFwAXQBeAF8A";

export const POSITION = positions(PACKED, BOX);
export const INDICES = indices(INDEX);
