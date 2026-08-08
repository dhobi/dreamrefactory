/**
 * Mixed sample rates inside one file, and the joins that have to survive them.
 *
 * A DecodedAudio buffer plays at exactly one rate, but the game does not store
 * one rate per file: a bank's loop chunks and a movie's soundtrack segments mix
 * 22050 Hz and 11025 Hz, and WHICH chunks are which differs per language. So
 * anything that concatenates chunks has to resample them to a common rate
 * first. Labelling the join with `Math.max` and leaving the rest alone is the
 * bug this file exists for: the German bedsit radio, nine of whose fifteen loop
 * chunks are 11025, played its announcer at double speed.
 */
import { test, expect } from "vitest";
import { readFileSync } from "node:fs";
import { decodeAudioContainer, resampleTo } from "../../src/df/audio";
import { readAudioBank } from "../../src/df/banks";
import { readContainerFile, writeContainerFile } from "../../src/df/container";
import { buildBankFile } from "../../src/df/banks-build";
import { AudioLibrary } from "../../src/engine/audio";
import { gamefiles, gamefilesRoot } from "../../tools/gamefiles";

const HI = 22050;
const LO = 11025;

/** a constant-frequency tone at whatever rate it is asked for */
function tone(seconds: number, freq: number, rate: number): Float32Array {
  const out = new Float32Array(Math.round(seconds * rate));
  for (let i = 0; i < out.length; i++) out[i] = 0.7 * Math.sin((2 * Math.PI * freq * i) / rate);
  return out;
}

// --- the resampler ----------------------------------------------------------

test("resampleTo changes the sample count, not the duration", () => {
  const half = tone(0.5, 440, LO);
  const up = resampleTo(half, LO, HI);
  expect(up.length).toBe(half.length * 2);
  expect(up.length / HI).toBeCloseTo(half.length / LO, 5);
});

test("resampleTo is a no-op at the same rate, and safe on nothing", () => {
  const t = tone(0.1, 440, HI);
  expect(resampleTo(t, HI, HI)).toBe(t); // the same array, not a copy
  expect(resampleTo(new Float32Array(0), LO, HI)).toHaveLength(0);
});

test("resampleTo keeps the waveform, not just the length", () => {
  // a resampled tone must still be that tone: compare against the same
  // frequency generated natively at the target rate
  const up = resampleTo(tone(0.2, 300, LO), LO, HI);
  const native = tone(0.2, 300, HI);
  let worst = 0;
  for (let i = 0; i < Math.min(up.length, native.length); i++) {
    worst = Math.max(worst, Math.abs(up[i] - native[i]));
  }
  expect(worst).toBeLessThan(0.06); // linear interpolation, so not exact
});

// --- the bank join ----------------------------------------------------------

test("a theme built from mixed-rate loop chunks keeps every chunk's duration", () => {
  // two seconds of audio: one second stored at each rate. Played at the higher
  // rate with no resampling, the 11025 half would take half a second and the
  // theme would come out at 1.5 s — audibly a chipmunk, and short.
  const { file } = buildBankFile({
    name: "mixed",
    loops: [
      { identifier: "fast", audio: { sampleRate: HI, samples: tone(1, 440, HI) } },
      { identifier: "slow", audio: { sampleRate: LO, samples: tone(1, 220, LO) } },
    ],
  });
  const lib = new AudioLibrary();
  expect(lib.openBank("mixed.trk", writeContainerFile(file))).toBe(true);
  const theme = lib.theme("mixed.trk")!;
  expect(theme).not.toBeNull();
  expect(theme.sampleRate).toBe(HI);
  expect(theme.samples.length / theme.sampleRate).toBeCloseTo(2, 2);
});

test("an all-one-rate bank is joined without touching its samples", () => {
  const { file } = buildBankFile({
    name: "plain",
    loops: [
      { identifier: "a", audio: { sampleRate: HI, samples: tone(0.5, 440, HI) } },
      { identifier: "b", audio: { sampleRate: HI, samples: tone(0.5, 220, HI) } },
    ],
  });
  const lib = new AudioLibrary();
  lib.openBank("plain.trk", writeContainerFile(file));
  const theme = lib.theme("plain.trk")!;
  expect(theme.sampleRate).toBe(HI);
  expect(theme.samples.length).toBe(Math.round(0.5 * HI) * 2);
});

// --- the file that reported it ----------------------------------------------

/**
 * The bedsit radio, in whichever languages are installed.
 *
 * The claim is duration: the theme must last as long as the sum of its chunks,
 * each measured at the rate it was recorded at. That is the property the old
 * code broke and the one a listener notices — and it is worth asserting against
 * the real file, because the mixed-rate layout is not something a synthetic
 * bank would have thought to have.
 */
test("the bedsit radio theme lasts as long as its chunks do", () => {
  const langs = ["en", "de", "fr", "nl", "ru", "ja"];
  let checked = 0;
  let sawMixed = false;
  for (const lang of langs) {
    // through the index, not a hand-built path: no case convention holds across
    // the discs, and a list of guessed spellings goes stale the moment a rip is
    // re-cased (`TITANIC1/` -> `titanic1/` did exactly that, and the miss looked
    // like "no tree installed" rather than a wrong path)
    const path = gamefiles(gamefilesRoot(), lang).resolve("bedrad1.trk");
    if (!path) continue;
    const bytes = new Uint8Array(readFileSync(path));
    const file = readContainerFile(bytes);
    const chunks = readAudioBank(file).loopChunks.map((loc) =>
      decodeAudioContainer(file.containers[loc].data),
    );
    const expected = chunks.reduce((a, c) => a + c.samples.length / c.sampleRate, 0);
    if (new Set(chunks.map((c) => c.sampleRate)).size > 1) sawMixed = true;

    const lib = new AudioLibrary();
    lib.openBank("bedrad1.trk", bytes);
    const theme = lib.theme("bedrad1.trk")!;
    expect(theme, `${lang} bedrad1.trk has no theme`).not.toBeNull();
    expect(theme.samples.length / theme.sampleRate, `${lang} bedrad1.trk`).toBeCloseTo(expected, 1);
    checked++;
  }
  expect(checked, "no bedrad1.trk found under gamefiles/").toBeGreaterThan(0);
  // if no installed tree actually mixes rates, this test proved nothing
  expect(sawMixed, "no installed bedrad1.trk mixes sample rates").toBe(true);
});
