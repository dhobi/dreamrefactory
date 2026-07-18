/**
 * Decode an audio bank (TRK/SFX/11K) and write WAVs + a waveform PNG.
 *
 *   npx tsx tools/dumpaudio.ts gamefiles/LOCAL/BEDRAD1.TRK out/
 *   npx tsx tools/dumpaudio.ts --find doorlocked        # scan all banks
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { join, basename } from "node:path";
import { readContainerFile } from "../src/df/container";
import { readAudioBank, decodeAudioContainer } from "../src/df/audio";
import { encodePNG } from "./png";

function wav(samples: Float32Array, sampleRate: number): Buffer {
  const buf = Buffer.alloc(44 + samples.length * 2);
  buf.write("RIFF", 0); buf.writeUInt32LE(36 + samples.length * 2, 4);
  buf.write("WAVEfmt ", 8); buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sampleRate, 24); buf.writeUInt32LE(sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write("data", 36); buf.writeUInt32LE(samples.length * 2, 40);
  for (let i = 0; i < samples.length; i++) {
    buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(samples[i] * 32767))), 44 + i * 2);
  }
  return buf;
}

function waveformPNG(samples: Float32Array, w = 800, h = 160): Buffer {
  const rgba = new Uint8ClampedArray(w * h * 4).fill(255);
  for (let i = 3; i < rgba.length; i += 4) rgba[i] = 255;
  for (let x = 0; x < w; x++) {
    const from = Math.floor((x / w) * samples.length);
    const to = Math.floor(((x + 1) / w) * samples.length);
    let lo = 1, hi = -1;
    for (let i = from; i < Math.max(to, from + 1); i++) {
      lo = Math.min(lo, samples[i]); hi = Math.max(hi, samples[i]);
    }
    const y0 = Math.round((1 - hi) * (h / 2)), y1 = Math.round((1 - lo) * (h / 2));
    for (let y = Math.max(0, y0); y <= Math.min(h - 1, y1); y++) {
      const p = (y * w + x) * 4; rgba[p] = 30; rgba[p + 1] = 60; rgba[p + 2] = 160;
    }
  }
  return encodePNG(rgba, w, h);
}

const args = process.argv.slice(2);

if (args[0] === "--find") {
  const needle = args[1].toLowerCase();
  for (const f of readdirSync("gamefiles/LOCAL")) {
    if (!/\.(TRK|SFX|11K)$/i.test(f)) continue;
    try {
      const file = readContainerFile(new Uint8Array(readFileSync(`gamefiles/LOCAL/${f}`)));
      const bank = readAudioBank(file);
      for (const key of bank.singles.keys()) {
        if (key.includes(needle)) console.log(`${f}: ${key}`);
      }
    } catch { /* not a bank */ }
  }
  process.exit(0);
}

const [path, outDir = "out"] = args;
mkdirSync(outDir, { recursive: true });
const file = readContainerFile(new Uint8Array(readFileSync(path)));
const bank = readAudioBank(file);
console.log(`track "${bank.trackName}": ${bank.loopChunks.length} loop chunk(s), ${bank.singles.size} single(s)`);

if (bank.loopChunks.length) {
  const parts = bank.loopChunks.map((loc) => decodeAudioContainer(file.containers[loc]));
  const total = parts.reduce((a, p) => a + p.samples.length, 0);
  const joined = new Float32Array(total);
  let off = 0;
  for (const p of parts) { joined.set(p.samples, off); off += p.samples.length; }
  const rate = Math.max(...parts.map((p) => p.sampleRate));
  writeFileSync(join(outDir, `${bank.trackName || basename(path)}_music.wav`), wav(joined, rate));
  writeFileSync(join(outDir, `music_waveform.png`), waveformPNG(joined));
  const rms = Math.sqrt(joined.reduce((a, s) => a + s * s, 0) / total);
  console.log(`music: ${(total / rate).toFixed(1)}s @${rate}Hz rms=${rms.toFixed(3)}`);
}
let dumped = 0;
for (const [key, ref] of bank.singles) {
  const a = decodeAudioContainer(file.containers[ref.containerLoc]);
  writeFileSync(join(outDir, `${key.replace(/[^\w.-]/g, "_")}.wav`), wav(a.samples, a.sampleRate));
  if (dumped === 0) writeFileSync(join(outDir, `single_waveform.png`), waveformPNG(a.samples));
  const rms = Math.sqrt(a.samples.reduce((s, v) => s + v * v, 0) / a.samples.length);
  console.log(`  ${key}: ${(a.samples.length / a.sampleRate).toFixed(2)}s @${a.sampleRate}Hz rms=${rms.toFixed(3)}`);
  if (++dumped >= 12) { console.log("  ..."); break; }
}
