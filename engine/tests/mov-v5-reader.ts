/**
 * RedJack's films (engine/src/df/mov-v5.ts) read from built files: the MHED
 * sniff, a frame count past the header's records, frames with no logic or a
 * logic container missing or too short, a region count past the regions
 * stored, a bed order naming a record that is not there, the one-shot table's
 * edges (missing, short, overcounted, an unnamed record, a follow-on), the
 * palette a segment stands in with, and the segment chain.
 *
 *   npx vitest run engine/tests/mov-v5-reader.ts
 *
 * No game: the films are built ({@link file://./helpers/film-build.ts}).
 */
import { expect, test } from "vitest";
import { isMovV5, readMovFileV5 } from "@dreamfactory/engine/df/mov-v5";
import { logicV5, loopTableV5, movV1, movV5, oneShotsV5, pictureV5, soundChunk } from "./helpers/film-build";

const PIC = pictureV5(1, 1, [10, 20, 30]);

test("a v5 film is told by its MHED; a short file or another version is not one", () => {
  expect(isMovV5(movV5([{ frames: [], containers: [] }]))).toBe(true);
  expect(isMovV5(movV1([{ frames: [{ picture: 1 }], containers: [PIC] }]))).toBe(false);
  expect(isMovV5(new Uint8Array(1027))).toBe(false);
});

test("frames: only the records the header holds, and logic that is absent, missing or short reads as a plain frame", () => {
  const mov = readMovFileV5(
    movV5([
      {
        frames: [
          { name: "none", picture: 1 },
          { name: "gone", picture: 1, logic: 9 },
          { name: "short", picture: 1, logic: 2 },
          { name: "full", picture: 1, logic: 3 },
        ],
        frameCount: 6,
        containers: [
          PIC,
          logicV5({ type: 2, target: "full", truncate: 0x40 }),
          logicV5({
            type: 1,
            hold: 12,
            flags: 0x1d,
            sound: "bang",
            regions: [{ type: 2, rect: [1, 2, 3, 4], target: "none", sound: "tick", event: "ev" }],
            regionCount: 4,
          }),
        ],
      },
    ]),
  );
  expect(mov.frames.map((f) => [f.name, f.type, f.target, f.locationClickRegion])).toEqual([
    ["none", 6, "", 0],
    ["gone", 6, "", 9],
    ["short", 6, "", 2],
    ["full", 1, "", 3],
  ]);
  const full = mov.frames[3];
  expect([full.holdTicks, full.sound, full.waitsForVoice, full.playsThroughRegions, full.holdsDeadline, full.waitsForEffects]).toEqual([
    12,
    "bang",
    true,
    true,
    true,
    true,
  ]);
  // four regions claimed, one stored
  expect(full.regions).toEqual([{ type: 2, y0: 1, x0: 2, y1: 3, x1: 4, sound: "tick", event: "ev", target: "none", record: 0x5e }]);
});

test("the bed plays the loop table's order, skipping an entry no record answers", () => {
  const mov = readMovFileV5(
    movV5([
      {
        frames: [{ name: "a", picture: 1 }],
        loop: 2,
        containers: [PIC, loopTableV5([{ loc: 3, name: "e1" }, { loc: 4, name: "e2" }], [2, 5, 1]), soundChunk(4), soundChunk(4)],
      },
    ]),
  );
  expect(mov.audioChunks).toEqual([4, 3]);
  expect(mov.audioLoops).toBe(true);
});

test("the one-shot table: names, options and follow-ons; an unnamed record skipped; a count past the records", () => {
  const mov = readMovFileV5(
    movV5([
      {
        frames: [{ name: "a", picture: 1 }],
        oneShots: 2,
        containers: [
          PIC,
          oneShotsV5(
            [
              { loc: 3, name: "Door", follow: "creak", pan: 40, flags: 8 },
              { loc: 3, name: "" },
              { loc: 3, name: "creak" },
            ],
            5,
          ),
          soundChunk(4),
        ],
      },
    ]),
  );
  expect([...mov.sounds]).toEqual([
    ["door", 3],
    ["creak", 3],
  ]);
  expect(mov.soundOptionsV5?.get("door")).toEqual({ index: 0, flags: 8, pan: 40 });
  expect(mov.soundOptionsV5?.get("creak")?.index).toBe(2);
  expect([...mov.soundFollows]).toEqual([["door", "creak"]]);
  // a table that is missing, or too short to hold a record, is no sounds
  for (const [oneShots, table] of [
    [7, new Uint8Array(0)],
    [2, new Uint8Array(0x1f)],
  ] as const) {
    expect(readMovFileV5(movV5([{ frames: [{ name: "a", picture: 1 }], oneShots, containers: [PIC, table] }])).sounds.size).toBe(0);
  }
});

test("a segment's palette is its first frame's, or none; segments chain from header to header", () => {
  const mov = readMovFileV5(
    movV5([
      { frames: [{ name: "a", picture: 1 }], containers: [PIC], actionFrames: ["a", ""] },
      { frames: [{ name: "b", picture: 1 }], containers: [new Uint8Array(16)] },
      { frames: [], containers: [] },
    ]),
  );
  expect(mov.segments.map((s) => [s.bias, s.frames.map((f) => f.locationFrame)])).toEqual([
    [0, [1]],
    [2, [3]],
    [4, []],
  ]);
  expect(mov.actionFrame1).toBe("a");
  // entry 1 is the picture's BGR; the short picture and the frameless segment give an empty palette
  expect([...mov.paletteRaw.subarray(8, 16)]).toEqual([0, 0, 0, 30, 0, 20, 0, 10]);
  expect(mov.segments[1].paletteRaw.every((b) => b === 0)).toBe(true);
  expect(mov.segments[2].paletteRaw.every((b) => b === 0)).toBe(true);
});
