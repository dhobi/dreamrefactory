/**
 * sofafeet: an imported mesh, baked by `taoot/tools/bedsitglb.ts`. Do not edit —
 * re-run the tool. In the room's own frame: +x is the back, y is the length
 * about 0, z is up from the floor, stretched to the measured
 * 3050 x 1150 x 1750 the whole piece is known to be.
 *
 * 100 triangles, 58 vertices, positions quantized to 16 bits over
 * {@link BOX}. Normals are not stored: `Builder.mesh` averages them from the
 * triangles, which is both smaller here and smoother there.
 */

/** the box the vertices occupy, in the piece's own frame — what a chart laid
 *  over this mesh measures itself against */
export const BOX = {
  lo: [-568.7, -1245.0, 0.0] as const,
  hi: [448.3, 1251.0, 162.9] as const,
};

/** base64 of the packed vertices, then of the triangle indices */
const PACKED = "AACc9egLmAH/9P///QPG/gv6/QPG/twRJw///xf0wwwO+Gr6hRlj/xf08w9j/+gLJw+58OgL/QMq89wRMQOO8v//Ww5V8Qv6URpV8dwRhRlV8Qv6URpj/+gLJw8AANwRhRmcANwRhRmcABf0URoODtwRuRgODhf0Ww6qDgv6Jw+qDugLMQM5AegLWw4AABf0kAytBy/4MQPVDAv6mAFjCv///QM5ARf0zADHCfQFMQPVDOgLOff///QF0vj//y/o//8q/iPuEuhj//QFEepj/yPubPcO+Nvx3uhV8Rf0RudV8fQFOfdV8fQFnvlV8SPuZ/6O8hf0m/2O8ugLm/0q/ugL//+c9S/o0vicACPuOfcAAOgL//85ASPueOicAOgLm/05AQAAbfaqDvQFAvxxDegLM/9jCiPuLPfZB+HuEeqcAC/orOcODugLq+kODiPuBfiqDiPuZ/5xDSPu";
const INDEX = "AAABAAIAAgADAAAAAgAEAAMAAgAFAAQAAgABAAUABQAGAAQABgAHAAQABwADAAQABwAIAAMACAAAAAMACAAJAAAACQABAAAACQAKAAEACQAIAAoACgAFAAEACAALAAoACwAFAAoACAAMAAsACAAHAAwADAANAAsADQAFAAsADQAGAAUADQAOAAYADQAMAA4ADgAHAAYADgAMAAcADwAQABEADwASABAAEAATABEAEAASABMAEgAUABMAEgAVABQAEgAPABUADwAWABUADwAXABYADwARABcAEQAYABcAEQATABgAEwAUABgAFAAZABgAFAAVABkAGQAaABgAGgAbABgAGwAXABgAGwAWABcAGwAcABYAGwAaABwAHAAVABYAGgAdABwAHQAVABwAGgAZAB0AGQAVAB0AHgAfACAAHgAhAB8AIQAiAB8AIgAjAB8AIwAgAB8AIgAkACMAIgAlACQAIgAhACUAIQAmACUAJgAkACUAIQAeACYAJgAnACQAJwAjACQAJwAoACMAJwApACgAJwAmACkAJgAqACkAJgAeACoAKgAoACkAHgAgACoAKgArACgAKgAgACsAIAAjACsAIwAoACsALAAtAC4ALAAvAC0ALQAwAC4ALwAxAC0AMQAwAC0AMQAyADAAMgAzADAAMwAuADAAMwA0AC4ANAAsAC4ANAA1ACwANQAvACwANQA2AC8ANgAxAC8ANQA3ADYANwAxADYANQA0ADcANwA4ADEANwA0ADgAOAAyADEAOAA5ADIAOAA0ADkAOQAzADIAOQA0ADMA";

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
