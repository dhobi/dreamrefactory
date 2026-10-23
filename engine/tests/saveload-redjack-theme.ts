/**
 * A RedJack load's sound banks and theme (loadGameV5 in
 * engine/src/runtime/saveload-v5.ts): a bank whose handle names nothing is
 * opened by the name the save keeps for it, and the theme starts again from
 * its beginning (RedJack.exe 0x43e68c) at the loudness the script last asked
 * for that track, or, never asked, at the save's `themevolume` global, else
 * full.
 *
 *   npx vitest run engine/tests/saveload-redjack-theme.ts
 *
 * No game files: a bank built here.
 */
import { expect, test } from "vitest";
import { buildBankBytes } from "@dreamfactory/engine/df/banks-build";
import { readSaveV5, writeSaveV5 } from "@dreamfactory/engine/df/savegame-v5";
import { NullAudioSink } from "@dreamfactory/engine/runtime/audio";
import { GameSession } from "@dreamfactory/engine/runtime/session";
import { loadGameV5, snapshotSaveV5 } from "@dreamfactory/engine/runtime/saveload-v5";

const tone = { sampleRate: 1000, samples: new Float32Array(100).fill(0.25) };
const FILES: Record<string, Uint8Array> = {
  "beach.trak": buildBankBytes({ name: "beach", loops: [{ identifier: "surf", audio: tone }] }),
};

function session() {
  const audio = new NullAudioSink();
  const s = new GameSession((n) => FILES[n.toLowerCase()] ?? null, audio);
  s.isV5 = true;
  return { s, audio };
}

/** a save with the theme playing out of beach.trak, its handle in the manifest or not */
function save(themevolume?: number, listed = true) {
  const { s } = session();
  if (themevolume !== undefined) s.interp.globals.set("themevolume", themevolume);
  const out = readSaveV5(snapshotSaveV5(s)!);
  out.files = listed ? [{ handle: 9, path: "C:\\RedJack\\beach.trak" }] : [];
  out.tracks = [{ handle: 9, name: "beach.trak", sounds: new Uint8Array(0), themes: new Uint8Array(0), order: new Uint8Array(0) }];
  out.themeTrack = 9;
  return writeSaveV5(out);
}

test("the theme starts again at the save's themevolume when the script never set the track's", async () => {
  const { s, audio } = session();
  expect(await loadGameV5(s, save(70))).toBe(true);
  expect(s.currentThemeName).toBe("beach");
  expect(audio.calls.filter((c) => c.channel === "theme")).toHaveLength(1);
  expect([s.themeVolume, s.volumeForTrack("beach")]).toEqual([70, 70]);
});

test("...and with no themevolume global either, at full", async () => {
  const { s } = session();
  expect(await loadGameV5(s, save())).toBe(true);
  expect([s.currentThemeName, s.themeVolume]).toEqual(["beach", 255]);
});

test("...and at the track's own loudness when the script set it", async () => {
  const { s } = session();
  s.setThemeVolume(30, "beach");
  expect(await loadGameV5(s, save(70))).toBe(true);
  expect([s.currentThemeName, s.themeVolume]).toEqual(["beach", 30]);
});

test("a bank whose handle names nothing is opened by its saved name, but is no theme without one", async () => {
  const { s, audio } = session();
  expect(await loadGameV5(s, save(70, false))).toBe(true);
  expect(s.audioLib.bankNames).toContain("beach.trak");
  expect(audio.calls.filter((c) => c.channel === "theme")).toHaveLength(0);
});
