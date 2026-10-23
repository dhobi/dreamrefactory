/**
 * The page's sink (`WebAudioSink` in engine/src/runtime/audio.ts) on the
 * plays audio-sinks.ts leaves out: a loop that comes round to a point inside
 * the sound, and one whose point is past the end; a play given only a balance,
 * or only a volume; a stereo play's ears taken from its own two channels; a
 * handle stopped twice, and an unplaced play moved. And the library's
 * `themeChunkAt` on a bank whose loops have no length, or a time that is no
 * time.
 *
 *   npx vitest run engine/tests/audio-webaudio-play.ts
 *
 * No game data: the WebAudio graph is the stand-in in helpers/fake-webaudio.ts.
 */
import { expect, test } from "vitest";
import { buildBankBytes } from "@dreamfactory/engine/df/banks-build";
import { AudioLibrary } from "@dreamfactory/engine/runtime/audio";
import { fakeContext } from "./helpers/fake-webaudio";

const tone = (n: number, sampleRate = 1000) => ({ sampleRate, samples: new Float32Array(n).fill(0.25) });

test("a loop goes round to its loop point when the point is inside the sound, else to the start", () => {
  const f = fakeContext();
  const sink = f.sink();
  sink.play("theme", tone(1000), { loop: true, loopStart: 0.25 });
  expect([f.sources[0].loopStart, f.sources[0].loopEnd]).toEqual([0.25, 1]);
  sink.play("theme", tone(1000), { loop: true, loopStart: 2 });
  expect([f.sources[1].loop, f.sources[1].loopStart, f.sources[1].loopEnd]).toEqual([true, undefined, undefined]);
  // a loop point on a play that does not loop is ignored
  sink.play("theme", tone(1000), { loopStart: 0.25 });
  expect(f.sources[2].loopStart).toBeUndefined();
});

test("a play given only a balance is at full volume; one given only a volume is centred", () => {
  const f = fakeContext();
  const sink = f.sink();
  const base = f.gains.length;
  sink.play("sound", tone(10), { pan: 0.5 });
  const [gain, left, right] = f.gains.slice(base);
  expect([gain.gain.value, left.gain.value, right.gain.value]).toEqual([1, 0.5, 1]);
  sink.play("voice", tone(10), { volume: 0.25 });
  const [gain2, left2, right2] = f.gains.slice(base + 3);
  expect([gain2.gain.value, left2.gain.value, right2.gain.value]).toEqual([0.25, 1, 1]);
});

test("a mono play feeds both ears from its one channel; a stereo one each from its own", () => {
  const f = fakeContext();
  const sink = f.sink();
  sink.play("sound", tone(10), { pan: 0 });
  sink.play("voice", tone(10), { pan: 0, stereoGains: [1, 0.5] });
  expect(f.splitters.map((s) => s.outputs)).toEqual([[0, 0], [0, 1]]);
});

test("stopping a handle twice stops the node once; moving an unplaced play changes nothing", () => {
  const f = fakeContext();
  const sink = f.sink();
  const h = sink.play("sound", tone(10));
  h.stop();
  h.stop();
  expect(f.sources[0].stopped).toBe(1);
  const gains = f.gains.map((g) => g.gain.value);
  const plain = sink.play("voice", tone(10));
  plain.place?.(0.1, 1);
  expect(f.gains.map((g) => g.gain.value)).toEqual(gains);
  plain.setLoop?.(true);
  expect(f.sources[1].loop).toBe(true);
});

/** a bank with these loop lengths (in samples at 1000 Hz), named a, b, … */
function namedLoops(lengths: number[]) {
  const lib = new AudioLibrary();
  const names = lengths.map((_, i) => String.fromCharCode(97 + i));
  lib.openBank("town.trk", buildBankBytes({ name: "town.trk", loops: lengths.map((n, i) => ({ identifier: names[i], audio: tone(n) })) }));
  // a v1 bank names its loops; a built (v4) one does not, so name them here
  const banks = (lib as unknown as { banks: Map<string, { bank: { loopNames?: string[] } }> }).banks;
  banks.get("town.trk")!.bank.loopNames = names;
  return lib;
}

test("themeChunkAt: the chunk under the time, round the order; loops of no length are on the first", () => {
  const lib = namedLoops([500, 250]);
  expect([0, 0.6, 0.8, 1.1, -0.1].map((t) => lib.themeChunkAt("town.trk", t))).toEqual(["a", "b", "a", "a", "b"]);
  // a time that is not a number falls through every chunk to the last
  expect(lib.themeChunkAt("town.trk", Number.NaN)).toBe("b");
  expect(namedLoops([0, 0]).themeChunkAt("town.trk", 3)).toBe("a");
});
