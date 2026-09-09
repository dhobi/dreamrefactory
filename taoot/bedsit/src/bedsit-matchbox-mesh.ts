/**
 * matchbox: an imported mesh, baked by `taoot/tools/bedsitglb.ts`. Do not edit —
 * re-run the tool. In the room's own frame: +x is the back, y is the length
 * about 0, z is up from the floor, stretched to the measured
 * 119 x 82 x 24 the whole piece is known to be.
 *
 * 202 triangles, 224 vertices, positions quantized to 16 bits over
 * {@link BOX}. Normals are not stored: `Builder.mesh` averages them from the
 * triangles, which is both smaller here and smoother there.
 *
 * Texture coordinates ARE stored: they are the file's own, and nothing here
 * could work them out again.
 */

/** the box the vertices occupy, in the piece's own frame — what a chart laid
 *  over this mesh measures itself against */
export const BOX = {
  lo: [-41.0, -59.5, 0.0] as const,
  hi: [41.0, 59.5, 24.0] as const,
};

/** base64 of the packed vertices, then of the triangle indices */
const PACKED = "xQBfAAAAxQAAAC0CAABfAC0CxQBfAP//AABfANL9xQAAANL9Ov9fAAAA//9fAC0COv8AAC0COv9fAP//Ov8AANL9//9fANL9xQAAAC0COv8AANL9xQAAANL9Ov8AAC0CxQDru///Ov/ru///5vtKvH8I3AFKvC0CGQRKvH8II/5KvC0CAADruy0CAABfANL9AADru9L9AABfAC0CN/zru9kMN/wkRibzN/zruybzN/wkRtkMjQTru6wKcvskRqwKcvvru6wKjQQkRqwK//9fAC0C///ru9L9//9fANL9///ruy0Ccvvru1P1jQQkRlP1jQTru1P1cvskRlP1Ov/ruwAAxQDruwAAAgNKvJMLxQBKvL76AgNKvGz0xQBKvEEFGQRKvID3I/5KvNL95vtKvID33AFKvNL9/fxKvGz0Ov9KvEEF/fxKvJMLOv9KvL76yAPru9kMGQRKvH8IAgNKvJMLjQTru6wKyAPruybzGQRKvID3jQTru1P1AgNKvGz05vtKvH8Icvvru6wK/fxKvJML5vtKvID3/fxKvGz0cvvru1P1xQBKvEEF3AFKvC0CAADruy0CxQDru///3AFKvNL9AADru9L9Ov9KvL76I/5KvNL9///ru9L9Ov9KvEEF///ruy0CI/5KvC0CAADruy0CAABfAC0CAABfANL9Ov8AAC0COv8AANL9///ruy0C///ru9L93AFKvNL9cvvru6wKjQTru6wKjQTru1P1cvvru1P1yAMkRtkMyAPruybzyAMkRibzyAMkRibzXftHStkMmPrpSdkMmPpHSqwK7QJHStkMswNHSqwKswPpSdkMXfug/9kMmPqg/6wKmPr//9kM7QKg/9kMswP//9kMswOg/6wK8wf9TNQc8wdcTacaLgdcTdQcV/b9TNQcHPdcTdQcV/ZcTaca8wfq/NQcLgeM/NQc8weM/KcaV/bq/NQcV/aM/KcaHPeM/NQcmPpHSqwKswOg/6wKmPqg/6wKswNHSqwKV/bq/Cbz8wfq/Cbz8wf9TCbzV/b9TCbzswPpSdkMmPrpSSbzswPpSSbzmPrpSdkM7QKg/ybz7QJHSibzswP//9kMmPr//ybzmPr//9kMswP//ybzHPdcTSbzHPeM/NQcHPdcTdQcHPeM/Cbz8wdcTacaV/aM/Kca8weM/KcaV/ZcTacasvafTFP1XQRHSlP17vlHSlP1mAefTFP1LgeM/CbzLgdcTdQcLgeM/NQcLgdcTSbzmAdJ/VP17vmg/1P1XQSg/1P1svZJ/VP1aQYaTVP1swPF/lP1swMjS1P1aQbO/FP14vfO/FP1mPojS1P1mPrF/lP14vcaTVP14vcaTVP1HPdcTSbzsvafTFP1aQYaTVP1mAefTFP1LgdcTSbz4vfO/FP1svZJ/VP1HPeM/CbzaQbO/FP1LgeM/CbzmAdJ/VP1XQRHSlP1swMjS1P1swPpSSbzXftHSibz7vlHSlP1mPrpSSbzmPojS1P1XQSg/1P1swP//ybzswPF/lP1Xfug/ybz7vmg/1P1mPrF/lP1mPr//ybzXftHSibzXftHStkMswPpSdkMmPrpSdkMmPrpSSbzswPpSSbzswOg/6wKmPqg/6wK7vmg/1P1XQSg/1P17QKg/9kM7QJHStkMXftHStkMXfug/9kM7QJHSibz7QKg/ybzV/bq/Cbz8wfq/CbzHPdcTSbzHPeM/CbzaQYaTVP1aQbO/FP1V/b9TNQc8wf9TNQcV/ZcTacaV/aM/KcaLgdcTdQcLgeM/NQcV/b9TCbzV/b9TNQc";
const INDEX = "AAABAAIAAwAEAAUABgAHAAgACQAKAAsADAANAA4ADAAPAA0ACQAQAAMACQARABAAEgATABQAEgAVABMAFgAXABgAFgAZABcAGgAbABwAGgAdABsAHgAfACAAHgAhAB8AIgAjACQAIgAlACMAJgAnACgAJgApACcAAAAqAAYAAAArACoALAAtAC4ALAAvAC0AMAAxADIAMAAzADEANAA1ADYANAA3ADUAOAA5ADoAOAA7ADkAPAA9AD4APAA/AD0AGgBAAEEAGgBCAEAAHABDAEQAHABFAEMAKwBGAEcAKwBIAEYALQBJAEoALQBLAEkAEQBMAE0AEQBOAEwAKgBPAFAAKgBRAE8AAAAWACsAAAAZABYALwBLAC0ALwBSAEsAEAAXAAMAEAAYABcADgBTAAwADgBUAFMABgABAAAABgAIAAEAAwAKAAkAAwAFAAoAJABVACIAJABWAFUAKgAHAAYAKgBQAAcACQAjABEACQAkACMANwBXADUANwBYAFcAKwBRACoAKwBHAFEAEQBZABAAEQBNAFkAOAA/ADwAOAA6AD8AHABCABoAHABEAEIAFABaABIAFABbAFoAMgBcADAAMgBdAFwAEwAsABQAEwAvACwAMAAtADMAMAAuAC0AMQA0ADIAMQA3ADQAEgA1ABUAEgA2ADUAGgAfAB0AGgAgAB8AXgAeADgAXgAhAB4AJwBfACgAJwBgAF8AGwAmABwAGwApACYAPABeADgAPABhAF4AYgBjAGQAZQBmAGcAaABpAGoAawBsAG0AbgBvAHAAcQByAHMAdAB1AHYAdwB4AHkAegB7AHwAegB9AHsAfgB0AHcAfgB/AHQAgABxAG4AgACBAHEAggCDAIQAggCFAIMAZQCGAGsAZQCHAIYAiACJAIoAiACLAIkAjACNAI4AjACPAI0AkACRAJIAkACTAJEAlACVAJYAlACXAJUAmACZAJoAmACbAJkAnACdAJ4AnACfAJ0AoAChAKIAoACjAKEApAClAKYApACnAKUAgQCoAKkAgQCqAKgAgACrAKwAgACtAKsAfgCuAK8AfgCwAK4AfwCxALIAfwCzALEAhwC0ALUAhwC2ALQAtwC4ALkAtwC6ALgAhgC7ALwAhgC9ALsAvgC/AMAAvgDBAL8AhQDCAIMAhQDDAMIAhABlAIIAhACHAGUAegDEAH0AegDFAMQAlQDGAJYAlQDHAMYAaACJAL4AaACKAIkAhgCIAGsAhgCLAIgAigDIAIgAigDJAMgAiwDKAIkAiwDLAMoAfQDMAHsAfQDNAMwAfADOAHoAfADPAM4AvgC6ALcAvgDAALoAoQDQAKIAoQDRANAAgACqAIEAgACsAKoAnADSAJ8AnADTANIApADUAKcApADVANQAmADWAJsAmADXANYAlgCnAJQAlgClAKcAlwCiAJUAlwCgAKIAngCjAJwAngChAKMAnwCmAJ0AnwCkAKYAkADYAJMAkADZANgAdAB4AHcAdAB2AHgAjQDaAI4AjQDbANoAkgDcAJAAkgDdANwAmwBuAJkAmwCAAG4AmgB/AJgAmgB0AH8AdwCPAH4AdwCNAI8AjgDeAIwAjgDfAN4AtwBoAL4AtwBiAGgA";
/** and of the texture coordinates the file came with, over [0, 1] */
const TEXCOORD = "JFmnY1FZp2MkWXpjJFm+TiRZ605RWb5OJFlYnSRZhZ1RWVidJFkNFVFZDRUkWeAUj94w01rKf5layjDTj95/mX4Avk5+AA0VzMin0FrJv5nMyEmaWskw0X4ATWMkWRhPfgAYTyRZTWMgWlFLzJHSOCBa0jjMkVFLIFqlg8yRqksgWqpLzJGlgyRZfgB+ALQUJFm0FH4AfgAgWng4zJF+ACBafgDMkXg4fgBYnX4Ap2OKyAyayrSYmVi1IZoYyYKZF7Vemoi0RtEXtbzQiLTVmVi1+dAYyW7Risjl0Mq0g9EgWv6D81nRg/NZ5IMgWtGDIFp9lvNZqpYgWqqW81mXlvNZfUsgWn1L81lrS/NZpTjzWbg4IFqlOFEAp2NRAOZjfgB6Y3C0gJmrtLmZhrRpmVEADRVRAEwVfgDgFFEAWJ1+AIWdUQAZnVzJU5mP3l3TWspd01FZfgBRWbQUXMmd0Ya0s9FRAH9Om8iK0JvIZ5pHtXuaSLWe0MyR/oMgWlEAzJFRAMyRfZaWknkAlpJRAG6SeQCWkgTNbpIEzZaSLM2WklZNbpJWTZaSfk2WkiiAlpL/f26SKIAepPAw9qPwMB6kGDEepHkAHqRRAPajeQAepNF7HqSoe/aj0XsepEes9qNHrB6kcKyx5nkAgLRWTbHmVk2AtHkAjbNHrI2z0XuNs/AwjbN5AJaSVM0so4b/LKNUzZaShv8soyiALKMEzZaS138so6ZNlpKmTSyj13+Ns9j2HqSYrB6k2PaNs5isgLSImPfkSE6AtEhO9+SImCBbqZi6kGiYSlp8l+SPjZmNs4B7HqRAMR6kgHuNs0Ax44+X3Upa2N26kMTeIFuz3CmQuZndkGre3ZDDmCmQbt3aWofcJlrWlyZafd3aWtKYtbNRAI2zUQC1s2cAtbMYMbWzAzGNsxgxtbNwrLWzWqyNs3CstbOoe42zqHu1s757VKMEzVSjp8wsoyzNLKN5AFSjeQAso1EAVKPWAFSjKIAso/9/VKOFgCyjVk1Uo1ZNVKP5TCyjfk0so67/lpKu/4C0UQCx5lEAH1pNl+SQOphuktd/bpKmTVSjyE1Uo7V/WLRWTVi0eQDZ5nkA2eZWTRCRYJgQkc/eOVuE3MqPaN0OW/yYDVtf3LWzJDG1s5x79+SwmIC0sJj2o9j29qOYrFi0iJhYtEhOjbMA9x6kAPc=";

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
