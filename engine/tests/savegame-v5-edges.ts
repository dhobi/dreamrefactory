/**
 * RedJack's `.save` (engine/src/df/savegame-v5.ts) on the records and files
 * savegame-v5.ts leaves out: a cast member that is out of the world, snapped
 * and a facer comes back so; a save with fewer than nine paths writes the rest
 * empty; and the reader names the container that is not what it should be — a
 * wrong tag, one too short to carry a tag, or none at all.
 *
 *   npx vitest run engine/tests/savegame-v5-edges.ts
 *
 * No game files.
 */
import { expect, test } from "vitest";
import { readContainerFile, writeContainerFile } from "@dreamfactory/engine/df/container";
import { TABLE, plainSaveShade, readSaveV5, writeSaveV5, type SaveGameV5 } from "@dreamfactory/engine/df/savegame-v5";

const slots = (t: { slots: number; stride: number }): Uint8Array => new Uint8Array(t.slots * t.stride);

function sample(): SaveGameV5 {
  return {
    version: "2",
    disc: "RJDisk3",
    paths: ["C:\\RedJack\\", "RJDisk3:data:", "", "", "", "", "", "", ""],
    files: [{ handle: 2, path: "C:\\RedJack\\rjbeach.cast" }],
    themeTrack: 0,
    soundTrack: 0,
    soundContainer: 0,
    runt: {
      frame: 1, framerate: 3, setOpen: false, setVisible: false, setHandle: 0, setName: "", scene: "", view: "",
      deg: 0, pitch: 0, roll: 0, fov: 0, stageOpen: false, stageHandle: 0, stageName: "", flat: 0,
      screen: plainSaveShade(), stage: plainSaveShade(), set: plainSaveShade(), movie: plainSaveShade(), puppet: plainSaveShade(),
    },
    actors: [{
      name: "anne", visible: false, castHandle: 2, member: 7, is3d: false, true3d: true, deg: 0, pitch: 0, roll: 0,
      x: 0, y: 0, z: 0, turn: 16, speed: 900, scale: 54000, value: 0, zclip: 0, snap: true, ink: 8, flip: 2,
      shade: plainSaveShade(), litby: 0, facer: true, set: "", star: "", pose: "stand", owner: "none",
    }],
    casts: [{ handle: 2, name: "rjbeach" }],
    props: [],
    shops: [],
    tracks: [],
    globals: [],
    loops: slots(TABLE.loops),
    crickets: slots(TABLE.crickets),
    walks: slots(TABLE.walks),
    routes: [],
    copies: slots(TABLE.copies),
  };
}

test("an actor out of the world, snapped and a facer reads back so", () => {
  const s = sample();
  const [anne] = readSaveV5(writeSaveV5(s)).actors;
  expect([anne.is3d, anne.true3d, anne.snap, anne.facer, anne.visible]).toEqual([false, true, true, true, false]);
});

test("a save with fewer than nine paths writes the rest empty", () => {
  const s = sample();
  s.paths = ["C:\\RedJack\\"];
  expect(readSaveV5(writeSaveV5(s)).paths).toEqual(["C:\\RedJack\\", "", "", "", "", "", "", "", ""]);
});

test("the reader names the container that is not what it should be", () => {
  const file = readContainerFile(writeSaveV5(sample()));
  const tag = (d: Uint8Array) => String.fromCharCode(d[7], d[6], d[5], d[4]);
  const second = tag(file.containers[1].data);
  const rewrite = (edit: (cs: typeof file.containers) => void) => {
    const copy = { ...file, containers: file.containers.map((c) => ({ ...c, data: c.data.slice() })) };
    edit(copy.containers);
    return writeContainerFile(copy);
  };
  // the second container's tag spelled backwards
  expect(() => readSaveV5(rewrite((cs) => cs[1].data.set([...second].map((c) => c.charCodeAt(0)), 4))))
    .toThrow(`container 1 is not ${second} (${[...second].reverse().join("")})`);
  // too short to carry a tag at all, though it starts as a v5 container does
  expect(() => readSaveV5(rewrite((cs) => (cs[1].data = cs[1].data.slice(0, 4)))))
    .toThrow(`container 1 is not ${second} ()`);
  // and a file that stops before the container (the first grown to keep the file the loader's size)
  const grown = (d: Uint8Array) => Uint8Array.from([...d, ...new Uint8Array(8192)]);
  expect(() => readSaveV5(rewrite((cs) => (cs.splice(1), (cs[0].data = grown(cs[0].data))))))
    .toThrow(`container 1 is not ${second} (missing)`);
});
