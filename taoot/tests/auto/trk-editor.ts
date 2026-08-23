/**
 * Track-editor format layer — the write/edit half of the audio side of the DF
 * library that tracks.html (site/editors/track-editor.ts) is built on: the v41 encoder,
 * the sound-container writer, and the three bank patches (track name, chunk
 * identifier, loop order).
 *
 * Self-contained: works on a SYNTHESIZED bank built to the layout documented
 * in engine/src/df/banks.ts, so it runs without gamefiles/ — the editor must
 * round-trip user-supplied files, and these are the invariants that make that
 * safe (read → write is structure-preserving, an edit changes exactly its own
 * field, and a re-encoded chunk still decodes to the waveform it was given).
 */
import { test, expect } from "vitest";
import { Container, DFContainerFile, readContainerFile, writeContainerFile } from "@dreamfactory/engine/df/container";
import { decodeAudioContainer, encodeAudioContainer, encodeV41 } from "@dreamfactory/engine/df/audio";
import { buildBankFile } from "@dreamfactory/engine/df/banks-build";
import { i16, i32 } from "@dreamfactory/engine/df/build";
import {
  CHUNK_ID_FIELD,
  LOOP_ORDER_MAX,
  patchChunkIdentifier,
  patchLoopOrder,
  patchTrackName,
  readAudioBank,
  readBankTables,
} from "@dreamfactory/engine/df/banks";

// --- synthetic bank ---------------------------------------------------------

const RATE = 22050;

/** a deterministic tone: `freq` Hz at `amp`, with a slow fade so runs differ */
function tone(seconds: number, freq: number, amp = 0.8): Float32Array {
  const n = Math.round(seconds * RATE);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    out[i] = amp * Math.sin((2 * Math.PI * freq * i) / RATE) * (1 - (i / n) * 0.3);
  }
  return out;
}

/** full-scale pseudo-random noise — the case the delta modes cannot track */
function noise(seconds: number): Float32Array {
  const n = Math.round(seconds * RATE);
  const out = new Float32Array(n);
  let s = 12345;
  for (let i = 0; i < n; i++) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    out[i] = (s / 0x40000000 - 1) * 0.99;
  }
  return out;
}

interface TestBank {
  file: DFContainerFile;
  bytes: Uint8Array;
  /** the samples each audio container was built from, by container index */
  samples: Map<number, Float32Array>;
}

/**
 * A miniature but structurally complete TRK, built by the library's own writer
 * ({@link buildBankFile}): a name, three loop chunks played in the order 1-2-3-2
 * (a repeat, as shipped themes have), and two one-shots — one of them with the
 * subfolder prefix the real banks sometimes carry.
 *
 * The fields the format layer does not interpret are then filled with junk, so a
 * round trip that preserved them is distinguishable from one that zeroed them.
 */
function buildTestBank(): TestBank {
  const chunk = (identifier: string, samples: Float32Array) => ({
    identifier,
    audio: { sampleRate: RATE, samples },
  });
  const loops = [
    chunk("intro", tone(0.2, 220)),
    chunk("mainloop", tone(0.15, 330)),
    chunk("outro", tone(0.1, 165)),
  ];
  const singles = [chunk("doorlocked", tone(0.05, 880, 0.5)), chunk("sfx/creak", noise(0.03))];

  const { file, audioLocs } = buildBankFile({
    name: "OLDTUNE.WAV",
    loops,
    loopOrder: [1, 2, 3, 2],
    singles,
  });

  // junk in the unknown slots of both tables and of every record
  const [, c1, c2] = file.containers.map((c) => c.data);
  i32(c1, 0, 0x1234);
  loops.forEach((_, i) => i32(c1, 270 + i * 26, 0x5555));
  i32(c2, 0, 0x9999);
  singles.forEach((_, i) => i32(c2, 8 + i * 26, 0x7777));

  const samples = new Map<number, Float32Array>();
  for (const [c, loc] of audioLocs) samples.set(loc, c.audio.samples);
  return { file, bytes: writeContainerFile(file), samples };
}

