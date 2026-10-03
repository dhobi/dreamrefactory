import type { DecodedAudio } from "@dreamfactory/engine/df/audio";

/** 16-bit mono PCM — the same WAV taoot/tools/dumpaudio.ts writes */
export function wavBlob(audio: DecodedAudio): Blob {
  const n = audio.samples.length;
  const out = new Uint8Array(44 + n * 2);
  const v = new DataView(out.buffer);
  const ascii = (off: number, s: string): void => {
    for (let i = 0; i < s.length; i++) out[off + i] = s.charCodeAt(i);
  };
  ascii(0, "RIFF");
  v.setUint32(4, 36 + n * 2, true);
  ascii(8, "WAVEfmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, audio.sampleRate, true);
  v.setUint32(28, audio.sampleRate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  ascii(36, "data");
  v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) {
    v.setInt16(44 + i * 2, Math.max(-32768, Math.min(32767, Math.round(audio.samples[i] * 32767))), true);
  }
  return new Blob([out.buffer as ArrayBuffer], { type: "audio/wav" });
}
