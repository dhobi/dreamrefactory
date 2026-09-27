/**
 * RedJack's `.save`, the bytes alone: what the writer lays out, the reader reads
 * back, and the two checks RedJack.exe's loader makes before it reads anything.
 *
 *   npx vitest run engine/tests/savegame-v5.ts
 *
 * No game files: the game's own round trip, through a running session, is
 * redjack/tests/machine/saves.ts.
 */
import { test, expect } from "vitest";
import { TABLE, isSaveV5, readSaveV5, saveVersionMatches, writeSaveV5, type SaveGameV5 } from "@dreamfactory/engine/df/savegame-v5";

const slots = (t: { slots: number; stride: number }): Uint8Array => new Uint8Array(t.slots * t.stride);

function sample(): SaveGameV5 {
  const loops = slots(TABLE.loops);
  loops[0] = 1;
  return {
    version: "2",
    disc: "RJDisk3",
    paths: ["C:\\RedJack\\", "RJDisk3:data:", "", "", "", "", "", "", ""],
    files: [
      { handle: 1, path: "C:\\RedJack\\rjbeach.sett" },
      { handle: 2, path: "C:\\RedJack\\rjbeach.cast" },
      { handle: 3, path: "C:\\RedJack\\rjbeach.shop" },
      { handle: 4, path: "C:\\RedJack\\rjbeach.trak" },
    ],
    themeTrack: 4,
    soundTrack: 0,
    soundContainer: 0,
    runt: {
      frame: 12345, framerate: 3, setOpen: true, setVisible: true, setHandle: 1, setName: "rjbeach", scene: "Scene14", view: "node",
      deg: 8_388_608, pitch: -200_000, roll: 0, fov: 4_194_304, stageOpen: false, stageHandle: 0, stageName: "", flat: 0,
    },
    actors: [{
      name: "anne", visible: true, castHandle: 2, member: 7, is3d: true, true3d: false, deg: 100, pitch: 0, roll: 0,
      x: 1, y: -2, z: 3, turn: 16, speed: 900, scale: 54000, value: 5, zclip: 75000, snap: false, ink: 8, flip: 0,
      contrast: 0, brightness: 0, litby: 0, facer: false, set: "rjbeach", star: "anne", pose: "stand", owner: "none",
    }],
    casts: [{ handle: 2, name: "rjbeach" }],
    props: [{
      name: "torch", shown: -1, shopHandle: 3, member: 40, is3d: false, true3d: false, deg: 0, pitch: 0, roll: 0,
      x: 320, y: 240, z: -5, scale: 0, value: 0, zclip: 0, snap: true, ink: 8, flip: 1, contrast: 0, brightness: 0,
      litby: 0, facer: true, set: "", star: "", view: "lit", owner: "nick",
    }],
    shops: [{ handle: 3, name: "rjbeach" }],
    tracks: [{ handle: 4, name: "rjbeach", sounds: new Uint8Array(0), themes: new Uint8Array(0), order: new Uint8Array(0) }],
    globals: [
      { name: "day", value: 4, arraySize: 0, index: 0 },
      { name: "setloc", value: "rjbeach", arraySize: 0, index: 0 },
      { name: "jrep", value: 7, arraySize: 20, index: 3 },
    ],
    loops,
    crickets: slots(TABLE.crickets),
    walks: slots(TABLE.walks),
    routes: [],
    copies: slots(TABLE.copies),
  };
}

test("a save reads back as it was written", () => {
  const s = sample();
  const bytes = writeSaveV5(s);
  expect(isSaveV5(bytes)).toBe(true);
  expect(readSaveV5(bytes)).toEqual(s);
});

test("the file is laid out as RedJack.exe lays one out", () => {
  const bytes = writeSaveV5(sample());
  const v = new DataView(bytes.buffer);
  expect(v.getUint32(0, true)).toBe(0x00010000);
  // the size field is the file's exact length, one of the loader's two checks
  expect(v.getUint32(4, true)).toBe(bytes.length);
  // a 1024-entry position table, so container 0 starts at 5120, 64-aligned
  expect(v.getUint32(16, true)).toBe(1024);
  expect(v.getUint32(1024, true)).toBe(5120);
  expect(String.fromCharCode(...bytes.subarray(32, 40))).toBe("EVASTR5D");
});

test("the loader refuses what RedJack.exe refuses", () => {
  const bytes = writeSaveV5(sample());
  const short = bytes.slice(0, bytes.length - 64);
  expect(() => readSaveV5(short)).toThrow("This is not a valid saved game file.");
  // `opengame`'s version check: the same letters ignoring case, the same length
  expect(saveVersionMatches("2", "2")).toBe(true);
  expect(saveVersionMatches("Titanic 1.0", "titanic 1.0")).toBe(true);
  expect(saveVersionMatches("2", "2 ")).toBe(false);
});