const load = (): { file: DFContainerFile; bytes: Uint8Array; samples: Map<number, Float32Array> } => {
  const built = buildTestBank();
  return { file: readContainerFile(built.bytes), bytes: built.bytes, samples: built.samples };
};

/** worst per-sample and rms deviation between two waveforms */
function error(a: Float32Array, b: Float32Array): { max: number; rms: number } {
  let max = 0;
  let sum = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const d = Math.abs(a[i] - b[i]);
    max = Math.max(max, d);
    sum += d * d;
  }
  return { max, rms: Math.sqrt(sum / Math.min(a.length, b.length)) };
}

// --- the codec --------------------------------------------------------------

test("v41 codec: a re-encoded waveform decodes back to the waveform", () => {
  // a tone whose slope stays inside the ±2048 delta range is tracked to the
  // step size itself (16 of 32768); noise outruns the deltas and falls back to
  // the absolute mode, which quantizes to 512 (so ±256 = 0.0078)
  const smooth = tone(0.05, 220);
  const back = decodeAudioContainer(encodeAudioContainer({ sampleRate: RATE, samples: smooth }));
  expect(back.sampleRate).toBe(RATE);
  expect(back.samples.length).toBe(smooth.length);
  const smoothErr = error(smooth, back.samples);
  expect(smoothErr.max).toBeLessThan(16.5 / 32768);
  expect(smoothErr.rms).toBeLessThan(10 / 32768);

  const rough = noise(0.03);
  const roughErr = error(
    rough,
    decodeAudioContainer(encodeAudioContainer({ sampleRate: RATE, samples: rough })).samples,
  );
  expect(roughErr.max).toBeLessThan(0.01);

  // the rails: a full-scale tone must never wrap to the opposite side (the
  // decoder's accumulator is an i16 that wraps, so the encoder clamps)
  const loud = tone(0.05, 300, 1);
  const loudBack = decodeAudioContainer(
    encodeAudioContainer({ sampleRate: RATE, samples: loud }),
  ).samples;
  for (let i = 0; i < loud.length; i++) {
    if (Math.abs(loud[i]) > 0.1) expect(Math.sign(loudBack[i])).toBe(Math.sign(loud[i]));
  }
  expect(error(loud, loudBack).max).toBeLessThan(0.01);

  // empty and one-sample inputs are the degenerate cases of the loop
  expect(encodeV41(new Float32Array(0)).length).toBe(0);
  expect(decodeAudioContainer(encodeAudioContainer({ sampleRate: 11025, samples: new Float32Array(1) })).samples.length).toBe(1);
});

test("sound container writer: a template's unknown header fields survive", () => {
  // a header with an 8-byte tail past the 48 the format layer knows, junk in
  // the unknown slots, and one of them holding the OLD compressed length
  const template = new Uint8Array(56 + 100);
  i32(template, 0, 0x00010000);
  i32(template, 8, 0x0deadbee);
  i32(template, 12, 100); // == the old payload length
  i32(template, 20, 777);
  i16(template, 0x1a, 1); // v40, the codec we cannot write
  i32(template, 28, 11025);
  i32(template, 36, 100);
  i32(template, 44, 56);
  template[50] = 0x42; // a byte only the template knows about

  const samples = tone(0.02, 440);
  const out = encodeAudioContainer({ sampleRate: RATE, samples }, template);
  const v = new DataView(out.buffer);
  expect(v.getInt32(8, true)).toBe(0x0deadbee);
  expect(v.getInt32(20, true)).toBe(777);
  expect(out[50]).toBe(0x42);
  expect(v.getInt32(44, true)).toBe(56); // the template's data start, kept
  expect(v.getInt16(0x1a, true)).toBe(2); // rewritten: we only write v41
  expect(v.getInt32(28, true)).toBe(RATE);
  expect(v.getInt32(36, true)).toBe(samples.length * 2);
  expect(out.length).toBe(56 + samples.length);
  // the stale length is the one wrong answer we can rule out
  expect(v.getInt32(12, true)).toBe(samples.length);
  expect(decodeAudioContainer(out).samples.length).toBe(samples.length);
});

// --- reading the bank -------------------------------------------------------

