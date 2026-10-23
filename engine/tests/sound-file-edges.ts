/**
 * The edges of the sound readers, on bytes built here: Dust's SND bank
 * (engine/src/df/snd.ts) refusing another engine's header and warning about a
 * header too short for its name table or its counts, and the audio chunk
 * decoders (engine/src/df/audio.ts) refusing what is not a chunk, and reading
 * a DreamFactory 0 block count whose two byte orders disagree.
 *
 *   npx vitest run engine/tests/sound-file-edges.ts
 */
import { expect, test } from "vitest";
import { ContainerBuilder, i16, i32 } from "@dreamfactory/engine/df/build";
import { readSndFile } from "@dreamfactory/engine/df/snd";
import { blocksV0, decodeAudioContainer, decodeAudioV0, readAudioHeader } from "@dreamfactory/engine/df/audio";
import { pstr } from "./helpers/save-fixtures";

function bank(c0Size: number, sounds: number, edit: (c0: Uint8Array) => void = () => {}, version = 1): Uint8Array {
  const b = new ContainerBuilder();
  const { data } = b.reserve(c0Size);
  i32(data, 2, version);
  edit(data);
  for (let k = 0; k < sounds; k++) b.add(new Uint8Array(16));
  return b.bytes();
}

test("an SND from another engine is refused", () => {
  expect(() => readSndFile(bank(200, 0, () => {}, 4))).toThrow("not a DreamFactory 1 SND (container 0 says version 4)");
});

test("a header too short for its counts, its name or its table says so", () => {
  const snd = readSndFile(bank(10, 2));
  expect(snd.warnings).toEqual([
    "no bank name at 158",
    "the name table stops after 0 of 2 sounds",
    "0 one-shots + 0 loops is not the 2 sounds the bank holds",
  ]);
  expect([snd.oneshots, snd.loops, snd.order]).toEqual([0, 0, []]);
});

test("a nameless record ends the table", () => {
  const snd = readSndFile(bank(186 + 2 * 24, 2, (c0) => {
    pstr(c0, 158, "town.snd");
    pstr(c0, 186, "bell");
    i16(c0, 0x18, 2);
  }));
  expect(snd.refName).toBe("town.snd");
  expect(snd.chunks.map((c) => c.identifier)).toEqual(["bell"]);
  expect(snd.warnings).toEqual(["sound 1: no name at 210"]);
});

test("an audio chunk: too short, or the wrong magic, is not one", () => {
  expect(readAudioHeader(new Uint8Array(4))).toBeNull();
  expect(readAudioHeader(new Uint8Array(64))).toBeNull();
  expect(() => decodeAudioContainer(new Uint8Array(64))).toThrow("audio container: bad magic");
  expect(() => decodeAudioV0(new Uint8Array(2))).toThrow("v0 sound: 2 bytes");
});

test("a DreamFactory 0 block count is little-endian unless the stream says otherwise", () => {
  // 0x0201 read either way: the stream that follows runs off its end, so it settles nothing
  expect(blocksV0(new Uint8Array([1, 2, 0, 0x85]))).toBe(0x0201);
});
