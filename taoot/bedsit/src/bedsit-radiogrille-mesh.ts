/**
 * radiogrille: an imported mesh, baked by `taoot/tools/bedsitglb.ts`. Do not edit —
 * re-run the tool. In the room's own frame: +x is the back, y is the length
 * about 0, z is up from the floor, stretched to the measured
 * 440 x 300 x 920 the whole piece is known to be.
 *
 * 173 triangles, 104 vertices, positions quantized to 16 bits over
 * {@link BOX}. Normals are not stored: `Builder.mesh` averages them from the
 * triangles, which is both smaller here and smoother there.
 */

/** the box the vertices occupy, in the piece's own frame — what a chart laid
 *  over this mesh measures itself against */
export const BOX = {
  lo: [-123.9, -121.8, 79.1] as const,
  hi: [-118.5, 121.8, 412.0] as const,
};

/** base64 of the packed vertices, then of the triangle indices */
const PACKED = "//8r/eFkooup6K57/////6576KIg5QZp//9j9QFMXXQs4ExUueip6Ec36KLr1VVCuegK2O4joosSx4M0dNEuwxwWXXTdtxMo6KL3rawJXXQ/pyoh6KLOliUEF13FlEIa6KJlgAAAXXSMgeAY6KITasQCXXTgbUIadNH6U0sIF13+XGceueh3PFkTXXSrS7EmuegEKckfoosMO14wuegLGCEz6KKdLWw7uejnCT5JoovlJnpGooseH61V///UArxgoot1GUNm//8AAK57oosLGEx6uehqAd2TXXTAGEOMuejHB1uriy7CO657iy53PFFxiy5aQOFkiy64RtNZAABjUsVOiy7RXHpGRhe5afNAAABkdZE/AACbgs48Rhfwji8+AAAMm/NARhdPqHpGRheQssVORhfRvNNZRhfTwuFkRhfzxLNyRhcCxnJ+AACOf8F9RhcsPTGKoouUG1GXooseH+anuehjEijCRhelPwKYXXS5KRq3dNHTH9nVoos2MuzEdNEmMVzkRhfzRMGjRhdgTFuroouWPgzSLrouQ8zwXXTaTv7ZLrpWV774RhfsVfWyRhcAYN25F10dX0ni6KJgbJT90UUIcm7m6KJyg///AAAMa2S/AAACdtnCF12NhOPp6KKGnV78F12hlm7mLrpUtPH0RhdegTvERhfwjorDF10EqYbfdNFAytnoXXRXuuLWdNHu20TYiy6ymmS/Rhfkpo66oot8yHPKuejn7IrDoosI0mS/Rhe7r+Kwiy78uZeo6KJY3USy//+i+Vuroou246+h//+V/o6URhdawP6giy49xKCWiy5dxuGKooup6FaO";
const INDEX = "AAABAAIAAAADAAEAAAAEAAMABAAFAAMABAAGAAUABgAHAAUABgAIAAcACAAJAAcACAAKAAkACgALAAkACgAMAAsADAANAAsADAAOAA0ADgAPAA0ADgAQAA8AEAARAA8AEAASABEAEgATABEAEgAUABMAFAAVABMAFAAWABUAFgAXABUAFgAYABcAGAAZABcAGAAaABkAGgAbABkAGgAcABsAHAAdABsAHAAeAB0AHAAfAB4AHwAgAB4AHwAhACAAIQAiACAAIQAjACIAIwAkACIAIwAlACQAJAAmACIAJgAnACIAJwAgACIAJwAoACAAKAAeACAAKAApAB4AKQAdAB4AKQAqAB0AKgAbAB0AKgAZABsAKgArABkAKwAXABkAKwAsABcALAAVABcALAAtABUALQATABUALQAuABMALgARABMALgAvABEALwAPABEALwAwAA8AMAANAA8AMAAxAA0AMQALAA0AMQAyAAsAMgAJAAsAMgAzAAkAMwAHAAkAMwA0AAcANAAFAAcANAA1AAUANQADAAUANQA2AAMANgABAAMANQA3ADYANQA0ADcANAAzADcAMwAyADcAMgAxADcAMQAwADcAMAAvADcALwAuADcALgAtADcALQAsADcALAArADcAKwAqADcAKgApADcAKQAoADcAKAAnADcAJwAmADcAJgA4ADcAJgAkADgAJAA5ADgAJAAlADkAJQA6ADkAOgA4ADkAJQA7ADoAOgA8ADgAPAA3ADgAOgA9ADwAOgA7AD0AOwA+AD0APgA/AD0APgBAAD8APwBBAD0AQQA8AD0AQQA3ADwAQQBCADcAQQA/AEIAPwBDAEIAPwBAAEMAQABEAEMARABFAEMARABGAEUARQBHAEMARwBCAEMARwA3AEIARwBIADcARwBFAEgARQBJAEgARQBGAEkARgBKAEkASgBLAEkASgBMAEsASwBNAEkATQBIAEkATQA3AEgATQBOADcATQBLAE4ASwBPAE4ASwBMAE8ATABQAE8AUABRAE8AUABSAFEAUQBTAE8AUwBOAE8AUwA3AE4AUwBUADcAUwBRAFQAUQBVAFQAUQBSAFUAUgBWAFUAVgBXAFUAVgBYAFcAVwBZAFUAWQBUAFUAWQA3AFQAWQBaADcAWQBXAFoAVwBbAFoAVwBYAFsAWABcAFsAXABdAFsAXQBeAFsAXgBaAFsAXgA3AFoAXgBfADcAXgBdAF8AXQBgAF8AXQBcAGAAXABhAGAAYQBiAGAAYQBjAGIAYgBkAGAAZABfAGAAZAA3AF8AZABlADcAZABiAGUAZQBmADcAZgA2ADcAZgABADYAZgBnAAEAZgBlAGcAZQBiAGcAYgBjAGcAYwACAGcAAgABAGcA";

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
