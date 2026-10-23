/**
 * A Dust load's sound (restoreThemeV1 in engine/src/runtime/saveload-v1.ts),
 * on banks and a base save built here: a one-shot record with no name is
 * passed over; another bank's chunk records give that track its loudness
 * (DF.EXE 0x41b1e2); an effect record the bank never registered is reported
 * rather than played; and a theme with no saved, no script-set loudness takes
 * the save's `themevolume` global, else full. And a snapshot's standpoint
 * (standpointOf): a heading on one of the set's four facings is written as
 * that facing's number, and one between them as facing 1; and a patch that
 * takes an actor out of the world (df/savegame-v1.ts applyPatchV1) clears the
 * record's is3d flag.
 *
 *   npx vitest run engine/tests/saveload-dust-edges.ts
 *
 * No game files.
 */
import { expect, test } from "vitest";
import { buildBankBytes } from "@dreamfactory/engine/df/banks-build";
import { NullAudioSink } from "@dreamfactory/engine/runtime/audio";
import { GameSession } from "@dreamfactory/engine/runtime/session";
import { readSaveFile } from "@dreamfactory/engine/df/savegame";
import { applyPatchV1, parseSaveV1 } from "@dreamfactory/engine/df/savegame-v1";
import { loadGameV1, snapshotSaveV1 } from "@dreamfactory/engine/runtime/saveload-v1";
import { FILLER, dustBytes, dustSave, i32, pstr, u16, u32, type Global } from "./helpers/save-fixtures";

const tone = { sampleRate: 1000, samples: new Float32Array(100).fill(0.25) };
const FILES: Record<string, Uint8Array> = {
  "town.trk": buildBankBytes({ name: "town.trk", loops: [{ identifier: "a", audio: tone }] }),
  "fx.trk": buildBankBytes({ name: "fx.trk", loops: [{ identifier: "hum", audio: tone }], singles: [{ identifier: "creak", audio: tone }] }),
};

/** one 104-byte sound record: name at +0x45, record number +0x41, volume +0x2f, pan +0x31 */
function soundRecords(...records: { name: string; record: number; volume: number }[]): Uint8Array {
  const d = new Uint8Array(104 * records.length);
  records.forEach((r, k) => {
    pstr(d, 104 * k + 0x45, r.name);
    i32(d, 104 * k + 0x41, r.record);
    u16(d, 104 * k + 0x2f, r.volume);
    u16(d, 104 * k + 0x31, 128);
  });
  return d;
}

/** the theme playing out of town.trk, fx.trk open beside it with an effect record 9 caught mid-play */
function save(vars: Global[] = FILLER): Uint8Array {
  const d = dustSave({ vars, banks: 2, files: [[3, "dust:data:town.trk"], [4, "dust:data:fx.trk"]] });
  u32(d.c0, 0xa00, 3);
  u32(d.c0, 0xa04, 4);
  u32(d.c0, 0xa08, 9);
  // bank 0: town.trk, nothing saved for it; bank 1: fx.trk, two one-shots and a chunk
  u32(d.banks, 0, 3);
  u32(d.banks, 38, 4);
  u16(d.banks, 38 + 4, 2);
  u16(d.banks, 38 + 6, 1);
  d.bankArrays[3] = soundRecords({ name: "", record: 1, volume: 10 }, { name: "creak", record: 2, volume: 20 });
  d.bankArrays[4] = soundRecords({ name: "hum", record: 1, volume: 77 });
  return dustBytes(d);
}

function session() {
  const s = new GameSession((name) => FILES[name.toLowerCase()] ?? null, new NullAudioSink());
  const logs: string[] = [];
  s.onLog = (l) => void logs.push(l);
  return { s, logs };
}

test("a load's sound: nameless records skipped, another track's loudness kept, an unknown effect reported", async () => {
  const { s, logs } = session();
  expect(await loadGameV1(s, save())).toBe(true);
  expect(logs).toContain("opengame: sound banks restored: town.trk, fx.trk");
  expect(s.scheduler.sounds.getVolume("creak")).toBe(20);
  expect(s.scheduler.sounds.getVolume("")).not.toBe(10);
  expect(s.volumeForTrack("fx.trk")).toBe(77);
  expect(logs).toContain("opengame: saved sound record 9 of fx.trk is not a registered sound");
  // the theme had nothing saved and no script ever set it: full
  expect(logs).toContain('opengame: theme "town.trk" resumed from town.trk');
  expect([s.themeVolume, s.volumeForTrack("town.trk")]).toEqual([255, 255]);
});

test("a theme with no loudness of its own takes the save's themevolume global", async () => {
  const { s } = session();
  expect(await loadGameV1(s, save([...FILLER, ["themevolume", 90]]))).toBe(true);
  expect(s.volumeForTrack("town.trk")).toBe(90);
});

test("a snapshot writes a heading on one of the four facings as its number, and one between them as 1", () => {
  const { s } = session();
  s.saveTemplate = () => dustBytes(dustSave({ files: [[5, "dust:data:town.set"]] }));
  s.currentSetFile = "town";
  s.currentSceneName = () => "C4";
  // the set's scene C4 on cell (2, 3): 256 units a cell, at its middle
  s.loadSet = (() => ({ scenes: [{ sceneName: "C4", xAxisMap: 2 * 256 + 128, zAxisMap: 3 * 256 + 128 }] })) as never;
  const standpoint = (radians: number) => {
    s.currentRotation = () => radians;
    const sp = parseSaveV1(snapshotSaveV1(s)!).standpoint;
    return [sp.cellX, sp.cellZ, sp.deg, sp.facing];
  };
  // a quarter turn is deg 64, which the set numbers facing 2
  expect(standpoint(Math.PI / 2)).toEqual([2, 3, 64, 2]);
  expect(standpoint(Math.PI / 4)).toEqual([2, 3, 32, 1]);
});

test("a patch can take a cast record out of the world, and one that does not say leaves it", () => {
  const d = dustSave({ actors: 2 });
  pstr(d.actors, 84, "leroy");
  pstr(d.actors, 164 + 84, "dog");
  u16(d.actors, 18, 1);
  u16(d.actors, 164 + 18, 1);
  const out = parseSaveV1(applyPatchV1(readSaveFile(dustBytes(d)), { numGlobals: new Map(), boolGlobals: new Set(), actors: [{ name: "LEROY", is3d: false }, { name: "dog", visible: true }] }));
  expect(out.actors.map((a) => [a.name, a.is3d])).toEqual([["leroy", false], ["dog", true]]);
});