test("bank tables: the synthesized bank reads back as a bank", () => {
  const { file, bytes, samples } = load();
  const t = readBankTables(file);

  expect(t.trackName).toBe("OLDTUNE.WAV"); // raw: the runtime is what strips .wav
  expect(t.loopTable).toBe(1);
  expect(t.oneShotTable).toBe(2);
  expect(t.loopOrder).toEqual([1, 2, 3, 2]);
  expect(t.loopRecords.map((c) => c.identifier)).toEqual(["intro", "mainloop", "outro"]);
  expect(t.loopRecords.map((c) => c.containerLoc)).toEqual([3, 4, 5]);
  expect(t.loopRecords.map((c) => c.idOffset)).toEqual([280, 306, 332]);
  expect(t.singles.map((c) => c.identifier)).toEqual(["doorlocked", "sfx/creak"]);
  expect(t.singles.map((c) => c.containerLoc)).toEqual([6, 7]);
  // 11 stored characters plus the zero padding to the end of container 0
  expect(t.trackNameLimit).toBe(27);

  // the runtime's view: chunks resolved in playback order, the repeat included,
  // and the one-shots keyed by the name a script would ask for
  const bank = readAudioBank(file);
  expect(bank.trackName).toBe("OLDTUNE");
  expect(bank.loopChunks).toEqual([3, 4, 5, 4]);
  expect([...bank.singles.keys()]).toEqual(["doorlocked", "creak"]);

  // every chunk decodes to what it was built from
  for (const [loc, built] of samples) {
    expect(error(built, decodeAudioContainer(file.containers[loc].data).samples).max).toBeLessThan(0.01);
  }

  // stability: exporting an untouched load is the file it read
  expect(writeContainerFile(file)).toEqual(bytes);
});

// --- edits ------------------------------------------------------------------

test("track name: renamed in place, clamped to the field, nothing else moved", () => {
  const { file, bytes } = load();
  const before = readContainerFile(bytes);

  expect(patchTrackName(file, "MYTHEME.WAV")).toBe("MYTHEME.WAV");
  const back = readContainerFile(writeContainerFile(file));
  expect(readBankTables(back).trackName).toBe("MYTHEME.WAV");
  expect(readAudioBank(back).trackName).toBe("MYTHEME");
  for (let i = 1; i < before.containers.length; i++) {
    expect(back.containers[i].data).toEqual(before.containers[i].data);
  }
  // in container 0 only the name field differs
  expect(back.containers[0].data.subarray(0, 36)).toEqual(before.containers[0].data.subarray(0, 36));
  expect(back.containers[0].data.subarray(36 + 1 + 27)).toEqual(
    before.containers[0].data.subarray(36 + 1 + 27),
  );

  // a shorter name clears the characters it drops rather than leaving a tail
  expect(patchTrackName(file, "X")).toBe("X");
  expect(readBankTables(file).trackName).toBe("X");
  expect(file.containers[0].data.subarray(38, 48).some((b) => b !== 0)).toBe(false);

  // clamped to the field: the limit shrinks with the stored length, so ask for
  // more than the field can hold and get exactly what fits
  const limit = readBankTables(file).trackNameLimit;
  const stored = patchTrackName(file, "z".repeat(80));
  expect(stored.length).toBe(limit);
  expect(readBankTables(file).trackName).toBe(stored);
});

test("chunk identifier: renames one record, and the sound answers to it", () => {
  const { file, bytes } = load();
  const before = readContainerFile(bytes);
  const t = readBankTables(file);

  const single = t.singles[0];
  expect(patchChunkIdentifier(file, t.oneShotTable, single.idOffset, "doorunlock")).toBe("doorunlock");
  // the loop records live in a different container: rename one of those too
  expect(patchChunkIdentifier(file, t.loopTable, t.loopRecords[1].idOffset, "verse")).toBe("verse");
  // clamped to the 15-character field
  const long = patchChunkIdentifier(file, t.oneShotTable, t.singles[1].idOffset, "a".repeat(40));
  expect(long).toBe("a".repeat(CHUNK_ID_FIELD));

  const back = readContainerFile(writeContainerFile(file));
  const bank = readAudioBank(back);
  expect([...bank.singles.keys()]).toEqual(["doorunlock", "a".repeat(CHUNK_ID_FIELD)]);
  expect(readBankTables(back).loopRecords.map((c) => c.identifier)).toEqual([
    "intro",
    "verse",
    "outro",
  ]);
  // the audio and the play order are untouched — only the two tables changed
  expect(bank.loopChunks).toEqual([3, 4, 5, 4]);
  for (let i = 3; i < before.containers.length; i++) {
    expect(back.containers[i].data).toEqual(before.containers[i].data);
  }
  // and inside the one-shot table, only the identifier fields
  const a = back.containers[2].data;
  const b = before.containers[2].data;
  expect(a.subarray(0, 8 + 10)).toEqual(b.subarray(0, 8 + 10));
  expect(a.subarray(8 + 26, 8 + 26 + 10)).toEqual(b.subarray(8 + 26, 8 + 26 + 10));
});

test("loop order: reordered, repeated, dropped — and validated", () => {
  const { file, bytes } = load();
  const before = readContainerFile(bytes);

  // reverse it and repeat the intro at the end
  expect(patchLoopOrder(file, [3, 2, 1, 1])).toEqual([3, 2, 1, 1]);
  let back = readContainerFile(writeContainerFile(file));
  expect(readBankTables(back).loopOrder).toEqual([3, 2, 1, 1]);
  expect(readAudioBank(back).loopChunks).toEqual([5, 4, 3, 3]);
  // the records themselves are untouched, and so is everything but the table
  expect(readBankTables(back).loopRecords.map((c) => c.identifier)).toEqual([
    "intro",
    "mainloop",
    "outro",
  ]);
  for (let i = 2; i < before.containers.length; i++) {
    expect(back.containers[i].data).toEqual(before.containers[i].data);
  }
  expect(back.containers[1].data.subarray(266)).toEqual(before.containers[1].data.subarray(266));

  // out-of-range indices are dropped; a bank whose order is empty has no music
  expect(patchLoopOrder(file, [2, 0, 9, -1, 1.5, 1])).toEqual([2, 1]);
  expect(patchLoopOrder(file, [])).toEqual([]);
  back = readContainerFile(writeContainerFile(file));
  expect(readBankTables(back).loopOrder).toEqual([]);
  expect(readAudioBank(back).loopChunks).toEqual([]);
  expect(back.containers[1].data.length).toBe(before.containers[1].data.length);

  // the order field is a fixed 130 slots: a longer list stores its first 130
  const long = patchLoopOrder(file, Array.from({ length: 200 }, (_, i) => (i % 3) + 1));
  expect(long.length).toBe(LOOP_ORDER_MAX);
  expect(readBankTables(readContainerFile(writeContainerFile(file))).loopOrder).toEqual(long);
});

test("chunk replacement: new audio in one chunk, the rest of the bank as it was", () => {
  const { file, bytes } = load();
  const before = readContainerFile(bytes);
  const t = readBankTables(file);
  const loc = t.loopRecords[1].containerLoc;

  // the editor's import path: re-encode over the container being replaced, so
  // whatever its header carried beyond the known fields comes along
  const fresh = tone(0.3, 110, 0.9);
  file.containers[loc] = {
    id: file.containers[loc].id,
    data: encodeAudioContainer({ sampleRate: 11025, samples: fresh }, before.containers[loc].data),
  };

  const back = readContainerFile(writeContainerFile(file));
  const got = decodeAudioContainer(back.containers[loc].data);
  expect(got.sampleRate).toBe(11025);
  expect(got.samples.length).toBe(fresh.length);
  expect(error(fresh, got.samples).max).toBeLessThan(0.01);
  // the bank still resolves, with the same tables and every other chunk intact
  expect(readAudioBank(back).loopChunks).toEqual([3, 4, 5, 4]);
  for (let i = 0; i < before.containers.length; i++) {
    if (i !== loc) expect(back.containers[i].data).toEqual(before.containers[i].data);
  }
});
